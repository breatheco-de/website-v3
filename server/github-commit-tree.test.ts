import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { detectPendingChanges, getLastSyncedCommit, updateSyncStateAfterCommit } = vi.hoisted(() => ({
  detectPendingChanges: vi.fn(),
  getLastSyncedCommit: vi.fn(),
  updateSyncStateAfterCommit: vi.fn(),
}));

vi.mock("./sync-state", () => ({
  detectPendingChanges,
  getLastSyncedCommit,
  updateSyncStateAfterCommit,
  getAllContentFiles: vi.fn(),
  markFileAsModified: vi.fn(),
  loadSyncState: vi.fn(),
  saveSyncState: vi.fn(),
  computeFileSha: vi.fn(),
}));
vi.mock("./auto-commit", () => ({ recordLastCommitSha: vi.fn() }));
vi.mock("./events/event-store", () => ({ attachCommitShaForCommittedFiles: vi.fn() }));

import { commitAndPush } from "./github";

type Call = { method: string; url: string; body?: any };

function mockGitHub(opts: { treeStatus?: number; treeBody?: string } = {}) {
  const calls: Call[] = [];
  let treeN = 0;
  let blobN = 0;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      const method = init?.method ?? "GET";
      const body = init?.body ? JSON.parse(String(init.body)) : undefined;
      calls.push({ method, url, body });
      const json = (data: unknown, status = 200) =>
        new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json" } });
      if (url.includes("/git/ref/heads/")) return json({ object: { sha: "head" } });
      if (url.includes("/git/commits/head")) return json({ tree: { sha: "base-tree" } });
      if (url.endsWith("/git/blobs")) return json({ sha: `blob-${++blobN}` });
      if (url.endsWith("/git/trees")) {
        if (opts.treeStatus) return new Response(opts.treeBody ?? "", { status: opts.treeStatus });
        return json({ sha: `tree-${++treeN}` });
      }
      if (url.endsWith("/git/commits")) return json({ sha: "new-commit" });
      if (url.includes("/git/refs/heads/")) return json({});
      return json({}, 404);
    }),
  );
  return calls;
}

describe("commitAndPush tree creation", () => {
  let dir: string;
  const prevCwd = process.cwd();
  const prevEnv = { ...process.env };

  beforeEach(() => {
    vi.clearAllMocks();
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "gh-tree-"));
    process.chdir(dir);
    process.env.GITHUB_SYNC_ENABLED = "true";
    process.env.GITHUB_TOKEN = "t";
    process.env.GITHUB_REPO_URL = "https://github.com/acme/content";
    process.env.GITHUB_BRANCH = "main";
    getLastSyncedCommit.mockReturnValue(null);
  });

  afterEach(() => {
    process.chdir(prevCwd);
    fs.rmSync(dir, { recursive: true, force: true });
    process.env = { ...prevEnv };
    vi.unstubAllGlobals();
  });

  function pending(n: number) {
    const files = Array.from({ length: n }, (_, i) => `site_test/blog/p${i}/en.yml`);
    for (const f of files) {
      fs.mkdirSync(path.dirname(path.join(dir, f)), { recursive: true });
      fs.writeFileSync(path.join(dir, f), "title: x\n");
    }
    detectPendingChanges.mockReturnValue(files.map((file) => ({ file, status: "modified" })));
    return files;
  }

  it("builds a large change set as chained tree batches and makes one commit", async () => {
    const files = pending(450);
    const calls = mockGitHub();

    const res = await commitAndPush("big", { files, contentRoot: "site_test" });

    expect(res).toMatchObject({ success: true, commitHash: "new-commit" });
    const trees = calls.filter((c) => c.url.endsWith("/git/trees"));
    expect(trees.map((t) => t.body.tree.length)).toEqual([200, 200, 50]);
    expect(trees.map((t) => t.body.base_tree)).toEqual(["base-tree", "tree-1", "tree-2"]);
    const commits = calls.filter((c) => c.method === "POST" && c.url.endsWith("/git/commits"));
    expect(commits).toHaveLength(1);
    expect(commits[0].body.tree).toBe("tree-3");
  });

  it("reports GitHub's error and the failing batch instead of a bare message", async () => {
    const files = pending(250);
    mockGitHub({ treeStatus: 422, treeBody: JSON.stringify({ message: "tree.sha is not a valid blob" }) });

    const res = await commitAndPush("big", { files, contentRoot: "site_test" });

    expect(res.success).toBe(false);
    expect(res.error).toBe("Failed to create tree: GitHub API 422: tree.sha is not a valid blob (files 1-200 of 250)");
  });

  it("retries a tree batch once when GitHub times out", async () => {
    const files = pending(3);
    const calls = mockGitHub({ treeStatus: 502 });

    const res = await commitAndPush("small", { files, contentRoot: "site_test" });

    expect(calls.filter((c) => c.url.endsWith("/git/trees"))).toHaveLength(2);
    expect(res.error).toBe("Failed to create tree: GitHub API 502");
  });
});
