/**
 * Staff Sidequest diagnostics, recheck, restart, and log tail routes.
 */

import type { Express } from "express";
import { collectSystemAlerts } from "../system-alerts";
import { requireMutatingStaff, requireStaffSession } from "./_helpers";
import { collectSidequestDiagnostics, tailSidequestLog } from "../jobs/sidequest-diagnostics";
import { requestSidequestRestart } from "../jobs/sidequest-restart";
import { requireWorkerManage } from "../jobs/sidequest-auth";
import { child } from "../logger";

const log = child({ module: "sidequest-admin-routes" });

export function registerSidequestAdminRoutes(app: Express): void {
  app.get("/api/admin/sidequest/diagnostics", async (req, res) => {
    const auth = await requireStaffSession(req, res);
    if (!auth.authorized) return;

    const site = typeof req.query.site === "string" ? req.query.site : undefined;
    try {
      const diagnostics = await collectSidequestDiagnostics(site);
      res.json(diagnostics);
    } catch (err) {
      log.error({ err }, "Failed to collect Sidequest diagnostics");
      res.status(500).json({
        error: err instanceof Error ? err.message : "Failed to collect Sidequest diagnostics",
      });
    }
  });

  app.post("/api/admin/sidequest/recheck", async (req, res) => {
    const auth = await requireMutatingStaff(req, res);
    if (!auth.authorized) return;

    const site = typeof req.body?.site === "string" ? req.body.site : undefined;
    try {
      const diagnostics = await collectSidequestDiagnostics(site);
      res.json({
        ...diagnostics,
        alerts: await collectSystemAlerts(),
        message: diagnostics.summary,
      });
    } catch (err) {
      log.error({ err }, "Failed to recheck Sidequest");
      res.status(500).json({
        error: err instanceof Error ? err.message : "Failed to recheck Sidequest",
      });
    }
  });

  app.post("/api/admin/sidequest/restart", async (req, res) => {
    const auth = await requireWorkerManage(req, res);
    if (!auth.authorized) return;

    const body = req.body as { confirm?: boolean } | undefined;
    if (body?.confirm !== true) {
      res.status(400).json({ error: "Confirmation required: send { confirm: true } in the request body." });
      return;
    }

    try {
      const result = await requestSidequestRestart(auth.username);
      if (!result.ok) {
        res.status(result.status).json({ error: result.error });
        return;
      }
      res.json(result);
    } catch (err) {
      log.error({ err }, "Failed to restart Sidequest");
      res.status(500).json({
        error: err instanceof Error ? err.message : "Failed to restart Sidequest",
      });
    }
  });

  app.get("/api/admin/sidequest/logs", async (req, res) => {
    const auth = await requireStaffSession(req, res);
    if (!auth.authorized) return;

    const linesParam = Number(req.query.lines ?? 80);
    const { lines, truncated, hint } = tailSidequestLog(linesParam);
    res.json({ source: "file", lines, truncated, hint });
  });
}
