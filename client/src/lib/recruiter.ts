// Typed recruiter client for the Ground Truth AI server.
// Mirrors the server's /api/recruiter routes (server/src/routes/recruiter.ts).
// Every call sends the Phase 1 JWT (lib/auth.ts) — the server enforces the
// recruiter role, this client only carries the token.

import { getToken } from "./auth";
import { API_URL } from "./api-config";

export type CompanySize = "1-10" | "11-50" | "51-200" | "201-1000" | "1000+";

export const COMPANY_SIZE_OPTIONS: { value: CompanySize; label: string }[] = [
  { value: "1-10", label: "1–10 employees" },
  { value: "11-50", label: "11–50 employees" },
  { value: "51-200", label: "51–200 employees" },
  { value: "201-1000", label: "201–1,000 employees" },
  { value: "1000+", label: "1,000+ employees" },
];

export function companySizeLabel(value: string | null): string {
  return COMPANY_SIZE_OPTIONS.find((o) => o.value === value)?.label ?? value ?? "—";
}

export interface RecruiterUser {
  id: string;
  email: string;
  full_name: string;
  role: string;
}

export interface Company {
  id: string;
  name: string;
  website: string | null;
  description: string | null;
  industry: string | null;
  size: CompanySize | null;
  location: string | null;
  created_at: string;
}

export interface RecruiterProfileRow {
  id: string;
  user_id: string;
  company_id: string | null;
  job_title: string | null;
  phone: string | null;
  linkedin_url: string | null;
}

export interface RecruiterCompleteness {
  percent: number;
  sections: {
    personal: { done: boolean; detail: string };
    company: { done: boolean; detail: string };
  };
  missing: Array<"personal" | "company">;
}

export interface RecruiterProfileData {
  user: RecruiterUser;
  profile: RecruiterProfileRow;
  company: Company | null;
  completeness: RecruiterCompleteness;
}

export interface RecruiterJob {
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

export interface RecruiterApplication {
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
   *  — same SQL derivation as the applications list: Complete +
   *  complete interview coverage only) and profile status — all null
   *  when no profile has been computed yet ("Not assessed").
   *  `competency_provisional_category` is the provisional band;
   *  `competency_provisional_note` is the stored interview-coverage
   *  note for a partial interview. */
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
  jobs: RecruiterJob[];
  applications: RecruiterApplication[];
}

export interface RecruiterProfileInput {
  full_name?: string;
  job_title?: string | null;
  phone?: string | null;
  linkedin_url?: string | null;
  company_name?: string | null;
  company_website?: string | null;
  company_industry?: string | null;
  company_size?: CompanySize | null;
  company_location?: string | null;
  company_about?: string | null;
}

async function recruiterRequest<T>(path: string, init: RequestInit = {}): Promise<T> {
  const token = getToken();
  if (!token) throw new Error("You are signed out — please sign in again.");
  const res = await fetch(`${API_URL}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
      ...(init.headers ?? {}),
    },
  });
  if (res.status === 204) return undefined as T;
  const body = (await res.json().catch(() => null)) as { error?: string } | null;
  if (!res.ok) {
    throw new Error(body?.error ?? `Request failed: ${res.status}`);
  }
  return body as T;
}

export function fetchRecruiterProfile(): Promise<RecruiterProfileData> {
  return recruiterRequest<RecruiterProfileData>("/api/recruiter/profile");
}

export function updateRecruiterProfile(
  input: RecruiterProfileInput,
): Promise<RecruiterProfileData> {
  return recruiterRequest<RecruiterProfileData>("/api/recruiter/profile", {
    method: "PUT",
    body: JSON.stringify(input),
  });
}

export function fetchRecruiterDashboard(): Promise<RecruiterDashboardData> {
  return recruiterRequest<RecruiterDashboardData>("/api/recruiter/dashboard");
}

export type EmploymentType = "full_time" | "part_time" | "contract" | "internship";

export const EMPLOYMENT_TYPE_OPTIONS: { value: EmploymentType; label: string }[] = [
  { value: "full_time", label: "Full-time" },
  { value: "part_time", label: "Part-time" },
  { value: "contract", label: "Contract" },
  { value: "internship", label: "Internship" },
];

export function employmentTypeLabel(value: string | null): string {
  return (
    EMPLOYMENT_TYPE_OPTIONS.find((o) => o.value === value)?.label ??
    value?.replace("_", " ") ??
    "—"
  );
}

export interface PostJobInput {
  company_id: string;
  title: string;
  description: string;
  location?: string | null;
  employment_type?: EmploymentType;
  salary_min?: number | null;
  salary_max?: number | null;
  salary_currency?: string;
}

/** Post a job under the recruiter's own company (server enforces ownership). */
export function postJob(input: PostJobInput): Promise<Job> {
  return recruiterRequest<Job>("/api/jobs", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export interface Job {
  id: string;
  company_id: string;
  title: string;
  description: string;
  location: string | null;
  employment_type: string;
  salary_min: number | null;
  salary_max: number | null;
  salary_currency: string;
  status: string;
  created_at: string;
  updated_at: string;
}

/** Every application across the recruiter's own company's jobs. */
export function fetchRecruiterApplications(): Promise<
  import("./api").Application[]
> {
  return recruiterRequest<import("./api").Application[]>(
    "/api/recruiter/applications",
  );
}

/** One application + the applicant's full student profile (read-only). */
export function fetchApplicationDetail(id: string): Promise<{
  application: import("./api").Application;
  profile: import("./student").FullProfile;
}> {
  return recruiterRequest(`/api/applications/${encodeURIComponent(id)}`);
}

export type RecruiterApplicationStatus =
  | "reviewing"
  | "interview"
  | "offer"
  | "rejected";

export const RECRUITER_STATUS_OPTIONS: {
  value: RecruiterApplicationStatus;
  label: string;
}[] = [
  { value: "reviewing", label: "Reviewing" },
  { value: "interview", label: "Interview" },
  { value: "offer", label: "Offer" },
  { value: "rejected", label: "Rejected" },
];

/** Move an application through the pipeline. */
export function updateApplicationStatus(
  id: string,
  status: RecruiterApplicationStatus,
): Promise<import("./api").Application> {
  return recruiterRequest(`/api/applications/${encodeURIComponent(id)}/status`, {
    method: "PATCH",
    body: JSON.stringify({ status }),
  });
}

// ── Phase 6: recruiter analytics ─────────────────────────────────────────

export type AnalyticsStatus =
  | "applied"
  | "reviewing"
  | "interview"
  | "offer"
  | "rejected"
  | "withdrawn";

export type FunnelStage = "applied" | "reviewing" | "interview" | "offer";

export interface AnalyticsJobRow {
  id: string;
  title: string;
  status: string;
  created_at: string;
  applications: number;
  by_status: Record<AnalyticsStatus, number>;
}

export interface ActivityPoint {
  date: string;
  applications: number;
  matches: number;
}

export interface RecruiterAnalytics {
  company: { id: string; name: string } | null;
  counts: {
    jobs_total: number;
    jobs_open: number;
    jobs_closed: number;
    jobs_draft: number;
    applications: number;
    matches: number;
    interviews: number;
    applicants: number;
  };
  by_status: Record<AnalyticsStatus, number>;
  funnel: {
    reached: Record<FunnelStage, number>;
    conversion: {
      applied_to_reviewing: number | null;
      reviewing_to_interview: number | null;
      interview_to_offer: number | null;
    };
  };
  /** Average hours from application to first pipeline move, or null when
   * no application has a recorded first move yet. */
  avg_time_to_first_response_hours: number | null;
  first_response_sample: number;
  by_job: AnalyticsJobRow[];
  activity: { window_days: number; series: ActivityPoint[] };
  verification: {
    applicants: number;
    github_checked: number;
    coding_profiles: number;
    coding_verified: number;
  };
}

/** Real aggregates over the recruiter's own company's jobs/applications. */
export function fetchRecruiterAnalytics(): Promise<RecruiterAnalytics> {
  return recruiterRequest<RecruiterAnalytics>("/api/recruiter/analytics");
}
