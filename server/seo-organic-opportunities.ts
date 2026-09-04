import { getReferrersForTargetPath } from "./link-index";
import {
  expectedCtrForPosition,
  KEEP_RULES_VERSION,
  normalizePageUrl,
  type GscDayRow,
} from "./gsc-keep-filter";
import {
  anyKeepRulesStale,
  completeDataDates,
  ingestLatestCompleteDay,
  listOrganicDayDates,
  loadDaysRange,
  ORGANIC_RETENTION_DAYS,
} from "./gsc-organic-days";
import { getGscBigQueryConfigStatus } from "./gsc-bigquery-client";
import { getOpenRushSettings } from "./settings";
import { loadSerpCache, rankOfUrlInOrganic, serpEntryFresh, type OpenRushSerpEntry } from "./openrush-serp-cache";
import { getDefaultContentFolder } from "./site-config";
import { countEntryActivityWrites } from "./seo-cluster-metrics";

const PAGE2_MIN = 11;
const PAGE2_MAX = 20;
const CTR_GAP_RATIO = 0.5;
const CTR_MIN_IMPRESSIONS = 100;
const LINK_POS_MAX = 20;
const LINK_POS_MIN = 4;
const LOW_INBOUND = 3;
const CANNIBAL_MIN_IMPRESSIONS = 20;
const CARD_ROW_LIMIT = 25;

export type AggregatedGscRow = {
  query: string;
  url: string;
  clicks: number;
  impressions: number;
  position: number;
  ctr: number;
};

export type WithCmsKnown<T extends { url: string }> = T & { cms_known: boolean };

export type WithCmsActivity<T extends { url: string }> = T & {
  cms_known: boolean;
  entry_key: string | null;
  write_count: number;
};

export type OrganicResolveUrlResult = {
  contentType: string;
  slug: string;
  patternLocale?: string;
} | null;

/** Pathname for contentIndex.isKnownUrl (GSC rows are often absolute URLs). */
export function gscUrlToPath(url: string): string {
  const trimmed = url.trim();
  if (!trimmed) return "/";
  // Path-only: do not pass through normalizePageUrl (it would treat "en" as hostname).
  if (trimmed.startsWith("/")) {
    return trimmed.split("?")[0]!.split("#")[0]!.replace(/\/+$/, "") || "/";
  }
  const n = normalizePageUrl(trimmed);
  if (n?.path) return n.path;
  try {
    return new URL(trimmed).pathname.replace(/\/+$/, "") || "/";
  } catch {
    const path = trimmed.split("?")[0]?.split("#")[0] || trimmed;
    return path.startsWith("/") ? path.replace(/\/+$/, "") || "/" : `/${path}`;
  }
}

/** Build type/slug/locale from contentIndex.resolveUrl shape. */
export function entryKeyFromResolvedUrl(resolved: {
  contentType: string;
  slug: string;
  patternLocale?: string;
}): string {
  const locale =
    !resolved.patternLocale || resolved.patternLocale === "default"
      ? "en"
      : resolved.patternLocale;
  return `${resolved.contentType}/${resolved.slug}/${locale}`;
}

export function enrichCmsKnown<T extends { url: string }>(
  rows: T[],
  isKnownUrl: (path: string) => boolean,
): Array<WithCmsKnown<T>> {
  return rows.map((r) => ({
    ...r,
    cms_known: isKnownUrl(gscUrlToPath(r.url)),
  }));
}

/** cms_known + optional entry_key / write_count for Ask Agent activity gate. */
export function enrichCmsActivity<T extends { url: string }>(
  rows: T[],
  opts: {
    isKnownUrl: (path: string) => boolean;
    resolveUrl?: (path: string) => OrganicResolveUrlResult;
    writeCounts?: Map<string, number>;
  },
): Array<WithCmsActivity<T>> {
  return rows.map((r) => {
    const path = gscUrlToPath(r.url);
    const cms_known = opts.isKnownUrl(path);
    if (!cms_known || !opts.resolveUrl) {
      return { ...r, cms_known, entry_key: null, write_count: 0 };
    }
    const resolved = opts.resolveUrl(path);
    if (!resolved?.contentType || !resolved.slug) {
      return { ...r, cms_known, entry_key: null, write_count: 0 };
    }
    const entry_key = entryKeyFromResolvedUrl(resolved);
    const write_count = opts.writeCounts?.get(entry_key) ?? 0;
    return { ...r, cms_known, entry_key, write_count };
  });
}

export function aggregateDayRows(days: { rows: GscDayRow[] }[]): AggregatedGscRow[] {
  const map = new Map<string, { query: string; url: string; clicks: number; impressions: number; sum_position: number }>();
  for (const day of days) {
    for (const r of day.rows) {
      const key = `${r.query}\0${r.url}`;
      const cur = map.get(key) || {
        query: r.query,
        url: r.url,
        clicks: 0,
        impressions: 0,
        sum_position: 0,
      };
      cur.clicks += r.clicks;
      cur.impressions += r.impressions;
      cur.sum_position += r.sum_position;
      map.set(key, cur);
    }
  }
  return [...map.values()].map((r) => ({
    query: r.query,
    url: r.url,
    clicks: r.clicks,
    impressions: r.impressions,
    position: r.impressions > 0 ? r.sum_position / r.impressions : 0,
    ctr: r.impressions > 0 ? r.clicks / r.impressions : 0,
  }));
}

export function classifyPage2(rows: AggregatedGscRow[]): AggregatedGscRow[] {
  return rows
    .filter((r) => r.query.trim() && r.position >= PAGE2_MIN && r.position <= PAGE2_MAX)
    .sort((a, b) => b.impressions - a.impressions)
    .slice(0, CARD_ROW_LIMIT);
}

export function classifyLowCtr(rows: AggregatedGscRow[]): Array<AggregatedGscRow & { expected_ctr: number; gap: number }> {
  const out: Array<AggregatedGscRow & { expected_ctr: number; gap: number }> = [];
  for (const r of rows) {
    if (!r.query.trim()) continue;
    if (r.impressions < CTR_MIN_IMPRESSIONS) continue;
    if (r.position <= 0 || r.position > 10) continue;
    const expected_ctr = expectedCtrForPosition(r.position);
    if (r.ctr >= expected_ctr * CTR_GAP_RATIO) continue;
    out.push({ ...r, expected_ctr, gap: expected_ctr - r.ctr });
  }
  return out
    .sort((a, b) => b.impressions * b.gap - a.impressions * a.gap)
    .slice(0, CARD_ROW_LIMIT);
}

export function classifyCannibalization(rows: AggregatedGscRow[]): Array<{
  query: string;
  impressions: number;
  urls: Array<{ url: string; clicks: number; impressions: number; position: number }>;
}> {
  const byQuery = new Map<string, AggregatedGscRow[]>();
  for (const r of rows) {
    const q = r.query.trim();
    if (!q) continue;
    if (r.impressions < CANNIBAL_MIN_IMPRESSIONS) continue;
    const list = byQuery.get(q) || [];
    list.push(r);
    byQuery.set(q, list);
  }
  const groups: Array<{
    query: string;
    impressions: number;
    urls: Array<{ url: string; clicks: number; impressions: number; position: number }>;
  }> = [];
  for (const [query, list] of byQuery) {
    const uniqueUrls = new Map<string, AggregatedGscRow>();
    for (const r of list) uniqueUrls.set(r.url, r);
    if (uniqueUrls.size < 2) continue;
    const urls = [...uniqueUrls.values()].sort((a, b) => b.impressions - a.impressions);
    groups.push({
      query,
      impressions: urls.reduce((s, u) => s + u.impressions, 0),
      urls: urls.map((u) => ({
        url: u.url,
        clicks: u.clicks,
        impressions: u.impressions,
        position: u.position,
      })),
    });
  }
  return groups.sort((a, b) => b.impressions - a.impressions).slice(0, CARD_ROW_LIMIT);
}

export function classifyDecay(
  current: AggregatedGscRow[],
  prior: AggregatedGscRow[],
): Array<{ url: string; clicks: number; impressions: number; prior_clicks: number; prior_impressions: number; click_drop: number }> {
  const curByUrl = new Map<string, { clicks: number; impressions: number }>();
  for (const r of current) {
    const cur = curByUrl.get(r.url) || { clicks: 0, impressions: 0 };
    cur.clicks += r.clicks;
    cur.impressions += r.impressions;
    curByUrl.set(r.url, cur);
  }
  const priorByUrl = new Map<string, { clicks: number; impressions: number }>();
  for (const r of prior) {
    const cur = priorByUrl.get(r.url) || { clicks: 0, impressions: 0 };
    cur.clicks += r.clicks;
    cur.impressions += r.impressions;
    priorByUrl.set(r.url, cur);
  }
  const out: Array<{
    url: string;
    clicks: number;
    impressions: number;
    prior_clicks: number;
    prior_impressions: number;
    click_drop: number;
  }> = [];
  for (const [url, now] of curByUrl) {
    const was = priorByUrl.get(url);
    if (!was) continue;
    const click_drop = was.clicks - now.clicks;
    if (click_drop <= 0 && was.impressions - now.impressions <= 0) continue;
    out.push({
      url,
      clicks: now.clicks,
      impressions: now.impressions,
      prior_clicks: was.clicks,
      prior_impressions: was.impressions,
      click_drop: Math.max(click_drop, was.impressions - now.impressions),
    });
  }
  return out.sort((a, b) => b.click_drop - a.click_drop).slice(0, CARD_ROW_LIMIT);
}

export function classifyLinkGaps(
  rows: AggregatedGscRow[],
  contentRoot?: string,
): Array<AggregatedGscRow & { inbound: number }> {
  const byUrl = new Map<string, AggregatedGscRow>();
  for (const r of rows) {
    if (r.position < LINK_POS_MIN || r.position > LINK_POS_MAX) continue;
    const existing = byUrl.get(r.url);
    if (!existing || r.impressions > existing.impressions) byUrl.set(r.url, r);
  }
  const out: Array<AggregatedGscRow & { inbound: number }> = [];
  for (const r of byUrl.values()) {
    const loc = normalizePageUrl(r.url);
    const path = loc?.path || r.url;
    let inbound = 0;
    try {
      inbound = getReferrersForTargetPath(path, contentRoot, { limit: 5 }).count;
    } catch {
      continue;
    }
    if (inbound >= LOW_INBOUND) continue;
    out.push({ ...r, inbound });
  }
  return out.sort((a, b) => b.impressions - a.impressions).slice(0, CARD_ROW_LIMIT);
}

export type SerpOpportunityRow = AggregatedGscRow & {
  our_serp_rank: number | null;
  visible_in_serp: boolean | null;
  featured_snippet_url: string | null;
  has_paa: boolean;
  serp_fetched: boolean;
  serp_stale: boolean;
  alt_urls: string[];
};

export function classifyMissingSerp(
  rows: AggregatedGscRow[],
  serp: Record<string, OpenRushSerpEntry>,
  now = Date.now(),
): SerpOpportunityRow[] {
  const page1 = rows.filter((r) => r.query.trim() && r.position > 0 && r.position <= 10);
  const byQuery = new Map<string, AggregatedGscRow[]>();
  for (const r of page1) {
    const list = byQuery.get(r.query) || [];
    list.push(r);
    byQuery.set(r.query, list);
  }
  const out: SerpOpportunityRow[] = [];
  for (const [query, list] of byQuery) {
    list.sort((a, b) => b.impressions - a.impressions);
    const primary = list[0]!;
    const alt_urls = list.slice(1).map((r) => r.url);
    const entry = serp[query];
    const fetched = Boolean(entry);
    const stale = fetched ? !serpEntryFresh(entry, now) : false;
    const organic = entry?.organic || [];
    const ourRank = organic.length ? rankOfUrlInOrganic(primary.url, organic) : entry?.our_serp_rank ?? null;
    const visible = fetched ? ourRank != null : null;
    const snippetUrl = entry?.featured_snippet_url || null;
    const weOwnSnippet = snippetUrl
      ? normalizePageUrl(snippetUrl)?.path === normalizePageUrl(primary.url)?.path
      : false;
    const missingFeature = fetched && Boolean(snippetUrl || entry?.has_paa) && !weOwnSnippet;
    if (!fetched || missingFeature || visible === false) {
      out.push({
        ...primary,
        our_serp_rank: ourRank,
        visible_in_serp: visible,
        featured_snippet_url: snippetUrl,
        has_paa: entry?.has_paa ?? false,
        serp_fetched: fetched,
        serp_stale: stale,
        alt_urls,
      });
    }
  }
  return out.sort((a, b) => b.impressions - a.impressions).slice(0, CARD_ROW_LIMIT);
}

export type OrganicOpportunitiesResponse = {
  bq_configured: boolean;
  openrush_configured: boolean;
  keep_rules_stale: boolean;
  keep_rules_version: number;
  days_present: number;
  days_expected: number;
  data_through: string | null;
  latest_ingested: boolean;
  serp_incomplete: boolean;
  windows: {
    d7: { start: string; end: string } | null;
    d28: { start: string; end: string } | null;
    decay_current: { start: string; end: string } | null;
    decay_prior: { start: string; end: string } | null;
  };
  cards: {
    page2: Array<WithCmsActivity<AggregatedGscRow>>;
    low_ctr: Array<WithCmsActivity<AggregatedGscRow & { expected_ctr: number; gap: number }>>;
    link_gaps: Array<WithCmsActivity<AggregatedGscRow & { inbound: number }>>;
    decay: Array<{
      url: string;
      clicks: number;
      impressions: number;
      prior_clicks: number;
      prior_impressions: number;
      click_drop: number;
    }>;
    cannibalization: ReturnType<typeof classifyCannibalization>;
    missing_serp: Array<WithCmsActivity<SerpOpportunityRow>>;
  };
};

function sliceExpected(all: string[], days: number, offsetEnd = 0): { start: string; end: string } | null {
  const endIdx = all.length - offsetEnd;
  const startIdx = endIdx - days;
  if (startIdx < 0 || endIdx <= 0) return null;
  const slice = all.slice(startIdx, endIdx);
  if (slice.length === 0) return null;
  return { start: slice[0]!, end: slice[slice.length - 1]! };
}

export function listPage1Queries(contentFolder?: string): string[] {
  const expected = completeDataDates();
  const d7 = sliceExpected(expected, 7);
  if (!d7) return [];
  const rows = aggregateDayRows(loadDaysRange(d7.start, d7.end, contentFolder));
  const set = new Set<string>();
  for (const r of rows) {
    if (r.query.trim() && r.position > 0 && r.position <= 10) set.add(r.query);
  }
  return [...set].sort((a, b) => a.localeCompare(b));
}

export async function buildOrganicOpportunities(opts: {
  contentRoot?: string;
  contentFolder?: string;
  decayWindow: 7 | 28;
  pullLatest?: boolean;
  /** When set, Ask Agent cards get cms_known from contentIndex.isKnownUrl. */
  isKnownUrl?: (path: string) => boolean;
  /** Resolve path → entry for activity gate entry_key. */
  resolveUrl?: (path: string) => OrganicResolveUrlResult;
  /** Site folder for pipeline write counts (same as events site). */
  site?: string;
}): Promise<OrganicOpportunitiesResponse> {
  const folder = opts.contentFolder || getDefaultContentFolder();
  const bq = getGscBigQueryConfigStatus(opts.contentRoot);
  const openrush = getOpenRushSettings(opts.contentRoot);
  const openrush_configured = Boolean(openrush.enabled && (process.env.OPENRUSH_API_KEY || "").trim());
  let latest_ingested = false;
  if (opts.pullLatest && bq.configured && listOrganicDayDates(folder).length > 0) {
    const pulled = await ingestLatestCompleteDay({
      contentRoot: opts.contentRoot,
      contentFolder: folder,
    });
    latest_ingested = Boolean(pulled?.ok);
  }

  const expected = completeDataDates();
  const present = listOrganicDayDates(folder);
  const keep_rules_stale = anyKeepRulesStale(present, folder);
  const d7 = sliceExpected(expected, 7);
  const d28 = sliceExpected(expected, 28);
  const decayDays = opts.decayWindow;
  const decayCur = sliceExpected(expected, decayDays);
  const decayPrior = sliceExpected(expected, decayDays, decayDays);

  const rows7 = d7 ? aggregateDayRows(loadDaysRange(d7.start, d7.end, folder)) : [];
  const rows28 = d28 ? aggregateDayRows(loadDaysRange(d28.start, d28.end, folder)) : [];
  const rowsDecayCur = decayCur
    ? aggregateDayRows(loadDaysRange(decayCur.start, decayCur.end, folder))
    : [];
  const rowsDecayPrior = decayPrior
    ? aggregateDayRows(loadDaysRange(decayPrior.start, decayPrior.end, folder))
    : [];

  const serp = openrush_configured ? loadSerpCache(folder).entries : {};
  const missing_serp = openrush_configured ? classifyMissingSerp(rows7, serp) : [];
  const serp_incomplete = openrush_configured && missing_serp.some((r) => !r.serp_fetched || r.serp_stale);

  const known = opts.isKnownUrl ?? (() => false);
  const writeCounts = opts.site
    ? countEntryActivityWrites({ site: opts.site })
    : new Map<string, number>();
  const enrich = <T extends { url: string }>(rows: T[]) =>
    enrichCmsActivity(rows, {
      isKnownUrl: known,
      resolveUrl: opts.resolveUrl,
      writeCounts,
    });

  return {
    bq_configured: bq.configured,
    openrush_configured,
    keep_rules_stale,
    keep_rules_version: KEEP_RULES_VERSION,
    days_present: present.length,
    days_expected: ORGANIC_RETENTION_DAYS,
    data_through: present.length ? present[present.length - 1]! : null,
    latest_ingested,
    serp_incomplete,
    windows: { d7, d28, decay_current: decayCur, decay_prior: decayPrior },
    cards: {
      page2: enrich(classifyPage2(rows7)),
      low_ctr: enrich(classifyLowCtr(rows7)),
      link_gaps: enrich(classifyLinkGaps(rows7, opts.contentRoot)),
      decay: classifyDecay(rowsDecayCur, rowsDecayPrior),
      cannibalization: classifyCannibalization(rows28),
      missing_serp: enrich(missing_serp),
    },
  };
}
