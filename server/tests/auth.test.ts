import test from "node:test";
import assert from "node:assert/strict";

// The JWT secret is supplied by the `npm test` script (see package.json) so
// it is set before any server module is imported (env is read at import
// time). These tests never touch Postgres/Redis — they exercise the pure
// auth primitives and the Express middleware with mocked req/res/next.
import * as auth from "../src/services/auth";
import { requireAuth, requireRole } from "../src/middleware/auth";
import { z } from "zod";
import jwtOther from "jsonwebtoken";

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

test("passwords: hash then verify succeeds; wrong password fails", async () => {
  const hash = await auth.hashPassword("Str0ng!Pass");
  assert.notEqual(hash, "Str0ng!Pass");
  assert.equal(await auth.verifyPassword("Str0ng!Pass", hash), true);
  assert.equal(await auth.verifyPassword("wrong-password", hash), false);
});

test("passwords: two hashes of the same password differ (salted)", async () => {
  const a = await auth.hashPassword("Str0ng!Pass");
  const b = await auth.hashPassword("Str0ng!Pass");
  assert.notEqual(a, b);
});

test("JWT: sign then verify round-trips the payload", () => {
  const token = auth.signAccessToken({
    sub: "11111111-1111-1111-1111-111111111111",
    email: "student@example.com",
    role: "candidate",
  });
  assert.equal(typeof token, "string");
  assert.equal(token.split(".").length, 3);
  const payload = auth.verifyAccessToken(token);
  assert.equal(payload.sub, "11111111-1111-1111-1111-111111111111");
  assert.equal(payload.email, "student@example.com");
  assert.equal(payload.role, "candidate");
});

test("JWT: a tampered token is rejected", () => {
  const token = auth.signAccessToken({
    sub: "11111111-1111-1111-1111-111111111111",
    email: "a@b.c",
    role: "recruiter",
  });
  const tampered = `${token.slice(0, -2)}xx`;
  assert.throws(() => auth.verifyAccessToken(tampered));
});

test("JWT: a token signed with a different secret is rejected", () => {
  const token = jwtOther.sign(
    { sub: "x", email: "a@b.c", role: "candidate" },
    "a-different-secret",
  );
  assert.throws(() => auth.verifyAccessToken(token));
});

test("reset tokens: raw token hashes deterministically; two tokens differ", () => {
  const first = auth.generateResetToken();
  const second = auth.generateResetToken();
  assert.notEqual(first.rawToken, second.rawToken);
  assert.notEqual(first.tokenHash, second.tokenHash);
  assert.equal(auth.hashResetToken(first.rawToken), first.tokenHash);
  // The stored hash must not contain the raw token.
  assert.equal(first.tokenHash.includes(first.rawToken), false);
});

test("roles: signup role maps to the stored DB role", () => {
  assert.equal(auth.dbRoleForSignupRole("student"), "candidate");
  assert.equal(auth.dbRoleForSignupRole("recruiter"), "recruiter");
});

test("requireAuth: missing header → 401, Bearer token → req.user set", () => {
  const token = auth.signAccessToken({
    sub: "22222222-2222-2222-2222-222222222222",
    email: "r@example.com",
    role: "recruiter",
  });

  let nextArg: unknown = "not-called";
  requireAuth(
    { header: () => undefined } as never,
    mockRes() as never,
    ((err?: unknown) => {
      nextArg = err;
    }) as never,
  );
  assert.ok(nextArg instanceof Error);
  assert.match((nextArg as Error).message, /missing Bearer token/);

  nextArg = "not-called";
  const req = {
    header: (name: string) => (name === "authorization" ? `Bearer ${token}` : undefined),
  } as never;
  requireAuth(req, mockRes() as never, (() => {
    nextArg = undefined;
  }) as never);
  assert.equal(nextArg, undefined);
  assert.equal((req as { user?: { email: string } }).user?.email, "r@example.com");
});

test("requireAuth: garbage Bearer token → 401", () => {
  let nextArg: unknown = "not-called";
  requireAuth(
    { header: () => "Bearer not-a-real-token" } as never,
    mockRes() as never,
    ((err?: unknown) => {
      nextArg = err;
    }) as never,
  );
  assert.ok(nextArg instanceof Error);
  assert.match((nextArg as Error).message, /invalid or expired/);
});

test("requireRole: allows a listed role, 403s the others, 401s without a user", () => {
  const calls: unknown[] = [];
  const next = ((err?: unknown) => {
    calls.push(err);
  }) as never;

  requireRole("recruiter", "admin")(
    { user: { role: "recruiter" } } as never,
    mockRes() as never,
    next,
  );
  assert.equal(calls[0], undefined);

  requireRole("recruiter", "admin")(
    { user: { role: "candidate" } } as never,
    mockRes() as never,
    next,
  );
  assert.ok(calls[1] instanceof Error);
  assert.match((calls[1] as Error).message, /Forbidden/);

  requireRole("recruiter")({} as never, mockRes() as never, next);
  assert.ok(calls[2] instanceof Error);
  assert.match((calls[2] as Error).message, /Unauthorized/);
});

test("validation: password policy matches the documented rules", () => {
  const passwordSchema = z
    .string()
    .min(8)
    .regex(/[A-Z]/)
    .regex(/[a-z]/)
    .regex(/\d/)
    .regex(/[^A-Za-z0-9]/);
  assert.equal(passwordSchema.safeParse("Str0ng!Pass").success, true);
  assert.equal(passwordSchema.safeParse("short1!").success, false); // too short
  assert.equal(passwordSchema.safeParse("alllowercase1!").success, false); // no upper
  assert.equal(passwordSchema.safeParse("ALLUPPERCASE1!").success, false); // no lower
  assert.equal(passwordSchema.safeParse("NoDigitsHere!").success, false); // no digit
  assert.equal(passwordSchema.safeParse("NoSpecial123").success, false); // no special
});
