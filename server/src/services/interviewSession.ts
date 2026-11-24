import { pool } from "../config/db";
import { env } from "../config/env";
import { ApiError } from "../middleware/errorHandler";
import { chatJson, llmConfigured } from "./llm";
import {
  assessInterviewCoverage,
  categoryForScore,
  getFramework,
} from "./competencyScoringService";
import { FRAMEWORK_VERSION } from "../config/competencyFramework";
import {
  loadInterviewForCandidate,
  INTERVIEW_DIMENSIONS,
  type InterviewDimensionKey,
  type InterviewQuestionRow,
  type InterviewRow,
} from "./interview";
import { notifyCandidate } from "./notifications";
import type { Pool, PoolClient } from "pg";

/** Either the shared pool or one transaction client — helpers that run
 *  inside a transaction MUST take the transaction client, or they cannot
 *  see the rows the transaction just inserted (e.g. a new follow-up). */
type Db = Pool | PoolClient;

// ── Real AI technical interview — session flow (Phase C) ─────────────────
// Lifecycle: not_started → intro → ready → in_progress → completed | expired.
//   * Questions are pre-generated (exactly 7, frozen) by generateInterview
//     BEFORE any session exists — nothing is generated during the live
//     interview except at most ONE follow-up (Partial answers only).
//   * One question at a time: the session state returns ONLY the current
//     question. Future questions, expected points and rubrics are never
//     sent to the candidate.
//   * Timers are server-authoritative: the per-question deadline and the
//     session expiry are enforced here; a late submit is rejected (410),
//     never silently accepted. The client timer is display-only.
//   * Answers are insert-once and immutable (migration 011 trigger);
//     a duplicate submit is a 409.
//   * AI calls go through llm.ts only. When the LLM is not configured the
//     deterministic evaluator runs and the record is labelled provider
//     "mock". When the LLM IS configured but the call fails, the answer is
//     retained with evaluation status "pending" and NO score — a fabricated
//     score is never substituted.
//   * Text interview only — no voice. Judge0 is NOT configured.

export interface InterviewSessionRow {
  id: string;
  interview_id: string;
  candidate_id: string;
  status: string;
  started_at: string | null;
  expires_at: string | null;
  readiness_ack_at: string | null;
  completed_at: string | null;
  current_question_id: string | null;
  current_question_shown_at: string | null;
  current_question_deadline_at: string | null;
  questions_total: number;
  follow_ups_used: number;
  explain_again_count: number;
  explain_again_by_question: Record<string, number>;
  created_at: string;
  updated_at: string;
}

export const SESSION_ACTIVE_STATUSES = ["not_started", "intro", "ready", "in_progress"];

/**
 * Framework interview size (Phase 2, G3.2): a complete interview has
 * exactly 7 pre-generated original questions. This is the single
 * constant every completeness check uses — a stored report with fewer
 * rows (legacy, pre-Phase-C) can never read complete, however many of
 * its rows are scored. startSession enforces the same count at session
 * start; collectSources (competencyProfile) enforces it when reading a
 * stored report.
 */
export const EXPECTED_INTERVIEW_QUESTIONS = 7;

export type AnswerOutcome = "complete" | "partial" | "missed" | "pending";

export interface SessionAnswerEvaluation {
  dimensions: Record<InterviewDimensionKey, number | null>;
  method: "llm" | "deterministic";
  provider: "live" | "mock";
  model: string;
  notes: string;
  /** "scored" when dimensions carry real numbers; "pending" when the AI
   *  evaluation failed and no score was substituted. */
  status: "scored" | "pending";
  error?: string;
  /** P0 F3: structured failure classification (set only on pending
   *  evaluations). Never contains prompt or answer content. */
  failureKind?: EvaluationFailureKind;
  failureDetail?: { kind: EvaluationFailureKind; httpStatus?: number; detail: string };
}

// ── P0 F3: evaluation retry system ───────────────────────────────────────
// Root cause: a live scoring failure was caught silently, stored as
// "pending" with a generic note, and recorded nowhere — no retry, no
// attempt record, no log line. Every scoring attempt is now recorded in
// interview_evaluation_attempts (migration 013) with a structured
// failure kind, and a failed evaluation can be retried in a controlled,
// bounded way. Retries only ever re-run scoring against the STORED
// answer — the submitted answer is never unlocked, overwritten, or
// re-read from the request.

export type EvaluationFailureKind =
  | "timeout"
  | "rate_limited"
  | "auth_failed"
  | "server_error"
  | "network_error"
  | "invalid_response"
  | "unknown";

export type EvaluationState =
  | "pending"
  | "processing"
  | "completed"
  | "retryable_failed"
  | "permanently_failed"
  /**
   * Report-only (Phase 2, G3.1): the question was never answered, so
   * there is no evaluation to be pending — it must not be lumped in
   * with "pending". Never written to interview_evaluation_attempts
   * (migration 013 CHECK admits only the five attempt states above);
   * it appears only on SessionReport.perQuestion[].evaluationState.
   */
  | "unanswered";

/** Total scoring attempts allowed per question for transient failures
 *  (timeout / 429 / 5xx / network). Attempt 1 is the initial scoring
 *  at submit time, so at most 2 retries follow it. */
export const EVALUATION_MAX_ATTEMPTS = 3;
/** Total attempts allowed when every failure so far is a non-transient
 *  one (invalid model response, or an auth failure — a bad/revoked key
 *  will not fix itself by retrying): a permanent error is never
 *  retried indefinitely — 2 attempts, then permanently_failed. */
export const EVALUATION_MAX_INVALID_RESPONSE_ATTEMPTS = 2;
/** Total attempts allowed when every failure so far is an auth failure
 *  (HTTP 401/403 — invalid, expired or revoked key). Same cap as an
 *  invalid response: 2 attempts, then permanently_failed. A retry is
 *  still useful after the key is fixed; it must not spin forever. */
export const EVALUATION_MAX_AUTH_FAILED_ATTEMPTS = 2;
/** Base delay (ms) between evaluation attempts; overridable in tests
 *  via EVAL_RETRY_BASE_DELAY_MS. The llm.ts per-HTTP-call retries
 *  (max 3, 500ms base) sit INSIDE one evaluation attempt — these
 *  evaluation-level retries are on top, so the worst case per question
 *  is 3 evaluation attempts x 3 HTTP attempts, never unbounded. */
export const EVALUATION_RETRY_BASE_DELAY_MS = 1000;
export const EVALUATION_RETRY_MAX_DELAY_MS = 8000;
/** A "processing" attempt older than this is treated as abandoned
 *  (owner crashed mid-scoring) and reclaimed as retryable_failed so a
 *  later retry is not blocked forever by a stale in-flight row. */
export const EVALUATION_STALE_PROCESSING_MS = 5 * 60 * 1000;

export function evaluationRetryBaseDelayMs(): number {
  const n = Number(process.env.EVAL_RETRY_BASE_DELAY_MS);
  return Number.isFinite(n) && n >= 0 ? n : EVALUATION_RETRY_BASE_DELAY_MS;
}

/**
 * Backoff before evaluation attempt `attemptNumber` (attemptNumber >= 2):
 * base * 2^(n-2), jittered uniformly to [0.75x, 1.25x], capped at 8s.
 * Attempt 2 waits ~1s, attempt 3 waits ~2s (before jitter).
 */
export function evaluationRetryDelayMs(attemptNumber: number, baseMs?: number): number {
  const base = baseMs ?? evaluationRetryBaseDelayMs();
  if (attemptNumber < 2) return 0;
  const exp = Math.min(base * 2 ** (attemptNumber - 2), EVALUATION_RETRY_MAX_DELAY_MS);
  const jitter = 0.75 + Math.random() * 0.5;
  return Math.round(exp * jitter);
}

export function maxAttemptsForFailureKinds(kinds: (EvaluationFailureKind | null)[]): number {
  const seen = kinds.filter((k): k is EvaluationFailureKind => k !== null);
  // Non-transient failures only (invalid response / auth failure):
  // retrying the same broken key or the same broken response shape
  // will not fix itself — 2 attempts, then permanently_failed. Any
  // transient failure in the history earns the full 3 attempts.
  if (
    seen.length > 0 &&
    seen.every((k) => k === "invalid_response" || k === "auth_failed")
  ) {
    return EVALUATION_MAX_INVALID_RESPONSE_ATTEMPTS;
  }
  return EVALUATION_MAX_ATTEMPTS;
}

/**
 * Classify a scoring failure from the error llm.ts threw. llm.ts throws
 * ApiError(502) for every live failure, so the message is the only
 * discriminator — it carries the provider HTTP status and the failure
 * mode, never prompt/answer content, so it is safe to persist in
 * failure_detail. Deterministic/mock scoring never reaches this path.
 */
export function classifyEvaluationFailure(err: unknown): {
  kind: EvaluationFailureKind;
  httpStatus?: number;
  detail: string;
} {
  const msg = err instanceof Error ? err.message : String(err);
  const statusMatch = msg.match(/HTTP (\d{3})/);
  const httpStatus = statusMatch ? Number(statusMatch[1]) : undefined;
  if (/timed out/i.test(msg)) {
    return { kind: "timeout", httpStatus, detail: "LLM request timed out" };
  }
  if (httpStatus === 429) {
    return { kind: "rate_limited", httpStatus, detail: "LLM provider error: HTTP 429" };
  }
  // Auth failures (bad / expired / revoked key) are their own kind —
  // they must never be lumped in with 5xx: retrying with the same key
  // will fail again, and the fix is a new key, not more attempts.
  if (httpStatus === 401 || httpStatus === 403) {
    return {
      kind: "auth_failed",
      httpStatus,
      detail: `LLM provider auth failed: HTTP ${httpStatus}`,
    };
  }
  if (/invalid JSON|schema validation/i.test(msg)) {
    return {
      kind: "invalid_response",
      httpStatus,
      detail: "LLM response failed validation (invalid JSON or schema)",
    };
  }
  if (httpStatus !== undefined && httpStatus >= 500) {
    return { kind: "server_error", httpStatus, detail: `LLM provider error: HTTP ${httpStatus}` };
  }
  if (/LLM request failed/i.test(msg)) {
    return { kind: "network_error", httpStatus, detail: "LLM request failed (network error)" };
  }
  if (httpStatus !== undefined) {
    return { kind: "server_error", httpStatus, detail: `LLM provider error: HTTP ${httpStatus}` };
  }
  return { kind: "unknown", detail: "LLM evaluation failed" };
}

export interface EvaluationAttemptRow {
  id: string;
  interview_id: string;
  question_id: string;
  attempt_number: number;
  state: EvaluationState;
  failure_kind: EvaluationFailureKind | null;
  failure_detail: Record<string, unknown>;
  provider: string | null;
  model: string | null;
  evaluation: Record<string, unknown> | null;
  score: number | null;
  duration_ms: number | null;
  retry_count: number;
  created_at: string;
  updated_at: string;
}

export interface RetryEvaluationResult {
  interviewId: string;
  questionId: string;
  state: EvaluationState;
  evaluation: SessionAnswerEvaluation | null;
  score: number | null;
  attempts: number;
  attemptsUsed: number;
  failureKind: EvaluationFailureKind | null;
  failureDetail: { kind: EvaluationFailureKind; httpStatus?: number; detail: string } | null;
  /** True when the evaluation was already completed and this call
   *  stored nothing new — same score, no new attempt row. */
  idempotent: boolean;
  /** Present when the state is retryable_failed: ms to wait before the
   *  next retry attempt (backoff formula, before jitter is applied on
   *  the next call — informational only). */
  nextRetryAfterMs?: number;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export interface SessionReport {
  interviewId: string;
  assessmentId: string | null;
  roleId: string;
  frameworkVersion: string;
  finalScore: number | null;
  dimensionAverages: Record<string, number | null>;
  competencyScores: {
    competencyId: string;
    competencyName: string | null;
    score: number | null;
    category: string | null;
    questionsAnswered: number;
  }[];
  perQuestion: {
    questionId: string;
    question: string;
    category: string;
    competencyId: string | null;
    competencyName: string | null;
    difficulty: string | null;
    score: number | null;
    evaluation: Record<string, unknown> | null;
    originalAnswer: string | null;
    /**
     * Phase 2, G3.3: the ORIGINAL answer's own score, as stored on the
     * immutable interview_answers row (null when the original scoring
     * never produced one). The question's `score` above is the
     * EFFECTIVE score — a follow-up re-tests the same competency
     * point, so its score supersedes the original for that question —
     * but the original score stays visible here next to it, never
     * overwritten. When no follow-up (and no completed retry) exists,
     * originalScore equals score.
     */
    originalScore: number | null;
    followUp: {
      questionId: string;
      question: string;
      answer: string | null;
      score: number | null;
      evaluation: Record<string, unknown> | null;
    } | null;
    timeSpentSeconds: number | null;
    status: "answered" | "pending_evaluation" | "unanswered";
    /** P0 F3: evaluation state for this question (completed /
     *  pending / retryable_failed / permanently_failed / processing)
     *  and the structured failure kind when it failed. A missing
     *  score is NEVER treated as zero — see finalScore below. */
    evaluationState: EvaluationState;
    failureKind: EvaluationFailureKind | null;
  }[];
  strengths: string[];
  knowledgeGaps: string[];
  learningAreas: string[];
  timing: { totalSeconds: number | null; perQuestionSeconds: (number | null)[] };
  followUpsUsed: number;
  pendingEvaluations: number;
  /**
   * Phase 2, G3.1: questions that were never answered (expired or
   * never reached). Counted from the perQuestion statuses, exactly
   * like pendingEvaluations — the two together are the true unscored
   * count (pendingEvaluations + unansweredCount), never just the
   * pending half.
   */
  unansweredCount: number;
  /**
   * Phase 2, G1.4 — interview-completeness contract (the frontend
   * implements against these exact fields). All four are derived in
   * computeSessionReport from the same perQuestion data, through the
   * single PARTIAL_INTERVIEW_POLICY definition
   * (assessInterviewCoverage in competencyScoringService):
   *  - interviewComplete: every required original question has a
   *    scored evaluation and none is pending.
   *  - provisionalNote: null when complete, else "provisional — X of
   *    7 questions scored" — a provisional score is never shown
   *    without this note.
   *  - questionsScored / questionsRequired: scored vs required
   *    original questions (required is the 7 pre-generated questions).
   */
  interviewComplete: boolean;
  provisionalNote: string | null;
  questionsScored: number;
  questionsRequired: number;
  /** P0 F3: how many questions ended in a failed evaluation, and the
   *  per-question list (questionId, state, failureKind) so a pending /
   *  failed question is visible in the report instead of silent. */
  failedEvaluations: number;
  evaluationFailures: {
    questionId: string;
    state: EvaluationState;
    failureKind: EvaluationFailureKind | null;
  }[];
  generatedAt: string;
}

function perQuestionSeconds(): number {
  return env.interviewPerQuestionSeconds;
}

function sessionTotalSeconds(): number {
  return env.interviewSessionTotalSeconds;
}

function shortAnswerWords(): number {
  return env.interviewShortAnswerWords;
}

function explainAgainPerQuestion(): number {
  return env.interviewExplainAgainPerQuestion;
}

function explainAgainPerSession(): number {
  return env.interviewExplainAgainPerSession;
}

function wordCount(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

function distinctiveWords(text: string): string[] {
  return [...new Set(text.toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length > 3))];
}

/** An expected point counts as covered when ≥40% of its distinctive words appear. */
function pointCovered(point: string, answerLower: string): boolean {
  const words = distinctiveWords(point);
  if (words.length === 0) return false;
  const hits = words.filter((w) => answerLower.includes(w)).length;
  return hits / words.length >= 0.4;
}

function normalizeForCheck(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ").trim();
}

/**
 * Safety check for Explain Again / follow-up text: true when `text`
 * contains an expected-answer point (full point, or any 6-word window of
 * one). Used to guarantee a rephrase never leaks the expected answer.
 */
export function containsExpectedAnswer(text: string, expectedPoints: string[]): boolean {
  const hay = normalizeForCheck(text);
  for (const point of expectedPoints) {
    const norm = normalizeForCheck(point);
    if (!norm) continue;
    if (hay.includes(norm)) return true;
    const words = norm.split(" ");
    for (let i = 0; i + 6 <= words.length; i++) {
      if (hay.includes(words.slice(i, i + 6).join(" "))) return true;
    }
  }
  return false;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

// ── Scoring ──────────────────────────────────────────────────────────────

const SessionAnswerSchema = (u: unknown): Record<InterviewDimensionKey, number> & { notes: string } => {
  const o = u as Record<string, unknown>;
  const num = (v: unknown): number => {
    const n = Number(v);
    return Number.isFinite(n) ? Math.max(0, Math.min(100, n)) : 0;
  };
  return {
    technicalCorrectness: num(o.technicalCorrectness),
    depthOfUnderstanding: num(o.depthOfUnderstanding),
    relevance: num(o.relevance),
    projectEvidence: num(o.projectEvidence),
    communicationClarity: num(o.communicationClarity),
    notes: typeof o.notes === "string" ? o.notes : "",
  };
};

/** Deterministic per-answer evaluation: expected-point coverage + depth bands. */
export function evaluateSessionAnswerDeterministic(
  question: string,
  answer: string,
  expectedPoints: string[],
  contextTerms: string[],
): SessionAnswerEvaluation {
  const lower = answer.toLowerCase();
  const covered = expectedPoints.filter((p) => pointCovered(p, lower));
  const coverage = expectedPoints.length ? covered.length / expectedPoints.length : 0;
  const words = wordCount(answer);
  const depthBand = words < 20 ? 30 : words < 60 ? 55 : words < 150 ? 75 : 85;
  const sentences = answer.split(/[.!?]+/).filter((s) => s.trim().length > 3).length;
  const termHits = contextTerms.filter((t) => t && lower.includes(t.toLowerCase())).length;
  const projectEvidence = contextTerms.length
    ? Math.round((termHits / contextTerms.length) * 70 + (words >= 20 ? 15 : 0))
    : Math.round(coverage * 50 + (words >= 20 ? 15 : 0));
  const communicationClarity =
    words < 10 ? 35 : words < 20 ? 55 : Math.min(90, 70 + (sentences >= 3 ? 10 : 0));
  return {
    dimensions: {
      technicalCorrectness: Math.round(coverage * 70 + (words >= 20 ? 15 : 0)),
      depthOfUnderstanding: Math.round(coverage * 60 + depthBand * 0.4),
      relevance: question.length > 0 && words >= 10 ? 70 : 40,
      projectEvidence,
      communicationClarity,
    },
    method: "deterministic",
    provider: "mock",
    model: "mock",
    notes:
      covered.length > 0
        ? `Answer covered ${covered.length} of ${expectedPoints.length} expected point(s).`
        : "Answer did not cover the expected points for this question.",
    status: "scored",
  };
}

function weightedScore(dimensions: Record<InterviewDimensionKey, number | null>): number | null {
  let total = 0;
  let weightSum = 0;
  for (const d of INTERVIEW_DIMENSIONS) {
    const v = dimensions[d.key];
    if (v === null || v === undefined) continue;
    total += v * (d.weight / 100);
    weightSum += d.weight / 100;
  }
  if (weightSum === 0) return null;
  return round2(total / weightSum);
}

/**
 * Score one answer on the 5 Phase C dimensions. LLM-first when configured;
 * on LLM failure the answer is kept with status "pending" and NO score is
 * substituted. When no LLM is configured the deterministic evaluator runs
 * and the record is labelled provider "mock".
 */
export async function scoreSessionAnswer(opts: {
  question: string;
  answer: string;
  expectedPoints: string[];
  contextTerms: string[];
}): Promise<SessionAnswerEvaluation> {
  if (llmConfigured()) {
    try {
      const scored = await chatJson(
        {
          system:
            "You are a senior technical interviewer evaluating one interview answer. Judge engineering knowledge only — never penalise accent, grammar, or language proficiency. Score 0-100 per dimension. Return strict JSON {technicalCorrectness, depthOfUnderstanding, relevance, projectEvidence, communicationClarity, notes}.",
          user: JSON.stringify({
            question: opts.question,
            answer: opts.answer,
            expectedPoints: opts.expectedPoints,
          }),
          jsonMode: true,
        },
        SessionAnswerSchema,
      );
      return {
        dimensions: {
          technicalCorrectness: scored.technicalCorrectness,
          depthOfUnderstanding: scored.depthOfUnderstanding,
          relevance: scored.relevance,
          projectEvidence: scored.projectEvidence,
          communicationClarity: scored.communicationClarity,
        },
        method: "llm",
        provider: "live",
        model: process.env.AI_MODEL ?? env.aiModel,
        notes: scored.notes,
        status: "scored",
      };
    } catch (err) {
      // Live AI failed: retain the answer, mark the evaluation pending.
      // NEVER substitute a fabricated score. P0 F3: the failure is now
      // classified (timeout / 429 / auth / 5xx / network / invalid response)
      // and logged — the pre-F3 code swallowed it silently, which is
      // how a live answer stayed pending with no recorded cause.
      const failure = classifyEvaluationFailure(err);
      console.warn(
        `[interview-evaluation] scoring failed kind=${failure.kind}` +
          (failure.httpStatus !== undefined ? ` httpStatus=${failure.httpStatus}` : "") +
          ` provider=live`,
      );
      return {
        dimensions: {
          technicalCorrectness: null,
          depthOfUnderstanding: null,
          relevance: null,
          projectEvidence: null,
          communicationClarity: null,
        },
        method: "llm",
        provider: "live",
        model: process.env.AI_MODEL ?? env.aiModel,
        notes: "AI evaluation failed — answer retained, evaluation pending.",
        status: "pending",
        error: "AI evaluation unavailable at scoring time; no score was substituted.",
        failureKind: failure.kind,
        failureDetail: failure,
      };
    }
  }
  return evaluateSessionAnswerDeterministic(
    opts.question,
    opts.answer,
    opts.expectedPoints,
    opts.contextTerms,
  );
}

function outcomeForScore(score: number | null): AnswerOutcome {
  if (score === null) return "pending";
  if (score >= 60) return "complete";
  if (score >= 40) return "partial";
  return "missed";
}

// ── P0 F3: evaluation attempts + controlled retry ────────────────────────

async function recordEvaluationAttempt(
  db: Db,
  fields: {
    interviewId: string;
    questionId: string;
    attemptNumber: number;
    state: EvaluationState;
    failureKind?: EvaluationFailureKind | null;
    failureDetail?: Record<string, unknown> | null;
    provider?: string | null;
    model?: string | null;
    evaluation?: Record<string, unknown> | null;
    score?: number | null;
    durationMs?: number | null;
  },
): Promise<EvaluationAttemptRow> {
  const res = await db.query(
    `INSERT INTO interview_evaluation_attempts
       (interview_id, question_id, attempt_number, state, failure_kind,
        failure_detail, provider, model, evaluation, score, duration_ms, retry_count)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
     RETURNING *`,
    [
      fields.interviewId,
      fields.questionId,
      fields.attemptNumber,
      fields.state,
      fields.failureKind ?? null,
      JSON.stringify(fields.failureDetail ?? {}),
      fields.provider ?? null,
      fields.model ?? null,
      fields.evaluation ? JSON.stringify(fields.evaluation) : null,
      fields.score ?? null,
      fields.durationMs ?? null,
      fields.attemptNumber - 1,
    ],
  );
  return res.rows[0] as EvaluationAttemptRow;
}

async function listEvaluationAttempts(
  interviewId: string,
  db: Db = pool,
): Promise<EvaluationAttemptRow[]> {
  const res = await db.query(
    `SELECT * FROM interview_evaluation_attempts
      WHERE interview_id = $1 ORDER BY question_id, attempt_number ASC`,
    [interviewId],
  );
  return res.rows as EvaluationAttemptRow[];
}

async function latestEvaluationAttempt(
  interviewId: string,
  questionId: string,
  db: Db = pool,
): Promise<EvaluationAttemptRow | null> {
  const res = await db.query(
    `SELECT * FROM interview_evaluation_attempts
      WHERE interview_id = $1 AND question_id = $2
      ORDER BY attempt_number DESC LIMIT 1`,
    [interviewId, questionId],
  );
  return (res.rows[0] as EvaluationAttemptRow | undefined) ?? null;
}

async function finalizeEvaluationAttempt(
  attemptId: string,
  patch: {
    state: EvaluationState;
    failureKind?: EvaluationFailureKind | null;
    failureDetail?: Record<string, unknown> | null;
    evaluation?: Record<string, unknown> | null;
    score?: number | null;
    durationMs?: number | null;
  },
): Promise<void> {
  await pool.query(
    `UPDATE interview_evaluation_attempts
        SET state = $1, failure_kind = $2, failure_detail = $3,
            evaluation = $4, score = $5, duration_ms = $6, updated_at = now()
      WHERE id = $7`,
    [
      patch.state,
      patch.failureKind ?? null,
      JSON.stringify(patch.failureDetail ?? {}),
      patch.evaluation ? JSON.stringify(patch.evaluation) : null,
      patch.score ?? null,
      patch.durationMs ?? null,
      attemptId,
    ],
  );
}

/**
 * Claim one in-flight attempt row. Returns null when another attempt
 * is already in flight for this question — the partial unique index
 * (migration 013) turns the race into a 23505, which maps to 409.
 * The claim is a separate short transaction from the scoring itself:
 * the LLM call runs AFTER the claim, so a concurrent retry sees the
 * 'processing' row and is rejected instead of double-scoring.
 */
async function claimEvaluationAttempt(fields: {
  interviewId: string;
  questionId: string;
  attemptNumber: number;
  provider: string | null;
  model: string | null;
}): Promise<EvaluationAttemptRow | null> {
  try {
    return await recordEvaluationAttempt(pool, {
      ...fields,
      state: "processing",
    });
  } catch (err) {
    if ((err as { code?: string }).code === "23505") return null;
    throw err;
  }
}

function scoringContextFor(question: InterviewQuestionRow): {
  expectedPoints: string[];
  contextTerms: string[];
} {
  return {
    expectedPoints: Array.isArray(question.expected_points)
      ? (question.expected_points as string[])
      : [],
    contextTerms: [
      ...((question.context?.changedFiles as string[] | undefined) ?? []).map((f) =>
        f.split("/").pop() ?? f,
      ),
      ...((question.context?.technologies as string[] | undefined) ?? []),
    ],
  };
}

/**
 * Retry the evaluation of one already-submitted answer — an original
 *  answer (interview_answers) OR a follow-up answer
 *  (interview_followups). P1 F5: follow-up evaluations previously had
 *  no retry path at all — a live scoring failure on the follow-up left
 *  it pending forever, with no attempt row and no way back. The
 *  follow-up answer lives in interview_followups, but its attempts are
 *  recorded in the same interview_evaluation_attempts table keyed by
 *  the follow-up question id, and a successful retry surfaces in the
 *  report via the completed attempt (see computeSessionReport).
 *
 * Ownership: candidate-owner only (same check as the session
 * endpoints — loadInterviewForCandidate, 404 for another candidate's
 * interview) or an admin bypass (isAdmin — same pattern as the
 * recruiter report gate). A retry NEVER reads an answer from the
 * request: it re-scores the stored answer text only, and never
 * updates interview_answers (immutable by the 011 trigger) — a
 * successful retry stores its evaluation/score on the attempt row,
 * which computeSessionReport reads.
 *
 * Guards: completed → idempotent return of the stored result (no new
 * attempt row); an in-flight 'processing' attempt → 409; already
 * permanently_failed, or attempts exhausted → 409. Otherwise it runs
 * scoring attempts until success or the bounded budget is exhausted
 * (3 total for transient failures, 2 total when every failure is an
 * invalid model response or an auth failure), sleeping the exponential backoff (+ jitter)
 * between attempts. No fabricated score: if every attempt fails the
 * state is permanently_failed and the score stays null.
 */
export async function retryEvaluation(opts: {
  interviewId: string;
  questionId: string;
  candidateId?: string;
  isAdmin?: boolean;
}): Promise<RetryEvaluationResult> {
  if (opts.isAdmin) {
    const found = await pool.query(`SELECT id FROM interviews WHERE id = $1`, [opts.interviewId]);
    if (!found.rows.length) throw new ApiError(404, "Interview not found");
  } else {
    if (!opts.candidateId) throw new ApiError(401, "Unauthorized");
    await loadInterviewForCandidate(opts.interviewId, opts.candidateId);
  }
  const qRes = await pool.query(
    `SELECT * FROM interview_questions WHERE id = $1 AND interview_id = $2`,
    [opts.questionId, opts.interviewId],
  );
  if (!qRes.rows.length) throw new ApiError(404, "Question not found");
  const question = qRes.rows[0] as InterviewQuestionRow;
  // Original answers live in interview_answers; follow-up answers live
  // in interview_followups. A retry re-scores whichever stored answer
  // exists — never an answer from the request.
  let answerRow: Record<string, unknown> | null = null;
  const ansRes = await pool.query(
    `SELECT * FROM interview_answers WHERE question_id = $1`,
    [opts.questionId],
  );
  if (ansRes.rows.length) {
    answerRow = ansRes.rows[0] as Record<string, unknown>;
  } else {
    const fuRes = await pool.query(
      `SELECT * FROM interview_followups WHERE question_id = $1 AND interview_id = $2`,
      [opts.questionId, opts.interviewId],
    );
    if (fuRes.rows.length) answerRow = fuRes.rows[0] as Record<string, unknown>;
  }
  if (!answerRow || !answerRow.answer) {
    throw new ApiError(
      404,
      "No stored answer for this question — only submitted original or follow-up answers can be retried",
    );
  }
  const storedAnswer = answerRow.answer as string;
  const answerEvaluation = (answerRow.evaluation as SessionAnswerEvaluation | null) ?? null;
  const answerScore =
    answerRow.score !== null && answerRow.score !== undefined
      ? Number(answerRow.score)
      : null;
  const allAttempts = await pool.query(
    `SELECT attempt_number, state, failure_kind FROM interview_evaluation_attempts
      WHERE interview_id = $1 AND question_id = $2 ORDER BY attempt_number ASC`,
    [opts.interviewId, opts.questionId],
  );
  const attemptsUsed = allAttempts.rows.length;

  // Already scored at submit time: idempotent, no new attempt row.
  if (answerEvaluation?.status === "scored" && answerScore !== null) {
    return {
      interviewId: opts.interviewId,
      questionId: opts.questionId,
      state: "completed",
      evaluation: answerEvaluation,
      score: answerScore,
      attempts: attemptsUsed,
      attemptsUsed,
      failureKind: null,
      failureDetail: null,
      idempotent: true,
    };
  }

  let latest = await latestEvaluationAttempt(opts.interviewId, opts.questionId);

  // A completed retry already exists: idempotent return of its result.
  const completed = await pool.query(
    `SELECT * FROM interview_evaluation_attempts
      WHERE interview_id = $1 AND question_id = $2 AND state = 'completed'
      ORDER BY attempt_number DESC LIMIT 1`,
    [opts.interviewId, opts.questionId],
  );
  if (completed.rows.length) {
    const row = completed.rows[0] as EvaluationAttemptRow;
    return {
      interviewId: opts.interviewId,
      questionId: opts.questionId,
      state: "completed",
      evaluation: (row.evaluation as unknown as SessionAnswerEvaluation | null) ?? null,
      score: row.score !== null && row.score !== undefined ? Number(row.score) : null,
      attempts: attemptsUsed,
      attemptsUsed,
      failureKind: null,
      failureDetail: null,
      idempotent: true,
    };
  }

  // Reclaim a stale in-flight attempt (owner crashed mid-scoring) so a
  // later retry is not blocked forever by an abandoned 'processing' row.
  if (latest && latest.state === "processing") {
    const ageMs = Date.now() - Date.parse(latest.created_at);
    if (ageMs > EVALUATION_STALE_PROCESSING_MS) {
      await finalizeEvaluationAttempt(latest.id, {
        state: "retryable_failed",
        failureKind: "unknown",
        failureDetail: { kind: "unknown", detail: "Abandoned in-flight attempt reclaimed" },
        durationMs: latest.duration_ms,
      });
      latest = await latestEvaluationAttempt(opts.interviewId, opts.questionId);
    } else {
      throw new ApiError(
        409,
        "An evaluation retry is already in progress for this question",
      );
    }
  }

  // Phase 2, G3.5 — auth-failure recovery: a permanently_failed
  // evaluation is terminal, EXCEPT when the failure kind is
  // auth_failed. An auth failure means the provider key was bad /
  // expired / revoked at scoring time; once the key is rotated the
  // same stored answer can (and should) be scored. So exactly ONE
  // additional attempt cycle is allowed after an auth permanently_
  // failed, for the candidate or an admin. The cycle is consumed by
  // counting attempts against the normal budget: the recovery attempt
  // is attempt maxAttempts + 1, and any retry after that sees
  // attemptsUsed > maxAttempts and is rejected — a second revoked key
  // cannot spin retries forever. Every other failure kind stays
  // terminal: a timeout / 5xx / invalid response that exhausted its
  // budget is never retried.
  let authRecovery = false;
  if (latest && latest.state === "permanently_failed") {
    if (latest.failure_kind !== "auth_failed") {
      throw new ApiError(
        409,
        "This evaluation has permanently failed — no further retries are allowed",
      );
    }
    const kindsSoFar = allAttempts.rows.map(
      (r) => (r.failure_kind as EvaluationFailureKind | null) ?? null,
    );
    if (attemptsUsed > maxAttemptsForFailureKinds(kindsSoFar)) {
      throw new ApiError(
        409,
        "The auth-failure recovery retry has already been used — no further retries are allowed",
      );
    }
    authRecovery = true;
  }
  if (latest && latest.state === "pending") {
    throw new ApiError(
      409,
      "An evaluation attempt is already pending for this question",
    );
  }

  const failureKinds = allAttempts.rows.map(
    (r) => (r.failure_kind as EvaluationFailureKind | null) ?? null,
  );
  const maxAttempts = maxAttemptsForFailureKinds(failureKinds);
  // The auth-recovery cycle is one attempt beyond the normal budget
  // (see above); without it the budget check below would reject the
  // recovery attempt before it runs.
  const effectiveMaxAttempts = authRecovery ? maxAttempts + 1 : maxAttempts;
  if (!authRecovery && attemptsUsed >= maxAttempts) {
    if (latest) {
      await finalizeEvaluationAttempt(latest.id, {
        state: "permanently_failed",
        failureKind: latest.failure_kind,
        failureDetail: latest.failure_detail,
        durationMs: latest.duration_ms,
      });
    }
    throw new ApiError(
      409,
      `No evaluation retries remain for this question (used ${attemptsUsed} of ${maxAttempts} attempts)`,
    );
  }

  const { expectedPoints, contextTerms } = scoringContextFor(question);
  const provider = process.env.AI_MODEL ?? env.aiModel;
  let lastFailure: { kind: EvaluationFailureKind; httpStatus?: number; detail: string } | null =
    latest?.failure_kind
      ? {
          kind: latest.failure_kind,
          detail: (latest.failure_detail as { detail?: string }).detail ?? "",
        }
      : null;

  // Bounded loop: at most the remaining attempts, with exponential
  // backoff + jitter between them. Each iteration claims its attempt
  // row first (409 if a concurrent retry claimed it instead). The
  // budget is recomputed from the RECORDED failure kinds each
  // iteration: all-invalid-response / all-auth failures cap at 2 total
  // attempts, anything else at 3 — so a timeout after an invalid
  // response still earns its third attempt, while repeated invalid
  // responses stop at two.
  for (;;) {
    const current = await latestEvaluationAttempt(opts.interviewId, opts.questionId);
    const attemptNumber = (current?.attempt_number ?? 0) + 1;
    // Phase 2, G3.5: the auth-recovery cycle runs one attempt past
    // the normal budget (effectiveMaxAttempts); the post-failure
    // budget check below still ends the cycle after that one attempt.
    const kindsNow = (
      await pool.query(
        `SELECT failure_kind FROM interview_evaluation_attempts
          WHERE interview_id = $1 AND question_id = $2 ORDER BY attempt_number ASC`,
        [opts.interviewId, opts.questionId],
      )
    ).rows.map((r) => (r.failure_kind as EvaluationFailureKind | null) ?? null);
    const maxAttempts = maxAttemptsForFailureKinds(kindsNow);
    if (attemptNumber > Math.max(maxAttempts, effectiveMaxAttempts)) {
      if (current) {
        await finalizeEvaluationAttempt(current.id, {
          state: "permanently_failed",
          failureKind: current.failure_kind,
          failureDetail: current.failure_detail,
          durationMs: current.duration_ms,
        });
      }
      return {
        interviewId: opts.interviewId,
        questionId: opts.questionId,
        state: "permanently_failed",
        evaluation: null,
        score: null,
        attempts: attemptNumber - 1,
        attemptsUsed: attemptNumber - 1,
        failureKind: lastFailure?.kind ?? null,
        failureDetail: lastFailure,
        idempotent: false,
      };
    }
    if (attemptNumber >= 2) {
      await sleep(evaluationRetryDelayMs(attemptNumber));
    }
    const claimed = await claimEvaluationAttempt({
      interviewId: opts.interviewId,
      questionId: opts.questionId,
      attemptNumber,
      provider: answerEvaluation?.provider ?? "live",
      model: answerEvaluation?.model ?? provider,
    });
    if (!claimed) {
      throw new ApiError(
        409,
        "An evaluation retry is already in progress for this question",
      );
    }
    const started = Date.now();
    const evaluation = await scoreSessionAnswer({
      question: question.question,
      answer: storedAnswer,
      expectedPoints,
      contextTerms,
    });
    const durationMs = Date.now() - started;
    if (evaluation.status === "scored") {
      const score = weightedScore(evaluation.dimensions);
      await finalizeEvaluationAttempt(claimed.id, {
        state: "completed",
        evaluation: evaluation as unknown as Record<string, unknown>,
        score,
        durationMs,
      });
      console.log(
        `[interview-evaluation] retry succeeded interview=${opts.interviewId} ` +
          `question=${opts.questionId} attempt=${attemptNumber} score=${score}`,
      );
      return {
        interviewId: opts.interviewId,
        questionId: opts.questionId,
        state: "completed",
        evaluation,
        score,
        attempts: attemptNumber,
        attemptsUsed: attemptNumber,
        failureKind: null,
        failureDetail: null,
        idempotent: false,
      };
    }
    const failure = evaluation.failureKind
      ? {
          kind: evaluation.failureKind,
          httpStatus: evaluation.failureDetail?.httpStatus,
          detail: evaluation.failureDetail?.detail ?? "LLM evaluation failed",
        }
      : classifyEvaluationFailure(new Error(evaluation.error ?? "LLM evaluation failed"));
    lastFailure = failure;
    // Budget depends on the failure kinds seen so far: all-invalid-
    // response failures cap at 2 total attempts, anything else at 3.
    // Re-read from the table so the decision uses recorded history,
    // not in-memory state.
    const budget = maxAttemptsForFailureKinds(
      (await pool.query(
        `SELECT failure_kind FROM interview_evaluation_attempts
          WHERE interview_id = $1 AND question_id = $2 ORDER BY attempt_number ASC`,
        [opts.interviewId, opts.questionId],
      )).rows.map((r) => (r.failure_kind as EvaluationFailureKind | null) ?? null),
    );
    if (attemptNumber >= budget) {
      await finalizeEvaluationAttempt(claimed.id, {
        state: "permanently_failed",
        failureKind: failure.kind,
        failureDetail: failure,
        durationMs,
      });
      console.warn(
        `[interview-evaluation] retry exhausted interview=${opts.interviewId} ` +
          `question=${opts.questionId} attempts=${attemptNumber} kind=${failure.kind}`,
      );
      return {
        interviewId: opts.interviewId,
        questionId: opts.questionId,
        state: "permanently_failed",
        evaluation: null,
        score: null,
        attempts: attemptNumber,
        attemptsUsed: attemptNumber,
        failureKind: failure.kind,
        failureDetail: failure,
        idempotent: false,
      };
    }
    await finalizeEvaluationAttempt(claimed.id, {
      state: "retryable_failed",
      failureKind: failure.kind,
      failureDetail: failure,
      durationMs,
    });
    // Loop: backoff, then the next bounded attempt.
  }
}

// ── Session loading ──────────────────────────────────────────────────────

async function loadQuestions(interviewId: string, db: Db = pool): Promise<InterviewQuestionRow[]> {
  const res = await db.query(
    `SELECT * FROM interview_questions WHERE interview_id = $1 ORDER BY question_order ASC`,
    [interviewId],
  );
  return res.rows as InterviewQuestionRow[];
}

async function loadActiveSession(
  interviewId: string,
): Promise<InterviewSessionRow | null> {
  const res = await pool.query(
    `SELECT * FROM interview_sessions WHERE interview_id = $1
      AND status = ANY($2::text[]) ORDER BY created_at DESC LIMIT 1`,
    [interviewId, SESSION_ACTIVE_STATUSES],
  );
  return (res.rows[0] as InterviewSessionRow | undefined) ?? null;
}

async function loadLatestSession(
  interviewId: string,
): Promise<InterviewSessionRow | null> {
  const res = await pool.query(
    `SELECT * FROM interview_sessions WHERE interview_id = $1 ORDER BY created_at DESC LIMIT 1`,
    [interviewId],
  );
  return (res.rows[0] as InterviewSessionRow | undefined) ?? null;
}

function toPublicQuestion(
  q: InterviewQuestionRow,
  questionNumber: number,
  totalQuestions: number,
  deadlineAt: string | null,
): Record<string, unknown> {
  const now = Date.now();
  const deadlineMs = deadlineAt ? Date.parse(deadlineAt) : null;
  return {
    id: q.id,
    questionNumber,
    totalQuestions,
    category: q.category,
    competencyId: q.competency_id,
    difficulty: q.difficulty,
    // P1 F5: how the question probes the competency (one of
    // project_specific / conceptual / engineering_scenario, stored in
    // context at generation time). A generic kind label — it carries
    // no expected answer, rubric or question text, so it is safe to
    // serve; the E2E harness asserts all three kinds are present.
    questionType: (q.context?.questionType as string | undefined) ?? null,
    question: q.question,
    maxTimeSeconds: q.max_time_seconds,
    deadlineAt,
    timeRemainingSeconds:
      deadlineMs === null ? null : Math.max(0, Math.round((deadlineMs - now) / 1000)),
  };
}

interface SessionState {
  session: {
    id: string;
    interviewId: string;
    status: string;
    startedAt: string | null;
    expiresAt: string | null;
    timeRemainingSeconds: number | null;
    readinessAckAt: string | null;
    completedAt: string | null;
    followUpsUsed: number;
    explainAgainCount: number;
    explainAgainRemaining: number;
  };
  currentQuestion: Record<string, unknown> | null;
  progress: { answered: number; total: number; currentNumber: number | null };
  allAnswered: boolean;
  rules: {
    questionsTotal: number;
    perQuestionSeconds: number;
    sessionTotalSeconds: number;
    maxFollowUps: number;
    maxExplainAgainPerQuestion: number;
    maxExplainAgainPerSession: number;
    shortAnswerWords: number;
  };
}

const INTERVIEW_RULES = {
  questionsTotal: 7,
  perQuestionSeconds: perQuestionSeconds(),
  sessionTotalSeconds: sessionTotalSeconds(),
  maxFollowUps: 1,
  maxExplainAgainPerQuestion: explainAgainPerQuestion(),
  maxExplainAgainPerSession: explainAgainPerSession(),
  shortAnswerWords: shortAnswerWords(),
};

async function buildState(
  session: InterviewSessionRow,
  current: InterviewQuestionRow | null,
  questions: InterviewQuestionRow[],
): Promise<SessionState> {
  const answeredOriginal = await pool.query(
    `SELECT COUNT(*)::int AS n FROM interview_answers ia
      JOIN interview_questions iq ON iq.id = ia.question_id
     WHERE iq.interview_id = $1 AND iq.source = 'pre_generated'`,
    [session.interview_id],
  );
  const answeredFollowUp = await pool.query(
    `SELECT COUNT(*)::int AS n FROM interview_followups
     WHERE interview_id = $1 AND answer IS NOT NULL`,
    [session.interview_id],
  );
  const answered = answeredOriginal.rows[0].n + answeredFollowUp.rows[0].n;
  const total = questions.length;
  const now = Date.now();
  const expiresMs = session.expires_at ? Date.parse(session.expires_at) : null;
  const currentNumber = current
    ? questions.findIndex((q) => q.id === current.id) + 1
    : null;
  return {
    session: {
      id: session.id,
      interviewId: session.interview_id,
      status: session.status,
      startedAt: session.started_at,
      expiresAt: session.expires_at,
      timeRemainingSeconds:
        expiresMs === null ? null : Math.max(0, Math.round((expiresMs - now) / 1000)),
      readinessAckAt: session.readiness_ack_at,
      completedAt: session.completed_at,
      followUpsUsed: session.follow_ups_used,
      explainAgainCount: session.explain_again_count,
      explainAgainRemaining: Math.max(
        0,
        explainAgainPerSession() - session.explain_again_count,
      ),
    },
    currentQuestion: current
      ? toPublicQuestion(
          current,
          currentNumber ?? 1,
          total,
          session.current_question_deadline_at,
        )
      : null,
    progress: { answered, total, currentNumber },
    allAnswered: answered >= total && total > 0,
    rules: INTERVIEW_RULES,
  };
}

/** Next unanswered question AFTER the given order (used when a
 *  question's deadline expired: the expired question stays unanswered
 *  and must be skipped, not re-served with a fresh deadline). */
async function findNextUnansweredAfter(
  interviewId: string,
  questions: InterviewQuestionRow[],
  afterOrder: number,
  db: Db = pool,
): Promise<InterviewQuestionRow | null> {
  const later = questions.filter((q) => q.question_order > afterOrder);
  return findNextUnanswered(interviewId, later, db);
}

/** Find the next unanswered question in order (follow-ups sort inline). */
async function findNextUnanswered(
  interviewId: string,
  questions: InterviewQuestionRow[],
  db: Db = pool,
): Promise<InterviewQuestionRow | null> {
  const answered = await db.query(
    `SELECT question_id FROM interview_answers ia
      JOIN interview_questions iq ON iq.id = ia.question_id
     WHERE iq.interview_id = $1`,
    [interviewId],
  );
  const answeredIds = new Set(answered.rows.map((r) => r.question_id as string));
  const answeredFollowUps = await db.query(
    `SELECT question_id FROM interview_followups WHERE interview_id = $1 AND answer IS NOT NULL`,
    [interviewId],
  );
  for (const r of answeredFollowUps.rows) answeredIds.add(r.question_id as string);
  return questions.find((q) => !answeredIds.has(q.id)) ?? null;
}

async function setCurrentQuestion(
  db: Db,
  sessionId: string,
  question: InterviewQuestionRow | null,
): Promise<void> {
  const now = new Date();
  const deadline = question
    ? new Date(now.getTime() + question.max_time_seconds * 1000)
    : null;
  await db.query(
    `UPDATE interview_sessions
        SET current_question_id = $1, current_question_shown_at = $2,
            current_question_deadline_at = $3, updated_at = now()
      WHERE id = $4`,
    [
      question?.id ?? null,
      question ? now.toISOString() : null,
      deadline?.toISOString() ?? null,
      sessionId,
    ],
  );
}

/** Finalise a session: build + persist the immutable report, and mark
 *  the interview with the session's TERMINAL status. Used by the
 *  explicit finish endpoint (terminal status "completed") AND by the
 *  session-expiry path (terminal status "expired"). Phase 2, G3.7: an
 *  expired session is stored as status 'expired' (migration 015
 *  widens the interviews status CHECK) — never rewritten to
 *  'completed'. The report itself is still persisted (it is the
 *  honest record of what was answered), but collectSources
 *  (competencyProfile) only treats status='completed' interviews as
 *  a profile source, so an expired 3/7 interview can never pose as a
 *  completed interview source; completeness is judged from the
 *  report's coverage, not from the row's status. */
async function finalizeSession(
  db: Db,
  interview: InterviewRow,
  session: InterviewSessionRow,
  terminalStatus: "completed" | "expired",
): Promise<SessionReport> {
  const report = await computeSessionReport(interview, session);
  const existing = await db.query(
    `SELECT id FROM interview_reports WHERE interview_id = $1`,
    [interview.id],
  );
  if (!existing.rows.length) {
    await db.query(
      `INSERT INTO interview_reports
         (interview_id, candidate_id, assessment_id, role_id, framework_version,
          final_score, dimension_averages, competency_scores, report)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [
        interview.id,
        interview.candidate_id,
        interview.assessment_id,
        report.roleId,
        report.frameworkVersion,
        report.finalScore,
        JSON.stringify(report.dimensionAverages),
        JSON.stringify(report.competencyScores),
        JSON.stringify(report),
      ],
    );
  }
  const transcript = report.perQuestion.map((p) => ({
    category: p.category,
    question: p.question,
    answer: p.originalAnswer,
    score: p.score,
    evaluation: p.evaluation,
  }));
  await db.query(
    `UPDATE interviews SET score = $1, report = $2, status = $3, transcript = $4 WHERE id = $5`,
    [report.finalScore, JSON.stringify(report), terminalStatus, JSON.stringify(transcript), interview.id],
  );
  await db.query(
    `UPDATE interview_sessions
        SET status = $1, completed_at = now(), current_question_id = NULL,
            current_question_deadline_at = NULL, updated_at = now()
      WHERE id = $2`,
    [terminalStatus, session.id],
  );
  return report;
}

async function computeSessionReport(
  interview: InterviewRow,
  session: InterviewSessionRow,
): Promise<SessionReport> {
  const questions = await loadQuestions(interview.id);
  const answers = await pool.query(
    `SELECT ia.* FROM interview_answers ia
      JOIN interview_questions iq ON iq.id = ia.question_id
     WHERE iq.interview_id = $1`,
    [interview.id],
  );
  const answerByQuestion = new Map<string, Record<string, unknown>>();
  for (const r of answers.rows) answerByQuestion.set(r.question_id as string, r);
  const followups = await pool.query(
    `SELECT * FROM interview_followups WHERE interview_id = $1`,
    [interview.id],
  );
  // P0 F3: evaluation attempts (migration 013) — a retry that succeeds
  // stores its evaluation/score on its attempt row, NOT on the immutable
  // interview_answers row, so the report must read completed attempts.
  const attemptsByQuestion = new Map<string, EvaluationAttemptRow[]>();
  for (const a of await listEvaluationAttempts(interview.id)) {
    const arr = attemptsByQuestion.get(a.question_id) ?? [];
    arr.push(a);
    attemptsByQuestion.set(a.question_id, arr);
  }
  const followupByOriginal = new Map<string, Record<string, unknown>>();
  const followupByQuestion = new Map<string, Record<string, unknown>>();
  for (const r of followups.rows) {
    followupByOriginal.set(r.original_question_id as string, r);
    followupByQuestion.set(r.question_id as string, r);
  }
  const framework = getFramework(FRAMEWORK_VERSION);
  const roleId =
    (questions[0]?.context?.roleId as string | undefined) ?? "unknown";
  const frameworkVersion =
    questions[0]?.framework_version ?? FRAMEWORK_VERSION;
  const role = framework.roles.find((r) => r.roleId === roleId);
  const competencyName = (id: string | null): string | null => {
    if (!id || !role) return null;
    return role.competencies.find((c) => c.id === id)?.name ?? null;
  };

  const perQuestion: SessionReport["perQuestion"] = [];
  const effectiveScores: number[] = [];
  const dimSums: Record<string, { sum: number; n: number }> = {};
  const competencyGroups = new Map<string, number[]>();
  let pendingEvaluations = 0;
  const timeSpent: (number | null)[] = [];
  let totalSeconds = 0;

  for (const q of questions.filter((x) => x.source === "pre_generated")) {
    const ans = answerByQuestion.get(q.id);
    const fu = followupByOriginal.get(q.id);
    const fuAns = fu && fu.answer ? fu : null;
    const qAttempts = attemptsByQuestion.get(q.id) ?? [];
    const completedAttempt = [...qAttempts]
      .reverse()
      .find((a) => a.state === "completed");
    const latestAttempt = qAttempts[qAttempts.length - 1] ?? null;
    // P1 F5: a successful RETRY of the follow-up evaluation also lives
    // on its attempt row (keyed by the follow-up question id) — the
    // follow-up row itself is never rewritten by a retry. Prefer the
    // completed follow-up attempt over the row's own (possibly pending)
    // evaluation, exactly as for originals.
    const fuAttempts = fu
      ? (attemptsByQuestion.get(fu.question_id as string) ?? [])
      : [];
    const fuCompletedAttempt = [...fuAttempts]
      .reverse()
      .find((a) => a.state === "completed");
    const fuEffectiveEval =
      (fuCompletedAttempt?.evaluation as Record<string, unknown> | undefined) ??
      (fuAns?.evaluation as Record<string, unknown> | undefined) ??
      null;
    const fuEffectiveScore =
      fuCompletedAttempt &&
      fuCompletedAttempt.score !== null &&
      fuCompletedAttempt.score !== undefined
        ? Number(fuCompletedAttempt.score)
        : fuAns && fuAns.score !== null && fuAns.score !== undefined
          ? Number(fuAns.score)
          : null;
    // Effective score (Phase 2, G3.3 — ruling, kept replacement):
    // a follow-up answer SUPERSEDES the original score for this
    // question, because the follow-up re-tests the same competency
    // point the original answer was weak on; the follow-up's score is
    // therefore the question's score. The original answer and its own
    // score are NOT discarded — they stay stored (immutable answer
    // row) and visible in the report as originalAnswer /
    // originalScore, next to the follow-up's score. Otherwise a
    // completed RETRY attempt supplies the score — the original answer
    // row is immutable, so the retry result lives on the attempt row
    // (P0 F3). A missing score is never treated as zero: unscored
    // questions are excluded from every mean below.
    const retryEval =
      (completedAttempt?.evaluation as Record<string, unknown> | undefined) ?? null;
    const retryScore =
      completedAttempt && completedAttempt.score !== null && completedAttempt.score !== undefined
        ? Number(completedAttempt.score)
        : null;
    const effectiveEval = fuEffectiveEval ??
      retryEval ??
      (ans?.evaluation as Record<string, unknown> | undefined) ??
      null;
    const effectiveScore =
      fuEffectiveScore !== null
        ? fuEffectiveScore
        : retryScore !== null
          ? retryScore
          : ans && ans.score !== null && ans.score !== undefined
            ? Number(ans.score)
            : null;
    // P0 F3: per-question evaluation transparency — pending/failed
    // questions carry their state and failure kind in the report.
    // Phase 2, G3.1: a question with NO answer is "unanswered", never
    // "pending" — there is no evaluation in flight for it, and calling
    // it pending hid unscored questions from the pending count.
    let evaluationState: EvaluationState;
    let failureKind: EvaluationFailureKind | null = null;
    if (effectiveScore !== null) {
      evaluationState = "completed";
    } else if (latestAttempt) {
      evaluationState = latestAttempt.state;
      failureKind = latestAttempt.failure_kind;
    } else if (ans) {
      evaluationState = "pending";
    } else {
      evaluationState = "unanswered";
    }
    const status =
      effectiveScore !== null
        ? "answered"
        : effectiveEval && (effectiveEval as { status?: string }).status === "pending"
          ? "pending_evaluation"
          : ans
            ? "pending_evaluation"
            : "unanswered";
    if (effectiveScore !== null) {
      effectiveScores.push(effectiveScore);
      if (q.competency_id) {
        const arr = competencyGroups.get(q.competency_id) ?? [];
        arr.push(effectiveScore);
        competencyGroups.set(q.competency_id, arr);
      }
    }
    if (effectiveEval && (effectiveEval as { status?: string }).status === "scored") {
      const dims = (effectiveEval as { dimensions?: Record<string, number | null> }).dimensions ?? {};
      for (const d of INTERVIEW_DIMENSIONS) {
        const v = dims[d.key];
        if (typeof v === "number") {
          const slot = dimSums[d.key] ?? { sum: 0, n: 0 };
          slot.sum += v;
          slot.n += 1;
          dimSums[d.key] = slot;
        }
      }
    }
    const spent =
      ans && ans.time_spent_seconds !== null && ans.time_spent_seconds !== undefined
        ? Number(ans.time_spent_seconds)
        : null;
    timeSpent.push(spent);
    if (spent !== null) totalSeconds += spent;
    perQuestion.push({
      questionId: q.id,
      question: q.question,
      category: q.category,
      competencyId: q.competency_id,
      competencyName: competencyName(q.competency_id),
      difficulty: q.difficulty,
      score: effectiveScore,
      evaluation: effectiveEval,
      originalAnswer: (ans?.answer as string | undefined) ?? null,
      // Phase 2, G3.3: the original answer's own score, straight off
      // the immutable answer row — visible alongside the effective
      // (possibly follow-up-superseded) score above.
      originalScore:
        ans && ans.score !== null && ans.score !== undefined
          ? Number(ans.score)
          : null,
      followUp: fu
        ? {
            questionId: fu.question_id as string,
            question:
              questions.find((x) => x.id === fu.question_id)?.question ?? "",
            answer: (fu.answer as string | undefined) ?? null,
            // P1 F5: the retried score/evaluation when a follow-up retry
            // completed (attempt row), else the row's own values.
            score: fuEffectiveScore,
            evaluation: fuEffectiveEval,
          }
        : null,
      timeSpentSeconds: spent,
      status,
      evaluationState,
      failureKind,
    });
  }

  const finalScore =
    effectiveScores.length > 0
      ? round2(effectiveScores.reduce((s, v) => s + v, 0) / effectiveScores.length)
      : null;
  const dimensionAverages: Record<string, number | null> = {};
  for (const d of INTERVIEW_DIMENSIONS) {
    const slot = dimSums[d.key];
    dimensionAverages[d.key] = slot && slot.n > 0 ? round2(slot.sum / slot.n) : null;
  }
  const competencyScores = [...competencyGroups.entries()].map(([id, scores]) => {
    const score = round2(scores.reduce((s, v) => s + v, 0) / scores.length);
    return {
      competencyId: id,
      competencyName: competencyName(id),
      score,
      category: categoryForScore(score, framework).label,
      questionsAnswered: scores.length,
    };
  });
  const strengths = competencyScores
    .filter((c) => (c.score ?? 0) >= 70)
    .map((c) => `Strong on ${c.competencyName ?? c.competencyId}.`);
  const gaps = competencyScores
    .filter((c) => (c.score ?? 0) < 50)
    .map((c) => c.competencyName ?? c.competencyId);
  // P0 F3: failed evaluations listed transparently (question, state,
  // failure kind). finalScore stays the mean over SCORED questions
  // only — a missing score is excluded, never counted as zero.
  const evaluationFailures = perQuestion
    .filter(
      (p) =>
        p.evaluationState === "retryable_failed" ||
        p.evaluationState === "permanently_failed",
    )
    .map((p) => ({
      questionId: p.questionId,
      state: p.evaluationState,
      failureKind: p.failureKind,
    }));
  // Phase 2, G3.1 + G1.4: the unscored counts are derived here from
  // the perQuestion STATUSES — never from a running counter, never
  // trusted from a stored number. pendingEvaluations counts only
  // questions awaiting an evaluation; unansweredCount counts questions
  // never answered. Together they are the true unscored count. The
  // completeness fields go through the single policy definition
  // (assessInterviewCoverage), so the report and the stored profile
  // can never disagree about whether this interview is complete.
  pendingEvaluations = perQuestion.filter((p) => p.status === "pending_evaluation").length;
  const unansweredCount = perQuestion.filter((p) => p.status === "unanswered").length;
  const coverage = assessInterviewCoverage({
    questionsScored: effectiveScores.length,
    questionsRequired: perQuestion.length,
    pendingEvaluations,
  });
  const startedMs = session.started_at ? Date.parse(session.started_at) : null;
  const endedMs = session.completed_at
    ? Date.parse(session.completed_at)
    : Date.now();
  return {
    interviewId: interview.id,
    assessmentId: interview.assessment_id,
    roleId,
    frameworkVersion,
    finalScore,
    dimensionAverages,
    competencyScores,
    perQuestion,
    strengths,
    knowledgeGaps: gaps,
    learningAreas: [...new Set(gaps)],
    timing: {
      totalSeconds: startedMs !== null ? Math.round((endedMs - startedMs) / 1000) : null,
      perQuestionSeconds: timeSpent,
    },
    followUpsUsed: session.follow_ups_used,
    pendingEvaluations,
    unansweredCount,
    interviewComplete: coverage.complete,
    provisionalNote: coverage.provisionalNote,
    questionsScored: coverage.questionsScored,
    questionsRequired: coverage.questionsRequired,
    failedEvaluations: evaluationFailures.length,
    evaluationFailures,
    generatedAt: new Date().toISOString(),
  };
}

// ── Session lifecycle ────────────────────────────────────────────────────

/**
 * Start (or resume) the interview session. Creates the session in status
 * "intro" and returns the intro/rules payload. Idempotent while a session
 * is active. Requires exactly 7 frozen pre-generated questions — legacy
 * interviews generated before Phase C cannot start a session (409).
 */
export async function startSession(opts: {
  interviewId: string;
  candidateId: string;
}): Promise<SessionState> {
  const interview = await loadInterviewForCandidate(opts.interviewId, opts.candidateId);
  const questions = await loadQuestions(opts.interviewId);
  const preGenerated = questions.filter((q) => q.source === "pre_generated");
  const ready =
    preGenerated.length === 7 &&
    preGenerated.every((q) => q.competency_id && q.framework_version);
  if (!ready) {
    throw new ApiError(
      409,
      "This interview was not pre-generated under the Phase C flow (exactly 7 questions with competency specs) — start a new interview from the completed assessment",
    );
  }
  const existing = await loadActiveSession(opts.interviewId);
  if (existing) {
    const current = existing.current_question_id
      ? (questions.find((q) => q.id === existing.current_question_id) ?? null)
      : null;
    return buildState(existing, current, questions);
  }
  const latest = await loadLatestSession(opts.interviewId);
  if (latest && (latest.status === "completed" || latest.status === "expired")) {
    throw new ApiError(409, `This interview session is already ${latest.status}`);
  }
  const inserted = await pool.query(
    `INSERT INTO interview_sessions
       (interview_id, candidate_id, status, questions_total)
     VALUES ($1, $2, 'intro', 7) RETURNING *`,
    [opts.interviewId, opts.candidateId],
  );
  return buildState(inserted.rows[0] as InterviewSessionRow, null, questions);
}

/** Readiness gate: the candidate confirms they understand the rules.
 *  Moves the session intro → ready. The clock starts only when the first
 *  question is served (GET /session), after this acknowledgement. */
export async function confirmReadiness(opts: {
  interviewId: string;
  candidateId: string;
  acknowledged: boolean;
}): Promise<SessionState> {
  if (!opts.acknowledged) {
    throw new ApiError(400, "Readiness must be acknowledged before the interview can begin");
  }
  await loadInterviewForCandidate(opts.interviewId, opts.candidateId);
  const session = await loadActiveSession(opts.interviewId);
  if (!session) throw new ApiError(404, "No interview session — start the session first");
  if (session.status !== "intro") {
    throw new ApiError(409, `Readiness can only be confirmed from the intro step (session is ${session.status})`);
  }
  const updated = await pool.query(
    `UPDATE interview_sessions SET status = 'ready', readiness_ack_at = now(), updated_at = now()
      WHERE id = $1 RETURNING *`,
    [session.id],
  );
  const questions = await loadQuestions(opts.interviewId);
  return buildState(updated.rows[0] as InterviewSessionRow, null, questions);
}

async function expireSessionIfNeeded(
  interview: InterviewRow,
  session: InterviewSessionRow,
): Promise<InterviewSessionRow | null> {
  if (session.status !== "in_progress" || !session.expires_at) return null;
  if (Date.now() <= Date.parse(session.expires_at)) return null;
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const fresh = await client.query(
      `SELECT * FROM interview_sessions WHERE id = $1 FOR UPDATE`,
      [session.id],
    );
    const row = fresh.rows[0] as InterviewSessionRow;
    if (row.status !== "in_progress") {
      await client.query("COMMIT");
      return row;
    }
    await finalizeSession(client, interview, row, "expired");
    await client.query("COMMIT");
    const done = await pool.query(`SELECT * FROM interview_sessions WHERE id = $1`, [session.id]);
    return done.rows[0] as InterviewSessionRow;
  } catch (err) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Session state — returns ONLY the current question, never the full list.
 * Side effects are deliberate and documented: when the session is "ready"
 * (readiness acknowledged), this call begins the interview — status
 * in_progress, clock starts, Q1 is served with its deadline. After that
 * the call is read-only, except for two server-enforced transitions:
 * a per-question deadline that passed advances to the next question, and
 * a passed session expiry finalises the session (status "expired").
 */
export async function getSessionState(opts: {
  interviewId: string;
  candidateId: string;
}): Promise<SessionState> {
  const interview = await loadInterviewForCandidate(opts.interviewId, opts.candidateId);
  const session = await loadActiveSession(opts.interviewId);
  if (!session) {
    const latest = await loadLatestSession(opts.interviewId);
    if (latest) {
      const questions = await loadQuestions(opts.interviewId);
      return buildState(latest, null, questions);
    }
    throw new ApiError(404, "No interview session — start the session first");
  }
  const questions = await loadQuestions(opts.interviewId);

  if (session.status === "ready") {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const first = await findNextUnanswered(opts.interviewId, questions, client);
      const now = new Date();
      const updated = await client.query(
        `UPDATE interview_sessions
            SET status = 'in_progress', started_at = $1, expires_at = $2, updated_at = now()
          WHERE id = $3 RETURNING *`,
        [
          now.toISOString(),
          new Date(now.getTime() + sessionTotalSeconds() * 1000).toISOString(),
          session.id,
        ],
      );
      const row = updated.rows[0] as InterviewSessionRow;
      await setCurrentQuestion(client, session.id, first);
      await client.query("COMMIT");
      const fresh = await pool.query(`SELECT * FROM interview_sessions WHERE id = $1`, [session.id]);
      return buildState(fresh.rows[0] as InterviewSessionRow, first, questions);
    } catch (err) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw err;
    } finally {
      client.release();
    }
  }

  if (session.status === "in_progress") {
    const expired = await expireSessionIfNeeded(interview, session);
    if (expired) return buildState(expired, null, questions);
    // Per-question deadline passed: advance (the question stays
    // unanswered) or auto-finish when it was the last one.
    if (
      session.current_question_id &&
      session.current_question_deadline_at &&
      Date.now() > Date.parse(session.current_question_deadline_at)
    ) {
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        const expiredQ = questions.find((q) => q.id === session.current_question_id);
        const next = await findNextUnansweredAfter(
          opts.interviewId,
          questions,
          expiredQ?.question_order ?? -1,
          client,
        );
        if (!next) {
          const fresh = await client.query(
            `SELECT * FROM interview_sessions WHERE id = $1 FOR UPDATE`,
            [session.id],
          );
          await finalizeSession(client, interview, fresh.rows[0] as InterviewSessionRow, "completed");
          await client.query("COMMIT");
          const done = await pool.query(`SELECT * FROM interview_sessions WHERE id = $1`, [session.id]);
          return buildState(done.rows[0] as InterviewSessionRow, null, questions);
        }
        await setCurrentQuestion(client, session.id, next);
        await client.query("COMMIT");
        const fresh = await pool.query(`SELECT * FROM interview_sessions WHERE id = $1`, [session.id]);
        return buildState(fresh.rows[0] as InterviewSessionRow, next, questions);
      } catch (err) {
        await client.query("ROLLBACK").catch(() => undefined);
        throw err;
      } finally {
        client.release();
      }
    }
    const current = session.current_question_id
      ? (questions.find((q) => q.id === session.current_question_id) ?? null)
      : await findNextUnanswered(opts.interviewId, questions);
    return buildState(session, current, questions);
  }

  // not_started / intro: no question is served yet.
  return buildState(session, null, questions);
}

// ── Answer flow ──────────────────────────────────────────────────────────

export interface SessionAnswerResult {
  /** Null when nothing was stored (short-answer warning). */
  evaluation: SessionAnswerEvaluation | null;
  score: number | null;
  outcome: AnswerOutcome;
  shortAnswerWarning: boolean;
  requiresConfirmation?: boolean;
  wordCount?: number;
  minWords?: number;
  followUp: { id: string; question: string; competencyId: string | null } | null;
  next: { questionId: string; questionNumber: number } | null;
  allAnswered: boolean;
}

function deterministicFollowUpText(
  competencyName: string | null,
): string {
  return (
    `You touched on ${competencyName ?? "this area"} briefly. Go deeper: describe one specific ` +
    `moment in your own work where ${((competencyName ?? "this area").toLowerCase())} mattered, ` +
    `and explain what you would do differently with more time.`
  );
}

const FollowUpSchema = (u: unknown): { question: string } => {
  const o = u as Record<string, unknown>;
  if (typeof o.question !== "string" || o.question.trim().length < 10) {
    throw new Error("Invalid follow-up shape");
  }
  return { question: (o.question as string).trim() };
};

/** Generate exactly ONE competency-related follow-up for a Partial answer.
 *  The text must never reveal the expected answer (checked; on any
 *  violation the deterministic template is used). */
async function generateFollowUpText(opts: {
  question: string;
  answer: string;
  expectedPoints: string[];
  missedPoints: string[];
  competencyName: string | null;
}): Promise<{ text: string; provider: "live" | "mock" }> {
  if (llmConfigured()) {
    try {
      const refined = await chatJson(
        {
          system:
            "You are a senior technical interviewer. Write exactly ONE short follow-up question that digs into the part of the topic the candidate's answer missed. NEVER reveal the expected answer, a model answer, or any expected point in the question text. Return strict JSON {question}.",
          user: JSON.stringify({
            question: opts.question,
            answer: opts.answer,
            missedPoints: opts.missedPoints,
            competency: opts.competencyName,
          }),
          jsonMode: true,
        },
        FollowUpSchema,
      );
      if (!containsExpectedAnswer(refined.question, opts.expectedPoints)) {
        return { text: refined.question, provider: "live" };
      }
      // LLM leaked expected-answer text — fall through to the safe template.
    } catch {
      // LLM failure — deterministic template stands, labelled mock.
    }
  }
  return { text: deterministicFollowUpText(opts.competencyName), provider: "mock" };
}

/**
 * Submit an answer for the CURRENT question only. Empty → 400. Short
 * (below the word threshold) → warning flag; the client must resubmit
 * with confirmShort to store it (never auto-rejected). Duplicate → 409.
 * Late (past the server-side per-question deadline) → 410.
 */
export async function submitSessionAnswer(opts: {
  interviewId: string;
  candidateId: string;
  questionId: string;
  answer: string;
  confirmShort?: boolean;
}): Promise<SessionAnswerResult> {
  const interview = await loadInterviewForCandidate(opts.interviewId, opts.candidateId);
  let session = await loadActiveSession(opts.interviewId);
  if (!session) throw new ApiError(404, "No interview session — start the session first");
  if (session.status !== "in_progress") {
    throw new ApiError(409, `Cannot answer while the session is ${session.status}`);
  }
  const expired = await expireSessionIfNeeded(interview, session);
  if (expired) {
    throw new ApiError(410, "The interview session has expired");
  }
  const questions = await loadQuestions(opts.interviewId);
  const question = questions.find((q) => q.id === opts.questionId);
  if (!question) throw new ApiError(404, "Question not found");
  if (session.current_question_id !== opts.questionId) {
    throw new ApiError(409, "This is not the current question — answer the question shown");
  }
  const answer = opts.answer.trim();
  if (answer.length === 0) throw new ApiError(400, "Answer cannot be empty");
  // Server-side per-question deadline, checked BEFORE the short-answer
  // warning: a late submit is rejected, never silently accepted.
  if (
    session.current_question_deadline_at &&
    Date.now() > Date.parse(session.current_question_deadline_at)
  ) {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const next = await findNextUnansweredAfter(
        opts.interviewId,
        questions,
        question.question_order,
        client,
      );
      if (next) await setCurrentQuestion(client, session.id, next);
      await client.query("COMMIT");
    } catch (err) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw err;
    } finally {
      client.release();
    }
    throw new ApiError(410, "Time for this question has expired");
  }
  const words = wordCount(answer);
  if (words < shortAnswerWords() && !opts.confirmShort) {
    return {
      evaluation: null,
      score: null,
      outcome: "pending",
      shortAnswerWarning: true,
      requiresConfirmation: true,
      wordCount: words,
      minWords: shortAnswerWords(),
      followUp: null,
      next: null,
      allAnswered: false,
    };
  }
  const isFollowUp = question.is_follow_up;
  if (isFollowUp) {
    const existing = await pool.query(
      `SELECT answer FROM interview_followups WHERE question_id = $1`,
      [opts.questionId],
    );
    if (existing.rows.length && existing.rows[0].answer) {
      throw new ApiError(409, "This follow-up has already been answered — answers are locked");
    }
  } else {
    const existing = await pool.query(
      `SELECT 1 FROM interview_answers WHERE question_id = $1`,
      [opts.questionId],
    );
    if (existing.rows.length) {
      throw new ApiError(409, "This question has already been answered — answers are locked");
    }
  }

  const expectedPoints = Array.isArray(question.expected_points)
    ? (question.expected_points as string[])
    : [];
  const contextTerms = [
    ...((question.context?.changedFiles as string[] | undefined) ?? []).map((f) =>
      f.split("/").pop() ?? f,
    ),
    ...((question.context?.technologies as string[] | undefined) ?? []),
  ];
  const scoringStarted = Date.now();
  const evaluation = await scoreSessionAnswer({
    question: question.question,
    answer,
    expectedPoints,
    contextTerms,
  });
  const scoringDurationMs = Date.now() - scoringStarted;
  const score = evaluation.status === "scored" ? weightedScore(evaluation.dimensions) : null;
  const outcome = outcomeForScore(score);
  const shownAt = session.current_question_shown_at
    ? Date.parse(session.current_question_shown_at)
    : Date.now();
  const timeSpentSeconds = Math.max(0, Math.round((Date.now() - shownAt) / 1000));

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    if (isFollowUp) {
      await client.query(
        `UPDATE interview_followups
            SET answer = $1, evaluation = $2, score = $3, answered_at = now()
          WHERE question_id = $4`,
        [answer, JSON.stringify(evaluation), score, opts.questionId],
      );
      // P1 F5: record the initial scoring attempt (attempt 1) for the
      // follow-up too — previously a live follow-up scoring failure
      // left no attempt row at all, so there was nothing to retry
      // from and no recorded failure kind. Same shape as originals.
      await recordEvaluationAttempt(client, {
        interviewId: opts.interviewId,
        questionId: opts.questionId,
        attemptNumber: 1,
        state: evaluation.status === "scored" ? "completed" : "retryable_failed",
        failureKind: evaluation.failureKind ?? null,
        failureDetail: evaluation.failureDetail ?? null,
        provider: evaluation.provider,
        model: evaluation.model,
        evaluation: evaluation as unknown as Record<string, unknown>,
        score,
        durationMs: scoringDurationMs,
      });
    } else {
      await client.query(
        `INSERT INTO interview_answers
           (question_id, answer, evaluation, score, answered_at, locked_at,
            time_spent_seconds, question_shown_at, deadline_at,
            short_warning_acknowledged, evaluation_provider, evaluation_model)
         VALUES ($1, $2, $3, $4, now(), now(), $5, $6, $7, $8, $9, $10)`,
        [
          opts.questionId,
          answer,
          JSON.stringify(evaluation),
          score,
          timeSpentSeconds,
          session.current_question_shown_at,
          session.current_question_deadline_at,
          words < shortAnswerWords(),
          evaluation.provider,
          evaluation.model,
        ],
      );
      // P0 F3: record the initial scoring attempt (attempt 1) with its
      // structured failure kind when it failed — previously the cause
      // was recorded nowhere. A retry that later succeeds stores its
      // result on its own attempt row; this row is never rewritten.
      await recordEvaluationAttempt(client, {
        interviewId: opts.interviewId,
        questionId: opts.questionId,
        attemptNumber: 1,
        state: evaluation.status === "scored" ? "completed" : "retryable_failed",
        failureKind: evaluation.failureKind ?? null,
        failureDetail: evaluation.failureDetail ?? null,
        provider: evaluation.provider,
        model: evaluation.model,
        evaluation: evaluation as unknown as Record<string, unknown>,
        score,
        durationMs: scoringDurationMs,
      });
    }

    // Follow-up: Partial answers earn exactly ONE competency-related
    // follow-up per interview (DB-enforced cap). Complete / Missed /
    // pending-evaluation answers move straight to the next question.
    let followUp: SessionAnswerResult["followUp"] = null;
    if (outcome === "partial" && !isFollowUp && session.follow_ups_used === 0) {
      const existingFu = await client.query(
        `SELECT 1 FROM interview_followups WHERE interview_id = $1`,
        [opts.interviewId],
      );
      if (existingFu.rows.length === 0) {
        const answerLower = answer.toLowerCase();
        const missedPoints = expectedPoints.filter((p) => !pointCovered(p, answerLower));
        const framework = getFramework(FRAMEWORK_VERSION);
        const roleId = (question.context?.roleId as string | undefined) ?? "unknown";
        const role = framework.roles.find((r) => r.roleId === roleId);
        const competencyName =
          role?.competencies.find((c) => c.id === question.competency_id)?.name ?? null;
        const { text } = await generateFollowUpText({
          question: question.question,
          answer,
          expectedPoints,
          missedPoints,
          competencyName,
        });
        // Insert directly after the current question; later questions shift.
        await client.query(
          `UPDATE interview_questions SET question_order = question_order + 1
            WHERE interview_id = $1 AND question_order > $2`,
          [opts.interviewId, question.question_order],
        );
        const inserted = await client.query(
          `INSERT INTO interview_questions
             (interview_id, category, question, question_order, competency_id,
              difficulty, expected_points, scoring_rubric, max_time_seconds,
              context, framework_version, source, is_follow_up, follow_up_of_question_id)
           VALUES ($1, 'follow_up', $2, $3, $4, $5, $6, $7, $8, $9, $10, 'follow_up', true, $11)
           RETURNING *`,
          [
            opts.interviewId,
            text,
            question.question_order + 1,
            question.competency_id,
            question.difficulty,
            JSON.stringify(missedPoints),
            JSON.stringify(question.scoring_rubric),
            question.max_time_seconds,
            JSON.stringify(question.context),
            question.framework_version,
            question.id,
          ],
        );
        const fuQuestion = inserted.rows[0] as InterviewQuestionRow;
        await client.query(
          `INSERT INTO interview_followups
             (interview_id, session_id, original_question_id, question_id)
           VALUES ($1, $2, $3, $4)`,
          [opts.interviewId, session.id, question.id, fuQuestion.id],
        );
        await client.query(
          `UPDATE interview_sessions SET follow_ups_used = 1, updated_at = now() WHERE id = $1`,
          [session.id],
        );
        followUp = {
          id: fuQuestion.id,
          question: fuQuestion.question,
          competencyId: fuQuestion.competency_id,
        };
      }
    }

    const freshQuestions = await loadQuestions(opts.interviewId, client);
    const next = await findNextUnanswered(opts.interviewId, freshQuestions, client);
    await setCurrentQuestion(client, session.id, next);
    await client.query("COMMIT");
    session = (await pool.query(`SELECT * FROM interview_sessions WHERE id = $1`, [session.id]))
      .rows[0] as InterviewSessionRow;
    const nextNumber = next ? freshQuestions.findIndex((q) => q.id === next.id) + 1 : 0;
    return {
      evaluation,
      score,
      outcome,
      shortAnswerWarning: false,
      followUp,
      next: next ? { questionId: next.id, questionNumber: nextNumber } : null,
      allAnswered: next === null,
    };
  } catch (err) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw err;
  } finally {
    client.release();
  }
}

// ── Explain Again ────────────────────────────────────────────────────────

const RephraseSchema = (u: unknown): { question: string } => {
  const o = u as Record<string, unknown>;
  if (typeof o.question !== "string" || o.question.trim().length < 10) {
    throw new Error("Invalid rephrase shape");
  }
  return { question: (o.question as string).trim() };
};

/**
 * Rephrase/clarify the CURRENT question without revealing the expected
 * answer or a model answer. The rephrased text is checked against the
 * expected points; any leak falls back to a safe deterministic rephrase.
 * Budget: max 1 per question, max 2 per session (env-tunable).
 */
export async function explainAgain(opts: {
  interviewId: string;
  candidateId: string;
}): Promise<{
  rephrasedQuestion: string;
  remainingForQuestion: number;
  remainingForSession: number;
  provider: "live" | "mock";
}> {
  const interview = await loadInterviewForCandidate(opts.interviewId, opts.candidateId);
  const session = await loadActiveSession(opts.interviewId);
  if (!session) throw new ApiError(404, "No interview session — start the session first");
  if (session.status !== "in_progress") {
    throw new ApiError(409, `Cannot use Explain Again while the session is ${session.status}`);
  }
  const expired = await expireSessionIfNeeded(interview, session);
  if (expired) throw new ApiError(410, "The interview session has expired");
  const questions = await loadQuestions(opts.interviewId);
  const question = questions.find((q) => q.id === session.current_question_id);
  if (!question) throw new ApiError(409, "There is no current question to explain");
  const byQuestion = (session.explain_again_by_question ?? {}) as Record<string, number>;
  const usedForQuestion = byQuestion[question.id] ?? 0;
  if (usedForQuestion >= explainAgainPerQuestion()) {
    throw new ApiError(409, "Explain Again has already been used for this question");
  }
  if (session.explain_again_count >= explainAgainPerSession()) {
    throw new ApiError(409, "Explain Again budget for this session is used up");
  }
  const expectedPoints = Array.isArray(question.expected_points)
    ? (question.expected_points as string[])
    : [];
  let rephrased: string | null = null;
  let provider: "live" | "mock" = "mock";
  if (llmConfigured()) {
    try {
      const refined = await chatJson(
        {
          system:
            "You are a helpful interviewer. Rephrase the given interview question in simpler, clearer words so the candidate understands what is being asked. NEVER reveal the expected answer, a model answer, or any expected point. Return strict JSON {question}.",
          user: JSON.stringify({
            question: question.question,
            expectedPoints,
          }),
          jsonMode: true,
        },
        RephraseSchema,
      );
      if (!containsExpectedAnswer(refined.question, expectedPoints)) {
        rephrased = refined.question;
        provider = "live";
      }
    } catch {
      // LLM failure — deterministic rephrase stands, labelled mock.
    }
  }
  if (!rephrased) {
    rephrased =
      `Here is the same question in different words: ${question.question} ` +
      `Take your time — explain your reasoning step by step, and ground it in what you actually built.`;
  }
  const nextByQuestion = { ...byQuestion, [question.id]: usedForQuestion + 1 };
  await pool.query(
    `UPDATE interview_sessions
        SET explain_again_count = explain_again_count + 1,
            explain_again_by_question = $1, updated_at = now()
      WHERE id = $2`,
    [JSON.stringify(nextByQuestion), session.id],
  );
  return {
    rephrasedQuestion: rephrased,
    remainingForQuestion: explainAgainPerQuestion() - (usedForQuestion + 1),
    remainingForSession: explainAgainPerSession() - (session.explain_again_count + 1),
    provider,
  };
}

// ── Completion ───────────────────────────────────────────────────────────

/**
 * Explicit finish (NOT a GET side effect). Calculates the interview score,
 * saves the immutable report, and marks the session completed — all in
 * one transaction. Idempotent: finishing an already-completed/expired
 * session returns the stored report.
 */
export async function finishSession(opts: {
  interviewId: string;
  candidateId: string;
}): Promise<SessionReport> {
  const interview = await loadInterviewForCandidate(opts.interviewId, opts.candidateId);
  const session = await loadLatestSession(opts.interviewId);
  if (!session) throw new ApiError(404, "No interview session — start the session first");
  if (session.status === "completed" || session.status === "expired") {
    const stored = await pool.query(
      `SELECT report FROM interview_reports WHERE interview_id = $1`,
      [opts.interviewId],
    );
    if (stored.rows.length) return stored.rows[0].report as SessionReport;
    throw new ApiError(409, `This interview session is already ${session.status}`);
  }
  if (session.status !== "in_progress") {
    throw new ApiError(409, `Cannot finish while the session is ${session.status}`);
  }
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const fresh = await client.query(
      `SELECT * FROM interview_sessions WHERE id = $1 FOR UPDATE`,
      [session.id],
    );
    const row = fresh.rows[0] as InterviewSessionRow;
    if (row.status !== "in_progress") {
      await client.query("ROLLBACK");
      return finishSession(opts);
    }
    const report = await finalizeSession(client, interview, row, "completed");
    await client.query("COMMIT");
    try {
      await notifyCandidate(opts.candidateId, {
        type: "interview",
        title: "AI interview complete",
        body:
          report.finalScore === null
            ? "Your AI interview is complete and the report is ready to view."
            : `Your AI interview is complete — final score ${report.finalScore}. The full report is ready to view.`,
        link: "/assessment",
      });
    } catch {
      // A notification failure must not fail the finish itself.
    }
    return report;
  } catch (err) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw err;
  } finally {
    client.release();
  }
}

// ── Recruiter access ─────────────────────────────────────────────────────

/** Company-isolation gate: a recruiter may view an interview report only
 *  for a candidate who applied to one of their jobs. Admins bypass. */
export async function recruiterMayViewInterview(opts: {
  interviewId: string;
  recruiterUserId: string;
  isAdmin: boolean;
}): Promise<boolean> {
  if (opts.isAdmin) return true;
  const interview = await pool.query(
    `SELECT candidate_id FROM interviews WHERE id = $1`,
    [opts.interviewId],
  );
  if (!interview.rows.length) return false;
  const allowed = await pool.query(
    `SELECT 1 FROM applications a JOIN jobs j ON j.id = a.job_id
      JOIN companies c ON c.id = j.company_id
     WHERE a.candidate_id = $1 AND c.created_by = $2 LIMIT 1`,
    [interview.rows[0].candidate_id, opts.recruiterUserId],
  );
  return allowed.rows.length > 0;
}

/** Recruiter report read (candidate + authorized recruiters only). */
export async function getInterviewReportForRecruiter(opts: {
  interviewId: string;
  recruiterUserId: string;
  isAdmin: boolean;
}): Promise<SessionReport | null> {
  const allowed = await recruiterMayViewInterview(opts);
  if (!allowed) {
    throw new ApiError(403, "You can only view reports for candidates who applied to your jobs");
  }
  const stored = await pool.query(
    `SELECT report FROM interview_reports WHERE interview_id = $1`,
    [opts.interviewId],
  );
  if (stored.rows.length) return stored.rows[0].report as SessionReport;
  const legacy = await pool.query(
    `SELECT report FROM interviews WHERE id = $1`,
    [opts.interviewId],
  );
  if (!legacy.rows.length) throw new ApiError(404, "Interview not found");
  return (legacy.rows[0].report as SessionReport | null) ?? null;
}

