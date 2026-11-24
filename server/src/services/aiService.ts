import { env } from "../config/env";

// Thin HTTP client for the Python ai-service. All calls are server-to-server;
// failures are reported honestly to the caller (workers log + retry via BullMQ).
//
// Every call is bounded: a 30s timeout (AI_SERVICE_TIMEOUT_MS, default
// 30000) via AbortSignal, and ONE retry on a network failure or a
// retryable 502/503/504 from ai-service. Without the timeout a hung
// ai-service would hang the Express request / BullMQ worker indefinitely
// (Node fetch has no default timeout) — found 23 Nov 2026.
async function post<T>(path: string, body: unknown): Promise<T> {
  const timeoutMs = env.aiServiceTimeoutMs;
  let lastError: Error | null = null;
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const res = await fetch(`${env.aiServiceUrl}${path}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (!res.ok) {
        const text = await res.text().catch(() => "");
        const retryable = res.status === 502 || res.status === 503 || res.status === 504;
        if (retryable && attempt === 1) {
          console.error(`[ai-service] ${path} returned ${res.status} — retrying once`);
          await new Promise((resolve) => setTimeout(resolve, 500));
          continue;
        }
        throw new Error(`ai-service ${path} failed (${res.status}): ${text.slice(0, 300)}`);
      }
      return res.json() as Promise<T>;
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
      const isTimeout = lastError.name === "TimeoutError";
      if (attempt === 1 && (isTimeout || lastError.message.includes("fetch failed"))) {
        console.error(
          `[ai-service] ${path} ${isTimeout ? "timed out" : "fetch failed"} after ${timeoutMs}ms — retrying once`,
        );
        await new Promise((resolve) => setTimeout(resolve, 500));
        continue;
      }
      throw lastError;
    }
  }
  throw lastError ?? new Error(`ai-service ${path} failed`);
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
