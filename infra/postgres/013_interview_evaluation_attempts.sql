-- 013_interview_evaluation_attempts.sql — P0 F3: interview answer
-- evaluation reliability / retry system.
--
-- Root cause: when the live scoring call failed, interviewSession.ts
-- caught the failure silently, stored the answer with evaluation status
-- "pending" and a generic note, and recorded the cause nowhere — no
-- retry, no attempt record, no log line. One of 7 answers in the live
-- E2E run stayed pending for exactly this reason.
--
-- Table:
--   interview_evaluation_attempts  one row per scoring attempt for one
--                        (interview, question). Attempt 1 is the initial
--                        scoring at submit time; attempts 2+ are retries
--                        (see retryEvaluation in services/interviewSession.ts).
--                        The row records the outcome AND the structured,
--                        safe failure reason — never prompt/answer content
--                        (failure_detail carries only kind, HTTP status
--                        and a short provider-error string).
-- Columns:
--   attempt_number   1-based per (interview_id, question_id).
--   state            pending | processing | completed |
--                    retryable_failed | permanently_failed.
--   failure_kind     timeout | rate_limited (HTTP 429) | server_error
--                    (HTTP 5xx / other provider HTTP errors) |
--                    network_error | invalid_response (invalid JSON or
--                    failed schema validation) | unknown. NULL on
--                    completed attempts.
--   failure_detail   JSONB {kind, httpStatus?, detail} — structured and
--                    safe; no prompt, answer, or secret content.
--   provider/model   as labelled on the evaluation ("live"/"mock").
--   evaluation/score the successful scoring result, stored HERE — not
--                    on interview_answers. interview_answers is immutable
--                    (011 trigger rejects UPDATE), so a retry that
--                    succeeds must not rewrite the answer row; the report
--                    (computeSessionReport) reads a completed attempt
--                    instead. The submitted answer text is never touched.
--   duration_ms      wall time of that scoring attempt.
--   retry_count      attempts already consumed for this question before
--                    this one (attempt_number - 1).
-- Guarantees:
--   UNIQUE (interview_id, question_id, attempt_number) — attempt
--     numbers never collide.
--   Partial UNIQUE index (interview_id, question_id) WHERE state IN
--     ('pending', 'processing') — at most ONE in-flight attempt per
--     question; a second concurrent retry claim fails with 23505 and
--     the service turns it into a 409.
--   No UPDATE trigger on this table: state transitions
--     processing -> completed / retryable_failed / permanently_failed
--     are ordinary UPDATEs by the service that owns the attempt.
-- Idempotent by convention: CREATE TABLE IF NOT EXISTS,
-- CREATE INDEX IF NOT EXISTS. No DOWN migration by design — rollback
-- is a pre-migration backup restore (see docs/MIGRATION_GUIDE.md).

CREATE TABLE IF NOT EXISTS interview_evaluation_attempts (
    id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    interview_id   UUID NOT NULL REFERENCES interviews (id) ON DELETE CASCADE,
    question_id    UUID NOT NULL REFERENCES interview_questions (id) ON DELETE CASCADE,
    attempt_number INTEGER NOT NULL CHECK (attempt_number >= 1),
    state          TEXT NOT NULL DEFAULT 'pending'
                   CHECK (state IN ('pending', 'processing', 'completed',
                                    'retryable_failed', 'permanently_failed')),
    failure_kind   TEXT CHECK (failure_kind IS NULL OR failure_kind IN
                              ('timeout', 'rate_limited', 'server_error',
                               'network_error', 'invalid_response', 'unknown')),
    failure_detail JSONB NOT NULL DEFAULT '{}'::jsonb,
    provider       TEXT,
    model          TEXT,
    evaluation     JSONB,
    score          NUMERIC(5, 2),
    duration_ms    INTEGER CHECK (duration_ms IS NULL OR duration_ms >= 0),
    retry_count    INTEGER NOT NULL DEFAULT 0 CHECK (retry_count >= 0),
    created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (interview_id, question_id, attempt_number)
);

-- At most one in-flight (pending/processing) attempt per question:
-- the duplicate-scoring guard. A concurrent retry claim that violates
-- this index gets 23505, which the service maps to HTTP 409.
CREATE UNIQUE INDEX IF NOT EXISTS idx_eval_attempts_one_inflight
    ON interview_evaluation_attempts (interview_id, question_id)
    WHERE state IN ('pending', 'processing');

CREATE INDEX IF NOT EXISTS idx_eval_attempts_interview
    ON interview_evaluation_attempts (interview_id, attempt_number);
CREATE INDEX IF NOT EXISTS idx_eval_attempts_question
    ON interview_evaluation_attempts (question_id, attempt_number);
CREATE INDEX IF NOT EXISTS idx_eval_attempts_state
    ON interview_evaluation_attempts (interview_id, state);
