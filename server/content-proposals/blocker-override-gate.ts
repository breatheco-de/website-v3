/** Staff override of open blockers on apply / accept: who may ask for it (no I/O). */

export type BlockerOverrideGateInput = {
  actorType?: string | null;
  mcpAuthorHeader: boolean;
  hasReviewCapability: boolean;
};

export type BlockerOverrideGateResult =
  | { ok: true }
  | { ok: false; code: "override_staff_only" | "review_required"; error: string };

export function checkBlockerOverrideRequest(input: BlockerOverrideGateInput): BlockerOverrideGateResult {
  if (input.actorType === "mcp" || input.mcpAuthorHeader) {
    return {
      ok: false,
      code: "override_staff_only",
      error:
        "Approving past open blockers is a staff UI action — agents cannot override. Resolve the blockers, or leave the proposal for staff.",
    };
  }
  if (!input.hasReviewCapability) {
    return {
      ok: false,
      code: "review_required",
      error: "Review proposals (proposals_review) is required to approve past open blockers.",
    };
  }
  return { ok: true };
}
