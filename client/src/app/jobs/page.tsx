"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { ArrowRight, Briefcase, MapPin, Search } from "lucide-react";
import { JobsNav } from "./JobsNav";
import {
  employmentTypeLabel,
  fetchJobs,
  formatSalaryRange,
  type Job,
} from "@/lib/api";

const TYPE_FILTERS = [
  { value: "all", label: "All types" },
  { value: "full_time", label: "Full-time" },
  { value: "part_time", label: "Part-time" },
  { value: "contract", label: "Contract" },
  { value: "internship", label: "Internship" },
] as const;

function JobCard({ job }: { job: Job }) {
  const salary = formatSalaryRange(job);
  return (
    <article className="st-panel">
      <div className="st-panel-head">
        <div>
          <h2>
            <Link href={`/jobs/${job.id}`}>{job.title}</Link>
          </h2>
          <p className="st-panel-desc">
            {job.company_name ?? "Unknown company"}
            {job.location ? ` · ${job.location}` : ""}
          </p>
        </div>
        <span className="st-chip st-chip-blue">{employmentTypeLabel(job.employment_type)}</span>
      </div>
      <p style={{ color: "var(--muted)", fontSize: 15, lineHeight: 1.6 }}>
        {job.description.length > 220
          ? `${job.description.slice(0, 220).trimEnd()}…`
          : job.description}
      </p>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 12,
          marginTop: 18,
          flexWrap: "wrap",
        }}
      >
        <span style={{ fontWeight: 700, fontSize: 14 }}>
          {salary ?? "Salary not listed"}
        </span>
        <Link href={`/jobs/${job.id}`} className="st-btn st-btn-blue st-btn-sm">
          View role <ArrowRight size={15} aria-hidden="true" />
        </Link>
      </div>
    </article>
  );
}

export default function JobsPage() {
  const [jobs, setJobs] = useState<Job[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [type, setType] = useState<string>("all");
  const [place, setPlace] = useState("");

  useEffect(() => {
    fetchJobs()
      .then(setJobs)
      .catch((err) =>
        setError(err instanceof Error ? err.message : "Could not load jobs."),
      );
  }, []);

  const filtered = useMemo(() => {
    if (!jobs) return [];
    const q = query.trim().toLowerCase();
    const p = place.trim().toLowerCase();
    return jobs.filter((job) => {
      if (type !== "all" && job.employment_type !== type) return false;
      if (p && !(job.location ?? "").toLowerCase().includes(p)) return false;
      if (!q) return true;
      return (
        job.title.toLowerCase().includes(q) ||
        (job.company_name ?? "").toLowerCase().includes(q) ||
        job.description.toLowerCase().includes(q)
      );
    });
  }, [jobs, query, type, place]);

  return (
    <>
      <JobsNav />
      <main className="st-page">
        <div className="st-page-head">
          <div>
            <p className="st-eyebrow">Job board</p>
            <h1 className="st-page-title">
              Open roles, <span className="blue">verified employers.</span>
            </h1>
            <p className="st-page-sub">
              Every role below is live in the database right now — posted by a
              real recruiter, not a sample listing.
            </p>
          </div>
        </div>

        <div className="st-panel" style={{ marginBottom: 22 }} aria-label="Search and filter jobs">
          <div className="st-form-grid" style={{ gridTemplateColumns: "2fr 1fr 1fr" }}>
            <label className="st-field">
              <span className="st-label">Search roles, companies, keywords</span>
              <span style={{ position: "relative", display: "block" }}>
                <Search
                  size={16}
                  aria-hidden="true"
                  style={{ position: "absolute", left: 12, top: 13, color: "var(--muted)" }}
                />
                <input
                  className="st-input"
                  style={{ paddingLeft: 36 }}
                  type="search"
                  placeholder="e.g. Backend Engineer, Acme"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                />
              </span>
            </label>
            <label className="st-field">
              <span className="st-label">Job type</span>
              <select
                className="st-input st-select"
                value={type}
                onChange={(e) => setType(e.target.value)}
              >
                {TYPE_FILTERS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="st-field">
              <span className="st-label">Location</span>
              <span style={{ position: "relative", display: "block" }}>
                <MapPin
                  size={16}
                  aria-hidden="true"
                  style={{ position: "absolute", left: 12, top: 13, color: "var(--muted)" }}
                />
                <input
                  className="st-input"
                  style={{ paddingLeft: 36 }}
                  type="text"
                  placeholder="e.g. Bengaluru"
                  value={place}
                  onChange={(e) => setPlace(e.target.value)}
                />
              </span>
            </label>
          </div>
        </div>

        {error !== null ? (
          <div className="st-empty" role="alert">
            <h2>Couldn&apos;t load jobs</h2>
            <p>{error}</p>
            <button
              type="button"
              className="st-btn st-btn-blue"
              onClick={() => window.location.reload()}
            >
              Try again
            </button>
          </div>
        ) : jobs === null ? (
          <div className="st-loading" role="status" aria-label="Loading">
            <span className="st-spinner" aria-hidden="true" />
            <p>Loading open roles…</p>
          </div>
        ) : (
          <>
            <p style={{ color: "var(--muted)", fontSize: 14, fontWeight: 600, marginBottom: 16 }}>
              {filtered.length} open role{filtered.length === 1 ? "" : "s"}
              {filtered.length !== jobs.length ? ` (of ${jobs.length} total)` : ""}
            </p>
            {filtered.length === 0 ? (
              <div className="st-empty">
                <span className="st-empty-icon" aria-hidden="true">
                  <Briefcase size={22} />
                </span>
                <h2>No roles match that search</h2>
                <p>
                  {jobs.length === 0
                    ? "No open roles right now — check back soon."
                    : "Try a different keyword, job type or location."}
                </p>
                {jobs.length > 0 ? (
                  <button
                    type="button"
                    className="st-btn st-btn-outline"
                    onClick={() => {
                      setQuery("");
                      setType("all");
                      setPlace("");
                    }}
                  >
                    Clear filters
                  </button>
                ) : null}
              </div>
            ) : (
              <div className="st-stack">
                {filtered.map((job) => (
                  <JobCard key={job.id} job={job} />
                ))}
              </div>
            )}
          </>
        )}
      </main>
    </>
  );
}
