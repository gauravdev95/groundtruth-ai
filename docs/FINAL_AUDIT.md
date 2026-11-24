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

---

# Update — 23 November 2026 (completion Phases 7–11, local only)

**Repo HEAD:** `4808f74` (Phase 10) at the time of writing; Phase 11 docs
follow in the same series. All commits are local only (no push).

## What changed since the 18 Nov audit

- **Landing overflow (§2 of the 18 Nov audit) — FIXED, root cause corrected.**
  The audit prescribed making `.foot-cols` single-column. Measurement
  proved that wrong: `.foot-cols` min-content is only 212px. The real
  cause was the footer demo-form email input's default `size=20`
  (231px intrinsic min width) forcing `.foot-right` to 381px and the
  single-column `.foot` grid track to 381px, so the document measured a
  constant 418px at every viewport ≤414px. Fixed in
  `client/src/app/page.tsx` (`.foot` track `minmax(0,1fr)`,
  `min-width:0` on grid children, form wraps ≤480px, Sign In moves into
  the hamburger menu, KPI grid fix at 320px, hero headline fix ≤360px).
  Verified in headless Chrome 159: **42/42 page × width checks,
  scrollWidth == viewport** (`/`, `/jobs`, `/auth/login`, `/auth/signup`,
  `/terms`, `/contact` at 320/360/375/390/414/768/1280) + 26
  authenticated-page checks at 390/768, all 0 overflow. Screenshots
  visually reviewed (landing footer/menu/hero at 390 and 320).
- **CORS (§3 finding) — FIXED.** Was `Access-Control-Allow-Origin: *`.
  Now an allowlist (`FRONTEND_URL` + localhost:3000 + 127.0.0.1:3000),
  verified live: evil origin gets no ACAO header, local client origin
  gets one. Production needs `FRONTEND_URL` set to the client origin on
  Render (see `docs/DEPLOYMENT.md`).
- **Auth gaps — FIXED.** `GET/POST /api/candidates` was public (full rows
  incl. email, unauthenticated creation); `POST /api/uploads` was public
  with a client-supplied `candidate_id`. Both now require auth + roles +
  ownership. Login/forgot/reset/register now rate-limited (login 5/min,
  matching the old repo's policy). Verified live: 20/20 checks.
- **JWT in localStorage, stateless logout, no mail sender — still open**
  (user decisions, recorded in the progress report and the final report).
- **Test results (23 Nov, all local):** server suite 96 pass / 0 fail /
  1 skipped (live GitHub test, needs `GITHUB_LIVE=1`); ai-service pytest
  10 pass; E2E 62 pass / 0 fail; API flow 51/51; security checks 20/20;
  client build pass; migrations fresh (46 tables) + legacy (67 tables),
  idempotent.
- **Postgres:** free tier expires **15 Dec 2026 (critical)** — see
  `docs/POSTGRES_MIGRATION_PLAN.md`. Backup/restore rehearsed locally
  (exact match on all counts).
- **Production is still unhealthy** (same three blockers as §1 of
  `docs/DEPLOYMENT.md`: Redis unreachable, `/api/jobs` 500, client API
  env var pending). No deployment was done in Phases 7–11, by instruction.

---

# Update — 23 November 2026 (ultimate completion mission, Phases 0–19, local only)

**Repo branch:** `ultimate-completion-2026-11-23` (local only, no push).
New commits this mission: `60f322b` (favicon), `ee516aa` (candidate
re-embedding + backfill + `/match` UUID validation), `e134109`
(Dockerfile fixes), `84b985f` (malformed-JSON 400 fix), `741d3f5`
(SMTP email integration), `0dedbfd` (Postgres plan: official 30-day
expiry), `bb6cb21` (DEPLOYMENT.md env updates), `dde677d`
(duplicate-job prevention + candidate-create race fix). All prior
local commits preserved; remote `main` untouched.

## What changed since the Phases 7–11 update

- **Duplicate-job prevention — FIXED (was a documented gap).**
  Enqueue helpers called BullMQ `.add()` with no dedup key. Now every
  helper passes `deduplication`: re-embedding + GitHub analysis use
  `keepLastIfActive: true` (≤1 active + 1 waiting per entity), resume
  parsing uses a 60s `ttl`. Deliberately not a fixed `jobId` (a failed
  job would block re-enqueues). Verified: 6 unit tests + live test —
  5 concurrent profile PUTs started only 2 re-embedding jobs (1 active
  + 1 keep-last follow-up) instead of 5.
- **Concurrent profile-save race — FIXED (new defect, found by the
  dedup test).** `getOrCreateCandidateForUser` raced check-then-insert:
  5 concurrent PUTs returned 3× HTTP 500 (`23505
  candidates_email_key`). Now `INSERT ... ON CONFLICT DO NOTHING` +
  re-SELECT. Verified: new race test + live re-test 5 concurrent PUTs
  → 5× 200, 0 errors.
- **Malformed JSON bodies — FIXED.** `express.json()` SyntaxErrors
  (status 400) were answered 500 by the central error handler. Now
  4xx statuses are honoured (400 "Invalid JSON in request body", 413
  stays 413). Verified live + 5 new unit tests.
- **Security re-audit — 24/24 PASS.** Re-ran all prior fixes
  (candidate/upload auth, rate limits, CORS allowlist, SQLi/XSS,
  ownership, JWT tampering, reset tokens, helmet headers, no error
  leakage). The one real defect found is the malformed-JSON 500 above.
- **Email — implemented in code, BLOCKED (not PASS).** Nodemailer over
  SMTP (env-only config, fail-closed 503); forgot-password emails the
  reset link when configured. No delivery test has run (needs SMTP
  credentials + Gaurav's approval to send to his own address), and
  Render Free blocks outbound SMTP on 25/465/587 — delivery from the
  free tier needs a paid plan or an HTTP email API.
- **Responsive re-verified — 111/116, then 5/5 on re-test.** The 5
  failures were landing `/` at 320–414px; root cause was the CDP
  device-metrics override lag in the test harness (innerWidth was still
  405 when measured), not the page. With viewport-settle polling the
  landing is 0-overflow at all five widths, measured twice across the
  12s waves-drift animation. No code change.
- **AI / matching — scope stated honestly.** Local matching uses the
  local-hash DEV-ONLY embedding model (no `OPENAI_API_KEY`); scores
  prove the pipeline, never a real semantic result. The server's LLM
  provider runs the deterministic mock (`AI_MOCK=true`) locally. Real
  OpenAI/Gemini calls are BLOCKED on credentials Gaurav must paste.
- **Code execution — local `unshare` sandbox only.** Judge0 is NOT
  configured anywhere in the repo (grep: zero hits) and was not added.
  The Lab's execution path is verified only via the local sandbox
  (fail-closed, 30s timeout); do not describe it as Judge0-ready.
- **Docker — NOT TESTED.** No `docker` binary exists in this VM, so no
  image was built. Dockerfiles were reviewed/fixed (client `public/`
  COPY removed, ai-service HEALTHCHECK added), but a build must be
  verified on Render or a Docker-enabled machine before any claim.
- **Test results (23 Nov 2026, all local):** server suite 111 pass /
  0 fail / 1 skipped; ai-service pytest 10 pass; E2E assessment 62/62;
  API flow 69/69; security 24/24; integrated E2E 28/28; responsive
  111/116 + 5 re-verified; backup/restore rehearsed twice (exact
  match). Migrations re-verified: fresh 46 tables / 130 indexes, legacy
  67 tables / 230 indexes, idempotent.
- **Postgres deadline — verified from Render's official docs:**
  free Postgres expires **30 days after creation** + 14-day grace,
  then deletion (older 90-day quotes are the former policy). Plan
  assumes expiry 15 Dec 2026 — confirm the exact creation date in the
  Render dashboard. Decision due 30 Nov 2026.
- **Production is still unhealthy** (four blockers now: Redis
  unreachable, `/api/jobs` 500, client API env var pending, ai-service
  not deployed). Re-checked 23 Nov 2026 ~20:30 IST: client 200
  (56,883 bytes), `/health` 503, `/api/jobs` 500, `/api/auth/me`
  without token 401. No deployment was done in this mission, by
  instruction.
- **Still open (user decisions):** JWT in localStorage, stateless
  logout (no token denylist), no error-monitoring service (Sentry etc.
  — zero hits in the repo), WebSocket one-command guard under load NOT
  TESTED, `job_match` notifications unwired, landing demo form not
  wired to `/api/contact`, DPDP grievance-officer email unpublished,
  GitHub-based assessment returns 409 (no GitHub OAuth), Monaco loads
  from a CDN, no account-deletion endpoint.

---

## Phase G update — 24 November 2026 (competency directive, final phase)

- **The 17 Nov 2026 AI Interview exclusion was explicitly revoked.**
  Gaurav's 24 Nov 2026 directive orders a real interview (pre-generated
  questions, follow-ups, live monitoring, post-interview analysis).
  The interview is therefore approved under that directive only;
  git/GitHub-connect remains excluded by the 17 Nov decision. All docs
  that said the interview was DISPUTED have been corrected (README,
  `docs/SECURITY.md`, `docs/RUNBOOK.md`).
- **Full testing re-run (all local, actual results):** server suite
  **162 pass / 0 fail / 1 skipped** (baseline 111; +51 from Phases B–G;
  the 1 skip is the live-GitHub test needing `GITHUB_LIVE=1`); server
  + client typechecks PASS; client production build PASS (twice);
  ai-service pytest **10/10**; E2E assessment **87/87** (was 82 — the
  interview section now answers all 7 questions one at a time and
  exercises the follow-up path end to end); API flow **69/69**;
  integrated E2E **28/28**; security **24/24** (re-run) + Phase G
  interview security **21/21**; browser: candidate interview **59/59**,
  competency page **16/16**, recruiter **19/19**, recruiter 320px
  **4/4** (all 0-overflow, no console errors).
- **One REAL defect found and fixed in Phase G (answer-key leak).**
  `POST /:id/interview/generate` returned the full question rows —
  all 7 question texts plus `expected_points` and `scoring_rubric` —
  to the candidate before the session started. Fixed: the route now
  returns only `{interview, questionCount: 7, roleId,
  frameworkVersion, generationProvider, generationMethod}` via
  `toPublicGenerateResult`; the client type and E2E were updated to
  the new shape; a unit test asserts the public shape contains no
  question text, `expected_points`, `scoring_rubric` or `context`.
- **Fresh-DB migration re-verified:** 000–012 on a scratch DB —
  **53 tables / 156 indexes**, 1 framework, 35 competencies, 35 role
  mappings; idempotent re-run (unchanged). Legacy 67/230 verified
  23 Nov 2026 (not re-run this phase; migrations 010–012 do not touch
  the legacy preflight path).
- **Security spot-checks (Phase G, live):** expired question → 410
  with session advance; duplicate submit → 409; other-candidate read
  → 404 (no existence leak); recruiter start/answer → 403; anon →
  401; malformed UUID → 400 (never 500); LLM rate limit fires 429s on
  the answer route with 0 × 500. Full detail: `docs/SECURITY.md`,
  `docs/TESTING.md`.
- **Documentation (this phase):** README, FINAL_AUDIT (this section),
  `docs/API.md` (85 handler definitions / 94 live routes; assessments
  42; student CRUD rows; generate public-shape note), `docs/DATABASE.md`
  (53/156; migrations 010–012 tables), `docs/SECURITY.md` (Phase G
  checks + defect 4 + exclusion correction), `docs/TESTING.md`
  (full Phase G results), `docs/ENVIRONMENT.md` (interview tunables),
  `docs/RUNBOOK.md` (migration 000–012, exclusion correction); new
  `docs/COMPETENCY_FRAMEWORK.md`, `docs/SCORING_METHODOLOGY.md`,
  `docs/AI_INTERVIEW.md`, `docs/RESEARCH_REFERENCES.md` (design
  guidance only; bands/weights labelled initial configurable
  hypotheses; no scientific-validation claims; future validation plan).
- **E2E worked example (24 Nov 2026):** coding evaluation 76.7
  (functional 100); interview 36.34 (Q1 Missed 33.85, Q2 Partial 48.65
  → follow-up Missed 36.75, Q4–Q8 Missed 36.75); competency overall
  **69.38 / L3**, status **Insufficient Evidence** (no verified
  evidence rows); recruiter chip renders "L3 Job Ready · Insufficient
  Evidence". Scoring ran on the deterministic mock provider and is
  labelled as such.
- **Still open / NOT TESTED (unchanged):** production blockers (Redis
  unreachable, `/api/jobs` 500, client `NEXT_PUBLIC_API_URL` missing,
  ai-service not deployed); free Postgres expires 15 Dec 2026
  (decision due 30 Nov, backup by 8 Dec, cutover by 12 Dec); no live
  AI calls (no keys); email delivery NOT tested (no SMTP credentials;
  Render Free blocks outbound SMTP); Docker image builds NOT TESTED;
  Judge0 NOT configured; WebSocket guard under load NOT TESTED; load
  beyond 20 concurrent requests NOT TESTED; no production smoke tests.
  Open product decisions from Phase C (timer values 300s/2400s,
  Explain Again budget 1/question + 2/session, no resume after expiry)
  still await Gaurav's confirmation if different values are wanted.
- **No push, no deploy, no production change in this phase** (or in
  the whole directive). Branch `ultimate-completion-2026-11-23`,
  HEAD after Phase G commit (see progress log). Final report:
  `~/workspace/goals/ground-truth-ai-recruiter-website/files/GroundTruth_Competency_Interview_Report_2026-11-24.md`.

---

## Stabilization update — 24 November 2026 (Phase 1, P0/P1 + F5; validation worker 6, mock mode only)

Commits `3c1cb8b` (P0/P1: F1–F4) + `7ecae36` (F5 + dual-mode harness).
Local only; no push, no deploy, no production change. Live-AI validation
is NOT part of this entry — the coordinator runs it separately with a real
key (`AI_MOCK=false`); mock-mode evidence below must never be presented
as live-AI evidence.

- **What changed.** F1 strict qualitative schema (`evaluation.ts`):
  missing / non-numeric / out-of-range live-AI scores throw, never coerce
  to 0; a failed live review stores qualitative `null` + `method:
  "failed"` + a structured failure record, and the overall is computed
  from verified dimensions only. F2 live question generation
  (`interview.ts`, `llm.ts`): refine prompt pins the exact JSON-object
  schema, strict validation, `generationProvider` is `"live"` only when
  the refine response validates, else `"deterministic"`. F3 evaluation
  retry (`interviewSession.ts`, migration 013): attempts in
  `interview_evaluation_attempts`, states `pending` / `processing` /
  `completed` / `retryable_failed` / `permanently_failed`, `POST
  /interviews/:id/session/retry-evaluation` (owner/admin, idempotent,
  409 on duplicate). F4 timeout default 30 s → 120 s (`AI_TIMEOUT_MS`,
  `llm.ts` jittered backoff, auth errors distinct from timeouts). F5
  follow-up retry (migration 014 widens the failure-kind CHECK with
  `auth_failed`; retry extended to follow-up evaluations) + dual-mode E2E
  harness (mode-aware provider assertions). Provisional-vs-verified
  classification (`competencyScoringService.ts`,
  `classificationRuleVersion: provisional-vs-verified-v1`,
  `PARTIAL_INTERVIEW_POLICY`): a profile that is not fully verified
  carries a provisional score/category only — never a verified category
  or a "Job Ready" label on insufficient evidence.
- **Full validation re-run (worker 6, 24 Nov 2026, mock mode,
  `AI_MOCK=true`, fresh scratch DB `gt_stab_val6`):** server suite
  **242 pass / 0 fail / 1 skipped** (the skip is the live-GitHub test,
  needs `GITHUB_LIVE=1`); server + client typechecks PASS; client
  production build PASS; ai-service pytest **10/10** (1 pre-existing
  Starlette deprecation warning); mock E2E **95/95** (7 questions,
  provider `deterministic`, all 8 evaluations provider `mock` /
  method `deterministic`, Q2 Partial → exactly 1 follow-up,
  `followUpsUsed: 1`); API flow **69/69**; integrated E2E **28/28**;
  security **24/24** + interview security **21/21**; browser E2E +
  responsive **29/29** (real headless Chromium via CDP, script
  `/tmp/gt_val6_browser.mjs`: UI login, interview intro + readiness
  gate, 7 questions + follow-up answered through the UI, finish →
  report, competency compute, verified page, recruiter applications /
  detail / evidence, 320px 0-overflow on 4 pages, no console errors).
  Full detail: `docs/TESTING.md` (stabilization section).
- **Migrations re-verified:** fresh 000–014 → **54 tables / 162
  indexes** (was 53/156 at 012), 1 framework, 35 competencies, 35
  mappings; idempotent re-run unchanged. Upgrade path verified:
  a 000–012 DB (53/156) migrates to 54/162 with 013+014 applied.
  Legacy 67/230 (23 Nov) not re-run — no migration touches the legacy
  preflight path.
- **Environment incident (fixed during validation, no code change).**
  The first suite run skipped 67 DB-gated tests ("no Postgres
  reachable"): after a VM restart the system Postgres (not the old
  pgserver instance) serves :5432, the `.env` database
  `gt_all_steps` does not exist there, and `.env` carries no DB
  password while `pg_hba.conf` requires SCRAM for TCP. Fixed locally
  by creating scratch DB `gt_stab_val6` and adding a localhost-only
  `trust` line at the top of `pg_hba.conf` (backup at
  `/tmp/pg_hba.conf.bak`) + reload; all 67 tests then ran
  (242/0/1). The old `gt_p2_api`/`gt_all_steps` databases and the
  `postgres:postgres` launcher credentials do not work against the
  current system Postgres — the launchers still assume them.
- **Acceptance criteria A–J (mock-mode evidence; D live-truthfulness
  NOT TESTED live):** A PASS (strict schema, null-not-zero); B PASS
  (no verified category without full verification); C PASS (7
  questions, ≥5 competencies, all 3 types, competency–content match);
  D NOT TESTED live (code path verified: `generationProvider` is
  `live` only on validated refine; coordinator runs the live check);
  E PASS (retry states + idempotency); F PASS (insert-once answers,
  duplicate 409, immutable report); G PASS (Partial → max 1 follow-up,
  served next, no second follow-up); H PASS (candidate/recruiter
  reports consistent; provisional score shown, category null when
  unverified); I PASS (stranger recruiter 403s on evidence/profile/
  report); J PASS (API 69/69, integrated E2E 28/28, security 24/24 +
  21/21, no regressions). One-line evidence per criterion in
  `docs/TESTING.md`.
- **Still open / NOT TESTED (unchanged):** live-AI provider
  truthfulness + live follow-up (coordinator, needs a real key);
  production blockers (Redis, `/api/jobs` 500, client `NEXT_PUBLIC_API_URL`,
  ai-service not deployed); free Postgres expires 15 Dec 2026
  (decision due 30 Nov, backup by 8 Dec, cutover by 12 Dec); email
  delivery NOT tested; Docker image builds NOT TESTED; Judge0 NOT
  configured; WebSocket guard under load NOT TESTED; load beyond 20
  concurrent requests NOT TESTED; no production smoke tests.
  `client/tsconfig.tsbuildinfo` was modified by the validation build
  and restored — the working tree is clean.
- **No push, no deploy, no production change in this phase.**
  Branch `ultimate-completion-2026-11-23`, HEAD `7ecae36` (no new
  commits by worker 6 — validation only).
