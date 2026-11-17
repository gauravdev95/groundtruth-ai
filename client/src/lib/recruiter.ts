// Typed recruiter client for the Ground Truth AI server.
// Mirrors the server's /api/recruiter routes (server/src/routes/recruiter.ts).
// Every call sends the Phase 1 JWT (lib/auth.ts) — the server enforces the
// recruiter role, this client only carries the token.

import { getToken } from "./auth";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";

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
