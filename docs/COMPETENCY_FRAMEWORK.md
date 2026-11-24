# GroundTruth AI — competency framework

**Date:** 24 November 2026 (competency directive, Phases B–G).
**Version:** `v1.0.0` (seeded by migration `010_competency_framework.sql`;
stored in `competency_frameworks`, `competencies`,
`role_competency_mappings`; verified on a fresh DB: 1 framework, 35
competencies, 35 mappings).
**Spec:** `docs/COMPETENCY_SPEC.md` (authoritative; this doc summarises
it). **Scoring:** `docs/SCORING_METHODOLOGY.md`. **Interview:**
`docs/AI_INTERVIEW.md`.

## What it is

A role-based competency model that turns three independent evidence
sources — the coding evaluation, the AI interview, and the profile
evidence (projects, coding-platform profiles, verified skills) — into
one comparable per-competency profile per candidate, per role, with a
provisional overall score and — only when every mandatory condition
holds — a verified L1–L4 proficiency category. A provisional band is
never presented as a verified category; see
`docs/SCORING_METHODOLOGY.md` §5.

## Roles (7) and competencies (35)

Every role has exactly 5 distinct competencies; competency weights per
role sum to 100.

| Role | Competencies (weights) |
|---|---|
| Backend Engineer | API & Service Design 25 · Databases & Data Modelling 25 · Testing & Debugging 15 · Problem Solving & Algorithms 20 · Security & Auth 15 |
| Frontend Engineer | React & State Management 25 · UI & Styling 20 · Performance & Accessibility 15 · Testing & Debugging 15 · API Integration 25 |
| Full-Stack Engineer | API & Service Design 20 · Databases & Data Modelling 20 · React & State Management 20 · Testing & Debugging 15 · Deployment & DevOps 25 |
| Data Analyst | SQL & Data Wrangling 30 · Statistics & Analysis 25 · Data Visualisation 20 · Python / Pandas 15 · Business Communication 10 |
| Data Engineer | SQL & Data Wrangling 25 · ETL & Pipelines 25 · Databases & Data Modelling 20 · Cloud & Big Data 15 · Python / Pandas 15 |
| DevOps Engineer | CI/CD & Automation 25 · Cloud & Infrastructure 25 · Deployment & DevOps 20 · Monitoring & Logging 15 · Security & Auth 15 |
| AI/ML Engineer | Python / Pandas 20 · ML Fundamentals 25 · LLM & Prompting 25 · Model Evaluation 15 · Data Visualisation 15 |

Competency overlap is deliberate (e.g. Databases & Data Modelling
appears in Backend, Full-Stack and Data Engineer) so candidates can be
compared across related roles; each role weights its own five.

## Proficiency bands (L1–L4)

| Band | Score range | Label |
|---|---|---|
| L1 | 0–39 | Needs Development |
| L2 | 40–59 | Developing |
| L3 | 60–79 | Job Ready |
| L4 | 80–100 | Strong |

Band thresholds are **initial configurable hypotheses, not validated
cut scores** — see `docs/RESEARCH_REFERENCES.md` for the design
rationale and the future validation plan. They are stored as
configuration, not hard-coded in the scorer, and can be re-tuned
without changing the evidence pipeline.

## How a profile is built

1. **Coding evaluation** (`C`): the Lab evaluation's weighted score
   (functional 30 / quality 20 / problem-solving 20 / understanding 15 /
   testing 15), mapped onto the competencies it evidences.
2. **Interview** (`I`): the 7-question interview's per-question
   dimension scores (see `docs/AI_INTERVIEW.md`), mapped onto the
   competencies each question targets.
3. **Evidence** (`E`): profile evidence — verified skills, projects,
   coding-platform profiles — scored from the candidate's verified
   profile data.
4. **Blend:** per competency `S = C×0.50 + I×0.30 + E×0.20`; overall
   score is the weight-averaged competency score (see
   `docs/SCORING_METHODOLOGY.md` for the full formula, safeguards and
   audit fields).
5. **Status:** `Complete` (all three sources), `Incomplete` (missing
   interview or coding — displayed as "Assessment Incomplete"),
   `Insufficient Evidence` (missing evidence or too little signal),
   `Not Assessed` (no sources at all — displayed when nothing was
   assessed). A profile is never silently filled with zeros.
6. **Classification:** the blend gives a **provisional score** and a
   **provisional band** (capped at L2 when the practical minimum
   fails). A **verified category** is assigned only when every
   mandatory condition holds — all sources complete, minimum evidence
   per competency, practical coding minimum met, the interview
   fully evaluated (every required original question scored; a
   provisional interview score is shown only with its coverage, e.g.
   "provisional — 6 of 7 questions scored"), every competency's own
   interview questions all scored, and the coding evaluation's
   qualitative review not failed. Otherwise the profile carries its
   provisional score and NO verified category. See
   `docs/SCORING_METHODOLOGY.md` §5 for the full policy
   (`provisional-vs-verified-v3`) and the partial-interview policy.

## Storage and lifecycle

- Profiles are stored in `competency_results` (`result` JSONB +
  `framework_version`, `assessment_id` / `interview_id` /
  `evaluation_id`, `inputs_hash`). `UNIQUE (assessment_id,
  framework_version)`; a BEFORE UPDATE trigger blocks edits
  (DELETE allowed). Recompute is idempotent — same inputs → same
  stored row.
- `inputs_hash` is a SHA-256 of the source snapshot, so a profile can
  be re-derived and compared against its inputs at audit time.
- A **draft** profile (before the interview finishes) can be refreshed;
  a **final** profile is immutable.
- Framework versions are kept: computing against a newer framework
  version stores a new row; old rows remain for history.
- Candidate endpoint: `GET /api/assessments/:id/competency`
  (404 before compute; 201 on compute; recompute idempotent).
  Recruiter endpoints: applications list / pipeline / dashboard carry
  the latest profile chip; application detail shows the full profile;
  the evidence page shows the interview breakdown. A recruiter with no
  application to the candidate gets 403.
- List/dashboard reads derive the verified category in SQL, mirroring
  the stored-profile re-read: the stored band is the verified
  category only for a `Complete` profile whose stored interview
  coverage (where present) is complete; every other row shows no
  verified category, the stored band as the provisional category, and
  the stored interview-coverage note with the provisional score.

## Where it is shown

- **Candidate:** `/assessments/:id/competency` — role, framework
  version, provisional score or verified score, verified category
  (only when verified) or provisional band explicitly marked
  Provisional, per-competency bars, C/I/E breakdown, strengths and
  improvement areas, a verified-profile panel, and a "how this is
  calculated" link.
- **Recruiter:** competency chip (verified band + label only when
  verified, e.g. "64 · L3 Job Ready"; otherwise "Provisional 64 ·
  Insufficient Evidence" — a number with its status, never a band
  presented as verified) on the applications list, pipeline and
  dashboard; full profile + assessment history on the application
  detail page; interview breakdown on the evidence page.
  Chips are never shown for candidates with no computed profile.

## What it is not

- Not a hiring decision. It is a structured summary of observed
  evidence; recruiters still read the interview answers and the code.
- Not validated against job performance yet. The validation plan is in
  `docs/RESEARCH_REFERENCES.md`.
- Not a replacement for the coding evaluation or the interview — the
  blend weights are a starting hypothesis and are labelled as such in
  the UI ("initial model, not a validated cut score").
