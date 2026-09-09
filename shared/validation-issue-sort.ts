/**
 * Shared sort helpers for validation issue lists (open MCP + resolved archive).
 */

export const OPEN_ISSUE_SORT_FIELDS = [
  "severity",
  "lastFullRunAt",
  "code",
  "url",
] as const;
export const RESOLVED_ISSUE_SORT_FIELDS = [
  "resolvedAt",
  "severity",
  "code",
  "url",
] as const;

export type OpenIssueSortField = (typeof OPEN_ISSUE_SORT_FIELDS)[number];
export type ResolvedIssueSortField = (typeof RESOLVED_ISSUE_SORT_FIELDS)[number];
export type IssuesSortDir = "asc" | "desc";
export type IssuesSortField = OpenIssueSortField | ResolvedIssueSortField;

function defaultSortForSet(set: "open" | "resolved"): IssuesSortField {
  return set === "open" ? "severity" : "resolvedAt";
}

function defaultDirForField(field: IssuesSortField): IssuesSortDir {
  if (field === "code" || field === "url") return "asc";
  return "desc";
}

export function parseIssuesSort(
  set: "open" | "resolved",
  sort?: string | null,
  sortDir?: string | null,
):
  | { ok: true; sort: IssuesSortField; sort_dir: IssuesSortDir }
  | { ok: false; error: string } {
  const allow = set === "open" ? OPEN_ISSUE_SORT_FIELDS : RESOLVED_ISSUE_SORT_FIELDS;
  const fieldRaw =
    sort == null || String(sort).trim() === ""
      ? defaultSortForSet(set)
      : String(sort).trim();
  if (!(allow as readonly string[]).includes(fieldRaw)) {
    return {
      ok: false,
      error: `Invalid sort '${fieldRaw}' for set=${set}. Allowed: ${allow.join(", ")}`,
    };
  }
  const field = fieldRaw as IssuesSortField;
  const dirRaw =
    sortDir == null || String(sortDir).trim() === ""
      ? defaultDirForField(field)
      : String(sortDir).trim();
  if (dirRaw !== "asc" && dirRaw !== "desc") {
    return {
      ok: false,
      error: `Invalid sort_dir '${dirRaw}'. Allowed: asc, desc`,
    };
  }
  return { ok: true, sort: field, sort_dir: dirRaw };
}

function severityRank(value: unknown): number {
  const s = String(value ?? "").toLowerCase();
  if (s === "error") return 3;
  if (s === "warning") return 2;
  if (s === "info") return 1;
  return 0;
}

function dateMs(value: unknown): number {
  if (value == null || value === "") return Number.NaN;
  if (typeof value === "number" && Number.isFinite(value)) return value;
  const ms = Date.parse(String(value));
  return Number.isNaN(ms) ? Number.NaN : ms;
}

function rowId(row: Record<string, unknown>): string {
  const id = row.id ?? row.issueId;
  return id == null ? "" : String(id);
}

/**
 * Sort issue rows. Null/missing date values always last (both dirs).
 * Tie-break by id. For open default severity desc, secondary lastFullRunAt desc.
 */
export function sortIssueRows<T extends Record<string, unknown>>(
  rows: T[],
  opts: {
    set: "open" | "resolved";
    sort: IssuesSortField;
    sort_dir: IssuesSortDir;
  },
): T[] {
  const factor = opts.sort_dir === "asc" ? 1 : -1;
  const field = opts.sort;

  return [...rows].sort((a, b) => {
    if (field === "severity") {
      const cmp = (severityRank(a.severity) - severityRank(b.severity)) * factor;
      if (cmp !== 0) return cmp;
      if (opts.set === "open") {
        const am = dateMs(a.lastFullRunAt);
        const bm = dateMs(b.lastFullRunAt);
        const aMissing = Number.isNaN(am);
        const bMissing = Number.isNaN(bm);
        if (!(aMissing && bMissing)) {
          if (aMissing) return 1;
          if (bMissing) return -1;
          const dateCmp = (am - bm) * -1;
          if (dateCmp !== 0) return dateCmp;
        }
      }
      return rowId(a).localeCompare(rowId(b));
    }

    if (field === "lastFullRunAt" || field === "resolvedAt") {
      const am = dateMs(a[field]);
      const bm = dateMs(b[field]);
      const aMissing = Number.isNaN(am);
      const bMissing = Number.isNaN(bm);
      if (aMissing && bMissing) return rowId(a).localeCompare(rowId(b));
      if (aMissing) return 1;
      if (bMissing) return -1;
      const cmp = (am - bm) * factor;
      if (cmp !== 0) return cmp;
      return rowId(a).localeCompare(rowId(b));
    }

    const as = String(a[field] ?? "");
    const bs = String(b[field] ?? "");
    const cmp = as.localeCompare(bs) * factor;
    if (cmp !== 0) return cmp;
    return rowId(a).localeCompare(rowId(b));
  });
}
