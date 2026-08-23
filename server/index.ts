import "dotenv/config";
import express, { type Request, Response, NextFunction } from "express";
import { registerRoutes, startBackgroundSync } from "./routes/index";
import { setupVite, serveStatic, log } from "./vite";
import { registerDevViteForHubRender } from "./render-hub-html";
import type { ViteDevServer } from "vite";
import { fallbackRedirectMiddleware } from "./redirects";
import { initialDataMiddleware } from "./initial-data-middleware";
import compression from "compression";
import cookieParser from "cookie-parser";
import path from "path";
import fs from "fs";
import { setAutoCommitCallback, addFileModifiedListener } from "./sync-state";
import { queueFileChange } from "./auto-commit";
import { contentIndex } from "./content-index";
import { siteResolutionMiddleware, buildSiteContextMap, getSiteContextMap } from "./site-manager";
import { loadSitesYmlFromBucket } from "./sites-yml-store";
import { scanEcommerceContent, startEcommerceWatcher } from "./ecommerce/ecommerce-index";
import { loadUsersStateFromBucket } from "./user-store";
import {
  loadAllRuntimeIssuesFromBucket,
  shutdownRuntimeIssues,
} from "./runtime-issues-store";
import { loadFormStateFromBucket, updateFormStateForFile } from "./form-state";
import { loadValidationCachesFromBucket, shutdownValidationCaches } from "./services/validationCacheService";
import { loadGscInspectionStoresFromBucket } from "./gsc-url-inspection";
import { emitContentFileWritten, emitRedirectsChanged } from "./content-events";
import { startEventPruneTimer } from "./events/event-store";
import { startEventDispatcher } from "./events/dispatcher";
import { registerAllJobs } from "./jobs/register";
import { startJobQueue, stopJobQueue } from "./jobs/queue";
import { startJobApplier, stopJobApplier } from "./jobs/applier";
import { startEngineWatchdog } from "./jobs/engine-watchdog";
import { scheduleSectionVariantsRefreshForFile } from "./registrySchemaValidationRefresh";
import { flushAllPendingSyncStateWrites } from "./sync-state";
import { gcs } from "./gcs";
import { getVersioningManager } from "./versioning/VersioningManager";
import { clearSitemapCache } from "./sitemap";
import http from "http";
import { registerSgtmProxy } from "./sgtm-proxy";
import { IPN_MOUNT_PATH, registerIpnProxy } from "./ipn-proxy";
import { getOptimizationSettings } from "./settings";
import { BOOT_ID, BOOT_TIME, getLastSoftReload, registerShutdownHandler } from "./server-control";
import logger from "./logger";
// Note: gcs.initFromEnv() is called by media.initFromEnv() in routes.ts,
// which happens before sync-state needs it.

// ─── Process-level crash guards ─────────────────────────────────────────────
// Registered before any async work so no early failure goes unlogged.
process.on("uncaughtException", (err) => {
  logger.fatal({ err }, "[FATAL] uncaught exception");
  process.exit(1);
});

process.on("unhandledRejection", (reason) => {
  const err = reason instanceof Error ? reason : new Error(String(reason));
  logger.fatal({ err }, "[FATAL] unhandled rejection");
  process.exit(1);
});
// ─────────────────────────────────────────────────────────────────────────────

const app = express();

app.use(cookieParser());

// Trailing slash 301 redirect — must run before route handlers so search engines
// never see duplicate content at both /path/ and /path.
app.use((req: Request, res: Response, next: NextFunction) => {
  const p = req.path;
  if (
    p.length > 1 &&
    p.endsWith('/') &&
    !p.startsWith('/api/') &&
    !p.startsWith('/attached_assets/') &&
    !Array.from(getSiteContextMap().values()).some(ctx => p.startsWith(`/${ctx.contentRootName}/`)) &&
    !p.startsWith('/@') &&
    !p.startsWith('/mcp') &&
    !p.startsWith('/oauth') &&
    !p.startsWith('/.well-known')
  ) {
    // Exempt sGTM / IPN proxy paths from trailing-slash redirect so the proxy
    // middleware receives the request with the trailing slash intact.
    const { tagmanager } = getOptimizationSettings();
    const sgtmPath = tagmanager.sgtm_proxy_path;
    if (sgtmPath && p.startsWith(sgtmPath.endsWith("/") ? sgtmPath : sgtmPath + "/")) {
      return next();
    }
    if (p.startsWith(IPN_MOUNT_PATH)) {
      return next();
    }
    const url = req.originalUrl;
    const qIndex = url.indexOf('?');
    const qs = qIndex >= 0 ? url.slice(qIndex) : '';
    return res.redirect(301, p.slice(0, -1) + qs);
  }
  next();
});

// Legacy bare-path redirects — permanent 301s to locale-prefixed equivalents
const _legacyPageRedirects: Record<string, string> = {
  "/terms-conditions":      "/en/terms-conditions",
  "/terminos-condiciones":  "/es/terms-conditions",
  "/privacy-policy":        "/en/privacy-policy",
  "/politica-privacidad":   "/es/privacy-policy",
};
app.use((req: Request, res: Response, next: NextFunction) => {
  const target = _legacyPageRedirects[req.path];
  if (target) {
    const url = req.originalUrl;
    const qIndex = url.indexOf("?");
    const qs = qIndex >= 0 ? url.slice(qIndex) : "";
    return res.redirect(301, target + qs);
  }
  next();
});

app.use('/attached_assets', express.static(path.join(process.cwd(), 'attached_assets')));

// Dynamic per-site image serving — serves each site's images at /<contentRootName>/images/
// Handlers are cached after first build to avoid recreating on every request.
const _imageHandlers = new Map<string, ReturnType<typeof express.static>>();
app.use((req: Request, res: Response, next: NextFunction) => {
  const sites = getSiteContextMap();
  for (const ctx of sites.values()) {
    const prefix = `/${ctx.contentRootName}/images`;
    if (req.path === prefix || req.path.startsWith(`${prefix}/`)) {
      if (!_imageHandlers.has(ctx.contentRoot)) {
        _imageHandlers.set(ctx.contentRoot, express.static(path.join(ctx.contentRoot, 'images')));
      }
      const handler = _imageHandlers.get(ctx.contentRoot)!;
      const savedUrl = req.url;
      req.url = req.url.slice(prefix.length) || '/';
      return handler(req, res, () => {
        req.url = savedUrl;
        next();
      });
    }
  }
  next();
});

// Proxy /__mockup/ to the mockup sandbox dev server (port 23636)
// Only active in development — not included in production builds.
// Using pathFilter (not app.use mount) so the full /__mockup/... path is
// preserved when forwarded to the sandbox (mount strips the prefix).
if (process.env.NODE_ENV !== 'production') {
  const { createProxyMiddleware } = await import('http-proxy-middleware');
  app.use(createProxyMiddleware({
    pathFilter: '/__mockup',
    target: 'http://localhost:23636',
    changeOrigin: true,
    ws: true,
  }));
}


app.use(compression({
  filter: (req, res) => {
    if (req.headers['x-no-compression']) {
      return false;
    }
    if (req.path === '/api/github/site-archive' || req.path === '/api/github/pending-changes/zip') {
      return false;
    }
    return compression.filter(req, res);
  },
  level: 6,
}));

app.use((req, res, next) => {
  const ext = req.path.split('.').pop();
  if (['js', 'css', 'woff2', 'woff', 'ttf', 'png', 'jpg', 'jpeg', 'webp', 'svg', 'ico'].includes(ext || '')) {
    res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
  } else if (req.path.endsWith('.html') || req.path === '/') {
    // In dev mode: no-store prevents the browser from caching the SSR HTML.
    // This is critical for the site switcher — without it, location.reload()
    // sends a conditional GET and the browser may get a 304 and serve the old
    // site's HTML (e.g. 4geeks.com) even after the server file override has
    // been updated to fl.4geeks.com.
    if (process.env.NODE_ENV !== 'production') {
      res.setHeader('Cache-Control', 'no-store');
    } else {
      res.setHeader('Cache-Control', 'public, max-age=0, must-revalidate');
    }
  }
  next();
});

declare module 'http' {
  interface IncomingMessage {
    rawBody: unknown
  }
}
app.use(express.json({
  verify: (req, _res, buf) => {
    req.rawBody = buf;
  }
}));
app.use(express.urlencoded({
  extended: false,
  verify: (req, _res, buf) => {
    // Capture raw bytes for proxy forwarding (same pattern as express.json above)
    if (!req.rawBody) req.rawBody = buf;
  },
}));

/** Cap JSON bodies in API request logs — full payloads (events feed, variables, redirects) flood dev stdout. */
const API_LOG_BODY_MAX_CHARS = 280;

function formatApiResponseForLog(path: string, body: Record<string, unknown>): string {
  if (path === "/api/admin/events" && Array.isArray(body.events)) {
    return JSON.stringify({
      events: body.events.length,
      unpublishedTotal: body.unpublishedTotal,
    });
  }
  if (path === "/api/admin/pipeline/status") {
    const outbox = body.outbox as Record<string, unknown> | undefined;
    const index = body.index as Record<string, unknown> | undefined;
    return JSON.stringify({
      status: body.status,
      unpublishedCount: outbox?.unpublishedCount,
      behindBy: index?.behindBy,
    });
  }
  const raw = JSON.stringify(body);
  if (raw.length <= API_LOG_BODY_MAX_CHARS) return raw;
  return `${raw.slice(0, API_LOG_BODY_MAX_CHARS)}… (${raw.length} chars)`;
}

app.use((req, res, next) => {
  const start = Date.now();
  const path = req.path;
  let capturedJsonResponse: Record<string, any> | undefined = undefined;

  const originalResJson = res.json;
  res.json = function (bodyJson, ...args) {
    capturedJsonResponse = bodyJson;
    return originalResJson.apply(res, [bodyJson, ...args]);
  };

  res.on("finish", () => {
    const duration = Date.now() - start;
    if (path.startsWith("/api")) {
      let logLine = `${req.method} ${path} ${res.statusCode} in ${duration}ms`;
      // 304 + polling endpoints: status line only (body unchanged / not useful in logs).
      if (capturedJsonResponse && res.statusCode !== 304) {
        logLine += ` :: ${formatApiResponseForLog(path, capturedJsonResponse)}`;
      }

      log(logLine);
    }
  });

  next();
});

(async () => {
  setAutoCommitCallback(queueFileChange);
  log('[AutoCommit] Auto-commit callback registered');

  // ─── Health endpoint ──────────────────────────────────────────────────────────
  // Registered first — before all other routes — so health-checks always get an
  // immediate 200 even while SSR / DB warmup is still in progress.
  //
  // Deployment health checks hit "/" (not /health). During post-deploy warmup,
  // SSR of "/" can fail or be very slow, causing the platform to report the
  // deployment as unreachable. Until warmup completes, answer "/" with an
  // instant lightweight 200 page (production only) that auto-refreshes.
  let warmupComplete = process.env.NODE_ENV !== "production";
  app.get("/", (_req, res, next) => {
    if (warmupComplete) return next();
    res
      .status(200)
      .set("Cache-Control", "no-store")
      .set("Content-Type", "text/html; charset=utf-8")
      .send(
        `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="refresh" content="3"><title>Starting…</title></head><body style="font-family:system-ui;display:flex;align-items:center;justify-content:center;height:100vh;margin:0"><p>Starting up — this page will refresh automatically.</p></body></html>`,
      );
  });
  app.get("/health", (_req, res) => {
    const lastReload = getLastSoftReload();
    res.json({
      status: "ok",
      uptime: process.uptime(),
      env: process.env.NODE_ENV ?? "development",
      bootId: BOOT_ID,
      bootTime: BOOT_TIME,
      lastSoftReloadAt: lastReload.at,
      lastSoftReloadId: lastReload.id,
    });
  });
  // ─────────────────────────────────────────────────────────────────────────────

  // ─── MCP server proxy ────────────────────────────────────────────────────────
  // Port 3001 is firewalled. Proxy MCP and OAuth traffic through port 5000 so
  // the server is reachable without publishing. Set PUBLIC_URL to the base URL
  // of this server (no port suffix) so OAuth metadata advertises correct URLs.
  const MCP_PORT = process.env.MCP_PORT || "3001";

  function pipeToMcp(req: Request, res: Response) {
    // Express body-parser may have already consumed the stream, so we detect
    // that and re-serialize the parsed body rather than piping a dead stream.
    const bodyAlreadyParsed =
      req.body !== undefined &&
      ["POST", "PUT", "PATCH"].includes(req.method);

    // Forward the original raw body bytes so the MCP server's own parsers
    // receive exactly what the client sent (avoids re-encoding mismatches).
    let bodyBuf: Buffer | null = null;
    if (bodyAlreadyParsed) {
      const raw = req.rawBody;
      if (Buffer.isBuffer(raw) && raw.length > 0) {
        bodyBuf = raw;
      } else {
        // Fallback: re-encode the parsed body (JSON requests only reach here)
        bodyBuf = Buffer.from(JSON.stringify(req.body));
      }
    }

    const headers: http.OutgoingHttpHeaders = { ...req.headers, host: `127.0.0.1:${MCP_PORT}` };
    // Remove hop-by-hop headers that conflict with our re-serialized body
    delete headers["transfer-encoding"];
    delete headers["connection"];
    if (bodyBuf) {
      headers["content-length"] = bodyBuf.length;
      // Only set a content-type fallback if none was forwarded
      headers["content-type"] = (headers["content-type"] as string) ?? "application/json";
    }

    const options: http.RequestOptions = {
      hostname: "127.0.0.1",
      port: MCP_PORT,
      path: req.originalUrl,
      method: req.method,
      headers,
    };

    const proxy = http.request(options, (mcpRes) => {
      res.writeHead(mcpRes.statusCode ?? 502, mcpRes.headers);
      mcpRes.pipe(res, { end: true });
    });
    proxy.on("error", (err) => {
      log(`[MCP proxy] error: ${err.message}`);
      if (!res.headersSent) res.status(502).json({ error: "MCP server unavailable" });
    });

    if (bodyBuf) {
      proxy.end(bodyBuf);
    } else {
      req.pipe(proxy, { end: true });
    }
  }

  app.all("/mcp", pipeToMcp as any);
  app.all("/mcp/*", pipeToMcp as any);
  app.all("/oauth/*", pipeToMcp as any);
  app.all("/.well-known/oauth-authorization-server", pipeToMcp as any);
  // ─────────────────────────────────────────────────────────────────────────────

  // sGTM + IPN proxies — registered early so they fire before static file handlers
  registerSgtmProxy(app);
  registerIpnProxy(app);

  // Load site registry from GCS (production) before building site contexts
  await loadSitesYmlFromBucket();

  // Build site context map before routes so siteResolutionMiddleware has data
  await buildSiteContextMap();

  // Shared vs site registry types must not collide
  const { assertNoRegistryCollisionsForAllSites } = await import("../shared/registry-resolve");
  const { getSiteConfigs } = await import("./site-config");
  assertNoRegistryCollisionsForAllSites(
    getSiteConfigs().map((s) => ({
      contentFolder: s.contentFolder,
      inheritComponentsFrom: s.inheritComponentsFrom,
    })),
  );

  app.use(siteResolutionMiddleware);

  const server = await registerRoutes(app);

  // Fallback redirects: only fire for URLs that would otherwise 404
  // Registered before Vite's catch-all so they can intercept unknown routes
  app.use(fallbackRedirectMiddleware);

  // Serve cached anonymous HTML before initial-data resolution / SSR work.
  // Only active in production — development always re-renders for HMR accuracy.
  if (app.get("env") !== "development") {
    const {
      buildHtmlCacheKey,
      getCachedHtml,
      shouldBypassHtmlCache,
    } = await import("./html-page-cache");
    const { resolveHtmlVariantKey } = await import("./html-variant-key");
    app.use(async (req, res, next) => {
      if (req.path.startsWith("/api/") || req.path.startsWith("/private/")) {
        return next();
      }
      const ext = req.path.split(".").pop();
      if (
        ext &&
        ["js", "css", "woff2", "woff", "png", "jpg", "jpeg", "webp", "svg", "ico", "json", "map"].includes(ext)
      ) {
        return next();
      }
      if (shouldBypassHtmlCache(req)) return next();

      const site = (res.locals as any).site;
      const siteId =
        site?.contentRootName || site?.contentRoot || site?.domain || "default";
      const cleanUrl = (req.originalUrl || req.url || "/")
        .split("?")[0]
        .split("#")[0];
      const variantKey = resolveHtmlVariantKey(req, res);
      (res.locals as any).htmlVariantKey = variantKey;
      const cached = getCachedHtml(buildHtmlCacheKey(siteId, cleanUrl, variantKey));
      if (!cached) return next();

      const { injectGtmWebContainerId } = await import("./gtm-web-inject");
      const html = injectGtmWebContainerId(cached.html, site?.contentRoot);

      res
        .status(cached.status)
        .set({ "Content-Type": "text/html", "X-HTML-Cache": "HIT" })
        .send(html);
    });
  }

  app.use(initialDataMiddleware);

  // importantly only setup vite in development and after
  // setting up all the other routes so the catch-all route
  // doesn't interfere with the other routes
  let devVite: ViteDevServer | null = null;
  if (app.get("env") === "development") {
    devVite = await setupVite(app, server);
    registerDevViteForHubRender(devVite);
  } else {
    serveStatic(app);
  }

  // ─── Global error handler ────────────────────────────────────────────────────
  // Registered after all middleware (including Vite/static) so it catches errors
  // from every route and middleware. No re-throw — a single response is enough;
  // re-throwing was crashing the process via uncaughtException.
  app.use((err: any, req: Request, res: Response, _next: NextFunction) => {
    const status = err.status || err.statusCode || 500;
    const message = err.message || "Internal Server Error";

    logger.error(
      { err, method: req.method, url: req.originalUrl, status },
      "unhandled route error"
    );

    if (!res.headersSent) {
      res.status(status).json({ message });
    }
  });
  // ─────────────────────────────────────────────────────────────────────────────

  // Run the fast content-index scan synchronously before the server begins
  // listening so the first request is never blocked by the initial scan.
  // The slow phase (image/variable/redirect/SEO indexing) runs in the background.
  for (const ctx of getSiteContextMap().values()) {
    ctx.contentIndex.scanFast();
  }

  // Scan ecommerce YAML files and start the file watcher so plan/product data is
  // always available at request time with zero filesystem I/O.
  scanEcommerceContent();
  startEcommerceWatcher();

  await loadGscInspectionStoresFromBucket(
    [...getSiteContextMap().values()].map((ctx) => ctx.contentRootName),
  ).catch((err) => {
    logger.error({ err, worker: "GscInspection" }, "failed to load Search Console inspection cache from GCS");
  });

  // ALWAYS serve the app on the port specified in the environment variable PORT
  // Other ports are firewalled. Default to 5000 if not specified.
  // this serves both the API and the client.
  // It is the only port that is not firewalled.
  // VPS: bind loopback only (Nginx proxies). Do not merge this hardcode to
  // breatheco-de/Replit — there the process must listen on 0.0.0.0.
  const port = parseInt(process.env.PORT || '5000', 10);
  server.listen({
    port,
    host: "127.0.0.1",
    // SO_REUSEPORT is supported on Linux (Replit) but throws ENOTSUP on macOS.
    ...(process.platform === "linux" && { reusePort: true }),
  }, () => {
    log(`serving on port ${port}`);

    // ─── Periodic memory usage logging ───────────────────────────────────────
    const memLogger = logger.child({ module: "memory" });
    setInterval(() => {
      const mem = process.memoryUsage();
      const heapUsedMb = Math.round(mem.heapUsed / 1024 / 1024);
      const heapTotalMb = Math.round(mem.heapTotal / 1024 / 1024);
      const rssMb = Math.round(mem.rss / 1024 / 1024);
      const heapRatio = mem.heapUsed / mem.heapTotal;
      const logFn = heapRatio > 0.80 ? memLogger.warn.bind(memLogger) : memLogger.info.bind(memLogger);
      logFn({ heapUsedMb, heapTotalMb, rssMb }, `high memory usage: heap ${heapUsedMb}/${heapTotalMb} MB (${Math.round(heapRatio * 100)}% used), rss ${rssMb} MB`);
    }, 5 * 60 * 1000).unref();
    // ─────────────────────────────────────────────────────────────────────────

    // All deferred background tasks fire here — server is already ready to handle requests.
    for (const ctx of getSiteContextMap().values()) {
      ctx.contentIndex.startSlowScanAsync();
    }
    Promise.all([...getSiteContextMap().values()].map((ctx) => ctx.database.warmup()))
      .then(async () => {
        for (const ctx of getSiteContextMap().values()) {
          ctx.contentIndex.scanFast();
          ctx.contentIndex.startSlowScanAsync();
        }
        clearSitemapCache();

        await loadValidationCachesFromBucket().catch((err) => {
          logger.error({ err, worker: "ValidationCache" }, "failed to load validation caches from GCS");
        });

        const { ValidationService } = await import("../scripts/validation/service");
        const { applyValidationRunToCache } = await import("./services/validationCachePostProcess");
        for (const ctx of getSiteContextMap().values()) {
          try {
            const service = new ValidationService();
            const context = await service.buildContext({
              contentRoot: ctx.contentRoot,
              ci: ctx.contentIndex,
            });
            const result = await service.runValidators({ validators: ["database-health"] });
            await applyValidationRunToCache(ctx.validationCache, result, context);
          } catch (err) {
            logger.error({ err, site: ctx.contentRootName }, "database-health startup run error");
          }
        }
      })
      .catch((err) => {
        logger.error({ err, worker: "DatabaseManager" }, "warmup error");
      })
      .finally(() => {
        warmupComplete = true;
        log("warmup complete — serving full SSR on /");
        // Low-priority: component insights rebuild (after warmup; does not block listen)
        import("./component-insights")
          .then(({ runStartupInsightsRebuild }) => runStartupInsightsRebuild())
          .catch((err) => {
            logger.error({ err, worker: "ComponentInsights" }, "startup rebuild failed");
          });
      });
    startBackgroundSync().catch((err) => {
      logger.error({ err, worker: "SyncState" }, "failed to start background sync");
    });
    loadUsersStateFromBucket().catch((err) => {
      logger.error({ err, worker: "UserStore" }, "failed to load users state");
    });
    loadAllRuntimeIssuesFromBucket(
      [...getSiteContextMap().values()].map((ctx) => ({
        site: ctx.contentRootName,
        contentRoot: ctx.contentRoot,
      })),
    ).catch((err) => {
      logger.error({ err, worker: "RuntimeIssues" }, "failed to load runtime issues");
    });
    loadFormStateFromBucket().catch((err) => {
      logger.error({ err, worker: "FormState" }, "failed to load form state");
    });
    registerAllJobs();
    void startJobQueue().catch((err) => {
      logger.error({ err, worker: "JobQueue" }, "failed to start job queue");
    });
    startEventDispatcher();
    startJobApplier();
    startEngineWatchdog();
    startEventPruneTimer([...getSiteContextMap().values()].map((c) => c.contentRootName));
    addFileModifiedListener((evt) => {
      const { filePath, author, actor } = evt;
      scheduleSectionVariantsRefreshForFile(filePath);
      if (filePath.endsWith(".yml") || filePath.endsWith(".yaml")) {
        for (const ctx of getSiteContextMap().values()) {
          if (!filePath.startsWith(ctx.contentRootName + "/")) continue;
          try {
            ctx.contentIndex.upsertEntry(filePath);
          } catch {
            /* non-fatal */
          }
          const abs = path.isAbsolute(filePath)
            ? filePath
            : path.join(process.cwd(), filePath);
          const isCustomRedirects = filePath.endsWith("custom-redirects.yml");
          let redirectsChanged = isCustomRedirects;
          if (!isCustomRedirects) {
            try {
              const raw = fs.readFileSync(abs, "utf-8");
              redirectsChanged = /\n\s*redirects\s*:/.test(raw) || /\nmeta:[\s\S]*?redirects\s*:/.test(raw);
            } catch {
              /* ignore */
            }
          }
          const resolvedActor =
            actor ?? (author ? { type: "ui" as const } : { type: "system" as const, source: "content-pipeline" });
          emitContentFileWritten(filePath, { author, actor: resolvedActor });
          if (redirectsChanged) {
            emitRedirectsChanged(filePath, { author, actor: resolvedActor });
          }
          break;
        }
      }
      if (filePath.endsWith(".yml") || filePath.endsWith(".yaml")) {
        updateFormStateForFile(filePath);
      }
      if (filePath.endsWith(".yml") || filePath.endsWith(".yaml")) {
        import("./component-insights")
          .then(({ markInsightsDirty }) => markInsightsDirty(filePath))
          .catch(() => {});
      }
    });
  });

  let isShuttingDown = false;

  async function gracefulShutdown(signal: string): Promise<void> {
    if (isShuttingDown) return;
    isShuttingDown = true;

    logger.info({ signal }, "[Shutdown] flushing pending GCS uploads…");
    try {
      flushAllPendingSyncStateWrites();
      stopJobApplier();
      await stopJobQueue();
      await getVersioningManager().shutdown();
      await shutdownValidationCaches();
      await shutdownRuntimeIssues();
      await gcs.flushPending();
    } catch (err) {
      logger.error({ err }, "[Shutdown] error during graceful shutdown");
    }

    if (devVite) {
      try {
        logger.info("[Shutdown] closing Vite dev server…");
        await devVite.close();
      } catch (err) {
        logger.error({ err }, "[Shutdown] error closing Vite dev server");
      }
      devVite = null;
    }

    // Drop open keep-alive / HMR connections so server.close() can finish.
    server.closeAllConnections?.();

    server.close(() => {
      logger.info("[Shutdown] HTTP server closed.");
      process.exit(0);
    });
    // Force exit after 10 s if server.close() still hangs
    setTimeout(() => {
      logger.error("[Shutdown] forced exit after timeout.");
      process.exit(1);
    }, 10_000).unref();
  }

  process.on("SIGTERM", () => gracefulShutdown("SIGTERM"));
  process.on("SIGINT", () => gracefulShutdown("SIGINT"));

  // Expose graceful shutdown so the staff-gated hard-restart admin route can
  // trigger it (same code path as SIGTERM, preserving the 10s force-exit safety).
  registerShutdownHandler(gracefulShutdown);
})();
