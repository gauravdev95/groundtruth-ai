import { pool } from "../config/db";
import { ApiError } from "../middleware/errorHandler";

/**
 * Notifications service — Phase 7.
 *
 * In-app notifications only. Rows are written by the real flows that
 * produce them (application stage change, new message, assessment and
 * interview updates) — never seeded or fabricated. A notification
 * insert must never break the flow that triggered it, so callers use
 * `notify(...)` (best-effort: logs and swallows DB errors) while the
 * read/mark functions below throw normally.
 */

export const NOTIFICATION_TYPES = [
  "application_status",
  "message",
  "interview",
  "assessment",
  "job_match",
] as const;

export type NotificationType = (typeof NOTIFICATION_TYPES)[number];

export interface NotificationRow {
  id: string;
  user_id: string;
  type: NotificationType;
  title: string;
  body: string;
  link: string | null;
  application_id: string | null;
  is_read: boolean;
  created_at: string;
}

export interface NewNotification {
  userId: string;
  type: NotificationType;
  title: string;
  body: string;
  link?: string | null;
  applicationId?: string | null;
}

/** Insert one notification; returns the row, or null when the insert failed. */
export async function notify(
  input: NewNotification,
): Promise<NotificationRow | null> {
  try {
    const { rows } = await pool.query<NotificationRow>(
      `INSERT INTO notifications (user_id, type, title, body, link, application_id)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id, user_id, type, title, body, link, application_id, is_read, created_at`,
      [
        input.userId,
        input.type,
        input.title,
        input.body,
        input.link ?? null,
        input.applicationId ?? null,
      ],
    );
    return rows[0] ?? null;
  } catch (err) {
    // Notifications are advisory: a failed insert must not fail the
    // application/message/assessment flow that triggered it.
    console.error("[notifications] insert failed", err);
    return null;
  }
}

/** The users.user_id that owns a candidate row (for candidate notifications). */
export async function userIdForCandidate(
  candidateId: string,
): Promise<string | null> {
  const { rows } = await pool.query<{ user_id: string | null }>(
    "SELECT user_id FROM candidates WHERE id = $1",
    [candidateId],
  );
  return rows[0]?.user_id ?? null;
}

/** Notify the candidate who owns `candidateId`, when they have a user row. */
export async function notifyCandidate(
  candidateId: string,
  input: Omit<NewNotification, "userId">,
): Promise<NotificationRow | null> {
  const userId = await userIdForCandidate(candidateId).catch(() => null);
  if (!userId) return null;
  return notify({ ...input, userId });
}

/** The signed-in user's notifications, newest first. */
export async function listNotifications(
  userId: string,
  limit = 50,
): Promise<NotificationRow[]> {
  const { rows } = await pool.query<NotificationRow>(
    `SELECT id, user_id, type, title, body, link, application_id, is_read, created_at
     FROM notifications WHERE user_id = $1
     ORDER BY created_at DESC LIMIT $2`,
    [userId, Math.min(Math.max(limit, 1), 100)],
  );
  return rows;
}

/** Number of unread notifications for the signed-in user. */
export async function unreadNotificationCount(
  userId: string,
): Promise<number> {
  const { rows } = await pool.query<{ n: string }>(
    "SELECT COUNT(*)::text AS n FROM notifications WHERE user_id = $1 AND is_read = false",
    [userId],
  );
  return Number(rows[0]?.n ?? 0);
}

/**
 * Mark one notification read. Only the owning user may do it; anyone
 * else (or a missing row) gets a 404 so notification ids cannot be
 * probed across users.
 */
export async function markNotificationRead(
  userId: string,
  notificationId: string,
): Promise<NotificationRow> {
  const { rows } = await pool.query<NotificationRow>(
    `UPDATE notifications SET is_read = true
     WHERE id = $1 AND user_id = $2
     RETURNING id, user_id, type, title, body, link, application_id, is_read, created_at`,
    [notificationId, userId],
  );
  if (!rows[0]) {
    throw new ApiError(404, "Notification not found");
  }
  return rows[0];
}

/** Mark every notification of the signed-in user read; returns how many changed. */
export async function markAllNotificationsRead(
  userId: string,
): Promise<number> {
  const { rows } = await pool.query<{ n: string }>(
    `UPDATE notifications SET is_read = true
     WHERE user_id = $1 AND is_read = false
     RETURNING 1`,
    [userId],
  );
  return rows.length;
}
