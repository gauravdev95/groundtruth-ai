import type { Job } from "bullmq";
import { pool } from "../config/db";
import { parseResume } from "../services/aiService";
import type { ResumeParsingPayload } from "../queues";

// Worker for the `llm-parsing` queue: parses the resume via ai-service,
// stores the extracted text, and upserts the detected skills with
// source='resume'. After parsing, the candidate is queued for re-embedding
// so the new text becomes searchable.
export async function processLlmParsing(job: Job<ResumeParsingPayload>): Promise<void> {
  const { resumeId, cloudinaryUrl } = job.data;
  console.log(`[llm-parsing] job ${job.id} start resume=${resumeId}`);
  const parsed = await parseResume(cloudinaryUrl);

  const { rows } = await pool.query(
    `UPDATE resumes SET extracted_text = $1 WHERE id = $2 RETURNING candidate_id`,
    [parsed.text, resumeId],
  );
  if (rows.length === 0) {
    throw new Error(`resume ${resumeId} not found`);
  }
  const candidateId = (rows[0] as { candidate_id: string }).candidate_id;

  for (const skillName of parsed.skills) {
    const skill = await pool.query(
      `INSERT INTO skills (name) VALUES ($1)
       ON CONFLICT (name) DO UPDATE SET name = EXCLUDED.name RETURNING id`,
      [skillName],
    );
    const skillId = (skill.rows[0] as { id: string }).id;
    await pool.query(
      `INSERT INTO candidate_skills (candidate_id, skill_id, source)
       VALUES ($1, $2, 'resume') ON CONFLICT (candidate_id, skill_id, source) DO NOTHING`,
      [candidateId, skillId],
    );
  }
  console.log(
    `[llm-parsing] job ${job.id} done resume=${resumeId} skills=${parsed.skills.length} chars=${parsed.char_count}`,
  );
}
