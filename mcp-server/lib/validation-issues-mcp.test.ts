import { describe, it, expect } from "vitest";
import {
  clampIssuesLimit,
  isValidationIssuesScoped,
  issuesNextOffset,
  openStatsFromCacheTotals,
  paginateRows,
  resolvedStatsFromArchiveSummary,
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
});
