import test from "node:test";
import assert from "node:assert/strict";

// Phase B — deterministic competency scoring. Pure functions only:
// no DB, no Redis, no LLM. Every expectation below is hand-computed.
import {
  categoryForScore,
  computeCompetencyProfile,
  getFramework,
  listFrameworkVersions,
  registerFramework,
  validateFramework,
} from "../src/services/competencyScoringService";
import { COMPETENCY_FRAMEWORK_V1 } from "../src/config/competencyFramework";
import type {
  CompetencyEvidenceInput,
  CompetencyFramework,
  CompetencyProfileInput,
} from "../src/services/competencyScoringService";

const V1 = COMPETENCY_FRAMEWORK_V1.version;

function fullScores(
  roleId: string,
  coding: number,
  interview: number,
  evidence: number,
  evidenceCount = 2,
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
    // The 7-question interview fully evaluated (see
    // PARTIAL_INTERVIEW_POLICY): without complete coverage no profile
    // in these tests could ever earn a verified category.
    interviewCoverage: { questionsScored: 7, questionsRequired: 7, pendingEvaluations: 0 },
  };
}

function cloneFramework(): CompetencyFramework {
  return JSON.parse(JSON.stringify(COMPETENCY_FRAMEWORK_V1)) as CompetencyFramework;
}

// ── Framework shape ───────────────────────────────────────────────────────

test("framework v1: 7 distinct roles, each with its own competencies", () => {
  const fw = getFramework(V1);
  assert.equal(fw.roles.length, 7);
  const roleIds = fw.roles.map((r) => r.roleId).sort();
  assert.deepEqual(roleIds, [
    "ai-ml-engineer",
    "backend-developer",
    "data-scientist",
    "frontend-developer",
    "full-stack-developer",
    "python-developer",
    "software-development-engineer",
  ]);
  // No two roles share the same competency set (no copy-paste framework).
  const sets = fw.roles.map((r) => r.competencies.map((c) => c.id).sort().join("|"));
  assert.equal(new Set(sets).size, 7);
  for (const role of fw.roles) {
    assert.equal(role.competencies.length, 5);
  }
});

test("framework v1: every role's weights sum to exactly 100", () => {
  const fw = getFramework(V1);
  for (const role of fw.roles) {
    const sum = role.competencies.reduce((s, c) => s + c.weight, 0);
    assert.equal(sum, 100, `role ${role.roleId} weights sum to ${sum}`);
  }
});

test("framework v1: categories cover 0–100 with descriptions, thresholds not hardcoded in scoring", () => {
  const fw = getFramework(V1);
  assert.deepEqual(
    fw.categories.map((c) => [c.id, c.min, c.max]),
    [
      ["L1", 0, 39],
      ["L2", 40, 59],
      ["L3", 60, 79],
      ["L4", 80, 100],
    ],
  );
  for (const c of fw.categories) {
    assert.ok(c.description.length > 20, `category ${c.id} needs a description`);
  }
  // Scoring reads the categories from the framework object: a framework
  // with shifted thresholds must shift the category for the same score.
  const shifted = cloneFramework();
  shifted.version = "v-test-shifted";
  shifted.categories = [
    { id: "L1", label: "Foundation", min: 0, max: 49, description: "shifted L1" },
    { id: "L2", label: "Developing", min: 50, max: 69, description: "shifted L2" },
    { id: "L3", label: "Job Ready", min: 70, max: 89, description: "shifted L3" },
    { id: "L4", label: "Strong", min: 90, max: 100, description: "shifted L4" },
  ];
  registerFramework(shifted);
  assert.equal(categoryForScore(45, shifted).id, "L1");
  assert.equal(categoryForScore(45).id, "L2"); // v1 unchanged
});

test("validateFramework fails loudly when role weights do not sum to 100", () => {
  const bad = cloneFramework();
  bad.version = "v-test-bad-weights";
  bad.roles[0].competencies[0].weight = 26; // 101 total
  assert.throws(() => validateFramework(bad), /weights sum to 101, not 100/);
  assert.throws(() => registerFramework(bad), /weights sum to 101, not 100/);
});

// ── Category boundaries ───────────────────────────────────────────────────

test("category boundaries: exactly 39/40/59/60/79/80/100", () => {
  assert.equal(categoryForScore(0).id, "L1");
  assert.equal(categoryForScore(39).id, "L1");
  assert.equal(categoryForScore(40).id, "L2");
  assert.equal(categoryForScore(59).id, "L2");
  assert.equal(categoryForScore(60).id, "L3");
  assert.equal(categoryForScore(79).id, "L3");
  assert.equal(categoryForScore(80).id, "L4");
  assert.equal(categoryForScore(100).id, "L4");
  assert.equal(categoryForScore(39).label, "Foundation");
  assert.equal(categoryForScore(60).label, "Job Ready");
  assert.equal(categoryForScore(80).label, "Strong");
});

// ── Overall formula S = C*0.50 + I*0.30 + E*0.20 ──────────────────────────

test("overall score uses S = C*0.50 + I*0.30 + E*0.20 (hand-computed 78)", () => {
  // Per competency: 80*0.5 + 60*0.3 + 100*0.2 = 40 + 18 + 20 = 78.
  const result = computeCompetencyProfile(fullScores("backend-developer", 80, 60, 100));
  assert.equal(result.overallScore, 78);
  assert.deepEqual(result.componentScores, { coding: 80, interview: 60, evidence: 100 });
  assert.equal(result.overallCategory, "L3");
  assert.equal(result.overallCategoryLabel, "Job Ready");
  // All mandatory conditions hold here, so the provisional band IS the
  // verified category — and the two agree exactly.
  assert.equal(result.provisionalScore, 78);
  assert.equal(result.provisionalCategory, "L3");
  assert.equal(result.verifiedCategory, "L3");
  assert.equal(result.verifiedCategoryLabel, "Job Ready");
  assert.equal(result.statusLabel, "Complete");
  assert.equal(result.classificationRuleVersion, "provisional-vs-verified-v3");
  assert.equal(result.interviewCoverage?.complete, true);
  assert.equal(result.status, "Complete");
  assert.equal(result.confidence, "high");
  assert.equal(result.evidenceCoveragePercent, 100);
  for (const c of result.competencies) {
    assert.equal(c.score, 78);
    assert.equal(c.category, "L3");
    assert.equal(c.verifiedCategory, "L3", "fully assessed competency has a verified category");
    assert.equal(c.status, "Assessed");
  }
});

test("weight calculation: 70/30 weighted competencies give 70, not the plain mean", () => {
  const fw = cloneFramework();
  fw.version = "v-test-weights";
  fw.roles = [
    {
      roleId: "test-role",
      roleName: "Test Role",
      competencies: [testComp("t-a", 70), testComp("t-b", 30)],
    },
  ];
  registerFramework(fw);
  const result = computeCompetencyProfile({
    roleId: "test-role",
    frameworkVersion: "v-test-weights",
    competencies: [
      { competencyId: "t-a", codingScore: 100, interviewScore: 100, evidenceScore: 100, evidenceCount: 1 },
      { competencyId: "t-b", codingScore: 0, interviewScore: 0, evidenceScore: 0, evidenceCount: 1 },
    ],
    interviewCoverage: { questionsScored: 7, questionsRequired: 7, pendingEvaluations: 0 },
  });
  // 100*0.7 + 0*0.3 = 70 (a plain mean would give 50).
  assert.equal(result.overallScore, 70);
  assert.equal(result.overallCategory, "L3");
  assert.equal(result.verifiedCategory, "L3");
});

// ── Missing source / insufficient evidence / not assessed ─────────────────

test("missing source: coding+interview only -> Incomplete, renormalised, never a silent zero", () => {
  const input = fullScores("python-developer", 80, 60, 100);
  // Drop the evidence source from every competency.
  for (const c of input.competencies) delete (c as CompetencyEvidenceInput).evidenceScore;
  const result = computeCompetencyProfile(input);
  // (80*0.5 + 60*0.3) / 0.8 = 58/0.8 = 72.5 — evidence is NOT scored as 0.
  assert.equal(result.overallScore, 72.5);
  assert.equal(result.status, "Incomplete");
  assert.equal(result.statusLabel, "Assessment Incomplete");
  // P0 fix: the renormalised 72.5 stays visible as a PROVISIONAL score,
  // but it is NOT a verified L3 — a missing source means no verified
  // category, however high the provisional number is.
  assert.equal(result.provisionalScore, 72.5);
  assert.equal(result.provisionalCategory, "L3");
  assert.equal(result.overallCategory, null);
  assert.equal(result.overallCategoryLabel, null);
  assert.equal(result.verifiedCategory, null);
  assert.equal(result.verifiedCategoryLabel, null);
  for (const c of result.competencies) {
    assert.equal(c.score, 72.5);
    assert.equal(c.status, "Incomplete");
    assert.equal(c.category, "L3", "per-competency band stays provisional");
    assert.equal(c.verifiedCategory, null, "incomplete competency has no verified category");
    assert.deepEqual(c.sourcesMissing, ["evidence"]);
  }
});

test("insufficient evidence: fewer items than required -> score null, never fabricated", () => {
  const input = fullScores("frontend-developer", 90, 90, 90, 1); // min is 2
  const result = computeCompetencyProfile(input);
  assert.equal(result.status, "Insufficient Evidence");
  assert.equal(result.overallScore, null);
  assert.equal(result.overallCategory, null);
  assert.equal(result.provisionalScore, null);
  assert.equal(result.provisionalCategory, null);
  assert.equal(result.verifiedCategory, null);
  assert.equal(result.confidence, "low");
  for (const c of result.competencies) {
    assert.equal(c.score, null);
    assert.equal(c.category, null);
    assert.equal(c.verifiedCategory, null);
    assert.equal(c.status, "Insufficient Evidence");
    assert.equal(c.evidenceProvided, 1);
    assert.equal(c.evidenceRequired, 2);
  }
});

test("skill not assessed: omitted competency -> Not Assessed with null score/category", () => {
  const input = fullScores("data-scientist", 80, 70, 90);
  input.competencies = input.competencies.slice(0, 4); // drop the 5th
  const result = computeCompetencyProfile(input);
  assert.equal(result.competencies.length, 5);
  const missing = result.competencies[4];
  assert.equal(missing.status, "Not Assessed");
  assert.equal(missing.score, null);
  assert.equal(missing.category, null);
  assert.equal(result.status, "Incomplete");
  assert.equal(result.statusLabel, "Assessment Incomplete");
  assert.equal(result.evidenceCoveragePercent, 80);
  // The other four still score: 80*0.5+70*0.3+90*0.2 = 79.
  assert.equal(result.overallScore, 79);
  // P0 fix: 79 is provisional only — one competency was never assessed,
  // so there is no verified L3.
  assert.equal(result.provisionalScore, 79);
  assert.equal(result.provisionalCategory, "L3");
  assert.equal(result.overallCategory, null);
  assert.equal(result.verifiedCategory, null);
});

test("no evidence at all -> overall null, Incomplete, low confidence", () => {
  const result = computeCompetencyProfile({
    roleId: "backend-developer",
    frameworkVersion: V1,
    competencies: [],
  });
  assert.equal(result.overallScore, null);
  assert.equal(result.overallCategory, null);
  assert.equal(result.provisionalScore, null, "Not Assessed is null, never a silent 0");
  assert.equal(result.provisionalCategory, null);
  assert.equal(result.verifiedCategory, null);
  assert.equal(result.status, "Incomplete");
  assert.equal(result.statusLabel, "Not Assessed", "no source at all displays as Not Assessed");
  assert.equal(result.evidenceCoveragePercent, 0);
  assert.equal(result.confidence, "low");
  assert.ok(result.competencies.every((c) => c.status === "Not Assessed"));
});

// ── Practical-task minimum ────────────────────────────────────────────────

test("practical minimum: coding 30 blocks Job Ready/Strong -> Practical Threshold Not Met, capped at L2", () => {
  // Raw blend would be 30*0.5 + 90*0.3 + 90*0.2 = 60 (L3 Job Ready).
  const result = computeCompetencyProfile(fullScores("ai-ml-engineer", 30, 90, 90));
  assert.equal(result.componentScores.coding, 30);
  assert.equal(result.overallScore, 60);
  assert.equal(result.status, "Practical Threshold Not Met");
  assert.equal(result.statusLabel, "Practical Threshold Not Met");
  // P0 fix: the blend is still visible as a provisional figure, capped
  // at L2 — but the practical minimum failed, so there is NO verified
  // category (not even the capped L2).
  assert.equal(result.provisionalScore, 60);
  assert.equal(result.provisionalCategory, "L2");
  assert.equal(result.provisionalCategoryLabel, "Developing");
  assert.equal(result.overallCategory, null);
  assert.equal(result.verifiedCategory, null);
});

test("practical minimum: coding exactly 40 passes (boundary)", () => {
  const result = computeCompetencyProfile(fullScores("ai-ml-engineer", 40, 90, 90));
  assert.equal(result.status, "Complete");
  assert.equal(result.overallScore, 65);
  assert.equal(result.overallCategory, "L3");
  assert.equal(result.verifiedCategory, "L3", "minimum met + all sources complete → verified");
});

test("practical minimum is configurable per computation", () => {
  const result = computeCompetencyProfile({
    ...fullScores("ai-ml-engineer", 30, 90, 90),
    practicalMinimumCodingScore: 25,
  });
  assert.equal(result.status, "Complete");
  assert.equal(result.overallCategory, "L3");
  assert.equal(result.verifiedCategory, "L3");
  assert.equal(result.frameworkSnapshot.practicalMinimumCodingScore, 25);
});

// ── No double-counting ────────────────────────────────────────────────────

test("no double-counting: one evidence id in both sources is counted once", () => {
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
      evidenceIds: ["ev-1", "ev-3"],
    })),
    interviewCoverage: { questionsScored: 7, questionsRequired: 7, pendingEvaluations: 0 },
  };
  const result = computeCompetencyProfile(input);
  for (const c of result.competencies) {
    // Unique ids are ev-1, ev-2, ev-3 = 3, not 4.
    assert.equal(c.evidenceProvided, 3);
    assert.deepEqual(c.dedupedEvidenceIds, ["ev-1"]);
    assert.equal(c.evidenceCoveragePercent, 100);
    assert.equal(c.status, "Assessed");
  }
  assert.equal(result.status, "Complete");
});

// ── Versioning & determinism ──────────────────────────────────────────────

test("framework version change leaves a historical result unchanged", () => {
  const input = fullScores("backend-developer", 90, 50, 70);
  // Make the two backend competencies score differently so weights matter.
  input.competencies[0].codingScore = 100;
  input.competencies[1].codingScore = 0;
  const before = computeCompetencyProfile(input);
  assert.equal(before.frameworkVersion, V1);

  // Ship v2 with different weights for the same role.
  const v2 = cloneFramework();
  v2.version = "v2.0.0";
  const be = v2.roles.find((r) => r.roleId === "backend-developer")!;
  be.competencies[0].weight = 30;
  be.competencies[1].weight = 20;
  registerFramework(v2);
  assert.ok(listFrameworkVersions().includes("v2.0.0"));

  const withV2 = computeCompetencyProfile({ ...input, frameworkVersion: "v2.0.0" });
  assert.notEqual(withV2.overallScore, before.overallScore);
  assert.equal(withV2.frameworkVersion, "v2.0.0");

  // Recomputing the historical input under v1 reproduces it exactly.
  const replay = computeCompetencyProfile(input);
  assert.deepEqual(replay, before);
  assert.equal(replay.frameworkSnapshot.version, V1);
  assert.deepEqual(replay.frameworkSnapshot.categories, COMPETENCY_FRAMEWORK_V1.categories);
});

test("repeated calculation is identical (deterministic)", () => {
  const input = fullScores("software-development-engineer", 72, 65, 88);
  const a = computeCompetencyProfile(input);
  const b = computeCompetencyProfile(input);
  assert.deepEqual(a, b);
  assert.equal(JSON.stringify(a), JSON.stringify(b));
});

// ── Fail-loud inputs ──────────────────────────────────────────────────────

test("unknown role, version, competency, and out-of-range scores throw", () => {
  assert.throws(
    () => computeCompetencyProfile({ roleId: "nope", competencies: [] }),
    /unknown role "nope"/,
  );
  assert.throws(
    () =>
      computeCompetencyProfile({
        roleId: "backend-developer",
        frameworkVersion: "v9.9.9",
        competencies: [],
      }),
    /unknown version "v9.9.9"/,
  );
  assert.throws(
    () =>
      computeCompetencyProfile({
        roleId: "backend-developer",
        competencies: [{ competencyId: "nope", codingScore: 50, evidenceCount: 2 }],
      }),
    /unknown competency "nope"/,
  );
  assert.throws(
    () => computeCompetencyProfile(fullScores("backend-developer", 101, 50, 50)),
    /must be a number 0–100/,
  );
  assert.throws(
    () =>
      computeCompetencyProfile({
        roleId: "backend-developer",
        competencies: [
          { competencyId: "be-api-design", codingScore: 50, evidenceCount: 2 },
          { competencyId: "be-api-design", codingScore: 60, evidenceCount: 2 },
        ],
      }),
    /duplicate entry/,
  );
  assert.throws(() => categoryForScore(-1), /must be a number 0–100/);
  assert.throws(() => getFramework("v0.0.0"), /unknown version/);
});

// ── Helpers ───────────────────────────────────────────────────────────────

function testComp(id: string, weight: number) {
  return {
    id,
    name: `Test ${id}`,
    description: "Test-only competency.",
    skills: ["Testing"],
    difficulty: "Foundation" as const,
    evidenceTypes: ["coding-task"],
    codingTaskMapping: "Test task.",
    interviewQuestionMapping: "Test question.",
    rubric: {
      L1: "L1 test.",
      L2: "L2 test.",
      L3: "L3 test.",
      L4: "L4 test.",
    },
    weight,
    minEvidence: 1,
    minEvidenceDescription: "Test-only minimum.",
  };
}
