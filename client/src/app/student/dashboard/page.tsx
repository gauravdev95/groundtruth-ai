"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import {
  ArrowRight,
  Briefcase,
  FileText,
  Search,
  Target,
  UserRound,
} from "lucide-react";
import { RequireAuth } from "@/components/auth/RequireAuth";
import { StudentPageHead, StudentShell } from "@/components/student/StudentShell";
import {
  AiMonitoringCard,
  ProfileStrengthCard,
} from "@/components/student/ProfileStrength";
import { useAuth } from "@/lib/auth-context";
import { formatMatchScore } from "@/lib/api";
import {
  fetchDashboard,
  type DashboardData,
} from "@/lib/student";

function StatCard({
  num,
  label,
  sub,
}: {
  num: string;
  label: string;
  sub: string;
}) {
  return (
    <div className="st-panel st-stat">
      <span className="st-stat-num">{num}</span>
      <span className="st-stat-label">{label}</span>
      <span className="st-stat-sub">{sub}</span>
    </div>
  );
}

function DashboardContent() {
  const { user } = useAuth();
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchDashboard()
      .then(setData)
      .catch((err) => setError(err instanceof Error ? err.message : "Could not load your dashboard."))
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <div className="st-loading" role="status" aria-label="Loading">
        <span className="st-spinner" aria-hidden="true" />
        <p>Loading your dashboard…</p>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="st-empty">
        <h2>Couldn&apos;t load your dashboard</h2>
        <p>{error ?? "Something went wrong."}</p>
        <button type="button" className="st-btn st-btn-blue" onClick={() => window.location.reload()}>
          Try again
        </button>
      </div>
    );
  }

  const { profile, counts, applications, matches, open_jobs } = data;
  const c = profile.candidate;
  const completeness = profile.completeness;
  const firstName = (user?.full_name ?? c.full_name).trim().split(/\s+/)[0] ?? "there";
  const done = completeness.percent === 100;

  return (
    <>
      <StudentPageHead
        eyebrow="Student dashboard"
        title={
          <>
            Hi {firstName} — here&apos;s <span className="blue">where you stand.</span>
          </>
        }
        sub="Real numbers from your profile, applications and matches. Nothing here is a placeholder — an empty section means there is nothing in the database yet."
        actions={
          <Link href="/student/profile" className="st-btn st-btn-outline">
            <UserRound size={16} aria-hidden="true" /> View profile
          </Link>
        }
      />

      <div className="st-grid st-grid-4">
        <StatCard num={`${completeness.percent}%`} label="Profile complete" sub={done ? "Every section filled in." : `${completeness.missing.length} section${completeness.missing.length === 1 ? "" : "s"} still to fill.`} />
        <StatCard num={String(counts.applications)} label="Applications" sub="Roles you have applied to." />
        <StatCard num={String(counts.matches)} label="Matches" sub="Roles matched to your profile." />
        <StatCard num={String(counts.open_jobs)} label="Open roles" sub="Live on the platform right now." />
      </div>

      <div className="st-grid st-grid-2 st-section-gap">
        {/* Profile strength (real server score + what to improve) */}
        <ProfileStrengthCard profile={profile} />

        {/* Online AI Monitoring (real stored data only) */}
        <AiMonitoringCard profile={profile} />
      </div>

      {/* Applications */}
      <section className="st-panel st-section-gap" aria-label="My applications">
        <div className="st-panel-head">
          <div>
            <h2>My applications</h2>
            <p className="st-panel-desc">Every application you have submitted through GroundTruth, newest first.</p>
          </div>
          <span className="st-panel-icon" aria-hidden="true">
            <Briefcase size={20} />
          </span>
        </div>
        {applications.length === 0 ? (
          <div className="st-empty-inline">
            <span className="st-empty-icon" aria-hidden="true">
              <Briefcase size={22} />
            </span>
            <h3>No applications yet</h3>
            <p>You haven&apos;t applied to any role yet. Browse the open roles and apply — your applications show up here with their status.</p>
            <Link href="/jobs" className="st-btn st-btn-blue st-btn-sm">
              <Search size={15} aria-hidden="true" /> Browse open roles
            </Link>
          </div>
        ) : (
          <table className="st-table">
            <thead>
              <tr>
                <th>Role</th>
                <th>Company</th>
                <th>Match</th>
                <th>Status</th>
                <th>Applied</th>
              </tr>
            </thead>
            <tbody>
              {applications.map((a) => (
                <tr key={a.id}>
                  <td>
                    <Link href={`/jobs/${a.job_id}`}>{a.job_title}</Link>
                  </td>
                  <td>{a.company_name ?? "—"}</td>
                  <td>{formatMatchScore(a.match_score) ?? "No score yet"}</td>
                  <td>
                    <span className="st-chip st-chip-blue">{a.status}</span>
                  </td>
                  <td>{new Date(a.created_at).toLocaleDateString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <div className="st-grid st-grid-2 st-section-gap">
        {/* Matches */}
        <section className="st-panel" aria-label="Top matches">
          <div className="st-panel-head">
            <div>
              <h2>Top matches</h2>
              <p className="st-panel-desc">Roles the matching engine scored against your profile.</p>
            </div>
            <span className="st-panel-icon" aria-hidden="true">
              <Target size={20} />
            </span>
          </div>
          {matches.length === 0 ? (
            <div className="st-empty-inline">
              <span className="st-empty-icon" aria-hidden="true">
                <Target size={22} />
              </span>
              <h3>No matches yet</h3>
              <p>Matches are computed from your skills and the open roles. Complete your profile and check back once roles are live.</p>
            </div>
          ) : (
            <div className="st-list">
              {matches.map((m) => (
                <div className="st-list-item" key={m.id}>
                  <div>
                    <h3>
                      <Link href={`/jobs/${m.job_id}`}>{m.job_title}</Link>
                    </h3>
                    <p className="st-list-meta">
                      {m.company_name ?? "—"}
                      {m.job_location ? ` · ${m.job_location}` : ""}
                    </p>
                  </div>
                  <span className="st-chip st-chip-blue">Score {(Number(m.score) * 100).toFixed(0)}%</span>
                </div>
              ))}
            </div>
          )}
        </section>

        {/* Open roles */}
        <section className="st-panel" aria-label="Open roles">
          <div className="st-panel-head">
            <div>
              <h2>Open roles</h2>
              <p className="st-panel-desc">Live on the platform right now, newest first.</p>
            </div>
            <span className="st-panel-icon" aria-hidden="true">
              <Search size={20} />
            </span>
          </div>
          {open_jobs.length === 0 ? (
            <div className="st-empty-inline">
              <span className="st-empty-icon" aria-hidden="true">
                <FileText size={22} />
              </span>
              <h3>No open roles right now</h3>
              <p>Check back soon — new roles appear here as soon as recruiters post them.</p>
            </div>
          ) : (
            <div className="st-list">
              {open_jobs.map((j) => (
                <div className="st-list-item" key={j.id}>
                  <div>
                    <h3>
                      <Link href={`/jobs/${j.id}`}>{j.title}</Link>
                    </h3>
                    <p className="st-list-meta">
                      {j.company_name ?? "—"}
                      {j.location ? ` · ${j.location}` : ""}
                      {j.salary_min !== null && j.salary_max !== null
                        ? ` · ₹${j.salary_min.toLocaleString("en-IN")}–₹${j.salary_max.toLocaleString("en-IN")}`
                        : ""}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          )}
          <div style={{ marginTop: 16 }}>
            <Link href="/jobs" className="st-btn st-btn-outline st-btn-sm">
              See all open roles <ArrowRight size={15} aria-hidden="true" />
            </Link>
          </div>
        </section>
      </div>
    </>
  );
}

export default function StudentDashboardPage() {
  return (
    <RequireAuth roles={["candidate"]}>
      <StudentShell>
        <DashboardContent />
      </StudentShell>
    </RequireAuth>
  );
}
