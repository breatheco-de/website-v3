import { describe, expect, it } from "vitest";
import {
  applyFunnelFieldUpdates,
  mergeFunnelPatch,
  coerceFunnelInput,
} from "./funnel-fields";

describe("mergeFunnelPatch", () => {
  it("preserves products when only stage is touched", () => {
    const result = mergeFunnelPatch(
      { stage: "awareness", products: [{ product: "ai-fluency", persona: "career" }] },
      { touchStage: true, stage: "decision" },
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.coerced.stage).toBe("decision");
    expect(result.coerced.products).toEqual([{ product: "ai-fluency", persona: "career" }]);
  });

  it("preserves stage when only products are touched", () => {
    const result = mergeFunnelPatch(
      { stage: "consideration", products: "all" },
      { touchProducts: true, products: [{ product: "full-stack" }] },
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.coerced.stage).toBe("consideration");
    expect(result.coerced.products).toEqual([{ product: "full-stack" }]);
  });

  it("clears products when touchProducts + null", () => {
    const result = mergeFunnelPatch(
      { stage: "decision", products: "all" },
      { touchProducts: true, products: null },
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.coerced.stage).toBe("decision");
    expect(result.coerced.products).toBeUndefined();
  });

  it("clears stage when touchStage + null", () => {
    const result = mergeFunnelPatch(
      { stage: "decision", products: "all" },
      { touchStage: true, stage: null },
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.coerced.stage).toBeUndefined();
    expect(result.coerced.products).toBe("all");
    expect(result.warnings.some((w) => w.code === "products_without_stage")).toBe(true);
  });

  it("rejects invalid stage", () => {
    const result = mergeFunnelPatch({}, { touchStage: true, stage: "nope" });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe("invalid_stage");
  });
});

describe("applyFunnelFieldUpdates", () => {
  it("resets funnel.products only", () => {
    const result = applyFunnelFieldUpdates(
      { stage: "awareness", products: [{ product: "x" }] },
      [{ field_path: "funnel.products", reset: true }],
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.coerced).toEqual({ stage: "awareness" });
  });

  it("sets funnel.stage via field path", () => {
    const result = applyFunnelFieldUpdates(
      { products: "all" },
      [{ field_path: "funnel.stage", value: "consideration" }],
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.coerced.stage).toBe("consideration");
    expect(result.coerced.products).toBe("all");
  });
});

describe("coerceFunnelInput", () => {
  it("treats omitted products as untouched on empty current (full replace from empty)", () => {
    const result = coerceFunnelInput({ stage: "awareness" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.coerced).toEqual({ stage: "awareness" });
  });
});
