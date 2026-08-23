/**
 * Derive pipeline dashboard state from events and engine metrics.
 */

import type { ContentEvent } from "./events/types";
import { primaryAuthor } from "./events/types";
import { buildEntryKey } from "../scripts/validation/shared/entryKey";
import type { EngineStatusState } from "./jobs/queue";

export const PIPELINE_STALE_THRESHOLD_MS = Number(process.env.EVENT_STALE_THRESHOLD_MS || 5 * 60 * 1000);
export const PIPELINE_DEGRADED_LAG = 10;

export function entryKeyFromEvent(event: ContentEvent): string | null {
  const { contentType, slug, locale } = event.resource;
  if (!contentType || !slug || !locale) return null;
  return buildEntryKey(contentType, slug, locale);
}

export function parseBindingLeaseResource(
  resource: string,
): { groupId: string; locale: string } | null {
  if (!resource.startsWith("binding:")) return null;
  const rest = resource.slice("binding:".length);
  const lastColon = rest.lastIndexOf(":");
  if (lastColon < 0) return null;
  return { groupId: rest.slice(0, lastColon), locale: rest.slice(lastColon + 1) };
}

export type InFlightWork = {
  indexRefresh: boolean;
  validations: Array<{ entryKey: string; sinceMs: number }>;
  propagations: Array<{ groupId: string; locale: string; holder: string; sinceMs: number }>;
};

function snapshotCoversWrite(writeEvent: ContentEvent, snapshot: ContentEvent): boolean {
  if (snapshot.triggeredByEventIds?.includes(writeEvent.id)) return true;
  const generation = snapshot.payload.generation as number | undefined;
  return typeof generation === "number" && generation >= writeEvent.id;
}

function writeNeedsIndexApply(
  writeEvent: ContentEvent,
  recentEvents: ContentEvent[],
  lastAppliedGeneration: number,
): boolean {
  if (writeEvent.id <= lastAppliedGeneration) return false;
  const hasSnapshotEvent = recentEvents.some(
    (r) => r.type === "index_snapshot_ready" && snapshotCoversWrite(writeEvent, r),
  );
  if (!hasSnapshotEvent) return true;
  return writeEvent.id > lastAppliedGeneration;
}

export function deriveInFlight(
  recentEvents: ContentEvent[],
  lastAppliedGeneration: number,
): InFlightWork {
  const now = Date.now();

  const indexRefresh = recentEvents.some(
    (e) =>
      (e.type === "content_file_written" ||
        e.type === "content_bulk_synced" ||
        e.type === "redirects_changed") &&
      writeNeedsIndexApply(e, recentEvents, lastAppliedGeneration),
  );

  const validationByEntry = new Map<string, { entryKey: string; sinceMs: number; writeId: number }>();
  for (const e of recentEvents) {
    if (e.type !== "content_file_written") continue;
    const entryKey = entryKeyFromEvent(e);
    if (!entryKey) continue;
    const hasReady = recentEvents.some(
      (r) => r.type === "validation_results_ready" && r.triggeredByEventId === e.id,
    );
    if (!hasReady) {
      const existing = validationByEntry.get(entryKey);
      if (!existing || e.id > existing.writeId) {
        validationByEntry.set(entryKey, { entryKey, sinceMs: now - e.created_at, writeId: e.id });
      }
    }
  }

  const propagationByKey = new Map<string, { groupId: string; locale: string; holder: string; sinceMs: number }>();
  for (const e of recentEvents) {
    if (e.type !== "binding_propagation_started") continue;
    const groupId = e.payload.groupId as string | undefined;
    const locale = e.payload.locale as string | undefined;
    if (!groupId || !locale) continue;
    const key = `${groupId}:${locale}`;
    const hasDone = recentEvents.some(
      (r) =>
        r.type === "binding_propagation_done" && r.triggeredByEventId === e.id,
    );
    if (!hasDone) {
      const holder = (e.payload.holder as string) || primaryAuthor(e) || "unknown";
      propagationByKey.set(key, {
        groupId,
        locale,
        holder,
        sinceMs: now - e.created_at,
      });
    }
  }

  return {
    indexRefresh,
    validations: [...validationByEntry.values()],
    propagations: [...propagationByKey.values()],
  };
}

export type PipelineOverallStatus = "ok" | "degraded" | "stalled";

export function derivePipelineOverallStatus(opts: {
  oldestUnpublishedAgeMs: number | null;
  engineStatus: EngineStatusState;
  behindBy: number;
}): PipelineOverallStatus {
  if (
    opts.oldestUnpublishedAgeMs !== null &&
    opts.oldestUnpublishedAgeMs > PIPELINE_STALE_THRESHOLD_MS
  ) {
    return "stalled";
  }
  if (
    opts.engineStatus === "restarting" ||
    opts.engineStatus === "starting" ||
    opts.behindBy > PIPELINE_DEGRADED_LAG
  ) {
    return "degraded";
  }
  return "ok";
}

/** Pair lifecycle events for display (started→done, written→snapshot). */
export function pairLifecycleEvents(events: ContentEvent[]): Array<{
  key: string;
  label: string;
  started: ContentEvent;
  done?: ContentEvent;
  durationMs?: number;
}> {
  const pairs: Array<{
    key: string;
    label: string;
    started: ContentEvent;
    done?: ContentEvent;
    durationMs?: number;
  }> = [];
  const usedDone = new Set<number>();

  for (const e of events) {
    if (e.type === "binding_propagation_started") {
      const done = events.find(
        (r) =>
          !usedDone.has(r.id) &&
          r.type === "binding_propagation_done" &&
          r.triggeredByEventId === e.id,
      );
      if (done) usedDone.add(done.id);
      pairs.push({
        key: `prop:${e.payload.groupId}:${e.payload.locale}:${e.id}`,
        label: `binding propagation (${e.payload.groupId})`,
        started: e,
        done,
        durationMs: done ? done.created_at - e.created_at : undefined,
      });
    } else if (
      e.type === "content_file_written" ||
      e.type === "content_bulk_synced" ||
      e.type === "redirects_changed"
    ) {
      const done = events.find(
        (r) =>
          !usedDone.has(r.id) &&
          r.type === "index_snapshot_ready" &&
          snapshotCoversWrite(e, r),
      );
      if (done) usedDone.add(done.id);
      pairs.push({
        key: `index:${e.id}`,
        label: "index refresh",
        started: e,
        done,
        durationMs: done ? done.created_at - e.created_at : undefined,
      });
    }
  }

  return pairs;
}
