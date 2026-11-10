import type { NextFunction, Request, Response } from "express";
import { env } from "../config/env";

/**
 * PLACEHOLDER AUTH — Phase 0 only.
 *
 * Checks a static `x-api-key` header against API_KEY from env. This is NOT
 * real authentication: no users, no JWTs, no scopes. It exists so routes can
 * be wired behind *something* while real auth (JWT/OAuth) lands in Phase 1.
 * Do not rely on this in production.
 */
export function requireApiKey(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  // If no API_KEY is configured, the check is disabled (local dev convenience).
  if (!env.apiKey) {
    next();
    return;
  }
  const supplied = req.header("x-api-key");
  if (supplied !== env.apiKey) {
    res.status(401).json({ error: "Unauthorized: missing or invalid x-api-key" });
    return;
  }
  next();
}
