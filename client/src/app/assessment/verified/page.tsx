"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { BadgeCheck, Award } from "lucide-react";
import { RequireAuth } from "@/components/auth/RequireAuth";
import { StudentPageHead, StudentShell } from "@/components/student/StudentShell";
import {
  BackToHub,
  ErrorState,
  LoadingState,
  ScoreBar,
} from "@/components/assessment/shared";
import {
  fetchVerifiedProfile,
  formatDateTime,
  type VerifiedProfile,
} from "@/lib/api";

function VerifiedContent() {
  const [data, setData] = useState<VerifiedProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setData(await fetchVerifiedProfile());
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load your verified profile.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  if (loading) return <LoadingState text="Loading your verified profile…" />;
  if (error || !data) {
    return <ErrorState message={error ?? "Something went wrong."} onRetry={load} />;
  }

  const latest = data.latestAssessment;
  const verified = data.verificationStatus === "Verified";
  /** G6: a verified competency category exists only when the server
   *  assigned one. `isFinal` is also true for "Practical Threshold Not
   *  Met", a status with NO verified category — so "Final result" (and
   *  the green chip) must key off the category, not off isFinal. */
  const competencyVerified = Boolean(data.competencyProfile?.verifiedCategory);

  return (
    <div className="st-stack">
      <section className="st-panel" aria-label="Verification status">
        <div className="st-panel-head">
          <div>
            <h2>{data.fullName}</h2>
            <p className="st-panel-desc">
              Verification status is derived from real evidence only — an
              evaluated assessment, interview score and integrity findings.
            </p>
          </div>
          <span
            className={`st-chip ${verified ? "st-chip-green" : "st-chip-amber"}`}
            style={{ fontSize: 13, padding: "8px 14px" }}
          >
            {verified ? (
              <>
                <BadgeCheck size={15} aria-hidden="true" /> Verified
              </>
            ) : (
              data.verificationStatus
            )}
          </span>
        </div>
        <div className="st-grid st-grid-3" style={{ marginTop: 16 }}>
          <div>
            <p className="st-kv-label">Verification date</p>
            <p style={{ fontWeight: 700 }}>
              {data.verificationDate ? formatDateTime(data.verificationDate) : "Not verified yet"}
            </p>
          </div>
          <div>
            <p className="st-kv-label">Interview score</p>
            <p style={{ fontWeight: 700 }}>
              {data.interviewScore === null ? "No interview yet" : `${data.interviewScore} / 100`}
            </p>
          </div>
          <div>
            <p className="st-kv-label">Verified skills</p>
            <p style={{ fontWeight: 700 }}>
              {data.verifiedSkills.length} skill(s)
            </p>
          </div>
        </div>
      </section>

      <div className="st-grid st-grid-2">
        <section className="st-panel" aria-label="Profile completion">
          <h2>Profile completion</h2>
          <div className="st-meter-row" style={{ marginTop: 12 }}>
            <span className="st-meter-pct">{data.completionScore}%</span>
          </div>
          <div className="st-meter" role="progressbar" aria-valuenow={data.completionScore} aria-label="Profile completion">
            <div className="st-meter-fill" style={{ width: `${data.completionScore}%` }} />
          </div>
          {data.completionMissing.length > 0 ? (
            <>
              <p className="st-panel-desc" style={{ marginTop: 12 }}>Still missing:</p>
              <div className="st-chip-row" style={{ marginTop: 6 }}>
                {data.completionMissing.map((m) => (
                  <span key={m} className="st-chip st-chip-amber">{m}</span>
                ))}
              </div>
            </>
          ) : (
            <p className="st-panel-desc" style={{ marginTop: 12 }}>Nothing missing.</p>
          )}
        </section>

        <section className="st-panel" aria-label="Strength score">
          <h2>Strength score</h2>
          {data.strengthScore === null ? (
            <p className="st-panel-desc" style={{ marginTop: 12 }}>
              No strength analysis yet.{" "}
              <Link href="/assessment/profile" style={{ color: "var(--blue)", fontWeight: 700 }}>
                Run the analysis →
              </Link>
            </p>
          ) : (
            <>
              <span className="as-score-num" style={{ display: "block", marginTop: 12 }}>
                {Math.round(data.strengthScore)}
                <small> / 100</small>
              </span>
              {Object.keys(data.strengthCategories ?? {}).length > 0 ? (
                <div style={{ display: "grid", gap: 12, marginTop: 16 }}>
                  {Object.entries(data.strengthCategories)
                    .filter(([, v]) => typeof v === "number")
                    .map(([k, v]) => (
                      <ScoreBar
                        key={k}
                        label={k.replace(/([a-z])([A-Z])/g, "$1 $2")}
                        score={v as number}
                      />
                    ))}
                </div>
              ) : null}
            </>
          )}
        </section>
      </div>

      <section className="st-panel" aria-label="Verified skills">
        <div className="st-panel-head">
          <div>
            <h2>Verified skills</h2>
            <p className="st-panel-desc">
              Only skills the server lists here are shown as verified. A skill
              is verified only when the assessment evidenced it — untested
              skills are never labelled verified.
            </p>
          </div>
          <span className="st-panel-icon" aria-hidden="true"><Award size={20} /></span>
        </div>
        {data.verifiedSkills.length === 0 ? (
          <p className="st-panel-desc" style={{ marginTop: 12 }}>
            No verified skills yet. Complete an assessment with a functional
            score of 70 or more and the skills evidenced in your submitted code
            will appear here.
          </p>
        ) : (
          <div className="st-list" style={{ marginTop: 12 }}>
            {data.verifiedSkills.map((s) => (
              <details key={`${s.skill}-${s.verifiedAt}`} className="st-list-item" style={{ display: "block" }}>
                <summary
                  style={{ cursor: "pointer", fontWeight: 800, fontSize: 15.5, listStyle: "none" }}
                >
                  ✓ {s.skill}
                  <span className="st-chip st-chip-green" style={{ marginLeft: 10 }}>
                    Verified {formatDateTime(s.verifiedAt)}
                  </span>
                </summary>
                <div style={{ marginTop: 10 }}>
                  <p className="st-list-meta">
                    Evidence (from the server):
                  </p>
                  <pre className="as-pre light">{JSON.stringify(s.evidence, null, 2)}</pre>
                  {s.assessmentId ? (
                    <p style={{ marginTop: 10 }}>
                      <Link
                        href={`/assessment/${s.assessmentId}/evaluation`}
                        className="st-btn st-btn-outline st-btn-sm"
                      >
                        View the assessment evaluation
                      </Link>
                    </p>
                  ) : null}
                </div>
              </details>
            ))}
          </div>
        )}
      </section>

      <section className="st-panel" aria-label="Latest assessment">
        <h2>Latest assessment</h2>
        {!latest ? (
          <p className="st-panel-desc" style={{ marginTop: 8 }}>
            No assessment yet.{" "}
            <Link href="/assessment/new" style={{ color: "var(--blue)", fontWeight: 700 }}>
              Start one →
            </Link>
          </p>
        ) : (
          <div style={{ marginTop: 12 }}>
            <h3 style={{ fontSize: 18 }}>{latest.challengeTitle ?? "Assessment"}</h3>
            <p className="st-list-meta">
              Status: {latest.status}
              {latest.submittedAt ? ` · Submitted ${formatDateTime(latest.submittedAt)}` : ""}
            </p>
            <div className="st-grid st-grid-3" style={{ marginTop: 14 }}>
              <div>
                <p className="st-kv-label">Overall score</p>
                <p style={{ fontWeight: 700 }}>
                  {latest.overallScore === null ? "Not evaluated" : `${latest.overallScore} / 100`}
                </p>
              </div>
              <div>
                <p className="st-kv-label">Test pass rate</p>
                <p style={{ fontWeight: 700 }}>
                  {latest.testPassRate === null
                    ? "—"
                    : `${Math.round(latest.testPassRate * 100)}%`}
                </p>
              </div>
              <div>
                <p className="st-kv-label">Quality issues</p>
                <p style={{ fontWeight: 700 }}>{latest.qualityIssues.length}</p>
              </div>
            </div>
            {latest.qualityIssues.length > 0 ? (
              <ul className="as-list" style={{ marginTop: 10 }}>
                {latest.qualityIssues.map((q, i) => (
                  <li key={i} className="bad">{q}</li>
                ))}
              </ul>
            ) : null}
            <p style={{ marginTop: 16, display: "flex", gap: 10, flexWrap: "wrap" }}>
              <Link href={`/assessment/${latest.id}/evaluation`} className="st-btn st-btn-outline st-btn-sm">
                Evaluation
              </Link>
              <Link href={`/assessment/${latest.id}/interview`} className="st-btn st-btn-outline st-btn-sm">
                Interview
              </Link>
              <Link href={`/assessment/${latest.id}/competency`} className="st-btn st-btn-outline st-btn-sm">
                Competency profile
              </Link>
              <Link href={`/assessment/${latest.id}/report`} className="st-btn st-btn-outline st-btn-sm">
                Monitoring report
              </Link>
            </p>
          </div>
        )}
      </section>

      {data.competencyProfile && latest ? (
        <section className="st-panel" aria-label={competencyVerified ? "Final competency profile" : "Provisional competency profile"}>
          <div className="st-panel-head">
            <div>
              <h2>{competencyVerified ? "Final competency profile" : "Provisional competency profile"}</h2>
              <p className="st-panel-desc">
                {data.competencyProfile.roleName} · Framework{" "}
                {data.competencyProfile.frameworkVersion} ·{" "}
                {competencyVerified
                  ? "Final result"
                  : "Provisional result — no verified category yet"}
              </p>
            </div>
            <span className="as-score-num">
              {data.competencyProfile.overallScore === null
                ? "—"
                : Math.round(data.competencyProfile.overallScore)}
              <small> / 100</small>
            </span>
          </div>
          <p className="st-panel-desc" style={{ marginTop: 4 }}>
            {competencyVerified ? "Verified score" : "Provisional score"}
          </p>
          <p style={{ marginTop: 12 }}>
            <span
              className={`st-chip ${competencyVerified ? "st-chip-green" : "st-chip-amber"}`}
              style={{ fontSize: 13, padding: "6px 12px" }}
            >
              {competencyVerified
                ? `${data.competencyProfile.status}${data.competencyProfile.overallCategoryLabel ? ` · ${data.competencyProfile.overallCategoryLabel}` : ""}`
                : `Provisional · ${data.competencyProfile.status}${data.competencyProfile.provisionalCategoryLabel ? ` · ${data.competencyProfile.provisionalCategoryLabel}` : ""}`}
            </span>
          </p>
          {!competencyVerified ? (
            <div className="as-alert as-alert-warn" role="note" style={{ marginTop: 12 }}>
              <strong>Provisional — not a final result.</strong> There is no
              verified competency category yet — the score above is
              provisional, computed from the sources present so far. Complete
              the coding evaluation, the AI interview and the verified
              evidence first, then recompute.
              {data.competencyProfile.interviewCoverage && !data.competencyProfile.interviewCoverage.complete
                ? ` Interview: ${data.competencyProfile.interviewCoverage.provisionalNote ?? "incomplete"}.`
                : ""}
            </div>
          ) : null}
          <p style={{ marginTop: 14 }}>
            <Link
              href={`/assessment/${latest.id}/competency`}
              className="st-btn st-btn-blue st-btn-sm"
            >
              View full competency profile
            </Link>
          </p>
        </section>
      ) : null}

      <div>
        <BackToHub />
      </div>
    </div>
  );
}

export default function VerifiedProfilePage() {
  return (
    <RequireAuth roles={["candidate"]}>
      <StudentShell>
        <StudentPageHead
          eyebrow="Verified Engineering Profile"
          title={<>Your <span className="blue">verified</span> profile</>}
          sub="The profile recruiters see — completion, strength, skills verified by real assessment evidence, your latest assessment and interview score."
        />
        <VerifiedContent />
      </StudentShell>
    </RequireAuth>
  );
}
