import test from "node:test";
import assert from "node:assert/strict";

// Profile strength tests — deterministic core only, no DB/Redis/LLM needed.
import {
  analyzeProfileStrength,
  analyzeProfileStrengthWithAI,
  demonstratedSkills,
} from "../src/services/strength";
import type { StrengthInput } from "../src/services/strength";

const EMPTY_CANDIDATE = {
  headline: null,
  location: null,
  summary: null,
  degree: null,
  branch: null,
  graduation_year: null,
  target_roles: [] as string[],
  github_handle: null,
  github_url: null,
  linkedin_url: null,
};

const FULL_CANDIDATE = {
  headline: "Full-Stack Developer",
  location: "Agra, India",
  summary: "B.Tech CSE student building full-stack apps with Python and React.",
  degree: "btech",
  branch: "cse",
  graduation_year: 2027,
  target_roles: ["fullstack"],
  github_handle: "gauravdev95",
  github_url: "https://github.com/gauravdev95",
  linkedin_url: "https://www.linkedin.com/in/gauravyadav95/",
};

function emptyInput(): StrengthInput {
  return {
    candidate: EMPTY_CANDIDATE,
    skills: [],
    projects: [],
    codingProfiles: [],
    certificates: [],
    experience: [],
    resumes: [],
  };
}

function fullInput(): StrengthInput {
  return {
    candidate: FULL_CANDIDATE,
    skills: [
      { name: "Python", category: "Language", source: "manual" },
      { name: "React", category: "Framework", source: "manual" },
      { name: "FastAPI", category: "Framework", source: "manual" },
    ],
    projects: [
      {
        title: "SmartCare",
        description:
          "A full-stack healthcare platform built with Python, FastAPI and React. " +
          "Patients book appointments, doctors manage schedules, and records are stored in PostgreSQL.",
        technologies: ["Python", "FastAPI", "React", "PostgreSQL"],
        repo_url: "https://github.com/gauravdev95/smartcare",
      },
    ],
    codingProfiles: [{ platform: "LeetCode", username: "gauravDevX" }],
    certificates: [{ title: "Infosys Springboard AI/ML", issuer: "Infosys" }],
    experience: [
      {
        title: "AI/ML Intern",
        organization: "Infosys Springboard",
        description: "Built ML models for a healthcare use case.",
      },
    ],
    resumes: [
      {
        extracted_text:
          "Gaurav Yadav — Python, React, FastAPI developer. Built SmartCare with Python and React.",
      },
    ],
  };
}

test("empty profile: low score, missing list populated, aiAvailable false", () => {
  const r = analyzeProfileStrength(emptyInput());
  assert.equal(r.overall, 0);
  assert.equal(r.categories.skillCoverage, 0);
  assert.equal(r.categories.projectEvidence, 0);
  assert.equal(r.categories.experience, 0);
  assert.equal(r.categories.resumeConsistency, 0);
  assert.equal(r.categories.profileCompleteness.score, 0);
  assert.ok(r.missing.length > 0);
  assert.ok(r.missing.some((m) => m.includes("skills")));
  assert.ok(r.missing.some((m) => m.includes("project")));
  assert.ok(r.weakAreas.length > 0);
  assert.equal(r.aiAvailable, false);
  assert.equal(r.aiSummary, null);
  // No skills are invented for an empty profile.
  assert.deepEqual(r.suggestedSkills, []);
});

test("full profile with skill-project mapping: high score, all skills demonstrated", () => {
  const input = fullInput();
  const r = analyzeProfileStrength(input);
  assert.equal(r.categories.skillCoverage, 100);
  assert.ok(r.categories.projectEvidence >= 90, `projectEvidence ${r.categories.projectEvidence}`);
  assert.ok(r.overall >= 80, `overall ${r.overall}`);
  assert.equal(r.categories.profileCompleteness.score, 100);
  assert.ok(r.categories.resumeConsistency > 0);
  assert.ok(!r.missing.some((m) => m.includes("Demonstrate skill")));
  const { demonstrated } = demonstratedSkills(input.skills, input.projects);
  assert.deepEqual(demonstrated.sort(), ["FastAPI", "Python", "React"]);
  // PostgreSQL is used in the project but not listed as a skill: suggested, not invented as a claim.
  assert.ok(r.suggestedSkills.includes("PostgreSQL"));
});

test("skill listed but in no project: not demonstrated, coverage drops", () => {
  const input = fullInput();
  input.skills.push({ name: "Rust", category: "Language", source: "manual" });
  const r = analyzeProfileStrength(input);
  assert.equal(r.categories.skillCoverage, 75); // 3 of 4 demonstrated
  assert.ok(r.missing.some((m) => m.includes('"Rust"')));
  assert.ok(r.overall < analyzeProfileStrength(fullInput()).overall);
  const { undemonstrated } = demonstratedSkills(input.skills, input.projects);
  assert.deepEqual(undemonstrated, ["Rust"]);
});

test("every recommendation explains WHY", () => {
  const r = analyzeProfileStrength(emptyInput());
  assert.ok(r.recommendations.length > 0);
  for (const rec of r.recommendations) {
    assert.ok(rec.id.trim(), "recommendation needs an id");
    assert.ok(rec.title.trim(), "recommendation needs a title");
    assert.ok(rec.why.trim().length > 10, `recommendation ${rec.id} must explain WHY`);
    assert.ok(rec.action.trim(), "recommendation needs an action");
    assert.equal(typeof rec.points, "number");
  }
  const full = analyzeProfileStrength(fullInput());
  for (const rec of full.recommendations) {
    assert.ok(rec.why.trim().length > 10);
  }
});

test("resume consistency: resume with no overlap scores 0, matching resume scores high", () => {
  const input = fullInput();
  input.resumes = [{ extracted_text: "Unrelated text about cooking and travel." }];
  assert.equal(analyzeProfileStrength(input).categories.resumeConsistency, 0);
  const matching = analyzeProfileStrength(fullInput());
  assert.ok(matching.categories.resumeConsistency >= 50);
});

test("withAI falls back to deterministic report when LLM is not configured", async () => {
  process.env.AI_MOCK = "true";
  process.env.AI_API_BASE_URL = "";
  process.env.AI_API_KEY = "";
  process.env.AI_MODEL = "";
  const r = await analyzeProfileStrengthWithAI(fullInput());
  assert.equal(r.aiAvailable, false);
  assert.equal(r.aiSummary, null);
  assert.ok(r.overall >= 80);
});
