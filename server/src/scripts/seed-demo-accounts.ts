import { pool } from "../config/db";
import { hashPassword } from "../services/auth";

/**
 * Seed the two demo accounts (Phase 4).
 *
 *   demo.student@groundtruth.dev   (role: candidate / "student")
 *   demo.recruiter@groundtruth.dev (role: recruiter, with a demo company)
 *
 * Passwords come ONLY from the environment — never hardcoded, never logged:
 *   DEMO_STUDENT_PASSWORD   (required)
 *   DEMO_RECRUITER_PASSWORD (required)
 * Emails / names / company can be overridden, but default to the addresses
 * above:
 *   DEMO_STUDENT_EMAIL, DEMO_RECRUITER_EMAIL,
 *   DEMO_STUDENT_NAME, DEMO_RECRUITER_NAME, DEMO_COMPANY_NAME
 *
 * Idempotent and safe to re-run: each account is created only when its
 * email is absent. When an account already exists it is left completely
 * untouched (password NOT reset, role NOT changed) and reported as
 * "exists, skipped" — so re-running can never lock anyone out or create
 * a duplicate. The recruiter's company row is likewise created only when
 * the recruiter has no company yet.
 *
 * Usage (LOCAL database only — never point this at production without the
 * user's explicit approval, and never run it with a production DATABASE_URL
 * from this repo):
 *   cd server
 *   DATABASE_URL=postgres://postgres@127.0.0.1:5432/<db> \
 *     DEMO_STUDENT_PASSWORD='...' DEMO_RECRUITER_PASSWORD='...' \
 *     npm run seed:demo
 */
interface DemoAccount {
  email: string;
  fullName: string;
  role: "candidate" | "recruiter";
  companyName: string | null;
  password: string;
}

function requiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(
      `${name} is not set — demo passwords must come from the environment. ` +
        `Refusing to seed with a default or empty password.`,
    );
  }
  return value;
}

async function seedOne(account: DemoAccount): Promise<"created" | "exists"> {
  const existing = await pool.query<{ id: string; role: string }>(
    "SELECT id, role FROM users WHERE email = $1",
    [account.email],
  );
  if (existing.rows.length > 0) {
    const row = existing.rows[0]!;
    if (row.role !== account.role) {
      console.log(
        `[seed:demo] ${account.email} already exists with role '${row.role}' ` +
          `(expected '${account.role}') — left untouched, NOT changed.`,
      );
    } else {
      console.log(`[seed:demo] ${account.email} already exists — skipped.`);
    }
    return "exists";
  }

  const passwordHash = await hashPassword(account.password);
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const { rows } = await client.query<{ id: string }>(
      `INSERT INTO users (email, full_name, role, password_hash)
       VALUES ($1, $2, $3, $4) RETURNING id`,
      [account.email, account.fullName, account.role, passwordHash],
    );
    const userId = rows[0]!.id;
    if (account.role === "recruiter" && account.companyName) {
      await client.query(
        `INSERT INTO companies (name, created_by) VALUES ($1, $2)
         ON CONFLICT DO NOTHING`,
        [account.companyName, userId],
      );
    }
    await client.query("COMMIT");
    console.log(`[seed:demo] ${account.email} created (${account.role}).`);
    return "created";
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

async function main(): Promise<void> {
  const accounts: DemoAccount[] = [
    {
      email: process.env.DEMO_STUDENT_EMAIL ?? "demo.student@groundtruth.dev",
      fullName: process.env.DEMO_STUDENT_NAME ?? "Demo Student",
      role: "candidate",
      companyName: null,
      password: requiredEnv("DEMO_STUDENT_PASSWORD"),
    },
    {
      email:
        process.env.DEMO_RECRUITER_EMAIL ?? "demo.recruiter@groundtruth.dev",
      fullName: process.env.DEMO_RECRUITER_NAME ?? "Demo Recruiter",
      role: "recruiter",
      companyName: process.env.DEMO_COMPANY_NAME ?? "Demo Company",
      password: requiredEnv("DEMO_RECRUITER_PASSWORD"),
    },
  ];
  for (const account of accounts) {
    await seedOne(account);
  }
  console.log("[seed:demo] done");
}

main()
  .catch((err) => {
    console.error("[seed:demo] failed", (err as Error).message);
    process.exit(1);
  })
  .finally(() => void pool.end());
