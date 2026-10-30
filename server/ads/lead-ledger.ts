/**
 * Server lead ledger (pipeline SQLite `lead_submissions`) + lead webhook enrichment.
 *
 * Every lead submission gets a `submission_id`, test/repeat flags, campaign context
 * (from the HttpOnly `4g_ads` cookie when consent was given, else the request body)
 * and the page version. The ledger row stores NO name / email / phone — personal
 * data only goes to the CRM webhook. Test and repeat leads are still delivered.
 */

import crypto from "crypto";
import type { Request, Response } from "express";
import { getSiteSqlite } from "../db";
import { ensurePipelineDb } from "../pipeline-db/runner";
import { getAdsSettings } from "../settings";
import { getDefaultContentRoot } from "../site-config";
import { getVersioningCookie, getVisitExperimentCookie, hashUserId } from "../versioning/cookie-utils";
import { experimentId as experimentIdFor } from "../versioning/assignment";
import { extractToken } from "../routes/_helpers";
import { resolveOwnedStaffSession } from "../staff-session-resolve";
import { hasTrackingConsentCookie, readAdContext, type AdContext } from "./ad-context";
import { pruneConsentDaily } from "./consent-store";
import { CONSENT_COOKIE_NAME, isGrantedDecision, parseConsentCookie } from "@shared/consent";
import { emailMatchesPattern } from "@shared/ads-settings";
import { LEAD_ID_PATTERN } from "@shared/leads-query";
import {
  adIdFromTag,
  CLICK_ID_PARAMS,
  classifyTraffic,
  normalizeLandingPath,
  PAID_LOOKBACK_DAYS,
  type ClickIdParam,
  type PaidStatus,
} from "@shared/paid-traffic";
import type { PaidLandingRef } from "@shared/session";
import { isTrafficChannel, type TrafficChannel } from "@shared/traffic-channel";
import { resolveVisitorCountry } from "./visitor-country";
import { findCatalogProduct } from "./lead-product";
import { expireLeadCopies, pruneLeadOutbox } from "./lead-outbox";
import { child } from "../logger";

const log = child({ module: "ads/lead-ledger" });

export const REPEAT_WINDOW_MS = 24 * 60 * 60 * 1000;
export const LEDGER_RETENTION_MONTHS = 25;
const PRUNE_EVERY_MS = 24 * 60 * 60 * 1000;
const lastPruneBySite = new Map<string, number>();

export type TestReason = "staff_session" | "email_pattern";
export type ConsentState = "granted" | "denied" | "unset";

export type LedgerRow = {
  submission_id: string;
  created_at: number;
  form: string | null;
  browser_hash: string | null;
  host: string | null;
  locale: string | null;
  utm_source: string | null;
  utm_medium: string | null;
  utm_campaign: string | null;
  utm_content: string | null;
  utm_term: string | null;
  platform: string | null;
  campaign_id: string | null;
  adset_id: string | null;
  ad_id: string | null;
  click_id_type: string | null;
  landing_path: string | null;
  conversion_path: string | null;
  first_paid_host: string | null;
  first_paid_path: string | null;
  first_paid_at: number | null;
  last_paid_host: string | null;
  last_paid_path: string | null;
  last_paid_at: number | null;
  /** Platform + ids of the paid landings (null on rows recorded before migration 30). */
  first_paid_platform?: string | null;
  first_paid_campaign_id?: string | null;
  first_paid_adset_id?: string | null;
  first_paid_ad_id?: string | null;
  last_paid_platform?: string | null;
  last_paid_campaign_id?: string | null;
  last_paid_adset_id?: string | null;
  last_paid_ad_id?: string | null;
  experiment_id: string | null;
  variant: string | null;
  is_test: 0 | 1;
  test_reason: string | null;
  is_repeat: 0 | 1;
  repeat_of: string | null;
  consent_state: ConsentState;
  /** Traffic channel (null on rows recorded before migration 33 or from clients that sent none). */
  channel?: TrafficChannel | null;
  first_channel?: TrafficChannel | null;
  /** Session's latest non-paid channel, kept when the lead itself counts as paid. */
  last_organic_channel?: TrafficChannel | null;
  /** Page the visit that set `channel` landed on. */
  channel_landing_path?: string | null;
  referrer_host?: string | null;
  /** ISO 3166-1 alpha-2 from the request (best-effort). */
  country?: string | null;
  /** classifyTraffic status of the lead's tags; non-null marks rows recorded after migration 33. */
  traffic_status?: PaidStatus | null;
  /** Catalog product the form resolved (paused included); null when unresolved, not in the catalog, or before migration 35. */
  product_id?: string | null;
  product_slug?: string | null;
  /** Page funnel (or form override) products as full slugs, comma-joined; null before migration 41. */
  product?: string | null;
  /** Personas as full ids, comma-joined ("all" / "none" sentinels); null before migration 41. */
  persona?: string | null;
  /** product:persona full-id pairs, comma-joined; the only unambiguous persona → product link. Null before migration 42. */
  product_persona?: string | null;
};

/** True when the lead had a paid landing within the paid lookback before `now`. */
export function paidWithinLookback(lastPaidAt: number | null | undefined, now: number): boolean {
  if (lastPaidAt == null) return false;
  const age = now - lastPaidAt;
  return age >= -60 * 60 * 1000 && age <= PAID_LOOKBACK_DAYS * 86_400_000;
}

/**
 * Channel stored on the lead. Paid (by tags or a paid landing within the lookback) always wins;
 * a session "paid" channel older than the lookback falls back to direct.
 */
export function resolveLeadChannel(opts: {
  sessionChannel: TrafficChannel | null;
  status: PaidStatus;
  paidByLookback: boolean;
}): { channel: TrafficChannel | null; last_organic_channel: TrafficChannel | null } {
  const { sessionChannel, status, paidByLookback } = opts;
  const organic = sessionChannel && sessionChannel !== "paid" && sessionChannel !== "meta_unclear" ? sessionChannel : null;
  if (!sessionChannel) return { channel: null, last_organic_channel: null };
  if (status === "paid" || paidByLookback) return { channel: "paid", last_organic_channel: organic };
  if (status === "unclear") return { channel: "meta_unclear", last_organic_channel: organic };
  if (sessionChannel === "paid") return { channel: "direct", last_organic_channel: null };
  return { channel: sessionChannel, last_organic_channel: organic };
}

const HOST_RE = /^[a-z0-9.-]{1,120}$/;

function str(v: unknown, max = 300): string | null {
  return typeof v === "string" && v.trim() ? v.trim().slice(0, max) : null;
}

function num(v: unknown): number | null {
  const n = typeof v === "number" ? v : typeof v === "string" && v.trim() ? Number(v) : NaN;
  return Number.isFinite(n) ? n : null;
}

function pathOf(urlOrPath: string | null): string | null {
  if (!urlOrPath) return null;
  try {
    return normalizeLandingPath(new URL(urlOrPath, "https://x.invalid").pathname);
  } catch {
    return null;
  }
}

function landingFromBody(body: Record<string, unknown>, prefix: "first" | "last"): PaidLandingRef | undefined {
  const host = str(body[`${prefix}_paid_landing_host`], 120);
  const path = str(body[`${prefix}_paid_landing_path`]);
  const at = num(body[`${prefix}_paid_landing_at`]);
  if (!host || !path || at == null) return undefined;
  const ref: PaidLandingRef = { host: host.toLowerCase(), path: normalizeLandingPath(path), at };
  const platform = str(body[`${prefix}_paid_landing_platform`], 20);
  if (platform) ref.platform = platform;
  for (const k of ["campaign_id", "adset_id", "ad_id"] as const) {
    const id = adIdFromTag(str(body[`${prefix}_paid_landing_${k}`], 30));
    if (id) ref[k] = id;
  }
  return ref;
}

function consentStateFrom(req: Request): ConsentState {
  const parsed = parseConsentCookie(req.cookies?.[CONSENT_COOKIE_NAME]);
  if (!parsed) return "unset";
  return isGrantedDecision(parsed.decision) ? "granted" : "denied";
}

/**
 * Page test credited for this lead: the first test seen this visit (form body, else the
 * `4g_visit_exp` cookie). Accepted only when it matches an assignment in the versioning cookie.
 */
export function resolvePageVersion(
  req: Request,
  body: Record<string, unknown>,
): { experiment_id: string; variant: string } | null {
  const experimentId = str(body.page_experiment_id, 300) ?? getVisitExperimentCookie(req)?.experiment_id;
  if (!experimentId) return null;
  const cookie = getVersioningCookie(req);
  const match = cookie?.assignments?.find(
    (a) => experimentIdFor(a.contentType, a.slug, a.locale, a.run) === experimentId,
  );
  return match ? { experiment_id: experimentId, variant: match.variantSlug } : null;
}

async function staffSessionUsername(req: Request): Promise<string | null> {
  const token = extractToken(req);
  if (!token) return null;
  try {
    return (await resolveOwnedStaffSession(token))?.username ?? null;
  } catch {
    return null;
  }
}

export type PreparedLead = {
  /** Scalars merged onto the webhook payload (always includes is_test / is_staff / is_repeat). */
  wire: Record<string, string | number | boolean>;
  row: LedgerRow;
};

export async function prepareLead(req: Request, res: Response, body: Record<string, unknown>): Promise<PreparedLead> {
  const now = Date.now();
  const contentRoot = (res.locals.site as { contentRoot?: string } | undefined)?.contentRoot ?? getDefaultContentRoot();
  const site = (res.locals.site as { contentRootName?: string } | undefined)?.contentRootName ?? null;

  const consentState = consentStateFrom(req);
  const cookieCtx: AdContext | null = hasTrackingConsentCookie(req) ? readAdContext(req) : null;
  const pick = (key: string): string | null =>
    str((cookieCtx?.utm as Record<string, unknown> | undefined)?.[key]) ?? str(body[key]);

  const submissionId = (() => {
    const raw = str(body.submission_id, 64);
    return raw && LEAD_ID_PATTERN.test(raw) ? raw : crypto.randomUUID();
  })();

  const clickIds: Partial<Record<ClickIdParam, string>> = {};
  for (const c of CLICK_ID_PARAMS) {
    const v = pick(c);
    if (v) clickIds[c] = v;
  }
  const utm = {
    utm_source: pick("utm_source"),
    utm_medium: pick("utm_medium"),
    utm_campaign: pick("utm_campaign"),
    utm_content: pick("utm_content"),
    utm_term: pick("utm_term"),
    utm_id: pick("utm_id"),
  };
  const cls = classifyTraffic({ utm_source: utm.utm_source, utm_medium: utm.utm_medium, click_ids: clickIds });

  const firstPaid = cookieCtx?.first_paid ?? landingFromBody(body, "first");
  const lastPaid = cookieCtx?.last_paid ?? landingFromBody(body, "last");

  const email = str(body.email, 320);
  const settings = getAdsSettings(contentRoot);
  let testReason: TestReason | null = null;
  if (await staffSessionUsername(req)) testReason = "staff_session";
  else if (email && settings.test_email_patterns.some((p) => emailMatchesPattern(email, p))) testReason = "email_pattern";

  const browserId =
    (req.cookies?.["4g_user_id"] as string | undefined) ||
    (req.cookies?.["4g_visitor_id"] as string | undefined) ||
    (typeof req.headers["x-user-id"] === "string" ? req.headers["x-user-id"] : "");
  const browserHash = browserId ? hashUserId(browserId) : null;
  const form = str(body.conversion_name, 120);

  let repeatOf: string | null = null;
  if (site && browserHash) {
    try {
      ensurePipelineDb(site);
      const prior = getSiteSqlite(site)
        .prepare(
          `SELECT submission_id FROM lead_submissions
           WHERE browser_hash = ? AND IFNULL(form, '') = IFNULL(?, '') AND created_at >= ? AND is_repeat = 0
           ORDER BY created_at ASC LIMIT 1`,
        )
        .get(browserHash, form, now - REPEAT_WINDOW_MS) as { submission_id: string } | undefined;
      repeatOf = prior?.submission_id ?? null;
    } catch (err) {
      log.warn({ err }, "[lead-ledger] repeat lookup failed");
    }
  }

  const version = resolvePageVersion(req, body);
  const landingUrl = str(body.landing_url, 1000);
  const conversionUrl = str(body.conversion_url, 1000);
  const firstClick = CLICK_ID_PARAMS.find((c) => clickIds[c]) ?? null;
  const idPlatform = cls.platform === "meta" || cls.platform === "google";

  const sessionChannel = isTrafficChannel(body.channel) ? body.channel : null;
  const paidByLookback = paidWithinLookback(lastPaid?.at, now);
  const { channel, last_organic_channel } = resolveLeadChannel({
    sessionChannel,
    status: cls.status,
    paidByLookback,
  });
  const channelPath = str(body.channel_landing_path);
  const referrer = str(body.referrer_host, 120)?.toLowerCase() ?? null;
  let country: string | null = null;
  try {
    country = await resolveVisitorCountry(req);
  } catch {
    country = null;
  }
  const product = findCatalogProduct({
    contentRoot,
    productId: str(body.ledger_product_id, 120),
    productSlug: str(body.ledger_product_slug, 120),
  });

  const row: LedgerRow = {
    submission_id: submissionId,
    created_at: now,
    form,
    browser_hash: browserHash,
    host: str(req.hostname, 120),
    locale: str(body.language, 10),
    utm_source: utm.utm_source,
    utm_medium: utm.utm_medium,
    utm_campaign: utm.utm_campaign,
    utm_content: utm.utm_content,
    utm_term: utm.utm_term,
    platform: cls.status === "organic" ? null : cls.platform,
    // Numeric ids from the Meta URL template or the Google final URL suffix (same slots).
    campaign_id: idPlatform ? adIdFromTag(utm.utm_id) : null,
    adset_id: idPlatform ? adIdFromTag(utm.utm_term) : null,
    ad_id: idPlatform ? adIdFromTag(utm.utm_content) : null,
    click_id_type: firstClick,
    landing_path: pathOf(landingUrl),
    conversion_path: pathOf(conversionUrl),
    first_paid_host: firstPaid?.host ?? null,
    first_paid_path: firstPaid?.path ?? null,
    first_paid_at: firstPaid?.at ?? null,
    last_paid_host: lastPaid?.host ?? null,
    last_paid_path: lastPaid?.path ?? null,
    last_paid_at: lastPaid?.at ?? null,
    first_paid_platform: firstPaid?.platform ?? null,
    first_paid_campaign_id: firstPaid?.campaign_id ?? null,
    first_paid_adset_id: firstPaid?.adset_id ?? null,
    first_paid_ad_id: firstPaid?.ad_id ?? null,
    last_paid_platform: lastPaid?.platform ?? null,
    last_paid_campaign_id: lastPaid?.campaign_id ?? null,
    last_paid_adset_id: lastPaid?.adset_id ?? null,
    last_paid_ad_id: lastPaid?.ad_id ?? null,
    experiment_id: version?.experiment_id ?? null,
    variant: version?.variant ?? null,
    is_test: testReason ? 1 : 0,
    test_reason: testReason,
    is_repeat: repeatOf ? 1 : 0,
    repeat_of: repeatOf,
    consent_state: consentState,
    channel,
    first_channel: isTrafficChannel(body.first_channel) ? body.first_channel : null,
    last_organic_channel,
    channel_landing_path:
      channel === "paid" && lastPaid ? lastPaid.path : channelPath ? normalizeLandingPath(channelPath).slice(0, 300) : null,
    referrer_host: referrer && HOST_RE.test(referrer) ? referrer : null,
    country,
    traffic_status: cls.status,
    product_id: product?.product_id ?? null,
    product_slug: product?.product_slug ?? null,
    product: str(body.product, 1000),
    persona: str(body.persona, 1000),
    product_persona: str(body.product_persona, 1000),
  };

  const wire: Record<string, string | number | boolean> = {
    submission_id: submissionId,
    is_test: !!testReason,
    is_staff: testReason === "staff_session",
    is_repeat: !!repeatOf,
    consent_state: consentState,
  };
  if (testReason) wire.test_reason = testReason;
  if (repeatOf) wire.repeat_of_submission_id = repeatOf;
  for (const [k, v] of Object.entries(utm)) if (v) wire[k] = v;
  for (const [k, v] of Object.entries(clickIds)) if (v) wire[k] = v;
  const fbp = pick("fbp");
  const fbc = pick("fbc");
  if (fbp) wire.fbp = fbp;
  if (fbc) wire.fbc = fbc;
  const firstTouch = cookieCtx?.first_touch;
  for (const key of ["utm_source", "utm_medium", "utm_campaign", "utm_content", "utm_term"] as const) {
    const v = str((firstTouch as Record<string, unknown> | undefined)?.[key]) ?? str(body[`first_${key}`]);
    if (v) wire[`first_${key}`] = v;
  }
  if (landingUrl) wire.landing_url = landingUrl;
  if (conversionUrl) wire.conversion_url = conversionUrl;
  if (firstPaid) {
    wire.first_paid_landing_url = `https://${firstPaid.host}${firstPaid.path}`;
    wire.first_paid_landing_at = new Date(firstPaid.at).toISOString();
  }
  if (lastPaid) {
    wire.last_paid_landing_url = `https://${lastPaid.host}${lastPaid.path}`;
    wire.last_paid_landing_at = new Date(lastPaid.at).toISOString();
  }
  if (cls.status !== "organic" && cls.platform) wire.ad_platform = cls.platform;
  if (version) {
    wire.experiment_id = version.experiment_id;
    wire.variant = version.variant;
  }

  return { wire, row };
}

/** Body keys the lead form sends only for the ledger/enrichment (never forwarded raw). */
export const LEDGER_ONLY_BODY_KEYS = new Set([
  "first_paid_landing_host",
  "first_paid_landing_path",
  "first_paid_landing_at",
  "last_paid_landing_host",
  "last_paid_landing_path",
  "last_paid_landing_at",
  ...(["first", "last"] as const).flatMap((p) =>
    ["platform", "campaign_id", "adset_id", "ad_id"].map((k) => `${p}_paid_landing_${k}`),
  ),
  "page_experiment_id",
  // Only the server-verified page test may reach the CRM under these names.
  "experiment_id",
  "variant",
  "channel",
  "first_channel",
  "channel_landing_path",
  "referrer_host",
  "ledger_product_id",
  "ledger_product_slug",
]);

/** Incoming body + enrichment, ready for buildLeadPayload. Enrichment wins over raw body keys. */
export function enrichLeadBody(body: Record<string, unknown>, wire: PreparedLead["wire"]): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(body)) {
    if (!LEDGER_ONLY_BODY_KEYS.has(k)) out[k] = v;
  }
  return { ...out, ...wire };
}

export function insertLedgerRow(site: string, row: LedgerRow): void {
  ensurePipelineDb(site);
  const cols = Object.keys(row) as (keyof LedgerRow)[];
  getSiteSqlite(site)
    .prepare(
      `INSERT OR IGNORE INTO lead_submissions (${cols.join(", ")}) VALUES (${cols.map(() => "?").join(", ")})`,
    )
    .run(...cols.map((c) => row[c]));
  maybePruneLedger(site);
}

export function pruneLedger(site: string, now: number = Date.now()): number {
  ensurePipelineDb(site);
  const cutoff = new Date(now);
  cutoff.setUTCMonth(cutoff.getUTCMonth() - LEDGER_RETENTION_MONTHS);
  const info = getSiteSqlite(site).prepare("DELETE FROM lead_submissions WHERE created_at < ?").run(cutoff.getTime());
  try {
    expireLeadCopies(site, now);
    pruneLeadOutbox(site, cutoff.getTime());
  } catch (err) {
    log.warn({ err }, "[lead-ledger] outbox prune failed");
  }
  return Number(info.changes ?? 0);
}

function maybePruneLedger(site: string): void {
  const last = lastPruneBySite.get(site) ?? 0;
  if (Date.now() - last < PRUNE_EVERY_MS) return;
  lastPruneBySite.set(site, Date.now());
  try {
    const removed = pruneLedger(site);
    pruneConsentDaily(site);
    if (removed > 0) log.info(`[lead-ledger] pruned ${removed} rows older than ${LEDGER_RETENTION_MONTHS} months site=${site}`);
  } catch (err) {
    log.warn({ err }, "[lead-ledger] prune failed");
  }
}

/** Ledger facts the lead outbox copies onto its row (no personal data). */
export type RecordedLeadMeta = {
  submission_id: string;
  browser_hash: string | null;
  form: string | null;
  is_test: boolean;
};

/**
 * Enrich a lead body and record the ledger row before webhook delivery.
 * Ledger failures never block the lead. `lead` is null when enrichment failed.
 */
export async function recordLeadSubmissionWithMeta(
  req: Request,
  res: Response,
  body: Record<string, unknown>,
): Promise<{ body: Record<string, unknown>; lead: RecordedLeadMeta | null }> {
  try {
    const prepared = await prepareLead(req, res, body);
    const site = (res.locals.site as { contentRootName?: string } | undefined)?.contentRootName;
    if (site) {
      try {
        insertLedgerRow(site, prepared.row);
      } catch (err) {
        log.warn({ err }, "[lead-ledger] insert failed");
      }
    }
    return {
      body: enrichLeadBody(body, prepared.wire),
      lead: {
        submission_id: prepared.row.submission_id,
        browser_hash: prepared.row.browser_hash,
        form: prepared.row.form,
        is_test: prepared.row.is_test === 1,
      },
    };
  } catch (err) {
    log.warn({ err }, "[lead-ledger] enrichment failed; delivering raw lead");
    return { body: enrichLeadBody(body, {}), lead: null };
  }
}

export async function recordLeadSubmission(
  req: Request,
  res: Response,
  body: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  return (await recordLeadSubmissionWithMeta(req, res, body)).body;
}

export type LedgerQueryRow = LedgerRow;

export function listLedgerRows(site: string, sinceMs: number): LedgerQueryRow[] {
  ensurePipelineDb(site);
  return getSiteSqlite(site)
    .prepare("SELECT * FROM lead_submissions WHERE created_at >= ? ORDER BY created_at ASC")
    .all(sinceMs) as LedgerQueryRow[];
}

const LEDGER_COLUMNS: (keyof LedgerRow)[] = [
  "submission_id", "created_at", "form", "browser_hash", "host", "locale",
  "utm_source", "utm_medium", "utm_campaign", "utm_content", "utm_term",
  "platform", "campaign_id", "adset_id", "ad_id", "click_id_type",
  "landing_path", "conversion_path",
  "first_paid_host", "first_paid_path", "first_paid_at",
  "last_paid_host", "last_paid_path", "last_paid_at",
  "first_paid_platform", "first_paid_campaign_id", "first_paid_adset_id", "first_paid_ad_id",
  "last_paid_platform", "last_paid_campaign_id", "last_paid_adset_id", "last_paid_ad_id",
  "experiment_id", "variant", "is_test", "test_reason", "is_repeat", "repeat_of", "consent_state",
  "channel", "first_channel", "last_organic_channel", "channel_landing_path", "referrer_host", "country", "traffic_status",
  "product_id", "product_slug", "product", "persona", "product_persona",
];

/**
 * Replace real (non-test) rows from `sinceMs` onward with `rows`, in one transaction.
 * Local test rows (`is_test = 1`) are kept; only whitelisted columns are written.
 */
export function replaceLedgerFromSnapshot(site: string, rows: LedgerRow[], sinceMs: number): number {
  ensurePipelineDb(site);
  const db = getSiteSqlite(site);
  const del = db.prepare("DELETE FROM lead_submissions WHERE created_at >= ? AND is_test = 0");
  const ins = db.prepare(
    `INSERT OR REPLACE INTO lead_submissions (${LEDGER_COLUMNS.join(", ")}) VALUES (${LEDGER_COLUMNS.map(() => "?").join(", ")})`,
  );
  let written = 0;
  db.transaction(() => {
    del.run(sinceMs);
    for (const row of rows) {
      if (typeof row.submission_id !== "string" || typeof row.created_at !== "number" || row.created_at < sinceMs) continue;
      ins.run(...LEDGER_COLUMNS.map((c) => row[c] ?? null));
      written++;
    }
  })();
  return written;
}

export function ledgerCollectingSince(site: string): number | null {
  ensurePipelineDb(site);
  const row = getSiteSqlite(site).prepare("SELECT MIN(created_at) AS first FROM lead_submissions").get() as
    | { first: number | null }
    | undefined;
  return row?.first ?? null;
}

/** Newest non-test submission (ms), or null when the ledger never recorded a real lead. */
export function ledgerLastRecordedAt(site: string): number | null {
  ensurePipelineDb(site);
  const row = getSiteSqlite(site).prepare("SELECT MAX(created_at) AS last FROM lead_submissions WHERE is_test = 0").get() as
    | { last: number | null }
    | undefined;
  return row?.last ?? null;
}
