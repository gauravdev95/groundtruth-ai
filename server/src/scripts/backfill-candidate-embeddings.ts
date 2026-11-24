import { pool } from "../config/db";
import { allQueues } from "../queues";
import { enqueueReembedding } from "../queues/jobs";

/**
 * Backfill candidate embeddings (Phase 8 fix follow-up).
 *
 * Candidates never got an embedding before the PUT /profile fix: the
 * vector-reembedding queue was only fed by job creation, so POST /match
 * could never score a real candidate/job pair. This script enqueues
 * re-embedding for every candidate that has embeddable content
 * (headline, summary, or at least one skill) and no embedding row yet.
 *
 * Idempotent and safe to re-run: candidates that already have an
 * embedding are skipped. Enqueueing never blocks on the worker — the
 * worker upserts the vector when it runs.
 *
 * Usage (LOCAL database only unless the user explicitly approves a
 * production run — the queue is Redis-backed, so point DATABASE_URL and
 * REDIS_URL at the intended environment):
 *   cd server
 *   DATABASE_URL=... REDIS_URL=... npx tsx src/scripts/backfill-candidate-embeddings.ts [--limit N] [--dry-run]
 *
 * --limit N  : enqueue at most N candidates (default 100).
 * --dry-run  : list what would be enqueued, enqueue nothing.
 */
async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const dryRun = args.includes("--dry-run");
  const limitEq = args.find((a) => a.startsWith("--limit="));
  const limitIdx = args.indexOf("--limit");
  const limit = limitEq
    ? Number(limitEq.split("=")[1]) || 100
    : limitIdx >= 0 && args[limitIdx + 1]
      ? Number(args[limitIdx + 1]) || 100
      : 100;

  const { rows } = await pool.query<{ id: string; email: string }>(
    `SELECT c.id, u.email
       FROM candidates c
       JOIN users u ON u.id = c.user_id
      WHERE NOT EXISTS (
        SELECT 1 FROM embeddings e
         WHERE e.owner_type = 'candidate' AND e.owner_id = c.id
      )
        AND (
          NULLIF(BTRIM(COALESCE(c.headline, '')), '') IS NOT NULL
          OR NULLIF(BTRIM(COALESCE(c.summary, '')), '') IS NOT NULL
          OR EXISTS (SELECT 1 FROM candidate_skills cs WHERE cs.candidate_id = c.id)
        )
      ORDER BY c.created_at ASC
      LIMIT $1`,
    [limit],
  );
  console.log(`[backfill] ${rows.length} candidate(s) without embeddings (limit ${limit})`);
  if (dryRun) {
    for (const r of rows) console.log(`[backfill] would enqueue ${r.id} (${r.email})`);
    console.log("[backfill] dry run — nothing enqueued");
    return;
  }
  let enqueued = 0;
  for (const r of rows) {
    try {
      await enqueueReembedding("candidate", r.id);
      enqueued += 1;
    } catch (err) {
      console.error(`[backfill] failed to enqueue ${r.id}:`, err);
    }
  }
  console.log(`[backfill] enqueued ${enqueued}/${rows.length}`);
}

main()
  .catch((err) => {
    console.error("[backfill] failed", err);
    process.exit(1);
  })
  .finally(async () => {
    // BullMQ Queue instances hold a persistent Redis connection — without
    // closing them the script hangs forever after the work is done.
    await Promise.all(allQueues.map((q) => q.close())).catch(() => undefined);
    await pool.end();
  });
