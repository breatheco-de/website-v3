import { describe, expect, it } from "vitest";
import { resolveConversionProduct } from "./resolveConversionProduct";

const lookup = (id: string) => {
  const map: Record<string, { product_id: string; active: boolean }> = {
    "ai-fluency": { product_id: "program-ai-fluency", active: true },
    "ai-flex": { product_id: "program-ai-flex", active: true },
  };
  if (map[id]) return map[id];
  for (const [slug, p] of Object.entries(map)) {
    if (p.product_id === id) return { ...p, /* content slug via caller */ };
  }
  // Allow lookup by product_id key in helper tests via slug iteration in resolve
  return undefined;
};

describe("resolveConversionProduct", () => {
  it("uses single funnel product when field empty", () => {
    const r = resolveConversionProduct({
      funnel: { stage: "decision", products: ["ai-fluency"] },
      fieldValue: "",
      productLookup: lookup,
    });
    expect(r.ok).toBe(true);
    expect(r.program_id).toBe("ai-fluency");
    expect(r.item_id).toBe("program-ai-fluency");
  });

  it("accepts user pick inside multi-product funnel", () => {
    const r = resolveConversionProduct({
      funnel: { stage: "consideration", products: ["ai-fluency", "ai-flex"] },
      fieldValue: "ai-flex",
      productLookup: lookup,
    });
    expect(r.ok).toBe(true);
    expect(r.item_id).toBe("program-ai-flex");
  });

  it("rejects pick outside funnel without inventing a product", () => {
    const r = resolveConversionProduct({
      funnel: { stage: "consideration", products: ["ai-fluency"] },
      fieldValue: "ai-flex",
      productLookup: lookup,
    });
    expect(r.ok).toBe(false);
    expect(r.reason).toBe("outside_funnel");
    expect(r.item_id).toBeUndefined();
  });

  it("inherits program page slug when no funnel", () => {
    const r = resolveConversionProduct({
      contentType: "program",
      contentSlug: "ai-fluency",
      fieldValue: "",
      productLookup: lookup,
    });
    expect(r.ok).toBe(true);
    expect(r.program_id).toBe("ai-fluency");
  });

  it("maps product_id field value back to funnel slug", () => {
    const r = resolveConversionProduct({
      funnel: { products: ["ai-fluency", "ai-flex"] },
      fieldValue: "program-ai-fluency",
      productLookup: (id) => {
        if (id === "ai-fluency") return { product_id: "program-ai-fluency", active: true };
        if (id === "ai-flex") return { product_id: "program-ai-flex", active: true };
        return undefined;
      },
    });
    expect(r.ok).toBe(true);
    expect(r.program_id).toBe("ai-fluency");
    expect(r.item_id).toBe("program-ai-fluency");
  });
});
