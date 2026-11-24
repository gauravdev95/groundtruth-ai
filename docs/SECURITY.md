# GroundTruth AI — security audit

**Date:** 24 November 2026 (competency directive, Phase G; re-audit
Phase 11).
**Result: 24/24 checks PASS** (script
`~/workspace/groundtruth-all-steps/ult-security.py`, live local server,
re-run 24 Nov 2026) **+ 21/21 Phase G interview checks PASS** (script
`~/workspace/groundtruth-all-steps/phaseg-security.mjs`, live local
server, 24 Nov 2026). Prior audit: 20/20 (Phases 7–11). Every finding
below is classified PASS / FAIL / BLOCKED / NOT TESTED; nothing is
claimed without evidence.

## Verified PASS — interview surface (live, 24 Nov 2026, Phase G)

- **Expired question → 410:** an answer submitted after the server
  per-question deadline is refused 410 ("Time for this question has
  expired"); the session then advances and serves the next question.
  Verified live with a deadline moved into the past.
- **Answer locking → 409:** a second submit for the same question is
  rejected 409 (also covered by the E2E journey).
- **Candidate ownership:** another candidate reading the session gets
  404 ("Interview not found" — existence is not leaked); anonymous
  read 401; nonexistent interview id 404.
- **Recruiter barred from candidate endpoints:** recruiter
  `POST …/session/start` and `POST …/session/answer` both 403
  (candidate role required); recruiter reads of the interview report /
  competency profile without an application are 403 (E2E).
- **Malformed UUIDs:** `not-a-uuid` as interview id → 400 on the
  session GET and the answer POST (never 500).
- **LLM rate limit on the answer route:** 12 rapid answers → 404s for
  the bogus question ids, then 429s (10/min window) — and zero 500s.
- **Answer-key leak — FIXED (Phase G defect 4, below):** the
  interview-generate endpoint returned full question specs
  (`expected_points`, `scoring_rubric`, question text) to the candidate.
  It now returns only `{interview, questionCount: 7, …}`; the E2E
  asserts no `expected_points` / `scoring_rubric` / question text in
  the response, and a unit test covers `toPublicGenerateResult`.

## Verified PASS (live, 23 Nov 2026)

- **Candidate PII locked:** `GET /api/candidates` anon 401, student 403,
  recruiter 200; detail student 403 / recruiter 200; responses contain
  no `password_hash`. `POST /api/candidates` recruiter 403 (admin only).
- **Uploads locked:** anon 401; candidate-only + ownership (another
  candidate's id 403); 10/min; 10 MB; MIME allowlist PDF/JPG/PNG;
  wrong type 400; no file 400.
- **Rate limits:** login 5/min (5× 401 then 429); forgot-password 5/min;
  register/reset 10/min; uploads 10/min; contact 5/min.
- **CORS allowlist:** `FRONTEND_URL` + localhost:3000 + 127.0.0.1:3000
  (trust proxy 1). Evil origin gets no ACAO header; allowed origin does.
- **Injection:** SQLi probes in search/id params → 200/404, never 500
  (all queries parameterised; only static constants interpolated).
  Stored XSS payload is inert (API 200, React escapes on render).
- **Ownership:** other student cannot edit/delete a project (404);
  recruiter cannot post a job for another company (403); other-company
  recruiter cannot read applications (404); other student cannot read
  an application (404).
- **JWT:** HS256, required secret (server refuses to sign without one),
  1d expiry; tampered token 401; garbage token 401.
- **Password reset:** random 32-byte token, SHA-256 stored, 30-min
  expiry, single-use, no enumeration (unknown email gets the identical
  generic reply); invalid token 400; reuse 400.
- **Error handling:** malformed JSON → 400 (fixed this mission; was
  500); malformed UUIDs → 400/404; error bodies leak no stack traces.
  Postgres 22P02 → 400 "Invalid id format".
- **Headers:** helmet on (`X-Content-Type-Options: nosniff`, CSP);
  no `x-powered-by`.
- **Passwords:** bcrypt (salted; two hashes of the same password differ).
- **Secrets:** env-only, never in the repo, never logged (verified by
  grep + log review). Cloudinary/SMTP unconfigured → honest 503, not a
  silent failure.
- **Code execution:** local `unshare` sandbox (user+net+mount+pid
  namespaces), fail-closed, 30s timeout. Judge0 is NOT configured
  anywhere (grep: zero hits) — do not describe the Lab as Judge0-ready.
- **Queues:** BullMQ deduplication (this mission) — no duplicate jobs
  per entity; retries 3× exponential backoff 2s; graceful shutdown.
- **WebSocket:** one-command-at-a-time guard (load behaviour NOT TESTED).

## Defects fixed this mission

1. **Malformed JSON → 500** (`errorHandler` ignored body-parser 4xx).
   Fixed: honour numeric 4xx status; 5 unit tests added.
2. **Duplicate queue jobs** (no dedup key on enqueue). Fixed with
   BullMQ `deduplication` (see `docs/TESTING.md`).
3. **Candidate-create race → 500** (`getOrCreateCandidateForUser`
   check-then-insert, `23505 candidates_email_key`). Fixed with
   `INSERT ... ON CONFLICT DO NOTHING` + re-SELECT; race test added.
4. **Interview-generate leaked the answer key (Phase G, 24 Nov 2026).**
   `POST /:id/interview/generate` returned the full
   `InterviewQuestionRow` array — all 7 question texts plus
   `expected_points` and `scoring_rubric` — to the candidate before the
   session started, defeating the one-question-at-a-time design. Fixed:
   the route now returns only `{interview, questionCount, roleId,
   frameworkVersion, generationProvider, generationMethod}` via
   `toPublicGenerateResult` (`server/src/services/interview.ts`); the
   client type and the E2E were updated to the new shape, and a unit
   test (`tests/interview-session.test.ts`) asserts the public shape
   contains no question text, `expected_points`, `scoring_rubric` or
   `context`. Verified live: E2E step "generate response leaks no
   question text / expected points / rubrics" PASS.
5. **Evaluation retry is owner-only and cannot fabricate a score
   (stabilization F3/F5, 24 Nov 2026).** `POST
   /interviews/:id/session/retry-evaluation` accepts only the
   candidate owner (same ownership check as the session endpoints) or
   an admin; any other user gets 403, and a retry of someone else's
   evaluation is rejected (unit test). Retries re-run scoring against
   the stored answer only — the submitted answer is never unlocked or
   overwritten (`interview_answers` is immutable, duplicate submit
   409). A completed retry is idempotent (same stored result, no new
   attempt row); a concurrent duplicate retry → 409 (one in-flight
   attempt per question, DB-enforced); permanently failed or no
   retries left → 409. A failed evaluation is reported as
   pending/failed with its failure kind, never as a substituted score,
   and the final score is the mean over scored questions only — a
   missing score is excluded, never zero. `generationProvider` is
   `"live"` only when the live refine response validates; a failed
   refinement reports `"deterministic"`, so a mock run can never be
   presented as live (verified in the mock E2E: provider
   `deterministic`, evaluation provider `mock` / method
   `deterministic`; live-provider truthfulness itself is NOT TESTED
   live in this validation — the coordinator runs it).

## Still open (user decisions / NOT TESTED)

- **JWT in localStorage** (XSS-sensitive by design) + **stateless
  logout** (token valid until 1d expiry, no denylist) — user decisions.
- **No error-monitoring service** (Sentry/Bugsnag/Datadog — zero hits);
  adding one is a new vendor dependency needing approval.
- **WebSocket one-command guard under load** — NOT TESTED.
- **Email delivery** — BLOCKED (no SMTP credentials, no delivery test;
  Render Free blocks outbound SMTP 25/465/587).
- **Monitoring events** store command + 500-char output excerpt (could
  hold a secret if a candidate pastes one into code — noted, not fixed).
- **Terminal monitoring / interview code:** the 17 Nov 2026 exclusion
  of the AI Interview + report feature was **explicitly revoked by
  Gaurav's 24 Nov 2026 directive for a real interview** — the interview
  is approved under that directive only (local-only, no push/deploy).
  Git/GitHub-connect remains excluded by the 17 Nov decision.
