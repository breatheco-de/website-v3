import { describe, it, expect } from "vitest";
import {
  configuredCountrySet,
  normalizeGscCountryCode,
  parseOrganicMarkets,
  resolveMarket,
  rowMatchesMarket,
  DEFAULT_ORGANIC_MARKETS,
} from "./gsc-organic-markets";

describe("gsc-organic-markets", () => {
  it("normalizes alpha-2 and alpha-3 country codes", () => {
    expect(normalizeGscCountryCode("US")).toBe("usa");
    expect(normalizeGscCountryCode("esp")).toBe("esp");
    expect(normalizeGscCountryCode("")).toBeNull();
    expect(normalizeGscCountryCode("x")).toBeNull();
  });

  it("parses defaults when raw missing", () => {
    const markets = parseOrganicMarkets(undefined);
    expect(markets.some((m) => m.id === "worldwide")).toBe(true);
    expect(markets.find((m) => m.id === "usa")?.countries).toEqual(["usa"]);
    expect(markets.find((m) => m.id === "latam")?.kind).toBe("rollup");
  });

  it("maps US to usa in countries lists", () => {
    const markets = parseOrganicMarkets([
      { id: "worldwide", label: "Worldwide", countries: [] },
      { id: "usa", label: "USA", countries: ["US", "can"] },
    ]);
    expect(markets.find((m) => m.id === "usa")?.countries).toEqual(["usa", "can"]);
  });

  it("resolveMarket falls back to worldwide with warning", () => {
    const { market, warning } = resolveMarket(DEFAULT_ORGANIC_MARKETS, "nope");
    expect(market.id).toBe("worldwide");
    expect(warning).toMatch(/Unknown market/);
  });

  it("rowMatchesMarket excludes blank country from named markets", () => {
    const spain = DEFAULT_ORGANIC_MARKETS.find((m) => m.id === "spain")!;
    expect(rowMatchesMarket("", spain)).toBe(false);
    expect(rowMatchesMarket("esp", spain)).toBe(true);
    expect(rowMatchesMarket("esp", DEFAULT_ORGANIC_MARKETS[0]!)).toBe(true);
  });

  it("configuredCountrySet unions non-worldwide codes", () => {
    const set = configuredCountrySet(DEFAULT_ORGANIC_MARKETS);
    expect(set.has("usa")).toBe(true);
    expect(set.has("mex")).toBe(true);
    expect(set.has("esp")).toBe(true);
  });
});
