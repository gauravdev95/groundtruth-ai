"use client";

import { useEffect, useState, type FormEvent } from "react";
import Link from "next/link";
import {
  AlertCircle,
  Building2,
  CheckCircle2,
  Pencil,
  UserRound,
  X,
} from "lucide-react";
import { RequireAuth } from "@/components/auth/RequireAuth";
import { RecruiterPageHead, RecruiterShell } from "@/components/recruiter/RecruiterShell";
import { initialsFor } from "@/lib/auth";
import {
  COMPANY_SIZE_OPTIONS,
  companySizeLabel,
  fetchRecruiterProfile,
  updateRecruiterProfile,
  type CompanySize,
  type RecruiterProfileData,
} from "@/lib/recruiter";

function FormError({ message }: { message: string | null }) {
  if (!message) return null;
  return (
    <div className="st-alert st-alert-error" role="alert">
      <AlertCircle size={17} aria-hidden="true" />
      <span>{message}</span>
    </div>
  );
}

function FormSuccess({ message }: { message: string | null }) {
  if (!message) return null;
  return (
    <div className="st-alert st-alert-success" role="status">
      <CheckCircle2 size={17} aria-hidden="true" />
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

function ProfileContent() {
  const [data, setData] = useState<RecruiterProfileData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editPersonal, setEditPersonal] = useState(false);
  const [editCompany, setEditCompany] = useState(false);
  const [saving, setSaving] = useState<"personal" | "company" | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);

  // Personal form state.
  const [fullName, setFullName] = useState("");
  const [jobTitle, setJobTitle] = useState("");
  const [phone, setPhone] = useState("");
  const [linkedinUrl, setLinkedinUrl] = useState("");
  // Company form state.
  const [companyName, setCompanyName] = useState("");
  const [companyWebsite, setCompanyWebsite] = useState("");
  const [companyIndustry, setCompanyIndustry] = useState("");
  const [companySize, setCompanySize] = useState<CompanySize | "">("");
  const [companyLocation, setCompanyLocation] = useState("");
  const [companyAbout, setCompanyAbout] = useState("");

  useEffect(() => {
    fetchRecruiterProfile()
      .then(setData)
      .catch((err) => setError(err instanceof Error ? err.message : "Could not load your profile."))
      .finally(() => setLoading(false));
  }, []);

  function fillPersonal(d: RecruiterProfileData) {
    setFullName(d.user.full_name);
    setJobTitle(d.profile.job_title ?? "");
    setPhone(d.profile.phone ?? "");
    setLinkedinUrl(d.profile.linkedin_url ?? "");
  }

  function fillCompany(d: RecruiterProfileData) {
    setCompanyName(d.company?.name ?? "");
    setCompanyWebsite(d.company?.website ?? "");
    setCompanyIndustry(d.company?.industry ?? "");
    setCompanySize(d.company?.size ?? "");
    setCompanyLocation(d.company?.location ?? "");
    setCompanyAbout(d.company?.description ?? "");
  }

  if (loading) {
    return (
      <div className="st-loading" role="status" aria-label="Loading">
        <span className="st-spinner" aria-hidden="true" />
        <p>Loading your profile…</p>
      </div>
    );
  }

  if (error || !data) {
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

  const { user, profile, company, completeness } = data;
  const done = completeness.percent === 100;

  async function savePersonal(e: FormEvent) {
    e.preventDefault();
    setFormError(null);
    setSaved(null);
    setSaving("personal");
    try {
      const updated = await updateRecruiterProfile({
        full_name: fullName.trim() || undefined,
        job_title: jobTitle.trim() || null,
        phone: phone.trim() || null,
        linkedin_url: linkedinUrl.trim() || null,
      });
      setData(updated);
      fillPersonal(updated);
      setEditPersonal(false);
      setSaved("Your details were saved.");
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "Could not save your details.");
    } finally {
      setSaving(null);
    }
  }

  async function saveCompany(e: FormEvent) {
    e.preventDefault();
    setFormError(null);
    setSaved(null);
    setSaving("company");
    try {
      const updated = await updateRecruiterProfile({
        company_name: companyName.trim() || null,
        company_website: companyWebsite.trim() || null,
        company_industry: companyIndustry.trim() || null,
        company_size: companySize || null,
        company_location: companyLocation.trim() || null,
        company_about: companyAbout.trim() || null,
      });
      setData(updated);
      fillCompany(updated);
      setEditCompany(false);
      setSaved("Your company profile was saved.");
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "Could not save your company profile.");
    } finally {
      setSaving(null);
    }
  }

  return (
    <>
      <RecruiterPageHead
        eyebrow="Recruiter profile"
        title={
          <>
            {user.full_name} <span className="blue">— recruiter.</span>
          </>
        }
        sub="Your details and your company profile. Candidates see the company side; your contact details stay with your account."
        actions={
          <Link href="/recruiter/dashboard" className="st-btn st-btn-outline">
            Dashboard
          </Link>
        }
      />

      <FormError message={formError} />
      <FormSuccess message={saved} />

      <div className="st-profile-head" style={{ marginBottom: 22 }}>
        <span className="st-avatar" aria-hidden="true">
          {initialsFor(user.full_name)}
        </span>
        <div>
          <p className="st-profile-name">{user.full_name}</p>
          <p className="st-profile-email">{user.email}</p>
          <span className="st-badge">Recruiter · {completeness.percent}% complete</span>
        </div>
      </div>

      <div className="st-stack">
        <Section
          title="Your details"
          desc="Who you are at the company. Your email is your account email — it cannot be changed here."
          icon={<UserRound size={20} aria-hidden="true" />}
          editing={editPersonal}
          onEdit={() => {
            if (!editPersonal) fillPersonal(data);
            setEditPersonal((v) => !v);
          }}
          editForm={
            <form onSubmit={savePersonal} style={{ marginTop: 18 }}>
              <div className="st-form-grid">
                <Field label="Full name">
                  <input
                    className="st-input"
                    value={fullName}
                    onChange={(e) => setFullName(e.target.value)}
                    required
                    minLength={2}
                    maxLength={200}
                  />
                </Field>
                <Field label="Job title">
                  <input
                    className="st-input"
                    value={jobTitle}
                    onChange={(e) => setJobTitle(e.target.value)}
                    placeholder="e.g. Talent Acquisition Lead"
                    maxLength={200}
                  />
                </Field>
                <Field label="Phone">
                  <input
                    className="st-input"
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                    placeholder="e.g. +91 98765 43210"
                    maxLength={30}
                  />
                </Field>
                <Field label="LinkedIn profile">
                  <input
                    className="st-input"
                    type="url"
                    value={linkedinUrl}
                    onChange={(e) => setLinkedinUrl(e.target.value)}
                    placeholder="https://linkedin.com/in/…"
                  />
                </Field>
              </div>
              <div className="st-form-actions">
                <span className="st-note" style={{ marginTop: 0, border: "none", background: "none", padding: 0 }}>
                  {completeness.sections.personal.detail}
                </span>
                <span className="st-actions-right">
                  <button type="button" className="st-btn st-btn-outline" onClick={() => setEditPersonal(false)}>
                    Cancel
                  </button>
                  <button type="submit" className="st-btn st-btn-blue" disabled={saving === "personal"}>
                    {saving === "personal" ? "Saving…" : "Save details"}
                  </button>
                </span>
              </div>
            </form>
          }
        >
          <div className="st-kv">
            <div className="st-kv-row">
              <span>Full name</span>
              <strong>{user.full_name}</strong>
            </div>
            <div className="st-kv-row">
              <span>Email</span>
              <strong>{user.email}</strong>
            </div>
            <div className="st-kv-row">
              <span>Job title</span>
              <strong>{profile.job_title ?? "—"}</strong>
            </div>
            <div className="st-kv-row">
              <span>Phone</span>
              <strong>{profile.phone ?? "—"}</strong>
            </div>
            <div className="st-kv-row">
              <span>LinkedIn</span>
              <strong>
                {profile.linkedin_url ? (
                  <a href={profile.linkedin_url} target="_blank" rel="noopener noreferrer">
                    View profile
                  </a>
                ) : (
                  "—"
                )}
              </strong>
            </div>
          </div>
        </Section>

        <Section
          title="Company profile"
          desc="What candidates see about your company. This is the company created when you signed up."
          icon={<Building2 size={20} aria-hidden="true" />}
          editing={editCompany}
          onEdit={() => {
            if (!editCompany) fillCompany(data);
            setEditCompany((v) => !v);
          }}
          editForm={
            <form onSubmit={saveCompany} style={{ marginTop: 18 }}>
              <div className="st-form-grid">
                <Field label="Company name" full={!company}>
                  <input
                    className="st-input"
                    value={companyName}
                    onChange={(e) => setCompanyName(e.target.value)}
                    required
                    minLength={2}
                    maxLength={200}
                    placeholder="e.g. Acme Analytics"
                  />
                </Field>
                <Field label="Website">
                  <input
                    className="st-input"
                    type="url"
                    value={companyWebsite}
                    onChange={(e) => setCompanyWebsite(e.target.value)}
                    placeholder="https://example.com"
                  />
                </Field>
                <Field label="Industry">
                  <input
                    className="st-input"
                    value={companyIndustry}
                    onChange={(e) => setCompanyIndustry(e.target.value)}
                    placeholder="e.g. Data Analytics"
                    maxLength={100}
                  />
                </Field>
                <Field label="Size">
                  <select
                    className="st-input st-select"
                    value={companySize}
                    onChange={(e) => setCompanySize(e.target.value as CompanySize | "")}
                  >
                    <option value="">Select size…</option>
                    {COMPANY_SIZE_OPTIONS.map((o) => (
                      <option key={o.value} value={o.value}>
                        {o.label}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label="Location">
                  <input
                    className="st-input"
                    value={companyLocation}
                    onChange={(e) => setCompanyLocation(e.target.value)}
                    placeholder="e.g. Bengaluru, India"
                    maxLength={200}
                  />
                </Field>
                <Field label="About the company" full>
                  <textarea
                    className="st-input st-textarea"
                    value={companyAbout}
                    onChange={(e) => setCompanyAbout(e.target.value)}
                    placeholder="What does your company do? What should candidates know?"
                    maxLength={5000}
                  />
                </Field>
              </div>
              <div className="st-form-actions">
                <span className="st-note" style={{ marginTop: 0, border: "none", background: "none", padding: 0 }}>
                  {completeness.sections.company.detail}
                </span>
                <span className="st-actions-right">
                  <button type="button" className="st-btn st-btn-outline" onClick={() => setEditCompany(false)}>
                    Cancel
                  </button>
                  <button type="submit" className="st-btn st-btn-blue" disabled={saving === "company"}>
                    {saving === "company" ? "Saving…" : "Save company profile"}
                  </button>
                </span>
              </div>
            </form>
          }
        >
          {company ? (
            <div className="st-kv">
              <div className="st-kv-row">
                <span>Company name</span>
                <strong>{company.name}</strong>
              </div>
              <div className="st-kv-row">
                <span>Website</span>
                <strong>
                  {company.website ? (
                    <a href={company.website} target="_blank" rel="noopener noreferrer">
                      {company.website.replace(/^https?:\/\//, "")}
                    </a>
                  ) : (
                    "—"
                  )}
                </strong>
              </div>
              <div className="st-kv-row">
                <span>Industry</span>
                <strong>{company.industry ?? "—"}</strong>
              </div>
              <div className="st-kv-row">
                <span>Size</span>
                <strong>{companySizeLabel(company.size)}</strong>
              </div>
              <div className="st-kv-row">
                <span>Location</span>
                <strong>{company.location ?? "—"}</strong>
              </div>
              <div className="st-kv-row">
                <span>About</span>
                <strong>{company.description ?? "—"}</strong>
              </div>
            </div>
          ) : (
            <div className="st-empty-inline">
              <span className="st-empty-icon" aria-hidden="true">
                <Building2 size={22} />
              </span>
              <h3>No company profile yet</h3>
              <p>Your account has no company linked. Use Edit to add your company name and details — saving a name creates the company profile.</p>
            </div>
          )}
        </Section>

        <section className="st-panel" aria-label="Profile completeness">
          <div className="st-panel-head">
            <div>
              <h2>Profile completeness — {completeness.percent}%</h2>
              <p className="st-panel-desc">
                {done
                  ? "Your recruiter profile is complete."
                  : "Fill in the missing fields above to reach 100%."}
              </p>
            </div>
          </div>
          <div className="st-meter" role="progressbar" aria-valuenow={completeness.percent} aria-valuemin={0} aria-valuemax={100} aria-label="Profile completeness">
            <div className="st-meter-fill" style={{ width: `${completeness.percent}%` }} />
          </div>
          <div className="st-check-list">
            <span className={`st-check-item${completeness.sections.personal.done ? " done" : " pending"}`}>
              <span>
                <strong>Your details</strong> — {completeness.sections.personal.detail}
              </span>
            </span>
            <span className={`st-check-item${completeness.sections.company.done ? " done" : " pending"}`}>
              <span>
                <strong>Company profile</strong> — {completeness.sections.company.detail}
              </span>
            </span>
          </div>
        </section>
      </div>
    </>
  );
}

export default function RecruiterProfilePage() {
  return (
    <RequireAuth roles={["recruiter"]}>
      <RecruiterShell>
        <ProfileContent />
      </RecruiterShell>
    </RequireAuth>
  );
}
