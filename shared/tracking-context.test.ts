import { describe, expect, it } from "vitest";
import {
  buildFunnelTrackingContext,
  decodeTrackingCodes,
  joinCapped,
  measureFunnelTrackingLength,
  resolveFormTrackingContext,
} from "./tracking-context";
import type { TrackingKeyIndex } from "./tracking-keys";

const index: TrackingKeyIndex = {
  products: [
    {
      slug: "ai-engineering",
      content_type: "program",
      product_id: "program-ai-engineering",
      name: "AI Engineering",
      key: "aie",
      active: true,
      personas: [
        { id: "the-career-changer", name: "The Career Changer", key: "cc" },
        { id: "the-developer", name: "The Developer", key: "dev" },
      ],
      retired: [{ key: "old", type: "persona", id: "gone", name: "Gone", retired_at: "" }],
    },
    {
      slug: "ai-flex",
      content_type: "program",
      product_id: "program-ai-flex",
      name: "AI Flex",
      key: "afx",
      active: true,
      personas: [
        { id: "the-explorer", name: "The Explorer", key: "exp" },
        { id: "the-developer", name: "The Developer (Flex)" },
      ],
      retired: [],
    },
  ],
};

const page = { contentType: "landing", contentSlug: "apply" };

describe("buildFunnelTrackingContext", () => {
  it("sends codes for bound products and personas", () => {
    const ctx = buildFunnelTrackingContext(
      {
        stage: "decision",
        products: [
          { product: "ai-engineering", persona: "the-career-changer" },
          { product: "ai-flex", persona: "the-explorer" },
        ],
      },
      page,
      index,
    );
    expect(ctx).toEqual({
      funnel_stage: "decision",
      content_key: "landing:apply",
      product: "aie,afx",
      persona: "cc,exp",
      product_persona: "aie:cc,afx:exp",
    });
  });

  it("sends full ids in ids mode and falls back to the id when a key is missing", () => {
    const funnel = { products: [{ product: "ai-flex", persona: "the-developer" }] };
    expect(buildFunnelTrackingContext(funnel, page, index).persona).toBe("the-developer");
    expect(buildFunnelTrackingContext(funnel, page, index, { mode: "ids" })).toMatchObject({
      product: "ai-flex",
      persona: "the-developer",
      product_persona: "ai-flex:the-developer",
    });
  });

  it("uses all / none sentinels", () => {
    expect(buildFunnelTrackingContext({ products: "all" }, page, index)).toMatchObject({ product: "all", persona: "all" });
    expect(buildFunnelTrackingContext(null, page, index)).toMatchObject({
      product: "none",
      persona: "none",
      content_key: "landing:apply",
    });
  });

  it("includes the program itself on its own page", () => {
    const ctx = buildFunnelTrackingContext({}, { contentType: "program", contentSlug: "ai-engineering" }, index);
    expect(ctx.product).toBe("aie");
    expect(ctx.product_persona).toBe("aie:");
  });

  it("cuts at a whole value and flags truncation", () => {
    expect(joinCapped(["aaaa", "bbbb", "cccc"], 9)).toEqual({ value: "aaaa,bbbb", truncated: true });
    const many = Array.from({ length: 30 }, (_, i) => ({ product: `product-number-${i}` }));
    const ctx = buildFunnelTrackingContext({ products: many }, page, index);
    expect(ctx.tracking_truncated).toBe(true);
    expect(ctx.product!.length).toBeLessThanOrEqual(100);
    expect(ctx.product!.endsWith(",")).toBe(false);
  });
});

describe("resolveFormTrackingContext", () => {
  const funnel = {
    products: [
      { product: "ai-engineering", persona: "the-career-changer" },
      { product: "ai-flex", persona: "the-explorer" },
    ],
  };

  it("returns the page context without an override", () => {
    expect(resolveFormTrackingContext(funnel, page, index, {})).toEqual(buildFunnelTrackingContext(funnel, page, index));
  });

  it("product override keeps only the personas the funnel binds to that product", () => {
    const ctx = resolveFormTrackingContext(funnel, page, index, { product: "ai-flex" });
    expect(ctx).toMatchObject({ product: "afx", persona: "exp", product_persona: "afx:exp" });
    expect(resolveFormTrackingContext(funnel, page, index, { product: "ai-flex" }, { mode: "ids" })).toMatchObject({
      product: "ai-flex",
      persona: "the-explorer",
    });
  });

  it("accepts short codes as overrides", () => {
    expect(resolveFormTrackingContext(funnel, page, index, { product: "aie" })).toMatchObject({
      product: "aie",
      persona: "cc",
    });
  });

  it("product override on a page without a funnel sends persona none", () => {
    expect(resolveFormTrackingContext(null, page, index, { product: "ai-flex" })).toMatchObject({
      product: "afx",
      persona: "none",
    });
  });

  it("product override on an all page sends no persona", () => {
    const ctx = resolveFormTrackingContext({ products: "all" }, page, index, { product: "ai-flex" });
    expect(ctx.product).toBe("afx");
    expect(ctx.persona).toBeUndefined();
  });

  it("sends unknown overrides as written", () => {
    expect(resolveFormTrackingContext(funnel, page, index, { product: "full-stak" })).toMatchObject({
      product: "full-stak",
    });
  });

  it("persona override keeps the page products", () => {
    const ctx = resolveFormTrackingContext(funnel, page, index, { persona: "the-developer" });
    expect(ctx).toMatchObject({ product: "aie,afx", persona: "dev", product_persona: "aie:dev" });
  });

  it("product and persona override together", () => {
    const ctx = resolveFormTrackingContext(funnel, page, index, { product: "ai-engineering", persona: "dev" });
    expect(ctx).toMatchObject({ product: "aie", persona: "dev", product_persona: "aie:dev" });
  });
});

describe("measure and decode", () => {
  it("reports uncut lengths", () => {
    const report = measureFunnelTrackingLength(
      { products: [{ product: "ai-engineering", persona: "the-career-changer" }] },
      page,
      index,
    );
    expect(report).toEqual({ product: 3, persona: 2, product_persona: 6, max: 100, over: false });
  });

  it("decodes current, full-id, retired and unknown codes", () => {
    expect(decodeTrackingCodes("cc,the-explorer,old,zzz,none", index, "persona")).toEqual([
      { code: "cc", status: "current", id: "the-career-changer", name: "The Career Changer", product: "ai-engineering" },
      { code: "the-explorer", status: "full_id", id: "the-explorer", name: "The Explorer", product: "ai-flex" },
      { code: "old", status: "retired", id: "gone", name: "Gone", product: "ai-engineering" },
      { code: "zzz", status: "unknown" },
      { code: "none", status: "sentinel" },
    ]);
  });
});
