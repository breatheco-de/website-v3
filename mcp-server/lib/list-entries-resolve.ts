/**
 * Unified list_entries resolve: type stats or paginated one-row-per-page entries.
 * Listing matches site cards (cache + overrides + CT mapping); page-only field_overrides stay out.
 */

import { getDefaultLocale } from "../../server/settings.js";
import { slugKey } from "../../shared/slug.js";
import { commonYmlPath, readFunnelBlockFromFile } from "../../server/funnel-fields.js";
import {
  enrichFunnelFields,
  hasAnyFunnelFilter,
  pageMatchesFunnelFilters,
  type ListEntriesFunnelFilters,
} from "./list-entries-funnel.js";

export const LIST_ENTRIES_DEFAULT_LIMIT = 50;
export const LIST_ENTRIES_MAX_LIMIT = 200;

const DETAIL_SCALAR_KEYS = [
  "category",
  "category_name",
  "tags",
  "difficulty",
  "duration",
  "description",
  "updated_at",
  "image",
  "image_url",
  "author",
  "author_name",
] as const;

export type ListEntryRow = {
  /** Page ID (folder name); stable across renames and languages. */
  entry_id: string;
  /** Default-language public address. */
  slug: string;
  contentType: string;
  locales: string[];
  /** Language → that language's public address. */
  locale_slugs?: Record<string, string>;
  title?: string;
  urls?: Record<string, string>;
  [key: string]: unknown;
};

export type TypeStat = {
  contentType: string;
  count: number;
};

export type FailedType = {
  contentType: string;
  error: string;
};

export type FetchItemsResult =
  | { ok: true; results: Record<string, unknown>[]; total: number }
  | { ok: false; error: string };

export type FetchItemsFn = (opts: {
  contentType: string;
  domain: string | null;
  locale?: string;
  /** When true, request page=1&pageSize=1 and use response.total only. */
  countOnly?: boolean;
}) => Promise<FetchItemsResult>;

export function clampListLimit(raw: number | undefined): number {
  if (raw === undefined || Number.isNaN(raw)) return LIST_ENTRIES_DEFAULT_LIMIT;
  return Math.min(LIST_ENTRIES_MAX_LIMIT, Math.max(1, Math.floor(raw)));
}

export function clampListPage(raw: number | undefined): number {
  if (raw === undefined || Number.isNaN(raw)) return 1;
  return Math.max(1, Math.floor(raw));
}

export function pickTitle(
  titlesByLocale: Record<string, string>,
  locales: string[],
  requestedLocale: string | undefined,
  defaultLocale: string,
): string | undefined {
  const tryLocale = (loc: string): string | undefined => {
    const t = titlesByLocale[loc];
    return typeof t === "string" && t.trim() ? t.trim() : undefined;
  };
  if (requestedLocale) {
    const hit = tryLocale(requestedLocale);
    if (hit) return hit;
  }
  if (defaultLocale) {
    const hit = tryLocale(defaultLocale);
    if (hit) return hit;
  }
  const en = tryLocale("en");
  if (en) return en;
  for (const loc of locales) {
    const hit = tryLocale(loc);
    if (hit) return hit;
  }
  return undefined;
}

function localeOfItem(item: Record<string, unknown>): string | undefined {
  for (const key of ["locale", "language", "lang"] as const) {
    const v = item[key];
    if (typeof v === "string" && v.trim()) return v.trim();
  }
  return undefined;
}

function urlOfItem(item: Record<string, unknown>, locale: string | undefined): string | undefined {
  const resolved = item._resolved_url;
  if (typeof resolved === "string" && resolved.trim()) return resolved.trim();
  if (locale && item.urls && typeof item.urls === "object" && !Array.isArray(item.urls)) {
    const u = (item.urls as Record<string, unknown>)[locale];
    if (typeof u === "string" && u.trim()) return u.trim();
  }
  return undefined;
}

/**
 * Collapse listing API rows (one per language) into one row per page, keyed by the page ID
 * (`entry_id`; falls back to the row slug when the listing has none).
 */
export function normalizeToSlugRows(
  contentType: string,
  items: Record<string, unknown>[],
  opts: {
    requestedLocale?: string;
    defaultLocale: string;
  },
): ListEntryRow[] {
  const byPage = new Map<
    string,
    {
      locales: Set<string>;
      titlesByLocale: Record<string, string>;
      urls: Record<string, string>;
      localeSlugs: Record<string, string>;
      firstSlug: string;
      samples: Record<string, unknown>[];
    }
  >();

  for (const item of items) {
    const slugRaw = item.slug;
    if (typeof slugRaw !== "string" || !slugRaw.trim()) continue;
    const slug = slugRaw.trim();
    const entryId = typeof item.entry_id === "string" && item.entry_id.trim() ? item.entry_id.trim() : slug;
    const locale = localeOfItem(item);
    let bucket = byPage.get(entryId);
    if (!bucket) {
      bucket = { locales: new Set(), titlesByLocale: {}, urls: {}, localeSlugs: {}, firstSlug: slug, samples: [] };
      byPage.set(entryId, bucket);
    }
    bucket.samples.push(item);
    if (locale) {
      bucket.locales.add(locale);
      bucket.localeSlugs[locale] ??= slug;
      const title = item.title;
      if (typeof title === "string" && title.trim()) {
        bucket.titlesByLocale[locale] = title.trim();
      }
      const url = urlOfItem(item, locale);
      if (url) bucket.urls[locale] = url;
    } else if (typeof item.title === "string" && item.title.trim() && !bucket.titlesByLocale._) {
      bucket.titlesByLocale._ = item.title.trim();
    }
  }

  const rows: ListEntryRow[] = [];
  for (const [entryId, bucket] of byPage) {
    const locales = [...bucket.locales].sort();
    const title =
      pickTitle(bucket.titlesByLocale, locales, opts.requestedLocale, opts.defaultLocale) ??
      (typeof bucket.titlesByLocale._ === "string" ? bucket.titlesByLocale._ : undefined);
    const ls = bucket.localeSlugs;
    const slug = ls[opts.defaultLocale] ?? ls.en ?? (locales[0] ? ls[locales[0]] : undefined) ?? bucket.firstSlug;
    const row: ListEntryRow = {
      entry_id: entryId,
      slug,
      contentType,
      locales,
      ...(Object.keys(ls).length > 0 ? { locale_slugs: ls } : {}),
      ...(title ? { title } : {}),
      ...(Object.keys(bucket.urls).length > 0 ? { urls: bucket.urls } : {}),
      _samples: bucket.samples,
    };
    rows.push(row);
  }
  rows.sort((a, b) => a.entry_id.localeCompare(b.entry_id));
  return rows;
}

/** Page ID and every language's address of a row (what `slugs` / `search` match against). */
function rowAddresses(r: ListEntryRow): string[] {
  return [r.entry_id, r.slug, ...Object.values(r.locale_slugs ?? {})].filter(
    (a): a is string => typeof a === "string" && a.length > 0,
  );
}

export function filterSlugRows(
  rows: ListEntryRow[],
  opts: {
    locale?: string;
    slugs?: string[];
    search?: string;
    funnelFilters?: ListEntriesFunnelFilters;
    contentFolder: string;
    enrichFunnel?: boolean;
  },
): ListEntryRow[] {
  let out = rows;
  if (opts.locale) {
    out = out.filter((r) => r.locales.includes(opts.locale!));
  }
  // undefined = no slug filter; [] = match nothing (e.g. refresh_tier with zero index hits).
  // Any address (page ID or a language's slug) in any spelling matches.
  if (opts.slugs !== undefined) {
    const keys = new Set(opts.slugs.map((s) => slugKey(s)).filter(Boolean));
    out = out.filter((r) => rowAddresses(r).some((a) => keys.has(slugKey(a))));
  }
  if (opts.search) {
    const q = opts.search.toLowerCase();
    const qKey = slugKey(opts.search);
    out = out.filter(
      (r) =>
        (qKey !== "" && rowAddresses(r).some((a) => slugKey(a).includes(qKey))) ||
        (r.title ?? "").toLowerCase().includes(q),
    );
  }
  const funnelFilters = opts.funnelFilters;
  const useFunnel = funnelFilters && hasAnyFunnelFilter(funnelFilters);
  if (useFunnel && funnelFilters) {
    const enriched: ListEntryRow[] = [];
    for (const r of out) {
      const pageId = r.entry_id || r.slug;
      const funnel = readFunnelBlockFromFile(commonYmlPath(r.contentType, pageId, opts.contentFolder));
      const ctx = { contentType: r.contentType, contentSlug: pageId };
      if (!pageMatchesFunnelFilters(funnel, funnelFilters, ctx)) continue;
      if (opts.enrichFunnel) {
        enriched.push({ ...r, ...enrichFunnelFields(funnel, ctx) });
      } else {
        enriched.push(r);
      }
    }
    out = enriched;
  }
  return out;
}

export function projectEntries(
  rows: ListEntryRow[],
  opts: { detail?: boolean },
): ListEntryRow[] {
  const detail = !!opts.detail;
  return rows.map((r) => {
    const base: ListEntryRow = {
      entry_id: r.entry_id,
      slug: r.slug,
      contentType: r.contentType,
      locales: r.locales,
      ...(r.locale_slugs ? { locale_slugs: r.locale_slugs } : {}),
      ...(r.title ? { title: r.title } : {}),
      ...(r.urls ? { urls: r.urls } : {}),
    };
    if (r.funnel !== undefined) base.funnel = r.funnel;
    if (r.is_money_page !== undefined) base.is_money_page = r.is_money_page;
    if (r.stage_missing !== undefined) base.stage_missing = r.stage_missing;

    if (!detail) return base;

    const samples = Array.isArray(r._samples)
      ? (r._samples as Record<string, unknown>[])
      : [];
    const preferred =
      samples.find((s) => localeOfItem(s) === r.locales[0]) ?? samples[0] ?? {};
    for (const key of DETAIL_SCALAR_KEYS) {
      if (!(key in preferred)) continue;
      const v = preferred[key];
      if (v === undefined || v === null) continue;
      if (typeof v === "string" || typeof v === "number" || typeof v === "boolean") {
        base[key] = v;
      } else if (Array.isArray(v) && v.every((x) => typeof x === "string" || typeof x === "number")) {
        base[key] = v;
      }
    }
    return base;
  });
}

export function paginateRows<T>(
  rows: T[],
  page: number,
  limit: number,
): {
  pageItems: T[];
  page: number;
  limit: number;
  total: number;
  count: number;
  has_more: boolean;
} {
  const total = rows.length;
  const totalPages = Math.max(1, Math.ceil(total / limit) || 1);
  const safePage = Math.min(Math.max(1, page), totalPages);
  const start = (safePage - 1) * limit;
  const pageItems = rows.slice(start, start + limit);
  return {
    pageItems,
    page: safePage,
    limit,
    total,
    count: pageItems.length,
    has_more: start + pageItems.length < total,
  };
}

export function createDefaultFetchItems(port: string, headers: Record<string, string>): FetchItemsFn {
  return async ({ contentType, domain, locale, countOnly }) => {
    const params = new URLSearchParams();
    if (domain) params.set("__site", domain);
    if (locale) params.set("locale", locale);
    if (countOnly) {
      params.set("page", "1");
      params.set("pageSize", "1");
    }
    const qs = params.toString();
    const url = `http://127.0.0.1:${port}/api/content-types/${encodeURIComponent(contentType)}/items${qs ? `?${qs}` : ""}`;
    try {
      const res = await fetch(url, { headers });
      const text = await res.text();
      let data: Record<string, unknown> = {};
      try {
        data = text ? (JSON.parse(text) as Record<string, unknown>) : {};
      } catch {
        return {
          ok: false,
          error: `Invalid JSON from content-types items (${res.status}): ${text.slice(0, 200)}`,
        };
      }
      if (!res.ok) {
        const err =
          typeof data.error === "string"
            ? data.error
            : `HTTP ${res.status} fetching items for ${contentType}`;
        return { ok: false, error: err };
      }
      const results = Array.isArray(data.results)
        ? (data.results as Record<string, unknown>[])
        : [];
      const total =
        typeof data.total === "number"
          ? data.total
          : typeof data.count === "number"
            ? data.count
            : results.length;
      return { ok: true, results: countOnly ? [] : results, total };
    } catch (e) {
      return {
        ok: false,
        error: `Could not load inventory for "${contentType}": ${(e as Error).message}. Is the main app running?`,
      };
    }
  };
}

export async function collectTypeStats(opts: {
  contentTypes: string[];
  domain: string | null;
  fetchItems: FetchItemsFn;
}): Promise<{ types: TypeStat[]; failed_types: FailedType[]; total_entries: number }> {
  const types: TypeStat[] = [];
  const failed_types: FailedType[] = [];
  for (const contentType of opts.contentTypes) {
    const got = await opts.fetchItems({
      contentType,
      domain: opts.domain,
      countOnly: true,
    });
    if (!got.ok) {
      failed_types.push({ contentType, error: got.error });
      continue;
    }
    types.push({ contentType, count: got.total });
  }
  types.sort((a, b) => a.contentType.localeCompare(b.contentType));
  const total_entries = types.reduce((sum, t) => sum + t.count, 0);
  return { types, failed_types, total_entries };
}

export async function resolveEntryList(opts: {
  contentType: string;
  domain: string | null;
  contentPath: string;
  contentFolder: string;
  locale?: string;
  slugs?: string[];
  search?: string;
  funnelFilters?: ListEntriesFunnelFilters;
  page?: number;
  limit?: number;
  detail?: boolean;
  fetchItems: FetchItemsFn;
}): Promise<
  | {
      ok: true;
      entries: ListEntryRow[];
      page: number;
      limit: number;
      total: number;
      count: number;
      has_more: boolean;
    }
  | { ok: false; error: string }
> {
  const got = await opts.fetchItems({
    contentType: opts.contentType,
    domain: opts.domain,
    // Fetch all locales then strict-filter after slug merge so one row per slug is correct.
  });
  if (!got.ok) return got;

  const defaultLocale = getDefaultLocale(opts.contentPath);
  let rows = normalizeToSlugRows(opts.contentType, got.results, {
    requestedLocale: opts.locale,
    defaultLocale,
  });
  rows = filterSlugRows(rows, {
    locale: opts.locale,
    slugs: opts.slugs,
    search: opts.search,
    funnelFilters: opts.funnelFilters,
    contentFolder: opts.contentFolder,
    enrichFunnel: !!(opts.funnelFilters && hasAnyFunnelFilter(opts.funnelFilters)),
  });
  const page = clampListPage(opts.page);
  const limit = clampListLimit(opts.limit);
  const paged = paginateRows(rows, page, limit);
  const entries = projectEntries(paged.pageItems, { detail: opts.detail });
  return {
    ok: true,
    entries,
    page: paged.page,
    limit: paged.limit,
    total: paged.total,
    count: paged.count,
    has_more: paged.has_more,
  };
}
