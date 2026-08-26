import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  resolveCommitGitHubToken,
  GitHubConnectError,
  isGitHubConnectRequired,
  setUserGitHubToken,
  _resetGitHubUserTokensForTests,
  getUserConnectionStatus,
  getContentRepoFullNames,
  getGitHubConnectSetupInfo,
} from "./github-user-tokens";

describe("resolveCommitGitHubToken", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    _resetGitHubUserTokensForTests();
    process.env.GITHUB_TOKEN = "service-token-abc";
    process.env.GITHUB_SYNC_ENABLED = "true";
    delete process.env.NODE_ENV;
    delete process.env.GITHUB_CONNECT_REQUIRED;
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    _resetGitHubUserTokensForTests();
  });

  it("uses service token for system purpose", async () => {
    process.env.NODE_ENV = "production";
    const resolved = await resolveCommitGitHubToken({
      username: "alice",
      purpose: "system",
    });
    expect(resolved.source).toBe("service");
    expect(resolved.token).toBe("service-token-abc");
  });

  it("uses service token when not production (dev)", async () => {
    process.env.NODE_ENV = "development";
    const resolved = await resolveCommitGitHubToken({
      username: null,
      purpose: "user_commit",
    });
    expect(resolved.source).toBe("service");
    expect(resolved.token).toBe("service-token-abc");
    expect(isGitHubConnectRequired()).toBe(false);
  });

  it("requires Connect in development when GITHUB_CONNECT_REQUIRED=true", async () => {
    process.env.NODE_ENV = "development";
    process.env.GITHUB_CONNECT_REQUIRED = "true";
    expect(isGitHubConnectRequired()).toBe(true);
    await expect(
      resolveCommitGitHubToken({
        username: "alice",
        purpose: "user_commit",
      }),
    ).rejects.toMatchObject({
      code: "github_connect_required",
    } satisfies Partial<GitHubConnectError>);
  });

  it("does not require Connect when sync is disabled even with force flag", () => {
    process.env.NODE_ENV = "development";
    process.env.GITHUB_CONNECT_REQUIRED = "true";
    process.env.GITHUB_SYNC_ENABLED = "false";
    expect(isGitHubConnectRequired()).toBe(false);
  });

  it("requires Connect in production for user commits without token", async () => {
    process.env.NODE_ENV = "production";
    expect(isGitHubConnectRequired()).toBe(true);
    await expect(
      resolveCommitGitHubToken({
        username: "alice",
        purpose: "user_commit",
      }),
    ).rejects.toMatchObject({
      code: "github_connect_required",
    } satisfies Partial<GitHubConnectError>);
  });

  it("requires Connect in production when username missing", async () => {
    process.env.NODE_ENV = "production";
    await expect(
      resolveCommitGitHubToken({
        username: null,
        purpose: "user_commit",
      }),
    ).rejects.toBeInstanceOf(GitHubConnectError);
  });

  it("returns stored user token in production when connected", async () => {
    process.env.NODE_ENV = "production";
    await setUserGitHubToken("alice", {
      accessToken: "user-pat-xyz",
      githubLogin: "alice-gh",
      githubName: "Alice",
      githubEmail: "alice@users.noreply.github.com",
      expiresAt: Date.now() + 60 * 60 * 1000,
      connectedAt: new Date().toISOString(),
    });

    const resolved = await resolveCommitGitHubToken({
      username: "alice",
      purpose: "user_commit",
    });
    expect(resolved.source).toBe("user");
    expect(resolved.token).toBe("user-pat-xyz");
    expect(resolved.githubLogin).toBe("alice-gh");
  });

  it("getUserConnectionStatus reports required + disconnected in prod", async () => {
    process.env.NODE_ENV = "production";
    const status = await getUserConnectionStatus("bob");
    expect(status.required).toBe(true);
    expect(status.connected).toBe(false);
  });

  it("getGitHubConnectSetupInfo exposes install URL when app slug is set", () => {
    process.env.GITHUB_APP_CLIENT_ID = "cid";
    process.env.GITHUB_APP_CLIENT_SECRET = "secret";
    process.env.GITHUB_APP_SLUG = "caxton-cms";
    const setup = getGitHubConnectSetupInfo();
    expect(setup.appConfigured).toBe(true);
    expect(setup.appSlug).toBe("caxton-cms");
    expect(setup.appInstallUrl).toBe(
      "https://github.com/apps/caxton-cms/installations/new",
    );
    expect(Array.isArray(setup.contentRepos)).toBe(true);
    expect(Array.isArray(getContentRepoFullNames())).toBe(true);
  });
});
