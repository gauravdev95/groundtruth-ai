import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";

// P1 F2 (live question generation) + P1 F4 (timeout/retry config).
// Pure tests (bank + validator + timeout config) need no DB. The
// stub-server refine tests need Postgres: they follow the existing
// DB-test convention and SKIP when none is reachable. The stub is a
// local HTTP server (no external network, no real key); the "live"
// provider here is the stub, so every call is local and fast.
// Run ONLY this file: it mutates process.env AI_* vars.

import { pool } from "../src/config/db";
import { ApiError } from "../src/middleware/errorHandler";
import {
  buildPhaseCQuestions,
  validateRefinedQuestions,
  RefinedQuestionsValidationError,
  REFINED_QUESTIONS_SCHEMA_VERSION,
  pregenerateInterviewQuestions,
  generateInterview,
  loadAssessmentContext,
  resolveRoleForCandidate,
  type PreGeneratedQuestionSpec,
} from "../src/services/interview";
import { getFramework } from "../src/services/competencyScoringService";
import { FRAMEWORK_VERSION } from "../src/config/competencyFramework";
import {
  chatCompletion,
  getLlmConfig,
  llmWorstCaseBoundMs,
  retryBackoffDelayMs,
  getLlmUsageLog,
  clearLlmUsageLog,
  resetLlmRateLimit,
} from "../src/services/llm";

const RUN = Date.now();

async function dbAvailable(): Promise<boolean> {
  try {
    await pool.query("SELECT 1");
    return true;
  } catch {
    return false;
  }
}

// ── Deterministic bank ───────────────────────────────────────────────────

function backendRole() {
  return getFramework(FRAMEWORK_VERSION).roles.find(
    (r) => r.roleId === "backend-developer",
  )!;
}

function sampleCtx() {
  return {
    challengeTitle: "Add input validation to the orders API",
    changedFiles: ["src/orders.py", "src/validation.py"],
    failedTests: ["test_orders_rejects_bad_quantity"],
    passedTests: ["test_orders_happy_path"],
    weakAreas: ["SQL"],
    strengths: ["REST APIs"],
    overallScore: 72,
    technologies: ["FastAPI", "PostgreSQL", "Pytest"],
  };
}

test("bank: exactly 7 questions, >=5 distinct competencies, all 3 question types", () => {
  const qs = buildPhaseCQuestions(sampleCtx(), backendRole());
  assert.equal(qs.length, 7);
  assert.ok(new Set(qs.map((q) => q.competencyId)).size >= 5, ">=5 distinct competencies");
  const types = new Set(qs.map((q) => q.questionType));
  assert.deepEqual(
    [...types].sort(),
    ["conceptual", "engineering_scenario", "project_specific"],
    "all three question types present",
  );
  for (const q of qs) {
    assert.ok(q.competencyId);
    assert.ok(q.difficulty);
    assert.ok(q.expectedPoints.length >= 3);
    assert.ok(q.maxTimeSeconds > 0);
    assert.ok(q.scoringRubric && Object.keys(q.scoringRubric).length === 5);
    assert.equal(q.context.questionType, q.questionType);
  }
});

test("bank: no two questions share the same expected-points text", () => {
  const qs = buildPhaseCQuestions(sampleCtx(), backendRole());
  const joined = qs.map((q) => q.expectedPoints.join("\n"));
  assert.equal(new Set(joined).size, 7, "every question's expected points are distinct");
  // Also with no weak areas / no failed tests (the Q6==Q1/Q7 collision case).
  const plain = buildPhaseCQuestions(
    { ...sampleCtx(), weakAreas: [], failedTests: [] },
    backendRole(),
  );
  assert.equal(
    new Set(plain.map((q) => q.expectedPoints.join("\n"))).size,
    7,
    "distinct even without weak areas or failed tests",
  );
});

test("bank: each question's text + expected points match its competency", () => {
  const role = backendRole();
  const qs = buildPhaseCQuestions(sampleCtx(), role);
  for (const q of qs) {
    const comp = role.competencies.find((c) => c.id === q.competencyId)!;
    const haystack = `${q.question} ${q.expectedPoints.join(" ")}`.toLowerCase();
    const nameWords = comp.name.toLowerCase().split(/[^a-z]+/).filter((w) => w.length > 2);
    const skillWords = comp.skills.flatMap((s) => s.toLowerCase().split(/[^a-z]+/)).filter((w) => w.length > 2);
    const hits = [...nameWords, ...skillWords].filter((w) => haystack.includes(w));
    assert.ok(
      hits.length > 0,
      `${q.competencyId} question must mention its competency (${comp.name} / ${comp.skills.join(", ")}): ${q.question}`,
    );
  }
  // Spot checks: a DB question must actually test DB knowledge, a
  // system-design question must actually test system design.
  const db = qs.find((q) => q.competencyId === "be-databases")!;
  assert.match(`${db.question} ${db.expectedPoints.join(" ")}`.toLowerCase(), /normalis|index|sql|schema|transaction/);
  const sd = qs.find((q) => q.competencyId === "be-system-design")!;
  assert.match(`${sd.question} ${sd.expectedPoints.join(" ")}`.toLowerCase(), /cach|queue|scal|traffic|failure/);
});

test("bank: conceptual questions carry no project reference; project questions do", () => {
  const qs = buildPhaseCQuestions(sampleCtx(), backendRole());
  for (const q of qs) {
    if (q.questionType === "conceptual") assert.equal(q.projectReference, null);
    else assert.ok(q.projectReference, "project/scenario question must reference a real submitted file");
  }
});

// ── Refined-response validator ───────────────────────────────────────────

function draftSpecs(): PreGeneratedQuestionSpec[] {
  return buildPhaseCQuestions(sampleCtx(), backendRole());
}

function validRefined(specs: PreGeneratedQuestionSpec[]) {
  return {
    schemaVersion: REFINED_QUESTIONS_SCHEMA_VERSION,
    questions: specs.map((s) => ({
      competencyId: s.competencyId,
      question: `Refined wording for ${s.competencyId}: how would you approach this in your own project?`,
      questionType: s.questionType,
      projectReference: s.projectReference,
    })),
  };
}

test("validator: valid live-shaped response validates", () => {
  const specs = draftSpecs();
  const out = validateRefinedQuestions(validRefined(specs), specs);
  assert.equal(out.length, 7);
  assert.equal(out[0]?.competencyId, specs[0]?.competencyId);
  assert.equal(out[0]?.questionType, specs[0]?.questionType);
  assert.match(out[0]?.question ?? "", /Refined wording/);
});

test("validator: bare array fails (json_object mode cannot return an array)", () => {
  const specs = draftSpecs();
  assert.throws(
    () => validateRefinedQuestions(validRefined(specs).questions, specs),
    (e: unknown) =>
      e instanceof RefinedQuestionsValidationError &&
      (e.failure.errorCodes ?? []).includes("not_an_object"),
  );
});

test("validator: missing fields fail with structured field names", () => {
  const specs = draftSpecs();
  const bad = validRefined(specs) as Record<string, unknown>;
  const qs = bad.questions as Record<string, unknown>[];
  delete qs[2]?.question;
  assert.throws(
    () => validateRefinedQuestions(bad, specs),
    (e: unknown) =>
      e instanceof RefinedQuestionsValidationError &&
      e.failure.kind === "validation" &&
      (e.failure.missingFields ?? []).includes("questions[2].question") &&
      (e.failure.errorCodes ?? []).includes("missing_field"),
  );
});

test("validator: extra fields fail with structured field names", () => {
  const specs = draftSpecs();
  const bad = validRefined(specs) as Record<string, unknown>;
  const qs = bad.questions as Record<string, unknown>[];
  (qs[2] as Record<string, unknown>).surprise = "extra";
  assert.throws(
    () => validateRefinedQuestions(bad, specs),
    (e: unknown) =>
      e instanceof RefinedQuestionsValidationError &&
      (e.failure.extraFields ?? []).includes("questions[2].surprise") &&
      (e.failure.errorCodes ?? []).includes("extra_field"),
  );
});

test("validator: wrong types / wrong schema version / competency or type mismatch fail", () => {
  const specs = draftSpecs();
  const wrongType = validRefined(specs) as unknown as Record<string, unknown>;
  ((wrongType.questions as Record<string, unknown>[])[0] as Record<string, unknown>).question = 42;
  assert.throws(
    () => validateRefinedQuestions(wrongType, specs),
    (e: unknown) =>
      e instanceof RefinedQuestionsValidationError &&
      (e.failure.errorCodes ?? []).includes("question_too_short"),
  );
  const wrongVersion = { ...validRefined(specs), schemaVersion: "v999" };
  assert.throws(
    () => validateRefinedQuestions(wrongVersion, specs),
    (e: unknown) =>
      e instanceof RefinedQuestionsValidationError &&
      (e.failure.errorCodes ?? []).includes("schema_version_mismatch"),
  );
  const wrongComp = validRefined(specs);
  wrongComp.questions[1]!.competencyId = specs[0]!.competencyId;
  assert.throws(
    () => validateRefinedQuestions(wrongComp, specs),
    (e: unknown) =>
      e instanceof RefinedQuestionsValidationError &&
      (e.failure.errorCodes ?? []).includes("competency_mismatch"),
  );
  const wrongLen = validRefined(specs);
  wrongLen.questions = wrongLen.questions.slice(0, 6);
  assert.throws(
    () => validateRefinedQuestions(wrongLen, specs),
    (e: unknown) =>
      e instanceof RefinedQuestionsValidationError &&
      (e.failure.errorCodes ?? []).includes("wrong_length"),
  );
});

// ── F4: timeout / retry config ───────────────────────────────────────────

test("timeout: default is 120000 and is env-overridable", () => {
  const prev = process.env.AI_TIMEOUT_MS;
  delete process.env.AI_TIMEOUT_MS;
  try {
    assert.equal(getLlmConfig().timeoutMs, 120000);
  } finally {
    if (prev === undefined) delete process.env.AI_TIMEOUT_MS;
    else process.env.AI_TIMEOUT_MS = prev;
  }
  process.env.AI_TIMEOUT_MS = "5000";
  try {
    assert.equal(getLlmConfig().timeoutMs, 5000);
  } finally {
    if (prev === undefined) delete process.env.AI_TIMEOUT_MS;
    else process.env.AI_TIMEOUT_MS = prev;
  }
});

test("timeout: worst-case bound is attempts x timeout + jittered backoff", () => {
  // Defaults: 3 x 120000 + (500+500) + (1000+500) = 362500 ms.
  assert.equal(llmWorstCaseBoundMs(), 362500);
  assert.equal(getLlmConfig().worstCaseMs, 362500);
  assert.equal(getLlmConfig().maxAttempts, 3);
});

test("retry: backoff grows exponentially and stays inside the jitter band", () => {
  for (let i = 0; i < 20; i++) {
    const d1 = retryBackoffDelayMs(1);
    assert.ok(d1 >= 500 && d1 < 1000, `attempt 1 backoff ${d1} in [500,1000)`);
    const d2 = retryBackoffDelayMs(2);
    assert.ok(d2 >= 1000 && d2 < 1500, `attempt 2 backoff ${d2} in [1000,1500)`);
  }
});

// ── Stub-server tests (sequential subtests: they mutate AI_* env) ───────

type StubBehaviour =
  | { kind: "echo-refined" }
  | { kind: "invalid-shape" }
  | { kind: "status"; status: number }
  | { kind: "delay"; ms: number }
  | { kind: "fail-then-succeed" };

function startStub(behaviour: StubBehaviour): Promise<{ server: http.Server; port: number }> {
  let calls = 0;
  const server = http.createServer((req, res) => {
    let body = "";
    req.on("data", (c: Buffer) => {
      body += c.toString();
    });
    req.on("end", () => {
      calls++;
      const send = (content: string) => {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(
          JSON.stringify({
            choices: [{ message: { content } }],
            usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
          }),
        );
      };
      if (behaviour.kind === "status") {
        res.writeHead(behaviour.status, { "content-type": "application/json" });
        res.end(JSON.stringify({ error: "stub" }));
        return;
      }
      if (behaviour.kind === "delay") {
        setTimeout(() => send(JSON.stringify({ ok: true })), behaviour.ms);
        return;
      }
      if (behaviour.kind === "fail-then-succeed") {
        if (calls === 1) {
          res.writeHead(500, { "content-type": "application/json" });
          res.end(JSON.stringify({ error: "boom" }));
          return;
        }
        send("live answer");
        return;
      }
      // echo-refined / invalid-shape: refine from the draft in the request.
      let drafts: Array<Record<string, unknown>> = [];
      try {
        const parsed = JSON.parse(body) as Record<string, unknown>;
        const user = JSON.parse(String((parsed.messages as Array<Record<string, unknown>>)[1]?.content ?? "{}")) as Record<string, unknown>;
        drafts = (user.draftQuestions as Array<Record<string, unknown>>) ?? [];
      } catch {
        drafts = [];
      }
      if (behaviour.kind === "invalid-shape") {
        const questions = drafts.map((d, i) => {
          const q: Record<string, unknown> = {
            competencyId: d.competencyId,
            questionType: d.questionType,
            projectReference: d.projectReference,
          };
          if (i !== 2) q.question = `Refined wording for ${String(d.competencyId)}: explain this in your own words.`;
          if (i === 2) q.surprise = "an extra field the schema rejects";
          return q;
        });
        send(JSON.stringify({ schemaVersion: REFINED_QUESTIONS_SCHEMA_VERSION, questions }));
        return;
      }
      send(
        JSON.stringify({
          schemaVersion: REFINED_QUESTIONS_SCHEMA_VERSION,
          questions: drafts.map((d) => ({
            competencyId: d.competencyId,
            question: `Refined wording for ${String(d.competencyId)}: explain this in your own words, grounded in your project.`,
            questionType: d.questionType,
            projectReference: d.projectReference,
          })),
        }),
      );
    });
  });
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const addr = server.address();
      resolve({ server, port: typeof addr === "object" && addr ? addr.port : 0 });
    });
  });
}

function setLiveEnv(port: number, timeoutMs?: string): void {
  process.env.AI_MOCK = "false";
  process.env.AI_API_BASE_URL = `http://127.0.0.1:${port}`;
  process.env.AI_API_KEY = "test-key";
  process.env.AI_MODEL = "test-model";
  process.env.AI_RATE_LIMIT_PER_MIN = "1000";
  if (timeoutMs !== undefined) process.env.AI_TIMEOUT_MS = timeoutMs;
  else delete process.env.AI_TIMEOUT_MS;
  process.env.NO_PROXY = "127.0.0.1,localhost";
  resetLlmRateLimit();
  clearLlmUsageLog();
}

function restoreEnv(prev: Record<string, string | undefined>): void {
  for (const [k, v] of Object.entries(prev)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  resetLlmRateLimit();
  clearLlmUsageLog();
}

function snapshotEnv(): Record<string, string | undefined> {
  return {
    AI_MOCK: process.env.AI_MOCK,
    AI_API_BASE_URL: process.env.AI_API_BASE_URL,
    AI_API_KEY: process.env.AI_API_KEY,
    AI_MODEL: process.env.AI_MODEL,
    AI_RATE_LIMIT_PER_MIN: process.env.AI_RATE_LIMIT_PER_MIN,
    AI_TIMEOUT_MS: process.env.AI_TIMEOUT_MS,
    NO_PROXY: process.env.NO_PROXY,
  };
}

async function seedCandidate(tag: string): Promise<{
  userId: string;
  candidateId: string;
  assessmentId: string;
}> {
  const email = `qg-${tag}-${RUN}@example.com`;
  const user = await pool.query(
    `INSERT INTO users (email, full_name, role, password_hash)
     VALUES ($1, $2, 'candidate', 'test-hash') RETURNING id`,
    [email, `QG ${tag}`],
  );
  const cand = await pool.query(
    `INSERT INTO candidates (user_id, full_name, email, target_roles)
     VALUES ($1, $2, $3, $4) RETURNING id`,
    [user.rows[0].id, `QG ${tag}`, email, ["Backend Developer"]],
  );
  const asm = await pool.query(
    `INSERT INTO assessments (candidate_id, status) VALUES ($1, 'completed') RETURNING id`,
    [cand.rows[0].id],
  );
  return {
    userId: user.rows[0].id as string,
    candidateId: cand.rows[0].id as string,
    assessmentId: asm.rows[0].id as string,
  };
}

async function cleanupSeed(seed: {
  userId: string;
  candidateId: string;
  assessmentId: string;
  interviewId?: string;
}): Promise<void> {
  if (seed.interviewId) {
    await pool.query(`DELETE FROM interview_reports WHERE interview_id = $1`, [seed.interviewId]);
    await pool.query(`DELETE FROM interview_followups WHERE interview_id = $1`, [seed.interviewId]);
    await pool.query(
      `DELETE FROM interview_answers WHERE question_id IN
         (SELECT id FROM interview_questions WHERE interview_id = $1)`,
      [seed.interviewId],
    );
    await pool.query(`DELETE FROM interview_sessions WHERE interview_id = $1`, [seed.interviewId]);
    await pool.query(`DELETE FROM interview_questions WHERE interview_id = $1`, [seed.interviewId]);
    await pool.query(`DELETE FROM interviews WHERE id = $1`, [seed.interviewId]);
  }
  await pool.query(`DELETE FROM assessments WHERE id = $1`, [seed.assessmentId]);
  await pool.query(`DELETE FROM candidates WHERE id = $1`, [seed.candidateId]);
  await pool.query(`DELETE FROM users WHERE id = $1`, [seed.userId]);
}

test("llm stub: auth error (401) is distinct from timeout; usage log carries observability fields", async (t) => {
  // 401 → ApiError 401 naming authentication, never a 502 timeout.
  const prev = snapshotEnv();
  const { server, port } = await startStub({ kind: "status", status: 401 });
  try {
    setLiveEnv(port);
    await assert.rejects(
      chatCompletion({ system: "s", user: "u", operation: "probe-auth" }),
      (err: unknown) =>
        err instanceof ApiError && err.status === 401 && /authentication failed/i.test(err.message),
    );
    const log = getLlmUsageLog();
    assert.equal(log.length, 1);
    assert.equal(log[0]?.operation, "probe-auth");
    assert.equal(log[0]?.success, false);
    assert.equal(typeof log[0]?.durationMs, "number");
    assert.equal(log[0]?.retryCount, 0);
    assert.equal(JSON.stringify(log).includes("test-key"), false, "no key in the log");
  } finally {
    server.close();
    restoreEnv(prev);
  }

  // Slow stub + small timeout → 502 labelled as a timeout, with the budget.
  const prev2 = snapshotEnv();
  const slow = await startStub({ kind: "delay", ms: 800 });
  try {
    setLiveEnv(slow.port, "200");
    await assert.rejects(
      chatCompletion({ system: "s", user: "u", operation: "probe-timeout" }),
      (err: unknown) =>
        err instanceof ApiError &&
        err.status === 502 &&
        /timed out after 200ms/i.test(err.message),
    );
  } finally {
    slow.server.close();
    restoreEnv(prev2);
  }

  // 500 then success → retried once; usage log records the retry.
  const prev3 = snapshotEnv();
  const flaky = await startStub({ kind: "fail-then-succeed" });
  try {
    setLiveEnv(flaky.port);
    const r = await chatCompletion({ system: "s", user: "u", operation: "probe-retry" });
    assert.equal(r.provider, "live");
    assert.equal(r.text, "live answer");
    const log = getLlmUsageLog();
    assert.equal(log.length, 1);
    assert.equal(log[0]?.operation, "probe-retry");
    assert.equal(log[0]?.success, true);
    assert.equal(log[0]?.retryCount, 1);
    assert.ok((log[0]?.durationMs ?? -1) >= 0);
  } finally {
    flaky.server.close();
    restoreEnv(prev3);
  }
  await t.test("usage log: mock call still logs operation/success/retryCount", async () => {
    process.env.AI_MOCK = "true";
    process.env.AI_API_BASE_URL = "";
    process.env.AI_API_KEY = "";
    process.env.AI_MODEL = "";
    resetLlmRateLimit();
    clearLlmUsageLog();
    await chatCompletion({ system: "s", user: "secret-prompt-content", operation: "probe-mock" });
    const log = getLlmUsageLog();
    assert.equal(log[0]?.operation, "probe-mock");
    assert.equal(log[0]?.success, true);
    assert.equal(log[0]?.retryCount, 0);
    assert.equal(JSON.stringify(log).includes("secret-prompt-content"), false);
    restoreEnv(prev);
  });
});

test("refine via stub server (DB)", async (t) => {
  if (!(await dbAvailable())) {
    t.skip("no Postgres reachable at DATABASE_URL");
    return;
  }

  await t.test("valid live-shaped response validates and sets provider live", async () => {
    const prev = snapshotEnv();
    const { server, port } = await startStub({ kind: "echo-refined" });
    const seed = await seedCandidate("live");
    try {
      setLiveEnv(port);
      const out = await pregenerateInterviewQuestions({
        assessmentId: seed.assessmentId,
        candidateId: seed.candidateId,
      });
      assert.equal(out.generationProvider, "live");
      assert.equal(out.generationMethod, "llm");
      assert.equal(out.generationModel, "test-model");
      assert.equal(out.generationFailure, null);
      assert.equal(out.questions.length, 7);
      assert.ok(out.questions.every((q) => q.question.startsWith("Refined wording for")));
      // Expected points / competency / type are untouched by refinement.
      const actx = await loadAssessmentContext(seed.assessmentId);
      const { role: seedRole } = await resolveRoleForCandidate(seed.candidateId);
      const drafts = buildPhaseCQuestions(actx, seedRole);
      assert.deepEqual(
        out.questions.map((q) => q.expectedPoints),
        drafts.map((q) => q.expectedPoints),
      );
      const log = getLlmUsageLog();
      const entry = log.find((e) => e.operation === "interview-question-refine");
      assert.ok(entry, "refine call is in the usage log");
      assert.equal(entry?.success, true);
      assert.equal(entry?.retryCount, 0);
      assert.equal(typeof entry?.durationMs, "number");

      // generateInterview persists the live label + model on the questions.
      const gen = await generateInterview({
        assessmentId: seed.assessmentId,
        candidateId: seed.candidateId,
      });
      assert.equal(gen.generationProvider, "live");
      assert.equal(gen.generationModel, "test-model");
      assert.equal(gen.generationFailure, null);
      assert.equal(gen.questions.length, 7);
      const stored = await pool.query(
        `SELECT context FROM interview_questions WHERE interview_id = $1 ORDER BY question_order ASC`,
        [gen.interview.id],
      );
      assert.equal(stored.rows.length, 7);
      for (const row of stored.rows) {
        const ctx = row.context as Record<string, unknown>;
        assert.equal(ctx.generationProvider, "live");
        assert.equal(ctx.generationModel, "test-model");
        assert.equal(ctx.generationFailure, null);
        assert.equal(ctx.frameworkVersion, FRAMEWORK_VERSION);
      }
      // Idempotent second generate returns the stored live label.
      const again = await generateInterview({
        assessmentId: seed.assessmentId,
        candidateId: seed.candidateId,
      });
      assert.equal(again.interview.id, gen.interview.id);
      assert.equal(again.generationProvider, "live");
      seed.interviewId = gen.interview.id as string;
    } finally {
      server.close();
      restoreEnv(prev);
      await cleanupSeed(seed);
    }
  });

  await t.test("invalid refined shape fails validation with a recorded structured failure", async () => {
    const prev = snapshotEnv();
    const { server, port } = await startStub({ kind: "invalid-shape" });
    const seed = await seedCandidate("invalid");
    try {
      setLiveEnv(port);
      const out = await pregenerateInterviewQuestions({
        assessmentId: seed.assessmentId,
        candidateId: seed.candidateId,
      });
      assert.equal(out.generationProvider, "deterministic", "failed refine never claims live");
      assert.equal(out.generationMethod, "deterministic");
      assert.equal(out.generationModel, null);
      assert.ok(out.generationFailure, "failure recorded, not silent");
      assert.equal(out.generationFailure?.kind, "validation");
      assert.ok((out.generationFailure?.missingFields ?? []).includes("questions[2].question"));
      assert.ok((out.generationFailure?.extraFields ?? []).includes("questions[2].surprise"));
      assert.ok((out.generationFailure?.errorCodes ?? []).includes("missing_field"));
      assert.ok((out.generationFailure?.errorCodes ?? []).includes("extra_field"));
      assert.equal(typeof out.generationFailure?.durationMs, "number");
      // No question text or candidate info leaks into the failure record.
      assert.equal(JSON.stringify(out.generationFailure).includes("Refined wording"), false);
      assert.equal(out.questions.length, 7, "deterministic set still stands");
    } finally {
      server.close();
      restoreEnv(prev);
      await cleanupSeed(seed);
    }
  });

  await t.test("stub 401 records an auth failure, never a timeout", async () => {
    const prev = snapshotEnv();
    const { server, port } = await startStub({ kind: "status", status: 401 });
    const seed = await seedCandidate("auth");
    try {
      setLiveEnv(port);
      const out = await pregenerateInterviewQuestions({
        assessmentId: seed.assessmentId,
        candidateId: seed.candidateId,
      });
      assert.equal(out.generationProvider, "deterministic");
      assert.equal(out.generationFailure?.kind, "auth");
      assert.equal(out.generationFailure?.httpStatus, 401);
    } finally {
      server.close();
      restoreEnv(prev);
      await cleanupSeed(seed);
    }
  });

  await t.test("stub delay past the timeout records a timeout failure", async () => {
    const prev = snapshotEnv();
    const { server, port } = await startStub({ kind: "delay", ms: 800 });
    const seed = await seedCandidate("timeout");
    try {
      setLiveEnv(port, "200");
      const out = await pregenerateInterviewQuestions({
        assessmentId: seed.assessmentId,
        candidateId: seed.candidateId,
      });
      assert.equal(out.generationProvider, "deterministic");
      assert.equal(out.generationFailure?.kind, "timeout");
    } finally {
      server.close();
      restoreEnv(prev);
      await cleanupSeed(seed);
    }
  });

  await t.test("no live LLM configured records not_configured, labelled deterministic", async () => {
    const prev = snapshotEnv();
    const seed = await seedCandidate("nollm");
    try {
      process.env.AI_MOCK = "true";
      process.env.AI_API_BASE_URL = "";
      process.env.AI_API_KEY = "";
      process.env.AI_MODEL = "";
      resetLlmRateLimit();
      const out = await pregenerateInterviewQuestions({
        assessmentId: seed.assessmentId,
        candidateId: seed.candidateId,
      });
      assert.equal(out.generationProvider, "deterministic");
      assert.equal(out.generationMethod, "deterministic");
      assert.equal(out.generationModel, null);
      assert.equal(out.generationFailure?.kind, "not_configured");
      assert.equal(out.questions.length, 7);
    } finally {
      restoreEnv(prev);
      await cleanupSeed(seed);
    }
  });
});

test("db: teardown closes the pool", async () => {
  await pool.end();
});
