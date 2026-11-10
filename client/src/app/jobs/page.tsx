import Link from "next/link";
import { fetchJobs, type Job } from "@/lib/api";

function JobCard({ job }: { job: Job }) {
  return (
    <article className="job-card">
      <h2>{job.title}</h2>
      <p className="muted">
        {job.company_name ?? "Unknown company"}
        {job.location ? ` · ${job.location}` : ""}
        {job.employment_type ? ` · ${job.employment_type.replace("_", " ")}` : ""}
      </p>
      <p>{job.description}</p>
    </article>
  );
}

export default async function JobsPage() {
  let jobs: Job[] | null = null;
  let error: string | null = null;
  try {
    jobs = await fetchJobs();
  } catch (err) {
    error = err instanceof Error ? err.message : "Failed to load jobs.";
  }

  return (
    <main className="container">
      <h1>Open roles</h1>
      <p>
        <Link href="/">← Back to home</Link>
      </p>
      {error !== null ? (
        <div className="error" role="alert">
          <strong>Couldn&apos;t load jobs.</strong> {error} Is the server
          running at <code>NEXT_PUBLIC_API_URL</code>?
        </div>
      ) : jobs !== null && jobs.length === 0 ? (
        <p className="muted">No open roles right now — check back soon.</p>
      ) : (
        jobs?.map((job) => <JobCard key={job.id} job={job} />)
      )}
    </main>
  );
}
