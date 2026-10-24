/** Server warning code when an idea reads like a current-demand pitch but has no demand label. */
export const EXISTING_DEMAND_UNDECLARED = "existing_demand_undeclared";

export type ReviewSituationOption = {
  id: string;
  label: string;
  when_to_use: string;
};

/** Labels for live situation chips (includes idea-only ids not in the edits editor). */
export const STAFF_REVIEW_SITUATION_LABELS: Record<string, string> = {
  internal_links: "Hub / internal links",
  serp_title_description: "Search title / description",
  funnel_classification: "Funnel stage / products",
  body_copy_edit: "Body / field edit",
  selling_figures: "Outcome figures",
  new_public_content: "New public content",
  promote_draft: "Promote draft",
  locale_translation: "Locale translation",
  idea_opportunity_harm: "Idea opportunity vs harm",
  anticipated_demand: "Anticipated demand",
  existing_demand: "Existing search demand",
  fast_decay_news: "Fast-decay news",
  broken_url: "Broken URL",
};

/** Catalog labels for staff multi-select on edits only (keep in sync with server review-situations). */
export const STAFF_REVIEW_SITUATION_OPTIONS: ReviewSituationOption[] = [
  {
    id: "internal_links",
    label: "Hub / internal links",
    when_to_use: "Body adds same-locale hub or cluster links without rewriting facts or SERP.",
  },
  {
    id: "serp_title_description",
    label: "Search title / description",
    when_to_use: "Changes to search title or meta description — honest vs live.",
  },
  {
    id: "funnel_classification",
    label: "Funnel stage / products",
    when_to_use:
      "Funnel stage or products — who the buyer is, which product owns them, then how ready they are.",
  },
  {
    id: "body_copy_edit",
    label: "Body / field edit",
    when_to_use: "General copy or field updates that are not link-only, SERP-only, or funnel-only.",
  },
  {
    id: "selling_figures",
    label: "Outcome figures",
    when_to_use: "Hire rates, salaries, tuition, or prices may move (any content type).",
  },
  {
    id: "new_public_content",
    label: "New public content",
    when_to_use: "New or draft-backed public page — angle, facts, and funnel.",
  },
  {
    id: "promote_draft",
    label: "Promote draft",
    when_to_use: "Go-live a named draft with empty or minimal field updates.",
  },
  {
    id: "locale_translation",
    label: "Locale translation",
    when_to_use:
      "Promote a translated locale variant — fidelity to source before go-live (not soft-only polish).",
  },
];

/** Demand labels staff may set on open ideas (at most one). */
export const STAFF_IDEA_DEMAND_SITUATION_OPTIONS: ReviewSituationOption[] = [
  {
    id: "anticipated_demand",
    label: "Anticipated demand",
    when_to_use:
      "New product or feature that will become search volume — lasting questions, not today's volume.",
  },
  {
    id: "existing_demand",
    label: "Existing search demand",
    when_to_use:
      "Rank and/or cite on a query that already has demand — brief must justify SERP maturity and weight class.",
  },
  {
    id: "fast_decay_news",
    label: "Fast-decay news",
    when_to_use: "Announcement with no lasting question — expect a quick reject.",
  },
  {
    id: "broken_url",
    label: "Broken URL",
    when_to_use:
      "Missing address still requested — redirect to a match, or one new page when demand is high.",
  },
];

export function situationLabel(id: string): string {
  return STAFF_REVIEW_SITUATION_LABELS[id] ?? id;
}

/** Filed ids on an idea that are staff-selectable demand labels (drops the always-on default). */
export function filedIdeaDemand(filed: readonly string[] | null | undefined): string[] {
  return (filed ?? []).filter((id) =>
    STAFF_IDEA_DEMAND_SITUATION_OPTIONS.some((o) => o.id === id),
  );
}

export function ideaDemandBadge(opts: {
  filed: readonly string[] | null | undefined;
  warnings?: ReadonlyArray<{ code: string }> | null;
}): { label: string; nudge: boolean } {
  const demand = filedIdeaDemand(opts.filed)[0];
  if (demand) return { label: `Demand: ${situationLabel(demand)}`, nudge: false };
  if ((opts.warnings ?? []).some((w) => w.code === EXISTING_DEMAND_UNDECLARED)) {
    return { label: "Looks like existing search demand — set label?", nudge: true };
  }
  return { label: "Demand: standard review", nudge: false };
}

function joinLabels(ids: readonly string[]): string {
  const labels = ids.map(situationLabel);
  if (labels.length <= 2) return labels.join(", ");
  return `${labels.slice(0, 2).join(", ")} +${labels.length - 2}`;
}

export function editsChecksBadge(opts: {
  filed: readonly string[] | null | undefined;
  live?: readonly string[] | null;
}): { label: string; auto: boolean } {
  const filed = opts.filed ?? [];
  if (filed.length) return { label: `Checks: ${joinLabels(filed)}`, auto: false };
  const live = opts.live ?? [];
  if (live.length) return { label: `Checks: ${joinLabels(live)} (auto)`, auto: true };
  return { label: "Checks: picked by review", auto: true };
}
