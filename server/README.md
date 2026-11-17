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
- `POST /api/auth/register` — student or recruiter signup (role
  `student` | `recruiter`; recruiters also send `company_name`, which creates
  their company). Returns `{ user, token }` (JWT, 1 day by default).
- `POST /api/auth/login` — email + password → `{ user, token }`.
- `GET /api/auth/me` — current user from the `Bearer` token.
- `POST /api/auth/logout` — stateless JWT: the client discards the token.
- `POST /api/auth/forgot-password` — issues a 30-minute, single-use reset
  token (SHA-256 hashed in `password_reset_tokens`). Always returns the same
  generic message; in development only it also returns `resetUrl`, because
  no mail sender is configured yet — wire SMTP and remove the dev-only
  return before relying on email delivery.
- `POST /api/auth/reset-password` — `{ token, new_password }`, consumes the
  token and sets the new password.
- `GET /api/jobs` / `GET /api/jobs/:id` / `POST /api/jobs` — jobs (Zod-validated).
  `POST /api/jobs` is recruiter/admin only (JWT + role guard).
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

Phase 1 (real auth, JWT + bcrypt):

- `src/services/auth.ts` — password hashing, JWT sign/verify, reset-token
  generation (raw token shown once, only its SHA-256 stored).
- `src/middleware/auth.ts` — `requireAuth` (Bearer JWT) and
  `requireRole(...)` role guard. The Phase 0 `x-api-key` placeholder is
  deleted; nothing used it.
- `src/routes/auth.ts` — register / login / me / logout / forgot-password /
  reset-password (see Endpoints above). Password policy: ≥8 chars, upper +
  lower + digit + special. Roles are stored on `users.role`
  (`candidate` | `recruiter` | `admin`); the signup form calls the
  `candidate` role "Student".
- `infra/postgres/003_auth.sql` — `password_reset_tokens` table. Apply with
  `npm run migrate` (runs every `infra/postgres/*.sql` in order against
  `DATABASE_URL`); docker-compose only applies migrations on first DB init.
- `JWT_SECRET` is required in production — the server refuses to sign tokens
  without one. `JWT_EXPIRES_IN` (default `1d`), `FRONTEND_URL` (reset links,
  default `http://localhost:3000`).
- Tests: `npm test` — unit tests for hashing/JWT/reset tokens/middleware,
  plus a DB test that runs against `DATABASE_URL` when Postgres is reachable
  and skips otherwise.

Known gaps (Phase 1, stated plainly): no mail sender, so reset links are
only returned in development responses; no refresh-token rotation (access
JWT is 1 day); no Google OAuth (the old repo had it); no token denylist, so
logout is client-side token discard.
