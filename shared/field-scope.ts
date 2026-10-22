/**
 * System-wide field scope: which fields belong to the whole page (`_common.yml`,
 * every locale) and which belong to one locale file. Same for every content type
 * and site — not configurable in content-types.yml or by staff.
 *
 * To make a new field page-level, add it here as "common".
 */

export type FieldScope = "common" | "locale";

export const FIELD_SCOPE: Record<string, FieldScope> = {
  funnel: "common",
  "meta.robots": "locale",
  "meta.priority": "locale",
  "meta.change_frequency": "locale",
  published_at: "common",
  detached: "common",
  authors: "common",
  image: "locale",
  title: "locale",
  description: "locale",
  content: "locale",
  seo: "locale",
  tags: "locale",
  status: "locale",
  section_defaults: "locale",
  updated_at: "locale",
  downloadable: "locale",
  lang: "locale",
};

export const DEFAULT_FIELD_SCOPE: FieldScope = "locale";

export type FieldScopeOptions = {
  /** Extra URL pattern params of the content type (e.g. `category`) — always locale. */
  urlParams?: readonly string[];
};

function normalizeFieldPath(fieldPath: string): string {
  return fieldPath
    .trim()
    .replace(/\[(\d+)\]/g, ".$1")
    .split(".")
    .filter(Boolean)
    .join(".");
}

/** Exact path, then the longest listed prefix (down to the top-level key), then the default. */
export function fieldScope(fieldPath: string, opts?: FieldScopeOptions): FieldScope {
  const normalized = normalizeFieldPath(fieldPath);
  if (!normalized) return DEFAULT_FIELD_SCOPE;
  const parts = normalized.split(".");
  if (opts?.urlParams?.includes(parts[0]!)) return "locale";
  for (let i = parts.length; i > 0; i--) {
    const scope = FIELD_SCOPE[parts.slice(0, i).join(".")];
    if (scope) return scope;
  }
  return DEFAULT_FIELD_SCOPE;
}

export function isCommonField(fieldPath: string, opts?: FieldScopeOptions): boolean {
  return fieldScope(fieldPath, opts) === "common";
}

/** `meta.*` keys that are page-level (e.g. `robots`). */
export const COMMON_META_KEYS: ReadonlySet<string> = new Set(
  Object.entries(FIELD_SCOPE)
    .filter(([p, s]) => s === "common" && p.startsWith("meta."))
    .map(([p]) => p.slice("meta.".length)),
);

/** `meta.*` keys explicitly listed as locale-scoped (e.g. `robots`). */
export const LOCALE_META_KEYS: ReadonlySet<string> = new Set(
  Object.entries(FIELD_SCOPE)
    .filter(([p, s]) => s === "locale" && p.startsWith("meta."))
    .map(([p]) => p.slice("meta.".length)),
);

/** Top-level keys whose whole value is page-level (e.g. `funnel`, `authors`). */
export const COMMON_TOP_LEVEL_KEYS: ReadonlySet<string> = new Set(
  Object.entries(FIELD_SCOPE)
    .filter(([p, s]) => s === "common" && !p.includes("."))
    .map(([p]) => p),
);

/** Top-level keys explicitly listed as locale-scoped. */
export const LOCALE_TOP_LEVEL_KEYS: ReadonlySet<string> = new Set(
  Object.entries(FIELD_SCOPE)
    .filter(([p, s]) => s === "locale" && !p.includes("."))
    .map(([p]) => p),
);

/**
 * Split a flat object of top-level keys (and `meta`) into common vs locale parts.
 * `meta` is split key-by-key; everything else follows {@link fieldScope}.
 */
export function splitByFieldScope(
  data: Record<string, unknown>,
  opts?: FieldScopeOptions,
): { common: Record<string, unknown>; locale: Record<string, unknown> } {
  const common: Record<string, unknown> = {};
  const locale: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(data)) {
    if (key === "meta" && value && typeof value === "object" && !Array.isArray(value)) {
      const commonMeta: Record<string, unknown> = {};
      const localeMeta: Record<string, unknown> = {};
      for (const [mk, mv] of Object.entries(value as Record<string, unknown>)) {
        if (fieldScope(`meta.${mk}`, opts) === "common") commonMeta[mk] = mv;
        else localeMeta[mk] = mv;
      }
      if (Object.keys(commonMeta).length) common.meta = commonMeta;
      if (Object.keys(localeMeta).length) locale.meta = localeMeta;
      continue;
    }
    if (fieldScope(key, opts) === "common") common[key] = value;
    else locale[key] = value;
  }
  return { common, locale };
}
