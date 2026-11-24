"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ClipboardCheck, FileCheck2, FlaskConical, Plus } from "lucide-react";
import { RequireAuth } from "@/components/auth/RequireAuth";
import { StudentPageHead, StudentShell } from "@/components/student/StudentShell";
import {
  ErrorState,
  LoadingState,
  ScoreBar,
  StatusChip,
} from "@/components/assessment/shared";
import {
  fetchAssessments,
  fetchProfileStrength,
  formatDateTime,
  type AssessmentRow,
  type ProfileAnalysisRow,
} from "@/lib/api";
import { fetchProfile, type FullProfile } from "@/lib/student";

function HubContent() {
  const [profile, setProfile] = useState<FullProfile | null>(null);
  const [strength, setStrength] = useState<ProfileAnalysisRow | null>(null);
  const [assessments, setAssessments] = useState<AssessmentRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [p, a] = await Promise.all([
          fetchProfile(),
          fetchAssessments(),
        ]);
        // A missing analysis is a normal empty state (404), not an error.
        const s = await fetchProfileStrength().catch(() => null);
        if (cancelled) return;
        setProfile(p);
        setAssessments(a);
        setStrength(s);
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Could not load your assessments.");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  if (loading) return <LoadingState text="Loading your assessments…" />;
  if (error || !profile) {
    return <ErrorState message={error ?? "Something went wrong."} onRetry={() => window.location.reload()} />;
  }

  const completeness = profile.completeness.percent;
  const strengthScore =
    strength === null ? null : Number(strength.overall_score);
  const recommendations = strength?.recommendations ?? [];
  const cats = (strength?.category_scores ?? {}) as Record<string, unknown>;

  return (
    <div className="st-stack">
      <div className="st-grid st-grid-3">
        <section className="st-panel" aria-label="Profile completion">
          <div className="st-panel-head">
            <div>
              <h2>Profile completion</h2>
              <p className="st-panel-desc">From your student profile.</p>
            </div>
            <span className="st-panel-icon" aria-hidden="true"><FileCheck2 size={20} /></span>
          </div>
          <div className="st-meter-row">
            <span className="st-meter-pct">{completeness}%</span>
            <span className="st-stat-sub">
              {profile.completeness.missing.length === 0
                ? "All sections complete"
                : `${profile.completeness.missing.length} section(s) still to fill`}
            </span>
          </div>
          <div className="st-meter" role="progressbar" aria-valuenow={completeness} aria-label="Profile completion">
            <div className="st-meter-fill" style={{ width: `${completeness}%` }} />
          </div>
          <p style={{ marginTop: 14 }}>
            <Link href="/student/profile" className="st-btn st-btn-outline st-btn-sm">
              View my profile
            </Link>
          </p>
        </section>

        <section className="st-panel" aria-label="AI strength score">
          <div className="st-panel-head">
            <div>
              <h2>Strength score</h2>
              <p className="st-panel-desc">Latest AI profile analysis.</p>
            </div>
            <span className="st-panel-icon" aria-hidden="true"><ClipboardCheck size={20} /></span>
          </div>
          {strengthScore === null ? (
            <>
              <p className="st-panel-desc">
                No analysis yet. Run one to see your overall score, weak areas and
                what to fix first.
              </p>
              <p style={{ marginTop: 14 }}>
                <Link href="/assessment/profile" className="st-btn st-btn-blue st-btn-sm">
                  Run analysis
                </Link>
              </p>
            </>
          ) : (
            <>
              <span className="as-score-num">
                {Math.round(strengthScore)}
                <small> / 100</small>
              </span>
              <p className="st-panel-desc" style={{ marginTop: 8 }}>
                Analysed {formatDateTime(strength?.created_at)}
                {strength?.ai_available ? " · AI-assisted" : " · Deterministic scoring (AI unavailable)"}
              </p>
              <p style={{ marginTop: 14 }}>
                <Link href="/assessment/profile" className="st-btn st-btn-outline st-btn-sm">
                  Full strength dashboard
                </Link>
              </p>
            </>
          )}
        </section>

        <section className="st-panel" aria-label="Verified profile">
          <div className="st-panel-head">
            <div>
              <h2>Verified profile</h2>
              <p className="st-panel-desc">Skills verified only by real evidence.</p>
            </div>
            <span className="st-panel-icon" aria-hidden="true"><FlaskConical size={20} /></span>
          </div>
          <p className="st-panel-desc">
            Your final verified engineering profile — completion, strength,
            verified skills and your latest assessment, all from the server.
          </p>
          <p style={{ marginTop: 14 }}>
            <Link href="/assessment/verified" className="st-btn st-btn-blue st-btn-sm">
              View verified profile
            </Link>
          </p>
        </section>
      </div>

      {recommendations.length > 0 ? (
        <section className="st-panel" aria-label="Top recommendations">
          <h2>Top recommendations</h2>
          <p className="st-panel-desc">
            From your latest analysis — each one shows why it matters and how
            many points it is worth.
          </p>
          <ul className="as-list">
            {recommendations.slice(0, 3).map((r) => (
              <li key={r.id}>
                <span>
                  <strong style={{ color: "var(--ink)" }}>{r.title}</strong>
                  {r.why ? ` — ${r.why}` : ""} (+{r.points} pts)
                </span>
              </li>
            ))}
          </ul>
          <p style={{ marginTop: 14 }}>
            <Link href="/assessment/profile" className="st-btn st-btn-outline st-btn-sm">
              See all recommendations
            </Link>
          </p>
        </section>
      ) : null}

      {strength !== null && Object.keys(cats).length > 0 ? (
        <section className="st-panel" aria-label="Category scores">
          <h2>Category scores</h2>
          <div className="st-grid st-grid-2" style={{ marginTop: 16 }}>
            {Object.entries(cats)
              .filter(([, v]) => typeof v === "number")
              .map(([k, v]) => (
                <ScoreBar key={k} label={k.replace(/([a-z])([A-Z])/g, "$1 $2")} score={v as number} />
              ))}
            {typeof cats.profileCompleteness === "object" && cats.profileCompleteness !== null ? (
              <ScoreBar
                label="Profile completeness"
                score={(cats.profileCompleteness as { score: number }).score}
                hint={(cats.profileCompleteness as { detail: string }).detail}
              />
            ) : null}
          </div>
        </section>
      ) : null}

      <section className="st-panel" aria-label="My assessments">
        <div className="st-panel-head">
          <div>
            <h2>My assessments</h2>
            <p className="st-panel-desc">Every assessment you have started, newest first.</p>
          </div>
          <Link href="/assessment/new" className="st-btn st-btn-blue st-btn-sm">
            <Plus size={15} aria-hidden="true" /> Start new assessment
          </Link>
        </div>
        {assessments.length === 0 ? (
          <div className="st-empty-inline">
            <h3>No assessments yet</h3>
            <p>
              Start your first assessment from your profile project or the demo
              project. You will get a real coding challenge, a live Lab, an
              evaluation and an AI interview.
            </p>
            <Link href="/assessment/new" className="st-btn st-btn-blue">
              Start new assessment
            </Link>
          </div>
        ) : (
          <div className="st-list">
            {assessments.map((a) => (
              <article key={a.id} className="st-list-item">
                <div>
                  <h3>
                    <Link href={`/assessment/${a.id}/challenge`}>
                      Assessment · {a.time_limit_minutes} min
                    </Link>
                  </h3>
                  <p className="st-list-meta">
                    Created {formatDateTime(a.created_at)}
                    {a.started_at ? ` · Started ${formatDateTime(a.started_at)}` : ""}
                    {a.submitted_at ? ` · Submitted ${formatDateTime(a.submitted_at)}` : ""}
                  </p>
                  <div className="st-chip-row">
                    <StatusChip status={a.status} />
                    {a.consent_given_at ? (
                      <span className="st-chip st-chip-green">Consent given</span>
                    ) : (
                      <span className="st-chip">Consent pending</span>
                    )}
                  </div>
                </div>
                <div className="st-list-actions">
                  <Link
                    href={`/assessment/${a.id}/challenge`}
                    className="st-btn st-btn-outline st-btn-sm"
                  >
                    Open
                  </Link>
                  {a.status === "active" ? (
                    <Link href={`/assessment/${a.id}/lab`} className="st-btn st-btn-blue st-btn-sm">
                      Continue Lab
                    </Link>
                  ) : null}
                  {["submitted", "evaluating", "completed"].includes(a.status) ? (
                    <Link href={`/assessment/${a.id}/evaluation`} className="st-btn st-btn-blue st-btn-sm">
                      Evaluation
                    </Link>
                  ) : null}
                </div>
              </article>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

export default function AssessmentHubPage() {
  return (
    <RequireAuth roles={["candidate"]}>
      <StudentShell>
        <StudentPageHead
          eyebrow="GroundTruth Assessment"
          title={<>Engineering assessments, <span className="blue">verified by evidence</span></>}
          sub="Take a real coding challenge in a monitored Lab, get an honest evaluation and a code-grounded interview — then share a verified profile with recruiters."
          actions={
            <Link href="/assessment/new" className="st-btn st-btn-blue">
              <Plus size={16} aria-hidden="true" /> Start new assessment
            </Link>
          }
        />
        <HubContent />
      </StudentShell>
    </RequireAuth>
  );
}
