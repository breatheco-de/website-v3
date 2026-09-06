import { describe, expect, it } from "vitest";
import {
  CSV_BOM,
  GLOBAL_HEALTH_ISSUES_CSV_HEADERS,
  GLOBAL_HEALTH_RESOLVED_CSV_HEADERS,
  buildGlobalHealthIssuesCsv,
  buildGlobalHealthResolvedCsv,
  csvEscape,
  globalHealthIssuesCsvFilename,
  globalHealthResolvedCsvFilename,
  type GlobalHealthIssueCsvRow,
  type GlobalHealthResolvedCsvRow,
} from "./global-health-csv";

function issue(overrides: Partial<GlobalHealthIssueCsvRow> = {}): GlobalHealthIssueCsvRow {
  return {
    url: "/en/home",
    severity: "error",
    code: "MISSING_META",
    message: "Missing meta title",
    validator: "meta",
    category: "seo",
    file: "site_x/pages/home.yml",
    entryKey: "page:home:en",
    suggestion: "Add title",
    lastFullRunAt: "2026-09-01T12:00:00.000Z",
    attempts: [{ by: "a" }],
    ...overrides,
  };
}

function resolved(overrides: Partial<GlobalHealthResolvedCsvRow> = {}): GlobalHealthResolvedCsvRow {
  return {
    issueId: "iss-1",
    url: "/en/home",
    severity: "warning",
    code: "SOFT",
    message: "Soft issue",
    validator: "meta",
    category: "seo",
    file: "f.yml",
    entryKey: "page:home:en",
    suggestion: "Fix it",
    resolvedAt: "2026-09-02T12:00:00.000Z",
    resolvedBy: "staff@x.com",
    resolution: "verified_gone",
    ...overrides,
  };
}

describe("csvEscape", () => {
  it("leaves plain values alone", () => {
    expect(csvEscape("/en/pricing")).toBe("/en/pricing");
    expect(csvEscape(12)).toBe("12");
  });

  it("quotes commas quotes and newlines", () => {
    expect(csvEscape("a,b")).toBe('"a,b"');
    expect(csvEscape('say "hi"')).toBe('"say ""hi"""');
    expect(csvEscape("line1\nline2")).toBe('"line1\nline2"');
  });

  it("maps nullish to empty", () => {
    expect(csvEscape(undefined)).toBe("");
  });
});

describe("filenames", () => {
  it("uses ISO date", () => {
    const d = new Date("2026-09-06T15:00:00.000Z");
    expect(globalHealthIssuesCsvFilename(d)).toBe("global-health-issues-2026-09-06.csv");
    expect(globalHealthResolvedCsvFilename(d)).toBe("global-health-resolved-2026-09-06.csv");
  });
});

describe("buildGlobalHealthIssuesCsv", () => {
  it("includes BOM and header", () => {
    const csv = buildGlobalHealthIssuesCsv([]);
    expect(csv.startsWith(CSV_BOM)).toBe(true);
    expect(csv.slice(CSV_BOM.length)).toBe(GLOBAL_HEALTH_ISSUES_CSV_HEADERS.join(","));
  });

  it("serializes a row with attempt count", () => {
    const csv = buildGlobalHealthIssuesCsv([issue()]);
    const data = csv.slice(CSV_BOM.length).split("\n")[1];
    expect(data).toContain("/en/home");
    expect(data).toContain("MISSING_META");
    expect(data?.endsWith(",1")).toBe(true);
  });

  it("escapes commas in message", () => {
    const csv = buildGlobalHealthIssuesCsv([issue({ message: "a,b" })]);
    const data = csv.slice(CSV_BOM.length).split("\n")[1];
    expect(data).toContain('"a,b"');
  });
});

describe("buildGlobalHealthResolvedCsv", () => {
  it("includes BOM and header", () => {
    const csv = buildGlobalHealthResolvedCsv([]);
    expect(csv.startsWith(CSV_BOM)).toBe(true);
    expect(csv.slice(CSV_BOM.length)).toBe(GLOBAL_HEALTH_RESOLVED_CSV_HEADERS.join(","));
  });

  it("serializes a resolved row", () => {
    const csv = buildGlobalHealthResolvedCsv([resolved()]);
    const data = csv.slice(CSV_BOM.length).split("\n")[1];
    expect(data).toContain("iss-1");
    expect(data).toContain("verified_gone");
    expect(data).toContain("staff@x.com");
  });
});
