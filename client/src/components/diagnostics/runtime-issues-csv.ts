export const RUNTIME_ISSUES_CSV_HEADERS = [
  "path",
  "locale",
  "count",
  "count_30",
  "window",
  "tz",
  "last_seen",
  "first_seen",
  "referrer",
  "utm_source",
  "utm_medium",
  "utm_campaign",
  "other_params",
  "ua",
  "sources",
  "kind",
  "likely_bot",
  "hostname",
  "fingerprint",
  "status",
  "destination",
  "chained",
  "http_status",
  "last_test_at",
] as const;

import type { RuntimeIssueProbe, RuntimeQueryAttribution } from "@shared/runtime-issues";
import { sortParamKeysForDisplay } from "@shared/runtime-issues";

export const CSV_BOM = "\uFEFF";

export interface RuntimeIssueCsvRow {
  fingerprint: string;
  kind: string;
  path: string;
  locale: string;
  count: number;
  count30?: number;
  firstSeen: number;
  lastSeen: number;
  sampleReferrer?: string;
  uaBucket?: string;
  hostname?: string;
  likelyBot?: boolean;
  sources?: string[];
  windowDays?: 7 | 30;
  tz?: string;
  lastProbe?: RuntimeIssueProbe;
  queryAttribution?: RuntimeQueryAttribution;
}

export function csvEscape(value: string | number | boolean | undefined): string {
  const s = value == null ? "" : String(value);
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

function sanitizeTzForFilename(tz: string): string {
  return tz.replace(/[^A-Za-z0-9_+-]+/g, "-") || "UTC";
}

export function runtimeIssuesCsvFilename(
  site: string,
  now = new Date(),
  opts?: { windowDays?: 7 | 30; tz?: string },
): string {
  const day = now.toISOString().slice(0, 10);
  const windowDays = opts?.windowDays ?? 30;
  const tzPart = sanitizeTzForFilename(opts?.tz || "UTC");
  if (windowDays === 7) {
    return `runtime-issues-${site}-${day}-${tzPart}-7d.csv`;
  }
  return `runtime-issues-${site}-${day}-${tzPart}.csv`;
}

export function formatOtherParamsForCsv(other: Record<string, string[]> | undefined): string {
  if (!other) return "";
  const keys = sortParamKeysForDisplay(Object.keys(other));
  return keys
    .flatMap((key) => (other[key] ?? []).map((value) => `${key}=${value}`))
    .join(";");
}

export function buildRuntimeIssuesCsv(rows: RuntimeIssueCsvRow[], meta?: { windowDays?: 7 | 30; tz?: string }): string {
  const windowDays = meta?.windowDays ?? rows[0]?.windowDays ?? 30;
  const tz = meta?.tz ?? rows[0]?.tz ?? "";
  const lines = [
    RUNTIME_ISSUES_CSV_HEADERS.join(","),
    ...rows.map((r) =>
      [
        r.path,
        r.locale,
        r.count,
        r.count30 ?? r.count,
        r.windowDays ?? windowDays,
        r.tz ?? tz,
        new Date(r.lastSeen).toISOString(),
        new Date(r.firstSeen).toISOString(),
        r.sampleReferrer ?? "",
        (r.queryAttribution?.source ?? []).join(";"),
        (r.queryAttribution?.medium ?? []).join(";"),
        (r.queryAttribution?.campaign ?? []).join(";"),
        formatOtherParamsForCsv(r.queryAttribution?.other),
        r.uaBucket ?? "",
        (r.sources ?? []).join("|"),
        r.kind,
        r.likelyBot ? "true" : "false",
        r.hostname ?? "",
        r.fingerprint,
        r.lastProbe?.status ?? "",
        r.lastProbe?.destination ?? "",
        r.lastProbe ? (r.lastProbe.chained ? "true" : "false") : "",
        r.lastProbe?.httpStatus ?? "",
        r.lastProbe ? new Date(r.lastProbe.at).toISOString() : "",
      ]
        .map(csvEscape)
        .join(","),
    ),
  ];
  return CSV_BOM + lines.join("\n");
}

export function downloadRuntimeIssuesCsv(
  site: string,
  rows: RuntimeIssueCsvRow[],
  meta?: { windowDays?: 7 | 30; tz?: string },
): void {
  const csv = buildRuntimeIssuesCsv(rows, meta);
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = runtimeIssuesCsvFilename(site, new Date(), meta);
  a.click();
  URL.revokeObjectURL(url);
}
