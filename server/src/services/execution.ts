import { execFile } from "node:child_process";
import { mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { ApiError } from "../middleware/errorHandler";

const execFileAsync = promisify(execFile);

// ── Isolated code execution ────────────────────────────────────────────────
// Backend: Linux user + network + mount + pid namespaces via `unshare`
// (Docker is NOT available in this environment — see detectSandbox()).
// The server runs as host root in this VM, so the namespace's inner root
// maps to host root: `setpriv` to nobody CANNOT work here (a single-UID
// user namespace cannot setuid to an unmapped UID, and /etc/subuid has no
// range for newuidmap). Isolation therefore comes from masking, not from
// the UID: inside the namespace the inner script bind-mounts the workspace
// aside, covers /tmp with a fresh tmpfs, re-exposes ONLY this workspace at
// its path, and masks /proc, /root, /home, /etc, /run, /var, /srv, /mnt and
// /opt with fresh tmpfs mounts — so candidate code cannot read the host's
// processes (no /proc/<server-pid>/environ leak), SSH keys, other
// candidates' workspaces, or any server file. /usr stays readable (the
// interpreters live there). On top of that:
//   - a fresh network namespace (only loopback, DOWN) → no network access;
//   - CPU / memory / file-size / process limits via prlimit, wall-clock
//     timeout via `timeout`;
//   - environment scrubbed (no secrets, no host vars) — only PATH/HOME;
//   - argv allowlist (see ALLOWED_COMMANDS) — no shell runs the candidate
//     command itself.
// detectSandbox() PROBES all of this before ever reporting "unshare": it
// runs the exact inner script with a verification program that asserts the
// masks hold (server pid absent from /proc, masked dirs empty, parent dir
// contains only the probe workspace, outbound connect fails). If any check
// fails, the backend is "disabled" and execution is DISABLED rather than
// falling back to running candidate code on the host.
// The workspace directory is created by the host and is the ONLY writable
// location. Nothing is mounted from production, no Docker socket exists
// here, and the app database is never reachable (no network).

export type SandboxBackend = "unshare" | "disabled";

export interface SandboxInfo {
  backend: SandboxBackend;
  reason: string;
}

export interface RunResult {
  stdout: string;
  stderr: string;
  exitCode: number | null;
  timedOut: boolean;
  durationMs: number;
  backend: SandboxBackend;
  command: string[];
}

const MAX_OUTPUT = 64 * 1024;

// Commands the candidate is allowed to run inside the sandbox. The first
// argv token must be on this list; everything else is rejected before any
// execution attempt. No shell is ever involved in running the candidate
// command itself (argv is passed through, single-quote escaped).
export const ALLOWED_COMMANDS = new Set([
  "python3",
  "python",
  "node",
  "pytest",
  "pip",
  "npm",
  "npx",
  "ls",
  "cat",
  "pwd",
  "sh",
  "bash",
]);

export function workspaceRoot(): string {
  return (
    process.env.EXECUTION_WORKSPACE_ROOT ??
    path.join(os.tmpdir(), "gt-assessment-workspaces")
  );
}

export function executionTimeoutMs(): number {
  const secs = Number(process.env.EXECUTION_TIMEOUT_SECONDS ?? 30);
  return (Number.isFinite(secs) && secs > 0 ? Math.min(secs, 120) : 30) * 1000;
}

let cachedProbe: SandboxInfo | null = null;

function shellQuote(arg: string): string {
  return `'${arg.replace(/'/g, `'\\''`)}'`;
}

/**
 * The inner `sh -c` script run inside the namespaces. It masks the host
 * filesystem before running the candidate command:
 *  1. bind the workspace aside at /mnt/wsbind (a path outside /tmp);
 *  2. fresh tmpfs over /tmp (covers the workspaces parent + host /tmp);
 *  3. fresh tmpfs $HOME at /tmp/home;
 *  4. re-expose ONLY this workspace at its original path;
 *  5. mask /proc /root /home /etc /run /var /srv /mnt /opt with tmpfs;
 *  6. run the command with a scrubbed environment.
 * Every mount is best-effort (`|| true`) so a single failing mount does
 * not kill the run — but detectSandbox() verifies the critical masks
 * actually hold before the backend is ever reported as "unshare".
 */
function buildInnerScript(workspaceDir: string, quotedCommand: string): string {
  const ws = shellQuote(workspaceDir);
  return [
    `WS=${ws}`,
    "mkdir -p /mnt/wsbind && mount --bind \"$WS\" /mnt/wsbind 2>/dev/null || true",
    "mount -t tmpfs tmpfs /tmp 2>/dev/null || true",
    "mkdir -p /tmp/home && mount -t tmpfs tmpfs /tmp/home 2>/dev/null || true",
    "mkdir -p \"$WS\" && mount --bind /mnt/wsbind \"$WS\" 2>/dev/null || true",
    "for d in /proc /root /home /etc /run /var /srv /mnt /opt; do mount -t tmpfs tmpfs \"$d\" 2>/dev/null || true; done",
    "cd \"$WS\" 2>/dev/null || true",
    `exec env -i PATH=/usr/local/bin:/usr/bin:/bin HOME=/tmp/home PYTHONDONTWRITEBYTECODE=1 ${quotedCommand}`,
  ].join(" && ");
}

/** Spawn the prlimit/timeout/unshare pipeline for one inner script. */
async function runUnshare(
  workspaceDir: string,
  inner: string,
  timeoutMs: number,
  memoryMb = 512,
  cpuSeconds = 30,
): Promise<{ stdout: string; stderr: string; exitCode: number | null }> {
  const argv = [
    "prlimit",
    `--cpu=${cpuSeconds}`,
    `--as=${memoryMb * 1024 * 1024}`,
    "--nproc=256",
    "--fsize=67108864",
    "timeout",
    "--signal=KILL",
    `${Math.ceil(timeoutMs / 1000)}`,
    "unshare",
    "--user",
    "--map-root-user",
    "--net",
    "--mount",
    "--pid",
    "--fork",
    "sh",
    "-c",
    inner,
  ];
  try {
    const { stdout, stderr } = await execFileAsync(argv[0], argv.slice(1), {
      cwd: workspaceDir,
      timeout: timeoutMs + 5000,
      maxBuffer: MAX_OUTPUT * 2,
      env: { PATH: "/usr/bin:/bin" },
    });
    return { stdout: String(stdout), stderr: String(stderr), exitCode: 0 };
  } catch (err) {
    const e = err as { code?: number | string; stdout?: string; stderr?: string };
    return {
      stdout: String(e.stdout ?? ""),
      stderr: String(e.stderr ?? ""),
      exitCode: typeof e.code === "number" ? e.code : null,
    };
  }
}

/**
 * Probe the REAL sandbox before trusting it. Runs the exact inner script
 * with a verification program that asserts: the host server pid is absent
 * from /proc, the masked dirs are empty, the workspaces parent contains
 * only the probe workspace, and an outbound TCP connect fails. Any failure
 * → backend "disabled" (fail closed).
 */
export async function detectSandbox(): Promise<SandboxInfo> {
  if (cachedProbe) return cachedProbe;
  // Explicit kill-switch: EXECUTION_SANDBOX=disabled fails closed even when
  // unshare works — code is never run unsandboxed (§8 of the master prompt).
  if ((process.env.EXECUTION_SANDBOX ?? "unshare").toLowerCase() === "disabled") {
    cachedProbe = {
      backend: "disabled",
      reason: "EXECUTION_SANDBOX=disabled (operator kill-switch)",
    };
    return cachedProbe;
  }
  const probeDir = path.join(workspaceRoot(), ".probe");
  try {
    await mkdir(probeDir, { recursive: true });
    await writeFile(path.join(probeDir, "canary.txt"), "probe\n", "utf8");
    const verify = [
      "import json, os, socket",
      `parent = ${JSON.stringify(workspaceRoot())}`,
      `base = ${JSON.stringify(path.basename(probeDir))}`,
      `server_pid = ${process.pid}`,
      "checks = {}",
      "checks['proc_hidden'] = not os.path.exists(f'/proc/{server_pid}')",
      "checks['root_empty'] = os.listdir('/root') == []",
      "checks['home_empty'] = os.listdir('/home') == []",
      "checks['etc_empty'] = os.listdir('/etc') == []",
      "checks['parent_only_probe'] = sorted(os.listdir(parent)) == [base]",
      "checks['canary_readable'] = open('canary.txt').read() == 'probe\\n'",
      "open('canary-write.txt', 'w').write('ok')",
      "checks['canary_writable'] = open('canary-write.txt').read() == 'ok'",
      "try:",
      "    s = socket.socket(); s.settimeout(2); s.connect(('8.8.8.8', 53)); checks['no_network'] = False",
      "except OSError:",
      "    checks['no_network'] = True",
      "print('PROBE ' + json.dumps(checks))",
    ].join("\n");
    const inner = buildInnerScript(probeDir, `python3 -c ${shellQuote(verify)}`);
    // One retry if the kernel momentarily refuses a fork (exit 125 from
    // `timeout` under fork pressure) — the verification itself must still
    // pass; a retry never papers over a failed check.
    let out = await runUnshare(probeDir, inner, 15000);
    if (out.exitCode === 125) {
      await new Promise((r) => setTimeout(r, 500));
      out = await runUnshare(probeDir, inner, 15000);
    }
    const m = (out.stdout + out.stderr).match(/PROBE (\{.*\})/);
    if (!m) {
      cachedProbe = {
        backend: "disabled",
        reason: `sandbox probe produced no verification output (exit=${out.exitCode}, stderr=${out.stderr.slice(0, 200)})`,
      };
    } else {
      const checks = JSON.parse(m[1]) as Record<string, boolean>;
      const failed = Object.entries(checks).filter(([, v]) => !v).map(([k]) => k);
      cachedProbe = failed.length
        ? { backend: "disabled", reason: `sandbox probe failed: ${failed.join(", ")}` }
        : { backend: "unshare", reason: "unshare user+net+mount+pid namespaces verified (masks + no network)" };
    }
  } catch (err) {
    cachedProbe = {
      backend: "disabled",
      reason: `sandbox probe error: ${(err as Error).message.slice(0, 200)}`,
    };
  } finally {
    await rm(probeDir, { recursive: true, force: true }).catch(() => undefined);
  }
  return cachedProbe;
}

export function validateCommand(command: string[]): void {
  if (!command.length) throw new ApiError(400, "Empty command");
  if (!ALLOWED_COMMANDS.has(command[0])) {
    throw new ApiError(400, `Command not allowed in the sandbox: ${command[0]}`);
  }
  // Arguments are passed to execFile as argv (no shell is ever involved),
  // so newlines, quotes, `;`, `&&` and friends inside one argument are
  // inert data — they cannot smuggle a second command. Only NUL bytes are
  // rejected (execve cannot carry them at all).
  for (const arg of command) {
    if (/\x00/.test(arg)) throw new ApiError(400, "Invalid argument");
  }
}

/** Create (or reset) a workspace directory. */
export async function prepareWorkspace(
  workspaceDir: string,
  files: Record<string, string>,
): Promise<void> {
  await rm(workspaceDir, { recursive: true, force: true });
  await mkdir(workspaceDir, { recursive: true });
  for (const [rel, content] of Object.entries(files)) {
    if (rel.includes("..") || path.isAbsolute(rel)) continue;
    const target = path.join(workspaceDir, rel);
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, content, "utf8");
  }
  // Files stay owned by the server user (root here) with explicit modes.
  // They must NOT be chowned to 65534: the runner is inner-root, whose
  // capabilities do not extend to the initial user namespace, so DAC
  // applies as a normal uid-0 — a 750 dir owned by 65534 would be
  // unreadable to it (verified: EACCES on bind-mounted workspace).
  // Root-owned 750/640 keeps the workspace private from other host users.
  await execFileAsync("chmod", ["750", workspaceDir]).catch(() => undefined);
}

/** Read back every file under a workspace (for diff/snapshot tracking). */
export async function readWorkspaceFiles(
  workspaceDir: string,
): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  async function walk(dir: string, prefix: string): Promise<void> {
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      const full = path.join(dir, e.name);
      const rel = prefix ? `${prefix}/${e.name}` : e.name;
      if (e.isDirectory()) {
        if (e.name === "__pycache__" || e.name === ".git") continue;
        await walk(full, rel);
      } else if (e.isFile()) {
        try {
          const content = await readFile(full, "utf8");
          if (content.length <= 512 * 1024) out[rel] = content;
        } catch {
          // Binary/unreadable files are skipped, never crash the read-back.
        }
      }
    }
  }
  await walk(workspaceDir, "");
  return out;
}

export async function runSandboxed(opts: {
  workspaceDir: string;
  command: string[];
  timeoutMs?: number;
  memoryMb?: number;
  cpuSeconds?: number;
}): Promise<RunResult> {
  const started = Date.now();
  const info = await detectSandbox();
  validateCommand(opts.command);
  if (info.backend === "disabled") {
    // No safe sandbox exists — refuse to run candidate code on the host.
    // This is a deliberate BLOCKED state, never a silent fallback.
    return {
      stdout: "",
      stderr: `Execution disabled: no safe sandbox is available (${info.reason}). Arbitrary code was not run.`,
      exitCode: null,
      timedOut: false,
      durationMs: Date.now() - started,
      backend: "disabled",
      command: opts.command,
    };
  }
  const timeoutMs = opts.timeoutMs ?? executionTimeoutMs();
  const memoryMb = opts.memoryMb ?? 512;
  const cpuSeconds = opts.cpuSeconds ?? 30;
  const quoted = opts.command.map(shellQuote).join(" ");
  const inner = buildInnerScript(opts.workspaceDir, quoted);
  const startedAt = Date.now();
  const out = await runUnshare(opts.workspaceDir, inner, timeoutMs, memoryMb, cpuSeconds);
  const timedOut = out.exitCode === 124;
  return {
    stdout: out.stdout.slice(0, MAX_OUTPUT),
    stderr: out.stderr.slice(0, MAX_OUTPUT),
    exitCode: out.exitCode,
    timedOut,
    durationMs: Date.now() - startedAt,
    backend: info.backend,
    command: opts.command,
  };
}
export interface ParsedTestOutput {
  passed: number;
  failed: number;
  total: number;
  failures: string[];
}

/** Deterministic parser for unittest / pytest output. Never invented. */
export function parseTestOutput(output: string): ParsedTestOutput {
  const failures: string[] = [];
  // unittest: "Ran 15 tests ... OK" / "FAILED (failures=1)"
  const ran = output.match(/Ran (\d+) tests?/);
  const ok = /OK\s*$/.test(output) || /\bOK\b/.test(output);
  const failMatch = output.match(/FAILED \(failures=(\d+)(?:, errors=(\d+))?\)/);
  // pytest: "1 failed, 14 passed" / "15 passed"
  const pytest = output.match(/(\d+) failed, (\d+) passed|(\d+) passed(?:, (\d+) failed)?/);
  let passed = 0;
  let failed = 0;
  if (failMatch) {
    failed = Number(failMatch[1]) + Number(failMatch[2] ?? 0);
    passed = ran ? Number(ran[1]) - failed : 0;
  } else if (pytest) {
    if (pytest[1] !== undefined) {
      failed = Number(pytest[1]);
      passed = Number(pytest[2]);
    } else {
      passed = Number(pytest[3]);
      failed = Number(pytest[4] ?? 0);
    }
  } else if (ran) {
    const total = Number(ran[1]);
    failed = ok ? 0 : total;
    passed = total - failed;
  }
  for (const m of output.matchAll(/^(?:FAIL|ERROR): (\S+).*/gm)) {
    failures.push(m[1]);
  }
  return { passed, failed, total: passed + failed, failures: failures.slice(0, 50) };
}
