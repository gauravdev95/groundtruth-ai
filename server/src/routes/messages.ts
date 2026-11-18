import { Router } from "express";
import { z } from "zod";
import { ApiError, asyncHandler } from "../middleware/errorHandler";
import { requireAuth, requireRole, type AuthRequest } from "../middleware/auth";
import {
  getThread,
  listThreads,
  sendMessage,
} from "../services/messaging";

const router = Router();

// All messaging routes need a signed-in candidate, recruiter or admin.
// Ownership is enforced per thread in the service (403 for non-parties).
router.use(requireAuth, requireRole("candidate", "recruiter", "admin"));

// GET /api/messages/threads — the caller's threads, newest activity first.
router.get(
  "/threads",
  asyncHandler(async (req, res) => {
    const user = (req as AuthRequest).user!;
    res.json(await listThreads(user.sub, user.role));
  }),
);

// GET /api/messages/threads/:applicationId — one thread + its messages.
// Reading marks the thread read for the caller.
router.get(
  "/threads/:applicationId",
  asyncHandler(async (req, res) => {
    const user = (req as AuthRequest).user!;
    res.json(await getThread(req.params.applicationId, user.sub, user.role));
  }),
);

const sendSchema = z.object({
  body: z.string().min(1).max(5000),
});

// POST /api/messages/threads/:applicationId/messages — send a message.
router.post(
  "/threads/:applicationId/messages",
  asyncHandler(async (req, res) => {
    const parsed = sendSchema.safeParse(req.body);
    if (!parsed.success) {
      throw new ApiError(400, "Message must be between 1 and 5000 characters");
    }
    const user = (req as AuthRequest).user!;
    const message = await sendMessage({
      applicationId: req.params.applicationId,
      userId: user.sub,
      role: user.role,
      body: parsed.data.body,
    });
    res.status(201).json(message);
  }),
);

export default router;
