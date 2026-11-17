import Link from "next/link";
import { ArrowLeft, Briefcase, Building2, CalendarDays, MapPin } from "lucide-react";
import { JobsNav } from "../JobsNav";
import { ApplyButton } from "./ApplyButton";
import {
  employmentTypeLabel,
  fetchJob,
  formatSalaryRange,
} from "@/lib/api";

export default async function JobDetailPage({
  params,
}: {
  params: { id: string };
}) {
  let job: Awaited<ReturnType<typeof fetchJob>> | null = null;
  let error: string | null = null;
  try {
    job = await fetchJob(params.id);
  } catch (err) {
    error = err instanceof Error ? err.message : "Could not load this role.";
  }

  return (
    <>
      <JobsNav />
      <main className="st-page">
        <p style={{ marginBottom: 18 }}>
          <Link href="/jobs" className="st-btn st-btn-outline st-btn-sm">
            <ArrowLeft size={15} aria-hidden="true" /> All open roles
          </Link>
        </p>

        {error !== null || !job ? (
          <div className="st-empty" role="alert">
            <h2>Role not found</h2>
            <p>{error ?? "This role doesn't exist or is no longer listed."}</p>
            <Link href="/jobs" className="st-btn st-btn-blue">
              Browse open roles
            </Link>
          </div>
        ) : (
          <>
            <div className="st-page-head">
              <div>
                <p className="st-eyebrow">{job.company_name ?? "Unknown company"}</p>
                <h1 className="st-page-title">{job.title}</h1>
                <p className="st-page-sub">
                  Posted {new Date(job.created_at).toLocaleDateString()}
                  {job.status !== "open" ? ` · Status: ${job.status}` : ""}
                </p>
              </div>
              <span className="st-chip st-chip-blue" style={{ fontSize: 14 }}>
                {employmentTypeLabel(job.employment_type)}
              </span>
            </div>

            <div className="st-grid st-grid-2">
              <section className="st-panel" aria-label="About this role">
                <div className="st-panel-head">
                  <div>
                    <h2>About this role</h2>
                  </div>
                  <span className="st-panel-icon" aria-hidden="true">
                    <Briefcase size={20} />
                  </span>
                </div>
                <p
                  style={{
                    color: "var(--muted)",
                    fontSize: 15,
                    lineHeight: 1.7,
                    whiteSpace: "pre-wrap",
                  }}
                >
                  {job.description}
                </p>
                <div className="st-kv" style={{ marginTop: 22 }}>
                  <div className="st-kv-row">
                    <span>
                      <MapPin size={14} aria-hidden="true" style={{ verticalAlign: -2 }} /> Location
                    </span>
                    <strong>{job.location ?? "—"}</strong>
                  </div>
                  <div className="st-kv-row">
                    <span>
                      <Building2 size={14} aria-hidden="true" style={{ verticalAlign: -2 }} /> Company
                    </span>
                    <strong>{job.company_name ?? "—"}</strong>
                  </div>
                  <div className="st-kv-row">
                    <span>Salary</span>
                    <strong>{formatSalaryRange(job) ?? "Not listed"}</strong>
                  </div>
                  <div className="st-kv-row">
                    <span>
                      <CalendarDays size={14} aria-hidden="true" style={{ verticalAlign: -2 }} /> Posted
                    </span>
                    <strong>{new Date(job.created_at).toLocaleDateString()}</strong>
                  </div>
                </div>
              </section>

              <section className="st-panel" aria-label="Apply">
                <div className="st-panel-head">
                  <div>
                    <h2>Apply</h2>
                    <p className="st-panel-desc">
                      Your application goes straight to the hiring team with
                      your GroundTruth profile attached.
                    </p>
                  </div>
                </div>
                {job.status === "open" ? (
                  <ApplyButton jobId={job.id} />
                ) : (
                  <p className="st-note" style={{ margin: 0 }}>
                    This role is {job.status} and is no longer accepting
                    applications.
                  </p>
                )}
              </section>
            </div>
          </>
        )}
      </main>
    </>
  );
}
