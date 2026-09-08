import { describe, expect, it } from "vitest";
import {
  compareOrganicEntries,
  defaultOrganicSortDir,
  deriveOrganicCacheStatus,
  parseOrganicSortField,
  sortOrganicEntries,
  trafficCtr,
  withTrafficCtr,
  type OrganicEntrySortable,
} from "./organic-entries";

function entry(
  partial: Partial<OrganicEntrySortable> & { slug: string },
): OrganicEntrySortable {
  return {
    title: partial.title ?? partial.slug,
    pageTitle: partial.pageTitle ?? "",
    slug: partial.slug,
    traffic: partial.traffic ?? null,
  };
}

describe("trafficCtr / withTrafficCtr", () => {
  it("returns 0 when impressions are 0", () => {
    expect(trafficCtr(5, 0)).toBe(0);
    expect(withTrafficCtr({ clicks: 5, impressions: 0, position: 1 }).ctr).toBe(0);
  });

  it("computes clicks/impressions", () => {
    expect(trafficCtr(10, 100)).toBe(0.1);
    expect(withTrafficCtr({ clicks: 10, impressions: 100, position: 3.2 })).toEqual({
      clicks: 10,
      impressions: 100,
      position: 3.2,
      ctr: 0.1,
    });
  });
});

describe("deriveOrganicCacheStatus", () => {
  it("empty when no window or no days", () => {
    expect(
      deriveOrganicCacheStatus({ window: null, days_in_window: 0, incomplete: true }),
    ).toBe("empty");
    expect(
      deriveOrganicCacheStatus({
        window: { start: "2026-01-01", end: "2026-01-28" },
        days_in_window: 0,
        incomplete: false,
      }),
    ).toBe("empty");
  });

  it("incomplete when flag set with data", () => {
    expect(
      deriveOrganicCacheStatus({
        window: { start: "2026-01-01", end: "2026-01-28" },
        days_in_window: 10,
        incomplete: true,
      }),
    ).toBe("incomplete");
  });

  it("ok when complete", () => {
    expect(
      deriveOrganicCacheStatus({
        window: { start: "2026-01-01", end: "2026-01-28" },
        days_in_window: 28,
        incomplete: false,
      }),
    ).toBe("ok");
  });
});

describe("compareOrganicEntries / sortOrganicEntries", () => {
  const a = entry({
    slug: "alpha",
    traffic: { clicks: 10, impressions: 100, position: 5, ctr: 0.1 },
  });
  const b = entry({
    slug: "beta",
    traffic: { clicks: 50, impressions: 200, position: 2, ctr: 0.25 },
  });
  const c = entry({ slug: "gamma", traffic: null });
  const d = entry({ slug: "delta", traffic: null });

  it("sorts clicks desc with nulls last", () => {
    const sorted = sortOrganicEntries([c, a, b, d], "clicks", "desc");
    expect(sorted.map((e) => e.slug)).toEqual(["beta", "alpha", "delta", "gamma"]);
  });

  it("sorts clicks asc with nulls still last", () => {
    const sorted = sortOrganicEntries([c, a, b, d], "clicks", "asc");
    expect(sorted.map((e) => e.slug)).toEqual(["alpha", "beta", "delta", "gamma"]);
  });

  it("title sort ignores null traffic special-casing", () => {
    const sorted = sortOrganicEntries([c, a, b, d], "title", "asc");
    expect(sorted.map((e) => e.slug)).toEqual(["alpha", "beta", "delta", "gamma"]);
  });

  it("compare puts null after non-null for metric sorts", () => {
    expect(compareOrganicEntries(a, c, "clicks", "desc")).toBeLessThan(0);
    expect(compareOrganicEntries(c, a, "clicks", "desc")).toBeGreaterThan(0);
    expect(compareOrganicEntries(c, a, "clicks", "asc")).toBeGreaterThan(0);
  });
});

describe("parseOrganicSortField / defaultOrganicSortDir", () => {
  it("defaults sort to clicks", () => {
    expect(parseOrganicSortField(undefined)).toBe("clicks");
    expect(parseOrganicSortField("nope")).toBe("clicks");
    expect(parseOrganicSortField("position")).toBe("position");
  });

  it("defaults sortDir by field", () => {
    expect(defaultOrganicSortDir("clicks", null)).toBe("desc");
    expect(defaultOrganicSortDir("title", null)).toBe("asc");
    expect(defaultOrganicSortDir("clicks", "asc")).toBe("asc");
  });
});
