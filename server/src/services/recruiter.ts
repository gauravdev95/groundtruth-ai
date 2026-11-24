import { pool } from "../config/db";

/**
 * Recruiter profile service — Phase 3.
 *
 * One recruiter user owns one company row: the row created at
 * registration (routes/auth.ts inserts into `companies` with
 * created_by = the recruiter's user id). This service links the
 * recruiter to that row via `recruiter_profiles` and never creates a
 * second company for the same recruiter.
 *
 * Completeness is computed server-side on every read from what is
 * actually filled in — it is never stored, so it can never drift.
 * Dashboard counts come straight from the jobs / applications /
 * matches / interviews tables, scoped to the recruiter's company.
 * Empty tables produce 0s and empty lists, never invented numbers.
 */

export const COMPANY_SIZES = [
  "1-10",
  "11-50",
  "51-200",
  "201-1000",
  "1000+",
] as const;

export type CompanySize = (typeof COMPANY_SIZES)[number];

export interface CompanyRow {
  id: string;
  name: string;
  website: string | null;
  description: string | null;
  industry: string | null;
  size: CompanySize | null;
  location: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface RecruiterProfileRow {
  id: string;
  user_id: string;
  company_id: string | null;
  job_title: string | null;
  phone: string | null;
  linkedin_url: string | null;
  created_at: string;
  updated_at: string;
}

export interface RecruiterUser {
  id: string;
  email: string;
  full_name: string;
  role: string;
}

export interface RecruiterSectionStatus {
  done: boolean;
  /** Short, honest reason shown in the UI, e.g. "Add your job title". */
  detail: string;
}

export interface RecruiterCompleteness {
  /** Weighted 0–100 score over what is filled in (see weights below). */
  percent: number;
  sections: {
    personal: RecruiterSectionStatus;
    company: RecruiterSectionStatus;
  };
  /** Sections still missing, in order — drives "what's next". */
  missing: Array<"personal" | "company">;
}

export interface RecruiterProfileData {
  user: RecruiterUser;
  profile: RecruiterProfileRow;
  /** Null until the recruiter has a company row (see getOrCreate below). */
  company: CompanyRow | null;
  completeness: RecruiterCompleteness;
}

/**
 * Field weights (must add to 100). Personal details carry 40, the company
 * profile 60 — a recruiter who has filled in everything about themselves
 * but nothing about the company sits at 40%, and the UI says exactly
 * what is still missing.
 */
const FIELD_WEIGHTS = {
  job_title: 20,
  phone: 20,
  company_name: 15,
  company_website: 10,
  company_industry: 10,
  company_size: 10,
  company_location: 5,
  company_about: 10,
} as const;

export function computeRecruiterCompleteness(input: {
  job_title: string | null;
  phone: string | null;
  company: Pick<
    CompanyRow,
    "name" | "website" | "industry" | "size" | "location" | "description"
  > | null;
}): RecruiterCompleteness {
  const c = input.company;
  const filled = {
    job_title: Boolean(input.job_title?.trim()),
    phone: Boolean(input.phone?.trim()),
    company_name: Boolean(c?.name?.trim()),
    company_website: Boolean(c?.website?.trim()),
    company_industry: Boolean(c?.industry?.trim()),
    company_size: Boolean(c?.size),
    company_location: Boolean(c?.location?.trim()),
    company_about: Boolean(c?.description?.trim()),
  };
  const percent = (Object.keys(FIELD_WEIGHTS) as Array<keyof typeof FIELD_WEIGHTS>).reduce(
    (sum, key) => sum + (filled[key] ? FIELD_WEIGHTS[key] : 0),
    0,
  );

  const missingPersonal: string[] = [];
  if (!filled.job_title) missingPersonal.push("job title");
  if (!filled.phone) missingPersonal.push("phone");
  const personalDone = missingPersonal.length === 0;

  const missingCompany: string[] = [];
  if (!filled.company_name) missingCompany.push("company name");
  if (!filled.company_website) missingCompany.push("website");
  if (!filled.company_industry) missingCompany.push("industry");
  if (!filled.company_size) missingCompany.push("size");
  if (!filled.company_location) missingCompany.push("location");
  if (!filled.company_about) missingCompany.push("about");
  const companyDone = missingCompany.length === 0;

  const missing: Array<"personal" | "company"> = [];
  if (!personalDone) missing.push("personal");
  if (!companyDone) missing.push("company");

  return {
    percent,
    sections: {
      personal: {
        done: personalDone,
        detail: personalDone
          ? "Job title and phone filled in."
          : `Add: ${missingPersonal.join(", ")}.`,
      },
      company: {
        done: companyDone,
        detail: companyDone
          ? "Company name, website, industry, size, location and about filled in."
          : c
            ? `Add: ${missingCompany.join(", ")}.`
            : "No company profile yet — save a company name to create it.",
      },
    },
    missing,
  };
}

/**
 * The recruiter's profile row + company, creating the profile row on
 * first use. The company is found in this order:
 *   1. `recruiter_profiles.company_id` (linked on a previous save), then
 *   2. the `companies` row created at registration
 *      (`created_by = user id`), which is linked back to the profile.
 * If neither exists (accounts that predate this table, e.g. the Phase 0
 * demo recruiter), `company` is null until the recruiter saves a company
 * name — the PUT handler then creates the row. A company row is never
 * invented with a guessed name.
 */
export async function getOrCreateRecruiterForUser(
  userId: string,
): Promise<{ profile: RecruiterProfileRow; company: CompanyRow | null }> {
  const profileRes = await pool.query<RecruiterProfileRow>(
    "SELECT * FROM recruiter_profiles WHERE user_id = $1",
    [userId],
  );
  let profile = profileRes.rows[0] as RecruiterProfileRow | undefined;
  if (!profile) {
    const created = await pool.query<RecruiterProfileRow>(
      "INSERT INTO recruiter_profiles (user_id) VALUES ($1) RETURNING *",
      [userId],
    );
    profile = created.rows[0] as RecruiterProfileRow;
  }

  let company: CompanyRow | null = null;
  if (profile.company_id) {
    const byId = await pool.query<CompanyRow>(
      "SELECT * FROM companies WHERE id = $1",
      [profile.company_id],
    );
    company = (byId.rows[0] as CompanyRow | undefined) ?? null;
  }
  if (!company) {
    const byCreator = await pool.query<CompanyRow>(
      "SELECT * FROM companies WHERE created_by = $1 ORDER BY created_at ASC LIMIT 1",
      [userId],
    );
    company = (byCreator.rows[0] as CompanyRow | undefined) ?? null;
    if (company && !profile.company_id) {
      const linked = await pool.query<RecruiterProfileRow>(
        `UPDATE recruiter_profiles SET company_id = $1, updated_at = now()
         WHERE id = $2 RETURNING *`,
        [company.id, profile.id],
      );
      profile = linked.rows[0] as RecruiterProfileRow;
    }
  }
  return { profile, company };
}

/** Load the full recruiter profile (user + profile row + company + completeness). */
export async function loadRecruiterProfile(userId: string): Promise<RecruiterProfileData> {
  const userRes = await pool.query<RecruiterUser>(
    "SELECT id, email, full_name, role FROM users WHERE id = $1",
    [userId],
  );
  const user = userRes.rows[0] as RecruiterUser | undefined;
  if (!user) throw new Error("Recruiter account not found");
  const { profile, company } = await getOrCreateRecruiterForUser(userId);
  return {
    user,
    profile,
    company,
    completeness: computeRecruiterCompleteness({
      job_title: profile.job_title,
      phone: profile.phone,
      company,
    }),
  };
}

/** The company id a recruiter may act on, or null when they have none yet. */
export async function ownCompanyId(userId: string): Promise<string | null> {
  const { company } = await getOrCreateRecruiterForUser(userId);
  return company?.id ?? null;
}

// ── Dashboard ────────────────────────────────────────────────────────────

export interface RecruiterJobRow {
  id: string;
  title: string;
  location: string | null;
  employment_type: string;
  salary_min: number | null;
  salary_max: number | null;
  status: string;
  created_at: string;
  application_count: number;
}

export interface RecruiterApplicationRow {
  id: string;
  status: string;
  created_at: string;
  job_id: string;
  job_title: string;
  candidate_id: string;
  candidate_name: string;
  candidate_headline: string | null;
  /** Latest `matches.score` for this candidate+job, or null when the
   * matching engine has not scored this pair (never invented). */
  match_score: string | null;
  /** Latest computed competency profile for this candidate (Phase F):
   *  overall score, VERIFIED category id (L1–L4, null unless verified
   *  — same derivation as applications.ts LATEST_COMPETENCY_SQL) and
   *  profile status — all null when no profile has been computed yet
   *  ("Not assessed"). `competency_provisional_category` is the
   *  provisional band; `competency_provisional_note` is the stored
   *  interview-coverage note for a partial interview. */
  competency_overall_score: number | null;
  competency_category: string | null;
  competency_status: string | null;
  competency_provisional_category: string | null;
  competency_classification_rule_version: string | null;
  competency_provisional_note: string | null;
}

export interface RecruiterDashboardData {
  profile: RecruiterProfileData;
  counts: {
    jobs_total: number;
    jobs_open: number;
    applications: number;
    matches: number;
    interviews: number;
  };
  jobs: RecruiterJobRow[];
  applications: RecruiterApplicationRow[];
}

export async function loadRecruiterDashboard(
  userId: string,
): Promise<RecruiterDashboardData> {
  const profile = await loadRecruiterProfile(userId);
  const companyId = profile.company?.id ?? null;

  // No company yet → nothing can exist under it. Return honest zeroes
  // rather than querying with a NULL company id.
  if (!companyId) {
    return {
      profile,
      counts: { jobs_total: 0, jobs_open: 0, applications: 0, matches: 0, interviews: 0 },
      jobs: [],
      applications: [],
    };
  }

  const [countsRes, jobsRes, appsRes] = await Promise.all([
    pool.query<{
      jobs_total: string;
      jobs_open: string;
      applications: string;
      matches: string;
      interviews: string;
    }>(
      `SELECT
         (SELECT count(*) FROM jobs WHERE company_id = $1) AS jobs_total,
         (SELECT count(*) FROM jobs WHERE company_id = $1 AND status = 'open') AS jobs_open,
         (SELECT count(*) FROM applications a JOIN jobs j ON j.id = a.job_id
            WHERE j.company_id = $1) AS applications,
         (SELECT count(*) FROM matches m JOIN jobs j ON j.id = m.job_id
            WHERE j.company_id = $1) AS matches,
         (SELECT count(*) FROM interviews i JOIN jobs j ON j.id = i.job_id
            WHERE j.company_id = $1) AS interviews`,
      [companyId],
    ),
    pool.query<RecruiterJobRow>(
      `SELECT j.id, j.title, j.location, j.employment_type, j.salary_min,
              j.salary_max, j.status, j.created_at,
              (SELECT count(*) FROM applications a WHERE a.job_id = j.id)::int
                AS application_count
       FROM jobs j WHERE j.company_id = $1
       ORDER BY j.created_at DESC LIMIT 5`,
      [companyId],
    ),
    pool.query<RecruiterApplicationRow>(
      `SELECT a.id, a.status, a.created_at, j.id AS job_id, j.title AS job_title,
              c.id AS candidate_id, c.full_name AS candidate_name, c.headline AS candidate_headline,
              m.score AS match_score,
              comp.overall_score::float AS competency_overall_score,
              comp.overall_category AS competency_category,
              comp.status AS competency_status,
              comp.provisional_category AS competency_provisional_category,
              comp.classification_rule_version AS competency_classification_rule_version,
              comp.provisional_note AS competency_provisional_note
       FROM applications a
       JOIN jobs j ON j.id = a.job_id
       JOIN candidates c ON c.id = a.candidate_id
       LEFT JOIN LATERAL (
         SELECT score FROM matches
         WHERE candidate_id = a.candidate_id AND job_id = a.job_id
         ORDER BY created_at DESC LIMIT 1
       ) m ON true
       LEFT JOIN LATERAL (
         SELECT cr.overall_score,
                CASE WHEN cr.status = 'Complete'
                          AND COALESCE((cr.result->'profile'->'interviewCoverage'->>'complete')::boolean, true)
                     THEN cr.overall_category ELSE NULL END AS overall_category,
                cr.status,
                COALESCE(cr.result->'profile'->>'provisionalCategory', cr.overall_category) AS provisional_category,
                COALESCE(cr.result->'profile'->>'classificationRuleVersion', 'pre-provisional-vs-verified (overallCategory was provisional)') AS classification_rule_version,
                cr.result->'profile'->'interviewCoverage'->>'provisionalNote' AS provisional_note
         FROM competency_results cr
         WHERE cr.candidate_id = a.candidate_id
         ORDER BY cr.computed_at DESC LIMIT 1
       ) comp ON true
       WHERE j.company_id = $1 ORDER BY a.created_at DESC LIMIT 5`,
      [companyId],
    ),
  ]);
  const countsRow = countsRes.rows[0] as {
    jobs_total: string;
    jobs_open: string;
    applications: string;
    matches: string;
    interviews: string;
  };
  return {
    profile,
    counts: {
      jobs_total: Number(countsRow.jobs_total),
      jobs_open: Number(countsRow.jobs_open),
      applications: Number(countsRow.applications),
      matches: Number(countsRow.matches),
      interviews: Number(countsRow.interviews),
    },
    jobs: jobsRes.rows,
    applications: appsRes.rows,
  };
}
