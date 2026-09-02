export const EVENT_TYPES = [
  "entry_locale_saved",
  "entry_common_saved",
  "entry_redirects_changed",
  "entry_seo_changed",
  "entry_deleted",
  "site_redirects_changed",
  "registry_file_saved",
  "site_bulk_synced",
  "entry_locale_promoted",
  "entry_locale_unpublished",
  "index_snapshot_ready",
  "seo_index_ready",
  "validation_results_ready",
  "validation_issue_claimed",
  "validation_issue_completed",
  "validation_issue_reopened",
  "validation_issue_released",
  "binding_propagation_started",
  "binding_propagation_done",
  "job_failed",
  "ai_image_gc_completed",
  "agent_session_started",
  "agent_session_note",
  "agent_session_summarized",
] as const;

export type EventType = (typeof EVENT_TYPES)[number];

export type EventOutboxRole = "dispatch" | "audit";

export type EventTypeMeta = {
  /** Outbox: dispatcher must enqueue Sidequest work before marking published. */
  outbox: EventOutboxRole;
  /** Bumps latest write generation (index lag). */
  affectsWriteGeneration: boolean;
};

/** Single source of truth for event roles (outbox stall, write generation, dispatcher). */
export const EVENT_TYPE_META: Record<EventType, EventTypeMeta> = {
  entry_locale_saved: { outbox: "dispatch", affectsWriteGeneration: true },
  entry_common_saved: { outbox: "dispatch", affectsWriteGeneration: true },
  entry_redirects_changed: { outbox: "dispatch", affectsWriteGeneration: true },
  entry_seo_changed: { outbox: "dispatch", affectsWriteGeneration: true },
  entry_deleted: { outbox: "dispatch", affectsWriteGeneration: true },
  site_redirects_changed: { outbox: "dispatch", affectsWriteGeneration: true },
  registry_file_saved: { outbox: "dispatch", affectsWriteGeneration: true },
  site_bulk_synced: { outbox: "dispatch", affectsWriteGeneration: true },
  entry_locale_promoted: { outbox: "dispatch", affectsWriteGeneration: true },
  entry_locale_unpublished: { outbox: "dispatch", affectsWriteGeneration: true },
  binding_propagation_started: { outbox: "dispatch", affectsWriteGeneration: false },
  index_snapshot_ready: { outbox: "audit", affectsWriteGeneration: false },
  seo_index_ready: { outbox: "audit", affectsWriteGeneration: false },
  validation_results_ready: { outbox: "audit", affectsWriteGeneration: false },
  validation_issue_claimed: { outbox: "audit", affectsWriteGeneration: false },
  validation_issue_completed: { outbox: "audit", affectsWriteGeneration: false },
  validation_issue_reopened: { outbox: "audit", affectsWriteGeneration: false },
  validation_issue_released: { outbox: "audit", affectsWriteGeneration: false },
  binding_propagation_done: { outbox: "audit", affectsWriteGeneration: false },
  job_failed: { outbox: "audit", affectsWriteGeneration: false },
  ai_image_gc_completed: { outbox: "audit", affectsWriteGeneration: false },
  agent_session_started: { outbox: "audit", affectsWriteGeneration: false },
  agent_session_note: { outbox: "audit", affectsWriteGeneration: false },
  agent_session_summarized: { outbox: "audit", affectsWriteGeneration: false },
};

export function isOutboxDispatchable(type: EventType): boolean {
  return EVENT_TYPE_META[type].outbox === "dispatch";
}

/** Events the outbox dispatcher enqueues to Sidequest. */
export const OUTBOX_DISPATCHABLE_EVENT_TYPES = EVENT_TYPES.filter(
  (t) => EVENT_TYPE_META[t].outbox === "dispatch",
) as readonly EventType[];

/** Events that change on-disk content and may require a background index refresh. */
export const INDEX_WRITE_EVENT_TYPES = EVENT_TYPES.filter(
  (t) => EVENT_TYPE_META[t].affectsWriteGeneration,
) as readonly EventType[];

export type IndexWriteEventType = Extract<
  EventType,
  | "entry_locale_saved"
  | "entry_common_saved"
  | "entry_redirects_changed"
  | "entry_seo_changed"
  | "entry_deleted"
  | "site_redirects_changed"
  | "registry_file_saved"
  | "site_bulk_synced"
  | "entry_locale_promoted"
  | "entry_locale_unpublished"
>;

/** Event types counted as content writes for agent session rollups. */
export const AGENT_SESSION_WRITE_EVENT_TYPES: readonly EventType[] = [
  "entry_locale_saved",
  "entry_common_saved",
  "entry_redirects_changed",
  "entry_seo_changed",
  "entry_deleted",
  "site_redirects_changed",
  "registry_file_saved",
  "site_bulk_synced",
  "entry_locale_promoted",
  "entry_locale_unpublished",
];

export type EventResource = {
  path?: string;
  contentType?: string;
  slug?: string;
  locale?: string;
  layer?: string;
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
  agent_session_id?: string;
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
  agent_session_id?: string;
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
