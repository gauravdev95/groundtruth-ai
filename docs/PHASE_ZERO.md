# Phase 0 — Checklist

Phase 0 initialises the repository, the database, the async queue, and object
storage. All four deliverables are in place; each item points at the files
that implement it.

## 1. Repository & monorepo structure

- [x] Root: `README.md`, `.gitignore`, `.env.example`, `docker-compose.yml`,
      `package.json` (npm workspaces: `client`, `server`), `Makefile`
- [x] `client/` — Next.js 14 App Router + React 18 + TypeScript
      (`package.json`, `tsconfig.json`, `next.config.mjs`, `next-env.d.ts`,
      `.env.example`, `Dockerfile`, `README.md`,
      `src/app/layout.tsx`, `src/app/page.tsx`, `src/app/globals.css`,
      `src/app/jobs/page.tsx`, `src/lib/api.ts`)
- [x] `server/` — Node.js 20 + Express + TypeScript
      (`package.json`, `tsconfig.json`, `.env.example`, `Dockerfile`,
      `README.md`, `src/index.ts`, `src/config/{env,db,queue,cloudinary}.ts`,
      `src/middleware/{errorHandler,auth}.ts`,
      `src/routes/{health,jobs,candidates,uploads}.ts`,
      `src/queues/{index,jobs}.ts`,
      `src/workers/{index,githubAnalysis,llmParsing,vectorReembedding}.ts`,
      `src/services/{cloudinary,aiService}.ts`)
- [x] `ai-service/` — Python 3.12 + FastAPI
      (`pyproject.toml`, `requirements.txt`, `.env.example`, `Dockerfile`,
      `README.md`, `app/{__init__,main,config,db,schemas,embeddings,
      cloudinary_client}.py`, `app/routers/{__init__,embed,parse,analyze,
      match}.py`, `tests/test_health.py`)
- [x] CI: `.github/workflows/ci.yml`

## 2. Database & vector store initialisation

- [x] `infra/postgres/001_init.sql` — `CREATE EXTENSION IF NOT EXISTS vector;`
      plus tables: users, companies, jobs, candidates, resumes, certificates,
      evidence_reports, skills, candidate_skills, job_skills, embeddings
      (`vector(1536)` + ivfflat index), verification_results, interviews,
      matches, applications. uuid PKs, timestamptz, FKs + indexes.
- [x] `infra/postgres/002_seed.sql` — 2 demo companies, 2 jobs, 2 candidates,
      demo skills; idempotent (`ON CONFLICT DO NOTHING`).

## 3. Async queue & caching setup

- [x] Redis 7 in `docker-compose.yml` (healthcheck: `redis-cli ping`).
- [x] BullMQ queues `github-analysis`, `llm-parsing`, `vector-reembedding`
      (`server/src/queues/index.ts`, attempts=3, exponential backoff).
- [x] Enqueue helpers (`server/src/queues/jobs.ts`):
      `enqueueGithubAnalysis`, `enqueueResumeParsing`, `enqueueReembedding`.
- [x] Workers (`server/src/workers/`) with concurrency 5 / 3 / 5,
      started from `src/index.ts` alongside the HTTP server (Phase 0 only;
      split out in Phase 1). Routes return 202 + `jobId`; UI never blocks.

## 4. Object storage configuration

- [x] Cloudinary config from env only (`CLOUDINARY_CLOUD_NAME`,
      `CLOUDINARY_API_KEY`, `CLOUDINARY_API_SECRET`) —
      `server/src/config/cloudinary.ts`, `ai-service/app/cloudinary_client.py`.
- [x] Folders: `groundtruth/resumes`, `groundtruth/certificates`,
      `groundtruth/evidence-reports`.
- [x] Upload route `POST /api/uploads` (multer memory storage, 10 MB limit,
      PDF/JPG/PNG only, `kind` → folder mapping) — `src/routes/uploads.ts`.
- [x] Evidence-report helper uploading a generated PDF buffer —
      `src/services/cloudinary.ts` (`uploadEvidenceReport`).

## Out of scope for Phase 0

Real auth (placeholder API-key check only), production embeddings
(local-hash dev fallback only), standalone workers, frontend dashboards.
