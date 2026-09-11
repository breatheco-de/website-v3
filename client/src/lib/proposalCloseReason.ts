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

export function closeNoteRequired(reason: ProposalCloseReasonValue): boolean {
  return reason !== "wont_fix";
}

export const CLOSE_NOTE_MIN = 20;

/** Accept idea next-step note (matches server MIN_ACCEPT_NEXT_STEP). */
export const ACCEPT_NEXT_STEP_MIN = 20;
