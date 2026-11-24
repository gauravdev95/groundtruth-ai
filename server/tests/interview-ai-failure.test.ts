import test from "node:test";
import assert from "node:assert/strict";

// Phase C — AI evaluation failure (directive §12).
// Kept in its OWN file (own process) because it mutates process.env to
// point the LLM client at a dead endpoint: node:test runs top-level tests
// in a file concurrently, so the mutation would leak into other tests.
// No live AI is used anywhere: the "live" provider here is an
// unreachable local endpoint, so every call fails fast and honestly.

import { pool } from "../src/config/db";
import {
  submitSessionAnswer,
  scoreSessionAnswer,
} from "../src/services/interviewSession";
import { resetLlmRateLimit } from "../src/services/llm";
import { generateInterview } from "../src/services/interview";
import {
  startSession,
  confirmReadiness,
  getSessionState,
} from "../src/services/interviewSession";

const RUN = Date.now();

async function dbAvailable(): Promise<boolean> {
  try {
    await pool.query("SELECT 1");
    return true;
  } catch {
    return false;
  }
}


async function seedCandidate(tag: string): Promise<{
  userId: string;
  candidateId: string;
  assessmentId: string;
}> {
  const email = `phasec-${tag}-${RUN}@example.com`;
  const user = await pool.query(
    `INSERT INTO users (email, full_name, role, password_hash)
     VALUES ($1, $2, 'candidate', 'test-hash') RETURNING id`,
    [email, `Phase C ${tag}`],
  );
  const cand = await pool.query(
    `INSERT INTO candidates (user_id, full_name, email, target_roles)
     VALUES ($1, $2, $3, $4) RETURNING id`,
    [user.rows[0].id, `Phase C ${tag}`, email, ["Backend Developer"]],
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

function strongAnswer(expectedPoints: string[]): string {
  const rubric = expectedPoints[0] ?? "";
  return (
    `${rubric} For a concrete example from my own code, I applied this in the main implementation file ` +
    `for the challenge, changing how the project handles its core flow. I also weighed the trade-offs ` +
    `and edge cases, including failure modes and what I would test next before calling the work done.`
  );
}

// ── 8. AI failure handled safely ─────────────────────────────────────────

test("phase C: AI evaluation failure retains the answer with pending status — no fabricated score", async (t) => {
  if (!(await dbAvailable())) {
    t.skip("no Postgres reachable at DATABASE_URL");
    return;
  }
  // Point the LLM client at a dead local endpoint so the live call fails.
  const prev = {
    base: process.env.AI_API_BASE_URL,
    key: process.env.AI_API_KEY,
    model: process.env.AI_MODEL,
    mock: process.env.AI_MOCK,
    noProxy: process.env.NO_PROXY,
  };
  process.env.AI_API_BASE_URL = "http://127.0.0.1:1";
  process.env.AI_API_KEY = "test-key";
  process.env.AI_MODEL = "gpt-4o-mini";
  process.env.AI_MOCK = "false";
  process.env.NO_PROXY = "127.0.0.1,localhost";
  resetLlmRateLimit();
  t.after(() => {
    for (const [k, v] of Object.entries(prev)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  });

  const scored = await scoreSessionAnswer({
    question: "Explain REST API design.",
    answer: "A REST API exposes resources over HTTP with verbs and status codes.",
    expectedPoints: ["Resources, verbs and status codes."],
    contextTerms: [],
  });
  assert.equal(scored.status, "pending", "failed AI evaluation must be pending");
  assert.equal(scored.provider, "live");
  assert.ok(Object.values(scored.dimensions).every((v) => v === null), "no dimension scores substituted");
  assert.ok(scored.error, "failure recorded, not hidden");

  // End-to-end: a submit under failing AI stores the answer with null score.
  const seed = await seedCandidate("aifail");
  const gen = await generateInterview({
    assessmentId: seed.assessmentId,
    candidateId: seed.candidateId,
  });
  const interviewId = gen.interview.id as string;
  const questions = gen.questions;
  t.after(() => cleanupSeed({ ...seed, interviewId }));
  await startSession({ interviewId, candidateId: seed.candidateId });
  await confirmReadiness({ interviewId, candidateId: seed.candidateId, acknowledged: true });
  await getSessionState({ interviewId, candidateId: seed.candidateId });
  const r = await submitSessionAnswer({
    interviewId,
    candidateId: seed.candidateId,
    questionId: questions[0].id,
    answer: strongAnswer(questions[0].expected_points as string[]),
  });
  assert.equal(r.outcome, "pending");
  assert.equal(r.score, null);
  assert.equal(r.evaluation?.status, "pending");
  assert.equal(r.followUp, null, "no follow-up can be decided without a score");
  const stored = await pool.query(
    `SELECT answer, score, evaluation FROM interview_answers WHERE question_id = $1`,
    [questions[0].id],
  );
  assert.equal(stored.rows.length, 1, "answer retained");
  assert.equal(stored.rows[0].score, null);
  assert.equal((stored.rows[0].evaluation as { status: string }).status, "pending");
});


test("db: teardown closes the pool", async () => {
  await pool.end();
});
