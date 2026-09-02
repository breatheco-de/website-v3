/**
 * Outbox dispatcher: maps unpublished events to Sidequest jobs.
 */

import {
  getUnpublishedEvents,
  markEventsPublished,
  setDispatcherWake,
  type ContentEvent,
} from "./event-store";
import { isOutboxDispatchable } from "./types";
import { enqueueJob } from "../jobs/queue";
import { getSiteContextMap } from "../site-manager";
import { buildEntryKey } from "../../scripts/validation/shared/entryKey";
import { setPendingValidationWriteId } from "../pipeline-state";
import { scheduleOnSaveValidationJob } from "../services/onSaveValidationScheduler";
import { scheduleRedirectsValidation } from "../services/onSaveValidation";
import { queueLinkIndexRemove, entryKeysFromDeletedPaths } from "../link-index";
import { child } from "../logger";

const log = child({ module: "event-dispatcher" });

let running = false;
let scheduled = false;

function resolveSiteContext(site: string) {
  for (const ctx of getSiteContextMap().values()) {
    if (ctx.contentRootName === site) return ctx;
  }
  return null;
}

function entryKeyFromEvent(event: ContentEvent): string | null {
  const { contentType, slug, locale } = event.resource;
  if (!contentType || !slug || !locale) return null;
  return buildEntryKey(contentType, slug, locale);
}

function isLiveLocaleEvent(event: ContentEvent): boolean {
  const layer = event.resource.layer ?? event.payload.layer;
  if (layer === "variant") return false;
  if (layer === "live" || layer === "common") return layer === "live";
  return true;
}

async function enqueueIndexRefresh(event: ContentEvent, contentRoot: string): Promise<void> {
  await enqueueJob(
    "index_refresh",
    {
      site: event.site,
      contentRoot,
      generation: event.id,
    },
    { uniqueKey: `index:${event.site}`, uniqueWithArgs: false },
  );
}

async function enqueueSyncStateFlush(site: string, contentRoot: string): Promise<void> {
  await enqueueJob(
    "sync_state_flush",
    { site, contentRoot },
    { uniqueKey: `sync:${site}`, delayMs: 500 },
  );
}

async function enqueueSeoIndexRefresh(
  event: ContentEvent,
  contentRoot: string,
  mode: "patch" | "rebuild",
  entryKeys?: string[],
): Promise<void> {
  await enqueueJob(
    "seo_index_refresh",
    {
      site: event.site,
      contentRoot,
      generation: event.id,
      mode,
      triggeredByEventId: event.id,
      ...(entryKeys?.length ? { entryKeys } : {}),
    },
    {
      uniqueKey: `seo-index:${event.site}`,
      uniqueWithArgs: false,
      delayMs: mode === "rebuild" ? 5000 : 0,
    },
  );
}

async function maybeScheduleValidation(event: ContentEvent, ctx: NonNullable<ReturnType<typeof resolveSiteContext>>): Promise<void> {
  const entryKey = entryKeyFromEvent(event);
  if (!entryKey) return;
  const { contentType, slug, locale } = event.resource;
  setPendingValidationWriteId(event.site, entryKey, event.id);
  ctx.validationCache.markEntryDirty(entryKey);
  void ctx.validationCache.flush();
  if (contentType && slug && locale) {
    scheduleOnSaveValidationJob({
      site: event.site,
      contentRoot: ctx.contentRoot,
      entryKey,
      contentType,
      slug,
      locale,
    });
  }
}

async function dispatchEvent(event: ContentEvent): Promise<void> {
  const ctx = resolveSiteContext(event.site);
  if (!ctx) {
    log.warn({ site: event.site }, "[Dispatcher] Unknown site");
    return;
  }

  switch (event.type) {
    case "entry_locale_saved":
    case "entry_locale_promoted": {
      await enqueueIndexRefresh(event, ctx.contentRoot);
      if (isLiveLocaleEvent(event)) {
        await maybeScheduleValidation(event, ctx);
      }
      await enqueueSyncStateFlush(event.site, ctx.contentRoot);
      break;
    }
    case "entry_common_saved": {
      await enqueueIndexRefresh(event, ctx.contentRoot);
      await enqueueSyncStateFlush(event.site, ctx.contentRoot);
      break;
    }
    case "registry_file_saved":
    case "entry_redirects_changed": {
      await enqueueIndexRefresh(event, ctx.contentRoot);
      break;
    }
    case "entry_seo_changed": {
      if (event.payload.seoIndexSynced === true) break;
      const memberKeys = (event.payload.memberEntryKeys as string[] | undefined) ?? [];
      const hubKey = entryKeyFromEvent(event);
      const keys = hubKey ? [hubKey, ...memberKeys] : memberKeys;
      await enqueueSeoIndexRefresh(event, ctx.contentRoot, "patch", keys.length ? keys : undefined);
      break;
    }
    case "site_redirects_changed": {
      await enqueueIndexRefresh(event, ctx.contentRoot);
      scheduleRedirectsValidation({
        site: event.site,
        contentRoot: ctx.contentRoot,
      });
      break;
    }
    case "site_bulk_synced": {
      await enqueueIndexRefresh(event, ctx.contentRoot);
      const deletedPaths = (event.payload.deletedPaths as string[] | undefined) ?? [];
      if (deletedPaths.length > 0) {
        const keys = entryKeysFromDeletedPaths(deletedPaths);
        if (keys.length > 0) {
          queueLinkIndexRemove(keys, ctx.contentRoot);
        }
      }
      await enqueueSeoIndexRefresh(event, ctx.contentRoot, "rebuild");
      break;
    }
    case "entry_deleted": {
      await enqueueIndexRefresh(event, ctx.contentRoot);
      const entryKeys = (event.payload.entryKeys as string[] | undefined) ?? [];
      if (entryKeys.length > 0) {
        await enqueueJob(
          "entry_delete_cleanup",
          {
            site: event.site,
            contentRoot: ctx.contentRoot,
            entryKeys,
          },
          { uniqueKey: `delete-cleanup:${event.site}:${entryKeys.join(",")}` },
        );
      }
      break;
    }
    case "entry_locale_unpublished": {
      await enqueueIndexRefresh(event, ctx.contentRoot);
      break;
    }
    case "binding_propagation_started": {
      const p = event.payload;
      await enqueueJob(
        "binding_propagation",
        {
          site: event.site,
          contentRoot: ctx.contentRoot,
          groupId: p.groupId,
          locale: p.locale,
          sourceContentType: p.sourceContentType,
          sourceSlug: p.sourceSlug,
          sectionIndex: p.sectionIndex,
          holder: p.holder,
          token: p.token,
          startedEventId: event.id,
          author: event.attribution[0]?.author,
        },
        { uniqueKey: `binding:${p.groupId}:${p.locale}` },
      );
      break;
    }
    default:
      break;
  }
}

async function runDispatchCycle(): Promise<void> {
  if (running) {
    scheduled = true;
    return;
  }
  running = true;
  try {
    do {
      scheduled = false;
      for (const ctx of getSiteContextMap().values()) {
        const events = getUnpublishedEvents(ctx.contentRootName, 50);
        const published: number[] = [];
        for (const event of events) {
          if (!isOutboxDispatchable(event.type)) continue;
          try {
            await dispatchEvent(event);
            published.push(event.id);
          } catch (err) {
            log.error({ err, eventId: event.id }, "[Dispatcher] Failed to dispatch event");
          }
        }
        if (published.length > 0) {
          markEventsPublished(ctx.contentRootName, published);
        }
      }
    } while (scheduled);
  } finally {
    running = false;
  }
}

export function startEventDispatcher(): void {
  setDispatcherWake(() => {
    void runDispatchCycle();
  });
  void runDispatchCycle();
}

/** Test-only: dispatch a single event without outbox bookkeeping. */
export async function dispatchEventForTest(event: ContentEvent): Promise<void> {
  await dispatchEvent(event);
}
