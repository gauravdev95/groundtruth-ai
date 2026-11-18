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
  getLatestRepoAnalysis,
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
  answerQuestion,
  buildInterviewReport,
  getInterviewReport,
  listInterviewQuestions,
  loadInterviewForCandidate,
} from "../services/interview";
import { buildVerifiedProfile, getCandidateEvidenceForRecruiter } from "../services/verified";
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
    res.json({ ...assessment, challenge, repoAnalysis });
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

// ── Interview ──────────────────────────────────────────────────────────────
router.post(
  "/:id/interview/generate",
  llmRateLimit,
  requireRole("candidate"),
  asyncHandler(async (req: AuthRequest, res) => {
    const id = await candidateId(req);
    const { interview, questions } = await generateInterview({
      assessmentId: req.params.id,
      candidateId: id,
    });
    res.status(201).json({ interview, questions });
  }),
);

router.get(
  "/interviews/:interviewId",
  requireRole("candidate"),
  asyncHandler(async (req: AuthRequest, res) => {
    const id = await candidateId(req);
    const interview = await loadInterviewForCandidate(req.params.interviewId, id);
    const questions = await listInterviewQuestions(req.params.interviewId, id);
    res.json({ interview, questions });
  }),
);

router.post(
  "/interviews/:interviewId/answer",
  llmRateLimit,
  requireRole("candidate"),
  asyncHandler(async (req: AuthRequest, res) => {
    const parsed = z
      .object({ questionId: z.string().uuid(), answer: z.string().min(5).max(20000) })
      .safeParse(req.body);
    if (!parsed.success) {
      throw new ApiError(400, parsed.error.issues.map((i) => i.message).join("; "));
    }
    const id = await candidateId(req);
    res.json(
      await answerQuestion({
        interviewId: req.params.interviewId,
        candidateId: id,
        questionId: parsed.data.questionId,
        answer: parsed.data.answer,
      }),
    );
  }),
);

router.get(
  "/interviews/:interviewId/report",
  requireRole("candidate"),
  asyncHandler(async (req: AuthRequest, res) => {
    const id = await candidateId(req);
    const existing = await getInterviewReport(req.params.interviewId, id);
    if (existing) {
      res.json(existing);
      return;
    }
    res.json(await buildInterviewReport(req.params.interviewId, id));
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
