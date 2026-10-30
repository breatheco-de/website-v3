/**
 * Dev-only: replace local lead-ledger rows and daily consent counters with production's.
 * Never uploads. Local test leads (`is_test = 1`) are kept. The ledger stores no name,
 * email or phone (personal data only goes to the CRM webhook), so the export is safe to copy.
 * Lead delivery comes along as metadata only (status, codes, errors): imported rows are
 * view-only (`pulled_from_production = 1`), never scanned or retried locally.
 */

import {
  fetchProductionAdmin,
  resolveProductionOrigin,
  type ProductionStaffTokenRequiredPayload,
} from "../dev-production-fetch";
import { getSiteSqlite } from "../db";
import { ensurePipelineDb } from "../pipeline-db/runner";
import { listLedgerRows, replaceLedgerFromSnapshot, type LedgerRow } from "./lead-ledger";
import {
  buildLeadOutboxExport,
  replaceLeadOutboxFromSnapshot,
  type LeadAttemptExportRow,
  type LeadOutboxExportRow,
} from "./lead-outbox";
import { listConsentDaily, replaceConsentFromSnapshot, utcDateKey, type ConsentDailyRow } from "./consent-store";
import type { LeadsLocalCopy } from "@shared/leads-query";

export const LEADS_PULL_DEFAULT_DAYS = 90;
const DAY_MS = 86_400_000;
const PULL_STATE_KEY = "leads_pulled_from_production";

/** When leads were last downloaded from production into this (dev) database. */
export function readLeadsPullState(site: string): LeadsLocalCopy {
  const empty: LeadsLocalCopy = { pulled_at: null, since: null, origin: null };
  try {
    ensurePipelineDb(site);
    const row = getSiteSqlite(site).prepare("SELECT value_json FROM pipeline_state WHERE key = ?").get(PULL_STATE_KEY) as
      | { value_json: string }
      | undefined;
    if (!row) return empty;
    const v = JSON.parse(row.value_json) as Partial<{ at: number; since: number; origin: string }>;
    return {
      pulled_at: typeof v.at === "number" ? v.at : null,
      since: typeof v.since === "number" ? v.since : null,
      origin: typeof v.origin === "string" ? v.origin : null,
    };
  } catch {
    return empty;
  }
}

function writeLeadsPullState(site: string, value: { at: number; since: number; origin: string }): void {
  getSiteSqlite(site)
    .prepare(
      `INSERT INTO pipeline_state (key, value_json) VALUES (?, ?)
       ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json`,
    )
    .run(PULL_STATE_KEY, JSON.stringify(value));
}

export type LeadsExportPayload = {
  leads: LedgerRow[];
  consent_daily: ConsentDailyRow[];
  /** Epoch ms; consent rows start at this UTC day. */
  since: number;
  /** Delivery status + attempt metadata. Never the encrypted lead copy or CRM replies. Absent from older production builds. */
  delivery?: { outbox: LeadOutboxExportRow[]; attempts: LeadAttemptExportRow[] };
};

export function defaultLeadsSince(now = Date.now(), days = LEADS_PULL_DEFAULT_DAYS): number {
  return Date.parse(`${utcDateKey(now - (days - 1) * DAY_MS)}T00:00:00.000Z`);
}

/** Production side: ledger rows and consent counters from `sinceMs` onward. */
export function buildLeadsExport(site: string, sinceMs: number): LeadsExportPayload {
  return {
    leads: listLedgerRows(site, sinceMs),
    consent_daily: listConsentDaily(site, utcDateKey(sinceMs)),
    since: sinceMs,
    delivery: buildLeadOutboxExport(site, sinceMs),
  };
}

export function parseLeadsExport(body: unknown): LeadsExportPayload | null {
  if (!body || typeof body !== "object") return null;
  const b = body as Record<string, unknown>;
  if (!Array.isArray(b.leads) || typeof b.since !== "number") return null;
  const delivery = parseDeliveryExport(b.delivery);
  return {
    leads: b.leads.filter(
      (r): r is LedgerRow => !!r && typeof r === "object" && typeof (r as LedgerRow).submission_id === "string" && typeof (r as LedgerRow).created_at === "number",
    ),
    consent_daily: Array.isArray(b.consent_daily)
      ? b.consent_daily.filter((r): r is ConsentDailyRow => !!r && typeof r === "object" && typeof (r as ConsentDailyRow).date === "string")
      : [],
    since: b.since,
    ...(delivery ? { delivery } : {}),
  };
}

function parseDeliveryExport(raw: unknown): LeadsExportPayload["delivery"] | null {
  if (!raw || typeof raw !== "object") return null;
  const d = raw as Record<string, unknown>;
  if (!Array.isArray(d.outbox) || !Array.isArray(d.attempts)) return null;
  return {
    outbox: d.outbox.filter((r): r is LeadOutboxExportRow => !!r && typeof r === "object"),
    attempts: d.attempts.filter((r): r is LeadAttemptExportRow => !!r && typeof r === "object"),
  };
}

export type PullProductionLeadsResult = {
  success: boolean;
  pulled: boolean;
  productionOrigin: string;
  imported_leads: number;
  imported_consent_days: number;
  since: number;
  reason?: string;
  not_supported?: boolean;
} & Partial<ProductionStaffTokenRequiredPayload>;

export async function pullProductionLeads(
  site: string,
  opts: { sinceMs?: number; productionOrigin?: string } = {},
  deps: { fetchAdmin?: typeof fetchProductionAdmin } = {},
): Promise<PullProductionLeadsResult> {
  const since = opts.sinceMs ?? defaultLeadsSince();
  const productionOrigin = opts.productionOrigin?.replace(/\/$/, "") || resolveProductionOrigin(site);
  const fail = (reason: string, extra: Partial<PullProductionLeadsResult> = {}): PullProductionLeadsResult => ({
    success: false,
    pulled: false,
    productionOrigin: productionOrigin ?? "",
    imported_leads: 0,
    imported_consent_days: 0,
    since,
    reason,
    ...extra,
  });

  if (!productionOrigin) {
    return fail("Could not resolve production URL for this site. Set PRODUCTION_SITE_URL or configure the site domain in sites.yml.");
  }

  const url = new URL("/api/ads/leads/export", productionOrigin);
  url.searchParams.set("since", String(since));
  const result = await (deps.fetchAdmin ?? fetchProductionAdmin)(url, { method: "GET" }, productionOrigin);
  if (!result.ok) {
    if (result.kind === "token_required") return fail(result.payload.error, { ...result.payload });
    if (result.kind === "network") return fail(result.error);
    if (result.status === 404) {
      return fail("Production doesn't support lead downloads yet. Deploy this change to production first.", { not_supported: true });
    }
    return fail(`Production returned HTTP ${result.status}${result.body ? `: ${result.body.slice(0, 200)}` : ""}`);
  }

  const snap = parseLeadsExport(await result.response.json().catch(() => null));
  if (!snap) return fail("Production sent a lead export this server could not read.");

  try {
    ensurePipelineDb(site);
    const { imported_leads, imported_consent_days } = getSiteSqlite(site).transaction(() => {
      const counts = {
        imported_leads: replaceLedgerFromSnapshot(site, snap.leads, since),
        imported_consent_days: replaceConsentFromSnapshot(site, snap.consent_daily, utcDateKey(since)),
      };
      if (snap.delivery) replaceLeadOutboxFromSnapshot(site, snap.delivery, since);
      writeLeadsPullState(site, { at: Date.now(), since, origin: productionOrigin });
      return counts;
    })();
    return { success: true, pulled: true, productionOrigin, imported_leads, imported_consent_days, since };
  } catch (err) {
    return fail(`Could not save the lead download (${err instanceof Error ? err.message : String(err)}).`);
  }
}
