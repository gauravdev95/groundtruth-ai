"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import {
  ArrowRight,
  Briefcase,
  Building2,
  CheckCircle2,
  Circle,
  FileText,
  Target,
  UserRound,
  Users,
} from "lucide-react";
import { RequireAuth } from "@/components/auth/RequireAuth";
import { RecruiterPageHead, RecruiterShell } from "@/components/recruiter/RecruiterShell";
import { CompetencyChip } from "@/components/recruiter/CompetencyChip";
import { useAuth } from "@/lib/auth-context";
import {
  companySizeLabel,
  fetchRecruiterDashboard,
  type RecruiterDashboardData,
} from "@/lib/recruiter";
import { formatMatchScore } from "@/lib/api";

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
  const [data, setData] = useState<RecruiterDashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchRecruiterDashboard()
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

  const { profile, counts, jobs, applications } = data;
  const company = profile.company;
  const completeness = profile.completeness;
  const firstName = (user?.full_name ?? "").trim().split(/\s+/)[0] ?? "there";
  const done = completeness.percent === 100;

  return (
    <>
      <RecruiterPageHead
        eyebrow="Recruiter dashboard"
        title={
          <>
            Hi {firstName} — here&apos;s <span className="blue">your hiring at a glance.</span>
          </>
        }
        sub="Real numbers from your jobs and applications. Nothing here is a placeholder — an empty section means there is nothing in the database yet."
        actions={
          <>
            <Link href="/recruiter/jobs/new" className="st-btn st-btn-blue">
              Post a job
            </Link>
            <Link href="/recruiter/profile" className="st-btn st-btn-outline">
              <UserRound size={16} aria-hidden="true" /> View profile
            </Link>
          </>
        }
      />

      <div className="st-grid st-grid-4">
        <StatCard num={String(counts.jobs_total)} label="Jobs posted" sub={`${counts.jobs_open} open right now.`} />
        <StatCard num={String(counts.applications)} label="Applications" sub="Received across your jobs." />
        <StatCard num={String(counts.matches)} label="Matches" sub="Candidates matched to your jobs." />
        <StatCard num={`${completeness.percent}%`} label="Profile complete" sub={done ? "Every section filled in." : `${completeness.missing.length} section${completeness.missing.length === 1 ? "" : "s"} still to fill.`} />
      </div>

      <div className="st-grid st-grid-2 st-section-gap">
        {/* Company snapshot */}
        <section className="st-panel" aria-label="Company profile">
          <div className="st-panel-head">
            <div>
              <h2>Company profile</h2>
              <p className="st-panel-desc">
                What candidates see about your company. Post a role any time — it goes live on the job board under this company.
              </p>
            </div>
            <span className="st-panel-icon" aria-hidden="true">
              <Building2 size={20} />
            </span>
          </div>
          {company ? (
            <div className="st-kv">
              <div className="st-kv-row">
                <span>Company</span>
                <strong>{company.name}</strong>
              </div>
              <div className="st-kv-row">
                <span>Website</span>
                <strong>
                  {company.website ? (
                    <a href={company.website} target="_blank" rel="noopener noreferrer">
                      {company.website.replace(/^https?:\/\//, "")}
                    </a>
                  ) : (
                    "—"
                  )}
                </strong>
              </div>
              <div className="st-kv-row">
                <span>Industry</span>
                <strong>{company.industry ?? "—"}</strong>
              </div>
              <div className="st-kv-row">
                <span>Size</span>
                <strong>{companySizeLabel(company.size)}</strong>
              </div>
              <div className="st-kv-row">
                <span>Location</span>
                <strong>{company.location ?? "—"}</strong>
              </div>
              <div className="st-kv-row">
                <span>About</span>
                <strong>{company.description ?? "—"}</strong>
              </div>
            </div>
          ) : (
            <div className="st-empty-inline">
              <span className="st-empty-icon" aria-hidden="true">
                <Building2 size={22} />
              </span>
              <h3>No company profile yet</h3>
              <p>Your account has no company linked. Add your company details so candidates know who they are applying to.</p>
              <Link href="/recruiter/profile" className="st-btn st-btn-blue st-btn-sm">
                Complete company profile <ArrowRight size={15} aria-hidden="true" />
              </Link>
            </div>
          )}
        </section>

        {/* Completeness */}
        <section className="st-panel" aria-label="Profile completeness">
          <div className="st-panel-head">
            <div>
              <h2>Profile completeness</h2>
              <p className="st-panel-desc">
                Your details and your company&apos;s details, scored from what is actually filled in.
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
            <span className={`st-check-item${completeness.sections.personal.done ? " done" : " pending"}`}>
              {completeness.sections.personal.done ? <CheckCircle2 size={16} aria-hidden="true" /> : <Circle size={16} aria-hidden="true" />}
              <span>
                <strong>Your details</strong> — {completeness.sections.personal.detail}
              </span>
            </span>
            <span className={`st-check-item${completeness.sections.company.done ? " done" : " pending"}`}>
              {completeness.sections.company.done ? <CheckCircle2 size={16} aria-hidden="true" /> : <Circle size={16} aria-hidden="true" />}
              <span>
                <strong>Company profile</strong> — {completeness.sections.company.detail}
              </span>
            </span>
          </div>
          {!done ? (
            <div style={{ marginTop: 20 }}>
              <Link href="/recruiter/profile" className="st-btn st-btn-blue">
                Complete your profile <ArrowRight size={16} aria-hidden="true" />
              </Link>
            </div>
          ) : null}
        </section>
      </div>

      {/* Jobs */}
      <section className="st-panel st-section-gap" aria-label="Your jobs">
        <div className="st-panel-head">
          <div>
            <h2>Your jobs</h2>
            <p className="st-panel-desc">Roles posted under your company, newest first.</p>
          </div>
          <span className="st-panel-icon" aria-hidden="true">
            <Briefcase size={20} />
          </span>
        </div>
        {jobs.length === 0 ? (
          <div className="st-empty-inline">
            <span className="st-empty-icon" aria-hidden="true">
              <Briefcase size={22} />
            </span>
            <h3>No jobs posted yet</h3>
            <p>You haven&apos;t posted any roles yet. Post your first role — it goes live on the job board immediately, under your company.</p>
            <Link href="/recruiter/jobs/new" className="st-btn st-btn-blue st-btn-sm">
              Post a job <ArrowRight size={15} aria-hidden="true" />
            </Link>
          </div>
        ) : (
          <table className="st-table">
            <thead>
              <tr>
                <th>Role</th>
                <th>Location</th>
                <th>Status</th>
                <th>Applications</th>
              </tr>
            </thead>
            <tbody>
              {jobs.map((j) => (
                <tr key={j.id}>
                  <td>
                    <Link href={`/jobs/${j.id}`}>{j.title}</Link>
                  </td>
                  <td>{j.location ?? "—"}</td>
                  <td>
                    <span className="st-chip st-chip-blue">{j.status}</span>
                  </td>
                  <td>{j.application_count}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      {/* Applications */}
      <section className="st-panel st-section-gap" aria-label="Recent applications">
        <div className="st-panel-head">
          <div>
            <h2>Recent applications</h2>
            <p className="st-panel-desc">The latest candidates who applied to your roles. Open any row to see the applicant&apos;s full profile and move them through your pipeline.</p>
          </div>
          <Link href="/recruiter/applications" className="st-btn st-btn-outline st-btn-sm">
            View all <ArrowRight size={15} aria-hidden="true" />
          </Link>
        </div>
        {applications.length === 0 ? (
          <div className="st-empty-inline">
            <span className="st-empty-icon" aria-hidden="true">
              <FileText size={22} />
            </span>
            <h3>No applications yet</h3>
            <p>Once students apply to your roles, their applications show up here with a link to their profile.</p>
          </div>
        ) : (
          <table className="st-table">
            <thead>
              <tr>
                <th>Candidate</th>
                <th>Role</th>
                <th>Match</th>
                <th>Competency</th>
                <th>Status</th>
                <th>Applied</th>
              </tr>
            </thead>
            <tbody>
              {applications.map((a) => (
                <tr key={a.id}>
                  <td>
                    <Link href={`/recruiter/applications/${a.id}`}>
                      <strong>{a.candidate_name}</strong>
                    </Link>
                    {a.candidate_headline ? <div style={{ color: "var(--muted)", fontSize: 13 }}>{a.candidate_headline}</div> : null}
                  </td>
                  <td>
                    <Link href={`/jobs/${a.job_id}`}>{a.job_title}</Link>
                  </td>
                  <td>{formatMatchScore(a.match_score) ?? "No score yet"}</td>
                  <td>
                    <CompetencyChip
                      overallScore={a.competency_overall_score ?? null}
                      category={a.competency_category ?? null}
                      status={a.competency_status ?? null}
                      provisionalNote={a.competency_provisional_note ?? null}
                      provisionalCategory={a.competency_provisional_category ?? null}
                    />
                  </td>
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
    </>
  );
}

export default function RecruiterDashboardPage() {
  return (
    <RequireAuth roles={["recruiter"]}>
      <RecruiterShell>
        <DashboardContent />
      </RecruiterShell>
    </RequireAuth>
  );
}
