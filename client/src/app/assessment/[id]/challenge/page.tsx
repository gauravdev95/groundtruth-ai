"use client";

import { useCallback, useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { ArrowRight, FlaskConical, ShieldCheck } from "lucide-react";
import { RequireAuth } from "@/components/auth/RequireAuth";
import { StudentPageHead, StudentShell } from "@/components/student/StudentShell";
import {
  BackToHub,
  ErrorState,
  InlineError,
  Kv,
  LoadingState,
  StatusChip,
  Stepper,
} from "@/components/assessment/shared";
import {
  analyzeGitHubUrl,
  analyzeRepository,
  fetchAssessment,
  fetchConsent,
  fetchDemoProject,
  formatDateTime,
  generateChallenge,
  giveConsent,
  toStrList as apiToStrList,
  type AssessmentDetail,
  type ChallengeRow,
  type MonitoringConsent,
  type RepoAnalysisResult,
} from "@/lib/api";

function renderRepoContext(ctx: Record<string, unknown>): { key: string; value: string }[] {
  return Object.entries(ctx).map(([key, value]) => ({
    key,
    value:
      typeof value === "string"
        ? value
        : Array.isArray(value)
          ? value.map((v) => String(v)).join(", ")
          : JSON.stringify(value),
  }));
}

function ChallengeContent() {
  const params = useParams<{ id: string }>();
  const id = params.id;
  const router = useRouter();
  const [detail, setDetail] = useState<AssessmentDetail | null>(null);
  const [analysis, setAnalysis] = useState<RepoAnalysisResult | null>(null);
  const [challenge, setChallenge] = useState<ChallengeRow | null>(null);
  const [consent, setConsent] = useState<MonitoringConsent | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<"analyze" | "generate" | "consent" | null>(null);
  const [stepError, setStepError] = useState<string | null>(null);
  const [agreed, setAgreed] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const d = await fetchAssessment(id);
      setDetail(d);
      setAnalysis(d.repoAnalysis);
      setChallenge(d.challenge);
      const c = await fetchConsent(id).catch(() => null);
      setConsent(c);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load the assessment.");
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    load();
  }, [load]);

  async function onAnalyze() {
    setBusy("analyze");
    setStepError(null);
    try {
      // Step 5: a GitHub-URL assessment is analysed from the public repo
      // itself (read-only fetch on the server); the Lab is seeded from the
      // same fetched copy. Demo/profile assessments keep the demo flow.
      if (detail?.repository?.source === "github_url" && detail.repository.repo_url) {
        const result = await analyzeGitHubUrl(id, detail.repository.repo_url);
        setAnalysis(result.analysis);
        setDetail((d) =>
          d
            ? {
                ...d,
                repository: d.repository
                  ? {
                      ...d.repository,
                      repo_name: `${result.repository.owner}/${result.repository.repo}`,
                      default_branch: result.repository.defaultBranch,
                      commit_sha: result.repository.commitSha,
                    }
                  : d.repository,
              }
            : d,
        );
        return;
      }
      // The Lab workspace always starts from the demo project's files (the
      // server loads them when the assessment starts), so the repo analysis
      // runs on those files. This is labelled as such below — never presented
      // as the student's own repository.
      const demo = await fetchDemoProject();
      const files = Object.entries(demo.files).map(([path, content]) => ({ path, content }));
      const result = await analyzeRepository(id, files);
      setAnalysis(result);
    } catch (err) {
      setStepError(err instanceof Error ? err.message : "Repository analysis failed.");
    } finally {
      setBusy(null);
    }
  }

  async function onGenerate() {
    setBusy("generate");
    setStepError(null);
    try {
      const c = await generateChallenge(id);
      setChallenge(c);
      const d = await fetchAssessment(id);
      setDetail(d);
    } catch (err) {
      setStepError(err instanceof Error ? err.message : "Challenge generation failed.");
    } finally {
      setBusy(null);
    }
  }

  async function onConsent() {
    if (!agreed) {
      setStepError("Please read the consent text and tick the agreement box first.");
      return;
    }
    setBusy("consent");
    setStepError(null);
    try {
      const updated = await giveConsent(id);
      setDetail((d) => (d ? { ...d, ...updated } : d));
      const c = await fetchConsent(id).catch(() => null);
      setConsent(c);
    } catch (err) {
      setStepError(err instanceof Error ? err.message : "Could not record consent.");
    } finally {
      setBusy(null);
    }
  }

  if (loading) return <LoadingState text="Loading your assessment…" />;
  if (error || !detail) {
    return <ErrorState message={error ?? "Something went wrong."} onRetry={load} />;
  }

  const consentGiven = Boolean(detail.consent_given_at) || Boolean(consent?.given);
  const step = !analysis ? 0 : !challenge ? 1 : !consentGiven ? 2 : 3;
  const visibleTests = apiToStrList(
    (challenge?.test_strategy as Record<string, unknown> | undefined)?.visible,
  );
  const hiddenTests = apiToStrList(
    (challenge?.test_strategy as Record<string, unknown> | undefined)?.hidden,
  );
  const languages = Array.isArray(analysis?.languages)
    ? (analysis?.languages as { language?: string; files?: number }[])
    : [];
  const dependencies = Array.isArray(analysis?.dependencies)
    ? (analysis?.dependencies as { name?: string; version?: string }[])
    : [];
  const tests = (analysis?.tests ?? {}) as Record<string, unknown>;

  return (
    <div className="st-stack">
      <Stepper
        steps={["Analyse repository", "Generate challenge", "Monitoring consent", "Start Lab"]}
        current={step}
      />

      <section className="st-panel" aria-label="Assessment overview">
        <div className="st-panel-head">
          <div>
            <h2>Assessment</h2>
            <p className="st-panel-desc">
              Created {formatDateTime(detail.created_at)} · Time limit{" "}
              {detail.time_limit_minutes} minutes
              {detail.started_at ? ` · Started ${formatDateTime(detail.started_at)}` : ""}
            </p>
          </div>
          <StatusChip status={detail.status} />
        </div>
        <div className="st-grid st-grid-3" style={{ marginTop: 16 }}>
          <Kv label="Status">{detail.status}</Kv>
          <Kv label="Consent">
            {consentGiven
              ? `Given ${formatDateTime(detail.consent_given_at)}`
              : "Not given yet"}
          </Kv>
          <Kv label="Time limit">{detail.time_limit_minutes} minutes</Kv>
          {detail.repository ? (
            <Kv label="Repository">
              {detail.repository.source === "github_url"
                ? `${detail.repository.repo_name ?? detail.repository.repo_url ?? "GitHub URL"}${detail.repository.commit_sha ? ` @ ${detail.repository.commit_sha.slice(0, 7)}` : ""}`
                : detail.repository.source === "manual"
                  ? "Demo project"
                  : (detail.repository.repo_name ?? detail.repository.source)}
            </Kv>
          ) : null}
        </div>
      </section>

      {/* Step 1 — repo analysis */}
      <section className="st-panel" aria-label="Repository analysis">
        <div className="st-panel-head">
          <div>
            <h2>1 · Repository analysis</h2>
            {detail.repository?.source === "github_url" ? (
              <p className="st-panel-desc">
                The analysis runs on your public GitHub repository{" "}
                <strong style={{ color: "var(--ink)" }}>{detail.repository.repo_name ?? detail.repository.repo_url}</strong>
                {detail.repository.commit_sha
                  ? ` (commit ${detail.repository.commit_sha.slice(0, 7)})`
                  : ""}
                {" "}— fetched read-only from GitHub, never executed. The Lab
                workspace starts from the same read-only copy.
              </p>
            ) : (
              <p className="st-panel-desc">
                The analysis runs on the demo project&apos;s files — the same files
                the Lab workspace starts from. It is labelled as the demo codebase,
                never as your own repository.
              </p>
            )}
          </div>
          <span className="st-panel-icon" aria-hidden="true"><FlaskConical size={20} /></span>
        </div>
        {!analysis ? (
          <>
            <p className="st-panel-desc">No analysis yet for this assessment.</p>
            <p style={{ marginTop: 14 }}>
              <button
                type="button"
                className="st-btn st-btn-blue"
                onClick={onAnalyze}
                disabled={busy !== null}
              >
                {busy === "analyze" ? "Analysing…" : "Analyse repository"}
              </button>
            </p>
          </>
        ) : (
          <div style={{ marginTop: 16 }}>
            {analysis.summary ? <p className="st-panel-desc">{analysis.summary}</p> : null}
            <div className="st-grid st-grid-3" style={{ marginTop: 16 }}>
              <Kv label="Languages">
                {languages.length > 0
                  ? languages.map((l) => l.language ?? "?").join(", ")
                  : "None detected"}
              </Kv>
              <Kv label="Frameworks">
                {analysis.frameworks.length > 0 ? analysis.frameworks.join(", ") : "None detected"}
              </Kv>
              <Kv label="Entry points">
                {analysis.entry_points.length > 0 ? analysis.entry_points.join(", ") : "—"}
              </Kv>
              <Kv label="Tests">
                {typeof tests.count === "number"
                  ? `${tests.count} test file(s)${Array.isArray(tests.frameworks) && tests.frameworks.length ? ` (${(tests.frameworks as string[]).join(", ")})` : ""}`
                  : "—"}
              </Kv>
              <Kv label="API endpoints">
                {Array.isArray(analysis.api_endpoints) && analysis.api_endpoints.length > 0
                  ? (analysis.api_endpoints as { method?: string; path?: string }[])
                      .map((e) => `${e.method ?? ""} ${e.path ?? ""}`.trim())
                      .join(", ")
                  : "None detected"}
              </Kv>
              <Kv label="Database integrations">
                {analysis.db_integrations.length > 0 ? analysis.db_integrations.join(", ") : "None detected"}
              </Kv>
            </div>
            {dependencies.length > 0 ? (
              <p className="st-panel-desc" style={{ marginTop: 12 }}>
                <strong style={{ color: "var(--ink)" }}>Dependencies: </strong>
                {dependencies.map((d) => `${d.name ?? "?"}${d.version ? ` ${d.version}` : ""}`).join(", ")}
              </p>
            ) : null}
            <p className="st-panel-desc" style={{ marginTop: 8 }}>
              Analysed {formatDateTime(analysis.created_at)} · by {analysis.analyzed_by}
            </p>
          </div>
        )}
      </section>

      {/* Step 2 — challenge */}
      <section className="st-panel" aria-label="Challenge">
        <div className="st-panel-head">
          <div>
            <h2>2 · Your challenge</h2>
            <p className="st-panel-desc">
              Generated from the repository analysis. Hidden tests are never
              shown — only their descriptions, exactly as the server sends them.
            </p>
          </div>
        </div>
        {!challenge ? (
          <>
            <p className="st-panel-desc">
              {analysis
                ? "The repository is analysed — generate your challenge next."
                : "Analyse the repository first; the challenge is generated from that analysis."}
            </p>
            <p style={{ marginTop: 14 }}>
              <button
                type="button"
                className="st-btn st-btn-blue"
                onClick={onGenerate}
                disabled={busy !== null || !analysis}
              >
                {busy === "generate" ? "Generating…" : "Generate challenge"}
              </button>
            </p>
          </>
        ) : (
          <div style={{ marginTop: 8 }}>
            <h3 style={{ fontSize: 20 }}>{challenge.title}</h3>
            <p className="st-panel-desc" style={{ marginTop: 8 }}>{challenge.problem_statement}</p>
            <div className="st-grid st-grid-3" style={{ marginTop: 16 }}>
              <Kv label="Difficulty">{challenge.difficulty}</Kv>
              <Kv label="Time limit">{challenge.time_limit_minutes} minutes</Kv>
              <Kv label="Generated by">{challenge.generated_by}</Kv>
            </div>
            {renderRepoContext(challenge.repo_context).length > 0 ? (
              <>
                <h3 style={{ marginTop: 20 }}>Repository context</h3>
                <div className="st-grid st-grid-2" style={{ marginTop: 10 }}>
                  {renderRepoContext(challenge.repo_context).map((row) => (
                    <Kv key={row.key} label={row.key}>{row.value}</Kv>
                  ))}
                </div>
              </>
            ) : null}
            <h3 style={{ marginTop: 20 }}>Required functionality</h3>
            <ul className="as-list">
              {apiToStrList(challenge.required_functionality).map((item, i) => (
                <li key={i}>{item}</li>
              ))}
            </ul>
            <h3 style={{ marginTop: 20 }}>Acceptance criteria</h3>
            <ul className="as-list">
              {apiToStrList(challenge.acceptance_criteria).map((item, i) => (
                <li key={i}>{item}</li>
              ))}
            </ul>
            <h3 style={{ marginTop: 20 }}>Deliverables</h3>
            <ul className="as-list">
              {apiToStrList(challenge.deliverables).map((item, i) => (
                <li key={i}>{item}</li>
              ))}
            </ul>
            <h3 style={{ marginTop: 20 }}>Allowed tools</h3>
            <div className="st-chip-row" style={{ marginTop: 8 }}>
              {apiToStrList(challenge.allowed_tools).map((t) => (
                <span key={t} className="st-chip st-chip-blue">{t}</span>
              ))}
            </div>
            <h3 style={{ marginTop: 20 }}>Test strategy</h3>
            <p className="st-panel-desc" style={{ marginTop: 6 }}>
              Visible tests — you can run these in the Lab:
            </p>
            <ul className="as-list">
              {visibleTests.length > 0
                ? visibleTests.map((t, i) => <li key={i}>{t}</li>)
                : <li className="plain">No visible test descriptions provided.</li>}
            </ul>
            <p className="st-panel-desc" style={{ marginTop: 12 }}>
              Hidden tests — descriptions only. The test code itself is never
              sent to the browser:
            </p>
            <ul className="as-list">
              {hiddenTests.length > 0
                ? hiddenTests.map((t, i) => <li key={i} className="plain">{t}</li>)
                : <li className="plain">No hidden test descriptions provided.</li>}
            </ul>
          </div>
        )}
      </section>

      {/* Step 3 — consent */}
      <section className="st-panel" aria-label="Monitoring consent">
        <div className="st-panel-head">
          <div>
            <h2>3 · Monitoring consent</h2>
            <p className="st-panel-desc">
              The Lab records activity so recruiters can see how the solution
              was built. The text below is exactly what the server provides —
              it is not paraphrased.
            </p>
          </div>
          <span className="st-panel-icon" aria-hidden="true"><ShieldCheck size={20} /></span>
        </div>
        {consentGiven ? (
          <div className="as-alert as-alert-success" style={{ marginTop: 12 }}>
            <strong>Consent given</strong>
            {detail.consent_given_at ? ` on ${formatDateTime(detail.consent_given_at)}` : ""}
            {consent?.version ? ` · version ${consent.version}` : ""}. You can start the Lab.
          </div>
        ) : consent ? (
          <div style={{ marginTop: 12 }}>
            <p className="st-panel-desc">Consent version: {consent.version}</p>
            <h3 style={{ marginTop: 16 }}>What is collected</h3>
            <ul className="as-list">
              {consent.collected.map((c) => (
                <li key={c} className="plain">{c}</li>
              ))}
            </ul>
            <h3 style={{ marginTop: 16 }}>Purpose</h3>
            <p className="st-panel-desc" style={{ marginTop: 6 }}>{consent.purpose}</p>
            <h3 style={{ marginTop: 16 }}>Retention</h3>
            <p className="st-panel-desc" style={{ marginTop: 6 }}>
              Monitoring data is retained for {consent.retentionDays} days.
            </p>
            <h3 style={{ marginTop: 16 }}>Who can see it</h3>
            <p className="st-panel-desc" style={{ marginTop: 6 }}>{consent.recruiterVisibility}</p>
            <label
              style={{ display: "flex", gap: 10, alignItems: "flex-start", marginTop: 18, fontSize: 14, fontWeight: 600, lineHeight: 1.6, cursor: "pointer" }}
            >
              <input
                type="checkbox"
                checked={agreed}
                onChange={(e) => setAgreed(e.target.checked)}
                style={{ width: 20, height: 20, marginTop: 2, accentColor: "#2f4bff" }}
              />
              I have read the monitoring consent above and I agree to it.
            </label>
            <p style={{ marginTop: 16 }}>
              <button
                type="button"
                className="st-btn st-btn-blue"
                onClick={onConsent}
                disabled={busy !== null || !agreed || !challenge}
              >
                {busy === "consent" ? "Recording…" : "Give consent"}
              </button>
            </p>
            {!challenge ? (
              <p className="st-panel-desc" style={{ marginTop: 8 }}>
                Generate the challenge first — consent is recorded for this assessment.
              </p>
            ) : null}
          </div>
        ) : (
          <p className="st-panel-desc" style={{ marginTop: 12 }}>
            Consent details could not be loaded. Try reloading the page.
          </p>
        )}
      </section>

      {stepError ? <InlineError message={stepError} /> : null}

      <div className="st-form-actions">
        <BackToHub />
        <div className="st-actions-right">
          <Link href={`/assessment/${id}/lab`} className="st-btn st-btn-blue">
            Start Lab <ArrowRight size={16} aria-hidden="true" />
          </Link>
        </div>
      </div>
      <p className="st-panel-desc">
        The Lab button is always available, but the Lab itself only starts once
        the challenge is generated and consent is given — otherwise it shows
        you exactly what is missing.
      </p>
    </div>
  );
}

export default function AssessmentChallengePage() {
  const params = useParams<{ id: string }>();
  void params;
  return (
    <RequireAuth roles={["candidate"]}>
      <StudentShell>
        <StudentPageHead
          eyebrow="Assessment Challenge"
          title={<>Your <span className="blue">challenge</span></>}
          sub="Analyse the code, read the challenge, then give monitoring consent. The Lab opens only after all three steps."
        />
        <ChallengeContent />
      </StudentShell>
    </RequireAuth>
  );
}
