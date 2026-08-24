export interface AvailablePropertyPaths {
  common: string[];
  partial: { key: string; count: number; total: number }[];
}

/** One selectable row in the single-variable picker. */
export interface PickerField {
  /** Path inserted as `single.${key}` (e.g. `category` or nested `author.name`). */
  key: string;
  /** YAML source path used for coverage validation. */
  source: string;
  /** True when this mapped field resolves to an object with known child keys. */
  isObject?: boolean;
  /** True when this row is a dotted child of a mapped field (not the parent object). */
  isNested?: boolean;
  /** True when this is a system special aliased for templates (`_slug` → `slug`). */
  isSystemAlias?: boolean;
}

/** Reserved field_mapping keys that expose friendly `single.*` aliases at runtime. */
export const SYSTEM_ALIAS_FIELDS = [
  { reserved: "_slug", alias: "slug" },
  { reserved: "_image", alias: "image" },
  { reserved: "_locale", alias: "locale" },
  { reserved: "_updated_at", alias: "updated_at" },
] as const;

type FieldMappingValue = string | { source: string; default?: string | null };

function mappingSourceString(value: FieldMappingValue | undefined): string {
  if (value == null) return "";
  if (typeof value === "string") return value;
  if (typeof value === "object" && typeof value.source === "string") return value.source;
  return "";
}

/**
 * Build the base picker list from field_mapping: system aliases (`slug`, `image`, …)
 * first, then regular (non-`_`) mapped fields.
 */
export function buildPickerMappedFields(
  fieldMapping: Record<string, FieldMappingValue>,
): { key: string; source: string; isSystemAlias?: boolean }[] {
  const result: { key: string; source: string; isSystemAlias?: boolean }[] = [];

  for (const { reserved, alias } of SYSTEM_ALIAS_FIELDS) {
    if (!(reserved in fieldMapping)) continue;
    const source = mappingSourceString(fieldMapping[reserved]);
    if (!source) continue;
    result.push({ key: alias, source, isSystemAlias: true });
  }

  for (const [key, value] of Object.entries(fieldMapping)) {
    if (key.startsWith("_")) continue;
    result.push({ key, source: mappingSourceString(value) });
  }

  return result;
}

function getNestedValue(obj: Record<string, unknown>, dotPath: string): unknown {
  const parts = dotPath.split(".");
  let current: unknown = obj;
  for (const part of parts) {
    if (current === null || current === undefined) return undefined;
    if (typeof current !== "object") return undefined;
    current = (current as Record<string, unknown>)[part];
  }
  return current;
}

/** Collect dotted child paths under a plain object value (for expansion from the current single). */
function collectChildPathsFromValue(
  value: unknown,
  prefix: string,
  maxDepth: number,
  depth = 0,
): string[] {
  if (depth >= maxDepth || value == null || typeof value !== "object" || Array.isArray(value)) {
    return [];
  }
  const paths: string[] = [];
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    const dotPath = `${prefix}.${key}`;
    paths.push(dotPath);
    paths.push(...collectChildPathsFromValue(child, dotPath, maxDepth, depth + 1));
  }
  return paths;
}

/** Compact display string for a sample value in the picker list. */
export function formatPickerSampleValue(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (Array.isArray(value)) {
    if (value.length === 0) return "[]";
    if (value.every((v) => typeof v === "string" || typeof v === "number" || typeof v === "boolean")) {
      return value.join(", ");
    }
    return JSON.stringify(value);
  }
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

/** Resolve a dotted picker key against the current single entry for preview text. */
export function getPickerSample(
  singleEntry: Record<string, unknown> | undefined,
  key: string,
): string {
  if (!singleEntry) return "";
  return formatPickerSampleValue(getNestedValue(singleEntry, key));
}

/**
 * Expand field_mapping keys with object-shaped values into parent + nested paths
 * (e.g. `authors` and nested children) using discovered entry property paths
 * and/or the shape of the current page's singleEntry.
 */
export function expandMappedFields(
  mapped: { key: string; source: string; isSystemAlias?: boolean }[],
  available: AvailablePropertyPaths | undefined,
  singleEntry?: Record<string, unknown>,
): PickerField[] {
  const allPaths = new Set([
    ...(available?.common ?? []),
    ...(available?.partial.map((p) => p.key) ?? []),
  ]);

  // Prefer live shape from the page being edited when available.
  if (singleEntry) {
    for (const field of mapped) {
      if (!field.source || field.source.startsWith("function:")) continue;
      const value = getNestedValue(singleEntry, field.key);
      for (const childPath of collectChildPathsFromValue(value, field.source, 2)) {
        allPaths.add(childPath);
      }
    }
  }

  const pathList = [...allPaths];
  const result: PickerField[] = [];

  for (const field of mapped) {
    const source = field.source;
    if (!source || source.startsWith("function:")) {
      result.push({
        key: field.key,
        source: field.source,
        isSystemAlias: field.isSystemAlias,
      });
      continue;
    }

    const childPaths = pathList
      .filter((p) => p.startsWith(`${source}.`))
      .sort((a, b) => a.localeCompare(b));
    const isObject = childPaths.length > 0;

    result.push({
      key: field.key,
      source: field.source,
      isObject,
      isSystemAlias: field.isSystemAlias,
    });

    for (const childPath of childPaths) {
      const relative = childPath.slice(source.length + 1);
      if (!relative) continue;
      result.push({
        key: `${field.key}.${relative}`,
        source: childPath,
        isNested: true,
      });
    }
  }

  return result;
}
