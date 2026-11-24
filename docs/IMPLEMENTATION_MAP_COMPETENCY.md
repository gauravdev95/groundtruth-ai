# Implementation Map — Real Competency Interview (Phase A audit)

**Date:** 24 Nov 2026 · **Repo:** `~/workspace/groundtruth-all-steps/repo` · **Branch:** `ultimate-completion-2026-11-23` · **HEAD:** `9f0523b`
**Scope:** READ-ONLY audit (Phase A). No code was modified, nothing committed/pushed/deployed.
**Target flow (per directive):** pre-generated 7 questions → session → intro + rules → readiness gate → one-question-at-a-time → answer locking → max 1 follow-up → server timers → AI scoring on 5 dimensions → report → competency profile → recruiter skill breakdown.
**Governance note:** `docs/API.md` records the AI Interview + report feature as DISPUTED — excluded by Gaurav's 17 Nov 2026 decision. This map is written under the new explicit directive (24 Nov 2026) that revokes that exclusion for a real interview; Phase B must still confirm the directive is the governing instruction before shipping.

## 1. Reusable components

| Component | Location | What it already does | Reuse verdict |
|---|---|---|---|
| LLM client (live + mock) | `server/src/services/llm.ts` (349 lines) | OpenAI-compatible `chatCompletion`/`chatJson`, `llmConfigured()`, JSON-fence stripping, schema validation, 3-attempt retry on 429/5xx, 30 s timeout, per-minute rate limit, usage/cost logging (never logs prompts or keys), deterministic mock provider labelled `provider:"mock"` | **REUSE as-is.** All new AI calls (question pre-generation, per-answer scoring, report synthesis) go through `chatJson`. |
| Interview question generation (deterministic + LLM refine) | `server/src/services/interview.ts` — `buildDeterministicQuestions`, `generateInterview` (513 lines total) | Builds 7–8 questions from real assessment context (`loadContext`: challenge title, changed files, failed/passed tests, weak areas, strengths, overall score, technologies); LLM refine pass keeps categories, falls back to deterministic on failure; idempotent generate (returns existing interview + questions) | **REUSE with extension.** Deterministic builder is the fallback for pre-generation; add a `session` concept and a "pre-generate all 7 up front, freeze them" guarantee (today questions are generated once, but a follow-up can be appended later — see §3). |
| Per-answer scoring | `server/src/services/interview.ts` — `answerQuestion`, `evaluateAnswerDeterministic` | Scores 5 dimensions (accuracy 30%, understanding 25%, depth 15%, relevance 15%, problemSolving 15%), LLM-first with deterministic fallback; `AnswerSchema` clamps 0–100 | **REUSE, rename/extend.** The 5 dimensions already match the required 5-dimension scoring. Needs: answer locking (see §3), follow-up cap enforcement, dimension labels surfaced as a competency profile. |
| Interview report builder | `server/src/services/interview.ts` — `buildInterviewReport`, `getInterviewReport` | Transcript + per-question scores + strengths (score ≥ 70) + knowledge gaps (< 50) + learning areas + evidence counts; persists `score`/`report`/`transcript` on `interviews`, sets status `completed`, notifies candidate | **REUSE with extension.** Add per-dimension aggregates, per-skill/competency breakdown, follow-up accounting, timing data, and `method` (llm vs deterministic) per dimension. |
| Evaluation engine | `server/src/services/evaluation.ts` (454 lines) | Fixed weights functional 30 / quality 20 / problem-solving 20 / understanding 15 / testing 15; functional ONLY from executed tests; deterministic quality + security scans; LLM qualitative with capped heuristic fallback; `human_review_recommended` flag; writes `verified_skills` when functional ≥ 70 | **REUSE as context source.** Interview `loadContext` already consumes it. Do not change weights. New competency report should cross-reference, not duplicate, evaluation scores. |
| Monitoring / integrity | `server/src/services/monitoring.ts` (524 lines) | `recordEvent` (idempotent via `client_event_id`, secret-key stripping, path traversal guard), `buildActivitySummary` (neutral observations only), `analyzeIntegrity` (out-of-scope files, hash mismatch, bulk change, sandbox-bypass), consent v1, 90-day retention purge | **REUSE as-is.** Interview session events (start, question shown, answer submitted, timer expiry, Explain Again) should reuse `recordEvent`/`assessment_events` or a parallel interview-event table — do NOT invent a second monitoring system. |
| Profile strength | `server/src/services/strength.ts` (462 lines) | Deterministic scoring (skill coverage, project evidence, experience, resume consistency, completeness); "demonstrated only if in project tech/description" rule; LLM may only add summary/recommendations, never change scores | **REUSE pattern, not code.** The competency profile should copy its honesty rules: deterministic core, LLM text-only, nothing invented, scores derived from evidence. |
| Verified profile | `server/src/services/verified.ts` (202 lines) | Aggregates completion + strength + verified skills + latest assessment + interview score; status machine (Not Assessed / Assessment Pending / Assessment Completed / Verified ≥70 eval + ≥60 interview / Needs Improvement / Human Review Required); recruiter gate `recruiterMayViewCandidate` (must have an application to one of their jobs) | **REUSE + extend.** Verified bar (eval ≥ 70, interview ≥ 60) already exists; add interview competency breakdown to `VerifiedProfile` and to the recruiter evidence endpoint. |
| Repo analysis / challenge | `server/src/services/repoAnalysis.ts` (517 lines), `server/src/services/challenge.ts` (428 lines) | Pure deterministic repo analysis; `sanitizeForLlm` (metadata only — prompt-injection defence, never raw code); challenge from real repo gaps with hidden tests never exposed | **REUSE as context source.** Interview context already uses challenge + snapshots; keep `sanitizeForLlm` discipline for any new LLM prompt that includes repo data. |
| Auth / RBAC | `server/src/middleware/auth.ts`, `server/src/routes/assessments.ts` | Router-wide `requireAuth` (JWT Bearer) + `assessmentRateLimit`; per-route `requireRole("candidate")` / `requireRole("recruiter","admin")`; ownership via `ownCandidateId` → `loadAssessmentForCandidate` (403 on чужой assessment); recruiter evidence gated on application ownership; Zod validation on every body; `llmRateLimit` on LLM-touching routes | **REUSE as-is.** New interview-session routes follow the identical pattern (see §5). |
| Client API layer | `client/src/lib/api.ts` (~800 lines) | Typed `InterviewRow`, `InterviewQuestion`, `AnswerResult`, `InterviewReport`; `generateInterview`, `fetchInterview`, `answerInterviewQuestion`, `fetchInterviewReport` via `authedRequest` | **REUSE + extend.** Add session/timer/report client functions here, not ad-hoc fetches in pages. |
| Client shared UI | `client/src/components/assessment/shared.tsx` (117 lines) | `StatusChip`, `ScoreBar`, `LoadingState`, `ErrorState`, `InlineError`, `Stepper`, `Kv`, `BackToHub`, `prettyKey` | **REUSE.** New pages should use these, plus the Lab page's timer pattern (see below). |
| Lab timer pattern | `client/src/app/assessment/[id]/lab/page.tsx` (1,010 lines) | Client-side countdown (`as-timer`, `low` state ≤ 300 s), autosave debounce, `time_limit_minutes` from assessment | **REUSE pattern only.** Interview needs a SERVER timer (client timer is display-only; expiry must be enforced server-side). Do not copy the client-only approach. |
| E2E harness | `server/scripts/e2e-assessment.mjs` | Full flow evaluate → interview generate → list → answer → report (steps at lines ~286–299); 62/62 on 23 Nov 2026 | **REUSE + extend.** Add session/timer/follow-up/locking steps here. |

## 2. Conflicts / gaps — existing simple text interview vs required real session flow

| # | Required behaviour | What exists today | Conflict / gap |
|---|---|---|---|
| C1 | **Pre-generated 7 questions, frozen before the session starts** | `generateInterview` creates 7–8 questions once (7 base + optional 8th `follow_up` when weak areas exist) — close, but count is 7-or-8, not exactly 7, and questions are NOT frozen: `answerQuestion` can INSERT a new `follow_up` question mid-interview | Must fix count to exactly 7 pre-generated + at most 1 follow-up (total ≤ 8), and freeze the set at session start. |
| C2 | **Session object with lifecycle** (created → in_progress → completed/expired/abandoned) | No session concept. `interviews.status` is only `scheduled` / `completed` / `cancelled` (001 CHECK constraint). "Start" is implicit: the client calls `POST …/interview/generate` on page load, which doubles as list-or-create. There is no start timestamp, no expiry, no abandonment | New session state machine + columns (or a new `interview_sessions` table) required; CHECK constraint must be extended. |
| C3 | **Intro + rules screen and readiness gate** | None. Page shows an info banner ("Text-based interview. There is no voice interview.") and immediately lists all questions. No consent/rules acknowledgement, no readiness check (mic/camera N/A for text, but readiness = confirmed understanding of rules + evaluation complete) | New UI step + a server-side `readiness` acknowledgement recorded before Q1 is served. |
| C4 | **One-question-at-a-time flow** | All questions rendered at once as stacked panels, each with its own textarea + submit button; candidate can answer in any order, view all questions upfront, and skip around | Must be replaced by a stepper: server returns only the current question; client shows one card + progress (Q n of 7). |
| C5 | **Answer locking** | `interview_answers` has `UNIQUE (question_id)` + `ON CONFLICT … DO UPDATE` — answers are explicitly **re-submittable** ("Re-submit answer" button in the UI). No lock flag, no `answered_at`, no `updated_at` | Replace upsert with insert-once + 409 on re-answer; add `locked_at`/`answered_at`. Existing upsert is the direct opposite of the requirement. |
| C6 | **Follow-up max 1** | Follow-up rule exists but is loose: fires when `score < 60`, only if no `follow_up` question exists AND no follow-up has been answered. It appends a question with `question_order = 100` (sorts last, breaks one-at-a-time ordering) and its text is a generic template ("You scored lower on…"), not AI-generated from the weak answer | Keep the trigger, enforce a hard cap of 1 per session (count, not existence-check), generate the follow-up from the actual weak answer via LLM with deterministic fallback, and insert it as the next question (order = current + 0.5 / renumber), not order 100. |
| C7 | **Server timers** (per-question and/or total session budget) | None for interviews. Only the Lab has a client-side countdown; the server never enforces interview time. `interviews` has no `started_at`/`expires_at`/`time_limit` columns | New server-side timer: `started_at`, per-question `deadline`, session `expires_at`; unanswered-on-expiry = recorded as unanswered (score null), session auto-completes. Client timer is display-only. |
| C8 | **AI scoring on 5 dimensions** | Already 5 dimensions (accuracy, understanding, depth, relevance, problemSolving) with LLM-first + deterministic fallback — this part MATCHES | Gap is only presentation + aggregation: no per-dimension average across the session, no competency-profile mapping (dimension → competency label), no `method` badge per dimension in the report UI. |
| C9 | **"Explain Again"** | Does not exist anywhere (no hits in server or client). The closest feature is the adaptive follow-up, which is server-triggered, not candidate-requested | New candidate-initiated action: re-presents the current question with a clarifying rephrasing (LLM or deterministic elaboration), counts against a small budget (recommend max 1 per question / 2 per session — needs a product decision), logged as a session event, never changes the question text in the DB. |
| C10 | **Report view + competency profile (candidate)** | Report exists (`buildInterviewReport`, inline in interview page) but is minimal: final score, strengths (≥70), knowledge gaps (<50), learning areas, transcript, per-question scores. No dimension breakdown, no competency profile, no timing, no follow-up accounting | Extend report type + UI with a competency-profile section (5 dimensions × average + per-question bars) and a skills/competency mapping. |
| C11 | **Recruiter skill breakdown** | Explicitly absent: `client/src/app/recruiter/applications/[id]/evidence/page.tsx` states "Interviews are deliberately NOT shown here: the AI interview is out of scope for Phase 6" (twice, incl. footer). `verified.ts` exposes only the single `interviewScore` number to recruiters | New recruiter-facing interview breakdown section (per-dimension scores + competency profile + transcript access gated by the existing application-ownership check). |
| C12 | **Interview visibility to recruiters generally** | `GET /api/assessments/:id/monitoring/report` (recruiter/admin) includes evaluation + integrity but no interview data; `GET /verified-skills/:candidateId` returns `VerifiedProfile` with only `interviewScore` | Extend one or both endpoints (recommend the verified-skills/evidence endpoint) with the competency breakdown; do not create an ungated interview endpoint. |
| C13 | **No "competency" concept anywhere** | Zero hits for `competency`/`Competency` in `docs/`, `server/src`, `client/src` | The competency taxonomy (which dimensions map to which named competencies/skills) must be defined in Phase B — it is new product vocabulary, not a rename. |
| C14 | **Report completion side-effect** | `GET …/interviews/:id/report` auto-builds AND finalises the report (sets status `completed`) on first view — viewing the report ends the interview. The UI warns about this in small print | In a session flow, completion must be an explicit server-side transition (last answer submitted / timer expiry / candidate clicks "Finish"), not a side-effect of a GET. The GET-report route must become read-only. |
| C15 | **LLM mock honesty** | `llm.ts` mock returns a FIXED stub JSON (`provider:"mock"`, fixed summary/recommendations/answer) — it does NOT return the 5-dimension fields `AnswerSchema` expects, so under `AI_MOCK=true` every LLM interview call throws 502 → falls back to deterministic scoring. Mock is honest (labelled) but unusable for testing the LLM scoring path | Either extend the mock to return valid per-endpoint shapes (question list, 5-dimension scores, follow-up text) clearly labelled mock, or keep mock → deterministic fallback and test the LLM path only with a stubbed provider in tests. Do NOT let mock output be mistaken for live scores. |

## 3. DB — tables that exist vs new tables/columns needed

**Migration conventions (verified):** files in `infra/postgres/`, applied in filename order by `server/src/scripts/migrate.ts` (`npm run migrate`); every statement uses `CREATE TABLE IF NOT EXISTS` / `ADD COLUMN IF NOT EXISTS` / `CREATE INDEX IF NOT EXISTS` — re-runs are idempotent (verified: fresh 46 tables / 130 indexes; legacy 67 / 230). No DOWN migrations by design — rollback = pre-migration backup restore. New work = a new file `010_interview_sessions.sql` (next number; 009 is the latest), same idempotent style. Legacy preflight (`000_preflight.sql`) already normalises the old Alembic `interviews` table — new ALTERs must be `IF NOT EXISTS`-guarded the same way.

**Existing tables (relevant):**

| Table | File | Columns that matter here |
|---|---|---|
| `interviews` | 001 + 007 ALTERs | `id, candidate_id, job_id, status CHECK (scheduled/completed/cancelled), transcript TEXT, score NUMERIC(5,2), scheduled_at, created_at`; 007 adds `assessment_id`, `interview_type CHECK (assessment/screening/other)`, `report JSONB`, `model TEXT` |
| `interview_questions` | 007 | `id, interview_id FK CASCADE, category CHECK (8 values incl. follow_up), question TEXT, question_order INT, created_at` |
| `interview_answers` | 007 | `id, question_id FK CASCADE, answer TEXT, evaluation JSONB, score NUMERIC(5,2), created_at, UNIQUE(question_id)` — no `answered_at`, no lock flag, no timing |
| `assessments` | 007 | `id, candidate_id, status CHECK (draft/ready/active/submitted/evaluating/completed/failed/cancelled), time_limit_minutes, started_at, submitted_at, ended_at, consent_given_at` |
| `evaluations` | 007 | `assessment_id UNIQUE, overall_score, category_scores JSONB, evidence JSONB, passed/failed_tests, quality_issues, security_findings, improvements, strengths, weaknesses, confidence, human_review_recommended, status` |
| `challenges`, `challenge_test_cases` | 007 | Challenge title, acceptance criteria, hidden-test descriptions (never test code) |
| `code_snapshots`, `assessment_files` | 007 | Original (v0) + latest files; source of interview context |
| `assessment_events`, `code_change_events`, `terminal_execution_events`, `test_execution_events`, `monitoring_consent_records`, `integrity_findings` | 007 | Monitoring evidence consumed by evaluation + interview context |
| `verified_skills` | 007 | `candidate_id, skill_id, assessment_id, evidence JSONB, status, verified_at, UNIQUE(candidate_id, skill_id)` — only set when functional ≥ 70 |
| `profile_analyses` | 007 | `candidate_id, overall_score, category_scores JSONB, missing, weak_areas, recommendations, suggested_skills, ai_available, ai_summary` |
| `candidates`, `candidate_skills`, `skills`, `candidate_projects` | 001/004 | Profile + skills + exactly one project per candidate |
| `verification_results`, `matches`, `applications`, `jobs`, `companies` | 001 | Recruiter gating (`applications` → `jobs` → `companies.created_by`) |

**New tables / columns needed (conceptual names only — exact DDL is Phase B):**

| Item | Type | Purpose |
|---|---|---|
| `interview_sessions` (new) | Table | One row per interview attempt: `interview_id FK, candidate_id, status (created/in_progress/completed/expired/abandoned), started_at, expires_at, current_question_id, questions_total, follow_ups_used, explain_again_used, readiness_ack_at, completed_at` |
| `interview_question_attempts` or extend `interview_answers` | Columns on `interview_answers` | `answered_at, locked_at, time_spent_seconds, question_shown_at, deadline_at, explain_again_count` — replaces the re-submittable upsert with insert-once semantics |
| `interviews` extensions | Columns | `started_at, expires_at, time_limit_seconds, session_status` (or keep status on the session table only — Phase B decision); extend status CHECK to include `in_progress`/`expired` if status stays on this table |
| `interview_events` (new, optional) | Table | Session audit trail (question shown, answer submitted, explain-again, timer expiry, follow-up issued) — OR reuse `assessment_events` with new `event_type` values; reuse is preferred (see §1) |
| `competency_profiles` (new) | Table | Persisted per-interview competency roll-up: `interview_id UNIQUE, dimension_scores JSONB, competency_scores JSONB, method (llm/deterministic/mixed), computed_at` — alternatively store inside `interviews.report JSONB` (simpler; recommend JSONB first, separate table only if recruiters need to query it) |
| `interview_questions` extension | Column | `is_follow_up BOOLEAN` / `follow_up_of_question_id FK NULL` and `source (pre_generated/follow_up)` — replaces the `question_order = 100` hack and the category-only follow-up detection |
| No new tables needed for | — | Questions, answers, evaluation, verified skills, monitoring events — all exist and are reused |

## 4. New API endpoints needed

Existing interview endpoints (all in `server/src/routes/assessments.ts`, all `requireRole("candidate")`, all under `/api/assessments`):

| Existing | Method | Behaviour today |
|---|---|---|
| `POST /:id/interview/generate` | generate (idempotent create-or-return) | Keep as the pre-generation step, but it must return exactly 7 frozen questions + create the session row; it must NOT also serve as the "load my interview" endpoint |
| `GET /interviews/:interviewId` | fetch interview + all questions + answers | **Replace** for session flow: must return session state + only the current question (or a "session not started" state), never the full question list |
| `POST /interviews/:interviewId/answer` | submit/re-submit one answer, returns score + optional follow-up | **Extend**: enforce locking (409 on re-answer), enforce server deadline (410/409 on expiry), enforce follow-up cap, record timing |
| `GET /interviews/:interviewId/report` | build-or-return report (GET finalises the interview — see C14) | **Change to read-only**; finalisation moves to an explicit finish endpoint |

New endpoints (all under `/api/assessments`, same auth/RBAC patterns):

| Endpoint | Role | Purpose |
|---|---|---|
| `POST /interviews/:interviewId/session/start` | candidate (owner) | Readiness acknowledgement in body; creates/activates session, sets `started_at`/`expires_at`, returns Q1 only |
| `GET /interviews/:interviewId/session` | candidate (owner) | Session state: status, current question (only), progress n/7, time remaining (server-computed), follow-ups/explain-agains used |
| `POST /interviews/:interviewId/session/explain-again` | candidate (owner) | Rephrase current question; budget-checked; logged; returns rephrased text without mutating the stored question |
| `POST /interviews/:interviewId/session/finish` | candidate (owner) | Explicit completion: locks remaining questions as unanswered, builds report + competency profile, sets `completed`, notifies candidate |
| `GET /interviews/:interviewId/competency` | candidate (owner) | Competency profile (5-dimension averages + per-competency scores + method labels); 404 until the interview is complete |
| `GET /verified-skills/:candidateId` (extend, exists) | recruiter/admin, application-ownership gate | Add `interviewCompetency` block (dimension scores, competency profile, follow-up/timing summary) to the existing `VerifiedProfile` response |
| `GET /:id/monitoring/report` (extend, exists) | recruiter/admin, application-ownership gate | Optionally include interview summary alongside evaluation + integrity (recommend the verified-skills endpoint as the single recruiter surface instead — Phase B decision) |

Env vars (no new secrets needed): existing `AI_API_BASE_URL`, `AI_API_KEY`, `AI_MODEL`, `AI_TEMPERATURE`, `AI_MAX_TOKENS`, `AI_MOCK`, `AI_RATE_LIMIT_PER_MIN`, `AI_TIMEOUT_MS` (`server/src/config/env.ts`; `llmConfigured()` = base + key + model set AND `AI_MOCK` != true). New tunables for Phase B (names only, not yet defined): interview per-question seconds, session total seconds, max follow-ups (=1), max explain-agains per session. **Live-AI status (23 Nov 2026, per `docs/TESTING.md`): real AI calls were never tested — local AI is mock (server) / local-hash DEV-ONLY (ai-service); a live key from Gaurav is still required before any live scoring claim.**

## 5. New frontend pages / components needed

Existing pages (all under `client/src/app/assessment/[id]/` unless noted):

| Page | Lines | What it does today | Verdict |
|---|---|---|---|
| `interview/page.tsx` | 396 | Lists ALL questions at once with per-question textareas, re-submit buttons, per-answer 5-dimension feedback chips, adaptive follow-up note, inline final report (strengths/gaps/learning areas/transcript/per-question) | **Rewrite** into the session flow (see below); keep the report-rendering section as the base for the new report view |
| `interview/shared.tsx` | — | Does NOT exist (only `client/src/components/assessment/shared.tsx` exists; the `[id]/interview/shared.tsx` path in the task brief is absent) | Note: no per-interview shared module to extend |
| `challenge/page.tsx` | 498 | 3 steps: repo analysis → challenge → monitoring consent; shows time limit | **Reference only** — its consent-step pattern is the model for the interview readiness gate |
| `lab/page.tsx` | 1,010 | Monitored coding Lab with client countdown timer, autosave, run/test | **Reference only** — timer display pattern; server enforcement is new |
| `evaluation/page.tsx` | 277 | Evaluation report with fixed category weights (30/20/20/15/15), link to interview | **Link update**: point to the new session start, not the old list page |
| `report/page.tsx` | 329 | Monitoring report (candidate + recruiter views) | **Extend** (optional): surface interview completion state |
| `verified/page.tsx` | 281 | Verified profile: completion, strength, verified skills list, latest assessment, single interview score | **Extend**: add competency-profile section (candidate view) |
| `recruiter/dashboard/page.tsx` | 337 | Recruiter dashboard | **No change** unless a competency signal is added to candidate cards (Phase B decision) |
| `recruiter/applications/page.tsx` + `[id]/page.tsx` (212 + 483) | — | Application list/detail; detail links to `/evidence` | **No change** to these; the work is in the evidence page |
| `recruiter/applications/[id]/evidence/page.tsx` | ~500 | Evidence view (GitHub, coding profiles, certificates, skills-by-source, resumes) with the explicit "Interviews are NOT shown here" exclusion | **Extend**: add interview competency-breakdown section, gated by the existing application-ownership check |

New UI needed (candidate):

| Item | Purpose |
|---|---|
| Interview intro + rules screen (new step in `interview/page.tsx` or new `interview/intro` step) | What the interview is, 7 questions + max 1 follow-up, text-only, timing rules, answer locking, scoring dimensions, no penalty for accent/grammar |
| Readiness gate (checkbox + Start button) | Explicit acknowledgement persisted via `POST …/session/start`; blocks Q1 until recorded |
| One-question-at-a-time runner (rewrite of `interview/page.tsx` core) | Current question card, progress "Question n of 7", server time-remaining display, single textarea, Submit & lock button, disabled state after submit |
| Explain Again button + rephrased-question display | Candidate-initiated; shows remaining budget; rephrasing shown inline, original question preserved |
| Session-expired / abandoned states | Timer-expiry screen, resume-or-restart rules (Phase B decision: resume within session window vs restart) |
| Report view (extend existing inline report) | Final score, 5-dimension averages with bars, competency profile, strengths/gaps/learning areas, follow-up + timing summary, full transcript |
| Competency profile component (new, `client/src/components/assessment/CompetencyProfile.tsx` or similar) | Reusable dimension-bar chart used by candidate report, verified page, and recruiter evidence view |

New UI needed (recruiter): interview skill-breakdown section in the evidence page (dimension scores + competency profile + per-question scores + method labels), reusing the same `CompetencyProfile` component.

## 6. Tests — exist vs needed

**How tests run:** `cd server && npm test` — Node's built-in runner via `tsx --test` (per `docs/TESTING.md`; the literal `test` script line in `server/package.json` embeds a JWT secret that is redacted in tool output, so quote it from TESTING.md, not from the raw line). DB tests skip gracefully without Postgres; live-GitHub test skips without `GITHUB_LIVE=1`. Client has no test runner configured (`client/package.json` scripts: dev/build/start/typecheck/lint only). E2E: `BASE_URL=http://127.0.0.1:4000 node server/scripts/e2e-assessment.mjs` (62/62 on 23 Nov 2026, incl. interview generate → answer → report). Last full run 23 Nov 2026: server 111 pass / 0 fail / 1 skipped.

**Existing test files (17 in `server/tests/`):** `analytics, applications, auth, auth.db, challenge, email, errorHandler, githubPublicRepo, llm, monitoring, phase7, queues-dedup, recruiter, repoAnalysis, strength, student, student-race`. Relevant coverage: `llm.test.ts` (mock/labels, retry, rate limit, schema validation); `challenge.test.ts` (deterministic generation, validation, hidden-test non-exposure, LLM fallback); `strength.test.ts` (deterministic scoring, WHY on recommendations, fallback); `monitoring.test.ts` (event dedup, side tables, consent, integrity, purge); `phase7.test.ts` (messaging/notifications/contact only — **no interview tests**). **There is no `interview.test.ts` and no `evaluation.test.ts`** — the interview service (513 lines) and evaluation service (454 lines) have zero dedicated unit tests; they are covered only by the E2E script.

**New tests needed:**

| File | Covers |
|---|---|
| `server/tests/interview-session.test.ts` (new) | Session lifecycle (create → start → in_progress → completed/expired); exactly 7 pre-generated questions; readiness gate blocks Q1; current-question-only responses; answer locking (2nd submit → 409); follow-up cap (max 1, even with two sub-60 answers); server deadline enforcement (late answer rejected; expiry marks unanswered); Explain Again budget + logging; GET report is read-only (does not complete); deterministic fallback when LLM unconfigured |
| `server/tests/competency.test.ts` (new) | 5-dimension aggregation (averages, weighting), competency mapping, method labels (llm/deterministic/mixed), empty/unanswered handling, recruiter payload shape |
| `server/tests/interview.test.ts` (new, or fold into session file) | Existing behaviour regression: deterministic question builder, `evaluateAnswerDeterministic` bands, `buildInterviewReport` strengths/gaps thresholds (≥70 / <50), idempotent generate |
| `server/tests/migration-010.test.ts` (new, or extend existing migration check) | 010 applies cleanly on fresh + legacy DBs, is idempotent on re-run, CHECK constraints hold (status values, follow-up cap) |
| Extend `server/scripts/e2e-assessment.mjs` | Session happy path end-to-end: start → answer 7 → follow-up → finish → report → competency → recruiter evidence view |
| Client | No harness exists — manual/browser verification only, or add a harness in Phase B (out of scope for the audit to decide) |

## 7. Docs — what exists

`docs/` (14 files, 3,357 lines): `API.md`, `ARCHITECTURE.md`, `ASSESSMENT_ARCHITECTURE.md` (680), `ASSESSMENT_AUDIT.md` (818), `ASSESSMENT_IMPLEMENTATION_REPORT.md`, `DATABASE.md`, `DEPLOYMENT.md`, `ENVIRONMENT.md`, `FINAL_AUDIT.md`, `MIGRATION_GUIDE.md`, `PHASE_ZERO.md`, `POSTGRES_MIGRATION_PLAN.md`, `RUNBOOK.md`, `SECURITY.md`, `TESTING.md`. Interview/scoring coverage: `API.md` lists the 4 interview endpoints + evaluation weights; `ASSESSMENT_ARCHITECTURE.md` / `ASSESSMENT_AUDIT.md` document the interview engine, 5-dimension scoring, and verified-profile bar. **No competency/scoring/interview design doc exists** — no file defines a competency taxonomy, dimension-to-competency mapping, timer values, follow-up policy, or Explain Again rules. This map (`IMPLEMENTATION_MAP_COMPETENCY.md`) is the first such document; Phase B should add a `COMPETENCY_SPEC.md` (taxonomy + thresholds + timer values) and update `API.md` + `DATABASE.md` when the endpoints/010 land.

## 8. Sequenced Phase B–G work list

- **Phase B — Spec + DB (no UI):** (1) Confirm the 24 Nov directive governs over the 17 Nov exclusion (record the decision in `docs/API.md`). (2) Write `COMPETENCY_SPEC.md`: competency taxonomy, dimension→competency map, timer values (per-question + session total), follow-up trigger + cap, Explain Again budget, lock semantics, resume/restart rules. (3) Migration `010_interview_sessions.sql` (idempotent, fresh + legacy verified). (4) Extend `interviews` status CHECK + `interview_answers` locking columns.
- **Phase C — Server session + scoring:** (1) New `interviewSession.ts` service (or extend `interview.ts`): pre-generate exactly 7, freeze set, start/expire/finish transitions, server timers, current-question-only reads. (2) Locking: insert-once answers, 409 on re-answer. (3) Follow-up: max 1, AI-generated from the weak answer, deterministic fallback. (4) Explain Again: rephrase endpoint + budget + event log. (5) Competency aggregation + report extension. (6) Make GET report read-only; explicit finish endpoint. (7) New routes in `assessments.ts` with existing auth/RBAC/Zod/rate-limit patterns.
- **Phase D — Recruiter surface:** Extend `verified.ts` `VerifiedProfile` + `GET /verified-skills/:candidateId` with the interview competency block (same application-ownership gate); decide whether `GET /:id/monitoring/report` also carries it (recommend: no — one surface).
- **Phase E — Candidate frontend:** Rewrite `interview/page.tsx` as intro → readiness gate → one-at-a-time runner → report; add `CompetencyProfile` component; update `evaluation/page.tsx` link, `verified/page.tsx` competency section, `report/page.tsx` state.
- **Phase F — Recruiter frontend:** Add the interview skill-breakdown section to `recruiter/applications/[id]/evidence/page.tsx` (removing the "interviews not shown" exclusion text); reuse `CompetencyProfile`.
- **Phase G — Tests + docs + verification:** New `interview-session.test.ts`, `competency.test.ts`, `interview.test.ts`, migration test; extend `e2e-assessment.mjs`; full local verification (server tests, E2E, API flow, browser) re-run from scratch; update `API.md`, `DATABASE.md`, `TESTING.md`; final report to Gaurav for audit. No push/deploy/production step in any phase without his named go-ahead.

## 9. Biggest risks / open decisions for Phase B

1. The 17 Nov exclusion vs the 24 Nov directive — get the governing decision recorded before building.
2. Timer values, Explain Again budget, and resume-vs-restart after expiry are product decisions with no current spec.
3. The competency taxonomy does not exist yet — it is new product vocabulary, not a rename of the 5 dimensions.
4. Live AI has never been tested (no live key); all LLM-path claims must stay mock-labelled until a live key is provided and the path is verified.
5. `server/package.json` `test` script line embeds a secret (redacted in tool output) — verify the exact command from the file directly before quoting it in docs.
