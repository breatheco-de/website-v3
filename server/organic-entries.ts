/**
 * Pure helpers for content-type organic-entries list (CTR + sort with nulls last).
 */

export type OrganicTrafficMetrics = {
  clicks: number;
  impressions: number;
  position: number;
  ctr: number;
};

export type OrganicEntrySortField =
  | "clicks"
  | "impressions"
  | "ctr"
  | "position"
  | "title";

export type OrganicEntrySortable = {
  title?: string | null;
  pageTitle?: string | null;
  slug?: string | null;
  traffic: OrganicTrafficMetrics | null;
};

export type OrganicCacheStatus = "empty" | "incomplete" | "ok";

export function trafficCtr(clicks: number, impressions: number): number {
  if (impressions <= 0) return 0;
  return clicks / impressions;
}

export function withTrafficCtr(stats: {
  clicks: number;
  impressions: number;
  position: number;
}): OrganicTrafficMetrics {
  return {
    clicks: stats.clicks,
    impressions: stats.impressions,
    position: stats.position,
    ctr: trafficCtr(stats.clicks, stats.impressions),
  };
}

export function deriveOrganicCacheStatus(meta: {
  window: { start: string; end: string } | null;
  days_in_window: number;
  incomplete: boolean;
}): OrganicCacheStatus {
  if (!meta.window || meta.days_in_window <= 0) return "empty";
  if (meta.incomplete) return "incomplete";
  return "ok";
}

function metricValue(
  entry: OrganicEntrySortable,
  field: Exclude<OrganicEntrySortField, "title">,
): number {
  const t = entry.traffic;
  if (!t) return 0;
  return t[field];
}

function titleKey(entry: OrganicEntrySortable): string {
  const page =
    typeof entry.pageTitle === "string" && entry.pageTitle.trim()
      ? entry.pageTitle.trim()
      : "";
  const title =
    typeof entry.title === "string" && entry.title.trim() ? entry.title.trim() : "";
  const slug = typeof entry.slug === "string" ? entry.slug : "";
  return (page || title || slug).toLowerCase();
}

/**
 * Compare two organic entries for list sorting.
 * Metric sorts: traffic === null always sorts last (asc or desc).
 * Title sort: plain alphabetical; null traffic has no special treatment.
 */
export function compareOrganicEntries(
  a: OrganicEntrySortable,
  b: OrganicEntrySortable,
  sort: OrganicEntrySortField,
  sortDir: "asc" | "desc",
): number {
  const dir = sortDir === "asc" ? 1 : -1;

  if (sort === "title") {
    const cmp = titleKey(a).localeCompare(titleKey(b));
    return cmp * dir;
  }

  const aNull = a.traffic == null;
  const bNull = b.traffic == null;
  if (aNull !== bNull) return aNull ? 1 : -1;

  const av = metricValue(a, sort);
  const bv = metricValue(b, sort);
  if (av === bv) {
    return titleKey(a).localeCompare(titleKey(b));
  }
  return av < bv ? -1 * dir : 1 * dir;
}

export function sortOrganicEntries<T extends OrganicEntrySortable>(
  entries: T[],
  sort: OrganicEntrySortField,
  sortDir: "asc" | "desc",
): T[] {
  const copy = [...entries];
  copy.sort((a, b) => compareOrganicEntries(a, b, sort, sortDir));
  return copy;
}

export function parseOrganicSortField(raw: unknown): OrganicEntrySortField {
  const s = typeof raw === "string" ? raw.trim() : "";
  if (
    s === "clicks" ||
    s === "impressions" ||
    s === "ctr" ||
    s === "position" ||
    s === "title"
  ) {
    return s;
  }
  return "clicks";
}

export function defaultOrganicSortDir(
  sort: OrganicEntrySortField,
  rawDir: "asc" | "desc" | null,
): "asc" | "desc" {
  if (rawDir === "asc" || rawDir === "desc") return rawDir;
  return sort === "title" ? "asc" : "desc";
}
