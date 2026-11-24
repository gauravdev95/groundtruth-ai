"use client";

import { useState, type FormEvent } from "react";
import Link from "next/link";
import { ArrowRight, CheckCircle2, Link2Off, ShieldCheck } from "lucide-react";
import { AuthShell } from "@/components/auth/AuthShell";
import {
  Alert,
  PasswordChecklist,
  PasswordField,
  passwordMeetsPolicy,
} from "@/components/auth/AuthForm";
import { resetPassword } from "@/lib/auth";

export default function ResetPasswordForm({ token }: { token: string }) {
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (!passwordMeetsPolicy(password)) {
      setError("Your new password doesn't meet all the requirements below yet.");
      return;
    }
    if (password !== confirmPassword) {
      setError("Passwords don't match.");
      return;
    }
    setBusy(true);
    try {
      await resetPassword(token, password);
      setDone(true);
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "Couldn't reset your password. Request a new link and try again.",
      );
    } finally {
      setBusy(false);
    }
  }

  // No token in the URL — the link is incomplete (e.g. copied halfway).
  if (!token) {
    return (
      <AuthShell side={<Link href="/auth/login" className="st-link">Sign in</Link>}>
        <div className="st-empty" style={{ boxShadow: "none", border: "none", padding: 8 }}>
          <span className="st-empty-icon" aria-hidden="true">
            <Link2Off size={22} />
          </span>
          <h2>This reset link is incomplete</h2>
          <p>
            The link is missing its reset token — it may have been copied only
            partly. Request a fresh link and open it directly from your inbox.
          </p>
          <Link href="/auth/forgot-password" className="st-btn st-btn-blue">
            Request a new link
          </Link>
        </div>
      </AuthShell>
    );
  }

  return (
    <AuthShell side={<Link href="/auth/login" className="st-link">Sign in</Link>}>
      {done ? (
        <>
          <span className="st-success-ring" aria-hidden="true">
            <CheckCircle2 size={30} />
          </span>
          <p className="st-eyebrow">Password updated</p>
          <h1 className="st-title">
            You&apos;re all <span className="blue">set</span>
          </h1>
          <p className="st-sub">
            Your password has been changed. Sign in with your new password to
            continue.
          </p>
          <div className="st-form">
            <Link href="/auth/login" className="st-btn st-btn-blue st-btn-block">
              Sign in now <ArrowRight size={17} aria-hidden="true" />
            </Link>
          </div>
        </>
      ) : (
        <>
          <span className="st-card-icon" aria-hidden="true">
            <ShieldCheck size={24} />
          </span>
          <p className="st-eyebrow">Choose a new password</p>
          <h1 className="st-title">
            Set a new <span className="blue">password</span>
          </h1>
          <p className="st-sub">
            Make it strong and unique — your old password stops working as
            soon as you save this one.
          </p>

          <form className="st-form" onSubmit={onSubmit} noValidate>
            {error ? <Alert kind="error">{error}</Alert> : null}
            <PasswordField
              id="new_password"
              name="new_password"
              label="New password"
              value={password}
              onChange={setPassword}
              autoComplete="new-password"
              placeholder="Create a strong password"
              required
            />
            <PasswordChecklist password={password} />
            <PasswordField
              id="confirm_password"
              name="confirm_password"
              label="Confirm new password"
              value={confirmPassword}
              onChange={setConfirmPassword}
              autoComplete="new-password"
              placeholder="Repeat your new password"
              error={
                confirmPassword && password !== confirmPassword
                  ? "Passwords don't match."
                  : undefined
              }
              required
            />
            <button type="submit" className="st-btn st-btn-blue st-btn-block" disabled={busy}>
              {busy ? (
                <>
                  <span className="st-spinner" aria-hidden="true" /> Saving…
                </>
              ) : (
                <>
                  Save new password <ArrowRight size={17} aria-hidden="true" />
                </>
              )}
            </button>
          </form>

          <p className="st-foot" style={{ marginTop: 22 }}>
            Link expired?{" "}
            <Link href="/auth/forgot-password">Request a new one</Link>
          </p>
        </>
      )}
    </AuthShell>
  );
}
