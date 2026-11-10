import { Router } from "express";
import { z } from "zod";
import { pool } from "../config/db";
import { ApiError, asyncHandler } from "../middleware/errorHandler";
import { enqueueGithubAnalysis } from "../queues/jobs";

const router = Router();

const createCandidateSchema = z.object({
  full_name: z.string().min(1).max(200),
  email: z.string().email(),
  headline: z.string().max(200).optional().nullable(),
  github_url: z.string().url().optional().nullable(),
  linkedin_url: z.string().url().optional().nullable(),
  location: z.string().max(200).optional().nullable(),
  summary: z.string().optional().nullable(),
});

// GET /api/candidates — newest first.
router.get(
  "/",
  asyncHandler(async (_req, res) => {
    const { rows } = await pool.query(
      "SELECT * FROM candidates ORDER BY created_at DESC LIMIT 100",
    );
    res.json(rows);
  }),
);

// GET /api/candidates/:id
router.get(
  "/:id",
  asyncHandler(async (req, res) => {
    const { rows } = await pool.query("SELECT * FROM candidates WHERE id = $1", [
      req.params.id,
    ]);
    if (rows.length === 0) throw new ApiError(404, "Candidate not found");
    res.json(rows[0]);
  }),
);

// POST /api/candidates — create, and if a GitHub URL is given, enqueue
// repo analysis in the background (202-style: creation is sync, analysis is not).
router.post(
  "/",
  asyncHandler(async (req, res) => {
    const parsed = createCandidateSchema.safeParse(req.body);
    if (!parsed.success) {
      throw new ApiError(400, `Invalid candidate: ${parsed.error.issues[0]?.message ?? "validation failed"}`);
    }
    const d = parsed.data;
    const { rows } = await pool.query(
      `INSERT INTO candidates (full_name, email, headline, github_url, linkedin_url, location, summary)
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
      [d.full_name, d.email, d.headline ?? null, d.github_url ?? null,
       d.linkedin_url ?? null, d.location ?? null, d.summary ?? null],
    );
    const candidate = rows[0] as { id: string; github_url: string | null };
    let analysisJobId: string | null = null;
    if (candidate.github_url) {
      const job = await enqueueGithubAnalysis(candidate.github_url, candidate.id).catch(
        (err) => {
          console.error("[candidates] failed to enqueue github analysis", err);
          return null;
        },
      );
      analysisJobId = job?.id ?? null;
    }
    res.status(201).json({ ...candidate, github_analysis_job_id: analysisJobId });
  }),
);

export default router;
