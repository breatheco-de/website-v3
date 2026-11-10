/**
 * Public-page modulepreload policy.
 *
 * With SSR HTML, first paint depends on CSS (+ images). JS is for hydration and
 * can arrive slightly later. Vite injects <link rel="modulepreload"> for every
 * static dependency of the entry; on mobile that storms the connection and
 * competes with render-blocking CSS / LCP.
 *
 * Keep only the entry + tiny runtime preloads. Drop admin/heavy split chunks
 * (framer, charts, …) and other static deps — the browser still loads them when
 * the entry graph executes; we just stop hinting them early.
 */

/** Allowlist: entry shell + bundler runtime only. */
const KEEP_MODULEPRELOAD_HREF =
  /\/assets\/(?:index|rolldown-runtime|vite|modulepreload-polyfill)(?:-[^/"'\s>]*)?\.(?:mjs|js)\b/i;

/** Explicit denylist for named manualChunks (belt-and-suspenders vs allowlist). */
const DROP_MODULEPRELOAD_HREF =
  /\/assets\/(?:framer|charts|icons-react|forms|date|carousel|markdown)(?:-[^/"'\s>]*)?\.js\b/i;

function modulepreloadHref(tag: string): string {
  return /href=["']([^"']+)["']/i.exec(tag)?.[1] ?? "";
}

function shouldKeepModulePreload(href: string): boolean {
  if (!href) return false;
  if (DROP_MODULEPRELOAD_HREF.test(href)) return false;
  return KEEP_MODULEPRELOAD_HREF.test(href);
}

function modulepreloadTag(href: string): string {
  return `<link rel="modulepreload" crossorigin href="${href}" fetchpriority="low">`;
}

/**
 * Demote / trim Vite entry modulepreloads so they do not starve CSS paint.
 * Also ensures the main entry script has a low-priority modulepreload.
 */
export function applyEntryModulePreload(html: string): string {
  html = html.replace(
    /(<script type="module" crossorigin src="(\/assets\/index-[^"]+\.js)"><\/script>)/g,
    (match, _full, src) => {
      // Avoid duplicating if Vite (or a prior pass) already preloaded the entry.
      if (
        new RegExp(
          `<link\\b[^>]*\\brel=["']modulepreload["'][^>]*\\bhref=["']${src.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}["']`,
          "i",
        ).test(html)
      ) {
        return match;
      }
      return `${modulepreloadTag(src)}${match}`;
    },
  );

  const seen = new Set<string>();
  html = html.replace(
    /<link\b[^>]*\brel=["']modulepreload["'][^>]*>\s*/gi,
    (tag) => {
      const href = modulepreloadHref(tag);
      if (!shouldKeepModulePreload(href)) return "";
      if (seen.has(href)) return "";
      seen.add(href);
      return `${modulepreloadTag(href)}\n`;
    },
  );

  return html;
}

/** Exported for unit tests. */
export function __testShouldKeepModulePreload(href: string): boolean {
  return shouldKeepModulePreload(href);
}
