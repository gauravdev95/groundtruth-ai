import { cloudinary } from "../config/cloudinary";
import { ApiError } from "../middleware/errorHandler";
import { cloudinaryConfigured } from "../config/env";

export interface UploadResult {
  secure_url: string;
  public_id: string;
}

interface UploadOptions {
  folder: string;
  resourceType?: "auto" | "image" | "raw";
  fileName?: string;
}

// Upload a buffer (e.g. from multer memory storage) to Cloudinary.
// resource_type "auto" lets Cloudinary detect PDF vs image.
export function uploadBuffer(
  buffer: Buffer,
  { folder, resourceType = "auto", fileName }: UploadOptions,
): Promise<UploadResult> {
  if (!cloudinaryConfigured()) {
    return Promise.reject(
      new ApiError(503, "Cloudinary is not configured (CLOUDINARY_* env vars missing)"),
    );
  }
  return new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(
      { folder, resource_type: resourceType, filename_override: fileName, use_filename: true },
      (error, result) => {
        if (error || !result) {
          reject(new ApiError(502, `Cloudinary upload failed: ${error?.message ?? "unknown error"}`));
          return;
        }
        resolve({ secure_url: result.secure_url, public_id: result.public_id });
      },
    );
    stream.end(buffer);
  });
}

// Upload a generated evidence-report PDF buffer into
// groundtruth/evidence-reports. Callers pass the finished PDF bytes;
// this helper only handles storage, never report content.
export function uploadEvidenceReport(
  pdfBuffer: Buffer,
  candidateId: string,
  title: string,
): Promise<UploadResult> {
  const safeTitle = title.replace(/[^a-zA-Z0-9-_]+/g, "-").slice(0, 80);
  return uploadBuffer(pdfBuffer, {
    folder: "groundtruth/evidence-reports",
    resourceType: "raw",
    fileName: `${candidateId}-${safeTitle}.pdf`,
  });
}
