import { Router } from "express";
import multer from "multer";
import { z } from "zod";
import { pool } from "../config/db";
import { CLOUDINARY_FOLDERS, type UploadKind } from "../config/cloudinary";
import { ApiError, asyncHandler } from "../middleware/errorHandler";
import { requireAuth, requireRole, type AuthRequest } from "../middleware/auth";
import { uploadRateLimit } from "../middleware/rateLimit";
import { enqueueResumeParsing } from "../queues/jobs";
import { uploadBuffer } from "../services/cloudinary";
import { getOrCreateCandidateForUser } from "../services/student";

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
//
// Phase 8 (23 Nov 2026): this route was PUBLIC with a client-supplied
// candidate_id — anyone could upload files to Cloudinary and attribute
// them to ANY candidate. Now: signed-in candidate only, rate-limited
// (uploads cost money + queue work), and the candidate_id must be the
// caller's own — a supplied id belonging to someone else is a 403, and
// when no id is supplied the caller's own candidate row is used.
router.post(
  "/",
  requireAuth,
  requireRole("candidate"),
  uploadRateLimit,
  upload.single("file"),
  asyncHandler(async (req, res) => {
    const parsed = uploadBodySchema.safeParse(req.body);
    if (!parsed.success) {
      throw new ApiError(400, `Invalid upload: ${parsed.error.issues[0]?.message ?? "validation failed"}`);
    }
    if (!req.file) throw new ApiError(400, "No file uploaded");
    const user = (req as AuthRequest).user!;
    const { rows: meRows } = await pool.query<{ full_name: string }>(
      "SELECT full_name FROM users WHERE id = $1",
      [user.sub],
    );
    const own = await getOrCreateCandidateForUser(
      user.sub,
      user.email,
      meRows[0]?.full_name ?? "Student",
    );
    const { kind, candidate_id } = parsed.data;
    if (candidate_id && candidate_id !== own.id) {
      throw new ApiError(403, "You can only upload files for your own profile");
    }
    const ownerId = own.id;
    const folder = CLOUDINARY_FOLDERS[kind as UploadKind];

    const result = await uploadBuffer(req.file.buffer, {
      folder,
      resourceType: "auto",
      fileName: req.file.originalname,
    });

    let resumeId: string | null = null;
    let jobId: string | null = null;
    if (kind === "resume") {
      const { rows } = await pool.query(
        `INSERT INTO resumes (candidate_id, cloudinary_url, public_id, file_name)
         VALUES ($1, $2, $3, $4) RETURNING id`,
        [ownerId, result.secure_url, result.public_id, req.file.originalname],
      );
      resumeId = (rows[0] as { id: string }).id;
      const job = await enqueueResumeParsing(resumeId, result.secure_url);
      jobId = String(job.id);
    } else if (kind === "certificate") {
      await pool.query(
        `INSERT INTO certificates (candidate_id, title, cloudinary_url, public_id)
         VALUES ($1, $2, $3, $4)`,
        [ownerId, req.file.originalname, result.secure_url, result.public_id],
      );
    } else if (kind === "evidence-report") {
      await pool.query(
        `INSERT INTO evidence_reports (candidate_id, title, cloudinary_url, public_id)
         VALUES ($1, $2, $3, $4)`,
        [ownerId, req.file.originalname, result.secure_url, result.public_id],
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
