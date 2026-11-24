import { readFile } from "node:fs/promises";
import path from "node:path";
import { pool } from "../config/db";
import { ApiError } from "../middleware/errorHandler";
import { getOrCreateCandidateForUser } from "./student";
import { snapshotHash } from "./monitoring";
import {
  prepareWorkspace,
  readWorkspaceFiles,
  runSandboxed,
  parseTestOutput,
  workspaceRoot,
  type RunResult,
} from "./execution";
import { generateChallengeWithAI, validateChallenge } from "./challenge";
import { getHiddenTests } from "./hiddenTests";
import { notifyCandidate } from "./notifications";
import { analyzeRepoTree, sanitizeForLlm, validateRepoAccess } from "./repoAnalysis";
import {
  fetchPublicRepoFiles,
  parseGitHubRepoUrl,
  type PublicRepoFetch,
} from "./githubPublicRepo";
import { recordEvent } from "./monitoring";

// ── Assessment orchestration ───────────────────────────────────────────────
// Owns the assessment lifecycle: create → select project/repo → analyse →
// challenge → consent → start (Lab workspace) → files/autosave → submit
// (frozen snapshot + tests) → evaluating. Evaluation + interview live in
// their own services; this module only stores their inputs/outputs.
// Ownership is enforced on every call: a candidate can only touch their
// own assessments; recruiters go through the monitoring-report path, which
// checks application ownership.

export interface AssessmentRow {
  id: string;
  candidate_id: string;
  repository_id: string | null;
  project_id: string | null;
  status: string;
  time_limit_minutes: number;
  started_at: string | null;
  submitted_at: string | null;
  ended_at: string | null;
  consent_given_at: string | null;
  consent_version: string | null;
  created_at: string;
  updated_at: string;
}

export async function ownCandidateId(userId: string): Promise<string> {
  const user = await pool.query(
    `SELECT email, full_name FROM users WHERE id = $1`,
    [userId],
  );
  if (!user.rows.length) throw new ApiError(401, "Unauthorized");
  const candidate = await getOrCreateCandidateForUser(
    userId,
    user.rows[0].email as string,
    (user.rows[0].full_name as string) ?? "",
  );
  return candidate.id;
}

export async function loadAssessmentForCandidate(
  assessmentId: string,
  candidateId: string,
): Promise<AssessmentRow> {
  const res = await pool.query(
    `SELECT * FROM assessments WHERE id = $1 AND candidate_id = $2`,
    [assessmentId, candidateId],
  );
  if (!res.rows.length) throw new ApiError(404, "Assessment not found");
  return res.rows[0] as AssessmentRow;
}

export async function loadAssessmentById(
  assessmentId: string,
): Promise<AssessmentRow> {
  const res = await pool.query(`SELECT * FROM assessments WHERE id = $1`, [
    assessmentId,
  ]);
  if (!res.rows.length) throw new ApiError(404, "Assessment not found");
  return res.rows[0] as AssessmentRow;
}

export async function createAssessment(opts: {
  candidateId: string;
  projectId?: string | null;
  repoUrl?: string | null;
  source: "profile_project" | "github_url" | "github_account" | "manual";
  timeLimitMinutes?: number;
}): Promise<AssessmentRow> {
  const timeLimit = opts.timeLimitMinutes ?? 60;
  if (![30, 45, 60, 90].includes(timeLimit)) {
    throw new ApiError(400, "time_limit_minutes must be 30, 45, 60 or 90");
  }
  if (opts.source === "github_account") {
    // A GitHub-account-based assessment genuinely needs a connected GitHub
    // account (OAuth) — we do not have one, so this stays a 409. A PUBLIC
    // GitHub URL does NOT need it: see the github_url branch below.
    throw new ApiError(
      409,
      "GitHub-account-based assessment requires a connected GitHub account, which is not set up yet. Choose your profile project, a public GitHub URL, or the demo project instead.",
    );
  }
  // Step 5: a public GitHub URL needs no connected account — it is fetched
  // read-only through the public GitHub API, without any token.
  let githubRepo: { owner: string; repo: string; url: string } | null = null;
  if (opts.source === "github_url") {
    githubRepo = opts.repoUrl ? parseGitHubRepoUrl(opts.repoUrl) : null;
    if (!githubRepo) {
      throw new ApiError(
        400,
        "repoUrl must be a public GitHub repository URL (https://github.com/<owner>/<repo>).",
      );
    }
  }
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    let projectId: string | null = opts.projectId ?? null;
    if (opts.source === "profile_project") {
      if (!projectId) {
        // The student has exactly one project (enforced since 6462b04).
        const proj = await client.query(
          `SELECT id FROM candidate_projects WHERE candidate_id = $1 ORDER BY created_at ASC LIMIT 1`,
          [opts.candidateId],
        );
        if (!proj.rows.length) {
          throw new ApiError(
            409,
            "Select a project first — your profile has no project yet.",
          );
        }
        projectId = proj.rows[0].id as string;
      } else {
        const owned = await client.query(
          `SELECT id FROM candidate_projects WHERE id = $1 AND candidate_id = $2`,
          [projectId, opts.candidateId],
        );
        if (!owned.rows.length) {
          throw new ApiError(404, "Project not found");
        }
      }
    }
    const repo = await client.query(
      `INSERT INTO assessment_repositories (candidate_id, project_id, source, repo_url, repo_name)
       VALUES ($1, $2, $3, $4, $5) RETURNING id`,
      [
        opts.candidateId,
        projectId,
        opts.source,
        githubRepo ? githubRepo.url : (opts.repoUrl ?? null),
        githubRepo
          ? `${githubRepo.owner}/${githubRepo.repo}`
          : opts.source === "manual"
            ? "groundtruth-assessment-demo"
            : null,
      ],
    );
    const assessment = await client.query(
      `INSERT INTO assessments (candidate_id, repository_id, project_id, status, time_limit_minutes)
       VALUES ($1, $2, $3, 'draft', $4) RETURNING *`,
      [opts.candidateId, repo.rows[0].id, projectId, timeLimit],
    );
    await client.query("COMMIT");
    return assessment.rows[0] as AssessmentRow;
  } catch (err) {
    await client.query("ROLLBACK").catch(() => undefined);
    if (err instanceof ApiError) throw err;
    if ((err as { code?: string }).code === "23505") {
      throw new ApiError(
        409,
        "You already have an active assessment. Finish or cancel it before starting a new one.",
      );
    }
    throw err;
  } finally {
    client.release();
  }
}

export async function listAssessments(
  candidateId: string,
): Promise<AssessmentRow[]> {
  const res = await pool.query(
    `SELECT * FROM assessments WHERE candidate_id = $1 ORDER BY created_at DESC LIMIT 50`,
    [candidateId],
  );
  return res.rows as AssessmentRow[];
}

/** The bundled demo project files, read from the repo at runtime. */
export async function loadDemoProjectFiles(): Promise<Record<string, string>> {
  const root = path.resolve(__dirname, "..", "..", "..", "groundtruth-assessment-demo");
  const { readdir } = await import("node:fs/promises");
  const out: Record<string, string> = {};
  async function walk(dir: string, prefix: string): Promise<void> {
    const entries = await readdir(dir, { withFileTypes: true });
    for (const e of entries) {
      const full = path.join(dir, e.name);
      const rel = prefix ? `${prefix}/${e.name}` : e.name;
      if (e.isDirectory()) {
        if (e.name === "__pycache__" || e.name === ".git") continue;
        await walk(full, rel);
      } else if (e.isFile() && !e.name.endsWith(".pyc")) {
        out[rel] = await readFile(full, "utf8");
      }
    }
  }
  await walk(root, "");
  if (!Object.keys(out).length) {
    throw new ApiError(404, "Demo project files are not available on this server.");
  }
  return out;
}

export interface RepoAnalysisResult {
  id: string;
  repository_id: string;
  languages: unknown;
  frameworks: string[];
  dependencies: unknown[];
  structure: Record<string, unknown>;
  entry_points: string[];
  tests: Record<string, unknown>;
  api_endpoints: unknown[];
  db_integrations: string[];
  quality: Record<string, unknown>;
  summary: string | null;
  analyzed_by: string;
  created_at: string;
}

/** Analyse a file tree the candidate supplied (never executes repo code). */
export async function analyzeRepository(opts: {
  assessmentId: string;
  candidateId: string;
  files: { path: string; content: string }[];
  repoUrl?: string | null;
}): Promise<RepoAnalysisResult> {
  const assessment = await loadAssessmentForCandidate(
    opts.assessmentId,
    opts.candidateId,
  );
  if (!assessment.repository_id) {
    throw new ApiError(409, "Assessment has no repository selected");
  }
  const access = validateRepoAccess({ repoUrl: opts.repoUrl ?? undefined, files: opts.files });
  if (!access.ok) {
    throw new ApiError(400, access.issues.join("; "));
  }
  const analysis = analyzeRepoTree(opts.files);
  const llmSummary = sanitizeForLlm(analysis);
  const res = await pool.query(
    `INSERT INTO repo_analyses
       (repository_id, languages, frameworks, dependencies, structure, entry_points, tests, api_endpoints, db_integrations, quality, summary, analyzed_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, 'deterministic') RETURNING *`,
    [
      assessment.repository_id,
      JSON.stringify(analysis.languages),
      analysis.frameworks,
      JSON.stringify(analysis.dependencies),
      JSON.stringify(analysis.structure),
      JSON.stringify(analysis.entryPoints),
      JSON.stringify(analysis.tests),
      JSON.stringify(analysis.endpoints),
      analysis.dbIntegrations,
      // Quality column also carries the flags the challenge generator needs
      // to reconstruct the analysis (hasAuth/hasValidation/hasRateLimiter,
      // file counts, detected functionality) — all derived metadata.
      JSON.stringify({
        ...analysis.quality,
        hasAuth: analysis.hasAuth,
        hasValidation: analysis.hasValidation,
        hasRateLimiter: analysis.hasRateLimiter,
        fileCount: analysis.fileCount,
        totalBytes: analysis.totalBytes,
        functionality: analysis.functionality,
      }),
      llmSummary,
    ],
  );
  return res.rows[0] as RepoAnalysisResult;
}

export async function getLatestRepoAnalysis(
  repositoryId: string,
): Promise<RepoAnalysisResult | null> {
  const res = await pool.query(
    `SELECT * FROM repo_analyses WHERE repository_id = $1 ORDER BY created_at DESC LIMIT 1`,
    [repositoryId],
  );
  return (res.rows[0] as RepoAnalysisResult | undefined) ?? null;
}

export interface AssessmentRepositoryRow {
  id: string;
  candidate_id: string;
  project_id: string | null;
  source: string;
  repo_url: string | null;
  repo_name: string | null;
  default_branch: string | null;
  commit_sha: string | null;
  fetched_files: { path: string; content: string }[] | null;
  fetched_at: string | null;
  created_at: string;
}

/** The repository row behind an assessment (null when it has none). */
export async function loadRepositoryForAssessment(
  assessmentId: string,
): Promise<AssessmentRepositoryRow | null> {
  const assessment = await loadAssessmentById(assessmentId);
  if (!assessment.repository_id) return null;
  const res = await pool.query(
    `SELECT * FROM assessment_repositories WHERE id = $1`,
    [assessment.repository_id],
  );
  return (res.rows[0] as AssessmentRepositoryRow | undefined) ?? null;
}

/** Public (safe-to-send-to-the-browser) view of a repository row. */
export function toPublicRepository(row: AssessmentRepositoryRow | null): {
  source: string;
  repo_url: string | null;
  repo_name: string | null;
  default_branch: string | null;
  commit_sha: string | null;
  fetched_at: string | null;
} | null {
  if (!row) return null;
  return {
    source: row.source,
    repo_url: row.repo_url,
    repo_name: row.repo_name,
    default_branch: row.default_branch,
    commit_sha: row.commit_sha,
    fetched_at: row.fetched_at,
  };
}

/** The fetched file tree stored at analysis time (null when not fetched). */
export async function loadFetchedRepoFiles(
  assessmentId: string,
): Promise<Record<string, string> | null> {
  const repo = await loadRepositoryForAssessment(assessmentId);
  if (!repo?.fetched_files) return null;
  const out: Record<string, string> = {};
  for (const f of repo.fetched_files) out[f.path] = f.content;
  return out;
}

export interface PublicRepoAnalysisResult {
  analysis: RepoAnalysisResult;
  repository: {
    owner: string;
    repo: string;
    repoUrl: string;
    defaultBranch: string;
    commitSha: string | null;
    fileCount: number;
    totalBytes: number;
    skippedFiles: number;
  };
}

/**
 * Step 5: analyse a PUBLIC GitHub repo URL for this assessment.
 *
 * Fetches the repo read-only via the public GitHub API (no token, no OAuth),
 * stores the fetched file tree + commit SHA on the repository row (so the
 * Lab can be seeded from it later without re-fetching), then runs the SAME
 * deterministic analysis as analyzeRepository. Fetched code is never
 * executed and never reaches an LLM raw — only sanitizeForLlm metadata.
 */
export async function analyzePublicRepoUrl(opts: {
  assessmentId: string;
  candidateId: string;
  repoUrl: string;
  fetchImpl?: typeof fetch;
}): Promise<PublicRepoAnalysisResult> {
  const assessment = await loadAssessmentForCandidate(
    opts.assessmentId,
    opts.candidateId,
  );
  if (!assessment.repository_id) {
    throw new ApiError(409, "Assessment has no repository selected");
  }
  const repoRow = await loadRepositoryForAssessment(opts.assessmentId);
  if (repoRow?.source !== "github_url") {
    throw new ApiError(
      409,
      "This assessment was not created from a public GitHub URL — create a new assessment with a GitHub URL to analyse one.",
    );
  }
  const parsed = parseGitHubRepoUrl(opts.repoUrl);
  if (!parsed) {
    throw new ApiError(
      400,
      "Not a valid public GitHub repository URL. Use https://github.com/<owner>/<repo>.",
    );
  }
  const fetched: PublicRepoFetch = await fetchPublicRepoFiles(parsed.url, {
    fetchImpl: opts.fetchImpl,
  });
  await pool.query(
    `UPDATE assessment_repositories
        SET repo_url = $2, repo_name = $3, default_branch = $4,
            commit_sha = $5, fetched_files = $6, fetched_at = now()
      WHERE id = $1`,
    [
      assessment.repository_id,
      fetched.repoUrl,
      `${fetched.owner}/${fetched.repo}`,
      fetched.defaultBranch,
      fetched.commitSha,
      JSON.stringify(fetched.files),
    ],
  );
  const analysis = await analyzeRepository({
    assessmentId: opts.assessmentId,
    candidateId: opts.candidateId,
    files: fetched.files,
    repoUrl: fetched.repoUrl,
  });
  return {
    analysis,
    repository: {
      owner: fetched.owner,
      repo: fetched.repo,
      repoUrl: fetched.repoUrl,
      defaultBranch: fetched.defaultBranch,
      commitSha: fetched.commitSha,
      fileCount: fetched.fileCount,
      totalBytes: fetched.totalBytes,
      skippedFiles: fetched.skippedFiles,
    },
  };
}

export interface ChallengeRow {
  id: string;
  assessment_id: string;
  title: string;
  problem_statement: string;
  repo_context: Record<string, unknown>;
  required_functionality: unknown[];
  acceptance_criteria: unknown[];
  difficulty: string;
  deliverables: unknown[];
  allowed_tools: unknown[];
  time_limit_minutes: number;
  test_strategy: Record<string, unknown>;
  generated_by: string;
  validation: Record<string, unknown>;
  created_at: string;
}

/** Generate + validate + store the challenge (hidden tests never leave the server). */
export async function generateChallengeFor(
  assessmentId: string,
  candidateId: string,
): Promise<ChallengeRow> {
  const assessment = await loadAssessmentForCandidate(assessmentId, candidateId);
  if (!assessment.repository_id) {
    throw new ApiError(409, "Select a project first");
  }
  const existing = await pool.query(
    `SELECT * FROM challenges WHERE assessment_id = $1`,
    [assessmentId],
  );
  if (existing.rows.length) return stripHidden(existing.rows[0]);
  const repoAnalysisRow = await getLatestRepoAnalysis(assessment.repository_id);
  if (!repoAnalysisRow) {
    throw new ApiError(409, "Analyse the repository before generating a challenge");
  }
  // Reconstruct the RepoAnalysis shape the generator expects from the
  // stored columns (flags live inside the quality JSON — see analyzeRepository).
  const quality = (repoAnalysisRow.quality as Record<string, unknown>) ?? {};
  const repoAnalysis = {
    fileCount: Number(quality.fileCount ?? 0),
    totalBytes: Number(quality.totalBytes ?? 0),
    languages: (repoAnalysisRow.languages as never) ?? [],
    frameworks: repoAnalysisRow.frameworks ?? [],
    dependencies: (repoAnalysisRow.dependencies as never) ?? [],
    structure: (repoAnalysisRow.structure as { topLevelDirs: string[]; maxDepth: number }) ?? { topLevelDirs: [], maxDepth: 0 },
    entryPoints: repoAnalysisRow.entry_points ?? [],
    tests: (repoAnalysisRow.tests as { count: number; frameworks: string[]; files: string[] }) ?? { count: 0, frameworks: [], files: [] },
    endpoints: (repoAnalysisRow.api_endpoints as never) ?? [],
    dbIntegrations: repoAnalysisRow.db_integrations ?? [],
    hasAuth: Boolean(quality.hasAuth),
    hasValidation: Boolean(quality.hasValidation),
    hasRateLimiter: Boolean(quality.hasRateLimiter),
    quality: {
      todoCount: Number(quality.todoCount ?? 0),
      fixmeCount: Number(quality.fixmeCount ?? 0),
      avgFileSizeBytes: Number(quality.avgFileSizeBytes ?? 0),
      largestFiles: (quality.largestFiles as { path: string; bytes: number }[]) ?? [],
      emptyFiles: (quality.emptyFiles as string[]) ?? [],
    },
    functionality: (quality.functionality as string[]) ?? [],
  };
  // Step 5: a GitHub-URL assessment has no profile project — the challenge
  // is titled from the repo itself (owner/repo), not the demo project.
  const repoRow = await loadRepositoryForAssessment(assessmentId);
  const projectTitle =
    repoRow?.repo_name ??
    (await pool.query(
      `SELECT title FROM candidate_projects WHERE id = $1`,
      [assessment.project_id],
    ).then((r) => (r.rows[0]?.title as string | undefined) ?? null)
    ) ?? "groundtruth-assessment-demo";
  const challenge = await generateChallengeWithAI({
    repoAnalysis,
    projectTitle,
    durationMinutes: assessment.time_limit_minutes as 30 | 45 | 60 | 90,
  });
  const validation = validateChallenge(challenge);
  if (!validation.ok) {
    throw new ApiError(500, `Generated challenge failed validation: ${validation.issues.join("; ")}`);
  }
  const inserted = await pool.query(
    `INSERT INTO challenges
       (assessment_id, title, problem_statement, repo_context, required_functionality,
        acceptance_criteria, difficulty, deliverables, allowed_tools,
        time_limit_minutes, test_strategy, hidden_tests, generated_by, validation)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) RETURNING *`,
    [
      assessmentId,
      challenge.title,
      challenge.problemStatement,
      JSON.stringify(challenge.repoContext),
      JSON.stringify(challenge.requiredFunctionality),
      JSON.stringify(challenge.acceptanceCriteria),
      challenge.difficulty,
      JSON.stringify(challenge.deliverables),
      JSON.stringify(challenge.allowedTools),
      assessment.time_limit_minutes,
      JSON.stringify({ ...challenge.testStrategy, taskType: challenge.taskType }),
      // hidden_tests column holds descriptions only — executable hidden
      // tests live server-side in services/hiddenTests.ts.
      JSON.stringify(challenge.testStrategy.hidden),
      challenge.aiAvailable ? "llm" : "deterministic",
      JSON.stringify(validation),
    ],
  );
  const row = inserted.rows[0];
  // Visible test cases: executable commands derived from the detected test
  // framework (the challenge only carries descriptions, never commands).
  const visibleCommand = defaultTestCommand(repoAnalysis.tests.frameworks ?? []);
  for (const desc of challenge.testStrategy.visible) {
    await pool.query(
      `INSERT INTO challenge_test_cases (challenge_id, kind, name, description, command)
       VALUES ($1, 'visible', $2, $3, $4)`,
      [row.id, desc.slice(0, 120), desc, visibleCommand.join(" ")],
    );
  }
  // Hidden test cases: executable commands from the server-side registry.
  for (const hidden of getHiddenTests(challenge.taskType)) {
    await pool.query(
      `INSERT INTO challenge_test_cases (challenge_id, kind, name, description, command)
       VALUES ($1, 'hidden', $2, $3, $4)`,
      [row.id, hidden.path, hidden.description, hidden.command.join(" ")],
    );
  }
  await pool.query(
    `UPDATE assessments SET status = 'ready', updated_at = now() WHERE id = $1`,
    [assessmentId],
  );
  return stripHidden(row);
}

/** Default test command for a detected framework (visible suite). */
export function defaultTestCommand(frameworks: string[]): string[] {
  if (frameworks.some((f) => /pytest/i.test(f))) return ["pytest", "-q"];
  return ["python3", "-m", "unittest", "discover", "-s", "tests", "-v"];
}

function stripHidden(row: Record<string, unknown>): ChallengeRow {
  const { hidden_tests, ...rest } = row;
  void hidden_tests;
  return rest as unknown as ChallengeRow;
}

export async function getChallengeFor(
  assessmentId: string,
  candidateId: string,
): Promise<ChallengeRow> {
  await loadAssessmentForCandidate(assessmentId, candidateId);
  const res = await pool.query(
    `SELECT * FROM challenges WHERE assessment_id = $1`,
    [assessmentId],
  );
  if (!res.rows.length) throw new ApiError(404, "Challenge not generated yet");
  return stripHidden(res.rows[0]);
}

export async function giveConsent(
  assessmentId: string,
  candidateId: string,
): Promise<AssessmentRow> {
  const assessment = await loadAssessmentForCandidate(assessmentId, candidateId);
  if (assessment.status !== "draft" && assessment.status !== "ready") {
    throw new ApiError(409, `Cannot give consent while assessment is ${assessment.status}`);
  }
  const { recordConsent } = await import("./monitoring");
  await recordConsent({ candidateId, assessmentId });
  const res = await pool.query(
    `UPDATE assessments SET consent_given_at = now(), consent_version = 'v1', updated_at = now()
     WHERE id = $1 RETURNING *`,
    [assessmentId],
  );
  return res.rows[0] as AssessmentRow;
}

export function workspaceDirFor(assessmentId: string): string {
  return path.join(workspaceRoot(), assessmentId);
}

/** Start the Lab: requires consent + a challenge; seeds the workspace. */
export async function startAssessment(opts: {
  assessmentId: string;
  candidateId: string;
  sessionId: string;
  initialFiles?: Record<string, string>;
}): Promise<{ assessment: AssessmentRow; sessionId: string; sandboxBackend: string; executionSessionId: string }> {
  const assessment = await loadAssessmentForCandidate(opts.assessmentId, opts.candidateId);
  if (assessment.status !== "ready") {
    throw new ApiError(409, `Assessment cannot be started from status ${assessment.status}`);
  }
  if (!assessment.consent_given_at) {
    throw new ApiError(409, "Monitoring consent is required before starting");
  }
  // Step 5: a GitHub-URL Lab is seeded from the fetched repo files
  // (read-only copy stored at analysis time). Otherwise the demo project.
  let files: Record<string, string>;
  if (opts.initialFiles) {
    files = opts.initialFiles;
  } else {
    const repoRow = await loadRepositoryForAssessment(opts.assessmentId);
    if (repoRow?.source === "github_url") {
      const fetched = await loadFetchedRepoFiles(opts.assessmentId);
      if (!fetched) {
        throw new ApiError(
          409,
          "This GitHub repository has not been fetched yet — analyse the repository first.",
        );
      }
      files = fetched;
    } else {
      files = await loadDemoProjectFiles().catch(() => ({}));
    }
  }
  const dir = workspaceDirFor(opts.assessmentId);
  await prepareWorkspace(dir, files);
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    for (const [p, content] of Object.entries(files)) {
      await client.query(
        `INSERT INTO assessment_files (assessment_id, path, content)
         VALUES ($1, $2, $3)
         ON CONFLICT (assessment_id, path) DO UPDATE SET content = EXCLUDED.content, updated_at = now()`,
        [opts.assessmentId, p, content],
      );
    }
    // Version 0 snapshot = the original code the challenge was generated from.
    const hash = snapshotHash(files);
    await client.query(
      `INSERT INTO code_snapshots (assessment_id, candidate_id, version, snapshot_hash, files)
       VALUES ($1, $2, 0, $3, $4) ON CONFLICT (assessment_id, version) DO NOTHING`,
      [opts.assessmentId, opts.candidateId, hash, JSON.stringify(files)],
    );
    const { detectSandbox } = await import("./execution");
    const sandbox = await detectSandbox();
    const sessionRow = await client.query(
      `INSERT INTO execution_sessions (assessment_id, candidate_id, workspace_path, status, sandbox_backend)
       VALUES ($1, $2, $3, 'active', $4) RETURNING id`,
      [opts.assessmentId, opts.candidateId, dir, sandbox.backend],
    );
    const updated = await client.query(
      `UPDATE assessments SET status = 'active', started_at = now(), updated_at = now()
       WHERE id = $1 RETURNING *`,
      [opts.assessmentId],
    );
    await client.query("COMMIT");
    await recordEvent({
      assessmentId: opts.assessmentId,
      candidateId: opts.candidateId,
      sessionId: opts.sessionId,
      eventType: "assessment_started",
      metadata: { sandbox_backend: sandbox.backend, file_count: Object.keys(files).length },
    });
    return {
      assessment: updated.rows[0] as AssessmentRow,
      sessionId: opts.sessionId,
      sandboxBackend: sandbox.backend,
      // The WS terminal connects to /ws/execution/<executionSessionId>/terminal.
      executionSessionId: sessionRow.rows[0].id as string,
    };
  } catch (err) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw err;
  } finally {
    client.release();
  }
}

export async function listFiles(
  assessmentId: string,
  candidateId: string,
): Promise<Record<string, string>> {
  await loadAssessmentForCandidate(assessmentId, candidateId);
  const res = await pool.query(
    `SELECT path, content FROM assessment_files WHERE assessment_id = $1 ORDER BY path`,
    [assessmentId],
  );
  const out: Record<string, string> = {};
  for (const row of res.rows) out[row.path as string] = row.content as string;
  return out;
}

export async function saveFile(opts: {
  assessmentId: string;
  candidateId: string;
  sessionId: string;
  path: string;
  content: string;
  previousContent?: string;
}): Promise<{ path: string; linesAdded: number; linesRemoved: number }> {
  const assessment = await loadAssessmentForCandidate(opts.assessmentId, opts.candidateId);
  if (assessment.status !== "active") {
    throw new ApiError(409, `Files can only be edited while the assessment is active (now ${assessment.status})`);
  }
  if (opts.path.includes("..") || path.isAbsolute(opts.path)) {
    throw new ApiError(400, "Invalid file path");
  }
  const prev = await pool.query(
    `SELECT content FROM assessment_files WHERE assessment_id = $1 AND path = $2`,
    [opts.assessmentId, opts.path],
  );
  const existed = prev.rows.length > 0;
  const oldContent = existed ? (prev.rows[0].content as string) : "";
  const linesAdded = countLines(opts.content) - Math.min(countLines(oldContent), countLines(opts.content));
  const linesRemoved = Math.max(0, countLines(oldContent) - countLines(opts.content));
  await pool.query(
    `INSERT INTO assessment_files (assessment_id, path, content)
     VALUES ($1, $2, $3)
     ON CONFLICT (assessment_id, path) DO UPDATE SET content = EXCLUDED.content, updated_at = now()`,
    [opts.assessmentId, opts.path, opts.content],
  );
  // Keep the on-disk workspace in sync for the sandbox runner.
  const dir = workspaceDirFor(opts.assessmentId);
  const target = path.join(dir, opts.path);
  const { mkdir, writeFile } = await import("node:fs/promises");
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, opts.content, "utf8");
  await recordEvent({
    assessmentId: opts.assessmentId,
    candidateId: opts.candidateId,
    sessionId: opts.sessionId,
    eventType: existed ? "file_modified" : "file_created",
    filePath: opts.path,
    metadata: { lines_added: linesAdded, lines_removed: linesRemoved },
  });
  return { path: opts.path, linesAdded, linesRemoved };
}

function countLines(s: string): number {
  return s === "" ? 0 : s.split("\n").length;
}

/** Run a command in the assessment's sandboxed workspace (allowlisted only). */
export async function runInSandbox(opts: {
  assessmentId: string;
  candidateId: string;
  sessionId: string;
  command: string[];
  kind: "run" | "test";
}): Promise<RunResult & { parsed?: ReturnType<typeof parseTestOutput> }> {
  const assessment = await loadAssessmentForCandidate(opts.assessmentId, opts.candidateId);
  if (assessment.status !== "active") {
    throw new ApiError(409, `Cannot execute while assessment is ${assessment.status}`);
  }
  const dir = workspaceDirFor(opts.assessmentId);
  const result = await runSandboxed({ workspaceDir: dir, command: opts.command });
  const parsed = opts.kind === "test" ? parseTestOutput(result.stdout + result.stderr) : undefined;
  await recordEvent({
    assessmentId: opts.assessmentId,
    candidateId: opts.candidateId,
    sessionId: opts.sessionId,
    eventType: opts.kind === "test" ? "test_run" : "terminal_command",
    metadata:
      opts.kind === "test"
        ? {
            test_command: opts.command.join(" "),
            passed: parsed?.passed ?? 0,
            failed: parsed?.failed ?? 0,
            total: parsed?.total ?? 0,
            results: parsed?.failures ?? [],
          }
        : {
            command: opts.command.join(" "),
            exit_code: result.exitCode,
            duration_ms: result.durationMs,
            output_excerpt: (result.stdout + result.stderr).slice(0, 500),
          },
  });
  // Sync any files the run produced back into the DB.
  const current = await readWorkspaceFiles(dir);
  for (const [p, content] of Object.entries(current)) {
    await pool.query(
      `INSERT INTO assessment_files (assessment_id, path, content)
       VALUES ($1, $2, $3)
       ON CONFLICT (assessment_id, path) DO UPDATE SET content = EXCLUDED.content, updated_at = now()`,
      [opts.assessmentId, p, content],
    );
  }
  return { ...result, parsed };
}

export interface SubmitResult {
  assessment: AssessmentRow;
  snapshotVersion: number;
  snapshotHash: string;
  visibleTests: ReturnType<typeof parseTestOutput>;
  hiddenTests: ReturnType<typeof parseTestOutput>;
}

/**
 * Submission: freeze a versioned snapshot + hash, run visible tests, then
 * hidden tests (server-side only), store the evidence, move to evaluating.
 * The evaluation runs against this exact snapshot.
 */
export async function submitAssessment(opts: {
  assessmentId: string;
  candidateId: string;
  sessionId: string;
}): Promise<SubmitResult> {
  const assessment = await loadAssessmentForCandidate(opts.assessmentId, opts.candidateId);
  if (assessment.status !== "active") {
    throw new ApiError(409, `Cannot submit from status ${assessment.status}`);
  }
  const files = await listFiles(opts.assessmentId, opts.candidateId);
  const hash = snapshotHash(files);
  const versionRow = await pool.query(
    `SELECT COALESCE(MAX(version), -1) + 1 AS v FROM code_snapshots WHERE assessment_id = $1`,
    [opts.assessmentId],
  );
  const version = (versionRow.rows[0].v as number) || 1;
  await pool.query(
    `INSERT INTO code_snapshots (assessment_id, candidate_id, version, snapshot_hash, files)
     VALUES ($1, $2, $3, $4, $5)`,
    [opts.assessmentId, opts.candidateId, version, hash, JSON.stringify(files)],
  );
  await recordEvent({
    assessmentId: opts.assessmentId,
    candidateId: opts.candidateId,
    sessionId: opts.sessionId,
    eventType: "submission_attempt",
    metadata: { version, snapshot_hash: hash, file_count: Object.keys(files).length },
  });
  // Visible tests first, then hidden tests — both in the sandbox, both
  // against the frozen snapshot files (workspace already synced).
  const dir = workspaceDirFor(opts.assessmentId);
  const challenge = await getChallengeFor(opts.assessmentId, opts.candidateId);
  const visibleCmd = await firstTestCommand(challenge);
  const visible = await runSandboxed({ workspaceDir: dir, command: visibleCmd });
  const visibleParsed = parseTestOutput(visible.stdout + visible.stderr);
  await recordEvent({
    assessmentId: opts.assessmentId,
    candidateId: opts.candidateId,
    sessionId: opts.sessionId,
    eventType: "test_run",
    metadata: {
      test_command: visibleCmd.join(" "),
      passed: visibleParsed.passed,
      failed: visibleParsed.failed,
      total: visibleParsed.total,
      results: visibleParsed.failures,
      visibility: "visible",
    },
  });
  // Hidden tests: inject the server-side hidden test files into the
  // workspace, run them, then remove them again — the candidate never sees
  // them. The task type is stored inside the challenge's test_strategy JSON.
  const challengeIdRow = await pool.query(
    `SELECT id FROM challenges WHERE assessment_id = $1`,
    [opts.assessmentId],
  );
  const challengeId = challengeIdRow.rows[0]?.id as string | undefined;
  const taskType = (
    challenge.test_strategy as { taskType?: string }
  ).taskType;
  const hiddenTests = taskType ? getHiddenTests(taskType) : [];
  const hiddenRows = challengeId
    ? (
        await pool.query(
          `SELECT command FROM challenge_test_cases WHERE challenge_id = $1 AND kind = 'hidden'`,
          [challengeId],
        )
      ).rows
    : [];
  let hiddenParsed = { passed: 0, failed: 0, total: 0, failures: [] as string[] };
  if (hiddenTests.length && hiddenRows.length) {
    const { writeFile, rm, mkdir } = await import("node:fs/promises");
    const hiddenDir = path.join(dir, "_gt_hidden");
    await mkdir(hiddenDir, { recursive: true });
    try {
      for (const t of hiddenTests) {
        await mkdir(path.dirname(path.join(dir, t.path)), { recursive: true });
        await writeFile(path.join(dir, t.path), t.content, "utf8");
      }
      for (const row of hiddenRows) {
        const cmd = String(row.command).split(" ").filter(Boolean);
        const out = await runSandboxed({ workspaceDir: dir, command: cmd });
        const p = parseTestOutput(out.stdout + out.stderr);
        hiddenParsed = {
          passed: hiddenParsed.passed + p.passed,
          failed: hiddenParsed.failed + p.failed,
          total: hiddenParsed.total + p.total,
          failures: [...hiddenParsed.failures, ...p.failures],
        };
      }
    } finally {
      await rm(hiddenDir, { recursive: true, force: true });
    }
  } else if (hiddenRows.length === 0) {
    // No registered hidden tests for this task type: the hidden suite is
    // the visible suite re-run — recorded honestly as such.
    hiddenParsed = visibleParsed;
  }
  await recordEvent({
    assessmentId: opts.assessmentId,
    candidateId: opts.candidateId,
    sessionId: opts.sessionId,
    eventType: "test_run",
    metadata: {
      test_command: "hidden test suite",
      passed: hiddenParsed.passed,
      failed: hiddenParsed.failed,
      total: hiddenParsed.total,
      results: hiddenParsed.failures,
      visibility: "hidden",
    },
  });
  const updated = await pool.query(
    `UPDATE assessments SET status = 'evaluating', submitted_at = now(), updated_at = now()
     WHERE id = $1 RETURNING *`,
    [opts.assessmentId],
  );
  // Phase 7: the candidate's assessment is now being evaluated.
  await notifyCandidate(opts.candidateId, {
    type: "assessment",
    title: "Assessment submitted",
    body: "Your assessment was submitted and evaluation has started. You will be notified when the report is ready.",
    link: "/assessment",
  });
  return {
    assessment: updated.rows[0] as AssessmentRow,
    snapshotVersion: version,
    snapshotHash: hash,
    visibleTests: visibleParsed,
    hiddenTests: hiddenParsed,
  };
}

async function firstTestCommand(challenge: ChallengeRow): Promise<string[]> {
  const cases = await pool.query(
    `SELECT command FROM challenge_test_cases WHERE challenge_id = $1 AND kind = 'visible' ORDER BY created_at LIMIT 1`,
    [challenge.id],
  );
  const first = cases.rows[0]?.command as string | undefined;
  if (first) return first.split(/\s+/).filter(Boolean);
  return ["python3", "-m", "unittest", "discover", "-s", "tests", "-v"];
}
