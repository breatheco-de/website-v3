/**
 * Shared search-engine indexing status mappers (Google GSC today; Bing later).
 * Used by staff UI crawler badges and MCP get_entry_seo include_search_engines.
 */

/** "bing" lands when Bing Webmaster cache exists (phase 2). */
export type CrawlerId = "google";

export type CrawlerIndexStatus =
  | "indexed"
  | "not_indexed"
  | "never_checked"
  | "error"
  | "not_configured"
  | "not_applicable"
  | "loading";

export interface SearchEngineInspectionRecord {
  inspectedAt: string;
  coverageState?: string;
  indexingState?: string;
  verdict?: string;
  lastCrawlTime?: string;
  robotsTxtState?: string;
  pageFetchState?: string;
  googleCanonical?: string;
  userCanonical?: string;
  error?: string;
}

export interface SearchEngineResolvedUrl {
  requested: string;
  loc: string | null;
  inSitemap: boolean;
  isDraft: boolean;
  isPreview?: boolean;
}

export interface CrawlerPageStatus {
  id: CrawlerId;
  label: string;
  status: CrawlerIndexStatus;
  detail?: string;
  checkedAt?: string;
  lastCrawlAt?: string;
  loc?: string;
  inSitemap?: boolean;
}

const PROBLEM_STATUSES = new Set<CrawlerIndexStatus>([
  "not_indexed",
  "never_checked",
  "error",
  "not_configured",
]);

export function gscHeadline(
  record: SearchEngineInspectionRecord | null | undefined,
  resolved?: SearchEngineResolvedUrl,
): string {
  if (resolved?.isDraft) return "Not in sitemap (draft)";
  if (record?.error && !record.verdict && !record.coverageState) return "Error";
  if (!record) return "Never checked";
  const verdict = (record.verdict || "").toUpperCase();
  if (verdict === "PASS") return "Indexed";
  const coverage = (record.coverageState || "").toLowerCase();
  if (coverage.includes("submitted and indexed") || coverage === "indexed") return "Indexed";
  if (record.error) return "Error";
  return "Not indexed";
}

/** Normalize a canonical URL for equality (host + path, no trailing slash except root). */
export function normalizeCanonicalUrl(raw: string | undefined | null): string | null {
  if (typeof raw !== "string" || !raw.trim()) return null;
  const trimmed = raw.trim();
  try {
    const u = new URL(trimmed.includes("://") ? trimmed : `https://${trimmed}`);
    const host = u.hostname.replace(/^www\./i, "").toLowerCase();
    let pathname = u.pathname || "/";
    if (pathname.length > 1 && pathname.endsWith("/")) pathname = pathname.slice(0, -1);
    return `${host}${pathname}${u.search}`;
  } catch {
    return trimmed.toLowerCase().replace(/\/$/, "");
  }
}

/** True when both canonicals are present and differ after normalization. */
export function canonicalMismatch(
  record: SearchEngineInspectionRecord | null | undefined,
): boolean {
  if (!record) return false;
  const google = normalizeCanonicalUrl(record.googleCanonical);
  const user = normalizeCanonicalUrl(record.userCanonical);
  if (!google || !user) return false;
  return google !== user;
}

export function googleToCrawlerStatus(opts: {
  configured?: boolean;
  record?: SearchEngineInspectionRecord | null;
  resolved?: SearchEngineResolvedUrl;
  loadError?: boolean;
  loading?: boolean;
}): CrawlerPageStatus {
  const base: Pick<CrawlerPageStatus, "id" | "label"> = {
    id: "google",
    label: "Google",
  };

  const loc = opts.resolved?.loc ?? undefined;
  const inSitemap = opts.resolved?.inSitemap;
  const checkedAt = opts.record?.inspectedAt;
  const lastCrawlAt = opts.record?.lastCrawlTime;

  if (opts.loading) {
    return { ...base, status: "loading", loc, inSitemap, checkedAt, lastCrawlAt };
  }

  if (opts.loadError) {
    return {
      ...base,
      status: "error",
      detail: "Failed to load Search Console cache",
      loc,
      inSitemap,
      checkedAt,
      lastCrawlAt,
    };
  }

  if (opts.configured === false) {
    return {
      ...base,
      status: "not_configured",
      detail: "Not configured",
      loc,
      inSitemap,
    };
  }

  if (opts.resolved?.isDraft) {
    return {
      ...base,
      status: "not_applicable",
      detail: gscHeadline(opts.record, opts.resolved),
      loc,
      inSitemap: opts.resolved.inSitemap,
      checkedAt,
      lastCrawlAt,
    };
  }

  // Still loading config / first fetch — treat as loading rather than never_checked
  if (opts.configured !== true) {
    return { ...base, status: "loading", loc, inSitemap, checkedAt, lastCrawlAt };
  }

  const headline = gscHeadline(opts.record, opts.resolved);

  if (!opts.record) {
    return {
      ...base,
      status: "never_checked",
      detail: headline,
      loc,
      inSitemap,
    };
  }

  if (headline === "Indexed") {
    return {
      ...base,
      status: "indexed",
      detail: headline,
      loc,
      inSitemap,
      checkedAt,
      lastCrawlAt,
    };
  }

  if (headline === "Error") {
    return {
      ...base,
      status: "error",
      detail: opts.record.error || headline,
      loc,
      inSitemap,
      checkedAt,
      lastCrawlAt,
    };
  }

  return {
    ...base,
    status: "not_indexed",
    detail: headline,
    loc,
    inSitemap,
    checkedAt,
    lastCrawlAt,
  };
}

export function crawlerProblemCount(statuses: CrawlerPageStatus[]): number {
  return statuses.filter((s) => PROBLEM_STATUSES.has(s.status)).length;
}

/** Every non-N/A, non-loading crawler is indexed, and at least one such crawler exists. */
export function allApplicableCrawlersIndexed(statuses: CrawlerPageStatus[]): boolean {
  const applicable = statuses.filter(
    (s) => s.status !== "not_applicable" && s.status !== "loading",
  );
  if (applicable.length === 0) return false;
  return applicable.every((s) => s.status === "indexed");
}

export type CrawlerBadgeKind = "loading" | "ok" | "problems" | "none";

export interface CrawlerBadgeState {
  kind: CrawlerBadgeKind;
  count: number;
}

export function crawlerBadgeState(statuses: CrawlerPageStatus[]): CrawlerBadgeState {
  if (statuses.some((s) => s.status === "loading")) {
    return { kind: "loading", count: 0 };
  }

  const applicable = statuses.filter((s) => s.status !== "not_applicable");
  if (applicable.length === 0) {
    return { kind: "none", count: 0 };
  }

  if (allApplicableCrawlersIndexed(statuses)) {
    return { kind: "ok", count: 0 };
  }

  return { kind: "problems", count: crawlerProblemCount(statuses) };
}
