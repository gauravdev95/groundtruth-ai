"use client";

import Link from "next/link";
import {
  Activity,
  AlertCircle,
  ArrowRight,
  CheckCircle2,
  Circle,
  Radar,
  Target,
} from "lucide-react";
import {
  aiMonitoring,
  improveProfileItems,
  type FullProfile,
} from "@/lib/student";

/**
 * Profile Strength — the score is the server's completeness percent
 * (never invented), and every "Improve your profile" item is a section
 * the server says is missing, with exactly what to add and a link to
 * that section. Completing an item changes the server response, which
 * raises the score shown here.
 */
export function ProfileStrengthCard({ profile }: { profile: FullProfile }) {
  const completeness = profile.completeness;
  const items = improveProfileItems(profile);
  const done = completeness.percent === 100;
  return (
    <section className="st-panel" aria-label="Profile strength">
      <div className="st-panel-head">
        <div>
          <h2>Profile strength</h2>
          <p className="st-panel-desc">
            {done
              ? "Every section filled in — this is your strongest profile."
              : "Your real strength score from the server. Each item below raises it when you complete it."}
          </p>
        </div>
        <span className="st-panel-icon" aria-hidden="true">
          <Target size={20} />
        </span>
      </div>
      <div className="st-meter-row">
        <span className="st-meter-pct">{completeness.percent}%</span>
        <span className="st-stat-label">
          {done ? "Complete" : `${completeness.missing.length} section${completeness.missing.length === 1 ? "" : "s"} to go`}
        </span>
      </div>
      <div className="st-meter" role="progressbar" aria-valuenow={completeness.percent} aria-valuemin={0} aria-valuemax={100} aria-label="Profile strength">
        <div className="st-meter-fill" style={{ width: `${completeness.percent}%` }} />
      </div>
      {done ? (
        <div className="st-check-list">
          <span className="st-check-item done">
            <CheckCircle2 size={16} aria-hidden="true" />
            <span>
              <strong>All sections complete</strong> — basic info, your project, coding profile, certificates and experience are all filled in.
            </span>
          </span>
        </div>
      ) : (
        <>
          <h3 style={{ marginTop: 20, fontSize: 15 }}>Improve your profile</h3>
          <div className="st-check-list">
            {items.map((item) => (
              <span key={item.key} className="st-check-item pending">
                <Circle size={16} aria-hidden="true" />
                <span style={{ flex: 1 }}>
                  <strong>{item.label}</strong> — {item.action}{" "}
                  <span className="st-chip st-chip-blue">+{item.points} pts</span>
                </span>
                <Link href={item.href} className="st-btn st-btn-outline st-btn-sm">
                  Add <ArrowRight size={14} aria-hidden="true" />
                </Link>
              </span>
            ))}
          </div>
        </>
      )}
    </section>
  );
}

/**
 * Online AI Monitoring — status, last checked time and findings derived
 * ONLY from real stored data (single project, coding profiles,
 * certificates, resume, GitHub username, completeness). No fake live
 * feed, no invented activity, no fake scores. When there is nothing to
 * flag, it says so honestly.
 */
export function AiMonitoringCard({
  profile,
  summary,
}: {
  profile: FullProfile;
  /** Summary variant (profile page): status + top findings only. */
  summary?: boolean;
}) {
  const monitoring = aiMonitoring(profile);
  const live = monitoring.status === "live";
  const findings = summary ? monitoring.findings.slice(0, 3) : monitoring.findings;
  return (
    <section className="st-panel" aria-label="AI monitoring">
      <div className="st-panel-head">
        <div>
          <h2>AI Monitoring</h2>
          <p className="st-panel-desc">
            {live
              ? "Monitoring your profile and evidence online — findings below come only from your stored profile data."
              : "Monitoring is paused until onboarding is complete — finish your profile and it starts."}
          </p>
        </div>
        <span className="st-panel-icon" aria-hidden="true">
          <Radar size={20} />
        </span>
      </div>
      <div className="st-kv">
        <div className="st-kv-row">
          <span>Status</span>
          <strong>
            <span
              aria-hidden="true"
              style={{
                display: "inline-block",
                width: 9,
                height: 9,
                borderRadius: "50%",
                background: live ? "#16a34a" : "#d97706",
                marginRight: 7,
              }}
            />
            {live ? "Monitoring live" : "Paused"}
          </strong>
        </div>
        <div className="st-kv-row">
          <span>Last checked</span>
          <strong>{new Date(monitoring.lastCheckedAt).toLocaleString()}</strong>
        </div>
        <div className="st-kv-row">
          <span>Findings</span>
          <strong>
            {monitoring.findings.length === 0
              ? "All clear"
              : `${monitoring.findings.length} item${monitoring.findings.length === 1 ? "" : "s"} to review`}
          </strong>
        </div>
      </div>
      {monitoring.findings.length === 0 ? (
        <div className="st-empty-inline">
          <span className="st-empty-icon" aria-hidden="true">
            <Activity size={22} />
          </span>
          <h3>Nothing to monitor yet</h3>
          <p>
            Everything we can check from your stored profile looks up to date. Add a coding profile, a certificate or a resume and the monitor will check those too.
          </p>
        </div>
      ) : (
        <div className="st-check-list">
          {findings.map((f, i) => (
            <span key={`${f.title}-${i}`} className="st-check-item pending">
              {f.severity === "action" ? (
                <AlertCircle size={16} aria-hidden="true" />
              ) : (
                <Circle size={16} aria-hidden="true" />
              )}
              <span style={{ flex: 1 }}>
                <strong>{f.title}</strong> — {f.detail}
              </span>
              {f.href ? (
                <Link href={f.href} className="st-btn st-btn-outline st-btn-sm">
                  Fix <ArrowRight size={14} aria-hidden="true" />
                </Link>
              ) : null}
            </span>
          ))}
        </div>
      )}
      {summary && monitoring.findings.length > 3 ? (
        <p className="st-note" style={{ marginTop: 14 }}>
          +{monitoring.findings.length - 3} more finding{monitoring.findings.length - 3 === 1 ? "" : "s"} on your dashboard.
        </p>
      ) : null}
    </section>
  );
}
