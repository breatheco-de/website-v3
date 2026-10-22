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
  shouldTrackFile: () => true,
}));
vi.mock("./auto-commit", () => ({ recordLastCommitSha: vi.fn() }));
vi.mock("./events/event-store", () => ({ attachCommitShaForCommittedFiles: vi.fn() }));
vi.mock("./seo-index", () => ({ isSeoIndexRelPath: () => false, healSeoIndexOnRemoteOverlap: vi.fn() }));

import { commitAndPush } from "./github";

const PUSHED = "site_test/blog/p0/en.yml";
const OTHER = "site_test/blog/other/en.yml";

function mockGitHub(opts: {
  compareFiles?: string[];
  compareStatus?: number;
  /** Per-file fallback: latest commit for a path and its compare status vs the sync point. */
  latestByPath?: Record<string, { sha: string; status: string }>;
}) {
  const calls: string[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      calls.push(url);
      const json = (data: unknown, status = 200) =>
        new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json" } });
      if (url.includes("/git/ref/heads/")) return json({ object: { sha: "head" } });
      if (url.includes("/compare/synced...head")) {
        if (opts.compareStatus) return new Response("", { status: opts.compareStatus });
        return json({ files: (opts.compareFiles ?? []).map((filename) => ({ filename })) });
      }
      if (url.includes("/commits?sha=head&path=")) {
        const p = decodeURIComponent(url.split("path=")[1].split("&")[0]);
        const hit = opts.latestByPath?.[p];
        return json(hit ? [{ sha: hit.sha }] : []);
      }
      const rel = url.match(/\/compare\/synced\.\.\.(.+)$/);
      if (rel) {
        const hit = Object.values(opts.latestByPath ?? {}).find((v) => v.sha === rel[1]);
        return json({ status: hit?.status ?? "ahead" });
      }
      if (url.includes("/git/commits/head")) return json({ tree: { sha: "base-tree" } });
      if (url.endsWith("/git/blobs")) return json({ sha: "blob-1" });
      if (url.endsWith("/git/trees")) return json({ sha: "tree-1" });
      if (url.endsWith("/git/commits")) return json({ sha: "new-commit" });
      if (url.includes("/git/refs/heads/")) return json({});
      return json({}, 404);
    }),
  );
  return calls;
}

describe("commitAndPush onlyBlockOnOverlap", () => {
  let dir: string;
  const prevCwd = process.cwd();
  const prevEnv = { ...process.env };

  beforeEach(() => {
    vi.clearAllMocks();
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "gh-overlap-"));
    process.chdir(dir);
    process.env.GITHUB_SYNC_ENABLED = "true";
    process.env.GITHUB_TOKEN = "t";
    process.env.GITHUB_REPO_URL = "https://github.com/acme/content";
    process.env.GITHUB_BRANCH = "main";
    getLastSyncedCommit.mockReturnValue("synced");
    fs.mkdirSync(path.dirname(path.join(dir, PUSHED)), { recursive: true });
    fs.writeFileSync(path.join(dir, PUSHED), "title: x\n");
    detectPendingChanges.mockReturnValue([{ file: PUSHED, status: "modified" }]);
  });

  afterEach(() => {
    process.chdir(prevCwd);
    fs.rmSync(dir, { recursive: true, force: true });
    process.env = { ...prevEnv };
    vi.unstubAllGlobals();
  });

  it("pushes when the remote is ahead only on unrelated files and keeps the old sync point", async () => {
    mockGitHub({ compareFiles: [OTHER] });

    const res = await commitAndPush("m", { files: [PUSHED], contentRoot: "site_test", onlyBlockOnOverlap: true });

    expect(res).toMatchObject({ success: true, commitHash: "new-commit" });
    expect(updateSyncStateAfterCommit).toHaveBeenCalledWith("new-commit", [PUSHED], "site_test", {
      keepLastSyncedCommit: true,
    });
  });

  it("refuses and lists the path when the remote changed a pushed file", async () => {
    mockGitHub({ compareFiles: [OTHER, PUSHED] });

    const res = await commitAndPush("m", { files: [PUSHED], contentRoot: "site_test", onlyBlockOnOverlap: true });

    expect(res).toMatchObject({ success: false, errorCode: "remote_overlap", overlap: [PUSHED] });
    expect(res.error).toContain(PUSHED);
  });

  it("refuses when GitHub cannot compare (never assumes no overlap)", async () => {
    mockGitHub({ compareStatus: 502 });

    const res = await commitAndPush("m", { files: [PUSHED], contentRoot: "site_test", onlyBlockOnOverlap: true });

    expect(res).toMatchObject({ success: false, errorCode: "remote_overlap_unknown" });
  });

  it("checks each file when the compare list is capped at 300 files", async () => {
    const many = Array.from({ length: 300 }, (_, i) => `site_test/blog/x${i}/en.yml`);
    mockGitHub({ compareFiles: many, latestByPath: { [PUSHED]: { sha: "c-new", status: "ahead" } } });
    const blocked = await commitAndPush("m", { files: [PUSHED], contentRoot: "site_test", onlyBlockOnOverlap: true });
    expect(blocked).toMatchObject({ success: false, overlap: [PUSHED] });

    mockGitHub({ compareFiles: many, latestByPath: { [PUSHED]: { sha: "c-old", status: "behind" } } });
    const ok = await commitAndPush("m", { files: [PUSHED], contentRoot: "site_test", onlyBlockOnOverlap: true });
    expect(ok).toMatchObject({ success: true });
  });

  it("without the flag, any remote change for the site still blocks", async () => {
    mockGitHub({ compareFiles: [OTHER] });

    const res = await commitAndPush("m", { files: [PUSHED], contentRoot: "site_test" });

    expect(res.success).toBe(false);
    expect(res.error).toContain("Remote has new commits");
  });
});
