/**
 * Per-locale URL slug helpers: resolve slug for YAML, uniqueness at go-live, redirect policy on rename.
 */

import fs from "fs";
import path from "path";
import type { ContentIndex } from "./content-index.js";
import {
  extractUrlPatternParams,
  getFieldMappingDefaults,
  getFolder,
  getFullFieldMapping,
} from "./content-types.js";
import { RESERVED_PUBLISHED_AT_FIELD } from "./published-at.js";
import { assessSlugLocaleMatch, SLUG_LOCALE_MISMATCH_CODE } from "@shared/slug-locale-heuristic";
import { isSlug, SLUG_FORMAT_HINT } from "@shared/slug";

export const LOCALE_URL_SLUG_REQUIRED = "locale_url_slug_required";
export const LOCALE_URL_SLUG_CONFLICT = "locale_url_slug_conflict";
export const URL_SLUG_REQUIRED = "url_slug_required";
export const IDEA_URL_SLUG_CONFLICT = "idea_url_slug_conflict";
export const URL_SLUG_OVERRIDE_INVALID = "url_slug_override_invalid";

/** Min reason length when an edit's slug differs from the idea's locked url_slug. */
export const URL_SLUG_REASON_MIN = 40;

export type UrlSlugOverride = { reason: string };

export function parseUrlSlugOverride(raw: unknown): UrlSlugOverride | null {
  if (!raw || typeof raw !== "object") return null;
  const reason = (raw as { reason?: unknown }).reason;
  return typeof reason === "string" && reason.trim() ? { reason: reason.trim() } : null;
}

export function validateUrlSlugOverride(
  raw: unknown,
): { ok: true; override: UrlSlugOverride | null } | { ok: false; code: string; error: string } {
  if (raw == null) return { ok: true, override: null };
  const parsed = parseUrlSlugOverride(raw);
  if (!parsed || parsed.reason.length < URL_SLUG_REASON_MIN) {
    return {
      ok: false,
      code: URL_SLUG_OVERRIDE_INVALID,
      error: `url_slug_override.reason must explain (min ${URL_SLUG_REASON_MIN} characters) why this address differs from the one the idea locked.`,
    };
  }
  return { ok: true, override: parsed };
}

export type LocaleUrlSlugGateResult =
  | { ok: true }
  | { ok: false; code: string; error: string; details: Record<string, unknown> };

/** `locale_url_slugs: { es: "que-es-x" }` from a publish request body (string values only). */
export function localeUrlSlugsFromBody(body: unknown): Record<string, string> | null {
  const raw = (body as { locale_url_slugs?: unknown } | null)?.locale_url_slugs;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const out: Record<string, string> = {};
  for (const [locale, slug] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof slug === "string" && slug.trim()) out[locale] = slug.trim();
  }
  return Object.keys(out).length ? out : null;
}

/** True when the type's URL pattern for this locale has a `:slug` segment. */
export function urlPatternUsesSlug(
  urlPattern: Record<string, string> | null | undefined,
  locale: string,
): boolean {
  const pattern = urlPattern?.[locale] || urlPattern?.["default"] || `/${locale}/:slug`;
  return /(^|\/):slug(\/|$)/.test(pattern);
}

/**
 * One address for every language (`url_pattern` is only `default`, no `:locale`), e.g.
 * /landing/:slug. Each language must then have its own slug, or two languages share one
 * address and only one of them can ever be shown.
 */
export function isSingleAddressPattern(urlPattern: Record<string, string> | null | undefined): boolean {
  const def = urlPattern?.default;
  if (typeof def !== "string" || !def.trim() || def.includes(":locale")) return false;
  return Object.keys(urlPattern ?? {}).every((k) => k === "default");
}

type SlugIndex = Pick<ContentIndex, "getAvailableLocalesOrVariants" | "getLocaleSlug" | "getContentTypeConfig" | "normalizeType">;

function isLiveLocaleStem(locale: string): boolean {
  return !locale.startsWith("_") && !locale.includes(".");
}

/** Public slug of each live language of an entry (own `slug:`, else `_common.yml` slug, else the folder name). */
export function liveLocaleSlugs(ci: SlugIndex, contentType: string, folderSlug: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const loc of ci.getAvailableLocalesOrVariants(contentType as never, folderSlug)) {
    if (!isLiveLocaleStem(loc)) continue;
    out[loc] = ci.getLocaleSlug(folderSlug, contentType, loc);
  }
  return out;
}

/** Groups of live languages sharing one address on a one-address type (empty when none or not one-address). */
export function findSingleAddressSlugConflicts(
  ci: SlugIndex,
  contentType: string,
  folderSlug: string,
): Array<{ slug: string; locales: string[] }> {
  const pattern = ci.getContentTypeConfig(ci.normalizeType(contentType))?.url_pattern;
  if (!isSingleAddressPattern(pattern)) return [];
  const bySlug = new Map<string, string[]>();
  for (const [loc, slug] of Object.entries(liveLocaleSlugs(ci, contentType, folderSlug))) {
    bySlug.set(slug, [...(bySlug.get(slug) ?? []), loc]);
  }
  return [...bySlug.entries()]
    .filter(([, locales]) => locales.length > 1)
    .map(([slug, locales]) => ({ slug, locales: locales.sort() }));
}

/** Other live languages that already use `newSlug` as their address (one-address types only). */
export function wouldConflict(
  ci: SlugIndex,
  contentType: string,
  folderSlug: string,
  locale: string,
  newSlug: string,
): string[] {
  const pattern = ci.getContentTypeConfig(ci.normalizeType(contentType))?.url_pattern;
  if (!isSingleAddressPattern(pattern)) return [];
  return Object.entries(liveLocaleSlugs(ci, contentType, folderSlug))
    .filter(([loc, slug]) => loc !== locale && slug === newSlug)
    .map(([loc]) => loc)
    .sort();
}

/**
 * Live language files in an entry folder → public slug (own `slug:`, else `commonSlug`, else
 * the folder name). Reads files directly; `load` parses YAML (template-safe loader).
 */
export function liveLocaleSlugsInFolder(
  folderPath: string,
  entryIdentity: string,
  load: (raw: string) => Record<string, unknown> | null | undefined,
  commonSlug?: string | null,
): Record<string, string> {
  const out: Record<string, string> = {};
  let files: string[] = [];
  try {
    files = fs.readdirSync(folderPath);
  } catch {
    return out;
  }
  for (const f of files) {
    const m = /^([a-z]{2}(?:-[a-z]{2})?)\.ya?ml$/.exec(f);
    if (!m) continue;
    let own: string | null = null;
    try {
      own = ownLocaleSlug(load(fs.readFileSync(path.join(folderPath, f), "utf-8")));
    } catch {
      own = null;
    }
    out[m[1]!] = own ?? commonSlug ?? entryIdentity;
  }
  return out;
}

/** Conflict check from already-known slugs per live language (no index needed). */
export function singleAddressConflictFor(opts: {
  urlPattern: Record<string, string> | null | undefined;
  slugsByLocale: Record<string, string>;
  locale: string;
  newSlug: string;
}): LocaleUrlSlugGateResult {
  if (!isSingleAddressPattern(opts.urlPattern)) return { ok: true };
  const others = Object.entries(opts.slugsByLocale)
    .filter(([loc, slug]) => loc !== opts.locale && slug === opts.newSlug)
    .map(([loc]) => loc)
    .sort();
  return conflictGateResult(opts.urlPattern?.default ?? "", opts.locale, others, opts.newSlug);
}

/** Gate result for a write that would give `locale` the same address as another language. */
export function singleAddressConflictResult(opts: {
  ci: SlugIndex;
  contentType: string;
  folderSlug: string;
  locale: string;
  newSlug: string;
}): LocaleUrlSlugGateResult {
  const others = wouldConflict(opts.ci, opts.contentType, opts.folderSlug, opts.locale, opts.newSlug);
  const pattern = opts.ci.getContentTypeConfig(opts.ci.normalizeType(opts.contentType))?.url_pattern?.default ?? "";
  return conflictGateResult(pattern, opts.locale, others, opts.newSlug);
}

function conflictGateResult(pattern: string, locale: string, others: string[], newSlug: string): LocaleUrlSlugGateResult {
  if (others.length === 0) return { ok: true };
  const address = pattern.replace(":slug", newSlug);
  const locales = [locale, ...others].sort();
  return {
    ok: false,
    code: LOCALE_URL_SLUG_CONFLICT,
    error:
      `Both languages would share ${address} (${locales.join(", ")}) and only one can be shown there. ` +
      `Give the ${locale} version its own slug.`,
    details: { address, locales, locale, slug: newSlug, property_path: "slug" },
  };
}

/** The language file's own `slug:` (not `_common.yml`), or null. */
export function ownLocaleSlug(localeData: Record<string, unknown> | null | undefined): string | null {
  const raw = localeData?.slug;
  return typeof raw === "string" && raw.trim() ? raw.trim() : null;
}

/**
 * New language on a page that already has another live language: the language file
 * must carry its own `slug:`. Without one, its URL reuses the folder name, which was
 * picked for the first language. Same word as the folder is allowed (deliberate keep).
 */
export function checkNewLocaleUrlSlug(opts: {
  draftOwnData: Record<string, unknown> | null | undefined;
  entryIdentity: string;
  contentType: string;
  locale: string;
  urlPattern: Record<string, string> | null | undefined;
}): LocaleUrlSlugGateResult {
  if (!urlPatternUsesSlug(opts.urlPattern, opts.locale)) return { ok: true };
  if (ownLocaleSlug(opts.draftOwnData)) return { ok: true };
  return {
    ok: false,
    code: LOCALE_URL_SLUG_REQUIRED,
    error:
      `${opts.contentType}/${opts.entryIdentity} (${opts.locale}) is a new language of a page that is already live in another language. ` +
      `Without its own slug its URL reuses "${opts.entryIdentity}", the address word picked for the other language. ` +
      `Set slug on the ${opts.locale} draft (same word is allowed when it is a name that works in every language).`,
    details: {
      locale: opts.locale,
      current_slug: opts.entryIdentity,
      suggested_field: "slug",
      property_path: "slug",
    },
  };
}

/**
 * Address an idea locks on accept. A new language of an existing page needs its own
 * `url_slug`; a brand-new page uses the folder name. Both must be well-formed, free,
 * and (unless acknowledged) not look like another language.
 */
export function checkAcceptedUrlSlug(opts: {
  contentType: string;
  folderSlug: string;
  locale: string;
  urlSlug?: string | null;
  isNewLanguage: boolean;
  ack?: boolean;
  /** Folder slug of the entry (same type) that already uses this URL word, or null. */
  ownerOf: (urlSlug: string) => string | null;
}): LocaleUrlSlugGateResult {
  const where = `${opts.contentType}/${opts.folderSlug} (${opts.locale})`;
  const explicit = typeof opts.urlSlug === "string" ? opts.urlSlug.trim() : "";
  if (opts.isNewLanguage && !explicit) {
    return {
      ok: false,
      code: URL_SLUG_REQUIRED,
      error:
        `${where} already exists in another language, so "${opts.folderSlug}" is that language's address. ` +
        `Pass accepted_entry.url_slug: the ${opts.locale} address word this idea locks.`,
      details: {
        locale: opts.locale,
        current_slug: opts.folderSlug,
        suggested_url_slug_field: "accepted_entry.url_slug",
      },
    };
  }
  const address = explicit || opts.folderSlug;
  const formatErr = validateLocaleUrlSlugFormat(address);
  if (formatErr) {
    return { ok: false, code: "invalid_locale_slug", error: formatErr, details: { url_slug: address } };
  }
  const owner = opts.ownerOf(address);
  if (owner && owner !== opts.folderSlug) {
    return {
      ok: false,
      code: "slug_already_owned_by_other_entry",
      error: `"${address}" is already the address of ${opts.contentType}/${owner}. Pick another address word.`,
      details: { url_slug: address, owner_slug: owner },
    };
  }
  const match = assessSlugLocaleMatch(address, opts.locale);
  if (!match.ok && opts.ack !== true) {
    const looksLike = match.inferredOpposite === "en" ? "English" : "Spanish";
    return {
      ok: false,
      code: SLUG_LOCALE_MISMATCH_CODE,
      error:
        `"${address}" looks ${looksLike} for a ${opts.locale} page (${match.markers.join(", ")}). ` +
        "Pick an address in this language, or pass slug_language_ack: true when it is a name that works in every language.",
      details: { url_slug: address, markers: match.markers, locale: opts.locale },
    };
  }
  return { ok: true };
}

const TWENTY_FOUR_HOURS_MS = 24 * 60 * 60 * 1000;

export function validateLocaleUrlSlugFormat(slug: string): string | null {
  if (!isSlug(slug)) {
    return `Invalid slug format. ${SLUG_FORMAT_HINT}`;
  }
  return null;
}

/** Effective public URL segment for a locale file. */
export function resolveLocaleUrlSlug(opts: {
  urlSlug?: string | null;
  existingSlug?: string | null;
  entryIdentity: string;
}): string {
  const trimmed = typeof opts.urlSlug === "string" ? opts.urlSlug.trim() : "";
  if (trimmed) return trimmed;
  const existing = typeof opts.existingSlug === "string" ? opts.existingSlug.trim() : "";
  if (existing) return existing;
  return opts.entryIdentity;
}

export function localeUrlSlugFromPageData(
  mergedPageData: Record<string, unknown>,
  entryIdentity: string,
): string {
  const raw = mergedPageData.slug;
  if (typeof raw === "string" && raw.trim()) return raw.trim();
  return entryIdentity;
}

export function entryAgeHours(publishedAt: unknown): number | null {
  if (publishedAt == null || publishedAt === "") return null;
  const ms = Date.parse(String(publishedAt));
  if (!Number.isFinite(ms)) return null;
  return (Date.now() - ms) / (60 * 60 * 1000);
}

export function readPublishedAtFromCommon(
  common: Record<string, unknown> | null | undefined,
): unknown {
  if (!common || typeof common !== "object") return undefined;
  return common[RESERVED_PUBLISHED_AT_FIELD];
}

export type RedirectPolicyResult =
  | { ok: true }
  | { ok: false; statusCode: number; error: string; code: string };

/** MCP rename policy: entries >= 24h old must pass create_redirect: true explicitly. */
export function assertCreateRedirectIfRequired(opts: {
  ageHours: number | null;
  createRedirect: boolean;
  isLiveSlugChange: boolean;
  enforceRedirectPolicy: boolean;
}): RedirectPolicyResult {
  if (!opts.enforceRedirectPolicy || !opts.isLiveSlugChange) {
    return { ok: true };
  }
  const age = opts.ageHours ?? 0;
  if (age < 24) return { ok: true };
  if (opts.createRedirect) return { ok: true };
  return {
    ok: false,
    statusCode: 400,
    code: "create_redirect_required",
    error:
      "Entry published_at is >= 24h ago. Live slug changes require create_redirect: true " +
      "(adds old URL to meta.redirects) or omit the slug change.",
  };
}

export type LocaleUrlAvailableResult =
  | { ok: true; url: string; localeSlug: string }
  | { ok: false; statusCode: number; error: string; code: string; url?: string };

/** Build full public URL from merged page data and reject if another entry owns it. */
export function assertLocaleUrlAvailable(opts: {
  contentType: string;
  entryIdentity: string;
  locale: string;
  mergedPageData: Record<string, unknown>;
  ci: ContentIndex;
}): LocaleUrlAvailableResult {
  const { contentType, entryIdentity, locale, mergedPageData, ci } = opts;
  const normalized = ci.normalizeType(contentType);
  const config = ci.getContentTypeConfig(normalized);
  const contentFolder = getFolder(normalized);
  const pattern =
    config?.url_pattern?.[locale] || config?.url_pattern?.["default"] || `/${locale}/:slug`;

  const localeSlug = localeUrlSlugFromPageData(mergedPageData, entryIdentity);
  const formatErr = validateLocaleUrlSlugFormat(localeSlug);
  if (formatErr) {
    return { ok: false, statusCode: 400, code: "invalid_locale_slug", error: formatErr };
  }

  const fieldMapping = getFullFieldMapping(normalized, ci.contentRoot);
  const defaults = getFieldMappingDefaults(normalized, ci.contentRoot);
  const extracted = extractUrlPatternParams(pattern, mergedPageData, fieldMapping, defaults);
  if (extracted.missing.length > 0) {
    return {
      ok: false,
      statusCode: 400,
      code: "missing_url_params",
      error:
        `Missing URL pattern param(s) for ${locale}: ${extracted.missing.map((p) => `:${p}`).join(", ")}. ` +
        "Supply them on the locale object (locale wins over _common.yml on merge).",
    };
  }

  const url = ci.buildUrl(contentFolder, locale, localeSlug, extracted.params);
  const owner = ci.resolveUrl(url);
  const resolvedIdentity = ci.resolveBaseSlug(entryIdentity, contentFolder);
  if (owner && owner.slug !== resolvedIdentity) {
    return {
      ok: false,
      statusCode: 409,
      code: "slug_already_owned_by_other_entry",
      error:
        `slug_already_owned_by_other_entry: "${url}" resolves to ` +
        `"${owner.contentType}/${owner.slug}"`,
      url,
    };
  }

  return { ok: true, url, localeSlug };
}

/** Public URL a locale has right now (before a rename / delete / unpublish). */
export function resolveCurrentLocaleUrl(opts: {
  contentType: string;
  entryIdentity: string;
  locale: string;
  parsed: Record<string, unknown>;
  commonData: Record<string, unknown>;
  ci: ContentIndex;
}): string {
  const { contentType, entryIdentity, locale, parsed, commonData, ci } = opts;
  const currentSlug = (parsed.slug as string) || entryIdentity;
  const result = assertLocaleUrlAvailable({
    contentType,
    entryIdentity,
    locale,
    mergedPageData: { ...commonData, ...parsed, slug: currentSlug },
    ci,
  });
  return result.ok ? result.url : ci.buildUrl(contentType, locale, currentSlug);
}

/** Same normalization ContentIndex applies to `meta.redirects` sources. */
export function normalizeRedirectPath(rawPath: string): string {
  let normalized = rawPath.startsWith("/") ? rawPath : `/${rawPath}`;
  normalized = normalized.toLowerCase();
  if (normalized.length > 1 && normalized.endsWith("/")) {
    normalized = normalized.slice(0, -1);
  }
  return normalized;
}

/** Normalized `from` paths declared in a document's `meta.redirects` (string or `{ path }` items). */
export function redirectPathsFromMeta(doc: Record<string, unknown> | null | undefined): string[] {
  const meta = doc?.meta as Record<string, unknown> | undefined;
  const redirects = meta?.redirects;
  if (!Array.isArray(redirects)) return [];
  const out: string[] = [];
  for (const item of redirects) {
    if (typeof item === "string") out.push(normalizeRedirectPath(item));
    else if (item && typeof item === "object" && typeof (item as { path?: unknown }).path === "string") {
      out.push(normalizeRedirectPath((item as { path: string }).path));
    }
  }
  return out;
}

/** Drop `url` from `meta.redirects` in place. Returns true when something was removed. */
export function removeRedirectPathFromMeta(doc: Record<string, unknown>, url: string): boolean {
  const meta = doc.meta as Record<string, unknown> | undefined;
  if (!meta || !Array.isArray(meta.redirects)) return false;
  const target = normalizeRedirectPath(url);
  const kept = meta.redirects.filter((item) => {
    const p =
      typeof item === "string"
        ? item
        : item && typeof item === "object" && typeof (item as { path?: unknown }).path === "string"
          ? (item as { path: string }).path
          : null;
    return p === null || normalizeRedirectPath(p) !== target;
  });
  if (kept.length === meta.redirects.length) return false;
  if (kept.length > 0) meta.redirects = kept;
  else delete meta.redirects;
  return true;
}

/** Plain-English location of a redirect, from its index `source` path. */
export function describeRedirectSource(source: string): string {
  const normalized = source.replace(/\\/g, "/");
  if (normalized.endsWith("custom-redirects.yml")) return "the site redirects file";
  const parts = normalized.split("/").filter(Boolean);
  if (parts.length >= 3) return `page ${parts[parts.length - 3]}/${parts[parts.length - 2]}`;
  return normalized;
}

export type RedirectConflictResult =
  | { ok: true; ownRedirectHit: boolean }
  | {
      ok: false;
      statusCode: number;
      code: "redirect_conflict";
      error: string;
      conflictUrl: string;
      redirectTo: string;
      redirectSource: string;
    };

/**
 * Reject when `url` is the `from` of a redirect that this entry does not own.
 * Own = listed in the entry's locale file or `_common.yml` `meta.redirects` (the files a rename can edit).
 */
export function assertNoRedirectConflict(opts: {
  url: string;
  redirects: Array<{ from: string; to: string | Record<string, string>; source: string }>;
  ownRedirectPaths: string[];
}): RedirectConflictResult {
  const target = normalizeRedirectPath(opts.url);
  if (opts.ownRedirectPaths.includes(target)) return { ok: true, ownRedirectHit: true };
  const conflict = opts.redirects.find((r) => r.from === target);
  if (!conflict) return { ok: true, ownRedirectHit: false };
  const redirectTo =
    typeof conflict.to === "string" ? conflict.to : Object.values(conflict.to).join(", ");
  const where = describeRedirectSource(conflict.source);
  return {
    ok: false,
    statusCode: 409,
    code: "redirect_conflict",
    error:
      `redirect_conflict: "${opts.url}" currently redirects to ${redirectTo} (set in ${where}). ` +
      "Pick another slug or remove that redirect first.",
    conflictUrl: opts.url,
    redirectTo,
    redirectSource: conflict.source,
  };
}
