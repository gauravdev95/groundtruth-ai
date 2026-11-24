import test from "node:test";
import assert from "node:assert/strict";

// Challenge generation tests — deterministic, no DB/Redis/LLM needed.
import {
  generateChallenge,
  generateChallengeWithAI,
  validateChallenge,
} from "../src/services/challenge";
import type { Challenge } from "../src/services/challenge";
import { analyzeRepoTree } from "../src/services/repoAnalysis";
import type { RepoFile } from "../src/services/repoAnalysis";

function analysisFrom(files: RepoFile[]) {
  return analyzeRepoTree(files);
}

const NO_TEST_FILES: RepoFile[] = [
  {
    path: "package.json",
    content: JSON.stringify({
      scripts: { start: "node src/index.js" },
      dependencies: { express: "^4.19.0" },
    }),
  },
  {
    path: "src/index.js",
    content:
      "const express = require('express');\nconst app = express();\n" +
      "app.get('/items', (req, res) => res.json([]));\n",
  },
];

const WITH_TESTS_NO_AUTH: RepoFile[] = [
  ...NO_TEST_FILES,
  { path: "tests/index.test.js", content: "test('x', () => {});\n" },
];

const WITH_TESTS_AUTH_VALIDATION: RepoFile[] = [
  {
    path: "package.json",
    content: JSON.stringify({
      scripts: { start: "node src/index.js", test: "jest" },
      dependencies: {
        express: "^4.19.0",
        jsonwebtoken: "^9.0.0",
        zod: "^3.23.0",
        "express-rate-limit": "^7.0.0",
      },
      devDependencies: { jest: "^29.0.0" },
    }),
  },
  {
    path: "src/index.js",
    content:
      "const express = require('express');\nconst rateLimit = require('express-rate-limit');\n" +
      "const app = express();\napp.use(rateLimit({ windowMs: 60000, max: 100 }));\n" +
      "app.get('/items', (req, res) => res.json([]));\n" +
      "app.post('/login', (req, res) => res.json({ token: 'x' }));\n",
  },
  { path: "tests/index.test.js", content: "test('x', () => {});\n" },
];

test("generated challenge has all required fields and validates", () => {
  const c = generateChallenge({
    repoAnalysis: analysisFrom(NO_TEST_FILES),
    projectTitle: "Demo API",
  });
  assert.ok(c.title.trim());
  assert.ok(c.problemStatement.trim());
  assert.ok(c.repoContext.trim());
  assert.ok(c.requiredFunctionality.length > 0);
  assert.ok(c.acceptanceCriteria.length > 0);
  assert.ok(["easy", "medium", "hard"].includes(c.difficulty));
  assert.ok(c.deliverables.length > 0);
  assert.ok(c.allowedTools.length > 0);
  assert.ok([30, 45, 60, 90].includes(c.timeLimitMinutes));
  assert.ok(c.testStrategy.visible.length > 0);
  assert.ok(c.testStrategy.hidden.length > 0);
  assert.equal(c.aiAvailable, false);
  assert.deepEqual(validateChallenge(c), { ok: true, issues: [] });
});

test("time limits: each of 30/45/60/90 accepted, other values default to 60", () => {
  for (const mins of [30, 45, 60, 90] as const) {
    const c = generateChallenge({
      repoAnalysis: analysisFrom(NO_TEST_FILES),
      projectTitle: "Demo",
      durationMinutes: mins,
    });
    assert.equal(c.timeLimitMinutes, mins);
    assert.equal(validateChallenge(c).ok, true);
  }
  const bad = generateChallenge({
    repoAnalysis: analysisFrom(NO_TEST_FILES),
    projectTitle: "Demo",
    // @ts-expect-error testing an invalid duration at runtime
    durationMinutes: 120,
  });
  assert.equal(bad.timeLimitMinutes, 60);
});

test("task type follows real repo gaps: no tests -> add unit tests", () => {
  const c = generateChallenge({
    repoAnalysis: analysisFrom(NO_TEST_FILES),
    projectTitle: "Demo API",
  });
  assert.equal(c.taskType, "add-tests");
  assert.match(c.title, /unit tests/i);
});

test("task type follows real repo gaps: tests but no auth -> add authentication", () => {
  const c = generateChallenge({
    repoAnalysis: analysisFrom(WITH_TESTS_NO_AUTH),
    projectTitle: "Demo API",
  });
  assert.equal(c.taskType, "add-auth");
});

test("task type follows real repo gaps: rate limiter present -> fix rate-limit bug", () => {
  const c = generateChallenge({
    repoAnalysis: analysisFrom(WITH_TESTS_AUTH_VALIDATION),
    projectTitle: "Demo API",
  });
  assert.equal(c.taskType, "fix-rate-limit-bug");
});

test("validateChallenge catches a bad challenge", () => {
  const good = generateChallenge({
    repoAnalysis: analysisFrom(NO_TEST_FILES),
    projectTitle: "Demo",
  });
  const badTime: Challenge = { ...good, timeLimitMinutes: 120 as never };
  assert.equal(validateChallenge(badTime).ok, false);
  assert.ok(validateChallenge(badTime).issues.some((i) => i.includes("timeLimitMinutes")));

  const badCriteria: Challenge = {
    ...good,
    acceptanceCriteria: ["be good", "make it nice"],
  };
  const check = validateChallenge(badCriteria);
  assert.equal(check.ok, false);
  assert.ok(check.issues.some((i) => i.includes("not testable")));

  const empty: Challenge = { ...good, title: "", requiredFunctionality: [], deliverables: [] };
  const check2 = validateChallenge(empty);
  assert.equal(check2.ok, false);
  assert.ok(check2.issues.length >= 3);
});

test("hidden tests are never present in the output (descriptions only, no code)", () => {
  const c = generateChallenge({
    repoAnalysis: analysisFrom(NO_TEST_FILES),
    projectTitle: "Demo API",
  });
  const json = JSON.stringify(c);
  // No test code/cases: no assertions, no expect(), no function bodies.
  assert.equal(json.includes("expect("), false);
  assert.equal(json.includes("assert("), false);
  assert.equal(json.includes("describe("), false);
  for (const h of c.testStrategy.hidden) {
    assert.ok(h.trim().length > 0);
    assert.match(h, /hidden tests/i, "hidden entries must be descriptions of hidden tests");
  }
  // repoContext is metadata only — no file contents.
  assert.equal(c.repoContext.includes("require('express')"), false);
});

test("withAI falls back to deterministic challenge when LLM is not configured", async () => {
  process.env.AI_MOCK = "true";
  process.env.AI_API_BASE_URL = "";
  process.env.AI_API_KEY = "";
  process.env.AI_MODEL = "";
  const c = await generateChallengeWithAI({
    repoAnalysis: analysisFrom(NO_TEST_FILES),
    projectTitle: "Demo API",
    durationMinutes: 45,
    difficulty: "hard",
  });
  assert.equal(c.aiAvailable, false);
  assert.equal(c.timeLimitMinutes, 45);
  assert.equal(c.difficulty, "hard");
  assert.equal(validateChallenge(c).ok, true);
});
