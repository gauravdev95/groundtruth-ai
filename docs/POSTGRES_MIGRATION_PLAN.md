# PostgreSQL persistence — backup, restore & migration plan

**Date of this plan:** 23 November 2026
**Status:** plan + local rehearsal complete; production migration NOT started.

## ⏰ CRITICAL deadline — 15 December 2026 (VERIFY in the dashboard)

The production database is Render free-tier PostgreSQL (`groundtruth-postgres`).
**It expires on 15 December 2026** (per earlier notes, the data is deleted
around 29 December 2026 — the exact deletion date is unverified; treat
15 December as the hard deadline). If no migration happens before then,
all production data — users, jobs, applications, embeddings — is lost.

Policy verified 23 Nov 2026 against Render's official docs
(render.com/docs/free): **"Free Render Postgres databases expire 30 days
after creation. An expired Free database is inaccessible unless you upgrade
it to a paid compute plan. After a Free database expires, you have a grace
period of 14 days to upgrade it to a paid compute plan. After the grace
period, Render deletes the database (along with all of its data)."**
(Older third-party write-ups still quote a 90-day limit — that was Render's
former policy; the current official figure is 30 days.) The 15 Dec date in
this plan assumes creation ~15 Nov 2026; **confirm the exact creation /
expiry date in the Render dashboard** (dashboard → groundtruth-postgres →
overview) — if creation was 18 Nov, expiry is 18 Dec instead. Either way
the 30 Nov decision deadline below stands. Free Postgres also has **no
backups and no managed connection pooling** (same docs page), which is why
§3 uses `pg_dump` and the server uses its own pool.

**Dated milestones (all 2026):**

| By | Milestone |
|----|-----------|
| 30 Nov | Gaurav decides: in-place Render upgrade (Option A) vs new provider (Option B). Payment decision unblocks Option A. |
| 8 Dec | Production backup taken (`pg_dump`, §3) and stored in two places. Production size measured for the first time. |
| 10 Dec | Restore rehearsal against the REAL production backup into a scratch database; verification checklist (§5) fully green. |
| 12 Dec | Cutover (§6) in a low-traffic window; smoke tests pass; old DB kept running untouched. |
| 15 Dec | Deadline. Old free database expires. |

## 1. Current state (what is verified, what is not)

- **Production DB (Render, `groundtruth-postgres`):** free tier, PostgreSQL +
  pgvector. **Size: UNKNOWN — never measured.** The agent has no Render
  credentials and cannot connect to it; the size is measured for the first
  time when the backup in §3 is taken. Do not quote a production size until
  then.
- **Local mirror DBs:** 10–15 MB each (17 local databases measured
  23 Nov 2026). Production is expected to be the same order of magnitude
  (seed + test + early real data), but that is an expectation, not a fact.
- **Extensions required:** `plpgsql` + `pgvector` **0.8.7** (verified in the
  local DB). Any replacement database MUST support pgvector — that is the
  hard constraint. Render Postgres supports it; so do Neon, Supabase,
  Aiven and self-hosted Postgres with the extension installed.
- **Embedding dimension:** 1536 (`text-embedding-3-small`). A restored DB
  must preserve this (verified in rehearsal, §2).

## 2. Rehearsal (done locally, 23 Nov 2026 — evidence, not production)

Backup + restore was rehearsed end-to-end on the local API test database:

```bash
pg_dump -h <socket> -U postgres -Fc \
  -f backup-rehearsal/gt_p2_api-2026-11-23.dump gt_p2_api
# dump: 151,685 bytes, exit 0
pg_restore -h <socket> -U postgres -d gt_p10_restore \
  backup-rehearsal/gt_p2_api-2026-11-23.dump
# exit 0
```

Verification — source vs restored, identical on every count:

| Check | gt_p2_api (source) | gt_p10_restore (restored) |
|---|---|---|
| tables | 46 | 46 |
| indexes | 130 | 130 |
| users | 6 | 6 |
| jobs | 4 | 4 |
| applications | 2 | 2 |
| embeddings | 2 | 2 |
| extensions | plpgsql, vector | plpgsql, vector |
| embedding dims | 1536 | 1536 |
| user emails | 6 identical rows | identical |

The rehearsal dump (`~/workspace/groundtruth-all-steps/backup-rehearsal/gt_p2_api-2026-11-23.dump`)
is a **local test-database backup, NOT a production backup**. It proves the
procedure works; it contains no production data.

**Rehearsal repeated 23 Nov 2026 (ultimate mission, Phase 15)** on the
current local API database (`gt_p2_api`, now 58 users / 13 jobs / 9
applications / 24 embeddings after all test phases): fresh `pg_dump -Fc`
(568,523 bytes), restored into `gt_ult_restore`, exit 0 — every check
identical to the source: 46 tables, 130 indexes, 58 users, 13 jobs,
9 applications, 24 embeddings, extensions plpgsql 1.0 + vector 0.8.7,
embedding dims 1536, `users.role` text, `idx_certificates_candidate` = 1.
Local DB size 14 MB (`pg_database_size`).

## 3. Backup (production — needs Render access)

The agent cannot run this: the production `DATABASE_URL` lives in the
Render dashboard. Gaurav (or someone with Render access) runs it from any
machine that can reach Render's Postgres host.

```bash
# 1. In the Render dashboard: groundtruth-postgres -> "External Database URL"
#    (starts with postgres://...@...render.com/...). Copy it; never paste it
#    into chat, a doc, or the repo.
# 2. Take the backup (custom format: compressed, single file, restorable):
pg_dump "$RENDER_EXTERNAL_DATABASE_URL" -Fc \
  -f groundtruth-prod-2026-12-08.dump

# 3. Record the size + a checksum, and keep TWO copies (local disk + Drive):
ls -la groundtruth-prod-*.dump
sha256sum groundtruth-prod-*.dump
pg_dump "$RENDER_EXTERNAL_DATABASE_URL" -Fc \
  -f groundtruth-prod-2026-12-08-copy2.dump   # second copy, different disk
```

Also take a plain-SQL backup as a belt-and-braces second format
(readable, restorable with `psql` if `pg_restore` ever fails):

```bash
pg_dump "$RENDER_EXTERNAL_DATABASE_URL" -Fp \
  -f groundtruth-prod-2026-12-08.sql
```

**Never** run `pg_dump` with `--clean`/`--if-exists` against the
production database, and never point a restore at the production database
until §5 is green on a scratch database.

## 4. Options for the persistent database (decision needed by 30 Nov 2026)

| Option | What it is | Cost / note | Status |
|---|---|---|---|
| **A — Render Postgres Starter (in-place upgrade)** | Same provider, same region; upgrade the existing `groundtruth-postgres` service to the paid Starter plan. Data stays where it is; no dump/restore needed (Render handles the upgrade). | ~$6–7/month (per earlier notes — verify the current price in the Render dashboard at upgrade time). | **BLOCKED on Gaurav's payment decision.** |
| **B — New managed Postgres** (Neon / Supabase / Aiven / other) | Create a new database, restore the §3 backup into it, point the server at it (§6). | Price varies by provider; free tiers exist but check the pgvector + size limits first. | Needs Gaurav's provider choice. |

If Option A is chosen, §§3–5 are still done as a safety backup, but §6
becomes "upgrade in the dashboard, verify, done" — no cutover. If Option B
is chosen, follow §§3–6 in full.

## 5. Restore + verification checklist (run on a SCRATCH database first)

```bash
# 1. Create an empty scratch database on the NEW provider (or locally):
createdb groundtruth_restore_check
# 2. Restore the production backup into it:
pg_restore -d "$NEW_DATABASE_URL" groundtruth-prod-2026-12-08.dump
#    (If using the plain-SQL backup: psql "$NEW_DATABASE_URL" -f groundtruth-prod-2026-12-08.sql)
# 3. Run the migrations against the restored database (idempotent):
cd server && DATABASE_URL="$NEW_DATABASE_URL" npm run migrate
```

Verification — every line must match the production backup's own counts
(measure the source counts first with the queries below run against the
production backup's restored copy, or against the live DB read-only):

```sql
SELECT count(*) FROM information_schema.tables WHERE table_schema='public';
SELECT count(*) FROM pg_indexes WHERE schemaname='public';
SELECT count(*) FROM users;
SELECT count(*) FROM jobs;
SELECT count(*) FROM applications;
SELECT count(*) FROM embeddings;
SELECT extname, extversion FROM pg_extension ORDER BY 1;  -- must include vector 0.8.7
SELECT vector_dims(embedding) FROM embeddings LIMIT 1;    -- must be 1536
SELECT data_type FROM information_schema.columns
  WHERE table_name='users' AND column_name='role';         -- must be text
SELECT count(*) FROM pg_indexes WHERE indexname='idx_certificates_candidate';  -- must be 1
```

Also verify connectivity from the server's point of view before cutover:
point a local server at the new `DATABASE_URL` and run the health check
(`/health` → postgres ok) plus the 51-check API flow (`/tmp/gt_p2.py`
equivalent against the new DB — re-run on a fresh copy, never on the
production backup itself).

**Do not proceed to §6 until every checklist line is green.**

## 6. Cutover (Option B only; low-traffic window)

1. Announce a maintenance window (the app will be briefly unavailable).
2. Take a FINAL backup (§3) immediately before cutover — restores must
   include the latest rows.
3. Restore the final backup into the new database; run §5 against it.
4. In the Render dashboard, set `DATABASE_URL` on `groundtruth-ai-server`
   to the new database URL. Redeploy the server.
5. Run `npm run migrate` against the new database (idempotent; no-op if
   the backup was already migrated).
6. Smoke tests (all must pass): `/health` → postgres ok; `/api/jobs` →
   200 with rows; login → 200; `/api/auth/me` → 200; create a test job
   as the recruiter demo account, apply as the student demo account,
   then delete the test rows.
7. Monitor the server logs for 30 minutes (no 500s, no connection errors).
8. **Keep the old free database untouched for at least 7 days after a
   green cutover.** It is the rollback: flip `DATABASE_URL` back and
   redeploy.

## 7. Rollback

- If any §5 check fails or the §6 smoke tests fail: stop, flip
  `DATABASE_URL` back to the old database, redeploy, and diagnose from
  the scratch copy. The old database is never written to during the
  migration, so it stays a valid fallback.
- **NEVER delete the old database before (a) the restore verification
  (§5) is fully green on the real production backup, (b) the cutover
  (§6) smoke tests pass, and (c) Gaurav explicitly approves the
  deletion in plain words.** No agent, script, or checklist step in
  this plan deletes a database.

## 8. After the migration

- Update `docs/DEPLOYMENT.md` with the new `DATABASE_URL` location and
  the backup schedule (weekly `pg_dump`, two copies, retained 4 weeks).
- Set a calendar reminder: first post-migration backup 7 days after
  cutover; then weekly.
- Close this plan's deadline item only after §5 + §6 are done and the
  old database's deletion (if any) is explicitly approved.
