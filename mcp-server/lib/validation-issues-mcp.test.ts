import { describe, it, expect } from "vitest";
import {
  clampIssuesLimit,
  isValidationIssuesScoped,
  issuesNextOffset,
  openStatsFromCacheTotals,
  paginateRows,
  parseIssuesSort,
  resolvedStatsFromArchiveSummary,
  sortIssueRows,
} from "./validation-issues-mcp";

describe("validation-issues-mcp", () => {
  it("requires a real scope filter (not set/limit alone)", () => {
    expect(isValidationIssuesScoped({})).toBe(false);
    expect(isValidationIssuesScoped({ set: "open", limit: 20 })).toBe(false);
    expect(isValidationIssuesScoped({ slug: "home" })).toBe(true);
    expect(isValidationIssuesScoped({ validator: "meta" })).toBe(true);
  });

  it("maps totals and paginates", () => {
    expect(openStatsFromCacheTotals({ openErrors: 2, openWarnings: 3, open: 5 })).toEqual({
      errors: 2,
      warnings: 3,
      total: 5,
    });
    expect(resolvedStatsFromArchiveSummary({ resolvedCount: 36, reopened: 1, total: 37 }).window_days).toBe(
      60,
    );
    expect(clampIssuesLimit(999)).toBe(200);
    expect(paginateRows([1, 2, 3, 4], 1, 2)).toEqual([2, 3]);
    expect(issuesNextOffset(0, 20, 25, 20)).toBe(20);
    expect(issuesNextOffset(20, 20, 25, 5)).toBe(null);
  });

  it("parseIssuesSort is set-aware and fails on mismatch", () => {
    expect(parseIssuesSort("open", undefined, undefined)).toEqual({
      ok: true,
      sort: "severity",
      sort_dir: "desc",
    });
    expect(parseIssuesSort("resolved", undefined, undefined)).toEqual({
      ok: true,
      sort: "resolvedAt",
      sort_dir: "desc",
    });
    expect(parseIssuesSort("open", "resolvedAt", "desc").ok).toBe(false);
    expect(parseIssuesSort("resolved", "lastFullRunAt", "desc").ok).toBe(false);
  });

  it("sortIssueRows severity desc, null dates last, id tie-break", () => {
    const rows = [
      { id: "b", severity: "warning", lastFullRunAt: "2026-01-02T00:00:00.000Z" },
      { id: "a", severity: "error", lastFullRunAt: null },
      { id: "c", severity: "error", lastFullRunAt: "2026-01-01T00:00:00.000Z" },
    ];
    const sorted = sortIssueRows(rows, {
      set: "open",
      sort: "severity",
      sort_dir: "desc",
    });
    expect(sorted.map((r) => r.id)).toEqual(["c", "a", "b"]);

    const byDate = sortIssueRows(
      [
        { id: "x", lastFullRunAt: null },
        { id: "y", lastFullRunAt: "2026-06-01T00:00:00.000Z" },
        { id: "z", lastFullRunAt: "2026-05-01T00:00:00.000Z" },
      ],
      { set: "open", sort: "lastFullRunAt", sort_dir: "desc" },
    );
    expect(byDate.map((r) => r.id)).toEqual(["y", "z", "x"]);
  });
});
