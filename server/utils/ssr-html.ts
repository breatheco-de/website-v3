import {
  injectSsrMetaTags,
  resolvePreloadHints,
  type InitialDataPayload,
  type PreloadHint,
} from "../initial-data-middleware";
import { injectSsrSchemaHtml } from "../ssr-schema";
import { buildInitialDataScriptTag, insertBefore, replaceLiteral } from "./html-inject";

/**
 * The public router paints this while `/api/content-types` has no data yet.
 * `/en/home` does not match a page route until that list exists, so the whole
 * document is the loading shell. It has HTML tags, but it is not a page.
 */
export function isContentTypeLoadingShell(appHtml: string | null | undefined): boolean {
  if (typeof appHtml !== "string" || !appHtml) return false;
  return /role=["']status["']/.test(appHtml) && />\s*Loading\.\.\.\s*<\/span>/.test(appHtml);
}

/**
 * True when the seeded payload includes a non-empty content-type list.
 * Without it the router cannot match real URLs and must not be stored.
 */
export function contentTypesReadyForHtmlCache(payload: InitialDataPayload | null | undefined): boolean {
  const queries = payload?.queries;
  if (!Array.isArray(queries)) return false;
  const row = queries.find(
    (query) => Array.isArray(query.queryKey) && query.queryKey[0] === "/api/content-types",
  );
  return Array.isArray(row?.data) && row.data.length > 0;
}

/**
 * True when SSR produced real body markup (not Suspense-null / whitespace-only).
 * Empty appHtml must not be injected into #root or HTML-cached as a successful page.
 */
export function isMeaningfulSsrAppHtml(appHtml: string | null | undefined): boolean {
  if (typeof appHtml !== "string") return false;
  if (isContentTypeLoadingShell(appHtml)) return false;
  const trimmed = appHtml.replace(/<!--[\s\S]*?-->/g, "").trim();
  if (!trimmed) return false;
  // Require at least one HTML tag (section wrappers, headings, etc.)
  return /<[a-zA-Z]/.test(trimmed);
}

export function buildPreloadTags(hints: PreloadHint[]): string {
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

export function injectPreloadTags(html: string, preloadTags: string): string {
  if (!preloadTags) return html;
  return insertBefore(html, "</head>", preloadTags + "\n");
}

/**
 * Language, title, description, canonical and social tags for the client-only
 * fallback (server render failed or was skipped). Never throws: the fallback must
 * still be served when the page data is missing or odd.
 */
export function injectFallbackHead(
  html: string,
  payload: InitialDataPayload | null,
  contentRoot: string | undefined,
  url: string,
): string {
  if (!payload) return html;
  try {
    return injectSsrMetaTags(html, payload, contentRoot, url);
  } catch {
    return html;
  }
}

/**
 * Build the SSR document from the index.html shell: #root body, image preloads,
 * meta tags, optional schema head fragment, and `__INITIAL_DATA__`.
 * Every injection inserts content literally — CMS copy may contain `$&`, `$1`, etc.
 */
export function assembleSsrDocument(opts: {
  template: string;
  appHtml: string | null;
  payload: InitialDataPayload | null;
  contentRoot?: string;
  url: string;
  ssrSchemaHtml?: string;
}): string {
  let html = opts.appHtml
    ? replaceLiteral(opts.template, '<div id="root"></div>', `<div id="root">${opts.appHtml}</div>`)
    : opts.template;

  html = injectPreloadTags(html, buildPreloadTags(resolvePreloadHints(opts.payload)));
  html = injectSsrMetaTags(html, opts.payload, opts.contentRoot, opts.url);

  if (opts.ssrSchemaHtml) {
    html = injectSsrSchemaHtml(html, opts.ssrSchemaHtml);
  }

  if (opts.payload) {
    html = insertBefore(html, "</body>", buildInitialDataScriptTag(opts.payload));
  }

  return html;
}
