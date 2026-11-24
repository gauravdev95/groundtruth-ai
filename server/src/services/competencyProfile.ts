import { createHash } from "node:crypto";
import { pool } from "../config/db";
import { ApiError } from "../middleware/errorHandler";
import { loadAssessmentById } from "./assessments";
import { getEvaluation } from "./evaluation";
import { resolveRoleForCandidate } from "./interview";
import { EXPECTED_INTERVIEW_QUESTIONS } from "./interviewSession";
import {
  computeCompetencyProfile,
  getFramework,
  profileStatusLabel,
  type CompetencyEvidenceInput,
  type CompetencyProfileResult,
  type InterviewCoverage,
  type ProfileStatus,
} from "./competencyScoringService";
import type { RoleCompetency } from "../config/competencyFramework";

// ── Final competency profiles (Phase E) ────────────────────────────────────
// Integration over the three real sources, computed once per assessment
// and stored immutably in `competency_results` (migration 010 table,
// extended by 012 with assessment/interview/evaluation links, an inputs
// fingerprint and an immutability trigger):
//   C — coding: the completed evaluation's overall score, applied per
//       competency ONLY where the coding task actually exercised that
//       competency (skill overlap with the challenge + evaluation text).
//       The coding task is one task; per-competency differentiation
//       comes from the interview and the evidence.
//   I — interview: per-competency scores from the stored immutable
//       interview report (interview_reports). Only a COMPLETED interview
//       supplies I; an unfinished or missing interview leaves I null and
//       the profile Incomplete — never a silent zero.
//   E — evidence: independently verified evidence — verified skills
//       (verified_skills, backed by an evaluation), GitHub/other
//       verification rows (verification_results) and candidate projects
//       (candidate_projects). A verified skill's numeric contribution is
//       its evaluation functional score (or test pass rate) — a real
//       number from the evaluation that verified it, never invented.
//       Projects carry no numeric score; they count as evidence items.
// NO double-counting: an evidence-item id that appears in both the
// coding list and the evidence list is counted ONCE by
// competencyScoringService (reported as dedupedEvidenceIds). The one
// genuine overlap is the evaluation itself: a verified skill whose
// evidence points at this assessment IS evidence from the same
// evaluation that produced C, so `evaluation:<assessmentId>` is listed
// in both sources and deduplicated.
// NO automatic decision: the profile is an assessment result. It never
// rejects or hires anyone — recruiters decide. The profile carries an
// explicit `isFinal` flag: only Complete and Practical Threshold Not Met
// are final; Incomplete / Insufficient Evidence profiles are
// provisional drafts. Provisional vs verified (classification rule
// `provisional-vs-verified-v3`, see competencyScoringService): a draft
// carries a PROVISIONAL score/category only — `verifiedCategory` is
// null until every mandatory condition holds (all sources complete,
// minimum evidence per competency, practical coding minimum met, and
// the interview fully evaluated per PARTIAL_INTERVIEW_POLICY). A
// renormalised number is never presented as a verified L3/L4.
// Deterministic + idempotent: the same source snapshot always produces
// the same stored row (inputs_hash). Re-running compute with unchanged
// inputs returns the stored row; with changed inputs it refreshes a
// non-final draft (DELETE + INSERT — UPDATE is rejected by the 012
// trigger) and never touches a final profile.
// Judge0 is NOT configured — nothing here claims code-execution results.

export const COMPETENCY_FORMULA_VERSION = "1";
export const COMPETENCY_FORMULA =
  "S = C*0.50 + I*0.30 + E*0.20";

export const FINAL_PROFILE_STATUSES: ProfileStatus[] = [
  "Complete",
  "Practical Threshold Not Met",
];

export interface CompetencyEvidenceReference {
  competencyId: string;
  competencyName: string;
  /** Human-readable list of the evidence items backing this competency. */
  items: { id: string; kind: string; label: string; score: number | null }[];
}

export interface StoredCompetencyProfile {
  id: string;
  assessmentId: string;
  candidateId: string;
  interviewId: string | null;
  evaluationId: string | null;
  roleId: string;
  roleName: string;
  roleResolvedFrom: "interview" | "explicit" | "profile" | "default";
  frameworkVersion: string;
  overallScore: number | null;
  /** PROVISIONAL overall score (renormalised blend). Same value as
   *  overallScore, named so the UI can label it honestly. */
  provisionalScore: number | null;
  /** PROVISIONAL category of the provisional score (capped at L2 when
   *  the practical minimum fails). Never a verified result. */
  provisionalCategory: string | null;
  provisionalCategoryLabel: string | null;
  /** VERIFIED category — null unless every mandatory condition holds
   *  (see competencyScoringService.evaluateVerifiedCategory). This is
   *  what the `overall_category` column stores. */
  overallCategory: string | null;
  overallCategoryLabel: string | null;
  verifiedCategory: string | null;
  verifiedCategoryLabel: string | null;
  status: ProfileStatus;
  /** Display label for `status` ("Assessment Incomplete" for stored
   *  "Incomplete"; "Not Assessed" when no source exists at all). */
  statusLabel: string;
  /** Classification rule that produced this profile (see
   *  CLASSIFICATION_RULE_VERSION in competencyScoringService). */
  classificationRuleVersion: string;
  /** Interview completeness per PARTIAL_INTERVIEW_POLICY, as evaluated
   *  when this profile was computed. Null when no interview component
   *  exists. */
  interviewCoverage: CompetencyProfileResult["interviewCoverage"];
  /** True only for Complete / Practical Threshold Not Met. Until then
   *  the category is provisional and the profile is not a final result. */
  isFinal: boolean;
  componentScores: CompetencyProfileResult["componentScores"];
  competencies: CompetencyProfileResult["competencies"];
  evidenceCoveragePercent: number;
  confidence: CompetencyProfileResult["confidence"];
  /**
   * Competencies whose coding score is below the practical minimum,
   * INCLUDING score-null ones (v2, G4.2 — see
   * CompetencyProfileResult.practicalMinimumFailures). Empty for
   * profiles computed before this field existed.
   */
  practicalMinimumFailures: CompetencyProfileResult["practicalMinimumFailures"];
  /**
   * Evaluation basis of the coding evaluation (v2, G2.4): the
   * qualitative review method, so a failed leg is visible on the
   * profile. Null for profiles computed before this field existed
   * and when there is no evaluation.
   */
  qualitativeMethod: string | null;
  strengths: string[];
  improvementAreas: string[];
  evidenceReferences: CompetencyEvidenceReference[];
  formulaVersion: string;
  formula: string;
  frameworkSnapshot: CompetencyProfileResult["frameworkSnapshot"];
  sources: {
    evaluation: { id: string; overallScore: number | null } | null;
    interview: { id: string; finalScore: number | null } | null;
    evidenceItems: number;
  };
  notes: string[];
  computedAt: string;
}

export interface ComputeCompetencyProfileResult {
  profile: StoredCompetencyProfile;
  /** True when this call computed and stored a fresh row. */
  fresh: boolean;
  /** True when a stored row was returned unchanged (same inputs, or a
   *  final profile whose inputs have since changed). */
  recomputed: boolean;
  note: string | null;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function normalize(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

const STOPWORDS = new Set([
  "and", "or", "the", "with", "for", "using", "use", "code", "work",
]);

/** Significant tokens of a skill name (lowercased, stopwords removed). */
function skillTokens(skill: string): string[] {
  return normalize(skill)
    .split(" ")
    .filter((w) => w.length >= 2 && !STOPWORDS.has(w));
}

/** Plural-tolerant token check: "api" matches "apis", "apis" matches "api". */
function tokenInCorpus(token: string, corpus: string): boolean {
  if (corpus.includes(token)) return true;
  if (corpus.includes(`${token}s`)) return true;
  if (token.endsWith("s") && corpus.includes(token.slice(0, -1))) return true;
  return false;
}

/**
 * True when every significant token of `skill` appears in `corpus`
 * (plural-tolerant). Used to decide whether a piece of text (challenge,
 * evaluation notes, project description) evidences a skill.
 */
export function skillMentionedInText(skill: string, text: string): boolean {
  const tokens = skillTokens(skill);
  if (tokens.length === 0) return false;
  const corpus = normalize(text);
  return tokens.every((t) => tokenInCorpus(t, corpus));
}

/**
 * True when a skill name matches a competency skill: exact match, or
 * one contains the other (case-insensitive). "PostgreSQL" matches
 * "PostgreSQL"; "REST API" matches "REST APIs".
 */
export function skillMatchesCompetencySkill(
  skillName: string,
  competencySkill: string,
): boolean {
  const a = normalize(skillName);
  const b = normalize(competencySkill);
  if (!a || !b) return false;
  if (a === b) return true;
  return a.includes(b) || b.includes(a);
}

interface EvidenceItem {
  id: string;
  kind: "verified-skill" | "project" | "verification";
  label: string;
  /** Numeric contribution to the evidence score, if the item has one. */
  score: number | null;
  /** True when this item's evidence comes from the same evaluation
   *  that produced the coding component (dedup overlap). */
  fromThisEvaluation: boolean;
}

interface CollectedSources {
  evaluation: {
    id: string;
    overallScore: number | null;
    corpus: string;
    /** Qualitative review method ("live-ai" |
     *  "deterministic-heuristic" | "failed"); "failed" blocks
     *  verification (v2, G2.4). */
    qualitativeMethod: string | null;
    humanReviewRecommended: boolean;
  } | null;
  interview: {
    id: string;
    finalScore: number | null;
    roleId: string | null;
    competencyScores: Map<string, number>;
    /**
     * Question-level coverage from the stored report, per
     * PARTIAL_INTERVIEW_POLICY. Null when the report carries no
     * per-question detail — the interview is then unverified and
     * cannot support a verified category.
     */
    coverage: InterviewCoverage | null;
    /**
     * Per-competency question coverage (v2, G4.4): for each
     * competency id, how many of its required original questions
     * have a scored evaluation. A competency's interview score is
     * a mean over its scored questions only — it counts toward
     * "Assessed" only when all of them are scored.
     */
    competencyCoverage: Map<string, { questionsScored: number; questionsRequired: number }>;
  } | null;
  /** Evidence items per competency id. */
  evidenceByCompetency: Map<string, EvidenceItem[]>;
  evidenceItemsTotal: number;
}

async function collectSources(
  assessmentId: string,
  candidateId: string,
): Promise<CollectedSources> {
  // ── Coding (C): the completed evaluation ──
  const evaluation = await getEvaluation(assessmentId);
  let evaluationSource: CollectedSources["evaluation"] = null;
  if (evaluation && evaluation.status === "completed" && evaluation.overallScore !== null) {
    const challenge = await pool.query(
      `SELECT title, problem_statement, acceptance_criteria FROM challenges WHERE assessment_id = $1`,
      [assessmentId],
    );
    const ch = challenge.rows[0];
    const snap = await pool.query(
      `SELECT files FROM code_snapshots WHERE assessment_id = $1 ORDER BY version DESC LIMIT 1`,
      [assessmentId],
    );
    const changedFiles = Object.keys(
      (snap.rows[0]?.files as Record<string, unknown> | undefined) ?? {},
    ).join(" ");
    const corpus = [
      ch?.title ?? "",
      ch?.problem_statement ?? "",
      JSON.stringify(ch?.acceptance_criteria ?? []),
      JSON.stringify(evaluation.strengths ?? []),
      JSON.stringify(evaluation.weaknesses ?? []),
      JSON.stringify(evaluation.qualityIssues ?? []),
      changedFiles,
    ].join(" ");
    evaluationSource = {
      id: evaluation.id,
      overallScore: evaluation.overallScore,
      corpus,
      // Evaluation basis (v2, G2.4): a failed qualitative review
      // blocks verification and is fingerprinted with the inputs.
      qualitativeMethod: evaluation.qualitativeMethod ?? null,
      humanReviewRecommended: evaluation.humanReviewRecommended ?? false,
    };
  }

  // ── Interview (I): the stored immutable report of the latest
  //    completed assessment interview ──
  let interviewSource: CollectedSources["interview"] = null;
  const interviewRow = await pool.query(
    `SELECT id, score, status FROM interviews
      WHERE assessment_id = $1 AND interview_type = 'assessment'
      ORDER BY created_at DESC LIMIT 1`,
    [assessmentId],
  );
  if (interviewRow.rows.length) {
    const interviewId = interviewRow.rows[0].id as string;
    if (interviewRow.rows[0]?.status === "completed") {
      const reportRow = await pool.query(
        `SELECT report, role_id FROM interview_reports WHERE interview_id = $1`,
        [interviewId],
      );
      const legacy = await pool.query(
        `SELECT report FROM interviews WHERE id = $1`,
        [interviewId],
      );
      const report =
        (reportRow.rows[0]?.report as Record<string, unknown> | undefined) ??
        (legacy.rows[0]?.report as Record<string, unknown> | undefined) ??
        null;
      const competencyScores = new Map<string, number>();
      const list = (report?.competencyScores as { competencyId: string; score: number | null }[] | undefined) ?? [];
      for (const entry of list) {
        if (entry && typeof entry.score === "number") {
          competencyScores.set(entry.competencyId, entry.score);
        }
      }
      // Question-level coverage, per PARTIAL_INTERVIEW_POLICY (the
      // single definition lives in competencyScoringService): the
      // report's perQuestion rows are the REQUIRED ORIGINAL questions
      // (follow-ups are nested inside them, never counted separately).
      // A final interview score exists only when every one of them has
      // a scored evaluation; anything less is provisional, stated with
      // its coverage. A report without per-question detail leaves the
      // interview unverified (coverage null).
      //
      // Phase 2, G3.2: questionsRequired is the FRAMEWORK count
      // (EXPECTED_INTERVIEW_QUESTIONS = 7), never the stored row
      // count — a legacy 3-row report, all scored, used to read
      // complete:true (3 of 3) and could support a verified L3/L4 on
      // a 3-question interview. It now reads 3 of 7: incomplete.
      //
      // Phase 2, G3.1: the counts are recomputed here from the
      // perQuestion STATUSES, never trusted from the stored report
      // number — an old report whose stored pendingEvaluations
      // undercounts (e.g. it counted pending rows but not unanswered
      // ones) cannot leak a complete reading into the profile.
      // unansweredCount rides with the coverage into the inputs
      // fingerprint, so a coverage change refreshes a draft profile.
      const perQuestion = (report?.perQuestion as
        | { score?: unknown; status?: unknown; competencyId?: unknown }[]
        | undefined) ?? null;
      const coverage: (InterviewCoverage & { unansweredCount: number }) | null = perQuestion
        ? {
            questionsScored: perQuestion.filter(
              (q) => q && typeof q.score === "number",
            ).length,
            questionsRequired: EXPECTED_INTERVIEW_QUESTIONS,
            pendingEvaluations: perQuestion.filter(
              (q) => q && q.status === "pending_evaluation",
            ).length,
            unansweredCount: perQuestion.filter(
              (q) => q && q.status === "unanswered",
            ).length,
          }
        : null;
      // Per-competency question coverage (v2, G4.4): required =
      // original questions targeting the competency; scored = those
      // with a scored evaluation. Follow-ups are nested inside
      // their original question and never counted separately.
      const competencyCoverage = new Map<
        string,
        { questionsScored: number; questionsRequired: number }
      >();
      if (perQuestion) {
        for (const q of perQuestion) {
          const cid = q && typeof q.competencyId === "string" ? q.competencyId : null;
          if (!cid) continue;
          const entry = competencyCoverage.get(cid) ?? {
            questionsScored: 0,
            questionsRequired: 0,
          };
          entry.questionsRequired += 1;
          if (typeof q.score === "number") entry.questionsScored += 1;
          competencyCoverage.set(cid, entry);
        }
      }
      interviewSource = {
        id: interviewId,
        finalScore:
          report && typeof report.finalScore === "number"
            ? (report.finalScore as number)
            : interviewRow.rows[0].score !== null
              ? Number(interviewRow.rows[0].score)
              : null,
        roleId:
          (reportRow.rows[0]?.role_id as string | undefined) ??
          ((report?.roleId as string | undefined) ?? null),
        competencyScores,
        coverage,
        competencyCoverage,
      };
    }
  }

  // ── Evidence (E): verified skills, verification rows, projects ──
  const verifiedSkills = await pool.query(
    `SELECT vs.skill_id, vs.evidence, s.name AS skill_name
       FROM verified_skills vs JOIN skills s ON s.id = vs.skill_id
      WHERE vs.candidate_id = $1 AND vs.status = 'verified'`,
    [candidateId],
  );
  const projects = await pool.query(
    `SELECT id, title, description, technologies FROM candidate_projects WHERE candidate_id = $1`,
    [candidateId],
  );
  const verifications = await pool.query(
    `SELECT id, source, source_ref, score, result FROM verification_results WHERE candidate_id = $1`,
    [candidateId],
  );

  const evidenceByCompetency = new Map<string, EvidenceItem[]>();
  const add = (competencyId: string, item: EvidenceItem) => {
    const list = evidenceByCompetency.get(competencyId) ?? [];
    if (!list.some((x) => x.id === item.id)) list.push(item);
    evidenceByCompetency.set(competencyId, list);
  };
  // The framework role is resolved by the caller; evidence matching
  // needs the competency skill lists, so match against EVERY role's
  // competencies here (a skill/project can evidence several roles'
  // competencies — the compute step keeps only this role's entries).
  const framework = getFramework();
  const allCompetencies: RoleCompetency[] = framework.roles.flatMap(
    (r) => r.competencies,
  );
  const competencyForSkill = (skillName: string): RoleCompetency[] =>
    allCompetencies.filter((c) =>
      c.skills.some((s) => skillMatchesCompetencySkill(skillName, s)),
    );
  const competencyForText = (text: string): RoleCompetency[] =>
    allCompetencies.filter((c) =>
      c.skills.some((s) => skillMentionedInText(s, text)),
    );

  for (const row of verifiedSkills.rows) {
    const evidence = (row.evidence as Record<string, unknown> | null) ?? {};
    const functional =
      typeof evidence.functional_score === "number" ? (evidence.functional_score as number) : null;
    const passRate =
      typeof evidence.test_pass_rate === "number" ? (evidence.test_pass_rate as number) : null;
    const score = functional ?? (passRate !== null ? round2(passRate * 100) : null);
    const fromThisEvaluation =
      evaluationSource !== null && evidence.assessment_id === assessmentId;
    for (const comp of competencyForSkill(String(row.skill_name))) {
      add(comp.id, {
        id: `verified-skill:${String(row.skill_id)}`,
        kind: "verified-skill",
        label: `Verified skill: ${String(row.skill_name)}`,
        score,
        fromThisEvaluation,
      });
      if (fromThisEvaluation) {
        // The same evaluation is both the coding task and the
        // verification evidence for this skill — listed in both
        // sources, counted ONCE by the scoring service.
        add(comp.id, {
          id: `evaluation:${assessmentId}`,
          kind: "verified-skill",
          label: `Evaluation ${assessmentId} (also the coding source)`,
          score: null,
          fromThisEvaluation: true,
        });
      }
    }
  }
  for (const row of projects.rows) {
    const text = [
      String(row.title ?? ""),
      String(row.description ?? ""),
      ((row.technologies as string[] | null) ?? []).join(" "),
    ].join(" ");
    for (const comp of competencyForText(text)) {
      add(comp.id, {
        id: `project:${String(row.id)}`,
        kind: "project",
        label: `Project: ${String(row.title)}`,
        score: null,
        fromThisEvaluation: false,
      });
    }
  }
  for (const row of verifications.rows) {
    const text = [
      String(row.source_ref ?? ""),
      JSON.stringify(row.result ?? {}),
    ].join(" ");
    for (const comp of competencyForText(text)) {
      add(comp.id, {
        id: `verification:${String(row.id)}`,
        kind: "verification",
        label: `Verification (${String(row.source)}): ${String(row.source_ref ?? row.id)}`,
        score: row.score !== null ? Number(row.score) : null,
        fromThisEvaluation: false,
      });
    }
  }

  let evidenceItemsTotal = 0;
  for (const list of evidenceByCompetency.values()) evidenceItemsTotal += list.length;
  return {
    evaluation: evaluationSource,
    interview: interviewSource,
    evidenceByCompetency,
    evidenceItemsTotal,
  };
}

function deriveStrengthsAndImprovements(
  result: CompetencyProfileResult,
): { strengths: string[]; improvementAreas: string[] } {
  const strengths: string[] = [];
  const improvementAreas: string[] = [];
  for (const c of result.competencies) {
    if (c.score !== null && c.score >= 70) {
      strengths.push(
        `Strong on ${c.competencyName} (${c.score}, ${c.categoryLabel ?? c.category}).`,
      );
    } else if (c.score !== null && c.score < 50) {
      improvementAreas.push(
        `${c.competencyName} needs work (${c.score}, ${c.categoryLabel ?? c.category}) — ${c.notes.join(" ")}`,
      );
    } else if (c.status === "Not Assessed") {
      improvementAreas.push(
        `${c.competencyName} is not assessed yet — no evidence from coding, interview or verified sources.`,
      );
    } else if (c.status === "Insufficient Evidence") {
      improvementAreas.push(
        `${c.competencyName} has insufficient evidence (${c.evidenceProvided} of ${c.evidenceRequired} items) — add verified project or interview evidence.`,
      );
    } else if (c.status === "Incomplete") {
      improvementAreas.push(
        `${c.competencyName} is incomplete — missing ${c.sourcesMissing.join(", ")} source(s).`,
      );
    }
  }
  return { strengths, improvementAreas };
}

function rowToStoredProfile(row: Record<string, unknown>): StoredCompetencyProfile {
  const result = row.result as Record<string, unknown>;
  const profile = result.profile as CompetencyProfileResult;
  const status = String(row.status) as ProfileStatus;
  // Rows stored BEFORE the provisional-vs-verified rule carry only the
  // old overallCategory (a provisional band presented as the category).
  // Reinterpret them honestly instead of trusting the old label: the
  // verified category is the stored category ONLY for a Complete
  // profile; every other old row has no verified category, and its
  // stored category becomes the provisional one. The stored COLUMN
  // (overall_category) is the authority for old rows — the old result
  // JSON does not reliably carry the category (see the Phase F test
  // fixture, which omits it). New rows carry the explicit fields in
  // the JSON and need no fallback. (Read through a partial record: a
  // stored JSON may predate the new fields.)
  const legacy = profile as unknown as Partial<CompetencyProfileResult>;
  const storedColumnCategory = (row.overall_category as string | null) ?? null;
  const hasVerifiedField = typeof legacy.verifiedCategory !== "undefined";
  // v2 (G2.2): a legacy Complete row is trusted as verified ONLY
  // when its stored interview coverage (where present) is complete.
  // The pre-v1 "Complete" definition predates
  // PARTIAL_INTERVIEW_POLICY, so a legacy row whose stored coverage
  // says the interview was partial is demoted: no verified category
  // (its stored band stays the provisional one). When no coverage
  // data exists at all the legacy trust is kept — an accepted
  // limitation, documented in docs/SCORING_METHODOLOGY.md §5 — since
  // there is nothing to re-check against.
  const legacyCoverage = (profile as unknown as {
    interviewCoverage?: { complete?: unknown } | null;
  }).interviewCoverage;
  const legacyCoverageComplete =
    legacyCoverage && typeof legacyCoverage.complete === "boolean"
      ? (legacyCoverage.complete as boolean)
      : null;
  const verifiedCategory = hasVerifiedField
    ? (profile.verifiedCategory as string | null)
    : status === "Complete" && legacyCoverageComplete !== false
      ? storedColumnCategory
      : null;
  const verifiedCategoryLabel = hasVerifiedField
    ? (profile.verifiedCategoryLabel as string | null)
    : verifiedCategory === null
      ? null
      : profile.overallCategoryLabel;
  const hasProvisionalField = typeof legacy.provisionalCategory !== "undefined";
  const provisionalCategory = hasProvisionalField
    ? (profile.provisionalCategory as string | null)
    : storedColumnCategory;
  const hasAnyEvidence = profile.competencies.some((c) => c.status !== "Not Assessed");
  return {
    id: String(row.id),
    assessmentId: String(row.assessment_id),
    candidateId: String(row.candidate_id),
    interviewId: (row.interview_id as string | null) ?? null,
    evaluationId: (row.evaluation_id as string | null) ?? null,
    roleId: String(row.role_id),
    roleName: profile.roleName,
    roleResolvedFrom: (result.roleResolvedFrom as StoredCompetencyProfile["roleResolvedFrom"]) ?? "default",
    frameworkVersion: String(row.framework_version),
    overallScore: row.overall_score === null ? null : Number(row.overall_score),
    provisionalScore:
      (profile.provisionalScore as number | null | undefined) ??
      (row.overall_score === null ? null : Number(row.overall_score)),
    provisionalCategory:
      (profile.provisionalCategory as string | null | undefined) ??
      provisionalCategory,
    provisionalCategoryLabel:
      (profile.provisionalCategoryLabel as string | null | undefined) ??
      profile.overallCategoryLabel,
    overallCategory: verifiedCategory,
    overallCategoryLabel: verifiedCategoryLabel,
    verifiedCategory,
    verifiedCategoryLabel,
    status,
    statusLabel:
      (profile.statusLabel as string | undefined) ?? profileStatusLabel(status, hasAnyEvidence),
    classificationRuleVersion:
      (profile.classificationRuleVersion as string | undefined) ??
      "pre-provisional-vs-verified (overallCategory was provisional)",
    interviewCoverage: (profile.interviewCoverage as StoredCompetencyProfile["interviewCoverage"]) ?? null,
    isFinal: FINAL_PROFILE_STATUSES.includes(status),
    componentScores: profile.componentScores,
    competencies: profile.competencies,
    evidenceCoveragePercent: profile.evidenceCoveragePercent,
    confidence: profile.confidence,
    practicalMinimumFailures:
      (profile.practicalMinimumFailures as StoredCompetencyProfile["practicalMinimumFailures"]) ?? [],
    qualitativeMethod:
      (profile.qualitativeMethod as string | null | undefined) ?? null,
    strengths: (result.strengths as string[]) ?? [],
    improvementAreas: (result.improvementAreas as string[]) ?? [],
    evidenceReferences: (result.evidenceReferences as CompetencyEvidenceReference[]) ?? [],
    formulaVersion: (result.formulaVersion as string) ?? COMPETENCY_FORMULA_VERSION,
    formula: (result.formula as string) ?? COMPETENCY_FORMULA,
    frameworkSnapshot: profile.frameworkSnapshot,
    sources: (result.sources as StoredCompetencyProfile["sources"]) ?? {
      evaluation: null,
      interview: null,
      evidenceItems: 0,
    },
    notes: profile.notes,
    computedAt: String(row.computed_at),
  };
}

/** Read-only fetch of the stored profile for an assessment (any caller
 *  that already passed an ownership check). Returns null when no profile
 *  has been computed yet. */
export async function getStoredCompetencyProfile(
  assessmentId: string,
): Promise<StoredCompetencyProfile | null> {
  const res = await pool.query(
    `SELECT * FROM competency_results WHERE assessment_id = $1 ORDER BY computed_at DESC LIMIT 1`,
    [assessmentId],
  );
  if (!res.rows.length) return null;
  return rowToStoredProfile(res.rows[0]);
}

/**
 * Compute (or return the stored) final competency profile for an
 * assessment. Requires the assessment to exist; missing sources do NOT
 * block computation — they make the profile Incomplete / Insufficient
 * Evidence / Not Assessed, and the profile is flagged non-final until
 * the required sources complete.
 */
export async function computeCompetencyProfileForAssessment(
  assessmentId: string,
  opts: { roleId?: string; frameworkVersion?: string } = {},
): Promise<ComputeCompetencyProfileResult> {
  const assessment = await loadAssessmentById(assessmentId);
  const candidateId = assessment.candidate_id as string;
  const sources = await collectSources(assessmentId, candidateId);

  // Role: the completed interview's role wins (it is what the interview
  // was actually run against); then an explicit role; then the
  // candidate's target roles (same resolver the interview uses).
  let roleId: string;
  let roleResolvedFrom: StoredCompetencyProfile["roleResolvedFrom"];
  if (sources.interview?.roleId) {
    roleId = sources.interview.roleId;
    roleResolvedFrom = "interview";
  } else if (opts.roleId) {
    roleId = opts.roleId;
    roleResolvedFrom = "explicit";
  } else {
    const resolved = await resolveRoleForCandidate(candidateId);
    roleId = resolved.role.roleId;
    roleResolvedFrom = resolved.resolvedFrom;
  }
  const frameworkVersion = opts.frameworkVersion ?? getFramework().version;
  const framework = getFramework(frameworkVersion);
  const role = framework.roles.find((r) => r.roleId === roleId);
  if (!role) {
    throw new ApiError(
      400,
      `Unknown role "${roleId}" for framework ${frameworkVersion}`,
    );
  }

  const evaluationId = `evaluation:${assessmentId}`;
  const inputs: CompetencyEvidenceInput[] = role.competencies.map((comp) => {
    // Coding: the evaluation overall, only where the task exercised
    // this competency (skill overlap with challenge + evaluation text).
    const codingExercised =
      sources.evaluation !== null &&
      comp.skills.some((s) => skillMentionedInText(s, sources.evaluation?.corpus ?? ""));
    const codingScore = codingExercised ? (sources.evaluation?.overallScore ?? null) : null;
    const codingEvidenceIds = codingExercised ? [evaluationId] : [];
    // Interview: per-competency score from the stored interview report.
    const interviewScore = sources.interview?.competencyScores.get(comp.id) ?? null;
    // Evidence: verified skills / verifications / projects.
    const items = sources.evidenceByCompetency.get(comp.id) ?? [];
    const scoredItems = items.filter((i) => i.score !== null);
    const evidenceScore =
      scoredItems.length > 0
        ? round2(scoredItems.reduce((s, i) => s + (i.score as number), 0) / scoredItems.length)
        : null;
    return {
      competencyId: comp.id,
      codingScore,
      interviewScore,
      evidenceScore,
      codingEvidenceIds,
      evidenceIds: items.map((i) => i.id),
      // Per-competency interview coverage (v2, G4.4): the interview
      // score counts toward "Assessed" only when every question
      // targeting this competency was scored.
      interviewQuestionsScored:
        sources.interview?.competencyCoverage.get(comp.id)?.questionsScored ?? null,
      interviewQuestionsRequired:
        sources.interview?.competencyCoverage.get(comp.id)?.questionsRequired ?? null,
    };
  });

  const result = computeCompetencyProfile({
    roleId,
    frameworkVersion,
    competencies: inputs,
    // Interview completeness per PARTIAL_INTERVIEW_POLICY — the single
    // policy definition lives in competencyScoringService; this is its
    // one production input (question coverage from the stored report).
    interviewCoverage: sources.interview?.coverage ?? null,
    // Evaluation basis (v2, G2.4): a failed qualitative review blocks
    // verification; the basis is recorded on the profile.
    qualitativeMethod: sources.evaluation?.qualitativeMethod ?? null,
  });
  const { strengths, improvementAreas } = deriveStrengthsAndImprovements(result);
  const evidenceReferences: CompetencyEvidenceReference[] = role.competencies.map(
    (comp) => ({
      competencyId: comp.id,
      competencyName: comp.name,
      items: (sources.evidenceByCompetency.get(comp.id) ?? []).map((i) => ({
        id: i.id,
        kind: i.kind,
        label: i.label,
        score: i.score,
      })),
    }),
  );
  const sourcesSummary: StoredCompetencyProfile["sources"] = {
    evaluation: sources.evaluation
      ? { id: sources.evaluation.id, overallScore: sources.evaluation.overallScore }
      : null,
    interview: sources.interview
      ? { id: sources.interview.id, finalScore: sources.interview.finalScore }
      : null,
    evidenceItems: sources.evidenceItemsTotal,
  };

  // Inputs fingerprint: everything the computation read. Same snapshot
  // → same stored row; a different snapshot may refresh a non-final
  // draft, never a final profile.
  const fingerprint = createHash("sha256")
    .update(
      JSON.stringify({
        frameworkVersion,
        roleId,
        evaluation: sources.evaluation
          ? {
              id: sources.evaluation.id,
              overallScore: sources.evaluation.overallScore,
              // Evaluation basis (v2, G2.4): the qualitative method
              // gates the verified category, so it is part of the
              // fingerprint — a profile cannot silently keep a
              // verified category after its evaluation basis changed.
              qualitativeMethod: sources.evaluation.qualitativeMethod,
              humanReviewRecommended: sources.evaluation.humanReviewRecommended,
            }
          : null,
        interview: sources.interview
          ? {
              id: sources.interview.id,
              finalScore: sources.interview.finalScore,
              competencyScores: [...sources.interview.competencyScores.entries()].sort(),
              // Coverage gates the verified category — it is part of the
              // inputs fingerprint, so a profile cannot silently keep a
              // verified category after its interview coverage changed.
              coverage: sources.interview.coverage,
              // Per-competency coverage gates the per-competency
              // verified category (v2, G4.4) — fingerprinted too.
              competencyCoverage: [...sources.interview.competencyCoverage.entries()]
                .sort((a, b) => (a[0] < b[0] ? -1 : 1))
                .map(([competencyId, c]) => ({ competencyId, ...c })),
            }
          : null,
        evidence: role.competencies.map((comp) => ({
          competencyId: comp.id,
          items: (sources.evidenceByCompetency.get(comp.id) ?? [])
            .map((i) => ({ id: i.id, score: i.score }))
            .sort((a, b) => (a.id < b.id ? -1 : 1)),
        })),
        inputs: inputs.map((i) => ({
          competencyId: i.competencyId,
          codingScore: i.codingScore,
          interviewScore: i.interviewScore,
          evidenceScore: i.evidenceScore,
          codingEvidenceIds: i.codingEvidenceIds,
          evidenceIds: i.evidenceIds,
          interviewQuestionsScored: i.interviewQuestionsScored ?? null,
          interviewQuestionsRequired: i.interviewQuestionsRequired ?? null,
        })),
      }),
    )
    .digest("hex");

  const storedResult = {
    profile: result,
    roleResolvedFrom,
    strengths,
    improvementAreas,
    evidenceReferences,
    formulaVersion: COMPETENCY_FORMULA_VERSION,
    formula: COMPETENCY_FORMULA,
    sources: sourcesSummary,
  };

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const existing = await client.query(
      `SELECT * FROM competency_results WHERE assessment_id = $1 AND framework_version = $2 FOR UPDATE`,
      [assessmentId, frameworkVersion],
    );
    if (existing.rows.length) {
      const row = existing.rows[0];
      if (row.inputs_hash === fingerprint) {
        await client.query("COMMIT");
        return {
          profile: rowToStoredProfile(row),
          fresh: false,
          recomputed: false,
          note: null,
        };
      }
      const storedStatus = String(row.status) as ProfileStatus;
      if (FINAL_PROFILE_STATUSES.includes(storedStatus)) {
        // A final profile is immutable — return it untouched even
        // though the inputs have changed since it was computed.
        await client.query("COMMIT");
        return {
          profile: rowToStoredProfile(row),
          fresh: false,
          recomputed: false,
          note: `A final competency profile already exists for this assessment (status ${storedStatus}); it is immutable and was not recomputed.`,
        };
      }
      // Non-final draft: refresh it (DELETE + INSERT — UPDATE is
      // rejected by the 012 immutability trigger).
      await client.query(`DELETE FROM competency_results WHERE id = $1`, [row.id]);
    }
    const inserted = await client.query(
      `INSERT INTO competency_results
         (candidate_id, assessment_id, interview_id, evaluation_id, role_id,
          framework_version, overall_score, overall_category, status,
          component_scores, result, inputs_hash)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
       ON CONFLICT (assessment_id, framework_version) DO NOTHING
       RETURNING *`,
      [
        candidateId,
        assessmentId,
        sources.interview?.id ?? null,
        sources.evaluation?.id ?? null,
        roleId,
        frameworkVersion,
        result.overallScore,
        result.overallCategory,
        result.status,
        JSON.stringify(result.componentScores),
        JSON.stringify(storedResult),
        fingerprint,
      ],
    );
    let row = inserted.rows[0];
    if (!row) {
      // Lost a race with a concurrent compute — return the winner's row.
      const winner = await client.query(
        `SELECT * FROM competency_results WHERE assessment_id = $1 AND framework_version = $2`,
        [assessmentId, frameworkVersion],
      );
      row = winner.rows[0];
    }
    await client.query("COMMIT");
    return {
      profile: rowToStoredProfile(row),
      fresh: true,
      recomputed: false,
      note: null,
    };
  } catch (err) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw err;
  } finally {
    client.release();
  }
}

/** Candidate read: the owning candidate only (404 for anyone else's
 *  assessment, 404 when no profile has been computed yet). */
export async function getCompetencyProfileForCandidate(opts: {
  assessmentId: string;
  candidateId: string;
}): Promise<StoredCompetencyProfile> {
  const assessment = await loadAssessmentById(opts.assessmentId);
  if (assessment.candidate_id !== opts.candidateId) {
    throw new ApiError(403, "This assessment belongs to another candidate");
  }
  const stored = await getStoredCompetencyProfile(opts.assessmentId);
  if (!stored) {
    throw new ApiError(
      404,
      "No competency profile has been computed for this assessment yet",
    );
  }
  return stored;
}

/** Recruiter gate: the recruiter must have received an application from
 *  this assessment's candidate (same gate as the recruiter evidence
 *  access in services/verified.ts). Admins bypass. */
export async function recruiterMayViewCompetencyProfile(opts: {
  assessmentId: string;
  recruiterUserId: string;
  isAdmin: boolean;
}): Promise<boolean> {
  if (opts.isAdmin) return true;
  const assessment = await pool.query(
    `SELECT candidate_id FROM assessments WHERE id = $1`,
    [opts.assessmentId],
  );
  if (!assessment.rows.length) return false;
  const allowed = await pool.query(
    `SELECT 1 FROM applications a JOIN jobs j ON j.id = a.job_id
      JOIN companies c ON c.id = j.company_id
     WHERE a.candidate_id = $1 AND c.created_by = $2 LIMIT 1`,
    [assessment.rows[0].candidate_id, opts.recruiterUserId],
  );
  return allowed.rows.length > 0;
}

/** Recruiter read: same stored profile as the candidate view. */
export async function getCompetencyProfileForRecruiter(opts: {
  assessmentId: string;
  recruiterUserId: string;
  isAdmin: boolean;
}): Promise<StoredCompetencyProfile> {
  const allowed = await recruiterMayViewCompetencyProfile(opts);
  if (!allowed) {
    throw new ApiError(
      403,
      "You can only view competency profiles for candidates who applied to your jobs",
    );
  }
  const stored = await getStoredCompetencyProfile(opts.assessmentId);
  if (!stored) {
    throw new ApiError(
      404,
      "No competency profile has been computed for this assessment yet",
    );
  }
  return stored;
}
