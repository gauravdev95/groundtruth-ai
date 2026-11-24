"use client";

import { useEffect, useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowRight, Building2 } from "lucide-react";
import { RequireAuth } from "@/components/auth/RequireAuth";
import { RecruiterPageHead, RecruiterShell } from "@/components/recruiter/RecruiterShell";
import {
  EMPLOYMENT_TYPE_OPTIONS,
  fetchRecruiterProfile,
  postJob,
  type EmploymentType,
  type RecruiterProfileData,
} from "@/lib/recruiter";

function PostJobForm({ profile }: { profile: RecruiterProfileData }) {
  const router = useRouter();
  const company = profile.company;
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [location, setLocation] = useState(company?.location ?? "");
  const [employmentType, setEmploymentType] = useState<EmploymentType>("full_time");
  const [salaryMin, setSalaryMin] = useState("");
  const [salaryMax, setSalaryMax] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!company) return;
    setBusy(true);
    setError(null);
    try {
      const min = salaryMin.trim() === "" ? null : Number(salaryMin);
      const max = salaryMax.trim() === "" ? null : Number(salaryMax);
      if ((min !== null && (!Number.isInteger(min) || min < 0)) ||
          (max !== null && (!Number.isInteger(max) || max < 0))) {
        throw new Error("Salaries must be whole numbers (annual, in ₹).");
      }
      if (min !== null && max !== null && max < min) {
        throw new Error("Maximum salary can't be below the minimum.");
      }
      const job = await postJob({
        company_id: company.id,
        title: title.trim(),
        description: description.trim(),
        location: location.trim() || null,
        employment_type: employmentType,
        salary_min: min,
        salary_max: max,
        salary_currency: "INR",
      });
      router.push(`/jobs/${job.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not post this role.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <RecruiterPageHead
        eyebrow="Post a job"
        title={
          <>
            Post a role at <span className="blue">{company?.name ?? "your company"}.</span>
          </>
        }
        sub="The role goes live on the public job board immediately, under your company — students can apply from the role page."
      />

      <section className="st-panel" aria-label="New job">
        <form onSubmit={onSubmit} className="st-form">
          <div className="st-form-grid">
            <label className="st-field st-field-full">
              <span className="st-label">Role title *</span>
              <input
                className="st-input"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="e.g. Backend Engineer (Python)"
                maxLength={200}
                required
              />
            </label>
            <label className="st-field st-field-full">
              <span className="st-label">Role description *</span>
              <textarea
                className="st-input st-textarea"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="What will this person build? What should they already know? What does success look like in the first 3 months?"
                required
              />
            </label>
            <label className="st-field">
              <span className="st-label">Location</span>
              <input
                className="st-input"
                value={location}
                onChange={(e) => setLocation(e.target.value)}
                placeholder="e.g. Bengaluru, India"
                maxLength={200}
              />
            </label>
            <label className="st-field">
              <span className="st-label">Job type</span>
              <select
                className="st-input st-select"
                value={employmentType}
                onChange={(e) => setEmploymentType(e.target.value as EmploymentType)}
              >
                {EMPLOYMENT_TYPE_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="st-field">
              <span className="st-label">Minimum salary (₹ / year, optional)</span>
              <input
                className="st-input"
                type="number"
                min={0}
                step={1}
                inputMode="numeric"
                value={salaryMin}
                onChange={(e) => setSalaryMin(e.target.value)}
                placeholder="e.g. 600000"
              />
            </label>
            <label className="st-field">
              <span className="st-label">Maximum salary (₹ / year, optional)</span>
              <input
                className="st-input"
                type="number"
                min={0}
                step={1}
                inputMode="numeric"
                value={salaryMax}
                onChange={(e) => setSalaryMax(e.target.value)}
                placeholder="e.g. 900000"
              />
            </label>
          </div>

          {error !== null ? (
            <p className="st-alert st-alert-error" role="alert" style={{ marginTop: 18 }}>
              {error}
            </p>
          ) : null}

          <div className="st-form-actions">
            <Link href="/recruiter/dashboard" className="st-btn st-btn-outline">
              Cancel
            </Link>
            <div className="st-actions-right">
              <button type="submit" className="st-btn st-btn-blue" disabled={busy}>
                {busy ? "Posting…" : "Post this role"}
              </button>
            </div>
          </div>
        </form>
      </section>
    </>
  );
}

function PostJobContent() {
  const [profile, setProfile] = useState<RecruiterProfileData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchRecruiterProfile()
      .then(setProfile)
      .catch((err) =>
        setError(err instanceof Error ? err.message : "Could not load your profile."),
      )
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <div className="st-loading" role="status" aria-label="Loading">
        <span className="st-spinner" aria-hidden="true" />
        <p>Loading your company…</p>
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

  if (!profile.company) {
    return (
      <>
        <RecruiterPageHead
          eyebrow="Post a job"
          title={
            <>
              Set up your company <span className="blue">before posting.</span>
            </>
          }
          sub="Jobs are posted under your company, so candidates know who they're applying to. Add your company details first — it takes a minute."
        />
        <div className="st-empty">
          <span className="st-empty-icon" aria-hidden="true">
            <Building2 size={22} />
          </span>
          <h2>No company profile yet</h2>
          <p>You need a company profile before you can post a role.</p>
          <Link href="/recruiter/profile" className="st-btn st-btn-blue st-btn-sm">
            Complete company profile <ArrowRight size={15} aria-hidden="true" />
          </Link>
        </div>
      </>
    );
  }

  return <PostJobForm profile={profile} />;
}

export default function PostJobPage() {
  return (
    <RequireAuth roles={["recruiter"]}>
      <RecruiterShell>
        <PostJobContent />
      </RecruiterShell>
    </RequireAuth>
  );
}
