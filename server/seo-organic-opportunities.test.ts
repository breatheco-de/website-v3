import { describe, it, expect } from "vitest";
import {
  classifyCannibalization,
  classifyDecay,
  classifyLowCtr,
  classifyMissingSerp,
  classifyPage2,
  enrichCmsActivity,
  enrichCmsKnown,
  entryKeyFromResolvedUrl,
  gscUrlToPath,
  type AggregatedGscRow,
} from "./seo-organic-opportunities";
import { SERP_TTL_MS, serpEntryFresh, type OpenRushSerpEntry } from "./openrush-serp-cache";
import { parseInspectSerpData } from "./openrush-client";

function agg(partial: Partial<AggregatedGscRow> & { query: string; url: string }): AggregatedGscRow {
  return {
    clicks: 0,
    impressions: 200,
    position: 12,
    ctr: 0.02,
    ...partial,
  };
}

describe("cms_known enrichment", () => {
  it("gscUrlToPath strips host", () => {
    expect(gscUrlToPath("https://4geeks.com/en/blog/x")).toBe("/en/blog/x");
    expect(gscUrlToPath("/en/location/berlin-germany")).toBe("/en/location/berlin-germany");
  });

  it("enrichCmsKnown sets flag from isKnownUrl", () => {
    const known = new Set(["/a"]);
    const out = enrichCmsKnown(
      [agg({ query: "q", url: "https://example.com/a" }), agg({ query: "q", url: "https://example.com/b" })],
      (path) => known.has(path),
    );
    expect(out.map((r) => r.cms_known)).toEqual([true, false]);
  });

  it("entryKeyFromResolvedUrl maps default locale to en", () => {
    expect(
      entryKeyFromResolvedUrl({ contentType: "blog", slug: "hello", patternLocale: "default" }),
    ).toBe("blog/hello/en");
    expect(
      entryKeyFromResolvedUrl({ contentType: "page", slug: "home", patternLocale: "es" }),
    ).toBe("page/home/es");
  });

  it("enrichCmsActivity adds entry_key and write_count for known URLs", () => {
    const counts = new Map([["blog/hello/en", 3]]);
    const out = enrichCmsActivity(
      [
        agg({ query: "q", url: "https://example.com/en/blog/hello" }),
        agg({ query: "q", url: "https://example.com/unknown" }),
      ],
      {
        isKnownUrl: (path) => path === "/en/blog/hello",
        resolveUrl: (path) =>
          path === "/en/blog/hello"
            ? { contentType: "blog", slug: "hello", patternLocale: "en" }
            : null,
        writeCounts: counts,
      },
    );
    expect(out[0]).toMatchObject({
      cms_known: true,
      entry_key: "blog/hello/en",
      write_count: 3,
    });
    expect(out[1]).toMatchObject({
      cms_known: false,
      entry_key: null,
      write_count: 0,
    });
  });

  it("enrichCmsActivity leaves entry_key null when resolve fails on known URL", () => {
    const out = enrichCmsActivity([agg({ query: "q", url: "/known" })], {
      isKnownUrl: () => true,
      resolveUrl: () => null,
      writeCounts: new Map(),
    });
    expect(out[0]).toMatchObject({ cms_known: true, entry_key: null, write_count: 0 });
  });
});

describe("organic classifiers", () => {
  it("page 2 keeps 11–20 and sorts by impressions", () => {
    const out = classifyPage2([
      agg({ query: "a", url: "/a", position: 12, impressions: 10 }),
      agg({ query: "b", url: "/b", position: 5, impressions: 999 }),
      agg({ query: "c", url: "/c", position: 18, impressions: 50 }),
    ]);
    expect(out.map((r) => r.query)).toEqual(["c", "a"]);
  });

  it("low CTR flags when CTR is under half the expected curve", () => {
    const out = classifyLowCtr([
      agg({ query: "weak", url: "/w", position: 1, impressions: 200, ctr: 0.01, clicks: 2 }),
      agg({ query: "ok", url: "/o", position: 1, impressions: 200, ctr: 0.2, clicks: 40 }),
    ]);
    expect(out.map((r) => r.query)).toEqual(["weak"]);
  });

  it("cannibalization requires two URLs for one query", () => {
    const out = classifyCannibalization([
      agg({ query: "shared", url: "/one", impressions: 80 }),
      agg({ query: "shared", url: "/two", impressions: 40 }),
      agg({ query: "solo", url: "/solo", impressions: 90 }),
    ]);
    expect(out).toHaveLength(1);
    expect(out[0]!.urls).toHaveLength(2);
  });

  it("decay only includes URLs present in both windows", () => {
    const out = classifyDecay(
      [
        agg({ query: "q", url: "/keep", clicks: 1, impressions: 10 }),
        agg({ query: "q", url: "/new", clicks: 5, impressions: 10 }),
      ],
      [
        agg({ query: "q", url: "/keep", clicks: 20, impressions: 40 }),
        agg({ query: "q", url: "/gone", clicks: 9, impressions: 9 }),
      ],
    );
    expect(out.map((r) => r.url)).toEqual(["/keep"]);
    expect(out[0]!.click_drop).toBeGreaterThan(0);
  });

  it("missing SERP marks visible_in_serp from organic list", () => {
    const entry: OpenRushSerpEntry = {
      query: "q",
      fetched_at: new Date().toISOString(),
      organic: [{ url: "https://other.com/x", rank: 1 }],
      featured_snippet_url: "https://other.com/x",
      has_paa: true,
      our_serp_rank: null,
      visible_in_serp: false,
    };
    const out = classifyMissingSerp(
      [agg({ query: "q", url: "https://example.com/ours", position: 3, impressions: 100 })],
      { q: entry },
    );
    expect(out).toHaveLength(1);
    expect(out[0]!.visible_in_serp).toBe(false);
    expect(out[0]!.serp_fetched).toBe(true);
  });
});

describe("OpenRush per-entry TTL", () => {
  it("is fresh within 7 days and stale after", () => {
    const now = Date.parse("2026-09-01T00:00:00.000Z");
    const fresh: OpenRushSerpEntry = {
      query: "q",
      fetched_at: new Date(now - SERP_TTL_MS + 60_000).toISOString(),
      organic: [],
      featured_snippet_url: null,
      has_paa: false,
      our_serp_rank: null,
      visible_in_serp: null,
    };
    const stale: OpenRushSerpEntry = {
      ...fresh,
      fetched_at: new Date(now - SERP_TTL_MS - 60_000).toISOString(),
    };
    expect(serpEntryFresh(fresh, now)).toBe(true);
    expect(serpEntryFresh(stale, now)).toBe(false);
  });
});

describe("parseInspectSerpData", () => {
  it("reads organic urls, snippet, and PAA", () => {
    const parsed = parseInspectSerpData({
      organic: [{ url: "https://example.com/a", rank: 2 }, { link: "https://example.com/b" }],
      featured_snippet: { url: "https://example.com/a" },
      people_also_ask: [{ question: "what" }],
    });
    expect(parsed.organic).toEqual([
      { url: "https://example.com/a", rank: 2 },
      { url: "https://example.com/b", rank: 2 },
    ]);
    expect(parsed.featured_snippet_url).toBe("https://example.com/a");
    expect(parsed.has_paa).toBe(true);
  });
});
