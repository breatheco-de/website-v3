/**
 * Per-component Micro-conversions curation (optional `micro-events.ts` next to field-editors).
 * Declares which existing events the Micro tab / page-stats secondary / A/B micro_actions goal care about.
 * Does not emit events — read-only map for UI and analytics consumers.
 */

export const MICRO_EVENT_NAMES = ["cta_click", "video_start", "video_complete"] as const;
export type MicroEventName = (typeof MICRO_EVENT_NAMES)[number];

export const MICRO_EVENT_SOURCES = ["section-tracking", "universal-video", "track"] as const;
export type MicroEventSource = (typeof MICRO_EVENT_SOURCES)[number];

/** Events that must never appear on the Micro tab (Forms / Ecommerce / page-level / progress). */
export const MICRO_FORBIDDEN_EVENTS = [
  "scroll_depth",
  "page_view",
  "experiment_exposure",
  "video_progress",
  "view_item",
  "view_item_list",
  "select_item",
  "add_to_cart",
  "click_begin_checkout",
  "begin_checkout",
  "purchase",
] as const;

export type MicroEventRow = {
  event: MicroEventName;
  source: MicroEventSource;
  /** Staff-facing short label */
  label?: string;
};

export type MicroEventsMap = Record<string, MicroEventRow[]>;

export function isMicroEventName(v: unknown): v is MicroEventName {
  return typeof v === "string" && (MICRO_EVENT_NAMES as readonly string[]).includes(v);
}

export function isMicroEventSource(v: unknown): v is MicroEventSource {
  return typeof v === "string" && (MICRO_EVENT_SOURCES as readonly string[]).includes(v);
}

export function isForbiddenMicroEvent(v: unknown): boolean {
  return typeof v === "string" && (MICRO_FORBIDDEN_EVENTS as readonly string[]).includes(v);
}

/** Keep only valid Micro rows; drop forbidden / malformed. */
export function sanitizeMicroEventRows(rows: unknown): MicroEventRow[] {
  if (!Array.isArray(rows)) return [];
  const out: MicroEventRow[] = [];
  for (const raw of rows) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) continue;
    const r = raw as Record<string, unknown>;
    if (isForbiddenMicroEvent(r.event)) continue;
    if (!isMicroEventName(r.event) || !isMicroEventSource(r.source)) continue;
    const row: MicroEventRow = { event: r.event, source: r.source };
    if (typeof r.label === "string" && r.label.trim()) row.label = r.label.trim();
    out.push(row);
  }
  return out;
}

/**
 * Resolve rows for a variant: exact variant key, else `"*"`, else empty.
 * Does not merge — variant-specific replaces `*` when present.
 */
export function resolveMicroEventsForVariant(
  map: MicroEventsMap | null | undefined,
  variant?: string,
): MicroEventRow[] {
  if (!map || typeof map !== "object") return [];
  const v = typeof variant === "string" && variant.trim() ? variant.trim() : undefined;
  if (v && Array.isArray(map[v])) return sanitizeMicroEventRows(map[v]);
  if (Array.isArray(map["*"])) return sanitizeMicroEventRows(map["*"]);
  return [];
}

/** Unique event names across resolved rows (for page-level OR counters). */
export function microEventNames(rows: MicroEventRow[]): MicroEventName[] {
  const seen = new Set<MicroEventName>();
  for (const r of rows) seen.add(r.event);
  return [...seen];
}

export type LoadMicroEventsResult =
  | { ok: true; map: MicroEventsMap; rows: MicroEventRow[] }
  | { ok: false; error: string; map: null; rows: [] };

/** Parse a raw exported object; returns error when the file exported something unusable. */
export function parseMicroEventsExport(
  raw: unknown,
  variant?: string,
): LoadMicroEventsResult {
  if (raw == null) {
    return { ok: false, error: "micro-events export is empty", map: null, rows: [] };
  }
  if (typeof raw !== "object" || Array.isArray(raw)) {
    return { ok: false, error: "micro-events export must be an object keyed by variant", map: null, rows: [] };
  }
  const map: MicroEventsMap = {};
  let anyForbiddenOnly = false;
  let anyKey = false;
  for (const [key, rows] of Object.entries(raw as Record<string, unknown>)) {
    anyKey = true;
    if (!Array.isArray(rows)) {
      return { ok: false, error: `micro-events["${key}"] must be an array`, map: null, rows: [] };
    }
    const beforeForbidden = rows.some((r) => r && typeof r === "object" && isForbiddenMicroEvent((r as { event?: unknown }).event));
    const sanitized = sanitizeMicroEventRows(rows);
    if (rows.length > 0 && sanitized.length === 0 && beforeForbidden) anyForbiddenOnly = true;
    // Also fail when every row was malformed (not just forbidden)
    if (rows.length > 0 && sanitized.length === 0 && !beforeForbidden) {
      return {
        ok: false,
        error: `micro-events["${key}"] has no valid Micro rows`,
        map: null,
        rows: [],
      };
    }
    map[key] = sanitized;
  }
  if (!anyKey) {
    return { ok: false, error: "micro-events export has no variant keys", map: null, rows: [] };
  }
  const rows = resolveMicroEventsForVariant(map, variant);
  if (rows.length === 0 && anyForbiddenOnly) {
    return {
      ok: false,
      error: "micro-events only listed Forms/Ecommerce or other forbidden events",
      map: null,
      rows: [],
    };
  }
  return { ok: true, map, rows };
}

export type MicroTabCatalogEntry =
  | { status: "ok"; map: MicroEventsMap }
  | { status: "error"; error: string }
  | { status: "missing" }
  | undefined;

export type MicroTabVideoKind = {
  hasYoutube: boolean;
  hasFileVideo: boolean;
};

export type MicroTabState = {
  microBroken: boolean;
  microRows: MicroEventRow[];
  microActiveRows: MicroEventRow[];
  microVideoRows: MicroEventRow[];
  showYoutubeMicroWarning: boolean;
  showMicroTab: boolean;
};

/**
 * Micro tab visibility for the section editor.
 * Missing map → no tab (unless YouTube warning). Broken map → warning tab.
 * File-video rows only list as active when this instance has an uploaded file.
 */
export function resolveMicroTabState(
  entry: MicroTabCatalogEntry,
  variant: string | undefined,
  videoKind: MicroTabVideoKind,
): MicroTabState {
  const microBroken = entry?.status === "error";
  const microRows: MicroEventRow[] =
    entry?.status === "ok" ? resolveMicroEventsForVariant(entry.map, variant) : [];
  const microVideoRows = microRows.filter(
    (r) => r.event === "video_start" || r.event === "video_complete",
  );
  const microActiveRows = microRows.filter((r) => {
    if (r.event === "video_start" || r.event === "video_complete") return videoKind.hasFileVideo;
    return true;
  });
  const showYoutubeMicroWarning = videoKind.hasYoutube && !videoKind.hasFileVideo;
  const showMicroTab =
    microBroken ||
    showYoutubeMicroWarning ||
    microActiveRows.length > 0 ||
    microVideoRows.length > 0;
  return {
    microBroken,
    microRows,
    microActiveRows,
    microVideoRows,
    showYoutubeMicroWarning,
    showMicroTab,
  };
}
