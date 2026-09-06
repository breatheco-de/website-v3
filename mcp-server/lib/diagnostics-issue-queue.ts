/**
 * MCP diagnostics work queue: prioritize, diversify, and paginate actionable
 * open issues so agents get a claimable bunch without a full site dump.
 *
 * Default `open_issues` excludes soft-completed rows and claims held by other
 * authors. Pass `issue_status` to opt into claimed / completed / all.
 */

import { parseEntryKey } from "../../scripts/validation/shared/entryKey.js";
import { enrichIssueCatalogFields } from "./issue-code-enrichment.js";

export const ISSUES_LIMIT_DEFAULT = 50;
export const ISSUES_LIMIT_MAX = 50;
export const ISSUE_TEXT_MAX = 200;
export const ISSUES_BY_CODE_TOP = 20;

export type DiagnosticsQueueSeverity = "error" | "warning";
export type DiagnosticsIssueStatus = "open" | "claimed" | "completed";
export type DiagnosticsIssueStatusFilter = DiagnosticsIssueStatus | "all";

/** Input row (cache-backed or flattened fallback), with optional overlay fields. */
export type DiagnosticsQueueInputRow = {
  id?: string;
  severity: DiagnosticsQueueSeverity;
  code: string;
  category?: string;
  validator?: string;
  message: string;
  suggestion?: string;
  slug?: string;
  url?: string;
  file?: string;
  entryKey?: string;
  /** Soft-complete overlay from validation-cache. */
  completed?: { by: string; at: string };
  /** Active claim overlay from validation-cache. */
  claimed?: { by: string; at: string; expiresAt?: string };
};

export type DiagnosticsQueueIssue = {
  id?: string;
  severity: DiagnosticsQueueSeverity;
  code: string;
  category: string;
  validator?: string;
  message: string;
  suggestion?: string;
  slug?: string;
  url?: string;
  file?: string;
  status: DiagnosticsIssueStatus;
  claimed_by?: string;
  claimed_by_me?: boolean;
  completed_at?: string;
  completed_by?: string;
  help?: { title: string; summary?: string; incomplete?: boolean };
  next_actions?: Array<{ tool: string; reason: string; priority?: string }>;
  staff_context?: string;
};

export type DiagnosticsIssueQueueOptions = {
  /** @deprecated Prefer open_issues_offset. */
  issues_offset?: number;
  /** @deprecated Prefer open_issues_limit. */
  issues_limit?: number;
  open_issues_offset?: number;
  open_issues_limit?: number;
  severity?: DiagnosticsQueueSeverity;
  category?: string;
  /** Match any of these categories (case-insensitive). */
  categories?: string[];
  codes?: string[];
  /** When set, keep rows whose slug matches (job/request scope). */
  slugs?: string[];
  /** Mid-run: keep rows whose url is in this set (normalized). */
  urls?: string[];
  /** Site content root for staff_context markdown. */
  contentRoot?: string;
  /**
   * Work-queue membership filter (after overlay, before rank/limit).
   * Default `open` = incomplete + unclaimed, or claimed by viewerAuthor.
   */
  issue_status?: DiagnosticsIssueStatusFilter;
  /** MCP caller author — own claims stay in open_issues. */
  viewerAuthor?: string;
};

export type DiagnosticsIssueQueueResult = {
  open_issues: DiagnosticsQueueIssue[];
  claimed_issues: DiagnosticsQueueIssue[];
  completed_issues: DiagnosticsQueueIssue[];
  open_count: number;
  claimed_by_others_count: number;
  completed_count: number;
  open_issues_truncated: boolean;
  open_issues_returned: number;
  open_issues_total_matching: number;
  open_issues_offset: number;
  open_issues_limit: number;
  open_issues_next_offset: number | null;
  open_issues_by_code: Array<{
    code: string;
    severity: DiagnosticsQueueSeverity;
    count: number;
  }>;
  issue_status: DiagnosticsIssueStatusFilter;
};

export function clampIssuesLimit(raw: number | undefined): number {
  if (raw == null || !Number.isFinite(raw)) return ISSUES_LIMIT_DEFAULT;
  return Math.min(ISSUES_LIMIT_MAX, Math.max(1, Math.floor(raw)));
}

export function clampIssuesOffset(raw: number | undefined): number {
  if (raw == null || !Number.isFinite(raw) || raw < 0) return 0;
  return Math.floor(raw);
}

export function truncateIssueText(
  text: string | undefined,
  max = ISSUE_TEXT_MAX,
): string | undefined {
  if (text == null) return undefined;
  if (text.length <= max) return text;
  return `${text.slice(0, max - 1)}…`;
}

export function slugFromEntryKey(entryKey: string | undefined): string | undefined {
  if (!entryKey) return undefined;
  return parseEntryKey(entryKey)?.slug;
}

export function normalizeUrlKey(url: string): string {
  return url.toLowerCase().replace(/\/$/, "") || "/";
}

function classifyRowStatus(
  row: DiagnosticsQueueInputRow,
  viewerAuthor?: string,
): { status: DiagnosticsIssueStatus; claimed_by_me: boolean } {
  if (row.completed) {
    return { status: "completed", claimed_by_me: false };
  }
  if (row.claimed?.by) {
    const mine = Boolean(viewerAuthor && row.claimed.by === viewerAuthor);
    return {
      // Own claims remain actionable open work; others are "claimed".
      status: mine ? "open" : "claimed",
      claimed_by_me: mine,
    };
  }
  return { status: "open", claimed_by_me: false };
}

/** Map cache-issues API rows into queue input (preserves overlay fields). */
export function cacheIssueRowsToQueueInput(
  rows: Array<{
    id: string;
    url: string;
    entryKey?: string;
    severity: string;
    code: string;
    message: string;
    validator?: string;
    category?: string;
    suggestion?: string;
    file?: string;
    completed?: { by?: string; at?: string } | null;
    claimed?: { by?: string; at?: string; expiresAt?: string } | null;
  }>,
): DiagnosticsQueueInputRow[] {
  const out: DiagnosticsQueueInputRow[] = [];
  for (const r of rows) {
    if (r.severity !== "error" && r.severity !== "warning") continue;
    const slug = slugFromEntryKey(r.entryKey);
    const row: DiagnosticsQueueInputRow = {
      id: r.id,
      severity: r.severity,
      code: r.code,
      category: r.category,
      validator: r.validator,
      message: r.message,
      suggestion: r.suggestion,
      slug,
      url: r.url || undefined,
      file: r.file,
      entryKey: r.entryKey,
    };
    if (r.completed && typeof r.completed === "object" && r.completed.by && r.completed.at) {
      row.completed = { by: r.completed.by, at: r.completed.at };
    }
    if (r.claimed && typeof r.claimed === "object" && r.claimed.by) {
      row.claimed = {
        by: r.claimed.by,
        at: r.claimed.at ?? "",
        ...(r.claimed.expiresAt ? { expiresAt: r.claimed.expiresAt } : {}),
      };
    }
    out.push(row);
  }
  return out;
}

/** Flatten job/API issuesBySlug when cache-issues is unavailable (no stable id). */
export function flattenIssuesBySlug(
  issuesBySlug: Record<
    string,
    Array<{
      code: string;
      message: string;
      severity?: string;
      category?: string;
      validator?: string;
      file?: string;
      suggestion?: string;
      url?: string;
    }>
  >,
): DiagnosticsQueueInputRow[] {
  const out: DiagnosticsQueueInputRow[] = [];
  for (const [slug, list] of Object.entries(issuesBySlug)) {
    if (!Array.isArray(list)) continue;
    for (const issue of list) {
      if (!issue?.code || !issue.message) continue;
      if (issue.severity === "info") continue;
      const severity: DiagnosticsQueueSeverity =
        issue.severity === "error" ? "error" : "warning";
      out.push({
        severity,
        code: issue.code,
        category: issue.category,
        validator: issue.validator,
        message: issue.message,
        suggestion: issue.suggestion,
        slug,
        url: issue.url,
        file: issue.file,
      });
    }
  }
  return out;
}

function rowMatchesSlugScope(row: DiagnosticsQueueInputRow, slugSet: Set<string>): boolean {
  if (row.slug && slugSet.has(row.slug)) return true;
  const fromKey = slugFromEntryKey(row.entryKey);
  if (fromKey && slugSet.has(fromKey)) return true;
  return false;
}

function rowMatchesUrlScope(row: DiagnosticsQueueInputRow, urlSet: Set<string>): boolean {
  if (!row.url) return false;
  return urlSet.has(normalizeUrlKey(row.url));
}

function compareRows(a: DiagnosticsQueueInputRow, b: DiagnosticsQueueInputRow): number {
  const sev = (a.severity === "error" ? 0 : 1) - (b.severity === "error" ? 0 : 1);
  if (sev !== 0) return sev;
  const code = a.code.localeCompare(b.code);
  if (code !== 0) return code;
  const url = (a.url ?? "").localeCompare(b.url ?? "");
  if (url !== 0) return url;
  return (a.id ?? "").localeCompare(b.id ?? "");
}

/**
 * Round-robin across codes within one severity group so early pages mix codes.
 * All rows remain pageable; buckets preserve per-code order from the sorted list.
 */
export function diversifyRoundRobinByCode(
  sorted: DiagnosticsQueueInputRow[],
): DiagnosticsQueueInputRow[] {
  if (sorted.length <= 1) return sorted;
  const buckets = new Map<string, DiagnosticsQueueInputRow[]>();
  const codeOrder: string[] = [];
  for (const row of sorted) {
    const key = row.code;
    if (!buckets.has(key)) {
      buckets.set(key, []);
      codeOrder.push(key);
    }
    buckets.get(key)!.push(row);
  }
  if (codeOrder.length <= 1) return sorted;

  const result: DiagnosticsQueueInputRow[] = [];
  const indices = new Map<string, number>();
  for (const c of codeOrder) indices.set(c, 0);

  let remaining = sorted.length;
  while (remaining > 0) {
    for (const c of codeOrder) {
      const bucket = buckets.get(c)!;
      const i = indices.get(c)!;
      if (i < bucket.length) {
        result.push(bucket[i]!);
        indices.set(c, i + 1);
        remaining -= 1;
      }
    }
  }
  return result;
}

/** Errors first (diversified), then warnings (diversified). */
export function diversifyPreservingSeverity(
  sorted: DiagnosticsQueueInputRow[],
): DiagnosticsQueueInputRow[] {
  const errors = sorted.filter((r) => r.severity === "error");
  const warnings = sorted.filter((r) => r.severity === "warning");
  return [
    ...diversifyRoundRobinByCode(errors),
    ...diversifyRoundRobinByCode(warnings),
  ];
}

function toOutputIssue(
  row: DiagnosticsQueueInputRow,
  viewerAuthor: string | undefined,
  contentRoot?: string,
): DiagnosticsQueueIssue {
  const { status, claimed_by_me } = classifyRowStatus(row, viewerAuthor);
  const enriched = enrichIssueCatalogFields({
    validator: row.validator,
    code: row.code,
    instanceSuggestion: row.suggestion,
    contentRoot,
  });
  const issue: DiagnosticsQueueIssue = {
    severity: row.severity,
    code: row.code,
    category: row.category ?? "other",
    message: truncateIssueText(row.message) ?? "",
    status,
  };
  if (row.id) issue.id = row.id;
  if (row.validator) issue.validator = row.validator;
  const suggestion = truncateIssueText(enriched.suggestion ?? row.suggestion);
  if (suggestion) issue.suggestion = suggestion;
  if (row.slug) issue.slug = row.slug;
  if (row.url) issue.url = row.url;
  if (row.file) issue.file = row.file;
  if (row.claimed?.by) {
    issue.claimed_by = row.claimed.by;
    issue.claimed_by_me = claimed_by_me;
  } else {
    issue.claimed_by_me = false;
  }
  if (row.completed) {
    issue.completed_by = row.completed.by;
    issue.completed_at = row.completed.at;
  }
  if (enriched.help) issue.help = enriched.help;
  if (enriched.next_actions?.length) issue.next_actions = enriched.next_actions;
  if (enriched.staff_context) {
    issue.staff_context =
      truncateIssueText(enriched.staff_context, 500) ?? enriched.staff_context;
  }
  return issue;
}

function buildByCode(
  matching: DiagnosticsQueueInputRow[],
): DiagnosticsIssueQueueResult["open_issues_by_code"] {
  const counts = new Map<
    string,
    { code: string; severity: DiagnosticsQueueSeverity; count: number }
  >();
  for (const row of matching) {
    const key = `${row.severity}\0${row.code}`;
    const prev = counts.get(key);
    if (prev) prev.count += 1;
    else counts.set(key, { code: row.code, severity: row.severity, count: 1 });
  }
  return [...counts.values()]
    .sort((a, b) => b.count - a.count || a.code.localeCompare(b.code))
    .slice(0, ISSUES_BY_CODE_TOP);
}

function matchesAttributeFilters(
  row: DiagnosticsQueueInputRow,
  options: DiagnosticsIssueQueueOptions,
  codeSet: Set<string> | null,
  slugSet: Set<string> | null,
  urlSet: Set<string> | null,
): boolean {
  if (row.severity !== "error" && row.severity !== "warning") return false;
  if (options.severity && row.severity !== options.severity) return false;
  if (options.category) {
    const cat = (row.category ?? "other").toLowerCase();
    if (cat !== options.category.toLowerCase()) return false;
  }
  if (options.categories && options.categories.length > 0) {
    const want = new Set(
      options.categories.map((c) => c.trim().toLowerCase()).filter(Boolean),
    );
    const cat = (row.category ?? "other").toLowerCase();
    if (!want.has(cat)) return false;
  }
  if (codeSet && !codeSet.has(row.code)) return false;
  if (slugSet && !rowMatchesSlugScope(row, slugSet)) return false;
  if (urlSet && !rowMatchesUrlScope(row, urlSet)) return false;
  return true;
}

function rankAndPaginate(
  rows: DiagnosticsQueueInputRow[],
  offset: number,
  limit: number,
): { page: DiagnosticsQueueInputRow[]; total: number } {
  const sorted = [...rows].sort(compareRows);
  const diversified = diversifyPreservingSeverity(sorted);
  return {
    total: diversified.length,
    page: diversified.slice(offset, offset + limit),
  };
}

export function buildDiagnosticsIssueQueue(
  rows: DiagnosticsQueueInputRow[],
  options: DiagnosticsIssueQueueOptions = {},
): DiagnosticsIssueQueueResult {
  const open_issues_limit = clampIssuesLimit(
    options.open_issues_limit ?? options.issues_limit,
  );
  const open_issues_offset = clampIssuesOffset(
    options.open_issues_offset ?? options.issues_offset,
  );
  const issue_status: DiagnosticsIssueStatusFilter = options.issue_status ?? "open";
  const viewerAuthor = options.viewerAuthor;
  const codeSet =
    options.codes && options.codes.length > 0
      ? new Set(options.codes.map((c) => c.trim()).filter(Boolean))
      : null;
  const slugSet =
    options.slugs && options.slugs.length > 0 ? new Set(options.slugs) : null;
  const urlSet =
    options.urls && options.urls.length > 0
      ? new Set(options.urls.map(normalizeUrlKey))
      : null;

  const attributed = rows.filter((row) =>
    matchesAttributeFilters(row, options, codeSet, slugSet, urlSet),
  );

  const openRows: DiagnosticsQueueInputRow[] = [];
  const claimedRows: DiagnosticsQueueInputRow[] = [];
  const completedRows: DiagnosticsQueueInputRow[] = [];

  for (const row of attributed) {
    const { status } = classifyRowStatus(row, viewerAuthor);
    if (status === "completed") completedRows.push(row);
    else if (status === "claimed") claimedRows.push(row);
    else openRows.push(row);
  }

  const open_count = openRows.length;
  const claimed_by_others_count = claimedRows.length;
  const completed_count = completedRows.length;

  let primaryRows: DiagnosticsQueueInputRow[] = openRows;
  if (issue_status === "claimed") primaryRows = claimedRows;
  else if (issue_status === "completed") primaryRows = completedRows;

  const { page, total } = rankAndPaginate(
    primaryRows,
    open_issues_offset,
    open_issues_limit,
  );
  const open_issues_returned = page.length;
  const next = open_issues_offset + open_issues_returned;
  const open_issues_next_offset = next < total ? next : null;
  const open_issues_truncated =
    open_issues_offset > 0 || open_issues_next_offset != null;

  const mapPage = (list: DiagnosticsQueueInputRow[]) =>
    list.map((row) => toOutputIssue(row, viewerAuthor, options.contentRoot));

  let open_issues: DiagnosticsQueueIssue[] = [];
  let claimed_issues: DiagnosticsQueueIssue[] = [];
  let completed_issues: DiagnosticsQueueIssue[] = [];

  if (issue_status === "open") {
    open_issues = mapPage(page);
  } else if (issue_status === "claimed") {
    claimed_issues = mapPage(page);
  } else if (issue_status === "completed") {
    completed_issues = mapPage(page);
  } else {
    // all — three arrays; pagination applies to open_issues only
    open_issues = mapPage(page);
    claimed_issues = mapPage(
      rankAndPaginate(claimedRows, 0, open_issues_limit).page,
    );
    completed_issues = mapPage(
      rankAndPaginate(completedRows, 0, open_issues_limit).page,
    );
  }

  return {
    open_issues,
    claimed_issues,
    completed_issues,
    open_count,
    claimed_by_others_count,
    completed_count,
    open_issues_truncated,
    open_issues_returned,
    open_issues_total_matching: total,
    open_issues_offset,
    open_issues_limit,
    open_issues_next_offset,
    open_issues_by_code: buildByCode(primaryRows),
    issue_status,
  };
}

/** Spread into MCP ok() payloads for diagnostics issue work queue fields. */
export function diagnosticsIssueQueueFields(
  queue: DiagnosticsIssueQueueResult,
): Record<string, unknown> {
  return {
    open_issues: queue.open_issues,
    claimed_issues: queue.claimed_issues,
    completed_issues: queue.completed_issues,
    open_count: queue.open_count,
    claimed_by_others_count: queue.claimed_by_others_count,
    completed_count: queue.completed_count,
    open_issues_truncated: queue.open_issues_truncated,
    open_issues_returned: queue.open_issues_returned,
    open_issues_total_matching: queue.open_issues_total_matching,
    open_issues_offset: queue.open_issues_offset,
    open_issues_limit: queue.open_issues_limit,
    open_issues_next_offset: queue.open_issues_next_offset,
    open_issues_by_code: queue.open_issues_by_code,
    issue_status: queue.issue_status,
  };
}

export type DiagnosticsIssuePageNextAction = {
  tool: "get_diagnostics_job" | "run_entry_diagnostics";
  reason: string;
  args_hint: Record<string, unknown>;
  priority: "required" | "recommended" | "optional";
};

export function diagnosticsIssuePageNextAction(opts: {
  tool: "get_diagnostics_job" | "run_entry_diagnostics";
  args_hint: Record<string, unknown>;
  open_issues_next_offset: number | null;
}): DiagnosticsIssuePageNextAction | null {
  if (opts.open_issues_next_offset == null) return null;
  return {
    tool: opts.tool,
    reason:
      "Fetch the next page of the open_issues work queue (open_issues_offset paginates the issue list only).",
    args_hint: {
      ...opts.args_hint,
      open_issues_offset: opts.open_issues_next_offset,
    },
    priority: "recommended",
  };
}
