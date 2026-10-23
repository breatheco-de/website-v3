/**
 * Live split check (sample ratio mismatch) for running page tests: compares the
 * configured split with what visitors actually got, from server counts (live) and
 * GA4 sessions from the ads sync (daily). Warn-only; nothing changes for visitors.
 */

import { isAbCheckPage } from "../ab-testing/state";
import { expectedSharesPct, sharesPct, SRM_P_THRESHOLD, srmPValue } from "../ab-testing/stats";
import { loadPaidLandingDays } from "../ads/paid-detection";
import { hasActiveTraffic } from "./assignment";
import { getVersioningManager, type VersioningManager } from "./VersioningManager";

export type SplitHealthStatus = "ok" | "mismatch" | "collecting" | "unavailable";

export interface SplitHealthSource {
  status: SplitHealthStatus;
  counts: Record<string, number>;
  total: number;
  observed_pct: Record<string, number>;
  p_value: number | null;
  /** GA4 only: last ads-sync day included. */
  through_date?: string | null;
}

export interface SplitHealthLocale {
  experiment_id: string;
  expected_pct: Record<string, number>;
  server: SplitHealthSource;
  ga4: SplitHealthSource;
  /** mismatch when either source mismatches. */
  status: SplitHealthStatus;
}

/** Below this many visitors (server) or sessions (GA4) the split is not judged yet. */
export const SPLIT_HEALTH_MIN_SAMPLE = 200;
const MEMO_TTL_MS = 10 * 60_000;
const GA4_FALLBACK_DAYS = 30;

const memo = new Map<string, { at: number; value: Record<string, SplitHealthLocale> | undefined }>();

export function invalidateSplitHealthCache(): void {
  memo.clear();
}

export function evaluateSplit(
  counts: Record<string, number>,
  expectedPct: Record<string, number>,
  opts: { through_date?: string | null; available?: boolean } = {},
): SplitHealthSource {
  const total = Object.values(counts).reduce((n, v) => n + v, 0);
  const base = {
    counts,
    total,
    observed_pct: sharesPct(counts),
    ...(opts.through_date !== undefined ? { through_date: opts.through_date } : {}),
  };
  if (opts.available === false) return { ...base, status: "unavailable", p_value: null };
  if (total < SPLIT_HEALTH_MIN_SAMPLE) return { ...base, status: "collecting", p_value: null };
  const p = srmPValue(counts, expectedPct);
  if (p === null) return { ...base, status: "collecting", p_value: null };
  return { ...base, status: p < SRM_P_THRESHOLD ? "mismatch" : "ok", p_value: p };
}

function overall(a: SplitHealthStatus, b: SplitHealthStatus): SplitHealthStatus {
  if (a === "mismatch" || b === "mismatch") return "mismatch";
  if (a === "ok" || b === "ok") return "ok";
  if (a === "collecting" || b === "collecting") return "collecting";
  return "unavailable";
}

function isoDay(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** GA4 sessions per version for one experiment from cached ads-sync day files. */
export function ga4CountsFor(
  site: string,
  experimentId: string,
  since: string,
  until: string,
): { counts: Record<string, number>; through_date: string | null; days: number } {
  const counts: Record<string, number> = {};
  let through: string | null = null;
  const days = loadPaidLandingDays(site, since, until);
  for (const day of days) {
    if (!through || day.date > through) through = day.date;
    for (const row of [...day.candidates, ...day.organic]) {
      if (row.experiment_id !== experimentId || !row.variant) continue;
      counts[row.variant] = (counts[row.variant] ?? 0) + row.sessions;
    }
  }
  return { counts, through_date: through, days: days.length };
}

/**
 * Per-locale split health for an entry's running tests (undefined when none).
 * Memoized 10 minutes per site and page.
 */
export function getSplitHealth(
  site: { contentRoot: string; contentRootName: string; versioningManager?: VersioningManager },
  contentType: string,
  slug: string,
  opts: { now?: Date; fresh?: boolean } = {},
): Record<string, SplitHealthLocale> | undefined {
  const key = `${site.contentRootName}:${contentType}:${slug}`;
  const hit = memo.get(key);
  if (!opts.fresh && hit && Date.now() - hit.at < MEMO_TTL_MS) return hit.value;

  let value: Record<string, SplitHealthLocale> | undefined;
  try {
    value = compute(site, contentType, slug, opts.now ?? new Date());
  } catch {
    value = undefined;
  }
  memo.set(key, { at: Date.now(), value });
  return value;
}

function compute(
  site: { contentRoot: string; contentRootName: string; versioningManager?: VersioningManager },
  contentType: string,
  slug: string,
  now: Date,
): Record<string, SplitHealthLocale> | undefined {
  if (isAbCheckPage(contentType, slug, site.contentRoot)) return undefined;
  const vm = site.versioningManager ?? getVersioningManager();
  const config = vm.getVersioningForContent(contentType, slug);
  if (!config) return undefined;

  const out: Record<string, SplitHealthLocale> = {};
  for (const [locale, block] of Object.entries(config)) {
    if (!hasActiveTraffic(block?.variants)) continue;
    const expected = expectedSharesPct(block.variants);
    const experimentId = vm.getExperimentId(contentType, slug, locale);

    const server = evaluateSplit(vm.getRunCounts(contentType, slug, locale), expected);

    const until = isoDay(now);
    const fallback = new Date(now.getTime() - GA4_FALLBACK_DAYS * 86_400_000);
    const since = block.started_at && /^\d{4}-\d{2}-\d{2}$/.test(block.started_at) ? block.started_at : isoDay(fallback);
    const ga4Raw = ga4CountsFor(site.contentRootName, experimentId, since, until);
    const ga4 = evaluateSplit(ga4Raw.counts, expected, {
      through_date: ga4Raw.through_date,
      available: ga4Raw.days > 0,
    });

    out[locale] = {
      experiment_id: experimentId,
      expected_pct: expected,
      server,
      ga4,
      status: overall(server.status, ga4.status),
    };
  }
  return Object.keys(out).length ? out : undefined;
}
