/**
 * Pure internal-link extraction from YAML / DB field trees.
 * Single source for the link gate, BROKEN_INTERNAL_LINK, link-index and SEO cluster link checks.
 */

export type InternalLinkKind = "markdown" | "href" | "field" | "bare";

export interface InternalLinkHit {
  /** Link exactly as written in the content (trailing punctuation trimmed for bare paths). */
  link: string;
  /** Pathname used for resolution (no query / hash). */
  path: string;
  fieldPath: string;
  component?: string;
  kind: InternalLinkKind;
}

export type ExtractInternalLinkOptions = {
  /**
   * Absolute http(s) URLs: "none" skips them (default), "all" keeps their pathname,
   * or a host list keeps only those hosts (www. ignored).
   */
  absolute?: "none" | "all" | string[];
};

export const URL_FIELD_KEYS = new Set([
  "url",
  "href",
  "cta_url",
  "link",
  "path",
  "to",
  "permalink",
]);

export const HREF_RE = /<a\b[^>]*\shref\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/gi;
export const MD_LINK_RE = /\]\(\s*((?:\/|https?:\/\/)[^)\s]+)(?:\s+"[^"]*")?\s*\)/g;
const BARE_PATH_RE = /(?:^|\s)(\/(?:en|es)\/[^\s"'<>()[\]]*)/g;
const TRAILING_PUNCT_RE = /[.,;:!?'"]+$/;

/** Keys whose subtrees list legacy source paths that intentionally do not resolve. */
const SKIP_SUBTREE_KEYS = new Set(["redirects"]);

const STATIC_EXT_RE =
  /\.(?:png|jpe?g|gif|webp|avif|svg|ico|pdf|css|json|xml|txt|mp4|webm|mov|mp3|zip|woff2?|ttf|csv)$/i;
const STATIC_IMAGE_EXT_RE = /\.(?:png|jpe?g|gif|webp|avif|svg|ico)$/i;
const NON_PAGE_PREFIXES = ["/api/", "/v1/", "/attached_assets/", "/images/", "/assets/", "/uploads/", "/static/"];

function isUrlFieldKey(key: string): boolean {
  return URL_FIELD_KEYS.has(key) || key.endsWith("_url") || key.endsWith("_href");
}

function stripHost(host: string): string {
  return host.toLowerCase().replace(/^www\./, "");
}

/** Raw href/link → site pathname, or null when not an internal page link. */
export function linkToInternalPath(
  raw: string,
  opts: ExtractInternalLinkOptions = {},
): string | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  if (trimmed.startsWith("#") || /^(?:mailto|tel|javascript|data):/i.test(trimmed)) return null;
  let pathname: string;
  if (/^https?:\/\//i.test(trimmed)) {
    const absolute = opts.absolute ?? "none";
    if (absolute === "none") return null;
    let url: URL;
    try {
      url = new URL(trimmed);
    } catch {
      return null;
    }
    if (Array.isArray(absolute)) {
      const hosts = new Set(absolute.map(stripHost));
      if (!hosts.has(stripHost(url.hostname))) return null;
    }
    pathname = url.pathname;
  } else {
    if (!trimmed.startsWith("/") || trimmed.startsWith("//")) return null;
    pathname = trimmed.split("?")[0]!.split("#")[0]!;
  }
  if (!pathname) return null;
  if (NON_PAGE_PREFIXES.some((p) => pathname.startsWith(p))) return null;
  if (STATIC_EXT_RE.test(pathname)) return null;
  return pathname;
}

export function extractHrefValues(html: string): string[] {
  const out: string[] = [];
  const re = new RegExp(HREF_RE.source, "gi");
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    const raw = (m[1] ?? m[2] ?? m[3] ?? "").trim();
    if (raw) out.push(raw);
  }
  return out;
}

function hitsFromString(
  value: string,
  keyHint: string,
  fieldPath: string,
  component: string | undefined,
  opts: ExtractInternalLinkOptions,
  push: (hit: InternalLinkHit) => void,
): void {
  const text = value.trim();
  if (!text) return;

  if (keyHint && isUrlFieldKey(keyHint)) {
    const path = linkToInternalPath(text, opts);
    if (path) push({ link: text, path, fieldPath, component, kind: "field" });
    return;
  }

  if (text.includes("](")) {
    const md = new RegExp(MD_LINK_RE.source, "g");
    let m: RegExpExecArray | null;
    while ((m = md.exec(text)) !== null) {
      const path = linkToInternalPath(m[1]!, opts);
      if (path) push({ link: m[1]!, path, fieldPath, component, kind: "markdown" });
    }
  }

  if (/<a\b/i.test(text)) {
    for (const href of extractHrefValues(text)) {
      const path = linkToInternalPath(href, opts);
      if (path) push({ link: href, path, fieldPath, component, kind: "href" });
    }
  }

  const bare = new RegExp(BARE_PATH_RE.source, "g");
  let b: RegExpExecArray | null;
  while ((b = bare.exec(text)) !== null) {
    const link = b[1]!.replace(TRAILING_PUNCT_RE, "");
    const path = linkToInternalPath(link, opts);
    if (path) push({ link, path, fieldPath, component, kind: "bare" });
  }
}

export type ExternalLinkMedia = "link" | "image";

export interface ExternalLinkHit {
  /** Absolute URL without its #fragment (the part a server sees). */
  url: string;
  fieldPath: string;
  component?: string;
  media: ExternalLinkMedia;
}

export type ExtractExternalLinkOptions = {
  /** Hosts resolved offline as internal links (www. ignored); never returned here. */
  ownHosts?: string[];
};

/** Fields whose absolute value is an image, besides markdown / `<img>` in text. */
const IMAGE_FIELD_KEYS = new Set(["src", "image", "og_image", "image_url", "thumbnail"]);
const IMG_SRC_RE = /<img\b[^>]*\ssrc\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/gi;

/** Absolute http(s) URL normalized for checking, or null when it is not an external target. */
export function normalizeExternalUrl(raw: string, ownHosts: Set<string>): string | null {
  const trimmed = raw.trim();
  if (!/^https?:\/\//i.test(trimmed) || trimmed.includes("{{")) return null;
  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return null;
  }
  const host = stripHost(url.hostname);
  if (ownHosts.has(host)) return null;
  if (host === "web.archive.org" || host === "archive.org") return null;
  url.hash = "";
  return url.toString();
}

/** `[text](url)` / `![alt](url)` targets with balanced parentheses (Wikipedia-style URLs). */
function markdownTargets(text: string): Array<{ target: string; image: boolean }> {
  const out: Array<{ target: string; image: boolean }> = [];
  let i = text.indexOf("](");
  while (i !== -1) {
    const open = text.lastIndexOf("[", i);
    const image = open > 0 && text[open - 1] === "!";
    let j = i + 2;
    while (j < text.length && /\s/.test(text[j]!)) j++;
    let depth = 0;
    let end = j;
    for (; end < text.length; end++) {
      const ch = text[end]!;
      if (/\s/.test(ch)) break;
      if (ch === "(") depth++;
      else if (ch === ")") {
        if (depth === 0) break;
        depth--;
      }
    }
    const target = text.slice(j, end);
    if (target) out.push({ target, image });
    i = text.indexOf("](", end);
  }
  return out;
}

/**
 * Every external http(s) link and image in a YAML / DB tree (markdown links and images,
 * `<a href>`, `<img src>`, and URL / image fields), deduped per (field, url).
 * Own-site hosts and archive.org copies are skipped.
 */
export function extractExternalLinkHits(
  data: unknown,
  opts: ExtractExternalLinkOptions = {},
): ExternalLinkHit[] {
  const ownHosts = new Set((opts.ownHosts ?? []).map(stripHost));
  const hits: ExternalLinkHit[] = [];
  const seen = new Set<string>();
  const push = (raw: string, media: ExternalLinkMedia, fieldPath: string, component?: string) => {
    const url = normalizeExternalUrl(raw, ownHosts);
    if (!url) return;
    const key = `${fieldPath}\u0000${url}`;
    if (seen.has(key)) return;
    seen.add(key);
    hits.push({ url, fieldPath, component, media });
  };

  const fromString = (value: string, keyHint: string, fieldPath: string, component?: string) => {
    const text = value.trim();
    if (!text) return;
    if (keyHint && (isUrlFieldKey(keyHint) || IMAGE_FIELD_KEYS.has(keyHint))) {
      if (/^https?:\/\//i.test(text)) {
        const media: ExternalLinkMedia =
          IMAGE_FIELD_KEYS.has(keyHint) || STATIC_IMAGE_EXT_RE.test(text.split(/[?#]/)[0]!) ? "image" : "link";
        push(text, media, fieldPath, component);
        return;
      }
    }
    if (text.includes("](")) {
      for (const { target, image } of markdownTargets(text)) {
        push(target, image ? "image" : "link", fieldPath, component);
      }
    }
    if (/<a\b/i.test(text)) {
      for (const href of extractHrefValues(text)) push(href, "link", fieldPath, component);
    }
    if (/<img\b/i.test(text)) {
      const re = new RegExp(IMG_SRC_RE.source, "gi");
      let m: RegExpExecArray | null;
      while ((m = re.exec(text)) !== null) {
        const src = (m[1] ?? m[2] ?? m[3] ?? "").trim();
        if (src) push(src, "image", fieldPath, component);
      }
    }
  };

  const walk = (node: unknown, keyHint: string, fieldPath: string, component?: string): void => {
    if (node == null) return;
    if (typeof node === "string") {
      fromString(node, keyHint, fieldPath || "(root)", component);
      return;
    }
    if (Array.isArray(node)) {
      const underSections = fieldPath === "sections" || fieldPath.endsWith(".sections");
      node.forEach((item, index) => {
        let nextComponent = component;
        if (underSections && item && typeof item === "object" && !Array.isArray(item)) {
          const t = (item as Record<string, unknown>).type;
          if (typeof t === "string" && t.length > 0) nextComponent = t;
        }
        walk(item, keyHint, `${fieldPath}[${index}]`, nextComponent);
      });
      return;
    }
    if (typeof node === "object") {
      for (const [k, v] of Object.entries(node as Record<string, unknown>)) {
        if (SKIP_SUBTREE_KEYS.has(k)) continue;
        walk(v, k, fieldPath ? `${fieldPath}.${k}` : k, component);
      }
    }
  };

  walk(data, "", "");
  return hits;
}

/** Every internal page link in a YAML / DB tree, deduped per (field, link). */
export function extractInternalLinkHits(
  data: unknown,
  opts: ExtractInternalLinkOptions = {},
): InternalLinkHit[] {
  const hits: InternalLinkHit[] = [];
  const seen = new Set<string>();
  const push = (hit: InternalLinkHit) => {
    const key = `${hit.fieldPath}\u0000${hit.link}`;
    if (seen.has(key)) return;
    seen.add(key);
    hits.push(hit);
  };

  const walk = (node: unknown, keyHint: string, fieldPath: string, component?: string): void => {
    if (node == null) return;
    if (typeof node === "string") {
      hitsFromString(node, keyHint, fieldPath || "(root)", component, opts, push);
      return;
    }
    if (Array.isArray(node)) {
      const underSections = fieldPath === "sections" || fieldPath.endsWith(".sections");
      node.forEach((item, index) => {
        let nextComponent = component;
        if (underSections && item && typeof item === "object" && !Array.isArray(item)) {
          const t = (item as Record<string, unknown>).type;
          if (typeof t === "string" && t.length > 0) nextComponent = t;
        }
        walk(item, keyHint, `${fieldPath}[${index}]`, nextComponent);
      });
      return;
    }
    if (typeof node === "object") {
      for (const [k, v] of Object.entries(node as Record<string, unknown>)) {
        if (SKIP_SUBTREE_KEYS.has(k)) continue;
        walk(v, k, fieldPath ? `${fieldPath}.${k}` : k, component);
      }
    }
  };

  walk(data, "", "");
  return hits;
}
