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
import { captureScreenshotToWebp, cloudflareBrowserConfigError } from "./cloudflare-browser";
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

export type EnqueueManyResult = {
  enqueued: string[];
  skipped: Array<{ slug: string; locale: string; reason: string }>;
  omittedLocales: string[];
};

/**
 * Resolve targets and enqueue. `locales` is required (non-empty).
 * Variants are never included — callers pass live locale codes only.
 */
export async function enqueueEntryPreviewsForType(
  site: SiteContext,
  opts: {
    contentType: string;
    locales: string[];
    slugs?: string[];
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

  const locales = [...new Set(opts.locales.map((l) => normalizeLocale(l)).filter(Boolean))];
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
  const slugFilter = opts.slugs?.length ? new Set(opts.slugs) : null;
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
