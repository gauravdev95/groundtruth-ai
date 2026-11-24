import { pool } from "../config/db";
import { ApiError } from "../middleware/errorHandler";
import { recruiterOwnsJob } from "./applications";
import { notify, notifyCandidate } from "./notifications";

/**
 * Messaging service — Phase 7.
 *
 * One thread per application. The only people who may read or write a
 * thread are the candidate who owns the application and recruiters of
 * the company that owns the job (admins exempt, as elsewhere). Anyone
 * else gets a 403 — including another candidate, who must never see a
 * thread that is not theirs.
 *
 * Unread counts are derived from `thread_reads` watermarks: a message
 * counts as unread for a user when the other party sent it after that
 * user's last read of the thread. Opening a thread advances the
 * watermark; sending a message does not mark the other party's
 * messages read.
 */

export interface MessageRow {
  id: string;
  application_id: string;
  sender_id: string;
  sender_name: string | null;
  sender_role: string | null;
  body: string;
  created_at: string;
}

export interface ThreadRow {
  application_id: string;
  job_id: string;
  job_title: string;
  company_name: string | null;
  candidate_id: string;
  candidate_name: string;
  application_status: string;
  last_message: string | null;
  last_message_at: string | null;
  last_sender_id: string | null;
  unread_count: number;
}

interface ThreadParty {
  candidateId: string;
  candidateUserId: string | null;
  candidateName: string;
  jobId: string;
  jobTitle: string;
  companyName: string | null;
}

/** Load the application + its parties, or 404 when it does not exist. */
async function loadThreadParties(
  applicationId: string,
): Promise<ThreadParty> {
  const { rows } = await pool.query<{
    candidate_id: string;
    candidate_user_id: string | null;
    candidate_name: string;
    job_id: string;
    job_title: string;
    company_name: string | null;
  }>(
    `SELECT a.candidate_id, cand.user_id AS candidate_user_id,
            cand.full_name AS candidate_name,
            a.job_id, j.title AS job_title, c.name AS company_name
     FROM applications a
     JOIN candidates cand ON cand.id = a.candidate_id
     JOIN jobs j ON j.id = a.job_id
     LEFT JOIN companies c ON c.id = j.company_id
     WHERE a.id = $1`,
    [applicationId],
  );
  const row = rows[0];
  if (!row) throw new ApiError(404, "Application not found");
  return {
    candidateId: row.candidate_id,
    candidateUserId: row.candidate_user_id,
    candidateName: row.candidate_name,
    jobId: row.job_id,
    jobTitle: row.job_title,
    companyName: row.company_name,
  };
}

/** True when the user is a party to this thread (candidate / recruiter / admin). */
export async function mayAccessThread(
  applicationId: string,
  userId: string,
  role: string,
): Promise<ThreadParty> {
  const parties = await loadThreadParties(applicationId);
  if (role === "admin") return parties;
  if (role === "candidate") {
    if (parties.candidateUserId === userId) return parties;
    throw new ApiError(403, "You are not a party to this conversation");
  }
  if (role === "recruiter") {
    if (await recruiterOwnsJob(userId, parties.jobId, false)) return parties;
    throw new ApiError(403, "You are not a party to this conversation");
  }
  throw new ApiError(403, "You are not a party to this conversation");
}

/** Recruiter user ids for the company that owns `jobId`. */
async function recruiterUserIdsForJob(jobId: string): Promise<string[]> {
  const { rows } = await pool.query<{ user_id: string }>(
    `SELECT user_id FROM (
       SELECT created_by AS user_id FROM companies c
       JOIN jobs j ON j.company_id = c.id WHERE j.id = $1
       UNION
       SELECT rp.user_id FROM recruiter_profiles rp
       JOIN jobs j ON j.company_id = rp.company_id WHERE j.id = $1
     ) u WHERE user_id IS NOT NULL`,
    [jobId],
  );
  return rows.map((r) => r.user_id);
}

const THREAD_LIST_SQL = `
  SELECT a.id AS application_id, a.job_id, j.title AS job_title,
         c.name AS company_name, a.candidate_id, cand.full_name AS candidate_name,
         a.status AS application_status,
         lm.body AS last_message, lm.created_at AS last_message_at,
         lm.sender_id AS last_sender_id,
         COALESCE((
           SELECT COUNT(*) FROM messages m
           WHERE m.application_id = a.id
             AND m.sender_id <> $1
             AND m.created_at > COALESCE(tr.last_read_at, 'epoch'::timestamptz)
         ), 0)::int AS unread_count
  FROM applications a
  JOIN jobs j ON j.id = a.job_id
  LEFT JOIN companies c ON c.id = j.company_id
  JOIN candidates cand ON cand.id = a.candidate_id
  LEFT JOIN LATERAL (
    SELECT m.body, m.created_at, m.sender_id FROM messages m
    WHERE m.application_id = a.id ORDER BY m.created_at DESC LIMIT 1
  ) lm ON true
  LEFT JOIN thread_reads tr
    ON tr.application_id = a.id AND tr.user_id = $1
`;

/** Threads for the signed-in user: own applications (candidate) or own-company applications (recruiter/admin). */
export async function listThreads(
  userId: string,
  role: string,
): Promise<ThreadRow[]> {
  let where = "";
  const params: unknown[] = [userId];
  if (role === "candidate") {
    where = "WHERE cand.user_id = $1";
  } else if (role === "recruiter") {
    where = `WHERE j.company_id IN (
      SELECT id FROM companies WHERE created_by = $1
      UNION
      SELECT company_id FROM recruiter_profiles WHERE user_id = $1
    )`;
  } else if (role !== "admin") {
    throw new ApiError(403, "Messaging is not available for this role");
  }
  const { rows } = await pool.query<ThreadRow>(
    `${THREAD_LIST_SQL} ${where} ORDER BY COALESCE(lm.created_at, a.created_at) DESC`,
    params,
  );
  return rows;
}

export interface ThreadDetail {
  application_id: string;
  job_id: string;
  job_title: string;
  company_name: string | null;
  candidate_id: string;
  candidate_name: string;
  application_status: string;
  messages: MessageRow[];
}

/** One thread with its messages; marks the thread read for the caller. */
export async function getThread(
  applicationId: string,
  userId: string,
  role: string,
): Promise<ThreadDetail> {
  const parties = await mayAccessThread(applicationId, userId, role);
  const { rows: messages } = await pool.query<MessageRow>(
    `SELECT m.id, m.application_id, m.sender_id,
            u.full_name AS sender_name, u.role AS sender_role,
            m.body, m.created_at
     FROM messages m
     LEFT JOIN users u ON u.id = m.sender_id
     WHERE m.application_id = $1
     ORDER BY m.created_at ASC`,
    [applicationId],
  );
  await pool.query(
    `INSERT INTO thread_reads (user_id, application_id, last_read_at)
     VALUES ($1, $2, now())
     ON CONFLICT (user_id, application_id)
     DO UPDATE SET last_read_at = now()`,
    [userId, applicationId],
  );
  const { rows: appRows } = await pool.query<{
    candidate_name: string;
    application_status: string;
  }>(
    `SELECT cand.full_name AS candidate_name, a.status AS application_status
     FROM applications a JOIN candidates cand ON cand.id = a.candidate_id
     WHERE a.id = $1`,
    [applicationId],
  );
  return {
    application_id: applicationId,
    job_id: parties.jobId,
    job_title: parties.jobTitle,
    company_name: parties.companyName,
    candidate_id: parties.candidateId,
    candidate_name: appRows[0]?.candidate_name ?? "",
    application_status: appRows[0]?.application_status ?? "",
    messages,
  };
}

export interface SendMessageInput {
  applicationId: string;
  userId: string;
  role: string;
  body: string;
}

/** Send a message in a thread the caller is a party to; notifies the other side. */
export async function sendMessage(
  input: SendMessageInput,
): Promise<MessageRow> {
  const body = input.body.trim();
  if (body.length < 1 || body.length > 5000) {
    throw new ApiError(400, "Message must be between 1 and 5000 characters");
  }
  const parties = await mayAccessThread(
    input.applicationId,
    input.userId,
    input.role,
  );
  const { rows } = await pool.query<MessageRow>(
    `INSERT INTO messages (application_id, sender_id, body)
     VALUES ($1, $2, $3)
     RETURNING id, application_id, sender_id, body, created_at`,
    [input.applicationId, input.userId, body],
  );
  const message = rows[0]!;
  // The sender has now seen the thread up to their own message.
  await pool.query(
    `INSERT INTO thread_reads (user_id, application_id, last_read_at)
     VALUES ($1, $2, now())
     ON CONFLICT (user_id, application_id)
     DO UPDATE SET last_read_at = now()`,
    [input.userId, input.applicationId],
  );
  // Notify the other party (best-effort — never fails the send).
  const link =
    input.role === "candidate"
      ? `/recruiter/messages/${input.applicationId}`
      : `/student/messages/${input.applicationId}`;
  if (input.role === "candidate") {
    for (const recruiterId of await recruiterUserIdsForJob(parties.jobId)) {
      if (recruiterId === input.userId) continue;
      await notify({
        userId: recruiterId,
        type: "message",
        title: `New message — ${parties.jobTitle}`,
        body: `${parties.candidateName} sent a message about “${parties.jobTitle}”.`,
        link,
        applicationId: input.applicationId,
      });
    }
  } else {
    await notifyCandidate(parties.candidateId, {
      type: "message",
      title: `New message — ${parties.jobTitle}`,
      body: `Your recruiter sent a message about “${parties.jobTitle}”${parties.companyName ? ` at ${parties.companyName}` : ""}.`,
      link,
      applicationId: input.applicationId,
    });
  }
  return {
    ...message,
    sender_name: null,
    sender_role: input.role,
  };
}
