import { describe, expect, it } from "vitest";
import {
  buildFunnelTrackingContext,
  decodeTrackingCodes,
  decodeTrackingPairs,
  joinCapped,
  measureFunnelTrackingLength,
  parseTrackingList,
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
      product: "afx,aie",
      persona: "cc,exp",
      product_persona: "afx:exp,aie:cc",
    });
  });

  it("gives the same values whatever the funnel order", () => {
    const a = buildFunnelTrackingContext(
      {
        products: [
          { product: "ai-engineering", persona: "the-career-changer" },
          { product: "ai-flex", persona: "the-explorer" },
        ],
      },
      page,
      index,
    );
    const b = buildFunnelTrackingContext(
      {
        products: [
          { product: "ai-flex", persona: "the-explorer" },
          { product: "ai-engineering", persona: "the-career-changer" },
        ],
      },
      page,
      index,
    );
    expect(b).toEqual(a);
  });

  it("sorts full ids in ids mode", () => {
    const ctx = buildFunnelTrackingContext(
      {
        products: [
          { product: "ai-flex", persona: "the-explorer" },
          { product: "ai-engineering", persona: "the-career-changer" },
        ],
      },
      page,
      index,
      { mode: "ids" },
    );
    expect(ctx).toMatchObject({
      product: "ai-engineering,ai-flex",
      persona: "the-career-changer,the-explorer",
      product_persona: "ai-engineering:the-career-changer,ai-flex:the-explorer",
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
    expect(joinCapped(["aaaa", "bbbb", "cccc"], 9)).toEqual({ value: "aaaa,bbbb", truncated: true, kept: ["aaaa", "bbbb"] });
    const many = Array.from({ length: 30 }, (_, i) => ({ product: `product-number-${i}` }));
    const ctx = buildFunnelTrackingContext({ products: many }, page, index);
    expect(ctx.tracking_truncated).toBe(true);
    expect(ctx.product!.length).toBeLessThanOrEqual(100);
    expect(ctx.product!.endsWith(",")).toBe(false);
  });

  it("cuts in page order, then sorts the kept values", () => {
    expect(joinCapped(["zz", "aa", "mm"], 5)).toEqual({ value: "zz,aa", truncated: true, kept: ["zz", "aa"] });
    const many = Array.from({ length: 30 }, (_, i) => ({ product: `product-number-${String(29 - i).padStart(2, "0")}` }));
    const ctx = buildFunnelTrackingContext({ products: many }, page, index);
    const kept = ctx.product!.split(",");
    expect(ctx.tracking_truncated).toBe(true);
    expect(kept[0]).not.toBe("product-number-00");
    expect(kept).toContain("product-number-29");
    expect(kept).toEqual(kept.slice().sort());
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
    expect(ctx).toMatchObject({ product: "afx,aie", persona: "dev", product_persona: "aie:dev" });
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

  it("does not guess the product of a persona id several products use", () => {
    expect(decodeTrackingCodes("the-developer", index, "persona")).toEqual([
      { code: "the-developer", status: "full_id", id: "the-developer", name: "The Developer" },
    ]);
  });

  it("parses lists and sentinels", () => {
    expect(parseTrackingList(" aie , afx,,")).toEqual({ values: ["aie", "afx"], sentinel: null });
    expect(parseTrackingList("all")).toEqual({ values: [], sentinel: "all" });
    expect(parseTrackingList("none")).toEqual({ values: [], sentinel: "none" });
    expect(parseTrackingList(null)).toEqual({ values: [], sentinel: null });
  });

  it("decodes pairs, resolving the persona within its product", () => {
    const pairs = decodeTrackingPairs("ai-flex:the-developer,aie:cc,afx:,:mystery,all", index);
    expect(pairs[0]).toEqual({
      product: { code: "ai-flex", status: "full_id", id: "ai-flex", name: "AI Flex", product: "ai-flex" },
      persona: { code: "the-developer", status: "full_id", id: "the-developer", name: "The Developer (Flex)", product: "ai-flex" },
    });
    expect(pairs[1].product?.id).toBe("ai-engineering");
    expect(pairs[1].persona).toMatchObject({ status: "current", id: "the-career-changer", product: "ai-engineering" });
    expect(pairs[2]).toMatchObject({ product: { id: "ai-flex" }, persona: null });
    expect(pairs[3]).toEqual({ product: null, persona: { code: "mystery", status: "unknown" } });
    expect(pairs[4]).toEqual({ product: { code: "all", status: "sentinel" }, persona: null });
  });
});
