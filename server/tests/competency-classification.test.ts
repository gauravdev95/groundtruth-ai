import test from "node:test";
import assert from "node:assert/strict";

// P0 — correct final candidate classification (stabilization run).
// Provisional vs verified: a renormalised score is always computable
// from the sources present, but it is NEVER a verified L3/L4 category
// until every mandatory condition holds. Pure functions only: no DB,
// no Redis, no LLM. Every expectation below is hand-computed.
import {
  CLASSIFICATION_RULE_VERSION,
  PARTIAL_INTERVIEW_POLICY,
  assessInterviewCoverage,
  computeCompetencyProfile,
  evaluateVerifiedCategory,
  getFramework,
  profileStatusLabel,
} from "../src/services/competencyScoringService";
import { COMPETENCY_FRAMEWORK_V1 } from "../src/config/competencyFramework";
import type {
  CompetencyProfileInput,
  InterviewCoverage,
} from "../src/services/competencyScoringService";

const V1 = COMPETENCY_FRAMEWORK_V1.version;
const FULL_COVERAGE: InterviewCoverage = {
  questionsScored: 7,
  questionsRequired: 7,
  pendingEvaluations: 0,
};

function fullScores(
  roleId: string,
  coding: number,
  interview: number,
  evidence: number,
  evidenceCount = 2,
  interviewCoverage: InterviewCoverage | null = FULL_COVERAGE,
): CompetencyProfileInput {
  const fw = getFramework(V1);
  const role = fw.roles.find((r) => r.roleId === roleId)!;
  return {
    roleId,
    frameworkVersion: V1,
    competencies: role.competencies.map((c) => ({
      competencyId: c.id,
      codingScore: coding,
      interviewScore: interview,
      evidenceScore: evidence,
      evidenceCount,
    })),
    interviewCoverage,
  };
}

// ── The partial-interview policy: one definition ──────────────────────────

test("partial-interview policy: single exported definition, complete only when all originals are scored", () => {
  assert.equal(PARTIAL_INTERVIEW_POLICY.finalRequiresAllQuestionsEvaluated, true);
  assert.equal(PARTIAL_INTERVIEW_POLICY.perQuestionScoresDisplayable, true);
  assert.equal(PARTIAL_INTERVIEW_POLICY.provisionalRequiresCoverageNote, true);

  const complete = assessInterviewCoverage(FULL_COVERAGE);
  assert.equal(complete.complete, true);
  assert.equal(complete.provisionalNote, null);

  const partial = assessInterviewCoverage({
    questionsScored: 6,
    questionsRequired: 7,
    pendingEvaluations: 1,
  });
  assert.equal(partial.complete, false);
  assert.equal(partial.provisionalNote, "provisional — 6 of 7 questions scored");

  const allAnsweredButOnePending = assessInterviewCoverage({
    questionsScored: 6,
    questionsRequired: 7,
    pendingEvaluations: 0,
  });
  assert.equal(allAnsweredButOnePending.complete, false, "an unanswered original blocks the final score");

  // Unknown coverage is NOT completeness — an unverified interview can
  // never support a verified category.
  const unknown = assessInterviewCoverage(null);
  assert.equal(unknown.complete, false);
  assert.ok(
    (unknown.provisionalNote ?? "").includes("unverified"),
    `unknown coverage note: ${unknown.provisionalNote}`,
  );
  const unknown2 = assessInterviewCoverage(undefined);
  assert.equal(unknown2.complete, false);
});

test("classification rule version is stamped on every computed profile", () => {
  assert.equal(CLASSIFICATION_RULE_VERSION, "provisional-vs-verified-v3");
  const result = computeCompetencyProfile(fullScores("backend-developer", 80, 60, 100));
  assert.equal(result.classificationRuleVersion, CLASSIFICATION_RULE_VERSION);
});

// ── Incomplete interview → no verified category ──────────────────────────

test("incomplete interview (one question pending) → no verified category, provisional score with coverage", () => {
  // Interview scores exist (mean over 6 scored questions), but Q7 is
  // still pending evaluation — the interview is not complete.
  const result = computeCompetencyProfile(
    fullScores("backend-developer", 85, 75, 90, 2, {
      questionsScored: 6,
      questionsRequired: 7,
      pendingEvaluations: 1,
    }),
  );
  // Blend over all present sources: 85*0.5 + 75*0.3 + 90*0.2 = 83.
  assert.equal(result.overallScore, 83);
  assert.equal(result.provisionalScore, 83);
  assert.equal(result.provisionalCategory, "L4");
  assert.equal(result.status, "Incomplete");
  assert.equal(result.statusLabel, "Assessment Incomplete");
  assert.equal(result.verifiedCategory, null);
  assert.equal(result.overallCategory, null);
  assert.equal(result.interviewCoverage?.complete, false);
  assert.equal(
    result.interviewCoverage?.provisionalNote,
    "provisional — 6 of 7 questions scored",
  );
  assert.ok(
    result.notes.some((n) => n.includes("6 of 7 questions scored")),
    `notes must state the coverage: ${result.notes.join(" | ")}`,
  );
  // Per-question scores are still displayable when scored — the gate
  // is on the FINAL category, not on the scored questions.
  assert.equal(PARTIAL_INTERVIEW_POLICY.perQuestionScoresDisplayable, true);
});

test("interview coverage unknown (scores present, no coverage supplied) → no verified category", () => {
  const result = computeCompetencyProfile(fullScores("backend-developer", 85, 75, 90, 2, null));
  assert.equal(result.overallScore, 83);
  assert.equal(result.status, "Incomplete");
  assert.equal(result.verifiedCategory, null);
  assert.equal(result.overallCategory, null);
  assert.ok(
    (result.interviewCoverage?.provisionalNote ?? "").includes("unverified"),
    "the gap must be named, not silently absorbed",
  );
});

// ── Insufficient evidence → no verified L3/L4 even with a high number ───

test("insufficient evidence → no verified L3/L4 even with a high provisional number", () => {
  // Four competencies score 90/90/90; the fifth has only 1 of 2
  // required evidence items. The blend over the four scored is 90.
  const input = fullScores("backend-developer", 90, 90, 90);
  input.competencies[4].evidenceCount = 1;
  const result = computeCompetencyProfile(input);
  assert.equal(result.status, "Insufficient Evidence");
  assert.equal(result.overallScore, 90);
  assert.equal(result.provisionalScore, 90);
  assert.equal(result.provisionalCategory, "L4");
  assert.equal(result.overallCategory, null);
  assert.equal(result.verifiedCategory, null);
  assert.equal(result.competencies[4].status, "Insufficient Evidence");
  assert.equal(result.competencies[4].score, null);
  assert.equal(result.competencies[4].verifiedCategory, null);
});

// ── Practical threshold not met → capped + that status ───────────────────

test("practical threshold not met → capped provisional L2 + that status, no verified category", () => {
  // Raw blend 30*0.5 + 90*0.3 + 90*0.2 = 60 (would be L3 Job Ready).
  const result = computeCompetencyProfile(fullScores("ai-ml-engineer", 30, 90, 90));
  assert.equal(result.overallScore, 60);
  assert.equal(result.provisionalScore, 60);
  assert.equal(result.provisionalCategory, "L2", "provisional band is capped at L2");
  assert.equal(result.status, "Practical Threshold Not Met");
  assert.equal(result.verifiedCategory, null, "not even the capped L2 is verified");
  assert.equal(result.overallCategory, null);
});

// ── All sources complete + minimums met → verified category ─────────────

test("all sources complete + minimums met → verified category assigned", () => {
  const result = computeCompetencyProfile(fullScores("backend-developer", 80, 60, 100));
  assert.equal(result.status, "Complete");
  assert.equal(result.overallScore, 78);
  assert.equal(result.provisionalScore, 78);
  assert.equal(result.provisionalCategory, "L3");
  assert.equal(result.verifiedCategory, "L3");
  assert.equal(result.overallCategory, "L3");
  assert.equal(result.overallCategoryLabel, "Job Ready");
  assert.equal(result.interviewCoverage?.complete, true);
  for (const c of result.competencies) {
    assert.equal(c.status, "Assessed");
    assert.equal(c.verifiedCategory, c.category);
  }
});

test("verified category follows the band exactly at the L3/L4 boundary", () => {
  // 80/80/80 → 80 → L4 Strong, verified.
  const strong = computeCompetencyProfile(fullScores("python-developer", 80, 80, 80));
  assert.equal(strong.verifiedCategory, "L4");
  // 79/79/79 → 79 → L3 Job Ready, verified.
  const ready = computeCompetencyProfile(fullScores("python-developer", 79, 79, 79));
  assert.equal(ready.verifiedCategory, "L3");
});

// ── The gate itself: each mandatory condition blocks verification ────────

test("evaluateVerifiedCategory: any single failing condition → null", () => {
  const allOk = {
    sourcesComplete: true,
    practicalMinimumMet: true,
    interviewComplete: true,
    hasScore: true,
    qualitativeReviewPassed: true,
  };
  assert.equal(evaluateVerifiedCategory(allOk, "L3"), "L3");
  assert.equal(evaluateVerifiedCategory({ ...allOk, sourcesComplete: false }, "L3"), null);
  assert.equal(evaluateVerifiedCategory({ ...allOk, practicalMinimumMet: false }, "L3"), null);
  assert.equal(evaluateVerifiedCategory({ ...allOk, interviewComplete: false }, "L3"), null);
  assert.equal(evaluateVerifiedCategory({ ...allOk, hasScore: false }, "L3"), null);
  assert.equal(evaluateVerifiedCategory({ ...allOk, qualitativeReviewPassed: false }, "L3"), null);
  assert.equal(evaluateVerifiedCategory(allOk, null), null, "no score → no category");
});

test("profileStatusLabel: stored Incomplete displays as Assessment Incomplete; nothing assessed displays as Not Assessed", () => {
  assert.equal(profileStatusLabel("Complete", true), "Complete");
  assert.equal(profileStatusLabel("Incomplete", true), "Assessment Incomplete");
  assert.equal(profileStatusLabel("Incomplete", false), "Not Assessed");
  assert.equal(profileStatusLabel("Insufficient Evidence", true), "Insufficient Evidence");
  assert.equal(profileStatusLabel("Practical Threshold Not Met", true), "Practical Threshold Not Met");
});

// ── Not Assessed is strictly separate from zero ──────────────────────────

test("Not Assessed stays null, never 0 — at profile and competency level", () => {
  const result = computeCompetencyProfile({
    roleId: "backend-developer",
    frameworkVersion: V1,
    competencies: [],
  });
  assert.equal(result.overallScore, null);
  assert.notEqual(result.overallScore, 0, "null is not 0");
  assert.equal(result.provisionalScore, null);
  assert.equal(result.provisionalCategory, null);
  assert.equal(result.verifiedCategory, null);
  assert.equal(result.statusLabel, "Not Assessed");
  for (const c of result.competencies) {
    assert.equal(c.score, null);
    assert.equal(c.category, null);
    assert.equal(c.verifiedCategory, null);
    assert.equal(c.status, "Not Assessed");
  }
});

// ── Per-competency verified categories ────────────────────────────────────

test("per-competency verified category: Incomplete competency has none; Assessed competency has one", () => {
  const input = fullScores("python-developer", 80, 60, 100);
  // Drop the evidence source from the first competency only.
  delete (input.competencies[0] as { evidenceScore?: number }).evidenceScore;
  const result = computeCompetencyProfile(input);
  const partial = result.competencies[0];
  assert.equal(partial.status, "Incomplete");
  assert.equal(partial.score, 72.5, "(80*0.5 + 60*0.3) / 0.8");
  assert.equal(partial.category, "L3", "provisional band still shown");
  assert.equal(partial.verifiedCategory, null);
  const full = result.competencies[1];
  assert.equal(full.status, "Assessed");
  assert.equal(full.verifiedCategory, "L3");
  // The profile as a whole is not verified either.
  assert.equal(result.verifiedCategory, null);
  assert.equal(result.status, "Incomplete");
});

// ── No silent renormalisation into a verified score ──────────────────────

test("no silent renormalisation: missing interview component never verifies, even at 100 coding+evidence", () => {
  const input = fullScores("backend-developer", 100, 100, 100);
  for (const c of input.competencies) {
    delete (c as { interviewScore?: number }).interviewScore;
  }
  const result = computeCompetencyProfile(input);
  // (100*0.5 + 100*0.2) / 0.7 = 100 — a perfect provisional number.
  assert.equal(result.overallScore, 100);
  assert.equal(result.provisionalCategory, "L4");
  assert.equal(result.status, "Incomplete");
  assert.equal(result.verifiedCategory, null);
  assert.equal(result.overallCategory, null);
  assert.equal(result.componentScores.interview, null);
});

// ── Determinism of the new fields ────────────────────────────────────────

test("repeated calculation reproduces the new fields identically", () => {
  const input = fullScores("software-development-engineer", 72, 65, 88);
  const a = computeCompetencyProfile(input);
  const b = computeCompetencyProfile(input);
  assert.deepEqual(a, b);
  assert.equal(JSON.stringify(a), JSON.stringify(b));
  assert.equal(a.verifiedCategory, "L3");
  assert.equal(a.provisionalScore, a.overallScore);
});

// ── Phase 2 (G2.1 + G4.4): per-competency verified categories ─────────────

test("G2.1: 6/7 interview with high-scoring competencies → every per-competency verified category is null", () => {
  // All three sources present for every competency, scores high — the
  // ONLY gap is the interview: 6 of 7 questions scored. The old code
  // set per-competency verifiedCategory on local conditions only, so
  // a 6/7 interview still rendered "Strong (Verified)" per
  // competency. Now the profile-level interview gate nulls them all.
  const result = computeCompetencyProfile(
    fullScores("backend-developer", 85, 90, 90, 2, {
      questionsScored: 6,
      questionsRequired: 7,
      pendingEvaluations: 1,
    }),
  );
  assert.equal(result.status, "Incomplete");
  assert.equal(result.verifiedCategory, null);
  for (const c of result.competencies) {
    assert.equal(c.status, "Assessed", "locally complete — the gap is the interview, not the competency");
    assert.equal(c.score, 87.5);
    assert.equal(c.category, "L4", "provisional band still shown");
    assert.equal(c.verifiedCategory, null, "6/7 interview must not verify any competency");
    assert.equal(c.verifiedCategoryLabel, null);
  }
});

test("G4.4: a competency with 1 of 2 questions scored keeps its provisional interview mean but is not Assessed", () => {
  // The interview as a whole is complete (7/7), but the first
  // competency's own questions are only half scored: its interview
  // score is the mean over the 1 scored question (85), not over the
  // 2 required. That mean must not make the competency Assessed.
  const input = fullScores("backend-developer", 80, 85, 90);
  for (const c of input.competencies) {
    c.interviewQuestionsScored = 1;
    c.interviewQuestionsRequired = 1;
  }
  input.competencies[0].interviewQuestionsScored = 1;
  input.competencies[0].interviewQuestionsRequired = 2;
  const result = computeCompetencyProfile(input);
  const partial = result.competencies[0];
  assert.equal(partial.interviewScore, 85, "the scored-question mean stays visible as provisional");
  assert.equal(partial.interviewQuestionsScored, 1);
  assert.equal(partial.interviewQuestionsRequired, 2);
  assert.equal(partial.status, "Incomplete", "1-of-2 questions scored does not make the competency Assessed");
  assert.equal(partial.verifiedCategory, null);
  assert.ok(
    partial.notes.some((n) => n.includes("1 of 2 interview question(s) scored")),
    `the gap must be named: ${partial.notes.join(" | ")}`,
  );
  // The other competencies are fully scored per-competency and keep
  // their verified categories; the profile as a whole is not verified
  // because one competency is Incomplete.
  for (const c of result.competencies.slice(1)) {
    assert.equal(c.status, "Assessed");
    assert.equal(c.verifiedCategory, c.category);
  }
  assert.equal(result.status, "Incomplete");
  assert.equal(result.verifiedCategory, null);
});

test("G4.4: per-competency coverage unknown (no per-question detail) leaves status to the profile-level gate", () => {
  // No interviewQuestions* fields at all: the competency stays
  // Assessed on its sources, but with a 6/7 interview the verified
  // category is still null via the profile-level gate.
  const result = computeCompetencyProfile(
    fullScores("backend-developer", 85, 90, 90, 2, {
      questionsScored: 6,
      questionsRequired: 7,
      pendingEvaluations: 1,
    }),
  );
  for (const c of result.competencies) {
    assert.equal(c.interviewQuestionsScored, null);
    assert.equal(c.interviewQuestionsRequired, null);
    assert.equal(c.status, "Assessed");
    assert.equal(c.verifiedCategory, null);
  }
});

// ── Phase 2 (G2.4): failed qualitative review blocks verification ────────

test("G2.4: qualitativeMethod 'failed' blocks verification and records the failed leg", () => {
  const input = fullScores("backend-developer", 80, 60, 100);
  const result = computeCompetencyProfile({ ...input, qualitativeMethod: "failed" });
  // Sources are complete — the status stays Complete — but nothing
  // verifies: the coding overall was renormalised over the verified
  // dimensions only.
  assert.equal(result.status, "Complete");
  assert.equal(result.verifiedCategory, null);
  assert.equal(result.overallCategory, null);
  assert.equal(result.qualitativeMethod, "failed");
  for (const c of result.competencies) {
    assert.equal(c.status, "Assessed");
    assert.equal(c.verifiedCategory, null, "a failed qualitative leg must not verify a competency either");
  }
  assert.ok(
    result.notes.some((n) => n.includes("Human review required")),
    `the profile must note the human review: ${result.notes.join(" | ")}`,
  );
  // Control: the same inputs with a successful review verify.
  const ok = computeCompetencyProfile({ ...input, qualitativeMethod: "live-ai" });
  assert.equal(ok.verifiedCategory, "L3");
  assert.equal(ok.qualitativeMethod, "live-ai");
  const heuristic = computeCompetencyProfile({ ...input, qualitativeMethod: "deterministic-heuristic" });
  assert.equal(heuristic.verifiedCategory, "L3", "heuristic basis does not block verification");
});

// ── Phase 2 (G4.1): evidence composition ──────────────────────────────────

test("G4.1: evidence from coding items alone is Insufficient Evidence, not Assessed", () => {
  const fw = getFramework(V1);
  const role = fw.roles.find((r) => r.roleId === "backend-developer")!;
  const input: CompetencyProfileInput = {
    roleId: "backend-developer",
    frameworkVersion: V1,
    competencies: role.competencies.map((c) => ({
      competencyId: c.id,
      codingScore: 80,
      interviewScore: 80,
      evidenceScore: 80,
      codingEvidenceIds: ["ev-1", "ev-2"],
      evidenceIds: ["ev-1"],
    })),
    interviewCoverage: FULL_COVERAGE,
  };
  const result = computeCompetencyProfile(input);
  // 2 distinct items (the count is met) but both are coding-sourced:
  // the framework requires one coding task AND one project or
  // interview answer.
  for (const c of result.competencies) {
    assert.equal(c.evidenceProvided, 2);
    assert.equal(c.status, "Insufficient Evidence");
    assert.equal(c.score, null);
    assert.equal(c.verifiedCategory, null);
    assert.ok(
      c.notes.some((n) => n.includes("more than one kind")),
      `composition gap must be named: ${c.notes.join(" | ")}`,
    );
  }
  assert.equal(result.status, "Insufficient Evidence");
  assert.equal(result.verifiedCategory, null);
});

test("G4.1: one coding item + one non-coding item satisfies the composition rule", () => {
  const fw = getFramework(V1);
  const role = fw.roles.find((r) => r.roleId === "backend-developer")!;
  const input: CompetencyProfileInput = {
    roleId: "backend-developer",
    frameworkVersion: V1,
    competencies: role.competencies.map((c) => ({
      competencyId: c.id,
      codingScore: 80,
      interviewScore: 80,
      evidenceScore: 80,
      codingEvidenceIds: ["ev-1"],
      evidenceIds: ["ev-1", "project-1"],
    })),
    interviewCoverage: FULL_COVERAGE,
  };
  const result = computeCompetencyProfile(input);
  assert.equal(result.status, "Complete");
  assert.equal(result.verifiedCategory, "L4");
  for (const c of result.competencies) {
    assert.equal(c.status, "Assessed");
    assert.equal(c.verifiedCategory, "L4");
  }
});

test("G4.1: non-coding items alone (no coding-task item) are Insufficient Evidence", () => {
  const fw = getFramework(V1);
  const role = fw.roles.find((r) => r.roleId === "backend-developer")!;
  const input: CompetencyProfileInput = {
    roleId: "backend-developer",
    frameworkVersion: V1,
    competencies: role.competencies.map((c) => ({
      competencyId: c.id,
      codingScore: 80,
      interviewScore: 80,
      evidenceScore: 80,
      codingEvidenceIds: [],
      evidenceIds: ["project-1", "project-2"],
    })),
    interviewCoverage: FULL_COVERAGE,
  };
  const result = computeCompetencyProfile(input);
  for (const c of result.competencies) {
    assert.equal(c.status, "Insufficient Evidence");
    assert.equal(c.score, null);
  }
  assert.equal(result.verifiedCategory, null);
});

test("G4.1: count-only fallback when no evidence ids are supplied at all", () => {
  // The composition rule needs item types; a caller that supplies
  // only a count cannot be checked, so the count rule applies (see
  // docs/SCORING_METHODOLOGY.md §5). This is the pre-existing
  // fullScores shape — it must keep verifying.
  const result = computeCompetencyProfile(fullScores("backend-developer", 80, 60, 100));
  assert.equal(result.status, "Complete");
  assert.equal(result.verifiedCategory, "L3");
});

// ── Phase 2 (G4.2): below-minimum coding on score-null competencies ──────

test("G4.2: below-minimum coding on an Insufficient Evidence competency is listed, not silently averaged away", () => {
  const input = fullScores("backend-developer", 80, 80, 80);
  // One competency: coding 30 (below the 40 minimum) AND only 1 of 2
  // evidence items → score null, so its coding score never reaches
  // the component average.
  input.competencies[4].codingScore = 30;
  input.competencies[4].evidenceCount = 1;
  const result = computeCompetencyProfile(input);
  assert.equal(result.competencies[4].status, "Insufficient Evidence");
  assert.equal(result.competencies[4].score, null);
  assert.equal(result.competencies[4].codingScore, 30);
  // The component average covers the four scored competencies only:
  // coding 80, not dragged down by the hidden 30 — and the flag says so.
  assert.equal(result.componentScores.coding, 80);
  assert.equal(result.practicalMinimumFailures.length, 1);
  assert.deepEqual(result.practicalMinimumFailures[0], {
    competencyId: "be-system-design",
    competencyName: "System Design & Scalability",
    codingScore: 30,
  });
  assert.ok(
    result.notes.some((n) => n.includes("System Design & Scalability (30)")),
    `the hidden failure must be noted: ${result.notes.join(" | ")}`,
  );
  assert.equal(result.status, "Insufficient Evidence");
});

test("G4.2: no failures → empty flag list", () => {
  const result = computeCompetencyProfile(fullScores("backend-developer", 80, 60, 100));
  assert.deepEqual(result.practicalMinimumFailures, []);
  assert.equal(result.componentScores.coding, 80);
});

// ── Phase 2 (G4.3): confidence ────────────────────────────────────────────

test("G4.3: Incomplete below 100% coverage is low confidence, not medium", () => {
  // 4 of 5 competencies assessed (80% coverage), one Not Assessed.
  const input = fullScores("data-scientist", 80, 70, 90);
  input.competencies = input.competencies.slice(0, 4);
  const result = computeCompetencyProfile(input);
  assert.equal(result.status, "Incomplete");
  assert.equal(result.evidenceCoveragePercent, 80);
  assert.equal(result.confidence, "low", "an Incomplete profile at 80% coverage must not read as medium confidence");
});

test("G4.3: Incomplete at 100% coverage is medium; Practical Threshold Not Met at 100% is medium", () => {
  // Every competency scored but a source missing → Incomplete, 100%.
  const missingEvidence = fullScores("python-developer", 80, 60, 100);
  for (const c of missingEvidence.competencies) {
    delete (c as { evidenceScore?: number }).evidenceScore;
  }
  const incomplete = computeCompetencyProfile(missingEvidence);
  assert.equal(incomplete.status, "Incomplete");
  assert.equal(incomplete.evidenceCoveragePercent, 100);
  assert.equal(incomplete.confidence, "medium");

  // Practical minimum failed but everything assessed → 100%.
  const threshold = computeCompetencyProfile(fullScores("ai-ml-engineer", 30, 90, 90));
  assert.equal(threshold.status, "Practical Threshold Not Met");
  assert.equal(threshold.evidenceCoveragePercent, 100);
  assert.equal(threshold.confidence, "medium");
});
