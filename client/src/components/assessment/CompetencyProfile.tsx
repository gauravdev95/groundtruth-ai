"use client";

import { ScoreBar, prettyKey } from "@/components/assessment/shared";
import {
  formatDateTime,
  type CompetencyProfileView,
} from "@/lib/api";

/**
 * Final competency profile view (Phase E) — shared by the candidate
 * competency page and (Phase F) the recruiter evidence view. Shows the
 * stored profile exactly as the server computed it, with the
 * provisional-vs-verified distinction kept visible everywhere:
 *  - the big number is always labelled Provisional Score or Verified
 *    Score — a number never implies verification by itself;
 *  - "Verified Competency Category" appears ONLY when the server
 *    assigned a verified category (all mandatory conditions held);
 *  - otherwise the profile shows its status ("Assessment Incomplete",
 *    "Insufficient Evidence", "Practical Threshold Not Met",
 *    "Not Assessed") and, when one exists, its provisional band
 *    explicitly marked Provisional;
 *  - a partial interview shows its coverage ("provisional — 6 of 7
 *    questions scored") next to the interview score.
 * The profile never makes a hiring decision; recruiters decide.
 */
export function CompetencyProfileView({ profile }: { profile: CompetencyProfileView }) {
  const verified = profile.verifiedCategory !== null;
  const categoryDesc =
    verified && profile.frameworkSnapshot
      ? profile.frameworkSnapshot.categories.find((c) => c.id === profile.verifiedCategory)
          ?.description ?? null
      : null;
  const provisionalDesc =
    !verified && profile.provisionalCategory && profile.frameworkSnapshot
      ? profile.frameworkSnapshot.categories.find((c) => c.id === profile.provisionalCategory)
          ?.description ?? null
      : null;
  const weights = profile.frameworkSnapshot?.componentWeights ?? {
    coding: 0.5,
    interview: 0.3,
    evidence: 0.2,
  };

  return (
    <div className="st-stack">
      <section className="st-panel" aria-label="Final competency profile">
        <div className="st-panel-head">
          <div>
            <h2>Competency profile — {profile.roleName}</h2>
            <p className="st-panel-desc">
              {verified ? "Final assessment result" : "Provisional result"} · Framework {profile.frameworkVersion}
              {profile.roleResolvedFrom === "interview"
                ? " · Role from your completed interview"
                : ""}
              {" · "}Computed {formatDateTime(profile.computedAt)}
            </p>
          </div>
          <span className="as-score-num">
            {profile.overallScore === null ? "—" : Math.round(profile.overallScore)}
            <small> / 100</small>
          </span>
        </div>
        <p className="st-panel-desc" style={{ marginTop: 4 }}>
          {verified ? "Verified score" : "Provisional score"}
        </p>

        <p style={{ marginTop: 12, display: "flex", gap: 8, flexWrap: "wrap" }}>
          <span
            className={`st-chip ${verified ? "st-chip-green" : "st-chip-amber"}`}
            style={{ fontSize: 13, padding: "6px 12px" }}
          >
            {profile.statusLabel}
          </span>
          {verified ? (
            <span
              className="st-chip st-chip-green"
              style={{ fontSize: 13, padding: "6px 12px" }}
            >
              Verified Competency Category · {profile.verifiedCategory}
              {profile.verifiedCategoryLabel ? ` ${profile.verifiedCategoryLabel}` : ""}
            </span>
          ) : profile.provisionalCategoryLabel ? (
            <span
              className="st-chip st-chip-amber"
              style={{ fontSize: 13, padding: "6px 12px" }}
            >
              Provisional · {profile.provisionalCategory}
              {` ${profile.provisionalCategoryLabel}`}
            </span>
          ) : null}
        </p>
        {categoryDesc ? (
          <p className="st-panel-desc" style={{ marginTop: 10 }}>{categoryDesc}</p>
        ) : null}
        {!verified && provisionalDesc ? (
          <p className="st-panel-desc" style={{ marginTop: 10 }}>
            Provisional band — {provisionalDesc} This is a working figure
            from the sources present so far, not a verified result.
          </p>
        ) : null}

        {!profile.isFinal ? (
          <div className="as-alert as-alert-warn" role="note" style={{ marginTop: 12 }}>
            <strong>Provisional — not a final result.</strong> This profile is{" "}
            {profile.statusLabel.toLowerCase()}; there is no verified
            competency category yet — the score above is provisional,
            computed from the sources present so far. Complete the coding
            evaluation, the AI interview and the verified evidence first,
            then recompute.
            {profile.interviewCoverage && !profile.interviewCoverage.complete
              ? ` Interview: ${profile.interviewCoverage.provisionalNote ?? "incomplete"}.`
              : ""}
          </div>
        ) : null}
        {profile.status === "Practical Threshold Not Met" ? (
          <div className="as-alert as-alert-warn" role="note" style={{ marginTop: 12 }}>
            <strong>Practical threshold not met.</strong> The coding component is
            below the practical minimum (
            {profile.frameworkSnapshot?.practicalMinimumCodingScore ?? 40}), so Job
            Ready / Strong are blocked and there is no verified category —
            the provisional band is capped at Developing (L2), however
            strong the interview and evidence are.
          </div>
        ) : null}
        {profile.notes.length > 0 ? (
          <ul style={{ marginTop: 12, paddingLeft: 20, color: "var(--muted)" }}>
            {profile.notes.map((n) => (
              <li key={n} style={{ fontSize: 13.5 }}>{n}</li>
            ))}
          </ul>
        ) : null}
      </section>

      <section className="st-panel" aria-label="Score breakdown">
        <div className="st-panel-head">
          <div>
            <h2>How the score is built</h2>
            <p className="st-panel-desc">
              {profile.formula} — coding, interview and verified evidence, each
              from its own real source. A missing source is never a silent zero.
            </p>
          </div>
        </div>
        <div className="st-stack" style={{ marginTop: 14 }}>
          <ScoreBar
            label={`Coding — practical task (${Math.round(weights.coding * 100)}%)`}
            score={profile.componentScores.coding}
            hint={
              profile.sources.evaluation
                ? `Evaluation overall ${profile.sources.evaluation.overallScore ?? "—"}`
                : "No completed evaluation yet"
            }
          />
          <ScoreBar
            label={`Interview — AI technical interview (${Math.round(weights.interview * 100)}%)`}
            score={profile.componentScores.interview}
            hint={
              profile.sources.interview
                ? `Interview final score ${profile.sources.interview.finalScore ?? "—"}${
                    profile.interviewCoverage && !profile.interviewCoverage.complete
                      ? ` — ${profile.interviewCoverage.provisionalNote ?? "incomplete"}`
                      : ""
                  }`
                : "No completed interview yet"
            }
          />
          <ScoreBar
            label={`Evidence — verified skills, projects, verifications (${Math.round(weights.evidence * 100)}%)`}
            score={profile.componentScores.evidence}
            hint={`${profile.sources.evidenceItems} evidence item(s) across all competencies`}
          />
        </div>
        <div className="st-grid st-grid-3" style={{ marginTop: 16 }}>
          <div>
            <p className="st-kv-label">Evidence coverage</p>
            <p style={{ fontWeight: 700 }}>{profile.evidenceCoveragePercent}% of competencies scored</p>
          </div>
          <div>
            <p className="st-kv-label">Confidence</p>
            <p style={{ fontWeight: 700 }}>{prettyKey(profile.confidence)}</p>
          </div>
          <div>
            <p className="st-kv-label">Formula version</p>
            <p style={{ fontWeight: 700 }}>v{profile.formulaVersion} · {profile.formula}</p>
          </div>
        </div>
      </section>

      <section className="st-panel" aria-label="Per-competency scores">
        <div className="st-panel-head">
          <div>
            <h2>Per-competency scores</h2>
            <p className="st-panel-desc">
              Each competency blends the same three sources. “Not Assessed” means
              no evidence exists for it — never a silent zero. A band marked
              (Verified) is a verified result; a band marked (Provisional) is
              a working figure from the sources present so far.
            </p>
          </div>
        </div>
        <div className="st-stack" style={{ marginTop: 14 }}>
          {profile.competencies.map((c) => {
            const refs =
              profile.evidenceReferences.find((r) => r.competencyId === c.competencyId)
                ?.items ?? [];
            return (
              <div key={c.competencyId}>
                <ScoreBar
                  label={`${c.competencyName} (${c.weight}%) — ${
                    c.verifiedCategoryLabel
                      ? `${c.verifiedCategoryLabel} (Verified)`
                      : c.categoryLabel
                        ? `${c.categoryLabel} (Provisional)`
                        : c.status
                  }`}
                  score={c.score}
                  hint={
                    c.status === "Assessed"
                      ? `Coding ${c.codingScore ?? "—"} · Interview ${c.interviewScore ?? "—"} · Evidence ${c.evidenceScore ?? "—"}`
                      : c.status === "Incomplete"
                        ? `Partial evidence — missing ${c.sourcesMissing.join(", ")}`
                        : c.status === "Insufficient Evidence"
                          ? `Only ${c.evidenceProvided} of ${c.evidenceRequired} evidence items`
                          : "No evidence from coding, interview or verified sources"
                  }
                />
                {refs.length > 0 ? (
                  <p className="st-panel-desc" style={{ marginTop: 6 }}>
                    Evidence: {refs.map((r) => r.label).join(" · ")}
                    {c.dedupedEvidenceIds.length > 0
                      ? ` — ${c.dedupedEvidenceIds.length} item(s) appeared in both coding and evidence sources and were counted once.`
                      : ""}
                  </p>
                ) : null}
                {c.notes.length > 0 && c.status !== "Assessed" ? (
                  <p className="st-panel-desc" style={{ marginTop: 4 }}>{c.notes.join(" ")}</p>
                ) : null}
              </div>
            );
          })}
        </div>
      </section>

      {profile.strengths.length > 0 ? (
        <section className="st-panel" aria-label="Strengths">
          <h2>Strengths</h2>
          <ul style={{ marginTop: 10, paddingLeft: 20 }}>
            {profile.strengths.map((s) => (
              <li key={s} style={{ fontSize: 14 }}>{s}</li>
            ))}
          </ul>
        </section>
      ) : null}

      {profile.improvementAreas.length > 0 ? (
        <section className="st-panel" aria-label="Improvement areas">
          <h2>Improvement areas</h2>
          <ul style={{ marginTop: 10, paddingLeft: 20 }}>
            {profile.improvementAreas.map((s) => (
              <li key={s} style={{ fontSize: 14 }}>{s}</li>
            ))}
          </ul>
        </section>
      ) : null}

      <p className="st-panel-desc">
        This profile is an assessment result only. It does not reject or hire
        anyone — recruiters decide. Scores come from the coding evaluation,
        the completed interview and independently verified evidence; nothing
        here is invented.
      </p>
    </div>
  );
}
