-- Ground Truth AI — Phase 2 student schema.
-- Extends the Phase 0 `candidates` table with the onboarding/profile fields
-- from the old repo's student flow (apps/frontend/src/features/student and
-- apps/backend/src/domains/student), and adds the per-section tables the
-- onboarding stages write to: projects, coding profiles, experience.
-- Run via `npm run migrate` in server/ (applies infra/postgres/*.sql in
-- order). Idempotent: every statement uses IF NOT EXISTS / ON CONFLICT.
--
-- Completeness is NOT stored: it is computed server-side on every read
-- (server/src/services/student.ts) from what is actually filled in, so the
-- number can never drift from the data. GitHub verification status is
-- likewise derived from `verification_results` (written by the existing
-- github-analysis worker), never asserted by the client.

-- ── candidates: profile + onboarding columns ─────────────────────────────
ALTER TABLE candidates ADD COLUMN IF NOT EXISTS phone TEXT;
ALTER TABLE candidates ADD COLUMN IF NOT EXISTS degree TEXT;
ALTER TABLE candidates ADD COLUMN IF NOT EXISTS branch TEXT;
ALTER TABLE candidates ADD COLUMN IF NOT EXISTS graduation_year INTEGER;
ALTER TABLE candidates ADD COLUMN IF NOT EXISTS target_roles TEXT[] NOT NULL DEFAULT '{}';
ALTER TABLE candidates ADD COLUMN IF NOT EXISTS portfolio_url TEXT;
ALTER TABLE candidates ADD COLUMN IF NOT EXISTS github_handle TEXT;
-- Best-effort public GitHub lookup at save time (see routes/student.ts):
-- TRUE = handle exists on GitHub, FALSE = GitHub says no such user,
-- NULL = GitHub could not be reached, so nothing is claimed either way.
ALTER TABLE candidates ADD COLUMN IF NOT EXISTS github_handle_exists BOOLEAN;
ALTER TABLE candidates ADD COLUMN IF NOT EXISTS github_checked_at TIMESTAMPTZ;
ALTER TABLE candidates ADD COLUMN IF NOT EXISTS onboarding_choice TEXT
    CHECK (onboarding_choice IS NULL OR onboarding_choice IN ('resume_upload', 'manual_entry'));
ALTER TABLE candidates ADD COLUMN IF NOT EXISTS onboarding_completed_at TIMESTAMPTZ;
-- One candidate row per user: a user who signed up twice (or was seeded)
-- must never end up with two profiles.
CREATE UNIQUE INDEX IF NOT EXISTS idx_candidates_user_unique
    ON candidates (user_id) WHERE user_id IS NOT NULL;

-- ── Projects (onboarding stage: projects — mandatory) ────────────────────
CREATE TABLE IF NOT EXISTS candidate_projects (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    candidate_id UUID NOT NULL REFERENCES candidates (id) ON DELETE CASCADE,
    title        TEXT NOT NULL,
    description  TEXT NOT NULL DEFAULT '',
    kind         TEXT NOT NULL DEFAULT 'described'
                 CHECK (kind IN ('repository', 'described')),
    repo_url     TEXT,
    role         TEXT,
    technologies TEXT[] NOT NULL DEFAULT '{}',
    started_at   DATE,
    ended_at     DATE,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_candidate_projects_candidate
    ON candidate_projects (candidate_id);

-- ── Coding-platform profiles (onboarding stage: coding — optional) ───────
CREATE TABLE IF NOT EXISTS candidate_coding_profiles (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    candidate_id        UUID NOT NULL REFERENCES candidates (id) ON DELETE CASCADE,
    platform            TEXT NOT NULL CHECK (platform IN
                        ('leetcode', 'codeforces', 'codechef', 'hackerrank',
                         'atcoder', 'geeksforgeeks', 'other')),
    username            TEXT NOT NULL,
    profile_url         TEXT,
    -- 'unverified' until a live check proves otherwise. Only the LeetCode /
    -- Codeforces live checks in the old repo could ever return 'verified';
    -- this phase stores what the student entered and leaves the status at
    -- 'unverified' — it never claims a check that did not happen.
    verification_status TEXT NOT NULL DEFAULT 'unverified'
                        CHECK (verification_status IN
                               ('unverified', 'pending', 'verified', 'flagged')),
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (candidate_id, platform)
);
CREATE INDEX IF NOT EXISTS idx_candidate_coding_candidate
    ON candidate_coding_profiles (candidate_id);

-- ── Experience (onboarding stage: experience — optional) ─────────────────
CREATE TABLE IF NOT EXISTS candidate_experience (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    candidate_id    UUID NOT NULL REFERENCES candidates (id) ON DELETE CASCADE,
    title           TEXT NOT NULL,
    organization    TEXT NOT NULL,
    employment_type TEXT NOT NULL DEFAULT 'internship'
                    CHECK (employment_type IN
                           ('internship', 'full_time', 'part_time',
                            'freelance', 'research', 'open_source')),
    start_date      DATE,
    end_date        DATE,
    is_current      BOOLEAN NOT NULL DEFAULT FALSE,
    description     TEXT NOT NULL DEFAULT '',
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_candidate_experience_candidate
    ON candidate_experience (candidate_id);

-- ── Certificates: link a credential URL (file upload needs Cloudinary;
-- -- see routes/student.ts — until it is configured, certificates are
-- -- recorded by title/issuer/date/link, never by a fake file). ─────────────
ALTER TABLE certificates ADD COLUMN IF NOT EXISTS credential_url TEXT;

-- ── Resumes: local-disk fallback when Cloudinary is not configured ───────
-- `storage='cloudinary'` keeps the Phase 0 behaviour (cloudinary_url +
-- public_id). `storage='local'` stores the file under server/uploads/ and
-- records its path in local_path; cloudinary_url/public_id stay NULL.
-- Either way the row — and the file it points at — is real.
ALTER TABLE resumes ADD COLUMN IF NOT EXISTS storage TEXT NOT NULL DEFAULT 'cloudinary'
    CHECK (storage IN ('cloudinary', 'local'));
ALTER TABLE resumes ADD COLUMN IF NOT EXISTS local_path TEXT;
ALTER TABLE resumes ALTER COLUMN cloudinary_url DROP NOT NULL;
ALTER TABLE resumes ALTER COLUMN public_id DROP NOT NULL;
