import type { ReactNode } from "react";
import { Plus_Jakarta_Sans, Manrope } from "next/font/google";
import "../auth/auth.css";
import "../student/student.css";
import "./recruiter.css";

// Same Stratify fonts as the student routes. Loaded here so the recruiter
// pages share the landing page's typography without touching the homepage.
// Shared panels/grids/buttons come from student.css; recruiter.css only
// adds the .st-recruiter page base.

const jakarta = Plus_Jakarta_Sans({
  subsets: ["latin"],
  weight: ["500", "600", "700", "800"],
  variable: "--font-jakarta",
  display: "swap",
});

const manrope = Manrope({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700", "800"],
  variable: "--font-manrope",
  display: "swap",
});

export default function RecruiterLayout({ children }: { children: ReactNode }) {
  return <div className={`${jakarta.variable} ${manrope.variable}`}>{children}</div>;
}
