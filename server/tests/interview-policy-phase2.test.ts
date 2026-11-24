import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";

// Phase 2 interview-policy fixes (G3.1, G3.3, G3.7, G1.4): one explicit
// policy, enforced identically in report generation and profile
// computation. Service-level tests against DATABASE_URL when a Postgres
// is reachable, SKIPPING (not failing) when there is none — the
// existing DB-test convention (see tests/auth.db.test.ts). Migrations
// 000–015 must have been applied first (npm run migrate). No live AI
// is used: with no AI_API_* env the LLM client runs its deterministic
// mock provider and every record is labelled provider "mock".

import { pool } from "../src/config/db";
import {
  generateInterview,
  loadInterviewForCandidate,
  type InterviewQuestionRow,
} from "../src/services/interview";
import {
  startSession,
  confirmReadiness,
  getSessionState,
  submitSessionAnswer,
  finishSession,
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

interface Seed {
  userId: string;
  candidateId: string;
  assessmentId: string;
  email: string;
}

async function seedCandidate(
  tag: string,
  targetRoles: string[] = ["Backend Developer"],
): Promise<Seed> {
  const email = `phase2-${tag}-${RUN}@example.com`;
  const user = await pool.query(
    `INSERT INTO users (email, full_name, role, password_hash)
     VALUES ($1, $2, 'candidate', 'test-hash') RETURNING id`,
    [email, `Phase 2 ${tag}`],
  );
  const userId = user.rows[0].id as string;
  const cand = await pool.query(
    `INSERT INTO candidates (user_id, full_name, email, target_roles)
     VALUES ($1, $2, $3, $4) RETURNING id`,
    [userId, `Phase 2 ${tag}`, email, targetRoles],
  );
  const candidateId = cand.rows[0].id as string;
  const asm = await pool.query(
    `INSERT INTO assessments (candidate_id, status) VALUES ($1, 'completed') RETURNING id`,
    [candidateId],
  );
  return { userId, candidateId, assessmentId: asm.rows[0].id as string, email };
}

/** Delete everything a seed created (reverse FK order). */
async function cleanupSeed(seed: Partial<Seed> & { interviewId?: string }): Promise<void> {
  if (seed.interviewId) {
    await pool.query(`DELETE FROM interview_reports WHERE interview_id = $1`, [seed.interviewId]);
    await pool.query(`DELETE FROM interview_followups WHERE interview_id = $1`, [seed.interviewId]);
    await pool.query(
      `DELETE FROM interview_answers WHERE question_id IN
         (SELECT id FROM interview_questions WHERE interview_id = $1)`,
      [seed.interviewId],
    );
    await pool.query(`DELETE FROM interview_evaluation_attempts WHERE interview_id = $1`, [seed.interviewId]);
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

/** A strong answer: covers every expected point of the question in 60+
 *  words (same pattern as tests/interview-session.test.ts). */
function strongAnswer(q: InterviewQuestionRow): string {
  const rubric = (q.expected_points as string[])[0] ?? "";
  return (
    `${rubric} For a concrete example from my own code, I applied this in the main implementation file ` +
    `for the challenge, changing how the project handles its core flow. I also weighed the trade-offs ` +
    `and edge cases, including failure modes and what I would test next before calling the work done.`
  );
}

/** A partial-coverage answer for the first (API design) question: covers
 *  exactly one of its three expected points, ~56 words → score ~49. */
const PARTIAL_ANSWER_Q1 =
  "I designed a clean versioned REST API with correct status codes, validation and auth " +
  "for the challenge endpoints. The handlers return JSON responses and check input before doing " +
  "work, and errors map to the right codes. I kept the routes small and grouped by resource so " +
  "the surface stays easy to reason about and extend later.";

/** A strong answer to a FOLLOW-UP: covers the follow-up question's own
 *  expected points (the original question's MISSED points — read from
 *  the DB), plus a concrete example and trade-offs. Quoting Q1's L3
 *  rubric here would NOT cover them: that point was already covered
 *  by the partial answer, so it is not among the missed points. */
async function strongFollowUpAnswer(followUpId: string): Promise<string> {
  const res = await pool.query(
    `SELECT expected_points FROM interview_questions WHERE id = $1`,
    [followUpId],
  );
  const points = res.rows[0].expected_points as string[];
  assert.ok(points.length > 0, "follow-up must carry its missed points");
  return (
    points.join(" ") +
    " For a concrete example from my own code, I applied this in the main implementation file " +
    "for the challenge, changing how the project handles its core flow. I also weighed the trade-offs " +
    "and edge cases, including failure modes and what I would test next before calling the work done."
  );
}

interface Begun {
  seed: Seed;
  interviewId: string;
  questions: InterviewQuestionRow[];
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
  assert.ok(state.currentQuestion, "first question must be served after readiness");
  return { seed, interviewId: gen.interview.id, questions: gen.questions };
}

async function currentQuestionId(begun: Begun): Promise<string> {
  const state = await getSessionState({
    interviewId: begun.interviewId,
    candidateId: begun.seed.candidateId,
  });
  assert.ok(state.currentQuestion, "expected a current question");
  return state.currentQuestion.id as string;
}

/** Simulate the state a live scoring failure would have left on an
 *  ORIGINAL answer: pending evaluation + null score on the answer row,
 *  and the initial attempt recorded as retryable_failed / server_error.
 *
 *  This is done for real, not by UPDATEing the immutable answer row
 *  (migration 011's trigger rejects that): Q6 is submitted while the
 *  LLM client points at a local stub that always 500s, so the session
 *  flow itself stores the answer pending with a recorded attempt.
 *  (Stub + live-env harness copied from tests/interview-retry.test.ts;
 *  no external network, no real key.) */
interface Stub {
  port: number;
  close: () => Promise<void>;
}

async function startFailingStub(): Promise<Stub> {
  const server = http.createServer((_req, res) => {
    res.writeHead(500, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: "stub 500" }));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const addr = server.address();
  const port = typeof addr === "object" && addr ? addr.port : 0;
  return {
    port,
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
function setLiveEnv(port: number): LiveEnvPrev {
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
  process.env.AI_TIMEOUT_MS = "30000";
  process.env.AI_RATE_LIMIT_PER_MIN = "1000";
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

// ── G3.1 + G1.4: honest unscored counts + completeness contract ─────────

test("phase 2 G3.1/G1.4: 5 scored + 1 pending + 1 unanswered reports pendingEvaluations 1, unansweredCount 1, incomplete with coverage note", async (t) => {
  if (await skipIfNoDb(t)) return;
  const begun = await beginInterview("policy-counts");
  const { seed, interviewId, questions } = begun;
  t.after(() => cleanupSeed({ ...seed, interviewId }));

  // Q1–Q5 strong (scored in mock mode); Q6 answered while the LLM
  // client points at a stub that always 500s, so its evaluation is
  // genuinely pending (answer retained, attempt recorded); Q7 never
  // answered.
  for (let i = 0; i < 5; i++) {
    const cur = await currentQuestionId(begun);
    assert.equal(cur, questions[i].id, `expected Q${i + 1} as current`);
    await submitSessionAnswer({
      interviewId,
      candidateId: seed.candidateId,
      questionId: questions[i].id,
      answer: strongAnswer(questions[i]),
    });
  }
  const stub = await startFailingStub();
  const prev = setLiveEnv(stub.port);
  t.after(() => stub.close());
  t.after(() => restoreEnv(prev));
  const cur6 = await currentQuestionId(begun);
  assert.equal(cur6, questions[5].id, "expected Q6 as current");
  const r6 = await submitSessionAnswer({
    interviewId,
    candidateId: seed.candidateId,
    questionId: questions[5].id,
    answer: strongAnswer(questions[5]),
  });
  assert.equal(r6.outcome, "pending", "Q6 scoring must fail against the 500 stub");
  assert.equal(r6.score, null);
  restoreEnv(prev);
  // Q7 is current and unanswered — finish now.
  const state = await getSessionState({ interviewId, candidateId: seed.candidateId });
  assert.equal(state.currentQuestion?.id, questions[6].id, "Q7 must be current and unanswered");

  const report = await finishSession({ interviewId, candidateId: seed.candidateId });
  // The G3.1 bug: pendingEvaluations was 1 while the true unscored
  // count was 2 (1 pending + 1 unanswered). Both halves are counted now.
  assert.equal(report.pendingEvaluations, 1, "only the pending-evaluation question counts as pending");
  assert.equal(report.unansweredCount, 1, "the never-answered question counts separately");
  assert.equal(report.pendingEvaluations + report.unansweredCount, 2, "true unscored count");
  assert.equal(report.questionsScored, 5);
  assert.equal(report.questionsRequired, 7);
  assert.equal(report.interviewComplete, false);
  assert.equal(report.provisionalNote, "provisional — 5 of 7 questions scored");
  assert.equal(report.perQuestion.length, 7);
  assert.equal(report.perQuestion[5].status, "pending_evaluation");
  assert.equal(report.perQuestion[5].evaluationState, "retryable_failed");
  assert.equal(report.perQuestion[5].failureKind, "server_error");
  assert.equal(report.perQuestion[6].status, "unanswered");
  assert.equal(
    report.perQuestion[6].evaluationState,
    "unanswered",
    "an unanswered question is never 'pending'",
  );
  assert.equal(report.perQuestion[6].failureKind, null);
  assert.equal(report.perQuestion[6].score, null);
  // The provisional mean is over the 5 scored questions only.
  assert.ok(typeof report.finalScore === "number");
});

test("phase 2 G1.4: a fully scored interview reports complete with a null provisional note", async (t) => {
  if (await skipIfNoDb(t)) return;
  const begun = await beginInterview("policy-complete");
  const { seed, interviewId, questions } = begun;
  t.after(() => cleanupSeed({ ...seed, interviewId }));

  for (let i = 0; i < 7; i++) {
    const cur = await currentQuestionId(begun);
    assert.equal(cur, questions[i].id, `expected Q${i + 1} as current`);
    await submitSessionAnswer({
      interviewId,
      candidateId: seed.candidateId,
      questionId: questions[i].id,
      answer: strongAnswer(questions[i]),
    });
  }
  const report = await finishSession({ interviewId, candidateId: seed.candidateId });
  assert.equal(report.questionsScored, 7);
  assert.equal(report.questionsRequired, 7);
  assert.equal(report.pendingEvaluations, 0);
  assert.equal(report.unansweredCount, 0);
  assert.equal(report.interviewComplete, true);
  assert.equal(report.provisionalNote, null, "a complete interview carries no provisional note");
  assert.ok(typeof report.finalScore === "number");
  for (const p of report.perQuestion) {
    assert.equal(p.status, "answered");
    assert.equal(p.evaluationState, "completed");
    assert.equal(p.originalScore, p.score, "with no follow-up, original score equals effective score");
  }
});

// ── G3.3: follow-up score supersedes, original stays visible ────────────

test("phase 2 G3.3: follow-up score is the effective score and the original score stays visible in the report", async (t) => {
  if (await skipIfNoDb(t)) return;
  const begun = await beginInterview("policy-followup");
  const { seed, interviewId, questions } = begun;
  t.after(() => cleanupSeed({ ...seed, interviewId }));

  // Q1 partial → follow-up; answer the follow-up strongly.
  const r1 = await submitSessionAnswer({
    interviewId,
    candidateId: seed.candidateId,
    questionId: questions[0].id,
    answer: PARTIAL_ANSWER_Q1,
  });
  assert.equal(r1.outcome, "partial");
  assert.ok(r1.followUp, "a follow-up must be generated for a Partial answer");
  const originalScore = r1.score;
  assert.ok(typeof originalScore === "number", "the original answer has its own score");
  const fuId = r1.followUp.id;
  const rFu = await submitSessionAnswer({
    interviewId,
    candidateId: seed.candidateId,
    questionId: fuId,
    answer: await strongFollowUpAnswer(fuId),
  });
  assert.equal(rFu.outcome, "complete");
  const followUpScore = rFu.score;
  assert.ok(typeof followUpScore === "number" && (followUpScore as number) > (originalScore as number));

  for (let i = 1; i < 7; i++) {
    const cur = await currentQuestionId(begun);
    assert.equal(cur, questions[i].id, `expected Q${i + 1} as current`);
    await submitSessionAnswer({
      interviewId,
      candidateId: seed.candidateId,
      questionId: questions[i].id,
      answer: strongAnswer(questions[i]),
    });
  }
  const report = await finishSession({ interviewId, candidateId: seed.candidateId });
  const q1 = report.perQuestion[0];
  assert.equal(q1.score, followUpScore, "the follow-up score supersedes the original for this question");
  assert.equal(q1.originalScore, originalScore, "the original score remains stored and visible");
  assert.equal(q1.originalAnswer, PARTIAL_ANSWER_Q1.trim(), "the original answer remains stored and visible");
  assert.equal(q1.followUp?.score, followUpScore);
  assert.ok(q1.followUp?.answer, "the follow-up answer is visible too");
  assert.equal(report.questionsScored, 7, "a superseded question still counts as scored");
  assert.equal(report.interviewComplete, true);
});

// ── G3.7: expired sessions stay expired ──────────────────────────────────

test("phase 2 G3.7: an expired session stores interviews.status 'expired' (not 'completed') with the report persisted", async (t) => {
  if (await skipIfNoDb(t)) return;
  const begun = await beginInterview("policy-expired");
  const { seed, interviewId, questions } = begun;
  t.after(() => cleanupSeed({ ...seed, interviewId }));

  // Answer Q1–Q3, then expire the session.
  for (let i = 0; i < 3; i++) {
    const cur = await currentQuestionId(begun);
    assert.equal(cur, questions[i].id, `expected Q${i + 1} as current`);
    await submitSessionAnswer({
      interviewId,
      candidateId: seed.candidateId,
      questionId: questions[i].id,
      answer: strongAnswer(questions[i]),
    });
  }
  await pool.query(
    `UPDATE interview_sessions SET expires_at = now() - interval '5 seconds' WHERE interview_id = $1`,
    [interviewId],
  );
  const expired = await getSessionState({ interviewId, candidateId: seed.candidateId });
  assert.equal(expired.session.status, "expired");

  const interviewAfter = await loadInterviewForCandidate(interviewId, seed.candidateId);
  assert.equal(
    interviewAfter.status,
    "expired",
    "an expired session must not be stored as a completed interview",
  );
  const stored = await pool.query(
    `SELECT * FROM interview_reports WHERE interview_id = $1`,
    [interviewId],
  );
  assert.equal(stored.rows.length, 1, "expiry still persists the immutable report");
  const storedReport = stored.rows[0].report as {
    questionsScored: number;
    unansweredCount: number;
    interviewComplete: boolean;
    provisionalNote: string | null;
  };
  assert.equal(storedReport.questionsScored, 3);
  assert.equal(storedReport.unansweredCount, 4);
  assert.equal(storedReport.interviewComplete, false);
  assert.equal(storedReport.provisionalNote, "provisional — 3 of 7 questions scored");
});

test("db: teardown closes the pool", async () => {
  await pool.end();
});
