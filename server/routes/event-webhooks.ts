import type { Express, Request, Response } from "express";
import { api } from "../rate-limit/api";
import { requireAnyCapability } from "./_helpers";
import type { SiteContext } from "../site-manager";
import { markFileAsModified } from "../sync-state";
import {
  EVENT_WEBHOOK_ALLOWLIST,
  EVENT_WEBHOOK_DELIVERY_RETENTION_MS,
  EVENT_WEBHOOK_FILE,
  filterKeysForEventType,
  buildWebhookBody,
  clearHookBuffer,
  computeDroppedBuffersOnSave,
  deliverEventWebhookHttp,
  enqueueHookDelivery,
  findHook,
  flushHookIfDue,
  getAllPendingCounts,
  getDeliveryById,
  getHookBuffer,
  listDeliveries,
  loadEventWebhookConfig,
  loadEventWebhookConfigSafe,
  loadEventsForDelivery,
  parseEventWebhookConfig,
  previewDeliveryPayload,
  recordDelivery,
  redactEventWebhookConfigForStaff,
  saveEventWebhookConfig,
  type EventWebhookConfig,
  type EventWebhookHook,
} from "../events/event-webhooks";
import { child } from "../logger";
import { EventWebhookHeaderSecretError } from "../events/event-webhook-header-secrets";

const log = child({ module: "routes/event-webhooks" });

function respondWebhookSaveError(res: Response, err: unknown): void {
  const message = err instanceof Error ? err.message : String(err);
  if (err instanceof EventWebhookHeaderSecretError) {
    res.status(400).json({ error: message });
    return;
  }
  log.error({ err }, "[EventWebhooks] Failed to save config");
  res.status(500).json({ error: message });
}

function actorUsername(auth: { username: string | null; author: string | null }): string {
  return (auth.username || auth.author || "dev").trim() || "dev";
}

async function requireWebhookStaff(req: Request, res: Response) {
  const auth = await requireAnyCapability(req, res, ["content_edit_text", "seo_edit"]);
  if (!auth.authorized) return null;
  return { ...auth, actor: actorUsername(auth) };
}

function siteCtx(res: Response): SiteContext | null {
  const site = res.locals.site as SiteContext | undefined;
  if (!site) {
    res.status(500).json({ error: "Site context missing" });
    return null;
  }
  return site;
}

function filterKeysByType(): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const type of EVENT_WEBHOOK_ALLOWLIST) {
    out[type] = [...filterKeysForEventType(type)];
  }
  return out;
}

function summarizeConfig(site: string, contentRoot: string) {
  let config: EventWebhookConfig;
  try {
    config = loadEventWebhookConfig(contentRoot);
  } catch (err) {
    return {
      error: err instanceof Error ? err.message : String(err),
      config: { version: 1 as const, subscriptions: {} },
      pending: {},
      allowlist: [...EVENT_WEBHOOK_ALLOWLIST],
      filter_keys: filterKeysByType(),
      enabled_hook_count: 0,
      last_delivery: null as ReturnType<typeof listDeliveries>[number] | null,
      site,
    };
  }
  const pending = getAllPendingCounts(site);
  let enabled = 0;
  for (const type of EVENT_WEBHOOK_ALLOWLIST) {
    for (const h of config.subscriptions[type] ?? []) {
      if (h.enabled && h.url) enabled += 1;
    }
  }
  const deliveries = listDeliveries(site, { limit: 1 });
  return {
    config: redactEventWebhookConfigForStaff(config),
    pending,
    allowlist: [...EVENT_WEBHOOK_ALLOWLIST],
    filter_keys: filterKeysByType(),
    enabled_hook_count: enabled,
    last_delivery: deliveries[0] ?? null,
    file: EVENT_WEBHOOK_FILE,
    site,
  };
}

export function registerEventWebhookRoutes(app: Express): void {
  api.get(app, "/api/admin/event-webhooks", { rate: "staffWrite" }, async (req, res) => {
    const auth = await requireWebhookStaff(req, res);
    if (!auth) return;
    const site = siteCtx(res);
    if (!site) return;
    res.json(summarizeConfig(site.contentRootName, site.contentRoot));
  });

  api.put(app, "/api/admin/event-webhooks", { rate: "staffWrite" }, async (req, res) => {
    const auth = await requireWebhookStaff(req, res);
    if (!auth) return;
    const site = siteCtx(res);
    if (!site) return;

    let next: EventWebhookConfig;
    try {
      next = parseEventWebhookConfig(req.body?.config ?? req.body);
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : String(err) });
      return;
    }

    const before = loadEventWebhookConfigSafe(site.contentRoot);
    const dropped = computeDroppedBuffersOnSave(site.contentRootName, before, next);

    try {
      saveEventWebhookConfig(site.contentRoot, next);
      markFileAsModified(EVENT_WEBHOOK_FILE, auth.actor, undefined, site.contentRoot);
    } catch (err) {
      respondWebhookSaveError(res, err);
      return;
    }

    // Re-check waiting piles under new timing (edge 1a): flush if now due / immediate.
    for (const type of EVENT_WEBHOOK_ALLOWLIST) {
      for (const hook of next.subscriptions[type] ?? []) {
        if (!hook.enabled || !hook.url) continue;
        const prev = findHook(before, type, hook.id);
        if (prev && prev.url === hook.url && prev.enabled === hook.enabled) {
          await flushHookIfDue({
            site: site.contentRootName,
            eventType: type,
            hook,
          });
        }
      }
    }

    res.json({
      ...summarizeConfig(site.contentRootName, site.contentRoot),
      dropped_pending: dropped,
      dropped_pending_count: dropped.reduce((s, d) => s + d.dropped, 0),
    });
  });

  api.delete(
    app,
    "/api/admin/event-webhooks/:eventType/:hookId",
    { rate: "staffWrite" },
    async (req, res) => {
      const auth = await requireWebhookStaff(req, res);
      if (!auth) return;
      const site = siteCtx(res);
      if (!site) return;
      const eventType = String(req.params.eventType ?? "");
      const hookId = String(req.params.hookId ?? "");
      const before = loadEventWebhookConfigSafe(site.contentRoot);
      const hook = findHook(before, eventType, hookId);
      if (!hook) {
        res.status(404).json({ error: "Hook not found" });
        return;
      }
      const dropped = clearHookBuffer(site.contentRootName, eventType, hookId);
      const next: EventWebhookConfig = {
        version: 1,
        subscriptions: { ...before.subscriptions },
      };
      const list = [...(next.subscriptions[eventType as keyof typeof next.subscriptions] ?? [])].filter(
        (h) => h.id !== hookId,
      );
      if (list.length === 0) {
        delete next.subscriptions[eventType as keyof typeof next.subscriptions];
      } else {
        (next.subscriptions as Record<string, EventWebhookHook[]>)[eventType] = list;
      }
      try {
        saveEventWebhookConfig(site.contentRoot, next);
        markFileAsModified(EVENT_WEBHOOK_FILE, auth.actor, undefined, site.contentRoot);
      } catch (err) {
        respondWebhookSaveError(res, err);
        return;
      }
      res.json({
        ...summarizeConfig(site.contentRootName, site.contentRoot),
        dropped_pending_count: dropped,
      });
    },
  );

  api.post(
    app,
    "/api/admin/event-webhooks/:eventType/:hookId/test",
    { rate: "staffWrite" },
    async (req, res) => {
      const auth = await requireWebhookStaff(req, res);
      if (!auth) return;
      const site = siteCtx(res);
      if (!site) return;
      const eventType = String(req.params.eventType ?? "");
      const hookId = String(req.params.hookId ?? "");
      const config = loadEventWebhookConfigSafe(site.contentRoot);
      const hook = findHook(config, eventType, hookId);
      if (!hook?.url) {
        res.status(400).json({ error: "Hook missing or has no url" });
        return;
      }
      const body = buildWebhookBody({
        site: site.contentRootName,
        eventType,
        hook,
        events: [],
        source: "test",
      });
      (body as { test?: boolean }).test = true;
      (body as { message?: string }).message = "Event webhook test delivery";
      const result = await deliverEventWebhookHttp({
        url: hook.url,
        headers: hook.headers,
        body,
      });
      const deliveryId = recordDelivery({
        site: site.contentRootName,
        eventType,
        hookId,
        eventIds: [],
        url: hook.url,
        status: result.ok ? "success" : "failure",
        httpStatus: result.ok ? result.status : result.status,
        error: result.ok ? null : result.error,
        durationMs: result.durationMs,
        source: "test",
      });
      // Test must not advance live buffers
      void getHookBuffer(site.contentRootName, eventType, hookId);
      if (!result.ok) {
        res.status(502).json({
          ok: false,
          error: result.error,
          delivery_id: deliveryId,
          status: result.status,
        });
        return;
      }
      res.json({ ok: true, delivery_id: deliveryId, status: result.status });
    },
  );

  api.get(app, "/api/admin/event-webhooks/deliveries", { rate: "staffWrite" }, async (req, res) => {
    const auth = await requireWebhookStaff(req, res);
    if (!auth) return;
    const site = siteCtx(res);
    if (!site) return;

    const retentionFloor = Date.now() - EVENT_WEBHOOK_DELIVERY_RETENTION_MS;
    const retentionCeil = Date.now();

    const parseIsoMs = (raw: unknown): number | undefined => {
      if (typeof raw !== "string" || !raw.trim()) return undefined;
      const ms = Date.parse(raw.trim());
      return Number.isFinite(ms) ? ms : undefined;
    };

    const fromRaw = parseIsoMs(req.query.from);
    const toRaw = parseIsoMs(req.query.to);
    const hoursRaw = Number(req.query.hours ?? 48);
    const hours = Number.isFinite(hoursRaw) ? Math.min(Math.max(hoursRaw, 1), 48) : 48;

    let sinceMs =
      fromRaw !== undefined ? fromRaw : Date.now() - hours * 60 * 60 * 1000;
    let untilMs = toRaw;

    sinceMs = Math.max(sinceMs, retentionFloor);
    if (untilMs !== undefined) {
      untilMs = Math.min(Math.max(untilMs, retentionFloor), retentionCeil);
    }
    if (untilMs !== undefined && untilMs < sinceMs) {
      untilMs = sinceMs;
    }

    const typeParam =
      typeof req.query.type === "string" && req.query.type.trim()
        ? req.query.type.trim()
        : typeof req.query.eventType === "string" && req.query.eventType.trim()
          ? req.query.eventType.trim()
          : undefined;
    const hookId =
      typeof req.query.hook === "string" && req.query.hook.trim()
        ? req.query.hook.trim()
        : undefined;
    const statusRaw =
      typeof req.query.status === "string" ? req.query.status.trim() : "";
    const status =
      statusRaw === "success" || statusRaw === "failure" || statusRaw === "skipped"
        ? statusRaw
        : undefined;
    const order =
      typeof req.query.order === "string" && req.query.order.trim().toLowerCase() === "asc"
        ? ("asc" as const)
        : ("desc" as const);

    const deliveries = listDeliveries(site.contentRootName, {
      sinceMs,
      untilMs,
      eventType: typeParam,
      hookId,
      status,
      order,
      limit: 300,
    });
    res.json({
      deliveries,
      since_ms: sinceMs,
      until_ms: untilMs ?? null,
      order,
    });
  });

  api.get(
    app,
    "/api/admin/event-webhooks/deliveries/:id/preview",
    { rate: "staffWrite" },
    async (req, res) => {
      const auth = await requireWebhookStaff(req, res);
      if (!auth) return;
      const site = siteCtx(res);
      if (!site) return;
      const id = Number(req.params.id);
      if (!Number.isInteger(id) || id <= 0) {
        res.status(400).json({ error: "invalid delivery id" });
        return;
      }
      const preview = previewDeliveryPayload(site.contentRootName, site.contentRoot, id);
      if (!preview) {
        res.status(404).json({ error: "delivery not found" });
        return;
      }
      res.json(preview);
    },
  );

  api.post(
    app,
    "/api/admin/event-webhooks/deliveries/retry",
    { rate: "staffWrite" },
    async (req, res) => {
      const auth = await requireWebhookStaff(req, res);
      if (!auth) return;
      const site = siteCtx(res);
      if (!site) return;
      const idsRaw = req.body?.deliveryIds;
      if (!Array.isArray(idsRaw) || idsRaw.length === 0) {
        res.status(400).json({ error: "deliveryIds array required" });
        return;
      }
      const deliveryIds = idsRaw
        .map((n: unknown) => Number(n))
        .filter((n: number) => Number.isInteger(n) && n > 0);
      const config = loadEventWebhookConfigSafe(site.contentRoot);
      const results: Array<{
        delivery_id: number;
        ok: boolean;
        reason?: string;
      }> = [];

      for (const id of deliveryIds) {
        const row = getDeliveryById(site.contentRootName, id);
        if (!row) {
          results.push({ delivery_id: id, ok: false, reason: "delivery not found" });
          continue;
        }
        if (row.status !== "failure") {
          results.push({ delivery_id: id, ok: false, reason: "only failures can be retried" });
          continue;
        }
        if (row.source === "test") {
          results.push({ delivery_id: id, ok: false, reason: "test deliveries cannot be retried" });
          continue;
        }
        const hook = findHook(config, row.event_type, row.hook_id);
        if (!hook?.enabled || !hook.url) {
          results.push({
            delivery_id: id,
            ok: false,
            reason: "hook missing, disabled, or has no url",
          });
          continue;
        }
        const events = loadEventsForDelivery(site.contentRootName, row.event_ids);
        if (events.length === 0) {
          results.push({ delivery_id: id, ok: false, reason: "events no longer available" });
          continue;
        }
        await enqueueHookDelivery({
          site: site.contentRootName,
          eventType: row.event_type,
          hook,
          eventIds: row.event_ids,
          source: "retry",
        });
        results.push({ delivery_id: id, ok: true });
      }

      res.json({
        results,
        retried: results.filter((r) => r.ok).length,
        skipped: results.filter((r) => !r.ok).length,
      });
    },
  );
}
