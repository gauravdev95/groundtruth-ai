"use client";

import { useState } from "react";
import Link from "next/link";
import {
  ArrowRight,
  Award,
  Briefcase,
  Code2,
  FolderGit2,
  Github,
  Linkedin,
  Pencil,
  Plus,
  Trash2,
  X,
} from "lucide-react";
import { RequireAuth } from "@/components/auth/RequireAuth";
import { StudentPageHead, StudentShell } from "@/components/student/StudentShell";
import {
  AiMonitoringCard,
  ProfileStrengthCard,
} from "@/components/student/ProfileStrength";
import { useStudentProfile } from "@/components/student/useStudentProfile";
import {
  BasicInfoForm,
  CertificateForm,
  CodingProfileForm,
  ExperienceForm,
  GithubForm,
  ProjectForm,
  ResumeCard,
} from "@/components/student/ProfileForms";
import { initialsFor } from "@/lib/auth";
import {
  branchLabel,
  degreeLabel,
  deleteCertificate,
  deleteCodingProfile,
  deleteExperience,
  deleteProject,
  employmentTypeLabel,
  platformLabel,
  targetRoleLabel,
  type Certificate,
  type CodingProfile,
  type Experience,
  type FullProfile,
  type Project,
} from "@/lib/student";

function Section({
  title,
  desc,
  icon,
  onEdit,
  editing,
  children,
  editForm,
}: {
  title: string;
  desc: string;
  icon: React.ReactNode;
  onEdit?: () => void;
  editing: boolean;
  children: React.ReactNode;
  editForm?: React.ReactNode;
}) {
  return (
    <section className="st-panel" aria-label={title}>
      <div className="st-panel-head">
        <div>
          <h2>{title}</h2>
          <p className="st-panel-desc">{desc}</p>
        </div>
        <span style={{ display: "flex", gap: 8, alignItems: "flex-start" }}>
          <span className="st-panel-icon" aria-hidden="true">
            {icon}
          </span>
          {onEdit ? (
            <button
              type="button"
              className="st-icon-btn"
              onClick={onEdit}
              aria-label={`Edit ${title}`}
            >
              {editing ? <X size={15} aria-hidden="true" /> : <Pencil size={15} aria-hidden="true" />}
              {editing ? "Close" : "Edit"}
            </button>
          ) : null}
        </span>
      </div>
      {editing && editForm ? editForm : children}
    </section>
  );
}

function EmptyList({
  text,
  action,
}: {
  text: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="st-empty-inline">
      <p>{text}</p>
      {action}
    </div>
  );
}

function ProfileContent() {
  const { profile, loading, error, refresh, setProfile } = useStudentProfile();
  const [editBasic, setEditBasic] = useState(false);
  const [editGithub, setEditGithub] = useState(false);
  const [addingProject, setAddingProject] = useState(false);
  const [editingProject, setEditingProject] = useState<Project | null>(null);
  const [addingCoding, setAddingCoding] = useState(false);
  const [editingCoding, setEditingCoding] = useState<CodingProfile | null>(null);
  const [addingCert, setAddingCert] = useState(false);
  const [editingCert, setEditingCert] = useState<Certificate | null>(null);
  const [addingExp, setAddingExp] = useState(false);
  const [editingExp, setEditingExp] = useState<Experience | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  if (loading) {
    return (
      <div className="st-loading" role="status" aria-label="Loading">
        <span className="st-spinner" aria-hidden="true" />
        <p>Loading your profile…</p>
      </div>
    );
  }

  if (error || !profile) {
    return (
      <div className="st-empty">
        <h2>Couldn&apos;t load your profile</h2>
        <p>{error ?? "Something went wrong."}</p>
        <button type="button" className="st-btn st-btn-blue" onClick={() => window.location.reload()}>
          Try again
        </button>
      </div>
    );
  }

  const c = profile.candidate;
  const completeness = profile.completeness;

  async function onDelete(
    kind: "project" | "coding" | "certificate" | "experience",
    id: string,
  ) {
    setDeleteError(null);
    try {
      if (kind === "project") await deleteProject(id);
      if (kind === "coding") await deleteCodingProfile(id);
      if (kind === "certificate") await deleteCertificate(id);
      if (kind === "experience") await deleteExperience(id);
      await refresh();
    } catch (err) {
      setDeleteError(err instanceof Error ? err.message : "Could not delete.");
    }
  }

  const saved = (p: FullProfile) => {
    setProfile(p);
    setEditBasic(false);
    setEditGithub(false);
  };

  const refreshed = async () => {
    setAddingProject(false);
    setEditingProject(null);
    setAddingCoding(false);
    setEditingCoding(null);
    setAddingCert(false);
    setEditingCert(null);
    setAddingExp(false);
    setEditingExp(null);
    await refresh();
  };

  return (
    <>
      <StudentPageHead
        eyebrow="Student profile"
        title={
          <>
            Your <span className="blue">verified profile.</span>
          </>
        }
        sub="Everything a recruiter sees about you — edit any section, and the change is saved to your profile straight away."
        actions={
          <Link href="/student/dashboard" className="st-btn st-btn-outline">
            Back to dashboard
          </Link>
        }
      />

      {deleteError ? (
        <div className="st-alert st-alert-error" role="alert" style={{ marginBottom: 18 }}>
          {deleteError}
        </div>
      ) : null}

      {/* Header card */}
      <div className="st-panel">
        <div className="st-profile-head">
          <span className="st-avatar" aria-hidden="true">
            {initialsFor(c.full_name)}
          </span>
          <div style={{ flex: 1, minWidth: 220 }}>
            <h2 style={{ fontSize: 24 }}>{c.full_name}</h2>
            <p className="st-panel-desc" style={{ marginTop: 4 }}>
              {c.headline ?? "No headline yet — add one in Basic info."}
            </p>
            <p className="st-panel-desc">
              {c.location ?? "No location yet"}
              {c.graduation_year ? ` · Graduating ${c.graduation_year}` : ""}
              {c.degree ? ` · ${degreeLabel(c.degree)} (${branchLabel(c.branch)})` : ""}
            </p>
            <div className="st-chip-row">
              {c.target_roles.map((r) => (
                <span key={r} className="st-chip st-chip-blue">{targetRoleLabel(r)}</span>
              ))}
              {profile.skills.map((s) => (
                <span key={s.id} className="st-chip">{s.name}</span>
              ))}
            </div>
          </div>
          <div style={{ textAlign: "right" }}>
            <div className="st-meter-pct">{completeness.percent}%</div>
            <div className="st-stat-label">profile complete</div>
            <div style={{ marginTop: 10 }}>
              {c.onboarding_completed_at ? (
                <span className="st-chip st-chip-green">Onboarding complete</span>
              ) : (
                <Link href="/student/onboarding" className="st-btn st-btn-blue st-btn-sm">
                  Finish onboarding <ArrowRight size={15} aria-hidden="true" />
                </Link>
              )}
            </div>
          </div>
        </div>
        {c.summary ? (
          <p className="st-note" style={{ marginTop: 18 }}>{c.summary}</p>
        ) : null}
        <div className="st-chip-row" style={{ marginTop: 14 }}>
          {c.github_url ? (
            <a className="st-chip st-chip-blue" href={c.github_url} target="_blank" rel="noreferrer">
              <Github size={13} aria-hidden="true" style={{ marginRight: 5 }} /> GitHub
            </a>
          ) : null}
          {c.linkedin_url ? (
            <a className="st-chip st-chip-blue" href={c.linkedin_url} target="_blank" rel="noreferrer">
              <Linkedin size={13} aria-hidden="true" style={{ marginRight: 5 }} /> LinkedIn
            </a>
          ) : null}
          {c.portfolio_url ? (
            <a className="st-chip st-chip-blue" href={c.portfolio_url} target="_blank" rel="noreferrer">
              Portfolio
            </a>
          ) : null}
          {c.phone ? <span className="st-chip">{c.phone}</span> : null}
          <span className="st-chip">{c.email}</span>
        </div>
      </div>

      <div className="st-grid st-grid-2 st-section-gap">
        <ProfileStrengthCard profile={profile} />
        <AiMonitoringCard profile={profile} summary />
      </div>

      <div className="st-stack st-section-gap">
        {/* Basic info */}
        <Section
          title="Basic info"
          desc="Who you are, what you're looking for, and the skills recruiters match on."
          icon={<Pencil size={20} />}
          onEdit={() => setEditBasic((v) => !v)}
          editing={editBasic}
          editForm={<BasicInfoForm profile={profile} onSaved={saved} />}
        >
          <div className="st-kv">
            <div className="st-kv-row"><span>Headline</span><strong>{c.headline ?? "—"}</strong></div>
            <div className="st-kv-row"><span>Location</span><strong>{c.location ?? "—"}</strong></div>
            <div className="st-kv-row"><span>Phone</span><strong>{c.phone ?? "—"}</strong></div>
            <div className="st-kv-row"><span>Degree</span><strong>{c.degree ? `${degreeLabel(c.degree)} · ${branchLabel(c.branch)}` : "—"}</strong></div>
            <div className="st-kv-row"><span>Graduation year</span><strong>{c.graduation_year ?? "—"}</strong></div>
            <div className="st-kv-row"><span>Target roles</span><strong>{c.target_roles.length ? c.target_roles.map(targetRoleLabel).join(", ") : "—"}</strong></div>
            <div className="st-kv-row"><span>Skills</span><strong>{profile.skills.length ? profile.skills.map((s) => s.name).join(", ") : "—"}</strong></div>
          </div>
        </Section>

        {/* GitHub (plain optional text — never verified) */}
        <Section
          title="GitHub (optional)"
          desc="Your GitHub username, shown as a plain link on your profile. It is not verified here."
          icon={<Github size={20} />}
          onEdit={() => setEditGithub((v) => !v)}
          editing={editGithub}
          editForm={<GithubForm profile={profile} onSaved={saved} />}
        >
          {c.github_handle ? (
            <div className="st-kv">
              <div className="st-kv-row"><span>Username</span><strong>{c.github_handle}</strong></div>
              <div className="st-kv-row">
                <span>Profile</span>
                <strong>
                  {c.github_url ? (
                    <a href={c.github_url} target="_blank" rel="noreferrer" style={{ color: "var(--blue)", fontWeight: 700 }}>
                      {c.github_url}
                    </a>
                  ) : (
                    "—"
                  )}
                </strong>
              </div>
            </div>
          ) : (
            <EmptyList text="No GitHub username added yet — this is optional." action={
              <button type="button" className="st-btn st-btn-blue st-btn-sm" onClick={() => setEditGithub(true)}>
                Add GitHub username
              </button>
            } />
          )}
        </Section>

        {/* Resume */}
        <Section
          title="Resume"
          desc="Your uploaded PDF resume."
          icon={<Briefcase size={20} />}
          editing={false}
        >
          <ResumeCard profile={profile} onSaved={setProfile} />
        </Section>

        {/* Your one project */}
        <Section
          title="Your project"
          desc="Your one selected project — the evidence your interviews build on. Edit it or replace it; there is only ever one."
          icon={<FolderGit2 size={20} />}
          editing={false}
        >
          {profile.projects.length === 0 && !addingProject ? (
            <EmptyList text="No project selected yet — add your one project to complete onboarding." />
          ) : (
            <div className="st-list">
              {profile.projects.slice(0, 1).map((p) => (
                <div className="st-list-item" key={p.id}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <h3>{p.title}</h3>
                    <p className="st-list-meta">
                      {p.kind === "repository" ? "Linked repository" : "Described project"}
                      {p.role ? ` · ${p.role}` : ""}
                      {p.started_at ? ` · ${p.started_at.slice(0, 4)}` : ""}
                      {p.ended_at ? `–${p.ended_at.slice(0, 4)}` : ""}
                    </p>
                    {p.description ? <p className="st-list-meta">{p.description}</p> : null}
                    {p.technologies.length ? (
                      <div className="st-chip-row">
                        {p.technologies.map((t) => (
                          <span key={t} className="st-chip">{t}</span>
                        ))}
                      </div>
                    ) : null}
                    {p.repo_url ? (
                      <p className="st-list-meta">
                        <a href={p.repo_url} target="_blank" rel="noreferrer" style={{ color: "var(--blue)", fontWeight: 700 }}>
                          {p.repo_url}
                        </a>
                      </p>
                    ) : null}
                    {editingProject?.id === p.id ? (
                      <div style={{ marginTop: 14 }}>
                        <ProjectForm initial={p} onSaved={refreshed} onCancel={() => setEditingProject(null)} />
                      </div>
                    ) : null}
                  </div>
                  <div className="st-list-actions">
                    <button type="button" className="st-icon-btn" onClick={() => { setEditingProject(p); setAddingProject(false); }}>
                      <Pencil size={15} aria-hidden="true" /> Edit
                    </button>
                    <button type="button" className="st-icon-btn danger" onClick={() => void onDelete("project", p.id)}>
                      <Trash2 size={15} aria-hidden="true" /> Replace
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
          ) : profile.projects.length === 0 ? (
            <div style={{ marginTop: 14 }}>
              <button type="button" className="st-btn st-btn-outline st-btn-sm" onClick={() => { setAddingProject(true); setEditingProject(null); }}>
                <Plus size={15} aria-hidden="true" /> Add your project
              </button>
            </div>
          ) : null}
        </Section>

        {/* Coding profiles */}
        <Section
          title="Coding profiles"
          desc="LeetCode, Codeforces, CodeChef and other competitive-programming profiles."
          icon={<Code2 size={20} />}
          editing={false}
        >
          {profile.coding_profiles.length === 0 && !addingCoding ? (
            <EmptyList text="No coding profiles linked yet. This stage is optional." />
          ) : (
            <div className="st-list">
              {profile.coding_profiles.map((cp) => (
                <div className="st-list-item" key={cp.id}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <h3>{platformLabel(cp.platform)} — {cp.username}</h3>
                    <p className="st-list-meta">
                      Status: <span className="st-chip st-chip-grey">{cp.verification_status}</span>
                    </p>
                    {cp.profile_url ? (
                      <p className="st-list-meta">
                        <a href={cp.profile_url} target="_blank" rel="noreferrer" style={{ color: "var(--blue)", fontWeight: 700 }}>
                          {cp.profile_url}
                        </a>
                      </p>
                    ) : null}
                    {editingCoding?.id === cp.id ? (
                      <div style={{ marginTop: 14 }}>
                        <CodingProfileForm initial={cp} onSaved={refreshed} onCancel={() => setEditingCoding(null)} />
                      </div>
                    ) : null}
                  </div>
                  <div className="st-list-actions">
                    <button type="button" className="st-icon-btn" onClick={() => { setEditingCoding(cp); setAddingCoding(false); }}>
                      <Pencil size={15} aria-hidden="true" /> Edit
                    </button>
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
            <div style={{ marginTop: 14 }}>
              <button type="button" className="st-btn st-btn-outline st-btn-sm" onClick={() => { setAddingCoding(true); setEditingCoding(null); }}>
                <Plus size={15} aria-hidden="true" /> Add coding profile
              </button>
            </div>
          )}
        </Section>

        {/* Certificates */}
        <Section
          title="Certificates"
          desc="Credentials worth showing, with links where you have them."
          icon={<Award size={20} />}
          editing={false}
        >
          {profile.certificates.length === 0 && !addingCert ? (
            <EmptyList text="No certificates added yet. This stage is optional." />
          ) : (
            <div className="st-list">
              {profile.certificates.map((cert) => (
                <div className="st-list-item" key={cert.id}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <h3>{cert.title}</h3>
                    <p className="st-list-meta">
                      {cert.issuer ?? "No issuer listed"}
                      {cert.issued_at ? ` · Issued ${new Date(cert.issued_at).toLocaleDateString()}` : ""}
                    </p>
                    {cert.credential_url ? (
                      <p className="st-list-meta">
                        <a href={cert.credential_url} target="_blank" rel="noreferrer" style={{ color: "var(--blue)", fontWeight: 700 }}>
                          Verify credential
                        </a>
                      </p>
                    ) : null}
                    {editingCert?.id === cert.id ? (
                      <div style={{ marginTop: 14 }}>
                        <CertificateForm initial={cert} onSaved={refreshed} onCancel={() => setEditingCert(null)} />
                      </div>
                    ) : null}
                  </div>
                  <div className="st-list-actions">
                    <button type="button" className="st-icon-btn" onClick={() => { setEditingCert(cert); setAddingCert(false); }}>
                      <Pencil size={15} aria-hidden="true" /> Edit
                    </button>
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
            <div style={{ marginTop: 14 }}>
              <button type="button" className="st-btn st-btn-outline st-btn-sm" onClick={() => { setAddingCert(true); setEditingCert(null); }}>
                <Plus size={15} aria-hidden="true" /> Add certificate
              </button>
            </div>
          )}
        </Section>

        {/* Experience */}
        <Section
          title="Experience"
          desc="Internships, freelance and part-time work."
          icon={<Briefcase size={20} />}
          editing={false}
        >
          {profile.experience.length === 0 && !addingExp ? (
            <EmptyList text="No experience added yet. This stage is optional." />
          ) : (
            <div className="st-list">
              {profile.experience.map((ex) => (
                <div className="st-list-item" key={ex.id}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <h3>{ex.title} — {ex.organization}</h3>
                    <p className="st-list-meta">
                      {employmentTypeLabel(ex.employment_type)}
                      {ex.start_date ? ` · ${ex.start_date.slice(0, 7)}` : ""}
                      {ex.is_current ? " – Present" : ex.end_date ? ` – ${ex.end_date.slice(0, 7)}` : ""}
                    </p>
                    {ex.description ? <p className="st-list-meta">{ex.description}</p> : null}
                    {editingExp?.id === ex.id ? (
                      <div style={{ marginTop: 14 }}>
                        <ExperienceForm initial={ex} onSaved={refreshed} onCancel={() => setEditingExp(null)} />
                      </div>
                    ) : null}
                  </div>
                  <div className="st-list-actions">
                    <button type="button" className="st-icon-btn" onClick={() => { setEditingExp(ex); setAddingExp(false); }}>
                      <Pencil size={15} aria-hidden="true" /> Edit
                    </button>
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
            <div style={{ marginTop: 14 }}>
              <button type="button" className="st-btn st-btn-outline st-btn-sm" onClick={() => { setAddingExp(true); setEditingExp(null); }}>
                <Plus size={15} aria-hidden="true" /> Add experience
              </button>
            </div>
          )}
        </Section>
      </div>
    </>
  );
}

export default function StudentProfilePage() {
  return (
    <RequireAuth roles={["candidate"]}>
      <StudentShell>
        <ProfileContent />
      </StudentShell>
    </RequireAuth>
  );
}
