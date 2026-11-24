// ── Deterministic competency scoring service ──────────────────────────────
// Pure arithmetic only. No LLM decides any category, score or status here.
// The framework (roles, weights, categories, thresholds, practical minimum)
// is LOADED from server/src/config/competencyFramework.ts — nothing about
// the framework is hardcoded in this file. Historical results carry
// `frameworkVersion` + a snapshot of the settings used, so a framework
// version change can never rewrite an old result.
//
// Overall score:  S = C*0.50 + I*0.30 + E*0.20
//   C = coding (practical task) component, I = interview component,
//   E = evidence (portfolio/project) component. Component weights come from
//   the framework config, not from literals here.
//
// Honesty rules (same discipline as services/strength.ts):
//   - Missing source  -> the competency is "Incomplete" (score computed over
//     the sources that ARE present, renormalised, and flagged) — never a
//     silent zero for the missing source.
//   - No evidence at all -> "Not Assessed" (score null), never 0.
//   - Fewer distinct evidence items than the competency requires ->
//     "Insufficient Evidence" (score null), never fabricated.
//   - The same evidence item id supplied to both the coding and the
//     evidence source is counted ONCE (deduplicated, reported).
//   - Same inputs + same framework version -> byte-identical outputs.
//     No Date.now(), no randomness, no LLM in this module.
//
// PROVISIONAL vs VERIFIED (classification rule
// `provisional-vs-verified-v3`, see CLASSIFICATION_RULE_VERSION):
//   - `provisionalScore` / `provisionalCategory` are ALWAYS computable
//     from the sources that are present (renormalised, labelled as
//     provisional). They are a working figure, never a verified result.
//   - `verifiedCategory` is null UNLESS every mandatory condition holds
//     (see evaluateVerifiedCategory): all sources complete, every
//     competency meets its minimum evidence, the practical coding
//     minimum is met, the interview is complete per
//     PARTIAL_INTERVIEW_POLICY, every competency's own interview
//     questions are all scored, and the coding evaluation's
//     qualitative review did not fail. A renormalised number must never
//     be presented as a verified L3/L4 category — the live E2E profile
//     once showed overall 64.29 + L3 (Job Ready) + "Insufficient
//     Evidence" + low confidence + a null interview component, all at
//     once. That combination is now impossible: a non-verified profile
//     carries a provisional score and NO verified category.
//   - `overallScore` / `overallCategory` are kept for compatibility:
//     overallScore IS the provisional score; overallCategory IS the
//     verified category (null unless verified).
//   - v2 (Phase 2, 24 Nov 2026) tightened v1 in four ways: the
//     per-competency verified category is gated on the interview being
//     complete AND on that competency's own questions all being scored;
//     a failed qualitative review blocks verification; the evidence
//     composition the framework describes (one coding item + one
//     non-coding item) is enforced when item types are known; and
//     confidence is low for any non-Complete profile below 100%
//     coverage. See docs/SCORING_METHODOLOGY.md §5.

import {
  COMPETENCY_FRAMEWORK_V1,
  FRAMEWORK_VERSION,
} from "../config/competencyFramework";
import type {
  CompetencyFramework,
  ProficiencyCategory,
  ProficiencyCategoryId,
  RoleCompetency,
  RoleFramework,
} from "../config/competencyFramework";

export type CompetencyStatus =
  | "Assessed"
  | "Incomplete"
  | "Insufficient Evidence"
  | "Not Assessed";

export type ProfileStatus =
  | "Complete"
  | "Incomplete"
  | "Insufficient Evidence"
  | "Practical Threshold Not Met";

export type ConfidenceLevel = "high" | "medium" | "low";

export type EvidenceSource = "coding" | "interview" | "evidence";

/**
 * Classification rule version: the provisional-vs-verified policy
 * implemented in this file. Stored with every computed profile
 * (CompetencyProfileResult.classificationRuleVersion, alongside the
 * framework snapshot), so a historical profile keeps the rule that
 * produced it and a rule change can never silently rewrite an old
 * result. Bump when the verified-category conditions change.
 *
 * v3 (Phase 2, G3.2): the required-question count is enforced as the
 * framework constant (7) when coverage is read from a stored report,
 * so a legacy short report (fewer than 7 rows, all scored) can no
 * longer read complete or support a verified category.
 */
export const CLASSIFICATION_RULE_VERSION = "provisional-vs-verified-v3";

// ── Partial-interview policy (SINGLE definition) ──────────────────────────
// Every surface that talks about interview completeness — the candidate
// report, the recruiter report, the stored profile, the applications
// list and the assessment history — uses THESE definitions, never its
// own copy. The policy is evaluated once, in computeCompetencyProfile,
// and the result (interviewCoverage + verifiedCategory) is stored with
// the profile; the UI only renders what the server computed.

/** Question-level coverage of one interview, as read from its stored
 *  immutable report (interview_reports): only the REQUIRED ORIGINAL
 *  (pre-generated) questions count. A follow-up re-tests the weak
 *  point of one original question, and its score SUPERSEDES the
 *  original's score for that question (Phase 2, G3.3 ruling) — but the
 *  follow-up never adds a question to the count, and the original
 *  answer and score stay stored and visible in the report next to the
 *  follow-up's. */
export interface InterviewCoverage {
  /** Original questions with a scored evaluation. */
  questionsScored: number;
  /** Original questions the interview required (7 in framework v1). */
  questionsRequired: number;
  /** Answers whose AI evaluation is still pending (no score was
   *  substituted for them — fail-loud, not fail-silent). */
  pendingEvaluations: number;
}

export interface InterviewCoverageAssessment {
  /** True only when every required original question has a scored
   *  evaluation and none is pending. */
  complete: boolean;
  questionsScored: number;
  questionsRequired: number;
  pendingEvaluations: number;
  /**
   * Coverage note for display, e.g. "provisional — 6 of 7 questions
   * scored". Null when the interview is complete; a provisional
   * interview score must never be shown without this note.
   */
  provisionalNote: string | null;
}

export const PARTIAL_INTERVIEW_POLICY = {
  /** A FINAL interview score exists only when every required original
   *  question has a scored evaluation (no pending, none unanswered).
   *  A mean over the questions scored so far is provisional only. */
  finalRequiresAllQuestionsEvaluated: true,
  /** Per-question scores are displayable as soon as that question is
   *  scored — a scored question is a fact, not a projection. */
  perQuestionScoresDisplayable: true,
  /** A provisional interview score is shown only with its coverage
   *  stated (see assessInterviewCoverage().provisionalNote). */
  provisionalRequiresCoverageNote: true,
} as const;

/**
 * The single evaluator of the partial-interview policy. `coverage`
 * comes from the interview's stored report; null/undefined means the
 * caller could not establish coverage — which is NOT completeness:
 * an unverified interview can never support a verified category.
 */
export function assessInterviewCoverage(
  coverage: InterviewCoverage | null | undefined,
): InterviewCoverageAssessment {
  if (!coverage) {
    return {
      complete: false,
      questionsScored: 0,
      questionsRequired: 0,
      pendingEvaluations: 0,
      provisionalNote:
        "interview completeness unverified — no question coverage supplied",
    };
  }
  const complete =
    coverage.questionsRequired > 0 &&
    coverage.questionsScored >= coverage.questionsRequired &&
    coverage.pendingEvaluations === 0;
  return {
    complete,
    questionsScored: coverage.questionsScored,
    questionsRequired: coverage.questionsRequired,
    pendingEvaluations: coverage.pendingEvaluations,
    provisionalNote: complete
      ? null
      : `provisional — ${coverage.questionsScored} of ${coverage.questionsRequired} questions scored`,
  };
}

// ── Verified-category conditions (single gate) ───────────────────────────

/** The mandatory conditions for a VERIFIED category. ALL must hold;
 *  any one failing means verifiedCategory is null and the profile
 *  status names the gap (see ProfileStatus). */
export interface VerifiedCategoryConditions {
  /** Every competency fully assessed: all three sources present and
   *  every competency at/above its minimum evidence. */
  sourcesComplete: boolean;
  /** Coding component at or above the practical minimum. */
  practicalMinimumMet: boolean;
  /** Interview complete per PARTIAL_INTERVIEW_POLICY. */
  interviewComplete: boolean;
  /** A provisional score exists to classify (never a zero in disguise). */
  hasScore: boolean;
  /** The coding evaluation's qualitative review did not fail (v2):
   *  a review that failed leaves the overall renormalised over the
   *  verified dimensions only, so it cannot support a verified
   *  category — a human must review the evaluation first. */
  qualitativeReviewPassed: boolean;
}

/**
 * The single gate for a verified category. Returns the category only
 * when EVERY mandatory condition holds; otherwise null. There is no
 * partial credit here — a high provisional number with a missing
 * source, thin evidence, a failed practical minimum or a partial
 * interview is still null.
 */
export function evaluateVerifiedCategory(
  conditions: VerifiedCategoryConditions,
  provisionalCategory: ProficiencyCategoryId | null,
): ProficiencyCategoryId | null {
  if (!conditions.hasScore) return null;
  if (!conditions.sourcesComplete) return null;
  if (!conditions.practicalMinimumMet) return null;
  if (!conditions.interviewComplete) return null;
  if (!conditions.qualitativeReviewPassed) return null;
  return provisionalCategory;
}

/**
 * Display label for a stored profile status. The stored enum is fixed
 * by the DB check constraint (migration 010) to Complete / Incomplete
 * / Insufficient Evidence / Practical Threshold Not Met, so the UI
 * wording lives here, in one place: stored "Incomplete" displays as
 * "Assessment Incomplete", and a profile with no source at all
 * displays as "Not Assessed" (score null, never 0).
 */
export type ProfileStatusLabel =
  | "Complete"
  | "Assessment Incomplete"
  | "Insufficient Evidence"
  | "Practical Threshold Not Met"
  | "Not Assessed";

export function profileStatusLabel(
  status: ProfileStatus,
  /** True when at least one competency has any source at all. */
  hasAnyEvidence: boolean,
): ProfileStatusLabel {
  if (status === "Incomplete") {
    return hasAnyEvidence ? "Assessment Incomplete" : "Not Assessed";
  }
  return status;
}

export interface CompetencyEvidenceInput {
  competencyId: string;
  /** 0–100 from the practical/coding task. Null/undefined = source missing. */
  codingScore?: number | null;
  /** 0–100 from the interview. Null/undefined = source missing. */
  interviewScore?: number | null;
  /** 0–100 from portfolio/project evidence. Null/undefined = missing. */
  evidenceScore?: number | null;
  /** Evidence-item ids backing the coding score. */
  codingEvidenceIds?: string[];
  /** Evidence-item ids backing the evidence score. */
  evidenceIds?: string[];
  /**
   * Total distinct evidence items supplied for this competency. When ids
   * are also supplied, the unique-id count wins (ids are authoritative).
   */
  evidenceCount?: number;
  /**
   * Per-competency interview coverage (v2, G4.4): how many of the
   * interview questions targeting THIS competency have a scored
   * evaluation. From the stored interview report's per-question rows.
   * When both are supplied, the interview score counts toward
   * "Assessed" only when every one of the competency's questions is
   * scored — a mean over 1 of 2 questions is provisional, not an
   * assessed interview leg. When absent, coverage is unknown and only
   * the profile-level interview gate applies.
   */
  interviewQuestionsScored?: number | null;
  interviewQuestionsRequired?: number | null;
}

export interface CompetencyProfileInput {
  roleId: string;
  /** Defaults to the current framework version. */
  frameworkVersion?: string;
  /** One entry per competency being assessed. Competencies absent from
   *  this list are reported "Not Assessed". Unknown ids throw. */
  competencies: CompetencyEvidenceInput[];
  /** Overrides the framework's practical minimum for this computation. */
  practicalMinimumCodingScore?: number;
  /**
   * Question-level interview coverage, from the interview's stored
   * report (see PARTIAL_INTERVIEW_POLICY). Required for a verified
   * category whenever an interview component is present: without it
   * the interview is unverified and the category stays null. Omit
   * only when no interview exists at all.
   */
  interviewCoverage?: InterviewCoverage | null;
  /**
   * Evaluation basis of the coding evaluation (v2, G2.4): the
   * qualitative review method recorded by the evaluation service
   * ("live-ai" | "deterministic-heuristic" | "failed" | null when
   * there is no evaluation). "failed" blocks verification — the
   * overall is then renormalised over the verified dimensions only
   * and a human must review the evaluation first. Any other value
   * (including null) does not block.
   */
  qualitativeMethod?: string | null;
}

export interface CompetencyScoreResult {
  competencyId: string;
  competencyName: string;
  weight: number;
  codingScore: number | null;
  interviewScore: number | null;
  evidenceScore: number | null;
  /** Weighted score, or null when Not Assessed / Insufficient Evidence. */
  score: number | null;
  /**
   * PROVISIONAL category of `score` (renormalised over present sources).
   * Displayable only as provisional — never as a verified result.
   */
  category: ProficiencyCategoryId | null;
  categoryLabel: string | null;
  /**
   * VERIFIED category: non-null only when this competency is fully
   * Assessed AND the practical minimum is met AND the interview is
   * complete per PARTIAL_INTERVIEW_POLICY (v2: profile-level
   * completeness AND every one of this competency's own interview
   * questions scored) AND the coding evaluation's qualitative review
   * did not fail. Null for Incomplete / Insufficient Evidence /
   * Not Assessed, however high the provisional score is.
   */
  verifiedCategory: ProficiencyCategoryId | null;
  verifiedCategoryLabel: string | null;
  status: CompetencyStatus;
  /** Distinct evidence items counted (after de-duplication). */
  evidenceProvided: number;
  evidenceRequired: number;
  evidenceCoveragePercent: number;
  /** Per-competency interview coverage (v2, G4.4): questions targeting
   *  this competency with a scored evaluation / required. Null when
   *  the interview score is absent or no coverage was supplied. */
  interviewQuestionsScored: number | null;
  interviewQuestionsRequired: number | null;
  /** Ids that appeared in BOTH coding and evidence lists (counted once). */
  dedupedEvidenceIds: string[];
  sourcesPresent: EvidenceSource[];
  sourcesMissing: EvidenceSource[];
  practicalMinimumMet: boolean;
  notes: string[];
}

export interface ComponentScores {
  coding: number | null;
  interview: number | null;
  evidence: number | null;
}

export interface FrameworkSnapshot {
  version: string;
  categories: ProficiencyCategory[];
  componentWeights: { coding: number; interview: number; evidence: number };
  practicalMinimumCodingScore: number;
}

export interface CompetencyProfileResult {
  roleId: string;
  roleName: string;
  frameworkVersion: string;
  /**
   * PROVISIONAL overall score: the renormalised blend over the sources
   * that ARE present (S = C*0.50 + I*0.30 + E*0.20, weights
   * renormalised when a component is absent). Null only when no
   * competency produced a score. A number here is a working figure —
   * it never, by itself, implies a verified category.
   */
  overallScore: number | null;
  /** Explicit alias of overallScore: the provisional number, named so. */
  provisionalScore: number | null;
  /** PROVISIONAL category of the provisional score (capped at L2 when
   *  the practical minimum fails). Displayable only as provisional. */
  provisionalCategory: ProficiencyCategoryId | null;
  provisionalCategoryLabel: string | null;
  /**
   * VERIFIED overall category — the ONLY category that may be presented
   * as a verified result. Non-null only when ALL mandatory conditions
   * hold (see evaluateVerifiedCategory); null for Insufficient
   * Evidence / Incomplete / Practical Threshold Not Met / Not Assessed,
   * however high the provisional score is.
   */
  overallCategory: ProficiencyCategoryId | null;
  overallCategoryLabel: string | null;
  /** Canonical verified category (identical to overallCategory). */
  verifiedCategory: ProficiencyCategoryId | null;
  verifiedCategoryLabel: string | null;
  status: ProfileStatus;
  /** Display label for `status` (see profileStatusLabel): stored
   *  "Incomplete" renders as "Assessment Incomplete"; a profile with
   *  no source at all renders as "Not Assessed". */
  statusLabel: ProfileStatusLabel;
  /** Classification rule that produced this result (see
   *  CLASSIFICATION_RULE_VERSION). Stored with the profile so history
   *  keeps the rule that produced it. */
  classificationRuleVersion: string;
  /** Interview completeness per PARTIAL_INTERVIEW_POLICY, as evaluated
   *  for this computation. Null when no interview component exists. */
  interviewCoverage: InterviewCoverageAssessment | null;
  componentScores: ComponentScores;
  competencies: CompetencyScoreResult[];
  /** % of the role's competencies with a computed score. */
  evidenceCoveragePercent: number;
  confidence: ConfidenceLevel;
  /**
   * Competencies whose coding score is below the practical minimum
   * (v2, G4.2) — INCLUDING score-null competencies (Insufficient
   * Evidence / Not Assessed), whose coding score is invisible in the
   * component average: component scores average only over
   * competencies with a computed score, so a below-minimum coding
   * score on a score-null competency vanishes from the average with
   * no trace unless listed here. Empty when no coding score is below
   * the minimum.
   */
  practicalMinimumFailures: {
    competencyId: string;
    competencyName: string;
    codingScore: number;
  }[];
  /**
   * Evaluation basis of the coding evaluation (v2, G2.4): the
   * qualitative review method ("live-ai" |
   * "deterministic-heuristic" | "failed" | null when there is no
   * evaluation). Recorded so a failed qualitative leg is visible on
   * the profile, not just in the evaluation row.
   */
  qualitativeMethod: string | null;
  frameworkSnapshot: FrameworkSnapshot;
  notes: string[];
}

// ── Framework registry ────────────────────────────────────────────────────
// The current version is registered at load; validateFramework() runs on
// every registration, so a bad framework fails loudly at startup/test time
// instead of silently producing wrong scores.

const frameworks = new Map<string, CompetencyFramework>();

export function validateFramework(fw: CompetencyFramework): void {
  if (!fw || typeof fw.version !== "string" || fw.version.trim() === "") {
    throw new Error("competency framework: version must be a non-empty string");
  }
  if (!Array.isArray(fw.categories) || fw.categories.length === 0) {
    throw new Error(
      `competency framework ${fw.version}: at least one proficiency category is required`,
    );
  }
  // Categories must tile 0–100 contiguously with no gaps or overlaps.
  const sorted = [...fw.categories].sort((a, b) => a.min - b.min);
  if (sorted[0].min !== 0 || sorted[sorted.length - 1].max !== 100) {
    throw new Error(
      `competency framework ${fw.version}: categories must cover 0–100 exactly`,
    );
  }
  for (let i = 0; i < sorted.length; i++) {
    const c = sorted[i];
    if (c.min > c.max) {
      throw new Error(
        `competency framework ${fw.version}: category ${c.id} has min > max`,
      );
    }
    if (!c.description || c.description.trim() === "") {
      throw new Error(
        `competency framework ${fw.version}: category ${c.id} needs a description`,
      );
    }
    if (i > 0 && c.min !== sorted[i - 1].max + 1) {
      throw new Error(
        `competency framework ${fw.version}: categories ${sorted[i - 1].id} and ${c.id} do not tile contiguously (gap/overlap at ${sorted[i - 1].max}/${c.min})`,
      );
    }
  }
  const w = fw.componentWeights;
  if (!w) {
    throw new Error(`competency framework ${fw.version}: componentWeights missing`);
  }
  const wSum = w.coding + w.interview + w.evidence;
  if (Math.abs(wSum - 1) > 0.001 || w.coding < 0 || w.interview < 0 || w.evidence < 0) {
    throw new Error(
      `competency framework ${fw.version}: component weights must be non-negative and sum to 1 (got ${wSum})`,
    );
  }
  if (
    typeof fw.practicalMinimumCodingScore !== "number" ||
    fw.practicalMinimumCodingScore < 0 ||
    fw.practicalMinimumCodingScore > 100
  ) {
    throw new Error(
      `competency framework ${fw.version}: practicalMinimumCodingScore must be 0–100`,
    );
  }
  if (!Array.isArray(fw.roles) || fw.roles.length === 0) {
    throw new Error(`competency framework ${fw.version}: at least one role is required`);
  }
  const roleIds = new Set<string>();
  for (const role of fw.roles) {
    if (roleIds.has(role.roleId)) {
      throw new Error(
        `competency framework ${fw.version}: duplicate role id "${role.roleId}"`,
      );
    }
    roleIds.add(role.roleId);
    if (!Array.isArray(role.competencies) || role.competencies.length === 0) {
      throw new Error(
        `competency framework ${fw.version}: role "${role.roleId}" has no competencies`,
      );
    }
    // Role weights must sum to exactly 100% — fail loudly otherwise.
    const weightSum = role.competencies.reduce((s, c) => s + c.weight, 0);
    if (Math.abs(weightSum - 100) > 0.001) {
      throw new Error(
        `competency framework ${fw.version}: role "${role.roleId}" weights sum to ${weightSum}, not 100`,
      );
    }
    const compIds = new Set<string>();
    for (const comp of role.competencies) {
      if (compIds.has(comp.id)) {
        throw new Error(
          `competency framework ${fw.version}: role "${role.roleId}" has duplicate competency id "${comp.id}"`,
        );
      }
      compIds.add(comp.id);
      if (!(comp.weight > 0)) {
        throw new Error(
          `competency framework ${fw.version}: competency "${comp.id}" weight must be > 0`,
        );
      }
      if (!comp.skills || comp.skills.length === 0) {
        throw new Error(
          `competency framework ${fw.version}: competency "${comp.id}" needs at least one skill`,
        );
      }
      if (!comp.evidenceTypes || comp.evidenceTypes.length === 0) {
        throw new Error(
          `competency framework ${fw.version}: competency "${comp.id}" needs at least one evidence type`,
        );
      }
      if (!comp.codingTaskMapping || !comp.interviewQuestionMapping) {
        throw new Error(
          `competency framework ${fw.version}: competency "${comp.id}" needs coding-task and interview-question mappings`,
        );
      }
      for (const cat of fw.categories) {
        if (!comp.rubric || !comp.rubric[cat.id] || comp.rubric[cat.id].trim() === "") {
          throw new Error(
            `competency framework ${fw.version}: competency "${comp.id}" rubric is missing category ${cat.id}`,
          );
        }
      }
      if (!Number.isInteger(comp.minEvidence) || comp.minEvidence < 1) {
        throw new Error(
          `competency framework ${fw.version}: competency "${comp.id}" minEvidence must be an integer >= 1`,
        );
      }
    }
  }
}

export function registerFramework(fw: CompetencyFramework): void {
  validateFramework(fw);
  frameworks.set(fw.version, fw);
}

/** Load a framework by version. Throws (fail loudly) on unknown versions. */
export function getFramework(version: string = FRAMEWORK_VERSION): CompetencyFramework {
  const fw = frameworks.get(version);
  if (!fw) {
    throw new Error(
      `competency framework: unknown version "${version}" (known: ${[...frameworks.keys()].join(", ") || "none"})`,
    );
  }
  return fw;
}

export function listFrameworkVersions(): string[] {
  return [...frameworks.keys()].sort();
}

registerFramework(COMPETENCY_FRAMEWORK_V1);

// ── Pure helpers ──────────────────────────────────────────────────────────

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function assertScoreRange(value: number, label: string): void {
  if (!Number.isFinite(value) || value < 0 || value > 100) {
    throw new RangeError(`competency scoring: ${label} must be a number 0–100 (got ${value})`);
  }
}

/** Category for a 0–100 score, using the framework's configured categories.
 *  Categories are stored with integer bounds (0–39, 40–59, …) but blended
 *  scores are fractional — 59.97 must land in L2, not in a gap. Ranges
 *  are therefore read half-open: [min, next.min), with the last category
 *  closed at 100. Integer scores map exactly as before (39→L1, 40→L2,
 *  59→L2, 60→L3, 79→L3, 80→L4, 100→L4). */
export function categoryForScore(
  score: number,
  framework: CompetencyFramework = getFramework(),
): ProficiencyCategory {
  assertScoreRange(score, "score");
  const sorted = [...framework.categories].sort((a, b) => a.min - b.min);
  const cat = sorted.find(
    (c, i) =>
      score >= c.min &&
      (i === sorted.length - 1 ? score <= c.max : score < sorted[i + 1].min),
  );
  if (!cat) {
    throw new Error(
      `competency framework ${framework.version}: no category covers score ${score}`,
    );
  }
  return cat;
}

function getRole(fw: CompetencyFramework, roleId: string): RoleFramework {
  const role = fw.roles.find((r) => r.roleId === roleId);
  if (!role) {
    throw new Error(
      `competency framework ${fw.version}: unknown role "${roleId}" (known: ${fw.roles.map((r) => r.roleId).join(", ")})`,
    );
  }
  return role;
}

/**
 * Weighted blend of the sources that are present. Weights are renormalised
 * over present sources only, so a missing source is never a silent zero —
 * the caller records which sources were missing and marks the result
 * "Incomplete". Returns null when no source is present.
 */
function blendSources(
  present: { source: EvidenceSource; score: number; weight: number }[],
): number | null {
  if (present.length === 0) return null;
  const totalWeight = present.reduce((s, p) => s + p.weight, 0);
  return round2(
    present.reduce((s, p) => s + p.score * (p.weight / totalWeight), 0),
  );
}

// ── Per-competency scoring ────────────────────────────────────────────────

function scoreCompetency(
  def: RoleCompetency,
  input: CompetencyEvidenceInput | undefined,
  fw: CompetencyFramework,
  practicalMinimum: number,
  opts: {
    /** Profile-level interview completeness (PARTIAL_INTERVIEW_POLICY).
     *  A 6/7 interview nulls every per-competency verified category
     *  (v2, G2.1), however high the competency scores. */
    interviewComplete?: boolean;
    /** True when the coding evaluation's qualitative review failed
     *  (v2, G2.4): no per-competency verified category either. */
    qualitativeFailed?: boolean;
  } = {},
): CompetencyScoreResult {
  const base: Omit<
    CompetencyScoreResult,
    "score" | "category" | "categoryLabel" | "status" | "notes"
  > = {
    competencyId: def.id,
    competencyName: def.name,
    weight: def.weight,
    codingScore: null,
    interviewScore: null,
    evidenceScore: null,
    evidenceProvided: 0,
    evidenceRequired: def.minEvidence,
    evidenceCoveragePercent: 0,
    interviewQuestionsScored: null,
    interviewQuestionsRequired: null,
    dedupedEvidenceIds: [],
    sourcesPresent: [],
    sourcesMissing: ["coding", "interview", "evidence"],
    practicalMinimumMet: true,
    // Verified category defaults to null; only the fully-Assessed
    // return below may set it (status Assessed + minimum met +
    // interview complete + qualitative review passed).
    verifiedCategory: null,
    verifiedCategoryLabel: null,
  };

  if (!input) {
    return {
      ...base,
      score: null,
      category: null,
      categoryLabel: null,
      status: "Not Assessed",
      notes: [`No evidence submitted for "${def.name}".`],
    };
  }

  const coding = input.codingScore ?? null;
  const interview = input.interviewScore ?? null;
  const evidence = input.evidenceScore ?? null;
  if (coding !== null) assertScoreRange(coding, `codingScore for ${def.id}`);
  if (interview !== null) assertScoreRange(interview, `interviewScore for ${def.id}`);
  if (evidence !== null) assertScoreRange(evidence, `evidenceScore for ${def.id}`);

  // Evidence de-duplication: an id in BOTH the coding and evidence lists
  // is one piece of evidence, counted once. Ids are authoritative when
  // supplied; otherwise the caller-supplied count is used as-is.
  const codingIds = [...new Set(input.codingEvidenceIds ?? [])];
  const evidenceIds = [...new Set(input.evidenceIds ?? [])];
  const deduped = codingIds.filter((id) => evidenceIds.includes(id)).sort();
  const hasIds = codingIds.length > 0 || evidenceIds.length > 0;
  const evidenceProvided = hasIds
    ? new Set([...codingIds, ...evidenceIds]).size
    : (input.evidenceCount ?? 0);
  if (!Number.isInteger(evidenceProvided) || evidenceProvided < 0) {
    throw new RangeError(
      `competency scoring: evidenceCount for ${def.id} must be a non-negative integer`,
    );
  }

  const sourcesPresent: EvidenceSource[] = [];
  if (coding !== null) sourcesPresent.push("coding");
  if (interview !== null) sourcesPresent.push("interview");
  if (evidence !== null) sourcesPresent.push("evidence");
  const sourcesMissing: EvidenceSource[] = (["coding", "interview", "evidence"] as EvidenceSource[]).filter(
    (s) => !sourcesPresent.includes(s),
  );

  const coverage = Math.min(100, round2((evidenceProvided / def.minEvidence) * 100));
  const notes: string[] = [];
  if (deduped.length > 0) {
    notes.push(
      `${deduped.length} evidence item(s) appeared in both coding and evidence sources and were counted once: ${deduped.join(", ")}.`,
    );
  }

  const practicalMinimumMet = coding === null || coding >= practicalMinimum;
  if (coding !== null && coding < practicalMinimum) {
    notes.push(
      `Coding score ${coding} is below the practical minimum ${practicalMinimum}.`,
    );
  }

  // Per-competency interview coverage (v2, G4.4): the interview score
  // for THIS competency is a mean over its scored questions only, so
  // it counts toward "Assessed" only when every question targeting
  // this competency was scored. Coverage unknown (fields absent)
  // leaves the status decision to the profile-level interview gate;
  // coverage known-incomplete makes the competency Incomplete.
  const interviewQuestionsRequired =
    input.interviewQuestionsRequired ?? null;
  const interviewQuestionsScored = input.interviewQuestionsScored ?? null;
  const interviewCoverageKnown =
    interview !== null &&
    interviewQuestionsRequired !== null &&
    interviewQuestionsScored !== null;
  const interviewCoverageComplete: boolean | null = !interviewCoverageKnown
    ? null
    : interviewQuestionsRequired > 0 &&
      interviewQuestionsScored >= interviewQuestionsRequired;
  if (interviewCoverageComplete === false) {
    notes.push(
      `Interview evidence for "${def.name}" is partial: ${interviewQuestionsScored} of ${interviewQuestionsRequired} interview question(s) scored; the interview score is provisional and does not make this competency Assessed.`,
    );
  }

  // No source at all -> Not Assessed. Never a zero.
  if (sourcesPresent.length === 0) {
    return {
      ...base,
      codingScore: coding,
      interviewScore: interview,
      evidenceScore: evidence,
      evidenceProvided,
      evidenceCoveragePercent: coverage,
      interviewQuestionsScored,
      interviewQuestionsRequired,
      dedupedEvidenceIds: deduped,
      sourcesPresent,
      sourcesMissing,
      practicalMinimumMet,
      score: null,
      category: null,
      categoryLabel: null,
      status: "Not Assessed",
      notes: [...notes, `No scored source submitted for "${def.name}".`],
    };
  }

  // Fewer distinct evidence items than required -> Insufficient Evidence.
  // The score is NOT computed from thin evidence.
  if (evidenceProvided < def.minEvidence) {
    return {
      ...base,
      codingScore: coding,
      interviewScore: interview,
      evidenceScore: evidence,
      evidenceProvided,
      evidenceCoveragePercent: coverage,
      interviewQuestionsScored,
      interviewQuestionsRequired,
      dedupedEvidenceIds: deduped,
      sourcesPresent,
      sourcesMissing,
      practicalMinimumMet,
      score: null,
      category: null,
      categoryLabel: null,
      status: "Insufficient Evidence",
      notes: [
        ...notes,
        `"${def.name}" needs at least ${def.minEvidence} distinct evidence items; only ${evidenceProvided} supplied.`,
      ],
    };
  }

  // Evidence composition (v2, G4.1): the framework describes the
  // minimum as "one coding task and one project or interview answer"
  // — a bare count is not the rule. When the item types are known
  // (evidence ids supplied), enforce it: at least one coding-sourced
  // item AND at least one non-coding item. A competency evidenced by
  // coding items alone (or non-coding items alone) is Insufficient
  // Evidence, score null, however many items it has. When no ids are
  // supplied at all the composition cannot be checked and the
  // count-only rule applies (documented in
  // docs/SCORING_METHODOLOGY.md §5).
  if (hasIds) {
    const hasCodingItem = codingIds.length > 0;
    const hasNonCodingItem = evidenceIds.some((id) => !codingIds.includes(id));
    if (!hasCodingItem || !hasNonCodingItem) {
      return {
        ...base,
        codingScore: coding,
        interviewScore: interview,
        evidenceScore: evidence,
        evidenceProvided,
        evidenceCoveragePercent: coverage,
        interviewQuestionsScored,
        interviewQuestionsRequired,
        dedupedEvidenceIds: deduped,
        sourcesPresent,
        sourcesMissing,
        practicalMinimumMet,
        score: null,
        category: null,
        categoryLabel: null,
        status: "Insufficient Evidence",
        notes: [
          ...notes,
          `"${def.name}" needs at least ${def.minEvidence} distinct evidence items of more than one kind: one coding-task item and one project / interview / verification item; only ${hasCodingItem ? "coding-task" : "non-coding"} item(s) supplied.`,
        ],
      };
    }
  }

  const w = fw.componentWeights;
  const score = blendSources([
    ...(coding !== null ? [{ source: "coding" as const, score: coding, weight: w.coding }] : []),
    ...(interview !== null
      ? [{ source: "interview" as const, score: interview, weight: w.interview }]
      : []),
    ...(evidence !== null ? [{ source: "evidence" as const, score: evidence, weight: w.evidence }] : []),
  ]);
  // blendSources returns non-null here (sourcesPresent is non-empty).
  // `category` is the PROVISIONAL category of this renormalised score.
  // The verified category exists only for a fully-Assessed competency
  // whose practical minimum is met, whose interview is complete
  // (profile-level AND this competency's own questions all scored),
  // and whose coding evaluation's qualitative review did not fail —
  // anything else is provisional.
  const category = categoryForScore(score as number, fw);
  // "Assessed" needs all three sources present AND — when the
  // per-competency interview coverage is known — every question
  // targeting this competency scored (v2, G4.4). A 1-of-2-questions
  // interview mean is a provisional score, not an assessed leg.
  const interviewFullyScored = interviewCoverageComplete !== false;
  const status: CompetencyStatus =
    sourcesMissing.length === 0 && interviewFullyScored ? "Assessed" : "Incomplete";
  const verifiedCategory =
    status === "Assessed" &&
    practicalMinimumMet &&
    opts.interviewComplete === true &&
    opts.qualitativeFailed !== true
      ? category
      : null;
  if (status === "Incomplete" && sourcesMissing.length > 0) {
    notes.push(
      `Partial evidence: missing ${sourcesMissing.join(", ")} source(s); score is computed over the present source(s) only.`,
    );
  }
  return {
    ...base,
    codingScore: coding,
    interviewScore: interview,
    evidenceScore: evidence,
    evidenceProvided,
    evidenceCoveragePercent: coverage,
    interviewQuestionsScored,
    interviewQuestionsRequired,
    dedupedEvidenceIds: deduped,
    sourcesPresent,
    sourcesMissing,
    practicalMinimumMet,
    score,
    category: category.id,
    categoryLabel: category.label,
    verifiedCategory: verifiedCategory ? verifiedCategory.id : null,
    verifiedCategoryLabel: verifiedCategory ? verifiedCategory.label : null,
    status,
    notes,
  };
}

// ── Whole-profile scoring ─────────────────────────────────────────────────

export function computeCompetencyProfile(
  input: CompetencyProfileInput,
): CompetencyProfileResult {
  const fw = getFramework(input.frameworkVersion ?? FRAMEWORK_VERSION);
  const role = getRole(fw, input.roleId);
  const practicalMinimum =
    input.practicalMinimumCodingScore ?? fw.practicalMinimumCodingScore;
  if (
    typeof practicalMinimum !== "number" ||
    practicalMinimum < 0 ||
    practicalMinimum > 100
  ) {
    throw new RangeError(
      `competency scoring: practicalMinimumCodingScore must be 0–100 (got ${practicalMinimum})`,
    );
  }

  // Unknown competency ids are a caller bug — fail loudly, never ignore.
  const knownIds = new Set(role.competencies.map((c) => c.id));
  for (const entry of input.competencies) {
    if (!knownIds.has(entry.competencyId)) {
      throw new Error(
        `competency scoring: unknown competency "${entry.competencyId}" for role "${input.roleId}"`,
      );
    }
  }
  // Duplicate entries for one competency would double-count it — refuse.
  const seen = new Set<string>();
  for (const entry of input.competencies) {
    if (seen.has(entry.competencyId)) {
      throw new Error(
        `competency scoring: duplicate entry for competency "${entry.competencyId}"`,
      );
    }
    seen.add(entry.competencyId);
  }
  const byId = new Map(input.competencies.map((e) => [e.competencyId, e]));

  // Interview completeness (PARTIAL_INTERVIEW_POLICY, the single
  // definition) is evaluated BEFORE scoring, because it gates the
  // PER-COMPETENCY verified category too (v2, G2.1): a 6/7 interview
  // nulls every per-competency verified category, however high the
  // competency scores. Presence is read from the inputs (any
  // competency carrying an interview score), not from the component
  // average — an interview whose competencies all ended up
  // score-null still happened, and its coverage is still a fact.
  // A profile whose interview scores exist but whose interview is
  // not PROVEN complete — partial or coverage unknown — is NOT
  // Complete, however high the renormalised blend is.
  const interviewPresentInInputs = input.competencies.some(
    (e) => e.interviewScore !== null && e.interviewScore !== undefined,
  );
  const coverageAssessment = interviewPresentInInputs
    ? assessInterviewCoverage(input.interviewCoverage)
    : null;
  const interviewComplete = coverageAssessment?.complete ?? false;

  // The coding evaluation's basis (v2, G2.4): a failed qualitative
  // review blocks EVERY verified category (profile and
  // per-competency) — the overall is renormalised over the verified
  // dimensions only, so a human must review the evaluation first.
  const qualitativeFailed = input.qualitativeMethod === "failed";

  const competencies = role.competencies.map((def) =>
    scoreCompetency(def, byId.get(def.id), fw, practicalMinimum, {
      interviewComplete,
      qualitativeFailed,
    }),
  );

  // Component scores: weight-averaged over competencies that produced a
  // score (score !== null). A competency that is Not Assessed or has
  // Insufficient Evidence contributes NOTHING — never a silent zero and
  // never a fabricated input value.
  const componentScores: ComponentScores = { coding: null, interview: null, evidence: null };
  for (const key of ["coding", "interview", "evidence"] as const) {
    const field = `${key}Score` as "codingScore" | "interviewScore" | "evidenceScore";
    let weightSum = 0;
    let weighted = 0;
    for (const c of competencies) {
      if (c.score === null) continue;
      const v = c[field];
      if (v !== null) {
        weightSum += c.weight;
        weighted += v * c.weight;
      }
    }
    componentScores[key] = weightSum > 0 ? round2(weighted / weightSum) : null;
  }

  // Overall S = C*0.50 + I*0.30 + E*0.20 over the components present,
  // renormalised when a component is entirely absent (flagged Incomplete).
  const w = fw.componentWeights;
  const overallScore = blendSources([
    ...(componentScores.coding !== null
      ? [{ source: "coding" as const, score: componentScores.coding, weight: w.coding }]
      : []),
    ...(componentScores.interview !== null
      ? [{ source: "interview" as const, score: componentScores.interview, weight: w.interview }]
      : []),
    ...(componentScores.evidence !== null
      ? [{ source: "evidence" as const, score: componentScores.evidence, weight: w.evidence }]
      : []),
  ]);

  const assessedCount = competencies.filter((c) => c.score !== null).length;
  const evidenceCoveragePercent = round2((assessedCount / competencies.length) * 100);

  // Overall status, in precedence order. "Insufficient Evidence" names
  // the most fundamental gap; "Incomplete" covers a missing source or
  // an unverified / partial interview.
  let status: ProfileStatus;
  const notes: string[] = [];
  if (competencies.some((c) => c.status === "Insufficient Evidence")) {
    status = "Insufficient Evidence";
    notes.push("At least one competency has insufficient evidence.");
  } else if (competencies.some((c) => c.status === "Not Assessed")) {
    status = "Incomplete";
    notes.push("At least one competency was not assessed.");
  } else if (competencies.some((c) => c.status === "Incomplete")) {
    status = "Incomplete";
    notes.push("At least one competency is missing a scoring source.");
  } else {
    status = "Complete";
  }
  if (overallScore === null) {
    notes.push("No overall score: no competency produced a score.");
  }

  // Interview completeness (PARTIAL_INTERVIEW_POLICY — evaluated
  // before scoring, above): a profile whose interview is not PROVEN
  // complete is NOT Complete, however high the renormalised blend
  // is. The provisional score stays visible; the verified category
  // does not.
  if (status === "Complete" && !interviewComplete) {
    status = "Incomplete";
    notes.push(
      `Interview incomplete: ${coverageAssessment?.provisionalNote ?? "coverage unverified"}. The overall score is provisional until all required interview questions are evaluated.`,
    );
  } else if (interviewPresentInInputs && coverageAssessment && !coverageAssessment.complete) {
    // The status already names a deeper gap; still record the
    // interview gap so it is never hidden.
    notes.push(
      `Interview incomplete: ${coverageAssessment.provisionalNote ?? "coverage unverified"}.`,
    );
  }

  // PROVISIONAL category: the band of the renormalised overall score.
  // Practical-task safeguard: coding below the minimum caps the
  // PROVISIONAL category at L2 — Job Ready / Strong are blocked,
  // however strong the interview and evidence are.
  let provisionalCategory: ProficiencyCategory | null =
    overallScore !== null ? categoryForScore(overallScore, fw) : null;
  const codingBelowMinimum =
    componentScores.coding !== null && componentScores.coding < practicalMinimum;
  if (codingBelowMinimum && provisionalCategory) {
    const l2 = fw.categories.find((c) => c.id === "L2");
    if (l2 && provisionalCategory.min > l2.max) {
      provisionalCategory = l2;
    }
    // The threshold outcome is the status only when nothing else is
    // already failing; otherwise the deeper gap keeps its status and
    // the cap still applies to the provisional number.
    if (status === "Complete") {
      status = "Practical Threshold Not Met";
    }
    notes.push(
      `Coding component ${componentScores.coding} is below the practical minimum ${practicalMinimum}; Job Ready / Strong are blocked.`,
    );
  }

  // VERIFIED category: only when EVERY mandatory condition holds
  // (see evaluateVerifiedCategory). A high provisional number with a
  // missing source, thin evidence, a failed practical minimum, a
  // partial interview or a failed qualitative review still yields
  // null here.
  const verifiedCategoryId = evaluateVerifiedCategory(
    {
      sourcesComplete: status === "Complete",
      practicalMinimumMet: !codingBelowMinimum,
      interviewComplete,
      hasScore: overallScore !== null,
      qualitativeReviewPassed: !qualitativeFailed,
    },
    provisionalCategory ? provisionalCategory.id : null,
  );
  const verifiedCategory = verifiedCategoryId
    ? (fw.categories.find((c) => c.id === verifiedCategoryId) ?? null)
    : null;
  if (verifiedCategoryId === null && overallScore !== null) {
    notes.push(
      "No verified category: the overall score is provisional until all mandatory conditions hold (all sources complete, minimum evidence per competency, practical coding minimum met, interview fully evaluated, qualitative review passed).",
    );
  }
  if (qualitativeFailed) {
    notes.push(
      "Human review required: the coding evaluation's qualitative review failed, so its overall reflects the verified dimensions only (functional + quality); no verified category is issued until a human reviews the evaluation.",
    );
  }

  // Practical-minimum failures, INCLUDING score-null competencies
  // (v2, G4.2): component scores average only over competencies with
  // a computed score, so a below-minimum coding score on an
  // Insufficient Evidence / Not Assessed competency vanishes from
  // the component average with no trace unless listed here.
  const practicalMinimumFailures = competencies
    .filter((c) => c.codingScore !== null && c.codingScore < practicalMinimum)
    .map((c) => ({
      competencyId: c.competencyId,
      competencyName: c.competencyName,
      codingScore: c.codingScore as number,
    }));
  const hiddenFailures = practicalMinimumFailures.filter(
    (f) => competencies.find((c) => c.competencyId === f.competencyId)?.score === null,
  );
  if (hiddenFailures.length > 0) {
    notes.push(
      `Coding below the practical minimum ${practicalMinimum} on score-null competencies (excluded from the component average, which covers scored competencies only): ${hiddenFailures.map((f) => `${f.competencyName} (${f.codingScore})`).join(", ")}. See practicalMinimumFailures.`,
    );
  }

  const hasAnyEvidence = competencies.some((c) => c.status !== "Not Assessed");
  const statusLabel = profileStatusLabel(status, hasAnyEvidence);

  // Confidence (v2, G4.3): high only for a Complete profile at 100%
  // coverage; medium only when the profile is Complete OR at 100%
  // coverage; low otherwise. An Incomplete / Insufficient Evidence
  // profile below 100% coverage is low, however high its provisional
  // number — medium at >=60% coverage used to overstate it.
  let confidence: ConfidenceLevel;
  if (status === "Complete" && evidenceCoveragePercent === 100) confidence = "high";
  else if (status === "Complete" || evidenceCoveragePercent === 100) confidence = "medium";
  else confidence = "low";

  return {
    roleId: role.roleId,
    roleName: role.roleName,
    frameworkVersion: fw.version,
    overallScore,
    provisionalScore: overallScore,
    provisionalCategory: provisionalCategory ? provisionalCategory.id : null,
    provisionalCategoryLabel: provisionalCategory ? provisionalCategory.label : null,
    overallCategory: verifiedCategory ? verifiedCategory.id : null,
    overallCategoryLabel: verifiedCategory ? verifiedCategory.label : null,
    verifiedCategory: verifiedCategory ? verifiedCategory.id : null,
    verifiedCategoryLabel: verifiedCategory ? verifiedCategory.label : null,
    status,
    statusLabel,
    classificationRuleVersion: CLASSIFICATION_RULE_VERSION,
    interviewCoverage: coverageAssessment,
    componentScores,
    competencies,
    evidenceCoveragePercent,
    confidence,
    practicalMinimumFailures,
    qualitativeMethod: input.qualitativeMethod ?? null,
    frameworkSnapshot: {
      version: fw.version,
      categories: fw.categories,
      componentWeights: { ...fw.componentWeights },
      practicalMinimumCodingScore: practicalMinimum,
    },
    notes,
  };
}
