/**
 * MCP diagnostics work queue: prioritize, diversify, and paginate open issues
 * so agents get a claimable bunch without a full site dump.
 */

import { parseEntryKey } from "../../scripts/validation/shared/entryKey.js";
import { enrichIssueCatalogFields } from "./issue-code-enrichment.js";

export const ISSUES_LIMIT_DEFAULT = 50;
export const ISSUES_LIMIT_MAX = 50;
export const ISSUE_TEXT_MAX = 200;
export const ISSUES_BY_CODE_TOP = 20;

export type DiagnosticsQueueSeverity = "error" | "warning";

/** Input row (cache-backed or flattened fallback). */
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
  help?: { title: string; summary?: string; incomplete?: boolean };
  next_actions?: Array<{ tool: string; reason: string; priority?: string }>;
  staff_context?: string;
};

export type DiagnosticsIssueQueueOptions = {
  issues_offset?: number;
  issues_limit?: number;
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
};

export type DiagnosticsIssueQueueResult = {
  issues: DiagnosticsQueueIssue[];
  issues_truncated: boolean;
  issues_returned: number;
  issues_total_matching: number;
  issues_offset: number;
  issues_limit: number;
  issues_next_offset: number | null;
  issues_by_code: Array<{
    code: string;
    severity: DiagnosticsQueueSeverity;
    count: number;
  }>;
};

export function clampIssuesLimit(raw: number | undefined): number {
  if (raw == null || !Number.isFinite(raw)) return ISSUES_LIMIT_DEFAULT;
  return Math.min(ISSUES_LIMIT_MAX, Math.max(1, Math.floor(raw)));
}

export function clampIssuesOffset(raw: number | undefined): number {
  if (raw == null || !Number.isFinite(raw) || raw < 0) return 0;
  return Math.floor(raw);
}

export function truncateIssueText(text: string | undefined, max = ISSUE_TEXT_MAX): string | undefined {
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

/** Map cache-issues API rows into queue input. */
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
    completed?: unknown;
  }>,
): DiagnosticsQueueInputRow[] {
  const out: DiagnosticsQueueInputRow[] = [];
  for (const r of rows) {
    if (r.completed) continue;
    if (r.severity !== "error" && r.severity !== "warning") continue;
    const slug = slugFromEntryKey(r.entryKey);
    out.push({
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
    });
  }
  return out;
}

/** Flatten job/API issuesBySlug when cache-issues is unavailable (no stable id). */
export function flattenIssuesBySlug(
  issuesBySlug: Record<string, Array<{
    code: string;
    message: string;
    severity?: string;
    category?: string;
    validator?: string;
    file?: string;
    suggestion?: string;
    url?: string;
  }>>,
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
  contentRoot?: string,
): DiagnosticsQueueIssue {
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
  };
  if (row.id) issue.id = row.id;
  if (row.validator) issue.validator = row.validator;
  const suggestion = truncateIssueText(enriched.suggestion ?? row.suggestion);
  if (suggestion) issue.suggestion = suggestion;
  if (row.slug) issue.slug = row.slug;
  if (row.url) issue.url = row.url;
  if (row.file) issue.file = row.file;
  if (enriched.help) issue.help = enriched.help;
  if (enriched.next_actions?.length) issue.next_actions = enriched.next_actions;
  if (enriched.staff_context) {
    issue.staff_context = truncateIssueText(enriched.staff_context, 500) ?? enriched.staff_context;
  }
  return issue;
}

function buildByCode(
  matching: DiagnosticsQueueInputRow[],
): DiagnosticsIssueQueueResult["issues_by_code"] {
  const counts = new Map<string, { code: string; severity: DiagnosticsQueueSeverity; count: number }>();
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

export function buildDiagnosticsIssueQueue(
  rows: DiagnosticsQueueInputRow[],
  options: DiagnosticsIssueQueueOptions = {},
): DiagnosticsIssueQueueResult {
  const issues_limit = clampIssuesLimit(options.issues_limit);
  const issues_offset = clampIssuesOffset(options.issues_offset);
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

  let matching = rows.filter((row) => {
    if (row.severity !== "error" && row.severity !== "warning") return false;
    if (options.severity && row.severity !== options.severity) return false;
    if (options.category) {
      const cat = (row.category ?? "other").toLowerCase();
      if (cat !== options.category.toLowerCase()) return false;
    }
    if (options.categories && options.categories.length > 0) {
      const want = new Set(options.categories.map((c) => c.trim().toLowerCase()).filter(Boolean));
      const cat = (row.category ?? "other").toLowerCase();
      if (!want.has(cat)) return false;
    }
    if (codeSet && !codeSet.has(row.code)) return false;
    if (slugSet && !rowMatchesSlugScope(row, slugSet)) return false;
    if (urlSet && !rowMatchesUrlScope(row, urlSet)) return false;
    return true;
  });

  matching = [...matching].sort(compareRows);
  const diversified = diversifyPreservingSeverity(matching);
  const issues_total_matching = diversified.length;
  const page = diversified.slice(issues_offset, issues_offset + issues_limit);
  const issues_returned = page.length;
  const next = issues_offset + issues_returned;
  const issues_next_offset = next < issues_total_matching ? next : null;
  const issues_truncated = issues_offset > 0 || issues_next_offset != null;

  return {
    issues: page.map((row) => toOutputIssue(row, options.contentRoot)),
    issues_truncated,
    issues_returned,
    issues_total_matching,
    issues_offset,
    issues_limit,
    issues_next_offset,
    issues_by_code: buildByCode(matching),
  };
}

/** Spread into MCP ok() payloads for diagnostics issue work queue fields. */
export function diagnosticsIssueQueueFields(
  queue: DiagnosticsIssueQueueResult,
): Record<string, unknown> {
  return {
    issues: queue.issues,
    issues_truncated: queue.issues_truncated,
    issues_returned: queue.issues_returned,
    issues_total_matching: queue.issues_total_matching,
    issues_offset: queue.issues_offset,
    issues_limit: queue.issues_limit,
    issues_next_offset: queue.issues_next_offset,
    issues_by_code: queue.issues_by_code,
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
  issues_next_offset: number | null;
}): DiagnosticsIssuePageNextAction | null {
  if (opts.issues_next_offset == null) return null;
  return {
    tool: opts.tool,
    reason:
      "Fetch the next page of the issues work queue (issues_offset paginates the issue list only).",
    args_hint: {
      ...opts.args_hint,
      issues_offset: opts.issues_next_offset,
    },
    priority: "recommended",
  };
}
