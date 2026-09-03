// Vite 8 compatibility audit (task-579, 2025-05-29)
//
// API surface confirmed still valid in Vite 8.0.14:
//
//  vite.ssrLoadModule()   — NOT deprecated. Still the recommended way to load
//                           and execute an ES-module entry point in the dev-server
//                           SSR environment. The Vite 8 type definition at
//                           node_modules/vite/dist/node/index.d.ts:2633 carries no
//                           @deprecated annotation. The new Module Runner API
//                           (createViteRuntime / server.environments.ssr.runner) is
//                           an *alternative* introduced for framework authors; it is
//                           not a mandatory replacement for per-request ssrLoadModule.
//
//  vite.ssrFixStacktrace() — Unchanged. Still present in Vite 8 types.
//
//  allowedHosts: true      — Valid. Confirmed at types line 626.
//
//  server.middlewareMode   — Valid. Unchanged in Vite 8.
//
//  appType: "custom"       — Valid. Unchanged in Vite 8.
//
// Dev-console deprecation warnings observed during audit: NONE from Vite.
// (PostCSS "from" warning originates from a PostCSS plugin, not Vite.)
import express, { type Express, type Request, type Response } from "express";
import fs from "fs";
import path from "path";
import { createServer as createViteServer, createLogger, type ViteDevServer } from "vite";
import { type Server } from "http";
import viteConfig from "../vite.config";
import { resolveInitialData, resolvePreloadHints, injectSsrMetaTags, type PreloadHint, type InitialDataPayload } from "./initial-data-middleware";
import { injectSsrSchemaHtml } from "./ssr-schema";
import { resolvePublicHtmlStatus } from "./public-html-status";
import { applyEntryModulePreload } from "./utils/html-transforms";
import { getEntryAssets, buildEntryPreloadTags, buildEntryLinkHeader } from "./utils/vite-manifest";
import {
  buildHtmlCacheKey,
  setCachedHtml,
  shouldBypassHtmlCache,
} from "./html-page-cache";
import { injectGtmWebContainerId } from "./gtm-web-inject";
import { child as loggerChild } from "./logger";
import { recordPublicNotFound } from "./runtime-issues-store";

function maybeRecordPublicNotFound(req: Request, res: Response, status: number): void {
  if (status !== 404) return;
  const rawUrl = req.originalUrl || req.url || "/";
  const pathOnly = rawUrl.split("?")[0].split("#")[0];
  if (pathOnly.startsWith("/api/") || pathOnly.startsWith("/private/")) return;
  const querySearch = rawUrl.includes("?") ? rawUrl.split("?")[1].split("#")[0] : "";
  const site = (res.locals as { site?: { contentRootName?: string; contentRoot?: string; config?: { domain?: string } } }).site;
  try {
    recordPublicNotFound({
      site: site?.contentRootName || "default",
      contentRoot: site?.contentRoot,
      path: pathOnly,
      querySearch,
      hostname: req.hostname || site?.config?.domain,
      referrer: typeof req.get === "function" ? req.get("referer") : undefined,
      userAgent: typeof req.get === "function" ? req.get("user-agent") : undefined,
    });
  } catch {
    // never break HTML responses
  }
}

const ssrLogger = loggerChild({ module: "ssr" });

async function getInitialDataForRequest(
  url: string,
  res: import("express").Response,
): Promise<InitialDataPayload | null> {
  const locals = res.locals as {
    initialDataPromise?: Promise<InitialDataPayload | null>;
    site?: { contentIndex?: unknown; database?: unknown };
  };
  if (locals.initialDataPromise) {
    return locals.initialDataPromise;
  }
  const site = locals.site as import("./site-manager").SiteContext | undefined;
  const promise = resolveInitialData(
    url,
    site?.contentIndex as any,
    site?.database as any,
    site,
  ).catch(() => null);
  locals.initialDataPromise = promise;
  return promise;
}

function buildPreloadTags(hints: PreloadHint[]): string {
  if (hints.length === 0) return "";
  // Only the first (true LCP) candidate gets fetchpriority=high; siblings stay
  // as plain preloads so they don't contend for bandwidth with the hero.
  return hints
    .map((hint, index) => {
      const href = `href="${hint.src.replace(/"/g, "&quot;")}"`;
      const priority =
        index === 0 || hint.highPriority
          ? ` fetchpriority="high"`
          : "";
      if (hint.srcset) {
        const imagesrcset = `imagesrcset="${hint.srcset.replace(/"/g, "&quot;")}"`;
        const imagesizes = `imagesizes="${(hint.sizes ?? "100vw").replace(/"/g, "&quot;")}"`;
        return `<link rel="preload" as="image"${priority} ${href} ${imagesrcset} ${imagesizes}>`;
      }
      return `<link rel="preload" as="image"${priority} ${href}>`;
    })
    .join("\n");
}

function injectPreloadTags(html: string, preloadTags: string): string {
  if (!preloadTags) return html;
  return html.replace("</head>", preloadTags + "\n</head>");
}

const viteLogger = createLogger();

function siteContentIndex(res: Response): { isKnownUrl(url: string): boolean } | undefined {
  return (res.locals as { site?: { contentIndex?: { isKnownUrl(url: string): boolean } } }).site
    ?.contentIndex;
}

export function log(message: string, source = "express") {
  // Route through Pino so every server log line is structured JSON in production.
  // pino-pretty renders it with a human-readable timestamp in development.
  ssrLogger.info({ source }, message);
}

export async function setupVite(app: Express, server: Server): Promise<ViteDevServer> {
  const serverOptions = {
    middlewareMode: true,
    hmr: { server },
    allowedHosts: true as const,
    ws: { perMessageDeflate: false },
  };

  // The project root is always one level above this server/ file.
  // We derive it from import.meta.dirname here (in the *server* file) rather than
  // relying on the aliases baked into vite.config.ts, because in the deployed
  // environment vite.config may be compiled to dist/vite.config.js whose
  // import.meta.dirname is dist/ — causing every @ alias to resolve to
  // dist/client/src instead of <root>/client/src.
  const projectRoot = path.resolve(import.meta.dirname, "..");

  // vite.config.ts exports an async factory via defineConfig.
  // We must call it to get the resolved config object before spreading.
  // Note: isSsrBuild was removed from the callback params in Vite 6+; omit it here.
  const resolvedViteConfig = typeof viteConfig === "function"
    ? await (viteConfig as Function)({ mode: "development", command: "serve" })
    : viteConfig;

  const vite = await createViteServer({
    ...resolvedViteConfig,
    configFile: false,
    // Always override root and resolve.alias with project-root-relative paths so
    // they are correct regardless of where vite.config was loaded from.
    root: path.resolve(projectRoot, "client"),
    resolve: {
      ...(resolvedViteConfig?.resolve ?? {}),
      alias: {
        "@": path.resolve(projectRoot, "client", "src"),
        "@shared": path.resolve(projectRoot, "shared"),
        "@assets": path.resolve(projectRoot, "attached_assets"),
      },
    },
    customLogger: {
      ...viteLogger,
      error: (msg, options) => {
        viteLogger.error(msg, options);
        // Only crash on genuine build/plugin errors, not on SSR pre-transform misses
        if (options?.error && !msg.includes("Pre-transform error")) {
          process.exit(1);
        }
      },
    },
    // Merge vite.config server options (fs, warmup, etc.) with the runtime
    // middleware-mode overrides so neither set silently drops the other.
    server: {
      ...(resolvedViteConfig?.server ?? {}),
      ...serverOptions,
    },
    appType: "custom",
  });

  app.use(vite.middlewares);
  app.use("*", async (req, res, next) => {
    // Never serve the SPA shell for API paths — callers expect JSON.
    if (req.path.startsWith("/api/") || req.originalUrl.startsWith("/api/")) {
      if (!res.headersSent) {
        res.status(404).json({ error: `API route not found: ${req.method} ${req.path}` });
      }
      return;
    }

    const url = req.originalUrl;

    try {
      const clientTemplate = path.resolve(
        import.meta.dirname,
        "..",
        "client",
        "index.html",
      );

      const template = await fs.promises.readFile(clientTemplate, "utf-8");
      const page = await vite.transformIndexHtml(url, template);

      const initialDataPayload = await getInitialDataForRequest(url, res);

      let appHtml = "";
      const cleanUrlForSsr = url.split("?")[0].split("#")[0];
      const skipSsr = cleanUrlForSsr.startsWith("/private/");
      if (!skipSsr) {
        try {
          const entryServerAbs = path.resolve(
            import.meta.dirname,
            "..",
            "client",
            "src",
            "entry-server.tsx",
          );
          const { render } = await vite.ssrLoadModule(entryServerAbs);
          appHtml = await render(url, initialDataPayload);
        } catch (ssrErr) {
          ssrLogger.warn({ err: ssrErr, url }, "render failed, falling back to client-only");
        }
      }

      let html = appHtml
        ? page.replace('<div id="root"></div>', `<div id="root">${appHtml}</div>`)
        : page;

      const preloadUrls = resolvePreloadHints(initialDataPayload);
      const preloadTags = buildPreloadTags(preloadUrls);
      html = injectPreloadTags(html, preloadTags);
      html = injectSsrMetaTags(
        html,
        initialDataPayload,
        (res.locals as any).site?.contentRoot,
        url,
      );

      const ssrSchemaHtml = (req as any).ssrSchemaHtml as string | undefined;
      if (ssrSchemaHtml) {
        html = injectSsrSchemaHtml(html, ssrSchemaHtml);
      }

      if (initialDataPayload) {
        const scriptTag = `<script id="__INITIAL_DATA__" type="application/json">${JSON.stringify(initialDataPayload).replace(/</g, "\\u003c")}</script>`;
        html = html.replace("</body>", scriptTag + "</body>");
      }

      html = injectGtmWebContainerId(html, (res.locals as any).site?.contentRoot);

      const payloadStatus =
        initialDataPayload &&
        typeof (initialDataPayload as { httpStatus?: number }).httpStatus === "number"
          ? (initialDataPayload as { httpStatus: number }).httpStatus
          : undefined;
      const status = resolvePublicHtmlStatus({
        url,
        httpStatus: payloadStatus,
        contentIndex: siteContentIndex(res),
      });
      maybeRecordPublicNotFound(req, res, status);
      res.status(status).set({ "Content-Type": "text/html" }).end(html);
    } catch (e) {
      vite.ssrFixStacktrace(e as Error);
      next(e);
    }
  });

  return vite;
}

let ssrRenderFn: ((url: string, payload: unknown) => Promise<string>) | null = null;
let ssrModuleLoaded = false;

async function getSsrRender() {
  if (ssrModuleLoaded) return ssrRenderFn;
  ssrModuleLoaded = true;
  try {
    const ssrBundlePath = path.resolve(import.meta.dirname, "server", "entry-server.js");
    if (fs.existsSync(ssrBundlePath)) {
      const mod = await import(ssrBundlePath);
      ssrRenderFn = mod.render;
    }
  } catch (e) {
    ssrLogger.warn({ err: e }, "could not load SSR bundle");
  }
  return ssrRenderFn;
}

export function serveStatic(app: Express) {
  const distPath = path.resolve(import.meta.dirname, "public");

  if (!fs.existsSync(distPath)) {
    throw new Error(
      `Could not find the build directory: ${distPath}, make sure to build the client first`,
    );
  }

  app.use(express.static(distPath, { index: false }));

  const indexHtmlPath = path.resolve(distPath, "index.html");

  // Resolve entry-chunk assets from the Vite manifest once at startup.
  // getEntryAssets is cached — returns empty arrays if the manifest is absent.
  const entryAssets = getEntryAssets(distPath);
  const entryPreloadTags = buildEntryPreloadTags(entryAssets);
  const entryLinkHeader = buildEntryLinkHeader(entryAssets);

  /** Inject entry-chunk preload tags at the top of <head> and set the Link header. */
  function applyEntryPreloads(html: string, res: import("express").Response): string {
    if (entryLinkHeader) {
      // Merge with any existing Link header set by upstream middleware.
      const existing = res.getHeader("Link");
      const merged = existing
        ? `${existing}, ${entryLinkHeader}`
        : entryLinkHeader;
      res.setHeader("Link", merged);
    }
    if (entryPreloadTags) {
      // Inject immediately after the opening <head> tag so the browser
      // discovers these assets before any existing stylesheet or script links.
      html = html.replace(/(<head[^>]*>)/, `$1\n${entryPreloadTags}`);
    }
    return html;
  }

  app.use("*", async (_req, res) => {
    if (_req.path.startsWith("/api/") || _req.originalUrl.startsWith("/api/")) {
      if (!res.headersSent) {
        res.status(404).json({ error: `API route not found: ${_req.method} ${_req.path}` });
      }
      return;
    }

    const url = _req.originalUrl;
    let status = resolvePublicHtmlStatus({
      url,
      contentIndex: siteContentIndex(res),
    });
    const ssrSchemaHtml = _req.ssrSchemaHtml;

    const cleanUrlForSsr = url.split("?")[0].split("#")[0];
    const skipSsr = cleanUrlForSsr.startsWith("/private/");

    const site = (res.locals as any).site;
    const siteId =
      site?.contentRootName ||
      site?.contentRoot ||
      site?.domain ||
      "default";
    const bypassCache = skipSsr || shouldBypassHtmlCache(_req);

    try {
      // Ensure variant key is resolved before MISS populate
      if (!(res.locals as any).htmlVariantKey && !bypassCache) {
        const { resolveHtmlVariantKey } = await import("./html-variant-key");
        (res.locals as any).htmlVariantKey = resolveHtmlVariantKey(_req, res);
      }
      const cacheKey = buildHtmlCacheKey(
        siteId,
        cleanUrlForSsr,
        (res.locals as any).htmlVariantKey || "live",
      );
      const render = !skipSsr ? await getSsrRender() : null;
      if (render) {
        const indexHtml = await fs.promises.readFile(indexHtmlPath, "utf-8");
        const initialDataPayload = await getInitialDataForRequest(url, res);
        status = resolvePublicHtmlStatus({
          url,
          httpStatus:
            initialDataPayload &&
            typeof (initialDataPayload as { httpStatus?: number }).httpStatus === "number"
              ? (initialDataPayload as { httpStatus: number }).httpStatus
              : undefined,
          contentIndex: siteContentIndex(res),
        });
        const appHtml = await render(url, initialDataPayload);

        let html = indexHtml.replace(
          '<div id="root"></div>',
          `<div id="root">${appHtml}</div>`,
        );

        const preloadUrls = resolvePreloadHints(initialDataPayload);
        const preloadTags = buildPreloadTags(preloadUrls);
        html = injectPreloadTags(html, preloadTags);
        html = injectSsrMetaTags(
          html,
          initialDataPayload,
          (res.locals as any).site?.contentRoot,
          url,
        );

        if (ssrSchemaHtml) {
          html = injectSsrSchemaHtml(html, ssrSchemaHtml);
        }

        if (initialDataPayload) {
          const scriptTag = `<script id="__INITIAL_DATA__" type="application/json">${JSON.stringify(initialDataPayload).replace(/</g, "\\u003c")}</script>`;
          html = html.replace("</body>", scriptTag + "</body>");
        }

        html = applyEntryModulePreload(html);
        html = applyEntryPreloads(html, res);

        // Cache HTML with the GTM placeholder intact; inject the live ID only on send
        // so settings changes apply on cache HITs without busting the page cache.
        const htmlForCache = html;
        html = injectGtmWebContainerId(html, (res.locals as any).site?.contentRoot);

        if (!bypassCache && status === 200) {
          setCachedHtml(cacheKey, htmlForCache, status);
          res.setHeader("X-HTML-Cache", "MISS");
        }

        maybeRecordPublicNotFound(_req, res, status);
        res.status(status).set({ "Content-Type": "text/html" }).send(html);
        return;
      }
    } catch (e) {
      ssrLogger.warn({ err: e, url }, "production render failed, falling back");
    }

    if (ssrSchemaHtml) {
      try {
        let html = await fs.promises.readFile(indexHtmlPath, "utf-8");
        html = injectSsrSchemaHtml(html, ssrSchemaHtml);
        html = applyEntryModulePreload(html);
        html = applyEntryPreloads(html, res);
        html = injectGtmWebContainerId(html, (res.locals as any).site?.contentRoot);
        maybeRecordPublicNotFound(_req, res, status);
        res.status(status).set({ "Content-Type": "text/html" }).send(html);
        return;
      } catch {
        // fall through to sendFile
      }
    }

    try {
      let html = await fs.promises.readFile(indexHtmlPath, "utf-8");
      html = applyEntryModulePreload(html);
      html = applyEntryPreloads(html, res);
      html = injectGtmWebContainerId(html, (res.locals as any).site?.contentRoot);
      maybeRecordPublicNotFound(_req, res, status);
      res.status(status).set({ "Content-Type": "text/html" }).send(html);
    } catch {
      maybeRecordPublicNotFound(_req, res, status);
      res.status(status).sendFile(indexHtmlPath);
    }
  });
}
