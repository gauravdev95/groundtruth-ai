"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { RefreshCw } from "lucide-react";
import { RequireAuth } from "@/components/auth/RequireAuth";
import { StudentPageHead, StudentShell } from "@/components/student/StudentShell";
import {
  BackToHub,
  ErrorState,
  InlineError,
  LoadingState,
  ScoreBar,
} from "@/components/assessment/shared";
import {
  analyzeProfileStrength,
  fetchProfileRecommendations,
  fetchProfileStrength,
  formatDateTime,
  type ProfileAnalysisRow,
  type StrengthReport,
} from "@/lib/api";

/** One analysis, rendered from the server response only — no invented scores. */
function AnalysisView({
  data,
  createdAt,
  previousOverall,
}: {
  data: StrengthReport;
  createdAt: string | null;
  previousOverall: number | null;
}) {
  const cats = data.categories;
  const delta =
    previousOverall === null ? null : Math.round((data.overall - previousOverall) * 10) / 10;
  return (
    <div className="st-stack">
      <section className="st-panel" aria-label="Overall strength">
        <div className="st-panel-head">
          <div>
            <h2>Overall strength</h2>
            <p className="st-panel-desc">
              {createdAt ? `Analysed ${formatDateTime(createdAt)}` : "Just analysed"}
              {data.aiAvailable
                ? " · AI-assisted analysis"
                : " · Deterministic scoring — AI was unavailable, so scores come from the rule-based analysis"}
            </p>
          </div>
          <span className="as-score-num">
            {Math.round(data.overall)}
            <small> / 100</small>
          </span>
        </div>
        {delta !== null ? (
          <p className="st-panel-desc">
            {delta > 0
              ? `Up ${delta} points since your previous analysis.`
              : delta < 0
                ? `Down ${Math.abs(delta)} points since your previous analysis.`
                : "Same score as your previous analysis."}
          </p>
        ) : (
          <p className="st-panel-desc">This is your first analysis — run it again after improving your profile to track progress.</p>
        )}
        {data.aiSummary ? (
          <div className="st-note" style={{ marginTop: 16 }}>
            <strong>AI summary: </strong>
            {data.aiSummary}
          </div>
        ) : null}
        <div className="st-grid st-grid-2" style={{ marginTop: 20 }}>
          <ScoreBar label="Skill coverage" score={cats.skillCoverage} />
          <ScoreBar label="Project evidence" score={cats.projectEvidence} />
          <ScoreBar label="Experience" score={cats.experience} />
          <ScoreBar label="Resume consistency" score={cats.resumeConsistency} />
          <ScoreBar
            label="Profile completeness"
            score={cats.profileCompleteness.score}
            hint={cats.profileCompleteness.detail}
          />
        </div>
      </section>

      {data.missing.length > 0 ? (
        <section className="st-panel" aria-label="Missing information">
          <h2>Missing information</h2>
          <p className="st-panel-desc">Things the analysis could not find on your profile.</p>
          <ul className="as-list">
            {data.missing.map((m) => (
              <li key={m} className="bad">{m}</li>
            ))}
          </ul>
        </section>
      ) : null}

      {data.weakAreas.length > 0 ? (
        <section className="st-panel" aria-label="Weak areas">
          <h2>Weak areas</h2>
          <p className="st-panel-desc">The lowest-scoring parts of your profile.</p>
          <div className="st-chip-row" style={{ marginTop: 12 }}>
            {data.weakAreas.map((w) => (
              <span key={w} className="st-chip st-chip-amber">{w}</span>
            ))}
          </div>
        </section>
      ) : null}

      <section className="st-panel" aria-label="Recommendations">
        <h2>Recommendations</h2>
        <p className="st-panel-desc">Each recommendation shows why it matters and how many points it is worth.</p>
        {data.recommendations.length === 0 ? (
          <p className="st-panel-desc" style={{ marginTop: 12 }}>
            No recommendations — your profile already covers what the analysis checks.
          </p>
        ) : (
          <div className="st-list">
            {data.recommendations.map((r) => (
              <article key={r.id} className="st-list-item">
                <div>
                  <h3>{r.title}</h3>
                  <p className="st-list-meta">
                    <strong style={{ color: "var(--ink)" }}>Why: </strong>
                    {r.why}
                  </p>
                  <p className="st-list-meta">{r.action}</p>
                </div>
                <span className="st-chip st-chip-blue">+{r.points} pts</span>
              </article>
            ))}
          </div>
        )}
      </section>

      {data.suggestedSkills.length > 0 ? (
        <section className="st-panel" aria-label="Suggested skills">
          <h2>Suggested skills</h2>
          <p className="st-panel-desc">Skills the analysis suggests adding — only add ones you can actually evidence.</p>
          <div className="st-chip-row" style={{ marginTop: 12 }}>
            {data.suggestedSkills.map((s) => (
              <span key={s} className="st-chip st-chip-blue">{s}</span>
            ))}
          </div>
        </section>
      ) : null}
    </div>
  );
}

function ProfileStrengthContent() {
  const [latest, setLatest] = useState<ProfileAnalysisRow | null>(null);
  const [previousOverall, setPreviousOverall] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const [runError, setRunError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const row = await fetchProfileStrength();
      setLatest(row);
      // Progress tracking: the server only exposes the latest analysis row,
      // so a "previous" score is only known within this session — onRun()
      // below snapshots it before re-running.
    } catch (err) {
      // 404 = no analysis yet: a normal empty state, handled below.
      const msg = err instanceof Error ? err.message : "";
      if (!/No profile analysis yet/i.test(msg)) {
        setError(msg || "Could not load your strength analysis.");
      } else {
        setLatest(null);
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
    // Also fetch the recommendations endpoint once so a stale row is caught.
    fetchProfileRecommendations().catch(() => undefined);
  }, [load]);

  async function onRun() {
    setRunning(true);
    setRunError(null);
    try {
      const report = await analyzeProfileStrength();
      setPreviousOverall(
        latest === null ? null : Number(latest.overall_score),
      );
      // Re-read the stored row so created_at / stored categories match the DB.
      await load();
      setLatest((cur) =>
        cur ?? {
          id: "",
          candidate_id: "",
          overall_score: report.overall,
          category_scores: report.categories,
          missing: report.missing,
          weak_areas: report.weakAreas,
          recommendations: report.recommendations,
          suggested_skills: report.suggestedSkills,
          ai_available: report.aiAvailable,
          ai_summary: report.aiSummary,
          created_at: new Date().toISOString(),
        },
      );
    } catch (err) {
      setRunError(err instanceof Error ? err.message : "Analysis failed.");
    } finally {
      setRunning(false);
    }
  }

  if (loading) return <LoadingState text="Loading your strength analysis…" />;
  if (error) {
    return <ErrorState message={error} onRetry={load} />;
  }

  const report: StrengthReport | null =
    latest === null
      ? null
      : {
          overall: Number(latest.overall_score),
          categories: latest.category_scores as StrengthReport["categories"],
          missing: latest.missing ?? [],
          weakAreas: latest.weak_areas ?? [],
          recommendations: latest.recommendations ?? [],
          suggestedSkills: latest.suggested_skills ?? [],
          aiAvailable: latest.ai_available,
          aiSummary: latest.ai_summary,
        };

  return (
    <div className="st-stack">
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
        <button
          type="button"
          className="st-btn st-btn-blue"
          onClick={onRun}
          disabled={running}
        >
          <RefreshCw size={16} aria-hidden="true" />
          {running ? "Running analysis…" : latest ? "Run analysis again" : "Run analysis"}
        </button>
        <Link href="/student/profile" className="st-btn st-btn-outline">
          Edit my profile
        </Link>
      </div>
      {runError ? <InlineError message={runError} /> : null}
      {report === null ? (
        <section className="st-panel" aria-label="No analysis yet">
          <h2>No analysis yet</h2>
          <p className="st-panel-desc">
            Run your first AI strength analysis. It scores your skills, project
            evidence, experience, resume consistency and profile completeness,
            then tells you exactly what is missing and what to fix first.
          </p>
        </section>
      ) : (
        <AnalysisView
          data={report}
          createdAt={latest?.created_at ?? null}
          previousOverall={previousOverall}
        />
      )}
      <div>
        <BackToHub />
      </div>
    </div>
  );
}

export default function AssessmentProfilePage() {
  return (
    <RequireAuth roles={["candidate"]}>
      <StudentShell>
        <StudentPageHead
          eyebrow="AI Strength Dashboard"
          title={<>How strong is your <span className="blue">profile?</span></>}
          sub="An honest, evidence-based read of your profile — overall and category scores, missing information, weak areas, and recommendations with the reason and the points behind each one."
        />
        <ProfileStrengthContent />
      </StudentShell>
    </RequireAuth>
  );
}
