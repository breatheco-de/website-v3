import { describe, it, expect } from "vitest";
import {
  effectiveBindings,
  effectiveProducts,
  enrollmentIdsOutsideFunnel,
  funnelHasProductsWithoutStage,
  normalizeFunnelBlock,
  normalizeFunnelProducts,
  scopeIncludesProduct,
} from "./funnel";

describe("normalizeFunnelProducts", () => {
  it("coerces legacy string slugs to bindings", () => {
    expect(normalizeFunnelProducts(["full-stack", "ai-flex"])).toEqual([
      { product: "full-stack" },
      { product: "ai-flex" },
    ]);
  });

  it("keeps product+persona bindings and allows same product twice", () => {
    expect(
      normalizeFunnelProducts([
        { product: "full-stack", persona: "career-changer" },
        { product: "full-stack", persona: "manager" },
      ]),
    ).toEqual([
      { product: "full-stack", persona: "career-changer" },
      { product: "full-stack", persona: "manager" },
    ]);
  });

  it("dedupes identical product+persona pairs", () => {
    expect(
      normalizeFunnelProducts([
        { product: "a", persona: "p1" },
        { product: "a", persona: "p1" },
      ]),
    ).toEqual([{ product: "a", persona: "p1" }]);
  });
});

describe("effectiveProducts (1B)", () => {
  it("unions program slug with explicit list", () => {
    const funnel = normalizeFunnelBlock({ products: ["ai-flex"] });
    expect(effectiveProducts(funnel, { contentType: "program", contentSlug: "full-stack" })).toEqual([
      "ai-flex",
      "full-stack",
    ]);
  });

  it("returns self when program has no products key", () => {
    expect(effectiveProducts({}, { contentType: "program", contentSlug: "full-stack" })).toEqual([
      "full-stack",
    ]);
  });

  it("passes through non-program funnel products as slugs", () => {
    const funnel = normalizeFunnelBlock({
      products: [
        { product: "a", persona: "p1" },
        { product: "b" },
      ],
    });
    expect(effectiveProducts(funnel, { contentType: "landing", contentSlug: "x" })).toEqual([
      "a",
      "b",
    ]);
  });
});

describe("effectiveBindings", () => {
  it("preserves personas on program union", () => {
    const funnel = normalizeFunnelBlock({
      products: [{ product: "ai-flex", persona: "x" }],
    });
    expect(effectiveBindings(funnel, { contentType: "program", contentSlug: "full-stack" })).toEqual([
      { product: "ai-flex", persona: "x" },
      { product: "full-stack" },
    ]);
  });
});

describe("scopeIncludesProduct", () => {
  it("all includes any slug", () => {
    expect(scopeIncludesProduct("all", "anything")).toBe(true);
  });
});

describe("funnelHasProductsWithoutStage (3C)", () => {
  it("warns when products set without stage", () => {
    expect(funnelHasProductsWithoutStage({ products: [{ product: "x" }] })).toBe(true);
    expect(funnelHasProductsWithoutStage({ products: "all" })).toBe(true);
    expect(
      funnelHasProductsWithoutStage({ stage: "awareness", products: [{ product: "x" }] }),
    ).toBe(false);
  });
});

describe("enrollmentIdsOutsideFunnel (5B)", () => {
  it("flags card ids not in effective products", () => {
    const funnel = normalizeFunnelBlock({ products: ["a"] });
    expect(
      enrollmentIdsOutsideFunnel(["a", "b"], funnel, { contentType: "landing", contentSlug: "lp" }),
    ).toEqual(["b"]);
  });
});
