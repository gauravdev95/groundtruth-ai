import test from "node:test";
import assert from "node:assert/strict";

// Phase E — final competency profiles: integration over the three real
// sources (coding evaluation + completed interview + independently
// verified evidence), stored immutably in competency_results.
// Service-level tests against DATABASE_URL when a Postgres is reachable,
// SKIPPING (not failing) when there is none — the existing DB-test
// convention (see tests/auth.db.test.ts). Migrations 000–015 must have
// been applied first (npm run migrate). No live AI is used: with no
// AI_API_* env the LLM client runs its deterministic mock provider and
// every record is labelled provider "mock".

import { pool } from "../src/config/db";
import { ApiError } from "../src/middleware/errorHandler";
import { COMPETENCY_FRAMEWORK_V1 } from "../src/config/competencyFramework";
import {
  registerFramework,
} from "../src/services/competencyScoringService";
import {
  generateInterview,
  type InterviewQuestionRow,
} from "../src/services/interview";
import {
  startSession,
  confirmReadiness,
  getSessionState,
  submitSessionAnswer,
  finishSession,
} from "../src/services/interviewSession";
import {
  computeCompetencyProfileForAssessment,
  getCompetencyProfileForCandidate,
  getCompetencyProfileForRecruiter,
  recruiterMayViewCompetencyProfile,
} from "../src/services/competencyProfile";

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
  const email = `phasee-${tag}-${RUN}@example.com`;
  const user = await pool.query(
    `INSERT INTO users (email, full_name, role, password_hash)
     VALUES ($1, $2, 'candidate', 'test-hash') RETURNING id`,
    [email, `Phase E ${tag}`],
  );
  const userId = user.rows[0].id as string;
  const cand = await pool.query(
    `INSERT INTO candidates (user_id, full_name, email, target_roles)
     VALUES ($1, $2, $3, $4) RETURNING id`,
    [userId, `Phase E ${tag}`, email, targetRoles],
  );
  const candidateId = cand.rows[0].id as string;
  const asm = await pool.query(
    `INSERT INTO assessments (candidate_id, status) VALUES ($1, 'completed') RETURNING id`,
    [candidateId],
  );
  return { userId, candidateId, assessmentId: asm.rows[0].id as string, email };
}

/** Challenge whose title names a skill for every backend competency, so
 *  the coding task is exercised for the whole role. */
const CHALLENGE_TITLE =
  "Build a REST API with SQL and PostgreSQL, an OOP service layer, pytest tests, Redis caching and Docker deployment";

async function seedChallenge(assessmentId: string): Promise<void> {
  await pool.query(
    `INSERT INTO challenges (assessment_id, title, problem_statement, acceptance_criteria)
     VALUES ($1, $2, $3, $4)`,
    [
      assessmentId,
      CHALLENGE_TITLE,
      "Implement the API, schema, service layer, tests and caching described by the title.",
      JSON.stringify(["REST API endpoints work", "SQL schema is normalised", "pytest tests pass"]),
    ],
  );
}

async function seedEvaluation(
  assessmentId: string,
  overall: number,
): Promise<string> {
  const inserted = await pool.query(
    `INSERT INTO evaluations
       (assessment_id, overall_score, category_scores, evidence,
        passed_tests, failed_tests, quality_issues, security_findings,
        improvements, strengths, weaknesses, confidence,
        human_review_recommended, status)
     VALUES ($1, $2, $3, $4, '[]'::jsonb, '[]'::jsonb, '[]'::jsonb, '[]'::jsonb,
             '[]'::jsonb, $5, '[]'::jsonb, 0.85, false, 'completed')
     RETURNING id`,
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
      JSON.stringify({ challengeTitle: CHALLENGE_TITLE }),
      JSON.stringify([
        "REST APIs implemented with FastAPI",
        "SQL schema with PostgreSQL",
        "OOP service layer",
        "pytest tests added",
        "Redis caching",
      ]),
    ],
  );
  return inserted.rows[0].id as string;
}

/** One verified skill per backend competency + one project matching all
 *  five. The verified skills' evidence points at THIS assessment, so the
 *  evaluation id legitimately appears in both the coding and the
 *  evidence source lists (dedup case). */
const EVIDENCE_SKILLS = ["REST APIs", "SQL", "OOP", "Pytest", "Redis"];

async function seedEvidence(
  candidateId: string,
  assessmentId: string,
  functionalScore = 85,
): Promise<void> {
  for (const name of EVIDENCE_SKILLS) {
    const skill = await pool.query(
      `INSERT INTO skills (name) VALUES ($1)
       ON CONFLICT (name) DO NOTHING RETURNING id`,
      [name],
    );
    let skillId: string;
    if (skill.rows.length) {
      skillId = skill.rows[0].id as string;
    } else {
      const existing = await pool.query(`SELECT id FROM skills WHERE name = $1`, [name]);
      skillId = existing.rows[0].id as string;
    }
    await pool.query(
      `INSERT INTO verified_skills (candidate_id, skill_id, assessment_id, evidence, status)
       VALUES ($1, $2, $3, $4, 'verified')
       ON CONFLICT (candidate_id, skill_id) DO UPDATE SET
         assessment_id = EXCLUDED.assessment_id, evidence = EXCLUDED.evidence,
         status = 'verified', verified_at = now()`,
      [
        candidateId,
        skillId,
        assessmentId,
        JSON.stringify({
          assessment_id: assessmentId,
          functional_score: functionalScore,
          test_pass_rate: functionalScore / 100,
        }),
      ],
    );
  }
  await pool.query(
    `INSERT INTO candidate_projects (candidate_id, title, description, technologies)
     VALUES ($1, $2, $3, $4)`,
    [
      candidateId,
      "Phase E evidence project",
      "REST API with SQL and PostgreSQL, OOP service layer, pytest tests, Redis caching.",
      ["Python", "FastAPI", "PostgreSQL", "REST APIs", "Pytest", "Redis", "Docker"],
    ],
  );
}

/** A strong answer: covers every expected point of the question in 60+
 *  words (same pattern as tests/interview-session.test.ts). */
function strongAnswer(q: InterviewQuestionRow): string {
  const rubric = (q.expected_points as string[])[0] ?? "";
  return (
    `${rubric} For a concrete example from my own code, I applied this in the main implementation file ` +
    `for the challenge, changing how the project handles its core flow. I also weighed the trade-offs ` +
    `and edge cases, including failure modes and what I would test next before calling the work done.`
  );
}

const GENERIC_STRONG_ANSWER =
  "The follow-up asked me to go deeper, so here is a concrete example from my own code: I changed the " +
  "main implementation file for the challenge, explained the trade-offs and edge cases I weighed, " +
  "described the failure modes I checked, and said what I would test next before calling the work done.";

/** Run the real Phase C interview flow to completion (all 7 questions
 *  answered strongly, then explicit finish). Returns the interview id. */
async function runFullInterview(seed: Seed): Promise<string> {
  const gen = await generateInterview({
    assessmentId: seed.assessmentId,
    candidateId: seed.candidateId,
  });
  const interviewId = gen.interview.id as string;
  const byId = new Map(gen.questions.map((q) => [q.id, q]));
  await startSession({ interviewId, candidateId: seed.candidateId });
  await confirmReadiness({ interviewId, candidateId: seed.candidateId, acknowledged: true });
  for (;;) {
    const state = await getSessionState({ interviewId, candidateId: seed.candidateId });
    if (!state.currentQuestion) break;
    const qid = state.currentQuestion.id as string;
    const q = byId.get(qid);
    await submitSessionAnswer({
      interviewId,
      candidateId: seed.candidateId,
      questionId: qid,
      answer: q ? strongAnswer(q) : GENERIC_STRONG_ANSWER,
    });
  }
  const report = await finishSession({ interviewId, candidateId: seed.candidateId });
  assert.ok(typeof report.finalScore === "number", "interview must finish with a score");
  return interviewId;
}

async function seedRecruiter(tag: string): Promise<{
  userId: string;
  companyId: string;
  jobId: string;
}> {
  const email = `phasee-rec-${tag}-${RUN}@example.com`;
  const user = await pool.query(
    `INSERT INTO users (email, full_name, role, password_hash)
     VALUES ($1, $2, 'recruiter', 'test-hash') RETURNING id`,
    [email, `Phase E Recruiter ${tag}`],
  );
  const userId = user.rows[0].id as string;
  const company = await pool.query(
    `INSERT INTO companies (name, created_by) VALUES ($1, $2) RETURNING id`,
    [`Phase E Corp ${tag}`, userId],
  );
  const companyId = company.rows[0].id as string;
  const job = await pool.query(
    `INSERT INTO jobs (company_id, title, description) VALUES ($1, $2, $3) RETURNING id`,
    [companyId, "Backend Engineer", "Python backend role."],
  );
  return { userId, companyId, jobId: job.rows[0].id as string };
}

async function cleanupSeed(seed: Partial<Seed>): Promise<void> {
  if (seed.assessmentId) {
    // Stored competency profiles first: their interview_id /
    // evaluation_id FKs are ON DELETE SET NULL, and the 012
    // immutability trigger rejects that UPDATE.
    await pool.query(
      `DELETE FROM competency_results WHERE assessment_id = $1`,
      [seed.assessmentId],
    );
    // trigger rejects the ON DELETE SET NULL update if the report row
    // still exists when the assessment is deleted).
    const ivs = await pool.query(
      `SELECT id FROM interviews WHERE assessment_id = $1`,
      [seed.assessmentId],
    );
    for (const r of ivs.rows) {
      const iid = r.id as string;
      await pool.query(`DELETE FROM interview_reports WHERE interview_id = $1`, [iid]);
      await pool.query(`DELETE FROM interview_followups WHERE interview_id = $1`, [iid]);
      await pool.query(
        `DELETE FROM interview_answers WHERE question_id IN
           (SELECT id FROM interview_questions WHERE interview_id = $1)`,
        [iid],
      );
      await pool.query(`DELETE FROM interview_sessions WHERE interview_id = $1`, [iid]);
      await pool.query(`DELETE FROM interview_questions WHERE interview_id = $1`, [iid]);
      await pool.query(`DELETE FROM interviews WHERE id = $1`, [iid]);
    }
    // competency_results / evaluations / challenges cascade with it.
    await pool.query(`DELETE FROM assessments WHERE id = $1`, [seed.assessmentId]);
  }
  if (seed.candidateId) {
    await pool.query(`DELETE FROM candidates WHERE id = $1`, [seed.candidateId]);
  }
  if (seed.userId) {
    await pool.query(`DELETE FROM users WHERE id = $1`, [seed.userId]);
  }
}

async function cleanupRecruiter(r: { userId: string; companyId: string; jobId: string }): Promise<void> {
  await pool.query(`DELETE FROM applications WHERE job_id = $1`, [r.jobId]);
  await pool.query(`DELETE FROM jobs WHERE id = $1`, [r.jobId]);
  await pool.query(`DELETE FROM companies WHERE id = $1`, [r.companyId]);
  await pool.query(`DELETE FROM users WHERE id = $1`, [r.userId]);
}

function expectApiError(err: unknown, status: number): void {
  assert.ok(err instanceof ApiError, `expected ApiError, got ${String(err)}`);
  assert.equal((err as ApiError).status, status);
}

// ── 1. End-to-end: all three sources present ─────────────────────────────

test("phase E: all three sources present → Complete final profile, stored immutably", async (t) => {
  if (await skipIfNoDb(t)) return;
  const seed = await seedCandidate("complete");
  t.after(() => cleanupSeed(seed));
  await seedChallenge(seed.assessmentId);
  await seedEvaluation(seed.assessmentId, 85);
  await seedEvidence(seed.candidateId, seed.assessmentId, 85);
  const interviewId = await runFullInterview(seed);

  const { profile, fresh } = await computeCompetencyProfileForAssessment(seed.assessmentId);
  assert.equal(fresh, true, "first compute stores a fresh row");
  assert.equal(profile.roleId, "backend-developer");
  assert.equal(profile.frameworkVersion, "v1.0.0");
  assert.equal(profile.status, "Complete");
  assert.equal(profile.isFinal, true);
  // P0: all mandatory conditions hold, so the provisional band IS the
  // verified category — and the interview coverage proves it.
  assert.equal(profile.verifiedCategory, profile.overallCategory);
  assert.ok(profile.verifiedCategory !== null, "a Complete profile has a verified category");
  assert.equal(profile.provisionalScore, profile.overallScore);
  assert.equal(profile.provisionalCategory, profile.overallCategory);
  assert.equal(profile.statusLabel, "Complete");
  assert.equal(profile.classificationRuleVersion, "provisional-vs-verified-v3");
  assert.equal(profile.interviewCoverage?.complete, true, "all 7 interview questions evaluated");
  assert.equal(profile.interviewCoverage?.questionsScored, 7);
  assert.equal(profile.interviewCoverage?.questionsRequired, 7);
  assert.equal(profile.interviewCoverage?.pendingEvaluations, 0);
  assert.equal(profile.competencies.length, 5, "one entry per role competency");
  for (const c of profile.competencies) {
    assert.equal(c.status, "Assessed", `${c.competencyId} must be fully assessed`);
    assert.ok(c.score !== null && c.score >= 0 && c.score <= 100);
    assert.ok(c.category !== null, "assessed competency has a category");
    assert.equal(c.verifiedCategory, c.category, "assessed competency has a verified category");
    assert.deepEqual(c.sourcesMissing, [], "no source missing");
  }
  assert.equal(profile.componentScores.coding, 85, "coding = evaluation overall");
  assert.ok(
    profile.componentScores.interview !== null && profile.componentScores.interview >= 60,
    `interview component present, got ${profile.componentScores.interview}`,
  );
  assert.equal(profile.componentScores.evidence, 85, "evidence = verified-skill functional score");
  // S = C*0.50 + I*0.30 + E*0.20
  const expected = Math.round(
    (85 * 0.5 + (profile.componentScores.interview as number) * 0.3 + 85 * 0.2) * 100,
  ) / 100;
  assert.equal(profile.overallScore, expected);
  assert.equal(profile.evidenceCoveragePercent, 100);
  assert.equal(profile.confidence, "high");
  assert.equal(profile.formulaVersion, "1");
  assert.equal(profile.formula, "S = C*0.50 + I*0.30 + E*0.20");
  assert.ok(profile.strengths.length > 0, "strengths derived from high scores");
  assert.equal(profile.sources.evaluation?.overallScore, 85);
  assert.equal(profile.sources.interview?.id, interviewId);
  assert.ok(profile.sources.evidenceItems >= 10, "verified skills + project counted");

  // Stored row: one row, linked to all three sources.
  const rows = await pool.query(
    `SELECT * FROM competency_results WHERE assessment_id = $1`,
    [seed.assessmentId],
  );
  assert.equal(rows.rows.length, 1);
  assert.equal(rows.rows[0].interview_id, interviewId);
  assert.ok(rows.rows[0].inputs_hash, "inputs fingerprint stored");
  assert.equal(rows.rows[0].status, "Complete");

  // Candidate read returns the same stored profile.
  const read = await getCompetencyProfileForCandidate({
    assessmentId: seed.assessmentId,
    candidateId: seed.candidateId,
  });
  assert.equal(read.id, profile.id);
  assert.equal(read.overallScore, profile.overallScore);
});

// ── 2. Missing interview → Incomplete (provisional, never final) ─────────

test("phase E: missing interview → Incomplete, no final category", async (t) => {
  if (await skipIfNoDb(t)) return;
  const seed = await seedCandidate("no-interview");
  t.after(() => cleanupSeed(seed));
  await seedChallenge(seed.assessmentId);
  await seedEvaluation(seed.assessmentId, 85);
  await seedEvidence(seed.candidateId, seed.assessmentId, 85);

  const { profile } = await computeCompetencyProfileForAssessment(seed.assessmentId);
  assert.equal(profile.status, "Incomplete");
  assert.equal(profile.statusLabel, "Assessment Incomplete");
  assert.equal(profile.isFinal, false, "an Incomplete profile is provisional, not final");
  // P0: a missing interview means no verified category, however high
  // the renormalised blend over coding + evidence is.
  assert.equal(profile.verifiedCategory, null);
  assert.equal(profile.overallCategory, null);
  assert.ok(profile.provisionalScore !== null, "the provisional blend stays visible");
  assert.equal(profile.interviewCoverage, null, "no interview component, no coverage");
  for (const c of profile.competencies) {
    assert.equal(c.interviewScore, null);
    assert.ok(c.sourcesMissing.includes("interview"));
  }
  assert.equal(profile.componentScores.interview, null);
  assert.equal(profile.sources.interview, null);
});

// ── 3. Missing evidence → Insufficient Evidence / Not Assessed ───────────

test("phase E: missing evidence → Insufficient Evidence, scores never fabricated", async (t) => {
  if (await skipIfNoDb(t)) return;
  const seed = await seedCandidate("no-evidence");
  t.after(() => cleanupSeed(seed));
  await seedChallenge(seed.assessmentId);
  await seedEvaluation(seed.assessmentId, 85);
  const interviewId = await runFullInterview(seed);
  // No verified skills, no projects, no verification rows.

  const { profile } = await computeCompetencyProfileForAssessment(seed.assessmentId);
  assert.equal(profile.status, "Insufficient Evidence");
  assert.equal(profile.isFinal, false);
  // P0: this is the live-E2E shape (high coding + interview, no
  // evidence) — it must never again carry a verified L3.
  assert.equal(profile.verifiedCategory, null);
  assert.equal(profile.overallCategory, null);
  for (const c of profile.competencies) {
    assert.equal(c.status, "Insufficient Evidence");
    assert.equal(c.score, null, "no score is fabricated from thin evidence");
    assert.equal(c.evidenceProvided, 1, "only the coding evaluation item");
    assert.equal(c.evidenceRequired, 2);
  }
  assert.equal(profile.overallScore, null);
  assert.equal(profile.componentScores.evidence, null);
});

test("phase E: no sources at all → every competency Not Assessed, overall null", async (t) => {
  if (await skipIfNoDb(t)) return;
  const seed = await seedCandidate("no-sources");
  t.after(() => cleanupSeed(seed));

  const { profile } = await computeCompetencyProfileForAssessment(seed.assessmentId);
  assert.equal(profile.status, "Incomplete");
  assert.equal(profile.statusLabel, "Not Assessed", "no source at all displays as Not Assessed");
  assert.equal(profile.overallScore, null);
  assert.equal(profile.provisionalScore, null, "Not Assessed is null, never a silent 0");
  assert.equal(profile.overallCategory, null);
  assert.equal(profile.verifiedCategory, null);
  for (const c of profile.competencies) {
    assert.equal(c.status, "Not Assessed");
    assert.equal(c.score, null, "never a silent zero");
  }
});

// ── 4. Practical threshold ───────────────────────────────────────────────

test("phase E: coding below the practical minimum → capped at L2, status Practical Threshold Not Met", async (t) => {
  if (await skipIfNoDb(t)) return;
  const seed = await seedCandidate("threshold");
  t.after(() => cleanupSeed(seed));
  await seedChallenge(seed.assessmentId);
  await seedEvaluation(seed.assessmentId, 39);
  // Evidence 100 (not 95): the uncapped blend must clear 60 so the cap
  // is actually exercised — with the deterministic mock interview at
  // ~71.6, evidence 95 leaves the blend at 59.98, just under the L3
  // line, and the cap would be vacuous. 100 lifts it to ~61.
  await seedEvidence(seed.candidateId, seed.assessmentId, 100);
  const interviewId = await runFullInterview(seed);

  const { profile } = await computeCompetencyProfileForAssessment(seed.assessmentId);
  assert.equal(profile.status, "Practical Threshold Not Met");
  assert.equal(profile.isFinal, true, "the threshold outcome is final for this assessment");
  assert.equal(profile.componentScores.coding, 39);
  assert.ok(
    (profile.overallScore as number) >= 60,
    `uncapped blend would be Job Ready (got ${profile.overallScore})`,
  );
  // P0: the provisional band is capped at L2, but the cap is NOT a
  // verified category — the practical minimum failed.
  assert.equal(profile.provisionalCategory, "L2", "Job Ready / Strong are blocked by the cap");
  assert.equal(profile.provisionalScore, profile.overallScore);
  assert.equal(profile.overallCategory, null);
  assert.equal(profile.verifiedCategory, null);
  for (const c of profile.competencies) {
    assert.equal(c.practicalMinimumMet, false);
  }
});

// ── 5. No double-counting ────────────────────────────────────────────────

test("phase E: same evidence item in coding + evidence is counted once", async (t) => {
  if (await skipIfNoDb(t)) return;
  const seed = await seedCandidate("dedup");
  t.after(() => cleanupSeed(seed));
  await seedChallenge(seed.assessmentId);
  await seedEvaluation(seed.assessmentId, 85);
  await seedEvidence(seed.candidateId, seed.assessmentId, 85);
  const interviewId = await runFullInterview(seed);

  const { profile } = await computeCompetencyProfileForAssessment(seed.assessmentId);
  const apiDesign = profile.competencies.find((c) => c.competencyId === "be-api-design");
  assert.ok(apiDesign, "API Design competency present");
  // The evaluation id is in BOTH lists (coding source + verified-skill
  // evidence from the same evaluation) and must appear in dedupedEvidenceIds.
  assert.ok(
    apiDesign.dedupedEvidenceIds.includes(`evaluation:${seed.assessmentId}`),
    `deduped ids: ${apiDesign.dedupedEvidenceIds.join(", ")}`,
  );
  // Distinct items: evaluation + 1 verified skill + 1 project = 3, not 4.
  assert.equal(apiDesign.evidenceProvided, 3);
});

// ── 6. Deterministic repeat ──────────────────────────────────────────────

test("phase E: repeat computation is deterministic and creates no duplicate row", async (t) => {
  if (await skipIfNoDb(t)) return;
  const seed = await seedCandidate("repeat");
  t.after(() => cleanupSeed(seed));
  await seedChallenge(seed.assessmentId);
  await seedEvaluation(seed.assessmentId, 85);
  await seedEvidence(seed.candidateId, seed.assessmentId, 85);
  const interviewId = await runFullInterview(seed);

  const first = await computeCompetencyProfileForAssessment(seed.assessmentId);
  const second = await computeCompetencyProfileForAssessment(seed.assessmentId);
  assert.equal(second.fresh, false, "second compute returns the stored row");
  assert.equal(second.profile.id, first.profile.id);
  assert.equal(second.profile.overallScore, first.profile.overallScore);
  assert.deepEqual(second.profile.competencies, first.profile.competencies);
  const rows = await pool.query(
    `SELECT COUNT(*)::int AS n FROM competency_results WHERE assessment_id = $1`,
    [seed.assessmentId],
  );
  assert.equal(rows.rows[0].n, 1, "re-running never creates a duplicate profile row");
});

// ── 7. Non-final draft refreshes when inputs change ──────────────────────

test("phase E: a non-final draft refreshes when its inputs complete; a final profile never rewrites", async (t) => {
  if (await skipIfNoDb(t)) return;
  const seed = await seedCandidate("refresh");
  t.after(() => cleanupSeed(seed));
  await seedChallenge(seed.assessmentId);
  await seedEvaluation(seed.assessmentId, 85);
  await seedEvidence(seed.candidateId, seed.assessmentId, 85);

  const draft = await computeCompetencyProfileForAssessment(seed.assessmentId);
  assert.equal(draft.profile.status, "Incomplete", "no interview yet → draft");
  const interviewId = await runFullInterview(seed);
  const completed = await computeCompetencyProfileForAssessment(seed.assessmentId);
  assert.equal(completed.profile.status, "Complete", "draft refreshed once the interview completed");
  assert.equal(completed.fresh, true);
  const rows = await pool.query(
    `SELECT COUNT(*)::int AS n FROM competency_results WHERE assessment_id = $1`,
    [seed.assessmentId],
  );
  assert.equal(rows.rows[0].n, 1, "refresh is DELETE + INSERT, still one row");

  // Now the profile is final: changing the inputs must NOT rewrite it.
  await pool.query(
    `UPDATE evaluations SET overall_score = 40 WHERE assessment_id = $1`,
    [seed.assessmentId],
  );
  const again = await computeCompetencyProfileForAssessment(seed.assessmentId);
  assert.equal(again.profile.status, "Complete", "final profile untouched by changed inputs");
  assert.equal(again.profile.overallScore, completed.profile.overallScore);
  assert.ok(again.note, "caller is told the final profile was kept");
});

// ── 8. Framework version change leaves history untouched ─────────────────

test("phase E: computing under a new framework version leaves the v1 profile untouched", async (t) => {
  if (await skipIfNoDb(t)) return;
  const seed = await seedCandidate("version");
  t.after(() => cleanupSeed(seed));
  await seedChallenge(seed.assessmentId);
  await seedEvaluation(seed.assessmentId, 85);
  await seedEvidence(seed.candidateId, seed.assessmentId, 85);
  const interviewId = await runFullInterview(seed);

  const v1 = await computeCompetencyProfileForAssessment(seed.assessmentId);
  assert.equal(v1.profile.frameworkVersion, "v1.0.0");

  // A new framework version with different component weights.
  const v2 = JSON.parse(JSON.stringify(COMPETENCY_FRAMEWORK_V1)) as typeof COMPETENCY_FRAMEWORK_V1;
  v2.version = "v2.0.0";
  v2.componentWeights = { coding: 0.6, interview: 0.2, evidence: 0.2 };
  registerFramework(v2);
  const v2computed = await computeCompetencyProfileForAssessment(seed.assessmentId, {
    frameworkVersion: "v2.0.0",
  });
  assert.equal(v2computed.profile.frameworkVersion, "v2.0.0");
  assert.notEqual(
    v2computed.profile.overallScore,
    v1.profile.overallScore,
    "different weights → different overall under v2",
  );

  const rows = await pool.query(
    `SELECT * FROM competency_results WHERE assessment_id = $1 ORDER BY framework_version`,
    [seed.assessmentId],
  );
  assert.equal(rows.rows.length, 2, "one stored row per framework version");
  const v1row = rows.rows.find((r) => r.framework_version === "v1.0.0");
  assert.equal(Number(v1row.overall_score), v1.profile.overallScore, "v1 row untouched");
  assert.equal(
    (v1row.result as { profile: { frameworkVersion: string } }).profile.frameworkVersion,
    "v1.0.0",
  );
});

// ── 9. Access control ────────────────────────────────────────────────────

test("phase E: unauthorized recruiter/candidate access is rejected; owning recruiter allowed", async (t) => {
  if (await skipIfNoDb(t)) return;
  const seed = await seedCandidate("access");
  const other = await seedCandidate("access-other");
  t.after(() => cleanupSeed(seed));
  t.after(() => cleanupSeed(other));
  await seedChallenge(seed.assessmentId);
  await seedEvaluation(seed.assessmentId, 85);
  await seedEvidence(seed.candidateId, seed.assessmentId, 85);
  await computeCompetencyProfileForAssessment(seed.assessmentId);

  // Another candidate cannot read it.
  let err: unknown;
  try {
    await getCompetencyProfileForCandidate({
      assessmentId: seed.assessmentId,
      candidateId: other.candidateId,
    });
  } catch (e) {
    err = e;
  }
  expectApiError(err, 403);

  // A recruiter with no application to this candidate cannot read it.
  const stranger = await seedRecruiter("stranger");
  t.after(() => cleanupRecruiter(stranger));
  assert.equal(
    await recruiterMayViewCompetencyProfile({
      assessmentId: seed.assessmentId,
      recruiterUserId: stranger.userId,
      isAdmin: false,
    }),
    false,
  );
  err = undefined;
  try {
    await getCompetencyProfileForRecruiter({
      assessmentId: seed.assessmentId,
      recruiterUserId: stranger.userId,
      isAdmin: false,
    });
  } catch (e) {
    err = e;
  }
  expectApiError(err, 403);

  // The recruiter who received an application CAN read the same profile.
  const owner = await seedRecruiter("owner");
  t.after(() => cleanupRecruiter(owner));
  await pool.query(
    `INSERT INTO applications (candidate_id, job_id) VALUES ($1, $2)`,
    [seed.candidateId, owner.jobId],
  );
  assert.equal(
    await recruiterMayViewCompetencyProfile({
      assessmentId: seed.assessmentId,
      recruiterUserId: owner.userId,
      isAdmin: false,
    }),
    true,
  );
  const asRecruiter = await getCompetencyProfileForRecruiter({
    assessmentId: seed.assessmentId,
    recruiterUserId: owner.userId,
    isAdmin: false,
  });
  // No interview yet: renormalised blend over coding + evidence only.
  assert.equal(asRecruiter.overallScore, 85);
  assert.equal(asRecruiter.status, "Incomplete");
  assert.equal(asRecruiter.verifiedCategory, null, "no interview → no verified category");
  assert.equal(asRecruiter.provisionalScore, 85);
  const asCandidate = await getCompetencyProfileForCandidate({
    assessmentId: seed.assessmentId,
    candidateId: seed.candidateId,
  });
  assert.equal(asRecruiter.id, asCandidate.id);
  assert.equal(asRecruiter.status, asCandidate.status);

  // Admin bypass works.
  const asAdmin = await getCompetencyProfileForRecruiter({
    assessmentId: seed.assessmentId,
    recruiterUserId: stranger.userId,
    isAdmin: true,
  });
  assert.equal(asAdmin.id, asCandidate.id);
});

test("phase E: reading a profile that was never computed is a 404", async (t) => {
  if (await skipIfNoDb(t)) return;
  const seed = await seedCandidate("not-computed");
  t.after(() => cleanupSeed(seed));
  let err: unknown;
  try {
    await getCompetencyProfileForCandidate({
      assessmentId: seed.assessmentId,
      candidateId: seed.candidateId,
    });
  } catch (e) {
    err = e;
  }
  expectApiError(err, 404);
});

// ── Phase 2 (G2.4): failed qualitative review blocks verification ────────

async function seedFailedQualitativeEvaluation(
  assessmentId: string,
  overall: number,
): Promise<void> {
  // Same shape as seedEvaluation, but the qualitative leg failed:
  // the three qualitative categories are null, the method is
  // "failed", the overall is renormalised over the verified
  // dimensions only, and a human review is recommended.
  await pool.query(
    `INSERT INTO evaluations
       (assessment_id, overall_score, category_scores, evidence,
        passed_tests, failed_tests, quality_issues, security_findings,
        improvements, strengths, weaknesses, confidence,
        human_review_recommended, status)
     VALUES ($1, $2, $3, $4, '[]'::jsonb, '[]'::jsonb, '[]'::jsonb, '[]'::jsonb,
             '[]'::jsonb, $5, '[]'::jsonb, 0.3, true, 'completed')`,
    [
      assessmentId,
      overall,
      JSON.stringify({
        functional: overall,
        quality: overall,
        problemSolving: null,
        understanding: null,
        testing: null,
      }),
      JSON.stringify({
        challengeTitle: CHALLENGE_TITLE,
        qualitativeMethod: "failed",
        qualitativeFailure: {
          code: "timeout",
          schemaVersion: "1.0.0",
          provider: "live",
          model: "gpt-4o-mini",
          detail: "qualitative review timed out",
        },
        overallBasis: "verified-dimensions-only",
      }),
      JSON.stringify([
        "REST APIs implemented with FastAPI",
        "SQL schema with PostgreSQL",
        "OOP service layer",
        "pytest tests added",
        "Redis caching",
      ]),
    ],
  );
}

test("phase 2 G2.4: failed qualitative review → Complete profile, no verified category, basis recorded", async (t) => {
  if (await skipIfNoDb(t)) return;
  const seed = await seedCandidate("qual-failed");
  t.after(() => cleanupSeed(seed));
  await seedChallenge(seed.assessmentId);
  await seedFailedQualitativeEvaluation(seed.assessmentId, 85);
  await seedEvidence(seed.candidateId, seed.assessmentId, 85);
  const interviewId = await runFullInterview(seed);

  const { profile, fresh } = await computeCompetencyProfileForAssessment(seed.assessmentId);
  assert.equal(fresh, true);
  // All three sources are complete, so the status is Complete — but
  // the coding overall was renormalised over the verified dimensions
  // only, so nothing verifies.
  assert.equal(profile.status, "Complete");
  assert.equal(profile.verifiedCategory, null);
  assert.equal(profile.overallCategory, null);
  assert.equal(profile.qualitativeMethod, "failed");
  assert.deepEqual(profile.practicalMinimumFailures, []);
  for (const c of profile.competencies) {
    assert.equal(c.status, "Assessed");
    assert.equal(c.verifiedCategory, null, "a failed qualitative leg must not verify a competency");
  }
  assert.ok(
    profile.notes.some((n) => n.includes("Human review required")),
    `the profile must note the human review: ${profile.notes.join(" | ")}`,
  );
  assert.equal(profile.sources.interview?.id, interviewId);
});

// ── Phase 2 (G4.4): per-competency interview coverage from the report ────

/** Seed a completed interview + stored report directly (no live flow):
 *  7 original questions, 6 scored — the second API Design question is
 *  still pending evaluation, so that competency is 1 of 2 scored. */
async function seedPartialInterviewReport(seed: Seed): Promise<string> {
  const interview = await pool.query(
    `INSERT INTO interviews (candidate_id, assessment_id, interview_type, status, score)
     VALUES ($1, $2, 'assessment', 'completed', 85) RETURNING id`,
    [seed.candidateId, seed.assessmentId],
  );
  const interviewId = interview.rows[0].id as string;
  const perQuestion = [
    { questionId: "q1", competencyId: "be-api-design", score: 85, status: "answered" },
    { questionId: "q2", competencyId: "be-api-design", score: null, status: "pending_evaluation" },
    { questionId: "q3", competencyId: "be-databases", score: 85, status: "answered" },
    { questionId: "q4", competencyId: "be-server-logic", score: 85, status: "answered" },
    { questionId: "q5", competencyId: "be-testing", score: 85, status: "answered" },
    { questionId: "q6", competencyId: "be-system-design", score: 85, status: "answered" },
    { questionId: "q7", competencyId: "be-databases", score: 85, status: "answered" },
  ];
  const report = {
    finalScore: 85,
    competencyScores: [
      { competencyId: "be-api-design", score: 85, questionsAnswered: 1 },
      { competencyId: "be-databases", score: 85, questionsAnswered: 2 },
      { competencyId: "be-server-logic", score: 85, questionsAnswered: 1 },
      { competencyId: "be-testing", score: 85, questionsAnswered: 1 },
      { competencyId: "be-system-design", score: 85, questionsAnswered: 1 },
    ],
    perQuestion,
    pendingEvaluations: 1,
  };
  await pool.query(
    `INSERT INTO interview_reports
       (interview_id, candidate_id, assessment_id, role_id, framework_version,
        final_score, dimension_averages, competency_scores, report)
     VALUES ($1, $2, $3, 'backend-developer', 'v1.0.0', 85, '{}'::jsonb, $4::jsonb, $5::jsonb)`,
    [
      interviewId,
      seed.candidateId,
      seed.assessmentId,
      JSON.stringify(report.competencyScores),
      JSON.stringify(report),
    ],
  );
  return interviewId;
}

test("phase 2 G4.4: 1-of-2-questions competency is Incomplete end to end; 6/7 interview verifies nothing", async (t) => {
  if (await skipIfNoDb(t)) return;
  const seed = await seedCandidate("partial-coverage");
  t.after(() => cleanupSeed(seed));
  await seedChallenge(seed.assessmentId);
  await seedEvaluation(seed.assessmentId, 85);
  await seedEvidence(seed.candidateId, seed.assessmentId, 85);
  const interviewId = await seedPartialInterviewReport(seed);

  const { profile } = await computeCompetencyProfileForAssessment(seed.assessmentId);
  assert.equal(profile.status, "Incomplete", "the 6/7 interview keeps the profile provisional");
  assert.equal(profile.verifiedCategory, null);
  assert.equal(profile.interviewCoverage?.complete, false);
  assert.equal(profile.interviewCoverage?.questionsScored, 6);
  assert.equal(profile.interviewCoverage?.questionsRequired, 7);
  assert.equal(
    profile.interviewCoverage?.provisionalNote,
    "provisional — 6 of 7 questions scored",
  );
  assert.equal(profile.sources.interview?.id, interviewId);
  const apiDesign = profile.competencies.find((c) => c.competencyId === "be-api-design");
  assert.ok(apiDesign, "API Design competency present");
  assert.equal(apiDesign.interviewScore, 85, "the 1-question mean stays visible as provisional");
  assert.equal(apiDesign.interviewQuestionsScored, 1);
  assert.equal(apiDesign.interviewQuestionsRequired, 2);
  assert.equal(apiDesign.status, "Incomplete", "1-of-2 questions scored does not make the competency Assessed");
  assert.equal(apiDesign.verifiedCategory, null);
  // The other competencies are locally complete — but the 6/7
  // interview still nulls their verified categories (G2.1).
  for (const c of profile.competencies) {
    if (c.competencyId === "be-api-design") continue;
    assert.equal(c.status, "Assessed");
    assert.equal(c.verifiedCategory, null, "6/7 interview must not verify any competency");
  }
});

/** A legacy SHORT stored report: only 3 original questions, all
 *  scored — the shape a pre-Phase-C interview leaves behind. Before
 *  the G3.2 fix this read complete:true (3 of 3) and could support a
 *  verified category on a 3-question interview. */
async function seedLegacyShortReport(seed: Seed): Promise<string> {
  const interview = await pool.query(
    `INSERT INTO interviews (candidate_id, assessment_id, interview_type, status, score)
     VALUES ($1, $2, 'assessment', 'completed', 85) RETURNING id`,
    [seed.candidateId, seed.assessmentId],
  );
  const interviewId = interview.rows[0].id as string;
  const perQuestion = [
    { questionId: "q1", competencyId: "be-api-design", score: 85, status: "answered" },
    { questionId: "q2", competencyId: "be-databases", score: 85, status: "answered" },
    { questionId: "q3", competencyId: "be-server-logic", score: 85, status: "answered" },
  ];
  const report = {
    finalScore: 85,
    competencyScores: [
      { competencyId: "be-api-design", score: 85, questionsAnswered: 1 },
      { competencyId: "be-databases", score: 85, questionsAnswered: 1 },
      { competencyId: "be-server-logic", score: 85, questionsAnswered: 1 },
    ],
    perQuestion,
    pendingEvaluations: 0,
  };
  await pool.query(
    `INSERT INTO interview_reports
       (interview_id, candidate_id, assessment_id, role_id, framework_version,
        final_score, dimension_averages, competency_scores, report)
     VALUES ($1, $2, $3, 'backend-developer', 'v1.0.0', 85, '{}'::jsonb, $4::jsonb, $5::jsonb)`,
    [
      interviewId,
      seed.candidateId,
      seed.assessmentId,
      JSON.stringify(report.competencyScores),
      JSON.stringify(report),
    ],
  );
  return interviewId;
}

test("phase 2 G3.2: a legacy 3-row all-scored report reads 3 of 7, never complete, and verifies nothing", async (t) => {
  if (await skipIfNoDb(t)) return;
  const seed = await seedCandidate("legacy-short-report");
  t.after(() => cleanupSeed(seed));
  await seedChallenge(seed.assessmentId);
  await seedEvaluation(seed.assessmentId, 85);
  await seedEvidence(seed.candidateId, seed.assessmentId, 85);
  const interviewId = await seedLegacyShortReport(seed);

  const { profile } = await computeCompetencyProfileForAssessment(seed.assessmentId);
  assert.equal(profile.status, "Incomplete", "the 3/7 interview keeps the profile provisional");
  assert.equal(profile.verifiedCategory, null, "a 3-question interview must never verify L3/L4");
  assert.equal(profile.interviewCoverage?.complete, false);
  assert.equal(profile.interviewCoverage?.questionsScored, 3);
  assert.equal(
    profile.interviewCoverage?.questionsRequired,
    7,
    "required is the framework count, not the stored row count",
  );
  assert.equal(
    profile.interviewCoverage?.provisionalNote,
    "provisional — 3 of 7 questions scored",
  );
  assert.equal(profile.sources.interview?.id, interviewId, "the interview is still a provisional source");
  for (const c of profile.competencies) {
    assert.equal(c.verifiedCategory, null, "no competency verifies on a 3/7 interview");
  }
});

/** A complete-looking 7-row report on an EXPIRED interview (migration
 *  015 status): the report is honest, but the interview is not a
 *  completed source, so the profile must not see it at all. */
async function seedExpiredInterviewReport(seed: Seed): Promise<string> {
  const interview = await pool.query(
    `INSERT INTO interviews (candidate_id, assessment_id, interview_type, status, score)
     VALUES ($1, $2, 'assessment', 'expired', 85) RETURNING id`,
    [seed.candidateId, seed.assessmentId],
  );
  const interviewId = interview.rows[0].id as string;
  const perQuestion = [
    { questionId: "q1", competencyId: "be-api-design", score: 85, status: "answered" },
    { questionId: "q2", competencyId: "be-api-design", score: 85, status: "answered" },
    { questionId: "q3", competencyId: "be-databases", score: 85, status: "answered" },
    { questionId: "q4", competencyId: "be-databases", score: 85, status: "answered" },
    { questionId: "q5", competencyId: "be-server-logic", score: 85, status: "answered" },
    { questionId: "q6", competencyId: "be-testing", score: 85, status: "answered" },
    { questionId: "q7", competencyId: "be-system-design", score: 85, status: "answered" },
  ];
  const report = {
    finalScore: 85,
    competencyScores: [
      { competencyId: "be-api-design", score: 85, questionsAnswered: 2 },
      { competencyId: "be-databases", score: 85, questionsAnswered: 2 },
      { competencyId: "be-server-logic", score: 85, questionsAnswered: 1 },
      { competencyId: "be-testing", score: 85, questionsAnswered: 1 },
      { competencyId: "be-system-design", score: 85, questionsAnswered: 1 },
    ],
    perQuestion,
    pendingEvaluations: 0,
  };
  await pool.query(
    `INSERT INTO interview_reports
       (interview_id, candidate_id, assessment_id, role_id, framework_version,
        final_score, dimension_averages, competency_scores, report)
     VALUES ($1, $2, $3, 'backend-developer', 'v1.0.0', 85, '{}'::jsonb, $4::jsonb, $5::jsonb)`,
    [
      interviewId,
      seed.candidateId,
      seed.assessmentId,
      JSON.stringify(report.competencyScores),
      JSON.stringify(report),
    ],
  );
  return interviewId;
}

test("phase 2 G3.7: an expired interview is not a profile source, even with a complete-looking report", async (t) => {
  if (await skipIfNoDb(t)) return;
  const seed = await seedCandidate("expired-interview");
  t.after(() => cleanupSeed(seed));
  await seedChallenge(seed.assessmentId);
  await seedEvaluation(seed.assessmentId, 85);
  await seedEvidence(seed.candidateId, seed.assessmentId, 85);
  await seedExpiredInterviewReport(seed);

  const { profile } = await computeCompetencyProfileForAssessment(seed.assessmentId);
  assert.equal(profile.sources.interview, null, "an expired interview contributes no interview source");
  assert.equal(profile.interviewCoverage, null);
  assert.equal(profile.verifiedCategory, null);
  assert.equal(profile.status, "Incomplete", "the missing interview source keeps the profile provisional");
  for (const c of profile.competencies) {
    assert.equal(c.interviewScore, null, "no interview score from an expired interview");
    assert.equal(c.verifiedCategory, null);
  }
});
