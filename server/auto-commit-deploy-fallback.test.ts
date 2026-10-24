import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./sync-state", () => ({
  getSyncConfig: () => ({ commitIntervalSeconds: 5 }),
  updateSyncStateAfterCommit: vi.fn(),
  computeFileSha: () => "sha",
  loadSyncState: () => ({ lastSyncedCommit: null, lastSyncedAt: null, files: {} }),
  saveSyncState: vi.fn(),
  shouldTrackFile: () => true,
}));
vi.mock("./content-types", () => ({ getAllFolders: () => ["blog"] }));
vi.mock("./site-config", () => ({
  getSiteConfigs: () => [{ domain: "x.com", contentFolder: "site_x", githubRepoUrl: "https://github.com/o/r" }],
}));
vi.mock("./proposal-draft-push-guard", () => ({ skipAutoCommitForProposalDraft: () => false }));
vi.mock("./events/event-store", () => ({ attachCommitShaForCommittedFiles: vi.fn() }));
vi.mock("./sync-log", () => ({ logSync: vi.fn(), refreshGithubCommit: vi.fn() }));
vi.mock("./github-user-tokens", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./github-user-tokens")>();
  return {
    ...actual,
    resolveCommitGitHubToken: vi.fn(async (opts: { purpose: string }) => {
      if (opts.purpose === "system") return { token: "svc-token", source: "service" };
      throw new actual.GitHubConnectError("github_connect_required", "Connect GitHub to commit content in production.");
    }),
  };
});

import {
  _resetAutoCommitForTests,
  DEPLOY_CHECK_SERVICE_SUFFIX,
  flushPendingChanges,
  getAutoCommitStatus,
  queueFileChange,
} from "./auto-commit";

const commitMessages: string[] = [];
const tokensUsed: string[] = [];
const originalEnv = { ...process.env };

beforeEach(() => {
  process.env.GITHUB_SYNC_ENABLED = "true";
  process.env.GITHUB_AUTO_COMMIT_ENABLED = "true";
  process.env.GITHUB_TOKEN = "svc-token";
  commitMessages.length = 0;
  tokensUsed.length = 0;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      tokensUsed.push(String((init?.headers as Record<string, string>)?.Authorization ?? ""));
      const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200 });
      if (url.includes("/git/ref/heads/")) return json({ object: { sha: "head" } });
      if (url.endsWith("/git/commits/head")) return json({ tree: { sha: "base-tree" } });
      if (url.endsWith("/git/trees")) return json({ sha: "new-tree" });
      if (url.endsWith("/git/commits") && init?.method === "POST") {
        commitMessages.push(JSON.parse(String(init.body)).message);
        return json({ sha: "new-commit" });
      }
      if (url.includes("/git/refs/heads/")) return json({ object: { sha: "new-commit" } });
      return json({});
    }),
  );
});

afterEach(() => {
  _resetAutoCommitForTests();
  vi.unstubAllGlobals();
  process.env = { ...originalEnv };
});

describe("deploy check service-account fallback", () => {
  it("pushes an unconnected author's edit with the service token and keeps the author in the message", async () => {
    queueFileChange("site_x/blog/a/en.yml", "alice");
    const res = await flushPendingChanges({ serviceTokenForUnconnected: true });

    expect(res.success).toBe(true);
    expect(res.servicePushedFiles).toEqual(["site_x/blog/a/en.yml"]);
    expect(commitMessages).toEqual([`[Auto-sync] alice updated blog/a/en.yml ${DEPLOY_CHECK_SERVICE_SUFFIX}`]);
    expect(tokensUsed.every((t) => t === "Bearer svc-token")).toBe(true);
    expect(getAutoCommitStatus().pendingFiles).toBe(0);
  });

  it("without the flag the edit stays queued, as before", async () => {
    queueFileChange("site_x/blog/a/en.yml", "alice");
    const res = await flushPendingChanges();

    expect(res.servicePushedFiles).toEqual([]);
    expect(commitMessages).toEqual([]);
    expect(getAutoCommitStatus().pendingFiles).toBe(1);
  });
});
