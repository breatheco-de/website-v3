/**
 * Per-user GitHub App tokens for content commits.
 * Keyed by BreatheCode username. Local JSON + encrypted GCS (mcp-auth/github-user-tokens.enc).
 */

import crypto from "crypto";
import path from "path";
import {
  readLocalJson,
  writeLocalJson,
  scheduleEncryptedGcsWrite,
  encryptedGcsRead,
} from "./encrypted-blob-store";
import { getSiteConfigs } from "./site-config";

const LOCAL_FILE = path.join(process.cwd(), "data", "github-user-tokens.json");
const GCS_FILE = "github-user-tokens.enc";

export interface GitHubUserTokenEntry {
  accessToken: string;
  refreshToken?: string;
  githubLogin: string;
  githubName?: string;
  githubEmail?: string;
  /** Unix ms when access token expires (GitHub App user tokens ~8h). */
  expiresAt: number;
  connectedAt: string;
}

export type GitHubConnectErrorCode =
  | "github_connect_required"
  | "github_token_invalid"
  | "github_app_env_missing";

export class GitHubConnectError extends Error {
  code: GitHubConnectErrorCode;

  constructor(code: GitHubConnectErrorCode, message: string) {
    super(message);
    this.name = "GitHubConnectError";
    this.code = code;
  }
}

const tokens = new Map<string, GitHubUserTokenEntry>();
let loaded = false;
let loadPromise: Promise<void> | null = null;

/** Pending OAuth CSRF states: state → { username, expiresAt } */
const oauthStates = new Map<string, { username: string; expiresAt: number }>();

export function isGitHubConnectRequired(): boolean {
  if (process.env.GITHUB_SYNC_ENABLED !== "true") return false;
  // Force Connect in any environment (useful for local testing).
  if (process.env.GITHUB_CONNECT_REQUIRED === "true") return true;
  return process.env.NODE_ENV === "production";
}

export function getGitHubAppEnvStatus(): {
  complete: boolean;
  missing: string[];
} {
  const required = [
    "GITHUB_APP_CLIENT_ID",
    "GITHUB_APP_CLIENT_SECRET",
    "GITHUB_APP_SLUG",
  ] as const;
  const missing: string[] = [];
  for (const key of required) {
    if (!process.env[key]?.trim()) missing.push(key);
  }
  // Private key + app id needed for some flows; client id/secret enough for user OAuth.
  return { complete: missing.length === 0, missing };
}

export function isGitHubAppConfigured(): boolean {
  return getGitHubAppEnvStatus().complete;
}

async function ensureLoaded(): Promise<void> {
  if (loaded) return;
  if (loadPromise) return loadPromise;
  loadPromise = (async () => {
    try {
      const gcsRaw = await encryptedGcsRead(GCS_FILE);
      const localRaw = readLocalJson(LOCAL_FILE);
      const raw = gcsRaw || localRaw;
      if (raw) {
        const obj = JSON.parse(raw) as Record<string, GitHubUserTokenEntry>;
        for (const [username, entry] of Object.entries(obj)) {
          if (entry?.accessToken && entry?.githubLogin) {
            tokens.set(username, entry);
          }
        }
      }
    } catch (err) {
      console.warn(
        "[github-user-tokens] load failed:",
        (err as Error).message,
      );
    } finally {
      loaded = true;
      loadPromise = null;
    }
  })();
  return loadPromise;
}

function persist(): void {
  const obj: Record<string, GitHubUserTokenEntry> = {};
  for (const [k, v] of tokens.entries()) obj[k] = v;
  const payload = JSON.stringify(obj, null, 2);
  try {
    writeLocalJson(LOCAL_FILE, payload);
  } catch (err) {
    console.error(
      "[github-user-tokens] local write failed:",
      (err as Error).message,
    );
  }
  scheduleEncryptedGcsWrite(GCS_FILE, () => JSON.stringify(obj, null, 2));
}

export async function getUserGitHubToken(
  username: string,
): Promise<GitHubUserTokenEntry | null> {
  await ensureLoaded();
  return tokens.get(username) ?? null;
}

export async function setUserGitHubToken(
  username: string,
  entry: GitHubUserTokenEntry,
): Promise<void> {
  await ensureLoaded();
  tokens.set(username, entry);
  persist();
}

export async function deleteUserGitHubToken(username: string): Promise<void> {
  await ensureLoaded();
  tokens.delete(username);
  persist();
}

export function createOAuthState(username: string): string {
  const state = crypto.randomBytes(24).toString("hex");
  oauthStates.set(state, {
    username,
    expiresAt: Date.now() + 10 * 60 * 1000,
  });
  return state;
}

export function consumeOAuthState(state: string): string | null {
  const entry = oauthStates.get(state);
  oauthStates.delete(state);
  if (!entry) return null;
  if (entry.expiresAt < Date.now()) return null;
  return entry.username;
}

export function getOAuthCallbackUrl(): string {
  const base = (process.env.SITE_URL || "http://localhost:5000").replace(
    /\/$/,
    "",
  );
  return `${base}/api/github/oauth/callback`;
}

export function getOAuthAuthorizeUrl(state: string): string {
  const clientId = process.env.GITHUB_APP_CLIENT_ID!.trim();
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: getOAuthCallbackUrl(),
    state,
    // GitHub App user authorization — permissions come from the App config.
  });
  return `https://github.com/login/oauth/authorize?${params.toString()}`;
}

interface TokenExchangeResult {
  access_token: string;
  expires_in?: number;
  refresh_token?: string;
  refresh_token_expires_in?: number;
  token_type?: string;
  error?: string;
  error_description?: string;
}

export async function exchangeOAuthCode(
  code: string,
): Promise<TokenExchangeResult> {
  const clientId = process.env.GITHUB_APP_CLIENT_ID?.trim();
  const clientSecret = process.env.GITHUB_APP_CLIENT_SECRET?.trim();
  if (!clientId || !clientSecret) {
    throw new GitHubConnectError(
      "github_app_env_missing",
      "GitHub App OAuth is not configured",
    );
  }

  const res = await fetch("https://github.com/login/oauth/access_token", {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      client_id: clientId,
      client_secret: clientSecret,
      code,
      redirect_uri: getOAuthCallbackUrl(),
    }),
  });

  const data = (await res.json()) as TokenExchangeResult;
  if (!res.ok || data.error || !data.access_token) {
    throw new GitHubConnectError(
      "github_token_invalid",
      data.error_description || data.error || `OAuth exchange failed (${res.status})`,
    );
  }
  return data;
}

async function refreshAccessToken(
  refreshToken: string,
): Promise<TokenExchangeResult> {
  const clientId = process.env.GITHUB_APP_CLIENT_ID?.trim();
  const clientSecret = process.env.GITHUB_APP_CLIENT_SECRET?.trim();
  if (!clientId || !clientSecret) {
    throw new GitHubConnectError(
      "github_app_env_missing",
      "GitHub App OAuth is not configured",
    );
  }

  const res = await fetch("https://github.com/login/oauth/access_token", {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      client_id: clientId,
      client_secret: clientSecret,
      grant_type: "refresh_token",
      refresh_token: refreshToken,
    }),
  });

  const data = (await res.json()) as TokenExchangeResult;
  if (!res.ok || data.error || !data.access_token) {
    throw new GitHubConnectError(
      "github_token_invalid",
      data.error_description || data.error || "Token refresh failed",
    );
  }
  return data;
}

export async function fetchGitHubUser(accessToken: string): Promise<{
  login: string;
  name?: string;
  email?: string;
}> {
  const res = await fetch("https://api.github.com/user", {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
    },
  });
  if (!res.ok) {
    throw new GitHubConnectError(
      "github_token_invalid",
      `Failed to fetch GitHub user (${res.status})`,
    );
  }
  const data = (await res.json()) as {
    login: string;
    name?: string | null;
    email?: string | null;
  };
  return {
    login: data.login,
    name: data.name || undefined,
    email: data.email || undefined,
  };
}

/** Verify the token can push to at least one configured content repo. */
export async function verifyContentRepoWriteAccess(
  accessToken: string,
): Promise<{ ok: boolean; error?: string; reposChecked: string[] }> {
  const repos = new Set<string>();
  for (const site of getSiteConfigs()) {
    if (site.githubRepoUrl) {
      const m = site.githubRepoUrl
        .replace(/\.git$/, "")
        .match(/github\.com\/([^\/]+)\/([^\/]+)/);
      if (m) repos.add(`${m[1]}/${m[2]}`);
    }
  }
  const envUrl = process.env.GITHUB_REPO_URL || "";
  const envMatch = envUrl
    .replace(/\.git$/, "")
    .match(/github\.com\/([^\/]+)\/([^\/]+)/);
  if (envMatch) repos.add(`${envMatch[1]}/${envMatch[2]}`);

  const list = [...repos];
  if (list.length === 0) {
    return {
      ok: false,
      error: "No content github_repo_url configured",
      reposChecked: [],
    };
  }

  for (const full of list) {
    const [owner, repo] = full.split("/");
    const res = await fetch(`https://api.github.com/repos/${owner}/${repo}`, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
      },
    });
    if (!res.ok) continue;
    const data = (await res.json()) as {
      permissions?: { push?: boolean; admin?: boolean };
    };
    if (data.permissions?.push || data.permissions?.admin) {
      return { ok: true, reposChecked: list };
    }
  }

  return {
    ok: false,
    error:
      "Connected GitHub account cannot push to the content repository. Install the GitHub App on the content org and grant Contents write, or ensure your account has write access.",
    reposChecked: list,
  };
}

async function ensureFreshEntry(
  username: string,
  entry: GitHubUserTokenEntry,
): Promise<GitHubUserTokenEntry> {
  const skewMs = 5 * 60 * 1000;
  if (entry.expiresAt > Date.now() + skewMs) return entry;

  if (!entry.refreshToken) {
    await deleteUserGitHubToken(username);
    throw new GitHubConnectError(
      "github_token_invalid",
      "GitHub connection expired. Reconnect GitHub.",
    );
  }

  try {
    const refreshed = await refreshAccessToken(entry.refreshToken);
    const next: GitHubUserTokenEntry = {
      ...entry,
      accessToken: refreshed.access_token,
      refreshToken: refreshed.refresh_token || entry.refreshToken,
      expiresAt:
        Date.now() +
        (typeof refreshed.expires_in === "number"
          ? refreshed.expires_in * 1000
          : 8 * 60 * 60 * 1000),
    };
    await setUserGitHubToken(username, next);
    return next;
  } catch (err) {
    await deleteUserGitHubToken(username);
    if (err instanceof GitHubConnectError) throw err;
    throw new GitHubConnectError(
      "github_token_invalid",
      "GitHub connection expired. Reconnect GitHub.",
    );
  }
}

export interface ResolvedCommitToken {
  token: string;
  githubLogin?: string;
  githubName?: string;
  githubEmail?: string;
  source: "user" | "service";
}

/**
 * Resolve the GitHub token for a content commit.
 * - purpose "system": always env GITHUB_TOKEN
 * - non-production user commits: env GITHUB_TOKEN
 * - production user commits: stored per-user token (required)
 */
export async function resolveCommitGitHubToken(opts: {
  username?: string | null;
  purpose: "user_commit" | "system";
}): Promise<ResolvedCommitToken> {
  if (opts.purpose === "system" || !isGitHubConnectRequired()) {
    const token = process.env.GITHUB_TOKEN?.trim() || "";
    if (!token) {
      throw new GitHubConnectError(
        "github_app_env_missing",
        "GITHUB_TOKEN is not configured",
      );
    }
    return { token, source: "service" };
  }

  const username = opts.username?.trim();
  if (!username) {
    throw new GitHubConnectError(
      "github_connect_required",
      "Connect GitHub to commit content in production. Use Connect on the GitHub sync chip in DebugBubble.",
    );
  }

  const entry = await getUserGitHubToken(username);
  if (!entry) {
    throw new GitHubConnectError(
      "github_connect_required",
      "Connect GitHub to commit content in production. Use Connect on the GitHub sync chip in DebugBubble.",
    );
  }

  const fresh = await ensureFreshEntry(username, entry);
  return {
    token: fresh.accessToken,
    githubLogin: fresh.githubLogin,
    githubName: fresh.githubName,
    githubEmail: fresh.githubEmail,
    source: "user",
  };
}

export async function getUserConnectionStatus(username: string | null): Promise<{
  connected: boolean;
  required: boolean;
  githubLogin?: string;
  expiresAt?: number;
  appConfigured: boolean;
}> {
  const required = isGitHubConnectRequired();
  const appConfigured = isGitHubAppConfigured();
  if (!username) {
    return { connected: false, required, appConfigured };
  }
  await ensureLoaded();
  const entry = tokens.get(username);
  if (!entry) {
    return { connected: false, required, appConfigured };
  }
  return {
    connected: true,
    required,
    githubLogin: entry.githubLogin,
    expiresAt: entry.expiresAt,
    appConfigured,
  };
}

/** Test helper: reset in-memory state. */
export function _resetGitHubUserTokensForTests(): void {
  tokens.clear();
  oauthStates.clear();
  loaded = true;
  loadPromise = null;
}
