import crypto from "crypto";
import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const sha256 = (s: string) => crypto.createHash("sha256").update(s, "utf8").digest("hex");
const blobSha1 = (s: string) => {
  const buf = Buffer.from(s, "utf-8");
  return crypto.createHash("sha1").update(`blob ${buf.length}\0`).update(buf).digest("hex");
};

const baselines = new Map<string, string>();
const updateSyncStateAfterCommit = vi.fn();
const updateFileAfterPull = vi.fn();
const logSync = vi.fn();

vi.mock("./sync-state", () => ({
  getSyncConfig: () => ({ commitIntervalSeconds: 5 }),
  updateSyncStateAfterCommit: (...args: unknown[]) => updateSyncStateAfterCommit(...args),
  updateFileAfterPull: (...args: unknown[]) => updateFileAfterPull(...args),
  flushAllPendingSyncStateWrites: () => {},
  computeFileSha: (s: string) => sha256(s),
  computeGitBlobSha: (s: string) => blobSha1(s),
  loadSyncState: () => ({
    lastSyncedCommit: null,
    lastSyncedAt: null,
    files: Object.fromEntries([...baselines].map(([p, remoteSha]) => [p, { sha: "", remoteSha, lastModified: 0 }])),
  }),
  saveSyncState: vi.fn(),
  shouldTrackFile: () => true,
}));
vi.mock("./content-types", () => ({ getAllFolders: () => ["blog"] }));
vi.mock("./site-config", () => ({
  getSiteConfigs: () => [{ domain: "x.com", contentFolder: "site_x", githubRepoUrl: "https://github.com/o/r" }],
}));
vi.mock("./proposal-draft-push-guard", () => ({ skipAutoCommitForProposalDraft: () => false }));
vi.mock("./events/event-store", () => ({ attachCommitShaForCommittedFiles: vi.fn() }));
vi.mock("./sync-log", () => ({ logSync: (...args: unknown[]) => logSync(...args), refreshGithubCommit: vi.fn() }));
vi.mock("./github-user-tokens", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./github-user-tokens")>();
  return { ...actual, resolveCommitGitHubToken: vi.fn(async () => ({ token: "svc-token", source: "service" })) };
});

import { decideRemoteOverlap } from "./auto-commit-overlap";
import { _resetAutoCommitForTests, flushPendingChanges, getConflictedFiles, queueFileChange } from "./auto-commit";

describe("decideRemoteOverlap", () => {
  const v1 = "title: One\n";
  const v2 = "title: Two\n";
  const mine = "title: Mine\n";

  it("pushes when GitHub still has the version this server last synced", () => {
    expect(decideRemoteOverlap({ local: mine, baseline: sha256(v1), remote: { exists: true, content: v1 } })).toEqual({ action: "push" });
  });

  it("accepts a git blob sha as the baseline", () => {
    expect(decideRemoteOverlap({ local: mine, baseline: blobSha1(v1), remote: { exists: true, content: v1 } })).toEqual({ action: "push" });
  });

  it("refuses to overwrite a newer GitHub change", () => {
    expect(decideRemoteOverlap({ local: mine, baseline: sha256(v1), remote: { exists: true, content: v2 } })).toEqual({
      action: "conflict",
      reason: "changed on GitHub since this server last synced it",
    });
  });

  it("treats identical content as already in sync", () => {
    expect(decideRemoteOverlap({ local: v2, baseline: sha256(v1), remote: { exists: true, content: v2 } })).toEqual({ action: "in_sync" });
  });

  it("refuses to overwrite a file GitHub has that this server never synced", () => {
    expect(decideRemoteOverlap({ local: mine, remote: { exists: true, content: v2 } })).toMatchObject({ action: "conflict" });
  });

  it("pushes a brand-new file", () => {
    expect(decideRemoteOverlap({ local: mine, remote: { exists: false } })).toEqual({ action: "push" });
  });

  it("refuses to recreate a file someone deleted on GitHub", () => {
    expect(decideRemoteOverlap({ local: mine, baseline: sha256(v1), remote: { exists: false } })).toMatchObject({ action: "conflict" });
  });

  it("deletes only when GitHub still has the synced version", () => {
    expect(decideRemoteOverlap({ local: null, baseline: sha256(v1), remote: { exists: true, content: v1 } })).toEqual({ action: "push" });
    expect(decideRemoteOverlap({ local: null, baseline: sha256(v1), remote: { exists: true, content: v2 } })).toMatchObject({ action: "conflict" });
    expect(decideRemoteOverlap({ local: null, baseline: sha256(v1), remote: { exists: false } })).toEqual({ action: "in_sync" });
  });
});

describe("auto-sync against a GitHub that moved on", () => {
  const originalEnv = { ...process.env };
  const originalCwd = process.cwd();
  let tempDir: string;
  let remote: Map<string, string>;
  let treePaths: string[][];
  let puts: string[];
  let headMovesOnUpdate: boolean;

  const write = (rel: string, content: string) => {
    fs.mkdirSync(path.dirname(path.join(tempDir, rel)), { recursive: true });
    fs.writeFileSync(path.join(tempDir, rel), content, "utf-8");
  };

  beforeEach(() => {
    process.env.GITHUB_SYNC_ENABLED = "true";
    process.env.GITHUB_AUTO_COMMIT_ENABLED = "true";
    process.env.GITHUB_TOKEN = "svc-token";
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "auto-commit-overlap-"));
    process.chdir(tempDir);
    remote = new Map();
    baselines.clear();
    treePaths = [];
    puts = [];
    headMovesOnUpdate = false;
    updateSyncStateAfterCommit.mockClear();
    updateFileAfterPull.mockClear();
    logSync.mockClear();

    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        const accept = String((init?.headers as Record<string, string>)?.Accept ?? "");
        const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
        const contents = url.match(/\/contents\/([^?]+)/);
        if (contents) {
          const p = decodeURIComponent(contents[1]);
          if (init?.method === "PUT") {
            puts.push(p);
            return json({ commit: { sha: "put-commit" } });
          }
          if (!remote.has(p)) return new Response("Not Found", { status: 404 });
          if (accept.includes("raw")) return new Response(remote.get(p), { status: 200 });
          return json({ sha: `blob:${p}` });
        }
        const blob = url.match(/\/git\/blobs\/blob:(.+)$/);
        if (blob) return new Response(remote.get(decodeURIComponent(blob[1])) ?? "", { status: 200 });
        if (url.includes("/git/ref/heads/")) return json({ object: { sha: "head" } });
        if (url.endsWith("/git/commits/head")) return json({ tree: { sha: "base-tree" } });
        if (url.endsWith("/git/blobs")) return json({ sha: "new-blob" });
        if (url.endsWith("/git/trees")) {
          treePaths.push(JSON.parse(String(init?.body)).tree.map((e: { path: string }) => e.path));
          return json({ sha: "new-tree" });
        }
        if (url.endsWith("/git/commits") && init?.method === "POST") return json({ sha: "new-commit" });
        if (url.includes("/git/refs/heads/")) {
          return headMovesOnUpdate
            ? json({ message: "Update is not a fast forward" }, 422)
            : json({ object: { sha: "new-commit" } });
        }
        return json({});
      }),
    );
  });

  afterEach(() => {
    _resetAutoCommitForTests();
    vi.unstubAllGlobals();
    process.chdir(originalCwd);
    fs.rmSync(tempDir, { recursive: true, force: true });
    process.env = { ...originalEnv };
  });

  it("does not push a stale server copy over a newer GitHub change (the 85e2f8a case)", async () => {
    const file = "site_x/content-types.yml";
    baselines.set(file, sha256("workshop: old\n"));
    remote.set(file, "workshop: new from another push\n");
    write(file, "workshop: old\nhost_bio: added on the server\n");

    queueFileChange(file, "system");
    await flushPendingChanges();

    expect(treePaths).toEqual([]);
    expect(puts).toEqual([]);
    expect(getConflictedFiles()).toEqual([file]);
    expect(logSync).toHaveBeenCalledWith(
      "CONFLICT",
      expect.stringContaining("changed on GitHub since this server last synced it"),
      "system",
      undefined,
      "site_x",
    );
  });

  it("pushes when GitHub still has the version this server last synced", async () => {
    const file = "site_x/blog/a/en.yml";
    baselines.set(file, sha256("title: A\n"));
    remote.set(file, "title: A\n");
    write(file, "title: A edited\n");

    queueFileChange(file, "system");
    await flushPendingChanges();

    expect(treePaths).toEqual([[file]]);
    expect(updateSyncStateAfterCommit).toHaveBeenCalledWith("new-commit", [file], "site_x");
    expect(getConflictedFiles()).toEqual([]);
  });

  it("marks a file synced without committing when GitHub already has the same content", async () => {
    const file = "site_x/blog/a/en.yml";
    baselines.set(file, sha256("title: A\n"));
    remote.set(file, "title: B\n");
    write(file, "title: B\n");

    queueFileChange(file, "system");
    await flushPendingChanges();

    expect(treePaths).toEqual([]);
    expect(updateFileAfterPull).toHaveBeenCalledWith(file, "head", undefined, "site_x");
  });

  it("pushes the safe files of a mixed batch and holds back the conflict", async () => {
    const safe = "site_x/blog/a/en.yml";
    const stale = "site_x/blog/b/en.yml";
    baselines.set(safe, sha256("a\n"));
    baselines.set(stale, sha256("b\n"));
    remote.set(safe, "a\n");
    remote.set(stale, "b changed on GitHub\n");
    write(safe, "a edited\n");
    write(stale, "b edited here\n");

    queueFileChange(safe, "system");
    queueFileChange(stale, "system");
    await flushPendingChanges();

    expect(treePaths).toEqual([[safe]]);
    expect(getConflictedFiles()).toEqual([stale]);
  });

  it("checks again file by file when the branch moves between the check and the commit", async () => {
    const file = "site_x/blog/a/en.yml";
    baselines.set(file, sha256("a\n"));
    remote.set(file, "a\n");
    write(file, "a edited\n");
    headMovesOnUpdate = true;
    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>;
    const inner = fetchMock.getMockImplementation()!;
    fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
      // Someone else pushes the same file right after our batch check.
      if (url.endsWith("/git/commits") && init?.method === "POST") remote.set(file, "a changed meanwhile\n");
      return inner(url, init);
    });

    queueFileChange(file, "system");
    await flushPendingChanges();

    expect(puts).toEqual([]);
    expect(getConflictedFiles()).toEqual([file]);
  });
});
