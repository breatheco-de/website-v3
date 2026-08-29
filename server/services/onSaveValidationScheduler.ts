/**
 * App-owned debounce for on_save_validation: coalesce writes per entryKey for 1 minute,
 * then enqueue a single Sidequest job (no hour uniqueness).
 */

import { enqueueJob } from "../jobs/queue";
import { child } from "../logger";

const log = child({ module: "onSaveValidationScheduler" });

/** Coalesce window for entry-local revalidation after content writes. */
export const ON_SAVE_VALIDATION_DEBOUNCE_MS = 60_000;

type PendingSchedule = {
  timer: ReturnType<typeof setTimeout>;
  site: string;
  contentRoot: string;
  entryKey: string;
  contentType: string;
  slug: string;
  locale: string;
};

const pendingByKey = new Map<string, PendingSchedule>();

function scheduleKey(site: string, entryKey: string): string {
  return `${site}::${entryKey}`;
}

/**
 * Reset (or start) the 1-minute debounce for this entry. When the timer fires,
 * enqueues one on_save_validation job without Sidequest hour uniqueness.
 * Callers must already have stashed the latest writeEventId via setPendingValidationWriteId
 * and marked the entry dirty for validation_pending.
 */
export function scheduleOnSaveValidationJob(args: {
  site: string;
  contentRoot: string;
  entryKey: string;
  contentType: string;
  slug: string;
  locale: string;
}): void {
  const key = scheduleKey(args.site, args.entryKey);
  const existing = pendingByKey.get(key);
  if (existing) {
    clearTimeout(existing.timer);
  }

  const timer = setTimeout(() => {
    pendingByKey.delete(key);
    void enqueueJob("on_save_validation", {
      site: args.site,
      contentRoot: args.contentRoot,
      entryKey: args.entryKey,
      contentType: args.contentType,
      slug: args.slug,
      locale: args.locale,
    }).then((result) => {
      if (!result.queued) {
        log.warn(
          { site: args.site, entryKey: args.entryKey, result },
          "[OnSaveValidationScheduler] Failed to enqueue on_save_validation",
        );
      } else {
        log.info(
          { site: args.site, entryKey: args.entryKey },
          "[OnSaveValidationScheduler] Enqueued on_save_validation after debounce",
        );
      }
    });
  }, ON_SAVE_VALIDATION_DEBOUNCE_MS);

  // Allow the process to exit in tests without waiting out the debounce.
  if (typeof timer.unref === "function") {
    timer.unref();
  }

  pendingByKey.set(key, {
    timer,
    site: args.site,
    contentRoot: args.contentRoot,
    entryKey: args.entryKey,
    contentType: args.contentType,
    slug: args.slug,
    locale: args.locale,
  });
}

/** Test helper: clear pending timers. */
export function clearOnSaveValidationSchedules(): void {
  for (const p of pendingByKey.values()) {
    clearTimeout(p.timer);
  }
  pendingByKey.clear();
}

/** Test helper: how many entries are awaiting debounce fire. */
export function pendingOnSaveValidationCount(): number {
  return pendingByKey.size;
}
