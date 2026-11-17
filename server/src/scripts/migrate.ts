import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { Pool } from "pg";
import { env } from "../config/env";

/**
 * Applies every `infra/postgres/*.sql` file in filename order against
 * DATABASE_URL. Each migration file is written idempotently
 * (CREATE TABLE IF NOT EXISTS, CREATE INDEX IF NOT EXISTS), so re-running
 * is safe. Usage: `npm run migrate` from server/.
 *
 * Note: docker-compose only runs these files on FIRST database init
 * (mounted into /docker-entrypoint-initdb.d). For an existing database,
 * this script is how later migrations (003_auth.sql and beyond) land.
 */
async function main(): Promise<void> {
  // src/scripts/migrate.ts → repo root is three levels up.
  const dir = path.resolve(__dirname, "..", "..", "..", "infra", "postgres");
  const files = (await readdir(dir))
    .filter((f) => f.endsWith(".sql"))
    .sort();
  if (files.length === 0) {
    console.log("[migrate] no .sql files found in", dir);
    return;
  }
  const pool = new Pool({ connectionString: env.databaseUrl });
  try {
    for (const file of files) {
      const sql = await readFile(path.join(dir, file), "utf8");
      console.log(`[migrate] applying ${file} ...`);
      await pool.query(sql);
      console.log(`[migrate] ${file} ok`);
    }
    console.log("[migrate] done");
  } finally {
    await pool.end();
  }
}

main().catch((err) => {
  console.error("[migrate] failed", err);
  process.exit(1);
});
