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
  aiTimeoutMs: Number(process.env.AI_TIMEOUT_MS ?? 30000),
  // Code-execution sandbox: "unshare" (Linux user+net+mount+pid namespaces)
  // or "disabled" (fail closed — code is never run unsandboxed).
  executionSandbox: process.env.EXECUTION_SANDBOX ?? "unshare",
  executionTimeoutSeconds: Number(process.env.EXECUTION_TIMEOUT_SECONDS ?? 30),
  // Retention for raw monitoring event rows (days); verdicts and evaluation
  // summaries are never purged.
  monitoringRetentionDays: Number(process.env.MONITORING_RETENTION_DAYS ?? 90),
} as const;

export function cloudinaryConfigured(): boolean {
  return Boolean(
    env.cloudinaryCloudName && env.cloudinaryApiKey && env.cloudinaryApiSecret,
  );
}
