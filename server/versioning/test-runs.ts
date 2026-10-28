/**
 * Test run history: which versions ran, when a test started and ended, and when its traffic
 * split changed. Kept in the versioning state (`.versioning-state.json`, synced to GCS in
 * production) because promoting a winner can delete versioning.yml, and with it the start date.
 */

import { DEFAULT_VARIANT_SLUG, allocatedTotal, experimentId, hasActiveTraffic } from "./assignment";

export type SplitChange = {
  day: string;
  from: Record<string, number>;
  to: Record<string, number>;
};

export type TestRun = {
  content_type: string;
  slug: string;
  locale: string;
  /** Variant slugs that had traffic at some point in the run (Default not included). */
  versions: string[];
  started_at: string | null;
  ended_at: string | null;
  split_changes: SplitChange[];
};

export type TestRuns = Record<string, TestRun>;

type LocaleConfig = { variants?: Array<{ slug: string; allocation?: number }>; started_at?: string } | undefined;
type Config = Record<string, LocaleConfig> | null | undefined;

function liveVariants(cfg: LocaleConfig): Array<{ slug: string; allocation: number }> {
  return (cfg?.variants ?? [])
    .map((v) => ({ slug: v.slug, allocation: Number(v.allocation ?? 0) }))
    .filter((v) => v.allocation > 0);
}

/** Traffic share per version, Default as the remainder. */
export function splitOf(cfg: LocaleConfig): Record<string, number> {
  const live = liveVariants(cfg);
  const out: Record<string, number> = {};
  const rest = Math.max(0, 100 - allocatedTotal(live));
  if (rest > 0) out[DEFAULT_VARIANT_SLUG] = rest;
  for (const v of live) out[v.slug] = v.allocation;
  return out;
}

function sameSplit(a: Record<string, number>, b: Record<string, number>): boolean {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  for (const k of keys) if ((a[k] ?? 0) !== (b[k] ?? 0)) return false;
  return true;
}

function isOn(cfg: LocaleConfig): boolean {
  return hasActiveTraffic(liveVariants(cfg));
}

function ensureRun(runs: TestRuns, id: string, contentType: string, slug: string, locale: string, cfg: LocaleConfig): TestRun {
  const existing = runs[id];
  if (existing) return existing;
  const run: TestRun = {
    content_type: contentType,
    slug,
    locale,
    versions: [],
    started_at: cfg?.started_at ?? null,
    ended_at: null,
    split_changes: [],
  };
  runs[id] = run;
  return run;
}

function addVersions(run: TestRun, cfg: LocaleConfig): void {
  for (const v of liveVariants(cfg)) {
    if (!run.versions.includes(v.slug)) run.versions.push(v.slug);
  }
}

/**
 * Update `runs` for one versioning write (before → after; after null = file deleted).
 * Mutates and returns `runs`. Returns true when anything changed.
 */
export function applyRunTransitions(
  runs: TestRuns,
  opts: { contentType: string; slug: string; before: Config; after: Config; today: string },
): boolean {
  const { contentType, slug, before, after, today } = opts;
  let changed = false;
  const locales = new Set([...Object.keys(before ?? {}), ...Object.keys(after ?? {})]);
  for (const locale of locales) {
    const b = before?.[locale];
    const a = after?.[locale];
    const bOn = isOn(b);
    const aOn = isOn(a);
    if (!bOn && !aOn) continue;
    const bId = experimentId(contentType, slug, locale, b?.started_at ?? null);
    const aId = experimentId(contentType, slug, locale, a?.started_at ?? null);

    if (bOn && (!aOn || bId !== aId)) {
      const run = ensureRun(runs, bId, contentType, slug, locale, b);
      addVersions(run, b);
      if (!run.ended_at) {
        run.ended_at = today;
        changed = true;
      }
    }
    if (aOn) {
      const isNew = !runs[aId];
      const run = ensureRun(runs, aId, contentType, slug, locale, a);
      const versionsBefore = run.versions.length;
      if (bOn && bId === aId) addVersions(run, b);
      addVersions(run, a);
      if (run.ended_at) {
        run.ended_at = null;
        changed = true;
      }
      if (bOn && bId === aId) {
        const from = splitOf(b);
        const to = splitOf(a);
        if (!sameSplit(from, to)) {
          run.split_changes.push({ day: today, from, to });
          changed = true;
        }
      }
      if (isNew || run.versions.length !== versionsBefore) changed = true;
    }
  }
  return changed;
}

/** Running run for a page and language, otherwise the most recently ended one. */
export function latestRun(
  runs: TestRuns,
  contentType: string,
  slug: string,
  locale: string,
): (TestRun & { experiment_id: string }) | null {
  let best: (TestRun & { experiment_id: string }) | null = null;
  for (const [id, run] of Object.entries(runs)) {
    if (run.content_type !== contentType || run.slug !== slug || run.locale !== locale) continue;
    if (!run.ended_at) return { ...run, experiment_id: id };
    if (!best || (run.ended_at ?? "") > (best.ended_at ?? "")) best = { ...run, experiment_id: id };
  }
  return best;
}
