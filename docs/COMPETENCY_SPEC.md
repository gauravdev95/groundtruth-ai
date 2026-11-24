# Competency Specification — Phase B (v1.0.0)

**Date:** 24 Nov 2026 · **Status:** implemented (local only, no push/deploy)
**Governing instruction:** the 24 Nov 2026 directive revoking the 17 Nov 2026
exclusion of the AI Interview / report feature for a real interview. The
audit map (`docs/IMPLEMENTATION_MAP_COMPETENCY.md`) is the Phase A record.

## 1. Framework (versioned data, not code)

- Source of truth: `server/src/config/competencyFramework.ts`
  (`COMPETENCY_FRAMEWORK_V1`, version `v1.0.0`).
- DB mirror: `infra/postgres/010_competency_framework.sql` seeds tables
  `competency_frameworks` / `competencies` / `role_competency_mappings` /
  `competency_results` from the same definitions (seed SQL is generated from
  the TS config; change the config and regenerate, never hand-edit the seed).
- A new version is a NEW version string + new seed rows. Historical results
  store `frameworkVersion` + a snapshot of the settings used
  (`competency_results.framework_version`, `result` JSONB), so a version
  change never rewrites an old result.

## 2. Roles and competencies

7 roles, 5 competencies each (35 total). Each role has a DISTINCT set —
no role reuses another role's framework:

| Role | Competencies (weight) |
|---|---|
| Backend Developer | API Design & REST 25, Databases & Data Modelling 25, Server-Side Logic & OOP 20, Testing & Debugging 15, System Design & Scalability 15 |
| Full Stack Developer | Backend APIs 25, Frontend Fundamentals 20, Databases & Persistence 20, UI/UX Integration & State Management 20, DevOps & Deployment 15 |
| Frontend Developer | HTML/CSS & Responsive Design 25, JavaScript & TypeScript 25, React & State Management 25, Web Performance & Accessibility 15, Testing & Frontend Tooling 10 |
| Python Developer | Python Core & OOP 30, Data Structures & Algorithms 20, Libraries & Frameworks 20, Testing & Debugging in Python 15, Scripting & Automation 15 |
| AI/ML Engineer | ML Fundamentals 25, Model Training & Evaluation 25, Data Preprocessing & Feature Engineering 20, Deep Learning & LLMs 15, MLOps & Deployment 15 |
| Data Scientist | Statistics & Probability 25, ML Modelling 25, Data Analysis & Visualisation 20, SQL & Data Wrangling 15, Communication & Storytelling 15 |
| Software Development Engineer | Data Structures & Algorithms 30, System Design 20, OOP & Design Patterns 20, Testing & Code Quality 15, Problem Solving & Debugging 15 |

Every competency carries: id, name, description, relevant skills, weight,
difficulty (Foundation/Intermediate/Advanced), expected evidence types,
coding-task mapping, interview-question mapping, a scoring rubric (one
description per category L1–L4), and minimum evidence requirements
(`minEvidence` = 2 distinct items + a description). Role weights sum to
exactly 100 — validated at load; anything else fails loudly.

## 3. Proficiency categories (configurable, versioned)

Stored in the framework config + `competency_frameworks.categories` JSONB.
NOT hardcoded in the scoring service or frontend.

| Category | Range | Meaning |
|---|---|---|
| L1 Foundation | 0–39 | Recalls basics; cannot yet apply them reliably without guidance. |
| L2 Developing | 40–59 | Applies core concepts to familiar problems with support; inconsistent. |
| L3 Job Ready | 60–79 | Independently delivers correct solutions to typical role tasks. |
| L4 Strong | 80–100 | High-quality solutions, edge cases and trade-offs; can teach others. |

Categories apply to individual competencies AND to the overall score.

## 4. Deterministic scoring (`server/src/services/competencyScoringService.ts`)

Pure arithmetic. No LLM decides any score, category or status.

- Overall: **S = C×0.50 + I×0.30 + E×0.20**, where C = coding (practical
  task), I = interview, E = evidence (portfolio/project). Component weights
  come from the framework config. Per-competency scores use the same blend.
- Component scores are weight-averaged over competencies that produced a
  score; a competency with no score contributes nothing.
- Missing source → that competency is **Incomplete**: its score is computed
  over the present sources only (weights renormalised) and flagged — never
  a silent zero for the missing source.
- No source at all → **Not Assessed** (score null), never 0.
- Fewer distinct evidence items than `minEvidence` → **Insufficient
  Evidence** (score null), never fabricated.
- **No double-counting:** an evidence-item id supplied to both the coding
  and evidence sources is counted once (reported as `dedupedEvidenceIds`).
- **Practical-task safeguard:** if the overall coding component is below
  the configurable minimum (default 40), Job Ready / Strong are blocked —
  status becomes **Practical Threshold Not Met** and the overall category is
  capped at L2.
- Evidence coverage % = competencies with a computed score ÷ total
  competencies. Confidence: `high` only for a Complete profile at 100%
  coverage; `medium` at ≥60% coverage (and not Insufficient Evidence);
  otherwise `low`.
- Deterministic: same inputs + same framework version → identical output.
  Out-of-range scores, unknown roles/versions/competencies and duplicate
  entries throw (fail loudly).
- Invalid frameworks (weights ≠ 100, non-tiling categories, component
  weights ≠ 1, missing rubric levels) throw at registration/load.

## 5. Tests

- `server/tests/competency.test.ts` (18 tests): boundaries 39/40/59/60/
  79/80/100, weight calculation, S formula, missing source, insufficient
  evidence, not assessed, practical minimum (incl. the 40 boundary and a
  configurable override), no duplicate evidence counting, version change
  leaves a historical result unchanged, repeated calculation identical,
  fail-loud inputs, framework shape (7 distinct roles, weights sum 100).
- `server/tests/migration-010.test.ts` (1 test, skips without Postgres):
  010 applies, seeds v1.0.0 (35 competencies, 7 roles × weight-sum 100),
  is idempotent, and a result row references its framework version.

## 6. What Phase B does NOT do (later phases)

- No interview session flow, timers, answer locking or follow-ups (Phase C).
- No recruiter surface (Phase D), no candidate/recruiter frontend (E/F).
- No live AI anywhere: scoring is deterministic; any future LLM input
  (e.g. per-answer dimension scores from `interview.ts`) feeds the service
  as *input numbers only* and must stay labelled mock/live at the source.
- Judge0 is NOT configured — nothing here claims code-execution results.

## 7. Phase E — final competency profiles (integration)

Implemented 24 Nov 2026 (local only, no push/deploy). Service
`server/src/services/competencyProfile.ts`; migration
`infra/postgres/012_competency_profiles.sql`; endpoints
`POST /:id/competency/compute` + `GET /:id/competency`
(`server/src/routes/assessments.ts`); candidate UI
`client/src/app/assessment/[id]/competency/page.tsx` +
`client/src/components/assessment/CompetencyProfile.tsx` (reused by the
recruiter evidence view in Phase F).

- **Sources.** C = the completed evaluation's overall score, applied per
  competency only where the coding task exercised it (skill overlap with
  the challenge + evaluation text). I = per-competency scores from the
  stored immutable interview report (only a completed interview supplies
  I). E = independently verified evidence: verified skills
  (functional score from the evaluation that verified them), GitHub/other
  verification rows (`verification_results.score`), and candidate
  projects (evidence items only — no numeric score). The one genuine
  overlap — a verified skill whose evidence points at the same
  evaluation that produced C — lists `evaluation:<assessmentId>` in
  both sources and is counted ONCE by the scoring service's dedup.
- **Storage.** `competency_results` (010) extended by 012 with
  `assessment_id` / `interview_id` / `evaluation_id` / `inputs_hash`,
  a UNIQUE `(assessment_id, framework_version)` index (one stored
  profile per assessment per version) and a BEFORE UPDATE immutability
  trigger (DELETE allowed). The stored `result` JSONB holds the full
  profile + framework snapshot + formula (`S = C*0.50 + I*0.30 + E*0.20`,
  formula version 1) + strengths + improvement areas + per-competency
  evidence references + source summary.
- **Safeguards.** Practical minimum (coding < 40) → "Practical Threshold
  Not Met", category capped at L2. Missing source → Incomplete /
  Insufficient Evidence / Not Assessed, never a silent zero; the profile
  carries `isFinal: false` until Complete (or Practical Threshold Not
  Met) — its category is provisional until the required sources complete.
  No automatic rejection/hiring decision — the profile is an assessment
  result; recruiters decide.
- **Idempotency.** Same source snapshot (SHA-256 `inputs_hash`) →
  stored row returned, no duplicate. Changed inputs refresh a non-final
  draft (DELETE + INSERT — UPDATE is rejected by the trigger) and never
  touch a final profile. A new framework version computes a new row;
  historical rows are untouched.
- **Bug fixed in passing (Phase B, exposed by Phase E).**
  `categoryForScore` in `competencyScoringService.ts` used closed
  integer ranges, so a fractional blended score such as 59.97 fell in
  the gap between L2 (40–59) and L3 (60–79) and threw. Ranges are now
  read half-open ([min, next.min), last closed at 100); integer
  boundaries map exactly as before (39→L1, 40→L2, 59→L2, 60→L3,
  79→L3, 80→L4, 100→L4) and all 18 Phase B tests still pass.
- **Tests.** `server/tests/competency-profile.test.ts` (11) +
  `server/tests/migration-012.test.ts` (2): all-three-sources Complete,
  missing interview → Incomplete, missing evidence → Insufficient
  Evidence, no sources → Not Assessed, practical threshold cap, no
  double-counting, deterministic repeat, draft refresh / final
  immutability, framework-version history, unauthorized access, 404
  before compute. E2E (`server/scripts/e2e-assessment.mjs`) gains 7
  competency steps (404 before compute → compute 201 → recompute
  idempotent → candidate GET → recruiter GET).
