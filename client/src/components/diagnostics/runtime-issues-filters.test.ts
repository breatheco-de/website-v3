import { describe, expect, it } from "vitest";
import { incrementByHour, aggregateHitsByDay } from "@shared/runtime-issues";
import {
  FILTER_ALL,
  applyRuntimeIssueView,
  countActiveListFilters,
  countIngestionFilters,
  deviceLabel,
  filterRuntimeIssues,
  isAssetPath,
  paginateRuntimeIssues,
  sortDevices,
  type RuntimeIssueFilters,
} from "./runtime-issues-filters";

function row(
  overrides: Partial<{
    fingerprint: string;
    path: string;
    locale: string;
    sampleReferrer?: string;
    uaBucket?: string;
    sources?: string[];
    count: number;
    lastSeen: number;
    byHour?: ReturnType<typeof incrementByHour>;
    queryAttribution?: import("@shared/runtime-issues").RuntimeQueryAttribution;
  }> = {},
) {
  const lastSeen = overrides.lastSeen ?? Date.now();
  return {
    fingerprint: overrides.fingerprint ?? "fp",
    path: overrides.path ?? "/es/missing",
    locale: overrides.locale ?? "es",
    sampleReferrer: overrides.sampleReferrer,
    uaBucket: overrides.uaBucket,
    sources: overrides.sources,
    count: overrides.count ?? 1,
    lastSeen,
    byHour: overrides.byHour,
    queryAttribution: overrides.queryAttribution,
  };
}

const none: RuntimeIssueFilters = {
  pathQuery: "",
  referrerQuery: "",
  locale: FILTER_ALL,
  device: FILTER_ALL,
  pagesOnly: true,
  queryParamsOnly: false,
  windowDays: 30,
  tz: "UTC",
  source: FILTER_ALL,
};

describe("filterRuntimeIssues", () => {
  const issues = [
    row({
      fingerprint: "a",
      path: "/es/us/old-blog",
      locale: "es",
      sampleReferrer: "https://google.com/search",
      uaBucket: "mobile",
    }),
    row({
      fingerprint: "b",
      path: "/en/pricing",
      locale: "en",
      sampleReferrer: "https://4geeks.com/es",
      uaBucket: "desktop",
    }),
    row({ fingerprint: "c", path: "/en/missing-page", locale: "en", uaBucket: "unknown" }),
  ];

  it("returns all rows when filters are empty", () => {
    expect(filterRuntimeIssues(issues, none)).toHaveLength(3);
  });

  it("matches path by case-insensitive substring", () => {
    const filtered = filterRuntimeIssues(issues, { ...none, pathQuery: "PRICING" });
    expect(filtered.map((i) => i.fingerprint)).toEqual(["b"]);
  });

  it("matches referrer by case-insensitive substring", () => {
    const filtered = filterRuntimeIssues(issues, { ...none, referrerQuery: "google" });
    expect(filtered.map((i) => i.fingerprint)).toEqual(["a"]);
  });

  it("excludes rows with no referrer when a referrer query is set", () => {
    const filtered = filterRuntimeIssues(issues, { ...none, referrerQuery: "4geeks" });
    expect(filtered.map((i) => i.fingerprint)).toEqual(["b"]);
  });

  it("filters by locale", () => {
    const filtered = filterRuntimeIssues(issues, { ...none, locale: "en" });
    expect(filtered.map((i) => i.fingerprint)).toEqual(["b", "c"]);
  });

  it("filters by device, treating missing uaBucket as unknown", () => {
    const withMissingUa = [...issues, row({ fingerprint: "d", path: "/x", locale: "en" })];
    const filtered = filterRuntimeIssues(withMissingUa, { ...none, device: "unknown" });
    expect(filtered.map((i) => i.fingerprint)).toEqual(["c", "d"]);
  });

  it("applies filters together", () => {
    const filtered = filterRuntimeIssues(issues, {
      ...none,
      pathQuery: "/en",
      locale: "en",
      device: "desktop",
    });
    expect(filtered.map((i) => i.fingerprint)).toEqual(["b"]);
  });

  it("pagesOnly hides all asset paths including internal", () => {
    const mixed = [
      ...issues,
      row({ fingerprint: "js", path: "/assets/index-abc.js" }),
      row({ fingerprint: "img", path: "/og-image.png" }),
      row({ fingerprint: "gif", path: "/static/images/loader.gif", sources: ["internal"] }),
      row({ fingerprint: "page", path: "/en/ai-2.0" }),
    ];
    const filtered = filterRuntimeIssues(mixed, { ...none, pagesOnly: true });
    expect(filtered.map((i) => i.fingerprint)).toEqual(["a", "b", "c", "page"]);
  });

  it("windowDays 7 hides a path that only has hits 20 days ago", () => {
    const now = Date.UTC(2026, 7, 14, 12, 0, 0);
    const oldTs = Date.UTC(2026, 6, 25, 12, 0, 0);
    const recentTs = Date.UTC(2026, 7, 13, 12, 0, 0);
    const old = row({
      fingerprint: "old",
      path: "/en/coding-bootcamp/old",
      lastSeen: oldTs,
      byHour: incrementByHour(undefined, oldTs, ["human"]),
    });
    const recent = row({
      fingerprint: "new",
      path: "/en/coding-bootcamp/new",
      lastSeen: recentTs,
      byHour: incrementByHour(undefined, recentTs, ["human"]),
    });
    const filtered = filterRuntimeIssues([old, recent], {
      ...none,
      pathQuery: "coding-bootcamp",
      windowDays: 7,
      now,
    });
    expect(filtered.map((i) => i.fingerprint)).toEqual(["new"]);
  });

  it("queryParamsOnly keeps rows with recorded query attribution", () => {
    const mixed = [
      ...issues,
      row({
        fingerprint: "with-params",
        path: "/en/campaign",
        queryAttribution: { source: ["meta"], other: { gclid: ["abc"] } },
      }),
    ];
    expect(filterRuntimeIssues(mixed, { ...none, queryParamsOnly: true }).map((i) => i.fingerprint)).toEqual([
      "with-params",
    ]);
  });
});

describe("applyRuntimeIssueView", () => {
  it("filters then sorts so table and CSV share one pipeline", () => {
    const now = Date.now();
    const rows = [
      { fingerprint: "low", path: "/en/a", locale: "en", count: 1, lastSeen: now },
      { fingerprint: "high", path: "/en/b", locale: "en", count: 9, lastSeen: now },
      { fingerprint: "es", path: "/es/c", locale: "es", count: 50, lastSeen: now },
    ];
    const result = applyRuntimeIssueView(rows, { ...none, locale: "en" }, "count", "desc");
    expect(result.map((i) => i.fingerprint)).toEqual(["high", "low"]);
  });

  it("sets count to the window sum", () => {
    const now = Date.UTC(2026, 7, 14, 12, 0, 0);
    const oldTs = Date.UTC(2026, 6, 25, 12, 0, 0);
    const recentTs = Date.UTC(2026, 7, 13, 12, 0, 0);
    let byHour = incrementByHour(undefined, oldTs, ["human"]);
    byHour = incrementByHour(byHour, recentTs, ["human"]);
    const result = applyRuntimeIssueView(
      [row({ fingerprint: "mix", path: "/en/x", lastSeen: recentTs, count: 2, byHour })],
      { ...none, windowDays: 7, now },
      "count",
      "desc",
    );
    expect(result[0]?.count).toBe(1);
    expect(result[0]?.count30).toBe(2);
  });

  it("hit totals match aggregateHitsByDay of the same filtered set", () => {
    const now = Date.UTC(2026, 7, 14, 12, 0, 0);
    const recentTs = Date.UTC(2026, 7, 13, 12, 0, 0);
    let byHour = incrementByHour(undefined, recentTs, ["search_crawler", "human"]);
    byHour = incrementByHour(byHour, recentTs + 3_600_000, ["human"]);
    const issues = [
      row({ fingerprint: "a", path: "/en/a", lastSeen: recentTs, count: 2, byHour }),
      row({ fingerprint: "b", path: "/es/b", locale: "es", lastSeen: recentTs, count: 1 }),
    ];
    const filters = { ...none, windowDays: 7, now };
    const viewed = applyRuntimeIssueView(issues, filters, "count", "desc");
    const series = aggregateHitsByDay(filterRuntimeIssues(issues, filters), {
      windowDays: filters.windowDays,
      tz: filters.tz,
      now,
    });
    expect(series.reduce((sum, p) => sum + p.count, 0)).toBe(
      viewed.reduce((sum, issue) => sum + issue.count, 0),
    );
  });
});

describe("isAssetPath", () => {
  it("detects common static file extensions on the last segment", () => {
    expect(isAssetPath("/assets/app.js")).toBe(true);
    expect(isAssetPath("/hero.webp")).toBe(true);
    expect(isAssetPath("/chunk.js.map")).toBe(true);
    expect(isAssetPath("/en/blog/old-slug")).toBe(false);
    expect(isAssetPath("/en/ai-2.0")).toBe(false);
  });
});

describe("sortDevices", () => {
  it("orders known buckets desktop → mobile → unknown", () => {
    expect(sortDevices(["unknown", "desktop", "mobile", "search_crawler"])).toEqual([
      "desktop",
      "mobile",
      "unknown",
    ]);
  });
});

describe("deviceLabel", () => {
  it("humanizes known buckets", () => {
    expect(deviceLabel("likely_bot")).toBe("Likely bot");
    expect(deviceLabel("custom")).toBe("custom");
  });
});

describe("countActiveListFilters", () => {
  it("counts pagesOnly-off and a 7-day window as non-defaults", () => {
    expect(countActiveListFilters(none)).toBe(0);
    expect(countActiveListFilters({ ...none, pagesOnly: false })).toBe(1);
    expect(countActiveListFilters({ ...none, queryParamsOnly: true })).toBe(1);
    expect(countActiveListFilters({ ...none, windowDays: 7, pagesOnly: false })).toBe(2);
  });
});

describe("countIngestionFilters", () => {
  it("counts hide-scrapers-off only", () => {
    expect(countIngestionFilters(true)).toBe(0);
    expect(countIngestionFilters(false)).toBe(1);
  });
});

describe("paginateRuntimeIssues", () => {
  it("slices 50-sized pages and clamps past the end", () => {
    const items = Array.from({ length: 101 }, (_, i) => i);
    const p1 = paginateRuntimeIssues(items, 1);
    expect(p1.page).toBe(1);
    expect(p1.totalPages).toBe(3);
    expect(p1.totalItems).toBe(101);
    expect(p1.pageItems).toHaveLength(50);
    expect(p1.pageItems[0]).toBe(0);
    const p3 = paginateRuntimeIssues(items, 3);
    expect(p3.pageItems).toEqual([100]);
    const clamped = paginateRuntimeIssues(items, 99);
    expect(clamped.page).toBe(3);
    expect(clamped.pageItems).toEqual([100]);
  });

  it("returns one empty page for an empty list", () => {
    const p = paginateRuntimeIssues([], 4);
    expect(p.page).toBe(1);
    expect(p.totalPages).toBe(1);
    expect(p.pageItems).toEqual([]);
  });
});
