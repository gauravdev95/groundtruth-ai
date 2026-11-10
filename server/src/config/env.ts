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
  apiKey: process.env.API_KEY ?? "",
  jwtSecret: process.env.JWT_SECRET ?? "",
  nodeEnv: process.env.NODE_ENV ?? "development",
} as const;

export function cloudinaryConfigured(): boolean {
  return Boolean(
    env.cloudinaryCloudName && env.cloudinaryApiKey && env.cloudinaryApiSecret,
  );
}
