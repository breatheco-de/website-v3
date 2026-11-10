/**
 * Variant age / activity / delete verdict for MCP (list_variants rows, delete_variant preflight).
 * Facts come from the main server (server/versioning/variant-info.ts); the verdict rules live in
 * shared/variant-health.ts so the Versions panel popover and agents always agree.
 */

import {
  NON_OVERRIDABLE_VARIANT_REASONS,
  overridableVariantReasons,
  type VariantAgeState,
  type VariantCleanupState,
  type VariantHealth,
  type VariantReason,
  type VariantVerdict,
} from "../../shared/variant-health.js";

/** Subset of the server VariantInfo payload MCP reads. */
export type VariantInfoPayload = {
  health: Pick<VariantHealth, "verdict" | "age_state" | "created_at" | "updated_at" | "reasons" | "notes"> & {
    cleanup?: VariantCleanupState | null;
  };
  facts: { changes_vs_live: number | null; behind_live: boolean };
  siblings?: Array<{ locale: string; updated_at: string | null; verdict: VariantVerdict }>;
};

export type VariantRowFields = {
  created_at: string | null;
  updated_at: string | null;
  age_state: VariantAgeState;
  verdict: VariantVerdict;
  reasons: VariantReason[];
  behind_live: boolean;
  changes_vs_live: number | null;
  sibling_locales: Array<{ locale: string; updated_at: string | null; verdict: VariantVerdict }>;
  /** Scheduled for deletion by the daily abandoned-draft cleanup; null when not flagged. */
  cleanup: VariantCleanupState | null;
};

export function variantRowFields(info: VariantInfoPayload | null | undefined): VariantRowFields | null {
  if (!info?.health) return null;
  return {
    created_at: info.health.created_at,
    updated_at: info.health.updated_at,
    age_state: info.health.age_state,
    verdict: info.health.verdict,
    reasons: info.health.reasons,
    behind_live: info.facts?.behind_live === true,
    changes_vs_live: info.facts?.changes_vs_live ?? null,
    sibling_locales: info.siblings ?? [],
    cleanup: info.health.cleanup ?? null,
  };
}

/** list_variants warning for drafts the daily cleanup will delete (null when none are flagged). */
export function scheduledCleanupWarning(
  rows: Array<{ slug: string; locale: string; cleanup?: VariantCleanupState | null }>,
): { code: "draft_scheduled_for_cleanup"; message: string; drafts: Array<{ slug: string; locale: string; deletes_at: string; tier: string }> } | null {
  const flagged = rows.filter((r) => r.cleanup);
  if (!flagged.length) return null;
  return {
    code: "draft_scheduled_for_cleanup",
    message:
      `${flagged.map((r) => `${r.slug}.${r.locale} (deletes_at ${r.cleanup!.deletes_at})`).join(", ")}: ` +
      "the daily abandoned-draft cleanup will delete these. Any content edit resets the clock (staff can also press Keep for now in the Versions panel). " +
      "Only drafts not linked to a proposal are cleaned this way; proposal drafts follow the proposal sweeps. " +
      "A deleted draft is recovered by hand from the content repo history on GitHub.",
    drafts: flagged.map((r) => ({ slug: r.slug, locale: r.locale, deletes_at: r.cleanup!.deletes_at, tier: r.cleanup!.tier })),
  };
}

export type DeletePreflight =
  | { kind: "blocked_open_proposal"; reasons: VariantReason[] }
  | { kind: "confirm_required"; reasons: VariantReason[] }
  | { kind: "proceed"; overridden: VariantReason[] };

/**
 * Open proposal: never deletable by agents. Other in-use reasons: stop until the agent
 * re-calls with confirm_variant_in_use after telling the user. Traffic stays the server's 400.
 */
export function deleteVariantPreflight(info: VariantInfoPayload | null, confirmInUse: boolean): DeletePreflight {
  if (!info?.health) return { kind: "proceed", overridden: [] };
  const blocking = info.health.reasons.filter((r) => NON_OVERRIDABLE_VARIANT_REASONS.includes(r.code));
  if (blocking.length > 0) return { kind: "blocked_open_proposal", reasons: blocking };
  if (info.health.verdict !== "check_first") return { kind: "proceed", overridden: [] };
  const reasons = overridableVariantReasons(info.health);
  if (reasons.length === 0) return { kind: "proceed", overridden: [] };
  return confirmInUse ? { kind: "proceed", overridden: reasons } : { kind: "confirm_required", reasons };
}
