"use client";

import { useEffect, useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowRight, Briefcase, Check, GraduationCap, UserPlus } from "lucide-react";
import { AuthShell } from "@/components/auth/AuthShell";
import {
  Alert,
  PasswordChecklist,
  PasswordField,
  passwordMeetsPolicy,
} from "@/components/auth/AuthForm";
import { useAuth } from "@/lib/auth-context";
import { dashboardPathForRole } from "@/lib/dashboard-path";
import type { SignupRole } from "@/lib/auth";

export default function SignupForm({ initialRole }: { initialRole: SignupRole }) {
  const { signup, user } = useAuth();
  const router = useRouter();

  const [role, setRole] = useState<SignupRole>(initialRole);
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [companyName, setCompanyName] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [acceptTerms, setAcceptTerms] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (user) router.replace(dashboardPathForRole(user.role));
  }, [user, router]);

  if (user) return null;

  const passwordsMatch = password === confirmPassword;

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (!passwordMeetsPolicy(password)) {
      setError("Your password doesn't meet all the requirements below yet.");
      return;
    }
    if (role === "recruiter" && !passwordsMatch) {
      setError("Passwords don't match.");
      return;
    }
    if (!acceptTerms) {
      setError("Please accept the Terms of Service and Privacy Policy to continue.");
      return;
    }
    setBusy(true);
    try {
      const authed = await signup({
        email: email.trim(),
        password,
        full_name: fullName.trim(),
        role,
        ...(role === "recruiter" ? { company_name: companyName.trim() } : {}),
      });
      router.replace(dashboardPathForRole(authed.role));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't create your account. Try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <AuthShell
      wide
      side={
        <>
          <span className="st-nav-label">Already have an account?</span>
          <Link href="/auth/login" className="st-btn st-btn-outline st-btn-sm">
            Sign in
          </Link>
        </>
      }
    >
      <span className="st-card-icon" aria-hidden="true">
        <UserPlus size={24} />
      </span>
      <p className="st-eyebrow">Create your account</p>
      <h1 className="st-title">
        Join <span className="blue">GroundTruth</span>
      </h1>
      <p className="st-sub">
        One account for the whole marketplace — verified skills for students,
        verified talent for recruiters.
      </p>

      <form className="st-form" onSubmit={onSubmit} noValidate>
        {error ? <Alert kind="error">{error}</Alert> : null}

        <div className="st-field">
          <span className="st-label" id="role-label">
            I&apos;m joining as <span className="req" aria-hidden="true">*</span>
          </span>
          <div className="st-role-grid" role="radiogroup" aria-labelledby="role-label">
            <button
              type="button"
              role="radio"
              aria-checked={role === "student"}
              className={`st-role-tile${role === "student" ? " selected" : ""}`}
              onClick={() => setRole("student")}
            >
              {role === "student" ? (
                <span className="st-role-check" aria-hidden="true">
                  <Check size={12} strokeWidth={3.5} />
                </span>
              ) : null}
              <span className="st-role-icon" aria-hidden="true">
                <GraduationCap size={20} />
              </span>
              <strong>Student</strong>
              <span>Showcase verified skills and get hired on proof.</span>
            </button>
            <button
              type="button"
              role="radio"
              aria-checked={role === "recruiter"}
              className={`st-role-tile${role === "recruiter" ? " selected" : ""}`}
              onClick={() => setRole("recruiter")}
            >
              {role === "recruiter" ? (
                <span className="st-role-check" aria-hidden="true">
                  <Check size={12} strokeWidth={3.5} />
                </span>
              ) : null}
              <span className="st-role-icon" aria-hidden="true">
                <Briefcase size={20} />
              </span>
              <strong>Recruiter</strong>
              <span>Hire candidates whose skills are already verified.</span>
            </button>
          </div>
        </div>

        <div className="st-field">
          <label className="st-label" htmlFor="full_name">
            Full name <span className="req" aria-hidden="true">*</span>
          </label>
          <input
            id="full_name"
            name="full_name"
            type="text"
            autoComplete="name"
            placeholder="Gaurav Yadav"
            value={fullName}
            onChange={(e) => setFullName(e.target.value)}
            required
            minLength={2}
            className="st-input"
          />
        </div>

        <div className="st-field">
          <label className="st-label" htmlFor="email">
            Email <span className="req" aria-hidden="true">*</span>
          </label>
          <input
            id="email"
            name="email"
            type="email"
            autoComplete="email"
            placeholder="you@example.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            className="st-input"
          />
        </div>

        {role === "recruiter" ? (
          <div className="st-field">
            <label className="st-label" htmlFor="company_name">
              Company name <span className="req" aria-hidden="true">*</span>
            </label>
            <input
              id="company_name"
              name="company_name"
              type="text"
              autoComplete="organization"
              placeholder="Acme Technologies"
              value={companyName}
              onChange={(e) => setCompanyName(e.target.value)}
              required
              minLength={2}
              className="st-input"
            />
            <span className="st-hint">
              Your company profile is created with your account.
            </span>
          </div>
        ) : null}

        <PasswordField
          id="password"
          name="password"
          label="Password"
          value={password}
          onChange={setPassword}
          autoComplete="new-password"
          placeholder="Create a strong password"
          required
        />
        <PasswordChecklist password={password} />

        {role === "recruiter" ? (
          <PasswordField
            id="confirm_password"
            name="confirm_password"
            label="Confirm password"
            value={confirmPassword}
            onChange={setConfirmPassword}
            autoComplete="new-password"
            placeholder="Repeat your password"
            error={
              confirmPassword && !passwordsMatch ? "Passwords don't match." : undefined
            }
            required
          />
        ) : null}

        <label className="st-check-row">
          <input
            type="checkbox"
            checked={acceptTerms}
            onChange={(e) => setAcceptTerms(e.target.checked)}
          />
          <span>
            I agree to GroundTruth AI&apos;s Terms of Service and Privacy Policy.
          </span>
        </label>

        <button type="submit" className="st-btn st-btn-blue st-btn-block" disabled={busy}>
          {busy ? (
            <>
              <span className="st-spinner" aria-hidden="true" /> Creating your account…
            </>
          ) : (
            <>
              Create my account <ArrowRight size={17} aria-hidden="true" />
            </>
          )}
        </button>
      </form>

      <p className="st-foot" style={{ marginTop: 22 }}>
        Already have an account? <Link href="/auth/login">Sign in</Link>
      </p>
    </AuthShell>
  );
}
