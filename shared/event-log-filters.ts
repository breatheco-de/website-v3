/**
 * Event-log filter constants + agent identity resolution shared by admin UI and API.
 * No icon assets — those stay in the client.
 */

/** Minimal attribution shape for agent / actor bucketing (matches event store JSON). */
export type EventLogAttributionEntry = {
  author?: string;
  actor?: {
    type?: string;
    client?: string;
    model?: string;
    source?: string;
  };
};

export const EVENT_KIND_IDS = [
  "writes",
  "deletes",
  "claims",
  "completes",
  "session",
  "background",
] as const;

export type EventKindId = (typeof EVENT_KIND_IDS)[number];

/** Kind chip → event type strings (OR within a kind; OR across selected kinds). */
export const EVENT_KIND_TYPES: Record<EventKindId, readonly string[]> = {
  writes: [
    "entry_locale_saved",
    "entry_common_saved",
    "entry_seo_changed",
    "entry_redirects_changed",
    "site_redirects_changed",
    "registry_file_saved",
    "content_file_written",
    "redirects_changed",
  ],
  deletes: ["entry_deleted", "content_entry_deleted"],
  claims: ["validation_issue_claimed", "validation_issue_released"],
  completes: ["validation_issue_completed"],
  session: ["agent_session_started", "agent_session_note", "agent_session_summarized"],
  background: [
    "index_snapshot_ready",
    "seo_index_ready",
    "validation_results_ready",
    "binding_propagation_started",
    "binding_propagation_done",
    "site_bulk_synced",
    "entry_locale_promoted",
    "entry_locale_unpublished",
    "content_bulk_synced",
    "job_failed",
    "ai_image_gc_completed",
    "validation_issue_reopened",
  ],
};

export const EVENT_ACTOR_IDS = ["people", "agents", "system"] as const;

export type EventActorId = (typeof EVENT_ACTOR_IDS)[number];

/** Who executed the event — first attribution entry only. */
export function primaryActorBucket(
  attribution: EventLogAttributionEntry[] | undefined | null,
): EventActorId {
  const t = attribution?.[0]?.actor?.type;
  if (t === "ui") return "people";
  if (t === "mcp") return "agents";
  return "system";
}

/** Known LLM / product agent slugs (icon assets live on the client). */
export const AGENT_IDS = [
  "antigravity",
  "apple-intelligent",
  "chatgpt",
  "claude",
  "codex",
  "cohere",
  "copilot",
  "deepseek",
  "fireworks-ai",
  "gemini",
  "grok",
  "hugging-face",
  "kimi",
  "manus",
  "minimax",
  "mistral",
  "notion",
  "perplexity",
  "poe",
  "qwen",
  "stability-ai",
  "z-glm",
] as const;

export type AgentId = (typeof AGENT_IDS)[number];

/** Sentinel for staff / system / unmatched agents in filters. */
export const AGENT_FILTER_OTHER = "__other__";

export type AgentFilterId = AgentId | typeof AGENT_FILTER_OTHER;

const AGENT_ID_SET = new Set<string>(AGENT_IDS);

/** Longer / more specific aliases first so e.g. apple-intelligent beats apple. */
const ALIAS_TO_ID: Array<{ pattern: RegExp; id: AgentId }> = [
  { pattern: /apple[\s_-]?intelligent|apple\s*intelligence/i, id: "apple-intelligent" },
  { pattern: /hugging[\s_-]?face|huggingface|hf\b/i, id: "hugging-face" },
  { pattern: /fireworks/i, id: "fireworks-ai" },
  { pattern: /stability/i, id: "stability-ai" },
  { pattern: /antigravity/i, id: "antigravity" },
  { pattern: /chatgpt|chat[\s_-]?gpt|\bgpt[\s_-]?\d|o[1-4]\b|openai/i, id: "chatgpt" },
  { pattern: /claude|anthropic|sonnet|opus|haiku/i, id: "claude" },
  { pattern: /codex/i, id: "codex" },
  { pattern: /cohere|command[\s_-]?r/i, id: "cohere" },
  { pattern: /copilot|github[\s_-]?copilot/i, id: "copilot" },
  { pattern: /deepseek/i, id: "deepseek" },
  { pattern: /gemini|gemma/i, id: "gemini" },
  { pattern: /grok/i, id: "grok" },
  { pattern: /\bkimi\b|moonshot/i, id: "kimi" },
  { pattern: /manus/i, id: "manus" },
  { pattern: /minimax/i, id: "minimax" },
  { pattern: /mistral|mixtral/i, id: "mistral" },
  { pattern: /notion/i, id: "notion" },
  { pattern: /perplexity|sonar/i, id: "perplexity" },
  { pattern: /\bpoe\b/i, id: "poe" },
  { pattern: /qwen|qwq/i, id: "qwen" },
  { pattern: /\bglm\b|z[\s_-]?glm|zhipu/i, id: "z-glm" },
];

function matchAgentId(raw: string | undefined | null): AgentId | null {
  if (!raw?.trim()) return null;
  const text = raw.trim();
  const normalized = text.toLowerCase().replace(/[_\s]+/g, "-");
  for (const id of AGENT_IDS) {
    if (normalized === id || normalized.includes(id)) return id;
  }
  for (const { pattern, id } of ALIAS_TO_ID) {
    if (pattern.test(text)) return id;
  }
  return null;
}

/**
 * Resolve primary attribution to an agent icon id.
 * MCP: prefer model, then client. Non-MCP / unmatched → null (generic Bot fallback).
 */
export function resolveAgentId(
  attribution: EventLogAttributionEntry[] | undefined | null,
): AgentId | null {
  const primary = attribution?.[0];
  if (!primary?.actor || primary.actor.type !== "mcp") return null;
  return matchAgentId(primary.actor.model) ?? matchAgentId(primary.actor.client);
}

/** Whether an event matches the agent filter (including Staff & system sentinel). */
export function eventMatchesAgentFilter(
  attribution: EventLogAttributionEntry[] | undefined | null,
  agent: AgentFilterId,
): boolean {
  const agentId = resolveAgentId(attribution);
  if (agent === AGENT_FILTER_OTHER) return agentId == null;
  return agentId === agent;
}

/** Expand selected kind ids to a deduped type list. Unknown ids ignored. */
export function expandKindIdsToTypes(kindIds: readonly string[]): string[] {
  const allowed = new Set<string>();
  for (const raw of kindIds) {
    if (!(EVENT_KIND_IDS as readonly string[]).includes(raw)) continue;
    for (const t of EVENT_KIND_TYPES[raw as EventKindId]) allowed.add(t);
  }
  return [...allowed];
}

/** Parse comma-list of kind ids; drop unknowns. */
export function parseKindIds(raw: string | null | undefined): EventKindId[] {
  if (!raw?.trim()) return [];
  const out: EventKindId[] = [];
  const seen = new Set<string>();
  for (const part of raw.split(",")) {
    const id = part.trim();
    if (!(EVENT_KIND_IDS as readonly string[]).includes(id)) continue;
    if (seen.has(id)) continue;
    seen.add(id);
    out.push(id as EventKindId);
  }
  return out;
}

/** Parse comma-list of actor ids; drop unknowns. */
export function parseActorIds(raw: string | null | undefined): EventActorId[] {
  if (!raw?.trim()) return [];
  const out: EventActorId[] = [];
  const seen = new Set<string>();
  for (const part of raw.split(",")) {
    const id = part.trim();
    if (!(EVENT_ACTOR_IDS as readonly string[]).includes(id)) continue;
    if (seen.has(id)) continue;
    seen.add(id);
    out.push(id as EventActorId);
  }
  return out;
}

/**
 * Parse agent filter from query (`other` → AGENT_FILTER_OTHER).
 * Unknown tokens → null (ignored).
 */
export function parseAgentFilter(raw: string | null | undefined): AgentFilterId | null {
  if (!raw?.trim()) return null;
  const v = raw.trim();
  if (v === "other" || v === AGENT_FILTER_OTHER) return AGENT_FILTER_OTHER;
  if (AGENT_ID_SET.has(v)) return v as AgentId;
  return null;
}

/** Serialize agent filter for URL (`__other__` → `other`). */
export function serializeAgentFilter(agent: AgentFilterId): string {
  return agent === AGENT_FILTER_OTHER ? "other" : agent;
}

/** Human label for agent filter dropdowns. */
export function formatAgentLabel(agentId: AgentFilterId): string {
  if (agentId === AGENT_FILTER_OTHER) return "Staff & system";
  return agentId
    .split("-")
    .map((part) => {
      if (part === "ai") return "AI";
      if (part === "chatgpt") return "ChatGPT";
      if (part === "glm") return "GLM";
      return part.charAt(0).toUpperCase() + part.slice(1);
    })
    .join(" ");
}

/** SQL-friendly actor.type values for a bucket (first attribution). */
export function actorBucketSqlTypes(bucket: EventActorId): readonly string[] {
  if (bucket === "people") return ["ui"];
  if (bucket === "agents") return ["mcp"];
  return []; // system: null / missing / system — handled separately
}
