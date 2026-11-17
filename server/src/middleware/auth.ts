import type { NextFunction, Request, Response } from "express";
import { ApiError } from "./errorHandler";
import {
  verifyAccessToken,
  type JwtPayload,
  type UserRole,
} from "../services/auth";

/**
 * Real JWT auth (Phase 1). Replaces the Phase 0 `x-api-key` placeholder,
 * which is deleted: no route used it, and a shared static key is not
 * authentication.
 *
 * Clients send `Authorization: Bearer <jwt>` (issued by POST /api/auth/login).
 * `requireAuth` verifies the token and attaches the user to the request;
 * `requireRole(...)` additionally enforces the role stored on the user.
 */

export interface AuthRequest extends Request {
  user?: JwtPayload;
}

export function requireAuth(
  req: AuthRequest,
  _res: Response,
  next: NextFunction,
): void {
  const header = req.header("authorization");
  if (!header?.startsWith("Bearer ")) {
    next(new ApiError(401, "Unauthorized: missing Bearer token"));
    return;
  }
  const token = header.slice("Bearer ".length).trim();
  if (!token) {
    next(new ApiError(401, "Unauthorized: missing Bearer token"));
    return;
  }
  try {
    req.user = verifyAccessToken(token);
    next();
  } catch {
    next(new ApiError(401, "Unauthorized: invalid or expired token"));
  }
}

/**
 * Role guard — use AFTER requireAuth. Pass every role allowed on the route,
 * e.g. `requireRole("recruiter", "admin")`. The role comes from the signed
 * JWT, which the server set from the `users.role` column at login time.
 */
export function requireRole(...allowed: UserRole[]) {
  return (req: AuthRequest, _res: Response, next: NextFunction): void => {
    if (!req.user) {
      next(new ApiError(401, "Unauthorized: missing Bearer token"));
      return;
    }
    if (!allowed.includes(req.user.role)) {
      next(
        new ApiError(
          403,
          `Forbidden: this action requires one of: ${allowed.join(", ")}`,
        ),
      );
      return;
    }
    next();
  };
}
