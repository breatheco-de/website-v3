/**
 * Product / persona tracking (staff):
 *   GET  /api/settings/tracking/product-tracking        switch status + missing keys
 *   GET  /api/settings/tracking/short-keys.csv          code → name list (current + retired)
 *   GET  /api/settings/tracking/ga4-dimensions          which GA4 custom dimensions exist
 *   POST /api/settings/tracking/ga4-dimensions          create the missing ones
 */

import type { Express, Response } from "express";
import { api } from "../rate-limit/api";
import { requireCapability, requireMutatingStaff } from "./_helpers";
import { getDefaultContentRoot } from "../site-config";
import { loadTrackingKeyIndex, siteIdForContentRoot } from "../product/tracking-key-index";
import { getTrackingReadiness } from "../product/tracking-readiness";
import {
  TRACKING_GA4_DIMENSIONS,
  checkGa4Dimensions,
  createGa4Dimensions,
} from "../ab-testing/ga4-dimensions";
import type { TrackingKeyIndex } from "@shared/tracking-keys";

function contentRootOf(res: Response): string {
  return (res.locals.site as { contentRoot?: string } | undefined)?.contentRoot ?? getDefaultContentRoot();
}

function csvCell(v: string): string {
  return /[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
}

/** One row per product / persona key, current and retired. */
export function trackingKeysCsv(site: string, index: TrackingKeyIndex): string {
  const rows: string[][] = [["site", "code", "type", "id", "name", "product", "status"]];
  for (const p of index.products) {
    if (p.key) rows.push([site, p.key, "product", p.slug, p.name, p.slug, p.active ? "current" : "current (not sellable)"]);
    for (const persona of p.personas) {
      if (persona.key) rows.push([site, persona.key, "persona", persona.id, persona.name, p.slug, "current"]);
    }
    for (const r of p.retired) {
      rows.push([site, r.key, r.type, r.id, r.name ?? "", p.slug, `retired ${r.retired_at.slice(0, 10)}`.trim()]);
    }
  }
  return `${rows.map((r) => r.map(csvCell).join(",")).join("\n")}\n`;
}

export function registerTrackingKeyRoutes(app: Express): void {
  api.get(
    app,
    "/api/settings/tracking/product-tracking",
    { rate: "exempt", reason: "staff settings read, capability-gated" },
    async (req, res) => {
      const auth = await requireCapability(req, res, "metrics_view");
      if (!auth.authorized) return;
      const root = contentRootOf(res);
      const readiness = getTrackingReadiness(root);
      const index = loadTrackingKeyIndex(root);
      res.json({
        ...readiness,
        products: index.products.length,
        personas: index.products.reduce((n, p) => n + p.personas.length, 0),
      });
    },
  );

  api.get(
    app,
    "/api/settings/tracking/short-keys.csv",
    { rate: "exempt", reason: "staff download, capability-gated" },
    async (req, res) => {
      const auth = await requireCapability(req, res, "metrics_view");
      if (!auth.authorized) return;
      const root = contentRootOf(res);
      const site = siteIdForContentRoot(root);
      res.setHeader("Content-Type", "text/csv; charset=utf-8");
      res.setHeader("Content-Disposition", `attachment; filename="${site}-tracking-keys.csv"`);
      res.send(trackingKeysCsv(site, loadTrackingKeyIndex(root, { fresh: true })));
    },
  );

  api.get(
    app,
    "/api/settings/tracking/ga4-dimensions",
    { rate: "exempt", reason: "staff settings read, capability-gated" },
    async (req, res) => {
      const auth = await requireCapability(req, res, "metrics_view");
      if (!auth.authorized) return;
      res.json(await checkGa4Dimensions(contentRootOf(res), undefined, TRACKING_GA4_DIMENSIONS));
    },
  );

  api.post(app, "/api/settings/tracking/ga4-dimensions", { rate: "staffWrite" }, async (req, res) => {
    const auth = await requireMutatingStaff(req, res);
    if (!auth.authorized) return;
    const result = await createGa4Dimensions(contentRootOf(res), undefined, TRACKING_GA4_DIMENSIONS);
    res.status(result.ok ? 200 : 400).json(result);
  });
}
