import type { ContentTypeApiItem } from "@/hooks/useContentTypes";

export const REGIONAL_LOCALE_RE = /^[a-z]{2}-[a-z]{2}$/;

export type ContentRouteKind = "template" | "database-single" | "content-type-detail";

export interface ContentTypeRoute {
  path: string;
  type: string;
  locale: string;
  urlPattern: Record<string, string>;
  kind: ContentRouteKind;
  isListingPrefix: boolean;
  regional: boolean;
}

export type ContentTypeRouteInput = Pick<
  ContentTypeApiItem,
  "name" | "url_pattern" | "has_database" | "single_template"
>;

function routeKind(ct: ContentTypeRouteInput): ContentRouteKind {
  if (ct.name === "page") return "template";
  if (ct.has_database || ct.single_template) return "database-single";
  return "content-type-detail";
}

function wouterPath(pattern: string, splatSlug: boolean): string {
  if (splatSlug) return pattern.replace(":slug", "*");
  return pattern;
}

export function listingPrefix(pattern: string): string | null {
  const prefix = pattern.replace(/\/:[^/]+.*$/, "");
  if (!prefix || prefix === pattern) return null;
  return prefix;
}

/** `/en/foo/:slug` → `/:locale/foo/:slug`. Null if the pattern is not locale-prefixed. */
export function regionalAlias(pattern: string): string | null {
  const m = pattern.match(/^\/(en|es)(\/.*)$/);
  if (!m?.[2]) return null;
  return `/:locale${m[2]}`;
}

function pathScore(path: string): { staticSegs: number; segs: number } {
  const segs = path.split("/").filter(Boolean);
  return {
    segs: segs.length,
    staticSegs: segs.filter((s) => !s.startsWith(":")).length,
  };
}

function sortContentTypeRoutes(routes: ContentTypeRoute[]): ContentTypeRoute[] {
  return [...routes].sort((a, b) => {
    const aPage = a.type === "page" ? 1 : 0;
    const bPage = b.type === "page" ? 1 : 0;
    if (aPage !== bPage) return aPage - bPage;
    const as = pathScore(a.path);
    const bs = pathScore(b.path);
    if (bs.staticSegs !== as.staticSegs) return bs.staticSegs - as.staticSegs;
    if (bs.segs !== as.segs) return bs.segs - as.segs;
    return a.path.localeCompare(b.path);
  });
}

function pushRoute(
  routes: ContentTypeRoute[],
  seen: Set<string>,
  route: ContentTypeRoute,
): void {
  const key = `${route.path}\0${route.type}\0${route.kind}\0${route.isListingPrefix}\0${route.regional}`;
  if (seen.has(key)) return;
  seen.add(key);
  routes.push(route);
}

export function buildContentTypeRoutes(
  contentTypes: ContentTypeRouteInput[] | null | undefined,
): ContentTypeRoute[] {
  if (!contentTypes?.length) return [];

  const routes: ContentTypeRoute[] = [];
  const seen = new Set<string>();

  for (const ct of contentTypes) {
    if (!ct.url_pattern) continue;
    const kind = routeKind(ct);

    for (const [locale, pattern] of Object.entries(ct.url_pattern)) {
      if (!pattern) continue;

      const splatSlug = ct.has_database && kind !== "template";

      if (splatSlug) {
        const prefix = listingPrefix(pattern);
        if (prefix) {
          pushRoute(routes, seen, {
            path: prefix,
            type: ct.name,
            locale,
            urlPattern: ct.url_pattern,
            kind: "template",
            isListingPrefix: true,
            regional: false,
          });
          const regionalPrefix = regionalAlias(prefix);
          if (regionalPrefix) {
            pushRoute(routes, seen, {
              path: regionalPrefix,
              type: ct.name,
              locale: "regional",
              urlPattern: ct.url_pattern,
              kind: "template",
              isListingPrefix: true,
              regional: true,
            });
          }
        }
      }

      pushRoute(routes, seen, {
        path: wouterPath(pattern, splatSlug),
        type: ct.name,
        locale,
        urlPattern: ct.url_pattern,
        kind,
        isListingPrefix: false,
        regional: false,
      });

      const alias = regionalAlias(pattern);
      if (alias) {
        pushRoute(routes, seen, {
          path: wouterPath(alias, splatSlug),
          type: ct.name,
          locale: "regional",
          urlPattern: ct.url_pattern,
          kind,
          isListingPrefix: false,
          regional: true,
        });
      }
    }
  }

  return sortContentTypeRoutes(routes);
}

function patternToRegex(pattern: string): RegExp {
  const body = pattern
    .split("/")
    .map((seg) => {
      if (!seg) return "";
      if (seg === "*") return ".+";
      if (seg.startsWith(":")) return "[^/]+";
      return seg.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    })
    .join("/");
  return new RegExp(`^${body}/?$`);
}

export function matchContentTypeRoute(
  pathname: string,
  routes: ContentTypeRoute[],
): ContentTypeRoute | null {
  const path = pathname.length > 1 ? pathname.replace(/\/$/, "") : pathname;
  for (const route of routes) {
    if (!patternToRegex(route.path).test(path)) continue;
    if (route.regional) {
      const locale = path.split("/").filter(Boolean)[0] ?? "";
      if (!REGIONAL_LOCALE_RE.test(locale)) continue;
    }
    return route;
  }
  return null;
}

/** Which lazy page chunk to preload for a public URL. */
export function inferPublicPageChunk(
  pathname: string,
  contentTypes?: ContentTypeRouteInput[] | null,
): ContentRouteKind {
  const match = matchContentTypeRoute(pathname, buildContentTypeRoutes(contentTypes));
  return match?.kind ?? "template";
}

const SITEMAP_LOCALE_PREFIXES = new Set(["en", "es", "us"]);

export type SitemapFolderContentTypes = Record<
  string,
  { directory: string; url_pattern: Record<string, string> }
>;

function normalizeFolderPath(folderPath: string): string {
  const withSlash = folderPath.startsWith("/") ? folderPath : `/${folderPath}`;
  return withSlash.length > 1 ? withSlash.replace(/\/$/, "") : withSlash;
}

function isLocaleOnlyPrefix(prefix: string): boolean {
  const segs = prefix.split("/").filter(Boolean);
  return segs.length === 1 && SITEMAP_LOCALE_PREFIXES.has(segs[0]);
}

/** Shared content_type across folder URLs, or null when missing/mixed. */
export function consensusSitemapContentType(
  urls: Array<{ content_type?: string }>,
): string | null {
  let type: string | null = null;
  for (const url of urls) {
    if (!url.content_type) return null;
    if (type === null) type = url.content_type;
    else if (url.content_type !== type) return null;
  }
  return type;
}

/**
 * Content type dashboard target for a Content URLs folder, or null when the
 * folder is a locale bucket, category path, mixed types, or types are unloaded.
 */
export function contentTypeForSitemapFolder(
  folderPath: string,
  contentTypes: SitemapFolderContentTypes | null | undefined,
  consensusType?: string | null,
): string | null {
  if (!contentTypes || !consensusType || !contentTypes[consensusType]) return null;
  const path = normalizeFolderPath(folderPath);

  const previewMatch = path.match(/^\/private\/preview\/([^/]+)$/);
  if (previewMatch) {
    const name = previewMatch[1];
    if (name === consensusType) return consensusType;
    if (contentTypes[consensusType].directory === name) return consensusType;
    return null;
  }

  let bestLen = -1;
  let matched = false;
  for (const pattern of Object.values(contentTypes[consensusType].url_pattern ?? {})) {
    const prefix = listingPrefix(pattern);
    if (!prefix || isLocaleOnlyPrefix(prefix)) continue;

    if (path === prefix) {
      matched = true;
      if (prefix.length > bestLen) bestLen = prefix.length;
      continue;
    }

    const alias = regionalAlias(prefix);
    if (!alias) continue;
    const segs = path.split("/").filter(Boolean);
    if (segs.length < 2 || !REGIONAL_LOCALE_RE.test(segs[0])) continue;
    const rest = `/${segs.slice(1).join("/")}`;
    const aliasRest = alias.replace(/^\/:locale/, "") || "/";
    if (rest === aliasRest) {
      matched = true;
      if (prefix.length > bestLen) bestLen = prefix.length;
    }
  }

  return matched ? consensusType : null;
}
