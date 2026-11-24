import test, { after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";

// Duplicate-prevention tests (Phase 2 fix, 23 Nov 2026): every enqueue
// helper must dedupe the same entity — the second add returns the SAME
// job instead of queueing duplicate work. Needs a live local Redis
// (REDIS_URL defaults to redis://localhost:6379); no Postgres involved.
// Each queue is paused first so the workers cannot consume the test job
// mid-assert, and every test job is removed afterwards.
import {
  enqueueGithubAnalysis,
  enqueueReembedding,
  enqueueResumeParsing,
} from "../src/queues/jobs";
import {
  githubAnalysisQueue,
  llmParsingQueue,
  vectorReembeddingQueue,
} from "../src/queues/index";
import { redisConnection } from "../src/config/queue";

// Close the test process's own Redis connections so the runner can exit
// (the Queue instances + shared connection otherwise keep the event loop
// alive forever — the server's own queues/workers are unaffected).
after(async () => {
  await githubAnalysisQueue.close();
  await llmParsingQueue.close();
  await vectorReembeddingQueue.close();
  redisConnection.disconnect();
});

async function withPausedQueue<T>(
  queue: typeof vectorReembeddingQueue,
  fn: () => Promise<T>,
): Promise<T> {
  await queue.pause();
  try {
    return await fn();
  } finally {
    await queue.resume();
  }
}

test("re-embedding: same candidate twice returns the same job (no duplicate)", async () => {
  const ownerId = randomUUID();
  await withPausedQueue(vectorReembeddingQueue, async () => {
    const a = await enqueueReembedding("candidate", ownerId);
    const b = await enqueueReembedding("candidate", ownerId);
    assert.equal(a.id, b.id, "second enqueue must return the existing job");
    assert.equal(await vectorReembeddingQueue.getWaitingCount(), 1);
    await a.remove();
  });
});

test("re-embedding: different candidates get different jobs (no over-dedup)", async () => {
  await withPausedQueue(vectorReembeddingQueue, async () => {
    const a = await enqueueReembedding("candidate", randomUUID());
    const b = await enqueueReembedding("candidate", randomUUID());
    assert.notEqual(a.id, b.id);
    assert.equal(await vectorReembeddingQueue.getWaitingCount(), 2);
    await a.remove();
    await b.remove();
  });
});

test("re-embedding: candidate and job with the same id are distinct", async () => {
  const id = randomUUID();
  await withPausedQueue(vectorReembeddingQueue, async () => {
    const a = await enqueueReembedding("candidate", id);
    const b = await enqueueReembedding("job", id);
    assert.notEqual(a.id, b.id);
    await a.remove();
    await b.remove();
  });
});

test("resume parsing: same resume twice returns the same job", async () => {
  const resumeId = randomUUID();
  await withPausedQueue(llmParsingQueue, async () => {
    const a = await enqueueResumeParsing(resumeId, "https://example.dev/r.pdf");
    const b = await enqueueResumeParsing(resumeId, "https://example.dev/r.pdf");
    assert.equal(a.id, b.id, "second enqueue must return the existing job");
    assert.equal(await llmParsingQueue.getWaitingCount(), 1);
    await a.remove();
  });
});

test("github analysis: same repo + candidate twice returns the same job", async () => {
  const candidateId = randomUUID();
  const repoUrl = "https://github.com/octocat/Hello-World";
  await withPausedQueue(githubAnalysisQueue, async () => {
    const a = await enqueueGithubAnalysis(repoUrl, candidateId);
    const b = await enqueueGithubAnalysis(repoUrl, candidateId);
    assert.equal(a.id, b.id, "second enqueue must return the existing job");
    assert.equal(await githubAnalysisQueue.getWaitingCount(), 1);
    await a.remove();
  });
});

test("github analysis: same candidate, different repo gets a different job", async () => {
  const candidateId = randomUUID();
  await withPausedQueue(githubAnalysisQueue, async () => {
    const a = await enqueueGithubAnalysis("https://github.com/octocat/Hello-World", candidateId);
    const b = await enqueueGithubAnalysis("https://github.com/octocat/Spoon-Knife", candidateId);
    assert.notEqual(a.id, b.id);
    await a.remove();
    await b.remove();
  });
});
