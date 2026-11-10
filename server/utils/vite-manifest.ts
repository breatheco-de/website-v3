import fs from "fs";
import path from "path";
import { child as loggerChild } from "../logger";

const manifestLogger = loggerChild({ module: "vite-manifest" });

export interface ManifestEntryAssets {
  js: string[];
  css: string[];
}

let cachedAssets: ManifestEntryAssets | null = null;

/**
 * Reads the Vite build manifest once at startup (cached) and returns the JS
 * and CSS asset paths for all entry chunks (`isEntry: true`).
 *
 * Returns empty arrays if the manifest is absent (e.g. dev or partial build)
 * so callers can skip injection without crashing.
 */
export function getEntryAssets(distPublicPath: string): ManifestEntryAssets {
  if (cachedAssets) return cachedAssets;

  const manifestPath = path.join(distPublicPath, ".vite", "manifest.json");

  if (!fs.existsSync(manifestPath)) {
    manifestLogger.warn({ manifestPath }, "Vite manifest not found — skipping preload injection");
    cachedAssets = { js: [], css: [] };
    return cachedAssets;
  }

  try {
    const raw = fs.readFileSync(manifestPath, "utf-8");
    const manifest: Record<string, { file: string; isEntry?: boolean; css?: string[] }> = JSON.parse(raw);

    const js: string[] = [];
    const css: string[] = [];

    for (const chunk of Object.values(manifest)) {
      if (!chunk.isEntry) continue;
      if (chunk.file) js.push("/" + chunk.file);
      for (const cssFile of chunk.css ?? []) {
        css.push("/" + cssFile);
      }
    }

    cachedAssets = { js, css };
    manifestLogger.info({ js, css }, "Vite manifest loaded — entry assets resolved");
  } catch (err) {
    manifestLogger.warn({ err }, "Failed to parse Vite manifest — skipping preload injection");
    cachedAssets = { js: [], css: [] };
  }

  return cachedAssets;
}

/** Build `<link>` modulepreload tags for entry chunks.
 * CSS is intentionally NOT preloaded here: the blocking <link rel="stylesheet"> in
 * <head> must win discovery. serveStatic injects these tags *after* the first
 * stylesheet so the modulepreload storm does not delay render-blocking CSS.
 * JS preloads are marked fetchpriority=low: with SSR body HTML, scripts are only
 * needed for hydration. */
export function buildEntryPreloadTags(assets: ManifestEntryAssets): string {
  const tags: string[] = [];
  for (const href of assets.js) {
    tags.push(`<link rel="modulepreload" crossorigin href="${escapeAttr(href)}" fetchpriority="low">`);
  }
  return tags.join("\n");
}

/** Build the HTTP `Link:` header value for entry chunks (JS only, see above). */
export function buildEntryLinkHeader(assets: ManifestEntryAssets): string {
  const parts: string[] = [];
  for (const href of assets.js) {
    parts.push(`<${escapeAttr(href)}>; rel=modulepreload; crossorigin; fetchpriority=low`);
  }
  return parts.join(", ");
}

function escapeAttr(s: string): string {
  return s.replace(/"/g, "&quot;");
}
