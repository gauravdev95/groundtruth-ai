"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  ArrowLeft,
  Award,
  CheckCircle2,
  CircleDashed,
  Code2,
  FileText,
  Flag,
  FolderGit2,
  ShieldCheck,
  ShieldQuestion,
} from "lucide-react";
import { RequireAuth } from "@/components/auth/RequireAuth";
import { RecruiterPageHead, RecruiterShell } from "@/components/recruiter/RecruiterShell";
import { fetchApplicationDetail } from "@/lib/recruiter";
import { formatMatchScore, type Application } from "@/lib/api";
import {
  platformLabel,
  type FullProfile,
} from "@/lib/student";

// Phase 6 — candidate evidence view (per application).
//
// Everything GroundTruth has independently checked about this candidate,
// read from the stored records — never narrated or estimated. Each item
// carries its own honest status:
//
// - GitHub: "Checked" only when a `verification_results` row with
//   source='github' exists (written by the repo-analysis worker); the
//   handle-existence check is shown separately as yes / no / not checked.
// - Coding profiles: the stored `verification_status` — verified,
//   flagged, pending, unverified — shown as Verified / Flagged / Check in
//   progress / Not checked. 'unverified' means no check ran, not a fail.
// - Certificates: a certificate check is candidate-level, so a check row
//   is never attributed to one specific certificate; each certificate is
//   shown as "Not individually verified" unless a check ran.
// - Skills: grouped by their stored source (resume / github /
//   certificate / interview / manual) — the source is provenance, not a
//   verification claim.
// - Resumes: "Text extracted" only when extracted_text is stored.
// - Interviews are deliberately NOT shown here: the AI interview is out
//   of scope for Phase 6.

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

function VerifyChip({ state }: { state: "verified" | "checked" | "not_checked" | "flagged" | "pending" }) {
  switch (state) {
    case "verified":
    case "checked":
      return (
        <span className="st-chip st-chip-green">
          <CheckCircle2 size={13} aria-hidden="true" /> {state === "verified" ? "Verified" : "Checked"}
        </span>
      );
    case "flagged":
      return (
        <span className="st-chip st-chip-amber">
          <Flag size={13} aria-hidden="true" /> Flagged
        </span>
      );
    case "pending":
      return (
        <span className="st-chip st-chip-blue">
          <CircleDashed size={13} aria-hidden="true" /> Check in progress
        </span>
      );
    default:
      return (
        <span className="st-chip st-chip-grey">
          <ShieldQuestion size={13} aria-hidden="true" /> Not checked
        </span>
      );
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

function EvidenceContent({ applicationId }: { applicationId: string }) {
  const [data, setData] = useState<{
    application: Application;
    profile: FullProfile;
  } | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchApplicationDetail(applicationId)
      .then(setData)
      .catch((err) =>
        setError(err instanceof Error ? err.message : "Could not load this evidence."),
      )
      .finally(() => setLoading(false));
  }, [applicationId]);

  const verificationBySource = useMemo(() => {
    const map = new Map<string, FullProfile["verification_results"][number]>();
    if (data) {
      for (const v of data.profile.verification_results) map.set(v.source, v);
    }
    return map;
  }, [data]);

  const skillsBySource = useMemo(() => {
    const map = new Map<string, FullProfile["skills"]>();
    if (!data) return [] as [string, FullProfile["skills"]][];
    for (const s of data.profile.skills) {
      const list = map.get(s.source) ?? [];
      list.push(s);
      map.set(s.source, list);
    }
    return [...map.entries()].sort((x, y) => x[0].localeCompare(y[0]));
  }, [data]);

  if (loading) {
    return (
      <div className="st-loading" role="status" aria-label="Loading">
        <span className="st-spinner" aria-hidden="true" />
        <p>Loading evidence…</p>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="st-empty" role="alert">
        <h2>Evidence not found</h2>
        <p>{error ?? "This application doesn't exist, or it isn't for one of your roles."}</p>
        <Link href="/recruiter/pipeline" className="st-btn st-btn-blue">
          Back to pipeline
        </Link>
      </div>
    );
  }

  const { application: a, profile } = data;
  const c = profile.candidate;
  const score = formatMatchScore(a.match_score);
  const gh = profile.github_verification;
  const certCheck = verificationBySource.get("certificate");
  const codingCheck = verificationBySource.get("coding_platform");

  const checkedSources = profile.verification_results.length;

  return (
    <>
      <p style={{ marginBottom: 18 }}>
        <Link href={`/recruiter/applications/${a.id}`} className="st-btn st-btn-outline st-btn-sm">
          <ArrowLeft size={15} aria-hidden="true" /> Application
        </Link>
      </p>

      <RecruiterPageHead
        eyebrow={`Evidence · ${a.job_title}`}
        title={
          <>
            {c.full_name} <span className="blue">— evidence.</span>
          </>
        }
        sub={`What GroundTruth has independently checked about this candidate for ${a.job_title}. ${checkedSources === 0 ? "No verification check has run for this candidate yet — every item below says so plainly." : `${checkedSources} verification source${checkedSources === 1 ? "" : "s"} on file; anything without a check is marked “Not checked”, never presented as verified.`}`}
        actions={<span className={statusChip(a.status)}>{a.status}</span>}
      />

      <div className="st-grid st-grid-2 st-section-gap">
        <Section
          icon={<ShieldCheck size={20} />}
          title="GitHub verification"
          desc="From the repository-analysis worker, when it has run — plus the handle-existence check from onboarding."
        >
          <div className="st-kv">
            <div className="st-kv-row">
              <span>Repository analysis</span>
              <strong>
                <VerifyChip state={gh.status === "checked" ? "checked" : "not_checked"} />
              </strong>
            </div>
            {gh.status === "checked" ? (
              <>
                <div className="st-kv-row">
                  <span>Checked</span>
                  <strong>{gh.verified_at ? new Date(gh.verified_at).toLocaleString() : "—"}</strong>
                </div>
                <div className="st-kv-row">
                  <span>Source</span>
                  <strong>{gh.source_ref ?? "—"}</strong>
                </div>
                <div className="st-kv-row">
                  <span>Score</span>
                  <strong>{gh.score ?? "—"}</strong>
                </div>
              </>
            ) : (
              <p className="st-note" style={{ marginTop: 4 }}>
                No GitHub analysis has run for this candidate yet.
              </p>
            )}
            <div className="st-kv-row">
              <span>GitHub handle exists</span>
              <strong>
                {c.github_handle_exists === true
                  ? "Yes"
                  : c.github_handle_exists === false
                    ? "No — handle not found on GitHub"
                    : "Not checked"}
              </strong>
            </div>
            <div className="st-kv-row">
              <span>GitHub</span>
              <strong>
                {c.github_url ? (
                  <a href={c.github_url} target="_blank" rel="noopener noreferrer">
                    {c.github_url.replace(/^https?:\/\//, "")}
                  </a>
                ) : (
                  "—"
                )}
              </strong>
            </div>
            <div className="st-kv-row">
              <span>Match score</span>
              <strong>
                {score ?? "No score yet"}
                {score && a.match_model ? ` (${a.match_model})` : ""}
              </strong>
            </div>
          </div>
        </Section>

        <Section
          icon={<Code2 size={20} />}
          title="Coding profiles"
          desc="Platform handles the candidate linked. A profile is only “Verified” when a live check proved it."
        >
          {profile.coding_profiles.length === 0 ? (
            <EmptyLine text="No coding profiles linked yet." />
          ) : (
            <>
              {codingCheck ? (
                <p className="st-note" style={{ marginBottom: 12 }}>
                  A coding-platform check ran for this candidate on{" "}
                  {new Date(codingCheck.verified_at).toLocaleDateString()}
                  {codingCheck.source_ref ? ` (${codingCheck.source_ref})` : ""}.
                </p>
              ) : null}
              <div className="st-stack">
                {profile.coding_profiles.map((cp) => (
                  <div key={cp.id} className="st-kv-row">
                    <span>
                      {platformLabel(cp.platform)}
                      <br />
                      <span style={{ color: "var(--muted)", fontWeight: 400 }}>
                        {cp.profile_url ? (
                          <a href={cp.profile_url} target="_blank" rel="noopener noreferrer">
                            {cp.username}
                          </a>
                        ) : (
                          cp.username
                        )}
                      </span>
                    </span>
                    <strong>
                      <VerifyChip
                        state={
                          cp.verification_status === "verified"
                            ? "verified"
                            : cp.verification_status === "flagged"
                              ? "flagged"
                              : cp.verification_status === "pending"
                                ? "pending"
                                : "not_checked"
                        }
                      />
                    </strong>
                  </div>
                ))}
              </div>
            </>
          )}
        </Section>

        <Section
          icon={<Award size={20} />}
          title="Certificates"
          desc="Credentials the candidate listed. Certificate checks are candidate-level, so a check is never pinned to one certificate."
        >
          {profile.certificates.length === 0 ? (
            <EmptyLine text="No certificates listed yet." />
          ) : (
            <>
              {certCheck ? (
                <p className="st-note" style={{ marginBottom: 12 }}>
                  A certificate verification ran for this candidate on{" "}
                  {new Date(certCheck.verified_at).toLocaleDateString()} — it
                  covers the candidate, not any single certificate below.
                </p>
              ) : (
                <p className="st-note" style={{ marginBottom: 12 }}>
                  No certificate verification has run for this candidate.
                </p>
              )}
              <div className="st-stack">
                {profile.certificates.map((cert) => (
                  <div key={cert.id} className="st-kv-row">
                    <span>
                      {cert.title}
                      <br />
                      <span style={{ color: "var(--muted)", fontWeight: 400 }}>
                        {cert.issuer ?? ""}
                        {cert.issued_at ? ` · ${cert.issued_at}` : ""}
                      </span>
                    </span>
                    <strong className="st-evidence-status">
                      {cert.credential_url ? (
                        <a href={cert.credential_url} target="_blank" rel="noopener noreferrer">
                          Credential →
                        </a>
                      ) : (
                        "Not individually verified"
                      )}
                    </strong>
                  </div>
                ))}
              </div>
            </>
          )}
        </Section>

        <Section
          icon={<FileText size={20} />}
          title="Resume"
          desc="The file the candidate uploaded, and whether its text was extracted."
        >
          {profile.resumes.length === 0 ? (
            <EmptyLine text="No resume uploaded yet." />
          ) : (
            <div className="st-stack">
              {profile.resumes.map((r) => (
                <div key={r.id} className="st-kv-row">
                  <span>
                    {r.file_name ?? "Resume"}
                    <br />
                    <span style={{ color: "var(--muted)", fontWeight: 400 }}>
                      Uploaded {new Date(r.created_at).toLocaleDateString()} ·{" "}
                      {r.extracted_text ? "Text extracted" : "Text not extracted yet"}
                    </span>
                  </span>
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
          {profile.evidence_reports.length > 0 ? (
            <div style={{ marginTop: 16 }}>
              <p style={{ fontWeight: 800, marginBottom: 8 }}>Evidence reports on file</p>
              <div className="st-stack">
                {profile.evidence_reports.map((rep) => (
                  <div key={rep.id} className="st-kv-row">
                    <span>{rep.title}</span>
                    <strong>
                      <a href={rep.cloudinary_url} target="_blank" rel="noopener noreferrer">
                        Open →
                      </a>
                    </strong>
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <p className="st-note" style={{ marginTop: 16 }}>
              No evidence reports on file.
            </p>
          )}
        </Section>

        <Section
          icon={<FolderGit2 size={20} />}
          title="Skills by source"
          desc="Where each skill came from — resume, GitHub, certificate, interview or manual entry. Source is provenance, not a verification claim."
        >
          {skillsBySource.length === 0 ? (
            <EmptyLine text="No skills listed yet." />
          ) : (
            <div className="st-stack">
              {skillsBySource.map(([source, skills]) => (
                <div key={source}>
                  <p style={{ fontWeight: 800, marginBottom: 8, textTransform: "capitalize" }}>
                    {source} ({skills.length})
                  </p>
                  <div className="st-chip-row">
                    {skills.map((s) => (
                      <span
                        key={s.id}
                        className="st-chip st-chip-blue"
                        title={s.confidence ? `Confidence ${s.confidence}` : source}
                      >
                        {s.name}
                      </span>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </Section>

        <Section
          icon={<FolderGit2 size={20} />}
          title="Projects"
          desc="What the candidate has built. Repository links are on file as given — a link is not proof the candidate wrote the code."
        >
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
      </div>

      <p style={{ color: "var(--muted)", fontSize: 13, marginTop: 20 }}>
        Verification statuses come from stored checks only. Interviews are
        not part of this view — the AI interview is out of scope for Phase 6.
      </p>
    </>
  );
}

export default function RecruiterApplicationEvidencePage({
  params,
}: {
  params: { id: string };
}) {
  return (
    <RequireAuth roles={["recruiter"]}>
      <RecruiterShell>
        <EvidenceContent applicationId={params.id} />
      </RecruiterShell>
    </RequireAuth>
  );
}
