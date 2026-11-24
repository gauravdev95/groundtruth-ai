-- Ground Truth AI — Phase 3 recruiter schema.
-- Extends the Phase 0 `companies` table with the company-profile fields
-- from the old repo's recruiter/company flow
-- (apps/backend/src/domains/company/models.py: name, domain/website,
-- industry, size) plus location, and adds a `recruiter_profiles` table for
-- the recruiter's own details — the analogue of the old repo's
-- `RecruiterProfile` (company_name + company_id) and of Phase 2's
-- `candidates` table for students.
--
-- No duplicate company model: the company row created at registration
-- (server/src/routes/auth.ts inserts into `companies` with
-- created_by = the recruiter's user id) IS the company profile. This
-- migration only adds the fields it was missing, and the recruiter
-- service links a recruiter to that row via `recruiter_profiles`.
--
-- Run via `npm run migrate` in server/ (applies infra/postgres/*.sql in
-- order). Idempotent: every statement uses IF NOT EXISTS / ON CONFLICT.

-- ── companies: company-profile columns ─────────────────────────────────
ALTER TABLE companies ADD COLUMN IF NOT EXISTS industry TEXT;
ALTER TABLE companies ADD COLUMN IF NOT EXISTS size TEXT
    CHECK (size IS NULL OR size IN ('1-10', '11-50', '51-200', '201-1000', '1000+'));
ALTER TABLE companies ADD COLUMN IF NOT EXISTS location TEXT;
-- `description` (001_init.sql) is the company's "about" text; `website`
-- is already there. Nothing else is needed for the company profile.

-- ── recruiter_profiles: the recruiter's own details ─────────────────────
-- One row per recruiter user. `company_id` points at the company row
-- created for them at registration; it is NULL only for accounts that
-- predate this table (e.g. the Phase 0 demo recruiter) until they save a
-- company name, at which point the service creates/links the row.
CREATE TABLE IF NOT EXISTS recruiter_profiles (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id      UUID NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    company_id   UUID REFERENCES companies (id) ON DELETE SET NULL,
    job_title    TEXT,
    phone        TEXT,
    linkedin_url TEXT,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (user_id)
);
CREATE INDEX IF NOT EXISTS idx_recruiter_profiles_user
    ON recruiter_profiles (user_id);
CREATE INDEX IF NOT EXISTS idx_recruiter_profiles_company
    ON recruiter_profiles (company_id);
