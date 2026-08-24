import fs from "fs";
import path from "path";
import yaml from "js-yaml";
import { databaseManager, type DatabaseManager } from "./database";
import { contentIndex, type ContentIndex, type ContentType } from "./content-index";
import {
  getContentTypeConfig,
  getDirectory,
  getFieldMapping,
  getFullFieldMapping,
  getLocaleDefault,
  getLocaleKey,
  getLocaleSource,
  resolveContentTypeUrl,
  resolveEntryUpdatedAt,
  RESERVED_UPDATED_AT_FIELD,
  applyUpdatedAtAliasToEntry,
} from "./content-types";
import { resolveFieldValue, applyTransformIfNeeded } from "./transform";
import { applyPurchasableToRecord } from "./ecommerce/ecommerce-manager";
import {
  getStaticListingCache,
  invalidateStaticListingCache,
  setStaticListingCache,
} from "./static-listing-cache";
import { normalizeLocale } from "./settings";
import { isEmptyDetachedLocaleEntry } from "./empty-locale";
import { isEntryDetached } from "./shared-layout-entry";
import { isHiddenViaSentinel } from "./shared-layout-sync";
import { child } from "./logger";
import { combinedArticleContentFromSections } from "@shared/reading-time";

const log = child({ module: "query-entries" });

export { invalidateStaticListingCache };

/** Keys never included in static listing projections (too heavy / page-only). */
const STATIC_LISTING_OMIT = new Set([
  "content",
  "sections",
  "settings",
  "meta",
  "schema",
  "section_defaults",
  "layout",
]);

export interface QueryFilter {
  field: string;
  value: unknown;
}

export type QueryFrom =
  | { contentType: string; database?: never }
  | { database: string; contentType?: never };

export interface QueryEntriesInput {
  from: QueryFrom;
  locale?: string;
  filters?: QueryFilter[];
  sort?: string;
  limit?: number;
}

export interface QueryEntriesResult {
  items: Record<string, unknown>[];
  total: number;
  meta: {
    source: "database" | "content_type";
    key: string;
  };
}

export interface QueryEntriesOptions {
  db?: DatabaseManager;
  contentIndex?: ContentIndex;
  contentRoot?: string;
}

function sortItems(items: Record<string, unknown>[], sortField: string): Record<string, unknown>[] {
  const desc = sortField.startsWith("-");
  const field = desc ? sortField.slice(1) : sortField;

  return [...items].sort((a, b) => {
    const aVal = a[field];
    const bVal = b[field];
    if (aVal == null && bVal == null) return 0;
    if (aVal == null) return 1;
    if (bVal == null) return -1;

    let cmp = 0;
    if (typeof aVal === "number" && typeof bVal === "number") {
      cmp = aVal - bVal;
    } else {
      cmp = String(aVal).localeCompare(String(bVal));
    }
    return desc ? -cmp : cmp;
  });
}

function itemMatchesFilter(item: Record<string, unknown>, filter: QueryFilter): boolean {
  const itemVal = item[filter.field];
  const values = Array.isArray(filter.value) ? filter.value : [filter.value];
  return values.some((v: unknown) => {
    if (itemVal && typeof itemVal === "object" && "slug" in (itemVal as Record<string, unknown>)) {
      return String((itemVal as { slug: unknown }).slug) === String(v);
    }
    if (Array.isArray(itemVal)) {
      return itemVal.map(String).includes(String(v));
    }
    return String(itemVal) === String(v);
  });
}

export function applyFilters(
  items: Record<string, unknown>[],
  filters: QueryFilter[] | undefined,
): Record<string, unknown>[] {
  if (!filters?.length) return items;
  let result = items;
  for (const filter of filters) {
    result = result.filter((item) => itemMatchesFilter(item, filter));
  }
  return result;
}

/**
 * When a filter has multiple values, items matching more values float to the top.
 * Explicit sort is the tiebreaker (default field: priority).
 */
export function applyMatchCountSort(
  items: Record<string, unknown>[],
  filters: QueryFilter[] | undefined,
  sort: string | undefined,
): Record<string, unknown>[] {
  const multiValueFilter = filters?.find(
    (f) => Array.isArray(f.value) && (f.value as unknown[]).length > 1,
  );
  if (!multiValueFilter) {
    return sort ? sortItems(items, sort) : items;
  }

  const filterValues = (multiValueFilter.value as unknown[]).map(String);
  const field = multiValueFilter.field;
  const explicitSortDesc = sort?.startsWith("-") ?? false;
  const explicitSortField = sort
    ? explicitSortDesc
      ? sort.slice(1)
      : sort
    : null;

  return [...items].sort((a, b) => {
    const aVal = a[field];
    const bVal = b[field];
    const aArr = Array.isArray(aVal) ? aVal.map(String) : [String(aVal ?? "")];
    const bArr = Array.isArray(bVal) ? bVal.map(String) : [String(bVal ?? "")];
    const aCount = filterValues.filter((v) => aArr.includes(v)).length;
    const bCount = filterValues.filter((v) => bArr.includes(v)).length;
    if (bCount !== aCount) return bCount - aCount;

    const tieField = explicitSortField ?? "priority";
    const aT = a[tieField];
    const bT = b[tieField];
    if (aT == null && bT == null) return 0;
    if (aT == null) return 1;
    if (bT == null) return -1;
    let cmp = 0;
    if (typeof aT === "number" && typeof bT === "number") {
      cmp = aT - bT;
    } else {
      cmp = String(aT).localeCompare(String(bT));
    }
    return explicitSortField && explicitSortDesc ? -cmp : cmp;
  });
}

function filterByContentTypeLocale(
  items: Record<string, unknown>[],
  contentType: string,
  locale: string,
  contentRoot?: string,
): Record<string, unknown>[] {
  const localeKey = getLocaleKey(contentType, contentRoot) || "lang";
  const localeDefault = getLocaleDefault(contentType, contentRoot);
  const localeSource = getLocaleSource(contentType, contentRoot);
  const normalizedLocale = localeSource ? applyTransformIfNeeded(localeSource, locale) : locale;
  return items.filter((item) => {
    const rawItemLocale = String(item[localeKey] || localeDefault);
    const itemLocale = localeSource
      ? applyTransformIfNeeded(localeSource, rawItemLocale)
      : rawItemLocale;
    return itemLocale === normalizedLocale;
  });
}

/** Blog category is always a plain URL slug string (never `{ slug }`). */
function normalizeCategory(item: Record<string, unknown>, hasCategoryMapping: boolean): void {
  const raw = item.category;
  if (typeof raw === "string") {
    item.category = raw;
    return;
  }
  if (raw && typeof raw === "object" && !Array.isArray(raw)) {
    const slug = (raw as { slug?: unknown }).slug;
    if (typeof slug === "string" && slug.trim()) {
      item.category = slug.trim();
      return;
    }
  }
  if ((raw === undefined || raw === null) && hasCategoryMapping) {
    item.category = "uncategorized";
  }
}

/**
 * Detached locales whose sections are all publicly hidden (mirrored siblings)
 * and that have no body content should not appear in public listings.
 */
export function isDetachedLocaleOnlyPubliclyHidden(opts: {
  contentType: string;
  slug: string;
  contentRoot: string;
  localeData: Record<string, unknown>;
  common?: Record<string, unknown>;
}): boolean {
  if (!isEntryDetached(opts.contentType, opts.slug, opts.contentRoot)) return false;

  const content = opts.localeData.content ?? opts.common?.content;
  if (typeof content === "string" && content.trim().length > 0) return false;

  const sections = opts.localeData.sections;
  if (!Array.isArray(sections) || sections.length === 0) return false;

  return sections.every(
    (section) =>
      !!section &&
      typeof section === "object" &&
      !Array.isArray(section) &&
      isHiddenViaSentinel(section as Record<string, unknown>),
  );
}

function pickListingFields(
  common: Record<string, unknown>,
  localeData: Record<string, unknown>,
  mapping: Record<string, string> | null,
): Record<string, unknown> {
  const merged: Record<string, unknown> = { ...common };
  for (const [key, value] of Object.entries(localeData)) {
    if (STATIC_LISTING_OMIT.has(key)) continue;
    merged[key] = value;
  }

  const out: Record<string, unknown> = {};
  if (mapping && Object.keys(mapping).length > 0) {
    for (const [targetKey, sourcePath] of Object.entries(mapping)) {
      if (targetKey.startsWith("_")) continue;
      if (STATIC_LISTING_OMIT.has(targetKey)) continue;
      const sourceKey = sourcePath.includes(".") ? sourcePath.split(".")[0] : sourcePath;
      if (STATIC_LISTING_OMIT.has(sourceKey)) continue;
      if (merged[targetKey] !== undefined) {
        out[targetKey] = merged[targetKey];
      } else if (merged[sourcePath] !== undefined) {
        out[targetKey] = merged[sourcePath];
      }
    }
  } else {
    for (const [key, value] of Object.entries(merged)) {
      if (STATIC_LISTING_OMIT.has(key) || key.startsWith("_")) continue;
      out[key] = value;
    }
  }

  if (merged.slug != null && out.slug == null) out.slug = merged.slug;
  return out;
}

function loadStaticYamlFile(filePath: string): Record<string, unknown> | null {
  if (!fs.existsSync(filePath)) return null;
  try {
    const raw = fs.readFileSync(filePath, "utf-8");
    const data = yaml.load(raw);
    if (!data || typeof data !== "object" || Array.isArray(data)) return null;
    return data as Record<string, unknown>;
  } catch (err) {
    log.warn({ err, filePath }, "[QueryEntries] Failed to parse static listing YAML");
    return null;
  }
}

function loadStaticContentTypeItems(
  contentType: string,
  contentRoot: string,
  ci: ContentIndex,
): Record<string, unknown>[] {
  const cached = getStaticListingCache(contentRoot, contentType);
  if (cached) return cached;

  const mapping = getFieldMapping(contentType, contentRoot);
  const localeKey = getLocaleKey(contentType, contentRoot) || "lang";
  const directory = getDirectory(contentType, contentRoot) || contentType;
  const typeDir = path.join(contentRoot, directory);
  const slugs = ci.listContentSlugs(contentType as ContentType);
  const items: Record<string, unknown>[] = [];
  let idx = 0;

  for (const slug of slugs) {
    const slugDir = path.join(typeDir, slug);
    const common = loadStaticYamlFile(path.join(slugDir, "_common.yml")) || {};
    const locales = ci.getAvailableLocalesOrVariants(contentType as ContentType, slug);

    for (const locale of locales) {
      if (
        isEmptyDetachedLocaleEntry({
          contentType,
          slug,
          locale,
          contentRoot,
          ci,
        })
      ) {
        continue;
      }
      const localeData = loadStaticYamlFile(path.join(slugDir, `${locale}.yml`)) || {};
      if (
        isDetachedLocaleOnlyPubliclyHidden({
          contentType,
          slug,
          contentRoot,
          localeData,
          common,
        })
      ) {
        continue;
      }
      const item = pickListingFields(common, localeData, mapping);
      item[localeKey] = locale;
      if (item.slug == null) item.slug = slug;
      normalizeCategory(item, !!mapping?.category);
      if (item.id == null) item.id = idx++;
      applyUpdatedAtAliasToEntry(
        item,
        resolveEntryUpdatedAt({
          contentType,
          slug,
          locale,
          record: item,
          contentRoot,
          isDb: false,
        }),
      );
      // Locale YAML may overwrite slug (URL). Ecommerce identity is _common.yml.
      const commonSlug =
        typeof common.slug === "string" && common.slug.trim()
          ? common.slug.trim()
          : slug;
      applyPurchasableToRecord(item, contentType, commonSlug);
      items.push(item);
    }
  }

  setStaticListingCache(contentRoot, contentType, items);
  log.info(
    { contentType, count: items.length, contentRoot },
    "[QueryEntries] Built static listing projection",
  );
  return items.map((item) => ({ ...item }));
}

/**
 * Restore `content` on static listing rows (projections omit bodies for size).
 * Used by OG live preview (`include_content=1`) and entry-preview capture.
 * When the page has multiple article sections, `content` is the concatenation of
 * all article bodies so reading time matches the on-page split-article label.
 */
export function hydrateStaticListingContent(
  items: Array<Record<string, unknown>>,
  contentType: string,
  options: {
    ci: ContentIndex;
    contentRoot?: string;
    localeKey?: string;
  },
): Array<Record<string, unknown>> {
  const { ci } = options;
  const contentRoot = options.contentRoot ?? ci.contentRoot;
  const localeKey = options.localeKey || getLocaleKey(contentType, contentRoot) || "lang";

  return items.map((item) => {
    if (typeof item.content === "string" && item.content.trim()) return item;
    const slug = String(item.slug || "");
    if (!slug) return item;
    const locale = normalizeLocale(
      String(item[localeKey] || item.lang || item.locale || item.language || "en"),
    );
    try {
      const merged = ci.loadMergedContent(contentType, slug, locale);
      const data = merged?.data as Record<string, unknown> | undefined;
      const fromArticles = combinedArticleContentFromSections(data?.sections);
      if (fromArticles) {
        return { ...item, content: fromArticles };
      }
      const body = data?.content;
      if (typeof body === "string" && body.trim()) {
        return { ...item, content: body };
      }
    } catch {
      /* keep listing row as-is */
    }
    return item;
  });
}

async function loadFromDatabase(
  database: string,
  locale: string | undefined,
  db: DatabaseManager,
): Promise<Record<string, unknown>[]> {
  if (!db.exists(database)) {
    log.warn({ database }, "[QueryEntries] Database not found");
    return [];
  }
  const raw = await db.fetchItems(database);
  let items = raw.items as Record<string, unknown>[];
  try {
    const dbConfig = db.get(database);
    if (locale && dbConfig.filter_by_locale !== false && dbConfig.field_mapping?.locale) {
      const localeField = dbConfig.field_mapping.locale;
      items = items.filter((item) => String(item[localeField] ?? "") === locale);
    }
  } catch {
    // DB not registered or no config — skip locale filter
  }
  return items;
}

async function loadFromContentType(
  contentType: string,
  locale: string | undefined,
  options: {
    db: DatabaseManager;
    ci: ContentIndex;
    contentRoot: string;
  },
): Promise<{ items: Record<string, unknown>[]; source: "database" | "content_type" }> {
  const { db, ci, contentRoot } = options;
  const ctConfig = getContentTypeConfig(contentType, contentRoot);

  if (ctConfig?.database?.slug) {
    let items = await db.fetchMappedItems(contentType);
    if (locale) {
      items = filterByContentTypeLocale(items, contentType, locale, contentRoot);
    }
    const fullMapping = getFullFieldMapping(contentType, contentRoot);
    const updatedAtSource = fullMapping?.[RESERVED_UPDATED_AT_FIELD];
    items = items.map((item) => {
      const mapped = { ...item };
      if (updatedAtSource) {
        const raw = resolveFieldValue(updatedAtSource, item, RESERVED_UPDATED_AT_FIELD);
        applyUpdatedAtAliasToEntry(mapped, raw);
      }
      applyUpdatedAtAliasToEntry(
        mapped,
        resolveEntryUpdatedAt({
          contentType,
          slug: String(mapped.slug ?? item.slug ?? ""),
          locale: locale || String(mapped.locale ?? ""),
          record: mapped,
          contentRoot,
          isDb: true,
        }),
      );
      return mapped;
    });
    return { items, source: "database" };
  }

  let items = loadStaticContentTypeItems(contentType, contentRoot, ci);
  if (locale) {
    items = filterByContentTypeLocale(items, contentType, locale, contentRoot);
  }
  return { items, source: "content_type" };
}

function attachResolvedUrls(
  items: Record<string, unknown>[],
  contentType: string,
  locale: string | undefined,
  contentRoot?: string,
): Record<string, unknown>[] {
  if (!locale) return items;
  return items.map((item) => {
    const url = resolveContentTypeUrl(contentType, item, locale, contentRoot);
    if (!url) return item;
    return { ...item, _resolved_url: url };
  });
}

/**
 * Unified query for databases and content types (DB-backed or static YAML).
 * Returns a homogeneous array of mapped records for listing components.
 */
export async function queryEntries(
  query: QueryEntriesInput,
  options: QueryEntriesOptions = {},
): Promise<QueryEntriesResult> {
  const db = options.db ?? databaseManager;
  const ci = options.contentIndex ?? contentIndex;
  const contentRoot = options.contentRoot ?? ci.contentRoot;

  const contentType =
    "contentType" in query.from && query.from.contentType
      ? query.from.contentType
      : "";
  const database =
    "database" in query.from && query.from.database ? query.from.database : "";

  let items: Record<string, unknown>[] = [];
  let source: "database" | "content_type" = "database";
  let key = "";

  if (contentType) {
    const loaded = await loadFromContentType(contentType, query.locale, {
      db,
      ci,
      contentRoot,
    });
    items = loaded.items;
    source = loaded.source;
    key = contentType;
  } else if (database) {
    items = await loadFromDatabase(database, query.locale, db);
    source = "database";
    key = database;
  } else {
    return {
      items: [],
      total: 0,
      meta: { source: "content_type", key: "" },
    };
  }

  if (contentType && source === "database") {
    items = items.map((item) => {
      const next = { ...item };
      applyPurchasableToRecord(next, contentType, String(item.slug ?? ""));
      return next;
    });
  }

  items = applyFilters(items, query.filters);
  items = applyMatchCountSort(items, query.filters, query.sort);

  if (contentType) {
    items = attachResolvedUrls(items, contentType, query.locale, contentRoot);
  }

  const total = items.length;
  if (query.limit && query.limit > 0) {
    items = items.slice(0, query.limit);
  }

  return {
    items,
    total,
    meta: { source, key },
  };
}
