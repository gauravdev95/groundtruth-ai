"use client";

import { useEffect, type ReactNode } from "react";
import { usePathname, useRouter } from "next/navigation";
import { ShieldAlert } from "lucide-react";
import Link from "next/link";
import { useAuth } from "@/lib/auth-context";
import { roleLabel, type DbRole } from "@/lib/auth";

/**
 * Client-side route guard. While the session is loading it shows a
 * Stratify-styled loading state; unauthenticated users are sent to
 * /auth/login (with ?next= so they return here after signing in); users
 * whose role is not in `roles` get a 403-style empty state instead of the
 * page. The server enforces the same rules on every protected endpoint —
 * this guard is UX, not the security boundary.
 */
export function RequireAuth({
  roles,
  children,
}: {
  roles?: DbRole[];
  children: ReactNode;
}) {
  const { user, loading } = useAuth();
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    if (!loading && !user) {
      router.replace(`/auth/login?next=${encodeURIComponent(pathname)}`);
    }
  }, [loading, user, router, pathname]);

  if (loading) {
    return (
      <div className="st-loading" role="status" aria-label="Loading">
        <span className="st-spinner" aria-hidden="true" />
        <p>Checking your session…</p>
      </div>
    );
  }

  if (!user) return null; // Redirecting to login.

  if (roles && !roles.includes(user.role)) {
    return (
      <div className="st-empty">
        <span className="st-empty-icon" aria-hidden="true">
          <ShieldAlert size={22} />
        </span>
        <h2>You don&apos;t have access here</h2>
        <p>
          This page is for {roles.map(roleLabel).join(" or ")} accounts. You&apos;re
          signed in as a {roleLabel(user.role)}.
        </p>
        <Link href="/" className="st-btn st-btn-blue">
          Back to home
        </Link>
      </div>
    );
  }

  return <>{children}</>;
}
