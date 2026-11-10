import { Router } from "express";
import multer from "multer";
import { z } from "zod";
import { pool } from "../config/db";
import { CLOUDINARY_FOLDERS, type UploadKind } from "../config/cloudinary";
import { ApiError, asyncHandler } from "../middleware/errorHandler";
import { enqueueResumeParsing } from "../queues/jobs";
import { uploadBuffer } from "../services/cloudinary";

const router = Router();

// Memory storage — files go straight to Cloudinary, never to disk.
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 }, // 10 MB
  fileFilter: (_req, file, cb) => {
    const allowed = ["application/pdf", "image/jpeg", "image/png"];
    if (allowed.includes(file.mimetype)) cb(null, true);
    else cb(new ApiError(400, "Only PDF, JPG, and PNG files are allowed"));
  },
});

const uploadBodySchema = z.object({
  kind: z.enum(["resume", "certificate", "evidence-report"]),
  candidate_id: z.string().uuid().optional(),
});

// POST /api/uploads — multipart `file` + `kind` (+ optional `candidate_id`).
// Stores in Cloudinary, records the row, enqueues background parsing for
// resumes. Returns 202 + jobId; the UI never waits for parsing.
router.post(
  "/",
  upload.single("file"),
  asyncHandler(async (req, res) => {
    const parsed = uploadBodySchema.safeParse(req.body);
    if (!parsed.success) {
      throw new ApiError(400, `Invalid upload: ${parsed.error.issues[0]?.message ?? "validation failed"}`);
    }
    if (!req.file) throw new ApiError(400, "No file uploaded");
    const { kind, candidate_id } = parsed.data;
    const folder = CLOUDINARY_FOLDERS[kind as UploadKind];

    const result = await uploadBuffer(req.file.buffer, {
      folder,
      resourceType: "auto",
      fileName: req.file.originalname,
    });

    let resumeId: string | null = null;
    let jobId: string | null = null;
    if (kind === "resume" && candidate_id) {
      const { rows } = await pool.query(
        `INSERT INTO resumes (candidate_id, cloudinary_url, public_id, file_name)
         VALUES ($1, $2, $3, $4) RETURNING id`,
        [candidate_id, result.secure_url, result.public_id, req.file.originalname],
      );
      resumeId = (rows[0] as { id: string }).id;
      const job = await enqueueResumeParsing(resumeId, result.secure_url);
      jobId = String(job.id);
    } else if (kind === "certificate" && candidate_id) {
      await pool.query(
        `INSERT INTO certificates (candidate_id, title, cloudinary_url, public_id)
         VALUES ($1, $2, $3, $4)`,
        [candidate_id, req.file.originalname, result.secure_url, result.public_id],
      );
    } else if (kind === "evidence-report" && candidate_id) {
      await pool.query(
        `INSERT INTO evidence_reports (candidate_id, title, cloudinary_url, public_id)
         VALUES ($1, $2, $3, $4)`,
        [candidate_id, req.file.originalname, result.secure_url, result.public_id],
      );
    }

    res.status(202).json({
      secure_url: result.secure_url,
      public_id: result.public_id,
      folder,
      kind,
      resume_id: resumeId,
      job_id: jobId,
    });
  }),
);

export default router;
