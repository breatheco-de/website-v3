import crypto from "crypto";
import fs from "fs";
import path from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const tracking = vi.hoisted(() => ({
  value: {
    conversion_events: [] as { name: string; webhook?: { url: string; method?: string; headers?: Record<string, string> } }[],
    webhook: { url: "https://crm.example.com/leads", method: "POST", headers: { Authorization: "Bearer settings" } } as
      | { url: string; method?: string; headers?: Record<string, string> }
      | undefined,
  },
}));
const emitEvent = vi.hoisted(() => vi.fn());

vi.mock("../settings", () => ({ getTrackingSettings: () => tracking.value }));
vi.mock("../events/event-store", () => ({ emitEvent }));

import { clearSiteSqliteCacheForTests, getSiteSqlite } from "../db";
import { resetPipelineDbCache } from "../pipeline-db/runner";
import { setLiveServerForTests } from "../live-server";
import { LEAD_OUTBOX_KEY_ENV, LEAD_OUTBOX_PREVIOUS_KEY_ENV } from "./lead-outbox-crypto";
import {
  applyAttemptResult,
  buildLeadOutboxExport,
  claimDueLeads,
  classifyLeadDelivery,
  createLeadOutboxEntry,
  deliverLeadWebhook,
  expireLeadCopies,
  getLeadDelivery,
  getOutboxRow,
  LEAD_MAX_ATTEMPTS,
  LEAD_OUTBOX_SCAN_BATCH,
  LEAD_PAYLOAD_TTL_MS,
  LEAD_RETRY_DELAYS_MS,
  leadDeliveryCounts,
  nextRetryDelayMs,
  parseRetryAfter,
  replaceLeadOutboxFromSnapshot,
  requeueFailedLeads,
  retryLeadNow,
  runLeadOutboxScan,
  stopLeadOutboxScanForTests,
  type LeadDeliveryResult,
  type LeadWebhookTarget,
  type SavedLeadCopy,
} from "./lead-outbox";

const SITE = `site_lead-outbox-test-${process.pid}`;
const KEY_A = crypto.randomBytes(32).toString("hex");
const KEY_B = crypto.randomBytes(32).toString("hex");
const NOW = Date.parse("2026-10-20T12:00:00.000Z");
const ALL = { sql: "", params: [] as (string | number)[] };

function rmSite(): void {
  fs.rmSync(path.join("data", SITE), { recursive: true, force: true });
}

const settingsTarget: LeadWebhookTarget = {
  url: "https://crm.example.com/leads",
  method: "POST",
  headers: { Authorization: "Bearer settings" },
  failSilently: false,
  source: "global",
};

function copy(over: Partial<SavedLeadCopy> = {}): SavedLeadCopy {
  return { v: 1, payload: { email: "visitor@example.com", first_name: "Ana" }, routing_conversion_name: null, target: null, ...over };
}

function save(id: string, over: { target?: LeadWebhookTarget; copy?: SavedLeadCopy; browserHash?: string | null; form?: string | null; isTest?: boolean; now?: number } = {}) {
  const ok = createLeadOutboxEntry(SITE, {
    submissionId: id,
    copy: over.copy ?? copy(),
    target: over.target ?? settingsTarget,
    browserHash: over.browserHash ?? null,
    form: over.form ?? "apply",
    isTest: over.isTest ?? false,
    now: over.now ?? NOW,
  });
  expect(ok).toBe(true);
}

function result(over: Partial<LeadDeliveryResult>): LeadDeliveryResult {
  return { ok: false, status: null, durationMs: 5, errorKind: null, errorMessage: null, responseBody: null, responseHeaders: {}, retryAfterMs: null, ...over };
}

const ok200 = result({ ok: true, status: 200, responseBody: '{"id":1}' });
const fail500 = result({ status: 500, errorKind: "non_2xx", errorMessage: "HTTP 500", responseBody: "down" });
const fail400 = result({ status: 400, errorKind: "non_2xx", errorMessage: "HTTP 400", responseBody: '{"detail":"Invalid phone"}' });

function apply(id: string, r: LeadDeliveryResult, opts: { live?: boolean; now?: number; trigger?: "submit" | "retry" | "manual" } = {}) {
  return applyAttemptResult(SITE, id, r, {
    urlHost: "crm.example.com",
    trigger: opts.trigger ?? "submit",
    startedAt: opts.now ?? NOW,
    now: opts.now ?? NOW,
    live: opts.live ?? true,
  });
}

function fetchReturning(status: number, body = "", headers: Record<string, string> = {}) {
  const calls: { url: string; init: RequestInit }[] = [];
  const impl = (async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    return new Response(body, { status, headers });
  }) as unknown as typeof fetch;
  return { impl, calls };
}

describe("lead outbox", () => {
  beforeEach(() => {
    process.env[LEAD_OUTBOX_KEY_ENV] = KEY_A;
    delete process.env[LEAD_OUTBOX_PREVIOUS_KEY_ENV];
    resetPipelineDbCache();
    clearSiteSqliteCacheForTests();
    rmSite();
    emitEvent.mockClear();
    tracking.value.conversion_events = [];
    tracking.value.webhook = { url: "https://crm.example.com/leads", method: "POST", headers: { Authorization: "Bearer settings" } };
    setLiveServerForTests(true);
  });
  afterEach(() => {
    stopLeadOutboxScanForTests();
    setLiveServerForTests(null);
    clearSiteSqliteCacheForTests();
    rmSite();
    delete process.env[LEAD_OUTBOX_KEY_ENV];
    delete process.env[LEAD_OUTBOX_PREVIOUS_KEY_ENV];
  });

  describe("classification and schedule", () => {
    it("retries outages and sends rejections to staff", () => {
      expect(classifyLeadDelivery({ ok: true, status: 201, errorKind: null })).toBe("delivered");
      for (const kind of ["timeout", "dns", "connection_refused", "tls", "network"] as const) {
        expect(classifyLeadDelivery({ ok: false, status: null, errorKind: kind })).toBe("retry");
      }
      expect(classifyLeadDelivery({ ok: false, status: 503, errorKind: "non_2xx" })).toBe("retry");
      expect(classifyLeadDelivery({ ok: false, status: 429, errorKind: "non_2xx" })).toBe("retry");
      expect(classifyLeadDelivery({ ok: false, status: 400, errorKind: "non_2xx" })).toBe("rejected_data");
      expect(classifyLeadDelivery({ ok: false, status: 422, errorKind: "non_2xx" })).toBe("rejected_data");
      for (const s of [401, 403, 404, 405]) {
        expect(classifyLeadDelivery({ ok: false, status: s, errorKind: "non_2xx" })).toBe("rejected_config");
      }
      expect(classifyLeadDelivery({ ok: false, status: null, errorKind: "blocked_private_url" })).toBe("rejected_config");
      expect(classifyLeadDelivery({ ok: false, status: null, errorKind: "decrypt_failed" })).toBe("rejected_config");
    });

    it("parses Retry-After seconds and dates", () => {
      expect(parseRetryAfter("120", NOW)).toBe(120_000);
      expect(parseRetryAfter(new Date(NOW + 90_000).toUTCString(), NOW)).toBe(90_000);
      expect(parseRetryAfter("soon", NOW)).toBeNull();
      expect(parseRetryAfter(null, NOW)).toBeNull();
    });

    it("follows the backoff schedule and honors a longer Retry-After (capped at 12 h)", () => {
      expect(LEAD_RETRY_DELAYS_MS.map((_, i) => nextRetryDelayMs(i + 1, null))).toEqual([...LEAD_RETRY_DELAYS_MS]);
      expect(nextRetryDelayMs(1, 10 * 60_000)).toBe(10 * 60_000);
      expect(nextRetryDelayMs(1, 1_000)).toBe(60_000);
      expect(nextRetryDelayMs(1, 48 * 3_600_000)).toBe(12 * 3_600_000);
      expect(LEAD_MAX_ATTEMPTS).toBe(6);
    });
  });

  describe("HTTP delivery", () => {
    it("records status, capped body, allowlisted headers and sends Idempotency-Key", async () => {
      const { impl, calls } = fetchReturning(503, "x".repeat(5000), { "retry-after": "30", "x-request-id": "r1", "set-cookie": "no" });
      const r = await deliverLeadWebhook({
        url: "https://crm.example.com/leads",
        method: "POST",
        headers: { Authorization: "Bearer t" },
        payload: { email: "a@b.com" },
        idempotencyKey: "lead-1",
        fetchImpl: impl,
      });
      expect(r).toMatchObject({ ok: false, status: 503, errorKind: "non_2xx", retryAfterMs: 30_000 });
      expect(r.responseBody).toHaveLength(4096);
      expect(r.responseHeaders).toEqual({ "content-type": "text/plain;charset=UTF-8", "retry-after": "30", "x-request-id": "r1" });
      const headers = calls[0].init.headers as Record<string, string>;
      expect(headers["Idempotency-Key"]).toBe("lead-1");
      expect(headers.Authorization).toBe("Bearer t");
    });

    it("keeps a configured Idempotency-Key header", async () => {
      const { impl, calls } = fetchReturning(200, "ok");
      await deliverLeadWebhook({
        url: "https://crm.example.com/leads",
        method: "POST",
        headers: { "idempotency-key": "mine" },
        payload: {},
        idempotencyKey: "lead-1",
        fetchImpl: impl,
      });
      const headers = calls[0].init.headers as Record<string, string>;
      expect(headers["idempotency-key"]).toBe("mine");
      expect(headers["Idempotency-Key"]).toBeUndefined();
    });

    it("classifies DNS failures and timeouts, and blocks private addresses without calling out", async () => {
      const dns = (async () => {
        throw Object.assign(new TypeError("fetch failed"), { cause: Object.assign(new Error("getaddrinfo ENOTFOUND"), { code: "ENOTFOUND" }) });
      }) as unknown as typeof fetch;
      expect((await deliverLeadWebhook({ url: "https://nope.example", method: "POST", headers: {}, payload: {}, fetchImpl: dns })).errorKind).toBe("dns");

      const hang = ((_: string, init: RequestInit) =>
        new Promise((_resolve, reject) => {
          init.signal?.addEventListener("abort", () => reject(Object.assign(new Error("aborted"), { name: "AbortError" })));
        })) as unknown as typeof fetch;
      const slow = await deliverLeadWebhook({ url: "https://slow.example", method: "POST", headers: {}, payload: {}, fetchImpl: hang, timeoutMs: 10 });
      expect(slow.errorKind).toBe("timeout");

      const never = vi.fn();
      const blocked = await deliverLeadWebhook({ url: "http://127.0.0.1/hook", method: "POST", headers: {}, payload: {}, fetchImpl: never as unknown as typeof fetch });
      expect(blocked.errorKind).toBe("blocked_private_url");
      expect(never).not.toHaveBeenCalled();
    });
  });

  describe("state transitions", () => {
    it("delivered wipes the saved copy", () => {
      save("lead-ok-01");
      expect(apply("lead-ok-01", ok200)?.status).toBe("delivered");
      const row = getOutboxRow(SITE, "lead-ok-01")!;
      expect(row).toMatchObject({ status: "delivered", attempts: 1, payload_enc: null, delivered_at: NOW });
      expect(row.payload_wiped_at).toBe(NOW);
    });

    it("never stores personal data in plain text", () => {
      save("lead-pii-01");
      apply("lead-pii-01", fail400);
      const sqlite = getSiteSqlite(SITE);
      const dump = JSON.stringify([
        sqlite.prepare("SELECT * FROM lead_outbox").all(),
        sqlite.prepare("SELECT * FROM lead_delivery_attempts").all(),
      ]);
      expect(dump).not.toContain("visitor@example.com");
      expect(dump).not.toContain("Invalid phone");
    });

    it("retries outages on the live server and gives up after the 6th attempt", () => {
      save("lead-retry-01");
      let at = NOW;
      for (let i = 1; i < LEAD_MAX_ATTEMPTS; i++) {
        expect(apply("lead-retry-01", fail500, { now: at })?.status).toBe("retrying");
        const row = getOutboxRow(SITE, "lead-retry-01")!;
        expect(row.next_attempt_at).toBe(at + LEAD_RETRY_DELAYS_MS[i - 1]);
        at = row.next_attempt_at!;
      }
      expect(apply("lead-retry-01", fail500, { now: at })?.status).toBe("gave_up");
      expect(getOutboxRow(SITE, "lead-retry-01")!.payload_enc).not.toBeNull();
    });

    it("sends outages straight to needs_attention off the live server", () => {
      save("lead-local-01");
      expect(apply("lead-local-01", fail500, { live: false })?.status).toBe("needs_attention");
    });

    it("sends CRM rejections to needs_attention without retrying", () => {
      save("lead-400-01");
      expect(apply("lead-400-01", fail400)).toEqual({ status: "needs_attention", outcome: "rejected_data" });
      expect(getOutboxRow(SITE, "lead-400-01")!.next_attempt_at).toBeNull();
    });
  });

  describe("leasing and scan", () => {
    it("never hands the same due lead to two scans", () => {
      save("lead-lease-01");
      apply("lead-lease-01", fail500);
      const due = NOW + LEAD_RETRY_DELAYS_MS[0];
      expect(claimDueLeads(SITE, due).map((r) => r.submission_id)).toEqual(["lead-lease-01"]);
      expect(claimDueLeads(SITE, due)).toEqual([]);
    });

    it("leaves a lead alone while its first attempt is in flight", () => {
      save("lead-inflight-01");
      expect(claimDueLeads(SITE, NOW + LEAD_RETRY_DELAYS_MS[0] + 1)).toEqual([]);
    });

    it("does nothing off the live server or without the key", async () => {
      save("lead-scan-01");
      apply("lead-scan-01", fail500);
      const { impl, calls } = fetchReturning(200);
      const later = () => NOW + 3_600_000;
      expect(await runLeadOutboxScan({ sites: [{ site: SITE, contentRoot: undefined }], live: false, fetchImpl: impl, now: later })).toBe(0);
      delete process.env[LEAD_OUTBOX_KEY_ENV];
      expect(await runLeadOutboxScan({ sites: [{ site: SITE, contentRoot: undefined }], live: true, fetchImpl: impl, now: later })).toBe(0);
      expect(calls).toHaveLength(0);
    });

    it("sends at most LEAD_OUTBOX_SCAN_BATCH leads per site per run, to the current settings webhook", async () => {
      for (let i = 0; i < 7; i++) {
        save(`lead-batch-0${i}`);
        apply(`lead-batch-0${i}`, fail500);
      }
      tracking.value.webhook = { url: "https://fixed.example.com/leads", method: "POST" };
      const { impl, calls } = fetchReturning(200, "ok");
      const sent = await runLeadOutboxScan({ sites: [{ site: SITE, contentRoot: undefined }], live: true, fetchImpl: impl, now: () => NOW + 3_600_000 });
      expect(sent).toBe(LEAD_OUTBOX_SCAN_BATCH);
      expect(calls).toHaveLength(LEAD_OUTBOX_SCAN_BATCH);
      expect(calls.every((c) => c.url === "https://fixed.example.com/leads")).toBe(true);
      expect(JSON.parse(String(calls[0].init.body))).toEqual({ email: "visitor@example.com", first_name: "Ana" });
    });
  });

  describe("retry target", () => {
    it("keeps the saved form webhook (visitor tokens) even after settings change", async () => {
      const formTarget: LeadWebhookTarget = {
        url: "https://form.example.com/hook?token=visitor-abc",
        method: "POST",
        headers: { "X-Token": "visitor-abc" },
        failSilently: false,
        source: "form",
      };
      save("lead-form-01", { target: formTarget, copy: copy({ target: { url: formTarget.url, method: "POST", headers: formTarget.headers } }) });
      apply("lead-form-01", fail500, { live: false });
      tracking.value.webhook = { url: "https://other.example.com/x" };
      const { impl, calls } = fetchReturning(200);
      const r = await retryLeadNow(SITE, undefined, "lead-form-01", { fetchImpl: impl, live: false, now: () => NOW + 1000 });
      expect(r).toMatchObject({ ok: true, status: "delivered" });
      expect(calls[0].url).toBe(formTarget.url);
      expect((calls[0].init.headers as Record<string, string>)["X-Token"]).toBe("visitor-abc");
    });

    it("moves to needs_attention with config_missing when the settings webhook was removed", async () => {
      save("lead-gone-01");
      apply("lead-gone-01", fail500, { live: false });
      tracking.value.webhook = undefined;
      const prev = process.env.DEFAULT_WEBHOOK_URL;
      delete process.env.DEFAULT_WEBHOOK_URL;
      const r = await retryLeadNow(SITE, undefined, "lead-gone-01", { live: false, now: () => NOW + 1000 });
      if (prev !== undefined) process.env.DEFAULT_WEBHOOK_URL = prev;
      expect(r).toMatchObject({ ok: true, status: "needs_attention", error_kind: "config_missing" });
    });

    it("reads copies saved before a key rotation, and wipes unreadable ones", async () => {
      save("lead-rot-01");
      apply("lead-rot-01", fail500, { live: false });
      save("lead-lost-01");
      apply("lead-lost-01", fail500, { live: false });

      process.env[LEAD_OUTBOX_KEY_ENV] = KEY_B;
      process.env[LEAD_OUTBOX_PREVIOUS_KEY_ENV] = KEY_A;
      const { impl } = fetchReturning(200);
      expect(await retryLeadNow(SITE, undefined, "lead-rot-01", { fetchImpl: impl, live: false, now: () => NOW + 1000 })).toMatchObject({
        ok: true,
        status: "delivered",
      });

      delete process.env[LEAD_OUTBOX_PREVIOUS_KEY_ENV];
      const lost = await retryLeadNow(SITE, undefined, "lead-lost-01", { fetchImpl: impl, live: false, now: () => NOW + 2000 });
      expect(lost).toMatchObject({ ok: true, status: "needs_attention", error_kind: "decrypt_failed" });
      const row = getOutboxRow(SITE, "lead-lost-01")!;
      expect(row.payload_enc).toBeNull();
      expect(row.last_error_message).toBe("Saved copy unreadable (encryption key changed)");
    });

    it("refuses Retry for wiped, production-copy and keyless rows", async () => {
      save("lead-done-01");
      apply("lead-done-01", ok200);
      expect(await retryLeadNow(SITE, undefined, "lead-done-01")).toMatchObject({ ok: false, code: "payload_wiped" });

      save("lead-nokey-01");
      apply("lead-nokey-01", fail400);
      delete process.env[LEAD_OUTBOX_KEY_ENV];
      expect(await retryLeadNow(SITE, undefined, "lead-nokey-01")).toMatchObject({ ok: false, code: "key_missing" });
      expect(await retryLeadNow(SITE, undefined, "missing-lead")).toMatchObject({ ok: false, code: "not_found" });
    });
  });

  describe("supersede and expiry", () => {
    it("supersedes earlier undelivered leads from the same browser and form within 24 h", () => {
      save("lead-first-01", { browserHash: "b1", now: NOW - 60_000 });
      apply("lead-first-01", fail400, { now: NOW - 60_000 });
      save("lead-other-01", { browserHash: "b1", form: "newsletter", now: NOW - 60_000 });
      apply("lead-other-01", fail400, { now: NOW - 60_000 });
      save("lead-second-01", { browserHash: "b1", now: NOW });
      apply("lead-second-01", ok200, { now: NOW });
      expect(getOutboxRow(SITE, "lead-first-01")).toMatchObject({ status: "superseded", payload_enc: null });
      expect(getOutboxRow(SITE, "lead-other-01")!.status).toBe("needs_attention");
    });

    it("expires undelivered copies and CRM replies after 30 days", () => {
      save("lead-old-01", { now: NOW });
      apply("lead-old-01", fail400, { now: NOW });
      expect(expireLeadCopies(SITE, NOW + LEAD_PAYLOAD_TTL_MS - 1)).toBe(0);
      expect(expireLeadCopies(SITE, NOW + LEAD_PAYLOAD_TTL_MS + 1)).toBe(1);
      expect(getOutboxRow(SITE, "lead-old-01")).toMatchObject({ status: "expired", payload_enc: null });
      const body = getSiteSqlite(SITE).prepare("SELECT response_body_enc FROM lead_delivery_attempts").get() as { response_body_enc: string | null };
      expect(body.response_body_enc).toBeNull();
    });
  });

  describe("alerts", () => {
    it("emits lead_delivery_failed once per lead, without personal data", async () => {
      save("lead-alert-01");
      apply("lead-alert-01", fail400);
      expect(emitEvent).toHaveBeenCalledTimes(1);
      const event = emitEvent.mock.calls[0][0];
      expect(event).toMatchObject({ site: SITE, type: "lead_delivery_failed" });
      expect(event.payload).toMatchObject({ submission_id: "lead-alert-01", status: "needs_attention", http_status: 400, error_kind: "non_2xx" });
      expect(JSON.stringify(event.payload)).not.toContain("visitor@example.com");

      await retryLeadNow(SITE, undefined, "lead-alert-01", { fetchImpl: fetchReturning(400, "still bad").impl, live: true, now: () => NOW + 1000 });
      expect(emitEvent).toHaveBeenCalledTimes(1);
    });

    it("never alerts for test leads or off the live server", () => {
      save("lead-test-01", { isTest: true });
      apply("lead-test-01", fail400);
      save("lead-dev-01");
      apply("lead-dev-01", fail400, { live: false });
      expect(emitEvent).not.toHaveBeenCalled();
    });
  });

  describe("bulk retry and staff views", () => {
    it("requeues failed leads with a saved copy and reports progress", () => {
      save("lead-bulk-01");
      apply("lead-bulk-01", fail400);
      save("lead-bulk-02");
      apply("lead-bulk-02", fail400);
      save("lead-bulk-03", { isTest: true });
      apply("lead-bulk-03", fail400);
      save("lead-bulk-04");
      apply("lead-bulk-04", ok200);

      const before = leadDeliveryCounts(SITE, ALL, NOW);
      expect(before).toMatchObject({ retryable_count: 0, needs_attention_count: 0 });

      getSiteSqlite(SITE)
        .prepare("CREATE TABLE IF NOT EXISTS lead_submissions (submission_id TEXT PRIMARY KEY, created_at INTEGER NOT NULL, is_test INTEGER NOT NULL DEFAULT 0, is_repeat INTEGER NOT NULL DEFAULT 0)")
        .run();
      const ins = getSiteSqlite(SITE).prepare("INSERT OR IGNORE INTO lead_submissions (submission_id, created_at, is_test) VALUES (?, ?, ?)");
      for (const [id, t] of [["lead-bulk-01", 0], ["lead-bulk-02", 0], ["lead-bulk-03", 1], ["lead-bulk-04", 0]] as const) ins.run(id, NOW, t);

      expect(leadDeliveryCounts(SITE, ALL, NOW)).toMatchObject({ needs_attention_count: 2, retryable_count: 3, bulk: null });
      expect(requeueFailedLeads(SITE, { ledgerWhere: { sql: "WHERE is_test = 0", params: [] }, now: NOW + 1 })).toBe(2);
      const after = leadDeliveryCounts(SITE, ALL, NOW + 2);
      expect(after.bulk).toEqual({ requeued_at: NOW + 1, queued: 2, delivered: 0, remaining: 2 });
      expect(getOutboxRow(SITE, "lead-bulk-03")!.status).toBe("needs_attention");
    });

    it("hides CRM replies from staff without ads_edit", () => {
      save("lead-view-01");
      apply("lead-view-01", fail400);
      const hidden = getLeadDelivery(SITE, "lead-view-01", { canSeeBodies: false, canRetry: false })!;
      expect(hidden.attempts_log[0]).toMatchObject({ response_body: null, response_body_hidden: true, http_status: 400 });
      expect(hidden).toMatchObject({ can_retry: false, retry_blocked_reason: "Retry requires the ads edit permission." });
      const shown = getLeadDelivery(SITE, "lead-view-01", { canSeeBodies: true, canRetry: true })!;
      expect(shown.attempts_log[0].response_body).toBe('{"detail":"Invalid phone"}');
      expect(shown.can_retry).toBe(true);
    });
  });

  describe("production download", () => {
    it("exports metadata only and imports rows as view-only copies", async () => {
      save("lead-prod-01");
      apply("lead-prod-01", fail400);
      const snap = buildLeadOutboxExport(SITE, 0);
      expect(JSON.stringify(snap)).not.toContain("enc:v1:");
      expect(snap.outbox[0]).not.toHaveProperty("payload_enc");
      expect(snap.attempts[0]).not.toHaveProperty("response_body_enc");

      rmSite();
      resetPipelineDbCache();
      clearSiteSqliteCacheForTests();
      expect(replaceLeadOutboxFromSnapshot(SITE, snap, 0)).toBe(1);
      const row = getOutboxRow(SITE, "lead-prod-01")!;
      expect(row).toMatchObject({ pulled_from_production: 1, payload_enc: null, status: "needs_attention" });
      expect(getLeadDelivery(SITE, "lead-prod-01", { canSeeBodies: true, canRetry: true })!.attempts_log).toHaveLength(1);
      expect(await retryLeadNow(SITE, undefined, "lead-prod-01")).toMatchObject({ ok: false, code: "production_copy" });
      expect(requeueFailedLeads(SITE, { now: NOW })).toBe(0);
    });
  });
});
