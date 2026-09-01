import type { ContentIndex } from "./content-index";
import { createPublicUrlResolver, toPublicUrlPath } from "./redirects";

const HREF_RE = /<a\b[^>]*\shref\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/gi;
const MD_LINK_RE = /\]\((\/[^)\s]+)\)/g;
const URL_FIELD_KEYS = new Set([
  "url",
  "href",
  "cta_url",
  "link",
  "path",
  "to",
  "permalink",
]);

/** Extract raw href values from rendered HTML. */
export function extractHrefPaths(html: string): string[] {
  const out: string[] = [];
  let m: RegExpExecArray | null;
  HREF_RE.lastIndex = 0;
  while ((m = HREF_RE.exec(html)) !== null) {
    const raw = (m[1] ?? m[2] ?? m[3] ?? "").trim();
    if (!raw || raw.startsWith("#") || raw.startsWith("mailto:") || raw.startsWith("tel:")) {
      continue;
    }
    out.push(raw);
  }
  return out;
}

function hrefToPathname(href: string): string | null {
  const trimmed = href.trim();
  if (!trimmed) return null;
  try {
    if (/^https?:\/\//i.test(trimmed)) {
      return new URL(trimmed).pathname;
    }
  } catch {
    return null;
  }
  const path = trimmed.split("?")[0].split("#")[0];
  return path.startsWith("/") ? path : null;
}

export function normalizePathForMatch(
  rawPath: string,
  locale: string,
  ci: ContentIndex,
): string {
  let current = toPublicUrlPath(rawPath);
  const resolver = createPublicUrlResolver(ci, { freshRedirects: true });
  const seen = new Set<string>();
  for (let i = 0; i < 12; i++) {
    if (seen.has(current)) break;
    seen.add(current);
    const result = resolver.test(current, locale);
    if (result.match && result.resolvedTo && !/^https?:\/\//i.test(result.resolvedTo)) {
      const next = toPublicUrlPath(result.resolvedTo);
      if (next === current) break;
      current = next;
      continue;
    }
    break;
  }
  const stripped = current.endsWith("/") && current.length > 1 ? current.slice(0, -1) : current;
  return stripped.toLowerCase();
}

/**
 * Collect internal path-like strings from YAML/page data (anchors, url fields, markdown links).
 * Non-anchor UI navigations are intentionally excluded — SEO cluster best practice.
 */
export function collectInternalPathsFromData(data: unknown): string[] {
  const out: string[] = [];
  const seen = new Set<string>();

  const add = (raw: string) => {
    const pathname = hrefToPathname(raw);
    if (!pathname || seen.has(pathname)) return;
    seen.add(pathname);
    out.push(pathname);
  };

  const walk = (node: unknown, keyHint: string): void => {
    if (node == null) return;
    if (typeof node === "string") {
      const t = node.trim();
      if (!t) return;
      if (
        keyHint &&
        (URL_FIELD_KEYS.has(keyHint) || keyHint.endsWith("_url") || keyHint.endsWith("_href"))
      ) {
        if (t.startsWith("/") || /^https?:\/\//i.test(t)) add(t);
      }
      MD_LINK_RE.lastIndex = 0;
      let m: RegExpExecArray | null;
      while ((m = MD_LINK_RE.exec(t)) !== null) {
        add(m[1]);
      }
      for (const href of extractHrefPaths(t)) {
        add(href);
      }
      return;
    }
    if (Array.isArray(node)) {
      for (const item of node) walk(item, keyHint);
      return;
    }
    if (typeof node === "object") {
      for (const [k, v] of Object.entries(node as Record<string, unknown>)) {
        walk(v, k);
      }
    }
  };

  walk(data, "");
  return out;
}

/** True when collected/rendered paths include a link to targetPath (after normalize). */
export function pathsIncludeTarget(opts: {
  sourcePaths: string[];
  targetPath: string;
  locale: string;
  ci: ContentIndex;
}): boolean {
  const want = normalizePathForMatch(opts.targetPath, opts.locale, opts.ci);
  for (const raw of opts.sourcePaths) {
    const pathname = hrefToPathname(raw) ?? (raw.startsWith("/") ? raw : null);
    if (!pathname) continue;
    if (normalizePathForMatch(pathname, opts.locale, opts.ci) === want) return true;
  }
  return false;
}

export type ClusterMemberLinkTarget = {
  memberId: string;
  memberSlug: string;
  memberPath: string;
  locale: string;
};

export function findMissingMemberLinks(opts: {
  html?: string;
  sourcePaths?: string[];
  members: ClusterMemberLinkTarget[];
  ci: ContentIndex;
}): { memberPath: string; memberSlug: string; memberId: string }[] {
  const sourcePaths = [
    ...(opts.sourcePaths ?? []),
    ...(opts.html ? extractHrefPaths(opts.html) : []),
  ];
  const linked = new Set<string>();
  for (const href of sourcePaths) {
    const pathname = hrefToPathname(href) ?? (href.startsWith("/") ? href : null);
    if (!pathname) continue;
    for (const locale of [...new Set(opts.members.map((m) => m.locale))]) {
      linked.add(normalizePathForMatch(pathname, locale, opts.ci));
    }
  }

  const missing: { memberPath: string; memberSlug: string; memberId: string }[] = [];
  for (const member of opts.members) {
    const path = member.memberPath?.trim();
    if (!path) continue;
    const norm = normalizePathForMatch(path, member.locale, opts.ci);
    if (!linked.has(norm)) {
      missing.push({
        memberPath: path,
        memberSlug: member.memberSlug,
        memberId: member.memberId,
      });
    }
  }
  return missing;
}

/** True when the page links to the hub path via an anchor / url field / markdown link. */
export function pageLinksToHub(opts: {
  html?: string;
  sourcePaths?: string[];
  hubPath: string;
  locale: string;
  ci: ContentIndex;
}): boolean {
  const sourcePaths = [
    ...(opts.sourcePaths ?? []),
    ...(opts.html ? extractHrefPaths(opts.html) : []),
  ];
  return pathsIncludeTarget({
    sourcePaths,
    targetPath: opts.hubPath,
    locale: opts.locale,
    ci: opts.ci,
  });
}

export const CLUSTER_LINK_ANCHOR_ONLY_HINT =
  "Only <a href> / explicit url fields / markdown links count. Non-anchor UI navigations do not count for SEO cluster best practice.";
