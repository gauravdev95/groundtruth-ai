// Single source of truth for the server base URL.
//
// NEXT_PUBLIC_API_URL is inlined into the client bundle AT BUILD TIME. If
// it is not set when the client is built, the fallback below bakes
// http://localhost:4000 into the bundle — which works on a developer's own
// machine but silently breaks every deployed copy (the user's browser
// would call its own localhost). That is exactly what happened to the live
// Render client (verified 23 Nov 2026: the production JS chunks contain
// "localhost:4000" and no groundtruth-ai-server URL). Production builds
// MUST set NEXT_PUBLIC_API_URL=https://groundtruth-ai-server.onrender.com
// (see docs/DEPLOYMENT.md); this module also warns loudly in the browser
// console when a non-local page is talking to a localhost API, so a
// misconfigured deploy is visible instead of silently broken.

export const API_URL: string =
  process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";

/** Warn once (browser only) if a deployed page is calling a localhost API. */
export function warnIfApiMisconfigured(): void {
  if (typeof window === "undefined") return;
  const host = window.location.hostname;
  const isLocalHost = host === "localhost" || host === "127.0.0.1" || host === "[::1]";
  if (!isLocalHost && /^(https?:\/\/)?(localhost|127\.0\.0\.1)(:\d+)?$/i.test(API_URL)) {
    console.error(
      "[GroundTruth config] NEXT_PUBLIC_API_URL is not set for this deploy: " +
        "the app is calling localhost:4000 from a non-local host, so sign-in " +
        "and jobs will fail. Set NEXT_PUBLIC_API_URL to the production " +
        "server URL (https://groundtruth-ai-server.onrender.com) and rebuild.",
    );
  }
}
