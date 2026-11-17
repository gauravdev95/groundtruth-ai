"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowRight, FileText, PencilLine } from "lucide-react";
import { RequireAuth } from "@/components/auth/RequireAuth";
import { StudentPageHead, StudentShell } from "@/components/student/StudentShell";
import { OnboardingProgress, OnboardingStepper } from "@/components/student/OnboardingShell";
import { useStudentProfile } from "@/components/student/useStudentProfile";
import { ResumeCard } from "@/components/student/ProfileForms";
import {
  ONBOARDING_STAGES,
  setOnboardingChoice,
  stagePath,
} from "@/lib/student";

function ChooseContent() {
  const router = useRouter();
  const { profile, loading, error, setProfile } = useStudentProfile();
  const [choice, setChoice] = useState<"resume_upload" | "manual_entry" | null>(null);
  const [busy, setBusy] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  useEffect(() => {
    if (profile?.candidate.onboarding_choice) {
      setChoice(profile.candidate.onboarding_choice);
    }
  }, [profile]);

  if (loading) {
    return (
      <div className="st-loading" role="status" aria-label="Loading">
        <span className="st-spinner" aria-hidden="true" />
        <p>Loading your setup…</p>
      </div>
    );
  }

  if (error || !profile) {
    return (
      <div className="st-empty">
        <h2>Couldn&apos;t load your setup</h2>
        <p>{error ?? "Something went wrong."}</p>
        <button type="button" className="st-btn st-btn-blue" onClick={() => window.location.reload()}>
          Try again
        </button>
      </div>
    );
  }

  // Completed onboarding lives on the dashboard — this flow is for setup.
  if (profile.candidate.onboarding_completed_at) {
    router.replace("/student/dashboard");
    return null;
  }

  const doneSections = new Set(
    Object.entries(profile.completeness.sections)
      .filter(([, s]) => s.done)
      .map(([k]) => k),
  );
  const stage = ONBOARDING_STAGES[0] as (typeof ONBOARDING_STAGES)[number];

  async function onContinue() {
    if (!choice) return;
    setBusy(true);
    setSaveError(null);
    try {
      await setOnboardingChoice(choice);
      router.push(stagePath(ONBOARDING_STAGES[1] as (typeof ONBOARDING_STAGES)[number]));
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : "Could not save your choice.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <StudentPageHead
        eyebrow="Profile setup"
        title={
          <>
            Let&apos;s build your <span className="blue">verified profile.</span>
          </>
        }
        sub="Eight short stages. The first three — basic info, GitHub and one project — are required; coding profiles, certificates and experience are optional and can be skipped."
      />
      <OnboardingStepper current={stage} doneSections={doneSections} />
      <div style={{ marginTop: 18 }}>
        <OnboardingProgress stage={stage} />
      </div>

      <div className="st-panel st-section-gap">
        <h2>How do you want to start?</h2>
        <p className="st-panel-desc">
          Upload your resume and we&apos;ll keep it with your profile, or enter everything manually — either way you&apos;ll fill in the same stages.
        </p>
        <div className="st-option-grid" role="radiogroup" aria-label="Setup method">
          <button
            type="button"
            role="radio"
            aria-checked={choice === "resume_upload"}
            className={`st-option${choice === "resume_upload" ? " selected" : ""}`}
            onClick={() => setChoice("resume_upload")}
          >
            <span className="st-panel-icon" aria-hidden="true">
              <FileText size={20} />
            </span>
            <strong>Upload my resume</strong>
            <span>Start from a PDF resume. It&apos;s stored with your profile; you&apos;ll still confirm each section yourself.</span>
          </button>
          <button
            type="button"
            role="radio"
            aria-checked={choice === "manual_entry"}
            className={`st-option${choice === "manual_entry" ? " selected" : ""}`}
            onClick={() => setChoice("manual_entry")}
          >
            <span className="st-panel-icon" aria-hidden="true">
              <PencilLine size={20} />
            </span>
            <strong>Enter it manually</strong>
            <span>Fill in each stage by hand. Best if your resume isn&apos;t ready, or you&apos;d rather type it all in.</span>
          </button>
        </div>

        {choice === "resume_upload" ? (
          <div style={{ marginTop: 20 }}>
            <ResumeCard profile={profile} onSaved={setProfile} />
            <p className="st-note">
              <strong>Note:</strong> your resume is stored as a file — it doesn&apos;t
              auto-fill the stages yet. Resume parsing runs in the background when
              Cloudinary is configured; until then, fill each stage in yourself.
            </p>
          </div>
        ) : null}

        {saveError ? (
          <div className="st-alert st-alert-error" role="alert" style={{ marginTop: 16 }}>
            {saveError}
          </div>
        ) : null}

        <div className="st-form-actions">
          <span />
          <div className="st-actions-right">
            <button
              type="button"
              className="st-btn st-btn-blue"
              onClick={onContinue}
              disabled={!choice || busy}
            >
              {busy ? "Saving…" : "Continue to Basic info"}
              <ArrowRight size={16} aria-hidden="true" />
            </button>
          </div>
        </div>
      </div>
    </>
  );
}

export default function StudentOnboardingPage() {
  return (
    <RequireAuth roles={["candidate"]}>
      <StudentShell>
        <ChooseContent />
      </StudentShell>
    </RequireAuth>
  );
}
