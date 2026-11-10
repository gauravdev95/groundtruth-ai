# Ground Truth AI

**Hire on proof, not promises.**

Ground Truth AI is an AI-verified talent marketplace. Candidate skills are backed
by real evidence — GitHub activity, coding-platform performance, certificates,
and code-grounded interviews — and candidates are matched to jobs two-way on
dense vector embeddings.

> **Phase 0** — repository & infrastructure scaffolding. See
> [`docs/PHASE_ZERO.md`](docs/PHASE_ZERO.md) for the checklist and
> [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) for the design.

## Architecture

```
                         ┌──────────────────────┐
                         │  client (Next.js)    │  :3000
                         │  landing + jobs list │
                         └──────────┬───────────┘
                                    │ REST /api/*
                         ┌──────────▼───────────┐
                         │  server (Node/   │  :4000
                         │  Express + TS)       │
                         │  routes · queues     │
                         │  (BullMQ workers     │
                         │   co-located, P0)    │
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
console; `OPENAI_API_KEY` is optional in Phase 0 — without it, ai-service uses
a deterministic local-hash dev embedding (`model="local-hash-dev-only"`),
which is **not** suitable for production matching.

## Phase 0 scope

- ✅ Monorepo: `client/` + `server/` + `ai-service/` (npm workspaces)
- ✅ PostgreSQL + pgvector schema (`infra/postgres/001_init.sql`) + demo seed
- ✅ Redis + BullMQ queues: `github-analysis`, `llm-parsing`, `vector-reembedding`
- ✅ Cloudinary config + upload route + evidence-report helper
- ✅ CI (typecheck, pytest, compose + SQL validation)

## What is NOT done yet

- **No real auth** — server has only a placeholder API-key check
  (`src/middleware/auth.ts`), clearly marked. Real auth (JWT/OAuth) is Phase 1.
- **No production embedding key** — the local-hash fallback is dev-only.
- **Workers co-located** — BullMQ workers run inside the server process
  in Phase 0 (`src/index.ts`); they split into standalone worker processes
  in Phase 1.
- No frontend auth, dashboards, or interview UI yet; the client is a landing
  page + jobs list.
- No vector re-embedding on a schedule; embeddings are created on demand.
