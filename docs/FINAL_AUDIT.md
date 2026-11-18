# GroundTruth AI — Final Audit (Phase 8)

**Date:** 18 November 2026
**Repo:** `gauravdev95/groundtruth-ai`, base commit `fb13722` (Phase 7)
**Scope:** responsive check of every page + full final audit of the whole product.
**Verification:** LOCAL ONLY — Express server on `http://127.0.0.1:4000`,
Next.js client on `http://127.0.0.1:3000`, Postgres 16 + pgvector database
`gt_all_steps`, Redis on `127.0.0.1:6379`. Nothing in this audit was verified
against a live (Render) deployment — no Render work was done in Phase 8 and
none exists for this phase.

**Method for the responsive check:** real Chromium rendering
(Playwright, headless Chromium 1255) at 1280×800 (desktop) and 390×844
(mobile), signed in as the demo accounts and as the E2E-created accounts
where the demo accounts have no data. Each page was measured for horizontal
overflow (`documentElement.scrollWidth` vs viewport width), elements
extending past the viewport, elements wider than their card, and whether the
top nav stays usable on mobile. Screenshots were inspected visually for the
worst pages. 46 pages × 2 viewports = 92 checks (the sweep covered 45
pages; `/recruiter/messages` was checked separately right after, same
method, both widths pass).

**Method for the audit:** the full local verification suite, end to end —
server `tsc` + build + `npm test`, ai-service pytest, client `tsc` + build,
migrations 001–008 on a fresh scratch database, the assessment E2E script
(`server/scripts/e2e-assessment.mjs`, `BASE_URL=http://127.0.0.1:4000`,
`AI_MOCK=true`), the demo-account flow, the Phase 7 flows (message thread,
notifications, contact submit, cross-user 403), and the monitoring report.

**Environment note (audit honesty):** when Phase 8 started, `node_modules`
had been pruned in this workspace — `client/node_modules` held only
`postcss`, `server/node_modules` did not exist, and the repo-root
`node_modules` (npm workspaces monorepo: workspaces `client` + `server`)
held only server dependencies. That made the first `tsc`/`next build`
attempts fail with "Cannot find module" errors, and the first typecheck
readings were invalid because the exit code was read off a pipe (`| tail`),
not the tool. No source code was at fault: after `npm ci` at the repo root
(561 packages restored, both workspaces) every typecheck and build below
passes with real exit codes. `npm ci` inside a single workspace prunes the
other workspace's packages — always install from the repo root.

---

## 1. Responsive results — per page

Result = no horizontal page overflow at that width AND no clipped text,
buttons, or unreachable nav. "Nav" means the shared `.st-nav` bar used by
the student, recruiter, assessment, and jobs shells.

| Page (route) | Desktop 1280px (HTTP / scrollW) | Mobile 390px (HTTP / scrollW) | Result |
|---|---|---|---|
| Landing `/` | 200 / 1280 | 200 / **418** | **FAIL — mobile only, read-only (see §2)** |
| Auth — login `/auth/login` | 200 / 1280 | 200 / 390 | PASS |
| Auth — signup `/auth/signup` | 200 / 1280 | 200 / 390 | PASS |
| Auth — forgot password `/auth/forgot-password` | 200 / 1280 | 200 / 390 | PASS |
| Auth — reset password `/auth/reset-password` | 200 / 1280 | 200 / 390 | PASS |
| Student dashboard `/student/dashboard` | 200 / 1280 | 200 / 390 | PASS (nav fixed, §2) |
| Student profile `/student/profile` | 200 / 1280 | 200 / 390 | PASS (nav fixed, §2) |
| Onboarding root `/student/onboarding` | 200 / 1280 | 200 / 390 | PASS (nav fixed, §2) |
| Onboarding — basic info `/student/onboarding/basic-info` | 200 / 1280 | 200 / 390 | PASS |
| Onboarding — project `/student/onboarding/projects` | 200 / 1280 | 200 / 390 | PASS |
| Onboarding — coding profile `/student/onboarding/coding-profile` | 200 / 1280 | 200 / 390 | PASS |
| Onboarding — certificates `/student/onboarding/certificates` | 200 / 1280 | 200 / 390 | PASS |
| Onboarding — experience `/student/onboarding/experience` | 200 / 1280 | 200 / 390 | PASS |
| Onboarding — review `/student/onboarding/review` | 200 / 1280 | 200 / 390 | PASS |
| Onboarding — complete `/student/onboarding/complete` | 200 / 1280 | 200 / 390 | PASS |
| Jobs list `/jobs` | 200 / 1280 | 200 / 390 | PASS |
| Job detail `/jobs/:id` | 200 / 1280 | 200 / 390 | PASS |
| Assessment hub `/assessment` | 200 / 1280 | 200 / 390 | PASS (nav fixed, §2) |
| Assessment new `/assessment/new` | 200 / 1280 | 200 / 390 | PASS |
| Assessment strength `/assessment/profile` | 200 / 1280 | 200 / 390 | PASS |
| Assessment verified profile `/assessment/verified` | 200 / 1280 | 200 / 390 | PASS |
| Assessment challenge `/assessment/:id/challenge` | 200 / 1280 | 200 / 390 | PASS |
| Assessment Lab `/assessment/:id/lab` | 200 / 1280 | 200 / 390 | PASS (see note below) |
| Assessment evaluation `/assessment/:id/evaluation` | 200 / 1280 | 200 / 390 | PASS |
| Assessment interview `/assessment/:id/interview` | 200 / 1280 | 200 / 390 | PASS |
| Assessment report `/assessment/:id/report` | 200 / 1280 | 200 / 390 | PASS |
| Student messages `/student/messages` | 200 / 1280 | 200 / 390 | PASS |
| Student thread `/student/messages/:applicationId` | 200 / 1280 | 200 / 390 | PASS |
| Account `/account` | 200 / 1280 | 200 / 390 | PASS |
| Notifications `/account/notifications` | 200 / 1280 | 200 / 390 | PASS |
| Recruiter dashboard `/recruiter/dashboard` | 200 / 1280 | 200 / 390 | PASS (nav + table fixed, §2) |
| Recruiter profile `/recruiter/profile` | 200 / 1280 | 200 / 390 | PASS (nav fixed, §2) |
| Recruiter post a job `/recruiter/jobs/new` | 200 / 1280 | 200 / 390 | PASS (nav fixed, §2) |
| Recruiter pipeline `/recruiter/pipeline` | 200 / 1280 | 200 / 390 | PASS (nav fixed, §2) |
| Recruiter analytics `/recruiter/analytics` | 200 / 1280 | 200 / 390 | PASS (nav + table fixed, §2) |
| Recruiter applications `/recruiter/applications` | 200 / 1280 | 200 / 390 | PASS (nav + table fixed, §2) |
| Recruiter application detail `/recruiter/applications/:id` | 200 / 1280 | 200 / 390 | PASS |
| Recruiter evidence `/recruiter/applications/:id/evidence` | 200 / 1280 | 200 / 390 | PASS |
| Recruiter thread `/recruiter/messages/:applicationId` | 200 / 1280 | 200 / 390 | PASS |
| Recruiter messages `/recruiter/messages` | 200 / 1280 | 200 / 390 | PASS |
| Legal — terms `/terms` | 200 / 1280 | 200 / 390 | PASS |
| Legal — privacy `/privacy` | 200 / 1280 | 200 / 390 | PASS |
| Legal — DPDP `/dpdp` | 200 / 1280 | 200 / 390 | PASS |
| Legal — bias audit `/bias-audit` | 200 / 1280 | 200 / 390 | PASS |
| Contact `/contact` | 200 / 1280 | 200 / 390 | PASS |

**Totals (post-fix sweep): 92 checks, 91 pass, 1 fail (landing mobile).**
90 of 92 checks returned HTTP 200. The 2 non-200 checks are both
`/assessment/:id` (bare detail route), which returned 404 at both widths —
that is not a product bug: no bare `/assessment/:id` route exists by design.
The assessment hub links each assessment to `/assessment/:id/challenge` and
`/assessment/:id/lab`; there is no detail page to link to.

**Lab note (active state):** the Lab was checked in both states. Submitted
Lab (E2E assessment, read-only) renders cleanly at both widths. An active
Lab was started via the API (challenge generated, consent given, `start`
returned status `active`, sandbox `unshare`, 60:00 timer counting) and
checked at 390px: file tree stacks above the editor (the ≤860px breakpoint),
editor wrap is 362px wide, timer is centred, Run / Submit / Terminal
controls render, no horizontal overflow. The Monaco editor canvas itself
could **not** be rendered in this VM: `@monaco-editor/react` loads Monaco
from the jsDelivr CDN (`cdn.jsdelivr.net/npm/monaco-editor@0.55.1/…`) and
the VM egress proxy blocks that host (`ERR_TUNNEL_CONNECTION_FAILED`), so
the editor stays on its "Loading code editor…" state here. That is a
VM-network limitation, not a layout defect — on a normal network the CDN
loads. The editor is configured with minimap off, `wordWrap: "on"`,
`automaticLayout: true`, 480px height, so it is expected to fit the 362px
wrap. Follow-up worth doing outside this audit: bundle Monaco locally
instead of the CDN so the Lab works offline.

**Pre-existing responsive behaviour (no change needed):** grids collapse
4→2→1 columns (900px / 640px breakpoints), forms go single-column, the
onboarding stepper and the pipeline kanban scroll horizontally by design,
the 3rd table column is hidden at ≤640px, and all pages keep the Stratify
LIGHT design (pale lavender-grey `#F0EFF7`, royal blue `#1E2BDA`, white
cards, near-black headlines — no dark theme anywhere).

---

## 2. Responsive defects found — fixed in Phase 8 vs reported only

### Fixed 1 — top nav clipped on mobile (all shell pages)
**Before:** at 390px the shared `.st-nav` bar overflowed and was clipped by
the page's `overflow-x: hidden`. Student nav measured 656–657px wide,
recruiter nav 815–818px wide, against a 390px viewport — "Messages", "Jobs",
the user chip and the "Log out" button were unreachable, and "Post a job"
wrapped mid-phrase ("Post / a / job") on the recruiter pipeline page.
**Fix (CSS only, `client/src/app/auth/auth.css` — the one file every shell
imports):** `.st-nav-side` is now a horizontally scrollable row
(`overflow-x: auto`, hidden scrollbar, `flex-shrink: 0` + `white-space:
nowrap` on its children, logo pinned with `flex-shrink: 0`). On wide
screens nothing changes — the content fits and no scrollbar appears.
**Verified:** re-sweep at 390px on every shell page — nav row scrollable,
and after scrolling it to the end the "Log out" button is fully inside the
viewport (`logoutVisibleAfterScroll: true` on all 31 shell-page checks:
student, recruiter, assessment, account). Screenshots confirm "Post a job" stays on
one line.

### Fixed 2 — tables bled past their cards on mobile (recruiter pages)
**Before:** at 390px the applications/dashboard tables (5 columns) stuck
out 11px past their card edge, and the analytics funnel table (8 columns:
Role / Status / Total / Applied / Reviewing / Interview / Offer / Rejected)
stuck out 220px (right edge 596px vs card edge 376px) — the late columns
were cut off by the page edge and unreachable, even though the existing
≤640px rule already hides the 3rd column.
**Fix (CSS only, `client/src/app/student/student.css`, ≤640px breakpoint):**
`.st-panel { overflow-x: auto; }` — a card whose table is wider than the
card now scrolls horizontally inside the card instead of letting the table
poke past the card border. No-op on desktop.
**Verified:** panel `overflow-x` is `auto`, document width stays 390px,
and after scrolling the panel the last column is fully visible inside the
viewport ("Rejected" on analytics, "Applied" on applications).

### Reported only — landing page horizontal overflow at 390px (NOT fixed)
**Finding:** the landing page measures 418px wide at a 390px viewport
(scrollW 418, 28px of horizontal overflow). Cause, measured in the DOM:
the footer blue block (`.foot-blue`) renders 381px wide starting 37px in,
so its right edge is 418px; the decorative `.waves` SVG is 417px wide
(`scale(1.07)` drift animation) and the top nav actions reach 394px.
Visually the blue footer block and the "Get a Demo" button are cut off at
the right edge. **Not fixed because `client/src/app/page.tsx` is read-only
for Phase 8.** The fix belongs in that file: make `.foot-cols` single-column
(or the footer padding smaller) below ~480px and constrain the waves SVG /
nav actions to the viewport. Everything above the footer (hero, dashboard
preview, cards, pricing, testimonials) fits at 390px.

---

## 3. Full audit — step by step

All steps run locally on 18 Nov 2026 against the rebuilt code (server
rebuilt with `npm run build`, restarted, `/health` ok; client rebuilt with
`NEXT_PUBLIC_API_URL=http://localhost:4000`, restarted, home + legal pages
200).

| # | Check | Result |
|---|---|---|
| 1 | Server typecheck (`npm run typecheck`, exit code read directly) | **PASS** — exit 0, no errors |
| 2 | Server build (`npm run build` → `tsc`) | **PASS** — exit 0, `dist/index.js` regenerated |
| 3 | Server tests (`npm test`) | **PASS** — **84/84**, 0 fail, 0 skipped |
| 4 | ai-service pytest (scratch venv, full `requirements.txt`) | **PASS** — **9/9** |
| 5 | Client typecheck (`npx tsc --noEmit`) | **PASS** — exit 0, no errors |
| 6 | Client build (`NEXT_PUBLIC_API_URL=http://localhost:4000 npm run build`) | **PASS** — all 40+ routes built, no font/design workaround needed |
| 7 | Migrations 001–008 on a fresh database (`gt_audit_tmp`, created → applied → dropped) | **PASS** — all 8 applied cleanly, **46 tables** |
| 8 | Assessment E2E (`server/scripts/e2e-assessment.mjs`, `BASE_URL=http://127.0.0.1:4000`, `AI_MOCK=true`) | **PASS** — **62/62**, run twice (before and after the server rebuild/restart); 0 failed both times |
| 9 | Demo-account flow | **PASS** — both demo accounts log in; student profile completeness 70% (mandatory sections basic + project done; coding / certificates / experience optional and missing, as designed); recruiter dashboard loads, company "Demo Corp", 0 jobs (demo recruiter has posted none — the 3 open jobs on the board belong to other companies) |
| 10 | Phase 7 — message thread | **PASS** — student send 201, recruiter reads thread 200 (message visible), recruiter reply 201 |
| 11 | Phase 7 — notifications | **PASS** — student unread count 4 after the recruiter reply; list shows a `message` notification ("New message — Backend Engineer (Fresher)") with the correct thread link |
| 12 | Phase 7 — cross-user 403 | **PASS** — a non-party student reading the thread gets 403 ("You are not a party to this conversation"); sending in it also gets 403 |
| 13 | Phase 7 — contact submit | **PASS** — `POST /api/contact` returns 201, row stored in `contact_messages` |
| 14 | Monitoring report | **PASS** — recruiter (owns the application) `GET /api/assessments/:id/monitoring/report` 200 with findings; the candidate gets 403 on the recruiter report; another student gets 403; the candidate's own `GET /api/assessments/:id/monitoring` returns 200 (`monitoring_active`, neutral summary, no ability judgement) |
| 15 | E2E detail (from the 62/62 run) | overallScore 76.7; functional score 100 from real tests; interview 7 questions, answer scored 31.75; verified profile "Needs Improvement", 1 verified skill from passed tests only; sandbox `unshare`, no network, `/etc/passwd` + `/root/.ssh` hidden, only the assessment's own workspace visible; duplicate monitoring events deduped; disallowed command (`curl`) rejected 400 |
| 16 | Server restart from the fresh build | **PASS** — killed `dist/index.js`, restarted with `npm start`, `/health` ok (postgres ok, redis ok), E2E re-run 62/62 on the restarted server |

**No regressions found.** The only build/typecheck failures seen during the
audit were the pruned-`node_modules` environment issue described above —
after restoring dependencies from the repo root, everything passes; no
source fix was needed for them.

**Test data cleanup:** the two E2E user pairs created by this audit's runs
(`e2e-*-mwm65up8@example.dev`, `e2e-*-mwm6ucut@example.dev`) were deleted
from `gt_all_steps` with their candidates, companies, assessments (3),
interviews, messages, notifications and the audit contact message; their
two sandbox workspace dirs were removed. The pre-existing E2E pair
(`mwm5btsv`, created 18:47 IST before this audit) and its data were left
untouched. Both demo accounts are untouched.

---

## 4. Known limitations

These are known and out of scope for Phase 8; each was re-confirmed during
this audit where a check is listed.

- **Live AI is mock-only locally.** The server runs with `AI_MOCK=true` and
  the deterministic mock LLM provider. Real Gemini/OpenAI-backed analysis,
  challenge generation and interview scoring have not been verified here.
- **No live (Render) server.** There is no live server for this repo in
  this audit — the Render deployment has the client only and no API URL
  configured (from the project record). Everything above is local.
- **GitHub-based assessment returns 409.** Creating an assessment with
  `source: github_url | github_account` throws 409 ("GitHub-based assessment
  requires a connected GitHub account, which is not set up yet") —
  `server/src/services/assessments.ts`. There is no GitHub OAuth connection
  in the repo yet. `profile_project` and `manual` (demo project) work and
  are what the E2E covers.
- **`job_match` notifications are unwired.** The `job_match` notification
  type is defined (`server/src/services/notifications.ts`) but no code path
  ever emits it — only `application_status`, `assessment`, `interview` and
  `message` notifications are sent. A new match therefore produces no
  notification.
- **Landing demo form is not wired to `/api/contact`.** The landing page's
  "Get a Demo" form (`onDemo` in `client/src/app/page.tsx`) only shows a
  thank-you message and resets; it sends no request, so demo requests never
  reach the stored `contact_messages` that `/api/contact` writes. The
  standalone `/contact` page *is* wired (201, stored).
- **DPDP grievance officer email is not published.** The DPDP page does not
  name a grievance officer email address.
- **No standalone `/api/match` endpoint.** `GET /api/match` returns 404 —
  no such route is mounted. Matching is computed server-side for dashboards
  and application rows, not exposed as its own endpoint.
- **Landing page mobile overflow (see §2).** 418px at 390px viewport;
  `page.tsx` is read-only for this phase, so it is reported, not fixed.
- **Monaco editor loads from a CDN.** `@monaco-editor/react` fetches Monaco
  from jsDelivr at runtime; in this VM the egress proxy blocks that host, so
  the Lab editor canvas could not be rendered locally (layout around it was
  verified). Bundling Monaco locally would remove the dependency.
- **Free Postgres expiry (from the project record).** The free Postgres
  backing the live database expires 15 Dec 2026 — migrate to a persistent
  Postgres with a verified backup + restore before then. Not a local issue:
  the local `gt_all_steps` database is unaffected.
- **No account-deletion endpoint; 5 test accounts in the production DB**
  (from the project record). Not verified in this audit.

---

## 5. Feature | Status | Tests | Evidence

Statuses: COMPLETED / PARTIALLY COMPLETED / BLOCKED / NOT STARTED only.

| Feature | Status | Tests | Evidence |
|---|---|---|---|
| Auth (register / login / JWT / password reset) | COMPLETED | Server tests 84/84; demo + E2E logins | `server/src/routes/auth.ts`; E2E registers + logs in both roles; demo accounts log in |
| Student profile + onboarding (7 stages incl. Profile Complete, one project enforced, completeness scoring) | COMPLETED | Server tests (completeness: empty 0, mandatory-only 70, full 100); E2E profile 70% step; responsive all 8 stages PASS | `server/src/routes/student.ts`, `client/src/app/student/`; demo student 70% (basic + project done) |
| Jobs board (list / detail, apply) | COMPLETED | E2E "student applies" 201; responsive PASS | `server/src/routes/jobs.ts`, `applications.ts`; 3 open jobs on the board locally |
| Recruiter — post job, dashboard, profile, company | COMPLETED | E2E "recruiter posts job" 201; demo recruiter dashboard 200 | `server/src/routes/recruiter.ts`; recruiter dashboard/profile/jobs-new responsive PASS |
| Recruiter — pipeline (kanban, move via PATCH status) | COMPLETED | E2E application + status flow; responsive PASS (kanban scrolls by design) | `client/src/app/recruiter/pipeline/` |
| Recruiter — analytics (funnel, 30-day trend, per-role table) | COMPLETED | Responsive PASS after table fix; real counts verified (1 application / 1 job / 1 applicant for the E2E recruiter) | `server/src/services/analytics.ts`; analytics page renders real DB counts, no sample data |
| Recruiter — applications + evidence ledger | COMPLETED | E2E "verified skills + evidence" 200; responsive PASS | `client/src/app/recruiter/applications/` |
| Matching engine (candidate–job scoring) | PARTIALLY COMPLETED | Server tests cover scoring; E2E match rows created | Scores appear on application rows; `job_match` notifications unwired (§4); no standalone `/api/match` endpoint (§4) |
| Assessment — profile strength analysis (no fabricated skills) | COMPLETED | E2E strength + "never fabricates" steps PASS | `server/src/services/strength.ts`; analysis overall score is numeric, recommendations each explain WHY |
| Assessment — repo analysis (demo project, Python + rate limiter detected) | COMPLETED | E2E repo-analysis steps PASS | `server/src/services/repoAnalysis.ts` |
| Assessment — challenge generation (hidden tests never leaked) | COMPLETED | E2E challenge steps PASS, incl. hidden-test leak check | `server/src/services/challenge.ts` |
| Assessment — Live Lab (Monaco editor, unshare sandbox, run tests, terminal WS) | PARTIALLY COMPLETED | E2E Lab steps PASS (visible test run exit 1 pre-fix, sandbox blocks `curl`, escape probes blocked, WS terminal ping/run/reconnect); responsive layout PASS | `server/src/services/execution.ts`; editor canvas not renderable in this VM (CDN blocked, §4); Lab shell, file tree, timer, terminal verified at 390px + 1280px |
| Assessment — evaluation (real test scores) | COMPLETED | E2E evaluation PASS, overallScore 76.7, functional 100 from real tests | `server/src/services/evaluation.ts` |
| Assessment — AI interview (generated from evaluation, transcript + score) | COMPLETED | E2E interview steps PASS (7 questions, answer 31.75) — mock LLM locally | `server/src/services/interview.ts` |
| Assessment — verified profile + verified skills | COMPLETED | E2E verified-profile steps PASS ("Needs Improvement", 1 skill from passed tests only) | `server/src/services/verified.ts` |
| Assessment — monitoring (consent, tab/idle events, dedupe, neutral summary, recruiter report + 403s) | COMPLETED | E2E monitoring steps PASS; Phase 7 re-checks in §3 rows 14–15 PASS | `server/src/services/monitoring.ts` |
| Messaging (threads per application, send/read, 403 for non-parties) | COMPLETED | §3 rows 10 + 12 PASS (201 / 200 / 201 / 403 / 403); responsive thread pages PASS | `server/src/routes/messages.ts`, `services/messaging.ts` |
| Notifications (list, unread count, mark read, message/status/assessment/interview types) | PARTIALLY COMPLETED | §3 row 11 PASS (unread 4, message notification with thread link) | `server/src/routes/notifications.ts`; `job_match` type never emitted (§4) |
| Legal pages (terms / privacy / DPDP / bias audit) | COMPLETED | Responsive PASS, all 4 pages 200 at both widths | `client/src/app/(legal)/`; DPDP grievance-officer email missing (§4) |
| Contact form (`/contact` → stored, rate-limited) | COMPLETED | §3 row 13 PASS (201, row stored) | `server/src/routes/contact.ts`; landing demo form unwired (§4) |
| Account page + notifications page | COMPLETED | Responsive PASS, both 200 at both widths | `client/src/app/account/` |
| Landing page (Stratify light design, read-only for Phase 8) | PARTIALLY COMPLETED | Desktop PASS; mobile FAIL (418px overflow, §2) | `client/src/app/page.tsx` untouched by Phase 8; footer + waves overflow at 390px |
| Live deployment (Render) | NOT STARTED | — | No live server exists for this phase; all verification is local (§4) |
| GitHub OAuth connection (needed for GitHub-based assessments) | BLOCKED | 409 path confirmed in code | `server/src/services/assessments.ts:98`; no OAuth connection exists yet |
| Real (non-mock) AI provider verification | NOT STARTED | — | Server runs `AI_MOCK=true`; live Gemini/OpenAI calls not verified here |

---

## 6. What Phase 8 changed

Only two files, both CSS/layout, both in the client:

1. `client/src/app/auth/auth.css` — mobile nav becomes a horizontally
   scrollable row (`.st-nav-side`: `overflow-x: auto`, hidden scrollbar,
   no-wrap children, pinned logo). Fixes the clipped nav on every shell
   page. No desktop change.
2. `client/src/app/student/student.css` — at ≤640px, `.st-panel` gets
   `overflow-x: auto`, so wide tables scroll inside their card instead of
   bleeding past it. Fixes the recruiter applications/dashboard/analytics
   tables on mobile. No desktop change.

Not touched: `client/src/app/page.tsx` (landing, read-only), any server
code, any migration, any config. `client/tsconfig.tsbuildinfo` was reverted
after the builds (it is build output, not a source change).

**Verification before push:** server `tsc` + build + 84 tests pass;
ai-service pytest 9/9; client `tsc` + build pass; migrations 001–008 apply
cleanly on a fresh database (46 tables); E2E 62/62 twice; local curl checks
pass (`/health` ok, client home + legal pages 200).
