-- Ground Truth AI — Phase 1 auth schema.
-- Adds the password-reset token store. The `users` table (001_init.sql)
-- already carries `password_hash` and `role` ('candidate' | 'recruiter' |
-- 'admin'), so no user-table change is needed.
-- Run via `npm run migrate` in server/ (applies infra/postgres/*.sql in
-- order), or let docker-compose mount it on first DB init. Idempotent.

CREATE TABLE IF NOT EXISTS password_reset_tokens (
    id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id    UUID NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    -- SHA-256 hash of the raw token. The raw token is shown to the user
    -- exactly once (inside the reset link) and is never stored or logged.
    token_hash TEXT NOT NULL UNIQUE,
    expires_at TIMESTAMPTZ NOT NULL,
    used_at    TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_password_reset_tokens_user
    ON password_reset_tokens (user_id);
CREATE INDEX IF NOT EXISTS idx_password_reset_tokens_expires
    ON password_reset_tokens (expires_at);
