"use client";

import { useCallback, useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { RequireAuth } from "@/components/auth/RequireAuth";
import { StudentPageHead, StudentShell } from "@/components/student/StudentShell";
import {
  BackToHub,
  ErrorState,
  Kv,
  LoadingState,
} from "@/components/assessment/shared";
import {
  ApiHttpError,
  fetchMonitoring,
  fetchMonitoringReport,
  formatDateTime,
  formatDuration,
  type MonitoringData,
  type MonitoringReportData,
} from "@/lib/api";
import { useAuth } from "@/lib/auth-context";

function FindingText(f: Record<string, unknown>): { title: string; status: string } {
  const title = String(
    f.finding ?? f.type ?? f.title ?? f.message ?? "Integrity finding",
  );
  const status = String(f.status ?? f.severity ?? "recorded");
  return { title, status };
}

function ReportContent() {
  const params = useParams<{ id: string }>();
  const id = params.id;
  const { user } = useAuth();
  const [report, setReport] = useState<MonitoringReportData | null>(null);
  const [own, setOwn] = useState<MonitoringData | null>(null);
  const [denied, setDenied] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    setDenied(null);
    try {
      const r = await fetchMonitoringReport(id);
      setReport(r);
    } catch (err) {
      if (err instanceof ApiHttpError && err.status === 403) {
        // The server enforces the gate: only recruiters whose job the
        // candidate applied to (or admins) see the full report. Show the
        // 403 honestly. Candidates fall back to their own monitoring
        // summary, clearly labelled as such.
        setDenied(err.message);
        if (user?.role === "candidate") {
          try {
            setOwn(await fetchMonitoring(id));
          } catch (e2) {
            setError(e2 instanceof Error ? e2.message : "Could not load your monitoring summary.");
          }
        }
      } else {
        setError(err instanceof Error ? err.message : "Could not load the monitoring report.");
      }
    } finally {
      setLoading(false);
    }
  }, [id, user?.role]);

  useEffect(() => {
    load();
  }, [load]);

  if (loading) return <LoadingState text="Loading the monitoring report…" />;
  if (error) {
    return <ErrorState message={error} onRetry={load} />;
  }

  const summary = report?.summary ?? own?.summary ?? null;
  const timeline = report?.timeline ?? null;
  const integrity = report?.integrityFindings ?? own?.integrity ?? [];
  const evaluation = report?.evaluation ?? null;

  return (
    <div className="st-stack">
      {denied ? (
        <div className="as-alert as-alert-warn" role="alert">
          <strong>Recruiter report not available to you (server: 403).</strong>{" "}
          {denied} Recruiters only see this report when the candidate applied
          to one of their jobs.{" "}
          {own
            ? "Below is your own monitoring summary instead — the same activity data, without the recruiter report."
            : "No candidate summary is available for this account."}
        </div>
      ) : (
        <div className="as-alert as-alert-info">
          <strong>Recruiter view.</strong> This report is built only from
          recorded monitoring events — durations, files changed, test history,
          timeline, AI-assistant usage and integrity status. Raw keystrokes and
          file contents outside the submitted snapshot are never shared.
        </div>
      )}

      {summary ? (
        <>
          <section className="st-panel" aria-label="Activity summary">
            <h2>Activity summary</h2>
            <div className="st-grid st-grid-3" style={{ marginTop: 16 }}>
              <Kv label="Total duration">{formatDuration(summary.durationSeconds)}</Kv>
              <Kv label="Active time">{formatDuration(summary.activeSeconds)}</Kv>
              <Kv label="Idle time">
                {formatDuration(
                  summary.idlePeriods.reduce((s, p) => s + (p.seconds ?? 0), 0),
                )}{" "}
                ({summary.idlePeriods.length} idle period(s))
              </Kv>
              <Kv label="Terminal commands">{summary.terminalCommands}</Kv>
              <Kv label="Test runs">
                {summary.testRuns.runs} run(s) · {summary.testRuns.passed} passed /{" "}
                {summary.testRuns.failed} failed of {summary.testRuns.total}
              </Kv>
              <Kv label="Compile errors">{summary.compileErrors}</Kv>
              <Kv label="Submission attempts">{summary.submissionAttempts}</Kv>
              <Kv label="Tabs hidden">{summary.tabHiddenCount} time(s)</Kv>
              <Kv label="AI assistant interactions">{summary.aiAssistantInteractions}</Kv>
            </div>
            <h3 style={{ marginTop: 20 }}>Files changed</h3>
            <div className="st-grid st-grid-3" style={{ marginTop: 10 }}>
              <div>
                <p className="st-kv-label">Modified ({summary.filesModified.length})</p>
                {summary.filesModified.length === 0 ? (
                  <p className="st-panel-desc">None.</p>
                ) : (
                  <ul className="as-list">
                    {summary.filesModified.map((f) => (
                      <li key={f} className="plain">{f}</li>
                    ))}
                  </ul>
                )}
              </div>
              <div>
                <p className="st-kv-label">Created ({summary.filesCreated.length})</p>
                {summary.filesCreated.length === 0 ? (
                  <p className="st-panel-desc">None.</p>
                ) : (
                  <ul className="as-list">
                    {summary.filesCreated.map((f) => (
                      <li key={f} className="plain">{f}</li>
                    ))}
                  </ul>
                )}
              </div>
              <div>
                <p className="st-kv-label">Deleted ({summary.filesDeleted.length})</p>
                {summary.filesDeleted.length === 0 ? (
                  <p className="st-panel-desc">None.</p>
                ) : (
                  <ul className="as-list">
                    {summary.filesDeleted.map((f) => (
                      <li key={f} className="plain">{f}</li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
          </section>

          <section className="st-panel" aria-label="Debugging observations">
            <h2>Debugging observations</h2>
            <p className="st-panel-desc" style={{ marginTop: 6 }}>
              Neutral, evidence-based observations from the recorded events —
              counts and timestamps, never a judgement of ability.
            </p>
            {summary.observations.length === 0 ? (
              <p className="st-panel-desc" style={{ marginTop: 10 }}>No observations recorded.</p>
            ) : (
              <ul className="as-list" style={{ marginTop: 10 }}>
                {summary.observations.map((o, i) => (
                  <li key={i} className="plain">{o}</li>
                ))}
              </ul>
            )}
          </section>

          <section className="st-panel" aria-label="AI usage disclosure">
            <h2>AI usage disclosure</h2>
            <p className="st-panel-desc" style={{ marginTop: 6 }}>
              {summary.aiAssistantInteractions === 0
                ? "No AI-assistant interactions inside the platform were recorded for this assessment."
                : `${summary.aiAssistantInteractions} AI-assistant interaction(s) inside the platform were recorded for this assessment. There is no AI chat in the Lab; this count comes from the monitoring events.`}
            </p>
          </section>
        </>
      ) : (
        <section className="st-panel" aria-label="No activity yet">
          <h2>No activity recorded yet</h2>
          <p className="st-panel-desc">
            No monitoring events exist for this assessment — start the Lab and
            the activity summary will appear here.
          </p>
        </section>
      )}

      <section className="st-panel" aria-label="Integrity findings">
        <h2>Integrity findings</h2>
        {integrity.length === 0 ? (
          <p className="st-panel-desc" style={{ marginTop: 8 }}>
            No integrity findings recorded for this assessment.
          </p>
        ) : (
          <div className="st-list" style={{ marginTop: 12 }}>
            {integrity.map((f, i) => {
              const row = f as Record<string, unknown>;
              const { title, status } = FindingText(row);
              return (
                <article key={i} className="st-list-item">
                  <div>
                    <h3>{title}</h3>
                    <p className="st-list-meta">
                      {row.created_at ? `${formatDateTime(String(row.created_at))} · ` : ""}
                      {row.detail ? String(row.detail) : ""}
                    </p>
                  </div>
                  <span className="st-chip st-chip-amber">{status}</span>
                </article>
              );
            })}
          </div>
        )}
      </section>

      {evaluation ? (
        <section className="st-panel" aria-label="Linked evaluation">
          <h2>Linked evaluation</h2>
          <p className="st-panel-desc" style={{ marginTop: 6 }}>
            Overall score:{" "}
            <strong style={{ color: "var(--ink)" }}>
              {evaluation.overallScore === null ? "Not scored" : `${evaluation.overallScore} / 100`}
            </strong>
            {evaluation.humanReviewRecommended ? " · Human review recommended" : ""}
            {" · "}Method: {evaluation.qualitativeMethod}
          </p>
          {user?.role === "candidate" ? (
            <p style={{ marginTop: 12 }}>
              <Link href={`/assessment/${id}/evaluation`} className="st-btn st-btn-outline st-btn-sm">
                Open full evaluation
              </Link>
            </p>
          ) : null}
        </section>
      ) : null}

      {timeline ? (
        <section className="st-panel" aria-label="Progress timeline">
          <h2>Progress timeline</h2>
          {timeline.length === 0 ? (
            <p className="st-panel-desc" style={{ marginTop: 8 }}>No events recorded yet.</p>
          ) : (
            <table className="st-table">
              <thead>
                <tr>
                  <th>When</th>
                  <th>Event</th>
                  <th>File</th>
                </tr>
              </thead>
              <tbody>
                {timeline.map((t, i) => (
                  <tr key={i}>
                    <td>{formatDateTime(t.at)}</td>
                    <td>{t.type}</td>
                    <td>{t.file ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
      ) : own ? (
        <section className="st-panel" aria-label="Recent events">
          <h2>Recent events</h2>
          {own.events.length === 0 ? (
            <p className="st-panel-desc" style={{ marginTop: 8 }}>No events recorded yet.</p>
          ) : (
            <table className="st-table">
              <thead>
                <tr>
                  <th>When</th>
                  <th>Event</th>
                  <th>File</th>
                </tr>
              </thead>
              <tbody>
                {own.events.slice(-50).map((e, i) => (
                  <tr key={i}>
                    <td>{formatDateTime(e.created_at)}</td>
                    <td>{e.event_type}</td>
                    <td>{e.file_path ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
      ) : null}

      <div>
        <BackToHub />
      </div>
    </div>
  );
}

export default function AssessmentReportPage() {
  return (
    <RequireAuth>
      <StudentShell>
        <StudentPageHead
          eyebrow="Monitoring Report"
          title={<>How the work was <span className="blue">done</span></>}
          sub="Duration, activity, files changed, test history, timeline and integrity — from recorded monitoring events only. The full recruiter report is gated by the server (403 unless the candidate applied to your job)."
        />
        <ReportContent />
      </StudentShell>
    </RequireAuth>
  );
}
