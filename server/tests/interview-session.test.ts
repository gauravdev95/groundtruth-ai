import test from "node:test";
import assert from "node:assert/strict";

// Phase C — real AI technical interview sessions (directive §12).
// Service-level tests against DATABASE_URL when a Postgres is reachable,
// SKIPPING (not failing) when there is none — the existing DB-test
// convention (see tests/auth.db.test.ts). Migrations 000–011 must have
// been applied first (npm run migrate). No live AI is used: with no
// AI_API_* env the LLM client runs its deterministic mock provider and
// every record is labelled provider "mock".

import { pool } from "../src/config/db";
import { ApiError } from "../src/middleware/errorHandler";
import {
  generateInterview,
  toPublicGenerateResult,
  getInterviewReport,
  loadInterviewForCandidate,
  type InterviewQuestionRow,
} from "../src/services/interview";
import {
  startSession,
  confirmReadiness,
  getSessionState,
  submitSessionAnswer,
  explainAgain,
  finishSession,
  scoreSessionAnswer,
  recruiterMayViewInterview,
  getInterviewReportForRecruiter,
  containsExpectedAnswer,
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
  const email = `phasec-${tag}-${RUN}@example.com`;
  const user = await pool.query(
    `INSERT INTO users (email, full_name, role, password_hash)
     VALUES ($1, $2, 'candidate', 'test-hash') RETURNING id`,
    [email, `Phase C ${tag}`],
  );
  const userId = user.rows[0].id as string;
  const cand = await pool.query(
    `INSERT INTO candidates (user_id, full_name, email, target_roles)
     VALUES ($1, $2, $3, $4) RETURNING id`,
    [userId, `Phase C ${tag}`, email, targetRoles],
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

function expectApiError(err: unknown, status: number): void {
  assert.ok(err instanceof ApiError, `expected ApiError, got ${String(err)}`);
  assert.equal((err as ApiError).status, status);
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

/** A partial-coverage answer for the second (databases) question. */
const PARTIAL_ANSWER_Q2 =
  "I designed a normalised schema with correct joins and aggregates and sensible indexes " +
  "for the challenge data. The tables link through keys and the queries return the rows the " +
  "feature needs. I kept the model small and grouped by domain so the surface stays easy to " +
  "reason about and extend later.";

interface Begun {
  seed: Seed;
  interviewId: string;
  questions: InterviewQuestionRow[];
}

/** Seed → generate → start → readiness → first question served. */
async function beginInterview(
  tag: string,
  roleId?: string,
): Promise<Begun> {
  const seed = await seedCandidate(tag);
  const gen = await generateInterview({
    assessmentId: seed.assessmentId,
    candidateId: seed.candidateId,
    roleId,
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

// ── 1. Pre-generation ────────────────────────────────────────────────────

test("phase C: exactly 7 questions pre-generated and persisted with competency specs", async (t) => {
  if (await skipIfNoDb(t)) return;
  const seed = await seedCandidate("gen");
  t.after(() => cleanupSeed(seed));
  const gen = await generateInterview({
    assessmentId: seed.assessmentId,
    candidateId: seed.candidateId,
  });
  assert.equal(gen.questions.length, 7, "exactly 7 questions");
  assert.equal(gen.roleId, "backend-developer", "role resolved from target_roles");
  assert.equal(gen.frameworkVersion, "v1.0.0");
  assert.equal(gen.generationProvider, "deterministic", "no live AI configured → labelled deterministic");
  assert.equal(gen.generationMethod, "deterministic");
  const competencyIds = new Set(gen.questions.map((q) => q.competency_id));
  assert.equal(competencyIds.size, 5, "all 5 role competencies covered");
  for (const q of gen.questions) {
    assert.ok(q.competency_id, "competency_id persisted");
    assert.ok(q.difficulty, "difficulty persisted");
    assert.ok(Array.isArray(q.expected_points) && q.expected_points.length >= 3, "expected points persisted");
    assert.equal(Object.keys(q.scoring_rubric).length, 5, "5-dimension rubric persisted");
    assert.equal(q.max_time_seconds, 300);
    assert.equal(q.framework_version, "v1.0.0");
    assert.equal(q.source, "pre_generated");
    assert.equal(q.is_follow_up, false);
  }
  // Persisted in the DB before any session starts.
  const stored = await pool.query(
    `SELECT COUNT(*)::int AS n FROM interview_questions WHERE interview_id = $1`,
    [gen.interview.id],
  );
  assert.equal(stored.rows[0].n, 7);
  // Idempotent: a second generate returns the same interview + questions.
  const again = await generateInterview({
    assessmentId: seed.assessmentId,
    candidateId: seed.candidateId,
  });
  assert.equal(again.interview.id, gen.interview.id);
  assert.equal(again.questions.length, 7);
});

test("phase G: public generate result never leaks the answer key (expected points / rubrics / question text)", async (t) => {
  if (await skipIfNoDb(t)) return;
  const seed = await seedCandidate("gen-public");
  t.after(() => cleanupSeed(seed));
  const gen = await generateInterview({
    assessmentId: seed.assessmentId,
    candidateId: seed.candidateId,
  });
  const pub = toPublicGenerateResult(gen);
  assert.equal(pub.questionCount, 7, "count only, no question rows");
  assert.equal(pub.roleId, "backend-developer");
  assert.equal(pub.generationProvider, "deterministic");
  // Nothing a candidate could use to see future questions or the marking
  // scheme may survive serialisation.
  const serialised = JSON.stringify(pub);
  assert.ok(!("questions" in pub), "no questions array in the public shape");
  for (const leak of ["expected_points", "scoring_rubric", "expectedPoints", "scoringRubric"]) {
    assert.equal(serialised.includes(leak), false, `public shape must not contain ${leak}`);
  }
  for (const q of gen.questions) {
    assert.equal(serialised.includes(q.question), false, "no question text in the public shape");
  }
});

test("phase C: ownership — another candidate cannot generate for this assessment", async (t) => {
  if (await skipIfNoDb(t)) return;
  const seed = await seedCandidate("own");
  const other = await seedCandidate("own-other");
  t.after(() => cleanupSeed(seed));
  t.after(() => cleanupSeed(other));
  let err: unknown;
  try {
    await generateInterview({ assessmentId: seed.assessmentId, candidateId: other.candidateId });
  } catch (e) {
    err = e;
  }
  expectApiError(err, 403);
});

// ── 2. Session lifecycle + one question at a time ────────────────────────

test("phase C: start → readiness gate → one question at a time", async (t) => {
  if (await skipIfNoDb(t)) return;
  const seed = await seedCandidate("lifecycle");
  const gen = await generateInterview({
    assessmentId: seed.assessmentId,
    candidateId: seed.candidateId,
  });
  const interviewId = gen.interview.id as string;
  t.after(() => cleanupSeed({ ...seed, interviewId }));

  // No session yet: state is a 404.
  let err: unknown;
  try {
    await getSessionState({ interviewId, candidateId: seed.candidateId });
  } catch (e) {
    err = e;
  }
  expectApiError(err, 404);

  const started = await startSession({ interviewId, candidateId: seed.candidateId });
  assert.equal(started.session.status, "intro");
  assert.equal(started.currentQuestion, null, "no question before readiness");
  // Idempotent start returns the same session.
  const startedAgain = await startSession({ interviewId, candidateId: seed.candidateId });
  assert.equal(startedAgain.session.id, started.session.id);

  // Readiness gate: unacknowledged → 400, and Q1 stays hidden.
  err = undefined;
  try {
    await confirmReadiness({ interviewId, candidateId: seed.candidateId, acknowledged: false });
  } catch (e) {
    err = e;
  }
  expectApiError(err, 400);
  const beforeReady = await getSessionState({ interviewId, candidateId: seed.candidateId });
  assert.equal(beforeReady.session.status, "intro");
  assert.equal(beforeReady.currentQuestion, null);

  const ready = await confirmReadiness({
    interviewId,
    candidateId: seed.candidateId,
    acknowledged: true,
  });
  assert.equal(ready.session.status, "ready");

  // First session read begins the interview and serves ONLY Q1.
  const state = await getSessionState({ interviewId, candidateId: seed.candidateId });
  assert.equal(state.session.status, "in_progress");
  assert.ok(state.session.startedAt);
  assert.ok(state.session.expiresAt);
  assert.ok((state.session.timeRemainingSeconds ?? 0) > 0);
  const q = state.currentQuestion as Record<string, unknown>;
  assert.equal(q.questionNumber, 1);
  assert.equal(q.totalQuestions, 7);
  assert.equal(q.id, gen.questions[0].id);
  assert.ok(typeof q.question === "string" && (q.question as string).length > 10);
  // Future questions, expected points, rubrics and context never leak.
  const serialised = JSON.stringify(state);
  assert.ok(!serialised.includes("expected_points"), "expected points must not leak");
  assert.ok(!serialised.includes("scoring_rubric"), "rubric must not leak");
  assert.ok(!serialised.includes(gen.questions[1].question), "Q2 text must not leak");
  assert.ok(!serialised.includes(gen.questions[6].question), "Q7 text must not leak");
  assert.equal(state.progress.answered, 0);
});

// ── 3. Answer flow ───────────────────────────────────────────────────────

test("phase C: empty rejected, short warning, confirm stores, duplicate + non-current 409", async (t) => {
  if (await skipIfNoDb(t)) return;
  const begun = await beginInterview("answer");
  const { seed, interviewId, questions } = begun;
  t.after(() => cleanupSeed({ ...seed, interviewId }));
  const q1 = questions[0].id;

  // Empty → 400.
  let err: unknown;
  try {
    await submitSessionAnswer({ interviewId, candidateId: seed.candidateId, questionId: q1, answer: "   " });
  } catch (e) {
    err = e;
  }
  expectApiError(err, 400);

  // Short (< 20 words) → warning flag, nothing stored.
  const short = await submitSessionAnswer({
    interviewId,
    candidateId: seed.candidateId,
    questionId: q1,
    answer: "It is a REST API with routes.",
  });
  assert.equal(short.shortAnswerWarning, true);
  assert.equal(short.requiresConfirmation, true);
  assert.equal(short.evaluation, null);
  assert.equal(short.wordCount, 7);
  const stored0 = await pool.query(
    `SELECT COUNT(*)::int AS n FROM interview_answers WHERE question_id = $1`,
    [q1],
  );
  assert.equal(stored0.rows[0].n, 0, "short answer must not be stored before confirmation");

  // Same answer with confirmShort → stored, scored, labelled mock.
  const done = await submitSessionAnswer({
    interviewId,
    candidateId: seed.candidateId,
    questionId: q1,
    answer: "It is a REST API with routes.",
    confirmShort: true,
  });
  assert.equal(done.shortAnswerWarning, false);
  assert.ok(done.evaluation, "evaluation present after confirm");
  assert.equal(done.evaluation?.provider, "mock");
  assert.equal(done.evaluation?.method, "deterministic");
  assert.equal(done.evaluation?.status, "scored");
  assert.ok(typeof done.score === "number");
  const stored1 = await pool.query(
    `SELECT answer, locked_at, evaluation_provider FROM interview_answers WHERE question_id = $1`,
    [q1],
  );
  assert.equal(stored1.rows.length, 1);
  assert.equal(stored1.rows[0].answer, "It is a REST API with routes.");
  assert.ok(stored1.rows[0].locked_at, "answer locked");
  assert.equal(stored1.rows[0].evaluation_provider, "mock");

  // Duplicate submit → 409 (answer immutable). confirmShort is set so
  // the short-answer warning cannot mask the duplicate check.
  err = undefined;
  try {
    await submitSessionAnswer({
      interviewId,
      candidateId: seed.candidateId,
      questionId: q1,
      answer: "A completely different answer.",
      confirmShort: true,
    });
  } catch (e) {
    err = e;
  }
  expectApiError(err, 409);

  // Non-current question (Q3 while Q2 is current) → 409.
  err = undefined;
  try {
    await submitSessionAnswer({
      interviewId,
      candidateId: seed.candidateId,
      questionId: questions[2].id,
      answer: strongAnswer(questions[2]),
    });
  } catch (e) {
    err = e;
  }
  expectApiError(err, 409);

  // Stored answer is unchanged after the rejected re-submits.
  const stored2 = await pool.query(
    `SELECT answer FROM interview_answers WHERE question_id = $1`,
    [q1],
  );
  assert.equal(stored2.rows[0].answer, "It is a REST API with routes.");
});

// ── 4. Follow-ups ────────────────────────────────────────────────────────

test("phase C: partial answer → exactly one follow-up, stored separately; max 1 per interview", async (t) => {
  if (await skipIfNoDb(t)) return;
  const begun = await beginInterview("followup");
  const { seed, interviewId, questions } = begun;
  t.after(() => cleanupSeed({ ...seed, interviewId }));

  // Q1 partial (~49) → follow-up generated, and it becomes current.
  const r1 = await submitSessionAnswer({
    interviewId,
    candidateId: seed.candidateId,
    questionId: questions[0].id,
    answer: PARTIAL_ANSWER_Q1,
  });
  assert.equal(r1.outcome, "partial", `expected partial, got ${r1.outcome} (score ${r1.score})`);
  assert.ok(r1.followUp, "a follow-up must be generated for a Partial answer");
  assert.ok(r1.next && r1.next.questionId === r1.followUp.id, "follow-up is next");
  const fuRows = await pool.query(
    `SELECT * FROM interview_followups WHERE interview_id = $1`,
    [interviewId],
  );
  assert.equal(fuRows.rows.length, 1, "exactly one follow-up row");
  assert.equal(fuRows.rows[0].original_question_id, questions[0].id);
  const fuQuestion = await pool.query(
    `SELECT * FROM interview_questions WHERE id = $1`,
    [fuRows.rows[0].question_id],
  );
  assert.equal(fuQuestion.rows[0].is_follow_up, true);
  assert.equal(fuQuestion.rows[0].source, "follow_up");
  assert.equal(fuQuestion.rows[0].follow_up_of_question_id, questions[0].id);
  assert.equal(fuQuestion.rows[0].competency_id, questions[0].competency_id);
  // The follow-up text must not reveal the expected answer.
  assert.equal(
    containsExpectedAnswer(
      fuQuestion.rows[0].question as string,
      questions[0].expected_points as string[],
    ),
    false,
  );
  // Original answer still the submitted one (immutable).
  const orig = await pool.query(
    `SELECT answer FROM interview_answers WHERE question_id = $1`,
    [questions[0].id],
  );
  assert.equal(orig.rows[0].answer, PARTIAL_ANSWER_Q1.trim());

  // Answer the follow-up: stored SEPARATELY in interview_followups.
  const fuId = fuRows.rows[0].question_id as string;
  const fuAnswer = strongAnswer(questions[0]);
  const rFu = await submitSessionAnswer({
    interviewId,
    candidateId: seed.candidateId,
    questionId: fuId,
    answer: fuAnswer,
  });
  assert.ok(typeof rFu.score === "number");
  const fuStored = await pool.query(
    `SELECT answer, score FROM interview_followups WHERE question_id = $1`,
    [fuId],
  );
  assert.equal(fuStored.rows[0].answer, fuAnswer.trim());
  const fuInAnswers = await pool.query(
    `SELECT COUNT(*)::int AS n FROM interview_answers WHERE question_id = $1`,
    [fuId],
  );
  assert.equal(fuInAnswers.rows[0].n, 0, "follow-up answer must not live in interview_answers");

  // A second Partial (Q2) must NOT create a second follow-up.
  const cur = await currentQuestionId(begun);
  assert.equal(cur, questions[1].id, "current question is Q2 after the follow-up");
  const r2 = await submitSessionAnswer({
    interviewId,
    candidateId: seed.candidateId,
    questionId: questions[1].id,
    answer: PARTIAL_ANSWER_Q2,
  });
  assert.equal(r2.outcome, "partial");
  assert.equal(r2.followUp, null, "max 1 follow-up per interview");
  const fuCount = await pool.query(
    `SELECT COUNT(*)::int AS n FROM interview_followups WHERE interview_id = $1`,
    [interviewId],
  );
  assert.equal(fuCount.rows[0].n, 1);
});

// ── 5. Explain Again ─────────────────────────────────────────────────────

test("phase C: explain again rephrases without leaking the expected answer; budgets enforced", async (t) => {
  if (await skipIfNoDb(t)) return;
  const begun = await beginInterview("explain");
  const { seed, interviewId, questions } = begun;
  t.after(() => cleanupSeed({ ...seed, interviewId }));

  const first = await explainAgain({ interviewId, candidateId: seed.candidateId });
  assert.ok(first.rephrasedQuestion.length > 10);
  assert.equal(first.provider, "mock", "no live AI → deterministic rephrase, labelled mock");
  assert.equal(
    containsExpectedAnswer(first.rephrasedQuestion, questions[0].expected_points as string[]),
    false,
    "rephrase must never contain expected-answer text",
  );
  assert.equal(first.remainingForQuestion, 0);
  assert.equal(first.remainingForSession, 1);

  // Second Explain Again on the same question → 409 (max 1 per question).
  let err: unknown;
  try {
    await explainAgain({ interviewId, candidateId: seed.candidateId });
  } catch (e) {
    err = e;
  }
  expectApiError(err, 409);

  // Answer Q1, use the second (last) Explain Again on Q2, then the
  // session budget is exhausted.
  await submitSessionAnswer({
    interviewId,
    candidateId: seed.candidateId,
    questionId: questions[0].id,
    answer: strongAnswer(questions[0]),
  });
  const second = await explainAgain({ interviewId, candidateId: seed.candidateId });
  assert.equal(second.remainingForSession, 0);
  await submitSessionAnswer({
    interviewId,
    candidateId: seed.candidateId,
    questionId: questions[1].id,
    answer: strongAnswer(questions[1]),
  });
  err = undefined;
  try {
    await explainAgain({ interviewId, candidateId: seed.candidateId });
  } catch (e) {
    err = e;
  }
  expectApiError(err, 409);
});

// ── 6. Server timers ─────────────────────────────────────────────────────

test("phase C: server timer enforced — late submit 410, deadline advances, expiry finalises", async (t) => {
  if (await skipIfNoDb(t)) return;
  const begun = await beginInterview("timer");
  const { seed, interviewId, questions } = begun;
  t.after(() => cleanupSeed({ ...seed, interviewId }));

  // Move Q1's deadline into the past, then submit → 410 (not accepted).
  await pool.query(
    `UPDATE interview_sessions SET current_question_deadline_at = now() - interval '5 seconds'
      WHERE interview_id = $1`,
    [interviewId],
  );
  let err: unknown;
  try {
    await submitSessionAnswer({
      interviewId,
      candidateId: seed.candidateId,
      questionId: questions[0].id,
      answer: strongAnswer(questions[0]),
    });
  } catch (e) {
    err = e;
  }
  expectApiError(err, 410);
  const noAnswer = await pool.query(
    `SELECT COUNT(*)::int AS n FROM interview_answers WHERE question_id = $1`,
    [questions[0].id],
  );
  assert.equal(noAnswer.rows[0].n, 0, "late answer must not be stored");

  // Reading the session advances past the expired question (Q1 unanswered).
  const advanced = await getSessionState({ interviewId, candidateId: seed.candidateId });
  assert.equal(
    (advanced.currentQuestion as Record<string, unknown> | null)?.id,
    questions[1].id,
    "deadline expiry advances to the next question",
  );

  // Move the session expiry into the past: the session finalises as expired.
  await pool.query(
    `UPDATE interview_sessions SET expires_at = now() - interval '5 seconds' WHERE interview_id = $1`,
    [interviewId],
  );
  const expired = await getSessionState({ interviewId, candidateId: seed.candidateId });
  assert.equal(expired.session.status, "expired");
  const report = await pool.query(
    `SELECT * FROM interview_reports WHERE interview_id = $1`,
    [interviewId],
  );
  assert.equal(report.rows.length, 1, "expiry still persists the immutable report");
});

// ── 7. Completion + read-only report ─────────────────────────────────────

test("phase C: finish after 7 + follow-up saves the immutable report; GET report is read-only", async (t) => {
  if (await skipIfNoDb(t)) return;
  const begun = await beginInterview("finish");
  const { seed, interviewId, questions } = begun;
  t.after(() => cleanupSeed({ ...seed, interviewId }));

  // GET report BEFORE finish: null (read-only — viewing never finalises).
  const before = await getInterviewReport(interviewId, seed.candidateId);
  assert.equal(before, null);
  const interviewBefore = await loadInterviewForCandidate(interviewId, seed.candidateId);
  assert.equal(interviewBefore.status, "scheduled", "report read must not complete the interview");

  // Q1 partial → follow-up; answer it; then Q2–Q7 strong.
  const r1 = await submitSessionAnswer({
    interviewId,
    candidateId: seed.candidateId,
    questionId: questions[0].id,
    answer: PARTIAL_ANSWER_Q1,
  });
  assert.ok(r1.followUp, "follow-up expected");
  await submitSessionAnswer({
    interviewId,
    candidateId: seed.candidateId,
    questionId: r1.followUp.id,
    answer: strongAnswer(questions[0]),
  });
  for (let i = 1; i < 7; i++) {
    const cur = await currentQuestionId(begun);
    assert.equal(cur, questions[i].id, `expected Q${i + 1} as current`);
    const r = await submitSessionAnswer({
      interviewId,
      candidateId: seed.candidateId,
      questionId: questions[i].id,
      answer: strongAnswer(questions[i]),
    });
    assert.equal(r.outcome, "complete", `Q${i + 1} should score Complete (got ${r.outcome} ${r.score})`);
  }
  const state = await getSessionState({ interviewId, candidateId: seed.candidateId });
  assert.equal(state.allAnswered, true);
  assert.equal(state.progress.answered, 8, "7 originals + 1 follow-up answered");

  const report = await finishSession({ interviewId, candidateId: seed.candidateId });
  assert.ok(typeof report.finalScore === "number");
  assert.ok((report.finalScore as number) >= 60, "strong answers should score >= 60");
  assert.equal(report.roleId, "backend-developer");
  assert.equal(report.frameworkVersion, "v1.0.0");
  assert.equal(Object.keys(report.dimensionAverages).length, 5);
  for (const dim of ["technicalCorrectness", "depthOfUnderstanding", "relevance", "projectEvidence", "communicationClarity"]) {
    assert.ok(typeof report.dimensionAverages[dim] === "number", `dimension ${dim} averaged`);
  }
  assert.equal(report.competencyScores.length, 5, "one score per role competency");
  assert.equal(report.perQuestion.length, 7);
  assert.equal(report.followUpsUsed, 1);
  assert.equal(report.pendingEvaluations, 0);

  // Persisted immutably + interview marked completed in the transaction.
  const stored = await pool.query(
    `SELECT * FROM interview_reports WHERE interview_id = $1`,
    [interviewId],
  );
  assert.equal(stored.rows.length, 1);
  assert.equal(stored.rows[0].framework_version, "v1.0.0");
  const sessionRow = await pool.query(
    `SELECT status FROM interview_sessions WHERE interview_id = $1`,
    [interviewId],
  );
  assert.equal(sessionRow.rows[0].status, "completed");
  const interviewAfter = await loadInterviewForCandidate(interviewId, seed.candidateId);
  assert.equal(interviewAfter.status, "completed");

  // GET report now returns the stored report; finish is idempotent.
  const after = await getInterviewReport(interviewId, seed.candidateId);
  assert.ok(after, "report available after finish");
  assert.equal((after as unknown as { finalScore: number }).finalScore, report.finalScore);
  const again = await finishSession({ interviewId, candidateId: seed.candidateId });
  assert.equal(again.finalScore, report.finalScore);
});

// ── 8. Recruiter isolation ───────────────────────────────────────────────

test("phase C: unauthorized recruiter rejected, authorized recruiter + admin allowed", async (t) => {
  if (await skipIfNoDb(t)) return;
  const begun = await beginInterview("recruiter");
  const { seed, interviewId, questions } = begun;
  t.after(() => cleanupSeed({ ...seed, interviewId }));

  // Finish the interview so a report exists.
  for (let i = 0; i < 7; i++) {
    const cur = await currentQuestionId(begun);
    assert.equal(cur, questions[i].id);
    await submitSessionAnswer({
      interviewId,
      candidateId: seed.candidateId,
      questionId: questions[i].id,
      answer: strongAnswer(questions[i]),
    });
  }
  await finishSession({ interviewId, candidateId: seed.candidateId });

  // Recruiter with no application to this candidate → rejected.
  const recUser = await pool.query(
    `INSERT INTO users (email, full_name, role, password_hash)
     VALUES ($1, 'Recruiter One', 'recruiter', 'test-hash') RETURNING id`,
    [`phasec-rec-${RUN}@example.com`],
  );
  const recruiterId = recUser.rows[0].id as string;
  t.after(() => pool.query(`DELETE FROM users WHERE id = $1`, [recruiterId]));
  const company = await pool.query(
    `INSERT INTO companies (name, created_by) VALUES ('Phase C Co', $1) RETURNING id`,
    [recruiterId],
  );
  const companyId = company.rows[0].id as string;
  const job = await pool.query(
    `INSERT INTO jobs (company_id, title, description) VALUES ($1, 'Backend Dev', 'desc') RETURNING id`,
    [companyId],
  );
  const jobId = job.rows[0].id as string;

  assert.equal(
    await recruiterMayViewInterview({ interviewId, recruiterUserId: recruiterId, isAdmin: false }),
    false,
  );
  let err: unknown;
  try {
    await getInterviewReportForRecruiter({ interviewId, recruiterUserId: recruiterId, isAdmin: false });
  } catch (e) {
    err = e;
  }
  expectApiError(err, 403);

  // After the candidate applies to the recruiter's job → allowed.
  await pool.query(
    `INSERT INTO applications (candidate_id, job_id) VALUES ($1, $2)`,
    [seed.candidateId, jobId],
  );
  t.after(() => pool.query(`DELETE FROM applications WHERE candidate_id = $1 AND job_id = $2`, [seed.candidateId, jobId]));
  t.after(() => pool.query(`DELETE FROM jobs WHERE id = $1`, [jobId]));
  t.after(() => pool.query(`DELETE FROM companies WHERE id = $1`, [companyId]));
  assert.equal(
    await recruiterMayViewInterview({ interviewId, recruiterUserId: recruiterId, isAdmin: false }),
    true,
  );
  const report = await getInterviewReportForRecruiter({
    interviewId,
    recruiterUserId: recruiterId,
    isAdmin: false,
  });
  assert.ok(report && typeof report.finalScore === "number");

  // Admin bypasses the application check.
  assert.equal(
    await recruiterMayViewInterview({ interviewId, recruiterUserId: recruiterId, isAdmin: true }),
    true,
  );
});

// ── 9. Answer locking (session flow) ─────────────────────────────────────
// Phase 2, G3.6: the legacy single-answer endpoint (and its
// answerQuestion service) were removed — the session flow is the only
// submit path now. The same guarantees it used to cover (insert-once
// locking + the DB immutability trigger) are asserted here through the
// live session flow instead.

test("phase C: session answer locks too — re-submit 409 and DB trigger rejects UPDATE", async (t) => {
  if (await skipIfNoDb(t)) return;
  const begun = await beginInterview("legacy");
  const { seed, interviewId, questions } = begun;
  t.after(() => cleanupSeed({ ...seed, interviewId }));

  const first = await submitSessionAnswer({
    interviewId,
    candidateId: seed.candidateId,
    questionId: questions[0].id,
    answer: strongAnswer(questions[0]),
  });
  assert.ok(typeof first.score === "number");
  assert.equal(first.followUp, null, "a Complete answer creates no follow-up");

  let err: unknown;
  try {
    await submitSessionAnswer({
      interviewId,
      candidateId: seed.candidateId,
      questionId: questions[0].id,
      answer: "A different answer.",
    });
  } catch (e) {
    err = e;
  }
  expectApiError(err, 409);

  // The database trigger rejects a direct UPDATE of a submitted answer.
  let dbErr: unknown;
  try {
    await pool.query(
      `UPDATE interview_answers SET answer = 'tampered' WHERE question_id = $1`,
      [questions[0].id],
    );
  } catch (e) {
    dbErr = e;
  }
  assert.ok(dbErr instanceof Error, "UPDATE of a submitted answer must be rejected");
  assert.match((dbErr as Error).message, /immutable/);
});

test("db: teardown closes the pool", async () => {
  await pool.end();
});
