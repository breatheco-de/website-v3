/**
 * Targeted (High/Mid priority) cluster progress KPIs for SEO overview.
 * Computed on read from organic path traffic + today's cluster_priority — no KPI JSON store.
 */

import type { ClusterPriority } from "./seo-config";
import type { SeoIndex } from "./seo-index";
import {
  lookupPathTraffic,
  sumPathTraffic,
  type PathTrafficStats,
} from "./gsc-organic-path-traffic";

export const TARGETED_TREND_MIN_ABS_CLICKS = 3;
export const TARGETED_TREND_MIN_REL = 0.05;

export type HubTrend = "gaining" | "flat" | "losing";

export type TargetedClustersKpi = {
  high_hub_count: number;
  mid_hub_count: number;
  high_clicks: number;
  mid_clicks: number;
  /** Prior-window High clicks when trends are available; else null. */
  high_clicks_prior: number | null;
  /** Percent change High current vs prior; null when trends unavailable. */
  delta_pct: number | null;
  gaining: number | null;
  flat: number | null;
  losing: number | null;
  trends_available: boolean;
};

/** Classify one hub's click movement. Needs ≥5% relative AND ≥3 absolute clicks. */
export function classifyHubTrend(current: number, prior: number): HubTrend {
  const cur = Math.max(0, Math.round(current));
  const prev = Math.max(0, Math.round(prior));
  const delta = cur - prev;
  if (Math.abs(delta) < TARGETED_TREND_MIN_ABS_CLICKS) return "flat";
  if (prev <= 0) return delta > 0 ? "gaining" : "flat";
  if (Math.abs(delta) / prev < TARGETED_TREND_MIN_REL) return "flat";
  return delta > 0 ? "gaining" : "losing";
}

export function clusterClicksFromByPath(
  seoIndex: SeoIndex,
  hubId: string,
  byPath: Record<string, PathTrafficStats>,
): number {
  const cluster = seoIndex.clusters[hubId];
  if (!cluster) return 0;
  const hub = seoIndex.entries[hubId];
  const hubPath = cluster.path || hub?.path || "";
  const hubTraffic = lookupPathTraffic(byPath, hubPath);
  const memberTraffics = cluster.members.map((id) => {
    const entry = seoIndex.entries[id];
    return lookupPathTraffic(byPath, entry?.path || "");
  });
  const sum = sumPathTraffic([hubTraffic, ...memberTraffics]);
  return sum?.clicks ?? 0;
}

/**
 * Roll up High (headline) + Mid (subline) using today's priority map on both windows.
 * When `trendsAvailable` is false, delta and gaining/flat/losing are null.
 */
export function buildTargetedClustersKpi(opts: {
  seoIndex: SeoIndex;
  /** Current-window clicks by hubId (from clusterTraffic). */
  currentClicksByHub: Map<string, number>;
  /** Prior-window clicks by hubId; ignored when trendsAvailable is false. */
  priorClicksByHub: Map<string, number>;
  trendsAvailable: boolean;
}): TargetedClustersKpi {
  let high_hub_count = 0;
  let mid_hub_count = 0;
  let high_clicks = 0;
  let mid_clicks = 0;
  let high_clicks_prior = 0;
  let gaining = 0;
  let flat = 0;
  let losing = 0;

  for (const [hubId, cluster] of Object.entries(opts.seoIndex.clusters)) {
    const priority = cluster.priority as ClusterPriority | undefined;
    if (priority !== 1 && priority !== 2) continue;

    const current = opts.currentClicksByHub.get(hubId) ?? 0;
    const prior = opts.priorClicksByHub.get(hubId) ?? 0;

    if (priority === 1) {
      high_hub_count += 1;
      high_clicks += current;
      high_clicks_prior += prior;
      if (opts.trendsAvailable) {
        const trend = classifyHubTrend(current, prior);
        if (trend === "gaining") gaining += 1;
        else if (trend === "losing") losing += 1;
        else flat += 1;
      }
    } else {
      mid_hub_count += 1;
      mid_clicks += current;
    }
  }

  if (high_hub_count === 0) {
    return {
      high_hub_count: 0,
      mid_hub_count,
      high_clicks: 0,
      mid_clicks,
      high_clicks_prior: null,
      delta_pct: null,
      gaining: null,
      flat: null,
      losing: null,
      trends_available: false,
    };
  }

  if (!opts.trendsAvailable) {
    return {
      high_hub_count,
      mid_hub_count,
      high_clicks,
      mid_clicks,
      high_clicks_prior: null,
      delta_pct: null,
      gaining: null,
      flat: null,
      losing: null,
      trends_available: false,
    };
  }

  let delta_pct: number | null = null;
  if (high_clicks_prior > 0) {
    delta_pct = ((high_clicks - high_clicks_prior) / high_clicks_prior) * 100;
  } else if (high_clicks > 0) {
    delta_pct = 100;
  } else {
    delta_pct = 0;
  }

  return {
    high_hub_count,
    mid_hub_count,
    high_clicks,
    mid_clicks,
    high_clicks_prior,
    delta_pct,
    gaining,
    flat,
    losing,
    trends_available: true,
  };
}
