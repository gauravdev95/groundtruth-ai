import { Worker } from "bullmq";
import { redisConnection } from "../config/queue";
import { QUEUE_NAMES } from "../queues";
import { processGithubAnalysis } from "./githubAnalysis";
import { processLlmParsing } from "./llmParsing";
import { processVectorReembedding } from "./vectorReembedding";

// Phase 0: workers run inside the server process (started from src/index.ts).
// Phase 1 splits them into standalone worker processes.
const workers = [
  new Worker(QUEUE_NAMES.githubAnalysis, processGithubAnalysis, {
    connection: redisConnection,
    concurrency: 5,
  }),
  new Worker(QUEUE_NAMES.llmParsing, processLlmParsing, {
    connection: redisConnection,
    concurrency: 3,
  }),
  new Worker(QUEUE_NAMES.vectorReembedding, processVectorReembedding, {
    connection: redisConnection,
    concurrency: 5,
  }),
];

for (const worker of workers) {
  worker.on("failed", (job, err) => {
    console.error(`[worker:${worker.name}] job ${job?.id} failed:`, err.message);
  });
}

export async function closeWorkers(): Promise<void> {
  await Promise.all(workers.map((w) => w.close()));
}

export { workers };
