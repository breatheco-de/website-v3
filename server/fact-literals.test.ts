import { describe, expect, it } from "vitest";
import {
  buildLiteralIndex,
  findLiterals,
  isSellingFunnelStage,
  literalKinds,
  pageProductSlugsFromFunnel,
  rankVariablesByProduct,
} from "./fact-literals";

describe("literalKinds", () => {
  it("recognises currency, phone, and percent values", () => {
    expect(literalKinds("$14,999")).toEqual([{ literal: "$14,999", kind: "currency" }]);
    expect(literalKinds("140 €")).toEqual([{ literal: "140 €", kind: "currency" }]);
    expect(literalKinds("+1 (786) 416-6640")).toEqual([{ literal: "+1 (786) 416-6640", kind: "phone" }]);
    expect(literalKinds("84%")).toEqual([{ literal: "84%", kind: "percent" }]);
  });

  it("bare numbers are percents only for unit percent or rate-like names", () => {
    expect(literalKinds("84", undefined, "global.global_job_placement_rate")).toEqual([
      { literal: "84%", kind: "percent" },
    ]);
    expect(literalKinds("10", undefined, "global.global_campuses")).toEqual([]);
    expect(literalKinds("10", "count", "global.hire_rate")).toEqual([]);
    expect(literalKinds("55", "percent", "global.x")).toEqual([{ literal: "55%", kind: "percent" }]);
    expect(literalKinds("Apply now")).toEqual([]);
  });
});

describe("findLiterals", () => {
  const index = buildLiteralIndex({
    "global.price": { default: "$900", conditions: [{ query: { region: "europe" }, value: "€900" }] },
    "global.rate": { default: "84", unit: "percent" },
    "global.phone": { default: "+1 (786) 416-6640" },
    "global.greeting": { default: "Welcome", category: "copy" },
    "global.old": { default: "$1", deprecated: true },
    "global.money": {
      default: { amount: 10999, currency: "USD", display: "$10,999" },
      category: "price",
    },
  });

  it("indexes every conditional value and skips copy / deprecated", () => {
    expect([...index.keys()].sort()).toEqual(
      ["$10,999", "$900", "+1 (786) 416-6640", "84%", "€900"].sort(),
    );
  });

  it("matches whole literals only and ignores tokens", () => {
    expect(findLiterals("Only $900 today, 84% hired", index).map((h) => h.literal).sort()).toEqual([
      "$900",
      "84%",
    ]);
    expect(findLiterals("Pay $9000 or 184% more", index)).toEqual([]);
    expect(findLiterals("Pay {{global.price}} now", index)).toEqual([]);
    expect(findLiterals("Call +1 (786) 416-6640", index).map((h) => h.literal)).toEqual([
      "+1 (786) 416-6640",
    ]);
  });
});

describe("rankVariablesByProduct", () => {
  const defs = {
    "global.price_fullstack": { products: ["full-stack"] },
    "global.price_cyber": { products: ["cybersecurity"] },
    "global.hire_rate": {},
  };

  it("prefers product-matched variables, then site-wide", () => {
    expect(
      rankVariablesByProduct(
        ["global.price_cyber", "global.hire_rate", "global.price_fullstack"],
        defs,
        ["full-stack"],
      ),
    ).toEqual(["global.price_fullstack", "global.hire_rate", "global.price_cyber"]);
  });
});

describe("funnel helpers", () => {
  it("detects selling stages", () => {
    expect(isSellingFunnelStage("decision")).toBe(true);
    expect(isSellingFunnelStage("consideration")).toBe(true);
    expect(isSellingFunnelStage("awareness")).toBe(false);
    expect(isSellingFunnelStage(null)).toBe(false);
  });

  it("reads product slugs from funnel bindings", () => {
    expect(
      pageProductSlugsFromFunnel({
        stage: "decision",
        products: ["full-stack", { product: "ai-engineering", persona: "career" }],
      }),
    ).toEqual(["full-stack", "ai-engineering"]);
    expect(pageProductSlugsFromFunnel({ products: "all" })).toEqual([]);
  });
});
