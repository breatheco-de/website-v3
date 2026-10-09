/**
 * What changed between two copies of a database. A refresh emits one event
 * for this list, not one event per row.
 */

export type RefreshedDatabaseRow = {
  slug: string;
  locale?: string;
  params: Record<string, string>;
};

function stableValue(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableValue).join(",")}]`;
  if (value && typeof value === "object") {
    const obj = value as Record<string, unknown>;
    return `{${Object.keys(obj)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableValue(obj[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

function text(value: unknown): string {
  if (value == null || value === "") return "";
  if (typeof value === "string" || typeof value === "number") return String(value);
  return "";
}

function slugOf(item: Record<string, unknown>, lookupKey: string): string {
  return text(item[lookupKey] ?? item.slug);
}

function localeOf(item: Record<string, unknown>): string {
  return text(item.locale ?? item.lang ?? item._locale);
}

function paramsOf(item: Record<string, unknown>, paramNames: string[]): Record<string, string> {
  const params: Record<string, string> = {};
  for (const name of paramNames) {
    if (name === "slug") continue;
    const value = text(item[name]);
    if (value) params[name] = value;
  }
  return params;
}

function indexRows(
  items: Record<string, unknown>[],
  lookupKey: string,
): Map<string, Record<string, unknown>> {
  const map = new Map<string, Record<string, unknown>>();
  for (const item of items) {
    const slug = slugOf(item, lookupKey);
    if (!slug) continue;
    map.set(`${localeOf(item)}\0${slug}`, item);
  }
  return map;
}

/**
 * Null when the two copies are the same. An empty list means something changed
 * that has no public slug (the pages that read the database still rebuild).
 */
export function diffRefreshedDatabaseRows(opts: {
  lookupKey: string;
  paramNames: string[];
  previous: Record<string, unknown>[];
  next: Record<string, unknown>[];
}): RefreshedDatabaseRow[] | null {
  if (stableValue(opts.previous) === stableValue(opts.next)) return null;
  const before = indexRows(opts.previous, opts.lookupKey);
  const after = indexRows(opts.next, opts.lookupKey);
  const rows: RefreshedDatabaseRow[] = [];
  for (const key of new Set([...before.keys(), ...after.keys()])) {
    const prev = before.get(key);
    const next = after.get(key);
    if (prev && next && stableValue(prev) === stableValue(next)) continue;
    const item = next ?? prev;
    if (!item) continue;
    const slug = slugOf(item, opts.lookupKey);
    if (!slug) continue;
    const locale = localeOf(item);
    rows.push({
      slug,
      ...(locale ? { locale } : {}),
      params: paramsOf(item, opts.paramNames),
    });
  }
  return rows;
}
