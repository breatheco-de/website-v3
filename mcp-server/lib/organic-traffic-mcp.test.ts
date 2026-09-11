import { describe, expect, it } from "vitest";
import {
  clampOpportunitiesLimit,
  clampOpportunitiesOffset,
  dedupeStrings,
  flattenOpportunityCards,
  normalizePathBatch,
  paginateFlat,
  resolveAssembleWindow,
  resolveSeriesInclusion,
  seriesIgnoredForQueriesWarning,
  siteVsPathsSourceWarning,
  opportunitiesDatesRejectMessage,
  validateBatchSize,
  MAX_ORGANIC_PATHS,
  MAX_ORGANIC_HUBS,
  SERIES_BATCH_MAX,
  OPPORTUNITIES_DEFAULT_LIMIT,
  OPPORTUNITIES_MAX_LIMIT,
  ORGANIC_MAX_SPAN_DAYS,
} from "./organic-traffic-mcp";

describe("resolveAssembleWindow", () => {
  it("rejects span over max with OpenRush hint", () => {
    const r = resolveAssembleWindow({
      start: "2026-01-01",
      end: "2026-06-01",
    });
    expect("error" in r).toBe(true);
    if (!("error" in r)) return;
    expect(r.error).toContain(String(ORGANIC_MAX_SPAN_DAYS));
    expect(r.error.toLowerCase()).toContain("openrush");
  });

  it("hard-fails empty after clamp", () => {
    const r = resolveAssembleWindow({
      start: "2099-01-01",
      end: "2099-01-07",
    });
    expect("error" in r).toBe(true);
    if (!("error" in r)) return;
    expect(r.error.toLowerCase()).toMatch(/no complete|retry/);
  });

  it("defaults when both omitted", () => {
    const r = resolveAssembleWindow({});
    expect("error" in r).toBe(false);
    if ("error" in r) return;
    expect(r.days_expected).toBe(28);
    expect(r.start <= r.end).toBe(true);
  });
});

describe("siteVsPathsSourceWarning", () => {
  it("names the source mismatch", () => {
    expect(siteVsPathsSourceWarning().code).toBe("organic_site_vs_paths_source");
  });
});

describe("opportunitiesDatesRejectMessage", () => {
  it("rejects when dates are set", () => {
    expect(opportunitiesDatesRejectMessage("2026-08-27", "2026-09-02")).toMatch(/decay_window/);
    expect(opportunitiesDatesRejectMessage("2026-08-27", undefined)).toMatch(/not supported/);
  });

  it("allows omitting dates", () => {
    expect(opportunitiesDatesRejectMessage(undefined, undefined)).toBeNull();
    expect(opportunitiesDatesRejectMessage("", "  ")).toBeNull();
  });
});

describe("dedupeStrings", () => {
  it("preserves order and drops duplicates", () => {
    expect(dedupeStrings(["/a", " /a ", "/b", "/a"])).toEqual({
      unique: ["/a", "/b"],
      dropped: 2,
    });
  });

  it("treats empty or whitespace as absent", () => {
    expect(dedupeStrings(["", "  ", "/x"])).toEqual({ unique: ["/x"], dropped: 0 });
  });
});

describe("validateBatchSize", () => {
  it("fails empty", () => {
    expect(validateBatchSize("paths", 0).ok).toBe(false);
    expect(validateBatchSize("clusters", 0).ok).toBe(false);
  });

  it("fails over cap", () => {
    expect(validateBatchSize("paths", MAX_ORGANIC_PATHS + 1).ok).toBe(false);
    expect(validateBatchSize("clusters", MAX_ORGANIC_HUBS + 1).ok).toBe(false);
  });

  it("accepts within cap", () => {
    expect(validateBatchSize("paths", 1).ok).toBe(true);
    expect(validateBatchSize("paths", MAX_ORGANIC_PATHS).ok).toBe(true);
    expect(validateBatchSize("clusters", MAX_ORGANIC_HUBS).ok).toBe(true);
  });
});

describe("normalizePathBatch", () => {
  it("normalizes absolute URLs to pathnames", () => {
    const r = normalizePathBatch([
      "https://example.com/us/foo",
      "/us/foo",
      "not a path",
    ]);
    expect(r.keys).toEqual(["/us/foo"]);
    expect(r.invalid_inputs).toContain("not a path");
  });
});

describe("resolveSeriesInclusion", () => {
  it("site only when include_series true", () => {
    expect(resolveSeriesInclusion({ mode: "site", include_series: true, batchSize: 100 })).toEqual({
      include: true,
    });
    expect(resolveSeriesInclusion({ mode: "site", batchSize: 1 }).include).toBe(false);
  });

  it("skips series when paths batch too large", () => {
    const r = resolveSeriesInclusion({
      mode: "paths",
      include_series: true,
      batchSize: SERIES_BATCH_MAX + 1,
    });
    expect(r.include).toBe(false);
    expect(r.warning?.code).toBe("series_skipped_batch_too_large");
  });

  it("allows series for small paths batch", () => {
    expect(
      resolveSeriesInclusion({ mode: "paths", include_series: true, batchSize: SERIES_BATCH_MAX })
        .include,
    ).toBe(true);
  });
});

describe("flattenOpportunityCards + paginateFlat", () => {
  it("flattens kinds in stable order and paginates", () => {
    const flat = flattenOpportunityCards({
      page2: [{ query: "q1", url: "/a", clicks: 1, impressions: 10, position: 12, ctr: 0.1, cms_known: true, entry_key: null, write_count: 0 }],
      low_ctr: [{ query: "q2", url: "/b", clicks: 1, impressions: 200, position: 3, ctr: 0.01, expected_ctr: 0.1, gap: 0.09, cms_known: false, entry_key: null, write_count: 0 }],
      link_gaps: [],
      decay: [{ url: "/c", clicks: 1, impressions: 2, prior_clicks: 5, prior_impressions: 10, click_drop: 4 }],
      cannibalization: [{ query: "dup", impressions: 50, urls: [{ url: "/x", clicks: 1, impressions: 20, position: 2 }] }],
      missing_serp: [],
    });
    expect(flat.map((i) => i.kind)).toEqual(["page2", "low_ctr", "decay", "cannibalization"]);
    const page = paginateFlat(flat, 1, 2);
    expect(page.total).toBe(4);
    expect(page.items).toHaveLength(2);
    expect(page.items[0]!.kind).toBe("low_ctr");
    expect(page.next_offset).toBe(3);
  });
});

describe("clamp opportunities pagination", () => {
  it("defaults and clamps", () => {
    expect(clampOpportunitiesLimit(undefined)).toBe(OPPORTUNITIES_DEFAULT_LIMIT);
    expect(clampOpportunitiesLimit(999)).toBe(OPPORTUNITIES_MAX_LIMIT);
    expect(clampOpportunitiesOffset(-5)).toBe(0);
    expect(clampOpportunitiesOffset(10)).toBe(10);
  });
});

describe("seriesIgnoredForQueriesWarning", () => {
  it("codes series_ignored_for_mode", () => {
    expect(seriesIgnoredForQueriesWarning().code).toBe("series_ignored_for_mode");
  });
});
