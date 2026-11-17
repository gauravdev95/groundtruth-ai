"use client";

import Link from "next/link";
import { Zap } from "lucide-react";
import { useAuth } from "@/lib/auth-context";
import { dashboardPathForRole } from "@/lib/dashboard-path";

/** Minimal top nav for the public job board (same Stratify shell as the
 * student/recruiter pages, without their role guards). */
export function JobsNav() {
  const { user } = useAuth();
  return (
    <div className="st-nav-wrap">
      <nav className="st-nav" aria-label="Main">
        <Link href="/" className="st-logo">
          <span className="st-logo-mark" aria-hidden="true">
            <Zap size={16} strokeWidth={2.75} fill="currentColor" />
          </span>
          GroundTruth
        </Link>
        <div className="st-nav-side">
          <Link href="/jobs">Browse jobs</Link>
          {user ? (
            <Link href={dashboardPathForRole(user.role)}>My dashboard</Link>
          ) : (
            <>
              <Link href="/auth/login">Sign in</Link>
              <Link href="/auth/signup" className="st-btn st-btn-blue st-btn-sm">
                Create account
              </Link>
            </>
          )}
        </div>
      </nav>
    </div>
  );
}
