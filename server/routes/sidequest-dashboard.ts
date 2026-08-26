/**
 * Webmaster-gated Sidequest dashboard: mint cookie + reverse-proxy to localhost dashboard.
 */

import type { Express, Request, Response, NextFunction } from "express";
import { createProxyMiddleware } from "http-proxy-middleware";
import * as userManager from "../user-manager";
import * as userStore from "../user-store";
import { extractToken } from "./_helpers";
import {
  getSidequestDashboardInternalAuth,
  getSidequestDashboardPort,
  isSidequestDashboardEnabled,
  SIDEQUEST_DASHBOARD_BASE_PATH,
} from "../jobs/queue";
import {
  mintSidequestDashCookie,
  refreshSidequestDashCookie,
  verifySidequestDashCookie,
} from "../sidequest-dashboard-auth";
import { child } from "../logger";

const log = child({ module: "sidequest-dashboard-routes" });

async function requireWebmaster(
  req: Request,
  res: Response,
): Promise<{ authorized: boolean; username: string | null }> {
  const isDevelopment = process.env.NODE_ENV !== "production";
  const token = extractToken(req);

  if (isDevelopment) {
    if (token) {
      try {
        const profile = await userManager.validateToken(token);
        if (profile.valid && profile.username) {
          return { authorized: true, username: profile.username };
        }
      } catch {
        // ignore in dev
      }
    }
    return { authorized: true, username: null };
  }

  if (!token) {
    res.status(401).json({ error: "Authorization required" });
    return { authorized: false, username: null };
  }

  const profile = await userManager.validateToken(token);
  if (!profile.valid || !profile.username) {
    res.status(401).json({ error: "Your session has expired. Please log in again." });
    return { authorized: false, username: null };
  }

  if (!userStore.hasWebmasterRole(profile.username, profile.email)) {
    res.status(403).json({ error: "Insufficient permissions: webmaster role required" });
    return { authorized: false, username: profile.username };
  }

  return { authorized: true, username: profile.username };
}

async function allowSidequestProxy(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  if (!isSidequestDashboardEnabled()) {
    res.status(503).send("Sidequest dashboard is disabled");
    return;
  }

  const cookie = verifySidequestDashCookie(req);
  if (cookie.ok) {
    refreshSidequestDashCookie(res, cookie.payload);
    next();
    return;
  }

  // Rare: Authorization header on asset requests (usually cookie after open).
  const isDevelopment = process.env.NODE_ENV !== "production";
  const token = extractToken(req);
  if (token || isDevelopment) {
    const auth = await requireWebmaster(req, res);
    if (!auth.authorized) return;
    mintSidequestDashCookie(res, { username: auth.username ?? undefined });
    next();
    return;
  }

  res.status(401).send("Webmaster login required");
}

export function registerSidequestDashboardRoutes(app: Express): void {
  app.post("/api/admin/sidequest/open", async (req, res) => {
    try {
      if (!isSidequestDashboardEnabled()) {
        res.status(503).json({ error: "Sidequest dashboard is disabled" });
        return;
      }

      const auth = await requireWebmaster(req, res);
      if (!auth.authorized) return;

      mintSidequestDashCookie(res, { username: auth.username ?? undefined });
      // Trailing slash matches Sidequest's basePath routes and avoids a bounce.
      res.json({ url: `${SIDEQUEST_DASHBOARD_BASE_PATH}/` });
    } catch (err) {
      log.error({ err }, "Failed to open Sidequest dashboard");
      res.status(500).json({
        error: err instanceof Error ? err.message : "Failed to open Sidequest dashboard",
      });
    }
  });

  const port = getSidequestDashboardPort();
  let internalAuthHeader: string | null = null;
  try {
    if (isSidequestDashboardEnabled()) {
      const { user, password } = getSidequestDashboardInternalAuth();
      internalAuthHeader = `Basic ${Buffer.from(`${user}:${password}`).toString("base64")}`;
    }
  } catch (err) {
    log.warn({ err }, "Sidequest dashboard internal auth not configured yet");
  }

  app.use(
    SIDEQUEST_DASHBOARD_BASE_PATH,
    (req, res, next) => {
      void allowSidequestProxy(req, res, next);
    },
    createProxyMiddleware({
      target: `http://127.0.0.1:${port}`,
      changeOrigin: true,
      ws: true,
      // Express mount strips /admin/sidequest from req.url before the proxy runs.
      // Sidequest serves HTML + static under that basePath — restore it.
      pathRewrite: (path) => {
        if (path.startsWith(SIDEQUEST_DASHBOARD_BASE_PATH)) return path;
        if (!path || path === "/") return `${SIDEQUEST_DASHBOARD_BASE_PATH}/`;
        return `${SIDEQUEST_DASHBOARD_BASE_PATH}${path.startsWith("/") ? path : `/${path}`}`;
      },
      on: {
        proxyReq: (proxyReq) => {
          try {
            const auth =
              internalAuthHeader ??
              (() => {
                const { user, password } = getSidequestDashboardInternalAuth();
                return `Basic ${Buffer.from(`${user}:${password}`).toString("base64")}`;
              })();
            proxyReq.setHeader("Authorization", auth);
          } catch (err) {
            log.error({ err }, "Failed to inject Sidequest Basic auth");
          }
        },
        proxyRes: (proxyRes) => {
          // Never leak Sidequest Basic challenges or cookies onto our origin —
          // WWW-Authenticate would make the browser treat the whole site as
          // Basic-auth and break SPA navigations after visiting the dashboard.
          delete proxyRes.headers["www-authenticate"];
          delete proxyRes.headers["set-cookie"];
        },
        error: (err, _req, res) => {
          log.error({ err }, "Sidequest dashboard proxy error");
          if (res && "writeHead" in res && typeof res.writeHead === "function") {
            (res as Response).status(502).send("Sidequest dashboard unavailable");
          }
        },
      },
    }),
  );

  log.info(
    { basePath: SIDEQUEST_DASHBOARD_BASE_PATH, port },
    "Sidequest dashboard proxy registered",
  );
}
