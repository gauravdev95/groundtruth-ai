# groundtruth-assessment-demo

A small, self-contained demo project for integration-testing the
GroundTruth AI assessment system. It is a tiny auth API written in
**Python 3.12, standard library only — no pip dependencies** — so it
runs with plain `python3`.

It is intentionally imperfect: it contains **one real bug** and **one
missing feature** (below) for the assessment system to detect and for
a candidate/agent to fix.

## Purpose

Give the assessment system a realistic, runnable codebase to:

1. run the existing test suite and report pass/fail,
2. detect the intentional bug via the failing test,
3. detect the missing feature by reading the code / README,
4. fix both, and add tests proving the fixes.

## Structure

```text
groundtruth-assessment-demo/
  README.md
  .gitignore
  backend/
    __init__.py
    app/
      __init__.py
      main.py          # HTTP API: POST /register, POST /login, GET /me
      auth.py          # PBKDF2 password hashing, HMAC tokens
      rate_limiter.py  # sliding-window rate limiter (contains bug #1)
    services/
      __init__.py
      users.py         # in-memory user store + JSON-file persistence
  tests/
    __init__.py
    test_auth.py           # register/login, tokens, wrong password, persistence
    test_rate_limiter.py   # under/over limit, per-IP isolation, window expiry
```

## How to run

From this directory (`groundtruth-assessment-demo/`):

```bash
# Run the test suite
python3 -m unittest discover -s tests -v

# Serve the API (http://127.0.0.1:8000)
python3 -m backend.app.main
```

Example requests (server running):

```bash
curl -s -X POST localhost:8000/register \
  -H 'Content-Type: application/json' \
  -d '{"username": "alice", "password": "password123"}'

curl -s -X POST localhost:8000/login \
  -H 'Content-Type: application/json' \
  -d '{"username": "alice", "password": "password123"}'
# -> {"token": "<token>"}

curl -s localhost:8000/me -H 'Authorization: Bearer <token>'
curl -s localhost:8000/me -H 'Authorization: Bearer bad-token'
# -> 401 {"error": "invalid or missing token"}
```

Users are persisted to `users.json` in the project root (created on
first register; gitignored). Passwords are stored only as PBKDF2
hashes, never in plain text. No network calls and no external
services are used.

## Known bug #1 — sliding window never expires (intentional)

**Location:** `backend/app/rate_limiter.py`,
`SlidingWindowRateLimiter.allow()`.

**The bug:** `allow()` appends every request timestamp to the key's
history but never prunes entries older than `window_seconds`. The
history list only ever grows, so the `len(history) >= limit` check
stays true forever.

**Observable symptom:** a legitimate user (IP) that hits the limit
once is **blocked forever** — waiting out the window does not help;
only a server restart (or `reset()`) unblocks them.

**Failing test:** `tests/test_rate_limiter.py::TestRateLimiter::test_window_expires`
— it makes 3 requests (limit 3, window 1 s), sleeps 1.1 s, then
expects the next request to pass. It fails until the bug is fixed.

## Missing feature — no per-user rate limiting

**Location:** `backend/app/main.py` (`ip_limiter`) and
`backend/app/rate_limiter.py`.

Only **per-IP** rate limiting exists (5 requests / 60 s per IP on
`/register` and `/login`). There is **no per-user limit**: the
`/login` endpoint should also enforce a stricter per-user limit
(e.g. 5 failed logins per username per 15 minutes), but currently it
does not. An attacker can spread password guesses for one account
across many IPs — or stay just under the per-IP cap — without ever
triggering a per-user block, and a single account can be hammered
indefinitely from a rotating set of IPs.

## What a good assessment solution should do

1. **Fix bug #1** — in `allow()`, prune expired entries before
   counting, e.g.
   `history[:] = [t for t in history if t > now - self.window_seconds]`.
   `test_window_expires` must then pass, with no other test breaking.
2. **Add per-user rate limiting** — add a second limiter keyed by
   username on `/login` (stricter than the per-IP limit), returning
   HTTP 429 when it trips, and add tests proving that (a) repeated
   failed logins for one user from different IPs are blocked, and
   (b) one blocked user does not block other users.
3. **Add tests** — for the window-expiry fix (already present as the
   failing test) and for the new per-user limit, including the
   expiry behaviour of the per-user window.

## Notes

- Python 3.12, stdlib only. No secrets are committed; the token
  secret in `auth.py` (`DEMO_SECRET`) is a demo placeholder only.
- This demo is standalone. It does not touch, import, or depend on
  any other GroundTruth repository.
