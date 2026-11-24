# GroundTruth AI — production deployment guide

**Date:** 23 November 2026
**Status:** checklist ready; **NO deployment has been done.** Deployment
happens only after Gaurav's explicit approval.

## 0. Read this first — local vs production

Everything verified so far (Phases 0–19, ultimate mission, 23 Nov 2026)
was verified **locally**: a local Postgres, local Redis, local servers on
127.0.0.1. Local verification proves the **code and migrations work**. It
does **not** prove the production configuration works. The production configuration — Render
services, environment variables, build commands, the production database
migration — is **unverified** until the checklist below is executed and
its smoke tests pass. Do not treat a local fix as a production fix.

## 1. Current production state (read-only checks, 23 Nov 2026)

| Check | Result | Status |
|---|---|---|
| Client `https://groundtruth-ai-client.onrender.com` | HTTP 200, landing renders (56,683 bytes) | Live but broken (see below) |
| Server `https://groundtruth-ai-server.onrender.com/health` | HTTP 503 `{"status":"degraded","dependencies":{"postgres":"ok","redis":"unreachable"}}` | **BLOCKED — no Redis service on Render** |
| Server `/api/jobs` | HTTP 500 `{"error":"Internal server error"}` | **BLOCKED — jobs table missing; migration unapplied** |
| Server `/api/auth/me` (no token) | HTTP 401 (correct) | OK |
| Client JS chunks | Contain `localhost:4000`, NO `groundtruth-ai-server` string | **PENDING — built without `NEXT_PUBLIC_API_URL`** |

**Production blockers (3):**

1. **Redis unreachable — BLOCKED.** No Redis service exists on Render.
   Create one (Render Redis, free tier exists) and set `REDIS_URL` on
   `groundtruth-ai-server`. Until then `/health` stays 503 and every
   BullMQ queue (GitHub analysis, resume parsing, re-embedding) fails.
2. **`/api/jobs` HTTP 500 — BLOCKED.** The live database holds the old
   repo's Alembic schema; migration `001_init.sql` was never applied
   (statement 15, `CREATE INDEX idx_certificates_candidate ON
   certificates (candidate_id)`, fails on the old schema — see
   `docs/MIGRATION_GUIDE.md`). Fix: run the preflight + migrations
   (§3, step 4) — never by hand-editing the live schema.
3. **Client API env var — PENDING.** Set `NEXT_PUBLIC_API_URL=
   https://groundtruth-ai-server.onrender.com` on
   `groundtruth-ai-client` and redeploy the client. The value is baked
   in at build time — setting it without a rebuild changes nothing.

## 2. Services to exist on Render (before deploy)

| Render service | Type | Notes |
|---|---|---|
| `groundtruth-ai-server` | Web Service (Node) | Existing. Build: `npm ci && npm run build --workspace=server` (or repo-root build); Start: `npm run start --workspace=server`. **Build Command must include the migrate step — see §3 step 4.** |
| `groundtruth-ai-client` | Static Site / Web Service (Next.js) | Existing. Build with `NEXT_PUBLIC_API_URL` set (§1 blocker 3). `output: "standalone"` — see `client/next.config.mjs`. |
| `groundtruth-postgres` | PostgreSQL (free) | Existing. **Expires 15 Dec 2026 — see `docs/POSTGRES_MIGRATION_PLAN.md` before anything else.** Do the Postgres decision first if the deploy slips past 30 Nov. |
| Redis | Redis (free tier) | **TO CREATE** (§1 blocker 1). |
| `groundtruth-ai-service` | Web Service (Python) | **TO CREATE** (ai-service is not on Render yet). Dockerfile exists in `ai-service/`; start: `uvicorn app.main:app --host 0.0.0.0 --port $PORT`. Needs `DATABASE_URL`, `CORS_ORIGINS` (see §4). |

No `render.yaml` blueprint is committed on purpose: the services were
created manually, and a blueprint file could auto-apply on sync. All
steps here are manual dashboard actions.

## 3. Deployment order (do not skip steps)

1. **Postgres decision first.** If the date is past 30 Nov 2026, follow
   `docs/POSTGRES_MIGRATION_PLAN.md` before deploying anything else.
2. **Create the Redis service** on Render; copy its internal `REDIS_URL`.
3. **Set all server env vars** (§4) on `groundtruth-ai-server`,
   including `REDIS_URL` and `DATABASE_URL` (unchanged).
4. **Run the migrations against the live database.** In the Render
   dashboard, set the server's **Build Command** to run the migrate
   step before starting, e.g. `npm run migrate --workspace=server &&
   npm run build --workspace=server`, or run a one-off job with
   `DATABASE_URL` set to the live database:
   `DATABASE_URL="<live url>" npm run migrate --workspace=server`.
   The migrate script applies `infra/postgres/000_preflight.sql`
   (repairs the old schema) then `001`–`009`, idempotently. Verify:
   `SELECT count(*) FROM jobs;` must return rows and
   `idx_certificates_candidate` must exist (§5 checks).
   **Never** edit the live schema by hand; never drop a production table.
5. **Deploy the server.** Verify `/health` → `{"status":"ok",
   "postgres":"ok","redis":"ok"}` (200, not 503).
6. **Create + deploy ai-service** (§2) with its env vars (§4).
   Verify `https://<ai-service>/health` → 200.
   Then set `AI_SERVICE_URL` on the server to its URL and redeploy the
   server (or set it before step 5 if ai-service already exists).
7. **Set `NEXT_PUBLIC_API_URL` on the client and redeploy the client.**
   Verify the built JS contains `groundtruth-ai-server` and no
   `localhost:4000` (fetch any `_next/static/chunks/*.js` and grep).
8. **Smoke tests (§5).**
9. **Seed demo accounts only if Gaurav approves** (see §6).

## 4. Environment variables (Render dashboard — never in the repo)

### `groundtruth-ai-server`

| Variable | Value / source | Required? |
|---|---|---|
| `DATABASE_URL` | Render Postgres internal URL (existing) | Yes — already set |
| `REDIS_URL` | New Render Redis internal URL | Yes — §1 blocker 1 |
| `JWT_SECRET` | `openssl rand -hex 32` (generate fresh; never reuse the local test secret) | Yes — server refuses to sign without it |
| `JWT_EXPIRES_IN` | `1d` | No (default `1d`) |
| `FRONTEND_URL` | `https://groundtruth-ai-client.onrender.com` | Yes — password-reset links + **CORS allowlist** (Phase 8: requests from any other browser origin get no `Access-Control-Allow-Origin` header) |
| `AI_SERVICE_URL` | `https://<groundtruth-ai-service>.onrender.com` | Yes once ai-service exists; until then leave unset and the server logs ai-service as unreachable (jobs still work, matching is background-only) |
| `AI_API_BASE_URL` | `https://api.openai.com/v1` | Only Gaurav can paste this (with the key + model below) |
| `AI_API_KEY` | OpenAI key — **Gaurav pastes it himself**; the key text is never visible to the agent | Needed for live AI; without it the server honestly runs the mock provider (`aiAvailable:false`) |
| `AI_MODEL` | `gpt-4o-mini` | With the key above |
| `AI_MOCK` | `false` in production (omit it; default is false) | — |
| `GITHUB_API_TOKEN` | GitHub PAT — optional, Gaurav creates it | No (60 req/hr unauthenticated without it) |
| `CLOUDINARY_CLOUD_NAME` / `CLOUDINARY_API_KEY` / `CLOUDINARY_API_SECRET` | Cloudinary console | Yes for uploads/resume parsing; without them uploads return 503 |
| `SMTP_HOST` / `SMTP_PORT` / `SMTP_SECURE` / `SMTP_USER` / `SMTP_PASS` / `EMAIL_FROM` | SMTP provider (Gmail / SendGrid / SES — any SMTP host; Nodemailer, wired in Phase 14) | Needed for forgot-password reset emails; without them no email is sent (dev `resetUrl` fallback only). **BLOCKED on Render Free: free web services cannot send outbound SMTP on ports 25/465/587 (Render docs) — email delivery needs a paid plan or an HTTP-based email API instead.** Delivery test to Gaurav's own address required before claiming email works. |
| `AI_SERVICE_TIMEOUT_MS` / `AI_TIMEOUT_MS` / `AI_TEMPERATURE` / `AI_MAX_TOKENS` / `AI_RATE_LIMIT_PER_MIN` | Tunables (defaults 30000 / 30000 / 0.2 / 2000 / 30) | No |
| `NODE_ENV` | `production` | Yes — controls the forgot-password behaviour (dev-only `resetUrl` is never returned in production) |
| `PORT` | Set by Render | — |
| `EXECUTION_SANDBOX` | `unshare` | No (default `unshare`; `disabled` fails closed) |
| `EXECUTION_TIMEOUT_SECONDS` | `30` | No |
| `MONITORING_RETENTION_DAYS` | `90` | No |

### `groundtruth-ai-client`

| Variable | Value | Required? |
|---|---|---|
| `NEXT_PUBLIC_API_URL` | `https://groundtruth-ai-server.onrender.com` | **Yes — §1 blocker 3. Baked in at build time; redeploy after setting.** |

### `groundtruth-ai-service` (new)

| Variable | Value | Required? |
|---|---|---|
| `DATABASE_URL` | Same Render Postgres URL as the server | Yes |
| `CORS_ORIGINS` | `https://groundtruth-ai-client.onrender.com` | Yes (default is localhost:3000 only) |
| `OPENAI_API_KEY` | OpenAI key — Gaurav pastes it himself | Needed for real embeddings; without it the service uses labelled local-hash dev embeddings |
| `PORT` | Set by Render | — |

## 5. Post-deploy smoke tests (all must pass before calling it live)

```bash
BASE=https://groundtruth-ai-server.onrender.com
curl -s $BASE/health
# -> {"status":"ok","dependencies":{"postgres":"ok","redis":"ok"}} (200)

curl -s $BASE/api/jobs | head -c 200
# -> 200, JSON array of jobs (not 500)

# Register a throwaway account, log in, call /api/auth/me (200), then
# create a job as a recruiter, apply as a student, check the application
# appears in the recruiter dashboard. Delete the throwaway rows after.
# (Do this with test accounts, never with a real user's credentials.)

# Client: open https://groundtruth-ai-client.onrender.com in a browser,
# sign in with the throwaway account, open /jobs — the 3 jobs must render
# (proves browser -> API works, i.e. NEXT_PUBLIC_API_URL is correct).
# Open DevTools Network: no requests to localhost:4000.
```

Database checks (read-only, via `psql` with the Render external URL or
the Render dashboard SQL shell):

```sql
SELECT count(*) FROM information_schema.tables WHERE table_schema='public';  -- expect 46+
SELECT count(*) FROM jobs;                                                    -- expect >= 2
SELECT data_type FROM information_schema.columns
  WHERE table_name='users' AND column_name='role';                            -- expect text
SELECT count(*) FROM pg_indexes WHERE indexname='idx_certificates_candidate'; -- expect 1
```

## 6. Demo accounts (only on explicit approval)

```bash
# On a machine with the server env (or a Render one-off job):
DEMO_STUDENT_PASSWORD='<Gaurav supplies>' \
DEMO_RECRUITER_PASSWORD='<Gaurav supplies>' \
DATABASE_URL="<live url>" npm run seed:demo --workspace=server
```

Creates `demo.student@groundtruth.dev` (candidate) and
`demo.recruiter@groundtruth.dev` (recruiter, company "Demo Company"),
idempotently (existing accounts are never reset or re-created). **Do not
run this without Gaurav's explicit approval and passwords he supplies.
Never invent demo passwords, never commit them.**

## 7. Rollback

- **Server/client:** redeploy the previous Render deploy from the
  dashboard (each deploy keeps history). Flip env vars back first if a
  bad value caused the failure.
- **Database:** migrations are idempotent and additive (no DOWN
  migrations by design); a bad deploy is rolled back by redeploying the
  app, not by touching the database. If the database itself must be
  restored, use the §3 backup from
  `docs/POSTGRES_MIGRATION_PLAN.md` — restore into a NEW database and
  point `DATABASE_URL` at it; never restore over the live database.
- **Postgres expiry:** the free database is never deleted as part of a
  deploy. Its replacement follows `docs/POSTGRES_MIGRATION_PLAN.md`
  only, with Gaurav's explicit approval.

## 8. What this guide deliberately does NOT cover

- The AI Interview + report feature and git/GitHub-connect: excluded by
  Gaurav's 17 Nov 2026 decision. Do not deploy them.
- The Anima-design homepage: not published, awaits his verdict.
- Mail sending for forgot-password: SMTP is implemented in code (Phase 14,
  Nodemailer; env vars in §4) but no credentials are set and no delivery
  test has run. On Render Free, outbound SMTP (25/465/587) is blocked, so
  delivery needs a paid plan or an HTTP email API. Do not claim email
  works until a delivery test to Gaurav's own address passes.
