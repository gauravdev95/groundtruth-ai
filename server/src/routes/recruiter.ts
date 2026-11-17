import { Router } from "express";
import { z } from "zod";
import { pool } from "../config/db";
import { ApiError, asyncHandler } from "../middleware/errorHandler";
import { requireAuth, requireRole, type AuthRequest } from "../middleware/auth";
import {
  COMPANY_SIZES,
  getOrCreateRecruiterForUser,
  loadRecruiterDashboard,
  loadRecruiterProfile,
  type CompanyRow,
} from "../services/recruiter";
import { listRecruiterApplications } from "../services/applications";

const router = Router();

// Every recruiter route: signed-in recruiter only. The server is the
// security boundary — the client's RequireAuth guard is UX on top.
// A student (candidate) token gets 403 here, by design.
router.use(requireAuth, requireRole("recruiter"));

// GET /api/recruiter/profile — recruiter details + company profile +
// server-side completeness. The company is null until the recruiter has
// one (see services/recruiter.ts); the client shows the empty state.
router.get(
  "/profile",
  asyncHandler(async (req, res) => {
    res.json(await loadRecruiterProfile((req as AuthRequest).user!.sub));
  }),
);

const profileSchema = z.object({
  // Personal details (users.full_name + recruiter_profiles).
  full_name: z.string().trim().min(2).max(200).optional(),
  job_title: z.string().trim().max(200).nullable().optional(),
  phone: z.string().trim().max(30).nullable().optional(),
  linkedin_url: z.string().trim().url().max(500).nullable().optional(),
  // Company profile (companies row — the one created at registration).
  company_name: z.string().trim().min(2).max(200).nullable().optional(),
  company_website: z.string().trim().url().max(500).nullable().optional(),
  company_industry: z.string().trim().max(100).nullable().optional(),
  company_size: z.enum(COMPANY_SIZES).nullable().optional(),
  company_location: z.string().trim().max(200).nullable().optional(),
  company_about: z.string().trim().max(5000).nullable().optional(),
});

// PUT /api/recruiter/profile — update personal details and/or the company
// profile. If the recruiter has no company row yet, a company_name in the
// request creates it (linked to the recruiter) — the name is never guessed.
// Company fields without a company row and without a company_name are
// rejected, so a company can never be half-created from stray fields.
router.put(
  "/profile",
  asyncHandler(async (req, res) => {
    const parsed = profileSchema.safeParse(req.body);
    if (!parsed.success) {
      throw new ApiError(400, `Invalid profile: ${parsed.error.issues[0]?.message ?? "validation failed"}`);
    }
    const userId = (req as AuthRequest).user!.sub;
    const d = parsed.data;
    const { profile, company } = await getOrCreateRecruiterForUser(userId);

    const companyFieldsSent =
      d.company_name !== undefined ||
      d.company_website !== undefined ||
      d.company_industry !== undefined ||
      d.company_size !== undefined ||
      d.company_location !== undefined ||
      d.company_about !== undefined;
    if (!company && companyFieldsSent && !d.company_name?.trim()) {
      throw new ApiError(
        400,
        "Company name is required to create your company profile",
      );
    }

    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      if (d.full_name !== undefined) {
        await client.query(
          "UPDATE users SET full_name = $1, updated_at = now() WHERE id = $2",
          [d.full_name, userId],
        );
      }
      const sets: string[] = [];
      const values: unknown[] = [];
      const push = (column: string, value: unknown): void => {
        values.push(value);
        sets.push(`${column} = $${values.length}`);
      };
      if (d.job_title !== undefined) push("job_title", d.job_title);
      if (d.phone !== undefined) push("phone", d.phone);
      if (d.linkedin_url !== undefined) push("linkedin_url", d.linkedin_url);
      if (sets.length > 0) {
        await client.query(
          `UPDATE recruiter_profiles SET ${sets.join(", ")}, updated_at = now()
           WHERE id = $${values.length + 1}`,
          [...values, profile.id],
        );
      }

      let companyRow: CompanyRow | null = company;
      if (companyRow) {
        const cSets: string[] = [];
        const cValues: unknown[] = [];
        const cPush = (column: string, value: unknown): void => {
          cValues.push(value);
          cSets.push(`${column} = $${cValues.length}`);
        };
        if (d.company_name !== undefined) cPush("name", d.company_name);
        if (d.company_website !== undefined) cPush("website", d.company_website);
        if (d.company_industry !== undefined) cPush("industry", d.company_industry);
        if (d.company_size !== undefined) cPush("size", d.company_size);
        if (d.company_location !== undefined) cPush("location", d.company_location);
        if (d.company_about !== undefined) cPush("description", d.company_about);
        if (cSets.length > 0) {
          const updated = await client.query<CompanyRow>(
            `UPDATE companies SET ${cSets.join(", ")}, updated_at = now()
             WHERE id = $${cValues.length + 1} RETURNING *`,
            [...cValues, companyRow.id],
          );
          companyRow = updated.rows[0] as CompanyRow;
        }
      } else if (d.company_name?.trim()) {
        const created = await client.query<CompanyRow>(
          `INSERT INTO companies (name, website, industry, size, location, description, created_by)
           VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
          [
            d.company_name.trim(),
            d.company_website ?? null,
            d.company_industry ?? null,
            d.company_size ?? null,
            d.company_location ?? null,
            d.company_about ?? null,
            userId,
          ],
        );
        companyRow = created.rows[0] as CompanyRow;
        await client.query(
          "UPDATE recruiter_profiles SET company_id = $1, updated_at = now() WHERE id = $2",
          [companyRow.id, profile.id],
        );
      }
      await client.query("COMMIT");
    } catch (err) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw err;
    } finally {
      client.release();
    }
    res.json(await loadRecruiterProfile(userId));
  }),
);

// GET /api/recruiter/dashboard — real counts + latest rows from the DB
// only, scoped to the recruiter's company. Empty tables produce 0s and
// empty lists, never invented numbers.
router.get(
  "/dashboard",
  asyncHandler(async (req, res) => {
    res.json(await loadRecruiterDashboard((req as AuthRequest).user!.sub));
  }),
);

// GET /api/recruiter/applications — every application across the
// recruiter's own company's jobs, newest first, with the match score
// when the matching engine has written one (null otherwise).
router.get(
  "/applications",
  asyncHandler(async (req, res) => {
    res.json(
      await listRecruiterApplications((req as AuthRequest).user!.sub),
    );
  }),
);

export default router;
