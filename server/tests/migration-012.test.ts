import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";

// Phase E — migration 012 (final competency profiles). Applies the 012
// file against DATABASE_URL when a Postgres is reachable and SKIPS (not
// fails) when there is none, following the existing DB-test convention
// (see tests/auth.db.test.ts). Migrations 000–011 must have been applied
// first (npm run migrate) — 012 only extends the 010 competency_results
// table.

import { pool } from "../src/config/db";

const MIGRATION_012 = path.resolve(
  __dirname,
  "..",
  "..",
  "infra",
  "postgres",
  "012_competency_profiles.sql",
);

async function dbAvailable(): Promise<boolean> {
  try {
    await pool.query("SELECT 1");
    return true;
  } catch {
    return false;
  }
}

test("db: migration 012 applies, extends competency_results, and is idempotent (skips without Postgres)", async (t) => {
  if (!(await dbAvailable())) {
    t.skip("no Postgres reachable at DATABASE_URL");
    return;
  }
  const sql = await readFile(MIGRATION_012, "utf8");
  await pool.query(sql);
  await pool.query(sql); // second run must be a no-op (idempotent)

  const columns = await pool.query(
    `SELECT column_name FROM information_schema.columns
      WHERE table_name = 'competency_results'
        AND column_name IN ('assessment_id', 'interview_id', 'evaluation_id', 'inputs_hash')`,
  );
  assert.equal(columns.rows.length, 4, "012 adds all four columns");

  const index = await pool.query(
    `SELECT indexname FROM pg_indexes
      WHERE tablename = 'competency_results'
        AND indexname = 'idx_competency_results_assessment_version'`,
  );
  assert.equal(index.rows.length, 1, "one-profile-per-(assessment, version) unique index exists");
  const uniqueness = await pool.query(
    `SELECT indexdef FROM pg_indexes
      WHERE tablename = 'competency_results'
        AND indexname = 'idx_competency_results_assessment_version'`,
  );
  assert.ok(
    (uniqueness.rows[0].indexdef as string).includes("UNIQUE"),
    "the (assessment_id, framework_version) index is UNIQUE",
  );

  const trigger = await pool.query(
    `SELECT tgname FROM pg_trigger WHERE tgname = 'trg_competency_results_immutable'`,
  );
  assert.equal(trigger.rows.length, 1, "immutability trigger exists");
});

test("db: stored competency profiles are immutable (UPDATE rejected, DELETE allowed)", async (t) => {
  if (!(await dbAvailable())) {
    t.skip("no Postgres reachable at DATABASE_URL");
    return;
  }
  const inserted = await pool.query(
    `INSERT INTO competency_results
       (candidate_id, role_id, framework_version, overall_score, overall_category,
        status, component_scores, result)
     VALUES (NULL, 'backend-developer', 'v1.0.0', 85, 'L4', 'Complete', '{}'::jsonb, '{}'::jsonb)
     RETURNING id`,
  );
  const id = inserted.rows[0].id as string;
  try {
    let err: unknown;
    try {
      await pool.query(
        `UPDATE competency_results SET overall_score = 10 WHERE id = $1`,
        [id],
      );
    } catch (e) {
      err = e;
    }
    assert.ok(err instanceof Error, "UPDATE must be rejected");
    assert.match(
      (err as Error).message,
      /immutable/,
      "rejection names immutability",
    );
  } finally {
    // DELETE is allowed (cleanup + parent-erase path).
    await pool.query(`DELETE FROM competency_results WHERE id = $1`, [id]);
  }
  const gone = await pool.query(`SELECT 1 FROM competency_results WHERE id = $1`, [id]);
  assert.equal(gone.rows.length, 0, "DELETE works");
});
