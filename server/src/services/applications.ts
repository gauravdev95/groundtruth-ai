import { pool } from "../config/db";
import { ApiError } from "../middleware/errorHandler";
import {
  getOrCreateCandidateForUser,
  loadFullProfile,
  type FullProfile,
} from "./student";
import { getOrCreateRecruiterForUser } from "./recruiter";
import { notifyCandidate } from "./notifications";

/**
 * Applications service — Phase 4 (jobs / matches / applications core flow).
 *
 * The `applications` and `matches` tables already exist from 001_init.sql;
 * this phase only wires the flow through them. Nothing here invents data:
 *
 * - An application is a real row (UNIQUE candidate_id, job_id) created by
 *   POST /api/jobs/:id/apply. Applying twice is a 409, never a second row.
 * - A match score is shown ONLY when a row exists in `matches` for that
 *   candidate+job (written by the matching engine, when it runs). No
 *   matching runs in this phase, so a fresh application honestly reports
 *   `match_score: null` — "No match score yet" in the UI — instead of a
 *   fabricated number. `matches.score` is a cosine similarity in [-1, 1].
 * - A recruiter only ever sees applications for jobs under their OWN
 *   company (same ownership rule as POST /api/jobs in Phase 3). An
 *   application for another company's job is a 404 to them, so no
 *   applicant data leaks across companies. Admins are exempt (they have
 *   no company of their own).
 */

export const APPLICATION_STATUSES = [
  "applied",
  "reviewing",
  "interview",
  "offer",
  "rejected",
  "withdrawn",
] as const;

export type ApplicationStatus = (typeof APPLICATION_STATUSES)[number];

/** Statuses a recruiter may move an application to from the pipeline UI. */
export const RECRUITER_STATUSES: ApplicationStatus[] = [
  "reviewing",
  "interview",
  "offer",
  "rejected",
];

export function isValidApplicationStatus(value: unknown): value is ApplicationStatus {
  return (
    typeof value === "string" &&
    (APPLICATION_STATUSES as readonly string[]).includes(value)
  );
}

/**
 * Display a stored cosine-similarity score (-1..1) as a whole percent,
 * or null when there is no score. Pure — unit-tested in
 * tests/applications.test.ts.
 */
export function formatMatchScore(score: number | string | null): string | null {
  if (score === null || score === undefined) return null;
  const n = typeof score === "string" ? Number(score) : score;
  if (!Number.isFinite(n)) return null;
  return `${Math.round(n * 100)}%`;
}

/** Latest match row for one candidate+job, if the matching engine wrote one. */
const LATEST_MATCH_SQL = `LEFT JOIN LATERAL (
    SELECT m.score, m.model
    FROM matches m
    WHERE m.candidate_id = a.candidate_id AND m.job_id = a.job_id
    ORDER BY m.created_at DESC LIMIT 1
  ) m ON true`;

export interface ApplicationRow {
  id: string;
  status: string;
  created_at: string;
  updated_at: string;
  job_id: string;
  job_title: string;
  company_id: string;
  company_name: string | null;
  job_location: string | null;
  candidate_id: string;
  candidate_name: string;
  candidate_headline: string | null;
  candidate_location: string | null;
  candidate_degree: string | null;
  candidate_branch: string | null;
  candidate_graduation_year: number | null;
  /** Latest `matches.score` for this candidate+job, or null (see header). */
  match_score: string | null;
  match_model: string | null;
}

const APPLICATION_COLUMNS = `
  a.id, a.status, a.created_at, a.updated_at,
  j.id AS job_id, j.title AS job_title, j.company_id, c.name AS company_name,
  j.location AS job_location,
  cand.id AS candidate_id, cand.full_name AS candidate_name,
  cand.headline AS candidate_headline, cand.location AS candidate_location,
  cand.degree AS candidate_degree, cand.branch AS candidate_branch,
  cand.graduation_year AS candidate_graduation_year,
  m.score AS match_score, m.model AS match_model
  FROM applications a
  JOIN jobs j ON j.id = a.job_id
  LEFT JOIN companies c ON c.id = j.company_id
  JOIN candidates cand ON cand.id = a.candidate_id
  ${LATEST_MATCH_SQL}
`;

export interface ApplyResult {
  id: string;
  status: string;
  created_at: string;
  job_id: string;
  job_title: string;
  company_name: string | null;
}

/**
 * Create the application for the signed-in candidate. Resolves (or
 * creates, as in the student routes) the caller's own candidate row, so
 * the application always points at the real student profile.
 */
export async function applyForJob(
  userId: string,
  email: string,
  fullName: string,
  jobId: string,
): Promise<ApplyResult> {
  const candidate = await getOrCreateCandidateForUser(userId, email, fullName);
  const jobRes = await pool.query<{ id: string; title: string; status: string }>(
    `SELECT j.id, j.title, j.status FROM jobs j WHERE j.id = $1`,
    [jobId],
  );
  const job = jobRes.rows[0];
  if (!job) throw new ApiError(404, "Job not found");
  if (job.status !== "open") {
    throw new ApiError(400, "This role is no longer accepting applications");
  }
  try {
    const { rows } = await pool.query<ApplyResult>(
      `INSERT INTO applications (candidate_id, job_id)
       VALUES ($1, $2)
       RETURNING id, status, created_at, job_id`,
      [candidate.id, jobId],
    );
    const row = rows[0] as ApplyResult;
    const companyRes = await pool.query<{ name: string | null }>(
      `SELECT c.name FROM jobs j LEFT JOIN companies c ON c.id = j.company_id WHERE j.id = $1`,
      [jobId],
    );
    return {
      ...row,
      job_title: job.title,
      company_name: companyRes.rows[0]?.name ?? null,
    };
  } catch (err) {
    // UNIQUE (candidate_id, job_id) — one application per student per job.
    if (
      err instanceof Error &&
      "code" in err &&
      (err as { code?: string }).code === "23505"
    ) {
      throw new ApiError(409, "You have already applied to this role");
    }
    throw err;
  }
}

/** The signed-in candidate's own applications, newest first. */
export async function listMyApplications(
  candidateId: string,
): Promise<ApplicationRow[]> {
  const { rows } = await pool.query<ApplicationRow>(
    `SELECT ${APPLICATION_COLUMNS} WHERE a.candidate_id = $1 ORDER BY a.created_at DESC`,
    [candidateId],
  );
  return rows;
}

/**
 * True when the recruiter (or admin) may see `jobId`'s applications:
 * admins always; recruiters only for jobs under their own company — the
 * company row created at registration or linked on their recruiter
 * profile (same rule as POST /api/jobs, Phase 3).
 */
export async function recruiterOwnsJob(
  userId: string,
  jobId: string,
  isAdmin: boolean,
): Promise<boolean> {
  if (isAdmin) return true;
  const { rows } = await pool.query<{ id: string }>(
    `SELECT j.id FROM jobs j WHERE j.id = $1
       AND j.company_id IN (
         SELECT id FROM companies WHERE created_by = $2
         UNION
         SELECT company_id FROM recruiter_profiles WHERE user_id = $2
       )`,
    [jobId, userId],
  );
  return rows.length > 0;
}

async function assertRecruiterOwnsJob(
  userId: string,
  jobId: string,
  isAdmin: boolean,
): Promise<void> {
  const jobRes = await pool.query<{ id: string }>(
    "SELECT id FROM jobs WHERE id = $1",
    [jobId],
  );
  if (jobRes.rows.length === 0) throw new ApiError(404, "Job not found");
  if (!(await recruiterOwnsJob(userId, jobId, isAdmin))) {
    throw new ApiError(404, "Job not found");
  }
}

/** All applications for one job — recruiter/admin only, own-company scoped. */
export async function listJobApplications(
  userId: string,
  jobId: string,
  isAdmin: boolean,
): Promise<ApplicationRow[]> {
  await assertRecruiterOwnsJob(userId, jobId, isAdmin);
  const { rows } = await pool.query<ApplicationRow>(
    `SELECT ${APPLICATION_COLUMNS} WHERE a.job_id = $1 ORDER BY a.created_at DESC`,
    [jobId],
  );
  return rows;
}

/** Every application across the recruiter's own company's jobs. */
export async function listRecruiterApplications(
  userId: string,
): Promise<ApplicationRow[]> {
  const { company } = await getOrCreateRecruiterForUser(userId);
  if (!company) return [];
  const { rows } = await pool.query<ApplicationRow>(
    `SELECT ${APPLICATION_COLUMNS} WHERE j.company_id = $1 ORDER BY a.created_at DESC`,
    [company.id],
  );
  return rows;
}

export interface ApplicationDetail {
  application: ApplicationRow;
  /** The applicant's full student profile (Phase 2 shape), read-only. */
  profile: FullProfile;
}

/**
 * One application with the applicant's full profile. Allowed for the
 * owning candidate, or a recruiter/admin whose company owns the job.
 * Anything else is a 404 — the row exists, just not for this caller.
 */
export async function loadApplicationDetail(
  applicationId: string,
  userId: string,
  role: string,
): Promise<ApplicationDetail> {
  const { rows } = await pool.query<ApplicationRow>(
    `SELECT ${APPLICATION_COLUMNS} WHERE a.id = $1`,
    [applicationId],
  );
  const application = rows[0];
  if (!application) throw new ApiError(404, "Application not found");

  if (role === "candidate") {
    const candRes = await pool.query<{ id: string }>(
      "SELECT id FROM candidates WHERE user_id = $1",
      [userId],
    );
    if (candRes.rows[0]?.id !== application.candidate_id) {
      throw new ApiError(404, "Application not found");
    }
  } else if (role === "recruiter" || role === "admin") {
    if (
      !(await recruiterOwnsJob(
        userId,
        application.job_id,
        role === "admin",
      ))
    ) {
      throw new ApiError(404, "Application not found");
    }
  } else {
    throw new ApiError(404, "Application not found");
  }

  return {
    application,
    profile: await loadFullProfile(application.candidate_id),
  };
}

/** Recruiter/admin moves an application through the pipeline. */
export async function updateApplicationStatus(
  applicationId: string,
  userId: string,
  role: string,
  status: ApplicationStatus,
): Promise<ApplicationRow> {
  const { rows } = await pool.query<ApplicationRow>(
    `SELECT ${APPLICATION_COLUMNS} WHERE a.id = $1`,
    [applicationId],
  );
  const application = rows[0];
  if (!application) throw new ApiError(404, "Application not found");
  if (
    !(await recruiterOwnsJob(userId, application.job_id, role === "admin"))
  ) {
    throw new ApiError(404, "Application not found");
  }
  // Phase 6: record the move in `application_status_history` — the audit
  // trail analytics reads for time-to-first-response. Only a real change
  // writes a row (setting the same status again is a no-op, not a move).
  // The history insert rides on the same connection as the update so a
  // failed insert cannot leave the status changed without its record.
  const previousStatus = application.status;
  if (previousStatus !== status) {
    await pool.query(
      `UPDATE applications SET status = $1, updated_at = now() WHERE id = $2`,
      [status, applicationId],
    );
    await pool.query(
      `INSERT INTO application_status_history
         (application_id, from_status, to_status, changed_by)
       VALUES ($1, $2, $3, $4)`,
      [applicationId, previousStatus, status, userId],
    );
    // Phase 7: tell the candidate their application moved. Best-effort —
    // a failed notification insert never fails the status change itself.
    await notifyCandidate(application.candidate_id, {
      type: "application_status",
      title: `Application update — ${application.job_title}`,
      body: `Your application for “${application.job_title}”${
        application.company_name ? ` at ${application.company_name}` : ""
      } moved from ${previousStatus} to ${status}.`,
      link: `/student/messages/${applicationId}`,
      applicationId,
    });
  }
  const updated = await pool.query<ApplicationRow>(
    `SELECT ${APPLICATION_COLUMNS} WHERE a.id = $1`,
    [applicationId],
  );
  return updated.rows[0] as ApplicationRow;
}
