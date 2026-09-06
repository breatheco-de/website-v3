import { describe, it, expect, afterEach } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";
import {
  ResolvedIssuesArchiveService,
  STAFF_DEFAULT_REPORT,
  issueToArchiveRow,
  pruneArchiveRows,
  ARCHIVE_RETENTION_MS,
  ARCHIVE_MAX_ROWS,
} from "./resolvedIssuesArchiveService";
import type { ResolvedIssueArchiveRow, StoredValidationIssue } from "../../scripts/validation/shared/types";

function tempRoot(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "resolved-archive-"));
}

function sampleIssue(id: string, entryKey = "page/home/en"): StoredValidationIssue {
  return {
    id,
    code: "TEST_CODE",
    severity: "error",
    message: "Test message",
    validator: "meta",
    scopes: ["entry"],
    targets: [{ type: "entry", entryKey, url: "/en/home" }],
    lastSeenAt: new Date().toISOString(),
    lastRunAt: new Date().toISOString(),
  };
}

function archiveRow(id: string, resolvedAt: string): ResolvedIssueArchiveRow {
  return issueToArchiveRow(sampleIssue(id), {
    resolvedBy: "agent",
    resolvedAt,
    resolution: "verified_gone",
  });
}

describe("pruneArchiveRows", () => {
  const now = Date.parse("2026-09-06T12:00:00.000Z");

  it("drops rows older than retention window", () => {
    const fresh = archiveRow("fresh", new Date(now - 10 * 24 * 60 * 60 * 1000).toISOString());
    const stale = archiveRow("stale", new Date(now - 61 * 24 * 60 * 60 * 1000).toISOString());
    const { rows, prunedByAge, prunedByCap } = pruneArchiveRows([fresh, stale], {
      now,
      retentionMs: ARCHIVE_RETENTION_MS,
    });
    expect(prunedByAge).toBe(1);
    expect(prunedByCap).toBe(0);
    expect(rows.map((r) => r.issueId)).toEqual(["fresh"]);
  });

  it("keeps rows inside the retention window", () => {
    const edge = archiveRow(
      "edge",
      new Date(now - ARCHIVE_RETENTION_MS + 1000).toISOString(),
    );
    const { rows, prunedByAge } = pruneArchiveRows([edge], { now });
    expect(prunedByAge).toBe(0);
    expect(rows).toHaveLength(1);
  });

  it("drops invalid or missing resolvedAt as expired", () => {
    const bad = { ...archiveRow("bad", "not-a-date") };
    const { rows, prunedByAge } = pruneArchiveRows([bad], { now });
    expect(prunedByAge).toBe(1);
    expect(rows).toHaveLength(0);
  });

  it("applies safety cap after age prune (newest first)", () => {
    const rows = [
      archiveRow("n0", new Date(now - 1000).toISOString()),
      archiveRow("n1", new Date(now - 2000).toISOString()),
      archiveRow("n2", new Date(now - 3000).toISOString()),
      archiveRow("old", new Date(now - 90 * 24 * 60 * 60 * 1000).toISOString()),
    ];
    const result = pruneArchiveRows(rows, { now, maxRows: 2 });
    expect(result.prunedByAge).toBe(1);
    expect(result.prunedByCap).toBe(1);
    expect(result.rows.map((r) => r.issueId)).toEqual(["n0", "n1"]);
  });

  it("exports production safety cap of 40000", () => {
    expect(ARCHIVE_MAX_ROWS).toBe(40_000);
    expect(ARCHIVE_RETENTION_MS).toBe(60 * 24 * 60 * 60 * 1000);
  });
});

describe("ResolvedIssuesArchiveService", () => {
  const roots: string[] = [];

  afterEach(() => {
    for (const r of roots) {
      fs.rmSync(r, { recursive: true, force: true });
    }
  });

  it("appendResolved prepends row and applies staff default report", async () => {
    const root = tempRoot();
    roots.push(root);
    const archive = new ResolvedIssuesArchiveService(root);
    const issue = sampleIssue("issue-1");

    await archive.appendResolved(issue, {
      resolvedBy: "staff@example.com",
      resolution: "verified_gone",
    });

    const { rows } = archive.list({ entryKey: "page/home/en" });
    expect(rows).toHaveLength(1);
    expect(rows[0]!.report).toBe(STAFF_DEFAULT_REPORT);
    expect(rows[0]!.resolution).toBe("verified_gone");
  });

  it("prepends newest rows first", async () => {
    const root = tempRoot();
    roots.push(root);
    const archive = new ResolvedIssuesArchiveService(root);
    await archive.appendResolved(sampleIssue("older"), {
      resolvedBy: "agent",
      resolution: "verified_gone",
    });
    await archive.appendResolved(sampleIssue("newer"), {
      resolvedBy: "agent",
      resolution: "verified_gone",
    });
    const { rows } = archive.list();
    expect(rows[0]!.issueId).toBe("newer");
  });

  it("markReopened sets reopenedAt on most recent row for issueId", async () => {
    const root = tempRoot();
    roots.push(root);
    const archive = new ResolvedIssuesArchiveService(root);
    const issue = sampleIssue("issue-reopen");

    await archive.appendResolved(issue, {
      resolvedBy: "agent",
      resolution: "verified_gone",
    });
    await archive.appendResolved(issue, {
      resolvedBy: "agent",
      resolution: "verified_gone",
    });

    const marked = await archive.markReopened("issue-reopen");
    expect(marked).toBe(true);

    const { rows } = archive.list();
    const reopened = rows.filter((r) => r.issueId === "issue-reopen" && r.reopenedAt);
    expect(reopened).toHaveLength(1);
  });

  it("onOpenIssueInserted marks reopened when archive row exists", async () => {
    const root = tempRoot();
    roots.push(root);
    const archive = new ResolvedIssuesArchiveService(root);
    await archive.appendResolved(sampleIssue("issue-x"), {
      resolvedBy: "agent",
      resolution: "verified_gone",
    });

    archive.onOpenIssueInserted("issue-x");
    await archive.flush();

    const { rows } = archive.list();
    expect(rows[0]!.reopenedAt).toBeTruthy();
  });

  it("summary resolvedCount excludes reopened rows", async () => {
    const root = tempRoot();
    roots.push(root);
    const archive = new ResolvedIssuesArchiveService(root);
    await archive.appendResolved(sampleIssue("a"), {
      resolvedBy: "agent",
      resolution: "verified_gone",
    });
    await archive.appendResolved(sampleIssue("b"), {
      resolvedBy: "agent",
      resolution: "verified_gone",
    });
    await archive.markReopened("b");

    const summary = archive.summary();
    expect(summary.total).toBe(2);
    expect(summary.reopened).toBe(1);
    expect(summary.resolvedCount).toBe(1);
  });

  it("paginates list results", async () => {
    const root = tempRoot();
    roots.push(root);
    const archive = new ResolvedIssuesArchiveService(root);
    for (let i = 0; i < 5; i++) {
      await archive.appendResolved(sampleIssue(`p-${i}`), {
        resolvedBy: "agent",
        resolution: "verified_gone",
      });
    }
    const page = archive.list({ limit: 2, offset: 2 });
    expect(page.rows).toHaveLength(2);
    expect(page.total).toBe(5);
  });

  it("drops stale rows on load from disk", () => {
    const root = tempRoot();
    roots.push(root);
    const file = path.join(root, "validation-resolved-archive.json");
    const now = Date.now();
    const payload = {
      meta: { version: 1 as const },
      rows: [
        archiveRow("keep", new Date(now - 5 * 24 * 60 * 60 * 1000).toISOString()),
        archiveRow("gone", new Date(now - 90 * 24 * 60 * 60 * 1000).toISOString()),
      ],
    };
    fs.writeFileSync(file, JSON.stringify(payload, null, 2) + "\n", "utf-8");

    const archive = new ResolvedIssuesArchiveService(root);
    const { rows, summary } = archive.list();
    expect(rows.map((r) => r.issueId)).toEqual(["keep"]);
    expect(summary.total).toBe(1);

    const onDisk = JSON.parse(fs.readFileSync(file, "utf-8")) as { rows: { issueId: string }[] };
    expect(onDisk.rows.map((r) => r.issueId)).toEqual(["keep"]);
  });

  it("keeps in-window rows when appending a new resolve", async () => {
    const root = tempRoot();
    roots.push(root);
    const file = path.join(root, "validation-resolved-archive.json");
    const now = Date.now();
    fs.writeFileSync(
      file,
      JSON.stringify(
        {
          meta: { version: 1 },
          rows: [archiveRow("recent", new Date(now - 1 * 24 * 60 * 60 * 1000).toISOString())],
        },
        null,
        2,
      ) + "\n",
      "utf-8",
    );
    const archive = new ResolvedIssuesArchiveService(root);
    await archive.appendResolved(sampleIssue("new"), {
      resolvedBy: "agent",
      resolution: "verified_gone",
    });
    const ids = archive.list().rows.map((r) => r.issueId);
    expect(ids[0]).toBe("new");
    expect(ids).toContain("recent");
  });
});

describe("issueToArchiveRow", () => {
  it("maps stored issue fields", () => {
    const row = issueToArchiveRow(sampleIssue("id-1"), {
      resolvedBy: "claude",
      resolution: "soft_complete",
      report: "Fixed meta title",
    });
    expect(row.issueId).toBe("id-1");
    expect(row.entryKey).toBe("page/home/en");
    expect(row.url).toBe("/en/home");
    expect(row.report).toBe("Fixed meta title");
  });
});
