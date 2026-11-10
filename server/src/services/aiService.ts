import { env } from "../config/env";

// Thin HTTP client for the Python ai-service. All calls are server-to-server;
// failures are reported honestly to the caller (workers log + retry via BullMQ).

async function post<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`${env.aiServiceUrl}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`ai-service ${path} failed (${res.status}): ${text.slice(0, 300)}`);
  }
  return res.json() as Promise<T>;
}

export interface EmbedResponse {
  embedding: number[];
  dim: number;
  model: string;
}
export function embedText(
  text: string,
  ownerType: string,
  ownerId: string,
): Promise<EmbedResponse> {
  return post<EmbedResponse>("/embed", { text, owner_type: ownerType, owner_id: ownerId });
}

export interface ParseResumeResponse {
  text: string;
  skills: string[];
  char_count: number;
}
export function parseResume(cloudinaryUrl: string): Promise<ParseResumeResponse> {
  return post<ParseResumeResponse>("/parse-resume", { cloudinary_url: cloudinaryUrl });
}

export interface AnalyzeRepoResponse {
  repo_url: string;
  languages: Record<string, number>;
  file_count: number;
  commit_count: number | null;
  default_branch: string | null;
}
export function analyzeRepo(repoUrl: string): Promise<AnalyzeRepoResponse> {
  return post<AnalyzeRepoResponse>("/analyze-repo", { repo_url: repoUrl });
}

export interface MatchResponse {
  candidate_id: string;
  job_id: string;
  score: number;
  model: string;
}
export function matchCandidateToJob(
  candidateId: string,
  jobId: string,
): Promise<MatchResponse> {
  return post<MatchResponse>("/match", { candidate_id: candidateId, job_id: jobId });
}
