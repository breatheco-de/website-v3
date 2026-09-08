import { describe, expect, it } from "vitest";
import {
  buildOrganicQueryMatchSql,
  escapeLikePattern,
} from "./gsc-bigquery-client";
import {
  clampPagesPerQuery,
  clampQueriesLimit,
  clampQueriesOffset,
  inclusiveDaySpan,
  nestOrganicQueryRows,
  queryTextMatches,
  resolveQueriesWindow,
  QUERIES_DEFAULT_LIMIT,
  QUERIES_DEFAULT_PAGES_PER_QUERY,
  QUERIES_MAX_LIMIT,
  QUERIES_MAX_PAGES_PER_QUERY,
  QUERIES_MAX_SPAN_DAYS,
} from "./gsc-organic-query-search";

describe("escapeLikePattern", () => {
  it("escapes LIKE wildcards", () => {
    expect(escapeLikePattern("100%_off\\x")).toBe("100\\%\\_off\\\\x");
  });
});

describe("buildOrganicQueryMatchSql", () => {
  it("builds contains with escaped like", () => {
    const r = buildOrganicQueryMatchSql("contains", "py%");
    expect(r.sql).toContain("LIKE CONCAT('%'");
    expect(r.params.needle_like).toBe("py\\%");
  });

  it("builds equals", () => {
    const r = buildOrganicQueryMatchSql("equals", "python");
    expect(r.sql).toContain("= @needle");
    expect(r.params.needle).toBe("python");
  });

  it("builds starts_with", () => {
    const r = buildOrganicQueryMatchSql("starts_with", "py");
    expect(r.sql).toContain("CONCAT(@needle_like, '%')");
    expect(r.params.needle_like).toBe("py");
  });
});

describe("queryTextMatches", () => {
  it("contains / equals / starts_with", () => {
    expect(queryTextMatches("Learn Python Fast", "python", "contains")).toBe(true);
    expect(queryTextMatches("python", "python", "equals")).toBe(true);
    expect(queryTextMatches("python bootcamp", "python", "equals")).toBe(false);
    expect(queryTextMatches("python bootcamp", "python", "starts_with")).toBe(true);
    expect(queryTextMatches("learn python", "python", "starts_with")).toBe(false);
  });
});

describe("resolveQueriesWindow", () => {
  const now = new Date(Date.UTC(2026, 8, 8)); // 2026-09-08 → last complete 2026-09-06

  it("defaults to last 28 complete days", () => {
    const r = resolveQueriesWindow({ now });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.end).toBe("2026-09-06");
    expect(r.days_expected).toBe(28);
    expect(inclusiveDaySpan(r.start, r.end)).toBe(28);
  });

  it("requires both start and end", () => {
    const r = resolveQueriesWindow({ start: "2026-08-01", now });
    expect(r.ok).toBe(false);
  });

  it("rejects span over max", () => {
    const r = resolveQueriesWindow({
      start: "2026-01-01",
      end: "2026-06-01",
      now,
    });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.message).toContain(String(QUERIES_MAX_SPAN_DAYS));
  });

  it("accepts custom range within max", () => {
    const r = resolveQueriesWindow({
      start: "2026-08-01",
      end: "2026-08-10",
      now,
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.start).toBe("2026-08-01");
    expect(r.end).toBe("2026-08-10");
    expect(r.days_expected).toBe(10);
  });

  it("clamps end to latest complete day", () => {
    const r = resolveQueriesWindow({
      start: "2026-09-01",
      end: "2026-09-20",
      now,
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.end).toBe("2026-09-06");
  });
});

describe("clamps", () => {
  it("limit / offset / pages_per_query", () => {
    expect(clampQueriesLimit(undefined)).toBe(QUERIES_DEFAULT_LIMIT);
    expect(clampQueriesLimit(999)).toBe(QUERIES_MAX_LIMIT);
    expect(clampQueriesOffset(-3)).toBe(0);
    expect(clampPagesPerQuery(undefined)).toBe(QUERIES_DEFAULT_PAGES_PER_QUERY);
    expect(clampPagesPerQuery(99)).toBe(QUERIES_MAX_PAGES_PER_QUERY);
  });
});

describe("nestOrganicQueryRows", () => {
  it("groups by query, nests top pages, window-wide totals, paginates", () => {
    const nested = nestOrganicQueryRows(
      [
        {
          query: "python",
          url: "https://example.com/a",
          clicks: 10,
          impressions: 100,
          sum_position: 500,
        },
        {
          query: "python",
          url: "https://example.com/b",
          clicks: 5,
          impressions: 50,
          sum_position: 200,
        },
        {
          query: "python course",
          url: "https://example.com/c",
          clicks: 20,
          impressions: 200,
          sum_position: 400,
        },
        {
          query: "java",
          url: "https://example.com/d",
          clicks: 1,
          impressions: 10,
          sum_position: 50,
        },
      ],
      { pagesPerQuery: 1, offset: 0, limit: 2 },
    );
    expect(nested.total).toBe(3);
    expect(nested.items).toHaveLength(2);
    expect(nested.items[0]!.query).toBe("python course");
    expect(nested.items[1]!.query).toBe("python");
    expect(nested.items[1]!.clicks).toBe(15);
    expect(nested.items[1]!.pages).toHaveLength(1);
    expect(nested.items[1]!.pages[0]!.url).toBe("https://example.com/a");
    expect(nested.selection_totals.clicks).toBe(36);
    expect(nested.selection_totals.impressions).toBe(360);
    expect(nested.next_offset).toBe(2);
  });

  it("soft empty", () => {
    const nested = nestOrganicQueryRows([], { pagesPerQuery: 5, offset: 0, limit: 25 });
    expect(nested.items).toEqual([]);
    expect(nested.total).toBe(0);
    expect(nested.selection_totals).toEqual({ clicks: 0, impressions: 0, ctr: 0 });
    expect(nested.next_offset).toBeNull();
  });
});
