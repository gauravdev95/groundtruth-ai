import { Router } from "express";
import { z } from "zod";
import { pool } from "../config/db";
import { ApiError, asyncHandler } from "../middleware/errorHandler";
import { requireAuth, requireRole, type AuthRequest } from "../middleware/auth";
import {
  RECRUITER_STATUSES,
  isValidApplicationStatus,
  listMyApplications,
  loadApplicationDetail,
  updateApplicationStatus,
} from "../services/applications";
import { getOrCreateCandidateForUser } from "../services/student";

const router = Router();

// GET /api/applications/mine — the signed-in candidate's own applications
// (job + company + match score, if the matching engine wrote one).
router.get(
  "/mine",
  requireAuth,
  requireRole("candidate"),
  asyncHandler(async (req, res) => {
    const user = (req as AuthRequest).user!;
    const me = await pool.query<{ full_name: string }>(
      "SELECT full_name FROM users WHERE id = $1",
      [user.sub],
    );
    const candidate = await getOrCreateCandidateForUser(
      user.sub,
      user.email,
      me.rows[0]?.full_name ?? "Student",
    );
    res.json(await listMyApplications(candidate.id));
  }),
);

// GET /api/applications/:id — one application + the applicant's full
// student profile (read-only). The owning candidate, or a recruiter/admin
// whose company owns the job; anyone else gets a 404.
router.get(
  "/:id",
  requireAuth,
  requireRole("candidate", "recruiter", "admin"),
  asyncHandler(async (req, res) => {
    const user = (req as AuthRequest).user!;
    res.json(await loadApplicationDetail(req.params.id, user.sub, user.role));
  }),
);

const statusSchema = z.object({
  status: z.string(),
});

// PATCH /api/applications/:id/status — recruiter/admin moves an
// application through the pipeline (reviewing → interview → offer /
// rejected). Scoped to the recruiter's own company's jobs.
router.patch(
  "/:id/status",
  requireAuth,
  requireRole("recruiter", "admin"),
  asyncHandler(async (req, res) => {
    const parsed = statusSchema.safeParse(req.body);
    if (!parsed.success) {
      throw new ApiError(400, "Invalid status update");
    }
    if (
      !isValidApplicationStatus(parsed.data.status) ||
      !(RECRUITER_STATUSES as string[]).includes(parsed.data.status)
    ) {
      throw new ApiError(
        400,
        `Invalid status — recruiters may set: ${RECRUITER_STATUSES.join(", ")}`,
      );
    }
    const user = (req as AuthRequest).user!;
    res.json(
      await updateApplicationStatus(
        req.params.id,
        user.sub,
        user.role,
        parsed.data.status,
      ),
    );
  }),
);

export default router;
