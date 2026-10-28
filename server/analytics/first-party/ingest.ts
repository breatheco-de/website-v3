/**
 * Ingest for the site's own anonymous visit counts (ads-first pages). Two message kinds per
 * page view share a random per-view key: an arrival sent on page open (the visit always
 * counts) and a summary sent on leave / background (latest summary wins). Rows are buffered
 * in memory and written to data/<site>/visits.db every 30 s and on shutdown.
 * No cookie, IP or visitor ID is read or stored.
 */

import { z } from "zod";
import type Database from "better-sqlite3";
import { pageStatsChannel, type PageStatsChannel } from "@shared/page-visit-channel";
import { CLICK_ID_PARAMS } from "@shared/paid-traffic";
import { normalizeAnalyticsPath } from "../../ecommerce/journey-analytics";
import { getVisitsDb } from "./visits-db";
import { child } from "../../logger";

const log = child({ module: "first-party/ingest" });

const FLUSH_INTERVAL_MS = 30_000;
const PRUNE_INTERVAL_MS = 24 * 60 * 60 * 1000;
const PRUNE_FIRST_DELAY_MS = 5 * 60 * 1000;
export const RAW_RETENTION_DAYS = 90;
const PRUNE_BATCH = 5000;
const PRUNE_PAUSE_MS = 50;
/** Visible time below this with no interaction = suspected low-quality visit. */
export const LOW_QUALITY_MS = 1000;
export const ENGAGED_MS = 10_000;

const str = (max: number) => z.string().max(max).nullish();
const count = z.number().int().min(0).max(10_000).optional();
const flag = z.union([z.literal(0), z.literal(1)]).optional();

/** Page message. Keys stay short and neutral on purpose (tracker blocklists match words, not shapes). */
export const pageMessageSchema = z.object({
  /** a = arrival, s = summary */
  m: z.enum(["a", "s"]),
  id: z.string().min(8).max(64),
  u: z.string().min(1).max(512),
  /** n = navigate, r = reload, b = back/forward, s = in-app route change */
  nt: z.enum(["n", "r", "b", "s"]).optional(),
  ver: str(160),
  /** Previous path on our site (tab journey, or our own referrer on a full load). */
  pp: str(512),
  /** External referrer host (landing view only). */
  rh: str(255),
  /** Fresh document load whose previous page was ours (tab chain broke). */
  cb: flag,
  /** Landing campaign tags: s=source m=medium c=campaign i=id t=term n=content. */
  q: z
    .object({ s: str(200), m: str(200), c: str(200), i: str(200), t: str(200), n: str(200) })
    .partial()
    .nullish(),
  ck: str(20),
  /** Page was visible at arrival. */
  vis: flag,
  ms: z.number().int().min(0).max(86_400_000).optional(),
  sc: z.number().int().min(0).max(100).optional(),
  i: flag,
  c: count,
  tc: count,
  f: count,
  vs: count,
  vc: count,
  nx: str(512),
  tk: z.string().max(80),
});
export type PageMessage = z.infer<typeof pageMessageSchema>;

/** Journey credit: earlier flagged page views of the tab reached a decision page (d) or a lead (l). */
export const linkMessageSchema = z.object({
  r: z.enum(["d", "l"]),
  ids: z.array(z.string().min(8).max(64)).min(1).max(30),
  u: str(512),
  tk: z.string().max(80),
});
export type LinkMessage = z.infer<typeof linkMessageSchema>;

export type NavType = "navigate" | "reload" | "back_forward" | "spa";
const NAV: Record<string, NavType> = { n: "navigate", r: "reload", b: "back_forward", s: "spa" };

export type PageViewRow = {
  view_key: string;
  arrived_at: number;
  day: string;
  nav_type: NavType;
  counted_visit: 0 | 1;
  summary_received: 0 | 1;
  low_quality: 0 | 1;
  never_visible: 0 | 1;
  path: string;
  content_type: string | null;
  page_version: string | null;
  entrance: 0 | 1;
  channel: PageStatsChannel | "internal";
  source: string | null;
  medium: string | null;
  campaign: string | null;
  utm_id: string | null;
  utm_term: string | null;
  utm_content: string | null;
  click_id_type: string | null;
  referrer_host: string | null;
  device: string | null;
  country: string | null;
  engaged: 0 | 1;
  seconds: number;
  max_scroll: number;
  interacted: 0 | 1;
  cta_clicks: number;
  task_clicks: number;
  form_starts: number;
  video_starts: number;
  video_completes: number;
  prev_path: string | null;
  next_path: string | null;
};

function clean(v: string | null | undefined): string | null {
  const s = (v ?? "").trim();
  return s ? s : null;
}

function cleanPath(v: string | null | undefined): string | null {
  const p = normalizeAnalyticsPath(v ?? "");
  return p || null;
}

export function deviceFromUserAgent(ua: string | undefined): "mobile" | "tablet" | "desktop" {
  const s = ua ?? "";
  if (/iPad|Tablet|PlayBook|Silk|Kindle|Android(?!.*Mobile)/i.test(s)) return "tablet";
  if (/Mobi|iPhone|iPod|Android|Opera Mini|IEMobile/i.test(s)) return "mobile";
  return "desktop";
}

export function minuteFloor(ms: number): number {
  return Math.floor(ms / 60_000) * 60_000;
}

export function utcDay(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

/** Build the stored row for one message (arrival or summary). */
export function rowFromMessage(
  msg: PageMessage,
  ctx: { now: number; contentType: string | null; device: string | null; country: string | null },
): PageViewRow {
  const arrived = minuteFloor(ctx.now);
  const nav = NAV[msg.nt ?? "n"] ?? "navigate";
  const counted = nav === "reload" || nav === "back_forward" ? 0 : 1;
  const prev = cleanPath(msg.pp);
  const entrance = counted === 1 && nav === "navigate" && !prev ? 1 : 0;
  const q = msg.q ?? {};
  const clickId = clean(msg.ck);
  const clickIdType = clickId && (CLICK_ID_PARAMS as string[]).includes(clickId) ? clickId : null;
  const source = clean(q.s)?.toLowerCase() ?? null;
  const medium = clean(q.m)?.toLowerCase() ?? null;
  const referrerHost = clean(msg.rh)?.toLowerCase() ?? null;
  const hasLanding = !!(source || medium || clickIdType || referrerHost);
  const channel: PageViewRow["channel"] =
    hasLanding || entrance
      ? pageStatsChannel({ medium, source, campaign: clean(q.c), clickIdType, referrerHost })
      : prev
        ? "internal"
        : "direct";

  const isSummary = msg.m === "s";
  const ms = isSummary ? (msg.ms ?? 0) : 0;
  const scroll = isSummary ? (msg.sc ?? 0) : 0;
  const cta = isSummary ? (msg.c ?? 0) : 0;
  const forms = isSummary ? (msg.f ?? 0) : 0;
  const interacted = isSummary && (msg.i === 1 || scroll > 0 || cta > 0) ? 1 : 0;
  const next = isSummary ? cleanPath(msg.nx) : null;
  const engaged = isSummary && (ms > ENGAGED_MS || cta > 0 || forms > 0 || !!next) ? 1 : 0;
  const lowQuality = isSummary && ms < LOW_QUALITY_MS && !interacted ? 1 : 0;

  return {
    view_key: msg.id,
    arrived_at: arrived,
    day: utcDay(arrived),
    nav_type: nav,
    counted_visit: counted as 0 | 1,
    summary_received: isSummary ? 1 : 0,
    low_quality: lowQuality as 0 | 1,
    never_visible: isSummary ? (ms > 0 ? 0 : 1) : msg.vis === 0 ? 1 : 0,
    path: cleanPath(msg.u) ?? "/",
    content_type: ctx.contentType,
    page_version: clean(msg.ver),
    entrance: entrance as 0 | 1,
    channel,
    source,
    medium,
    campaign: clean(q.c),
    utm_id: clean(q.i),
    utm_term: clean(q.t),
    utm_content: clean(q.n),
    click_id_type: clickIdType,
    referrer_host: referrerHost,
    device: ctx.device,
    country: ctx.country,
    engaged: engaged as 0 | 1,
    seconds: Math.round(ms / 1000),
    max_scroll: scroll,
    interacted: interacted as 0 | 1,
    cta_clicks: cta,
    task_clicks: isSummary ? (msg.tc ?? 0) : 0,
    form_starts: forms,
    video_starts: isSummary ? (msg.vs ?? 0) : 0,
    video_completes: isSummary ? (msg.vc ?? 0) : 0,
    prev_path: prev,
    next_path: next,
  };
}

// ── Buffer ──────────────────────────────────────────────────────────────────

type SiteBuffer = {
  /** Latest row per view key; a summary replaces an arrival and earlier summaries. */
  views: Map<string, PageViewRow>;
  transitions: Map<string, number>;
  credits: Array<{ kind: "reached_decision" | "lead"; ids: string[] }>;
};

const buffers = new Map<string, SiteBuffer>();

function bufferFor(site: string): SiteBuffer {
  let b = buffers.get(site);
  if (!b) {
    b = { views: new Map(), transitions: new Map(), credits: [] };
    buffers.set(site, b);
  }
  return b;
}

export function bufferPageView(site: string, row: PageViewRow): void {
  const b = bufferFor(site);
  const prev = b.views.get(row.view_key);
  if (prev && prev.summary_received && !row.summary_received) return;
  const country = row.country ?? prev?.country ?? null;
  if (prev && row.summary_received && !prev.summary_received) {
    // Keep arrival-time facts (arrival minute, landing tags) when the summary follows.
    b.views.set(row.view_key, { ...row, country, arrived_at: prev.arrived_at, day: prev.day });
    return;
  }
  b.views.set(row.view_key, { ...row, country });
  ensureTimers();
}

/** Fill a page view's country once a background lookup finishes (still buffered, or already written). */
export function setPageViewCountry(site: string, viewKey: string, country: string): void {
  const row = buffers.get(site)?.views.get(viewKey);
  if (row) {
    if (!row.country) row.country = country;
    return;
  }
  getVisitsDb(site)
    ?.prepare("UPDATE fp_page_views SET country = ? WHERE view_key = ? AND country IS NULL")
    .run(country, viewKey);
}

export function bufferTransition(site: string, day: string, from: string, to: string): void {
  const key = `${day}\u0001${from}\u0001${to}`;
  const b = bufferFor(site);
  b.transitions.set(key, (b.transitions.get(key) ?? 0) + 1);
  ensureTimers();
}

export function bufferCredit(site: string, kind: "reached_decision" | "lead", ids: string[]): void {
  bufferFor(site).credits.push({ kind, ids });
  ensureTimers();
}

const VIEW_COLUMNS: Array<keyof PageViewRow> = [
  "view_key", "arrived_at", "day", "nav_type", "counted_visit", "summary_received", "low_quality", "never_visible",
  "path", "content_type", "page_version", "entrance", "channel", "source", "medium", "campaign", "utm_id", "utm_term",
  "utm_content", "click_id_type", "referrer_host", "device", "country", "engaged", "seconds", "max_scroll", "interacted",
  "cta_clicks", "task_clicks", "form_starts", "video_starts", "video_completes", "prev_path", "next_path",
];

const SUMMARY_COLUMNS: Array<keyof PageViewRow> = [
  "summary_received", "low_quality", "never_visible", "engaged", "seconds", "max_scroll", "interacted", "cta_clicks",
  "task_clicks", "form_starts", "video_starts", "video_completes", "next_path",
];

/** Write one site's buffered rows in a single transaction. Returns rows written. */
export function writeBuffered(db: Database.Database, b: SiteBuffer): number {
  const placeholders = VIEW_COLUMNS.map(() => "?").join(", ");
  const insertArrival = db.prepare(
    `INSERT OR IGNORE INTO fp_page_views (${VIEW_COLUMNS.join(", ")}) VALUES (${placeholders})`,
  );
  const upsertSummary = db.prepare(
    `INSERT INTO fp_page_views (${VIEW_COLUMNS.join(", ")}) VALUES (${placeholders})
     ON CONFLICT(view_key) DO UPDATE SET ${SUMMARY_COLUMNS.map((c) => `${c} = excluded.${c}`).join(", ")}`,
  );
  const addTransition = db.prepare(
    `INSERT INTO fp_transitions (day, from_path, to_path, count) VALUES (?, ?, ?, ?)
     ON CONFLICT(day, from_path, to_path) DO UPDATE SET count = count + excluded.count`,
  );
  const addCredit = db.prepare(
    `INSERT INTO fp_path_credits (day, path, kind, count) VALUES (?, ?, ?, 1)
     ON CONFLICT(day, path, kind) DO UPDATE SET count = count + 1`,
  );
  let written = 0;
  db.transaction(() => {
    for (const row of Array.from(b.views.values())) {
      const values = VIEW_COLUMNS.map((c) => row[c]);
      (row.summary_received ? upsertSummary : insertArrival).run(...values);
      written++;
    }
    for (const [key, n] of Array.from(b.transitions.entries())) {
      const [day, from, to] = key.split("\u0001");
      addTransition.run(day, from, to, n);
    }
    for (const credit of b.credits) {
      const col = credit.kind === "lead" ? "lead_later" : "reached_decision";
      const mark = db.prepare(`UPDATE fp_page_views SET ${col} = 1 WHERE view_key = ? AND ${col} = 0 RETURNING day, path`);
      for (const id of credit.ids) {
        const hit = mark.get(id) as { day: string; path: string } | undefined;
        if (hit) addCredit.run(hit.day, hit.path, credit.kind);
      }
    }
  })();
  return written;
}

export function flushSite(site: string): number {
  const b = buffers.get(site);
  if (!b || (b.views.size === 0 && b.transitions.size === 0 && b.credits.length === 0)) return 0;
  buffers.delete(site);
  const db = getVisitsDb(site, { create: true });
  if (!db) return 0;
  return writeBuffered(db, b);
}

export function flushAllVisits(): void {
  for (const site of [...buffers.keys()]) {
    try {
      flushSite(site);
    } catch (err) {
      log.warn({ err, site }, "[visits] flush failed");
    }
  }
}

/** Tests: drop buffered rows without writing. */
export function resetVisitBuffersForTests(): void {
  buffers.clear();
}

// ── Rollups + prune ─────────────────────────────────────────────────────────

/** Recompute fp_daily for the given days from raw rows (kept after raw rows are pruned). */
export function refreshDailyRollups(db: Database.Database, days: string[]): void {
  if (days.length === 0) return;
  const del = db.prepare("DELETE FROM fp_daily WHERE day = ?");
  const ins = db.prepare(`
    INSERT INTO fp_daily (day, path, channel, device, sessions, engaged)
    SELECT day, path, channel, COALESCE(device, 'unknown'),
      SUM(counted_visit),
      SUM(CASE WHEN counted_visit = 1 AND engaged = 1 AND low_quality = 0 THEN 1 ELSE 0 END)
    FROM fp_page_views WHERE day = ? GROUP BY day, path, channel, COALESCE(device, 'unknown')`);
  db.transaction(() => {
    for (const day of days) {
      del.run(day);
      ins.run(day);
    }
  })();
}

function addDaysIso(day: string, n: number): string {
  const d = new Date(`${day}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/**
 * Refresh rollups for recent days and for days about to drop out, then delete raw rows
 * older than the retention window in small batches (never holds the write lock long).
 */
export async function pruneVisits(db: Database.Database, now = Date.now(), pauseMs = PRUNE_PAUSE_MS): Promise<number> {
  const today = utcDay(now);
  const cutoff = addDaysIso(today, -RAW_RETENTION_DAYS);
  const expiring = (db.prepare("SELECT DISTINCT day FROM fp_page_views WHERE day < ?").all(cutoff) as Array<{ day: string }>).map(
    (r) => r.day,
  );
  refreshDailyRollups(db, [...expiring, addDaysIso(today, -1), today]);
  const del = db.prepare(
    `DELETE FROM fp_page_views WHERE rowid IN (SELECT rowid FROM fp_page_views WHERE day < ? LIMIT ${PRUNE_BATCH})`,
  );
  let removed = 0;
  for (;;) {
    const n = del.run(cutoff).changes;
    removed += n;
    if (n < PRUNE_BATCH) break;
    if (pauseMs > 0) await new Promise((r) => setTimeout(r, pauseMs));
  }
  db.prepare("DELETE FROM fp_transitions WHERE day < ?").run(cutoff);
  return removed;
}

// ── Timers ──────────────────────────────────────────────────────────────────

let flushTimer: ReturnType<typeof setInterval> | null = null;
let pruneTimer: ReturnType<typeof setTimeout> | null = null;
const knownSites = new Set<string>();

function ensureTimers(): void {
  for (const site of buffers.keys()) knownSites.add(site);
  if (process.env.VITEST) return;
  if (!flushTimer) {
    flushTimer = setInterval(flushAllVisits, FLUSH_INTERVAL_MS);
    flushTimer.unref?.();
  }
  if (!pruneTimer) {
    const run = () => {
      for (const site of knownSites) {
        const db = getVisitsDb(site);
        if (!db) continue;
        void pruneVisits(db).catch((err) => log.warn({ err, site }, "[visits] prune failed"));
      }
      pruneTimer = setTimeout(run, PRUNE_INTERVAL_MS);
      pruneTimer.unref?.();
    };
    pruneTimer = setTimeout(run, PRUNE_FIRST_DELAY_MS);
    pruneTimer.unref?.();
  }
}
