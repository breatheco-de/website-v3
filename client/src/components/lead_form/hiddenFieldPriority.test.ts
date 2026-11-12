import { describe, expect, it } from "vitest";
import { hiddenBadgeId, MAX_TOP_HIDDEN_BADGES, rankHiddenBadges } from "./hiddenFieldPriority";

const f = (name: string) => ({ name, hiddenReason: "builtin_default" as const });

describe("rankHiddenBadges", () => {
  it("orders by the fixed groups and caps the top at 4", () => {
    const { top, rest } = rankHiddenBadges({
      fields: [
        f("first_name"),
        f("coupon"),
        f("event_id"),
        f("region"),
        f("current_download"),
        f("product"),
        f("location"),
        f("program"),
      ],
    });
    expect(top).toHaveLength(MAX_TOP_HIDDEN_BADGES);
    expect(top.map(hiddenBadgeId)).toEqual(["field:program", "field:location", "field:region", "field:product"]);
    expect(rest.map(hiddenBadgeId)).toEqual([
      "field:coupon",
      "field:event_id",
      "field:first_name",
      "field:current_download",
    ]);
  });

  it("keeps extra keys in YAML order between coupon/referral and identity fields", () => {
    const { top, rest } = rankHiddenBadges({
      fields: [f("phone"), f("zeta_extra"), f("alpha_extra"), f("referral_key")],
      max: 10,
    });
    expect([...top, ...rest].map(hiddenBadgeId)).toEqual([
      "field:referral_key",
      "field:zeta_extra",
      "field:alpha_extra",
      "field:phone",
    ]);
  });

  it("ranks signup keys last, in field map order", () => {
    const { top, rest } = rankHiddenBadges({
      fields: [f("plan")],
      signupEntries: [
        { key: "country", from: "session.geo.country" },
        { key: "plan_slug", constant: "free" },
      ],
      max: 2,
    });
    expect(top.map(hiddenBadgeId)).toEqual(["field:plan", "signup:country"]);
    expect(rest.map(hiddenBadgeId)).toEqual(["signup:plan_slug"]);
  });

  it("returns empty lists when nothing is hidden", () => {
    expect(rankHiddenBadges({ fields: [] })).toEqual({ top: [], rest: [] });
  });
});
