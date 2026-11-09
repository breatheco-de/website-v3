import { describe, expect, it } from "vitest";
import { variantVerdict, type VariantFacts } from "../../shared/variant-health";
import { deleteVariantPreflight, variantRowFields, type VariantInfoPayload } from "./variant-info-mcp";

const NOW = Date.parse("2026-11-09T12:00:00.000Z");
const daysAgo = (n: number) => new Date(NOW - n * 86_400_000).toISOString();

function info(over: Partial<VariantFacts> = {}): VariantInfoPayload {
  const facts: VariantFacts = {
    allocation: 0,
    created_at: daysAgo(90),
    based_on_at: daysAgo(90),
    updated_at: daysAgo(80),
    proposal: { state: "none" },
    test: { state: "never" },
    on_live_server: true,
    has_live: true,
    changes_vs_live: 0,
    behind_live: false,
    is_last_draft_of_unpublished: false,
    ...over,
  };
  return { health: variantVerdict(facts, NOW), facts, siblings: [{ locale: "es", updated_at: daysAgo(2), verdict: "check_first" }] };
}

describe("deleteVariantPreflight", () => {
  it("proceeds when the variant is probably safe", () => {
    expect(deleteVariantPreflight(info(), false)).toEqual({ kind: "proceed", overridden: [] });
  });

  it("stops for confirmation on in-use reasons, then proceeds and reports what was overridden", () => {
    const recent = info({ updated_at: daysAgo(2), changes_vs_live: 2 });
    const stop = deleteVariantPreflight(recent, false);
    expect(stop.kind).toBe("confirm_required");
    if (stop.kind === "confirm_required") {
      expect(stop.reasons.map((r) => r.code)).toEqual(["recently_edited", "changes_not_on_live"]);
    }
    const go = deleteVariantPreflight(recent, true);
    expect(go.kind).toBe("proceed");
    if (go.kind === "proceed") expect(go.overridden.map((r) => r.code)).toEqual(["recently_edited", "changes_not_on_live"]);
  });

  it("an open proposal fails even with the flag", () => {
    const linked = info({ proposal: { state: "open", title: "Spring CTA" }, updated_at: daysAgo(1) });
    expect(deleteVariantPreflight(linked, true).kind).toBe("blocked_open_proposal");
  });

  it("an unverified proposal is overridable", () => {
    const res = deleteVariantPreflight(info({ proposal: { state: "unverified" } }), true);
    expect(res).toMatchObject({ kind: "proceed", overridden: [{ code: "proposal_unverified" }] });
  });

  it("traffic is left to the server's VARIANT_HAS_TRAFFIC block", () => {
    expect(deleteVariantPreflight(info({ allocation: 20 }), false)).toEqual({ kind: "proceed", overridden: [] });
  });

  it("missing info (file gone, server down) proceeds", () => {
    expect(deleteVariantPreflight(null, false)).toEqual({ kind: "proceed", overridden: [] });
  });
});

describe("variantRowFields", () => {
  it("maps verdict, dates, drift and siblings onto a list_variants row", () => {
    const row = variantRowFields(info({ behind_live: true }))!;
    expect(row).toMatchObject({
      verdict: "probably_safe",
      age_state: "stale",
      created_at: daysAgo(90),
      updated_at: daysAgo(80),
      behind_live: true,
      changes_vs_live: 0,
      sibling_locales: [{ locale: "es", verdict: "check_first" }],
    });
  });

  it("returns null without info", () => {
    expect(variantRowFields(undefined)).toBeNull();
  });
});
