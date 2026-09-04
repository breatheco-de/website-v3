/**
 * Lazy Cluster Map perspective metrics (traffic / potential / integrity / activity).
 */

import {
  crawlerBadgeState,
  googleToCrawlerStatus,
  type CrawlerBadgeState,
} from "@shared/search-engine-status";
import {
  ENTRY_ACTIVITY_WINDOW_DAYS,
  ENTRY_ACTIVITY_WRITE_TYPES,
} from "@shared/event-log-filters";
import { getSiteSqlite } from "./db";
import { ensurePipelineDb } from "./pipeline-db/runner";
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

export type ClusterMetricsPerspective = "traffic" | "potential" | "integrity" | "activity";

export function isClusterMetricsPerspective(v: string): v is ClusterMetricsPerspective {
  return v === "traffic" || v === "potential" || v === "integrity" || v === "activity";
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

/**
 * Resolve entry key for activity counting: prefer payload.entryKey, else resource triple.
 * Returns null when incomplete (skipped).
 */
export function resolveActivityEntryKey(opts: {
  payloadEntryKey?: unknown;
  contentType?: unknown;
  slug?: unknown;
  locale?: unknown;
}): string | null {
  if (typeof opts.payloadEntryKey === "string" && opts.payloadEntryKey.trim()) {
    return opts.payloadEntryKey.trim();
  }
  const contentType = typeof opts.contentType === "string" ? opts.contentType.trim() : "";
  const slug = typeof opts.slug === "string" ? opts.slug.trim() : "";
  const locale = typeof opts.locale === "string" ? opts.locale.trim() : "";
  if (!contentType || !slug || !locale) return null;
  return `${contentType}/${slug}/${locale}`;
}

/** Count people+agent entry writes in the rolling window, keyed by entry id. */
export function countEntryActivityWrites(opts: {
  site: string;
  since?: number;
  now?: number;
}): Map<string, number> {
  const now = opts.now ?? Date.now();
  const since =
    opts.since ?? now - ENTRY_ACTIVITY_WINDOW_DAYS * 24 * 60 * 60 * 1000;
  ensurePipelineDb(opts.site);
  const db = getSiteSqlite(opts.site);
  const placeholders = ENTRY_ACTIVITY_WRITE_TYPES.map(() => "?").join(", ");
  const rows = db
    .prepare(
      `SELECT
         COALESCE(
           NULLIF(TRIM(json_extract(payload_json, '$.entryKey')), ''),
           CASE
             WHEN json_extract(resource_json, '$.contentType') IS NOT NULL
              AND json_extract(resource_json, '$.slug') IS NOT NULL
              AND json_extract(resource_json, '$.locale') IS NOT NULL
             THEN json_extract(resource_json, '$.contentType')
               || '/' || json_extract(resource_json, '$.slug')
               || '/' || json_extract(resource_json, '$.locale')
             ELSE NULL
           END
         ) AS entry_key
       FROM events
       WHERE site = ?
         AND created_at >= ?
         AND type IN (${placeholders})
         AND json_extract(attribution_json, '$[0].actor.type') IN ('ui', 'mcp')`,
    )
    .all(opts.site, since, ...ENTRY_ACTIVITY_WRITE_TYPES) as Array<{ entry_key: string | null }>;

  const counts = new Map<string, number>();
  for (const row of rows) {
    const key = row.entry_key?.trim();
    if (!key) continue;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return counts;
}

export function buildActivityClusterMetrics(opts: {
  seoIndex: SeoIndex;
  site: string;
  now?: number;
}) {
  const now = opts.now ?? Date.now();
  const since = now - ENTRY_ACTIVITY_WINDOW_DAYS * 24 * 60 * 60 * 1000;
  const counts = countEntryActivityWrites({ site: opts.site, since, now });

  const clusters = Object.entries(opts.seoIndex.clusters).map(([hubId, cluster]) => {
    const hubWriteCount = counts.get(hubId) ?? 0;
    const members = cluster.members.map((id) => ({
      id,
      writeCount: counts.get(id) ?? 0,
    }));
    const clusterWriteCount =
      hubWriteCount + members.reduce((sum, m) => sum + m.writeCount, 0);
    return {
      hubId,
      hubWriteCount,
      clusterWriteCount,
      members,
    };
  });

  return {
    perspective: "activity" as const,
    windowDays: ENTRY_ACTIVITY_WINDOW_DAYS,
    since,
    clusters,
  };
}
