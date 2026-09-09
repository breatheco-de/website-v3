import { isGitHubAppConfigured, getOAuthCallbackUrl } from "./github-user-tokens";

const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);

const SUSPICIOUS_HOST_SUFFIXES = [
  "trycloudflare.com",
  "cfargotunnel.com",
];

export function parseStaffSiteUrl(
  raw: string | undefined = process.env.SITE_URL,
): { origin: string; host: string } | null {
  const trimmed = raw?.trim();
  if (!trimmed) return null;
  try {
    const url = new URL(trimmed);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    const host = url.hostname.toLowerCase();
    if (!host) return null;
    return { origin: url.origin, host };
  } catch {
    return null;
  }
}

export function isLoopbackHost(host: string): boolean {
  const h = host.toLowerCase().replace(/^\[|\]$/g, "");
  return LOOPBACK_HOSTS.has(h) || LOOPBACK_HOSTS.has(host.toLowerCase());
}

export function isSuspiciousPublicSiteHost(host: string): boolean {
  const h = host.toLowerCase();
  return SUSPICIOUS_HOST_SUFFIXES.some(
    (suffix) => h === suffix || h.endsWith(`.${suffix}`),
  );
}

/** Truthy env: 1 / true / yes (case-insensitive). */
export function isConnectionTokenStaffAllowEnvSet(
  raw: string | undefined = process.env.WEBLIFY_ALLOW_CONNECTION_TOKEN_STAFF,
): boolean {
  const v = raw?.trim().toLowerCase();
  return v === "1" || v === "true" || v === "yes";
}

/**
 * Staff GitHub OAuth login is available only when the App env is complete
 * and SITE_URL is a non-loopback http(s) origin (real public domain / tunnel host).
 */
export function isStaffGitHubLoginAvailable(): boolean {
  if (!isGitHubAppConfigured()) return false;
  const parsed = parseStaffSiteUrl();
  if (!parsed) return false;
  if (isLoopbackHost(parsed.host)) return false;
  return true;
}

export function isConnectionTokenStaffAllowed(): boolean {
  return !isStaffGitHubLoginAvailable() || isConnectionTokenStaffAllowEnvSet();
}

export interface StaffGitHubLoginStatus {
  available: boolean;
  siteUrl: string | null;
  callbackUrl: string | null;
  siteUrlLookSuspicious: boolean;
  connectionTokenStaffAllowed: boolean;
}

export function getStaffGitHubLoginStatus(): StaffGitHubLoginStatus {
  const available = isStaffGitHubLoginAvailable();
  const parsed = parseStaffSiteUrl();
  const durable =
    parsed && !isLoopbackHost(parsed.host) ? parsed : null;
  const siteUrlLookSuspicious = durable
    ? isSuspiciousPublicSiteHost(durable.host)
    : false;

  return {
    available,
    siteUrl: durable ? durable.origin : null,
    callbackUrl: durable ? getOAuthCallbackUrl() : null,
    siteUrlLookSuspicious,
    connectionTokenStaffAllowed: isConnectionTokenStaffAllowed(),
  };
}
