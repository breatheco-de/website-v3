export const CSV_BOM = "\uFEFF";

export const GLOBAL_HEALTH_ISSUES_CSV_HEADERS = [
  "url",
  "severity",
  "code",
  "message",
  "validator",
  "category",
  "file",
  "entryKey",
  "suggestion",
  "lastFullRunAt",
  "attempts",
] as const;

export const GLOBAL_HEALTH_RESOLVED_CSV_HEADERS = [
  "issueId",
  "url",
  "severity",
  "code",
  "message",
  "validator",
  "category",
  "file",
  "entryKey",
  "suggestion",
  "resolvedAt",
  "resolvedBy",
  "resolution",
  "reopenedAt",
] as const;

export interface GlobalHealthIssueCsvRow {
  url: string;
  severity: string;
  code: string;
  message: string;
  validator?: string;
  category?: string;
  file?: string;
  entryKey?: string;
  suggestion?: string;
  lastFullRunAt?: string;
  attempts?: Array<unknown>;
}

export interface GlobalHealthResolvedCsvRow {
  issueId: string;
  url?: string;
  severity: string;
  code: string;
  message: string;
  validator?: string;
  category?: string;
  file?: string;
  entryKey: string;
  suggestion?: string;
  resolvedAt: string;
  resolvedBy: string;
  resolution?: string;
  reopenedAt?: string;
}

export function csvEscape(value: string | number | boolean | undefined): string {
  const s = value == null ? "" : String(value);
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

export function globalHealthIssuesCsvFilename(now = new Date()): string {
  return `global-health-issues-${now.toISOString().slice(0, 10)}.csv`;
}

export function globalHealthResolvedCsvFilename(now = new Date()): string {
  return `global-health-resolved-${now.toISOString().slice(0, 10)}.csv`;
}

export function buildGlobalHealthIssuesCsv(rows: GlobalHealthIssueCsvRow[]): string {
  const lines = [
    GLOBAL_HEALTH_ISSUES_CSV_HEADERS.join(","),
    ...rows.map((r) =>
      [
        r.url,
        r.severity,
        r.code,
        r.message,
        r.validator ?? "",
        r.category ?? "",
        r.file ?? "",
        r.entryKey ?? "",
        r.suggestion ?? "",
        r.lastFullRunAt ?? "",
        r.attempts?.length ?? 0,
      ]
        .map(csvEscape)
        .join(","),
    ),
  ];
  return CSV_BOM + lines.join("\n");
}

export function buildGlobalHealthResolvedCsv(rows: GlobalHealthResolvedCsvRow[]): string {
  const lines = [
    GLOBAL_HEALTH_RESOLVED_CSV_HEADERS.join(","),
    ...rows.map((r) =>
      [
        r.issueId,
        r.url ?? "",
        r.severity,
        r.code,
        r.message,
        r.validator ?? "",
        r.category ?? "",
        r.file ?? "",
        r.entryKey,
        r.suggestion ?? "",
        r.resolvedAt,
        r.resolvedBy,
        r.resolution ?? "",
        r.reopenedAt ?? "",
      ]
        .map(csvEscape)
        .join(","),
    ),
  ];
  return CSV_BOM + lines.join("\n");
}

function triggerCsvDownload(filename: string, csv: string): void {
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export function downloadGlobalHealthIssuesCsv(
  rows: GlobalHealthIssueCsvRow[],
  now = new Date(),
): void {
  triggerCsvDownload(globalHealthIssuesCsvFilename(now), buildGlobalHealthIssuesCsv(rows));
}

export function downloadGlobalHealthResolvedCsv(
  rows: GlobalHealthResolvedCsvRow[],
  now = new Date(),
): void {
  triggerCsvDownload(globalHealthResolvedCsvFilename(now), buildGlobalHealthResolvedCsv(rows));
}
