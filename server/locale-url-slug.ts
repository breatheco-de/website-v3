/**
 * Per-locale URL slug helpers: resolve slug for YAML, uniqueness at go-live, redirect policy on rename.
 */

import type { ContentIndex } from "./content-index.js";
import {
  extractUrlPatternParams,
  getFieldMappingDefaults,
  getFolder,
  getFullFieldMapping,
} from "./content-types.js";
import { RESERVED_PUBLISHED_AT_FIELD } from "./published-at.js";

export const LOCALE_URL_SLUG_REGEX = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

const TWENTY_FOUR_HOURS_MS = 24 * 60 * 60 * 1000;

export function validateLocaleUrlSlugFormat(slug: string): string | null {
  if (!LOCALE_URL_SLUG_REGEX.test(slug)) {
    return "Invalid slug format. Use lowercase letters, numbers, and hyphens only.";
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
