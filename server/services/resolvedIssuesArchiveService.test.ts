import { describe, it, expect, afterEach } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";
import {
  ResolvedIssuesArchiveService,
  STAFF_DEFAULT_REPORT,
  issueToArchiveRow,
} from "./resolvedIssuesArchiveService";
import type { StoredValidationIssue } from "../../scripts/validation/shared/types";

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
