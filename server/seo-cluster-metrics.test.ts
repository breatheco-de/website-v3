import { describe, expect, it } from "vitest";
import {
  applyClusterPriorities,
  snapshotClusterPriorities,
  type SeoIndexCluster,
} from "./seo-index";
import {
  buildPotentialClusterMetrics,
  isClusterMetricsPerspective,
} from "./seo-cluster-metrics";
import type { SeoIndex } from "./seo-index";

describe("cluster metrics helpers", () => {
  it("isClusterMetricsPerspective accepts known values", () => {
    expect(isClusterMetricsPerspective("traffic")).toBe(true);
    expect(isClusterMetricsPerspective("potential")).toBe(true);
    expect(isClusterMetricsPerspective("integrity")).toBe(true);
    expect(isClusterMetricsPerspective("other")).toBe(false);
  });

  it("snapshot and apply drop missing hubs", () => {
    const before: Record<string, SeoIndexCluster> = {
      "blog/hub/en": { path: "/en/blog/hub", members: [], priority: 1 },
      "blog/gone/en": { path: "/en/blog/gone", members: [], priority: 2 },
    };
    const snap = snapshotClusterPriorities(before);
    const next: Record<string, SeoIndexCluster> = {
      "blog/hub/en": { path: "/en/blog/hub", members: ["blog/a/en"] },
    };
    applyClusterPriorities(next, snap);
    expect(next["blog/hub/en"]?.priority).toBe(1);
    expect(next["blog/gone/en"]).toBeUndefined();
  });

  it("buildPotentialClusterMetrics sums volumes", () => {
    const seoIndex = {
      version: 1 as const,
      generated_at: new Date().toISOString(),
      entries: {
        "blog/hub/en": {
          content_type: "blog",
          slug: "hub",
          locale: "en",
          file: "blog/hub/en.yml",
          path: "/en/blog/hub",
          main_keyword: "hub",
          kw_monthly_volume: 100,
          kw_difficulty: 10,
          is_pillar: true,
          pillar_path: "/en/blog/hub",
          pillar_live: true,
        },
        "blog/spoke/en": {
          content_type: "blog",
          slug: "spoke",
          locale: "en",
          file: "blog/spoke/en.yml",
          path: "/en/blog/spoke",
          main_keyword: "spoke",
          kw_monthly_volume: 50,
          kw_difficulty: 20,
          is_pillar: false,
          pillar_path: "/en/blog/hub",
          pillar_live: true,
        },
      },
      by_path: { "/en/blog/hub": "blog/hub/en" },
      clusters: {
        "blog/hub/en": { path: "/en/blog/hub", members: ["blog/spoke/en"] },
      },
      orphans: [],
      warnings: [],
    } satisfies SeoIndex;

    const result = buildPotentialClusterMetrics({
      seoIndex,
      contentRoot: "/tmp",
      contentFolder: "site_test",
    });
    expect(result.clusters[0]?.clusterVolumeSum).toBe(150);
    expect(result.clusters[0]?.hub.kw_difficulty).toBe(10);
  });
});
