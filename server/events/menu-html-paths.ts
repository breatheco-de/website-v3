/**
 * Which stored public URLs show a given menu. Type defaults use main-navbar
 * and main-footer when a slot is empty. An entry that picks another menu is
 * left out; an entry that picks this menu is included.
 */

import path from "path";
import { getLayout } from "../content-types";

const TOP_FALLBACK = "main-navbar";
const BOTTOM_FALLBACK = "main-footer";

export type MenuUsageRef = {
  contentType: string;
  slug: string;
  position: "top" | "bottom";
};

export type MenuPathIndex = {
  contentRoot: string;
  resolveUrl(url: string): {
    contentType: string;
    slug: string;
    patternLocale?: string;
  } | null;
  getContentTypeConfig(type: string): { directory?: string } | undefined;
  normalizeType?(type: string): string;
  getAllMenuUsage(): Map<string, MenuUsageRef[]>;
};

function normalize(ci: MenuPathIndex, type: string): string {
  return ci.normalizeType ? ci.normalizeType(type) : type;
}

function pageLocale(
  ci: MenuPathIndex,
  pathname: string,
  resolved: ReturnType<MenuPathIndex["resolveUrl"]>,
): string {
  if (resolved?.patternLocale && resolved.patternLocale !== "default") return resolved.patternLocale;
  if (pathname === "/es" || pathname.startsWith("/es/")) return "es";
  const match = pathname.match(/^\/([a-z]{2})(\/|$)/);
  if (match && match[1] !== "en" && match[1] !== "us") return match[1]!;
  return "en";
}

function effectiveMenus(
  ci: MenuPathIndex,
  contentType: string,
  slug: string,
): { top: string | null; bottom: string | null } {
  const layout = getLayout(contentType, ci.contentRoot).menu;
  let top = layout.top ?? TOP_FALLBACK;
  let bottom = layout.bottom ?? BOTTOM_FALLBACK;
  const directory = ci.getContentTypeConfig(contentType)?.directory;
  const dirName = directory ? path.basename(directory) : contentType;
  const typeName = normalize(ci, contentType);
  let usage: Map<string, MenuUsageRef[]>;
  try {
    usage = ci.getAllMenuUsage();
  } catch {
    usage = new Map();
  }

  const apply = (match: (ref: MenuUsageRef) => boolean) => {
    for (const [menuId, refs] of usage) {
      for (const ref of refs) {
        if (normalize(ci, ref.contentType) !== typeName) continue;
        if (!match(ref)) continue;
        if (ref.position === "top") top = menuId;
        if (ref.position === "bottom") bottom = menuId;
      }
    }
  };

  apply((ref) => ref.slug !== slug && (ref.slug === dirName || ref.slug === contentType || ref.slug === typeName));
  apply((ref) => ref.slug === slug);
  return { top, bottom };
}

function showsMenu(ci: MenuPathIndex, pathname: string, menuName: string): boolean {
  let resolved: ReturnType<MenuPathIndex["resolveUrl"]> = null;
  try {
    resolved = ci.resolveUrl(pathname);
  } catch {
    resolved = null;
  }
  if (!resolved) return menuName === TOP_FALLBACK || menuName === BOTTOM_FALLBACK;
  const menus = effectiveMenus(ci, resolved.contentType, resolved.slug);
  return menus.top === menuName || menus.bottom === menuName;
}

/** Stored pathnames on this site that render `menuName`. `locale` limits a translation save. */
export function pathsUsingMenu(
  ci: MenuPathIndex,
  pathnames: string[],
  menuName: string,
  locale?: string,
): string[] {
  if (!menuName) return [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const pathname of pathnames) {
    if (!pathname || seen.has(pathname)) continue;
    let resolved: ReturnType<MenuPathIndex["resolveUrl"]> = null;
    try {
      resolved = ci.resolveUrl(pathname);
    } catch {
      resolved = null;
    }
    if (locale && pageLocale(ci, pathname, resolved) !== locale) continue;
    if (!showsMenu(ci, pathname, menuName)) continue;
    seen.add(pathname);
    out.push(pathname);
  }
  return out;
}
