"use client";

import { useCallback, useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { RefreshCw } from "lucide-react";
import { RequireAuth } from "@/components/auth/RequireAuth";
import { StudentPageHead, StudentShell } from "@/components/student/StudentShell";
import {
  BackToHub,
  ErrorState,
  InlineError,
  LoadingState,
  ScoreBar,
  prettyKey,
} from "@/components/assessment/shared";
import {
  evaluateAssessment,
  fetchAssessment,
  fetchEvaluation,
  type EvaluationReport,
} from "@/lib/api";

const CATEGORY_WEIGHTS: Record<string, string> = {
  functional: "30%",
  quality: "20%",
  problemSolving: "20%",
  understanding: "15%",
  testing: "15%",
};

function EvaluationContent() {
  const params = useParams<{ id: string }>();
  const id = params.id;
  const [report, setReport] = useState<EvaluationReport | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const [runError, setRunError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [a, e] = await Promise.all([
        fetchAssessment(id),
        fetchEvaluation(id).catch(() => null),
      ]);
      setStatus(a.status);
      setReport(e);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load the evaluation.");
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    load();
  }, [load]);

  async function onEvaluate() {
    setRunning(true);
    setRunError(null);
    try {
      const r = await evaluateAssessment(id);
      setReport(r);
      const a = await fetchAssessment(id);
      setStatus(a.status);
    } catch (err) {
      setRunError(err instanceof Error ? err.message : "Evaluation failed.");
    } finally {
      setRunning(false);
    }
  }

  if (loading) return <LoadingState text="Loading your evaluation…" />;
  if (error) {
    return <ErrorState message={error} onRetry={load} />;
  }

  return (
    <div className="st-stack">
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
        <button
          type="button"
          className="st-btn st-btn-blue"
          onClick={onEvaluate}
          disabled={running}
        >
          <RefreshCw size={16} aria-hidden="true" />
          {running ? "Evaluating…" : report ? "Re-run evaluation" : "Run evaluation"}
        </button>
        <Link href={`/assessment/${id}/interview`} className="st-btn st-btn-outline">
          Go to AI interview
        </Link>
        <Link href={`/assessment/${id}/competency`} className="st-btn st-btn-outline">
          Competency profile
        </Link>
      </div>
      {runError ? <InlineError message={runError} /> : null}

      {report === null ? (
        <section className="st-panel" aria-label="No evaluation yet">
          <h2>No evaluation yet</h2>
          <p className="st-panel-desc">
            {status === "submitted" || status === "evaluating" || status === "completed"
              ? "Your assessment is submitted. Run the evaluation to score the solution against the visible and hidden tests, code quality and the qualitative rubric."
              : `This assessment is ${status ?? "not submitted"} — submit it from the Lab first, then run the evaluation here.`}
          </p>
          <p style={{ marginTop: 14 }}>
            <Link href={`/assessment/${id}/lab`} className="st-btn st-btn-outline st-btn-sm">
              Open the Lab
            </Link>
          </p>
        </section>
      ) : (
        <>
          <section className="st-panel" aria-label="Overall score">
            <div className="st-panel-head">
              <div>
                <h2>Overall score</h2>
                <p className="st-panel-desc">
                  Qualitative method:{" "}
                  <strong style={{ color: "var(--ink)" }}>
                    {report.qualitativeMethod === "llm"
                      ? "LLM-judged"
                      : "Deterministic heuristic (no LLM was available)"}
                  </strong>
                  {report.aiAvailable ? " · AI was available" : " · AI was not available"}
                  {" · "}Confidence {Math.round(report.confidence * 100)}%
                </p>
              </div>
              <span className="as-score-num">
                {report.overallScore === null ? "—" : Math.round(report.overallScore)}
                <small> / 100</small>
              </span>
            </div>
            {report.overallScore === null ? (
              <p className="st-panel-desc">The evaluation did not produce an overall score.</p>
            ) : null}
            {report.humanReviewRecommended ? (
              <div className="as-alert as-alert-warn" style={{ marginTop: 14 }}>
                <strong>Human review recommended.</strong> The evaluation flags
                this submission for a human reviewer — the score above is not
                the final word.
              </div>
            ) : null}
            <div className="st-grid st-grid-2" style={{ marginTop: 20 }}>
              {Object.entries(report.categoryScores).map(([key, value]) => (
                <ScoreBar
                  key={key}
                  label={`${prettyKey(key)}${CATEGORY_WEIGHTS[key] ? ` (${CATEGORY_WEIGHTS[key]})` : ""}`}
                  score={value}
                />
              ))}
            </div>
          </section>

          <section className="st-panel" aria-label="Tests">
            <h2>Tests</h2>
            <div className="st-grid st-grid-2" style={{ marginTop: 14 }}>
              <div>
                <h3 style={{ color: "#166534" }}>Passed ({report.passedTests.length})</h3>
                {report.passedTests.length === 0 ? (
                  <p className="st-panel-desc" style={{ marginTop: 6 }}>No tests passed.</p>
                ) : (
                  <ul className="as-list">
                    {report.passedTests.map((t) => (
                      <li key={t}>{t}</li>
                    ))}
                  </ul>
                )}
              </div>
              <div>
                <h3 style={{ color: "#991b1b" }}>Failed ({report.failedTests.length})</h3>
                {report.failedTests.length === 0 ? (
                  <p className="st-panel-desc" style={{ marginTop: 6 }}>No tests failed.</p>
                ) : (
                  <ul className="as-list">
                    {report.failedTests.map((t) => (
                      <li key={t} className="bad">{t}</li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
          </section>

          {report.qualityIssues.length > 0 ? (
            <section className="st-panel" aria-label="Quality issues">
              <h2>Quality issues</h2>
              <ul className="as-list">
                {report.qualityIssues.map((q, i) => (
                  <li key={i} className="bad">{q}</li>
                ))}
              </ul>
            </section>
          ) : null}

          {report.securityFindings.length > 0 ? (
            <section className="st-panel" aria-label="Security findings">
              <h2>Security findings</h2>
              <ul className="as-list">
                {report.securityFindings.map((s, i) => (
                  <li key={i} className="bad">{s}</li>
                ))}
              </ul>
            </section>
          ) : null}

          <div className="st-grid st-grid-2">
            <section className="st-panel" aria-label="Strengths">
              <h2>Strengths</h2>
              {report.strengths.length === 0 ? (
                <p className="st-panel-desc" style={{ marginTop: 8 }}>None recorded.</p>
              ) : (
                <ul className="as-list">
                  {report.strengths.map((s, i) => (
                    <li key={i}>{s}</li>
                  ))}
                </ul>
              )}
            </section>
            <section className="st-panel" aria-label="Weaknesses">
              <h2>Weaknesses</h2>
              {report.weaknesses.length === 0 ? (
                <p className="st-panel-desc" style={{ marginTop: 8 }}>None recorded.</p>
              ) : (
                <ul className="as-list">
                  {report.weaknesses.map((w, i) => (
                    <li key={i} className="bad">{w}</li>
                  ))}
                </ul>
              )}
            </section>
          </div>

          {report.improvements.length > 0 ? (
            <section className="st-panel" aria-label="Improvements">
              <h2>Suggested improvements</h2>
              <ul className="as-list">
                {report.improvements.map((s, i) => (
                  <li key={i}>{s}</li>
                ))}
              </ul>
            </section>
          ) : null}

          {Object.keys(report.evidence ?? {}).length > 0 ? (
            <section className="st-panel" aria-label="Evidence">
              <h2>Evidence</h2>
              <pre className="as-pre light">{JSON.stringify(report.evidence, null, 2)}</pre>
            </section>
          ) : null}
        </>
      )}

      <div>
        <BackToHub />
      </div>
    </div>
  );
}

export default function AssessmentEvaluationPage() {
  return (
    <RequireAuth roles={["candidate"]}>
      <StudentShell>
        <StudentPageHead
          eyebrow="Evaluation Report"
          title={<>How your solution <span className="blue">scored</span></>}
          sub="Overall and category scores, passed and failed tests, quality and security findings — with the qualitative method shown honestly."
        />
        <EvaluationContent />
      </StudentShell>
    </RequireAuth>
  );
}
