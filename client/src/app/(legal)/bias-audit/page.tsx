import type { Metadata } from "next";
import { LegalShell } from "../LegalShell";

export const metadata: Metadata = {
  title: "Bias Audit — GroundTruth AI",
  description:
    "How GroundTruth AI audits its matching and assessment systems for bias, and what the limits are.",
};

export default function BiasAuditPage() {
  return (
    <LegalShell
      eyebrow="Legal · Fairness"
      title="Bias Audit"
      updated="Last updated: 18 November 2026"
      current="/bias-audit"
    >
      <p>
        GroundTruth AI uses AI to score matches and evaluate assessments. AI
        can be wrong, and it can be unfair. This page states honestly what the
        systems do, what they do not do, and how we check them — so that a
        candidate is never silently filtered out by a number nobody can
        explain.
      </p>

      <h2>1. What the AI actually decides — and what it does not</h2>
      <ul>
        <li>
          <strong>Match scores</strong> are cosine similarities between text
          embeddings of a candidate profile and a job description. They rank
          and sort; they never reject an application on their own. Every
          application reaches the recruiter.
        </li>
        <li>
          <strong>Assessment evaluation</strong> runs a candidate&apos;s code
          against visible and hidden tests and scores it on functional
          correctness, quality and security. The report shows the evidence
          (which tests passed and failed) alongside the score.
        </li>
        <li>
          <strong>AI interviews</strong> are scored against a rubric for each
          question category, with the transcript kept so the score can be
          reviewed.
        </li>
        <li>
          <strong>No fully automated hiring decisions.</strong> No candidate
          is hired or rejected by AI alone. Recruiters make the decisions;
          AI output is advisory evidence.
        </li>
      </ul>

      <h2>2. What we audit</h2>
      <p>We review the systems for the following, on a regular basis:</p>
      <ul>
        <li>
          <strong>Score distribution by group:</strong> whether match scores
          and assessment scores differ systematically by gender, college,
          location or other attributes that should not matter. A difference
          is investigated, not ignored.
        </li>
        <li>
          <strong>Evidence grounding:</strong> whether a &ldquo;verified&rdquo;
          skill is backed by a real assessment, repository or certificate —
          never by an unverified claim.
        </li>
        <li>
          <strong>Missing-data behaviour:</strong> candidates without a
          stored embedding or score are shown as &ldquo;no score yet&rdquo;,
          never as a zero or a fabricated number.
        </li>
        <li>
          <strong>Monitoring fairness:</strong> assessment monitoring records
          the same events for every candidate; flags are based on recorded
          behaviour, not on who the candidate is.
        </li>
      </ul>

      <h2>3. Known limitations — stated plainly</h2>
      <ul>
        <li>
          Embeddings are trained on large text corpora and can carry the
          biases in that text. A match score can under-rate a candidate whose
          profile uses different wording from the job description.
        </li>
        <li>
          Automated code evaluation cannot judge creativity, communication or
          teamwork; it measures what the tests measure.
        </li>
        <li>
          Audit coverage is limited by the data we have. Small groups can
          hide real disparities, and a clean audit is not proof that no bias
          exists.
        </li>
      </ul>

      <h2>4. What you can do if you think the system was unfair</h2>
      <ul>
        <li>
          Candidates can see their own scores, match results and assessment
          reports, including the underlying evidence.
        </li>
        <li>
          If you believe a score or a verification is wrong, contact us
          through the <a href="/contact">contact form</a> with the
          application or assessment details. A human reviews the evidence;
          the AI score is not treated as final.
        </li>
        <li>
          Recruiters are expected to review the evidence, not just the
          number, before deciding.
        </li>
      </ul>

      <h2>5. Audit cadence</h2>
      <p>
        We aim to repeat the checks in section 2 at least once per quarter
        and after any material change to the matching or evaluation models,
        and to publish a summary of the findings here. The first full audit
        summary will be published once the platform has enough assessment
        volume to make the statistics meaningful; until then, this page is
        the honest statement of the method and the limits above.
      </p>
    </LegalShell>
  );
}
