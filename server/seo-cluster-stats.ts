/**
 * Cluster health buckets and stats derived from seo-index.json
 * plus monitored pages with no SEO signal (Unclustered gap).
 */

import type { ContentIndex } from "./content-index";
import { contentIndex } from "./content-index";
import { createPublicUrlResolver } from "./redirects";
import { entryCanonicalPath } from "./seo-fields";
import type { MonitoredSeoGap } from "./seo-monitored-scan";
import type { SeoIndex, SeoIndexEntry } from "./seo-index";

export type ClusterBucket =
  | "hub"
  | "clustered"
  | "unclustered"
  | "partiallySet"
  | "optedOut"
  | "brokenRef";

export type BrokenClusterRefReason = "hub_not_found" | "hub_not_pillar";

export type ClusterBucketCounts = {
  unclustered: number;
  partiallySet: number;
  brokenRefs: number;
  optedOut: number;
  clustered: number;
  hub: number;
};

export type ClusterHealth = {
  emptyHubCount: number;
  stats: ClusterBucketCounts;
  byContentType: Record<string, ClusterBucketCounts>;
  byLocale: Record<string, ClusterBucketCounts>;
};

function emptyCounts(): ClusterBucketCounts {
  return {
    unclustered: 0,
    partiallySet: 0,
    brokenRefs: 0,
    optedOut: 0,
    clustered: 0,
    hub: 0,
  };
}

function bump(target: ClusterBucketCounts, bucket: ClusterBucket): void {
  if (bucket === "hub") target.hub++;
  else if (bucket === "clustered") target.clustered++;
  else if (bucket === "unclustered") target.unclustered++;
  else if (bucket === "partiallySet") target.partiallySet++;
  else if (bucket === "optedOut") target.optedOut++;
  else if (bucket === "brokenRef") target.brokenRefs++;
}

export function classifyClusterEntry(
  row: SeoIndexEntry,
  orphanIds: Set<string>,
): ClusterBucket {
  const id = `${row.content_type}/${row.slug}/${row.locale}`;
  if (row.is_pillar) return "hub";
  if (orphanIds.has(id)) return "brokenRef";
  if (row.pillar_opted_out || row.pillar_path === null) {
    return "optedOut";
  }
  const pp = typeof row.pillar_path === "string" ? row.pillar_path.trim() : "";
  if (pp) return "clustered";
  const kw = typeof row.main_keyword === "string" ? row.main_keyword.trim() : "";
  if (kw) return "partiallySet";
  return "unclustered";
}

export function resolveBrokenClusterRefReason(
  index: SeoIndex,
  row: SeoIndexEntry,
  ci: ContentIndex = contentIndex,
): BrokenClusterRefReason {
  const pp = typeof row.pillar_path === "string" ? row.pillar_path.trim() : "";
  if (!pp) return "hub_not_found";
  const id = `${row.content_type}/${row.slug}/${row.locale}`;
  if (!index.orphans.includes(id)) return "hub_not_found";
  if (index.by_path[pp]) return "hub_not_found";

  const resolver = createPublicUrlResolver(ci, { freshRedirects: true });
  const live = resolver.isLive(pp, row.locale);
  if (live) {
    const hubEntry = Object.values(index.entries).find(
      (e) => e.is_pillar && (e.path === pp || e.pillar_path === pp),
    );
    if (!hubEntry) return "hub_not_pillar";
  }
  return "hub_not_found";
}

function bumpUnclusteredGap(
  stats: ClusterBucketCounts,
  byContentType: Record<string, ClusterBucketCounts>,
  byLocale: Record<string, ClusterBucketCounts>,
  gap: MonitoredSeoGap,
): void {
  bump(stats, "unclustered");
  const ct = gap.contentType || "unknown";
  if (!byContentType[ct]) byContentType[ct] = emptyCounts();
  bump(byContentType[ct], "unclustered");
  const loc = gap.locale || "en";
  if (!byLocale[loc]) byLocale[loc] = emptyCounts();
  bump(byLocale[loc], "unclustered");
}

/**
 * @param noSignalGaps Monitored pages with no effective SEO signal (not in index entries).
 *   Opted-out index rows stay in optedOut and must not be passed here.
 */
export function computeClusterHealth(
  index: SeoIndex,
  ci: ContentIndex = contentIndex,
  noSignalGaps: MonitoredSeoGap[] = [],
): ClusterHealth {
  const orphanIds = new Set(index.orphans);
  const stats = emptyCounts();
  const byContentType: Record<string, ClusterBucketCounts> = {};
  const byLocale: Record<string, ClusterBucketCounts> = {};

  for (const row of Object.values(index.entries)) {
    const bucket = classifyClusterEntry(row, orphanIds);
    bump(stats, bucket);

    const ct = row.content_type || "unknown";
    if (!byContentType[ct]) byContentType[ct] = emptyCounts();
    bump(byContentType[ct], bucket);

    const loc = row.locale || "en";
    if (!byLocale[loc]) byLocale[loc] = emptyCounts();
    bump(byLocale[loc], bucket);
  }

  for (const gap of noSignalGaps) {
    const id = `${gap.contentType}/${gap.slug}/${gap.locale}`;
    if (index.entries[id]) continue;
    bumpUnclusteredGap(stats, byContentType, byLocale, gap);
  }

  let emptyHubCount = 0;
  for (const cluster of Object.values(index.clusters)) {
    if (!cluster.members.length) emptyHubCount++;
  }

  return { emptyHubCount, stats, byContentType, byLocale };
}

export type BrokenClusterRefRow = {
  slug: string;
  contentType: string;
  locale: string;
  path: string;
  pillar_path: string;
  filePath: string;
  main_keyword: string | null;
  reason: BrokenClusterRefReason;
};

export function listBrokenClusterRefs(
  index: SeoIndex,
  ci: ContentIndex = contentIndex,
): BrokenClusterRefRow[] {
  return index.orphans.map((id) => {
    const row = index.entries[id];
    const parts = id.split("/");
    const reason = row
      ? resolveBrokenClusterRefReason(index, row, ci)
      : ("hub_not_found" as const);
    return {
      slug: row?.slug || parts[1] || id,
      contentType: row?.content_type || parts[0] || "",
      locale: row?.locale || parts[2] || "en",
      path: row?.path || "",
      pillar_path: typeof row?.pillar_path === "string" ? row.pillar_path : "",
      filePath: row?.file || "",
      main_keyword: row?.main_keyword ?? null,
      reason,
    };
  });
}

/** Filter buckets exposed by GET /api/seo/cluster-entries (not hub/optedOut). */
export type ClusterFilterBucket =
  | "unclustered"
  | "partiallySet"
  | "brokenRefs"
  | "emptyHubs"
  | "clustered";

export const CLUSTER_FILTER_BUCKETS: readonly ClusterFilterBucket[] = [
  "unclustered",
  "partiallySet",
  "brokenRefs",
  "emptyHubs",
  "clustered",
] as const;

export type ClusterBucketEntryRow = {
  id: string;
  slug: string;
  contentType: string;
  locale: string;
  path: string;
  main_keyword: string | null;
  file: string;
  reason?: BrokenClusterRefReason;
  pillar_path?: string | null;
};

export type ListClusterBucketEntriesResult = {
  items: ClusterBucketEntryRow[];
  total: number;
  page: number;
  pageSize: number;
};

function entryToRow(
  id: string,
  row: SeoIndexEntry,
  extras?: Partial<ClusterBucketEntryRow>,
  ci: ContentIndex = contentIndex,
): ClusterBucketEntryRow {
  const base: ClusterBucketEntryRow = {
    id,
    slug: row.slug,
    contentType: row.content_type || "unknown",
    locale: row.locale || "en",
    path: row.path || "",
    main_keyword: row.main_keyword ?? null,
    file: row.file || "",
    pillar_path:
      typeof row.pillar_path === "string"
        ? row.pillar_path
        : row.pillar_path === null
          ? null
          : undefined,
    ...extras,
  };
  if (!base.path) {
    base.path =
      entryCanonicalPath(base.contentType, base.slug, base.locale, ci) || "";
  }
  return base;
}

function gapToRow(gap: MonitoredSeoGap, ci: ContentIndex = contentIndex): ClusterBucketEntryRow {
  const id = `${gap.contentType}/${gap.slug}/${gap.locale}`;
  const locale = gap.locale || "en";
  return {
    id,
    slug: gap.slug,
    contentType: gap.contentType || "unknown",
    locale,
    path: entryCanonicalPath(gap.contentType, gap.slug, locale, ci) || "",
    main_keyword: null,
    file: "",
  };
}

function matchesQuery(row: ClusterBucketEntryRow, q: string): boolean {
  if (!q) return true;
  const hay = [
    row.slug,
    row.path,
    row.contentType,
    row.locale,
    row.main_keyword ?? "",
    row.pillar_path ?? "",
    row.id,
  ]
    .join(" ")
    .toLowerCase();
  return hay.includes(q);
}

function sortBucketRows(a: ClusterBucketEntryRow, b: ClusterBucketEntryRow): number {
  const ct = a.contentType.localeCompare(b.contentType);
  if (ct !== 0) return ct;
  const sl = a.slug.localeCompare(b.slug);
  if (sl !== 0) return sl;
  return a.locale.localeCompare(b.locale);
}

function classifyToFilterBucket(bucket: ClusterBucket): ClusterFilterBucket | null {
  if (bucket === "unclustered") return "unclustered";
  if (bucket === "partiallySet") return "partiallySet";
  if (bucket === "brokenRef") return "brokenRefs";
  if (bucket === "clustered") return "clustered";
  return null;
}

/**
 * List entries for one cluster-health filter bucket, with search + pagination.
 * Unclustered includes monitored no-signal gaps (same as computeClusterHealth).
 * Clustered is spokes only (excludes hubs). Empty hubs are pillars with zero members.
 */
export function listClusterBucketEntries(
  index: SeoIndex,
  opts: {
    bucket: ClusterFilterBucket;
    q?: string;
    page?: number;
    pageSize?: number;
    ci?: ContentIndex;
    noSignalGaps?: MonitoredSeoGap[];
  },
): ListClusterBucketEntriesResult {
  const ci = opts.ci ?? contentIndex;
  const noSignalGaps = opts.noSignalGaps ?? [];
  const pageSize = Math.min(100, Math.max(1, opts.pageSize ?? 25));
  const page = Math.max(1, opts.page ?? 1);
  const q = (opts.q ?? "").trim().toLowerCase();
  const orphanIds = new Set(index.orphans);
  const rows: ClusterBucketEntryRow[] = [];

  if (opts.bucket === "emptyHubs") {
    for (const [hubId, cluster] of Object.entries(index.clusters)) {
      if (cluster.members.length > 0) continue;
      const hub = index.entries[hubId];
      if (hub) {
        rows.push(entryToRow(hubId, hub, { path: hub.path || cluster.path || "" }, ci));
      } else {
        const parts = hubId.split("/");
        const contentType = parts[0] || "unknown";
        const slug = parts[1] || hubId;
        const locale = parts[2] || "en";
        rows.push({
          id: hubId,
          slug,
          contentType,
          locale,
          path:
            cluster.path ||
            entryCanonicalPath(contentType, slug, locale, ci) ||
            "",
          main_keyword: null,
          file: "",
        });
      }
    }
  } else {
    for (const [id, row] of Object.entries(index.entries)) {
      const classified = classifyClusterEntry(row, orphanIds);
      const filterBucket = classifyToFilterBucket(classified);
      if (filterBucket !== opts.bucket) continue;
      if (opts.bucket === "brokenRefs") {
        rows.push(
          entryToRow(
            id,
            row,
            {
              reason: resolveBrokenClusterRefReason(index, row, ci),
              pillar_path: typeof row.pillar_path === "string" ? row.pillar_path : "",
            },
            ci,
          ),
        );
      } else {
        rows.push(entryToRow(id, row, undefined, ci));
      }
    }

    if (opts.bucket === "unclustered") {
      for (const gap of noSignalGaps) {
        const id = `${gap.contentType}/${gap.slug}/${gap.locale}`;
        if (index.entries[id]) continue;
        rows.push(gapToRow(gap, ci));
      }
    }
  }

  const filtered = rows.filter((r) => matchesQuery(r, q)).sort(sortBucketRows);
  const total = filtered.length;
  const start = (page - 1) * pageSize;
  const items = filtered.slice(start, start + pageSize);

  return { items, total, page, pageSize };
}

export function isClusterFilterBucket(value: string): value is ClusterFilterBucket {
  return (CLUSTER_FILTER_BUCKETS as readonly string[]).includes(value);
}
