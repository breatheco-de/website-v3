/** Staff-facing close reasons for notes proposals (matches server ProposalCloseReason). */
export const PROPOSAL_CLOSE_REASON_OPTIONS = [
  {
    value: "wont_fix" as const,
    label: "Won’t fix",
    hint: "We decided not to do this. Note optional.",
  },
  {
    value: "fixed_elsewhere" as const,
    label: "Fixed elsewhere",
    hint: "Already fixed outside this proposal — say where (min 20 characters).",
  },
  {
    value: "tracked_elsewhere" as const,
    label: "Tracked elsewhere",
    hint: "Follow-up lives on another proposal or issue — say where (min 20 characters).",
  },
  {
    value: "other" as const,
    label: "Other",
    hint: "Required note (min 20 characters).",
  },
];

export type ProposalCloseReasonValue = (typeof PROPOSAL_CLOSE_REASON_OPTIONS)[number]["value"];

/** Park reasons for ideas (Accept uses a separate next_step flow; no fixed_elsewhere). */
export const IDEA_PARK_CLOSE_REASON_OPTIONS = PROPOSAL_CLOSE_REASON_OPTIONS.filter(
  (o) =>
    o.value === "wont_fix" ||
    o.value === "tracked_elsewhere" ||
    o.value === "other",
);

export type IdeaParkCloseReasonValue = (typeof IDEA_PARK_CLOSE_REASON_OPTIONS)[number]["value"];

/** Why an accepted idea was retired (matches server IDEA_RETIRE_REASONS). */
export const IDEA_RETIRE_REASON_OPTIONS = [
  {
    value: "already_done" as const,
    label: "Already done",
    hint: "The change is already live. Say where (min 20 characters).",
  },
  {
    value: "no_longer_relevant" as const,
    label: "No longer relevant",
    hint: "What made this idea worth doing is gone. Say what changed (min 20 characters).",
  },
];

export type IdeaRetireReasonValue = (typeof IDEA_RETIRE_REASON_OPTIONS)[number]["value"];

export function isIdeaRetireReason(reason: string | null | undefined): reason is IdeaRetireReasonValue {
  return IDEA_RETIRE_REASON_OPTIONS.some((o) => o.value === reason);
}

/** Staff label for any close / retire reason; unknown values fall back to the raw key. */
export function closeReasonOptionLabel(reason: string | null | undefined): string | undefined {
  if (!reason) return undefined;
  return (
    PROPOSAL_CLOSE_REASON_OPTIONS.find((o) => o.value === reason)?.label ??
    IDEA_RETIRE_REASON_OPTIONS.find((o) => o.value === reason)?.label
  );
}

export function closeNoteRequired(reason: ProposalCloseReasonValue): boolean {
  return reason !== "wont_fix";
}

export const CLOSE_NOTE_MIN = 20;

/** Accept idea next-step note (matches server MIN_ACCEPT_NEXT_STEP). */
export const ACCEPT_NEXT_STEP_MIN = 20;
