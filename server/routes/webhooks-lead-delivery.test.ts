import crypto from "crypto";
import fs from "fs";
import http from "http";
import path from "path";
import type { AddressInfo } from "net";
import express from "express";
import cookieParser from "cookie-parser";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const tracking = vi.hoisted(() => ({
  value: {
    conversion_events: [] as unknown[],
    webhook: { url: "https://crm.example.com/leads", method: "POST" } as { url: string; method?: string; fail_silently?: boolean } | undefined,
  },
}));

vi.mock("../settings", () => ({
  getTrackingSettings: () => tracking.value,
  getAdsSettings: () => ({ meta: { enabled: false, ad_account_ids: [], alert_thresholds: {} }, test_email_patterns: [] }),
}));
vi.mock("../staff-session-resolve", () => ({ resolveOwnedStaffSession: async () => null }));
vi.mock("../ads/visitor-country", () => ({ resolveVisitorCountry: async () => null }));
vi.mock("../ads/lead-product", () => ({ findCatalogProduct: () => null }));
vi.mock("../events/event-store", () => ({ emitEvent: vi.fn() }));

import { clearSiteSqliteCacheForTests } from "../db";
import { resetPipelineDbCache } from "../pipeline-db/runner";
import { setLiveServerForTests } from "../live-server";
import { getOutboxRow } from "../ads/lead-outbox";
import { LEAD_OUTBOX_KEY_ENV } from "../ads/lead-outbox-crypto";
import { registerWebhooksRoutes } from "./webhooks";

const SITE = `site_lead-delivery-route-${process.pid}`;
const realFetch = globalThis.fetch;
let server: http.Server | null = null;
let baseUrl = "";
type CrmReply = { status: number; body?: string } | { throw: Error };
let crmReply: CrmReply = { status: 200, body: "{}" };
const crmCalls: { url: string; headers: Record<string, string> }[] = [];

function rmSite(): void {
  fs.rmSync(path.join("data", SITE), { recursive: true, force: true });
}

beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.use(cookieParser());
  app.use((_req, res, next) => {
    res.locals.site = { contentRootName: SITE, contentRoot: "/tmp/none" };
    next();
  });
  registerWebhooksRoutes(app);
  server = http.createServer(app);
  await new Promise<void>((resolve) => server!.listen(0, "127.0.0.1", resolve));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  vi.stubGlobal("fetch", (async (input: string | URL, init?: RequestInit) => {
    const url = String(input);
    if (url.startsWith(baseUrl)) return realFetch(input, init);
    crmCalls.push({ url, headers: (init?.headers ?? {}) as Record<string, string> });
    if ("throw" in crmReply) throw crmReply.throw;
    return new Response(crmReply.body ?? "", { status: crmReply.status });
  }) as typeof fetch);
});

afterAll(async () => {
  vi.unstubAllGlobals();
  if (server) await new Promise<void>((resolve) => server!.close(() => resolve()));
});

beforeEach(() => {
  process.env[LEAD_OUTBOX_KEY_ENV] = crypto.randomBytes(32).toString("hex");
  resetPipelineDbCache();
  clearSiteSqliteCacheForTests();
  rmSite();
  crmCalls.length = 0;
  crmReply = { status: 200, body: "{}" };
  tracking.value.webhook = { url: "https://crm.example.com/leads", method: "POST" };
  setLiveServerForTests(true);
});

afterEach(() => {
  setLiveServerForTests(null);
  clearSiteSqliteCacheForTests();
  rmSite();
  delete process.env[LEAD_OUTBOX_KEY_ENV];
});

let seq = 0;
async function submit(extra: Record<string, unknown> = {}) {
  const id = `lead-route-${String(++seq).padStart(4, "0")}`;
  const res = await realFetch(`${baseUrl}/api/leads/webhook-delivery`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ payload: { email: "visitor@example.com", first_name: "Ana", submission_id: id }, ...extra }),
  });
  return { id, status: res.status, body: (await res.json()) as Record<string, unknown> };
}

describe("POST /api/leads/webhook-delivery with the lead outbox", () => {
  it("2xx: visitor sees success, lead is delivered and its copy wiped, Idempotency-Key = lead id", async () => {
    const r = await submit();
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ success: true, delivered: true, status: 200 });
    expect(crmCalls[0].headers["Idempotency-Key"]).toBe(r.id);
    expect(getOutboxRow(SITE, r.id)).toMatchObject({ status: "delivered", payload_enc: null, attempts: 1 });
  });

  it("5xx: visitor sees success, lead is queued for retry", async () => {
    crmReply = { status: 503, body: "maintenance" };
    const r = await submit();
    expect(r.status).toBe(200);
    expect(r.body).toEqual({ success: true, queued: true });
    expect(getOutboxRow(SITE, r.id)).toMatchObject({ status: "retrying", last_http_status: 503 });
  });

  it("network error: visitor sees success; off the live server the lead needs attention", async () => {
    setLiveServerForTests(false);
    crmReply = { throw: Object.assign(new TypeError("fetch failed"), { cause: { code: "ECONNREFUSED" } }) };
    const r = await submit();
    expect(r.body).toEqual({ success: true, queued: true });
    expect(getOutboxRow(SITE, r.id)).toMatchObject({ status: "needs_attention", last_error_kind: "connection_refused" });
  });

  it("400: visitor sees the CRM's field error so they can fix it", async () => {
    crmReply = { status: 400, body: '{"detail":"Invalid phone"}' };
    const r = await submit();
    expect(r.status).toBe(502);
    expect(r.body).toEqual({ error: "Upstream webhook returned a non-2xx response", details: '{"detail":"Invalid phone"}' });
    expect(getOutboxRow(SITE, r.id)).toMatchObject({ status: "needs_attention", last_http_status: 400 });
  });

  it("401 and blocked addresses: visitor sees success, staff must fix the config", async () => {
    crmReply = { status: 401, body: "bad token" };
    const a = await submit();
    expect(a.body).toEqual({ success: true, queued: true });
    expect(getOutboxRow(SITE, a.id)!.status).toBe("needs_attention");

    const b = await submit({ webhook: { url: "http://10.0.0.5/hook", method: "POST" } });
    expect(b.body).toEqual({ success: true, queued: true });
    expect(getOutboxRow(SITE, b.id)).toMatchObject({ status: "needs_attention", last_error_kind: "blocked_private_url", webhook_source: "form" });
  });

  it("without the key: no outbox, failures return 502 as before", async () => {
    delete process.env[LEAD_OUTBOX_KEY_ENV];
    crmReply = { status: 503, body: "down" };
    const r = await submit();
    expect(r.status).toBe(502);
    expect(r.body).toMatchObject({ error: "Upstream webhook returned a non-2xx response" });
    expect(getOutboxRow(SITE, r.id)).toBeNull();
  });

  it("fail_silently: responds right away and still records the attempt", async () => {
    tracking.value.webhook = { url: "https://crm.example.com/leads", method: "POST", fail_silently: true };
    crmReply = { status: 500, body: "x" };
    const r = await submit();
    expect(r.body).toEqual({ success: true, queued: true });
    await vi.waitFor(() => expect(getOutboxRow(SITE, r.id)!.attempts).toBe(1));
    expect(getOutboxRow(SITE, r.id)!.status).toBe("retrying");
  });

  it("no webhook configured: records the lead as not sent", async () => {
    tracking.value.webhook = undefined;
    const prev = process.env.DEFAULT_WEBHOOK_URL;
    delete process.env.DEFAULT_WEBHOOK_URL;
    const r = await submit();
    if (prev !== undefined) process.env.DEFAULT_WEBHOOK_URL = prev;
    expect(r.body).toEqual({ success: true, skipped: "no_webhook" });
    expect(getOutboxRow(SITE, r.id)).toMatchObject({ status: "not_sent_no_webhook", payload_enc: null });
    expect(crmCalls).toHaveLength(0);
  });
});
