"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import type { AssessmentStatus } from "@/lib/api";

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

/** Category label prettifier: "problemSolving" → "Problem Solving". */
export function prettyKey(key: string): string {
  return key
    .replace(/_/g, " ")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}
