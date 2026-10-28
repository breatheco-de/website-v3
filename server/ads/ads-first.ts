/**
 * Ads-first pages: content types with `ads.optimize` on. Resolves a public path to its
 * flagged content type, signs the short-lived page token used by the site's own visit
 * counting, and injects the per-request page boot config (`window.__4G_PAGE__`) into HTML.
 */

import { createHmac, timingSafeEqual } from "crypto";
import type { Request, Response } from "express";
import type { ContentIndex } from "../content-index";
import { getAdsOptimizedTypes } from "../content-types";
import { normalizeAnalyticsPath } from "../ecommerce/journey-analytics";
import { getConsentWindowSettings } from "../settings";
import { geoGet } from "../geo-cache";
import { clientIpFromRequest, countryFromHeaders } from "./visitor-country";
import { normalizeCountryCode, resolveConsentMode, type ConsentMode } from "@shared/consent";

const INDEX_TTL_MS = 5 * 60 * 1000;
const HOUR_MS = 60 * 60 * 1000;
const TOKEN_VALID_HOURS = 24;

type PathIndex = { key: string; paths: Map<string, string>; builtAt: number };
const indexCache = new Map<string, PathIndex>();

/** Flagged public paths of a site → content type. Rebuilt when the flagged types change or after 5 minutes. */
export function adsFirstPathIndex(
  site: string,
  ci: ContentIndex,
  contentRoot?: string,
  now = Date.now(),
): Map<string, string> {
  const types = getAdsOptimizedTypes(contentRoot).sort();
  const key = types.join(",");
  const hit = indexCache.get(site);
  if (hit && hit.key === key && now - hit.builtAt < INDEX_TTL_MS) return hit.paths;
  const paths = new Map<string, string>();
  for (const type of types) {
    let entries: ReturnType<ContentIndex["findByType"]> = [];
    try {
      entries = ci.findByType(type);
    } catch {
      continue;
    }
    for (const e of entries) {
      let urls: Record<string, string> = {};
      try {
        urls = ci.getLocaleUrls(e.slug, e.contentType) ?? {};
      } catch {
        continue;
      }
      for (const url of Object.values(urls)) {
        const p = typeof url === "string" ? normalizeAnalyticsPath(url) : "";
        if (p) paths.set(p, type);
      }
    }
  }
  indexCache.set(site, { key, paths, builtAt: now });
  return paths;
}

export function clearAdsFirstPathIndex(): void {
  indexCache.clear();
}

export function adsFirstTypeForPath(site: string, ci: ContentIndex, contentRoot: string | undefined, rawPath: string): string | null {
  const p = normalizeAnalyticsPath(rawPath);
  if (!p) return null;
  return adsFirstPathIndex(site, ci, contentRoot).get(p) ?? null;
}

export function isAdsFirstPath(site: string, ci: ContentIndex, contentRoot: string | undefined, rawPath: string): boolean {
  return adsFirstTypeForPath(site, ci, contentRoot, rawPath) !== null;
}

// ── Page token ──────────────────────────────────────────────────────────────

function tokenSecret(): string {
  return process.env.SESSION_SECRET || "local-page-token";
}

function sign(site: string, hour: number): string {
  return createHmac("sha256", tokenSecret()).update(`${site}:${hour}`).digest("base64url").slice(0, 22);
}

/** `<hour base36>.<signature>`; valid for 24 hours. Not visitor-specific. */
export function issuePageToken(site: string, now = Date.now()): string {
  const hour = Math.floor(now / HOUR_MS);
  return `${hour.toString(36)}.${sign(site, hour)}`;
}

export function verifyPageToken(site: string, token: unknown, now = Date.now()): boolean {
  if (typeof token !== "string") return false;
  const dot = token.indexOf(".");
  if (dot <= 0) return false;
  const hour = parseInt(token.slice(0, dot), 36);
  if (!Number.isFinite(hour)) return false;
  const current = Math.floor(now / HOUR_MS);
  if (hour > current || current - hour > TOKEN_VALID_HOURS) return false;
  const given = Buffer.from(token.slice(dot + 1));
  const expected = Buffer.from(sign(site, hour));
  return given.length === expected.length && timingSafeEqual(given, expected);
}

// ── Page boot config ────────────────────────────────────────────────────────

/**
 * Short keys on purpose: af = ads-first page, cm = consent mode (ads-first only, and only when
 * the visitor's country is already known; otherwise null and ConsentBanner decides after its
 * country lookup), fp = own visit counting on, t = page token.
 */
export type PageBootConfig = { af: 0 | 1; cm: ConsentMode | null; fp: 0 | 1; t: string };

export const EMPTY_PAGE_BOOT: PageBootConfig = { af: 0, cm: null, fp: 0, t: "" };

const PAGE_BOOT_RE = /window\.__4G_PAGE__\s*=\s*\{[^<]*?\};/;

/**
 * Country without a network call: a proxy country header when one exists, else the shared
 * geo cache (filled by earlier lookups for this IP). Null when not known yet.
 */
export function fastVisitorCountry(req: Request): string | null {
  const fromHeader = countryFromHeaders(req);
  if (fromHeader) return fromHeader;
  const data = geoGet(clientIpFromRequest(req));
  return data && typeof data === "object" ? normalizeCountryCode((data as { countryCode?: unknown }).countryCode) : null;
}

type SiteLike = { contentRoot?: string; contentRootName?: string; contentIndex?: ContentIndex } | undefined;

export function resolvePageBoot(req: Request, res: Response, rawPath: string): PageBootConfig {
  const site = (res.locals as { site?: SiteLike }).site;
  if (!site?.contentIndex || !site.contentRootName) return EMPTY_PAGE_BOOT;
  let types: string[] = [];
  try {
    types = getAdsOptimizedTypes(site.contentRoot);
  } catch {
    return EMPTY_PAGE_BOOT;
  }
  if (types.length === 0) return EMPTY_PAGE_BOOT;
  const adsFirst = isAdsFirstPath(site.contentRootName, site.contentIndex, site.contentRoot, rawPath);
  let cm: ConsentMode | null = null;
  const country = adsFirst ? fastVisitorCountry(req) : null;
  if (country) {
    try {
      cm = resolveConsentMode(country, getConsentWindowSettings(site.contentRoot));
    } catch {
      cm = null;
    }
  }
  return { af: adsFirst ? 1 : 0, cm, fp: 1, t: issuePageToken(site.contentRootName) };
}

export function injectPageBoot(html: string, cfg: PageBootConfig): string {
  if (!PAGE_BOOT_RE.test(html)) return html;
  return html.replace(PAGE_BOOT_RE, () => `window.__4G_PAGE__ = ${JSON.stringify(cfg)};`);
}

/**
 * Resolve + inject for one HTML response. Ads-first pages carry a visitor-specific consent
 * mode, so they are marked private (shared caches must not store them).
 */
export function applyPageBoot(html: string, req: Request, res: Response): string {
  const rawPath = (req.originalUrl || req.url || "/").split("?")[0]!.split("#")[0]!;
  const cfg = resolvePageBoot(req, res, rawPath);
  if (cfg.af) (res.locals as { visitorSpecificHtml?: boolean }).visitorSpecificHtml = true;
  return injectPageBoot(html, cfg);
}

/** True when this response needs per-request injection (cached compressed bodies cannot be used). */
export function needsPageBoot(res: Response): boolean {
  const site = (res.locals as { site?: SiteLike }).site;
  if (!site?.contentRoot) return false;
  try {
    return getAdsOptimizedTypes(site.contentRoot).length > 0;
  } catch {
    return false;
  }
}
