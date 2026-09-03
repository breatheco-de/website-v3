/**
 * Build SEO cluster inventory payloads for MCP (sync reads over seo-index).
 */

import { contentIndex } from "../../server/content-index.js";
import {
  loadSeoIndex,
  computeClusterHealth,
  listClusterBucketEntries,
  getClusterFromIndex,
  type SeoIndex,
  type SeoIndexEntry,
} from "../../server/seo-index.js";
import {
  isClusterFilterBucket,
  enrichClusterBucketRowsWithKeywordMetrics,
  type ClusterFilterBucket,
  type ClusterBucketEntryRow,
} from "../../server/seo-cluster-stats.js";
import { resolveKeywordMetrics } from "../../server/openrush-keyword-cache.js";
import { getDefaultContentFolder } from "../../server/site-config.js";
import path from "path";

export { isClusterFilterBucket };
export type { ClusterFilterBucket };

function contentFolderFromRoot(contentRoot: string): string {
  return path.basename(path.resolve(contentRoot)) || getDefaultContentFolder();
}

function siblingLocales(
  index: SeoIndex,
  contentType: string,
  slug: string,
  currentLocale: string,
): string[] {
  const locales = new Set<string>();
  for (const e of Object.values(index.entries)) {
    if (e.content_type === contentType && e.slug === slug && e.locale) {
      locales.add(e.locale);
    }
  }
  return [...locales].filter((l) => l !== currentLocale).sort();
}

function memberFromId(
  index: SeoIndex,
  id: string,
  contentRoot: string,
): {
  id: string;
  contentType: string;
  slug: string;
  locale: string;
  path: string;
  main_keyword: string | null;
  kw_monthly_volume: number | null;
  kw_difficulty: number | null;
  keyword_metrics: ReturnType<typeof resolveKeywordMetrics>;
  is_pillar: boolean;
  sibling_locales: string[];
} {
  const folder = contentFolderFromRoot(contentRoot);
  const row = index.entries[id];
  if (row) {
    const yamlVol = typeof row.kw_monthly_volume === "number" ? row.kw_monthly_volume : null;
    const yamlDiff = typeof row.kw_difficulty === "number" ? row.kw_difficulty : null;
    const keyword_metrics = resolveKeywordMetrics({
      keyword: row.main_keyword,
      contentRoot,
      contentFolder: folder,
      yamlVolume: yamlVol,
      yamlDifficulty: yamlDiff,
    });
    return {
      id,
      contentType: row.content_type,
      slug: row.slug,
      locale: row.locale,
      path: row.path || "",
      main_keyword: row.main_keyword ?? null,
      kw_monthly_volume: keyword_metrics.kw_monthly_volume,
      kw_difficulty: keyword_metrics.kw_difficulty,
      keyword_metrics,
      is_pillar: row.is_pillar === true,
      sibling_locales: siblingLocales(index, row.content_type, row.slug, row.locale),
    };
  }
  const parts = id.split("/");
  const contentType = parts[0] || "unknown";
  const slug = parts.slice(1, -1).join("/") || parts[1] || id;
  const locale = parts[parts.length - 1] || "en";
  const keyword_metrics = resolveKeywordMetrics({
    keyword: null,
    contentRoot,
    contentFolder: folder,
  });
  return {
    id,
    contentType,
    slug,
    locale,
    path: "",
    main_keyword: null,
    kw_monthly_volume: null,
    kw_difficulty: null,
    keyword_metrics,
    is_pillar: false,
    sibling_locales: siblingLocales(index, contentType, slug, locale),
  };
}

function enrichBucketRow(
  index: SeoIndex,
  row: ClusterBucketEntryRow,
): ClusterBucketEntryRow & { sibling_locales: string[] } {
  return {
    ...row,
    sibling_locales: siblingLocales(index, row.contentType, row.slug, row.locale),
  };
}

export function buildListSeoClusters(contentRoot: string): {
  clusters: Array<{
    hubId: string;
    pillarUrl: string;
    keyword: string | null;
    locale: string | undefined;
    clusterCount: number;
    memberIds: string[];
    sibling_locales: string[];
  }>;
  clusterHealth: ReturnType<typeof computeClusterHealth>;
  indexRebuilt: boolean;
} {
  const index = loadSeoIndex(contentRoot);
  const clusterHealth = computeClusterHealth(index, contentIndex, contentRoot);
  const clusters = Object.entries(index.clusters).map(([hubId, cluster]) => {
    const hub = index.entries[hubId] as SeoIndexEntry | undefined;
    const keyword =
      typeof hub?.main_keyword === "string" && hub.main_keyword.trim()
        ? hub.main_keyword.trim()
        : null;
    return {
      hubId,
      pillarUrl: cluster.path,
      keyword,
      locale: hub?.locale,
      clusterCount: cluster.members.length,
      memberIds: cluster.members,
      sibling_locales: hub
        ? siblingLocales(index, hub.content_type, hub.slug, hub.locale)
        : [],
    };
  });
  return {
    clusters,
    clusterHealth,
    indexRebuilt: !!index.rebuilt,
  };
}

export function buildListSeoClusterEntries(
  contentRoot: string,
  opts: {
    bucket: ClusterFilterBucket;
    q?: string;
    page?: number;
    pageSize?: number;
  },
): {
  bucket: ClusterFilterBucket;
  items: Array<ClusterBucketEntryRow & { sibling_locales: string[] }>;
  total: number;
  page: number;
  pageSize: number;
} {
  const index = loadSeoIndex(contentRoot);
  const folder = contentFolderFromRoot(contentRoot);
  const result = listClusterBucketEntries(index, {
    bucket: opts.bucket,
    q: opts.q,
    page: opts.page,
    pageSize: opts.pageSize,
    ci: contentIndex,
    contentRoot,
  });
  const enriched = enrichClusterBucketRowsWithKeywordMetrics(result.items, {
    contentRoot,
    contentFolder: folder,
  });
  return {
    bucket: opts.bucket,
    items: enriched.map((row) => enrichBucketRow(index, row)),
    total: result.total,
    page: result.page,
    pageSize: result.pageSize,
  };
}

export function buildGetSeoCluster(
  contentRoot: string,
  hubIdOrPath: string,
): {
  hubId: string;
  path: string;
  keyword: string | null;
  locale: string | undefined;
  sibling_locales: string[];
  members: ReturnType<typeof memberFromId>[];
} | null {
  const index = loadSeoIndex(contentRoot);
  const cluster = getClusterFromIndex(hubIdOrPath, contentRoot);
  if (!cluster) return null;
  const hub = index.entries[cluster.hubId];
  const keyword =
    typeof hub?.main_keyword === "string" && hub.main_keyword.trim()
      ? hub.main_keyword.trim()
      : null;
  return {
    hubId: cluster.hubId,
    path: cluster.path,
    keyword,
    locale: hub?.locale,
    sibling_locales: hub
      ? siblingLocales(index, hub.content_type, hub.slug, hub.locale)
      : [],
    members: cluster.members.map((id) => memberFromId(index, id, contentRoot)),
  };
}
