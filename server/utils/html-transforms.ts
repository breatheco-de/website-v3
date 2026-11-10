/**
 * Public-page head asset policy.
 *
 * Cold first paint needs render-blocking CSS before the JS module graph.
 * Vite's built index.html often lists the entry script + dozens of
 * modulepreloads *before* the stylesheet; hydrate still needs those JS
 * hints (without fetchpriority=low) so the SSR navbar is not dead while
 * the entry discovers deps in a second wave.
 *
 * Pipeline: normalize modulepreloads → inject extras after stylesheet →
 * inject theme → prioritizeRenderBlockingCss (hoists CSS/theme early).
 */

import { THEME_OVERRIDES_STYLE_ID } from "@shared/theme-palette";

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
 * Keep every Vite-injected `/assets/*.js` modulepreload (entry static graph).
 * Do NOT mark them fetchpriority=low — that demotes hydrate behind images.
 * Dedupes and ensures the main entry script has a modulepreload when missing.
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

const THEME_STYLE_RE = new RegExp(
  `<style\\b[^>]*\\bid=["']${THEME_OVERRIDES_STYLE_ID}["'][^>]*>[\\s\\S]*?<\\/style>\\s*`,
  "i",
);
const STYLESHEET_RE = /<link\b[^>]*\brel=["']stylesheet["'][^>]*>\s*/gi;
const CRITICAL_PAINT_ID = "critical-paint";
const CRITICAL_PAINT_STYLE =
  `<style id="${CRITICAL_PAINT_ID}">html,body{margin:0;background:#fff}</style>`;

/**
 * Move stylesheets + theme overrides (and a tiny fallback paint) to the top of
 * `<head>` so cold loads paint before downloading the modulepreload storm.
 */
export function prioritizeRenderBlockingCss(html: string): string {
  const headOpen = html.match(/<head\b[^>]*>/i);
  if (!headOpen || headOpen.index == null) return html;
  const headOpenEnd = headOpen.index + headOpen[0].length;
  const headClose = html.search(/<\/head>/i);
  if (headClose < 0 || headClose <= headOpenEnd) return html;

  let headInner = html.slice(headOpenEnd, headClose);
  const moved: string[] = [];

  headInner = headInner.replace(THEME_STYLE_RE, (tag) => {
    moved.push(tag.trim());
    return "";
  });

  headInner = headInner.replace(STYLESHEET_RE, (tag) => {
    moved.push(tag.trim());
    return "";
  });

  // Drop a previous critical-paint if we re-run; re-add once at the front.
  headInner = headInner.replace(
    new RegExp(`<style\\b[^>]*\\bid=["']${CRITICAL_PAINT_ID}["'][^>]*>[\\s\\S]*?<\\/style>\\s*`, "i"),
    "",
  );

  if (!moved.length && !html.includes(`id="${CRITICAL_PAINT_ID}"`)) {
    // Still inject fallback even when Vite CSS is missing (dev shell).
    const insert = `\n${CRITICAL_PAINT_STYLE}\n`;
    return html.slice(0, headOpenEnd) + insert + headInner + html.slice(headClose);
  }

  const hasTheme = moved.some((t) => t.includes(THEME_OVERRIDES_STYLE_ID));
  const prefix = [
    CRITICAL_PAINT_STYLE,
    ...moved,
  ].join("\n");

  // Theme vars usually set --background; critical white is a cold-load floor.
  void hasTheme;

  return (
    html.slice(0, headOpenEnd) +
    `\n${prefix}\n` +
    headInner +
    html.slice(headClose)
  );
}

/** Exported for unit tests. */
export function __testShouldKeepModulePreload(href: string): boolean {
  return shouldKeepModulePreload(href);
}
