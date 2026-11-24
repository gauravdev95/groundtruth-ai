import type { ReactNode } from "react";
import Link from "next/link";
import { Zap } from "lucide-react";

const LINKS = [
  { href: "/terms", label: "Terms of Service" },
  { href: "/privacy", label: "Privacy Policy" },
  { href: "/dpdp", label: "DPDP & Data Rights" },
  { href: "/bias-audit", label: "Bias Audit" },
  { href: "/contact", label: "Contact" },
];

/**
 * Shared shell for the Phase 7 legal + contact pages: light Stratify
 * design, top nav linking the four legal pages, and a footer note.
 * `current` marks the active page in the nav.
 */
export function LegalShell({
  eyebrow,
  title,
  updated,
  current,
  children,
}: {
  eyebrow: string;
  title: string;
  updated: string;
  current: string;
  children: ReactNode;
}) {
  return (
    <div className="legal-page">
      <header className="legal-nav">
        <div className="legal-nav-inner">
          <Link href="/" className="legal-logo">
            <span className="legal-logo-mark" aria-hidden="true">
              <Zap size={14} strokeWidth={2.75} fill="currentColor" />
            </span>
            GroundTruth
          </Link>
          <nav className="legal-nav-links" aria-label="Legal">
            {LINKS.map((l) => (
              <Link
                key={l.href}
                href={l.href}
                aria-current={l.href === current ? "page" : undefined}
              >
                {l.label}
              </Link>
            ))}
          </nav>
        </div>
      </header>
      <main className="legal-main">
        <article className="legal-card">
          <p className="legal-eyebrow">{eyebrow}</p>
          <h1>{title}</h1>
          <p className="legal-updated">{updated}</p>
          {children}
        </article>
        <p className="legal-foot">
          GroundTruth AI — hire on proof, not promises. Questions?{" "}
          <Link href="/contact">Contact us</Link>.
        </p>
      </main>
    </div>
  );
}
