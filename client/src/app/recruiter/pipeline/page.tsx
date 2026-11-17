"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { ArrowRight, Columns3, FileText } from "lucide-react";
import { RequireAuth } from "@/components/auth/RequireAuth";
import { RecruiterPageHead, RecruiterShell } from "@/components/recruiter/RecruiterShell";
import {
  RECRUITER_STATUS_OPTIONS,
  fetchRecruiterApplications,
  fetchRecruiterDashboard,
  updateApplicationStatus,
  type RecruiterApplicationStatus,
} from "@/lib/recruiter";
import { formatMatchScore, type Application } from "@/lib/api";

// Phase 6 — recruiter pipeline (Kanban).
//
// Five columns over the five pipeline stages a recruiter can see an
// application in: applied (just arrived) plus the four stages the
// recruiter can move it to (reviewing / interview / offer / rejected).
// Every move is an explicit recruiter action that calls the existing
// PATCH /api/applications/:id/status — nothing moves on its own, and
// nothing here invents a stage: columns are built from the real rows in
// GET /api/recruiter/applications, filterable per job or across all jobs.
// Withdrawn applications (a student-side state) are not a column; their
// count is shown below the board so they are not silently hidden.

const COLUMNS: { key: string; label: string; hint: string }[] = [
  { key: "applied", label: "Applied", hint: "Nobody has applied yet." },
  { key: "reviewing", label: "Reviewing", hint: "Move an applicant here once you've started looking at them." },
  { key: "interview", label: "Interview", hint: "Applicants you've invited to interview." },
  { key: "offer", label: "Offer", hint: "Applicants with an offer out." },
  { key: "rejected", label: "Rejected", hint: "Applicants you've closed out." },
];

function statusChip(status: string): string {
  switch (status) {
    case "offer":
      return "st-chip st-chip-green";
    case "rejected":
    case "withdrawn":
      return "st-chip st-chip-grey";
    case "interview":
      return "st-chip st-chip-amber";
    default:
      return "st-chip st-chip-blue";
  }
}

function PipelineContent() {
  const [apps, setApps] = useState<Application[] | null>(null);
  const [jobs, setJobs] = useState<{ id: string; title: string }[]>([]);
  const [jobFilter, setJobFilter] = useState("all");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [movingId, setMovingId] = useState<string | null>(null);
  const [moveError, setMoveError] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([fetchRecruiterApplications(), fetchRecruiterDashboard()])
      .then(([a, d]) => {
        setApps(a);
        setJobs(d.jobs.map((j) => ({ id: j.id, title: j.title })));
      })
      .catch((err) =>
        setError(err instanceof Error ? err.message : "Could not load the pipeline."),
      )
      .finally(() => setLoading(false));
  }, []);

  const filtered = useMemo(() => {
    if (!apps) return [];
    return jobFilter === "all" ? apps : apps.filter((a) => a.job_id === jobFilter);
  }, [apps, jobFilter]);

  const byStatus = useMemo(() => {
    const map = new Map<string, Application[]>();
    for (const c of COLUMNS) map.set(c.key, []);
    for (const a of filtered) {
      const list = map.get(a.status);
      if (list) list.push(a);
    }
    return map;
  }, [filtered]);

  const withdrawn = useMemo(
    () => filtered.filter((a) => a.status === "withdrawn").length,
    [filtered],
  );

  async function onMove(app: Application, to: RecruiterApplicationStatus) {
    if (to === app.status) return;
    setMovingId(app.id);
    setMoveError(null);
    try {
      const updated = await updateApplicationStatus(app.id, to);
      setApps((prev) =>
        prev === null ? prev : prev.map((a) => (a.id === updated.id ? updated : a)),
      );
    } catch (err) {
      setMoveError(err instanceof Error ? err.message : "Could not move this application.");
    } finally {
      setMovingId(null);
    }
  }

  if (loading) {
    return (
      <div className="st-loading" role="status" aria-label="Loading">
        <span className="st-spinner" aria-hidden="true" />
        <p>Loading pipeline…</p>
      </div>
    );
  }

  if (error || !apps) {
    return (
      <div className="st-empty">
        <h2>Couldn&apos;t load the pipeline</h2>
        <p>{error ?? "Something went wrong."}</p>
        <button type="button" className="st-btn st-btn-blue" onClick={() => window.location.reload()}>
          Try again
        </button>
      </div>
    );
  }

  return (
    <>
      <RecruiterPageHead
        eyebrow="Pipeline"
        title={
          <>
            Your hiring <span className="blue">pipeline.</span>
          </>
        }
        sub="Every application to your roles, grouped by stage. Move a candidate with the dropdown on their card — each move is saved to the application straight away, and the analytics page counts it from the same rows."
        actions={
          <Link href="/recruiter/analytics" className="st-btn st-btn-outline">
            View analytics <ArrowRight size={15} aria-hidden="true" />
          </Link>
        }
      />

      {apps.length === 0 ? (
        <div className="st-empty">
          <span className="st-empty-icon" aria-hidden="true">
            <Columns3 size={22} />
          </span>
          <h2>No applications yet</h2>
          <p>
            Once students apply to your roles, they show up here as cards
            you can move from Applied through to Offer or Rejected.
          </p>
          <Link href="/jobs" className="st-btn st-btn-blue st-btn-sm">
            Browse the job board
          </Link>
        </div>
      ) : (
        <>
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "end", marginBottom: 18 }}>
            <label className="st-field" style={{ maxWidth: 320, minWidth: 240, marginBottom: 0 }}>
              <span className="st-label">Show applications for</span>
              <select
                className="st-input st-select"
                value={jobFilter}
                onChange={(e) => setJobFilter(e.target.value)}
              >
                <option value="all">All roles ({apps.length})</option>
                {jobs.map((j) => (
                  <option key={j.id} value={j.id}>
                    {j.title}
                  </option>
                ))}
              </select>
            </label>
            <span className="st-chip st-chip-blue" style={{ marginBottom: 8 }}>
              {filtered.length} application{filtered.length === 1 ? "" : "s"}
              {jobFilter === "all" ? " across all roles" : ""}
            </span>
          </div>

          {moveError ? (
            <p className="st-error-text" role="alert" style={{ marginBottom: 14 }}>
              {moveError}
            </p>
          ) : null}

          <div className="st-kanban" role="list" aria-label="Pipeline board">
            {COLUMNS.map((col) => {
              const cards = byStatus.get(col.key) ?? [];
              return (
                <section key={col.key} className="st-kanban-col" aria-label={`${col.label} column`}>
                  <div className="st-kanban-col-head">
                    <h3>{col.label}</h3>
                    <span className="st-kanban-count">{cards.length}</span>
                  </div>
                  <div className="st-kanban-cards">
                    {cards.length === 0 ? (
                      <p className="st-kanban-empty">{col.hint}</p>
                    ) : (
                      cards.map((a) => {
                        const score = formatMatchScore(a.match_score);
                        return (
                          <article key={a.id} className="st-kanban-card" role="listitem">
                            <h4>
                              <Link href={`/recruiter/applications/${a.id}`}>
                                {a.candidate_name}
                              </Link>
                            </h4>
                            <p className="st-kanban-meta">
                              {a.candidate_headline ?? "No headline yet"}
                              <br />
                              {a.job_title}
                              <br />
                              Match: {score ?? "No score yet"} · Applied{" "}
                              {new Date(a.created_at).toLocaleDateString()}
                            </p>
                            <div className="st-kanban-actions">
                              <select
                                className="st-input st-select"
                                aria-label={`Move ${a.candidate_name} to a stage`}
                                value={a.status}
                                disabled={movingId === a.id}
                                onChange={(e) =>
                                  void onMove(a, e.target.value as RecruiterApplicationStatus)
                                }
                              >
                                <option value={a.status} disabled>
                                  {a.status === "applied" ? "Applied — move to…" : `Move from ${a.status}…`}
                                </option>
                                {RECRUITER_STATUS_OPTIONS.filter((o) => o.value !== a.status).map((o) => (
                                  <option key={o.value} value={o.value}>
                                    {o.label}
                                  </option>
                                ))}
                              </select>
                              <Link
                                href={`/recruiter/applications/${a.id}/evidence`}
                                className="st-btn st-btn-outline st-btn-sm"
                              >
                                <FileText size={14} aria-hidden="true" /> Evidence
                              </Link>
                            </div>
                            {movingId === a.id ? (
                              <p className="st-kanban-meta" style={{ marginTop: 8 }}>
                                Saving…
                              </p>
                            ) : null}
                          </article>
                        );
                      })
                    )}
                  </div>
                </section>
              );
            })}
          </div>

          {withdrawn > 0 ? (
            <p style={{ color: "var(--muted)", fontSize: 13, marginTop: 14 }}>
              {withdrawn} application{withdrawn === 1 ? " was" : "s were"} withdrawn by
              the candidate{withdrawn === 1 ? "" : "s"} — withdrawn applications
              don&apos;t sit in a pipeline column. See them in the{" "}
              <Link href="/recruiter/applications" style={{ color: "var(--blue2)", fontWeight: 700 }}>
                applications list
              </Link>
              .
            </p>
          ) : null}
          <p style={{ color: "var(--muted)", fontSize: 13, marginTop: withdrawn > 0 ? 6 : 14 }}>
            <span className={statusChip("offer")}>offer</span> chips mark the
            stage; a card&apos;s match score appears only when the matching
            engine has scored that candidate against the role.
          </p>
        </>
      )}
    </>
  );
}

export default function RecruiterPipelinePage() {
  return (
    <RequireAuth roles={["recruiter"]}>
      <RecruiterShell>
        <PipelineContent />
      </RecruiterShell>
    </RequireAuth>
  );
}
