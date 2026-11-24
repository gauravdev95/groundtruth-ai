import test from "node:test";
import assert from "node:assert/strict";

// Phase 3 recruiter tests — pure logic, no Postgres/Redis needed:
// recruiter/company completeness scoring. The live end-to-end flow
// (signup → profile/company update → dashboard, plus the 403 for a
// student token) is verified against local Postgres in the Phase 3
// report, not here.
import {
  COMPANY_SIZES,
  computeRecruiterCompleteness,
} from "../src/services/recruiter";

const EMPTY_COMPANY = {
  name: "",
  website: null,
  industry: null,
  size: null,
  location: null,
  description: null,
};

const FULL_COMPANY = {
  name: "Acme Analytics",
  website: "https://acme.example.com",
  industry: "Data Analytics",
  size: "51-200" as const,
  location: "Bengaluru, India",
  description: "We build analytics for fast teams.",
};

test("recruiter completeness: empty profile scores 0 with both sections missing", () => {
  const c = computeRecruiterCompleteness({
    job_title: null,
    phone: null,
    company: null,
  });
  assert.equal(c.percent, 0);
  assert.deepEqual(c.missing, ["personal", "company"]);
  assert.equal(c.sections.company.detail, "No company profile yet — save a company name to create it.");
});

test("recruiter completeness: personal only scores 40, company still missing", () => {
  const c = computeRecruiterCompleteness({
    job_title: "Talent Lead",
    phone: "+91 98765 43210",
    company: null,
  });
  assert.equal(c.percent, 40);
  assert.deepEqual(c.missing, ["company"]);
  assert.equal(c.sections.personal.done, true);
});

test("recruiter completeness: full profile scores 100", () => {
  const c = computeRecruiterCompleteness({
    job_title: "Talent Lead",
    phone: "+91 98765 43210",
    company: FULL_COMPANY,
  });
  assert.equal(c.percent, 100);
  assert.deepEqual(c.missing, []);
  assert.equal(c.sections.personal.done, true);
  assert.equal(c.sections.company.done, true);
});

test("recruiter completeness: company name alone scores 15 of the company 60", () => {
  const c = computeRecruiterCompleteness({
    job_title: null,
    phone: null,
    company: EMPTY_COMPANY,
  });
  // Empty name counts as missing, so a blank company contributes 0.
  assert.equal(c.percent, 0);
  const named = computeRecruiterCompleteness({
    job_title: null,
    phone: null,
    company: { ...EMPTY_COMPANY, name: "Acme Analytics" },
  });
  assert.equal(named.percent, 15);
});

test("recruiter completeness: weights add to 100", () => {
  // Personal 40 (job title 20 + phone 20) + company 60
  // (name 15 + website 10 + industry 10 + size 10 + location 5 + about 10).
  const c = computeRecruiterCompleteness({
    job_title: "x",
    phone: "x",
    company: FULL_COMPANY,
  });
  assert.equal(c.percent, 100);
});

test("company sizes match the old repo's CompanySize enum", () => {
  assert.deepEqual([...COMPANY_SIZES], ["1-10", "11-50", "51-200", "201-1000", "1000+"]);
});
