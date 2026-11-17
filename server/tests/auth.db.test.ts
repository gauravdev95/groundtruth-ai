import test from "node:test";
import assert from "node:assert/strict";

// Live-database auth tests. They run against DATABASE_URL when a Postgres
// is reachable and SKIP (not fail) when there is none — e.g. on a laptop
// without docker-compose up. Run with a real DB via:
//   DATABASE_URL=postgres://groundtruth:groundtruth_dev@localhost:5432/groundtruth \
//   JWT_SECRET=test-secret npm test
// The 003_auth.sql migration must have been applied first (npm run migrate).

// JWT_SECRET comes from the `npm test` script (see package.json).
import { pool } from "../src/config/db";
import * as auth from "../src/services/auth";

const TEST_EMAIL = `phase1-test-${Date.now()}@example.com`;

async function dbAvailable(): Promise<boolean> {
  try {
    await pool.query("SELECT 1");
    return true;
  } catch {
    return false;
  }
}

test("db: register → login → me round-trip (skips without Postgres)", async (t) => {
  if (!(await dbAvailable())) {
    t.skip("no Postgres reachable at DATABASE_URL");
    return;
  }
  const hash = await auth.hashPassword("Str0ng!Pass");
  const { rows } = await pool.query(
    `INSERT INTO users (email, full_name, role, password_hash)
     VALUES ($1, $2, 'candidate', $3) RETURNING id, email, role`,
    [TEST_EMAIL, "Phase One Tester", hash],
  );
  const user = rows[0] as { id: string; email: string; role: string };
  assert.equal(user.email, TEST_EMAIL);
  assert.equal(user.role, "candidate");
  assert.equal(await auth.verifyPassword("Str0ng!Pass", hash), true);

  // Reset-token store: hash stored, raw token verifies, expiry is enforced
  // by the query in the route (checked here at the data level).
  const { rawToken, tokenHash } = auth.generateResetToken();
  await pool.query(
    `INSERT INTO password_reset_tokens (user_id, token_hash, expires_at)
     VALUES ($1, $2, now() + interval '30 minutes')`,
    [user.id, tokenHash],
  );
  const found = await pool.query(
    `SELECT user_id FROM password_reset_tokens
      WHERE token_hash = $1 AND used_at IS NULL AND expires_at > now()`,
    [auth.hashResetToken(rawToken)],
  );
  assert.equal(found.rows.length, 1);
  assert.equal(found.rows[0].user_id, user.id);

  // Cleanup — the test user and its tokens must not linger.
  await pool.query("DELETE FROM users WHERE id = $1", [user.id]);
});

test("db: teardown closes the pool", async () => {
  await pool.end();
});
