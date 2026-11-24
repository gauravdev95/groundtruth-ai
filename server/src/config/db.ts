import { Pool } from "pg";
import { env } from "./env";

// Single shared pg Pool. All queries in routes/services must use
// parameterised queries ($1, $2, ...) — never string-interpolated SQL.
export const pool = new Pool({
  connectionString: env.databaseUrl,
  max: 10,
  idleTimeoutMillis: 30_000,
});

pool.on("error", (err) => {
  // A pool error must not crash the process silently; log loudly.
  console.error("[db] idle client error", err);
});

export async function pingDb(): Promise<boolean> {
  try {
    await pool.query("SELECT 1");
    return true;
  } catch (err) {
    console.error("[db] ping failed", err);
    return false;
  }
}
