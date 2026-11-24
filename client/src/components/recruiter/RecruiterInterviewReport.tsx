"use client";

import { InterviewCoverageNote, ScoreBar, prettyKey } from "@/components/assessment/shared";
import type { SessionInterviewReport } from "@/lib/api";

// Phase F — recruiter interview breakdown. The candidate's completed AI
// technical interview, shown to an authorized recruiter (application
// ownership gate, enforced server-side): final score, per-dimension
// averages, per-competency scores, strengths / knowledge gaps / learning
// areas, and the per-question breakdown with the candidate's answers
// (original + follow-up where present), scores and evaluator feedback.
//
// Scores are shown exactly as the server stored them. When the interview
// was scored by the deterministic demo evaluator (no live AI connected)
// that is labelled mock — never presented as live AI results. This view
// makes no hiring decision; recruiters decide.

const CATEGORY_LABELS: Record<string, string> = {
  project_understanding: "A · Project understanding",
  architecture_design: "B · Architecture & design",
  code_changes: "C · Code changes",
  fundamentals: "D · Fundamentals",
  debugging: "E · Debugging",
  security_performance: "F · Security & performance",
  testing_edge_cases: "G · Testing & edge cases",
  follow_up: "H · Follow-up",
};

const DIMENSION_LABELS: Record<string, string> = {
  technicalCorrectness: "Technical correctness",
  depthOfUnderstanding: "Depth of understanding",
  relevance: "Relevance",
  projectEvidence: "Project / code evidence",
  communicationClarity: "Communication & clarity",
};

const DIMENSION_WEIGHTS: Record<string, number> = {
  technicalCorrectness: 30,
  depthOfUnderstanding: 25,
  relevance: 15,
  projectEvidence: 15,
  communicationClarity: 15,
};

function categoryLabel(category: string): string {
  return CATEGORY_LABELS[category] ?? prettyKey(category);
}

function dimensionLabel(key: string): string {
  return DIMENSION_LABELS[key] ?? prettyKey(key);
}

function fmtSeconds(seconds: number | null): string {
  if (seconds === null || seconds === undefined) return "—";
  if (seconds < 60) return `${seconds}s`;
  const s = Math.max(0, Math.round(seconds));
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${String(m).padStart(2, "0")}:${String(r).padStart(2, "0")}`;
}

export function RecruiterInterviewReport({ report }: { report: SessionInterviewReport }) {
  const mockUsed = report.perQuestion.some((p) => {
    const ev = p.evaluation as { provider?: string; method?: string } | null;
    return ev?.provider === "mock" || ev?.method === "deterministic";
  });
  const dimensionKeys = Object.keys(report.dimensionAverages);

  return (
    <section className="st-panel" aria-label="Interview breakdown">
      <div className="st-panel-head">
        <div>
          <h2>Interview breakdown</h2>
          <p className="st-panel-desc">
            AI technical interview score (separate from the coding score)
            {report.roleId && report.roleId !== "unknown" ? ` · Role: ${prettyKey(report.roleId)}` : ""}
            {report.frameworkVersion ? ` · Framework ${report.frameworkVersion}` : ""}
          </p>
        </div>
        <span className="as-score-num">
          {report.finalScore === null ? "—" : Math.round(report.finalScore)}
          <small> / 100</small>
        </span>
      </div>

      {mockUsed ? (
        <div className="as-alert as-alert-warn" role="note" style={{ marginTop: 12 }}>
          <strong>AI-assisted (mock/demo).</strong> These scores were computed by the
          deterministic demo evaluator because no live AI is connected — they are labelled
          mock, never presented as live AI results.
        </div>
      ) : null}
      {report.pendingEvaluations > 0 ? (
        <div className="as-alert as-alert-warn" role="note" style={{ marginTop: 12 }}>
          <strong>{report.pendingEvaluations} answer(s) still pending evaluation.</strong> The
          AI evaluation failed for them and no score was substituted — the report will change
          once they are evaluated.
        </div>
      ) : null}
      <InterviewCoverageNote report={report} />

      <h3 style={{ marginTop: 18 }}>Scoring dimensions</h3>
      <div className="st-stack" style={{ marginTop: 10, gap: 12 }}>
        {dimensionKeys.map((key) => (
          <ScoreBar
            key={key}
            label={`${dimensionLabel(key)} (${DIMENSION_WEIGHTS[key] ?? "?"}%)`}
            score={report.dimensionAverages[key]}
          />
        ))}
      </div>

      {report.competencyScores.length > 0 ? (
        <>
          <h3 style={{ marginTop: 18 }}>Competency scores</h3>
          <div className="st-stack" style={{ marginTop: 10, gap: 12 }}>
            {report.competencyScores.map((c) => (
              <div key={c.competencyId}>
                <ScoreBar
                  label={c.competencyName ?? prettyKey(c.competencyId)}
                  score={c.score}
                  hint={
                    c.category
                      ? `Interview-only band (provisional): ${c.category} · ${c.questionsAnswered} question(s) answered`
                      : `${c.questionsAnswered} question(s) answered`
                  }
                />
              </div>
            ))}
          </div>
        </>
      ) : null}

      <div className="st-grid st-grid-2" style={{ marginTop: 18 }}>
        <div>
          <h3>Strengths</h3>
          {report.strengths.length === 0 ? (
            <p className="st-panel-desc" style={{ marginTop: 6 }}>None recorded.</p>
          ) : (
            <ul className="as-list">
              {report.strengths.map((s, i) => (
                <li key={i}>{s}</li>
              ))}
            </ul>
          )}
        </div>
        <div>
          <h3>Knowledge gaps</h3>
          {report.knowledgeGaps.length === 0 ? (
            <p className="st-panel-desc" style={{ marginTop: 6 }}>None recorded.</p>
          ) : (
            <ul className="as-list">
              {report.knowledgeGaps.map((g, i) => (
                <li key={i} className="bad">{g}</li>
              ))}
            </ul>
          )}
        </div>
      </div>

      {report.learningAreas.length > 0 ? (
        <>
          <h3 style={{ marginTop: 18 }}>Learning areas</h3>
          <div className="st-chip-row" style={{ marginTop: 8 }}>
            {report.learningAreas.map((a) => (
              <span key={a} className="st-chip st-chip-amber">{a}</span>
            ))}
          </div>
        </>
      ) : null}

      <p className="st-panel-desc" style={{ marginTop: 16 }}>
        Time: {report.timing.totalSeconds !== null ? fmtSeconds(report.timing.totalSeconds) : "—"}
        {` · Follow-ups used: ${report.followUpsUsed} of 1`}
        {report.generatedAt ? ` · Report generated ${new Date(report.generatedAt).toLocaleString("en-IN", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" })}` : ""}
      </p>

      <h3 style={{ marginTop: 18 }}>Per-question scores &amp; feedback</h3>
      <div className="st-list" style={{ marginTop: 10 }}>
        {report.perQuestion.map((p) => {
          const ev = p.evaluation as {
            notes?: string;
            provider?: string;
            method?: string;
            dimensions?: Record<string, number | null>;
          } | null;
          return (
            <article key={p.questionId} className="st-list-item">
              <div>
                <h3>{p.question}</h3>
                <p className="st-list-meta">
                  {categoryLabel(p.category)}
                  {p.competencyName ? ` · ${p.competencyName}` : ""}
                  {p.difficulty ? ` · ${prettyKey(p.difficulty)}` : ""}
                  {` · Score: ${p.score === null ? "—" : Math.round(p.score)}`}
                  {p.status === "unanswered" ? " · Not answered" : ""}
                  {p.status === "pending_evaluation" ? " · Evaluation pending" : ""}
                  {p.timeSpentSeconds !== null ? ` · ${fmtSeconds(p.timeSpentSeconds)}` : ""}
                </p>
                {ev?.notes ? (
                  <p className="st-list-meta">
                    <strong style={{ color: "var(--ink)" }}>Feedback: </strong>
                    {ev.notes}
                  </p>
                ) : null}
                {ev?.dimensions ? (
                  <p className="st-list-meta">
                    {Object.entries(ev.dimensions)
                      .map(([k, v]) => `${dimensionLabel(k)} ${v === null ? "—" : Math.round(v)}`)
                      .join(" · ")}
                  </p>
                ) : null}
                {p.originalAnswer ? (
                  <p className="st-list-meta">
                    <strong style={{ color: "var(--ink)" }}>Candidate&apos;s answer: </strong>
                    {p.originalAnswer}
                  </p>
                ) : null}
                {p.followUp ? (
                  <p className="st-list-meta" style={{ marginTop: 8 }}>
                    <strong style={{ color: "var(--ink)" }}>Follow-up: </strong>
                    {p.followUp.question}
                    {p.followUp.answer ? (
                      <>
                        <br />
                        <strong style={{ color: "var(--ink)" }}>Candidate&apos;s follow-up answer: </strong>
                        {p.followUp.answer}
                        {` · Score: ${p.followUp.score === null ? "—" : Math.round(p.followUp.score)}`}
                      </>
                    ) : (
                      " · Not answered"
                    )}
                  </p>
                ) : null}
              </div>
            </article>
          );
        })}
      </div>
    </section>
  );
}
