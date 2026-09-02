import { beforeEach, describe, expect, it, vi } from "vitest";

const { markFileAsModified, detectPendingChanges, isAutoCommitEnabled, commitAndPush, resolveCommitGitHubToken } = vi.hoisted(() => ({
  markFileAsModified: vi.fn(),
  detectPendingChanges: vi.fn(),
  isAutoCommitEnabled: vi.fn(),
  commitAndPush: vi.fn(),
  resolveCommitGitHubToken: vi.fn(),
}));

vi.mock("./sync-state", () => ({
  markFileAsModified,
  detectPendingChanges,
}));

vi.mock("./auto-commit", () => ({
  isAutoCommitEnabled,
}));

vi.mock("./github", () => ({
  commitAndPush,
}));

vi.mock("./github-user-tokens", () => ({
  resolveCommitGitHubToken,
  GitHubConnectError: class GitHubConnectError extends Error {
    code: string;
    constructor(code: string, message: string) {
      super(message);
      this.code = code;
    }
  },
}));

import { queueOrCommitFiles } from "./github-commit-queue";

const FILES = [
  "site_test/blog/hello/_common.yml",
  "site_test/blog/hello/en.yml",
];

describe("queueOrCommitFiles", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    detectPendingChanges.mockReturnValue([]);
    resolveCommitGitHubToken.mockResolvedValue({
      token: "service-token",
      source: "service",
    });
  });

  it("returns 202 and does not commitAndPush when auto-commit is on", async () => {
    isAutoCommitEnabled.mockReturnValue(true);
    const logEdit = vi.fn();

    const result = await queueOrCommitFiles({
      files: FILES,
      message: "Create entry blog/hello",
      author: "agent",
      contentRoot: "site_test",
      logEdit,
    });

    expect(result).toEqual({
      status: 202,
      queued: true,
      files: FILES,
      author: "agent",
    });
    expect(markFileAsModified).toHaveBeenCalledTimes(2);
    expect(markFileAsModified).toHaveBeenCalledWith(
      FILES[0],
      "agent",
      undefined,
      "site_test",
      undefined,
      { agentLabel: undefined },
    );
    expect(markFileAsModified).toHaveBeenCalledWith(
      FILES[1],
      "agent",
      undefined,
      "site_test",
      undefined,
      { agentLabel: undefined },
    );
    expect(commitAndPush).not.toHaveBeenCalled();
    expect(logEdit).toHaveBeenCalledTimes(2);
  });

  it("calls commitAndPush once with the files list when auto-commit is off", async () => {
    isAutoCommitEnabled.mockReturnValue(false);
    commitAndPush.mockResolvedValue({ success: true, commitHash: "abc123" });

    const result = await queueOrCommitFiles({
      files: FILES,
      message: "Create entry blog/hello",
      author: "agent",
      contentRoot: "site_test",
      repoUrl: "https://github.com/org/repo",
    });

    expect(result).toEqual({
      status: 200,
      success: true,
      commitHash: "abc123",
    });
    expect(markFileAsModified).toHaveBeenCalledTimes(2);
    expect(commitAndPush).toHaveBeenCalledTimes(1);
    expect(commitAndPush).toHaveBeenCalledWith("[Author: agent] Create entry blog/hello", {
      force: false,
      files: FILES,
      repoUrl: "https://github.com/org/repo",
      contentRoot: "site_test",
      token: "service-token",
      commitAuthor: undefined,
    });
  });

  it("returns 400 when there are no files and no pending changes", async () => {
    isAutoCommitEnabled.mockReturnValue(true);
    detectPendingChanges.mockReturnValue([]);

    const result = await queueOrCommitFiles({
      message: "noop",
    });

    expect(result).toEqual({
      status: 400,
      success: false,
      error: "No pending changes found to queue",
    });
    expect(markFileAsModified).not.toHaveBeenCalled();
    expect(commitAndPush).not.toHaveBeenCalled();
  });

  it("returns 400 when the batched commit fails", async () => {
    isAutoCommitEnabled.mockReturnValue(false);
    commitAndPush.mockResolvedValue({ success: false, error: "Remote has new commits" });

    const result = await queueOrCommitFiles({
      files: FILES,
      message: "Create entry blog/hello",
      author: "agent",
    });

    expect(result).toEqual({
      status: 400,
      success: false,
      error: "Remote has new commits",
    });
    expect(commitAndPush).toHaveBeenCalledTimes(1);
  });
});
