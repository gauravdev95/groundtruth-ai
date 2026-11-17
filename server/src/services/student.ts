import { pool } from "../config/db";

/**
 * Student (candidate) profile service — Phase 2.
 *
 * One candidate row belongs to one user (`candidates.user_id`). The profile
 * a student sees is always their own row, loaded with every section the
 * onboarding flow writes: skills, projects, coding profiles, certificates,
 * experience, resumes, plus the applications/matches/jobs the dashboard
 * needs. Nothing here is invented: counts come from the tables, GitHub
 * verification comes from `verification_results` (written by the existing
 * github-analysis worker), and completeness is computed from what is
 * actually filled in — it is never stored, so it can never drift.
 */

export interface CandidateRow {
  id: string;
  user_id: string | null;
  full_name: string;
  email: string;
  headline: string | null;
  github_url: string | null;
  linkedin_url: string | null;
  location: string | null;
  summary: string | null;
  phone: string | null;
  degree: string | null;
  branch: string | null;
  graduation_year: number | null;
  target_roles: string[];
  portfolio_url: string | null;
  github_handle: string | null;
  github_handle_exists: boolean | null;
  github_checked_at: string | null;
  onboarding_choice: "resume_upload" | "manual_entry" | null;
  onboarding_completed_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface SkillRow {
  id: string;
  name: string;
  category: string | null;
  source: string;
  confidence: string | null;
}

export interface ProjectRow {
  id: string;
  title: string;
  description: string;
  kind: "repository" | "described";
  repo_url: string | null;
  role: string | null;
  technologies: string[];
  started_at: string | null;
  ended_at: string | null;
  created_at: string;
}

export interface CodingProfileRow {
  id: string;
  platform: string;
  username: string;
  profile_url: string | null;
  verification_status: string;
  created_at: string;
}

export interface CertificateRow {
  id: string;
  title: string;
  issuer: string | null;
  issued_at: string | null;
  credential_url: string | null;
  cloudinary_url: string | null;
  created_at: string;
}

export interface ExperienceRow {
  id: string;
  title: string;
  organization: string;
  employment_type: string;
  start_date: string | null;
  end_date: string | null;
  is_current: boolean;
  description: string;
  created_at: string;
}

export interface ResumeRow {
  id: string;
  file_name: string | null;
  storage: "cloudinary" | "local";
  cloudinary_url: string | null;
  local_path: string | null;
  extracted_text: string | null;
  created_at: string;
}

export interface GithubVerification {
  /** Latest github-analysis result, if the worker has run for this candidate. */
  status: "not_checked" | "checked";
  verified_at: string | null;
  source_ref: string | null;
  score: string | null;
  /** Raw worker result (file counts etc.) — whatever /analyze-repo returned. */
  result: Record<string, unknown> | null;
}

export interface ApplicationRow {
  id: string;
  status: string;
  created_at: string;
  job_id: string;
  job_title: string;
  company_name: string | null;
  job_location: string | null;
  /** Latest `matches.score` for this application, or null when the
   * matching engine has not scored this pair (never invented). */
  match_score: string | null;
}

export interface MatchRow {
  id: string;
  score: string;
  model: string;
  created_at: string;
  job_id: string;
  job_title: string;
  company_name: string | null;
  job_location: string | null;
}

export interface OpenJobRow {
  id: string;
  title: string;
  location: string | null;
  employment_type: string;
  salary_min: number | null;
  salary_max: number | null;
  company_name: string | null;
  created_at: string;
}

export interface FullProfile {
  candidate: CandidateRow;
  skills: SkillRow[];
  projects: ProjectRow[];
  coding_profiles: CodingProfileRow[];
  certificates: CertificateRow[];
  experience: ExperienceRow[];
  resumes: ResumeRow[];
  github_verification: GithubVerification;
  completeness: Completeness;
}

export type SectionKey =
  | "basic"
  | "github"
  | "projects"
  | "coding"
  | "certificates"
  | "experience";

export interface SectionStatus {
  done: boolean;
  /** Short, honest reason shown in the UI, e.g. "Add a headline". */
  detail: string;
}

export interface Completeness {
  /** Weighted 0–100 score over what is filled in (see weights below). */
  percent: number;
  sections: Record<SectionKey, SectionStatus>;
  /** Sections still missing, in stage order — drives "what's next". */
  missing: SectionKey[];
}

/**
 * Section weights (must add to 100). Basic/GitHub/Projects are the
 * mandatory onboarding stages in the old repo's flow, so they carry the
 * weight; coding/certificates/experience are optional stages and weigh
 * less. A student who skips every optional stage still finishes
 * onboarding — at 75%, not 100% — and the UI says exactly that.
 */
const SECTION_WEIGHTS: Record<SectionKey, number> = {
  basic: 25,
  github: 25,
  projects: 25,
  coding: 10,
  certificates: 5,
  experience: 10,
};

export const MANDATORY_SECTIONS: SectionKey[] = ["basic", "github", "projects"];

export function computeCompleteness(input: {
  candidate: Pick<
    CandidateRow,
    | "headline"
    | "location"
    | "summary"
    | "degree"
    | "branch"
    | "graduation_year"
    | "target_roles"
    | "github_url"
    | "github_handle"
  >;
  skillCount: number;
  projectCount: number;
  codingCount: number;
  certificateCount: number;
  experienceCount: number;
}): Completeness {
  const c = input.candidate;
  const basicDone =
    Boolean(c.headline?.trim()) &&
    Boolean(c.location?.trim()) &&
    Boolean(c.summary?.trim()) &&
    Boolean(c.degree) &&
    Boolean(c.branch) &&
    c.graduation_year !== null &&
    c.target_roles.length > 0 &&
    input.skillCount > 0;
  const githubDone = Boolean((c.github_handle ?? "").trim() || (c.github_url ?? "").trim());
  const projectsDone = input.projectCount > 0;
  const codingDone = input.codingCount > 0;
  const certificatesDone = input.certificateCount > 0;
  const experienceDone = input.experienceCount > 0;

  const doneMap: Record<SectionKey, boolean> = {
    basic: basicDone,
    github: githubDone,
    projects: projectsDone,
    coding: codingDone,
    certificates: certificatesDone,
    experience: experienceDone,
  };

  const missingBasic: string[] = [];
  if (!c.headline?.trim()) missingBasic.push("headline");
  if (!c.location?.trim()) missingBasic.push("location");
  if (!c.summary?.trim()) missingBasic.push("summary");
  if (!c.degree || !c.branch || c.graduation_year === null)
    missingBasic.push("education");
  if (c.target_roles.length === 0) missingBasic.push("target role");
  if (input.skillCount === 0) missingBasic.push("skills");

  const sections: Record<SectionKey, SectionStatus> = {
    basic: {
      done: basicDone,
      detail: basicDone
        ? "Headline, location, summary, education, target role and skills filled in."
        : `Add: ${missingBasic.join(", ")}.`,
    },
    github: {
      done: githubDone,
      detail: githubDone
        ? "GitHub account linked."
        : "Link your GitHub account.",
    },
    projects: {
      done: projectsDone,
      detail: projectsDone
        ? `${input.projectCount} project${input.projectCount === 1 ? "" : "s"} added.`
        : "Add at least one project.",
    },
    coding: {
      done: codingDone,
      detail: codingDone
        ? `${input.codingCount} coding profile${input.codingCount === 1 ? "" : "s"} linked.`
        : "Optional — link a LeetCode, Codeforces or CodeChef profile.",
    },
    certificates: {
      done: certificatesDone,
      detail: certificatesDone
        ? `${input.certificateCount} certificate${input.certificateCount === 1 ? "" : "s"} added.`
        : "Optional — add a certificate.",
    },
    experience: {
      done: experienceDone,
      detail: experienceDone
        ? `${input.experienceCount} experience ${input.experienceCount === 1 ? "entry" : "entries"} added.`
        : "Optional — add an internship or work experience.",
    },
  };

  const percent = (Object.keys(SECTION_WEIGHTS) as SectionKey[]).reduce(
    (sum, key) => sum + (doneMap[key] ? SECTION_WEIGHTS[key] : 0),
    0,
  );
  const missing = (Object.keys(doneMap) as SectionKey[]).filter((k) => !doneMap[k]);
  return { percent, sections, missing };
}

/**
 * The candidate row for a user: by user_id first; if the user signed up
 * after a candidate row was seeded under their email, claim that row;
 * otherwise create a fresh row from the account. Never creates a second
 * row for the same user (unique partial index in 004_student.sql).
 */
export async function getOrCreateCandidateForUser(
  userId: string,
  email: string,
  fullName: string,
): Promise<CandidateRow> {
  const byUser = await pool.query<CandidateRow>(
    "SELECT * FROM candidates WHERE user_id = $1",
    [userId],
  );
  if (byUser.rows.length > 0) return byUser.rows[0] as CandidateRow;

  const byEmail = await pool.query<CandidateRow>(
    "SELECT * FROM candidates WHERE email = $1",
    [email],
  );
  if (byEmail.rows.length > 0) {
    const claimed = await pool.query<CandidateRow>(
      "UPDATE candidates SET user_id = $1, updated_at = now() WHERE id = $2 RETURNING *",
      [userId, (byEmail.rows[0] as CandidateRow).id],
    );
    return claimed.rows[0] as CandidateRow;
  }

  const created = await pool.query<CandidateRow>(
    `INSERT INTO candidates (user_id, full_name, email) VALUES ($1, $2, $3) RETURNING *`,
    [userId, fullName, email],
  );
  return created.rows[0] as CandidateRow;
}

export async function loadFullProfile(candidateId: string): Promise<FullProfile> {
  const [candidateRes, skillsRes, projectsRes, codingRes, certsRes, expRes, resumesRes, ghRes] =
    await Promise.all([
      pool.query<CandidateRow>("SELECT * FROM candidates WHERE id = $1", [candidateId]),
      pool.query<SkillRow>(
        `SELECT s.id, s.name, s.category, cs.source, cs.confidence
         FROM candidate_skills cs JOIN skills s ON s.id = cs.skill_id
         WHERE cs.candidate_id = $1 ORDER BY s.name`,
        [candidateId],
      ),
      pool.query<ProjectRow>(
        "SELECT * FROM candidate_projects WHERE candidate_id = $1 ORDER BY created_at DESC",
        [candidateId],
      ),
      pool.query<CodingProfileRow>(
        "SELECT * FROM candidate_coding_profiles WHERE candidate_id = $1 ORDER BY created_at",
        [candidateId],
      ),
      pool.query<CertificateRow>(
        "SELECT * FROM certificates WHERE candidate_id = $1 ORDER BY created_at DESC",
        [candidateId],
      ),
      pool.query<ExperienceRow>(
        "SELECT * FROM candidate_experience WHERE candidate_id = $1 ORDER BY COALESCE(start_date, created_at) DESC",
        [candidateId],
      ),
      pool.query<ResumeRow>(
        `SELECT id, file_name, storage, cloudinary_url, local_path, extracted_text, created_at
         FROM resumes WHERE candidate_id = $1 ORDER BY created_at DESC`,
        [candidateId],
      ),
      pool.query<{
        verified_at: string;
        source_ref: string | null;
        score: string | null;
        result: Record<string, unknown>;
      }>(
        `SELECT verified_at, source_ref, score, result FROM verification_results
         WHERE candidate_id = $1 AND source = 'github'
         ORDER BY verified_at DESC LIMIT 1`,
        [candidateId],
      ),
    ]);

  const candidate = candidateRes.rows[0] as CandidateRow;
  const completeness = computeCompleteness({
    candidate,
    skillCount: skillsRes.rows.length,
    projectCount: projectsRes.rows.length,
    codingCount: codingRes.rows.length,
    certificateCount: certsRes.rows.length,
    experienceCount: expRes.rows.length,
  });

  const gh = ghRes.rows[0];
  return {
    candidate,
    skills: skillsRes.rows,
    projects: projectsRes.rows,
    coding_profiles: codingRes.rows,
    certificates: certsRes.rows,
    experience: expRes.rows,
    resumes: resumesRes.rows,
    github_verification: gh
      ? {
          status: "checked",
          verified_at: gh.verified_at,
          source_ref: gh.source_ref,
          score: gh.score,
          result: gh.result,
        }
      : {
          status: "not_checked",
          verified_at: null,
          source_ref: null,
          score: null,
          result: null,
        },
    completeness,
  };
}

export interface DashboardData {
  profile: FullProfile;
  counts: {
    applications: number;
    matches: number;
    open_jobs: number;
    interviews: number;
  };
  applications: ApplicationRow[];
  matches: MatchRow[];
  open_jobs: OpenJobRow[];
}

export async function loadDashboard(candidateId: string): Promise<DashboardData> {
  const profile = await loadFullProfile(candidateId);
  const [appsRes, matchesRes, jobsRes, countsRes] = await Promise.all([
    pool.query<ApplicationRow>(
      `SELECT a.id, a.status, a.created_at, j.id AS job_id, j.title AS job_title,
              c.name AS company_name, j.location AS job_location,
              m.score AS match_score
       FROM applications a
       JOIN jobs j ON j.id = a.job_id
       LEFT JOIN companies c ON c.id = j.company_id
       LEFT JOIN LATERAL (
         SELECT score FROM matches
         WHERE candidate_id = a.candidate_id AND job_id = a.job_id
         ORDER BY created_at DESC LIMIT 1
       ) m ON true
       WHERE a.candidate_id = $1 ORDER BY a.created_at DESC LIMIT 5`,
      [candidateId],
    ),
    pool.query<MatchRow>(
      `SELECT m.id, m.score, m.model, m.created_at, j.id AS job_id, j.title AS job_title,
              c.name AS company_name, j.location AS job_location
       FROM matches m
       JOIN jobs j ON j.id = m.job_id
       LEFT JOIN companies c ON c.id = j.company_id
       WHERE m.candidate_id = $1 ORDER BY m.score DESC LIMIT 5`,
      [candidateId],
    ),
    pool.query<OpenJobRow>(
      `SELECT j.id, j.title, j.location, j.employment_type, j.salary_min, j.salary_max,
              c.name AS company_name, j.created_at
       FROM jobs j LEFT JOIN companies c ON c.id = j.company_id
       WHERE j.status = 'open' ORDER BY j.created_at DESC LIMIT 5`,
      [],
    ),
    pool.query<{
      applications: string;
      matches: string;
      open_jobs: string;
      interviews: string;
    }>(
      `SELECT
         (SELECT count(*) FROM applications WHERE candidate_id = $1) AS applications,
         (SELECT count(*) FROM matches WHERE candidate_id = $1) AS matches,
         (SELECT count(*) FROM jobs WHERE status = 'open') AS open_jobs,
         (SELECT count(*) FROM interviews WHERE candidate_id = $1) AS interviews`,
      [candidateId],
    ),
  ]);
  const countsRow = countsRes.rows[0] as {
    applications: string;
    matches: string;
    open_jobs: string;
    interviews: string;
  };
  return {
    profile,
    counts: {
      applications: Number(countsRow.applications),
      matches: Number(countsRow.matches),
      open_jobs: Number(countsRow.open_jobs),
      interviews: Number(countsRow.interviews),
    },
    applications: appsRes.rows,
    matches: matchesRes.rows,
    open_jobs: jobsRes.rows,
  };
}

/**
 * Best-effort public GitHub lookup: does this handle exist? Uses the
 * unauthenticated public API (no token, no private data). Returns TRUE /
 * FALSE, or NULL when GitHub could not be reached — NULL means "not
 * checked", never a claim either way. Never throws.
 */
export async function checkGithubHandleExists(handle: string): Promise<boolean | null> {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 5000);
    try {
      const res = await fetch(`https://api.github.com/users/${encodeURIComponent(handle)}`, {
        headers: { "User-Agent": "groundtruth-ai", Accept: "application/vnd.github+json" },
        signal: controller.signal,
      });
      if (res.status === 200) return true;
      if (res.status === 404) return false;
      return null;
    } finally {
      clearTimeout(timer);
    }
  } catch {
    return null;
  }
}

/** Extract a GitHub handle from a handle or a github.com URL. */
export function parseGithubHandle(input: string): string | null {
  const trimmed = input.trim().replace(/\/+$/, "");
  if (!trimmed) return null;
  const urlMatch = trimmed.match(/^(?:https?:\/\/)?(?:www\.)?github\.com\/([^/?#]+)/i);
  if (urlMatch) return urlMatch[1] as string;
  if (/^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/.test(trimmed)) return trimmed;
  return null;
}
