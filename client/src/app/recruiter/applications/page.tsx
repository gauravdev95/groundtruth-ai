"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { FileText, Users } from "lucide-react";
import { RequireAuth } from "@/components/auth/RequireAuth";
import { RecruiterPageHead, RecruiterShell } from "@/components/recruiter/RecruiterShell";
import { fetchRecruiterApplications } from "@/lib/recruiter";
import { formatMatchScore, type Application } from "@/lib/api";

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

function ApplicationsContent() {
  const searchParams = useSearchParams();
  const jobFilter = searchParams.get("job") ?? "all";
  const [apps, setApps] = useState<Application[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchRecruiterApplications()
      .then(setApps)
      .catch((err) =>
        setError(err instanceof Error ? err.message : "Could not load applications."),
      )
      .finally(() => setLoading(false));
  }, []);

  const jobs = useMemo(() => {
    if (!apps) return [];
    const seen = new Map<string, string>();
    for (const a of apps) seen.set(a.job_id, a.job_title);
    return [...seen.entries()].map(([id, title]) => ({ id, title }));
  }, [apps]);

  const filtered = useMemo(() => {
    if (!apps) return [];
    return jobFilter === "all" ? apps : apps.filter((a) => a.job_id === jobFilter);
  }, [apps, jobFilter]);

  if (loading) {
    return (
      <div className="st-loading" role="status" aria-label="Loading">
        <span className="st-spinner" aria-hidden="true" />
        <p>Loading applications…</p>
      </div>
    );
  }

  if (error || !apps) {
    return (
      <div className="st-empty">
        <h2>Couldn&apos;t load applications</h2>
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
        eyebrow="Applications"
        title={
          <>
            Every application <span className="blue">to your roles.</span>
          </>
        }
        sub="Newest first. Open any row to see the applicant's full profile and move them through your pipeline. Match scores appear only when the matching engine has scored that candidate against the role — otherwise the row honestly shows none."
        actions={
          <Link href="/recruiter/jobs/new" className="st-btn st-btn-blue">
            Post a job
          </Link>
        }
      />

      {apps.length === 0 ? (
        <div className="st-empty">
          <span className="st-empty-icon" aria-hidden="true">
            <Users size={22} />
          </span>
          <h2>No applications yet</h2>
          <p>
            Once students apply to your roles, they show up here with a link
            to each applicant&apos;s full profile.
          </p>
          <Link href="/jobs" className="st-btn st-btn-blue st-btn-sm">
            Browse the job board
          </Link>
        </div>
      ) : (
        <section className="st-panel" aria-label="Applications">
          <div className="st-panel-head">
            <div>
              <h2>
                {filtered.length} application{filtered.length === 1 ? "" : "s"}
              </h2>
              <p className="st-panel-desc">
                {jobFilter === "all"
                  ? "Across all your roles."
                  : `For “${jobs.find((j) => j.id === jobFilter)?.title ?? "this role"}”.`}
              </p>
            </div>
            <span className="st-panel-icon" aria-hidden="true">
              <FileText size={20} />
            </span>
          </div>

          <label className="st-field" style={{ maxWidth: 320, marginBottom: 18 }}>
            <span className="st-label">Filter by role</span>
            <select
              className="st-input st-select"
              value={jobFilter}
              onChange={(e) => {
                const v = e.target.value;
                window.location.href =
                  v === "all" ? "/recruiter/applications" : `/recruiter/applications?job=${v}`;
              }}
            >
              <option value="all">All roles</option>
              {jobs.map((j) => (
                <option key={j.id} value={j.id}>
                  {j.title}
                </option>
              ))}
            </select>
          </label>

          {filtered.length === 0 ? (
            <div className="st-empty-inline">
              <h3>No applications for this role yet</h3>
              <p>Try another role, or wait for students to apply.</p>
            </div>
          ) : (
            <table className="st-table">
              <thead>
                <tr>
                  <th>Candidate</th>
                  <th>Role</th>
                  <th>Match</th>
                  <th>Status</th>
                  <th>Applied</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((a) => {
                  const score = formatMatchScore(a.match_score);
                  return (
                    <tr key={a.id}>
                      <td>
                        <Link href={`/recruiter/applications/${a.id}`}>
                          <strong>{a.candidate_name}</strong>
                        </Link>
                        {a.candidate_headline ? (
                          <div style={{ color: "var(--muted)", fontSize: 13 }}>
                            {a.candidate_headline}
                          </div>
                        ) : null}
                      </td>
                      <td>
                        <Link href={`/jobs/${a.job_id}`}>{a.job_title}</Link>
                      </td>
                      <td>{score ?? "No score yet"}</td>
                      <td>
                        <span className={statusChip(a.status)}>{a.status}</span>
                      </td>
                      <td>{new Date(a.created_at).toLocaleDateString()}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </section>
      )}
    </>
  );
}

export default function RecruiterApplicationsPage() {
  return (
    <RequireAuth roles={["recruiter"]}>
      <RecruiterShell>
        <Suspense
          fallback={
            <div className="st-loading" role="status" aria-label="Loading">
              <span className="st-spinner" aria-hidden="true" />
              <p>Loading applications…</p>
            </div>
          }
        >
          <ApplicationsContent />
        </Suspense>
      </RecruiterShell>
    </RequireAuth>
  );
}
