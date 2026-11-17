import test from "node:test";
import assert from "node:assert/strict";

// Phase 6 analytics tests.
// Pure logic runs everywhere; the live-database flow (seed company + jobs
// + applications → move statuses → analytics reflects the real rows,
// including time-to-first-response from the history table) runs against
// DATABASE_URL when a Postgres is reachable and SKIPS when there is none
// — same pattern as tests/applications.test.ts.
import { pool } from "../src/config/db";
import { updateApplicationStatus } from "../src/services/applications";
import {
  ANALYTICS_WINDOW_DAYS,
  activitySeries,
  conversionRate,
  funnelReached,
  loadRecruiterAnalytics,
} from "../src/services/analytics";

test("analytics: conversion is null with no base, a fraction otherwise — never 0% from no data", () => {
  assert.equal(conversionRate(0, 0), null);
  assert.equal(conversionRate(3, 0), null);
  assert.equal(conversionRate(0, 10), 0);
  assert.equal(conversionRate(1, 4), 0.25);
  assert.equal(conversionRate(2, 3), 0.6667);
});

test("analytics: funnelReached accumulates current statuses forward", () => {
  assert.deepEqual(
    funnelReached({ applied: 2, reviewing: 5, interview: 1, offer: 1, rejected: 3, withdrawn: 1 }),
    { applied: 9, reviewing: 7, interview: 2, offer: 1 },
  );
  // Rejected / withdrawn never count toward "reached" stages.
  assert.deepEqual(
    funnelReached({ applied: 0, reviewing: 0, interview: 0, offer: 0, rejected: 4, withdrawn: 0 }),
    { applied: 0, reviewing: 0, interview: 0, offer: 0 },
  );
});

test("analytics: activitySeries zero-fills quiet days and ends today", () => {
  const series = activitySeries(
    [{ date: "2026-11-15", count: 2 }],
    [{ date: "2026-11-14", count: 1 }],
    3,
    new Date("2026-11-16T12:00:00Z"),
  );
  assert.equal(series.length, 3);
  assert.deepEqual(series[0], { date: "2026-11-14", applications: 0, matches: 1 });
  assert.deepEqual(series[1], { date: "2026-11-15", applications: 2, matches: 0 });
  assert.deepEqual(series[2], { date: "2026-11-16", applications: 0, matches: 0 });
});

async function dbAvailable(): Promise<boolean> {
  try {
    await pool.query("SELECT 1");
    return true;
  } catch {
    return false;
  }
}

test("db: analytics reflects real rows — statuses, funnel, history, per-job (skips without Postgres)", async (t) => {
  if (!(await dbAvailable())) {
    t.skip("no Postgres reachable at DATABASE_URL");
    return;
  }
  const stamp = Date.now();
  const recruiterEmail = `phase6-rec-${stamp}@example.com`;
  const studentEmail = `phase6-stu-${stamp}@example.com`;
  const student2Email = `phase6-stu2-${stamp}@example.com`;
  let recruiterId = "";
  let studentId = "";
  let student2Id = "";
  let companyId = "";
  let jobId = "";
  try {
    const mkUser = async (email: string, role: string, name: string) => {
      const { rows } = await pool.query<{ id: string }>(
        `INSERT INTO users (email, full_name, role) VALUES ($1, $2, $3) RETURNING id`,
        [email, name, role],
      );
      return rows[0]!.id;
    };
    recruiterId = await mkUser(recruiterEmail, "recruiter", "Phase Six Recruiter");
    studentId = await mkUser(studentEmail, "candidate", "Phase Six Student");
    student2Id = await mkUser(student2Email, "candidate", "Phase Six Student Two");

    const { rows: companyRows } = await pool.query<{ id: string }>(
      `INSERT INTO companies (name, created_by) VALUES ($1, $2) RETURNING id`,
      ["Phase Six Labs", recruiterId],
    );
    companyId = companyRows[0]!.id;
    const { rows: jobRows } = await pool.query<{ id: string }>(
      `INSERT INTO jobs (company_id, title, description, status)
       VALUES ($1, $2, $3, 'open') RETURNING id`,
      [companyId, "Phase Six Engineer", "Test role for the analytics flow."],
    );
    jobId = jobRows[0]!.id;

    // Two applicants, straight from the tables.
    const { rows: candRows } = await pool.query<{ id: string }>(
      `INSERT INTO candidates (user_id, full_name, email) VALUES ($1, $2, $3) RETURNING id`,
      [studentId, "Phase Six Student", studentEmail],
    );
    const candidateId = candRows[0]!.id;
    const { rows: cand2Rows } = await pool.query<{ id: string }>(
      `INSERT INTO candidates (user_id, full_name, email) VALUES ($1, $2, $3) RETURNING id`,
      [student2Id, "Phase Six Student Two", student2Email],
    );
    const candidate2Id = cand2Rows[0]!.id;
    const { rows: appRows } = await pool.query<{ id: string }>(
      `INSERT INTO applications (candidate_id, job_id) VALUES ($1, $2), ($3, $2) RETURNING id`,
      [candidateId, jobId, candidate2Id],
    );
    const appId = appRows[0]!.id;
    const app2Id = appRows[1]!.id;

    // No moves yet: everything sits at applied, no first-response time.
    const before = await loadRecruiterAnalytics(recruiterId);
    assert.equal(before.counts.jobs_total, 1);
    assert.equal(before.counts.applications, 2);
    assert.equal(before.counts.applicants, 2);
    assert.equal(before.by_status.applied, 2);
    assert.equal(before.by_status.reviewing, 0);
    assert.equal(before.avg_time_to_first_response_hours, null);
    assert.equal(before.first_response_sample, 0);
    // Two applications reached "applied", none reached reviewing yet —
    // that is a measured 0, not "no data". (Null only when the base
    // stage itself has nobody in it.)
    assert.equal(before.funnel.conversion.applied_to_reviewing, 0);
    assert.equal(before.funnel.conversion.reviewing_to_interview, null);
    assert.equal(before.by_job.length, 1);
    assert.equal(before.by_job[0]!.applications, 2);
    assert.equal(before.activity.window_days, ANALYTICS_WINDOW_DAYS);
    assert.equal(before.activity.series.length, ANALYTICS_WINDOW_DAYS);
    const today = before.activity.series[ANALYTICS_WINDOW_DAYS - 1]!;
    assert.equal(today.applications, 2);

    // Move one application applied → reviewing → interview. The history
    // table records both moves; the first one starts the response clock.
    await updateApplicationStatus(appId, recruiterId, "recruiter", "reviewing");
    await updateApplicationStatus(appId, recruiterId, "recruiter", "interview");
    // The other applicant is rejected straight from applied.
    await updateApplicationStatus(app2Id, recruiterId, "recruiter", "rejected");

    const history = await pool.query<{ from_status: string; to_status: string }>(
      `SELECT from_status, to_status FROM application_status_history
       WHERE application_id = $1 ORDER BY created_at`,
      [appId],
    );
    assert.deepEqual(
      history.rows.map((r) => `${r.from_status}->${r.to_status}`),
      ["applied->reviewing", "reviewing->interview"],
    );

    const after = await loadRecruiterAnalytics(recruiterId);
    assert.equal(after.by_status.applied, 0);
    assert.equal(after.by_status.interview, 1);
    assert.equal(after.by_status.rejected, 1);
    // The response clock ran: both applications have a recorded first
    // move out of applied (reviewing for one, rejected for the other),
    // and both happened within the last hour (fractions of an hour, not
    // 0 and not a made-up number).
    assert.equal(after.first_response_sample, 2);
    assert.ok(
      (after.avg_time_to_first_response_hours ?? 99) >= 0 &&
        (after.avg_time_to_first_response_hours ?? 99) < 1,
    );
    // Funnel: only the non-rejected application counts toward "reached"
    // (the rejected one reached applied in reality, but current-status
    // funneling cannot see stages it passed through — the documented
    // limitation). So reached = 1 at every stage up to interview, 0 at
    // offer.
    assert.equal(after.funnel.reached.applied, 1);
    assert.equal(after.funnel.reached.reviewing, 1);
    assert.equal(after.funnel.reached.interview, 1);
    assert.equal(after.funnel.reached.offer, 0);
    assert.equal(after.funnel.conversion.applied_to_reviewing, 1);
    assert.equal(after.funnel.conversion.reviewing_to_interview, 1);
    // One application reached interview, none reached offer — a measured
    // 0, not "no data" (the base stage has one application in it).
    assert.equal(after.funnel.conversion.interview_to_offer, 0);
    assert.equal(after.by_job[0]!.by_status.interview, 1);
    assert.equal(after.by_job[0]!.by_status.rejected, 1);

    // A match row written by the (future) matching engine surfaces too.
    await pool.query(
      `INSERT INTO matches (candidate_id, job_id, score, model) VALUES ($1, $2, 0.81, 'test-model')`,
      [candidateId, jobId],
    );
    const scored = await loadRecruiterAnalytics(recruiterId);
    assert.equal(scored.counts.matches, 1);
    assert.equal(scored.activity.series[ANALYTICS_WINDOW_DAYS - 1]!.matches, 1);
  } finally {
    if (companyId) {
      await pool.query("DELETE FROM companies WHERE id = $1", [companyId]).catch(() => undefined);
    }
    for (const email of [studentEmail, student2Email]) {
      await pool.query("DELETE FROM candidates WHERE email = $1", [email]).catch(() => undefined);
    }
    for (const id of [studentId, student2Id, recruiterId]) {
      if (id) {
        await pool.query("DELETE FROM users WHERE id = $1", [id]).catch(() => undefined);
      }
    }
  }
});
