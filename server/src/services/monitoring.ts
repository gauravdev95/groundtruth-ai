import { createHash } from "node:crypto";
import { pool } from "../config/db";

// ── Live assessment monitoring ─────────────────────────────────────────────
// Every event carries assessment_id, candidate_id, session_id, event_type,
// timestamp, file/action, metadata. Events are stored persistently (audit
// history) and drive the AI activity summary + integrity analysis.
// Privacy rules enforced here, not just in the UI:
//   - only events inside the assessment workspace are recorded;
//   - no webcam / microphone / keylogging / screenshots / browsing history;
//   - monitoring findings are review indicators, never proof of misconduct;
//   - typing speed, low activity, and frequent errors are NEVER treated as
//     poor engineering ability (see buildActivitySummary — they are reported
//     as neutral observations only).

export const EVENT_TYPES = [
  "assessment_started",
  "assessment_ended",
  "file_created",
  "file_modified",
  "file_deleted",
  "terminal_command",
  "test_run",
  "app_run",
  "compile_error",
  "submission_attempt",
  "ai_assistant_used",
  "tab_hidden",
  "tab_visible",
  "idle_start",
  "idle_end",
  "snapshot",
] as const;

export type EventType = (typeof EVENT_TYPES)[number];

export const MONITORING_CONSENT_VERSION = "v1";
export const MONITORING_COLLECTED = [
  "assessment start/end timestamps",
  "active coding duration and idle periods",
  "file creation, modification and deletion inside the assessment workspace",
  "code diffs between saved versions",
  "terminal commands and their results",
  "test execution history and results",
  "application execution logs and compilation errors",
  "submission attempts and timestamps",
  "AI assistant interactions inside the platform",
  "assessment tab visibility changes",
];
export const MONITORING_PURPOSE =
  "To evidence the engineering work behind an assessment, help recruiters understand how a solution was built, and generate a personalised interview. It is never used to auto-reject a candidate.";
export const MONITORING_RETENTION_DAYS = Number(
  process.env.MONITORING_RETENTION_DAYS ?? 90,
);
export const MONITORING_RECRUITER_VISIBILITY =
  "Recruiters see the monitoring report (durations, files changed, test history, timeline, AI-assistant usage disclosure, integrity status) only after submission. Raw keystrokes, terminal output beyond excerpts, and file contents outside the submitted snapshot are never shared.";

export interface AssessmentEventInput {
  assessmentId: string;
  candidateId: string;
  sessionId: string;
  eventType: string;
  filePath?: string | null;
  metadata?: Record<string, unknown>;
  clientEventId?: string | null;
}

export interface StoredEvent {
  id: string;
  assessment_id: string;
  candidate_id: string;
  session_id: string;
  event_type: string;
  file_path: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
}

function isUuid(v: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
}

/**
 * Record one event. Duplicate delivery (same client_event_id for the same
 * assessment) is ignored — the first write wins — so a reconnecting client
 * cannot double-count activity. Returns null on duplicate.
 */
export async function recordEvent(
  input: AssessmentEventInput,
): Promise<StoredEvent | null> {
  if (!isUuid(input.assessmentId) || !isUuid(input.candidateId)) {
    throw new Error("Invalid assessment or candidate id");
  }
  if (!input.sessionId || !input.eventType) {
    throw new Error("session_id and event_type are required");
  }
  const meta = { ...(input.metadata ?? {}) };
  // Defence: never store anything that looks like a secret or a file
  // outside the workspace.
  for (const key of Object.keys(meta)) {
    if (/api[_-]?key|secret|token|password/i.test(key)) delete meta[key];
  }
  const filePath =
    input.filePath && !input.filePath.includes("..") ? input.filePath : null;
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    if (input.clientEventId) {
      const dup = await client.query(
        `SELECT id FROM assessment_events
          WHERE assessment_id = $1 AND metadata->>'client_event_id' = $2 LIMIT 1`,
        [input.assessmentId, input.clientEventId],
      );
      if (dup.rows.length > 0) {
        await client.query("ROLLBACK");
        return null;
      }
      meta.client_event_id = input.clientEventId;
    }
    const res = await client.query(
      `INSERT INTO assessment_events
         (assessment_id, candidate_id, session_id, event_type, file_path, metadata)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
      [
        input.assessmentId,
        input.candidateId,
        input.sessionId,
        input.eventType,
        filePath,
        JSON.stringify(meta),
      ],
    );
    const row = res.rows[0] as StoredEvent;
    // Typed side tables for the events the report queries most.
    if (input.eventType === "file_created" || input.eventType === "file_modified" || input.eventType === "file_deleted") {
      await client.query(
        `INSERT INTO code_change_events (assessment_id, file_path, change_type, diff_summary)
         VALUES ($1, $2, $3, $4)`,
        [
          input.assessmentId,
          filePath ?? "",
          input.eventType.replace("file_", "") as string,
          JSON.stringify({
            linesAdded: (meta.lines_added as number | undefined) ?? null,
            linesRemoved: (meta.lines_removed as number | undefined) ?? null,
          }),
        ],
      );
    } else if (input.eventType === "terminal_command") {
      await client.query(
        `INSERT INTO terminal_execution_events
           (assessment_id, session_id, command, exit_code, duration_ms, output_excerpt)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [
          input.assessmentId,
          input.sessionId,
          String(meta.command ?? ""),
          (meta.exit_code as number | undefined) ?? null,
          (meta.duration_ms as number | undefined) ?? null,
          String(meta.output_excerpt ?? "").slice(0, 500),
        ],
      );
    } else if (input.eventType === "test_run") {
      await client.query(
        `INSERT INTO test_execution_events
           (assessment_id, session_id, test_command, passed, failed, total, results)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [
          input.assessmentId,
          input.sessionId,
          String(meta.test_command ?? ""),
          (meta.passed as number | undefined) ?? 0,
          (meta.failed as number | undefined) ?? 0,
          (meta.total as number | undefined) ?? 0,
          JSON.stringify(meta.results ?? []),
        ],
      );
    }
    await client.query("COMMIT");
    return row;
  } catch (err) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw err;
  } finally {
    client.release();
  }
}

export async function listEvents(
  assessmentId: string,
  opts: { limit?: number; eventType?: string } = {},
): Promise<StoredEvent[]> {
  const limit = Math.min(opts.limit ?? 500, 2000);
  const res = opts.eventType
    ? await pool.query(
        `SELECT * FROM assessment_events
          WHERE assessment_id = $1 AND event_type = $2
          ORDER BY created_at ASC LIMIT $3`,
        [assessmentId, opts.eventType, limit],
      )
    : await pool.query(
        `SELECT * FROM assessment_events
          WHERE assessment_id = $1 ORDER BY created_at ASC LIMIT $2`,
        [assessmentId, limit],
      );
  return res.rows as StoredEvent[];
}

export interface IdlePeriod {
  start: string;
  end: string;
  seconds: number;
}

/** Gaps between consecutive activity events longer than the threshold. */
export function computeIdlePeriods(
  events: { created_at: string; event_type: string }[],
  thresholdSeconds = 300,
): IdlePeriod[] {
  const activity = events
    .filter((e) => !["idle_start", "idle_end"].includes(e.event_type))
    .map((e) => new Date(e.created_at).getTime())
    .sort((a, b) => a - b);
  const idle: IdlePeriod[] = [];
  for (let i = 1; i < activity.length; i++) {
    const gap = (activity[i] - activity[i - 1]) / 1000;
    if (gap > thresholdSeconds) {
      idle.push({
        start: new Date(activity[i - 1]).toISOString(),
        end: new Date(activity[i]).toISOString(),
        seconds: Math.round(gap),
      });
    }
  }
  return idle;
}

export interface ActivitySummary {
  assessmentId: string;
  durationSeconds: number | null;
  activeSeconds: number | null;
  idlePeriods: IdlePeriod[];
  filesModified: string[];
  filesCreated: string[];
  filesDeleted: string[];
  terminalCommands: number;
  testRuns: { passed: number; failed: number; total: number; runs: number };
  compileErrors: number;
  submissionAttempts: number;
  aiAssistantInteractions: number;
  tabHiddenCount: number;
  observations: string[];
}

const ACTIVITY_TYPES = new Set([
  "file_created",
  "file_modified",
  "file_deleted",
  "terminal_command",
  "test_run",
  "app_run",
  "submission_attempt",
  "ai_assistant_used",
]);

/**
 * Deterministic activity summary from stored events only. Observations are
 * neutral and evidence-based: low activity or frequent errors are reported
 * as facts (counts + timestamps), never as a judgement of ability.
 */
export function buildActivitySummary(
  assessmentId: string,
  events: StoredEvent[],
): ActivitySummary {
  const sorted = [...events].sort(
    (a, b) =>
      new Date(a.created_at).getTime() - new Date(b.created_at).getTime(),
  );
  const start = sorted.find((e) => e.event_type === "assessment_started");
  const end = sorted.find((e) => e.event_type === "assessment_ended");
  const durationSeconds =
    start && end
      ? Math.max(
          0,
          Math.round(
            (new Date(end.created_at).getTime() -
              new Date(start.created_at).getTime()) /
              1000,
          ),
        )
      : null;
  const idle = computeIdlePeriods(sorted);
  const idleSeconds = idle.reduce((s, p) => s + p.seconds, 0);
  const filesModified = [
    ...new Set(
      sorted
        .filter((e) => e.event_type === "file_modified")
        .map((e) => e.file_path ?? "")
        .filter(Boolean),
    ),
  ];
  const filesCreated = [
    ...new Set(
      sorted
        .filter((e) => e.event_type === "file_created")
        .map((e) => e.file_path ?? "")
        .filter(Boolean),
    ),
  ];
  const filesDeleted = [
    ...new Set(
      sorted
        .filter((e) => e.event_type === "file_deleted")
        .map((e) => e.file_path ?? "")
        .filter(Boolean),
    ),
  ];
  const testRuns = sorted.filter((e) => e.event_type === "test_run");
  const testTotals = testRuns.reduce(
    (acc, e) => ({
      passed: acc.passed + Number(e.metadata.passed ?? 0),
      failed: acc.failed + Number(e.metadata.failed ?? 0),
      total: acc.total + Number(e.metadata.total ?? 0),
    }),
    { passed: 0, failed: 0, total: 0 },
  );
  const compileErrors = sorted.filter(
    (e) => e.event_type === "compile_error",
  ).length;
  const observations: string[] = [];
  if (testRuns.length > 0) {
    const last = testRuns[testRuns.length - 1];
    observations.push(
      `Tests were run ${testRuns.length} time(s); the last run passed ${Number(last.metadata.passed ?? 0)} of ${Number(last.metadata.total ?? 0)} tests.`,
    );
  } else {
    observations.push("No test runs were recorded during the assessment.");
  }
  if (compileErrors > 0) {
    observations.push(
      `${compileErrors} compilation error event(s) were recorded; repeated identical errors may indicate a stuck debugging loop (see the timeline for the exact errors).`,
    );
  }
  if (filesModified.length + filesCreated.length === 0) {
    observations.push("No files were changed during the assessment.");
  }
  const aiUses = sorted.filter(
    (e) => e.event_type === "ai_assistant_used",
  ).length;
  return {
    assessmentId,
    durationSeconds,
    activeSeconds:
      durationSeconds === null ? null : Math.max(0, durationSeconds - idleSeconds),
    idlePeriods: idle,
    filesModified,
    filesCreated,
    filesDeleted,
    terminalCommands: sorted.filter((e) => e.event_type === "terminal_command").length,
    testRuns: { ...testTotals, runs: testRuns.length },
    compileErrors,
    submissionAttempts: sorted.filter((e) => e.event_type === "submission_attempt").length,
    aiAssistantInteractions: aiUses,
    tabHiddenCount: sorted.filter((e) => e.event_type === "tab_hidden").length,
    observations,
  };
}

export interface IntegrityFindingInput {
  findingType: string;
  severity: "info" | "review" | "human_review";
  status: "no_issues" | "review_recommended" | "human_review_required";
  evidence: Record<string, unknown>;
}

/**
 * Evidence-based integrity analysis. Findings are review indicators with
 * supporting events/timestamps — never proof of misconduct, never an
 * automatic rejection. Checks (all deterministic):
 *  - files changed outside the permitted scope (paths outside the
 *    assessment workspace file list);
 *  - a submission snapshot whose hash does not match the files on record;
 *  - unexplained bulk change between consecutive snapshots;
 *  - sandbox bypass attempts recorded in terminal events.
 */
export function analyzeIntegrity(opts: {
  assessmentId: string;
  originalFiles: string[];
  snapshotFiles: string[];
  snapshotHash: string;
  expectedHash: string;
  events: StoredEvent[];
  snapshots: { hash: string; fileCount: number; createdAt: string }[];
}): IntegrityFindingInput[] {
  const findings: IntegrityFindingInput[] = [];
  const outOfScope = opts.snapshotFiles.filter(
    (f) => !opts.originalFiles.includes(f) && !f.startsWith("src/") && !f.startsWith("app/") && !f.startsWith("backend/") && !f.startsWith("tests/"),
  );
  if (outOfScope.length > 0) {
    findings.push({
      findingType: "out_of_scope_files",
      severity: "review",
      status: "review_recommended",
      evidence: {
        files: outOfScope.slice(0, 20),
        note: "Files outside the original project scope were added or modified.",
      },
    });
  }
  if (opts.snapshotHash !== opts.expectedHash) {
    findings.push({
      findingType: "snapshot_hash_mismatch",
      severity: "human_review",
      status: "human_review_required",
      evidence: {
        expected: opts.expectedHash,
        actual: opts.snapshotHash,
        note: "The stored snapshot hash does not match the recomputed hash of the recorded files.",
      },
    });
  }
  for (let i = 1; i < opts.snapshots.length; i++) {
    const prev = opts.snapshots[i - 1];
    const cur = opts.snapshots[i];
    if (cur.fileCount > prev.fileCount + 20) {
      findings.push({
        findingType: "bulk_change_between_snapshots",
        severity: "review",
        status: "review_recommended",
        evidence: {
          from: prev.createdAt,
          to: cur.createdAt,
          prevFiles: prev.fileCount,
          nextFiles: cur.fileCount,
          note: "A large number of files appeared between two consecutive snapshots.",
        },
      });
    }
  }
  const bypass = opts.events.filter(
    (e) =>
      e.event_type === "terminal_command" &&
      /curl|wget|nc\s|ssh|scp|docker/i.test(String(e.metadata.command ?? "")),
  );
  if (bypass.length > 0) {
    findings.push({
      findingType: "sandbox_bypass_attempt",
      severity: "human_review",
      status: "human_review_required",
      evidence: {
        events: bypass.slice(0, 10).map((e) => ({
          at: e.created_at,
          command: String(e.metadata.command ?? ""),
        })),
        note: "Terminal commands attempted network or host access, which the sandbox blocks.",
      },
    });
  }
  if (findings.length === 0) {
    findings.push({
      findingType: "no_issues",
      severity: "info",
      status: "no_issues",
      evidence: { note: "No integrity signals detected in the recorded events." },
    });
  }
  return findings;
}

export async function recordIntegrityFindings(
  assessmentId: string,
  findings: IntegrityFindingInput[],
): Promise<void> {
  for (const f of findings) {
    await pool.query(
      `INSERT INTO integrity_findings (assessment_id, finding_type, severity, status, evidence)
       VALUES ($1, $2, $3, $4, $5)`,
      [assessmentId, f.findingType, f.severity, f.status, JSON.stringify(f.evidence)],
    );
  }
}

export async function recordConsent(opts: {
  candidateId: string;
  assessmentId: string | null;
}): Promise<void> {
  await pool.query(
    `INSERT INTO monitoring_consent_records
       (candidate_id, assessment_id, consent_version, collected, purpose, retention_days, recruiter_visibility)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [
      opts.candidateId,
      opts.assessmentId,
      MONITORING_CONSENT_VERSION,
      MONITORING_COLLECTED,
      MONITORING_PURPOSE,
      MONITORING_RETENTION_DAYS,
      MONITORING_RECRUITER_VISIBILITY,
    ],
  );
}

/** Delete monitoring events older than the retention window for ended assessments. Returns rows deleted. */
export async function purgeOldEvents(): Promise<number> {
  const res = await pool.query(
    `DELETE FROM assessment_events
      WHERE created_at < now() - ($1 || ' days')::interval
        AND assessment_id IN (SELECT id FROM assessments WHERE status IN ('completed', 'failed', 'cancelled'))`,
    [String(MONITORING_RETENTION_DAYS)],
  );
  return res.rowCount ?? 0;
}

export function snapshotHash(files: Record<string, string>): string {
  const canonical = Object.keys(files)
    .sort()
    .map((k) => `${k}\n${files[k]}`)
    .join("\n");
  return createHash("sha256").update(canonical, "utf8").digest("hex");
}

export function activityEventsOf(events: StoredEvent[]): StoredEvent[] {
  return events.filter((e) => ACTIVITY_TYPES.has(e.event_type));
}
