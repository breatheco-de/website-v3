/** Keep-filter for GSC organic day files. Bump KEEP_RULES_VERSION when these rules change. */

export const KEEP_RULES_VERSION = 1;
export const DAY_ROW_CAP = 100_000;
export const MIN_KEEP_IMPRESSIONS = 5;

export function keywordTokenKey(raw: string): string {
  return raw
    .toLowerCase()
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .sort()
    .join(" ");
}

export function queriesMatchKeyword(gscQuery: string, targetKeyword: string): boolean {
  const q = gscQuery.toLowerCase().trim();
  const t = targetKeyword.toLowerCase().trim();
  if (!q || !t) return false;
  if (q === t) return true;
  return keywordTokenKey(q) === keywordTokenKey(t);
}

export function normalizePageUrl(raw: string): { host: string; path: string } | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  try {
    const withScheme = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
    const u = new URL(withScheme);
    const host = u.hostname.toLowerCase().replace(/^www\./, "");
    let path = u.pathname.replace(/\/+$/, "") || "/";
    return { host, path };
  } catch {
    return null;
  }
}

export function hostsMatch(a: string, b: string): boolean {
  const na = a.toLowerCase().replace(/^www\./, "");
  const nb = b.toLowerCase().replace(/^www\./, "");
  return na === nb;
}

export type GscDayRow = {
  query: string;
  url: string;
  clicks: number;
  impressions: number;
  sum_position: number;
  ctr: number;
};

export function dayPosition(row: { impressions: number; sum_position: number }): number {
  if (row.impressions <= 0) return 0;
  return row.sum_position / row.impressions;
}

export function shouldKeepRow(
  row: GscDayRow,
  ctx: { ourHosts: Set<string>; ourPaths: Set<string>; keywordKeys: Set<string> },
): boolean {
  const loc = normalizePageUrl(row.url);
  if (!loc) return false;
  const hostOk = ctx.ourHosts.size === 0 || [...ctx.ourHosts].some((h) => hostsMatch(h, loc.host));
  if (!hostOk) return false;

  const q = (row.query || "").trim();
  if (q && ctx.keywordKeys.has(keywordTokenKey(q))) return true;

  const pathOk = ctx.ourPaths.size === 0 || ctx.ourPaths.has(loc.path);
  if (!pathOk && ctx.ourPaths.size > 0) {
    if (row.impressions < MIN_KEEP_IMPRESSIONS) return false;
  }

  const pos = dayPosition(row);
  if (pos > 0 && pos <= 20) return true;
  if (row.impressions >= MIN_KEEP_IMPRESSIONS) return true;
  return false;
}

export function applyKeepFilter(rows: GscDayRow[], ctx: Parameters<typeof shouldKeepRow>[1]): {
  rows: GscDayRow[];
  truncated: boolean;
} {
  const kept = rows.filter((r) => shouldKeepRow(r, ctx));
  kept.sort((a, b) => b.impressions - a.impressions);
  if (kept.length <= DAY_ROW_CAP) return { rows: kept, truncated: false };
  return { rows: kept.slice(0, DAY_ROW_CAP), truncated: true };
}

export function expectedCtrForPosition(position: number): number {
  if (position <= 1) return 0.28;
  if (position <= 2) return 0.15;
  if (position <= 3) return 0.11;
  if (position <= 4) return 0.08;
  if (position <= 5) return 0.06;
  if (position <= 6) return 0.05;
  if (position <= 7) return 0.04;
  if (position <= 8) return 0.035;
  if (position <= 9) return 0.03;
  if (position <= 10) return 0.025;
  if (position <= 20) return 0.015;
  return 0.008;
}
