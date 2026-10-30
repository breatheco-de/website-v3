import type { Request, Response, NextFunction } from "express";
import { findEntryItem, listTypePages, loadEntry } from "./entry-layer";
import yaml from "js-yaml";
import { escapeTemplateVars, unescapeObjectVars } from "@shared/templateVars";
import { contentIndex, type ContentIndex, type RedirectEntry } from "./content-index";
import { databaseManager } from "./database";
import { buildSingleEntryFromContent } from "./build-single-entry";
import { resolveSingleVars } from "./single-resolver";
import {
  getAllConfigs,
  getContentTypeConfig,
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
import { resolveLocaleHomeAliasTarget } from "./locale-home-alias";
import { slugKey } from "@shared/slug";
import { resolveEntryRef } from "./entry-ref";
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

function stripTrailingSlash(urlPath: string): string {
  return urlPath.length > 1 && urlPath.endsWith("/") ? urlPath.slice(0, -1) : urlPath;
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
 * Single pass with a replacer: capture values come from the visitor's URL and are
 * inserted literally (never re-scanned for `$2`, `$&`, …).
 */
export function applyCaptureGroups(target: string, captureGroups: string[]): string {
  const lowercaseCaptures = !/^https?:\/\//i.test(target);
  return target.replace(/\$(\d+)/g, (match, digits: string) => {
    // Longest group number that exists wins; trailing digits stay literal ("$12" with one group → value + "2").
    for (let len = digits.length; len > 0; len--) {
      const value = captureGroups[Number(digits.slice(0, len)) - 1];
      if (value !== undefined) {
        return (lowercaseCaptures ? value.toLowerCase() : value) + digits.slice(len);
      }
    }
    return match;
  });
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

const ENTRY_VAR_IN_TARGET = /\{\{\s*(?:entry|single)\./;

/**
 * Turn `{{ entry.field }}` / `{{ single.field }}` in a redirect target into that
 * field on the visited entry. A target with no entry variable is unchanged.
 * Empty, missing, or leftover `{{ … }}` means this rule does not redirect.
 * Only a site path or an http(s) URL is followed.
 */
export function redirectTargetFromEntryBag(
  target: string,
  bag: Record<string, unknown> | null,
): string | null {
  if (!ENTRY_VAR_IN_TARGET.test(target)) return target;
  if (!bag) return null;
  const resolved = resolveSingleVars(target, bag);
  if (typeof resolved !== "string") return null;
  const trimmed = resolved.trim();
  if (!trimmed || trimmed.includes("{{")) return null;
  if (trimmed.startsWith("/") && !trimmed.startsWith("//")) return trimmed;
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  return null;
}

function entryBagForRedirect(ci: ContentIndex, requestPath: string): Record<string, unknown> | null {
  let parsed: ReturnType<ContentIndex["parseContentUrl"]>;
  try {
    parsed = ci.parseContentUrl(requestPath.split("?")[0] || "/");
  } catch (err) {
    log.warn({ err }, "[Redirects] could not read the entry for a redirect target");
    return null;
  }
  if (!parsed?.contentType || !parsed.slug) return null;

  const config = getContentTypeConfig(parsed.contentType, ci.contentRoot);
  if (config?.database?.slug) {
    return findEntryItem(ci, parsed.contentType, parsed.slug, parsed.locale) ?? null;
  }

  try {
    const loaded = loadEntry(ci, parsed.contentType, parsed.slug, parsed.locale);
    if (!loaded) return null;
    if (loaded.singleEntry && Object.keys(loaded.singleEntry).length > 0) return loaded.singleEntry;
    return (
      buildSingleEntryFromContent(parsed.contentType, loaded.data, {
        slug: parsed.slug,
        locale: parsed.locale,
        contentRoot: ci.contentRoot,
      }) ?? null
    );
  } catch (err) {
    log.warn({ err }, "[Redirects] could not read the entry for a redirect target");
    return null;
  }
}

export function applyEntryVarsToRedirectTarget(
  target: string,
  requestPath: string,
  ci: ContentIndex,
): string | null {
  if (!ENTRY_VAR_IN_TARGET.test(target)) return target;
  return redirectTargetFromEntryBag(target, entryBagForRedirect(ci, requestPath));
}

/**
 * Append the inbound query string to a redirect target. When the target already has a query,
 * the two are merged (inbound wins on the same key) so the result never has a second `?`.
 */
export function mergeQueryIntoTarget(target: string, originalUrl: string): string {
  const qIndex = originalUrl.indexOf("?");
  if (qIndex < 0) return target;
  const inbound = originalUrl.slice(qIndex + 1).split("#")[0] ?? "";
  if (!inbound) return target;
  const hashIndex = target.indexOf("#");
  const hash = hashIndex >= 0 ? target.slice(hashIndex) : "";
  const base = hashIndex >= 0 ? target.slice(0, hashIndex) : target;
  const tq = base.indexOf("?");
  if (tq < 0) return `${base}?${inbound}${hash}`;
  const merged = new URLSearchParams(base.slice(tq + 1));
  const incoming = new URLSearchParams(inbound);
  for (const key of Array.from(new Set(incoming.keys()))) {
    const [first, ...rest] = incoming.getAll(key);
    merged.set(key, first ?? "");
    for (const v of rest) merged.append(key, v);
  }
  const qs = merged.toString();
  return `${base.slice(0, tq)}${qs ? `?${qs}` : ""}${hash}`;
}

function withInboundQuery(target: string, req: Request): string {
  return mergeQueryIntoTarget(target, req.originalUrl);
}

/**
 * True when following `target` would request the same path again (a guaranteed browser loop).
 * Case or trailing-slash differences are not loops: the next hop matches exactly and stops here.
 */
export function isSelfRedirectTarget(requestPath: string, host: string | undefined, target: string): boolean {
  const base = `http://${host || "localhost"}`;
  let parsed: URL;
  try {
    parsed = new URL(target, base);
  } catch {
    return false;
  }
  if (parsed.host !== new URL(base).host) return false;
  return parsed.pathname === requestPath;
}

function sendRedirect(
  req: Request,
  res: Response,
  next: NextFunction,
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
  if (isSelfRedirectTarget(req.path, req.headers.host, opts.to)) {
    log.warn(`[Redirects] Skipped self-redirect${opts.logLabel ? ` ${opts.logLabel}` : ""}: ${opts.from} -> ${opts.to} (source: ${opts.source ?? "unknown"})`);
    next();
    return;
  }
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

/** Sends the redirect, or returns false when an entry variable is empty so the page is served. */
function dispatchRedirect(
  req: Request,
  res: Response,
  next: NextFunction,
  ci: ContentIndex,
  entry: RedirectEntry,
  opts: {
    matchType: RedirectTraceMatchType;
    logLabel?: string;
    captureGroups?: string[];
  },
): boolean {
  const raw = resolveRedirectTarget(entry, req, opts.captureGroups);
  const resolved = applyEntryVarsToRedirectTarget(raw, req.path, ci);
  if (resolved == null) return false;
  sendRedirect(req, res, next, {
    from: req.path,
    to: withInboundQuery(resolved, req),
    status: entry.status || 301,
    matchType: opts.matchType,
    priority: entry.priority,
    source: entry.source,
    logLabel: opts.logLabel,
  });
  return true;
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
  const ci = siteCi || contentIndex;
  const contentRoot =
    ((res.locals.site as any)?.contentRoot as string | undefined) || ci.contentRoot;
  const homeAliasTarget = resolveLocaleHomeAliasTarget(req.path, ci, contentRoot);
  if (homeAliasTarget) {
    sendRedirect(req, res, next, {
      from: req.path,
      to: withInboundQuery(homeAliasTarget, req),
      status: 301,
      matchType: "exact",
      source: "locale-home-alias",
      logLabel: "(locale-home-alias)",
    });
    return;
  }

  const siteMaps = siteCi ? _getSiteRedirectMaps(siteCi) : null;
  const map = siteMaps ? siteMaps.map : getRedirectMap();
  const regexBefore = siteMaps ? siteMaps.regexBefore : (regexRedirectsBefore || []);
  const normalizedPath = normalizePath(req.path);

  const entry = map.get(normalizedPath);
  if (entry) {
    if (!dispatchRedirect(req, res, next, ci, entry, { matchType: "exact" })) next();
    return;
  }

  for (const { regex, entry: regexEntry } of regexBefore) {
    const match = req.path.match(regex);
    if (match) {
      if (
        !dispatchRedirect(req, res, next, ci, regexEntry, {
          matchType: "regex",
          logLabel: "(regex)",
          captureGroups: match.slice(1),
        })
      ) {
        next();
      }
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
      if (
        !dispatchRedirect(req, res, next, activeCi, entry, {
          matchType: "fallback",
          logLabel: "(fallback non-custom)",
        })
      ) {
        next();
      }
      return;
    }
  }

  if (activeRegexFbNonCustom) {
    for (const { regex, entry: regexEntry } of activeRegexFbNonCustom) {
      const match = req.path.match(regex);
      if (match) {
        if (
          !dispatchRedirect(req, res, next, activeCi, regexEntry, {
            matchType: "fallback",
            logLabel: "(fallback non-custom regex)",
            captureGroups: match.slice(1),
          })
        ) {
          next();
        }
        return;
      }
    }
  }

  // Canonical redirect for content types with multi-param URL patterns (e.g. blog
  // `:category/:slug`). Known live URLs skip fallback redirects entirely so slug
  // collisions across content types (program vs blog) are not hijacked; wrong/missing
  // blog category params on unknown URLs still redirect to the canonical blog path.
  const cleanUrl = req.path.split("?")[0].split("#")[0];
  const cleanUrlNoSlash = stripTrailingSlash(cleanUrl);
  try {
    if (activeCi.isKnownUrl(cleanUrlNoSlash)) {
      next();
      return;
    }
  } catch {}

  try {
    const soft = findCanonicalSoftMatch(cleanUrlNoSlash, activeCi);
    if (soft) {
      const target = withInboundQuery(soft.canonicalUrl, req);
      sendRedirect(req, res, next, {
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
    if (activeCi.isKnownUrl(cleanUrlNoSlash)) {
      next();
      return;
    }
  } catch {}

  if (activeFallbackMap) {
    const entry = activeFallbackMap.get(normalizedPath);
    if (entry) {
      if (
        !dispatchRedirect(req, res, next, activeCi, entry, {
          matchType: "fallback",
          logLabel: "(fallback)",
        })
      ) {
        next();
      }
      return;
    }
  }

  if (activeRegexFb) {
    const reachMaps = getActiveRedirectMaps(siteCi);
    const locale = detectLocale(req);
    for (const { regex, entry: regexEntry } of activeRegexFb) {
      const match = req.path.match(regex);
      if (match) {
        const captureGroups = match.slice(1);
        const resolved = applyEntryVarsToRedirectTarget(
          resolveRedirectTarget(regexEntry, req, captureGroups),
          req.path,
          activeCi,
        );
        if (resolved == null) continue;
        const reachable = resolveReachableTarget(resolved, locale, activeCi, reachMaps);
        if (!reachable) continue;
        const status = regexEntry.status || 301;
        const target = withInboundQuery(reachable, req);
        sendRedirect(req, res, next, {
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

  // Last resort before a 404: another spelling of a real address (capitals, underscores, accents).
  try {
    const normalized = findNormalizedSlugMatch(cleanUrlNoSlash, activeCi);
    if (normalized) {
      sendRedirect(req, res, next, {
        from: cleanUrl,
        to: withInboundQuery(normalized.canonicalUrl, req),
        status: 301,
        matchType: "canonical",
        priority: "fallback",
        source: `slug-key:${normalized.typeName}`,
        logLabel: `(slug key ${normalized.typeName})`,
      });
      return;
    }
  } catch {}

  next();
}

/**
 * When an unknown URL differs from a live page's official address only in spelling
 * (capitals, underscores, accents, repeated hyphens), return that official address.
 * Same URL pattern and params are required; the last segment is resolved by `slugKey`.
 */
export function findNormalizedSlugMatch(
  cleanUrl: string,
  ci: ContentIndex = contentIndex,
): { typeName: string; canonicalUrl: string } | null {
  const normalizedUrl = stripTrailingSlash(cleanUrl);
  if (ci.isKnownUrl(normalizedUrl)) return null;
  const segments = normalizedUrl.split("/").filter(Boolean);
  const lastSegment = segments[segments.length - 1];
  if (!lastSegment || !slugKey(lastSegment)) return null;
  const requestShape = segments.slice(0, -1).map((s) => slugKey(s));

  const found = new Map<string, string>();
  for (const typeName of ci.getContentTypes()) {
    const pattern = ci.getContentTypeConfig(typeName)?.url_pattern;
    if (!pattern) continue;
    for (const [patternLocale, urlPattern] of Object.entries(pattern)) {
      const patternSegments = urlPattern.split("/").filter(Boolean);
      if (patternSegments.length !== segments.length) continue;
      if (patternSegments[patternSegments.length - 1] !== ":slug") continue;
      const staticOk = patternSegments
        .slice(0, -1)
        .every((p, i) => p.startsWith(":") || slugKey(p) === requestShape[i]);
      if (!staticOk) continue;
      const locale = patternLocale === "default" ? (localePrefixFromPath(normalizedUrl) ?? "en") : patternLocale;
      const resolved = resolveEntryRef(ci, {
        contentType: typeName,
        ref: lastSegment,
        locale,
        localeExplicit: true,
        indexOnly: true,
      });
      if (!resolved.ok) continue;
      const canonicalUrl = ci.getAlternateUrls(resolved.entryId, typeName)[locale];
      if (!canonicalUrl || canonicalUrl === normalizedUrl || !ci.isKnownUrl(canonicalUrl)) continue;
      const canonicalShape = canonicalUrl.split("/").filter(Boolean).map((s) => slugKey(s));
      if (canonicalShape.length !== segments.length) continue;
      if (!canonicalShape.every((s, i) => s === slugKey(segments[i]!))) continue;
      found.set(canonicalUrl, typeName);
    }
  }
  if (found.size !== 1) return null;
  const [[canonicalUrl, typeName]] = [...found.entries()];
  return { typeName: typeName!, canonicalUrl: canonicalUrl! };
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
  const normalizedUrl = stripTrailingSlash(cleanUrl);
  // Do not rewrite URLs that already resolve to a live page (e.g. program and blog
  // entries can share a locale slug under different content-type URL patterns).
  if (ci.isKnownUrl(normalizedUrl)) return null;

  const segments = normalizedUrl.split("/").filter(Boolean);
  const lastSegment = segments[segments.length - 1];
  if (!lastSegment) return null;
  const lastSegmentLower = lastSegment.toLowerCase();

  const localeMatch = normalizedUrl.match(/^\/([a-z]{2})\//);
  const locale = localeMatch?.[1] ?? "en";

  for (const [typeName, typeConfig] of Object.entries(getAllConfigs())) {
    if (!typeConfig.url_pattern) continue;
    if (listExtraUrlPatternParams(typeConfig.url_pattern).length === 0) continue;

    let canonicalUrl: string | null = null;
    let matched = false;

    const listed = listTypePages(ci, typeName);
    if (listed) {
      const page =
        listed.pages.find((p) => p.slug.toLowerCase() === lastSegmentLower && p.locale === locale) ??
        listed.pages.find((p) => p.slug.toLowerCase() === lastSegmentLower);
      if (!page) continue;
      matched = true;
      const record = page.item;
      const canonicalLocale = typeConfig.url_pattern[page.locale] ? page.locale : locale;
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
      canonicalUrl !== normalizedUrl &&
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

function makeResult(
  entry: RedirectEntry,
  locale: string,
  matchType: "exact" | "regex",
  urlPath: string,
  ci: ContentIndex,
  priority?: string,
  captureGroups?: string[],
): RedirectTestResult | null {
  const resolvedTo = applyEntryVarsToRedirectTarget(
    resolveTarget(entry, locale, captureGroups),
    urlPath,
    ci,
  );
  if (resolvedTo == null) return null;
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

const MAX_FALLBACK_CHAIN_HOPS = 3;

function matchRedirectHop(
  urlPath: string,
  normalized: string,
  locale: string,
  maps: RedirectMaps,
  ci: ContentIndex,
): string | null {
  const exact = maps.map.get(normalized) ?? maps.fallbackNonCustomMap.get(normalized) ?? maps.fallbackMap.get(normalized);
  if (exact) {
    return applyEntryVarsToRedirectTarget(resolveTarget(exact, locale), urlPath, ci);
  }
  for (const list of [maps.regexBefore, maps.regexFallbackNonCustom]) {
    for (const { regex, entry } of list) {
      const m = urlPath.match(regex);
      if (!m) continue;
      return applyEntryVarsToRedirectTarget(resolveTarget(entry, locale, m.slice(1)), urlPath, ci);
    }
  }
  return null;
}

/**
 * Final URL a custom regex fallback should send the visitor to, or null when the
 * destination never reaches a live page (caller tries the next rule, then 404).
 * Category fixes and redirect chains collapse into a single hop.
 */
function resolveReachableTarget(
  target: string,
  locale: string,
  ci: typeof contentIndex,
  maps: RedirectMaps,
  visited: Set<string> = new Set(),
): string | null {
  if (/^https?:\/\//i.test(target)) return target;
  const urlPath = stripTrailingSlash(toPublicUrlPath(target));
  const normalized = normalizePath(urlPath);
  if (ci.isKnownUrl(urlPath) || ci.isKnownUrl(normalized)) return target;
  try {
    const soft = findCanonicalSoftMatch(urlPath, ci);
    if (soft) return soft.canonicalUrl;
  } catch {}
  if (visited.has(normalized) || visited.size >= MAX_FALLBACK_CHAIN_HOPS) return null;
  visited.add(normalized);
  const next = matchRedirectHop(urlPath, normalized, locale, maps, ci);
  return next ? resolveReachableTarget(next, locale, ci, maps, visited) : null;
}

function getActiveRedirectMaps(siteCi: typeof contentIndex | undefined): RedirectMaps {
  if (siteCi) return _getSiteRedirectMaps(siteCi);
  const map = getRedirectMap();
  return {
    map,
    regexBefore: regexRedirectsBefore ?? [],
    fallbackMap: fallbackMap ?? new Map(),
    regexFallback: regexRedirectsFallback ?? [],
    fallbackNonCustomMap: fallbackNonCustomMap ?? new Map(),
    regexFallbackNonCustom: regexRedirectsFallbackNonCustom ?? [],
  };
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

  const known = () => ci.isKnownUrl(urlPath) || ci.isKnownUrl(normalized);

  const exact = maps.map.get(normalized);
  if (exact) {
    const result = makeResult(exact, locale, "exact", urlPath, ci);
    if (result) return withDestinationExists(result, ci);
  } else {
    for (const { regex, entry } of maps.regexBefore) {
      const m = urlPath.match(regex);
      if (!m) continue;
      const result = makeResult(entry, locale, "regex", urlPath, ci, undefined, m.slice(1));
      if (result) return withDestinationExists(result, ci);
      break;
    }
  }

  const fbNc = maps.fallbackNonCustomMap.get(normalized);
  if (fbNc) {
    const result = makeResult(fbNc, locale, "exact", urlPath, ci, "fallback");
    if (result) return withDestinationExists(result, ci);
    return { match: false, pageExists: known() };
  }

  for (const { regex, entry } of maps.regexFallbackNonCustom) {
    const m = urlPath.match(regex);
    if (!m) continue;
    const result = makeResult(entry, locale, "regex", urlPath, ci, "fallback", m.slice(1));
    if (result) return withDestinationExists(result, ci);
    return { match: false, pageExists: known() };
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
    if (fb) {
      const result = makeResult(fb, locale, "exact", urlPath, ci, "fallback");
      if (result) return withDestinationExists(result, ci);
      return { match: false, pageExists: false };
    }

    for (const { regex, entry } of maps.regexFallback) {
      const m = urlPath.match(regex);
      if (!m) continue;
      const result = makeResult(entry, locale, "regex", urlPath, ci, "fallback", m.slice(1));
      if (!result?.resolvedTo) continue;
      const reachable = resolveReachableTarget(result.resolvedTo, locale, ci, maps);
      if (!reachable) continue;
      return { ...result, resolvedTo: reachable, destinationExists: true };
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
 * Live content URL for overwrite checks: content-index known URLs only
 * (same stack as Redirects → Test / MCP inspect). Locale-home aliases always
 * return false (they must 301 to canonical homes).
 *
 * Validators must not invent “live” paths from folder slugs × locale patterns —
 * call this (or isKnownUrl) instead of building a parallel URL set.
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

// ============================================================================
// Redirect-list signatures (for content_file_written → redirects_changed gating)
// ============================================================================

function redirectsFromDoc(data: unknown): unknown {
  if (!data || typeof data !== "object" || Array.isArray(data)) return null;
  const doc = data as Record<string, unknown>;
  const top = Array.isArray(doc.redirects) ? doc.redirects : null;
  const meta =
    doc.meta && typeof doc.meta === "object" && !Array.isArray(doc.meta)
      ? (doc.meta as Record<string, unknown>)
      : null;
  const metaRedirects = meta && Array.isArray(meta.redirects) ? meta.redirects : null;
  if (!top && !metaRedirects) return null;
  return { redirects: top, metaRedirects };
}

/**
 * Stable string for redirect arrays in a YAML file, or `""` when none.
 * `custom-redirects.yml` callers should treat any content change as redirects change.
 */
export function computeRedirectsSignature(raw: string): string {
  if (!raw || typeof raw !== "string") return "";
  try {
    const { escaped, map } = escapeTemplateVars(raw);
    const parsed = yaml.load(escaped);
    const unescaped = unescapeObjectVars(parsed, map);
    const extracted = redirectsFromDoc(unescaped);
    if (extracted == null) return "";
    return JSON.stringify(extracted);
  } catch {
    if (/(?:^|\n)\s*redirects\s*:/.test(raw)) return `raw:${raw.length}`;
    return "";
  }
}

/** True when redirect lists differ between previous and next file contents. */
export function didRedirectsChange(
  previousRaw: string | undefined | null,
  nextRaw: string,
  opts?: { isCustomRedirectsFile?: boolean },
): boolean {
  if (opts?.isCustomRedirectsFile) {
    return (previousRaw ?? "") !== nextRaw;
  }
  const prevSig = previousRaw != null ? computeRedirectsSignature(previousRaw) : undefined;
  const nextSig = computeRedirectsSignature(nextRaw);
  if (prevSig === undefined) {
    // First observation: seed only, no event.
    return false;
  }
  return prevSig !== nextSig;
}
