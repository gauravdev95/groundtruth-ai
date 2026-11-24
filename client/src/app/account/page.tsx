"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowRight, BadgeCheck, LogOut, Search } from "lucide-react";
import { AuthShell } from "@/components/auth/AuthShell";
import { RequireAuth } from "@/components/auth/RequireAuth";
import { initialsFor, roleLabel } from "@/lib/auth";
import { useAuth } from "@/lib/auth-context";

function AccountContent() {
  const { user, logout } = useAuth();
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  if (!user) return null;

  const firstName = user.full_name.trim().split(/\s+/)[0] ?? "there";
  const isStudent = user.role === "candidate";

  async function onLogout() {
    setBusy(true);
    await logout();
    router.replace("/auth/login");
  }

  return (
    <AuthShell
      side={
        <button
          type="button"
          className="st-btn st-btn-outline st-btn-sm"
          onClick={onLogout}
          disabled={busy}
        >
          <LogOut size={15} aria-hidden="true" /> Log out
        </button>
      }
    >
      <p className="st-eyebrow">Your account</p>
      <h1 className="st-title">
        Welcome back, <span className="blue">{firstName}</span>
      </h1>
      <p className="st-sub">
        You&apos;re signed in. Your verified profile and open roles live here —
        dashboards arrive in the next phase.
      </p>

      <div className="st-profile">
        <span className="st-avatar" aria-hidden="true">
          {initialsFor(user.full_name)}
        </span>
        <div>
          <p className="st-profile-name">{user.full_name}</p>
          <p className="st-profile-email">{user.email}</p>
          <span className="st-badge">
            <BadgeCheck size={13} aria-hidden="true" /> {roleLabel(user.role)}
          </span>
        </div>
      </div>

      <div className="st-kv" style={{ marginTop: 18 }}>
        <div className="st-kv-row">
          <span>Account type</span>
          <strong>{roleLabel(user.role)}</strong>
        </div>
        <div className="st-kv-row">
          <span>Email</span>
          <strong style={{ wordBreak: "break-all" }}>{user.email}</strong>
        </div>
        <div className="st-kv-row">
          <span>Session</span>
          <strong>Signed in</strong>
        </div>
      </div>

      <div className="st-form" style={{ marginTop: 24 }}>
        <Link
          href={isStudent ? "/student/dashboard" : "/jobs"}
          className="st-btn st-btn-blue st-btn-block"
        >
          <Search size={17} aria-hidden="true" />{" "}
          {isStudent ? "Go to my student dashboard" : "Browse open roles"}
          <ArrowRight size={17} aria-hidden="true" />
        </Link>
        <p className="st-hint" style={{ textAlign: "center" }}>
          {isStudent
            ? "Your student dashboard — profile completeness, applications, matches and open roles — lives there."
            : "Your recruiter dashboard — job posting and candidate review — arrives in a later phase."}
        </p>
      </div>

      <div className="st-form" style={{ marginTop: 8 }}>
        <Link
          href="/account/notifications"
          className="st-btn st-btn-outline st-btn-block"
        >
          Notifications
          <ArrowRight size={17} aria-hidden="true" />
        </Link>
      </div>

      <div style={{ marginTop: 24, textAlign: "center" }}>
        <p className="st-hint">
          <Link href="/terms">Terms of Service</Link>
          {" · "}
          <Link href="/privacy">Privacy Policy</Link>
          {" · "}
          <Link href="/dpdp">DPDP &amp; Data Rights</Link>
          {" · "}
          <Link href="/bias-audit">Bias Audit</Link>
          {" · "}
          <Link href="/contact">Contact</Link>
        </p>
      </div>
    </AuthShell>
  );
}

export default function AccountPage() {
  return (
    <RequireAuth>
      <AccountContent />
    </RequireAuth>
  );
}
