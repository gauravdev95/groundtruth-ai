-- 014_followup_retry.sql — P1 F5: follow-up evaluation retry +
-- auth-failure classification.
--
-- Follow-up retry needs NO new column: a follow-up question is a row
-- in interview_questions, so interview_evaluation_attempts (migration
-- 013) already keys its attempts by that question id, and
-- retryEvaluation re-scores the stored follow-up answer from
-- interview_followups. The only schema change here is widening the
-- failure_kind CHECK so 401/403 provider failures get their own kind:
--
--   auth_failed  HTTP 401/403 from the provider (bad / expired /
--                revoked key). Distinct from server_error (5xx): an
--                auth failure will not fix itself by retrying with the
--                same key, and the fix is a new key, not more attempts.
--                Retry budget: 2 total attempts when every failure is
--                auth_failed (same cap as invalid_response — see
--                maxAttemptsForFailureKinds in interviewSession.ts).
--
-- Idempotent by convention: DROP CONSTRAINT IF EXISTS + ADD
-- CONSTRAINT with the same deterministic name Postgres gave the
-- inline CHECK in 013 (interview_evaluation_attempts_failure_kind_check),
-- so re-running this file is safe. No DOWN migration by design —
-- rollback is a pre-migration backup restore (see
-- docs/MIGRATION_GUIDE.md).

ALTER TABLE interview_evaluation_attempts
  DROP CONSTRAINT IF EXISTS interview_evaluation_attempts_failure_kind_check;

ALTER TABLE interview_evaluation_attempts
  ADD CONSTRAINT interview_evaluation_attempts_failure_kind_check
  CHECK (failure_kind IS NULL OR failure_kind IN
         ('timeout', 'rate_limited', 'auth_failed', 'server_error',
          'network_error', 'invalid_response', 'unknown'));
