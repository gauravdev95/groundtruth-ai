import { Router } from "express";
import { z } from "zod";
import { pool } from "../config/db";
import { ApiError, asyncHandler } from "../middleware/errorHandler";
import { requireAuth, requireRole, type AuthRequest } from "../middleware/auth";
import { assessmentRateLimit, llmRateLimit } from "../middleware/rateLimit";
import {
  ownCandidateId,
  loadAssessmentForCandidate,
  loadAssessmentById,
  createAssessment,
  listAssessments,
  analyzeRepository,
  analyzePublicRepoUrl,
  getLatestRepoAnalysis,
  loadRepositoryForAssessment,
  toPublicRepository,
  generateChallengeFor,
  getChallengeFor,
  giveConsent,
  startAssessment,
  listFiles,
  saveFile,
  runInSandbox,
  submitAssessment,
  loadDemoProjectFiles,
  workspaceDirFor,
} from "../services/assessments";
import { analyzeProfileStrengthWithAI } from "../services/strength";
import { loadFullProfile } from "../services/student";
import { evaluateAssessment, getEvaluation } from "../services/evaluation";
import {
  generateInterview,
  toPublicGenerateResult,
  getInterviewReport,
  loadInterviewForCandidate,
} from "../services/interview";
import {
  startSession,
  confirmReadiness,
  getSessionState,
  submitSessionAnswer,
  explainAgain,
  finishSession,
  retryEvaluation,
  getInterviewReportForRecruiter,
} from "../services/interviewSession";
import { buildVerifiedProfile, getCandidateEvidenceForRecruiter } from "../services/verified";
import {
  computeCompetencyProfileForAssessment,
  getCompetencyProfileForCandidate,
  getCompetencyProfileForRecruiter,
} from "../services/competencyProfile";
import {
  recordEvent,
  listEvents,
  buildActivitySummary,
  analyzeIntegrity,
  recordIntegrityFindings,
  MONITORING_COLLECTED,
  MONITORING_PURPOSE,
  MONITORING_RETENTION_DAYS,
  MONITORING_RECRUITER_VISIBILITY,
  MONITORING_CONSENT_VERSION,
  snapshotHash,
} from "../services/monitoring";
import { detectSandbox } from "../services/execution";

// ── Assessment API ─────────────────────────────────────────────────────────
// Mounted at /api/assessments. All routes require a signed-in user; student
// routes require role "candidate" and ownership (a candidate only ever
// touches their own assessments). Recruiter routes check application
// ownership. Hidden tests are never serialized in any response.

const router = Router();
router.use(requireAuth);
router.use(assessmentRateLimit);

function candidateId(req: AuthRequest): Promise<string> {
  if (!req.user) throw new ApiError(401, "Unauthorized");
  return ownCandidateId(req.user.sub);
}

const filesSchema = z.array(
  z.object({ path: z.string().min(1).max(200), content: z.string().max(2_000_000) }),
);

const createAssessmentSchema = z.object({
  projectId: z.string().uuid().optional().nullable(),
  repoUrl: z.string().url().optional().nullable(),
  source: z.enum(["profile_project", "github_url", "github_account", "manual"]),
  timeLimitMinutes: z.union([z.literal(30), z.literal(45), z.literal(60), z.literal(90)]).optional(),
});

// ── Profile strength ───────────────────────────────────────────────────────
router.post(
  "/profile/analyze",
  llmRateLimit,
  requireRole("candidate"),
  asyncHandler(async (req: AuthRequest, res) => {
    const id = await candidateId(req);
    const profile = await loadFullProfile(id);
    const report = await analyzeProfileStrengthWithAI({
      candidate: {
        headline: profile.candidate.headline,
        location: profile.candidate.location,
        summary: profile.candidate.summary,
        degree: profile.candidate.degree,
        branch: profile.candidate.branch,
        graduation_year: profile.candidate.graduation_year,
        target_roles: profile.candidate.target_roles,
        github_handle: profile.candidate.github_handle,
        github_url: profile.candidate.github_url,
        linkedin_url: profile.candidate.linkedin_url,
      },
      skills: profile.skills.map((s) => ({ name: s.name, category: s.category, source: s.source })),
      projects: profile.projects.map((p) => ({
        title: p.title,
        description: p.description,
        technologies: p.technologies,
        repo_url: p.repo_url,
      })),
      codingProfiles: profile.coding_profiles.map((c) => ({
        platform: c.platform,
        username: c.username,
      })),
      certificates: profile.certificates.map((c) => ({
        title: c.title,
        issuer: c.issuer,
      })),
      experience: profile.experience.map((e) => ({
        title: e.title,
        organization: e.organization,
        description: e.description,
      })),
      resumes: profile.resumes.map((r) => ({ extracted_text: r.extracted_text })),
    });
    await pool.query(
      `INSERT INTO profile_analyses
         (candidate_id, overall_score, category_scores, missing, weak_areas,
          recommendations, suggested_skills, ai_available, ai_summary)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [
        id,
        report.overall,
        JSON.stringify(report.categories),
        JSON.stringify(report.missing),
        JSON.stringify(report.weakAreas),
        JSON.stringify(report.recommendations),
        report.suggestedSkills,
        report.aiAvailable,
        report.aiSummary,
      ],
    );
    res.status(201).json(report);
  }),
);

router.get(
  "/profile/strength",
  requireRole("candidate"),
  asyncHandler(async (req: AuthRequest, res) => {
    const id = await candidateId(req);
    const row = await pool.query(
      `SELECT * FROM profile_analyses WHERE candidate_id = $1 ORDER BY created_at DESC LIMIT 1`,
      [id],
    );
    if (!row.rows.length) {
      res.status(404).json({ error: "No profile analysis yet — run POST /profile/analyze first." });
      return;
    }
    res.json(row.rows[0]);
  }),
);

router.get(
  "/profile/recommendations",
  requireRole("candidate"),
  asyncHandler(async (req: AuthRequest, res) => {
    const id = await candidateId(req);
    const row = await pool.query(
      `SELECT recommendations, missing, weak_areas, suggested_skills, created_at
         FROM profile_analyses WHERE candidate_id = $1 ORDER BY created_at DESC LIMIT 1`,
      [id],
    );
    if (!row.rows.length) {
      res.status(404).json({ error: "No profile analysis yet — run POST /profile/analyze first." });
      return;
    }
    res.json(row.rows[0]);
  }),
);

router.get(
  "/profile/verified",
  requireRole("candidate"),
  asyncHandler(async (req: AuthRequest, res) => {
    const id = await candidateId(req);
    res.json(await buildVerifiedProfile(id));
  }),
);

// ── Demo project ───────────────────────────────────────────────────────────
router.get(
  "/demo-project",
  asyncHandler(async (_req, res) => {
    res.json({ files: await loadDemoProjectFiles() });
  }),
);

// ── Projects ───────────────────────────────────────────────────────────────
router.get(
  "/projects",
  requireRole("candidate"),
  asyncHandler(async (req: AuthRequest, res) => {
    const id = await candidateId(req);
    const profile = await loadFullProfile(id);
    res.json({ projects: profile.projects, repositories: [] });
  }),
);

router.post(
  "/projects/select",
  requireRole("candidate"),
  asyncHandler(async (req: AuthRequest, res) => {
    const parsed = createAssessmentSchema.safeParse(req.body);
    if (!parsed.success) {
      throw new ApiError(400, parsed.error.issues.map((i) => i.message).join("; "));
    }
    const id = await candidateId(req);
    const assessment = await createAssessment({
      candidateId: id,
      projectId: parsed.data.projectId,
      repoUrl: parsed.data.repoUrl,
      source: parsed.data.source,
      timeLimitMinutes: parsed.data.timeLimitMinutes,
    });
    res.status(201).json(assessment);
  }),
);

router.post(
  "/projects/analyze",
  requireRole("candidate"),
  asyncHandler(async (req: AuthRequest, res) => {
    const parsed = z
      .object({ assessmentId: z.string().uuid(), repoUrl: z.string().url().optional(), files: filesSchema })
      .safeParse(req.body);
    if (!parsed.success) {
      throw new ApiError(400, parsed.error.issues.map((i) => i.message).join("; "));
    }
    const id = await candidateId(req);
    res.json(
      await analyzeRepository({
        assessmentId: parsed.data.assessmentId,
        candidateId: id,
        files: parsed.data.files,
        repoUrl: parsed.data.repoUrl,
      }),
    );
  }),
);

// Step 5: analyse a PUBLIC GitHub repo URL (read-only, no token, no OAuth).
// A public URL must NOT return 409 — that status is kept only for flows
// that genuinely need a connected GitHub account (private repos, the
// github_account source).
router.post(
  "/projects/analyze-github-url",
  requireRole("candidate"),
  asyncHandler(async (req: AuthRequest, res) => {
    const parsed = z
      .object({ assessmentId: z.string().uuid(), repoUrl: z.string().min(1).max(500) })
      .safeParse(req.body);
    if (!parsed.success) {
      throw new ApiError(400, parsed.error.issues.map((i) => i.message).join("; "));
    }
    const id = await candidateId(req);
    res.json(
      await analyzePublicRepoUrl({
        assessmentId: parsed.data.assessmentId,
        candidateId: id,
        repoUrl: parsed.data.repoUrl,
      }),
    );
  }),
);

// ── Assessments ────────────────────────────────────────────────────────────
router.post(
  "/",
  requireRole("candidate"),
  asyncHandler(async (req: AuthRequest, res) => {
    const parsed = createAssessmentSchema.safeParse(req.body);
    if (!parsed.success) {
      throw new ApiError(400, parsed.error.issues.map((i) => i.message).join("; "));
    }
    const id = await candidateId(req);
    res.status(201).json(
      await createAssessment({
        candidateId: id,
        projectId: parsed.data.projectId,
        repoUrl: parsed.data.repoUrl,
        source: parsed.data.source,
        timeLimitMinutes: parsed.data.timeLimitMinutes,
      }),
    );
  }),
);

router.get(
  "/",
  requireRole("candidate"),
  asyncHandler(async (req: AuthRequest, res) => {
    const id = await candidateId(req);
    res.json(await listAssessments(id));
  }),
);

router.get(
  "/:id",
  requireRole("candidate"),
  asyncHandler(async (req: AuthRequest, res) => {
    const id = await candidateId(req);
    const assessment = await loadAssessmentForCandidate(req.params.id, id);
    const challenge = await getChallengeFor(req.params.id, id).catch(() => null);
    const repoAnalysis = assessment.repository_id
      ? await getLatestRepoAnalysis(assessment.repository_id)
      : null;
    const repository = toPublicRepository(
      await loadRepositoryForAssessment(req.params.id),
    );
    res.json({ ...assessment, challenge, repoAnalysis, repository });
  }),
);

router.get(
  "/:id/challenge",
  requireRole("candidate"),
  asyncHandler(async (req: AuthRequest, res) => {
    const id = await candidateId(req);
    res.json(await getChallengeFor(req.params.id, id));
  }),
);

router.post(
  "/:id/challenge/generate",
  llmRateLimit,
  requireRole("candidate"),
  asyncHandler(async (req: AuthRequest, res) => {
    const id = await candidateId(req);
    res.status(201).json(await generateChallengeFor(req.params.id, id));
  }),
);

router.get(
  "/:id/consent",
  requireRole("candidate"),
  asyncHandler(async (req: AuthRequest, res) => {
    const id = await candidateId(req);
    await loadAssessmentForCandidate(req.params.id, id);
    const rows = await pool.query(
      `SELECT * FROM monitoring_consent_records WHERE assessment_id = $1 ORDER BY given_at DESC LIMIT 1`,
      [req.params.id],
    );
    res.json({
      version: MONITORING_CONSENT_VERSION,
      collected: MONITORING_COLLECTED,
      purpose: MONITORING_PURPOSE,
      retentionDays: MONITORING_RETENTION_DAYS,
      recruiterVisibility: MONITORING_RECRUITER_VISIBILITY,
      given: rows.rows[0] ?? null,
    });
  }),
);

router.post(
  "/:id/consent",
  requireRole("candidate"),
  asyncHandler(async (req: AuthRequest, res) => {
    const id = await candidateId(req);
    res.json(await giveConsent(req.params.id, id));
  }),
);

router.post(
  "/:id/start",
  requireRole("candidate"),
  asyncHandler(async (req: AuthRequest, res) => {
    const parsed = z
      .object({
        sessionId: z.string().uuid(),
        initialFiles: z.record(z.string()).optional(),
      })
      .safeParse(req.body);
    if (!parsed.success) {
      throw new ApiError(400, parsed.error.issues.map((i) => i.message).join("; "));
    }
    const id = await candidateId(req);
    res.json(
      await startAssessment({
        assessmentId: req.params.id,
        candidateId: id,
        sessionId: parsed.data.sessionId,
        initialFiles: parsed.data.initialFiles,
      }),
    );
  }),
);

// ── Lab files (autosave) ───────────────────────────────────────────────────
router.get(
  "/:id/files",
  requireRole("candidate"),
  asyncHandler(async (req: AuthRequest, res) => {
    const id = await candidateId(req);
    res.json({ files: await listFiles(req.params.id, id) });
  }),
);

router.put(
  "/:id/files/:path(*)",
  requireRole("candidate"),
  asyncHandler(async (req: AuthRequest, res) => {
    const parsed = z
      .object({ content: z.string().max(2_000_000), sessionId: z.string().uuid() })
      .safeParse(req.body);
    if (!parsed.success) {
      throw new ApiError(400, parsed.error.issues.map((i) => i.message).join("; "));
    }
    const id = await candidateId(req);
    res.json(
      await saveFile({
        assessmentId: req.params.id,
        candidateId: id,
        sessionId: parsed.data.sessionId,
        path: req.params.path as string,
        content: parsed.data.content,
      }),
    );
  }),
);

// ── Monitoring events (client-reported) ────────────────────────────────────
router.post(
  "/:id/events",
  requireRole("candidate"),
  asyncHandler(async (req: AuthRequest, res) => {
    const parsed = z
      .object({
        sessionId: z.string().uuid(),
        eventType: z.string().min(1).max(50),
        filePath: z.string().max(500).optional().nullable(),
        metadata: z.record(z.unknown()).optional(),
        clientEventId: z.string().max(100).optional().nullable(),
      })
      .safeParse(req.body);
    if (!parsed.success) {
      throw new ApiError(400, parsed.error.issues.map((i) => i.message).join("; "));
    }
    const id = await candidateId(req);
    await loadAssessmentForCandidate(req.params.id, id);
    const stored = await recordEvent({
      assessmentId: req.params.id,
      candidateId: id,
      sessionId: parsed.data.sessionId,
      eventType: parsed.data.eventType,
      filePath: parsed.data.filePath,
      metadata: (parsed.data.metadata ?? {}) as Record<string, unknown>,
      clientEventId: parsed.data.clientEventId,
    });
    res.status(stored ? 201 : 200).json({ recorded: stored !== null });
  }),
);

router.get(
  "/:id/monitoring",
  requireRole("candidate"),
  asyncHandler(async (req: AuthRequest, res) => {
    const id = await candidateId(req);
    const assessment = await loadAssessmentForCandidate(req.params.id, id);
    const events = await listEvents(req.params.id);
    const summary = buildActivitySummary(req.params.id, events);
    const integrity = await pool.query(
      `SELECT * FROM integrity_findings WHERE assessment_id = $1 ORDER BY created_at DESC LIMIT 20`,
      [req.params.id],
    );
    res.json({
      status: "monitoring_active",
      assessmentStatus: assessment.status,
      summary,
      integrity: integrity.rows,
      events: events.slice(-100),
    });
  }),
);

// ── Execution (Lab Run / Test) ─────────────────────────────────────────────
router.get(
  "/:id/execution/session",
  requireRole("candidate"),
  asyncHandler(async (req: AuthRequest, res) => {
    const id = await candidateId(req);
    await loadAssessmentForCandidate(req.params.id, id);
    const row = await pool.query(
      `SELECT id, status, sandbox_backend, created_at FROM execution_sessions
        WHERE assessment_id = $1 ORDER BY created_at DESC LIMIT 1`,
      [req.params.id],
    );
    if (!row.rows.length) {
      res.status(404).json({ error: "No execution session — start the assessment first." });
      return;
    }
    res.json(row.rows[0]);
  }),
);

router.get(
  "/:id/execution/status",
  requireRole("candidate"),
  asyncHandler(async (req: AuthRequest, res) => {
    const id = await candidateId(req);
    await loadAssessmentForCandidate(req.params.id, id);
    const sandbox = await detectSandbox();
    res.json({
      sandboxBackend: sandbox.backend,
      reason: sandbox.reason,
      workspace: workspaceDirFor(req.params.id),
    });
  }),
);

router.post(
  "/:id/execution/run",
  requireRole("candidate"),
  asyncHandler(async (req: AuthRequest, res) => {
    const parsed = z
      .object({ sessionId: z.string().uuid(), command: z.array(z.string().min(1)).min(1).max(10) })
      .safeParse(req.body);
    if (!parsed.success) {
      throw new ApiError(400, parsed.error.issues.map((i) => i.message).join("; "));
    }
    const id = await candidateId(req);
    res.json(
      await runInSandbox({
        assessmentId: req.params.id,
        candidateId: id,
        sessionId: parsed.data.sessionId,
        command: parsed.data.command,
        kind: "run",
      }),
    );
  }),
);

router.post(
  "/:id/execution/test",
  requireRole("candidate"),
  asyncHandler(async (req: AuthRequest, res) => {
    const parsed = z
      .object({
        sessionId: z.string().uuid(),
        command: z.array(z.string().min(1)).min(1).max(10).optional(),
      })
      .safeParse(req.body);
    if (!parsed.success) {
      throw new ApiError(400, parsed.error.issues.map((i) => i.message).join("; "));
    }
    const id = await candidateId(req);
    const command = parsed.data.command ?? ["python3", "-m", "unittest", "discover", "-s", "tests", "-v"];
    res.json(
      await runInSandbox({
        assessmentId: req.params.id,
        candidateId: id,
        sessionId: parsed.data.sessionId,
        command,
        kind: "test",
      }),
    );
  }),
);

// ── Submission + evaluation ────────────────────────────────────────────────
router.post(
  "/:id/submit",
  requireRole("candidate"),
  asyncHandler(async (req: AuthRequest, res) => {
    const parsed = z.object({ sessionId: z.string().uuid() }).safeParse(req.body);
    if (!parsed.success) {
      throw new ApiError(400, parsed.error.issues.map((i) => i.message).join("; "));
    }
    const id = await candidateId(req);
    const result = await submitAssessment({
      assessmentId: req.params.id,
      candidateId: id,
      sessionId: parsed.data.sessionId,
    });
    res.json({
      status: "submitted",
      snapshotVersion: result.snapshotVersion,
      snapshotHash: result.snapshotHash,
      visibleTests: result.visibleTests,
      hiddenTests: {
        passed: result.hiddenTests.passed,
        failed: result.hiddenTests.failed,
        total: result.hiddenTests.total,
      },
    });
  }),
);

router.post(
  "/:id/evaluate",
  llmRateLimit,
  requireRole("candidate"),
  asyncHandler(async (req: AuthRequest, res) => {
    const id = await candidateId(req);
    await loadAssessmentForCandidate(req.params.id, id);
    res.json(await evaluateAssessment(req.params.id));
  }),
);

router.get(
  "/:id/evaluation",
  requireRole("candidate"),
  asyncHandler(async (req: AuthRequest, res) => {
    const id = await candidateId(req);
    await loadAssessmentForCandidate(req.params.id, id);
    const evaluation = await getEvaluation(req.params.id);
    if (!evaluation) {
      res.status(404).json({ error: "No evaluation yet" });
      return;
    }
    res.json(evaluation);
  }),
);

// ── Monitoring report (recruiter) ──────────────────────────────────────────
router.get(
  "/:id/monitoring/report",
  requireRole("recruiter", "admin"),
  asyncHandler(async (req: AuthRequest, res) => {
    const assessment = await loadAssessmentById(req.params.id);
    if (!req.user) throw new ApiError(401, "Unauthorized");
    const allowed = await pool.query(
      `SELECT 1 FROM applications a JOIN jobs j ON j.id = a.job_id
        JOIN companies c ON c.id = j.company_id
       WHERE a.candidate_id = $1 AND c.created_by = $2 LIMIT 1`,
      [assessment.candidate_id, req.user.sub],
    );
    if (!allowed.rows.length && req.user.role !== "admin") {
      throw new ApiError(403, "You can only view reports for candidates who applied to your jobs");
    }
    const events = await listEvents(req.params.id);
    const summary = buildActivitySummary(req.params.id, events);
    const integrity = await pool.query(
      `SELECT * FROM integrity_findings WHERE assessment_id = $1 ORDER BY created_at DESC`,
      [req.params.id],
    );
    const evaluation = await getEvaluation(req.params.id);
    // Integrity analysis runs on the recorded evidence at report time.
    const files = await listFilesForReport(req.params.id);
    const findings = analyzeIntegrity({
      assessmentId: req.params.id,
      originalFiles: Object.keys(files.original),
      snapshotFiles: Object.keys(files.latest),
      snapshotHash: files.latestHash,
      expectedHash: files.latestHash,
      events,
      snapshots: [],
    });
    res.json({
      assessmentId: req.params.id,
      candidateId: assessment.candidate_id,
      summary,
      integrityFindings: integrity.rows.length ? integrity.rows : findings,
      evaluation,
      timeline: events.map((e) => ({
        at: e.created_at,
        type: e.event_type,
        file: e.file_path,
        metadata: e.metadata,
      })),
    });
  }),
);

async function listFilesForReport(assessmentId: string): Promise<{
  original: Record<string, string>;
  latest: Record<string, string>;
  latestHash: string;
}> {
  const original = await pool.query(
    `SELECT files, snapshot_hash FROM code_snapshots WHERE assessment_id = $1 AND version = 0`,
    [assessmentId],
  );
  const latest = await pool.query(
    `SELECT files, snapshot_hash FROM code_snapshots WHERE assessment_id = $1 ORDER BY version DESC LIMIT 1`,
    [assessmentId],
  );
  return {
    original: (original.rows[0]?.files as Record<string, string> | undefined) ?? {},
    latest: (latest.rows[0]?.files as Record<string, string> | undefined) ?? {},
    latestHash: (latest.rows[0]?.snapshot_hash as string | undefined) ?? "",
  };
}

// ── Interview (Phase C session flow) ───────────────────────────────────────
// Pre-generation: POST /:id/interview/generate creates the interview with
// exactly 7 frozen questions (competency spec persisted). Session:
// start → readiness → GET /session (begins the clock, serves Q1) → answer
// one question at a time → finish (explicit; GET /report never finalises).
router.post(
  "/:id/interview/generate",
  llmRateLimit,
  requireRole("candidate"),
  asyncHandler(async (req: AuthRequest, res) => {
    const parsed = z
      .object({ roleId: z.string().min(1).max(100).optional() })
      .safeParse(req.body ?? {});
    if (!parsed.success) {
      throw new ApiError(400, parsed.error.issues.map((i) => i.message).join("; "));
    }
    const id = await candidateId(req);
    const result = await generateInterview({
      assessmentId: req.params.id,
      candidateId: id,
      roleId: parsed.data.roleId,
    });
    // Public shape only: never send the full question specs (expected
    // points / rubrics) to the candidate — see toPublicGenerateResult.
    res.status(201).json(toPublicGenerateResult(result));
  }),
);

// Session view: interview + session state + ONLY the current question.
// Never returns the full question list (future questions stay hidden).
router.get(
  "/interviews/:interviewId",
  requireRole("candidate"),
  asyncHandler(async (req: AuthRequest, res) => {
    const id = await candidateId(req);
    const interview = await loadInterviewForCandidate(req.params.interviewId, id);
    const session = await getSessionState({ interviewId: req.params.interviewId, candidateId: id });
    res.json({ interview, session });
  }),
);

router.post(
  "/interviews/:interviewId/session/start",
  requireRole("candidate"),
  asyncHandler(async (req: AuthRequest, res) => {
    const id = await candidateId(req);
    res.status(201).json(
      await startSession({ interviewId: req.params.interviewId, candidateId: id }),
    );
  }),
);

router.post(
  "/interviews/:interviewId/session/readiness",
  requireRole("candidate"),
  asyncHandler(async (req: AuthRequest, res) => {
    const parsed = z.object({ acknowledged: z.boolean() }).safeParse(req.body);
    if (!parsed.success) {
      throw new ApiError(400, parsed.error.issues.map((i) => i.message).join("; "));
    }
    const id = await candidateId(req);
    res.json(
      await confirmReadiness({
        interviewId: req.params.interviewId,
        candidateId: id,
        acknowledged: parsed.data.acknowledged,
      }),
    );
  }),
);

router.get(
  "/interviews/:interviewId/session",
  requireRole("candidate"),
  asyncHandler(async (req: AuthRequest, res) => {
    const id = await candidateId(req);
    res.json(
      await getSessionState({ interviewId: req.params.interviewId, candidateId: id }),
    );
  }),
);

router.post(
  "/interviews/:interviewId/session/answer",
  llmRateLimit,
  requireRole("candidate"),
  asyncHandler(async (req: AuthRequest, res) => {
    const parsed = z
      .object({
        questionId: z.string().uuid(),
        answer: z.string().max(20000),
        confirmShort: z.boolean().optional(),
      })
      .safeParse(req.body);
    if (!parsed.success) {
      throw new ApiError(400, parsed.error.issues.map((i) => i.message).join("; "));
    }
    const id = await candidateId(req);
    res.json(
      await submitSessionAnswer({
        interviewId: req.params.interviewId,
        candidateId: id,
        questionId: parsed.data.questionId,
        answer: parsed.data.answer,
        confirmShort: parsed.data.confirmShort,
      }),
    );
  }),
);

router.post(
  "/interviews/:interviewId/session/explain-again",
  llmRateLimit,
  requireRole("candidate"),
  asyncHandler(async (req: AuthRequest, res) => {
    const id = await candidateId(req);
    res.json(
      await explainAgain({ interviewId: req.params.interviewId, candidateId: id }),
    );
  }),
);

router.post(
  "/interviews/:interviewId/session/finish",
  requireRole("candidate"),
  asyncHandler(async (req: AuthRequest, res) => {
    const id = await candidateId(req);
    res.json(
      await finishSession({ interviewId: req.params.interviewId, candidateId: id }),
    );
  }),
);

// P0 F3: retry a failed evaluation — POST /interviews/:id/session/retry-evaluation
// `{questionId}`. Candidate-owner only (same ownership check as the
// session endpoints — another candidate gets a 404) or an admin bypass
// (same pattern as the recruiter report gate). Re-scores the STORED
// answer only; the submitted answer is never unlocked or overwritten.
// Completed → idempotent stored result, no new attempt row (200).
// In-flight duplicate retry → 409; permanently failed / no retries
// remain → 409. Otherwise runs the bounded retry loop (max 3 attempts
// total for transient failures, 2 when every failure is an invalid
// model response or an auth failure; exponential backoff + jitter
// between attempts) and returns the final state — completed with a
// score, or retryable_failed / permanently_failed with failureKind and
// no score (a missing score is never fabricated, never counted as
// zero). P1 F5: `{questionId}` may also be a FOLLOW-UP question id —
// the stored follow-up answer is re-scored from interview_followups
// and a successful retry surfaces in the report via its completed
// attempt row. Auth failures (HTTP 401/403 from the provider) carry
// failureKind "auth_failed", distinct from 5xx server errors.
router.post(
  "/interviews/:interviewId/session/retry-evaluation",
  llmRateLimit,
  requireRole("candidate", "admin"),
  asyncHandler(async (req: AuthRequest, res) => {
    const parsed = z
      .object({ questionId: z.string().uuid() })
      .safeParse(req.body);
    if (!parsed.success) {
      throw new ApiError(400, parsed.error.issues.map((i) => i.message).join("; "));
    }
    if (!req.user) throw new ApiError(401, "Unauthorized");
    if (req.user.role === "admin") {
      res.json(
        await retryEvaluation({
          interviewId: req.params.interviewId,
          questionId: parsed.data.questionId,
          isAdmin: true,
        }),
      );
      return;
    }
    const id = await candidateId(req);
    res.json(
      await retryEvaluation({
        interviewId: req.params.interviewId,
        questionId: parsed.data.questionId,
        candidateId: id,
      }),
    );
  }),
);

// Phase 2, G3.6 — the legacy single-answer endpoint
// POST /interviews/:interviewId/answer was REMOVED (it was the last
// live caller of a silent deterministic fallback: any LLM failure
// stored a deterministic score as if scored, with no pending state,
// no attempt row and no failure kind). No caller remains — the client
// and the E2E script use POST /session/answer only (see
// /interviews/:interviewId/session/answer above), which scores through
// scoreSessionAnswer() with attempt recording and fail-loud behaviour.
// A POST to the removed path now falls through to the router's 404.
// READ-ONLY report: viewing never finalises the interview (Phase C fix
// for C14). Candidate (owner) or an authorized recruiter/admin (a
// candidate who applied to one of their jobs). 404 until finished.
router.get(
  "/interviews/:interviewId/report",
  requireRole("candidate", "recruiter", "admin"),
  asyncHandler(async (req: AuthRequest, res) => {
    if (!req.user) throw new ApiError(401, "Unauthorized");
    if (req.user.role === "candidate") {
      const id = await candidateId(req);
      const existing = await getInterviewReport(req.params.interviewId, id);
      if (existing) {
        res.json(existing);
        return;
      }
      res.status(404).json({
        error: "No interview report yet — finish the interview first.",
      });
      return;
    }
    const report = await getInterviewReportForRecruiter({
      interviewId: req.params.interviewId,
      recruiterUserId: req.user.sub,
      isAdmin: req.user.role === "admin",
    });
    if (report) {
      res.json(report);
      return;
    }
    res.status(404).json({ error: "No interview report yet for this interview." });
  }),
);

// ── Final competency profile (Phase E) ───────────────────────────────────
// POST /:id/competency/compute — candidate (owner) computes the final
// profile from the three real sources (evaluation + completed interview
// + verified evidence). Deterministic and idempotent: the same inputs
// return the stored row, never a duplicate; a final profile is never
// rewritten. GET /:id/competency — the same stored profile for the
// owning candidate, or an authorized recruiter/admin (application
// ownership gate, same as the interview report). 404 until computed.
// The profile is an assessment result only — it never rejects or hires
// anyone; recruiters decide. No automatic decision is ever returned.
router.post(
  "/:id/competency/compute",
  requireRole("candidate"),
  asyncHandler(async (req: AuthRequest, res) => {
    const parsed = z
      .object({ roleId: z.string().min(1).max(100).optional() })
      .safeParse(req.body ?? {});
    if (!parsed.success) {
      throw new ApiError(400, parsed.error.issues.map((i) => i.message).join("; "));
    }
    const id = await candidateId(req);
    // Ownership first: only the assessment's own candidate may compute.
    await loadAssessmentForCandidate(req.params.id, id);
    const result = await computeCompetencyProfileForAssessment(req.params.id, {
      roleId: parsed.data.roleId,
    });
    res.status(result.fresh ? 201 : 200).json(result);
  }),
);

router.get(
  "/:id/competency",
  requireRole("candidate", "recruiter", "admin"),
  asyncHandler(async (req: AuthRequest, res) => {
    if (!req.user) throw new ApiError(401, "Unauthorized");
    if (req.user.role === "candidate") {
      const id = await candidateId(req);
      res.json(
        await getCompetencyProfileForCandidate({
          assessmentId: req.params.id,
          candidateId: id,
        }),
      );
      return;
    }
    res.json(
      await getCompetencyProfileForRecruiter({
        assessmentId: req.params.id,
        recruiterUserId: req.user.sub,
        isAdmin: req.user.role === "admin",
      }),
    );
  }),
);

// ── Verified skills / evidence (recruiter) ────────────────────────────────
router.get(
  "/verified-skills/:candidateId",
  requireRole("recruiter", "admin"),
  asyncHandler(async (req: AuthRequest, res) => {
    if (!req.user) throw new ApiError(401, "Unauthorized");
    res.json(
      await getCandidateEvidenceForRecruiter({
        recruiterUserId: req.user.sub,
        candidateId: req.params.candidateId,
      }),
    );
  }),
);

export default router;
