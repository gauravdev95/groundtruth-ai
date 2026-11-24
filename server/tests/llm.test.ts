import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";

// LLM client tests — no DB/Redis needed. The mock provider is exercised
// directly; the live path is exercised against a local stub HTTP server
// (no external network, no real key).
import {
  chatCompletion,
  chatJson,
  llmConfigured,
  getLlmUsageLog,
  clearLlmUsageLog,
  resetLlmRateLimit,
  estimateCostUsd,
} from "../src/services/llm";
import { ApiError } from "../src/middleware/errorHandler";

function setMockEnv(rateLimit = "1000"): void {
  process.env.AI_MOCK = "true";
  process.env.AI_API_BASE_URL = "";
  process.env.AI_API_KEY = "";
  process.env.AI_MODEL = "";
  process.env.AI_RATE_LIMIT_PER_MIN = rateLimit;
  resetLlmRateLimit();
  clearLlmUsageLog();
}

test("llmConfigured: false when mock forced or when any of base/key/model missing", () => {
  setMockEnv();
  assert.equal(llmConfigured(), false);
  process.env.AI_MOCK = "false";
  process.env.AI_API_BASE_URL = "https://example.invalid/v1";
  process.env.AI_API_KEY = "k";
  process.env.AI_MODEL = "";
  assert.equal(llmConfigured(), false);
  process.env.AI_MODEL = "gpt-4o-mini";
  assert.equal(llmConfigured(), true);
  setMockEnv();
});

test("mock provider: deterministic, marked mock, zero usage, zero cost", async () => {
  setMockEnv();
  const a = await chatCompletion({ system: "s", user: "hello" });
  const b = await chatCompletion({ system: "s", user: "hello" });
  assert.equal(a.provider, "mock");
  assert.equal(a.model, "mock");
  assert.equal(a.text, b.text, "same input must give the same mock output");
  assert.deepEqual(a.usage, { promptTokens: 0, completionTokens: 0, totalTokens: 0 });
  assert.equal(a.costUsdEstimate, 0);
  assert.match(a.text, /mock/i);
});

test("mock provider: jsonMode returns parseable JSON with provider mock", async () => {
  setMockEnv();
  const r = await chatCompletion({ system: "s", user: "u", jsonMode: true });
  const parsed = JSON.parse(r.text) as Record<string, unknown>;
  assert.equal(parsed.provider, "mock");
  assert.equal(typeof parsed.summary, "string");
});

test("usage log records mock calls (model + tokens, no content)", async () => {
  setMockEnv();
  await chatCompletion({ system: "s", user: "secret-prompt-content" });
  const log = getLlmUsageLog();
  assert.equal(log.length, 1);
  assert.equal(log[0]?.model, "mock");
  assert.equal(log[0]?.promptTokens, 0);
  assert.equal(typeof log[0]?.at, "string");
  // No prompt/response content may leak into the log.
  assert.equal(JSON.stringify(log).includes("secret-prompt-content"), false);
});

test("cost estimation: known model priced, unknown model returns null", () => {
  const cost = estimateCostUsd("gpt-4o-mini", {
    promptTokens: 1_000_000,
    completionTokens: 1_000_000,
    totalTokens: 2_000_000,
  });
  assert.equal(cost, 0.75); // 0.15 + 0.60
  assert.equal(
    estimateCostUsd("some-model-that-does-not-exist", {
      promptTokens: 100,
      completionTokens: 100,
      totalTokens: 200,
    }),
    null,
  );
});

test("chatJson: invalid JSON from provider throws ApiError 502", async () => {
  // Local stub server returning non-JSON content for a live call.
  const server = http.createServer((_req, res) => {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ choices: [{ message: { content: "this is not json {" } }], usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } }));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const addr = server.address();
  const port = typeof addr === "object" && addr ? addr.port : 0;
  process.env.AI_MOCK = "false";
  process.env.AI_API_BASE_URL = `http://127.0.0.1:${port}`;
  process.env.AI_API_KEY = "test-key";
  process.env.AI_MODEL = "test-model";
  process.env.AI_RATE_LIMIT_PER_MIN = "1000";
  resetLlmRateLimit();
  try {
    await assert.rejects(
      chatJson({ system: "s", user: "u" }, (u) => u as { ok: boolean }),
      (err: unknown) => err instanceof ApiError && err.status === 502,
    );
  } finally {
    server.close();
    setMockEnv();
  }
});

test("chatJson: schema validation failure throws ApiError 502", async () => {
  const server = http.createServer((_req, res) => {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ wrong: "shape" }) } }], usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } }));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const addr = server.address();
  const port = typeof addr === "object" && addr ? addr.port : 0;
  process.env.AI_MOCK = "false";
  process.env.AI_API_BASE_URL = `http://127.0.0.1:${port}`;
  process.env.AI_API_KEY = "test-key";
  process.env.AI_MODEL = "test-model";
  process.env.AI_RATE_LIMIT_PER_MIN = "1000";
  resetLlmRateLimit();
  try {
    await assert.rejects(
      chatJson({ system: "s", user: "u" }, (u) => {
        if (typeof u !== "object" || u === null || !("requiredField" in (u as Record<string, unknown>))) {
          throw new Error("missing requiredField");
        }
        return u as { requiredField: string };
      }),
      (err: unknown) => err instanceof ApiError && err.status === 502,
    );
  } finally {
    server.close();
    setMockEnv();
  }
});

test("live path: retries on 500 then succeeds", async () => {
  let calls = 0;
  const server = http.createServer((_req, res) => {
    calls++;
    if (calls === 1) {
      res.writeHead(500, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: "boom" }));
      return;
    }
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({
      choices: [{ message: { content: "live answer" } }],
      usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
    }));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const addr = server.address();
  const port = typeof addr === "object" && addr ? addr.port : 0;
  process.env.AI_MOCK = "false";
  process.env.AI_API_BASE_URL = `http://127.0.0.1:${port}`;
  process.env.AI_API_KEY = "test-key";
  process.env.AI_MODEL = "gpt-4o-mini";
  process.env.AI_RATE_LIMIT_PER_MIN = "1000";
  resetLlmRateLimit();
  try {
    const r = await chatCompletion({ system: "s", user: "u" });
    assert.equal(calls, 2, "first 500 retried, second attempt succeeded");
    assert.equal(r.provider, "live");
    assert.equal(r.text, "live answer");
    assert.equal(r.model, "gpt-4o-mini");
    assert.deepEqual(r.usage, { promptTokens: 10, completionTokens: 5, totalTokens: 15 });
    assert.notEqual(r.costUsdEstimate, null);
  } finally {
    server.close();
    setMockEnv();
  }
});

test("rate limit: 4th request in a minute at limit 3 throws ApiError 429", async () => {
  setMockEnv("3");
  await chatCompletion({ system: "s", user: "1" });
  await chatCompletion({ system: "s", user: "2" });
  await chatCompletion({ system: "s", user: "3" });
  await assert.rejects(
    chatCompletion({ system: "s", user: "4" }),
    (err: unknown) => err instanceof ApiError && err.status === 429,
  );
  setMockEnv();
});
