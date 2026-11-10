-- Ground Truth AI — Phase 0 schema.
-- PostgreSQL 16 + pgvector. Relational records and dense embeddings in one DB.
-- Run via docker-compose (mounted into /docker-entrypoint-initdb.d).

CREATE EXTENSION IF NOT EXISTS "pgcrypto";
CREATE EXTENSION IF NOT EXISTS vector;

-- ── Users & organisations ────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS users (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email         TEXT NOT NULL UNIQUE,
    full_name     TEXT NOT NULL,
    role          TEXT NOT NULL DEFAULT 'candidate'
                  CHECK (role IN ('candidate', 'recruiter', 'admin')),
    password_hash TEXT,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_users_email ON users (email);

CREATE TABLE IF NOT EXISTS companies (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name        TEXT NOT NULL,
    website     TEXT,
    description TEXT,
    created_by  UUID REFERENCES users (id) ON DELETE SET NULL,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_companies_name ON companies (name);

-- ── Jobs ─────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS jobs (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    company_id   UUID NOT NULL REFERENCES companies (id) ON DELETE CASCADE,
    title        TEXT NOT NULL,
    description  TEXT NOT NULL DEFAULT '',
    location     TEXT,
    employment_type TEXT NOT NULL DEFAULT 'full_time'
                 CHECK (employment_type IN ('full_time', 'part_time', 'contract', 'internship')),
    salary_min   INTEGER,
    salary_max   INTEGER,
    salary_currency TEXT NOT NULL DEFAULT 'INR',
    status       TEXT NOT NULL DEFAULT 'open'
                 CHECK (status IN ('draft', 'open', 'closed')),
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_jobs_company ON jobs (company_id);
CREATE INDEX IF NOT EXISTS idx_jobs_status ON jobs (status);
CREATE INDEX IF NOT EXISTS idx_jobs_created ON jobs (created_at DESC);

-- ── Candidates ───────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS candidates (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id     UUID REFERENCES users (id) ON DELETE SET NULL,
    full_name   TEXT NOT NULL,
    email       TEXT NOT NULL UNIQUE,
    headline    TEXT,
    github_url  TEXT,
    linkedin_url TEXT,
    location    TEXT,
    summary     TEXT,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_candidates_email ON candidates (email);

-- ── Evidence artefacts ───────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS resumes (
    id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    candidate_id   UUID NOT NULL REFERENCES candidates (id) ON DELETE CASCADE,
    cloudinary_url TEXT NOT NULL,
    public_id      TEXT NOT NULL,
    file_name      TEXT,
    extracted_text TEXT,
    created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_resumes_candidate ON resumes (candidate_id);

CREATE TABLE IF NOT EXISTS certificates (
    id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    candidate_id   UUID NOT NULL REFERENCES candidates (id) ON DELETE CASCADE,
    title          TEXT NOT NULL,
    issuer         TEXT,
    issued_at      DATE,
    cloudinary_url TEXT,
    public_id      TEXT,
    created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_certificates_candidate ON certificates (candidate_id);

CREATE TABLE IF NOT EXISTS evidence_reports (
    id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    candidate_id   UUID NOT NULL REFERENCES candidates (id) ON DELETE CASCADE,
    title          TEXT NOT NULL,
    cloudinary_url TEXT NOT NULL,
    public_id      TEXT NOT NULL,
    created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_evidence_reports_candidate ON evidence_reports (candidate_id);

-- ── Skills ───────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS skills (
    id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name       TEXT NOT NULL UNIQUE,
    category   TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_skills_name ON skills (name);

CREATE TABLE IF NOT EXISTS candidate_skills (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    candidate_id UUID NOT NULL REFERENCES candidates (id) ON DELETE CASCADE,
    skill_id     UUID NOT NULL REFERENCES skills (id) ON DELETE CASCADE,
    source       TEXT NOT NULL DEFAULT 'resume'
                 CHECK (source IN ('resume', 'github', 'certificate', 'interview', 'manual')),
    confidence   NUMERIC(4, 3) CHECK (confidence >= 0 AND confidence <= 1),
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (candidate_id, skill_id, source)
);
CREATE INDEX IF NOT EXISTS idx_candidate_skills_candidate ON candidate_skills (candidate_id);
CREATE INDEX IF NOT EXISTS idx_candidate_skills_skill ON candidate_skills (skill_id);

CREATE TABLE IF NOT EXISTS job_skills (
    id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    job_id     UUID NOT NULL REFERENCES jobs (id) ON DELETE CASCADE,
    skill_id   UUID NOT NULL REFERENCES skills (id) ON DELETE CASCADE,
    required   BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (job_id, skill_id)
);
CREATE INDEX IF NOT EXISTS idx_job_skills_job ON job_skills (job_id);

-- ── Embeddings (pgvector) ────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS embeddings (
    id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    owner_type TEXT NOT NULL CHECK (owner_type IN ('candidate', 'job')),
    owner_id   UUID NOT NULL,
    embedding  vector(1536) NOT NULL,
    model      TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (owner_type, owner_id, model)
);
CREATE INDEX IF NOT EXISTS idx_embeddings_owner ON embeddings (owner_type, owner_id);
-- Approximate nearest-neighbour search over embeddings.
CREATE INDEX IF NOT EXISTS idx_embeddings_vector
    ON embeddings USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100);

-- ── Verification, interviews, matching, applications ────────────────────
CREATE TABLE IF NOT EXISTS verification_results (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    candidate_id UUID NOT NULL REFERENCES candidates (id) ON DELETE CASCADE,
    source       TEXT NOT NULL CHECK (source IN ('github', 'coding_platform', 'certificate', 'interview')),
    source_ref   TEXT,
    result       JSONB NOT NULL DEFAULT '{}'::jsonb,
    score        NUMERIC(5, 2),
    verified_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_verification_candidate ON verification_results (candidate_id);

CREATE TABLE IF NOT EXISTS interviews (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    candidate_id UUID NOT NULL REFERENCES candidates (id) ON DELETE CASCADE,
    job_id       UUID REFERENCES jobs (id) ON DELETE SET NULL,
    status       TEXT NOT NULL DEFAULT 'scheduled'
                 CHECK (status IN ('scheduled', 'completed', 'cancelled')),
    transcript   TEXT,
    score        NUMERIC(5, 2),
    scheduled_at TIMESTAMPTZ,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_interviews_candidate ON interviews (candidate_id);

CREATE TABLE IF NOT EXISTS matches (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    candidate_id UUID NOT NULL REFERENCES candidates (id) ON DELETE CASCADE,
    job_id       UUID NOT NULL REFERENCES jobs (id) ON DELETE CASCADE,
    score        NUMERIC(5, 4) NOT NULL CHECK (score >= -1 AND score <= 1),
    model        TEXT NOT NULL,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (candidate_id, job_id, model)
);
CREATE INDEX IF NOT EXISTS idx_matches_candidate ON matches (candidate_id);
CREATE INDEX IF NOT EXISTS idx_matches_job ON matches (job_id);
CREATE INDEX IF NOT EXISTS idx_matches_score ON matches (score DESC);

CREATE TABLE IF NOT EXISTS applications (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    candidate_id UUID NOT NULL REFERENCES candidates (id) ON DELETE CASCADE,
    job_id       UUID NOT NULL REFERENCES jobs (id) ON DELETE CASCADE,
    status       TEXT NOT NULL DEFAULT 'applied'
                 CHECK (status IN ('applied', 'reviewing', 'interview', 'offer', 'rejected', 'withdrawn')),
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (candidate_id, job_id)
);
CREATE INDEX IF NOT EXISTS idx_applications_candidate ON applications (candidate_id);
CREATE INDEX IF NOT EXISTS idx_applications_job ON applications (job_id);
