import ResetPasswordForm from "./reset-form";

/**
 * Server component: reads the `token` query param on the server and passes
 * it down as a plain prop, so the page fully server-renders.
 */
export default function ResetPasswordPage({
  searchParams,
}: {
  searchParams?: { token?: string };
}) {
  return <ResetPasswordForm token={searchParams?.token ?? ""} />;
}
