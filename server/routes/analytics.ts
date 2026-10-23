/**
 * Staff / MCP analytics reports from GA4 BigQuery export.
 */

import type { Express } from "express";
import { z } from "zod";
import { api } from "../rate-limit/api";
import { child } from "../logger";
import {
  ANALYTICS_ATTRIBUTIONS,
  ANALYTICS_REPORTS,
  AnalyticsReportValidationError,
  getAnalyticsReport,
  type AnalyticsAttribution,
  type AnalyticsReportName,
} from "../analytics/reports";

const log = child({ module: "routes/analytics" });

const pageStatsSchema = z.object({
  path: z.string().trim().min(1).max(500),
  scope: z.enum(["url", "entry"]).default("url"),
  refresh: z.enum(["0", "1"]).optional(),
});

type SiteLocals = { contentRoot?: string; contentRootName?: string; contentIndex?: import("../content-index").ContentIndex };

const reportSchema = z.object({
  report: z.enum(ANALYTICS_REPORTS as unknown as [AnalyticsReportName, ...AnalyticsReportName[]]),
  days: z.coerce.number().int().min(1).max(90).optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
  path: z.string().optional(),
  content_type: z.string().optional(),
  slug: z.string().optional(),
  locale: z.string().optional(),
  event_names: z.string().optional(),
  attribution: z
    .enum(ANALYTICS_ATTRIBUTIONS as unknown as [AnalyticsAttribution, ...AnalyticsAttribution[]])
    .optional(),
  item_id: z.string().optional(),
});

export function registerAnalyticsRoutes(app: Express): void {
  api.get(app, "/api/analytics/report", { rate: "publicRead" }, async (req, res) => {
    const { requireCapability } = await import("./_helpers");
    const auth = await requireCapability(req, res, "metrics_view");
    if (!auth.authorized) return;

    const parsed = reportSchema.safeParse({
      report: req.query.report,
      days: req.query.days,
      limit: req.query.limit,
      path: req.query.path,
      content_type: req.query.content_type,
      slug: req.query.slug,
      locale: req.query.locale,
      event_names: req.query.event_names,
      attribution: req.query.attribution,
      item_id: req.query.item_id,
    });
    if (!parsed.success) {
      return res.status(400).json({
        error: "Invalid query",
        details: parsed.error.flatten(),
      });
    }

    const {
      report,
      days,
      limit,
      path,
      content_type,
      slug,
      locale,
      event_names,
      attribution,
      item_id,
    } = parsed.data;
    const eventList = event_names
      ? event_names
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean)
      : undefined;

    try {
      const result = await getAnalyticsReport({
        report,
        days,
        limit,
        path,
        content_type,
        slug,
        locale,
        event_names: eventList,
        attribution,
        item_id,
      });
      res.json(result);
    } catch (err) {
      if (err instanceof AnalyticsReportValidationError) {
        return res.status(400).json({ error: err.message });
      }
      log.error({ err }, "[AnalyticsRoutes] GET /api/analytics/report");
      res.status(500).json({ error: "Internal server error" });
    }
  });

  api.get(app, "/api/analytics/page-stats", { rate: "publicRead" }, async (req, res) => {
    const { requireCapability } = await import("./_helpers");
    const auth = await requireCapability(req, res, "metrics_view");
    if (!auth.authorized) return;
    const parsed = pageStatsSchema.safeParse({ path: req.query.path, scope: req.query.scope, refresh: req.query.refresh });
    if (!parsed.success) {
      return res.status(400).json({ error: "Invalid query", details: parsed.error.flatten() });
    }
    const site = res.locals.site as SiteLocals | undefined;
    const { getDefaultContentFolder } = await import("../site-config");
    const { contentIndex } = await import("../content-index");
    const { getPageStats, PageStatsNotFoundError } = await import("../analytics/page-stats");
    try {
      const report = await getPageStats({
        site: site?.contentRootName ?? getDefaultContentFolder(),
        contentRoot: site?.contentRoot,
        ci: site?.contentIndex ?? contentIndex,
        path: parsed.data.path,
        scope: parsed.data.scope,
        refresh: parsed.data.refresh === "1",
      });
      res.json(report);
    } catch (err) {
      if (err instanceof PageStatsNotFoundError) return res.status(400).json({ error: err.message });
      log.error({ err }, "[AnalyticsRoutes] GET /api/analytics/page-stats");
      res.status(500).json({ error: "Internal server error" });
    }
  });

  api.get(app, "/api/analytics/page-stats/benchmarks", { rate: "publicRead" }, async (req, res) => {
    const { requireAnyCapability } = await import("./_helpers");
    const auth = await requireAnyCapability(req, res, ["metrics_view", "seo_settings", "ads_settings"]);
    if (!auth.authorized) return;
    const site = res.locals.site as SiteLocals | undefined;
    const { getDefaultContentFolder } = await import("../site-config");
    const { readStageBenchmarks } = await import("../analytics/page-stats/benchmarks");
    res.json(readStageBenchmarks(site?.contentRootName ?? getDefaultContentFolder()));
  });
}
