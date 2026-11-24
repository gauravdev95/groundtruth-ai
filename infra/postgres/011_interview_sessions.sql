-- 011_interview_sessions.sql — Phase C: real AI technical interview sessions.
--
-- Tables:
--   interview_sessions   one row per interview attempt: lifecycle
--                        not_started -> intro -> ready -> in_progress ->
--                        completed | expired. One ACTIVE session per
--                        interview (partial unique index). Server-authoritative
--                        timers live here (started_at / expires_at and the
--                        current-question shown_at / deadline_at).
--   interview_followups  at most ONE follow-up per interview (UNIQUE on
--                        interview_id) and at most one per original question
--                        (UNIQUE on original_question_id). Follow-up answers
--                        are stored HERE, never in interview_answers, so the
--                        original answer stays immutable.
--   interview_reports    immutable interview report (final score, 5-dimension
--                        averages, per-competency scores, timing, provider
--                        labels). A trigger rejects UPDATE/DELETE — a report
--                        is written once by the explicit finish transition.
-- Columns added:
--   interview_questions  competency_id, difficulty, expected_points,
--                        scoring_rubric, max_time_seconds, context,
--                        framework_version, source (pre_generated/follow_up),
--                        is_follow_up, follow_up_of_question_id — every
--                        pre-generated question carries its full spec BEFORE
--                        the session starts; nothing is generated live.
--   interview_answers    answered_at, locked_at, time_spent_seconds,
--                        question_shown_at, deadline_at,
--                        short_warning_acknowledged, evaluation_provider,
--                        evaluation_model. A trigger rejects UPDATE — an
--                        answer is insert-once; a re-submit is a 409 in the
--                        service layer (the old ON CONFLICT DO UPDATE
--                        re-submit behaviour is removed in Phase C).
-- Idempotent by convention: CREATE TABLE/INDEX IF NOT EXISTS,
-- ADD COLUMN IF NOT EXISTS, CREATE OR REPLACE for triggers/functions.
-- No DOWN migration by design — rollback is a pre-migration backup
-- restore (see docs/MIGRATION_GUIDE.md).
-- Judge0 is NOT configured — nothing here claims code-execution results.

-- ── Interview sessions ───────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS interview_sessions (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    interview_id  UUID NOT NULL REFERENCES interviews (id) ON DELETE CASCADE,
    candidate_id  UUID NOT NULL REFERENCES candidates (id) ON DELETE CASCADE,
    status        TEXT NOT NULL DEFAULT 'not_started'
                  CHECK (status IN ('not_started', 'intro', 'ready',
                                    'in_progress', 'completed', 'expired')),
    started_at    TIMESTAMPTZ,
    expires_at    TIMESTAMPTZ,
    readiness_ack_at TIMESTAMPTZ,
    completed_at  TIMESTAMPTZ,
    current_question_id UUID REFERENCES interview_questions (id) ON DELETE SET NULL,
    current_question_shown_at TIMESTAMPTZ,
    current_question_deadline_at TIMESTAMPTZ,
    questions_total INTEGER NOT NULL DEFAULT 7 CHECK (questions_total > 0),
    follow_ups_used INTEGER NOT NULL DEFAULT 0 CHECK (follow_ups_used >= 0),
    explain_again_count INTEGER NOT NULL DEFAULT 0 CHECK (explain_again_count >= 0),
    explain_again_by_question JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
-- One ACTIVE session per interview: a second active session for the same
-- interview cannot be created while one is not_started/intro/ready/in_progress.
CREATE UNIQUE INDEX IF NOT EXISTS idx_interview_sessions_one_active
    ON interview_sessions (interview_id)
    WHERE status IN ('not_started', 'intro', 'ready', 'in_progress');
CREATE INDEX IF NOT EXISTS idx_interview_sessions_interview
    ON interview_sessions (interview_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_interview_sessions_candidate
    ON interview_sessions (candidate_id, created_at DESC);

-- ── Interview follow-ups ─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS interview_followups (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    interview_id  UUID NOT NULL REFERENCES interviews (id) ON DELETE CASCADE,
    session_id    UUID NOT NULL REFERENCES interview_sessions (id) ON DELETE CASCADE,
    original_question_id UUID NOT NULL REFERENCES interview_questions (id) ON DELETE CASCADE,
    question_id   UUID NOT NULL UNIQUE REFERENCES interview_questions (id) ON DELETE CASCADE,
    answer        TEXT,
    evaluation    JSONB NOT NULL DEFAULT '{}'::jsonb,
    score         NUMERIC(5, 2),
    answered_at   TIMESTAMPTZ,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    -- Max ONE follow-up per interview (and therefore at most one per
    -- original question): the cap is enforced by the database, not just
    -- by the service layer.
    UNIQUE (interview_id),
    UNIQUE (original_question_id)
);
CREATE INDEX IF NOT EXISTS idx_interview_followups_interview
    ON interview_followups (interview_id);
CREATE INDEX IF NOT EXISTS idx_interview_followups_session
    ON interview_followups (session_id);

-- ── Immutable interview reports ──────────────────────────────────────────
CREATE TABLE IF NOT EXISTS interview_reports (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    interview_id  UUID NOT NULL UNIQUE REFERENCES interviews (id) ON DELETE CASCADE,
    candidate_id  UUID NOT NULL REFERENCES candidates (id) ON DELETE CASCADE,
    assessment_id UUID REFERENCES assessments (id) ON DELETE SET NULL,
    role_id       TEXT NOT NULL,
    framework_version TEXT NOT NULL,
    final_score   NUMERIC(5, 2),
    dimension_averages JSONB NOT NULL DEFAULT '{}'::jsonb,
    competency_scores  JSONB NOT NULL DEFAULT '[]'::jsonb,
    report        JSONB NOT NULL,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_interview_reports_candidate
    ON interview_reports (candidate_id, created_at DESC);

-- ── Pre-generated question spec (Phase C) ────────────────────────────────
ALTER TABLE interview_questions ADD COLUMN IF NOT EXISTS competency_id TEXT;
ALTER TABLE interview_questions ADD COLUMN IF NOT EXISTS difficulty TEXT
    CHECK (difficulty IS NULL OR difficulty IN ('Foundation', 'Intermediate', 'Advanced'));
ALTER TABLE interview_questions ADD COLUMN IF NOT EXISTS expected_points JSONB NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE interview_questions ADD COLUMN IF NOT EXISTS scoring_rubric JSONB NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE interview_questions ADD COLUMN IF NOT EXISTS max_time_seconds INTEGER NOT NULL DEFAULT 300 CHECK (max_time_seconds > 0);
ALTER TABLE interview_questions ADD COLUMN IF NOT EXISTS context JSONB NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE interview_questions ADD COLUMN IF NOT EXISTS framework_version TEXT;
ALTER TABLE interview_questions ADD COLUMN IF NOT EXISTS source TEXT NOT NULL DEFAULT 'pre_generated'
    CHECK (source IN ('pre_generated', 'follow_up'));
ALTER TABLE interview_questions ADD COLUMN IF NOT EXISTS is_follow_up BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE interview_questions ADD COLUMN IF NOT EXISTS follow_up_of_question_id UUID REFERENCES interview_questions (id) ON DELETE CASCADE;
CREATE INDEX IF NOT EXISTS idx_interview_questions_competency
    ON interview_questions (interview_id, competency_id);

-- ── Answer locking + timing + provider labels (Phase C) ──────────────────
ALTER TABLE interview_answers ADD COLUMN IF NOT EXISTS answered_at TIMESTAMPTZ;
ALTER TABLE interview_answers ADD COLUMN IF NOT EXISTS locked_at TIMESTAMPTZ;
ALTER TABLE interview_answers ADD COLUMN IF NOT EXISTS time_spent_seconds INTEGER;
ALTER TABLE interview_answers ADD COLUMN IF NOT EXISTS question_shown_at TIMESTAMPTZ;
ALTER TABLE interview_answers ADD COLUMN IF NOT EXISTS deadline_at TIMESTAMPTZ;
ALTER TABLE interview_answers ADD COLUMN IF NOT EXISTS short_warning_acknowledged BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE interview_answers ADD COLUMN IF NOT EXISTS evaluation_provider TEXT;
ALTER TABLE interview_answers ADD COLUMN IF NOT EXISTS evaluation_model TEXT;

-- ── Immutability triggers ────────────────────────────────────────────────
-- An interview answer is insert-once: any UPDATE is rejected at the
-- database level, so no code path (old or new) can silently rewrite a
-- submitted answer. Same for a finished interview report — UPDATE is
-- rejected, but DELETE is allowed so a report can still be erased with
-- its parent interview (e.g. candidate erasure / test cleanup).
CREATE OR REPLACE FUNCTION reject_interview_answer_update()
RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'interview_answers is immutable: submitted answers cannot be updated (question_id=%)', OLD.question_id;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_interview_answers_immutable ON interview_answers;
CREATE TRIGGER trg_interview_answers_immutable
  BEFORE UPDATE ON interview_answers
  FOR EACH ROW EXECUTE FUNCTION reject_interview_answer_update();

CREATE OR REPLACE FUNCTION reject_interview_report_change()
RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'interview_reports is immutable: a finished report cannot be changed (interview_id=%)', OLD.interview_id;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_interview_reports_immutable ON interview_reports;
CREATE TRIGGER trg_interview_reports_immutable
  BEFORE UPDATE ON interview_reports
  FOR EACH ROW EXECUTE FUNCTION reject_interview_report_change();
