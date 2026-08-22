import { describe, expect, it } from "vitest";
import {
  buildDiagnosticsIssueQueue,
  cacheIssueRowsToQueueInput,
  clampIssuesLimit,
  diagnosticsIssuePageNextAction,
  diagnosticsIssueQueueFields,
  diversifyRoundRobinByCode,
  flattenIssuesBySlug,
  truncateIssueText,
  type DiagnosticsQueueInputRow,
} from "./diagnostics-issue-queue";

function row(
  partial: Partial<DiagnosticsQueueInputRow> & Pick<DiagnosticsQueueInputRow, "code" | "severity">,
): DiagnosticsQueueInputRow {
  return {
    id: partial.id ?? `${partial.severity}-${partial.code}-${partial.url ?? "x"}`,
    message: partial.message ?? `${partial.code} message`,
    category: partial.category ?? "seo",
    ...partial,
  };
}

describe("diagnostics-issue-queue", () => {
  it("clamps limit to 1..50 and truncates long text", () => {
    expect(clampIssuesLimit(undefined)).toBe(50);
    expect(clampIssuesLimit(0)).toBe(1);
    expect(clampIssuesLimit(999)).toBe(50);
    expect(truncateIssueText("a".repeat(250))!.endsWith("…")).toBe(true);
    expect(truncateIssueText("a".repeat(250))!.length).toBe(200);
  });

  it("returns full list when total fits one page", () => {
    const rows = Array.from({ length: 20 }, (_, i) =>
      row({ code: `C${i}`, severity: i % 2 === 0 ? "error" : "warning", url: `/p/${i}` }),
    );
    const q = buildDiagnosticsIssueQueue(rows, { issues_limit: 50, issues_offset: 0 });
    expect(q.issues_truncated).toBe(false);
    expect(q.issues_next_offset).toBeNull();
    expect(q.issues_returned).toBe(20);
    expect(q.issues_total_matching).toBe(20);
  });

  it("paginates 200 rows into pages of 50 with errors first", () => {
    const rows: DiagnosticsQueueInputRow[] = [];
    for (let i = 0; i < 100; i++) {
      rows.push(row({ code: "WARN_A", severity: "warning", url: `/w/${i}` }));
    }
    for (let i = 0; i < 100; i++) {
      rows.push(row({ code: "ERR_A", severity: "error", url: `/e/${i}` }));
    }
    const page0 = buildDiagnosticsIssueQueue(rows, { issues_offset: 0, issues_limit: 50 });
    expect(page0.issues_returned).toBe(50);
    expect(page0.issues_total_matching).toBe(200);
    expect(page0.issues_truncated).toBe(true);
    expect(page0.issues_next_offset).toBe(50);
    expect(page0.issues.every((i) => i.severity === "error")).toBe(true);

    const page1 = buildDiagnosticsIssueQueue(rows, { issues_offset: 50, issues_limit: 50 });
    expect(page1.issues_offset).toBe(50);
    expect(page1.issues_returned).toBe(50);
    expect(page1.issues_next_offset).toBe(100);
    expect(page1.issues_truncated).toBe(true);
  });

  it("round-robin diversifies codes on page 0 without dropping rows", () => {
    const rows: DiagnosticsQueueInputRow[] = [];
    for (let i = 0; i < 30; i++) rows.push(row({ code: "A", severity: "error", url: `/a/${i}` }));
    for (let i = 0; i < 30; i++) rows.push(row({ code: "B", severity: "error", url: `/b/${i}` }));
    for (let i = 0; i < 30; i++) rows.push(row({ code: "C", severity: "error", url: `/c/${i}` }));
    const diversified = diversifyRoundRobinByCode([...rows].sort((a, b) => a.code.localeCompare(b.code)));
    expect(diversified.length).toBe(90);
    expect(diversified.slice(0, 3).map((r) => r.code)).toEqual(["A", "B", "C"]);

    const page0 = buildDiagnosticsIssueQueue(rows, { issues_limit: 50 });
    const codesOnPage = new Set(page0.issues.map((i) => i.code));
    expect(codesOnPage.has("A")).toBe(true);
    expect(codesOnPage.has("B")).toBe(true);
    expect(codesOnPage.has("C")).toBe(true);
    expect(page0.issues_total_matching).toBe(90);
  });

  it("filters by severity, category, codes, and slugs", () => {
    const rows = [
      row({ code: "X", severity: "error", category: "seo", slug: "home", url: "/en/home" }),
      row({ code: "Y", severity: "warning", category: "seo", slug: "home", url: "/en/home" }),
      row({ code: "Z", severity: "error", category: "content", slug: "other", url: "/en/other" }),
    ];
    expect(buildDiagnosticsIssueQueue(rows, { severity: "error" }).issues_total_matching).toBe(2);
    expect(buildDiagnosticsIssueQueue(rows, { category: "seo" }).issues_total_matching).toBe(2);
    expect(buildDiagnosticsIssueQueue(rows, { codes: ["X"] }).issues.map((i) => i.code)).toEqual(["X"]);
    expect(buildDiagnosticsIssueQueue(rows, { slugs: ["home"] }).issues_total_matching).toBe(2);
  });

  it("builds issues_by_code counts from full matching set", () => {
    const rows = [
      ...Array.from({ length: 10 }, (_, i) => row({ code: "A", severity: "error", url: `/a/${i}` })),
      ...Array.from({ length: 3 }, (_, i) => row({ code: "B", severity: "warning", url: `/b/${i}` })),
    ];
    const q = buildDiagnosticsIssueQueue(rows);
    expect(q.issues_by_code[0]).toMatchObject({ code: "A", severity: "error", count: 10 });
    expect(q.issues_by_code[1]).toMatchObject({ code: "B", severity: "warning", count: 3 });
  });

  it("maps cache rows and skips completed; flattens issuesBySlug without ids", () => {
    const mapped = cacheIssueRowsToQueueInput([
      {
        id: "1",
        url: "/en/home",
        entryKey: "page/home/en",
        severity: "error",
        code: "MISSING_OG",
        message: "missing",
        category: "seo",
      },
      {
        id: "2",
        url: "/en/home",
        entryKey: "page/home/en",
        severity: "warning",
        code: "SOFT",
        message: "soft",
        completed: { by: "x", at: "y" },
      },
    ]);
    expect(mapped).toHaveLength(1);
    expect(mapped[0]!.slug).toBe("home");
    expect(mapped[0]!.id).toBe("1");

    const flat = flattenIssuesBySlug({
      home: [{ code: "MISSING_OG", message: "m", severity: "error", category: "seo" }],
    });
    expect(flat[0]!.id).toBeUndefined();
    expect(flat[0]!.slug).toBe("home");
  });

  it("diagnosticsIssueQueueFields exposes work queue meta without issuesBySlug", () => {
    const queue = buildDiagnosticsIssueQueue([
      row({ code: "A", severity: "error", url: "/a" }),
    ]);
    const fields = diagnosticsIssueQueueFields(queue);
    expect(fields).not.toHaveProperty("issuesBySlug");
    expect(fields).toMatchObject({
      issues: expect.any(Array),
      issues_truncated: false,
      issues_returned: 1,
      issues_total_matching: 1,
      issues_offset: 0,
      issues_limit: 50,
      issues_next_offset: null,
      issues_by_code: expect.any(Array),
    });
  });

  it("diagnosticsIssuePageNextAction returns declarative pagination hint", () => {
    const action = diagnosticsIssuePageNextAction({
      tool: "get_diagnostics_job",
      args_hint: { job_id: "diag-1" },
      issues_next_offset: 50,
    });
    expect(action).toMatchObject({
      tool: "get_diagnostics_job",
      priority: "recommended",
      args_hint: { job_id: "diag-1", issues_offset: 50 },
    });
    expect(action!.reason).toContain("issues_offset");
    expect(diagnosticsIssuePageNextAction({
      tool: "get_diagnostics_job",
      args_hint: {},
      issues_next_offset: null,
    })).toBeNull();
  });
});
