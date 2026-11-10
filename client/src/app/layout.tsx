import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Ground Truth AI — Hire on proof, not promises.",
  description:
    "AI-verified talent marketplace. Candidate skills backed by real evidence: GitHub, coding platforms, certificates, and code-grounded interviews.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
