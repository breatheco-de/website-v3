/**
 * Redirects are saved on the page visitors are sent to (its `meta.redirects`),
 * whatever that page's source is. Destinations that are not a page on this site
 * go to `custom-redirects.yml` (the caller handles that case).
 */

import fs from "fs";
import path from "path";
import yaml from "js-yaml";
import { escapeTemplateVars, unescapeObjectVars } from "@shared/templateVars";
import { dumpContentYaml } from "./content-yaml";
import type { ContentIndex } from "./content-index";
import { entryLocaleFilePath, findEntryPresence, typeLocales } from "./entry-layer";

export type RedirectOnPageResult =
  | {
      kind: "page";
      /** Content-root-relative paths of the files written. */
      files: string[];
      /** Subset of `files` that did not exist before this write. */
      created: string[];
      /** Languages the type publishes where the destination page does not exist. */
      skippedLocales: string[];
    }
  | { kind: "not_page" }
  | { kind: "error"; status: number; error: string; code?: string };

function redirectPath(r: unknown): string {
  if (typeof r === "string") return r.toLowerCase();
  if (r && typeof r === "object" && "path" in r) return String((r as { path: unknown }).path).toLowerCase();
  return "";
}

/**
 * Find the destination page for `destUrl` and add `from` to its `meta.redirects`.
 * One language: that language's `{locale}.yml` (created when the page exists there
 * but has no file). All languages: the page's `_common.yml`, which redirects to each
 * language's URL; languages without the page are reported in `skippedLocales`.
 */
export function writeRedirectOnDestinationPage(opts: {
  ci: ContentIndex;
  destUrl: string;
  from: string;
  statusCode: number;
  allLanguages: boolean;
  onWrite?: (absPath: string) => void;
}): RedirectOnPageResult {
  const { ci } = opts;
  const parsed = ci.parseContentUrl(opts.destUrl);
  if (!parsed) return { kind: "not_page" };
  const { contentType, locale } = parsed;
  const presence = findEntryPresence(ci, contentType, parsed.slug);
  if (!presence) return { kind: "not_page" };

  const present = Object.keys(presence.localeSlugs);
  const skippedLocales = opts.allLanguages
    ? typeLocales(contentType, ci.contentRoot).filter((l) => !present.includes(l))
    : [];

  let filePath: string;
  if (opts.allLanguages) {
    const folderSlug = presence.localeSlugs[locale] ?? presence.localeSlugs[present[0]!]!;
    filePath = path.join(path.dirname(entryLocaleFilePath(ci, contentType, folderSlug, locale)), "_common.yml");
  } else {
    const localeSlug = presence.localeSlugs[locale];
    if (!localeSlug) {
      return {
        kind: "error",
        status: 404,
        code: "destination_missing_in_language",
        error: `The destination page does not exist in "${locale}".`,
      };
    }
    filePath = entryLocaleFilePath(ci, contentType, localeSlug, locale);
  }

  const existed = fs.existsSync(filePath);
  const data = existed ? readPageYaml(filePath) : {};
  const meta = (data.meta && typeof data.meta === "object" ? data.meta : (data.meta = {})) as Record<string, unknown>;
  const redirects = (Array.isArray(meta.redirects) ? meta.redirects : (meta.redirects = [])) as unknown[];
  const rel = contentRelPath(ci, filePath);

  if (redirects.some((r) => redirectPath(r) === opts.from)) {
    return { kind: "error", status: 409, error: `Redirect "${opts.from}" already exists in ${rel}` };
  }
  redirects.push(opts.statusCode !== 301 ? { path: opts.from, status: opts.statusCode } : opts.from);

  writePageYaml(filePath, data);
  opts.onWrite?.(filePath);

  return { kind: "page", files: [rel], created: existed ? [] : [rel], skippedLocales };
}

export function contentRelPath(ci: ContentIndex, absPath: string): string {
  return path.relative(path.dirname(ci.contentRoot), absPath).split(path.sep).join("/");
}

export function readPageYaml(filePath: string): Record<string, unknown> {
  const { escaped, map } = escapeTemplateVars(fs.readFileSync(filePath, "utf-8"));
  return (unescapeObjectVars(yaml.load(escaped), map) as Record<string, unknown>) || {};
}

export function writePageYaml(filePath: string, data: Record<string, unknown>): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, dumpContentYaml(data, { lineWidth: -1, noRefs: true }, filePath), "utf-8");
}

/** `{ path, status }` of one `meta.redirects` item (strings are 301). */
export function parseRedirectItem(r: unknown): { path: string; status: number } | null {
  if (typeof r === "string" && r.trim()) return { path: r.trim(), status: 301 };
  if (r && typeof r === "object" && "path" in r) {
    const p = String((r as { path: unknown }).path ?? "").trim();
    const s = Number((r as { status?: unknown }).status);
    return p ? { path: p, status: s === 302 ? 302 : 301 } : null;
  }
  return null;
}
