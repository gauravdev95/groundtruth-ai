import { chatJson, llmConfigured } from "./llm";
import type { RepoAnalysis } from "./repoAnalysis";
import { sanitizeForLlm } from "./repoAnalysis";

/**
 * AI challenge generation — deterministic template engine first, with an
 * optional LLM refinement pass when a provider is configured.
 *
 * Challenges are built from the repo's REAL gaps (missing tests, no auth,
 * no validation, a rate limiter to debug, or a missing endpoint). Hidden
 * tests are NEVER exposed: `testStrategy.hidden` holds only plain-language
 * descriptions of what hidden tests check, never test code or cases.
 */

export type ChallengeDifficulty = "easy" | "medium" | "hard";
export type ChallengeDuration = 30 | 45 | 60 | 90;

export type ChallengeTaskType =
  | "add-tests"
  | "add-auth"
  | "improve-validation"
  | "fix-rate-limit-bug"
  | "implement-endpoint";

export interface Challenge {
  taskType: ChallengeTaskType;
  title: string;
  problemStatement: string;
  /** Metadata only — built from sanitizeForLlm, never raw code. */
  repoContext: string;
  requiredFunctionality: string[];
  acceptanceCriteria: string[];
  difficulty: ChallengeDifficulty;
  deliverables: string[];
  allowedTools: string[];
  timeLimitMinutes: ChallengeDuration;
  testStrategy: {
    /** Descriptions of the visible tests the candidate can run. */
    visible: string[];
    /** Descriptions ONLY — never hidden test code or cases. */
    hidden: string[];
  };
  aiAvailable: boolean;
}

export interface GenerateChallengeInput {
  repoAnalysis: RepoAnalysis;
  projectTitle: string;
  durationMinutes?: ChallengeDuration;
  difficulty?: ChallengeDifficulty;
}

export const VALID_DURATIONS: ChallengeDuration[] = [30, 45, 60, 90];

/** Observable-behaviour keywords: a criterion must describe something checkable. */
const OBSERVABLE_WORDS = [
  "returns", "return", "shows", "show", "displays", "display", "responds",
  "respond", "creates", "create", "updates", "update", "deletes", "delete",
  "rejects", "reject", "accepts", "accept", "passes", "pass", "fails", "fail",
  "renders", "render", "persists", "persist", "validates", "validate",
  "blocks", "block", "allows", "allow", "logs", "log", "saves", "save",
  "loads", "load", "lists", "list", "handles", "handle", "prevents", "prevent",
  "verifies", "verify", "runs", "run", "exits", "exit", "covers", "cover",
  "works", "work", "contains", "contain", "includes", "include",
];

function pickTaskType(a: RepoAnalysis): ChallengeTaskType {
  if (a.tests.count === 0) return "add-tests";
  if (!a.hasAuth && a.endpoints.length > 0) return "add-auth";
  if (!a.hasValidation && a.endpoints.length > 0) return "improve-validation";
  if (a.hasRateLimiter) return "fix-rate-limit-bug";
  return "implement-endpoint";
}

function allowedToolsFor(a: RepoAnalysis): string[] {
  const tools = new Set<string>(["Git"]);
  const langs = a.languages.map((l) => l.language);
  if (langs.includes("TypeScript") || langs.includes("JavaScript")) {
    tools.add("Node.js");
    tools.add("npm");
  }
  if (langs.includes("Python")) tools.add("Python 3");
  if (langs.includes("Go")) tools.add("Go toolchain");
  if (a.tests.frameworks.length > 0) {
    for (const f of a.tests.frameworks) tools.add(f);
  } else if (langs.includes("TypeScript") || langs.includes("JavaScript")) {
    tools.add("Jest");
  } else if (langs.includes("Python")) {
    tools.add("pytest");
  }
  if (a.frameworks.length > 0) {
    for (const f of a.frameworks) tools.add(f);
  }
  return [...tools];
}

function taskContent(
  taskType: ChallengeTaskType,
  a: RepoAnalysis,
  projectTitle: string,
): {
  title: string;
  problemStatement: string;
  requiredFunctionality: string[];
  acceptanceCriteria: string[];
  deliverables: string[];
  visible: string[];
  hidden: string[];
} {
  const stack = [
    ...a.frameworks,
    ...a.languages.slice(0, 2).map((l) => l.language),
  ]
    .filter(Boolean)
    .join(", ") || "the repository's existing stack";
  const endpointList =
    a.endpoints.map((e) => `${e.method} ${e.path}`).join(", ") || "no endpoints detected";

  switch (taskType) {
    case "add-tests":
      return {
        title: `Add unit tests for ${projectTitle}`,
        problemStatement:
          `${projectTitle} (${stack}) currently has no test files. ` +
          `Add a unit-test suite covering the core behaviour of the existing code ` +
          `so regressions are caught automatically. Do not change production behaviour.`,
        requiredFunctionality: [
          "Add unit tests for the main modules/functions in the repository",
          "Cover the happy path and at least one error/edge case per module",
          "Tests must run with a single standard command and pass",
        ],
        acceptanceCriteria: [
          "Running the test command shows all new tests passing",
          "Running the test command shows the suite covers at least one happy-path case per main module",
          "Running the test command shows the suite covers at least one error or edge case per main module",
          "Existing tests still pass — running the suite shows no production behaviour changed",
        ],
        deliverables: [
          "New test files in the repository's existing test layout",
          "A short note describing how to run the tests",
        ],
        visible: [
          "Visible tests run the new suite and verify every test passes",
          "Visible tests verify the suite covers the main modules",
        ],
        hidden: [
          "Hidden tests run the suite in a clean checkout and verify it passes",
          "Hidden tests verify edge-case coverage beyond the happy path",
        ],
      };
    case "add-auth":
      return {
        title: `Add authentication to ${projectTitle}`,
        problemStatement:
          `${projectTitle} (${stack}) exposes API endpoints (${endpointList}) with no authentication detected. ` +
          `Add authentication so that protected endpoints reject unauthenticated requests and accept valid credentials.`,
        requiredFunctionality: [
          "Add a login mechanism that issues a token/session for valid credentials",
          "Protect the existing endpoints so unauthenticated requests are rejected",
          "Authenticated requests continue to work exactly as before",
        ],
        acceptanceCriteria: [
          "An unauthenticated request to a protected endpoint returns 401",
          "A request with a valid token returns the same data as before",
          "A request with an invalid or expired token returns 401",
          "Login with valid credentials returns a usable token",
        ],
        deliverables: [
          "Authentication code integrated with the existing endpoints",
          "Tests demonstrating authenticated and unauthenticated behaviour",
          "A short note on how to obtain and use a token",
        ],
        visible: [
          "Visible tests verify unauthenticated requests return 401",
          "Visible tests verify a valid login returns a token",
        ],
        hidden: [
          "Hidden tests verify invalid and expired tokens are rejected",
          "Hidden tests verify authenticated requests still return correct data",
        ],
      };
    case "improve-validation":
      return {
        title: `Add input validation to ${projectTitle}`,
        problemStatement:
          `${projectTitle} (${stack}) exposes API endpoints (${endpointList}) with no input validation detected. ` +
          `Add validation so malformed or missing inputs are rejected with a clear error instead of causing incorrect behaviour.`,
        requiredFunctionality: [
          "Validate request inputs (required fields, types and value ranges) on the existing endpoints",
          "Return a 400 error with a clear message for invalid input",
          "Valid requests continue to behave exactly as before",
        ],
        acceptanceCriteria: [
          "A request with a missing required field returns 400 with an error message",
          "A request with a wrongly typed field returns 400 with an error message",
          "A valid request returns the same successful response as before",
          "A validation error response shows which field is invalid",
        ],
        deliverables: [
          "Validation logic on the existing endpoints",
          "Tests for valid and invalid inputs",
        ],
        visible: [
          "Visible tests verify missing fields return 400",
          "Visible tests verify valid requests still succeed",
        ],
        hidden: [
          "Hidden tests verify wrongly typed and out-of-range values return 400",
          "Hidden tests verify error messages name the invalid field",
        ],
      };
    case "fix-rate-limit-bug":
      return {
        title: `Fix the rate-limiting bug in ${projectTitle}`,
        problemStatement:
          `${projectTitle} (${stack}) has a rate limiter, but its behaviour is unreliable: ` +
          `limits are not enforced consistently across requests. Diagnose the real bug in the ` +
          `existing rate-limiting code and fix it so limits are enforced fairly and predictably.`,
        requiredFunctionality: [
          "Find the real defect in the existing rate-limiting code (do not rewrite the whole feature)",
          "Enforce the limit consistently: requests over the limit are rejected with 429",
          "Requests under the limit continue to succeed, and the limit resets after its window",
        ],
        acceptanceCriteria: [
          "Requests over the limit return 429",
          "Requests under the limit return a successful response",
          "After the window expires, a new request returns success (the limit resets)",
          "Requests from different clients are accepted independently — one client hitting the limit does not reject another client",
        ],
        deliverables: [
          "The minimal fix in the existing rate-limiting code",
          "Tests demonstrating the limit, the reset, and per-client independence",
          "A short note explaining the root cause of the bug",
        ],
        visible: [
          "Visible tests verify requests over the limit return 429",
          "Visible tests verify requests under the limit succeed",
        ],
        hidden: [
          "Hidden tests verify the limit resets after its window",
          "Hidden tests verify different clients are limited independently",
        ],
      };
    case "implement-endpoint":
    default:
      return {
        title: `Implement a missing API endpoint for ${projectTitle}`,
        problemStatement:
          `${projectTitle} (${stack}) currently exposes: ${endpointList}. ` +
          `Implement one missing, useful endpoint that fits the existing API style — ` +
          `for example a health/list endpoint for an existing resource — following the ` +
          `same routing, response shape and error handling as the existing endpoints.`,
        requiredFunctionality: [
          "Implement one new endpoint following the existing API style and response shape",
          "Return the correct data for valid requests",
          "Handle invalid input with a clear error response",
        ],
        acceptanceCriteria: [
          "A valid request to the new endpoint returns 200 with the expected data",
          "The new endpoint returns a response whose shape matches the existing endpoints",
          "An invalid request returns a clear error response",
          "Existing endpoints still return the same responses as before",
        ],
        deliverables: [
          "The new endpoint implemented in the existing codebase",
          "Tests for the new endpoint (valid and invalid requests)",
        ],
        visible: [
          "Visible tests verify a valid request returns 200 with the expected data",
          "Visible tests verify invalid requests return a clear error",
        ],
        hidden: [
          "Hidden tests verify the response shape matches existing endpoints",
          "Hidden tests verify existing endpoints are unchanged",
        ],
      };
  }
}

export function generateChallenge(input: GenerateChallengeInput): Challenge {
  const { repoAnalysis: a, projectTitle } = input;
  const taskType = pickTaskType(a);
  const content = taskContent(taskType, a, projectTitle);
  const duration: ChallengeDuration = VALID_DURATIONS.includes(
    input.durationMinutes as ChallengeDuration,
  )
    ? (input.durationMinutes as ChallengeDuration)
    : 60;
  const difficulty: ChallengeDifficulty =
    input.difficulty === "easy" || input.difficulty === "medium" || input.difficulty === "hard"
      ? input.difficulty
      : "medium";
  return {
    taskType,
    title: content.title,
    problemStatement: content.problemStatement,
    repoContext: sanitizeForLlm(a),
    requiredFunctionality: content.requiredFunctionality,
    acceptanceCriteria: content.acceptanceCriteria,
    difficulty,
    deliverables: content.deliverables,
    allowedTools: allowedToolsFor(a),
    timeLimitMinutes: duration,
    testStrategy: { visible: content.visible, hidden: content.hidden },
    aiAvailable: false,
  };
}

export function validateChallenge(c: Challenge): { ok: boolean; issues: string[] } {
  const issues: string[] = [];
  if (!c.title?.trim()) issues.push("title is required");
  if (!c.problemStatement?.trim()) issues.push("problemStatement is required");
  if (!c.repoContext?.trim()) issues.push("repoContext is required");
  if (!Array.isArray(c.requiredFunctionality) || c.requiredFunctionality.length === 0) {
    issues.push("requiredFunctionality must be a non-empty list");
  }
  if (!Array.isArray(c.acceptanceCriteria) || c.acceptanceCriteria.length === 0) {
    issues.push("acceptanceCriteria must be a non-empty list");
  } else {
    for (const criterion of c.acceptanceCriteria) {
      const lower = criterion.toLowerCase();
      const observable = OBSERVABLE_WORDS.some((w) => lower.includes(w));
      if (!observable || criterion.trim().length < 10) {
        issues.push(
          `acceptance criterion is not testable (must describe an observable behaviour): "${criterion}"`,
        );
      }
    }
  }
  if (!["easy", "medium", "hard"].includes(c.difficulty)) {
    issues.push(`difficulty must be one of easy, medium, hard (got "${c.difficulty}")`);
  }
  if (!Array.isArray(c.deliverables) || c.deliverables.length === 0) {
    issues.push("deliverables must be a non-empty list");
  }
  if (!Array.isArray(c.allowedTools) || c.allowedTools.length === 0) {
    issues.push("allowedTools must be a non-empty list");
  }
  if (!VALID_DURATIONS.includes(c.timeLimitMinutes as ChallengeDuration)) {
    issues.push(
      `timeLimitMinutes must be one of ${VALID_DURATIONS.join(", ")} (got ${c.timeLimitMinutes})`,
    );
  }
  if (!c.testStrategy || !Array.isArray(c.testStrategy.visible) || c.testStrategy.visible.length === 0) {
    issues.push("testStrategy.visible must be a non-empty list");
  }
  if (!c.testStrategy || !Array.isArray(c.testStrategy.hidden) || c.testStrategy.hidden.length === 0) {
    issues.push("testStrategy.hidden must be a non-empty list");
  }
  return { ok: issues.length === 0, issues };
}

interface AiChallengePayload {
  problemStatement: string;
  acceptanceCriteria: string[];
}

function validateAiChallengePayload(u: unknown): AiChallengePayload {
  if (typeof u !== "object" || u === null) throw new Error("not an object");
  const obj = u as Record<string, unknown>;
  if (typeof obj.problemStatement !== "string" || !obj.problemStatement.trim()) {
    throw new Error("missing problemStatement");
  }
  if (!Array.isArray(obj.acceptanceCriteria) || obj.acceptanceCriteria.length === 0) {
    throw new Error("missing acceptanceCriteria");
  }
  for (const c of obj.acceptanceCriteria as unknown[]) {
    if (typeof c !== "string" || !c.trim()) throw new Error("bad acceptance criterion");
  }
  return {
    problemStatement: obj.problemStatement as string,
    acceptanceCriteria: obj.acceptanceCriteria as string[],
  };
}

/**
 * Deterministic challenge, refined by the LLM when configured. The LLM may
 * only rewrite the problem statement and acceptance criteria; the task
 * type, time limit, deliverables and test strategy stay deterministic, and
 * hidden tests are never exposed. Falls back to the deterministic challenge
 * (aiAvailable: false) when the LLM is not configured or fails.
 */
export async function generateChallengeWithAI(
  input: GenerateChallengeInput,
): Promise<Challenge> {
  const base = generateChallenge(input);
  if (!llmConfigured()) return base;
  try {
    const payload = await chatJson<AiChallengePayload>(
      {
        system:
          "You are a technical interviewer. Refine the given coding-challenge " +
          "problem statement and acceptance criteria. Return JSON only: " +
          "{\"problemStatement\": string, \"acceptanceCriteria\": string[]}. " +
          "Keep the same task and difficulty. Every acceptance criterion must " +
          "describe an observable behaviour. Never include test code or hidden test cases.",
        user: JSON.stringify({
          projectTitle: input.projectTitle,
          taskType: base.taskType,
          problemStatement: base.problemStatement,
          acceptanceCriteria: base.acceptanceCriteria,
          difficulty: base.difficulty,
          timeLimitMinutes: base.timeLimitMinutes,
          repoContext: base.repoContext,
        }),
      },
      validateAiChallengePayload,
    );
    const refined: Challenge = {
      ...base,
      problemStatement: payload.problemStatement,
      acceptanceCriteria: payload.acceptanceCriteria,
      aiAvailable: true,
    };
    const check = validateChallenge(refined);
    if (!check.ok) {
      console.error("[challenge] LLM-refined challenge failed validation:", check.issues.join("; "));
      return { ...base, aiAvailable: false };
    }
    return refined;
  } catch (err) {
    console.error(
      "[challenge] LLM refinement failed, using deterministic challenge:",
      err instanceof Error ? err.message : String(err),
    );
    return { ...base, aiAvailable: false };
  }
}
