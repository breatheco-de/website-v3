/**
 * Outbox dispatcher: maps unpublished events to Sidequest jobs.
 */

import {
  emitEvent,
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

async function dispatchEvent(event: ContentEvent): Promise<void> {
  const ctx = resolveSiteContext(event.site);
  if (!ctx) {
    log.warn({ site: event.site }, "[Dispatcher] Unknown site");
    return;
  }

  switch (event.type) {
    case "content_file_written":
    case "content_bulk_synced": {
      await enqueueJob(
        "index_refresh",
        {
          site: event.site,
          contentRoot: ctx.contentRoot,
          generation: event.id,
        },
        { uniqueKey: `index:${event.site}`, uniqueWithArgs: false },
      );
      if (event.type === "content_file_written") {
        const entryKey = entryKeyFromEvent(event);
        if (entryKey) {
          const { contentType, slug, locale } = event.resource;
          // Stash write id in shared SQLite (not Sidequest args) so hour-uniqueness
          // stays per entryKey while ready still closes this exact write.
          setPendingValidationWriteId(event.site, entryKey, event.id);
          const validationEnqueue = await enqueueJob(
            "on_save_validation",
            {
              site: event.site,
              contentRoot: ctx.contentRoot,
              entryKey,
              contentType,
              slug,
              locale,
            },
            { uniqueKey: `validation:${entryKey}`, delayMs: 1500 },
          );
          // Close the pipeline "validation in flight" row when Sidequest dedupes
          // (same entryKey within the uniqueness window) — otherwise the UI spins forever.
          if (validationEnqueue.deduped && contentType && slug && locale) {
            emitEvent({
              site: event.site,
              type: "validation_results_ready",
              triggeredByEventId: event.id,
              attribution: event.attribution,
              resource: { contentType, slug, locale, path: event.resource.path },
              payload: {
                entryKey,
                skipped: true,
                reason: "deduped_within_hour",
              },
            });
            log.info(
              { site: event.site, entryKey, writeEventId: event.id },
              "[Dispatcher] on_save_validation deduped — emitted skipped validation_results_ready",
            );
          }
        }
        await enqueueJob(
          "sync_state_flush",
          { site: event.site, contentRoot: ctx.contentRoot },
          { uniqueKey: `sync:${event.site}`, delayMs: 500 },
        );
      }
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
