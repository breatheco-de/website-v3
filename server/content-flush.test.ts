import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  lastSyncedCommit: "abc" as string | null,
  files: {} as Record<string, { sha: string; lastModified: number; remoteSha?: string; author?: string }>,
  pending: new Map<string, Array<Record<string, unknown>>>(),
  enabled: true,
  conflicted: [] as string[],
  lastError: null as string | null,
  /** Files the fake flush pushes (removed from pending). */
  pushes: new Set<string>(),
  servicePushed: [] as string[],
}));

vi.mock("./sync-state", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./sync-state")>();
  return {
    ...actual,
    loadSyncState: () => ({ lastSyncedCommit: state.lastSyncedCommit, lastSyncedAt: null, files: state.files }),
    detectPendingChanges: (root: string) => state.pending.get(root) ?? [],
  };
});

const requeue = vi.fn();
const flush = vi.fn(async () => {
  for (const [root, list] of state.pending) {
    state.pending.set(root, list.filter((c) => !state.pushes.has(String(c.file))));
  }
  return { success: true, servicePushedFiles: state.servicePushed };
});

vi.mock("./auto-commit", () => ({
  isAutoCommitEnabled: () => state.enabled,
  requeueTrackedLocalDirties: (...args: unknown[]) => requeue(...args),
  flushPendingChanges: (...args: unknown[]) => flush(...(args as [])),
  getConflictedFiles: () => state.conflicted,
  getAutoCommitStatus: () => ({ lastError: state.lastError }),
}));

vi.mock("./site-config", () => ({
  getSiteConfigs: () => [{ domain: "x.com", contentFolder: "site_x" }],
}));

vi.mock("./sync-log", () => ({ logSync: vi.fn() }));

import { flushUnpushedContent, listUnpushedContent } from "./content-flush";

const change = (file: string, status: string, source = "local", author = "alice") => ({
  file,
  status,
  source,
  contentType: "blog",
  slug: "a",
  localSha: "l",
  author,
});

beforeEach(() => {
  state.lastSyncedCommit = "abc";
  state.files = {};
  state.pending = new Map();
  state.enabled = true;
  state.conflicted = [];
  state.lastError = null;
  state.pushes = new Set();
  state.servicePushed = [];
  requeue.mockClear();
  flush.mockClear();
});

describe("listUnpushedContent", () => {
  it("lists local edits and additions, not incoming remote changes", () => {
    state.pending.set("site_x", [
      change("site_x/blog/a/en.yml", "modified"),
      change("site_x/blog/b/en.yml", "added"),
      change("site_x/blog/c/en.yml", "modified", "incoming"),
    ]);
    expect(listUnpushedContent("site_x").files).toEqual([
      { file: "site_x/blog/a/en.yml", author: "alice", kind: "edit" },
      { file: "site_x/blog/b/en.yml", author: "alice", kind: "add" },
    ]);
  });

  it("counts a delete only when it was intentional, not a stale sync record", () => {
    state.files = {
      "site_x/blog/gone/en.yml": { sha: "", lastModified: 0, remoteSha: "r1" },
      "site_x/blog/stale/en.yml": { sha: "r2", lastModified: 0, remoteSha: "r2" },
    };
    state.pending.set("site_x", [
      change("site_x/blog/gone/en.yml", "deleted"),
      change("site_x/blog/stale/en.yml", "deleted"),
    ]);
    expect(listUnpushedContent("site_x").files.map((f) => f.file)).toEqual(["site_x/blog/gone/en.yml"]);
  });

  it("does not guess without a recorded sync base", () => {
    state.lastSyncedCommit = null;
    state.pending.set("site_x", [change("site_x/blog/a/en.yml", "added")]);
    expect(listUnpushedContent("site_x")).toEqual({ files: [], baselineMissing: true });
  });
});

describe("flushUnpushedContent", () => {
  it("requeues with authors, pushes with the service fallback and reports what is left", async () => {
    state.pending.set("site_x", [
      change("site_x/blog/a/en.yml", "modified", "local", "alice"),
      change("site_x/blog/b/en.yml", "modified", "local", "migration:006"),
      change("site_x/blog/c/en.yml", "modified", "local", "bob"),
    ]);
    state.pushes = new Set(["site_x/blog/a/en.yml"]);
    state.servicePushed = ["site_x/blog/a/en.yml"];
    state.conflicted = ["site_x/blog/b/en.yml"];
    state.lastError = "422 Update is not a fast forward";

    const report = await flushUnpushedContent();

    expect(requeue).toHaveBeenCalledWith([
      { filePath: "site_x/blog/a/en.yml", author: "alice" },
      { filePath: "site_x/blog/b/en.yml", author: "migration:006" },
      { filePath: "site_x/blog/c/en.yml", author: "bob" },
    ]);
    expect(flush).toHaveBeenCalledWith(expect.objectContaining({ serviceTokenForUnconnected: true }));
    expect(report.ok).toBe(false);
    const site = report.sites[0]!;
    expect(site.pushed).toBe(1);
    expect(site.pushed_with_service_account).toEqual(["site_x/blog/a/en.yml"]);
    expect(site.remaining.map((r) => [r.file, r.reason])).toEqual([
      ["site_x/blog/b/en.yml", "conflict"],
      ["site_x/blog/c/en.yml", "push_failed"],
    ]);
    expect(site.remaining[1]!.error).toBe("422 Update is not a fast forward");
  });

  it("reports everything as auto_commit_disabled without pushing when auto-sync is off", async () => {
    state.enabled = false;
    state.pending.set("site_x", [change("site_x/blog/a/en.yml", "modified")]);
    const report = await flushUnpushedContent();
    expect(flush).not.toHaveBeenCalled();
    expect(report.sites[0]!.remaining.map((r) => r.reason)).toEqual(["auto_commit_disabled"]);
  });

  it("is ok and does nothing when nothing is pending", async () => {
    const report = await flushUnpushedContent();
    expect(report).toEqual({
      ok: true,
      sites: [
        { site: "x.com", content_root: "site_x", pushed: 0, pushed_with_service_account: [], remaining: [], baseline_missing: false },
      ],
    });
    expect(flush).not.toHaveBeenCalled();
  });
});
