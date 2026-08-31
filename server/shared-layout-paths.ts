/**
 * Disk-aware shared-layout shell path resolve (prefer template.*, fall back to single.*).
 */

import fs from "fs";
import path from "path";
import {
  COMMON_TEMPLATE_BASENAME,
  LEGACY_COMMON_SINGLE_BASENAME,
  LIVE_SHELL_BASENAME_RE,
  VARIANT_SHELL_BASENAME_RE,
  commonTemplateBasenameCandidates,
  liveTemplateBasename,
  legacyLiveSingleBasename,
  variantTemplateBasename,
  legacyVariantSingleBasename,
  shellBasenameCandidates,
} from "@shared/sharedLayoutPaths";

export {
  TEMPLATE_VERSIONING_SLUG,
  LEGACY_TEMPLATE_VERSIONING_SLUG,
  LAYOUT_TARGET_TYPE_TEMPLATE,
  LAYOUT_TARGET_TYPE_SINGLE,
  COMMON_TEMPLATE_BASENAME,
  LEGACY_COMMON_SINGLE_BASENAME,
  COMMON_TEMPLATE_RAW_SLUG,
  LEGACY_COMMON_SINGLE_RAW_SLUG,
  liveTemplateBasename,
  legacyLiveSingleBasename,
  variantTemplateBasename,
  legacyVariantSingleBasename,
  commonTemplateBasename,
  legacyCommonSingleBasename,
  isTemplateVersioningSlug,
  isReservedTemplateVariantSlug,
  isTypeLayoutTarget,
  normalizeTypeLayoutTarget,
  isSharedTemplateBasename,
  isCommonTemplateRawSlug,
  LIVE_SHELL_BASENAME_RE,
  VARIANT_SHELL_BASENAME_RE,
  migrateShellBasename,
  shellBasenameCandidates,
  commonTemplateBasenameCandidates,
} from "@shared/sharedLayoutPaths";

export type {
  TypeLayoutTarget,
  LayoutTarget,
} from "@shared/sharedLayoutPaths";

/**
 * Resolve layout-defaults path: prefer `_common.template.yml`, else `_common.single.yml`.
 * Returns preferred write path when neither exists (for creates).
 */
export function resolveCommonTemplatePath(
  typeDir: string,
  opts?: { forWrite?: boolean },
): string {
  const [preferred, legacy] = commonTemplateBasenameCandidates().map((n) =>
    path.join(typeDir, n),
  );
  if (opts?.forWrite) return preferred;
  if (fs.existsSync(preferred)) return preferred;
  if (fs.existsSync(legacy)) return legacy;
  return preferred;
}

/**
 * Resolve live (or variant) shell path for a locale.
 * Prefer template.*; fall back to single.*; forWrite always returns template.*.
 */
export function resolveTemplateLocalePath(
  typeDir: string,
  locale: string,
  opts?: { variant?: string; forWrite?: boolean; fallbackLocale?: string },
): string {
  const variant = opts?.variant;
  const fallbackLocale =
    opts?.fallbackLocale === undefined ? "en" : opts.fallbackLocale;

  const pathFor = (loc: string, forWrite: boolean): string => {
    const names = shellBasenameCandidates(loc, variant);
    if (forWrite) return path.join(typeDir, names[0]);
    for (const n of names) {
      const p = path.join(typeDir, n);
      if (fs.existsSync(p)) return p;
    }
    return path.join(typeDir, names[0]);
  };

  if (opts?.forWrite) return pathFor(locale, true);

  const primary = pathFor(locale, false);
  if (fs.existsSync(primary)) return primary;

  if (fallbackLocale && fallbackLocale !== locale) {
    const fb = pathFor(fallbackLocale, false);
    if (fs.existsSync(fb)) return fb;
  }
  return primary;
}

/** Whether a live shell exists for locale (either naming). */
export function hasLiveTemplateLocale(
  typeDir: string,
  locale: string,
  variant?: string,
): boolean {
  for (const n of shellBasenameCandidates(locale, variant)) {
    if (fs.existsSync(path.join(typeDir, n))) return true;
  }
  return false;
}

/**
 * List sibling live-shell locales under typeDir (template.* or single.*),
 * excluding `sourceLocale` when provided.
 */
export function listLiveShellLocales(
  typeDir: string,
  sourceLocale?: string,
): string[] {
  if (!fs.existsSync(typeDir)) return [];
  const locales = new Set<string>();
  for (const name of fs.readdirSync(typeDir)) {
    const m = LIVE_SHELL_BASENAME_RE.exec(name);
    if (!m) continue;
    const loc = m[1];
    if (sourceLocale && loc === sourceLocale) continue;
    locales.add(loc);
  }
  return [...locales];
}

/**
 * Absolute paths of live shells for other locales (prefer template.* path when both exist).
 */
export function listSiblingLiveShellPaths(
  typeDir: string,
  sourceLocale: string,
): string[] {
  if (!fs.existsSync(typeDir)) return [];
  const byLocale = new Map<string, { template?: string; single?: string }>();
  for (const name of fs.readdirSync(typeDir)) {
    const m = LIVE_SHELL_BASENAME_RE.exec(name);
    if (!m) continue;
    const loc = m[1];
    if (loc === sourceLocale) continue;
    const entry = byLocale.get(loc) ?? {};
    const abs = path.join(typeDir, name);
    if (/^template\./i.test(name)) entry.template = abs;
    else entry.single = abs;
    byLocale.set(loc, entry);
  }
  return [...byLocale.values()].map((e) => e.template ?? e.single!).filter(Boolean);
}

/** All live-shell absolute paths (prefer template when both). */
export function listAllLiveShellPaths(typeDir: string): string[] {
  if (!fs.existsSync(typeDir)) return [];
  const byLocale = new Map<string, { template?: string; single?: string }>();
  for (const name of fs.readdirSync(typeDir)) {
    const m = LIVE_SHELL_BASENAME_RE.exec(name);
    if (!m) continue;
    const loc = m[1];
    const entry = byLocale.get(loc) ?? {};
    const abs = path.join(typeDir, name);
    if (/^template\./i.test(name)) entry.template = abs;
    else entry.single = abs;
    byLocale.set(loc, entry);
  }
  return [...byLocale.values()].map((e) => e.template ?? e.single!).filter(Boolean);
}

/**
 * Warn when both naming conventions exist for the same locale/variant key.
 */
export function bothShellNamingWarnings(typeDir: string): string[] {
  if (!fs.existsSync(typeDir)) return [];
  const warnings: string[] = [];
  const live = new Map<string, Set<string>>();
  const variants = new Map<string, Set<string>>();

  for (const name of fs.readdirSync(typeDir)) {
    const liveM = LIVE_SHELL_BASENAME_RE.exec(name);
    if (liveM) {
      const loc = liveM[1];
      const set = live.get(loc) ?? new Set();
      set.add(/^template\./i.test(name) ? "template" : "single");
      live.set(loc, set);
      continue;
    }
    const varM = VARIANT_SHELL_BASENAME_RE.exec(name);
    if (varM) {
      const key = `${varM[1]}.${varM[2]}`;
      const set = variants.get(key) ?? new Set();
      set.add(/^template\./i.test(name) ? "template" : "single");
      variants.set(key, set);
    }
  }

  for (const [loc, set] of live) {
    if (set.has("template") && set.has("single")) {
      warnings.push(
        `Both ${liveTemplateBasename(loc)} and ${legacyLiveSingleBasename(loc)} exist; prefer template.* and delete the legacy single.* file.`,
      );
    }
  }
  for (const [key, set] of variants) {
    if (set.has("template") && set.has("single")) {
      const [variant, loc] = key.split(".");
      warnings.push(
        `Both ${variantTemplateBasename(variant, loc)} and ${legacyVariantSingleBasename(variant, loc)} exist; prefer template.* and delete the legacy single.* file.`,
      );
    }
  }

  const hasTplCommon = fs.existsSync(path.join(typeDir, COMMON_TEMPLATE_BASENAME));
  const hasLegCommon = fs.existsSync(path.join(typeDir, LEGACY_COMMON_SINGLE_BASENAME));
  if (hasTplCommon && hasLegCommon) {
    warnings.push(
      `Both ${COMMON_TEMPLATE_BASENAME} and ${LEGACY_COMMON_SINGLE_BASENAME} exist; prefer ${COMMON_TEMPLATE_BASENAME} and delete the legacy file.`,
    );
  }

  return warnings;
}
