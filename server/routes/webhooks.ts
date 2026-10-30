import type { Express, Request } from "express";
import * as crypto from "crypto";
import { getWebhookSecret } from "../utils/webhookSecret";
import { requireCapability, requireMutatingStaff } from "./_helpers";
import { getDatabaseName, getAllTypes } from "../content-types";
import { databaseManager } from "../database";
import { clearMarkdownCache } from "../markdown";
import { invalidateContentCaches } from "./_helpers";
import { getTrackingSettings } from "../settings";
import { getDefaultContentRoot } from "../site-config";
import { buildLeadPayload } from "../utils/buildLeadPayload";
import { recordLeadSubmissionWithMeta } from "../ads/lead-ledger";
import {
  applyAttemptResult,
  classifyLeadDelivery,
  createLeadOutboxEntry,
  deliverLeadWebhook,
  recordLeadNotSent,
  resolveSettingsLeadWebhook,
  urlHostOf,
  type LeadDeliveryResult,
  type LeadWebhookTarget,
} from "../ads/lead-outbox";
import { z } from "zod";
import { child } from "../logger";
const log = child({ module: "routes/webhooks" });



function buildBaseUrlFromRequest(req: Request): string {
  const host = req.get("x-forwarded-host") || req.get("host") || "localhost:5000";
  const proto = req.get("x-forwarded-proto") || req.protocol || "https";
  return `${proto}://${host}`;
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) {
    crypto.timingSafeEqual(Buffer.from(a), Buffer.from(a));
    return false;
  }
  try {
    return crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));
  } catch {
    return false;
  }
}

const conversionWebhookBodySchema = z.object({
  url: z.string().url(),
  method: z.enum(["POST", "GET"]).default("POST"),
  auth_header: z.string().optional(),
  payload: z.record(z.unknown()),
});

import { isPrivateDestination } from "../../shared/ssrf";
import { sanitizeWebhookHeaders } from "../../shared/webhookHeaders";
export { isPrivateDestination };

/** Visitor-facing 502 body for a failed delivery (same wording as before the lead outbox). */
function deliveryErrorBody(result: LeadDeliveryResult): { error: string; details?: string } {
  switch (result.errorKind) {
    case "blocked_private_url":
      return { error: "Webhook destination is not allowed (private or internal address)" };
    case "non_2xx":
      return { error: "Upstream webhook returned a non-2xx response", details: (result.responseBody ?? "").slice(0, 500) };
    case "timeout":
      return { error: "Webhook upstream timed out", ...(result.errorMessage ? { details: result.errorMessage } : {}) };
    default:
      return { error: "Failed to deliver webhook", ...(result.errorMessage ? { details: result.errorMessage } : {}) };
  }
}

function logDeliveryFailure(result: LeadDeliveryResult, submissionId: string | null): void {
  if (result.errorKind === "blocked_private_url") {
    log.warn({ submission_id: submissionId }, "[LeadWebhookDelivery] Blocked private/internal destination");
    return;
  }
  // Response only: field name + validator message. Not the lead payload.
  log.error(
    {
      submission_id: submissionId,
      status: result.status,
      error_kind: result.errorKind,
      upstream: (result.responseBody ?? "").slice(0, 500),
      detail: result.errorMessage,
    },
    "Lead webhook delivery error",
  );
}

export function registerWebhooksRoutes(app: Express): void {
  /**
   * POST /api/conversion-webhook
   * Server-side proxy that fires a conversion webhook to avoid CORS issues with
   * third-party destinations (Zapier, Make, CRMs, etc.).
   * Body: { url, method, payload }
   * Returns 200 on upstream success, 502 on upstream failure or network error.
   * Callers should treat failures as non-blocking — the form success flow must
   * not depend on this endpoint.
   */
  app.post("/api/conversion-webhook", async (req, res) => {
    const parsed = conversionWebhookBodySchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Invalid request body", details: parsed.error.issues });
      return;
    }

    const { url, method, auth_header, payload } = parsed.data;

    // SSRF protection: block private/internal network destinations
    if (isPrivateDestination(url)) {
      log.warn(`[ConversionWebhook] Blocked private/internal destination: ${url}`);
      res.status(400).json({ error: "Webhook destination is not allowed (private or internal address)" });
      return;
    }

    try {
      let fetchUrl = url;
      const fetchOptions: RequestInit = { method };

      if (method === "POST") {
        fetchOptions.headers = {
          "Content-Type": "application/json",
          ...(auth_header ? { Authorization: auth_header } : {}),
        };
        fetchOptions.body = JSON.stringify(payload);
      } else {
        // GET: serialize payload as query params so conversion fields are delivered
        const params = new URLSearchParams();
        for (const [key, value] of Object.entries(payload)) {
          if (value !== undefined && value !== null) {
            params.set(key, String(value));
          }
        }
        const sep = url.includes("?") ? "&" : "?";
        fetchUrl = `${url}${sep}${params.toString()}`;
        if (auth_header) {
          fetchOptions.headers = { Authorization: auth_header };
        }
      }

      const response = await fetch(fetchUrl, fetchOptions);
      log.info(`[ConversionWebhook] Delivered to ${url} — status ${response.status}`);

      if (!response.ok) {
        const body = await response.text().catch(() => "");
        log.warn(`[ConversionWebhook] Upstream returned ${response.status}: ${body.slice(0, 200)}`);
        res.status(502).json({
          error: "Upstream webhook returned a non-2xx response",
          upstream_status: response.status,
          upstream_body: body.slice(0, 500),
        });
        return;
      }

      res.json({ success: true, status: response.status });
    } catch (err) {
      log.error({ err: err }, "[ConversionWebhook] Failed to deliver webhook:");
      res.status(502).json({ error: "Failed to deliver webhook", details: String(err) });
    }
  });
  /**
   * POST /api/leads/webhook-delivery
   * The only lead submission path.
   * Body: { payload, webhook?: { url, method, headers?, fail_silently? } }
   *   - When `webhook` is omitted → reads URL/method/headers from global
   *     settings server-side (credentials never leave the server).
   *   - When `webhook.url` is supplied → uses that URL/method/headers (client may
   *     resolve {{ visitor.* }} / {{ entry.* }} templates before POST).
   *   - Lead outbox (LEAD_OUTBOX_ENCRYPTION_KEY set): the lead is saved encrypted before
   *     attempt 1. Then 2xx → 200 { delivered }; outage or config problem → 200 { queued }
   *     (retried / staff fix it); 400 / 422 → 502 with details so the visitor can fix the field.
   *   - Without the outbox: network / non-2xx / timeout / private URL → 502.
   *   - fail_silently (form or settings): respond 200 right away; the attempt still runs and is recorded.
   */
  app.post("/api/leads/webhook-delivery", async (req, res) => {
    const body = req.body;
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      res.status(400).json({ error: "Request body must be an object." });
      return;
    }

    const incoming = body.payload;
    if (!incoming || typeof incoming !== "object" || Array.isArray(incoming)) {
      res.status(400).json({ error: "Request body must include a payload object." });
      return;
    }
    if (!(incoming as Record<string, unknown>).email) {
      res.status(400).json({ error: "Email is required" });
      return;
    }

    const recorded = await recordLeadSubmissionWithMeta(req, res, incoming as Record<string, unknown>);
    const payload = buildLeadPayload(recorded.body);
    const lead = recorded.lead;
    const siteInfo = res.locals.site as { contentRoot?: string; contentRootName?: string } | undefined;
    const site = siteInfo?.contentRootName;
    const contentRoot = siteInfo?.contentRoot ?? getDefaultContentRoot();

    const override = body.webhook as {
      url?: string;
      method?: string;
      headers?: Record<string, string>;
      fail_silently?: boolean;
    } | undefined;

    let target: LeadWebhookTarget | null;
    if (override?.url && typeof override.url === "string" && override.url.trim()) {
      target = {
        url: override.url.trim(),
        method: override.method === "GET" ? "GET" : "POST",
        headers: sanitizeWebhookHeaders(override.headers),
        failSilently: override.fail_silently === true,
        source: "form",
      };
    } else {
      // Routing key as before: buildLeadPayload drops conversion_name, so this matches today's routing.
      target = resolveSettingsLeadWebhook(contentRoot, payload.conversion_name);
    }

    if (!target) {
      if (site && lead) {
        try {
          recordLeadNotSent(site, { submissionId: lead.submission_id, browserHash: lead.browser_hash, form: lead.form, isTest: lead.is_test });
        } catch (err) {
          log.warn({ err }, "[LeadWebhookDelivery] could not record not-sent lead");
        }
      }
      res.json({ success: true, skipped: "no_webhook" });
      return;
    }

    let saved = false;
    if (site && lead) {
      try {
        saved = createLeadOutboxEntry(site, {
          submissionId: lead.submission_id,
          copy: {
            v: 1,
            payload,
            routing_conversion_name: typeof payload.conversion_name === "string" ? payload.conversion_name : null,
            target: target.source === "form" ? { url: target.url, method: target.method, headers: target.headers } : null,
          },
          target,
          browserHash: lead.browser_hash,
          form: lead.form,
          isTest: lead.is_test,
        });
      } catch (err) {
        log.error({ err, submission_id: lead.submission_id }, "[LeadWebhookDelivery] could not save lead for recovery");
      }
    }

    if (target.failSilently) {
      res.json({ success: true, ...(saved ? { queued: true } : {}) });
    }

    const startedAt = Date.now();
    const result = await deliverLeadWebhook({
      url: target.url,
      method: target.method,
      headers: target.headers,
      payload,
      idempotencyKey: lead?.submission_id ?? null,
    });
    if (saved && site && lead) {
      try {
        applyAttemptResult(site, lead.submission_id, result, { urlHost: urlHostOf(target.url), trigger: "submit", startedAt });
      } catch (err) {
        log.error({ err, submission_id: lead.submission_id }, "[LeadWebhookDelivery] could not record attempt");
      }
    }
    if (!result.ok) logDeliveryFailure(result, lead?.submission_id ?? null);
    else log.info(`[LeadWebhookDelivery] Delivered to ${urlHostOf(target.url)} — status ${result.status}`);

    if (target.failSilently) return;
    if (result.ok) {
      res.json({ success: true, status: result.status, delivered: true });
      return;
    }
    if (saved && classifyLeadDelivery(result) !== "rejected_data") {
      res.json({ success: true, queued: true });
      return;
    }
    res.status(502).json(deliveryErrorBody(result));
  });

  /**
   * POST /api/tracking/webhook/test
   * Fires a test request with the provided payload to the globally configured
   * webhook URL. Reads the webhook config (url, method, headers) from
   * settings.yml so the frontend doesn't need to pass credentials.
   * Body: { payload: Record<string, unknown> }
   * Returns: { ok: boolean, status: number, error?: string }
   */
  app.post("/api/tracking/webhook/test", async (req, res) => {
    try {
      const auth = await requireMutatingStaff(req, res);
      if (!auth.authorized) return;

      const tracking = getTrackingSettings();
      const webhook = tracking.webhook;
      const envUrl = process.env.DEFAULT_WEBHOOK_URL;

      if (!webhook?.url && !envUrl) {
        res.status(400).json({ ok: false, error: "No global webhook URL configured." });
        return;
      }

      const incoming = req.body?.payload;
      if (!incoming || typeof incoming !== "object" || Array.isArray(incoming)) {
        res.status(400).json({ ok: false, error: "Request body must include a payload object." });
        return;
      }

      const payload = buildLeadPayload(incoming as Record<string, unknown>);

      const url = webhook?.url || envUrl!;
      const method =
        webhook?.method || (webhook?.url ? "POST" : process.env.DEFAULT_WEBHOOK_METHOD || "POST");
      const headers = sanitizeWebhookHeaders(webhook?.url ? webhook.headers : undefined);

      if (isPrivateDestination(url)) {
        res.status(400).json({
          ok: false,
          error: "Webhook destination is not allowed (private or internal address)",
        });
        return;
      }

      const result = await deliverLeadWebhook({
        url,
        method: method === "GET" ? "GET" : "POST",
        headers,
        payload,
      });
      if (!result.ok) {
        logDeliveryFailure(result, null);
        const body = deliveryErrorBody(result);
        res.json({ ok: false, status: 502, error: body.details || body.error });
        return;
      }
      log.info(`[WebhookTest] Delivered to ${url} — status ${result.status}`);
      res.json({ ok: true, status: result.status });
    } catch (err) {
      res.status(500).json({ ok: false, error: String(err) });
    }
  });

  app.post("/api/webhooks/clear-cache", async (req, res) => {
    try {
      const secret = getWebhookSecret();
      if (!secret) {
        res.status(503).json({ error: "WEBHOOK_SECRET is not configured on this server." });
        return;
      }

      const token = req.query.token as string | undefined;
      if (!token || !timingSafeEqual(token, secret)) {
        res.status(401).json({ error: "Invalid or missing token." });
        return;
      }

      const type = req.query.type as string | undefined;

      if (type && type !== "blog") {
        const dbName = getDatabaseName(type);
        if (dbName && databaseManager.exists(dbName)) {
          await databaseManager.fetchItems(dbName, true).catch(() => {});
        }
        invalidateContentCaches(type);
        clearMarkdownCache();
        res.json({ success: true, message: `Cache cleared for content type "${type}".` });
        return;
      }

      if (type === "blog") {
        const dbName = getDatabaseName("blog");
        if (dbName && databaseManager.exists(dbName)) {
          await databaseManager.fetchItems(dbName, true).catch(() => {});
        }
        clearMarkdownCache();
        res.json({ success: true, message: "Blog cache cleared." });
        return;
      }

      const allTypes = getAllTypes();
      await Promise.all(
        allTypes.map(async (t) => {
          const dbName = getDatabaseName(t);
          if (dbName && databaseManager.exists(dbName)) {
            await databaseManager.fetchItems(dbName, true).catch(() => {});
          }
        })
      );
      invalidateContentCaches();
      clearMarkdownCache();
      res.json({ success: true, message: "All content caches cleared." });
    } catch (err) {
      res.status(500).json({ error: String(err) });
    }
  });

  app.get("/api/webhooks/clear-cache/url", async (req, res) => {
    try {
      const auth = await requireCapability(req, res, "content_edit");
      if (!auth.authorized) return;

      const secret = getWebhookSecret();
      if (!secret) {
        res.json({ configured: false });
        return;
      }

      const base = buildBaseUrlFromRequest(req);
      const url = `${base}/api/webhooks/clear-cache?token=${encodeURIComponent(secret)}`;
      res.json({ configured: true, url });
    } catch (err) {
      res.status(500).json({ error: String(err) });
    }
  });
}
