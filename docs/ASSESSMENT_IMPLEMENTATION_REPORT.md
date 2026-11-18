# GroundTruth AI — Assessment System: Implementation Report

**Repo:** `gauravdev95/groundtruth-ai` — **Base:** `6462b04` — **Date:** 2026-11-18
**Scope:** Master Implementation Prompt + Additional Module (AI Live Assessment
Monitoring), Phases 1–12. The old repo `GroundTruth-AI-Recruiter-Intelligence`
was never touched. `client/src/app/page.tsx` (landing page) was never touched.

## Commits

| Commit | Content |
|---|---|
| `371491cb177465b8543fc1ae1a3b1ba15ecd81d3` | Backend phase: audit + architecture, migration 007, all server services, routes, WS terminal, demo project, E2E script (62/62 at push time) |
| _(second commit, see git log)_ | Monitoring test suite (17 tests), E2E tab-event correction, this report |

## How to run it (local)

```bash
# Postgres 16 + pgvector + Redis (see ~/workspace/ground-truth-setup/README.md)
# Apply migrations 001–007 against your database, then:
cd server
DATABASE_URL=postgresql://... npm run migrate   # applies infra/postgres/*.sql
npm install && npm run build
DATABASE_URL=... REDIS_URL=redis://localhost:6379 JWT_SECRET=<secret> \
  AI_MOCK=true PORT=4000 npm start
# E2E journey (needs the server on $BASE_URL):
BASE_URL=http://localhost:4100 node scripts/e2e-assessment.mjs
# Unit + DB tests:
DATABASE_URL=postgresql://.../gt_assessment_test npm test
```

## Feature | Status | Tests | Evidence

Statuses: COMPLETED / PARTIALLY COMPLETED / BLOCKED / NOT STARTED.

| Feature | Status | Tests | Evidence |
|---|---|---|---|
| Phase 1 — audit (`docs/ASSESSMENT_AUDIT.md`) | COMPLETED | — (document) | 50 KB audit of the repo at 6462b04: structure, packages, DB, auth, dashboards, profile/project workflows, GitHub, AI/LLM, deployment, verification gaps |
| Phase 1 — architecture (`docs/ASSESSMENT_ARCHITECTURE.md`) | COMPLETED | — (document) | Target architecture + an **as-built note** reconciling 5 divergences (LLM lives in the Express server, not ai-service; no hardcoded `AI_MODEL`; `assessment_events` tables; synchronous execution; plural route file) |
| Profile completion system | COMPLETED | E2E steps: profile 70%, one-project 409, onboarding complete; `npm test` student suite 7/7 | Reuses existing student profile/completeness (6462b04). Completeness ≠ verified ability — strength and verification are separate scores |
| AI Profile Strength Engine | COMPLETED | `tests/strength.test.ts` (7 tests); E2E overall=34, 6 recommendations each with WHY | `server/src/services/strength.ts` — deterministic scoring + skill→project mapping; LLM refine only when configured; never fabricates (E2E asserts no invented skill) |
| Project selection + repo analysis | COMPLETED | `tests/repoAnalysis.test.ts` (9 tests); E2E detects Python + rate limiter | `repoAnalysis.ts` — metadata-only analysis, never executes code; `sanitizeForLlm` strips injected instructions from README/comments (tested) |
| AI Challenge Generation | COMPLETED | `tests/challenge.test.ts` (8 tests); E2E generates "Fix the rate-limiting bug…" | `challenge.ts` — task follows real repo gaps (no tests → add tests; rate limiter → fix bug); every criterion validated as observable behaviour; hidden tests never leave the server |
| Live Engineering Lab | PARTIALLY COMPLETED | E2E 62/62 (files, Run, Test, submit, autosave); WS ready/pong/output + reconnect | Backend + APIs complete. **Frontend pages are being built by a follow-up agent** (Monaco Lab, hub, challenge, evaluation, interview, verified profile) — not yet in the repo at this commit |
| Code execution sandbox | COMPLETED | Sandbox probe (8 checks) + E2E escape tests (4/4) + `npm test` | `execution.ts` — `unshare` user+net+mount+pid namespaces, verified masking model (see §Security). Docker is NOT installed in this VM; the sandbox does not need it. `EXECUTION_SANDBOX=disabled` fails closed |
| Live Assessment Monitoring | COMPLETED | `tests/monitoring.test.ts` (17 tests); E2E event/duplicate/tab/consent/report steps | `monitoring.ts` — `assessment_events` + typed side tables, dedupe by `client_event_id`, secret scrubbing, idle detection, integrity analysis (review indicators only, never auto-reject), 90-day retention purge |
| Automated testing + submission | COMPLETED | E2E: snapshot v0/v1 hashes, visible 15/15, hidden 3/3 | `assessments.ts` submit — frozen versioned snapshot + SHA-256, visible then hidden tests in-sandbox, hidden test files injected at submit and removed again |
| AI Engineering Evaluation | COMPLETED | E2E overallScore=76.7, functional=100 (real tests) | `evaluation.ts` — weights 30/20/20/15/15; functional ONLY from executed tests; deterministic heuristic (max 60, human-review flag) when no LLM; LLM qualitative review when configured |
| AI Technical Interview | COMPLETED | E2E: 7 questions, answer scored 31.75, report with transcript | `interview.ts` — categories A–H, adaptive follow-up when score < 60, per-answer evaluation, interview score SEPARATE from coding score, text-based only |
| Final Verified Engineering Profile | COMPLETED | E2E: status "Needs Improvement", 1 verified skill (Python) | `verified.ts` — Verified only when evaluation ≥ 70 AND interview ≥ 60 (or no interview) AND no blocking integrity finding; untested skills never labelled verified |
| AI model integration | COMPLETED | `tests/llm.test.ts` (10 tests) | `llm.ts` — OpenAI-compatible client, env config (`AI_API_BASE_URL`/`AI_API_KEY`/`AI_MODEL`/`AI_TEMPERATURE`/`AI_MAX_TOKENS`), mock provider, token logging (no content), cost estimation, 30 s timeout, retry with backoff, rate limiting, `chatJson` schema validation. **No model name is hardcoded; no key is in the frontend or logs** |
| DB + APIs | COMPLETED | Migration applied 001–007 on Postgres 16 + pgvector (42 tables); `npm test` 81/81 | `infra/postgres/007_assessment.sql` (idempotent, additive only); `server/src/routes/assessments.ts` (33 routes) + WS `/ws/execution/:sessionId/terminal`; auth + ownership + zod validation + rate limits on all routes |
| Demo project | COMPLETED | 15 tests, 14 pass, 1 intentional failure (`test_window_expires`) | `groundtruth-assessment-demo/` — Python stdlib auth API, one intentional bug (window never expires), one missing feature (no per-user limit), README documents both |
| 7 prompt test scenarios | COMPLETED | E2E script covers all 7 (profile, repo, live coding, evaluation, interview, security, end-to-end) | `server/scripts/e2e-assessment.mjs` — 62 steps, 62 pass against the local server |
| 15 monitoring tests | COMPLETED | 17 in-file tests + WS reconnect + recruiter-auth in E2E | See `server/tests/monitoring.test.ts` header for the 1-to-1 map |

## Test results (this VM, 2026-11-18)

| Suite | Result |
|---|---|
| `server` typecheck (`npx tsc --noEmit`) | PASS (0 errors) |
| `server` build (`npm run build`) | PASS |
| `npm test` (unit + DB, `gt_assessment_test`) | **81/81 PASS, 0 fail** (was 64/64 before the monitoring suite) |
| Demo project (`python3 -m unittest discover -s tests`) | 15 tests, 14 pass, **1 intentional failure** (`test_window_expires` — the planted bug) |
| E2E journey (`scripts/e2e-assessment.mjs` vs local server :4100, `AI_MOCK=true`) | **62/62 PASS** — register → profile → strength → demo project → repo analysis → challenge → consent → Lab (unshare) → fix → tests 15/15 → submit (hidden 3/3) → evaluation 76.7 → interview (7 Qs, final 31.75) → verified "Needs Improvement" → recruiter job → apply → monitoring report → 403 checks |
| Sandbox probe (`detectSandbox`, plain `node`) | PASS — 8 checks: /proc hidden (server pid absent), /root /home /etc empty, parent dir shows only the probe workspace, outbound TCP connect fails |

## Security model (execution) — read before deploying

- **No Docker.** Docker is not installed in this VM, and the sandbox does not
  need it. Backend is Linux namespaces via `unshare`.
- **Why not nobody?** The server runs as host root here. A single-UID user
  namespace cannot `setpriv` to an unmapped UID (verified: `setresuid
  failed`), and `/etc/subuid` has no range for `newuidmap` (verified:
  `newuidmap: uid range … not allowed`). So the runner is inner-root, and
  isolation comes from **masking**, not the UID: the inner script bind-mounts
  the workspace aside, covers `/tmp` with tmpfs, re-exposes ONLY this
  workspace, and masks `/proc /root /home /etc /run /var /srv /mnt /opt`
  with tmpfs — verified by the probe (a candidate cannot read
  `/proc/<server-pid>/environ`, SSH keys, sibling workspaces, or server
  files). `/usr` stays readable (interpreters live there).
- **DAC subtlety (verified the hard way):** inner-root's capabilities do not
  extend to the initial user namespace, so a workspace `chown`ed to 65534
  with mode 750 is UNREADABLE to it (EACCES). Workspaces therefore stay
  root-owned (750/640) — see `prepareWorkspace`.
- **Fail closed:** if the probe fails, or `EXECUTION_SANDBOX=disabled`, or
  `unshare` is unavailable, execution returns DISABLED and candidate code is
  never run on the host. No unsafe fallback exists.
- **Limits:** prlimit CPU 30 s / 512 MB / 256 procs / 64 MB files,
  wall-clock 30 s (env `EXECUTION_TIMEOUT_SECONDS`, max 120 s); argv
  allowlist (`python3 python node pytest pip npm npx ls cat pwd sh bash`);
  env scrubbed; output capped at 64 KB; `--mount-proc` is NOT used (it
  fails in this VM — `Operation not permitted`).
- **Known quirk:** the probe fails under `tsx` (dev loader) with
  `timeout: fork system call failed` — fork pressure from the loader's
  threads against the `--nproc` limit. It passes under plain `node`
  (production path). `npm test` does not call the sandbox, so the suite is
  unaffected. If the probe ever reports `disabled` on a deploy, treat
  execution as BLOCKED and check `dmesg`/fork limits, not the code.

## What is NOT done / blocked (honest)

| Item | Status | Reason / next step |
|---|---|---|
| **Live verification in the browser (login + assessment on Render)** | BLOCKED | There is still NO Render server service and `NEXT_PUBLIC_API_URL` is unset on the live client. The server-creation decision (create `groundtruth-ai-server` via API vs Gaurav in the dashboard) is still pending with the user since 17 Nov 23:58 IST. All verification above is local (Postgres + Redis on this VM). Do not claim live verification until the server exists, migrations run, and the E2E is re-run against it |
| **Frontend pages (hub, Lab, evaluation, interview, verified)** | PARTIALLY COMPLETED | Backend + APIs complete; a follow-up agent is building the client pages in the Stratify LIGHT design now (fresh clone at 371491c). Nothing is pushed for the frontend yet |
| **Live AI (non-mock) calls** | NOT STARTED | No live key is set anywhere (by design). To use a real model, set `AI_API_BASE_URL`, `AI_API_KEY`, `AI_MODEL` on the server (never commit a key). With `AI_MOCK=true` or no key, the deterministic mock + capped heuristic run instead, and every report says so (`aiAvailable: false`, `qualitativeMethod: "deterministic-heuristic"`) |
| **GitHub-based assessments** | NOT STARTED | `POST /api/assessments` with `source: "github_url"` / `"github_account"` returns 409 — GitHub connect was explicitly excluded ("do not implement git connect"). The UI must not offer it |
| **Phase 7 (messaging/notifications/legal) + Phase 8 (responsive + final audit)** | NOT STARTED | Superseded by the assessment master prompt; the assessment frontend is the current work. Phase 8's responsive/final-audit pass should run after the frontend lands |
| **Free Postgres expiry 15 Dec 2026** | BLOCKED (tracked) | `groundtruth-postgres` on Render expires 15 Dec 2026 — migrate to a persistent Postgres with verified backup + restore before then (tracked item, goal `ground-truth-ai-recruiter-website`) |
| **Demo accounts seeding** | BLOCKED | `demo.student@groundtruth.dev` / `demo.recruiter@groundtruth.dev` (Test@1234) cannot be seeded until the live server exists (same blocker as live verification) |

## Environment variables (new)

`AI_API_BASE_URL`, `AI_API_KEY`, `AI_MODEL`, `AI_TEMPERATURE` (0.2),
`AI_MAX_TOKENS` (2000), `AI_MOCK` (false), `AI_RATE_LIMIT_PER_MIN` (30),
`AI_TIMEOUT_MS` (30000), `EXECUTION_SANDBOX` (`unshare`|`disabled`),
`EXECUTION_TIMEOUT_SECONDS` (30), `MONITORING_RETENTION_DAYS` (90).
See root / `server/` / `ai-service/` `.env.example`. The LLM client lives in
the Express server (`server/src/services/llm.ts`); ai-service does not call
the LLM (its `.env.example` lists the vars only for deploy consistency).

## Files added / changed (this work)

- `docs/ASSESSMENT_AUDIT.md`, `docs/ASSESSMENT_ARCHITECTURE.md`,
  `docs/ASSESSMENT_IMPLEMENTATION_REPORT.md` (this file)
- `infra/postgres/007_assessment.sql` — 22 new tables + ALTERs to `interviews`
- `server/src/services/` — `llm`, `strength`, `repoAnalysis`, `challenge`,
  `assessments`, `execution`, `monitoring`, `evaluation`, `interview`,
  `verified`, `hiddenTests` (new); `server/src/routes/assessments.ts` (new);
  `server/src/middleware/rateLimit.ts` (new); `server/src/index.ts` (WS
  terminal + assessments router); `server/src/config/env.ts` (AI_* + execution vars)
- `server/tests/` — `llm`, `strength`, `repoAnalysis`, `challenge`,
  `monitoring` (new test files)
- `server/scripts/e2e-assessment.mjs` — full-journey E2E (62 steps)
- `groundtruth-assessment-demo/` — demo project (13 files)
- `.env.example` (root / server / ai-service), `server/package.json` (+`ws`),
  `package-lock.json`
