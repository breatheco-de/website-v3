import {
  DEFAULT_LISTING_SEARCH_CARD_FIELDS,
  LISTING_SEARCH_MIN_CHARS,
  type ListingSearchMetaConfig,
} from "@shared/listing-search-config";
import {
  collectEditorFieldTokens,
  itemHasEditorFieldToken,
} from "@shared/editor-field-values";

export type ListingSearchApiResponse = {
  items: Record<string, unknown>[];
  count: number;
  semantic: boolean;
  scores?: Record<string, number>;
  fallback_reason?: string;
  fallback_message?: string;
};

export function buildListingSearchUrl(opts: {
  database?: string | null;
  contentType?: string;
  locale?: string;
  q?: string;
  limit?: number;
  searchConfig?: ListingSearchMetaConfig;
}): string | null {
  const { database, contentType, locale, q, limit = 100, searchConfig } = opts;
  if (!database && !contentType) return null;
  const params = new URLSearchParams();
  if (database) params.set("database", database);
  if (contentType) params.set("content_type", contentType);
  if (locale) params.set("locale", locale);
  if (q && q.trim().length >= LISTING_SEARCH_MIN_CHARS) params.set("q", q.trim());
  params.set("limit", String(limit));
  if (searchConfig?.sort) params.set("sort", searchConfig.sort);
  if (searchConfig?.permanent_filters?.length) {
    params.set("filters", JSON.stringify(searchConfig.permanent_filters));
  }
  if (searchConfig?.item_template && Object.keys(searchConfig.item_template).length > 0) {
    params.set("item_template", JSON.stringify(searchConfig.item_template));
  }
  if (searchConfig?.fields?.length) {
    params.set("search_fields", JSON.stringify(searchConfig.fields));
  }
  return `/api/listings/search?${params.toString()}`;
}

/** Substring fallback on card-shaped rows when no DB semantic search. */
export function filterListingItemsByQuery(
  items: Record<string, unknown>[],
  query: string,
  fieldKeys: readonly string[] = DEFAULT_LISTING_SEARCH_CARD_FIELDS,
): Record<string, unknown>[] {
  const q = query.trim().toLowerCase();
  if (!q) return items;
  return items.filter((item) =>
    fieldKeys.some((key) => {
      const raw = item[key];
      if (raw == null) return false;
      if (typeof raw === "object" && raw !== null && "slug" in (raw as Record<string, unknown>)) {
        return String((raw as Record<string, unknown>).slug).toLowerCase().includes(q);
      }
      return String(raw).toLowerCase().includes(q);
    }),
  );
}

export { LISTING_SEARCH_MIN_CHARS };

export type ListingUserFilter = {
  item_property_slug: string;
  component_renderer: "text-input" | "dropdown" | "tags";
  default_value?: unknown;
  split_comma_values?: boolean;
};

function getFieldStringValue(item: Record<string, unknown>, slug: string): string {
  const raw = item[slug];
  if (raw === undefined || raw === null) return "";
  if (typeof raw === "object" && "slug" in (raw as Record<string, unknown>)) {
    return String((raw as Record<string, unknown>).slug);
  }
  return String(raw);
}

/** Client-side user_filters (tags/dropdown/text-input) applied after search. */
export function applyListingUserFilters<T extends Record<string, unknown>>(
  source: T[],
  userFilters: ListingUserFilter[],
  userFilterValues: Record<string, string>,
): T[] {
  if (!userFilters.length) return source;
  return source.filter((item) =>
    userFilters.every((f) => {
      const val = userFilterValues[f.item_property_slug];
      if (!val) return true;
      if (f.component_renderer === "tags") {
        return itemHasEditorFieldToken(item, f.item_property_slug, val, {
          splitComma: f.split_comma_values === true,
        });
      }
      const itemVal = getFieldStringValue(item, f.item_property_slug);
      if (f.component_renderer === "text-input") {
        return itemVal.toLowerCase().includes(val.toLowerCase());
      }
      return itemVal === val;
    }),
  );
}

/** Search first (API or substring), then user_filters; hardcoded entries stay pinned. */
export function computeListingSearchPool(opts: {
  hasActiveSearch: boolean;
  userFiltered: Record<string, unknown>[];
  useSemanticSearch: boolean;
  apiItems?: Record<string, unknown>[] | null;
  hardcodedItems: Record<string, unknown>[];
  ssrDbItems: Record<string, unknown>[];
  activeSearchQuery: string;
  searchFieldKeys?: readonly string[];
  userFilters: ListingUserFilter[];
  userFilterValues: Record<string, string>;
}): Record<string, unknown>[] {
  const {
    hasActiveSearch,
    userFiltered,
    useSemanticSearch,
    apiItems,
    hardcodedItems,
    ssrDbItems,
    activeSearchQuery,
    searchFieldKeys,
    userFilters,
    userFilterValues,
  } = opts;

  if (!hasActiveSearch) return userFiltered;

  if (useSemanticSearch && apiItems) {
    const fromApi = apiItems;
    return [
      ...hardcodedItems,
      ...applyListingUserFilters(fromApi, userFilters, userFilterValues),
    ];
  }

  const searchedDb = filterListingItemsByQuery(
    ssrDbItems,
    activeSearchQuery,
    searchFieldKeys ?? DEFAULT_LISTING_SEARCH_CARD_FIELDS,
  );
  return [
    ...hardcodedItems,
    ...applyListingUserFilters(searchedDb, userFilters, userFilterValues),
  ];
}

/** Sync visitor ?q= into URL params; clears page when q changes (shareable listing state). */
export function syncListingQueryParam(
  params: URLSearchParams,
  q: string,
): URLSearchParams {
  const trimmed = q.trim();
  if (trimmed) params.set("q", trimmed);
  else params.delete("q");
  params.delete("page");
  return params;
}
