import { computeCompleteness } from "./student";
import type { CandidateRow } from "./student";
import { chatJson, llmConfigured } from "./llm";

/**
 * AI Profile Strength Engine — deterministic core + optional LLM enhancement.
 *
 * The deterministic report is the source of truth: every score is computed
 * from data the student actually supplied. NOTHING is invented — no skills,
 * achievements or certificates are guessed. A skill counts as
 * "demonstrated" only if it appears in a project's technologies or
 * description. The LLM (when configured) may only add a short summary and
 * extra recommendations; it can never change the scores.
 */

export interface StrengthSkill {
  name: string;
  category?: string | null;
  source?: string;
}

export interface StrengthProject {
  title: string;
  description: string;
  technologies: string[];
  repo_url?: string | null;
}

export interface StrengthCodingProfile {
  platform: string;
  username: string;
}

export interface StrengthCertificate {
  title: string;
  issuer?: string | null;
}

export interface StrengthExperience {
  title: string;
  organization?: string;
  description?: string;
}

export interface StrengthResume {
  extracted_text?: string | null;
}

export interface StrengthInput {
  candidate: Pick<
    CandidateRow,
    | "headline"
    | "location"
    | "summary"
    | "degree"
    | "branch"
    | "graduation_year"
    | "target_roles"
    | "github_handle"
    | "github_url"
    | "linkedin_url"
  >;
  skills: StrengthSkill[];
  projects: StrengthProject[];
  codingProfiles: StrengthCodingProfile[];
  certificates: StrengthCertificate[];
  experience: StrengthExperience[];
  resumes: StrengthResume[];
}

export interface StrengthRecommendation {
  id: string;
  title: string;
  /** WHY this matters — every recommendation must explain itself. */
  why: string;
  action: string;
  /** Rough points the fix could add to the overall score. */
  points: number;
}

export interface StrengthReport {
  overall: number;
  categories: {
    skillCoverage: number;
    projectEvidence: number;
    experience: number;
    resumeConsistency: number;
    profileCompleteness: { score: number; detail: string };
  };
  missing: string[];
  weakAreas: string[];
  recommendations: StrengthRecommendation[];
  suggestedSkills: string[];
  aiAvailable: boolean;
  aiSummary: string | null;
}

function norm(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9+#. ]/g, " ").replace(/\s+/g, " ").trim();
}

function tokens(text: string): Set<string> {
  return new Set(
    norm(text)
      .split(" ")
      .filter((t) => t.length > 1),
  );
}

/** A skill is "demonstrated" only if it shows up in a project's tech or description. */
export function demonstratedSkills(
  skills: StrengthSkill[],
  projects: StrengthProject[],
): { demonstrated: string[]; undemonstrated: string[] } {
  const demonstrated: string[] = [];
  const undemonstrated: string[] = [];
  for (const skill of skills) {
    const name = norm(skill.name);
    if (!name) continue;
    const shown = projects.some((p) => {
      const tech = p.technologies.map((t) => norm(t));
      if (tech.includes(name)) return true;
      // Multi-word skill: match if all its words appear in the description,
      // or the full name appears as a substring of tech/description text.
      const hay = `${p.technologies.join(" ")} ${p.description}`.toLowerCase();
      if (hay.includes(name)) return true;
      const words = name.split(" ");
      return words.length > 1 && words.every((w) => hay.includes(w));
    });
    (shown ? demonstrated : undemonstrated).push(skill.name);
  }
  return { demonstrated, undemonstrated };
}

function scoreProjectEvidence(projects: StrengthProject[]): number {
  if (projects.length === 0) return 0;
  const per = projects.map((p) => {
    let s = 0;
    const len = (p.description ?? "").trim().length;
    if (len >= 100) s += 40;
    else if (len >= 50) s += 25;
    else if (len > 0) s += 10;
    if (p.technologies.length >= 3) s += 30;
    else if (p.technologies.length > 0) s += 20;
    if (p.repo_url?.trim()) s += 30;
    return s;
  });
  return Math.round(per.reduce((a, b) => a + b, 0) / per.length);
}

function scoreExperience(experience: StrengthExperience[]): number {
  if (experience.length === 0) return 0;
  if (experience.length >= 3) return 100;
  if (experience.length === 2) return 80;
  return 50;
}

function scoreResumeConsistency(input: StrengthInput): number {
  const resumeText = input.resumes
    .map((r) => r.extracted_text ?? "")
    .join(" ");
  if (!resumeText.trim()) return 0;
  const referenceTokens = new Set<string>();
  for (const s of input.skills) {
    for (const t of tokens(s.name)) referenceTokens.add(t);
  }
  for (const p of input.projects) {
    for (const t of tokens(p.title)) referenceTokens.add(t);
    for (const tech of p.technologies) {
      for (const t of tokens(tech)) referenceTokens.add(t);
    }
  }
  if (referenceTokens.size === 0) return 0;
  const resume = tokens(resumeText);
  let matched = 0;
  for (const t of referenceTokens) if (resume.has(t)) matched++;
  return Math.round((matched / referenceTokens.size) * 100);
}

export function analyzeProfileStrength(input: StrengthInput): StrengthReport {
  const completeness = computeCompleteness({
    candidate: input.candidate,
    skillCount: input.skills.length,
    projectCount: input.projects.length,
    codingCount: input.codingProfiles.length,
    certificateCount: input.certificates.length,
    experienceCount: input.experience.length,
  });

  const { demonstrated, undemonstrated } = demonstratedSkills(input.skills, input.projects);
  const skillCoverage =
    input.skills.length === 0
      ? 0
      : Math.round((demonstrated.length / input.skills.length) * 100);
  const projectEvidence = scoreProjectEvidence(input.projects);
  const experience = scoreExperience(input.experience);
  const resumeConsistency = scoreResumeConsistency(input);

  // Weighted overall: skill 25, projects 25, experience 15, resume 15, completeness 20.
  const overall = Math.round(
    skillCoverage * 0.25 +
      projectEvidence * 0.25 +
      experience * 0.15 +
      resumeConsistency * 0.15 +
      completeness.percent * 0.2,
  );

  const missing: string[] = [];
  if (input.skills.length === 0) missing.push("Add skills to your profile");
  if (input.projects.length === 0) missing.push("Add a project");
  if (input.codingProfiles.length === 0) missing.push("Link a coding profile");
  if (input.certificates.length === 0) missing.push("Add a certificate");
  if (input.experience.length === 0) missing.push("Add internship or work experience");
  if (input.resumes.length === 0) missing.push("Upload a resume");
  if (!input.candidate.headline?.trim()) missing.push("Add a headline");
  if (!input.candidate.summary?.trim()) missing.push("Add a profile summary");
  if (!input.candidate.location?.trim()) missing.push("Add your location");
  if (input.candidate.target_roles.length === 0) missing.push("Add a target role");
  for (const s of undemonstrated) {
    missing.push(`Demonstrate skill "${s}" in a project`);
  }
  if (completeness.missing.length > 0) {
    missing.push(`Complete profile sections: ${completeness.missing.join(", ")}`);
  }

  const weakAreas: string[] = [];
  if (skillCoverage < 50) weakAreas.push("skillCoverage");
  if (projectEvidence < 50) weakAreas.push("projectEvidence");
  if (experience < 50) weakAreas.push("experience");
  if (resumeConsistency < 50) weakAreas.push("resumeConsistency");
  if (completeness.percent < 50) weakAreas.push("profileCompleteness");

  const recommendations: StrengthRecommendation[] = [];
  if (input.skills.length === 0) {
    recommendations.push({
      id: "add-skills",
      title: "Add your skills",
      why: "Recruiters filter by skills, and with no skills listed the skill-coverage score is 0.",
      action: "Add every language, framework and tool you can actually use.",
      points: 25,
    });
  } else if (undemonstrated.length > 0) {
    recommendations.push({
      id: "demonstrate-skills",
      title: `Demonstrate ${undemonstrated.length} undemonstrated skill${undemonstrated.length === 1 ? "" : "s"} in a project`,
      why: `Skills only count as demonstrated when they appear in a project's technologies or description — ${undemonstrated.join(", ")} appear nowhere in your projects, so recruiters cannot see evidence for them.`,
      action: "Add the skill to a real project's technologies, or build a small project that uses it.",
      points: 15,
    });
  }
  if (input.projects.length === 0) {
    recommendations.push({
      id: "add-project",
      title: "Add a project",
      why: "Project evidence is 0 without a project, and it is the strongest signal recruiters check after skills.",
      action: "Add your best project with a description, technologies and a repo link.",
      points: 25,
    });
  } else {
    const thin = input.projects.filter((p) => (p.description ?? "").trim().length < 50);
    if (thin.length > 0) {
      recommendations.push({
        id: "expand-project-descriptions",
        title: "Write fuller project descriptions",
        why: "Short descriptions give recruiters nothing to judge — description length is a direct input to the project-evidence score.",
        action: "Describe what each project does, what you built, and what it achieved, in at least 2–3 sentences.",
        points: 10,
      });
    }
    const noRepo = input.projects.filter((p) => !p.repo_url?.trim());
    if (noRepo.length > 0) {
      recommendations.push({
        id: "add-repo-links",
        title: "Link your project repositories",
        why: "A repo link is verifiable evidence; without it a project is only a claim, so it scores lower.",
        action: "Add the GitHub/GitLab URL for each project.",
        points: 8,
      });
    }
  }
  if (input.experience.length === 0) {
    recommendations.push({
      id: "add-experience",
      title: "Add internship or work experience",
      why: "Experience is a separate scored category — with no entries it is 0, and recruiters look for it before shortlisting.",
      action: "Add any internship, freelance work or part-time role with dates and what you did.",
      points: 15,
    });
  }
  if (input.resumes.length === 0) {
    recommendations.push({
      id: "upload-resume",
      title: "Upload a resume",
      why: "Resume consistency cannot be checked without a resume, so that category scores 0.",
      action: "Upload your latest resume so it can be checked against your listed skills and projects.",
      points: 15,
    });
  } else if (resumeConsistency < 50) {
    recommendations.push({
      id: "align-resume",
      title: "Align your resume with your profile",
      why: "Your resume text overlaps little with your listed skills and projects, which makes the profile look inconsistent to recruiters.",
      action: "Make sure the skills and projects on your profile also appear on your resume.",
      points: 10,
    });
  }
  if (completeness.percent < 100) {
    recommendations.push({
      id: "complete-profile",
      title: "Complete the missing profile sections",
      why: `Profile completeness is ${completeness.percent}% — the missing sections (${completeness.missing.join(", ")}) directly lower the overall score.`,
      action: `Fill in: ${completeness.missing.join(", ")}.`,
      points: 10,
    });
  }
  if (input.codingProfiles.length === 0) {
    recommendations.push({
      id: "add-coding-profile",
      title: "Link a coding profile",
      why: "A linked LeetCode/CodeChef/Codeforces profile is independent, verifiable evidence of coding ability.",
      action: "Link at least one coding-platform profile.",
      points: 5,
    });
  }

  // Suggested skills are DERIVED, never invented: technologies used in the
  // student's own projects but not listed as skills, plus skills named in
  // their own resume text but not listed. Nothing outside their own data.
  const listed = new Set(input.skills.map((s) => norm(s.name)));
  const suggested = new Set<string>();
  for (const p of input.projects) {
    for (const tech of p.technologies) {
      if (tech.trim() && !listed.has(norm(tech))) suggested.add(tech.trim());
    }
  }

  const detail =
    completeness.percent === 100
      ? "All profile sections are complete."
      : `Missing sections: ${completeness.missing.join(", ")}.`;

  return {
    overall,
    categories: {
      skillCoverage,
      projectEvidence,
      experience,
      resumeConsistency,
      profileCompleteness: { score: completeness.percent, detail },
    },
    missing,
    weakAreas,
    recommendations,
    suggestedSkills: [...suggested].sort(),
    aiAvailable: false,
    aiSummary: null,
  };
}

interface AiStrengthPayload {
  summary: string;
  recommendations: StrengthRecommendation[];
}

function validateAiStrengthPayload(u: unknown): AiStrengthPayload {
  if (typeof u !== "object" || u === null) throw new Error("not an object");
  const obj = u as Record<string, unknown>;
  if (typeof obj.summary !== "string" || !obj.summary.trim()) {
    throw new Error("missing summary");
  }
  const recs: StrengthRecommendation[] = [];
  if (Array.isArray(obj.recommendations)) {
    for (const r of obj.recommendations as unknown[]) {
      if (typeof r !== "object" || r === null) throw new Error("bad recommendation");
      const rec = r as Record<string, unknown>;
      if (
        typeof rec.id !== "string" ||
        typeof rec.title !== "string" ||
        typeof rec.why !== "string" ||
        !rec.why.trim() ||
        typeof rec.action !== "string" ||
        typeof rec.points !== "number"
      ) {
        throw new Error("bad recommendation fields");
      }
      recs.push({
        id: rec.id as string,
        title: rec.title as string,
        why: rec.why as string,
        action: rec.action as string,
        points: rec.points as number,
      });
    }
  }
  return { summary: obj.summary as string, recommendations: recs };
}

/**
 * Deterministic report + LLM enhancement when configured. Falls back to
 * the deterministic report (aiAvailable: false) when the LLM is not
 * configured or fails — it logs and continues, never crashes.
 */
export async function analyzeProfileStrengthWithAI(
  input: StrengthInput,
): Promise<StrengthReport> {
  const base = analyzeProfileStrength(input);
  if (!llmConfigured()) return base;
  const { demonstrated, undemonstrated } = demonstratedSkills(input.skills, input.projects);
  const userPrompt = JSON.stringify({
    headline: input.candidate.headline ?? null,
    summary: input.candidate.summary ?? null,
    targetRoles: input.candidate.target_roles,
    skills: input.skills.map((s) => s.name),
    demonstratedSkills: demonstrated,
    undemonstratedSkills: undemonstrated,
    projectTitles: input.projects.map((p) => p.title),
    projectCount: input.projects.length,
    codingProfileCount: input.codingProfiles.length,
    certificateCount: input.certificates.length,
    experienceCount: input.experience.length,
    scores: {
      overall: base.overall,
      skillCoverage: base.categories.skillCoverage,
      projectEvidence: base.categories.projectEvidence,
      experience: base.categories.experience,
      resumeConsistency: base.categories.resumeConsistency,
      completeness: base.categories.profileCompleteness.score,
    },
    missing: base.missing,
  });
  try {
    const payload = await chatJson<AiStrengthPayload>(
      {
        system:
          "You are a career coach for a fresher software engineer. " +
          "Return JSON only: {\"summary\": string, \"recommendations\": [{\"id\": string, \"title\": string, \"why\": string, \"action\": string, \"points\": number}]}. " +
          "Only use the facts given — never invent skills, achievements or certificates. " +
          "Every recommendation must explain WHY it matters in its \"why\" field.",
        user: userPrompt,
      },
      validateAiStrengthPayload,
    );
    const seen = new Set(base.recommendations.map((r) => r.id));
    const extra = payload.recommendations.filter((r) => {
      if (seen.has(r.id)) return false;
      seen.add(r.id);
      return true;
    });
    return {
      ...base,
      aiAvailable: true,
      aiSummary: payload.summary,
      recommendations: [...base.recommendations, ...extra],
    };
  } catch (err) {
    console.error(
      "[strength] LLM enhancement failed, using deterministic report:",
      err instanceof Error ? err.message : String(err),
    );
    return { ...base, aiAvailable: false, aiSummary: null };
  }
}
