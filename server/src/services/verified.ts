import { pool } from "../config/db";
import { ApiError } from "../middleware/errorHandler";
import { loadFullProfile, computeCompleteness } from "./student";
import { getEvaluation } from "./evaluation";

// ── Final verified engineering profile ─────────────────────────────────────
// Aggregates completion + strength + verified skills + assessment +
// interview into one honest profile. Verification status is derived from
// real evidence only:
//   Not Assessed      — no assessment ever completed
//   Assessment Pending — an assessment is active/evaluating
//   Assessment Completed — evaluated, but below the verified bar
//   Verified          — evaluation >= 70 and interview >= 60 (when an
//                       interview exists), no blocking integrity finding
//   Needs Improvement — evaluated below the bar
//   Human Review Required — a human_review integrity finding exists
// Untested skills are never labelled verified.

export type VerificationStatus =
  | "Not Assessed"
  | "Assessment Pending"
  | "Assessment Completed"
  | "Verified"
  | "Needs Improvement"
  | "Human Review Required";

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
  interviewScore: number | null;
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
  const assessmentRow = await pool.query(
    `SELECT a.*, c.title AS challenge_title
       FROM assessments a LEFT JOIN challenges c ON c.assessment_id = a.id
      WHERE a.candidate_id = $1 ORDER BY a.created_at DESC LIMIT 1`,
    [candidateId],
  );
  const latest = assessmentRow.rows[0];
  let evaluation = null as Awaited<ReturnType<typeof getEvaluation>>;
  let testPassRate: number | null = null;
  let interviewScore: number | null = null;
  let integrityBlock = false;
  if (latest) {
    evaluation = await getEvaluation(latest.id as string);
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
    const interview = await pool.query(
      `SELECT score FROM interviews WHERE assessment_id = $1 AND interview_type = 'assessment' ORDER BY created_at DESC LIMIT 1`,
      [latest.id],
    );
    interviewScore =
      interview.rows.length && interview.rows[0].score !== null
        ? Number(interview.rows[0].score)
        : null;
    const integrity = await pool.query(
      `SELECT 1 FROM integrity_findings WHERE assessment_id = $1 AND status = 'human_review_required' LIMIT 1`,
      [latest.id],
    );
    integrityBlock = integrity.rows.length > 0;
  }
  let status: VerificationStatus = "Not Assessed";
  if (latest) {
    if (["active", "submitted", "evaluating", "ready", "draft"].includes(latest.status as string)) {
      status = "Assessment Pending";
    } else if (latest.status === "completed" && evaluation) {
      const overall = evaluation.overallScore ?? 0;
      if (integrityBlock) status = "Human Review Required";
      else if (overall >= 70 && (interviewScore === null || interviewScore >= 60)) status = "Verified";
      else if (overall >= 50) status = "Needs Improvement";
      else status = "Needs Improvement";
      if (overall >= 70 && interviewScore !== null && interviewScore < 60) {
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
    interviewScore,
    verificationStatus: status,
    verificationDate:
      status === "Verified" && latest?.submitted_at
        ? String(latest.submitted_at)
        : null,
    evidence: {
      assessmentsCompleted: latest?.status === "completed" ? 1 : 0,
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
