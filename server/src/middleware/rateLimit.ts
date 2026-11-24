import type { NextFunction, Request, Response } from "express";
import { ApiError } from "./errorHandler";

// In-memory token-bucket rate limiter (per key = IP + user id when known).
// No Redis dependency: assessment routes are low-volume and this keeps the
// limiter working even when Redis is down. Buckets are capped so memory
// cannot grow without bound.
interface Bucket {
  tokens: number;
  updatedAt: number;
}

const buckets = new Map<string, Bucket>();
const MAX_BUCKETS = 10_000;

export function rateLimit(opts: {
  windowMs: number;
  max: number;
  keyPrefix: string;
}) {
  const refillPerMs = opts.max / opts.windowMs;
  return (req: Request, _res: Response, next: NextFunction): void => {
    const userId =
      (req as unknown as { user?: { sub?: string } }).user?.sub ?? "anon";
    const key = `${opts.keyPrefix}:${req.ip ?? "?"}:${userId}`;
    const now = Date.now();
    let bucket = buckets.get(key);
    if (!bucket) {
      if (buckets.size >= MAX_BUCKETS) buckets.clear();
      bucket = { tokens: opts.max, updatedAt: now };
      buckets.set(key, bucket);
    }
    const elapsed = now - bucket.updatedAt;
    bucket.tokens = Math.min(opts.max, bucket.tokens + elapsed * refillPerMs);
    bucket.updatedAt = now;
    if (bucket.tokens < 1) {
      next(
        new ApiError(
          429,
          "Too many requests — please wait a moment and try again.",
        ),
      );
      return;
    }
    bucket.tokens -= 1;
    next();
  };
}

// Strict limiter for LLM-backed endpoints (they cost money / time).
export const llmRateLimit = rateLimit({
  windowMs: 60_000,
  max: 10,
  keyPrefix: "llm",
});

// Auth endpoints were unprotected: login had no rate limit at all (the old
// repo had 5 logins/min -> 429). Brute-force / credential-stuffing and
// mass-registration need a per-IP brake. Buckets are per IP (+ user id
// when known); behind Render, req.ip is only correct with
// app.set("trust proxy", 1) — see src/index.ts.
export const loginRateLimit = rateLimit({
  windowMs: 60_000,
  max: 5,
  keyPrefix: "login",
});

export const forgotPasswordRateLimit = rateLimit({
  windowMs: 60_000,
  max: 5,
  keyPrefix: "forgot",
});

// Registration + password reset: looser, but still capped per IP.
export const authRateLimit = rateLimit({
  windowMs: 60_000,
  max: 10,
  keyPrefix: "auth",
});

// Uploads cost money (Cloudinary) and queue background work; cap per IP+user.
export const uploadRateLimit = rateLimit({
  windowMs: 60_000,
  max: 10,
  keyPrefix: "upload",
});

// General limiter for assessment + execution routes.
export const assessmentRateLimit = rateLimit({
  windowMs: 60_000,
  max: 60,
  keyPrefix: "assessment",
});
