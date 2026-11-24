"use client";

// Phase F — compact competency chip for recruiter list views (applications
// list, pipeline cards, dashboard). Shows the candidate's latest computed
// competency profile at a glance.
//
// Provisional vs verified (classification rule
// `provisional-vs-verified-v1`, backend v2 in f146b67): the `category`
// prop is the VERIFIED category only — the server derives it in SQL and
// returns null for it unless the profile is Complete with complete
// interview coverage. The chip is the belt-and-braces layer (Phase 2
// G1): it treats `category` as verified ONLY when `status ===
// "Complete"` — the only status the server ever pairs with a verified
// category. Any other status falls through to the provisional branch,
// even if a category value somehow arrives. So:
//   - category present AND status "Complete" -> a verified result:
//     "64 · L3 Job Ready" (green), titled "Verified Competency Category".
//   - otherwise -> PROVISIONAL only: "Provisional 64 · Assessment
//     Incomplete" (amber), with the provisional band (when known) shown
//     explicitly as provisional, never as verified. The number may be
//     shown, but no band is ever presented as verified.
//   - both null and no status -> "Not assessed" (grey) — never a
//     category or a score that does not exist.
//   - both null but a status exists (G3) -> "Provisional · <status>"
//     (amber), no number: the candidate HAS a profile, it is just
//     Incomplete / Insufficient Evidence / Practical Threshold Not Met.
// Only the L1–L4 categories from the competency framework are ever
// shown; no other label (e.g. "Verified Expert") is used anywhere.

export const COMPETENCY_CATEGORY_LABELS: Record<string, string> = {
  L1: "Foundation",
  L2: "Developing",
  L3: "Job Ready",
  L4: "Strong",
};

export function competencyCategoryLabel(category: string | null): string | null {
  if (!category) return null;
  return COMPETENCY_CATEGORY_LABELS[category] ?? category;
}

/** Display label for a stored profile status. Stored "Incomplete"
 *  renders as "Assessment Incomplete"; see profileStatusLabel in
 *  server/src/services/competencyScoringService.ts (single definition
 *  server-side — this mirrors it for list rows that only carry the
 *  stored status string). */
export function competencyStatusLabel(status: string | null): string | null {
  if (!status) return null;
  if (status === "Incomplete") return "Assessment Incomplete";
  return status;
}

export function CompetencyChip({
  overallScore,
  category,
  status,
  statusLabel,
  provisionalNote,
  provisionalCategory,
}: {
  /** Provisional overall score (renormalised blend). May be shown when
   *  useful, but must never imply verification. */
  overallScore: number | null;
  /** VERIFIED category only (null unless verified). Never pass a
   *  provisional band here. The chip only renders it as verified when
   *  `status === "Complete"` (G1); otherwise it falls through to the
   *  provisional branch. */
  category: string | null;
  /** Stored profile status. */
  status: string | null;
  /** Display label for `status` when the caller has it (e.g. from the
   *  stored profile's statusLabel); derived from `status` otherwise. */
  statusLabel?: string | null;
  /** Interview coverage note for a provisional score, e.g.
   *  "provisional — 6 of 7 questions scored". */
  provisionalNote?: string | null;
  /** PROVISIONAL band of the score (from the list/dashboard rows).
   *  Displayable only as provisional — never as a verified result. */
  provisionalCategory?: string | null;
}) {
  const displayStatus = statusLabel ?? competencyStatusLabel(status);
  // G3: check `status` before the both-null return — a profile with a
  // status but no score and no category is provisional, not unassessed.
  if (overallScore === null && category === null && !provisionalCategory) {
    if (status) {
      return (
        <span
          className="st-chip st-chip-amber"
          title={`Provisional profile — ${displayStatus ?? status}; no verified result yet`}
        >
          Provisional · {displayStatus ?? status}
        </span>
      );
    }
    return <span className="st-chip st-chip-grey">Not assessed</span>;
  }
  // G1: verified ONLY when the stored status is Complete. Any other
  // status falls through to the provisional branch below, even if a
  // category value arrived with the row.
  if (category && status === "Complete") {
    const label = competencyCategoryLabel(category);
    return (
      <span
        className="st-chip st-chip-green"
        title={`Verified Competency Category${status ? ` · ${status}` : ""}`}
      >
        {overallScore !== null ? `${Math.round(overallScore)} · ` : ""}
        {`${category}${label ? ` ${label}` : ""}`}
      </span>
    );
  }
  // Provisional: a number, a status, the provisional band when known,
  // and — when known — the coverage that makes it provisional. Never a
  // band presented as verified.
  const provisionalLabel = provisionalCategory
    ? competencyCategoryLabel(provisionalCategory)
    : null;
  const provisionalBand = provisionalCategory
    ? ` · Provisional band ${provisionalCategory}${provisionalLabel ? ` ${provisionalLabel}` : ""}`
    : "";
  return (
    <span
      className="st-chip st-chip-amber"
      title={
        provisionalNote
          ? `Provisional score — ${provisionalNote}${displayStatus ? ` · ${displayStatus}` : ""}${provisionalBand}`
          : `Provisional score — not a verified result${displayStatus ? ` · ${displayStatus}` : ""}${provisionalBand}`
      }
    >
      {overallScore !== null ? `Provisional ${Math.round(overallScore)}` : "Provisional"}
      {displayStatus ? ` · ${displayStatus}` : ""}
      {provisionalCategory
        ? ` · ${provisionalCategory}${provisionalLabel ? ` ${provisionalLabel}` : ""}`
        : ""}
    </span>
  );
}
