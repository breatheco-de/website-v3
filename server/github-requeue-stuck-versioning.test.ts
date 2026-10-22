import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { loadSyncState, requeueTrackedLocalDirties, logSync } = vi.hoisted(() => ({
  loadSyncState: vi.fn(),
  requeueTrackedLocalDirties: vi.fn(),
  logSync: vi.fn(),
}));

vi.mock("./sync-state", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./sync-state")>()),
  loadSyncState,
  shouldTrackFile: () => true,
}));
vi.mock("./auto-commit", () => ({
  isAutoCommitEnabled: () => true,
  requeueTrackedLocalDirties,
  recordLastCommitSha: vi.fn(),
}));
vi.mock("./sync-log", () => ({ logSync, refreshGithubCommit: vi.fn(), withSyncLogContextAsync: (_r: unknown, fn: () => unknown) => fn() }));

import { requeueStuckVersioningFiles } from "./github";
import { computeFileSha } from "./sync-state";

const A = "site_x/landings/a/versioning.yml";
const B = "site_x/landings/b/versioning.yml";
const config = { owner: "acme", repo: "content", branch: "main", token: "t" } as any;

let dir: string;
const prevCwd = process.cwd();

function stubCompare(changed: string[]) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response(JSON.stringify({ files: changed.map((filename) => ({ filename })) }), { status: 200 })),
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "requeue-stuck-"));
  process.chdir(dir);
  const files: Record<string, { sha: string; remoteSha?: string; lastModified: number }> = {};
  for (const [f, body] of [[A, "en: {}\n"], [B, "es: {}\n"]] as const) {
    fs.mkdirSync(path.dirname(f), { recursive: true });
    fs.writeFileSync(f, body);
    files[f] = { sha: computeFileSha(body), remoteSha: "old", lastModified: 1 };
  }
  loadSyncState.mockReturnValue({ lastSyncedCommit: "synced", files });
});

afterEach(() => {
  process.chdir(prevCwd);
  fs.rmSync(dir, { recursive: true, force: true });
  vi.unstubAllGlobals();
});

describe("requeueStuckVersioningFiles", () => {
  it("requeues under the service account when GitHub is at the sync point", async () => {
    const res = await requeueStuckVersioningFiles(config, { lastSyncedCommit: "h", remoteCommit: "h" });
    expect(res).toEqual({ requeued: [A, B], skipped: [] });
    expect(requeueTrackedLocalDirties).toHaveBeenCalledWith([
      { filePath: A, author: "System" },
      { filePath: B, author: "System" },
    ]);
  });

  it("leaves files GitHub changed since the last sync and logs them", async () => {
    stubCompare([B, "site_x/blog/other/en.yml"]);
    const res = await requeueStuckVersioningFiles(config, { lastSyncedCommit: "synced", remoteCommit: "head" });
    expect(res).toEqual({ requeued: [A], skipped: [B] });
    expect(logSync).toHaveBeenCalledWith("RECONCILE", expect.stringContaining(B));
  });

  it("requeues nothing when GitHub cannot be compared", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("", { status: 502 })));
    const res = await requeueStuckVersioningFiles(config, { lastSyncedCommit: "synced", remoteCommit: "head" });
    expect(res.requeued).toEqual([]);
    expect(requeueTrackedLocalDirties).not.toHaveBeenCalled();
  });
});
