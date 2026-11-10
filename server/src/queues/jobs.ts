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

export function enqueueGithubAnalysis(
  repoUrl: string,
  candidateId: string,
): Promise<Job<GithubAnalysisPayload>> {
  return githubAnalysisQueue.add("analyze", { repoUrl, candidateId });
}

export function enqueueResumeParsing(
  resumeId: string,
  cloudinaryUrl: string,
): Promise<Job<ResumeParsingPayload>> {
  return llmParsingQueue.add("parse", { resumeId, cloudinaryUrl });
}

export function enqueueReembedding(
  ownerType: ReembeddingPayload["ownerType"],
  ownerId: string,
): Promise<Job<ReembeddingPayload>> {
  return vectorReembeddingQueue.add("reembed", { ownerType, ownerId });
}
