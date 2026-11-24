-- 012_competency_profiles.sql — Phase E: final competency profiles.
--
-- Extends the Phase B `competency_results` table (010) so a computed
-- profile is stored immutably against the assessment that produced it.
-- No new table is needed: 010 already stores candidate_id, role_id,
-- framework_version, overall_score, overall_category, status,
-- component_scores and the full result JSONB. What was missing was the
-- link to the sources (assessment / interview / evaluation), a
-- one-profile-per-(assessment, framework-version) guarantee, an inputs
-- fingerprint for idempotent recomputation, and immutability.
--
-- Columns added to competency_results:
--   assessment_id   the assessment the profile was computed from
--                   (ON DELETE CASCADE — the profile goes with it).
--   interview_id    the completed interview that supplied the I
--                   component, if any (SET NULL — the profile keeps its
--                   stored interview scores either way).
--   evaluation_id   the evaluation that supplied the C component, if
--                   any (SET NULL for the same reason).
--   inputs_hash     SHA-256 of the canonical source snapshot the
--                   profile was computed from (evaluation + interview +
--                   evidence items). Re-running compute with the same
--                   inputs returns the stored row; a different hash with
--                   a non-final stored status refreshes the draft; a
--                   final stored profile (Complete / Practical
--                   Threshold Not Met) is never rewritten.
-- Guarantees:
--   UNIQUE (assessment_id, framework_version) — one stored profile per
--     assessment per framework version; recomputation never creates a
--     duplicate row.
--   BEFORE UPDATE trigger — a stored profile is immutable (same pattern
--     as interview_reports in 011). DELETE is allowed so a profile can
--     still be erased with its parent assessment / candidate.
-- Idempotent by convention: ADD COLUMN IF NOT EXISTS,
-- CREATE INDEX IF NOT EXISTS, CREATE OR REPLACE for the trigger/function.
-- No DOWN migration by design — rollback is a pre-migration backup
-- restore (see docs/MIGRATION_GUIDE.md).
-- Judge0 is NOT configured — nothing here claims code-execution results.

ALTER TABLE competency_results ADD COLUMN IF NOT EXISTS assessment_id UUID REFERENCES assessments (id) ON DELETE CASCADE;
ALTER TABLE competency_results ADD COLUMN IF NOT EXISTS interview_id UUID REFERENCES interviews (id) ON DELETE SET NULL;
ALTER TABLE competency_results ADD COLUMN IF NOT EXISTS evaluation_id UUID REFERENCES evaluations (id) ON DELETE SET NULL;
ALTER TABLE competency_results ADD COLUMN IF NOT EXISTS inputs_hash TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS idx_competency_results_assessment_version
  ON competency_results (assessment_id, framework_version);
CREATE INDEX IF NOT EXISTS idx_competency_results_assessment
  ON competency_results (assessment_id);
CREATE INDEX IF NOT EXISTS idx_competency_results_interview
  ON competency_results (interview_id);

-- ── Immutability ─────────────────────────────────────────────────────────
-- A stored competency profile is written once. Any UPDATE is rejected at
-- the database level, so no code path can silently rewrite a computed
-- profile. A draft (Incomplete / Insufficient Evidence) refresh is a
-- DELETE + INSERT, never an UPDATE — the same discipline as
-- interview_reports (011).
CREATE OR REPLACE FUNCTION reject_competency_result_update()
RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'competency_results is immutable: a stored competency profile cannot be updated (assessment_id=%, framework_version=%)', OLD.assessment_id, OLD.framework_version;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_competency_results_immutable ON competency_results;
CREATE TRIGGER trg_competency_results_immutable
  BEFORE UPDATE ON competency_results
  FOR EACH ROW EXECUTE FUNCTION reject_competency_result_update();
