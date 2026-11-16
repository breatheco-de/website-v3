import { describe, expect, it } from "vitest";
import {
  effectiveVariableMetadata,
  isVariableSource,
  normalizeVariableProducts,
} from "./variable-metadata";

describe("normalizeVariableProducts", () => {
  it("dedupes and trims slug lists", () => {
    expect(normalizeVariableProducts([" ai-flex ", "full-stack", "ai-flex", ""])).toEqual([
      "ai-flex",
      "full-stack",
    ]);
  });

  it("returns undefined for empty / non-array", () => {
    expect(normalizeVariableProducts([])).toBeUndefined();
    expect(normalizeVariableProducts(null)).toBeUndefined();
    expect(normalizeVariableProducts("ai-flex")).toBeUndefined();
  });
});

describe("source helpers", () => {
  it("accepts internal and external only", () => {
    expect(isVariableSource("internal")).toBe(true);
    expect(isVariableSource("external")).toBe(true);
    expect(isVariableSource("own")).toBe(false);
    expect(isVariableSource("third_party")).toBe(false);
  });

  it("surfaces source and products on effective metadata", () => {
    const meta = effectiveVariableMetadata("global.rate", {
      description: "Hire rate",
      category: "outcome_claim",
      source: "internal",
      products: ["ai-flex"],
    });
    expect(meta).toMatchObject({
      source: "internal",
      products: ["ai-flex"],
      system_managed: false,
    });
  });
});
