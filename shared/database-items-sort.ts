export type DatabaseItemsSortDir = "asc" | "desc";

/** `null` key = stored order. */
export interface DatabaseItemsSort {
  key: string | null;
  dir: DatabaseItemsSortDir;
}

/** Same names on the page URL and on `/api/databases/:name/items` + `/raw-items`. */
export const DATABASE_ITEMS_SORT_PARAMS = {
  sort: "sort",
  dir: "dir",
} as const;

export const DATABASE_ITEMS_SORT_DEFAULT: DatabaseItemsSort = { key: null, dir: "asc" };

export function parseDatabaseItemsSort(rawKey: unknown, rawDir: unknown): DatabaseItemsSort {
  const key = typeof rawKey === "string" ? rawKey.trim() : "";
  if (!key) return DATABASE_ITEMS_SORT_DEFAULT;
  return { key, dir: rawDir === "desc" ? "desc" : "asc" };
}

export function parseDatabaseItemsSortSearch(search: string): DatabaseItemsSort {
  const params = new URLSearchParams(search.startsWith("?") ? search.slice(1) : search);
  return parseDatabaseItemsSort(
    params.get(DATABASE_ITEMS_SORT_PARAMS.sort),
    params.get(DATABASE_ITEMS_SORT_PARAMS.dir),
  );
}

/** Writes sort onto `existingSearch`; stored order and the default `asc` are omitted. Unknown params are kept. */
export function serializeDatabaseItemsSort(sort: DatabaseItemsSort, existingSearch = ""): string {
  const params = new URLSearchParams(
    existingSearch.startsWith("?") ? existingSearch.slice(1) : existingSearch,
  );
  if (!sort.key) {
    params.delete(DATABASE_ITEMS_SORT_PARAMS.sort);
    params.delete(DATABASE_ITEMS_SORT_PARAMS.dir);
  } else {
    params.set(DATABASE_ITEMS_SORT_PARAMS.sort, sort.key);
    if (sort.dir === "asc") params.delete(DATABASE_ITEMS_SORT_PARAMS.dir);
    else params.set(DATABASE_ITEMS_SORT_PARAMS.dir, sort.dir);
  }
  return params.toString();
}

/** Header click: a new column starts ascending; the same column flips direction. */
export function nextDatabaseItemsSort(current: DatabaseItemsSort, col: string): DatabaseItemsSort {
  if (current.key !== col) return { key: col, dir: "asc" };
  return { key: col, dir: current.dir === "asc" ? "desc" : "asc" };
}

const collator = new Intl.Collator(undefined, { numeric: true });

function sortValue(v: unknown): string | number | null {
  if (v == null || v === "") return null;
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v === "object") return JSON.stringify(v);
  return String(v);
}

function compareValues(a: string | number, b: string | number): number {
  if (typeof a === "number" && typeof b === "number") return a - b;
  return collator.compare(String(a), String(b));
}

/**
 * Sorts `{ item, index }` entries by `item[sort.key]`. Empty values (missing, null, "")
 * stay last in both directions; ties keep stored order.
 */
export function sortDatabaseItemEntries<T extends { item: Record<string, unknown>; index: number }>(
  entries: T[],
  sort: DatabaseItemsSort,
): T[] {
  const key = sort.key;
  if (!key) return entries;
  const sign = sort.dir === "desc" ? -1 : 1;
  const keyed = entries.map((entry) => ({ entry, value: sortValue(entry.item[key]) }));
  keyed.sort((a, b) => {
    if (a.value === null || b.value === null) {
      if (a.value === b.value) return a.entry.index - b.entry.index;
      return a.value === null ? 1 : -1;
    }
    return sign * compareValues(a.value, b.value) || a.entry.index - b.entry.index;
  });
  return keyed.map((k) => k.entry);
}
