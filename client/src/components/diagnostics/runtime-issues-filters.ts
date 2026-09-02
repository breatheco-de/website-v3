import {
  isAssetPath,
  SOURCE_LABELS,
  windowHitCount,
  hasQueryAttribution,
  type ByHour,
  type RuntimeQueryAttribution,
  type RuntimeSourceTag,
} from "@shared/runtime-issues";

export { isAssetPath, SOURCE_LABELS, hasQueryAttribution };

export const FILTER_ALL = "__all__";

export const DEVICE_ORDER = ["desktop", "mobile", "unknown"] as const;

const DEVICE_LABELS: Record<string, string> = {
  desktop: "Desktop",
  mobile: "Mobile",
  unknown: "Unknown",
  likely_bot: "Likely bot",
  scraper: "Scraper",
  search_crawler: "Search crawler",
  llm_crawler: "LLM crawler",
  social_preview: "Social preview",
  bot: "Bot",
};

export const SOURCE_FILTER_TAGS: RuntimeSourceTag[] = [
  "search_crawler",
  "llm_crawler",
  "social_preview",
  "search_referrer",
  "llm_referrer",
  "internal",
  "human",
];

const BADGE_TAGS: RuntimeSourceTag[] = [
  "search_crawler",
  "llm_crawler",
  "social_preview",
  "search_referrer",
  "llm_referrer",
  "internal",
];

export interface RuntimeIssueFilterRow {
  path: string;
  locale: string;
  sampleReferrer?: string;
  uaBucket?: string;
  sources?: string[];
  byHour?: ByHour;
  count: number;
  lastSeen: number;
  count30?: number;
  queryAttribution?: RuntimeQueryAttribution;
}

export interface RuntimeIssueFilters {
  pathQuery: string;
  referrerQuery: string;
  locale: string;
  device: string;
  pagesOnly: boolean;
  queryParamsOnly: boolean;
  windowDays: 7 | 30;
  tz: string;
  source: string;
  now?: number;
}

export type RuntimeIssueSortKey = "count" | "lastSeen";
export type RuntimeIssueSortDir = "asc" | "desc";

export function defaultRuntimeTz(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    return "UTC";
  }
}

export function windowedSourceTags(
  issue: Pick<RuntimeIssueFilterRow, "byHour" | "count" | "lastSeen" | "sources">,
  filters: Pick<RuntimeIssueFilters, "windowDays" | "tz" | "now">,
): string[] {
  const now = filters.now ?? Date.now();
  const tags = issue.sources?.length ? issue.sources : BADGE_TAGS;
  return tags.filter((tag) => {
    if (!BADGE_TAGS.includes(tag as RuntimeSourceTag)) return false;
    return windowHitCount(issue, filters.windowDays, filters.tz, now, tag) > 0;
  });
}

export function filterRuntimeIssues<T extends RuntimeIssueFilterRow>(
  issues: T[],
  filters: RuntimeIssueFilters,
): T[] {
  const pathNeedle = filters.pathQuery.trim().toLowerCase();
  const referrerNeedle = filters.referrerQuery.trim().toLowerCase();
  const now = filters.now ?? Date.now();
  const tz = filters.tz || "UTC";
  const windowDays = filters.windowDays || 30;
  return issues.filter((issue) => {
    const windowTotal = windowHitCount(issue, windowDays, tz, now);
    if (windowTotal <= 0) return false;
    if (filters.pagesOnly && isAssetPath(issue.path)) {
      return false;
    }
    if (pathNeedle && !issue.path.toLowerCase().includes(pathNeedle)) return false;
    if (referrerNeedle && !(issue.sampleReferrer ?? "").toLowerCase().includes(referrerNeedle)) {
      return false;
    }
    if (filters.locale !== FILTER_ALL && issue.locale !== filters.locale) return false;
    if (filters.device !== FILTER_ALL && (issue.uaBucket || "unknown") !== filters.device) {
      return false;
    }
    if (filters.source !== FILTER_ALL && filters.source) {
      if (windowHitCount(issue, windowDays, tz, now, filters.source) <= 0) return false;
    }
    if (filters.queryParamsOnly && !hasQueryAttribution(issue.queryAttribution)) return false;
    return true;
  });
}

export function isRuntimeIssueFiltersActive(filters: RuntimeIssueFilters): boolean {
  return countActiveListFilters(filters) > 0;
}

export function countActiveListFilters(filters: RuntimeIssueFilters): number {
  let n = 0;
  if (!filters.pagesOnly) n += 1;
  if (filters.pathQuery.trim() !== "") n += 1;
  if (filters.referrerQuery.trim() !== "") n += 1;
  if (filters.locale !== FILTER_ALL) n += 1;
  if (filters.device !== FILTER_ALL) n += 1;
  if (filters.source !== FILTER_ALL) n += 1;
  if (filters.queryParamsOnly) n += 1;
  if (filters.windowDays !== 30) n += 1;
  return n;
}

export function countIngestionFilters(dropScrapers: boolean): number {
  return dropScrapers === false ? 1 : 0;
}

export function sortRuntimeIssues<T extends { count: number; lastSeen: number }>(
  issues: T[],
  sortKey: RuntimeIssueSortKey,
  sortDir: RuntimeIssueSortDir,
): T[] {
  return [...issues].sort((a, b) => {
    const av = a[sortKey];
    const bv = b[sortKey];
    const cmp = av - bv;
    if (cmp !== 0) return sortDir === "asc" ? cmp : -cmp;
    if (b.count !== a.count) return b.count - a.count;
    return b.lastSeen - a.lastSeen;
  });
}

/** Filter then sort — table and CSV both use this so they stay on the same set. */
export function applyRuntimeIssueView<T extends RuntimeIssueFilterRow>(
  issues: T[],
  filters: RuntimeIssueFilters,
  sortKey: RuntimeIssueSortKey,
  sortDir: RuntimeIssueSortDir,
): Array<T & { count: number; count30: number }> {
  const now = filters.now ?? Date.now();
  const tz = filters.tz || "UTC";
  const windowDays = filters.windowDays || 30;
  const mapped = issues.map((issue) => ({
    ...issue,
    count: windowHitCount(issue, windowDays, tz, now),
    count30: windowHitCount(issue, 30, tz, now),
  }));
  return sortRuntimeIssues(filterRuntimeIssues(mapped, filters), sortKey, sortDir);
}

export function uniqueSorted(values: string[]): string[] {
  return Array.from(new Set(values.filter(Boolean))).sort((a, b) => a.localeCompare(b));
}

export function sortDevices(values: string[]): string[] {
  const present = new Set(values);
  return DEVICE_ORDER.filter((d) => present.has(d));
}

export function deviceLabel(bucket: string): string {
  return DEVICE_LABELS[bucket] ?? bucket;
}

export function sourceLabel(tag: string): string {
  return SOURCE_LABELS[tag as RuntimeSourceTag] ?? tag;
}

export const RUNTIME_ISSUES_PAGE_SIZE = 50;

export function paginateRuntimeIssues<T>(
  items: T[],
  page: number,
  pageSize = RUNTIME_ISSUES_PAGE_SIZE,
): { page: number; totalPages: number; totalItems: number; pageItems: T[] } {
  const totalItems = items.length;
  const totalPages = Math.max(1, Math.ceil(totalItems / pageSize));
  const safePage = Math.min(Math.max(1, page), totalPages);
  const offset = (safePage - 1) * pageSize;
  return { page: safePage, totalPages, totalItems, pageItems: items.slice(offset, offset + pageSize) };
}
