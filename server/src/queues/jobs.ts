import { createHash } from "node:crypto";
import type { Job } from "bullmq";
import {
  githubAnalysisQueue,
  llmParsingQueue,
  vectorReembeddingQueue,
  type GithubAnalysisPayload,
  type ReembeddingPayload,
  type ResumeParsingPayload,
} from "./index";

// Enqueue helpers — the only way routes add background work. Each returns
// the BullMQ job so the caller can report its id (202 + jobId).
//
// Duplicate prevention (fixed 23 Nov 2026, ultimate mission Phase 2 —
// Gaurav's follow-up): the helpers previously called `.add()` with no
// dedup key, so a double-click / double profile-save / retry queued the
// same work twice. Every helper now passes BullMQ `deduplication`:
//   - re-embedding + GitHub analysis use `keepLastIfActive: true`: while a
//     job for the entity is running, a new request stores the latest data
//     and one follow-up job runs when the active one finishes — at most
//     1 active + 1 waiting per entity, and no update is ever lost.
//   - resume parsing uses a 60s `ttl`: the same resume row is never
//     parsed twice in a row (a re-upload creates a new resume row, so it
//     still gets its own job).
// Deliberately NOT a fixed `jobId`: a jobId would make a FAILED job block
// re-enqueues until it is pruned from Redis; deduplication with a ttl /
// keepLastIfActive lets a later legitimate re-run create a fresh job.
// Re-embedding itself is idempotent (upsert), so even a duplicate that
// slipped through could not corrupt data — dedup is about wasted work,
// not correctness.

function sha16(input: string): string {
  return createHash("sha256").update(input).digest("hex").slice(0, 16);
}

export function enqueueGithubAnalysis(
  repoUrl: string,
  candidateId: string,
): Promise<Job<GithubAnalysisPayload>> {
  return githubAnalysisQueue.add(
    "analyze",
    { repoUrl, candidateId },
    {
      deduplication: {
        id: `github:${candidateId}:${sha16(repoUrl)}`,
        keepLastIfActive: true,
      },
    },
  );
}

export function enqueueResumeParsing(
  resumeId: string,
  cloudinaryUrl: string,
): Promise<Job<ResumeParsingPayload>> {
  return llmParsingQueue.add(
    "parse",
    { resumeId, cloudinaryUrl },
    { deduplication: { id: `resume:${resumeId}`, ttl: 60_000 } },
  );
}

export function enqueueReembedding(
  ownerType: ReembeddingPayload["ownerType"],
  ownerId: string,
): Promise<Job<ReembeddingPayload>> {
  return vectorReembeddingQueue.add(
    "reembed",
    { ownerType, ownerId },
    {
      deduplication: {
        id: `reembed:${ownerType}:${ownerId}`,
        keepLastIfActive: true,
      },
    },
  );
}
