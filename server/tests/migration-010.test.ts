import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";

// Phase B — migration 010 (competency framework). Applies the 010 file
// against DATABASE_URL when a Postgres is reachable and SKIPS (not fails)
// when there is none, following the existing DB-test convention
// (see tests/auth.db.test.ts). The 000–009 migrations must have been
// applied first (npm run migrate) for the full-migrate check; the 010-only
// checks below work on their own because 010 creates its own tables.

import { pool } from "../src/config/db";

const MIGRATION_010 = path.resolve(
  __dirname,
  "..",
  "..",
  "infra",
  "postgres",
  "010_competency_framework.sql",
);

async function dbAvailable(): Promise<boolean> {
  try {
    await pool.query("SELECT 1");
    return true;
  } catch {
    return false;
  }
}

test("db: migration 010 applies, seeds v1.0.0, and is idempotent (skips without Postgres)", async (t) => {
  if (!(await dbAvailable())) {
    t.skip("no Postgres reachable at DATABASE_URL");
    return;
  }
  const sql = await readFile(MIGRATION_010, "utf8");
  await pool.query(sql);
  await pool.query(sql); // second run must be a no-op (idempotent)

  const tables = await pool.query(
    `SELECT table_name FROM information_schema.tables
      WHERE table_name IN ('competency_frameworks', 'competencies', 'role_competency_mappings', 'competency_results')`,
  );
  assert.equal(tables.rows.length, 4);

  const fw = await pool.query(
    `SELECT version, categories, component_weights, practical_minimum_coding_score
       FROM competency_frameworks WHERE version = 'v1.0.0'`,
  );
  assert.equal(fw.rows.length, 1);
  assert.equal(fw.rows[0].categories.length, 4);
  assert.deepEqual(fw.rows[0].categories.map((c: { id: string }) => c.id), [
    "L1",
    "L2",
    "L3",
    "L4",
  ]);
  assert.deepEqual(fw.rows[0].component_weights, { coding: 0.5, interview: 0.3, evidence: 0.2 });
  assert.equal(Number(fw.rows[0].practical_minimum_coding_score), 40);

  const compCount = await pool.query(`SELECT COUNT(*)::int AS n FROM competencies`);
  assert.equal(compCount.rows[0].n, 35); // 7 roles x 5 competencies

  const roles = await pool.query(
    `SELECT role_id, COUNT(*)::int AS n, SUM(weight)::numeric AS total
       FROM role_competency_mappings WHERE framework_version = 'v1.0.0'
      GROUP BY role_id ORDER BY role_id`,
  );
  assert.equal(roles.rows.length, 7);
  for (const r of roles.rows) {
    assert.equal(r.n, 5, `role ${r.role_id} should map 5 competencies`);
    assert.equal(Number(r.total), 100, `role ${r.role_id} weights must sum to 100`);
  }

  // A historical result row references its framework version.
  const inserted = await pool.query(
    `INSERT INTO competency_results
       (candidate_id, role_id, framework_version, overall_score, overall_category, status, component_scores, result)
     VALUES (NULL, 'backend-developer', 'v1.0.0', 78.00, 'L3', 'Complete',
             '{"coding": 80, "interview": 60, "evidence": 100}'::jsonb, '{}'::jsonb)
     RETURNING id, framework_version`,
  );
  assert.equal(inserted.rows[0].framework_version, "v1.0.0");
  await pool.query(`DELETE FROM competency_results WHERE id = $1`, [inserted.rows[0].id]);
});
