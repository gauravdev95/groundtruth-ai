# GroundTruth AI — environment variable reference

**Date:** 23 November 2026 (ultimate mission, Phase 19).
**Rule:** every secret comes from the environment. Nothing is hardcoded,
nothing is committed. The agent can never see key text — Gaurav pastes
keys himself in the Render dashboard. Presence/format review only, never
values. Local defaults are in `server/src/config/env.ts`.

## Server (`groundtruth-ai-server`)

| Variable | Required? | Notes |
|---|---|---|
| `DATABASE_URL` | Yes | Render Postgres internal URL. |
| `REDIS_URL` | Yes | Render Redis internal URL. Without it `/health` is 503 and all queues fail. |
| `JWT_SECRET` | Yes | `openssl rand -hex 32`. Server refuses to sign tokens without it. Never reuse the local test secret. |
| `JWT_EXPIRES_IN` | No (default `1d`) | Token lifetime. |
| `FRONTEND_URL` | Yes | Client origin — CORS allowlist + password-reset links. Production: `https://groundtruth-ai-client.onrender.com`. |
| `AI_SERVICE_URL` | Once ai-service exists | e.g. `https://<groundtruth-ai-service>.onrender.com`. Unset → server logs ai-service unreachable; jobs still work. |
| `AI_API_BASE_URL` | With `AI_API_KEY` | OpenAI-compatible base, e.g. `https://api.openai.com/v1`. |
| `AI_API_KEY` | For live AI | Gaurav pastes it. Without it the server honestly runs the mock provider (`aiAvailable:false`). |
| `AI_MODEL` | With the key | e.g. `gpt-4o-mini`. No model name is hardcoded. |
| `AI_MOCK` | No | `true` forces the deterministic mock provider (local dev). Omit/false in production. |
| `AI_SERVICE_TIMEOUT_MS` | No (30000) | Server → ai-service call timeout. |
| `AI_TIMEOUT_MS` / `AI_TEMPERATURE` / `AI_MAX_TOKENS` / `AI_RATE_LIMIT_PER_MIN` | No (120000 / 0.2 / 2000 / 30) | LLM tunables. `AI_RATE_LIMIT_PER_MIN` (10 on the interview-answer route) is the per-IP+user answer limit the E2E paces around. |
| `AI_MAX_ATTEMPTS` | No (3, clamped 1–5) | Max attempts per live LLM call (429/5xx + transient network errors only). |
| `INTERVIEW_PER_QUESTION_SECONDS` | No (300) | Server-enforced per-question timer. |
| `INTERVIEW_SESSION_TOTAL_SECONDS` | No (2400) | Server-enforced whole-session timer. |
| `INTERVIEW_SHORT_ANSWER_WORDS` | No (20) | Answers shorter than this show a client-side warning (answer still accepted on confirm). |
| `INTERVIEW_EXPLAIN_AGAIN_PER_QUESTION` / `INTERVIEW_EXPLAIN_AGAIN_PER_SESSION` | No (1 / 2) | Explain Again budget — max 1 per question, 2 per session. |
| `INTERVIEW_FOLLOWUP_MAX` | No (1) | At most one follow-up per interview; Partial (40–59) answers only. |
| `GITHUB_API_TOKEN` | No | Optional PAT; raises public-repo rate limit 60 → 5,000 req/hr. Private repos still refused. |
| `CLOUDINARY_CLOUD_NAME` / `CLOUDINARY_API_KEY` / `CLOUDINARY_API_SECRET` | For uploads | Without them uploads return 503. |
| `SMTP_HOST` / `SMTP_PORT` / `SMTP_SECURE` / `SMTP_USER` / `SMTP_PASS` / `EMAIL_FROM` | For email | Nodemailer (Phase 14). Without them no email is sent. **Render Free blocks outbound SMTP on 25/465/587** — delivery needs a paid plan or an HTTP email API. |
| `NODE_ENV` | Yes (`production`) | Controls forgot-password (dev-only `resetUrl` never returned in production). |
| `PORT` | Set by Render | — |
| `EXECUTION_SANDBOX` | No (`unshare`) | `unshare` (Linux namespaces) or `disabled` (fail closed — code never runs unsandboxed). |
| `EXECUTION_TIMEOUT_SECONDS` | No (30) | Code-execution timeout. |
| `MONITORING_RETENTION_DAYS` | No (90) | Raw monitoring-event retention. |

## Client (`groundtruth-ai-client`)

| Variable | Required? | Notes |
|---|---|---|
| `NEXT_PUBLIC_API_URL` | **Yes** | e.g. `https://groundtruth-ai-server.onrender.com`. **Baked in at build time** — setting it without a rebuild changes nothing. Missing it is production blocker 3. |

## ai-service (`groundtruth-ai-service`)

| Variable | Required? | Notes |
|---|---|---|
| `DATABASE_URL` | Yes | Same Render Postgres URL as the server (for embeddings storage). |
| `CORS_ORIGINS` | Yes | e.g. `https://groundtruth-ai-client.onrender.com`. Default is `http://localhost:3000` only. |
| `OPENAI_API_KEY` | For real embeddings | Gaurav pastes it. Without it the service uses labelled local-hash DEV-ONLY embeddings (no semantic meaning). |
| `PORT` | Set by Render | The Dockerfile/uvicorn must bind `$PORT`. |

## LLM timeouts and retries (production)

- `AI_TIMEOUT_MS` defaults to **120000** (120 s per attempt). The old 30 s
  default aborted genuine calls: on this VM's egress a real call takes
  30–60 s (headers alone ~4–5 s), and the live run only succeeded with a
  120 s override. Keep 120 s unless the provider is provably faster from
  the production host; lowering it below ~60 s risks aborting real calls.
  The value is env-controlled — call sites never hardcode a timeout.
- Retries: at most `AI_MAX_ATTEMPTS` (default 3, clamped 1–5) attempts per
  call, only for 429/5xx and transient network errors, with exponential
  backoff (500 ms base, doubling) plus up to 500 ms of random jitter per
  step. Timeouts are **not** retried. Worst case for one call is bounded:
  `attempts × AI_TIMEOUT_MS + backoff` — with defaults
  3 × 120 s + ~2.5 s ≈ **362.5 s** (`llmWorstCaseBoundMs` in
  `server/src/services/llm.ts`).
- Error labelling: a call that exceeds `AI_TIMEOUT_MS` fails as a **timeout**
  (502, "timed out after …ms"); 401/403 fail as **auth errors** with their
  own status ("LLM authentication failed — check AI_API_KEY / AI_MODEL"),
  never as a timeout or a generic 502.
- Recommended production settings: `AI_TIMEOUT_MS=120000`,
  `AI_MAX_ATTEMPTS=3`. If the provider is slow from the production host,
  raise the timeout rather than the attempt count — more attempts multiply
  the worst case, a longer timeout does not.
- Observability: every LLM call is logged (console + in-memory usage log)
  with operation, model, token counts, cost estimate, `durationMs`,
  `success`, and `retryCount`. Prompts, responses, keys, and PII are
  never logged.

## Local development

Local launchers live outside the repo
(`~/workspace/groundtruth-all-steps/launchers/gt-start-{server,aiservice,client}.sh`).
Local values are test-only: fresh `JWT_SECRET` per server launch (tokens
die on restart), `AI_MOCK=true`, local-hash embeddings, no Cloudinary/SMTP.
