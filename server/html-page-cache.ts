/**
 * In-memory LRU cache for fully rendered anonymous HTML pages.
 * Keyed by site + path + effective A/B variant (live vs traffic-receiving variant).
 * Invalidated on content sync / cache clear / traffic allocation changes; TTL is a safety net.
 */

export interface CachedHtmlPage {
  html: string;
  status: number;
  expiresAt: number;
}

const TTL_MS = 5 * 60 * 1000;
const MAX_ENTRIES = 250;

const cache = new Map<string, CachedHtmlPage>();

/**
 * @param variantKey - effective variant identity for this request (`live` or variant slug).
 *   Must be resolved (cookie / force_variant) before cache lookup so HIT/MISS is per variant.
 */
export function buildHtmlCacheKey(
  siteId: string,
  pathname: string,
  variantKey: string = "live",
): string {
  const clean = pathname.split("?")[0].split("#")[0] || "/";
  const variant = variantKey && variantKey !== "default" ? variantKey : "live";
  return `${siteId}::${clean}::${variant}`;
}

export function getCachedHtml(key: string): CachedHtmlPage | null {
  const entry = cache.get(key);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) {
    cache.delete(key);
    return null;
  }
  // Refresh LRU order
  cache.delete(key);
  cache.set(key, entry);
  return entry;
}

export function setCachedHtml(
  key: string,
  html: string,
  status: number,
): void {
  if (cache.has(key)) cache.delete(key);
  cache.set(key, {
    html,
    status,
    expiresAt: Date.now() + TTL_MS,
  });
  while (cache.size > MAX_ENTRIES) {
    const oldest = cache.keys().next().value;
    if (oldest === undefined) break;
    cache.delete(oldest);
  }
}

export function invalidateHtmlPageCache(): void {
  cache.clear();
}

/** Invalidate all cached HTML for a pathname across variants (prefix match). */
export function invalidateHtmlPageCacheForPath(
  siteId: string,
  pathname: string,
): void {
  const clean = pathname.split("?")[0].split("#")[0] || "/";
  const prefix = `${siteId}::${clean}::`;
  for (const key of [...cache.keys()]) {
    if (key.startsWith(prefix) || key === `${siteId}::${clean}`) {
      cache.delete(key);
    }
  }
}

export function htmlPageCacheSize(): number {
  return cache.size;
}

/** Skip caching personalized / editor / authenticated document requests. */
export function shouldBypassHtmlCache(req: {
  method?: string;
  headers: Record<string, unknown> | { get?(name: string): string | undefined; cookie?: string; authorization?: string };
  originalUrl?: string;
  url?: string;
}): boolean {
  const method = (req.method || "GET").toUpperCase();
  if (method !== "GET" && method !== "HEAD") return true;

  const url = req.originalUrl || req.url || "";
  // Prefer ?cache=false for anonymous fresh HTML (no edit-mode side effects).
  // edit=1 / edit_mode= / __site= also bypass (legacy / editor / multi-site).
  if (
    /[?&]cache=false(?:&|#|$)/i.test(url) ||
    url.includes("edit_mode=") ||
    url.includes("edit=1") ||
    url.includes("__site=")
  ) {
    return true;
  }

  const headers = req.headers as {
    get?(name: string): string | undefined;
    cookie?: string | string[];
    authorization?: string | string[];
  };

  const cookieRaw =
    typeof headers.get === "function"
      ? headers.get("cookie")
      : Array.isArray(headers.cookie)
        ? headers.cookie.join("; ")
        : headers.cookie;
  const cookie = typeof cookieRaw === "string" ? cookieRaw : "";
  if (
    cookie &&
    (/debug[_-]?token/i.test(cookie) ||
      /session/i.test(cookie) ||
      /auth/i.test(cookie) ||
      /edit[_-]?mode/i.test(cookie))
  ) {
    return true;
  }

  const authRaw =
    typeof headers.get === "function"
      ? headers.get("authorization")
      : Array.isArray(headers.authorization)
        ? headers.authorization[0]
        : headers.authorization;
  if (authRaw) return true;

  const debugToken =
    typeof headers.get === "function"
      ? headers.get("x-debug-token")
      : undefined;
  if (debugToken) return true;

  return false;
}
