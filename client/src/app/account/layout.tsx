import type { ReactNode } from "react";
import { Plus_Jakarta_Sans, Manrope } from "next/font/google";
import "../auth/auth.css";

// Same Stratify fonts as the auth routes (next/font dedupes the identical
// configuration), so /account matches the auth pages exactly.
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

export default function AccountLayout({ children }: { children: ReactNode }) {
  return <div className={`${jakarta.variable} ${manrope.variable}`}>{children}</div>;
}
