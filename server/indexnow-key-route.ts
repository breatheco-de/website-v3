import type { NextFunction, Request, Response } from "express";
import { getDefaultContentFolder, getDefaultContentRoot } from "./site-config";
import { getIndexNowSettings } from "./settings";
import { getSiteMainHost } from "./indexnow";

const KEY_PATH_RE = /^\/([A-Za-z0-9-]{8,128})\.txt$/;

/**
 * Serves the IndexNow key file at /<key>.txt on the site's main domain only.
 * Anything else (another .txt, wrong key, alias host, IndexNow off) falls through.
 */
export function indexNowKeyFileHandler(req: Request, res: Response, next: NextFunction): void {
  const match = KEY_PATH_RE.exec(req.path);
  if (!match) return next();
  const site = res.locals.site as { contentRoot?: string; contentRootName?: string } | undefined;
  const contentRoot = site?.contentRoot ?? getDefaultContentRoot();
  const contentRootName = site?.contentRootName ?? getDefaultContentFolder();
  const settings = getIndexNowSettings(contentRoot);
  if (!settings.enabled || !settings.key || match[1] !== settings.key) return next();
  const host = getSiteMainHost(contentRootName);
  const requestHost = (req.hostname || "").toLowerCase();
  if (!host || requestHost !== host) return next();
  res.set("Content-Type", "text/plain; charset=utf-8");
  res.set("Cache-Control", "public, max-age=3600");
  res.send(settings.key);
}
