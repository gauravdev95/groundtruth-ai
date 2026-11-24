-- 009_step5_github_url.sql — Step 5: public GitHub URL repositories.
-- Stores the commit SHA + the fetched file tree (bounded by the fetch
-- service's size limits) on the assessment's repository row, so the Lab
-- can be seeded from the candidate's own public repo without re-fetching
-- (and without spending GitHub's unauthenticated 60 req/hour budget twice).
-- Fetched files are the same trust level as assessment_files (written at
-- Lab start); they are never executed and never sent raw to an LLM.
ALTER TABLE assessment_repositories
  ADD COLUMN IF NOT EXISTS commit_sha TEXT,
  ADD COLUMN IF NOT EXISTS fetched_files JSONB,
  ADD COLUMN IF NOT EXISTS fetched_at TIMESTAMPTZ;
