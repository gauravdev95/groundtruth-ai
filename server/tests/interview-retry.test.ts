import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";

// P0 F3 — interview answer evaluation reliability / retry system.
// Service-level tests against DATABASE_URL when a Postgres is reachable,
// SKIPPING (not failing) when there is none — the existing DB-test
// convention (see tests/auth.db.test.ts). Migrations 000–013 must have
// been applied first (npm run migrate). No live AI is used anywhere:
// the "live" provider here is a local stub HTTP server (no external
// network, no real key), following the stub pattern in tests/llm.test.ts.

import { pool } from "../src/config/db";
import { ApiError } from "../src/middleware/errorHandler";
import { generateInterview } from "../src/services/interview";
import {
  startSession,
  confirmReadiness,
  getSessionState,
  submitSessionAnswer,
  finishSession,
  retryEvaluation,
  classifyEvaluationFailure,
  evaluationRetryDelayMs,
  maxAttemptsForFailureKinds,
  EVALUATION_MAX_ATTEMPTS,
  EVALUATION_MAX_INVALID_RESPONSE_ATTEMPTS,
  EVALUATION_RETRY_MAX_DELAY_MS,
} from "../src/services/interviewSession";
import { resetLlmRateLimit } from "../src/services/llm";

const RUN = Date.now();

async function dbAvailable(): Promise<boolean> {
  try {
    await pool.query("SELECT 1");
    return true;
  } catch {
    return false;
  }
}

async function skipIfNoDb(t: { skip: (msg: string) => void }): Promise<boolean> {
  if (!(await dbAvailable())) {
    t.skip("no Postgres reachable at DATABASE_URL");
    return true;
  }
  return false;
}

function expectApiError(err: unknown, status: number): void {
  assert.ok(err instanceof ApiError, `expected ApiError, got ${String(err)}`);
  assert.equal((err as ApiError).status, status);
}

// ── Pure classification / policy unit tests (no DB) ─────────────────────

test("F3: failure classification distinguishes timeout / 429 / 5xx / network / invalid response", () => {
  assert.equal(
    classifyEvaluationFailure(new Error("LLM request timed out")).kind,
    "timeout",
  );
  const r429 = classifyEvaluationFailure(new Error("LLM provider error: HTTP 429"));
  assert.equal(r429.kind, "rate_limited");
  assert.equal(r429.httpStatus, 429);
  const r500 = classifyEvaluationFailure(new Error("LLM provider error: HTTP 500"));
  assert.equal(r500.kind, "server_error");
  assert.equal(r500.httpStatus, 500);
  const r503 = classifyEvaluationFailure(new Error("LLM provider error: HTTP 503"));
  assert.equal(r503.kind, "server_error");
  assert.equal(
    classifyEvaluationFailure(new Error("LLM request failed: fetch failed")).kind,
    "network_error",
  );
  assert.equal(
    classifyEvaluationFailure(new Error("LLM returned invalid JSON")).kind,
    "invalid_response",
  );
  assert.equal(
    classifyEvaluationFailure(new Error("LLM response failed schema validation")).kind,
    "invalid_response",
  );
  assert.equal(classifyEvaluationFailure(new Error("something else")).kind, "unknown");
});

test("F3: retry policy — 3 attempts transient, 2 for invalid responses; backoff exponential + jitter, capped", () => {
  assert.equal(EVALUATION_MAX_ATTEMPTS, 3);
  assert.equal(EVALUATION_MAX_INVALID_RESPONSE_ATTEMPTS, 2);
  assert.equal(maxAttemptsForFailureKinds([]), 3);
  assert.equal(maxAttemptsForFailureKinds([null]), 3);
  assert.equal(maxAttemptsForFailureKinds(["invalid_response"]), 2);
  assert.equal(maxAttemptsForFailureKinds(["invalid_response", "invalid_response"]), 2);
  assert.equal(maxAttemptsForFailureKinds(["timeout"]), 3);
  assert.equal(maxAttemptsForFailureKinds(["invalid_response", "timeout"]), 3);
  assert.equal(maxAttemptsForFailureKinds(["rate_limited", "server_error"]), 3);

  assert.equal(evaluationRetryDelayMs(1, 1000), 0, "no delay before the first attempt");
  for (let i = 0; i < 20; i++) {
    const d2 = evaluationRetryDelayMs(2, 1000);
    assert.ok(d2 >= 750 && d2 <= 1250, `attempt-2 delay ${d2} must be 1000ms ±25% jitter`);
    const d3 = evaluationRetryDelayMs(3, 1000);
    assert.ok(d3 >= 1500 && d3 <= 2500, `attempt-3 delay ${d3} must be 2000ms ±25% jitter`);
    const d10 = evaluationRetryDelayMs(10, 1000);
    assert.ok(
      d10 >= 6000 && d10 <= EVALUATION_RETRY_MAX_DELAY_MS * 1.25,
      `late-attempt delay ${d10} must be capped at 8000ms ±25% jitter`,
    );
  }
});

// ── Stub + seed helpers (DB tests) ───────────────────────────────────────

type StubMode =
  | { kind: "fail500"; failFirst: number }
  | { kind: "always500" }
  | { kind: "always429" }
  | { kind: "always401" }
  | { kind: "invalidJson" }
  | { kind: "delay"; delayMs: number }
  | { kind: "succeed" }
  | { kind: "succeedAfterDelay"; delayMs: number };

const SCORED_CONTENT = JSON.stringify({
  technicalCorrectness: 80,
  depthOfUnderstanding: 75,
  relevance: 85,
  projectEvidence: 70,
  communicationClarity: 80,
  notes: "Good answer.",
});

function scoredBody(): string {
  return JSON.stringify({
    choices: [{ message: { content: SCORED_CONTENT } }],
    usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
  });
}

interface Stub {
  port: number;
  calls: () => number;
  setMode: (m: StubMode) => void;
  close: () => Promise<void>;
}

async function startStub(initial: StubMode): Promise<Stub> {
  let mode: StubMode = initial;
  let calls = 0;
  const server = http.createServer((_req, res) => {
    calls++;
    const n = calls;
    const m = mode;
    const ok = (): void => {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(scoredBody());
    };
    const fail = (status: number): void => {
      res.writeHead(status, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: `stub ${status}` }));
    };
    try {
      if (m.kind === "fail500") {
        if (n <= m.failFirst) fail(500);
        else ok();
      } else if (m.kind === "always500") {
        fail(500);
      } else if (m.kind === "always429") {
        fail(429);
      } else if (m.kind === "always401") {
        fail(401);
      } else if (m.kind === "invalidJson") {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(
          JSON.stringify({
            choices: [{ message: { content: "this is not json {" } }],
            usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
          }),
        );
      } else if (m.kind === "delay" || m.kind === "succeedAfterDelay") {
        setTimeout(() => {
          try {
            ok();
          } catch {
            // Client already gave up (timeout test) — nothing to do.
          }
        }, m.delayMs);
      } else {
        ok();
      }
    } catch {
      // Client disconnected mid-response (timeout path) — ignore.
    }
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const addr = server.address();
  const port = typeof addr === "object" && addr ? addr.port : 0;
  return {
    port,
    calls: () => calls,
    setMode: (m) => {
      mode = m;
      // Reset the counter so failFirst counts calls under the NEW mode
      // only — generateInterview also calls the stub (question
      // refinement) before the submit under test.
      calls = 0;
    },
    close: async () => {
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}

interface LiveEnvPrev {
  base: string | undefined;
  key: string | undefined;
  model: string | undefined;
  mock: string | undefined;
  timeout: string | undefined;
  rateLimit: string | undefined;
  retryBase: string | undefined;
  noProxy: string | undefined;
}

/** Point the LLM client at the local stub (live path, no real key). */
function setLiveEnv(port: number, timeoutMs = 30000): LiveEnvPrev {
  const prev: LiveEnvPrev = {
    base: process.env.AI_API_BASE_URL,
    key: process.env.AI_API_KEY,
    model: process.env.AI_MODEL,
    mock: process.env.AI_MOCK,
    timeout: process.env.AI_TIMEOUT_MS,
    rateLimit: process.env.AI_RATE_LIMIT_PER_MIN,
    retryBase: process.env.EVAL_RETRY_BASE_DELAY_MS,
    noProxy: process.env.NO_PROXY,
  };
  process.env.AI_MOCK = "false";
  process.env.AI_API_BASE_URL = `http://127.0.0.1:${port}`;
  process.env.AI_API_KEY = "test-key";
  process.env.AI_MODEL = "test-model";
  process.env.AI_TIMEOUT_MS = String(timeoutMs);
  process.env.AI_RATE_LIMIT_PER_MIN = "1000";
  // Fast evaluation-level backoff in tests (10ms base instead of 1000ms).
  process.env.EVAL_RETRY_BASE_DELAY_MS = "10";
  process.env.NO_PROXY = "127.0.0.1,localhost";
  resetLlmRateLimit();
  return prev;
}

function restoreEnv(prev: LiveEnvPrev): void {
  const entries: [string, string | undefined][] = [
    ["AI_API_BASE_URL", prev.base],
    ["AI_API_KEY", prev.key],
    ["AI_MODEL", prev.model],
    ["AI_MOCK", prev.mock],
    ["AI_TIMEOUT_MS", prev.timeout],
    ["AI_RATE_LIMIT_PER_MIN", prev.rateLimit],
    ["EVAL_RETRY_BASE_DELAY_MS", prev.retryBase],
    ["NO_PROXY", prev.noProxy],
  ];
  for (const [k, v] of entries) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  resetLlmRateLimit();
}

function setMockEnv(): LiveEnvPrev {
  const prev: LiveEnvPrev = {
    base: process.env.AI_API_BASE_URL,
    key: process.env.AI_API_KEY,
    model: process.env.AI_MODEL,
    mock: process.env.AI_MOCK,
    timeout: process.env.AI_TIMEOUT_MS,
    rateLimit: process.env.AI_RATE_LIMIT_PER_MIN,
    retryBase: process.env.EVAL_RETRY_BASE_DELAY_MS,
    noProxy: process.env.NO_PROXY,
  };
  process.env.AI_MOCK = "true";
  process.env.AI_API_BASE_URL = "";
  process.env.AI_API_KEY = "";
  process.env.AI_MODEL = "";
  process.env.AI_RATE_LIMIT_PER_MIN = "1000";
  process.env.EVAL_RETRY_BASE_DELAY_MS = "10";
  resetLlmRateLimit();
  return prev;
}

interface Seed {
  userId: string;
  candidateId: string;
  assessmentId: string;
}

async function seedCandidate(tag: string): Promise<Seed> {
  const email = `f3-${tag}-${RUN}@example.com`;
  const user = await pool.query(
    `INSERT INTO users (email, full_name, role, password_hash)
     VALUES ($1, $2, 'candidate', 'test-hash') RETURNING id`,
    [email, `F3 ${tag}`],
  );
  const cand = await pool.query(
    `INSERT INTO candidates (user_id, full_name, email, target_roles)
     VALUES ($1, $2, $3, $4) RETURNING id`,
    [user.rows[0].id, `F3 ${tag}`, email, ["Backend Developer"]],
  );
  const asm = await pool.query(
    `INSERT INTO assessments (candidate_id, status) VALUES ($1, 'completed') RETURNING id`,
    [cand.rows[0].id],
  );
  return {
    userId: user.rows[0].id as string,
    candidateId: cand.rows[0].id as string,
    assessmentId: asm.rows[0].id as string,
  };
}

async function cleanupSeed(seed: Partial<Seed> & { interviewId?: string }): Promise<void> {
  if (seed.interviewId) {
    await pool.query(`DELETE FROM interview_evaluation_attempts WHERE interview_id = $1`, [
      seed.interviewId,
    ]);
    await pool.query(`DELETE FROM interview_reports WHERE interview_id = $1`, [seed.interviewId]);
    await pool.query(`DELETE FROM interview_followups WHERE interview_id = $1`, [seed.interviewId]);
    await pool.query(
      `DELETE FROM interview_answers WHERE question_id IN
         (SELECT id FROM interview_questions WHERE interview_id = $1)`,
      [seed.interviewId],
    );
    await pool.query(`DELETE FROM interview_sessions WHERE interview_id = $1`, [seed.interviewId]);
    await pool.query(`DELETE FROM interview_questions WHERE interview_id = $1`, [seed.interviewId]);
    await pool.query(`DELETE FROM interviews WHERE id = $1`, [seed.interviewId]);
  }
  if (seed.assessmentId) {
    await pool.query(`DELETE FROM assessments WHERE id = $1`, [seed.assessmentId]);
  }
  if (seed.candidateId) {
    await pool.query(`DELETE FROM candidates WHERE id = $1`, [seed.candidateId]);
  }
  if (seed.userId) {
    await pool.query(`DELETE FROM users WHERE id = $1`, [seed.userId]);
  }
}

function strongAnswer(expectedPoints: string[]): string {
  const rubric = expectedPoints[0] ?? "";
  return (
    `${rubric} For a concrete example from my own code, I applied this in the main implementation file ` +
    `for the challenge, changing how the project handles its core flow. I also weighed the trade-offs ` +
    `and edge cases, including failure modes and what I would test next before calling the work done.`
  );
}

interface Begun {
  seed: Seed;
  interviewId: string;
  questions: { id: string; expected_points: string[] }[];
}

/** Seed → generate → start → readiness → first question served. */
async function beginInterview(tag: string): Promise<Begun> {
  const seed = await seedCandidate(tag);
  const gen = await generateInterview({
    assessmentId: seed.assessmentId,
    candidateId: seed.candidateId,
  });
  await startSession({ interviewId: gen.interview.id, candidateId: seed.candidateId });
  await confirmReadiness({
    interviewId: gen.interview.id,
    candidateId: seed.candidateId,
    acknowledged: true,
  });
  const state = await getSessionState({
    interviewId: gen.interview.id,
    candidateId: seed.candidateId,
  });
  assert.equal(state.session.status, "in_progress");
  return {
    seed,
    interviewId: gen.interview.id,
    questions: gen.questions.map((q) => ({
      id: q.id,
      expected_points: q.expected_points as string[],
    })),
  };
}

async function attemptsFor(interviewId: string, questionId: string) {
  const res = await pool.query(
    `SELECT * FROM interview_evaluation_attempts
      WHERE interview_id = $1 AND question_id = $2 ORDER BY attempt_number ASC`,
    [interviewId, questionId],
  );
  return res.rows as Record<string, unknown>[];
}

async function storedAnswer(questionId: string) {
  const res = await pool.query(
    `SELECT answer, score, evaluation FROM interview_answers WHERE question_id = $1`,
    [questionId],
  );
  return res.rows[0] as
    | { answer: string; score: string | null; evaluation: Record<string, unknown> }
    | undefined;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ── F3 DB tests ────────────────────────────────────────────────────────────

test("F3: retry succeeds after a transient failure (stub 500s out the LLM's own retries, then succeeds)", async (t) => {
  if (await skipIfNoDb(t)) return;
  // Start in succeed mode: generateInterview also calls the stub
  // (question refinement, falls back to deterministic on schema
  // mismatch) and must not consume the failure budget. Switch to
  // fail-500 only for the submit under test: llm.ts retries 500s
  // internally (max 3), so the initial scoring exhausts its own
  // retries and goes pending.
  const stub = await startStub({ kind: "succeed" });
  const prev = setLiveEnv(stub.port);
  t.after(() => stub.close());
  t.after(() => restoreEnv(prev));

  const begun = await beginInterview("retry-ok");
  const { seed, interviewId, questions } = begun;
  t.after(() => cleanupSeed({ ...seed, interviewId }));
  const q1 = questions[0].id;
  const answer = strongAnswer(questions[0].expected_points);

  stub.setMode({ kind: "fail500", failFirst: 3 });
  const r = await submitSessionAnswer({
    interviewId,
    candidateId: seed.candidateId,
    questionId: q1,
    answer,
  });
  assert.equal(r.outcome, "pending", "initial scoring must go pending after 3x500");
  assert.equal(r.score, null, "no fabricated score on failure");
  assert.equal(r.evaluation?.status, "pending");
  assert.equal(r.evaluation?.failureKind, "server_error");
  const attempts1 = await attemptsFor(interviewId, q1);
  assert.equal(attempts1.length, 1, "initial failure recorded as attempt 1");
  assert.equal(attempts1[0].state, "retryable_failed");
  assert.equal(attempts1[0].failure_kind, "server_error");
  assert.equal((attempts1[0].failure_detail as { httpStatus: number }).httpStatus, 500);
  // No prompt/answer content in the failure record.
  assert.equal(JSON.stringify(attempts1[0].failure_detail).includes(answer.slice(0, 40)), false);

  const retried = await retryEvaluation({
    interviewId,
    candidateId: seed.candidateId,
    questionId: q1,
  });
  assert.equal(retried.state, "completed");
  assert.equal(retried.idempotent, false);
  assert.equal(retried.attempts, 2);
  assert.ok(typeof retried.score === "number" && (retried.score as number) > 0);
  assert.equal(retried.score, 78, "stub dims 80/75/85/70/80 weight to 78");
  const attempts2 = await attemptsFor(interviewId, q1);
  assert.equal(attempts2.length, 2);
  assert.equal(attempts2[1].state, "completed");
  assert.equal(Number(attempts2[1].score), 78);
  assert.ok((attempts2[1].evaluation as { status: string }).status === "scored");

  // Submitted answer unchanged — retry re-scored the stored answer only.
  const stored = await storedAnswer(q1);
  assert.equal(stored?.answer, answer.trim());
  // The immutable answer row itself is untouched by the retry: its
  // evaluation is still the original pending one; the score lives on
  // the completed attempt row.
  assert.equal((stored?.evaluation as { status: string }).status, "pending");
  assert.equal(stored?.score, null);

  // The finished report picks the retried score up (mean over scored
  // questions only — this one question).
  const report = await finishSession({ interviewId, candidateId: seed.candidateId });
  assert.equal(report.perQuestion[0].score, 78);
  assert.equal(report.perQuestion[0].evaluationState, "completed");
  assert.equal(report.perQuestion[0].failureKind, null);
  assert.equal(report.finalScore, 78);
  assert.equal(report.pendingEvaluations, 0);
  assert.equal(report.failedEvaluations, 0);
});

test("F3: timeout classified as timeout; bounded retries end permanently_failed with no score", async (t) => {
  if (await skipIfNoDb(t)) return;
  const stub = await startStub({ kind: "delay", delayMs: 800 });
  // Client timeout 200ms — every scoring call aborts before the stub answers.
  const prev = setLiveEnv(stub.port, 200);
  t.after(() => stub.close());
  t.after(() => restoreEnv(prev));

  const begun = await beginInterview("retry-timeout");
  const { seed, interviewId, questions } = begun;
  t.after(() => cleanupSeed({ ...seed, interviewId }));
  const q1 = questions[0].id;
  const answer = strongAnswer(questions[0].expected_points);

  const r = await submitSessionAnswer({
    interviewId,
    candidateId: seed.candidateId,
    questionId: q1,
    answer,
  });
  assert.equal(r.outcome, "pending");
  assert.equal(r.evaluation?.failureKind, "timeout");
  const attempts1 = await attemptsFor(interviewId, q1);
  assert.equal(attempts1.length, 1);
  assert.equal(attempts1[0].failure_kind, "timeout");

  const retried = await retryEvaluation({
    interviewId,
    candidateId: seed.candidateId,
    questionId: q1,
  });
  assert.equal(retried.state, "permanently_failed", "3 timeouts exhaust the budget");
  assert.equal(retried.failureKind, "timeout");
  assert.equal(retried.score, null, "no fabricated score after total failure");
  assert.equal(retried.attempts, 3);
  const attempts2 = await attemptsFor(interviewId, q1);
  assert.equal(attempts2.length, 3, "bounded: exactly 3 attempts, no infinite loop");
  assert.equal(attempts2[2].state, "permanently_failed");
  const stored = await storedAnswer(q1);
  assert.equal(stored?.answer, answer.trim(), "answer unchanged after failed retries");
});

test("F3: HTTP 429 classified distinctly from 5xx", async (t) => {
  if (await skipIfNoDb(t)) return;
  const stub = await startStub({ kind: "always429" });
  const prev = setLiveEnv(stub.port);
  t.after(() => stub.close());
  t.after(() => restoreEnv(prev));

  const begun = await beginInterview("retry-429");
  const { seed, interviewId, questions } = begun;
  t.after(() => cleanupSeed({ ...seed, interviewId }));
  const q1 = questions[0].id;
  const answer = strongAnswer(questions[0].expected_points);

  const r = await submitSessionAnswer({
    interviewId,
    candidateId: seed.candidateId,
    questionId: q1,
    answer,
  });
  assert.equal(r.outcome, "pending");
  assert.equal(r.evaluation?.failureKind, "rate_limited", "429 must not be lumped in with 5xx");
  const attempts1 = await attemptsFor(interviewId, q1);
  assert.equal(attempts1[0].failure_kind, "rate_limited");
  assert.equal((attempts1[0].failure_detail as { httpStatus: number }).httpStatus, 429);

  const retried = await retryEvaluation({
    interviewId,
    candidateId: seed.candidateId,
    questionId: q1,
  });
  assert.equal(retried.state, "permanently_failed");
  assert.equal(retried.failureKind, "rate_limited");
  assert.equal(retried.attempts, 3);
  assert.equal((await attemptsFor(interviewId, q1)).length, 3);
  const stored = await storedAnswer(q1);
  assert.equal(stored?.answer, answer.trim());
});

test("F3: permanent validation error (invalid JSON) → permanently_failed after 2 attempts, then 409", async (t) => {
  if (await skipIfNoDb(t)) return;
  const stub = await startStub({ kind: "invalidJson" });
  const prev = setLiveEnv(stub.port);
  t.after(() => stub.close());
  t.after(() => restoreEnv(prev));

  const begun = await beginInterview("retry-invalid");
  const { seed, interviewId, questions } = begun;
  t.after(() => cleanupSeed({ ...seed, interviewId }));
  const q1 = questions[0].id;
  const answer = strongAnswer(questions[0].expected_points);

  const r = await submitSessionAnswer({
    interviewId,
    candidateId: seed.candidateId,
    questionId: q1,
    answer,
  });
  assert.equal(r.outcome, "pending");
  assert.equal(r.evaluation?.failureKind, "invalid_response");
  assert.equal((await attemptsFor(interviewId, q1)).length, 1);

  const retried = await retryEvaluation({
    interviewId,
    candidateId: seed.candidateId,
    questionId: q1,
  });
  assert.equal(retried.state, "permanently_failed", "invalid response stops after 2 total attempts");
  assert.equal(retried.failureKind, "invalid_response");
  assert.equal(retried.score, null);
  assert.equal(retried.attempts, 2);
  const attempts = await attemptsFor(interviewId, q1);
  assert.equal(attempts.length, 2, "bounded: exactly 2 attempts for invalid responses");
  assert.equal(attempts[1].state, "permanently_failed");

  // A further retry is rejected, not retried forever.
  let err: unknown;
  try {
    await retryEvaluation({ interviewId, candidateId: seed.candidateId, questionId: q1 });
  } catch (e) {
    err = e;
  }
  expectApiError(err, 409);
  assert.equal((await attemptsFor(interviewId, q1)).length, 2, "rejected retry adds no attempt row");
  const stored = await storedAnswer(q1);
  assert.equal(stored?.answer, answer.trim());
});

// ── Phase 2, G3.5: auth-failure recovery ───────────────────────────────
// A revoked key fails auth twice → permanently_failed. Rotating the key
// must not leave the candidate permanently unable to retry: exactly ONE
// additional attempt cycle is allowed after an auth permanently_failed.
// Any further retry (or any non-auth permanently_failed) stays 409.

test("phase 2 G3.5: retry after an auth permanently_failed is allowed once the key is fixed", async (t) => {
  if (await skipIfNoDb(t)) return;
  const stub = await startStub({ kind: "always401" });
  const prev = setLiveEnv(stub.port);
  t.after(() => stub.close());
  t.after(() => restoreEnv(prev));

  const begun = await beginInterview("retry-auth-recovery");
  const { seed, interviewId, questions } = begun;
  t.after(() => cleanupSeed({ ...seed, interviewId }));
  const q1 = questions[0].id;
  const answer = strongAnswer(questions[0].expected_points);

  // Attempt 1 (submit): 401 → pending, auth_failed.
  const r = await submitSessionAnswer({
    interviewId,
    candidateId: seed.candidateId,
    questionId: q1,
    answer,
  });
  assert.equal(r.outcome, "pending");
  assert.equal(r.evaluation?.failureKind, "auth_failed", "401 must classify as auth_failed");
  assert.equal((await attemptsFor(interviewId, q1)).length, 1);

  // Attempt 2 (retry): still 401 → permanently_failed, budget spent.
  const retried = await retryEvaluation({
    interviewId,
    candidateId: seed.candidateId,
    questionId: q1,
  });
  assert.equal(retried.state, "permanently_failed", "auth failures stop after 2 total attempts");
  assert.equal(retried.failureKind, "auth_failed");
  assert.equal(retried.attempts, 2);
  const attempts = await attemptsFor(interviewId, q1);
  assert.equal(attempts.length, 2);
  assert.equal(attempts[1].state, "permanently_failed");

  // The key is rotated: the stub now succeeds (a fixed key). The one
  // auth-recovery cycle must score the stored answer.
  stub.setMode({ kind: "succeed" });
  const recovered = await retryEvaluation({
    interviewId,
    candidateId: seed.candidateId,
    questionId: q1,
  });
  assert.equal(recovered.state, "completed", "one auth-recovery cycle is allowed after permanently_failed");
  assert.equal(recovered.idempotent, false);
  assert.equal(recovered.attempts, 3);
  assert.equal(recovered.score, 78, "recovery re-scores the stored answer");
  const attemptsAfter = await attemptsFor(interviewId, q1);
  assert.equal(attemptsAfter.length, 3, "recovery adds exactly one attempt row");
  assert.equal(attemptsAfter[2].state, "completed");
  const stored = await storedAnswer(q1);
  assert.equal(stored?.answer, answer.trim(), "recovery never touches the stored answer");
});

test("phase 2 G3.5: the auth-recovery cycle is exactly one — a second revoked key ends in 409", async (t) => {
  if (await skipIfNoDb(t)) return;
  const stub = await startStub({ kind: "always401" });
  const prev = setLiveEnv(stub.port);
  t.after(() => stub.close());
  t.after(() => restoreEnv(prev));

  const begun = await beginInterview("retry-auth-once");
  const { seed, interviewId, questions } = begun;
  t.after(() => cleanupSeed({ ...seed, interviewId }));
  const q1 = questions[0].id;
  const answer = strongAnswer(questions[0].expected_points);

  const r = await submitSessionAnswer({
    interviewId,
    candidateId: seed.candidateId,
    questionId: q1,
    answer,
  });
  assert.equal(r.outcome, "pending");
  const retried = await retryEvaluation({
    interviewId,
    candidateId: seed.candidateId,
    questionId: q1,
  });
  assert.equal(retried.state, "permanently_failed");
  assert.equal(retried.attempts, 2);

  // The key is still revoked: the one recovery attempt fails again.
  const recovery = await retryEvaluation({
    interviewId,
    candidateId: seed.candidateId,
    questionId: q1,
  });
  assert.equal(recovery.state, "permanently_failed", "the recovery cycle itself is one attempt");
  assert.equal(recovery.failureKind, "auth_failed");
  assert.equal(recovery.attempts, 3);
  assert.equal((await attemptsFor(interviewId, q1)).length, 3);

  // The recovery cycle is consumed: a further retry is rejected, not
  // retried forever.
  let err: unknown;
  try {
    await retryEvaluation({ interviewId, candidateId: seed.candidateId, questionId: q1 });
  } catch (e) {
    err = e;
  }
  expectApiError(err, 409);
  assert.equal((await attemptsFor(interviewId, q1)).length, 3, "rejected retry adds no attempt row");
  const stored = await storedAnswer(q1);
  assert.equal(stored?.answer, answer.trim());
});

test("F3: duplicate concurrent retry rejected with 409; first retry still completes", async (t) => {
  if (await skipIfNoDb(t)) return;
  const stub = await startStub({ kind: "always500" });
  const prev = setLiveEnv(stub.port);
  t.after(() => stub.close());
  t.after(() => restoreEnv(prev));

  const begun = await beginInterview("retry-dup");
  const { seed, interviewId, questions } = begun;
  t.after(() => cleanupSeed({ ...seed, interviewId }));
  const q1 = questions[0].id;
  const answer = strongAnswer(questions[0].expected_points);

  const r = await submitSessionAnswer({
    interviewId,
    candidateId: seed.candidateId,
    questionId: q1,
    answer,
  });
  assert.equal(r.outcome, "pending");

  // Flip the stub to answer slowly but successfully, then fire two
  // retries at once: the second must see the in-flight attempt → 409.
  stub.setMode({ kind: "succeedAfterDelay", delayMs: 700 });
  const first = retryEvaluation({ interviewId, candidateId: seed.candidateId, questionId: q1 });
  await sleep(150);
  let err: unknown;
  try {
    await retryEvaluation({ interviewId, candidateId: seed.candidateId, questionId: q1 });
  } catch (e) {
    err = e;
  }
  expectApiError(err, 409);
  const done = await first;
  assert.equal(done.state, "completed");
  assert.equal(done.score, 78);
  const attempts = await attemptsFor(interviewId, q1);
  assert.equal(attempts.length, 2, "rejected duplicate added no attempt row");
  const stored = await storedAnswer(q1);
  assert.equal(stored?.answer, answer.trim());
});

test("F3: retry of a completed evaluation is idempotent (same score, no new attempt row)", async (t) => {
  if (await skipIfNoDb(t)) return;
  const prev = setMockEnv();
  t.after(() => restoreEnv(prev));

  const begun = await beginInterview("retry-idem");
  const { seed, interviewId, questions } = begun;
  t.after(() => cleanupSeed({ ...seed, interviewId }));
  const q1 = questions[0].id;
  const answer = strongAnswer(questions[0].expected_points);

  const r = await submitSessionAnswer({
    interviewId,
    candidateId: seed.candidateId,
    questionId: q1,
    answer,
  });
  assert.ok(typeof r.score === "number");
  const attemptsBefore = await attemptsFor(interviewId, q1);
  assert.equal(attemptsBefore.length, 1, "initial scoring recorded as attempt 1");
  assert.equal(attemptsBefore[0].state, "completed");

  const retried = await retryEvaluation({
    interviewId,
    candidateId: seed.candidateId,
    questionId: q1,
  });
  assert.equal(retried.idempotent, true);
  assert.equal(retried.state, "completed");
  assert.equal(retried.score, r.score, "same stored score returned");
  const attemptsAfter = await attemptsFor(interviewId, q1);
  assert.equal(attemptsAfter.length, 1, "idempotent retry adds no attempt row");
  const stored = await storedAnswer(q1);
  assert.equal(stored?.answer, answer.trim());
});

test("F3: unauthorized user cannot retry someone else's evaluation; admin bypass works", async (t) => {
  if (await skipIfNoDb(t)) return;
  const stub = await startStub({ kind: "always500" });
  const prev = setLiveEnv(stub.port);
  t.after(() => stub.close());
  t.after(() => restoreEnv(prev));

  const begun = await beginInterview("retry-auth");
  const { seed, interviewId, questions } = begun;
  t.after(() => cleanupSeed({ ...seed, interviewId }));
  const other = await seedCandidate("retry-auth-other");
  t.after(() => cleanupSeed(other));
  const q1 = questions[0].id;
  const answer = strongAnswer(questions[0].expected_points);

  const r = await submitSessionAnswer({
    interviewId,
    candidateId: seed.candidateId,
    questionId: q1,
    answer,
  });
  assert.equal(r.outcome, "pending");

  // Another candidate: same ownership check as the session endpoints.
  let err: unknown;
  try {
    await retryEvaluation({
      interviewId,
      candidateId: other.candidateId,
      questionId: q1,
    });
  } catch (e) {
    err = e;
  }
  expectApiError(err, 404);
  assert.equal((await attemptsFor(interviewId, q1)).length, 1, "rejected retry adds no attempt row");

  // Admin bypass (same pattern as the recruiter report gate).
  stub.setMode({ kind: "succeed" });
  const viaAdmin = await retryEvaluation({
    interviewId,
    questionId: q1,
    isAdmin: true,
  });
  assert.equal(viaAdmin.state, "completed");
  assert.equal(viaAdmin.score, 78);
  const stored = await storedAnswer(q1);
  assert.equal(stored?.answer, answer.trim());
});

test("F3: report lists pending/failed questions transparently and never treats a missing score as zero", async (t) => {
  if (await skipIfNoDb(t)) return;
  const stub = await startStub({ kind: "succeed" });
  const prev = setLiveEnv(stub.port);
  t.after(() => stub.close());
  t.after(() => restoreEnv(prev));

  const begun = await beginInterview("retry-report");
  const { seed, interviewId, questions } = begun;
  t.after(() => cleanupSeed({ ...seed, interviewId }));

  // Q1 scores (stub succeeds → 78); Q2 fails (stub 500s) → pending.
  const r1 = await submitSessionAnswer({
    interviewId,
    candidateId: seed.candidateId,
    questionId: questions[0].id,
    answer: strongAnswer(questions[0].expected_points),
  });
  assert.equal(r1.score, 78);
  stub.setMode({ kind: "always500" });
  const r2 = await submitSessionAnswer({
    interviewId,
    candidateId: seed.candidateId,
    questionId: questions[1].id,
    answer: strongAnswer(questions[1].expected_points),
  });
  assert.equal(r2.outcome, "pending");
  assert.equal(r2.score, null);

  const report = await finishSession({ interviewId, candidateId: seed.candidateId });
  assert.equal(report.perQuestion[0].score, 78);
  assert.equal(report.perQuestion[0].evaluationState, "completed");
  assert.equal(report.perQuestion[1].score, null);
  assert.equal(report.perQuestion[1].status, "pending_evaluation");
  assert.equal(report.perQuestion[1].evaluationState, "retryable_failed");
  assert.equal(report.perQuestion[1].failureKind, "server_error");
  assert.equal(report.pendingEvaluations, 1);
  assert.equal(report.failedEvaluations, 1);
  assert.deepEqual(report.evaluationFailures, [
    {
      questionId: questions[1].id,
      state: "retryable_failed",
      failureKind: "server_error",
    },
  ]);
  // Mean over SCORED questions only: 78, not (78 + 0) / 2 = 39.
  assert.equal(report.finalScore, 78);
  assert.notEqual(report.finalScore, 39);
});

test("db: teardown closes the pool", async () => {
  await pool.end();
});
