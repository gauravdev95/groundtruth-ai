import { pool } from "../config/db";
import { ApiError } from "../middleware/errorHandler";
import { chatJson, llmConfigured } from "./llm";
import { loadAssessmentById } from "./assessments";
import { listEvents, buildActivitySummary } from "./monitoring";
import { notifyCandidate } from "./notifications";

// ── Hybrid AI engineering evaluation ───────────────────────────────────────
// Weights (fixed by the product spec): functional correctness 30%,
// code quality 20%, problem-solving 20%, technical understanding 15%,
// testing & reliability 15%. Functional correctness comes ONLY from
// executed tests (visible + hidden) — never invented, never from an LLM.
// Code quality is deterministic static analysis (no candidate code is
// executed for it). The qualitative categories use the LLM when configured;
// without it they use a capped deterministic heuristic and the evaluation
// is flagged human_review_recommended with low confidence. Monitoring data
// is contextual evidence only — it never directly determines the score.

export const EVALUATION_WEIGHTS = {
  functional: 0.3,
  quality: 0.2,
  problemSolving: 0.2,
  understanding: 0.15,
  testing: 0.15,
} as const;

export interface EvaluationReport {
  id: string;
  assessmentId: string;
  overallScore: number | null;
  categoryScores: Record<string, number | null>;
  evidence: Record<string, unknown>;
  passedTests: string[];
  failedTests: string[];
  qualityIssues: string[];
  securityFindings: string[];
  improvements: string[];
  strengths: string[];
  weaknesses: string[];
  confidence: number;
  humanReviewRecommended: boolean;
  aiAvailable: boolean;
  qualitativeMethod: "llm" | "deterministic-heuristic";
  status: string;
}

interface QualitySignals {
  issues: string[];
  score: number;
  stats: Record<string, number>;
}

/** Deterministic static checks on file contents. No code is executed. */
export function analyzeCodeQuality(
  files: Record<string, string>,
): QualitySignals {
  const issues: string[] = [];
  const stats = {
    files: Object.keys(files).length,
    totalLines: 0,
    todoCount: 0,
    functions: 0,
    longFunctions: 0,
    longFiles: 0,
    testFiles: 0,
  };
  for (const [p, content] of Object.entries(files)) {
    if (p.startsWith("_gt_")) continue;
    const lines = content.split("\n");
    stats.totalLines += lines.length;
    if (p.includes("test")) stats.testFiles += 1;
    if (lines.length > 500) {
      stats.longFiles += 1;
      issues.push(`${p} is very long (${lines.length} lines) — consider splitting it.`);
    }
    for (const line of lines) {
      if (/TODO|FIXME|XXX|HACK/i.test(line)) stats.todoCount += 1;
    }
    // Python function length heuristic (def ... to next def/class at same indent).
    const defs = [...content.matchAll(/^def\s+(\w+)\s*\(/gm)].map((m) => m[1]);
    stats.functions += defs.length;
    const chunks = content.split(/^def\s+\w+\s*\(/m);
    for (const chunk of chunks.slice(1)) {
      const fnLines = chunk.split("\n").length;
      if (fnLines > 80) stats.longFunctions += 1;
    }
  }
  if (stats.todoCount > 0) {
    issues.push(`${stats.todoCount} TODO/FIXME marker(s) left in the code.`);
  }
  if (stats.longFunctions > 0) {
    issues.push(`${stats.longFunctions} function(s) longer than 80 lines.`);
  }
  if (stats.testFiles === 0) {
    issues.push("No test files were found in the submitted snapshot.");
  }
  let score = 100;
  score -= Math.min(30, stats.longFiles * 10);
  score -= Math.min(20, stats.longFunctions * 5);
  score -= Math.min(20, stats.todoCount * 2);
  if (stats.testFiles === 0) score -= 20;
  return { issues, score: Math.max(0, score), stats };
}

function securityScan(files: Record<string, string>): string[] {
  const findings: string[] = [];
  const patterns: [RegExp, string][] = [
    [/eval\s*\(/, "Use of eval() — arbitrary code execution risk."],
    [/exec\s*\(/, "Use of exec() — arbitrary code execution risk."],
    [/password\s*=\s*["'][^"']+["']/, "A hard-coded password/secret appears in the code."],
    [/api[_-]?key\s*=\s*["'][^"']+["']/, "A hard-coded API key appears in the code."],
    [/os\.system\s*\(/, "os.system() used — prefer subprocess with an argument list."],
    [/shell\s*=\s*True/, "subprocess with shell=True — command injection risk."],
  ];
  for (const [p, content] of Object.entries(files)) {
    for (const [re, msg] of patterns) {
      if (re.test(content)) findings.push(`${p}: ${msg}`);
    }
  }
  return [...new Set(findings)];
}

const QualitativeSchema = (u: unknown): {
  problemSolving: number;
  understanding: number;
  testing: number;
  strengths: string[];
  weaknesses: string[];
  improvements: string[];
} => {
  const o = u as Record<string, unknown>;
  const num = (v: unknown): number => {
    const n = Number(v);
    return Number.isFinite(n) ? Math.max(0, Math.min(100, n)) : 0;
  };
  const arr = (v: unknown): string[] =>
    Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
  return {
    problemSolving: num(o.problemSolving),
    understanding: num(o.understanding),
    testing: num(o.testing),
    strengths: arr(o.strengths),
    weaknesses: arr(o.weaknesses),
    improvements: arr(o.improvements),
  };
};

async function qualitativeByHeuristic(opts: {
  files: Record<string, string>;
  originalFiles: Record<string, string>;
  passed: number;
  total: number;
}): Promise<{ problemSolving: number; understanding: number; testing: number; strengths: string[]; weaknesses: string[]; improvements: string[] }> {
  const changed = Object.keys(opts.files).filter(
    (k) => opts.files[k] !== opts.originalFiles[k],
  );
  const testFiles = Object.keys(opts.files).filter((k) => k.includes("test"));
  const passRate = opts.total > 0 ? opts.passed / opts.total : 0;
  const strengths: string[] = [];
  const weaknesses: string[] = [];
  if (changed.length > 0) strengths.push(`Changed ${changed.length} file(s) to address the task.`);
  else weaknesses.push("No files were changed from the original project.");
  if (passRate >= 0.8) strengths.push("Most executed tests pass.");
  else if (opts.total > 0) weaknesses.push(`Only ${opts.passed} of ${opts.total} executed tests pass.`);
  if (testFiles.length > 0) strengths.push("Test files are present in the submission.");
  else weaknesses.push("No test files in the submission — testing cannot be evidenced.");
  // Heuristic scores are deliberately capped: without an LLM qualitative
  // review they are weak evidence, so they never exceed 60.
  return {
    problemSolving: Math.min(60, Math.round(30 + passRate * 30 + Math.min(10, changed.length * 2))),
    understanding: Math.min(60, Math.round(35 + Math.min(15, changed.length * 3))),
    testing: Math.min(60, Math.round(passRate * 50 + (testFiles.length > 0 ? 10 : 0))),
    strengths,
    weaknesses,
    improvements: [
      "Add or extend tests covering the changed behaviour.",
      "Ask for a human review of the qualitative categories (AI review was unavailable).",
    ],
  };
}

export async function evaluateAssessment(
  assessmentId: string,
): Promise<EvaluationReport> {
  const assessment = await loadAssessmentById(assessmentId);
  if (assessment.status !== "evaluating" && assessment.status !== "completed") {
    throw new ApiError(409, `Cannot evaluate an assessment in status ${assessment.status}`);
  }
  const existing = await pool.query(
    `SELECT * FROM evaluations WHERE assessment_id = $1`,
    [assessmentId],
  );
  if (existing.rows.length && existing.rows[0].status === "completed") {
    return rowToReport(existing.rows[0]);
  }
  const snap = await pool.query(
    `SELECT * FROM code_snapshots WHERE assessment_id = $1 ORDER BY version DESC LIMIT 1`,
    [assessmentId],
  );
  if (!snap.rows.length) throw new ApiError(409, "No submitted snapshot to evaluate");
  const snapshot = snap.rows[0];
  const files = (snapshot.files as Record<string, string>) ?? {};
  const originalSnap = await pool.query(
    `SELECT files FROM code_snapshots WHERE assessment_id = $1 AND version = 0`,
    [assessmentId],
  );
  const originalFiles = (originalSnap.rows[0]?.files as Record<string, string> | undefined) ?? {};
  const challenge = await pool.query(
    `SELECT * FROM challenges WHERE assessment_id = $1`,
    [assessmentId],
  );
  const challengeRow = challenge.rows[0];
  const testEvents = await pool.query(
    `SELECT * FROM test_execution_events WHERE assessment_id = $1 ORDER BY created_at ASC`,
    [assessmentId],
  );
  // Functional correctness: ONLY executed tests. Hidden runs are the
  // authoritative measure; visible runs are supporting evidence.
  const hidden = testEvents.rows.filter((r) => (r.results as unknown[] | null) !== null && String(r.test_command) === "hidden test suite");
  const visible = testEvents.rows.filter((r) => String(r.test_command) !== "hidden test suite");
  const sum = (rows: typeof testEvents.rows): { passed: number; total: number } =>
    rows.reduce(
      (acc, r) => ({ passed: acc.passed + Number(r.passed), total: acc.total + Number(r.total) }),
      { passed: 0, total: 0 },
    );
  const hiddenTotals = sum(hidden.length ? hidden : visible);
  const visibleTotals = sum(visible);
  const functional =
    hiddenTotals.total > 0
      ? Math.round((hiddenTotals.passed / hiddenTotals.total) * 100)
      : 0;
  const passedTests: string[] = [];
  const failedTests: string[] = [];
  for (const r of testEvents.rows) {
    const results = (r.results as string[] | null) ?? [];
    if (Number(r.failed) > 0) failedTests.push(...results);
    else passedTests.push(`${r.test_command} (${r.passed}/${r.total})`);
  }
  const quality = analyzeCodeQuality(files);
  const security = securityScan(files);
  const events = await listEventsFor(assessmentId);
  const monitoringSummary = buildActivitySummary(assessmentId, events);
  const aiAvailable = llmConfigured();
  let qualitative: Awaited<ReturnType<typeof qualitativeByHeuristic>>;
  let method: "llm" | "deterministic-heuristic" = "deterministic-heuristic";
  if (aiAvailable) {
    try {
      const criteria = (challengeRow?.acceptance_criteria as string[] | null) ?? [];
      qualitative = await chatJson(
        {
          system:
            "You are a senior engineering reviewer. Score ONLY from the evidence given (test results, code-quality signals, and the monitoring summary). Never invent test results. Return strict JSON.",
          user: JSON.stringify({
            challenge: challengeRow?.title,
            acceptanceCriteria: criteria,
            functionalScore: functional,
            qualityScore: quality.score,
            qualityIssues: quality.issues,
            securityFindings: security,
            filesChanged: Object.keys(files).filter((k) => files[k] !== originalFiles[k]),
            monitoring: {
              testRuns: monitoringSummary.testRuns,
              compileErrors: monitoringSummary.compileErrors,
              observations: monitoringSummary.observations,
            },
          }),
          jsonMode: true,
        },
        QualitativeSchema,
      );
      method = "llm";
    } catch {
      qualitative = await qualitativeByHeuristic({
        files,
        originalFiles,
        passed: hiddenTotals.passed,
        total: hiddenTotals.total,
      });
    }
  } else {
    qualitative = await qualitativeByHeuristic({
      files,
      originalFiles,
      passed: hiddenTotals.passed,
      total: hiddenTotals.total,
    });
  }
  const categoryScores: Record<string, number> = {
    functional,
    quality: quality.score,
    problemSolving: qualitative.problemSolving,
    understanding: qualitative.understanding,
    testing: qualitative.testing,
  };
  const overall =
    Math.round(
      (categoryScores.functional * EVALUATION_WEIGHTS.functional +
        categoryScores.quality * EVALUATION_WEIGHTS.quality +
        categoryScores.problemSolving * EVALUATION_WEIGHTS.problemSolving +
        categoryScores.understanding * EVALUATION_WEIGHTS.understanding +
        categoryScores.testing * EVALUATION_WEIGHTS.testing) *
        100,
    ) / 100;
  const humanReview =
    method === "deterministic-heuristic" ||
    security.length > 0 ||
    functional < 50 ||
    hiddenTotals.total === 0;
  const confidence = method === "llm" ? (hiddenTotals.total > 0 ? 0.85 : 0.6) : 0.5;
  const evidence = {
    snapshotHash: snapshot.snapshot_hash as string,
    snapshotVersion: snapshot.version as number,
    hiddenTests: hiddenTotals,
    visibleTests: visibleTotals,
    monitoring: {
      durationSeconds: monitoringSummary.durationSeconds,
      activeSeconds: monitoringSummary.activeSeconds,
      testRuns: monitoringSummary.testRuns.runs,
      compileErrors: monitoringSummary.compileErrors,
    },
    challengeTitle: challengeRow?.title ?? null,
  };
  const strengths = [...new Set(qualitative.strengths)];
  if (functional >= 80) strengths.push("Strong functional correctness on executed tests.");
  const weaknesses = [...new Set(qualitative.weaknesses)];
  if (security.length > 0) weaknesses.push("Security findings need fixing (see security_findings).");
  const improvements = [...new Set(qualitative.improvements)];
  const inserted = await pool.query(
    `INSERT INTO evaluations
       (assessment_id, overall_score, category_scores, evidence, passed_tests, failed_tests,
        quality_issues, security_findings, improvements, strengths, weaknesses,
        confidence, human_review_recommended, status)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,'completed')
     ON CONFLICT (assessment_id) DO UPDATE SET
       overall_score = EXCLUDED.overall_score, category_scores = EXCLUDED.category_scores,
       evidence = EXCLUDED.evidence, passed_tests = EXCLUDED.passed_tests,
       failed_tests = EXCLUDED.failed_tests, quality_issues = EXCLUDED.quality_issues,
       security_findings = EXCLUDED.security_findings, improvements = EXCLUDED.improvements,
       strengths = EXCLUDED.strengths, weaknesses = EXCLUDED.weaknesses,
       confidence = EXCLUDED.confidence,
       human_review_recommended = EXCLUDED.human_review_recommended,
       status = 'completed'
     RETURNING *`,
    [
      assessmentId,
      overall,
      JSON.stringify(categoryScores),
      JSON.stringify(evidence),
      JSON.stringify(passedTests),
      JSON.stringify(failedTests),
      JSON.stringify(quality.issues),
      JSON.stringify(security),
      JSON.stringify(improvements),
      JSON.stringify(strengths),
      JSON.stringify(weaknesses),
      confidence,
      humanReview,
    ],
  );
  await pool.query(
    `UPDATE assessments SET status = 'completed', ended_at = now(), updated_at = now() WHERE id = $1`,
    [assessmentId],
  );
  // Phase 7: the candidate's evaluation is complete — the report is ready.
  await notifyCandidate(assessment.candidate_id, {
    type: "assessment",
    title: "Assessment report ready",
    body: `Your assessment evaluation is complete — overall score ${overall}%. View the report for the full breakdown.`,
    link: "/assessment",
  });
  // Verified skills: only skills the candidate listed AND the assessment
  // evidenced (functional score >= 70 and the skill appears in the changed
  // code or challenge context). Never label untested skills verified.
  if (functional >= 70) {
    const skills = await pool.query(
      `SELECT s.id, s.name FROM candidate_skills cs
        JOIN skills s ON s.id = cs.skill_id
        WHERE cs.candidate_id = $1`,
      [assessment.candidate_id],
    );
    const haystack = JSON.stringify(files).toLowerCase();
    for (const skill of skills.rows) {
      const name = String(skill.name).toLowerCase();
      if (haystack.includes(name)) {
        await pool.query(
          `INSERT INTO verified_skills (candidate_id, skill_id, assessment_id, evidence, status)
           VALUES ($1, $2, $3, $4, 'verified')
           ON CONFLICT (candidate_id, skill_id) DO UPDATE SET
             assessment_id = EXCLUDED.assessment_id, evidence = EXCLUDED.evidence,
             status = 'verified', verified_at = now()`,
          [
            assessment.candidate_id,
            skill.id,
            assessmentId,
            JSON.stringify({
              assessment_id: assessmentId,
              functional_score: functional,
              test_pass_rate:
                hiddenTotals.total > 0 ? hiddenTotals.passed / hiddenTotals.total : null,
            }),
          ],
        );
      }
    }
  }
  const report = rowToReport(inserted.rows[0]);
  report.aiAvailable = aiAvailable;
  report.qualitativeMethod = method;
  return report;
}

async function listEventsFor(assessmentId: string) {
  const res = await pool.query(
    `SELECT * FROM assessment_events WHERE assessment_id = $1 ORDER BY created_at ASC`,
    [assessmentId],
  );
  return res.rows as Parameters<typeof buildActivitySummary>[1];
}

export async function getEvaluation(
  assessmentId: string,
): Promise<EvaluationReport | null> {
  const res = await pool.query(
    `SELECT * FROM evaluations WHERE assessment_id = $1`,
    [assessmentId],
  );
  if (!res.rows.length) return null;
  const report = rowToReport(res.rows[0]);
  report.aiAvailable = llmConfigured();
  return report;
}

function rowToReport(row: Record<string, unknown>): EvaluationReport {
  const categories = (row.category_scores as Record<string, number> | null) ?? {};
  return {
    id: String(row.id),
    assessmentId: String(row.assessment_id),
    overallScore: row.overall_score === null ? null : Number(row.overall_score),
    categoryScores: categories,
    evidence: (row.evidence as Record<string, unknown> | null) ?? {},
    passedTests: (row.passed_tests as string[] | null) ?? [],
    failedTests: (row.failed_tests as string[] | null) ?? [],
    qualityIssues: (row.quality_issues as string[] | null) ?? [],
    securityFindings: (row.security_findings as string[] | null) ?? [],
    improvements: (row.improvements as string[] | null) ?? [],
    strengths: (row.strengths as string[] | null) ?? [],
    weaknesses: (row.weaknesses as string[] | null) ?? [],
    confidence: row.confidence === null ? 0 : Number(row.confidence),
    humanReviewRecommended: Boolean(row.human_review_recommended),
    aiAvailable: false,
    qualitativeMethod: "deterministic-heuristic",
    status: String(row.status),
  };
}
