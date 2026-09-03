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

const log = child({ module: "openrush-client" });

const OPENRUSH_SERP_URL = "https://api.openrush.com/v1/tools/inspect_serp";

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
    return { ok: true, entry, credits_note: "inspect_serp uses 2 OpenRush credits" };
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
