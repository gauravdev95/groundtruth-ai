# Assessment System — Technical Audit (Phase 1)

**Repo:** `gauravdev95/groundtruth-ai` — fresh `--depth 1` clone at HEAD
**Commit:** `6462b04` — "Student profile: remove GitHub verification stage, one
project only, Profile Complete + strength + AI Monitoring" (2026-11-18)
**Audited:** 2026-11-18, by reading every source file listed in §1. No file was
assumed: every claim below names the file it was read from. Where a claim could
not be verified in this VM it is marked **UNVERIFIED** in §13.

> Scope note. This audit covers the repository **as it stands at 6462b04**.
> It does not cover the old repo `GroundTruth-AI-Recruiter-Intelligence`
> (never touched) and it does not cover live Render state beyond what the
> repo itself says (no `render.yaml` exists — see §10).

---

## 1. Repository structure (136 files, `.git` excluded)

```
groundtruth-ai/
├── .env.example                  # root env template (see §10)
├── .github/workflows/ci.yml      # CI: node typecheck/lint, pytest, SQL sanity
├── .gitignore
├── Makefile                      # up/down/logs/ps/install/dev/typecheck/test
├── README.md                     # 111 lines, Phase 0 overview
├── package.json                  # npm workspaces: client, server; node >= 20
├── package-lock.json
├── docker-compose.yml            # postgres + redis + ai-service + server + client
├── client/                       # Next.js 14 App Router, React 18, TypeScript
│   ├── Dockerfile  next.config.mjs  tailwind.config.ts  tsconfig.json
│   ├── .env.example  .eslintrc.json  postcss.config.js
│   └── src/
│       ├── app/                  # layout, page (landing), auth/*, jobs/*,
│       │                         # account/, student/*, recruiter/*
│       ├── components/auth/      # AuthForm, AuthShell, RequireAuth
│       ├── components/recruiter/ # RecruiterShell
│       ├── components/student/   # OnboardingShell, ProfileForms,
│       │                         # ProfileStrength, StudentShell, useStudentProfile
│       └── lib/                  # api.ts, auth.ts, auth-context.tsx,
│                                 # dashboard-path.ts, recruiter.ts, student.ts
├── server/                       # Node 20, Express, TypeScript, pg, BullMQ
│   ├── Dockerfile  package.json  tsconfig.json  README.md  .env.example
│   ├── src/
│   │   ├── index.ts              # app bootstrap, mounts routers, starts workers
│   │   ├── config/               # env.ts, db.ts (pg Pool), queue.ts (ioredis),
│   │   │                         # cloudinary.ts
│   │   ├── middleware/           # auth.ts (requireAuth/requireRole),
│   │   │                         # errorHandler.ts (ApiError, asyncHandler)
│   │   ├── routes/               # health, auth, jobs, applications,
│   │   │                         # candidates, student, recruiter, uploads
│   │   ├── services/             # auth, aiService, student, recruiter,
│   │   │                         # applications, analytics, cloudinary
│   │   ├── queues/               # index.ts (Queue defs), jobs.ts (enqueue fns)
│   │   ├── workers/              # index.ts, githubAnalysis, llmParsing,
│   │   │                         # vectorReembedding
│   │   └── scripts/migrate.ts    # applies infra/postgres/*.sql in order
│   └── tests/                    # 6 files, node:test (see §12)
├── ai-service/                   # Python 3.12, FastAPI
│   ├── Dockerfile  pyproject.toml  requirements.txt  README.md  .env.example
│   ├── app/
│   │   ├── main.py  config.py  db.py  embeddings.py  schemas.py
│   │   ├── cloudinary_client.py
│   │   └── routers/              # embed.py, parse.py, analyze.py, match.py
│   └── tests/                    # test_health.py (pytest)
├── infra/postgres/               # 001_init.sql … 006_phase6.sql, 002_seed.sql
└── docs/
    ├── ARCHITECTURE.md           # Phase 0 architecture (73 lines)
    ├── PHASE_ZERO.md             # Phase 0 checklist (67 lines)
    ├── ASSESSMENT_AUDIT.md       # this file
    └── ASSESSMENT_ARCHITECTURE.md
```

No `render.yaml` / `render.yml`. No `client/src/app/student/assessment/*`
or `server/src/routes/assessment*` — the assessment system does not exist yet.
No `ws`, `socket.io`, Monaco, or rate-limit dependency anywhere (verified by
grep over `*.json|*.ts|*.tsx|*.py|*.txt|*.toml`, excluding `.git`).

---

## 2. Package inventory

### Root — `package.json`

| Field | Value |
| --- | --- |
| name / version | `groundtruth-ai` / `0.1.0`, private |
| workspaces | `client`, `server` (ai-service is **not** a workspace) |
| engines | node `>= 20` |
| scripts | `dev:client`, `dev:api`, `build`, `typecheck` (all workspace-delegated) |

### Client — `client/package.json` (Next.js 14.2, React 18.3.1, TS 5.5)

Dependencies: `next ^14.2.0`, `react ^18.3.1`, `react-dom ^18.3.1`,
`framer-motion ^11.11.0`, `lucide-react ^0.454.0`.
Dev: `typescript ^5.5.0`, `tailwindcss ^3.4.14`, `eslint ^8.57.0`,
`eslint-config-next ^14.2.0`, `@types/*`, `autoprefixer`, `postcss`.
Scripts: `dev` (`next dev`), `build`, `start`, `typecheck` (`tsc --noEmit`),
`lint` (`next lint`). **No test script, no test framework.**
Notable absences: no Monaco editor, no `ws`/`socket.io`, no state library,
no form library — forms are hand-rolled React + `fetch`.

### Server — `server/package.json` (Node 20, Express 4.19, TS 5.5)

Dependencies: `express ^4.19.0`, `pg ^8.12.0`, `bullmq ^5.0.0`,
`ioredis ^5.4.0`, `jsonwebtoken ^9.0.3`, `bcryptjs ^3.0.3`, `zod ^3.23.0`,
`cors ^2.8.5`, `helmet ^7.1.0`, `dotenv ^16.4.0`, `multer ^1.4.5-lts.1`,
`cloudinary ^2.0.0`. Dev: `tsx ^4.16.0`, `typescript ^5.5.0`, `@types/*`.
Scripts: `dev` (`tsx watch src/index.ts`), `build` (`tsc`),
`start` (`node dist/index.js`), `typecheck` / `lint` (both `tsc --noEmit`),
`migrate` (`tsx src/scripts/migrate.ts`), `test` — see §12 (node:test via
`tsx --test`, with an inline `JWT_SECRET` literal in the script — §12.3).
Notable absences: no `express-rate-limit` or any rate-limit middleware, no
`ws`, no validation beyond zod, no logger (plain `console.*`).

### AI service — `ai-service/pyproject.toml` + `requirements.txt`

Python `>= 3.12`. Runtime deps: `fastapi >= 0.110`, `uvicorn[standard] >= 0.29`,
`pydantic >= 2.6`, `pydantic-settings >= 2.2`, `psycopg[binary] >= 3.1`,
`pypdf >= 4.2`, `httpx >= 0.27`, `python-dotenv >= 1.0`. Dev: `pytest >= 8.0`.
No OpenAI SDK, no LangChain, no `openai` package — OpenAI is called with raw
`httpx` in `app/embeddings.py`. No test runner beyond pytest; `Makefile test`
runs only `pytest` in ai-service (it does **not** run the server tests).

---

## 3. Database models + migrations inventory

Migrations live in `infra/postgres/` and are applied **in filename order**
by `server/src/scripts/migrate.ts` (`npm run migrate` from `server/`), which
reads every `*.sql` file in that directory and runs it whole against
`DATABASE_URL`. There is **no Alembic, no migration-state table, no
down-migrations** — every file must be idempotent (`IF NOT EXISTS` /
`ON CONFLICT`). `docker-compose.yml` additionally mounts the directory into
`/docker-entrypoint-initdb.d`, so the files run once on **first** DB init
only; later migrations land via `npm run migrate` on an existing DB.

Postgres 16 + pgvector (`CREATE EXTENSION IF NOT EXISTS vector` in 001).
All PKs are `UUID DEFAULT gen_random_uuid()` (no `pgcrypto` — see the comment
at the top of 001: the VM's pgserver build ships no contrib modules).
Timestamps are `TIMESTAMPTZ DEFAULT now()`.

### 3.1 `001_init.sql` (205 lines) — 14 tables

| Table | Key columns | Notes |
| --- | --- | --- |
| `users` | `id`, `email` UNIQUE, `full_name`, `role` CHECK `('candidate','recruiter','admin')` DEFAULT `'candidate'`, `password_hash` NULLABLE, `created_at`, `updated_at` | Role is a plain TEXT check, not an enum. |
| `companies` | `id`, `name`, `website`, `description`, `created_by` → users SET NULL | Extended by 005 (industry/size/location). |
| `jobs` | `id`, `company_id` → companies CASCADE, `title`, `description` DEFAULT `''`, `location`, `employment_type` CHECK `(full_time, part_time, contract, internship)`, `salary_min/max` INTEGER, `salary_currency` DEFAULT `'INR'`, `status` CHECK `(draft, open, closed)` DEFAULT `'open'` | |
| `candidates` | `id`, `user_id` → users SET NULL, `full_name`, `email` UNIQUE, `headline`, `github_url`, `linkedin_url`, `location`, `summary` | Extended by 004 (phone, degree, branch, graduation_year, target_roles `TEXT[]`, portfolio_url, github_handle, github_handle_exists, github_checked_at, onboarding_choice, onboarding_completed_at; unique partial index on `user_id`). |
| `resumes` | `id`, `candidate_id` CASCADE, `cloudinary_url`, `public_id`, `file_name`, `extracted_text` | 004 makes `cloudinary_url`/`public_id` nullable and adds `storage` CHECK `(cloudinary, local)` DEFAULT `'cloudinary'`, `local_path`. |
| `certificates` | `id`, `candidate_id` CASCADE, `title`, `issuer`, `issued_at` DATE, `cloudinary_url`, `public_id` | 004 adds `credential_url`. |
| `evidence_reports` | `id`, `candidate_id` CASCADE, `title`, `cloudinary_url`, `public_id` | Rows can be *recorded* by uploading a file with `kind='evidence-report'` via `POST /api/uploads` (`routes/uploads.ts:68`); but no code *generates* a report from verification data — `services/cloudinary.ts#uploadEvidenceReport` is defined and never called. |
| `skills` | `id`, `name` UNIQUE, `category` | Shared skill dictionary. |
| `candidate_skills` | `id`, `candidate_id` CASCADE, `skill_id` CASCADE, `source` CHECK `(resume, github, certificate, interview, manual)` DEFAULT `'resume'`, `confidence` NUMERIC(4,3) 0–1, UNIQUE `(candidate_id, skill_id, source)` | **Already has `source='interview'`** — assessment evidence can write here without a schema change. |
| `job_skills` | `id`, `job_id` CASCADE, `skill_id` CASCADE, `required` BOOLEAN DEFAULT TRUE, UNIQUE `(job_id, skill_id)` | |
| `embeddings` | `id`, `owner_type` CHECK `(candidate, job)`, `owner_id` UUID (no FK), `embedding vector(1536)`, `model`, UNIQUE `(owner_type, owner_id, model)` | `ivfflat (embedding vector_cosine_ops) WITH (lists = 100)`. |
| `verification_results` | `id`, `candidate_id` CASCADE, `source` CHECK `(github, coding_platform, certificate, interview)`, `source_ref` TEXT, `result` JSONB DEFAULT `'{}'`, `score` NUMERIC(5,2), `verified_at` | **Already has `source='interview'`** — assessment results can be stored here as the generic verification record. Written today only by the github-analysis worker. |
| `interviews` | `id`, `candidate_id` CASCADE, `job_id` → jobs SET NULL, `status` CHECK `(scheduled, completed, cancelled)` DEFAULT `'scheduled'`, `transcript` TEXT, `score` NUMERIC(5,2), `scheduled_at`, `created_at` | **Already exists — do NOT create a new interviews table in migration 007.** The assessment interview extends this table (add `assessment_id`, mode, etc. — see `ASSESSMENT_ARCHITECTURE.md` §6). No interview scheduling UI or route exists yet; nothing in the server writes to this table today. |
| `matches` | `id`, `candidate_id` CASCADE, `job_id` CASCADE, `score` NUMERIC(5,4) CHECK −1…1, `model`, UNIQUE `(candidate_id, job_id, model)` | Cosine score from ai-service `/match`; `NULL` in the UI means "not scored yet", never a fake score. |
| `applications` | `id`, `candidate_id` CASCADE, `job_id` CASCADE, `status` CHECK `(applied, reviewing, interview, offer, rejected, withdrawn)` DEFAULT `'applied'`, UNIQUE `(candidate_id, job_id)` | Extended by 006 (status-history table + indexes). |

### 3.2 `002_seed.sql` (57 lines) — demo data only

Idempotent (`ON CONFLICT DO NOTHING`), fixed UUIDs: 2 companies (Acme
Analytics, Northwind Labs), 2 users (demo.candidate / demo.recruiter, **no
password hashes** — they cannot log in), 2 candidates, 2 jobs, 6 skills,
candidate/job skill links. Clearly marked demo; never use as real data.

### 3.3 `003_auth.sql` (21 lines) — 1 table

| Table | Key columns |
| --- | --- |
| `password_reset_tokens` | `id`, `user_id` CASCADE, `token_hash` TEXT UNIQUE (SHA-256 of the raw token; raw token never stored/logged), `expires_at`, `used_at`, `created_at` |

Header comment states `users` already carries `password_hash` + `role`, so
no user-table change was needed.

### 3.4 `004_student.sql` (112 lines) — student profile

- `candidates` gains: `phone`, `degree`, `branch`, `graduation_year`,
  `target_roles TEXT[] NOT NULL DEFAULT '{}'`, `portfolio_url`,
  `github_handle`, `github_handle_exists BOOLEAN` (TRUE = handle exists on
  GitHub, FALSE = GitHub says no such user, NULL = GitHub unreachable —
  best-effort lookup at save time, now effectively dead: see §7),
  `github_checked_at`, `onboarding_choice` CHECK `(resume_upload,
  manual_entry)`, `onboarding_completed_at`; plus unique partial index
  `idx_candidates_user_unique ON candidates (user_id) WHERE user_id IS NOT NULL`.
- **`candidate_projects`** (new): `id`, `candidate_id` CASCADE, `title`,
  `description` DEFAULT `''`, `kind` CHECK `(repository, described)`
  DEFAULT `'described'`, `repo_url`, `role`, `technologies TEXT[] DEFAULT
  '{}'`, `started_at`/`ended_at` DATE, `created_at`, `updated_at`.
  **Already exists — 007 must not recreate it.** One-project enforcement is
  application-level (409 in the route, §7), not a DB constraint.
- **`candidate_coding_profiles`** (new): `id`, `candidate_id` CASCADE,
  `platform` CHECK `(leetcode, codeforces, codechef, hackerrank, atcoder,
  geeksforgeeks, other)`, `username`, `profile_url`,
  `verification_status` CHECK `(unverified, pending, verified, flagged)`
  DEFAULT `'unverified'`, UNIQUE `(candidate_id, platform)`. Header comment:
  status stays `'unverified'` — this phase never claims a check that did
  not happen.
- **`candidate_experience`** (new): `id`, `candidate_id` CASCADE, `title`,
  `organization`, `employment_type` CHECK `(internship, full_time,
  part_time, freelance, research, open_source)` DEFAULT `'internship'`,
  `start_date`/`end_date` DATE, `is_current` BOOLEAN DEFAULT FALSE,
  `description` DEFAULT `''`.
- `certificates.credential_url` added; `resumes` local-storage fallback
  (`storage`, `local_path`; `cloudinary_url`/`public_id` made nullable).

### 3.5 `005_recruiter.sql` (46 lines) — recruiter profile

- `companies` gains `industry`, `size` CHECK `(1-10, 11-50, 51-200,
  201-1000, 1000+)`, `location`.
- **`recruiter_profiles`** (new): `id`, `user_id` → users CASCADE, UNIQUE
  `(user_id)`, `company_id` → companies SET NULL, `job_title`, `phone`,
  `linkedin_url`. One row per recruiter; `company_id` NULL only for
  pre-existing accounts until they save a company name.

### 3.6 `006_phase6.sql` (46 lines) — pipeline history

- **`application_status_history`** (new): `id`, `application_id` CASCADE,
  `from_status`/`to_status` (same 6-value CHECK as `applications.status`),
  `changed_by` → users SET NULL, `created_at`. One row per status move,
  written by `services/applications.ts::updateApplicationStatus`.
  No backfill — pre-migration moves have no rows, and analytics reports
  "not enough data yet" instead of inventing times.
- Indexes `idx_applications_status`, `idx_applications_job_status`.

**Total tables after 001–006: 20** (14 + password_reset_tokens +
candidate_projects + candidate_coding_profiles + candidate_experience +
recruiter_profiles + application_status_history).

---

## 4. AuthN / AuthZ

### 4.1 JWT — `server/src/services/auth.ts`, `server/src/middleware/auth.ts`

- Passwords: `bcryptjs`, `hashPassword` / `verifyPassword`. (Round count is
  in the file; the login path uses a dummy hash for unknown emails so a
  login for a non-existent email costs the same bcrypt time — timing
  equalisation, `routes/auth.ts`.)
- Tokens: `jsonwebtoken`, `signAccessToken({sub, email, role})`,
  `verifyAccessToken`. Secret from `JWT_SECRET`; `getJwtSecret()` throws
  "JWT_SECRET is not set — refusing to sign a token" when empty — the server
  fails loudly rather than signing with a fallback. Lifetime
  `JWT_EXPIRES_IN`, default `1d` (`config/env.ts`).
- Roles: `users.role` ∈ `candidate | recruiter | admin`. The signup form
  speaks "student"/"recruiter"; `dbRoleForSignupRole` maps `student →
  candidate` (`services/auth.ts`). **No admin signup path exists** — an
  admin row can only be created directly in the DB.
- `requireAuth`: requires `Authorization: Bearer <token>`, verifies it,
  attaches `{sub, email, role}` to `req.user`; 401 on missing/invalid/
  expired token. `requireRole(...allowed)`: 403 unless `req.user.role` is
  in the list; must be used after `requireAuth`.
- Client: JWT lives in `localStorage` under key `gt-auth-token`
  (`client/src/lib/auth.ts`); `auth-context.tsx` validates it on load
  against `GET /api/auth/me` and discards a bad/expired token. Every
  authed client call sends `Authorization: Bearer <token>`
  (`lib/api.ts#authedRequest`, `lib/student.ts#studentRequest`).
- Password reset: `POST /api/auth/forgot-password` →
  `POST /api/auth/reset-password`; tokens are SHA-256 hashes in
  `password_reset_tokens` (003); reset link built from `FRONTEND_URL`.
  `server/README.md` warns email delivery is a stub to verify before
  relying on it — **UNVERIFIED** whether reset emails actually send.
- The Phase 0 `x-api-key` placeholder auth is **deleted** (middleware
  comment); no route uses it.

### 4.2 Route-level enforcement (verified by grep over `server/src/routes/`)

| Router (mount) | Guard | Routes |
| --- | --- | --- |
| `health` (`/health`) | none (public) | `GET /health` — DB + Redis status, 200/503 |
| `auth` (`/api/auth`) | public except noted | `POST /register`, `POST /login`, `GET /me` (auth), `POST /logout` (auth), `POST /forgot-password`, `POST /reset-password` |
| `jobs` (`/api/jobs`) | mixed | `GET /` (public, open jobs), `GET /:id` (public), `POST /` (recruiter, admin), `POST /:id/apply` (candidate), `GET /:id/applications` (recruiter, admin) |
| `applications` (`/api/applications`) | mixed | `GET /mine` (candidate), `GET /:id` (candidate, recruiter, admin), `PATCH /:id/status` (recruiter, admin) |
| `candidates` (`/api/candidates`) | **none — public** | `GET /`, `GET /:id`, `POST /` (creates a candidate row, enqueues github analysis if `github_url` given) |
| `student` (`/api/student`) | `router.use(requireAuth, requireRole("candidate"))` on all routes | see §7 |
| `recruiter` (`/api/recruiter`) | `router.use(requireAuth, requireRole("recruiter"))` on all routes | `GET/PUT /profile`, `GET /dashboard`, `GET /analytics`, `GET /applications` |
| `uploads` (`/api/uploads`) | **none — public** | `POST /` (multer, 10 MB, PDF/JPG/PNG; see §9) |

**Findings:**

1. `GET /api/candidates` and `POST /api/candidates` are **unauthenticated**
   and return full candidate rows (including emails) with a `LIMIT 100` —
   anyone can enumerate candidates and create rows not linked to a user.
   The assessment system must not build on this router; new assessment
   routes must sit behind `requireAuth` (+ `requireRole("candidate")` for
   student actions, recruiter/admin for reads of others' data).
2. `POST /api/uploads` is **unauthenticated** and accepts an arbitrary
   `candidate_id` — an unauthenticated caller can attach files to any
   candidate. Assessment file/code uploads must be authed and
   ownership-checked (the `ownRow` pattern in `routes/student.ts`).
3. `GET /api/jobs` and `GET /api/jobs/:id` are public by design (job board).
4. Ownership inside the student router is enforced per-row
   (`ownCandidate` → `getOrCreateCandidateForUser`; `ownRow(table, id,
   candidateId)`), not just by role — the assessment routes must copy
   this pattern: a candidate may only read/write their own assessment.
5. There is **no rate-limit middleware** anywhere (verified by grep for
   `rate-limit`/`express-rate-limit` — no hits). Login, register, and
   forgot-password are unthrottled. The assessment's LLM and execution
   endpoints need rate limiting before they are exposed (see
   `ASSESSMENT_ARCHITECTURE.md` §9).

---

## 5. Student + recruiter dashboards

### 5.1 Student dashboard

- Server: `GET /api/student/dashboard` (`routes/student.ts:266`) →
  `services/student.ts#loadDashboard(candidateId)`: full profile
  (`loadFullProfile`) + last 5 applications (with latest `matches.score`
  via `LEFT JOIN LATERAL`), top 5 matches by score, 5 newest open jobs,
  and counts (applications, matches, open jobs, **interviews** — counted
  from the existing `interviews` table, which is empty in practice because
  nothing writes to it yet).
- Client: `client/src/app/student/dashboard/page.tsx` (+
  `components/student/StudentShell.tsx`, `ProfileStrength.tsx`). Shows
  Profile Strength card, AI Monitoring card (summary/full), applications,
  matches, open jobs. `lib/student.ts#fetchDashboard`.
- AI Monitoring (`components/student/ProfileStrength.tsx#AiMonitoringCard`,
  derived in `lib/student.ts#aiMonitoring`): status is `live` only after
  onboarding completes, otherwise `paused`; "last checked" comes from real
  profile timestamps; findings are derived **only** from stored data
  (single project, coding profiles, certificates, resume, GitHub username,
  completeness). Explicitly no fake live feed, no invented activity, no
  fake scores. **This is the honest-monitoring pattern the assessment
  monitoring model must extend, not replace** (see architecture §8).

### 5.2 Recruiter dashboard + analytics + pipeline

- Server: `GET /api/recruiter/dashboard` (`loadRecruiterDashboard`),
  `GET /api/recruiter/analytics` (`services/analytics.ts#loadRecruiterAnalytics`,
  30-day window `ANALYTICS_WINDOW_DAYS = 30`, funnel stages, conversion
  rates, activity series), `GET /api/recruiter/applications`
  (`services/applications.ts#listRecruiterApplications` — includes
  `match_score`/`match_model` from `matches`, null when unscored).
- Pipeline: `PATCH /api/applications/:id/status` (recruiter/admin) writes
  `applications.status` + a row in `application_status_history` (006).
  Statuses: applied → reviewing → interview → offer / rejected / withdrawn.
- Client: `app/recruiter/dashboard/page.tsx`, `pipeline/page.tsx`,
  `analytics/page.tsx`, `applications/page.tsx`,
  `applications/[id]/page.tsx`, `applications/[id]/evidence/page.tsx`
  (recruiter evidence view — reads `github_verification` from the student
  profile payload, `verification_results`, skills with source, projects,
  coding profiles, certificates, resumes).
- Recruiter profile: `GET/PUT /api/recruiter/profile`
  (`services/recruiter.ts#getOrCreateRecruiterForUser`,
  `loadRecruiterProfile`); company row is created at registration from
  `company_name` (`routes/auth.ts`) and is the company profile (005).

---

## 6. Profile / project workflows (commit 6462b04 state)

### 6.1 Onboarding — 8 stages, GitHub stage REMOVED

`client/src/lib/student.ts#ONBOARDING_STAGES` (source of truth for slugs,
order, progress %):

| # | slug | label | mandatory | section | progress |
| --- | --- | --- | --- | --- | --- |
| 0 | `""` | Get started | yes | — (choice) | 0% |
| 1 | `basic-info` | Basic info | yes | `basic` | 18% |
| 2 | `projects` | Your project | yes | `projects` | 40% |
| 3 | `coding-profile` | Coding profile | no | `coding` | 60% |
| 4 | `certificates` | Certificates | no | `certificates` | 78% |
| 5 | `experience` | Experience | no | `experience` | 90% |
| 6 | `review` | Review & submit | yes | — | 100% |
| 7 | `complete` | Profile Complete | yes | — | 100% |

- Choice stage: `POST /api/student/onboarding/choice`
  (`resume_upload` | `manual_entry`) — stored in
  `candidates.onboarding_choice`. Resume-upload does **not** auto-fill
  stages yet (onboarding page says so explicitly; parsing runs in the
  background only when Cloudinary is configured).
- `POST /api/student/profile/complete`: requires mandatory sections done,
  else 400 listing what is missing; idempotent
  (`onboarding_completed_at = COALESCE(..., now())`).
- Client pages: `app/student/onboarding/page.tsx` (choice),
  `app/student/onboarding/[stage]/page.tsx` (all stages),
  `components/student/OnboardingShell.tsx` (stepper).

### 6.2 Completeness / Profile Strength — server-computed, never stored

`services/student.ts#computeCompleteness` + `SECTION_WEIGHTS`:

| Section | Weight | Done when |
| --- | --- | --- |
| `basic` | 35 | headline + location + summary + degree + branch + graduation_year + ≥1 target role + ≥1 skill |
| `projects` | 35 | ≥1 project row |
| `coding` | 10 | ≥1 coding profile |
| `certificates` | 5 | ≥1 certificate |
| `experience` | 15 | ≥1 experience row |
| **Total** | **100** | Mandatory-only (basic + projects) = **70%** |

GitHub used to hold 25 points; 6462b04 removed it and redistributed
+10 basic, +10 projects, +5 experience. `MANDATORY_SECTIONS =
["basic", "projects"]`. Completeness is computed on every read
(`loadFullProfile`), so it can never drift from the data.
Client: `ProfileStrengthCard` in `components/student/ProfileStrength.tsx`
renders `profile.completeness.percent` + "Improve your profile" items
(`lib/student.ts#improveProfileItems`, per-section points + deep link).
The same card appears on the Profile Complete screen, student dashboard,
and profile page.

### 6.3 Projects — exactly ONE per student

- DB: `candidate_projects` (004) has **no** one-row constraint.
- Enforcement is in the route: `routes/student.ts#registerCrud` for
  `candidate_projects` sets `maxOne: true`; `POST /api/student/projects`
  returns **409** "You can add only one project — edit or replace your
  existing project instead of adding another" when a row already exists.
- CRUD: `POST /api/student/projects`, `PUT /api/student/projects/:id`,
  `DELETE /api/student/projects/:id` (all ownership-checked via `ownRow`).
  `kind` is `repository` (has `repo_url`) or `described`; `technologies`
  is a `TEXT[]`; dates are `YYYY-MM-DD` strings validated by zod.
- **Assessment implication:** the assessed project is unambiguous — it is
  the student's single `candidate_projects` row. Challenge generation and
  repo analysis take that row (and its `repo_url` when `kind =
  'repository'`) as input. If a student replaces their project after an
  assessment has started, the assessment must keep pointing at the
  project row/id it was generated from, not "the current project".

### 6.4 GitHub — plain optional text field, NO verification (6462b04)

- `PUT /api/student/profile/github` (`routes/student.ts:222`): accepts
  `github_handle` (≤100 chars) or `github_url`; `parseGithubHandle`
  extracts the handle; stores `github_handle` + canonical
  `https://github.com/<handle>` and **sets `github_handle_exists = NULL`
  and `github_checked_at = NULL`** — explicitly no check. Route comment:
  "NO verification: the handle is never checked against GitHub, never
  shows a verification badge for this field." Clearing the field nulls
  all four columns.
- The `github_handle_exists` / `github_checked_at` columns (004) and the
  `parseGithubHandle` helper still exist but are **write-only dead state**
  under this route — nothing sets them to a non-NULL value any more.
- `services/student.ts#loadFullProfile` still returns a
  `github_verification` object, but it is derived **only** from
  `verification_results` rows with `source='github'` (latest row by
  `verified_at`), i.e. from the repo-analysis worker — never from the
  handle field. The recruiter evidence view reads it.
- **Assessment implication:** GitHub verification is currently *absent*
  as a product behaviour; the assessment system is what re-introduces
  real verification — via repo analysis of the selected project plus
  live challenges — and must not resurrect the removed onboarding stage
  or badge the bare handle field.

### 6.5 Other student resources

Generic CRUD (`registerCrud` in `routes/student.ts`) for
`candidate_coding_profiles` (`/coding-profiles`),
`certificates` (`/certificates`), `candidate_experience` (`/experience`).
Resume: `POST /api/student/resume` (multer; Cloudinary when configured,
else local disk under `server/uploads/` with `storage='local'`;
`resumes.local_path`), `GET /api/student/resume/:id/file` (serves local
files with JWT, Cloudinary URLs redirect). Resume upload enqueues
`llm-parsing` when Cloudinary is configured (see §8).
Profile: `GET /api/student/profile` (full profile + completeness + GitHub
verification + verification_results + evidence reports),
`PUT /api/student/profile` (basic info + skills replaced wholesale,
`source='manual'`).

---

## 7. GitHub integration (as it exists today)

| Piece | File | Behaviour |
| --- | --- | --- |
| Enqueue | `server/src/queues/jobs.ts#enqueueGithubAnalysis` | `github-analysis` queue, job name `analyze`, payload `{repoUrl, candidateId}` |
| Worker | `server/src/workers/githubAnalysis.ts` | calls `aiService.analyzeRepo`, inserts `verification_results (candidate_id, source='github', source_ref=repoUrl, result=<JSON>)`. **No `score` is written** (score stays NULL). No dedup: every run inserts a new row. |
| AI endpoint | `ai-service/app/routers/analyze.py` → `POST /analyze-repo` | `git clone --depth 1` into a temp dir (120 s timeout), counts files + language breakdown by extension (`EXT_TO_LANG`, ~25 extensions, rest → "Other", ignores `.git/node_modules/__pycache__/.venv/venv/dist/build`), `rev-parse --abbrev-ref HEAD`, `rev-list --count HEAD` (depth-1 clone, so commit count is 1 in practice). Private/unreachable repo → HTTP 502 with stderr (first 300 chars). Response: `{repo_url, languages, file_count, commit_count, default_branch}`. |
| Trigger sites | `server/src/routes/candidates.ts` (public `POST /api/candidates` with `github_url`) | **This is the only live trigger.** Onboarding does not trigger it; the student profile GitHub field does not trigger it. |
| Client | none | No client code calls github analysis or shows its progress. |

**What is missing for assessment purposes:** no commit-history analysis
(depth-1 clone), no author/ownership check (is this *their* code?), no
code-quality or test signal, no score, no dedup/re-run policy, no private
repo support (no GitHub token anywhere — `GITHUB_API_TOKEN` / `GITHUB_TOKEN`
do not exist in any `.env.example` or config file).

---

## 8. AI / LLM integrations (as they exist today)

### 8.1 ai-service endpoints (`ai-service/app/main.py`, FastAPI)

| Endpoint | Router | Behaviour |
| --- | --- | --- |
| `GET /health` | `main.py` | `{status: ok\|degraded, service, postgres: ok\|unreachable}` — DB ping only |
| `POST /embed` | `routers/embed.py` | `embed_text(text)` → 1536-dim vector + `model` label. Body: `{text (1–20000 chars), owner_type, owner_id}` (owner fields are accepted but not used by the endpoint itself). |
| `POST /parse-resume` | `routers/parse.py` | Downloads file from `cloudinary_url` (`cloudinary_client.download`), extracts text with `pypdf` (falls back to UTF-8 decode), keyword-matches `KNOWN_SKILLS` (~40 skills, case-insensitive substring) in `embeddings.py#detect_skills`. Returns `{text, skills, char_count}`. No LLM involved. |
| `POST /analyze-repo` | `routers/analyze.py` | See §7. No LLM involved. |
| `POST /match` | `routers/match.py` | Loads both `embeddings` rows from Postgres, cosine similarity; **503 with an honest message if either embedding is missing** — never a fabricated score. Returns `{candidate_id, job_id, score, model}` (model = the candidate embedding's model). |

### 8.2 Embeddings + the local-hash fallback

`ai-service/app/embeddings.py`: if `OPENAI_API_KEY` is set, calls
`https://api.openai.com/v1/embeddings` with `text-embedding-3-small` via
raw `httpx` (30 s timeout); on failure it **raises** — it never silently
falls back. If no key is set, returns a deterministic local-hash embedding
(`model="local-hash-dev-only"`), SHA-256 n-gram bucketing, L2-normalised.
The label travels with every vector (stored in `embeddings.model`), so a
dev vector can never be mistaken for a real one. The fallback is dev-only
and "must never drive production matching" (module docstring + READMEs).

### 8.3 Server ↔ ai-service client

`server/src/services/aiService.ts`: thin `fetch` wrapper (`post<T>`,
throws `ai-service <path> failed (<status>)` with first 300 chars of the
body). Functions: `embedText`, `parseResume`, `analyzeRepo`,
`matchCandidateToJob`. Base URL `AI_SERVICE_URL` (default
`http://localhost:8000`). No auth between server and ai-service, no
timeout on the fetch (relies on downstream timeouts), no retries (BullMQ
retries at the job level instead).

### 8.4 BullMQ workers (`server/src/workers/`, run inside the server process)

Started from `src/index.ts`; `workers/index.ts` comment says Phase 1
splits them into standalone processes (not done yet). Queues
(`queues/index.ts`): `github-analysis` (concurrency 5), `llm-parsing`
(concurrency 3), `vector-reembedding` (concurrency 5); default job
options attempts 3, exponential backoff 2s → 4s → 8s,
`removeOnComplete/removeOnFail: {count: 100}`. Redis via shared ioredis
connection (`config/queue.ts`, `maxRetriesPerRequest: null`); `pingRedis`
races the ping against a 2 s timeout so `/health` never hangs.
Workers: `githubAnalysis` (§7); `llmParsing` — parse resume → store `extracted_text`, upsert skills
(`source='resume'`). Its header comment claims the candidate is then
queued for re-embedding, but the code contains **no**
`enqueueReembedding` call — the only live re-embedding enqueue is in
`routes/jobs.ts` (for a newly created job). Candidate re-embedding after
resume parsing therefore does not happen today, which means a candidate's
embedding can go stale after a resume upload; the assessment's
verification flow must not assume `embeddings` is fresh.
`vectorReembedding` — builds text from candidate headline+summary+skills
or job title+description+skills,
embeds, upserts `embeddings` with `ON CONFLICT (owner_type, owner_id,
model) DO UPDATE`. All enqueue helpers return the BullMQ job so routes
can reply 202 + jobId.

### 8.5 What "LLM" means in this repo today

**There is no chat/completion LLM call anywhere.** The only OpenAI usage
is the embeddings endpoint. Resume "parsing" is pypdf + keyword matching,
repo "analysis" is `git clone` + file counting, matching is cosine
similarity. Any assessment feature that needs generation, rubric scoring,
or interview dialogue (challenge generation, evaluation, interview
questions) needs a **new** LLM client — see `ASSESSMENT_ARCHITECTURE.md`
§7. `OPENAI_API_KEY` is the only LLM-related env var that exists today,
and it is optional everywhere.

---

## 9. Uploads + object storage

- `POST /api/uploads` (`routes/uploads.ts`): multer memory storage, 10 MB
  limit, mimetypes PDF/JPEG/PNG only; `kind` ∈ `resume | certificate |
  evidence-report` → Cloudinary folders `groundtruth/resumes`,
  `groundtruth/certificates`, `groundtruth/evidence-reports`
  (`config/cloudinary.ts#CLOUDINARY_FOLDERS`). Resume + `candidate_id`
  inserts a `resumes` row and enqueues `llm-parsing` (202 + jobId).
  **Public route — see §4.2.**
- `POST /api/student/resume` is the authed student path (Cloudinary or
  local-disk fallback; local files under `server/uploads/`, gitignored).
- `services/cloudinary.ts`: `uploadBuffer`, `uploadEvidenceReport`;
  `cloudinaryConfigured()` gates on all three env vars being set.
- ai-service has its own `cloudinary_client.py` (`download` used by
  `/parse-resume`).

---

## 10. Deployment config + environment variables

### 10.1 What exists

- `docker-compose.yml`: 5 services — `postgres` (`pgvector/pgvector:pg16`,
  port 5432, volumes `pgdata` + `./infra/postgres:/docker-entrypoint-initdb.d:ro`,
  healthcheck `pg_isready`), `redis` (`redis:7-alpine`, 6379), `ai-service`
  (build `./ai-service`, 8000, depends on healthy postgres+redis),
  `server` (build `./server`, 4000, depends on postgres+redis+ai-service),
  `client` (build `./client`, 3000, depends on server). Env from `.env`
  (`required: false`) + inline defaults. `NEXT_PUBLIC_API_URL` defaults
  to `http://localhost:4000` inside compose.
- Dockerfiles: `server` (node:20-alpine, 3-stage, `node dist/index.js`),
  `client` (node:20-alpine, Next standalone, `node server.js`),
  `ai-service` (python:3.12-slim, `git` installed for repo cloning,
  `uvicorn app.main:app --host 0.0.0.0 --port 8000`).
- CI: `.github/workflows/ci.yml` — 3 jobs on push/PR to `main`:
  `node` (setup-node 20, `npm ci`, typecheck server+client, `npm run lint
  --if-present`), `python` (setup-python 3.12, `pip install -r
  ai-service/requirements.txt`, `pytest ai-service/tests -q`), `infra`
  (compose config validation if docker exists, else skip; SQL sanity:
  asserts `vector` extension + 14 tables in 001 + `vector(1536)` +
  `ivfflat` + idempotent seed). **CI does not run `npm test` (server
  tests), does not build any image, does not deploy.**
- `Makefile`: `up/down/logs/ps/install/dev/typecheck/test` — `test` runs
  **only** ai-service pytest, not the server suite.
- **No `render.yaml`.** No Render service definition of any kind in the
  repo. The task brief states the live deployment is a **Render client
  service only** (no server service live); that is consistent with the
  repo (the client calls `NEXT_PUBLIC_API_URL`, default localhost:4000,
  so a client-only deploy cannot reach a server). No deployment docs
  exist in the repo; nothing here verifies live Render state.

### 10.2 Environment variable inventory (read from the four `.env.example` files + `config/env.ts` + `ai-service/app/config.py`)

| Variable | Where | Default / required |
| --- | --- | --- |
| `DATABASE_URL` | root, server, ai-service; `server/config/env.ts`, `ai-service/config.py` | `postgres://groundtruth:groundtruth_dev@localhost:5432/groundtruth` |
| `POSTGRES_USER` / `POSTGRES_PASSWORD` / `POSTGRES_DB` | root, compose | `groundtruth` / `groundtruth_dev` / `groundtruth` |
| `REDIS_URL` | root, server | `redis://localhost:6379` |
| `PORT` | root, server | 4000 |
| `AI_SERVICE_PORT` | root, ai-service | 8000 |
| `CLIENT_PORT` | root | 3000 |
| `AI_SERVICE_URL` | root, server | `http://localhost:8000` |
| `NEXT_PUBLIC_API_URL` | root, client | `http://localhost:4000` |
| `JWT_SECRET` | root, server | **none — required in production; server refuses to sign without it** |
| `JWT_EXPIRES_IN` | server | `1d` |
| `FRONTEND_URL` | server | `http://localhost:3000` (password-reset links) |
| `API_KEY` | root only | Phase 0 placeholder; **dead** — no code reads it |
| `OPENAI_API_KEY` | root, ai-service | optional; unset → local-hash fallback |
| `CLOUDINARY_CLOUD_NAME` / `CLOUDINARY_API_KEY` / `CLOUDINARY_API_SECRET` | root, server, ai-service | all three required for `cloudinaryConfigured()`; uploads fall back (student resume → local disk) when unset |
| `CORS_ORIGINS` | ai-service | `http://localhost:3000` |
| `NODE_ENV` | server (read in `env.ts`, default `development`) | — |

New assessment variables added by this task are documented in §3 of
`ASSESSMENT_ARCHITECTURE.md` and in the updated `.env.example` files
(see §12.4 of this audit — they are additions, not pre-existing).

---

## 11. Verification functionality — what exists, and what the assessment system must replace / extend

Current verification is **evidence collection, not verification**:

| Signal | Source of truth | Real check? |
| --- | --- | --- |
| Resume text + skills | `resumes.extracted_text`, `candidate_skills source='resume'` | Text extraction is real; "skills" are substring keyword matches against a ~40-word list — weak evidence, easily gamed. |
| Repo stats | `verification_results source='github'` | File/language/commit counts from a depth-1 clone are real but say nothing about authorship, quality, or whether the student wrote it. No score is stored. |
| Coding profiles | `candidate_coding_profiles` | User-entered only; `verification_status` is always `'unverified'` by design. |
| Certificates | `certificates` (+ `credential_url`) | Title/issuer/date/link as typed by the student; no issuer check. |
| Interview | `interviews` table | Schema only — nothing writes or reads it. |
| Matches | `matches` | Cosine similarity of embeddings; a relevance signal, not a verification signal. |
| Evidence reports | `evidence_reports` | Rows exist only for files a human uploaded with `kind='evidence-report'`; nothing composes a report from verification data (`uploadEvidenceReport` is defined, never called). |
| Profile completeness | computed `completeness.percent` | Real (derived from filled sections) but measures *completeness*, not *truth*. A complete profile can still be fabricated. |

**What the assessment system must replace:**

- The removed GitHub onboarding stage must **not** come back as a
  checkbox/badge on a handle. Real repo verification belongs in the
  assessment: clone the selected project's repo, analyse it, and then
  *test the student's knowledge of it* with generated challenges.
- Keyword skill detection (`detect_skills`) must not be presented as a
  skill proof. Assessment evidence (`source='interview'`) is the upgrade
  path — the `candidate_skills` CHECK already allows it.

**What it must extend (reuse, do not rebuild):**

- `verification_results` (`source='interview'`, `result` JSONB, `score`)
  as the generic verification record for assessment outcomes.
- `interviews` (add `assessment_id` etc. — do not create a second table).
- `candidate_skills` with `source='interview'` for skills proven live.
- `candidate_projects` (single selected project) as the assessment input.
- `ProfileStrength` / completeness as the *pre-assessment* gate (a
  student should finish onboarding before starting an assessment), and
  the AI Monitoring card as the surface where assessment status is shown.
- BullMQ queues + `202 + jobId` async pattern for challenge generation,
  execution, and evaluation.
- ai-service as the place where LLM calls live (new routers), keeping the
  Express server a thin orchestrator — the same split as embed/parse/
  analyze/match today.

---

## 12. Gaps / risks

### 12.1 Blocking for the assessment build

1. **No live server.** Only a Render client service is live; there is no
   server service and no `render.yaml`. Nothing assessment-related can be
   demoed live until a server (+ Postgres + Redis + ai-service) is
   deployed or run locally. Local dev needs Docker (compose) or manual
   Postgres/Redis.
2. **No Docker in this VM** (`docker: command not found`, verified
   2026-11-18). `docker-compose.yml` and `make up` cannot run here; the
   Makefile `test` target and CI's compose validation degrade gracefully,
   but any assessment work that needs Postgres/Redis/Docker must run
   elsewhere or against a manually-provisioned DB. The sandbox design in
   `ASSESSMENT_ARCHITECTURE.md` §8 deliberately avoids Docker for this
   reason (verified `unshare` alternative — see §12.5).
3. **No code-execution capability at all.** No sandbox, no runner, no
   `ws`, no Monaco editor, no terminal component. Live Lab is a
   from-scratch build; the editor starts as a plain textarea (Monaco is a
   later, optional addition — it is a large dependency and must not be
   pulled in unreviewed).
4. **No LLM client.** No chat/completion call exists; the only OpenAI
   usage is embeddings via raw `httpx`. Challenge generation, rubric
   evaluation, and interview dialogue all need the new client
   (architecture §7), including a mock provider so tests run without a
   key or network.
5. **No rate limiting.** Any LLM-backed or execution endpoint is an
   abuse/cost vector from day one without it.
6. **No migration-state tracking.** `migrate.ts` re-runs every `*.sql`
   file on every invocation; idempotency is by convention only. A bad
   007 (e.g. a non-idempotent statement) would fail or double-apply on
   re-run. 007 must be written idempotent and tested by running
   `migrate.ts` twice.

### 12.2 Correctness / security risks already in the repo

7. **Public candidate + upload routes** (§4.2): unauthenticated
   `GET/POST /api/candidates` (enumerates emails) and `POST /api/uploads`
   (arbitrary `candidate_id`). Pre-existing; assessment routes must not
   copy this pattern.
8. **JWT in `localStorage`** (`gt-auth-token`): XSS-reachable by design;
   accepted pattern for this codebase, but assessment code must not add
   new secrets to client storage, and must not put tokens in URLs.
9. **Inline JWT secret in `server/package.json` test script.** The `test`
   script sets `JWT_SECRET` to a fixed literal value committed in the
   repo (value redacted here — it is visible in the file). It is only a
   test secret, but it is committed, and anyone who copies it into a
   deployed env would share a signing key with the whole internet. Use a
   generated secret in production; consider moving the test secret to an
   env file that CI sets.
10. **No server↔ai-service auth.** `ai-service` trusts any caller that can
    reach it; it relies on network placement (compose private network).
    If ai-service is ever exposed publicly, its endpoints (including
    `/analyze-repo`, which clones arbitrary URLs) become an SSRF / clone-
    anything vector. The assessment's LLM endpoints inherit this exposure
    unless the service stays private or gains a shared secret.
11. **`/analyze-repo` clones arbitrary URLs** with a 120 s timeout and no
    size limit; a large repo can exhaust disk/time in the ai-service
    container. The assessment repo-analysis step needs a size/time cap.
12. **`express.json({limit: "1mb"})`** in `index.ts` — code submissions
    and transcripts must fit under this or the limit must be raised
    deliberately for the submission route only.
13. **CORS is wide open on the server** (`app.use(cors())` with no origin
    list in `index.ts`); ai-service restricts origins via `CORS_ORIGINS`
    but the server does not. Assessment routes inherit this.
14. **No request logging / audit trail** beyond `console.*`; the only
    audit-like table is `application_status_history` (status moves only).
    Monitoring events (architecture §8) are the assessment's audit trail
    and must be designed as one from the start.

### 12.3 Tests — what exists

- Server: 6 files, `node:test` + `node:assert/strict`, run by
  `npm test` = inline-`JWT_SECRET` + `NODE_ENV=production` +
  `JWT_EXPIRES_IN=1d` + `tsx --test tests/*.test.ts`:
  `auth.test.ts` (11 tests, pure auth primitives + middleware with
  mocked req/res/next, no DB/Redis), `student.test.ts` (7),
  `recruiter.test.ts` (6), `applications.test.ts` (3),
  `analytics.test.ts` (4), `auth.db.test.ts` (2).
  **CI does not run `npm test`.** `Makefile test` does not run it either
  (pytest only). So the server suite is effectively unrunnable in CI —
  the assessment plan (architecture §11) adds it to CI.
- ai-service: `tests/test_health.py` (4 tests: health ok/degraded,
  embed returns local-hash fallback without a key, hash embedding
  deterministic + normalised, empty text → 422). Run by pytest, in CI.
- Client: **no tests at all.**

### 12.4 Env files updated by this task

`.env.example` (root), `server/.env.example`, `ai-service/.env.example`
each gained the same nine assessment variables (comments, no real
values, no secrets): `AI_API_BASE_URL`, `AI_API_KEY`, `AI_MODEL`,
`AI_TEMPERATURE`, `AI_MAX_TOKENS`, `AI_MOCK`, `EXECUTION_SANDBOX`,
`EXECUTION_TIMEOUT_SECONDS`, `MONITORING_RETENTION_DAYS`.
`client/.env.example` was **not** changed — it carries only the public
`NEXT_PUBLIC_API_URL` and assessment config is server-side only.

### 12.5 Sandbox verification (done in this VM, 2026-11-18)

- `unshare -U -r -n sh -c 'echo ok'` → `ok`; inside the namespace
  `id` reports `uid=0(root)` (mapped root; unprivileged outside).
- `unshare -U -r -n -m -p -f sh -c ...` → namespaces created, `mount -t
  tmpfs none /tmp` succeeds, `python3 -c "print(1+1)"` runs inside.
- Network namespace contains **only** `lo` in state DOWN — no external
  interface, so code inside cannot reach the network (verified by
  `ip link` output).
- `/proc/sys/kernel/unprivileged_userns_clone` = `1` (unprivileged user
  namespaces enabled).
- `docker` is **not installed** (`command not found`); VM has Node
  v24.22.1 and Python 3.12.3.
- Conclusion: **`unshare` user+net+mount+pid namespaces are a viable
  sandbox primitive in this environment; Docker is not available.**
  The architecture (§8) designs around `unshare` + `timeout`/`prlimit`
  + tmpfs workdir, with `EXECUTION_SANDBOX=disabled` as the safe
  fallback. The sandbox itself is still to be built and load-tested —
  this verification proves the primitive works, not that a production
  sandbox is ready.

---

## 13. Files not read / not verified

- **Nothing in the repo was left unread** except: `package-lock.json`
  (dependency lockfile — versions in §2 were taken from `package.json`,
  not the lockfile), `client/tsconfig.tsbuildinfo` (build artefact),
  `client/next-env.d.ts` (generated), and the full bodies of
  `client/src/app/*` page components beyond the route/file inventory
  (their existence and exports were listed; per-page copy was not
  audited line-by-line). `README.md` / `server/README.md` /
  `client/README.md` / `ai-service/README.md` were read in full.
- **Not verified in this VM:** live Render state (no access claimed; the
  "client service only, no server" statement comes from the task brief,
  not from this repo); whether password-reset emails actually send
  (`server/README.md` flags it as unverified); whether Postgres/Redis
  run locally (no Docker in this VM, so `migrate.ts` and the test suites
  were **not executed** here — test counts in §12.3 are from reading the
  files); Cloudinary behaviour (no keys in this VM).
- **One file the task brief mentions that does not exist here:**
  `docs/ARCHITECTURE.md` and `docs/PHASE_ZERO.md` exist and were read;
  there is no `docs/` file describing Phases 1–6 beyond the migration
  headers themselves — phase history was reconstructed from the SQL
  headers and `git log` (HEAD 6462b04; earlier history is a single
  squashed-looking chain in this shallow clone — `git log` shows the
  6462b04 commit on top; full history was not available at `--depth 1`).
