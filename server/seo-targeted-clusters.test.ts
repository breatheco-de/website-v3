import { describe, expect, it } from "vitest";
import type { SeoIndex } from "./seo-index";
import {
  buildTargetedClustersKpi,
  classifyHubTrend,
} from "./seo-targeted-clusters";

function minimalIndex(
  clusters: Record<string, { priority?: 1 | 2 | 3; members?: string[] }>,
): SeoIndex {
  return {
    version: 1,
    generated_at: "",
    entries: {},
    clusters: Object.fromEntries(
      Object.entries(clusters).map(([hubId, c]) => [
        hubId,
        {
          path: `/${hubId}`,
          members: c.members ?? [],
          ...(c.priority != null ? { priority: c.priority } : {}),
        },
      ]),
    ),
  } as SeoIndex;
}

describe("classifyHubTrend", () => {
  it("stays flat under the absolute click floor", () => {
    expect(classifyHubTrend(102, 100)).toBe("flat"); // +2% but only +2 clicks
    expect(classifyHubTrend(10, 12)).toBe("flat");
  });

  it("stays flat under 5% even with enough absolute clicks", () => {
    expect(classifyHubTrend(104, 100)).toBe("flat"); // +4 clicks, +4%
  });

  it("marks gaining / losing when both thresholds pass", () => {
    expect(classifyHubTrend(110, 100)).toBe("gaining"); // +10%, +10
    expect(classifyHubTrend(90, 100)).toBe("losing");
  });

  it("treats prior zero with enough new clicks as gaining", () => {
    expect(classifyHubTrend(3, 0)).toBe("gaining");
    expect(classifyHubTrend(2, 0)).toBe("flat");
  });
});

describe("buildTargetedClustersKpi", () => {
  it("returns empty High state without substituting Mid clicks", () => {
    const seoIndex = minimalIndex({
      "blog/mid/en": { priority: 2 },
    });
    const out = buildTargetedClustersKpi({
      seoIndex,
      currentClicksByHub: new Map([["blog/mid/en", 500]]),
      priorClicksByHub: new Map([["blog/mid/en", 400]]),
      trendsAvailable: true,
    });
    expect(out.high_hub_count).toBe(0);
    expect(out.high_clicks).toBe(0);
    expect(out.mid_clicks).toBe(500);
    expect(out.delta_pct).toBeNull();
    expect(out.gaining).toBeNull();
    expect(out.trends_available).toBe(false);
  });

  it("sums High headline and Mid subline; applies today's priorities to both windows", () => {
    const seoIndex = minimalIndex({
      "blog/high/en": { priority: 1 },
      "blog/mid/en": { priority: 2 },
      "blog/low/en": { priority: 3 },
    });
    const out = buildTargetedClustersKpi({
      seoIndex,
      currentClicksByHub: new Map([
        ["blog/high/en", 200],
        ["blog/mid/en", 50],
        ["blog/low/en", 999],
      ]),
      priorClicksByHub: new Map([
        ["blog/high/en", 100],
        ["blog/mid/en", 40],
        ["blog/low/en", 800],
      ]),
      trendsAvailable: true,
    });
    expect(out.high_clicks).toBe(200);
    expect(out.mid_clicks).toBe(50);
    expect(out.high_clicks_prior).toBe(100);
    expect(out.delta_pct).toBeCloseTo(100);
    expect(out.gaining).toBe(1);
    expect(out.flat).toBe(0);
    expect(out.losing).toBe(0);
  });

  it("nulls delta and trends when prior window is unavailable", () => {
    const seoIndex = minimalIndex({
      "blog/high/en": { priority: 1 },
    });
    const out = buildTargetedClustersKpi({
      seoIndex,
      currentClicksByHub: new Map([["blog/high/en", 200]]),
      priorClicksByHub: new Map([["blog/high/en", 100]]),
      trendsAvailable: false,
    });
    expect(out.high_clicks).toBe(200);
    expect(out.delta_pct).toBeNull();
    expect(out.high_clicks_prior).toBeNull();
    expect(out.gaining).toBeNull();
    expect(out.trends_available).toBe(false);
  });
});
