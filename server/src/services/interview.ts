import { pool } from "../config/db";
import { ApiError } from "../middleware/errorHandler";
import { chatJson, llmConfigured } from "./llm";
import { loadAssessmentById } from "./assessments";
import { getEvaluation } from "./evaluation";
import { listEvents } from "./monitoring";

// ── Personalised AI technical interview ────────────────────────────────────
// Generated AFTER the coding assessment is evaluated, from the candidate's
// real data: original project, repo architecture, original code, actual
// code changes, challenge, passed/failed tests, evaluation report, skills,
// weak areas. Categories A–H. Adaptive: the next question depends on the
// previous answer. Interview score is SEPARATE from the coding score.
// Accent/grammar/language proficiency are never penalised — evaluation is
// about engineering knowledge only.

export const INTERVIEW_CATEGORIES = [
  "project_understanding",
  "architecture_design",
  "code_changes",
  "fundamentals",
  "debugging",
  "security_performance",
  "testing_edge_cases",
  "follow_up",
] as const;

export type InterviewCategory = (typeof INTERVIEW_CATEGORIES)[number];

export interface InterviewQuestionRow {
  id: string;
  interview_id: string;
  category: string;
  question: string;
  question_order: number;
  created_at: string;
}

export interface InterviewRow {
  id: string;
  candidate_id: string;
  assessment_id: string | null;
  status: string;
  score: number | null;
  transcript: string | null;
  report: Record<string, unknown> | null;
  created_at: string;
}

interface AssessmentContext {
  challengeTitle: string;
  changedFiles: string[];
  failedTests: string[];
  passedTests: string[];
  weakAreas: string[];
  strengths: string[];
  overallScore: number | null;
  technologies: string[];
}

async function loadContext(assessmentId: string): Promise<AssessmentContext> {
  const assessment = await loadAssessmentById(assessmentId);
  const challenge = await pool.query(
    `SELECT title, required_functionality FROM challenges WHERE assessment_id = $1`,
    [assessmentId],
  );
  const evaluation = await getEvaluation(assessmentId);
  const original = await pool.query(
    `SELECT files FROM code_snapshots WHERE assessment_id = $1 AND version = 0`,
    [assessmentId],
  );
  const latest = await pool.query(
    `SELECT files FROM code_snapshots WHERE assessment_id = $1 ORDER BY version DESC LIMIT 1`,
    [assessmentId],
  );
  const originalFiles = (original.rows[0]?.files as Record<string, string> | undefined) ?? {};
  const latestFiles = (latest.rows[0]?.files as Record<string, string> | undefined) ?? {};
  const changedFiles = Object.keys(latestFiles).filter(
    (k) => latestFiles[k] !== originalFiles[k],
  );
  const technologies = new Set<string>();
  for (const content of Object.values(latestFiles)) {
    for (const m of content.matchAll(/import\s+(\w+)|from\s+(\w+)\s+import|require\(['"]([\w-]+)['"]\)/g)) {
      const name = m[1] ?? m[2] ?? m[3];
      if (name) technologies.add(name);
    }
  }
  return {
    challengeTitle: (challenge.rows[0]?.title as string | undefined) ?? "the coding challenge",
    changedFiles,
    failedTests: evaluation?.failedTests ?? [],
    passedTests: evaluation?.passedTests ?? [],
    weakAreas: evaluation?.weaknesses ?? [],
    strengths: evaluation?.strengths ?? [],
    overallScore: evaluation?.overallScore ?? null,
    technologies: [...technologies].slice(0, 20),
  };
}

/** Deterministic question templates filled with the candidate's real data. */
export function buildDeterministicQuestions(
  ctx: AssessmentContext,
): { category: InterviewCategory; question: string }[] {
  const file = ctx.changedFiles[0] ?? "the main implementation file";
  const failed = ctx.failedTests[0] ?? null;
  const weak = ctx.weakAreas[0] ?? "testing";
  const questions: { category: InterviewCategory; question: string }[] = [
    {
      category: "project_understanding",
      question: `In your own words, what does this project do, and which part of it did the challenge "${ctx.challengeTitle}" ask you to change?`,
    },
    {
      category: "architecture_design",
      question: `Explain the architecture of the project you worked on — how do its main components fit together, and where does ${file} sit in that picture?`,
    },
    {
      category: "code_changes",
      question: `Why did you change ${file}${ctx.changedFiles.length > 1 ? ` (and ${ctx.changedFiles.length - 1} other file(s))` : ""}? Walk through the most important change you made and why you chose that approach.`,
    },
    {
      category: "fundamentals",
      question: `The challenge involved ${ctx.technologies.slice(0, 3).join(", ") || "the project's stack"}. Explain one core concept from that stack that your solution relies on, and what would break if it worked differently.`,
    },
    {
      category: "debugging",
      question: failed
        ? `One of your tests failed: "${failed}". What caused it, how did you identify the cause, and what did you change to address it?`
        : `What was the most difficult bug or error you encountered during the assessment, and how did you track it down?`,
    },
    {
      category: "security_performance",
      question: `What security or performance risks exist in your implementation, and what would you change if this code went to production?`,
    },
    {
      category: "testing_edge_cases",
      question: `Which edge cases did you test, which did you not get to, and how would you test the trickiest one?`,
    },
  ];
  if (ctx.weakAreas.length > 0) {
    questions.push({
      category: "follow_up",
      question: `Your evaluation noted a weak area: ${weak}. What would you do differently next time to strengthen it?`,
    });
  }
  return questions;
}

const QuestionsSchema = (u: unknown): { category: string; question: string }[] => {
  if (!Array.isArray(u)) throw new Error("Expected an array of questions");
  return u.map((q) => {
    const o = q as Record<string, unknown>;
    if (typeof o.question !== "string" || typeof o.category !== "string") {
      throw new Error("Invalid question shape");
    }
    return { category: o.category, question: o.question };
  });
};

export async function generateInterview(opts: {
  assessmentId: string;
  candidateId: string;
}): Promise<{ interview: InterviewRow; questions: InterviewQuestionRow[] }> {
  const assessment = await loadAssessmentById(opts.assessmentId);
  if (assessment.candidate_id !== opts.candidateId) {
    throw new ApiError(403, "This assessment belongs to another candidate");
  }
  if (assessment.status !== "completed") {
    throw new ApiError(409, "The interview is generated after the assessment is evaluated");
  }
  const existing = await pool.query(
    `SELECT * FROM interviews WHERE assessment_id = $1 AND interview_type = 'assessment' ORDER BY created_at DESC LIMIT 1`,
    [opts.assessmentId],
  );
  if (existing.rows.length) {
    const questions = await pool.query(
      `SELECT * FROM interview_questions WHERE interview_id = $1 ORDER BY question_order ASC`,
      [existing.rows[0].id],
    );
    return {
      interview: existing.rows[0] as InterviewRow,
      questions: questions.rows as InterviewQuestionRow[],
    };
  }
  const ctx = await loadContext(opts.assessmentId);
  let questions = buildDeterministicQuestions(ctx);
  if (llmConfigured()) {
    try {
      const refined = await chatJson(
        {
          system:
            "You are a senior technical interviewer. Refine the given interview questions so each one is specific to the candidate's real project, changes and test results. Keep all 7-8 questions, keep the categories, do not invent facts about the candidate. Return strict JSON: an array of {category, question}.",
          user: JSON.stringify({ context: ctx, draftQuestions: questions }),
          jsonMode: true,
        },
        QuestionsSchema,
      );
      const valid = refined.filter((q) =>
        (INTERVIEW_CATEGORIES as readonly string[]).includes(q.category),
      );
      if (valid.length >= 5) {
        questions = valid.map((q) => ({
          category: q.category as InterviewCategory,
          question: q.question,
        }));
      }
    } catch {
      // LLM failure never blocks the interview — deterministic questions stand.
    }
  }
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const interview = await client.query(
      `INSERT INTO interviews (candidate_id, assessment_id, interview_type, status)
       VALUES ($1, $2, 'assessment', 'scheduled') RETURNING *`,
      [opts.candidateId, opts.assessmentId],
    );
    const interviewId = interview.rows[0].id as string;
    const inserted: InterviewQuestionRow[] = [];
    for (let i = 0; i < questions.length; i++) {
      const row = await client.query(
        `INSERT INTO interview_questions (interview_id, category, question, question_order)
         VALUES ($1, $2, $3, $4) RETURNING *`,
        [interviewId, questions[i].category, questions[i].question, i],
      );
      inserted.push(row.rows[0] as InterviewQuestionRow);
    }
    await client.query("COMMIT");
    return { interview: interview.rows[0] as InterviewRow, questions: inserted };
  } catch (err) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw err;
  } finally {
    client.release();
  }
}

export async function loadInterviewForCandidate(
  interviewId: string,
  candidateId: string,
): Promise<InterviewRow> {
  const res = await pool.query(
    `SELECT * FROM interviews WHERE id = $1 AND candidate_id = $2`,
    [interviewId, candidateId],
  );
  if (!res.rows.length) throw new ApiError(404, "Interview not found");
  return res.rows[0] as InterviewRow;
}

interface AnswerEvaluation {
  accuracy: number;
  understanding: number;
  depth: number;
  relevance: number;
  problemSolving: number;
  method: "llm" | "deterministic";
  notes: string;
}

const AnswerSchema = (u: unknown): AnswerEvaluation => {
  const o = u as Record<string, unknown>;
  const num = (v: unknown): number => {
    const n = Number(v);
    return Number.isFinite(n) ? Math.max(0, Math.min(100, n)) : 0;
  };
  return {
    accuracy: num(o.accuracy),
    understanding: num(o.understanding),
    depth: num(o.depth),
    relevance: num(o.relevance),
    problemSolving: num(o.problemSolving),
    method: "llm",
    notes: typeof o.notes === "string" ? o.notes : "",
  };
};

/** Deterministic per-answer evaluation: concept coverage + depth bands. */
export function evaluateAnswerDeterministic(
  question: string,
  answer: string,
  expectedConcepts: string[],
): AnswerEvaluation {
  const lower = answer.toLowerCase();
  const covered = expectedConcepts.filter((c) => lower.includes(c.toLowerCase()));
  const coverage = expectedConcepts.length ? covered.length / expectedConcepts.length : 0;
  const words = answer.trim().split(/\s+/).filter(Boolean).length;
  const depthBand = words < 20 ? 30 : words < 60 ? 55 : words < 150 ? 75 : 85;
  const relevance = question.length > 0 && words >= 10 ? 70 : 40;
  return {
    accuracy: Math.round(coverage * 70 + (words >= 20 ? 15 : 0)),
    understanding: Math.round(coverage * 60 + depthBand * 0.4),
    depth: depthBand,
    relevance,
    problemSolving: Math.round(coverage * 50 + (words >= 40 ? 20 : 0)),
    method: "deterministic",
    notes:
      covered.length > 0
        ? `Answer mentioned ${covered.length} of ${expectedConcepts.length} expected concept(s): ${covered.join(", ")}.`
        : "Answer did not mention the expected concepts for this question.",
  };
}

export async function answerQuestion(opts: {
  interviewId: string;
  candidateId: string;
  questionId: string;
  answer: string;
}): Promise<{
  evaluation: AnswerEvaluation;
  score: number;
  followUp: InterviewQuestionRow | null;
}> {
  const interview = await loadInterviewForCandidate(opts.interviewId, opts.candidateId);
  if (interview.status === "completed") {
    throw new ApiError(409, "This interview is already completed");
  }
  const q = await pool.query(
    `SELECT * FROM interview_questions WHERE id = $1 AND interview_id = $2`,
    [opts.questionId, opts.interviewId],
  );
  if (!q.rows.length) throw new ApiError(404, "Question not found");
  const question = q.rows[0] as InterviewQuestionRow;
  const answer = opts.answer.trim();
  if (answer.length < 5) throw new ApiError(400, "Answer is too short");
  // Expected concepts come from the assessment context (real data only).
  const ctx = interview.assessment_id
    ? await loadContext(interview.assessment_id)
    : null;
  const expectedConcepts = [
    ...(ctx?.changedFiles.map((f) => f.split("/").pop() ?? f) ?? []),
    ...(ctx?.technologies ?? []),
    ...(ctx?.challengeTitle.split(/\s+/).filter((w) => w.length > 4) ?? []),
  ].slice(0, 12);
  let evaluation: AnswerEvaluation;
  if (llmConfigured()) {
    try {
      evaluation = await chatJson(
        {
          system:
            "You are a senior technical interviewer evaluating one interview answer. Judge engineering knowledge only — never penalise accent, grammar, or language proficiency. Score 0-100 per dimension. Return strict JSON {accuracy, understanding, depth, relevance, problemSolving, notes}.",
          user: JSON.stringify({ question: question.question, answer, expectedConcepts }),
          jsonMode: true,
        },
        AnswerSchema,
      );
    } catch {
      evaluation = evaluateAnswerDeterministic(question.question, answer, expectedConcepts);
    }
  } else {
    evaluation = evaluateAnswerDeterministic(question.question, answer, expectedConcepts);
  }
  const score =
    Math.round(
      (evaluation.accuracy * 0.3 +
        evaluation.understanding * 0.25 +
        evaluation.depth * 0.15 +
        evaluation.relevance * 0.15 +
        evaluation.problemSolving * 0.15) *
        100,
    ) / 100;
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(
      `INSERT INTO interview_answers (question_id, answer, evaluation, score)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (question_id) DO UPDATE SET answer = EXCLUDED.answer, evaluation = EXCLUDED.evaluation, score = EXCLUDED.score`,
      [opts.questionId, answer, JSON.stringify(evaluation), score],
    );
    // Adaptive follow-up: a weak answer earns a targeted follow-up question.
    let followUp: InterviewQuestionRow | null = null;
    if (score < 60) {
      const existing = await client.query(
        `SELECT * FROM interview_questions WHERE interview_id = $1 AND category = 'follow_up' ORDER BY question_order DESC LIMIT 1`,
        [opts.interviewId],
      );
      const alreadyAsked = await client.query(
        `SELECT 1 FROM interview_answers ia JOIN interview_questions iq ON iq.id = ia.question_id
          WHERE iq.interview_id = $1 AND iq.category = 'follow_up'`,
        [opts.interviewId],
      );
      if (existing.rows.length === 0 && alreadyAsked.rows.length === 0) {
        const text = `You scored lower on: "${question.question}". Let's go deeper — what specifically was unclear or difficult there, and how would you approach it with more time?`;
        const row = await client.query(
          `INSERT INTO interview_questions (interview_id, category, question, question_order)
           VALUES ($1, 'follow_up', $2, 100) RETURNING *`,
          [opts.interviewId, text],
        );
        followUp = row.rows[0] as InterviewQuestionRow;
      }
    }
    await client.query("COMMIT");
    return { evaluation, score, followUp };
  } catch (err) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw err;
  } finally {
    client.release();
  }
}

export interface InterviewReport {
  interviewId: string;
  assessmentId: string | null;
  finalScore: number | null;
  transcript: { category: string; question: string; answer: string | null; score: number | null; evaluation: Record<string, unknown> | null }[];
  perQuestion: { question: string; category: string; score: number | null; evaluation: Record<string, unknown> | null }[];
  strengths: string[];
  knowledgeGaps: string[];
  learningAreas: string[];
  evidence: Record<string, unknown>;
}

export async function buildInterviewReport(
  interviewId: string,
  candidateId: string,
): Promise<InterviewReport> {
  const interview = await loadInterviewForCandidate(interviewId, candidateId);
  const rows = await pool.query(
    `SELECT iq.id, iq.category, iq.question, iq.question_order,
            ia.answer, ia.score, ia.evaluation
       FROM interview_questions iq
       LEFT JOIN interview_answers ia ON ia.question_id = iq.id
      WHERE iq.interview_id = $1 ORDER BY iq.question_order ASC`,
    [interviewId],
  );
  const transcript = rows.rows.map((r) => ({
    category: String(r.category),
    question: String(r.question),
    answer: (r.answer as string | null) ?? null,
    score: r.score === null ? null : Number(r.score),
    evaluation: (r.evaluation as Record<string, unknown> | null) ?? null,
  }));
  const answered = transcript.filter((t) => t.score !== null);
  const finalScore =
    answered.length > 0
      ? Math.round((answered.reduce((s, t) => s + (t.score ?? 0), 0) / answered.length) * 100) / 100
      : null;
  const strengths = transcript
    .filter((t) => (t.score ?? 0) >= 70)
    .map((t) => `Strong answer on ${t.category.replace(/_/g, " ")}.`);
  const gaps = transcript
    .filter((t) => t.score !== null && (t.score ?? 0) < 50)
    .map((t) => t.category.replace(/_/g, " "));
  const learningAreas = [...new Set(gaps)];
  const report: InterviewReport = {
    interviewId,
    assessmentId: interview.assessment_id,
    finalScore,
    transcript,
    perQuestion: transcript.map((t) => ({
      question: t.question,
      category: t.category,
      score: t.score,
      evaluation: t.evaluation,
    })),
    strengths,
    knowledgeGaps: gaps,
    learningAreas,
    evidence: {
      questionsAsked: transcript.length,
      questionsAnswered: answered.length,
      assessmentId: interview.assessment_id,
    },
  };
  await pool.query(
    `UPDATE interviews SET score = $1, report = $2, status = 'completed', transcript = $3 WHERE id = $4`,
    [
      finalScore,
      JSON.stringify(report),
      JSON.stringify(transcript),
      interviewId,
    ],
  );
  return report;
}

export async function getInterviewReport(
  interviewId: string,
  candidateId: string,
): Promise<InterviewReport | null> {
  const interview = await loadInterviewForCandidate(interviewId, candidateId);
  if (interview.report) return interview.report as unknown as InterviewReport;
  if (interview.status === "completed") return buildInterviewReport(interviewId, candidateId);
  return null;
}

export async function listInterviewQuestions(
  interviewId: string,
  candidateId: string,
): Promise<(InterviewQuestionRow & { answer: string | null; score: number | null })[]> {
  await loadInterviewForCandidate(interviewId, candidateId);
  const res = await pool.query(
    `SELECT iq.*, ia.answer, ia.score FROM interview_questions iq
      LEFT JOIN interview_answers ia ON ia.question_id = iq.id
      WHERE iq.interview_id = $1 ORDER BY iq.question_order ASC`,
    [interviewId],
  );
  return res.rows as (InterviewQuestionRow & { answer: string | null; score: number | null })[];
}

export { listEvents };
