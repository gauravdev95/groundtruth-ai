"use client";

import { useState, type FormEvent } from "react";
import Link from "next/link";
import { ArrowLeft, ArrowRight, CheckCircle2, KeyRound, MailCheck } from "lucide-react";
import { AuthShell } from "@/components/auth/AuthShell";
import { Alert } from "@/components/auth/AuthForm";
import { requestPasswordReset } from "@/lib/auth";

/**
 * Forgot password. The server always answers with the same generic message
 * (it never reveals whether the email exists). In development the server
 * also returns the reset link, because no mail sender is configured yet —
 * it is shown here in a clearly labelled dev-only box, never in production.
 */
export default function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<{ message: string; resetUrl?: string } | null>(null);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const res = await requestPasswordReset(email.trim());
      setDone(res);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong. Try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <AuthShell
      side={
        <Link href="/auth/login" className="st-btn st-btn-outline st-btn-sm">
          <ArrowLeft size={15} aria-hidden="true" /> Back to sign in
        </Link>
      }
    >
      {done ? (
        <>
          <span className="st-success-ring" aria-hidden="true">
            <CheckCircle2 size={30} />
          </span>
          <p className="st-eyebrow">Check your inbox</p>
          <h1 className="st-title">Reset link on its way</h1>
          <p className="st-sub">{done.message}</p>
          <div className="st-form">
            <Alert kind="info">
              <span>
                The link expires in 30 minutes and works once. Didn&apos;t get
                it? Check spam, then request a new one.
              </span>
            </Alert>
            {done.resetUrl ? (
              <div className="st-dev-box">
                <strong>Development only — email isn&apos;t wired up yet.</strong>
                <br />
                Your reset link (this box never appears in production):{" "}
                <a href={done.resetUrl} className="st-link">
                  {done.resetUrl}
                </a>
              </div>
            ) : null}
            <Link href="/auth/login" className="st-btn st-btn-blue st-btn-block">
              Back to sign in
            </Link>
            <button
              type="button"
              className="st-btn st-btn-outline st-btn-block"
              onClick={() => setDone(null)}
            >
              Try a different email
            </button>
          </div>
        </>
      ) : (
        <>
          <span className="st-card-icon" aria-hidden="true">
            <KeyRound size={24} />
          </span>
          <p className="st-eyebrow">Reset your password</p>
          <h1 className="st-title">
            Forgot your <span className="blue">password?</span>
          </h1>
          <p className="st-sub">
            Enter the email you signed up with and we&apos;ll send you a link to
            set a new password.
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
            <button type="submit" className="st-btn st-btn-blue st-btn-block" disabled={busy}>
              {busy ? (
                <>
                  <span className="st-spinner" aria-hidden="true" /> Sending…
                </>
              ) : (
                <>
                  <MailCheck size={17} aria-hidden="true" /> Send reset link
                </>
              )}
            </button>
          </form>

          <p className="st-foot" style={{ marginTop: 22 }}>
            Remembered it? <Link href="/auth/login">Sign in</Link>
          </p>
        </>
      )}
    </AuthShell>
  );
}
