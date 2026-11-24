# GroundTruth AI — Database Migration Guide

**Repo:** `gauravdev95/groundtruth-ai` · **Database:** PostgreSQL 16 + pgvector
**Last verified:** 23 Nov 2026 (local, commit `019c0e2`) — see §6 for genuine results.
**Rule 0:** never drop a production table, never reset the production database,
never overwrite production data. Migrations are additive and idempotent only.

## 1. How migrations run

- Files live in `infra/postgres/` and are applied **in filename order** by
  `server/src/scripts/migrate.ts` (`npm run migrate` from `server/`):

  | File | Contents |
  | --- | --- |
  | `000_preflight.sql` | Repair for a database that already holds the OLD repo's Alembic schema (see §2). No-op on a fresh DB. |
  | `001_init.sql` | Phase 0 schema: users, companies, jobs, candidates, resumes, certificates, evidence_reports, skills, candidate_skills, job_skills, embeddings (`vector(1536)` + ivfflat index), verification_results, interviews, matches, applications. |
  | `002_seed.sql` | Demo seed (2 companies, 2 users, 2 candidates, 2 jobs, 6 skills). `ON CONFLICT DO NOTHING`. |
  | `003_auth.sql` | `password_reset_tokens`. |
  | `004_student.sql` | Candidate profile columns + `candidate_projects`, `candidate_coding_profiles`, `candidate_experience`; resumes local-storage columns. |
  | `005_recruiter.sql` | Company profile columns + `recruiter_profiles`. |
  | `006_phase6.sql` | `application_status_history` + pipeline indexes. |
  | `007_assessment.sql` | Assessment system tables (`profile_analyses`, `assessment_repositories`, `repo_analyses`, `assessments`, `challenges`, `interview_questions`, …). |
  | `008_phase7.sql` | `messages`, `thread_reads`, `notifications`, `contact_messages`. |
  | `009_step5_github_url.sql` | `commit_sha` / `fetched_files` / `fetched_at` on `assessment_repositories`. |

- `migrate.ts` sends **each file as one `pool.query`**. PostgreSQL runs a single
  multi-statement query string as one implicit transaction: if any statement
  in a file fails, **the whole file rolls back**. That is why a single bad
  index in `001_init.sql` used to block every table in the file (see §2).
- Every statement is written idempotently (`CREATE TABLE/INDEX IF NOT EXISTS`,
  `ADD COLUMN IF NOT EXISTS`, `ON CONFLICT DO NOTHING`, or a preflight
  `information_schema` guard). Re-running `npm run migrate` is safe.
- **There is no migration-state table and no DOWN migration.** Rollback means
  restoring the pre-migration backup (see §5), never hand-editing the live
  schema to "undo" a file.
- `docker-compose.yml` mounts `infra/postgres/` into
  `/docker-entrypoint-initdb.d`, so compose only runs these files on **first**
  database init. For an existing database, `npm run migrate` is how later
  migrations land.
- The server `Dockerfile` does **not** run migrations (build + `node
  dist/index.js` only). On Render, the migrate step lives in the service's
  **Build Command in the Render dashboard** (not in this repo) — verify it is
  `npm install && npm run build && npm run migrate` (or equivalent) before
  relying on a deploy to migrate. If the build command has no migrate step,
  a deploy will not apply new migrations.

## 2. The live-database failure — root cause (18 Nov 2026, verified)

The live Render database `groundtruth-postgres` was created 15 Nov 2026 and
the OLD repo's backend ran `alembic upgrade head` (head `c5e83f107a4b`) into
it. That schema overlaps the new one but differs in keys and types:

- `users.role` is a `user_role` ENUM with UPPERCASE values
  (`CANDIDATE`/`RECRUITER`/`ADMIN`); the new server inserts lowercase
  `'candidate'` → `22P02 invalid input value for enum user_role`.
- `candidate_skills`, `certificates`, `interviews`, `applications`,
  `embeddings`, `interview_questions`, `messages`, `notifications` are keyed
  by `candidate_profile_id` / `job_posting_id` / `conversation_id` and have
  **no** `candidate_id` / `job_id` / `application_id` columns.
- Several status columns are ENUMs that reject the new server's values
  (`applications.status`, `interviews.status`, `notifications.type`).
- Old tables have no `gen_random_uuid()` / `now()` defaults and several
  NOT NULL columns the new server never provides.

`001_init.sql` then failed at **statement 15** (verified by local
reproduction, statement-by-statement against the old Alembic head):

```sql
CREATE INDEX IF NOT EXISTS idx_certificates_candidate
  ON certificates (candidate_id);
-- ERROR 42703: column "candidate_id" does not exist
```

Because the whole file is one implicit transaction, the failure rolled back
all of `001` — so the `jobs` table was never created and `/api/jobs` and
register both returned `Internal server error` on live, on every redeploy.

## 3. The fix — `000_preflight.sql` (Round 2, commit `019c0e2`)

Runs first (filename order) and repairs the pre-existing tables **in place**,
keeping all old rows. Every block is guarded by an `information_schema`
existence check and swallows its own errors with a `NOTICE` instead of
failing the file, so it is a no-op on a fresh DB and on an already-migrated DB.

- Round 1 (`a760c0e`): `users.role` ENUM → TEXT (values lowercased) +
  `users_role_check`; `skills.category` ENUM → TEXT; `companies.size` ENUM →
  TEXT (values mapped `size_1_10` → `1-10`, etc.) + missing columns
  (`website`, `description`, `created_by`); `candidate_skills` columns +
  `UNIQUE (candidate_id, skill_id, source)`; `password_reset_tokens.used_at`;
  `recruiter_profiles` columns; defaults + nullability the server INSERTs
  rely on.
- Round 2 (`019c0e2`): the same repair extended to `certificates`
  (`candidate_id`, `cloudinary_url`, `public_id`, `issuer` nullable),
  `interviews` (`candidate_id`, `job_id`, `score`, `scheduled_at`,
  `transcript`, status ENUM → TEXT), `applications` (`candidate_id`,
  `job_id`, status ENUM → TEXT, `evidence_snapshot` default `'{}'::jsonb`,
  `UNIQUE (candidate_id, job_id)`), `embeddings` (`owner_type`, `owner_id`,
  `model`, `embedding vector(1536)`, `UNIQUE (owner_type, owner_id, model)`,
  legacy NOT NULLs dropped), `interview_questions` (`category`, `question`,
  `question_order`, `sequence`/`prompt` nullable), `messages`
  (`application_id`, `sender_id`, `conversation_id` nullable),
  `notifications` (`title`, `body`, `link`, `application_id`, `is_read`,
  type ENUM → TEXT, `payload` default), plus a second defaults block and a
  second NOT NULL-drop block for the INSERTs the server actually issues.

**Known accepted deviation:** the pre-existing `candidate_skills` table does
NOT get a `candidate_id → candidates (id)` foreign key (the `candidates`
table does not exist yet when the preflight runs). The `UNIQUE
(candidate_id, skill_id, source)` constraint IS added, because
`server/src/workers/llmParsing.ts` upserts with
`ON CONFLICT (candidate_id, skill_id, source)`. The app only writes
`candidate_id` values from real `candidates` rows, so the missing FK does
not affect behaviour. The legacy `embeddings.vector` column (`vector(768)`)
is left alone; the new `embedding vector(1536)` column is added alongside it.

## 4. Running migrations locally

```bash
# Postgres 16 + pgvector + Redis must be running locally first.
# This VM: pgserver socket + socat bridge on 127.0.0.1:5432, Redis on 6379
# (see ~/workspace/ground-truth-setup/README.md — services do NOT survive
# a VM restart; restart them with the commands there).
cd server
DATABASE_URL=postgres://postgres@127.0.0.1:5432/<db> npm run migrate
# or: DATABASE_URL=... ../node_modules/.bin/tsx src/scripts/migrate.ts
```

Use a **scratch database** for tests — never point a local run at the
production `DATABASE_URL`. Suggested scratch names: `gt_p1_fresh` (empty),
`gt_p1_legacy` (a copy of a pristine old-schema DB, see §6).

## 5. Rollback / recovery

1. **Before any production migration, take a backup** (see Phase 10 plan in
   `docs/DEPLOYMENT.md`): `pg_dump -Fc` to a timestamped file, and verify
   the dump restores into a scratch DB before deploying.
2. If `npm run migrate` fails on Render, the build fails and Render keeps
   the previous deploy running — the live site stays on the old code, it is
   not left half-migrated, because each file is one transaction. Do not
   re-trigger the same deploy blindly: read the build log, find the exact
   failing statement (as in §2), fix the preflight/repair locally, verify
   against a legacy-schema scratch DB (§6), then redeploy once.
3. If a migration **succeeded but is wrong**, do not hand-edit the live
   schema. Restore the pre-migration backup into the production database
   only with the user's explicit approval, after verifying the restore in a
   scratch DB. Never delete the old database before a restore is verified.
4. There is no automated DOWN migration by design: every migration is
   additive, so "rolling back" a single file is not a supported operation.

## 6. Verification — 23 Nov 2026 (genuine local results)

Environment: local pgserver Postgres 16.2 + pgvector 0.8.7, `npm run
migrate` via `tsx src/scripts/migrate.ts`, commit `019c0e2`.

| Check | Result |
| --- | --- |
| Fresh DB (`gt_p1_fresh`, empty) — migrate | ✅ PASS, all files `000`–`009` ok |
| Fresh DB — tables / indexes | 46 tables, 130 indexes; `idx_certificates_candidate` and `idx_embeddings_vector` present; seed rows jobs=2, users=2 |
| Fresh DB — migrate re-run (idempotency) | ✅ PASS, still 46 tables, 2 jobs |
| Legacy DB (`gt_p1_legacy`, `createdb -T gt_old_pristine`, pristine old Alembic head `c5e83f107a4b`, 34 tables, 0 users) — migrate | ✅ PASS, all files `000`–`009` ok — this is the exact failure mode that blocked live, now fixed |
| Legacy DB — tables / indexes | 67 tables, 230 indexes; `users.role` is `text`; `certificates.candidate_id`, `applications.job_id`, `embeddings.embedding`, `messages.application_id`, `notifications.is_read` all present; all 9 `001` indexes on `resumes`/`evidence_reports`/`verification_results`/`matches`/`job_skills`/`interviews`/`applications` present; `jobs` table exists with 2 seed rows; `vector` extension present |
| Legacy DB — migrate re-run (idempotency) | ✅ PASS, still 67 tables |
| Legacy DB — server-style minimal INSERTs (register lowercase `candidate`, company, candidate, certificate, application with only `candidate_id`+`job_id`, embedding `vector(1536)`, skill) | ✅ PASS, all 7 INSERTs succeeded (run inside a transaction and rolled back; 0 rows left behind) |
| Pristine legacy source `gt_old_pristine` | Untouched (copy was migrated, not the original) |

**What this does NOT prove:** the live Render database may differ from the
pristine local reproduction (e.g. extra tables/columns added by later old-repo
runs, or rows that violate a new UNIQUE). The preflight swallows per-block
errors with a NOTICE, so a deploy log must be read: `000_preflight.sql ok`
followed by `001_init.sql ok` is the pass signal. Live verification is still
pending the user's deploy decision (see the completion report).

## 7. Open items

- Render Build Command containing the migrate step is a dashboard setting,
  not in this repo — confirm it before the next deploy (Phase 11 checklist).
- No migration-state table: re-running is safe, but there is no audit trail
  of which migrations ran when on live. Consider adding one in a future
  change (not done here — out of scope, would change migrate.ts behaviour).
- The live database's exact current schema has never been inspected
  read-only from here; the legacy reproduction is the old Alembic head, which
  is the best available stand-in.

---

## Re-verification — 23 November 2026 (Phase 9)

The migrations were re-run from scratch after the Phase 7–8 code changes
(migrations themselves unchanged since Phase 1):

- Fresh database `gt_p9_fresh` (empty + `npm run migrate`): **46 tables,
  130 indexes, jobs=2, users=2, `users.role`=text,
  `idx_certificates_candidate` present**. Exit 0.
- Legacy database `gt_p9_legacy` (copy of pristine old Alembic schema
  `gt_old_pristine`, 34 tables + `npm run migrate`): **67 tables,
  230 indexes, jobs=2, users=2, role=text, idx present**. Exit 0.
- Re-run of `npm run migrate` on both: idempotent (still 46 / 67 tables).

Backup + restore was rehearsed separately — see
`docs/POSTGRES_MIGRATION_PLAN.md` §2 (pg_dump → pg_restore, every count
identical). Production migration itself is NOT done; it follows the plan
in that document, before 15 Dec 2026.

## Re-verification — 23 November 2026 (ultimate mission, Phase 1)

Migrations re-run from scratch on independent fresh + legacy copies
(`gt_ult_fresh`, `gt_ult_legacy`): fresh **46 tables, 130 indexes,
jobs=2, users=2**; legacy **67 tables, 230 indexes, jobs=2, users=2,
`users.role`=text, `idx_certificates_candidate` present**; re-runs
idempotent on both. `001_init.sql` statement 15 confirmed:
`CREATE INDEX IF NOT EXISTS idx_certificates_candidate ON certificates
(candidate_id)`. Backup/restore rehearsed again the same day on the
live local DB (`gt_p2_api` → `gt_ult_restore`, 568,523-byte dump):
every count identical (46 tables, 130 indexes, 58 users, 13 jobs,
9 applications, 24 embeddings, vector 0.8.7, dims 1536). See
`docs/POSTGRES_MIGRATION_PLAN.md` §2 for the full table.
