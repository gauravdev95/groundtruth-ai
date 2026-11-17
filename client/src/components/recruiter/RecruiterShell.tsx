import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useState, type ReactNode } from "react";
import { LogOut, Zap } from "lucide-react";
import { initialsFor } from "@/lib/auth";
import { useAuth } from "@/lib/auth-context";

/**
 * Recruiter shell: the landing page's blurred nav bar over the Stratify
 * gradient, with Dashboard / Profile links and the signed-in recruiter's
 * chip. Mirrors the student shell (components/student/StudentShell.tsx);
 * shared panel/grid/button classes come from student.css, imported by
 * the recruiter layout.
 */
export function RecruiterShell({ children }: { children: ReactNode }) {
  const { user, logout } = useAuth();
  const router = useRouter();
  const pathname = usePathname();
  const [busy, setBusy] = useState(false);

  async function onLogout() {
    setBusy(true);
    await logout();
    router.replace("/auth/login");
  }

  const linkClass = (href: string, exact = false) => {
    const active = exact ? pathname === href : pathname.startsWith(href);
    return active ? "st-link" : undefined;
  };

  return (
    <div className="st-recruiter">
      <span className="st-blob st-blob-a" aria-hidden="true" />
      <span className="st-blob st-blob-b" aria-hidden="true" />
      <div className="st-nav-wrap">
        <nav className="st-nav" aria-label="Main">
          <Link href="/" className="st-logo">
            <span className="st-logo-mark" aria-hidden="true">
              <Zap size={16} strokeWidth={2.75} fill="currentColor" />
            </span>
            GroundTruth
          </Link>
          <div className="st-nav-side">
            <Link href="/recruiter/dashboard" className={linkClass("/recruiter/dashboard", true)}>
              Dashboard
            </Link>
            <Link href="/recruiter/profile" className={linkClass("/recruiter/profile")}>
              Profile
            </Link>
            <Link href="/jobs" className={linkClass("/jobs")}>
              Jobs
            </Link>
            {user ? (
              <span className="st-user-chip">
                <span className="st-user-meta">
                  <span className="st-user-name">{user.full_name}</span>
                  <br />
                  <span className="st-user-role">Recruiter</span>
                </span>
                <span className="st-avatar" aria-hidden="true">
                  {initialsFor(user.full_name)}
                </span>
                <button
                  type="button"
                  className="st-btn st-btn-outline st-btn-sm"
                  onClick={onLogout}
                  disabled={busy}
                >
                  <LogOut size={15} aria-hidden="true" /> Log out
                </button>
              </span>
            ) : null}
          </div>
        </nav>
      </div>
      <main className="st-page">{children}</main>
    </div>
  );
}

export function RecruiterPageHead({
  eyebrow,
  title,
  sub,
  actions,
}: {
  eyebrow: string;
  title: ReactNode;
  sub?: string;
  actions?: ReactNode;
}) {
  return (
    <div className="st-page-head">
      <div>
        <p className="st-eyebrow">{eyebrow}</p>
        <h1 className="st-page-title">{title}</h1>
        {sub ? <p className="st-page-sub">{sub}</p> : null}
      </div>
      {actions ? <div style={{ display: "flex", gap: 10 }}>{actions}</div> : null}
    </div>
  );
}
