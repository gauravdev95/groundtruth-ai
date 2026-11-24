# GroundTruth AI — scoring methodology

**Date:** 24 November 2026 (competency directive, Phases B–G; Phase 2
classification tightening, 24 November 2026 — rule
`provisional-vs-verified-v3`; v3 enforces the required-question count
as the framework constant 7 when coverage is read from a stored
report, so a legacy short report can no longer read complete).
**Framework version:** `v1.0.0`. **Spec:** `docs/COMPETENCY_SPEC.md`.
**Framework:** `docs/COMPETENCY_FRAMEWORK.md`. **Interview:**
`docs/AI_INTERVIEW.md`.

> **Status of these numbers:** every weight, threshold and band below
> is an **initial configurable hypothesis**, chosen as a transparent
> starting point. None of it is a scientifically validated cut score.
> See `docs/RESEARCH_REFERENCES.md` for the design guidance the
> numbers lean on and the validation plan (recruiter assessments +
> job-performance outcomes) that would be needed to call them
> validated.

## 1. Interview question scoring (per question, 0–100)

Each answered question is scored on five dimensions, weighted:

| Dimension | Weight | What it measures |
|---|---|---|
| Technical correctness | 30 | Is the answer factually right? |
| Depth of understanding | 25 | Does it explain why, not just what? |
| Relevance | 15 | Does it answer the question asked? |
| Project / code evidence | 15 | Does it ground the claim in the candidate's own code or project? |
| Communication & clarity | 15 | Is it structured and readable? |

Per-question score = weighted sum of the five dimension scores
(0–100). Classification per question:

| Score | Label |
|---|---|
| 60–100 | Strong |
| 40–59 | Partial |
| 0–39 | Missed |

A **Partial** (40–59) answer is the only trigger for a follow-up
(at most one per interview — see `docs/AI_INTERVIEW.md`).

## 2. Coding evaluation scoring (per evaluation, 0–100)

The Lab evaluation weights five criteria:

| Criterion | Weight |
|---|---|
| Functional correctness | 30 |
| Code quality | 20 |
| Problem solving | 20 |
| Understanding | 15 |
| Testing | 15 |

Overall evaluation score = weighted sum (0–100). This is the `C`
source in the blend below.

### 2.1 Live-AI qualitative review — strict validation and failure policy (P0, 24 Nov 2026)

The three qualitative categories (problem-solving, understanding,
testing) are scored by the live LLM only when it is configured. The
review contract is strict and the failure mode is fail-loud:

- **Exact JSON schema (also stated verbatim in the LLM prompt):**
  `problemSolving`, `understanding`, `testing` — JSON numbers, finite,
  0–100 inclusive; `strengths`, `weaknesses`, `improvements` — arrays
  of strings. All six keys are required. Schema version
  `1.0.0` (`QUALITATIVE_SCHEMA_VERSION` in
  `server/src/services/evaluation.ts`).
- **Missing fields fail validation — they never become 0.** Null,
  string, NaN/Infinity, negative and >100 scores all fail. Wrong key
  names (`problem_solving`, `technicalUnderstanding`,
  `testingScore`, …) are rejected, never read as the value of the
  correct field. Invalid JSON fails. This fixes the live E2E run that
  recorded problem-solving / understanding / testing as 0 with
  `method="llm"` while functional and quality were 100: the old prompt
  never specified the key names and the old validator silently coerced
  missing fields to 0.
- **Failure policy (a) — failed, not substituted:** if the live review
  fails (invalid JSON, schema validation, timeout, provider
  unavailable/error, auth failure), the evaluation does **not**
  silently fall back to the deterministic heuristic and does **not**
  substitute 0. The qualitative categories are recorded as `null`
  (failed), `qualitativeMethod` is `"failed"`, the overall score is
  computed **only from the verified dimensions** (functional 30% +
  quality 20%, renormalised by their combined weight 0.5 — e.g.
  functional 80 + quality 60 → 72, not 36), `overallBasis` is
  `"verified-dimensions-only"`, confidence drops to 0.3, and
  `human_review_recommended` is set. A structured failure record is
  stored in `evidence.qualitativeFailure`: error code, schema version,
  provider, model, HTTP status, missing/invalid/unknown field names,
  duration, retry count — never raw candidate answers, prompts, or
  repo contents. The method label is always one of `"live-ai"`,
  `"deterministic-heuristic"` (AI not configured — the pre-existing
  capped heuristic, still flagged for human review) or `"failed"`.
  An evaluation must never claim an AI score was generated when
  parsing failed.
- The deterministic heuristic remains the policy **only** when no live
  AI is configured at all. Whether a failed live review should ever
  fall back to it is a product decision for the user, not an
  engineering default — it is not implemented.

## 3. Competency blend (per competency, 0–100)

```
S = C×0.50 + I×0.30 + E×0.20
```

- `C` — coding evaluation score for that competency (0–100).
- `I` — interview score for that competency (0–100), averaged over
  the questions targeting it.
- `E` — profile-evidence score for that competency (0–100), from
  verified skills, projects and coding-platform profiles.
- If a source is missing for a competency, it contributes nothing and
  the profile status records the gap (see §5) — a missing source is
  never silently replaced with 0 in a "Complete" profile.

Overall score = weight-averaged competency score, using the role's
competency weights (each role's weights sum to 100):

```
Overall = Σ (S_competency × weight) / Σ weight
```

The overall score is a **provisional score**: it is always computable
from the sources that are present (weights renormalised when a source
is missing), but it is a working figure, never a verified result on
its own. Whether it carries a **verified category** is decided
separately — see §5, "Provisional vs verified classification".

## 4. Bands (L1–L4)

Applied to the provisional overall score and to each per-competency
score (the **provisional band**). The same bands give the **verified
category** — but only when the verified-category conditions in §5
hold. A provisional L3 is never shown as a verified "Job Ready".

| Band | Range | Label |
|---|---|---|
| L1 | 0–39 | Needs Development |
| L2 | 40–59 | Developing |
| L3 | 60–79 | Job Ready |
| L4 | 80–100 | Strong |

## 5. Safeguards

### Provisional vs verified classification (rule `provisional-vs-verified-v3`)

Every computed profile carries both a provisional figure and (only
when earned) a verified category:

- `provisionalScore` / `provisionalCategory` — the renormalised blend
  and its band, always computable from the sources present. The
  provisional band is capped at L2 when the practical minimum fails.
  Displayable only labelled **Provisional**.
- `verifiedCategory` — non-null **only when ALL of these hold**:
  1. **All sources complete** — every competency has coding,
     interview and evidence present, and every competency meets its
     minimum evidence (profile status `Complete`).
  2. **Practical coding minimum met** — the coding component is at or
     above the framework's practical minimum (40 in v1.0.0).
  3. **Interview complete** — per the partial-interview policy below,
     every required original question has a scored evaluation.
     Required means the framework count (7): a stored report with
     fewer than 7 rows, however many of them are scored, is
     incomplete (v3).
  4. **A score exists** — `Not Assessed` (no source at all) is null,
     never 0.
  5. **Qualitative review passed (v2)** — the coding evaluation's
     qualitative review did not fail. A failed review leaves the
     overall renormalised over the verified dimensions only
     (functional + quality), so it cannot support a verified
     category; the profile records `qualitativeMethod: "failed"` and
     notes that a human review is required.
- When any condition fails, `verifiedCategory` is null and the status
  names the gap — one of `Insufficient Evidence`, `Assessment
  Incomplete` (stored status `Incomplete`), `Practical Threshold Not
  Met`, or `Not Assessed` (stored `Incomplete` with no source at all).
  A renormalised number is never presented as a verified L3/L4: the
  combination once seen live — overall 64.29 + L3 (Job Ready) +
  "Insufficient Evidence" + low confidence + a null interview
  component, all at once — is now impossible by construction.
- The classification rule version is stored with every profile
  (`classificationRuleVersion`, alongside the framework snapshot), so
  a historical profile keeps the rule that produced it. Rows stored
  before this rule keep their stored category as the verified category
  only when their status is `Complete` AND their stored interview
  coverage (where present) is complete; a legacy `Complete` row whose
  stored coverage says the interview was partial is re-read with no
  verified category and its stored band as the provisional one. **Accepted
  limitation:** when a legacy row carries no coverage data at all,
  there is nothing to re-check against, so the legacy trust is kept
  (status `Complete` → stored band is the verified category). The
  rule version on such a row says so
  (`pre-provisional-vs-verified (overallCategory was provisional)`).
- Per-competency bands follow the same split, tightened in v2:
  `verifiedCategory` on a competency is non-null only when that
  competency is fully Assessed, its practical minimum is met, the
  interview is complete, **every one of that competency's own
  interview questions was scored** (a 1-of-2-questions mean of 85 is
  a provisional interview score, not an assessed leg — the
  competency is `Incomplete` until all its questions are scored),
  and the qualitative review did not fail. A 6/7 interview nulls
  every per-competency verified category, however high the scores.
- **Verified profile status (v2):** the recruiter verified profile's
  `verificationStatus` is `"Verified"` only when the stored
  competency profile carries a non-null verified category on a final
  profile AND an interview score exists. It is never `"Verified"`
  from the coding score alone, and never when the interview score is
  null (coding 75 + no interview is `"Assessment Completed"`). Any
  other computed profile maps to `"Assessment Completed"`; with no
  profile at all, an evaluated assessment is `"Assessment Completed"`
  at overall ≥ 50 and `"Needs Improvement"` below it.

### Partial-interview policy (single definition)

Defined once in `server/src/services/competencyScoringService.ts`
(`PARTIAL_INTERVIEW_POLICY`, evaluated by
`assessInterviewCoverage`); every surface uses that definition, never
its own copy:

- **Per-question scores are displayable** as soon as that question is
  scored — a scored question is a fact, not a projection.
- **A final interview score exists only when every required original
  question is evaluated** (7 in framework v1 — the pre-generated
  questions). A follow-up re-tests the weak point of one original
  question, and its score SUPERSEDES the original's score for that
  question (Phase 2, G3.3 ruling) — but the follow-up never adds a
  question to the count, and the original answer and score stay
  stored and visible in the report next to the follow-up's. A mean
  over the questions scored so far is provisional only.
- **The required count is the framework constant (7), not the stored
  row count** (v3): when coverage is read from a stored report, a
  legacy report with fewer than 7 rows reads incomplete even when
  every one of its rows is scored.
- **A provisional interview score is shown only with its coverage
  stated**, e.g. "provisional — 6 of 7 questions scored". The finished
  report carries the completeness contract itself
  (`interviewComplete`, `provisionalNote`, `questionsScored`,
  `questionsRequired`) — computed from the same per-question data
  through this one definition.
- **Unanswered is not pending:** a question that was never answered
  carries evaluation state `unanswered` and is counted in
  `unansweredCount`, separately from `pendingEvaluations` (answers
  awaiting an evaluation). The true unscored count is the two
  together; the profile recomputes both from the report's
  per-question statuses rather than trusting a stored number.
- **Final classification requires all mandatory conditions** (§5
  above) — a partial interview blocks the verified category even when
  the provisional blend is high.
- Coverage unknown (no question-level detail in the stored report) is
  NOT completeness: an unverified interview can never support a
  verified category.

### Other safeguards

- **Practical minimum (coding):** if the coding evaluation is below
  **40**, the provisional band is capped at **L2** and the status reads
  **"Practical Threshold Not Met"** (when nothing else is already
  failing — otherwise the deeper gap keeps its status and the cap
  still applies to the provisional number), whatever the interview or
  evidence scores say. A candidate who cannot demonstrate working
  code is not labelled "Job Ready" — and not even the capped L2 is a
  verified category.
- **Below-minimum coding on score-null competencies (v2):** component
  scores average only over competencies with a computed score, so a
  below-minimum coding score on an `Insufficient Evidence` /
  `Not Assessed` competency vanishes from the component average with
  no trace. It is therefore listed explicitly on the profile
  (`practicalMinimumFailures`: competency id, name, coding score)
  and noted. The component average itself is unchanged (scored
  competencies only) — it is flagged, not silently repaired.
- **Evidence composition (v2):** the framework's minimum is not a
  bare count — it is "one coding task and one project or interview
  answer". When the evidence item types are known (evidence ids
  supplied), the rule is enforced: a competency needs at least one
  coding-sourced item AND at least one non-coding item (project /
  interview / verification); otherwise it is `Insufficient Evidence`
  with a null score, however many items it has. When no ids are
  supplied at all the composition cannot be checked and the
  count-only rule applies — that fallback is the documented
  exception, not the rule.
- **Confidence (v2):** `high` only when the profile is `Complete` at
  100% coverage; `medium` only when the profile is `Complete` OR at
  100% coverage; `low` otherwise. An `Incomplete` / `Insufficient
  Evidence` profile below 100% coverage is `low`, however high its
  provisional number — the old "medium at ≥60% coverage" overstated
  it.
- **List / dashboard reads (v2):** the applications list and the
  recruiter dashboard derive the verified category in SQL, mirroring
  the stored-profile re-read — the stored band is the verified
  category only for a `Complete` profile whose stored interview
  coverage (where present) is complete; every other row yields no
  verified category, the stored band as the provisional category,
  the classification rule version, and the stored
  interview-coverage note (`provisionalNote`) with the provisional
  score, so a provisional score is never shown without its coverage
  note.
- **Missing sources → explicit status, never silent zeros:**
  - `Complete` — coding + interview + evidence all present.
  - `Incomplete` — interview or coding missing (displayed as
    "Assessment Incomplete"; displayed as "Not Assessed" when no
    source exists at all).
  - `Insufficient Evidence` — evidence missing or too little signal
    (e.g. the Phase G E2E profile: provisional 69.38, no verified
    category, because the E2E candidate has no verified evidence
    rows).
  - `Not Assessed` — no sources at all (per-competency status; the
    profile displays it when nothing was assessed).
- **No double-counting:** the same evidence row is used once per
  competency; the recompute is deterministic (same inputs → same
  result, verified by test).
- **Deterministic fallback:** when no live AI is configured, scoring
  runs on the deterministic mock provider and the result is labelled
  mock (`generationProvider: "mock"`, `evaluationProvider: "mock"`)
  in the report and the UI. A mock score is never presented as a live
  AI judgement.
- **Live-AI failure:** if the live LLM call fails mid-interview, the
  answer is kept with evaluation **pending** and **no score is
  substituted** (fail-loud, not fail-silent).
- **Draft vs final:** a draft profile (interview not finished) can be
  refreshed; a final profile is immutable (BEFORE UPDATE trigger).
- **Answer locking:** answers are insert-once; duplicate submit → 409.
  Scores cannot be edited after submission.

## 6. Audit fields (stored with every profile)

Stored in `competency_results`:

| Field | Purpose |
|---|---|
| `result` (JSONB) | Full profile: per-competency scores + weights, C/I/E breakdown, strengths, improvement areas, status, provisional score, provisional/verified categories, interview coverage. |
| `framework_version` | Framework the profile was computed against (v1.0.0). |
| `classificationRuleVersion` | Classification rule that produced the profile (`provisional-vs-verified-v3`); a historical profile keeps the rule that produced it. |
| `practicalMinimumFailures` | Competencies whose coding score is below the practical minimum, including score-null ones (v2) — see §5. |
| `qualitativeMethod` | Evaluation basis of the coding evaluation (`live-ai` / `deterministic-heuristic` / `failed` / null); `failed` blocks verification (v2). |
| `overall_category` | The VERIFIED category only (null unless verified) — never a provisional band. |
| `assessment_id` / `interview_id` / `evaluation_id` | The three source records. |
| `inputs_hash` | SHA-256 of the source snapshot — re-derive and compare at audit time. |
| `UNIQUE (assessment_id, framework_version)` | One profile per assessment per framework version. |

Interview reports (`interview_reports`) store per-question dimension
scores, the follow-up and its nesting, timers, and provider labels;
they are immutable (BEFORE UPDATE trigger) and read-only via
`GET /api/assessments/:id/interview/report` (404 until finished).

## 7. Worked example (Phase G E2E, 24 Nov 2026)

E2E candidate, Backend Engineer, mock scoring:

- Coding evaluation overall **76.7** (functional 100).
- Interview: Q1 Missed 33.85, Q2 Partial 48.65 → follow-up Missed
  36.75, Q4–Q8 Missed 36.75 each → interview score **36.34**.
- Competency blend → provisional **69.38 (provisional band L3)**,
  status **Insufficient Evidence** (no verified evidence rows) —
  and **no verified category**: the 69.38 is a provisional figure
  only, because the evidence condition for verification fails.
- Recruiter chip renders "Provisional 69 · Insufficient Evidence" —
  never "L3 Job Ready · Insufficient Evidence".

The example shows the blend working as designed: a strong coding
score lifts the provisional figure even with a weak interview, but
the missing evidence is stated on the chip rather than hidden — and
no band is presented as verified until every mandatory condition
holds.
