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
import { child } from "./logger";

const log = child({ module: "gsc-organic-days" });

export const ORGANIC_RETENTION_DAYS = 60;

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

export function loadOrganicDay(date: string, contentFolder?: string): GscOrganicDayFile | null {
  const p = gscOrganicDayPath(date, contentFolder);
  if (!fs.existsSync(p)) return null;
  try {
    const parsed = JSON.parse(fs.readFileSync(p, "utf-8")) as GscOrganicDayFile;
    if (!parsed || parsed.date !== date || !Array.isArray(parsed.rows)) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function saveOrganicDay(file: GscOrganicDayFile, contentFolder?: string): void {
  const dir = gscOrganicDaysDir(contentFolder);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(gscOrganicDayPath(file.date, contentFolder), JSON.stringify(file), "utf-8");
}

export function pruneOrganicDays(contentFolder?: string, keep = ORGANIC_RETENTION_DAYS): string[] {
  const dates = listOrganicDayDates(contentFolder);
  const drop = dates.slice(0, Math.max(0, dates.length - keep));
  for (const d of drop) {
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
}): Promise<IngestDayResult & { remaining: number; days_present: number; days_expected: number; since?: string }> {
  const folder = opts.contentFolder || getDefaultContentFolder();
  const expected = completeDataDates();
  const since = opts.forceAll ? opts.since || new Date().toISOString() : undefined;
  const missing = expected.filter((d) => {
    const file = loadOrganicDay(d, folder);
    if (opts.forceAll) {
      if (!file) return true;
      if (since && file.fetched_at >= since) return false;
      return true;
    }
    return !file || file.keep_rules_version !== KEEP_RULES_VERSION;
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
