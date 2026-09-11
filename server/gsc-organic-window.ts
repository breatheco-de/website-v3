/**
 * Shared organic traffic date-window resolution for MCP get_organic_traffic
 * (site / paths / clusters / queries).
 */

import { completeDataDates } from "./gsc-organic-days";

/** Matches ORGANIC_TRAFFIC_WINDOW_DAYS in gsc-organic-path-traffic. */
export const ORGANIC_DEFAULT_WINDOW_DAYS = 28;
export const ORGANIC_MAX_SPAN_DAYS = 90;

/** @deprecated Prefer ORGANIC_MAX_SPAN_DAYS */
export const QUERIES_MAX_SPAN_DAYS = ORGANIC_MAX_SPAN_DAYS;
/** @deprecated Prefer ORGANIC_DEFAULT_WINDOW_DAYS */
export const QUERIES_DEFAULT_WINDOW_DAYS = ORGANIC_DEFAULT_WINDOW_DAYS;

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export function inclusiveDaySpan(start: string, end: string): number {
  const a = Date.parse(`${start}T00:00:00.000Z`);
  const b = Date.parse(`${end}T00:00:00.000Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return NaN;
  return Math.floor((b - a) / 86_400_000) + 1;
}

export type ResolveOrganicWindowResult =
  | { ok: true; start: string; end: string; days_expected: number }
  | { ok: false; message: string };

/**
 * Resolve start/end for organic traffic reads.
 * Both or neither; omit → last 28 complete GSC days; clamp end to latest complete;
 * span > 90 or empty after clamp → hard fail.
 */
export function resolveOrganicWindow(opts: {
  start?: string | null;
  end?: string | null;
  now?: Date;
}): ResolveOrganicWindowResult {
  const startRaw = typeof opts.start === "string" ? opts.start.trim() : "";
  const endRaw = typeof opts.end === "string" ? opts.end.trim() : "";
  const hasStart = Boolean(startRaw);
  const hasEnd = Boolean(endRaw);
  if (hasStart !== hasEnd) {
    return {
      ok: false,
      message:
        "start and end must both be set (YYYY-MM-DD), or both omitted for the default 28-day window.",
    };
  }

  const expected = completeDataDates(
    opts.now ?? new Date(),
    Math.max(ORGANIC_MAX_SPAN_DAYS, ORGANIC_DEFAULT_WINDOW_DAYS),
  );
  const latestComplete = expected[expected.length - 1];
  if (!latestComplete) {
    return { ok: false, message: "Could not resolve a complete GSC data date." };
  }

  if (!hasStart && !hasEnd) {
    const slice = expected.slice(-ORGANIC_DEFAULT_WINDOW_DAYS);
    const start = slice[0]!;
    const end = slice[slice.length - 1]!;
    return { ok: true, start, end, days_expected: ORGANIC_DEFAULT_WINDOW_DAYS };
  }

  if (!DATE_RE.test(startRaw) || !DATE_RE.test(endRaw)) {
    return { ok: false, message: "start and end must be YYYY-MM-DD." };
  }
  if (startRaw > endRaw) {
    return { ok: false, message: "start must be on or before end." };
  }
  const span = inclusiveDaySpan(startRaw, endRaw);
  if (!Number.isFinite(span) || span < 1) {
    return { ok: false, message: "Invalid date range." };
  }
  if (span > ORGANIC_MAX_SPAN_DAYS) {
    return {
      ok: false,
      message:
        `Date range span is ${span} days; max is ${ORGANIC_MAX_SPAN_DAYS}. ` +
        "For longer history use OpenRush get_search_performance or another specialized Search Console / SEO API.",
    };
  }

  let start = startRaw;
  let end = endRaw;
  if (end > latestComplete) end = latestComplete;
  if (start > end) {
    return {
      ok: false,
      message:
        `No complete GSC days in the requested range after clamping to latest complete day (${latestComplete}). ` +
        `Retry with end on or before ${latestComplete}.`,
    };
  }
  return {
    ok: true,
    start,
    end,
    days_expected: inclusiveDaySpan(start, end),
  };
}

/** @deprecated Prefer resolveOrganicWindow */
export const resolveQueriesWindow = resolveOrganicWindow;
