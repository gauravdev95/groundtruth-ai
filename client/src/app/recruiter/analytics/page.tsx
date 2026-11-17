"use client";

import { useEffect, useMemo } from "react";
import { useState } from "react";
import Link from "next/link";
import { ArrowRight, BarChart3, Clock, Filter, TrendingUp, Users } from "lucide-react";
import { RequireAuth } from "@/components/auth/RequireAuth";
import { RecruiterPageHead, RecruiterShell } from "@/components/recruiter/RecruiterShell";
import {
  fetchRecruiterAnalytics,
  type RecruiterAnalytics,
} from "@/lib/recruiter";

// Phase 6 — recruiter analytics.
//
// Every number comes from GET /api/recruiter/analytics, which aggregates
// the recruiter's OWN company's jobs / applications / matches straight
// from the database. Nothing here is hardcoded or estimated:
// - a conversion is a dash when nobody has reached its base stage yet
//   (no data, not 0%);
// - time to first response is null until an application has a recorded
//   first pipeline move (history exists only since Phase 6);
// - the 30-day activity chart is zero-filled, so a quiet week reads as
//   quiet rather than as a flat busy line.

const STAGE_LABELS: Record<string, string> = {
  applied: "Applied",
  reviewing: "Reviewing",
  interview: "Interview",
  offer: "Offer",
  rejected: "Rejected",
  withdrawn: "Withdrawn",
};

const CONVERSION_ROWS: {
  key: "applied_to_reviewing" | "reviewing_to_interview" | "interview_to_offer";
  label: string;
}[] = [
  { key: "applied_to_reviewing", label: "Applied → Reviewing" },
  { key: "reviewing_to_interview", label: "Reviewing → Interview" },
  { key: "interview_to_offer", label: "Interview → Offer" },
];

function StatCard({ num, label, sub }: { num: string; label: string; sub: string }) {
  return (
    <div className="st-panel st-stat">
      <span className="st-stat-num">{num}</span>
      <span className="st-stat-label">{label}</span>
      <span className="st-stat-sub">{sub}</span>
    </div>
  );
}

function formatDay(iso: string): string {
  return new Date(`${iso}T00:00:00`).toLocaleDateString(undefined, {
    day: "numeric",
    month: "short",
  });
}

function AnalyticsContent() {
  const [data, setData] = useState<RecruiterAnalytics | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchRecruiterAnalytics()
      .then(setData)
      .catch((err) =>
        setError(err instanceof Error ? err.message : "Could not load analytics."),
      )
      .finally(() => setLoading(false));
  }, []);

  const maxActivity = useMemo(() => {
    if (!data) return 1;
    return Math.max(
      1,
      ...data.activity.series.map((p) => Math.max(p.applications, p.matches)),
    );
  }, [data]);

  if (loading) {
    return (
      <div className="st-loading" role="status" aria-label="Loading">
        <span className="st-spinner" aria-hidden="true" />
        <p>Loading analytics…</p>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="st-empty">
        <h2>Couldn&apos;t load analytics</h2>
        <p>{error ?? "Something went wrong."}</p>
        <button type="button" className="st-btn st-btn-blue" onClick={() => window.location.reload()}>
          Try again
        </button>
      </div>
    );
  }

  const total = data.counts.applications;
  const funnelOrder = ["applied", "reviewing", "interview", "offer", "rejected"] as const;
  const funnelMax = Math.max(...funnelOrder.map((s) => data.by_status[s] ?? 0), 1);
  const avgResponse = data.avg_time_to_first_response_hours;
  const hasActivity = data.activity.series.some((p) => p.applications > 0 || p.matches > 0);

  return (
    <>
      <RecruiterPageHead
        eyebrow="Analytics"
        title={
          <>
            Hiring <span className="blue">analytics.</span>
          </>
        }
        sub={`Across every role ${data.company ? `at ${data.company.name}` : "you've published"} — real counts from your jobs and applications, updated every time the page loads. Nothing here is a sample or a projection.`}
        actions={
          <Link href="/recruiter/pipeline" className="st-btn st-btn-outline">
            Open pipeline <ArrowRight size={15} aria-hidden="true" />
          </Link>
        }
      />

      <div className="st-grid st-grid-4">
        <StatCard
          num={String(total)}
          label="Total applications"
          sub="Every application across your roles."
        />
        <StatCard
          num={String(data.counts.jobs_total)}
          label="Jobs posted"
          sub={`${data.counts.jobs_open} open · ${data.counts.jobs_closed} closed · ${data.counts.jobs_draft} draft.`}
        />
        <StatCard
          num={String(data.counts.matches)}
          label="Matches"
          sub="Candidate–job pairs the matching engine has scored."
        />
        <StatCard
          num={String(data.counts.applicants)}
          label="Applicants"
          sub="Distinct candidates who applied."
        />
      </div>

      <div className="st-grid st-grid-4 st-section-gap">
        <div className="st-panel st-stat">
          <span className="st-stat-num" style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <Clock size={20} aria-hidden="true" />
            {avgResponse === null ? "—" : `${avgResponse}h`}
          </span>
          <span className="st-stat-label">Avg. time to first response</span>
          <span className="st-stat-sub">
            {avgResponse === null
              ? "No application has a recorded first pipeline move yet, so there is nothing to average."
              : `From applied to your first pipeline move, across ${data.first_response_sample} application${data.first_response_sample === 1 ? "" : "s"}. Moves before Phase 6 have no recorded time and are not counted.`}
          </span>
        </div>
        <div className="st-panel st-stat">
          <span className="st-stat-num" style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <TrendingUp size={20} aria-hidden="true" />
            {data.funnel.conversion.applied_to_reviewing === null
              ? "—"
              : `${Math.round(data.funnel.conversion.applied_to_reviewing * 100)}%`}
          </span>
          <span className="st-stat-label">Applied → Reviewing</span>
          <span className="st-stat-sub">
            {data.funnel.conversion.applied_to_reviewing === null
              ? "No application has reached Applied yet."
              : "Share of applications you moved into review."}
          </span>
        </div>
        <div className="st-panel st-stat">
          <span className="st-stat-num" style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <Users size={20} aria-hidden="true" />
            {data.verification.github_checked}/{data.verification.applicants}
          </span>
          <span className="st-stat-label">GitHub checked</span>
          <span className="st-stat-sub">
            Applicants with a GitHub verification result on file. The rest
            haven&apos;t been checked — not failed, just not checked.
          </span>
        </div>
        <div className="st-panel st-stat">
          <span className="st-stat-num" style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <Filter size={20} aria-hidden="true" />
            {data.verification.coding_verified}/{data.verification.coding_profiles}
          </span>
          <span className="st-stat-label">Coding profiles verified</span>
          <span className="st-stat-sub">
            Linked coding profiles with a verified status, out of all coding
            profiles your applicants listed.
          </span>
        </div>
      </div>

      {total === 0 ? (
        <div className="st-empty st-section-gap">
          <span className="st-empty-icon" aria-hidden="true">
            <BarChart3 size={22} />
          </span>
          <h2>No applications yet</h2>
          <p>
            The funnel, conversion and activity charts appear once candidates
            start applying to your published jobs. The counts above are real
            — they&apos;re just zero right now.
          </p>
          <Link href="/recruiter/jobs/new" className="st-btn st-btn-blue st-btn-sm">
            Post a job
          </Link>
        </div>
      ) : (
        <>
          <div className="st-grid st-grid-2 st-section-gap">
            <section className="st-panel" aria-label="Hiring funnel">
              <div className="st-panel-head">
                <div>
                  <h2>Hiring funnel</h2>
                  <p className="st-panel-desc">Applications by current stage, across all your roles.</p>
                </div>
                <span className="st-panel-icon" aria-hidden="true">
                  <Filter size={20} />
                </span>
              </div>
              {funnelOrder.map((stage) => {
                const count = data.by_status[stage] ?? 0;
                return (
                  <div key={stage} className="st-funnel-row">
                    <span className="st-funnel-label">{STAGE_LABELS[stage]}</span>
                    <div
                      className="st-funnel-track"
                      role="img"
                      aria-label={`${STAGE_LABELS[stage]}: ${count} of ${total}`}
                    >
                      <div
                        className="st-funnel-fill"
                        style={{ width: `${(count / funnelMax) * 100}%` }}
                      />
                    </div>
                    <span className="st-funnel-num">
                      {count}
                      {total > 0 ? ` · ${Math.round((count / total) * 100)}%` : ""}
                    </span>
                  </div>
                );
              })}
              <p className="st-note" style={{ marginTop: 14 }}>
                Stages are current positions, not history: an application
                rejected after reaching Interview counts under Rejected, not
                under Interview.
              </p>
            </section>

            <section className="st-panel" aria-label="Conversion">
              <div className="st-panel-head">
                <div>
                  <h2>Conversion</h2>
                  <p className="st-panel-desc">How candidates move between stages.</p>
                </div>
                <span className="st-panel-icon" aria-hidden="true">
                  <TrendingUp size={20} />
                </span>
              </div>
              <div className="st-kv">
                {CONVERSION_ROWS.map((row) => {
                  const value = data.funnel.conversion[row.key];
                  return (
                    <div key={row.key} className="st-kv-row">
                      <span>{row.label}</span>
                      <strong>{value === null ? "—" : `${Math.round(value * 100)}%`}</strong>
                    </div>
                  );
                })}
              </div>
              <p className="st-note" style={{ marginTop: 14 }}>
                A dash means no candidate has reached that stage yet — not
                0%. Conversion is measured on the applications that reached
                each stage.
              </p>
            </section>
          </div>

          <section className="st-panel st-section-gap" aria-label="Application trends">
            <div className="st-panel-head">
              <div>
                <h2>Application trends</h2>
                <p className="st-panel-desc">
                  Applications received and matches scored per day, last{" "}
                  {data.activity.window_days} days.
                </p>
              </div>
              <span className="st-panel-icon" aria-hidden="true">
                <BarChart3 size={20} />
              </span>
            </div>
            {!hasActivity ? (
              <div className="st-empty-inline">
                <h3>No activity in the last {data.activity.window_days} days</h3>
                <p>Applications and matches from earlier still count in the totals above.</p>
              </div>
            ) : (
              <>
                <div className="st-trend" role="img" aria-label="Daily applications and matches, last 30 days">
                  {data.activity.series.map((p) => (
                    <div key={p.date} className="st-trend-day" title={`${formatDay(p.date)}: ${p.applications} applications, ${p.matches} matches`}>
                      <span
                        className="st-trend-bar"
                        style={{ height: `${Math.max((p.applications / maxActivity) * 100, p.applications > 0 ? 4 : 0)}%` }}
                      />
                      <span
                        className="st-trend-bar st-trend-bar-matches"
                        style={{ height: `${Math.max((p.matches / maxActivity) * 100, p.matches > 0 ? 4 : 0)}%` }}
                      />
                    </div>
                  ))}
                </div>
                <div className="st-trend-legend">
                  <span>
                    <i style={{ background: "#1e2bda" }} aria-hidden="true" />
                    Applications
                  </span>
                  <span>
                    <i style={{ background: "#8b9bf5" }} aria-hidden="true" />
                    Matches
                  </span>
                  <span>
                    {formatDay(data.activity.series[0]?.date ?? "")} –{" "}
                    {formatDay(data.activity.series[data.activity.series.length - 1]?.date ?? "")}
                  </span>
                </div>
              </>
            )}
          </section>

          <section className="st-panel st-section-gap" aria-label="Applications by role">
            <div className="st-panel-head">
              <div>
                <h2>Applications by role</h2>
                <p className="st-panel-desc">Every role you&apos;ve posted, with its pipeline breakdown.</p>
              </div>
              <span className="st-panel-icon" aria-hidden="true">
                <Users size={20} />
              </span>
            </div>
            {data.by_job.length === 0 ? (
              <div className="st-empty-inline">
                <h3>No roles posted yet</h3>
                <p>Post your first role and its applications will break down here.</p>
              </div>
            ) : (
              <table className="st-table">
                <thead>
                  <tr>
                    <th>Role</th>
                    <th>Status</th>
                    <th>Total</th>
                    <th>Applied</th>
                    <th>Reviewing</th>
                    <th>Interview</th>
                    <th>Offer</th>
                    <th>Rejected</th>
                  </tr>
                </thead>
                <tbody>
                  {data.by_job.map((j) => (
                    <tr key={j.id}>
                      <td>
                        <Link href={`/jobs/${j.id}`}>
                          <strong>{j.title}</strong>
                        </Link>
                      </td>
                      <td>
                        <span className="st-chip st-chip-blue">{j.status}</span>
                      </td>
                      <td>{j.applications}</td>
                      <td>{j.by_status.applied}</td>
                      <td>{j.by_status.reviewing}</td>
                      <td>{j.by_status.interview}</td>
                      <td>{j.by_status.offer}</td>
                      <td>{j.by_status.rejected}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </section>
        </>
      )}
    </>
  );
}

export default function RecruiterAnalyticsPage() {
  return (
    <RequireAuth roles={["recruiter"]}>
      <RecruiterShell>
        <AnalyticsContent />
      </RecruiterShell>
    </RequireAuth>
  );
}
