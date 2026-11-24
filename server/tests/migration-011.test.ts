import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";

// Phase C — migration 011 (interview sessions). Applies the 011 file
// against DATABASE_URL when a Postgres is reachable and SKIPS (not fails)
// when there is none, following the existing DB-test convention
// (see tests/auth.db.test.ts). Migrations 000–010 must have been applied
// first (npm run migrate) for the full-migrate check.

import { pool } from "../src/config/db";

const MIGRATION_011 = path.resolve(
  __dirname,
  "..",
  "..",
  "infra",
  "postgres",
  "011_interview_sessions.sql",
);

async function dbAvailable(): Promise<boolean> {
  try {
    await pool.query("SELECT 1");
    return true;
  } catch {
    return false;
  }
}

test("db: migration 011 applies, creates session tables, and is idempotent (skips without Postgres)", async (t) => {
  if (!(await dbAvailable())) {
    t.skip("no Postgres reachable at DATABASE_URL");
    return;
  }
  const sql = await readFile(MIGRATION_011, "utf8");
  await pool.query(sql);
  await pool.query(sql); // second run must be a no-op (idempotent)

  const tables = await pool.query(
    `SELECT table_name FROM information_schema.tables
      WHERE table_name IN ('interview_sessions', 'interview_followups', 'interview_reports')`,
  );
  assert.equal(tables.rows.length, 3);

  // Session status CHECK covers the full lifecycle.
  const check = await pool.query(
    `SELECT pg_get_constraintdef(oid) AS def FROM pg_constraint
      WHERE conrelid = 'interview_sessions'::regclass AND contype = 'c'`,
  );
  assert.ok(
    check.rows.some((r: { def: string }) =>
      r.def.includes("not_started") &&
      r.def.includes("intro") &&
      r.def.includes("ready") &&
      r.def.includes("in_progress") &&
      r.def.includes("completed") &&
      r.def.includes("expired"),
    ),
    "session status CHECK must list all six lifecycle states",
  );

  // One active session per interview: the partial unique index exists.
  const idx = await pool.query(
    `SELECT indexname FROM pg_indexes WHERE tablename = 'interview_sessions'
      AND indexname = 'idx_interview_sessions_one_active'`,
  );
  assert.equal(idx.rows.length, 1);

  // Follow-up caps: UNIQUE on interview_id (max 1 per interview) and on
  // original_question_id (max 1 per original question).
  const fuUnique = await pool.query(
    `SELECT indexname FROM pg_indexes WHERE tablename = 'interview_followups'
      AND indexname LIKE 'interview_followups%key'`,
  );
  assert.ok(fuUnique.rows.length >= 2, "follow-up unique constraints must exist");

  // Immutability triggers exist on answers and reports (pg_trigger counts
  // one row per trigger; information_schema.triggers counts one per event).
  const triggers = await pool.query(
    `SELECT tgname FROM pg_trigger
      WHERE tgname IN ('trg_interview_answers_immutable', 'trg_interview_reports_immutable')
        AND NOT tgisinternal`,
  );
  assert.equal(triggers.rows.length, 2);

  // New question/answer columns exist.
  const cols = await pool.query(
    `SELECT table_name, column_name FROM information_schema.columns
      WHERE (table_name = 'interview_questions' AND column_name IN
        ('competency_id', 'expected_points', 'scoring_rubric', 'max_time_seconds',
         'framework_version', 'source', 'is_follow_up', 'follow_up_of_question_id'))
         OR (table_name = 'interview_answers' AND column_name IN
        ('answered_at', 'locked_at', 'evaluation_provider', 'evaluation_model'))`,
  );
  assert.equal(cols.rows.length, 12);
});

test("db: teardown closes the pool", async () => {
  await pool.end();
});
