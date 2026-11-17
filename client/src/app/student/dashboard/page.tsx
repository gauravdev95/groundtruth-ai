"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import {
  ArrowRight,
  Briefcase,
  CheckCircle2,
  Circle,
  FileText,
  Github,
  Search,
  Target,
  UserRound,
} from "lucide-react";
import { RequireAuth } from "@/components/auth/RequireAuth";
import { StudentPageHead, StudentShell } from "@/components/student/StudentShell";
import { useAuth } from "@/lib/auth-context";
import { formatMatchScore } from "@/lib/api";
import {
  fetchDashboard,
  firstIncompleteStage,
  stagePath,
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
  const nextStage = firstIncompleteStage(profile);
  const done = completeness.percent === 100;
  const sectionOrder = [
    { key: "basic", label: "Basic info" },
    { key: "github", label: "GitHub" },
    { key: "projects", label: "Projects" },
    { key: "coding", label: "Coding profile" },
    { key: "certificates", label: "Certificates" },
    { key: "experience", label: "Experience" },
  ] as const;

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
        {/* Completeness */}
        <section className="st-panel" aria-label="Profile completeness">
          <div className="st-panel-head">
            <div>
              <h2>Profile completeness</h2>
              <p className="st-panel-desc">
                {c.onboarding_completed_at
                  ? `Onboarding completed on ${new Date(c.onboarding_completed_at).toLocaleDateString()}. You can still edit every section from your profile.`
                  : "Finish onboarding to become visible to recruiters. Skipping the optional stages still completes onboarding — at 75%, not 100%."}
              </p>
            </div>
            <span className="st-panel-icon" aria-hidden="true">
              <Target size={20} />
            </span>
          </div>
          <div className="st-meter-row">
            <span className="st-meter-pct">{completeness.percent}%</span>
            <span className="st-stat-label">
              {done ? "Complete" : `${completeness.missing.length} to go`}
            </span>
          </div>
          <div className="st-meter" role="progressbar" aria-valuenow={completeness.percent} aria-valuemin={0} aria-valuemax={100} aria-label="Profile completeness">
            <div className="st-meter-fill" style={{ width: `${completeness.percent}%` }} />
          </div>
          <div className="st-check-list">
            {sectionOrder.map(({ key, label }) => {
              const section = completeness.sections[key];
              return (
                <span key={key} className={`st-check-item${section.done ? " done" : " pending"}`}>
                  {section.done ? <CheckCircle2 size={16} aria-hidden="true" /> : <Circle size={16} aria-hidden="true" />}
                  <span>
                    <strong>{label}</strong> — {section.detail}
                  </span>
                </span>
              );
            })}
          </div>
          {!done ? (
            <div style={{ marginTop: 20 }}>
              <Link href={stagePath(nextStage)} className="st-btn st-btn-blue">
                Continue: {nextStage.label} <ArrowRight size={16} aria-hidden="true" />
              </Link>
            </div>
          ) : null}
        </section>

        {/* GitHub verification */}
        <section className="st-panel" aria-label="GitHub verification">
          <div className="st-panel-head">
            <div>
              <h2>GitHub verification</h2>
              <p className="st-panel-desc">
                Your proof starts with your repositories. The status below comes from the server — never from a guess.
              </p>
            </div>
            <span className="st-panel-icon" aria-hidden="true">
              <Github size={20} />
            </span>
          </div>
          {c.github_handle ? (
            <div className="st-kv">
              <div className="st-kv-row">
                <span>Handle</span>
                <strong>{c.github_handle}</strong>
              </div>
              <div className="st-kv-row">
                <span>Handle check</span>
                <strong>
                  {c.github_handle_exists === true
                    ? "Found on GitHub"
                    : c.github_handle_exists === false
                      ? "Not found — check spelling"
                      : "Not checked yet"}
                </strong>
              </div>
              <div className="st-kv-row">
                <span>Repo analysis</span>
                <strong>
                  {profile.github_verification.status === "checked"
                    ? `Ran ${new Date(profile.github_verification.verified_at as string).toLocaleDateString()}`
                    : "Hasn't run yet"}
                </strong>
              </div>
              <div className="st-kv-row">
                <span>Resume</span>
                <strong>
                  {profile.resumes.length > 0
                    ? `${profile.resumes.length} uploaded`
                    : "Not uploaded"}
                </strong>
              </div>
            </div>
          ) : (
            <div className="st-empty-inline">
              <span className="st-empty-icon" aria-hidden="true">
                <Github size={22} />
              </span>
              <h3>No GitHub account linked yet</h3>
              <p>Link your GitHub account so recruiters can see verified evidence of your work, not just claims.</p>
              <Link href="/student/onboarding/github" className="st-btn st-btn-blue st-btn-sm">
                Link GitHub <ArrowRight size={15} aria-hidden="true" />
              </Link>
            </div>
          )}
        </section>
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
