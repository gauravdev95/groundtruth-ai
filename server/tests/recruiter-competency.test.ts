import test from "node:test";
import assert from "node:assert/strict";

// Phase F — recruiter dashboard competency surfaces: the applications
// list carries each candidate's latest computed competency profile
// (score / category / status, null when nothing was computed), and the
// verified evidence payload carries the full assessment history with
// each assessment's interview id and stored competency profile.
// Service-level tests against DATABASE_URL when a Postgres is reachable,
// SKIPPING (not failing) when there is none — the existing DB-test
// convention (see tests/auth.db.test.ts). Migrations 000–012 must have
// been applied first (npm run migrate).

import { pool } from "../src/config/db";
import { ApiError } from "../src/middleware/errorHandler";
import { listRecruiterApplications } from "../src/services/applications";
import { loadRecruiterDashboard } from "../src/services/recruiter";
import {
  buildVerifiedProfile,
  getCandidateEvidenceForRecruiter,
  recruiterMayViewCandidate,
} from "../src/services/verified";

const RUN = Date.now();
let seedCounter = 0;

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
  recruiterUserId: string;
  strangerUserId: string;
  candidateId: string;
  assessedCandidateId: string;
  assessmentId: string;
  interviewId: string;
  /** Legacy non-Complete row (status Insufficient Evidence, stored
   *  band L3) with a partial-interview coverage note — G1.1/G2.2. */
  insufficientCandidateId: string;
  insufficientAssessmentId: string;
  /** Legacy Complete row whose stored coverage says the interview
   *  was partial (6/7) — G2.2 demotion case. */
  legacyPartialCandidateId: string;
  legacyPartialAssessmentId: string;
  /** Legacy Complete row with NO interview at all — G1.2 (never
   *  "Verified" when interviewScore is null). */
  completeNoInterviewCandidateId: string;
  completeNoInterviewAssessmentId: string;
}

// Minimal stored-profile result JSONB — the shape compute writes
// (see competencyProfile.ts rowToStoredProfile): result.profile carries
// the role/category/component data, result.* the lists and formula.
// NOTE: this fixture deliberately omits the provisional-vs-verified
// fields (verifiedCategory, provisionalCategory, ...), so it exercises
// the legacy-row path: a stored Complete row keeps its column category
// as the verified category; a non-Complete old row would get none.
const PROFILE_RESULT = {
  roleResolvedFrom: "default",
  strengths: ["Clear API design"],
  improvementAreas: ["Add tests for edge cases"],
  evidenceReferences: [],
  formulaVersion: "1",
  formula: "S = C*0.50 + I*0.30 + E*0.20",
  sources: { evaluation: null, interview: null, evidenceItems: 0 },
  profile: {
    roleName: "Backend Developer",
    overallCategoryLabel: "L3 · Job Ready",
    componentScores: { coding: 70, interview: 72, evidence: 60 },
    competencies: [],
    evidenceCoveragePercent: 100,
    confidence: "high",
    frameworkSnapshot: {
      version: "v1.0.0",
      categories: [],
      componentWeights: { coding: 0.5, interview: 0.3, evidence: 0.2 },
      practicalMinimumCodingScore: 40,
    },
    notes: [],
  },
};

// Same legacy shape, but the stored result JSON carries interview
// coverage saying the interview was partial (6 of 7 scored) — the
// G2.2 re-check case: a legacy Complete row with this coverage is
// demoted to no verified category, and a non-Complete row keeps its
// stored band as provisional only, with the coverage note attached.
const PROFILE_RESULT_PARTIAL_COVERAGE = {
  ...PROFILE_RESULT,
  profile: {
    ...PROFILE_RESULT.profile,
    interviewCoverage: {
      complete: false,
      questionsScored: 6,
      questionsRequired: 7,
      pendingEvaluations: 1,
      provisionalNote: "provisional — 6 of 7 questions scored",
    },
  },
};

async function seedEvaluation(assessmentId: string, overall: number): Promise<void> {
  await pool.query(
    `INSERT INTO evaluations
       (assessment_id, overall_score, category_scores, evidence,
        passed_tests, failed_tests, quality_issues, security_findings,
        improvements, strengths, weaknesses, confidence,
        human_review_recommended, status)
     VALUES ($1, $2, $3, $4, '[]'::jsonb, '[]'::jsonb, '[]'::jsonb, '[]'::jsonb,
             '[]'::jsonb, '[]'::jsonb, '[]'::jsonb, 0.85, false, 'completed')`,
    [
      assessmentId,
      overall,
      JSON.stringify({
        functional: overall,
        quality: overall,
        problemSolving: overall,
        understanding: overall,
        testing: overall,
      }),
      JSON.stringify({}),
    ],
  );
}

async function seedCompetencyRow(opts: {
  candidateId: string;
  assessmentId: string;
  interviewId: string | null;
  status: string;
  overallCategory: string;
  result: unknown;
}): Promise<void> {
  await pool.query(
    `INSERT INTO competency_results
       (candidate_id, role_id, framework_version, overall_score, overall_category,
        status, component_scores, result, assessment_id, interview_id)
     VALUES ($1, 'backend-developer', 'v1.0.0', 68, $2, $3,
        '{"coding":70,"interview":72,"evidence":60}'::jsonb, $4::jsonb, $5, $6)`,
    [
      opts.candidateId,
      opts.overallCategory,
      opts.status,
      JSON.stringify(opts.result),
      opts.assessmentId,
      opts.interviewId,
    ],
  );
}

async function seed(): Promise<Seed> {
  const seedTag = `${RUN}-${seedCounter++}`;
  const recruiter = await pool.query(
    `INSERT INTO users (email, full_name, role, password_hash)
     VALUES ($1, $2, 'recruiter', 'test-hash') RETURNING id`,
    [`phasef-rec-${seedTag}@example.com`, `Phase F Recruiter`],
  );
  const recruiterUserId = recruiter.rows[0].id as string;
  const stranger = await pool.query(
    `INSERT INTO users (email, full_name, role, password_hash)
     VALUES ($1, $2, 'recruiter', 'test-hash') RETURNING id`,
    [`phasef-stranger-${seedTag}@example.com`, `Phase F Stranger`],
  );
  const strangerUserId = stranger.rows[0].id as string;
  const company = await pool.query(
    `INSERT INTO companies (name, created_by) VALUES ($1, $2) RETURNING id`,
    [`Phase F Corp`, recruiterUserId],
  );
  const job = await pool.query(
    `INSERT INTO jobs (company_id, title, description) VALUES ($1, $2, $3) RETURNING id`,
    [company.rows[0].id, "Backend Engineer (Fresher)", "Python backend role."],
  );
  const jobId = job.rows[0].id as string;

  async function seedCandidate(tag: string): Promise<string> {
    const user = await pool.query(
      `INSERT INTO users (email, full_name, role, password_hash)
       VALUES ($1, $2, 'candidate', 'test-hash') RETURNING id`,
      [`phasef-${tag}-${seedTag}@example.com`, `Phase F ${tag}`],
    );
    const cand = await pool.query(
      `INSERT INTO candidates (user_id, full_name, email, target_roles)
       VALUES ($1, $2, $3, $4) RETURNING id`,
      [user.rows[0].id, `Phase F ${tag}`, `phasef-${tag}-${seedTag}@example.com`, ["Backend Developer"]],
    );
    return cand.rows[0].id as string;
  }

  const candidateId = await seedCandidate("plain");
  const assessedCandidateId = await seedCandidate("assessed");
  for (const cid of [candidateId, assessedCandidateId]) {
    await pool.query(
      `INSERT INTO applications (candidate_id, job_id, status) VALUES ($1, $2, 'applied')`,
      [cid, jobId],
    );
  }
  const assessment = await pool.query(
    `INSERT INTO assessments (candidate_id, status, submitted_at)
     VALUES ($1, 'completed', now()) RETURNING id`,
    [assessedCandidateId],
  );
  const assessmentId = assessment.rows[0].id as string;
  const interview = await pool.query(
    `INSERT INTO interviews (candidate_id, assessment_id, interview_type, status, score)
     VALUES ($1, $2, 'assessment', 'completed', 72) RETURNING id`,
    [assessedCandidateId, assessmentId],
  );
  const interviewId = interview.rows[0].id as string;
  await pool.query(
    `INSERT INTO competency_results
       (candidate_id, role_id, framework_version, overall_score, overall_category,
        status, component_scores, result, assessment_id, interview_id)
     VALUES ($1, 'backend-developer', 'v1.0.0', 68, 'L3', 'Complete',
        '{"coding":70,"interview":72,"evidence":60}'::jsonb, $2::jsonb, $3, $4)`,
    [assessedCandidateId, JSON.stringify(PROFILE_RESULT), assessmentId, interviewId],
  );

  // G1.1/G2.2: legacy non-Complete row (Insufficient Evidence, stored
  // band L3) with partial-interview coverage in the stored JSON.
  const insufficientCandidateId = await seedCandidate("insufficient");
  const insufficientAssessment = await pool.query(
    `INSERT INTO assessments (candidate_id, status, submitted_at)
     VALUES ($1, 'completed', now()) RETURNING id`,
    [insufficientCandidateId],
  );
  const insufficientAssessmentId = insufficientAssessment.rows[0].id as string;
  const insufficientInterview = await pool.query(
    `INSERT INTO interviews (candidate_id, assessment_id, interview_type, status, score)
     VALUES ($1, $2, 'assessment', 'completed', 72) RETURNING id`,
    [insufficientCandidateId, insufficientAssessmentId],
  );
  await seedEvaluation(insufficientAssessmentId, 75);
  await pool.query(
    `INSERT INTO applications (candidate_id, job_id, status) VALUES ($1, $2, 'applied')`,
    [insufficientCandidateId, jobId],
  );
  await seedCompetencyRow({
    candidateId: insufficientCandidateId,
    assessmentId: insufficientAssessmentId,
    interviewId: insufficientInterview.rows[0].id as string,
    status: "Insufficient Evidence",
    overallCategory: "L3",
    result: PROFILE_RESULT_PARTIAL_COVERAGE,
  });

  // G2.2: legacy Complete row whose stored coverage says the interview
  // was partial (6/7) — the re-check must demote it.
  const legacyPartialCandidateId = await seedCandidate("legacy-partial");
  const legacyPartialAssessment = await pool.query(
    `INSERT INTO assessments (candidate_id, status, submitted_at)
     VALUES ($1, 'completed', now()) RETURNING id`,
    [legacyPartialCandidateId],
  );
  const legacyPartialAssessmentId = legacyPartialAssessment.rows[0].id as string;
  const legacyPartialInterview = await pool.query(
    `INSERT INTO interviews (candidate_id, assessment_id, interview_type, status, score)
     VALUES ($1, $2, 'assessment', 'completed', 72) RETURNING id`,
    [legacyPartialCandidateId, legacyPartialAssessmentId],
  );
  await seedEvaluation(legacyPartialAssessmentId, 75);
  await pool.query(
    `INSERT INTO applications (candidate_id, job_id, status) VALUES ($1, $2, 'applied')`,
    [legacyPartialCandidateId, jobId],
  );
  await seedCompetencyRow({
    candidateId: legacyPartialCandidateId,
    assessmentId: legacyPartialAssessmentId,
    interviewId: legacyPartialInterview.rows[0].id as string,
    status: "Complete",
    overallCategory: "L3",
    result: PROFILE_RESULT_PARTIAL_COVERAGE,
  });

  // G1.2: legacy Complete row with NO interview at all (stored band
  // L3, no coverage data → legacy trust keeps the verified category
  // on the profile, but verificationStatus must still not be
  // "Verified" — there is no interview score).
  const completeNoInterviewCandidateId = await seedCandidate("complete-no-interview");
  const completeNoInterviewAssessment = await pool.query(
    `INSERT INTO assessments (candidate_id, status, submitted_at)
     VALUES ($1, 'completed', now()) RETURNING id`,
    [completeNoInterviewCandidateId],
  );
  const completeNoInterviewAssessmentId =
    completeNoInterviewAssessment.rows[0].id as string;
  await seedEvaluation(completeNoInterviewAssessmentId, 75);
  await pool.query(
    `INSERT INTO applications (candidate_id, job_id, status) VALUES ($1, $2, 'applied')`,
    [completeNoInterviewCandidateId, jobId],
  );
  await seedCompetencyRow({
    candidateId: completeNoInterviewCandidateId,
    assessmentId: completeNoInterviewAssessmentId,
    interviewId: null,
    status: "Complete",
    overallCategory: "L3",
    result: PROFILE_RESULT,
  });

  return {
    recruiterUserId,
    strangerUserId,
    candidateId,
    assessedCandidateId,
    assessmentId,
    interviewId,
    insufficientCandidateId,
    insufficientAssessmentId,
    legacyPartialCandidateId,
    legacyPartialAssessmentId,
    completeNoInterviewCandidateId,
    completeNoInterviewAssessmentId,
  };
}

test("recruiter applications list carries the latest competency profile (or null)", async (t) => {
  if (await skipIfNoDb(t)) return;
  const s = await seed();
  const rows = await listRecruiterApplications(s.recruiterUserId);
  const assessed = rows.find((r) => r.candidate_id === s.assessedCandidateId);
  assert.ok(assessed, "assessed candidate's application is listed");
  assert.equal(assessed.competency_overall_score, 68);
  assert.equal(assessed.competency_category, "L3");
  assert.equal(assessed.competency_status, "Complete");
  assert.equal(assessed.competency_assessment_id, s.assessmentId);
  // G1.3: the provisional band, rule version and coverage note ride
  // with the list row (legacy Complete row, no coverage data → the
  // stored band is the provisional one, no note).
  assert.equal(assessed.competency_provisional_category, "L3");
  assert.equal(
    assessed.competency_classification_rule_version,
    "pre-provisional-vs-verified (overallCategory was provisional)",
  );
  assert.equal(assessed.competency_provisional_note, null);
  const plain = rows.find((r) => r.candidate_id === s.candidateId);
  assert.ok(plain, "plain candidate's application is listed");
  assert.equal(plain.competency_overall_score, null);
  assert.equal(plain.competency_category, null);
  assert.equal(plain.competency_status, null);
  assert.equal(plain.competency_provisional_category, null);
  assert.equal(plain.competency_classification_rule_version, null);
  assert.equal(plain.competency_provisional_note, null);
});

test("G1.1: a legacy non-Complete row never leaks a verified-looking category into the list", async (t) => {
  if (await skipIfNoDb(t)) return;
  const s = await seed();
  const rows = await listRecruiterApplications(s.recruiterUserId);
  const row = rows.find((r) => r.candidate_id === s.insufficientCandidateId);
  assert.ok(row, "insufficient-evidence candidate's application is listed");
  // The stored band is L3, but the profile is Insufficient Evidence:
  // the list must NOT present L3 as the (verified) category.
  assert.equal(row.competency_overall_score, 68, "the provisional score stays visible");
  assert.equal(row.competency_category, null, "non-Complete legacy row → no verified category");
  assert.equal(row.competency_status, "Insufficient Evidence");
  assert.equal(row.competency_provisional_category, "L3", "the stored band is the provisional one");
  assert.equal(
    row.competency_provisional_note,
    "provisional — 6 of 7 questions scored",
    "the stored coverage note rides with the provisional score",
  );
  // The dashboard reads the same derivation, not a second copy of the
  // old bug: the same row must read identically there.
  const dashboard = await loadRecruiterDashboard(s.recruiterUserId);
  const dashRow = dashboard.applications.find(
    (a) => a.candidate_id === s.insufficientCandidateId,
  );
  assert.ok(dashRow, "insufficient-evidence candidate is on the dashboard");
  assert.equal(dashRow.competency_category, null);
  assert.equal(dashRow.competency_provisional_category, "L3");
  assert.equal(dashRow.competency_provisional_note, "provisional — 6 of 7 questions scored");
  const dashAssessed = dashboard.applications.find(
    (a) => a.candidate_id === s.assessedCandidateId,
  );
  assert.ok(dashAssessed, "assessed candidate is on the dashboard");
  assert.equal(dashAssessed.competency_category, "L3", "Complete legacy row keeps its verified band");
});

test("G2.2: a legacy Complete row with partial stored coverage is demoted on read", async (t) => {
  if (await skipIfNoDb(t)) return;
  const s = await seed();
  const profile = await buildVerifiedProfile(s.legacyPartialCandidateId);
  assert.equal(profile.assessments.length, 1);
  const entry = profile.assessments[0];
  assert.ok(entry.competencyProfile, "stored competency profile is attached");
  // Stored status is Complete and the stored band is L3, but the
  // stored coverage says the interview was 6/7: the pre-v1 Complete
  // definition predates the partial-interview policy, so the row is
  // reinterpreted with NO verified category.
  assert.equal(entry.competencyProfile?.status, "Complete");
  assert.equal(entry.competencyProfile?.verifiedCategory, null);
  assert.equal(entry.competencyProfile?.overallCategory, null);
  assert.equal(entry.competencyProfile?.provisionalCategory, "L3", "the stored band stays provisional");
  assert.equal(
    entry.competencyProfile?.interviewCoverage?.provisionalNote,
    "provisional — 6 of 7 questions scored",
  );
  // And the list SQL agrees: no verified-looking L3 there either.
  const rows = await listRecruiterApplications(s.recruiterUserId);
  const row = rows.find((r) => r.candidate_id === s.legacyPartialCandidateId);
  assert.ok(row, "legacy-partial candidate's application is listed");
  assert.equal(row.competency_category, null);
  assert.equal(row.competency_provisional_category, "L3");
});

test("G1.2: verificationStatus comes from the competency gate, never from the coding score alone", async (t) => {
  if (await skipIfNoDb(t)) return;
  const s = await seed();

  // (a) Coding 75 + NO interview at all, no profile → not Verified.
  const noInterview = await buildVerifiedProfile(s.completeNoInterviewCandidateId);
  assert.equal(noInterview.latestAssessment?.overallScore, 75);
  assert.equal(noInterview.interviewScore, null);
  assert.notEqual(noInterview.verificationStatus, "Verified");
  assert.equal(noInterview.verificationStatus, "Assessment Completed");

  // (b) Coding 75 + interview 72 + legacy Complete profile (verified
  // L3, final) → Verified.
  await seedEvaluation(s.assessmentId, 75);
  const verified = await buildVerifiedProfile(s.assessedCandidateId);
  assert.equal(verified.latestAssessment?.overallScore, 75);
  assert.equal(verified.interviewScore, 72);
  assert.equal(verified.competencyProfile?.verifiedCategory, "L3");
  assert.equal(verified.competencyProfile?.isFinal, true);
  assert.equal(verified.verificationStatus, "Verified");
  assert.ok(verified.verificationDate, "a Verified profile carries a verification date");

  // (c) Coding 75 + interview 72, but the profile is Insufficient
  // Evidence (verifiedCategory null) → not Verified.
  const insufficient = await buildVerifiedProfile(s.insufficientCandidateId);
  assert.equal(insufficient.latestAssessment?.overallScore, 75);
  assert.equal(insufficient.interviewScore, 72);
  assert.equal(insufficient.competencyProfile?.verifiedCategory, null);
  assert.notEqual(insufficient.verificationStatus, "Verified");
  assert.equal(insufficient.verificationStatus, "Assessment Completed");

  // (d) Coding 75 + legacy Complete profile but NO interview score →
  // not Verified (the profile keeps its legacy verified band, but
  // the status gate requires an interview score).
  assert.equal(noInterview.competencyProfile?.verifiedCategory, "L3");
  assert.equal(noInterview.competencyProfile?.isFinal, true);
  assert.notEqual(noInterview.verificationStatus, "Verified");
});

test("verified profile carries assessment history with interview id + competency profile", async (t) => {
  if (await skipIfNoDb(t)) return;
  const s = await seed();
  const profile = await buildVerifiedProfile(s.assessedCandidateId);
  assert.equal(profile.assessments.length, 1);
  const entry = profile.assessments[0];
  assert.equal(entry.id, s.assessmentId);
  assert.equal(entry.status, "completed");
  assert.equal(entry.interviewId, s.interviewId);
  assert.equal(entry.interviewScore, 72);
  assert.ok(entry.competencyProfile, "stored competency profile is attached");
  assert.equal(entry.competencyProfile?.overallScore, 68);
  assert.equal(entry.competencyProfile?.overallCategory, "L3");
  assert.equal(entry.competencyProfile?.status, "Complete");
  // Legacy row (pre-provisional-vs-verified): the stored Complete row
  // keeps its column category as verified, and the same band is the
  // provisional one; the rule version says so.
  assert.equal(entry.competencyProfile?.verifiedCategory, "L3");
  assert.equal(entry.competencyProfile?.provisionalCategory, "L3");
  assert.equal(entry.competencyProfile?.provisionalScore, 68);
  assert.equal(
    entry.competencyProfile?.classificationRuleVersion,
    "pre-provisional-vs-verified (overallCategory was provisional)",
  );
  // latestAssessment is derived from the same history row.
  assert.equal(profile.latestAssessment?.id, s.assessmentId);
  assert.equal(profile.competencyProfile?.overallScore, 68);

  const plain = await buildVerifiedProfile(s.candidateId);
  assert.deepEqual(plain.assessments, []);
  assert.equal(plain.latestAssessment, null);
  assert.equal(plain.competencyProfile, null);
});

test("recruiter evidence gate: owner allowed, stranger rejected (403)", async (t) => {
  if (await skipIfNoDb(t)) return;
  const s = await seed();
  assert.equal(
    await recruiterMayViewCandidate(s.recruiterUserId, s.assessedCandidateId),
    true,
  );
  assert.equal(
    await recruiterMayViewCandidate(s.strangerUserId, s.assessedCandidateId),
    false,
  );
  const allowed = await getCandidateEvidenceForRecruiter({
    recruiterUserId: s.recruiterUserId,
    candidateId: s.assessedCandidateId,
  });
  assert.equal(allowed.candidateId, s.assessedCandidateId);
  assert.equal(allowed.assessments.length, 1);
  await assert.rejects(
    getCandidateEvidenceForRecruiter({
      recruiterUserId: s.strangerUserId,
      candidateId: s.assessedCandidateId,
    }),
    (err: unknown) => err instanceof ApiError && err.status === 403,
  );
});
