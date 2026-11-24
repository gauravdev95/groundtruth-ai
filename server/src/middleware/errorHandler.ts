import type { NextFunction, Request, Response } from "express";

// Central error handler — registered last in src/index.ts.
// ApiError carries an HTTP status; anything else is a 500 with no internals leaked.
export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export function errorHandler(
  err: Error,
  _req: Request,
  res: Response,
  _next: NextFunction,
): void {
  if (err instanceof ApiError) {
    res.status(err.status).json({ error: err.message });
    return;
  }
  // Postgres 22P02 "invalid input syntax" — e.g. a malformed UUID in a
  // :id path param reaching a query as $1. That is a client error (bad id
  // format), never a server error: answer 400 without leaking internals.
  // (Found 23 Nov 2026: GET /api/jobs/not-a-uuid returned 500.)
  const pgCode = (err as { code?: unknown }).code;
  if (pgCode === "22P02") {
    res.status(400).json({ error: "Invalid id format" });
    return;
  }
  // body-parser errors (express.json): a malformed JSON body throws a
  // SyntaxError carrying status/statusCode 400 (and expose: true), and an
  // over-limit body throws with status 413. Both are CLIENT errors — the
  // old code answered 500 for them (found 23 Nov 2026: POST /api/uploads
  // with body `not-a-file` and Content-Type: application/json returned
  // 500). Honour the 4xx status; never leak the parser's message.
  const httpStatus = (err as { status?: unknown; statusCode?: unknown }).status ??
    (err as { statusCode?: unknown }).statusCode;
  if (typeof httpStatus === "number" && httpStatus >= 400 && httpStatus < 500) {
    const message =
      err instanceof SyntaxError ? "Invalid JSON in request body" : "Bad request";
    res.status(httpStatus).json({ error: message });
    return;
  }
  console.error("[error]", err);
  res.status(500).json({ error: "Internal server error" });
}

// Wrap async route handlers so rejected promises reach errorHandler.
export function asyncHandler(
  fn: (req: Request, res: Response, next: NextFunction) => Promise<void>,
) {
  return (req: Request, res: Response, next: NextFunction): void => {
    fn(req, res, next).catch(next);
  };
}
