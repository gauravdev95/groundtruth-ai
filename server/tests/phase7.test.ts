import test from "node:test";
import assert from "node:assert/strict";
import express from "express";

// Phase 7 tests: messaging ownership, notifications, contact endpoint.
// Pure checks run everywhere; the live-database flow runs against
// DATABASE_URL when a Postgres is reachable and SKIPS when there is
// none — same pattern as tests/applications.test.ts. Fixtures are
// timestamped test users/companies/jobs and are deleted in `finally`.
import { pool } from "../src/config/db";
import { ApiError } from "../src/middleware/errorHandler";
import { applyForJob, updateApplicationStatus } from "../src/services/applications";
import {
  getThread,
  listThreads,
  sendMessage,
} from "../src/services/messaging";
import {
  listNotifications,
  markAllNotificationsRead,
  markNotificationRead,
  notify,
  unreadNotificationCount,
} from "../src/services/notifications";
import contactRouter from "../src/routes/contact";
import { errorHandler } from "../src/middleware/errorHandler";

async function dbAvailable(): Promise<boolean> {
  try {
    await pool.query("SELECT 1");
    return true;
  } catch {
    return false;
  }
}

test("db: messaging — thread per application, parties only, notifications fire (skips without Postgres)", async (t) => {
  if (!(await dbAvailable())) {
    t.skip("no Postgres reachable at DATABASE_URL");
    return;
  }
  const stamp = Date.now();
  const recruiterEmail = `phase7-rec-${stamp}@example.com`;
  const studentEmail = `phase7-stu-${stamp}@example.com`;
  const otherEmail = `phase7-stu2-${stamp}@example.com`;
  let recruiterId = "";
  let studentId = "";
  let otherId = "";
  let companyId = "";
  let jobId = "";
  let applicationId = "";
  try {
    const mkUser = async (email: string, role: string, name: string) => {
      const { rows } = await pool.query<{ id: string }>(
        `INSERT INTO users (email, full_name, role) VALUES ($1, $2, $3) RETURNING id`,
        [email, name, role],
      );
      return rows[0]!.id;
    };
    recruiterId = await mkUser(recruiterEmail, "recruiter", "Phase Seven Recruiter");
    studentId = await mkUser(studentEmail, "candidate", "Phase Seven Student");
    otherId = await mkUser(otherEmail, "candidate", "Phase Seven Other Student");

    const { rows: companyRows } = await pool.query<{ id: string }>(
      `INSERT INTO companies (name, created_by) VALUES ($1, $2) RETURNING id`,
      ["Phase Seven Labs", recruiterId],
    );
    companyId = companyRows[0]!.id;
    const { rows: jobRows } = await pool.query<{ id: string }>(
      `INSERT INTO jobs (company_id, title, description, status)
       VALUES ($1, $2, $3, 'open') RETURNING id`,
      [companyId, "Phase Seven Engineer", "Test role for the messaging flow."],
    );
    jobId = jobRows[0]!.id;

    const app = await applyForJob(studentId, studentEmail, "Phase Seven Student", jobId);
    applicationId = app.id;

    // The other candidate has no threads and cannot read this one.
    assert.deepEqual(await listThreads(otherId, "candidate"), []);
    await assert.rejects(
      getThread(applicationId, otherId, "candidate"),
      (err: unknown) => err instanceof ApiError && err.status === 403,
    );
    await assert.rejects(
      sendMessage({ applicationId, userId: otherId, role: "candidate", body: "hi" }),
      (err: unknown) => err instanceof ApiError && err.status === 403,
    );

    // Recruiter sends first; the student sees the thread with 1 unread.
    const sent = await sendMessage({
      applicationId,
      userId: recruiterId,
      role: "recruiter",
      body: "Hi — we'd like to talk about your application.",
    });
    assert.equal(sent.application_id, applicationId);

    const studentThreads = await listThreads(studentId, "candidate");
    assert.equal(studentThreads.length, 1);
    assert.equal(studentThreads[0]!.unread_count, 1);
    assert.equal(studentThreads[0]!.job_title, "Phase Seven Engineer");

    // The recruiter's message created a notification for the student.
    assert.equal(await unreadNotificationCount(studentId), 1);
    const notes = await listNotifications(studentId);
    assert.equal(notes.length, 1);
    assert.equal(notes[0]!.type, "message");

    // Reading the thread clears the unread count.
    const thread = await getThread(applicationId, studentId, "candidate");
    assert.equal(thread.messages.length, 1);
    assert.equal(thread.messages[0]!.body, "Hi — we'd like to talk about your application.");
    assert.equal((await listThreads(studentId, "candidate"))[0]!.unread_count, 0);

    // Student replies; the recruiter is notified, and the student's own
    // message does not re-mark anything unread for them.
    await sendMessage({
      applicationId,
      userId: studentId,
      role: "candidate",
      body: "Thanks — happy to chat this week.",
    });
    assert.equal(await unreadNotificationCount(recruiterId), 1);
    assert.equal((await listThreads(studentId, "candidate"))[0]!.unread_count, 0);
    const recruiterThreads = await listThreads(recruiterId, "recruiter");
    assert.equal(recruiterThreads.length, 1);
    assert.equal(recruiterThreads[0]!.unread_count, 1);

    // Empty message is a 400, not a stored row.
    await assert.rejects(
      sendMessage({ applicationId, userId: studentId, role: "candidate", body: "   " }),
      (err: unknown) => err instanceof ApiError && err.status === 400,
    );

    // Recruiter moves the application stage; the student is notified.
    const before = await unreadNotificationCount(studentId);
    await updateApplicationStatus(applicationId, recruiterId, "recruiter", "interview");
    assert.equal(await unreadNotificationCount(studentId), before + 1);
    const latest = (await listNotifications(studentId))[0]!;
    assert.equal(latest.type, "application_status");
    assert.match(latest.body, /interview/);

    // Mark-read is scoped to the owner: the recruiter cannot mark the
    // student's notification, and the student can mark their own.
    await assert.rejects(
      markNotificationRead(recruiterId, latest.id),
      (err: unknown) => err instanceof ApiError && err.status === 404,
    );
    const read = await markNotificationRead(studentId, latest.id);
    assert.equal(read.is_read, true);
    const marked = await markAllNotificationsRead(studentId);
    assert.equal(await unreadNotificationCount(studentId), 0);
    assert.ok(marked >= 0);
  } finally {
    if (applicationId) {
      await pool.query("DELETE FROM applications WHERE id = $1", [applicationId]).catch(() => undefined);
    }
    if (jobId) {
      await pool.query("DELETE FROM jobs WHERE id = $1", [jobId]).catch(() => undefined);
    }
    if (companyId) {
      await pool.query("DELETE FROM companies WHERE id = $1", [companyId]).catch(() => undefined);
    }
    for (const email of [studentEmail, otherEmail]) {
      await pool.query("DELETE FROM candidates WHERE email = $1", [email]).catch(() => undefined);
    }
    for (const id of [studentId, otherId, recruiterId]) {
      if (id) {
        await pool.query("DELETE FROM users WHERE id = $1", [id]).catch(() => undefined);
      }
    }
  }
});

test("db: notifications — direct notify/list/unread round-trip (skips without Postgres)", async (t) => {
  if (!(await dbAvailable())) {
    t.skip("no Postgres reachable at DATABASE_URL");
    return;
  }
  const stamp = Date.now();
  const email = `phase7-notif-${stamp}@example.com`;
  const { rows } = await pool.query<{ id: string }>(
    `INSERT INTO users (email, full_name, role) VALUES ($1, $2, $3) RETURNING id`,
    [email, "Phase Seven Notif", "candidate"],
  );
  const userId = rows[0]!.id;
  try {
    assert.equal(await unreadNotificationCount(userId), 0);
    const created = await notify({
      userId,
      type: "job_match",
      title: "New match",
      body: "A role matches your profile.",
      link: "/jobs",
    });
    assert.ok(created);
    assert.equal(created!.is_read, false);
    assert.equal(await unreadNotificationCount(userId), 1);
    assert.equal((await listNotifications(userId)).length, 1);
    assert.equal(await markAllNotificationsRead(userId), 1);
    assert.equal(await unreadNotificationCount(userId), 0);
  } finally {
    await pool.query("DELETE FROM users WHERE id = $1", [userId]).catch(() => undefined);
  }
});

test("db: contact endpoint — stores the message, rejects bad input (skips without Postgres)", async (t) => {
  if (!(await dbAvailable())) {
    t.skip("no Postgres reachable at DATABASE_URL");
    return;
  }
  // Mount the real router on a throwaway Express app and hit it over HTTP.
  const app = express();
  app.use(express.json());
  app.use("/api/contact", contactRouter);
  app.use(errorHandler);
  const server = await new Promise<ReturnType<typeof app.listen>>((resolve) => {
    const s = app.listen(0, () => resolve(s));
  });
  try {
    const port = (server.address() as { port: number }).port;
    const base = `http://127.0.0.1:${port}`;

    const bad = await fetch(`${base}/api/contact`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "No Email", message: "hello" }),
    });
    assert.equal(bad.status, 400);

    const stamp = Date.now();
    const email = `phase7-contact-${stamp}@example.com`;
    const ok = await fetch(`${base}/api/contact`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        name: "Phase Seven Contact",
        email,
        message: "We would like a demo of GroundTruth AI.",
        source: "contact_page",
      }),
    });
    assert.equal(ok.status, 201);
    const body = (await ok.json()) as { id: string };
    assert.ok(body.id);
    const { rows } = await pool.query<{ email: string; status: string }>(
      "SELECT email, status FROM contact_messages WHERE id = $1",
      [body.id],
    );
    assert.equal(rows[0]!.email, email);
    assert.equal(rows[0]!.status, "new");
    await pool.query("DELETE FROM contact_messages WHERE id = $1", [body.id]);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
