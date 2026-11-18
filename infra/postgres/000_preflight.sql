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
