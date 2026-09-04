import {
  ENTRY_ACTIVITY_RELATED_CAP,
  isEntryActivityRelatedIssueType,
  isEntryActivityRelatedType,
  isEntryActivityWriteType,
} from "@shared/event-log-filters";
import { formatAttributionEntry, type EventAttributionEntry } from "@/lib/formatIssueActor";

/** Page size for Activity modal Load more. */
export const ENTRY_ACTIVITY_PAGE_SIZE = 30;

/** Minimal event shape for write-related history selection. */
export type WriteRelatedEventInput = {
  id: number;
  type: string;
  payload?: Record<string, unknown> | null;
  created_at: number;
};

const RELATED_TITLE: Record<string, string> = {
  validation_issue_claimed: "Claimed issue",
  validation_issue_released: "Released claim",
  validation_issue_completed: "Marked fixed",
  agent_session_started: "Session started",
  agent_session_note: "Session note",
  agent_session_summarized: "Session summary",
};

/** Staff title for a related-history row. */
export function formatRelatedActivityTitle(type: string): string {
  return RELATED_TITLE[type] ?? "Related event";
}

/**
 * Session-scoped context for one write: this page's issue events + run notes.
 * Oldest → newest; capped. No heuristics when session fetch already scoped the list.
 */
export function selectWriteRelatedEvents(opts: {
  events: WriteRelatedEventInput[];
  entryKey: string;
  writeEventId: number;
  cap?: number;
}): WriteRelatedEventInput[] {
  const cap = opts.cap ?? ENTRY_ACTIVITY_RELATED_CAP;
  const entryKey = opts.entryKey.trim();
  const kept: WriteRelatedEventInput[] = [];

  for (const event of opts.events) {
    if (event.id === opts.writeEventId) continue;
    if (isEntryActivityWriteType(event.type)) continue;
    if (!isEntryActivityRelatedType(event.type)) continue;

    if (isEntryActivityRelatedIssueType(event.type)) {
      const key =
        typeof event.payload?.entryKey === "string" ? event.payload.entryKey.trim() : "";
      if (!entryKey || key !== entryKey) continue;
    }

    kept.push(event);
  }

  kept.sort((a, b) => {
    if (a.created_at !== b.created_at) return a.created_at - b.created_at;
    return a.id - b.id;
  });

  return kept.slice(0, Math.max(0, cap));
}

export type ActivityListCopy = {
  title: string;
  blurb: string;
};

type ActivityCopyInput = {
  type: string;
  payload?: Record<string, unknown> | null;
};

const PART_ORDER = [
  "sections",
  "meta",
  "seo",
  "redirects",
  "funnel",
  "identity",
  "settings",
  "layout",
  "common_operational",
  "schema",
  "field_editors",
  "examples",
] as const;

const PART_SHORT: Record<string, string> = {
  sections: "sections",
  meta: "meta",
  seo: "SEO",
  redirects: "redirects",
  funnel: "funnel",
  identity: "identity",
  settings: "settings",
  layout: "layout",
  common_operational: "shared settings",
  schema: "schema",
  field_editors: "field editors",
  examples: "examples",
};

const SINGLE_PART_COPY: Record<string, ActivityListCopy> = {
  sections: {
    title: "Updated page sections",
    blurb: "Changed content blocks on this page.",
  },
  meta: {
    title: "Updated page meta",
    blurb: "Changed title, description, or other page metadata.",
  },
  seo: {
    title: "Updated SEO fields",
    blurb: "Changed SEO settings for this page.",
  },
  redirects: {
    title: "Updated redirects",
    blurb: "Changed redirect rules for this page.",
  },
  funnel: {
    title: "Updated funnel settings",
    blurb: "Changed conversion or funnel configuration.",
  },
  identity: {
    title: "Updated identity",
    blurb: "Changed shared identity fields.",
  },
  settings: {
    title: "Updated settings",
    blurb: "Changed shared settings for this entry.",
  },
  layout: {
    title: "Updated layout",
    blurb: "Changed shared layout for this entry.",
  },
  common_operational: {
    title: "Updated shared settings",
    blurb: "Changed operational fields shared across locales.",
  },
  schema: {
    title: "Updated component schema",
    blurb: "Changed a registry schema file.",
  },
  field_editors: {
    title: "Updated field editors",
    blurb: "Changed registry field editor wiring.",
  },
  examples: {
    title: "Updated examples",
    blurb: "Changed registry example content.",
  },
};

const TYPE_FALLBACK: Record<string, ActivityListCopy> = {
  entry_locale_saved: {
    title: "Locale save",
    blurb: "Saved this locale file.",
  },
  entry_common_saved: {
    title: "Shared entry save",
    blurb: "Saved fields shared across locales.",
  },
  entry_seo_changed: {
    title: "SEO fields update",
    blurb: "Changed SEO fields for this entry.",
  },
  entry_redirects_changed: {
    title: "Redirects update",
    blurb: "Changed redirects for this entry.",
  },
  content_file_written: {
    title: "Content file write",
    blurb: "Wrote a content file for this entry.",
  },
};

function joinNatural(labels: string[]): string {
  if (labels.length === 0) return "";
  if (labels.length === 1) return labels[0]!;
  if (labels.length === 2) return `${labels[0]} and ${labels[1]}`;
  return `${labels.slice(0, -1).join(", ")}, and ${labels[labels.length - 1]}`;
}

function normalizeParts(payload: Record<string, unknown> | null | undefined): string[] {
  const raw = payload?.parts;
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of raw) {
    if (typeof item !== "string") continue;
    const key = item.trim();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(key);
  }
  out.sort((a, b) => {
    const ia = PART_ORDER.indexOf(a as (typeof PART_ORDER)[number]);
    const ib = PART_ORDER.indexOf(b as (typeof PART_ORDER)[number]);
    const ra = ia === -1 ? PART_ORDER.length : ia;
    const rb = ib === -1 ? PART_ORDER.length : ib;
    if (ra !== rb) return ra - rb;
    return a.localeCompare(b);
  });
  return out;
}

function applyLayerToBlurb(blurb: string, layer: string | undefined): string {
  if (layer === "variant") {
    return blurb.replace(/\bon this page\b/i, "on a draft of this page").replace(
      /\bfor this page\b/i,
      "for a draft of this page",
    );
  }
  if (layer === "live") {
    return blurb.replace(/\bon this page\b/i, "on this live page");
  }
  return blurb;
}

const LIST_REPORT_MAX = 120;

/** First line of the agent note for list rows; null if empty. */
export function formatActivityListReportSnippet(
  payload: Record<string, unknown> | null | undefined,
  maxLen = LIST_REPORT_MAX,
): string | null {
  const report = getActivityReport(payload);
  if (!report) return null;
  const firstLine = report.split(/\r?\n/).find((line) => line.trim())?.trim() ?? report;
  if (firstLine.length <= maxLen) return firstLine;
  return `${firstLine.slice(0, Math.max(1, maxLen - 1)).trimEnd()}…`;
}

/**
 * Staff-facing list copy: what changed first (not who).
 * Prefer a short Note snippet when present so rows are distinguishable.
 */
export function formatActivityListCopy(event: ActivityCopyInput): ActivityListCopy {
  const parts = normalizeParts(event.payload);
  const layer =
    typeof event.payload?.layer === "string" ? event.payload.layer.trim() : undefined;
  const reportSnippet = formatActivityListReportSnippet(event.payload);

  if (parts.length === 1) {
    const part = parts[0]!;
    const single = SINGLE_PART_COPY[part] ?? {
      title: `Updated ${PART_SHORT[part] ?? part}`,
      blurb: "Changed this part of the entry.",
    };
    return {
      title: single.title,
      blurb: reportSnippet ?? applyLayerToBlurb(single.blurb, layer),
    };
  }

  if (parts.length > 1) {
    const labels = parts.map((p) => PART_SHORT[p] ?? p);
    const named = `Changed ${joinNatural(labels)} on this page.`;
    return {
      title: `Updated ${joinNatural(labels)}`,
      blurb: reportSnippet ?? applyLayerToBlurb(named, layer),
    };
  }

  const fallback = TYPE_FALLBACK[event.type] ?? {
    title: "Entry write",
    blurb: "Saved a change for this entry.",
  };
  return {
    title: fallback.title,
    blurb: reportSnippet ?? applyLayerToBlurb(fallback.blurb, layer),
  };
}

/** Optional agent note for detail view only. */
export function getActivityReport(payload: Record<string, unknown> | null | undefined): string | null {
  const report = payload?.report;
  if (typeof report !== "string") return null;
  const trimmed = report.trim();
  return trimmed.length > 0 ? trimmed : null;
}

/** Plain-English layer label for detail, or null. */
export function getActivityLayerLabel(
  payload: Record<string, unknown> | null | undefined,
): string | null {
  const layer = typeof payload?.layer === "string" ? payload.layer.trim() : "";
  if (layer === "live") return "Live version";
  if (layer === "variant") return "Draft / variant";
  return null;
}

export function formatActivityRelativeTime(ts: number, now = Date.now()): string {
  const diff = now - ts;
  if (diff < 60_000) return "just now";
  const mins = Math.round(diff / 60_000);
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  return `${days}d ago`;
}

export function formatActivityActorLine(
  attribution: EventAttributionEntry[] | undefined | null,
  createdAt: number,
  now = Date.now(),
): string {
  const primary = attribution?.[0];
  const actorLabel = primary ? formatAttributionEntry(primary) : "Unknown";
  return `${actorLabel} · ${formatActivityRelativeTime(createdAt, now)}`;
}
