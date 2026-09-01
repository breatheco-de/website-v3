import { databaseManager, type DatabaseManager } from "./database";
import { contentIndex, type ContentIndex } from "./content-index";
import { getContentTypeConfig, resolveContentTypeUrl } from "./content-types";
import { isSemanticSearchEnabled, resolveListingDatabase } from "./listing-search";
import { normalizeListingSearchConfig } from "@shared/listing-search-config";
import { queryEntries, type QueryFilter, applyFilters, applyMatchCountSort } from "./query-entries";
import { child } from "./logger";
import { resolveSingleTemplateValue } from "@shared/json-field";
import { applyIgnoredEntries, faqItemKey } from "@shared/faq-listing";
import {
  TESTIMONIALS_DATABASE,
  TESTIMONIALS_LIMIT_DEFAULTS,
  normalizeTestimonialsListing,
  testimonialItemKey,
  testimonialsValidityFilter,
  type TestimonialsSectionType,
} from "@shared/testimonials-listing";

export { faqItemKey, applyIgnoredEntries } from "@shared/faq-listing";

const log = child({ module: "dynamic-entries" });

export interface ResolveDynamicEntriesOptions {
  db?: DatabaseManager;
  contentRoot?: string;
  contentIndex?: ContentIndex;
  /**
   * Current page's single entry (DB or YAML-mapped fields).
   * Used to resolve `{{ single.* }}` in permanent_filters, search, and
   * hardcoded_entries before querying/merging (resolveSingleVars runs too late).
   */
  singleEntry?: Record<string, unknown>;
}

interface PermanentFilter {
  item_property_slug: string;
  value: unknown;
}

interface UserFilter {
  item_property_slug: string;
  component_renderer: string;
  default_value?: unknown;
  all_label?: string;
  /** Injected from CT/DB field editor when true — client tag chips split CSV. */
  split_comma_values?: boolean;
}

interface DynamicEntriesConfig {
  content_type?: string;
  database?: string;
  limit?: number;
  sort?: string;
  search?: string;
  permanent_filters?: PermanentFilter[];
  user_filters?: UserFilter[];
  ignored_entries?: string[];
}

const MIN_SEARCH_CHARS = 3;

/** Resolve `{{ single.* }}` against the page entry (or pipe fallback when missing). */
function resolveAgainstSingle(
  value: unknown,
  singleEntry?: Record<string, unknown>,
): unknown {
  return resolveSingleTemplateValue(value, singleEntry ?? {});
}

/**
 * Resolve hardcoded_entries when still a `{{ single.* }}` bind string.
 * Exported for unit tests.
 */
export function resolveHardcodedEntriesForDynamic(
  raw: unknown,
  singleEntry?: Record<string, unknown>,
): unknown[] {
  const resolved = resolveAgainstSingle(raw, singleEntry);
  return Array.isArray(resolved) ? resolved : [];
}

/**
 * Resolve dynamic_entries.search when still a `{{ single.* }}` bind.
 * Exported for unit tests.
 */
export function resolveSearchPhraseForDynamic(
  raw: unknown,
  singleEntry?: Record<string, unknown>,
): string {
  const resolved = resolveAgainstSingle(raw, singleEntry);
  return typeof resolved === "string" ? resolved.trim() : "";
}

/**
 * Manually-added FAQs first, then DB — total capped at `limit` when set.
 * Exported for unit tests.
 */
export function mergeFaqItemsWithLimit(
  hardcoded: unknown[],
  dbItems: unknown[],
  limit?: number,
): unknown[] {
  if (!limit || limit <= 0) return [...hardcoded, ...dbItems];
  const includedHardcoded = hardcoded.slice(0, limit);
  const remaining = Math.max(0, limit - includedHardcoded.length);
  return [...includedHardcoded, ...dbItems.slice(0, remaining)];
}

/**
 * Whether the CT/DB field editor has `split_comma_values` for this property.
 * Checks content-type editor first, then linked (or explicit) database editor.
 * Exported for unit tests.
 */
export function lookupSplitCommaValues(
  field: string,
  opts: {
    contentType?: string;
    database?: string;
    contentRoot?: string;
    db?: DatabaseManager;
  },
): boolean {
  const db = opts.db ?? databaseManager;
  if (opts.contentType) {
    const ct = getContentTypeConfig(opts.contentType, opts.contentRoot);
    if (ct?.editor?.[field]?.split_comma_values === true) return true;
    const dbSlug = ct?.database?.slug || opts.database;
    if (dbSlug && db.exists(dbSlug)) {
      if (db.get(dbSlug).editor?.[field]?.split_comma_values === true) return true;
    }
    return false;
  }
  if (opts.database && db.exists(opts.database)) {
    return db.get(opts.database).editor?.[field]?.split_comma_values === true;
  }
  return false;
}

/**
 * Attach `split_comma_values: true` onto user_filters when the field editor enables it.
 * Exported for unit tests.
 */
export function enrichUserFiltersSplitComma(
  userFilters: UserFilter[] | undefined,
  opts: {
    contentType?: string;
    database?: string;
    contentRoot?: string;
    db?: DatabaseManager;
  },
): UserFilter[] | undefined {
  if (!userFilters?.length) return userFilters;
  return userFilters.map((uf) => {
    const split = lookupSplitCommaValues(uf.item_property_slug, opts);
    if (!split) {
      if (uf.split_comma_values === undefined) return uf;
      const { split_comma_values: _drop, ...rest } = uf;
      return rest;
    }
    return { ...uf, split_comma_values: true };
  });
}

/**
 * Apply item_template, then copy any missing user_filter fields from the raw entry
 * so tag/dropdown chips can still read multi-value properties omitted from the card map.
 * Exported for unit tests.
 */
export function applyItemTemplatePreservingUserFilters(
  itemTemplate: Record<string, unknown>,
  enriched: Record<string, unknown>,
  userFilters: UserFilter[] | undefined,
): Record<string, unknown> {
  const mapped = resolveAgainstSingle(itemTemplate, enriched);
  const out =
    mapped !== null && typeof mapped === "object" && !Array.isArray(mapped)
      ? { ...(mapped as Record<string, unknown>) }
      : {};
  for (const uf of userFilters || []) {
    const slug = uf.item_property_slug;
    if (!slug) continue;
    if (!(slug in out) || out[slug] === undefined) {
      if (slug in enriched) out[slug] = enriched[slug];
    }
  }
  return out;
}

export async function resolveDynamicEntries(
  sections: unknown[],
  locale: string,
  options: ResolveDynamicEntriesOptions = {},
): Promise<unknown[]> {
  if (!Array.isArray(sections)) return sections;

  const db = options.db ?? databaseManager;
  const contentRoot = options.contentRoot;
  const ci = options.contentIndex ?? contentIndex;
  const singleEntry = options.singleEntry;

  const resolved = [];
  for (const section of sections) {
    if (!section || typeof section !== "object") {
      resolved.push(section);
      continue;
    }

    // Straggler safety net: testimonials sections the bulk YAML migration missed
    // still resolve, because their legacy root fields fold into dynamic_entries here.
    const rawSec = section as Record<string, unknown>;
    const sec = normalizeTestimonialsListing(rawSec) ?? rawSec;
    const dynamicEntries = sec.dynamic_entries as
      | (DynamicEntriesConfig & {
          item_template?: Record<string, unknown>;
          hardcoded_entries?: unknown[];
        })
      | undefined;
    const itemTemplate = (dynamicEntries?.item_template || sec.item_template) as
      | Record<string, unknown>
      | undefined;

    if (!dynamicEntries || (!dynamicEntries.content_type && !dynamicEntries.database)) {
      resolved.push(section);
      continue;
    }

    try {
      const contentType = dynamicEntries.content_type || "";
      // Resolve before merge/limit — resolveSingleVars runs after this function.
      const hardcodedEntries = resolveHardcodedEntriesForDynamic(
        dynamicEntries?.hardcoded_entries ?? sec.hardcoded_entries,
        singleEntry,
      );
      const limit =
        dynamicEntries.limit && dynamicEntries.limit > 0
          ? dynamicEntries.limit
          : undefined;
      // Cap manually-added rows too — limit is total questions shown, not DB-only.
      const includedHardcoded =
        limit != null ? hardcodedEntries.slice(0, limit) : hardcodedEntries;
      const hardcodedCount = includedHardcoded.length;
      const hasIgnored =
        Array.isArray(dynamicEntries.ignored_entries) &&
        dynamicEntries.ignored_entries.length > 0;
      // Testimonials rows have no question — they are identified by person.
      const isTestimonials = dynamicEntries.database === TESTIMONIALS_DATABASE;
      const contentKey = isTestimonials
        ? (item: Record<string, unknown>) => testimonialItemKey(item.student_name)
        : undefined;
      /**
       * Testimonials layouts cannot render every bank row (anonymous people, video
       * rows in the carousel, photo-less rows in the slide). Those rows have to go
       * before the limit slice: the highest-priority rows are all video, so slicing
       * first and filtering in the renderer would leave a carousel empty.
       */
      const sectionType = String(sec.type ?? "") as TestimonialsSectionType;
      const renderableFilter =
        isTestimonials && sectionType in TESTIMONIALS_LIMIT_DEFAULTS
          ? testimonialsValidityFilter(sectionType)
          : undefined;
      const keepRenderable = (rows: Record<string, unknown>[]) =>
        renderableFilter ? rows.filter((row) => renderableFilter(row)) : rows;

      // Resolve {{ single.* }} in filter values against the page's singleEntry
      // before querying (resolveSingleVars runs too late for listing filters).
      const filters: QueryFilter[] | undefined = dynamicEntries.permanent_filters?.map((pf) => ({
        field: pf.item_property_slug,
        value: resolveAgainstSingle(pf.value, singleEntry),
      }));

      const searchPhrase = resolveSearchPhraseForDynamic(
        dynamicEntries.search,
        singleEntry,
      );
      const resolvedDatabase = resolveListingDatabase(
        contentType || undefined,
        dynamicEntries.database,
        contentRoot,
      );
      const useSearch =
        Boolean(resolvedDatabase) &&
        searchPhrase.length >= MIN_SEARCH_CHARS;

      let items: Record<string, unknown>[];

      if (useSearch) {
        const {
          searchDatabaseItems,
          SEARCH_CACHE_CEILING,
          intersectSearchWithFiltersAndBackfill,
        } = await import("./database-search");

        const remainingSlots =
          limit != null ? Math.max(0, limit - hardcodedCount) : SEARCH_CACHE_CEILING;

        const searchResult = await searchDatabaseItems(resolvedDatabase!, searchPhrase, {
          limit: SEARCH_CACHE_CEILING,
          locale,
          db,
        });

        let searchHits = applyFilters(searchResult.items, filters);
        searchHits = keepRenderable(
          applyIgnoredEntries(searchHits, dynamicEntries.ignored_entries, contentKey),
        );

        // Filter-only pool for 1B backfill (and when search ∩ filters is short)
        const filterOnlyResult = await queryEntries(
          {
            from: { database: resolvedDatabase! },
            locale,
            filters,
            sort: dynamicEntries.sort,
            limit: undefined,
          },
          { db, contentIndex: ci, contentRoot: contentRoot ?? ci.contentRoot },
        );
        const filterOnly = applyMatchCountSort(
          keepRenderable(
            applyIgnoredEntries(
              filterOnlyResult.items,
              dynamicEntries.ignored_entries,
              contentKey,
            ),
          ),
          filters,
          dynamicEntries.sort,
        );

        items = intersectSearchWithFiltersAndBackfill(
          searchHits,
          filterOnly,
          remainingSlots,
          (item) => {
            const slug = item.slug ?? item.id;
            if (slug !== undefined && slug !== null && String(slug)) return `slug:${String(slug)}`;
            if (contentKey) return `k:${contentKey(item)}`;
            return `q:${faqItemKey(String(item.question ?? ""))}`;
          },
        );
      } else {
        // When rows can be dropped after the query (FAQ ignores, testimonials
        // layout validity), fetch without a limit so the slice happens last.
        const queryLimit =
          !hasIgnored && !renderableFilter && limit != null
            ? Math.max(0, limit - hardcodedCount)
            : undefined;

        const from = contentType
          ? ({ contentType } as const)
          : ({ database: resolvedDatabase! } as const);

        const result = await queryEntries(
          {
            from,
            locale,
            filters,
            sort: dynamicEntries.sort,
            limit: queryLimit,
          },
          { db, contentIndex: ci, contentRoot: contentRoot ?? ci.contentRoot },
        );

        items = result.items;

        if (hasIgnored || renderableFilter) {
          items = keepRenderable(
            applyIgnoredEntries(items, dynamicEntries.ignored_entries, contentKey),
          );
          if (limit != null) {
            items = items.slice(0, Math.max(0, limit - hardcodedCount));
          }
        }
      }

      const enrichedUserFilters = enrichUserFiltersSplitComma(
        dynamicEntries.user_filters,
        {
          contentType: contentType || undefined,
          database: dynamicEntries.database,
          contentRoot,
          db,
        },
      );

      let resolvedItems: unknown[];
      if (itemTemplate) {
        resolvedItems = items.map((item) => {
          const enriched = { ...item };
          if (contentType && !enriched._resolved_url) {
            const url = resolveContentTypeUrl(contentType, item, locale, contentRoot);
            if (url) enriched._resolved_url = url;
          }
          return applyItemTemplatePreservingUserFilters(
            itemTemplate,
            enriched,
            enrichedUserFilters,
          );
        });
      } else {
        resolvedItems = items.map((item) => {
          if (contentType && !(item as { _resolved_url?: string })._resolved_url) {
            const url = resolveContentTypeUrl(contentType, item, locale, contentRoot);
            if (url) (item as Record<string, unknown>)._resolved_url = url;
          }
          return item;
        });
      }

      const finalItems = mergeFaqItemsWithLimit(
        includedHardcoded,
        resolvedItems,
        limit,
      );

      const listingSearch = normalizeListingSearchConfig(
        sec as { search?: { enabled?: boolean; placeholder?: string; fields?: string[] }; show_search?: boolean; search_placeholder?: string },
      );
      const resolvedPermanentFilters =
        dynamicEntries.permanent_filters?.map((pf) => ({
          item_property_slug: pf.item_property_slug,
          value: resolveAgainstSingle(pf.value, singleEntry),
        })) ?? [];

      resolved.push({
        ...sec,
        // Keep resolved array on the section so FAQ UI / schema see it before
        // the later resolveAllTemplateVars pass.
        ...(hardcodedEntries.length > 0 ? { hardcoded_entries: hardcodedEntries } : {}),
        dynamic_entries: {
          ...dynamicEntries,
          ...(enrichedUserFilters ? { user_filters: enrichedUserFilters } : {}),
        },
        items: finalItems,
        _dynamic_meta: {
          content_type: contentType || dynamicEntries.database,
          database: resolvedDatabase,
          total: finalItems.length,
          locale,
          semantic_search_enabled: resolvedDatabase
            ? isSemanticSearchEnabled(resolvedDatabase, db)
            : false,
          search_config: {
            enabled: listingSearch.enabled,
            placeholder: listingSearch.placeholder,
            fields: listingSearch.fields,
            permanent_filters: resolvedPermanentFilters,
            item_template: itemTemplate,
            sort: dynamicEntries.sort,
          },
        },
      });
    } catch (err) {
      log.error({ err: err }, "[DynamicEntries] Error resolving section:");
      resolved.push(section);
    }
  }

  return resolved;
}
