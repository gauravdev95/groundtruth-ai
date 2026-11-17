# Ground Truth AI — client

Next.js 14 (App Router) + React 18 + TypeScript frontend.

## Pages

- `/` — landing page: hero "Hire on proof, not promises." and the evidence
  loop Verify → Interview → Match.
- `/jobs` — live jobs list fetched from the server (`/api/jobs`), with
  loading, error, and empty states.
- `/auth/login`, `/auth/signup` (student/recruiter role choice),
  `/auth/forgot-password`, `/auth/reset-password` — auth pages in the
  Stratify design system (light theme, `#1E2BDA`, Plus Jakarta Sans +
  Manrope; see `src/app/auth/auth.css`).
- `/account` — protected profile page (redirects to login when signed out);
  role dashboards (`/student/dashboard`, `/recruiter/dashboard`) land in
  Phase 2 — see `src/lib/dashboard-path.ts`.

## Develop

```bash
cp .env.example .env.local   # NEXT_PUBLIC_API_URL=http://localhost:4000
npm install
npm run dev                  # http://localhost:3000
npm run typecheck
```
