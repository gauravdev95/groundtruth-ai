import test from "node:test";
import assert from "node:assert/strict";

// Phase 2 student tests — pure logic, no Postgres/Redis needed:
// profile-completeness scoring and GitHub handle parsing. The live
// end-to-end flow (signup → onboarding → profile → dashboard) is verified
// against local Postgres in the Phase 2 report, not here.
import {
  computeCompleteness,
  parseGithubHandle,
  MANDATORY_SECTIONS,
} from "../src/services/student";

const EMPTY_CANDIDATE = {
  headline: null,
  location: null,
  summary: null,
  degree: null,
  branch: null,
  graduation_year: null,
  target_roles: [] as string[],
  github_url: null,
  github_handle: null,
};

const FULL_CANDIDATE = {
  headline: "Full-Stack Developer",
  location: "Agra, India",
  summary: "B.Tech CSE student building full-stack apps.",
  degree: "btech",
  branch: "cse",
  graduation_year: 2027,
  target_roles: ["fullstack"],
  github_url: "https://github.com/gauravdev95",
  github_handle: "gauravdev95",
};

test("completeness: empty profile scores 0 with all sections missing", () => {
  const c = computeCompleteness({
    candidate: EMPTY_CANDIDATE,
    skillCount: 0,
    projectCount: 0,
    codingCount: 0,
    certificateCount: 0,
    experienceCount: 0,
  });
  assert.equal(c.percent, 0);
  assert.deepEqual(c.missing, [
    "basic",
    "github",
    "projects",
    "coding",
    "certificates",
    "experience",
  ]);
});

test("completeness: mandatory sections only score 75, not 100", () => {
  const c = computeCompleteness({
    candidate: FULL_CANDIDATE,
    skillCount: 3,
    projectCount: 1,
    codingCount: 0,
    certificateCount: 0,
    experienceCount: 0,
  });
  assert.equal(c.percent, 75);
  assert.equal(c.sections.basic.done, true);
  assert.equal(c.sections.github.done, true);
  assert.equal(c.sections.projects.done, true);
  assert.deepEqual(c.missing, ["coding", "certificates", "experience"]);
});

test("completeness: every section filled scores 100", () => {
  const c = computeCompleteness({
    candidate: FULL_CANDIDATE,
    skillCount: 3,
    projectCount: 2,
    codingCount: 1,
    certificateCount: 1,
    experienceCount: 1,
  });
  assert.equal(c.percent, 100);
  assert.deepEqual(c.missing, []);
});

test("completeness: basic needs headline/location/summary/education/role/skills", () => {
  // Headline missing alone keeps basic undone.
  const c = computeCompleteness({
    candidate: { ...FULL_CANDIDATE, headline: null },
    skillCount: 3,
    projectCount: 1,
    codingCount: 0,
    certificateCount: 0,
    experienceCount: 0,
  });
  assert.equal(c.sections.basic.done, false);
  assert.equal(c.percent, 50); // github 25 + projects 25
  assert.match(c.sections.basic.detail, /headline/);
});

test("completeness: mandatory sections are basic, github, projects", () => {
  assert.deepEqual(MANDATORY_SECTIONS, ["basic", "github", "projects"]);
});

test("parseGithubHandle: plain handle, profile URL, trailing slash", () => {
  assert.equal(parseGithubHandle("gauravdev95"), "gauravdev95");
  assert.equal(
    parseGithubHandle("https://github.com/octocat"),
    "octocat",
  );
  assert.equal(
    parseGithubHandle("https://github.com/octocat/"),
    "octocat",
  );
  assert.equal(parseGithubHandle("github.com/octocat"), "octocat");
});

test("parseGithubHandle: rejects garbage instead of guessing", () => {
  assert.equal(parseGithubHandle(""), null);
  assert.equal(parseGithubHandle("not a handle!!"), null);
  assert.equal(parseGithubHandle("https://example.com/octocat"), null);
});
