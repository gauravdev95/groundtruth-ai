import { pool } from "../config/db";
import { env } from "../config/env";
import { ApiError } from "../middleware/errorHandler";
import { chatJson, llmConfigured, getLlmUsageLog, getLlmModel } from "./llm";
import { loadAssessmentById } from "./assessments";
import { getEvaluation } from "./evaluation";
import { listEvents } from "./monitoring";
import {
  FRAMEWORK_VERSION,
  type RoleFramework,
} from "../config/competencyFramework";
import { getFramework } from "./competencyScoringService";

// ── Personalised AI technical interview ────────────────────────────────────
// Generated AFTER the coding assessment is evaluated, from the candidate's
// real data: original project, repo architecture, original code, actual
// code changes, challenge, passed/failed tests, evaluation report, skills,
// weak areas. Categories A–H. Adaptive: the next question depends on the
// previous answer. Interview score is SEPARATE from the coding score.
// Accent/grammar/language proficiency are never penalised — evaluation is
// about engineering knowledge only.

export const INTERVIEW_CATEGORIES = [
  "project_understanding",
  "architecture_design",
  "code_changes",
  "fundamentals",
  "debugging",
  "security_performance",
  "testing_edge_cases",
  "follow_up",
] as const;

export type InterviewCategory = (typeof INTERVIEW_CATEGORIES)[number];

export interface InterviewQuestionRow {
  id: string;
  interview_id: string;
  category: string;
  question: string;
  question_order: number;
  created_at: string;
  // Phase C pre-generation spec — every question is persisted with its
  // full spec BEFORE the session starts; nothing is generated live.
  competency_id: string | null;
  difficulty: string | null;
  expected_points: string[];
  scoring_rubric: Record<string, string>;
  max_time_seconds: number;
  context: Record<string, unknown>;
  framework_version: string | null;
  source: string;
  is_follow_up: boolean;
  follow_up_of_question_id: string | null;
}

export interface InterviewRow {
  id: string;
  candidate_id: string;
  assessment_id: string | null;
  status: string;
  score: number | null;
  transcript: string | null;
  report: Record<string, unknown> | null;
  created_at: string;
}

interface AssessmentContext {
  challengeTitle: string;
  changedFiles: string[];
  failedTests: string[];
  passedTests: string[];
  weakAreas: string[];
  strengths: string[];
  overallScore: number | null;
  technologies: string[];
}

/** Load the real assessment context an interview question is built from. */
export async function loadAssessmentContext(
  assessmentId: string,
): Promise<AssessmentContext> {
  const assessment = await loadAssessmentById(assessmentId);
  const challenge = await pool.query(
    `SELECT title, required_functionality FROM challenges WHERE assessment_id = $1`,
    [assessmentId],
  );
  const evaluation = await getEvaluation(assessmentId);
  const original = await pool.query(
    `SELECT files FROM code_snapshots WHERE assessment_id = $1 AND version = 0`,
    [assessmentId],
  );
  const latest = await pool.query(
    `SELECT files FROM code_snapshots WHERE assessment_id = $1 ORDER BY version DESC LIMIT 1`,
    [assessmentId],
  );
  const originalFiles = (original.rows[0]?.files as Record<string, string> | undefined) ?? {};
  const latestFiles = (latest.rows[0]?.files as Record<string, string> | undefined) ?? {};
  const changedFiles = Object.keys(latestFiles).filter(
    (k) => latestFiles[k] !== originalFiles[k],
  );
  const technologies = new Set<string>();
  for (const content of Object.values(latestFiles)) {
    for (const m of content.matchAll(/import\s+(\w+)|from\s+(\w+)\s+import|require\(['"]([\w-]+)['"]\)/g)) {
      const name = m[1] ?? m[2] ?? m[3];
      if (name) technologies.add(name);
    }
  }
  return {
    challengeTitle: (challenge.rows[0]?.title as string | undefined) ?? "the coding challenge",
    changedFiles,
    failedTests: evaluation?.failedTests ?? [],
    passedTests: evaluation?.passedTests ?? [],
    weakAreas: evaluation?.weaknesses ?? [],
    strengths: evaluation?.strengths ?? [],
    overallScore: evaluation?.overallScore ?? null,
    technologies: [...technologies].slice(0, 20),
  };
}

/** Deterministic question templates filled with the candidate's real data. */
export function buildDeterministicQuestions(
  ctx: AssessmentContext,
): { category: InterviewCategory; question: string }[] {
  const file = ctx.changedFiles[0] ?? "the main implementation file";
  const failed = ctx.failedTests[0] ?? null;
  const weak = ctx.weakAreas[0] ?? "testing";
  const questions: { category: InterviewCategory; question: string }[] = [
    {
      category: "project_understanding",
      question: `In your own words, what does this project do, and which part of it did the challenge "${ctx.challengeTitle}" ask you to change?`,
    },
    {
      category: "architecture_design",
      question: `Explain the architecture of the project you worked on — how do its main components fit together, and where does ${file} sit in that picture?`,
    },
    {
      category: "code_changes",
      question: `Why did you change ${file}${ctx.changedFiles.length > 1 ? ` (and ${ctx.changedFiles.length - 1} other file(s))` : ""}? Walk through the most important change you made and why you chose that approach.`,
    },
    {
      category: "fundamentals",
      question: `The challenge involved ${ctx.technologies.slice(0, 3).join(", ") || "the project's stack"}. Explain one core concept from that stack that your solution relies on, and what would break if it worked differently.`,
    },
    {
      category: "debugging",
      question: failed
        ? `One of your tests failed: "${failed}". What caused it, how did you identify the cause, and what did you change to address it?`
        : `What was the most difficult bug or error you encountered during the assessment, and how did you track it down?`,
    },
    {
      category: "security_performance",
      question: `What security or performance risks exist in your implementation, and what would you change if this code went to production?`,
    },
    {
      category: "testing_edge_cases",
      question: `Which edge cases did you test, which did you not get to, and how would you test the trickiest one?`,
    },
  ];
  if (ctx.weakAreas.length > 0) {
    questions.push({
      category: "follow_up",
      question: `Your evaluation noted a weak area: ${weak}. What would you do differently next time to strengthen it?`,
    });
  }
  return questions;
}

/** The 5 scoring dimensions for a Phase C interview answer (weights sum to 100). */
export const INTERVIEW_DIMENSIONS = [
  { key: "technicalCorrectness", label: "Technical correctness", weight: 30 },
  { key: "depthOfUnderstanding", label: "Depth of understanding", weight: 25 },
  { key: "relevance", label: "Relevance", weight: 15 },
  { key: "projectEvidence", label: "Project / code evidence", weight: 15 },
  { key: "communicationClarity", label: "Communication & clarity", weight: 15 },
] as const;

export type InterviewDimensionKey =
  (typeof INTERVIEW_DIMENSIONS)[number]["key"];

/** Documented rubric text per dimension — shown to the candidate in feedback. */
export const INTERVIEW_DIMENSION_RUBRIC: Record<InterviewDimensionKey, string> = {
  technicalCorrectness:
    "Correct facts and correct reasoning, with no material errors; claims about APIs, code or concepts match the candidate's real project.",
  depthOfUnderstanding:
    "Explains why, not just what: underlying principles, trade-offs and edge cases, not surface recall.",
  relevance:
    "Answers the question actually asked and stays on the competency being assessed.",
  projectEvidence:
    "Cites concrete evidence from the candidate's own code, project, tests or evaluation results.",
  communicationClarity:
    "Clear, structured and easy to follow, in precise technical language. Accent, grammar and language proficiency are never penalised.",
};

/** One pre-generated question with its full persisted spec (Phase C). */
export interface PreGeneratedQuestionSpec {
  category: InterviewCategory;
  competencyId: string;
  difficulty: string;
  question: string;
  expectedPoints: string[];
  scoringRubric: Record<string, string>;
  maxTimeSeconds: number;
  context: Record<string, unknown>;
  /** How the question probes the competency — one of exactly three kinds,
   *  so the 7-question set is never seven variations of one question. */
  questionType: QuestionType;
  /** Submitted file the question refers to (project-specific / scenario
   *  questions only); null for generic conceptual questions. Only ever a
   *  file from the candidate's actual submission — never invented code. */
  projectReference: string | null;
}

/** The three question kinds every 7-question set must contain. */
export const QUESTION_TYPES = [
  "project_specific",
  "conceptual",
  "engineering_scenario",
] as const;

export type QuestionType = (typeof QUESTION_TYPES)[number];

/** Structured record of why live question refinement did not produce the
 *  set that was persisted. Contains NO question text, candidate info, or
 *  model output — only field names and error codes, so it is safe to log
 *  and to store on the interview. */
export interface GenerationFailure {
  kind: "validation" | "timeout" | "auth" | "provider" | "invalid_json" | "not_configured";
  provider: "live" | "deterministic";
  model: string | null;
  httpStatus?: number;
  schemaVersion?: string;
  missingFields?: string[];
  extraFields?: string[];
  errorCodes?: string[];
  durationMs?: number;
  retryCount?: number | null;
  message?: string;
}

/**
 * Resolve the competency-framework role for a candidate's interview.
 * An explicit, valid role id wins; otherwise the candidate's target_roles
 * are matched by keyword; otherwise the generic backend-developer role is
 * used. The resolution is recorded in the question context so it is
 * auditable — it is never silently guessed at scoring time.
 */
export async function resolveRoleForCandidate(
  candidateId: string,
  explicitRoleId?: string,
): Promise<{ role: RoleFramework; resolvedFrom: "explicit" | "profile" | "default" }> {
  const framework = getFramework(FRAMEWORK_VERSION);
  if (explicitRoleId) {
    const role = framework.roles.find((r) => r.roleId === explicitRoleId);
    if (!role) {
      throw new ApiError(
        400,
        `Unknown role "${explicitRoleId}" (known: ${framework.roles.map((r) => r.roleId).join(", ")})`,
      );
    }
    return { role, resolvedFrom: "explicit" };
  }
  const cand = await pool.query(
    `SELECT target_roles FROM candidates WHERE id = $1`,
    [candidateId],
  );
  const targets = ((cand.rows[0]?.target_roles as string[] | undefined) ?? []).map((t) =>
    t.toLowerCase(),
  );
  const match = (re: RegExp): boolean => targets.some((t) => re.test(t));
  let roleId: string | null = null;
  if (match(/full[\s-]?stack/)) roleId = "full-stack-developer";
  else if (match(/front[\s-]?end/)) roleId = "frontend-developer";
  else if (match(/data[\s-]?scient/)) roleId = "data-scientist";
  else if (match(/ai|machine[\s-]?learning|\bml\b/)) roleId = "ai-ml-engineer";
  else if (match(/python/)) roleId = "python-developer";
  else if (match(/sde|software[\s-]?(development[\s-]?)?engineer|software[\s-]?developer/))
    roleId = "software-development-engineer";
  else if (match(/back[\s-]?end/)) roleId = "backend-developer";
  const role =
    framework.roles.find((r) => r.roleId === roleId) ??
    framework.roles.find((r) => r.roleId === "backend-developer")!;
  return { role, resolvedFrom: roleId ? "profile" : "default" };
}

/** Match evaluation weak areas to role competencies by skill overlap. */
function weakCompetencyIds(
  role: RoleFramework,
  weakAreas: string[],
): string[] {
  const weakText = weakAreas.join(" ").toLowerCase();
  const scored = role.competencies
    .map((c) => {
      const hits = c.skills.filter((s) => weakText.includes(s.toLowerCase())).length;
      const nameHit = weakText.includes(c.name.toLowerCase().split(" ")[0]) ? 1 : 0;
      return { id: c.id, hits: hits + nameHit };
    })
    .filter((s) => s.hits > 0)
    .sort((a, b) => b.hits - a.hits);
  return scored.map((s) => s.id);
}

/**
 * Deterministic Phase C question builder: exactly 7 questions.
 * Q1–Q5 cover all 5 competencies of the role (one each, in framework
 * order); Q6 targets the weakest competency (from evaluation weak areas,
 * else the highest-weight competency); Q7 is a project-understanding
 * question on the highest-weight competency. Each question carries its
 * competency, difficulty, expected answer points (from the L3 rubric +
 * real project context), the 5-dimension rubric, and its time budget.
 * No random generation happens during the live interview.
 *
 * The 7 are NOT variations of one question. Each has one of three
 * question types — project_specific (grounded in the candidate's actual
 * submitted files/challenge), conceptual (the competency's underlying
 * concept, generic to the competency), engineering_scenario (a situation
 * to reason through) — and a per-question expected-points set built from
 * that competency's own rubric + skills, so no two questions share the
 * same expected-points text: Q6/Q7 always carry an extra point the
 * Q1–Q5 question for the same competency does not have, and the
 * type-specific point differs across types. A question references only
 * the actual submitted files / challenge, or is generic to its
 * competency — code is never invented or attributed without evidence.
 */
export function buildPhaseCQuestions(
  ctx: AssessmentContext,
  role: RoleFramework,
): PreGeneratedQuestionSpec[] {
  const file = ctx.changedFiles[0] ?? "the main implementation file";
  const projectRef = `your project work on "${ctx.challengeTitle}"`;
  const weak = weakCompetencyIds(role, ctx.weakAreas);
  const weakest =
    role.competencies.find((c) => c.id === weak[0]) ??
    [...role.competencies].sort((a, b) => b.weight - a.weight)[0];
  const top =
    [...role.competencies].sort((a, b) => b.weight - a.weight)[0];
  const categories: InterviewCategory[] = [
    "project_understanding",
    "architecture_design",
    "code_changes",
    "fundamentals",
    "debugging",
    "security_performance",
    "testing_edge_cases",
  ];
  // Q1–Q5 types, in framework order: every kind appears at least once.
  const baseTypes: QuestionType[] = [
    "project_specific",
    "engineering_scenario",
    "conceptual",
    "project_specific",
    "engineering_scenario",
  ];
  const typePoint: Record<QuestionType, string> = {
    project_specific:
      "Grounds every claim in the submitted project: the actual files changed, the challenge requirements, and the observed test results.",
    conceptual:
      "Explains the underlying concept correctly — definitions, why it works, and where the naive approach fails.",
    engineering_scenario:
      "Reasons through the scenario with concrete trade-offs, failure modes, and how the choice would be verified.",
  };
  const specFor = (
    competency: RoleFramework["competencies"][number],
    category: InterviewCategory,
    questionType: QuestionType,
    question: string,
    extraPoints: string[],
  ): PreGeneratedQuestionSpec => ({
    category,
    competencyId: competency.id,
    difficulty: competency.difficulty,
    question,
    questionType,
    projectReference:
      questionType === "conceptual" ? null : file,
    expectedPoints: [
      competency.rubric.L3,
      `A concrete example from your own code or project (${file}) showing ${competency.name} — name the file or function you changed, using ${competency.skills.slice(0, 3).join(", ")}.`,
      typePoint[questionType],
      ...extraPoints,
    ],
    scoringRubric: { ...INTERVIEW_DIMENSION_RUBRIC },
    maxTimeSeconds: env.interviewPerQuestionSeconds,
    context: {
      challengeTitle: ctx.challengeTitle,
      changedFiles: ctx.changedFiles,
      failedTests: ctx.failedTests,
      passedTests: ctx.passedTests,
      technologies: ctx.technologies,
      competencyName: competency.name,
      questionType,
      projectReference: questionType === "conceptual" ? null : file,
    },
  });
  const questions: PreGeneratedQuestionSpec[] = role.competencies.map((c, i) =>
    specFor(
      c,
      categories[i],
      baseTypes[i] as QuestionType,
      // The competency's own interview mapping is the question's core, so
      // a DB question actually tests DB knowledge and a system-design
      // question actually tests system design — never a generic template.
      `${c.interviewQuestionMapping} Answer with reference to ${projectRef}${ctx.changedFiles.length ? `, especially the changes you made in ${file}` : ""}.`,
      [],
    ),
  );
  questions.push(
    specFor(
      weakest,
      categories[5],
      "engineering_scenario",
      ctx.weakAreas.length > 0
        ? `Your evaluation noted a weak area: ${ctx.weakAreas[0]}. Suppose the ${weakest.name} part of ${projectRef} starts failing under real use — for example, ${ctx.failedTests.length > 0 ? `the failing test "${ctx.failedTests[0]}" reappears in production` : "a case your tests never covered shows up"}. In the context of ${weakest.name}, what would you change, in what order, and how would you check that the improvement actually worked?`
        : `For ${weakest.name} — the area this role weighs most heavily — suppose ${projectRef} must now handle ten times the load it was built for. What breaks first, what would you change, and how would you verify each change?`,
      [
        `What you would do differently next time to strengthen ${weakest.name}, and how you would verify the improvement.`,
        ...(ctx.failedTests.length > 0 ? [`What the failing test "${ctx.failedTests[0]}" taught you about ${weakest.name}.`] : []),
      ],
    ),
    specFor(
      top,
      categories[6],
      "project_specific",
      `In your own words, what does this project do, and which part of it did the challenge "${ctx.challengeTitle}" ask you to change? Walk through the most important change you made in ${file}, how it demonstrates ${top.name} (specifically ${top.skills.slice(0, 3).join(", ")}), and how you tested it.`,
      [
        ctx.technologies.length > 0
          ? `How ${ctx.technologies.slice(0, 3).join(", ")} shaped the change in ${file}.`
          : `What you would test first before shipping this change in ${file}.`,
      ],
    ),
  );
  return questions;
}

/** Schema version of the refined-questions JSON object. Bumped only when
 *  the expected shape changes; the version is pinned in the refine prompt
 *  and checked by the validator, so a stale or wrapped response is a
 *  validation failure, not a silent fallback. */
export const REFINED_QUESTIONS_SCHEMA_VERSION = "refined-questions-v1";

/** One validated refined question: wording only — competency, type and
 *  project reference must match the deterministic draft exactly. */
export interface RefinedQuestion {
  competencyId: string;
  question: string;
  questionType: QuestionType;
  projectReference: string | null;
}

const REFINED_QUESTION_KEYS = ["competencyId", "question", "questionType", "projectReference"] as const;
const REFINED_QUESTION_REQUIRED = ["competencyId", "question", "questionType"] as const;

/** Error carrying the structured failure record (no question/candidate
 *  content) so the caller can log and persist the reason. */
export class RefinedQuestionsValidationError extends Error {
  failure: GenerationFailure;
  constructor(failure: GenerationFailure) {
    super(failure.message ?? "Refined questions failed schema validation");
    this.failure = failure;
  }
}

/**
 * Strict validator for the live refine response. The expected shape is a
 * JSON OBJECT (the llm client requests response_format {type:
 * "json_object"}, which forbids a top-level array — the old prompt asked
 * for a bare array, which the model could not return in json_object mode):
 *
 *   {"schemaVersion": "refined-questions-v1",
 *    "questions": [{"competencyId": string, "question": string,
 *                    "questionType": "project_specific" | "conceptual" |
 *                      "engineering_scenario",
 *                    "projectReference": string | null}]}
 *
 * Exactly 7 questions, in draft order, with the same competencyId,
 * questionType and projectReference as the draft — only the question
 * wording may change. Extra or missing required fields, wrong types,
 * a wrong schema version, or a competency/type mismatch all fail, with
 * the offending field names and error codes collected (never the
 * question text) in the thrown RefinedQuestionsValidationError.
 */
export function validateRefinedQuestions(
  parsed: unknown,
  expected: PreGeneratedQuestionSpec[],
): RefinedQuestion[] {
  const missingFields: string[] = [];
  const extraFields: string[] = [];
  const errorCodes = new Set<string>();
  const fail = (message: string): never => {
    throw new RefinedQuestionsValidationError({
      kind: "validation",
      provider: "deterministic",
      model: null,
      schemaVersion: REFINED_QUESTIONS_SCHEMA_VERSION,
      missingFields,
      extraFields,
      errorCodes: [...errorCodes],
      message,
    });
  };
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    errorCodes.add("not_an_object");
    return fail("Refined response must be a JSON object");
  }
  const root = parsed as Record<string, unknown>;
  for (const key of Object.keys(root)) {
    if (key !== "schemaVersion" && key !== "questions") {
      extraFields.push(key);
      errorCodes.add("extra_field");
    }
  }
  if (root.schemaVersion === undefined) {
    missingFields.push("schemaVersion");
    errorCodes.add("missing_field");
  } else if (root.schemaVersion !== REFINED_QUESTIONS_SCHEMA_VERSION) {
    errorCodes.add("schema_version_mismatch");
    return fail(
      `schemaVersion must be "${REFINED_QUESTIONS_SCHEMA_VERSION}"`,
    );
  }
  if (!Array.isArray(root.questions)) {
    errorCodes.add("wrong_type");
    return fail("questions must be an array");
  }
  if (root.questions.length !== expected.length) {
    errorCodes.add("wrong_length");
    return fail(`Expected exactly ${expected.length} refined questions`);
  }
  const out: RefinedQuestion[] = root.questions.map((q, i) => {
    const path = `questions[${i}]`;
    if (typeof q !== "object" || q === null || Array.isArray(q)) {
      errorCodes.add("wrong_type");
      return fail(`${path} must be an object`);
    }
    const o = q as Record<string, unknown>;
    for (const key of Object.keys(o)) {
      if (!(REFINED_QUESTION_KEYS as readonly string[]).includes(key)) {
        extraFields.push(`${path}.${key}`);
        errorCodes.add("extra_field");
      }
    }
    for (const key of REFINED_QUESTION_REQUIRED) {
      if (o[key] === undefined) {
        missingFields.push(`${path}.${key}`);
        errorCodes.add("missing_field");
      }
    }
    if (missingFields.length > 0 || extraFields.length > 0) {
      return fail("Refined question is missing required fields or has extra fields");
    }
    if (typeof o.question !== "string" || o.question.trim().length < 10) {
      errorCodes.add(o.question === undefined ? "missing_field" : "question_too_short");
      return fail(`${path}.question must be a string of at least 10 characters`);
    }
    if (o.competencyId !== expected[i]?.competencyId) {
      errorCodes.add("competency_mismatch");
      return fail(`${path}.competencyId does not match the draft question`);
    }
    if (o.questionType !== expected[i]?.questionType) {
      errorCodes.add("question_type_mismatch");
      return fail(`${path}.questionType does not match the draft question`);
    }
    if (
      o.projectReference !== undefined &&
      o.projectReference !== null &&
      typeof o.projectReference !== "string"
    ) {
      errorCodes.add("wrong_type");
      return fail(`${path}.projectReference must be a string or null`);
    }
    if (
      o.projectReference !== undefined &&
      o.projectReference !== null &&
      o.projectReference !== expected[i]?.projectReference
    ) {
      errorCodes.add("project_reference_mismatch");
      return fail(`${path}.projectReference does not match the draft question`);
    }
    return {
      competencyId: o.competencyId as string,
      question: (o.question as string).trim(),
      questionType: o.questionType as QuestionType,
      projectReference:
        o.projectReference === undefined ? null : (o.projectReference as string | null),
    };
  });
  if (missingFields.length > 0 || extraFields.length > 0) {
    return fail("Refined response has missing or extra fields");
  }
  return out;
}

/** The exact JSON shape the refine prompt pins (mirrors the validator). */
export const REFINED_QUESTIONS_JSON_SCHEMA_TEXT =
  `{"schemaVersion": "refined-questions-v1", "questions": [` +
  `{"competencyId": "<exact id from the draft, unchanged>", ` +
  `"question": "<refined wording — one question only>", ` +
  `"questionType": "<exact type from the draft, unchanged>", ` +
  `"projectReference": "<exact file from the draft, or null>"}]}`;

/**
 * Pre-generate exactly 7 interview questions from the candidate's real
 * data (code snapshot, repo analysis, evaluation results + weak
 * competencies, role framework). The LLM may only refine the question
 * wording — it never changes the competency, the type, the count, or
 * the expected points. The refine call uses jsonMode, so the provider
 * is asked for response_format {type: "json_object"}; the prompt pins
 * the exact object shape above (a bare array cannot be returned in
 * json_object mode).
 *
 * No silent fallback: when the LLM is not configured, generationProvider
 * is "deterministic" (the deterministic bank — NOT the mock provider,
 * which is a different thing) and generationFailure records
 * kind "not_configured". When refinement fails, the failure is logged
 * as a structured line (provider, model, HTTP status, schema version,
 * missing/extra field names, validation error codes, duration, retry
 * count — never question text or candidate info), stored on the
 * returned result and on every persisted question's context, and the
 * deterministic questions stand, labelled "deterministic".
 * generationProvider is "live" ONLY when the live refine response
 * actually validated.
 */
export async function pregenerateInterviewQuestions(opts: {
  assessmentId: string;
  candidateId: string;
  roleId?: string;
}): Promise<{
  questions: PreGeneratedQuestionSpec[];
  roleId: string;
  frameworkVersion: string;
  generationProvider: "live" | "deterministic";
  generationMethod: "llm" | "deterministic";
  generationModel: string | null;
  generationFailure: GenerationFailure | null;
}> {
  const ctx = await loadAssessmentContext(opts.assessmentId);
  const { role } = await resolveRoleForCandidate(opts.candidateId, opts.roleId);
  const frameworkVersion = FRAMEWORK_VERSION;
  const questions = buildPhaseCQuestions(ctx, role);
  // Live value (not the import-time env snapshot) so a rotated/changed
  // AI_MODEL is recorded correctly.
  const model = getLlmModel() || null;
  if (!llmConfigured()) {
    return {
      questions,
      roleId: role.roleId,
      frameworkVersion,
      generationProvider: "deterministic",
      generationMethod: "deterministic",
      generationModel: null,
      generationFailure: {
        kind: "not_configured",
        provider: "deterministic",
        model: null,
        message: "No live LLM configured — deterministic questions used",
      },
    };
  }
  const startedAt = Date.now();
  try {
    const refined = await chatJson(
      {
        system:
          "You are a senior technical interviewer. Refine the given interview questions so each one is specific to the candidate's real project, changes and test results. Return EXACTLY 7 questions in the same order, with the same competencyId, questionType and projectReference values — only the question wording may change. Do not invent facts about the candidate, the project, or any code. Do not reveal expected answers, rubrics, or scoring. Return ONLY a JSON object with this exact shape, no other text, no extra fields, no missing fields: " +
          REFINED_QUESTIONS_JSON_SCHEMA_TEXT +
          " The top-level value must be an object (not an array). \"schemaVersion\" must be exactly \"refined-questions-v1\". \"questions\" must contain exactly 7 entries.",
        user: JSON.stringify({
          context: ctx,
          roleId: role.roleId,
          draftQuestions: questions.map((q) => ({
            competencyId: q.competencyId,
            question: q.question,
            questionType: q.questionType,
            projectReference: q.projectReference,
          })),
        }),
        jsonMode: true,
        operation: "interview-question-refine",
      },
      (u) => validateRefinedQuestions(u, questions),
    );
    const refinedQuestions = questions.map((q, i) => ({
      ...q,
      question: refined[i].question,
    }));
    return {
      questions: refinedQuestions,
      roleId: role.roleId,
      frameworkVersion,
      generationProvider: "live",
      generationMethod: "llm",
      generationModel: model,
      generationFailure: null,
    };
  } catch (err) {
    const durationMs = Date.now() - startedAt;
    const apiErr = err as { status?: number; message?: string; details?: unknown };
    const lastUsage = [...getLlmUsageLog()]
      .reverse()
      .find((e) => e.operation === "interview-question-refine");
    const detail = apiErr.details as Partial<GenerationFailure> | undefined;
    const message = apiErr.message ?? "LLM refinement failed";
    let failure: GenerationFailure;
    if (detail && detail.kind === "validation") {
      failure = {
        kind: "validation",
        provider: "deterministic",
        model,
        httpStatus: 200,
        schemaVersion: REFINED_QUESTIONS_SCHEMA_VERSION,
        missingFields: detail.missingFields ?? [],
        extraFields: detail.extraFields ?? [],
        errorCodes: detail.errorCodes ?? [],
        durationMs,
        retryCount: lastUsage?.retryCount ?? null,
        message,
      };
    } else if (/timed out/i.test(message)) {
      failure = {
        kind: "timeout",
        provider: "deterministic",
        model,
        httpStatus: apiErr.status,
        durationMs,
        retryCount: lastUsage?.retryCount ?? null,
        message,
      };
    } else if (apiErr.status === 401 || apiErr.status === 403 || /authentication failed/i.test(message)) {
      failure = {
        kind: "auth",
        provider: "deterministic",
        model,
        httpStatus: apiErr.status,
        durationMs,
        retryCount: lastUsage?.retryCount ?? null,
        message: "LLM authentication failed",
      };
    } else if (detail && detail.kind === "invalid_json") {
      failure = {
        kind: "invalid_json",
        provider: "deterministic",
        model,
        durationMs,
        retryCount: lastUsage?.retryCount ?? null,
        message,
      };
    } else {
      failure = {
        kind: "provider",
        provider: "deterministic",
        model,
        httpStatus: apiErr.status,
        durationMs,
        retryCount: lastUsage?.retryCount ?? null,
        message,
      };
    }
    // Structured diagnostics only — no question text, candidate info,
    // prompt, or model output (same pattern as the challenge-refine log).
    console.error(
      "[interview] question refinement failed, using deterministic questions:",
      JSON.stringify(failure),
    );
    return {
      questions,
      roleId: role.roleId,
      frameworkVersion,
      generationProvider: "deterministic",
      generationMethod: "deterministic",
      generationModel: null,
      generationFailure: failure,
    };
  }
}

export type GenerateInterviewResult = {
  interview: InterviewRow;
  questions: InterviewQuestionRow[];
  roleId: string;
  frameworkVersion: string;
  /** "live" only when the live refine actually validated; otherwise
   *  "deterministic" — the deterministic bank, never the mock provider. */
  generationProvider: "live" | "deterministic";
  generationMethod: "llm" | "deterministic";
  /** Model that refined the questions, or null when deterministic. */
  generationModel: string | null;
  /** Why refinement did not produce the persisted set, if it did not. */
  generationFailure: GenerationFailure | null;
};

/**
 * Public shape of a generate response (Phase G fix). The service result
 * carries the full question specs (expected_points, scoring_rubric,
 * context) because the server needs them — but those are the answer key:
 * they must NEVER leave the server. The generate endpoint used to return
 * `result` verbatim, so any candidate could fetch all 7 questions AND
 * their expected points/rubrics before the session started, defeating the
 * one-question-at-a-time design ("you never see future questions").
 * The public shape returns only the count; questions are served one at a
 * time, stripped, via GET /session (toPublicQuestion).
 */
export function toPublicGenerateResult(result: GenerateInterviewResult): {
  interview: InterviewRow;
  questionCount: number;
  roleId: string;
  frameworkVersion: string;
  generationProvider: "live" | "deterministic";
  generationMethod: "llm" | "deterministic";
  generationModel: string | null;
  generationFailure: GenerationFailure | null;
} {
  return {
    interview: result.interview,
    questionCount: result.questions.length,
    roleId: result.roleId,
    frameworkVersion: result.frameworkVersion,
    generationProvider: result.generationProvider,
    generationMethod: result.generationMethod,
    generationModel: result.generationModel,
    generationFailure: result.generationFailure,
  };
}

export async function generateInterview(opts: {
  assessmentId: string;
  candidateId: string;
  roleId?: string;
}): Promise<GenerateInterviewResult> {
  const assessment = await loadAssessmentById(opts.assessmentId);
  if (assessment.candidate_id !== opts.candidateId) {
    throw new ApiError(403, "This assessment belongs to another candidate");
  }
  if (assessment.status !== "completed") {
    throw new ApiError(409, "The interview is generated after the assessment is evaluated");
  }
  const existing = await pool.query(
    `SELECT * FROM interviews WHERE assessment_id = $1 AND interview_type = 'assessment' ORDER BY created_at DESC LIMIT 1`,
    [opts.assessmentId],
  );
  if (existing.rows.length) {
    const questions = await pool.query(
      `SELECT * FROM interview_questions WHERE interview_id = $1 ORDER BY question_order ASC`,
      [existing.rows[0].id],
    );
    const rows = questions.rows as InterviewQuestionRow[];
    const storedProvider = rows[0]?.context?.generationProvider as string | undefined;
    return {
      interview: existing.rows[0] as InterviewRow,
      questions: rows,
      roleId: (rows[0]?.context?.roleId as string | undefined) ?? "unknown",
      frameworkVersion: rows[0]?.framework_version ?? "unknown",
      // Pre-existing questions were generated by an earlier call; their
      // provider is whatever that call recorded in the question context.
      // Legacy rows labelled "mock" were deterministic questions — map
      // them to the truthful label.
      generationProvider:
        storedProvider === "live" ? "live" : "deterministic",
      generationMethod: (rows[0]?.context?.generationMethod as "llm" | "deterministic" | undefined) ?? "deterministic",
      generationModel: (rows[0]?.context?.generationModel as string | undefined) ?? null,
      generationFailure: (rows[0]?.context?.generationFailure as GenerationFailure | undefined) ?? null,
    };
  }
  // Phase C pre-generation (see services/interviewSession.ts): exactly 7
  // questions, one per role competency plus two targeted at the weakest
  // areas, each persisted with its full spec before any session starts.
  const { questions, roleId, frameworkVersion, generationProvider, generationMethod, generationModel, generationFailure } =
    await pregenerateInterviewQuestions({
      assessmentId: opts.assessmentId,
      candidateId: opts.candidateId,
      roleId: opts.roleId,
    });
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const interview = await client.query(
      `INSERT INTO interviews (candidate_id, assessment_id, interview_type, status)
       VALUES ($1, $2, 'assessment', 'scheduled') RETURNING *`,
      [opts.candidateId, opts.assessmentId],
    );
    const interviewId = interview.rows[0].id as string;
    const inserted: InterviewQuestionRow[] = [];
    for (let i = 0; i < questions.length; i++) {
      const q = questions[i];
      const row = await client.query(
        `INSERT INTO interview_questions
           (interview_id, category, question, question_order,
            competency_id, difficulty, expected_points, scoring_rubric,
            max_time_seconds, context, framework_version, source, is_follow_up)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, 'pre_generated', false)
         RETURNING *`,
        [
          interviewId,
          q.category,
          q.question,
          i,
          q.competencyId,
          q.difficulty,
          JSON.stringify(q.expectedPoints),
          JSON.stringify(q.scoringRubric),
          q.maxTimeSeconds,
          JSON.stringify({
            ...q.context,
            roleId,
            generationProvider,
            generationMethod,
            generationModel,
            generationFailure,
            frameworkVersion,
          }),
          frameworkVersion,
        ],
      );
      inserted.push(row.rows[0] as InterviewQuestionRow);
    }
    await client.query("COMMIT");
    return {
      interview: interview.rows[0] as InterviewRow,
      questions: inserted,
      roleId,
      frameworkVersion,
      generationProvider,
      generationMethod,
      generationModel,
      generationFailure,
    };
  } catch (err) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw err;
  } finally {
    client.release();
  }
}

export async function loadInterviewForCandidate(
  interviewId: string,
  candidateId: string,
): Promise<InterviewRow> {
  const res = await pool.query(
    `SELECT * FROM interviews WHERE id = $1 AND candidate_id = $2`,
    [interviewId, candidateId],
  );
  if (!res.rows.length) throw new ApiError(404, "Interview not found");
  return res.rows[0] as InterviewRow;
}

/**
 * Phase 2, G3.6 — the legacy single-answer endpoint (pre-session flow)
 * was REMOVED here, with its route in routes/assessments.ts: it was
 * the last live caller of a silent deterministic fallback (any LLM
 * failure stored a deterministic score as if scored, with no pending
 * state, no attempt row and no failure kind), so a deterministic score
 * could count toward interview coverage. No caller remains: the
 * client and the E2E script use POST /session/answer only, which
 * scores through scoreSessionAnswer() with attempt recording and
 * fail-loud behaviour (see services/interviewSession.ts). Answers are
 * submitted only through the session flow now; the insert-once
 * locking and the immutability trigger (migration 011) are unchanged
 * and covered by the session-flow tests.
 */


export interface InterviewReport {
  interviewId: string;
  assessmentId: string | null;
  finalScore: number | null;
  transcript: { category: string; question: string; answer: string | null; score: number | null; evaluation: Record<string, unknown> | null }[];
  perQuestion: { question: string; category: string; score: number | null; evaluation: Record<string, unknown> | null }[];
  strengths: string[];
  knowledgeGaps: string[];
  learningAreas: string[];
  evidence: Record<string, unknown>;
}

/**
 * READ-ONLY report read (Phase C fix for C14). Viewing a report must
 * never finalise the interview: this returns the stored report, or null
 * when the interview has not been finished yet. The report is written
 * exactly once by the explicit finish transition in
 * services/interviewSession.ts (finishSession), which also persists the
 * immutable interview_reports row.
 */
export async function getInterviewReport(
  interviewId: string,
  candidateId: string,
): Promise<InterviewReport | null> {
  const interview = await loadInterviewForCandidate(interviewId, candidateId);
  if (interview.report) return interview.report as unknown as InterviewReport;
  return null;
}

export async function listInterviewQuestions(
  interviewId: string,
  candidateId: string,
): Promise<(InterviewQuestionRow & { answer: string | null; score: number | null })[]> {
  await loadInterviewForCandidate(interviewId, candidateId);
  const res = await pool.query(
    `SELECT iq.*, ia.answer, ia.score FROM interview_questions iq
      LEFT JOIN interview_answers ia ON ia.question_id = iq.id
      WHERE iq.interview_id = $1 ORDER BY iq.question_order ASC`,
    [interviewId],
  );
  return res.rows as (InterviewQuestionRow & { answer: string | null; score: number | null })[];
}

export { listEvents };
