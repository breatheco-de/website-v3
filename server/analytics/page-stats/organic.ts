/**
 * Organic search for one page: Search Console day-file cache (clicks, impressions, position,
 * per-query rows), keywords from the GSC BigQuery export when connected, opportunity flags
 * (page 2, low CTR, decay, cannibalization), the target keyword and the URL inspection record.
 */

import { completeDataDates, listOrganicDayDates, loadDaysRange } from "../../gsc-organic-days";
import { pathKeyFromUrlOrPath } from "../../gsc-organic-path-traffic";
import { expectedCtrForPosition, queriesMatchKeyword } from "../../gsc-keep-filter";
import {
  aggregateDayRows,
  classifyCannibalization,
  classifyLowCtr,
  classifyPage2,
  type AggregatedGscRow,
} from "../../seo-organic-opportunities";
import { getGscBigQueryConfigStatus, queryUrlOrganicQueries } from "../../gsc-bigquery-client";
import { isIndexed, loadStore } from "../../gsc-url-inspection";
import type { ContentIndex } from "../../content-index";
import type { KeywordRow, OrganicFacts, OrganicFlag, Section } from "@shared/page-stats";

const KEYWORD_LIMIT = 25;
const DECAY_MIN_PRIOR_CLICKS = 20;
const DECAY_DROP_RATIO = 0.75;

type Totals = OrganicFacts["current"];

function totalsOf(rows: AggregatedGscRow[]): Totals {
  let clicks = 0;
  let impressions = 0;
  let sumPos = 0;
  for (const r of rows) {
    clicks += r.clicks;
    impressions += r.impressions;
    sumPos += r.position * r.impressions;
  }
  return {
    clicks,
    impressions,
    position: impressions > 0 ? displayPosition(sumPos / impressions) : 0,
    ctr: impressions > 0 ? clicks / impressions : 0,
  };
}

/** GSC `sum_position` is zero-based (top result = 0); Search Console shows average + 1. */
function displayPosition(zeroBased: number): number {
  return Math.round((zeroBased + 1) * 10) / 10;
}

function targetKeyword(ci: ContentIndex, entry: { content_type: string; slug: string; locale: string } | null): string | null {
  if (!entry) return null;
  try {
    const data = ci.loadMergedContent(entry.content_type, entry.slug, entry.locale)?.data as Record<string, unknown> | null;
    const top = data?.main_seo_keyword;
    if (typeof top === "string" && top.trim()) return top.trim();
    const seo = data?.seo as Record<string, unknown> | undefined;
    const nested = seo?.main_seo_keyword;
    return typeof nested === "string" && nested.trim() ? nested.trim() : null;
  } catch {
    return null;
  }
}

function inspection(contentFolder: string, paths: Set<string>): OrganicFacts["index"] {
  try {
    const records = loadStore(contentFolder).records;
    for (const [loc, rec] of Object.entries(records)) {
      const key = pathKeyFromUrlOrPath(loc);
      if (key && paths.has(key)) {
        return { indexed: isIndexed(rec), coverage: rec.coverageState ?? null, inspected_at: rec.inspectedAt ?? null };
      }
    }
  } catch {
    return null;
  }
  return null;
}

export async function queryPageOrganic(opts: {
  contentFolder: string;
  contentRoot?: string;
  ci: ContentIndex;
  paths: string[];
  primaryPath: string;
  entry: { content_type: string; slug: string; locale: string } | null;
  days: number;
}): Promise<Section<OrganicFacts>> {
  try {
    if (listOrganicDayDates(opts.contentFolder).length === 0) {
      return {
        status: "not_configured",
        as_of: null,
        message: "Search Console data hasn't been loaded for this site (Settings → SEO → Search Console).",
        data: null,
      };
    }
    const expected = completeDataDates();
    const cur = expected.slice(-opts.days);
    const prior = expected.slice(-opts.days * 2, -opts.days);
    const window = { start: cur[0]!, end: cur[cur.length - 1]! };
    const pathSet = new Set(opts.paths.map((p) => pathKeyFromUrlOrPath(p)).filter((p): p is string => !!p));
    const isOurs = (url: string) => {
      const k = pathKeyFromUrlOrPath(url);
      return !!k && pathSet.has(k);
    };

    const curFiles = loadDaysRange(window.start, window.end, opts.contentFolder);
    const priorFiles = prior.length > 0 ? loadDaysRange(prior[0]!, prior[prior.length - 1]!, opts.contentFolder) : [];
    const allCur = aggregateDayRows(curFiles);
    const oursCur = allCur.filter((r) => isOurs(r.url));
    const oursPrior = aggregateDayRows(priorFiles).filter((r) => isOurs(r.url));
    const current = totalsOf(oursCur);
    const priorTotals = totalsOf(oursPrior);

    const byDay = new Map(curFiles.map((f) => [f.date, f]));
    const series = cur.map((day) => {
      let clicks = 0;
      let impressions = 0;
      for (const r of byDay.get(day)?.rows ?? []) {
        if (!isOurs(r.url)) continue;
        clicks += r.clicks;
        impressions += r.impressions;
      }
      return { day, clicks, impressions };
    });

    const priorByQuery = new Map<string, number>();
    for (const r of oursPrior) priorByQuery.set(r.query, (priorByQuery.get(r.query) ?? 0) + r.clicks);

    const toKeyword = (q: { query: string; clicks: number; impressions: number; position: number }): KeywordRow => {
      const position = displayPosition(q.position);
      return {
        query: q.query,
        clicks: q.clicks,
        impressions: q.impressions,
        position,
        ctr: q.impressions > 0 ? q.clicks / q.impressions : 0,
        expected_ctr: expectedCtrForPosition(position),
        prior_clicks: priorByQuery.get(q.query) ?? null,
      };
    };

    let keywords: KeywordRow[] = [];
    let keywordsSource: OrganicFacts["keywords_source"] = "cache";
    if (getGscBigQueryConfigStatus(opts.contentRoot).configured) {
      const bq = await queryUrlOrganicQueries({
        urlOrPath: opts.primaryPath,
        start: window.start,
        end: window.end,
        contentRoot: opts.contentRoot,
        rowCap: KEYWORD_LIMIT,
      });
      if (bq.ok) {
        keywordsSource = "bigquery";
        keywords = bq.queries.map(toKeyword);
      }
    }
    if (keywordsSource === "cache") {
      const byQuery = new Map<string, AggregatedGscRow>();
      for (const r of oursCur) {
        if (!r.query.trim()) continue;
        const cur = byQuery.get(r.query);
        if (!cur || r.impressions > cur.impressions) byQuery.set(r.query, r);
      }
      keywords = [...byQuery.values()]
        .sort((a, b) => b.impressions - a.impressions)
        .slice(0, KEYWORD_LIMIT)
        .map(toKeyword);
    }

    const flags: OrganicFlag[] = [];
    for (const r of classifyPage2(oursCur).slice(0, 3)) {
      flags.push({ kind: "page2", query: r.query, position: displayPosition(r.position), impressions: r.impressions });
    }
    for (const r of classifyLowCtr(oursCur).slice(0, 3)) {
      flags.push({ kind: "low_ctr", query: r.query, ctr: r.ctr, expected_ctr: r.expected_ctr, impressions: r.impressions });
    }
    if (priorTotals.clicks >= DECAY_MIN_PRIOR_CLICKS && current.clicks < priorTotals.clicks * DECAY_DROP_RATIO) {
      flags.push({ kind: "decay", clicks: current.clicks, prior_clicks: priorTotals.clicks });
    }
    const ourQueries = new Set(oursCur.map((r) => r.query));
    for (const g of classifyCannibalization(allCur.filter((r) => ourQueries.has(r.query)))) {
      if (!g.urls.some((u) => isOurs(u.url))) continue;
      const other = g.urls.find((u) => !isOurs(u.url));
      if (other) flags.push({ kind: "cannibalization", query: g.query, other_url: other.url, impressions: g.impressions });
      if (flags.filter((f) => f.kind === "cannibalization").length >= 3) break;
    }

    const target = targetKeyword(opts.ci, opts.entry);
    const targetRow = target ? keywords.find((k) => queriesMatchKeyword(k.query, target)) : undefined;

    const lastWithData = curFiles.filter((f) => f.rows.length > 0).map((f) => f.date).sort().pop() ?? null;
    return {
      status: current.impressions === 0 && priorTotals.impressions === 0 ? "insufficient_data" : "ok",
      as_of: lastWithData,
      ...(current.impressions === 0 ? { message: "No Search Console impressions for this page in the period." } : {}),
      data: {
        current,
        prior: priorTotals,
        expected_ctr: current.position > 0 ? expectedCtrForPosition(current.position) : null,
        series,
        keywords,
        keywords_source: keywordsSource,
        flags,
        target_keyword: target,
        target_keyword_rank: targetRow ? targetRow.position : null,
        index: inspection(opts.contentFolder, pathSet),
      },
    };
  } catch (err) {
    return { status: "error", as_of: null, message: err instanceof Error ? err.message : String(err), data: null };
  }
}
