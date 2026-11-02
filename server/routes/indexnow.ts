import type { Express, Response } from "express";
import { z } from "zod";
import { api } from "../rate-limit/api";
import { getDefaultContentFolder, getDefaultContentRoot } from "../site-config";
import { markFileAsModified } from "../sync-state";
import { getIndexNowStatus } from "../indexnow";
import {
  confirmHeldRemovals,
  listPublicUrlChangesForStaff,
  requestSubmitAll,
  saveIndexNowSettingsForSite,
  testIndexNowConnection,
} from "../indexnow-service";
import { countState } from "../public-url-changes/store";
import { enqueuePublicUrlScan } from "../public-url-changes/trigger";
import { requireCapability, requireStaffSession } from "./_helpers";

function siteOf(res: Response): { site: string; contentRoot: string } {
  const s = res.locals.site as { contentRoot?: string; contentRootName?: string } | undefined;
  return {
    site: s?.contentRootName ?? getDefaultContentFolder(),
    contentRoot: s?.contentRoot ?? getDefaultContentRoot(),
  };
}

const settingsBody = z.object({
  enabled: z.boolean().optional(),
  key: z.string().optional(),
  generate_key: z.boolean().optional(),
});

export function registerIndexNowRoutes(app: Express): void {
  api.get(app, "/api/indexnow/status", { rate: "staffWrite" }, async (req, res) => {
    const auth = await requireStaffSession(req, res);
    if (!auth.authorized) return;
    const { site, contentRoot } = siteOf(res);
    try {
      res.json(getIndexNowStatus(site, contentRoot));
    } catch (err: any) {
      res.status(500).json({ error: err?.message || String(err) });
    }
  });

  api.post(app, "/api/settings/indexnow", { rate: "staffWrite" }, async (req, res) => {
    const auth = await requireCapability(req, res, "seo_settings");
    if (!auth.authorized) return;
    const parsed = settingsBody.safeParse(req.body ?? {});
    if (!parsed.success) {
      return res.status(400).json({ error: "Invalid request body", details: parsed.error.flatten() });
    }
    const { site, contentRoot } = siteOf(res);
    try {
      const result = await saveIndexNowSettingsForSite({
        site,
        contentRoot,
        input: { enabled: parsed.data.enabled, key: parsed.data.key, generateKey: parsed.data.generate_key },
      });
      markFileAsModified("settings.yml", auth.author ?? undefined, undefined, contentRoot);
      res.json({ success: true, settings: result.settings, warnings: result.warnings, status: getIndexNowStatus(site, contentRoot) });
    } catch (err: any) {
      res.status(400).json({ error: err?.message || String(err) });
    }
  });

  api.post(app, "/api/settings/indexnow/test", { rate: "staffWrite" }, async (req, res) => {
    const auth = await requireCapability(req, res, "seo_settings");
    if (!auth.authorized) return;
    const { site, contentRoot } = siteOf(res);
    try {
      const result = await testIndexNowConnection({ site, contentRoot });
      res.status(result.ok ? 200 : 400).json(result);
    } catch (err: any) {
      res.status(500).json({ ok: false, detail: err?.message || String(err) });
    }
  });

  api.post(app, "/api/indexnow/submit-all", { rate: "staffWrite" }, async (req, res) => {
    const auth = await requireCapability(req, res, "seo_settings");
    if (!auth.authorized) return;
    const { site, contentRoot } = siteOf(res);
    try {
      const result = await requestSubmitAll({ site, contentRoot, total: countState(site) });
      if (!result.queued) return res.status(409).json({ error: result.reason ?? "Could not queue", ...result });
      res.json({ success: true, ...result });
    } catch (err: any) {
      res.status(500).json({ error: err?.message || String(err) });
    }
  });

  api.get(app, "/api/public-url-changes", { rate: "staffWrite" }, async (req, res) => {
    const auth = await requireStaffSession(req, res);
    if (!auth.authorized) return;
    const { site } = siteOf(res);
    const limit = Number.parseInt(String(req.query.limit ?? "20"), 10);
    const path = typeof req.query.path === "string" ? req.query.path : undefined;
    try {
      res.json(listPublicUrlChangesForStaff({ site, limit: Number.isFinite(limit) ? limit : 20, path }));
    } catch (err: any) {
      res.status(500).json({ error: err?.message || String(err) });
    }
  });

  api.post(app, "/api/public-url-changes/confirm-removals", { rate: "staffWrite" }, async (req, res) => {
    const auth = await requireCapability(req, res, "seo_settings");
    if (!auth.authorized) return;
    const { site, contentRoot } = siteOf(res);
    try {
      if (!confirmHeldRemovals(site)) {
        return res.status(409).json({ error: "No removals are held" });
      }
      await enqueuePublicUrlScan(site, contentRoot, Date.now());
      res.json({ success: true });
    } catch (err: any) {
      res.status(500).json({ error: err?.message || String(err) });
    }
  });
}
