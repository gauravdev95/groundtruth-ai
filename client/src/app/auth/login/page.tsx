import LoginForm from "./login-form";

/**
 * Server component: reads the `next` query param on the server and passes
 * it down as a plain prop, so the form fully server-renders (no
 * useSearchParams + Suspense hole that would leave the page empty until
 * hydration).
 */
export default function LoginPage({
  searchParams,
}: {
  searchParams?: { next?: string };
}) {
  return <LoginForm next={searchParams?.next} />;
}
