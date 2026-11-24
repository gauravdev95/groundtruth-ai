import { pool } from "../config/db";
import { ApiError } from "../middleware/errorHandler";
import {
  chatCompletion,
  stripJsonFences,
  getLlmUsageLog,
  llmConfigured,
} from "./llm";
import { loadAssessmentById } from "./assessments";
import { listEvents, buildActivitySummary } from "./monitoring";
import { notifyCandidate } from "./notifications";

// ── Hybrid AI engineering evaluation ───────────────────────────────────────
// Weights (fixed by the product spec): functional correctness 30%,
// code quality 20%, problem-solving 20%, technical understanding 15%,
// testing & reliability 15%. Functional correctness comes ONLY from
// executed tests (visible + hidden) — never invented, never from an LLM.
// Code quality is deterministic static analysis (no candidate code is
// executed for it). The qualitative categories use the LLM when configured;
// without it they use a capped deterministic heuristic and the evaluation
// is flagged human_review_recommended with low confidence. Monitoring data
// is contextual evidence only — it never directly determines the score.
//
// P0 (24 Nov 2026): the qualitative LLM review is STRICTLY validated
// (see validateQualitativeReview). A live review that fails validation
// NEVER becomes silent 0s and NEVER silently falls back to the heuristic:
// the qualitative categories are recorded as null (failed), the overall
// score is computed ONLY from the verified dimensions (functional +
// quality, renormalised), human_review_recommended is set, and a
// structured failure record is stored in evidence.qualitativeFailure.
// See docs/SCORING_METHODOLOGY.md §2.1 for the policy.

export const EVALUATION_WEIGHTS = {
  functional: 0.3,
  quality: 0.2,
  problemSolving: 0.2,
  understanding: 0.15,
  testing: 0.15,
} as const;

/** How the qualitative categories in a report were produced. */
export type QualitativeMethod =
  | "live-ai"
  | "deterministic-heuristic"
  | "failed";

export type OverallBasis = "all-dimensions" | "verified-dimensions-only";

/** Structured record of a failed live qualitative review. Safe
 *  diagnostics only: provider, model, HTTP status, schema version,
 *  missing/invalid/unknown field names, validation error codes,
 *  duration and retry count. NEVER raw candidate answers, prompts,
 *  or repo contents. */
export interface QualitativeFailureRecord {
  code: QualitativeFailureCode;
  schemaVersion: string;
  provider: "live" | "mock" | null;
  model: string | null;
  httpStatus: number | null;
  missingFields: string[];
  invalidFields: { field: string; reason: string }[];
  unknownScoreFields: string[];
  durationMs: number;
  retryCount: number | null;
  /** Short safe detail (no prompt/response content). */
  detail: string;
}

export type QualitativeFailureCode =
  | "invalid_json"
  | "schema_validation_failed"
  | "timeout"
  | "provider_unavailable"
  | "provider_error"
  | "authentication_failed"
  | "empty_response";

export interface EvaluationReport {
  id: string;
  assessmentId: string;
  overallScore: number | null;
  categoryScores: Record<string, number | null>;
  evidence: Record<string, unknown>;
  passedTests: string[];
  failedTests: string[];
  qualityIssues: string[];
  securityFindings: string[];
  improvements: string[];
  strengths: string[];
  weaknesses: string[];
  confidence: number;
  humanReviewRecommended: boolean;
  aiAvailable: boolean;
  qualitativeMethod: QualitativeMethod;
  /** Non-null only when qualitativeMethod === "failed". */
  qualitativeFailure: QualitativeFailureRecord | null;
  /** "verified-dimensions-only" when the qualitative review failed. */
  overallBasis: OverallBasis;
  status: string;
}

interface QualitySignals {
  issues: string[];
  score: number;
  stats: Record<string, number>;
}

/** Deterministic static checks on file contents. No code is executed. */
export function analyzeCodeQuality(
  files: Record<string, string>,
): QualitySignals {
  const issues: string[] = [];
  const stats = {
    files: Object.keys(files).length,
    totalLines: 0,
    todoCount: 0,
    functions: 0,
    longFunctions: 0,
    longFiles: 0,
    testFiles: 0,
  };
  for (const [p, content] of Object.entries(files)) {
    if (p.startsWith("_gt_")) continue;
    const lines = content.split("\n");
    stats.totalLines += lines.length;
    if (p.includes("test")) stats.testFiles += 1;
    if (lines.length > 500) {
      stats.longFiles += 1;
      issues.push(`${p} is very long (${lines.length} lines) — consider splitting it.`);
    }
    for (const line of lines) {
      if (/TODO|FIXME|XXX|HACK/i.test(line)) stats.todoCount += 1;
    }
    // Python function length heuristic (def ... to next def/class at same indent).
    const defs = [...content.matchAll(/^def\s+(\w+)\s*\(/gm)].map((m) => m[1]);
    stats.functions += defs.length;
    const chunks = content.split(/^def\s+\w+\s*\(/m);
    for (const chunk of chunks.slice(1)) {
      const fnLines = chunk.split("\n").length;
      if (fnLines > 80) stats.longFunctions += 1;
    }
  }
  if (stats.todoCount > 0) {
    issues.push(`${stats.todoCount} TODO/FIXME marker(s) left in the code.`);
  }
  if (stats.longFunctions > 0) {
    issues.push(`${stats.longFunctions} function(s) longer than 80 lines.`);
  }
  if (stats.testFiles === 0) {
    issues.push("No test files were found in the submitted snapshot.");
  }
  let score = 100;
  score -= Math.min(30, stats.longFiles * 10);
  score -= Math.min(20, stats.longFunctions * 5);
  score -= Math.min(20, stats.todoCount * 2);
  if (stats.testFiles === 0) score -= 20;
  return { issues, score: Math.max(0, score), stats };
}

function securityScan(files: Record<string, string>): string[] {
  const findings: string[] = [];
  const patterns: [RegExp, string][] = [
    [/eval\s*\(/, "Use of eval() — arbitrary code execution risk."],
    [/exec\s*\(/, "Use of exec() — arbitrary code execution risk."],
    [/password\s*=\s*["'][^"']+["']/, "A hard-coded password/secret appears in the code."],
    [/api[_-]?key\s*=\s*["'][^"']+["']/, "A hard-coded API key appears in the code."],
    [/os\.system\s*\(/, "os.system() used — prefer subprocess with an argument list."],
    [/shell\s*=\s*True/, "subprocess with shell=True — command injection risk."],
  ];
  for (const [p, content] of Object.entries(files)) {
    for (const [re, msg] of patterns) {
      if (re.test(content)) findings.push(`${p}: ${msg}`);
    }
  }
  return [...new Set(findings)];
}

/** Schema version of the qualitative LLM review contract. Bumped whenever
 *  the expected field names, types or ranges change; stored on every
 *  failure record and in evaluation evidence so a stored report can
 *  always be audited against the contract it was validated with. */
export const QUALITATIVE_SCHEMA_VERSION = "1.0.0";

/** Exact JSON contract the LLM must return. Embedded verbatim in the
 *  review prompt (see QUALITATIVE_JSON_SCHEMA_TEXT) so the model returns
 *  the right keys — the live E2E run recorded 0s because the old prompt
 *  never specified the key names and the old validator silently coerced
 *  missing fields to 0. */
export interface QualitativeReview {
  problemSolving: number;
  understanding: number;
  testing: number;
  strengths: string[];
  weaknesses: string[];
  improvements: string[];
}

export const QUALITATIVE_JSON_SCHEMA_TEXT = `Return ONLY a JSON object with EXACTLY these keys (no extra score keys, no renamed keys):
{
  "problemSolving": <number 0-100>,
  "understanding": <number 0-100>,
  "testing": <number 0-100>,
  "strengths": [<string>, ...],
  "weaknesses": [<string>, ...],
  "improvements": [<string>, ...]
}
Rules:
- Every score MUST be a JSON number (not a string), finite, and between 0 and 100 inclusive.
- All six keys are REQUIRED — omit none. A missing key is a failed review, not a zero.
- Use EXACTLY these key names: "problemSolving" (not "problem_solving", "problemSolvingScore" or "problem-solving"), "understanding" (not "technicalUnderstanding", "technical_understanding" or "understandingScore"), "testing" (not "testingScore", "testing_score" or "testScore").
- Each of "strengths", "weaknesses" and "improvements" MUST be an array of strings (use an empty array only if there is genuinely nothing to report).`;

const QUALITATIVE_SCORE_FIELDS = [
  "problemSolving",
  "understanding",
  "testing",
] as const;
const QUALITATIVE_TEXT_FIELDS = [
  "strengths",
  "weaknesses",
  "improvements",
] as const;

/** Wrong key names a model might use for the three scores. The presence
 *  of ANY of these is a validation failure — a wrong name is never read
 *  as the value of the correct field. */
const QUALITATIVE_SCORE_ALIASES = [
  "problem_solving",
  "problem-solving",
  "problemSolvingScore",
  "problem_solving_score",
  "technicalUnderstanding",
  "technical_understanding",
  "technical-understanding",
  "techUnderstanding",
  "understandingScore",
  "understanding_score",
  "testingScore",
  "testing_score",
  "testing-score",
  "testScore",
  "testingAndReliability",
  "testing_and_reliability",
] as const;

export interface QualitativeValidationIssue {
  field: string;
  reason: string;
}

/** Thrown by validateQualitativeReview. Carries structured diagnostics
 *  only (field names + error codes) — never the offending values, which
 *  could contain model output. The diagnostics are also exposed as
 *  `.failure` so chatJson-style callers can carry them on ApiError. */
export class QualitativeValidationError extends Error {
  readonly code = "schema_validation_failed" as const;
  readonly missingFields: string[];
  readonly invalidFields: QualitativeValidationIssue[];
  readonly unknownScoreFields: string[];
  readonly failure: {
    code: string;
    schemaVersion: string;
    missingFields: string[];
    invalidFields: QualitativeValidationIssue[];
    unknownScoreFields: string[];
  };

  constructor(opts: {
    missingFields: string[];
    invalidFields: QualitativeValidationIssue[];
    unknownScoreFields: string[];
    notAnObject?: boolean;
  }) {
    const parts: string[] = [];
    if (opts.notAnObject) parts.push("response is not a JSON object");
    if (opts.missingFields.length)
      parts.push(`missing=[${opts.missingFields.join(", ")}]`);
    if (opts.invalidFields.length)
      parts.push(
        `invalid=[${opts.invalidFields.map((i) => `${i.field}:${i.reason}`).join(", ")}]`,
      );
    if (opts.unknownScoreFields.length)
      parts.push(`unknown_score_fields=[${opts.unknownScoreFields.join(", ")}]`);
    super(
      `Qualitative review failed schema validation (${QUALITATIVE_SCHEMA_VERSION}): ${parts.join("; ") || "unknown reason"}`,
    );
    this.name = "QualitativeValidationError";
    this.missingFields = opts.missingFields;
    this.invalidFields = opts.invalidFields;
    this.unknownScoreFields = opts.unknownScoreFields;
    this.failure = {
      code: this.code,
      schemaVersion: QUALITATIVE_SCHEMA_VERSION,
      missingFields: opts.missingFields,
      invalidFields: opts.invalidFields,
      unknownScoreFields: opts.unknownScoreFields,
    };
  }
}

/**
 * STRICT validator for the qualitative LLM review. Missing required
 * fields FAIL — they are never coerced to 0. Every score must be a
 * finite JSON number in 0–100: null, strings (even numeric strings),
 * NaN, Infinity, negatives and values >100 are all rejected. Wrong
 * field names for the scores are rejected, not read as values.
 * The three feedback arrays are required and must be string arrays.
 */
export function validateQualitativeReview(u: unknown): QualitativeReview {
  if (typeof u !== "object" || u === null || Array.isArray(u)) {
    throw new QualitativeValidationError({
      missingFields: [
        ...QUALITATIVE_SCORE_FIELDS,
        ...QUALITATIVE_TEXT_FIELDS,
      ],
      invalidFields: [{ field: "(response)", reason: "not_an_object" }],
      unknownScoreFields: [],
      notAnObject: true,
    });
  }
  const o = u as Record<string, unknown>;
  const missingFields: string[] = [];
  const invalidFields: QualitativeValidationIssue[] = [];
  const unknownScoreFields: string[] = [];
  for (const alias of QUALITATIVE_SCORE_ALIASES) {
    if (alias in o) unknownScoreFields.push(alias);
  }
  const scores = {} as Record<(typeof QUALITATIVE_SCORE_FIELDS)[number], number>;
  for (const field of QUALITATIVE_SCORE_FIELDS) {
    const v = o[field];
    if (v === undefined) {
      missingFields.push(field);
      continue;
    }
    if (typeof v !== "number") {
      invalidFields.push({ field, reason: "not_a_number" });
      continue;
    }
    if (!Number.isFinite(v)) {
      invalidFields.push({ field, reason: "not_finite" });
      continue;
    }
    if (v < 0 || v > 100) {
      invalidFields.push({ field, reason: "out_of_range" });
      continue;
    }
    scores[field] = v;
  }
  const lists = {} as Record<(typeof QUALITATIVE_TEXT_FIELDS)[number], string[]>;
  for (const field of QUALITATIVE_TEXT_FIELDS) {
    const v = o[field];
    if (v === undefined) {
      missingFields.push(field);
      continue;
    }
    if (!Array.isArray(v) || v.some((x) => typeof x !== "string")) {
      invalidFields.push({ field, reason: "not_string_array" });
      continue;
    }
    lists[field] = v as string[];
  }
  if (
    missingFields.length > 0 ||
    invalidFields.length > 0 ||
    unknownScoreFields.length > 0
  ) {
    throw new QualitativeValidationError({
      missingFields,
      invalidFields,
      unknownScoreFields,
    });
  }
  return {
    problemSolving: scores.problemSolving,
    understanding: scores.understanding,
    testing: scores.testing,
    strengths: lists.strengths,
    weaknesses: lists.weaknesses,
    improvements: lists.improvements,
  };
}

/** Thrown by requestQualitativeReview when the live review cannot be
 *  produced or validated. `.record` is the structured failure record
 *  stored on the evaluation — safe diagnostics only. */
export class QualitativeReviewError extends Error {
  readonly record: QualitativeFailureRecord;
  constructor(record: QualitativeFailureRecord) {
    super(`Qualitative review failed (${record.code}): ${record.detail}`);
    this.name = "QualitativeReviewError";
    this.record = record;
  }
}

export interface QualitativeReviewInput {
  challengeTitle: string | null;
  acceptanceCriteria: string[];
  functionalScore: number;
  qualityScore: number;
  qualityIssues: string[];
  securityFindings: string[];
  filesChanged: string[];
  monitoring: {
    testRuns: unknown;
    compileErrors: unknown;
    observations: unknown;
  };
}

const QUALITATIVE_OPERATION = "evaluation-qualitative";

/** Retry count of the most recent LLM call tagged with this operation,
 *  read from the LLM usage log (the log records duration/retry-count
 *  per call, including failures). Null when the log has no such entry
 *  (e.g. the llm module was compiled without operation tagging). */
function lastQualitativeRetryCount(): number | null {
  const log = getLlmUsageLog();
  for (let i = log.length - 1; i >= 0; i--) {
    const entry = log[i] as unknown as
      | { operation?: unknown; retryCount?: unknown }
      | undefined;
    if (entry?.operation === QUALITATIVE_OPERATION) {
      return typeof entry.retryCount === "number" ? entry.retryCount : null;
    }
  }
  return null;
}

function classifyLlmError(err: unknown): {
  code: QualitativeFailureCode;
  httpStatus: number | null;
  detail: string;
} {
  const status =
    err instanceof ApiError
      ? err.status
      : typeof (err as { status?: unknown } | null)?.status === "number"
        ? ((err as { status: number }).status as number)
        : null;
  const message = err instanceof Error ? err.message : String(err);
  if (/timed out/i.test(message))
    // A timeout has no HTTP response: httpStatus stays null so the
    // record can never be mistaken for a provider 5xx.
    return { code: "timeout", httpStatus: null, detail: "LLM request timed out" };
  if (status === 401 || status === 403 || /authentication failed/i.test(message))
    return {
      code: "authentication_failed",
      httpStatus: status,
      detail: "LLM authentication failed",
    };
  const httpMatch = message.match(/HTTP (\d{3})/);
  const httpStatus = httpMatch ? Number(httpMatch[1]) : status;
  if (httpStatus !== null) {
    return {
      code: httpStatus === 429 || httpStatus >= 500
        ? "provider_unavailable"
        : "provider_error",
      httpStatus,
      detail: `LLM provider error: HTTP ${httpStatus}`,
    };
  }
  if (/empty response/i.test(message))
    return { code: "empty_response", httpStatus: null, detail: "LLM provider returned an empty response" };
  if (/rate limit/i.test(message))
    return { code: "provider_unavailable", httpStatus: status, detail: "LLM rate limit exceeded" };
  return { code: "provider_unavailable", httpStatus: status, detail: "LLM request failed" };
}

/**
 * Runs ONE live qualitative review against the configured LLM and
 * strictly validates the result. Uses chatCompletion (not chatJson)
 * so provider/model metadata is available to the caller for the
 * failure record. Throws QualitativeReviewError on ANY failure
 * (transport, timeout, invalid JSON, schema validation) — never
 * returns a partial or defaulted review.
 */
export async function requestQualitativeReview(
  input: QualitativeReviewInput,
): Promise<{
  review: QualitativeReview;
  provider: "live" | "mock";
  model: string;
  durationMs: number;
  retryCount: number | null;
}> {
  const startedAt = Date.now();
  const system =
    "You are a senior engineering reviewer. Score ONLY from the evidence given (test results, code-quality signals, and the monitoring summary). Never invent test results. Return strict JSON.\n\n" +
    QUALITATIVE_JSON_SCHEMA_TEXT;
  const user = JSON.stringify({
    challenge: input.challengeTitle,
    acceptanceCriteria: input.acceptanceCriteria,
    functionalScore: input.functionalScore,
    qualityScore: input.qualityScore,
    qualityIssues: input.qualityIssues,
    securityFindings: input.securityFindings,
    filesChanged: input.filesChanged,
    monitoring: input.monitoring,
  });
  let result: Awaited<ReturnType<typeof chatCompletion>>;
  try {
    result = await chatCompletion({
      system,
      user,
      jsonMode: true,
      operation: QUALITATIVE_OPERATION,
    });
  } catch (err) {
    const c = classifyLlmError(err);
    throw new QualitativeReviewError({
      code: c.code,
      schemaVersion: QUALITATIVE_SCHEMA_VERSION,
      provider: null,
      model: null,
      httpStatus: c.httpStatus,
      missingFields: [],
      invalidFields: [],
      unknownScoreFields: [],
      durationMs: Date.now() - startedAt,
      retryCount: lastQualitativeRetryCount(),
      detail: c.detail,
    });
  }
  const durationMs = Date.now() - startedAt;
  const retryCount = lastQualitativeRetryCount();
  let parsed: unknown;
  try {
    parsed = JSON.parse(stripJsonFences(result.text));
  } catch {
    throw new QualitativeReviewError({
      code: "invalid_json",
      schemaVersion: QUALITATIVE_SCHEMA_VERSION,
      provider: result.provider,
      model: result.model,
      httpStatus: null,
      missingFields: [],
      invalidFields: [],
      unknownScoreFields: [],
      durationMs,
      retryCount,
      detail: "LLM returned invalid JSON",
    });
  }
  try {
    const review = validateQualitativeReview(parsed);
    return { review, provider: result.provider, model: result.model, durationMs, retryCount };
  } catch (e) {
    if (e instanceof QualitativeValidationError) {
      throw new QualitativeReviewError({
        code: "schema_validation_failed",
        schemaVersion: QUALITATIVE_SCHEMA_VERSION,
        provider: result.provider,
        model: result.model,
        httpStatus: null,
        missingFields: e.missingFields,
        invalidFields: e.invalidFields,
        unknownScoreFields: e.unknownScoreFields,
        durationMs,
        retryCount,
        detail: e.message,
      });
    }
    throw e;
  }
}

/**
 * Overall score from category scores. When all five categories are
 * present it is the fixed-weight sum. When the qualitative categories
 * failed (null), the overall is computed ONLY from the verified
 * dimensions (functional + quality) and renormalised by their combined
 * weight (0.5) — the missing qualitative categories contribute nothing
 * and are NEVER silently counted as 0.
 */
export function computeOverallScore(scores: {
  functional: number;
  quality: number;
  problemSolving: number | null;
  understanding: number | null;
  testing: number | null;
}): { overall: number; basis: OverallBasis } {
  const qualitativePresent =
    scores.problemSolving !== null &&
    scores.understanding !== null &&
    scores.testing !== null;
  if (qualitativePresent) {
    const overall =
      Math.round(
        (scores.functional * EVALUATION_WEIGHTS.functional +
          scores.quality * EVALUATION_WEIGHTS.quality +
          (scores.problemSolving as number) * EVALUATION_WEIGHTS.problemSolving +
          (scores.understanding as number) * EVALUATION_WEIGHTS.understanding +
          (scores.testing as number) * EVALUATION_WEIGHTS.testing) *
          100,
      ) / 100;
    return { overall, basis: "all-dimensions" };
  }
  const verifiedWeight =
    EVALUATION_WEIGHTS.functional + EVALUATION_WEIGHTS.quality;
  const overall =
    Math.round(
      ((scores.functional * EVALUATION_WEIGHTS.functional +
        scores.quality * EVALUATION_WEIGHTS.quality) /
        verifiedWeight) *
        100,
    ) / 100;
  return { overall, basis: "verified-dimensions-only" };
}

async function qualitativeByHeuristic(opts: {
  files: Record<string, string>;
  originalFiles: Record<string, string>;
  passed: number;
  total: number;
}): Promise<{ problemSolving: number; understanding: number; testing: number; strengths: string[]; weaknesses: string[]; improvements: string[] }> {
  const changed = Object.keys(opts.files).filter(
    (k) => opts.files[k] !== opts.originalFiles[k],
  );
  const testFiles = Object.keys(opts.files).filter((k) => k.includes("test"));
  const passRate = opts.total > 0 ? opts.passed / opts.total : 0;
  const strengths: string[] = [];
  const weaknesses: string[] = [];
  if (changed.length > 0) strengths.push(`Changed ${changed.length} file(s) to address the task.`);
  else weaknesses.push("No files were changed from the original project.");
  if (passRate >= 0.8) strengths.push("Most executed tests pass.");
  else if (opts.total > 0) weaknesses.push(`Only ${opts.passed} of ${opts.total} executed tests pass.`);
  if (testFiles.length > 0) strengths.push("Test files are present in the submission.");
  else weaknesses.push("No test files in the submission — testing cannot be evidenced.");
  // Heuristic scores are deliberately capped: without an LLM qualitative
  // review they are weak evidence, so they never exceed 60.
  return {
    problemSolving: Math.min(60, Math.round(30 + passRate * 30 + Math.min(10, changed.length * 2))),
    understanding: Math.min(60, Math.round(35 + Math.min(15, changed.length * 3))),
    testing: Math.min(60, Math.round(passRate * 50 + (testFiles.length > 0 ? 10 : 0))),
    strengths,
    weaknesses,
    improvements: [
      "Add or extend tests covering the changed behaviour.",
      "Ask for a human review of the qualitative categories (AI review was unavailable).",
    ],
  };
}

export async function evaluateAssessment(
  assessmentId: string,
): Promise<EvaluationReport> {
  const assessment = await loadAssessmentById(assessmentId);
  if (assessment.status !== "evaluating" && assessment.status !== "completed") {
    throw new ApiError(409, `Cannot evaluate an assessment in status ${assessment.status}`);
  }
  const existing = await pool.query(
    `SELECT * FROM evaluations WHERE assessment_id = $1`,
    [assessmentId],
  );
  if (existing.rows.length && existing.rows[0].status === "completed") {
    return rowToReport(existing.rows[0]);
  }
  const snap = await pool.query(
    `SELECT * FROM code_snapshots WHERE assessment_id = $1 ORDER BY version DESC LIMIT 1`,
    [assessmentId],
  );
  if (!snap.rows.length) throw new ApiError(409, "No submitted snapshot to evaluate");
  const snapshot = snap.rows[0];
  const files = (snapshot.files as Record<string, string>) ?? {};
  const originalSnap = await pool.query(
    `SELECT files FROM code_snapshots WHERE assessment_id = $1 AND version = 0`,
    [assessmentId],
  );
  const originalFiles = (originalSnap.rows[0]?.files as Record<string, string> | undefined) ?? {};
  const challenge = await pool.query(
    `SELECT * FROM challenges WHERE assessment_id = $1`,
    [assessmentId],
  );
  const challengeRow = challenge.rows[0];
  const testEvents = await pool.query(
    `SELECT * FROM test_execution_events WHERE assessment_id = $1 ORDER BY created_at ASC`,
    [assessmentId],
  );
  // Functional correctness: ONLY executed tests. Hidden runs are the
  // authoritative measure; visible runs are supporting evidence.
  const hidden = testEvents.rows.filter((r) => (r.results as unknown[] | null) !== null && String(r.test_command) === "hidden test suite");
  const visible = testEvents.rows.filter((r) => String(r.test_command) !== "hidden test suite");
  const sum = (rows: typeof testEvents.rows): { passed: number; total: number } =>
    rows.reduce(
      (acc, r) => ({ passed: acc.passed + Number(r.passed), total: acc.total + Number(r.total) }),
      { passed: 0, total: 0 },
    );
  const hiddenTotals = sum(hidden.length ? hidden : visible);
  const visibleTotals = sum(visible);
  const functional =
    hiddenTotals.total > 0
      ? Math.round((hiddenTotals.passed / hiddenTotals.total) * 100)
      : 0;
  const passedTests: string[] = [];
  const failedTests: string[] = [];
  for (const r of testEvents.rows) {
    const results = (r.results as string[] | null) ?? [];
    if (Number(r.failed) > 0) failedTests.push(...results);
    else passedTests.push(`${r.test_command} (${r.passed}/${r.total})`);
  }
  const quality = analyzeCodeQuality(files);
  const security = securityScan(files);
  const events = await listEventsFor(assessmentId);
  const monitoringSummary = buildActivitySummary(assessmentId, events);
  const aiAvailable = llmConfigured();
  let qualitative: QualitativeReview | null = null;
  let method: QualitativeMethod = "deterministic-heuristic";
  let qualitativeFailure: QualitativeFailureRecord | null = null;
  let qualitativeProvider: string | null = null;
  let qualitativeModel: string | null = null;
  if (aiAvailable) {
    try {
      const criteria = (challengeRow?.acceptance_criteria as string[] | null) ?? [];
      const res = await requestQualitativeReview({
        challengeTitle: challengeRow?.title ?? null,
        acceptanceCriteria: criteria,
        functionalScore: functional,
        qualityScore: quality.score,
        qualityIssues: quality.issues,
        securityFindings: security,
        filesChanged: Object.keys(files).filter((k) => files[k] !== originalFiles[k]),
        monitoring: {
          testRuns: monitoringSummary.testRuns,
          compileErrors: monitoringSummary.compileErrors,
          observations: monitoringSummary.observations,
        },
      });
      qualitative = res.review;
      method = "live-ai";
      qualitativeProvider = res.provider;
      qualitativeModel = res.model;
    } catch (err) {
      // P0 fallback policy (a) — FAIL LOUD, never fail silent:
      // a live review that cannot be produced or validated leaves the
      // qualitative categories null (never 0, never a silent heuristic
      // substitution). The overall score below is computed from the
      // verified dimensions only, human review is required, and the
      // structured failure is stored in evidence.qualitativeFailure.
      // Safe diagnostics only — no prompts, answers, or repo contents.
      if (err instanceof QualitativeReviewError) {
        qualitativeFailure = err.record;
      } else {
        qualitativeFailure = {
          code: "provider_error",
          schemaVersion: QUALITATIVE_SCHEMA_VERSION,
          provider: null,
          model: null,
          httpStatus: null,
          missingFields: [],
          invalidFields: [],
          unknownScoreFields: [],
          durationMs: 0,
          retryCount: null,
          detail: "Unexpected qualitative review error",
        };
      }
      method = "failed";
      console.error(
        "[evaluation] qualitative review failed " +
          JSON.stringify({
            assessmentId,
            code: qualitativeFailure.code,
            schemaVersion: qualitativeFailure.schemaVersion,
            provider: qualitativeFailure.provider,
            model: qualitativeFailure.model,
            httpStatus: qualitativeFailure.httpStatus,
            missingFields: qualitativeFailure.missingFields,
            invalidFields: qualitativeFailure.invalidFields,
            unknownScoreFields: qualitativeFailure.unknownScoreFields,
            durationMs: qualitativeFailure.durationMs,
            retryCount: qualitativeFailure.retryCount,
          }),
      );
    }
  } else {
    qualitative = await qualitativeByHeuristic({
      files,
      originalFiles,
      passed: hiddenTotals.passed,
      total: hiddenTotals.total,
    });
  }
  const categoryScores: Record<string, number | null> = {
    functional,
    quality: quality.score,
    problemSolving: qualitative?.problemSolving ?? null,
    understanding: qualitative?.understanding ?? null,
    testing: qualitative?.testing ?? null,
  };
  // When the live review failed, the overall comes ONLY from the
  // verified dimensions (functional + quality, renormalised) — the
  // failed qualitative categories contribute nothing and never read
  // as 0. See computeOverallScore + docs/SCORING_METHODOLOGY.md §2.1.
  const { overall, basis: overallBasis } = computeOverallScore({
    functional,
    quality: quality.score,
    problemSolving: categoryScores.problemSolving,
    understanding: categoryScores.understanding,
    testing: categoryScores.testing,
  });
  const humanReview =
    method !== "live-ai" ||
    security.length > 0 ||
    functional < 50 ||
    hiddenTotals.total === 0;
  const confidence =
    method === "live-ai"
      ? hiddenTotals.total > 0
        ? 0.85
        : 0.6
      : method === "failed"
        ? 0.3
        : 0.5;
  const evidence = {
    snapshotHash: snapshot.snapshot_hash as string,
    snapshotVersion: snapshot.version as number,
    hiddenTests: hiddenTotals,
    visibleTests: visibleTotals,
    monitoring: {
      durationSeconds: monitoringSummary.durationSeconds,
      activeSeconds: monitoringSummary.activeSeconds,
      testRuns: monitoringSummary.testRuns.runs,
      compileErrors: monitoringSummary.compileErrors,
    },
    challengeTitle: challengeRow?.title ?? null,
    qualitativeMethod: method,
    qualitativeSchemaVersion: QUALITATIVE_SCHEMA_VERSION,
    qualitativeProvider,
    qualitativeModel,
    qualitativeFailure,
    overallBasis,
  };
  // A failed review contributes no AI feedback text: the lists stay
  // honest about the gap instead of inventing strengths or scores.
  const strengths = qualitative ? [...new Set(qualitative.strengths)] : [];
  if (functional >= 80) strengths.push("Strong functional correctness on executed tests.");
  const weaknesses = qualitative
    ? [...new Set(qualitative.weaknesses)]
    : [
        "Qualitative AI review failed — problem-solving, understanding and testing are unassessed (see evidence.qualitativeFailure); human review recommended.",
      ];
  if (security.length > 0) weaknesses.push("Security findings need fixing (see security_findings).");
  const improvements = qualitative
    ? [...new Set(qualitative.improvements)]
    : ["Ask a human reviewer to assess problem-solving, understanding, and testing."];
  const inserted = await pool.query(
    `INSERT INTO evaluations
       (assessment_id, overall_score, category_scores, evidence, passed_tests, failed_tests,
        quality_issues, security_findings, improvements, strengths, weaknesses,
        confidence, human_review_recommended, status)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,'completed')
     ON CONFLICT (assessment_id) DO UPDATE SET
       overall_score = EXCLUDED.overall_score, category_scores = EXCLUDED.category_scores,
       evidence = EXCLUDED.evidence, passed_tests = EXCLUDED.passed_tests,
       failed_tests = EXCLUDED.failed_tests, quality_issues = EXCLUDED.quality_issues,
       security_findings = EXCLUDED.security_findings, improvements = EXCLUDED.improvements,
       strengths = EXCLUDED.strengths, weaknesses = EXCLUDED.weaknesses,
       confidence = EXCLUDED.confidence,
       human_review_recommended = EXCLUDED.human_review_recommended,
       status = 'completed'
     RETURNING *`,
    [
      assessmentId,
      overall,
      JSON.stringify(categoryScores),
      JSON.stringify(evidence),
      JSON.stringify(passedTests),
      JSON.stringify(failedTests),
      JSON.stringify(quality.issues),
      JSON.stringify(security),
      JSON.stringify(improvements),
      JSON.stringify(strengths),
      JSON.stringify(weaknesses),
      confidence,
      humanReview,
    ],
  );
  await pool.query(
    `UPDATE assessments SET status = 'completed', ended_at = now(), updated_at = now() WHERE id = $1`,
    [assessmentId],
  );
  // Phase 7: the candidate's evaluation is complete — the report is ready.
  // When the qualitative review failed, say so: the overall reflects
  // verified dimensions only and is not presented as a full AI review.
  await notifyCandidate(assessment.candidate_id, {
    type: "assessment",
    title: "Assessment report ready",
    body:
      method === "failed"
        ? `Your assessment evaluation is complete — overall score ${overall}% from verified test and code-quality dimensions only (the AI qualitative review failed; human review recommended). View the report for the full breakdown.`
        : `Your assessment evaluation is complete — overall score ${overall}%. View the report for the full breakdown.`,
    link: "/assessment",
  });
  // Verified skills: only skills the candidate listed AND the assessment
  // evidenced (functional score >= 70 and the skill appears in the changed
  // code or challenge context). Never label untested skills verified.
  if (functional >= 70) {
    const skills = await pool.query(
      `SELECT s.id, s.name FROM candidate_skills cs
        JOIN skills s ON s.id = cs.skill_id
        WHERE cs.candidate_id = $1`,
      [assessment.candidate_id],
    );
    const haystack = JSON.stringify(files).toLowerCase();
    for (const skill of skills.rows) {
      const name = String(skill.name).toLowerCase();
      if (haystack.includes(name)) {
        await pool.query(
          `INSERT INTO verified_skills (candidate_id, skill_id, assessment_id, evidence, status)
           VALUES ($1, $2, $3, $4, 'verified')
           ON CONFLICT (candidate_id, skill_id) DO UPDATE SET
             assessment_id = EXCLUDED.assessment_id, evidence = EXCLUDED.evidence,
             status = 'verified', verified_at = now()`,
          [
            assessment.candidate_id,
            skill.id,
            assessmentId,
            JSON.stringify({
              assessment_id: assessmentId,
              functional_score: functional,
              test_pass_rate:
                hiddenTotals.total > 0 ? hiddenTotals.passed / hiddenTotals.total : null,
            }),
          ],
        );
      }
    }
  }
  const report = rowToReport(inserted.rows[0]);
  report.aiAvailable = aiAvailable;
  report.qualitativeMethod = method;
  return report;
}

async function listEventsFor(assessmentId: string) {
  const res = await pool.query(
    `SELECT * FROM assessment_events WHERE assessment_id = $1 ORDER BY created_at ASC`,
    [assessmentId],
  );
  return res.rows as Parameters<typeof buildActivitySummary>[1];
}

export async function getEvaluation(
  assessmentId: string,
): Promise<EvaluationReport | null> {
  const res = await pool.query(
    `SELECT * FROM evaluations WHERE assessment_id = $1`,
    [assessmentId],
  );
  if (!res.rows.length) return null;
  const report = rowToReport(res.rows[0]);
  report.aiAvailable = llmConfigured();
  return report;
}

function rowToReport(row: Record<string, unknown>): EvaluationReport {
  const categories = (row.category_scores as Record<string, number | null> | null) ?? {};
  const evidence = (row.evidence as Record<string, unknown> | null) ?? {};
  // The qualitative method / failure / basis are persisted in evidence
  // (no migration touched by this change). Legacy rows predate those
  // fields: null qualitative categories mean a failed review, anything
  // else defaults to the old deterministic-heuristic label. A legacy
  // "llm" label maps to the current "live-ai".
  const rawMethod = evidence.qualitativeMethod;
  const qualitativeMethod: QualitativeMethod =
    rawMethod === "live-ai" ||
    rawMethod === "failed" ||
    rawMethod === "deterministic-heuristic"
      ? rawMethod
      : rawMethod === "llm"
        ? "live-ai"
        : categoryScoresFailed(categories)
          ? "failed"
          : "deterministic-heuristic";
  const rawFailure = evidence.qualitativeFailure as
    | QualitativeFailureRecord
    | null
    | undefined;
  const rawBasis = evidence.overallBasis;
  return {
    id: String(row.id),
    assessmentId: String(row.assessment_id),
    overallScore: row.overall_score === null ? null : Number(row.overall_score),
    categoryScores: categories,
    evidence,
    passedTests: (row.passed_tests as string[] | null) ?? [],
    failedTests: (row.failed_tests as string[] | null) ?? [],
    qualityIssues: (row.quality_issues as string[] | null) ?? [],
    securityFindings: (row.security_findings as string[] | null) ?? [],
    improvements: (row.improvements as string[] | null) ?? [],
    strengths: (row.strengths as string[] | null) ?? [],
    weaknesses: (row.weaknesses as string[] | null) ?? [],
    confidence: row.confidence === null ? 0 : Number(row.confidence),
    humanReviewRecommended: Boolean(row.human_review_recommended),
    aiAvailable: false,
    qualitativeMethod,
    qualitativeFailure: rawFailure ?? null,
    overallBasis:
      rawBasis === "verified-dimensions-only" ? "verified-dimensions-only" : "all-dimensions",
    status: String(row.status),
  };
}

/** True when any qualitative category is null (failed/unassessed). */
function categoryScoresFailed(
  categories: Record<string, number | null>,
): boolean {
  return (
    categories.problemSolving === null ||
    categories.understanding === null ||
    categories.testing === null
  );
}
