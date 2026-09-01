import { databaseManager, type DatabaseManager } from "./database";
import { contentIndex, type ContentIndex } from "./content-index";
import { getDatabaseName, resolveContentTypeUrl } from "./content-types";
import { queryEntries, applyFilters, applyMatchCountSort, type QueryFilter } from "./query-entries";
import {
  applyItemTemplatePreservingUserFilters,
  enrichUserFiltersSplitComma,
} from "./dynamic-entries";
import { faqItemKey } from "@shared/faq-listing";
import { LISTING_SEARCH_MIN_CHARS } from "@shared/listing-search-config";
import { getDefaultContentFolder } from "./site-config";

export interface ListingPermanentFilter {
  item_property_slug: string;
  value: unknown;
}

export interface ListingUserFilter {
  item_property_slug: string;
  component_renderer: string;
  default_value?: unknown;
  all_label?: string;
  split_comma_values?: boolean;
}

export interface ListingSearchInput {
  database?: string | null;
  contentType?: string;
  locale?: string;
  q?: string;
  limit?: number;
  permanentFilters?: ListingPermanentFilter[];
  itemTemplate?: Record<string, unknown>;
  userFilters?: ListingUserFilter[];
  sort?: string;
  searchFields?: string[];
  contentRoot?: string;
  db?: DatabaseManager;
  contentIndex?: ContentIndex;
}

export type ListingSearchFallbackReason = "no_database" | "query_too_short";

export interface ListingSearchResult {
  items: Record<string, unknown>[];
  count: number;
  semantic: boolean;
  scores?: Record<string, number>;
  fallback_reason?: ListingSearchFallbackReason | string;
  fallback_message?: string;
}

export function resolveListingDatabase(
  contentType?: string,
  database?: string | null,
  contentRoot?: string,
): string | null {
  if (database) return database;
  if (contentType) return getDatabaseName(contentType, contentRoot);
  return null;
}

export function isSemanticSearchEnabled(dbName: string, db?: DatabaseManager): boolean {
  const dbm = db ?? databaseManager;
  if (!dbm.exists(dbName)) return false;
  const config = dbm.get(dbName);
  const vs = (config as { vector_search?: { enabled?: boolean; fields?: string[] } })
    .vector_search;
  return Boolean(vs?.enabled && Array.isArray(vs.fields) && vs.fields.length > 0);
}

function toQueryFilters(permanentFilters?: ListingPermanentFilter[]): QueryFilter[] | undefined {
  if (!permanentFilters?.length) return undefined;
  return permanentFilters.map((pf) => ({
    field: pf.item_property_slug,
    value: pf.value,
  }));
}

function mapListingItems(
  items: Record<string, unknown>[],
  opts: {
    contentType?: string;
    locale?: string;
    contentRoot?: string;
    itemTemplate?: Record<string, unknown>;
    userFilters?: ListingUserFilter[];
  },
): Record<string, unknown>[] {
  const { contentType, locale, contentRoot, itemTemplate, userFilters } = opts;
  if (!itemTemplate) {
    return items.map((item) => {
      if (contentType && !(item as { _resolved_url?: string })._resolved_url) {
        const url = resolveContentTypeUrl(contentType, item, locale || "en", contentRoot);
        if (url) (item as Record<string, unknown>)._resolved_url = url;
      }
      return item;
    });
  }
  return items.map((item) => {
    const enriched = { ...item };
    if (contentType && !enriched._resolved_url) {
      const url = resolveContentTypeUrl(contentType, item, locale || "en", contentRoot);
      if (url) enriched._resolved_url = url;
    }
    return applyItemTemplatePreservingUserFilters(itemTemplate, enriched, userFilters);
  });
}

export async function searchListingItems(
  input: ListingSearchInput,
): Promise<ListingSearchResult> {
  const db = input.db ?? databaseManager;
  const ci = input.contentIndex ?? contentIndex;
  const contentRoot = input.contentRoot ?? ci.contentRoot ?? getDefaultContentFolder();
  const contentType = input.contentType || "";
  const dbName = resolveListingDatabase(contentType || undefined, input.database, contentRoot);
  const locale = input.locale;
  const limit = Math.min(Math.max(1, input.limit ?? 100), 100);
  const filters = toQueryFilters(input.permanentFilters);
  const enrichedUserFilters = enrichUserFiltersSplitComma(input.userFilters, {
    contentType: contentType || undefined,
    database: dbName ?? undefined,
    contentRoot,
    db,
  });

  if (!dbName) {
    return {
      items: [],
      count: 0,
      semantic: false,
      fallback_reason: "no_database",
      fallback_message: "This listing has no linked database — semantic search is unavailable.",
    };
  }

  const q = (input.q ?? "").trim();
  const hasSearchQuery = q.length >= LISTING_SEARCH_MIN_CHARS;

  let rawItems: Record<string, unknown>[] = [];
  let semantic = false;
  let scores: Record<string, number> | undefined;
  let fallback_reason: string | undefined;
  let fallback_message: string | undefined;

  if (hasSearchQuery) {
    const {
      searchDatabaseItems,
      SEARCH_CACHE_CEILING,
      intersectSearchWithFiltersAndBackfill,
    } = await import("./database-search");

    const searchResult = await searchDatabaseItems(dbName, q, {
      limit: SEARCH_CACHE_CEILING,
      locale,
      db,
      contentFolder: contentRoot,
      keywordFields: input.searchFields,
    });

    semantic = searchResult.semantic;
    scores = searchResult.scores;
    fallback_reason = searchResult.fallback_reason;
    fallback_message = searchResult.fallback_message;

    let searchHits = applyFilters(searchResult.items, filters);

    const filterOnlyResult = await queryEntries(
      {
        from: { database: dbName },
        locale,
        filters,
        sort: input.sort,
        limit: undefined,
      },
      { db, contentIndex: ci, contentRoot },
    );
    const filterOnly = applyMatchCountSort(filterOnlyResult.items, filters, input.sort);

    rawItems = intersectSearchWithFiltersAndBackfill(
      searchHits,
      filterOnly,
      limit,
      (item) => {
        const slug = item.slug ?? item.id;
        if (slug !== undefined && slug !== null && String(slug)) return `slug:${String(slug)}`;
        return `q:${faqItemKey(String(item.question ?? item.title ?? ""))}`;
      },
    );
  } else {
    const from = contentType
      ? ({ contentType } as const)
      : ({ database: dbName } as const);

    const result = await queryEntries(
      {
        from,
        locale,
        filters,
        sort: input.sort,
        limit,
      },
      { db, contentIndex: ci, contentRoot },
    );
    rawItems = result.items.slice(0, limit);
  }

  const items = mapListingItems(rawItems, {
    contentType: contentType || undefined,
    locale,
    contentRoot,
    itemTemplate: input.itemTemplate,
    userFilters: enrichedUserFilters,
  });

  return {
    items,
    count: items.length,
    semantic,
    ...(scores && { scores }),
    ...(fallback_reason && { fallback_reason, fallback_message }),
  };
}

export function parseJsonQueryParam<T>(raw: unknown, label: string): T | undefined {
  if (raw == null || raw === "") return undefined;
  if (typeof raw !== "string") return undefined;
  try {
    return JSON.parse(raw) as T;
  } catch {
    throw new Error(`Invalid JSON for ${label}`);
  }
}
