/**
 * One entry list and one entry merge for static and database-backed content.
 *
 * Every entry resolves the same way: template layers → entry layer → variables.
 * The only source-specific part is where the entry layer comes from:
 * - static: the entry's `_common.yml` / `{locale}.yml`
 * - database: the cached item (DB `overrides.json` already applied at fetch),
 *   mapped with the content type's field mapping, plus YAML `field_overrides`
 *
 * Offline and read-only: never fetches items, markdown or live requests, and
 * never writes files.
 */

import * as path from "path";
import type { ContentIndex } from "./content-index";
import {
  applyUpdatedAtAliasToEntry,
  finalizeSingleEntryForTemplates,
  getCanonicalHreflangSlug,
  getContentTypeConfig,
  getLocaleDefault,
  getLocaleKey,
  getLocaleSource,
  getLookupKey,
  resolveEntryUpdatedAt,
  resolveHreflangsFromRecord,
} from "./content-types";
import {
  findDatabaseItemForEntry,
  mapDatabaseItemsForEntry,
} from "./database-single-loader";
import { applyFieldOverridesToItem, readFieldOverrides } from "./field-overrides";
import { applyPerEntryLayer } from "./section-merge";
import { applyTransformIfNeeded } from "./transform";
import { isAllowedUnknownKey, mappingAllowlist } from "@shared/validateUnknownFieldKeys";

export type EntryKey = {
  contentType: string;
  slug: string;
  locales: string[];
};

export type EntryKeyList = {
  keys: EntryKey[];
  /** Databases with no cached items (expired, never fetched, or empty). */
  emptyDatabases: string[];
  /** Content types whose pages were not listed because their database cache is empty. */
  skippedContentTypes: string[];
  /** Content-type-mapped database items, reused by loadEntry within one run. */
  itemsByType: Map<string, Record<string, unknown>[]>;
};

export type LoadedEntry = {
  data: Record<string, unknown>;
  /** The entry's own language file (may not exist yet for database items). */
  filePath: string;
  /** Present for database-backed entries: the mapped item the template fills from. */
  singleEntry?: Record<string, unknown>;
  /** Key shared by every language version of this page (static entries: the slug). */
  translationGroup?: string;
};

function isEntryLocale(locale: string): boolean {
  return !locale.startsWith("_") && !locale.includes(".");
}

function itemLocale(
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

/**
 * The page's fields are what field_mapping declares (plus reserved aliases), same as a
 * static entry. Unmapped source columns stay on singleEntry for `{{ entry.* }}` only.
 */
function pickEntryFields(
  item: Record<string, unknown>,
  contentType: string,
  contentRoot: string,
): Record<string, unknown> {
  const allowed = mappingAllowlist(
    getContentTypeConfig(contentType, contentRoot)?.field_mapping as Record<string, unknown> | undefined,
  );
  return Object.fromEntries(
    Object.entries(item).filter(([key]) => isAllowedUnknownKey(key, allowed)),
  );
}

/** Static entries (folders) plus cached database items, one key per content type + slug. */
export function listEntryKeys(ci: ContentIndex): EntryKeyList {
  const byKey = new Map<string, EntryKey>();
  const add = (contentType: string, slug: string, locale: string) => {
    if (!isEntryLocale(locale)) return;
    const k = `${contentType}\u0000${slug}`;
    const existing = byKey.get(k);
    if (existing) {
      if (!existing.locales.includes(locale)) existing.locales.push(locale);
    } else {
      byKey.set(k, { contentType, slug, locales: [locale] });
    }
  };

  for (const entry of ci.listAll()) {
    for (const locale of entry.locales) add(entry.contentType, entry.slug, locale);
  }

  const emptyDatabases: string[] = [];
  const skippedContentTypes: string[] = [];
  const itemsByType = new Map<string, Record<string, unknown>[]>();
  const contentRoot = ci.contentRoot;

  for (const contentType of ci.getContentTypes()) {
    const config = ci.getContentTypeConfig(contentType);
    const dbName = config?.database?.slug;
    if (!dbName || !config?.url_pattern) continue;

    const cached = ci.getDatabase().getMappedItems(dbName);
    if (!cached || cached.length === 0) {
      if (!emptyDatabases.includes(dbName)) emptyDatabases.push(dbName);
      skippedContentTypes.push(contentType);
      continue;
    }

    const items = mapDatabaseItemsForEntry(cached, contentType, contentRoot);
    itemsByType.set(contentType, items);
    const lookupKey = getLookupKey(contentType, contentRoot) || "slug";
    for (const item of items) {
      const slug = String(item[lookupKey] ?? item.slug ?? "");
      if (!slug) continue;
      const locale = itemLocale(item, contentType, contentRoot);
      if (!config.url_pattern[locale] && !config.url_pattern.default) continue;
      add(contentType, slug, locale);
    }
  }

  return { keys: [...byKey.values()], emptyDatabases, skippedContentTypes, itemsByType };
}

/**
 * Merged entry for one locale. Database items become a data-only entry layer
 * (same rule as attached static entries: no sections), after YAML
 * `field_overrides` are applied to the item.
 */
export function loadEntry(
  ci: ContentIndex,
  contentType: string,
  slug: string,
  locale: string,
  itemsByType?: Map<string, Record<string, unknown>[]>,
): LoadedEntry | null {
  const merged = ci.loadMergedContent(contentType, slug, locale);
  if (!merged.data) return null;

  const items = itemsByType?.get(contentType);
  const item = items
    ? findDatabaseItemForEntry(items, contentType, slug, locale, ci.contentRoot)
    : undefined;
  if (!item) {
    return { data: merged.data, filePath: merged.filePath };
  }

  const overrides = readFieldOverrides(contentType, slug, locale, ci.contentRoot);
  const withOverrides = applyFieldOverridesToItem({ ...item }, overrides);
  applyUpdatedAtAliasToEntry(
    withOverrides,
    resolveEntryUpdatedAt({
      contentType,
      slug,
      locale,
      record: withOverrides,
      contentRoot: ci.contentRoot,
      isDb: true,
    }),
  );
  const hreflangs = resolveHreflangsFromRecord(item, contentType, ci.contentRoot);
  const translationGroup = (hreflangs && getCanonicalHreflangSlug(hreflangs)) || slug;
  const singleEntry = finalizeSingleEntryForTemplates(withOverrides, { slug, locale }) || {};
  const data = applyPerEntryLayer(
    merged.data,
    pickEntryFields(singleEntry, contentType, ci.contentRoot),
    undefined,
    undefined,
    true,
  );
  const filePath = path.join(
    ci.contentRoot,
    ci.getFolderName(contentType),
    ci.resolveBaseSlug(slug, contentType),
    `${locale}.yml`,
  );

  return { data, filePath, singleEntry, translationGroup };
}
