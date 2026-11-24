-- 015_interview_expired_status.sql — Phase 2, G3.7: expired
-- interviews keep their terminal status.
--
-- finalizeSession used to write interviews.status = 'completed' for
-- BOTH terminal paths, so an expired session (e.g. 3/7 answered) was
-- stored as a completed interview source — and collectSources
-- (competencyProfile) treats status='completed' as a profile source.
-- The service now stores the session's terminal status
-- ('completed' | 'expired'), which needs 'expired' in the CHECK the
-- 001 table definition put on interviews.status.
--
-- No data is rewritten: rows already stored as 'completed' for
-- expired sessions stay as they are (their stored reports still
-- carry the honest per-question coverage, so the profile's
-- completeness judgement — from the report, not the row status —
-- already treats them as incomplete). Only NEW finalisations store
-- 'expired'.
--
-- Idempotent by convention: DROP CONSTRAINT IF EXISTS + ADD
-- CONSTRAINT with the same deterministic name Postgres gave the
-- inline CHECK in 001 (interviews_status_check), so re-running this
-- file is safe. No DOWN migration by design — rollback is a
-- pre-migration backup restore (see docs/MIGRATION_GUIDE.md).

ALTER TABLE interviews
  DROP CONSTRAINT IF EXISTS interviews_status_check;

ALTER TABLE interviews
  ADD CONSTRAINT interviews_status_check
  CHECK (status IN ('scheduled', 'completed', 'cancelled', 'expired'));
