/**
 * DEV SITE OVERRIDE — client-side half of the file-based approach
 * ================================================================
 *
 * SINGLE SOURCE OF TRUTH: .local/dev-site-override (server-side file)
 * -----------------------------------------------------------------------
 * The active site domain is stored in a plain text file on the server.
 * siteResolutionMiddleware reads it synchronously on EVERY request, which
 * means SSR, API calls, and page navigations all resolve to the correct site.
 *
 * localStorage is a CLIENT-SIDE MIRROR only.
 * -----------------------------------------------------------------------
 * We keep a copy in localStorage so that injectDevSite() can append
 * ?__site=<domain> to all API fetches as belt-and-suspenders
 * (useful e.g. after HMR before a full reload clears the in-memory cache).
 * localStorage is NEVER the source of truth for site resolution — that is
 * always the server file.
 *
 * localStorage (not cookies) keeps this working in embedded/iframe previews,
 * where browsers silently drop third-party cookies.
 *
 * Write sequence (always in this order):
 *   1. localStorage.setItem(...)   ← synchronous, instant
 *   2. await fetch("/api/dev/set-site?domain=X")  ← server writes the file
 *   3. queryClient.clear()  ← flush all cached data so components re-fetch
 *      for the new site (with ?__site= injected by the global fetch interceptor)
 *
 * In production:
 *   getDevSiteOverride() always returns null. Site resolution is driven by
 *   req.hostname (the actual domain/subdomain). No override is possible.
 */

const IS_DEV = import.meta.env.DEV;
const LS_KEY = "__dev_site";
const PENDING_DOMAIN_KEY = "__pending_domain_nav";

/**
 * Returns the active dev-site override domain, or null if none is set.
 * Reads from localStorage. Returns null in production builds.
 */
export function getDevSiteOverride(): string | null {
  if (!IS_DEV) return null;
  try {
    return localStorage.getItem(LS_KEY) || null;
  } catch { return null; }
}

/**
 * Sets the active dev-site override.
 *
 * Writes to localStorage (synchronous, for the global fetch interceptor),
 * awaits the server file write (so siteResolutionMiddleware sees the new
 * domain on the very next request), then clears the TanStack Query cache so
 * every component re-fetches data for the new site automatically.
 *
 * ⚠️  DO NOT change this to set a cookie. See the warning block above.
 */
export async function setDevSiteOverride(domain: string): Promise<void> {
  try { localStorage.setItem(LS_KEY, domain); } catch {}
  await fetch(`/api/dev/set-site?domain=${encodeURIComponent(domain)}`);
  // Lazy import to avoid circular dependency (queryClient imports getDevSiteOverride from here).
  const { queryClient } = await import("./queryClient");
  queryClient.clear();
}

/** Remember a post-restart domain switch (survives full page reload). */
export function stashPendingDomainNavigation(domain: string): void {
  try { sessionStorage.setItem(PENDING_DOMAIN_KEY, domain); } catch {}
}

/**
 * After a hard restart, re-apply the renamed domain override if the modal
 * unmounted before navigation could run.
 */
export async function resumePendingDomainNavigation(): Promise<void> {
  let pending: string | null = null;
  try { pending = sessionStorage.getItem(PENDING_DOMAIN_KEY); } catch {}
  if (!pending) return;
  try { sessionStorage.removeItem(PENDING_DOMAIN_KEY); } catch {}

  if (!IS_DEV) {
    window.location.href = `https://${pending}${window.location.pathname}${window.location.search}`;
    return;
  }

  if (getDevSiteOverride() === pending) return;
  await setDevSiteOverride(pending);
  window.location.reload();
}

/**
 * Clears the active dev-site override.
 *
 * Removes from localStorage, awaits the server file deletion, then clears
 * the TanStack Query cache so components re-fetch for the default site.
 *
 * ⚠️  DO NOT change this to clear a cookie. See the warning block above.
 */
export async function clearDevSiteOverride(): Promise<void> {
  try { localStorage.removeItem(LS_KEY); } catch {}
  await fetch("/api/dev/clear-site");
  const { queryClient } = await import("./queryClient");
  queryClient.clear();
}

/**
 * Appends ?__site=<domain> to a URL when a dev-site override is active.
 *
 * This is the single injection point — called only by the global fetch
 * interceptor installed in main.tsx. All other direct injectDevSite() call
 * sites have been removed; the interceptor covers them automatically.
 *
 * No-ops in production (getDevSiteOverride() returns null).
 */
export function injectDevSite(url: string): string {
  const site = getDevSiteOverride();
  if (!site) return url;
  if (url.includes("__site=")) return url;
  const sep = url.includes("?") ? "&" : "?";
  return `${url}${sep}__site=${encodeURIComponent(site)}`;
}
