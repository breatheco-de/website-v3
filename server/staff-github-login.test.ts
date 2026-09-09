import { afterEach, describe, expect, it } from "vitest";
import {
  getStaffGitHubLoginStatus,
  isConnectionTokenStaffAllowEnvSet,
  isConnectionTokenStaffAllowed,
  isLoopbackHost,
  isStaffGitHubLoginAvailable,
  isSuspiciousPublicSiteHost,
  parseStaffSiteUrl,
} from "./staff-github-login";

const ENV_KEYS = [
  "SITE_URL",
  "GITHUB_APP_CLIENT_ID",
  "GITHUB_APP_CLIENT_SECRET",
  "GITHUB_APP_SLUG",
  "WEBLIFY_ALLOW_CONNECTION_TOKEN_STAFF",
] as const;

function clearEnv() {
  for (const key of ENV_KEYS) {
    delete process.env[key];
  }
}

function setAppEnv() {
  process.env.GITHUB_APP_CLIENT_ID = "id";
  process.env.GITHUB_APP_CLIENT_SECRET = "secret";
  process.env.GITHUB_APP_SLUG = "slug";
}

describe("staff-github-login", () => {
  afterEach(() => {
    clearEnv();
  });

  it("parseStaffSiteUrl rejects empty and non-http", () => {
    expect(parseStaffSiteUrl("")).toBeNull();
    expect(parseStaffSiteUrl("ftp://example.com")).toBeNull();
    expect(parseStaffSiteUrl("https://example.com/path")).toEqual({
      origin: "https://example.com",
      host: "example.com",
    });
  });

  it("detects loopback and suspicious hosts", () => {
    expect(isLoopbackHost("localhost")).toBe(true);
    expect(isLoopbackHost("127.0.0.1")).toBe(true);
    expect(isLoopbackHost("::1")).toBe(true);
    expect(isLoopbackHost("example.com")).toBe(false);
    expect(isSuspiciousPublicSiteHost("abc.trycloudflare.com")).toBe(true);
    expect(isSuspiciousPublicSiteHost("example.com")).toBe(false);
  });

  it("isStaffGitHubLoginAvailable requires App env and non-loopback SITE_URL", () => {
    clearEnv();
    expect(isStaffGitHubLoginAvailable()).toBe(false);

    setAppEnv();
    process.env.SITE_URL = "http://127.0.0.1:5050";
    expect(isStaffGitHubLoginAvailable()).toBe(false);

    process.env.SITE_URL = "https://cms.example.com";
    expect(isStaffGitHubLoginAvailable()).toBe(true);
  });

  it("connection token staff allowed when GitHub inactive or flag set", () => {
    clearEnv();
    expect(isConnectionTokenStaffAllowed()).toBe(true);

    setAppEnv();
    process.env.SITE_URL = "https://cms.example.com";
    expect(isConnectionTokenStaffAllowed()).toBe(false);

    process.env.WEBLIFY_ALLOW_CONNECTION_TOKEN_STAFF = "1";
    expect(isConnectionTokenStaffAllowEnvSet()).toBe(true);
    expect(isConnectionTokenStaffAllowed()).toBe(true);
  });

  it("getStaffGitHubLoginStatus omits loopback callback and flags tunnels", () => {
    setAppEnv();
    process.env.SITE_URL = "http://localhost:5050";
    let status = getStaffGitHubLoginStatus();
    expect(status.available).toBe(false);
    expect(status.siteUrl).toBeNull();
    expect(status.callbackUrl).toBeNull();
    expect(status.connectionTokenStaffAllowed).toBe(true);

    process.env.SITE_URL = "https://foo.trycloudflare.com";
    status = getStaffGitHubLoginStatus();
    expect(status.available).toBe(true);
    expect(status.siteUrlLookSuspicious).toBe(true);
    expect(status.callbackUrl).toContain("/api/github/oauth/callback");
    expect(status.connectionTokenStaffAllowed).toBe(false);
  });
});
