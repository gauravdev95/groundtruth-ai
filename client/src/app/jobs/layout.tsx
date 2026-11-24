import type { ReactNode } from "react";
import { Plus_Jakarta_Sans, Manrope } from "next/font/google";
import "../auth/auth.css";
import "../student/student.css";

// Same Stratify fonts as the student/recruiter routes. The public job
// board shares the landing page's typography and panel styles without
// touching the homepage.
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

export default function JobsLayout({ children }: { children: ReactNode }) {
  return (
    <div className={`${jakarta.variable} ${manrope.variable}`}>
      <div className="st-student">{children}</div>
    </div>
  );
}
