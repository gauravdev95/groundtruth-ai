import { env } from "../config/env";
import { ApiError } from "../middleware/errorHandler";

/**
 * Centralized OpenAI-compatible chat completions client.
 *
 * - Configuration comes only from the environment (see config/env.ts):
 *   AI_API_BASE_URL, AI_API_KEY, AI_MODEL (no hardcoded model name),
 *   AI_TEMPERATURE (default 0.2), AI_MAX_TOKENS (default 2000),
 *   AI_MOCK ("true" forces the mock provider), AI_RATE_LIMIT_PER_MIN
 *   (default 30 req/min), AI_TIMEOUT_MS (default 120000),
 *   AI_MAX_ATTEMPTS (default 3, clamped 1–5).
 * - When AI_MOCK=true OR the provider is not fully configured, every call
 *   goes to the deterministic mock provider: no network, no key, no live
 *   model. Mock responses carry `provider: "mock"` and `model: "mock"` so
 *   they can never be mistaken for live AI output.
 * - Secrets and prompt/response content are NEVER logged. Only the model
 *   name, token counts and cost estimate are logged.
 * - Live calls retry (max AI_MAX_ATTEMPTS attempts, exponential backoff
 *   with jitter) on 429/5xx and transient network errors only, and are
 *   bounded by a 120s default timeout per attempt (AbortController).
 *   Worst case for one call is therefore bounded:
 *   attempts × timeout + backoff ≈ 3 × 120s + ~2.5s ≈ 362.5s
 *   (see llmWorstCaseBoundMs). A timeout is labelled as a timeout
 *   (ApiError 502, "timed out"); 401/403 surface as auth errors with
 *   their own status, never as a timeout or a generic 502.
 */

export interface LlmUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
}

export interface ChatCompletionResult {
  text: string;
  model: string;
  /** "live" for a real provider call, "mock" for the mock provider. */
  provider: "live" | "mock";
  usage: LlmUsage;
  /** USD estimate, or null when the model has no known price. */
  costUsdEstimate: number | null;
}

export interface ChatCompletionOptions {
  system: string;
  user: string;
  jsonMode?: boolean;
  maxTokens?: number;
  temperature?: number;
  /** Operation label for the usage log (e.g. "interview-question-refine").
   *  Never a prompt, response, or identifier — just the call site. */
  operation?: string;
}

export interface LlmUsageLogEntry {
  at: string;
  model: string;
  promptTokens: number;
  completionTokens: number;
  costUsdEstimate: number | null;
  /** Call-site label (see ChatCompletionOptions.operation). */
  operation: string;
  /** Wall-clock duration of the call in ms (0 for the mock provider). */
  durationMs: number;
  /** False when the call ended in an error (timeout / auth / provider). */
  success: boolean;
  /** Attempts beyond the first that were made (0 = succeeded first try). */
  retryCount: number;
}

/** Price per 1M tokens { input, output } in USD. Unknown models → null. */
const MODEL_PRICES: Record<string, { input: number; output: number }> = {
  "gpt-4o": { input: 2.5, output: 10 },
  "gpt-4o-mini": { input: 0.15, output: 0.6 },
  "gpt-4.1": { input: 2, output: 8 },
  "gpt-4.1-mini": { input: 0.4, output: 1.6 },
  "gpt-4.1-nano": { input: 0.1, output: 0.4 },
  "gpt-4-turbo": { input: 10, output: 30 },
  "gpt-3.5-turbo": { input: 0.5, output: 1.5 },
  "o4-mini": { input: 1.1, output: 4.4 },
};

export const LLM_MAX_ATTEMPTS_DEFAULT = 3;
export const LLM_MAX_ATTEMPTS_MIN = 1;
export const LLM_MAX_ATTEMPTS_MAX = 5;
export const LLM_RETRY_BASE_DELAY_MS = 500;
/** Max random jitter added to one backoff step (ms). */
export const LLM_RETRY_JITTER_MS = 500;
/** Default per-attempt timeout (ms). Live E2E proved genuine calls take
 *  30–60 s on this VM's egress (headers alone ~4–5 s), so the old 30 s
 *  default aborted real calls; 120 s is the proven working value. */
export const LLM_TIMEOUT_MS_DEFAULT = 120000;

/** Worst-case wall time (ms) for one live call: every attempt may run to
 *  the per-attempt timeout, plus the (jittered) backoff between attempts.
 *  With defaults: 3 × 120000 + (500+500) + (1000+500) = 362500 ms. */
export function llmWorstCaseBoundMs(
  timeoutMs: number = LLM_TIMEOUT_MS_DEFAULT,
  maxAttempts: number = LLM_MAX_ATTEMPTS_DEFAULT,
): number {
  let backoff = 0;
  for (let attempt = 1; attempt < maxAttempts; attempt++) {
    backoff += LLM_RETRY_BASE_DELAY_MS * 2 ** (attempt - 1) + LLM_RETRY_JITTER_MS;
  }
  return maxAttempts * timeoutMs + backoff;
}

/** One backoff step (ms): exponential base delay plus uniform jitter in
 *  [0, LLM_RETRY_JITTER_MS]. Jitter spreads retries so concurrent
 *  callers do not hammer the provider in lockstep. */
export function retryBackoffDelayMs(attempt: number): number {
  return (
    LLM_RETRY_BASE_DELAY_MS * 2 ** (attempt - 1) +
    Math.random() * LLM_RETRY_JITTER_MS
  );
}

const USAGE_LOG_CAP = 200;

const usageLog: LlmUsageLogEntry[] = [];
/** Timestamps (ms) of recent requests, for the token-bucket rate limit. */
let requestTimestamps: number[] = [];

interface LlmConfig {
  baseUrl: string;
  apiKey: string;
  model: string;
  temperature: number;
  maxTokens: number;
  mock: boolean;
  rateLimitPerMin: number;
  timeoutMs: number;
  maxAttempts: number;
}

/** Effective LLM retry/timeout config (env-controlled, bounded).
 *  Exposed for tests and for the timeout documentation — call sites must
 *  never hardcode a timeout or attempt count of their own. */
export function getLlmConfig(): {
  timeoutMs: number;
  maxAttempts: number;
  retryBaseDelayMs: number;
  worstCaseMs: number;
} {
  const c = getConfig();
  return {
    timeoutMs: c.timeoutMs,
    maxAttempts: c.maxAttempts,
    retryBaseDelayMs: LLM_RETRY_BASE_DELAY_MS,
    worstCaseMs: llmWorstCaseBoundMs(c.timeoutMs, c.maxAttempts),
  };
}

/** Configured model id, read live from the environment (the config/env.ts
 *  snapshot is import-time, so callers that need the current value —
 *  e.g. the generationModel recorded on interview questions — must use
 *  this, not env.aiModel). Empty string when no model is configured. */
export function getLlmModel(): string {
  return getConfig().model;
}

function numOr(value: string | undefined, fallback: number): number {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

/**
 * Read config live from process.env on every call (falling back to the
 * values snapshotted in config/env.ts at import). This keeps the client
 * testable — tests can set env vars after import — and means a rotated
 * key picked up by restarting the process is honoured.
 */
function getConfig(): LlmConfig {
  return {
    baseUrl: (process.env.AI_API_BASE_URL ?? env.aiApiBaseUrl).replace(/\/+$/, ""),
    apiKey: process.env.AI_API_KEY ?? env.aiApiKey,
    model: process.env.AI_MODEL ?? env.aiModel,
    temperature: numOr(process.env.AI_TEMPERATURE, env.aiTemperature || 0.2),
    maxTokens: Math.floor(numOr(process.env.AI_MAX_TOKENS, env.aiMaxTokens || 2000)),
    mock:
      (process.env.AI_MOCK ?? (env.aiMock ? "true" : "false")).toLowerCase() ===
      "true",
    rateLimitPerMin: Math.floor(
      numOr(process.env.AI_RATE_LIMIT_PER_MIN, env.aiRateLimitPerMin || 30),
    ),
    timeoutMs: Math.floor(
      numOr(process.env.AI_TIMEOUT_MS, env.aiTimeoutMs || LLM_TIMEOUT_MS_DEFAULT),
    ),
    maxAttempts: Math.min(
      LLM_MAX_ATTEMPTS_MAX,
      Math.max(
        LLM_MAX_ATTEMPTS_MIN,
        Math.floor(numOr(process.env.AI_MAX_ATTEMPTS, env.aiMaxAttempts || LLM_MAX_ATTEMPTS_DEFAULT)),
      ),
    ),
  };
}

/** True only if base URL + key + model are all set and mock is not forced. */
export function llmConfigured(): boolean {
  const c = getConfig();
  return Boolean(c.baseUrl && c.apiKey && c.model && !c.mock);
}

function priceForModel(model: string): { input: number; output: number } | null {
  // Exact match first, then longest-prefix match so versioned model ids
  // (e.g. "gpt-4o-mini-2024-07-18") still price correctly.
  if (MODEL_PRICES[model]) return MODEL_PRICES[model] as { input: number; output: number };
  let best: { input: number; output: number } | null = null;
  let bestLen = 0;
  for (const [key, price] of Object.entries(MODEL_PRICES)) {
    if (model.startsWith(key) && key.length > bestLen) {
      best = price;
      bestLen = key.length;
    }
  }
  return best;
}

export function estimateCostUsd(
  model: string,
  usage: LlmUsage,
): number | null {
  const price = priceForModel(model);
  if (!price) return null;
  const cost =
    (usage.promptTokens / 1_000_000) * price.input +
    (usage.completionTokens / 1_000_000) * price.output;
  return Math.round(cost * 1_000_000) / 1_000_000;
}

export interface LlmUsageMeta {
  operation?: string;
  durationMs?: number;
  success?: boolean;
  retryCount?: number;
}

function logUsage(
  model: string,
  usage: LlmUsage,
  cost: number | null,
  meta: LlmUsageMeta = {},
): void {
  // NEVER log prompt/response content, API keys, or PII — model + tokens
  // + operation/duration/success/retry-count only.
  const operation = meta.operation ?? "chat";
  const durationMs = meta.durationMs ?? 0;
  const success = meta.success ?? true;
  const retryCount = meta.retryCount ?? 0;
  console.log(
    `[llm] operation=${operation} model=${model} promptTokens=${usage.promptTokens} ` +
      `completionTokens=${usage.completionTokens} totalTokens=${usage.totalTokens} ` +
      `costUsdEstimate=${cost === null ? "unknown" : cost.toFixed(6)} ` +
      `durationMs=${durationMs} success=${success} retryCount=${retryCount}`,
  );
  usageLog.push({
    at: new Date().toISOString(),
    model,
    promptTokens: usage.promptTokens,
    completionTokens: usage.completionTokens,
    costUsdEstimate: cost,
    operation,
    durationMs,
    success,
    retryCount,
  });
  if (usageLog.length > USAGE_LOG_CAP) usageLog.splice(0, usageLog.length - USAGE_LOG_CAP);
}

export function getLlmUsageLog(): LlmUsageLogEntry[] {
  return [...usageLog];
}

/** Test/support helper: clear the in-memory usage log. */
export function clearLlmUsageLog(): void {
  usageLog.length = 0;
}

/** Test/support helper: reset the in-memory rate limiter. */
export function resetLlmRateLimit(): void {
  requestTimestamps = [];
}

function checkRateLimit(cfg: LlmConfig): void {
  const now = Date.now();
  requestTimestamps = requestTimestamps.filter((t) => now - t < 60_000);
  if (requestTimestamps.length >= cfg.rateLimitPerMin) {
    throw new ApiError(
      429,
      `LLM rate limit exceeded: max ${cfg.rateLimitPerMin} requests per minute`,
    );
  }
  requestTimestamps.push(now);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Deterministic mock response. Derived from the prompt only in that it
 * echoes the prompt length and — in JSON mode — returns a fixed structured
 * stub with the fields downstream validators expect (summary,
 * recommendations, answer). Nothing here is presented as live AI output.
 */
function mockCompletion(opts: ChatCompletionOptions): ChatCompletionResult {
  const usage: LlmUsage = { promptTokens: 0, completionTokens: 0, totalTokens: 0 };
  const text = opts.jsonMode
    ? JSON.stringify({
        provider: "mock",
        summary:
          "Mock AI summary (mock provider — no live model call was made).",
        recommendations: [
          {
            id: "mock-1",
            title: "Mock recommendation",
            why: "This is mock data: the LLM is not configured, so no real analysis was performed.",
            action: "Configure AI_API_BASE_URL, AI_API_KEY and AI_MODEL to get real recommendations.",
            points: 5,
          },
        ],
        answer: "Mock answer (mock provider — no live model call was made).",
        promptChars: opts.user.length,
      })
    : "Mock AI response (mock provider — no live model call was made).";
  logUsage("mock", usage, 0, {
    operation: opts.operation ?? "chat",
    durationMs: 0,
    success: true,
    retryCount: 0,
  });
  return { text, model: "mock", provider: "mock", usage, costUsdEstimate: 0 };
}

interface ProviderResponse {
  choices?: Array<{ message?: { content?: string | null } }>;
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
  };
}

async function liveCompletion(
  cfg: LlmConfig,
  opts: ChatCompletionOptions,
): Promise<ChatCompletionResult> {
  const body: Record<string, unknown> = {
    model: cfg.model,
    messages: [
      { role: "system", content: opts.system },
      { role: "user", content: opts.user },
    ],
    temperature: opts.temperature ?? cfg.temperature,
    max_tokens: opts.maxTokens ?? cfg.maxTokens,
  };
  if (opts.jsonMode) body.response_format = { type: "json_object" };

  const startedAt = Date.now();
  const operation = opts.operation ?? "chat";
  const zeroUsage: LlmUsage = { promptTokens: 0, completionTokens: 0, totalTokens: 0 };
  let failureLogged = false;
  const logFailureOnce = (retryCount: number): void => {
    if (failureLogged) return;
    failureLogged = true;
    logUsage(cfg.model, zeroUsage, null, {
      operation,
      durationMs: Date.now() - startedAt,
      success: false,
      retryCount,
    });
  };

  let lastError: Error | null = null;
  for (let attempt = 1; attempt <= cfg.maxAttempts; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), cfg.timeoutMs);
    try {
      const res = await fetch(`${cfg.baseUrl}/chat/completions`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${cfg.apiKey}`,
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      if (!res.ok) {
        // Auth failures are NOT timeouts and are NOT retryable: surface
        // them with their own status so callers never mistake a bad key
        // for a slow network.
        if (res.status === 401 || res.status === 403) {
          logFailureOnce(attempt - 1);
          throw new ApiError(
            res.status,
            `LLM authentication failed: HTTP ${res.status} — check AI_API_KEY / AI_MODEL`,
          );
        }
        const retryable = res.status === 429 || res.status >= 500;
        if (retryable && attempt < cfg.maxAttempts) {
          lastError = new Error(`LLM provider returned ${res.status}`);
          await sleep(retryBackoffDelayMs(attempt));
          continue;
        }
        logFailureOnce(attempt - 1);
        throw new ApiError(
          502,
          `LLM provider error: HTTP ${res.status}`,
        );
      }
      const data = (await res.json()) as ProviderResponse;
      const text = data.choices?.[0]?.message?.content ?? "";
      if (typeof text !== "string" || !text) {
        logFailureOnce(attempt - 1);
        throw new ApiError(502, "LLM provider returned an empty response");
      }
      const usage: LlmUsage = {
        promptTokens: data.usage?.prompt_tokens ?? 0,
        completionTokens: data.usage?.completion_tokens ?? 0,
        totalTokens:
          data.usage?.total_tokens ??
          (data.usage?.prompt_tokens ?? 0) + (data.usage?.completion_tokens ?? 0),
      };
      const cost = estimateCostUsd(cfg.model, usage);
      logUsage(cfg.model, usage, cost, {
        operation,
        durationMs: Date.now() - startedAt,
        success: true,
        retryCount: attempt - 1,
      });
      return { text, model: cfg.model, provider: "live", usage, costUsdEstimate: cost };
    } catch (err) {
      if (err instanceof ApiError) throw err;
      const isAbort =
        err instanceof Error && (err.name === "AbortError" || err.name === "TimeoutError");
      if (isAbort) {
        // Labelled as a timeout, with the per-attempt budget that fired —
        // never confused with an auth failure. Timeouts are not retried:
        // a call that cannot finish in AI_TIMEOUT_MS is re-attempted
        // only by the caller, if at all.
        logFailureOnce(attempt - 1);
        throw new ApiError(
          502,
          `LLM request timed out after ${cfg.timeoutMs}ms (attempt ${attempt}/${cfg.maxAttempts})`,
        );
      }
      // Network errors are retryable (transient), up to maxAttempts.
      if (attempt < cfg.maxAttempts) {
        lastError = err instanceof Error ? err : new Error(String(err));
        await sleep(retryBackoffDelayMs(attempt));
        continue;
      }
      logFailureOnce(cfg.maxAttempts - 1);
      throw new ApiError(
        502,
        `LLM request failed: ${lastError?.message ?? "unknown error"}`,
      );
    } finally {
      clearTimeout(timer);
    }
  }
  logFailureOnce(cfg.maxAttempts - 1);
  throw new ApiError(502, `LLM request failed: ${lastError?.message ?? "unknown error"}`);
}

export async function chatCompletion(
  opts: ChatCompletionOptions,
): Promise<ChatCompletionResult> {
  const cfg = getConfig();
  checkRateLimit(cfg);
  if (cfg.mock || !llmConfigured()) return mockCompletion(opts);
  return liveCompletion(cfg, opts);
}

/** Strip ```json / ``` fences so fenced model output still parses. */
export function stripJsonFences(text: string): string {
  const trimmed = text.trim();
  const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  return fenced ? (fenced[1] as string).trim() : trimmed;
}

/**
 * Ask for JSON and validate it with the caller's validator. Throws
 * ApiError(502) on invalid JSON or a failed validation — never returns
 * unvalidated data. A validator may attach structured diagnostics to its
 * error as `.failure` (see interview.ts); those are carried on the
 * ApiError as `.details` so callers can log the reason (missing/extra
 * fields, error codes) without the question/response content.
 */
export async function chatJson<T>(
  opts: ChatCompletionOptions,
  validate: (u: unknown) => T,
): Promise<T> {
  const result = await chatCompletion({ ...opts, jsonMode: true });
  let parsed: unknown;
  try {
    parsed = JSON.parse(stripJsonFences(result.text));
  } catch {
    const err = new ApiError(502, "LLM returned invalid JSON");
    (err as unknown as { details?: unknown }).details = { kind: "invalid_json" };
    throw err;
  }
  try {
    return validate(parsed);
  } catch (e) {
    const err = new ApiError(502, "LLM response failed schema validation");
    const failure = (e as { failure?: unknown } | null)?.failure;
    if (failure !== undefined) {
      (err as unknown as { details?: unknown }).details = failure;
    }
    throw err;
  }
}
