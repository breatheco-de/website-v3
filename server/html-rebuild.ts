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
  invalidateHtmlPageCacheKey,
  listStoredHtmlCacheKeys,
  noteHtmlRebuildPending,
  parseHtmlCacheKey,
  snapshotHotHtmlPages,
} from "./html-page-cache";

const log = child({ module: "html-rebuild" });

export type HtmlRebuildQueue = "html_rebuild" | "html_rebuild_bulk";

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
  opts?: { deleteIfSlow?: boolean; queue?: HtmlRebuildQueue },
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
        queue: opts?.queue ?? "html_rebuild",
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
    const stored = listStoredHtmlCacheKeys(siteId).filter((key) => key.includes(marker));
    const targets = stored.length > 0 ? stored : [buildHtmlCacheKey(siteId, clean, "live")];
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
let contentTypeEpoch = 0;

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

/**
 * A content type's public config changed. The worker finds the stored pages,
 * and when the URL pattern changed, the old and new addresses.
 */
export function scheduleContentTypeHtmlRebuild(opts: {
  siteId: string;
  contentRoot: string;
  contentType: string;
  urlPatternChanged: boolean;
  previousUrlPattern?: Record<string, string> | string | null;
}): void {
  if (!opts.contentType) return;
  const pages = snapshotHotHtmlPages(opts.siteId);
  const epoch = ++contentTypeEpoch;
  void enqueueJob(
    "html_content_type_rebuild",
    {
      siteId: opts.siteId,
      contentRoot: contentRootForSite(opts.siteId, opts.contentRoot),
      contentType: opts.contentType,
      buildId: getHtmlBuildId(),
      pages,
      urlPatternChanged: opts.urlPatternChanged,
      previousUrlPattern: opts.previousUrlPattern ?? null,
    },
    {
      queue: "html_rebuild",
      uniqueKey: `html-content-type:${opts.siteId}:${opts.contentType}#${epoch}`,
      uniqueWhileAlive: true,
    },
  ).catch((err) => {
    log.warn({ err, contentType: opts.contentType }, "content type html rebuild enqueue failed");
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
  for (const key of listStoredHtmlCacheKeys(siteId)) {
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

/**
 * Rebuild stored copies (memory and disk). Each page renders with its own
 * site folder. Omit siteIds to cover every site. Bulk queue is for a whole
 * site (theme, Tag Manager container id) so a single-page rebuild can go first.
 */
export function scheduleHotHtmlRebuild(
  reason: string,
  opts?: { siteIds?: string[]; queue?: HtmlRebuildQueue },
): void {
  const queue = opts?.queue ?? "html_rebuild";
  const only = opts?.siteIds?.length ? new Set(opts.siteIds) : null;
  const keys = listStoredHtmlCacheKeys();
  let scheduled = 0;
  for (const key of keys) {
    const parsed = parseHtmlCacheKey(key);
    if (!parsed) continue;
    if (only && !only.has(parsed.siteId)) continue;
    scheduled += 1;
    void enqueueHtmlRebuild(
      {
        siteId: parsed.siteId,
        contentRoot: contentRootForSite(parsed.siteId),
        pathname: parsed.pathname,
        variantKey: parsed.variantKey,
      },
      { queue },
    );
  }
  log.info({ reason, keys: scheduled, queue, siteIds: opts?.siteIds }, "scheduling stored html rebuild");
}

/** Stored copies of these paths only. A path with no stored copy is left for the next visit. */
export function scheduleStoredHtmlPaths(
  siteId: string,
  pathnames: string[],
  contentRoot?: string,
  opts?: { queue?: HtmlRebuildQueue },
): void {
  const wanted = new Set(pathnames.filter(Boolean));
  if (wanted.size === 0) return;
  const root = contentRootForSite(siteId, contentRoot);
  for (const key of listStoredHtmlCacheKeys(siteId)) {
    const parsed = parseHtmlCacheKey(key);
    if (!parsed || parsed.siteId !== siteId || !wanted.has(parsed.pathname)) continue;
    void enqueueHtmlRebuild(
      {
        siteId,
        contentRoot: root,
        pathname: parsed.pathname,
        variantKey: parsed.variantKey,
      },
      { queue: opts?.queue ?? "html_rebuild" },
    );
  }
}

