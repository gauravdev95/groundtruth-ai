// ── GroundTruth assessment end-to-end journey ─────────────────────────────
// Drives the REAL built server over HTTP (start it first, see README in
// docs/ASSESSMENT_IMPLEMENTATION_REPORT.md). Dual-mode (P1 F5):
//   AI_MOCK=true  (default) — the server's deterministic mock LLM
//     provider: question generation is labelled "deterministic",
//     answer scoring is labelled provider "mock" / method
//     "deterministic".
//   AI_MOCK=false — live AI: generation must be "live", scoring
//     provider "live" / method "llm". The server must be started with
//     a real key; this script never prints or needs the key.
// Provider assertions are MODE-AWARE (they read AI_MOCK and expect the
// matching labels) — not weakened. The follow-up checks assert the
// outcome-consistency invariant in both modes instead of assuming the
// deterministic scorer's Partial in live mode.
//
// Flow: register student + recruiter → student profile → strength analysis
// → demo project → repo analysis → challenge → consent → Lab (fix the demo
// bug + add per-user limiting) → run tests → submit (visible + hidden) →
// evaluate → interview → verified profile → recruiter job → apply →
// recruiter monitoring report + verified-skills evidence + competency
// dashboard (Phase F: history, interview report, list chips, 403 gate).
//
// Usage:
//   BASE_URL=http://localhost:4100 node scripts/e2e-assessment.mjs
//   AI_MOCK=false BASE_URL=http://localhost:4100 node scripts/e2e-assessment.mjs
// Exits 0 when every step passes, 1 otherwise. Prints one line per step.

const BASE = process.env.BASE_URL ?? "http://localhost:4100";
const RUN = Date.now().toString(36);
import { randomUUID } from "node:crypto";
const SESSION_ID = randomUUID();

// ── Dual-mode (P1 F5) ────────────────────────────────────────────────────
// Read the mode from the environment, exactly as the server does:
// AI_MOCK unset or "true" → mock; "false" → live. Every provider
// assertion below uses these expected values, never a hardcoded "mock".
const AI_MOCK = process.env.AI_MOCK !== "false";
const EXPECTED_GENERATION_PROVIDER = AI_MOCK ? "deterministic" : "live";
const EXPECTED_EVAL_PROVIDER = AI_MOCK ? "mock" : "live";
const EXPECTED_EVAL_METHOD = AI_MOCK ? "deterministic" : "llm";
const EXPECTED_QUESTION_TYPES = ["project_specific", "conceptual", "engineering_scenario"];

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

async function main() {
  console.log(`E2E assessment journey — ${BASE} (run ${RUN}) — AI mode: ${AI_MOCK ? "MOCK (deterministic)" : "LIVE"}; expected generation provider=${EXPECTED_GENERATION_PROVIDER}, evaluation provider=${EXPECTED_EVAL_PROVIDER} / method=${EXPECTED_EVAL_METHOD}`);

  // ── 0. Health ──────────────────────────────────────────────────────────
  const health = await call("GET", "/health");
  step("health endpoint responds", health.status === 200 || health.status === 503, `HTTP ${health.status}`);
  step("health reports postgres ok", health.json?.dependencies?.postgres === "ok", JSON.stringify(health.json?.dependencies));

  // ── 1. Register + login ────────────────────────────────────────────────
  const studentEmail = `e2e-student-${RUN}@example.dev`;
  const recruiterEmail = `e2e-recruiter-${RUN}@example.dev`;
  const regS = await call("POST", "/api/auth/register", null, {
    email: studentEmail, password: "Test@1234", full_name: "E2E Student", role: "student",
  });
  step("register student", regS.status === 201, `HTTP ${regS.status}`);
  const regR = await call("POST", "/api/auth/register", null, {
    email: recruiterEmail, password: "Test@1234", full_name: "E2E Recruiter", role: "recruiter", company_name: "E2E Corp",
  });
  step("register recruiter", regR.status === 201, `HTTP ${regR.status}`);
  const loginS = await call("POST", "/api/auth/login", null, { email: studentEmail, password: "Test@1234" });
  const studentToken = loginS.json?.accessToken ?? loginS.json?.token;
  step("student login returns token", loginS.status === 200 && Boolean(studentToken), `HTTP ${loginS.status}`);
  const loginR = await call("POST", "/api/auth/login", null, { email: recruiterEmail, password: "Test@1234" });
  const recruiterToken = loginR.json?.accessToken ?? loginR.json?.token;
  step("recruiter login returns token", loginR.status === 200 && Boolean(recruiterToken), `HTTP ${loginR.status}`);
  if (!studentToken || !recruiterToken) throw new Error("no tokens — cannot continue");

  // ── 2. Student profile (basic + skills + one project) ──────────────────
  const prof = await call("PUT", "/api/student/profile", studentToken, {
    headline: "Backend developer", location: "Agra, India",
    summary: "Python developer learning backend systems.",
    degree: "btech", branch: "cse", graduation_year: 2027,
    target_roles: ["backend"], skills: ["Python", "FastAPI", "PostgreSQL"],
  });
  step("update student profile", prof.status === 200, `HTTP ${prof.status} ${JSON.stringify(prof.json)?.slice(0, 120)}`);
  const proj = await call("POST", "/api/student/projects", studentToken, {
    title: "groundtruth-assessment-demo",
    description: "Small auth API with a sliding-window rate limiter.",
    kind: "repository", technologies: ["Python"], role: "Author",
  });
  step("add the one project", proj.status === 201, `HTTP ${proj.status}`);
  const proj2 = await call("POST", "/api/student/projects", studentToken, {
    title: "second project", description: "must be rejected", kind: "described", technologies: [],
  });
  step("second project rejected (one-project rule)", proj2.status === 409, `HTTP ${proj2.status}`);
  const complete = await call("POST", "/api/student/profile/complete", studentToken, {});
  step("complete onboarding", complete.status === 200, `HTTP ${complete.status}`);
  const full = await call("GET", "/api/student/profile", studentToken);
  const candidateId = full.json?.candidate?.id;
  step("profile completeness is 70% (basic+project only)", full.json?.completeness?.percent === 70, `percent=${full.json?.completeness?.percent}`);

  // ── 3. AI profile strength ─────────────────────────────────────────────
  const analysis = await call("POST", "/api/assessments/profile/analyze", studentToken, {});
  step("profile strength analysis", (analysis.status === 200 || analysis.status === 201) && typeof analysis.json?.overall === "number", `overall=${analysis.json?.overall}`);
  step("strength never fabricates (no invented skills)", !JSON.stringify(analysis.json).includes("Kubernetes"), `overall=${analysis.json?.overall}`);
  const strength = await call("GET", "/api/assessments/profile/strength", studentToken);
  step("strength endpoint", strength.status === 200 && strength.json?.overall_score === analysis.json?.overall, `overall_score=${strength.json?.overall_score}`);
  const recs = await call("GET", "/api/assessments/profile/recommendations", studentToken);
  step("recommendations each explain WHY", recs.status === 200 && Array.isArray(recs.json?.recommendations) && recs.json.recommendations.every((r) => r.why), `count=${recs.json?.recommendations?.length}`);

  // ── 4. Assessment + demo project + repo analysis ───────────────────────
  const asm = await call("POST", "/api/assessments", studentToken, { source: "manual", timeLimitMinutes: 60 });
  step("create assessment (demo project)", asm.status === 201 && asm.json?.id, `HTTP ${asm.status}`);
  const asmId = asm.json?.id;
  const demo = await call("GET", "/api/assessments/demo-project", studentToken);
  const demoFiles = demo.json?.files ?? demo.json ?? {};
  step("demo project files served", demo.status === 200 && typeof demoFiles === "object" && Object.keys(demoFiles).length > 5, `files=${Object.keys(demoFiles).length}`);
  const fileList = Object.entries(demoFiles).map(([path, content]) => ({ path, content }));
  const repoAn = await call("POST", "/api/assessments/projects/analyze", studentToken, { assessmentId: asmId, files: fileList });
  step("repo analysis (no execution)", repoAn.status === 200 && Array.isArray(repoAn.json?.frameworks), `HTTP ${repoAn.status}`);
  step("repo analysis detects Python + rate limiter", JSON.stringify(repoAn.json).includes("Python"), "");

  // ── 5. Challenge ───────────────────────────────────────────────────────
  const ch = await call("POST", `/api/assessments/${asmId}/challenge/generate`, studentToken, {});
  step("challenge generated", (ch.status === 200 || ch.status === 201) && ch.json?.title, `HTTP ${ch.status} — ${ch.json?.title}`);
  step("challenge has acceptance criteria + time limit", Array.isArray(ch.json?.acceptanceCriteria ?? ch.json?.acceptance_criteria) && (ch.json?.timeLimitMinutes === 60 || ch.json?.time_limit_minutes === 60), "");
  step("hidden tests NEVER in challenge response", !("hiddenTests" in (ch.json ?? {})) && !JSON.stringify(ch.json).includes("_gt_hidden"), "");
  const chAgain = await call("GET", `/api/assessments/${asmId}/challenge`, studentToken);
  step("challenge readable by owner", chAgain.status === 200 && chAgain.json?.id === ch.json?.id, `HTTP ${chAgain.status}`);

  // ── 6. Consent + start Lab ─────────────────────────────────────────────
  const consentBefore = await call("POST", `/api/assessments/${asmId}/start`, studentToken, { sessionId: SESSION_ID });
  step("start without consent is rejected", consentBefore.status === 409, `HTTP ${consentBefore.status}`);
  const consent = await call("POST", `/api/assessments/${asmId}/consent`, studentToken, { agreed: true });
  step("monitoring consent recorded", consent.status === 200 || consent.status === 201, `HTTP ${consent.status}`);
  const start = await call("POST", `/api/assessments/${asmId}/start`, studentToken, { sessionId: SESSION_ID });
  step("Lab started (sandbox backend reported)", start.status === 200 && start.json?.sandboxBackend, `backend=${start.json?.sandboxBackend}`);
  step("sandbox is unshare (not disabled)", start.json?.sandboxBackend === "unshare", `backend=${start.json?.sandboxBackend}`);
  const files = await call("GET", `/api/assessments/${asmId}/files`, studentToken);
  step("Lab files seeded from demo project", files.status === 200 && typeof files.json?.files === "object" && Object.keys(files.json.files).length > 5, `files=${Object.keys(files.json?.files ?? {}).length}`);

  // ── 7. Monitoring: duplicate + tab visibility + terminal ───────────────
  const ev1 = await call("POST", `/api/assessments/${asmId}/events`, studentToken, {
    sessionId: SESSION_ID, clientEventId: `evt-${RUN}-1`, eventType: "tab_hidden",
    metadata: {},
  });
  step("tab visibility event recorded", ev1.status === 201 || ev1.status === 200, `HTTP ${ev1.status}`);
  const evDup = await call("POST", `/api/assessments/${asmId}/events`, studentToken, {
    sessionId: SESSION_ID, clientEventId: `evt-${RUN}-1`, eventType: "tab_hidden",
    metadata: {},
  });
  step("duplicate event deduped (same client_event_id)", evDup.status === 200 || evDup.status === 409, `HTTP ${evDup.status}`);
  const exec = await call("POST", `/api/assessments/${asmId}/execution/run`, studentToken, {
    sessionId: SESSION_ID, kind: "run", command: ["python3", "-m", "unittest", "discover", "-s", "tests", "-v"],
  });
  step("visible test run in sandbox (1 failure expected pre-fix)", exec.status === 200 && exec.json?.exitCode === 1 && /FAILED/.test((exec.json?.stdout ?? "") + (exec.json?.stderr ?? "")), `HTTP ${exec.status} exit=${exec.json?.exitCode}`);
  step("sandbox blocks disallowed command", (await call("POST", `/api/assessments/${asmId}/execution/run`, studentToken, { sessionId: SESSION_ID, kind: "run", command: ["curl", "https://example.com"] })).status === 400, "");

  // ── 7b. Security: escape attempts from inside the sandbox ─────────────
  const escapeProbe = [
    "import os, socket",
    "out = []",
    "out.append('etc_passwd=' + str(os.path.exists('/etc/passwd')))",
    "out.append('root_ssh=' + str(os.path.exists('/root/.ssh')))",
    "out.append('proc_server=' + str(os.path.exists('/proc/1/cmdline') and b'systemd' in open('/proc/1/cmdline','rb').read()))",
    "out.append('siblings=' + str(sorted(os.listdir('/tmp/gt-assessment-workspaces'))))",
    "try:",
    "    s = socket.socket(); s.settimeout(2); s.connect(('8.8.8.8', 53)); out.append('network=REACHABLE')",
    "except Exception:",
    "    out.append('network=BLOCKED')",
    "print(';'.join(out))",
  ].join("\n");
  const esc = await call("POST", `/api/assessments/${asmId}/execution/run`, studentToken, {
    sessionId: SESSION_ID, kind: "run", command: ["python3", "-c", escapeProbe],
  });
  const escOut = (esc.json?.stdout ?? "") + (esc.json?.stderr ?? "");
  step("sandbox hides /etc/passwd + /root/.ssh", escOut.includes("etc_passwd=False") && escOut.includes("root_ssh=False"), escOut.slice(0, 200));
  step("sandbox hides host processes (/proc/1 is not host init)", escOut.includes("proc_server=False"), "");
  step("sandbox exposes only this workspace to the candidate", escOut.includes(`siblings=['${asmId}']`), escOut.slice(0, 200));
  step("sandbox has no network", escOut.includes("network=BLOCKED"), "");

  // ── 7c. WebSocket terminal: connect, ping, run, reconnect ─────────────
  const execSession = await call("GET", `/api/assessments/${asmId}/execution/session`, studentToken);
  const execSessionId = execSession.json?.id ?? start.json?.executionSessionId;
  step("execution session id available for WS terminal", Boolean(execSessionId), `HTTP ${execSession.status}`);
  async function wsTerminal() {
    return await new Promise((resolve) => {
      const wsBase = BASE.replace(/^http/, "ws");
      const ws = new WebSocket(`${wsBase}/ws/execution/${execSessionId}/terminal?token=${studentToken}`);
      const seen = { ready: false, pong: false, output: null };
      const timer = setTimeout(() => { try { ws.close(); } catch {} resolve(seen); }, 20000);
      ws.onopen = () => {};
      ws.onmessage = (ev) => {
        try {
          const msg = JSON.parse(String(ev.data));
          if (msg.type === "ready") { seen.ready = true; ws.send(JSON.stringify({ type: "ping" })); }
          else if (msg.type === "pong") { seen.pong = true; ws.send(JSON.stringify({ type: "command", command: ["ls", "tests"] })); }
          else if (msg.type === "output") { seen.output = msg; clearTimeout(timer); ws.close(); resolve(seen); }
          else if (msg.type === "error") { clearTimeout(timer); ws.close(); resolve(seen); }
        } catch { /* ignore */ }
      };
      ws.onerror = () => { clearTimeout(timer); resolve(seen); };
      ws.onclose = () => { clearTimeout(timer); resolve(seen); };
    });
  }
  const ws1 = await wsTerminal();
  step("WS terminal: ready + pong + command output", ws1.ready && ws1.pong && ws1.output?.exitCode === 0 && /test_rate_limiter\.py/.test(ws1.output?.stdout ?? ""), `ready=${ws1.ready} pong=${ws1.pong} exit=${ws1.output?.exitCode}`);
  const ws2 = await wsTerminal();
  step("WS terminal: reconnect works (second connection)", ws2.ready && ws2.output?.exitCode === 0, `ready=${ws2.ready}`);

  // ── 8. Fix the code in the Lab, re-run, submit ─────────────────────────
  const save = await call("PUT", `/api/assessments/${asmId}/files/backend/app/rate_limiter.py`, studentToken, { content: FIXED_RATE_LIMITER, sessionId: SESSION_ID });
  step("autosave fixed rate_limiter.py", save.status === 200, `HTTP ${save.status}`);
  const retest = await call("POST", `/api/assessments/${asmId}/execution/test`, studentToken, { sessionId: SESSION_ID });
  step("tests pass after fix", retest.status === 200 && retest.json?.exitCode === 0 && retest.json?.parsed?.failed === 0, `exit=${retest.json?.exitCode} passed=${retest.json?.parsed?.passed}`);
  const submit = await call("POST", `/api/assessments/${asmId}/submit`, studentToken, { sessionId: SESSION_ID });
  step("submit freezes snapshot + runs hidden tests", submit.status === 200 && submit.json?.snapshotHash, `HTTP ${submit.status}`);
  step("hidden tests pass after fix", submit.json?.hiddenTests?.failed === 0 && submit.json?.hiddenTests?.total >= 3, `hidden=${submit.json?.hiddenTests?.passed}/${submit.json?.hiddenTests?.total}`);
  step("visible tests pass at submit", submit.json?.visibleTests?.failed === 0, `visible=${submit.json?.visibleTests?.passed}/${submit.json?.visibleTests?.total}`);

  // ── 9. Evaluation ──────────────────────────────────────────────────────
  const evalRes = await call("POST", `/api/assessments/${asmId}/evaluate`, studentToken, {});
  step("evaluation runs", evalRes.status === 200 && typeof evalRes.json?.overallScore === "number", `overallScore=${evalRes.json?.overallScore}`);
  step("functional score comes from real tests (not invented)", evalRes.json?.categoryScores?.functional >= 70, `functional=${evalRes.json?.categoryScores?.functional}`);
  const evalGet = await call("GET", `/api/assessments/${asmId}/evaluation`, studentToken);
  step("evaluation readable", evalGet.status === 200 && evalGet.json?.overallScore === evalRes.json?.overallScore, `HTTP ${evalGet.status}`);

  // ── 10. Interview (Phase C session flow) ─────────────────────────────
  // P1 F5: a scored evaluation must carry provider metadata matching
  // the configured mode — provider + non-empty model + method +
  // all 5 dimensions + status. Checked on every answer below.
  function evalMetadataOk(ev) {
    return Boolean(
      ev && typeof ev.provider === "string" && ev.provider === EXPECTED_EVAL_PROVIDER &&
      typeof ev.model === "string" && ev.model.length > 0 &&
      typeof ev.method === "string" && ev.method === EXPECTED_EVAL_METHOD &&
      typeof ev.status === "string" &&
      ev.dimensions && Object.keys(ev.dimensions).length === 5,
    );
  }
  const iv = await call("POST", `/api/assessments/${asmId}/interview/generate`, studentToken, {});
  step("interview generated from evaluation", (iv.status === 200 || iv.status === 201) && iv.json?.interview?.id, `HTTP ${iv.status}`);
  step("exactly 7 pre-generated questions, provider matches the configured mode", iv.json?.questionCount === 7 && iv.json?.generationProvider === EXPECTED_GENERATION_PROVIDER, `questionCount=${iv.json?.questionCount} provider=${iv.json?.generationProvider} expected=${EXPECTED_GENERATION_PROVIDER}`);
  // Phase G: the generate response must never carry the answer key — no
  // question texts, no expected points, no rubrics (regression check).
  step("generate response leaks no question text / expected points / rubrics", !("questions" in (iv.json ?? {})) && !JSON.stringify(iv.json ?? {}).includes("expected_points") && !JSON.stringify(iv.json ?? {}).includes("scoring_rubric"), "");
  const ivId = iv.json?.interview?.id;
  // The interview answer route carries the 10/min LLM rate limit, and this
  // script now submits up to 9 answers in one run — retry once on 429
  // after the 60 s window rolls over instead of failing the journey.
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
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
  step("session serves only the current question", sess.status === 200 && sess.json?.currentQuestion?.questionNumber === 1 && !JSON.stringify(sess.json).includes("expected_points"), `HTTP ${sess.status}`);
  const q1 = sess.json?.currentQuestion;
  if (!q1) throw new Error("no current interview question returned");
  // Q1 (API Design & REST): a solid project-grounded answer covering
  // versioned routes + codes/validation/auth, a concrete file example,
  // and grounding in the submitted project and its test results.
  const ANSWER_Q1 = "I designed a clean, versioned REST API with correct status codes, validation and auth for the challenge endpoints: versioned routes, JSON bodies, 201 for creates, 400 for bad input, 404 for missing resources and 409 for conflicts, with a consistent error shape. For a concrete example from my own code, in backend/app/rate_limiter.py I exposed the limiter behind REST APIs using HTTP and FastAPI, naming the file and the allow and allow_user functions I changed. I grounded every claim in the submitted project: the actual files changed, the challenge requirements, and the observed test results from the visible and hidden tests.";
  const ans = await answerInterview(q1.id, { answer: ANSWER_Q1 });
  step("interview answer evaluated, provider metadata matches the configured mode", ans.status === 200 && typeof ans.json?.score === "number" && evalMetadataOk(ans.json?.evaluation), `score=${ans.json?.score} outcome=${ans.json?.outcome} provider=${ans.json?.evaluation?.provider} method=${ans.json?.evaluation?.method} model=${ans.json?.evaluation?.model}`);
  const dup = await answerInterview(q1.id, {
    answer: "A different answer.",
    confirmShort: true,
  });
  step("duplicate answer rejected (409, locked)", dup.status === 409, `HTTP ${dup.status}`);
  // ── 10a. Answer the remaining questions one at a time (Phase G). ─────
  // Q2 gets a deliberately partial answer: it covers exactly one of the
  // three expected points for Databases & Data Modelling (trade-offs /
  // edge cases) and admits uncertainty on the rest, so deterministic
  // scoring lands in the Partial band (40–59) and the server must insert
  // exactly ONE follow-up, served next. Every other question gets its
  // OWN realistic, project-grounded answer (P1 F5 — the old script
  // repeated one generic answer for Q3–Q7); the loop follows whatever
  // the server serves (including the follow-up) and never assumes an
  // order. In live mode the model scores each answer on its merits —
  // no outcome is forced, and the follow-up steps below assert the
  // outcome-consistency invariant instead of assuming Partial.
  const PARTIAL_Q2 = "For databases and data modelling I would give reasons through the scenario with concrete trade-offs: normalising keeps data consistent but costs joins, while a flat table is faster and risks stale copies. The failure modes I would watch are duplicate rows and partial writes, and the choice would be verified by testing the trickiest queries.";
  // Q3 (Server-Side Logic & OOP): layered service, errors, logging, config.
  const ANSWER_Q3 = "I structured the service as clean layered code with proper errors, logging and config separation: a SlidingWindowRateLimiter class holds the state, the limit and window live in config, and every failure raises a clear error instead of failing silently. For a concrete example from my own code, in backend/app/rate_limiter.py I used Python and OOP with the sliding-window design pattern, in the allow and allow_user functions I changed. The underlying concept is a sliding window: it explains why pruning old timestamps keeps the count correct, and where the naive approach fails — a fixed window lets twice the limit through at the boundary, and never pruning blocks the key forever.";
  // Q4 (Testing & Debugging): reproduce-isolate-fix, edge-case coverage.
  const ANSWER_Q4 = "I kept good unit-test coverage of edge cases and debugged systematically with reproduce-isolate-fix: I reproduced the failure with the visible tests, isolated it to the missing prune step, fixed it, and re-ran the suite. For a concrete example from my own code, in backend/app/rate_limiter.py I used Pytest and unit testing with debugging, in the allow function I changed, adding tests for the window boundary and for two users sharing a key. I grounded every claim in the submitted project: the actual files changed, the challenge requirements, and the observed test results — the visible tests went from failing to passing and the hidden tests passed too.";
  // Q5 (System Design & Scalability): 10x traffic, Redis, queues, trade-offs.
  const ANSWER_Q5 = "For ten times the traffic I would produce a sound design with caching, queues and stated trade-offs: keep the hot counters in Redis instead of one process's memory, shard by client key, and put slow work on a queue so the request path stays fast. For a concrete example from my own code, in backend/app/rate_limiter.py I used system design with caching and Redis, in the allow function I changed, so counters survive restarts and work across processes. I reasoned through the scenario with concrete trade-offs — Redis adds a dependency and a failure mode if it goes down, so I would fall back to local counters — failure modes, and how the choice would be verified with load tests and the existing test suite.";
  // Q6 (weakest-competency scenario — the competency varies with the
  // evaluation, so this answer stays generic to the scenario: what
  // breaks first, change order, verification).
  const ANSWER_Q6 = "If this part of the project started failing under real use, the first thing to break would be the in-memory state: the limiter keeps its counters in a plain dictionary, so a restart wipes them and two processes cannot share them. I would change it in this order: first persist the counters so a restart is safe, then move them to a shared store so every process sees the same counts, then add per-user quotas so one client cannot exhaust the rest. I would verify each change with the visible tests, the hidden tests, and a small load test that hammers the boundary and checks the counts stay correct.";
  // Q7 (project overview + most important change + testing).
  const ANSWER_Q7 = "The project is a small auth API with a sliding-window rate limiter, and the challenge asked me to fix the limiter in backend/app/rate_limiter.py. I designed a clean, versioned REST API with correct status codes, validation and auth around it. For a concrete example from my own code, in backend/app/rate_limiter.py I showed API Design and REST, naming the allow and allow_user functions I changed, using REST APIs, HTTP and FastAPI. I grounded every claim in the submitted project: the actual files changed, the challenge requirements, and the observed test results. The time module shaped the change in the file, because the window math depends on time.time, and I tested it first with the visible tests, then the hidden tests.";
  // Answers are keyed by the question's CATEGORY, not its number: the
  // follow-up is inserted after Q2, so every later question's number
  // shifts by one (original Q3 is served as "Question 4 of 8") while
  // its category stays put. Keying by number served Q3 the Q4 answer.
  const ANSWERS_BY_CATEGORY = {
    project_understanding: ANSWER_Q1,
    code_changes: ANSWER_Q3,
    fundamentals: ANSWER_Q4,
    debugging: ANSWER_Q5,
    security_performance: ANSWER_Q6,
    testing_edge_cases: ANSWER_Q7,
  };
  // The follow-up digs into the missed Databases points: persist the
  // limiter state, normalise, index, transact.
  const FOLLOWUP_ANSWER = "For databases and data modelling I would persist the limiter state in PostgreSQL instead of an in-memory dictionary: normalise the counters into a table keyed by client identifier with a timestamp column, add an index on the timestamp so pruning old entries stays fast, and wrap each increment in a transaction so concurrent requests cannot double-count. I would keep the schema small and grouped by domain, and I would test the trickiest case — two users hitting the limit at the same window boundary — with the visible tests first.";
  let answeredOriginal = 1; // Q1 answered above
  let followUpSeen = false;
  let followUpAnswered = false;
  let followUpCount = 0;
  let partialCount = ans.json?.outcome === "partial" ? 1 : 0;
  let q2Outcome = null;
  const evalMetadataViolations = [];
  if (!evalMetadataOk(ans.json?.evaluation)) evalMetadataViolations.push("Q1");
  const outcomes = [`Q1:${ans.json?.outcome ?? "?"}(${ans.json?.score ?? "?"})`];
  // Served questions, as the server served them one at a time — the
  // raw material for the §10c relevance checks (competency, type,
  // text). Q1 is recorded here; the loop records Q2–Q7 + the follow-up.
  const servedQuestions = [{
    questionNumber: q1.questionNumber ?? 1,
    category: q1.category,
    questionType: q1.questionType ?? null,
    competencyId: q1.competencyId ?? null,
    question: q1.question ?? "",
    isFollowUp: false,
  }];
  for (let guard = 0; guard < 10; guard++) {
    const s = await call("GET", `/api/assessments/interviews/${ivId}/session`, studentToken);
    if (s.status !== 200 || !s.json?.currentQuestion) break;
    const cur = s.json.currentQuestion;
    const isFollowUp = cur.category === "follow_up";
    const text = isFollowUp ? FOLLOWUP_ANSWER : cur.questionNumber === 2 ? PARTIAL_Q2 : (ANSWERS_BY_CATEGORY[cur.category] ?? ANSWER_Q7);
    if (!isFollowUp) {
      servedQuestions.push({
        questionNumber: cur.questionNumber,
        category: cur.category,
        questionType: cur.questionType ?? null,
        competencyId: cur.competencyId ?? null,
        question: cur.question ?? "",
        isFollowUp: false,
      });
    }
    await sleep(5000); // pace the 10/min LLM rate limit across the loop
    const a = await answerInterview(cur.id, { answer: text });
    if (a.status !== 200) throw new Error(`answer ${isFollowUp ? "follow-up" : `Q${cur.questionNumber}`} failed HTTP ${a.status}: ${JSON.stringify(a.json)}`);
    outcomes.push(`${isFollowUp ? "FU" : `Q${cur.questionNumber}`}:${a.json?.outcome ?? "?"}(${a.json?.score ?? "?"})`);
    if (!evalMetadataOk(a.json?.evaluation)) evalMetadataViolations.push(isFollowUp ? "FU" : `Q${cur.questionNumber}`);
    if (isFollowUp) {
      followUpAnswered = true;
    } else {
      answeredOriginal += 1;
      if (a.json?.outcome === "partial") partialCount += 1;
      if (cur.questionNumber === 2) q2Outcome = a.json?.outcome ?? null;
    }
    if (a.json?.followUp) {
      followUpSeen = true;
      followUpCount += 1;
      if (a.json.next?.questionId !== a.json.followUp.id) throw new Error("follow-up was generated but is not served next");
    }
  }
  step("all 7 pre-generated questions answered one at a time", answeredOriginal === 7, `answered=${answeredOriginal} outcomes=${outcomes.join(" ")}`);
  step("every scored evaluation carries provider metadata matching the mode", evalMetadataViolations.length === 0, evalMetadataViolations.length ? `violations=${evalMetadataViolations.join(",")}` : `provider=${EXPECTED_EVAL_PROVIDER} method=${EXPECTED_EVAL_METHOD} on all ${outcomes.length} answers`);
  // Mode-aware follow-up checks (P1 F5 — the 4 previously-failing
  // checks, converted, not deleted): in mock mode the deliberate Q2
  // Partial must trigger exactly one follow-up; in live mode the
  // model decides the outcome, so the invariant is follow-up iff a
  // Partial occurred, at most one, served next and answered.
  step("follow-up generated iff a Partial answer occurred (max 1)", followUpCount === (partialCount > 0 ? 1 : 0), `followUpCount=${followUpCount} partialAnswers=${partialCount} outcomes=${outcomes.join(" ")}`);
  if (AI_MOCK) {
    step("mock mode: deliberate Q2 Partial triggered exactly one follow-up, served next", followUpSeen === true, `followUpSeen=${followUpSeen} outcomes=${outcomes.join(" ")}`);
  } else {
    console.log(`  INFO  live mode: Q2 outcome was ${q2Outcome ?? "?"} — no outcome was forced to Partial; followUpCount=${followUpCount}`);
  }
  step("follow-up answered (when one was generated)", followUpCount === 0 || followUpAnswered === true, `followUpAnswered=${followUpAnswered}`);
  // Report is NOT available before finish (read-only GET — C14 fix).
  const early = await call("GET", `/api/assessments/interviews/${ivId}/report`, studentToken);
  step("report 404 before finish (GET never finalises)", early.status === 404, `HTTP ${early.status}`);
  const fin = await call("POST", `/api/assessments/interviews/${ivId}/session/finish`, studentToken, {});
  step("explicit finish saves the report", fin.status === 200 && typeof fin.json?.finalScore === "number" && fin.json?.perQuestion?.length === 7, `final=${fin.json?.finalScore}`);
  step("finished report records the follow-up consistently (count + nested answer)", fin.json?.followUpsUsed === followUpCount && (followUpCount === 0 || fin.json?.perQuestion?.find((q) => q.followUp)?.followUp?.answer != null), `followUpsUsed=${fin.json?.followUpsUsed} expected=${followUpCount}`);
  if (AI_MOCK) {
    step("mock mode: finished report records exactly 1 follow-up", fin.json?.followUpsUsed === 1, `followUpsUsed=${fin.json?.followUpsUsed}`);
  }
  const report = await call("GET", `/api/assessments/interviews/${ivId}/report`, studentToken);
  step("interview report readable after finish", report.status === 200 && typeof report.json?.finalScore === "number", `final=${report.json?.finalScore}`);

  // ── 10b. Final competency profile (Phase E) ──────────────────────────
  const compEarly = await call("GET", `/api/assessments/${asmId}/competency`, studentToken);
  step("competency profile 404 before compute", compEarly.status === 404, `HTTP ${compEarly.status}`);
  const compCompute = await call("POST", `/api/assessments/${asmId}/competency/compute`, studentToken, {});
  step("competency profile computes (fresh, 201)", compCompute.status === 201 && compCompute.json?.fresh === true && compCompute.json?.profile?.id, `HTTP ${compCompute.status} status=${compCompute.json?.profile?.status}`);
  step("competency profile has role + framework + 5 competencies + formula", compCompute.json?.profile?.roleId === "backend-developer" && compCompute.json?.profile?.frameworkVersion === "v1.0.0" && compCompute.json?.profile?.competencies?.length === 5 && compCompute.json?.profile?.formula === "S = C*0.50 + I*0.30 + E*0.20", `role=${compCompute.json?.profile?.roleId} status=${compCompute.json?.profile?.status}`);
  step("competency profile status is a valid safeguard state", ["Complete", "Incomplete", "Insufficient Evidence", "Practical Threshold Not Met"].includes(compCompute.json?.profile?.status), `status=${compCompute.json?.profile?.status}`);
  const compAgain = await call("POST", `/api/assessments/${asmId}/competency/compute`, studentToken, {});
  step("recompute is idempotent (200, same stored row)", compAgain.status === 200 && compAgain.json?.fresh === false && compAgain.json?.profile?.id === compCompute.json?.profile?.id, `HTTP ${compAgain.status}`);
  const compGet = await call("GET", `/api/assessments/${asmId}/competency`, studentToken);
  step("competency profile readable by owning candidate", compGet.status === 200 && compGet.json?.id === compCompute.json?.profile?.id, `HTTP ${compGet.status}`);

  // ── 10c. Question relevance + classification safeguards (P1 F5) ──────
  // The served questions were collected during §10 (one at a time, as
  // the server served them). The competency profile (computed above)
  // is the authority for the competency ids + names.
  const profileCompetencies = compCompute.json?.profile?.competencies ?? [];
  const profileCompetencyById = new Map(profileCompetencies.map((c) => [c.competencyId, c]));
  const servedOriginals = servedQuestions.filter((q) => !q.isFollowUp);
  const distinctCompetencies = new Set(servedOriginals.map((q) => q.competencyId));
  step("each served question carries a competency from the role profile", servedOriginals.length === 7 && servedOriginals.every((q) => q.competencyId && profileCompetencyById.has(q.competencyId)), `served=${servedOriginals.length} competencies=${[...distinctCompetencies].join(",")}`);
  step("at least 5 distinct competencies across the 7 questions", distinctCompetencies.size >= 5, `distinct=${distinctCompetencies.size}`);
  const servedTypes = new Set(servedOriginals.map((q) => q.questionType).filter(Boolean));
  step("all three question types present (project_specific / conceptual / engineering_scenario)", EXPECTED_QUESTION_TYPES.every((t) => servedTypes.has(t)), `types=${[...servedTypes].join(",")}`);
  // Competency–content match: in mock mode the deterministic questions
  // are built from the competency's own interview mapping, so the text
  // must contain one of that competency's domain keywords (substring
  // match — "normalis" covers normalise/normalisation). The
  // competency NAME alone is not enough: e.g. the Databases question
  // says "normalisation, indexing and transaction isolation" without
  // the words "databases" or "modelling", and the Testing question
  // says "debug" without "debugging". In live mode the model rewords
  // questions, so only the id mapping is asserted (never force a
  // wording match).
  const COMPETENCY_KEYWORDS = {
    "be-api-design": ["rest", "api", "endpoint", "status", "version"],
    "be-databases": ["database", "sql", "schema", "index", "normalis", "transaction", "table", "quer"],
    "be-server-logic": ["service", "server", "logic", "error", "class", "function", "code", "pattern"],
    "be-testing": ["test", "debug", "fail", "edge", "endpoint"],
    "be-system-design": ["system", "design", "scal", "cach", "queue", "traffic", "load"],
  };
  const relevanceOk = servedOriginals.every((q) => {
    const comp = profileCompetencyById.get(q.competencyId);
    if (!comp || typeof q.question !== "string" || q.question.length <= 10) return false;
    if (!AI_MOCK) return true;
    const keywords = COMPETENCY_KEYWORDS[q.competencyId] ?? [];
    const text = q.question.toLowerCase();
    return keywords.some((w) => text.includes(w));
  });
  step("each question's competency matches its content", relevanceOk, AI_MOCK ? "mock mode: a domain keyword for the competency is present in each question" : "live mode: competency id mapping only");
  // Classification safeguard (PARTIAL_INTERVIEW_POLICY): a profile
  // that is not fully verified must NOT carry a verified category —
  // and a pending evaluation anywhere in the interview must block
  // verification too. In this run the profile is provisional
  // (Insufficient Evidence), so the verified label must be absent.
  const compProf = compCompute.json?.profile;
  const safeguardOk = Boolean(
    compProf &&
    (compProf.isFinal
      ? compProf.status === "Complete" && typeof compProf.overallCategoryLabel === "string"
      : compProf.overallCategoryLabel === null && compProf.overallCategory === null) &&
    ((report.json?.pendingEvaluations ?? 0) === 0 || compProf.overallCategoryLabel === null),
  );
  step("classification safeguard: no verified category without full verification", safeguardOk, `status=${compProf?.status} isFinal=${compProf?.isFinal} overallCategoryLabel=${compProf?.overallCategoryLabel} pendingEvaluations=${report.json?.pendingEvaluations}`);

  // ── 11. Verified profile + monitoring ──────────────────────────────────
  const verified = await call("GET", "/api/assessments/profile/verified", studentToken);
  step("verified profile built", verified.status === 200 && verified.json?.verificationStatus, `status=${verified.json?.verificationStatus}`);
  step("verified skills only from passed tests", Array.isArray(verified.json?.verifiedSkills), `skills=${verified.json?.verifiedSkills?.length}`);
  const mon = await call("GET", `/api/assessments/${asmId}/monitoring`, studentToken);
  step("candidate monitoring status visible", mon.status === 200 && mon.json?.summary && mon.json?.assessmentStatus, `HTTP ${mon.status} status=${mon.json?.assessmentStatus}`);
  step("monitoring summary is neutral (no ability judgement)", !/poor|cheat/i.test(JSON.stringify(mon.json?.summary?.observations ?? [])), "");

  // ── 12. Recruiter flow: company → job → apply → report ─────────────────
  const recProf = await call("PUT", "/api/recruiter/profile", recruiterToken, {
    company_name: "E2E Corp", company_size: "1-10", company_location: "Bengaluru",
  });
  const companyId = recProf.json?.company?.id;
  step("recruiter company created", recProf.status === 200 && Boolean(companyId), `HTTP ${recProf.status}`);
  const job = await call("POST", "/api/jobs", recruiterToken, {
    company_id: companyId, title: "Backend Engineer (Fresher)", description: "Python backend role.", location: "Bengaluru", employment_type: "full_time",
  });
  step("recruiter posts job", job.status === 201 && job.json?.id, `HTTP ${job.status}`);
  const apply = await call("POST", `/api/jobs/${job.json?.id}/apply`, studentToken, {});
  step("student applies", apply.status === 201 || apply.status === 200, `HTTP ${apply.status}`);
  const monReport = await call("GET", `/api/assessments/${asmId}/monitoring/report`, recruiterToken);
  step("recruiter monitoring report (owns application)", monReport.status === 200 && monReport.json?.assessmentId === asmId, `HTTP ${monReport.status}`);
  step("report contains integrity findings", monReport.status === 200 && Array.isArray(monReport.json?.integrityFindings), `findings=${monReport.json?.integrityFindings?.length}`);
  const evSkills = await call("GET", `/api/assessments/verified-skills/${candidateId}`, recruiterToken);
  step("recruiter can inspect verified skills + evidence", evSkills.status === 200, `HTTP ${evSkills.status}`);
  const compRec = await call("GET", `/api/assessments/${asmId}/competency`, recruiterToken);
  step("recruiter can fetch the same competency profile (owns application)", compRec.status === 200 && compRec.json?.id === compCompute.json?.profile?.id, `HTTP ${compRec.status}`);

  // ── 12b. Recruiter competency dashboard (Phase F) ──────────────────────
  const evHistory = evSkills.json?.assessments ?? [];
  const evEntry = evHistory.find((h) => h.id === asmId);
  step("verified-skills carries assessment history with interview id + competency profile", evSkills.status === 200 && evEntry?.interviewId === ivId && evEntry?.competencyProfile?.id === compCompute.json?.profile?.id, `history=${evHistory.length}`);
  const ivRecReport = await call("GET", `/api/assessments/interviews/${ivId}/report`, recruiterToken);
  step("recruiter can fetch the interview report (owns application)", ivRecReport.status === 200 && typeof ivRecReport.json?.finalScore === "number" && Array.isArray(ivRecReport.json?.perQuestion), `final=${ivRecReport.json?.finalScore}`);
  const recApps = await call("GET", "/api/recruiter/applications", recruiterToken);
  const recApp = Array.isArray(recApps.json) ? recApps.json.find((r) => r.candidate_id === candidateId) : null;
  // P1 F5: the list mirrors the stored profile — including a null
  // verified category while the profile is provisional (the
  // provisional band is shown by the chip component, not by this
  // column; see the classification safeguard in §10c). Before the
  // P0/P1 stabilization the stored category carried the provisional
  // band, so this step used to require a string; now it requires
  // exact equality with the profile.
  step("recruiter applications list carries the competency chip fields", recApps.status === 200 && recApp?.competency_overall_score === compCompute.json?.profile?.overallScore && recApp?.competency_category === compCompute.json?.profile?.overallCategory && recApp?.competency_status === compCompute.json?.profile?.status, `score=${recApp?.competency_overall_score} category=${recApp?.competency_category} status=${recApp?.competency_status}`);
  const strangerEmail = `e2e-stranger-${RUN}@example.dev`;
  const regStranger = await call("POST", "/api/auth/register", null, {
    email: strangerEmail, password: "Test@1234", full_name: "E2E Stranger", role: "recruiter", company_name: "Other Corp",
  });
  const loginStranger = await call("POST", "/api/auth/login", null, { email: strangerEmail, password: "Test@1234" });
  const strangerToken = loginStranger.json?.accessToken ?? loginStranger.json?.token;
  step("second recruiter registers + logs in", regStranger.status === 201 && Boolean(strangerToken), `HTTP ${regStranger.status}`);
  const strangerEv = await call("GET", `/api/assessments/verified-skills/${candidateId}`, strangerToken);
  step("recruiter without an application is refused evidence (403)", strangerEv.status === 403, `HTTP ${strangerEv.status}`);
  const strangerComp = await call("GET", `/api/assessments/${asmId}/competency`, strangerToken);
  step("recruiter without an application is refused the competency profile (403)", strangerComp.status === 403, `HTTP ${strangerComp.status}`);
  const strangerIv = await call("GET", `/api/assessments/interviews/${ivId}/report`, strangerToken);
  step("recruiter without an application is refused the interview report (403)", strangerIv.status === 403, `HTTP ${strangerIv.status}`);

  const otherRec = await call("GET", `/api/assessments/${asmId}/monitoring/report`, studentToken);
  step("candidate cannot fetch recruiter report as candidate role", otherRec.status === 403, `HTTP ${otherRec.status}`);

  console.log(`\nE2E result: ${passed} passed, ${failed} failed${failures.length ? ` — failed: ${failures.join(", ")}` : ""}`);
  process.exit(failed ? 1 : 0);
}

main().catch((err) => {
  console.error("E2E crashed:", err);
  process.exit(1);
});
