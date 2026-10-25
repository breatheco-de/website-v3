/**
 * Leads page (/private/store/leads) contract: query params, filters, range math and response shapes.
 * Shared by the server routes (GET /api/ads/leads, /api/ads/leads/stats) and the client URL state.
 * Days are UTC so counts match the Ads overview's site leads.
 */

import { z } from "zod";
import { TRAFFIC_CHANNELS } from "./traffic-channel";

export const LEADS_PAGE_SIZE = 20;
export const LEADS_DAY_MS = 86_400_000;
/** Token for "no value" in filters (e.g. untagged source, unknown page). */
export const LEADS_NONE = "(none)";
/** Breakdown lists keep this many rows before rolling the rest into "Other". */
export const LEADS_BREAKDOWN_TOP = 10;
/** Ranges longer than this are charted by week instead of by day. */
export const LEADS_DAILY_MAX_DAYS = 120;

export const LEADS_RANGES = ["7d", "30d", "90d", "all"] as const;
export type LeadsRange = (typeof LEADS_RANGES)[number];
export const LEADS_RANGE_LABELS: Record<LeadsRange, string> = {
  "7d": "7 days",
  "30d": "30 days",
  "90d": "90 days",
  all: "All",
};
const RANGE_DAYS: Record<Exclude<LeadsRange, "all">, number> = { "7d": 7, "30d": 30, "90d": 90 };

export const LEADS_TTL_BUCKETS = ["under_1d", "1_3d", "4_7d", "8_30d", "31d_plus"] as const;
export type LeadsTtlBucket = (typeof LEADS_TTL_BUCKETS)[number];
export const LEADS_TTL_LABELS: Record<LeadsTtlBucket, string> = {
  under_1d: "Under 1 day",
  "1_3d": "1-3 days",
  "4_7d": "4-7 days",
  "8_30d": "8-30 days",
  "31d_plus": "31+ days",
};
/** [min, max) in days; max null = open-ended. under_1d also takes negative gaps (clock skew). */
export const LEADS_TTL_BOUNDS: Record<LeadsTtlBucket, [number | null, number | null]> = {
  under_1d: [null, 1],
  "1_3d": [1, 4],
  "4_7d": [4, 8],
  "8_30d": [8, 31],
  "31d_plus": [31, null],
};

export type LeadsFilters = {
  /** Lowercased, trimmed utm_source, or LEADS_NONE. */
  source?: string;
  /** Lowercased, trimmed utm_medium, or LEADS_NONE. */
  medium?: string;
  /** Exact path, or LEADS_NONE. */
  conversion_path?: string;
  landing_path?: string;
  experiment?: string;
  variant?: string;
  ttl?: LeadsTtlBucket;
  /** Traffic channel (`TRAFFIC_CHANNELS`), or LEADS_NONE for leads recorded without one. */
  channel?: string;
  /** Catalog product_id or product page slug (matches either), or LEADS_NONE. */
  product?: string;
  /**
   * One product in the page funnel list (`lead_submissions.product`, full slug as stored), the
   * `all` / `none` sentinel, or LEADS_NONE (not recorded). Distinct from `product`.
   */
  funnel_product?: string;
  /**
   * One persona as `product:persona` (full ids), `:persona` when its product is unknown,
   * the `all` / `none` sentinel, or LEADS_NONE (not recorded).
   */
  funnel_persona?: string;
};

export const LEADS_FILTER_KEYS = [
  "source",
  "medium",
  "conversion_path",
  "landing_path",
  "experiment",
  "variant",
  "ttl",
  "channel",
  "product",
  "funnel_product",
  "funnel_persona",
] as const;
export type LeadsFilterKey = (typeof LEADS_FILTER_KEYS)[number];

export type LeadsQuery = {
  range: LeadsRange;
  include_test: boolean;
  page: number;
  filters: LeadsFilters;
};

const filterValue = z.string().trim().min(1).max(300);
const boolParam = z
  .union([z.literal("1"), z.literal("0"), z.literal("true"), z.literal("false")])
  .transform((v) => v === "1" || v === "true");

export const leadsQuerySchema = z.object({
  range: z.enum(LEADS_RANGES).default("30d"),
  include_test: boolParam.default("0"),
  page: z.coerce.number().int().min(1).max(100_000).default(1),
  source: filterValue.optional(),
  medium: filterValue.optional(),
  conversion_path: filterValue.optional(),
  landing_path: filterValue.optional(),
  experiment: filterValue.optional(),
  variant: filterValue.optional(),
  ttl: z.enum(LEADS_TTL_BUCKETS).optional(),
  channel: z.union([z.enum(TRAFFIC_CHANNELS), z.literal(LEADS_NONE)]).optional(),
  product: filterValue.optional(),
  funnel_product: filterValue.optional(),
  funnel_persona: filterValue.optional(),
});

function firstValue(v: unknown): unknown {
  return Array.isArray(v) ? v[0] : v;
}

/** Parse Express `req.query` or URLSearchParams entries. Empty strings count as absent. */
export function parseLeadsQuery(
  raw: Record<string, unknown> | URLSearchParams,
): { ok: true; query: LeadsQuery } | { ok: false; error: string } {
  const entries: Record<string, unknown> = {};
  const source = raw instanceof URLSearchParams ? Object.fromEntries(raw.entries()) : raw;
  for (const [k, v] of Object.entries(source)) {
    const val = firstValue(v);
    if (val === undefined || val === null || val === "") continue;
    entries[k] = val;
  }
  const parsed = leadsQuerySchema.safeParse(entries);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return { ok: false, error: `Invalid ${issue?.path.join(".") || "query"}: ${issue?.message ?? "bad value"}` };
  }
  const { range, include_test, page, ...rest } = parsed.data;
  const filters: LeadsFilters = {};
  for (const key of LEADS_FILTER_KEYS) {
    const v = rest[key];
    if (v !== undefined) (filters as Record<string, string>)[key] = key === "source" || key === "medium" ? normalizeUtmKey(v) : v;
  }
  return { ok: true, query: { range, include_test, page, filters } };
}

/** Client URL / API query string. Defaults are omitted to keep URLs short. */
export function leadsQueryToSearchParams(q: Partial<LeadsQuery>): URLSearchParams {
  const p = new URLSearchParams();
  if (q.range && q.range !== "30d") p.set("range", q.range);
  if (q.include_test) p.set("include_test", "1");
  if (q.page && q.page > 1) p.set("page", String(q.page));
  for (const key of LEADS_FILTER_KEYS) {
    const v = q.filters?.[key];
    if (v) p.set(key, v);
  }
  return p;
}

export function hasLeadsFilters(filters: LeadsFilters): boolean {
  return LEADS_FILTER_KEYS.some((k) => !!filters[k]);
}

/**
 * Grouping key for utm_source / utm_medium: trimmed, ASCII-lowercased, LEADS_NONE when empty.
 * ASCII only so it matches SQLite LOWER(TRIM(x)) used by the filters.
 */
export function normalizeUtmKey(v: string | null | undefined): string {
  if (v === LEADS_NONE) return LEADS_NONE;
  const s = (v ?? "").trim().replace(/[A-Z]/g, (c) => c.toLowerCase());
  return s || LEADS_NONE;
}

export function utcDayKey(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

export function utcDayStart(ms: number): number {
  return Date.parse(`${utcDayKey(ms)}T00:00:00.000Z`);
}

export type LeadsRangeBounds = {
  /** Inclusive start (UTC midnight). For "all": the first recorded lead's day, or today when none. */
  startMs: number;
  /** Exclusive end = now. */
  endMs: number;
  /** Calendar days covered (start day through today). */
  days: number;
  /** Previous period of equal length; null for "all". */
  previous: { startMs: number; endMs: number } | null;
};

/** Rolling windows end now and start at UTC midnight of the first day (same as manage-list date filters). */
export function leadsRangeBounds(range: LeadsRange, nowMs: number, collectingSince: number | null): LeadsRangeBounds {
  const today = utcDayStart(nowMs);
  if (range === "all") {
    const startMs = collectingSince != null ? Math.min(utcDayStart(collectingSince), today) : today;
    return { startMs, endMs: nowMs, days: Math.round((today - startMs) / LEADS_DAY_MS) + 1, previous: null };
  }
  const days = RANGE_DAYS[range];
  const startMs = today - (days - 1) * LEADS_DAY_MS;
  return { startMs, endMs: nowMs, days, previous: { startMs: startMs - days * LEADS_DAY_MS, endMs: startMs } };
}

/** Change % vs the previous period; null when there is no previous period or recording started after it began. */
export function leadsDeltaPct(
  current: number,
  previous: number | null,
  previousStartMs: number | null,
  collectingSince: number | null,
): number | null {
  if (previous == null || previousStartMs == null || collectingSince == null) return null;
  if (collectingSince > previousStartMs) return null;
  if (previous === 0) return null;
  return Math.round(((current - previous) / previous) * 1000) / 10;
}

export function ttlBucketFor(gapMs: number): LeadsTtlBucket {
  const days = gapMs / LEADS_DAY_MS;
  for (const b of LEADS_TTL_BUCKETS) {
    const [min, max] = LEADS_TTL_BOUNDS[b];
    if ((min == null || days >= min) && (max == null || days < max)) return b;
  }
  return "31d_plus";
}

// ── Responses ──────────────────────────────────────────────────────────────

/** Table row. Never includes browser_hash. */
export type LeadsListRow = {
  submission_id: string;
  created_at: number;
  form: string | null;
  host: string | null;
  locale: string | null;
  utm_source: string | null;
  utm_medium: string | null;
  utm_campaign: string | null;
  utm_content: string | null;
  utm_term: string | null;
  platform: string | null;
  landing_path: string | null;
  conversion_path: string | null;
  experiment_id: string | null;
  variant: string | null;
  is_test: 0 | 1;
  test_reason: string | null;
  is_repeat: 0 | 1;
  /** Traffic channel; null for leads recorded before channel tracking. */
  channel: string | null;
  /** Latest non-paid channel when the lead itself counts as paid. */
  last_organic_channel: string | null;
};

/** submission_id format accepted by the ledger and the detail route. */
export const LEAD_ID_PATTERN = /^[A-Za-z0-9-]{8,64}$/;

/** Full ledger row for the lead details dialog. Never includes browser_hash. */
export type LeadDetail = LeadsListRow & {
  campaign_id: string | null;
  adset_id: string | null;
  ad_id: string | null;
  click_id_type: string | null;
  first_paid_host: string | null;
  first_paid_path: string | null;
  first_paid_at: number | null;
  last_paid_host: string | null;
  last_paid_path: string | null;
  last_paid_at: number | null;
  first_paid_platform: string | null;
  first_paid_campaign_id: string | null;
  first_paid_adset_id: string | null;
  first_paid_ad_id: string | null;
  last_paid_platform: string | null;
  last_paid_campaign_id: string | null;
  last_paid_adset_id: string | null;
  last_paid_ad_id: string | null;
  repeat_of: string | null;
  consent_state: string;
  first_channel: string | null;
  channel_landing_path: string | null;
  referrer_host: string | null;
  country: string | null;
  traffic_status: string | null;
  /** Catalog product the form resolved; null when unresolved or recorded before product tracking. */
  product_id: string | null;
  product_slug: string | null;
};

export type LeadsListResponse = {
  total: number;
  page: number;
  page_size: number;
  total_pages: number;
  rows: LeadsListRow[];
};

/** One source or medium value, as sent, that breaks the UTM convention. */
export type LeadsOffConventionValue = {
  param: "utm_source" | "utm_medium";
  value: string;
  /** What the convention wants instead (e.g. "fb, ig, msg or an"); null when no single value fits. */
  expected: string | null;
  /** Platform whose tagging rules apply to these leads; null for other or unknown platforms. */
  platform: "meta" | "google" | null;
  /** utm_* issue codes this value raised (same codes as Ads diagnostics). */
  codes: string[];
  leads: number;
};

export type LeadsBreakdownRow = {
  /** Stable key for React lists. */
  key: string;
  label: string;
  count: number;
  /** Share of leads in the current view (0-100, one decimal). */
  pct: number;
  /** Filters applied when the row is clicked; null for the "Other" rollup. */
  filter: LeadsFilters | null;
  /** Source/medium only: tags in this group that break the site's UTM convention (empty = none). */
  off_convention?: LeadsOffConventionValue[];
  /** Pages only: most common lead language for this path. */
  locale?: string | null;
};

export type LeadsTimelinePoint = {
  /** UTC day (YYYY-MM-DD); for weekly buckets, the Monday that starts the week. */
  date: string;
  paid: number;
  /** Only a Facebook click id, no ad tags: can't tell ad from shared post. */
  meta_unclear: number;
  organic_search: number;
  /** ChatGPT, Perplexity, Claude, Gemini and other LLM assistants. */
  ai_assistant: number;
  /** Tracked, not paid, not organic search, not AI (social, email, referral, direct, other tagged). */
  other_organic: number;
  /** Not paid and recorded without a channel (before tracking started). */
  not_tracked: number;
};

export const LEADS_TIMELINE_SERIES = [
  "paid",
  "meta_unclear",
  "organic_search",
  "ai_assistant",
  "other_organic",
  "not_tracked",
] as const;
export type LeadsTimelineSeries = (typeof LEADS_TIMELINE_SERIES)[number];

export type LeadsLocalCopy = {
  /** Epoch ms of the last "Download from production" for leads; null = never. */
  pulled_at: number | null;
  /** Epoch ms the downloaded snapshot starts at. */
  since: number | null;
  origin: string | null;
};

export type LeadsStatsResponse = {
  range: LeadsRange;
  start_ms: number;
  end_ms: number;
  /** First recorded lead (any kind), or null when the ledger is empty. */
  collecting_since: number | null;
  kpis: {
    /** Full retention (25 months); ignores range and filters, honors include_test. */
    total_all_time: number;
    in_range: number;
    previous: number | null;
    delta_pct: number | null;
    paid: number;
    paid_share: number | null;
    tagged: number;
    tagged_share: number | null;
    /** Leads in view with a channel (recorded after channel tracking started). */
    tracked: number;
    organic_search: number;
    /** organic_search / tracked; null when nothing in view is tracked. */
    organic_share: number | null;
    /** Leads in view from visitors without tracking consent (denied or no choice). */
    no_consent: number;
    meta_unclear: number;
  };
  /** First non-test lead with a channel; null until channel tracking records one. */
  tracking_since: number | null;
  /** First non-test lead with a product; null until one is recorded. */
  product_since: number | null;
  /** Catalog name for the active product filter (falls back to the filter value). */
  product_name?: string;
  /** First non-test lead with a page funnel product list; null until one is recorded. */
  funnel_since: number | null;
  /** Leads in view (before pairs were stored) whose persona id several products share: shown as "product unknown". */
  funnel_persona_product_unknown: number;
  /** Readable names for the active funnel_product / funnel_persona filters. */
  funnel_filter_labels?: { funnel_product?: string; funnel_persona?: string };
  timeline: { bucket: "day" | "week"; points: LeadsTimelinePoint[] };
  breakdowns: {
    source_medium: LeadsBreakdownRow[];
    channels: LeadsBreakdownRow[];
    conversion_paths: LeadsBreakdownRow[];
    landing_paths: LeadsBreakdownRow[];
    experiments: LeadsBreakdownRow[];
    /** Page funnel products; a lead counts once per product, so shares can add up past 100%. */
    funnel_products: LeadsBreakdownRow[];
    /** Page funnel personas (product:persona); a lead counts once per persona. */
    funnel_personas: LeadsBreakdownRow[];
    time_to_lead: {
      /** Paid leads in view with a first paid landing time. */
      paid_with_click: number;
      median_days: number | null;
      buckets: LeadsBreakdownRow[];
    };
  };
  /** Present only off production (dev local copy banner). */
  local_copy?: LeadsLocalCopy;
};

export function sharePct(part: number, whole: number): number | null {
  if (whole <= 0) return null;
  return Math.round((part / whole) * 1000) / 10;
}
