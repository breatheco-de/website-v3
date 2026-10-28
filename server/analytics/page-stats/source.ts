/**
 * Which visit source a page stats payload uses (GA4 vs the site's own counts for
 * "Optimize for ads" types), and the first-party traffic section builder shared by the
 * normal drawer and the test view.
 */

import type { ContentIndex } from "../../content-index";
import { firstPartyFlowSection } from "./first-party-flow";
import type { PathStageIndex } from "./resolve";
import { getVisitsDb } from "../first-party/visits-db";
import { listWindows, type TypeWindow } from "../first-party/windows";
import { flushSite } from "../first-party/ingest";
import { adsFirstPathIndex } from "../../ads/ads-first";
import { utmGraceState } from "../../ads/utm-convention-history";
import { getAdsSettings } from "../../settings";
import { getType, isAdsOptimizedType } from "../../content-types";
import { DEFAULT_UTM_CONVENTION } from "@shared/ads-settings";
import type { FunnelStage } from "@shared/funnel";
import type { Section, TrafficFacts, TrafficSource } from "@shared/page-stats";
import { child } from "../../logger";

const log = child({ module: "page-stats/source" });

export type ResolvedSource = {
  source: TrafficSource;
  contentType: string | null;
  flaggedNow: boolean;
  windows: TypeWindow[];
  firstPartyUntil: string | null;
};

export function resolveTrafficSource(opts: {
  site: string;
  contentRoot?: string;
  entryContentType: string | null;
  requested?: TrafficSource;
}): ResolvedSource {
  const contentType = opts.entryContentType ? getType(opts.entryContentType, opts.contentRoot) : null;
  const flaggedNow = contentType ? isAdsOptimizedType(contentType, opts.contentRoot) : false;
  const visitsDb = getVisitsDb(opts.site, { create: flaggedNow });
  const windows = visitsDb && contentType ? listWindows(visitsDb, contentType) : [];
  const hasHistory = windows.length > 0;
  const lastOff = !flaggedNow ? windows[windows.length - 1]?.disabled_at ?? null : null;
  const firstPartyUntil = lastOff ? new Date(lastOff).toISOString().slice(0, 10) : null;
  const source: TrafficSource =
    opts.requested === "ga4" ? "ga4" : (opts.requested === "first_party" && hasHistory) || flaggedNow ? "first_party" : "ga4";
  return { source, contentType, flaggedNow, windows, firstPartyUntil };
}

function failed<T>(err: unknown): Section<T> {
  return { status: "error", as_of: null, message: err instanceof Error ? err.message : String(err), data: null };
}

export function firstPartyTraffic(opts: {
  site: string;
  contentRoot?: string;
  ci: ContentIndex;
  paths: string[];
  stage: FunnelStage | null;
  index: PathStageIndex;
  contentType: string | null;
  current: { start: string; end: string };
  prior: { start: string; end: string };
  ga4?: Section<TrafficFacts>;
  /** Test view: one version, no same-stage peers. */
  pageVersion?: string;
}): Section<TrafficFacts> {
  try {
    flushSite(opts.site);
    const db = getVisitsDb(opts.site);
    if (!db) {
      return { status: "insufficient_data", as_of: null, message: "No visits counted on this page yet.", data: null };
    }
    const flagged = opts.pageVersion ? new Set<string>() : new Set(adsFirstPathIndex(opts.site, opts.ci, opts.contentRoot).keys());
    const peerPaths = opts.stage && !opts.pageVersion ? opts.index.pathsByStage[opts.stage].filter((p) => flagged.has(p)) : [];
    const settings = getAdsSettings(opts.contentRoot);
    const convention = settings.utm_convention ?? DEFAULT_UTM_CONVENTION;
    let grace: ReturnType<typeof utmGraceState> | null = null;
    try {
      grace = utmGraceState(opts.site, convention);
    } catch {
      grace = null;
    }
    const section = firstPartyFlowSection({
      db,
      paths: opts.paths,
      stage: opts.stage,
      index: opts.index,
      window: { current: opts.current, prior: opts.prior },
      contentType: opts.contentType,
      peerPaths,
      convention,
      grace,
      pageVersion: opts.pageVersion,
    });
    const ga4 = opts.ga4?.data?.current;
    if (section.data?.first_party && ga4 && ga4.sessions > 0) {
      section.data.first_party.returning_share_ga4 = ga4.returning_sessions / ga4.sessions;
    }
    return section;
  } catch (err) {
    log.warn({ err, site: opts.site }, "[page-stats] first-party flow failed");
    return failed<TrafficFacts>(err);
  }
}
