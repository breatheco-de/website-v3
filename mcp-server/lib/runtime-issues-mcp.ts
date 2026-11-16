/**
 * Pure query helpers for get_runtime_issues (kind 404 → http.not_found).
 */

import {
  FILTER_ALL,
  applyRuntimeIssueView,
  type RuntimeIssueFilterRow,
  type RuntimeIssueFilters,
  type RuntimeIssueSortKey,
} from "../../shared/runtime-issues-list-filters.js";
import {
  samplesForIssue,
  type RuntimeHitSample,
  type RuntimeQueryAttribution,
} from "../../shared/runtime-issues.js";

export const RUNTIME_ISSUES_STORED_KIND_404 = "http.not_found";
export const RUNTIME_ISSUES_DEFAULT_LIMIT = 25;
export const RUNTIME_ISSUES_MAX_LIMIT = 100;

export type RuntimeIssueMcpRow = RuntimeIssueFilterRow & {
  fingerprint: string;
  kind?: string;
  firstSeen?: number;
  cmsReferrerCount?: number;
  likelyBot?: boolean;
  lastProbe?: unknown;
  samples?: RuntimeHitSample[];
};

export type RuntimeIssuesMcpArgs = {
  kind: string;
  path?: string;
  referrer?: string;
  locale?: string;
  device?: string;
  source?: string;
  pages_only?: boolean;
  query_params_only?: boolean;
  window_days?: 7 | 30;
  tz?: string;
  sort?: "count" | "lastSeen";
  limit?: number;
};

export function buildRuntimeIssueFiltersFromArgs(
  args: Omit<RuntimeIssuesMcpArgs, "kind">,
): RuntimeIssueFilters {
  return {
    pathQuery: args.path?.trim() ?? "",
    referrerQuery: args.referrer?.trim() ?? "",
    locale: args.locale?.trim() || FILTER_ALL,
    device: args.device?.trim() || FILTER_ALL,
    pagesOnly: args.pages_only !== false,
    queryParamsOnly: args.query_params_only === true,
    windowDays: args.window_days === 7 ? 7 : 30,
    tz: args.tz?.trim() || "UTC",
    source: args.source?.trim() || FILTER_ALL,
  };
}

export function clampRuntimeIssuesLimit(limit?: number): number {
  return Math.min(Math.max(limit ?? RUNTIME_ISSUES_DEFAULT_LIMIT, 1), RUNTIME_ISSUES_MAX_LIMIT);
}

export type QueryRuntimeIssuesResult =
  | {
      ok: false;
      code: "unsupported_kind";
      error: string;
    }
  | {
      ok: true;
      filters: RuntimeIssueFilters;
      sortKey: RuntimeIssueSortKey;
      limit: number;
      total_matching: number;
      issues: Array<{
        fingerprint: string;
        kind: "404";
        path: string;
        locale: string | null | undefined;
        count: number;
        count30: number;
        firstSeen: number;
        lastSeen: number;
        sources: string[];
        sampleReferrer: string | null;
        uaBucket: string | null;
        queryAttribution: RuntimeQueryAttribution | null;
        lastProbe: unknown;
        cmsReferrerCount: number;
        likelyBot: boolean;
        recent_samples: RuntimeHitSample[];
      }>;
    };

/**
 * Filter http.not_found rows with the shared diagnostics view, then map MCP row shape.
 */
export function queryRuntimeIssuesForMcp(
  issues: RuntimeIssueMcpRow[],
  args: RuntimeIssuesMcpArgs,
  recent?: RuntimeHitSample[],
): QueryRuntimeIssuesResult {
  if (args.kind !== "404") {
    return {
      ok: false,
      code: "unsupported_kind",
      error: "kind must be 404 (only http.not_found is supported in this release).",
    };
  }

  const notFound = issues.filter((i) => i.kind === RUNTIME_ISSUES_STORED_KIND_404);
  const filters = buildRuntimeIssueFiltersFromArgs(args);
  const sortKey: RuntimeIssueSortKey = args.sort === "lastSeen" ? "lastSeen" : "count";
  const viewed = applyRuntimeIssueView(notFound, filters, sortKey, "desc");
  const limit = clampRuntimeIssuesLimit(args.limit);

  return {
    ok: true,
    filters,
    sortKey,
    limit,
    total_matching: viewed.length,
    issues: viewed.slice(0, limit).map((row) => ({
      fingerprint: row.fingerprint,
      kind: "404" as const,
      path: row.path,
      locale: row.locale,
      count: row.count,
      count30: row.count30,
      firstSeen: row.firstSeen ?? row.lastSeen,
      lastSeen: row.lastSeen,
      sources: row.sources ?? [],
      sampleReferrer: row.sampleReferrer ?? null,
      uaBucket: row.uaBucket ?? null,
      queryAttribution: row.queryAttribution ?? null,
      lastProbe: row.lastProbe ?? null,
      cmsReferrerCount: row.cmsReferrerCount ?? 0,
      likelyBot: row.likelyBot ?? false,
      recent_samples: samplesForIssue(
        { fingerprint: row.fingerprint, samples: row.samples },
        recent,
      ),
    })),
  };
}
