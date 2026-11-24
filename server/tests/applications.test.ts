import test from "node:test";
import assert from "node:assert/strict";

// Phase 4 applications tests.
// Pure logic runs everywhere; the live-database flow (apply → duplicate
// 409 → match score surfaces → cross-company 404 → status update) runs
// against DATABASE_URL when a Postgres is reachable and SKIPS when there
// is none — same pattern as tests/auth.db.test.ts. The 005_recruiter.sql
// migration is not needed here (001_init.sql already has `applications`
// and `matches`); the 004_student.sql columns are used by loadFullProfile.
import { pool } from "../src/config/db";
import { ApiError } from "../src/middleware/errorHandler";
import {
  RECRUITER_STATUSES,
  applyForJob,
  formatMatchScore,
  isValidApplicationStatus,
  listMyApplications,
  listRecruiterApplications,
  loadApplicationDetail,
  updateApplicationStatus,
} from "../src/services/applications";

test("match score: null stays null — no score is never shown as a number", () => {
  assert.equal(formatMatchScore(null), null);
  assert.equal(formatMatchScore("0.87"), "87%");
  assert.equal(formatMatchScore(0.5), "50%");
  assert.equal(formatMatchScore(-0.2), "-20%");
  assert.equal(formatMatchScore("not-a-number"), null);
});

test("application statuses: the six stored values validate, anything else does not", () => {
  for (const s of [
    "applied",
    "reviewing",
    "interview",
    "offer",
    "rejected",
    "withdrawn",
  ]) {
    assert.equal(isValidApplicationStatus(s), true);
  }
  assert.equal(isValidApplicationStatus("hired"), false);
  assert.equal(isValidApplicationStatus(""), false);
  assert.equal(isValidApplicationStatus(null), false);
  assert.deepEqual(RECRUITER_STATUSES, [
    "reviewing",
    "interview",
    "offer",
    "rejected",
  ]);
});

async function dbAvailable(): Promise<boolean> {
  try {
    await pool.query("SELECT 1");
    return true;
  } catch {
    return false;
  }
}

test("db: apply → duplicate 409 → match surfaces → cross-company 404 → status (skips without Postgres)", async (t) => {
  if (!(await dbAvailable())) {
    t.skip("no Postgres reachable at DATABASE_URL");
    return;
  }
  const stamp = Date.now();
  const recruiterEmail = `phase4-rec-${stamp}@example.com`;
  const otherRecruiterEmail = `phase4-rec2-${stamp}@example.com`;
  const studentEmail = `phase4-stu-${stamp}@example.com`;
  let recruiterId = "";
  let otherRecruiterId = "";
  let studentId = "";
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
    recruiterId = await mkUser(recruiterEmail, "recruiter", "Phase Four Recruiter");
    otherRecruiterId = await mkUser(otherRecruiterEmail, "recruiter", "Phase Four Other");
    studentId = await mkUser(studentEmail, "candidate", "Phase Four Student");

    const { rows: companyRows } = await pool.query<{ id: string }>(
      `INSERT INTO companies (name, created_by) VALUES ($1, $2) RETURNING id`,
      ["Phase Four Labs", recruiterId],
    );
    companyId = companyRows[0]!.id;
    const { rows: jobRows } = await pool.query<{ id: string }>(
      `INSERT INTO jobs (company_id, title, description, status)
       VALUES ($1, $2, $3, 'open') RETURNING id`,
      [companyId, "Phase Four Engineer", "Test role for the apply flow."],
    );
    jobId = jobRows[0]!.id;

    // First apply succeeds…
    const app = await applyForJob(
      studentId,
      studentEmail,
      "Phase Four Student",
      jobId,
    );
    assert.equal(app.status, "applied");
    assert.equal(app.job_title, "Phase Four Engineer");

    // …second apply for the same job is a 409, not a second row.
    await assert.rejects(
      applyForJob(studentId, studentEmail, "Phase Four Student", jobId),
      (err: unknown) => err instanceof ApiError && err.status === 409,
    );

    // The student's own list shows the application with NO match score —
    // no matching has run, so nothing is invented.
    const mine = await listMyApplications(
      (await pool.query<{ id: string }>("SELECT id FROM candidates WHERE user_id = $1", [studentId])).rows[0]!.id,
    );
    assert.equal(mine.length, 1);
    assert.equal(mine[0]!.match_score, null);

    // When the matching engine writes a row, the same read surfaces it.
    await pool.query(
      `INSERT INTO matches (candidate_id, job_id, score, model) VALUES ($1, $2, 0.87, 'test-model')`,
      [mine[0]!.candidate_id, jobId],
    );
    const mineScored = await listMyApplications(mine[0]!.candidate_id);
    assert.equal(Number(mineScored[0]!.match_score), 0.87);
    assert.equal(formatMatchScore(mineScored[0]!.match_score), "87%");

    // The owning recruiter sees it; another recruiter gets a 404.
    const own = await listRecruiterApplications(recruiterId);
    assert.equal(own.length, 1);
    assert.equal(own[0]!.candidate_name, "Phase Four Student");
    const detail = await loadApplicationDetail(mine[0]!.id, recruiterId, "recruiter");
    assert.equal(detail.profile.candidate.email, studentEmail);
    await assert.rejects(
      loadApplicationDetail(mine[0]!.id, otherRecruiterId, "recruiter"),
      (err: unknown) => err instanceof ApiError && err.status === 404,
    );

    // Status moves through the pipeline.
    const moved = await updateApplicationStatus(
      mine[0]!.id,
      recruiterId,
      "recruiter",
      "reviewing",
    );
    assert.equal(moved.status, "reviewing");

    // Applying to a closed job is a 400.
    await pool.query("UPDATE jobs SET status = 'closed' WHERE id = $1", [jobId]);
    const student2Email = `phase4-stu2-${stamp}@example.com`;
    const student2Id = await mkUser(student2Email, "candidate", "Phase Four Student Two");
    await assert.rejects(
      applyForJob(student2Id, student2Email, "Phase Four Student Two", jobId),
      (err: unknown) => err instanceof ApiError && err.status === 400,
    );
    await pool.query("DELETE FROM users WHERE id = $1", [student2Id]);
  } finally {
    // Candidates/jobs cascade from the users/company deletes; matches and
    // applications cascade from the job/candidate deletes. Candidates
    // themselves only lose their user link, so remove the test rows by
    // email as well.
    if (companyId) {
      await pool.query("DELETE FROM companies WHERE id = $1", [companyId]).catch(() => undefined);
    }
    for (const email of [studentEmail, `phase4-stu2-${stamp}@example.com`]) {
      await pool.query("DELETE FROM candidates WHERE email = $1", [email]).catch(() => undefined);
    }
    for (const id of [studentId, recruiterId, otherRecruiterId]) {
      if (id) {
        await pool.query("DELETE FROM users WHERE id = $1", [id]).catch(() => undefined);
      }
    }
  }
});
