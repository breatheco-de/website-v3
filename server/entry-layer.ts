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

import * as fs from "fs";
import * as path from "path";
import type { ContentIndex } from "./content-index";
import type { DatabaseManager } from "./database";
import { freezeShared } from "./utils/deepFreeze";
import {
  applyUpdatedAtAliasToEntry,
  finalizeSingleEntryForTemplates,
  getCanonicalHreflangSlug,
  getContentTypeConfig,
  getFolder,
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
  mergeEntryOwnedPage,
  mergeSingleTemplate,
} from "./database-single-loader";
import { applyFilters, type QueryFilter } from "./query-entries";
import { applyFieldOverridesToItem, readFieldOverrides, readLiveFieldOverrides } from "./field-overrides";
import { layoutInfoForEntry } from "./layout-owner";
import { applyPerEntryLayer, type PerEntryAccum } from "./section-merge";
import { child } from "./logger";

const log = child({ module: "entry-layer" });
import { applyTransformIfNeeded } from "./transform";
import { isAllowedUnknownKey, mappingAllowlist } from "@shared/validateUnknownFieldKeys";

export type EntryKey = {
  contentType: string;
  slug: string;
  locales: string[];
};

export type StaleDatabase = { name: string; fetchedAt: string; ageMs: number; contentTypes: string[] };

export type EntryKeyList = {
  keys: EntryKey[];
  /** Databases that never had a stored copy (their pages cannot be listed or checked). */
  emptyDatabases: string[];
  /** Databases served from a copy older than their cache TTL (source not refreshed since). */
  staleDatabases: StaleDatabase[];
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
  /** Set when the source item came from a copy older than the database's cache TTL. */
  staleSourceAgeMs?: number;
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

export type TypeItems = {
  dbName: string;
  /** Content-type-mapped items (shared, frozen outside production). */
  items: Record<string, unknown>[];
  fetchedAt: string;
  stale: boolean;
  ageMs: number;
};

/** What the item lookup needs: the site's content root and its database manager. */
export type EntrySourceRoot = Pick<ContentIndex, "contentRoot" | "getDatabase">;

const typeItemsMemo = new WeakMap<DatabaseManager, Map<string, { key: string; value: TypeItems }>>();

/**
 * Content-type-mapped items for a database-backed type from the last good copy
 * (null when the type has no database or the database never had a copy).
 * Mapped once per stored copy; callers must copy an item before changing it.
 */
export function loadItemsForType(ci: EntrySourceRoot, contentType: string): TypeItems | null {
  const dbName = getContentTypeConfig(contentType, ci.contentRoot)?.database?.slug;
  if (!dbName) return null;
  const db = ci.getDatabase();
  const lastGood = db.getLastGoodItems(dbName);
  if (!lastGood) return null;

  let perDb = typeItemsMemo.get(db);
  if (!perDb) {
    perDb = new Map();
    typeItemsMemo.set(db, perDb);
  }
  const memoKey = `${ci.contentRoot}\u0000${contentType}`;
  const key = `${lastGood.fetchedAt}\u0000${db.mappedMemoVersion}`;
  const hit = perDb.get(memoKey);
  if (hit && hit.key === key) {
    return { ...hit.value, stale: lastGood.stale, ageMs: lastGood.ageMs };
  }
  const value: TypeItems = {
    dbName,
    items: freezeShared(mapDatabaseItemsForEntry(lastGood.items, contentType, ci.contentRoot)),
    fetchedAt: lastGood.fetchedAt,
    stale: lastGood.stale,
    ageMs: lastGood.ageMs,
  };
  perDb.set(memoKey, { key, value });
  return value;
}

type EntryFilter = {
  item_property_slug: string;
  value: unknown;
};

/** Content-type page gate. Empty or missing means every cached row can be a page. */
function readEntryFilters(contentType: string, contentRoot?: string): QueryFilter[] | null {
  const raw = getContentTypeConfig(contentType, contentRoot)?.entry_filters;
  if (!Array.isArray(raw) || raw.length === 0) return null;
  const filters: QueryFilter[] = [];
  for (const entry of raw) {
    if (!entry || typeof entry !== "object") continue;
    const field = String((entry as EntryFilter).item_property_slug ?? "").trim();
    if (!field) continue;
    filters.push({ field, value: (entry as EntryFilter).value });
  }
  return filters.length > 0 ? filters : null;
}

/** Drop rows that are not pages. The database cache itself is unchanged. */
export function applyEntryFilters(
  items: Record<string, unknown>[],
  contentType: string,
  contentRoot?: string,
): Record<string, unknown>[] {
  const filters = readEntryFilters(contentType, contentRoot);
  if (!filters) return items;
  return applyFilters(items, filters);
}

/** One database item for a slug + locale (same lookup listEntryKeys uses), or undefined. */
export function findEntryItem(
  ci: EntrySourceRoot,
  contentType: string,
  slug: string,
  locale: string,
): Record<string, unknown> | undefined {
  const typeItems = loadItemsForType(ci, contentType);
  if (!typeItems) return undefined;
  const pages = applyEntryFilters(typeItems.items, contentType, ci.contentRoot);
  return findDatabaseItemForEntry(pages, contentType, slug, locale, ci.contentRoot);
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
  const staleDatabases: StaleDatabase[] = [];
  const skippedContentTypes: string[] = [];
  const itemsByType = new Map<string, Record<string, unknown>[]>();
  const contentRoot = ci.contentRoot;

  for (const contentType of ci.getContentTypes()) {
    const config = ci.getContentTypeConfig(contentType);
    const dbName = config?.database?.slug;
    if (!dbName || !config?.url_pattern) continue;

    const typeItems = loadItemsForType(ci, contentType);
    if (!typeItems) {
      if (!emptyDatabases.includes(dbName)) emptyDatabases.push(dbName);
      skippedContentTypes.push(contentType);
      continue;
    }
    if (typeItems.stale) {
      const known = staleDatabases.find((s) => s.name === dbName);
      if (known) known.contentTypes.push(contentType);
      else staleDatabases.push({ name: dbName, fetchedAt: typeItems.fetchedAt, ageMs: typeItems.ageMs, contentTypes: [contentType] });
    }

    const items = applyEntryFilters(typeItems.items, contentType, contentRoot);
    itemsByType.set(contentType, items);
    const lookupKey = getLookupKey(contentType, contentRoot) || "slug";
    for (const item of items) {
      const slug = String(item[lookupKey] ?? item.slug ?? "");
      if (!slug) continue;
      for (const locale of itemLocales(item, contentType, contentRoot)) add(contentType, slug, locale);
    }
  }

  return { keys: [...byKey.values()], emptyDatabases, staleDatabases, skippedContentTypes, itemsByType };
}

/** Languages a type publishes pages in (url_pattern keys; `default` alone means the default language). */
export function typeLocales(contentType: string, contentRoot: string): string[] {
  const pattern = getContentTypeConfig(contentType, contentRoot)?.url_pattern || {};
  const explicit = Object.keys(pattern).filter((k) => k !== "default" && isEntryLocale(k));
  return explicit.length > 0 ? explicit : [getLocaleDefault(contentType, contentRoot)];
}

function hasOwnLocale(item: Record<string, unknown>, contentType: string, contentRoot: string): boolean {
  const localeKey = getLocaleKey(contentType, contentRoot);
  return [localeKey, "language", "lang", "locale"].some(
    (k) => !!k && item[k] != null && String(item[k]) !== "",
  );
}

/**
 * Languages a database item is a page in: its own language when it has one,
 * otherwise every language the type publishes.
 */
export function itemLocales(item: Record<string, unknown>, contentType: string, contentRoot: string): string[] {
  const pattern = getContentTypeConfig(contentType, contentRoot)?.url_pattern || {};
  if (hasOwnLocale(item, contentType, contentRoot)) {
    const locale = itemLocale(item, contentType, contentRoot);
    return pattern[locale] || pattern.default ? [locale] : [];
  }
  return typeLocales(contentType, contentRoot);
}

/** Entry folder names of a type (where `field_overrides` files can live). */
function entryFolderSlugs(contentType: string, contentRoot: string): Set<string> {
  try {
    const dir = path.join(contentRoot, getFolder(contentType, contentRoot));
    return new Set(
      fs.readdirSync(dir, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name),
    );
  } catch {
    return new Set();
  }
}

export type ListedPage = {
  slug: string;
  locale: string;
  /** Mapped item with the page's `field_overrides` applied (shared object when there are none). */
  item: Record<string, unknown>;
};

export type ListedTypePages = Omit<TypeItems, "items"> & { pages: ListedPage[] };

/**
 * One row per database page of a type (item × language), with the entry's
 * `field_overrides` applied so listings show what the page shows. No template
 * merge; override files are read only for items that have an entry folder.
 */
export function listTypePages(ci: EntrySourceRoot, contentType: string): ListedTypePages | null {
  const typeItems = loadItemsForType(ci, contentType);
  if (!typeItems) return null;
  const contentRoot = ci.contentRoot;
  const lookupKey = getLookupKey(contentType, contentRoot) || "slug";
  const folders = entryFolderSlugs(contentType, contentRoot);
  const pages: ListedPage[] = [];
  const pageItems = applyEntryFilters(typeItems.items, contentType, contentRoot);
  for (const item of pageItems) {
    const slug = String(item[lookupKey] ?? item.slug ?? "");
    if (!slug) continue;
    for (const locale of itemLocales(item, contentType, contentRoot)) {
      const overrides = folders.has(slug) ? readLiveFieldOverrides(contentType, slug, locale, contentRoot) : null;
      pages.push({ slug, locale, item: overrides ? applyFieldOverridesToItem(item, overrides) : item });
    }
  }
  const { items: _items, ...rest } = typeItems;
  return { ...rest, pages };
}

export type ListingRows = { dbName: string; items: Record<string, unknown>[]; fetchedAt: string; stale: boolean; ageMs: number };

/**
 * Listing rows for a database-backed type (listing mapping, last good copy) with each
 * page's `field_overrides` applied. Null when the type has no database or it was never copied.
 */
export function listTypeRows(
  ci: ContentIndex,
  contentType: string,
  db: DatabaseManager = ci.getDatabase(),
): ListingRows | null {
  const listing = db.getListingItems(contentType);
  if (!listing) return null;
  const overridden = applyListingOverrides(ci, contentType, listing.items);
  return { ...listing, items: applyEntryFilters(overridden, contentType, ci.contentRoot) };
}

/**
 * Listing rows for a database-backed type: the last good copy with overrides applied.
 * An expired copy is served while a refresh runs in the background; a database that was
 * never copied is fetched once.
 */
export async function loadTypeListing(
  ci: ContentIndex,
  contentType: string,
  db: DatabaseManager = ci.getDatabase(),
): Promise<Record<string, unknown>[]> {
  const rows = listTypeRows(ci, contentType, db);
  if (rows) {
    if (rows.stale) void db.fetchItems(rows.dbName).catch(() => {});
    return rows.items;
  }
  return applyListingOverrides(ci, contentType, await db.fetchMappedItems(contentType));
}

/** Language of a source item (locale field with its transform, else the type's default). */
export function entryItemLocale(item: Record<string, unknown>, contentType: string, contentRoot: string): string {
  return itemLocale(item, contentType, contentRoot);
}

/** Apply `field_overrides` to listing rows; files are read only for items with an entry folder. */
export function applyListingOverrides(
  ci: ContentIndex | { contentRoot: string },
  contentType: string,
  items: Record<string, unknown>[],
): Record<string, unknown>[] {
  const contentRoot = ci.contentRoot;
  const folders = entryFolderSlugs(contentType, contentRoot);
  if (folders.size === 0) return items;
  const lookupKey = getLookupKey(contentType, contentRoot) || "slug";
  return items.map((item) => {
    const slug = String(item[lookupKey] ?? item.slug ?? "");
    if (!slug || !folders.has(slug)) return item;
    const locale = itemLocales(item, contentType, contentRoot)[0] ?? getLocaleDefault(contentType, contentRoot);
    return applyFieldOverridesToItem(item, readLiveFieldOverrides(contentType, slug, locale, contentRoot));
  });
}

export type EntryPresence = {
  contentType: string;
  /** Language → the page's slug (and entry folder) in that language. */
  localeSlugs: Record<string, string>;
};

/**
 * Which languages a page exists in, from files or source items (same rules as listEntryKeys),
 * for one content type only. `slug` may be any language's slug of the page.
 */
export function findEntryPresence(ci: ContentIndex, contentType: string, slug: string): EntryPresence | null {
  const localeSlugs: Record<string, string> = {};
  const typeItems = loadItemsForType(ci, contentType);
  if (!typeItems) {
    const folder = ci.findBySlug(ci.resolveBaseSlug(slug, contentType), { contentType })[0];
    for (const locale of folder?.locales ?? []) if (isEntryLocale(locale)) localeSlugs[locale] = folder!.slug;
  } else {
    const lookupKey = getLookupKey(contentType, ci.contentRoot) || "slug";
    const pageItems = applyEntryFilters(typeItems.items, contentType, ci.contentRoot);
    const matches = pageItems.filter((item) => String(item[lookupKey] ?? item.slug ?? "") === slug);
    const first = matches[0];
    const group = first ? resolveHreflangsFromRecord(first, contentType, ci.contentRoot) : null;
    const slugsInGroup = new Set([slug, ...Object.values(group || {})]);
    for (const item of pageItems) {
      const itemSlug = String(item[lookupKey] ?? item.slug ?? "");
      if (!itemSlug || !slugsInGroup.has(itemSlug)) continue;
      for (const locale of itemLocales(item, contentType, ci.contentRoot)) {
        if (group && group[locale] && group[locale] !== itemSlug) continue;
        localeSlugs[locale] ??= itemSlug;
      }
    }
  }

  return Object.keys(localeSlugs).length > 0 ? { contentType, localeSlugs } : null;
}

/** The entry's own `{locale}.yml` path (may not exist yet). */
export function entryLocaleFilePath(ci: ContentIndex, contentType: string, slug: string, locale: string): string {
  return path.join(
    ci.contentRoot,
    ci.getFolderName(contentType),
    ci.resolveBaseSlug(slug, contentType),
    `${locale}.yml`,
  );
}

export type LoadEntryOptions = {
  /** Shared template A/B: `template.{variant}.{locale}.yml` instead of the live shell. */
  templateVariant?: string;
  /**
   * Entry variant (draft preview). Uses template: fields-only layer over the shell.
   * Owns its layout: the variant file is the whole page. Missing variant → null, never live.
   */
  entryVariant?: string;
  /** Collects per-entry removed sections (section edit routes). */
  accum?: PerEntryAccum;
};

function entryOwnFileExists(
  ci: ContentIndex,
  contentType: string,
  slug: string,
  locale: string,
  entryVariant?: string,
): boolean {
  const dir = path.dirname(entryLocaleFilePath(ci, contentType, slug, locale));
  return fs.existsSync(path.join(dir, entryVariant ? `${entryVariant}.${locale}.yml` : `${locale}.yml`));
}

/**
 * Merged entry for one locale: template layers → entry layer (files, or the source item
 * with YAML `field_overrides` applied as a data-only layer). Read-only.
 * Returns null when the page does not exist in that language: no item and no own file,
 * or a requested variant that is missing.
 */
export function loadEntry(
  ci: ContentIndex,
  contentType: string,
  slug: string,
  locale: string,
  itemsByType?: Map<string, Record<string, unknown>[]>,
  opts: LoadEntryOptions = {},
): LoadedEntry | null {
  const { entryVariant, templateVariant, accum } = opts;
  const layer = entryItemLayer(ci, contentType, slug, locale, itemsByType, entryVariant);
  const layout = layoutInfoForEntry(contentType, slug, ci.contentRoot);

  let base: Record<string, unknown> | null;
  let filePath = entryLocaleFilePath(ci, contentType, slug, locale);
  try {
    if (layout.is_shared_template) {
      base = mergeSingleTemplate(contentType, locale, undefined, accum, ci.contentRoot, templateVariant ?? entryVariant);
    } else if (layout.layout_owner === "shared_template") {
      const ownFile = entryOwnFileExists(ci, contentType, slug, locale, entryVariant);
      if (entryVariant ? !ownFile : !ownFile && !layer) return null;
      base = mergeSingleTemplate(contentType, locale, slug, accum, ci.contentRoot, templateVariant, entryVariant);
    } else if (layout.detached || layer) {
      base = mergeEntryOwnedPage(contentType, slug, locale, ci.contentRoot, entryVariant);
    } else {
      const merged = ci.loadMergedContent(contentType, slug, locale, entryVariant);
      base = merged.data;
      filePath = merged.filePath;
    }
  } catch (err) {
    log.warn({ err, contentType, slug, locale }, "[entry-layer] could not read entry files");
    return null;
  }
  if (!base) return null;
  if (!layer) return { data: base, filePath };

  const data = applyPerEntryLayer(base, layer.fields, undefined, undefined, true);
  const stale = layer.staleSourceAgeMs !== undefined ? { staleSourceAgeMs: layer.staleSourceAgeMs } : {};
  return { data, filePath, singleEntry: layer.singleEntry, translationGroup: layer.translationGroup, ...stale };
}

/**
 * Before a delivery read: refresh the type's source copy when it is missing or past its TTL.
 * Never throws; a failed refresh keeps serving the last good copy (see DatabaseManager.refreshIfExpired).
 */
export async function refreshEntrySource(ci: EntrySourceRoot, contentType: string): Promise<void> {
  const dbName = getContentTypeConfig(contentType, ci.contentRoot)?.database?.slug;
  if (!dbName) return;
  try {
    await ci.getDatabase().refreshIfExpired(dbName);
  } catch (err) {
    log.warn({ err, contentType }, "[entry-layer] source refresh failed; using the last good copy");
  }
}

export type EntryItemLayer = {
  /** The page's fields from the item (field_mapping keys + aliases), YAML `field_overrides` applied. */
  fields: Record<string, unknown>;
  /** Every item column, for `{{ entry.* }}` in templates. */
  singleEntry: Record<string, unknown>;
  translationGroup: string;
  staleSourceAgeMs?: number;
};

/**
 * The entry layer a source item contributes for one slug + locale, or null when
 * the type has no item for it (static entries). Looks up one type only.
 */
export function entryItemLayer(
  root: EntrySourceRoot,
  contentType: string,
  slug: string,
  locale: string,
  itemsByType?: Map<string, Record<string, unknown>[]>,
  /** Entry variant (draft): its `field_overrides` apply on top of the live ones. */
  variant?: string,
): EntryItemLayer | null {
  const typeItems = itemsByType ? undefined : loadItemsForType(root, contentType);
  const items = itemsByType?.get(contentType) ?? typeItems?.items;
  const item = items
    ? findDatabaseItemForEntry(items, contentType, slug, locale, root.contentRoot)
    : undefined;
  if (!item || !itemLocales(item, contentType, root.contentRoot).includes(locale)) return null;

  const overrides = readLiveFieldOverrides(contentType, slug, locale, root.contentRoot);
  let withOverrides = applyFieldOverridesToItem(structuredClone(item), overrides);
  if (variant) {
    withOverrides = applyFieldOverridesToItem(
      withOverrides,
      readFieldOverrides(contentType, slug, locale, root.contentRoot, variant),
    );
  }
  applyUpdatedAtAliasToEntry(
    withOverrides,
    resolveEntryUpdatedAt({
      contentType,
      slug,
      locale,
      record: withOverrides,
      contentRoot: root.contentRoot,
      isDb: true,
    }),
  );
  const hreflangs = resolveHreflangsFromRecord(item, contentType, root.contentRoot);
  const translationGroup = (hreflangs && getCanonicalHreflangSlug(hreflangs)) || slug;
  const singleEntry = finalizeSingleEntryForTemplates(withOverrides, { slug, locale }) || {};
  return {
    fields: pickEntryFields(singleEntry, contentType, root.contentRoot),
    singleEntry,
    translationGroup,
    ...(typeItems?.stale ? { staleSourceAgeMs: typeItems.ageMs } : {}),
  };
}

export type EntrySourceStatus =
  | { kind: "files" }
  | { kind: "never_copied"; database: string }
  | { kind: "copy"; database: string; stale: boolean; ageMs: number };

/**
 * Where a type's entries come from, for not-found and freshness notes: files only,
 * a database that never had a stored copy, or a stored copy (maybe past its TTL).
 */
export function entrySourceStatus(root: EntrySourceRoot, contentType: string): EntrySourceStatus {
  const database = getContentTypeConfig(contentType, root.contentRoot)?.database?.slug;
  if (!database) return { kind: "files" };
  const typeItems = loadItemsForType(root, contentType);
  if (!typeItems) return { kind: "never_copied", database };
  return { kind: "copy", database, stale: typeItems.stale, ageMs: typeItems.ageMs };
}

/** Languages a slug has a source item in (one type lookup; [] for static types). */
export function entryItemLocales(root: EntrySourceRoot, contentType: string, slug: string): string[] {
  const typeItems = loadItemsForType(root, contentType);
  if (!typeItems) return [];
  const lookupKey = getLookupKey(contentType, root.contentRoot) || "slug";
  const out = new Set<string>();
  for (const item of typeItems.items) {
    if (String(item[lookupKey] ?? item.slug ?? "") !== slug) continue;
    for (const locale of itemLocales(item, contentType, root.contentRoot)) out.add(locale);
  }
  return [...out];
}
