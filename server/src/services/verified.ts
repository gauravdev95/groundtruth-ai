import { pool } from "../config/db";
import { ApiError } from "../middleware/errorHandler";
import { loadFullProfile, computeCompleteness } from "./student";
import { getEvaluation } from "./evaluation";
import {
  getStoredCompetencyProfile,
  type StoredCompetencyProfile,
} from "./competencyProfile";

// ── Final verified engineering profile ─────────────────────────────────────
// Aggregates completion + strength + verified skills + assessment +
// interview into one honest profile. Verification status is derived from
// real evidence only:
//   Not Assessed      — no assessment ever completed
//   Assessment Pending — an assessment is active/evaluating
//   Assessment Completed — evaluated, but below the verified bar
//   Verified          — the stored competency profile carries a VERIFIED
//                       category (verifiedCategory non-null, final) and
//                       an interview score exists — NEVER on the coding
//                       score alone, and NEVER when interviewScore is
//                       null (Phase 2, G1.2). A coding 75 with no
//                       interview is "Assessment Completed", not
//                       "Verified", even when the competency profile is
//                       Incomplete with a null verified category.
//   Needs Improvement — evaluated below the bar (no profile, low score)
//   Human Review Required — a human_review integrity finding exists
// Untested skills are never labelled verified. A non-verified profile
// status (Incomplete / Insufficient Evidence / Practical Threshold Not
// Met) maps to "Assessment Completed": the assessment ran, but the
// competency gate did not verify a category.

export type VerificationStatus =
  | "Not Assessed"
  | "Assessment Pending"
  | "Assessment Completed"
  | "Verified"
  | "Needs Improvement"
  | "Human Review Required";

export interface VerifiedAssessmentHistory {
  id: string;
  status: string;
  challengeTitle: string | null;
  overallScore: number | null;
  submittedAt: string | null;
  /** Latest assessment-type interview for this assessment, if any. */
  interviewId: string | null;
  interviewScore: number | null;
  /** Stored final competency profile for this assessment, when computed. */
  competencyProfile: StoredCompetencyProfile | null;
}

export interface VerifiedProfile {
  candidateId: string;
  fullName: string;
  completionScore: number;
  completionMissing: string[];
  strengthScore: number | null;
  strengthCategories: Record<string, unknown>;
  verifiedSkills: {
    skill: string;
    evidence: Record<string, unknown>;
    verifiedAt: string;
    assessmentId: string | null;
  }[];
  latestAssessment: {
    id: string;
    status: string;
    challengeTitle: string | null;
    overallScore: number | null;
    testPassRate: number | null;
    qualityIssues: string[];
    submittedAt: string | null;
  } | null;
  /** Every assessment for the candidate, newest first — the recruiter
   *  assessment history (Phase F). Each row carries its interview id
   *  (for the recruiter report view) and its stored competency profile,
   *  when one has been computed. Empty when the candidate has never
   *  started an assessment. */
  assessments: VerifiedAssessmentHistory[];
  interviewScore: number | null;
  /** Final competency profile for the latest assessment, when one has
   *  been computed (Phase E). Null until computed; a non-final profile
   *  (Incomplete / Insufficient Evidence) is provisional, not a final
   *  verified category. */
  competencyProfile: StoredCompetencyProfile | null;
  verificationStatus: VerificationStatus;
  verificationDate: string | null;
  evidence: Record<string, unknown>;
}

export async function buildVerifiedProfile(
  candidateId: string,
): Promise<VerifiedProfile> {
  const profile = await loadFullProfile(candidateId);
  const completeness = computeCompleteness({
    candidate: profile.candidate,
    skillCount: profile.skills.length,
    projectCount: profile.projects.length,
    codingCount: profile.coding_profiles.length,
    certificateCount: profile.certificates.length,
    experienceCount: profile.experience.length,
  });
  const strengthRow = await pool.query(
    `SELECT * FROM profile_analyses WHERE candidate_id = $1 ORDER BY created_at DESC LIMIT 1`,
    [candidateId],
  );
  const strength = strengthRow.rows[0];
  const skills = await pool.query(
    `SELECT s.name AS skill, vs.evidence, vs.verified_at, vs.assessment_id
       FROM verified_skills vs JOIN skills s ON s.id = vs.skill_id
      WHERE vs.candidate_id = $1 AND vs.status = 'verified'
      ORDER BY vs.verified_at DESC`,
    [candidateId],
  );
  // Assessment history (Phase F): every assessment for the candidate,
  // newest first. Each row is enriched with its evaluation score, its
  // latest assessment-type interview (id + score) and its stored
  // competency profile when one has been computed. `latestAssessment`
  // below is derived from history[0], so the two can never disagree.
  const assessmentRows = await pool.query(
    `SELECT a.*, c.title AS challenge_title
       FROM assessments a LEFT JOIN challenges c ON c.assessment_id = a.id
      WHERE a.candidate_id = $1 ORDER BY a.created_at DESC`,
    [candidateId],
  );
  const assessments: VerifiedAssessmentHistory[] = [];
  let latestEvaluation: Awaited<ReturnType<typeof getEvaluation>> = null;
  for (const row of assessmentRows.rows) {
    const assessmentId = String(row.id);
    const evaluation = await getEvaluation(assessmentId);
    if (assessments.length === 0) latestEvaluation = evaluation;
    const interview = await pool.query(
      `SELECT id, score FROM interviews WHERE assessment_id = $1 AND interview_type = 'assessment' ORDER BY created_at DESC LIMIT 1`,
      [assessmentId],
    );
    // A missing competency_results table (pre-012 database) must not
    // break the verified profile — the profile is simply absent until
    // migration 012 lands.
    let competencyProfile: StoredCompetencyProfile | null = null;
    try {
      competencyProfile = await getStoredCompetencyProfile(assessmentId);
    } catch {
      competencyProfile = null;
    }
    assessments.push({
      id: assessmentId,
      status: String(row.status),
      challengeTitle: (row.challenge_title as string | null) ?? null,
      overallScore: evaluation?.overallScore ?? null,
      submittedAt: (row.submitted_at as string | null) ?? null,
      interviewId:
        interview.rows.length && interview.rows[0].id
          ? String(interview.rows[0].id)
          : null,
      interviewScore:
        interview.rows.length && interview.rows[0].score !== null
          ? Number(interview.rows[0].score)
          : null,
      competencyProfile,
    });
  }
  const latest = assessmentRows.rows[0];
  let evaluation = null as Awaited<ReturnType<typeof getEvaluation>>;
  let testPassRate: number | null = null;
  let interviewScore: number | null = null;
  let integrityBlock = false;
  if (latest) {
    evaluation = latestEvaluation;
    const tests = await pool.query(
      `SELECT passed, total FROM test_execution_events
        WHERE assessment_id = $1 AND test_command = 'hidden test suite'`,
      [latest.id],
    );
    if (tests.rows.length) {
      const totals = tests.rows.reduce(
        (acc, r) => ({ p: acc.p + Number(r.passed), t: acc.t + Number(r.total) }),
        { p: 0, t: 0 },
      );
      testPassRate = totals.t > 0 ? Math.round((totals.p / totals.t) * 1000) / 10 : null;
    }
    interviewScore = assessments[0]?.interviewScore ?? null;
    const integrity = await pool.query(
      `SELECT 1 FROM integrity_findings WHERE assessment_id = $1 AND status = 'human_review_required' LIMIT 1`,
      [latest.id],
    );
    integrityBlock = integrity.rows.length > 0;
  }
  let status: VerificationStatus = "Not Assessed";
  let competencyProfile: StoredCompetencyProfile | null = null;
  if (latest) {
    // Final competency profile for the latest assessment, when computed.
    competencyProfile = assessments[0]?.competencyProfile ?? null;
    if (["active", "submitted", "evaluating", "ready", "draft"].includes(latest.status as string)) {
      status = "Assessment Pending";
    } else if (latest.status === "completed" && evaluation) {
      const overall = evaluation.overallScore ?? 0;
      if (integrityBlock) status = "Human Review Required";
      // Phase 2 (G1.2): "Verified" comes ONLY from the stored
      // competency profile — a non-null verified category on a final
      // profile, with an interview score actually present. The coding
      // score alone never verifies, and a null interview never
      // verifies: coding 75 + no interview is "Assessment
      // Completed", not "Verified". Any other computed profile
      // (Incomplete / Insufficient Evidence / Practical Threshold
      // Not Met) is likewise "Assessment Completed": the assessment
      // ran, but the competency gate did not verify a category.
      else if (
        competencyProfile !== null &&
        competencyProfile.verifiedCategory !== null &&
        competencyProfile.isFinal &&
        interviewScore !== null
      ) {
        status = "Verified";
      } else if (competencyProfile !== null) {
        status = "Assessment Completed";
      } else if (overall >= 50) {
        // No competency profile computed yet: the assessment ran but
        // nothing verified a category. Never "Verified" without a
        // profile — the bar is the competency gate, not the raw
        // coding score.
        status = "Assessment Completed";
      } else {
        status = "Needs Improvement";
      }
    } else if (latest.status === "failed") {
      status = "Needs Improvement";
    }
  }
  if (integrityBlock && latest?.status === "completed") {
    status = "Human Review Required";
  }
  return {
    candidateId,
    fullName: profile.candidate.full_name,
    completionScore: completeness.percent,
    completionMissing: completeness.missing as string[],
    strengthScore: strength ? Number(strength.overall_score) : null,
    strengthCategories: (strength?.category_scores as Record<string, unknown> | undefined) ?? {},
    verifiedSkills: skills.rows.map((r) => ({
      skill: String(r.skill),
      evidence: (r.evidence as Record<string, unknown> | null) ?? {},
      verifiedAt: String(r.verified_at),
      assessmentId: (r.assessment_id as string | null) ?? null,
    })),
    latestAssessment: latest
      ? {
          id: String(latest.id),
          status: String(latest.status),
          challengeTitle: (latest.challenge_title as string | null) ?? null,
          overallScore: evaluation?.overallScore ?? null,
          testPassRate,
          qualityIssues: evaluation?.qualityIssues ?? [],
          submittedAt: (latest.submitted_at as string | null) ?? null,
        }
      : null,
    assessments,
    interviewScore,
    competencyProfile,
    verificationStatus: status,
    verificationDate:
      status === "Verified" && latest?.submitted_at
        ? String(latest.submitted_at)
        : null,
    evidence: {
      assessmentsCompleted: assessments.filter((a) => a.status === "completed").length,
      verifiedSkillsCount: skills.rows.length,
    },
  };
}

/**
 * Recruiter evidence access: the recruiter must have received an
 * application from this candidate (via one of their jobs). Otherwise 403.
 */
export async function recruiterMayViewCandidate(
  recruiterUserId: string,
  candidateId: string,
): Promise<boolean> {
  const res = await pool.query(
    `SELECT 1 FROM applications a
      JOIN jobs j ON j.id = a.job_id
      JOIN companies c ON c.id = j.company_id
     WHERE a.candidate_id = $1 AND c.created_by = $2 LIMIT 1`,
    [candidateId, recruiterUserId],
  );
  return res.rows.length > 0;
}

export async function getCandidateEvidenceForRecruiter(opts: {
  recruiterUserId: string;
  candidateId: string;
}): Promise<VerifiedProfile> {
  const allowed = await recruiterMayViewCandidate(opts.recruiterUserId, opts.candidateId);
  if (!allowed) {
    throw new ApiError(403, "You can only view evidence for candidates who applied to your jobs");
  }
  return buildVerifiedProfile(opts.candidateId);
}
