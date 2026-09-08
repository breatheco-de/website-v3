import {
  getOAuthAuthorizeUrl,
  isGitHubAppConfigured,
} from "../../github-user-tokens";
import type { AuthConnector, AuthIdentity } from "../types";

export const githubAuthConnector: AuthConnector = {
  id: "github",
  label: "GitHub",
  isConfigured: isGitHubAppConfigured,
};

export function getGitHubAuthAuthorizeUrl(state: string): string {
  return getOAuthAuthorizeUrl(state);
}

export async function fetchGitHubAuthIdentity(
  accessToken: string,
): Promise<AuthIdentity> {
  const userRes = await fetch("https://api.github.com/user", {
    headers: githubHeaders(accessToken),
  });
  if (!userRes.ok) {
    throw new Error(`Failed to fetch GitHub user (${userRes.status})`);
  }
  const user = (await userRes.json()) as {
    id?: number;
    login?: string;
    name?: string | null;
    email?: string | null;
  };
  if (!user.id || !user.login) {
    throw new Error("GitHub user profile is missing id or login");
  }

  const emailsRes = await fetch("https://api.github.com/user/emails", {
    headers: githubHeaders(accessToken),
  });
  const emailRows = emailsRes.ok
    ? ((await emailsRes.json()) as Array<{
        email?: string;
        verified?: boolean;
        primary?: boolean;
      }>)
    : [];

  const verifiedEmails = emailRows
    .filter((row) => row.verified && typeof row.email === "string" && row.email)
    .map((row) => row.email!.toLowerCase().trim());

  const primaryFromList = emailRows.find(
    (row) => row.primary && row.verified && row.email,
  )?.email;
  const fallbackEmail = user.email?.toLowerCase().trim();
  if (fallbackEmail && !verifiedEmails.includes(fallbackEmail) && emailsRes.status === 403) {
    // No emails scope — cannot treat profile email as verified.
  }

  const primaryEmail = (
    primaryFromList ||
    verifiedEmails[0] ||
    undefined
  )?.toLowerCase();

  return {
    provider: "github",
    providerUserId: String(user.id),
    handle: user.login,
    displayName: user.name || user.login,
    verifiedEmails,
    primaryEmail,
  };
}

function githubHeaders(accessToken: string): Record<string, string> {
  return {
    Authorization: `Bearer ${accessToken}`,
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
  };
}
