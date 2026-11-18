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

/** Error from an authed API call, carrying the HTTP status so callers can
 *  tell a 403 (e.g. a recruiter-only report) apart from other failures. */
export class ApiHttpError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = "ApiHttpError";
    this.status = status;
  }
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
    throw new ApiHttpError(
      res.status,
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

// ── Assessment system (/api/assessments) ──────────────────────────────────
// Typed client for the assessment backend (migration 007). Field names
// follow the server exactly: assessment/challenge/repo rows are snake_case
// DB rows, while strength/evaluation/interview reports are camelCase.
// Nothing here invents data — every value comes from the API response.

export type AssessmentStatus =
  | "draft"
  | "ready"
  | "active"
  | "submitted"
  | "evaluating"
  | "completed"
  | "failed"
  | "cancelled";

export interface AssessmentRow {
  id: string;
  candidate_id: string;
  repository_id: string | null;
  project_id: string | null;
  status: AssessmentStatus;
  time_limit_minutes: number;
  started_at: string | null;
  submitted_at: string | null;
  ended_at: string | null;
  consent_given_at: string | null;
  consent_version: string | null;
  created_at: string;
  updated_at: string;
  /** Present on POST / (create) only when the server knows the source. */
  source?: string;
}

export interface RepoAnalysisResult {
  id: string;
  repository_id: string;
  languages: unknown;
  frameworks: string[];
  dependencies: unknown[];
  structure: Record<string, unknown>;
  entry_points: string[];
  tests: Record<string, unknown>;
  api_endpoints: unknown[];
  db_integrations: string[];
  quality: Record<string, unknown>;
  summary: string | null;
  analyzed_by: string;
  created_at: string;
}

export interface ChallengeRow {
  id: string;
  assessment_id: string;
  title: string;
  problem_statement: string;
  /** Metadata object (never raw code). Rendered as key/value pairs. */
  repo_context: Record<string, unknown>;
  required_functionality: unknown[];
  acceptance_criteria: unknown[];
  difficulty: string;
  deliverables: unknown[];
  allowed_tools: unknown[];
  time_limit_minutes: number;
  /** Descriptions only — hidden test code is never sent by the server. */
  test_strategy: Record<string, unknown>;
  generated_by: string;
  validation: Record<string, unknown>;
  created_at: string;
}

export interface AssessmentDetail extends AssessmentRow {
  challenge: ChallengeRow | null;
  repoAnalysis: RepoAnalysisResult | null;
}

export interface StrengthRecommendation {
  id: string;
  title: string;
  why: string;
  action: string;
  points: number;
}

export interface StrengthReport {
  overall: number;
  categories: {
    skillCoverage: number;
    projectEvidence: number;
    experience: number;
    resumeConsistency: number;
    profileCompleteness: { score: number; detail: string };
  };
  missing: string[];
  weakAreas: string[];
  recommendations: StrengthRecommendation[];
  suggestedSkills: string[];
  aiAvailable: boolean;
  aiSummary: string | null;
}

/** Stored profile_analyses row (snake_case, as the server returns it). */
export interface ProfileAnalysisRow {
  id: string;
  candidate_id: string;
  overall_score: number | string;
  category_scores: StrengthReport["categories"] | Record<string, unknown>;
  missing: string[];
  weak_areas: string[];
  recommendations: StrengthRecommendation[];
  suggested_skills: string[];
  ai_available: boolean;
  ai_summary: string | null;
  created_at: string;
}

export interface ProfileRecommendations {
  recommendations: StrengthRecommendation[];
  missing: string[];
  weak_areas: string[];
  suggested_skills: string[];
  created_at: string;
}

export interface VerifiedSkill {
  skill: string;
  evidence: Record<string, unknown>;
  verifiedAt: string;
  assessmentId: string | null;
}

export interface VerifiedProfile {
  candidateId: string;
  fullName: string;
  completionScore: number;
  completionMissing: string[];
  strengthScore: number | null;
  strengthCategories: Record<string, unknown>;
  verifiedSkills: VerifiedSkill[];
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
  verificationStatus: string;
  verificationDate: string | null;
  evidence: Record<string, unknown>;
}

export interface MonitoringConsent {
  version: string;
  collected: string[];
  purpose: string;
  retentionDays: number;
  recruiterVisibility: string;
  given: { given_at: string; version?: string } | null;
}

export interface StartAssessmentResult {
  assessment: AssessmentRow;
  sessionId: string;
  sandboxBackend: "unshare" | "disabled" | string;
  executionSessionId: string;
}

export interface ExecutionSession {
  id: string;
  status: string;
  sandbox_backend: string;
  created_at: string;
}

export interface ExecutionStatus {
  sandboxBackend: string;
  reason: string;
  workspace: string;
}

export interface RunResult {
  stdout: string;
  stderr: string;
  exitCode: number | null;
  timedOut: boolean;
  durationMs: number;
  backend: string;
  command: string[];
  parsed?: { passed: number; failed: number; total: number; failures: string[] };
}

export interface TestCounts {
  passed: number;
  failed: number;
  total: number;
  failures?: string[];
}

export interface SubmitResult {
  status: string;
  snapshotVersion: number;
  snapshotHash: string;
  visibleTests: TestCounts;
  hiddenTests: TestCounts;
  assessment?: AssessmentRow;
}

export interface MonitoringSummary {
  assessmentId: string;
  durationSeconds: number | null;
  activeSeconds: number | null;
  idlePeriods: { start: string; end: string | null; seconds: number }[];
  filesModified: string[];
  filesCreated: string[];
  filesDeleted: string[];
  terminalCommands: number;
  testRuns: { passed: number; failed: number; total: number; runs: number };
  compileErrors: number;
  submissionAttempts: number;
  aiAssistantInteractions: number;
  tabHiddenCount: number;
  observations: string[];
}

export interface MonitoringEvent {
  id?: string;
  event_type: string;
  file_path: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
}

export interface MonitoringData {
  status: string;
  assessmentStatus: string;
  summary: MonitoringSummary;
  integrity: {
    id?: string;
    type?: string;
    finding?: string;
    severity?: string;
    status?: string;
    detail?: string;
    created_at?: string;
  }[];
  events: MonitoringEvent[];
}

export interface EvaluationReport {
  id: string;
  assessmentId: string;
  overallScore: number | null;
  categoryScores: Record<string, number | null>;
  evidence: Record<string, unknown>;
  passedTests: string[];
  failedTests: string[];
  qualityIssues: string[];
  securityFindings: string[];
  improvements: string[];
  strengths: string[];
  weaknesses: string[];
  confidence: number;
  humanReviewRecommended: boolean;
  aiAvailable: boolean;
  qualitativeMethod: "llm" | "deterministic-heuristic";
  status: string;
}

export interface InterviewRow {
  id: string;
  assessment_id: string | null;
  candidate_id: string;
  status: string;
  score: number | null;
  created_at: string;
  updated_at?: string;
}

export interface InterviewQuestion {
  id: string;
  category: string;
  question: string;
  question_order?: number;
  order?: number;
}

export interface AnswerResult {
  evaluation: {
    accuracy: number;
    understanding: number;
    depth: number;
    relevance: number;
    problemSolving: number;
    method: string;
    notes: string;
  };
  score: number;
  followUp: InterviewQuestion | null;
}

export interface InterviewReport {
  interviewId: string;
  assessmentId: string | null;
  finalScore: number | null;
  transcript: {
    category: string;
    question: string;
    answer: string | null;
    score: number | null;
    evaluation: Record<string, unknown> | null;
  }[];
  perQuestion: {
    question: string;
    category: string;
    score: number | null;
    evaluation: Record<string, unknown> | null;
  }[];
  strengths: string[];
  knowledgeGaps: string[];
  gaps?: string[];
  learningAreas: string[];
  evidence: Record<string, unknown>;
}

export interface MonitoringReportData {
  assessmentId: string;
  candidateId: string;
  summary: MonitoringSummary;
  integrityFindings: Record<string, unknown>[];
  evaluation: EvaluationReport | null;
  timeline: { at: string; type: string; file: string | null; metadata: Record<string, unknown> }[];
}

export type AssessmentSource = "profile_project" | "manual";
export type TimeLimitMinutes = 30 | 45 | 60 | 90;

/** Coerce an unknown[] (or anything else) into a string list for display. */
export function toStrList(value: unknown): string[] {
  if (Array.isArray(value)) return value.map((v) => String(v));
  if (value === null || value === undefined) return [];
  return [String(value)];
}

/** "2026-11-18T10:00:00Z" → "18 Nov 2026, 10:00" (local time). */
export function formatDateTime(value: string | null | undefined): string {
  if (!value) return "—";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  return d.toLocaleString("en-IN", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/** Seconds → "1h 23m" / "45m 10s" / "32s". Null → "—". */
export function formatDuration(totalSeconds: number | null | undefined): string {
  if (totalSeconds === null || totalSeconds === undefined) return "—";
  const s = Math.max(0, Math.round(totalSeconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${sec}s`;
  return `${sec}s`;
}

// ── Profile strength ───────────────────────────────────────────────────────
export function analyzeProfileStrength(): Promise<StrengthReport> {
  return authedRequest<StrengthReport>("/api/assessments/profile/analyze", {
    method: "POST",
  });
}

export function fetchProfileStrength(): Promise<ProfileAnalysisRow> {
  return authedRequest<ProfileAnalysisRow>("/api/assessments/profile/strength");
}

export function fetchProfileRecommendations(): Promise<ProfileRecommendations> {
  return authedRequest<ProfileRecommendations>("/api/assessments/profile/recommendations");
}

export function fetchVerifiedProfile(): Promise<VerifiedProfile> {
  return authedRequest<VerifiedProfile>("/api/assessments/profile/verified");
}

// ── Demo project + projects ────────────────────────────────────────────────
export function fetchDemoProject(): Promise<{ files: Record<string, string> }> {
  return authedRequest<{ files: Record<string, string> }>("/api/assessments/demo-project");
}

export function fetchAssessmentProjects(): Promise<{
  projects: { id: string; title: string; description: string }[];
  repositories: unknown[];
}> {
  return authedRequest("/api/assessments/projects");
}

export function analyzeRepository(
  assessmentId: string,
  files: { path: string; content: string }[],
  repoUrl?: string,
): Promise<RepoAnalysisResult> {
  return authedRequest<RepoAnalysisResult>("/api/assessments/projects/analyze", {
    method: "POST",
    body: JSON.stringify({ assessmentId, files, ...(repoUrl ? { repoUrl } : {}) }),
  });
}

// ── Assessments ────────────────────────────────────────────────────────────
export function createAssessment(input: {
  projectId?: string;
  source: AssessmentSource;
  timeLimitMinutes?: TimeLimitMinutes;
}): Promise<AssessmentRow> {
  return authedRequest<AssessmentRow>("/api/assessments", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export function fetchAssessments(): Promise<AssessmentRow[]> {
  return authedRequest<AssessmentRow[]>("/api/assessments");
}

export function fetchAssessment(id: string): Promise<AssessmentDetail> {
  return authedRequest<AssessmentDetail>(`/api/assessments/${encodeURIComponent(id)}`);
}

export function fetchChallenge(id: string): Promise<ChallengeRow> {
  return authedRequest<ChallengeRow>(`/api/assessments/${encodeURIComponent(id)}/challenge`);
}

export function generateChallenge(id: string): Promise<ChallengeRow> {
  return authedRequest<ChallengeRow>(`/api/assessments/${encodeURIComponent(id)}/challenge/generate`, {
    method: "POST",
  });
}

export function fetchConsent(id: string): Promise<MonitoringConsent> {
  return authedRequest<MonitoringConsent>(`/api/assessments/${encodeURIComponent(id)}/consent`);
}

export function giveConsent(id: string): Promise<AssessmentRow> {
  return authedRequest<AssessmentRow>(`/api/assessments/${encodeURIComponent(id)}/consent`, {
    method: "POST",
    body: JSON.stringify({ agreed: true }),
  });
}

export function startAssessment(
  id: string,
  sessionId: string,
  initialFiles?: Record<string, string>,
): Promise<StartAssessmentResult> {
  return authedRequest<StartAssessmentResult>(`/api/assessments/${encodeURIComponent(id)}/start`, {
    method: "POST",
    body: JSON.stringify({ sessionId, ...(initialFiles ? { initialFiles } : {}) }),
  });
}

// ── Lab files + monitoring events ──────────────────────────────────────────
export function fetchAssessmentFiles(id: string): Promise<{ files: Record<string, string> }> {
  return authedRequest<{ files: Record<string, string> }>(
    `/api/assessments/${encodeURIComponent(id)}/files`,
  );
}

export function saveAssessmentFile(
  id: string,
  path: string,
  content: string,
  sessionId: string,
): Promise<{ path: string; linesAdded: number; linesRemoved: number }> {
  const encoded = path.split("/").map(encodeURIComponent).join("/");
  return authedRequest(`/api/assessments/${encodeURIComponent(id)}/files/${encoded}`, {
    method: "PUT",
    body: JSON.stringify({ content, sessionId }),
  });
}

export function postAssessmentEvent(
  id: string,
  input: {
    sessionId: string;
    eventType: string;
    filePath?: string | null;
    metadata?: Record<string, unknown>;
    clientEventId?: string;
  },
): Promise<{ recorded: boolean }> {
  return authedRequest<{ recorded: boolean }>(`/api/assessments/${encodeURIComponent(id)}/events`, {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export function fetchMonitoring(id: string): Promise<MonitoringData> {
  return authedRequest<MonitoringData>(`/api/assessments/${encodeURIComponent(id)}/monitoring`);
}

// ── Execution ──────────────────────────────────────────────────────────────
export function fetchExecutionSession(id: string): Promise<ExecutionSession> {
  return authedRequest<ExecutionSession>(
    `/api/assessments/${encodeURIComponent(id)}/execution/session`,
  );
}

export function fetchExecutionStatus(id: string): Promise<ExecutionStatus> {
  return authedRequest<ExecutionStatus>(
    `/api/assessments/${encodeURIComponent(id)}/execution/status`,
  );
}

export function runExecution(
  id: string,
  sessionId: string,
  command: string[],
): Promise<RunResult> {
  return authedRequest<RunResult>(`/api/assessments/${encodeURIComponent(id)}/execution/run`, {
    method: "POST",
    body: JSON.stringify({ sessionId, command }),
  });
}

export function testExecution(
  id: string,
  sessionId: string,
  command?: string[],
): Promise<RunResult> {
  return authedRequest<RunResult>(`/api/assessments/${encodeURIComponent(id)}/execution/test`, {
    method: "POST",
    body: JSON.stringify({ sessionId, ...(command ? { command } : {}) }),
  });
}

// ── Submission + evaluation ────────────────────────────────────────────────
export function submitAssessment(id: string, sessionId: string): Promise<SubmitResult> {
  return authedRequest<SubmitResult>(`/api/assessments/${encodeURIComponent(id)}/submit`, {
    method: "POST",
    body: JSON.stringify({ sessionId }),
  });
}

export function evaluateAssessment(id: string): Promise<EvaluationReport> {
  return authedRequest<EvaluationReport>(`/api/assessments/${encodeURIComponent(id)}/evaluate`, {
    method: "POST",
  });
}

export function fetchEvaluation(id: string): Promise<EvaluationReport> {
  return authedRequest<EvaluationReport>(`/api/assessments/${encodeURIComponent(id)}/evaluation`);
}

// ── Interview ──────────────────────────────────────────────────────────────
export function generateInterview(
  id: string,
): Promise<{ interview: InterviewRow; questions: InterviewQuestion[] }> {
  return authedRequest(`/api/assessments/${encodeURIComponent(id)}/interview/generate`, {
    method: "POST",
  });
}

export function fetchInterview(
  interviewId: string,
): Promise<{ interview: InterviewRow; questions: InterviewQuestion[] }> {
  return authedRequest(`/api/assessments/interviews/${encodeURIComponent(interviewId)}`);
}

export function answerInterviewQuestion(
  interviewId: string,
  questionId: string,
  answer: string,
): Promise<AnswerResult> {
  return authedRequest<AnswerResult>(
    `/api/assessments/interviews/${encodeURIComponent(interviewId)}/answer`,
    {
      method: "POST",
      body: JSON.stringify({ questionId, answer }),
    },
  );
}

export function fetchInterviewReport(interviewId: string): Promise<InterviewReport> {
  return authedRequest<InterviewReport>(
    `/api/assessments/interviews/${encodeURIComponent(interviewId)}/report`,
  );
}

// ── Monitoring report (recruiter/admin only — the server returns 403 for
//    anyone else; callers must surface that 403 honestly, never fake it). ──
export function fetchMonitoringReport(id: string): Promise<MonitoringReportData> {
  return authedRequest<MonitoringReportData>(
    `/api/assessments/${encodeURIComponent(id)}/monitoring/report`,
  );
}

/** WebSocket URL for the live terminal of one execution session. */
export function executionTerminalWsUrl(executionSessionId: string): string | null {
  const token = getToken();
  if (!token) return null;
  const httpUrl = API_URL.replace(/^http/, "ws");
  return `${httpUrl}/ws/execution/${encodeURIComponent(executionSessionId)}/terminal?token=${encodeURIComponent(token)}`;
}

export { API_URL as ASSESSMENT_API_URL };

// ── Phase 7: messaging, notifications, contact ────────────────────────────

export interface Message {
  id: string;
  application_id: string;
  sender_id: string;
  sender_name: string | null;
  sender_role: string | null;
  body: string;
  created_at: string;
}

export interface MessageThread {
  application_id: string;
  job_id: string;
  job_title: string;
  company_name: string | null;
  candidate_id: string;
  candidate_name: string;
  application_status: string;
  last_message: string | null;
  last_message_at: string | null;
  last_sender_id: string | null;
  unread_count: number;
}

export interface ThreadDetail {
  application_id: string;
  job_id: string;
  job_title: string;
  company_name: string | null;
  candidate_id: string;
  candidate_name: string;
  application_status: string;
  messages: Message[];
}

/** The caller's message threads (one per application), newest first. */
export function fetchMessageThreads(): Promise<MessageThread[]> {
  return authedRequest<MessageThread[]>("/api/messages/threads");
}

/** One thread with its messages. Reading marks it read for the caller. */
export function fetchThread(applicationId: string): Promise<ThreadDetail> {
  return authedRequest<ThreadDetail>(
    `/api/messages/threads/${encodeURIComponent(applicationId)}`,
  );
}

/** Send a message in a thread the caller is a party to. */
export function sendThreadMessage(
  applicationId: string,
  body: string,
): Promise<Message> {
  return authedRequest<Message>(
    `/api/messages/threads/${encodeURIComponent(applicationId)}/messages`,
    { method: "POST", body: JSON.stringify({ body }) },
  );
}

export interface NotificationItem {
  id: string;
  user_id: string;
  type: string;
  title: string;
  body: string;
  link: string | null;
  application_id: string | null;
  is_read: boolean;
  created_at: string;
}

/** The signed-in user's notifications, newest first. */
export function fetchNotifications(): Promise<NotificationItem[]> {
  return authedRequest<NotificationItem[]>("/api/notifications");
}

/** Number of unread notifications for the signed-in user. */
export function fetchUnreadCount(): Promise<{ unread: number }> {
  return authedRequest<{ unread: number }>("/api/notifications/unread-count");
}

export function markNotificationRead(id: string): Promise<NotificationItem> {
  return authedRequest<NotificationItem>(
    `/api/notifications/${encodeURIComponent(id)}/read`,
    { method: "PATCH" },
  );
}

export function markAllNotificationsRead(): Promise<{ marked: number }> {
  return authedRequest<{ marked: number }>("/api/notifications/mark-all-read", {
    method: "POST",
  });
}

/**
 * Public contact / demo-request form. No email is sent from this form —
 * the server stores the message for the team to review and reply to.
 */
export function submitContact(input: {
  name: string;
  email: string;
  message: string;
  source?: "contact_page" | "landing_demo";
}): Promise<{ id: string; created_at: string; message: string }> {
  return fetch(`${API_URL}/api/contact`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  }).then(async (res) => {
    const body = (await res.json().catch(() => null)) as {
      error?: string;
    } | null;
    if (!res.ok) {
      throw new Error(body?.error ?? `Request failed: ${res.status}`);
    }
    return body as { id: string; created_at: string; message: string };
  });
}

