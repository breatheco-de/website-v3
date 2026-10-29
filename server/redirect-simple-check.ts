/**
 * Checks for a "simple" redirect added from the SEO modal: one exact old path
 * that sends visitors to this page. Anything that would collide with a live URL
 * or an existing redirect rule is blocked; staff resolve those on the Redirects page.
 */

import { isLocaleHomeAlias, isPublicHtmlStaticPath } from "@shared/public-app-routes";
import type { ContentIndex } from "./content-index";
import { getFreshRedirectEntries, isLiveContentUrl, isRegexPattern, testRedirect } from "./redirects";

export type SimpleRedirectBlockCode =
  | "invalid_path"
  | "locale_home"
  | "self_redirect"
  | "live_content"
  | "already_redirected"
  | "pattern_match";

export type SimpleRedirectCheck =
  | { ok: true; normalizedFrom: string }
  | {
      ok: false;
      code: SimpleRedirectBlockCode;
      message: string;
      normalizedFrom?: string;
      conflict_source?: string;
      conflict_from?: string;
      conflict_to?: string;
    };

const APP_PREFIXES = ["/api/", "/private/", "/assets/", "/mcp"];

function normalizeFrom(p: string): string {
  let n = p.toLowerCase();
  if (!n.startsWith("/")) n = `/${n}`;
  if (n.length > 1 && n.endsWith("/")) n = n.slice(0, -1);
  return n;
}

function bareHost(host: string): string {
  return host.toLowerCase().replace(/^www\./, "").replace(/:\d+$/, "");
}

function targetLabel(to: string | Record<string, string> | undefined, locale: string): string {
  if (!to) return "";
  if (typeof to === "string") return to;
  return to[locale] ?? Object.values(to)[0] ?? "";
}

/** Turn staff input into a site path, or explain why it is not one. */
export function parseSimpleRedirectPath(
  raw: string,
  allowedHosts: string[] = [],
): { ok: true; path: string } | { ok: false; message: string } {
  const input = (raw ?? "").trim();
  if (!input) return { ok: false, message: "Enter the old path, for example /old-page." };

  let pathPart = input;
  if (/^[a-z][a-z0-9+.-]*:/i.test(input) || input.startsWith("//")) {
    let url: URL;
    try {
      url = new URL(input.startsWith("//") ? `https:${input}` : input);
    } catch {
      return { ok: false, message: "That is not a valid address. Enter a path like /old-page." };
    }
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      return { ok: false, message: "Enter a path on this site, like /old-page." };
    }
    const hosts = allowedHosts.filter(Boolean).map(bareHost);
    if (!hosts.includes(bareHost(url.host))) {
      return { ok: false, message: `Only paths on this site can redirect here (got ${url.host}).` };
    }
    if (url.search || url.hash) {
      return { ok: false, message: "Leave out the ? and # parts; redirects match the path only." };
    }
    pathPart = url.pathname;
  } else if (input.includes("?") || input.includes("#")) {
    return { ok: false, message: "Leave out the ? and # parts; redirects match the path only." };
  }

  if (/\s/.test(pathPart)) return { ok: false, message: "Paths cannot contain spaces." };
  if (isRegexPattern(pathPart)) {
    return {
      ok: false,
      message: "This looks like a pattern. Pattern redirects are managed on the Redirects page.",
    };
  }
  return { ok: true, path: normalizeFrom(pathPart) };
}

/**
 * Whether `from` can be added as a simple redirect to `destUrl`.
 * Order matters: the first failing check is the one staff see.
 */
export function checkSimpleRedirectFrom(opts: {
  from: string;
  destUrl: string;
  locale: string;
  ci: ContentIndex;
  allowedHosts?: string[];
}): SimpleRedirectCheck {
  const { ci, locale } = opts;
  const parsed = parseSimpleRedirectPath(opts.from, opts.allowedHosts);
  if (!parsed.ok) return { ok: false, code: "invalid_path", message: parsed.message };
  const from = parsed.path;

  if (isLocaleHomeAlias(from)) {
    return {
      ok: false,
      code: "locale_home",
      normalizedFrom: from,
      message: `${from} is a homepage address and cannot redirect to a page.`,
    };
  }

  const dest = ci.parseContentUrl(opts.destUrl);
  const ownUrls = new Set<string>([normalizeFrom(opts.destUrl.split(/[?#]/)[0]!)]);
  if (dest) {
    for (const url of Object.values(ci.getAlternateUrls(dest.slug, dest.contentType))) {
      if (url) ownUrls.add(normalizeFrom(url));
    }
  }
  if (ownUrls.has(from)) {
    return {
      ok: false,
      code: "self_redirect",
      normalizedFrom: from,
      message: `${from} is this page's own address. Redirecting it here would loop.`,
    };
  }

  if (
    isLiveContentUrl(from, ci) ||
    isPublicHtmlStaticPath(from) ||
    APP_PREFIXES.some((p) => from === p.replace(/\/$/, "") || from.startsWith(p))
  ) {
    return {
      ok: false,
      code: "live_content",
      normalizedFrom: from,
      message: `${from} is already a live page. A redirect would hide it.`,
    };
  }

  const entries = getFreshRedirectEntries(ci);
  const exact = entries.find((e) => !isRegexPattern(e.from) && normalizeFrom(e.from) === from);
  if (exact) {
    const to = targetLabel(exact.to, locale);
    const here = ownUrls.has(normalizeFrom(to));
    return {
      ok: false,
      code: "already_redirected",
      normalizedFrom: from,
      conflict_source: exact.source,
      conflict_from: exact.from,
      conflict_to: to,
      message: here
        ? `${from} already redirects to this page.`
        : `${from} already redirects to ${to || "another address"}.`,
    };
  }

  for (const e of entries) {
    if (!isRegexPattern(e.from)) continue;
    let re: RegExp;
    try {
      re = new RegExp(`^${e.from}$`, "i");
    } catch {
      continue;
    }
    if (!re.test(from)) continue;
    return {
      ok: false,
      code: "pattern_match",
      normalizedFrom: from,
      conflict_source: e.source,
      conflict_from: e.from,
      conflict_to: targetLabel(e.to, locale),
      message: `${from} is already handled by the pattern rule ${e.from}.`,
    };
  }

  const tested = testRedirect(from, locale, ci);
  if (tested.match && tested.matchType === "canonical") {
    return {
      ok: false,
      code: "already_redirected",
      normalizedFrom: from,
      conflict_source: tested.source,
      conflict_to: tested.resolvedTo,
      message: `${from} already redirects automatically to ${tested.resolvedTo}.`,
    };
  }

  return { ok: true, normalizedFrom: from };
}

export function redirectsPageUrl(from: string): string {
  return `/private/redirects?url=${encodeURIComponent(from)}`;
}
