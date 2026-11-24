// ── Live follow-up test (P1 F5) — run by the coordinator, NOT by an agent ──
// Drives the REAL server over HTTP against a LIVE AI key and probes the
// follow-up path with one deliberately incomplete-but-relevant answer.
//
//   AI_MOCK=false BASE_URL=http://localhost:4100 node scripts/live-followup-test.mjs
//
// What it does:
//   1. Runs the minimal journey to an interview (register → profile →
//      one project → assessment → challenge → consent → Lab fix →
//      submit → evaluate → interview generate → session → readiness).
//   2. Verifies the server is actually in LIVE mode: generationProvider
//      must be "live". If it is "deterministic" the script ABORTS — a
//      mock run must never be reported as live evidence.
//   3. Submits ONE deliberately incomplete-but-relevant answer to Q1
//      (API design: status codes only, admits uncertainty on versioning
//      and auth) and records the model's ACTUAL outcome honestly —
//      Complete / Partial / Missed. The outcome is NEVER manipulated to
//      force Partial.
//   4. If (and only if) the model classifies it Partial, the follow-up
//      must be generated + served next + answered + scored live, and the
//      script records its score and provider. Otherwise it records that
//      no follow-up was due and stops.
//
// The script never prints, reads or needs any API key — the key lives
// in the server's environment only. It prints provider + model for
// every AI call, and a final OUTCOME RECORD (JSON) for the report.
// Exit 0: procedure completed with an honest record (a non-Partial
// outcome is data, not a failure). Exit 1: protocol error, server not
// in live mode, or a follow-up missing when the outcome was Partial.

const BASE = process.env.BASE_URL ?? "http://localhost:4100";
const RUN = Date.now().toString(36);
import { randomUUID } from "node:crypto";
// sessionId must be a UUID — the server validates it (z.string().uuid()).
const SESSION_ID = randomUUID();

let passed = 0;
let failed = 0;
const failures = [];

function step(name, ok, detail = "") {
  if (ok) {
    passed++;
    console.log(`  PASS  ${name}${detail ? ` — ${detail}` : ""}`);
  } else {
    failed++;
    failures.push(name);
    console.log(`  FAIL  ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

async function call(method, path, token, body) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      "content-type": "application/json",
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  let json = null;
  try {
    json = await res.json();
  } catch {
    /* non-JSON (e.g. 204) */
  }
  return { status: res.status, json };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Fixed rate limiter (same fix the E2E journey applies — the Lab's
// visible + hidden tests must pass before submit).
const FIXED_RATE_LIMITER = `"""Per-IP sliding-window rate limiting — stdlib only (fixed)."""

from __future__ import annotations

import time


class SlidingWindowRateLimiter:
    """Allow at most 'limit' requests per 'window_seconds' per key."""

    def __init__(self, limit: int = 5, window_seconds: float = 60.0) -> None:
        if limit < 1:
            raise ValueError("limit must be >= 1")
        if window_seconds <= 0:
            raise ValueError("window_seconds must be > 0")
        self.limit = limit
        self.window_seconds = window_seconds
        self._requests: dict[str, list[float]] = {}
        self._user_requests: dict[str, list[float]] = {}

    def _prune(self, history: list[float], now: float) -> list[float]:
        return [t for t in history if t > now - self.window_seconds]

    def allow(self, key: str) -> bool:
        now = time.time()
        history = self._prune(self._requests.setdefault(key, []), now)
        self._requests[key] = history
        if len(history) >= self.limit:
            return False
        history.append(now)
        return True

    def allow_user(self, username: str) -> bool:
        """Per-user limit, independent of the per-IP limit."""
        now = time.time()
        history = self._prune(self._user_requests.setdefault(username, []), now)
        self._user_requests[username] = history
        if len(history) >= self.limit:
            return False
        history.append(now)
        return True

    def count(self, key: str) -> int:
        return len(self._prune(self._requests.get(key, []), time.time()))

    def reset(self, key: str | None = None) -> None:
        if key is None:
            self._requests.clear()
            self._user_requests.clear()
        else:
            self._requests.pop(key, None)
            self._user_requests.pop(key, None)
`;

// Deliberately incomplete-but-relevant: covers status codes only,
// admits uncertainty on versioning and auth. Do NOT "improve" this
// answer to force a Partial — the model's real outcome is the result.
const INCOMPLETE_Q1 =
  "I designed the API with correct status codes for the challenge endpoints, returning JSON " +
  "responses and mapping errors to the right codes. I am not fully sure how I would handle " +
  "versioning or auth for these routes, and I would need to look at the existing handlers " +
  "again before deciding. I know the routes should stay small and grouped by resource.";

// A strong, complete answer for the follow-up (only used if one is generated).
const STRONG_FOLLOWUP =
  "For databases and data modelling I would persist the limiter state in PostgreSQL instead of an " +
  "in-memory dictionary: normalise the counters into a table keyed by client identifier with a " +
  "timestamp column, add an index on the timestamp so pruning old entries stays fast, and wrap each " +
  "increment in a transaction so concurrent requests cannot double-count. I would keep the schema " +
  "small and grouped by domain, and I would test the trickiest case — two users hitting the limit at " +
  "the same window boundary — with the visible tests first.";

async function main() {
  console.log(`Live follow-up test — ${BASE} (run ${RUN})`);
  console.log(`  NOTE: the server must be running with a live AI key (AI_MOCK=false).`);
  console.log(`  This script never reads or prints any key.`);

  const record = {
    run: RUN,
    base: BASE,
    mode: "live",
    generationProvider: null,
    generationMethod: null,
    q1: { outcome: null, score: null, provider: null, model: null, method: null },
    followUp: null,
  };

  // ── Journey to an interview (condensed E2E §1–§9) ─────────────────────
  const studentEmail = `live-fu-student-${RUN}@example.dev`;
  const regS = await call("POST", "/api/auth/register", null, {
    email: studentEmail, password: "Test@1234", full_name: "Live FU Student", role: "student",
  });
  step("register student", regS.status === 201, `HTTP ${regS.status}`);
  const loginS = await call("POST", "/api/auth/login", null, { email: studentEmail, password: "Test@1234" });
  const studentToken = loginS.json?.accessToken ?? loginS.json?.token;
  step("student login returns token", loginS.status === 200 && Boolean(studentToken), `HTTP ${loginS.status}`);
  if (!studentToken) throw new Error("no token — cannot continue");

  const prof = await call("PUT", "/api/student/profile", studentToken, {
    headline: "Backend developer", location: "Agra, India",
    summary: "Python developer learning backend systems.",
    degree: "btech", branch: "cse", graduation_year: 2027,
    target_roles: ["backend"], skills: ["Python", "FastAPI", "PostgreSQL"],
  });
  step("update student profile", prof.status === 200, `HTTP ${prof.status}`);
  const proj = await call("POST", "/api/student/projects", studentToken, {
    title: "groundtruth-assessment-demo",
    description: "Small auth API with a sliding-window rate limiter.",
    kind: "repository", technologies: ["Python"], role: "Author",
  });
  step("add the one project", proj.status === 201, `HTTP ${proj.status}`);
  const complete = await call("POST", "/api/student/profile/complete", studentToken, {});
  step("complete onboarding", complete.status === 200, `HTTP ${complete.status}`);

  const asm = await call("POST", "/api/assessments", studentToken, { source: "manual", timeLimitMinutes: 60 });
  step("create assessment (demo project)", asm.status === 201 && asm.json?.id, `HTTP ${asm.status}`);
  const asmId = asm.json?.id;
  const demo = await call("GET", "/api/assessments/demo-project", studentToken);
  const demoFiles = demo.json?.files ?? demo.json ?? {};
  const fileList = Object.entries(demoFiles).map(([path, content]) => ({ path, content }));
  const repoAn = await call("POST", "/api/assessments/projects/analyze", studentToken, { assessmentId: asmId, files: fileList });
  step("repo analysis (no execution)", repoAn.status === 200, `HTTP ${repoAn.status}`);
  const ch = await call("POST", `/api/assessments/${asmId}/challenge/generate`, studentToken, {});
  step("challenge generated", (ch.status === 200 || ch.status === 201) && ch.json?.title, `HTTP ${ch.status}`);
  const consent = await call("POST", `/api/assessments/${asmId}/consent`, studentToken, { agreed: true });
  step("monitoring consent recorded", consent.status === 200 || consent.status === 201, `HTTP ${consent.status}`);
  const start = await call("POST", `/api/assessments/${asmId}/start`, studentToken, { sessionId: SESSION_ID });
  step("Lab started", start.status === 200 && start.json?.sandboxBackend, `backend=${start.json?.sandboxBackend}`);
  const save = await call("PUT", `/api/assessments/${asmId}/files/backend/app/rate_limiter.py`, studentToken, { content: FIXED_RATE_LIMITER, sessionId: SESSION_ID });
  step("autosave fixed rate_limiter.py", save.status === 200, `HTTP ${save.status}`);
  const retest = await call("POST", `/api/assessments/${asmId}/execution/test`, studentToken, { sessionId: SESSION_ID });
  step("tests pass after fix", retest.status === 200 && retest.json?.exitCode === 0, `exit=${retest.json?.exitCode}`);
  const submit = await call("POST", `/api/assessments/${asmId}/submit`, studentToken, { sessionId: SESSION_ID });
  step("submit freezes snapshot + runs hidden tests", submit.status === 200 && submit.json?.snapshotHash, `HTTP ${submit.status}`);
  const evalRes = await call("POST", `/api/assessments/${asmId}/evaluate`, studentToken, {});
  step("evaluation runs", evalRes.status === 200 && typeof evalRes.json?.overallScore === "number", `overallScore=${evalRes.json?.overallScore}`);

  // ── Interview generate — LIVE-mode gate ───────────────────────────────
  const iv = await call("POST", `/api/assessments/${asmId}/interview/generate`, studentToken, {});
  step("interview generated from evaluation", (iv.status === 200 || iv.status === 201) && iv.json?.interview?.id, `HTTP ${iv.status}`);
  record.generationProvider = iv.json?.generationProvider ?? null;
  record.generationMethod = iv.json?.generationMethod ?? null;
  console.log(`  INFO  generation provider=${record.generationProvider} method=${record.generationMethod}`);
  if (iv.json?.generationProvider !== "live") {
    console.log(`\nABORT: server is NOT in live mode (generationProvider=${record.generationProvider ?? "?"}).`);
    console.log(`Start the server with a live AI key and AI_MOCK=false, then re-run. Nothing below is live evidence.`);
    process.exit(1);
  }
  step("server is in LIVE mode (generationProvider=live)", true, `method=${record.generationMethod}`);
  const ivId = iv.json?.interview?.id;

  async function answerInterview(questionId, body) {
    let res = await call("POST", `/api/assessments/interviews/${ivId}/session/answer`, studentToken, { questionId, ...body });
    if (res.status === 429) {
      await sleep(61_000);
      res = await call("POST", `/api/assessments/interviews/${ivId}/session/answer`, studentToken, { questionId, ...body });
    }
    return res;
  }

  const sessStart = await call("POST", `/api/assessments/interviews/${ivId}/session/start`, studentToken, {});
  step("interview session starts (intro)", sessStart.status === 201 && sessStart.json?.session?.status === "intro", `HTTP ${sessStart.status}`);
  const ready = await call("POST", `/api/assessments/interviews/${ivId}/session/readiness`, studentToken, { acknowledged: true });
  step("readiness acknowledged", ready.status === 200 && ready.json?.session?.status === "ready", `HTTP ${ready.status}`);
  const sess = await call("GET", `/api/assessments/interviews/${ivId}/session`, studentToken);
  step("session serves only the current question", sess.status === 200 && sess.json?.currentQuestion?.questionNumber === 1, `HTTP ${sess.status}`);
  const q1 = sess.json?.currentQuestion;
  if (!q1) throw new Error("no current interview question returned");
  console.log(`  INFO  Q1 [${q1.category} / ${q1.competencyId}]: ${String(q1.question).slice(0, 120)}…`);

  // ── The probe: one incomplete-but-relevant answer ─────────────────────
  const ans = await answerInterview(q1.id, { answer: INCOMPLETE_Q1 });
  step("Q1 answer accepted", ans.status === 200 && typeof ans.json?.score === "number", `HTTP ${ans.status} score=${ans.json?.score} outcome=${ans.json?.outcome}`);
  record.q1 = {
    outcome: ans.json?.outcome ?? null,
    score: ans.json?.score ?? null,
    provider: ans.json?.evaluation?.provider ?? null,
    model: ans.json?.evaluation?.model ?? null,
    method: ans.json?.evaluation?.method ?? null,
  };
  console.log(`  INFO  Q1 scored live: outcome=${record.q1.outcome} score=${record.q1.score} provider=${record.q1.provider} model=${record.q1.model} method=${record.q1.method}`);
  step("Q1 evaluation is live-scored (provider=live)", record.q1.provider === "live", `provider=${record.q1.provider}`);

  // ── Follow-up branch — only when the model said Partial ──────────────
  if (record.q1.outcome === "partial") {
    if (!ans.json?.followUp) {
      step("Partial Q1 generated a follow-up", false, "outcome was Partial but no followUp in the response");
      throw new Error("follow-up missing after a Partial outcome");
    }
    step("Partial Q1 generated a follow-up, served next", ans.json.next?.questionId === ans.json.followUp.id, `followUpId=${ans.json.followUp.id}`);
    record.followUp = {
      generated: true,
      questionId: ans.json.followUp.id,
      competencyId: ans.json.followUp.competencyId ?? null,
      answered: false,
      outcome: null,
      score: null,
      provider: null,
      model: null,
    };
    const fuAns = await answerInterview(ans.json.followUp.id, { answer: STRONG_FOLLOWUP });
    step("follow-up answered live", fuAns.status === 200 && typeof fuAns.json?.score === "number", `HTTP ${fuAns.status} score=${fuAns.json?.score} outcome=${fuAns.json?.outcome}`);
    record.followUp.answered = fuAns.status === 200;
    record.followUp.outcome = fuAns.json?.outcome ?? null;
    record.followUp.score = fuAns.json?.score ?? null;
    record.followUp.provider = fuAns.json?.evaluation?.provider ?? null;
    record.followUp.model = fuAns.json?.evaluation?.model ?? null;
    step("follow-up evaluation is live-scored (provider=live)", record.followUp.provider === "live", `provider=${record.followUp.provider}`);
    step("answering the follow-up generated no second follow-up", fuAns.json?.followUp == null, "");
  } else {
    // Honest non-Partial record: no follow-up is due, and none must appear.
    record.followUp = { generated: false, reason: `Q1 outcome was ${record.q1.outcome}, not Partial` };
    step("no follow-up due (Q1 was not Partial)", ans.json?.followUp == null, `outcome=${record.q1.outcome}`);
    console.log(`  INFO  Live outcome was ${record.q1.outcome} — no follow-up expected. This is the honest result; the probe is NOT re-run with a different answer to force Partial.`);
  }

  console.log(`\nOUTCOME RECORD (paste into the report as-is):\n${JSON.stringify(record, null, 2)}`);
  console.log(`\nLive follow-up test result: ${passed} passed, ${failed} failed${failures.length ? ` — failed: ${failures.join(", ")}` : ""}`);
  process.exit(failed ? 1 : 0);
}

main().catch((err) => {
  console.error("Live follow-up test crashed:", err);
  process.exit(1);
});
