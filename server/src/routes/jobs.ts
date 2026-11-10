import { Router } from "express";
import { z } from "zod";
import { pool } from "../config/db";
import { ApiError, asyncHandler } from "../middleware/errorHandler";
import { enqueueReembedding } from "../queues/jobs";

const router = Router();

const createJobSchema = z.object({
  company_id: z.string().uuid(),
  title: z.string().min(1).max(200),
  description: z.string().min(1),
  location: z.string().max(200).optional().nullable(),
  employment_type: z
    .enum(["full_time", "part_time", "contract", "internship"])
    .default("full_time"),
  salary_min: z.number().int().nonnegative().optional().nullable(),
  salary_max: z.number().int().nonnegative().optional().nullable(),
  salary_currency: z.string().length(3).default("INR"),
});

const JOB_COLUMNS = `
  j.id, j.company_id, j.title, j.description, j.location,
  j.employment_type, j.salary_min, j.salary_max, j.salary_currency,
  j.status, j.created_at, c.name AS company_name
  FROM jobs j LEFT JOIN companies c ON c.id = j.company_id
`;

// GET /api/jobs — open jobs, newest first.
router.get(
  "/",
  asyncHandler(async (_req, res) => {
    const { rows } = await pool.query(
      `SELECT ${JOB_COLUMNS} WHERE j.status = 'open' ORDER BY j.created_at DESC`,
    );
    res.json(rows);
  }),
);

// GET /api/jobs/:id
router.get(
  "/:id",
  asyncHandler(async (req, res) => {
    const { rows } = await pool.query(`SELECT ${JOB_COLUMNS} WHERE j.id = $1`, [
      req.params.id,
    ]);
    if (rows.length === 0) throw new ApiError(404, "Job not found");
    res.json(rows[0]);
  }),
);

// POST /api/jobs — create a job, then enqueue its embedding (202-style:
// the job is created synchronously, the embedding is background work).
router.post(
  "/",
  asyncHandler(async (req, res) => {
    const parsed = createJobSchema.safeParse(req.body);
    if (!parsed.success) {
      throw new ApiError(400, `Invalid job: ${parsed.error.issues[0]?.message ?? "validation failed"}`);
    }
    const d = parsed.data;
    const { rows } = await pool.query(
      `INSERT INTO jobs (company_id, title, description, location, employment_type,
         salary_min, salary_max, salary_currency)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *`,
      [d.company_id, d.title, d.description, d.location ?? null, d.employment_type,
       d.salary_min ?? null, d.salary_max ?? null, d.salary_currency],
    );
    const job = rows[0] as { id: string };
    // Embed the job description in the background — never block the response.
    const embedJob = await enqueueReembedding("job", job.id).catch((err) => {
      console.error("[jobs] failed to enqueue re-embedding", err);
      return null;
    });
    res.status(201).json({ ...job, embedding_job_id: embedJob?.id ?? null });
  }),
);

export default router;
