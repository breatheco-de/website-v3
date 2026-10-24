import { describe, expect, it } from "vitest";
import {
  EXISTING_DEMAND_UNDECLARED,
  editsChecksBadge,
  filedIdeaDemand,
  ideaDemandBadge,
} from "./review-situation-summary";

describe("filedIdeaDemand", () => {
  it("keeps only staff-selectable demand labels", () => {
    expect(filedIdeaDemand(["idea_opportunity_harm", "broken_url"])).toEqual(["broken_url"]);
    expect(filedIdeaDemand(undefined)).toEqual([]);
  });
});

describe("ideaDemandBadge", () => {
  it("shows the filed demand label", () => {
    expect(ideaDemandBadge({ filed: ["anticipated_demand"] })).toEqual({
      label: "Demand: Anticipated demand",
      nudge: false,
    });
  });

  it("nudges when the server suspects an undeclared existing-demand pitch", () => {
    expect(
      ideaDemandBadge({ filed: [], warnings: [{ code: EXISTING_DEMAND_UNDECLARED }] }),
    ).toEqual({ label: "Looks like existing search demand — set label?", nudge: true });
  });

  it("a filed label wins over the nudge", () => {
    expect(
      ideaDemandBadge({
        filed: ["fast_decay_news"],
        warnings: [{ code: EXISTING_DEMAND_UNDECLARED }],
      }).nudge,
    ).toBe(false);
  });

  it("falls back to standard review and ignores the always-on default", () => {
    expect(ideaDemandBadge({ filed: ["idea_opportunity_harm"], warnings: [] })).toEqual({
      label: "Demand: standard review",
      nudge: false,
    });
  });
});

describe("editsChecksBadge", () => {
  it("lists filed checks", () => {
    expect(editsChecksBadge({ filed: ["internal_links"], live: ["body_copy_edit"] })).toEqual({
      label: "Checks: Hub / internal links",
      auto: false,
    });
  });

  it("marks inferred checks as auto", () => {
    expect(editsChecksBadge({ filed: [], live: ["body_copy_edit"] })).toEqual({
      label: "Checks: Body / field edit (auto)",
      auto: true,
    });
  });

  it("truncates after two labels", () => {
    expect(
      editsChecksBadge({
        filed: ["internal_links", "serp_title_description", "selling_figures"],
      }).label,
    ).toBe("Checks: Hub / internal links, Search title / description +1");
  });

  it("handles nothing filed or inferred", () => {
    expect(editsChecksBadge({ filed: null, live: null }).label).toBe("Checks: picked by review");
  });
});
