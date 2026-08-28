import { describe, expect, it } from "vitest";
import { parseLocationHashSectionId } from "./useScrollToLocationHashWhenReady";

describe("parseLocationHashSectionId", () => {
  it("strips leading #", () => {
    expect(parseLocationHashSectionId("#pricing-6svo9e")).toBe("pricing-6svo9e");
  });

  it("strips dirty query after hash id", () => {
    expect(parseLocationHashSectionId("#pricing-6svo9e?cohort=1713")).toBe("pricing-6svo9e");
  });

  it("returns empty for empty hash", () => {
    expect(parseLocationHashSectionId("")).toBe("");
    expect(parseLocationHashSectionId("#")).toBe("");
  });
});
