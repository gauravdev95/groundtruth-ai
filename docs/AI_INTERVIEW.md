# GroundTruth AI — AI technical interview

**Date:** 24 November 2026 (competency directive, Phases C–G).
**Spec:** `docs/COMPETENCY_SPEC.md`. **Scoring:**
`docs/SCORING_METHODOLOGY.md`. **Framework:**
`docs/COMPETENCY_FRAMEWORK.md`.

## What it is

A structured, pre-generated technical interview: exactly 7 questions,
written (or generated) once per assessment from the candidate's role
and their assessed project, then frozen. The candidate answers one
question at a time under server-enforced timers; answers are scored on
five dimensions; at most one follow-up is allowed; the finished
interview produces an immutable report that feeds the competency
profile.

## Session flow

```
generate → start (intro) → readiness gate → Q1 … Q7 → finish → report
```

1. **Generate** — `POST /api/assessments/:id/interview/generate`
   (optional `{roleId}`). Creates the interview row and exactly 7
   frozen questions with `competency_id`, `difficulty`, `expected_points`,
   `scoring_rubric`, `max_time_seconds`, `context`, `framework_version`,
   `source: "pre_generated"`. The response returns
   `{interview, questionCount: 7, roleId, frameworkVersion,
   generationProvider, generationMethod, generationModel,
   generationFailure}` **only** — it does not
   contain question text, expected points or rubrics (Phase G fix; see
   §"Answer-key protection").
2. **Start** — `POST /api/interviews/:id/session/start`. Session status
   `not_started → intro`. The candidate sees the intro screen: how the
   interview works, the timers, the Explain Again budget, and the
   mock label when no live AI is configured.
3. **Readiness gate** — `POST /api/interviews/:id/session/ready`.
   The candidate confirms readiness; only then is Q1 served. The gate
   exists so the 300 s clock never starts before the candidate is
   looking at the question.
4. **One question at a time** — `GET /api/interviews/:id/session`
   returns only the current question (stripped of `expected_points` /
   `scoring_rubric` / `context` via `toPublicQuestion`), its deadline,
   the session's remaining time, and the Explain Again budget. Future
   questions are never visible.
5. **Answer** — `POST /api/interviews/:id/session/answer` with
   `{questionId, answer}`. Server checks the deadline (expired → 410),
   locks the answer (duplicate → 409), scores it, and serves the next
   question (or a follow-up, or the finish state).
6. **Finish** — when Q7 is answered (and any follow-up), the session
   completes and the report is written. `GET
   /api/assessments/:id/interview/report` returns it (404 until
   finished; read-only).
7. **Competency** — `POST /api/assessments/:id/competency` computes
   the final profile from coding + interview + evidence (see
   `docs/SCORING_METHODOLOGY.md`).

## Timers (server-enforced, not client-enforced)

| Timer | Default | Env var |
|---|---|---|
| Per question | 300 s (5 min) | `INTERVIEW_PER_QUESTION_SECONDS` |
| Whole session | 2400 s (40 min) | `INTERVIEW_SESSION_TOTAL_SECONDS` |

- The deadline is computed and stored server-side (`shown_at` /
  `deadline_at` on the session); the client only displays the
  countdown. An answer after the deadline is refused **410** ("Time
  for this question has expired") and the session advances to the next
  question — the expired question is scored as missed, not retried.
- If the session total expires, the session finalises with the answers
  collected so far; there is **no resume after expiry** (a product
  decision recorded in Phase C — confirm with Gaurav if a different
  policy is wanted). The expired interview is stored as
  `interviews.status = 'expired'` (migration 015) — never rewritten
  to `'completed'` — and the immutable report is still persisted, so
  an expired 3/7 interview can never pose as a completed interview
  source for the competency profile (Phase 2, G3.7).
- Timers are stored in `interview_sessions` (`started_at`,
  `expires_at`, current-question `shown_at` / `deadline_at`).

## Answer locking

- Answers are insert-once (`interview_answers`, BEFORE UPDATE trigger).
- A second submit for the same question → **409**.
- Answering a question that is not the current one → **409**.
- An answer is stored with `answered_at`, `locked_at`,
  `time_spent_seconds`, `question_shown_at`, `deadline_at`,
  `evaluation_provider`, `evaluation_model`.

## Follow-up rules

- **At most 1 follow-up per interview** (`follow_ups_used`, UNIQUE
  `(interview_id)` on `interview_followups`).
- Trigger: a **Partial** answer only (per-question score 40–59).
  Strong (60+) and Missed (0–39) answers never get a follow-up.
- The follow-up is generated from the missed expected points of that
  question; it is served **immediately next**, as the next question in
  the sequence, and is labelled as a follow-up in the UI.
- Follow-up answers are stored in `interview_followups`, **never** in
  `interview_answers`, and the follow-up is nested under its original
  question in the report (`perQuestion` stays length 7).
- The follow-up question text itself never reveals the expected answer.
- **Follow-up score supersedes (Phase 2, G3.3 ruling):** a follow-up
  re-tests the same competency point the original answer was weak on,
  so the follow-up's score IS the question's effective score in the
  report and in the profile. The original answer and its own score
  are not discarded — they stay stored (immutable answer row) and
  visible in the report as `originalAnswer` / `originalScore` next
  to the follow-up's score.

## Explain Again

- The candidate can ask for the current question to be re-explained:
  max **1 per question**, **2 per session**
  (`INTERVIEW_EXPLAIN_AGAIN_PER_QUESTION` / `INTERVIEW_EXPLAIN_AGAIN_PER_SESSION`).
- The explanation rephrases the question; it never reveals expected
  points, rubrics or example answers. Budget counts are shown in the
  UI and enforced server-side.

## Short answers

- Answers under **20 words** (`INTERVIEW_SHORT_ANSWER_WORDS`) show a
  client-side warning ("This answer looks very short — are you sure?")
  and require confirmation. The answer is still accepted on confirm;
  the warning is a nudge, not a block.

## Scoring dimensions (per question, 0–100)

| Dimension | Weight |
|---|---|
| Technical correctness | 30 |
| Depth of understanding | 25 |
| Relevance | 15 |
| Project / code evidence | 15 |
| Communication & clarity | 15 |

Per-question classification: Strong 60–100, Partial 40–59, Missed
0–39. Full formulas, the coding-evaluation weights, the competency
blend (`S = C×0.50 + I×0.30 + E×0.20`), bands and safeguards are in
`docs/SCORING_METHODOLOGY.md`.

## Question generation (live refine + deterministic bank)

- The 7 questions are built deterministically first
  (`buildPhaseCQuestions`): Q1–Q5 cover all 5 role competencies, Q6
  targets the weakest competency, Q7 is a project question on the
  highest-weight competency. Every question carries its competency ID,
  question type, difficulty, expected answer points, scoring rubric,
  project reference where relevant, and time limit — and is persisted
  before the interview starts.
- **Three question types.** The set is never seven variations of one
  question: each question is `project_specific` (grounded in the
  candidate's actual submitted files / challenge), `conceptual` (the
  competency's underlying concept), or `engineering_scenario` (a
  situation to reason through), and all three types are present. The
  expected points are built per competency (its own L3 rubric + skills),
  so no two questions share the same expected-points text. A question
  references only the actual submitted files / challenge, or is generic
  to its competency — code is never invented or attributed without
  evidence.
- **Live refine.** When a live LLM is configured, it may only refine the
  question wording. The call uses `jsonMode` (the client sends
  `response_format: {type: "json_object"}` — the strictest shape this
  client supports) and the prompt pins the exact expected JSON object:
  `{"schemaVersion": "refined-questions-v1", "questions":
  [{"competencyId", "question", "questionType", "projectReference"}]}`
  — a bare array cannot be returned in `json_object` mode, which is
  what the old prompt asked for. The validator is strict: exactly 7
  questions, same order, same `competencyId` / `questionType` /
  `projectReference` as the draft, no extra or missing required fields.
- **No silent fallback.** `generationProvider` is `"live"` only when the
  live refine response actually validated; otherwise it is
  `"deterministic"` (the deterministic bank — not the mock provider,
  which is a different thing) and `generationModel` is null. A failed
  refinement is logged as a structured line
  (`[interview] question refinement failed, …`) carrying provider,
  model, HTTP status, schema version, missing/extra field names,
  validation error codes, duration, and retry count — never question
  text or candidate info — and the same record is stored as
  `generationFailure` on the result and on every persisted question's
  context (`kind` is one of `validation` / `timeout` / `auth` /
  `provider` / `invalid_json` / `not_configured`).
- **Timeouts.** A refine call is bounded by `AI_TIMEOUT_MS` (default
  120 s — the old 30 s default aborted genuine calls on this egress;
  see `docs/ENVIRONMENT.md` §"LLM timeouts and retries"). A timeout is
  recorded as `generationFailure.kind: "timeout"`; a 401/403 as `"auth"`.

## Mock labelling and failure handling

- **Mock is labelled, never hidden.** When no live AI is configured
  (`AI_MOCK=true` locally, or no `AI_API_KEY` / `AI_MODEL`), the
  provider is the deterministic mock and the UI shows a "Mock
  interview — scoring is deterministic, not a live AI judgement"
  label; the report stores `generationProvider: "deterministic"` /
  `evaluationProvider: "mock"`. (Question generation and answer
  evaluation label differently: generation uses `"deterministic"` for
  the question bank, evaluation uses `"mock"` for the mock scorer.)
- **Live-AI failure is fail-loud.** If the live LLM call fails while
  scoring an answer, the answer is kept with evaluation **pending**
  and **no score is substituted**. The interview continues; the
  pending item is visible in the report.
- **Evaluation retry (F3, 24 Nov 2026) — root cause.** Before F3 a
  failed live scoring left the answer pending with no recovery path:
  the candidate could neither re-answer (answers are insert-once, 409)
  nor re-trigger scoring, so a transient provider failure permanently
  lost that question's score and the report carried a silent gap. The
  retry endpoint (`POST /interviews/:id/session/retry-evaluation`,
  migration 013) re-runs scoring against the stored answer only —
  bounded (3 attempts transient, 2 for invalid-response/auth, then
  `permanently_failed`), idempotent once completed, 409 on duplicates.
  The same retry covers follow-up evaluations (F5, migration 014
  adds the `auth_failed` failure kind for provider 401/403).
  **Auth recovery (Phase 2, G3.5):** a `permanently_failed` evaluation
  is terminal — except when the failure kind is `auth_failed`. A
  revoked key fails auth twice and then blocks retries, but once the
  key is rotated the candidate (or an admin) gets exactly ONE
  additional attempt cycle for that question; after that cycle the
  budget is spent and further retries are 409 again.
- **Question generation failure:** if generation fails, no interview
  is created (no partial question set is ever served).

## Answer-key protection (Phase G fix, 24 Nov 2026)

Defect found in Phase G testing: `POST /:id/interview/generate`
returned the full question rows — all 7 question texts plus
`expected_points` and `scoring_rubric` — to the candidate before the
session started, defeating the one-question-at-a-time design.
Fixed: the route returns only `{interview, questionCount, roleId,
frameworkVersion, generationProvider, generationMethod, generationModel,
generationFailure}` via
`toPublicGenerateResult` (`server/src/services/interview.ts`). The
session GET path was already correctly stripped (`toPublicQuestion`).
Covered by a unit test (`tests/interview-session.test.ts`, "phase G:
public generate result never leaks the answer key") and by an E2E step
asserting the generate response contains no question text,
`expected_points` or `scoring_rubric`.

## Ownership and access

- Candidate endpoints (`/session`, `/session/answer`, `/ready`, `/explain-again`)
  require the candidate role **and** ownership of the assessment's
  interview; another candidate gets 404 (existence not leaked), a
  recruiter gets 403, anonymous gets 401.
- Recruiter reads of the finished report require an application to the
  candidate; otherwise 403.
- Malformed interview ids → 400 (never 500); nonexistent ids → 404.
- The interview-answer route is rate-limited (10/min per IP+user;
  `AI_RATE_LIMIT_PER_MIN`) — 429s are an expected control, and the E2E
  paces its answers around it.

## Client screens

- `/assessments/:id/interview` — intro, readiness gate, one-question
  view (question, timer, answer box, short-answer warning, Explain
  Again button with budget, submit), follow-up view, finish screen.
- `/assessments/:id/interview/report` — finished report: per-question
  scores and dimension breakdown, follow-up nested under its original
  question, timers, provider label, competency link.
- Both pages are responsive (0 horizontal overflow at 320px, verified
  in headless Chrome, Phase D/E browser tests 59/59 + 16/16).
