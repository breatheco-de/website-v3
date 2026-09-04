import { describe, expect, it, beforeEach, afterEach } from "vitest";
import fs from "fs";
import path from "path";
import {
  applyClusterPriorities,
  snapshotClusterPriorities,
  type SeoIndexCluster,
} from "./seo-index";
import {
  buildActivityClusterMetrics,
  buildPotentialClusterMetrics,
  isClusterMetricsPerspective,
  resolveActivityEntryKey,
} from "./seo-cluster-metrics";
import type { SeoIndex } from "./seo-index";
import { clearAllEvents, emitEvent, singleAttribution } from "./events/event-store";
import { clearSiteSqliteCacheForTests } from "./db";
import { resetPipelineDbCache } from "./pipeline-db/runner";

describe("cluster metrics helpers", () => {
  it("isClusterMetricsPerspective accepts known values", () => {
    expect(isClusterMetricsPerspective("traffic")).toBe(true);
    expect(isClusterMetricsPerspective("potential")).toBe(true);
    expect(isClusterMetricsPerspective("integrity")).toBe(true);
    expect(isClusterMetricsPerspective("activity")).toBe(true);
    expect(isClusterMetricsPerspective("other")).toBe(false);
  });

  it("resolveActivityEntryKey prefers payload then resource", () => {
    expect(
      resolveActivityEntryKey({
        payloadEntryKey: "blog/a/en",
        contentType: "page",
        slug: "home",
        locale: "en",
      }),
    ).toBe("blog/a/en");
    expect(
      resolveActivityEntryKey({
        contentType: "page",
        slug: "home",
        locale: "en",
      }),
    ).toBe("page/home/en");
    expect(resolveActivityEntryKey({ contentType: "page", slug: "home" })).toBeNull();
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

describe("buildActivityClusterMetrics", () => {
  const site = "site_test-activity-metrics";
  const now = Date.now();

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
        is_pillar: false,
        pillar_path: "/en/blog/hub",
        pillar_live: true,
      },
    },
    by_path: {},
    clusters: {
      "blog/hub/en": { path: "/en/blog/hub", members: ["blog/spoke/en"] },
    },
    orphans: [],
    warnings: [],
  } satisfies SeoIndex;

  beforeEach(() => {
    resetPipelineDbCache();
    clearSiteSqliteCacheForTests();
    const dbPath = path.join("data", site, "app.db");
    if (fs.existsSync(dbPath)) fs.unlinkSync(dbPath);
  });

  afterEach(() => {
    clearAllEvents(site);
    resetPipelineDbCache();
    clearSiteSqliteCacheForTests();
  });

  it("counts ui and mcp writes; ignores system and non-write types", () => {
    emitEvent({
      site,
      type: "entry_locale_saved",
      resource: { contentType: "blog", slug: "hub", locale: "en" },
      attribution: singleAttribution("jane", { type: "ui" }),
    });
    emitEvent({
      site,
      type: "entry_seo_changed",
      resource: { contentType: "blog", slug: "spoke", locale: "en" },
      attribution: singleAttribution("claude", {
        type: "mcp",
        client: "Cursor",
        model: "claude-4-sonnet",
      }),
    });
    emitEvent({
      site,
      type: "entry_locale_saved",
      resource: { contentType: "blog", slug: "hub", locale: "en" },
      attribution: singleAttribution("index", { type: "system", source: "index-refresh" }),
    });
    emitEvent({
      site,
      type: "validation_results_ready",
      payload: { entryKey: "blog/hub/en" },
      attribution: singleAttribution("jane", { type: "ui" }),
    });

    const result = buildActivityClusterMetrics({ seoIndex, site, now });
    expect(result.perspective).toBe("activity");
    expect(result.windowDays).toBe(14);
    const cluster = result.clusters[0]!;
    expect(cluster.hubWriteCount).toBe(1);
    expect(cluster.members[0]?.writeCount).toBe(1);
    expect(cluster.clusterWriteCount).toBe(2);
  });

  it("prefers payload.entryKey and defaults missing pages to 0", () => {
    emitEvent({
      site,
      type: "entry_locale_saved",
      payload: { entryKey: "blog/spoke/en" },
      attribution: singleAttribution("jane", { type: "ui" }),
    });
    const result = buildActivityClusterMetrics({ seoIndex, site, now });
    expect(result.clusters[0]?.hubWriteCount).toBe(0);
    expect(result.clusters[0]?.members[0]?.writeCount).toBe(1);
  });
});
