import { describe, it, expect } from "vitest";
import {
  configuredCountrySet,
  normalizeGscCountryCode,
  parseOrganicMarkets,
  parseResearchMarketDefaults,
  resolveMarket,
  resolveResearchMarket,
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

  it("fills a default search language and keeps an explicit one", () => {
    const markets = parseOrganicMarkets([
      { id: "usa", label: "USA", countries: ["usa"] },
      { id: "usa-es", label: "USA (Spanish)", countries: ["usa"], language: "Spanish" },
      { id: "spain", label: "Spain", countries: ["esp"] },
    ]);
    expect(markets.find((m) => m.id === "usa")?.language).toBe("English");
    expect(markets.find((m) => m.id === "usa-es")?.language).toBe("Spanish");
    expect(markets.find((m) => m.id === "spain")?.language).toBe("Spanish");
  });
});

describe("research market defaults", () => {
  it("defaults to en→usa, es→spain and normalizes locale keys", () => {
    expect(parseResearchMarketDefaults(undefined)).toEqual({ en: "usa", es: "spain" });
    expect(parseResearchMarketDefaults({ "es-MX": "Mexico", en: "usa" })).toEqual({
      es: "mexico",
      en: "usa",
    });
  });
});

describe("resolveResearchMarket", () => {
  const fallback = { location: "United States", language: "English" };
  const defaults = { en: "usa", es: "spain" };

  it("uses an explicit country market", () => {
    const r = resolveResearchMarket({
      markets: DEFAULT_ORGANIC_MARKETS,
      defaults,
      marketId: "mexico",
      locale: "es",
      fallback,
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.market).toMatchObject({
        id: "mexico",
        location: "Mexico",
        language: "Spanish",
        source: "explicit",
      });
    }
  });

  it("uses the page-language default when no market is passed", () => {
    const r = resolveResearchMarket({
      markets: DEFAULT_ORGANIC_MARKETS,
      defaults,
      locale: "es",
      fallback,
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.market).toMatchObject({ id: "spain", location: "Spain", source: "locale_default" });
    }
  });

  it("refuses LatAm and Worldwide with country markets to use instead", () => {
    for (const id of ["latam", "worldwide"]) {
      const r = resolveResearchMarket({ markets: DEFAULT_ORGANIC_MARKETS, defaults, marketId: id, fallback });
      expect(r.ok).toBe(false);
      if (!r.ok) {
        expect(r.code).toBe("market_not_researchable");
        expect(r.country_markets).toContain("spain");
        expect(r.country_markets).not.toContain("latam");
      }
    }
  });

  it("refuses unknown market ids", () => {
    const r = resolveResearchMarket({ markets: DEFAULT_ORGANIC_MARKETS, defaults, marketId: "mars", fallback });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("unknown_market");
  });

  it("falls back to the legacy location/language when no default applies", () => {
    const r = resolveResearchMarket({ markets: DEFAULT_ORGANIC_MARKETS, defaults, locale: "fr", fallback });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.market).toMatchObject({ id: null, location: "United States", language: "English", source: "fallback" });
    }
  });

  it("falls back with a warning when the default points at a rollup", () => {
    const r = resolveResearchMarket({
      markets: DEFAULT_ORGANIC_MARKETS,
      defaults: { es: "latam" },
      locale: "es",
      fallback,
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.market.source).toBe("fallback");
      expect(r.warning).toMatch(/latam/);
    }
  });
});
