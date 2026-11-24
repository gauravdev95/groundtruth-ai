"use client";

import { useCallback, useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { RefreshCw } from "lucide-react";
import { RequireAuth } from "@/components/auth/RequireAuth";
import { StudentPageHead, StudentShell } from "@/components/student/StudentShell";
import {
  BackToHub,
  ErrorState,
  InlineError,
  LoadingState,
} from "@/components/assessment/shared";
import { CompetencyProfileView } from "@/components/assessment/CompetencyProfile";
import {
  ApiHttpError,
  computeCompetencyProfile,
  fetchAssessment,
  fetchCompetencyProfile,
  type CompetencyProfileView as CompetencyProfile,
} from "@/lib/api";

/**
 * Candidate competency profile page (Phase E) — one assessment's final
 * profile, computed from the coding evaluation, the completed interview
 * and independently verified evidence. Compute is idempotent: the same
 * inputs return the stored profile, never a duplicate; a final profile
 * is never rewritten. A profile that is Incomplete / Insufficient
 * Evidence is a provisional draft — the page says so plainly and shows
 * exactly which sources are missing.
 */
function CompetencyContent() {
  const params = useParams<{ id: string }>();
  const id = params.id;
  const [profile, setProfile] = useState<CompetencyProfile | null>(null);
  const [notComputed, setNotComputed] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [computing, setComputing] = useState(false);
  const [computeError, setComputeError] = useState<string | null>(null);
  const [computeNote, setComputeNote] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    setNotComputed(false);
    try {
      const a = await fetchAssessment(id);
      setStatus(a.status);
      try {
        setProfile(await fetchCompetencyProfile(id));
      } catch (err) {
        if (err instanceof ApiHttpError && err.status === 404) {
          setNotComputed(true);
          setProfile(null);
        } else {
          throw err;
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load the competency profile.");
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    load();
  }, [load]);

  async function onCompute() {
    setComputing(true);
    setComputeError(null);
    setComputeNote(null);
    try {
      const result = await computeCompetencyProfile(id);
      setProfile(result.profile);
      setNotComputed(false);
      if (result.note) setComputeNote(result.note);
    } catch (err) {
      setComputeError(err instanceof Error ? err.message : "Could not compute the profile.");
    } finally {
      setComputing(false);
    }
  }

  if (loading) return <LoadingState text="Loading your competency profile…" />;
  if (error) {
    return <ErrorState message={error} onRetry={load} />;
  }

  return (
    <div className="st-stack">
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
        <button
          type="button"
          className="st-btn st-btn-blue"
          onClick={onCompute}
          disabled={computing}
        >
          <RefreshCw size={16} aria-hidden="true" />
          {computing
            ? "Computing…"
            : profile
              ? "Recompute profile"
              : "Compute my competency profile"}
        </button>
        <Link href={`/assessment/${id}/evaluation`} className="st-btn st-btn-outline">
          Evaluation
        </Link>
        <Link href={`/assessment/${id}/interview`} className="st-btn st-btn-outline">
          AI interview
        </Link>
        <Link href="/assessment/verified" className="st-btn st-btn-outline">
          Verified profile
        </Link>
      </div>
      {computeError ? <InlineError message={computeError} /> : null}
      {computeNote ? (
        <div className="as-alert as-alert-warn" role="note">
          {computeNote}
        </div>
      ) : null}

      {notComputed ? (
        <section className="st-panel" aria-label="No competency profile yet">
          <h2>No competency profile yet</h2>
          <p className="st-panel-desc">
            The final profile blends three real sources for this assessment: the
            coding evaluation (50%), the completed AI interview (30%) and
            independently verified evidence (20%).{" "}
            {status === "completed"
              ? "Your assessment is complete — compute the profile to see your overall score, per-competency categories, strengths and improvement areas."
              : `This assessment is ${status ?? "not complete"} — finish and evaluate it first; the profile is computed from the completed sources.`}
          </p>
          <p className="st-panel-desc" style={{ marginTop: 8 }}>
            If a source is still missing, the profile is still computed — but it
            is marked “Assessment Incomplete” or “Insufficient Evidence” and
            carries only a provisional score: no verified competency
            category is assigned until every source is complete, every
            competency meets its minimum evidence, the practical coding
            minimum is met and the interview is fully evaluated. Nothing
            is invented, and no score is ever a silent zero.
          </p>
        </section>
      ) : profile ? (
        <CompetencyProfileView profile={profile} />
      ) : null}

      <div>
        <BackToHub />
      </div>
    </div>
  );
}

export default function AssessmentCompetencyPage() {
  return (
    <RequireAuth roles={["candidate"]}>
      <StudentShell>
        <StudentPageHead
          eyebrow="Competency Profile"
          title={<>Your final <span className="blue">competency profile</span></>}
          sub="Overall and per-competency scores from the coding evaluation, the AI interview and verified evidence — with the safeguards shown honestly."
        />
        <CompetencyContent />
      </StudentShell>
    </RequireAuth>
  );
}
