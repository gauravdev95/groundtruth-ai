"use client";

import Link from "next/link";
import { Check } from "lucide-react";
import {
  ONBOARDING_STAGES,
  stagePath,
  type OnboardingStage,
} from "@/lib/student";

/**
 * Onboarding stepper: the eight stages from the old repo's flow, same
 * slugs and order. A stage is "done" when the server says its section is
 * complete — the client never decides that itself.
 */
export function OnboardingStepper({
  current,
  doneSections,
}: {
  current: OnboardingStage;
  doneSections: Set<string>;
}) {
  return (
    <div className="st-stepper" role="list" aria-label="Onboarding stages">
      {ONBOARDING_STAGES.map((stage) => {
        const isCurrent = stage.slug === current.slug;
        const isDone =
          stage.section !== null && doneSections.has(stage.section);
        return (
          <div
            key={stage.slug || "choose"}
            role="listitem"
            className={`st-step${isDone ? " done" : ""}${isCurrent ? " current" : ""}`}
            aria-current={isCurrent ? "step" : undefined}
          >
            <span className="st-step-dot" aria-hidden="true">
              {isDone ? <Check size={14} /> : ONBOARDING_STAGES.indexOf(stage) + 1}
            </span>
            <p className="st-step-label">
              {stage.label}
              {!stage.isMandatory ? (
                <>
                  <br />
                  <span className="st-step-optional">Optional</span>
                </>
              ) : null}
            </p>
          </div>
        );
      })}
    </div>
  );
}

export function OnboardingProgress({ stage }: { stage: OnboardingStage }) {
  return (
    <div>
      <div className="st-meter-row">
        <span className="st-stat-label">
          Step {ONBOARDING_STAGES.indexOf(stage) + 1} of {ONBOARDING_STAGES.length} — {stage.label}
        </span>
        <span className="st-stat-label">{stage.percent}% through the flow</span>
      </div>
      <div className="st-meter" role="progressbar" aria-valuenow={stage.percent} aria-valuemin={0} aria-valuemax={100} aria-label="Onboarding progress">
        <div className="st-meter-fill" style={{ width: `${stage.percent}%` }} />
      </div>
    </div>
  );
}

export function StageNav({
  current,
  onNext,
  nextLabel,
  nextDisabled,
  busy,
}: {
  current: OnboardingStage;
  onNext?: () => void;
  nextLabel?: string;
  nextDisabled?: boolean;
  busy?: boolean;
}) {
  const index = ONBOARDING_STAGES.indexOf(current);
  const prev = index > 0 ? ONBOARDING_STAGES[index - 1] : undefined;
  const next = ONBOARDING_STAGES[index + 1];
  return (
    <div className="st-form-actions">
      {prev ? (
        <Link href={stagePath(prev)} className="st-btn st-btn-outline">
          ← Back
        </Link>
      ) : (
        <span />
      )}
      <div className="st-actions-right">
        {!current.isMandatory && next ? (
          <Link href={stagePath(next)} className="st-btn st-btn-outline">
            Skip for now
          </Link>
        ) : null}
        {next ? (
          onNext ? (
            <button
              type="button"
              className="st-btn st-btn-blue"
              onClick={onNext}
              disabled={nextDisabled || busy}
            >
              {busy ? "Saving…" : (nextLabel ?? `Continue to ${next.label}`)}
            </button>
          ) : (
            <Link href={stagePath(next)} className="st-btn st-btn-blue">
              {nextLabel ?? `Continue to ${next.label}`}
            </Link>
          )
        ) : null}
      </div>
    </div>
  );
}
