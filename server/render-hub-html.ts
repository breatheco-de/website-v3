import fs from "fs";
import path from "path";
import type { ViteDevServer } from "vite";
import {
  resolveInitialData,
  resolvePreloadHints,
  injectSsrMetaTags,
  type PreloadHint,
} from "./initial-data-middleware";
import { resolvePublicHtmlStatus } from "./public-html-status";
import { applyEntryModulePreload } from "./utils/html-transforms";
import {
  buildHtmlCacheKey,
  getCachedHtml,
  setCachedHtml,
} from "./html-page-cache";
import type { SiteContext } from "./site-manager";
import { child as loggerChild } from "./logger";

const log = loggerChild({ module: "render-hub-html" });

let devViteRef: ViteDevServer | null = null;
let prodSsrRender: ((url: string, payload: unknown) => Promise<string>) | null = null;
let prodSsrLoaded = false;

export function registerDevViteForHubRender(vite: ViteDevServer | null): void {
  devViteRef = vite;
}

function buildPreloadTags(hints: PreloadHint[]): string {
  if (hints.length === 0) return "";
  return hints
    .map((hint, index) => {
      const href = `href="${hint.src.replace(/"/g, "&quot;")}"`;
      const priority = index === 0 || hint.highPriority ? ` fetchpriority="high"` : "";
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
  if (!prodSsrLoaded) {
    prodSsrLoaded = true;
    try {
      const ssrBundlePath = path.resolve(import.meta.dirname, "server", "entry-server.js");
      if (fs.existsSync(ssrBundlePath)) {
        const mod = await import(ssrBundlePath);
        prodSsrRender = mod.render;
      }
    } catch (err) {
      log.warn({ err }, "production SSR bundle load failed for hub render");
    }
  }
  return prodSsrRender;
}

function resolveIndexHtmlPath(): string | null {
  const distPath = path.resolve(import.meta.dirname, "public", "index.html");
  if (fs.existsSync(distPath)) return distPath;
  const devPath = path.resolve(import.meta.dirname, "..", "client", "index.html");
  if (fs.existsSync(devPath)) return devPath;
  return null;
}

export type RenderHubHtmlResult = {
  html: string;
  status: number;
  fromCache: boolean;
};

/**
 * Render a public hub page as anonymous live HTML. Uses HTML cache on hit;
 * on miss runs SSR and optionally populates the cache (same key as public traffic).
 */
export async function renderHubHtml(opts: {
  site: SiteContext;
  pathname: string;
  variantKey?: string;
  writeCache?: boolean;
}): Promise<RenderHubHtmlResult | null> {
  const clean = opts.pathname.split("?")[0].split("#")[0] || "/";
  if (clean.startsWith("/private/")) return null;

  const variantKey = opts.variantKey && opts.variantKey !== "default" ? opts.variantKey : "live";
  const siteId =
    opts.site.contentRootName || opts.site.contentRoot || opts.site.domain || "default";
  const cacheKey = buildHtmlCacheKey(siteId, clean, variantKey);

  const cached = getCachedHtml(cacheKey);
  if (cached) {
    return { html: cached.html, status: cached.status, fromCache: true };
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
    const appHtml = await render(url, initialDataPayload);
    let html = indexHtml.replace(
      '<div id="root"></div>',
      `<div id="root">${appHtml}</div>`,
    );

    const preloadTags = buildPreloadTags(resolvePreloadHints(initialDataPayload));
    html = injectPreloadTags(html, preloadTags);
    html = injectSsrMetaTags(html, initialDataPayload, opts.site.contentRoot, url);
    html = applyEntryModulePreload(html);

    if (initialDataPayload) {
      const scriptTag = `<script id="__INITIAL_DATA__" type="application/json">${JSON.stringify(initialDataPayload).replace(/</g, "\\u003c")}</script>`;
      html = html.replace("</body>", scriptTag + "\n</body>");
    }

    if (opts.writeCache !== false) {
      setCachedHtml(cacheKey, html, status);
    }

    return { html, status, fromCache: false };
  } catch (err) {
    log.warn({ err, pathname: clean }, "renderHubHtml failed");
    return null;
  }
}
