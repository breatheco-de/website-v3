import { describe, it, expect } from "vitest";
import {
  classifyOtherHighTraffic,
  clusteredPathsFromSeoIndex,
  passesOtherTrafficMinBar,
  OTHER_TRAFFIC_ROW_LIMIT,
} from "./gsc-organic-other-traffic";
import type { SeoIndex } from "./seo-index";
import type { AggregatedGscRow } from "./seo-organic-opportunities";

function agg(partial: Partial<AggregatedGscRow> & { query: string; url: string }): AggregatedGscRow {
  return {
    clicks: 2,
    impressions: 20,
    position: 8,
    ctr: 0.1,
    ...partial,
  };
}

function emptyIndex(partial: Partial<SeoIndex> = {}): SeoIndex {
  return {
    version: 1,
    generated_at: new Date().toISOString(),
    entries: {},
    by_path: {},
    clusters: {},
    orphans: [],
    warnings: [],
    ...partial,
  };
}

describe("clusteredPathsFromSeoIndex", () => {
  it("includes hub path and member paths", () => {
    const index = emptyIndex({
      entries: {
        "landing/hub/en": {
          content_type: "landing",
          slug: "hub",
          locale: "en",
          file: "x",
          path: "/en/hub",
          main_keyword: null,
          kw_monthly_volume: null,
          kw_difficulty: null,
          is_pillar: true,
          pillar_path: "/en/hub",
          pillar_live: true,
        },
        "landing/spoke/en": {
          content_type: "landing",
          slug: "spoke",
          locale: "en",
          file: "y",
          path: "/en/spoke",
          main_keyword: null,
          kw_monthly_volume: null,
          kw_difficulty: null,
          is_pillar: false,
          pillar_path: "/en/hub",
          pillar_live: true,
        },
      },
      clusters: {
        "landing/hub/en": {
          path: "/en/hub",
          members: ["landing/spoke/en"],
        },
      },
    });
    const paths = clusteredPathsFromSeoIndex(index);
    expect(paths.has("/en/hub")).toBe(true);
    expect(paths.has("/en/spoke")).toBe(true);
  });
});

describe("passesOtherTrafficMinBar", () => {
  it("keeps clicks >= 1 even with low impressions", () => {
    expect(passesOtherTrafficMinBar({ clicks: 1, impressions: 0 })).toBe(true);
  });

  it("keeps impressions >= 5 with zero clicks", () => {
    expect(passesOtherTrafficMinBar({ clicks: 0, impressions: 5 })).toBe(true);
  });

  it("drops zero-click low-impression noise", () => {
    expect(passesOtherTrafficMinBar({ clicks: 0, impressions: 4 })).toBe(false);
  });
});

describe("classifyOtherHighTraffic", () => {
  const known = new Set(["/en/hub", "/en/spoke", "/en/orphan", "/en/opted-out"]);
  const clustered = new Set(["/en/hub", "/en/spoke"]);
  const isKnownUrl = (path: string) => known.has(path);

  it("puts unknown CMS URLs in unknown", () => {
    const out = classifyOtherHighTraffic(
      [agg({ query: "legacy", url: "https://4geeks.com/old-page", clicks: 5, impressions: 50 })],
      { isKnownUrl, clusteredPaths: clustered },
    );
    expect(out.unknown.map((r) => r.query)).toEqual(["legacy"]);
    expect(out.known).toHaveLength(0);
  });

  it("excludes hub and spoke from known", () => {
    const out = classifyOtherHighTraffic(
      [
        agg({ query: "hub q", url: "https://4geeks.com/en/hub", clicks: 10 }),
        agg({ query: "spoke q", url: "https://4geeks.com/en/spoke", clicks: 8 }),
      ],
      { isKnownUrl, clusteredPaths: clustered },
    );
    expect(out.known).toHaveLength(0);
    expect(out.unknown).toHaveLength(0);
  });

  it("includes opted-out and unclustered known pages", () => {
    const out = classifyOtherHighTraffic(
      [
        agg({ query: "opt", url: "https://4geeks.com/en/opted-out", clicks: 3 }),
        agg({ query: "orphan", url: "https://4geeks.com/en/orphan", clicks: 7 }),
      ],
      { isKnownUrl, clusteredPaths: clustered },
    );
    expect(out.known.map((r) => r.query).sort()).toEqual(["opt", "orphan"]);
  });

  it("drops rows below min bar", () => {
    const out = classifyOtherHighTraffic(
      [agg({ query: "noise", url: "https://4geeks.com/en/orphan", clicks: 0, impressions: 2 })],
      { isKnownUrl, clusteredPaths: clustered },
    );
    expect(out.known).toHaveLength(0);
  });

  it("sorts by clicks then impressions and caps", () => {
    const rows = Array.from({ length: OTHER_TRAFFIC_ROW_LIMIT + 5 }, (_, i) =>
      agg({
        query: `q${i}`,
        url: `https://4geeks.com/en/orphan?i=${i}`,
        clicks: i,
        impressions: 100 - i,
      }),
    );
    // Same path for known classification — use distinct paths under known set
    const knownWide = new Set(rows.map((_, i) => `/p${i}`));
    const rowsKnown = rows.map((r, i) =>
      agg({ ...r, url: `https://4geeks.com/p${i}`, query: `q${i}`, clicks: i, impressions: 100 - i }),
    );
    const out = classifyOtherHighTraffic(rowsKnown, {
      isKnownUrl: (p) => knownWide.has(p),
      clusteredPaths: new Set(),
      limit: OTHER_TRAFFIC_ROW_LIMIT,
    });
    expect(out.known).toHaveLength(OTHER_TRAFFIC_ROW_LIMIT);
    expect(out.known[0]!.clicks).toBe(OTHER_TRAFFIC_ROW_LIMIT + 4);
    expect(out.known[OTHER_TRAFFIC_ROW_LIMIT - 1]!.clicks).toBe(5);
  });
});
