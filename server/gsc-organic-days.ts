/**
 * Per-day GSC organic query×URL cache on persistent `.cache` (no GCS).
 */

import fs from "fs";
import path from "path";
import { CACHE_DIR } from "./db-cache";
import { getDefaultContentFolder } from "./site-config";
import { loadSeoIndex } from "./seo-index";
import { getSearchConsoleSettings } from "./settings";
import {
  applyKeepFilter,
  KEEP_RULES_VERSION,
  keywordTokenKey,
  normalizePageUrl,
  type GscDayRow,
} from "./gsc-keep-filter";
import { queryUrlImpressionsForDate } from "./gsc-bigquery-client";
import {
  DEFAULT_ORGANIC_MARKETS,
  resolveMarket,
  rowMatchesMarket,
  type OrganicMarket,
} from "./gsc-organic-markets";
import { child } from "./logger";

const log = child({ module: "gsc-organic-days" });

export const ORGANIC_RETENTION_DAYS = 60;
/** Empty (for market) day files older than this are eligible for catch-up again. */
export const EMPTY_DAY_RETRY_MS = 12 * 60 * 60 * 1000;

export type GscOrganicDayFile = {
  date: string;
  fetched_at: string;
  keep_rules_version: number;
  truncated: boolean;
  rows: GscDayRow[];
};

export function gscOrganicDaysDir(contentFolder?: string): string {
  const folder = contentFolder || getDefaultContentFolder();
  return path.join(CACHE_DIR, folder, "gsc-organic-days");
}

export function gscOrganicDayPath(date: string, contentFolder?: string): string {
  return path.join(gscOrganicDaysDir(contentFolder), `${date}.json`);
}

export function listOrganicDayDates(contentFolder?: string): string[] {
  const dir = gscOrganicDaysDir(contentFolder);
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((f) => /^\d{4}-\d{2}-\d{2}\.json$/.test(f))
    .map((f) => f.replace(/\.json$/, ""))
    .sort();
}

const organicDayCache = new Map<string, { mtimeMs: number; file: GscOrganicDayFile }>();

function organicDayCacheKey(date: string, contentFolder?: string): string {
  return `${contentFolder || getDefaultContentFolder()}\0${date}`;
}

export function loadOrganicDay(date: string, contentFolder?: string): GscOrganicDayFile | null {
  const p = gscOrganicDayPath(date, contentFolder);
  const key = organicDayCacheKey(date, contentFolder);
  let mtimeMs: number;
  try {
    mtimeMs = fs.statSync(p).mtimeMs;
  } catch {
    organicDayCache.delete(key);
    return null;
  }
  const hit = organicDayCache.get(key);
  if (hit && hit.mtimeMs === mtimeMs) return hit.file;
  try {
    const parsed = JSON.parse(fs.readFileSync(p, "utf-8")) as GscOrganicDayFile;
    if (!parsed || parsed.date !== date || !Array.isArray(parsed.rows)) {
      organicDayCache.delete(key);
      return null;
    }
    organicDayCache.set(key, { mtimeMs, file: parsed });
    return parsed;
  } catch {
    organicDayCache.delete(key);
    return null;
  }
}

export function saveOrganicDay(file: GscOrganicDayFile, contentFolder?: string): void {
  const dir = gscOrganicDaysDir(contentFolder);
  fs.mkdirSync(dir, { recursive: true });
  const filePath = gscOrganicDayPath(file.date, contentFolder);
  fs.writeFileSync(filePath, JSON.stringify(file), "utf-8");
  try {
    organicDayCache.set(organicDayCacheKey(file.date, contentFolder), {
      mtimeMs: fs.statSync(filePath).mtimeMs,
      file,
    });
  } catch {
    organicDayCache.delete(organicDayCacheKey(file.date, contentFolder));
  }
}

export function pruneOrganicDays(contentFolder?: string, keep = ORGANIC_RETENTION_DAYS): string[] {
  const dates = listOrganicDayDates(contentFolder);
  const drop = dates.slice(0, Math.max(0, dates.length - keep));
  for (const d of drop) {
    organicDayCache.delete(organicDayCacheKey(d, contentFolder));
    try {
      fs.unlinkSync(gscOrganicDayPath(d, contentFolder));
    } catch {
      /* ignore */
    }
  }
  return drop;
}

export function anyKeepRulesStale(dates: string[], contentFolder?: string): boolean {
  for (const d of dates) {
    const file = loadOrganicDay(d, contentFolder);
    if (file && file.keep_rules_version !== KEEP_RULES_VERSION) return true;
  }
  return false;
}

export function completeDataDates(now = new Date(), count = ORGANIC_RETENTION_DAYS): string[] {
  // Skip today (Pacific-ish: use UTC date minus 2 days as last complete by default)
  const last = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - 2));
  const out: string[] = [];
  for (let i = 0; i < count; i++) {
    const d = new Date(last);
    d.setUTCDate(last.getUTCDate() - i);
    out.push(d.toISOString().slice(0, 10));
  }
  return out.reverse();
}

export function buildKeepContext(contentRoot?: string): {
  ourHosts: Set<string>;
  ourPaths: Set<string>;
  keywordKeys: Set<string>;
} {
  const ourHosts = new Set<string>();
  // Host filter must follow the Search Console property — not SITE_URL.
  // Local/dev SITE_URL is often a Cloudflare tunnel or localhost; using it
  // as the only allowed host drops every real 4geeks.com GSC row.
  const sc = getSearchConsoleSettings(contentRoot).site_url;
  if (sc && !sc.toLowerCase().startsWith("sc-domain:")) {
    const loc = normalizePageUrl(sc);
    if (loc) ourHosts.add(loc.host);
  } else if (sc && sc.toLowerCase().startsWith("sc-domain:")) {
    ourHosts.add(sc.slice("sc-domain:".length).toLowerCase().replace(/^www\./, ""));
  }

  const ourPaths = new Set<string>();
  const keywordKeys = new Set<string>();
  try {
    const index = loadSeoIndex(contentRoot);
    for (const row of Object.values(index.entries)) {
      if (row.path) {
        const loc = normalizePageUrl(
          row.path.startsWith("http") ? row.path : `https://placeholder.local${row.path.startsWith("/") ? row.path : `/${row.path}`}`,
        );
        if (loc) ourPaths.add(loc.path);
      }
      if (row.main_keyword?.trim()) keywordKeys.add(keywordTokenKey(row.main_keyword));
    }
  } catch (err) {
    log.warn({ err }, "[gsc-organic-days] seo-index unavailable for keep context");
  }
  return { ourHosts, ourPaths, keywordKeys };
}

export type IngestDayResult = {
  ok: boolean;
  date: string;
  row_count?: number;
  truncated?: boolean;
  error?: string;
};

/**
 * Whether catch-up (mode missing) should re-pull this day.
 * Absent / stale keep-rules always qualify. Market-empty files qualify only when
 * older than EMPTY_DAY_RETRY_MS (avoids infinite re-pull loops).
 */
export function organicDayNeedsCatchUp(
  file: GscOrganicDayFile | null,
  market: OrganicMarket,
  now: Date | number = Date.now(),
): boolean {
  if (!file || file.keep_rules_version !== KEEP_RULES_VERSION) return true;
  const hasMarketRows = file.rows.some((r) => rowMatchesMarket(r.country, market));
  if (hasMarketRows) return false;
  const fetched = Date.parse(file.fetched_at);
  if (!Number.isFinite(fetched)) return true;
  const nowMs = typeof now === "number" ? now : now.getTime();
  return nowMs - fetched >= EMPTY_DAY_RETRY_MS;
}

export async function ingestOrganicDay(
  date: string,
  opts: { contentRoot?: string; contentFolder?: string; force?: boolean },
): Promise<IngestDayResult> {
  const folder = opts.contentFolder || getDefaultContentFolder();
  if (!opts.force && loadOrganicDay(date, folder)?.keep_rules_version === KEEP_RULES_VERSION) {
    const existing = loadOrganicDay(date, folder)!;
    return { ok: true, date, row_count: existing.rows.length, truncated: existing.truncated };
  }
  try {
    const raw = await queryUrlImpressionsForDate(date, opts.contentRoot);
    const ctx = buildKeepContext(opts.contentRoot);
    const { getSearchConsoleSettings } = await import("./settings");
    const { configuredCountrySet } = await import("./gsc-organic-markets");
    const preferred = configuredCountrySet(
      getSearchConsoleSettings(opts.contentRoot).organic_markets,
    );
    const { rows, truncated } = applyKeepFilter(raw, ctx, preferred);
    saveOrganicDay(
      {
        date,
        fetched_at: new Date().toISOString(),
        keep_rules_version: KEEP_RULES_VERSION,
        truncated,
        rows,
      },
      folder,
    );
    pruneOrganicDays(folder);
    return { ok: true, date, row_count: rows.length, truncated };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    log.warn({ err, date }, "[gsc-organic-days] ingest failed");
    return { ok: false, date, error: message };
  }
}

export async function ingestNextMissingDay(opts: {
  contentRoot?: string;
  contentFolder?: string;
  forceAll?: boolean;
  /** ISO timestamp: with forceAll, skip days fetched at or after this (one rebuild pass). */
  since?: string;
  /** Market id for empty-day eligibility (mode missing only). Defaults to worldwide. */
  market?: string | null;
}): Promise<IngestDayResult & { remaining: number; days_present: number; days_expected: number; since?: string }> {
  const folder = opts.contentFolder || getDefaultContentFolder();
  const expected = completeDataDates();
  const since = opts.forceAll ? opts.since || new Date().toISOString() : undefined;
  const markets =
    opts.contentRoot != null
      ? getSearchConsoleSettings(opts.contentRoot).organic_markets
      : DEFAULT_ORGANIC_MARKETS.map((m) => ({ ...m, countries: [...m.countries] }));
  const { market } = resolveMarket(markets, opts.market);
  const missing = expected.filter((d) => {
    const file = loadOrganicDay(d, folder);
    if (opts.forceAll) {
      if (!file) return true;
      if (since && file.fetched_at >= since) return false;
      return true;
    }
    return organicDayNeedsCatchUp(file, market);
  });
  if (missing.length === 0) {
    return {
      ok: true,
      date: expected[expected.length - 1] || "",
      remaining: 0,
      days_present: listOrganicDayDates(folder).length,
      days_expected: expected.length,
      since,
    };
  }
  const date = missing[0]!;
  const result = await ingestOrganicDay(date, {
    contentRoot: opts.contentRoot,
    contentFolder: folder,
    force: true,
  });
  const presentAfter = listOrganicDayDates(folder).length;
  return {
    ...result,
    remaining: missing.length - (result.ok ? 1 : 0),
    days_present: presentAfter,
    days_expected: expected.length,
    since,
  };
}

export async function ingestLatestCompleteDay(opts: {
  contentRoot?: string;
  contentFolder?: string;
}): Promise<IngestDayResult | null> {
  const folder = opts.contentFolder || getDefaultContentFolder();
  const expected = completeDataDates();
  const latest = expected[expected.length - 1];
  if (!latest) return null;
  const existing = loadOrganicDay(latest, folder);
  if (existing && existing.keep_rules_version === KEEP_RULES_VERSION) return null;
  return ingestOrganicDay(latest, { ...opts, contentFolder: folder, force: true });
}

export function loadDaysRange(
  startDate: string,
  endDate: string,
  contentFolder?: string,
): GscOrganicDayFile[] {
  const dates = listOrganicDayDates(contentFolder).filter((d) => d >= startDate && d <= endDate);
  const files: GscOrganicDayFile[] = [];
  for (const d of dates) {
    const f = loadOrganicDay(d, contentFolder);
    if (f) files.push(f);
  }
  return files;
}
