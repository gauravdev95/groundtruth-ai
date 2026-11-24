-- Ground Truth AI — Migration 000: preflight repair for a database that
-- already holds the OLD repo's Alembic schema.
--
-- ROOT CAUSE (verified by local reproduction, 18 Nov 2026):
-- The live Render database `groundtruth-postgres` was created 15 Nov 2026
-- and the OLD repo's backend (GroundTruth-AI-Recruiter-Intelligence,
-- `alembic upgrade head` in its preDeployCommand) created its tables
-- there, including:
--   * `users` with `role` of type `user_role` ENUM
--     ('CANDIDATE', 'RECRUITER', 'ADMIN') — UPPERCASE values
--   * `candidate_skills` with `candidate_profile_id` and NO
--     `candidate_id` column
--   * `companies` without `website` / `description` / `created_by`, and
--     `size` as `company_size` ENUM
--   * `skills` with `category` as `skill_category` ENUM
--   * `password_reset_tokens` without `used_at`
--   * `recruiter_profiles` without `job_title` / `phone` / `linkedin_url`
-- 001_init.sql then fails: `CREATE TABLE IF NOT EXISTS candidate_skills`
-- is skipped (the table exists) and
-- `CREATE INDEX ... ON candidate_skills (candidate_id)` raises
-- 42703 `column "candidate_id" does not exist` (routine
-- ComputeIndexAttrs). Because migrate.ts sends each file as one
-- `pool.query`, the whole 001 file runs in a single implicit transaction
-- and rolls back entirely — so NO new table (not even `jobs`) is created,
-- and every redeploy fails identically. Registering also fails because
-- the server inserts lowercase 'candidate' into the old UPPERCASE enum
-- (22P02 `invalid input value for enum user_role: "candidate"`).
--
-- This file runs FIRST (filename sort: 000 < 001) and repairs the
-- pre-existing tables in place so 001-009 can apply cleanly. It changes
-- NOTHING on a fresh empty database (every statement is guarded by an
-- information_schema existence check) and is a no-op on an already
-- migrated database. No data is dropped: old rows are kept, enum values
-- are lowercased/mapped to the new TEXT values. Do NOT drop the live DB.
--
-- Known acceptable deviation: the pre-existing `candidate_skills` table
-- does NOT get the `candidate_id -> candidates (id)` foreign key (the
-- `candidates` table does not exist yet when this file runs). The UNIQUE
-- (candidate_id, skill_id, source) constraint IS added, because
-- server/src/workers/llmParsing.ts upserts with
-- `ON CONFLICT (candidate_id, skill_id, source)` and Postgres requires
-- that constraint to exist. The app only ever writes `candidate_id`
-- values that come from a real `candidates` row, so the missing FK does
-- not affect behaviour.

-- ── users.role: UPPERCASE enum -> TEXT, values lowercased ───────────────
DO $pf$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'users'
      AND column_name = 'role' AND udt_name <> 'text'
  ) THEN
    EXECUTE 'ALTER TABLE public.users ALTER COLUMN role TYPE TEXT USING lower(role::text)';
    RAISE NOTICE 'preflight: users.role converted to TEXT';
  END IF;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'preflight: users.role conversion skipped: %', SQLERRM;
END $pf$;

-- ── users.role: restore the CHECK 001 would have created ───────────────
DO $pf$
BEGIN
  -- Nested IFs (not AND): the regclass cast must only be evaluated after
  -- the table is known to exist, otherwise a fresh database errors with
  -- `relation "public.users" does not exist`.
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'users'
  ) THEN
    IF NOT EXISTS (
      SELECT 1 FROM pg_constraint
      WHERE conname = 'users_role_check'
        AND conrelid = 'public.users'::regclass
    ) THEN
      BEGIN
        EXECUTE $q$ALTER TABLE public.users ADD CONSTRAINT users_role_check CHECK (role IN ('candidate', 'recruiter', 'admin'))$q$;
      EXCEPTION WHEN OTHERS THEN
        RAISE NOTICE 'preflight: users role check skipped: %', SQLERRM;
      END;
    END IF;
  END IF;
END $pf$;

-- ── skills.category: enum -> TEXT, values lowercased ────────────────────
DO $pf$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'skills'
      AND column_name = 'category' AND udt_name <> 'text'
  ) THEN
    EXECUTE 'ALTER TABLE public.skills ALTER COLUMN category TYPE TEXT USING lower(category::text)';
    RAISE NOTICE 'preflight: skills.category converted to TEXT';
  END IF;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'preflight: skills.category conversion skipped: %', SQLERRM;
END $pf$;

-- ── companies.size: enum -> TEXT, old values mapped to the new ones ─────
DO $pf$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'companies'
      AND column_name = 'size' AND udt_name <> 'text'
  ) THEN
    EXECUTE $q$ALTER TABLE public.companies ALTER COLUMN size TYPE TEXT USING (
      CASE lower(size::text)
        WHEN 'size_1_10' THEN '1-10'
        WHEN 'size_11_50' THEN '11-50'
        WHEN 'size_51_200' THEN '51-200'
        WHEN 'size_201_1000' THEN '201-1000'
        WHEN 'size_1000_plus' THEN '1000+'
        ELSE lower(size::text)
      END)$q$;
    RAISE NOTICE 'preflight: companies.size converted to TEXT';
  END IF;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'preflight: companies.size conversion skipped: %', SQLERRM;
END $pf$;

-- ── companies: columns 001 defines that the old table lacks ─────────────
DO $pf$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'companies'
  ) THEN
    EXECUTE 'ALTER TABLE public.companies ADD COLUMN IF NOT EXISTS website TEXT';
    EXECUTE 'ALTER TABLE public.companies ADD COLUMN IF NOT EXISTS description TEXT';
    EXECUTE 'ALTER TABLE public.companies ADD COLUMN IF NOT EXISTS created_by UUID REFERENCES users (id) ON DELETE SET NULL';
  END IF;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'preflight: companies columns skipped: %', SQLERRM;
END $pf$;

-- ── candidate_skills: the columns 001 defines that the old table lacks ──
-- Plus the UNIQUE (candidate_id, skill_id, source) constraint, which the
-- server's ON CONFLICT upserts require (see workers/llmParsing.ts).
DO $pf$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'candidate_skills'
  ) THEN
    EXECUTE 'ALTER TABLE public.candidate_skills ADD COLUMN IF NOT EXISTS candidate_id UUID';
    EXECUTE 'ALTER TABLE public.candidate_skills ADD COLUMN IF NOT EXISTS source TEXT NOT NULL DEFAULT ''resume''';
    EXECUTE 'ALTER TABLE public.candidate_skills ADD COLUMN IF NOT EXISTS confidence NUMERIC(4, 3)';
    BEGIN
      EXECUTE 'ALTER TABLE public.candidate_skills ADD CONSTRAINT candidate_skills_candidate_id_skill_id_source_key UNIQUE (candidate_id, skill_id, source)';
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'preflight: candidate_skills unique skipped: %', SQLERRM;
    END;
  END IF;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'preflight: candidate_skills repair skipped: %', SQLERRM;
END $pf$;

-- ── password_reset_tokens: column 003 defines that the old table lacks ──
DO $pf$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'password_reset_tokens'
  ) THEN
    EXECUTE 'ALTER TABLE public.password_reset_tokens ADD COLUMN IF NOT EXISTS used_at TIMESTAMPTZ';
  END IF;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'preflight: password_reset_tokens repair skipped: %', SQLERRM;
END $pf$;

-- ── recruiter_profiles: columns 005 defines that the old table lacks ────
DO $pf$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'recruiter_profiles'
  ) THEN
    EXECUTE 'ALTER TABLE public.recruiter_profiles ADD COLUMN IF NOT EXISTS job_title TEXT';
    EXECUTE 'ALTER TABLE public.recruiter_profiles ADD COLUMN IF NOT EXISTS phone TEXT';
    EXECUTE 'ALTER TABLE public.recruiter_profiles ADD COLUMN IF NOT EXISTS linkedin_url TEXT';
  END IF;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'preflight: recruiter_profiles repair skipped: %', SQLERRM;
END $pf$;

-- ── Defaults & nullability the new server code relies on ─────────────────
-- The new server INSERTs omit `id`, `created_at` and `updated_at` (and the
-- old tables' extra NOT NULL columns), relying on the defaults 001
-- defines. The old tables have no such defaults, so without this section
-- 002_seed and register would fail with 23502 NULL violations even after
-- the columns above are repaired (verified: 002_seed failed on
-- companies.created_at right after 001 started passing). Each ALTER runs
-- only when the table/column exists and the default/nullability actually
-- differs, so this is a no-op on fresh and already-migrated databases.
DO $pf$
DECLARE
  v_table TEXT; v_col TEXT; v_def TEXT;
  v_has_default BOOLEAN; v_is_nullable BOOLEAN;
BEGIN
  FOR v_table, v_col, v_def IN
    SELECT * FROM (VALUES
      ('users', 'id', 'gen_random_uuid()'),
      ('users', 'created_at', 'now()'),
      ('users', 'updated_at', 'now()'),
      ('users', 'is_email_verified', 'false'),
      ('users', 'is_active', 'true'),
      ('users', 'failed_login_attempts', '0'),
      ('companies', 'id', 'gen_random_uuid()'),
      ('companies', 'created_at', 'now()'),
      ('companies', 'updated_at', 'now()'),
      ('skills', 'id', 'gen_random_uuid()'),
      ('skills', 'created_at', 'now()'),
      ('skills', 'updated_at', 'now()'),
      ('candidate_skills', 'id', 'gen_random_uuid()'),
      ('candidate_skills', 'created_at', 'now()'),
      ('candidate_skills', 'updated_at', 'now()'),
      ('password_reset_tokens', 'id', 'gen_random_uuid()'),
      ('password_reset_tokens', 'created_at', 'now()'),
      ('password_reset_tokens', 'updated_at', 'now()'),
      ('password_reset_tokens', 'attempt_count', '0'),
      ('recruiter_profiles', 'id', 'gen_random_uuid()'),
      ('recruiter_profiles', 'created_at', 'now()'),
      ('recruiter_profiles', 'updated_at', 'now()')
    ) AS v(t, c, d)
  LOOP
    SELECT (column_default IS NOT NULL), (is_nullable = 'YES')
      INTO v_has_default, v_is_nullable
      FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = v_table AND column_name = v_col;
    IF NOT FOUND THEN CONTINUE; END IF;
    BEGIN
      IF NOT v_has_default THEN
        EXECUTE format('ALTER TABLE public.%I ALTER COLUMN %I SET DEFAULT %s', v_table, v_col, v_def);
      END IF;
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'preflight: %.% default skipped: %', v_table, v_col, SQLERRM;
    END;
  END LOOP;
END $pf$;

-- Old NOT NULL columns the new server never provides a value for. The
-- server INSERTs `skills (name)` only, `candidate_skills
-- (candidate_id, skill_id, source)` only and `recruiter_profiles
-- (user_id)` only, so these columns must be nullable on the old tables.
DO $pf$
DECLARE
  v_table TEXT; v_col TEXT; v_is_nullable BOOLEAN;
BEGIN
  FOR v_table, v_col IN
    SELECT * FROM (VALUES
      ('skills', 'category'),
      ('candidate_skills', 'candidate_profile_id'),
      ('candidate_skills', 'proficiency'),
      ('candidate_skills', 'evidence_weight'),
      ('recruiter_profiles', 'company_name')
    ) AS v(t, c)
  LOOP
    SELECT (is_nullable = 'YES') INTO v_is_nullable
      FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = v_table AND column_name = v_col;
    IF NOT FOUND OR v_is_nullable THEN CONTINUE; END IF;
    BEGIN
      EXECUTE format('ALTER TABLE public.%I ALTER COLUMN %I DROP NOT NULL', v_table, v_col);
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'preflight: %.% drop-not-null skipped: %', v_table, v_col, SQLERRM;
    END;
  END LOOP;
END $pf$;

-- ═════════ ROUND 2 (2026-11-18, ~21:30 IST) — why Round 1 was not enough ══
-- Live deploy dep-dbusfn0ae00c73ffeahg (commit a760c0e) ran 000 "ok" and
-- then 001 still failed at the SAME place:
--   CREATE INDEX idx_certificates_candidate ON certificates (candidate_id)
--   → 42703 column "candidate_id" does not exist.
-- Round 1 only repaired `candidate_skills`. It never checked the OTHER
-- tables 001 indexes on candidate_id. Reproduced locally by running the
-- OLD repo's own `alembic upgrade head` (head c5e83f107a4b) into a scratch
-- DB and executing 001 statement by statement: statement 15
-- (idx_certificates_candidate) is the first failure. The old schema
-- overlaps the new one on these tables, all keyed by candidate_profile_id
-- instead of candidate_id (and job_posting_id instead of job_id):
--   certificates, interviews, applications, embeddings,
--   interview_questions (007), messages + notifications (008).
-- This section repairs all of them the same way Round 1 repaired
-- candidate_skills: add the columns the new server writes, convert the
-- old enum status columns to TEXT (values preserved), drop/set defaults
-- on old NOT NULL columns the new server never provides, and add the
-- UNIQUE constraints the new server's ON CONFLICT upserts require.
-- Still a no-op on fresh and already-migrated databases: every statement
-- is guarded by an information_schema existence check, and every repair
-- swallows its own errors with a NOTICE instead of failing the file.

-- ── certificates: candidate_id + upload columns 001 defines ─────────────
-- Old table keys by candidate_profile_id and has NO candidate_id /
-- cloudinary_url / public_id. The new server INSERTs certificates
-- (candidate_id, title, cloudinary_url, public_id) and never provides
-- `issuer`, which is NOT NULL in the old table.
DO $pf$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'certificates'
  ) THEN
    EXECUTE 'ALTER TABLE public.certificates ADD COLUMN IF NOT EXISTS candidate_id UUID';
    EXECUTE 'ALTER TABLE public.certificates ADD COLUMN IF NOT EXISTS cloudinary_url TEXT';
    EXECUTE 'ALTER TABLE public.certificates ADD COLUMN IF NOT EXISTS public_id TEXT';
    BEGIN
      EXECUTE 'ALTER TABLE public.certificates ALTER COLUMN issuer DROP NOT NULL';
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'preflight: certificates issuer drop-not-null skipped: %', SQLERRM;
    END;
  END IF;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'preflight: certificates repair skipped: %', SQLERRM;
END $pf$;

-- ── interviews: candidate_id / job_id / score / scheduled_at + status ────
-- Old table keys by candidate_profile_id, has NO job_id / score /
-- scheduled_at / transcript, and `status` is the interview_status ENUM
-- (pending/in_progress/evaluating/completed/failed) which rejects the
-- new server's 'scheduled' / 'cancelled'. `time_limit_seconds` is NOT
-- NULL with no default and the new server never provides it.
DO $pf$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'interviews'
  ) THEN
    EXECUTE 'ALTER TABLE public.interviews ADD COLUMN IF NOT EXISTS candidate_id UUID';
    EXECUTE 'ALTER TABLE public.interviews ADD COLUMN IF NOT EXISTS job_id UUID';
    EXECUTE 'ALTER TABLE public.interviews ADD COLUMN IF NOT EXISTS score NUMERIC(5, 2)';
    EXECUTE 'ALTER TABLE public.interviews ADD COLUMN IF NOT EXISTS scheduled_at TIMESTAMPTZ';
    EXECUTE 'ALTER TABLE public.interviews ADD COLUMN IF NOT EXISTS transcript TEXT';
    IF EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'interviews'
        AND column_name = 'status' AND udt_name <> 'text'
    ) THEN
      EXECUTE 'ALTER TABLE public.interviews ALTER COLUMN status TYPE TEXT USING lower(status::text)';
      RAISE NOTICE 'preflight: interviews.status converted to TEXT';
    END IF;
    IF EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'interviews'
        AND column_name = 'time_limit_seconds' AND column_default IS NULL
    ) THEN
      EXECUTE 'ALTER TABLE public.interviews ALTER COLUMN time_limit_seconds SET DEFAULT 0';
    END IF;
  END IF;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'preflight: interviews repair skipped: %', SQLERRM;
END $pf$;

-- ── applications: candidate_id / job_id + status + snapshot default ──────
-- Old table keys by (job_posting_id, candidate_profile_id), has NO
-- candidate_id / job_id, and `status` is the application_status ENUM
-- (applied/shortlisted/interview_scheduled/hired/rejected) which rejects
-- the new server's 'reviewing' / 'interview' / 'offer' / 'withdrawn'.
-- `evidence_snapshot` is NOT NULL with no DB default and the new server's
-- INSERT INTO applications (candidate_id, job_id) never provides it.
DO $pf$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'applications'
  ) THEN
    EXECUTE 'ALTER TABLE public.applications ADD COLUMN IF NOT EXISTS candidate_id UUID';
    EXECUTE 'ALTER TABLE public.applications ADD COLUMN IF NOT EXISTS job_id UUID';
    IF EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'applications'
        AND column_name = 'status' AND udt_name <> 'text'
    ) THEN
      EXECUTE 'ALTER TABLE public.applications ALTER COLUMN status TYPE TEXT USING lower(status::text)';
      RAISE NOTICE 'preflight: applications.status converted to TEXT';
    END IF;
    IF EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'applications'
        AND column_name = 'evidence_snapshot' AND column_default IS NULL
    ) THEN
      EXECUTE $q$ALTER TABLE public.applications ALTER COLUMN evidence_snapshot SET DEFAULT '{}'::jsonb$q$;
    END IF;
    BEGIN
      EXECUTE 'ALTER TABLE public.applications ADD CONSTRAINT applications_candidate_id_job_id_key UNIQUE (candidate_id, job_id)';
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'preflight: applications unique skipped: %', SQLERRM;
    END;
  END IF;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'preflight: applications repair skipped: %', SQLERRM;
END $pf$;

-- ── embeddings: owner_* / embedding / model + legacy NOT NULLs ───────────
-- Old table is (entity_type ENUM, entity_id, vector Vector(768),
-- model_version) with all four NOT NULL. The new server INSERTs
-- embeddings (owner_type, owner_id, embedding, model) ON CONFLICT
-- (owner_type, owner_id, model), so the new columns, the UNIQUE, and
-- dropping NOT NULL on the legacy columns are all required. The old
-- `vector` column is left alone (768-dim legacy rows stay readable).
DO $pf$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'embeddings'
  ) THEN
    EXECUTE 'ALTER TABLE public.embeddings ADD COLUMN IF NOT EXISTS owner_type TEXT';
    EXECUTE 'ALTER TABLE public.embeddings ADD COLUMN IF NOT EXISTS owner_id UUID';
    EXECUTE 'ALTER TABLE public.embeddings ADD COLUMN IF NOT EXISTS model TEXT';
    BEGIN
      EXECUTE 'ALTER TABLE public.embeddings ADD COLUMN IF NOT EXISTS embedding vector(1536)';
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'preflight: embeddings.embedding skipped: %', SQLERRM;
    END;
  END IF;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'preflight: embeddings repair skipped: %', SQLERRM;
END $pf$;

DO $pf$
DECLARE
  v_col TEXT; v_is_nullable BOOLEAN;
BEGIN
  FOR v_col IN
    SELECT * FROM (VALUES ('entity_type'), ('entity_id'), ('vector'), ('model_version')) AS v(c)
  LOOP
    SELECT (is_nullable = 'YES') INTO v_is_nullable
      FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'embeddings' AND column_name = v_col;
    IF NOT FOUND OR v_is_nullable THEN CONTINUE; END IF;
    BEGIN
      EXECUTE format('ALTER TABLE public.embeddings ALTER COLUMN %I DROP NOT NULL', v_col);
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'preflight: embeddings.% drop-not-null skipped: %', v_col, SQLERRM;
    END;
  END LOOP;
END $pf$;

DO $pf$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'embeddings'
  ) THEN
    BEGIN
      EXECUTE 'ALTER TABLE public.embeddings ADD CONSTRAINT embeddings_owner_type_owner_id_model_key UNIQUE (owner_type, owner_id, model)';
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'preflight: embeddings unique skipped: %', SQLERRM;
    END;
  END IF;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'preflight: embeddings unique block skipped: %', SQLERRM;
END $pf$;

-- ── interview_questions (007): category / question / question_order ──────
-- Old table is (interview_id, sequence, prompt, grounded_in,
-- expected_signals). 007's CREATE TABLE is skipped and its index on
-- (interview_id, question_order) fails; the new server INSERTs
-- (interview_id, category, question, question_order) and never provides
-- `sequence` / `prompt`, which are NOT NULL in the old table.
DO $pf$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'interview_questions'
  ) THEN
    EXECUTE 'ALTER TABLE public.interview_questions ADD COLUMN IF NOT EXISTS category TEXT';
    EXECUTE 'ALTER TABLE public.interview_questions ADD COLUMN IF NOT EXISTS question TEXT';
    EXECUTE 'ALTER TABLE public.interview_questions ADD COLUMN IF NOT EXISTS question_order INTEGER NOT NULL DEFAULT 0';
    BEGIN
      EXECUTE 'ALTER TABLE public.interview_questions ALTER COLUMN sequence DROP NOT NULL';
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'preflight: interview_questions sequence drop-not-null skipped: %', SQLERRM;
    END;
    BEGIN
      EXECUTE 'ALTER TABLE public.interview_questions ALTER COLUMN prompt DROP NOT NULL';
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'preflight: interview_questions prompt drop-not-null skipped: %', SQLERRM;
    END;
  END IF;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'preflight: interview_questions repair skipped: %', SQLERRM;
END $pf$;

-- ── messages (008): application_id / sender_id ───────────────────────────
-- Old table is (conversation_id NOT NULL, sender_user_id, body, read_at).
-- The new server INSERTs messages (application_id, sender_id, body) and
-- 008 indexes (application_id, created_at) and (sender_id).
DO $pf$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'messages'
  ) THEN
    EXECUTE 'ALTER TABLE public.messages ADD COLUMN IF NOT EXISTS application_id UUID';
    EXECUTE 'ALTER TABLE public.messages ADD COLUMN IF NOT EXISTS sender_id UUID';
    BEGIN
      EXECUTE 'ALTER TABLE public.messages ALTER COLUMN conversation_id DROP NOT NULL';
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'preflight: messages conversation_id drop-not-null skipped: %', SQLERRM;
    END;
  END IF;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'preflight: messages repair skipped: %', SQLERRM;
END $pf$;

-- ── notifications (008): title / body / link / application_id / is_read ──
-- Old table is (user_id, type notification_type ENUM, payload JSONB
-- NOT NULL no default, read_at). The new server INSERTs notifications
-- (user_id, type, title, body, link, application_id) with type values
-- 'application_status' / 'message' / 'interview' / 'assessment' /
-- 'job_match', none of which the old ENUM accepts.
DO $pf$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'notifications'
  ) THEN
    EXECUTE 'ALTER TABLE public.notifications ADD COLUMN IF NOT EXISTS title TEXT';
    EXECUTE 'ALTER TABLE public.notifications ADD COLUMN IF NOT EXISTS body TEXT';
    EXECUTE 'ALTER TABLE public.notifications ADD COLUMN IF NOT EXISTS link TEXT';
    EXECUTE 'ALTER TABLE public.notifications ADD COLUMN IF NOT EXISTS application_id UUID';
    EXECUTE 'ALTER TABLE public.notifications ADD COLUMN IF NOT EXISTS is_read BOOLEAN NOT NULL DEFAULT false';
    IF EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'notifications'
        AND column_name = 'type' AND udt_name <> 'text'
    ) THEN
      EXECUTE 'ALTER TABLE public.notifications ALTER COLUMN type TYPE TEXT USING lower(type::text)';
      RAISE NOTICE 'preflight: notifications.type converted to TEXT';
    END IF;
    IF EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'notifications'
        AND column_name = 'payload' AND column_default IS NULL
    ) THEN
      EXECUTE $q$ALTER TABLE public.notifications ALTER COLUMN payload SET DEFAULT '{}'::jsonb$q$;
    END IF;
  END IF;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'preflight: notifications repair skipped: %', SQLERRM;
END $pf$;

-- ── Round 2b: defaults the new server's INSERTs rely on ──────────────────
-- The old tables' id / created_at / updated_at columns have NO database
-- defaults (SQLAlchemy filled them client-side), and several old NOT NULL
-- columns have no default either. The new server's raw-SQL INSERTs omit
-- them all — e.g. INSERT INTO applications (candidate_id, job_id) omits
-- id, status, applied_at, status_updated_at, created_at, updated_at.
-- Verified by running those exact INSERTs against the repaired old
-- schema: applications failed on job_posting_id, embeddings on id.
-- Same loop shape as Round 1's defaults block; no-op where the default
-- already exists or the column is absent.
DO $pf$
DECLARE
  v_table TEXT; v_col TEXT; v_def TEXT;
  v_has_default BOOLEAN;
BEGIN
  FOR v_table, v_col, v_def IN
    SELECT * FROM (VALUES
      ('applications', 'id', 'gen_random_uuid()'),
      ('applications', 'created_at', 'now()'),
      ('applications', 'updated_at', 'now()'),
      ('applications', 'status', '''applied'''),
      ('applications', 'applied_at', 'now()'),
      ('applications', 'status_updated_at', 'now()'),
      ('certificates', 'id', 'gen_random_uuid()'),
      ('certificates', 'created_at', 'now()'),
      ('certificates', 'updated_at', 'now()'),
      ('certificates', 'position', '0'),
      ('certificates', 'verification_status', '''UNVERIFIED''::verification_status'),
      ('embeddings', 'id', 'gen_random_uuid()'),
      ('embeddings', 'created_at', 'now()'),
      ('embeddings', 'updated_at', 'now()'),
      ('interviews', 'id', 'gen_random_uuid()'),
      ('interviews', 'created_at', 'now()'),
      ('interviews', 'updated_at', 'now()'),
      ('interview_questions', 'id', 'gen_random_uuid()'),
      ('interview_questions', 'created_at', 'now()'),
      ('interview_questions', 'updated_at', 'now()'),
      ('messages', 'id', 'gen_random_uuid()'),
      ('messages', 'created_at', 'now()'),
      ('notifications', 'id', 'gen_random_uuid()'),
      ('notifications', 'created_at', 'now()')
    ) AS v(t, c, d)
  LOOP
    SELECT (column_default IS NOT NULL)
      INTO v_has_default
      FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = v_table AND column_name = v_col;
    IF NOT FOUND THEN CONTINUE; END IF;
    BEGIN
      IF NOT v_has_default THEN
        EXECUTE format('ALTER TABLE public.%I ALTER COLUMN %I SET DEFAULT %s', v_table, v_col, v_def);
      END IF;
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'preflight: %.% default skipped: %', v_table, v_col, SQLERRM;
    END;
  END LOOP;
END $pf$;

-- ── Round 2c: old NOT NULL columns the new server never provides ─────────
-- Legacy foreign keys (job_posting_id, candidate_profile_id) and legacy
-- interview bookkeeping columns (grounding, rubric_version, stage,
-- current_question_index, follow_up_count, candidate_comfort) are NOT NULL
-- in the old tables with no default. The new server never writes them,
-- so they must be nullable. Same loop shape as Round 1.
DO $pf$
DECLARE
  v_table TEXT; v_col TEXT; v_is_nullable BOOLEAN;
BEGIN
  FOR v_table, v_col IN
    SELECT * FROM (VALUES
      ('applications', 'job_posting_id'),
      ('applications', 'candidate_profile_id'),
      ('certificates', 'candidate_profile_id'),
      ('interviews', 'candidate_profile_id'),
      ('interviews', 'grounding'),
      ('interviews', 'rubric_version'),
      ('interviews', 'stage'),
      ('interviews', 'question_count'),
      ('interviews', 'current_question_index'),
      ('interviews', 'follow_up_count'),
      ('interviews', 'candidate_comfort')
    ) AS v(t, c)
  LOOP
    SELECT (is_nullable = 'YES') INTO v_is_nullable
      FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = v_table AND column_name = v_col;
    IF NOT FOUND OR v_is_nullable THEN CONTINUE; END IF;
    BEGIN
      EXECUTE format('ALTER TABLE public.%I ALTER COLUMN %I DROP NOT NULL', v_table, v_col);
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'preflight: %.% drop-not-null skipped: %', v_table, v_col, SQLERRM;
    END;
  END LOOP;
END $pf$;
