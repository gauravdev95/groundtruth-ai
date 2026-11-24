import type { Job } from "bullmq";
import { pool } from "../config/db";
import { embedText } from "../services/aiService";
import type { ReembeddingPayload } from "../queues";

// Worker for the `vector-reembedding` queue: loads the owner's text
// (candidate summary + skills, or job title + description), embeds it via
// ai-service, and upserts the vector into the embeddings table.
export async function processVectorReembedding(job: Job<ReembeddingPayload>): Promise<void> {
  const { ownerType, ownerId } = job.data;
  console.log(`[vector-reembedding] job ${job.id} start owner=${ownerType}:${ownerId}`);

  let text: string;
  if (ownerType === "candidate") {
    const { rows } = await pool.query(
      `SELECT c.summary, c.headline,
              COALESCE(string_agg(s.name, ', '), '') AS skills
       FROM candidates c
       LEFT JOIN candidate_skills cs ON cs.candidate_id = c.id
       LEFT JOIN skills s ON s.id = cs.skill_id
       WHERE c.id = $1 GROUP BY c.id`,
      [ownerId],
    );
    if (rows.length === 0) throw new Error(`candidate ${ownerId} not found`);
    const row = rows[0] as { summary: string | null; headline: string | null; skills: string };
    text = [row.headline, row.summary, row.skills].filter(Boolean).join("\n");
  } else {
    const { rows } = await pool.query(
      `SELECT j.title, j.description,
              COALESCE(string_agg(s.name, ', '), '') AS skills
       FROM jobs j
       LEFT JOIN job_skills js ON js.job_id = j.id
       LEFT JOIN skills s ON s.id = js.skill_id
       WHERE j.id = $1 GROUP BY j.id`,
      [ownerId],
    );
    if (rows.length === 0) throw new Error(`job ${ownerId} not found`);
    const row = rows[0] as { title: string; description: string; skills: string };
    text = [row.title, row.description, row.skills].filter(Boolean).join("\n");
  }
  if (!text.trim()) throw new Error(`nothing to embed for ${ownerType}:${ownerId}`);

  const { embedding, model } = await embedText(text, ownerType, ownerId);
  // pgvector accepts a JS array as a vector literal via the pg driver.
  await pool.query(
    `INSERT INTO embeddings (owner_type, owner_id, embedding, model)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (owner_type, owner_id, model)
     DO UPDATE SET embedding = EXCLUDED.embedding, created_at = now()`,
    [ownerType, ownerId, JSON.stringify(embedding), model],
  );
  console.log(`[vector-reembedding] job ${job.id} done owner=${ownerType}:${ownerId} model=${model}`);
}
