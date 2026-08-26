import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

vi.mock("./sync-state", () => ({
  markFileAsModified: vi.fn(),
  detectPendingChanges: vi.fn(() => [{ file: "site_x/blog/a.yml" }]),
}));

vi.mock("./auto-commit", () => ({
  isAutoCommitEnabled: vi.fn(() => false),
}));

vi.mock("./github", () => ({
  commitAndPush: vi.fn(async () => ({ success: true, commitHash: "abc123" })),
}));

vi.mock("./github-user-tokens", async () => {
  const actual = await vi.importActual<typeof import("./github-user-tokens")>(
    "./github-user-tokens",
  );
  return {
    ...actual,
    resolveCommitGitHubToken: vi.fn(),
  };
});

import { queueOrCommitFiles } from "./github-commit-queue";
import { commitAndPush } from "./github";
import {
  resolveCommitGitHubToken,
  GitHubConnectError,
} from "./github-user-tokens";

describe("queueOrCommitFiles GitHub Connect", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    vi.clearAllMocks();
    process.env.GITHUB_SYNC_ENABLED = "true";
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it("returns 403 when resolveCommitGitHubToken throws connect required", async () => {
    vi.mocked(resolveCommitGitHubToken).mockRejectedValue(
      new GitHubConnectError(
        "github_connect_required",
        "Connect GitHub to commit",
      ),
    );

    const result = await queueOrCommitFiles({
      files: ["site_x/blog/a.yml"],
      message: "test",
      author: "alice",
    });

    expect(result.status).toBe(403);
    if (result.status === 403) {
      expect(result.errorCode).toBe("github_connect_required");
    }
    expect(commitAndPush).not.toHaveBeenCalled();
  });

  it("passes resolved token to commitAndPush", async () => {
    vi.mocked(resolveCommitGitHubToken).mockResolvedValue({
      token: "user-token",
      githubLogin: "alice-gh",
      githubName: "Alice",
      githubEmail: "a@example.com",
      source: "user",
    });

    const result = await queueOrCommitFiles({
      files: ["site_x/blog/a.yml"],
      message: "test",
      author: "alice",
    });

    expect(result.status).toBe(200);
    expect(commitAndPush).toHaveBeenCalledWith(
      expect.stringContaining("[Author: alice]"),
      expect.objectContaining({
        token: "user-token",
        commitAuthor: {
          name: "Alice",
          email: "a@example.com",
        },
      }),
    );
  });
});
