"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { CheckCircle2 } from "lucide-react";
import { useAuth } from "@/lib/auth-context";
import { applyToJob, fetchMyApplications } from "@/lib/api";

/**
 * The apply control on a job detail page.
 * - Signed out → sign-in link (returns here after login via ?next=).
 * - Recruiter/admin → honest note (recruiters can't apply to roles).
 * - Candidate who already applied → their real status + dashboard link.
 * - Candidate who hasn't → Apply button → POST /api/jobs/:id/apply.
 */
export function ApplyButton({ jobId }: { jobId: string }) {
  const { user, loading } = useAuth();
  const [appliedStatus, setAppliedStatus] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  useEffect(() => {
    if (!user || user.role !== "candidate") return;
    setChecking(true);
    fetchMyApplications()
      .then((apps) => {
        const mine = apps.find((a) => a.job_id === jobId);
        if (mine) setAppliedStatus(mine.status);
      })
      .catch(() => undefined)
      .finally(() => setChecking(false));
  }, [user, jobId]);

  if (loading || checking) {
    return (
      <button type="button" className="st-btn st-btn-blue" disabled>
        Checking…
      </button>
    );
  }

  if (!user) {
    return (
      <Link
        href={`/auth/login?next=${encodeURIComponent(`/jobs/${jobId}`)}`}
        className="st-btn st-btn-blue"
      >
        Sign in to apply
      </Link>
    );
  }

  if (user.role !== "candidate") {
    return (
      <p className="st-note" style={{ margin: 0 }}>
        You&apos;re signed in as a {user.role} — only student accounts can
        apply to roles.
      </p>
    );
  }

  if (appliedStatus !== null || done) {
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 10, alignItems: "flex-start" }}>
        <span className="st-chip st-chip-green">
          <CheckCircle2 size={14} aria-hidden="true" /> Applied
          {appliedStatus ? ` · ${appliedStatus}` : ""}
        </span>
        <Link href="/student/dashboard" className="st-btn st-btn-outline st-btn-sm">
          Track it on your dashboard
        </Link>
      </div>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10, alignItems: "flex-start" }}>
      <button
        type="button"
        className="st-btn st-btn-blue"
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          setError(null);
          try {
            const app = await applyToJob(jobId);
            setAppliedStatus(app.status);
            setDone(true);
          } catch (err) {
            setError(err instanceof Error ? err.message : "Could not apply.");
          } finally {
            setBusy(false);
          }
        }}
      >
        {busy ? "Applying…" : "Apply for this role"}
      </button>
      {error !== null ? (
        <p className="st-error-text" role="alert">
          {error}
        </p>
      ) : null}
      <p className="st-note" style={{ margin: 0 }}>
        One application per role — applying again just shows your existing
        application.
      </p>
    </div>
  );
}
