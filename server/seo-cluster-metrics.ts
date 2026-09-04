/**
 * Lazy Cluster Map perspective metrics (traffic / potential / integrity).
 */

import {
  crawlerBadgeState,
  googleToCrawlerStatus,
  type CrawlerBadgeState,
} from "@shared/search-engine-status";
import { resolveKeywordMetrics } from "./openrush-keyword-cache";
import {
  buildOrganicPathTraffic,
  lookupPathTraffic,
  sumPathTraffic,
  type PathTrafficStats,
} from "./gsc-organic-path-traffic";
import { buildSiteOrganicTraffic } from "./gsc-organic-site-traffic";
import {
  buildOtherHighTraffic,
  clusteredPathsFromSeoIndex,
} from "./gsc-organic-other-traffic";
import {
  getGscConfig,
  loadStore,
  toUrlPath,
  type GscInspectionRecord,
} from "./gsc-url-inspection";
import type { SeoIndex, SeoIndexEntry } from "./seo-index";
import { getValidationCacheService } from "./services/validationCacheService";

export type ClusterMetricsPerspective = "traffic" | "potential" | "integrity";

export function isClusterMetricsPerspective(v: string): v is ClusterMetricsPerspective {
  return v === "traffic" || v === "potential" || v === "integrity";
}

function memberFromEntry(id: string, row?: SeoIndexEntry) {
  const parts = id.split("/");
  const contentType = row?.content_type || parts[0] || "";
  const locale = row?.locale || parts[parts.length - 1] || "";
  const slug =
    row?.slug || (parts.length >= 3 ? parts.slice(1, -1).join("/") : parts[1] || id);
  return {
    id,
    slug,
    contentType,
    locale,
    path: row?.path || "",
    keyword: row?.main_keyword ?? null,
  };
}

function buildGscRecordsByPath(contentFolder: string, contentRoot?: string): {
  configured: boolean;
  byPath: Record<string, GscInspectionRecord>;
} {
  const cfg = getGscConfig(contentRoot);
  const store = loadStore(contentFolder);
  const byPath: Record<string, GscInspectionRecord> = {};
  for (const [loc, rec] of Object.entries(store.records)) {
    const key = toUrlPath(loc);
    if (key) byPath[key] = rec;
  }
  return { configured: cfg.configured, byPath };
}

function lookupValidationCounts(
  summary: Record<string, { errorCount: number; warningCount: number }>,
  opts: { entryId: string; path: string },
): { errorCount: number; warningCount: number } {
  const byId = summary[opts.entryId];
  if (byId) return byId;
  const byPath = opts.path ? summary[opts.path] : undefined;
  if (byPath) return byPath;
  return { errorCount: 0, warningCount: 0 };
}

function badgeForPath(
  configured: boolean,
  byPath: Record<string, GscInspectionRecord>,
  pagePath: string,
): CrawlerBadgeState {
  const key = pagePath ? toUrlPath(pagePath) : "";
  const record = key ? byPath[key] ?? null : null;
  return crawlerBadgeState([
    googleToCrawlerStatus({
      configured,
      record,
    }),
  ]);
}

export async function buildTrafficClusterMetrics(opts: {
  seoIndex: SeoIndex;
  contentRoot: string;
  contentFolder: string;
  market: string;
  isKnownUrl: (path: string) => boolean;
}) {
  const organic = buildOrganicPathTraffic({
    contentFolder: opts.contentFolder,
    contentRoot: opts.contentRoot,
    market: opts.market,
    kpiPaths: clusteredPathsFromSeoIndex(opts.seoIndex),
  });
  const siteOrganicTraffic = await buildSiteOrganicTraffic({
    contentRoot: opts.contentRoot,
    contentFolder: opts.contentFolder,
  });
  const otherHighTraffic = buildOtherHighTraffic({
    contentFolder: opts.contentFolder,
    contentRoot: opts.contentRoot,
    market: opts.market,
    seoIndex: opts.seoIndex,
    isKnownUrl: opts.isKnownUrl,
  });

  const clusters = Object.entries(opts.seoIndex.clusters).map(([hubId, cluster]) => {
    const hub = opts.seoIndex.entries[hubId];
    const hubPath = cluster.path || hub?.path || "";
    const hubTraffic = lookupPathTraffic(organic.byPath, hubPath);
    const memberTraffics: Array<PathTrafficStats | undefined> = [];
    const members = cluster.members.map((id) => {
      const base = memberFromEntry(id, opts.seoIndex.entries[id]);
      const traffic = lookupPathTraffic(organic.byPath, base.path);
      memberTraffics.push(traffic);
      return traffic ? { id, traffic } : { id };
    });
    const clusterTraffic = sumPathTraffic([hubTraffic, ...memberTraffics]);
    return {
      hubId,
      ...(hubTraffic ? { hubTraffic } : {}),
      ...(clusterTraffic ? { clusterTraffic } : {}),
      members,
    };
  });

  return {
    perspective: "traffic" as const,
    organicTraffic: {
      window: organic.window,
      days_present: organic.days_present,
      days_in_window: organic.days_in_window,
      days_expected: organic.days_expected,
      incomplete: organic.incomplete,
      country_less: organic.country_less,
      truncated: organic.truncated,
      market: organic.market,
      markets: organic.markets,
      market_warning: organic.market_warning,
      totals: organic.totals,
      series: organic.series,
    },
    siteOrganicTraffic: {
      window: siteOrganicTraffic.window,
      days_in_window: siteOrganicTraffic.days_in_window,
      days_expected: siteOrganicTraffic.days_expected,
      incomplete: siteOrganicTraffic.incomplete,
      configured: siteOrganicTraffic.configured,
      source: siteOrganicTraffic.source,
      error: siteOrganicTraffic.error,
      totals: siteOrganicTraffic.totals,
      series: siteOrganicTraffic.series,
    },
    otherHighTraffic: {
      window: otherHighTraffic.window,
      market: otherHighTraffic.market,
      days_in_window: otherHighTraffic.days_in_window,
      days_expected: otherHighTraffic.days_expected,
      incomplete: otherHighTraffic.incomplete,
      known: otherHighTraffic.known,
      unknown: otherHighTraffic.unknown,
    },
    clusters,
  };
}

export function buildPotentialClusterMetrics(opts: {
  seoIndex: SeoIndex;
  contentRoot: string;
  contentFolder: string;
}) {
  const clusters = Object.entries(opts.seoIndex.clusters).map(([hubId, cluster]) => {
    const hub = opts.seoIndex.entries[hubId];
    const hubResolved = resolveKeywordMetrics({
      keyword: hub?.main_keyword,
      contentRoot: opts.contentRoot,
      contentFolder: opts.contentFolder,
      yamlVolume: hub?.kw_monthly_volume ?? null,
      yamlDifficulty: hub?.kw_difficulty ?? null,
    });
    const members = cluster.members.map((id) => {
      const row = opts.seoIndex.entries[id];
      const resolved = resolveKeywordMetrics({
        keyword: row?.main_keyword,
        contentRoot: opts.contentRoot,
        contentFolder: opts.contentFolder,
        yamlVolume: row?.kw_monthly_volume ?? null,
        yamlDifficulty: row?.kw_difficulty ?? null,
      });
      return {
        id,
        kw_monthly_volume: resolved.kw_monthly_volume,
        kw_difficulty: resolved.kw_difficulty,
      };
    });
    let volumeSum = typeof hubResolved.kw_monthly_volume === "number" ? hubResolved.kw_monthly_volume : 0;
    let volumeParts = typeof hubResolved.kw_monthly_volume === "number" ? 1 : 0;
    for (const m of members) {
      if (typeof m.kw_monthly_volume === "number") {
        volumeSum += m.kw_monthly_volume;
        volumeParts += 1;
      }
    }
    return {
      hubId,
      hub: {
        kw_monthly_volume: hubResolved.kw_monthly_volume,
        kw_difficulty: hubResolved.kw_difficulty,
      },
      clusterVolumeSum: volumeParts > 0 ? volumeSum : null,
      members,
    };
  });

  return { perspective: "potential" as const, clusters };
}

export function buildIntegrityClusterMetrics(opts: {
  seoIndex: SeoIndex;
  contentFolder: string;
  contentRoot?: string;
  validationCache?: {
    getAll: () => Map<string, { errors: unknown[]; warnings: unknown[] }>;
    getAllByEntryKey: () => Map<string, { errors: unknown[]; warnings: unknown[] }>;
  };
}) {
  const cache = opts.validationCache ?? getValidationCacheService();
  const summary: Record<string, { errorCount: number; warningCount: number }> = {};
  for (const [url, entry] of cache.getAll()) {
    summary[url] = { errorCount: entry.errors.length, warningCount: entry.warnings.length };
  }
  for (const [entryKey, entry] of cache.getAllByEntryKey()) {
    summary[entryKey] = {
      errorCount: entry.errors.length,
      warningCount: entry.warnings.length,
    };
  }

  const { configured, byPath } = buildGscRecordsByPath(opts.contentFolder, opts.contentRoot);

  const clusters = Object.entries(opts.seoIndex.clusters).map(([hubId, cluster]) => {
    const hub = opts.seoIndex.entries[hubId];
    const hubPath = cluster.path || hub?.path || "";
    const hubCounts = lookupValidationCounts(summary, { entryId: hubId, path: hubPath });
    const hubCrawler = badgeForPath(configured, byPath, hubPath);

    let errorSum = hubCounts.errorCount;
    let warningSum = hubCounts.warningCount;
    const members = cluster.members.map((id) => {
      const row = opts.seoIndex.entries[id];
      const path = row?.path || "";
      const counts = lookupValidationCounts(summary, { entryId: id, path });
      errorSum += counts.errorCount;
      warningSum += counts.warningCount;
      return {
        id,
        errorCount: counts.errorCount,
        warningCount: counts.warningCount,
        crawlerState: badgeForPath(configured, byPath, path),
      };
    });

    return {
      hubId,
      hub: {
        errorCount: hubCounts.errorCount,
        warningCount: hubCounts.warningCount,
        crawlerState: hubCrawler,
      },
      cluster: {
        errorCount: errorSum,
        warningCount: warningSum,
        issueCount: errorSum + warningSum,
      },
      members,
    };
  });

  return {
    perspective: "integrity" as const,
    gscConfigured: configured,
    clusters,
  };
}
