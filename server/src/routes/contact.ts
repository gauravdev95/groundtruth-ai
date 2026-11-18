import { Router } from "express";
import { z } from "zod";
import { pool } from "../config/db";
import { ApiError, asyncHandler } from "../middleware/errorHandler";
import { rateLimit } from "../middleware/rateLimit";

const router = Router();

const contactSchema = z.object({
  name: z.string().trim().min(1).max(200),
  email: z.string().trim().email().max(320),
  message: z.string().trim().min(1).max(5000),
  // Where the message came from: 'contact_page' or 'landing_demo'.
  source: z.enum(["contact_page", "landing_demo"]).optional(),
});

// POST /api/contact — public contact / demo-request form.
//
// Stores the message in `contact_messages` and returns a success state.
// No email is sent: no SMTP is configured, and the response says so
// honestly ("we'll reach out") only in the sense that the message is now
// stored for the team to read — the client copy makes clear the team
// reviews stored messages. Rate-limited per IP to slow spam.
router.post(
  "/",
  rateLimit({ windowMs: 60_000, max: 5, keyPrefix: "contact" }),
  asyncHandler(async (req, res) => {
    const parsed = contactSchema.safeParse(req.body);
    if (!parsed.success) {
      throw new ApiError(
        400,
        "Please provide your name, a valid email address and a message.",
      );
    }
    const { rows } = await pool.query<{ id: string; created_at: string }>(
      `INSERT INTO contact_messages (name, email, message, source)
       VALUES ($1, $2, $3, $4)
       RETURNING id, created_at`,
      [
        parsed.data.name,
        parsed.data.email,
        parsed.data.message,
        parsed.data.source ?? "contact_page",
      ],
    );
    res.status(201).json({
      id: rows[0]!.id,
      created_at: rows[0]!.created_at,
      message:
        "Thanks — your message has been received and stored. Our team reviews contact messages and will reply by email; no automated email is sent from this form.",
    });
  }),
);

export default router;
