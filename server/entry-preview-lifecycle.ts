/**
 * Schedule entry-preview / OG capture from pipeline lifecycle events.
 * Mirrors on-save validation: live locales only, idempotent queue keys.
 */

import type { ContentEvent } from "./events/types";
import { getSiteContextMap } from "./site-manager";
import { maybeEnqueueAfterEntrySave } from "./entry-preview-capture-queue";
import { getContentTypeConfig, getAllTypes, getPreviewConfig } from "./content-types";
import { isPreviewCaptureReady } from "./entry-preview-config";
import { cloudflareBrowserConfigError } from "./cloudflare-browser";
import { normalizeLocale } from "./settings";
import { child } from "./logger";

const log = child({ module: "entry-preview-lifecycle" });

function resolveSite(siteName: string) {
  for (const ctx of getSiteContextMap().values()) {
    if (ctx.contentRootName === siteName || ctx.domain === siteName) return ctx;
  }
  // Prefer contentRootName match from event.site (usually content root name)
  const byName = [...getSiteContextMap().values()].find((c) => c.contentRootName === siteName);
  return byName || null;
}

/**
 * After live entry_locale_saved / entry_locale_promoted — enqueue capture when needed.
 */
export async function scheduleOgCaptureFromLocaleEvent(event: ContentEvent): Promise<void> {
  const { contentType, slug, locale } = event.resource;
  if (!contentType || !slug || !locale) return;

  const site = resolveSite(event.site);
  if (!site) {
    log.warn({ site: event.site }, "[entry-preview-lifecycle] unknown site");
    return;
  }

  const preview = getPreviewConfig(contentType, site.contentRoot);
  if (!isPreviewCaptureReady(preview)) return;

  try {
    const { queryEntries } = await import("./query-entries");
    const loc = normalizeLocale(locale);
    const { items } = await queryEntries(
      { from: { contentType }, locale: loc },
      {
        db: site.database,
        contentIndex: site.contentIndex,
        contentRoot: site.contentRoot,
      },
    );
    const entry =
      items.find((i) => String(i.slug ?? "") === slug) ||
      ({ slug, lang: loc, locale: loc } as Record<string, unknown>);

    const result = await maybeEnqueueAfterEntrySave(site, {
      contentType,
      slug,
      locale: loc,
      entry: entry as Record<string, unknown>,
    });
    if (result.enqueued) {
      log.info(
        { contentType, slug, locale: loc, key: result.reason },
        "[entry-preview-lifecycle] enqueued after pipeline event",
      );
    }
  } catch (err) {
    log.warn({ err, contentType, slug, locale }, "[entry-preview-lifecycle] enqueue failed");
  }
}

/**
 * Boot bridge: re-queue dirty/missing (not failed, not hand-picked) for all configured types.
 */
export async function requeueDirtyEntryPreviewsOnBoot(): Promise<void> {
  for (const site of getSiteContextMap().values()) {
    if (cloudflareBrowserConfigError(site.contentRoot)) continue;
    const types = getAllTypes(site.contentRoot);
    for (const contentType of types) {
      const preview = getPreviewConfig(contentType, site.contentRoot);
      if (!isPreviewCaptureReady(preview)) continue;
      const config = getContentTypeConfig(contentType, site.contentRoot);
      if (!config) continue;

      try {
        const { enqueueEntryPreviewsForType } = await import("./entry-preview-capture-queue");
        const { queryEntries } = await import("./query-entries");
        const { items } = await queryEntries(
          { from: { contentType } },
          {
            db: site.database,
            contentIndex: site.contentIndex,
            contentRoot: site.contentRoot,
          },
        );
        const locales = new Set<string>();
        for (const item of items) {
          const loc = normalizeLocale(
            String(item.lang ?? item.locale ?? item.language ?? "en"),
          );
          locales.add(loc);
        }
        if (locales.size === 0) continue;
        const result = await enqueueEntryPreviewsForType(site, {
          contentType,
          locales: [...locales],
          mode: "missing",
          overwrite: false,
        });
        if (result.enqueued.length > 0) {
          log.info(
            {
              site: site.contentRootName,
              contentType,
              enqueued: result.enqueued.length,
            },
            "[entry-preview-lifecycle] boot re-queue",
          );
        }
      } catch (err) {
        log.warn(
          { err, site: site.contentRootName, contentType },
          "[entry-preview-lifecycle] boot re-queue failed",
        );
      }
    }
  }
}
