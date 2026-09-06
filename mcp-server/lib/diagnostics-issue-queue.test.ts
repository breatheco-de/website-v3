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

  it("returns full open list when total fits one page", () => {
    const rows = Array.from({ length: 20 }, (_, i) =>
      row({ code: `C${i}`, severity: i % 2 === 0 ? "error" : "warning", url: `/p/${i}` }),
    );
    const q = buildDiagnosticsIssueQueue(rows, { open_issues_limit: 50, open_issues_offset: 0 });
    expect(q.open_issues_truncated).toBe(false);
    expect(q.open_issues_next_offset).toBeNull();
    expect(q.open_issues_returned).toBe(20);
    expect(q.open_issues_total_matching).toBe(20);
    expect(q.open_count).toBe(20);
    expect(q.issue_status).toBe("open");
    expect(q.open_issues.every((i) => i.status === "open")).toBe(true);
  });

  it("paginates 200 rows into pages of 50 with errors first", () => {
    const rows: DiagnosticsQueueInputRow[] = [];
    for (let i = 0; i < 100; i++) {
      rows.push(row({ code: "WARN_A", severity: "warning", url: `/w/${i}` }));
    }
    for (let i = 0; i < 100; i++) {
      rows.push(row({ code: "ERR_A", severity: "error", url: `/e/${i}` }));
    }
    const page0 = buildDiagnosticsIssueQueue(rows, { open_issues_offset: 0, open_issues_limit: 50 });
    expect(page0.open_issues_returned).toBe(50);
    expect(page0.open_issues_total_matching).toBe(200);
    expect(page0.open_issues_truncated).toBe(true);
    expect(page0.open_issues_next_offset).toBe(50);
    expect(page0.open_issues.every((i) => i.severity === "error")).toBe(true);

    const page1 = buildDiagnosticsIssueQueue(rows, { open_issues_offset: 50, open_issues_limit: 50 });
    expect(page1.open_issues_offset).toBe(50);
    expect(page1.open_issues_returned).toBe(50);
    expect(page1.open_issues_next_offset).toBe(100);
    expect(page1.open_issues_truncated).toBe(true);
  });

  it("round-robin diversifies codes on page 0 without dropping rows", () => {
    const rows: DiagnosticsQueueInputRow[] = [];
    for (let i = 0; i < 30; i++) rows.push(row({ code: "A", severity: "error", url: `/a/${i}` }));
    for (let i = 0; i < 30; i++) rows.push(row({ code: "B", severity: "error", url: `/b/${i}` }));
    for (let i = 0; i < 30; i++) rows.push(row({ code: "C", severity: "error", url: `/c/${i}` }));
    const diversified = diversifyRoundRobinByCode([...rows].sort((a, b) => a.code.localeCompare(b.code)));
    expect(diversified.length).toBe(90);
    expect(diversified.slice(0, 3).map((r) => r.code)).toEqual(["A", "B", "C"]);

    const page0 = buildDiagnosticsIssueQueue(rows, { open_issues_limit: 50 });
    const codesOnPage = new Set(page0.open_issues.map((i) => i.code));
    expect(codesOnPage.has("A")).toBe(true);
    expect(codesOnPage.has("B")).toBe(true);
    expect(codesOnPage.has("C")).toBe(true);
    expect(page0.open_issues_total_matching).toBe(90);
  });

  it("filters by severity, category, codes, and slugs", () => {
    const rows = [
      row({ code: "X", severity: "error", category: "seo", slug: "home", url: "/en/home" }),
      row({ code: "Y", severity: "warning", category: "seo", slug: "home", url: "/en/home" }),
      row({ code: "Z", severity: "error", category: "content", slug: "other", url: "/en/other" }),
    ];
    expect(buildDiagnosticsIssueQueue(rows, { severity: "error" }).open_issues_total_matching).toBe(2);
    expect(buildDiagnosticsIssueQueue(rows, { category: "seo" }).open_issues_total_matching).toBe(2);
    expect(buildDiagnosticsIssueQueue(rows, { codes: ["X"] }).open_issues.map((i) => i.code)).toEqual(["X"]);
    expect(buildDiagnosticsIssueQueue(rows, { slugs: ["home"] }).open_issues_total_matching).toBe(2);
  });

  it("builds open_issues_by_code counts from the matching primary set", () => {
    const rows = [
      ...Array.from({ length: 10 }, (_, i) => row({ code: "A", severity: "error", url: `/a/${i}` })),
      ...Array.from({ length: 3 }, (_, i) => row({ code: "B", severity: "warning", url: `/b/${i}` })),
    ];
    const q = buildDiagnosticsIssueQueue(rows);
    expect(q.open_issues_by_code[0]).toMatchObject({ code: "A", severity: "error", count: 10 });
    expect(q.open_issues_by_code[1]).toMatchObject({ code: "B", severity: "warning", count: 3 });
  });

  it("maps cache rows with overlays; default open queue skips completed and other claims", () => {
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
        completed: { by: "x", at: "2026-01-01T00:00:00.000Z" },
      },
      {
        id: "3",
        url: "/en/home",
        entryKey: "page/home/en",
        severity: "error",
        code: "CLAIMED",
        message: "claimed",
        claimed: { by: "alice", at: "2026-01-01T00:00:00.000Z", expiresAt: "2099-01-01T00:00:00.000Z" },
      },
    ]);
    expect(mapped).toHaveLength(3);
    expect(mapped[0]!.slug).toBe("home");

    const openQ = buildDiagnosticsIssueQueue(mapped, { viewerAuthor: "bob" });
    expect(openQ.open_issues.map((i) => i.id)).toEqual(["1"]);
    expect(openQ.open_count).toBe(1);
    expect(openQ.claimed_by_others_count).toBe(1);
    expect(openQ.completed_count).toBe(1);
    expect(openQ.open_issues_total_matching).toBe(1);

    const flat = flattenIssuesBySlug({
      home: [{ code: "MISSING_OG", message: "m", severity: "error", category: "seo" }],
    });
    expect(flat[0]!.id).toBeUndefined();
    expect(flat[0]!.slug).toBe("home");
  });

  it("keeps own claims in open_issues and exposes claimed_by_me", () => {
    const rows = [
      row({
        id: "mine",
        code: "A",
        severity: "error",
        url: "/a",
        claimed: { by: "bob", at: "t", expiresAt: "2099-01-01T00:00:00.000Z" },
      }),
      row({
        id: "theirs",
        code: "B",
        severity: "error",
        url: "/b",
        claimed: { by: "alice", at: "t", expiresAt: "2099-01-01T00:00:00.000Z" },
      }),
    ];
    const q = buildDiagnosticsIssueQueue(rows, { viewerAuthor: "bob" });
    expect(q.open_issues.map((i) => i.id)).toEqual(["mine"]);
    expect(q.open_issues[0]!.claimed_by_me).toBe(true);
    expect(q.open_issues[0]!.status).toBe("open");
    expect(q.claimed_by_others_count).toBe(1);

    const claimedOnly = buildDiagnosticsIssueQueue(rows, {
      viewerAuthor: "bob",
      issue_status: "claimed",
    });
    expect(claimedOnly.open_issues).toEqual([]);
    expect(claimedOnly.claimed_issues.map((i) => i.id)).toEqual(["theirs"]);
    expect(claimedOnly.open_issues_total_matching).toBe(1);
    expect(claimedOnly.claimed_issues[0]!.status).toBe("claimed");
  });

  it("issue_status completed and all return sibling arrays with status on every row", () => {
    const rows = [
      row({ id: "o", code: "O", severity: "error", url: "/o" }),
      row({
        id: "c",
        code: "C",
        severity: "warning",
        url: "/c",
        completed: { by: "x", at: "2026-01-02T00:00:00.000Z" },
      }),
      row({
        id: "k",
        code: "K",
        severity: "error",
        url: "/k",
        claimed: { by: "alice", at: "t", expiresAt: "2099-01-01T00:00:00.000Z" },
      }),
    ];
    const completed = buildDiagnosticsIssueQueue(rows, {
      viewerAuthor: "bob",
      issue_status: "completed",
    });
    expect(completed.completed_issues.map((i) => i.id)).toEqual(["c"]);
    expect(completed.completed_issues[0]!.status).toBe("completed");
    expect(completed.completed_issues[0]!.completed_by).toBe("x");
    expect(completed.open_issues).toEqual([]);
    expect(completed.open_issues_total_matching).toBe(1);

    const all = buildDiagnosticsIssueQueue(rows, {
      viewerAuthor: "bob",
      issue_status: "all",
    });
    expect(all.open_issues.map((i) => i.id)).toEqual(["o"]);
    expect(all.claimed_issues.map((i) => i.id)).toEqual(["k"]);
    expect(all.completed_issues.map((i) => i.id)).toEqual(["c"]);
    expect(all.open_count).toBe(1);
    expect(all.claimed_by_others_count).toBe(1);
    expect(all.completed_count).toBe(1);
    expect([...all.open_issues, ...all.claimed_issues, ...all.completed_issues].every((i) => i.status)).toBe(
      true,
    );
  });

  it("diagnosticsIssueQueueFields exposes open_issues work queue meta without issuesBySlug", () => {
    const queue = buildDiagnosticsIssueQueue([
      row({ code: "A", severity: "error", url: "/a" }),
    ]);
    const fields = diagnosticsIssueQueueFields(queue);
    expect(fields).not.toHaveProperty("issuesBySlug");
    expect(fields).not.toHaveProperty("issues");
    expect(fields).toMatchObject({
      open_issues: expect.any(Array),
      claimed_issues: [],
      completed_issues: [],
      open_count: 1,
      claimed_by_others_count: 0,
      completed_count: 0,
      open_issues_truncated: false,
      open_issues_returned: 1,
      open_issues_total_matching: 1,
      open_issues_offset: 0,
      open_issues_limit: 50,
      open_issues_next_offset: null,
      open_issues_by_code: expect.any(Array),
      issue_status: "open",
    });
  });

  it("diagnosticsIssuePageNextAction returns declarative pagination hint", () => {
    const action = diagnosticsIssuePageNextAction({
      tool: "get_diagnostics_job",
      args_hint: { job_id: "diag-1" },
      open_issues_next_offset: 50,
    });
    expect(action).toMatchObject({
      tool: "get_diagnostics_job",
      priority: "recommended",
      args_hint: { job_id: "diag-1", open_issues_offset: 50 },
    });
    expect(action!.reason).toContain("open_issues_offset");
    expect(
      diagnosticsIssuePageNextAction({
        tool: "get_diagnostics_job",
        args_hint: {},
        open_issues_next_offset: null,
      }),
    ).toBeNull();
  });
});
