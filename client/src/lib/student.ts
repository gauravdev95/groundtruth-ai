// Typed student client for the Ground Truth AI server.
// Mirrors the server's /api/student routes (server/src/routes/student.ts).
// Every call sends the Phase 1 JWT (lib/auth.ts) — the server enforces the
// candidate role, this client only carries the token.

import { getToken } from "./auth";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";

export type SectionKey =
  | "basic"
  | "github"
  | "projects"
  | "coding"
  | "certificates"
  | "experience";

export interface Candidate {
  id: string;
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
}

export interface Skill {
  id: string;
  name: string;
  category: string | null;
  source: string;
  confidence: string | null;
}

export interface Project {
  id: string;
  title: string;
  description: string;
  kind: "repository" | "described";
  repo_url: string | null;
  role: string | null;
  technologies: string[];
  started_at: string | null;
  ended_at: string | null;
}

export interface CodingProfile {
  id: string;
  platform: string;
  username: string;
  profile_url: string | null;
  verification_status: string;
}

export interface Certificate {
  id: string;
  title: string;
  issuer: string | null;
  issued_at: string | null;
  credential_url: string | null;
  cloudinary_url: string | null;
}

export interface Experience {
  id: string;
  title: string;
  organization: string;
  employment_type: string;
  start_date: string | null;
  end_date: string | null;
  is_current: boolean;
  description: string;
}

export interface Resume {
  id: string;
  file_name: string | null;
  storage: "cloudinary" | "local";
  cloudinary_url: string | null;
  local_path: string | null;
  extracted_text: string | null;
  created_at: string;
}

export interface SectionStatus {
  done: boolean;
  detail: string;
}

export interface Completeness {
  percent: number;
  sections: Record<SectionKey, SectionStatus>;
  missing: SectionKey[];
}

export interface VerificationResult {
  id: string;
  source: string;
  source_ref: string | null;
  score: string | null;
  result: Record<string, unknown>;
  verified_at: string;
}

export interface EvidenceReport {
  id: string;
  title: string;
  cloudinary_url: string;
  created_at: string;
}

export interface GithubVerification {
  status: "not_checked" | "checked";
  verified_at: string | null;
  source_ref: string | null;
  score: string | null;
  result: Record<string, unknown> | null;
}

export interface FullProfile {
  candidate: Candidate;
  skills: Skill[];
  projects: Project[];
  coding_profiles: CodingProfile[];
  certificates: Certificate[];
  experience: Experience[];
  resumes: Resume[];
  github_verification: GithubVerification;
  /** Latest verification row per source, or [] when no check ever ran. */
  verification_results: VerificationResult[];
  /** Stored evidence-report files, if any. */
  evidence_reports: EvidenceReport[];
  completeness: Completeness;
}

export interface DashboardApplication {
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

export interface DashboardMatch {
  id: string;
  score: string;
  model: string;
  created_at: string;
  job_id: string;
  job_title: string;
  company_name: string | null;
  job_location: string | null;
}

export interface DashboardOpenJob {
  id: string;
  title: string;
  location: string | null;
  employment_type: string;
  salary_min: number | null;
  salary_max: number | null;
  company_name: string | null;
  created_at: string;
}

export interface DashboardData {
  profile: FullProfile;
  counts: {
    applications: number;
    matches: number;
    open_jobs: number;
    interviews: number;
  };
  applications: DashboardApplication[];
  matches: DashboardMatch[];
  open_jobs: DashboardOpenJob[];
}

export interface ProfileInput {
  full_name?: string;
  headline?: string | null;
  location?: string | null;
  summary?: string | null;
  phone?: string | null;
  degree?: string | null;
  branch?: string | null;
  graduation_year?: number | null;
  target_roles?: string[];
  linkedin_url?: string | null;
  portfolio_url?: string | null;
  skills?: string[];
}

export interface ProjectInput {
  title: string;
  description?: string;
  kind?: "repository" | "described";
  repo_url?: string | null;
  role?: string | null;
  technologies?: string[];
  started_at?: string | null;
  ended_at?: string | null;
}

export interface CodingProfileInput {
  platform: string;
  username: string;
  profile_url?: string | null;
}

export interface CertificateInput {
  title: string;
  issuer?: string | null;
  issued_at?: string | null;
  credential_url?: string | null;
}

export interface ExperienceInput {
  title: string;
  organization: string;
  employment_type?: string;
  start_date?: string | null;
  end_date?: string | null;
  is_current?: boolean;
  description?: string;
}

async function studentRequest<T>(path: string, init: RequestInit = {}): Promise<T> {
  const token = getToken();
  if (!token) throw new Error("You are signed out — please sign in again.");
  const res = await fetch(`${API_URL}${path}`, {
    ...init,
    headers: {
      ...(init.body instanceof FormData
        ? {}
        : { "Content-Type": "application/json" }),
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

export function fetchProfile(): Promise<FullProfile> {
  return studentRequest<FullProfile>("/api/student/profile");
}

export function updateProfile(input: ProfileInput): Promise<FullProfile> {
  return studentRequest<FullProfile>("/api/student/profile", {
    method: "PUT",
    body: JSON.stringify(input),
  });
}

export function setOnboardingChoice(
  choice: "resume_upload" | "manual_entry",
): Promise<{ onboarding_choice: string }> {
  return studentRequest("/api/student/onboarding/choice", {
    method: "POST",
    body: JSON.stringify({ choice }),
  });
}

export function completeOnboarding(): Promise<FullProfile> {
  return studentRequest<FullProfile>("/api/student/profile/complete", {
    method: "POST",
  });
}

export function updateGithub(input: {
  github_handle?: string;
  github_url?: string | null;
}): Promise<FullProfile> {
  return studentRequest<FullProfile>("/api/student/profile/github", {
    method: "PUT",
    body: JSON.stringify(input),
  });
}

export function fetchDashboard(): Promise<DashboardData> {
  return studentRequest<DashboardData>("/api/student/dashboard");
}

export async function uploadResume(
  file: File,
): Promise<{ resume: Resume | null; storage: string; resume_parsing: string }> {
  const form = new FormData();
  form.append("file", file);
  return studentRequest("/api/student/resume", { method: "POST", body: form });
}

export function resumeDownloadUrl(resume: Resume): string {
  if (resume.storage === "cloudinary" && resume.cloudinary_url) {
    return resume.cloudinary_url;
  }
  return `${API_URL}/api/student/resume/${resume.id}/file`;
}

/**
 * Download a resume in the browser. Cloudinary files are plain links;
 * locally stored files need the JWT, so they are fetched with the token
 * and saved from a blob — a plain <a href> would arrive without auth.
 */
export async function downloadResumeFile(resume: Resume): Promise<void> {
  if (resume.storage === "cloudinary" && resume.cloudinary_url) {
    window.open(resume.cloudinary_url, "_blank", "noopener");
    return;
  }
  const token = getToken();
  if (!token) throw new Error("You are signed out — please sign in again.");
  const res = await fetch(`${API_URL}/api/student/resume/${resume.id}/file`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error(`Download failed: ${res.status}`);
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = resume.file_name ?? "resume.pdf";
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export function createProject(input: ProjectInput): Promise<Project> {
  return studentRequest<Project>("/api/student/projects", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export function updateProject(id: string, input: ProjectInput): Promise<Project> {
  return studentRequest<Project>(`/api/student/projects/${id}`, {
    method: "PUT",
    body: JSON.stringify(input),
  });
}

export function deleteProject(id: string): Promise<void> {
  return studentRequest<void>(`/api/student/projects/${id}`, { method: "DELETE" });
}

export function createCodingProfile(input: CodingProfileInput): Promise<CodingProfile> {
  return studentRequest<CodingProfile>("/api/student/coding-profiles", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export function updateCodingProfile(
  id: string,
  input: CodingProfileInput,
): Promise<CodingProfile> {
  return studentRequest<CodingProfile>(`/api/student/coding-profiles/${id}`, {
    method: "PUT",
    body: JSON.stringify(input),
  });
}

export function deleteCodingProfile(id: string): Promise<void> {
  return studentRequest<void>(`/api/student/coding-profiles/${id}`, {
    method: "DELETE",
  });
}

export function createCertificate(input: CertificateInput): Promise<Certificate> {
  return studentRequest<Certificate>("/api/student/certificates", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export function updateCertificate(
  id: string,
  input: CertificateInput,
): Promise<Certificate> {
  return studentRequest<Certificate>(`/api/student/certificates/${id}`, {
    method: "PUT",
    body: JSON.stringify(input),
  });
}

export function deleteCertificate(id: string): Promise<void> {
  return studentRequest<void>(`/api/student/certificates/${id}`, {
    method: "DELETE",
  });
}

export function createExperience(input: ExperienceInput): Promise<Experience> {
  return studentRequest<Experience>("/api/student/experience", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export function updateExperience(
  id: string,
  input: ExperienceInput,
): Promise<Experience> {
  return studentRequest<Experience>(`/api/student/experience/${id}`, {
    method: "PUT",
    body: JSON.stringify(input),
  });
}

export function deleteExperience(id: string): Promise<void> {
  return studentRequest<void>(`/api/student/experience/${id}`, {
    method: "DELETE",
  });
}

// ── Onboarding stages (old repo's eight stages, same slugs/order) ────────

export interface OnboardingStage {
  slug: string;
  label: string;
  /** Position in the flow, 0–100. Progress through the flow, not strength. */
  percent: number;
  isMandatory: boolean;
  section: SectionKey | null;
}

export const ONBOARDING_STAGES: readonly OnboardingStage[] = [
  { slug: "", label: "Get started", percent: 0, isMandatory: true, section: null },
  { slug: "basic-info", label: "Basic info", percent: 15, isMandatory: true, section: "basic" },
  { slug: "github", label: "GitHub", percent: 30, isMandatory: true, section: "github" },
  { slug: "projects", label: "Projects", percent: 50, isMandatory: true, section: "projects" },
  { slug: "coding-profile", label: "Coding profile", percent: 65, isMandatory: false, section: "coding" },
  { slug: "certificates", label: "Certificates", percent: 80, isMandatory: false, section: "certificates" },
  { slug: "experience", label: "Experience", percent: 90, isMandatory: false, section: "experience" },
  { slug: "review", label: "Review & submit", percent: 100, isMandatory: true, section: null },
];

export function stagePath(stage: OnboardingStage): string {
  return stage.slug ? `/student/onboarding/${stage.slug}` : "/student/onboarding";
}

export function stageBySlug(slug: string): OnboardingStage | undefined {
  return ONBOARDING_STAGES.find((s) => s.slug === slug);
}

export function nextStage(stage: OnboardingStage): OnboardingStage | undefined {
  return ONBOARDING_STAGES[ONBOARDING_STAGES.indexOf(stage) + 1];
}

export function previousStage(stage: OnboardingStage): OnboardingStage | undefined {
  const i = ONBOARDING_STAGES.indexOf(stage);
  return i > 0 ? ONBOARDING_STAGES[i - 1] : undefined;
}

/** First stage whose section is not done yet (or review when all are done). */
export function firstIncompleteStage(profile: FullProfile): OnboardingStage {
  const order: SectionKey[] = ["basic", "github", "projects", "coding", "certificates", "experience"];
  for (const key of order) {
    if (!profile.completeness.sections[key].done) {
      return ONBOARDING_STAGES.find((s) => s.section === key) as OnboardingStage;
    }
  }
  return ONBOARDING_STAGES[ONBOARDING_STAGES.length - 1] as OnboardingStage;
}

export const DEGREE_OPTIONS = [
  { value: "btech", label: "B.Tech" },
  { value: "be", label: "B.E." },
  { value: "bsc", label: "B.Sc." },
  { value: "bca", label: "BCA" },
  { value: "mtech", label: "M.Tech" },
  { value: "msc", label: "M.Sc." },
  { value: "mca", label: "MCA" },
  { value: "mba", label: "MBA" },
  { value: "phd", label: "PhD" },
  { value: "other", label: "Other" },
];

export const BRANCH_OPTIONS = [
  { value: "cse", label: "Computer Science" },
  { value: "it", label: "Information Technology" },
  { value: "ece", label: "Electronics & Communication" },
  { value: "eee", label: "Electrical & Electronics" },
  { value: "mechanical", label: "Mechanical" },
  { value: "civil", label: "Civil" },
  { value: "chemical", label: "Chemical" },
  { value: "aiml", label: "AI & Machine Learning" },
  { value: "data_science", label: "Data Science" },
  { value: "other", label: "Other" },
];

export const TARGET_ROLE_OPTIONS = [
  { value: "backend", label: "Backend Engineer" },
  { value: "frontend", label: "Frontend Engineer" },
  { value: "fullstack", label: "Full-stack Engineer" },
  { value: "mobile", label: "Mobile Engineer" },
  { value: "data_engineer", label: "Data Engineer" },
  { value: "data_scientist", label: "Data Scientist" },
  { value: "ml_engineer", label: "ML Engineer" },
  { value: "devops", label: "DevOps Engineer" },
  { value: "qa", label: "QA Engineer" },
  { value: "security", label: "Security Engineer" },
  { value: "other", label: "Other" },
];

export const CODING_PLATFORM_OPTIONS = [
  { value: "leetcode", label: "LeetCode" },
  { value: "codeforces", label: "Codeforces" },
  { value: "codechef", label: "CodeChef" },
  { value: "hackerrank", label: "HackerRank" },
  { value: "atcoder", label: "AtCoder" },
  { value: "geeksforgeeks", label: "GeeksforGeeks" },
  { value: "other", label: "Other" },
];

export const EMPLOYMENT_TYPE_OPTIONS = [
  { value: "internship", label: "Internship" },
  { value: "full_time", label: "Full-time" },
  { value: "part_time", label: "Part-time" },
  { value: "freelance", label: "Freelance" },
  { value: "research", label: "Research" },
  { value: "open_source", label: "Open Source" },
];

export function graduationYearOptions(): number[] {
  const current = new Date().getFullYear();
  const years: number[] = [];
  for (let y = current - 6; y <= current + 6; y += 1) years.push(y);
  return years;
}

export function degreeLabel(value: string | null): string {
  return DEGREE_OPTIONS.find((o) => o.value === value)?.label ?? value ?? "—";
}

export function branchLabel(value: string | null): string {
  return BRANCH_OPTIONS.find((o) => o.value === value)?.label ?? value ?? "—";
}

export function targetRoleLabel(value: string): string {
  return TARGET_ROLE_OPTIONS.find((o) => o.value === value)?.label ?? value;
}

export function platformLabel(value: string): string {
  return CODING_PLATFORM_OPTIONS.find((o) => o.value === value)?.label ?? value;
}

export function employmentTypeLabel(value: string): string {
  return EMPLOYMENT_TYPE_OPTIONS.find((o) => o.value === value)?.label ?? value;
}
