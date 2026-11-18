import { Router } from "express";
import { asyncHandler } from "../middleware/errorHandler";
import { requireAuth, type AuthRequest } from "../middleware/auth";
import {
  listNotifications,
  markAllNotificationsRead,
  markNotificationRead,
  unreadNotificationCount,
} from "../services/notifications";

const router = Router();

// In-app notifications for the signed-in user. Rows are only ever
// written by the real flows (application stage, message, assessment,
// interview) — this router only reads and marks them.
router.use(requireAuth);

// GET /api/notifications — newest first.
router.get(
  "/",
  asyncHandler(async (req, res) => {
    const user = (req as AuthRequest).user!;
    res.json(await listNotifications(user.sub));
  }),
);

// GET /api/notifications/unread-count — { unread: number }.
router.get(
  "/unread-count",
  asyncHandler(async (req, res) => {
    const user = (req as AuthRequest).user!;
    res.json({ unread: await unreadNotificationCount(user.sub) });
  }),
);

// PATCH /api/notifications/:id/read — mark one read (own rows only).
router.patch(
  "/:id/read",
  asyncHandler(async (req, res) => {
    const user = (req as AuthRequest).user!;
    res.json(await markNotificationRead(user.sub, req.params.id));
  }),
);

// POST /api/notifications/mark-all-read — mark everything read.
router.post(
  "/mark-all-read",
  asyncHandler(async (req, res) => {
    const user = (req as AuthRequest).user!;
    const marked = await markAllNotificationsRead(user.sub);
    res.json({ marked });
  }),
);

export default router;
