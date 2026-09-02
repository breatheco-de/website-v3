import { describe, expect, it } from "vitest";
import {
  CSV_BOM,
  RUNTIME_ISSUES_CSV_HEADERS,
  buildRuntimeIssuesCsv,
  csvEscape,
  formatOtherParamsForCsv,
  runtimeIssuesCsvFilename,
  type RuntimeIssueCsvRow,
} from "./runtime-issues-csv";

function row(overrides: Partial<RuntimeIssueCsvRow> = {}): RuntimeIssueCsvRow {
  return {
    fingerprint: "http.not_found|site|en|/en/pricing",
    kind: "http.not_found",
    path: "/en/pricing",
    locale: "en",
    count: 12,
    firstSeen: Date.UTC(2026, 7, 1, 10, 0, 0),
    lastSeen: Date.UTC(2026, 7, 13, 15, 30, 0),
    sampleReferrer: "https://google.com/search",
    uaBucket: "desktop",
    hostname: "4geeks.com",
    likelyBot: false,
    ...overrides,
  };
}

describe("csvEscape", () => {
  it("leaves simple values unquoted", () => {
    expect(csvEscape("/en/pricing")).toBe("/en/pricing");
    expect(csvEscape(12)).toBe("12");
    expect(csvEscape(false)).toBe("false");
  });

  it("quotes commas, quotes, and newlines and doubles inner quotes", () => {
    expect(csvEscape("a,b")).toBe('"a,b"');
    expect(csvEscape('say "hi"')).toBe('"say ""hi"""');
    expect(csvEscape("line1\nline2")).toBe('"line1\nline2"');
  });

  it("treats undefined as empty", () => {
    expect(csvEscape(undefined)).toBe("");
  });
});

describe("runtimeIssuesCsvFilename", () => {
  it("uses site, UTC date, tz, and 7d suffix", () => {
    expect(
      runtimeIssuesCsvFilename("site_4geeks-com", new Date("2026-08-13T23:00:00.000Z"), {
        tz: "UTC",
      }),
    ).toBe("runtime-issues-site_4geeks-com-2026-08-13-UTC.csv");
    expect(
      runtimeIssuesCsvFilename("site_4geeks-com", new Date("2026-08-13T23:00:00.000Z"), {
        windowDays: 7,
        tz: "America/Bogota",
      }),
    ).toBe("runtime-issues-site_4geeks-com-2026-08-13-America-Bogota-7d.csv");
  });
});

describe("buildRuntimeIssuesCsv", () => {
  it("starts with a UTF-8 BOM and the expected header", () => {
    const csv = buildRuntimeIssuesCsv([]);
    expect(csv.startsWith(CSV_BOM)).toBe(true);
    expect(csv.slice(CSV_BOM.length)).toBe(RUNTIME_ISSUES_CSV_HEADERS.join(","));
  });

  it("maps one row to the expected columns", () => {
    const csv = buildRuntimeIssuesCsv([row()]);
    const body = csv.slice(CSV_BOM.length);
    const [header, data] = body.split("\n");
    expect(header).toBe(RUNTIME_ISSUES_CSV_HEADERS.join(","));
    expect(data).toBe(
      [
        "/en/pricing",
        "en",
        "12",
        "12",
        "30",
        "",
        "2026-08-13T15:30:00.000Z",
        "2026-08-01T10:00:00.000Z",
        "https://google.com/search",
        "",
        "",
        "",
        "",
        "desktop",
        "",
        "http.not_found",
        "false",
        "4geeks.com",
        "http.not_found|site|en|/en/pricing",
        "",
        "",
        "",
        "",
        "",
      ].join(","),
    );
  });

  it("writes query attribution columns", () => {
    const csv = buildRuntimeIssuesCsv([
      row({
        queryAttribution: {
          source: ["meta"],
          medium: ["paid"],
          campaign: ["q1", "q2"],
          other: { gclid: ["abc"], utm_content: ["hero"] },
        },
      }),
    ]);
    const data = csv.slice(CSV_BOM.length).split("\n")[1];
    expect(data).toContain("meta");
    expect(data).toContain("paid");
    expect(data).toContain("q1;q2");
    expect(data).toContain("utm_content=hero;gclid=abc");
  });

  it("formatOtherParamsForCsv sorts utm_* keys first", () => {
    expect(
      formatOtherParamsForCsv({
        gclid: ["abc"],
        utm_content: ["hero"],
        ref: ["x"],
      }),
    ).toBe("utm_content=hero;gclid=abc;ref=x");
  });

  it("writes probe status and destination for a successful redirect", () => {
    const csv = buildRuntimeIssuesCsv([
      row({
        lastProbe: {
          at: Date.UTC(2026, 7, 14, 12, 0, 0),
          status: "redirect",
          destination: "/us/hello",
          chained: true,
          hops: ["/en/pricing", "/mid", "/us/hello"],
          httpStatus: 200,
        },
      }),
    ]);
    const data = csv.slice(CSV_BOM.length).split("\n")[1];
    expect(data.endsWith(",redirect,/us/hello,true,200,2026-08-14T12:00:00.000Z")).toBe(true);
  });

  it("writes not_found with last_test_at and empty destination", () => {
    const csv = buildRuntimeIssuesCsv([
      row({
        lastProbe: {
          at: Date.UTC(2026, 7, 14, 12, 0, 0),
          status: "not_found",
          httpStatus: 404,
        },
      }),
    ]);
    const data = csv.slice(CSV_BOM.length).split("\n")[1];
    expect(data.endsWith(",not_found,,false,404,2026-08-14T12:00:00.000Z")).toBe(true);
  });

  it("escapes a path that contains a comma", () => {
    const csv = buildRuntimeIssuesCsv([row({ path: "/en/foo,bar" })]);
    const data = csv.slice(CSV_BOM.length).split("\n")[1];
    expect(data.startsWith('"/en/foo,bar",')).toBe(true);
  });
});
