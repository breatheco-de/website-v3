/**
 * Background HTML rebuilds. The web process keeps the previous copy and asks
 * Sidequest to write a newer file. A failed enqueue deletes the copy so the
 * next visit renders on the web process.
 */

import path from "path";
import { child } from "./logger";
import { ContentIndex } from "./content-index";
import { DatabaseManager } from "./database";
import { MediaGallery } from "./media-gallery";
import { requireSiteConfigs } from "./site-config";
import type { SiteContext } from "./site-manager";
import { enqueueJob } from "./jobs/queue";
import {
  bumpHtmlGeneration,
  buildHtmlCacheKey,
  getHtmlBuildId,
  invalidateHtmlPageCache,
  invalidateHtmlPageCacheKey,
  listHotHtmlCacheKeys,
  noteHtmlRebuildPending,
  parseHtmlCacheKey,
  snapshotHotHtmlPages,
} from "./html-page-cache";

const log = child({ module: "html-rebuild" });

export type HtmlRebuildTarget = {
  siteId: string;
  contentRoot: string;
  pathname: string;
  variantKey: string;
};

function contentRootForSite(siteId: string, explicit?: string): string {
  if (explicit) return explicit;
  return path.resolve(siteId);
}

/**
 * Site slice a Sidequest HTML job needs to render. The worker has no Express
 * site map, so each job builds the index, the database, the gallery, and the
 * sites.yml config the image fallback reads.
 */
export function buildHtmlRebuildSite(contentRootInput: string, siteId?: string): SiteContext {
  const contentRoot = path.resolve(contentRootInput);
  const folderName = path.relative(process.cwd(), contentRoot) || path.basename(contentRoot);
  const id = siteId || folderName;
  const mediaGallery = new MediaGallery(folderName);
  const database = new DatabaseManager(contentRoot, mediaGallery);
  const contentIndex = new ContentIndex(contentRoot, database);
  contentIndex.scanFast();
  let domain = id;
  let contentFolder = id;
  let fallbackContentFolder: string | undefined;
  try {
    const match = requireSiteConfigs().find((site) => site.contentFolder === id);
    if (match) {
      domain = match.domain;
      contentFolder = match.contentFolder;
      fallbackContentFolder = match.fallbackContentFolder;
    }
  } catch {
    /* sites.yml unavailable */
  }
  return {
    contentRoot,
    contentRootName: id,
    domain,
    config: { domain, contentFolder, fallbackContentFolder },
    contentIndex,
    database,
    mediaGallery,
  } as SiteContext;
}

export async function enqueueHtmlRebuild(
  target: HtmlRebuildTarget,
  opts?: { deleteIfSlow?: boolean },
): Promise<boolean> {
  const key = buildHtmlCacheKey(target.siteId, target.pathname, target.variantKey);
  const generation = bumpHtmlGeneration(key);
  noteHtmlRebuildPending(key, generation, opts?.deleteIfSlow === true);
  try {
    const result = await enqueueJob(
      "html_page_rebuild",
      {
        siteId: target.siteId,
        contentRoot: contentRootForSite(target.siteId, target.contentRoot),
        pathname: target.pathname,
        variantKey: target.variantKey,
        generation,
        buildId: getHtmlBuildId(),
      },
      {
        queue: "html_rebuild",
        uniqueKey: `${key}#${generation}`,
        uniqueWhileAlive: true,
      },
    );
    if (result.queued || result.deduped) return true;
  } catch (err) {
    log.warn({ err, key }, "html rebuild enqueue failed");
  }
  log.warn(
    { pathname: target.pathname, variantKey: target.variantKey, siteId: target.siteId },
    `HTML cache dropped ${target.pathname}: rebuild job did not queue`,
  );
  invalidateHtmlPageCacheKey(key);
  return false;
}

export function scheduleSavedHtmlPaths(
  siteId: string,
  pathnames: string[],
  contentRoot?: string,
  opts?: { deleteIfSlow?: boolean },
): void {
  const deleteIfSlow = opts?.deleteIfSlow !== false;
  const root = contentRootForSite(siteId, contentRoot);
  for (const pathname of pathnames) {
    const clean = pathname.split("?")[0].split("#")[0] || "/";
    const marker = `::${siteId}::${clean}::`;
    const hot = listHotHtmlCacheKeys().filter((key) => key.includes(marker));
    const targets = hot.length > 0 ? hot : [buildHtmlCacheKey(siteId, clean, "live")];
    for (const key of targets) {
      const parsed = parseHtmlCacheKey(key);
      if (!parsed) continue;
      void enqueueHtmlRebuild(
        {
          siteId,
          contentRoot: root,
          pathname: parsed.pathname,
          variantKey: parsed.variantKey,
        },
        { deleteIfSlow },
      );
    }
  }
}

let databaseReaderEpoch = 0;
let listingEpoch = 0;

/**
 * A database row changed. The worker finds pages that read it, including ones
 * not currently in memory, and asks the web process to load the new files.
 */
export function scheduleDatabaseReaderRebuild(opts: {
  siteId: string;
  contentRoot: string;
  dbName: string;
}): void {
  if (!opts.dbName) return;
  const pages = snapshotHotHtmlPages(opts.siteId);
  const epoch = ++databaseReaderEpoch;
  void enqueueJob(
    "html_db_reader_rebuild",
    {
      siteId: opts.siteId,
      contentRoot: contentRootForSite(opts.siteId, opts.contentRoot),
      dbName: opts.dbName,
      buildId: getHtmlBuildId(),
      epoch,
      pages,
    },
    {
      queue: "html_rebuild",
      uniqueKey: `html-db-readers:${opts.siteId}:${opts.dbName}#${epoch}`,
      uniqueWhileAlive: true,
    },
  ).catch((err) => {
    log.warn({ err, dbName: opts.dbName }, "database reader rebuild enqueue failed");
  });
}

/**
 * Pages that list this content type. The worker discovers them, so a blog
 * index is rebuilt when any post is saved without naming `/en/blog`.
 */
export function scheduleContentTypeListingRebuild(opts: {
  siteId: string;
  contentRoot: string;
  contentType: string;
}): void {
  if (!opts.contentType) return;
  const pages = snapshotHotHtmlPages(opts.siteId);
  const epoch = ++listingEpoch;
  void enqueueJob(
    "html_content_type_listing_rebuild",
    {
      siteId: opts.siteId,
      contentRoot: contentRootForSite(opts.siteId, opts.contentRoot),
      contentType: opts.contentType,
      buildId: getHtmlBuildId(),
      pages,
    },
    {
      queue: "html_rebuild",
      uniqueKey: `html-listings:${opts.siteId}:${opts.contentType}#${epoch}`,
      uniqueWhileAlive: true,
    },
  ).catch((err) => {
    log.warn({ err, contentType: opts.contentType }, "content type listing rebuild enqueue failed");
  });
}

/** Keep a cached page whose URL contains this slug and rebuild it like a normal save. */
export function scheduleCachedSlugHtmlRebuild(
  siteId: string,
  slug: string,
  contentRoot?: string,
): void {
  const clean = slug.trim().replace(/^\/+|\/+$/g, "");
  if (!clean || clean.length < 2) return;
  const needle = `/${clean}`;
  const root = contentRootForSite(siteId, contentRoot);
  for (const key of listHotHtmlCacheKeys()) {
    const parsed = parseHtmlCacheKey(key);
    if (!parsed || parsed.siteId !== siteId) continue;
    const pathName = parsed.pathname;
    const matches =
      pathName === needle || pathName.endsWith(needle) || pathName.includes(`${needle}/`);
    if (!matches) continue;
    void enqueueHtmlRebuild(
      {
        siteId,
        contentRoot: root,
        pathname: parsed.pathname,
        variantKey: parsed.variantKey,
      },
      { deleteIfSlow: true },
    );
  }
}

export function scheduleHotHtmlRebuild(reason: string, contentRoot?: string): void {
  const keys = listHotHtmlCacheKeys();
  log.info({ reason, keys: keys.length }, "scheduling hot html rebuild");
  for (const key of keys) {
    const parsed = parseHtmlCacheKey(key);
    if (!parsed) continue;
    void enqueueHtmlRebuild({
      siteId: parsed.siteId,
      contentRoot: contentRootForSite(parsed.siteId, contentRoot),
      pathname: parsed.pathname,
      variantKey: parsed.variantKey,
    });
  }
}

/** GTM (or any baked id) changed: drop copies, then rebuild whatever was hot. */
export function invalidateHotHtmlAndRebuild(reason: string): void {
  const keys = listHotHtmlCacheKeys()
    .map((key) => parseHtmlCacheKey(key))
    .filter((row): row is NonNullable<typeof row> => !!row);
  invalidateHtmlPageCache();
  for (const row of keys) {
    void enqueueHtmlRebuild({
      siteId: row.siteId,
      contentRoot: contentRootForSite(row.siteId),
      pathname: row.pathname,
      variantKey: row.variantKey,
    });
  }
  log.info({ reason, keys: keys.length }, "cleared html cache and scheduled rebuild");
}
