/**
 * Refresh public page (versioning panel, staff):
 *   GET  /api/public-cache/:contentType/:slug/:locale          how fresh visitors' cached copies are
 *   POST /api/public-cache/:contentType/:slug/:locale/refresh  rebuild those copies now
 */

import type { Express, Request, Response } from "express";
import { api } from "../rate-limit/api";
import { requireCapability } from "./_helpers";
import { contentIndex, type ContentIndex } from "../content-index";
import { isValidType } from "../content-types";
import { getDefaultContentRoot } from "../site-config";
import type { SiteContext } from "../site-manager";
import { resolvePreviewBaseSlug, isTemplateVersioningSlug } from "../shared-layout-entry";
import { getVersioningManager } from "../versioning";
import { getPublicCacheStatus, refreshPublicCache, type PublicCacheTarget } from "../public-cache";

const LOCALE_RE = /^[a-z]{2}(-[A-Z]{2})?$/;

function resolveTarget(req: Request, res: Response): { target: PublicCacheTarget; site: SiteContext } | null {
  const { contentType, slug: requestSlug, locale } = req.params;
  const site = res.locals.site as SiteContext | undefined;
  const contentRoot = site?.contentRoot ?? getDefaultContentRoot();
  if (!isValidType(contentType, contentRoot)) {
    res.status(400).json({ error: "Invalid content type" });
    return null;
  }
  if (!LOCALE_RE.test(locale)) {
    res.status(400).json({ error: "Invalid locale" });
    return null;
  }
  if (!requestSlug || requestSlug.includes("/") || requestSlug.includes("..") || isTemplateVersioningSlug(requestSlug)) {
    res.status(400).json({ error: "Invalid entry slug" });
    return null;
  }
  if (!site) {
    res.status(503).json({ error: "Site is not loaded yet; try again in a moment." });
    return null;
  }
  const ci = (site.contentIndex as ContentIndex | undefined) ?? contentIndex;
  const target: PublicCacheTarget = {
    siteId: site.contentRootName || site.contentRoot || site.config?.domain || "default",
    contentRoot,
    ci,
    versioningManager: site.versioningManager ?? getVersioningManager(),
    contentType: ci.normalizeType(contentType),
    slug: resolvePreviewBaseSlug(requestSlug, contentType, ci),
    locale,
  };
  return { target, site };
}

export function registerPublicCacheRoutes(app: Express): void {
  api.get(app, "/api/public-cache/:contentType/:slug/:locale", { rate: "staffWrite" }, async (req, res) => {
    const auth = await requireCapability(req, res, "content_view", req.params.contentType);
    if (!auth.authorized) return;
    const resolved = resolveTarget(req, res);
    if (!resolved) return;
    res.setHeader("Cache-Control", "no-store");
    res.json(getPublicCacheStatus(resolved.target));
  });

  api.post(app, "/api/public-cache/:contentType/:slug/:locale/refresh", { rate: "staffWrite" }, async (req, res) => {
    const auth = await requireCapability(req, res, "content_view", req.params.contentType);
    if (!auth.authorized) return;
    const resolved = resolveTarget(req, res);
    if (!resolved) return;
    const result = await refreshPublicCache(resolved.target, resolved.site);
    const allFailed = result.failed.length > 0 && result.refreshed.length === 0;
    res.status(allFailed ? 500 : 200).json(result);
  });
}
