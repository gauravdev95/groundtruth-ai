import test from "node:test";
import assert from "node:assert/strict";

// Race-safety test for getOrCreateCandidateForUser (fixed 23 Nov 2026):
// concurrent first-requests for a fresh user used to race the
// check-then-insert and one died with 23505 (candidates_email_key) → 500.
// Follows the other DB tests: runs against DATABASE_URL when Postgres is
// reachable and SKIPS when there is none.
import { pool } from "../src/config/db";
import * as auth from "../src/services/auth";
import { getOrCreateCandidateForUser } from "../src/services/student";

async function dbAvailable(): Promise<boolean> {
  try {
    await pool.query("SELECT 1");
    return true;
  } catch {
    return false;
  }
}

test("concurrent getOrCreateCandidateForUser: one row, same id, no 23505", async (t) => {
  if (!(await dbAvailable())) {
    t.skip("no Postgres reachable at DATABASE_URL");
    return;
  }
  const email = `race-test-${Date.now()}@example.dev`;
  const hash = await auth.hashPassword("Str0ng!Pass");
  const { rows: userRows } = await pool.query<{ id: string }>(
    `INSERT INTO users (email, full_name, role, password_hash)
     VALUES ($1, $2, 'candidate', $3) RETURNING id`,
    [email, "Race Tester", hash],
  );
  const userId = (userRows[0] as { id: string }).id;
  try {
    const results = await Promise.all(
      Array.from({ length: 5 }, () =>
        getOrCreateCandidateForUser(userId, email, "Race Tester"),
      ),
    );
    const ids = new Set(results.map((r) => r.id));
    assert.equal(ids.size, 1, "all five concurrent calls must return the same candidate");
    const { rows: countRows } = await pool.query<{ n: string }>(
      "SELECT count(*)::text AS n FROM candidates WHERE user_id = $1",
      [userId],
    );
    assert.equal((countRows[0] as { n: string }).n, "1", "exactly one candidate row must exist");
  } finally {
    await pool.query("DELETE FROM candidates WHERE user_id = $1", [userId]);
    await pool.query("DELETE FROM users WHERE id = $1", [userId]);
  }
});
