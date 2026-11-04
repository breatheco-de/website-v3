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
import { readKeywordDifficulty, type KeywordDifficultySource } from "./openrush-keyword-difficulty";

const log = child({ module: "openrush-client" });

const OPENRUSH_SERP_URL = "https://api.openrush.com/v1/tools/inspect_serp";
const OPENRUSH_KEYWORD_URL = "https://api.openrush.com/v1/tools/inspect_keyword";
const OPENRUSH_RESEARCH_KEYWORDS_URL = "https://api.openrush.com/v1/tools/research_keywords";
const OPENRUSH_DISCOVER_COMPETITORS_URL = "https://api.openrush.com/v1/tools/discover_competitors";
const OPENRUSH_COMPARE_KEYWORD_COVERAGE_URL =
  "https://api.openrush.com/v1/tools/compare_keyword_coverage";

/** Official OpenRush credit cost for `inspect_keyword` (see credits docs). */
export const OPENRUSH_INSPECT_KEYWORD_CREDITS = 5;

/** Official OpenRush credit cost for `inspect_serp` (see credits docs). */
export const OPENRUSH_INSPECT_SERP_CREDITS = 2;

export const OPENRUSH_RESEARCH_KEYWORDS_CREDITS = 3;
export const OPENRUSH_DISCOVER_COMPETITORS_CREDITS = 7;
export const OPENRUSH_COMPARE_KEYWORD_COVERAGE_CREDITS = 12;

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
    const location = settings.location || "United States";
    const language = settings.language || "English";
    const entry: OpenRushSerpEntry = {
      query,
      fetched_at: new Date().toISOString(),
      organic: parsed.organic,
      featured_snippet_url: parsed.featured_snippet_url,
      has_paa: parsed.has_paa,
      our_serp_rank: ourRank,
      visible_in_serp: ourRank != null,
      location,
      language,
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
  kw_difficulty_source: KeywordDifficultySource | null;
  competition_level: string | number | null;
  intent: string | null;
};

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
  const difficulty = readKeywordDifficulty(rec);
  const intentRaw = rec.intent;
  return {
    keyword,
    monthly_volume: mapMonthlyVolume(rec),
    kw_difficulty: difficulty.value,
    kw_difficulty_source: difficulty.source,
    competition_level: difficulty.competition_level,
    intent: typeof intentRaw === "string" && intentRaw.trim() ? intentRaw.trim() : null,
  };
}

export type InspectKeywordResult = {
  ok: boolean;
  metrics?: ParsedInspectKeyword;
  entry?: OpenRushKeywordEntry;
  error?: string;
  credits_note?: string;
  /** Auth / account / disabled — bulk callers should abort remaining fetches. */
  fatal?: boolean;
};

export async function inspectKeywordQuery(opts: {
  keyword: string;
  contentRoot?: string;
  contentFolder?: string;
}): Promise<InspectKeywordResult> {
  const keyword = opts.keyword.trim();
  if (!keyword) return { ok: false, error: "keyword is required" };
  const key = getOpenRushApiKey();
  if (!key) return { ok: false, error: "OPENRUSH_API_KEY is not set", fatal: true };
  const settings = getOpenRushSettings(opts.contentRoot);
  if (!settings.enabled) {
    return { ok: false, error: "OpenRush is disabled in settings", fatal: true };
  }

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
      const fatal = res.status === 401 || res.status === 403 || res.status === 402;
      return { ok: false, error: message, fatal };
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
        kw_difficulty_source: metrics.kw_difficulty_source,
        competition_level: metrics.competition_level,
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
        kw_difficulty_source: entry.kw_difficulty_source ?? null,
        competition_level: entry.competition_level ?? null,
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

async function openRushPost(
  url: string,
  body: Record<string, unknown>,
  contentRoot?: string,
): Promise<{ ok: true; data: unknown } | { ok: false; error: string; fatal?: boolean }> {
  const key = getOpenRushApiKey();
  if (!key) return { ok: false, error: "OPENRUSH_API_KEY is not set", fatal: true };
  const settings = getOpenRushSettings(contentRoot);
  if (!settings.enabled) {
    return { ok: false, error: "OpenRush is disabled in settings", fatal: true };
  }
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });
    const json = (await res.json().catch(() => null)) as Record<string, unknown> | null;
    if (!res.ok) {
      const message =
        (typeof json?.error === "string" && json.error) ||
        (typeof json?.message === "string" && json.message) ||
        `OpenRush HTTP ${res.status}`;
      const fatal = res.status === 401 || res.status === 403 || res.status === 402;
      return { ok: false, error: message, fatal };
    }
    return { ok: true, data: json?.data ?? json };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

export type ResearchKeywordsResult = {
  ok: boolean;
  data?: Record<string, unknown>;
  error?: string;
  credits_note?: string;
  fatal?: boolean;
};

export async function researchKeywordsQuery(opts: {
  seed: string;
  contentRoot?: string;
  mode?: string;
  limit?: number;
  min_volume?: number;
  intent?: string;
}): Promise<ResearchKeywordsResult> {
  const seed = opts.seed.trim();
  if (!seed) return { ok: false, error: "seed is required" };
  const settings = getOpenRushSettings(opts.contentRoot);
  const location = settings.location || "United States";
  const language = settings.language || "English";
  const body: Record<string, unknown> = {
    seed,
    location,
    language,
    mode: opts.mode || "ideas",
    limit: opts.limit ?? 25,
  };
  if (opts.min_volume != null) body.min_volume = opts.min_volume;
  if (opts.intent) body.intent = opts.intent;
  const res = await openRushPost(OPENRUSH_RESEARCH_KEYWORDS_URL, body, opts.contentRoot);
  if (!res.ok) return { ok: false, error: res.error, fatal: res.fatal };
  const data =
    res.data && typeof res.data === "object" && !Array.isArray(res.data)
      ? (res.data as Record<string, unknown>)
      : { raw: res.data };
  return {
    ok: true,
    data,
    credits_note: `research_keywords uses ${OPENRUSH_RESEARCH_KEYWORDS_CREDITS} research credits`,
  };
}

export type DiscoverCompetitorsResult = {
  ok: boolean;
  data?: Record<string, unknown>;
  error?: string;
  credits_note?: string;
  fatal?: boolean;
};

export async function discoverCompetitorsQuery(opts: {
  contentRoot?: string;
  domain?: string;
  seed_keywords?: string[];
  limit?: number;
}): Promise<DiscoverCompetitorsResult> {
  const domain = opts.domain?.trim() || "";
  const seeds = (opts.seed_keywords || []).map((s) => s.trim()).filter(Boolean);
  if (!domain && seeds.length === 0) {
    return { ok: false, error: "domain or seed_keywords is required" };
  }
  const settings = getOpenRushSettings(opts.contentRoot);
  const body: Record<string, unknown> = {
    location: settings.location || "United States",
    language: settings.language || "English",
    limit: opts.limit ?? 10,
  };
  if (domain) body.domain = domain;
  if (seeds.length) body.seed_keywords = seeds;
  const res = await openRushPost(OPENRUSH_DISCOVER_COMPETITORS_URL, body, opts.contentRoot);
  if (!res.ok) return { ok: false, error: res.error, fatal: res.fatal };
  const data =
    res.data && typeof res.data === "object" && !Array.isArray(res.data)
      ? (res.data as Record<string, unknown>)
      : { raw: res.data };
  return {
    ok: true,
    data,
    credits_note: `discover_competitors uses ${OPENRUSH_DISCOVER_COMPETITORS_CREDITS} research credits`,
  };
}

export type CompareKeywordCoverageResult = {
  ok: boolean;
  data?: Record<string, unknown>;
  error?: string;
  credits_note?: string;
  fatal?: boolean;
};

export async function compareKeywordCoverageQuery(opts: {
  contentRoot?: string;
  domain: string;
  competitors: string[];
  limit?: number;
}): Promise<CompareKeywordCoverageResult> {
  const domain = opts.domain.trim();
  const competitors = opts.competitors.map((c) => c.trim()).filter(Boolean);
  if (!domain) return { ok: false, error: "domain is required" };
  if (competitors.length === 0) return { ok: false, error: "competitors is required" };
  const settings = getOpenRushSettings(opts.contentRoot);
  const res = await openRushPost(
    OPENRUSH_COMPARE_KEYWORD_COVERAGE_URL,
    {
      domain,
      competitors,
      location: settings.location || "United States",
      language: settings.language || "English",
      limit: opts.limit ?? 50,
    },
    opts.contentRoot,
  );
  if (!res.ok) return { ok: false, error: res.error, fatal: res.fatal };
  const data =
    res.data && typeof res.data === "object" && !Array.isArray(res.data)
      ? (res.data as Record<string, unknown>)
      : { raw: res.data };
  return {
    ok: true,
    data,
    credits_note: `compare_keyword_coverage uses ${OPENRUSH_COMPARE_KEYWORD_COVERAGE_CREDITS} research credits`,
  };
}
