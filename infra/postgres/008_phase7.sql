-- Ground Truth AI — Phase 7 messaging / notifications / contact schema.
--
-- Three additive tables, nothing else touched:
--   messages          — student<->recruiter messages, one thread per
--                        application (application_id is the thread).
--   notifications     — in-app notifications, written by the real flows
--                        (application stage change, new message, assessment
--                        and interview updates). No fake/seeded rows.
--   contact_messages  — messages from the public contact / demo form.
--                        Stored only; no email is sent (no SMTP is
--                        configured), so nothing here pretends otherwise.
--
-- Run via `npm run migrate` in server/ (applies infra/postgres/*.sql in
-- order). Idempotent: every statement uses IF NOT EXISTS.

-- ── messages: one thread per application ──────────────────────────────────
CREATE TABLE IF NOT EXISTS messages (
    id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    application_id UUID NOT NULL REFERENCES applications (id) ON DELETE CASCADE,
    sender_id      UUID NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    body           TEXT NOT NULL CHECK (char_length(body) BETWEEN 1 AND 5000),
    created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_messages_application_created
    ON messages (application_id, created_at);
CREATE INDEX IF NOT EXISTS idx_messages_sender
    ON messages (sender_id);

-- ── thread_reads: per-user read watermark for a thread ─────────────────────
-- Unread counts are derived, not guessed: a message counts as unread for
-- a user when it was sent by the other party after their last read.
CREATE TABLE IF NOT EXISTS thread_reads (
    user_id        UUID NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    application_id UUID NOT NULL REFERENCES applications (id) ON DELETE CASCADE,
    last_read_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (user_id, application_id)
);

-- ── notifications: in-app only ────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS notifications (
    id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id        UUID NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    type           TEXT NOT NULL
                   CHECK (type IN ('application_status', 'message', 'interview', 'assessment', 'job_match')),
    title          TEXT NOT NULL CHECK (char_length(title) BETWEEN 1 AND 200),
    body           TEXT NOT NULL CHECK (char_length(body) BETWEEN 1 AND 1000),
    link           TEXT,
    application_id UUID REFERENCES applications (id) ON DELETE CASCADE,
    is_read        BOOLEAN NOT NULL DEFAULT false,
    created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_notifications_user_created
    ON notifications (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_notifications_user_unread
    ON notifications (user_id) WHERE is_read = false;

-- ── contact_messages: public contact / demo form ──────────────────────────
CREATE TABLE IF NOT EXISTS contact_messages (
    id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name       TEXT NOT NULL CHECK (char_length(name) BETWEEN 1 AND 200),
    email      TEXT NOT NULL CHECK (char_length(email) BETWEEN 3 AND 320),
    message    TEXT NOT NULL CHECK (char_length(message) BETWEEN 1 AND 5000),
    source     TEXT NOT NULL DEFAULT 'contact_page',
    status     TEXT NOT NULL DEFAULT 'new'
               CHECK (status IN ('new', 'read', 'replied')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_contact_messages_created
    ON contact_messages (created_at DESC);
