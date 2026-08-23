/**
 * Shared post-write flush for content edits (single-edit and bulk-meta).
 * Call immediately after one successful edit, or once at end of a bulk batch.
 *
 * Default path is non-blocking: scanFast + coalesced background scanSlow,
 * path-scoped HTML bust (no full HTML cache clear). Pass syncSlow when the
 * written file(s) change redirects.
 */

import type { ContentIndex } from "./content-index";
import { clearRedirectCache, toPublicUrlPath } from "./redirects";
import {
  refreshSitemapEntry,
  refreshSitemapEntriesForContentKey,
} from "./sitemap";
import { invalidateContentCachesWithoutHtml } from "./routes/_helpers";
import { getSupportedLocales } from "./settings";
import * as fs from "fs";
import * as path from "path";

export type SitemapFlushEntry = {
  contentType: string;
  slug: string;
  locale: string;
};

export type FlushAfterContentWritesOpts = {
  ci: ContentIndex;
  /** Distinct content types touched (cache invalidation). */
  contentTypes: Iterable<string>;
  /** Entries that need sitemap refresh. */
  sitemapEntries: SitemapFlushEntry[];
  /**
   * When true (common-meta / _common.yml touched), refresh all locales per
   * content key instead of a single locale row.
   */
  commonMetaTouched?: boolean;
  /**
   * Site id for HTML cache keys (contentRootName — same as render-hub-html).
   * Required for path-scoped HTML bust.
   */
  siteId?: string;
  /** Public pathnames to bust in the HTML page cache (all variants per path). */
  htmlPaths?: string[];
  /** When true, run sync slow scan (redirect-critical writes). */
  syncSlow?: boolean;
  /** Relative or absolute paths written — triggers single-entry upsert (no full scan). */
  savedFilePaths?: string[];
};

/**
 * Coalesce expensive post-write side effects: redirect cache, CI refresh,
 * content caches, sitemap, path-scoped HTML. Does not mark files modified
 * or enqueue previews.
 */
export function flushAfterContentWrites(opts: FlushAfterContentWritesOpts): void {
  const types = [...new Set([...opts.contentTypes].filter(Boolean))];
  clearRedirectCache();

  if (opts.syncSlow === true) {
    opts.ci.refresh({ syncSlow: true });
  } else if (opts.savedFilePaths?.length) {
    for (const fp of opts.savedFilePaths) {
      try {
        opts.ci.upsertEntry(fp);
      } catch {
        /* non-fatal */
      }
    }
  }

  if (types.length === 0) {
    invalidateContentCachesWithoutHtml(undefined, opts.ci);
  } else {
    for (const contentType of types) {
      invalidateContentCachesWithoutHtml(contentType, opts.ci);
    }
  }

  const siteId = opts.siteId;
  const paths = opts.htmlPaths?.filter(Boolean) ?? [];
  if (siteId && paths.length > 0) {
    void import("./html-page-cache")
      .then(({ invalidateHtmlPageCacheForPath }) => {
        const seen = new Set<string>();
        for (const p of paths) {
          const clean = p.split("?")[0].split("#")[0] || "/";
          if (seen.has(clean)) continue;
          seen.add(clean);
          invalidateHtmlPageCacheForPath(siteId, clean);
        }
      })
      .catch(() => {});
  }

  const locales = getSupportedLocales();
  const seenKeys = new Set<string>();
  for (const entry of opts.sitemapEntries) {
    if (opts.commonMetaTouched) {
      const key = `${entry.contentType}/${entry.slug}`;
      if (seenKeys.has(key)) continue;
      seenKeys.add(key);
      refreshSitemapEntriesForContentKey(entry.contentType, entry.slug, locales);
    } else {
      const key = `${entry.contentType}/${entry.slug}/${entry.locale}`;
      if (seenKeys.has(key)) continue;
      seenKeys.add(key);
      refreshSitemapEntry(entry.contentType, entry.slug, entry.locale);
    }
  }
}

/** True when YAML content likely defines redirects (meta or top-level). */
export function yamlMentionsRedirects(raw: string): boolean {
  return (
    /(^|\n)\s*redirects\s*:/.test(raw) ||
    /\nmeta:[\s\S]*?redirects\s*:/.test(raw)
  );
}

/** Read a content file and detect redirect keys (missing file → false). */
export function fileMentionsRedirects(absOrRelPath: string): boolean {
  try {
    const abs = path.isAbsolute(absOrRelPath)
      ? absOrRelPath
      : path.join(process.cwd(), absOrRelPath);
    if (!fs.existsSync(abs)) return false;
    return yamlMentionsRedirects(fs.readFileSync(abs, "utf-8"));
  } catch {
    return false;
  }
}

/**
 * Public pathnames for an entry (locale preferred, plus all alternates).
 * Used for path-scoped HTML cache bust — not shared-template fan-out.
 */
export function collectEntryHtmlPaths(
  ci: ContentIndex,
  contentType: string,
  slug: string,
  locale?: string,
): string[] {
  const paths: string[] = [];
  const seen = new Set<string>();
  const add = (raw: string | null | undefined) => {
    if (!raw || typeof raw !== "string") return;
    const clean = toPublicUrlPath(raw);
    if (!clean || seen.has(clean)) return;
    seen.add(clean);
    paths.push(clean);
  };

  try {
    const urls = ci.getAlternateUrls(slug, contentType);
    if (locale && urls[locale]) add(urls[locale]);
    for (const u of Object.values(urls)) add(u);
  } catch {
    /* ignore */
  }

  if (paths.length === 0) {
    try {
      const loc = locale || "en";
      add(ci.buildUrl(contentType, loc, slug));
    } catch {
      /* ignore */
    }
  }

  // Home aliases when the canonical path is a locale home
  for (const p of [...paths]) {
    if (p === "/en" || p === "/en/") {
      add("/");
    }
  }

  return paths;
}
