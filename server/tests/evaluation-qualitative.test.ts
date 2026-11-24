import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";

// P0 — coding evaluation schema validation (evaluation.ts).
// No DB/Redis needed: the strict validator is exercised directly, and
// the live-review path is exercised against a local stub HTTP server
// (same pattern as tests/llm.test.ts). No external network, no real key.
// AI_MOCK=true is never used here: with mock forced, llmConfigured()
// is false and the live path is unreachable by design.
import {
  validateQualitativeReview,
  requestQualitativeReview,
  computeOverallScore,
  QUALITATIVE_SCHEMA_VERSION,
  QualitativeValidationError,
  QualitativeReviewError,
} from "../src/services/evaluation";
import { resetLlmRateLimit } from "../src/services/llm";

const VALID = {
  problemSolving: 80,
  understanding: 70,
  testing: 90,
  strengths: ["Clear structure"],
  weaknesses: ["Few edge-case tests"],
  improvements: ["Add edge-case tests"],
};

function setLiveEnv(opts: { timeoutMs?: number; maxAttempts?: number } = {}): void {
  process.env.AI_MOCK = "false";
  process.env.AI_API_BASE_URL = "";
  process.env.AI_API_KEY = "";
  process.env.AI_MODEL = "";
  process.env.AI_TIMEOUT_MS = String(opts.timeoutMs ?? 5000);
  process.env.AI_MAX_ATTEMPTS = String(opts.maxAttempts ?? 1);
  process.env.AI_RATE_LIMIT_PER_MIN = "1000";
  resetLlmRateLimit();
}

/** Start a stub LLM server. `handler` decides status/body/delay per call. */
async function startStub(
  handler: (req: http.IncomingMessage, res: http.ServerResponse) => void,
): Promise<{ server: http.Server; port: number }> {
  const server = http.createServer(handler);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const addr = server.address();
  const port = typeof addr === "object" && addr ? addr.port : 0;
  process.env.AI_MOCK = "false";
  process.env.AI_API_BASE_URL = `http://127.0.0.1:${port}`;
  process.env.AI_API_KEY = "test-key";
  process.env.AI_MODEL = "test-model";
  process.env.AI_TIMEOUT_MS = "5000";
  process.env.AI_MAX_ATTEMPTS = "1";
  process.env.AI_RATE_LIMIT_PER_MIN = "1000";
  resetLlmRateLimit();
  return { server, port };
}

function stubJson(content: unknown): (req: http.IncomingMessage, res: http.ServerResponse) => void {
  return (_req, res) => {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(
      JSON.stringify({
        choices: [
          {
            message: {
              content: typeof content === "string" ? content : JSON.stringify(content),
            },
          },
        ],
        usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
      }),
    );
  };
}

function baseInput(): Parameters<typeof requestQualitativeReview>[0] {
  return {
    challengeTitle: "Test challenge",
    acceptanceCriteria: ["does the thing"],
    functionalScore: 100,
    qualityScore: 100,
    qualityIssues: [],
    securityFindings: [],
    filesChanged: ["main.py"],
    monitoring: { testRuns: {}, compileErrors: 0, observations: [] },
  };
}

/** Expect requestQualitativeReview to throw a QualitativeReviewError with the given code. */
async function expectReviewError(
  promise: Promise<unknown>,
  code: string,
): Promise<QualitativeReviewError> {
  try {
    await promise;
  } catch (err) {
    assert.ok(
      err instanceof QualitativeReviewError,
      `expected QualitativeReviewError, got ${String(err)}`,
    );
    assert.equal(err.record.code, code);
    assert.equal(err.record.schemaVersion, QUALITATIVE_SCHEMA_VERSION);
    return err;
  }
  assert.fail(`expected QualitativeReviewError(${code}), but the call succeeded`);
}

// ── Validator: valid input ────────────────────────────────────────────────

test("validator: valid JSON passes, scores preserved exactly (incl. floats, 0, 100)", () => {
  const out = validateQualitativeReview({
    ...VALID,
    problemSolving: 82.5,
    understanding: 0,
    testing: 100,
  });
  assert.deepEqual(out, {
    problemSolving: 82.5,
    understanding: 0,
    testing: 100,
    strengths: ["Clear structure"],
    weaknesses: ["Few edge-case tests"],
    improvements: ["Add edge-case tests"],
  });
});

test("validator: non-score unknown keys are ignored (only score aliases are rejected)", () => {
  const out = validateQualitativeReview({ ...VALID, summary: "extra note" });
  assert.equal(out.problemSolving, 80);
});

// ── Validator: missing fields must FAIL, never become 0 ──────────────────

test("validator: missing problem-solving score fails", () => {
  const { problemSolving: _ps, ...rest } = VALID;
  assert.throws(
    () => validateQualitativeReview(rest),
    (err: unknown) =>
      err instanceof QualitativeValidationError &&
      err.missingFields.includes("problemSolving"),
  );
});

test("validator: missing technical-understanding score fails", () => {
  const { understanding: _u, ...rest } = VALID;
  assert.throws(
    () => validateQualitativeReview(rest),
    (err: unknown) =>
      err instanceof QualitativeValidationError &&
      err.missingFields.includes("understanding"),
  );
});

test("validator: missing testing score fails", () => {
  const { testing: _t, ...rest } = VALID;
  assert.throws(
    () => validateQualitativeReview(rest),
    (err: unknown) =>
      err instanceof QualitativeValidationError && err.missingFields.includes("testing"),
  );
});

test("validator: missing feedback arrays fail (strengths/weaknesses/improvements required)", () => {
  for (const field of ["strengths", "weaknesses", "improvements"] as const) {
    const copy = { ...VALID };
    delete (copy as Record<string, unknown>)[field];
    assert.throws(
      () => validateQualitativeReview(copy),
      (err: unknown) =>
        err instanceof QualitativeValidationError && err.missingFields.includes(field),
      `missing ${field} must fail`,
    );
  }
  const bad = { ...VALID, strengths: "good code" };
  assert.throws(
    () => validateQualitativeReview(bad),
    (err: unknown) =>
      err instanceof QualitativeValidationError &&
      err.invalidFields.some((i) => i.field === "strengths"),
  );
  const badItem = { ...VALID, weaknesses: ["real weakness", 42] };
  assert.throws(
    () => validateQualitativeReview(badItem),
    (err: unknown) =>
      err instanceof QualitativeValidationError &&
      err.invalidFields.some((i) => i.field === "weaknesses"),
  );
});

// ── Validator: wrong field names ──────────────────────────────────────────

test("validator: incorrect field names fail (snake_case / renamed scores are not read as values)", () => {
  const wrong = {
    problem_solving: 80,
    technicalUnderstanding: 70,
    testingScore: 90,
    strengths: ["s"],
    weaknesses: ["w"],
    improvements: ["i"],
  };
  assert.throws(
    () => validateQualitativeReview(wrong),
    (err: unknown) => {
      assert.ok(err instanceof QualitativeValidationError);
      assert.ok(err.missingFields.includes("problemSolving"));
      assert.ok(err.missingFields.includes("understanding"));
      assert.ok(err.missingFields.includes("testing"));
      assert.ok(err.unknownScoreFields.includes("problem_solving"));
      assert.ok(err.unknownScoreFields.includes("technicalUnderstanding"));
      assert.ok(err.unknownScoreFields.includes("testingScore"));
      return true;
    },
  );
});

test("validator: alias key present alongside the correct key still fails", () => {
  assert.throws(
    () => validateQualitativeReview({ ...VALID, problem_solving: 80 }),
    (err: unknown) =>
      err instanceof QualitativeValidationError &&
      err.unknownScoreFields.includes("problem_solving"),
  );
});

// ── Validator: wrong types / ranges ───────────────────────────────────────

test("validator: null score fails (never coerced to 0)", () => {
  assert.throws(
    () => validateQualitativeReview({ ...VALID, problemSolving: null }),
    (err: unknown) =>
      err instanceof QualitativeValidationError &&
      err.invalidFields.some(
        (i) => i.field === "problemSolving" && i.reason === "not_a_number",
      ),
  );
});

test("validator: string instead of numeric score fails", () => {
  assert.throws(
    () => validateQualitativeReview({ ...VALID, understanding: "80" }),
    (err: unknown) =>
      err instanceof QualitativeValidationError &&
      err.invalidFields.some(
        (i) => i.field === "understanding" && i.reason === "not_a_number",
      ),
  );
});

test("validator: negative score fails", () => {
  assert.throws(
    () => validateQualitativeReview({ ...VALID, testing: -5 }),
    (err: unknown) =>
      err instanceof QualitativeValidationError &&
      err.invalidFields.some(
        (i) => i.field === "testing" && i.reason === "out_of_range",
      ),
  );
});

test("validator: score >100 fails", () => {
  assert.throws(
    () => validateQualitativeReview({ ...VALID, problemSolving: 101 }),
    (err: unknown) =>
      err instanceof QualitativeValidationError &&
      err.invalidFields.some(
        (i) => i.field === "problemSolving" && i.reason === "out_of_range",
      ),
  );
});

test("validator: NaN / Infinity scores fail (not_finite)", () => {
  for (const v of [Number.NaN, Number.POSITIVE_INFINITY]) {
    assert.throws(
      () => validateQualitativeReview({ ...VALID, understanding: v }),
      (err: unknown) =>
        err instanceof QualitativeValidationError &&
        err.invalidFields.some(
          (i) => i.field === "understanding" && i.reason === "not_finite",
        ),
    );
  }
});

test("validator: non-object response fails", () => {
  for (const v of [null, "text", 42, [1, 2]]) {
    assert.throws(
      () => validateQualitativeReview(v),
      (err: unknown) => err instanceof QualitativeValidationError,
    );
  }
});

// ── Live path via stub server ─────────────────────────────────────────────

test("live: valid JSON from provider returns the review with provider/model metadata", async () => {
  const { server } = await startStub(stubJson(VALID));
  try {
    const res = await requestQualitativeReview(baseInput());
    assert.deepEqual(res.review, VALID);
    assert.equal(res.provider, "live");
    assert.equal(res.model, "test-model");
    assert.equal(typeof res.durationMs, "number");
  } finally {
    server.close();
    setLiveEnv();
  }
});

test("live: invalid JSON from provider fails as invalid_json (never a default review)", async () => {
  const { server } = await startStub(stubJson("this is not json {"));
  try {
    const err = await expectReviewError(
      requestQualitativeReview(baseInput()),
      "invalid_json",
    );
    assert.equal(err.record.provider, "live");
    assert.equal(err.record.model, "test-model");
  } finally {
    server.close();
    setLiveEnv();
  }
});

test("live: provider returning scores under wrong keys fails as schema_validation_failed", async () => {
  const wrong = {
    problem_solving: 80,
    technicalUnderstanding: 70,
    testingScore: 90,
    strengths: ["s"],
    weaknesses: ["w"],
    improvements: ["i"],
  };
  const { server } = await startStub(stubJson(wrong));
  try {
    const err = await expectReviewError(
      requestQualitativeReview(baseInput()),
      "schema_validation_failed",
    );
    assert.ok(err.record.missingFields.includes("problemSolving"));
    assert.ok(err.record.unknownScoreFields.includes("problem_solving"));
    // No score may leak through as a value.
    assert.equal(err.record.missingFields.includes("understanding"), true);
  } finally {
    server.close();
    setLiveEnv();
  }
});

test("live: provider returning a missing score fails as schema_validation_failed", async () => {
  const { testing: _t, ...partial } = VALID;
  const { server } = await startStub(stubJson(partial));
  try {
    const err = await expectReviewError(
      requestQualitativeReview(baseInput()),
      "schema_validation_failed",
    );
    assert.ok(err.record.missingFields.includes("testing"));
  } finally {
    server.close();
    setLiveEnv();
  }
});

test("live: AI timeout fails as timeout (no silent fallback)", async () => {
  // Stub that never responds; short per-attempt timeout, single attempt.
  const server = http.createServer((_req, _res) => {
    // Intentionally never respond.
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const addr = server.address();
  const port = typeof addr === "object" && addr ? addr.port : 0;
  process.env.AI_MOCK = "false";
  process.env.AI_API_BASE_URL = `http://127.0.0.1:${port}`;
  process.env.AI_API_KEY = "test-key";
  process.env.AI_MODEL = "test-model";
  process.env.AI_TIMEOUT_MS = "200";
  process.env.AI_MAX_ATTEMPTS = "1";
  process.env.AI_RATE_LIMIT_PER_MIN = "1000";
  resetLlmRateLimit();
  try {
    const err = await expectReviewError(requestQualitativeReview(baseInput()), "timeout");
    assert.equal(err.record.httpStatus, null);
    assert.ok(err.record.durationMs >= 150, `durationMs=${err.record.durationMs}`);
  } finally {
    server.close();
    setLiveEnv();
  }
});

test("live: AI service unavailable (HTTP 503) fails as provider_unavailable with status", async () => {
  const server = http.createServer((_req, res) => {
    res.writeHead(503, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: "service unavailable" }));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const addr = server.address();
  const port = typeof addr === "object" && addr ? addr.port : 0;
  process.env.AI_MOCK = "false";
  process.env.AI_API_BASE_URL = `http://127.0.0.1:${port}`;
  process.env.AI_API_KEY = "test-key";
  process.env.AI_MODEL = "test-model";
  process.env.AI_TIMEOUT_MS = "5000";
  process.env.AI_MAX_ATTEMPTS = "1";
  process.env.AI_RATE_LIMIT_PER_MIN = "1000";
  resetLlmRateLimit();
  try {
    const err = await expectReviewError(
      requestQualitativeReview(baseInput()),
      "provider_unavailable",
    );
    assert.equal(err.record.httpStatus, 503);
  } finally {
    server.close();
    setLiveEnv();
  }
});

test("live: AI auth failure (HTTP 401) fails as authentication_failed, not as a timeout", async () => {
  const server = http.createServer((_req, res) => {
    res.writeHead(401, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: "bad key" }));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const addr = server.address();
  const port = typeof addr === "object" && addr ? addr.port : 0;
  process.env.AI_MOCK = "false";
  process.env.AI_API_BASE_URL = `http://127.0.0.1:${port}`;
  process.env.AI_API_KEY = "test-key";
  process.env.AI_MODEL = "test-model";
  process.env.AI_TIMEOUT_MS = "5000";
  process.env.AI_MAX_ATTEMPTS = "1";
  process.env.AI_RATE_LIMIT_PER_MIN = "1000";
  resetLlmRateLimit();
  try {
    const err = await expectReviewError(
      requestQualitativeReview(baseInput()),
      "authentication_failed",
    );
    assert.equal(err.record.httpStatus, 401);
  } finally {
    server.close();
    setLiveEnv();
  }
});

// ── Overall score: failed qualitative never reads as 0 ────────────────────

test("overall: all dimensions present → fixed-weight sum", () => {
  const { overall, basis } = computeOverallScore({
    functional: 100,
    quality: 100,
    problemSolving: 80,
    understanding: 70,
    testing: 90,
  });
  assert.equal(basis, "all-dimensions");
  assert.equal(overall, 30 + 20 + 16 + 10.5 + 13.5); // 90
});

test("overall: failed qualitative → verified dimensions only, renormalised (never 0-filled)", () => {
  const { overall, basis } = computeOverallScore({
    functional: 100,
    quality: 100,
    problemSolving: null,
    understanding: null,
    testing: null,
  });
  assert.equal(basis, "verified-dimensions-only");
  assert.equal(overall, 100); // (100*0.3 + 100*0.2) / 0.5 — NOT dragged down by 0s
  const partial = computeOverallScore({
    functional: 80,
    quality: 60,
    problemSolving: null,
    understanding: null,
    testing: null,
  });
  assert.equal(partial.basis, "verified-dimensions-only");
  assert.equal(partial.overall, 72); // (80*0.3 + 60*0.2) / 0.5
  // If the failed categories had been counted as 0, this would be 36.
  assert.notEqual(partial.overall, 36);
});
