import bcrypt from "bcryptjs";
import crypto from "node:crypto";
import jwt from "jsonwebtoken";
import { env } from "../config/env";

// ── Auth primitives (Phase 1) ────────────────────────────────────────────
// Pure helpers around bcrypt / JWT / reset tokens. They know nothing about
// Express or Postgres, so they are unit-tested directly (tests/auth.test.ts).

export type UserRole = "candidate" | "recruiter" | "admin";

/** Roles as stored in the `users.role` column (001_init.sql). */
export const USER_ROLES: readonly UserRole[] = ["candidate", "recruiter", "admin"];

/** Role shown on the signup form. "student" is the product word for the
 *  `candidate` role in the database — the two are the same account type. */
export type SignupRole = "student" | "recruiter";

export function dbRoleForSignupRole(role: SignupRole): "candidate" | "recruiter" {
  return role === "student" ? "candidate" : "recruiter";
}

export interface JwtPayload {
  sub: string; // user id
  email: string;
  role: UserRole;
}

const BCRYPT_ROUNDS = 12;

/** Reset tokens are valid for 30 minutes (same as the old repo's policy). */
export const RESET_TOKEN_VALIDITY_MS = 30 * 60 * 1000;

export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, BCRYPT_ROUNDS);
}

export async function verifyPassword(
  password: string,
  hash: string,
): Promise<boolean> {
  return bcrypt.compare(password, hash);
}

function getJwtSecret(): string {
  // Read at call time (not import time) so tests can set JWT_SECRET first.
  const secret = env.jwtSecret;
  if (!secret) {
    throw new Error(
      "JWT_SECRET is not set — refusing to sign a token. Set JWT_SECRET in the server environment.",
    );
  }
  return secret;
}

/** Sign a short-lived access token (default 1 day, via JWT_EXPIRES_IN). */
export function signAccessToken(payload: JwtPayload): string {
  return jwt.sign(payload, getJwtSecret(), { expiresIn: env.jwtExpiresIn } as jwt.SignOptions);
}

export function verifyAccessToken(token: string): JwtPayload {
  const decoded = jwt.verify(token, getJwtSecret()) as jwt.JwtPayload & JwtPayload;
  if (typeof decoded.sub !== "string" || typeof decoded.email !== "string") {
    throw new Error("Invalid token payload");
  }
  return { sub: decoded.sub, email: decoded.email, role: decoded.role as UserRole };
}

/**
 * Generate a password-reset token. The RAW token is returned once so the
 * caller can put it in a reset link; only its SHA-256 hash is ever stored.
 * The raw token must never be written to a log or a database column.
 */
export function generateResetToken(): { rawToken: string; tokenHash: string } {
  const rawToken = crypto.randomBytes(32).toString("hex");
  const tokenHash = hashResetToken(rawToken);
  return { rawToken, tokenHash };
}

export function hashResetToken(rawToken: string): string {
  return crypto.createHash("sha256").update(rawToken).digest("hex");
}
