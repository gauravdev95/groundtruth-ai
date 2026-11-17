import { Router } from "express";
import { z } from "zod";
import { pool } from "../config/db";
import { env } from "../config/env";
import { ApiError, asyncHandler } from "../middleware/errorHandler";
import { requireAuth, type AuthRequest } from "../middleware/auth";
import {
  dbRoleForSignupRole,
  generateResetToken,
  hashPassword,
  hashResetToken,
  RESET_TOKEN_VALIDITY_MS,
  signAccessToken,
  verifyPassword,
  type UserRole,
} from "../services/auth";

// ── Auth routes (Phase 1) ────────────────────────────────────────────────
// POST /api/auth/register — student ("candidate" in the DB) or recruiter.
// POST /api/auth/login — email + password → JWT.
// GET  /api/auth/me — current user from the Bearer token.
// POST /api/auth/logout — stateless JWT: the client discards the token; the
//      server keeps no session to revoke (a token denylist is future work).
// POST /api/auth/forgot-password — issues an expiring reset token.
// POST /api/auth/reset-password — consumes the token, sets a new password.
//
// Password policy (mirrors the old repo): ≥8 chars, upper + lower + digit
// + special. The server is authoritative; the client mirrors it for UX only.
//
// Mail: this repo has NO mail sender configured (no SMTP settings anywhere),
// so forgot-password cannot email the reset link yet. Behaviour is explicit:
// the endpoint always returns the same generic message (it never reveals
// whether the email exists), and ONLY when NODE_ENV=development it also
// returns `resetUrl` in the response so the flow can be completed and tested
// locally. In production the link is stored hashed server-side and goes
// nowhere until a mail sender is wired — that is a known Phase 1 gap, not
// a silent fallback. The raw token is never logged.

const router = Router();

const passwordSchema = z
  .string()
  .min(8, "Password must be at least 8 characters")
  .max(128, "Password must be at most 128 characters")
  .regex(/[A-Z]/, "Password must include at least one uppercase letter")
  .regex(/[a-z]/, "Password must include at least one lowercase letter")
  .regex(/\d/, "Password must include at least one number")
  .regex(/[^A-Za-z0-9]/, "Password must include at least one special character");

const emailSchema = z.string().trim().toLowerCase().email("Enter a valid email address");

const registerSchema = z
  .object({
    email: emailSchema,
    password: passwordSchema,
    full_name: z.string().trim().min(2, "Enter your full name").max(200),
    role: z.enum(["student", "recruiter"]),
    // Required for recruiters: their company is created alongside the account.
    company_name: z.string().trim().min(2).max(200).optional(),
  })
  .refine((d) => d.role !== "recruiter" || Boolean(d.company_name?.trim()), {
    message: "Company name is required for recruiters",
    path: ["company_name"],
  });

const loginSchema = z.object({
  email: emailSchema,
  password: z.string().min(1, "Password is required"),
});

const forgotSchema = z.object({ email: emailSchema });

const resetSchema = z.object({
  token: z.string().min(1, "Reset token is required"),
  new_password: passwordSchema,
});

interface UserRow {
  id: string;
  email: string;
  full_name: string;
  role: UserRole;
  password_hash: string | null;
}

function publicUser(row: UserRow) {
  return { id: row.id, email: row.email, full_name: row.full_name, role: row.role };
}

function issueToken(row: UserRow): { user: ReturnType<typeof publicUser>; token: string } {
  const token = signAccessToken({ sub: row.id, email: row.email, role: row.role });
  return { user: publicUser(row), token };
}

// Dummy hash so a login for a non-existent email costs the same bcrypt
// compare as a real one (no user-enumeration via timing). It is the hash of
// a password that is never used for any account — not a credential.
const DUMMY_HASH = "$2b$12$jkDI6j7qZ8C5LXij8fGk6.vljjYoW4vJ/zjQH.eTQJ0U3b4j9OLHu";

// POST /api/auth/register
router.post(
  "/register",
  asyncHandler(async (req, res) => {
    const parsed = registerSchema.safeParse(req.body);
    if (!parsed.success) {
      throw new ApiError(400, parsed.error.issues[0]?.message ?? "Invalid registration data");
    }
    const { email, password, full_name, role, company_name } = parsed.data;
    const dbRole = dbRoleForSignupRole(role);

    const existing = await pool.query("SELECT id FROM users WHERE email = $1", [email]);
    if (existing.rows.length > 0) {
      throw new ApiError(409, "An account with this email already exists");
    }

    const passwordHash = await hashPassword(password);
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const { rows } = await client.query<UserRow>(
        `INSERT INTO users (email, full_name, role, password_hash)
         VALUES ($1, $2, $3, $4) RETURNING id, email, full_name, role, password_hash`,
        [email, full_name, dbRole, passwordHash],
      );
      const user = rows[0];
      if (role === "recruiter" && company_name) {
        await client.query(
          `INSERT INTO companies (name, created_by) VALUES ($1, $2)`,
          [company_name.trim(), user.id],
        );
      }
      await client.query("COMMIT");
      res.status(201).json(issueToken(user));
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }
  }),
);

// POST /api/auth/login
router.post(
  "/login",
  asyncHandler(async (req, res) => {
    const parsed = loginSchema.safeParse(req.body);
    if (!parsed.success) {
      throw new ApiError(400, parsed.error.issues[0]?.message ?? "Invalid login data");
    }
    const { email, password } = parsed.data;
    const { rows } = await pool.query<UserRow>(
      "SELECT id, email, full_name, role, password_hash FROM users WHERE email = $1",
      [email],
    );
    const user = rows[0];
    const hash = user?.password_hash ?? DUMMY_HASH;
    const ok = await verifyPassword(password, hash);
    if (!user || !user.password_hash || !ok) {
      // Same message either way: never reveal whether the email exists.
      throw new ApiError(401, "Invalid email or password");
    }
    res.json(issueToken(user));
  }),
);

// GET /api/auth/me
router.get(
  "/me",
  requireAuth,
  asyncHandler(async (req: AuthRequest, res) => {
    const { rows } = await pool.query<UserRow>(
      "SELECT id, email, full_name, role, password_hash FROM users WHERE id = $1",
      [req.user!.sub],
    );
    const user = rows[0];
    if (!user) throw new ApiError(401, "Unauthorized: account no longer exists");
    res.json({ user: publicUser(user) });
  }),
);

// POST /api/auth/logout — stateless JWT; the client discards the token.
router.post("/logout", requireAuth, (_req, res) => {
  res.json({ message: "Logged out. Discard the token on the client." });
});

// POST /api/auth/forgot-password
router.post(
  "/forgot-password",
  asyncHandler(async (req, res) => {
    const parsed = forgotSchema.safeParse(req.body);
    if (!parsed.success) {
      throw new ApiError(400, parsed.error.issues[0]?.message ?? "Invalid email");
    }
    const { email } = parsed.data;
    const generic = {
      message: "If an account exists for this email, a password-reset link has been sent.",
    };
    const { rows } = await pool.query<{ id: string }>(
      "SELECT id FROM users WHERE email = $1",
      [email],
    );
    const user = rows[0];
    if (!user) {
      // Same response as the success path — never reveal existence.
      res.json(generic);
      return;
    }
    const { rawToken, tokenHash } = generateResetToken();
    const expiresAt = new Date(Date.now() + RESET_TOKEN_VALIDITY_MS);
    await pool.query(
      `INSERT INTO password_reset_tokens (user_id, token_hash, expires_at)
       VALUES ($1, $2, $3)`,
      [user.id, tokenHash, expiresAt.toISOString()],
    );
    const resetUrl = `${env.frontendUrl.replace(/\/$/, "")}/auth/reset-password?token=${rawToken}`;
    if (env.nodeEnv === "development") {
      // Dev-only: no mail sender exists yet, so the link is returned for
      // local testing. NEVER returned in production. Never logged either way.
      res.json({ ...generic, resetUrl });
      return;
    }
    res.json(generic);
  }),
);

// POST /api/auth/reset-password
router.post(
  "/reset-password",
  asyncHandler(async (req, res) => {
    const parsed = resetSchema.safeParse(req.body);
    if (!parsed.success) {
      throw new ApiError(400, parsed.error.issues[0]?.message ?? "Invalid reset data");
    }
    const { token, new_password } = parsed.data;
    const { rows } = await pool.query<{
      id: string;
      user_id: string;
      expires_at: Date;
      used_at: Date | null;
    }>(
      `SELECT id, user_id, expires_at, used_at FROM password_reset_tokens
        WHERE token_hash = $1`,
      [hashResetToken(token)],
    );
    const row = rows[0];
    if (!row || row.used_at || new Date(row.expires_at).getTime() < Date.now()) {
      throw new ApiError(400, "Reset link is invalid or has expired. Request a new one.");
    }
    const passwordHash = await hashPassword(new_password);
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("UPDATE users SET password_hash = $1, updated_at = now() WHERE id = $2", [
        passwordHash,
        row.user_id,
      ]);
      await client.query(
        "UPDATE password_reset_tokens SET used_at = now() WHERE id = $1",
        [row.id],
      );
      // Invalidate any other outstanding reset tokens for this user.
      await client.query(
        "DELETE FROM password_reset_tokens WHERE user_id = $1 AND id <> $2",
        [row.user_id, row.id],
      );
      await client.query("COMMIT");
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }
    res.json({ message: "Password updated. You can now log in with your new password." });
  }),
);

export default router;
