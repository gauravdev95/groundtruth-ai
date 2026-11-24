-- Ground Truth AI — Assessment system schema (Phases 2-11).
--
-- AI-powered engineering assessment: profile strength analysis, project
-- selection + repository analysis, challenge generation, Live Engineering
-- Lab, sandboxed execution, monitoring, automated evaluation, personalized
-- technical interview, verified engineering profile.
--
-- Reuse first: the `interviews` table from 001_init.sql is REUSED for the
-- interview engine (columns added below), `candidate_projects` (004) is the
-- single selected project, `verification_results` / `candidate_skills` stay
-- the evidence sources. Nothing here duplicates an existing table.
-- Run via `npm run migrate` in server/ (applies infra/postgres/*.sql in
-- order). Idempotent: every statement uses IF NOT EXISTS.
--
-- No destructive statements, no data overwrites, no dropped columns.

-- ── Profile strength analysis history ────────────────────────────────────
-- One row per analysis run; the latest row for a candidate is current.
-- Scores are computed from real profile data (services/strength.ts) —
-- never invented, never stored from a client claim.
CREATE TABLE IF NOT EXISTS profile_analyses (
    id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    candidate_id     UUID NOT NULL REFERENCES candidates (id) ON DELETE CASCADE,
    overall_score    INTEGER NOT NULL CHECK (overall_score BETWEEN 0 AND 100),
    category_scores  JSONB NOT NULL DEFAULT '{}'::jsonb,
    missing          JSONB NOT NULL DEFAULT '[]'::jsonb,
    weak_areas       JSONB NOT NULL DEFAULT '[]'::jsonb,
    recommendations  JSONB NOT NULL DEFAULT '[]'::jsonb,
    suggested_skills TEXT[] NOT NULL DEFAULT '{}',
    ai_available     BOOLEAN NOT NULL DEFAULT FALSE,
    ai_summary       TEXT,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_profile_analyses_candidate
    ON profile_analyses (candidate_id, created_at DESC);

-- ── Assessment repositories ──────────────────────────────────────────────
-- A repository selected for one assessment. Source is either the student's
-- single profile project, a GitHub URL, a connected GitHub account, or
-- manual details. GitHub connection is OPTIONAL for profile creation and
-- required only for a GitHub-based practical assessment.
CREATE TABLE IF NOT EXISTS assessment_repositories (
    id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    candidate_id   UUID NOT NULL REFERENCES candidates (id) ON DELETE CASCADE,
    project_id     UUID REFERENCES candidate_projects (id) ON DELETE SET NULL,
    source         TEXT NOT NULL CHECK (source IN
                       ('profile_project', 'github_url', 'github_account', 'manual')),
    repo_url       TEXT,
    repo_name      TEXT,
    default_branch TEXT,
    created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_assessment_repos_candidate
    ON assessment_repositories (candidate_id, created_at DESC);

-- ── Repository analysis reports ──────────────────────────────────────────
-- Deterministic analysis (languages, frameworks, deps, structure, entry
-- points, tests, APIs, DB integrations, quality signals). Analysis NEVER
-- executes repository code; file contents are never stored here, only
-- derived metadata — README/comments/code cannot inject prompts.
CREATE TABLE IF NOT EXISTS repo_analyses (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    repository_id   UUID NOT NULL REFERENCES assessment_repositories (id) ON DELETE CASCADE,
    languages       JSONB NOT NULL DEFAULT '{}'::jsonb,
    frameworks      TEXT[] NOT NULL DEFAULT '{}',
    dependencies    JSONB NOT NULL DEFAULT '[]'::jsonb,
    structure       JSONB NOT NULL DEFAULT '{}'::jsonb,
    entry_points    JSONB NOT NULL DEFAULT '[]'::jsonb,
    tests           JSONB NOT NULL DEFAULT '{}'::jsonb,
    api_endpoints   JSONB NOT NULL DEFAULT '[]'::jsonb,
    db_integrations TEXT[] NOT NULL DEFAULT '{}',
    quality         JSONB NOT NULL DEFAULT '{}'::jsonb,
    summary         TEXT,
    analyzed_by     TEXT NOT NULL DEFAULT 'deterministic',
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_repo_analyses_repo
    ON repo_analyses (repository_id, created_at DESC);

-- ── Assessments ──────────────────────────────────────────────────────────
-- One assessment = one candidate + one selected project + one challenge.
-- Status flow: draft → ready → active → submitted → evaluating →
-- completed | failed. Only one non-terminal assessment per candidate.
CREATE TABLE IF NOT EXISTS assessments (
    id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    candidate_id       UUID NOT NULL REFERENCES candidates (id) ON DELETE CASCADE,
    repository_id      UUID REFERENCES assessment_repositories (id) ON DELETE SET NULL,
    project_id         UUID REFERENCES candidate_projects (id) ON DELETE SET NULL,
    status             TEXT NOT NULL DEFAULT 'draft'
                       CHECK (status IN ('draft', 'ready', 'active', 'submitted',
                                        'evaluating', 'completed', 'failed', 'cancelled')),
    time_limit_minutes INTEGER NOT NULL DEFAULT 60
                       CHECK (time_limit_minutes IN (30, 45, 60, 90)),
    started_at         TIMESTAMPTZ,
    submitted_at       TIMESTAMPTZ,
    ended_at           TIMESTAMPTZ,
    consent_given_at   TIMESTAMPTZ,
    consent_version    TEXT,
    created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_assessments_candidate
    ON assessments (candidate_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_assessments_status
    ON assessments (status);
CREATE UNIQUE INDEX IF NOT EXISTS idx_assessments_one_active
    ON assessments (candidate_id)
    WHERE status IN ('ready', 'active', 'submitted', 'evaluating');

-- ── Challenges ───────────────────────────────────────────────────────────
-- One challenge per assessment. hidden_tests is server-only: it is never
-- serialized to any client response (see services/challenge.ts).
CREATE TABLE IF NOT EXISTS challenges (
    id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    assessment_id         UUID NOT NULL REFERENCES assessments (id) ON DELETE CASCADE,
    title                 TEXT NOT NULL,
    problem_statement     TEXT NOT NULL,
    repo_context          JSONB NOT NULL DEFAULT '{}'::jsonb,
    required_functionality JSONB NOT NULL DEFAULT '[]'::jsonb,
    acceptance_criteria   JSONB NOT NULL DEFAULT '[]'::jsonb,
    difficulty            TEXT NOT NULL DEFAULT 'medium'
                          CHECK (difficulty IN ('easy', 'medium', 'hard')),
    deliverables          JSONB NOT NULL DEFAULT '[]'::jsonb,
    allowed_tools         JSONB NOT NULL DEFAULT '[]'::jsonb,
    time_limit_minutes    INTEGER NOT NULL DEFAULT 60
                          CHECK (time_limit_minutes IN (30, 45, 60, 90)),
    test_strategy         JSONB NOT NULL DEFAULT '{}'::jsonb,
    hidden_tests          JSONB NOT NULL DEFAULT '[]'::jsonb,
    generated_by          TEXT NOT NULL DEFAULT 'deterministic'
                          CHECK (generated_by IN ('deterministic', 'llm', 'mock')),
    validation            JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (assessment_id)
);
CREATE INDEX IF NOT EXISTS idx_challenges_assessment
    ON challenges (assessment_id);

-- ── Challenge test cases (visible + hidden) ──────────────────────────────
CREATE TABLE IF NOT EXISTS challenge_test_cases (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    challenge_id UUID NOT NULL REFERENCES challenges (id) ON DELETE CASCADE,
    kind         TEXT NOT NULL CHECK (kind IN ('visible', 'hidden')),
    name         TEXT NOT NULL,
    description  TEXT NOT NULL DEFAULT '',
    command      TEXT NOT NULL,
    expected     TEXT,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_challenge_tests_challenge
    ON challenge_test_cases (challenge_id, kind);

-- ── Execution sessions (Live Lab workspaces) ─────────────────────────────
-- workspace_path is a server-side directory under a configured sandbox root.
-- sandbox_backend records how isolation was achieved: 'unshare' (Linux user
-- + network + mount + pid namespaces) or 'disabled' (no safe sandbox
-- available — arbitrary execution is refused, never faked).
CREATE TABLE IF NOT EXISTS execution_sessions (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    assessment_id   UUID NOT NULL REFERENCES assessments (id) ON DELETE CASCADE,
    candidate_id    UUID NOT NULL REFERENCES candidates (id) ON DELETE CASCADE,
    workspace_path  TEXT,
    status          TEXT NOT NULL DEFAULT 'active'
                    CHECK (status IN ('active', 'closed', 'expired')),
    sandbox_backend TEXT NOT NULL DEFAULT 'disabled'
                    CHECK (sandbox_backend IN ('unshare', 'disabled')),
    started_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    ended_at        TIMESTAMPTZ,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_exec_sessions_assessment
    ON execution_sessions (assessment_id, created_at DESC);

-- ── Lab workspace files (persisted in the DB, not only on disk) ──────────
-- The Lab edits files through the API; the DB is the source of truth so a
-- workspace survives restarts. Content is the candidate's own code.
CREATE TABLE IF NOT EXISTS assessment_files (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    assessment_id UUID NOT NULL REFERENCES assessments (id) ON DELETE CASCADE,
    path          TEXT NOT NULL,
    content       TEXT NOT NULL DEFAULT '',
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (assessment_id, path)
);
CREATE INDEX IF NOT EXISTS idx_assessment_files_assessment
    ON assessment_files (assessment_id);

-- ── Versioned code snapshots (submission evidence) ───────────────────────
-- Immutable: a snapshot row is never updated. snapshot_hash is the SHA-256
-- of the canonical file list; evaluation runs against this exact snapshot.
CREATE TABLE IF NOT EXISTS code_snapshots (
    id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    assessment_id  UUID NOT NULL REFERENCES assessments (id) ON DELETE CASCADE,
    candidate_id   UUID NOT NULL REFERENCES candidates (id) ON DELETE CASCADE,
    version        INTEGER NOT NULL CHECK (version >= 0), -- v0 = original code at Lab start; submit creates v1, v2, ...
    snapshot_hash  TEXT NOT NULL,
    files          JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (assessment_id, version)
);
CREATE INDEX IF NOT EXISTS idx_code_snapshots_assessment
    ON code_snapshots (assessment_id, version);

-- ── Monitoring: consent (recorded BEFORE an assessment starts) ───────────
CREATE TABLE IF NOT EXISTS monitoring_consent_records (
    id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    candidate_id         UUID NOT NULL REFERENCES candidates (id) ON DELETE CASCADE,
    assessment_id        UUID REFERENCES assessments (id) ON DELETE SET NULL,
    consent_version      TEXT NOT NULL DEFAULT 'v1',
    collected            TEXT[] NOT NULL DEFAULT '{}',
    purpose              TEXT NOT NULL DEFAULT '',
    retention_days       INTEGER NOT NULL DEFAULT 90,
    recruiter_visibility TEXT NOT NULL DEFAULT '',
    given_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
    revoked_at           TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_consent_candidate
    ON monitoring_consent_records (candidate_id, given_at DESC);
CREATE INDEX IF NOT EXISTS idx_consent_assessment
    ON monitoring_consent_records (assessment_id);

-- ── Monitoring: generic assessment events (audit history) ────────────────
-- Every event carries assessment_id, candidate_id, session_id, event_type,
-- timestamp, file/action, metadata. Retention is enforced by a scheduled
-- cleanup (see services/monitoring.ts) using consent retention_days.
CREATE TABLE IF NOT EXISTS assessment_events (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    assessment_id UUID NOT NULL REFERENCES assessments (id) ON DELETE CASCADE,
    candidate_id  UUID NOT NULL REFERENCES candidates (id) ON DELETE CASCADE,
    session_id    TEXT NOT NULL,
    event_type    TEXT NOT NULL,
    file_path     TEXT,
    metadata      JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_assessment_events_assessment
    ON assessment_events (assessment_id, created_at);
CREATE INDEX IF NOT EXISTS idx_assessment_events_candidate
    ON assessment_events (candidate_id, created_at);
CREATE INDEX IF NOT EXISTS idx_assessment_events_type
    ON assessment_events (assessment_id, event_type, created_at);

-- ── Monitoring: activity snapshots ───────────────────────────────────────
CREATE TABLE IF NOT EXISTS activity_snapshots (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    assessment_id UUID NOT NULL REFERENCES assessments (id) ON DELETE CASCADE,
    snapshot_hash TEXT NOT NULL,
    file_count    INTEGER NOT NULL DEFAULT 0,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_activity_snapshots_assessment
    ON activity_snapshots (assessment_id, created_at DESC);

-- ── Monitoring: code change events ───────────────────────────────────────
CREATE TABLE IF NOT EXISTS code_change_events (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    assessment_id UUID NOT NULL REFERENCES assessments (id) ON DELETE CASCADE,
    file_path     TEXT NOT NULL,
    change_type   TEXT NOT NULL CHECK (change_type IN ('created', 'modified', 'deleted')),
    diff_summary  JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_code_changes_assessment
    ON code_change_events (assessment_id, created_at);

-- ── Monitoring: terminal execution events ────────────────────────────────
CREATE TABLE IF NOT EXISTS terminal_execution_events (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    assessment_id UUID NOT NULL REFERENCES assessments (id) ON DELETE CASCADE,
    session_id    TEXT NOT NULL,
    command       TEXT NOT NULL,
    exit_code     INTEGER,
    duration_ms   INTEGER,
    output_excerpt TEXT,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_terminal_events_assessment
    ON terminal_execution_events (assessment_id, created_at);

-- ── Monitoring: test execution events ────────────────────────────────────
CREATE TABLE IF NOT EXISTS test_execution_events (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    assessment_id UUID NOT NULL REFERENCES assessments (id) ON DELETE CASCADE,
    session_id    TEXT NOT NULL,
    test_command  TEXT NOT NULL,
    passed        INTEGER NOT NULL DEFAULT 0,
    failed        INTEGER NOT NULL DEFAULT 0,
    total         INTEGER NOT NULL DEFAULT 0,
    results       JSONB NOT NULL DEFAULT '[]'::jsonb,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_test_events_assessment
    ON test_execution_events (assessment_id, created_at);

-- ── Monitoring: AI activity summaries ────────────────────────────────────
CREATE TABLE IF NOT EXISTS monitoring_summaries (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    assessment_id UUID NOT NULL REFERENCES assessments (id) ON DELETE CASCADE,
    summary      JSONB NOT NULL DEFAULT '{}'::jsonb,
    progress     JSONB NOT NULL DEFAULT '{}'::jsonb,
    generated_by TEXT NOT NULL DEFAULT 'deterministic',
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_monitoring_summaries_assessment
    ON monitoring_summaries (assessment_id, created_at DESC);

-- ── Monitoring: integrity findings (review indicators, NOT verdicts) ─────
-- status is a review indicator only; nothing here auto-rejects a candidate.
CREATE TABLE IF NOT EXISTS integrity_findings (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    assessment_id UUID NOT NULL REFERENCES assessments (id) ON DELETE CASCADE,
    finding_type TEXT NOT NULL,
    severity     TEXT NOT NULL CHECK (severity IN ('info', 'review', 'human_review')),
    status       TEXT NOT NULL CHECK (status IN
                     ('no_issues', 'review_recommended', 'human_review_required')),
    evidence     JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_integrity_assessment
    ON integrity_findings (assessment_id, created_at);

-- ── Evaluations (hybrid: deterministic tests + AI qualitative review) ───
-- One evaluation per assessment. category_scores must sum to the weighted
-- overall (functional 30 / quality 20 / problem-solving 20 / understanding
-- 15 / testing 15); the server computes the overall from the parts.
CREATE TABLE IF NOT EXISTS evaluations (
    id                        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    assessment_id             UUID NOT NULL REFERENCES assessments (id) ON DELETE CASCADE,
    overall_score             NUMERIC(5, 2),
    category_scores           JSONB NOT NULL DEFAULT '{}'::jsonb,
    evidence                  JSONB NOT NULL DEFAULT '{}'::jsonb,
    passed_tests              JSONB NOT NULL DEFAULT '[]'::jsonb,
    failed_tests              JSONB NOT NULL DEFAULT '[]'::jsonb,
    quality_issues            JSONB NOT NULL DEFAULT '[]'::jsonb,
    security_findings         JSONB NOT NULL DEFAULT '[]'::jsonb,
    improvements              JSONB NOT NULL DEFAULT '[]'::jsonb,
    strengths                 JSONB NOT NULL DEFAULT '[]'::jsonb,
    weaknesses                JSONB NOT NULL DEFAULT '[]'::jsonb,
    confidence                NUMERIC(3, 2),
    human_review_recommended  BOOLEAN NOT NULL DEFAULT FALSE,
    status                    TEXT NOT NULL DEFAULT 'pending'
                              CHECK (status IN ('pending', 'completed', 'failed')),
    created_at                TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (assessment_id)
);
CREATE INDEX IF NOT EXISTS idx_evaluations_assessment
    ON evaluations (assessment_id);

-- ── Interviews: REUSE the 001 `interviews` table ─────────────────────────
-- The old table has candidate_id, job_id, status, transcript, score.
-- Assessment interviews add the assessment link, type, and structured report.
ALTER TABLE interviews ADD COLUMN IF NOT EXISTS assessment_id UUID REFERENCES assessments (id) ON DELETE SET NULL;
ALTER TABLE interviews ADD COLUMN IF NOT EXISTS interview_type TEXT NOT NULL DEFAULT 'assessment'
    CHECK (interview_type IN ('assessment', 'screening', 'other'));
ALTER TABLE interviews ADD COLUMN IF NOT EXISTS report JSONB;
ALTER TABLE interviews ADD COLUMN IF NOT EXISTS model TEXT;
CREATE INDEX IF NOT EXISTS idx_interviews_assessment ON interviews (assessment_id);

-- ── Interview questions ──────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS interview_questions (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    interview_id  UUID NOT NULL REFERENCES interviews (id) ON DELETE CASCADE,
    category      TEXT NOT NULL CHECK (category IN
                      ('project_understanding', 'architecture_design',
                       'code_changes', 'fundamentals', 'debugging',
                       'security_performance', 'testing_edge_cases', 'follow_up')),
    question      TEXT NOT NULL,
    question_order INTEGER NOT NULL DEFAULT 0,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_interview_questions_interview
    ON interview_questions (interview_id, question_order);

-- ── Interview answers + per-answer evaluation ────────────────────────────
CREATE TABLE IF NOT EXISTS interview_answers (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    question_id   UUID NOT NULL REFERENCES interview_questions (id) ON DELETE CASCADE,
    answer        TEXT NOT NULL,
    evaluation    JSONB NOT NULL DEFAULT '{}'::jsonb,
    score         NUMERIC(5, 2),
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (question_id)
);
CREATE INDEX IF NOT EXISTS idx_interview_answers_question
    ON interview_answers (question_id);

-- ── Verified skills (evidence-backed only) ───────────────────────────────
-- A skill is 'verified' only when an assessment/evaluation produced
-- evidence for it. Untested skills are never labelled verified.
CREATE TABLE IF NOT EXISTS verified_skills (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    candidate_id  UUID NOT NULL REFERENCES candidates (id) ON DELETE CASCADE,
    skill_id      UUID NOT NULL REFERENCES skills (id) ON DELETE CASCADE,
    assessment_id UUID REFERENCES assessments (id) ON DELETE SET NULL,
    evidence      JSONB NOT NULL DEFAULT '{}'::jsonb,
    status        TEXT NOT NULL DEFAULT 'verified'
                  CHECK (status IN ('verified', 'pending', 'revoked')),
    verified_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (candidate_id, skill_id)
);
CREATE INDEX IF NOT EXISTS idx_verified_skills_candidate
    ON verified_skills (candidate_id);
CREATE INDEX IF NOT EXISTS idx_verified_skills_assessment
    ON verified_skills (assessment_id);
