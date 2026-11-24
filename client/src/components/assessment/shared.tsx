"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import type { AssessmentStatus, SessionInterviewReport } from "@/lib/api";

/** Status chip for an assessment row — same palette as the student chips. */
export function StatusChip({ status }: { status: string }) {
  const s = (status ?? "draft") as AssessmentStatus;
  return <span className={`as-status as-status-${s}`}>{s}</span>;
}

/** 0–100 score bar with a label. Null means "not scored yet", never 0. */
export function ScoreBar({
  label,
  score,
  hint,
}: {
  label: string;
  score: number | null | undefined;
  hint?: string;
}) {
  const pct = score === null || score === undefined ? null : Math.max(0, Math.min(100, score));
  const tone = pct === null ? "" : pct >= 70 ? "green" : pct >= 50 ? "amber" : "red";
  return (
    <div>
      <div className="st-meter-row">
        <span style={{ fontSize: 13.5, fontWeight: 700 }}>{label}</span>
        <span style={{ fontSize: 13.5, fontWeight: 800, color: "var(--ink)" }}>
          {pct === null ? "Not scored" : `${Math.round(pct)} / 100`}
        </span>
      </div>
      <div className="as-bar" role="progressbar" aria-valuenow={pct ?? undefined} aria-label={label}>
        <div className={`as-bar-fill ${tone}`} style={{ width: `${pct ?? 0}%` }} />
      </div>
      {hint ? (
        <p className="st-panel-desc" style={{ marginTop: 6 }}>{hint}</p>
      ) : null}
    </div>
  );
}

export function LoadingState({ text }: { text: string }) {
  return (
    <div className="st-loading" role="status" aria-label="Loading">
      <span className="st-spinner" aria-hidden="true" />
      <p>{text}</p>
    </div>
  );
}

export function ErrorState({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div className="st-empty" role="alert">
      <h2>Couldn&apos;t load this page</h2>
      <p>{message}</p>
      {onRetry ? (
        <button type="button" className="st-btn st-btn-blue" onClick={onRetry}>
          Try again
        </button>
      ) : null}
    </div>
  );
}

export function InlineError({ message }: { message: string }) {
  return (
    <div className="as-alert as-alert-error" role="alert">
      {message}
    </div>
  );
}

export function Stepper({ steps, current }: { steps: string[]; current: number }) {
  return (
    <ol className="as-steps" aria-label="Assessment progress">
      {steps.map((label, i) => (
        <li
          key={label}
          className={`as-step ${i < current ? "done" : i === current ? "current" : ""}`}
          aria-current={i === current ? "step" : undefined}
        >
          <span className="as-step-dot" aria-hidden="true">
            {i < current ? "✓" : i + 1}
          </span>
          <div className="as-step-label">{label}</div>
        </li>
      ))}
    </ol>
  );
}

/** Small labelled value block used across the report pages. */
export function Kv({ label, children }: { label: string; children: ReactNode }) {
  return (
    <dl className="as-kv">
      <dt>{label}</dt>
      <dd>{children}</dd>
    </dl>
  );
}

export function BackToHub() {
  return (
    <Link href="/assessment" className="st-btn st-btn-outline st-btn-sm">
      ← All assessments
    </Link>
  );
}

/** Phase 2 G1.4 — interview completeness for a SessionInterviewReport.
 *  Prefers the server fields (interviewComplete / provisionalNote /
 *  questionsScored / questionsRequired) when present; derives the same
 *  values from `perQuestion` + `pendingEvaluations` when they are
 *  absent (older responses, or the backend SessionReport fields not
 *  landed yet). Never invents a "complete" verdict: with no questions
 *  at all the coverage is unknown (`known: false`) and the marker
 *  renders nothing. */
export function interviewCoverage(report: SessionInterviewReport): {
  complete: boolean;
  questionsScored: number;
  questionsRequired: number;
  provisionalNote: string | null;
  known: boolean;
} {
  const questionsScored =
    report.questionsScored ??
    report.perQuestion.filter((p) => p.score !== null).length;
  const questionsRequired = report.questionsRequired ?? report.perQuestion.length;
  const known = questionsRequired > 0;
  const complete =
    report.interviewComplete ??
    (known && report.pendingEvaluations === 0 && questionsScored >= questionsRequired);
  const provisionalNote =
    report.provisionalNote ??
    (complete || !known
      ? null
      : `provisional — ${questionsScored} of ${questionsRequired} questions scored`);
  return { complete, questionsScored, questionsRequired, provisionalNote, known };
}

/** Provisional/final marker for an interview report (Phase 2 G1.4).
 *  Rendered in BOTH interview-report UIs (candidate interview page and
 *  RecruiterInterviewReport). Incomplete: amber "Provisional — N of M
 *  questions scored" plus the server coverage note when present.
 *  Complete: green "Final interview score — all M questions scored".
 *  Nothing when coverage is unknown. */
export function InterviewCoverageNote({ report }: { report: SessionInterviewReport }) {
  const coverage = interviewCoverage(report);
  if (!coverage.known) return null;
  if (coverage.complete) {
    return (
      <div className="as-alert as-alert-success" role="note" style={{ marginTop: 12 }}>
        <strong>
          Final interview score — all {coverage.questionsRequired} question
          {coverage.questionsRequired === 1 ? "" : "s"} scored.
        </strong>
      </div>
    );
  }
  return (
    <div className="as-alert as-alert-warn" role="note" style={{ marginTop: 12 }}>
      <strong>
        Provisional — {coverage.questionsScored} of {coverage.questionsRequired} questions scored.
      </strong>{" "}
      {coverage.provisionalNote ? `${coverage.provisionalNote}. ` : ""}
      The interview score is provisional until every required question is evaluated.
    </div>
  );
}

/** Category label prettifier: "problemSolving" → "Problem Solving". */
export function prettyKey(key: string): string {
  return key
    .replace(/_/g, " ")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}
