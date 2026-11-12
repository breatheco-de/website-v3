/**
 * Internal links on a page that the server redirects to another host (`_external_redirects`).
 * An in-app click on such a link never reaches the server, so the client does a full-page
 * navigation for these paths and adds `gtm_payload`; the 301 keeps the query string.
 */

import type { ContentIndex } from "./content-index";
import { applyCaptureGroups, matchSiteRedirect } from "./redirects";
import type { PageTrackingContext } from "@shared/tracking-context";

const MAX_STRINGS = 3000;
const MAX_DEPTH = 12;
const ASSET_PATH = /\.[a-z0-9]{2,5}$/i;
const SKIP_PREFIX = /^\/(api|assets|private|@)\b/;

function internalPath(value: string): string | null {
  const s = value.trim();
  if (!s.startsWith("/") || s.startsWith("//") || s.length > 300) return null;
  const path = s.split(/[?#]/)[0] ?? "";
  if (!path || path === "/" || SKIP_PREFIX.test(path) || ASSET_PATH.test(path)) return null;
  const lower = path.toLowerCase();
  return lower.length > 1 && lower.endsWith("/") ? lower.slice(0, -1) : lower;
}

function collectPaths(data: unknown): Set<string> {
  const out = new Set<string>();
  let seen = 0;
  const walk = (node: unknown, depth: number) => {
    if (seen > MAX_STRINGS || depth > MAX_DEPTH || node == null) return;
    if (typeof node === "string") {
      seen++;
      const p = internalPath(node);
      if (p) out.add(p);
      return;
    }
    if (Array.isArray(node)) {
      for (const item of node) walk(item, depth + 1);
      return;
    }
    if (typeof node === "object") {
      for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
        if (key.startsWith("_")) continue;
        walk(value, depth + 1);
      }
    }
  };
  walk(data, 0);
  return out;
}

function externalHost(target: string, ownHosts: Set<string>): string | null {
  if (!/^https?:\/\//i.test(target)) return null;
  try {
    const host = new URL(target).host.toLowerCase();
    return ownHosts.has(host) ? null : host;
  } catch {
    return null;
  }
}

/** `{ "/apply": "learn.4geeks.com" }` for internal paths in `pageData` that redirect off-site. */
export function collectExternalRedirects(
  pageData: unknown,
  ci: ContentIndex,
  ownHosts: string[],
): Record<string, string> {
  const own = new Set(ownHosts.filter(Boolean).map((h) => h.toLowerCase()));
  const out: Record<string, string> = {};
  for (const path of Array.from(collectPaths(pageData))) {
    const hit = matchSiteRedirect(ci, path);
    if (!hit) continue;
    const targets = typeof hit.entry.to === "string" ? [hit.entry.to] : Object.values(hit.entry.to ?? {});
    for (const raw of targets) {
      if (typeof raw !== "string") continue;
      const host = externalHost(applyCaptureGroups(raw, hit.captureGroups), own);
      if (host) {
        out[path] = host;
        break;
      }
    }
  }
  return out;
}

/** Checkout path = decision page, or a page with tracking context but no stage. */
export function isCheckoutPathContext(tracking: PageTrackingContext | null | undefined): boolean {
  if (!tracking) return false;
  return !tracking.funnel_stage || tracking.funnel_stage === "decision";
}

/** Own hostnames for a site: domain, `www.` variant, aliases, and the request host. */
export function siteOwnHosts(site: { config?: { domain?: string; aliases?: string[] } } | undefined, requestHost?: string): string[] {
  const domain = site?.config?.domain?.toLowerCase();
  const hosts = [requestHost, domain, domain ? `www.${domain}` : undefined, ...(site?.config?.aliases ?? [])];
  return hosts.filter((h): h is string => typeof h === "string" && !!h);
}
