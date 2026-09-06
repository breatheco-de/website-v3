/**
 * Pure helpers for get_validation_issues MCP tool (metrics_view).
 */

export const RESOLVED_WINDOW_DAYS = 60;

export type ValidationIssuesArgs = {
  slug?: string;
  locale?: string;
  contentType?: string;
  url?: string;
  code?: string;
  validator?: string;
  category?: string;
  search?: string;
  set?: "open" | "resolved";
  limit?: number;
  offset?: number;
};

export function isValidationIssuesScoped(args: ValidationIssuesArgs): boolean {
  return Boolean(
    args.slug?.trim() ||
      args.url?.trim() ||
      args.code?.trim() ||
      args.validator?.trim() ||
      args.category?.trim() ||
      args.search?.trim(),
  );
}

export function clampIssuesLimit(limit?: number): number {
  if (limit == null || !Number.isFinite(limit)) return 20;
  return Math.min(200, Math.max(1, Math.floor(limit)));
}

export function clampIssuesOffset(offset?: number): number {
  if (offset == null || !Number.isFinite(offset)) return 0;
  return Math.max(0, Math.floor(offset));
}

export function issuesNextOffset(
  offset: number,
  _limit: number,
  total: number,
  pageLen: number,
): number | null {
  const next = offset + pageLen;
  return next < total ? next : null;
}

export function paginateRows<T>(rows: T[], offset: number, limit: number): T[] {
  return rows.slice(offset, offset + limit);
}

export type OpenStats = {
  errors: number;
  warnings: number;
  total: number;
};

export type ResolvedStats = {
  window_days: number;
  resolvedCount: number;
  reopened: number;
  total: number;
  errors: number;
  warnings: number;
};

export function openStatsFromCacheTotals(totals: {
  openErrors?: number;
  openWarnings?: number;
  open?: number;
}): OpenStats {
  const errors = Number(totals.openErrors) || 0;
  const warnings = Number(totals.openWarnings) || 0;
  const total = Number(totals.open) || errors + warnings;
  return { errors, warnings, total };
}

export function resolvedStatsFromArchiveSummary(summary: {
  resolvedCount?: number;
  reopened?: number;
  total?: number;
  errors?: number;
  warnings?: number;
}): ResolvedStats {
  return {
    window_days: RESOLVED_WINDOW_DAYS,
    resolvedCount: Number(summary.resolvedCount) || 0,
    reopened: Number(summary.reopened) || 0,
    total: Number(summary.total) || 0,
    errors: Number(summary.errors) || 0,
    warnings: Number(summary.warnings) || 0,
  };
}
