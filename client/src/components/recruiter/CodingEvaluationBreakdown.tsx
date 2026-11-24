"use client";

import { ScoreBar, prettyKey } from "@/components/assessment/shared";
import type { EvaluationReport } from "@/lib/api";

// Phase F — recruiter coding evaluation breakdown. The practical-task
// evaluation for one assessment, from the recruiter monitoring report:
// overall score plus the five fixed dimensions (functional 30%,
// quality 20%, problem-solving 20%, understanding 15%, testing 15% —
// the same weights the evaluation page shows the candidate). Functional
// comes only from executed tests; the qualitative method (live LLM vs
// deterministic heuristic) is labelled honestly. Nothing here is a
// hiring decision; recruiters decide.

const CATEGORY_WEIGHTS: Record<string, string> = {
  functional: "30%",
  quality: "20%",
  problemSolving: "20%",
  understanding: "15%",
  testing: "15%",
};

export function CodingEvaluationBreakdown({ evaluation }: { evaluation: EvaluationReport }) {
  const categoryKeys = Object.keys(evaluation.categoryScores);
  return (
    <section className="st-panel" aria-label="Coding evaluation breakdown">
      <div className="st-panel-head">
        <div>
          <h2>Coding evaluation — practical task</h2>
          <p className="st-panel-desc">
            The coding-task evaluation for this assessment. Functional is
            scored only from executed tests.
            {evaluation.qualitativeMethod === "llm"
              ? " Qualitative notes are from the live AI evaluator."
              : " Qualitative notes are from the deterministic heuristic evaluator (no live AI connected)."}
          </p>
        </div>
        <span className="as-score-num">
          {evaluation.overallScore === null ? "—" : Math.round(evaluation.overallScore)}
          <small> / 100</small>
        </span>
      </div>

      <div className="st-stack" style={{ marginTop: 14, gap: 12 }}>
        {categoryKeys.map((key) => (
          <ScoreBar
            key={key}
            label={`${prettyKey(key)}${CATEGORY_WEIGHTS[key] ? ` (${CATEGORY_WEIGHTS[key]})` : ""}`}
            score={evaluation.categoryScores[key]}
          />
        ))}
      </div>

      <div className="st-kv" style={{ marginTop: 16 }}>
        <div className="st-kv-row">
          <span>Tests passed</span>
          <strong>
            {evaluation.passedTests.length === 0
              ? "None recorded"
              : `${evaluation.passedTests.length} passed`}
          </strong>
        </div>
        <div className="st-kv-row">
          <span>Tests failed</span>
          <strong>
            {evaluation.failedTests.length === 0
              ? "None recorded"
              : `${evaluation.failedTests.length} failed`}
          </strong>
        </div>
        <div className="st-kv-row">
          <span>Human review recommended</span>
          <strong>{evaluation.humanReviewRecommended ? "Yes" : "No"}</strong>
        </div>
        <div className="st-kv-row">
          <span>Confidence</span>
          <strong>{Math.round(evaluation.confidence * 100)}%</strong>
        </div>
      </div>

      {evaluation.strengths.length > 0 ? (
        <>
          <h3 style={{ marginTop: 18 }}>Strengths</h3>
          <ul className="as-list" style={{ marginTop: 8 }}>
            {evaluation.strengths.map((s, i) => (
              <li key={i}>{s}</li>
            ))}
          </ul>
        </>
      ) : null}
      {evaluation.weaknesses.length > 0 ? (
        <>
          <h3 style={{ marginTop: 18 }}>Weaknesses</h3>
          <ul className="as-list" style={{ marginTop: 8 }}>
            {evaluation.weaknesses.map((w, i) => (
              <li key={i} className="bad">{w}</li>
            ))}
          </ul>
        </>
      ) : null}
      {evaluation.qualityIssues.length > 0 ? (
        <>
          <h3 style={{ marginTop: 18 }}>Quality issues</h3>
          <ul className="as-list" style={{ marginTop: 8 }}>
            {evaluation.qualityIssues.map((q, i) => (
              <li key={i}>{q}</li>
            ))}
          </ul>
        </>
      ) : null}
    </section>
  );
}
