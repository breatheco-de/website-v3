/**
 * OpenRush inspect_serp — API key from OPENRUSH_API_KEY only.
 */

import { child } from "./logger";
import { getOpenRushSettings } from "./settings";
import { normalizePageUrl } from "./gsc-keep-filter";
import {
  rankOfUrlInOrganic,
  upsertSerpEntry,
  type OpenRushOrganicHit,
  type OpenRushSerpEntry,
} from "./openrush-serp-cache";
import { upsertKeywordEntry, type OpenRushKeywordEntry } from "./openrush-keyword-cache";

const log = child({ module: "openrush-client" });

const OPENRUSH_SERP_URL = "https://api.openrush.com/v1/tools/inspect_serp";
const OPENRUSH_KEYWORD_URL = "https://api.openrush.com/v1/tools/inspect_keyword";

/** Official OpenRush credit cost for `inspect_keyword` (see credits docs). */
export const OPENRUSH_INSPECT_KEYWORD_CREDITS = 5;

/** Official OpenRush credit cost for `inspect_serp` (see credits docs). */
export const OPENRUSH_INSPECT_SERP_CREDITS = 2;

export function getOpenRushApiKey(): string {
  return (process.env.OPENRUSH_API_KEY || "").trim();
}

export function isOpenRushConfigured(contentRoot?: string): boolean {
  const settings = getOpenRushSettings(contentRoot);
  return Boolean(settings.enabled && getOpenRushApiKey());
}

export type ParsedInspectSerp = {
  organic: OpenRushOrganicHit[];
  featured_snippet_url: string | null;
  has_paa: boolean;
};

function asRecord(v: unknown): Record<string, unknown> | null {
  if (!v || typeof v !== "object" || Array.isArray(v)) return null;
  return v as Record<string, unknown>;
}

function pickUrl(v: unknown): string | null {
  const rec = asRecord(v);
  if (!rec) return typeof v === "string" && v.trim() ? v.trim() : null;
  for (const key of ["url", "link", "href"]) {
    const s = rec[key];
    if (typeof s === "string" && s.trim()) return s.trim();
  }
  return null;
}

export function parseInspectSerpData(data: unknown): ParsedInspectSerp {
  const rec = asRecord(data) || {};
  const organicRaw = Array.isArray(rec.organic) ? rec.organic : [];
  const organic: OpenRushOrganicHit[] = [];
  organicRaw.forEach((item, i) => {
    const url = pickUrl(item);
    if (!url) return;
    const itemRec = asRecord(item);
    const rankRaw = itemRec?.rank ?? itemRec?.position ?? itemRec?.serp_rank;
    const rank = typeof rankRaw === "number" && rankRaw > 0 ? rankRaw : i + 1;
    organic.push({ url, rank });
  });
  const snippet = pickUrl(rec.featured_snippet) || pickUrl(asRecord(rec.featured_snippet)?.item);
  const paa = rec.people_also_ask;
  return {
    organic,
    featured_snippet_url: snippet,
    has_paa: Array.isArray(paa) && paa.length > 0,
  };
}

export type InspectSerpResult = {
  ok: boolean;
  entry?: OpenRushSerpEntry;
  error?: string;
  credits_note?: string;
};

export async function inspectSerpQuery(opts: {
  query: string;
  contentRoot?: string;
  contentFolder?: string;
  targetUrl?: string;
  ourHosts?: Set<string>;
}): Promise<InspectSerpResult> {
  const query = opts.query.trim();
  if (!query) return { ok: false, error: "query is required" };
  const key = getOpenRushApiKey();
  if (!key) return { ok: false, error: "OPENRUSH_API_KEY is not set" };
  const settings = getOpenRushSettings(opts.contentRoot);
  if (!settings.enabled) return { ok: false, error: "OpenRush is disabled in settings" };

  const depth = Math.min(100, Math.max(10, settings.serp_top_n || 20));
  try {
    const res = await fetch(OPENRUSH_SERP_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        query,
        location: settings.location || "United States",
        language: settings.language || "English",
        depth,
      }),
    });
    const body = (await res.json().catch(() => null)) as Record<string, unknown> | null;
    if (!res.ok) {
      const message =
        (typeof body?.error === "string" && body.error) ||
        (typeof body?.message === "string" && body.message) ||
        `OpenRush HTTP ${res.status}`;
      return { ok: false, error: message };
    }
    const data = body?.data ?? body;
    const parsed = parseInspectSerpData(data);
    const target = opts.targetUrl || "";
    const ourRank = target ? rankOfUrlInOrganic(target, parsed.organic) : findOurRank(parsed.organic, opts.ourHosts);
    const entry: OpenRushSerpEntry = {
      query,
      fetched_at: new Date().toISOString(),
      organic: parsed.organic,
      featured_snippet_url: parsed.featured_snippet_url,
      has_paa: parsed.has_paa,
      our_serp_rank: ourRank,
      visible_in_serp: ourRank != null,
    };
    upsertSerpEntry(entry, opts.contentFolder);
    return {
      ok: true,
      entry,
      credits_note: `inspect_serp uses ${OPENRUSH_INSPECT_SERP_CREDITS} OpenRush credits`,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    log.warn({ err, query }, "[openrush] inspect_serp failed");
    return { ok: false, error: message };
  }
}

function findOurRank(organic: OpenRushOrganicHit[], ourHosts?: Set<string>): number | null {
  if (!ourHosts || ourHosts.size === 0) return null;
  for (const hit of organic) {
    const loc = normalizePageUrl(hit.url);
    if (loc && [...ourHosts].some((h) => h === loc.host)) return hit.rank;
  }
  return null;
}

export type ParsedInspectKeyword = {
  keyword: string;
  monthly_volume: number | null;
  kw_difficulty: number | null;
  competition_level: string | number | null;
  intent: string | null;
};

function clampDifficulty(n: number): number {
  const scaled = n > 0 && n <= 1 ? n * 100 : n;
  return Math.round(Math.min(100, Math.max(0, scaled)));
}

function mapKeywordDifficulty(data: Record<string, unknown>): number | null {
  for (const key of ["difficulty", "keyword_difficulty", "kd", "competition_score"]) {
    const v = data[key];
    if (typeof v === "number" && Number.isFinite(v)) return clampDifficulty(v);
  }
  const comp = data.competition_level ?? data.competition;
  if (typeof comp === "number" && Number.isFinite(comp)) return clampDifficulty(comp);
  if (typeof comp === "string" && comp.trim()) {
    const label = comp.trim().toLowerCase().replace(/[\s-]+/g, "_");
    const map: Record<string, number> = {
      low: 20,
      medium: 50,
      moderate: 50,
      high: 80,
      very_high: 90,
      very_hard: 90,
    };
    return map[label] ?? null;
  }
  return null;
}

function mapMonthlyVolume(data: Record<string, unknown>): number | null {
  for (const key of ["monthly_volume", "search_volume", "volume", "avg_monthly_searches"]) {
    const v = data[key];
    if (typeof v === "number" && Number.isFinite(v) && v >= 0) return Math.round(v);
  }
  return null;
}

export function parseInspectKeywordData(data: unknown, fallbackKeyword: string): ParsedInspectKeyword {
  const rec = asRecord(data) || {};
  const keywordRaw = rec.keyword;
  const keyword =
    typeof keywordRaw === "string" && keywordRaw.trim() ? keywordRaw.trim() : fallbackKeyword;
  const competition = rec.competition_level ?? rec.competition ?? null;
  const intentRaw = rec.intent;
  return {
    keyword,
    monthly_volume: mapMonthlyVolume(rec),
    kw_difficulty: mapKeywordDifficulty(rec),
    competition_level:
      typeof competition === "string" || typeof competition === "number" ? competition : null,
    intent: typeof intentRaw === "string" && intentRaw.trim() ? intentRaw.trim() : null,
  };
}

export type InspectKeywordResult = {
  ok: boolean;
  metrics?: ParsedInspectKeyword;
  entry?: OpenRushKeywordEntry;
  error?: string;
  credits_note?: string;
};

export async function inspectKeywordQuery(opts: {
  keyword: string;
  contentRoot?: string;
  contentFolder?: string;
}): Promise<InspectKeywordResult> {
  const keyword = opts.keyword.trim();
  if (!keyword) return { ok: false, error: "keyword is required" };
  const key = getOpenRushApiKey();
  if (!key) return { ok: false, error: "OPENRUSH_API_KEY is not set" };
  const settings = getOpenRushSettings(opts.contentRoot);
  if (!settings.enabled) return { ok: false, error: "OpenRush is disabled in settings" };

  const location = settings.location || "United States";
  const language = settings.language || "English";

  try {
    const res = await fetch(OPENRUSH_KEYWORD_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        keyword,
        location,
        language,
      }),
    });
    const body = (await res.json().catch(() => null)) as Record<string, unknown> | null;
    if (!res.ok) {
      const message =
        (typeof body?.error === "string" && body.error) ||
        (typeof body?.message === "string" && body.message) ||
        `OpenRush HTTP ${res.status}`;
      return { ok: false, error: message };
    }
    const data = body?.data ?? body;
    const dataRec =
      data && typeof data === "object" && !Array.isArray(data)
        ? (data as Record<string, unknown>)
        : null;
    const metrics = parseInspectKeywordData(data, keyword);
    const entry = upsertKeywordEntry(
      {
        keyword: metrics.keyword,
        location,
        language,
        monthly_volume: metrics.monthly_volume,
        kw_difficulty: metrics.kw_difficulty,
        payload: dataRec,
      },
      opts.contentFolder,
    );
    return {
      ok: true,
      metrics: {
        ...metrics,
        monthly_volume: entry.monthly_volume,
        kw_difficulty: entry.kw_difficulty,
      },
      entry,
      credits_note: `inspect_keyword uses ${OPENRUSH_INSPECT_KEYWORD_CREDITS} OpenRush credits`,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    log.warn({ err, keyword }, "[openrush] inspect_keyword failed");
    return { ok: false, error: message };
  }
}

export async function testOpenRushConnection(
  contentRoot?: string,
): Promise<{ ok: boolean; error?: string; elapsed_ms: number; api_key_configured: boolean }> {
  const started = Date.now();
  const api_key_configured = Boolean(getOpenRushApiKey());
  if (!api_key_configured) {
    return {
      ok: false,
      error: "OPENRUSH_API_KEY is not set",
      elapsed_ms: Date.now() - started,
      api_key_configured,
    };
  }
  const settings = getOpenRushSettings(contentRoot);
  if (!settings.enabled) {
    return {
      ok: false,
      error: "OpenRush is disabled in settings",
      elapsed_ms: Date.now() - started,
      api_key_configured,
    };
  }
  const result = await inspectSerpQuery({ query: "openrush", contentRoot });
  return {
    ok: result.ok,
    error: result.error,
    elapsed_ms: Date.now() - started,
    api_key_configured,
  };
}

const OPENRUSH_CREDITS_URL = "https://api.openrush.com/v1/me/credits";

export type OpenRushCreditsResult = {
  ok: boolean;
  balance: number | null;
  error?: string;
};

/** GET /v1/me/credits — remaining account balance (docs: credits-and-rate-limits). */
export async function fetchOpenRushCreditsBalance(): Promise<OpenRushCreditsResult> {
  const key = getOpenRushApiKey();
  if (!key) return { ok: false, balance: null, error: "OPENRUSH_API_KEY is not set" };
  try {
    const res = await fetch(OPENRUSH_CREDITS_URL, {
      method: "GET",
      headers: { Authorization: `Bearer ${key}` },
    });
    const body = (await res.json().catch(() => null)) as Record<string, unknown> | null;
    if (!res.ok) {
      const message =
        (typeof body?.error === "string" && body.error) ||
        (typeof body?.message === "string" && body.message) ||
        `OpenRush HTTP ${res.status}`;
      return { ok: false, balance: null, error: message };
    }
    const data = (body?.data && typeof body.data === "object" ? body.data : body) as Record<
      string,
      unknown
    > | null;
    const raw = data?.balance ?? data?.credits ?? body?.balance;
    const balance = typeof raw === "number" && Number.isFinite(raw) ? raw : null;
    if (balance == null) {
      return { ok: false, balance: null, error: "OpenRush credits response missing balance" };
    }
    return { ok: true, balance };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    log.warn({ err }, "[openrush] fetch credits failed");
    return { ok: false, balance: null, error: message };
  }
}
