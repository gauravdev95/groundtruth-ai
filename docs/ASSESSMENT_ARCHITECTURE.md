# Assessment System — Target Architecture (Phase 1)

> **As-built note (2026-11-18, implementation pass).** This document was
> written as the Phase 1 target architecture against HEAD `6462b04`, before
> the implementation. The system as built keeps every design principle in §1
> but differs from this plan in five concrete places — the plan below is kept
> intact as the design record; the built system is authoritative:
>
> 1. **LLM client lives in the Express server** (`server/src/services/llm.ts`,
>    OpenAI-compatible chat completions + mock provider), NOT in ai-service.
>    No `ai-service/app/routers/llm.py` or `llm_client.py` was created; the
>    FastAPI ai-service is untouched by the assessment build.
> 2. **No `AI_MODEL` default.** The task forbids a hardcoded model name, so
>    `AI_MODEL` is blank in every `.env.example` and must be set explicitly;
>    the `gpt-4o-mini` default named in §7/§11 of this doc was NOT adopted.
> 3. **Monitoring tables are `assessment_events` + typed side tables**
>    (`code_change_events`, `terminal_execution_events`, `test_execution_events`,
>    `activity_snapshots`, `monitoring_summaries`, `integrity_findings`,
>    `monitoring_consent_records`) — see `infra/postgres/007_assessment.sql`.
>    There is no `monitoring_events` table and no `assessment_attempts` table;
>    attempts are the `assessments` rows themselves (status machine).
> 4. **Execution is synchronous in `server/src/services/execution.ts`**
>    (`runSandboxed`, unshare namespaces, `EXECUTION_SANDBOX` kill-switch) —
>    there is no separate `sandbox.ts` or BullMQ execution worker, and no
>    Docker anywhere (Docker is not installed in this VM).
> 5. **Routes are `server/src/routes/assessments.ts`** (plural, matching the
>    repo's existing naming) and the interview reuses the existing `interviews`
>    table (007 only ALTERs it) rather than a new interview-sessions table.
>    The phase table in §12 still describes the work; phases 2–12 are
>    implemented in that order in the code and the final report
>    (`docs/ASSESSMENT_IMPLEMENTATION_REPORT.md`) is the as-built record.


**Repo:** `gauravdev95/groundtruth-ai` @ `6462b04`
**Companion doc:** `docs/ASSESSMENT_AUDIT.md` — read it first. Every design
choice below is a response to a fact in that audit; section references like
"Audit §8.5" point at it.
**Status:** design only. No code in this document is implemented yet; file
paths under "new" are the planned locations.

---

## 1. What the assessment system is

Today GroundTruth collects *claims* (a resume, a repo URL, a typed
certificate) and scores *relevance* (cosine similarity). It never tests
whether the student can actually do the work (Audit §11). The assessment
system closes that gap with one verifiable loop:

> **Profile → selected project → repo analysis → generated challenges →
> Live Lab (sandboxed code) → monitoring → rubric evaluation → interview →
> verified profile.**

The output is a **verified profile**: a student whose claimed skills have
survived live, monitored, executed work — stored as `verification_results`
(`source='interview'`) and `candidate_skills` (`source='interview'`), so
recruiters read it through the evidence views they already have
(Audit §5.2), not through a new parallel system.

### Design principles (non-negotiable, inherited from the repo)

1. **Honest by default.** The repo's rule — a missing score is `NULL`,
   never invented (Audit §3.1, §8.1) — applies to every assessment
   number. An unevaluated attempt has no score; a failed sandbox run is
   a failed run, not a zero with a story attached.
2. **Server computes, client displays.** Completeness is computed
   server-side on every read (Audit §6.2). Profile strength, verdicts,
   and monitoring status follow the same rule: the client never invents
   them.
3. **Async heavy work, 202 + jobId.** Challenge generation, execution,
   and evaluation never run in the request path — BullMQ queues with the
   existing defaults (3 attempts, exponential backoff 2s → 4s → 8s,
   Audit §8.4).
4. **Reuse before rebuild.** `verification_results`, `interviews`,
   `candidate_projects`, `candidate_skills`, the queue/worker split, and
   the ai-service boundary already exist. New tables only where no table
   covers the need (see §6 — the "do not duplicate" list is explicit).
5. **No Docker dependency.** Docker is not installed in this VM
   (Audit §12.5). The execution sandbox is built on Linux user
   namespaces (`unshare`), which were verified working here.
6. **Tests run without keys or network.** The LLM client has a mock
   provider; the sandbox has a `disabled` mode. CI must be able to run
   the whole suite with no secrets (Audit §12.3 notes CI currently runs
   neither the server suite nor anything needing a key).

---

## 2. Component diagram (ASCII)

```
                          ┌─────────────────────────────────────────┐
                          │  Next.js 14 client (client/)           │
                          │  /student/assessment/*  (new pages)    │
                          │  /student/dashboard, /student/profile  │
                          │  (strength + monitoring cards, exist)  │
                          │  /recruiter/applications/[id]/evidence │
                          │  (reads verified profile, exists)      │
                          │  Editor: plain <textarea> first;       │
                          │  Monaco is a LATER optional add-on     │
                          └──────────────┬──────────────────────────┘
                                         │ HTTPS, Bearer JWT (localStorage
                                         │ gt-auth-token), /api/* only
                          ┌──────────────▼──────────────────────────┐
                          │  Express server (server/src/)          │
                          │  routes/assessment.ts  (NEW)           │
                          │  services/assessment.ts (NEW)          │
                          │  services/llm.ts (NEW, thin client)    │
                          │  services/sandbox.ts (NEW, unshare)    │
                          │  services/profileStrength.ts (NEW,     │
                          │    extends computeCompleteness)        │
                          │  middleware/auth.ts (EXISTS:            │
                          │    requireAuth/requireRole)            │
                          │  middleware/rateLimit.ts (NEW)         │
                          │  queues: assessment-* (NEW, BullMQ)    │
                          │  workers: challengeGen, execution,     │
                          │    evaluation, monitoring (NEW)        │
                          └──────┬───────────────────┬──────────────┘
                 pg Pool         │                   │ BullMQ/Redis
                  (EXISTS)       │                   │ (EXISTS)
                          ┌──────▼──────┐   ┌───────▼────────┐
                          │ Postgres 16 │   │ Redis 7        │
                          │ + pgvector  │   │ queues +       │
                          │ 001–006     │   │ job state      │
                          │ + 007 (NEW) │   └────────────────┘
                          └──────┬──────┘
                                 │
                          ┌──────▼──────────────────────────────┐
                          │ FastAPI ai-service (ai-service/app/)│
                          │ routers/llm.py (NEW)                │
                          │   POST /llm/generate-challenge      │
                          │   POST /llm/evaluate                │
                          │   POST /llm/interview-questions     │
                          │   POST /llm/summarise-repo (NEW)    │
                          │ routers/{embed,parse,analyze,match} │
                          │   (EXIST — reused, not rewritten)   │
                          │ llm_client.py (NEW, §7)             │
                          │ embeddings.py (EXIST — fallback     │
                          │   pattern reused for the mock)      │
                          └─────────────────────────────────────┘

  Execution sandbox (NOT a service — a local runner invoked by the
  execution worker on the server host):
                          ┌─────────────────────────────────────┐
                          │ unshare -U -r -n -m -p -f           │
                          │   + prlimit + timeout               │
                          │   tmpfs workdir, read-only binds,   │
                          │   no network, no Docker (§8)        │
                          └─────────────────────────────────────┘
```

### Layer responsibilities

| Layer | Owns | Must NOT own |
| --- | --- | --- |
| Client | Rendering, editor UI, polling job status, showing server-computed scores | Scoring, verdicts, monitoring conclusions, code execution |
| Express server | AuthZ, ownership checks, orchestration, queues, sandbox invocation, persistence | LLM prompts, model calls, embedding math |
| ai-service | All LLM calls, repo analysis, embeddings, matching | Auth decisions, sandbox execution, verdicts |
| Postgres | All durable state incl. monitoring events + verdicts | Anything derived that can be recomputed (strength is computed, not stored — except a snapshot, §5) |
| Redis/BullMQ | Job queues, retries, job state | Durable records (jobs are ephemeral; results live in Postgres) |

---

## 3. Data flow — the full student journey

```
1. ONBOARDING (exists)
   Student completes onboarding (basic + one project mandatory,
   Audit §6.1). Completeness 70%+; onboarding_completed_at set.
        │
2. ELIGIBILITY GATE (new, server-side)
   GET /api/assessments/eligibility → checks onboarding completed,
   exactly one candidate_projects row, and (if kind='repository')
   repo_url present. Returns { eligible, missing[] }. No assessment
   starts below the gate; the client shows the missing items with
   links (same pattern as "Improve your profile", Audit §6.2).
        │
3. ASSESSMENT START (new)
   POST /api/assessments → creates assessments row (status='created',
   snapshot of completeness + project id). 202 + assessment id.
   Enqueues challenge-generation job.
        │
4. PROJECT SELECTION + REPO ANALYSIS (extends existing)
   Worker reads the ONE candidate_projects row (never "the current
   project" at read time — the assessment pins project_id at creation,
   Audit §6.3). If kind='repository', calls existing
   POST /analyze-repo (depth-1 clone, languages, file count) and
   stores the raw result as verification_results source='github'
   (existing behaviour, Audit §7) AND a summarised brief for the
   challenge generator (new: POST /llm/summarise-repo).
   If kind='described', generation uses title/description/
   technologies only, and the assessment is labelled
   repo_evidence='none' — never pretends a repo was checked.
        │
5. CHALLENGE GENERATION (new, async)
   Worker calls ai-service POST /llm/generate-challenge with:
   project brief + skills (candidate_skills) + target_roles +
   difficulty ladder. LLM returns 3 challenges (repo-grounded code
   task, concept task, debugging task) + hidden test cases, in
   strict JSON (validated by pydantic; invalid JSON → job retry,
   then failure recorded honestly, never a fallback challenge
   invented locally). Stored in assessment_challenges +
   challenge_test_cases. Status → 'ready'.
        │
6. LIVE LAB (new)
   Student opens /student/assessment/[id]/lab. Client polls
   GET /api/assessments/:id (status, challenges, attempt state).
   Editor is a plain textarea + language selector first (no Monaco
   dep — Audit §12.1). "Run" → POST /api/assessments/:id/attempts
   {challenge_id, code, language} → creates assessment_attempts
   (status='running') + enqueues execution job → 202 + attempt id.
   "Run" is rate-limited (see §9) and each run is a fresh sandbox.
        │
7. SANDBOXED EXECUTION (new, §8)
   Execution worker invokes the unshare sandbox: writes code to a
   tmpfs workdir, runs the language runtime with `timeout` +
   `prlimit` inside user+net+mount+pid namespaces, captures
   stdout/stderr (truncated, e.g. 64 KB), exit code, duration,
   timeout flag. Runs hidden test cases; stores per-case
   pass/fail in execution_runs. Attempt status → 'executed'
   (or 'failed' on sandbox error — recorded, not hidden).
        │
8. MONITORING (new, §8 of this doc / extends Audit §5.1)
   Every meaningful action appends a monitoring_events row:
   lab opened, code run, paste burst, tab blur/focus (client
   beacons, best-effort), long idle, submission. Events are
   append-only facts, NOT verdicts. A monitoring summary is
   computed server-side from events when the recruiter view loads
   (same "derived, not asserted" rule as AI Monitoring).
        │
9. EVALUATION (new, async)
   On submit, worker calls ai-service POST /llm/evaluate with:
   challenge, submitted code, test results, repo brief. LLM
   returns rubric scores (correctness, code quality, repo
   understanding, originality flags) + feedback, strict JSON.
   Stored in assessment_evaluations (model labelled, like
   embeddings.model). Scores from tests (pass rate) are computed
   locally and stored alongside — the LLM never overwrites a
   measured number. Attempt status → 'evaluated'.
        │
10. INTERVIEW (new, extends existing interviews table)
    After evaluation, the student books/starts an interview:
    POST /api/assessments/:id/interview creates a row in the
    EXISTING interviews table (status='scheduled', assessment_id
    set — see §6). Questions are generated by
    POST /llm/interview-questions from the evaluation + repo brief
    (stored on the assessment, not in the interview row).
    Transcript + score land on the same interviews row when done
    (columns already exist: transcript, score, status).
        │
11. VERIFIED PROFILE (new verdict, existing surfaces)
    Server computes the verdict from: test pass rate + rubric
    scores + interview score + monitoring summary. Verdict
    (verified | needs_review | rejected) + evidence JSONB stored
    in assessment_verdicts AND a verification_results row
    (source='interview', score=overall) so the recruiter evidence
    view (Audit §5.2) shows it with zero new UI. Proven skills
    upserted into candidate_skills with source='interview'.
    Profile Strength gains an assessment component (§5).
        │
12. RECRUITER READ (exists, extended)
    Recruiter opens /recruiter/applications/[id]/evidence:
    sees the verification_results row, the interview row, the
    monitoring summary, and the verdict — all from existing
    tables + the two new verdict/summary reads. No new recruiter
    page is needed for v1.
```

**Failure honesty at every step:** a failed generation, a sandbox error,
or a refused LLM call leaves the assessment in a named non-ready state
with the error recorded (`error` column / event), and the UI says what
failed. Nothing in this flow ever synthesises a score to fill a gap.

---

## 4. API route table

Base: Express server, mounted at `/api/assessments` in `src/index.ts`
(next to the existing routers — Audit §4.2). All routes require
`requireAuth`; student routes add `requireRole("candidate")`, recruiter
reads add `requireRole("recruiter", "admin")`. Ownership is enforced
with the existing `ownCandidate` / `ownRow` pattern
(`routes/student.ts`): a candidate can only touch their own assessment.

### New server routes (`server/src/routes/assessment.ts`)

| Method + path | Role | Behaviour |
| --- | --- | --- |
| `GET /api/assessments/eligibility` | candidate | Gate check (§3 step 2). Returns `{eligible, missing[]}`. |
| `POST /api/assessments` | candidate | Create assessment from the student's one project. 202 + `{assessment_id}`. Enqueues challenge generation. 409 if an active assessment already exists for this candidate. |
| `GET /api/assessments` | candidate | List own assessments (newest first). |
| `GET /api/assessments/:id` | candidate (owner) | Full assessment: status, project snapshot, challenges (without hidden test cases — never send expected outputs to the client), attempts, evaluations, verdict. |
| `POST /api/assessments/:id/attempts` | candidate (owner) | Submit code for a challenge. Body `{challenge_id, code, language}` (zod; code ≤ 100 KB, language ∈ `python \| javascript \| typescript`). Creates attempt, enqueues execution. 202 + `{attempt_id}`. Rate-limited (§9). |
| `GET /api/assessments/:id/attempts/:attemptId` | candidate (owner) | Attempt detail incl. execution run (stdout/stderr truncated, per-case results, duration). |
| `POST /api/assessments/:id/submit` | candidate (owner) | Submit the assessment for evaluation (all challenges attempted or explicitly skipped). Enqueues evaluation. 202. |
| `POST /api/assessments/:id/interview` | candidate (owner) | Create the interview row (existing `interviews` table) + enqueue question generation. 202. |
| `GET /api/assessments/:id/verdict` | candidate (owner) / recruiter / admin | Verdict + evidence summary. Recruiter access is scoped: only if the recruiter has an application from this candidate (check `applications` join) — otherwise 403. |
| `GET /api/assessments/:id/monitoring` | candidate (owner) / recruiter (scoped as above) / admin | Monitoring summary derived from events (counts by type, flags, timeline). Raw events are admin/recruiter-scoped; the student sees their own summary. |
| `POST /api/assessments/:id/events` | candidate (owner) | Client beacon for lab events (focus/blur, paste, idle). Best-effort, rate-limited, small payload; failures are ignored client-side. |

### New ai-service routes (`ai-service/app/routers/llm.py`)

| Method + path | Behaviour |
| --- | --- |
| `POST /llm/generate-challenge` | Body: project brief, skills, target roles, difficulty. Returns strict-JSON challenges + hidden tests. Validated by pydantic; on invalid JSON the route returns 502 (never a locally invented challenge). |
| `POST /llm/evaluate` | Body: challenge, code, test results, repo brief. Returns rubric JSON + feedback. |
| `POST /llm/interview-questions` | Body: evaluation summary, repo brief, target role. Returns ordered question list. |
| `POST /llm/summarise-repo` | Body: `/analyze-repo` result + README/file list. Returns a short structured brief for generation. |

The existing ai-service routes (`/embed`, `/parse-resume`,
`/analyze-repo`, `/match`) are **unchanged**. The server keeps calling
them through `services/aiService.ts`; a new `services/llm.ts` (thin
`fetch` wrapper, same pattern as `aiService.ts`) calls the four new
routes. No auth is added between server and ai-service in v1 — the
service stays private behind the compose network (Audit §12.2 item 10
records the risk; making it public requires a shared secret first).

### New queues (`server/src/queues/index.ts` — extend, don't replace)

| Queue | Concurrency | Worker does |
| --- | --- | --- |
| `assessment-challenge-gen` | 2 (LLM-bound, keep low) | repo brief → `POST /llm/generate-challenge` → store challenges + tests |
| `assessment-execution` | 4 (CPU-bound; tune to host) | run sandbox (§8) → store `execution_runs` |
| `assessment-evaluation` | 2 (LLM-bound) | `POST /llm/evaluate` → store `assessment_evaluations` |
| `assessment-interview-prep` | 2 | `POST /llm/interview-questions` → store questions on the assessment |

Same default job options as the existing queues (3 attempts,
exponential backoff 2s → 4s → 8s, `removeOnComplete/removeOnFail`
bounded). Existing queues (`github-analysis`, `llm-parsing`,
`vector-reembedding`) are untouched.

---

## 5. Profile strength engine

Today: `computeCompleteness` (Audit §6.2) — five sections, weights
35/35/10/5/15, mandatory-only = 70%, computed on read, never stored.

**Assessment extension (Phase 3 in §11):** a second, separate score —
**verification strength** — computed server-side in a new
`services/profileStrength.ts`:

- Inputs (all from stored rows, never from the client): assessment
  verdict (`assessment_verdicts`), latest evaluation rubric,
  interview score (`interviews.score`), repo-analysis presence
  (`verification_results source='github'`), skills proven live
  (`candidate_skills source='interview'`).
- Output: `{ verified: boolean, verdict, score: number | null,
  proven_skills: string[], evidence: {...} }`, where `score` is
  `null` until an assessment is evaluated — the same honesty rule as
  `matches.score`.
- Display: the existing `ProfileStrengthCard` gains a "Verified"
  section when a verdict exists; the AI Monitoring card gains an
  assessment-status line. No new strength component is built in v1.
- **Completeness weights do NOT change.** The 35/35/10/5/15 split
  (Audit §6.2) measures *profile fullness*; verification strength is a
  parallel signal, shown separately, so a verified-but-incomplete
  profile and a complete-but-unverified profile are never confused.
- Snapshot: `assessments.profile_strength_snapshot JSONB` stores the
  completeness percent + section list *at assessment start*, so a later
  profile edit cannot rewrite what the assessment was based on. The
  live strength is always recomputed; the snapshot is evidence only.

---

## 6. Database — migration `007_assessment.sql` (new tables only)

File: `infra/postgres/007_assessment.sql`, applied by the existing
`migrate.ts` (filename order). Idempotent (`IF NOT EXISTS` everywhere),
same conventions as 001–006 (UUID PKs, `TIMESTAMPTZ DEFAULT now()`,
FKs with `ON DELETE CASCADE` to the owning row).

### Tables that already exist — DO NOT create again

| Existing table | Assessment use (no new table) |
| --- | --- |
| `interviews` | The assessment interview **is** a row here. 007 adds columns only (see below). Columns already present and reused: `status`, `transcript`, `score`, `scheduled_at`, `candidate_id`, `job_id`. |
| `candidate_projects` | The assessed project. 007 adds nothing; the assessment pins `project_id`. |
| `verification_results` | Assessment outcome record (`source='interview'`, `result` JSONB, `score`). 007 adds nothing; the `source` CHECK already includes `'interview'`. |
| `candidate_skills` | Proven skills (`source='interview'`). CHECK already includes `'interview'`. |
| `candidates` | No new columns in v1 (eligibility is derived). |
| `matches`, `embeddings` | Untouched by the assessment. |

### New tables in 007

| Table | Key columns | Notes |
| --- | --- | --- |
| `assessments` | `id`, `candidate_id` → candidates CASCADE, `project_id` → candidate_projects CASCADE, `status` CHECK `(created, generating, ready, in_progress, submitted, evaluating, interviewed, completed, failed)` DEFAULT `'created'`, `repo_evidence` CHECK `(repo_analysed, described_only)` , `profile_strength_snapshot` JSONB DEFAULT `'{}'`, `error` TEXT, `created_at`, `updated_at` | One active assessment per candidate enforced in the route (409); a DB partial unique index `ON assessments (candidate_id) WHERE status NOT IN ('completed','failed')` backs it. |
| `assessment_challenges` | `id`, `assessment_id` → assessments CASCADE, `kind` CHECK `(repo_task, concept, debugging)`, `title`, `prompt` TEXT, `spec` JSONB (language, time limit, starter code), `difficulty` CHECK `(easy, medium, hard)`, `order_index` INT, `generated_by` TEXT (model label), `created_at` | Hidden test cases live in the child table, never here. |
| `challenge_test_cases` | `id`, `challenge_id` → assessment_challenges CASCADE, `name`, `input` TEXT, `expected_output` TEXT, `hidden` BOOLEAN DEFAULT TRUE, `created_at` | **Never sent to the client.** Visible cases (`hidden=false`) may be shown as examples; hidden ones are server-only. |
| `assessment_attempts` | `id`, `challenge_id` → assessment_challenges CASCADE, `candidate_id` → candidates CASCADE, `status` CHECK `(running, executed, evaluated, failed)` DEFAULT `'running'`, `code` TEXT, `language` CHECK `(python, javascript, typescript)`, `submitted_at`, `created_at` | One attempt row per submission; re-runs create new rows (history is evidence). |
| `execution_runs` | `id`, `attempt_id` → assessment_attempts CASCADE, `sandbox` TEXT DEFAULT `'unshare'` (or `'disabled'`), `exit_code` INT, `stdout` TEXT (truncated), `stderr` TEXT (truncated), `duration_ms` INT, `timed_out` BOOLEAN DEFAULT FALSE, `test_results` JSONB (per-case pass/fail), `resource_usage` JSONB, `created_at` | stdout/stderr truncated at write time (64 KB cap); full output is never stored. |
| `assessment_evaluations` | `id`, `attempt_id` → assessment_attempts CASCADE, `rubric` JSONB (per-criterion scores), `overall_score` NUMERIC(5,2), `test_pass_rate` NUMERIC(5,4) (computed locally, not from the LLM), `feedback` TEXT, `model` TEXT (label, like `embeddings.model`), `evaluated_at` | LLM output is validated JSON; a failed parse stores no row and marks the attempt `failed` with an error. |
| `assessment_verdicts` | `id`, `candidate_id` → candidates CASCADE, `assessment_id` → assessments CASCADE UNIQUE, `verdict` CHECK `(verified, needs_review, rejected)`, `overall_score` NUMERIC(5,2), `evidence` JSONB, `decided_at` | One verdict per assessment; mirrors into `verification_results` (the recruiter-visible record). |
| `monitoring_events` | `id`, `assessment_id` → assessments CASCADE, `attempt_id` → assessment_attempts SET NULL, `candidate_id` → candidates CASCADE, `event_type` TEXT (see §8), `payload` JSONB DEFAULT `'{}'`, `created_at` | Append-only. Retention by `MONITORING_RETENTION_DAYS` (§10); a scheduled purge deletes rows older than the window (never the verdict/summary). Index on `(assessment_id, created_at)`. |

### ALTERs in 007 (existing tables, additive only)

```sql
ALTER TABLE interviews ADD COLUMN IF NOT EXISTS assessment_id UUID
  REFERENCES assessments (id) ON DELETE SET NULL;
ALTER TABLE interviews ADD COLUMN IF NOT EXISTS mode TEXT
  CHECK (mode IS NULL OR mode IN ('assessment', 'recruiter')) DEFAULT 'assessment';
-- (mode distinguishes assessment interviews from future recruiter-scheduled ones;
--  existing rows keep mode NULL until backfilled by the application, never by SQL.)
CREATE INDEX IF NOT EXISTS idx_interviews_assessment ON interviews (assessment_id);
```

No other ALTERs. In particular: no changes to `candidates`,
`candidate_projects`, `verification_results`, or `candidate_skills`.

---

## 7. LLM client design (ai-service)

New module: `ai-service/app/llm_client.py`, used by the four new
routers in `routers/llm.py`. It mirrors the existing `embeddings.py`
pattern (raw `httpx`, no vendor SDK, explicit fallback labelling).

### Configuration (env — see §10)

`AI_API_BASE_URL` (default `https://api.openai.com/v1`),
`AI_API_KEY` (no default), `AI_MODEL` (default `gpt-4o-mini`),
`AI_TEMPERATURE` (default `0.2`), `AI_MAX_TOKENS` (default `2048`),
`AI_MOCK` (`true`/`false`, default `false`).

### Providers

1. **OpenAI-compatible HTTP provider** (default when `AI_MOCK=false`
   and a key is set): `POST {AI_API_BASE_URL}/chat/completions` with
   `Authorization: Bearer {AI_API_KEY}`, body `{model, temperature,
   max_tokens, response_format: {"type": "json_object"}, messages}`.
   Any OpenAI-compatible endpoint works (the base URL is the only
   vendor-specific part). Timeout 60 s for generation, 30 s for
   evaluation. Non-2xx or invalid JSON → raise (callers translate to
   502; the job retries via BullMQ; after retries the assessment is
   marked `failed` with the error — never a silent fallback).
2. **Mock provider** (`AI_MOCK=true`): returns deterministic canned
   JSON per endpoint (fixed challenges, fixed rubric, fixed
   questions), labelled `model="mock-dev-only"` — the same labelling
   discipline as `local-hash-dev-only` (Audit §8.2). Used by all
   tests and by local dev without a key. The mock is **not** a
   fallback: if `AI_MOCK=false` and no key is set, the client raises
   a clear configuration error instead of silently mocking.
3. **No key + no mock = hard error.** Mirrors `embed_text` ("raises on
   OpenAI failure — never silently falls back", Audit §8.2).

### Contract rules

- Every LLM response that feeds the DB is **strict JSON**
  (`response_format json_object` + pydantic validation in the router).
  A response that fails validation is a 502, not a repair attempt.
- The model name that produced a row is **stored on the row**
  (`assessment_challenges.generated_by`,
  `assessment_evaluations.model`) — the same provenance rule as
  `embeddings.model`.
- Prompts live in `ai-service/app/llm_prompts.py` (versioned strings,
  not inline in routers), so a prompt change is a reviewable diff.
- Temperature is low (0.2) for evaluation (deterministic rubric) and
  may be raised per-call for generation; both values come from env /
  call parameters, never hardcoded in prompts.
- **No LLM output is ever shown as fact without its source.** Feedback
  shown to the student is labelled as AI-generated; scores shown to
  recruiters carry the model label.

---

## 8. Execution sandbox design (verified primitive: `unshare`)

### What was verified (Audit §12.5, 2026-11-18, this VM)

- `unshare -U -r -n sh -c 'echo ok'` → `ok` (user + net namespaces,
  mapped root inside).
- `unshare -U -r -n -m -p -f` → namespace creation + `mount -t tmpfs`
  + Python execution all succeed inside.
- The net namespace contains only `lo` (DOWN) — no external interface.
- `/proc/sys/kernel/unprivileged_userns_clone = 1`.
- **Docker is not installed.** Node v24.22.1, Python 3.12.3 present.

### Runner design (`server/src/services/sandbox.ts`, invoked by the execution worker)

```
host (server process, unprivileged user)
 └─ spawn: timeout <T>s prlimit [limits] unshare -U -r -n -m -p -f \
      sh -c '<setup> ; exec <runtime> <workdir>/solution.<ext>'
     │
     ├─ -U -r : new user namespace, map current user to root inside
     │          (the process is unprivileged outside; root inside
     │          cannot escape to host root)
     ├─ -n    : new network namespace, only lo (DOWN) → no network
     ├─ -m    : new mount namespace; workdir is a fresh tmpfs,
     │          everything else bind-mounted read-only (or not at all);
     │          /tmp, $HOME, and the repo are NOT visible
     ├─ -p -f : new PID namespace (fork); the child sees itself as PID 1
     ├─ prlimit: --nproc, --as (memory), --cpu, --fsize (no core dumps),
     │          --nofile; exact values from env, defaults conservative
     │          (e.g. 512 MB, 30 s CPU, 1024 fds)
     ├─ timeout: EXECUTION_TIMEOUT_SECONDS (default 30) — kills the
     │          whole process group on expiry; timed_out=true recorded
     └─ workdir: mkdtemp tmpfs dir, code + test harness copied in,
        removed after the run (best-effort rm -rf; tmpfs is per-run)
```

Supported runtimes in v1 (from what's installed on the host — no new
language installs in v1): `python3` (Python 3.12) and `node` (Node 24).
Each run is one process per test case (or one process running a small
harness that runs all cases and prints one JSON line per case — the
harness is server-controlled code, never student code). The harness
prints machine-readable results to stdout; anything else on stdout is
captured as program output (truncated).

### Safety rules

- Student code **never** runs in the server process, never with host
  network, never with host filesystem write access, never as host root.
- No `eval`/`exec` of student code in Node/Python on the host — only
  inside the namespace, via a spawned child.
- Output caps: stdout/stderr truncated to 64 KB at capture; test
  results stored as JSON, not raw text.
- `EXECUTION_SANDBOX=disabled` (env): the execution worker records
  `sandbox='disabled'` and marks attempts `failed` with "execution
  disabled" — it never pretends a run happened, and never runs code
  unsandboxed. This is the mode for environments where user namespaces
  are unavailable.
- Resource exhaustion is a **run failure**, not a server crash: the
  worker catches timeouts/OOM kills and records them.
- v1 explicitly does **not** do: seccomp filters, cgroup v2 limits,
  or syscall allow-lists. Those are Phase 12 hardening items, after
  load testing. The namespace + rlimit + timeout combination is the
  documented v1 boundary, and it must be stated as such in the UI
  ("code runs in an isolated sandbox") without overclaiming.

---

## 9. Monitoring event model

Extends the existing AI Monitoring card (Audit §5.1), which derives
findings only from stored data. Assessment monitoring adds a real event
stream — but keeps the same rule: **events are facts; conclusions are
derived server-side, never asserted by the client.**

### Event types (`monitoring_events.event_type`)

| Type | Source | Meaning |
| --- | --- | --- |
| `lab_opened` / `lab_closed` | client beacon | Lab session boundaries (durations derived). |
| `challenge_viewed` | server (on challenge fetch) | Which challenge was opened, when. |
| `code_run` | server (on attempt creation) | A run happened; links to the attempt. |
| `code_pasted` | client beacon | A paste into the editor (size bucket, not content — **never store pasted code in events**). |
| `focus_lost` / `focus_gained` | client beacon | Tab/app blur/focus, with duration on regain. |
| `idle` | client beacon | No keystroke for N seconds (client-side timer). |
| `attempt_submitted` | server | Attempt submitted for evaluation. |
| `evaluation_completed` | server | Evaluation stored. |
| `sandbox_error` / `sandbox_timeout` | worker | Execution failed or timed out. |
| `llm_error` | worker | Generation/evaluation call failed. |

### Rules

- Payloads are **small JSON** (timestamps, durations, size buckets,
  ids). No code, no keystrokes, no screenshots, no clipboard content.
- Client beacons are **best-effort**: `POST /api/assessments/:id/events`
  with `navigator.sendBeacon`-style fire-and-forget; a failed beacon is
  dropped, never retried in a way that blocks the student.
- The monitoring **summary** (shown to student + recruiter) is computed
  server-side from events at read time: session count/duration, runs per
  challenge, paste count, focus-loss count + total duration, idle
  periods. It reports counts and durations — it does **not** say
  "cheating detected". A human (recruiter) interprets the summary
  alongside the verdict; the verdict itself is computed from scores,
  not from monitoring counts (monitoring can trigger `needs_review`,
  never an automatic `rejected`).
- **Retention:** `MONITORING_RETENTION_DAYS` (default 90). A scheduled
  purge (a BullMQ repeatable job or a `migrate`-adjacent script — to be
  decided in Phase 8) deletes `monitoring_events` rows older than the
  window. Verdicts, evaluations, and execution summaries are **not**
  purged — only raw events.

---

## 10. Security rules (assessment-specific; repo-wide rules in Audit §4, §12.2)

1. **AuthZ on every assessment route** (`requireAuth` +
   `requireRole`; ownership via `ownCandidate`/`ownRow`). No public
   assessment endpoint — the public `candidates`/`uploads` pattern
   (Audit §4.2) is the anti-pattern here.
2. **Hidden test cases never leave the server.** The client receives
   challenge prompts + *visible* examples only. `challenge_test_cases`
   rows with `hidden=true` are never serialised to any client response.
3. **Rate limiting** (new `middleware/rateLimit.ts`, in-memory in v1 —
   a Redis-backed limiter is a Phase 12 item): attempt submissions
   (e.g. 10 runs / 10 min / candidate), assessment creation (e.g.
   1 active assessment — enforced by the 409 + a creation limit),
   event beacons (e.g. 60 / min), LLM-backed actions (generation is
   worker-side, so it is naturally bounded by queue concurrency).
   Without this, the LLM and sandbox endpoints are a cost/abuse
   vector (Audit §12.1 item 5).
4. **Input validation with zod on every route** (existing pattern):
   code ≤ 100 KB, language from a fixed enum, ids as UUIDs
   (`mustUuid` pattern from `routes/student.ts`).
5. **Sandbox boundary** (§8): no host execution, no network, no host
   writes, output caps, `disabled` mode fails closed.
6. **No secrets client-side.** `AI_API_KEY` lives only in ai-service
   env; the client never sees it, and assessment config is not in
   `client/.env.example` (Audit §12.4).
7. **PII minimisation in monitoring:** no code/keystrokes/clipboard in
   events (§9); retention enforced (§9).
8. **ai-service stays private** until it gains auth (Audit §12.2
   item 10). The new `/llm/*` routes inherit the same exposure as
   `/analyze-repo` — cloning + LLM calls from anyone who can reach it.
9. **Verdict integrity:** verdicts are computed server-side from stored
   rows; the client cannot set a verdict, a score, or a monitoring
   conclusion. `assessment_verdicts` is written only by the verdict
   worker/route, never from client input.

---

## 11. Environment variables (new — added to the three `.env.example` files)

| Variable | Where | Default | Meaning |
| --- | --- | --- | --- |
| `AI_API_BASE_URL` | root, server*, ai-service | `https://api.openai.com/v1` | OpenAI-compatible chat-completions base URL. |
| `AI_API_KEY` | root, server*, ai-service | *(empty)* | Key for the LLM provider. Never commit a real value. |
| `AI_MODEL` | root, server*, ai-service | `gpt-4o-mini` | Chat model for generation/evaluation. Stored on rows as provenance. |
| `AI_TEMPERATURE` | root, server*, ai-service | `0.2` | Sampling temperature for LLM calls. |
| `AI_MAX_TOKENS` | root, server*, ai-service | `2048` | Max output tokens per LLM call. |
| `AI_MOCK` | root, server*, ai-service | `false` | `true` = deterministic mock provider (`mock-dev-only`), for tests/dev without a key. |
| `EXECUTION_SANDBOX` | root, server | `unshare` | `unshare` = namespace sandbox (§8); `disabled` = fail closed, never run code. |
| `EXECUTION_TIMEOUT_SECONDS` | root, server | `30` | Hard wall-clock limit per execution run. |
| `MONITORING_RETENTION_DAYS` | root, server | `90` | Raw `monitoring_events` retention; older rows are purged. |

\* The server reads these only to pass through / validate config at boot;
the LLM calls themselves are made by ai-service. They are listed in
`server/.env.example` so a single root `.env` covers the compose stack
(the compose files already share one `.env` — Audit §10.1). The client
has no new variables: assessment config is server-side only.

Existing variables are unchanged (`OPENAI_API_KEY` stays for embeddings;
the new `AI_*` variables are for chat/completion calls — the two keys
may be the same value in practice but are separate settings so the
embedding provider and the chat provider can differ).

---

## 12. Phase 1–12 plan (with per-phase tests)

Phases run in order; each phase ends with its tests passing before the
next starts. Test commands: server `npm test` (`tsx --test`, Audit
§12.3), ai-service `pytest`, client has no runner yet (Phase 6 adds a
smoke check, not a framework).

| Phase | Scope | Tests (must pass before moving on) |
| --- | --- | --- |
| **1 — Audit + architecture + env** | This document set; `.env.example` updates; sandbox primitive verified. | Docs complete + internally consistent; `unshare` verification recorded (Audit §12.5). *This phase.* |
| **2 — 007 migration + LLM client skeleton** | `007_assessment.sql` (new tables + `interviews` ALTERs, §6); `ai-service/app/llm_client.py` with mock + OpenAI-compatible providers; `routers/llm.py` stubs returning mock data; server `services/llm.ts`. | `npm run migrate` twice against a scratch DB (idempotency); pytest: mock provider returns deterministic JSON, missing-key + `AI_MOCK=false` raises, invalid JSON → 502; node:test: `llm.ts` posts the right shape (mocked fetch). |
| **3 — Profile strength engine** | `services/profileStrength.ts` (§5); eligibility endpoint; strength snapshot on assessment creation. | node:test: strength is `null` with no assessment; correct after a seeded verdict; snapshot is frozen at creation even if the profile later changes; eligibility returns the right `missing[]` for each fixture. |
| **4 — Project selection + repo analysis** | Assessment creation pins `project_id`; worker path reuses `/analyze-repo` + new `/llm/summarise-repo`; `repo_evidence` labelling (`repo_analysed` vs `described_only`). | node:test: creating a second active assessment → 409; assessment keeps the original `project_id` after the project is replaced; pytest: summarise returns a brief from a canned analyse result; described-only assessments are labelled, never repo-claimed. |
| **5 — Challenge generation** | `assessment-challenge-gen` queue + worker; `POST /llm/generate-challenge`; pydantic validation; challenges + hidden tests stored. | pytest: valid JSON stored, invalid JSON → 502 and no rows written, mock output deterministic; node:test: generation job transitions `created → generating → ready`; hidden test cases are absent from `GET /api/assessments/:id` responses. |
| **6 — Live Lab (client + attempt API)** | `POST /attempts` + attempt detail routes; `/student/assessment/[id]/lab` page (textarea editor, language selector, run button, polling); rate limit middleware. | node:test: non-owner → 403, oversized code → 400, unknown language → 400, rate limit trips after N runs; manual check: a run round-trips end-to-end with the mock LLM + `disabled` sandbox failing closed. |
| **7 — Sandboxed execution** | `services/sandbox.ts` (§8); `assessment-execution` queue + worker; `execution_runs` storage; per-case results. | node:test with real `unshare` (skipped when unavailable): correct output + exit code captured; timeout kills a `sleep 60` run and records `timed_out`; no-network case fails inside the namespace; output truncated at 64 KB; `EXECUTION_SANDBOX=disabled` marks attempts failed without running code. |
| **8 — Monitoring** | `monitoring_events` writes (server + beacons); summary computation; retention purge job; monitoring section on dashboard + profile (extends existing cards). | node:test: events append with correct types; summary counts match seeded events; purge deletes only rows older than `MONITORING_RETENTION_DAYS`; beacon payloads never contain code (assert on the client payload builder). |
| **9 — Evaluation** | `assessment-evaluation` queue + worker; `POST /llm/evaluate`; rubric storage; test pass rate computed locally. | pytest: rubric JSON validated, invalid → 502, no row written; node:test: `test_pass_rate` equals the locally computed rate even when the LLM claims otherwise; evaluation of a failed execution is recorded, not scored. |
| **10 — Interview** | `POST /:id/interview` (writes existing `interviews` table); `POST /llm/interview-questions`; transcript/score write-back. | node:test: interview row links `assessment_id`, status transitions `scheduled → completed`; pytest: questions generated from a canned evaluation; no duplicate interview for one assessment (409). |
| **11 — Verified profile + verdict** | Verdict computation; `assessment_verdicts` + mirror `verification_results` row; `candidate_skills source='interview'` upserts; recruiter evidence view shows the verdict; `GET /verdict` + scoped recruiter access. | node:test: verdict thresholds (verified / needs_review / rejected) on seeded scores; monitoring-heavy but high-scoring attempt → `needs_review`, never auto-`rejected`; recruiter without an application → 403 on verdict; skills upserted only on `verified`. |
| **12 — Hardening + CI + deploy** | Rate-limit tuning, Redis-backed limiter, seccomp/cgroup evaluation for the sandbox, `npm test` added to CI + `Makefile test`, load test (concurrent runs), Render server service definition (or documented manual deploy), docs refresh. | Full suite green in CI (server + ai-service); load test: N concurrent executions complete without host impact; sandbox abuse cases (fork bomb, huge output, network attempt) contained; deploy checklist executed against a staging service. |

### Cross-phase rules

- **No phase changes the weights in `computeCompleteness`** or the
  onboarding stages. Those are product decisions, not assessment
  internals.
- **No phase creates a table that already exists** (§6 list). If a new
  need maps onto `interviews`, `candidate_projects`, or
  `verification_results`, it extends that table.
- **Every phase adds its tests in the same PR as its code.** The repo's
  current gap — CI not running the server suite (Audit §12.3) — is
  closed in Phase 12 at the latest, and each phase's tests must at
  least run locally via `npm test` / `pytest` before merge.
- **Live-server deployment is a Phase 12 concern**, not a Phase 2 one.
  Until then, assessment work is verified locally (compose where
  Docker exists; manual Postgres/Redis elsewhere) and against the
  mock LLM provider.
