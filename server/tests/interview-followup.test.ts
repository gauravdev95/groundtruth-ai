import test from "node:test";
import assert from "node:assert/strict";

// P1 F5 — follow-up business rules with deterministic fixtures (mock
// scorer) + follow-up evaluation retry.
//
// Service-level tests against DATABASE_URL when a Postgres is reachable,
// SKIPPING (not failing) when there is none — the existing DB-test
// convention (see tests/auth.db.test.ts). Migrations 000–014 must have
// been applied first (npm run migrate). No live AI is used anywhere:
// the mock provider is forced explicitly (AI_MOCK=true, no AI_API_*),
// so every score is deterministic and reproducible.
//
// Rules proven here:
//   1. Complete answer → no follow-up.
//   2. Partial answer → exactly one follow-up, linked to the original
//      question's competency, text never reveals the expected answer.
//   3. Follow-up answer is evaluated and stored separately; answering
//      it never generates a second follow-up (Complete, Partial or
//      Missed — the code only generates from originals).
//   4. Follow-up submission is immutable (re-submit → 409).
//   5. Follow-up evaluation retry (new in F5): a failed follow-up
//      evaluation can be retried from the stored answer; a successful
//      retry surfaces in the finished report via its completed attempt
//      row; an already-scored follow-up retry is idempotent; an
//      unanswered follow-up cannot be retried (404).
//   6. Auth failures (401/403) classify as their own kind
//      ("auth_failed"), never lumped in with 5xx, with a 2-attempt cap.

import { pool } from "../src/config/db";
import { ApiError } from "../src/middleware/errorHandler";
import { generateInterview, type InterviewQuestionRow } from "../src/services/interview";
import {
  startSession,
  confirmReadiness,
  getSessionState,
  submitSessionAnswer,
  finishSession,
  retryEvaluation,
  classifyEvaluationFailure,
  maxAttemptsForFailureKinds,
  EVALUATION_MAX_AUTH_FAILED_ATTEMPTS,
  containsExpectedAnswer,
} from "../src/services/interviewSession";
import { resetLlmRateLimit } from "../src/services/llm";

// Force the deterministic mock provider for this whole file, whatever
// the ambient environment holds. node:test runs each file in its own
// process, so this cannot leak into other suites.
process.env.AI_MOCK = "true";
delete process.env.AI_API_BASE_URL;
delete process.env.AI_API_KEY;
delete process.env.AI_MODEL;
process.env.AI_RATE_LIMIT_PER_MIN = "1000";
// Fast evaluation-level backoff in tests (10ms base instead of 1000ms).
process.env.EVAL_RETRY_BASE_DELAY_MS = "10";
resetLlmRateLimit();

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

interface Seed {
  userId: string;
  candidateId: string;
  assessmentId: string;
  email: string;
}

async function seedCandidate(tag: string): Promise<Seed> {
  const email = `f5-${tag}-${RUN}@example.com`;
  const user = await pool.query(
    `INSERT INTO users (email, full_name, role, password_hash)
     VALUES ($1, $2, 'candidate', 'test-hash') RETURNING id`,
    [email, `F5 ${tag}`],
  );
  const userId = user.rows[0].id as string;
  const cand = await pool.query(
    `INSERT INTO candidates (user_id, full_name, email, target_roles)
     VALUES ($1, $2, $3, $4) RETURNING id`,
    [userId, `F5 ${tag}`, email, ["Backend Developer"]],
  );
  const candidateId = cand.rows[0].id as string;
  const asm = await pool.query(
    `INSERT INTO assessments (candidate_id, status) VALUES ($1, 'completed') RETURNING id`,
    [candidateId],
  );
  return { userId, candidateId, assessmentId: asm.rows[0].id as string, email };
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

/** A strong answer: covers every expected point of the question
 *  (quotes the L3 rubric, gives a concrete example from the candidate's
 *  own code, weighs trade-offs and edge cases) in 60+ words. */
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

/** A vague, general answer that covers none of the expected points:
 *  relevant to the area, but thin — deterministic score lands in the
 *  Missed band (< 40). Used to prove answering a follow-up never
 *  generates another one even when the follow-up answer is weak. */
const VAGUE_ANSWER =
  "I think this area matters a lot for the project and I have thought about it " +
  "while working on the challenge. There are a few things I would probably look " +
  "at more closely if I had more time, and I would try to improve the parts " +
  "that felt less solid when I was building it.";

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

async function attemptsFor(interviewId: string, questionId: string) {
  const res = await pool.query(
    `SELECT * FROM interview_evaluation_attempts
      WHERE interview_id = $1 AND question_id = $2 ORDER BY attempt_number ASC`,
    [interviewId, questionId],
  );
  return res.rows as Record<string, unknown>[];
}

async function storedFollowup(questionId: string) {
  const res = await pool.query(
    `SELECT answer, score, evaluation FROM interview_followups WHERE question_id = $1`,
    [questionId],
  );
  return res.rows[0] as
    | { answer: string | null; score: string | null; evaluation: Record<string, unknown> }
    | undefined;
}

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

/** Drive Q1 to Partial and return the generated follow-up id. */
async function generateFollowUp(begun: Begun): Promise<string> {
  const { seed, interviewId, questions } = begun;
  const r1 = await submitSessionAnswer({
    interviewId,
    candidateId: seed.candidateId,
    questionId: questions[0].id,
    answer: PARTIAL_ANSWER_Q1,
  });
  assert.equal(r1.outcome, "partial", `expected partial, got ${r1.outcome} (score ${r1.score})`);
  assert.ok(r1.followUp, "a follow-up must be generated for a Partial answer");
  assert.ok(r1.next && r1.next.questionId === r1.followUp.id, "follow-up is served next");
  return r1.followUp.id;
}

// ── Pure classification / policy unit tests (no DB) ─────────────────────

test("F5: auth failures (401/403) classify as auth_failed, distinct from 5xx", () => {
  const r401 = classifyEvaluationFailure(new Error("LLM provider error: HTTP 401"));
  assert.equal(r401.kind, "auth_failed");
  assert.equal(r401.httpStatus, 401);
  const r403 = classifyEvaluationFailure(new Error("LLM provider error: HTTP 403"));
  assert.equal(r403.kind, "auth_failed");
  assert.equal(r403.httpStatus, 403);
  // 5xx stays server_error; 429 stays rate_limited.
  assert.equal(classifyEvaluationFailure(new Error("LLM provider error: HTTP 500")).kind, "server_error");
  assert.equal(classifyEvaluationFailure(new Error("LLM provider error: HTTP 429")).kind, "rate_limited");
});

test("F5: retry policy — auth failures cap at 2 attempts like invalid responses", () => {
  assert.equal(EVALUATION_MAX_AUTH_FAILED_ATTEMPTS, 2);
  assert.equal(maxAttemptsForFailureKinds(["auth_failed"]), 2);
  assert.equal(maxAttemptsForFailureKinds(["auth_failed", "auth_failed"]), 2);
  assert.equal(maxAttemptsForFailureKinds(["invalid_response", "auth_failed"]), 2);
  // Any transient failure in the history earns the full 3 attempts.
  assert.equal(maxAttemptsForFailureKinds(["auth_failed", "timeout"]), 3);
  assert.equal(maxAttemptsForFailureKinds(["timeout"]), 3);
});

// ── 1. Complete → no follow-up ───────────────────────────────────────────

test("F5: complete answer generates no follow-up", async (t) => {
  if (await skipIfNoDb(t)) return;
  const begun = await beginInterview("complete");
  const { seed, interviewId, questions } = begun;
  t.after(() => cleanupSeed({ ...seed, interviewId }));

  const r = await submitSessionAnswer({
    interviewId,
    candidateId: seed.candidateId,
    questionId: questions[0].id,
    answer: strongAnswer(questions[0]),
  });
  assert.equal(r.outcome, "complete", `expected complete, got ${r.outcome} (score ${r.score})`);
  assert.equal(r.followUp, null, "a Complete answer must not generate a follow-up");
  assert.equal(r.evaluation?.provider, "mock");
  assert.equal(r.evaluation?.method, "deterministic");
  const fuCount = await pool.query(
    `SELECT COUNT(*)::int AS n FROM interview_followups WHERE interview_id = $1`,
    [interviewId],
  );
  assert.equal(fuCount.rows[0].n, 0);
});

// ── 2. Partial → exactly one follow-up, linked, no leak ─────────────────

test("F5: partial answer generates exactly one follow-up linked to the original competency, text never reveals the expected answer", async (t) => {
  if (await skipIfNoDb(t)) return;
  const begun = await beginInterview("partial");
  const { seed, interviewId, questions } = begun;
  t.after(() => cleanupSeed({ ...seed, interviewId }));

  const fuId = await generateFollowUp(begun);
  const fuRows = await pool.query(
    `SELECT * FROM interview_followups WHERE interview_id = $1`,
    [interviewId],
  );
  assert.equal(fuRows.rows.length, 1, "exactly one follow-up row");
  assert.equal(fuRows.rows[0].original_question_id, questions[0].id);
  assert.equal(fuRows.rows[0].question_id, fuId);
  const fuQuestion = await pool.query(
    `SELECT * FROM interview_questions WHERE id = $1`,
    [fuId],
  );
  const fuQ = fuQuestion.rows[0] as Record<string, unknown>;
  assert.equal(fuQ.is_follow_up, true);
  assert.equal(fuQ.source, "follow_up");
  assert.equal(fuQ.follow_up_of_question_id, questions[0].id);
  // Linked to the ORIGINAL question's competency — the follow-up
  // re-tests the same weak point, never a different competency.
  assert.equal(fuQ.competency_id, questions[0].competency_id);
  // The follow-up question's own expected points are the missed ones.
  assert.ok(Array.isArray(fuQ.expected_points) && (fuQ.expected_points as string[]).length > 0);
  // The text must not reveal the expected answer: no full expected
  // point, and no 6-word window of any expected point, may appear.
  const text = fuQ.question as string;
  assert.ok(text.length > 10, "follow-up text is a real question");
  assert.equal(
    containsExpectedAnswer(text, questions[0].expected_points as string[]),
    false,
    "follow-up text must not contain an expected-answer phrase",
  );
  for (const point of questions[0].expected_points as string[]) {
    assert.equal(
      text.toLowerCase().includes(point.toLowerCase()),
      false,
      "follow-up text must not contain a full expected point",
    );
  }
});

// ── 3. Follow-up answer evaluated, stored separately, never chains ─────

test("F5: follow-up answer is evaluated and stored separately; a strong follow-up answer generates no second follow-up", async (t) => {
  if (await skipIfNoDb(t)) return;
  const begun = await beginInterview("fu-strong");
  const { seed, interviewId, questions } = begun;
  t.after(() => cleanupSeed({ ...seed, interviewId }));

  const fuId = await generateFollowUp(begun);
  const fuAnswer = await strongFollowUpAnswer(fuId);
  const rFu = await submitSessionAnswer({
    interviewId,
    candidateId: seed.candidateId,
    questionId: fuId,
    answer: fuAnswer,
  });
  assert.equal(rFu.outcome, "complete", `strong follow-up answer should score Complete (got ${rFu.outcome} ${rFu.score})`);
  assert.equal(rFu.followUp, null, "answering a follow-up must never generate another");
  assert.equal(rFu.evaluation?.provider, "mock");
  assert.equal(rFu.evaluation?.method, "deterministic");
  assert.equal(rFu.evaluation?.status, "scored");
  const stored = await storedFollowup(fuId);
  assert.equal(stored?.answer, fuAnswer.trim());
  assert.ok(typeof stored?.score === "string" || typeof stored?.score === "number");
  assert.equal(Number(stored?.score), rFu.score);
  // Stored separately: never in interview_answers.
  const inAnswers = await pool.query(
    `SELECT COUNT(*)::int AS n FROM interview_answers WHERE question_id = $1`,
    [fuId],
  );
  assert.equal(inAnswers.rows[0].n, 0);
  // Still exactly one follow-up in the interview.
  const fuCount = await pool.query(
    `SELECT COUNT(*)::int AS n FROM interview_followups WHERE interview_id = $1`,
    [interviewId],
  );
  assert.equal(fuCount.rows[0].n, 1);
  // The initial scoring attempt is recorded for the follow-up too
  // (P1 F5 — previously a follow-up scoring left no attempt row).
  const attempts = await attemptsFor(interviewId, fuId);
  assert.equal(attempts.length, 1, "initial follow-up scoring recorded as attempt 1");
  assert.equal(attempts[0].state, "completed");
  assert.equal(attempts[0].failure_kind, null);
});

test("F5: a weak follow-up answer (Missed) also generates no second follow-up", async (t) => {
  if (await skipIfNoDb(t)) return;
  const begun = await beginInterview("fu-weak");
  const { seed, interviewId, questions } = begun;
  t.after(() => cleanupSeed({ ...seed, interviewId }));

  const fuId = await generateFollowUp(begun);
  const rFu = await submitSessionAnswer({
    interviewId,
    candidateId: seed.candidateId,
    questionId: fuId,
    answer: VAGUE_ANSWER,
  });
  assert.equal(rFu.outcome, "missed", `vague follow-up answer should score Missed (got ${rFu.outcome} ${rFu.score})`);
  assert.equal(rFu.followUp, null, "a weak follow-up answer must not chain a second follow-up");
  const fuCount = await pool.query(
    `SELECT COUNT(*)::int AS n FROM interview_followups WHERE interview_id = $1`,
    [interviewId],
  );
  assert.equal(fuCount.rows[0].n, 1);
});

// ── 4. Follow-up submission immutable ────────────────────────────────────

test("F5: follow-up submission is immutable — re-submit returns 409 and the stored answer is unchanged", async (t) => {
  if (await skipIfNoDb(t)) return;
  const begun = await beginInterview("fu-immutable");
  const { seed, interviewId, questions } = begun;
  t.after(() => cleanupSeed({ ...seed, interviewId }));

  const fuId = await generateFollowUp(begun);
  const fuAnswer = await strongFollowUpAnswer(fuId);
  await submitSessionAnswer({
    interviewId,
    candidateId: seed.candidateId,
    questionId: fuId,
    answer: fuAnswer,
  });
  let err: unknown;
  try {
    await submitSessionAnswer({
      interviewId,
      candidateId: seed.candidateId,
      questionId: fuId,
      answer: "A completely different follow-up answer.",
      confirmShort: true,
    });
  } catch (e) {
    err = e;
  }
  expectApiError(err, 409);
  const stored = await storedFollowup(fuId);
  assert.equal(stored?.answer, fuAnswer.trim(), "re-submit must not overwrite the locked follow-up answer");
});

// ── 5. Follow-up evaluation retry ────────────────────────────────────────

/** Simulate the state a live scoring failure would have left on a
 *  follow-up: pending evaluation + null score on the follow-up row,
 *  and the initial attempt recorded as retryable_failed / server_error.
 *  (In mock mode scoring never fails, so the failure state is seeded
 *  directly — the retry itself then runs the real deterministic scorer
 *  against the stored answer.) */
async function simulateLiveFollowUpFailure(
  interviewId: string,
  followUpId: string,
): Promise<void> {
  const pendingEvaluation = {
    dimensions: {
      technicalCorrectness: null,
      depthOfUnderstanding: null,
      relevance: null,
      projectEvidence: null,
      communicationClarity: null,
    },
    method: "llm",
    provider: "live",
    model: "test-model",
    notes: "AI evaluation failed — answer retained, evaluation pending.",
    status: "pending",
    error: "AI evaluation unavailable at scoring time; no score was substituted.",
    failureKind: "server_error",
    failureDetail: { kind: "server_error", httpStatus: 500, detail: "LLM provider error: HTTP 500" },
  };
  await pool.query(
    `UPDATE interview_followups SET evaluation = $1, score = NULL WHERE question_id = $2`,
    [JSON.stringify(pendingEvaluation), followUpId],
  );
  await pool.query(
    `UPDATE interview_evaluation_attempts
        SET state = 'retryable_failed', failure_kind = 'server_error',
            failure_detail = $1, score = NULL, updated_at = now()
      WHERE interview_id = $2 AND question_id = $3 AND attempt_number = 1`,
    [
      JSON.stringify({ kind: "server_error", httpStatus: 500, detail: "LLM provider error: HTTP 500" }),
      interviewId,
      followUpId,
    ],
  );
}

test("F5: follow-up retry succeeds after a simulated live failure and the finished report picks the retried score up", async (t) => {
  if (await skipIfNoDb(t)) return;
  const begun = await beginInterview("fu-retry");
  const { seed, interviewId, questions } = begun;
  t.after(() => cleanupSeed({ ...seed, interviewId }));

  const fuId = await generateFollowUp(begun);
  const fuAnswer = await strongFollowUpAnswer(fuId);
  const rFu = await submitSessionAnswer({
    interviewId,
    candidateId: seed.candidateId,
    questionId: fuId,
    answer: fuAnswer,
  });
  assert.equal(rFu.outcome, "complete");
  const scoredScore = rFu.score;
  assert.ok(typeof scoredScore === "number");

  // Simulate the live failure, then retry from the stored answer only.
  await simulateLiveFollowUpFailure(interviewId, fuId);
  const failed = await storedFollowup(fuId);
  assert.equal(failed?.score, null, "simulated failure clears the follow-up score");
  assert.equal((failed?.evaluation as { status: string }).status, "pending");

  const retried = await retryEvaluation({
    interviewId,
    candidateId: seed.candidateId,
    questionId: fuId,
  });
  assert.equal(retried.state, "completed");
  assert.equal(retried.idempotent, false);
  assert.equal(retried.attempts, 2);
  assert.equal(retried.score, scoredScore, "retry re-scores the stored answer deterministically");
  const attempts = await attemptsFor(interviewId, fuId);
  assert.equal(attempts.length, 2);
  assert.equal(attempts[1].state, "completed");
  assert.equal(Number(attempts[1].score), scoredScore);
  // The submitted follow-up answer is untouched — the retry result
  // lives on the attempt row, not on the follow-up row.
  const stored = await storedFollowup(fuId);
  assert.equal(stored?.answer, fuAnswer.trim());
  assert.equal(stored?.score, null, "retry must not rewrite the follow-up row's score");

  // Finish the interview: the report must pick the retried follow-up
  // score up (mean over scored questions — this one question).
  for (let i = 1; i < 7; i++) {
    const state = await getSessionState({ interviewId, candidateId: seed.candidateId });
    assert.ok(state.currentQuestion, `expected a current question before Q${i + 1}`);
    assert.equal(state.currentQuestion.id, questions[i].id);
    await submitSessionAnswer({
      interviewId,
      candidateId: seed.candidateId,
      questionId: questions[i].id,
      answer: strongAnswer(questions[i]),
    });
  }
  const report = await finishSession({ interviewId, candidateId: seed.candidateId });
  assert.equal(report.perQuestion[0].followUp?.score, scoredScore);
  assert.equal(
    (report.perQuestion[0].followUp?.evaluation as { status: string } | null)?.status,
    "scored",
  );
  assert.equal(report.perQuestion[0].score, scoredScore);
  assert.equal(report.perQuestion[0].evaluationState, "completed");
  assert.equal(report.followUpsUsed, 1);
  assert.equal(report.pendingEvaluations, 0);
  assert.equal(report.failedEvaluations, 0);
});

test("F5: retry of a scored follow-up evaluation is idempotent (same score, no new attempt row)", async (t) => {
  if (await skipIfNoDb(t)) return;
  const begun = await beginInterview("fu-retry-idem");
  const { seed, interviewId, questions } = begun;
  t.after(() => cleanupSeed({ ...seed, interviewId }));

  const fuId = await generateFollowUp(begun);
  const fuAnswer = await strongFollowUpAnswer(fuId);
  const rFu = await submitSessionAnswer({
    interviewId,
    candidateId: seed.candidateId,
    questionId: fuId,
    answer: fuAnswer,
  });
  assert.ok(typeof rFu.score === "number");
  const attemptsBefore = await attemptsFor(interviewId, fuId);
  assert.equal(attemptsBefore.length, 1);
  assert.equal(attemptsBefore[0].state, "completed");

  const retried = await retryEvaluation({
    interviewId,
    candidateId: seed.candidateId,
    questionId: fuId,
  });
  assert.equal(retried.idempotent, true);
  assert.equal(retried.state, "completed");
  assert.equal(retried.score, rFu.score, "same stored score returned");
  const attemptsAfter = await attemptsFor(interviewId, fuId);
  assert.equal(attemptsAfter.length, 1, "idempotent retry adds no attempt row");
  const stored = await storedFollowup(fuId);
  assert.equal(stored?.answer, fuAnswer.trim());
});

test("F5: retry of an unanswered follow-up returns 404 (only submitted answers can be retried)", async (t) => {
  if (await skipIfNoDb(t)) return;
  const begun = await beginInterview("fu-retry-404");
  const { seed, interviewId } = begun;
  t.after(() => cleanupSeed({ ...seed, interviewId }));

  const fuId = await generateFollowUp(begun);
  const stored = await storedFollowup(fuId);
  assert.equal(stored?.answer, null, "follow-up has no answer yet");
  let err: unknown;
  try {
    await retryEvaluation({
      interviewId,
      candidateId: seed.candidateId,
      questionId: fuId,
    });
  } catch (e) {
    err = e;
  }
  expectApiError(err, 404);
  assert.equal((await attemptsFor(interviewId, fuId)).length, 0, "rejected retry adds no attempt row");
});

test("db: teardown closes the pool", async () => {
  await pool.end();
});
