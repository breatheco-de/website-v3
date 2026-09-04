import {
  AGENT_FILTER_OTHER,
  parseActorIds,
  parseAgentFilter,
  parseKindIds,
  serializeAgentFilter,
  type AgentFilterId,
  type EventActorId,
  type EventKindId,
} from "@shared/event-log-filters";

/** Query keys for event-log filter state. */
export const EVENT_LOG_SEARCH_KEYS = {
  session: "session",
  kind: "kind",
  actor: "actor",
  agent: "agent",
  type: "type",
} as const;

/** URL value for events with no agent_session_id. */
export const EVENT_LOG_SESSION_UNSCOPED = "unscoped";

export interface EventLogViewState {
  /** Empty = all sessions; `unscoped` = no session; else session id. */
  session: string;
  kinds: EventKindId[];
  actors: EventActorId[];
  /** Empty = all agents. */
  agent: "" | AgentFilterId;
  /** Exact event type; empty = all. Wins over kinds on the API. */
  type: string;
}

export const EVENT_LOG_VIEW_DEFAULTS: EventLogViewState = {
  session: "",
  kinds: [],
  actors: [],
  agent: "",
  type: "",
};

export function parseEventLogSearch(search: string): EventLogViewState {
  const params = new URLSearchParams(search.startsWith("?") ? search.slice(1) : search);
  const sessionRaw = (params.get(EVENT_LOG_SEARCH_KEYS.session) ?? "").trim();
  // Legacy sentinel from before URL used `unscoped`.
  const session = sessionRaw === "__unscoped__" ? EVENT_LOG_SESSION_UNSCOPED : sessionRaw;
  const agent = parseAgentFilter(params.get(EVENT_LOG_SEARCH_KEYS.agent));
  return {
    session,
    kinds: parseKindIds(params.get(EVENT_LOG_SEARCH_KEYS.kind)),
    actors: parseActorIds(params.get(EVENT_LOG_SEARCH_KEYS.actor)),
    agent: agent ?? "",
    type: (params.get(EVENT_LOG_SEARCH_KEYS.type) ?? "").trim(),
  };
}

function setOmitEmpty(params: URLSearchParams, key: string, value: string) {
  if (!value) params.delete(key);
  else params.set(key, value);
}

/** Writes known keys onto `existingSearch`, omitting defaults. Unknown params are kept. */
export function serializeEventLogSearch(view: EventLogViewState, existingSearch = ""): string {
  const params = new URLSearchParams(
    existingSearch.startsWith("?") ? existingSearch.slice(1) : existingSearch,
  );

  setOmitEmpty(params, EVENT_LOG_SEARCH_KEYS.session, view.session.trim());
  if (view.kinds.length === 0) params.delete(EVENT_LOG_SEARCH_KEYS.kind);
  else params.set(EVENT_LOG_SEARCH_KEYS.kind, view.kinds.join(","));
  if (view.actors.length === 0) params.delete(EVENT_LOG_SEARCH_KEYS.actor);
  else params.set(EVENT_LOG_SEARCH_KEYS.actor, view.actors.join(","));
  if (!view.agent) params.delete(EVENT_LOG_SEARCH_KEYS.agent);
  else params.set(EVENT_LOG_SEARCH_KEYS.agent, serializeAgentFilter(view.agent));
  setOmitEmpty(params, EVENT_LOG_SEARCH_KEYS.type, view.type.trim());

  return params.toString();
}

export function eventLogHasActiveFilters(view: EventLogViewState): boolean {
  return (
    Boolean(view.session) ||
    view.kinds.length > 0 ||
    view.actors.length > 0 ||
    Boolean(view.agent) ||
    Boolean(view.type)
  );
}

export function eventLogActiveFilterCount(view: EventLogViewState): number {
  return (
    (view.session ? 1 : 0) +
    (view.agent ? 1 : 0) +
    (view.type ? 1 : 0) +
    view.kinds.length +
    view.actors.length
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

export { AGENT_FILTER_OTHER };
