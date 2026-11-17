"use client";

import { useState, type FormEvent } from "react";
import {
  AlertCircle,
  CheckCircle2,
  Download,
  FileText,
  Github,
  Upload,
} from "lucide-react";
import {
  BRANCH_OPTIONS,
  DEGREE_OPTIONS,
  EMPLOYMENT_TYPE_OPTIONS,
  TARGET_ROLE_OPTIONS,
  CODING_PLATFORM_OPTIONS,
  branchLabel,
  createCertificate,
  createCodingProfile,
  createExperience,
  createProject,
  degreeLabel,
  downloadResumeFile,
  employmentTypeLabel,
  fetchProfile,
  graduationYearOptions,
  platformLabel,
  targetRoleLabel,
  updateCertificate,
  updateCodingProfile,
  updateExperience,
  updateGithub,
  updateProfile,
  updateProject,
  uploadResume,
  type Certificate,
  type CertificateInput,
  type CodingProfile,
  type CodingProfileInput,
  type Experience,
  type ExperienceInput,
  type FullProfile,
  type Project,
  type ProjectInput,
} from "@/lib/student";

// ── Shared bits ────────────────────────────────────────────────────────────

function FormError({ message }: { message: string | null }) {
  if (!message) return null;
  return (
    <div className="st-alert st-alert-error" role="alert">
      <AlertCircle size={17} aria-hidden="true" />
      <span>{message}</span>
    </div>
  );
}

function Field({
  label,
  children,
  hint,
  full,
}: {
  label: string;
  children: React.ReactNode;
  hint?: string;
  full?: boolean;
}) {
  return (
    <label className={`st-field${full ? " st-field-full" : ""}`}>
      <span className="st-label">{label}</span>
      {children}
      {hint ? <span className="st-hint">{hint}</span> : null}
    </label>
  );
}

function inputClassName(): string {
  return "st-input";
}

// ── Basic info ─────────────────────────────────────────────────────────────

export function BasicInfoForm({
  profile,
  onSaved,
}: {
  profile: FullProfile;
  onSaved: (p: FullProfile) => void;
}) {
  const c = profile.candidate;
  const [fullName, setFullName] = useState(c.full_name);
  const [headline, setHeadline] = useState(c.headline ?? "");
  const [location, setLocation] = useState(c.location ?? "");
  const [phone, setPhone] = useState(c.phone ?? "");
  const [summary, setSummary] = useState(c.summary ?? "");
  const [degree, setDegree] = useState(c.degree ?? "");
  const [branch, setBranch] = useState(c.branch ?? "");
  const [gradYear, setGradYear] = useState(c.graduation_year ? String(c.graduation_year) : "");
  const [roles, setRoles] = useState<string[]>(c.target_roles);
  const [linkedin, setLinkedin] = useState(c.linkedin_url ?? "");
  const [portfolio, setPortfolio] = useState(c.portfolio_url ?? "");
  const [skills, setSkills] = useState(profile.skills.map((s) => s.name).join(", "));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  function toggleRole(role: string) {
    setRoles((prev) =>
      prev.includes(role) ? prev.filter((r) => r !== role) : [...prev, role],
    );
    setSaved(false);
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setSaved(false);
    try {
      const next = await updateProfile({
        full_name: fullName.trim(),
        headline: headline.trim() || null,
        location: location.trim() || null,
        phone: phone.trim() || null,
        summary: summary.trim() || null,
        degree: degree || null,
        branch: branch || null,
        graduation_year: gradYear ? Number(gradYear) : null,
        target_roles: roles,
        linkedin_url: linkedin.trim() || null,
        portfolio_url: portfolio.trim() || null,
        skills: skills.split(",").map((s) => s.trim()).filter(Boolean),
      });
      onSaved(next);
      setSaved(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="st-form">
      <FormError message={error} />
      {saved ? (
        <div className="st-alert st-alert-success" role="status">
          <CheckCircle2 size={17} aria-hidden="true" />
          <span>Basic info saved.</span>
        </div>
      ) : null}
      <div className="st-form-grid">
        <Field label="Full name">
          <input className={inputClassName()} value={fullName} onChange={(e) => setFullName(e.target.value)} required maxLength={200} />
        </Field>
        <Field label="Headline" hint="One line recruiters see first — e.g. Full-Stack Developer.">
          <input className={inputClassName()} value={headline} onChange={(e) => setHeadline(e.target.value)} placeholder="Full-Stack Developer" maxLength={200} />
        </Field>
        <Field label="Location">
          <input className={inputClassName()} value={location} onChange={(e) => setLocation(e.target.value)} placeholder="Agra, India" maxLength={200} />
        </Field>
        <Field label="Phone (optional)">
          <input className={inputClassName()} value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+91 …" maxLength={30} />
        </Field>
        <Field label="About you" full hint="Two or three sentences: what you build, what you're looking for.">
          <textarea className="st-input st-textarea" value={summary} onChange={(e) => setSummary(e.target.value)} placeholder="B.Tech CSE student building…" maxLength={5000} />
        </Field>
        <Field label="Degree">
          <select className="st-input st-select" value={degree} onChange={(e) => setDegree(e.target.value)}>
            <option value="">Select a degree</option>
            {DEGREE_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
        </Field>
        <Field label="Branch">
          <select className="st-input st-select" value={branch} onChange={(e) => setBranch(e.target.value)}>
            <option value="">Select a branch</option>
            {BRANCH_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
        </Field>
        <Field label="Graduation year">
          <select className="st-input st-select" value={gradYear} onChange={(e) => setGradYear(e.target.value)}>
            <option value="">Select a year</option>
            {graduationYearOptions().map((y) => (
              <option key={y} value={y}>{y}</option>
            ))}
          </select>
        </Field>
        <Field label="Target roles" full>
          <span className="st-checkbox-grid">
            {TARGET_ROLE_OPTIONS.map((o) => (
              <label key={o.value} className={`st-check-pill${roles.includes(o.value) ? " on" : ""}`}>
                <input type="checkbox" checked={roles.includes(o.value)} onChange={() => toggleRole(o.value)} />
                {o.label}
              </label>
            ))}
          </span>
        </Field>
        <Field label="LinkedIn URL (optional)">
          <input className={inputClassName()} type="url" value={linkedin} onChange={(e) => setLinkedin(e.target.value)} placeholder="https://linkedin.com/in/…" />
        </Field>
        <Field label="Portfolio URL (optional)">
          <input className={inputClassName()} type="url" value={portfolio} onChange={(e) => setPortfolio(e.target.value)} placeholder="https://…" />
        </Field>
        <Field label="Skills" full hint="Comma-separated — e.g. Python, React, FastAPI. These are the skills recruiters match on.">
          <input className={inputClassName()} value={skills} onChange={(e) => setSkills(e.target.value)} placeholder="Python, React, FastAPI" />
        </Field>
      </div>
      <div>
        <button type="submit" className="st-btn st-btn-blue" disabled={busy}>
          {busy ? "Saving…" : "Save basic info"}
        </button>
      </div>
      <p className="st-hint">
        Saved as: {degreeLabel(degree || null)} · {branchLabel(branch || null)}
        {gradYear ? ` · ${gradYear}` : ""} · {roles.map(targetRoleLabel).join(", ") || "no target role yet"}
      </p>
    </form>
  );
}

// ── GitHub (plain optional text field) ─────────────────────────────────────
// The username is saved as plain text only. It is NOT checked against
// GitHub, shows no verified/unverified badge, and triggers no background
// verification worker. The profile page displays it as a link, nothing more.
export function GithubForm({
  profile,
  onSaved,
}: {
  profile: FullProfile;
  onSaved: (p: FullProfile) => void;
}) {
  const c = profile.candidate;
  const [handle, setHandle] = useState(c.github_handle ?? c.github_url ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setSaved(false);
    try {
      const next = await updateGithub({ github_handle: handle.trim() });
      onSaved(next);
      setSaved(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="st-form">
      <FormError message={error} />
      {saved ? (
        <div className="st-alert st-alert-success" role="status">
          <CheckCircle2 size={17} aria-hidden="true" />
          <span>GitHub username saved.</span>
        </div>
      ) : null}
      <Field label="GitHub username (optional)" hint="Just a link on your profile — we don't verify it here. Leave it blank if you don't want to show one.">
        <span style={{ position: "relative", display: "block" }}>
          <Github size={16} aria-hidden="true" style={{ position: "absolute", left: 14, top: "50%", transform: "translateY(-50%)", color: "var(--muted2)" }} />
          <input className={inputClassName()} style={{ paddingLeft: 40 }} value={handle} onChange={(e) => setHandle(e.target.value)} placeholder="octocat or https://github.com/octocat" />
        </span>
      </Field>
      <div>
        <button type="submit" className="st-btn st-btn-blue" disabled={busy}>
          {busy ? "Saving…" : "Save GitHub username"}
        </button>
      </div>
      {c.github_handle ? (
        <div className="st-note">
          <strong>GitHub:</strong> {c.github_handle} — shown on your profile as a plain link.
        </div>
      ) : null}
    </form>
  );
}

// ── Resume ─────────────────────────────────────────────────────────────────

export function ResumeCard({
  profile,
  onSaved,
}: {
  profile: FullProfile;
  onSaved: (p: FullProfile) => void;
}) {
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  async function onUpload(e: FormEvent) {
    e.preventDefault();
    if (!file) return;
    setBusy(true);
    setError(null);
    setNote(null);
    try {
      const { resume_parsing } = await uploadResume(file);
      setNote(resume_parsing);
      setFile(null);
      onSaved(await fetchProfile());
    } catch (err) {
      setError(err instanceof Error ? err.message : "Upload failed.");
    } finally {
      setBusy(false);
    }
  }

  async function onDownload(resumeId: string) {
    const resume = profile.resumes.find((r) => r.id === resumeId);
    if (!resume) return;
    try {
      await downloadResumeFile(resume);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Download failed.");
    }
  }

  return (
    <div>
      <FormError message={error} />
      {note ? (
        <div className="st-alert st-alert-info" role="status">
          <FileText size={17} aria-hidden="true" />
          <span>{note}</span>
        </div>
      ) : null}
      {profile.resumes.length === 0 ? (
        <div className="st-empty-inline">
          <span className="st-empty-icon" aria-hidden="true">
            <FileText size={22} />
          </span>
          <h3>No resume uploaded yet</h3>
          <p>Upload a PDF resume. It&apos;s stored with your profile and shown to recruiters with your applications.</p>
        </div>
      ) : (
        <div className="st-list">
          {profile.resumes.map((r) => (
            <div className="st-list-item" key={r.id}>
              <div>
                <h3>{r.file_name ?? "Resume"}</h3>
                <p className="st-list-meta">
                  Uploaded {new Date(r.created_at).toLocaleDateString()} ·{" "}
                  {r.storage === "cloudinary" ? "Stored in Cloudinary" : "Stored on the server"}
                </p>
              </div>
              <div className="st-list-actions">
                <button type="button" className="st-icon-btn" onClick={() => void onDownload(r.id)}>
                  <Download size={15} aria-hidden="true" /> Download
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
      <form onSubmit={onUpload} className="st-form" style={{ marginTop: 16 }}>
        <label className="st-file-drop" htmlFor="resume-file">
          <Upload size={20} aria-hidden="true" color="#2f4bff" />
          <strong>{file ? file.name : "Choose a PDF resume"}</strong>
          <span>PDF only, up to 10 MB. Uploading a new resume keeps the old ones listed below your latest.</span>
          <input
            id="resume-file"
            type="file"
            accept="application/pdf"
            style={{ display: "none" }}
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
          />
        </label>
        <div>
          <button type="submit" className="st-btn st-btn-blue" disabled={busy || !file}>
            {busy ? "Uploading…" : "Upload resume"}
          </button>
        </div>
      </form>
    </div>
  );
}

// ── Project ────────────────────────────────────────────────────────────────

export function ProjectForm({
  initial,
  onSaved,
  onCancel,
}: {
  initial?: Project;
  onSaved: () => void;
  onCancel?: () => void;
}) {
  const [title, setTitle] = useState(initial?.title ?? "");
  const [description, setDescription] = useState(initial?.description ?? "");
  const [kind, setKind] = useState<"repository" | "described">(initial?.kind ?? "described");
  const [repoUrl, setRepoUrl] = useState(initial?.repo_url ?? "");
  const [role, setRole] = useState(initial?.role ?? "");
  const [tech, setTech] = useState((initial?.technologies ?? []).join(", "));
  const [startedAt, setStartedAt] = useState(initial?.started_at?.slice(0, 10) ?? "");
  const [endedAt, setEndedAt] = useState(initial?.ended_at?.slice(0, 10) ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const input: ProjectInput = {
        title: title.trim(),
        description: description.trim(),
        kind,
        repo_url: repoUrl.trim() || null,
        role: role.trim() || null,
        technologies: tech.split(",").map((t) => t.trim()).filter(Boolean),
        started_at: startedAt || null,
        ended_at: endedAt || null,
      };
      if (initial) await updateProject(initial.id, input);
      else await createProject(input);
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="st-form">
      <FormError message={error} />
      <div className="st-form-grid">
        <Field label="Project title">
          <input className={inputClassName()} value={title} onChange={(e) => setTitle(e.target.value)} required maxLength={200} placeholder="GroundTruth AI" />
        </Field>
        <Field label="Your role (optional)">
          <input className={inputClassName()} value={role} onChange={(e) => setRole(e.target.value)} maxLength={200} placeholder="Backend developer" />
        </Field>
        <Field label="Type">
          <select className="st-input st-select" value={kind} onChange={(e) => setKind(e.target.value as "repository" | "described")}>
            <option value="described">Described project</option>
            <option value="repository">Linked repository</option>
          </select>
        </Field>
        <Field label="Repository URL (optional)">
          <input className={inputClassName()} type="url" value={repoUrl} onChange={(e) => setRepoUrl(e.target.value)} placeholder="https://github.com/…/…" />
        </Field>
        <Field label="What it does" full>
          <textarea className="st-input st-textarea" value={description} onChange={(e) => setDescription(e.target.value)} placeholder="What the project does, what you built, what it proves." maxLength={5000} />
        </Field>
        <Field label="Technologies" full hint="Comma-separated — e.g. Python, FastAPI, React.">
          <input className={inputClassName()} value={tech} onChange={(e) => setTech(e.target.value)} placeholder="Python, FastAPI, React" />
        </Field>
        <Field label="Started (optional)">
          <input className={inputClassName()} type="date" value={startedAt} onChange={(e) => setStartedAt(e.target.value)} />
        </Field>
        <Field label="Ended (optional)">
          <input className={inputClassName()} type="date" value={endedAt} onChange={(e) => setEndedAt(e.target.value)} />
        </Field>
      </div>
      <div style={{ display: "flex", gap: 10 }}>
        <button type="submit" className="st-btn st-btn-blue" disabled={busy}>
          {busy ? "Saving…" : initial ? "Save project" : "Add project"}
        </button>
        {onCancel ? (
          <button type="button" className="st-btn st-btn-outline" onClick={onCancel}>
            Cancel
          </button>
        ) : null}
      </div>
    </form>
  );
}

// ── Coding profile ─────────────────────────────────────────────────────────

export function CodingProfileForm({
  initial,
  onSaved,
  onCancel,
}: {
  initial?: CodingProfile;
  onSaved: () => void;
  onCancel?: () => void;
}) {
  const [platform, setPlatform] = useState(initial?.platform ?? "leetcode");
  const [username, setUsername] = useState(initial?.username ?? "");
  const [profileUrl, setProfileUrl] = useState(initial?.profile_url ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const input: CodingProfileInput = {
        platform,
        username: username.trim(),
        profile_url: profileUrl.trim() || null,
      };
      if (initial) await updateCodingProfile(initial.id, input);
      else await createCodingProfile(input);
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="st-form">
      <FormError message={error} />
      <div className="st-form-grid">
        <Field label="Platform">
          <select className="st-input st-select" value={platform} onChange={(e) => setPlatform(e.target.value)}>
            {CODING_PLATFORM_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
        </Field>
        <Field label="Username">
          <input className={inputClassName()} value={username} onChange={(e) => setUsername(e.target.value)} required maxLength={100} placeholder="gauravdev95" />
        </Field>
        <Field label="Profile URL (optional)" full>
          <input className={inputClassName()} type="url" value={profileUrl} onChange={(e) => setProfileUrl(e.target.value)} placeholder="https://leetcode.com/u/…" />
        </Field>
      </div>
      <p className="st-hint">
        Status stays <strong>unverified</strong> until a live platform check runs — this phase records what you entered and never claims a check that didn&apos;t happen.
      </p>
      <div style={{ display: "flex", gap: 10 }}>
        <button type="submit" className="st-btn st-btn-blue" disabled={busy}>
          {busy ? "Saving…" : initial ? "Save profile" : "Add coding profile"}
        </button>
        {onCancel ? (
          <button type="button" className="st-btn st-btn-outline" onClick={onCancel}>
            Cancel
          </button>
        ) : null}
      </div>
    </form>
  );
}

// ── Certificate ────────────────────────────────────────────────────────────

export function CertificateForm({
  initial,
  onSaved,
  onCancel,
}: {
  initial?: Certificate;
  onSaved: () => void;
  onCancel?: () => void;
}) {
  const [title, setTitle] = useState(initial?.title ?? "");
  const [issuer, setIssuer] = useState(initial?.issuer ?? "");
  const [issuedAt, setIssuedAt] = useState(initial?.issued_at?.slice(0, 10) ?? "");
  const [credentialUrl, setCredentialUrl] = useState(initial?.credential_url ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const input: CertificateInput = {
        title: title.trim(),
        issuer: issuer.trim() || null,
        issued_at: issuedAt || null,
        credential_url: credentialUrl.trim() || null,
      };
      if (initial) await updateCertificate(initial.id, input);
      else await createCertificate(input);
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="st-form">
      <FormError message={error} />
      <div className="st-form-grid">
        <Field label="Certificate title">
          <input className={inputClassName()} value={title} onChange={(e) => setTitle(e.target.value)} required maxLength={300} placeholder="AI/ML Internship Certificate" />
        </Field>
        <Field label="Issuer (optional)">
          <input className={inputClassName()} value={issuer} onChange={(e) => setIssuer(e.target.value)} maxLength={200} placeholder="Infosys Springboard" />
        </Field>
        <Field label="Issued on (optional)">
          <input className={inputClassName()} type="date" value={issuedAt} onChange={(e) => setIssuedAt(e.target.value)} />
        </Field>
        <Field label="Credential URL (optional)">
          <input className={inputClassName()} type="url" value={credentialUrl} onChange={(e) => setCredentialUrl(e.target.value)} placeholder="https://…/verify/…" />
        </Field>
      </div>
      <div style={{ display: "flex", gap: 10 }}>
        <button type="submit" className="st-btn st-btn-blue" disabled={busy}>
          {busy ? "Saving…" : initial ? "Save certificate" : "Add certificate"}
        </button>
        {onCancel ? (
          <button type="button" className="st-btn st-btn-outline" onClick={onCancel}>
            Cancel
          </button>
        ) : null}
      </div>
    </form>
  );
}

// ── Experience ─────────────────────────────────────────────────────────────

export function ExperienceForm({
  initial,
  onSaved,
  onCancel,
}: {
  initial?: Experience;
  onSaved: () => void;
  onCancel?: () => void;
}) {
  const [title, setTitle] = useState(initial?.title ?? "");
  const [organization, setOrganization] = useState(initial?.organization ?? "");
  const [employmentType, setEmploymentType] = useState(initial?.employment_type ?? "internship");
  const [startDate, setStartDate] = useState(initial?.start_date?.slice(0, 10) ?? "");
  const [endDate, setEndDate] = useState(initial?.end_date?.slice(0, 10) ?? "");
  const [isCurrent, setIsCurrent] = useState(initial?.is_current ?? false);
  const [description, setDescription] = useState(initial?.description ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const input: ExperienceInput = {
        title: title.trim(),
        organization: organization.trim(),
        employment_type: employmentType,
        start_date: startDate || null,
        end_date: isCurrent ? null : endDate || null,
        is_current: isCurrent,
        description: description.trim(),
      };
      if (initial) await updateExperience(initial.id, input);
      else await createExperience(input);
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="st-form">
      <FormError message={error} />
      <div className="st-form-grid">
        <Field label="Title">
          <input className={inputClassName()} value={title} onChange={(e) => setTitle(e.target.value)} required maxLength={200} placeholder="AI/ML Intern" />
        </Field>
        <Field label="Organization">
          <input className={inputClassName()} value={organization} onChange={(e) => setOrganization(e.target.value)} required maxLength={200} placeholder="Infosys Springboard" />
        </Field>
        <Field label="Type">
          <select className="st-input st-select" value={employmentType} onChange={(e) => setEmploymentType(e.target.value)}>
            {EMPLOYMENT_TYPE_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
        </Field>
        <Field label="Started (optional)">
          <input className={inputClassName()} type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
        </Field>
        <Field label="Ended (optional)">
          <input className={inputClassName()} type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} disabled={isCurrent} />
        </Field>
        <Field label="Current role">
          <label className="st-check-row">
            <input type="checkbox" checked={isCurrent} onChange={(e) => setIsCurrent(e.target.checked)} />
            I currently work here
          </label>
        </Field>
        <Field label="What you did" full>
          <textarea className="st-input st-textarea" value={description} onChange={(e) => setDescription(e.target.value)} placeholder="What you worked on, what you shipped." maxLength={5000} />
        </Field>
      </div>
      <div style={{ display: "flex", gap: 10 }}>
        <button type="submit" className="st-btn st-btn-blue" disabled={busy}>
          {busy ? "Saving…" : initial ? "Save experience" : "Add experience"}
        </button>
        {onCancel ? (
          <button type="button" className="st-btn st-btn-outline" onClick={onCancel}>
            Cancel
          </button>
        ) : null}
      </div>
    </form>
  );
}

export { branchLabel, degreeLabel, employmentTypeLabel, platformLabel, targetRoleLabel };
