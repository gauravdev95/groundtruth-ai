"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import dynamic from "next/dynamic";
import { Play, FlaskConical, Send, TerminalSquare } from "lucide-react";
import { RequireAuth } from "@/components/auth/RequireAuth";
import { StudentPageHead, StudentShell } from "@/components/student/StudentShell";
import {
  BackToHub,
  ErrorState,
  InlineError,
  LoadingState,
  StatusChip,
} from "@/components/assessment/shared";
import {
  evaluateAssessment,
  executionTerminalWsUrl,
  fetchAssessment,
  fetchChallenge,
  fetchEvaluation,
  fetchExecutionSession,
  fetchExecutionStatus,
  fetchAssessmentFiles,
  fetchMonitoring,
  postAssessmentEvent,
  runExecution,
  saveAssessmentFile,
  startAssessment,
  submitAssessment,
  testExecution,
  formatDateTime,
  formatDuration,
  toStrList as apiToStrList,
  type AssessmentDetail,
  type ChallengeRow,
  type MonitoringData,
  type RunResult,
  type SubmitResult,
} from "@/lib/api";

// Monaco only runs in the browser — never SSR it.
const Editor = dynamic(
  () => import("@monaco-editor/react").then((m) => m.Editor),
  {
    ssr: false,
    loading: () => (
      <div className="st-loading" role="status" aria-label="Loading editor">
        <span className="st-spinner" aria-hidden="true" />
        <p>Loading code editor…</p>
      </div>
    ),
  },
);

function languageFor(path: string): string {
  if (path.endsWith(".py")) return "python";
  if (path.endsWith(".ts") || path.endsWith(".tsx")) return "typescript";
  if (path.endsWith(".js") || path.endsWith(".jsx")) return "javascript";
  if (path.endsWith(".json")) return "json";
  if (path.endsWith(".md")) return "markdown";
  if (path.endsWith(".html")) return "html";
  if (path.endsWith(".css")) return "css";
  if (path.endsWith(".yml") || path.endsWith(".yaml")) return "yaml";
  return "plaintext";
}

/** Split a command line on whitespace (no shell quoting in the sandbox). */
function splitCommand(input: string): string[] {
  return input.trim().split(/\s+/).filter(Boolean);
}

function sessionIdFor(assessmentId: string): string {
  const key = `gt-lab-session-${assessmentId}`;
  const existing = window.sessionStorage.getItem(key);
  if (existing) return existing;
  const fresh = crypto.randomUUID();
  window.sessionStorage.setItem(key, fresh);
  return fresh;
}

interface TermLine {
  kind: "out" | "err" | "info";
  text: string;
}

const IDLE_AFTER_MS = 5 * 60 * 1000;

function LabContent() {
  const params = useParams<{ id: string }>();
  const id = params.id;
  const [detail, setDetail] = useState<AssessmentDetail | null>(null);
  const [challenge, setChallenge] = useState<ChallengeRow | null>(null);
  const [files, setFiles] = useState<Record<string, string>>({});
  const [contents, setContents] = useState<Record<string, string>>({});
  const [activeFile, setActiveFile] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);
  const [startError, setStartError] = useState<string | null>(null);
  const [sessionId, setSessionId] = useState<string>("");
  const [executionSessionId, setExecutionSessionId] = useState<string | null>(null);
  const [sandboxBackend, setSandboxBackend] = useState<string | null>(null);
  const [sandboxReason, setSandboxReason] = useState<string | null>(null);
  const [saveState, setSaveState] = useState<{ kind: "idle" | "saving" | "saved" | "error"; at?: string; msg?: string }>({ kind: "idle" });
  const [runCommand, setRunCommand] = useState("python3 main.py");
  const [runResult, setRunResult] = useState<RunResult | null>(null);
  const [testResult, setTestResult] = useState<RunResult | null>(null);
  const [execBusy, setExecBusy] = useState<"run" | "test" | null>(null);
  const [execError, setExecError] = useState<string | null>(null);
  const [termLines, setTermLines] = useState<TermLine[]>([]);
  const [termState, setTermState] = useState<"idle" | "connecting" | "connected" | "closed" | "failed">("idle");
  const [termCommand, setTermCommand] = useState("");
  const [monitoring, setMonitoring] = useState<MonitoringData | null>(null);
  const [remaining, setRemaining] = useState<number | null>(null);
  const [submitResult, setSubmitResult] = useState<SubmitResult | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [confirmSubmit, setConfirmSubmit] = useState(false);
  const [evalBusy, setEvalBusy] = useState(false);
  const [evalError, setEvalError] = useState<string | null>(null);
  const [evaluated, setEvaluated] = useState(false);

  const saveTimer = useRef<number | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const wsRetries = useRef(0);
  const lastActivity = useRef(Date.now());
  const idleActive = useRef(false);
  const sessionIdRef = useRef("");
  const activeFileRef = useRef<string | null>(null);
  activeFileRef.current = activeFile;

  const pushTerm = useCallback((line: TermLine) => {
    setTermLines((prev) => [...prev.slice(-199), line]);
  }, []);

  const refreshMonitoring = useCallback(async () => {
    try {
      const m = await fetchMonitoring(id);
      setMonitoring(m);
    } catch {
      // Monitoring is advisory — a failed refresh never blocks the Lab.
    }
  }, [id]);

  const loadActive = useCallback(async () => {
    const [f, exec, status] = await Promise.all([
      fetchAssessmentFiles(id),
      fetchExecutionSession(id).catch(() => null),
      fetchExecutionStatus(id).catch(() => null),
    ]);
    setFiles(f.files);
    setContents(f.files);
    const paths = Object.keys(f.files).sort();
    if (paths.length > 0) {
      setActiveFile((cur) => cur ?? paths[0]);
      const entry = paths.find((p) => p.endsWith("main.py")) ?? paths.find((p) => p.endsWith(".py"));
      if (entry) setRunCommand(`python3 ${entry}`);
    }
    if (exec) setExecutionSessionId(exec.id);
    if (status) {
      setSandboxBackend(status.sandboxBackend);
      setSandboxReason(status.reason);
    }
    await refreshMonitoring();
  }, [id, refreshMonitoring]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const sid = sessionIdFor(id);
      setSessionId(sid);
      sessionIdRef.current = sid;
      const d = await fetchAssessment(id);
      setDetail(d);
      setChallenge(d.challenge);
      if (d.status === "active") {
        await loadActive();
      } else if (["submitted", "evaluating", "completed"].includes(d.status)) {
        await loadActive().catch(() => undefined);
      }
      // Challenge may exist even when the detail call embedded none.
      if (!d.challenge) {
        const c = await fetchChallenge(id).catch(() => null);
        if (c) setChallenge(c);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load the Lab.");
    } finally {
      setLoading(false);
    }
  }, [id, loadActive]);

  useEffect(() => {
    load();
  }, [load]);

  // ── Countdown ────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!detail?.started_at) {
      setRemaining(null);
      return;
    }
    const tick = () => {
      const end =
        new Date(detail.started_at as string).getTime() +
        detail.time_limit_minutes * 60 * 1000;
      setRemaining(Math.max(0, Math.floor((end - Date.now()) / 1000)));
    };
    tick();
    const t = window.setInterval(tick, 1000);
    return () => window.clearInterval(t);
  }, [detail?.started_at, detail?.time_limit_minutes]);

  // ── Monitoring events: tab visibility + heartbeat + idle ────────────────
  // Server event types (EVENT_TYPES): "tab_hidden" / "tab_visible" for
  // visibility changes, "app_run" for the 60s heartbeat while visible.
  useEffect(() => {
    if (!detail || detail.status !== "active" || !sessionId) return;
    const sid = sessionId;
    const send = (eventType: string, metadata?: Record<string, unknown>) => {
      postAssessmentEvent(id, {
        sessionId: sid,
        eventType,
        filePath: activeFileRef.current,
        metadata,
      }).catch(() => undefined);
    };
    const onVisibility = () => {
      lastActivity.current = Date.now();
      if (document.hidden) {
        send("tab_hidden", { hidden: true });
      } else {
        send("tab_visible", { hidden: false });
      }
    };
    document.addEventListener("visibilitychange", onVisibility);
    const heartbeat = window.setInterval(() => {
      if (document.hidden) return;
      send("app_run", { heartbeat: true, file: activeFileRef.current });
    }, 60_000);
    const idleCheck = window.setInterval(() => {
      const idleFor = Date.now() - lastActivity.current;
      if (!idleActive.current && idleFor > IDLE_AFTER_MS && !document.hidden) {
        idleActive.current = true;
        send("idle_start", { idle_ms: idleFor });
      }
    }, 30_000);
    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      window.clearInterval(heartbeat);
      window.clearInterval(idleCheck);
    };
  }, [detail?.status, sessionId, id, detail]);

  // Monitoring summary refresh while active.
  useEffect(() => {
    if (!detail || detail.status !== "active") return;
    const t = window.setInterval(refreshMonitoring, 30_000);
    return () => window.clearInterval(t);
  }, [detail, detail?.status, refreshMonitoring]);

  // ── Live terminal WebSocket ──────────────────────────────────────────────
  useEffect(() => {
    if (!executionSessionId || detail?.status !== "active") return;
    const url = executionTerminalWsUrl(executionSessionId);
    if (!url) return;
    let closed = false;
    const connect = () => {
      setTermState("connecting");
      const ws = new WebSocket(url);
      wsRef.current = ws;
      ws.onopen = () => {
        pushTerm({ kind: "info", text: "Terminal connected. Type a command below or use Run / Test." });
      };
      ws.onmessage = (ev) => {
        try {
          const msg = JSON.parse(String(ev.data)) as Record<string, unknown>;
          if (msg.type === "ready") {
            setTermState("connected");
            ws.send(JSON.stringify({ type: "ping" }));
          } else if (msg.type === "pong") {
            // Keep-alive acknowledged — nothing to show.
          } else if (msg.type === "output") {
            if (typeof msg.stdout === "string" && msg.stdout) {
              pushTerm({ kind: "out", text: msg.stdout });
            }
            if (typeof msg.stderr === "string" && msg.stderr) {
              pushTerm({ kind: "err", text: msg.stderr });
            }
            if (typeof msg.exitCode === "number") {
              pushTerm({
                kind: msg.exitCode === 0 ? "info" : "err",
                text: `— exit code ${msg.exitCode}${msg.timedOut ? " (timed out)" : ""} in ${msg.durationMs ?? "?"} ms —`,
              });
            }
          } else if (msg.type === "error") {
            pushTerm({ kind: "err", text: `Terminal error: ${String(msg.error ?? "unknown error")}` });
          }
        } catch {
          pushTerm({ kind: "err", text: "Terminal sent a message that could not be read." });
        }
      };
      ws.onclose = () => {
        wsRef.current = null;
        if (closed) return;
        if (wsRetries.current < 1) {
          wsRetries.current += 1;
          pushTerm({ kind: "info", text: "Terminal disconnected — reconnecting once…" });
          window.setTimeout(() => {
            if (!closed) connect();
          }, 1500);
        } else {
          setTermState("closed");
          pushTerm({ kind: "info", text: "Terminal disconnected. Use the Run / Test buttons (REST) instead." });
        }
      };
      ws.onerror = () => {
        setTermState((s) => (s === "connected" ? s : "failed"));
      };
    };
    connect();
    return () => {
      closed = true;
      wsRef.current?.close();
      wsRef.current = null;
    };
  }, [executionSessionId, detail?.status, pushTerm]);

  // ── Autosave ─────────────────────────────────────────────────────────────
  const saveNow = useCallback(
    async (path: string, content: string) => {
      const sid = sessionIdRef.current;
      if (!sid || detail?.status !== "active") return;
      setSaveState({ kind: "saving" });
      try {
        await saveAssessmentFile(id, path, content, sid);
        setSaveState({
          kind: "saved",
          at: new Date().toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", second: "2-digit" }),
        });
        setFiles((prev) => ({ ...prev, [path]: content }));
      } catch (err) {
        setSaveState({ kind: "error", msg: err instanceof Error ? err.message : "Save failed." });
      }
    },
    [detail?.status, id],
  );

  const onEdit = useCallback(
    (value: string | undefined) => {
      if (activeFile === null || value === undefined) return;
      const path = activeFile;
      lastActivity.current = Date.now();
      if (idleActive.current) {
        idleActive.current = false;
        postAssessmentEvent(id, {
          sessionId: sessionIdRef.current,
          eventType: "idle_end",
          filePath: path,
        }).catch(() => undefined);
      }
      setContents((prev) => ({ ...prev, [path]: value }));
      if (saveTimer.current) window.clearTimeout(saveTimer.current);
      saveTimer.current = window.setTimeout(() => void saveNow(path, value), 900);
    },
    [activeFile, id, saveNow],
  );

  const switchFile = useCallback(
    (path: string) => {
      // Flush any pending autosave for the file we are leaving.
      if (saveTimer.current) {
        window.clearTimeout(saveTimer.current);
        saveTimer.current = null;
        if (activeFile !== null && contents[activeFile] !== files[activeFile]) {
          void saveNow(activeFile, contents[activeFile]);
        }
      }
      setActiveFile(path);
      lastActivity.current = Date.now();
    },
    [activeFile, contents, files, saveNow],
  );

  // ── Start / Run / Test / Submit ──────────────────────────────────────────
  async function onStart() {
    setStarting(true);
    setStartError(null);
    try {
      const res = await startAssessment(id, sessionIdRef.current);
      setDetail((d) => (d ? { ...d, ...res.assessment } : d));
      setSandboxBackend(res.sandboxBackend);
      setExecutionSessionId(res.executionSessionId);
      await loadActive();
    } catch (err) {
      setStartError(err instanceof Error ? err.message : "Could not start the Lab.");
    } finally {
      setStarting(false);
    }
  }

  async function onRun() {
    const command = splitCommand(runCommand);
    if (command.length === 0) {
      setExecError("Enter a command to run, e.g. “python3 main.py”.");
      return;
    }
    setExecBusy("run");
    setExecError(null);
    lastActivity.current = Date.now();
    try {
      const res = await runExecution(id, sessionIdRef.current, command);
      setRunResult(res);
      await refreshMonitoring();
    } catch (err) {
      setExecError(err instanceof Error ? err.message : "Run failed.");
    } finally {
      setExecBusy(null);
    }
  }

  async function onTest() {
    setExecBusy("test");
    setExecError(null);
    lastActivity.current = Date.now();
    try {
      const res = await testExecution(id, sessionIdRef.current);
      setTestResult(res);
      await refreshMonitoring();
    } catch (err) {
      setExecError(err instanceof Error ? err.message : "Tests failed to run.");
    } finally {
      setExecBusy(null);
    }
  }

  function onTerminalSend() {
    const command = splitCommand(termCommand);
    if (command.length === 0) return;
    if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) {
      pushTerm({ kind: "err", text: "Terminal is not connected — use the Run button instead." });
      return;
    }
    pushTerm({ kind: "info", text: `$ ${termCommand}` });
    wsRef.current.send(JSON.stringify({ type: "command", command }));
    setTermCommand("");
    lastActivity.current = Date.now();
  }

  async function onSubmit() {
    if (!confirmSubmit) {
      setConfirmSubmit(true);
      return;
    }
    setSubmitting(true);
    setSubmitError(null);
    try {
      const res = await submitAssessment(id, sessionIdRef.current);
      setSubmitResult(res);
      const d = await fetchAssessment(id);
      setDetail(d);
      await refreshMonitoring();
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : "Submission failed.");
      setConfirmSubmit(false);
    } finally {
      setSubmitting(false);
    }
  }

  async function onEvaluate() {
    setEvalBusy(true);
    setEvalError(null);
    try {
      await evaluateAssessment(id);
      setEvaluated(true);
      const d = await fetchAssessment(id);
      setDetail(d);
    } catch (err) {
      // "No evaluation yet" style 404s surface here honestly.
      const existing = await fetchEvaluation(id).catch(() => null);
      if (existing) {
        setEvaluated(true);
      } else {
        setEvalError(err instanceof Error ? err.message : "Evaluation failed.");
      }
    } finally {
      setEvalBusy(false);
    }
  }

  if (loading) return <LoadingState text="Loading the Lab…" />;
  if (error || !detail) {
    return <ErrorState message={error ?? "Something went wrong."} onRetry={load} />;
  }

  const isActive = detail.status === "active";
  const isEnded = ["submitted", "evaluating", "completed"].includes(detail.status);
  const sandboxDisabled = sandboxBackend === "disabled";
  const sortedFiles = Object.keys(files).sort();
  const remainingLabel =
    remaining === null
      ? null
      : remaining <= 0
        ? "Time is up — submit now"
        : `${String(Math.floor(remaining / 3600)).padStart(2, "0")}:${String(Math.floor((remaining % 3600) / 60)).padStart(2, "0")}:${String(remaining % 60).padStart(2, "0")}`;

  return (
    <div className="st-stack">
      <div className="as-lab-top">
        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          <StatusChip status={detail.status} />
          {sandboxBackend ? (
            <span className="st-chip">Sandbox: {sandboxBackend}</span>
          ) : null}
          {monitoring ? (
            <span className="st-chip st-chip-green">
              Monitoring {monitoring.status} · {monitoring.events.length} events
            </span>
          ) : null}
        </div>
        {remainingLabel !== null ? (
          <div
            className={`as-timer ${remaining !== null && remaining <= 300 ? "low" : ""}`}
            role="timer"
            aria-label="Time remaining"
          >
            {remainingLabel}
          </div>
        ) : (
          <div className="as-timer" aria-label="Time limit">
            {detail.time_limit_minutes} min limit
          </div>
        )}
      </div>

      {sandboxDisabled ? (
        <div className="as-alert as-alert-error" role="alert">
          <strong>Lab execution is BLOCKED.</strong> The server reports the
          sandbox backend as “disabled”
          {sandboxReason ? ` (${sandboxReason})` : ""} — Run, Test and the live
          terminal cannot execute code. The editor still saves, and submission
          will report whatever the server can do. Nothing here is faked.
        </div>
      ) : null}

      {/* Not started yet */}
      {!isActive && !isEnded ? (
        <section className="st-panel" aria-label="Start the Lab">
          <h2>Start the Lab</h2>
          {detail.status === "draft" ? (
            <p className="st-panel-desc">
              This assessment is still a draft — generate the challenge on the{" "}
              <Link href={`/assessment/${id}/challenge`} style={{ color: "var(--blue)", fontWeight: 700 }}>
                challenge page
              </Link>{" "}
              first.
            </p>
          ) : !detail.consent_given_at ? (
            <p className="st-panel-desc">
              Monitoring consent is required before the Lab can start. Give it on the{" "}
              <Link href={`/assessment/${id}/challenge`} style={{ color: "var(--blue)", fontWeight: 700 }}>
                challenge page
              </Link>
              .
            </p>
          ) : (
            <>
              <p className="st-panel-desc">
                The challenge is ready and consent is given. Starting opens the
                workspace ({detail.time_limit_minutes} minutes from now) and
                begins monitoring. The workspace starts from the demo project
                files.
              </p>
              {startError ? <InlineError message={startError} /> : null}
              <p style={{ marginTop: 16 }}>
                <button
                  type="button"
                  className="st-btn st-btn-blue"
                  onClick={onStart}
                  disabled={starting}
                >
                  <Play size={16} aria-hidden="true" />
                  {starting ? "Starting…" : "Start Lab"}
                </button>
              </p>
            </>
          )}
        </section>
      ) : null}

      {/* Submitted / ended */}
      {isEnded ? (
        <section className="st-panel" aria-label="Assessment submitted">
          <h2>Assessment submitted</h2>
          <p className="st-panel-desc">
            Submitted {formatDateTime(detail.submitted_at)}. The Lab is closed —
            files are read-only now.
          </p>
          {submitResult ? (
            <div className="st-grid st-grid-3" style={{ marginTop: 16 }}>
              <div>
                <p className="st-kv-label">Snapshot hash</p>
                <p><span className="as-code">{submitResult.snapshotHash}</span></p>
              </div>
              <div>
                <p className="st-kv-label">Visible tests</p>
                <p style={{ fontWeight: 700 }}>
                  {submitResult.visibleTests.passed} / {submitResult.visibleTests.total} passed
                </p>
              </div>
              <div>
                <p className="st-kv-label">Hidden tests</p>
                <p style={{ fontWeight: 700 }}>
                  {submitResult.hiddenTests.passed} / {submitResult.hiddenTests.total} passed
                </p>
              </div>
            </div>
          ) : null}
          <div style={{ display: "flex", gap: 10, marginTop: 18, flexWrap: "wrap" }}>
            {evaluated ? (
              <Link href={`/assessment/${id}/evaluation`} className="st-btn st-btn-blue">
                View evaluation
              </Link>
            ) : (
              <button type="button" className="st-btn st-btn-blue" onClick={onEvaluate} disabled={evalBusy}>
                {evalBusy ? "Evaluating…" : "Run evaluation"}
              </button>
            )}
            <Link href={`/assessment/${id}/interview`} className="st-btn st-btn-outline">
              Start AI interview
            </Link>
            <Link href={`/assessment/${id}/report`} className="st-btn st-btn-outline">
              Monitoring report
            </Link>
          </div>
          {evalError ? <InlineError message={evalError} /> : null}
        </section>
      ) : null}

      {/* Active Lab */}
      {isActive ? (
        <div className="as-lab">
          {challenge ? (
            <section className="st-panel" aria-label="Task instructions">
              <div className="st-panel-head">
                <div>
                  <h2>{challenge.title}</h2>
                  <p className="st-panel-desc">{challenge.problem_statement}</p>
                </div>
                <Link href={`/assessment/${id}/challenge`} className="st-btn st-btn-outline st-btn-sm">
                  Full challenge
                </Link>
              </div>
              {apiToStrList(challenge.acceptance_criteria).length > 0 ? (
                <>
                  <h3 style={{ marginTop: 14 }}>Acceptance criteria</h3>
                  <ul className="as-list">
                    {apiToStrList(challenge.acceptance_criteria).map((c, i) => (
                      <li key={i}>{c}</li>
                    ))}
                  </ul>
                </>
              ) : null}
            </section>
          ) : null}

          <div className="as-lab-grid">
            <section className="st-panel" aria-label="Files">
              <h3>Files</h3>
              {sortedFiles.length === 0 ? (
                <p className="st-panel-desc" style={{ marginTop: 8 }}>
                  No files yet — the workspace loads when the Lab starts.
                </p>
              ) : (
                <div className="as-file-tree" style={{ marginTop: 10 }} role="tablist" aria-label="Workspace files">
                  {sortedFiles.map((path) => (
                    <button
                      key={path}
                      type="button"
                      role="tab"
                      aria-selected={activeFile === path}
                      className={`as-file-btn ${activeFile === path ? "active" : ""}`}
                      onClick={() => switchFile(path)}
                    >
                      {path}
                    </button>
                  ))}
                </div>
              )}
              <p className="st-panel-desc" style={{ marginTop: 14 }}>
                {sortedFiles.length} file(s) · edits autosave.
              </p>
            </section>

            <section aria-label="Editor">
              <div className="as-editor-wrap">
                <div className="as-editor-head">
                  <span>{activeFile ?? "No file selected"}</span>
                  <span
                    className={`as-saved ${saveState.kind === "saving" ? "saving" : saveState.kind === "error" ? "error" : ""}`}
                    role="status"
                  >
                    {saveState.kind === "saving"
                      ? "Saving…"
                      : saveState.kind === "saved"
                        ? `Saved ${saveState.at ?? ""}`
                        : saveState.kind === "error"
                          ? `Save failed: ${saveState.msg ?? ""}`
                          : "All changes saved when you edit"}
                  </span>
                </div>
                {activeFile !== null ? (
                  <Editor
                    height="480px"
                    language={languageFor(activeFile)}
                    value={contents[activeFile] ?? ""}
                    onChange={onEdit}
                    options={{
                      minimap: { enabled: false },
                      fontSize: 13,
                      wordWrap: "on",
                      automaticLayout: true,
                      tabSize: 4,
                    }}
                  />
                ) : (
                  <p className="st-panel-desc" style={{ padding: 20 }}>
                    Select a file to edit it.
                  </p>
                )}
              </div>

              <div className="st-panel" style={{ marginTop: 16 }} aria-label="Run and test">
                <h3>Run &amp; test</h3>
                <label className="st-label" htmlFor="lab-run-command" style={{ display: "block", marginTop: 12 }}>
                  Run command
                </label>
                <div style={{ display: "flex", gap: 8, marginTop: 6, flexWrap: "wrap" }}>
                  <input
                    id="lab-run-command"
                    className="st-input"
                    style={{ flex: "1 1 220px" }}
                    value={runCommand}
                    onChange={(e) => setRunCommand(e.target.value)}
                    disabled={sandboxDisabled || execBusy !== null}
                    placeholder="python3 main.py"
                  />
                  <button
                    type="button"
                    className="st-btn st-btn-blue st-btn-sm"
                    onClick={onRun}
                    disabled={sandboxDisabled || execBusy !== null}
                  >
                    <Play size={15} aria-hidden="true" /> {execBusy === "run" ? "Running…" : "Run"}
                  </button>
                  <button
                    type="button"
                    className="st-btn st-btn-outline st-btn-sm"
                    onClick={onTest}
                    disabled={sandboxDisabled || execBusy !== null}
                  >
                    <FlaskConical size={15} aria-hidden="true" /> {execBusy === "test" ? "Testing…" : "Test"}
                  </button>
                </div>
                {sandboxDisabled ? (
                  <p className="st-panel-desc" style={{ marginTop: 8 }}>
                    Execution is disabled on the server, so Run and Test are unavailable.
                  </p>
                ) : null}
                {execError ? <InlineError message={execError} /> : null}
                {runResult ? (
                  <div style={{ marginTop: 14 }}>
                    <p className="st-kv-label">
                      Run output · exit {runResult.exitCode ?? "?"} · {runResult.durationMs} ms
                      {runResult.timedOut ? " · timed out" : ""}
                    </p>
                    <pre className="as-pre">{runResult.stdout || runResult.stderr || "(no output)"}</pre>
                    {runResult.stderr ? <pre className="as-pre">{runResult.stderr}</pre> : null}
                  </div>
                ) : null}
                {testResult?.parsed ? (
                  <div style={{ marginTop: 14 }}>
                    <p className="st-kv-label">
                      Tests · {testResult.parsed.passed} passed, {testResult.parsed.failed} failed,{" "}
                      {testResult.parsed.total} total
                    </p>
                    {testResult.parsed.failures.length > 0 ? (
                      <ul className="as-list">
                        {testResult.parsed.failures.map((f, i) => (
                          <li key={i} className="bad">{f}</li>
                        ))}
                      </ul>
                    ) : null}
                    <pre className="as-pre">{testResult.stdout || testResult.stderr || "(no output)"}</pre>
                  </div>
                ) : testResult ? (
                  <pre className="as-pre">{testResult.stdout || testResult.stderr || "(no output)"}</pre>
                ) : null}
              </div>

              <div className="st-panel" style={{ marginTop: 16 }} aria-label="Live terminal">
                <div className="st-panel-head">
                  <div>
                    <h3>Live terminal</h3>
                    <p className="st-panel-desc">
                      {termState === "connected"
                        ? "Connected — commands run in the same sandbox as Run."
                        : termState === "connecting"
                          ? "Connecting…"
                          : termState === "failed"
                            ? "Could not connect — use the Run / Test buttons instead."
                            : "Disconnected — use the Run / Test buttons instead."}
                    </p>
                  </div>
                  <span className="st-panel-icon" aria-hidden="true"><TerminalSquare size={20} /></span>
                </div>
                <div className="as-terminal" aria-live="polite" style={{ marginTop: 12 }}>
                  {termLines.length === 0 ? (
                    <span className="dim">Terminal output will appear here.</span>
                  ) : (
                    termLines.map((l, i) => (
                      <div key={i} className={l.kind === "err" ? "err" : l.kind === "info" ? "dim" : undefined}>
                        {l.text}
                      </div>
                    ))
                  )}
                </div>
                <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
                  <label htmlFor="lab-term-command" className="st-label" style={{ position: "absolute", left: -9999 }}>
                    Terminal command
                  </label>
                  <input
                    id="lab-term-command"
                    className="st-input"
                    style={{ flex: 1 }}
                    value={termCommand}
                    onChange={(e) => setTermCommand(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") onTerminalSend();
                    }}
                    disabled={sandboxDisabled || termState !== "connected"}
                    placeholder="e.g. python3 main.py"
                  />
                  <button
                    type="button"
                    className="st-btn st-btn-blue st-btn-sm"
                    onClick={onTerminalSend}
                    disabled={sandboxDisabled || termState !== "connected"}
                  >
                    <Send size={15} aria-hidden="true" /> Send
                  </button>
                </div>
              </div>

              <div className="st-panel" style={{ marginTop: 16 }} aria-label="Submit">
                <h3>Submit for evaluation</h3>
                <p className="st-panel-desc" style={{ marginTop: 6 }}>
                  Submitting snapshots your workspace, runs the visible and
                  hidden tests, and closes the Lab. Make sure your latest edits
                  are saved first.
                </p>
                {submitError ? <InlineError message={submitError} /> : null}
                <p style={{ marginTop: 14 }}>
                  <button
                    type="button"
                    className="st-btn st-btn-blue"
                    onClick={onSubmit}
                    disabled={submitting}
                  >
                    {submitting
                      ? "Submitting…"
                      : confirmSubmit
                        ? "Click again to confirm submission"
                        : "Submit assessment"}
                  </button>
                </p>
                {submitResult ? (
                  <div className="as-alert as-alert-success" style={{ marginTop: 12 }}>
                    <strong>Submitted.</strong> Snapshot{" "}
                    <span className="as-code">{submitResult.snapshotHash}</span> (version{" "}
                    {submitResult.snapshotVersion}) — visible tests{" "}
                    {submitResult.visibleTests.passed}/{submitResult.visibleTests.total} passed,
                    hidden tests {submitResult.hiddenTests.passed}/{submitResult.hiddenTests.total} passed.
                    <span style={{ display: "block", marginTop: 8 }}>
                      <Link href={`/assessment/${id}/evaluation`} style={{ color: "var(--blue)", fontWeight: 700 }}>
                        View evaluation →
                      </Link>
                    </span>
                  </div>
                ) : null}
              </div>
            </section>
          </div>

          {/* AI assistance + monitoring — labelled as monitoring data, no fake chat */}
          <section className="st-panel" aria-label="AI assistance and monitoring">
            <h2>AI assistance &amp; live monitoring</h2>
            <p className="st-panel-desc" style={{ marginTop: 6 }}>
              There is no AI chat in the Lab. What follows comes from the live
              monitoring summary for this assessment — it is the same data
              recruiters see after submission.
            </p>
            {monitoring ? (
              <div className="st-grid st-grid-3" style={{ marginTop: 16 }}>
                <div>
                  <p className="st-kv-label">Monitoring status</p>
                  <p style={{ fontWeight: 700 }}>{monitoring.status} · {monitoring.assessmentStatus}</p>
                </div>
                <div>
                  <p className="st-kv-label">Events recorded</p>
                  <p style={{ fontWeight: 700 }}>{monitoring.events.length}</p>
                </div>
                <div>
                  <p className="st-kv-label">Last saved</p>
                  <p style={{ fontWeight: 700 }}>
                    {saveState.kind === "saved" ? `Today at ${saveState.at ?? ""}` : "No save yet this session"}
                  </p>
                </div>
                <div>
                  <p className="st-kv-label">Active time</p>
                  <p style={{ fontWeight: 700 }}>{formatDuration(monitoring.summary.activeSeconds)}</p>
                </div>
                <div>
                  <p className="st-kv-label">Test runs</p>
                  <p style={{ fontWeight: 700 }}>
                    {monitoring.summary.testRuns.runs} run(s) ·{" "}
                    {monitoring.summary.testRuns.passed} passed /{" "}
                    {monitoring.summary.testRuns.failed} failed
                  </p>
                </div>
                <div>
                  <p className="st-kv-label">AI assistant interactions</p>
                  <p style={{ fontWeight: 700 }}>{monitoring.summary.aiAssistantInteractions}</p>
                </div>
              </div>
            ) : (
              <p className="st-panel-desc" style={{ marginTop: 12 }}>
                Monitoring summary is loading…
              </p>
            )}
            {monitoring?.summary.observations.map((o, i) => (
              <p key={i} className="st-panel-desc" style={{ marginTop: 8 }}>• {o}</p>
            ))}
            {monitoring && monitoring.integrity.length > 0 ? (
              <div style={{ marginTop: 12 }}>
                <h3>Integrity findings</h3>
                <ul className="as-list">
                  {monitoring.integrity.map((f, i) => (
                    <li key={i} className="bad">
                      {String(f.finding ?? f.type ?? "Finding")} — {String(f.status ?? f.severity ?? "")}
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
          </section>
        </div>
      ) : null}

      <div>
        <BackToHub />
      </div>
    </div>
  );
}

export default function AssessmentLabPage() {
  return (
    <RequireAuth roles={["candidate"]}>
      <StudentShell>
        <StudentPageHead
          eyebrow="Live Engineering Lab"
          title={<>The <span className="blue">Lab</span></>}
          sub="Edit, run and test your solution against the challenge. Activity is monitored and shown honestly — tab changes and idle time are recorded."
        />
        <LabContent />
      </StudentShell>
    </RequireAuth>
  );
}
