import {
  AGENT_FILTER_OTHER,
  parseActorIds,
  parseAgentFilter,
  parseEntryFilterKeys,
  parseKindIds,
  serializeAgentFilter,
  type AgentFilterId,
  type EventActorId,
  type EventKindId,
} from "@shared/event-log-filters";

/** Query keys for event-log filter / time-window state. */
export const EVENT_LOG_SEARCH_KEYS = {
  session: "session",
  kind: "kind",
  actor: "actor",
  agent: "agent",
  type: "type",
  entry: "entry",
  startingAt: "starting_at",
  endingAt: "ending_at",
} as const;

/** URL value for events with no agent_session_id. */
export const EVENT_LOG_SESSION_UNSCOPED = "unscoped";

/** Half-window for “Show around this” (±1 hour). */
export const EVENT_LOG_SHOW_AROUND_HALF_MS = 60 * 60 * 1000;

export interface EventLogViewState {
  /** Empty = all sessions; `unscoped` = no session; else session id. */
  session: string;
  kinds: EventKindId[];
  actors: EventActorId[];
  /** Empty = all agents. */
  agent: "" | AgentFilterId;
  /** Exact event type; empty = all. Wins over kinds on the API. */
  type: string;
  /** Entry keys `contentType/slug/locale`; empty = all entries. */
  entries: string[];
  /** Inclusive window start (epoch ms); null = no time window. */
  startingAt: number | null;
  /** Inclusive window end (epoch ms); null = no time window. */
  endingAt: number | null;
}

export const EVENT_LOG_VIEW_DEFAULTS: EventLogViewState = {
  session: "",
  kinds: [],
  actors: [],
  agent: "",
  type: "",
  entries: [],
  startingAt: null,
  endingAt: null,
};

function parseEpochMs(raw: string | null): number | null {
  if (raw == null || raw.trim() === "") return null;
  const n = Number(raw);
  if (!Number.isFinite(n) || !Number.isInteger(n)) return null;
  return n;
}

/** Valid inclusive window, or both null. */
function normalizeTimeWindow(
  startingAt: number | null,
  endingAt: number | null,
): { startingAt: number | null; endingAt: number | null } {
  if (startingAt == null || endingAt == null) {
    return { startingAt: null, endingAt: null };
  }
  if (startingAt > endingAt) return { startingAt: null, endingAt: null };
  return { startingAt, endingAt };
}

export function parseEventLogSearch(search: string): EventLogViewState {
  const params = new URLSearchParams(search.startsWith("?") ? search.slice(1) : search);
  const sessionRaw = (params.get(EVENT_LOG_SEARCH_KEYS.session) ?? "").trim();
  // Legacy sentinel from before URL used `unscoped`.
  const session = sessionRaw === "__unscoped__" ? EVENT_LOG_SESSION_UNSCOPED : sessionRaw;
  const agent = parseAgentFilter(params.get(EVENT_LOG_SEARCH_KEYS.agent));
  const window = normalizeTimeWindow(
    parseEpochMs(params.get(EVENT_LOG_SEARCH_KEYS.startingAt)),
    parseEpochMs(params.get(EVENT_LOG_SEARCH_KEYS.endingAt)),
  );
  return {
    session,
    kinds: parseKindIds(params.get(EVENT_LOG_SEARCH_KEYS.kind)),
    actors: parseActorIds(params.get(EVENT_LOG_SEARCH_KEYS.actor)),
    agent: agent ?? "",
    type: (params.get(EVENT_LOG_SEARCH_KEYS.type) ?? "").trim(),
    entries: parseEntryFilterKeys(params.get(EVENT_LOG_SEARCH_KEYS.entry)),
    startingAt: window.startingAt,
    endingAt: window.endingAt,
  };
}

function setOmitEmpty(params: URLSearchParams, key: string, value: string) {
  if (!value) params.delete(key);
  else params.set(key, value);
}

function clearFilterKeys(params: URLSearchParams) {
  params.delete(EVENT_LOG_SEARCH_KEYS.session);
  params.delete(EVENT_LOG_SEARCH_KEYS.kind);
  params.delete(EVENT_LOG_SEARCH_KEYS.actor);
  params.delete(EVENT_LOG_SEARCH_KEYS.agent);
  params.delete(EVENT_LOG_SEARCH_KEYS.type);
  params.delete(EVENT_LOG_SEARCH_KEYS.entry);
}

function clearWindowKeys(params: URLSearchParams) {
  params.delete(EVENT_LOG_SEARCH_KEYS.startingAt);
  params.delete(EVENT_LOG_SEARCH_KEYS.endingAt);
}

/** Writes known keys onto `existingSearch`, omitting defaults. Unknown params are kept. */
export function serializeEventLogSearch(view: EventLogViewState, existingSearch = ""): string {
  const params = new URLSearchParams(
    existingSearch.startsWith("?") ? existingSearch.slice(1) : existingSearch,
  );

  const window = normalizeTimeWindow(view.startingAt, view.endingAt);
  if (window.startingAt != null && window.endingAt != null) {
    // Time window wins: drop filter keys so shareable URLs stay clean.
    clearFilterKeys(params);
    params.set(EVENT_LOG_SEARCH_KEYS.startingAt, String(window.startingAt));
    params.set(EVENT_LOG_SEARCH_KEYS.endingAt, String(window.endingAt));
    return params.toString();
  }

  clearWindowKeys(params);
  setOmitEmpty(params, EVENT_LOG_SEARCH_KEYS.session, view.session.trim());
  if (view.kinds.length === 0) params.delete(EVENT_LOG_SEARCH_KEYS.kind);
  else params.set(EVENT_LOG_SEARCH_KEYS.kind, view.kinds.join(","));
  if (view.actors.length === 0) params.delete(EVENT_LOG_SEARCH_KEYS.actor);
  else params.set(EVENT_LOG_SEARCH_KEYS.actor, view.actors.join(","));
  if (!view.agent) params.delete(EVENT_LOG_SEARCH_KEYS.agent);
  else params.set(EVENT_LOG_SEARCH_KEYS.agent, serializeAgentFilter(view.agent));
  setOmitEmpty(params, EVENT_LOG_SEARCH_KEYS.type, view.type.trim());
  if (view.entries.length === 0) params.delete(EVENT_LOG_SEARCH_KEYS.entry);
  else params.set(EVENT_LOG_SEARCH_KEYS.entry, view.entries.join(","));

  return params.toString();
}

export function eventLogHasTimeWindow(view: EventLogViewState): boolean {
  return view.startingAt != null && view.endingAt != null && view.startingAt <= view.endingAt;
}

export function eventLogHasActiveFilters(view: EventLogViewState): boolean {
  return (
    Boolean(view.session) ||
    view.kinds.length > 0 ||
    view.actors.length > 0 ||
    Boolean(view.agent) ||
    Boolean(view.type) ||
    view.entries.length > 0
  );
}

export function eventLogActiveFilterCount(view: EventLogViewState): number {
  return (
    (view.session ? 1 : 0) +
    (view.agent ? 1 : 0) +
    (view.type ? 1 : 0) +
    view.kinds.length +
    view.actors.length +
    view.entries.length
  );
}

/** Map URL session to API query (agentSessionId / unscoped). */
export function eventLogSessionToApi(session: string): {
  agentSessionId?: string;
  unscoped?: boolean;
} {
  const s = session.trim();
  if (!s) return {};
  if (s === EVENT_LOG_SESSION_UNSCOPED) return { unscoped: true };
  return { agentSessionId: s };
}

/** DOM / hash id for an event row (`#event-12615`). */
export function eventFocusDomId(eventId: number): string {
  return `event-${eventId}`;
}

/** Parse `#event-123` (or dirty `#event-123?…`) → numeric id, else null. */
export function parseEventFocusHash(hash: string): number | null {
  const raw = hash.startsWith("#") ? hash.slice(1) : hash;
  const idPart = (raw.split("?")[0] || "").trim();
  const m = /^event-(\d+)$/.exec(idPart);
  if (!m) return null;
  const id = Number(m[1]);
  return Number.isFinite(id) && id > 0 ? id : null;
}

/**
 * Shareable “show around this” href: ±1h window, no filters, hash focus.
 * `path` should be the page path without query (e.g. `/private/background-pipeline`).
 */
export function buildShowAroundHref(
  eventId: number,
  createdAt: number,
  path: string,
  halfMs = EVENT_LOG_SHOW_AROUND_HALF_MS,
): string {
  const startingAt = createdAt - halfMs;
  const endingAt = createdAt + halfMs;
  const qs = serializeEventLogSearch({
    ...EVENT_LOG_VIEW_DEFAULTS,
    startingAt,
    endingAt,
  });
  const pathOnly = path.split("?")[0]?.split("#")[0] || path;
  return `${pathOnly}?${qs}#${eventFocusDomId(eventId)}`;
}

export { AGENT_FILTER_OTHER, parseEntryFilterKeys };
