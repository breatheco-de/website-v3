/**
 * Entry field bag template vars: preferred `{{ entry.* }}`, legacy `{{ single.* }}`.
 * Shared shell files remain `single.{locale}.yml` — that filename is unrelated.
 */

/** Preferred namespace for the current entry's field_mapping bag. */
export const ENTRY_VAR_PREFIX = "entry.";
/** Legacy alias of {@link ENTRY_VAR_PREFIX} (still resolved on delivery). */
export const LEGACY_SINGLE_VAR_PREFIX = "single.";

/** Matches `{{ entry.x }}` or `{{ single.x }}` (with optional pipe fallback) anywhere in a string. */
export const ENTRY_OR_SINGLE_VAR_PATTERN =
  /\{\{\s*(?:entry|single)\.([a-zA-Z_][a-zA-Z0-9_.]*)\s*(?:\|\s*([\s\S]*?))?\s*\}\}/g;

/** Exact-string match for a sole `{{ entry|single.field }}` expression. */
export const EXACT_ENTRY_OR_SINGLE_VAR_PATTERN =
  /^\{\{\s*(?:entry|single)\.([a-zA-Z_][a-zA-Z0-9_.]*)\s*(?:\|\s*([\s\S]*?))?\s*\}\}$/;

/** Detect leftover legacy `{{ single.* }}` (for write blocks / migration). */
export const LEGACY_SINGLE_VAR_PATTERN =
  /\{\{\s*single\.([a-zA-Z_][a-zA-Z0-9_.]*)\s*(?:\|\s*([\s\S]*?))?\s*\}\}/g;

/** Capture field path from `{{ entry|single.…` for `_variableKeys`. */
export const ENTRY_OR_SINGLE_KEY_RE = /\{\{\s*(?:entry|single)\.([^|}\s]+)/;

export function isEntryOrSingleVarName(name: string): boolean {
  return (
    name.startsWith(ENTRY_VAR_PREFIX) || name.startsWith(LEGACY_SINGLE_VAR_PREFIX)
  );
}

/** Field path after `entry.` or `single.`, or null if not an entry-bag var name. */
export function entryBagFieldPathFromVarName(name: string): string | null {
  if (name.startsWith(ENTRY_VAR_PREFIX)) return name.slice(ENTRY_VAR_PREFIX.length);
  if (name.startsWith(LEGACY_SINGLE_VAR_PREFIX)) {
    return name.slice(LEGACY_SINGLE_VAR_PREFIX.length);
  }
  return null;
}

/** Canonical variable name for new writes / UI: `entry.<fieldPath>`. */
export function formatEntryVarName(fieldPath: string): string {
  return `${ENTRY_VAR_PREFIX}${fieldPath}`;
}

/** Build `{{ entry.<field> | <fallback> }}` (or without pipe when fallback empty/omitted). */
export function formatEntryTemplateExpr(
  fieldPath: string,
  inlineDefault?: string,
): string {
  const name = formatEntryVarName(fieldPath);
  if (inlineDefault === undefined || inlineDefault === "") {
    return `{{ ${name} }}`;
  }
  return `{{ ${name} | ${inlineDefault} }}`;
}

/** True if a string contains at least one legacy `{{ single.* }}` token. */
export function containsLegacySingleVar(value: string): boolean {
  LEGACY_SINGLE_VAR_PATTERN.lastIndex = 0;
  return LEGACY_SINGLE_VAR_PATTERN.test(value);
}

/**
 * Walk a JSON-like value tree and return paths where legacy `{{ single.* }}` appears.
 * Paths use dot notation; array indices are numeric segments.
 */
export function findLegacySingleVarPaths(
  data: unknown,
  prefix = "",
): string[] {
  const found: string[] = [];
  if (typeof data === "string") {
    if (containsLegacySingleVar(data)) {
      found.push(prefix || "(root)");
    }
    return found;
  }
  if (Array.isArray(data)) {
    data.forEach((item, i) => {
      found.push(...findLegacySingleVarPaths(item, prefix ? `${prefix}.${i}` : String(i)));
    });
    return found;
  }
  if (data !== null && typeof data === "object") {
    for (const [key, value] of Object.entries(data as Record<string, unknown>)) {
      const path = prefix ? `${prefix}.${key}` : key;
      found.push(...findLegacySingleVarPaths(value, path));
    }
  }
  return found;
}

/** Rewrite `{{ single.` → `{{ entry.` inside a string (preserves fallbacks / whitespace after prefix). */
export function rewriteSingleVarsToEntryInString(str: string): string {
  return str.replace(/\{\{(\s*)single\./g, "{{$1entry.");
}

/** Deep-rewrite legacy single.* tokens in strings (including `_variableFields` values). */
export function rewriteSingleVarsToEntryDeep(data: unknown): unknown {
  if (typeof data === "string") {
    return rewriteSingleVarsToEntryInString(data);
  }
  if (Array.isArray(data)) {
    return data.map((item) => rewriteSingleVarsToEntryDeep(item));
  }
  if (data !== null && typeof data === "object") {
    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(data as Record<string, unknown>)) {
      result[key] = rewriteSingleVarsToEntryDeep(value);
    }
    return result;
  }
  return data;
}

/** Error message when a write still contains legacy `{{ single.* }}` tokens. */
export function legacySingleVarWriteError(paths: string[]): string {
  const sample = paths.slice(0, 5).join(", ");
  const more = paths.length > 5 ? ` (+${paths.length - 5} more)` : "";
  return (
    `Legacy {{ single.* }} template variables are no longer accepted on save. ` +
    `Use {{ entry.* }} instead (same field_mapping bag). Found at: ${sample}${more}.`
  );
}

/** Returns an error string if `data` contains legacy `{{ single.* }}`, else null. */
export function getLegacySingleVarWriteError(data: unknown): string | null {
  const paths = findLegacySingleVarPaths(data);
  if (paths.length === 0) return null;
  return legacySingleVarWriteError(paths);
}
