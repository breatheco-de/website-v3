import path from "path";
import { getSiteConfigs, type SiteConfig } from "./site-config";

/** Deployment origin (no trailing slash): SITE_URL, or localhost. */
export function getBaseUrl(): string {
  if (process.env.SITE_URL) return process.env.SITE_URL.replace(/\/$/, "");
  return "http://localhost:5000";
}

function folderKey(folder: string): string {
  return path.basename(folder.replace(/\\/g, "/").replace(/\/+$/, ""));
}

function safeSiteConfigs(): SiteConfig[] {
  try {
    return getSiteConfigs();
  } catch {
    return [];
  }
}

/**
 * Public origin for a site's content root (no trailing slash).
 * Default (first) site → `getBaseUrl()` (SITE_URL / dev host); secondary sites →
 * `https://{domain}` from sites.yml. Unknown / missing content root → `getBaseUrl()`.
 */
export function getSiteBaseUrl(contentRoot?: string | null): string {
  if (!contentRoot || !contentRoot.trim()) return getBaseUrl();
  const configs = safeSiteConfigs();
  const want = folderKey(contentRoot);
  const index = configs.findIndex((c) => folderKey(c.contentFolder) === want);
  if (index <= 0) return getBaseUrl();
  return `https://${configs[index].domain.replace(/\/+$/, "")}`;
}

/** Every hostname this deployment serves: sites.yml domains + aliases, SITE_URL / dev host, localhost. */
export function getSiteHosts(): string[] {
  const hosts = new Set<string>(["localhost", "127.0.0.1"]);
  for (const c of safeSiteConfigs()) {
    hosts.add(c.domain);
    for (const a of c.aliases ?? []) hosts.add(a);
  }
  for (const raw of [process.env.SITE_URL, getBaseUrl()]) {
    if (!raw) continue;
    try {
      hosts.add(new URL(raw).host);
    } catch {
      /* ignore malformed SITE_URL */
    }
  }
  return [...hosts];
}
