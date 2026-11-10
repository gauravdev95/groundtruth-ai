import type { Job } from "bullmq";
import { pool } from "../config/db";
import { analyzeRepo } from "../services/aiService";
import type { GithubAnalysisPayload } from "../queues";

// Worker for the `github-analysis` queue: calls ai-service to analyse the
// repo, then stores the result as a verification_results row. No data is
// invented — whatever /analyze-repo returns is what gets stored.
export async function processGithubAnalysis(job: Job<GithubAnalysisPayload>): Promise<void> {
  const { repoUrl, candidateId } = job.data;
  console.log(`[github-analysis] job ${job.id} start repo=${repoUrl} candidate=${candidateId}`);
  const result = await analyzeRepo(repoUrl);
  await pool.query(
    `INSERT INTO verification_results (candidate_id, source, source_ref, result)
     VALUES ($1, 'github', $2, $3)`,
    [candidateId, repoUrl, JSON.stringify(result)],
  );
  console.log(`[github-analysis] job ${job.id} done repo=${repoUrl} files=${result.file_count}`);
}
