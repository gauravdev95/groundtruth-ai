"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { FlaskConical, FolderGit2 } from "lucide-react";
import { RequireAuth } from "@/components/auth/RequireAuth";
import { StudentPageHead, StudentShell } from "@/components/student/StudentShell";
import {
  BackToHub,
  ErrorState,
  InlineError,
  LoadingState,
} from "@/components/assessment/shared";
import {
  createAssessment,
  fetchDemoProject,
  type TimeLimitMinutes,
} from "@/lib/api";
import { fetchProfile, type FullProfile } from "@/lib/student";

const TIME_LIMITS: TimeLimitMinutes[] = [30, 45, 60, 90];

function NewAssessmentContent() {
  const router = useRouter();
  const [profile, setProfile] = useState<FullProfile | null>(null);
  const [demoFileCount, setDemoFileCount] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [choice, setChoice] = useState<"profile_project" | "manual">("manual");
  const [timeLimit, setTimeLimit] = useState<TimeLimitMinutes>(60);
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const p = await fetchProfile();
        const demo = await fetchDemoProject().catch(() => null);
        if (cancelled) return;
        setProfile(p);
        setDemoFileCount(demo === null ? null : Object.keys(demo.files).length);
        if (p.projects.length > 0) setChoice("profile_project");
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Could not load your profile.");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  async function onCreate() {
    setCreating(true);
    setCreateError(null);
    try {
      const project = profile?.projects[0];
      const assessment = await createAssessment({
        source: choice,
        timeLimitMinutes: timeLimit,
        ...(choice === "profile_project" && project ? { projectId: project.id } : {}),
      });
      router.push(`/assessment/${assessment.id}/challenge`);
    } catch (err) {
      setCreateError(
        err instanceof Error ? err.message : "Could not create the assessment.",
      );
    } finally {
      setCreating(false);
    }
  }

  if (loading) return <LoadingState text="Loading your project…" />;
  if (error || !profile) {
    return <ErrorState message={error ?? "Something went wrong."} onRetry={() => window.location.reload()} />;
  }

  const project = profile.projects[0] ?? null;

  return (
    <div className="st-stack">
      <section className="st-panel" aria-label="Choose a project">
        <h2>Choose what the challenge is built from</h2>
        <p className="st-panel-desc">
          The challenge is generated from the code of the project you pick.
          GitHub-based assessments are not available — connecting a GitHub
          account is not set up yet, so only these two options are offered.
        </p>

        <div className="st-option-grid" role="radiogroup" aria-label="Project source">
          <button
            type="button"
            role="radio"
            aria-checked={choice === "profile_project"}
            className={`st-option ${choice === "profile_project" ? "selected" : ""}`}
            onClick={() => setChoice("profile_project")}
            disabled={!project}
          >
            <span className="st-panel-icon" aria-hidden="true"><FolderGit2 size={20} /></span>
            <strong>Your profile project</strong>
            {project ? (
              <span>
                {project.title}
                {project.description ? ` — ${project.description}` : ""}
                {project.technologies.length > 0
                  ? ` (${project.technologies.join(", ")})`
                  : ""}
              </span>
            ) : (
              <span>
                You have no project on your profile yet. Add your one project
                first — it is the main evidence for your assessments.
              </span>
            )}
          </button>

          <button
            type="button"
            role="radio"
            aria-checked={choice === "manual"}
            className={`st-option ${choice === "manual" ? "selected" : ""}`}
            onClick={() => setChoice("manual")}
          >
            <span className="st-panel-icon" aria-hidden="true"><FlaskConical size={20} /></span>
            <strong>Demo project</strong>
            <span>
              The bundled Python demo project
              {demoFileCount !== null ? ` (${demoFileCount} files)` : ""} — a
              small working codebase you can explore first, with no profile
              project needed.
            </span>
          </button>
        </div>

        {!project ? (
          <p style={{ marginTop: 16 }}>
            <Link href="/student/onboarding/projects" className="st-btn st-btn-outline st-btn-sm">
              Add your project
            </Link>
          </p>
        ) : null}
      </section>

      <section className="st-panel" aria-label="Time limit">
        <h2>Time limit</h2>
        <p className="st-panel-desc">
          How long the Lab stays open once you start. The countdown runs from
          the moment you press “Start Lab”.
        </p>
        <div className="st-checkbox-grid" role="radiogroup" aria-label="Time limit in minutes" style={{ marginTop: 14 }}>
          {TIME_LIMITS.map((m) => (
            <button
              key={m}
              type="button"
              role="radio"
              aria-checked={timeLimit === m}
              className={`st-check-pill ${timeLimit === m ? "on" : ""}`}
              onClick={() => setTimeLimit(m)}
            >
              {m} minutes
            </button>
          ))}
        </div>
      </section>

      {createError ? <InlineError message={createError} /> : null}

      <div className="st-form-actions">
        <BackToHub />
        <div className="st-actions-right">
          <button
            type="button"
            className="st-btn st-btn-blue"
            onClick={onCreate}
            disabled={creating || (choice === "profile_project" && !project)}
          >
            {creating ? "Creating…" : "Create assessment & continue"}
          </button>
        </div>
      </div>
    </div>
  );
}

export default function NewAssessmentPage() {
  return (
    <RequireAuth roles={["candidate"]}>
      <StudentShell>
        <StudentPageHead
          eyebrow="New Assessment"
          title={<>Start a new <span className="blue">assessment</span></>}
          sub="Pick the project the challenge is built from and a time limit. The next step analyses the code, generates your challenge, and asks for monitoring consent before the Lab opens."
        />
        <NewAssessmentContent />
      </StudentShell>
    </RequireAuth>
  );
}
