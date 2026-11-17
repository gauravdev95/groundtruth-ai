// Typed client for the Ground Truth AI server.

import { getToken } from "./auth";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";

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
  company_name: string | null;
  created_at: string;
}

/**
 * One application, as returned by /api/applications/* and
 * /api/jobs/:id/applications. `match_score` is the latest `matches.score`
 * (cosine similarity, -1..1) for this candidate+job — or null when the
 * matching engine has not scored the pair. Null is honest, never a fake.
 */
export interface Application {
  id: string;
  status: string;
  created_at: string;
  updated_at: string;
  job_id: string;
  job_title: string;
  company_id: string;
  company_name: string | null;
  job_location: string | null;
  candidate_id: string;
  candidate_name: string;
  candidate_headline: string | null;
  candidate_location: string | null;
  candidate_degree: string | null;
  candidate_branch: string | null;
  candidate_graduation_year: number | null;
  match_score: string | null;
  match_model: string | null;
}

/** A stored cosine score (-1..1) as a whole percent, or null when absent. */
export function formatMatchScore(score: string | number | null): string | null {
  if (score === null || score === undefined) return null;
  const n = typeof score === "string" ? Number(score) : score;
  if (!Number.isFinite(n)) return null;
  return `${Math.round(n * 100)}%`;
}

export interface ApiError {
  message: string;
}

async function request<T>(path: string): Promise<T> {
  const res = await fetch(`${API_URL}${path}`, { cache: "no-store" });
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as ApiError | null;
    throw new Error(body?.message ?? `Request failed: ${res.status}`);
  }
  return res.json() as Promise<T>;
}

async function authedRequest<T>(path: string, init: RequestInit = {}): Promise<T> {
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
  const body = (await res.json().catch(() => null)) as
    | { error?: string }
    | null;
  if (!res.ok) {
    throw new Error(
      (body as { error?: string } | null)?.error ??
        `Request failed: ${res.status}`,
    );
  }
  return body as T;
}

export function fetchJobs(): Promise<Job[]> {
  return request<Job[]>("/api/jobs");
}

export function fetchJob(id: string): Promise<Job> {
  return request<Job>(`/api/jobs/${encodeURIComponent(id)}`);
}

/** "₹40,000–₹60,000", a single bound, or null when no salary is listed. */
export function formatSalaryRange(job: Pick<Job, "salary_min" | "salary_max" | "salary_currency">): string | null {
  const fmt = (n: number) =>
    job.salary_currency === "INR"
      ? `₹${n.toLocaleString("en-IN")}`
      : `${job.salary_currency} ${n.toLocaleString("en-IN")}`;
  if (job.salary_min !== null && job.salary_max !== null) {
    return `${fmt(job.salary_min)}–${fmt(job.salary_max)}`;
  }
  if (job.salary_min !== null) return `From ${fmt(job.salary_min)}`;
  if (job.salary_max !== null) return `Up to ${fmt(job.salary_max)}`;
  return null;
}

/** "Full-time", "Internship", … from the stored employment_type value. */
export function employmentTypeLabel(value: string | null): string {
  if (!value) return "—";
  return value
    .split("_")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

/** Apply to a job as the signed-in candidate (one application per job). */
export function applyToJob(jobId: string): Promise<{
  id: string;
  status: string;
  created_at: string;
  job_id: string;
  job_title: string;
  company_name: string | null;
}> {
  return authedRequest(`/api/jobs/${encodeURIComponent(jobId)}/apply`, {
    method: "POST",
  });
}

/** The signed-in candidate's own applications, newest first. */
export function fetchMyApplications(): Promise<Application[]> {
  return authedRequest<Application[]>("/api/applications/mine");
}

