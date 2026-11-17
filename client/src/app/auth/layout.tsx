import type { ReactNode } from "react";
import { Plus_Jakarta_Sans, Manrope } from "next/font/google";
import "./auth.css";

// Stratify fonts, scoped to the auth routes via CSS variables consumed by
// auth.css. Loaded here (not in the root layout) so the homepage keeps its
// own typography untouched.
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

export default function AuthLayout({ children }: { children: ReactNode }) {
  return <div className={`${jakarta.variable} ${manrope.variable}`}>{children}</div>;
}
