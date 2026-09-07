import type { Express, Request } from "express";
import * as crypto from "crypto";
import { getWebhookSecret } from "../utils/webhookSecret";
import { requireCapability, requireMutatingStaff } from "./_helpers";
import { getDatabaseName, getAllTypes } from "../content-types";
import { databaseManager } from "../database";
import { clearMarkdownCache } from "../markdown";
import { invalidateContentCaches } from "./_helpers";
import { getTrackingSettings } from "../settings";
import { buildLeadPayload } from "../utils/buildLeadPayload";
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

export { isPrivateDestination } from "../../shared/ssrf";

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
   * Primary lead submission path when any webhook level is configured.
   * Body: { payload, webhook?: { url, method } }
   *   - When `webhook` is omitted → reads URL/method/auth_header from global
   *     settings server-side (credentials never leave the server).
   *   - When `webhook.url` is supplied → uses that URL/method as-is; intended
   *     for per-form and per-event webhooks which have no auth credentials.
   * Always returns 200 — delivery failures are non-blocking so the form shows
   * success regardless of upstream response.
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

    const payload = buildLeadPayload(incoming as Record<string, unknown>);

    // Resolve webhook config: use supplied override or fall back to global settings
    const override = body.webhook as { url?: string; method?: string } | undefined;
    let url: string;
    let method: string;
    let auth_header: string | undefined;

    if (override?.url) {
      url = override.url;
      method = override.method || "POST";
      // Per-form / per-event webhooks have no auth credentials
    } else {
      const globalWebhook = getTrackingSettings().webhook;
      const envUrl = process.env.DEFAULT_WEBHOOK_URL;
      if (!globalWebhook?.url && !envUrl) {
        res.status(400).json({ error: "No webhook URL configured." });
        return;
      }
      if (globalWebhook?.url) {
        url = globalWebhook.url;
        method = globalWebhook.method || "POST";
        auth_header = globalWebhook.auth_header;
      } else {
        url = envUrl!;
        method = process.env.DEFAULT_WEBHOOK_METHOD || "POST";
      }
    }

    // Always respond 200 immediately — delivery is non-blocking
    res.json({ success: true });

    if (isPrivateDestination(url)) {
      log.warn(`[LeadWebhookDelivery] Blocked private/internal destination: ${url}`);
      return;
    }

    try {
      let fetchUrl = url;
      const fetchOptions: RequestInit = { method };
      const authHeaders: Record<string, string> = auth_header ? { Authorization: auth_header } : {};

      if (method === "POST") {
        fetchOptions.headers = { "Content-Type": "application/json", ...authHeaders };
        fetchOptions.body = JSON.stringify(payload);
      } else {
        fetchOptions.headers = authHeaders;
        const params = new URLSearchParams();
        for (const [key, value] of Object.entries(payload as Record<string, unknown>)) {
          if (value !== undefined && value !== null) {
            params.set(key, String(value));
          }
        }
        const sep = url.includes("?") ? "&" : "?";
        fetchUrl = `${url}${sep}${params.toString()}`;
      }

      const response = await fetch(fetchUrl, fetchOptions);
      log.info(`[LeadWebhookDelivery] Delivered to ${url} — status ${response.status}`);
    } catch (err) {
      log.error({ err: err }, "[LeadWebhookDelivery] Failed to deliver:");
    }
  });

  /**
   * POST /api/tracking/webhook/test
   * Fires a test request with the provided payload to the globally configured
   * webhook URL. Reads the webhook config (url, method, auth_header) from
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
      const method = webhook?.method || (webhook?.url ? "POST" : (process.env.DEFAULT_WEBHOOK_METHOD || "POST"));
      const auth_header = webhook?.url ? webhook.auth_header : undefined;

      if (isPrivateDestination(url)) {
        res.status(400).json({ ok: false, error: "Webhook destination is not allowed (private or internal address)" });
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
        const status = response.status;

        if (!response.ok) {
          const body = await response.text().catch(() => "");
          log.warn(`[WebhookTest] Upstream returned ${status}: ${body.slice(0, 200)}`);
          res.json({ ok: false, status, error: `Upstream returned ${status}: ${body.slice(0, 200)}` });
          return;
        }

        log.info(`[WebhookTest] Delivered to ${url} — status ${status}`);
        res.json({ ok: true, status });
      } catch (err) {
        log.error({ err: err }, "[WebhookTest] Failed to deliver:");
        res.json({ ok: false, status: 0, error: String(err) });
      }
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
