"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import {
  Clock,
  HelpCircle,
  MessageSquareText,
  Send,
} from "lucide-react";
import { RequireAuth } from "@/components/auth/RequireAuth";
import { StudentPageHead, StudentShell } from "@/components/student/StudentShell";
import {
  BackToHub,
  ErrorState,
  InlineError,
  InterviewCoverageNote,
  LoadingState,
  ScoreBar,
  prettyKey,
} from "@/components/assessment/shared";
import {
  ApiHttpError,
  confirmInterviewReadiness,
  explainAgainInterview,
  fetchAssessment,
  fetchInterviewReport,
  fetchInterviewSession,
  finishInterviewSession,
  generateInterview,
  startInterviewSession,
  submitSessionAnswer,
  type ExplainAgainResult,
  type InterviewRow,
  type InterviewSessionState,
  type SessionAnswerResult,
  type SessionInterviewReport,
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

function wordCount(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

function fmtClock(totalSeconds: number): string {
  const s = Math.max(0, Math.round(totalSeconds));
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${String(m).padStart(2, "0")}:${String(r).padStart(2, "0")}`;
}

function fmtMinutes(seconds: number): string {
  const m = Math.round(seconds / 60);
  return m >= 1 ? `${m} min` : `${seconds} s`;
}

function fmtSeconds(seconds: number | null): string {
  if (seconds === null || seconds === undefined) return "—";
  if (seconds < 60) return `${seconds}s`;
  return fmtClock(seconds);
}

function errMessage(err: unknown, fallback: string): string {
  return err instanceof Error ? err.message : fallback;
}

/** The server never sends future questions, expected points or rubrics —
 *  the client only ever renders the current question. */
type Stage =
  | "loading"
  | "locked"
  | "pre-start"
  | "intro"
  | "running"
  | "report"
  | "report-missing";

function InterviewContent() {
  const params = useParams<{ id: string }>();
  const id = params.id;

  const [stage, setStage] = useState<Stage>("loading");
  const [assessmentStatus, setAssessmentStatus] = useState<string | null>(null);
  const [interview, setInterview] = useState<InterviewRow | null>(null);
  const [genProvider, setGenProvider] = useState<"live" | "deterministic" | null>(null);
  const [state, setState] = useState<InterviewSessionState | null>(null);
  const [report, setReport] = useState<SessionInterviewReport | null>(null);

  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [busyLabel, setBusyLabel] = useState<string | null>(null);

  const [answer, setAnswer] = useState("");
  const [answerError, setAnswerError] = useState<string | null>(null);
  const [shortWarning, setShortWarning] = useState<SessionAnswerResult | null>(null);
  const [lastSubmit, setLastSubmit] = useState<SessionAnswerResult | null>(null);
  const [submittedAnswer, setSubmittedAnswer] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const [explain, setExplain] = useState<ExplainAgainResult | null>(null);
  const [explainError, setExplainError] = useState<string | null>(null);
  const [explaining, setExplaining] = useState(false);

  const [reportError, setReportError] = useState<string | null>(null);
  const [finishing, setFinishing] = useState(false);

  // Display-only clock. Every deadline comes from the server; the client
  // never decides expiry — it refetches and lets the server advance.
  const [now, setNow] = useState(() => Date.now());
  const expiredRefetchFor = useRef<string | null>(null);

  const applyState = useCallback((s: InterviewSessionState) => {
    setState(s);
    const st = s.session.status;
    if (st === "intro") setStage("intro");
    else if (st === "in_progress") setStage("running");
    else if (st === "completed" || st === "expired") setStage("report-missing");
    else setStage("pre-start");
  }, []);

  const loadReport = useCallback(
    async (interviewId: string) => {
      setReportError(null);
      try {
        const r = await fetchInterviewReport(interviewId);
        setReport(r);
        setStage("report");
      } catch (err) {
        if (err instanceof ApiHttpError && err.status === 404) {
          setStage("report-missing");
        } else {
          setReportError(errMessage(err, "Could not load the interview report."));
          setStage("report-missing");
        }
      }
    },
    [],
  );

  const load = useCallback(async () => {
    setStage("loading");
    setError(null);
    setReport(null);
    setLastSubmit(null);
    setSubmittedAnswer(null);
    setShortWarning(null);
    setExplain(null);
    try {
      const a = await fetchAssessment(id);
      setAssessmentStatus(a.status);
      if (a.status !== "completed") {
        setStage("locked");
        return;
      }
      // Idempotent: returns the existing interview (and its 7 frozen
      // questions) when one already exists, creates it otherwise.
      const gen = await generateInterview(id);
      setInterview(gen.interview);
      setGenProvider(gen.generationProvider);
      if (gen.interview.status === "completed") {
        await loadReport(gen.interview.id);
        return;
      }
      try {
        const s = await fetchInterviewSession(gen.interview.id);
        applyState(s);
        if (s.session.status === "completed" || s.session.status === "expired") {
          await loadReport(gen.interview.id);
        }
      } catch (err) {
        if (err instanceof ApiHttpError && err.status === 404) {
          // No session yet — show the intro with the Start button.
          setStage("pre-start");
        } else {
          throw err;
        }
      }
    } catch (err) {
      setError(errMessage(err, "Could not load the interview."));
    }
  }, [id, applyState, loadReport]);

  useEffect(() => {
    load();
  }, [load]);

  // Tick the display clock while a question is live.
  useEffect(() => {
    if (stage !== "running") return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [stage]);

  const refreshSession = useCallback(async () => {
    if (!interview) return;
    const s = await fetchInterviewSession(interview.id);
    applyState(s);
    if (s.session.status === "completed" || s.session.status === "expired") {
      await loadReport(interview.id);
    }
    return s;
  }, [interview, applyState, loadReport]);

  // When the server deadline for the current question passes, the server
  // advances to the next question (or finishes) — refetch once per
  // question so the client follows the server, never its own timer.
  const questionDeadline = state?.currentQuestion?.deadlineAt ?? null;
  const questionId = state?.currentQuestion?.id ?? null;
  const questionRemaining =
    questionDeadline !== null
      ? Math.max(0, Math.round((Date.parse(questionDeadline) - now) / 1000))
      : null;
  useEffect(() => {
    if (stage !== "running" || questionRemaining === null || questionId === null) return;
    if (questionRemaining > 0) return;
    if (expiredRefetchFor.current === questionId) return;
    expiredRefetchFor.current = questionId;
    refreshSession().catch((err) => {
      setAnswerError(errMessage(err, "The question time expired and the next question could not be loaded."));
    });
  }, [stage, questionRemaining, questionId, refreshSession]);

  // Clear the rephrased text when the question changes — it belongs to
  // the previous question only.
  useEffect(() => {
    setExplain(null);
    setExplainError(null);
  }, [questionId]);

  async function onStart() {
    if (!interview) return;
    setBusy(true);
    setBusyLabel("Starting the interview…");
    setError(null);
    try {
      const s = await startInterviewSession(interview.id);
      applyState(s);
    } catch (err) {
      setError(errMessage(err, "Could not start the interview."));
    } finally {
      setBusy(false);
      setBusyLabel(null);
    }
  }

  async function onReady() {
    if (!interview) return;
    setBusy(true);
    setBusyLabel("Confirming readiness…");
    setError(null);
    try {
      await confirmInterviewReadiness(interview.id);
      // This GET begins the clock and serves the first question.
      const s = await fetchInterviewSession(interview.id);
      applyState(s);
    } catch (err) {
      setError(errMessage(err, "Could not confirm readiness."));
    } finally {
      setBusy(false);
      setBusyLabel(null);
    }
  }

  async function onExplainAgain() {
    if (!interview) return;
    setExplaining(true);
    setExplainError(null);
    try {
      const r = await explainAgainInterview(interview.id);
      setExplain(r);
    } catch (err) {
      if (err instanceof ApiHttpError && err.status === 409) {
        setExplainError(err.message);
        // Sync the remaining budget from the server.
        refreshSession().catch(() => undefined);
      } else if (err instanceof ApiHttpError && err.status === 410) {
        setExplainError("The interview session has expired.");
        refreshSession().catch(() => undefined);
      } else {
        setExplainError(errMessage(err, "Could not explain the question again."));
      }
    } finally {
      setExplaining(false);
    }
  }

  async function onSubmit(confirmShort: boolean) {
    if (!interview || !state?.currentQuestion) return;
    const text = answer.trim();
    if (text.length === 0) {
      setAnswerError("Write your answer before submitting — an empty answer cannot be submitted.");
      return;
    }
    setSubmitting(true);
    setAnswerError(null);
    try {
      const res = await submitSessionAnswer(
        interview.id,
        state.currentQuestion.id,
        text,
        confirmShort ? true : undefined,
      );
      if (res.shortAnswerWarning) {
        // The server stored nothing — the candidate must confirm.
        setShortWarning(res);
        return;
      }
      setShortWarning(null);
      setLastSubmit(res);
      setSubmittedAnswer(text);
    } catch (err) {
      if (err instanceof ApiHttpError && err.status === 409) {
        setAnswerError("This answer was already submitted — answers are locked once submitted. Loading the current question…");
        refreshSession().catch(() => undefined);
      } else if (err instanceof ApiHttpError && err.status === 410) {
        setAnswerError("Time for this question expired, so it was left unanswered. Moving to the next question…");
        refreshSession().catch(() => undefined);
      } else {
        setAnswerError(errMessage(err, "Could not submit your answer."));
      }
    } finally {
      setSubmitting(false);
    }
  }

  async function onNext() {
    setLastSubmit(null);
    setSubmittedAnswer(null);
    setShortWarning(null);
    setExplain(null);
    setAnswer("");
    setAnswerError(null);
    try {
      await refreshSession();
    } catch (err) {
      setAnswerError(errMessage(err, "Could not load the next question."));
    }
  }

  async function onFinish() {
    if (!interview) return;
    setFinishing(true);
    setReportError(null);
    try {
      const r = await finishInterviewSession(interview.id);
      setReport(r);
      setStage("report");
      setLastSubmit(null);
      setSubmittedAnswer(null);
    } catch (err) {
      setReportError(errMessage(err, "Could not finish the interview."));
    } finally {
      setFinishing(false);
    }
  }

  if (stage === "loading" && !error) return <LoadingState text="Loading the interview…" />;
  if (error && stage !== "pre-start" && stage !== "intro" && stage !== "running") {
    return <ErrorState message={error} onRetry={load} />;
  }

  const rules = state?.rules;
  const perQuestionSeconds = rules?.perQuestionSeconds ?? 300;
  const sessionTotalSeconds = rules?.sessionTotalSeconds ?? 2400;
  const shortWords = rules?.shortAnswerWords ?? 20;
  const q = state?.currentQuestion ?? null;
  const isFollowUp = q?.category === "follow_up";
  const sessionRemaining =
    state?.session.expiresAt !== null && state?.session.expiresAt !== undefined
      ? Math.max(0, Math.round((Date.parse(state.session.expiresAt) - now) / 1000))
      : state?.session.timeRemainingSeconds ?? null;
  // The server does not expose the per-question Explain Again count in
  // the session state, so before the first use on this question the
  // display assumes the full per-question budget; the server still
  // enforces it and answers 409 when it is used up.
  const explainRemainingQ = explain
    ? explain.remainingForQuestion
    : (rules?.maxExplainAgainPerQuestion ?? 1);
  const explainRemainingSession = explain
    ? explain.remainingForSession
    : state?.session.explainAgainRemaining ?? (rules?.maxExplainAgainPerSession ?? 2);
  const explainDisabled =
    stage !== "running" || explaining || explainRemainingQ <= 0 || explainRemainingSession <= 0;

  const introRules = (
    <ul className="as-list">
      <li>7 questions, based on your project and the code you submitted.</li>
      <li>One question at a time — you never see future questions.</li>
      <li>
        Each question has its own time limit ({fmtMinutes(perQuestionSeconds)}); the whole
        interview allows {fmtMinutes(sessionTotalSeconds)} in total. The timers are set by the
        server, not by this page.
      </li>
      <li>Answers are submitted once and cannot be edited afterwards.</li>
      <li>
        Explain Again rephrases the question in simpler words — it never reveals the answer.
        You can use it at most {rules?.maxExplainAgainPerQuestion ?? 1} time per question and{" "}
        {rules?.maxExplainAgainPerSession ?? 2} times in the whole interview.
      </li>
      <li>
        Answers shorter than {shortWords} words get a warning — you can still submit them after
        confirming.
      </li>
      <li>At most one follow-up question, only when an answer is partial.</li>
      <li>
        Text interview only — no voice. There is no webcam, microphone, keylogging or
        screenshot monitoring.
      </li>
      <li>Judged on engineering knowledge only — never on accent, grammar or language.</li>
    </ul>
  );

  return (
    <div className="st-stack">
      <div className="as-alert as-alert-info">
        <strong>Text-based interview.</strong> There is no voice interview.
        Questions come from your own project, challenge and submitted code.
        The interview score is shown <strong>separate</strong> from your coding
        score.
      </div>

      {genProvider === "deterministic" && (stage === "pre-start" || stage === "intro") ? (
        <div className="as-alert as-alert-warn" role="note">
          <strong>AI-assisted (mock/demo).</strong> The interview questions and
          scoring use the demo evaluator because no live AI is connected — the
          results are labelled mock, never presented as live AI.
        </div>
      ) : null}

      {error ? <InlineError message={error} /> : null}

      {/* ── Assessment not evaluated yet ─────────────────────────── */}
      {stage === "locked" ? (
        <section className="st-panel" aria-label="Interview not available yet">
          <h2>Interview unlocks after evaluation</h2>
          <p className="st-panel-desc">
            This assessment is {assessmentStatus ?? "not finished"} — submit it in the Lab and
            run the evaluation first. The interview is generated only once the assessment is
            evaluated (status “completed”).
          </p>
          <p style={{ marginTop: 16, display: "flex", gap: 10, flexWrap: "wrap" }}>
            <Link href={`/assessment/${id}/evaluation`} className="st-btn st-btn-blue">
              Go to evaluation
            </Link>
            <Link href={`/assessment/${id}/lab`} className="st-btn st-btn-outline">
              Open the Lab
            </Link>
          </p>
        </section>
      ) : null}

      {/* ── Intro: before start, and again as the readiness gate ── */}
      {(stage === "pre-start" || stage === "intro") && interview ? (
        <section className="st-panel" aria-label="Interview introduction and rules">
          <div className="st-panel-head">
            <div>
              <h2>{stage === "pre-start" ? "AI technical interview" : "Before you begin"}</h2>
              <p className="st-panel-desc">
                {stage === "pre-start"
                  ? "A real interviewer will ask you about the project and code you submitted — in writing, one question at a time."
                  : "Your interview is ready. Read the rules once more, then confirm you are ready — the clock starts only after that."}
              </p>
            </div>
            <span className="st-chip st-chip-blue">7 questions</span>
          </div>
          <h3 style={{ marginTop: 16 }}>How it works</h3>
          <div style={{ marginTop: 8 }}>{introRules}</div>
          <p style={{ marginTop: 16, display: "flex", gap: 10, flexWrap: "wrap" }}>
            {stage === "pre-start" ? (
              <button
                type="button"
                className="st-btn st-btn-blue"
                onClick={onStart}
                disabled={busy}
              >
                <MessageSquareText size={16} aria-hidden="true" />
                {busy ? busyLabel ?? "Starting…" : "Start interview"}
              </button>
            ) : (
              <button
                type="button"
                className="st-btn st-btn-blue"
                onClick={onReady}
                disabled={busy}
              >
                {busy ? busyLabel ?? "Confirming…" : "Yes, I’m ready"}
              </button>
            )}
            <Link href={`/assessment/${id}/evaluation`} className="st-btn st-btn-outline">
              Back to evaluation
            </Link>
          </p>
          {stage === "intro" ? (
            <p className="st-panel-desc" style={{ marginTop: 10 }}>
              The first question appears only after you confirm — nothing is timed until then.
            </p>
          ) : null}
        </section>
      ) : null}

      {/* ── One question at a time ──────────────────────────────── */}
      {stage === "running" && state && !q && !lastSubmit ? (
        <LoadingState text="Loading the next question…" />
      ) : null}
      {stage === "running" && state && q ? (
        <>
          <section className="st-panel" aria-label="Interview progress">
            <div className="as-lab-top">
              <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                <span className="st-chip st-chip-blue">
                  Question {state.progress.currentNumber ?? q.questionNumber} of{" "}
                  {state.progress.total}
                </span>
                {isFollowUp ? (
                  <span className="st-chip st-chip-amber">Follow-up question</span>
                ) : null}
                <span className="st-chip">
                  {state.progress.answered} of {state.progress.total} answered
                </span>
                {state.session.followUpsUsed > 0 ? (
                  <span className="st-chip">Follow-up used</span>
                ) : null}
              </div>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                {questionRemaining !== null ? (
                  <div
                    className={`as-timer ${questionRemaining <= 60 ? "low" : ""}`}
                    role="timer"
                    aria-label="Time left for this question"
                  >
                    <Clock size={14} aria-hidden="true" style={{ verticalAlign: "-2px", marginRight: 4 }} />
                    {fmtClock(questionRemaining)}
                  </div>
                ) : null}
                {sessionRemaining !== null ? (
                  <div className="as-timer" role="timer" aria-label="Total time left in the interview">
                    Total {fmtClock(sessionRemaining)}
                  </div>
                ) : null}
              </div>
            </div>
          </section>

          {answerError ? <InlineError message={answerError} /> : null}

          {lastSubmit && submittedAnswer !== null ? (
            <section className="st-panel" aria-label="Answer submitted">
              <div className="st-panel-head">
                <div>
                  <h2>Answer submitted — locked</h2>
                  <p className="st-panel-desc">
                    Your answer cannot be edited now.
                    {lastSubmit.score !== null
                      ? ` Score: ${Math.round(lastSubmit.score)} / 100.`
                      : lastSubmit.evaluation?.status === "pending"
                        ? " Scoring is pending — the AI evaluation failed and no score was substituted."
                        : ""}
                  </p>
                </div>
                {lastSubmit.score !== null ? (
                  <span className="as-score-num">
                    {Math.round(lastSubmit.score)}
                    <small> / 100</small>
                  </span>
                ) : null}
              </div>
              {lastSubmit.evaluation?.provider === "mock" ? (
                <div className="as-alert as-alert-warn" role="note" style={{ marginTop: 12 }}>
                  <strong>AI-assisted (mock/demo).</strong> This score came from the
                  deterministic demo evaluator, not live AI.
                </div>
              ) : null}
              {lastSubmit.evaluation?.notes ? (
                <p className="st-note" style={{ marginTop: 12 }}>
                  <strong>Feedback: </strong>
                  {lastSubmit.evaluation.notes}
                </p>
              ) : null}
              {lastSubmit.followUp ? (
                <div className="as-alert as-alert-info" style={{ marginTop: 12 }}>
                  <strong>Follow-up added.</strong> Your answer was partial, so the
                  interviewer will ask one deeper question on this topic next.
                </div>
              ) : null}
              <p style={{ marginTop: 16, display: "flex", gap: 10, flexWrap: "wrap" }}>
                {lastSubmit.allAnswered ? (
                  <button
                    type="button"
                    className="st-btn st-btn-blue"
                    onClick={onFinish}
                    disabled={finishing}
                  >
                    {finishing ? "Finishing…" : "Finish interview — view report"}
                  </button>
                ) : (
                  <button type="button" className="st-btn st-btn-blue" onClick={onNext}>
                    Next question
                  </button>
                )}
              </p>
              {reportError ? <InlineError message={reportError} /> : null}
            </section>
          ) : (
            <section className="st-panel" aria-label={`Question ${q.questionNumber}`}>
              <p className="st-eyebrow">{categoryLabel(q.category)}</p>
              <p className="st-panel-desc" style={{ marginTop: 6 }}>
                Competency: {q.competencyId ? prettyKey(q.competencyId) : "—"}
                {q.difficulty ? ` · Difficulty: ${prettyKey(q.difficulty)}` : ""}
                {` · Time limit: ${fmtMinutes(q.maxTimeSeconds)}`}
              </p>
              <h3 style={{ marginTop: 10, fontSize: 17, lineHeight: 1.45 }}>{q.question}</h3>

              {explain ? (
                <div className="as-alert as-alert-info" style={{ marginTop: 14 }} role="note">
                  <strong>Same question, in simpler words:</strong>
                  <span style={{ display: "block", marginTop: 6 }}>{explain.rephrasedQuestion}</span>
                  {explain.provider === "mock" ? (
                    <span style={{ display: "block", marginTop: 6 }}>
                      AI-assisted (mock/demo) — rephrased by the demo evaluator.
                    </span>
                  ) : null}
                </div>
              ) : null}
              {explainError ? <InlineError message={explainError} /> : null}

              <label
                className="st-label"
                htmlFor="interview-answer"
                style={{ display: "block", marginTop: 16 }}
              >
                Your answer
              </label>
              <textarea
                id="interview-answer"
                className="st-input st-textarea"
                value={answer}
                onChange={(e) => {
                  setAnswer(e.target.value);
                  setAnswerError(null);
                  setShortWarning(null);
                }}
                placeholder="Write your answer here — explain your reasoning and ground it in what you actually built…"
                rows={8}
                disabled={submitting}
                aria-describedby="answer-word-count"
              />
              <p id="answer-word-count" className="st-panel-desc" style={{ marginTop: 6 }}>
                {wordCount(answer)} words · aim for at least {shortWords} words · submitted once,
                cannot be edited
              </p>

              {shortWarning ? (
                <div className="as-alert as-alert-warn" role="alert" style={{ marginTop: 12 }}>
                  <strong>Short answer.</strong> Your answer has{" "}
                  {shortWarning.wordCount ?? wordCount(answer)} words — fewer than the{" "}
                  {shortWarning.minWords ?? shortWords} words expected for this question. You can
                  keep editing, or submit it as it is.
                  <span style={{ display: "flex", gap: 10, marginTop: 10, flexWrap: "wrap" }}>
                    <button
                      type="button"
                      className="st-btn st-btn-blue st-btn-sm"
                      onClick={() => onSubmit(true)}
                      disabled={submitting}
                    >
                      {submitting ? "Submitting…" : "Submit anyway"}
                    </button>
                    <button
                      type="button"
                      className="st-btn st-btn-outline st-btn-sm"
                      onClick={() => setShortWarning(null)}
                    >
                      Keep editing
                    </button>
                  </span>
                </div>
              ) : null}

              <div
                style={{
                  display: "flex",
                  gap: 10,
                  marginTop: 14,
                  alignItems: "center",
                  flexWrap: "wrap",
                }}
              >
                <button
                  type="button"
                  className="st-btn st-btn-blue"
                  onClick={() => onSubmit(false)}
                  disabled={submitting}
                >
                  <Send size={15} aria-hidden="true" />
                  {submitting ? "Submitting…" : "Submit answer"}
                </button>
                <button
                  type="button"
                  className="st-btn st-btn-outline"
                  onClick={onExplainAgain}
                  disabled={explainDisabled}
                  title={
                    explainRemainingSession <= 0
                      ? "Explain Again budget for this session is used up"
                      : explainRemainingQ <= 0
                        ? "Explain Again already used for this question"
                        : `Explain Again — ${explainRemainingQ} left for this question, ${explainRemainingSession} left in this interview`
                  }
                >
                  <HelpCircle size={15} aria-hidden="true" />
                  {explaining ? "Explaining…" : "Explain again"}
                </button>
                <span className="st-panel-desc" style={{ marginTop: 0 }}>
                  Explain Again: {explainRemainingQ} left for this question ·{" "}
                  {explainRemainingSession} left in this interview
                </span>
              </div>
            </section>
          )}
        </>
      ) : null}

      {/* ── Report ──────────────────────────────────────────────── */}
      {stage === "report" && report ? (
        <InterviewReportView report={report} />
      ) : null}

      {stage === "report-missing" ? (
        <section className="st-panel" aria-label="Report not ready yet">
          <h2>Report not ready yet</h2>
          <p className="st-panel-desc">
            {state?.session.status === "expired"
              ? "This interview session expired before it was finished."
              : "This interview is finished, but its report is not available yet."}
            {reportError ? ` ${reportError}` : " Finish the interview first, then the report appears here."}
          </p>
          <p style={{ marginTop: 16, display: "flex", gap: 10, flexWrap: "wrap" }}>
            <button type="button" className="st-btn st-btn-blue" onClick={load}>
              Reload interview
            </button>
            <BackToHub />
          </p>
        </section>
      ) : null}

      <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
        <BackToHub />
        <Link href={`/assessment/${id}/evaluation`} className="st-btn st-btn-outline st-btn-sm">
          Evaluation
        </Link>
        <Link href={`/assessment/${id}/competency`} className="st-btn st-btn-outline st-btn-sm">
          Competency profile
        </Link>
        <Link href="/assessment/verified" className="st-btn st-btn-outline st-btn-sm">
          Verified profile
        </Link>
      </div>
    </div>
  );
}

/** Report view — also the view after GET /report for a completed
 *  interview. Scores are shown exactly as the server stored them. */
function InterviewReportView({ report }: { report: SessionInterviewReport }) {
  const mockUsed = report.perQuestion.some((p) => {
    const ev = p.evaluation as { provider?: string; method?: string } | null;
    return ev?.provider === "mock" || ev?.method === "deterministic";
  });
  const dimensionKeys = Object.keys(report.dimensionAverages);

  return (
    <section className="st-panel" aria-label="Final interview report">
      <div className="st-panel-head">
        <div>
          <h2>Interview report</h2>
          <p className="st-panel-desc">
            Interview score (separate from the coding score)
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
                    <strong style={{ color: "var(--ink)" }}>Your answer: </strong>
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
                        <strong style={{ color: "var(--ink)" }}>Your follow-up answer: </strong>
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

export default function AssessmentInterviewPage() {
  return (
    <RequireAuth roles={["candidate"]}>
      <StudentShell>
        <StudentPageHead
          eyebrow="AI Interview"
          title={<>Code-grounded <span className="blue">interview</span></>}
          sub="Answer in writing, one question at a time. Questions are built from your project and submitted code, scored per answer, with at most one follow-up when an answer is partial."
        />
        <InterviewContent />
      </StudentShell>
    </RequireAuth>
  );
}
