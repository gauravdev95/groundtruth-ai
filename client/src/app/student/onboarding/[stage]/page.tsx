"use client";

import Link from "next/link";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowRight, CheckCircle2, Pencil, Plus, Trash2 } from "lucide-react";
import { RequireAuth } from "@/components/auth/RequireAuth";
import { StudentPageHead, StudentShell } from "@/components/student/StudentShell";
import {
  OnboardingProgress,
  OnboardingStepper,
  StageNav,
} from "@/components/student/OnboardingShell";
import { useStudentProfile } from "@/components/student/useStudentProfile";
import {
  BasicInfoForm,
  CertificateForm,
  CodingProfileForm,
  ExperienceForm,
  GithubForm,
  ProjectForm,
} from "@/components/student/ProfileForms";
import {
  completeOnboarding,
  deleteCertificate,
  deleteCodingProfile,
  deleteExperience,
  deleteProject,
  employmentTypeLabel,
  nextStage,
  platformLabel,
  previousStage,
  stageBySlug,
  stagePath,
} from "@/lib/student";

const STAGE_META: Record<string, { eyebrow: string; title: React.ReactNode; sub: string }> = {
  "basic-info": {
    eyebrow: "Stage 2 of 8 · Basic info",
    title: <>Tell us about <span className="blue">you.</span></>,
    sub: "Who you are and what you're looking for. All fields on this stage are part of the required basic section.",
  },
  github: {
    eyebrow: "Stage 3 of 8 · GitHub",
    title: <>Link your <span className="blue">GitHub.</span></>,
    sub: "Your repositories are the evidence your profile is verified against. We check the handle exists and queue a repo analysis.",
  },
  projects: {
    eyebrow: "Stage 4 of 8 · Projects",
    title: <>Show your <span className="blue">work.</span></>,
    sub: "Add at least one project — a linked repository or a described project. This is the stage every downstream check builds on.",
  },
  "coding-profile": {
    eyebrow: "Stage 5 of 8 · Coding profile · Optional",
    title: <>Your coding <span className="blue">profiles.</span></>,
    sub: "LeetCode, Codeforces, CodeChef or another platform. Optional — skip it for now if you don't have one handy.",
  },
  certificates: {
    eyebrow: "Stage 6 of 8 · Certificates · Optional",
    title: <>Certificates & <span className="blue">achievements.</span></>,
    sub: "Credentials worth showing, with links where you have them. Optional — skip it for now if you have none to add.",
  },
  experience: {
    eyebrow: "Stage 7 of 8 · Experience · Optional",
    title: <>Your <span className="blue">experience.</span></>,
    sub: "Internships, freelance and part-time work. Optional — skip it for now if you have none yet.",
  },
  review: {
    eyebrow: "Stage 8 of 8 · Review & submit",
    title: <>Review & <span className="blue">submit.</span></>,
    sub: "Check everything once. Submitting marks onboarding complete and makes your profile visible to recruiters.",
  },
};

function StageContent({ slug }: { slug: string }) {
  const router = useRouter();
  const { profile, loading, error, refresh, setProfile } = useStudentProfile();
  const stage = stageBySlug(slug);
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [addingProject, setAddingProject] = useState(false);
  const [addingCoding, setAddingCoding] = useState(false);
  const [addingCert, setAddingCert] = useState(false);
  const [addingExp, setAddingExp] = useState(false);
  const [completeError, setCompleteError] = useState<string | null>(null);

  if (!stage) {
    return (
      <div className="st-empty">
        <h2>That stage doesn&apos;t exist</h2>
        <p>The onboarding flow has eight stages — this isn&apos;t one of them.</p>
        <button type="button" className="st-btn st-btn-blue" onClick={() => router.push("/student/onboarding")}>
          Back to setup
        </button>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="st-loading" role="status" aria-label="Loading">
        <span className="st-spinner" aria-hidden="true" />
        <p>Loading this stage…</p>
      </div>
    );
  }

  if (error || !profile) {
    return (
      <div className="st-empty">
        <h2>Couldn&apos;t load this stage</h2>
        <p>{error ?? "Something went wrong."}</p>
        <button type="button" className="st-btn st-btn-blue" onClick={() => window.location.reload()}>
          Try again
        </button>
      </div>
    );
  }

  if (profile.candidate.onboarding_completed_at) {
    router.replace("/student/dashboard");
    return null;
  }

  const meta = STAGE_META[slug] as (typeof STAGE_META)[string];
  const doneSections = new Set(
    Object.entries(profile.completeness.sections)
      .filter(([, s]) => s.done)
      .map(([k]) => k),
  );
  const next = nextStage(stage);

  async function onDelete(
    kind: "project" | "coding" | "certificate" | "experience",
    id: string,
  ) {
    setFormError(null);
    try {
      if (kind === "project") await deleteProject(id);
      if (kind === "coding") await deleteCodingProfile(id);
      if (kind === "certificate") await deleteCertificate(id);
      if (kind === "experience") await deleteExperience(id);
      await refresh();
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "Could not delete.");
    }
  }

  async function onComplete() {
    setBusy(true);
    setCompleteError(null);
    try {
      const done = await completeOnboarding();
      setProfile(done);
      router.push("/student/dashboard");
    } catch (err) {
      setCompleteError(err instanceof Error ? err.message : "Could not complete onboarding.");
    } finally {
      setBusy(false);
    }
  }

  const saved = (p: typeof profile) => setProfile(p);
  const refreshed = async () => {
    setAddingProject(false);
    setAddingCoding(false);
    setAddingCert(false);
    setAddingExp(false);
    await refresh();
  };

  return (
    <>
      <StudentPageHead eyebrow={meta.eyebrow} title={meta.title} sub={meta.sub} />
      <OnboardingStepper current={stage} doneSections={doneSections} />
      <div style={{ marginTop: 18 }}>
        <OnboardingProgress stage={stage} />
      </div>

      {formError ? (
        <div className="st-alert st-alert-error" role="alert" style={{ marginTop: 18 }}>
          {formError}
        </div>
      ) : null}

      <div className="st-panel st-section-gap">
        {slug === "basic-info" ? (
          <BasicInfoForm profile={profile} onSaved={saved} />
        ) : null}

        {slug === "github" ? <GithubForm profile={profile} onSaved={saved} /> : null}

        {slug === "projects" ? (
          <div>
            {profile.projects.length === 0 && !addingProject ? (
              <div className="st-empty-inline">
                <p>No projects added yet — add at least one to continue.</p>
              </div>
            ) : (
              <div className="st-list">
                {profile.projects.map((p) => (
                  <div className="st-list-item" key={p.id}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <h3>{p.title}</h3>
                      <p className="st-list-meta">
                        {p.kind === "repository" ? "Linked repository" : "Described project"}
                        {p.role ? ` · ${p.role}` : ""}
                      </p>
                      {p.description ? <p className="st-list-meta">{p.description}</p> : null}
                      {p.technologies.length ? (
                        <div className="st-chip-row">
                          {p.technologies.map((t) => (
                            <span key={t} className="st-chip">{t}</span>
                          ))}
                        </div>
                      ) : null}
                    </div>
                    <div className="st-list-actions">
                      <button type="button" className="st-icon-btn danger" onClick={() => void onDelete("project", p.id)}>
                        <Trash2 size={15} aria-hidden="true" /> Delete
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
            {addingProject ? (
              <div style={{ marginTop: 14 }}>
                <ProjectForm onSaved={refreshed} onCancel={() => setAddingProject(false)} />
              </div>
            ) : (
              <div style={{ marginTop: 16 }}>
                <button type="button" className="st-btn st-btn-outline st-btn-sm" onClick={() => setAddingProject(true)}>
                  <Plus size={15} aria-hidden="true" /> Add a project
                </button>
              </div>
            )}
          </div>
        ) : null}

        {slug === "coding-profile" ? (
          <div>
            {profile.coding_profiles.length === 0 && !addingCoding ? (
              <div className="st-empty-inline">
                <p>No coding profiles linked yet.</p>
              </div>
            ) : (
              <div className="st-list">
                {profile.coding_profiles.map((cp) => (
                  <div className="st-list-item" key={cp.id}>
                    <div>
                      <h3>{platformLabel(cp.platform)} — {cp.username}</h3>
                      <p className="st-list-meta">Status: {cp.verification_status}</p>
                    </div>
                    <div className="st-list-actions">
                      <button type="button" className="st-icon-btn danger" onClick={() => void onDelete("coding", cp.id)}>
                        <Trash2 size={15} aria-hidden="true" /> Delete
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
            {addingCoding ? (
              <div style={{ marginTop: 14 }}>
                <CodingProfileForm onSaved={refreshed} onCancel={() => setAddingCoding(false)} />
              </div>
            ) : (
              <div style={{ marginTop: 16 }}>
                <button type="button" className="st-btn st-btn-outline st-btn-sm" onClick={() => setAddingCoding(true)}>
                  <Plus size={15} aria-hidden="true" /> Add a coding profile
                </button>
              </div>
            )}
          </div>
        ) : null}

        {slug === "certificates" ? (
          <div>
            {profile.certificates.length === 0 && !addingCert ? (
              <div className="st-empty-inline">
                <p>No certificates added yet.</p>
              </div>
            ) : (
              <div className="st-list">
                {profile.certificates.map((cert) => (
                  <div className="st-list-item" key={cert.id}>
                    <div>
                      <h3>{cert.title}</h3>
                      <p className="st-list-meta">
                        {cert.issuer ?? "No issuer listed"}
                        {cert.issued_at ? ` · Issued ${new Date(cert.issued_at).toLocaleDateString()}` : ""}
                      </p>
                    </div>
                    <div className="st-list-actions">
                      <button type="button" className="st-icon-btn danger" onClick={() => void onDelete("certificate", cert.id)}>
                        <Trash2 size={15} aria-hidden="true" /> Delete
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
            {addingCert ? (
              <div style={{ marginTop: 14 }}>
                <CertificateForm onSaved={refreshed} onCancel={() => setAddingCert(false)} />
              </div>
            ) : (
              <div style={{ marginTop: 16 }}>
                <button type="button" className="st-btn st-btn-outline st-btn-sm" onClick={() => setAddingCert(true)}>
                  <Plus size={15} aria-hidden="true" /> Add a certificate
                </button>
              </div>
            )}
          </div>
        ) : null}

        {slug === "experience" ? (
          <div>
            {profile.experience.length === 0 && !addingExp ? (
              <div className="st-empty-inline">
                <p>No experience added yet.</p>
              </div>
            ) : (
              <div className="st-list">
                {profile.experience.map((ex) => (
                  <div className="st-list-item" key={ex.id}>
                    <div>
                      <h3>{ex.title} — {ex.organization}</h3>
                      <p className="st-list-meta">
                        {employmentTypeLabel(ex.employment_type)}
                        {ex.is_current ? " · Present" : ""}
                      </p>
                    </div>
                    <div className="st-list-actions">
                      <button type="button" className="st-icon-btn danger" onClick={() => void onDelete("experience", ex.id)}>
                        <Trash2 size={15} aria-hidden="true" /> Delete
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
            {addingExp ? (
              <div style={{ marginTop: 14 }}>
                <ExperienceForm onSaved={refreshed} onCancel={() => setAddingExp(false)} />
              </div>
            ) : (
              <div style={{ marginTop: 16 }}>
                <button type="button" className="st-btn st-btn-outline st-btn-sm" onClick={() => setAddingExp(true)}>
                  <Plus size={15} aria-hidden="true" /> Add experience
                </button>
              </div>
            )}
          </div>
        ) : null}

        {slug === "review" ? (
          <ReviewSummary profile={profile} />
        ) : null}

        {slug === "review" ? (
          <div>
            {completeError ? (
              <div className="st-alert st-alert-error" role="alert" style={{ marginTop: 16 }}>
                {completeError}
              </div>
            ) : null}
            <div className="st-form-actions">
              {previousStage(stage) ? (
                <Link href={stagePath(previousStage(stage) as (typeof stage))} className="st-btn st-btn-outline">
                  ← Back
                </Link>
              ) : (
                <span />
              )}
              <div className="st-actions-right">
                <button type="button" className="st-btn st-btn-blue" onClick={onComplete} disabled={busy}>
                  {busy ? "Submitting…" : "Submit & complete onboarding"}
                  <ArrowRight size={16} aria-hidden="true" />
                </button>
              </div>
            </div>
            <p className="st-note">
              <strong>What happens next:</strong> your profile becomes visible to
              recruiters with the completeness score above. You can edit every
              section afterwards from your profile page — nothing here is final.
            </p>
          </div>
        ) : slug === "projects" ? (
          <StageNav
            current={stage}
            onNext={() => {
              if (profile.projects.length === 0) {
                setFormError("Add at least one project before continuing — it's a required stage.");
                return;
              }
              if (next) router.push(stagePath(next));
            }}
            nextLabel="Continue to Coding profile"
          />
        ) : (
          <StageNav current={stage} />
        )}
      </div>
    </>
  );
}
function ReviewSummary({ profile }: { profile: import("@/lib/student").FullProfile }) {
  const c = profile.candidate;
  const rows: { label: string; value: string; done: boolean }[] = [
    {
      label: "Basic info",
      value: [c.headline, c.location, c.degree, c.graduation_year].filter(Boolean).join(" · ") || "Not filled in",
      done: profile.completeness.sections.basic.done,
    },
    {
      label: "GitHub",
      value: c.github_handle ? `${c.github_handle} (${c.github_handle_exists === true ? "handle found" : c.github_handle_exists === false ? "handle not found" : "not checked"})` : "Not linked",
      done: profile.completeness.sections.github.done,
    },
    {
      label: "Projects",
      value: profile.projects.length ? profile.projects.map((p) => p.title).join(", ") : "None added",
      done: profile.completeness.sections.projects.done,
    },
    {
      label: "Coding profiles",
      value: profile.coding_profiles.length ? profile.coding_profiles.map((p) => `${platformLabel(p.platform)}: ${p.username}`).join(", ") : "None added (optional)",
      done: profile.completeness.sections.coding.done,
    },
    {
      label: "Certificates",
      value: profile.certificates.length ? profile.certificates.map((x) => x.title).join(", ") : "None added (optional)",
      done: profile.completeness.sections.certificates.done,
    },
    {
      label: "Experience",
      value: profile.experience.length ? profile.experience.map((x) => `${x.title} at ${x.organization}`).join(", ") : "None added (optional)",
      done: profile.completeness.sections.experience.done,
    },
    {
      label: "Resume",
      value: profile.resumes.length ? `${profile.resumes.length} uploaded` : "Not uploaded",
      done: profile.resumes.length > 0,
    },
  ];
  return (
    <div>
      <div className="st-meter-row">
        <span className="st-meter-pct">{profile.completeness.percent}%</span>
        <span className="st-stat-label">profile complete</span>
      </div>
      <div className="st-meter" role="progressbar" aria-valuenow={profile.completeness.percent} aria-valuemin={0} aria-valuemax={100} aria-label="Profile completeness">
        <div className="st-meter-fill" style={{ width: `${profile.completeness.percent}%` }} />
      </div>
      <div className="st-kv" style={{ marginTop: 16 }}>
        {rows.map((r) => (
          <div className="st-kv-row" key={r.label}>
            <span>
              {r.done ? <CheckCircle2 size={14} aria-hidden="true" color="#16a34a" style={{ verticalAlign: "-2px", marginRight: 6 }} /> : <Pencil size={13} aria-hidden="true" style={{ verticalAlign: "-1px", marginRight: 6 }} />}
              {r.label}
            </span>
            <strong>{r.value}</strong>
          </div>
        ))}
      </div>
      {profile.completeness.missing.filter((m) => ["basic", "github", "projects"].includes(m)).length > 0 ? (
        <div className="st-alert st-alert-error" role="alert" style={{ marginTop: 16 }}>
          Required sections still missing:{" "}
          {profile.completeness.missing.filter((m) => ["basic", "github", "projects"].includes(m)).join(", ")}.
          Go back and fill them in before submitting.
        </div>
      ) : null}
    </div>
  );
}

export default function StudentOnboardingStagePage({
  params,
}: {
  params: { stage: string };
}) {
  return (
    <RequireAuth roles={["candidate"]}>
      <StudentShell>
        <StageContent slug={params.stage} />
      </StudentShell>
    </RequireAuth>
  );
}
