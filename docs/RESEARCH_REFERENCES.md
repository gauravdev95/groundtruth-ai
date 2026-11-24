# GroundTruth AI — research references

**Date:** 24 November 2026 (competency directive, Phase G).

> **Read this first.** The references below are **design guidance
> only**. They informed the shape of the interview and the competency
> model — structured questions, multiple evidence sources, transparent
> scoring — but they do **not** validate this product's bands, weights
> or cut scores. Every band, weight and threshold in
> `docs/SCORING_METHODOLOGY.md` and `docs/COMPETENCY_FRAMEWORK.md` is
> an **initial configurable hypothesis**. No scientific-validation claim
> is made for this system. The validation plan at the end of this doc
> describes what would be needed before any such claim.

## References (verified 24 Nov 2026)

### Structured interviewing

- **Campion, M. A., Pursell, E. D., & Brown, B. K. (1988).**
  Structured interviewing: Raising the psychometric properties of the
  employment interview. *Personnel Psychology, 41*(1), 25–42.
  Design guidance used: standardised questions asked of every
  candidate, anchored rating scales, and trained/consistent scoring
  raise the interview's psychometric quality. GroundTruth's interview
  follows this by pre-generating the same 7-question structure per
  role, scoring every answer on the same five dimensions, and freezing
  the questions before the session starts.
- **Levashina, J., Hartwell, C. J., Morgeson, F. P., & Campion,
  M. A. (2014).** The structured employment interview: Narrative and
  quantitative review of the research literature. *Personnel
  Psychology, 67*, 241–293.
  Design guidance used: structured interviews outperform unstructured
  ones on reliability and validity; question job-relatedness and
  consistent probing matter. GroundTruth's follow-up rule (one
  follow-up, only for Partial answers, generated from the missed
  expected points) is a bounded form of structured probing.
- **Sackett, P. R., Zhang, C., Berry, C. M., & Lievens, F. (2022).**
  Revisiting meta-analytic estimates of validity in personnel
  selection. *Journal of Applied Psychology, 107*(11).
  Structured interviews .42 (highest single predictor in the update),
  work samples .33, general mental ability .31, unstructured
  interviews .19. Also **Berry, C. M., Lievens, F., Zhang, C., &
  Sackett, P. R. (2024)**: composite validity .61 with a structured
  interview vs .51 without.
  Design guidance used: combining predictors beats any single one —
  the competency blend (coding 50 / interview 30 / evidence 20) is a
  multi-predictor composite in this spirit. The numbers are **not**
  imported as claims about GroundTruth's own validity.
- **Schmidt, F. L., & Hunter, J. E. (1998).** The validity and utility
  of selection methods in personnel psychology. *Psychological
  Bulletin, 124*(2), 262–274.
  Work samples .54, general mental ability .51, structured interviews
  .51; GMA + work sample .63, GMA + structured interview .63.
  Design guidance used: the same multi-predictor logic — the coding
  Lab (a work-sample analogue) plus the structured interview is the
  strongest pairing in this literature, which is why the blend weights
  coding most heavily.

### LLM scoring of interviews

- **Stockdale, K., Hickman, L., & Liu, S. (2026).** Scoring employment
  interviews with large language models: Evaluation design components,
  validity investigations, and best practice recommendations. *Journal
  of Applied Psychology*, advance online publication.
  DOI: 10.1037/apl0001396.
  Design guidance used: ensembles of larger/newer LLMs with detailed
  construct prompts hold potential for interview scoring, **with
  explicit caution for high-stakes use**. GroundTruth's design answers
  that caution directly: deterministic mock scoring is labelled as
  mock, live-AI failure leaves an answer unscored rather than
  fabricating a score, every dimension score is stored and auditable,
  and the report is a structured summary for a human recruiter — not
  an automated hiring decision.

### Work-sample testing

- **Callinan, M., & Robertson, I. T. (2000).** Work Sample Testing.
  *International Journal of Selection and Assessment.*
  Design guidance used: work samples should be classified by fidelity
  to the real job. GroundTruth's coding Lab (a real task on the
  candidate's own project, hidden tests, sandboxed execution) is a
  higher-fidelity work sample than a quiz; the competency model treats
  it as the strongest single source (50% of the blend) for that reason.

### GitHub-supported evidence

- **Vaishampayan, S., Gulzar, M. A., & Brown, C. (2025).** Improving
  Evidence-Based Tech Hiring with GitHub-Supported Resume Matching.
  *IEEE SANER 2025.* (GitMeter tool.)
  Design guidance used: public GitHub evidence (repos, commits,
  languages) can ground resume claims in verifiable artefacts.
  GroundTruth's evidence source (repo analysis, verified skills,
  coding-platform profiles) follows the same principle: claims must
  trace to an artefact, and the competency profile records which
  source each score came from.

### Competency / occupation taxonomies

- **O*NET Database 30.3** (U.S. Department of Labor / Employment and
  Training Administration), occupation **Software Developers
  15-1252.00** — tasks, skills, knowledge, abilities.
  Design guidance used: the competency lists were cross-checked
  against O*NET's task/skill inventory for software developers so the
  seven roles and their five competencies each stay recognisably
  job-related rather than invented from scratch. O*NET is a US
  occupational taxonomy; it was used as a sanity check, not as the
  source of the weights.

## What was NOT verified (do not cite)

- "Stuart, Kaneko & Baldwin" — no source was found for this citation
  in the 24 Nov 2026 search; it must not be cited anywhere in this
  repo.
- Any "interview validity meta-analysis 2024" as a standalone source —
  the relevant recent work is Sackett et al. (2022) and Berry et al.
  (2024), cited above.

## Future validation plan

Before any claim that the bands, weights or cut scores are validated,
the following would be needed (none of it is done yet):

1. **Inter-rater / inter-model reliability:** score the same answers
   with the live LLM and with independent human raters; report
   agreement per dimension (e.g. intraclass correlation), not just a
   single overall number.
2. **Recruiter agreement:** compare the system's band (L1–L4) against
   recruiters' own assessments of the same candidates, blind to the
   system's score; report agreement and the cases where they disagree.
3. **Criterion validity:** track hired candidates' job performance
   (probation outcomes, manager ratings, first-year retention) and
   test whether higher overall / per-competency scores predict better
   outcomes. This needs real hiring data over months, not a local test
   run.
4. **Adverse-impact check:** test whether scores differ systematically
   by protected group once real candidate data exists; publish the
   check, not just the headline number.
5. **Threshold calibration:** only after (1)–(4), re-fit the band
   boundaries and blend weights on real data, and version the
   framework (v1.1.0+) with the evidence attached. Until then the
   current numbers stay labelled as initial hypotheses.
