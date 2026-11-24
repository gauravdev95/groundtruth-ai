# GroundTruth AI — API reference

**Date:** 24 November 2026 (competency directive, Phase G).
**Base:** `http://127.0.0.1:4000` locally;
`https://groundtruth-ai-server.onrender.com` in production.
**Auth:** `Authorization: Bearer <JWT>` (HS256, 1d expiry). Roles stored
as `candidate` / `recruiter` (register accepts `student` / `recruiter`).
**Errors:** `{ "error": "<message>" }` — no stack traces, no internals.
**Validation:** Zod bodies; malformed UUIDs → 400/404 (never 500);
malformed JSON → 400. **85 route-handler definitions across 12 routers**
(94 live routes: the student CRUD factory registers 4 resources ×
POST/PUT/DELETE at runtime — see Student section).
Verified end-to-end 24 Nov 2026: API flow 69/69, integrated E2E 28/28,
E2E assessment 87/87.

## Health

| Method | Path | Auth | Notes |
|---|---|---|---|
| GET | `/health` | — | `{status, dependencies:{postgres, redis}}`; 200 ok, 503 degraded. Pings DB + Redis (2s timeout). |

## Auth — `/api/auth`

| Method | Path | Auth | Notes |
|---|---|---|---|
| POST | `/register` | — | `{email, password, full_name, role, company_name?}` (company required for recruiters). 201 + token. Duplicate email 409; weak password 400. |
| POST | `/login` | — | 200 + token. Wrong credentials 401 (same message either way). Rate-limited 5/min/IP. |
| GET | `/me` | Yes | Current user. No token 401. |
| POST | `/logout` | Yes | Stateless JWT — client discards the token; no server-side revocation. |
| POST | `/forgot-password` | — | Always the same generic 200 (never reveals existence). Issues a 30-min token (SHA-256 stored, single-use). In dev only, also returns `resetUrl`. When SMTP is configured, emails the link. Rate-limited 5/min. |
| POST | `/reset-password` | — | `{token, new_password}`. Invalid/expired/used token 400. |

## Jobs — `/api/jobs`

| Method | Path | Auth | Notes |
|---|---|---|---|
| GET | `/` | — | List/search/filter/pagination (`?search=&page=&limit=`). 200. |
| GET | `/:id` | — | Detail. Bad id 404. |
| POST | `/` | Recruiter | `{company_id, title, description, location, employment_type, ...}`. 201. Enqueues job re-embedding. Student 403; other-company 403. |
| POST | `/:id/apply` | Candidate | `{cover_letter?}`. 201. Duplicate apply 409. |
| GET | `/:id/applications` | Recruiter (own company) | Other company 404. |

## Applications — `/api/applications`

| Method | Path | Auth | Notes |
|---|---|---|---|
| GET | `/mine` | Candidate | Own applications. |
| GET | `/:id` | Owner side | Student (own) or recruiter (own company). Others 404. |
| PATCH | `/:id/status` | Recruiter (own company) | `{status}`. Invalid status 400; student 403. Status change notifies the student. |

## Candidates — `/api/candidates`

| Method | Path | Auth | Notes |
|---|---|---|---|
| GET | `/` | Recruiter/Admin | Anon 401, student 403. No `password_hash` in responses. |
| GET | `/:id` | Recruiter | Student 403. |
| POST | `/` | Admin only | Recruiter 403. |

## Student — `/api/student`

| Method | Path | Auth | Notes |
|---|---|---|---|
| GET | `/profile` | Candidate | Own profile (creates candidate row on first call). |
| PUT | `/profile` | Candidate | Headline/location/summary/degree/branch/graduation year/skills/target roles. Enqueues candidate re-embedding (deduped). |
| POST | `/onboarding/choice` | Candidate | `manual_entry` etc. |
| POST | `/profile/complete` | Candidate | Marks profile complete (requires basic + 1 project). |
| PUT | `/profile/github` | Candidate | `{github_username}`. |
| GET | `/dashboard` | Candidate | Real counts (profile %, applications, matches, open roles). |
| POST | `/resume` | Candidate | Resume metadata. |
| GET | `/resume/:id/file` | Candidate | Resume file. |
| POST/PUT/DELETE | `/projects`, `/coding-profiles`, `/certificates`, `/experience` | Candidate | Own-row CRUD (one project max — 2nd POST 409; other student's row 404). Registered by one factory per resource (4 × POST/PUT/DELETE at runtime). |

## Recruiter — `/api/recruiter`

| Method | Path | Auth | Notes |
|---|---|---|---|
| GET | `/profile` | Recruiter | Own profile + company. |
| PUT | `/profile` | Recruiter | Company/job-title updates. |
| GET | `/dashboard` | Recruiter | Own-company stats. |
| GET | `/analytics` | Recruiter | Own-company analytics. |
| GET | `/applications` | Recruiter | Own-company applications only. |

## Uploads — `/api/uploads`

| Method | Path | Auth | Notes |
|---|---|---|---|
| POST | `/` | Candidate | Multipart `file` + `kind` (`resume`/`certificate`/`evidence-report`). 10 MB, PDF/JPG/PNG only, 10/min. Own candidate only (other id 403). Stores in Cloudinary, returns 202 + `job_id` (resume parsing enqueued). Cloudinary unconfigured → 503. |

## Assessments — `/api/assessments`

42 handlers: profile analyze/strength/recommendations/verified,
demo project, project select/analyze (+ GitHub URL), assessment CRUD,
challenge generate, consent, start, files, events, monitoring,
execution session/status/run/test (local `unshare` sandbox — Judge0 is
NOT configured), submit, evaluate (weights 30/20/20/15/15), evaluation,
monitoring report, verified skills.

Interview (Phase C, real AI technical interview — the 17 Nov 2026
exclusion of the AI Interview + report feature was REVOKED by Gaurav's
explicit 24 Nov 2026 directive for a real interview; the feature is
approved under that directive only, local-only, no push/deploy):
`POST /:id/interview/generate` pre-generates exactly 7 frozen questions
(competency spec persisted; optional `{roleId}`, mock-labelled when no
live AI). `generationProvider` is `"live"` ONLY when the live refine
response actually validates against the strict refine schema — a failed
or unvalidated refinement reports `"deterministic"` and stores the
failure as `generationFailure`, never `"live"` (F2, 24 Nov 2026). **Phase G (24 Nov 2026):** the generate response returns
`{interview, questionCount: 7, roleId, frameworkVersion,
generationProvider, generationMethod}` ONLY — it used to return the full
question rows, including `expected_points` and `scoring_rubric`, i.e.
the answer key, to the candidate before the session started. That leak
is fixed (`toPublicGenerateResult` in `services/interview.ts`, covered
by a regression test); question texts are served one at a time, stripped,
via `GET /interviews/:id/session` only. → `POST /interviews/:id/session/start` (intro) →
`POST /interviews/:id/session/readiness` `{acknowledged: true}` →
`GET /interviews/:id/session` (begins the clock, serves ONLY the
current question, including its `questionType` — `project_specific` /
`conceptual` / `engineering_scenario` — and `competencyId`) → `POST /interviews/:id/session/answer`
`{questionId, answer, confirmShort?}` (empty 400, short → warning flag,
duplicate 409, late 410) → `POST /interviews/:id/session/explain-again`
(max 1/question, 2/session; never reveals the expected answer) →
`POST /interviews/:id/session/finish` (explicit; saves the immutable
`interview_reports` row). **P0 F3 (24 Nov 2026): evaluation retry** —
`POST /interviews/:id/session/retry-evaluation` `{questionId}`
(candidate-owner only, same ownership check as the session endpoints;
admin bypass per the recruiter report gate). Every scoring attempt is
recorded in `interview_evaluation_attempts` (migration 013) with a
structured failure kind — `timeout`, `rate_limited` (HTTP 429),
`auth_failed` (HTTP 401/403 from the provider — 2-attempt cap, like
invalid responses),
`server_error` (HTTP 5xx), `network_error`, `invalid_response`
(invalid JSON / failed schema validation) — never prompt/answer
content. Retries only re-run scoring against the stored answer (the
submitted answer is never unlocked or overwritten; a successful retry
stores its evaluation/score on its attempt row because
`interview_answers` is immutable). Bounded: max 3 attempts total per
question for transient failures, 2 when every failure is an invalid
model response or an auth failure (then `permanently_failed`); exponential backoff +
jitter between attempts (~1s before attempt 2, ~2s before attempt 3,
capped at 8s). States: `pending` / `processing` / `completed` /
`retryable_failed` / `permanently_failed`. Completed → idempotent
stored result, no new attempt row; a concurrent duplicate retry → 409
(one in-flight attempt per question, DB-enforced); permanently failed
or no retries remain → 409; no fabricated score on total failure. The
report lists pending/failed questions with their state and failure
kind (`perQuestion[].evaluationState` / `failureKind`,
top-level `failedEvaluations` / `evaluationFailures`) and the final
score stays the mean over scored questions only — a missing score is
excluded, never zero. **F5 (24 Nov 2026):** retry also covers
follow-up evaluations (attempt-1 is recorded when the follow-up is
submitted; the finished report prefers a completed retried follow-up
score; migration 014 widens the failure-kind CHECK to include
`auth_failed`). `GET /interviews/:id/report` is READ-ONLY
(404 until finished; viewing never finalises — C14 fix) and is open to
the candidate (owner) plus authorized recruiters/admins (application
ownership gate). Scoring is 5 dimensions — technical correctness 30,
depth of understanding 25, relevance 15, project/code evidence 15,
communication & clarity 15 — via `llm.ts`; mock/deterministic labelled,
live-AI failure keeps the answer with evaluation pending and no score.
At most ONE follow-up per interview (Partial answers only, stored in
`interview_followups`). The legacy `POST /interviews/:id/answer`
endpoint was removed in Phase 2 (G3.6) — it was the last live caller
of a silent deterministic fallback, and no client or script used it;
answers are submitted only via `POST /interviews/:id/session/answer`.
GitHub-based assessment returns 409 (no GitHub OAuth yet).

Competency profile (Phase E, final profiles — same directive, local-only):
`POST /:id/competency/compute` (candidate, owner only; optional
`{roleId}`) computes the final profile from the three real sources —
completed evaluation (coding, 50%), completed interview (30%) and
independently verified evidence (20%) — via `competencyScoringService`
(S = C*0.50 + I*0.30 + E*0.20, framework v1.0.0) and stores it immutably
in `competency_results` (migration 012). Deterministic and idempotent:
same inputs return the stored row (201 fresh / 200 stored), never a
duplicate; a final profile (Complete / Practical Threshold Not Met) is
never rewritten, a non-final draft refreshes when its inputs complete.
Missing sources do not block computation — the profile is Incomplete /
Insufficient Evidence / Not Assessed and flagged non-final (its category
is provisional until the required sources complete). Coding below the
practical minimum (40) → status "Practical Threshold Not Met", overall
category capped at L2. `GET /:id/competency` returns the same stored
profile for the owning candidate, or an authorized recruiter/admin
(application-ownership gate); 404 until computed. The profile is an
assessment result only — it never rejects or hires anyone; recruiters
decide. `GET /profile/verified` also carries the latest assessment's
stored profile as `competencyProfile` (null until computed).

Recruiter competency dashboard (Phase F, same directive, local-only):
- `GET /api/assessments/verified-skills/:candidateId` (recruiter/admin,
  application-ownership gate, 403 otherwise) now also carries
  `assessments` — every assessment for the candidate, newest first, each
  with `id`, `status`, `challengeTitle`, `overallScore`, `submittedAt`,
  `interviewId`, `interviewScore` and its stored `competencyProfile`
  (null until computed). `latestAssessment` is derived from the same
  history; `evidence.assessmentsCompleted` counts all completed
  assessments, not just the latest.
- `GET /api/recruiter/applications` and the dashboard's recent
  applications each carry the candidate's latest computed profile as
  `competency_overall_score` (number|null), `competency_category`
  (L1–L4|null), `competency_status` (null until computed) and (list only)
  `competency_assessment_id` / `competency_computed_at`. All null means
  "Not assessed" — the UI never shows a category for a candidate with no
  computed profile.
- `GET /api/assessments/interviews/:interviewId/report` is already
  recruiter-readable under the same gate (read-only, 404 until the
  interview is finished) — Phase F surfaces it in the recruiter evidence
  view with the per-question breakdown and answers, alongside the coding
  evaluation breakdown from `GET /:id/monitoring/report`. No new route
  was introduced in Phase F; the only new labels are the L1–L4
  categories — "Verified Expert" and similar labels are never displayed.

## Messages / Notifications / Contact

| Method | Path | Auth | Notes |
|---|---|---|---|
| GET | `/api/messages/threads` | Yes | Own threads. |
| GET | `/api/messages/threads/:applicationId` | Participant | Other side 403/404. |
| POST | `/api/messages/threads/:applicationId/messages` | Participant | `{body}` 1–5000 chars. 201. |
| GET | `/api/notifications` | Yes | Own notifications. |
| GET | `/api/notifications/unread-count` | Yes | — |
| PATCH | `/api/notifications/:id/read` | Yes (own) | 200. |
| POST | `/api/notifications/mark-all-read` | Yes | 200. |
| POST | `/api/contact` | — | `{name, email, message, source?}`. 201, stored in `contact_messages`. No email sent. Rate-limited 5/min. |

## ai-service (FastAPI, :8000)

| Method | Path | Notes |
|---|---|---|
| GET | `/health` | 200. |
| POST | `/embed` | Compute-only embedding for text. Without `OPENAI_API_KEY` returns a labelled local-hash DEV-ONLY vector (no semantic meaning). |
| POST | `/match` | `{candidate_id, job_id}` → score. Missing side → honest 503 naming the side. Malformed UUIDs → 422. |
