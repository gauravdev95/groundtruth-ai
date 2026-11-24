"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import {
  ArrowLeft,
  Award,
  Briefcase,
  CheckCircle2,
  Code2,
  FileText,
  FolderGit2,
  GraduationCap,
  Link2,
  Target,
  UserRound,
} from "lucide-react";
import { RequireAuth } from "@/components/auth/RequireAuth";
import { RecruiterPageHead, RecruiterShell } from "@/components/recruiter/RecruiterShell";
import { CompetencyProfileView } from "@/components/assessment/CompetencyProfile";
import { CompetencyChip } from "@/components/recruiter/CompetencyChip";
import {
  RECRUITER_STATUS_OPTIONS,
  fetchApplicationDetail,
  updateApplicationStatus,
  type RecruiterApplicationStatus,
} from "@/lib/recruiter";
import {
  fetchCandidateEvidenceForRecruiter,
  formatMatchScore,
  type Application,
  type VerifiedProfile,
} from "@/lib/api";
import {
  branchLabel,
  degreeLabel,
  employmentTypeLabel,
  platformLabel,
  targetRoleLabel,
  type FullProfile,
} from "@/lib/student";

function statusChip(status: string): string {
  switch (status) {
    case "offer":
      return "st-chip st-chip-green";
    case "rejected":
    case "withdrawn":
      return "st-chip st-chip-grey";
    case "interview":
      return "st-chip st-chip-amber";
    default:
      return "st-chip st-chip-blue";
  }
}

function Section({
  icon,
  title,
  desc,
  children,
}: {
  icon: React.ReactNode;
  title: string;
  desc?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="st-panel" aria-label={title}>
      <div className="st-panel-head">
        <div>
          <h2>{title}</h2>
          {desc ? <p className="st-panel-desc">{desc}</p> : null}
        </div>
        <span className="st-panel-icon" aria-hidden="true">
          {icon}
        </span>
      </div>
      {children}
    </section>
  );
}

function EmptyLine({ text }: { text: string }) {
  return <p style={{ color: "var(--muted)", fontSize: 14 }}>{text}</p>;
}

function DetailContent({ applicationId }: { applicationId: string }) {
  const [data, setData] = useState<{
    application: Application;
    profile: FullProfile;
  } | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // Recruiter evidence (Phase F): verified profile + assessment history +
  // competency profile for this candidate. Loaded best-effort — a failure
  // here never blocks the application itself.
  const [evidence, setEvidence] = useState<VerifiedProfile | null>(null);
  const [evidenceError, setEvidenceError] = useState<string | null>(null);
  const [status, setStatus] = useState<RecruiterApplicationStatus>("reviewing");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  useEffect(() => {
    fetchApplicationDetail(applicationId)
      .then((d) => {
        setData(d);
        if (d.application.status !== "applied") {
          setStatus(d.application.status as RecruiterApplicationStatus);
        }
        fetchCandidateEvidenceForRecruiter(d.application.candidate_id)
          .then(setEvidence)
          .catch((err) =>
            setEvidenceError(
              err instanceof Error ? err.message : "Could not load assessment evidence.",
            ),
          );
      })
      .catch((err) =>
        setError(err instanceof Error ? err.message : "Could not load this application."),
      )
      .finally(() => setLoading(false));
  }, [applicationId]);

  if (loading) {
    return (
      <div className="st-loading" role="status" aria-label="Loading">
        <span className="st-spinner" aria-hidden="true" />
        <p>Loading applicant profile…</p>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="st-empty" role="alert">
        <h2>Application not found</h2>
        <p>{error ?? "This application doesn't exist, or it isn't for one of your roles."}</p>
        <Link href="/recruiter/applications" className="st-btn st-btn-blue">
          Back to applications
        </Link>
      </div>
    );
  }

  const { application: a, profile } = data;
  const c = profile.candidate;
  const score = formatMatchScore(a.match_score);

  async function onStatusSave() {
    setSaving(true);
    setSaved(false);
    setSaveError(null);
    try {
      const updated = await updateApplicationStatus(a.id, status);
      setData({ application: updated, profile });
      setSaved(true);
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : "Could not update the status.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <p style={{ marginBottom: 18 }}>
        <Link href="/recruiter/applications" className="st-btn st-btn-outline st-btn-sm">
          <ArrowLeft size={15} aria-hidden="true" /> All applications
        </Link>
      </p>

      <RecruiterPageHead
        eyebrow={`Application · ${a.job_title}`}
        title={
          <>
            {c.full_name} <span className="blue">— applicant profile.</span>
          </>
        }
        sub={`Applied ${new Date(a.created_at).toLocaleDateString()} for ${a.job_title} at ${a.company_name ?? "your company"}. This is the student's own GroundTruth profile, read-only.`}
        actions={
          <>
            <Link href={`/recruiter/applications/${a.id}/evidence`} className="st-btn st-btn-outline st-btn-sm">
              View evidence
            </Link>
            <span className={statusChip(a.status)}>{a.status}</span>
          </>
        }
      />

      <div className="st-grid st-grid-2 st-section-gap">
        {/* Match + pipeline */}
        <section className="st-panel" aria-label="Match and pipeline">
          <div className="st-panel-head">
            <div>
              <h2>Match &amp; pipeline</h2>
              <p className="st-panel-desc">What the matching engine says, and where this candidate stands.</p>
            </div>
            <span className="st-panel-icon" aria-hidden="true">
              <Target size={20} />
            </span>
          </div>
          <div className="st-kv">
            <div className="st-kv-row">
              <span>Match score</span>
              <strong>
                {score ?? "No score yet"}
                {score && a.match_model ? ` (${a.match_model})` : ""}
              </strong>
            </div>
            {score === null ? (
              <p className="st-note" style={{ margin: "4px 0 0" }}>
                The matching engine hasn&apos;t scored this candidate against
                this role yet — no number is shown rather than a guessed one.
              </p>
            ) : null}
            <div className="st-kv-row">
              <span>Profile completeness</span>
              <strong>{profile.completeness.percent}%</strong>
            </div>
            <div className="st-kv-row">
              <span>GitHub verification</span>
              <strong>
                {profile.github_verification.status === "checked"
                  ? "Checked — see profile"
                  : "Not checked yet"}
              </strong>
            </div>
          </div>
          <div style={{ marginTop: 20 }}>
            <label className="st-field">
              <span className="st-label">Move to stage</span>
              <select
                className="st-input st-select"
                value={status}
                onChange={(e) => {
                  setStatus(e.target.value as RecruiterApplicationStatus);
                  setSaved(false);
                }}
              >
                {RECRUITER_STATUS_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            </label>
            <div style={{ display: "flex", gap: 10, marginTop: 12, alignItems: "center" }}>
              <button
                type="button"
                className="st-btn st-btn-blue"
                disabled={saving || status === a.status}
                onClick={onStatusSave}
              >
                {saving ? "Saving…" : "Update stage"}
              </button>
              {saved ? (
                <span style={{ color: "#166534", fontWeight: 700, fontSize: 14, display: "inline-flex", gap: 6, alignItems: "center" }}>
                  <CheckCircle2 size={16} aria-hidden="true" /> Saved
                </span>
              ) : null}
            </div>
            {saveError !== null ? (
              <p className="st-error-text" role="alert">
                {saveError}
              </p>
            ) : null}
          </div>
        </section>

        {/* About the candidate */}
        <Section icon={<UserRound size={20} />} title="About the candidate" desc="Contact and education, as the student entered them.">
          <div className="st-kv">
            <div className="st-kv-row">
              <span>Name</span>
              <strong>{c.full_name}</strong>
            </div>
            <div className="st-kv-row">
              <span>Headline</span>
              <strong>{c.headline ?? "—"}</strong>
            </div>
            <div className="st-kv-row">
              <span>Email</span>
              <strong>
                <a href={`mailto:${c.email}`}>{c.email}</a>
              </strong>
            </div>
            <div className="st-kv-row">
              <span>Phone</span>
              <strong>{c.phone ?? "—"}</strong>
            </div>
            <div className="st-kv-row">
              <span>Location</span>
              <strong>{c.location ?? "—"}</strong>
            </div>
            <div className="st-kv-row">
              <span>Education</span>
              <strong>
                {c.degree ? degreeLabel(c.degree) : "—"}
                {c.branch ? ` · ${branchLabel(c.branch)}` : ""}
                {c.graduation_year ? ` · ${c.graduation_year}` : ""}
              </strong>
            </div>
            <div className="st-kv-row">
              <span>Target roles</span>
              <strong>
                {c.target_roles.length > 0
                  ? c.target_roles.map(targetRoleLabel).join(", ")
                  : "—"}
              </strong>
            </div>
          </div>
          {c.summary ? (
            <p style={{ color: "var(--muted)", fontSize: 15, lineHeight: 1.7, marginTop: 16 }}>
              {c.summary}
            </p>
          ) : null}
          <div className="st-chip-row" style={{ marginTop: 16 }}>
            {c.github_url ? (
              <a className="st-chip st-chip-blue" href={c.github_url} target="_blank" rel="noopener noreferrer">
                <Link2 size={13} aria-hidden="true" /> GitHub
              </a>
            ) : null}
            {c.linkedin_url ? (
              <a className="st-chip st-chip-blue" href={c.linkedin_url} target="_blank" rel="noopener noreferrer">
                <Link2 size={13} aria-hidden="true" /> LinkedIn
              </a>
            ) : null}
            {c.portfolio_url ? (
              <a className="st-chip st-chip-blue" href={c.portfolio_url} target="_blank" rel="noopener noreferrer">
                <Link2 size={13} aria-hidden="true" /> Portfolio
              </a>
            ) : null}
          </div>
        </Section>
      </div>

      <div className="st-grid st-grid-2 st-section-gap">
        <Section icon={<Code2 size={20} />} title="Skills" desc="From the student's resume, GitHub and manual entries.">
          {profile.skills.length === 0 ? (
            <EmptyLine text="No skills listed yet." />
          ) : (
            <div className="st-chip-row">
              {profile.skills.map((s) => (
                <span key={s.id} className="st-chip st-chip-blue" title={`${s.source}${s.confidence ? ` · confidence ${s.confidence}` : ""}`}>
                  {s.name}
                </span>
              ))}
            </div>
          )}
        </Section>

        <Section icon={<FolderGit2 size={20} />} title="Projects" desc="What the student has built.">
          {profile.projects.length === 0 ? (
            <EmptyLine text="No projects listed yet." />
          ) : (
            <div className="st-stack">
              {profile.projects.map((p) => (
                <div key={p.id}>
                  <strong>{p.title}</strong>
                  {p.role ? <span style={{ color: "var(--muted)" }}> · {p.role}</span> : null}
                  <p style={{ color: "var(--muted)", fontSize: 14, lineHeight: 1.6, marginTop: 4 }}>
                    {p.description}
                  </p>
                  {p.technologies.length > 0 ? (
                    <div className="st-chip-row" style={{ marginTop: 8 }}>
                      {p.technologies.map((t) => (
                        <span key={t} className="st-chip st-chip-grey">{t}</span>
                      ))}
                    </div>
                  ) : null}
                  {p.repo_url ? (
                    <p style={{ marginTop: 8 }}>
                      <a href={p.repo_url} target="_blank" rel="noopener noreferrer" style={{ color: "var(--blue2)", fontWeight: 700, fontSize: 14 }}>
                        View repository →
                      </a>
                    </p>
                  ) : null}
                </div>
              ))}
            </div>
          )}
        </Section>

        <Section icon={<Award size={20} />} title="Coding profiles & certificates" desc="Platform handles and credentials on file.">
          {profile.coding_profiles.length === 0 && profile.certificates.length === 0 ? (
            <EmptyLine text="No coding profiles or certificates listed yet." />
          ) : (
            <>
              {profile.coding_profiles.map((cp) => (
                <div key={cp.id} className="st-kv-row">
                  <span>{platformLabel(cp.platform)}</span>
                  <strong>
                    {cp.profile_url ? (
                      <a href={cp.profile_url} target="_blank" rel="noopener noreferrer">
                        {cp.username}
                      </a>
                    ) : (
                      cp.username
                    )}{" "}
                    · {cp.verification_status}
                  </strong>
                </div>
              ))}
              {profile.certificates.map((cert) => (
                <div key={cert.id} className="st-kv-row">
                  <span>{cert.title}</span>
                  <strong>
                    {cert.issuer ?? ""}
                    {cert.issued_at ? ` · ${cert.issued_at}` : ""}
                  </strong>
                </div>
              ))}
            </>
          )}
        </Section>

        <Section icon={<Briefcase size={20} />} title="Experience" desc="Internships and work the student has listed.">
          {profile.experience.length === 0 ? (
            <EmptyLine text="No experience listed yet." />
          ) : (
            <div className="st-stack">
              {profile.experience.map((e) => (
                <div key={e.id}>
                  <strong>{e.title}</strong>
                  <span style={{ color: "var(--muted)" }}> · {e.organization}</span>
                  <p style={{ color: "var(--muted)", fontSize: 14, marginTop: 4 }}>
                    {employmentTypeLabel(e.employment_type)}
                    {e.start_date ? ` · ${e.start_date}` : ""}
                    {e.is_current ? " · Present" : e.end_date ? ` – ${e.end_date}` : ""}
                  </p>
                  {e.description ? (
                    <p style={{ color: "var(--muted)", fontSize: 14, lineHeight: 1.6 }}>{e.description}</p>
                  ) : null}
                </div>
              ))}
            </div>
          )}
        </Section>

        <Section icon={<FileText size={20} />} title="Resumes" desc="Files the student uploaded.">
          {profile.resumes.length === 0 ? (
            <EmptyLine text="No resume uploaded yet." />
          ) : (
            <div className="st-stack">
              {profile.resumes.map((r) => (
                <div key={r.id} className="st-kv-row">
                  <span>{r.file_name ?? "Resume"}</span>
                  <strong>
                    {r.storage === "cloudinary" && r.cloudinary_url ? (
                      <a href={r.cloudinary_url} target="_blank" rel="noopener noreferrer">
                        Open file →
                      </a>
                    ) : (
                      "Stored locally — ask the candidate for a copy"
                    )}
                  </strong>
                </div>
              ))}
            </div>
          )}
        </Section>

        <Section icon={<GraduationCap size={20} />} title="GitHub verification" desc="From the repository-analysis worker, when it has run.">
          {profile.github_verification.status === "checked" ? (
            <div className="st-kv">
              <div className="st-kv-row">
                <span>Checked</span>
                <strong>{profile.github_verification.verified_at ?? "—"}</strong>
              </div>
              <div className="st-kv-row">
                <span>Source</span>
                <strong>{profile.github_verification.source_ref ?? "—"}</strong>
              </div>
              <div className="st-kv-row">
                <span>Score</span>
                <strong>{profile.github_verification.score ?? "—"}</strong>
              </div>
            </div>
          ) : (
            <EmptyLine text="GitHub hasn't been verified for this candidate yet." />
          )}
        </Section>
      </div>

      {/* Phase F — competency profile + assessment history. The profile is
          the stored result for the candidate's latest assessed work
          (coding 50 / interview 30 / verified evidence 20); a missing
          profile is shown as "Not assessed", never invented. The chip
          shows the VERIFIED category only — a provisional score is
          labelled "Provisional" with its status, never a band presented
          as verified (see CompetencyChip). */}
      {(() => {
        const history = evidence?.assessments ?? [];
        const latestProfile =
          evidence?.competencyProfile ??
          history.find((h) => h.competencyProfile)?.competencyProfile ??
          null;
        return (
          <>
            <div className="st-section-gap">
              {latestProfile ? (
                <CompetencyProfileView profile={latestProfile} />
              ) : (
                <section className="st-panel" aria-label="Competency profile">
                  <div className="st-panel-head">
                    <div>
                      <h2>Competency profile</h2>
                      <p className="st-panel-desc">
                        Overall and per-competency scores from the coding
                        evaluation, the AI interview and verified evidence.
                      </p>
                    </div>
                    <span className="st-chip st-chip-grey">Not assessed</span>
                  </div>
                  <p style={{ color: "var(--muted)", fontSize: 14, marginTop: 12 }}>
                    {evidenceError
                      ? `Assessment evidence could not be loaded: ${evidenceError}`
                      : "No competency profile has been computed for this candidate yet — the candidate completes the coding assessment and interview first, then the profile is computed from those real results."}
                  </p>
                </section>
              )}
            </div>

            <section className="st-panel st-section-gap" aria-label="Assessment history">
              <div className="st-panel-head">
                <div>
                  <h2>Assessment history</h2>
                  <p className="st-panel-desc">
                    Every assessment this candidate has taken, newest first —
                    with the coding score, interview score and competency
                    result for each. Full detail is on the evidence page.
                  </p>
                </div>
                <span className="st-panel-icon" aria-hidden="true">
                  <Target size={20} />
                </span>
              </div>
              {evidenceError && history.length === 0 ? (
                <p className="st-error-text" role="alert">
                  {evidenceError}
                </p>
              ) : history.length === 0 ? (
                <EmptyLine text="This candidate has not started an assessment yet." />
              ) : (
                <div className="st-stack">
                  {history.map((h) => (
                    <div key={h.id} className="st-kv-row">
                      <span>
                        {h.challengeTitle ?? "Assessment"}
                        <br />
                        <span style={{ color: "var(--muted)", fontWeight: 400 }}>
                          {h.status}
                          {h.submittedAt
                            ? ` · Submitted ${new Date(h.submittedAt).toLocaleDateString()}`
                            : ""}
                          {` · Coding ${h.overallScore === null ? "—" : Math.round(h.overallScore)}`}
                          {` · Interview ${h.interviewScore === null ? "—" : Math.round(h.interviewScore)}`}
                        </span>
                      </span>
                      <strong>
                        <CompetencyChip
                          overallScore={h.competencyProfile?.overallScore ?? null}
                          category={h.competencyProfile?.overallCategory ?? null}
                          status={h.competencyProfile?.status ?? null}
                          statusLabel={h.competencyProfile?.statusLabel ?? null}
                          provisionalNote={
                            h.competencyProfile?.interviewCoverage?.provisionalNote ?? null
                          }
                        />
                      </strong>
                    </div>
                  ))}
                </div>
              )}
              <p style={{ marginTop: 16 }}>
                <Link
                  href={`/recruiter/applications/${a.id}/evidence`}
                  className="st-btn st-btn-outline st-btn-sm"
                >
                  View evidence &amp; interview breakdown
                </Link>
              </p>
            </section>
          </>
        );
      })()}
    </>
  );
}

export default function RecruiterApplicationDetailPage({
  params,
}: {
  params: { id: string };
}) {
  return (
    <RequireAuth roles={["recruiter"]}>
      <RecruiterShell>
        <DetailContent applicationId={params.id} />
      </RecruiterShell>
    </RequireAuth>
  );
}
