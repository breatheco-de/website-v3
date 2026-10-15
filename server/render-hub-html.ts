import fs from "fs";
import { injectThemeOverrides } from "./theme-html";
import path from "path";
import type { ViteDevServer } from "vite";
import type { ContentIndex } from "./content-index";
import { resolveInitialData, urlBakesStoredPageQuery, type InitialDataPayload } from "./initial-data-middleware";
import { resolvePublicHtmlStatus } from "./public-html-status";
import { publicPageHead } from "./public-page-schema";
import { applyEntryModulePreload } from "./utils/html-transforms";
import { buildEntryPreloadTags, getEntryAssets } from "./utils/vite-manifest";
import { assembleSsrDocument, contentTypesReadyForHtmlCache, isMeaningfulSsrAppHtml } from "./utils/ssr-html";
import { injectGtmWebContainerId } from "./gtm-web-inject";
import {
  buildHtmlCacheKey,
  canonicalHtmlCachePath,
  getCachedHtml,
  setCachedHtml,
} from "./html-page-cache";
import type { SiteContext } from "./site-manager";
import { child as loggerChild } from "./logger";

const log = loggerChild({ module: "render-hub-html" });

let devViteRef: ViteDevServer | null = null;
let prodSsrLoad: Promise<((url: string, payload: unknown) => Promise<string>) | null> | null = null;

export function registerDevViteForHubRender(vite: ViteDevServer | null): void {
  devViteRef = vite;
}

async function loadProdSsrBundle(): Promise<
  ((url: string, payload: unknown) => Promise<string>) | null
> {
  try {
    const ssrBundlePath = path.resolve(import.meta.dirname, "server", "entry-server.js");
    if (!fs.existsSync(ssrBundlePath)) return null;
    const mod = await import(ssrBundlePath);
    return typeof mod.render === "function" ? mod.render : null;
  } catch (err) {
    prodSsrLoad = null;
    log.warn({ err }, "production SSR bundle load failed for hub render");
    return null;
  }
}

async function loadSsrRender(): Promise<
  ((url: string, payload: unknown) => Promise<string>) | null
> {
  if (devViteRef) {
    try {
      const entryServerAbs = path.resolve(
        import.meta.dirname,
        "..",
        "client",
        "src",
        "entry-server.tsx",
      );
      const mod = await devViteRef.ssrLoadModule(entryServerAbs);
      if (typeof mod.render === "function") return mod.render;
    } catch (err) {
      log.warn({ err }, "dev SSR module load failed for hub render");
    }
  }
  if (!prodSsrLoad) prodSsrLoad = loadProdSsrBundle();
  return prodSsrLoad;
}

function resolveIndexHtmlPath(): string | null {
  const distPath = path.resolve(import.meta.dirname, "public", "index.html");
  if (fs.existsSync(distPath)) return distPath;
  const devPath = path.resolve(import.meta.dirname, "..", "client", "index.html");
  if (fs.existsSync(devPath)) return devPath;
  return null;
}

function injectEntryPreloadTags(html: string): string {
  const distPath = path.resolve(import.meta.dirname, "public");
  const tags = buildEntryPreloadTags(getEntryAssets(distPath));
  if (!tags) return html;
  if (/<link[^>]+rel=["']stylesheet["']/i.test(html)) {
    return html.replace(
      /(<link[^>]+rel=["']stylesheet["'][^>]*>)/i,
      (tag) => tag + "\n" + tags,
    );
  }
  return html.replace(/(<head[^>]*>)/i, (tag) => tag + "\n" + tags);
}

export type RenderHubHtmlResult = {
  html: string;
  status: number;
  fromCache: boolean;
};

export type AnonymousPageHtml = {
  html: string;
  /** This response filled a `{{ param.X }}` and must not replace the path copy. */
  skipCacheWrite: boolean;
};

function takeHtmlCacheMeta(payload: InitialDataPayload | null): { skipCacheWrite: boolean } {
  if (!payload) return { skipCacheWrite: false };
  const skipCacheWrite = payload.skipHtmlCache === true;
  delete payload.skipHtmlCache;
  return { skipCacheWrite };
}

/**
 * The anonymous page document: React body, schema.org, preloads, and GTM.
 * The visitor miss path and Sidequest both call this.
 */
export async function buildAnonymousPageHtml(opts: {
  render: (url: string, payload: unknown) => Promise<string>;
  indexHtml: string;
  initialData: InitialDataPayload | null;
  url: string;
  contentRoot?: string;
  ssrSchemaHtml?: string;
}): Promise<AnonymousPageHtml | null> {
  const meta = takeHtmlCacheMeta(opts.initialData);
  let appHtml = await opts.render(opts.url, opts.initialData);
  if (!isMeaningfulSsrAppHtml(appHtml)) {
    log.warn({ url: opts.url, appHtmlLength: appHtml?.length ?? 0 }, "SSR returned empty body, retrying once");
    appHtml = await opts.render(opts.url, opts.initialData);
  }
  if (!isMeaningfulSsrAppHtml(appHtml)) {
    log.warn({ url: opts.url, appHtmlLength: appHtml?.length ?? 0 }, "SSR returned empty body after retry");
    return null;
  }
  let html = assembleSsrDocument({
    template: opts.indexHtml,
    appHtml,
    payload: opts.initialData,
    contentRoot: opts.contentRoot,
    url: opts.url,
    ssrSchemaHtml: opts.ssrSchemaHtml,
  });
  html = applyEntryModulePreload(html);
  html = injectEntryPreloadTags(html);
  html = injectGtmWebContainerId(html, opts.contentRoot);
  if (opts.contentRoot) html = injectThemeOverrides(html, opts.contentRoot);
  if (!contentTypesReadyForHtmlCache(opts.initialData)) {
    log.warn({ url: opts.url }, "content type list missing; not storing this HTML copy");
    return { html, skipCacheWrite: true };
  }
  return { html, ...meta };
}

/**
 * Render a public hub page as anonymous live HTML. Uses HTML cache on hit;
 * on miss runs SSR and optionally populates the cache (same key as public traffic).
 */
export async function renderHubHtml(opts: {
  site: SiteContext;
  pathname: string;
  variantKey?: string;
  writeCache?: boolean;
  /** When set, skip the memory hit and store this generation (Sidequest rebuild). */
  generation?: number;
}): Promise<RenderHubHtmlResult | null> {
  const requested = opts.pathname.split("?")[0].split("#")[0] || "/";
  if (requested.startsWith("/private/")) return null;
  // Same path a public visit looks up, so a folder name and a locale slug share one copy.
  const clean = canonicalHtmlCachePath(
    requested,
    opts.site.contentIndex as ContentIndex | undefined,
  );

  const variantKey = opts.variantKey && opts.variantKey !== "default" ? opts.variantKey : "live";
  const siteId =
    opts.site.contentRootName || opts.site.contentRoot || opts.site.domain || "default";
  const cacheKey = buildHtmlCacheKey(siteId, clean, variantKey);

  if (opts.generation == null) {
    const cached = getCachedHtml(cacheKey);
    if (cached && !urlBakesStoredPageQuery(clean, opts.site.contentIndex as ContentIndex | undefined)) {
      return { html: cached.html, status: cached.status, fromCache: true };
    }
  }

  const render = await loadSsrRender();
  const indexHtmlPath = resolveIndexHtmlPath();
  if (!render || !indexHtmlPath) return null;

  const url = clean;
  const initialDataPayload = await resolveInitialData(
    url,
    opts.site.contentIndex as Parameters<typeof resolveInitialData>[1],
    opts.site.database as Parameters<typeof resolveInitialData>[2],
    opts.site,
  ).catch(() => null);

  const status = resolvePublicHtmlStatus({
    url,
    httpStatus:
      initialDataPayload &&
      typeof (initialDataPayload as { httpStatus?: number }).httpStatus === "number"
        ? (initialDataPayload as { httpStatus: number }).httpStatus
        : undefined,
    contentIndex: opts.site.contentIndex as { isKnownUrl?(u: string): boolean },
  });

  if (status !== 200) {
    return { html: "", status, fromCache: false };
  }

  try {
    const indexHtml = await fs.promises.readFile(indexHtmlPath, "utf-8");
    const head = await publicPageHead(
      url,
      opts.site.contentIndex as Parameters<typeof publicPageHead>[1],
      opts.site.database as Parameters<typeof publicPageHead>[2],
      opts.site.contentRoot,
    );
    const built = await buildAnonymousPageHtml({
      render,
      indexHtml,
      initialData: initialDataPayload,
      url,
      contentRoot: opts.site.contentRoot,
      ssrSchemaHtml: head.schemaHtml || undefined,
    });
    if (!built) return null;
    if (opts.writeCache !== false && !built.skipCacheWrite) {
      setCachedHtml(cacheKey, built.html, status, { generation: opts.generation });
    }
    return { html: built.html, status, fromCache: false };
  } catch (err) {
    log.warn({ err, pathname: clean }, "renderHubHtml failed");
    return null;
  }
}
