/**
 * Public session helpers: slim campus catalog for IP → nearest campus matching.
 */

import type { Express, Response } from "express";
import { api } from "../rate-limit/api";
import { getDefaultContentRoot } from "../site-config";
import { loadSessionLocationCatalog } from "../session-location-catalog";
import { getSessionSettings } from "../settings";

function getContentRoot(res: Response): string {
  return (res.locals.site as { contentRoot?: string } | undefined)?.contentRoot ?? getDefaultContentRoot();
}

export function registerSessionRoutes(app: Express): void {
  api.get(app, "/api/session/location-catalog", { rate: "publicRead" }, (req, res) => {
    try {
      const contentRoot = getContentRoot(res);
      const settings = getSessionSettings(contentRoot);
      const locations = loadSessionLocationCatalog(contentRoot);
      res.setHeader("Cache-Control", "public, max-age=300, stale-while-revalidate=600");
      res.json({
        database: settings.location.database,
        fill_from_ip: settings.location.fill_from_ip,
        locations,
      });
    } catch (err) {
      res.status(500).json({ error: String(err), locations: [] });
    }
  });
}
