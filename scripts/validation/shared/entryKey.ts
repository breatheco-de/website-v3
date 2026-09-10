/**
 * Entry keys for the validation issue store.
 * Format: `{contentType}/{slug}/{locale}` e.g. `program/ai-engineering/en`
 * Published variants: `{contentType}/{slug}/{locale}@{variantSlug}`
 * e.g. `landing/foo/es@draft`
 *
 * Pre-v5 migration orphans use `legacy` + URL with `/` → `__`
 * e.g. `/en/blog/post` → `legacy__en__blog__post` (not parseable as type/slug/locale).
 */

import type { ContentFile } from "./types";

export type ParsedEntryKey = {
  contentType: string;
  slug: string;
  locale: string;
  variant?: string;
};

export function buildEntryKey(
  contentType: string,
  slug: string,
  locale: string,
  variant?: string | null,
): string {
  const loc = !locale || locale === "_common" ? "en" : locale;
  const base = `${contentType}/${slug}/${loc}`;
  if (variant && variant !== "default") {
    return `${base}@${variant}`;
  }
  return base;
}

export function entryKeyFromContentFile(file: ContentFile): string {
  return buildEntryKey(file.type, file.slug, file.locale, file.variant);
}

export function parseEntryKey(entryKey: string): ParsedEntryKey | null {
  if (!entryKey) return null;
  let variant: string | undefined;
  let withoutVariant = entryKey;
  const at = entryKey.lastIndexOf("@");
  if (at >= 0) {
    variant = entryKey.slice(at + 1) || undefined;
    withoutVariant = entryKey.slice(0, at);
  }
  const parts = withoutVariant.split("/");
  if (parts.length < 3) return null;
  const locale = parts[parts.length - 1]!;
  const slug = parts[parts.length - 2]!;
  const contentType = parts.slice(0, -2).join("/");
  if (!contentType || !slug || !locale) return null;
  return { contentType, slug, locale, ...(variant ? { variant } : {}) };
}

/** v4→v5 migration synthetic keys (`legacy` + URL with `/` replaced by `__`). */
export function isLegacySyntheticEntryKey(entryKey: string): boolean {
  return Boolean(entryKey?.startsWith("legacy")) && parseEntryKey(entryKey) == null;
}

/**
 * Reverse `legacy${url.replace(/\//g, "__")}`.
 * Collapses empty path segments from older URLs (`/en/blog//slug` → `/en/blog/slug`).
 */
export function urlFromLegacyEntryKey(entryKey: string): string | null {
  if (!entryKey.startsWith("legacy")) return null;
  const withSlashes = entryKey.slice("legacy".length).replace(/__/g, "/");
  if (!withSlashes.startsWith("/")) return null;
  const collapsed = withSlashes.replace(/\/{2,}/g, "/");
  return collapsed || "/";
}

/** Layer label for UI: live vs variant slug from entry key. */
export function entryKeyLayerLabel(entryKey: string): string {
  const parsed = parseEntryKey(entryKey);
  if (!parsed) return "live";
  return parsed.variant ? `variant: ${parsed.variant}` : "live";
}
