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
import { isWeblifyDebug } from "../shared/debug";
import { type Server } from "http";
import viteConfig from "../vite.config";
import { resolveInitialData, urlBakesStoredPageQuery, type InitialDataPayload } from "./initial-data-middleware";
import { injectSsrSchemaHtml } from "./ssr-schema";
import {
  resolvePublicHtmlStatus,
  shouldSkipPublicSsr,
} from "./public-html-status";
import { applyEntryModulePreload } from "./utils/html-transforms";
import { getEntryAssets, buildEntryPreloadTags, buildEntryLinkHeader } from "./utils/vite-manifest";
import { assembleSsrDocument, isMeaningfulSsrAppHtml } from "./utils/ssr-html";
import {
  buildHtmlCacheKey,
  canonicalHtmlCachePath,
  getCachedHtml,
  getHtmlBuildId,
  htmlCacheDiskReason,
  htmlDocumentCacheControlFor,
  logHtmlRender,
  setCachedHtml,
  htmlRenderSkipReason,
  isEditDocumentRequest,
  shouldBypassHtmlCache,
  singleflight,
} from "./html-page-cache";
import { buildAnonymousPageHtml } from "./render-hub-html";
import { injectGtmWebContainerId } from "./gtm-web-inject";
import { child as loggerChild } from "./logger";
import { notePage, pagePatternForStats } from "./process-stats";
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

function ssrDiag(fields: Record<string, unknown>, message: string): void {
  ssrLogger.warn(fields, `[SSR-diag] ${message}`);
}

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

const viteLogger = createLogger();

function quietViteLogger(): typeof viteLogger {
  const noop = () => {};
  return {
    ...viteLogger,
    info: noop,
    warn: noop,
    // keep error / hasErrorLogged / clear* from viteLogger
  };
}

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

  // The engine root is always one level above this server/ file when running from source,
  // or WEBLIFY_PACKAGE_ROOT when running as an installed package.
  const { getPackageRoot } = await import("@shared/paths");
  const projectRoot = getPackageRoot();

  // vite.config.ts exports an async factory via defineConfig.
  // We must call it to get the resolved config object before spreading.
  // Note: isSsrBuild was removed from the callback params in Vite 6+; omit it here.
  const resolvedViteConfig = typeof viteConfig === "function"
    ? await (viteConfig as Function)({ mode: "development", command: "serve" })
    : viteConfig;

  const baseLogger = isWeblifyDebug() ? viteLogger : quietViteLogger();

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
      ...baseLogger,
      error: (msg, options) => {
        baseLogger.error(msg, options);
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
    // Prefer originalUrl: Express `*` can leave req.path as "/" even for /api/...
    if (req.path.startsWith("/api/") || req.originalUrl.startsWith("/api/")) {
      if (!res.headersSent) {
        const apiPath = (req.originalUrl || req.url || req.path).split("?")[0];
        res.status(404).json({ error: `API route not found: ${req.method} ${apiPath}` });
      }
      return;
    }

    const url = req.originalUrl;
    const cleanUrl = url.split("?")[0].split("#")[0];
    if (!cleanUrl.startsWith("/private/") && !isEditDocumentRequest(url) && !shouldBypassHtmlCache(req)) {
      const site = res.locals.site;
      const cachePath = canonicalHtmlCachePath(cleanUrl, site?.contentIndex);
      const { renderAudienceLlmMiss } = await import("./llm-html-request");
      if (await renderAudienceLlmMiss(req, res, site, cachePath)) return;
    }

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

      let appHtml = "";
      const cleanUrlForSsr = url.split("?")[0].split("#")[0];
      const skipSsr =
        cleanUrlForSsr.startsWith("/private/") || shouldSkipPublicSsr(status);
      let ssrOutcome: "ok" | "skipped" | "empty" | "error" = skipSsr ? "skipped" : "ok";
      if (!skipSsr) {
        const t0 = Date.now();
        try {
          const entryServerAbs = path.resolve(
            import.meta.dirname,
            "..",
            "client",
            "src",
            "entry-server.tsx",
          );
          const { render } = await vite.ssrLoadModule(entryServerAbs);
          if (typeof render !== "function") {
            ssrOutcome = "error";
            ssrDiag(
              { url, renderType: typeof render },
              "dev ssrLoadModule did not export render()",
            );
          } else {
            appHtml = await render(url, initialDataPayload);
            if (!isMeaningfulSsrAppHtml(appHtml)) {
              ssrDiag(
                { url, appHtmlLength: appHtml?.length ?? 0, ms: Date.now() - t0 },
                "SSR returned empty body, retrying once",
              );
              appHtml = await render(url, initialDataPayload);
            }
            if (!isMeaningfulSsrAppHtml(appHtml)) {
              ssrOutcome = "empty";
              ssrDiag(
                {
                  url,
                  appHtmlLength: appHtml?.length ?? 0,
                  ms: Date.now() - t0,
                  preview: String(appHtml ?? "").slice(0, 120),
                },
                "SSR returned empty body after retry, falling back to client-only",
              );
              appHtml = "";
            }
          }
        } catch (ssrErr) {
          ssrOutcome = "error";
          ssrDiag(
            {
              err: ssrErr,
              url,
              ms: Date.now() - t0,
              errMessage: ssrErr instanceof Error ? ssrErr.message : String(ssrErr),
            },
            "render failed, falling back to client-only",
          );
        }
      }

      const injected = isMeaningfulSsrAppHtml(appHtml);
      if (!injected && ssrOutcome !== "skipped") {
        ssrDiag(
          { url, ssrOutcome, rootInjected: false },
          "serving empty #root (client will first-paint)",
        );
      }

      let html = assembleSsrDocument({
        template: page,
        appHtml: injected ? appHtml : null,
        payload: initialDataPayload,
        contentRoot: (res.locals as any).site?.contentRoot,
        url,
        ssrSchemaHtml: (req as any).ssrSchemaHtml as string | undefined,
      });

      html = injectGtmWebContainerId(html, (res.locals as any).site?.contentRoot);

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
  const ssrBundlePath = path.resolve(import.meta.dirname, "server", "entry-server.js");
  const exists = fs.existsSync(ssrBundlePath);
  try {
    if (!exists) {
      ssrDiag({ ssrBundlePath }, "SSR bundle file missing — public pages will be client-only");
      return ssrRenderFn;
    }
    const mod = await import(ssrBundlePath);
    ssrRenderFn = typeof mod.render === "function" ? mod.render : null;
    if (!ssrRenderFn) {
      ssrDiag(
        { ssrBundlePath, exportKeys: Object.keys(mod ?? {}) },
        "SSR bundle loaded but mod.render is not a function",
      );
    }
  } catch (e) {
    ssrDiag({ err: e, ssrBundlePath }, "could not load SSR bundle");
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

  /** Inject entry-chunk preload tags after the first stylesheet so CSS is
   * discovered before the modulepreload storm (SSR text paints from CSS). */
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
      if (/<link[^>]+rel=["']stylesheet["']/i.test(html)) {
        html = html.replace(
          /(<link[^>]+rel=["']stylesheet["'][^>]*>)/i,
          (_m, tag: string) => tag + "\n" + entryPreloadTags,
        );
      } else {
        html = html.replace(/(<head[^>]*>)/i, (_m, tag: string) => tag + "\n" + entryPreloadTags);
      }
    }
    return html;
  }

  app.use("*", async (_req, res) => {
    if (_req.path.startsWith("/api/") || _req.originalUrl.startsWith("/api/")) {
      if (!res.headersSent) {
        const apiPath = (_req.originalUrl || _req.url || _req.path).split("?")[0];
        res.status(404).json({ error: `API route not found: ${_req.method} ${apiPath}` });
      }
      return;
    }

    const url = _req.originalUrl;
    const tHtml = Date.now();
    let pageOutcome = "client_fallback";
    let recordPage = true;

    const ssrSchemaHtml = _req.ssrSchemaHtml;

    const cleanUrlForSsr = url.split("?")[0].split("#")[0];
    const skipPrivate = cleanUrlForSsr.startsWith("/private/");
    // Edit markup is not the public page. Same empty shell as /private/preview.
    const clientShellOnly = skipPrivate || isEditDocumentRequest(url);

    const site = (res.locals as any).site;
    const siteId =
      site?.contentRootName ||
      site?.contentRoot ||
      site?.domain ||
      "default";
    const bypassCache = clientShellOnly || shouldBypassHtmlCache(_req);
    const cachePath = canonicalHtmlCachePath(cleanUrlForSsr, site?.contentIndex);
    const renderUrl =
      cachePath === cleanUrlForSsr
        ? url
        : `${cachePath}${url.includes("?") ? url.slice(url.indexOf("?")) : ""}`;
    res.on("finish", () => {
      if (!recordPage) return;
      try {
        notePage(
          pagePatternForStats(cleanUrlForSsr, site?.contentRoot),
          cleanUrlForSsr,
          Date.now() - tHtml,
          res.statusCode,
          pageOutcome,
        );
      } catch (err) {
        ssrLogger.warn({ err, url: cleanUrlForSsr }, "process stats page note failed");
      }
    });

    let status = resolvePublicHtmlStatus({
      url,
      contentIndex: siteContentIndex(res),
    });

    try {
      // Ensure variant key is resolved before MISS populate
      if (!(res.locals as any).htmlVariantKey && !bypassCache) {
        const { prepareLlmHtmlRequest, renderAudienceLlmMiss, sendCachedHtmlPage, LLM_HTML_CACHE_CONTROL } = await import("./llm-html-request");
        const llmHit = prepareLlmHtmlRequest(_req, res, siteId, cachePath);
        const baked = urlBakesStoredPageQuery(url, site?.contentIndex);
        if (llmHit && !baked) {
          logHtmlRender({ url: cleanUrlForSsr, ms: 0, cache: "HIT" });
          sendCachedHtmlPage(_req, res, llmHit, LLM_HTML_CACHE_CONTROL);
          recordPage = false;
          return;
        }
        if ((res.locals as { htmlVariantKey?: string }).htmlVariantKey === "live" && !baked) {
          const startedLlm = performance.now();
          if (await renderAudienceLlmMiss(_req, res, site, cachePath)) {
            logHtmlRender({ url: cleanUrlForSsr, ms: Math.round(performance.now() - startedLlm), cache: "MISS" });
            recordPage = false;
            return;
          }
        }
        if (!(res.locals as any).htmlVariantKey) {
          const { resolveHtmlVariantKey } = await import("./html-variant-key");
          (res.locals as any).htmlVariantKey = resolveHtmlVariantKey(_req, res);
        }
      }
      const cacheKey = buildHtmlCacheKey(
        siteId,
        cachePath,
        (res.locals as any).htmlVariantKey || "live",
      );

      // Private admin UI and ?edit=1: client shell only.
      // Non-200 public URLs: skip SSR (matches renderHubHtml) — avoids empty-#root
      // retries for /landing/null and other unknown paths.
      if (!clientShellOnly && !shouldSkipPublicSsr(status)) {
        const renderStarted = performance.now();
        const built = await singleflight(cacheKey, async () => {
          if (!bypassCache) {
            const shared = getCachedHtml(cacheKey);
            if (shared && !urlBakesStoredPageQuery(url, (res.locals as any).site?.contentIndex)) {
              return { kind: "html" as const, html: shared.html, status: shared.status, fromCache: true };
            }
          }
          const initialDataPayload = await getInitialDataForRequest(renderUrl, res);
          const nextStatus = resolvePublicHtmlStatus({
            url,
            httpStatus:
              initialDataPayload &&
              typeof (initialDataPayload as { httpStatus?: number }).httpStatus === "number"
                ? (initialDataPayload as { httpStatus: number }).httpStatus
                : undefined,
            contentIndex: siteContentIndex(res),
          });
          if (shouldSkipPublicSsr(nextStatus)) {
            return { kind: "skip" as const, status: nextStatus };
          }
          const render = await getSsrRender();
          if (!render) return { kind: "no-render" as const };
          const indexHtml = await fs.promises.readFile(indexHtmlPath, "utf-8");
          const built = await buildAnonymousPageHtml({
            render,
            indexHtml,
            initialData: initialDataPayload,
            url: renderUrl,
            contentRoot: (res.locals as any).site?.contentRoot,
            ssrSchemaHtml,
          });
          if (!built) return { kind: "empty" as const };
          if (entryLinkHeader) {
            const existing = res.getHeader("Link");
            res.setHeader("Link", existing ? `${existing}, ${entryLinkHeader}` : entryLinkHeader);
          }
          if (!bypassCache && nextStatus === 200 && !built.skipCacheWrite) {
            setCachedHtml(cacheKey, built.html, nextStatus);
          }
          return { kind: "html" as const, html: built.html, status: nextStatus, fromCache: false };
        });
        const renderMs = Math.round(performance.now() - renderStarted);

        if (built.kind === "skip") {
          status = built.status;
          pageOutcome = "ssr_skipped_non_200";
        } else if (built.kind === "no-render") {
          ssrDiag({ url }, "no SSR render fn available — falling back to empty #root");
        } else if (built.kind === "empty") {
          pageOutcome = "ssr_empty_fallback";
          throw new Error("empty_ssr_app_html");
        } else {
          status = built.status;
          if (renderMs > 300 && !built.fromCache) {
            ssrLogger.warn({ url, renderMs }, "ssr render slow");
          }
          logHtmlRender({
            url: cleanUrlForSsr,
            ms: renderMs,
            cache: built.fromCache ? "HIT" : "MISS",
          });
          if (built.fromCache) {
            recordPage = false;
          } else {
            const skip = htmlRenderSkipReason(_req);
            pageOutcome = skip
              ? `ssr_ok_${skip}`
              : urlBakesStoredPageQuery(url, (res.locals as any).site?.contentIndex)
                ? "ssr_ok_baked_query"
                : "ssr_ok";
            if (pageOutcome === "ssr_ok") {
              const variantKey = (res.locals as any).htmlVariantKey || "live";
              const build = getHtmlBuildId();
              const reason =
                variantKey !== "live" && variantKey !== "default"
                  ? `variant ${variantKey}`
                  : `${cachePath !== cleanUrlForSsr ? `lookup ${cachePath}, ` : ""}${htmlCacheDiskReason(cacheKey)} on ${build}`;
              ssrLogger.warn(
                { url: cleanUrlForSsr, variantKey, cachePath, buildId: build },
                `HTML cache miss ${cleanUrlForSsr}: ${reason}`,
              );
            }
          }
          maybeRecordPublicNotFound(_req, res, status);
          res
            .status(status)
            .set({
              "Content-Type": "text/html; charset=utf-8",
              "Cache-Control": htmlDocumentCacheControlFor(res),
              "X-HTML-Cache": built.fromCache ? "HIT" : "MISS",
            })
            .send(built.html);
          return;
        }
      } else if (!clientShellOnly && shouldSkipPublicSsr(status)) {
        pageOutcome = "ssr_skipped_non_200";
      }
    } catch (e) {
      if (pageOutcome === "client_fallback" || pageOutcome === "ssr_skipped_non_200") {
        pageOutcome =
          e instanceof Error && e.message === "empty_ssr_app_html"
            ? "ssr_empty_fallback"
            : "ssr_error_fallback";
      }
      ssrDiag(
        {
          err: e,
          url,
          errMessage: e instanceof Error ? e.message : String(e),
        },
        "production render failed, falling back (empty #root)",
      );
    }

    if (pageOutcome !== "ssr_skipped_non_200") {
      ssrDiag({ url, hasSchema: Boolean(ssrSchemaHtml) }, "serving client-only HTML fallback");
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
