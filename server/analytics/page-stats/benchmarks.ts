/**
 * Benchmarks used when a stage has no staff target, and always for the per-channel view:
 * - Rates: median of other same-stage pages with enough sessions (GA4 peers from the flow scan;
 *   decision conversion uses ledger leads ÷ GA4 sessions).
 * - Costs: median of other same-stage pages in the ads report.
 * - Channels: the nightly page-performance baselines (same channel, content type and stage).
 * The latest stage benchmarks are cached per site so Settings → Ads → Targets can show them.
 */

import fs from "fs";
import path from "path";
import { CACHE_DIR } from "../../db-cache";
import { readPagePerformanceFile } from "../page-performance";
import { normalizeLandingPath } from "@shared/paid-traffic";
import { PAGE_STATS_MIN_SESSIONS, type Money, type PeerRow, type StageBenchmarks } from "@shared/page-stats";
import type { ObjectiveMetricId } from "@shared/page-objectives";
import type { FunnelStage } from "@shared/funnel";

const FILE = "page-stats-benchmarks.json";
const MIN_PEERS = 3;

export function median(values: number[]): number | null {
  const xs = values.filter((v) => Number.isFinite(v)).sort((a, b) => a - b);
  if (xs.length === 0) return null;
  const mid = Math.floor(xs.length / 2);
  return xs.length % 2 ? xs[mid]! : (xs[mid - 1]! + xs[mid]!) / 2;
}

/** Primary rate of one page from its numerator / sessions. */
export function peerRate(
  metric: ObjectiveMetricId,
  peer: PeerRow,
  converted: Map<string, number>,
): number | null {
  if (peer.sessions <= 0) return null;
  switch (metric) {
    case "moved_forward_rate":
      return peer.moved_forward / peer.sessions;
    case "reached_decision_rate":
      return peer.reached_decision / peer.sessions;
    case "task_click_rate":
      return peer.task_sessions / peer.sessions;
    case "conversion_rate":
      return (converted.get(normalizeLandingPath(peer.path)) ?? 0) / peer.sessions;
  }
}

/** Median primary rate over other same-stage pages with ≥ PAGE_STATS_MIN_SESSIONS sessions. */
export function stageRateBenchmark(opts: {
  metric: ObjectiveMetricId;
  peers: PeerRow[];
  ownPaths: string[];
  converted: Map<string, number>;
}): { rate: number | null; pages: number } {
  const own = new Set(opts.ownPaths.map(normalizeLandingPath));
  const rates = opts.peers
    .filter((p) => !own.has(normalizeLandingPath(p.path)) && p.sessions >= PAGE_STATS_MIN_SESSIONS)
    .map((p) => peerRate(opts.metric, p, opts.converted))
    .filter((r): r is number => r !== null);
  return { rate: rates.length >= MIN_PEERS ? median(rates) : null, pages: rates.length };
}

/** Per-currency median of `spend ÷ denominator` over peer pages (ads report rows). */
export function stageCostBenchmark(
  rows: Array<{ spend: Money; denominator: number; enough: boolean }>,
): { cost: Money | null; pages: number } {
  const byCurrency = new Map<string, number[]>();
  let pages = 0;
  for (const r of rows) {
    if (!r.enough || r.denominator <= 0) continue;
    let counted = false;
    for (const [cur, v] of Object.entries(r.spend)) {
      if (v <= 0) continue;
      const list = byCurrency.get(cur) ?? [];
      list.push(v / r.denominator);
      byCurrency.set(cur, list);
      counted = true;
    }
    if (counted) pages += 1;
  }
  const cost: Money = {};
  for (const [cur, list] of byCurrency) {
    if (list.length < MIN_PEERS) continue;
    const m = median(list);
    if (m !== null) cost[cur] = Math.round(m * 100) / 100;
  }
  return { cost: Object.keys(cost).length > 0 ? cost : null, pages };
}

/** Nightly channel baseline: same channel + content type + stage, else same channel + outcome metric. */
export function channelBaselineRate(
  contentFolder: string,
  channel: string,
  contentType: string | null,
  stage: FunnelStage | null,
): number | null {
  const baselines = readPagePerformanceFile(contentFolder)?.channel_baselines;
  if (!baselines) return null;
  const metric = stage === "decision" ? "conversions" : "engaged_sessions";
  const specific = contentType ? baselines[`ch|${channel}|${contentType}|${stage ?? ""}`] : undefined;
  if (specific && specific.sessions >= PAGE_STATS_MIN_SESSIONS) return specific.rate;
  const general = baselines[`ch|${channel}|*|${metric}`];
  return general && general.sessions >= PAGE_STATS_MIN_SESSIONS ? general.rate : null;
}

function filePath(contentFolder: string): string {
  return path.join(CACHE_DIR, contentFolder, FILE);
}

export function readStageBenchmarks(contentFolder: string): { updated_at: string | null; stages: StageBenchmarks } {
  try {
    const parsed = JSON.parse(fs.readFileSync(filePath(contentFolder), "utf8")) as { updated_at?: string; stages?: StageBenchmarks };
    return { updated_at: parsed.updated_at ?? null, stages: parsed.stages ?? {} };
  } catch {
    return { updated_at: null, stages: {} };
  }
}

export function saveStageBenchmark(
  contentFolder: string,
  stage: FunnelStage,
  value: { rate: number | null; cost: Money | null; pages: number },
): void {
  try {
    const current = readStageBenchmarks(contentFolder);
    const next = { updated_at: new Date().toISOString(), stages: { ...current.stages, [stage]: value } };
    const p = filePath(contentFolder);
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, JSON.stringify(next, null, 2));
  } catch {
    // Benchmarks cache is best-effort; the drawer recomputes on every open.
  }
}
