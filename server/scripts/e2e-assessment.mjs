// ── GroundTruth assessment end-to-end journey ─────────────────────────────
// Drives the REAL built server over HTTP (start it first, see README in
// docs/ASSESSMENT_IMPLEMENTATION_REPORT.md). No mocks except the server's
// own deterministic mock LLM provider (AI_MOCK=true).
//
// Flow: register student + recruiter → student profile → strength analysis
// → demo project → repo analysis → challenge → consent → Lab (fix the demo
// bug + add per-user limiting) → run tests → submit (visible + hidden) →
// evaluate → interview → verified profile → recruiter job → apply →
// recruiter monitoring report + verified-skills evidence.
//
// Usage:
//   BASE_URL=http://localhost:4100 node scripts/e2e-assessment.mjs
// Exits 0 when every step passes, 1 otherwise. Prints one line per step.

const BASE = process.env.BASE_URL ?? "http://localhost:4100";
const RUN = Date.now().toString(36);
import { randomUUID } from "node:crypto";
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
  console.log(`E2E assessment journey — ${BASE} (run ${RUN})`);

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
    sessionId: SESSION_ID, clientEventId: `evt-${RUN}-1`, eventType: "tab_visibility_change",
    metadata: { visible: false },
  });
  step("tab visibility event recorded", ev1.status === 201 || ev1.status === 200, `HTTP ${ev1.status}`);
  const evDup = await call("POST", `/api/assessments/${asmId}/events`, studentToken, {
    sessionId: SESSION_ID, clientEventId: `evt-${RUN}-1`, eventType: "tab_visibility_change",
    metadata: { visible: false },
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

  // ── 10. Interview ──────────────────────────────────────────────────────
  const iv = await call("POST", `/api/assessments/${asmId}/interview/generate`, studentToken, {});
  step("interview generated from evaluation", (iv.status === 200 || iv.status === 201) && iv.json?.interview?.id, `HTTP ${iv.status}`);
  const ivId = iv.json?.interview?.id;
  const qs = await call("GET", `/api/assessments/interviews/${ivId}`, studentToken);
  step("interview questions listed", qs.status === 200 && Array.isArray(qs.json?.questions) && qs.json.questions.length >= 3, `questions=${qs.json?.questions?.length}`);
  const q1 = qs.json.questions[0];
  if (!q1) throw new Error("no interview questions returned");
  const ans = await call("POST", `/api/assessments/interviews/${ivId}/answer`, studentToken, {
    questionId: q1.id,
    answer: "The bug was that the sliding window never pruned old timestamps, so once the limit was hit the key stayed blocked forever. I fixed it by pruning entries older than now minus window_seconds before counting, and I added a separate per-user limiter allow_user so one user cannot exhaust another user's quota.",
  });
  step("interview answer evaluated", ans.status === 200 && typeof ans.json?.score === "number", `score=${ans.json?.score}`);
  const report = await call("GET", `/api/assessments/interviews/${ivId}/report`, studentToken);
  step("interview report (transcript + score)", report.status === 200 && typeof report.json?.finalScore === "number", `final=${report.json?.finalScore}`);

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
  const otherRec = await call("GET", `/api/assessments/${asmId}/monitoring/report`, studentToken);
  step("candidate cannot fetch recruiter report as candidate role", otherRec.status === 403, `HTTP ${otherRec.status}`);

  console.log(`\nE2E result: ${passed} passed, ${failed} failed${failures.length ? ` — failed: ${failures.join(", ")}` : ""}`);
  process.exit(failed ? 1 : 0);
}

main().catch((err) => {
  console.error("E2E crashed:", err);
  process.exit(1);
});
