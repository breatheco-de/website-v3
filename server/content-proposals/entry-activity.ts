/**
 * Recent entry-write activity for proposal create/apply gates and enrichment.
 * Gate filters (session / this-proposal applies) do not hide events from inspect lists.
 */

import {
  ENTRY_ACTIVITY_WINDOW_DAYS,
  ENTRY_ACTIVITY_WRITE_TYPES,
  isEntryActivityWriteType,
} from "@shared/event-log-filters";
import { buildEntryKey } from "../../scripts/validation/shared/entryKey";
import { listEvents } from "../events/event-store";
import type { ContentEvent } from "../events/types";

export type RecentActivityRow = {
  entryKey: string;
  writeCount: number;
  windowDays: number;
};

export type ProposalActivityEntryRef = {
  contentType: string;
  slug: string;
  locale: string;
  variant?: string | null;
};

export type ProposalApplyExclusion = ProposalActivityEntryRef & {
  applied_at: number | null;
  applied_by: string | null;
};

export type ResolveRecentActivityOk = {
  ok: true;
  activity: RecentActivityRow[];
  /** Sum of gate write counts across requested keys (after filters). */
  gateWriteCount: number;
  windowDays: number;
};

export type ResolveRecentActivityErr = {
  ok: false;
  code: "activity_unavailable";
  error: string;
};

export type ResolveRecentActivityResult = ResolveRecentActivityOk | ResolveRecentActivityErr;

/** Writes within this window of an entry's applied_at+applied_by are treated as this proposal's apply. */
export const PROPOSAL_APPLY_EXCLUDE_WINDOW_MS = 120_000;

const LIST_CAP = 500;

export function activityKeysForEntries(entries: ProposalActivityEntryRef[]): string[] {
  const keys = new Set<string>();
  for (const e of entries) {
    if (!e.contentType || !e.slug || !e.locale) continue;
    keys.add(buildEntryKey(e.contentType, e.slug, e.locale));
    if (e.variant?.trim()) {
      keys.add(buildEntryKey(e.contentType, e.slug, e.locale, e.variant.trim()));
    }
  }
  return [...keys];
}

function liveKeysForEntries(entries: ProposalActivityEntryRef[]): string[] {
  const keys = new Set<string>();
  for (const e of entries) {
    if (!e.contentType || !e.slug || !e.locale) continue;
    keys.add(buildEntryKey(e.contentType, e.slug, e.locale));
  }
  return [...keys];
}

function eventLiveKey(ev: ContentEvent): string | null {
  const fromPayload =
    typeof ev.payload?.entryKey === "string" ? ev.payload.entryKey.trim() : "";
  if (fromPayload && !fromPayload.includes("@")) return fromPayload;
  if (fromPayload.includes("@")) {
    return fromPayload.slice(0, fromPayload.lastIndexOf("@"));
  }
  const r = ev.resource as Record<string, unknown> | undefined;
  const contentType = typeof r?.contentType === "string" ? r.contentType : "";
  const slug = typeof r?.slug === "string" ? r.slug : "";
  const locale = typeof r?.locale === "string" ? r.locale : "";
  if (!contentType || !slug || !locale) return null;
  return buildEntryKey(contentType, slug, locale);
}

function eventVariantSlug(ev: ContentEvent): string | null {
  const fromPayload =
    typeof ev.payload?.entryKey === "string" && ev.payload.entryKey.includes("@")
      ? ev.payload.entryKey.slice(ev.payload.entryKey.lastIndexOf("@") + 1)
      : "";
  if (fromPayload) return fromPayload;
  const r = ev.resource as Record<string, unknown> | undefined;
  const layer = r?.layer ?? ev.payload?.layer;
  if (layer !== "variant") return null;
  const path = typeof r?.path === "string" ? r.path : typeof ev.payload?.path === "string" ? ev.payload.path : "";
  const locale = typeof r?.locale === "string" ? r.locale : "";
  if (!path || !locale) return null;
  const m = path.match(new RegExp(`/([^/]+)\\.${locale}\\.ya?ml$`, "i"));
  if (!m?.[1]) return null;
  const base = m[1];
  if (/^[a-z]{2}$/i.test(base)) return null;
  return base;
}

function eventActivityKey(ev: ContentEvent): string | null {
  const live = eventLiveKey(ev);
  if (!live) return null;
  const variant = eventVariantSlug(ev);
  return variant ? `${live}@${variant}` : live;
}

function primaryAuthor(ev: ContentEvent): string {
  const a = ev.attribution?.[0]?.author;
  return typeof a === "string" ? a.trim() : "";
}

function isExcludedProposalApply(
  ev: ContentEvent,
  activityKey: string,
  excludes: ProposalApplyExclusion[] | undefined,
): boolean {
  if (!excludes?.length) return false;
  const payloadPid = ev.payload?.proposal_id;
  // Future-tagged writes
  if (typeof payloadPid === "string" && payloadPid.trim()) {
    // Caller passes exclusions only for one proposal; any tagged id match is enough when we
    // also check keys below via applied rows. Prefer applied_at window when untagged.
  }
  for (const ex of excludes) {
    if (!ex.applied_at || !ex.applied_by) continue;
    const live = buildEntryKey(ex.contentType, ex.slug, ex.locale);
    const draft = ex.variant?.trim()
      ? buildEntryKey(ex.contentType, ex.slug, ex.locale, ex.variant.trim())
      : null;
    if (activityKey !== live && activityKey !== draft) continue;
    if (primaryAuthor(ev) !== ex.applied_by.trim()) continue;
    if (Math.abs(ev.created_at - ex.applied_at) <= PROPOSAL_APPLY_EXCLUDE_WINDOW_MS) {
      return true;
    }
  }
  return false;
}

/**
 * Count recent people/agent writes for proposal entry keys (live always; draft when named).
 * Session / proposal-apply exclusions affect gate counts only.
 */
export function resolveProposalEntryActivity(opts: {
  site: string;
  entries: ProposalActivityEntryRef[];
  excludeAgentSessionId?: string | null;
  excludeProposalApplies?: ProposalApplyExclusion[];
  now?: number;
  /** Injected for tests */
  listWriteEvents?: (liveKeys: string[], since: number) => ContentEvent[];
}): ResolveRecentActivityResult {
  try {
    const now = opts.now ?? Date.now();
    const since = now - ENTRY_ACTIVITY_WINDOW_DAYS * 24 * 60 * 60 * 1000;
    const requestedKeys = activityKeysForEntries(opts.entries);
    if (requestedKeys.length === 0) {
      return {
        ok: true,
        activity: [],
        gateWriteCount: 0,
        windowDays: ENTRY_ACTIVITY_WINDOW_DAYS,
      };
    }

    const liveKeys = liveKeysForEntries(opts.entries);
    const events =
      opts.listWriteEvents?.(liveKeys, since) ??
      listEvents({
        site: opts.site,
        entries: liveKeys,
        types: [...ENTRY_ACTIVITY_WRITE_TYPES],
        actors: ["people", "agents"],
        since,
        limit: LIST_CAP,
      });

    const excludeSession = opts.excludeAgentSessionId?.trim() || "";
    const counts = new Map<string, number>();
    for (const key of requestedKeys) counts.set(key, 0);

    for (const ev of events) {
      if (!isEntryActivityWriteType(ev.type)) continue;
      const activityKey = eventActivityKey(ev);
      if (!activityKey || !counts.has(activityKey)) continue;
      if (excludeSession && ev.agent_session_id === excludeSession) continue;
      if (isExcludedProposalApply(ev, activityKey, opts.excludeProposalApplies)) continue;
      counts.set(activityKey, (counts.get(activityKey) ?? 0) + 1);
    }

    const activity: RecentActivityRow[] = requestedKeys.map((entryKey) => ({
      entryKey,
      writeCount: counts.get(entryKey) ?? 0,
      windowDays: ENTRY_ACTIVITY_WINDOW_DAYS,
    }));
    const gateWriteCount = activity.reduce((sum, row) => sum + row.writeCount, 0);
    return {
      ok: true,
      activity,
      gateWriteCount,
      windowDays: ENTRY_ACTIVITY_WINDOW_DAYS,
    };
  } catch (err) {
    return {
      ok: false,
      code: "activity_unavailable",
      error:
        err instanceof Error
          ? err.message
          : "Could not load recent entry activity",
    };
  }
}

/** Full event list for MCP/staff inspect (no gate exclusions). */
export function listEntryActivityEvents(opts: {
  site: string;
  contentType: string;
  slug: string;
  locale: string;
  variant?: string | null;
  limit?: number;
  now?: number;
}): ResolveRecentActivityResult & { events?: ContentEvent[] } {
  const entries: ProposalActivityEntryRef[] = [
    {
      contentType: opts.contentType,
      slug: opts.slug,
      locale: opts.locale,
      variant: opts.variant,
    },
  ];
  const resolved = resolveProposalEntryActivity({
    site: opts.site,
    entries,
    now: opts.now,
  });
  if (!resolved.ok) return resolved;

  try {
    const now = opts.now ?? Date.now();
    const since = now - ENTRY_ACTIVITY_WINDOW_DAYS * 24 * 60 * 60 * 1000;
    const liveKey = buildEntryKey(opts.contentType, opts.slug, opts.locale);
    const limit = Math.min(Math.max(opts.limit ?? 20, 1), 100);
    const events = listEvents({
      site: opts.site,
      entries: [liveKey],
      types: [...ENTRY_ACTIVITY_WRITE_TYPES],
      actors: ["people", "agents"],
      since,
      limit: LIST_CAP,
    }).filter((ev) => {
      if (!isEntryActivityWriteType(ev.type)) return false;
      const key = eventActivityKey(ev);
      if (!key) return false;
      if (opts.variant?.trim()) {
        return key === buildEntryKey(opts.contentType, opts.slug, opts.locale, opts.variant.trim()) ||
          key === liveKey;
      }
      return key === liveKey || key.startsWith(`${liveKey}@`);
    });

    // When variant requested, prefer that draft's events first but still allow live in list
    const filtered = opts.variant?.trim()
      ? events.filter((ev) => {
          const key = eventActivityKey(ev);
          const draft = buildEntryKey(
            opts.contentType,
            opts.slug,
            opts.locale,
            opts.variant!.trim(),
          );
          return key === draft || key === liveKey;
        })
      : events.filter((ev) => eventActivityKey(ev) === liveKey);

    return {
      ...resolved,
      events: filtered.slice(0, limit),
    };
  } catch (err) {
    return {
      ok: false,
      code: "activity_unavailable",
      error:
        err instanceof Error
          ? err.message
          : "Could not load recent entry activity",
    };
  }
}
