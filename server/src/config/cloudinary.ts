import { v2 as cloudinary } from "cloudinary";
import { cloudinaryConfigured, env } from "./env";

// Cloudinary credentials come only from env vars — never hardcoded.
// If they are absent, uploads fail with a clear 503 (see services/cloudinary).
if (cloudinaryConfigured()) {
  cloudinary.config({
    cloud_name: env.cloudinaryCloudName,
    api_key: env.cloudinaryApiKey,
    api_secret: env.cloudinaryApiSecret,
    secure: true,
  });
} else {
  console.warn(
    "[cloudinary] CLOUDINARY_* env vars not set — uploads will return 503 until configured.",
  );
}

// Canonical storage folders. Keep in sync with ai-service/app/cloudinary_client.py.
export const CLOUDINARY_FOLDERS = {
  resume: "groundtruth/resumes",
  certificate: "groundtruth/certificates",
  "evidence-report": "groundtruth/evidence-reports",
} as const;

export type UploadKind = keyof typeof CLOUDINARY_FOLDERS;

export { cloudinary };
