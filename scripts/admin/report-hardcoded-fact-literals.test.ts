import { describe, expect, it } from "vitest";
import {
  buildLiteralIndex,
  findLiterals,
  literalKinds,
  sameFactLiteral,
  valueSearchStrings,
} from "./report-hardcoded-fact-literals";

describe("literalKinds (re-export)", () => {
  it("recognises currency, phone, and percent values", () => {
    expect(literalKinds("$14,999")).toEqual([{ literal: "$14,999", kind: "currency" }]);
    expect(literalKinds("140 €")).toEqual([{ literal: "140 €", kind: "currency" }]);
    expect(literalKinds("+1 (786) 416-6640")).toEqual([{ literal: "+1 (786) 416-6640", kind: "phone" }]);
    expect(literalKinds("84%")).toEqual([{ literal: "84%", kind: "percent" }]);
  });
});

describe("valueSearchStrings / sameFactLiteral (re-export)", () => {
  it("expands structured money aliases", () => {
    const strings = valueSearchStrings({ amount: 999, currency: "USD", display: "$999" });
    expect(strings).toContain("$999");
    expect(strings).toContain("999 USD");
  });

  it("equates alternate currency spellings", () => {
    expect(sameFactLiteral("€140", "140€")).toBe(true);
    expect(sameFactLiteral("$999", "$1,999")).toBe(false);
  });
});

describe("findLiterals (re-export)", () => {
  const index = buildLiteralIndex({
    "global.price": { default: "$900", conditions: [{ query: { region: "europe" }, value: "€900" }] },
    "global.rate": { default: "84", unit: "percent" },
    "global.phone": { default: "+1 (786) 416-6640" },
    "global.greeting": { default: "Welcome", category: "copy" },
    "global.old": { default: "$1", deprecated: true },
  });

  it("indexes aliases and skips copy / deprecated", () => {
    expect(index.has("$900")).toBe(true);
    expect(index.has("€900")).toBe(true);
    expect(index.has("84%")).toBe(true);
    expect(index.has("900 USD")).toBe(true);
    expect(index.has("Welcome")).toBe(false);
    expect(index.has("$1")).toBe(false);
  });

  it("matches whole literals only and ignores tokens", () => {
    expect(findLiterals("Only $900 today, 84% hired", index).map((h) => h.literal).sort()).toEqual([
      "$900",
      "84%",
    ]);
    expect(findLiterals("Pay $9000 or 184% more", index)).toEqual([]);
    expect(findLiterals("Pay {{global.price}} now", index)).toEqual([]);
  });
});
