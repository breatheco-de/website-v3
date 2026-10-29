/**
 * Proposal event outbound webhooks: durable YAML config + SQLite buffers/deliveries.
 * Throttle: debounce + max wait + optional max_events_per_call safety cap.
 */

import fs from "fs";
import path from "path";
import yaml from "js-yaml";
import { getSiteSqlite } from "../db";
import { getSiteConfigs } from "../site-config";
import { ensurePipelineDb } from "../pipeline-db/runner";
import { enqueueJob } from "../jobs/queue";
import { sanitizeWebhookHeaders } from "../../shared/webhookHeaders";
import {
  isSecretWebhookHeaderName,
  redactWebhookHeadersForStaff,
  resolveWebhookHeadersForDelivery,
  sealSecretHeaderValue,
} from "./event-webhook-header-secrets";
import { child } from "../logger";
import type { ContentEvent, EventType } from "./types";
import { getEventById } from "./event-store";
import { FUNNEL_STAGES, type FunnelStage } from "@shared/funnel";
import { parseIdeaFunnel } from "../content-proposals/idea-funnel";
import { buildServerPageTracking } from "../tracking-page-context";
import { getFolder } from "../content-types";
import { DEFAULT_VARIANT_SLUG, experimentId, hasActiveTraffic } from "../versioning/assignment";

const log = child({ module: "event-webhooks" });

export const EVENT_WEBHOOK_ALLOWLIST = [
  "proposal_created",
  "proposal_revised",
  "proposal_applied_progress",
  "proposal_finished",
  "proposal_acknowledged",
  "proposal_closed",
  "proposal_rejected",
  "proposal_withdrawn",
  "proposal_escalated",
  "proposal_deescalated",
  "proposal_idea_funnel_set",
  "proposal_stale_flagged",
  "proposal_closed_abandoned_stale",
  "proposal_blocked_flagged",
  "proposal_closed_abandoned_blocked",
  "proposal_needs_author",
  "proposal_dependent_overdue",
  "proposal_reverted",
  "proposal_blocker_added",
  "proposal_blocker_resolved",
  "proposal_blocker_reopened",
  "entry_common_saved",
  "entry_locale_saved",
] as const;

export type EventWebhookAllowlistedType = (typeof EVENT_WEBHOOK_ALLOWLIST)[number];

export const EVENT_WEBHOOK_MAX_EVENTS_MIN = 1;
export const EVENT_WEBHOOK_MAX_EVENTS_MAX = 50;
/** @deprecated Use EVENT_WEBHOOK_MAX_EVENTS_MIN */
export const EVENT_WEBHOOK_EVENTS_PER_CALL_MIN = EVENT_WEBHOOK_MAX_EVENTS_MIN;
/** @deprecated Use EVENT_WEBHOOK_MAX_EVENTS_MAX */
export const EVENT_WEBHOOK_EVENTS_PER_CALL_MAX = EVENT_WEBHOOK_MAX_EVENTS_MAX;

export const EVENT_WEBHOOK_DEBOUNCE_DEFAULT_MS = 30_000;
export const EVENT_WEBHOOK_MAX_WAIT_DEFAULT_MS = 60_000;
export const EVENT_WEBHOOK_THROTTLE_MS_MAX = 600_000;
export const EVENT_WEBHOOK_DUE_SCAN_INTERVAL_MS = 5_000;
export const EVENT_WEBHOOK_DELIVERY_RETENTION_MS = 48 * 60 * 60 * 1000;
export const EVENT_WEBHOOK_FILE = "event-webhooks.yml";
const BUFFERS_KEY = "event_webhook_buffers";
const WEBHOOK_TIMEOUT_MS = 8_000;

const HOOK_ID_RE = /^[a-z0-9][a-z0-9_-]{0,63}$/;

export type EventWebhookDeliverySource = "live" | "test" | "retry";
export type EventWebhookDeliveryStatus = "success" | "failure" | "skipped";

export const EVENT_WEBHOOK_FILTER_ACTOR_TYPES = ["ui", "mcp", "system"] as const;
export const EVENT_WEBHOOK_FILTER_KINDS = ["idea", "edits", "notes"] as const;

export type EventWebhookFilterActorType = (typeof EVENT_WEBHOOK_FILTER_ACTOR_TYPES)[number];
export type EventWebhookFilterKind = (typeof EVENT_WEBHOOK_FILTER_KINDS)[number];

/** Optional include/exclude gates on a hook. Empty/omitted field = no restriction. */
export type EventWebhookFilter = {
  event_authors?: string[];
  exclude_event_authors?: string[];
  event_actor_types?: EventWebhookFilterActorType[];
  event_models?: string[];
  exclude_event_models?: string[];
  event_clients?: string[];
  exclude_event_clients?: string[];
  proposal_authors?: string[];
  exclude_proposal_authors?: string[];
  proposal_models?: string[];
  exclude_proposal_models?: string[];
  proposal_actor_types?: EventWebhookFilterActorType[];
  proposal_roles?: string[];
  kinds?: EventWebhookFilterKind[];
  exclude_kinds?: EventWebhookFilterKind[];
  content_types?: string[];
  exclude_content_types?: string[];
  locales?: string[];
  exclude_locales?: string[];
  /** Idea proposals only: `idea_funnel.stage`. No funnel → include fails. */
  funnel_stages?: FunnelStage[];
  exclude_funnel_stages?: FunnelStage[];
  /** Idea proposals only: product slugs. An `"all"` idea matches any include; excluded only by `all`. */
  funnel_products?: string[];
  exclude_funnel_products?: string[];
};

const FILTER_STRING_LIST_KEYS = [
  "event_authors",
  "exclude_event_authors",
  "event_models",
  "exclude_event_models",
  "event_clients",
  "exclude_event_clients",
  "proposal_authors",
  "exclude_proposal_authors",
  "proposal_models",
  "exclude_proposal_models",
  "proposal_roles",
  "content_types",
  "exclude_content_types",
  "locales",
  "exclude_locales",
  "funnel_products",
  "exclude_funnel_products",
] as const;

const FILTER_ACTOR_TYPE_KEYS = ["event_actor_types", "proposal_actor_types"] as const;
const FILTER_KIND_KEYS = ["kinds", "exclude_kinds"] as const;
const FILTER_FUNNEL_STAGE_KEYS = ["funnel_stages", "exclude_funnel_stages"] as const;

const ALL_FILTER_KEYS = new Set<string>([
  ...FILTER_STRING_LIST_KEYS,
  ...FILTER_ACTOR_TYPE_KEYS,
  ...FILTER_KIND_KEYS,
  ...FILTER_FUNNEL_STAGE_KEYS,
]);

/** Non-proposal events. Content type and locale come from `resource`, not a proposal. */
const NON_PROPOSAL_FILTER_KEYS = [
  "event_authors",
  "event_actor_types",
  "content_types",
  "exclude_content_types",
  "locales",
  "exclude_locales",
] as const;

/** Keys the parser and the filter dialog accept for this event type. Empty = no filter keys. */
export function filterKeysForEventType(eventType: string): readonly string[] {
  if (!isEventWebhookAllowlisted(eventType)) return [];
  if (eventType.startsWith("proposal_")) return [...ALL_FILTER_KEYS];
  // The common file has no language. A locale filter on it never matches.
  if (eventType === "entry_common_saved") {
    return NON_PROPOSAL_FILTER_KEYS.filter((key) => key !== "locales" && key !== "exclude_locales");
  }
  return NON_PROPOSAL_FILTER_KEYS;
}

export type EventWebhookProposalFunnel = {
  stage: FunnelStage;
  products: string[] | "all";
};

export type EventWebhookProposalSummary = {
  id: string;
  kind: string;
  proposer_username: string;
  proposer_actor: Record<string, unknown>;
  content_types: string[];
  locales: string[];
  /** Structured `idea_funnel` (ideas only); null when unset or non-idea. */
  funnel: EventWebhookProposalFunnel | null;
};

export type EventWebhookHook = {
  id: string;
  enabled: boolean;
  url: string;
  method: "POST";
  debounce_ms: number;
  max_wait_ms: number;
  max_events_per_call: number;
  headers?: Record<string, string>;
  filter?: EventWebhookFilter;
};

export type HookMatchResult =
  | { ok: true; proposal?: EventWebhookProposalSummary }
  | { ok: false; reason: "no_match" }
  | { ok: false; reason: "proposal_unresolved" };

export type EventWebhookConfig = {
  version: 1;
  subscriptions: Partial<Record<EventWebhookAllowlistedType, EventWebhookHook[]>>;
};

export type EventWebhookBuffer = {
  pendingEventIds: number[];
  pendingCount: number;
  /** Epoch ms of first event in this pile; missing with ids = legacy → treat as due */
  first_pending_at?: number;
  /** Epoch ms of most recent event; missing with ids = legacy → treat as due */
  last_event_at?: number;
};

export type EventWebhookBuffers = Record<string, EventWebhookBuffer>;

export type EventWebhookClaim = {
  eventIds: number[];
  first_pending_at?: number;
  last_event_at?: number;
};

export type EventWebhookDeliveryRow = {
  id: number;
  site: string;
  event_type: string;
  hook_id: string;
  event_ids: number[];
  url_host: string;
  status: EventWebhookDeliveryStatus;
  http_status: number | null;
  error: string | null;
  duration_ms: number | null;
  batch_size: number;
  source: EventWebhookDeliverySource;
  created_at: number;
};

export type EventWebhookPayloadEnricher = (
  events: ContentEvent[],
  hook: EventWebhookHook,
) => Record<string, unknown>[];

/** Optional per-type enrichers (code-only; default is slim envelope). */
export const enrichEventWebhookPayload: Partial<
  Record<EventWebhookAllowlistedType, EventWebhookPayloadEnricher>
> = {};

/** In-memory flush timers (latency only; SQLite timestamps + scan are source of truth). */
const flushTimers = new Map<string, ReturnType<typeof setTimeout>>();
let dueScanTimer: ReturnType<typeof setInterval> | null = null;

function ensureSchema(site: string): void {
  ensurePipelineDb(site);
}

export function isEventWebhookAllowlisted(type: string): type is EventWebhookAllowlistedType {
  return (EVENT_WEBHOOK_ALLOWLIST as readonly string[]).includes(type);
}

export function bufferKey(eventType: string, hookId: string): string {
  return `${eventType}::${hookId}`;
}

function timerKey(site: string, eventType: string, hookId: string): string {
  return `${site}::${bufferKey(eventType, hookId)}`;
}

export function clampMaxEventsPerCall(n: unknown): number {
  const raw = typeof n === "number" ? n : Number(n);
  if (!Number.isFinite(raw)) return EVENT_WEBHOOK_MAX_EVENTS_MAX;
  return Math.min(
    EVENT_WEBHOOK_MAX_EVENTS_MAX,
    Math.max(EVENT_WEBHOOK_MAX_EVENTS_MIN, Math.floor(raw)),
  );
}

/** @deprecated Use clampMaxEventsPerCall */
export function clampEventsPerCall(n: unknown): number {
  return clampMaxEventsPerCall(n);
}

export function clampThrottleMs(n: unknown, fallback: number): number {
  const raw = typeof n === "number" ? n : Number(n);
  if (!Number.isFinite(raw)) return fallback;
  return Math.min(EVENT_WEBHOOK_THROTTLE_MS_MAX, Math.max(0, Math.floor(raw)));
}

export function getEventWebhooksPath(contentRoot: string): string {
  return path.join(contentRoot, EVENT_WEBHOOK_FILE);
}

function emptyConfig(): EventWebhookConfig {
  return { version: 1, subscriptions: {} };
}

function normalizeStringList(raw: unknown, field: string, hookId: string, eventType: string): string[] {
  if (raw == null) return [];
  if (!Array.isArray(raw)) {
    throw new Error(`Hook "${hookId}" under ${eventType}: filter.${field} must be a list`);
  }
  const out: string[] = [];
  const seen = new Set<string>();
  for (const item of raw) {
    if (typeof item !== "string") {
      throw new Error(`Hook "${hookId}" under ${eventType}: filter.${field} values must be strings`);
    }
    const t = item.trim();
    if (!t) continue;
    const key = t.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(t);
  }
  return out;
}

function parseFilter(
  raw: unknown,
  hookId: string,
  eventType: string,
): EventWebhookFilter | undefined {
  if (raw == null) return undefined;
  if (typeof raw !== "object" || Array.isArray(raw)) {
    throw new Error(`Hook "${hookId}" under ${eventType}: filter must be a mapping`);
  }
  const obj = raw as Record<string, unknown>;
  const allowedForType = new Set<string>(filterKeysForEventType(eventType));
  for (const key of Object.keys(obj)) {
    if (!ALL_FILTER_KEYS.has(key)) {
      throw new Error(`Hook "${hookId}" under ${eventType}: unknown filter key "${key}"`);
    }
    if (!allowedForType.has(key)) {
      throw new Error(
        `Hook "${hookId}" under ${eventType}: filter key "${key}" is not allowed for this event`,
      );
    }
  }
  const filter: EventWebhookFilter = {};

  for (const key of FILTER_STRING_LIST_KEYS) {
    if (obj[key] === undefined) continue;
    const list = normalizeStringList(obj[key], key, hookId, eventType);
    if (list.length > 0) (filter as Record<string, string[]>)[key] = list;
  }

  for (const key of FILTER_ACTOR_TYPE_KEYS) {
    if (obj[key] === undefined) continue;
    const list = normalizeStringList(obj[key], key, hookId, eventType);
    const allowed = new Set<string>(EVENT_WEBHOOK_FILTER_ACTOR_TYPES);
    for (const v of list) {
      if (!allowed.has(v.toLowerCase())) {
        throw new Error(
          `Hook "${hookId}" under ${eventType}: filter.${key} invalid value "${v}" (ui|mcp|system)`,
        );
      }
    }
    const normalized = [
      ...new Set(list.map((v) => v.toLowerCase() as EventWebhookFilterActorType)),
    ];
    if (normalized.length > 0) (filter as Record<string, string[]>)[key] = normalized;
  }

  for (const key of FILTER_KIND_KEYS) {
    if (obj[key] === undefined) continue;
    const list = normalizeStringList(obj[key], key, hookId, eventType);
    const allowed = new Set<string>(EVENT_WEBHOOK_FILTER_KINDS);
    for (const v of list) {
      if (!allowed.has(v.toLowerCase())) {
        throw new Error(
          `Hook "${hookId}" under ${eventType}: filter.${key} invalid value "${v}" (idea|edits|notes)`,
        );
      }
    }
    const normalized = [
      ...new Set(list.map((v) => v.toLowerCase() as EventWebhookFilterKind)),
    ];
    if (normalized.length > 0) (filter as Record<string, string[]>)[key] = normalized;
  }

  for (const key of FILTER_FUNNEL_STAGE_KEYS) {
    if (obj[key] === undefined) continue;
    const list = normalizeStringList(obj[key], key, hookId, eventType);
    const allowed = new Set<string>(FUNNEL_STAGES);
    for (const v of list) {
      if (!allowed.has(v.toLowerCase())) {
        throw new Error(
          `Hook "${hookId}" under ${eventType}: filter.${key} invalid value "${v}" (${FUNNEL_STAGES.join("|")})`,
        );
      }
    }
    const normalized = [...new Set(list.map((v) => v.toLowerCase() as FunnelStage))];
    if (normalized.length > 0) (filter as Record<string, string[]>)[key] = normalized;
  }

  return Object.keys(filter).length > 0 ? filter : undefined;
}

/** Stable JSON compare for filter objects (order-insensitive list values via sorted copy). */
export function filtersEqual(
  a: EventWebhookFilter | undefined,
  b: EventWebhookFilter | undefined,
): boolean {
  return stableFilterJson(a) === stableFilterJson(b);
}

function stableFilterJson(f: EventWebhookFilter | undefined): string {
  if (!f || Object.keys(f).length === 0) return "";
  const keys = Object.keys(f).sort();
  const norm: Record<string, string[]> = {};
  for (const k of keys) {
    const v = (f as Record<string, string[] | undefined>)[k];
    if (!v || v.length === 0) continue;
    norm[k] = [...v].map((s) => s.toLowerCase()).sort();
  }
  return JSON.stringify(norm);
}

export function filterNeedsProposal(filter: EventWebhookFilter | undefined): boolean {
  if (!filter) return false;
  return Boolean(
    filter.proposal_authors?.length ||
      filter.exclude_proposal_authors?.length ||
      filter.proposal_models?.length ||
      filter.exclude_proposal_models?.length ||
      filter.proposal_actor_types?.length ||
      filter.proposal_roles?.length ||
      filter.kinds?.length ||
      filter.exclude_kinds?.length ||
      filter.content_types?.length ||
      filter.exclude_content_types?.length ||
      filter.locales?.length ||
      filter.exclude_locales?.length ||
      filter.funnel_stages?.length ||
      filter.exclude_funnel_stages?.length ||
      filter.funnel_products?.length ||
      filter.exclude_funnel_products?.length,
  );
}

/** Case-insensitive exact, or prefix when needle ends with `*`. */
export function matchFilterString(haystack: string | null | undefined, needles: string[]): boolean {
  if (!haystack) return false;
  const h = haystack.toLowerCase();
  for (const n of needles) {
    const needle = n.toLowerCase();
    if (needle.endsWith("*")) {
      const prefix = needle.slice(0, -1);
      if (prefix.length === 0 || h.startsWith(prefix)) return true;
    } else if (h === needle) {
      return true;
    }
  }
  return false;
}

function includeListMatches(
  value: string | null | undefined,
  list: string[] | undefined,
): boolean {
  if (!list || list.length === 0) return true;
  if (!value) return false;
  return matchFilterString(value, list);
}

function excludeListHits(value: string | null | undefined, list: string[] | undefined): boolean {
  if (!list || list.length === 0) return false;
  if (!value) return false;
  return matchFilterString(value, list);
}

function anyIncludeMatches(values: string[], list: string[] | undefined): boolean {
  if (!list || list.length === 0) return true;
  return values.some((v) => matchFilterString(v, list));
}

function anyExcludeHits(values: string[], list: string[] | undefined): boolean {
  if (!list || list.length === 0) return false;
  return values.some((v) => matchFilterString(v, list));
}

function entryKeyContentType(entryKey: string): string {
  const i = entryKey.indexOf("/");
  return i > 0 ? entryKey.slice(0, i) : entryKey;
}

function proposalFunnelFromJson(json: string | null): EventWebhookProposalFunnel | null {
  if (!json) return null;
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch {
    return null;
  }
  const funnel = parseIdeaFunnel(raw);
  if (!funnel) return null;
  const products =
    funnel.products === "all" ? ("all" as const) : [...new Set(funnel.products.map((b) => b.product))];
  return { stage: funnel.stage, products };
}

/** Slim proposal load for filter match + delivery summary (no circular import). */
export function getProposalForWebhookFilter(
  site: string,
  proposalId: string,
): EventWebhookProposalSummary | null {
  try {
    ensureSchema(site);
    const db = getSiteSqlite(site);
    const row = db
      .prepare(
        `SELECT id, kind, proposer_username, proposer_actor_json, idea_funnel_json
         FROM content_proposals WHERE id = ? AND site = ?`,
      )
      .get(proposalId, site) as
      | {
          id: string;
          kind: string;
          proposer_username: string;
          proposer_actor_json: string | null;
          idea_funnel_json: string | null;
        }
      | undefined;
    if (!row) return null;
    let proposer_actor: Record<string, unknown> = {};
    try {
      proposer_actor = row.proposer_actor_json
        ? (JSON.parse(row.proposer_actor_json) as Record<string, unknown>)
        : {};
    } catch {
      proposer_actor = {};
    }
    const entryRows = db
      .prepare(
        `SELECT entry_key, locale FROM content_proposal_entries WHERE proposal_id = ? ORDER BY id`,
      )
      .all(proposalId) as Array<{ entry_key: string; locale: string }>;
    const content_types: string[] = [];
    const locales: string[] = [];
    const seenCt = new Set<string>();
    const seenLoc = new Set<string>();
    for (const e of entryRows) {
      const ct = entryKeyContentType(e.entry_key);
      if (ct && !seenCt.has(ct.toLowerCase())) {
        seenCt.add(ct.toLowerCase());
        content_types.push(ct);
      }
      const loc = (e.locale || "").trim();
      if (loc && !seenLoc.has(loc.toLowerCase())) {
        seenLoc.add(loc.toLowerCase());
        locales.push(loc);
      }
    }
    return {
      id: row.id,
      kind: row.kind,
      proposer_username: row.proposer_username,
      proposer_actor,
      content_types,
      locales,
      funnel: row.kind === "idea" ? proposalFunnelFromJson(row.idea_funnel_json) : null,
    };
  } catch (err) {
    log.warn({ err, site, proposalId }, "[EventWebhooks] proposal load for filter failed");
    return null;
  }
}

function actorField(
  actor: Record<string, unknown> | undefined,
  key: "type" | "model" | "client" | "role",
): string | undefined {
  if (!actor || typeof actor !== "object") return undefined;
  const v = actor[key];
  return typeof v === "string" && v.trim() ? v.trim() : undefined;
}

function funnelMatches(
  funnel: EventWebhookProposalFunnel | null,
  filter: EventWebhookFilter,
): boolean {
  if (filter.funnel_stages?.length) {
    if (!funnel || !filter.funnel_stages.includes(funnel.stage)) return false;
  }
  if (filter.exclude_funnel_stages?.length && funnel) {
    if (filter.exclude_funnel_stages.includes(funnel.stage)) return false;
  }
  if (filter.funnel_products?.length) {
    if (!funnel) return false;
    if (funnel.products !== "all" && !anyIncludeMatches(funnel.products, filter.funnel_products)) {
      return false;
    }
  }
  if (filter.exclude_funnel_products?.length && funnel) {
    const hit =
      funnel.products === "all"
        ? filter.exclude_funnel_products.some((p) => p.toLowerCase() === "all")
        : anyExcludeHits(funnel.products, filter.exclude_funnel_products);
    if (hit) return false;
  }
  return true;
}

export function matchProposalFilter(
  event: ContentEvent,
  hook: EventWebhookHook,
  proposal: EventWebhookProposalSummary | null | undefined,
  proposalLoaded: boolean,
): HookMatchResult {
  const filter = hook.filter;
  if (!filter || Object.keys(filter).length === 0) {
    return { ok: true, ...(proposal ? { proposal } : {}) };
  }

  const attr = event.attribution?.[0];
  const eventAuthor = attr?.author?.trim() || undefined;
  const eventActor = attr?.actor as Record<string, unknown> | undefined;
  const eventActorType = actorField(eventActor, "type");
  const eventModel = actorField(eventActor, "model");
  const eventClient = actorField(eventActor, "client");

  if (!includeListMatches(eventAuthor, filter.event_authors)) return { ok: false, reason: "no_match" };
  if (excludeListHits(eventAuthor, filter.exclude_event_authors)) {
    return { ok: false, reason: "no_match" };
  }
  if (filter.event_actor_types?.length) {
    if (!eventActorType || !filter.event_actor_types.includes(eventActorType as EventWebhookFilterActorType)) {
      return { ok: false, reason: "no_match" };
    }
  }
  if (!includeListMatches(eventModel, filter.event_models)) return { ok: false, reason: "no_match" };
  if (excludeListHits(eventModel, filter.exclude_event_models)) {
    return { ok: false, reason: "no_match" };
  }
  if (!includeListMatches(eventClient, filter.event_clients)) return { ok: false, reason: "no_match" };
  if (excludeListHits(eventClient, filter.exclude_event_clients)) {
    return { ok: false, reason: "no_match" };
  }

  if (filterNeedsProposal(filter)) {
    if (!proposalLoaded || !proposal) {
      return { ok: false, reason: "proposal_unresolved" };
    }
    if (!includeListMatches(proposal.proposer_username, filter.proposal_authors)) {
      return { ok: false, reason: "no_match" };
    }
    if (excludeListHits(proposal.proposer_username, filter.exclude_proposal_authors)) {
      return { ok: false, reason: "no_match" };
    }
    const pModel = actorField(proposal.proposer_actor, "model");
    const pType = actorField(proposal.proposer_actor, "type");
    const pRole = actorField(proposal.proposer_actor, "role");
    if (!includeListMatches(pModel, filter.proposal_models)) {
      return { ok: false, reason: "no_match" };
    }
    if (excludeListHits(pModel, filter.exclude_proposal_models)) {
      return { ok: false, reason: "no_match" };
    }
    if (filter.proposal_actor_types?.length) {
      if (!pType || !filter.proposal_actor_types.includes(pType as EventWebhookFilterActorType)) {
        return { ok: false, reason: "no_match" };
      }
    }
    if (!includeListMatches(pRole, filter.proposal_roles)) {
      return { ok: false, reason: "no_match" };
    }
    if (filter.kinds?.length) {
      const k = proposal.kind.toLowerCase();
      if (!filter.kinds.includes(k as EventWebhookFilterKind)) {
        return { ok: false, reason: "no_match" };
      }
    }
    if (filter.exclude_kinds?.length) {
      const k = proposal.kind.toLowerCase();
      if (filter.exclude_kinds.includes(k as EventWebhookFilterKind)) {
        return { ok: false, reason: "no_match" };
      }
    }
    if (!anyIncludeMatches(proposal.content_types, filter.content_types)) {
      return { ok: false, reason: "no_match" };
    }
    if (anyExcludeHits(proposal.content_types, filter.exclude_content_types)) {
      return { ok: false, reason: "no_match" };
    }
    if (!anyIncludeMatches(proposal.locales, filter.locales)) {
      return { ok: false, reason: "no_match" };
    }
    if (anyExcludeHits(proposal.locales, filter.exclude_locales)) {
      return { ok: false, reason: "no_match" };
    }
    if (!funnelMatches(proposal.funnel, filter)) {
      return { ok: false, reason: "no_match" };
    }
    return { ok: true, proposal };
  }

  return { ok: true, ...(proposal ? { proposal } : {}) };
}

export type EventWebhookFilterMatcher = (
  event: ContentEvent,
  hook: EventWebhookHook,
) => HookMatchResult;

/** One slot so several hooks on the same event share a single proposal read. */
let proposalMatchCache:
  | { key: string; proposal: EventWebhookProposalSummary | null }
  | undefined;

function proposalForMatch(event: ContentEvent): EventWebhookProposalSummary | null {
  const proposalId =
    typeof event.payload?.proposal_id === "string" ? event.payload.proposal_id : undefined;
  const key = `${event.site}\0${proposalId ?? ""}`;
  if (proposalMatchCache?.key === key) return proposalMatchCache.proposal;
  const proposal = proposalId ? getProposalForWebhookFilter(event.site, proposalId) : null;
  proposalMatchCache = { key, proposal };
  return proposal;
}

/** Proposal events. Loads the proposal only when the hook filter needs it. */
function matchProposalEvent(event: ContentEvent, hook: EventWebhookHook): HookMatchResult {
  if (!filterNeedsProposal(hook.filter)) {
    return matchProposalFilter(event, hook, null, true);
  }
  return matchProposalFilter(event, hook, proposalForMatch(event), true);
}

/** Entry events: content type and locale come from `resource`, not a proposal. */
function matchEntryEvent(event: ContentEvent, hook: EventWebhookHook): HookMatchResult {
  const filter = hook.filter;
  if (!filter || Object.keys(filter).length === 0) return { ok: true };

  const attr = event.attribution?.[0];
  const eventAuthor = attr?.author?.trim() || undefined;
  const eventActor = attr?.actor as Record<string, unknown> | undefined;
  const eventActorType = actorField(eventActor, "type");

  if (!includeListMatches(eventAuthor, filter.event_authors)) return { ok: false, reason: "no_match" };
  if (filter.event_actor_types?.length) {
    if (!eventActorType || !filter.event_actor_types.includes(eventActorType as EventWebhookFilterActorType)) {
      return { ok: false, reason: "no_match" };
    }
  }

  const contentType = event.resource.contentType;
  if (!includeListMatches(contentType, filter.content_types)) return { ok: false, reason: "no_match" };
  if (excludeListHits(contentType, filter.exclude_content_types)) {
    return { ok: false, reason: "no_match" };
  }

  const locale = event.resource.locale;
  if (!includeListMatches(locale, filter.locales)) return { ok: false, reason: "no_match" };
  if (excludeListHits(locale, filter.exclude_locales)) return { ok: false, reason: "no_match" };

  return { ok: true };
}

function buildEventWebhookFilters(): Partial<
  Record<EventWebhookAllowlistedType, EventWebhookFilterMatcher>
> {
  const out: Partial<Record<EventWebhookAllowlistedType, EventWebhookFilterMatcher>> = {};
  for (const type of EVENT_WEBHOOK_ALLOWLIST) {
    out[type] = type.startsWith("proposal_") ? matchProposalEvent : matchEntryEvent;
  }
  return out;
}

/** One matcher per allowlisted type. `proposal_*` share `matchProposalEvent`; the rest share `matchEntryEvent`. */
export const eventWebhookFilters = buildEventWebhookFilters();

function parseHook(raw: unknown, eventType: string, seenIds: Set<string>): EventWebhookHook {
  if (!raw || typeof raw !== "object") {
    throw new Error(`Invalid hook under ${eventType}`);
  }
  const h = raw as Record<string, unknown>;
  const id = typeof h.id === "string" ? h.id.trim() : "";
  if (!HOOK_ID_RE.test(id)) {
    throw new Error(
      `Invalid hook id "${id}" under ${eventType} (use lowercase letters, digits, _ or -, max 64)`,
    );
  }
  if (seenIds.has(id)) {
    throw new Error(`Duplicate hook id "${id}" under ${eventType}`);
  }
  seenIds.add(id);
  const url = typeof h.url === "string" ? h.url.trim() : "";
  const enabled = h.enabled === true;
  if (enabled && !url) {
    throw new Error(`Hook "${id}" under ${eventType} is enabled but has no url`);
  }
  if (url) {
    try {
      const u = new URL(url);
      if (u.protocol !== "http:" && u.protocol !== "https:") {
        throw new Error("protocol");
      }
    } catch {
      throw new Error(`Hook "${id}" under ${eventType} has an invalid url`);
    }
  }
  const methodRaw = typeof h.method === "string" ? h.method.trim().toUpperCase() : "POST";
  if (methodRaw !== "POST") {
    throw new Error(`Hook "${id}" under ${eventType}: only POST is supported`);
  }
  const headers = sanitizeWebhookHeaders(
    h.headers && typeof h.headers === "object"
      ? (h.headers as Record<string, string>)
      : undefined,
  );

  const hasDebounce = h.debounce_ms !== undefined && h.debounce_ms !== null;
  const hasMaxWait = h.max_wait_ms !== undefined && h.max_wait_ms !== null;
  const debounce_ms = clampThrottleMs(
    hasDebounce ? h.debounce_ms : EVENT_WEBHOOK_DEBOUNCE_DEFAULT_MS,
    EVENT_WEBHOOK_DEBOUNCE_DEFAULT_MS,
  );
  const max_wait_ms = clampThrottleMs(
    hasMaxWait ? h.max_wait_ms : EVENT_WEBHOOK_MAX_WAIT_DEFAULT_MS,
    EVENT_WEBHOOK_MAX_WAIT_DEFAULT_MS,
  );
  if (debounce_ms > 0 && max_wait_ms > 0 && max_wait_ms < debounce_ms) {
    throw new Error(
      `Hook "${id}" under ${eventType}: max wait must be greater than or equal to quiet period`,
    );
  }

  let max_events_per_call: number;
  if (h.max_events_per_call !== undefined && h.max_events_per_call !== null) {
    max_events_per_call = clampMaxEventsPerCall(h.max_events_per_call);
  } else if (h.events_per_call !== undefined && h.events_per_call !== null) {
    max_events_per_call = clampMaxEventsPerCall(h.events_per_call);
  } else {
    max_events_per_call = EVENT_WEBHOOK_MAX_EVENTS_MAX;
  }

  const filter = parseFilter(h.filter, id, eventType);

  return {
    id,
    enabled,
    url,
    method: "POST",
    debounce_ms,
    max_wait_ms,
    max_events_per_call,
    ...(Object.keys(headers).length > 0 ? { headers } : {}),
    ...(filter ? { filter } : {}),
  };
}

export function parseEventWebhookConfig(raw: unknown): EventWebhookConfig {
  if (raw == null) return emptyConfig();
  if (typeof raw !== "object") throw new Error("event-webhooks.yml must be a mapping");
  const doc = raw as Record<string, unknown>;
  const version = doc.version === undefined ? 1 : Number(doc.version);
  if (version !== 1) throw new Error(`Unsupported event-webhooks version: ${doc.version}`);
  const subscriptions: EventWebhookConfig["subscriptions"] = {};
  const subsRaw = doc.subscriptions;
  if (subsRaw == null) return { version: 1, subscriptions };
  if (typeof subsRaw !== "object" || Array.isArray(subsRaw)) {
    throw new Error("subscriptions must be a mapping of event type → hook list");
  }
  for (const [eventType, hooksRaw] of Object.entries(subsRaw as Record<string, unknown>)) {
    if (!isEventWebhookAllowlisted(eventType)) {
      throw new Error(`Unknown or disallowed event type: ${eventType}`);
    }
    if (!Array.isArray(hooksRaw)) {
      throw new Error(`subscriptions.${eventType} must be a list of hooks`);
    }
    const seen = new Set<string>();
    subscriptions[eventType] = hooksRaw.map((h) => parseHook(h, eventType, seen));
  }
  return { version: 1, subscriptions };
}

export function loadEventWebhookConfig(contentRoot: string): EventWebhookConfig {
  const filePath = getEventWebhooksPath(contentRoot);
  if (!fs.existsSync(filePath)) return emptyConfig();
  try {
    const raw = yaml.load(fs.readFileSync(filePath, "utf-8"));
    return parseEventWebhookConfig(raw);
  } catch (err) {
    log.warn({ err, filePath }, "[EventWebhooks] Failed to load config; treating as empty");
    throw err;
  }
}

/** Load without throwing — empty on missing/invalid (emit path). */
export function loadEventWebhookConfigSafe(contentRoot: string): EventWebhookConfig {
  try {
    return loadEventWebhookConfig(contentRoot);
  } catch {
    return emptyConfig();
  }
}

function sealHeaders(
  incoming: Record<string, string> | undefined,
  previous: Record<string, string> | undefined,
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [name, value] of Object.entries(incoming ?? {})) {
    if (!isSecretWebhookHeaderName(name)) {
      out[name] = value;
      continue;
    }
    out[name] = sealSecretHeaderValue(value, previous?.[name]);
  }
  return out;
}

/** Encrypt new secret headers. A masked value keeps the one already on disk. */
export function sealEventWebhookHeaders(
  next: EventWebhookConfig,
  previous: EventWebhookConfig,
): EventWebhookConfig {
  const subscriptions: EventWebhookConfig["subscriptions"] = {};
  for (const [eventType, hooks] of Object.entries(next.subscriptions)) {
    if (!hooks) continue;
    const prevList =
      previous.subscriptions[eventType as EventWebhookAllowlistedType] ?? [];
    subscriptions[eventType as EventWebhookAllowlistedType] = hooks.map((hook) => {
      const prev = prevList.find((item) => item.id === hook.id);
      const headers = sealHeaders(hook.headers, prev?.headers);
      if (Object.keys(headers).length === 0) {
        const { headers: _omit, ...rest } = hook;
        return rest;
      }
      return { ...hook, headers };
    });
  }
  return { ...next, subscriptions };
}

/** Staff read: secret header values are a tail, never the bearer or the ciphertext. */
export function redactEventWebhookConfigForStaff(config: EventWebhookConfig): EventWebhookConfig {
  const subscriptions: EventWebhookConfig["subscriptions"] = {};
  for (const [eventType, hooks] of Object.entries(config.subscriptions)) {
    if (!hooks) continue;
    subscriptions[eventType as EventWebhookAllowlistedType] = hooks.map((hook) => {
      if (!hook.headers || Object.keys(hook.headers).length === 0) return hook;
      return { ...hook, headers: redactWebhookHeadersForStaff(hook.headers) };
    });
  }
  return { ...config, subscriptions };
}

export function saveEventWebhookConfig(contentRoot: string, config: EventWebhookConfig): void {
  const previous = loadEventWebhookConfigSafe(contentRoot);
  const normalized = parseEventWebhookConfig(sealEventWebhookHeaders(config, previous));
  const filePath = getEventWebhooksPath(contentRoot);
  const output = yaml.dump(
    {
      version: 1,
      subscriptions: normalized.subscriptions,
    },
    { lineWidth: 120, noRefs: true, sortKeys: false },
  );
  fs.writeFileSync(filePath, output, "utf-8");
}

export function findHook(
  config: EventWebhookConfig,
  eventType: string,
  hookId: string,
): EventWebhookHook | null {
  if (!isEventWebhookAllowlisted(eventType)) return null;
  const list = config.subscriptions[eventType] ?? [];
  return list.find((h) => h.id === hookId) ?? null;
}

export function listEnabledHooksForType(
  config: EventWebhookConfig,
  eventType: string,
): EventWebhookHook[] {
  if (!isEventWebhookAllowlisted(eventType)) return [];
  return (config.subscriptions[eventType] ?? []).filter((h) => h.enabled && h.url);
}

export function urlHost(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return "";
  }
}

function normalizeBuffer(buf: EventWebhookBuffer | undefined): EventWebhookBuffer {
  if (!buf) return { pendingEventIds: [], pendingCount: 0 };
  const pendingEventIds = Array.isArray(buf.pendingEventIds)
    ? buf.pendingEventIds.filter((n) => typeof n === "number")
    : [];
  const first =
    typeof buf.first_pending_at === "number" && Number.isFinite(buf.first_pending_at)
      ? buf.first_pending_at
      : undefined;
  const last =
    typeof buf.last_event_at === "number" && Number.isFinite(buf.last_event_at)
      ? buf.last_event_at
      : undefined;
  return {
    pendingEventIds,
    pendingCount: pendingEventIds.length,
    ...(first !== undefined ? { first_pending_at: first } : {}),
    ...(last !== undefined ? { last_event_at: last } : {}),
  };
}

function readBuffers(site: string): EventWebhookBuffers {
  ensureSchema(site);
  const row = getSiteSqlite(site)
    .prepare("SELECT value_json FROM pipeline_state WHERE key = ?")
    .get(BUFFERS_KEY) as { value_json: string } | undefined;
  if (!row) return {};
  try {
    const parsed = JSON.parse(row.value_json) as EventWebhookBuffers;
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function writeBuffers(site: string, buffers: EventWebhookBuffers): void {
  ensureSchema(site);
  getSiteSqlite(site)
    .prepare(
      `INSERT INTO pipeline_state (key, value_json) VALUES (?, ?)
       ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json`,
    )
    .run(BUFFERS_KEY, JSON.stringify(buffers));
}

export function getHookBuffer(site: string, eventType: string, hookId: string): EventWebhookBuffer {
  const key = bufferKey(eventType, hookId);
  return normalizeBuffer(readBuffers(site)[key]);
}

export function clearHookBuffer(site: string, eventType: string, hookId: string): number {
  clearFlushTimer(site, eventType, hookId);
  const buffers = readBuffers(site);
  const key = bufferKey(eventType, hookId);
  const prev = buffers[key];
  const dropped = prev?.pendingCount ?? prev?.pendingEventIds?.length ?? 0;
  if (key in buffers) {
    delete buffers[key];
    writeBuffers(site, buffers);
  }
  return dropped;
}

export function setHookBuffer(
  site: string,
  eventType: string,
  hookId: string,
  buffer: EventWebhookBuffer,
): void {
  const buffers = readBuffers(site);
  const key = bufferKey(eventType, hookId);
  const normalized = normalizeBuffer(buffer);
  if (normalized.pendingCount <= 0 || normalized.pendingEventIds.length === 0) {
    delete buffers[key];
    clearFlushTimer(site, eventType, hookId);
  } else {
    buffers[key] = {
      pendingEventIds: [...normalized.pendingEventIds],
      pendingCount: normalized.pendingEventIds.length,
      ...(normalized.first_pending_at !== undefined
        ? { first_pending_at: normalized.first_pending_at }
        : {}),
      ...(normalized.last_event_at !== undefined ? { last_event_at: normalized.last_event_at } : {}),
    };
  }
  writeBuffers(site, buffers);
}

/**
 * Atomically take the pending pile (claim-then-flush). Loser of a race sees empty.
 */
export function claimHookBuffer(
  site: string,
  eventType: string,
  hookId: string,
): EventWebhookClaim {
  clearFlushTimer(site, eventType, hookId);
  const db = getSiteSqlite(site);
  return db.transaction(() => {
    const buffers = readBuffers(site);
    const key = bufferKey(eventType, hookId);
    const buf = normalizeBuffer(buffers[key]);
    if (buf.pendingEventIds.length === 0) {
      return { eventIds: [] };
    }
    const claim: EventWebhookClaim = {
      eventIds: [...buf.pendingEventIds],
      ...(buf.first_pending_at !== undefined ? { first_pending_at: buf.first_pending_at } : {}),
      ...(buf.last_event_at !== undefined ? { last_event_at: buf.last_event_at } : {}),
    };
    delete buffers[key];
    writeBuffers(site, buffers);
    return claim;
  })();
}

/** Put a failed claim back, merging any events that arrived while claimed. */
export function restoreClaimedBuffer(
  site: string,
  eventType: string,
  hookId: string,
  claim: EventWebhookClaim,
): void {
  if (claim.eventIds.length === 0) return;
  const db = getSiteSqlite(site);
  db.transaction(() => {
    const current = getHookBuffer(site, eventType, hookId);
    const claimed = new Set(claim.eventIds);
    const newer = current.pendingEventIds.filter((id) => !claimed.has(id));
    const merged = [...claim.eventIds, ...newer];
    const firstCandidates = [claim.first_pending_at, current.first_pending_at].filter(
      (n): n is number => typeof n === "number",
    );
    const lastCandidates = [claim.last_event_at, current.last_event_at].filter(
      (n): n is number => typeof n === "number",
    );
    setHookBuffer(site, eventType, hookId, {
      pendingEventIds: merged,
      pendingCount: merged.length,
      ...(firstCandidates.length > 0 ? { first_pending_at: Math.min(...firstCandidates) } : {}),
      ...(lastCandidates.length > 0 ? { last_event_at: Math.max(...lastCandidates) } : {}),
    });
  })();
}

export function getAllPendingCounts(site: string): Record<string, number> {
  const buffers = readBuffers(site);
  const out: Record<string, number> = {};
  for (const [key, buf] of Object.entries(buffers)) {
    out[key] = buf.pendingCount ?? buf.pendingEventIds?.length ?? 0;
  }
  return out;
}

export function isHookDue(
  buf: EventWebhookBuffer,
  hook: EventWebhookHook,
  now: number = Date.now(),
): boolean {
  if (buf.pendingEventIds.length === 0) return false;
  if (buf.pendingCount >= hook.max_events_per_call) return true;
  if (hook.debounce_ms === 0 && hook.max_wait_ms === 0) return true;
  // Legacy piles without timestamps → already due
  if (buf.first_pending_at == null || buf.last_event_at == null) return true;
  if (hook.debounce_ms > 0 && now - buf.last_event_at >= hook.debounce_ms) return true;
  if (hook.max_wait_ms > 0 && now - buf.first_pending_at >= hook.max_wait_ms) return true;
  return false;
}

function msUntilDue(buf: EventWebhookBuffer, hook: EventWebhookHook, now: number): number | null {
  if (buf.pendingEventIds.length === 0) return null;
  if (isHookDue(buf, hook, now)) return 0;
  if (buf.first_pending_at == null || buf.last_event_at == null) return 0;
  const delays: number[] = [];
  if (hook.debounce_ms > 0) {
    delays.push(hook.debounce_ms - (now - buf.last_event_at));
  }
  if (hook.max_wait_ms > 0) {
    delays.push(hook.max_wait_ms - (now - buf.first_pending_at));
  }
  if (delays.length === 0) return null;
  return Math.max(0, Math.min(...delays));
}

export function clearFlushTimer(site: string, eventType: string, hookId: string): void {
  const key = timerKey(site, eventType, hookId);
  const existing = flushTimers.get(key);
  if (existing) clearTimeout(existing);
  flushTimers.delete(key);
}

export function scheduleFlushTimer(
  site: string,
  eventType: string,
  hook: EventWebhookHook,
): void {
  const buf = getHookBuffer(site, eventType, hook.id);
  const now = Date.now();
  const delay = msUntilDue(buf, hook, now);
  clearFlushTimer(site, eventType, hook.id);
  if (delay === null) return;
  const key = timerKey(site, eventType, hook.id);
  const handle = setTimeout(() => {
    flushTimers.delete(key);
    void flushHookIfDue({ site, eventType, hook }).catch((err) => {
      log.warn({ err, site, eventType, hookId: hook.id }, "[EventWebhooks] timer flush failed");
    });
  }, delay);
  handle.unref?.();
  flushTimers.set(key, handle);
}

export function recordDelivery(opts: {
  site: string;
  eventType: string;
  hookId: string;
  eventIds: number[];
  url: string;
  status: EventWebhookDeliveryStatus;
  httpStatus?: number | null;
  error?: string | null;
  durationMs?: number | null;
  source: EventWebhookDeliverySource;
}): number {
  ensureSchema(opts.site);
  const db = getSiteSqlite(opts.site);
  const now = Date.now();
  const info = db
    .prepare(
      `INSERT INTO event_webhook_deliveries (
        site, event_type, hook_id, event_ids_json, url_host, status,
        http_status, error, duration_ms, batch_size, source, created_at
      ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
    )
    .run(
      opts.site,
      opts.eventType,
      opts.hookId,
      JSON.stringify(opts.eventIds),
      urlHost(opts.url),
      opts.status,
      opts.httpStatus ?? null,
      opts.error ?? null,
      opts.durationMs ?? null,
      opts.eventIds.length,
      opts.source,
      now,
    );
  const cutoff = now - EVENT_WEBHOOK_DELIVERY_RETENTION_MS;
  db.prepare("DELETE FROM event_webhook_deliveries WHERE site = ? AND created_at < ?").run(
    opts.site,
    cutoff,
  );
  return Number(info.lastInsertRowid);
}

function rowToDelivery(row: Record<string, unknown>): EventWebhookDeliveryRow {
  let eventIds: number[] = [];
  try {
    const parsed = JSON.parse(String(row.event_ids_json ?? "[]")) as unknown;
    if (Array.isArray(parsed)) {
      eventIds = parsed.filter((n): n is number => typeof n === "number");
    }
  } catch {
    eventIds = [];
  }
  return {
    id: Number(row.id),
    site: String(row.site),
    event_type: String(row.event_type),
    hook_id: String(row.hook_id),
    event_ids: eventIds,
    url_host: String(row.url_host ?? ""),
    status:
      row.status === "success"
        ? "success"
        : row.status === "skipped"
          ? "skipped"
          : "failure",
    http_status: typeof row.http_status === "number" ? row.http_status : null,
    error: typeof row.error === "string" ? row.error : null,
    duration_ms: typeof row.duration_ms === "number" ? row.duration_ms : null,
    batch_size: typeof row.batch_size === "number" ? row.batch_size : eventIds.length,
    source:
      row.source === "test" || row.source === "retry" || row.source === "live"
        ? row.source
        : "live",
    created_at: Number(row.created_at),
  };
}

export function listDeliveries(
  site: string,
  opts?: {
    sinceMs?: number;
    untilMs?: number;
    eventType?: string;
    hookId?: string;
    status?: EventWebhookDeliveryStatus;
    order?: "asc" | "desc";
    limit?: number;
  },
): EventWebhookDeliveryRow[] {
  ensureSchema(site);
  const since = opts?.sinceMs ?? Date.now() - EVENT_WEBHOOK_DELIVERY_RETENTION_MS;
  const limit = Math.min(Math.max(opts?.limit ?? 200, 1), 500);
  const order = opts?.order === "asc" ? "ASC" : "DESC";
  const db = getSiteSqlite(site);

  const clauses: string[] = ["site = ?", "created_at >= ?"];
  const params: unknown[] = [site, since];

  if (typeof opts?.untilMs === "number" && Number.isFinite(opts.untilMs)) {
    clauses.push("created_at <= ?");
    params.push(opts.untilMs);
  }
  if (opts?.eventType) {
    clauses.push("event_type = ?");
    params.push(opts.eventType);
  }
  if (opts?.hookId) {
    clauses.push("hook_id = ?");
    params.push(opts.hookId);
  }
  if (
    opts?.status === "success" ||
    opts?.status === "failure" ||
    opts?.status === "skipped"
  ) {
    clauses.push("status = ?");
    params.push(opts.status);
  }

  params.push(limit);
  const rows = db
    .prepare(
      `SELECT * FROM event_webhook_deliveries
       WHERE ${clauses.join(" AND ")}
       ORDER BY created_at ${order}, id ${order}
       LIMIT ?`,
    )
    .all(...params) as Record<string, unknown>[];
  return rows.map(rowToDelivery);
}

/** Rebuild outbound body for a logged delivery (read-only preview). */
export function previewDeliveryPayload(
  site: string,
  contentRoot: string,
  deliveryId: number,
): {
  delivery: EventWebhookDeliveryRow;
  payload: Record<string, unknown> | null;
  events_found: number;
  events_requested: number;
  hook: {
    id: string;
    enabled: boolean;
    url_host: string;
    debounce_ms: number;
    max_wait_ms: number;
    max_events_per_call: number;
  } | null;
  warnings: string[];
} | null {
  const delivery = getDeliveryById(site, deliveryId);
  if (!delivery) return null;

  const warnings: string[] = ["recreated_not_archived"];
  const config = loadEventWebhookConfigSafe(contentRoot);
  const hook = findHook(config, delivery.event_type, delivery.hook_id);
  const hookSummary = hook
    ? {
        id: hook.id,
        enabled: hook.enabled,
        url_host: urlHost(hook.url),
        debounce_ms: hook.debounce_ms,
        max_wait_ms: hook.max_wait_ms,
        max_events_per_call: hook.max_events_per_call,
      }
    : null;

  if (!hook) warnings.push("hook_missing");
  else if (!hook.enabled) warnings.push("hook_disabled");

  const eventsRequested = delivery.event_ids.length;
  const events = loadEventsForDelivery(site, delivery.event_ids);
  const eventsFound = events.length;

  if (eventsFound === 0) {
    warnings.push("events_missing");
    return {
      delivery,
      payload: null,
      events_found: 0,
      events_requested: eventsRequested,
      hook: hookSummary,
      warnings,
    };
  }
  if (eventsFound < eventsRequested) {
    warnings.push("events_partial");
  }

  const bodyHook: EventWebhookHook = hook ?? {
    id: delivery.hook_id,
    enabled: false,
    url: "",
    method: "POST",
    debounce_ms: EVENT_WEBHOOK_DEBOUNCE_DEFAULT_MS,
    max_wait_ms: EVENT_WEBHOOK_MAX_WAIT_DEFAULT_MS,
    max_events_per_call: Math.max(1, delivery.batch_size || 1),
  };

  const payload = buildWebhookBody({
    site,
    eventType: delivery.event_type,
    hook: bodyHook,
    events,
    source: delivery.source,
  });

  return {
    delivery,
    payload,
    events_found: eventsFound,
    events_requested: eventsRequested,
    hook: hookSummary,
    warnings,
  };
}

export function getDeliveryById(site: string, id: number): EventWebhookDeliveryRow | null {
  ensureSchema(site);
  const row = getSiteSqlite(site)
    .prepare("SELECT * FROM event_webhook_deliveries WHERE site = ? AND id = ?")
    .get(site, id) as Record<string, unknown> | undefined;
  return row ? rowToDelivery(row) : null;
}

const BLOCKER_EVENT_TYPES = new Set<string>([
  "proposal_blocker_added",
  "proposal_blocker_resolved",
  "proposal_blocker_reopened",
]);

/** Payload keys that reach the receiver, per event type. Everything else stays in the event store. */
const WEBHOOK_PAYLOAD_PASSTHROUGH: Partial<Record<EventWebhookAllowlistedType, readonly string[]>> = {
  proposal_blocker_added: ["blocker_id", "staff_summary", "body"],
  proposal_blocker_resolved: [
    "blocker_id",
    "staff_summary",
    "resolve_note",
    "open_blocker_count",
    "blocker_author",
    "blocker_author_actor_type",
  ],
  proposal_blocker_reopened: [
    "blocker_id",
    "staff_summary",
    "open_blocker_count",
    "blocker_author",
    "blocker_author_actor_type",
  ],
};

export const WEBHOOK_PAYLOAD_TEXT_MAX = 2000;
const WEBHOOK_TRUNCATED_TEXT_KEYS = new Set(["body", "resolve_note"]);

function passthroughPayload(event: ContentEvent): Record<string, unknown> {
  const keys = isEventWebhookAllowlisted(event.type)
    ? WEBHOOK_PAYLOAD_PASSTHROUGH[event.type]
    : undefined;
  if (!keys) return {};
  const out: Record<string, unknown> = {};
  for (const key of keys) {
    const value = event.payload?.[key];
    if (value === undefined) continue;
    if (
      WEBHOOK_TRUNCATED_TEXT_KEYS.has(key) &&
      typeof value === "string" &&
      value.length > WEBHOOK_PAYLOAD_TEXT_MAX
    ) {
      out[key] = value.slice(0, WEBHOOK_PAYLOAD_TEXT_MAX);
      out[`${key}_truncated`] = true;
      continue;
    }
    out[key] = value;
  }
  return out;
}

export function slimEventForWebhook(
  event: ContentEvent,
  proposal?: EventWebhookProposalSummary | null,
): Record<string, unknown> {
  const proposalId =
    typeof event.payload?.proposal_id === "string" ? event.payload.proposal_id : undefined;
  const out: Record<string, unknown> = {
    id: event.id,
    type: event.type,
    created_at: event.created_at,
    resource: event.resource,
    payload: {
      ...(proposalId ? { proposal_id: proposalId } : {}),
      ...passthroughPayload(event),
    },
    attribution: event.attribution,
  };
  if (proposal) {
    out.proposal = {
      id: proposal.id,
      kind: proposal.kind,
      proposer_username: proposal.proposer_username,
      proposer_actor: proposal.proposer_actor,
      content_types: proposal.content_types,
      locales: proposal.locales,
      funnel: proposal.funnel,
    };
  }
  return out;
}

function enrichEntrySaved(
  events: ContentEvent[],
  _hook: EventWebhookHook,
): Record<string, unknown>[] {
  return events.map((event) => {
    const contentRoot = resolveContentRootForSite(event.site);
    const contentType = event.resource.contentType;
    const slug = event.resource.slug;
    const tracking =
      contentRoot && contentType && slug
        ? buildServerPageTracking({ contentRoot, contentType, slug, mode: "ids" })
        : null;
    const item: Record<string, unknown> = {
      id: event.id,
      type: event.type,
      created_at: event.created_at,
      resource: event.resource,
    };
    if (tracking) item.tracking = tracking;
    return item;
  });
}

enrichEventWebhookPayload.entry_common_saved = enrichEntrySaved;

/** Variant slug from `b.en.yml`. Live locale files are not a test arm. */
function savedVariantSlug(resource: ContentEvent["resource"]): string | null {
  if (resource.layer !== "variant") return null;
  const file = (resource.path ?? "").split("/").pop() ?? "";
  const base = file.replace(/\.ya?ml$/i, "");
  const dot = base.lastIndexOf(".");
  if (dot <= 0) return null;
  return base.slice(0, dot);
}

function localeVersioning(
  contentRoot: string,
  contentType: string,
  slug: string,
  locale: string,
): { started_at?: string | null; variants?: { slug: string; allocation: number }[] } | null {
  try {
    const file = path.join(contentRoot, getFolder(contentType, contentRoot), slug, "versioning.yml");
    if (!fs.existsSync(file)) return null;
    const parsed = yaml.load(fs.readFileSync(file, "utf-8"));
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
    const block = (parsed as Record<string, unknown>)[locale];
    if (!block || typeof block !== "object" || Array.isArray(block)) return null;
    return block as { started_at?: string | null; variants?: { slug: string; allocation: number }[] };
  } catch {
    return null;
  }
}

/** Locale-file save. Test fields match a served page: only when that language has traffic. */
function enrichEntryLocaleSaved(
  events: ContentEvent[],
  _hook: EventWebhookHook,
): Record<string, unknown>[] {
  return events.map((event) => {
    const item: Record<string, unknown> = {
      id: event.id,
      type: event.type,
      created_at: event.created_at,
      resource: event.resource,
    };
    const contentRoot = resolveContentRootForSite(event.site);
    const { contentType, slug, locale } = event.resource;
    if (!contentRoot || !contentType || !slug || !locale) return item;
    const config = localeVersioning(contentRoot, contentType, slug, locale);
    if (!config || !hasActiveTraffic(config.variants)) return item;
    item.experiment_id = experimentId(contentType, slug, locale, config.started_at ?? null);
    item.variant =
      event.resource.layer === "variant"
        ? savedVariantSlug(event.resource) ?? DEFAULT_VARIANT_SLUG
        : DEFAULT_VARIANT_SLUG;
    return item;
  });
}

enrichEventWebhookPayload.entry_locale_saved = enrichEntryLocaleSaved;

export function buildWebhookBody(opts: {
  site: string;
  eventType: string;
  hook: EventWebhookHook;
  events: ContentEvent[];
  source: EventWebhookDeliverySource;
}): Record<string, unknown> {
  const enricher = isEventWebhookAllowlisted(opts.eventType)
    ? enrichEventWebhookPayload[opts.eventType]
    : undefined;

  const proposalCache = new Map<string, EventWebhookProposalSummary | null>();
  const resolveProposal = (event: ContentEvent): EventWebhookProposalSummary | null => {
    const proposalId =
      typeof event.payload?.proposal_id === "string" ? event.payload.proposal_id : undefined;
    if (!proposalId) return null;
    if (proposalCache.has(proposalId)) return proposalCache.get(proposalId) ?? null;
    const loaded = getProposalForWebhookFilter(opts.site, proposalId);
    proposalCache.set(proposalId, loaded);
    return loaded;
  };

  const events = enricher
    ? enricher(opts.events, opts.hook)
    : opts.events.map((ev) => slimEventForWebhook(ev, resolveProposal(ev)));
  return {
    event: "pipeline.events",
    site: opts.site,
    triggered_at: new Date().toISOString(),
    source: opts.source,
    hook_id: opts.hook.id,
    event_type: opts.eventType,
    throttle: {
      debounce_ms: opts.hook.debounce_ms,
      max_wait_ms: opts.hook.max_wait_ms,
      max_events_per_call: opts.hook.max_events_per_call,
      count_in_batch: opts.events.length,
    },
    events,
  };
}

export async function deliverEventWebhookHttp(opts: {
  url: string;
  headers?: Record<string, string>;
  body: Record<string, unknown>;
}): Promise<
  | { ok: true; status: number; durationMs: number }
  | { ok: false; status: number | null; error: string; durationMs: number }
> {
  const started = Date.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), WEBHOOK_TIMEOUT_MS);
  let resolvedHeaders: Record<string, string>;
  try {
    resolvedHeaders = resolveWebhookHeadersForDelivery(opts.headers);
  } catch (err) {
    clearTimeout(timer);
    return {
      ok: false,
      status: null,
      error: err instanceof Error ? err.message : "Could not decrypt a webhook header",
      durationMs: Date.now() - started,
    };
  }
  try {
    const response = await fetch(opts.url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...resolvedHeaders,
      },
      body: JSON.stringify(opts.body),
      signal: controller.signal,
    });
    const durationMs = Date.now() - started;
    if (!response.ok) {
      const upstreamBody = await response.text().catch(() => "");
      return {
        ok: false,
        status: response.status,
        error: `Upstream HTTP ${response.status}${upstreamBody ? `: ${upstreamBody.slice(0, 200)}` : ""}`,
        durationMs,
      };
    }
    return { ok: true, status: response.status, durationMs };
  } catch (err) {
    const durationMs = Date.now() - started;
    const aborted = err instanceof Error && err.name === "AbortError";
    return {
      ok: false,
      status: null,
      error: aborted
        ? "Webhook upstream timed out"
        : err instanceof Error
          ? err.message
          : String(err),
      durationMs,
    };
  } finally {
    clearTimeout(timer);
  }
}

async function enqueueDeliveryJob(payload: {
  site: string;
  eventType: string;
  hookId: string;
  eventIds: number[];
  source: EventWebhookDeliverySource;
}): Promise<{ queued: boolean; error?: string }> {
  try {
    const result = await enqueueJob("event_webhook_delivery", payload);
    if (!result.queued && !result.deduped) {
      return { queued: false, error: "could not queue" };
    }
    return { queued: true };
  } catch (err) {
    return { queued: false, error: err instanceof Error ? err.message : String(err) };
  }
}

/**
 * Enqueue delivery for known event ids (retry path / already claimed).
 * Returns whether the job was queued. Does not restore buffers.
 */
export async function enqueueHookDelivery(opts: {
  site: string;
  eventType: string;
  hook: EventWebhookHook;
  eventIds: number[];
  source: EventWebhookDeliverySource;
}): Promise<{ queued: boolean }> {
  const result = await enqueueDeliveryJob({
    site: opts.site,
    eventType: opts.eventType,
    hookId: opts.hook.id,
    eventIds: opts.eventIds,
    source: opts.source,
  });
  if (!result.queued) {
    recordDelivery({
      site: opts.site,
      eventType: opts.eventType,
      hookId: opts.hook.id,
      eventIds: opts.eventIds,
      url: opts.hook.url,
      status: "failure",
      error: result.error ?? "could not queue",
      source: opts.source,
    });
    return { queued: false };
  }
  return { queued: true };
}

/**
 * Claim → enqueue; restore claim on enqueue failure.
 */
export async function flushHookBuffer(opts: {
  site: string;
  eventType: string;
  hook: EventWebhookHook;
  source?: EventWebhookDeliverySource;
}): Promise<number> {
  const claim = claimHookBuffer(opts.site, opts.eventType, opts.hook.id);
  if (claim.eventIds.length === 0) return 0;
  const queued = await enqueueHookDelivery({
    site: opts.site,
    eventType: opts.eventType,
    hook: opts.hook,
    eventIds: claim.eventIds,
    source: opts.source ?? "live",
  });
  if (!queued.queued) {
    restoreClaimedBuffer(opts.site, opts.eventType, opts.hook.id, claim);
    scheduleFlushTimer(opts.site, opts.eventType, opts.hook);
    return 0;
  }
  return claim.eventIds.length;
}

export async function flushHookIfDue(opts: {
  site: string;
  eventType: string;
  hook: EventWebhookHook;
  now?: number;
}): Promise<number> {
  const buf = getHookBuffer(opts.site, opts.eventType, opts.hook.id);
  if (!isHookDue(buf, opts.hook, opts.now ?? Date.now())) {
    return 0;
  }
  return flushHookBuffer({
    site: opts.site,
    eventType: opts.eventType,
    hook: opts.hook,
  });
}

export async function flushDueBuffersForSite(
  site: string,
  contentRoot: string,
): Promise<number> {
  const config = loadEventWebhookConfigSafe(contentRoot);
  let flushed = 0;
  for (const type of EVENT_WEBHOOK_ALLOWLIST) {
    for (const hook of listEnabledHooksForType(config, type)) {
      try {
        flushed += await flushHookIfDue({ site, eventType: type, hook });
      } catch (err) {
        log.warn({ err, site, type, hookId: hook.id }, "[EventWebhooks] due flush failed");
      }
    }
  }
  return flushed;
}

export async function flushDueBuffersAllSites(): Promise<void> {
  try {
    // Lazy import to avoid circular deps at module load (ESM — no require).
    const { getSiteContextMap } = await import("../site-manager");
    for (const ctx of getSiteContextMap().values()) {
      await flushDueBuffersForSite(ctx.contentRootName, ctx.contentRoot);
    }
  } catch (err) {
    log.warn({ err }, "[EventWebhooks] flushDueBuffersAllSites failed");
  }
}

/** Start periodic due-buffer scan (idempotent). Call once from server boot. */
export function startEventWebhookDueScan(): void {
  if (dueScanTimer) return;
  dueScanTimer = setInterval(() => {
    void flushDueBuffersAllSites();
  }, EVENT_WEBHOOK_DUE_SCAN_INTERVAL_MS);
  dueScanTimer.unref?.();
}

/** Test helper: stop the due scan interval. */
export function stopEventWebhookDueScanForTests(): void {
  if (dueScanTimer) {
    clearInterval(dueScanTimer);
    dueScanTimer = null;
  }
  for (const handle of flushTimers.values()) clearTimeout(handle);
  flushTimers.clear();
}

/**
 * Emit-path fan-out. Never throws. contentRoot resolves YAML; site is SQLite key.
 */
export function maybeEnqueueEventWebhook(
  event: ContentEvent,
  contentRoot: string | null | undefined,
): void {
  try {
    if (!contentRoot) return;
    if (!isEventWebhookAllowlisted(event.type)) return;
    // Paused (escalated) proposals: kept in history, never sent, not re-sent on release.
    if (BLOCKER_EVENT_TYPES.has(event.type) && event.payload?.paused === true) return;
    const config = loadEventWebhookConfigSafe(contentRoot);
    const hooks = listEnabledHooksForType(config, event.type);
    if (hooks.length === 0) return;

    const matcher = isEventWebhookAllowlisted(event.type)
      ? eventWebhookFilters[event.type]
      : undefined;

    const now = Date.now();
    for (const hook of hooks) {
      const match = matcher
        ? matcher(event, hook)
        : !hook.filter || Object.keys(hook.filter).length === 0
          ? { ok: true as const }
          : { ok: false as const, reason: "no_match" as const };
      if (!match.ok) {
        if (match.reason === "proposal_unresolved") {
          recordDelivery({
            site: event.site,
            eventType: event.type,
            hookId: hook.id,
            eventIds: [event.id],
            url: hook.url,
            status: "skipped",
            error: "proposal_unresolved",
            source: "live",
          });
        }
        continue;
      }

      const buf = getHookBuffer(event.site, event.type, hook.id);
      const wasEmpty = buf.pendingEventIds.length === 0;
      const nextIds = [...buf.pendingEventIds, event.id];
      // Preserve missing timestamps on legacy non-empty piles (stay due).
      const nextBuf: EventWebhookBuffer = {
        pendingEventIds: nextIds,
        pendingCount: nextIds.length,
        ...(wasEmpty
          ? { first_pending_at: now, last_event_at: now }
          : buf.first_pending_at == null || buf.last_event_at == null
            ? {}
            : {
                first_pending_at: buf.first_pending_at,
                last_event_at: now,
              }),
      };
      setHookBuffer(event.site, event.type, hook.id, nextBuf);

      if (isHookDue(nextBuf, hook, now)) {
        void flushHookIfDue({ site: event.site, eventType: event.type, hook, now }).catch(
          (err) => {
            log.warn(
              { err, eventId: event.id, hookId: hook.id },
              "[EventWebhooks] enqueue failed",
            );
          },
        );
      } else {
        scheduleFlushTimer(event.site, event.type, hook);
      }
    }
  } catch (err) {
    log.warn({ err, eventId: event.id, type: event.type }, "[EventWebhooks] maybeEnqueue failed");
  }
}

/** Same derivation as site-manager (contentRootName = cwd-relative content folder). */
export function resolveContentRootForSite(site: string): string | null {
  try {
    for (const config of getSiteConfigs()) {
      const contentRoot = path.isAbsolute(config.contentFolder)
        ? config.contentFolder
        : path.join(process.cwd(), config.contentFolder);
      if (path.relative(process.cwd(), contentRoot) === site) return contentRoot;
    }
  } catch (err) {
    log.warn({ err, site }, "[EventWebhooks] could not resolve content root");
  }
  return null;
}

export function loadEventsForDelivery(site: string, eventIds: number[]): ContentEvent[] {
  const out: ContentEvent[] = [];
  for (const id of eventIds) {
    const ev = getEventById(site, id);
    if (ev) out.push(ev);
  }
  return out;
}

/** Diff helpers for PUT — which hook buffers to drop when URL/enable changes. */
export function computeDroppedBuffersOnSave(
  site: string,
  before: EventWebhookConfig,
  after: EventWebhookConfig,
): { key: string; eventType: string; hookId: string; dropped: number }[] {
  const dropped: { key: string; eventType: string; hookId: string; dropped: number }[] = [];
  const beforeMap = new Map<string, EventWebhookHook>();
  for (const type of EVENT_WEBHOOK_ALLOWLIST) {
    for (const h of before.subscriptions[type] ?? []) {
      beforeMap.set(bufferKey(type, h.id), h);
    }
  }
  const afterMap = new Map<string, EventWebhookHook>();
  for (const type of EVENT_WEBHOOK_ALLOWLIST) {
    for (const h of after.subscriptions[type] ?? []) {
      afterMap.set(bufferKey(type, h.id), h);
    }
  }

  for (const [key, prev] of beforeMap) {
    const [eventType, hookId] = key.split("::") as [string, string];
    const next = afterMap.get(key);
    const shouldDrop =
      !next ||
      next.enabled === false ||
      (prev.url || "") !== (next.url || "") ||
      !filtersEqual(prev.filter, next?.filter);
    if (!shouldDrop) continue;
    const n = clearHookBuffer(site, eventType, hookId);
    if (n > 0) dropped.push({ key, eventType, hookId, dropped: n });
  }

  return dropped;
}

export type { EventType };
