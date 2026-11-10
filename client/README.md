# Ground Truth AI — client

Next.js 14 (App Router) + React 18 + TypeScript frontend.

## Pages

- `/` — landing page: hero "Hire on proof, not promises." and the evidence
  loop Verify → Interview → Match.
- `/jobs` — live jobs list fetched from the server (`/api/jobs`), with
  loading, error, and empty states.

## Develop

```bash
cp .env.example .env.local   # NEXT_PUBLIC_API_URL=http://localhost:4000
npm install
npm run dev                  # http://localhost:3000
npm run typecheck
```
