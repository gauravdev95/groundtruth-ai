import Link from "next/link";
import type { ReactNode } from "react";
import { Zap } from "lucide-react";

/**
 * Premium Stratify shell for every auth page: the landing page's blurred
 * nav bar, gradient backdrop with soft blue blobs, and a centered white
 * card. `side` is the small link shown at the right of the nav
 * (e.g. "New here? Sign up").
 */
export function AuthShell({
  side,
  wide,
  children,
}: {
  side: ReactNode;
  wide?: boolean;
  children: ReactNode;
}) {
  return (
    <div className="st-auth">
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
          <div className="st-nav-side">{side}</div>
        </nav>
      </div>
      <main className="st-main">
        <div className={`st-card${wide ? " st-card-wide" : ""}`}>{children}</div>
        <p className="st-foot">
          Hire on proof, not promises. Your skills, backed by evidence.
        </p>
      </main>
    </div>
  );
}
