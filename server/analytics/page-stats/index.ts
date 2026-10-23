/**
 * Page stats drawer report: resolves the page and its stage, runs every section in parallel
 * (GA4 flow, leads, Search Console, ads, links, edit history), fills benchmarks, then builds the
 * stage objective and the advice. Cached in memory for 10 minutes per site + paths + scope.
 */

import type { ContentIndex } from "../../content-index";
import { lastCompleteGa4Date } from "../../ads/paid-detection";
import { getFunnelSettings } from "../../settings";
import { getPathStageIndex, resolvePage, type PageStatsScope } from "./resolve";
import { queryPageFlow } from "./ga4-flow";
import { convertedByPath, queryPageLeads } from "./leads";
import { queryPageOrganic } from "./organic";
import { queryPagePaid } from "./paid";
import { buildPageLinks } from "./links";
import { queryPageChanges } from "./changes";
import { channelBaselineRate, saveStageBenchmark, stageRateBenchmark } from "./benchmarks";
import { buildObjective } from "./objective";
import { buildPageAdvice } from "./advice";
import { STAGE_OBJECTIVES } from "@shared/page-objectives";
import { PAGE_STATS_WINDOW_DAYS, type PageStatsResponse, type Section } from "@shared/page-stats";
import { child } from "../../logger";

const log = child({ module: "page-stats" });

const TTL_MS = 10 * 60 * 1000;
const cache = new Map<string, { expires: number; payload: PageStatsResponse }>();

export class PageStatsNotFoundError extends Error {}

function addDays(day: string, n: number): string {
  const d = new Date(`${day}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

function failed<T>(err: unknown): Section<T> {
  return { status: "error", as_of: null, message: err instanceof Error ? err.message : String(err), data: null };
}

export function clearPageStatsCache(): void {
  cache.clear();
}

export async function getPageStats(opts: {
  /** Site content folder name (e.g. site_4geeks-com). */
  site: string;
  contentRoot?: string;
  ci: ContentIndex;
  path: string;
  scope: PageStatsScope;
  refresh?: boolean;
  now?: Date;
}): Promise<PageStatsResponse> {
  const days = PAGE_STATS_WINDOW_DAYS;
  const index = getPathStageIndex(opts.site, opts.ci);
  const page = resolvePage({ site: opts.site, ci: opts.ci, path: opts.path, scope: opts.scope, index });
  if (!page) throw new PageStatsNotFoundError("path could not be normalized to a public page path.");

  const key = `${opts.site}|${opts.scope}|${page.paths.join(",")}`;
  const hit = cache.get(key);
  if (!opts.refresh && hit && hit.expires > Date.now()) return hit.payload;

  const end = lastCompleteGa4Date(opts.now);
  const current = { start: addDays(end, -(days - 1)), end };
  const prior = { start: addDays(end, -(days * 2 - 1)), end: addDays(end, -days) };
  const stage = page.stage;
  const peerPaths = stage ? index.pathsByStage[stage] : [];

  const [traffic, organic, paid] = await Promise.all([
    queryPageFlow({
      paths: page.paths,
      stage,
      index,
      window: { start: prior.start, end: current.end, cur_start: current.start },
      contentRoot: opts.contentRoot,
    }).catch((err) => failed<NonNullable<PageStatsResponse["sections"]["traffic"]["data"]>>(err)),
    queryPageOrganic({
      contentFolder: opts.site,
      contentRoot: opts.contentRoot,
      ci: opts.ci,
      paths: page.paths,
      primaryPath: page.path,
      entry: page.entry,
      days,
    }).catch((err) => failed<NonNullable<PageStatsResponse["sections"]["organic"]["data"]>>(err)),
    queryPagePaid({
      site: opts.site,
      contentRoot: opts.contentRoot,
      ci: opts.ci,
      paths: page.paths,
      stage,
      days,
      prior,
      peerPaths,
    }).catch((err) => failed<NonNullable<PageStatsResponse["sections"]["paid"]["data"]>>(err)),
  ]);
  const leads = queryPageLeads({ site: opts.site, paths: page.paths, current, prior });
  const changes = queryPageChanges({ site: opts.site, entry: page.entry, start: prior.start, end: current.end });

  const entryKeys = page.entry
    ? Object.keys(page.locale_urls).length > 0 && opts.scope === "entry"
      ? Object.keys(page.locale_urls).map((loc) => `${page.entry!.content_type}/${page.entry!.slug}/${loc}`)
      : [page.entry.key]
    : [];
  const links = buildPageLinks({
    contentRoot: opts.contentRoot,
    paths: page.paths,
    entryKeys,
    stage,
    index,
    nextPages: traffic.data?.next_pages ?? null,
  });

  if (traffic.data) {
    for (const c of traffic.data.channels) {
      c.benchmark_rate = channelBaselineRate(opts.site, c.channel, page.entry?.content_type ?? null, stage);
    }
  }

  let objective: PageStatsResponse["objective"] = null;
  if (stage) {
    const metric = STAGE_OBJECTIVES[stage].primary.id;
    const converted =
      metric === "conversion_rate" && traffic.data
        ? convertedByPath(opts.site, traffic.data.peers.map((p) => p.path), current)
        : new Map<string, number>();
    const bench = traffic.data
      ? stageRateBenchmark({ metric, peers: traffic.data.peers, ownPaths: page.paths, converted })
      : { rate: null, pages: 0 };
    objective = buildObjective({
      stage,
      traffic: traffic.data,
      leads: leads.data,
      paid: paid.data,
      organic: organic.data,
      target: getFunnelSettings(opts.contentRoot).targets?.[stage],
      rateBenchmark: bench.rate,
    });
    if (bench.rate !== null || paid.data?.stage_cost_benchmark?.cost) {
      saveStageBenchmark(opts.site, stage, {
        rate: bench.rate,
        cost: paid.data?.stage_cost_benchmark?.cost ?? null,
        pages: bench.pages,
      });
    }
  }

  const advice = buildPageAdvice({
    stage,
    path: page.path,
    objective,
    traffic: traffic.data,
    leads: leads.data,
    organic: organic.data,
    paid: paid.data,
    links: links.data,
  });

  const payload: PageStatsResponse = {
    path: page.path,
    paths: page.paths,
    scope: page.scope,
    window: { days, current, prior },
    entry: page.entry,
    locale_urls: page.locale_urls,
    stage,
    objective,
    advice,
    sections: { traffic, leads, organic, paid, links, changes },
    generated_at: new Date().toISOString(),
  };
  cache.set(key, { expires: Date.now() + TTL_MS, payload });
  log.info({ site: opts.site, path: page.path, scope: opts.scope, stage }, "[page-stats] built");
  return payload;
}
