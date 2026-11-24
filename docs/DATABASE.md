# GroundTruth AI — database schema overview

**Date:** 24 November 2026 (competency directive, Phase G + stabilization).
**Engine:** PostgreSQL 16 + pgvector 0.8.7. **Fresh DB: 54 tables,
162 indexes** (was 53/156 at migration 012, 46/130 before migrations
010–012; +1 table `interview_evaluation_attempts` and +6 indexes from
migrations 013–014, verified 24 Nov 2026 on scratch DB `gt_stab_val6`).
Legacy (migrated old Alembic schema): 67 tables, 230 indexes (verified
23 Nov 2026; not re-run in Phase G or stabilization — no migration
changed the legacy path). Upgrade path verified 24 Nov 2026: a 000–012
DB (53/156) migrates to 54/162 with 013+014 applied.
Embedding dimension **1536** (`text-embedding-3-small`).
Migrations: `infra/postgres/000_preflight.sql` (639 lines, 29
information_schema guards) + `001_init.sql` through
`014_followup_retry.sql`, applied by
`server/src/scripts/migrate.ts` (`npm run migrate`). Idempotent
re-runs verified (stabilization fresh DB: 54 tables / 162 indexes before and
after a full re-run; 35 competencies, 1 framework). Rollback =
pre-migration backup restore only (no DOWN migrations, by design).
Full migration guide: `docs/MIGRATION_GUIDE.md`;
persistence plan: `docs/POSTGRES_MIGRATION_PLAN.md`.

## Core tables

| Table | Purpose |
|---|---|
| `users` | Accounts. `role` is **text** (`candidate` / `recruiter` / `admin`); register accepts `student` → stored `candidate`. `password_hash` bcrypt. |
| `companies` | Recruiter companies (`created_by` → users). |
| `candidates` | Student profiles (one per user: partial unique index on `user_id`; unique `email`). Headline/location/summary/degree/branch/graduation year/target roles. |
| `candidate_skills` / `skills` | Skills with source + confidence. |
| `candidate_projects` | Exactly **one project per candidate** (2nd → 409). |
| `candidate_coding_profiles` | Coding-platform profiles (LeetCode/CodeChef etc.). |
| `certificates` | Certificates. `candidate_id` indexed by `idx_certificates_candidate` (migration 001 statement 15). |
| `resumes` / `evidence_reports` | Cloudinary-backed files (`cloudinary_url`, `public_id`). |
| `jobs` / `job_skills` | Recruiter jobs + skills. `idx_jobs_status` serves the list query (0.1ms). |
| `applications` | Student → job. Unique (candidate, job) — duplicate apply 409. Status pipeline (`reviewing` etc.). |
| `messages` | Per-application threads (`application_id`). |
| `notifications` | `application_status`, `assessment`, `interview`, `message` (+ defined-but-unwired `job_match`). |
| `embeddings` | pgvector `vector(1536)` rows per candidate/job (`owner_type`, `owner_id`). Upserted by re-embedding workers. |
| `assessments` / `assessment_*` | Assessment runs, challenges, files, events, monitoring, evaluations, interviews. |
| `competency_frameworks` / `competencies` / `role_competency_mappings` | Competency framework v1.0.0 seed (migration 010): 1 framework, 35 competencies, 35 mappings (7 roles × 5). Weights per role sum to 100. |
| `competency_results` | Stored final competency profiles (010 + 012): `result` JSONB + `framework_version`, `assessment_id` / `interview_id` / `evaluation_id`, `inputs_hash` (SHA-256 of the source snapshot). UNIQUE `(assessment_id, framework_version)`; BEFORE UPDATE immutability trigger (DELETE allowed). |
| `interview_sessions` | Interview session lifecycle (011): `status` (not_started/intro/ready/in_progress/completed/expired), `started_at`/`expires_at`, current-question `shown_at`/`deadline_at`, `follow_ups_used`, `explain_again_count`. One ACTIVE session per interview (partial unique index). |
| `interview_followups` | The at-most-one follow-up per interview (011): UNIQUE `(interview_id)` + UNIQUE `(original_question_id)`; follow-up answers live here, never in `interview_answers`. |
| `interview_reports` | Immutable interview reports (011): BEFORE UPDATE trigger rejects changes (DELETE allowed). |
| `interview_questions` / `interview_answers` | Extended by 011: questions carry `competency_id`, `difficulty`, `expected_points`, `scoring_rubric`, `max_time_seconds`, `context`, `framework_version`, `source` (pre_generated/follow_up), `is_follow_up`, `follow_up_of_question_id`. Answers are insert-once (`answered_at`, `locked_at`, `time_spent_seconds`, `question_shown_at`, `deadline_at`, `evaluation_provider`, `evaluation_model`) with a BEFORE UPDATE immutability trigger. Served questions also carry `questionType` (`project_specific` / `conceptual` / `engineering_scenario`) in the session payload (F5). |
| `interview_evaluation_attempts` | Scoring attempts (migration 013, stabilization F3; extended by 014): one row per scoring attempt per question (incl. follow-ups). `state` CHECK (`pending` / `processing` / `completed` / `retryable_failed` / `permanently_failed`), `failure_kind` CHECK (`timeout` / `rate_limited` / `auth_failed` / `server_error` / `network_error` / `invalid_response` / `unknown` — `auth_failed` added by 014), `attempt_number`, `retry_count`, `duration_ms`. One in-flight attempt per question (unique partial index / 23505 → 409). Never stores prompts, answers, or repo contents. |
| `password_reset_tokens` | SHA-256 hashed tokens, 30-min expiry, single-use. |
| `contact_messages` | Public contact / demo-request form submissions. |
| `verification_results` / `matches` | GitHub verification evidence + match rows. |

## Key invariants (verified 24 Nov 2026, Phase G fresh DB; counts re-verified in stabilization)

- FKs: 62 (fresh, pre-010 count) / 88 (legacy). All queries parameterised ($1, $2…).
- Competency framework v1.0.0 seeded: 1 framework, 35 competencies,
  35 role mappings, every role's weights summing to 100.
- `users.role` is text on both schemas (legacy Alembic used a different type — the preflight normalises it).
- Profile completeness requires headline + location + summary + degree +
  branch + graduation year + target role + skills (basic) + 1 project.
- Degree/branch/target-role are lowercase enum slugs (`btech`, `cse`,
  `backend`).
- No production data is ever deleted by migrations; never
  DROP/TRUNCATE/RESET production tables.

## Verification queries (run read-only)

```sql
SELECT count(*) FROM information_schema.tables WHERE table_schema='public'; -- 54
SELECT count(*) FROM pg_indexes WHERE schemaname='public';                  -- 162
SELECT count(*) FROM users; SELECT count(*) FROM jobs;
SELECT count(*) FROM applications; SELECT count(*) FROM embeddings;
SELECT count(*) FROM competency_frameworks; -- 1
SELECT count(*) FROM competencies;          -- 35
SELECT count(*) FROM role_competency_mappings; -- 35
SELECT count(*) FROM interview_sessions; SELECT count(*) FROM interview_followups; SELECT count(*) FROM interview_reports;
SELECT count(*) FROM interview_evaluation_attempts; -- 0 on a fresh DB
-- failure-kind CHECK (014): must include auth_failed
SELECT pg_get_constraintdef(oid) FROM pg_constraint WHERE conrelid='interview_evaluation_attempts'::regclass AND conname='interview_evaluation_attempts_failure_kind_check';
SELECT extname, extversion FROM pg_extension ORDER BY 1; -- plpgsql, vector 0.8.7
SELECT vector_dims(embedding) FROM embeddings LIMIT 1;   -- 1536
SELECT data_type FROM information_schema.columns
  WHERE table_name='users' AND column_name='role';        -- text
SELECT count(*) FROM pg_indexes
  WHERE indexname='idx_certificates_candidate';           -- 1
```
