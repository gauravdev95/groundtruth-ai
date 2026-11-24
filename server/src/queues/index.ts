import { Queue } from "bullmq";
import { redisConnection } from "../config/queue";

// Queue names — exact strings, shared with workers and enqueue helpers.
export const QUEUE_NAMES = {
  githubAnalysis: "github-analysis",
  llmParsing: "llm-parsing",
  vectorReembedding: "vector-reembedding",
} as const;

// Default job options for every queue: 3 attempts, exponential backoff
// (2s, 4s, 8s), keep completed/failed jobs bounded so Redis stays small.
const defaultJobOptions = {
  attempts: 3,
  backoff: { type: "exponential" as const, delay: 2000 },
  removeOnComplete: { count: 100 },
  removeOnFail: { count: 100 },
};

export interface GithubAnalysisPayload {
  repoUrl: string;
  candidateId: string;
}
export interface ResumeParsingPayload {
  resumeId: string;
  cloudinaryUrl: string;
}
export interface ReembeddingPayload {
  ownerType: "candidate" | "job";
  ownerId: string;
}

export const githubAnalysisQueue = new Queue<GithubAnalysisPayload>(
  QUEUE_NAMES.githubAnalysis,
  { connection: redisConnection, defaultJobOptions },
);
export const llmParsingQueue = new Queue<ResumeParsingPayload>(
  QUEUE_NAMES.llmParsing,
  { connection: redisConnection, defaultJobOptions },
);
export const vectorReembeddingQueue = new Queue<ReembeddingPayload>(
  QUEUE_NAMES.vectorReembedding,
  { connection: redisConnection, defaultJobOptions },
);

export const allQueues = [githubAnalysisQueue, llmParsingQueue, vectorReembeddingQueue];
