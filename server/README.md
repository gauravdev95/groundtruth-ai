# Ground Truth AI — server

Node.js 20 + Express + TypeScript API. Owns the REST API, the Postgres
connection, the BullMQ queues, and (in Phase 0) the BullMQ workers.

## Run

```bash
cp .env.example .env
npm install
npm run dev        # tsx watch src/index.ts — http://localhost:4000
npm run typecheck
```

## Endpoints

- `GET /health` — status of the API plus `postgres` and `redis` pings.
- `GET /api/jobs` / `GET /api/jobs/:id` / `POST /api/jobs` — jobs (Zod-validated).
- `GET /api/candidates` / `GET /api/candidates/:id` / `POST /api/candidates`
- `POST /api/uploads` — multipart upload (`file` + `kind` in
  `resume | certificate | evidence-report`), 10 MB max, PDF/JPG/PNG only.
  Returns `secure_url` + `public_id` and a 202 `jobId` for background work.

All upload/job creation routes only enqueue background work and return 202
with a `jobId` — heavy work (GitHub analysis, LLM parsing, re-embedding)
runs in BullMQ workers, so the UI never blocks.

## Queues

`github-analysis` (concurrency 5), `llm-parsing` (3), `vector-reembedding`
(5). Defined in `src/queues/`, workers in `src/workers/`. In Phase 0 the
workers run in this same process (`src/index.ts` starts them); they split
into standalone worker processes in Phase 1.

## Auth

Phase 0 only: a placeholder API-key check (`src/middleware/auth.ts`),
clearly marked. Real JWT/OAuth auth is Phase 1.
