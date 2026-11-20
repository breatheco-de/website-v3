/**
 * Resolve content-type `_slug` for database rows, detect page moves when a row
 * patch changes the computed slug, and preview duplicate slug+locale groups.
 */

import {
  getAllTypes,
  getContentTypeConfig,
  getFullFieldMapping,
  getLocaleDefault,
  getLocaleKey,
  getLocaleSource,
  RESERVED_SLUG_FIELD,
} from "./content-types";
import { applyTransformIfNeeded, resolveFieldValue } from "./transform";

export const CONFIRM_PAGE_SLUG_CHANGE = "confirm_page_slug_change";
export const SLUG_CHECK_MAX_ROWS = 2000;
export const SLUG_CHECK_SAMPLE_MAX = 10;

export type PageSlugMove = {
  contentType: string;
  locale: string;
  oldSlug: string;
  newSlug: string;
  oldPath: string;
  newPath: string;
};

function mappingSlugSource(
  contentType: string,
  contentRoot: string,
  override?: string | null,
): string | null {
  if (override != null && String(override).trim()) return String(override).trim();
  const full = getFullFieldMapping(contentType, contentRoot);
  const raw = full?.[RESERVED_SLUG_FIELD];
  return raw && String(raw).trim() ? String(raw).trim() : null;
}

/** Resolve `_slug` for a raw database row using the content type mapping (or override). */
export function resolveMappedPageSlug(
  item: Record<string, unknown>,
  contentType: string,
  contentRoot: string,
  slugMappingOverride?: string | null,
): string {
  const source = mappingSlugSource(contentType, contentRoot, slugMappingOverride);
  if (!source) {
    const fallback = item.slug ?? item.id;
    return fallback != null ? String(fallback).trim() : "";
  }
  const value = resolveFieldValue(source, item, RESERVED_SLUG_FIELD, {
    contentType,
    slug: String(item.slug ?? item.id ?? "preview"),
    fieldPath: RESERVED_SLUG_FIELD,
  });
  return value != null && value !== "" ? String(value).trim() : "";
}

function resolveMappedLocale(
  item: Record<string, unknown>,
  contentType: string,
  contentRoot: string,
): string {
  const localeKey = getLocaleKey(contentType, contentRoot);
  const localeSource = getLocaleSource(contentType, contentRoot);
  const raw = String(
    (localeKey ? item[localeKey] : undefined) ??
      item.language ??
      item.lang ??
      item.locale ??
      "",
  );
  const value = raw && localeSource ? String(applyTransformIfNeeded(localeSource, raw)) : raw;
  return value || getLocaleDefault(contentType, contentRoot);
}

function pathFromPattern(contentType: string, locale: string, slug: string, contentRoot: string): string {
  const pattern =
    getContentTypeConfig(contentType, contentRoot)?.url_pattern?.[locale] ||
    getContentTypeConfig(contentType, contentRoot)?.url_pattern?.default ||
    "";
  if (!pattern) return `/${locale}/${contentType}/${slug}`;
  return pattern.replace(/:slug\b/g, slug);
}

/** Content types that use this database and declare `_slug`. */
export function contentTypesForDatabase(database: string, contentRoot: string): string[] {
  const out: string[] = [];
  for (const type of getAllTypes(contentRoot)) {
    const cfg = getContentTypeConfig(type, contentRoot);
    if (cfg?.database?.slug !== database) continue;
    if (!getFullFieldMapping(type, contentRoot)?.[RESERVED_SLUG_FIELD]) continue;
    out.push(type);
  }
  return out;
}

/**
 * If merging `patch` into `current` would change a non-empty page slug for any
 * content type backed by `database`, return the moves (caller must confirm).
 */
export function detectPageSlugMoves(opts: {
  database: string;
  current: Record<string, unknown>;
  patch: Record<string, unknown>;
  contentRoot: string;
}): PageSlugMove[] {
  const types = contentTypesForDatabase(opts.database, opts.contentRoot);
  if (types.length === 0) return [];
  const merged = { ...opts.current, ...opts.patch };
  const moves: PageSlugMove[] = [];
  for (const contentType of types) {
    const oldSlug = resolveMappedPageSlug(opts.current, contentType, opts.contentRoot);
    const newSlug = resolveMappedPageSlug(merged, contentType, opts.contentRoot);
    if (!oldSlug || !newSlug || oldSlug === newSlug) continue;
    const locale = resolveMappedLocale(merged, contentType, opts.contentRoot);
    moves.push({
      contentType,
      locale,
      oldSlug,
      newSlug,
      oldPath: pathFromPattern(contentType, locale, oldSlug, opts.contentRoot),
      newPath: pathFromPattern(contentType, locale, newSlug, opts.contentRoot),
    });
  }
  return moves;
}

export type SlugCheckSample = {
  slug: string;
  locale: string;
  labels: string[];
  indexes: number[];
};

export type SlugCheckResult = {
  checked: number;
  skipped: number;
  duplicate_groups: number;
  samples: SlugCheckSample[];
  truncated: boolean;
};

function parsePriority(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const n = Number(value);
    if (Number.isFinite(n)) return n;
  }
  return 0;
}

function rowLabel(item: Record<string, unknown>): string {
  const title = item.title ?? item.name ?? item.organization ?? item.id;
  if (title != null && String(title).trim()) return String(title).trim().slice(0, 80);
  return "(untitled)";
}

/**
 * Scan cached rows with a draft `_slug` mapping; report empty slugs and
 * duplicate slug+locale groups (priority does not affect the duplicate report —
 * any second row with the same key counts).
 */
export function previewSlugMappingOnItems(opts: {
  items: Record<string, unknown>[];
  contentType: string;
  contentRoot: string;
  slugMapping: string;
  maxRows?: number;
  sampleMax?: number;
}): SlugCheckResult {
  const maxRows = opts.maxRows ?? SLUG_CHECK_MAX_ROWS;
  const sampleMax = opts.sampleMax ?? SLUG_CHECK_SAMPLE_MAX;
  const slice = opts.items.slice(0, maxRows);
  const truncated = opts.items.length > maxRows;

  type Group = { slug: string; locale: string; labels: string[]; indexes: number[]; priorities: number[] };
  const byKey = new Map<string, Group>();
  let skipped = 0;

  for (let i = 0; i < slice.length; i++) {
    const item = slice[i]!;
    const slug = resolveMappedPageSlug(item, opts.contentType, opts.contentRoot, opts.slugMapping);
    if (!slug) {
      skipped += 1;
      continue;
    }
    const locale = resolveMappedLocale(item, opts.contentType, opts.contentRoot);
    const key = `${slug}\0${locale}`;
    const existing = byKey.get(key);
    if (!existing) {
      byKey.set(key, {
        slug,
        locale,
        labels: [rowLabel(item)],
        indexes: [i],
        priorities: [parsePriority(item.priority)],
      });
    } else {
      existing.labels.push(rowLabel(item));
      existing.indexes.push(i);
      existing.priorities.push(parsePriority(item.priority));
    }
  }

  const dupes = [...byKey.values()].filter((g) => g.indexes.length > 1);
  const samples: SlugCheckSample[] = dupes.slice(0, sampleMax).map((g) => ({
    slug: g.slug,
    locale: g.locale,
    labels: g.labels.slice(0, 4),
    indexes: g.indexes.slice(0, 4),
  }));

  return {
    checked: slice.length,
    skipped,
    duplicate_groups: dupes.length,
    samples,
    truncated,
  };
}

/** Encode confirm flag from request body / MCP args. */
export function hasPageSlugChangeConfirm(body: Record<string, unknown> | undefined): boolean {
  if (!body) return false;
  return body.confirm_page_slug_change === true || body[CONFIRM_PAGE_SLUG_CHANGE] === true;
}
