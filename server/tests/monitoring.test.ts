import test from "node:test";
import assert from "node:assert/strict";

// Live-assessment-monitoring tests (§9 + monitoring module A–J).
// DB tests run against DATABASE_URL (gt_assessment_test locally) and SKIP
// when no Postgres is reachable, like the other *.db tests. Pure-function
// tests (idle, hash, integrity) always run.
//
// Coverage map to the prompt's 15 monitoring tests:
//  1 event recording        → "records an event with all required fields"
//  2 WS reconnection        → covered by server/scripts/e2e-assessment.mjs
//                             ("WS terminal: reconnect works") — live server
//  3 duplicate handling     → "duplicate client_event_id is ignored"
//  4 ordering               → "listEvents returns chronological order"
//  5 file tracking          → "file events land in code_change_events"
//  6 terminal logging       → "terminal events land in terminal_execution_events"
//  7 test recording         → "test runs land in test_execution_events"
//  8 tab visibility         → "tab_hidden events are stored and counted"
//  9 idle detection         → "computeIdlePeriods finds long gaps only"
// 10 snapshot consistency   → "snapshotHash is deterministic" +
//                             "integrity flags a hash mismatch"
// 11 candidate isolation    → "events are scoped to their assessment"
// 12 recruiter authorization→ covered by e2e-assessment.mjs (403 for a
//                             candidate, 200 for the owning recruiter)
// 13 consent enforcement    → "consent is recorded before start" (+ the E2E
//                             409 on start-without-consent)
// 14 retention              → "purgeOldEvents deletes only old, ended rows"
// 15 end-to-end report      → "end-to-end: summary + integrity from events"
// Bonus: secrets are never stored in event metadata.

import { pool } from "../src/config/db";
import {
  recordEvent,
  listEvents,
  computeIdlePeriods,
  buildActivitySummary,
  analyzeIntegrity,
  recordConsent,
  purgeOldEvents,
  snapshotHash,
  type StoredEvent,
} from "../src/services/monitoring";

async function dbAvailable(): Promise<boolean> {
  try {
    await pool.query("SELECT 1");
    return true;
  } catch {
    return false;
  }
}

const RUN = `mon-${Date.now()}`;
let setupCount = 0;

/** Minimal user → candidate → assessment rows for the DB tests. */
async function setupAssessment(status = "active"): Promise<{
  candidateId: string;
  assessmentId: string;
  cleanup: () => Promise<void>;
}> {
  const suffix = `${RUN}-${++setupCount}`;
  const user = await pool.query(
    `INSERT INTO users (email, full_name, role, password_hash)
     VALUES ($1, $2, 'candidate', 'x') RETURNING id`,
    [`${suffix}@example.dev`, "Monitoring Tester"],
  );
  const userId = user.rows[0].id as string;
  const cand = await pool.query(
    `INSERT INTO candidates (user_id, email, full_name) VALUES ($1, $2, $3) RETURNING id`,
    [userId, `${suffix}@example.dev`, "Monitoring Tester"],
  );
  const candidateId = cand.rows[0].id as string;
  const asm = await pool.query(
    `INSERT INTO assessments (candidate_id, status) VALUES ($1, $2) RETURNING id`,
    [candidateId, status],
  );
  const assessmentId = asm.rows[0].id as string;
  return {
    candidateId,
    assessmentId,
    cleanup: async () => {
      await pool.query(`DELETE FROM assessments WHERE id = $1`, [assessmentId]);
      await pool.query(`DELETE FROM candidates WHERE id = $1`, [candidateId]);
      await pool.query(`DELETE FROM users WHERE id = $1`, [userId]);
    },
  };
}

function ev(
  overrides: Partial<StoredEvent> & { created_at: string; event_type: string },
): StoredEvent {
  return {
    id: "00000000-0000-0000-0000-000000000000",
    assessment_id: "00000000-0000-0000-0000-000000000000",
    candidate_id: "00000000-0000-0000-0000-000000000000",
    session_id: "sess",
    file_path: null,
    metadata: {},
    ...overrides,
  };
}

// ── DB-backed tests ────────────────────────────────────────────────────────

test("monitoring: records an event with all required fields", async (t) => {
  if (!(await dbAvailable())) return t.skip("no Postgres");
  const { candidateId, assessmentId, cleanup } = await setupAssessment();
  try {
    const stored = await recordEvent({
      assessmentId,
      candidateId,
      sessionId: "sess-1",
      eventType: "assessment_started",
      metadata: { sandbox_backend: "unshare" },
    });
    assert.ok(stored);
    assert.equal(stored.assessment_id, assessmentId);
    assert.equal(stored.candidate_id, candidateId);
    assert.equal(stored.session_id, "sess-1");
    assert.equal(stored.event_type, "assessment_started");
    assert.ok(stored.created_at);
  } finally {
    await cleanup();
  }
});

test("monitoring: duplicate client_event_id is ignored (second write returns null)", async (t) => {
  if (!(await dbAvailable())) return t.skip("no Postgres");
  const { candidateId, assessmentId, cleanup } = await setupAssessment();
  try {
    const first = await recordEvent({
      assessmentId, candidateId, sessionId: "sess-1",
      eventType: "file_modified", filePath: "backend/app/main.py",
      metadata: { lines_added: 3 }, clientEventId: `dup-${RUN}`,
    });
    const second = await recordEvent({
      assessmentId, candidateId, sessionId: "sess-1",
      eventType: "file_modified", filePath: "backend/app/main.py",
      metadata: { lines_added: 3 }, clientEventId: `dup-${RUN}`,
    });
    assert.ok(first);
    assert.equal(second, null);
    const rows = await pool.query(
      `SELECT count(*)::int AS n FROM assessment_events WHERE assessment_id = $1`,
      [assessmentId],
    );
    assert.equal(rows.rows[0].n, 1);
  } finally {
    await cleanup();
  }
});

test("monitoring: listEvents returns chronological order", async (t) => {
  if (!(await dbAvailable())) return t.skip("no Postgres");
  const { candidateId, assessmentId, cleanup } = await setupAssessment();
  try {
    for (const type of ["assessment_started", "file_modified", "test_run"]) {
      await recordEvent({ assessmentId, candidateId, sessionId: "sess-1", eventType: type });
    }
    const events = await listEvents(assessmentId);
    assert.deepEqual(
      events.map((e) => e.event_type),
      ["assessment_started", "file_modified", "test_run"],
    );
  } finally {
    await cleanup();
  }
});

test("monitoring: file events land in code_change_events", async (t) => {
  if (!(await dbAvailable())) return t.skip("no Postgres");
  const { candidateId, assessmentId, cleanup } = await setupAssessment();
  try {
    await recordEvent({
      assessmentId, candidateId, sessionId: "sess-1",
      eventType: "file_modified", filePath: "backend/app/rate_limiter.py",
      metadata: { lines_added: 10, lines_removed: 2 },
    });
    const rows = await pool.query(
      `SELECT file_path, change_type FROM code_change_events WHERE assessment_id = $1`,
      [assessmentId],
    );
    assert.equal(rows.rows.length, 1);
    assert.equal(rows.rows[0].file_path, "backend/app/rate_limiter.py");
    assert.equal(rows.rows[0].change_type, "modified");
  } finally {
    await cleanup();
  }
});

test("monitoring: terminal events land in terminal_execution_events", async (t) => {
  if (!(await dbAvailable())) return t.skip("no Postgres");
  const { candidateId, assessmentId, cleanup } = await setupAssessment();
  try {
    await recordEvent({
      assessmentId, candidateId, sessionId: "sess-1",
      eventType: "terminal_command",
      metadata: { command: "python3 -m unittest -v", exit_code: 0, duration_ms: 1200, output_excerpt: "OK" },
    });
    const rows = await pool.query(
      `SELECT command, exit_code FROM terminal_execution_events WHERE assessment_id = $1`,
      [assessmentId],
    );
    assert.equal(rows.rows.length, 1);
    assert.equal(rows.rows[0].command, "python3 -m unittest -v");
    assert.equal(rows.rows[0].exit_code, 0);
  } finally {
    await cleanup();
  }
});

test("monitoring: test runs land in test_execution_events", async (t) => {
  if (!(await dbAvailable())) return t.skip("no Postgres");
  const { candidateId, assessmentId, cleanup } = await setupAssessment();
  try {
    await recordEvent({
      assessmentId, candidateId, sessionId: "sess-1",
      eventType: "test_run",
      metadata: { test_command: "python3 -m unittest discover -s tests -v", passed: 14, failed: 1, total: 15, results: ["test_window_expires"] },
    });
    const rows = await pool.query(
      `SELECT passed, failed, total FROM test_execution_events WHERE assessment_id = $1`,
      [assessmentId],
    );
    assert.equal(rows.rows.length, 1);
    assert.deepEqual(
      [rows.rows[0].passed, rows.rows[0].failed, rows.rows[0].total],
      [14, 1, 15],
    );
  } finally {
    await cleanup();
  }
});

test("monitoring: tab_hidden events are stored and counted in the summary", async (t) => {
  if (!(await dbAvailable())) return t.skip("no Postgres");
  const { candidateId, assessmentId, cleanup } = await setupAssessment();
  try {
    await recordEvent({ assessmentId, candidateId, sessionId: "sess-1", eventType: "assessment_started" });
    await recordEvent({ assessmentId, candidateId, sessionId: "sess-1", eventType: "tab_hidden" });
    await recordEvent({ assessmentId, candidateId, sessionId: "sess-1", eventType: "tab_visible" });
    await recordEvent({ assessmentId, candidateId, sessionId: "sess-1", eventType: "tab_hidden" });
    const events = await listEvents(assessmentId);
    const summary = buildActivitySummary(assessmentId, events);
    assert.equal(summary.tabHiddenCount, 2);
  } finally {
    await cleanup();
  }
});

test("monitoring: events are scoped to their assessment (candidate isolation)", async (t) => {
  if (!(await dbAvailable())) return t.skip("no Postgres");
  const a = await setupAssessment();
  const b = await setupAssessment();
  try {
    await recordEvent({ assessmentId: a.assessmentId, candidateId: a.candidateId, sessionId: "s", eventType: "file_modified", filePath: "a.py" });
    await recordEvent({ assessmentId: b.assessmentId, candidateId: b.candidateId, sessionId: "s", eventType: "file_modified", filePath: "b.py" });
    const eventsA = await listEvents(a.assessmentId);
    const eventsB = await listEvents(b.assessmentId);
    assert.equal(eventsA.length, 1);
    assert.equal(eventsA[0].file_path, "a.py");
    assert.equal(eventsB.length, 1);
    assert.equal(eventsB[0].file_path, "b.py");
  } finally {
    await a.cleanup();
    await b.cleanup();
  }
});

test("monitoring: consent is recorded before start (v1, retention, visibility)", async (t) => {
  if (!(await dbAvailable())) return t.skip("no Postgres");
  const { candidateId, assessmentId, cleanup } = await setupAssessment();
  try {
    await recordConsent({ candidateId, assessmentId });
    const rows = await pool.query(
      `SELECT consent_version, retention_days, recruiter_visibility FROM monitoring_consent_records WHERE assessment_id = $1`,
      [assessmentId],
    );
    assert.equal(rows.rows.length, 1);
    assert.equal(rows.rows[0].consent_version, "v1");
    assert.equal(rows.rows[0].retention_days, 90);
    assert.ok(String(rows.rows[0].recruiter_visibility).length > 10);
  } finally {
    await cleanup();
  }
});

test("monitoring: purgeOldEvents deletes only old rows of ended assessments", async (t) => {
  if (!(await dbAvailable())) return t.skip("no Postgres");
  const ended = await setupAssessment("completed");
  const live = await setupAssessment("active");
  try {
    await recordEvent({ assessmentId: ended.assessmentId, candidateId: ended.candidateId, sessionId: "s", eventType: "file_modified", filePath: "old.py" });
    await recordEvent({ assessmentId: live.assessmentId, candidateId: live.candidateId, sessionId: "s", eventType: "file_modified", filePath: "new.py" });
    // Age the ended assessment's event past retention (90 days).
    await pool.query(
      `UPDATE assessment_events SET created_at = now() - interval '100 days' WHERE assessment_id = $1`,
      [ended.assessmentId],
    );
    const deleted = await purgeOldEvents();
    assert.ok(deleted >= 1, `expected >=1 deleted, got ${deleted}`);
    const leftEnded = await pool.query(
      `SELECT count(*)::int AS n FROM assessment_events WHERE assessment_id = $1`,
      [ended.assessmentId],
    );
    const leftLive = await pool.query(
      `SELECT count(*)::int AS n FROM assessment_events WHERE assessment_id = $1`,
      [live.assessmentId],
    );
    assert.equal(leftEnded.rows[0].n, 0);
    assert.equal(leftLive.rows[0].n, 1);
  } finally {
    await ended.cleanup();
    await live.cleanup();
  }
});

test("monitoring: secret-like metadata keys are never stored", async (t) => {
  if (!(await dbAvailable())) return t.skip("no Postgres");
  const { candidateId, assessmentId, cleanup } = await setupAssessment();
  try {
    const stored = await recordEvent({
      assessmentId, candidateId, sessionId: "sess-1",
      eventType: "terminal_command",
      metadata: { command: "echo hi", api_key: "sk-secret", token: "abc", password: "hunter2", note: "keep me" },
    });
    assert.ok(stored);
    assert.equal(stored.metadata.note, "keep me");
    assert.equal("api_key" in stored.metadata, false);
    assert.equal("token" in stored.metadata, false);
    assert.equal("password" in stored.metadata, false);
  } finally {
    await cleanup();
  }
});

// ── Pure-function tests (no DB) ────────────────────────────────────────────

test("monitoring: computeIdlePeriods finds long gaps only", () => {
  const base = new Date("2026-11-18T10:00:00Z").getTime();
  const at = (sec: number) => new Date(base + sec * 1000).toISOString();
  const idle = computeIdlePeriods([
    ev({ created_at: at(0), event_type: "file_modified" }),
    ev({ created_at: at(60), event_type: "file_modified" }),
    ev({ created_at: at(660), event_type: "terminal_command" }),
    ev({ created_at: at(700), event_type: "test_run" }),
  ]);
  assert.equal(idle.length, 1);
  assert.equal(idle[0].seconds, 600);
});

test("monitoring: snapshotHash is deterministic and order-independent", () => {
  const a = { "b.py": "print(1)", "a.py": "x = 1" };
  const b = { "a.py": "x = 1", "b.py": "print(1)" };
  const c = { "a.py": "x = 2", "b.py": "print(1)" };
  assert.equal(snapshotHash(a), snapshotHash(b));
  assert.notEqual(snapshotHash(a), snapshotHash(c));
  assert.match(snapshotHash(a), /^[0-9a-f]{64}$/);
});

test("monitoring: integrity flags a hash mismatch as human review required", () => {
  const findings = analyzeIntegrity({
    assessmentId: "x",
    originalFiles: ["backend/app/main.py"],
    snapshotFiles: ["backend/app/main.py"],
    snapshotHash: "deadbeef",
    expectedHash: "cafebabe",
    events: [],
    snapshots: [],
  });
  assert.equal(findings.length, 1);
  assert.equal(findings[0].findingType, "snapshot_hash_mismatch");
  assert.equal(findings[0].status, "human_review_required");
});

test("monitoring: integrity detects out-of-scope files, bypass attempts, bulk change", () => {
  const findings = analyzeIntegrity({
    assessmentId: "x",
    originalFiles: ["backend/app/main.py"],
    snapshotFiles: ["backend/app/main.py", "/etc/passwd"],
    snapshotHash: "same",
    expectedHash: "same",
    events: [
      ev({ created_at: new Date().toISOString(), event_type: "terminal_command", metadata: { command: "curl https://evil.example" } }),
    ],
    snapshots: [
      { hash: "h1", fileCount: 3, createdAt: "2026-11-18T10:00:00Z" },
      { hash: "h2", fileCount: 30, createdAt: "2026-11-18T10:05:00Z" },
    ],
  });
  const types = findings.map((f) => f.findingType);
  assert.ok(types.includes("out_of_scope_files"));
  assert.ok(types.includes("sandbox_bypass_attempt"));
  assert.ok(types.includes("bulk_change_between_snapshots"));
  assert.ok(findings.some((f) => f.status === "human_review_required"));
});

test("monitoring: clean run yields a single no_issues finding (never an auto-reject)", () => {
  const findings = analyzeIntegrity({
    assessmentId: "x",
    originalFiles: ["backend/app/main.py", "tests/test_main.py"],
    snapshotFiles: ["backend/app/main.py", "tests/test_main.py"],
    snapshotHash: "same",
    expectedHash: "same",
    events: [],
    snapshots: [{ hash: "h1", fileCount: 2, createdAt: "2026-11-18T10:00:00Z" }],
  });
  assert.equal(findings.length, 1);
  assert.equal(findings[0].status, "no_issues");
});

test("monitoring: end-to-end summary + integrity from a recorded event stream", async (t) => {
  if (!(await dbAvailable())) return t.skip("no Postgres");
  const { candidateId, assessmentId, cleanup } = await setupAssessment();
  try {
    const t0 = new Date("2026-11-18T10:00:00Z");
    const at = (sec: number) => new Date(t0.getTime() + sec * 1000).toISOString();
    // Record a realistic stream, then re-read it and summarise.
    await recordEvent({ assessmentId, candidateId, sessionId: "s", eventType: "assessment_started" });
    await recordEvent({ assessmentId, candidateId, sessionId: "s", eventType: "file_modified", filePath: "backend/app/rate_limiter.py", metadata: { lines_added: 12 } });
    await recordEvent({ assessmentId, candidateId, sessionId: "s", eventType: "terminal_command", metadata: { command: "python3 -m unittest -v", exit_code: 1 } });
    await recordEvent({ assessmentId, candidateId, sessionId: "s", eventType: "test_run", metadata: { test_command: "unittest", passed: 14, failed: 1, total: 15 } });
    await recordEvent({ assessmentId, candidateId, sessionId: "s", eventType: "submission_attempt", metadata: { version: 1 } });
    const events = await listEvents(assessmentId);
    assert.equal(events.length, 5);
    const summary = buildActivitySummary(assessmentId, events);
    assert.deepEqual(summary.filesModified, ["backend/app/rate_limiter.py"]);
    assert.equal(summary.terminalCommands, 1);
    assert.deepEqual(summary.testRuns, { passed: 14, failed: 1, total: 15, runs: 1 });
    assert.equal(summary.submissionAttempts, 1);
    assert.equal(summary.observations.length > 0, true);
    // Neutral observations only — never a judgement of ability.
    assert.equal(/poor|cheat|bad/i.test(summary.observations.join(" ")), false);
    const files = snapshotHash({ "backend/app/rate_limiter.py": "fixed" });
    const findings = analyzeIntegrity({
      assessmentId,
      originalFiles: ["backend/app/rate_limiter.py"],
      snapshotFiles: ["backend/app/rate_limiter.py"],
      snapshotHash: files,
      expectedHash: files,
      events,
      snapshots: [],
    });
    assert.equal(findings[0].status, "no_issues");
  } finally {
    await cleanup();
  }
});
