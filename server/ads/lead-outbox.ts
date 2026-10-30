/**
 * Lead outbox (pipeline SQLite `lead_outbox` + `lead_delivery_attempts`).
 *
 * Every lead is saved (encrypted) before the CRM webhook call, and every HTTP attempt is
 * recorded with its status code, error kind and the CRM reply (capped, encrypted). Outages
 * (timeout, network, 5xx, 429) are retried on a backoff; CRM rejections (4xx) and config
 * problems go to `needs_attention` for staff. Personal data lives only in `payload_enc` /
 * `response_body_enc` and is wiped after delivery, supersede, or 30 days.
 *
 * Automatic work (the 30 s scan, retries, the `lead_delivery_failed` event) runs only on the
 * live server. Elsewhere attempt 1 and manual Retry still work.
 */

import { getSiteSqlite } from "../db";
import { ensurePipelineDb } from "../pipeline-db/runner";
import { isLiveServer } from "../live-server";
import { getTrackingSettings } from "../settings";
import { emitEvent } from "../events/event-store";
import { systemJobAttribution } from "../events/types";
import { child } from "../logger";
import { isPrivateDestination } from "@shared/ssrf";
import { sanitizeWebhookHeaders } from "@shared/webhookHeaders";
import type {
  LeadDeliveryAttemptView,
  LeadDeliveryErrorKind,
  LeadDeliveryStatus,
  LeadDeliveryView,
  LeadWebhookSource,
} from "@shared/leads-query";
import {
  decryptLeadOutbox,
  encryptLeadOutbox,
  LeadOutboxDecryptError,
  leadOutboxKey,
  leadOutboxKeyStatus,
} from "./lead-outbox-crypto";

const log = child({ module: "ads/lead-outbox" });

/** Delay after attempt 1, 2, 3, 4, 5 (attempt 6 is the last). */
export const LEAD_RETRY_DELAYS_MS = [60_000, 5 * 60_000, 30 * 60_000, 2 * 3_600_000, 12 * 3_600_000] as const;
export const LEAD_MAX_ATTEMPTS = LEAD_RETRY_DELAYS_MS.length + 1;
export const LEAD_MAX_RETRY_AFTER_MS = 12 * 3_600_000;
export const LEAD_PAYLOAD_TTL_MS = 30 * 86_400_000;
export const LEAD_SUPERSEDE_WINDOW_MS = 24 * 3_600_000;
export const LEAD_OUTBOX_SCAN_INTERVAL_MS = 30_000;
export const LEAD_OUTBOX_SCAN_BATCH = 5;
export const LEAD_OUTBOX_LEASE_MS = 2 * 60_000;
export const LEAD_RESPONSE_BODY_MAX = 4096;
export const LEAD_WEBHOOK_TIMEOUT_MS = 8_000;
const RESPONSE_HEADER_ALLOWLIST = ["retry-after", "x-request-id", "content-type"] as const;
/** Bulk progress stays on the Leads page this long after the batch drains. */
const BULK_PROGRESS_TTL_MS = 10 * 60_000;
const FAILED_STATUSES = ["needs_attention", "gave_up"] as const;

export type LeadWebhookTarget = {
  url: string;
  method: "GET" | "POST";
  headers: Record<string, string>;
  failSilently: boolean;
  source: LeadWebhookSource;
};

/** Encrypted JSON in `payload_enc`. `target` is saved only for form webhooks (may hold visitor tokens). */
export type SavedLeadCopy = {
  v: 1;
  payload: Record<string, unknown>;
  /** conversion_name used to pick the settings webhook (event → global → env). */
  routing_conversion_name: string | null;
  target: { url: string; method: "GET" | "POST"; headers: Record<string, string> } | null;
};

export type LeadDeliveryResult = {
  ok: boolean;
  status: number | null;
  durationMs: number;
  errorKind: LeadDeliveryErrorKind | null;
  errorMessage: string | null;
  responseBody: string | null;
  responseHeaders: Record<string, string>;
  retryAfterMs: number | null;
};

/** delivered | retry (outage) | rejected_data (400/422: visitor can fix) | rejected_config (staff must fix). */
export type LeadDeliveryOutcome = "delivered" | "retry" | "rejected_data" | "rejected_config";

export type LeadAttemptTrigger = "submit" | "retry" | "manual";

export type OutboxRow = {
  submission_id: string;
  status: LeadDeliveryStatus;
  payload_enc: string | null;
  webhook_source: LeadWebhookSource | null;
  url_host: string;
  method: string;
  attempts: number;
  cycle_attempts: number;
  next_attempt_at: number | null;
  lease_until: number | null;
  last_http_status: number | null;
  last_error_kind: LeadDeliveryErrorKind | null;
  last_error_message: string | null;
  browser_hash: string | null;
  form: string | null;
  is_test: 0 | 1;
  pulled_from_production: 0 | 1;
  alerted_at: number | null;
  requeued_at: number | null;
  created_at: number;
  updated_at: number;
  delivered_at: number | null;
  payload_wiped_at: number | null;
};

type AttemptRow = {
  id: number;
  submission_id: string;
  attempt: number;
  started_at: number;
  duration_ms: number | null;
  url_host: string | null;
  http_status: number | null;
  error_kind: LeadDeliveryErrorKind | null;
  error_message: string | null;
  response_body_enc: string | null;
  response_headers_json: string | null;
  trigger: LeadAttemptTrigger;
};

function db(site: string) {
  ensurePipelineDb(site);
  return getSiteSqlite(site);
}

export function urlHostOf(url: string): string {
  try {
    return new URL(url).host.toLowerCase();
  } catch {
    return "";
  }
}

// ── HTTP delivery ───────────────────────────────────────────────────────────

/** Seconds or an HTTP date; null when absent or unparseable. */
export function parseRetryAfter(value: string | null | undefined, now: number = Date.now()): number | null {
  if (!value) return null;
  const v = value.trim();
  if (/^\d+$/.test(v)) return Number(v) * 1000;
  const at = Date.parse(v);
  if (!Number.isFinite(at)) return null;
  return Math.max(0, at - now);
}

function withIdempotencyKey(headers: Record<string, string>, key: string | null | undefined): Record<string, string> {
  if (!key) return headers;
  if (Object.keys(headers).some((h) => h.toLowerCase() === "idempotency-key")) return headers;
  return { ...headers, "Idempotency-Key": key };
}

function transportErrorKind(err: unknown): LeadDeliveryErrorKind {
  if (err instanceof Error && (err.name === "AbortError" || err.name === "TimeoutError" || /aborted/i.test(err.message))) {
    return "timeout";
  }
  const cause = (err as { cause?: { code?: unknown; name?: unknown } } | null)?.cause;
  const code = typeof cause?.code === "string" ? cause.code : typeof (err as { code?: unknown })?.code === "string" ? String((err as { code: string }).code) : "";
  if (code === "UND_ERR_CONNECT_TIMEOUT" || code === "UND_ERR_HEADERS_TIMEOUT" || code === "UND_ERR_BODY_TIMEOUT" || code === "ETIMEDOUT") {
    return "timeout";
  }
  if (code === "ENOTFOUND" || code === "EAI_AGAIN") return "dns";
  if (code === "ECONNREFUSED") return "connection_refused";
  if (/CERT|TLS|SSL|SELF_SIGNED|UNABLE_TO_VERIFY/i.test(code)) return "tls";
  return "network";
}

function errorText(err: unknown): string {
  const base = err instanceof Error ? err.message : String(err);
  const cause = (err as { cause?: unknown } | null)?.cause;
  const causeText = cause instanceof Error ? cause.message : typeof cause === "string" ? cause : "";
  return (causeText && !base.includes(causeText) ? `${base}: ${causeText}` : base).slice(0, 500);
}

/** One HTTP call to the CRM webhook. Never throws. */
export async function deliverLeadWebhook(opts: {
  url: string;
  method: "GET" | "POST";
  headers: Record<string, string>;
  payload: Record<string, unknown>;
  idempotencyKey?: string | null;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
}): Promise<LeadDeliveryResult> {
  const started = Date.now();
  const empty = { responseBody: null, responseHeaders: {}, retryAfterMs: null };
  if (isPrivateDestination(opts.url)) {
    return {
      ok: false,
      status: null,
      durationMs: 0,
      errorKind: "blocked_private_url",
      errorMessage: "Webhook destination is not allowed (private or internal address)",
      ...empty,
    };
  }
  const headers = withIdempotencyKey(sanitizeWebhookHeaders(opts.headers), opts.idempotencyKey);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? LEAD_WEBHOOK_TIMEOUT_MS);
  try {
    let fetchUrl = opts.url;
    const init: RequestInit = { method: opts.method, signal: controller.signal };
    if (opts.method === "POST") {
      init.headers = { "Content-Type": "application/json", ...headers };
      init.body = JSON.stringify(opts.payload);
    } else {
      init.headers = { ...headers };
      const params = new URLSearchParams();
      for (const [key, value] of Object.entries(opts.payload)) {
        if (value !== undefined && value !== null) params.set(key, String(value));
      }
      fetchUrl = `${opts.url}${opts.url.includes("?") ? "&" : "?"}${params.toString()}`;
    }
    const response = await (opts.fetchImpl ?? fetch)(fetchUrl, init);
    const text = await response.text().catch(() => "");
    const responseHeaders: Record<string, string> = {};
    for (const name of RESPONSE_HEADER_ALLOWLIST) {
      const v = response.headers.get(name);
      if (v) responseHeaders[name] = v.slice(0, 200);
    }
    const result = {
      status: response.status,
      durationMs: Date.now() - started,
      responseBody: text ? text.slice(0, LEAD_RESPONSE_BODY_MAX) : null,
      responseHeaders,
      retryAfterMs: parseRetryAfter(response.headers.get("retry-after")),
    };
    if (!response.ok) {
      return { ok: false, errorKind: "non_2xx", errorMessage: `HTTP ${response.status}`, ...result };
    }
    return { ok: true, errorKind: null, errorMessage: null, ...result };
  } catch (err) {
    return {
      ok: false,
      status: null,
      durationMs: Date.now() - started,
      errorKind: transportErrorKind(err),
      errorMessage: errorText(err),
      ...empty,
    };
  } finally {
    clearTimeout(timer);
  }
}

export function classifyLeadDelivery(r: Pick<LeadDeliveryResult, "ok" | "status" | "errorKind">): LeadDeliveryOutcome {
  if (r.ok) return "delivered";
  switch (r.errorKind) {
    case "timeout":
    case "dns":
    case "connection_refused":
    case "tls":
    case "network":
      return "retry";
    case "non_2xx": {
      const s = r.status ?? 0;
      if (s >= 500 || s === 429) return "retry";
      if (s === 400 || s === 422) return "rejected_data";
      return "rejected_config";
    }
    default:
      return "rejected_config";
  }
}

/** Delay before the next automatic attempt after `cycleAttempts` attempts in this cycle. */
export function nextRetryDelayMs(cycleAttempts: number, retryAfterMs: number | null): number {
  const idx = Math.min(Math.max(cycleAttempts, 1), LEAD_RETRY_DELAYS_MS.length) - 1;
  const base = LEAD_RETRY_DELAYS_MS[idx];
  if (retryAfterMs == null) return base;
  return Math.max(base, Math.min(retryAfterMs, LEAD_MAX_RETRY_AFTER_MS));
}

// ── Webhook target ──────────────────────────────────────────────────────────

/** Settings webhook for a lead: conversion event → global → DEFAULT_WEBHOOK_URL. Null when none is configured. */
export function resolveSettingsLeadWebhook(
  contentRoot: string | undefined,
  conversionName: unknown,
): LeadWebhookTarget | null {
  const tracking = getTrackingSettings(contentRoot);
  const eventWebhook =
    typeof conversionName === "string" && conversionName
      ? tracking.conversion_events?.find((e) => e?.name === conversionName)?.webhook
      : undefined;
  if (eventWebhook?.url) {
    return {
      url: eventWebhook.url,
      method: eventWebhook.method === "GET" ? "GET" : "POST",
      headers: sanitizeWebhookHeaders(eventWebhook.headers),
      failSilently: eventWebhook.fail_silently === true,
      source: "event",
    };
  }
  const globalWebhook = tracking.webhook;
  if (globalWebhook?.url) {
    return {
      url: globalWebhook.url,
      method: globalWebhook.method === "GET" ? "GET" : "POST",
      headers: sanitizeWebhookHeaders(globalWebhook.headers),
      failSilently: globalWebhook.fail_silently === true,
      source: "global",
    };
  }
  const envUrl = process.env.DEFAULT_WEBHOOK_URL;
  if (envUrl) {
    return {
      url: envUrl,
      method: process.env.DEFAULT_WEBHOOK_METHOD === "GET" ? "GET" : "POST",
      headers: {},
      failSilently: false,
      source: "env",
    };
  }
  return null;
}

type ResolvedTarget = { ok: true; target: LeadWebhookTarget; copy: SavedLeadCopy } | { ok: false; result: LeadDeliveryResult };

function failedResult(errorKind: LeadDeliveryErrorKind, errorMessage: string): LeadDeliveryResult {
  return { ok: false, status: null, durationMs: 0, errorKind, errorMessage, responseBody: null, responseHeaders: {}, retryAfterMs: null };
}

/** Decrypt the saved copy and pick where it goes: current settings, or the saved form target. */
export function resolveRetryTarget(row: Pick<OutboxRow, "payload_enc" | "webhook_source">, contentRoot: string | undefined): ResolvedTarget {
  if (!row.payload_enc) return { ok: false, result: failedResult("config_missing", "The saved copy of this lead was erased") };
  let copy: SavedLeadCopy;
  try {
    copy = JSON.parse(decryptLeadOutbox(row.payload_enc)) as SavedLeadCopy;
  } catch (err) {
    const message = err instanceof LeadOutboxDecryptError ? err.message : "Saved copy unreadable (encryption key changed)";
    return { ok: false, result: failedResult("decrypt_failed", message) };
  }
  if (row.webhook_source === "form") {
    if (!copy.target?.url) return { ok: false, result: failedResult("config_missing", "The saved form webhook has no address") };
    return {
      ok: true,
      copy,
      target: { ...copy.target, headers: copy.target.headers ?? {}, failSilently: false, source: "form" },
    };
  }
  const target = resolveSettingsLeadWebhook(contentRoot, copy.routing_conversion_name);
  if (!target) {
    return { ok: false, result: failedResult("config_missing", "No lead webhook is configured in settings anymore") };
  }
  return { ok: true, copy, target };
}

// ── Store ───────────────────────────────────────────────────────────────────

export function getOutboxRow(site: string, submissionId: string): OutboxRow | null {
  return (db(site).prepare("SELECT * FROM lead_outbox WHERE submission_id = ?").get(submissionId) as OutboxRow | undefined) ?? null;
}

/**
 * Save the lead before attempt 1. Leased so the scan leaves it alone while the request
 * delivers it. Returns false when the key is missing or the id was already saved.
 */
export function createLeadOutboxEntry(
  site: string,
  input: {
    submissionId: string;
    copy: SavedLeadCopy;
    target: LeadWebhookTarget;
    browserHash: string | null;
    form: string | null;
    isTest: boolean;
    now?: number;
  },
): boolean {
  const enc = encryptLeadOutbox(JSON.stringify(input.copy));
  if (!enc) return false;
  const now = input.now ?? Date.now();
  const info = db(site)
    .prepare(
      `INSERT OR IGNORE INTO lead_outbox (
         submission_id, status, payload_enc, webhook_source, url_host, method, attempts, cycle_attempts,
         next_attempt_at, lease_until, browser_hash, form, is_test, created_at, updated_at
       ) VALUES (?, 'retrying', ?, ?, ?, ?, 0, 0, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      input.submissionId,
      enc,
      input.target.source,
      urlHostOf(input.target.url),
      input.target.method,
      now + LEAD_RETRY_DELAYS_MS[0],
      now + LEAD_OUTBOX_LEASE_MS,
      input.browserHash,
      input.form,
      input.isTest ? 1 : 0,
      now,
      now,
    );
  return info.changes === 1;
}

/** Payload-less row so the Leads page can say "Not sent: no webhook configured". */
export function recordLeadNotSent(
  site: string,
  input: { submissionId: string; browserHash: string | null; form: string | null; isTest: boolean; now?: number },
): void {
  const now = input.now ?? Date.now();
  db(site)
    .prepare(
      `INSERT OR IGNORE INTO lead_outbox (
         submission_id, status, browser_hash, form, is_test, last_error_kind, last_error_message, created_at, updated_at
       ) VALUES (?, 'not_sent_no_webhook', ?, ?, ?, 'config_missing', 'No lead webhook is configured', ?, ?)`,
    )
    .run(input.submissionId, input.browserHash, input.form, input.isTest ? 1 : 0, now, now);
}

function wipeSql(now: number): { set: string; params: number[] } {
  return { set: "payload_enc = NULL, payload_wiped_at = ?", params: [now] };
}

/**
 * Record one attempt and move the row to its next state. Returns the new status and outcome.
 * Runs side effects (supersede earlier leads, alert) after the write.
 */
export function applyAttemptResult(
  site: string,
  submissionId: string,
  result: LeadDeliveryResult,
  ctx: { urlHost: string; trigger: LeadAttemptTrigger; startedAt: number; now?: number; live?: boolean },
): { status: LeadDeliveryStatus; outcome: LeadDeliveryOutcome } | null {
  const now = ctx.now ?? Date.now();
  const live = ctx.live ?? isLiveServer();
  const sqlite = db(site);
  const outcome = classifyLeadDelivery(result);
  const applied = sqlite.transaction(() => {
    const row = sqlite.prepare("SELECT * FROM lead_outbox WHERE submission_id = ?").get(submissionId) as OutboxRow | undefined;
    if (!row) return null;
    const attempt = row.attempts + 1;
    const cycle = row.cycle_attempts + 1;
    const bodyEnc = result.responseBody ? encryptLeadOutbox(result.responseBody) : null;
    sqlite
      .prepare(
        `INSERT INTO lead_delivery_attempts (
           submission_id, attempt, started_at, duration_ms, url_host, http_status, error_kind, error_message,
           response_body_enc, response_headers_json, trigger
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        submissionId,
        attempt,
        ctx.startedAt,
        result.durationMs,
        ctx.urlHost || null,
        result.status,
        result.errorKind,
        result.errorMessage,
        bodyEnc,
        Object.keys(result.responseHeaders).length ? JSON.stringify(result.responseHeaders) : null,
        ctx.trigger,
      );

    // Superseded / expired meanwhile: keep that state unless this attempt delivered it.
    const open = row.status === "retrying" || row.status === "needs_attention" || row.status === "gave_up";
    let status: LeadDeliveryStatus;
    let nextAttemptAt: number | null = null;
    let wipe = false;
    if (outcome === "delivered") {
      status = "delivered";
      wipe = true;
    } else if (!open) {
      status = row.status;
    } else if (outcome === "retry") {
      if (!live) status = "needs_attention";
      else if (cycle >= LEAD_MAX_ATTEMPTS) status = "gave_up";
      else {
        status = "retrying";
        nextAttemptAt = now + nextRetryDelayMs(cycle, result.retryAfterMs);
      }
    } else {
      status = "needs_attention";
      if (result.errorKind === "decrypt_failed") wipe = true;
    }
    const w = wipe ? wipeSql(now) : null;
    sqlite
      .prepare(
        `UPDATE lead_outbox SET
           status = ?, attempts = ?, cycle_attempts = ?, next_attempt_at = ?, lease_until = NULL,
           last_http_status = ?, last_error_kind = ?, last_error_message = ?, updated_at = ?,
           url_host = CASE WHEN ? != '' THEN ? ELSE url_host END,
           delivered_at = CASE WHEN ? = 'delivered' THEN ? ELSE delivered_at END
           ${w ? `, ${w.set}` : ""}
         WHERE submission_id = ?`,
      )
      .run(
        status,
        attempt,
        cycle,
        nextAttemptAt,
        result.status,
        result.errorKind,
        result.errorMessage,
        now,
        ctx.urlHost,
        ctx.urlHost,
        status,
        now,
        ...(w ? w.params : []),
        submissionId,
      );
    return { row, status };
  })();
  if (!applied) return null;

  if (applied.status === "delivered") {
    try {
      supersedeEarlierLeads(site, applied.row, now);
    } catch (err) {
      log.warn({ err, submission_id: submissionId }, "[lead-outbox] supersede failed");
    }
  } else if (applied.status === "needs_attention" || applied.status === "gave_up") {
    maybeAlertLeadDeliveryFailed(site, submissionId, { live, now });
  }
  if (!result.ok) {
    log.warn(
      {
        submission_id: submissionId,
        url_host: ctx.urlHost,
        http_status: result.status,
        error_kind: result.errorKind,
        status: applied.status,
        trigger: ctx.trigger,
      },
      "[lead-outbox] lead delivery attempt failed",
    );
  }
  return { status: applied.status, outcome };
}

/** Earlier undelivered leads from the same browser and form within 24 h are replaced by this delivered one. */
export function supersedeEarlierLeads(site: string, delivered: Pick<OutboxRow, "submission_id" | "browser_hash" | "form" | "created_at">, now: number = Date.now()): number {
  if (!delivered.browser_hash) return 0;
  const info = db(site)
    .prepare(
      `UPDATE lead_outbox SET status = 'superseded', payload_enc = NULL, payload_wiped_at = ?, lease_until = NULL,
         next_attempt_at = NULL, updated_at = ?
       WHERE browser_hash = ? AND IFNULL(form, '') = IFNULL(?, '') AND submission_id != ?
         AND status IN ('retrying', 'needs_attention', 'gave_up') AND pulled_from_production = 0
         AND created_at < ? AND created_at >= ?`,
    )
    .run(now, now, delivered.browser_hash, delivered.form, delivered.submission_id, delivered.created_at, delivered.created_at - LEAD_SUPERSEDE_WINDOW_MS);
  return Number(info.changes ?? 0);
}

function leadsPageUrl(submissionId: string): string {
  const path = `/private/store/leads?show=all&lead=${encodeURIComponent(submissionId)}`;
  const base = process.env.SITE_URL?.trim().replace(/\/$/, "");
  return base ? `${base}${path}` : path;
}

/** Emit `lead_delivery_failed` once per lead. Never for test leads or off the live server. No personal data. */
export function maybeAlertLeadDeliveryFailed(site: string, submissionId: string, opts: { live?: boolean; now?: number } = {}): boolean {
  const live = opts.live ?? isLiveServer();
  if (!live) return false;
  const now = opts.now ?? Date.now();
  try {
    const sqlite = db(site);
    const row = sqlite.prepare("SELECT * FROM lead_outbox WHERE submission_id = ?").get(submissionId) as OutboxRow | undefined;
    if (!row || row.is_test === 1 || row.pulled_from_production === 1) return false;
    const info = sqlite
      .prepare("UPDATE lead_outbox SET alerted_at = ? WHERE submission_id = ? AND alerted_at IS NULL")
      .run(now, submissionId);
    if (info.changes !== 1) return false;
    emitEvent({
      site,
      type: "lead_delivery_failed",
      attribution: systemJobAttribution("lead-outbox"),
      payload: {
        submission_id: row.submission_id,
        form: row.form,
        url_host: row.url_host,
        status: row.status,
        http_status: row.last_http_status,
        error_kind: row.last_error_kind,
        attempts: row.attempts,
        leads_url: leadsPageUrl(row.submission_id),
      },
    });
    return true;
  } catch (err) {
    log.warn({ err, submission_id: submissionId }, "[lead-outbox] alert failed");
    return false;
  }
}

/** Wipe undelivered copies and saved CRM replies older than 30 days. */
export function expireLeadCopies(site: string, now: number = Date.now()): number {
  const sqlite = db(site);
  const cutoff = now - LEAD_PAYLOAD_TTL_MS;
  const info = sqlite
    .prepare(
      `UPDATE lead_outbox SET
         status = CASE WHEN status IN ('retrying', 'needs_attention', 'gave_up') THEN 'expired' ELSE status END,
         payload_enc = NULL, payload_wiped_at = ?, lease_until = NULL, next_attempt_at = NULL, updated_at = ?
       WHERE payload_enc IS NOT NULL AND created_at < ?`,
    )
    .run(now, now, cutoff);
  sqlite
    .prepare("UPDATE lead_delivery_attempts SET response_body_enc = NULL WHERE response_body_enc IS NOT NULL AND started_at < ?")
    .run(cutoff);
  return Number(info.changes ?? 0);
}

/** Delete outbox metadata older than the ledger retention cutoff. */
export function pruneLeadOutbox(site: string, cutoffMs: number): number {
  const sqlite = db(site);
  sqlite.prepare("DELETE FROM lead_delivery_attempts WHERE started_at < ?").run(cutoffMs);
  const info = sqlite.prepare("DELETE FROM lead_outbox WHERE created_at < ?").run(cutoffMs);
  return Number(info.changes ?? 0);
}

// ── Attempts (scan / manual) ─────────────────────────────────────────────────

/** Lease up to `limit` due rows so concurrent scans never send the same lead twice. */
export function claimDueLeads(site: string, now: number = Date.now(), limit: number = LEAD_OUTBOX_SCAN_BATCH): OutboxRow[] {
  const sqlite = db(site);
  return sqlite.transaction(() => {
    const rows = sqlite
      .prepare(
        `SELECT * FROM lead_outbox
         WHERE status = 'retrying' AND pulled_from_production = 0 AND payload_enc IS NOT NULL
           AND next_attempt_at <= ? AND (lease_until IS NULL OR lease_until < ?)
         ORDER BY next_attempt_at ASC LIMIT ?`,
      )
      .all(now, now, limit) as OutboxRow[];
    const lease = sqlite.prepare("UPDATE lead_outbox SET lease_until = ? WHERE submission_id = ?");
    for (const r of rows) lease.run(now + LEAD_OUTBOX_LEASE_MS, r.submission_id);
    return rows;
  })();
}

/** Decrypt, resolve the target, send, and record. */
export async function attemptOutboxRow(
  site: string,
  contentRoot: string | undefined,
  row: Pick<OutboxRow, "submission_id" | "payload_enc" | "webhook_source" | "url_host">,
  trigger: LeadAttemptTrigger,
  deps: { fetchImpl?: typeof fetch; live?: boolean; now?: () => number } = {},
): Promise<{ status: LeadDeliveryStatus; outcome: LeadDeliveryOutcome; result: LeadDeliveryResult } | null> {
  const clock = deps.now ?? Date.now;
  const startedAt = clock();
  const resolved = resolveRetryTarget(row, contentRoot);
  let result: LeadDeliveryResult;
  let urlHost = row.url_host;
  if (!resolved.ok) {
    result = resolved.result;
  } else {
    urlHost = urlHostOf(resolved.target.url);
    result = await deliverLeadWebhook({
      url: resolved.target.url,
      method: resolved.target.method,
      headers: resolved.target.headers,
      payload: resolved.copy.payload,
      idempotencyKey: row.submission_id,
      fetchImpl: deps.fetchImpl,
    });
  }
  const applied = applyAttemptResult(site, row.submission_id, result, { urlHost, trigger, startedAt, now: clock(), live: deps.live });
  return applied ? { ...applied, result } : null;
}

export type ManualRetryResult =
  | { ok: true; status: LeadDeliveryStatus; http_status: number | null; error_kind: LeadDeliveryErrorKind | null }
  | { ok: false; code: "not_found" | "payload_wiped" | "key_missing" | "production_copy" | "in_flight" | "not_sent"; message: string };

/** Plain reason Retry is unavailable for this row; null when it can be retried. */
export function retryBlockedReason(row: Pick<OutboxRow, "status" | "payload_enc" | "pulled_from_production">): string | null {
  if (row.pulled_from_production === 1) return "This is a copy downloaded from production. Retry it on the live site.";
  if (row.status === "not_sent_no_webhook") return "No webhook was configured when this lead was submitted.";
  if (row.status === "delivered") return null;
  if (!row.payload_enc) return "The saved copy of this lead was erased (delivered, replaced, or older than 30 days).";
  if (leadOutboxKeyStatus() === "missing") return "Recovery is off: the lead encryption key is not set on this server.";
  return null;
}

/** Staff Retry: one immediate attempt; restarts the automatic retry cycle on failure (live server). */
export async function retryLeadNow(
  site: string,
  contentRoot: string | undefined,
  submissionId: string,
  deps: { fetchImpl?: typeof fetch; live?: boolean; now?: () => number } = {},
): Promise<ManualRetryResult> {
  const clock = deps.now ?? Date.now;
  const now = clock();
  const sqlite = db(site);
  const row = getOutboxRow(site, submissionId);
  if (!row) return { ok: false, code: "not_found", message: "This lead has no delivery record." };
  if (row.pulled_from_production === 1) {
    return { ok: false, code: "production_copy", message: "This is a copy downloaded from production. Retry it on the live site." };
  }
  if (row.status === "not_sent_no_webhook") {
    return { ok: false, code: "not_sent", message: "No webhook was configured when this lead was submitted." };
  }
  if (!row.payload_enc) {
    return { ok: false, code: "payload_wiped", message: "The saved copy of this lead was erased, so it can't be sent again." };
  }
  if (!leadOutboxKey()) {
    return { ok: false, code: "key_missing", message: "Recovery is off: the lead encryption key is not set on this server." };
  }
  const leased = sqlite
    .prepare(
      `UPDATE lead_outbox SET lease_until = ?, cycle_attempts = 0, updated_at = ?
       WHERE submission_id = ? AND (lease_until IS NULL OR lease_until < ?)`,
    )
    .run(now + LEAD_OUTBOX_LEASE_MS, now, submissionId, now);
  if (leased.changes !== 1) {
    return { ok: false, code: "in_flight", message: "This lead is being sent right now. Check again in a minute." };
  }
  const out = await attemptOutboxRow(site, contentRoot, row, "manual", deps);
  if (!out) return { ok: false, code: "not_found", message: "This lead has no delivery record." };
  return { ok: true, status: out.status, http_status: out.result.status, error_kind: out.result.errorKind };
}

/**
 * Retry all failed: requeue failed rows (optionally restricted to ledger rows matching the
 * Leads page filter). The scan then sends them at most LEAD_OUTBOX_SCAN_BATCH per site per run.
 */
export function requeueFailedLeads(
  site: string,
  opts: { ledgerWhere?: { sql: string; params: (string | number)[] }; now?: number } = {},
): number {
  const now = opts.now ?? Date.now();
  const restrict = opts.ledgerWhere
    ? ` AND submission_id IN (SELECT submission_id FROM lead_submissions ${opts.ledgerWhere.sql})`
    : "";
  const info = db(site)
    .prepare(
      `UPDATE lead_outbox SET status = 'retrying', next_attempt_at = ?, cycle_attempts = 0, requeued_at = ?,
         lease_until = NULL, updated_at = ?
       WHERE status IN ('needs_attention', 'gave_up') AND payload_enc IS NOT NULL AND pulled_from_production = 0${restrict}`,
    )
    .run(now, now, now, ...(opts.ledgerWhere?.params ?? []));
  return Number(info.changes ?? 0);
}

// ── Scan ────────────────────────────────────────────────────────────────────

let scanTimer: ReturnType<typeof setInterval> | null = null;
let scanning = false;

type ScanSite = { site: string; contentRoot: string | undefined };

async function listScanSites(): Promise<ScanSite[]> {
  const { getSiteContextMap } = await import("../site-manager");
  return Array.from(getSiteContextMap().values()).map((ctx) => ({ site: ctx.contentRootName, contentRoot: ctx.contentRoot }));
}

/** One pass: expire old copies, then send due leads (max LEAD_OUTBOX_SCAN_BATCH per site, one after another). */
export async function runLeadOutboxScan(
  deps: { sites?: ScanSite[]; live?: boolean; fetchImpl?: typeof fetch; now?: () => number } = {},
): Promise<number> {
  const live = deps.live ?? isLiveServer();
  if (!live || !leadOutboxKey() || scanning) return 0;
  scanning = true;
  let sent = 0;
  try {
    const clock = deps.now ?? Date.now;
    const sites = deps.sites ?? (await listScanSites());
    for (const { site, contentRoot } of sites) {
      try {
        expireLeadCopies(site, clock());
        for (const row of claimDueLeads(site, clock())) {
          await attemptOutboxRow(site, contentRoot, row, "retry", { fetchImpl: deps.fetchImpl, live, now: clock });
          sent++;
        }
      } catch (err) {
        log.warn({ err, site }, "[lead-outbox] scan failed for site");
      }
    }
  } finally {
    scanning = false;
  }
  return sent;
}

/** Start the 30 s scan (idempotent). No-op off the live server. */
export function startLeadOutboxScan(): void {
  if (scanTimer || !isLiveServer()) return;
  scanTimer = setInterval(() => {
    void runLeadOutboxScan().catch((err) => log.warn({ err }, "[lead-outbox] scan failed"));
  }, LEAD_OUTBOX_SCAN_INTERVAL_MS);
  scanTimer.unref?.();
}

export function stopLeadOutboxScanForTests(): void {
  if (scanTimer) clearInterval(scanTimer);
  scanTimer = null;
  scanning = false;
}

// ── Staff views ─────────────────────────────────────────────────────────────

function attemptView(a: AttemptRow, canSeeBodies: boolean): LeadDeliveryAttemptView {
  let body: string | null = null;
  if (canSeeBodies && a.response_body_enc) {
    try {
      body = decryptLeadOutbox(a.response_body_enc);
    } catch {
      body = null;
    }
  }
  let headers: Record<string, string> = {};
  try {
    headers = a.response_headers_json ? (JSON.parse(a.response_headers_json) as Record<string, string>) : {};
  } catch {
    headers = {};
  }
  return {
    attempt: a.attempt,
    started_at: a.started_at,
    duration_ms: a.duration_ms,
    url_host: a.url_host,
    http_status: a.http_status,
    error_kind: a.error_kind,
    error_message: a.error_message,
    response_body: body,
    response_body_hidden: !canSeeBodies && !!a.response_body_enc,
    response_headers: headers,
    trigger: a.trigger,
  };
}

/** Delivery status + attempts for the lead details dialog. CRM replies only when `canSeeBodies` (ads_edit). */
export function getLeadDelivery(site: string, submissionId: string, opts: { canSeeBodies: boolean; canRetry: boolean }): LeadDeliveryView | null {
  const row = getOutboxRow(site, submissionId);
  if (!row) return null;
  const attempts = db(site)
    .prepare("SELECT * FROM lead_delivery_attempts WHERE submission_id = ? ORDER BY attempt ASC, id ASC")
    .all(submissionId) as AttemptRow[];
  const blocked = row.status === "delivered" ? "This lead already reached the CRM." : retryBlockedReason(row);
  return {
    status: row.status,
    webhook_source: row.webhook_source,
    url_host: row.url_host,
    attempts: row.attempts,
    next_attempt_at: row.status === "retrying" ? row.next_attempt_at : null,
    last_http_status: row.last_http_status,
    last_error_kind: row.last_error_kind,
    last_error_message: row.last_error_message,
    is_test: row.is_test === 1,
    pulled_from_production: row.pulled_from_production === 1,
    created_at: row.created_at,
    delivered_at: row.delivered_at,
    payload_saved: !!row.payload_enc,
    can_retry: opts.canRetry && blocked === null,
    retry_blocked_reason: !opts.canRetry ? "Retry requires the ads edit permission." : blocked,
    attempts_log: attempts.map((a) => attemptView(a, opts.canSeeBodies)),
  };
}

/** Banner counts for the Leads page. `ledgerWhere` = the page's current range + filters on lead_submissions. */
export function leadDeliveryCounts(
  site: string,
  ledgerWhere: { sql: string; params: (string | number)[] },
  now: number = Date.now(),
): { needs_attention_count: number; retryable_count: number; queued_count: number; bulk: { requeued_at: number; queued: number; delivered: number; remaining: number } | null } {
  const sqlite = db(site);
  const inView = `submission_id IN (SELECT submission_id FROM lead_submissions ${ledgerWhere.sql})`;
  const failed = `status IN (${FAILED_STATUSES.map((s) => `'${s}'`).join(", ")}) AND payload_enc IS NOT NULL AND pulled_from_production = 0`;
  const counts = sqlite
    .prepare(
      `SELECT
         COALESCE(SUM(CASE WHEN ${failed} AND is_test = 0 THEN 1 ELSE 0 END), 0) AS needs_attention_count,
         COALESCE(SUM(CASE WHEN ${failed} THEN 1 ELSE 0 END), 0) AS retryable_count,
         COALESCE(SUM(CASE WHEN status = 'retrying' AND pulled_from_production = 0 THEN 1 ELSE 0 END), 0) AS queued_count
       FROM lead_outbox WHERE ${inView}`,
    )
    .get(...ledgerWhere.params) as { needs_attention_count: number; retryable_count: number; queued_count: number };
  const last = sqlite.prepare("SELECT MAX(requeued_at) AS at FROM lead_outbox WHERE requeued_at IS NOT NULL").get() as { at: number | null };
  let bulk: { requeued_at: number; queued: number; delivered: number; remaining: number } | null = null;
  if (last?.at != null) {
    const b = sqlite
      .prepare(
        `SELECT COUNT(*) AS queued,
                COALESCE(SUM(CASE WHEN status = 'delivered' THEN 1 ELSE 0 END), 0) AS delivered,
                COALESCE(SUM(CASE WHEN status = 'retrying' THEN 1 ELSE 0 END), 0) AS remaining,
                MAX(updated_at) AS last_update
         FROM lead_outbox WHERE requeued_at = ?`,
      )
      .get(last.at) as { queued: number; delivered: number; remaining: number; last_update: number | null };
    if (b.remaining > 0 || now - (b.last_update ?? last.at) < BULK_PROGRESS_TTL_MS) {
      bulk = { requeued_at: last.at, queued: b.queued, delivered: b.delivered, remaining: b.remaining };
    }
  }
  return { ...counts, bulk };
}

// ── Production download (metadata only) ──────────────────────────────────────

export type LeadOutboxExportRow = Omit<OutboxRow, "payload_enc" | "lease_until">;
export type LeadAttemptExportRow = Omit<AttemptRow, "id" | "response_body_enc">;

const OUTBOX_EXPORT_COLUMNS = [
  "submission_id", "status", "webhook_source", "url_host", "method", "attempts", "cycle_attempts", "next_attempt_at",
  "last_http_status", "last_error_kind", "last_error_message", "browser_hash", "form", "is_test",
  "pulled_from_production", "alerted_at", "requeued_at", "created_at", "updated_at", "delivered_at", "payload_wiped_at",
] as const;
/** NOT NULL columns a production row may omit. */
const OUTBOX_IMPORT_DEFAULTS: Partial<Record<(typeof OUTBOX_EXPORT_COLUMNS)[number], string | number>> = {
  url_host: "",
  method: "POST",
  attempts: 0,
  cycle_attempts: 0,
  is_test: 0,
  updated_at: 0,
};
const ATTEMPT_EXPORT_COLUMNS = [
  "submission_id", "attempt", "started_at", "duration_ms", "url_host", "http_status", "error_kind", "error_message",
  "response_headers_json", "trigger",
] as const;

/** Production side: outbox + attempt metadata from `sinceMs`. Never payloads or CRM replies. */
export function buildLeadOutboxExport(site: string, sinceMs: number): { outbox: LeadOutboxExportRow[]; attempts: LeadAttemptExportRow[] } {
  const sqlite = db(site);
  const outbox = sqlite
    .prepare(`SELECT ${OUTBOX_EXPORT_COLUMNS.join(", ")} FROM lead_outbox WHERE created_at >= ? AND pulled_from_production = 0`)
    .all(sinceMs) as LeadOutboxExportRow[];
  const attempts = sqlite
    .prepare(
      `SELECT ${ATTEMPT_EXPORT_COLUMNS.map((c) => `a.${c}`).join(", ")} FROM lead_delivery_attempts a
       JOIN lead_outbox o ON o.submission_id = a.submission_id
       WHERE o.created_at >= ? AND o.pulled_from_production = 0`,
    )
    .all(sinceMs) as LeadAttemptExportRow[];
  return { outbox, attempts };
}

/** Dev side: replace pulled outbox rows from `sinceMs` with production's, marked view-only. Local rows are kept. */
export function replaceLeadOutboxFromSnapshot(
  site: string,
  snap: { outbox: LeadOutboxExportRow[]; attempts: LeadAttemptExportRow[] },
  sinceMs: number,
): number {
  const sqlite = db(site);
  let written = 0;
  sqlite.transaction(() => {
    sqlite
      .prepare(
        `DELETE FROM lead_delivery_attempts WHERE submission_id IN (
           SELECT submission_id FROM lead_outbox WHERE pulled_from_production = 1 AND created_at >= ?)`,
      )
      .run(sinceMs);
    sqlite.prepare("DELETE FROM lead_outbox WHERE pulled_from_production = 1 AND created_at >= ?").run(sinceMs);
    const insOutbox = sqlite.prepare(
      `INSERT OR IGNORE INTO lead_outbox (${OUTBOX_EXPORT_COLUMNS.join(", ")}) VALUES (${OUTBOX_EXPORT_COLUMNS.map(() => "?").join(", ")})`,
    );
    const imported = new Set<string>();
    for (const r of snap.outbox) {
      if (typeof r?.submission_id !== "string" || typeof r.created_at !== "number" || r.created_at < sinceMs) continue;
      if (typeof r.status !== "string") continue;
      const values = OUTBOX_EXPORT_COLUMNS.map((c) => {
        if (c === "pulled_from_production") return 1;
        const v = (r as Record<string, unknown>)[c];
        return (v ?? OUTBOX_IMPORT_DEFAULTS[c] ?? null) as string | number | null;
      });
      const info = insOutbox.run(...values);
      if (info.changes === 1) {
        imported.add(r.submission_id);
        written++;
      }
    }
    const insAttempt = sqlite.prepare(
      `INSERT INTO lead_delivery_attempts (${ATTEMPT_EXPORT_COLUMNS.join(", ")}) VALUES (${ATTEMPT_EXPORT_COLUMNS.map(() => "?").join(", ")})`,
    );
    for (const a of snap.attempts) {
      if (typeof a?.submission_id !== "string" || !imported.has(a.submission_id)) continue;
      if (typeof a.attempt !== "number" || typeof a.started_at !== "number") continue;
      insAttempt.run(
        ...ATTEMPT_EXPORT_COLUMNS.map((c) => {
          const v = (a as Record<string, unknown>)[c];
          return (v ?? (c === "trigger" ? "submit" : null)) as string | number | null;
        }),
      );
    }
  })();
  return written;
}
