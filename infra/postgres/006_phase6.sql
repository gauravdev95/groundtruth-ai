-- Ground Truth AI — Phase 6 pipeline / evidence / analytics schema.
--
-- The pipeline board and analytics need one thing the Phase 0 schema
-- never stored: WHEN an application moved between stages. `applications`
-- only keeps the current status + updated_at, so "time to first response"
-- and any honest stage history cannot be derived from it — and the old
-- repo answered the same question from its audit log, not from a
-- timestamp column (apps/backend/src/domains/pipeline/analytics.py).
--
-- `application_status_history` is that audit trail, scoped to status
-- transitions only: one row per move, written by
-- services/applications.ts::updateApplicationStatus at the same time as
-- the status update. No backfill is attempted — applications moved
-- before this migration have no history rows, and analytics reports
-- "not enough data yet" for them instead of inventing a first-response
-- time from updated_at.
--
-- Nothing else is needed: evidence already lives in the Phase 0/2
-- tables (verification_results, resumes, certificates, candidate_skills
-- with source, candidate_projects, candidate_coding_profiles,
-- evidence_reports) and analytics aggregates jobs / applications /
-- matches directly. Run via `npm run migrate` in server/ (applies
-- infra/postgres/*.sql in order). Idempotent: every statement uses
-- IF NOT EXISTS.

-- ── application_status_history: one row per pipeline move ───────────────
CREATE TABLE IF NOT EXISTS application_status_history (
    id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    application_id UUID NOT NULL REFERENCES applications (id) ON DELETE CASCADE,
    from_status    TEXT NOT NULL
                   CHECK (from_status IN ('applied', 'reviewing', 'interview', 'offer', 'rejected', 'withdrawn')),
    to_status      TEXT NOT NULL
                   CHECK (to_status IN ('applied', 'reviewing', 'interview', 'offer', 'rejected', 'withdrawn')),
    changed_by     UUID REFERENCES users (id) ON DELETE SET NULL,
    created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_app_status_history_application
    ON application_status_history (application_id, created_at);
CREATE INDEX IF NOT EXISTS idx_app_status_history_created
    ON application_status_history (created_at DESC);

-- ── applications: status lookups for the board + analytics ──────────────
CREATE INDEX IF NOT EXISTS idx_applications_status
    ON applications (status);
CREATE INDEX IF NOT EXISTS idx_applications_job_status
    ON applications (job_id, status);
