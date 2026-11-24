# GroundTruth AI — production runbook

**Date:** 24 November 2026 (competency directive, Phase G).
**Status:** LOCAL COMPLETE — PRODUCTION PENDING. Nothing below has been
executed against production. Deployment happens only after Gaurav's
explicit approval — see `docs/DEPLOYMENT.md` for the checklist.

## Services (Render)

| Service | Type | URL |
|---|---|---|
| `groundtruth-ai-client` | Static / Web | `https://groundtruth-ai-client.onrender.com` |
| `groundtruth-ai-server` | Web (Node) | `https://groundtruth-ai-server.onrender.com` |
| `groundtruth-ai-service` | Web (Python) — **TO CREATE** | `https://<groundtruth-ai-service>.onrender.com` |
| `groundtruth-postgres` | Postgres (Free) | **Expires 15 Dec 2026** — see `docs/POSTGRES_MIGRATION_PLAN.md` |
| Redis | Redis (Free) — **TO CREATE** | Internal `REDIS_URL` |

## Health checks (run after any deploy)

```bash
BASE=https://groundtruth-ai-server.onrender.com
curl -s $BASE/health
# expect 200 {"status":"ok","dependencies":{"postgres":"ok","redis":"ok"}}
curl -s $BASE/api/jobs | head -c 200   # expect 200, JSON array (not 500)
curl -s -o /dev/null -w "%{http_code}\n" $BASE/api/auth/me  # expect 401 without token
# Client: open the site, sign in, open /jobs — jobs must render.
# DevTools Network: no requests to localhost:4000.
```

## Known production state (re-checked 23 Nov 2026 ~20:30 IST)

| Check | Result |
|---|---|
| Client | 200, 56,883 bytes (first attempt 000 = free-tier cold start) |
| `/health` | **503** `{"status":"degraded","dependencies":{"postgres":"ok","redis":"unreachable"}}` |
| `/api/jobs` | **500** (live DB unmigrated — jobs table missing) |
| `/api/auth/me` (no token) | 401 (correct) |

## Production blockers (all open)

1. **Redis connectivity — BLOCKED.** No Redis service on Render.
   Create one and set `REDIS_URL` on the server.
2. **Production DB migration — BLOCKED.** Live DB holds the old
   Alembic schema; migrations 000–014 never applied. Run preflight +
   000–014 per `docs/DEPLOYMENT.md` §3 step 4 (never hand-edit).
3. **Client API env var — PENDING.** Set `NEXT_PUBLIC_API_URL` on the
   client and redeploy (baked in at build time).
4. **Production AI service — PENDING.** ai-service is not on Render
   yet. Create + deploy it, set `AI_SERVICE_URL` on the server.
5. **Postgres expiry — 15 Dec 2026 (confirm exact date in the
   dashboard).** Decision due 30 Nov 2026; backup by 8 Dec; cutover
   by 12 Dec. See `docs/POSTGRES_MIGRATION_PLAN.md`.

## Common failures

| Symptom | Likely cause | Action |
|---|---|---|
| `/health` 503, redis unreachable | No Redis service / wrong `REDIS_URL` | Create Redis on Render; set internal `REDIS_URL`; redeploy server. |
| `/api/jobs` 500 | Migration unapplied | Run the migrate step (DEPLOYMENT.md §3.4); verify `idx_certificates_candidate` exists. |
| Client shows no jobs / calls localhost:4000 | Client built without `NEXT_PUBLIC_API_URL` | Set the var, redeploy client, verify chunks contain `groundtruth-ai-server`. |
| Uploads 503 | Cloudinary env vars missing | Set `CLOUDINARY_*` on the server. |
| Forgot-password sends nothing | SMTP unconfigured, or Render Free blocks SMTP 25/465/587 | Set `SMTP_*` (paid plan) or switch to an HTTP email API; run a delivery test to Gaurav's address first. |
| `/match` 503 "No embedding stored" | Candidate/job not yet re-embedded | Wait for the worker, or run `npm run backfill:embeddings`; check worker logs. |
| Interview answer shows evaluation pending / failed | Live-AI scoring failed (timeout, 401/403, 5xx, invalid response) — the answer is kept, no score substituted | `POST /interviews/:id/session/retry-evaluation` `{questionId}` as the candidate owner (or admin). Bounded retries (3 transient / 2 invalid-response-or-auth, then `permanently_failed`); a completed retry is idempotent; a concurrent duplicate retry → 409. Check `interview_evaluation_attempts` for the failure kind. Never re-submit the answer — answers are insert-once (409). |
| Login 429 | Rate limit (5/min/IP) | Wait 60s; legitimate users rarely hit this. |

## Performance (local evidence, 23 Nov 2026)

- API median latency 2ms (`/health`, `/api/jobs`, search, pagination);
  20 parallel `/api/jobs` in 38ms, all 200.
- Jobs list uses `idx_jobs_status` (Index Scan, 0.1ms).
- Re-embedding jobs complete within ~1s of enqueue.
- Client JS chunks total 1.4 MB (largest 172 KB).
- Local RSS: server ~47 MB, client 89 MB, ai-service 54 MB.
- No error-monitoring service is configured (Sentry etc.) — adding one
  needs Gaurav's approval.

## Rollback

- **Server/client:** redeploy the previous Render deploy from the
  dashboard (history is kept). Flip env vars back first if a bad value
  caused the failure.
- **Database:** migrations are idempotent and additive (no DOWN
  migrations). A bad deploy is rolled back by redeploying the app, not
  by touching the DB. If the DB itself must be restored, restore the
  §3 backup into a NEW database and point `DATABASE_URL` at it; never
  restore over the live database. **Never delete the old database**
  until the new one is fully verified AND Gaurav explicitly approves
  the deletion in plain words.
- **Postgres expiry:** the free DB is never deleted as part of a deploy.

## Known limitations (do not present as fixed)

- AI matching locally uses local-hash DEV-ONLY embeddings; real AI
  needs keys Gaurav pastes. Server LLM runs the mock provider locally.
- Code execution verified only via the local `unshare` sandbox;
  Judge0 is not configured.
- Docker image builds NOT TESTED (no Docker here).
- Email delivery BLOCKED (no credentials, no delivery test; Render
  Free blocks SMTP).
- JWT in localStorage; stateless logout (no denylist) — user decisions.
- `job_match` notifications unwired; landing demo form not wired to
  `/api/contact`; DPDP grievance-officer email unpublished; GitHub-based
  assessment returns 409 (no GitHub OAuth); Monaco loads from a CDN;
  no account-deletion endpoint; no error-monitoring service;
  WebSocket guard under load NOT TESTED.
- The AI Interview + report feature is **APPROVED under the 24 Nov
  2026 directive** (the 17 Nov 2026 exclusion was explicitly revoked
  for a real interview). Git/GitHub-connect remains excluded by the
  17 Nov decision. The Anima-design homepage is unpublished,
  awaiting Gaurav's verdict.
