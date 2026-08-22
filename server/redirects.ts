import type { Request, Response, NextFunction } from "express";
import { contentIndex, type RedirectEntry } from "./content-index";
import { databaseManager } from "./database";
import {
  getAllConfigs,
  getFieldMappingDefaults,
  getFullFieldMapping,
  getLocaleKey,
  listExtraUrlPatternParams,
  resolveUrlPatternWithMapping,
} from "./content-types";
import { child } from "./logger";
import { applyRedirectTraceCookie } from "./redirect-trace-cookie";
import type { RedirectTraceMatchType } from "@shared/redirect-trace";
import { localePrefixFromPath } from "@shared/runtime-issues";
import { isLocaleHomeAlias } from "@shared/public-app-routes";
const log = child({ module: "redirects" });

// ============================================================================
// Per-site redirect maps (multi-site isolation)
// ============================================================================

interface RedirectMaps {
  map: Map<string, RedirectEntry>;
  regexBefore: Array<{ regex: RegExp; entry: RedirectEntry }>;
  fallbackMap: Map<string, RedirectEntry>;
  regexFallback: Array<{ regex: RegExp; entry: RedirectEntry }>;
  fallbackNonCustomMap: Map<string, RedirectEntry>;
  regexFallbackNonCustom: Array<{ regex: RegExp; entry: RedirectEntry }>;
}

const _siteRedirectCache = new Map<typeof contentIndex, RedirectMaps>();

function _buildMapsFromEntries(entries: RedirectEntry[]): RedirectMaps {
  const map = new Map<string, RedirectEntry>();
  const regexBefore: Array<{ regex: RegExp; entry: RedirectEntry }> = [];
  const fbMap = new Map<string, RedirectEntry>();
  const regexFb: Array<{ regex: RegExp; entry: RedirectEntry }> = [];
  const fbNonCustomMap = new Map<string, RedirectEntry>();
  const regexFbNonCustom: Array<{ regex: RegExp; entry: RedirectEntry }> = [];

  for (const entry of entries) {
    const isFallback = entry.priority === "fallback";
    const isCustom = entry.type === "custom";

    if (isRegexPattern(entry.from)) {
      if (entry.from.length > 500) {
        log.warn(`[Redirects] Regex pattern too long, skipping: ${entry.from.substring(0, 50)}...`);
        continue;
      }
      try {
        const regex = new RegExp(`^${entry.from}$`, "i");
        if (isFallback) {
          if (isCustom) {
            regexFb.push({ regex, entry });
          } else {
            regexFbNonCustom.push({ regex, entry });
          }
        } else {
          regexBefore.push({ regex, entry });
        }
      } catch {
        log.warn(`[Redirects] Invalid regex pattern: ${entry.from}`);
      }
    } else {
      if (isFallback) {
        if (isCustom) {
          if (!fbMap.has(entry.from)) fbMap.set(entry.from, entry);
        } else {
          if (!fbNonCustomMap.has(entry.from)) fbNonCustomMap.set(entry.from, entry);
        }
      } else {
        if (!map.has(entry.from)) map.set(entry.from, entry);
      }
    }
  }

  return { map, regexBefore, fallbackMap: fbMap, regexFallback: regexFb, fallbackNonCustomMap: fbNonCustomMap, regexFallbackNonCustom: regexFbNonCustom };
}

function _getSiteRedirectMaps(ci: typeof contentIndex): RedirectMaps {
  if (_siteRedirectCache.has(ci)) return _siteRedirectCache.get(ci)!;
  const maps = _buildMapsFromEntries(ci.getRedirects());
  const totalFb = maps.fallbackMap.size + maps.regexFallback.length + maps.fallbackNonCustomMap.size + maps.regexFallbackNonCustom.length;
  log.info(`[Redirects] Per-site maps: ${maps.map.size} exact, ${maps.regexBefore.length} regex, ${totalFb} fallback`);
  _siteRedirectCache.set(ci, maps);
  return maps;
}

// ============================================================================
// Global redirect maps (single-site / backward-compat)
// ============================================================================

let redirectMap: Map<string, RedirectEntry> | null = null;
let regexRedirectsBefore: Array<{ regex: RegExp; entry: RedirectEntry }> | null = null;
let fallbackMap: Map<string, RedirectEntry> | null = null;
let regexRedirectsFallback: Array<{ regex: RegExp; entry: RedirectEntry }> | null = null;
let fallbackNonCustomMap: Map<string, RedirectEntry> | null = null;
let regexRedirectsFallbackNonCustom: Array<{ regex: RegExp; entry: RedirectEntry }> | null = null;

export function isRegexPattern(path: string): boolean {
  return /\(.*\)|\[.*\]|\.\*|\.\+|\\d|\\w|\\s|\{\d+[,}]/.test(path);
}

function buildRedirectMap(): Map<string, RedirectEntry> {
  const maps = _buildMapsFromEntries(contentIndex.getRedirects());
  redirectMap = maps.map;
  regexRedirectsBefore = maps.regexBefore;
  fallbackMap = maps.fallbackMap;
  regexRedirectsFallback = maps.regexFallback;
  fallbackNonCustomMap = maps.fallbackNonCustomMap;
  regexRedirectsFallbackNonCustom = maps.regexFallbackNonCustom;
  const totalFallback = maps.fallbackMap.size + maps.regexFallback.length + maps.fallbackNonCustomMap.size + maps.regexFallbackNonCustom.length;
  log.info(`[Redirects] Loaded ${maps.map.size} exact redirects, ${maps.regexBefore.length} regex redirects (before), ${totalFallback} fallback redirects (${maps.fallbackNonCustomMap.size + maps.regexFallbackNonCustom.length} non-custom)`);
  return maps.map;
}

function getRedirectMap(): Map<string, RedirectEntry> {
  if (!redirectMap) {
    redirectMap = buildRedirectMap();
  }
  return redirectMap;
}

function normalizePath(urlPath: string): string {
  let normalized = urlPath.toLowerCase();
  if (normalized.length > 1 && normalized.endsWith("/")) {
    normalized = normalized.slice(0, -1);
  }
  return normalized;
}

/** Path prefix (`/es/…`), then Accept-Language, then `en`. Used for multi-locale redirect targets. */
export function resolveRedirectRequestLocale(
  req: Pick<Request, "path" | "headers">,
): string {
  const fromPath = localePrefixFromPath(req.path);
  if (fromPath) return fromPath;

  const acceptLang = req.headers["accept-language"];
  if (acceptLang && typeof acceptLang === "string") {
    const primary = acceptLang.split(",")[0]?.trim().toLowerCase() || "";
    if (primary.startsWith("es")) return "es";
  }
  return "en";
}

function detectLocale(req: Request): string {
  return resolveRedirectRequestLocale(req);
}

/**
 * Substitute `$1`…`$n` in a redirect target. Relative (site) destinations lowercased
 * so case-insensitive regex matches still land on canonical lowercase content URLs.
 * Absolute http(s) destinations keep original capture casing (external IDs may be caseful).
 */
function applyCaptureGroups(target: string, captureGroups: string[]): string {
  const lowercaseCaptures = !/^https?:\/\//i.test(target);
  let out = target;
  for (let i = 0; i < captureGroups.length; i++) {
    const value = lowercaseCaptures ? captureGroups[i].toLowerCase() : captureGroups[i];
    out = out.replace(new RegExp(`\\$${i + 1}`, "g"), value);
  }
  return out;
}

function resolveRedirectTarget(entry: RedirectEntry, req: Request, captureGroups?: string[]): string {
  let target: string;
  if (typeof entry.to === "string") {
    target = entry.to;
  } else {
    const locale = detectLocale(req);
    target = entry.to[locale] || entry.to["en"] || Object.values(entry.to)[0] || "/";
  }

  if (captureGroups && captureGroups.length > 0) {
    target = applyCaptureGroups(target, captureGroups);
  }

  return target;
}

function getQueryString(req: Request): string {
  const url = req.originalUrl;
  const qIndex = url.indexOf('?');
  return qIndex >= 0 ? url.slice(qIndex) : '';
}

function sendRedirect(
  req: Request,
  res: Response,
  opts: {
    from: string;
    to: string;
    status: number;
    matchType: RedirectTraceMatchType;
    priority?: string;
    source?: string;
    logLabel?: string;
  },
): void {
  applyRedirectTraceCookie(req, res, {
    from: opts.from,
    to: opts.to,
    status: opts.status,
    matchType: opts.matchType,
    priority: opts.priority,
    source: opts.source,
  });
  log.info(`[Redirects] ${opts.status}${opts.logLabel ? ` ${opts.logLabel}` : ""}: ${opts.from} -> ${opts.to}`);
  res.redirect(opts.status, opts.to);
}

export function redirectMiddleware(req: Request, res: Response, next: NextFunction): void {
  if (
    req.path.startsWith("/api/") ||
    req.path.startsWith("/assets/") ||
    req.path.startsWith("/@") ||
    req.path.startsWith("/private/")
  ) {
    next();
    return;
  }

  const siteCi = (res.locals.site as any)?.contentIndex as typeof contentIndex | undefined;
  const siteMaps = siteCi ? _getSiteRedirectMaps(siteCi) : null;
  const map = siteMaps ? siteMaps.map : getRedirectMap();
  const regexBefore = siteMaps ? siteMaps.regexBefore : (regexRedirectsBefore || []);
  const normalizedPath = normalizePath(req.path);

  const entry = map.get(normalizedPath);
  if (entry) {
    const status = entry.status || 301;
    const target = resolveRedirectTarget(entry, req) + getQueryString(req);
    sendRedirect(req, res, {
      from: req.path,
      to: target,
      status,
      matchType: "exact",
      priority: entry.priority,
      source: entry.source,
    });
    return;
  }

  for (const { regex, entry: regexEntry } of regexBefore) {
    const match = req.path.match(regex);
    if (match) {
      const captureGroups = match.slice(1);
      const status = regexEntry.status || 301;
      const target = resolveRedirectTarget(regexEntry, req, captureGroups) + getQueryString(req);
      sendRedirect(req, res, {
        from: req.path,
        to: target,
        status,
        matchType: "regex",
        priority: regexEntry.priority,
        source: regexEntry.source,
        logLabel: "(regex)",
      });
      return;
    }
  }

  next();
}

export function fallbackRedirectMiddleware(req: Request, res: Response, next: NextFunction): void {
  // Admin / capture frames must never be rewritten to public content URLs
  // (canonical DB slug matching would steal `/private/entry-preview-frame/.../:slug`).
  if (
    req.path.startsWith("/api/") ||
    req.path.startsWith("/assets/") ||
    req.path.startsWith("/@") ||
    req.path.startsWith("/private/")
  ) {
    next();
    return;
  }

  const siteCi = (res.locals.site as any)?.contentIndex as typeof contentIndex | undefined;
  const siteMaps = siteCi ? _getSiteRedirectMaps(siteCi) : null;
  if (!siteMaps) getRedirectMap(); // ensure global maps are built for single-site mode
  const activeFallbackNonCustomMap = siteMaps ? siteMaps.fallbackNonCustomMap : fallbackNonCustomMap;
  const activeRegexFbNonCustom = siteMaps ? siteMaps.regexFallbackNonCustom : regexRedirectsFallbackNonCustom;
  const activeFallbackMap = siteMaps ? siteMaps.fallbackMap : fallbackMap;
  const activeRegexFb = siteMaps ? siteMaps.regexFallback : regexRedirectsFallback;
  const activeCi = siteCi ?? contentIndex;
  const normalizedPath = normalizePath(req.path);

  // Non-custom (content-defined) fallback redirects fire before the page check —
  // they take priority over any active page at the same URL.
  if (activeFallbackNonCustomMap) {
    const entry = activeFallbackNonCustomMap.get(normalizedPath);
    if (entry) {
      const status = entry.status || 301;
      const target = resolveRedirectTarget(entry, req) + getQueryString(req);
      sendRedirect(req, res, {
        from: req.path,
        to: target,
        status,
        matchType: "fallback",
        priority: entry.priority || "fallback",
        source: entry.source,
        logLabel: "(fallback non-custom)",
      });
      return;
    }
  }

  if (activeRegexFbNonCustom) {
    for (const { regex, entry: regexEntry } of activeRegexFbNonCustom) {
      const match = req.path.match(regex);
      if (match) {
        const captureGroups = match.slice(1);
        const status = regexEntry.status || 301;
        const target = resolveRedirectTarget(regexEntry, req, captureGroups) + getQueryString(req);
        sendRedirect(req, res, {
          from: req.path,
          to: target,
          status,
          matchType: "fallback",
          priority: regexEntry.priority || "fallback",
          source: regexEntry.source,
          logLabel: "(fallback non-custom regex)",
        });
        return;
      }
    }
  }

  // Canonical redirect for content types with multi-param URL patterns (e.g. blog
  // `:category/:slug`). Runs before isKnownUrl so wrong/missing extra params still
  // redirect — static types can match a pattern by slug alone even when category is wrong.
  const cleanUrl = req.path.split("?")[0].split("#")[0];
  try {
    const soft = findCanonicalSoftMatch(cleanUrl, activeCi);
    if (soft) {
      const target = soft.canonicalUrl + getQueryString(req);
      sendRedirect(req, res, {
        from: cleanUrl,
        to: target,
        status: 301,
        matchType: "canonical",
        priority: "fallback",
        source: `canonical:${soft.typeName}`,
        logLabel: `(canonical ${soft.typeName})`,
      });
      return;
    }
  } catch {}

  // Custom fallback redirects only fire when no real page exists at this URL.
  try {
    if (activeCi.isKnownUrl(cleanUrl)) {
      next();
      return;
    }
  } catch {}

  if (activeFallbackMap) {
    const entry = activeFallbackMap.get(normalizedPath);
    if (entry) {
      const status = entry.status || 301;
      const target = resolveRedirectTarget(entry, req) + getQueryString(req);
      sendRedirect(req, res, {
        from: req.path,
        to: target,
        status,
        matchType: "fallback",
        priority: entry.priority || "fallback",
        source: entry.source,
        logLabel: "(fallback)",
      });
      return;
    }
  }

  if (activeRegexFb) {
    for (const { regex, entry: regexEntry } of activeRegexFb) {
      const match = req.path.match(regex);
      if (match) {
        const captureGroups = match.slice(1);
        const status = regexEntry.status || 301;
        const target = resolveRedirectTarget(regexEntry, req, captureGroups) + getQueryString(req);
        sendRedirect(req, res, {
          from: req.path,
          to: target,
          status,
          matchType: "fallback",
          priority: regexEntry.priority || "fallback",
          source: regexEntry.source,
          logLabel: "(fallback regex)",
        });
        return;
      }
    }
  }

  next();
}

export function getRedirects(): Array<{ from: string; to: string | Record<string, string>; type: string; status: number; source: string; priority?: string }> {
  const map = getRedirectMap();
  const result: Array<{ from: string; to: string | Record<string, string>; type: string; status: number; source: string; priority?: string }> = [];

  for (const [from, entry] of map) {
    result.push({
      from,
      to: entry.to,
      type: entry.type,
      status: entry.status || 301,
      source: entry.source,
      priority: entry.priority,
    });
  }

  if (fallbackMap) {
    for (const [from, entry] of fallbackMap) {
      result.push({
        from,
        to: entry.to,
        type: entry.type,
        status: entry.status || 301,
        source: entry.source,
        priority: entry.priority,
      });
    }
  }

  if (regexRedirectsBefore) {
    for (const { entry } of regexRedirectsBefore) {
      result.push({
        from: entry.from,
        to: entry.to,
        type: entry.type,
        status: entry.status || 301,
        source: entry.source,
        priority: entry.priority,
      });
    }
  }

  if (regexRedirectsFallback) {
    for (const { entry } of regexRedirectsFallback) {
      result.push({
        from: entry.from,
        to: entry.to,
        type: entry.type,
        status: entry.status || 301,
        source: entry.source,
        priority: entry.priority,
      });
    }
  }

  return result;
}

export function lookupRedirect(urlPath: string): RedirectEntry | undefined {
  const map = getRedirectMap();
  const normalized = normalizePath(urlPath);

  const exact = map.get(normalized);
  if (exact) return exact;

  if (fallbackMap) {
    const fbExact = fallbackMap.get(normalized);
    if (fbExact) return fbExact;
  }

  if (regexRedirectsBefore) {
    for (const { regex, entry } of regexRedirectsBefore) {
      if (regex.test(urlPath)) {
        return entry;
      }
    }
  }

  if (regexRedirectsFallback) {
    for (const { regex, entry } of regexRedirectsFallback) {
      if (regex.test(urlPath)) {
        return entry;
      }
    }
  }

  return undefined;
}

export interface RedirectTestResult {
  match: boolean;
  from?: string;
  to?: string | Record<string, string>;
  resolvedTo?: string;
  status?: number;
  priority?: string;
  source?: string;
  matchType?: "exact" | "regex" | "canonical";
  captureGroups?: string[];
  pageExists?: boolean;
  destinationExists?: boolean;
}

/**
 * Canonical soft-match for multi-param URL patterns (e.g. blog `:category/:slug`).
 * When the last path segment equals a real entry slug but other params differ,
 * returns the canonical public URL. Missing slug → null (no inventing posts).
 */
export function findCanonicalSoftMatch(
  cleanUrl: string,
  ci: typeof contentIndex = contentIndex,
): { typeName: string; canonicalUrl: string } | null {
  const segments = cleanUrl.split("/").filter(Boolean);
  const lastSegment = segments[segments.length - 1];
  if (!lastSegment) return null;
  const lastSegmentLower = lastSegment.toLowerCase();

  const localeMatch = cleanUrl.match(/^\/([a-z]{2})\//);
  const locale = localeMatch?.[1] ?? "en";

  for (const [typeName, typeConfig] of Object.entries(getAllConfigs())) {
    if (!typeConfig.url_pattern) continue;
    if (listExtraUrlPatternParams(typeConfig.url_pattern).length === 0) continue;

    let canonicalUrl: string | null = null;
    let matched = false;

    if (typeConfig.database?.slug) {
      const items = databaseManager.getMappedItems(typeConfig.database.slug);
      if (!items) continue;
      const record = items.find(
        (item) => String(item.slug || "").toLowerCase() === lastSegmentLower,
      );
      if (!record) continue;
      matched = true;
      const localeField = getLocaleKey(typeName);
      const rawLocale =
        (localeField && record[localeField]) ||
        record["language"] ||
        record["lang"] ||
        record["locale"];
      const recordLocale = rawLocale ? String(rawLocale) : locale;
      const canonicalLocale = typeConfig.url_pattern[recordLocale] ? recordLocale : locale;
      const urlPattern =
        typeConfig.url_pattern[canonicalLocale] ??
        typeConfig.url_pattern["en"] ??
        typeConfig.url_pattern["default"];
      if (urlPattern) {
        const fieldMapping = getFullFieldMapping(typeName);
        const defaults = getFieldMappingDefaults(typeName);
        canonicalUrl = resolveUrlPatternWithMapping(
          urlPattern,
          record,
          canonicalLocale,
          fieldMapping,
          defaults,
        );
      }
    } else {
      let matches = ci.findBySlug(lastSegment, { contentType: typeName });
      if (matches.length === 0 && lastSegment !== lastSegmentLower) {
        matches = ci.findBySlug(lastSegmentLower, { contentType: typeName });
      }
      if (matches.length === 0) continue;
      matched = true;
      const slugKey = matches[0]?.slug || lastSegmentLower;
      const urls = ci.getAlternateUrls(slugKey, typeName);
      canonicalUrl = urls[locale] || urls.en || Object.values(urls)[0] || null;
    }

    // Only soft-match onto a URL that actually resolves in the content index.
    // Otherwise a broken alternate (e.g. blog :category dropped when locale YAML
    // fails to parse) would 301 live `/en/blog/:category/:slug` → truncated path.
    if (
      matched &&
      canonicalUrl &&
      canonicalUrl !== cleanUrl &&
      ci.isKnownUrl(canonicalUrl)
    ) {
      return { typeName, canonicalUrl };
    }
    if (matched) return null;
  }

  return null;
}

function resolveTarget(entry: RedirectEntry, locale: string, captureGroups?: string[]): string {
  let target = typeof entry.to === "string" ? entry.to : (entry.to[locale] || entry.to["en"] || Object.values(entry.to)[0] || "/");
  if (captureGroups) {
    target = applyCaptureGroups(target, captureGroups);
  }
  return target;
}

function makeResult(entry: RedirectEntry, locale: string, matchType: "exact" | "regex", priority?: string, captureGroups?: string[]): RedirectTestResult {
  const resolvedTo = resolveTarget(entry, locale, captureGroups);
  return {
    match: true,
    from: entry.from,
    to: entry.to,
    resolvedTo,
    status: entry.status || 301,
    priority: priority || entry.priority || "before",
    source: entry.source,
    matchType,
    captureGroups,
  };
}

export function toPublicUrlPath(rawInput: string): string {
  let urlPath = rawInput;
  try {
    if (/^https?:\/\//i.test(urlPath)) {
      urlPath = new URL(urlPath).pathname;
    }
  } catch {}
  urlPath = urlPath.split("?")[0].split("#")[0];
  if (!urlPath.startsWith("/")) urlPath = "/" + urlPath;
  return urlPath;
}

function withDestinationExists(
  result: RedirectTestResult,
  ci: typeof contentIndex,
): RedirectTestResult {
  if (!result.match || !result.resolvedTo) return result;
  if (/^https?:\/\//i.test(result.resolvedTo)) {
    return { ...result, destinationExists: true };
  }
  const dest = toPublicUrlPath(result.resolvedTo);
  return { ...result, destinationExists: ci.isKnownUrl(dest) };
}

function evaluatePublicUrl(
  rawInput: string,
  locale: string,
  ci: typeof contentIndex,
  maps: RedirectMaps,
): RedirectTestResult {
  const urlPath = toPublicUrlPath(rawInput);
  const normalized = normalizePath(urlPath);

  const exact = maps.map.get(normalized);
  if (exact) return withDestinationExists(makeResult(exact, locale, "exact"), ci);

  for (const { regex, entry } of maps.regexBefore) {
    const m = urlPath.match(regex);
    if (m) return withDestinationExists(makeResult(entry, locale, "regex", undefined, m.slice(1)), ci);
  }

  const fbNc = maps.fallbackNonCustomMap.get(normalized);
  if (fbNc) return withDestinationExists(makeResult(fbNc, locale, "exact", "fallback"), ci);

  for (const { regex, entry } of maps.regexFallbackNonCustom) {
    const m = urlPath.match(regex);
    if (m) return withDestinationExists(makeResult(entry, locale, "regex", "fallback", m.slice(1)), ci);
  }

  const soft = findCanonicalSoftMatch(urlPath, ci);
  if (soft) {
    return withDestinationExists(
      {
        match: true,
        from: urlPath,
        to: soft.canonicalUrl,
        resolvedTo: soft.canonicalUrl,
        status: 301,
        priority: "fallback",
        source: `canonical:${soft.typeName}`,
        matchType: "canonical",
        pageExists: false,
      },
      ci,
    );
  }

  const isKnown = ci.isKnownUrl(urlPath);

  if (!isKnown) {
    const fb = maps.fallbackMap.get(normalized);
    if (fb) return withDestinationExists(makeResult(fb, locale, "exact", "fallback"), ci);

    for (const { regex, entry } of maps.regexFallback) {
      const m = urlPath.match(regex);
      if (m) return withDestinationExists(makeResult(entry, locale, "regex", "fallback", m.slice(1)), ci);
    }
  }

  return { match: false, pageExists: isKnown };
}

/** Same answer as Redirects → Test a URL: existing page, or redirect to a live destination. */
export function isLivePublicUrl(result: RedirectTestResult): boolean {
  if (result.pageExists) return true;
  return result.match === true && result.destinationExists === true;
}

export function createPublicUrlResolver(
  ci: typeof contentIndex = contentIndex,
  opts?: { freshRedirects?: boolean },
) {
  const maps = _buildMapsFromEntries(
    opts?.freshRedirects === false ? ci.getRedirects() : getFreshRedirectEntries(ci),
  );
  return {
    test(rawInput: string, locale: string = "en"): RedirectTestResult {
      return evaluatePublicUrl(rawInput, locale, ci, maps);
    },
    isLive(rawInput: string, locale: string = "en"): boolean {
      return isLivePublicUrl(evaluatePublicUrl(rawInput, locale, ci, maps));
    },
  };
}

/**
 * Fresh redirect entries for debug tools.
 * Re-reads custom redirects from disk when the index is already complete; otherwise
 * triggers a full slow rebuild so the UI never sees a custom-only snapshot.
 * Does not leave the index in a misleading ready state.
 */
export function getFreshRedirectEntries(
  ci: typeof contentIndex = contentIndex,
): RedirectEntry[] {
  try {
    return ci.refreshCustomRedirects();
  } catch (err) {
    log.warn({ err }, "[Redirects] refreshCustomRedirects failed in getFreshRedirectEntries");
    return ci.getRedirects();
  }
}

export function testRedirect(
  rawInput: string,
  locale: string = "en",
  /** Active site's content index — must match live middleware / add-redirect checks. */
  ci: typeof contentIndex = contentIndex,
): RedirectTestResult {
  // Debug tester prioritizes correctness over speed: always re-read from disk and
  // build maps from scratch (never the live request cache).
  return createPublicUrlResolver(ci, { freshRedirects: true }).test(rawInput, locale);
}

export type RedirectConflictKind = "duplicate_from" | "regex_shadowed" | "overwrites_content";

export interface RedirectInspectConflict {
  kind: RedirectConflictKind;
  from: string;
  source?: string;
  to?: string | Record<string, string>;
  message: string;
}

export interface RedirectInspectFix {
  id: string;
  kind: string;
  file?: string;
  from: string;
  effect: string;
  requires_confirmation: boolean;
  args_hint: Record<string, unknown>;
}

export interface RedirectInspectResult {
  winner: RedirectTestResult;
  conflicts: RedirectInspectConflict[];
  fixes: RedirectInspectFix[];
  /** Content-index known URLs only; locale-home aliases (`/`, `/en`, `/es`, `/us`) are never live. */
  live_content: boolean;
}

export function isCustomRedirectSource(source: string | undefined): boolean {
  return /(?:^|\/)custom-redirects\.yml$/.test(source || "");
}

/**
 * Live content URL for overwrite checks: content-index known URLs only.
 * Locale-home aliases always return false (they must 301 to canonical homes).
 */
export function isLiveContentUrl(
  rawPath: string,
  ci: typeof contentIndex = contentIndex,
): boolean {
  const urlPath = toPublicUrlPath(rawPath);
  const normalized = normalizePath(urlPath);
  if (isLocaleHomeAlias(normalized) || isLocaleHomeAlias(urlPath)) return false;
  return ci.isKnownUrl(urlPath) || ci.isKnownUrl(normalized);
}

function normalizeRedirectFrom(from: string): string {
  let n = from.toLowerCase();
  if (!n.startsWith("/")) n = `/${n}`;
  if (n.length > 1 && n.endsWith("/")) n = n.slice(0, -1);
  return n;
}

function entryMatchesPath(entry: RedirectEntry, urlPath: string, normalized: string): boolean {
  if (isRegexPattern(entry.from)) {
    try {
      return new RegExp(`^${entry.from}$`, "i").test(urlPath);
    } catch {
      return false;
    }
  }
  return normalizeRedirectFrom(entry.from) === normalized;
}

function isSameWinner(entry: RedirectEntry, winner: RedirectTestResult): boolean {
  if (!winner.match || !winner.from) return false;
  if ((entry.source || "") !== (winner.source || "")) return false;
  if (isRegexPattern(entry.from) || winner.matchType === "regex") {
    return entry.from === winner.from;
  }
  return normalizeRedirectFrom(entry.from) === normalizeRedirectFrom(winner.from);
}

function buildInspectFixes(
  winner: RedirectTestResult,
  conflicts: RedirectInspectConflict[],
): RedirectInspectFix[] {
  const fixes: RedirectInspectFix[] = [];
  const winnerFrom = winner.from || "";

  const winnerResolved = winner.resolvedTo
    ? normalizePath(toPublicUrlPath(winner.resolvedTo))
    : "";
  if (
    winner.match &&
    winnerFrom &&
    winner.source &&
    !winner.source.startsWith("canonical:") &&
    normalizeRedirectFrom(winnerFrom) === winnerResolved
  ) {
    fixes.push({
      id: "delete_self_redirect",
      kind: "self_redirect",
      file: winner.source,
      from: winnerFrom,
      effect: "Remove the self-redirect so the URL is no longer a loop.",
      requires_confirmation: false,
      args_hint: {
        tool: "update_redirect",
        action: "delete",
        from: winnerFrom,
        source: winner.source,
      },
    });
  }

  for (const conflict of conflicts) {
    if (conflict.kind === "duplicate_from" && conflict.source) {
      fixes.push({
        id: `delete_duplicate:${conflict.source}`,
        kind: "duplicate_from",
        file: conflict.source,
        from: conflict.from,
        effect: `Remove the duplicate from ${conflict.source}. The winner rule still fires.`,
        requires_confirmation: false,
        args_hint: {
          tool: "update_redirect",
          action: "delete",
          from: conflict.from,
          source: conflict.source,
        },
      });
    }
    if (conflict.kind === "regex_shadowed" && conflict.source && winner.from) {
      const custom = isCustomRedirectSource(conflict.source) && isCustomRedirectSource(winner.source);
      fixes.push({
        id: `move_above:${conflict.from}`,
        kind: "regex_shadowed",
        file: conflict.source,
        from: conflict.from,
        effect: custom
          ? `Move this rule above ${winner.from} so it matches first.`
          : "This regex is shadowed; only custom-redirects.yml rules can be reordered with before_from.",
        requires_confirmation: false,
        args_hint: custom
          ? {
              tool: "update_redirect",
              action: "move",
              from: conflict.from,
              before_from: winner.from,
            }
          : {
              tool: "update_redirect",
              action: "delete",
              from: conflict.from,
              source: conflict.source,
            },
      });
    }
    if (conflict.kind === "overwrites_content" && winner.source && winnerFrom) {
      fixes.push({
        id: "remove_overwrite_redirect",
        kind: "overwrites_content",
        file: winner.source,
        from: winnerFrom,
        effect:
          "Remove the redirect so the live URL is no longer overwritten. Confirm with the user: the path will no longer 301.",
        requires_confirmation: true,
        args_hint: {
          tool: "update_redirect",
          action: "delete",
          from: winnerFrom,
          source: winner.source,
          confirm_overwrite_content: true,
        },
      });
      fixes.push({
        id: "keep_overwrite_alias",
        kind: "overwrites_content",
        file: winner.source,
        from: winnerFrom,
        effect:
          "Keep the 301. Locale-home aliases (/ , /en, /es, /us) are not live content; other paths stay flagged until the content index no longer lists them.",
        requires_confirmation: true,
        args_hint: {
          tool: "update_redirect",
        },
      });
    }
  }

  return fixes;
}

/**
 * First-match winner plus other claims (duplicates, shadowed regex, live-URL overwrite).
 * Does not mutate. Pass `winner` to reuse an already-tested result.
 */
export function inspectRedirect(
  rawInput: string,
  locale: string = "en",
  ci: typeof contentIndex = contentIndex,
  winner?: RedirectTestResult,
): RedirectInspectResult {
  const resolvedWinner = winner ?? testRedirect(rawInput, locale, ci);
  const urlPath = toPublicUrlPath(rawInput);
  const normalized = normalizePath(urlPath);
  const liveContent = isLiveContentUrl(normalized, ci);
  const entries = getFreshRedirectEntries(ci);
  const conflicts: RedirectInspectConflict[] = [];

  if (resolvedWinner.match && resolvedWinner.from && !resolvedWinner.source?.startsWith("canonical:")) {
    for (const entry of entries) {
      if (isSameWinner(entry, resolvedWinner)) continue;
      if (!entryMatchesPath(entry, urlPath, normalized)) continue;

      const sameFrom =
        !isRegexPattern(entry.from) &&
        resolvedWinner.matchType !== "regex" &&
        normalizeRedirectFrom(entry.from) === normalizeRedirectFrom(resolvedWinner.from);

      if (sameFrom) {
        conflicts.push({
          kind: "duplicate_from",
          from: entry.from,
          source: entry.source,
          to: entry.to,
          message: `Also claimed by ${entry.source} (does not fire; first-match winner is ${resolvedWinner.source}).`,
        });
        continue;
      }

      if (isRegexPattern(entry.from)) {
        conflicts.push({
          kind: "regex_shadowed",
          from: entry.from,
          source: entry.source,
          to: entry.to,
          message: `Pattern also matches but never runs (shadowed by ${resolvedWinner.from} from ${resolvedWinner.source}).`,
        });
      }
    }

    if (liveContent) {
      conflicts.push({
        kind: "overwrites_content",
        from: resolvedWinner.from,
        source: resolvedWinner.source,
        to: resolvedWinner.to,
        message: `Redirect "${normalized}" conflicts with an existing content URL.`,
      });
    }
  }

  return {
    winner: resolvedWinner,
    conflicts,
    fixes: buildInspectFixes(resolvedWinner, conflicts),
    live_content: liveContent,
  };
}

export function clearRedirectCache(): void {
  redirectMap = null;
  regexRedirectsBefore = null;
  fallbackMap = null;
  regexRedirectsFallback = null;
  fallbackNonCustomMap = null;
  regexRedirectsFallbackNonCustom = null;
  _siteRedirectCache.clear();
  log.info("[Redirects] Cache cleared (global + all per-site)");
}
