/**
 * Pure helpers + assemblers for MCP get_organic_traffic.
 */

import type { McpWarning, NextAction } from "./respond.js";
import {
  buildOrganicPathTraffic,
  lookupPathTraffic,
  pathKeyFromUrlOrPath,
  sumPathTraffic,
  sumTrafficForPathSet,
  type OrganicDayPoint,
  type OrganicPathTraffic,
  type OrganicSiteTotals,
  type PathTrafficStats,
} from "../../server/gsc-organic-path-traffic.js";
import { buildSiteOrganicTraffic } from "../../server/gsc-organic-site-traffic.js";
import {
  ORGANIC_LEADS_BASIS,
  buildOrganicLeadsByPath,
  lookupPathLeads,
  sumPathLeads,
  windowBoundsMs,
  type OrganicLeadsByPath,
  type PathLeadStats,
} from "../../server/seo-organic-leads.js";
import {
  getClusterFromIndex,
  loadSeoIndex,
  type SeoIndex,
} from "../../server/seo-index.js";
import {
  buildOrganicOpportunities,
  type OrganicOpportunitiesResponse,
} from "../../server/seo-organic-opportunities.js";
import { contentIndex } from "../../server/content-index.js";
import {
  searchOrganicQueries,
  QUERIES_DEFAULT_LIMIT,
  QUERIES_MAX_LIMIT,
  QUERIES_DEFAULT_PAGES_PER_QUERY,
  QUERIES_MAX_PAGES_PER_QUERY,
  QUERIES_MIN_CONTAINS_LEN,
  parseOrganicQueryMatchMode,
  type OrganicQueryMatchMode,
} from "../../server/gsc-organic-query-search.js";
import {
  resolveOrganicWindow,
  ORGANIC_MAX_SPAN_DAYS,
} from "../../server/gsc-organic-window.js";

export const MAX_ORGANIC_PATHS = 50;
export const MAX_ORGANIC_HUBS = 25;
export const SERIES_BATCH_MAX = 5;
export const OPPORTUNITIES_DEFAULT_LIMIT = 25;
export const OPPORTUNITIES_MAX_LIMIT = 50;
export const LEADERBOARD_DEFAULT_LIMIT = 25;
export const LEADERBOARD_MAX_LIMIT = 50;
export {
  QUERIES_DEFAULT_LIMIT,
  QUERIES_MAX_LIMIT,
  QUERIES_DEFAULT_PAGES_PER_QUERY,
  QUERIES_MAX_PAGES_PER_QUERY,
  QUERIES_MIN_CONTAINS_LEN,
};
export { ORGANIC_MAX_SPAN_DAYS };

export type OrganicTrafficMode =
  | "site"
  | "paths"
  | "clusters"
  | "opportunities"
  | "queries"
  | "leaderboard";

export type LeaderboardSortBy = "clicks" | "impressions";

export type LeaderboardRow = {
  path: string;
  clicks: number;
  impressions: number;
  ctr: number;
  position: number;
  content_type: string | null;
  slug: string | null;
  locale: string | null;
};

export const OPPORTUNITY_KINDS = [
  "page2",
  "low_ctr",
  "link_gaps",
  "decay",
  "cannibalization",
  "missing_serp",
] as const;

export type OpportunityKind = (typeof OPPORTUNITY_KINDS)[number];

export type FlattenedOpportunityItem = Record<string, unknown> & { kind: OpportunityKind };

export function warn(code: string, message: string): McpWarning {
  return { code, message };
}

/** Trim, drop empties, dedupe preserving first-seen order. */
export function dedupeStrings(raw: string[] | undefined | null): {
  unique: string[];
  dropped: number;
} {
  const seen = new Set<string>();
  const unique: string[] = [];
  let dropped = 0;
  for (const item of raw ?? []) {
    const t = typeof item === "string" ? item.trim() : "";
    if (!t) continue;
    if (seen.has(t)) {
      dropped += 1;
      continue;
    }
    seen.add(t);
    unique.push(t);
  }
  return { unique, dropped };
}

export function validateBatchSize(
  mode: "paths" | "clusters",
  count: number,
): { ok: true } | { ok: false; message: string } {
  const max = mode === "paths" ? MAX_ORGANIC_PATHS : MAX_ORGANIC_HUBS;
  if (count < 1) {
    return {
      ok: false,
      message:
        mode === "paths"
          ? "paths must be a non-empty array (at least one public path or URL)."
          : "hub_ids must be a non-empty array (at least one hub id or pillar path).",
    };
  }
  if (count > max) {
    return {
      ok: false,
      message:
        mode === "paths"
          ? `Too many paths after dedupe (${count}). Max ${MAX_ORGANIC_PATHS} per call — split the batch.`
          : `Too many hub_ids after dedupe (${count}). Max ${MAX_ORGANIC_HUBS} per call — split the batch.`,
    };
  }
  return { ok: true };
}

export function resolveSeriesInclusion(opts: {
  mode: OrganicTrafficMode;
  include_series?: boolean;
  batchSize: number;
}): { include: boolean; warning?: McpWarning } {
  if (opts.mode === "site") {
    return { include: opts.include_series === true };
  }
  if (opts.mode !== "paths" && opts.mode !== "clusters") {
    return { include: false };
  }
  if (opts.include_series !== true) return { include: false };
  if (opts.batchSize > SERIES_BATCH_MAX) {
    return {
      include: false,
      warning: warn(
        "series_skipped_batch_too_large",
        `include_series is only applied when batch size ≤ ${SERIES_BATCH_MAX} (got ${opts.batchSize}). Totals and per-item stats are still returned.`,
      ),
    };
  }
  return { include: true };
}

export function clampOpportunitiesLimit(raw: number | undefined): number {
  if (raw == null || !Number.isFinite(raw)) return OPPORTUNITIES_DEFAULT_LIMIT;
  return Math.min(OPPORTUNITIES_MAX_LIMIT, Math.max(1, Math.floor(raw)));
}

export function clampOpportunitiesOffset(raw: number | undefined): number {
  if (raw == null || !Number.isFinite(raw)) return 0;
  return Math.max(0, Math.floor(raw));
}

export function clampLeaderboardLimit(raw: number | undefined): number {
  if (raw == null || !Number.isFinite(raw)) return LEADERBOARD_DEFAULT_LIMIT;
  return Math.min(LEADERBOARD_MAX_LIMIT, Math.max(1, Math.floor(raw)));
}

export function clampLeaderboardOffset(raw: number | undefined): number {
  if (raw == null || !Number.isFinite(raw)) return 0;
  return Math.max(0, Math.floor(raw));
}

export function parseLeaderboardSortBy(raw?: string | null): LeaderboardSortBy {
  return raw === "impressions" ? "impressions" : "clicks";
}

/** Empty/whitespace → no filter. Non-empty must normalize to a path key. */
export function resolveLeaderboardPathPrefix(
  raw?: string | null,
): { ok: true; prefix: string | null } | { ok: false; error: string } {
  if (raw == null) return { ok: true, prefix: null };
  const trimmed = typeof raw === "string" ? raw.trim() : "";
  if (!trimmed) return { ok: true, prefix: null };
  const key = pathKeyFromUrlOrPath(trimmed);
  if (!key) {
    return {
      ok: false,
      error: `path_prefix could not be normalized to a path: "${trimmed}". Pass a public path (e.g. /en/blog) or absolute URL.`,
    };
  }
  return { ok: true, prefix: key };
}

/** Exact path or descendant (`/en/blog` matches `/en/blog/x`, not `/en/blogging`). */
export function pathMatchesLeaderboardPrefix(path: string, prefix: string): boolean {
  if (path === prefix) return true;
  if (prefix === "/") return path.startsWith("/");
  return path.startsWith(`${prefix}/`);
}

export function filterByPathPrefix(
  byPath: Record<string, PathTrafficStats>,
  prefix: string | null,
): Array<{ path: string; stats: PathTrafficStats }> {
  const entries = Object.entries(byPath);
  const filtered =
    prefix == null
      ? entries
      : entries.filter(([path]) => pathMatchesLeaderboardPrefix(path, prefix));
  return filtered.map(([path, stats]) => ({ path, stats }));
}

export function sortLeaderboardEntries(
  entries: Array<{ path: string; stats: PathTrafficStats }>,
  sortBy: LeaderboardSortBy,
): Array<{ path: string; stats: PathTrafficStats }> {
  return [...entries].sort((a, b) => {
    const av = sortBy === "impressions" ? a.stats.impressions : a.stats.clicks;
    const bv = sortBy === "impressions" ? b.stats.impressions : b.stats.clicks;
    if (bv !== av) return bv - av;
    return a.path.localeCompare(b.path);
  });
}

export function leaderboardRowFromStats(
  path: string,
  stats: PathTrafficStats,
  identity?: { content_type: string | null; slug: string | null; locale: string | null },
): LeaderboardRow {
  const clicks = stats.clicks;
  const impressions = stats.impressions;
  return {
    path,
    clicks,
    impressions,
    ctr: impressions > 0 ? clicks / impressions : 0,
    position: stats.position,
    content_type: identity?.content_type ?? null,
    slug: identity?.slug ?? null,
    locale: identity?.locale ?? null,
  };
}

export function softResolveLeaderboardIdentity(path: string): {
  content_type: string | null;
  slug: string | null;
  locale: string | null;
} {
  try {
    const r = contentIndex.resolveUrl(path);
    if (!r) return { content_type: null, slug: null, locale: null };
    return {
      content_type: r.contentType ?? null,
      slug: r.slug ?? null,
      locale: contentIndex.servedLocale(r.contentType, r.slug, r.patternLocale),
    };
  } catch {
    return { content_type: null, slug: null, locale: null };
  }
}

/** Flatten Diagnostics organic cards into one ranked work queue (stable kind order). */
export function flattenOpportunityCards(
  cards: OrganicOpportunitiesResponse["cards"],
): FlattenedOpportunityItem[] {
  const out: FlattenedOpportunityItem[] = [];
  for (const kind of OPPORTUNITY_KINDS) {
    const rows = cards[kind];
    if (!Array.isArray(rows) || rows.length === 0) continue;
    for (const row of rows) {
      out.push({ kind, ...(row as Record<string, unknown>) });
    }
  }
  return out;
}

export function paginateFlat<T>(
  items: T[],
  offset: number,
  limit: number,
): { items: T[]; total: number; offset: number; next_offset: number | null } {
  const total = items.length;
  const slice = items.slice(offset, offset + limit);
  const next = offset + limit < total ? offset + limit : null;
  return { items: slice, total, offset, next_offset: next };
}

/** Soft SERP research hints when opportunities page includes missing_serp. */
export function opportunitiesMissingSerpResearchHints(opts: {
  hasMissingSerp: boolean;
  site?: string;
}): { next_actions: NextAction[]; warnings: McpWarning[] } {
  if (!opts.hasMissingSerp) return { next_actions: [], warnings: [] };
  return {
    next_actions: [
      {
        tool: "get_or_refresh_seo_research",
        priority: "optional",
        reason:
          "Refresh SERP research for a missing_serp query (action:serp). Cache-first and budgeted — separate from this read-only opportunities list.",
        args_hint: {
          action: "serp",
          ...(opts.site ? { site: opts.site } : {}),
        },
      },
    ],
    warnings: [
      warn(
        "seo_research_serp_hint",
        "Page includes missing_serp items. Optional: get_or_refresh_seo_research action:serp (does not backfill GSC days).",
      ),
    ],
  };
}

export function pathDayCacheConfigured(organic: OrganicPathTraffic): boolean {
  return organic.days_present > 0;
}

export function baseDayCacheWarnings(organic: OrganicPathTraffic): McpWarning[] {
  const warnings: McpWarning[] = [];
  if (!pathDayCacheConfigured(organic)) {
    warnings.push(
      warn(
        "organic_not_configured",
        "Organic day cache has no Search Console days loaded. Staff: Diagnostics → SEO → Organic (or Search Console settings). This is not zero traffic — data is unavailable.",
      ),
    );
  } else {
    if (organic.incomplete) {
      warnings.push(
        warn(
          "organic_incomplete_window",
          `Organic window incomplete (${organic.days_in_window}/${organic.days_expected} days with data). Totals may under-count.`,
        ),
      );
    }
    if (organic.country_less) {
      warnings.push(
        warn(
          "organic_country_less",
          "Some day files lack country dimension (pre-market cache). Market filters may be incomplete until days are rebuilt.",
        ),
      );
    }
    if (organic.truncated) {
      warnings.push(
        warn(
          "organic_truncated_day",
          "At least one day file hit the row cap; some queries/URLs may be missing.",
        ),
      );
    }
    warnings.push(
      warn(
        "organic_data_lag",
        "Search Console / BigQuery organic data typically lags 2–3 days behind live queries.",
      ),
    );
  }
  if (organic.market_warning) {
    warnings.push(warn("market_filtered", organic.market_warning));
  } else if (organic.market?.id && organic.market.id !== "worldwide") {
    warnings.push(
      warn(
        "market_filtered",
        `Results filtered to market '${organic.market.id}' (${organic.market.label || organic.market.id}).`,
      ),
    );
  }
  return warnings;
}

export function identityNonEffectWarnings(): McpWarning[] {
  return [
    warn(
      "not_gsc_inspection",
      "This tool returns GSC clicks/impressions, not URL Inspection status. Use get_entry_seo with include_search_engines:true for crawl/index status.",
    ),
    warn(
      "not_planning_volume",
      "Organic clicks are not seo.kw_monthly_volume / keyword_metrics (those are planning estimates).",
    ),
  ];
}

export function marketIgnoredWarning(mode: OrganicTrafficMode): McpWarning {
  return warn(
    "market_ignored_for_mode",
    `market applies only to paths/clusters/queries/leaderboard modes. Ignored for mode=${mode}.`,
  );
}

export function seriesIgnoredForModeWarning(mode: OrganicTrafficMode): McpWarning {
  return warn(
    "series_ignored_for_mode",
    `include_series is not applied for mode=${mode}. Daily series is omitted.`,
  );
}

export function seriesIgnoredForQueriesWarning(): McpWarning {
  return seriesIgnoredForModeWarning("queries");
}

export function siteVsPathsSourceWarning(): McpWarning {
  return warn(
    "organic_site_vs_paths_source",
    "Site totals come from BigQuery (all Search Console URLs). paths/clusters/leaderboard use the keep-filtered day cache — the same calendar window can disagree. Not a bug.",
  );
}

/** Resolve start/end for site/paths/clusters/queries/leaderboard; omit both for default 28 complete days. */
export function resolveAssembleWindow(opts: {
  start?: string;
  end?: string;
}): { ok: true; start: string; end: string; days_expected: number } | { error: string } {
  const window = resolveOrganicWindow({ start: opts.start, end: opts.end });
  if (!window.ok) return { error: window.message };
  return { ok: true, start: window.start, end: window.end, days_expected: window.days_expected };
}

/** Hard-fail message when opportunities is called with start/end. */
export function opportunitiesDatesRejectMessage(
  start?: string,
  end?: string,
): string | null {
  const datesProvided =
    (typeof start === "string" && start.trim() !== "") ||
    (typeof end === "string" && end.trim() !== "");
  if (!datesProvided) return null;
  return "start/end are not supported for mode=opportunities. Omit dates and use decay_window (7|28) instead.";
}

export type NormalizedPathBatch = {
  /** Normalized pathname keys in request order (unique). */
  keys: string[];
  /** Original input that could not be normalized to a path. */
  invalid_inputs: string[];
  duplicates_dropped: number;
};

export function normalizePathBatch(raw: string[]): NormalizedPathBatch {
  const { unique, dropped } = dedupeStrings(raw);
  const keys: string[] = [];
  const seenKeys = new Set<string>();
  const invalid_inputs: string[] = [];
  for (const input of unique) {
    const key = pathKeyFromUrlOrPath(input);
    if (!key) {
      invalid_inputs.push(input);
      continue;
    }
    if (seenKeys.has(key)) continue;
    seenKeys.add(key);
    keys.push(key);
  }
  return { keys, invalid_inputs, duplicates_dropped: dropped };
}

export function buildPathsPayload(opts: {
  organic: OrganicPathTraffic;
  keys: string[];
  invalid_inputs: string[];
  include_series: boolean;
}): {
  items: Array<{ path: string; traffic: PathTrafficStats | null }>;
  missing_paths: string[];
  selection_totals: OrganicSiteTotals;
  series?: OrganicDayPoint[];
} {
  const items: Array<{ path: string; traffic: PathTrafficStats | null }> = [];
  const missing_paths: string[] = [...opts.invalid_inputs];
  const withData = new Set<string>();
  for (const path of opts.keys) {
    const traffic = lookupPathTraffic(opts.organic.byPath, path) ?? null;
    items.push({ path, traffic });
    if (!traffic) missing_paths.push(path);
    else withData.add(path);
  }
  const selection_totals = sumTrafficForPathSet(opts.organic.byPath, withData);
  const result: {
    items: Array<{ path: string; traffic: PathTrafficStats | null }>;
    missing_paths: string[];
    selection_totals: OrganicSiteTotals;
    series?: OrganicDayPoint[];
  } = { items, missing_paths, selection_totals };
  if (opts.include_series) {
    result.series = opts.organic.series;
  }
  return result;
}

function memberPathsFromIndex(
  index: SeoIndex,
  memberIds: string[],
): Array<{ id: string; path: string }> {
  return memberIds.map((id) => {
    const row = index.entries[id];
    return { id, path: row?.path || "" };
  });
}

type ClusterPayloadItem = {
  hubId: string;
  path: string;
  hubTraffic?: PathTrafficStats;
  hubLeads?: PathLeadStats;
  clusterTraffic?: PathTrafficStats;
  clusterLeads?: PathLeadStats;
  members: Array<{ id: string; path: string; traffic?: PathTrafficStats; leads?: PathLeadStats }>;
};

const ZERO_LEADS: PathLeadStats = { organic_search: 0, not_paid: 0, tracked: 0 };

export function buildClustersPayload(opts: {
  organic: OrganicPathTraffic;
  hub_ids: string[];
  contentRoot: string;
  include_series: boolean;
  /** When set, every hub, member and cluster gets `leads` (zeros when none). */
  leadsByPath?: Record<string, PathLeadStats> | null;
}): {
  items: ClusterPayloadItem[];
  unknown_hubs: string[];
  selection_totals: OrganicSiteTotals;
  selection_leads?: PathLeadStats;
  series?: OrganicDayPoint[];
} {
  const index = loadSeoIndex(opts.contentRoot);
  const items: ClusterPayloadItem[] = [];
  const unknown_hubs: string[] = [];
  const unique_paths = new Set<string>();
  const leadsByPath = opts.leadsByPath ?? null;
  const leadsFor = (p: string): PathLeadStats =>
    (p ? lookupPathLeads(leadsByPath ?? {}, p) : undefined) ?? { ...ZERO_LEADS };

  for (const raw of opts.hub_ids) {
    const cluster = getClusterFromIndex(raw, opts.contentRoot);
    if (!cluster) {
      unknown_hubs.push(raw);
      continue;
    }
    const hubPath = cluster.path || "";
    const hubKey = hubPath ? pathKeyFromUrlOrPath(hubPath) : null;
    if (hubKey) unique_paths.add(hubKey);
    const hubTraffic = hubPath ? lookupPathTraffic(opts.organic.byPath, hubPath) : undefined;
    const memberRows = memberPathsFromIndex(index, cluster.members);
    const memberTraffics: Array<PathTrafficStats | undefined> = [];
    const memberLeads: PathLeadStats[] = [];
    const members = memberRows.map((m) => {
      const key = m.path ? pathKeyFromUrlOrPath(m.path) : null;
      if (key) unique_paths.add(key);
      const traffic = m.path ? lookupPathTraffic(opts.organic.byPath, m.path) : undefined;
      memberTraffics.push(traffic);
      const leads = leadsByPath ? leadsFor(m.path) : undefined;
      if (leads) memberLeads.push(leads);
      return { id: m.id, path: m.path, ...(traffic ? { traffic } : {}), ...(leads ? { leads } : {}) };
    });
    const clusterTraffic = sumPathTraffic([hubTraffic, ...memberTraffics]);
    const hubLeads = leadsByPath ? leadsFor(hubPath) : undefined;
    const clusterLeads = hubLeads ? sumPathLeads([hubLeads, ...memberLeads]) : undefined;
    items.push({
      hubId: cluster.hubId,
      path: hubPath,
      ...(hubTraffic ? { hubTraffic } : {}),
      ...(hubLeads ? { hubLeads } : {}),
      ...(clusterTraffic ? { clusterTraffic } : {}),
      ...(clusterLeads ? { clusterLeads } : {}),
      members,
    });
  }

  const selection_totals = sumTrafficForPathSet(opts.organic.byPath, unique_paths);
  const result: {
    items: typeof items;
    unknown_hubs: string[];
    selection_totals: OrganicSiteTotals;
    selection_leads?: PathLeadStats;
    series?: OrganicDayPoint[];
  } = { items, unknown_hubs, selection_totals };
  if (leadsByPath) {
    result.selection_leads = sumPathLeads([...unique_paths].map((p) => leadsFor(p))) ?? { ...ZERO_LEADS };
  }
  if (opts.include_series) {
    result.series = opts.organic.series;
  }
  return result;
}

export type OrganicAssembleResult = {
  payload: Record<string, unknown>;
  warnings: McpWarning[];
  next_actions: NextAction[];
};

function unconfiguredNextActions(site?: string): NextAction[] {
  return [
    {
      tool: "explain_site",
      priority: "recommended",
      reason: "Organic traffic setup and how it differs from inspection / planning volume",
      args_hint: { topic: "seo", ...(site ? { site } : {}) },
    },
  ];
}

function missingPathsNextActions(site?: string): NextAction[] {
  return [
    {
      tool: "get_entry_seo",
      priority: "recommended",
      reason:
        "Resolve live public urls for the entry (paths only — not slug). Retry get_organic_traffic with urls[locale].",
      args_hint: { ...(site ? { site } : {}) },
    },
  ];
}

export async function assembleSiteMode(opts: {
  contentRoot: string;
  contentFolder: string;
  include_series?: boolean;
  marketProvided?: boolean;
  start?: string;
  end?: string;
  site?: string;
}): Promise<OrganicAssembleResult | { error: string }> {
  const window = resolveAssembleWindow({ start: opts.start, end: opts.end });
  if ("error" in window) return { error: window.error };

  const datesProvided =
    (typeof opts.start === "string" && opts.start.trim() !== "") ||
    (typeof opts.end === "string" && opts.end.trim() !== "");

  const siteTraffic = await buildSiteOrganicTraffic({
    contentRoot: opts.contentRoot,
    contentFolder: opts.contentFolder,
    start: window.start,
    end: window.end,
  });
  const warnings: McpWarning[] = [...identityNonEffectWarnings()];
  if (opts.marketProvided) warnings.push(marketIgnoredWarning("site"));
  if (datesProvided) warnings.push(siteVsPathsSourceWarning());

  const configured = siteTraffic.configured;
  if (!configured) {
    warnings.push(
      warn(
        "organic_not_configured",
        siteTraffic.error ||
          "Search Console BigQuery is not configured for site-wide organic totals. Staff: SEO/GEO → Search Console.",
      ),
    );
  } else {
    warnings.push(
      warn(
        "organic_data_lag",
        "Search Console / BigQuery organic data typically lags 2–3 days behind live queries.",
      ),
    );
    if (siteTraffic.incomplete) {
      warnings.push(
        warn(
          "organic_incomplete_window",
          `Site organic window incomplete (${siteTraffic.days_in_window}/${siteTraffic.days_expected} days).`,
        ),
      );
    }
    if (siteTraffic.error) {
      warnings.push(warn("organic_site_error", siteTraffic.error));
    }
  }

  const includeSeries = opts.include_series === true;
  const payload: Record<string, unknown> = {
    mode: "site",
    configured,
    source: siteTraffic.source,
    window: siteTraffic.window,
    days_in_window: siteTraffic.days_in_window,
    days_expected: siteTraffic.days_expected,
    incomplete: siteTraffic.incomplete,
    totals: siteTraffic.totals,
    ...(includeSeries ? { series: siteTraffic.series } : {}),
    ...(siteTraffic.error ? { error: siteTraffic.error } : {}),
  };

  return {
    payload,
    warnings,
    next_actions: configured ? [] : unconfiguredNextActions(opts.site),
  };
}

export function assemblePathsMode(opts: {
  contentRoot: string;
  contentFolder: string;
  paths: string[];
  market?: string;
  include_series?: boolean;
  start?: string;
  end?: string;
  site?: string;
}): OrganicAssembleResult | { error: string } {
  const window = resolveAssembleWindow({ start: opts.start, end: opts.end });
  if ("error" in window) return { error: window.error };

  const { unique, dropped } = dedupeStrings(opts.paths);
  const sizeCheck = validateBatchSize("paths", unique.length);
  if (!sizeCheck.ok) return { error: sizeCheck.message };

  const normalized = normalizePathBatch(unique);
  // unique already deduped; normalizePathBatch may collapse URL+path to same key
  const keyCollapseDropped = unique.length - normalized.keys.length - normalized.invalid_inputs.length;

  const seriesGate = resolveSeriesInclusion({
    mode: "paths",
    include_series: opts.include_series,
    batchSize: unique.length,
  });

  const organic = buildOrganicPathTraffic({
    contentFolder: opts.contentFolder,
    contentRoot: opts.contentRoot,
    market: opts.market,
    start: window.start,
    end: window.end,
    kpiPaths: seriesGate.include ? new Set(normalized.keys) : null,
  });

  const pathsPayload = buildPathsPayload({
    organic,
    keys: normalized.keys,
    invalid_inputs: normalized.invalid_inputs,
    include_series: seriesGate.include,
  });

  const warnings: McpWarning[] = [
    ...identityNonEffectWarnings(),
    ...baseDayCacheWarnings(organic),
  ];
  const totalDropped = dropped + Math.max(0, keyCollapseDropped);
  if (totalDropped > 0) {
    warnings.push(
      warn(
        "duplicates_dropped",
        `Removed ${totalDropped} duplicate path(s) before lookup.`,
      ),
    );
  }
  if (seriesGate.warning) warnings.push(seriesGate.warning);
  if (pathsPayload.missing_paths.length > 0) {
    warnings.push(
      warn(
        "partial_batch",
        `${pathsPayload.missing_paths.length} path(s) have no organic traffic in the window (or could not be normalized). Use public paths/URLs from get_entry_seo.urls — not slugs.`,
      ),
    );
  }

  const configured = pathDayCacheConfigured(organic);
  const next_actions: NextAction[] = [];
  if (!configured) next_actions.push(...unconfiguredNextActions(opts.site));
  else if (pathsPayload.missing_paths.length > 0) {
    next_actions.push(...missingPathsNextActions(opts.site));
  }

  return {
    payload: {
      mode: "paths",
      configured,
      source: configured ? "day_cache" : "none",
      window: organic.window,
      days_present: organic.days_present,
      days_in_window: organic.days_in_window,
      days_expected: organic.days_expected,
      incomplete: organic.incomplete,
      country_less: organic.country_less,
      truncated: organic.truncated,
      market: organic.market,
      markets: organic.markets,
      ...(organic.market_warning ? { market_warning: organic.market_warning } : {}),
      items: pathsPayload.items,
      missing_paths: pathsPayload.missing_paths,
      selection_totals: pathsPayload.selection_totals,
      ...(pathsPayload.series ? { series: pathsPayload.series } : {}),
    },
    warnings,
    next_actions,
  };
}

/** Warnings for the clusters-mode `leads` fields (partly tracked window, missing country, unavailable). */
export function organicLeadsWarnings(opts: {
  leads: OrganicLeadsByPath | null;
  leadsError?: string | null;
  window: { start: string; end: string } | null;
}): McpWarning[] {
  if (!opts.window) return [];
  if (!opts.leads) {
    return [
      warn(
        "organic_leads_unavailable",
        `Lead counts unavailable (${opts.leadsError ?? "lead ledger not readable"}); leads fields omitted. Clicks are unaffected.`,
      ),
    ];
  }
  const out: McpWarning[] = [];
  const bounds = windowBoundsMs(opts.window);
  const since = opts.leads.tracking_since;
  if (since == null) {
    out.push(
      warn(
        "organic_leads_not_tracked",
        "No lead has a traffic channel yet: leads.*.organic_search is 0 and not_paid counts every non-paid lead by first landing page (upper bound).",
      ),
    );
  } else if (bounds && since > bounds.startMs) {
    out.push(
      warn(
        "organic_leads_partly_tracked",
        `Channel tracking started ${new Date(since).toISOString().slice(0, 10)}, inside the window. Leads before it have no channel: use leads.*.not_paid (est., upper bound) over organic_search for this window.`,
      ),
    );
  }
  if (opts.leads.estimated) {
    out.push(
      warn(
        "organic_leads_estimated",
        "leads.estimated=true: some leads in the window are untracked or (market set) have no country. not_paid is the estimate the Cluster Map shows with 'est.'.",
      ),
    );
  }
  return out;
}

export function assembleClustersMode(opts: {
  contentRoot: string;
  contentFolder: string;
  hub_ids: string[];
  market?: string;
  include_series?: boolean;
  start?: string;
  end?: string;
  site?: string;
}): OrganicAssembleResult | { error: string } {
  const window = resolveAssembleWindow({ start: opts.start, end: opts.end });
  if ("error" in window) return { error: window.error };

  const { unique, dropped } = dedupeStrings(opts.hub_ids);
  const sizeCheck = validateBatchSize("clusters", unique.length);
  if (!sizeCheck.ok) return { error: sizeCheck.message };

  const seriesGate = resolveSeriesInclusion({
    mode: "clusters",
    include_series: opts.include_series,
    batchSize: unique.length,
  });

  // Collect paths for series KPI when needed (after resolve — build twice would be wasteful;
  // series uses kpiPaths of unique cluster paths after we know hubs — build organic full first).
  const organic = buildOrganicPathTraffic({
    contentFolder: opts.contentFolder,
    contentRoot: opts.contentRoot,
    market: opts.market,
    start: window.start,
    end: window.end,
  });

  let leads: OrganicLeadsByPath | null = null;
  let leadsError: string | null = null;
  try {
    leads = buildOrganicLeadsByPath({ site: opts.contentFolder, window: organic.window, market: organic.market });
  } catch (err) {
    leadsError = err instanceof Error ? err.message : String(err);
  }

  let clustersPayload = buildClustersPayload({
    organic,
    hub_ids: unique,
    contentRoot: opts.contentRoot,
    include_series: false,
    leadsByPath: leads?.byPath ?? null,
  });

  if (seriesGate.include) {
    const organicScoped = buildOrganicPathTraffic({
      contentFolder: opts.contentFolder,
      contentRoot: opts.contentRoot,
      market: opts.market,
      kpiPaths: new Set(
        [...clustersPayload.items.flatMap((c) => {
          const paths = [c.path, ...c.members.map((m) => m.path)].filter(Boolean);
          return paths.map((p) => pathKeyFromUrlOrPath(p)).filter((k): k is string => Boolean(k));
        })],
      ),
    });
    clustersPayload = {
      ...buildClustersPayload({
        organic: organicScoped,
        hub_ids: unique,
        contentRoot: opts.contentRoot,
        include_series: true,
        leadsByPath: leads?.byPath ?? null,
      }),
    };
  }

  const warnings: McpWarning[] = [
    ...identityNonEffectWarnings(),
    ...baseDayCacheWarnings(organic),
  ];
  if (dropped > 0) {
    warnings.push(warn("duplicates_dropped", `Removed ${dropped} duplicate hub_id(s) before lookup.`));
  }
  if (seriesGate.warning) warnings.push(seriesGate.warning);
  if (clustersPayload.unknown_hubs.length > 0) {
    warnings.push(
      warn(
        "partial_batch",
        `${clustersPayload.unknown_hubs.length} hub_id(s) not found in seo-index. Other hubs returned.`,
      ),
    );
  }
  if (clustersPayload.items.length > 0) {
    warnings.push(
      warn(
        "selection_not_site",
        "selection_totals sums unique paths across the requested hubs only — not whole-site organic. Use mode=site for site KPIs.",
      ),
    );
  }

  warnings.push(...organicLeadsWarnings({ leads, leadsError, window: organic.window }));

  const configured = pathDayCacheConfigured(organic);
  const next_actions: NextAction[] = configured ? [] : unconfiguredNextActions(opts.site);

  return {
    payload: {
      mode: "clusters",
      leads: {
        available: leads != null,
        tracking_since: leads?.tracking_since ?? null,
        estimated: leads?.estimated ?? false,
        basis: ORGANIC_LEADS_BASIS,
        ...(clustersPayload.selection_leads ? { selection_totals: clustersPayload.selection_leads } : {}),
      },
      configured,
      source: configured ? "day_cache" : "none",
      window: organic.window,
      days_present: organic.days_present,
      days_in_window: organic.days_in_window,
      days_expected: organic.days_expected,
      incomplete: organic.incomplete,
      country_less: organic.country_less,
      truncated: organic.truncated,
      market: organic.market,
      markets: organic.markets,
      ...(organic.market_warning ? { market_warning: organic.market_warning } : {}),
      items: clustersPayload.items,
      unknown_hubs: clustersPayload.unknown_hubs,
      selection_totals: clustersPayload.selection_totals,
      ...(clustersPayload.series ? { series: clustersPayload.series } : {}),
    },
    warnings,
    next_actions,
  };
}

export async function assembleOpportunitiesMode(opts: {
  contentRoot: string;
  contentFolder: string;
  decay_window?: 7 | 28;
  opportunities_limit?: number;
  opportunities_offset?: number;
  marketProvided?: boolean;
  site?: string;
}): Promise<OrganicAssembleResult> {
  const decayWindow = opts.decay_window === 28 ? 28 : 7;
  const limit = clampOpportunitiesLimit(opts.opportunities_limit);
  const offset = clampOpportunitiesOffset(opts.opportunities_offset);

  const data = await buildOrganicOpportunities({
    contentRoot: opts.contentRoot,
    contentFolder: opts.contentFolder,
    decayWindow,
    pullLatest: false,
    isKnownUrl: (p) => contentIndex.isKnownUrl(p),
    resolveUrl: (p) => {
      const r = contentIndex.resolveUrl(p);
      if (!r) return null;
      return {
        contentType: r.contentType,
        slug: r.slug,
        patternLocale: contentIndex.servedLocale(r.contentType, r.slug, r.patternLocale),
      };
    },
    site: opts.contentFolder,
  });

  const flat = flattenOpportunityCards(data.cards);
  const page = paginateFlat(flat, offset, limit);

  const warnings: McpWarning[] = [
    ...identityNonEffectWarnings(),
    warn(
      "opportunities_read_only",
      "Read-only opportunities from organic day cache. Does not backfill Search Console days. SERP refresh uses get_or_refresh_seo_research (budgeted), not this tool.",
    ),
  ];
  if (opts.marketProvided) warnings.push(marketIgnoredWarning("opportunities"));

  const configured = data.bq_configured || data.days_present > 0;
  if (!configured) {
    warnings.push(
      warn(
        "organic_not_configured",
        "No Search Console organic days / BigQuery configured. Staff: Diagnostics → SEO → Organic.",
      ),
    );
  } else {
    warnings.push(
      warn(
        "organic_data_lag",
        "Search Console / BigQuery organic data typically lags 2–3 days behind live queries.",
      ),
    );
  }

  const next_actions = configured ? [] : unconfiguredNextActions(opts.site);
  if (configured) {
    const hints = opportunitiesMissingSerpResearchHints({
      hasMissingSerp: page.items.some((it) => it.kind === "missing_serp"),
      site: opts.site,
    });
    next_actions.push(...hints.next_actions);
    warnings.push(...hints.warnings);
  }

  return {
    payload: {
      mode: "opportunities",
      configured,
      source: data.days_present > 0 ? "day_cache" : data.bq_configured ? "bigquery" : "none",
      decay_window: decayWindow,
      bq_configured: data.bq_configured,
      openrush_configured: data.openrush_configured,
      days_present: data.days_present,
      days_expected: data.days_expected,
      data_through: data.data_through,
      windows: data.windows,
      keep_rules_stale: data.keep_rules_stale,
      serp_incomplete: data.serp_incomplete,
      items: page.items,
      total: page.total,
      offset: page.offset,
      next_offset: page.next_offset,
      opportunities_limit: limit,
    },
    warnings,
    next_actions,
  };
}

export async function assembleQueriesMode(opts: {
  contentRoot: string;
  contentFolder: string;
  query_contains: string;
  match?: OrganicQueryMatchMode | string;
  start?: string;
  end?: string;
  market?: string;
  limit?: number;
  offset?: number;
  pages_per_query?: number;
  include_series?: boolean;
  site?: string;
}): Promise<OrganicAssembleResult | { error: string }> {
  const result = await searchOrganicQueries({
    contentRoot: opts.contentRoot,
    contentFolder: opts.contentFolder,
    queryContains: opts.query_contains,
    match: parseOrganicQueryMatchMode(opts.match),
    start: opts.start,
    end: opts.end,
    market: opts.market,
    limit: opts.limit,
    offset: opts.offset,
    pagesPerQuery: opts.pages_per_query,
  });
  if (!("items" in result)) {
    return { error: result.error };
  }
  const data = result;

  const warnings: McpWarning[] = [...identityNonEffectWarnings()];
  if (opts.include_series === true) warnings.push(seriesIgnoredForQueriesWarning());

  if (!data.configured) {
    warnings.push(
      warn(
        "organic_not_configured",
        data.error ||
          "Search Console BigQuery is not configured and organic day cache is empty. Staff: Diagnostics → SEO → Organic.",
      ),
    );
  } else {
    warnings.push(
      warn(
        "organic_data_lag",
        "Search Console / BigQuery organic data typically lags 2–3 days behind live queries.",
      ),
    );
    if (data.source === "day_cache" || data.notes.includes("organic_from_day_cache")) {
      warnings.push(
        warn(
          "organic_from_day_cache",
          "Results came from the keep-filtered day cache (BigQuery unavailable or failed). Long-tail queries may be missing vs the full GSC export / UI.",
        ),
      );
    }
    if (data.incomplete) {
      warnings.push(
        warn(
          "organic_incomplete_window",
          `Organic window incomplete (${data.days_in_window}/${data.days_expected} days with data). Totals may under-count.`,
        ),
      );
    }
    if (data.truncated) {
      warnings.push(
        warn(
          "organic_truncated_rows",
          "Query×URL result hit the row cap; some matches may be missing. Narrow query_contains or the date range.",
        ),
      );
    }
    if (data.total === 0) {
      warnings.push(
        warn(
          "queries_no_matches",
          `No organic queries matched "${data.match.query_contains}" (${data.match.match}) in the window.`,
        ),
      );
    }
    if (data.market_warning) {
      warnings.push(warn("market_filtered", data.market_warning));
    } else if (data.market?.id && data.market.id !== "worldwide") {
      warnings.push(
        warn(
          "market_filtered",
          `Results filtered to market '${data.market.id}' (${data.market.label || data.market.id}).`,
        ),
      );
    }
  }

  const next_actions: NextAction[] = [];
  if (!data.configured) {
    next_actions.push(...unconfiguredNextActions(opts.site));
  } else if (data.items.length > 0) {
    const firstPath = data.items[0]?.pages.find((p) => p.path)?.path;
    if (firstPath) {
      next_actions.push({
        tool: "get_organic_traffic",
        priority: "optional",
        reason: "Get path-level traffic for a landing URL from this query search",
        args_hint: { mode: "paths", paths: [firstPath], ...(opts.site ? { site: opts.site } : {}) },
      });
    }
  }

  return {
    payload: {
      mode: "queries",
      configured: data.configured,
      source: data.source,
      window: data.window,
      days_in_window: data.days_in_window,
      days_expected: data.days_expected,
      incomplete: data.incomplete,
      truncated: data.truncated,
      market: data.market,
      markets: data.markets,
      ...(data.market_warning ? { market_warning: data.market_warning } : {}),
      match: data.match,
      items: data.items,
      selection_totals: data.selection_totals,
      total: data.total,
      offset: data.offset,
      next_offset: data.next_offset,
      pages_per_query: data.pages_per_query,
      limit: data.limit,
      ...(data.error ? { error: data.error } : {}),
    },
    warnings,
    next_actions,
  };
}

export function assembleLeaderboardMode(opts: {
  contentRoot: string;
  contentFolder: string;
  sort_by?: string | null;
  path_prefix?: string | null;
  market?: string;
  include_series?: boolean;
  start?: string;
  end?: string;
  limit?: number;
  offset?: number;
  site?: string;
}): OrganicAssembleResult | { error: string } {
  const window = resolveAssembleWindow({ start: opts.start, end: opts.end });
  if ("error" in window) return { error: window.error };

  const prefixResult = resolveLeaderboardPathPrefix(opts.path_prefix);
  if (!prefixResult.ok) return { error: prefixResult.error };

  const sortBy = parseLeaderboardSortBy(opts.sort_by);
  const limit = clampLeaderboardLimit(opts.limit);
  const offset = clampLeaderboardOffset(opts.offset);

  const datesProvided =
    (typeof opts.start === "string" && opts.start.trim() !== "") ||
    (typeof opts.end === "string" && opts.end.trim() !== "");

  const organic = buildOrganicPathTraffic({
    contentFolder: opts.contentFolder,
    contentRoot: opts.contentRoot,
    market: opts.market,
    start: window.start,
    end: window.end,
  });

  const filtered = filterByPathPrefix(organic.byPath, prefixResult.prefix);
  const sorted = sortLeaderboardEntries(filtered, sortBy);
  const selection_totals = sumTrafficForPathSet(
    organic.byPath,
    new Set(sorted.map((e) => e.path)),
  );
  const page = paginateFlat(sorted, offset, limit);
  const items: LeaderboardRow[] = page.items.map(({ path, stats }) =>
    leaderboardRowFromStats(path, stats, softResolveLeaderboardIdentity(path)),
  );

  const warnings: McpWarning[] = [
    ...identityNonEffectWarnings(),
    ...baseDayCacheWarnings(organic),
  ];
  if (datesProvided) warnings.push(siteVsPathsSourceWarning());
  if (opts.include_series === true) warnings.push(seriesIgnoredForModeWarning("leaderboard"));
  warnings.push(
    warn(
      "leaderboard_day_cache_universe",
      "Leaderboard ranks top paths present in the keep-filtered organic day cache for this window only — not every CMS page, and not a zero-traffic finder. Use offset to page further down.",
    ),
  );
  if (prefixResult.prefix != null && sorted.length === 0 && pathDayCacheConfigured(organic)) {
    warnings.push(
      warn(
        "path_prefix_no_matches",
        `No day-cache paths matched path_prefix "${prefixResult.prefix}" in the window.`,
      ),
    );
  }

  const configured = pathDayCacheConfigured(organic);

  return {
    payload: {
      mode: "leaderboard",
      configured,
      source: configured ? "day_cache" : "none",
      window: organic.window,
      days_in_window: organic.days_in_window,
      days_expected: organic.days_expected,
      incomplete: organic.incomplete,
      market: organic.market,
      markets: organic.markets,
      ...(organic.market_warning ? { market_warning: organic.market_warning } : {}),
      sort_by: sortBy,
      path_prefix: prefixResult.prefix,
      items,
      selection_totals,
      total: page.total,
      offset: page.offset,
      next_offset: page.next_offset,
      limit,
    },
    warnings,
    next_actions: configured ? [] : unconfiguredNextActions(opts.site),
  };
}
