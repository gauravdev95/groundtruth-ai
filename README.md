# Ground Truth AI

**Hire on proof, not promises.**

Ground Truth AI is an AI-verified talent marketplace. Candidate skills are backed
by real evidence — GitHub activity, coding-platform performance, certificates,
and code-grounded interviews — and candidates are matched to jobs two-way on
dense vector embeddings.

> **Status, 24 November 2026 — LOCAL COMPLETE, PRODUCTION PENDING
> (ultimate completion mission, Phases 0–19, + competency-interview
> directive Phases A–G).**
> The full product is implemented and verified locally: real JWT auth, student
> + recruiter flows, jobs/applications/pipeline, messaging, notifications,
> assessments with a sandboxed code-execution Lab, AI matching (FastAPI
> ai-service), mobile-responsive landing, and a security audit with fixes —
> plus, since 24 Nov 2026, a role-based competency framework (7 roles × 5
> competencies, L1–L4 bands), a real AI technical interview (pre-generated
> 7 questions, session flow, server timers, answer locking, max 1
> follow-up, 5-dimension scoring, immutable report), final competency
> profiles blending coding 50 / interview 30 / evidence 20, and recruiter
> competency + interview-breakdown views.
> Local test evidence (all re-run 24 Nov 2026, Phase G): server suite 162 pass /
> 0 fail / 1 skipped, ai-service pytest 10 pass, E2E journey 87 pass /
> 0 fail, API flow 69/69, security checks 24/24 + Phase G interview
> security 21/21, integrated E2E 28/28, browser: candidate interview
> 59/59 + competency page 16/16 + recruiter 19/19, responsive 320px
> 4/4 + interview/competency pages 0-overflow at 320px,
> backup/restore rehearsed twice with exact-match counts. Phase G also
> fixed a real defect: the interview-generate endpoint returned the full
> question specs (expected points + rubrics) to the candidate — now it
> returns only a question count; questions are served one at a time,
> stripped, via the session endpoint.
> **Stabilization, 24 Nov 2026 (Phase 1, commits `3c1cb8b` + `7ecae36`,
> validation worker 6, mock mode only — live-AI validation by the
> coordinator afterwards):** F1 strict qualitative schema (a missing
> live-AI score now fails loudly, never silently becomes 0); F2 live
> question generation with strict refine validation + `generationProvider`
> truthful (`live` only when the refine response validates, else
> `deterministic`); F3 evaluation retry (`POST
> /interviews/:id/session/retry-evaluation`, attempts in
> `interview_evaluation_attempts`, migration 013); F4 LLM timeout
> default 30 s → 120 s; F5 follow-up retry (migration 014 widens the
> failure-kind CHECK with `auth_failed`) + dual-mode E2E harness
> (mode-aware provider assertions, mock and live). Provisional-vs-verified
> classification: a profile that is not fully verified carries a
> provisional score/category only — never a verified category or a
> "Job Ready" label on insufficient evidence (`classificationRuleVersion:
> provisional-vs-verified-v1`). Re-validated 24 Nov 2026 (mock mode,
> fresh scratch DB `gt_stab_val6`, migrations 000–014 → 54 tables /
> 162 indexes): server suite **242 pass / 0 fail / 1 skipped** (the skip
> is the live-GitHub test), ai-service pytest 10/10, mock E2E **95/95**,
> API flow 69/69, integrated E2E 28/28, security 24/24 + interview
> security 21/21, browser E2E + responsive **29/29** (real Chromium:
> full interview via UI incl. follow-up, competency compute, recruiter
> applications/detail/evidence, 320px 0-overflow on 4 pages). Live-AI
> results (provider `live`, follow-up under real AI) are NOT in this
> validation — the coordinator runs them separately; nothing here
> claims live-AI evidence.
> **Nothing here is deployed yet.** The production deployment is a separate,
> gated step — see [`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md) for the
> checklist and the four open production blockers (Redis, `/api/jobs` 500,
> client API env var, ai-service not deployed). Local verification proves
> the code works locally only; it does not prove the production
> configuration. Honest scope notes: AI matching locally uses a
> local-hash DEV-ONLY embedding model (no real OpenAI calls without
> `OPENAI_API_KEY`); interview scoring locally runs on the deterministic
> mock provider, labelled as such (no live AI calls without `AI_API_KEY`
> / `AI_MODEL`); code execution is verified only via the local
> `unshare` sandbox (Judge0 is not configured anywhere); Docker image
> builds are NOT TESTED (no Docker in this environment); email delivery
> is BLOCKED pending credentials + a delivery test (and Render Free
> blocks outbound SMTP).
>
> Earlier phase docs: [`docs/PHASE_ZERO.md`](docs/PHASE_ZERO.md) (scaffolding),
> [`docs/FINAL_AUDIT.md`](docs/FINAL_AUDIT.md) (18 Nov audit + 23 Nov updates
> + 24 Nov Phase G update),
> [`docs/MIGRATION_GUIDE.md`](docs/MIGRATION_GUIDE.md),
> [`docs/POSTGRES_MIGRATION_PLAN.md`](docs/POSTGRES_MIGRATION_PLAN.md)
> (**Postgres free tier expires 15 Dec 2026 — critical**),
> [`docs/ENVIRONMENT.md`](docs/ENVIRONMENT.md) (env-var reference),
> [`docs/API.md`](docs/API.md), [`docs/DATABASE.md`](docs/DATABASE.md),
> [`docs/SECURITY.md`](docs/SECURITY.md), [`docs/TESTING.md`](docs/TESTING.md),
> [`docs/RUNBOOK.md`](docs/RUNBOOK.md).
> Competency + interview design docs (Phases A–G):
> [`docs/IMPLEMENTATION_MAP_COMPETENCY.md`](docs/IMPLEMENTATION_MAP_COMPETENCY.md)
> (Phase A audit), [`docs/COMPETENCY_SPEC.md`](docs/COMPETENCY_SPEC.md)
> (framework + scoring spec), [`docs/COMPETENCY_FRAMEWORK.md`](docs/COMPETENCY_FRAMEWORK.md),
> [`docs/SCORING_METHODOLOGY.md`](docs/SCORING_METHODOLOGY.md),
> [`docs/AI_INTERVIEW.md`](docs/AI_INTERVIEW.md),
> [`docs/RESEARCH_REFERENCES.md`](docs/RESEARCH_REFERENCES.md).

## Architecture

```
                         ┌──────────────────────┐
                         │  client (Next.js)    │  :3000
                         │  landing + jobs list │
                         │  + dashboards        │
                         └──────────┬───────────┘
                                    │ REST /api/*
                         ┌──────────▼───────────┐
                         │  server (Node/   │  :4000
                         │  Express + TS)       │
                         │  routes · queues     │
                         │  (BullMQ workers     │
                         │   co-located)        │
                         └──┬───────┬───────┬───┘
                            │       │       │
              ┌─────────────▼┐ ┌────▼────┐ ┌▼──────────────┐
              │ PostgreSQL   │ │ Redis / │ │ ai-service    │ :8000
              │ + pgvector   │ │ BullMQ  │ │ (Python /     │
              │ :5432        │ │ :6379   │ │  FastAPI)     │
              └──────────────┘ └─────────┘ └───────┬───────┘
                                                   │ uploads
                                            ┌──────▼──────┐
                                            │ Cloudinary  │
                                            │ groundtruth │
                                            │ /resumes    │
                                            │ /certificat-│
                                            │ es /evidenc-│
                                            │ e-reports   │
                                            └─────────────┘
```

## Services

| Service     | Tech                      | Port | Path           |
| ----------- | ------------------------- | ---- | -------------- |
| client      | Next.js 14, React 18, TS  | 3000 | `client/`      |
| server  | Node.js 20, Express, TS   | 4000 | `server/`  |
| ai-service  | Python 3.12, FastAPI      | 8000 | `ai-service/`  |
| postgres    | PostgreSQL 16 + pgvector  | 5432 | `infra/postgres/` |
| redis       | Redis 7 (BullMQ queues)   | 6379 | —              |
| Cloudinary  | Object storage (SaaS)     | —    | folders under `groundtruth/` |

## Quick start

### With Docker (recommended)

```bash
cp .env.example .env        # fill in CLOUDINARY_* (and OPENAI_API_KEY if you have one)
docker compose up --build
# client → http://localhost:3000
# api    → http://localhost:4000/health
# ai     → http://localhost:8000/health
```

### Host dev (postgres + redis still via compose)

```bash
docker compose up postgres redis -d
cp .env.example .env
npm install
# terminal 1 — ai-service
cd ai-service && python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt && uvicorn app.main:app --reload --port 8000
# terminal 2 — server
npm run dev --workspace=server
# terminal 3 — client
npm run dev --workspace=client
```

## Environment setup

All variables are documented in [`.env.example`](.env.example). Each service
also ships its own `.env.example` (`client/`, `server/`, `ai-service/`).
Never commit a real `.env`. Cloudinary credentials come from the Cloudinary
console; `OPENAI_API_KEY` is optional — without it, ai-service uses
a deterministic local-hash dev embedding (`model="local-hash-dev-only"`),
which is **not** suitable for production matching. `JWT_SECRET` is
**required** — the server refuses to sign tokens without one
(generate with `openssl rand -hex 32`).
The production deployment checklist, including every variable that must be
set on Render, lives in [`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md).

## What is done (locally verified, 24 Nov 2026)

- ✅ Real JWT auth (bcrypt 12 rounds, reset tokens hashed + single-use +
  30-min expiry), role-based access (candidate / recruiter / admin),
  ownership checks on jobs, applications, profiles, resumes and messages.
- ✅ Student onboarding + profile + dashboard, recruiter dashboard +
  pipeline + analytics, job posting (own company only), applications,
  messaging, notifications, contact form.
- ✅ Assessment system: profile strength, repo analysis, code challenge
  with sandboxed execution (unshare namespaces, allowlisted commands,
  fail-closed), hidden tests, evaluation, interview, verified profile.
- ✅ Competency framework (Phase B, v1.0.0): 7 roles × 5 distinct
  competencies (35 total), weights summing to 100 per role, L1–L4
  proficiency bands, deterministic scoring (see
  `docs/COMPETENCY_FRAMEWORK.md` and `docs/SCORING_METHODOLOGY.md`).
- ✅ Real AI technical interview (Phases C–D): exactly 7 pre-generated
  frozen questions, session lifecycle (intro → readiness gate → one
  question at a time), server timers (300s/question, 2400s/session),
  answer locking (duplicate 409), max 1 follow-up (Partial answers
  only), Explain Again (1/question, 2/session), 5-dimension scoring,
  immutable report (see `docs/AI_INTERVIEW.md`).
- ✅ Final competency profiles (Phase E): coding 50 / interview 30 /
  evidence 20 blend, safeguards (practical minimum 40, Incomplete /
  Insufficient Evidence / Not Assessed — never silent zeros), immutable
  stored rows, idempotent recompute.
- ✅ Recruiter competency + interview views (Phase F): competency chips
  (L1–L4 only) on applications list / pipeline / dashboard, assessment
  history + competency profile on application detail, interview
  breakdown + coding evaluation breakdown on the evidence page.
- ✅ AI matching: FastAPI ai-service (`/embed`, `/match`, `/parse-resume`,
  `/analyze-repo`) wired to Express with timeout + retry; pgvector 1536-dim
  embeddings; mock LLM provider when no key is set (honestly labelled).
- ✅ Demo accounts: idempotent seed script (`npm run seed:demo`,
  passwords from env only) — **not** run against production.
- ✅ Mobile responsive: landing + all app pages, 0 horizontal overflow at
  320/360/375/390/414/768/1280 (verified in headless Chrome); interview,
  competency and recruiter pages re-verified 0-overflow at 320px on
  24 Nov 2026.
- ✅ Security audit (23 Nov, re-run 24 Nov): fixed public candidate PII endpoints, public
  upload endpoint, missing auth rate limits, wide-open CORS, unbounded
  WS commands — plus the Phase G fix (interview-generate no longer leaks
  expected points/rubrics). See `docs/FINAL_AUDIT.md` for the per-item findings.
- ✅ Migrations `000`–`012` verified on a fresh database (53 tables /
  156 indexes), idempotent re-runs. See `docs/MIGRATION_GUIDE.md`.
- ✅ CI (typecheck, pytest, compose + SQL validation).

## What is NOT done yet (needs Gaurav's decision / action)

- **No production deployment.** The live Render deployment is unhealthy
  (`/health` 503 Redis unreachable, `/api/jobs` 500, client built without
  `NEXT_PUBLIC_API_URL`). Deployment happens only after his explicit
  approval — see `docs/DEPLOYMENT.md`.
- **PostgreSQL free tier expires 15 Dec 2026 (critical).** See
  `docs/POSTGRES_MIGRATION_PLAN.md` — backup by 8 Dec, cutover by 12 Dec,
  decision (Render Starter upgrade vs new provider) by 30 Nov.
- **Demo accounts are not seeded in production** — needs his approval +
  passwords he supplies.
- **No mail sender** — forgot-password reset links go nowhere in
  production (dev returns the link for testing only).
- **AI keys not set in production** — no `AI_API_KEY` / `AI_MODEL` on the
  server, no `OPENAI_API_KEY` on ai-service, no `GITHUB_API_TOKEN`;
  the app runs on the labelled mock provider / local-hash embeddings
  until he pastes them in the Render dashboard.
- **AI Interview + report is APPROVED under the 24 Nov 2026 directive**
  (the 17 Nov 2026 exclusion was explicitly revoked for a real interview
  — see `docs/API.md` and `docs/AI_INTERVIEW.md`). Git/GitHub-connect
  remains excluded by the 17 Nov decision. The Anima-design homepage is
  not published (awaits his verdict).
- Open security notes (user decisions): JWT lives in localStorage
  (XSS-sensitive by design), logout is stateless (no token denylist),
  WS terminal monitoring stores a 500-char command-output excerpt.
