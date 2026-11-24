import SignupForm from "./signup-form";
import type { SignupRole } from "@/lib/auth";

/**
 * Server component: reads the `role` query param on the server and passes
 * it down as a plain prop, so the form fully server-renders.
 */
export default function SignupPage({
  searchParams,
}: {
  searchParams?: { role?: string };
}) {
  const initialRole: SignupRole =
    searchParams?.role === "recruiter" ? "recruiter" : "student";
  return <SignupForm initialRole={initialRole} />;
}
