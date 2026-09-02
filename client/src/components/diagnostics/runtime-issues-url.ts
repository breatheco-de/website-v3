import {
  FILTER_ALL,
  defaultRuntimeTz,
  type RuntimeIssueFilters,
  type RuntimeIssueSortDir,
  type RuntimeIssueSortKey,
} from "./runtime-issues-filters";

/** Query keys for runtime-issue view state. Add a key here when adding a filter. */
export const RUNTIME_ISSUE_SEARCH_KEYS = {
  pagesOnly: "pagesOnly",
  queryParams: "queryParams",
  path: "path",
  referrer: "referrer",
  locale: "locale",
  device: "device",
  window: "window",
  tz: "tz",
  source: "source",
  sort: "sort",
  dir: "dir",
  page: "page",
} as const;

export interface RuntimeIssueViewState {
  filters: RuntimeIssueFilters;
  sortKey: RuntimeIssueSortKey;
  sortDir: RuntimeIssueSortDir;
  page: number;
}

export const RUNTIME_ISSUE_VIEW_DEFAULTS: RuntimeIssueViewState = {
  filters: {
    pathQuery: "",
    referrerQuery: "",
    locale: FILTER_ALL,
    device: FILTER_ALL,
    pagesOnly: true,
    queryParamsOnly: false,
    windowDays: 30,
    tz: defaultRuntimeTz(),
    source: FILTER_ALL,
  },
  sortKey: "count",
  sortDir: "desc",
  page: 1,
};

function parseBool(raw: string | null, fallback: boolean): boolean {
  if (raw == null || raw === "") return fallback;
  if (raw === "0" || raw.toLowerCase() === "false") return false;
  if (raw === "1" || raw.toLowerCase() === "true") return true;
  return fallback;
}

function parseSortKey(raw: string | null): RuntimeIssueSortKey {
  return raw === "lastSeen" || raw === "count" ? raw : RUNTIME_ISSUE_VIEW_DEFAULTS.sortKey;
}

function parseSortDir(raw: string | null): RuntimeIssueSortDir {
  return raw === "asc" || raw === "desc" ? raw : RUNTIME_ISSUE_VIEW_DEFAULTS.sortDir;
}

function parseWindowDays(raw: string | null): 7 | 30 {
  return raw === "7" ? 7 : 30;
}

function parsePage(raw: string | null): number {
  const n = parseInt(raw ?? "", 10);
  if (!Number.isFinite(n) || n < 1) return RUNTIME_ISSUE_VIEW_DEFAULTS.page;
  return Math.floor(n);
}

function parseTz(raw: string | null): string {
  if (!raw || !raw.trim()) return RUNTIME_ISSUE_VIEW_DEFAULTS.filters.tz;
  try {
    Intl.DateTimeFormat("en-US", { timeZone: raw.trim() }).format(new Date());
    return raw.trim();
  } catch {
    return RUNTIME_ISSUE_VIEW_DEFAULTS.filters.tz;
  }
}

export function parseRuntimeIssueSearch(search: string): RuntimeIssueViewState {
  const params = new URLSearchParams(search.startsWith("?") ? search.slice(1) : search);
  const locale = params.get(RUNTIME_ISSUE_SEARCH_KEYS.locale);
  const device = params.get(RUNTIME_ISSUE_SEARCH_KEYS.device);
  const source = params.get(RUNTIME_ISSUE_SEARCH_KEYS.source);
  return {
    filters: {
      pathQuery: params.get(RUNTIME_ISSUE_SEARCH_KEYS.path) ?? "",
      referrerQuery: params.get(RUNTIME_ISSUE_SEARCH_KEYS.referrer) ?? "",
      locale: locale && locale !== FILTER_ALL ? locale : FILTER_ALL,
      device: device && device !== FILTER_ALL ? device : FILTER_ALL,
      pagesOnly: parseBool(
        params.get(RUNTIME_ISSUE_SEARCH_KEYS.pagesOnly),
        RUNTIME_ISSUE_VIEW_DEFAULTS.filters.pagesOnly,
      ),
      queryParamsOnly: parseBool(
        params.get(RUNTIME_ISSUE_SEARCH_KEYS.queryParams),
        RUNTIME_ISSUE_VIEW_DEFAULTS.filters.queryParamsOnly,
      ),
      windowDays: parseWindowDays(params.get(RUNTIME_ISSUE_SEARCH_KEYS.window)),
      tz: parseTz(params.get(RUNTIME_ISSUE_SEARCH_KEYS.tz)),
      source: source && source !== FILTER_ALL ? source : FILTER_ALL,
    },
    sortKey: parseSortKey(params.get(RUNTIME_ISSUE_SEARCH_KEYS.sort)),
    sortDir: parseSortDir(params.get(RUNTIME_ISSUE_SEARCH_KEYS.dir)),
    page: parsePage(params.get(RUNTIME_ISSUE_SEARCH_KEYS.page)),
  };
}

function setBool(params: URLSearchParams, key: string, value: boolean, defaultValue: boolean) {
  if (value === defaultValue) params.delete(key);
  else params.set(key, value ? "1" : "0");
}

function setOmitEmpty(params: URLSearchParams, key: string, value: string, empty = "") {
  if (!value || value === empty) params.delete(key);
  else params.set(key, value);
}

/** Writes known keys onto `existingSearch`, omitting defaults. Unknown params are kept. */
export function serializeRuntimeIssueSearch(
  view: RuntimeIssueViewState,
  existingSearch = "",
): string {
  const params = new URLSearchParams(existingSearch.startsWith("?") ? existingSearch.slice(1) : existingSearch);
  params.delete("hideBots");
  const d = RUNTIME_ISSUE_VIEW_DEFAULTS;

  setBool(params, RUNTIME_ISSUE_SEARCH_KEYS.pagesOnly, view.filters.pagesOnly, d.filters.pagesOnly);
  setBool(
    params,
    RUNTIME_ISSUE_SEARCH_KEYS.queryParams,
    view.filters.queryParamsOnly,
    d.filters.queryParamsOnly,
  );
  setOmitEmpty(params, RUNTIME_ISSUE_SEARCH_KEYS.path, view.filters.pathQuery.trim());
  setOmitEmpty(params, RUNTIME_ISSUE_SEARCH_KEYS.referrer, view.filters.referrerQuery.trim());
  setOmitEmpty(params, RUNTIME_ISSUE_SEARCH_KEYS.locale, view.filters.locale, FILTER_ALL);
  setOmitEmpty(params, RUNTIME_ISSUE_SEARCH_KEYS.device, view.filters.device, FILTER_ALL);
  setOmitEmpty(params, RUNTIME_ISSUE_SEARCH_KEYS.source, view.filters.source, FILTER_ALL);
  if (view.filters.windowDays === d.filters.windowDays) params.delete(RUNTIME_ISSUE_SEARCH_KEYS.window);
  else params.set(RUNTIME_ISSUE_SEARCH_KEYS.window, String(view.filters.windowDays));
  if (view.filters.tz === d.filters.tz) params.delete(RUNTIME_ISSUE_SEARCH_KEYS.tz);
  else params.set(RUNTIME_ISSUE_SEARCH_KEYS.tz, view.filters.tz);
  setOmitEmpty(params, RUNTIME_ISSUE_SEARCH_KEYS.sort, view.sortKey, d.sortKey);
  setOmitEmpty(params, RUNTIME_ISSUE_SEARCH_KEYS.dir, view.sortDir, d.sortDir);
  if (view.page === d.page) params.delete(RUNTIME_ISSUE_SEARCH_KEYS.page);
  else params.set(RUNTIME_ISSUE_SEARCH_KEYS.page, String(view.page));

  return params.toString();
}
