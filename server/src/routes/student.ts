import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { Router } from "express";
import multer from "multer";
import type { QueryResultRow } from "pg";
import { z } from "zod";
import { pool } from "../config/db";
import { cloudinaryConfigured } from "../config/env";
import { CLOUDINARY_FOLDERS } from "../config/cloudinary";
import { ApiError, asyncHandler } from "../middleware/errorHandler";
import { requireAuth, requireRole, type AuthRequest } from "../middleware/auth";
import { enqueueGithubAnalysis, enqueueResumeParsing } from "../queues/jobs";
import { uploadBuffer } from "../services/cloudinary";
import {
  checkGithubHandleExists,
  getOrCreateCandidateForUser,
  loadDashboard,
  loadFullProfile,
  MANDATORY_SECTIONS,
  parseGithubHandle,
  type CandidateRow,
} from "../services/student";

const router = Router();

// Every student route: signed-in candidate only. The server is the
// security boundary — the client's RequireAuth guard is UX on top.
router.use(requireAuth, requireRole("candidate"));

/** The logged-in student's own candidate row (created on first use). */
async function ownCandidate(req: AuthRequest): Promise<CandidateRow> {
  const user = req.user as { sub: string; email: string };
  const me = await pool.query<{ full_name: string }>(
    "SELECT full_name FROM users WHERE id = $1",
    [user.sub],
  );
  return getOrCreateCandidateForUser(
    user.sub,
    user.email,
    (me.rows[0] as { full_name: string } | undefined)?.full_name ?? "Student",
  );
}

/** Load a sub-resource row only if it belongs to this student's candidate. */
async function ownRow<T extends QueryResultRow>(
  table: string,
  id: string,
  candidateId: string,
): Promise<T | null> {
  const { rows } = await pool.query<T>(
    `SELECT * FROM ${table} WHERE id = $1 AND candidate_id = $2`,
    [id, candidateId],
  );
  return (rows[0] as T | undefined) ?? null;
}

function mustUuid(value: string, label: string): void {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)) {
    throw new ApiError(400, `Invalid ${label} id`);
  }
}

// ── Profile ────────────────────────────────────────────────────────────────

const DEGREE_VALUES = [
  "btech", "be", "bsc", "bca", "mtech", "msc", "mca", "mba", "phd", "other",
] as const;
const BRANCH_VALUES = [
  "cse", "it", "ece", "eee", "mechanical", "civil", "chemical", "aiml",
  "data_science", "other",
] as const;
const TARGET_ROLE_VALUES = [
  "backend", "frontend", "fullstack", "mobile", "data_engineer",
  "data_scientist", "ml_engineer", "devops", "qa", "security", "other",
] as const;

const profileSchema = z.object({
  full_name: z.string().min(1).max(200).optional(),
  headline: z.string().max(200).nullable().optional(),
  location: z.string().max(200).nullable().optional(),
  summary: z.string().max(5000).nullable().optional(),
  phone: z.string().max(30).nullable().optional(),
  degree: z.enum(DEGREE_VALUES).nullable().optional(),
  branch: z.enum(BRANCH_VALUES).nullable().optional(),
  graduation_year: z.number().int().min(2000).max(2100).nullable().optional(),
  target_roles: z.array(z.enum(TARGET_ROLE_VALUES)).max(5).optional(),
  linkedin_url: z.string().url().nullable().optional(),
  portfolio_url: z.string().url().nullable().optional(),
  // Skills are free-text names (max 30); the server upserts them into the
  // shared `skills` table and links them with source='manual'.
  skills: z.array(z.string().min(1).max(60)).max(30).optional(),
});

// GET /api/student/profile — full profile + completeness + GitHub status.
router.get(
  "/profile",
  asyncHandler(async (req, res) => {
    const candidate = await ownCandidate(req as AuthRequest);
    res.json(await loadFullProfile(candidate.id));
  }),
);

// PUT /api/student/profile — update basic info (+ skills, replaced wholesale).
router.put(
  "/profile",
  asyncHandler(async (req, res) => {
    const parsed = profileSchema.safeParse(req.body);
    if (!parsed.success) {
      throw new ApiError(400, `Invalid profile: ${parsed.error.issues[0]?.message ?? "validation failed"}`);
    }
    const candidate = await ownCandidate(req as AuthRequest);
    const d = parsed.data;

    const sets: string[] = [];
    const values: unknown[] = [];
    const push = (column: string, value: unknown): void => {
      values.push(value);
      sets.push(`${column} = $${values.length}`);
    };
    if (d.full_name !== undefined) push("full_name", d.full_name);
    if (d.headline !== undefined) push("headline", d.headline);
    if (d.location !== undefined) push("location", d.location);
    if (d.summary !== undefined) push("summary", d.summary);
    if (d.phone !== undefined) push("phone", d.phone);
    if (d.degree !== undefined) push("degree", d.degree);
    if (d.branch !== undefined) push("branch", d.branch);
    if (d.graduation_year !== undefined) push("graduation_year", d.graduation_year);
    if (d.target_roles !== undefined) push("target_roles", d.target_roles);
    if (d.linkedin_url !== undefined) push("linkedin_url", d.linkedin_url);
    if (d.portfolio_url !== undefined) push("portfolio_url", d.portfolio_url);

    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      if (sets.length > 0) {
        await client.query(
          `UPDATE candidates SET ${sets.join(", ")}, updated_at = now() WHERE id = $${values.length + 1}`,
          [...values, candidate.id],
        );
      }
      if (d.skills !== undefined) {
        await client.query(
          "DELETE FROM candidate_skills WHERE candidate_id = $1 AND source = 'manual'",
          [candidate.id],
        );
        for (const name of d.skills) {
          const clean = name.trim();
          if (!clean) continue;
          const skill = await client.query<{ id: string }>(
            `INSERT INTO skills (name) VALUES ($1)
             ON CONFLICT (name) DO UPDATE SET name = EXCLUDED.name
             RETURNING id`,
            [clean],
          );
          await client.query(
            `INSERT INTO candidate_skills (candidate_id, skill_id, source)
             VALUES ($1, $2, 'manual') ON CONFLICT DO NOTHING`,
            [candidate.id, (skill.rows[0] as { id: string }).id],
          );
        }
      }
      await client.query("COMMIT");
    } catch (err) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw err;
    } finally {
      client.release();
    }
    res.json(await loadFullProfile(candidate.id));
  }),
);

// POST /api/student/onboarding/choice — resume_upload | manual_entry.
router.post(
  "/onboarding/choice",
  asyncHandler(async (req, res) => {
    const parsed = z
      .object({ choice: z.enum(["resume_upload", "manual_entry"]) })
      .safeParse(req.body);
    if (!parsed.success) {
      throw new ApiError(400, "choice must be resume_upload or manual_entry");
    }
    const candidate = await ownCandidate(req as AuthRequest);
    await pool.query(
      "UPDATE candidates SET onboarding_choice = $1, updated_at = now() WHERE id = $2",
      [parsed.data.choice, candidate.id],
    );
    res.json({ onboarding_choice: parsed.data.choice });
  }),
);

// POST /api/student/profile/complete — finish onboarding. Requires the
// mandatory sections (basic, GitHub, ≥1 project); otherwise 400 lists
// exactly what is missing. Idempotent: re-completing is a no-op.
router.post(
  "/profile/complete",
  asyncHandler(async (req, res) => {
    const candidate = await ownCandidate(req as AuthRequest);
    const full = await loadFullProfile(candidate.id);
    const missing = MANDATORY_SECTIONS.filter((s) => !full.completeness.sections[s].done);
    if (missing.length > 0) {
      throw new ApiError(
        400,
        `Onboarding is not complete yet — missing: ${missing.join(", ")}.`,
      );
    }
    await pool.query(
      `UPDATE candidates
       SET onboarding_completed_at = COALESCE(onboarding_completed_at, now()), updated_at = now()
       WHERE id = $1`,
      [candidate.id],
    );
    res.json(await loadFullProfile(candidate.id));
  }),
);

// ── GitHub ─────────────────────────────────────────────────────────────────
// PUT /api/student/profile/github — set handle/URL, best-effort public
// lookup (does the handle exist on GitHub?), then enqueue the existing
// repo analysis. A failed lookup never blocks the save: the status is
// recorded as "not checked" instead of a guess.
router.put(
  "/profile/github",
  asyncHandler(async (req, res) => {
    const parsed = z
      .object({
        github_handle: z.string().max(100).optional(),
        github_url: z.string().url().max(300).nullable().optional(),
      })
      .safeParse(req.body);
    if (!parsed.success) {
      throw new ApiError(400, `Invalid GitHub info: ${parsed.error.issues[0]?.message ?? "validation failed"}`);
    }
    const candidate = await ownCandidate(req as AuthRequest);
    const raw = parsed.data.github_handle ?? parsed.data.github_url ?? "";
    const handle = parseGithubHandle(raw);
    if (!handle) {
      throw new ApiError(400, "Enter a GitHub username or a github.com profile URL");
    }
    const exists = await checkGithubHandleExists(handle);
    const githubUrl = `https://github.com/${handle}`;
    await pool.query(
      `UPDATE candidates
       SET github_handle = $1, github_url = $2, github_handle_exists = $3,
           github_checked_at = now(), updated_at = now()
       WHERE id = $4`,
      [handle, githubUrl, exists, candidate.id],
    );
    // Background repo analysis (same worker as POST /api/candidates) — the
    // result lands in verification_results; a queue failure never blocks.
    await enqueueGithubAnalysis(githubUrl, candidate.id).catch((err) => {
      console.error("[student] failed to enqueue github analysis", err);
      return null;
    });
    res.json(await loadFullProfile(candidate.id));
  }),
);

// ── Dashboard ──────────────────────────────────────────────────────────────
// GET /api/student/dashboard — real counts + latest rows from the DB only.
// Empty tables produce 0s and empty lists, never invented numbers.
router.get(
  "/dashboard",
  asyncHandler(async (req, res) => {
    const candidate = await ownCandidate(req as AuthRequest);
    res.json(await loadDashboard(candidate.id));
  }),
);

// ── Resume upload ──────────────────────────────────────────────────────────
// POST /api/student/resume — multipart `file` (PDF, 10 MB max).
// Cloudinary when configured (Phase 0 behaviour); otherwise the file is
// stored under server/uploads/resumes/<candidateId>/ and the row records
// storage='local'. Either way the upload is real and retrievable.
const resumeUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (file.mimetype === "application/pdf") cb(null, true);
    else cb(new ApiError(400, "Only PDF resumes are allowed"));
  },
});

router.post(
  "/resume",
  resumeUpload.single("file"),
  asyncHandler(async (req, res) => {
    if (!req.file) throw new ApiError(400, "No file uploaded");
    const candidate = await ownCandidate(req as AuthRequest);
    const safeName = req.file.originalname.replace(/[^A-Za-z0-9._-]+/g, "_").slice(0, 120);
    const fileName = `${Date.now()}-${safeName}`;

    let row: { id: string };
    if (cloudinaryConfigured()) {
      const result = await uploadBuffer(req.file.buffer, {
        folder: CLOUDINARY_FOLDERS.resume,
        resourceType: "auto",
        fileName: req.file.originalname,
      });
      const inserted = await pool.query<{ id: string }>(
        `INSERT INTO resumes (candidate_id, cloudinary_url, public_id, file_name, storage)
         VALUES ($1, $2, $3, $4, 'cloudinary') RETURNING id`,
        [candidate.id, result.secure_url, result.public_id, req.file.originalname],
      );
      row = inserted.rows[0] as { id: string };
      await enqueueResumeParsing(row.id, result.secure_url).catch((err) => {
        console.error("[student] failed to enqueue resume parsing", err);
        return null;
      });
    } else {
      const dir = path.resolve(__dirname, "..", "..", "uploads", "resumes", candidate.id);
      await mkdir(dir, { recursive: true });
      const localPath = path.join(dir, fileName);
      await writeFile(localPath, req.file.buffer);
      const inserted = await pool.query<{ id: string }>(
        `INSERT INTO resumes (candidate_id, file_name, storage, local_path)
         VALUES ($1, $2, 'local', $3) RETURNING id`,
        [candidate.id, req.file.originalname, localPath],
      );
      row = inserted.rows[0] as { id: string };
    }
    res.status(201).json({
      resume: (await loadFullProfile(candidate.id)).resumes.find((r) => r.id === row.id) ?? null,
      storage: cloudinaryConfigured() ? "cloudinary" : "local",
      resume_parsing:
        cloudinaryConfigured()
          ? "enqueued"
          : "not available — resume parsing needs Cloudinary + the AI service; the file is stored and listed.",
    });
  }),
);

// GET /api/student/resume/:id/file — download your own locally stored resume.
router.get(
  "/resume/:id/file",
  asyncHandler(async (req, res) => {
    mustUuid(req.params.id, "resume");
    const candidate = await ownCandidate(req as AuthRequest);
    const found = await ownRow<{ storage: string; local_path: string | null; file_name: string | null }>(
      "resumes",
      req.params.id,
      candidate.id,
    );
    if (!found) throw new ApiError(404, "Resume not found");
    if (found.storage !== "local" || !found.local_path) {
      throw new ApiError(400, "This resume is stored in Cloudinary — use its download link");
    }
    res.download(found.local_path, found.file_name ?? "resume.pdf");
  }),
);

// ── Projects / coding profiles / certificates / experience ────────────────
// Generic CRUD: every row is scoped to the logged-in student's candidate,
// so one student can never read, edit or delete another's rows.

const projectSchema = z.object({
  title: z.string().min(1).max(200),
  description: z.string().max(5000).default(""),
  kind: z.enum(["repository", "described"]).default("described"),
  repo_url: z.string().url().max(500).nullable().optional(),
  role: z.string().max(200).nullable().optional(),
  technologies: z.array(z.string().min(1).max(60)).max(30).default([]),
  started_at: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  ended_at: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
});

const codingProfileSchema = z.object({
  platform: z.enum([
    "leetcode", "codeforces", "codechef", "hackerrank", "atcoder",
    "geeksforgeeks", "other",
  ]),
  username: z.string().min(1).max(100),
  profile_url: z.string().url().max(500).nullable().optional(),
});

const certificateSchema = z.object({
  title: z.string().min(1).max(300),
  issuer: z.string().max(200).nullable().optional(),
  issued_at: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  credential_url: z.string().url().max(500).nullable().optional(),
});

const experienceSchema = z.object({
  title: z.string().min(1).max(200),
  organization: z.string().min(1).max(200),
  employment_type: z
    .enum(["internship", "full_time", "part_time", "freelance", "research", "open_source"])
    .default("internship"),
  start_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  end_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  is_current: z.boolean().default(false),
  description: z.string().max(5000).default(""),
});

type CrudConfig = {
  table: string;
  label: string;
  schema: z.ZodTypeAny;
  insertColumns: string[];
  insertParams: (d: Record<string, unknown>) => unknown[];
  /** False for tables without an updated_at column (certificates). */
  hasUpdatedAt: boolean;
};

function registerCrud(config: CrudConfig, route: string): void {
  // POST — create a row for the logged-in student.
  router.post(
    route,
    asyncHandler(async (req, res) => {
      const parsed = config.schema.safeParse(req.body);
      if (!parsed.success) {
        throw new ApiError(400, `Invalid ${config.label}: ${parsed.error.issues[0]?.message ?? "validation failed"}`);
      }
      const candidate = await ownCandidate(req as AuthRequest);
      const d = parsed.data as Record<string, unknown>;
      const params = config.insertParams(d);
      const placeholders = params.map((_, i) => `$${i + 2}`).join(", ");
      const { rows } = await pool.query(
        `INSERT INTO ${config.table} (candidate_id, ${config.insertColumns.join(", ")})
         VALUES ($1, ${placeholders}) RETURNING *`,
        [candidate.id, ...params],
      );
      res.status(201).json(rows[0]);
    }),
  );

  // PUT — update only your own row.
  router.put(
    `${route}/:id`,
    asyncHandler(async (req, res) => {
      mustUuid(req.params.id, config.label);
      const parsed = config.schema.safeParse(req.body);
      if (!parsed.success) {
        throw new ApiError(400, `Invalid ${config.label}: ${parsed.error.issues[0]?.message ?? "validation failed"}`);
      }
      const candidate = await ownCandidate(req as AuthRequest);
      const existing = await ownRow(config.table, req.params.id, candidate.id);
      if (!existing) throw new ApiError(404, `${config.label} not found`);
      const d = parsed.data as Record<string, unknown>;
      const sets = config.insertColumns.map((col, i) => `${col} = $${i + 1}`);
      const updatedAt = config.hasUpdatedAt ? ", updated_at = now()" : "";
      const { rows } = await pool.query(
        `UPDATE ${config.table} SET ${sets.join(", ")}${updatedAt}
         WHERE id = $${config.insertColumns.length + 1} RETURNING *`,
        [...config.insertParams(d), req.params.id],
      );
      res.json(rows[0]);
    }),
  );

  // DELETE — delete only your own row.
  router.delete(
    `${route}/:id`,
    asyncHandler(async (req, res) => {
      mustUuid(req.params.id, config.label);
      const candidate = await ownCandidate(req as AuthRequest);
      const { rowCount } = await pool.query(
        `DELETE FROM ${config.table} WHERE id = $1 AND candidate_id = $2`,
        [req.params.id, candidate.id],
      );
      if (rowCount === 0) throw new ApiError(404, `${config.label} not found`);
      res.status(204).send();
    }),
  );
}

registerCrud(
  {
    table: "candidate_projects",
    label: "project",
    schema: projectSchema,
    insertColumns: ["title", "description", "kind", "repo_url", "role", "technologies", "started_at", "ended_at"],
    insertParams: (d) => [
      d.title, d.description, d.kind, d.repo_url ?? null, d.role ?? null,
      d.technologies, d.started_at ?? null, d.ended_at ?? null,
    ],
    hasUpdatedAt: true,
  },
  "/projects",
);

registerCrud(
  {
    table: "candidate_coding_profiles",
    label: "coding profile",
    schema: codingProfileSchema,
    insertColumns: ["platform", "username", "profile_url"],
    insertParams: (d) => [d.platform, d.username, d.profile_url ?? null],
    hasUpdatedAt: true,
  },
  "/coding-profiles",
);

registerCrud(
  {
    table: "certificates",
    label: "certificate",
    schema: certificateSchema,
    insertColumns: ["title", "issuer", "issued_at", "credential_url"],
    insertParams: (d) => [d.title, d.issuer ?? null, d.issued_at ?? null, d.credential_url ?? null],
    hasUpdatedAt: false,
  },
  "/certificates",
);

registerCrud(
  {
    table: "candidate_experience",
    label: "experience",
    schema: experienceSchema,
    insertColumns: ["title", "organization", "employment_type", "start_date", "end_date", "is_current", "description"],
    insertParams: (d) => [
      d.title, d.organization, d.employment_type, d.start_date ?? null,
      d.end_date ?? null, d.is_current, d.description,
    ],
    hasUpdatedAt: true,
  },
  "/experience",
);

export default router;
