/** Shared page/slice helpers for Content Type manage list endpoints. */

export const MANAGE_LIST_DEFAULT_PAGE_SIZE = 50;
export const MANAGE_LIST_MAX_PAGE_SIZE = 100;

const RESERVED_LIST_QUERY_KEYS = new Set([
  "locale",
  "sort",
  "limit",
  "include_content",
  "page",
  "pageSize",
  "q",
  "sortDir",
  "errorsOnly",
]);

export type ListPagination =
  | { paginate: false }
  | { paginate: true; page: number; pageSize: number };

export function parseListPagination(
  query: Record<string, unknown>,
): ListPagination {
  if (query.page === undefined || query.page === "") {
    return { paginate: false };
  }
  const page = Math.max(1, parseInt(String(query.page), 10) || 1);
  const rawSize =
    query.pageSize !== undefined && query.pageSize !== ""
      ? parseInt(String(query.pageSize), 10)
      : MANAGE_LIST_DEFAULT_PAGE_SIZE;
  const pageSize = Math.min(
    MANAGE_LIST_MAX_PAGE_SIZE,
    Math.max(
      1,
      Number.isNaN(rawSize) ? MANAGE_LIST_DEFAULT_PAGE_SIZE : rawSize,
    ),
  );
  return { paginate: true, page, pageSize };
}

export function parseSortDir(
  raw: unknown,
): "asc" | "desc" | null {
  if (raw === "asc" || raw === "desc") return raw;
  return null;
}

export function paginateList<T>(
  items: T[],
  page: number,
  pageSize: number,
): {
  pageItems: T[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
} {
  const total = items.length;
  const totalPages = Math.max(1, Math.ceil(total / pageSize) || 1);
  const safePage = Math.min(Math.max(1, page), totalPages);
  const offset = (safePage - 1) * pageSize;
  return {
    pageItems: items.slice(offset, offset + pageSize),
    page: safePage,
    pageSize,
    total,
    totalPages,
  };
}

function updatedAtSortMs(value: unknown): number {
  if (value == null || value === "") return Number.NaN;
  const ms = Date.parse(String(value));
  return Number.isNaN(ms) ? Number.NaN : ms;
}

export function sortByUpdatedAtField<T>(
  list: T[],
  sortDir: "asc" | "desc" | null,
  getValue: (item: T) => unknown,
): T[] {
  if (!sortDir) return list;
  const factor = sortDir === "asc" ? 1 : -1;
  return [...list].sort((a, b) => {
    const am = updatedAtSortMs(getValue(a));
    const bm = updatedAtSortMs(getValue(b));
    const aMissing = Number.isNaN(am);
    const bMissing = Number.isNaN(bm);
    if (aMissing && bMissing) return 0;
    if (aMissing) return 1;
    if (bMissing) return -1;
    return (am - bm) * factor;
  });
}

/** Collect AND filters from non-reserved query keys (string or repeated). */
export function collectQueryFieldFilters(
  query: Record<string, unknown>,
): Array<{ field: string; value: string }> {
  const out: Array<{ field: string; value: string }> = [];
  for (const [key, val] of Object.entries(query)) {
    if (RESERVED_LIST_QUERY_KEYS.has(key)) continue;
    const values = Array.isArray(val) ? val : [val];
    for (const v of values) {
      if (v === undefined || v === null || v === "") continue;
      out.push({ field: key, value: String(v) });
    }
  }
  return out;
}

export function matchesManageItemsSearch(
  item: Record<string, unknown>,
  q: string,
): boolean {
  const needle = q.toLowerCase();
  const author = item.author_name
    ? `${item.author_name} ${item.author_last_name || ""}`
    : "";
  return (
    String(item.title ?? "")
      .toLowerCase()
      .includes(needle) ||
    String(item.slug ?? "")
      .toLowerCase()
      .includes(needle) ||
    String(item.description ?? "")
      .toLowerCase()
      .includes(needle) ||
    author.toLowerCase().includes(needle)
  );
}

export function fieldValueTokens(value: unknown): string[] {
  if (value == null || value === "") return [];
  if (Array.isArray(value)) {
    return value.flatMap((v) => fieldValueTokens(v));
  }
  if (typeof value === "object" && value !== null && "slug" in value) {
    const slug = (value as { slug?: unknown }).slug;
    return slug != null && slug !== "" ? [String(slug)] : [];
  }
  return [String(value)];
}

export function matchesManageTagFilter(
  item: Record<string, unknown>,
  field: string,
  value: string,
): boolean {
  const needle = value.toLowerCase();
  const tokens = fieldValueTokens(item[field]).map((t) => t.toLowerCase());
  if (tokens.length > 1 || Array.isArray(item[field])) {
    return tokens.includes(needle);
  }
  return (tokens[0] || "") === needle;
}
