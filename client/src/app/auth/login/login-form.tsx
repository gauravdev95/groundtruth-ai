"use client";

import { useEffect, useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowRight, LogIn } from "lucide-react";
import { AuthShell } from "@/components/auth/AuthShell";
import { Alert, PasswordField } from "@/components/auth/AuthForm";
import { useAuth } from "@/lib/auth-context";
import { dashboardPathForRole } from "@/lib/dashboard-path";

export default function LoginForm({ next }: { next?: string }) {
  const { login, user } = useAuth();
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Already signed in (e.g. came back to /auth/login) — go where you belong.
  useEffect(() => {
    if (user) router.replace(dashboardPathForRole(user.role));
  }, [user, router]);

  if (user) return null;

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const authed = await login(email.trim(), password);
      const dest =
        next && next.startsWith("/") && !next.startsWith("//")
          ? next
          : dashboardPathForRole(authed.role);
      router.replace(dest);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't sign you in. Try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <AuthShell
      side={
        <>
          <span className="st-nav-label">New to GroundTruth?</span>
          <Link href="/auth/signup" className="st-btn st-btn-blue st-btn-sm">
            Sign up
          </Link>
        </>
      }
    >
      <span className="st-card-icon" aria-hidden="true">
        <LogIn size={24} />
      </span>
      <p className="st-eyebrow">Welcome back</p>
      <h1 className="st-title">
        Sign in to <span className="blue">GroundTruth</span>
      </h1>
      <p className="st-sub">
        Pick up where you left off — your verified profile and open roles are
        waiting.
      </p>

      <form className="st-form" onSubmit={onSubmit} noValidate>
        {error ? <Alert kind="error">{error}</Alert> : null}

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

        <PasswordField
          id="password"
          name="password"
          label="Password"
          value={password}
          onChange={setPassword}
          autoComplete="current-password"
          placeholder="Your password"
          required
        />

        <div className="st-row-between" style={{ justifyContent: "flex-end" }}>
          <Link href="/auth/forgot-password" className="st-link">
            Forgot password?
          </Link>
        </div>

        <button type="submit" className="st-btn st-btn-blue st-btn-block" disabled={busy}>
          {busy ? (
            <>
              <span className="st-spinner" aria-hidden="true" /> Signing you in…
            </>
          ) : (
            <>
              Sign in <ArrowRight size={17} aria-hidden="true" />
            </>
          )}
        </button>
      </form>

      <div className="st-divider">New here?</div>
      <p className="st-foot" style={{ marginTop: 14 }}>
        <Link href="/auth/signup">Create a free account</Link> — as a student or
        a recruiter.
      </p>
    </AuthShell>
  );
}
