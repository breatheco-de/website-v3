/** Query keys for content-type manage list view. Add a key here when adding a filter. */
export const MANAGE_LIST_SEARCH_KEYS = {
  perspective: "perspective",
  view: "view",
  q: "q",
  page: "page",
  updated: "updated",
  tag: "t",
  locale: "locale",
  market: "market",
  sort: "sort",
  dir: "dir",
} as const;

export type ManageListPerspective = "default" | "seo" | "funnel" | "organic";
export type ManageListViewMode = "static" | "db";
export type ManageListUpdatedSortDir = "asc" | "desc" | null;
export type ManageListOrganicSortField =
  | "clicks"
  | "impressions"
  | "ctr"
  | "position"
  | "title";

export interface ManageListViewState {
  perspective: ManageListPerspective;
  /** null = follow app default (db when linked, else static) */
  view: ManageListViewMode | null;
  q: string;
  page: number;
  updatedSortDir: ManageListUpdatedSortDir;
  tagFilters: Record<string, string[]>;
  organicLocale: string;
  organicMarket: string;
  organicSort: ManageListOrganicSortField;
  organicSortDir: "asc" | "desc";
}

export const MANAGE_LIST_VIEW_DEFAULTS: ManageListViewState = {
  perspective: "default",
  view: null,
  q: "",
  page: 1,
  updatedSortDir: null,
  tagFilters: {},
  organicLocale: "",
  organicMarket: "worldwide",
  organicSort: "clicks",
  organicSortDir: "desc",
};

const PERSPECTIVES = new Set<ManageListPerspective>([
  "default",
  "seo",
  "funnel",
  "organic",
]);

const ORGANIC_SORTS = new Set<ManageListOrganicSortField>([
  "clicks",
  "impressions",
  "ctr",
  "position",
  "title",
]);

function parsePerspective(raw: string | null): ManageListPerspective {
  if (raw && PERSPECTIVES.has(raw as ManageListPerspective)) {
    return raw as ManageListPerspective;
  }
  return MANAGE_LIST_VIEW_DEFAULTS.perspective;
}

function parseView(raw: string | null): ManageListViewMode | null {
  if (raw === "static" || raw === "db") return raw;
  return null;
}

function parsePage(raw: string | null): number {
  const n = parseInt(raw ?? "", 10);
  if (!Number.isFinite(n) || n < 1) return MANAGE_LIST_VIEW_DEFAULTS.page;
  return Math.floor(n);
}

function parseUpdatedSortDir(raw: string | null): ManageListUpdatedSortDir {
  if (raw === "asc" || raw === "desc") return raw;
  return null;
}

function parseOrganicSort(raw: string | null): ManageListOrganicSortField {
  if (raw && ORGANIC_SORTS.has(raw as ManageListOrganicSortField)) {
    return raw as ManageListOrganicSortField;
  }
  return MANAGE_LIST_VIEW_DEFAULTS.organicSort;
}

function parseOrganicSortDir(raw: string | null): "asc" | "desc" {
  return raw === "asc" || raw === "desc"
    ? raw
    : MANAGE_LIST_VIEW_DEFAULTS.organicSortDir;
}

function parseTagFilters(params: URLSearchParams): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const raw of params.getAll(MANAGE_LIST_SEARCH_KEYS.tag)) {
    const sep = raw.indexOf(":");
    if (sep <= 0) continue;
    const field = raw.slice(0, sep);
    const value = raw.slice(sep + 1);
    if (!field || !value) continue;
    (out[field] ??= []).push(value);
  }
  return out;
}

export function parseManageListSearch(search: string): ManageListViewState {
  const params = new URLSearchParams(search.startsWith("?") ? search.slice(1) : search);
  return {
    perspective: parsePerspective(params.get(MANAGE_LIST_SEARCH_KEYS.perspective)),
    view: parseView(params.get(MANAGE_LIST_SEARCH_KEYS.view)),
    q: params.get(MANAGE_LIST_SEARCH_KEYS.q) ?? "",
    page: parsePage(params.get(MANAGE_LIST_SEARCH_KEYS.page)),
    updatedSortDir: parseUpdatedSortDir(params.get(MANAGE_LIST_SEARCH_KEYS.updated)),
    tagFilters: parseTagFilters(params),
    organicLocale: params.get(MANAGE_LIST_SEARCH_KEYS.locale) ?? "",
    organicMarket:
      params.get(MANAGE_LIST_SEARCH_KEYS.market) ||
      MANAGE_LIST_VIEW_DEFAULTS.organicMarket,
    organicSort: parseOrganicSort(params.get(MANAGE_LIST_SEARCH_KEYS.sort)),
    organicSortDir: parseOrganicSortDir(params.get(MANAGE_LIST_SEARCH_KEYS.dir)),
  };
}

function setOmitDefault(
  params: URLSearchParams,
  key: string,
  value: string,
  defaultValue: string,
) {
  if (!value || value === defaultValue) params.delete(key);
  else params.set(key, value);
}

/** Writes known keys onto `existingSearch`, omitting defaults. Unknown params are kept. */
export function serializeManageListSearch(
  view: ManageListViewState,
  existingSearch = "",
  options?: { defaultViewMode?: ManageListViewMode },
): string {
  const params = new URLSearchParams(
    existingSearch.startsWith("?") ? existingSearch.slice(1) : existingSearch,
  );
  const d = MANAGE_LIST_VIEW_DEFAULTS;
  const defaultView = options?.defaultViewMode ?? "static";

  if (view.perspective === d.perspective) {
    params.delete(MANAGE_LIST_SEARCH_KEYS.perspective);
  } else {
    params.set(MANAGE_LIST_SEARCH_KEYS.perspective, view.perspective);
  }

  if (view.view != null && view.view !== defaultView) {
    params.set(MANAGE_LIST_SEARCH_KEYS.view, view.view);
  } else {
    params.delete(MANAGE_LIST_SEARCH_KEYS.view);
  }

  setOmitDefault(params, MANAGE_LIST_SEARCH_KEYS.q, view.q.trim(), d.q);

  if (view.page === d.page) params.delete(MANAGE_LIST_SEARCH_KEYS.page);
  else params.set(MANAGE_LIST_SEARCH_KEYS.page, String(view.page));

  if (view.updatedSortDir == null) params.delete(MANAGE_LIST_SEARCH_KEYS.updated);
  else params.set(MANAGE_LIST_SEARCH_KEYS.updated, view.updatedSortDir);

  params.delete(MANAGE_LIST_SEARCH_KEYS.tag);
  for (const [field, values] of Object.entries(view.tagFilters)) {
    for (const value of values) {
      if (field && value) params.append(MANAGE_LIST_SEARCH_KEYS.tag, `${field}:${value}`);
    }
  }

  setOmitDefault(params, MANAGE_LIST_SEARCH_KEYS.locale, view.organicLocale.trim(), d.organicLocale);
  setOmitDefault(
    params,
    MANAGE_LIST_SEARCH_KEYS.market,
    view.organicMarket,
    d.organicMarket,
  );
  setOmitDefault(params, MANAGE_LIST_SEARCH_KEYS.sort, view.organicSort, d.organicSort);
  setOmitDefault(params, MANAGE_LIST_SEARCH_KEYS.dir, view.organicSortDir, d.organicSortDir);

  return params.toString();
}
