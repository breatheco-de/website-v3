/**
 * Server-side entry-preview capture queue (Cloudflare Browser Run).
 * Live locales only — no variants. Locales must be specified by the caller.
 */

import { getSiteContextMap, type SiteContext } from "./site-manager";
import {
  DEFAULT_PREVIEW_WIDTH,
  hashPreviewProps,
} from "./entry-preview-manager";
import { getPreviewConfig, getLocaleKey, getContentTypeConfig } from "./content-types";
import { isPreviewCaptureReady } from "./entry-preview-config";
import { captureScreenshotToWebp, cloudflareBrowserConfigError, getPublicSiteUrl } from "./cloudflare-browser";
import { buildSignedEntryPreviewFrameUrl } from "./entry-preview-capture-auth";
import { persistGeneratedOgImageToEntryYaml } from "./entry-preview-og-yaml";
import { buildPreviewPropResolveContext } from "./entry-preview-resolve";
import { getEntryPreviewSettings, normalizeLocale } from "./settings";
import { child } from "./logger";

const log = child({ module: "entry-preview-capture-queue" });

export type CaptureMode = "missing" | "all" | "failed";

export type EntryPreviewCaptureJob = {
  contentType: string;
  slug: string;
  locale: string;
  width: number;
  theme?: "dark" | "light";
  /** Force write meta.og_image even when hand-picked. */
  overwrite?: boolean;
};

export type QueueStats = {
  pending: number;
  active: number;
  completedSession: number;
  failedSession: number;
  jobs: Array<{
    key: string;
    contentType: string;
    slug: string;
    locale: string;
    status: "pending" | "active";
  }>;
};

type InternalJob = EntryPreviewCaptureJob & {
  key: string;
  contentRootName: string;
};

/**
 * Concurrent in-flight captures per content-root.
 * From settings.yml → entry_preview.max_concurrency (SEO/GEO → OG Image).
 * Screenshot API starts are still paced process-wide in cloudflare-browser.ts.
 */
function resolveMaxConcurrency(contentRoot?: string): number {
  try {
    return getEntryPreviewSettings(contentRoot).max_concurrency;
  } catch {
    return 1;
  }
}

/** Per content-root queues */
const queues = new Map<
  string,
  {
    pending: InternalJob[];
    active: Set<string>;
    completedSession: number;
    failedSession: number;
    pumping: boolean;
  }
>();

function getQueueState(contentRootName: string) {
  let q = queues.get(contentRootName);
  if (!q) {
    q = {
      pending: [],
      active: new Set(),
      completedSession: 0,
      failedSession: 0,
      pumping: false,
    };
    queues.set(contentRootName, q);
  }
  return q;
}

export function entryPreviewJobKey(
  contentRootName: string,
  contentType: string,
  slug: string,
  locale: string,
  width: number,
): string {
  return `${contentRootName}:${contentType}:${slug}:${locale}:${width}`;
}

function resolveSiteByContentRootName(contentRootName: string): SiteContext | null {
  for (const ctx of getSiteContextMap().values()) {
    if (ctx.contentRootName === contentRootName) return ctx;
  }
  return null;
}

async function loadEntryForCapture(
  site: SiteContext,
  contentType: string,
  slug: string,
  locale: string,
): Promise<Record<string, unknown> | null> {
  const config = getContentTypeConfig(contentType, site.contentRoot);
  if (!config) return null;

  if (config.database?.slug) {
    const items = await site.database.fetchMappedItems(contentType);
    const localeKey = getLocaleKey(contentType, site.contentRoot) || "lang";
    return (
      (items.find(
        (item) =>
          String(item.slug ?? "") === slug &&
          String(item[localeKey] || "en") === locale,
      ) as Record<string, unknown> | undefined) || null
    );
  }

  const { data, error } = site.contentIndex.loadMergedContent(
    contentType as never,
    slug,
    locale,
  );
  if (error || !data || typeof data !== "object") return null;
  return data as Record<string, unknown>;
}

async function runOneJob(job: InternalJob): Promise<void> {
  const site = resolveSiteByContentRootName(job.contentRootName);
  if (!site) throw new Error(`Site not found for ${job.contentRootName}`);

  const preview = getPreviewConfig(job.contentType, site.contentRoot);
  if (!isPreviewCaptureReady(preview)) {
    throw new Error("preview_not_configured");
  }

  const configErr = cloudflareBrowserConfigError(site.contentRoot);
  if (configErr) throw new Error(configErr);

  const manager = site.entryPreviewManager;
  const locale = normalizeLocale(job.locale);
  const width = job.width || preview!.widths?.[0] || DEFAULT_PREVIEW_WIDTH;

  const previousMeta = await manager.getMeta(job.contentType, job.slug, locale, width);
  const entry = await loadEntryForCapture(site, job.contentType, job.slug, locale);
  if (!entry) throw new Error(`Entry not found: ${job.contentType}/${job.slug}@${locale}`);

  // Skip if editorial image and mode wouldn't need capture — still allow explicit dirty regen of WebP
  const theme: "dark" | "light" =
    job.theme === "light" || job.theme === "dark"
      ? job.theme
      : preview!.theme === "light"
        ? "light"
        : "dark";

  const ctx = await buildPreviewPropResolveContext({
    contentType: job.contentType,
    slug: job.slug,
    locale,
    entry,
    contentRoot: site.contentRoot,
    db: site.database,
    mediaGallery: site.mediaGallery,
    theme,
  });
  const propsHash = hashPreviewProps(preview!.props, ctx);

  const frameUrl = buildSignedEntryPreviewFrameUrl({
    contentType: job.contentType,
    slug: job.slug,
    locale,
    theme,
  });

  const { webp } = await captureScreenshotToWebp({
    url: frameUrl,
    width,
    height: preview!.maxHeight ?? 630,
    contentRoot: site.contentRoot,
  });

  const meta = await manager.upsertWebp({
    contentType: job.contentType,
    slug: job.slug,
    locale,
    width,
    buffer: webp,
    propsHash,
  });

  const typeConfig = getContentTypeConfig(job.contentType, site.contentRoot);
  const entryForYaml = await loadEntryForCapture(site, job.contentType, job.slug, locale);
  if (entryForYaml && !typeConfig?.database?.slug) {
    await persistGeneratedOgImageToEntryYaml({
      contentType: job.contentType,
      slug: job.slug,
      locale,
      publicUrl: meta.url,
      capturedAt: meta.capturedAt,
      previousGeneratedUrl: previousMeta?.url || null,
      contentRoot: site.contentRoot,
      contentRootName: site.contentRootName,
      ci: site.contentIndex,
      autoCommitQueue: site.autoCommitQueue,
      entry: entryForYaml,
      overwrite: !!job.overwrite,
    });
  }
}

async function pump(contentRootName: string): Promise<void> {
  const q = getQueueState(contentRootName);
  if (q.pumping) return;
  q.pumping = true;
  try {
    const site = resolveSiteByContentRootName(contentRootName);
    const maxConcurrency = resolveMaxConcurrency(site?.contentRoot);
    while (q.pending.length > 0 && q.active.size < maxConcurrency) {
      const job = q.pending.shift()!;
      q.active.add(job.key);
      void (async () => {
        try {
          await runOneJob(job);
          q.completedSession += 1;
          log.info({ key: job.key }, "[entry-preview-capture-queue] completed");
        } catch (err) {
          q.failedSession += 1;
          const message = err instanceof Error ? err.message : String(err);
          log.error({ key: job.key, err: message }, "[entry-preview-capture-queue] failed");
          const site = resolveSiteByContentRootName(job.contentRootName);
          if (site) {
            try {
              await site.entryPreviewManager.markFailed(
                job.contentType,
                job.slug,
                normalizeLocale(job.locale),
                job.width,
                message.slice(0, 500),
              );
            } catch {
              /* ignore secondary failure */
            }
          }
        } finally {
          q.active.delete(job.key);
          void pump(contentRootName);
        }
      })();
    }
  } finally {
    q.pumping = false;
  }
}

export function enqueueEntryPreviewCapture(
  site: SiteContext,
  job: EntryPreviewCaptureJob,
): { enqueued: boolean; key: string; reason?: string } {
  const locale = normalizeLocale(job.locale);
  const width = job.width || DEFAULT_PREVIEW_WIDTH;
  const key = entryPreviewJobKey(site.contentRootName, job.contentType, job.slug, locale, width);
  const q = getQueueState(site.contentRootName);

  if (q.active.has(key) || q.pending.some((j) => j.key === key)) {
    return { enqueued: false, key, reason: "already_queued" };
  }

  q.pending.push({
    ...job,
    locale,
    width,
    key,
    contentRootName: site.contentRootName,
  });
  void pump(site.contentRootName);
  return { enqueued: true, key };
}

export function getEntryPreviewQueueStats(contentRootName: string): QueueStats {
  const q = getQueueState(contentRootName);
  const jobs = [
    ...[...q.active].map((key) => {
      const parts = key.split(":");
      return {
        key,
        contentType: parts[1] || "",
        slug: parts[2] || "",
        locale: parts[3] || "",
        status: "active" as const,
      };
    }),
    ...q.pending.map((j) => ({
      key: j.key,
      contentType: j.contentType,
      slug: j.slug,
      locale: j.locale,
      status: "pending" as const,
    })),
  ];
  return {
    pending: q.pending.length,
    active: q.active.size,
    completedSession: q.completedSession,
    failedSession: q.failedSession,
    jobs,
  };
}

export type EntryPreviewQueueJobDetail = {
  key: string;
  contentType: string;
  slug: string;
  locale: string;
  status: "pending" | "active";
  title: string | null;
  url: string | null;
};

export type EntryPreviewQueuePage = {
  total: number;
  pending: number;
  active: number;
  completedSession: number;
  failedSession: number;
  page: number;
  pageSize: number;
  totalPages: number;
  jobs: EntryPreviewQueueJobDetail[];
};

function resolveEntryDisplayTitle(
  entry: Record<string, unknown> | null,
  slug: string,
): string {
  if (!entry) return slug;
  const meta = entry.meta;
  if (meta && typeof meta === "object" && meta !== null) {
    const pageTitle = (meta as Record<string, unknown>).page_title;
    if (typeof pageTitle === "string" && pageTitle.trim()) return pageTitle.trim();
  }
  for (const key of ["title", "name", "label"] as const) {
    const value = entry[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return slug;
}

function resolveEntryPublicUrl(
  site: SiteContext,
  contentType: string,
  slug: string,
  locale: string,
): string | null {
  try {
    const alts = site.contentIndex.getAlternateUrls(slug, contentType, {
      includeEmptyLocales: true,
    });
    const pathPart = alts[locale] || Object.values(alts)[0] || null;
    if (!pathPart) return null;
    const base = getPublicSiteUrl();
    if (!base) return pathPart;
    return `${base.replace(/\/$/, "")}${pathPart.startsWith("/") ? pathPart : `/${pathPart}`}`;
  } catch {
    return null;
  }
}

/**
 * Paginated capture queue for staff SEO/GEO → OG Image.
 * Enriches the current page with entry title + public URL.
 */
export async function getEntryPreviewQueuePage(
  site: SiteContext,
  opts?: { page?: number; pageSize?: number },
): Promise<EntryPreviewQueuePage> {
  const pageSize = Math.min(50, Math.max(1, Math.floor(opts?.pageSize ?? 10)));
  const stats = getEntryPreviewQueueStats(site.contentRootName);
  const total = stats.pending + stats.active;
  const totalPages = Math.max(1, Math.ceil(total / pageSize) || 1);
  const page = Math.min(totalPages, Math.max(1, Math.floor(opts?.page ?? 1)));
  const start = (page - 1) * pageSize;
  const slice = stats.jobs.slice(start, start + pageSize);

  const jobs: EntryPreviewQueueJobDetail[] = [];
  for (const job of slice) {
    const entry = await loadEntryForCapture(site, job.contentType, job.slug, job.locale);
    jobs.push({
      ...job,
      title: resolveEntryDisplayTitle(entry, job.slug),
      url: resolveEntryPublicUrl(site, job.contentType, job.slug, job.locale),
    });
  }

  return {
    total,
    pending: stats.pending,
    active: stats.active,
    completedSession: stats.completedSession,
    failedSession: stats.failedSession,
    page,
    pageSize,
    totalPages,
    jobs,
  };
}

export type EnqueueManyResult = {
  enqueued: string[];
  skipped: Array<{ slug: string; locale: string; reason: string }>;
  omittedLocales: string[];
};

export const ENTRY_PREVIEW_PAIRS_MAX = 50;

export type EntryPreviewEnqueuePair = { slug: string; locale: string };

/**
 * Resolve targets and enqueue. `locales` is required (non-empty) unless `pairs` is provided.
 * When `pairs` is set, only those exact slug+locale rows are considered (no slug×locale cross product).
 * Variants are never included — callers pass live locale codes only.
 */
export async function enqueueEntryPreviewsForType(
  site: SiteContext,
  opts: {
    contentType: string;
    locales: string[];
    slugs?: string[];
    /** Exact page+language pairs (max ENTRY_PREVIEW_PAIRS_MAX). Takes precedence over slug×locale fan-out. */
    pairs?: EntryPreviewEnqueuePair[];
    mode: CaptureMode;
    /** Force overwrite hand-picked meta.og_image on successful capture. */
    overwrite?: boolean;
  },
): Promise<EnqueueManyResult> {
  const preview = getPreviewConfig(opts.contentType, site.contentRoot);
  if (!isPreviewCaptureReady(preview)) {
    const err = new Error("preview_not_configured");
    (err as Error & { code?: string }).code = "preview_not_configured";
    throw err;
  }

  const pairList = Array.isArray(opts.pairs)
    ? opts.pairs
        .map((p) => ({
          slug: typeof p?.slug === "string" ? p.slug.trim() : "",
          locale: normalizeLocale(typeof p?.locale === "string" ? p.locale : ""),
        }))
        .filter((p) => p.slug && p.locale)
    : [];
  if (pairList.length > ENTRY_PREVIEW_PAIRS_MAX) {
    const err = new Error(`Too many pairs (${pairList.length}). Maximum is ${ENTRY_PREVIEW_PAIRS_MAX}.`);
    (err as Error & { code?: string }).code = "pairs_too_many";
    throw err;
  }
  const pairKeySet =
    pairList.length > 0
      ? new Set(pairList.map((p) => `${p.slug}:${p.locale}`))
      : null;

  const locales = [
    ...new Set(
      (pairKeySet
        ? pairList.map((p) => p.locale)
        : opts.locales.map((l) => normalizeLocale(l))
      ).filter(Boolean),
    ),
  ];
  if (locales.length === 0) {
    const err = new Error("locales is required and must be a non-empty array");
    (err as Error & { code?: string }).code = "locales_required";
    throw err;
  }

  const configErr = cloudflareBrowserConfigError(site.contentRoot);
  if (configErr) {
    const err = new Error(configErr);
    (err as Error & { code?: string }).code = "capture_misconfigured";
    throw err;
  }

  const manager = site.entryPreviewManager;
  const width = preview!.widths?.[0] || DEFAULT_PREVIEW_WIDTH;
  const theme: "dark" | "light" = preview!.theme === "light" ? "light" : "dark";
  const slugFilter = !pairKeySet && opts.slugs?.length ? new Set(opts.slugs) : null;
  const overwrite = !!opts.overwrite;

  const { queryEntries } = await import("./query-entries");
  const { isHandPickedOgImage } = await import("./entry-preview-og-yaml");
  const { items: allItems } = await queryEntries(
    { from: { contentType: opts.contentType } },
    {
      db: site.database,
      contentIndex: site.contentIndex,
      contentRoot: site.contentRoot,
    },
  );
  const localeKey = getLocaleKey(opts.contentType, site.contentRoot);
  const allLocales = new Set<string>();
  for (const item of allItems) {
    const loc = localeKey
      ? normalizeLocale(String(item[localeKey] || "en"))
      : normalizeLocale(String(item.lang ?? item.locale ?? item.language ?? "en"));
    allLocales.add(loc);
  }
  const omittedLocales = [...allLocales].filter((l) => !locales.includes(l)).sort();

  const enqueued: string[] = [];
  const skipped: EnqueueManyResult["skipped"] = [];

  for (const locale of locales) {
    const { items } = await queryEntries(
      {
        from: { contentType: opts.contentType },
        locale,
      },
      {
        db: site.database,
        contentIndex: site.contentIndex,
        contentRoot: site.contentRoot,
      },
    );

    for (const item of items) {
      const slug = String(item.slug ?? "");
      if (!slug) continue;
      if (pairKeySet && !pairKeySet.has(`${slug}:${locale}`)) continue;
      if (slugFilter && !slugFilter.has(slug)) continue;

      const meta = await manager.getMeta(opts.contentType, slug, locale, width);
      const entry = item as Record<string, unknown>;

      if (opts.mode === "failed") {
        if (!meta?.failedAt) {
          skipped.push({ slug, locale, reason: "not_failed" });
          continue;
        }
        await manager.retryFailed(opts.contentType, slug, locale, width);
      } else if (opts.mode === "all") {
        if (!overwrite && isHandPickedOgImage(entry, meta?.url || null)) {
          skipped.push({ slug, locale, reason: "editorial_image" });
          continue;
        }
        await manager.markDirty(opts.contentType, slug, locale, width);
      } else {
        // missing: soft path skips hand-picked social
        if (!overwrite && isHandPickedOgImage(entry, meta?.url || null)) {
          skipped.push({ slug, locale, reason: "editorial_image" });
          continue;
        }
        let propsHash: string | undefined;
        try {
          const ctx = await buildPreviewPropResolveContext({
            contentType: opts.contentType,
            slug,
            locale,
            entry,
            contentRoot: site.contentRoot,
            db: site.database,
            mediaGallery: site.mediaGallery,
            theme,
          });
          propsHash = hashPreviewProps(preview!.props, ctx);
        } catch {
          propsHash = undefined;
        }
        const needs = manager.needsCapture(meta, propsHash, true);
        if (!needs) {
          skipped.push({ slug, locale, reason: "not_needed" });
          continue;
        }
      }

      const result = enqueueEntryPreviewCapture(site, {
        contentType: opts.contentType,
        slug,
        locale,
        width,
        theme,
        overwrite,
      });
      if (result.enqueued) enqueued.push(result.key);
      else skipped.push({ slug, locale, reason: result.reason || "already_queued" });
    }
  }

  return { enqueued, skipped, omittedLocales };
}

/** Used by auto-on-save / pipeline for a single live locale. */
export async function maybeEnqueueAfterEntrySave(
  site: SiteContext,
  opts: {
    contentType: string;
    slug: string;
    locale: string;
    entry: Record<string, unknown>;
  },
): Promise<{ enqueued: boolean; reason?: string }> {
  const preview = getPreviewConfig(opts.contentType, site.contentRoot);
  if (!isPreviewCaptureReady(preview)) {
    return { enqueued: false, reason: "preview_not_configured" };
  }
  if (cloudflareBrowserConfigError(site.contentRoot)) {
    return { enqueued: false, reason: "capture_misconfigured" };
  }

  const { isHandPickedOgImage } = await import("./entry-preview-og-yaml");
  const locale = normalizeLocale(opts.locale);
  const width = preview!.widths?.[0] || DEFAULT_PREVIEW_WIDTH;
  const manager = site.entryPreviewManager;
  const meta = await manager.getMeta(opts.contentType, opts.slug, locale, width);

  if (isHandPickedOgImage(opts.entry, meta?.url || null)) {
    return { enqueued: false, reason: "editorial_image" };
  }

  // Failed stays failed until Retry / force
  if (meta?.failedAt) {
    return { enqueued: false, reason: "failed_until_retry" };
  }

  let propsHash: string | undefined;
  try {
    const theme: "dark" | "light" = preview!.theme === "light" ? "light" : "dark";
    const ctx = await buildPreviewPropResolveContext({
      contentType: opts.contentType,
      slug: opts.slug,
      locale,
      entry: opts.entry,
      contentRoot: site.contentRoot,
      db: site.database,
      mediaGallery: site.mediaGallery,
      theme,
    });
    propsHash = hashPreviewProps(preview!.props, ctx);
  } catch {
    propsHash = undefined;
  }

  // Always-on dirty props-hash for configured preview types
  if (!manager.needsCapture(meta, propsHash, true)) {
    return { enqueued: false, reason: "not_needed" };
  }

  await manager.markDirty(opts.contentType, opts.slug, locale, width);
  const result = enqueueEntryPreviewCapture(site, {
    contentType: opts.contentType,
    slug: opts.slug,
    locale,
    width,
    theme: preview!.theme === "light" ? "light" : "dark",
  });
  return { enqueued: result.enqueued, reason: result.reason };
}
