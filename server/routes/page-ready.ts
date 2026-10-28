/**
 * Public ingest for the site's own anonymous visit counts on ads-first pages.
 *
 *   POST /api/page-ready — arrival / summary for one page view (arrival answers { f } = page is ads-first)
 *   POST /api/page-link  — later page in the tab reached a decision page, or a lead fired
 *
 * Endpoint names avoid tracker-blocklist words on purpose. Always answers 2xx so a
 * rejected message never surfaces to visitors; invalid, bot and staff traffic is dropped.
 */

import type { Express, Request, Response } from "express";
import { isbot } from "isbot";
import { api } from "../rate-limit/api";
import { extractToken } from "./_helpers";
import { resolveOwnedStaffSession } from "../staff-session-resolve";
import { adsFirstTypeForPath, fastVisitorCountry, verifyPageToken } from "../ads/ads-first";
import { resolveVisitorCountry } from "../ads/visitor-country";
import {
  bufferCredit,
  bufferPageView,
  bufferTransition,
  deviceFromUserAgent,
  linkMessageSchema,
  minuteFloor,
  pageMessageSchema,
  rowFromMessage,
  setPageViewCountry,
  utcDay,
} from "../analytics/first-party/ingest";
import { ensureOpenWindow } from "../analytics/first-party/windows";
import { getPathStageIndex, stageOfPath } from "../analytics/page-stats/resolve";
import type { SiteContext } from "../site-manager";
import { child } from "../logger";

const log = child({ module: "routes/page-ready" });

function bodyOf(req: Request): unknown {
  if (typeof req.body === "string") {
    try {
      return JSON.parse(req.body);
    } catch {
      return null;
    }
  }
  return req.body;
}

/** Bots and logged-in staff are never counted. */
export async function shouldDrop(req: Request): Promise<boolean> {
  if (isbot(req.get("user-agent") ?? "")) return true;
  const token = extractToken(req);
  if (!token) return false;
  try {
    return !!(await resolveOwnedStaffSession(token));
  } catch {
    return false;
  }
}

export function registerPageReadyRoutes(app: Express): void {
  api.post(app, "/api/page-ready", { rate: "publicRead" }, async (req: Request, res: Response) => {
    const site = res.locals.site as SiteContext | undefined;
    const parsed = pageMessageSchema.safeParse(bodyOf(req));
    if (!site?.contentIndex || !parsed.success || !verifyPageToken(site.contentRootName, parsed.data.tk)) {
      res.status(204).end();
      return;
    }
    try {
      if (await shouldDrop(req)) {
        res.status(204).end();
        return;
      }
      const msg = parsed.data;
      const now = Date.now();
      const siteName = site.contentRootName;
      const type = adsFirstTypeForPath(siteName, site.contentIndex, site.contentRoot, msg.u);

      if (msg.m === "a" && msg.cb === 1 && msg.pp) {
        const prev = msg.pp;
        if (adsFirstTypeForPath(siteName, site.contentIndex, site.contentRoot, prev)) {
          const row = rowFromMessage(msg, { now, contentType: type, device: null, country: null });
          if (row.prev_path) bufferTransition(siteName, utcDay(minuteFloor(now)), row.prev_path, row.path);
        }
      }

      if (!type) {
        res.json({ f: 0 });
        return;
      }
      ensureOpenWindow(siteName, type, now);
      const country = fastVisitorCountry(req);
      bufferPageView(
        siteName,
        rowFromMessage(msg, {
          now,
          contentType: type,
          device: deviceFromUserAgent(req.get("user-agent")),
          country,
        }),
      );
      // No proxy country header on this host: look the IP up once (cached per IP), never store the IP.
      if (!country && msg.m === "a") {
        void resolveVisitorCountry(req)
          .then((c) => {
            if (c) setPageViewCountry(siteName, msg.id, c);
          })
          .catch(() => {});
      }
      res.json({ f: 1 });
    } catch (err) {
      log.warn({ err }, "[page-ready] ingest failed");
      res.status(204).end();
    }
  });

  api.post(app, "/api/page-link", { rate: "publicRead" }, async (req: Request, res: Response) => {
    const site = res.locals.site as SiteContext | undefined;
    const parsed = linkMessageSchema.safeParse(bodyOf(req));
    if (!site?.contentIndex || !parsed.success || !verifyPageToken(site.contentRootName, parsed.data.tk)) {
      res.status(204).end();
      return;
    }
    try {
      if (await shouldDrop(req)) {
        res.status(204).end();
        return;
      }
      const msg = parsed.data;
      if (msg.r === "d") {
        const index = getPathStageIndex(site.contentRootName, site.contentIndex);
        if (!msg.u || stageOfPath(index, msg.u) !== "decision") {
          res.status(204).end();
          return;
        }
        bufferCredit(site.contentRootName, "reached_decision", msg.ids);
      } else {
        bufferCredit(site.contentRootName, "lead", msg.ids);
      }
      res.status(204).end();
    } catch (err) {
      log.warn({ err }, "[page-link] ingest failed");
      res.status(204).end();
    }
  });
}
