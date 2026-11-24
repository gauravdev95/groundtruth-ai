import test from "node:test";
import assert from "node:assert/strict";

// Unit tests for the central error handler — no DB/Redis involved.
// Covers the 23 Nov 2026 fix: body-parser SyntaxErrors (malformed JSON)
// carry status/statusCode 400 and must be answered 400, never 500.
import { ApiError, errorHandler } from "../src/middleware/errorHandler";

function mockRes() {
  return {
    statusCode: 0,
    body: undefined as unknown,
    status(code: number) {
      this.statusCode = code;
      return this;
    },
    json(body: unknown) {
      this.body = body;
      return this;
    },
  };
}

const noopNext = () => undefined;

test("ApiError keeps its status and message", () => {
  const res = mockRes();
  errorHandler(new ApiError(403, "Forbidden thing"), {} as never, res as never, noopNext);
  assert.equal(res.statusCode, 403);
  assert.deepEqual(res.body, { error: "Forbidden thing" });
});

test("Postgres 22P02 invalid input becomes 400 Invalid id format", () => {
  const res = mockRes();
  const err = new Error("invalid input syntax for type uuid") as Error & { code?: string };
  err.code = "22P02";
  errorHandler(err, {} as never, res as never, noopNext);
  assert.equal(res.statusCode, 400);
  assert.deepEqual(res.body, { error: "Invalid id format" });
});

test("malformed JSON SyntaxError with status 400 becomes 400, not 500", () => {
  const res = mockRes();
  const err = new SyntaxError("Unexpected token 'n', \"not-a-file\" is not valid JSON") as SyntaxError & {
    status?: number;
    statusCode?: number;
    expose?: boolean;
  };
  err.status = 400;
  err.statusCode = 400;
  err.expose = true;
  errorHandler(err, {} as never, res as never, noopNext);
  assert.equal(res.statusCode, 400);
  assert.deepEqual(res.body, { error: "Invalid JSON in request body" });
});

test("over-limit body (statusCode 413) stays 413", () => {
  const res = mockRes();
  const err = new Error("request entity too large") as Error & { statusCode?: number };
  err.statusCode = 413;
  errorHandler(err, {} as never, res as never, noopNext);
  assert.equal(res.statusCode, 413);
  assert.deepEqual(res.body, { error: "Bad request" });
});

test("unknown errors stay 500 with a generic message (no leak)", () => {
  const res = mockRes();
  errorHandler(new Error("db password is hunter2"), {} as never, res as never, noopNext);
  assert.equal(res.statusCode, 500);
  assert.deepEqual(res.body, { error: "Internal server error" });
});
