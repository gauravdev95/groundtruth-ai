"use client";

import { useCallback, useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { MessageSquareText, Send } from "lucide-react";
import { RequireAuth } from "@/components/auth/RequireAuth";
import { StudentPageHead, StudentShell } from "@/components/student/StudentShell";
import {
  BackToHub,
  ErrorState,
  InlineError,
  LoadingState,
  prettyKey,
} from "@/components/assessment/shared";
import {
  answerInterviewQuestion,
  fetchAssessment,
  fetchInterview,
  fetchInterviewReport,
  generateInterview,
  type AnswerResult,
  type InterviewQuestion,
  type InterviewReport,
  type InterviewRow,
} from "@/lib/api";

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

function categoryLabel(category: string): string {
  return CATEGORY_LABELS[category] ?? prettyKey(category);
}

function sortQuestions(qs: InterviewQuestion[]): InterviewQuestion[] {
  return [...qs].sort(
    (a, b) =>
      (a.question_order ?? a.order ?? 0) - (b.question_order ?? b.order ?? 0),
  );
}

function InterviewContent() {
  const params = useParams<{ id: string }>();
  const id = params.id;
  const [assessmentStatus, setAssessmentStatus] = useState<string | null>(null);
  const [interview, setInterview] = useState<InterviewRow | null>(null);
  const [questions, setQuestions] = useState<InterviewQuestion[]>([]);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [results, setResults] = useState<Record<string, AnswerResult>>({});
  const [report, setReport] = useState<InterviewReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [generating, setGenerating] = useState(false);
  const [genError, setGenError] = useState<string | null>(null);
  const [answering, setAnswering] = useState<string | null>(null);
  const [answerError, setAnswerError] = useState<string | null>(null);
  const [showReport, setShowReport] = useState(false);
  const [reportError, setReportError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const a = await fetchAssessment(id);
      setAssessmentStatus(a.status);
      // The interview only exists after the assessment is evaluated
      // (status "completed" — the server returns 409 before that). There is
      // no list endpoint, so loading uses POST /interview/generate, which the
      // server makes idempotent: it returns the existing interview and its
      // questions when one already exists, and creates it otherwise.
      if (a.status === "completed") {
        const { interview: iv, questions: qs } = await generateInterview(id);
        setInterview(iv);
        setQuestions(sortQuestions(qs));
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load the interview.");
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    load();
  }, [load]);

  async function onGenerate() {
    setGenerating(true);
    setGenError(null);
    try {
      const { interview: iv, questions: qs } = await generateInterview(id);
      setInterview(iv);
      setQuestions(sortQuestions(qs));
      setReport(null);
      setShowReport(false);
    } catch (err) {
      setGenError(err instanceof Error ? err.message : "Could not generate the interview.");
    } finally {
      setGenerating(false);
    }
  }

  async function onAnswer(q: InterviewQuestion) {
    const text = (answers[q.id] ?? "").trim();
    if (text.length < 5) {
      setAnswerError("Your answer needs at least 5 characters.");
      return;
    }
    if (!interview) return;
    setAnswering(q.id);
    setAnswerError(null);
    try {
      const res = await answerInterviewQuestion(interview.id, q.id, text);
      setResults((prev) => ({ ...prev, [q.id]: res }));
      if (res.followUp) {
        setQuestions((prev) =>
          sortQuestions([...prev.filter((x) => x.id !== res.followUp?.id), res.followUp as InterviewQuestion]),
        );
      }
    } catch (err) {
      setAnswerError(err instanceof Error ? err.message : "Could not submit your answer.");
    } finally {
      setAnswering(null);
    }
  }

  async function onViewReport() {
    if (!interview) return;
    setReportError(null);
    try {
      const r = await fetchInterviewReport(interview.id);
      setReport(r);
      setShowReport(true);
    } catch (err) {
      setReportError(err instanceof Error ? err.message : "Could not load the interview report.");
    }
  }

  if (loading) return <LoadingState text="Loading the interview…" />;
  if (error) {
    return <ErrorState message={error} onRetry={load} />;
  }

  const answeredCount = Object.keys(results).length;

  return (
    <div className="st-stack">
      <div className="as-alert as-alert-info">
        <strong>Text-based interview.</strong> There is no voice interview.
        Questions come from your own project, challenge and submitted code.
        The interview score is shown <strong>separate</strong> from your coding
        score.
      </div>

      {!interview ? (
        <section className="st-panel" aria-label="Interview not available yet">
          <h2>
            {assessmentStatus === "completed"
              ? "Could not load the interview"
              : "Interview unlocks after evaluation"}
          </h2>
          <p className="st-panel-desc">
            {assessmentStatus === "completed"
              ? "The assessment is evaluated, but the interview could not be loaded. Try again — the server returns your existing interview when one already exists."
              : `This assessment is ${assessmentStatus ?? "not finished"} — submit it in the Lab and run the evaluation first. The interview is generated only once the assessment is evaluated (status “completed”).`}
          </p>
          {genError ? <InlineError message={genError} /> : null}
          <p style={{ marginTop: 16, display: "flex", gap: 10, flexWrap: "wrap" }}>
            {assessmentStatus === "completed" ? (
              <button
                type="button"
                className="st-btn st-btn-blue"
                onClick={onGenerate}
                disabled={generating}
              >
                <MessageSquareText size={16} aria-hidden="true" />
                {generating ? "Loading interview…" : "Load interview"}
              </button>
            ) : (
              <Link href={`/assessment/${id}/evaluation`} className="st-btn st-btn-blue">
                Go to evaluation
              </Link>
            )}
            <Link href={`/assessment/${id}/lab`} className="st-btn st-btn-outline">
              Open the Lab
            </Link>
          </p>
        </section>
      ) : (
        <>
          <section className="st-panel" aria-label="Interview progress">
            <div className="st-panel-head">
              <div>
                <h2>Interview questions</h2>
                <p className="st-panel-desc">
                  Status: {interview.status}
                  {interview.score !== null ? ` · Interview score: ${interview.score}` : ""}
                  {" · "}{answeredCount} of {questions.length} answered
                  {" · "}Viewing the final report completes the interview, so
                  answer every question first.
                </p>
              </div>
              <button
                type="button"
                className="st-btn st-btn-outline st-btn-sm"
                onClick={onViewReport}
                disabled={answeredCount === 0}
              >
                Final report
              </button>
            </div>
          </section>

          {answerError ? <InlineError message={answerError} /> : null}
          {reportError ? <InlineError message={reportError} /> : null}

          {questions.map((q, i) => {
            const result = results[q.id];
            return (
              <section key={q.id} className="st-panel" aria-label={`Question ${i + 1}`}>
                <p className="st-eyebrow">{categoryLabel(q.category)}</p>
                <h3 style={{ marginTop: 8, fontSize: 17, lineHeight: 1.4 }}>{q.question}</h3>
                <label
                  className="st-label"
                  htmlFor={`answer-${q.id}`}
                  style={{ display: "block", marginTop: 14 }}
                >
                  Your answer
                </label>
                <textarea
                  id={`answer-${q.id}`}
                  className="st-input st-textarea"
                  value={answers[q.id] ?? ""}
                  onChange={(e) => setAnswers((prev) => ({ ...prev, [q.id]: e.target.value }))}
                  placeholder="Write your answer here…"
                  rows={5}
                  disabled={interview.status === "completed"}
                />
                <div style={{ display: "flex", gap: 10, marginTop: 12, alignItems: "center", flexWrap: "wrap" }}>
                  <button
                    type="button"
                    className="st-btn st-btn-blue st-btn-sm"
                    onClick={() => onAnswer(q)}
                    disabled={answering === q.id || interview.status === "completed"}
                  >
                    <Send size={15} aria-hidden="true" />
                    {answering === q.id ? "Scoring…" : result ? "Re-submit answer" : "Submit answer"}
                  </button>
                  {result ? (
                    <span className="st-chip st-chip-green">
                      Score: {result.score} / 100 · {result.evaluation.method}
                    </span>
                  ) : null}
                </div>
                {result ? (
                  <div className="st-note" style={{ marginTop: 14 }}>
                    <strong>Feedback: </strong>
                    {result.evaluation.notes || "No notes returned."}
                    <span style={{ display: "block", marginTop: 6 }}>
                      Accuracy {result.evaluation.accuracy} · Understanding{" "}
                      {result.evaluation.understanding} · Depth {result.evaluation.depth} ·
                      Relevance {result.evaluation.relevance} · Problem solving{" "}
                      {result.evaluation.problemSolving}
                    </span>
                    {result.followUp ? (
                      <span style={{ display: "block", marginTop: 8 }}>
                        <strong>Adaptive follow-up added below</strong> — your
                        answer scored under 60, so the interviewer asks a
                        deeper question on this topic.
                      </span>
                    ) : null}
                  </div>
                ) : null}
              </section>
            );
          })}

          {showReport && report ? (
            <section className="st-panel" aria-label="Final interview report">
              <div className="st-panel-head">
                <div>
                  <h2>Final report</h2>
                  <p className="st-panel-desc">
                    Interview score (separate from the coding score)
                  </p>
                </div>
                <span className="as-score-num">
                  {report.finalScore === null ? "—" : Math.round(report.finalScore)}
                  <small> / 100</small>
                </span>
              </div>
              <div className="st-grid st-grid-2" style={{ marginTop: 16 }}>
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
                  {(report.knowledgeGaps.length === 0) ? (
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
              <h3 style={{ marginTop: 18 }}>Transcript</h3>
              <div className="st-list" style={{ marginTop: 10 }}>
                {report.transcript.map((t, i) => (
                  <article key={i} className="st-list-item">
                    <div>
                      <h3>{t.question}</h3>
                      <p className="st-list-meta">
                        <strong style={{ color: "var(--ink)" }}>Category: </strong>
                        {categoryLabel(t.category)}
                        {t.score !== null ? ` · Score: ${t.score}` : " · Not answered"}
                      </p>
                      <p className="st-list-meta">{t.answer ?? "No answer given."}</p>
                    </div>
                  </article>
                ))}
              </div>
              <h3 style={{ marginTop: 18 }}>Per-question evaluation</h3>
              <div className="st-list" style={{ marginTop: 10 }}>
                {report.perQuestion.map((p, i) => (
                  <article key={i} className="st-list-item">
                    <div>
                      <h3>{p.question}</h3>
                      <p className="st-list-meta">
                        {categoryLabel(p.category)} · Score: {p.score ?? "—"}
                      </p>
                    </div>
                  </article>
                ))}
              </div>
            </section>
          ) : null}
        </>
      )}

      <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
        <BackToHub />
        <Link href={`/assessment/${id}/evaluation`} className="st-btn st-btn-outline st-btn-sm">
          Evaluation
        </Link>
        <Link href={`/assessment/${id}/verified`} className="st-btn st-btn-outline st-btn-sm">
          Verified profile
        </Link>
      </div>
    </div>
  );
}

export default function AssessmentInterviewPage() {
  return (
    <RequireAuth roles={["candidate"]}>
      <StudentShell>
        <StudentPageHead
          eyebrow="AI Interview"
          title={<>Code-grounded <span className="blue">interview</span></>}
          sub="Answer in writing. Questions are built from your project and submitted code, scored per answer, with an adaptive follow-up when an answer is weak."
        />
        <InterviewContent />
      </StudentShell>
    </RequireAuth>
  );
}
