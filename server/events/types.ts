export const EVENT_TYPES = [
  "content_file_written",
  "content_bulk_synced",
  "redirects_changed",
  "index_snapshot_ready",
  "validation_results_ready",
  "validation_issue_claimed",
  "validation_issue_completed",
  "validation_issue_reopened",
  "binding_propagation_started",
  "binding_propagation_done",
  "job_failed",
] as const;

export type EventType = (typeof EVENT_TYPES)[number];

/** Events that change on-disk content and may require a background index refresh. */
export const INDEX_WRITE_EVENT_TYPES = [
  "content_file_written",
  "content_bulk_synced",
  "redirects_changed",
] as const satisfies readonly EventType[];

export type IndexWriteEventType = (typeof INDEX_WRITE_EVENT_TYPES)[number];

export type EventResource = {
  path?: string;
  contentType?: string;
  slug?: string;
  locale?: string;
  groupId?: string;
};

export type EventActor =
  | { type: "ui" }
  | { type: "mcp"; client?: string; model?: string }
  | { type: "system"; source: string };

export type EventAttribution = {
  author?: string;
  actor?: EventActor;
};

export type ContentEvent = {
  id: number;
  type: EventType;
  site: string;
  resource: EventResource;
  attribution: EventAttribution[];
  cause?: string;
  payload: Record<string, unknown>;
  triggeredByEventId?: number;
  triggeredByEventIds?: number[];
  published: boolean;
  created_at: number;
};

export type EmitEventOpts = {
  site: string;
  type: EventType;
  resource?: EventResource;
  attribution?: EventAttribution[];
  cause?: string;
  payload?: Record<string, unknown>;
  triggeredByEventId?: number;
  triggeredByEventIds?: number[];
};

export function singleAttribution(author?: string, actor?: EventActor): EventAttribution[] {
  if (!author && !actor) return [];
  return [{ ...(author ? { author } : {}), ...(actor ? { actor } : {}) }];
}

function attributionKey(entry: EventAttribution): string {
  const actor = entry.actor;
  if (!actor) return `:${entry.author ?? ""}`;
  if (actor.type === "ui") return `${entry.author ?? ""}:ui`;
  if (actor.type === "mcp") return `${entry.author ?? ""}:mcp:${actor.client ?? ""}:${actor.model ?? ""}`;
  return `${entry.author ?? ""}:system:${actor.source}`;
}

/** Union attribution arrays, deduping by author + actor identity. */
export function unionAttribution(...groups: EventAttribution[][]): EventAttribution[] {
  const seen = new Set<string>();
  const out: EventAttribution[] = [];
  for (const group of groups) {
    for (const entry of group) {
      const key = attributionKey(entry);
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(entry);
    }
  }
  return out;
}

export function primaryAuthor(event: Pick<ContentEvent, "attribution">): string | undefined {
  return event.attribution[0]?.author;
}
