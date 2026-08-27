/**
 * Draft-first entry helpers.
 *
 * An entry is a draft when it has no live `{locale}.yml` files.
 * Draft content lives in `{variant}.{locale}.yml` + versioning.yml at 0% allocation.
 * Shared-layout / template types are excluded from draft-first create.
 */

import fs from "fs";
import path from "path";
import yaml from "js-yaml";
import {
  VARIANT_SHELL_BASENAME_RE,
  liveTemplateBasename,
} from "@shared/sharedLayoutPaths";
import { getFolder, getContentTypeConfig } from "./content-types";
import { isSharedLayoutType, isTemplateVersioningSlug } from "./shared-layout-entry";
import { hasLiveTemplateLocale } from "./shared-layout-paths";
import { getDefaultContentRoot } from "./site-config";
import { getSupportedLocales } from "./settings";
import { markFileAsModified } from "./sync-state";

export const DEFAULT_DRAFT_VARIANT = "draft";

const LIVE_LOCALE_RE = /^[a-z]{2}(-[a-z]{2})?$/;

export function usesDraftFirstCreate(contentType: string, contentRoot?: string): boolean {
  if (isSharedLayoutType(contentType, contentRoot)) return false;
  const config = getContentTypeConfig(contentType, contentRoot);
  if (!config || config.database?.slug) return false;
  return true;
}

export function getEntryContentDir(
  contentType: string,
  slug: string,
  contentRoot?: string,
): string {
  const root = contentRoot ?? getDefaultContentRoot();
  const folder = getFolder(contentType, root);
  if (isTemplateVersioningSlug(slug)) {
    return path.join(root, folder);
  }
  return path.join(root, folder, slug);
}

export function liveLocaleFileName(locale: string, templateMode = false): string {
  return templateMode ? liveTemplateBasename(locale) : `${locale}.yml`;
}

export function hasLiveLocaleFile(
  contentDir: string,
  locale: string,
  templateMode = false,
): boolean {
  if (templateMode) return hasLiveTemplateLocale(contentDir, locale);
  return fs.existsSync(path.join(contentDir, liveLocaleFileName(locale, false)));
}

/** True when the entry has at least one live locale file (published). */
export function hasAnyLiveLocale(
  contentDir: string,
  templateMode = false,
  locales: string[] = getSupportedLocales(),
): boolean {
  if (!fs.existsSync(contentDir)) return false;
  if (templateMode) {
    return locales.some((loc) => hasLiveLocaleFile(contentDir, loc, true));
  }
  try {
    const files = fs.readdirSync(contentDir);
    return files.some((f) => {
      if (!f.endsWith(".yml") && !f.endsWith(".yaml")) return false;
      const stem = f.replace(/\.ya?ml$/, "");
      return LIVE_LOCALE_RE.test(stem);
    });
  } catch {
    return false;
  }
}

/** Entry-level draft: folder exists but no live locale files. */
export function isDraftEntry(
  contentType: string,
  slug: string,
  contentRoot?: string,
): boolean {
  if (isSharedLayoutType(contentType, contentRoot) && !isTemplateVersioningSlug(slug)) {
    // Attached shared-layout entries are never draft-first at entry level
    return false;
  }
  const dir = getEntryContentDir(contentType, slug, contentRoot);
  if (!fs.existsSync(dir)) return false;
  return !hasAnyLiveLocale(dir, isTemplateVersioningSlug(slug));
}

export function listLiveLocales(contentDir: string, templateMode = false): string[] {
  if (!fs.existsSync(contentDir)) return [];
  if (templateMode) {
    return getSupportedLocales().filter((loc) => hasLiveLocaleFile(contentDir, loc, true));
  }
  try {
    return fs
      .readdirSync(contentDir)
      .map((f) => f.replace(/\.ya?ml$/, ""))
      .filter((stem) => LIVE_LOCALE_RE.test(stem));
  } catch {
    return [];
  }
}

/** Locales that have at least one `{variant}.{locale}.yml` draft/variant file. */
export function listDraftLocales(contentDir: string, templateMode = false): string[] {
  if (!fs.existsSync(contentDir)) return [];
  const found = new Set<string>();
  try {
    for (const f of fs.readdirSync(contentDir)) {
      if (!f.endsWith(".yml") && !f.endsWith(".yaml")) continue;
      const stem = f.replace(/\.ya?ml$/, "");
      if (templateMode) {
        const m = VARIANT_SHELL_BASENAME_RE.exec(f);
        if (m) found.add(m[2]);
      } else {
        const m = stem.match(/^([a-z0-9-]+)\.([a-z]{2}(?:-[a-z]{2})?)$/);
        if (m && m[1] !== "versioning") found.add(m[2]);
      }
    }
  } catch {
    return [];
  }
  return [...found];
}

/** Variant slugs present for a locale (entry mode). */
export function listVariantSlugsForLocale(
  contentDir: string,
  locale: string,
  templateMode = false,
): string[] {
  if (!fs.existsSync(contentDir)) return [];
  const slugs: string[] = [];
  try {
    for (const f of fs.readdirSync(contentDir)) {
      if (!f.endsWith(".yml") && !f.endsWith(".yaml")) continue;
      const stem = f.replace(/\.ya?ml$/, "");
      if (templateMode) {
        const m = VARIANT_SHELL_BASENAME_RE.exec(f);
        if (m && m[2] === locale) slugs.push(m[1]);
      } else {
        const m = stem.match(new RegExp(`^([a-z0-9-]+)\\.${locale}$`));
        if (m) slugs.push(m[1]);
      }
    }
  } catch {
    return [];
  }
  return slugs;
}

/** Count remaining draft/variant files across all locales (entry mode). */
export function countVariantFiles(contentDir: string, templateMode = false): number {
  if (!fs.existsSync(contentDir)) return 0;
  let n = 0;
  try {
    for (const f of fs.readdirSync(contentDir)) {
      if (!f.endsWith(".yml") && !f.endsWith(".yaml")) continue;
      const stem = f.replace(/\.ya?ml$/, "");
      if (templateMode) {
        if (VARIANT_SHELL_BASENAME_RE.test(f)) n++;
      } else if (/^[a-z0-9-]+\.[a-z]{2}(?:-[a-z]{2})?$/.test(stem)) {
        n++;
      }
    }
  } catch {
    return 0;
  }
  return n;
}

export type VersioningFileShape = Record<string, { variants: Array<{ slug: string; allocation: number }> }>;

export function buildDraftVersioning(
  locales: string[],
  draftVariant: string = DEFAULT_DRAFT_VARIANT,
): VersioningFileShape {
  const out: VersioningFileShape = {};
  for (const loc of locales) {
    out[loc] = { variants: [{ slug: draftVariant, allocation: 0 }] };
  }
  return out;
}

export function writeVersioningFile(
  contentDir: string,
  data: VersioningFileShape,
  relPathForSync: string,
  author?: string,
  contentRoot?: string,
): void {
  const filePath = path.join(contentDir, "versioning.yml");
  const content = yaml.dump(data, { lineWidth: 120, noRefs: true, sortKeys: false });
  fs.writeFileSync(filePath, content, "utf-8");
  markFileAsModified(relPathForSync, author, undefined, contentRoot);
}

/**
 * Reject writing the live locale file when the entry is still a draft
 * and no variant was supplied.
 */
export function rejectLiveWriteIfDraft(opts: {
  contentType: string;
  slug: string;
  locale: string;
  variant?: string;
  contentRoot?: string;
  templateMode?: boolean;
}): { ok: true } | { ok: false; error: string; statusCode: number } {
  const { contentType, slug, locale, variant, contentRoot, templateMode = false } = opts;
  if (variant && variant !== "" && variant !== "default") {
    return { ok: true };
  }
  // Shared-layout types excluded from draft-first
  if (usesDraftFirstCreate(contentType, contentRoot) === false && isSharedLayoutType(contentType, contentRoot)) {
    return { ok: true };
  }
  if (!usesDraftFirstCreate(contentType, contentRoot)) {
    return { ok: true };
  }
  const dir = getEntryContentDir(contentType, slug, contentRoot);
  if (!fs.existsSync(dir)) {
    return { ok: true };
  }
  if (hasAnyLiveLocale(dir, templateMode)) {
    return { ok: true };
  }
  // Draft entry — must not create live locale without variant
  if (!hasLiveLocaleFile(dir, locale, templateMode)) {
    return {
      ok: false,
      statusCode: 400,
      error:
        `Entry "${slug}" is a draft (no live locale files). ` +
        `Pass variant (e.g. "${DEFAULT_DRAFT_VARIANT}") to edit draft content, or publish first.`,
    };
  }
  return { ok: true };
}

export function findSourceDraftVariant(
  contentDir: string,
  locale: string,
  preferred?: string,
  templateMode = false,
): string | null {
  const slugs = listVariantSlugsForLocale(contentDir, locale, templateMode);
  if (slugs.length === 0) return null;
  if (preferred && slugs.includes(preferred)) return preferred;
  if (slugs.includes(DEFAULT_DRAFT_VARIANT)) return DEFAULT_DRAFT_VARIANT;
  return slugs[0];
}
