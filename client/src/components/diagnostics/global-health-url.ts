/** Query keys for Global Health filter/view state. */
export const GLOBAL_HEALTH_SEARCH_KEYS = {
  kpi: "kpi",
  path: "path",
  scope: "scope",
  validators: "validators",
  tried: "tried",
} as const;

export const GLOBAL_HEALTH_SCOPE_KEYS = [
  "seo",
  "integrity",
  "content",
  "components",
  "forms",
  "bindings",
  "performance",
] as const;

export type GlobalHealthScopeKey = (typeof GLOBAL_HEALTH_SCOPE_KEYS)[number];
export type GlobalHealthKpi = "errors" | "warnings" | "coverage" | "unique" | "completed" | null;

export interface GlobalHealthViewState {
  kpi: GlobalHealthKpi;
  path: string;
  scope: GlobalHealthScopeKey[];
  validators: string[];
  /** Only open issues that have prior release/TTL attempts. */
  priorAttempts: boolean;
}

export const GLOBAL_HEALTH_VIEW_DEFAULTS: GlobalHealthViewState = {
  kpi: null,
  path: "",
  scope: [],
  validators: [],
  priorAttempts: false,
};

const SCOPE_SET = new Set<string>(GLOBAL_HEALTH_SCOPE_KEYS);
const KPI_SET = new Set<string>(["errors", "warnings", "coverage", "unique", "completed"]);

function parseKpi(raw: string | null): GlobalHealthKpi {
  if (!raw || !KPI_SET.has(raw)) return null;
  return raw as Exclude<GlobalHealthKpi, null>;
}

function parseCsvList(raw: string | null): string[] {
  if (!raw || !raw.trim()) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const part of raw.split(",")) {
    const v = part.trim();
    if (!v || seen.has(v)) continue;
    seen.add(v);
    out.push(v);
  }
  return out;
}

function parseScope(raw: string | null): GlobalHealthScopeKey[] {
  return parseCsvList(raw).filter((k): k is GlobalHealthScopeKey => SCOPE_SET.has(k));
}

function setCsvList(params: URLSearchParams, key: string, values: string[]) {
  if (values.length === 0) params.delete(key);
  else params.set(key, values.join(","));
}

export function parseGlobalHealthSearch(search: string): GlobalHealthViewState {
  const params = new URLSearchParams(search.startsWith("?") ? search.slice(1) : search);
  const tried = params.get(GLOBAL_HEALTH_SEARCH_KEYS.tried);
  return {
    kpi: parseKpi(params.get(GLOBAL_HEALTH_SEARCH_KEYS.kpi)),
    path: (params.get(GLOBAL_HEALTH_SEARCH_KEYS.path) ?? "").trim(),
    scope: parseScope(params.get(GLOBAL_HEALTH_SEARCH_KEYS.scope)),
    validators: parseCsvList(params.get(GLOBAL_HEALTH_SEARCH_KEYS.validators)),
    priorAttempts: tried === "1" || tried === "true",
  };
}

/** Writes known keys onto `existingSearch`, omitting defaults. Unknown params are kept. */
export function serializeGlobalHealthSearch(
  view: GlobalHealthViewState,
  existingSearch = "",
): string {
  const params = new URLSearchParams(
    existingSearch.startsWith("?") ? existingSearch.slice(1) : existingSearch,
  );

  if (!view.kpi) params.delete(GLOBAL_HEALTH_SEARCH_KEYS.kpi);
  else params.set(GLOBAL_HEALTH_SEARCH_KEYS.kpi, view.kpi);

  if (!view.path.trim()) params.delete(GLOBAL_HEALTH_SEARCH_KEYS.path);
  else params.set(GLOBAL_HEALTH_SEARCH_KEYS.path, view.path.trim());

  setCsvList(params, GLOBAL_HEALTH_SEARCH_KEYS.scope, view.scope);
  setCsvList(params, GLOBAL_HEALTH_SEARCH_KEYS.validators, view.validators);

  if (!view.priorAttempts) params.delete(GLOBAL_HEALTH_SEARCH_KEYS.tried);
  else params.set(GLOBAL_HEALTH_SEARCH_KEYS.tried, "1");

  return params.toString();
}

/** Build GET /api/validation/cache-issues query params for Global Health. */
export function buildCacheIssuesQuery(
  view: GlobalHealthViewState,
  search = "",
): URLSearchParams {
  const params = new URLSearchParams();
  if (view.kpi === "errors") params.set("severity", "error");
  else if (view.kpi === "warnings") params.set("severity", "warning");
  if (view.path.trim()) params.set("urlPath", view.path.trim());
  if (view.scope.length > 0) params.set("categories", view.scope.join(","));
  if (view.validators.length > 0) params.set("validators", view.validators.join(","));
  if (view.priorAttempts) params.set("priorAttempts", "1");
  if (search.trim()) params.set("search", search.trim());
  return params;
}
