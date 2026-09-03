/**
 * Listing SEO canonical helpers: pathname (+ optional ?page=N when page > 1).
 * Strips filters, search `q`, UTMs, and any other query keys.
 */

function normalizePathname(pathname: string): string {
  const raw = pathname.split("?")[0].split("#")[0] || "/";
  if (!raw.startsWith("/")) return `/${raw}`;
  return raw.replace(/\/{2,}/g, "/") || "/";
}

function toSearchParams(
  pageOrSearch?: number | string | URLSearchParams | null,
): URLSearchParams | null {
  if (pageOrSearch == null || pageOrSearch === "") return null;
  if (typeof pageOrSearch === "number") return null;
  if (typeof pageOrSearch !== "string") return pageOrSearch;

  if (pageOrSearch.includes("://")) {
    try {
      return new URL(pageOrSearch).searchParams;
    } catch {
      /* fall through */
    }
  }
  const q = pageOrSearch.indexOf("?");
  const qs = q >= 0 ? pageOrSearch.slice(q + 1) : pageOrSearch.startsWith("?")
    ? pageOrSearch.slice(1)
    : pageOrSearch;
  return new URLSearchParams(qs);
}

function parsePageParam(
  pageOrSearch?: number | string | URLSearchParams | null,
): number {
  if (typeof pageOrSearch === "number") {
    if (!Number.isFinite(pageOrSearch)) return 1;
    return Math.max(1, Math.floor(pageOrSearch));
  }
  const params = toSearchParams(pageOrSearch);
  if (!params) return 1;
  const raw = params.get("page");
  if (raw == null || raw === "") return 1;
  const n = parseInt(raw, 10);
  if (!Number.isFinite(n) || n < 1) return 1;
  return n;
}

/**
 * Relative listing canonical: `/en/blog` or `/en/blog?page=2`.
 * `pageOrSearch` may be a page number, a query string / URL, or URLSearchParams.
 */
export function buildListingCanonicalPath(
  pathname: string,
  pageOrSearch?: number | string | URLSearchParams | null,
): string {
  const path = normalizePathname(pathname);
  const page = parsePageParam(pageOrSearch);
  return page > 1 ? `${path}?page=${page}` : path;
}

/**
 * Absolute (or path) listing canonical from page meta + request URL query.
 * Uses the path/origin from `baseCanonical` and only the `page` param from
 * `requestUrlWithQuery` (filters/UTMs ignored).
 */
export function buildListingCanonicalHref(
  baseCanonical: string,
  requestUrlWithQuery?: string | null,
): string {
  const trimmed = baseCanonical.trim();
  if (!trimmed) return buildListingCanonicalPath("/", requestUrlWithQuery);

  let origin = "";
  let pathname = trimmed;
  try {
    if (/^[a-z][a-z0-9+.-]*:/i.test(trimmed)) {
      const u = new URL(trimmed);
      origin = u.origin;
      pathname = u.pathname;
    }
  } catch {
    // treat as path
  }

  const pageSource = requestUrlWithQuery ?? trimmed;
  const pathWithPage = buildListingCanonicalPath(pathname, pageSource);
  return origin ? `${origin}${pathWithPage}` : pathWithPage;
}
