import "dotenv/config";

// Centralised env access. Every secret comes from the environment —
// nothing is hardcoded here. Missing Cloudinary/OpenAI keys are tolerated
// in Phase 0 (uploads/embedding fall back honestly); see the relevant modules.
export const env = {
  port: Number(process.env.PORT ?? 4000),
  databaseUrl:
    process.env.DATABASE_URL ??
    "postgres://groundtruth:groundtruth_dev@localhost:5432/groundtruth",
  redisUrl: process.env.REDIS_URL ?? "redis://localhost:6379",
  aiServiceUrl: process.env.AI_SERVICE_URL ?? "http://localhost:8000",
  // Timeout (ms) for server-to-server calls to ai-service (see
  // services/aiService.ts). Node fetch has no default timeout, so without
  // this a hung ai-service would hang the caller indefinitely.
  aiServiceTimeoutMs: Number(process.env.AI_SERVICE_TIMEOUT_MS ?? 30000),
  cloudinaryCloudName: process.env.CLOUDINARY_CLOUD_NAME ?? "",
  cloudinaryApiKey: process.env.CLOUDINARY_API_KEY ?? "",
  cloudinaryApiSecret: process.env.CLOUDINARY_API_SECRET ?? "",
  // JWT secret — REQUIRED in production. The server refuses to sign tokens
  // without one (see services/auth.ts); a missing secret fails loudly
  // instead of silently issuing tokens signed with a fallback.
  jwtSecret: process.env.JWT_SECRET ?? "",
  jwtExpiresIn: process.env.JWT_EXPIRES_IN ?? "1d",
  // Public base URL of the client, used to build password-reset links.
  frontendUrl: process.env.FRONTEND_URL ?? "http://localhost:3000",
  nodeEnv: process.env.NODE_ENV ?? "development",
  // GitHub API token (optional): raises the public-repo rate limit from
  // 60 to 5,000 requests/hour. Never logged; see services/githubPublicRepo.ts.
  // Private repos are still refused by that endpoint.
  githubApiToken: process.env.GITHUB_API_TOKEN ?? "",
  // LLM (OpenAI-compatible chat completions) — see services/llm.ts.
  // All optional: when base URL / key / model are missing the server uses
  // the deterministic mock provider and never calls a live model.
  // No model name is hardcoded anywhere; AI_MODEL must be set explicitly.
  aiApiBaseUrl: process.env.AI_API_BASE_URL ?? "",
  aiApiKey: process.env.AI_API_KEY ?? "",
  aiModel: process.env.AI_MODEL ?? "",
  aiTemperature: Number(process.env.AI_TEMPERATURE ?? 0.2),
  aiMaxTokens: Number(process.env.AI_MAX_TOKENS ?? 2000),
  aiMock: (process.env.AI_MOCK ?? "false").toLowerCase() === "true",
  aiRateLimitPerMin: Number(process.env.AI_RATE_LIMIT_PER_MIN ?? 30),
  aiTimeoutMs: Number(process.env.AI_TIMEOUT_MS ?? 120000),
  // Bounded LLM retries (see services/llm.ts): max attempts per call.
  // Clamped to 1–5 in the client; default 3. Together with AI_TIMEOUT_MS
  // this bounds the worst case of one call (see llmWorstCaseBoundMs).
  aiMaxAttempts: Number(process.env.AI_MAX_ATTEMPTS ?? 3),
  // Real AI technical interview (Phase C) — server-authoritative timers.
  // Per-question budget (seconds) and whole-session budget (seconds);
  // a late answer is rejected server-side, never silently accepted.
  interviewPerQuestionSeconds: Number(process.env.INTERVIEW_PER_QUESTION_SECONDS ?? 300),
  interviewSessionTotalSeconds: Number(process.env.INTERVIEW_SESSION_TOTAL_SECONDS ?? 2400),
  // Answers shorter than this many words return a short-answer warning
  // the candidate must explicitly confirm (they are never auto-rejected).
  interviewShortAnswerWords: Number(process.env.INTERVIEW_SHORT_ANSWER_WORDS ?? 20),
  // Explain Again budget: max rephrases per question / per session.
  interviewExplainAgainPerQuestion: Number(process.env.INTERVIEW_EXPLAIN_AGAIN_PER_QUESTION ?? 1),
  interviewExplainAgainPerSession: Number(process.env.INTERVIEW_EXPLAIN_AGAIN_PER_SESSION ?? 2),
  // Code-execution sandbox: "unshare" (Linux user+net+mount+pid namespaces)
  // or "disabled" (fail closed — code is never run unsandboxed).
  executionSandbox: process.env.EXECUTION_SANDBOX ?? "unshare",
  executionTimeoutSeconds: Number(process.env.EXECUTION_TIMEOUT_SECONDS ?? 30),
  // Retention for raw monitoring event rows (days); verdicts and evaluation
  // summaries are never purged.
  monitoringRetentionDays: Number(process.env.MONITORING_RETENTION_DAYS ?? 90),
  // Outgoing email via SMTP (Nodemailer — see services/email.ts). Any SMTP
  // provider works (Gmail, SendGrid, SES, ...); no vendor SDK is bundled.
  // All optional: when unset, mail is honestly unavailable (503 from the
  // mail service; forgot-password keeps its dev resetUrl / generic reply).
  // Credentials come only from the environment and are never logged.
  smtpHost: process.env.SMTP_HOST ?? "",
  smtpPort: Number(process.env.SMTP_PORT ?? 587),
  smtpSecure: (process.env.SMTP_SECURE ?? "false").toLowerCase() === "true",
  smtpUser: process.env.SMTP_USER ?? "",
  smtpPass: process.env.SMTP_PASS ?? "",
  emailFrom: process.env.EMAIL_FROM ?? "",
} as const;

export function cloudinaryConfigured(): boolean {
  return Boolean(
    env.cloudinaryCloudName && env.cloudinaryApiKey && env.cloudinaryApiSecret,
  );
}

export function emailConfigured(): boolean {
  return Boolean(
    env.smtpHost && env.smtpUser && env.smtpPass && env.emailFrom,
  );
}
