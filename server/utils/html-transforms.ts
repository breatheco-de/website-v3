/**
 * Public-page modulepreload policy.
 *
 * SSR HTML paints from CSS (+ images). Hydration JS must still arrive in parallel
 * or the navbar stays dead until the entry parses and then discovers its static
 * deps in a second wave (production blink / TTI gap).
 *
 * Keep every Vite-injected `/assets/*.js` modulepreload (the entry's static graph).
 * Do NOT mark them fetchpriority=low — that demotes hydrate behind image preloads.
 * Admin-only routes stay out of this graph via code-splitting, not by stripping
 * tags the entry actually needs (framer, lucide, tanstack, …).
 */

function modulepreloadHref(tag: string): string {
  return /href=["']([^"']+)["']/i.exec(tag)?.[1] ?? "";
}

function shouldKeepModulePreload(href: string): boolean {
  if (!href) return false;
  return /\/assets\/[^/"'\s>]+\.(?:mjs|js)\b/i.test(href);
}

function modulepreloadTag(href: string): string {
  return `<link rel="modulepreload" crossorigin href="${href}">`;
}

/**
 * Normalize Vite entry modulepreloads: keep the static graph, dedupe, ensure the
 * main entry script has a modulepreload when missing.
 */
export function applyEntryModulePreload(html: string): string {
  html = html.replace(
    /(<script type="module" crossorigin src="(\/assets\/index-[^"]+\.js)"><\/script>)/g,
    (match, _full, src) => {
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
