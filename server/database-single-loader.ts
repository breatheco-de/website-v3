import * as fs from "fs";
import { getDefaultContentRoot } from "./site-config";
import * as path from "path";
import { contentIndex } from "./content-index";
import { deepMerge } from "./utils/deepMerge";
import { databaseManager, type DatabaseManager } from "./database";
import {
  getDatabaseName,
  getFolder,
  getLookupKey,
  getFieldMapping,
  getFullFieldMapping,
  getLocaleKey,
  getLocaleSource,
  hasDatabaseSingle,
  getContentTypeConfig,
  RESERVED_IMAGE_FIELD,
  RESERVED_SLUG_FIELD,
  RESERVED_LOCALE_FIELD,
  RESERVED_UPDATED_AT_FIELD,
  applyImageAliasToEntry,
  applySlugAliasToEntry,
  applyLocaleAliasToEntry,
  applyUpdatedAtAliasToEntry,
  finalizeSingleEntryForTemplates,
  resolveEntryUpdatedAt,
} from "./content-types";
import { resolveFieldValue, applyTransformIfNeeded } from "./transform";
import { fetchMarkdownContent } from "./markdown";
import { applyComponentSectionDefaults, applyComponentImageSizes } from "./component-registry";
import { readSectionAnchors, writeSectionAnchors } from "./utils/sectionAnchors";
import { canonicalSectionId, sectionIdCandidates } from "./utils/sectionIdentity";
import { applyPerEntryLayer, type PerEntryAccum } from "./section-merge";
import { applySectionLayoutDefaults } from "./section-layout-defaults";
import { isEntryDetached } from "./shared-layout-entry";
import {
  resolveCommonTemplatePath,
  resolveTemplateLocalePath,
} from "./shared-layout-paths";
import { applyFieldOverridesToItem, readFieldOverrides } from "./field-overrides";
import type { TemplatePage } from "@shared/schema";
import { ENTRY_OR_SINGLE_KEY_RE } from "@shared/entryTemplateVars";
import { child } from "./logger";
const log = child({ module: "database-single-loader" });

export type { PerEntryAccum } from "./section-merge";

export const TEMPLATE_EXPR_RE = /\{\{[\s\S]*?\}\}/;

/**
 * Editorial clocks on `template.{locale}.yml` describe the shared shell, not an entry.
 * When merging an attached entry, drop them so missing entry dates fall through to
 * the entry's own `published_at` / locale `updated_at` instead of the shell seed.
 */
const SHELL_EDITORIAL_DATE_KEYS = [
  "updated_at",
  RESERVED_UPDATED_AT_FIELD,
  "published_at",
] as const;

export function stripShellEditorialDates(data: Record<string, unknown>): void {
  for (const key of SHELL_EDITORIAL_DATE_KEYS) {
    delete data[key];
  }
}

export function extractVariableFields(
  obj: unknown,
  prefix = "",
): Record<string, string> {
  const result: Record<string, string> = {};
  if (typeof obj !== "object" || obj === null) return result;
  const entries: Array<[string, unknown]> = Array.isArray(obj)
    ? obj.map((v, i) => [String(i), v] as [string, unknown])
    : Object.entries(obj as Record<string, unknown>).filter(([k]) => !k.startsWith("_"));
  for (const [key, value] of entries) {
    const dotPath = prefix ? `${prefix}.${key}` : key;
    if (typeof value === "string" && TEMPLATE_EXPR_RE.test(value)) {
      result[dotPath] = value.trim();
    } else if (typeof value === "object" && value !== null) {
      Object.assign(result, extractVariableFields(value, dotPath));
    }
  }
  return result;
}

/**
 * Attach `_variableFields` / `_variableKeys` on sections that still contain
 * `{{ entry.* }}` / legacy `{{ single.* }}` expressions (before delivery-time resolution).
 * Needed for static single_template types as well as DB-backed singles.
 */
export function attachVariableFieldsToSections(sections: unknown[]): void {
  for (const section of sections) {
    if (!section || typeof section !== "object") continue;
    const variableFields = extractVariableFields(section);
    if (Object.keys(variableFields).length === 0) continue;
    (section as Record<string, unknown>)._variableFields = variableFields;
    const variableKeys: Record<string, string> = {};
    for (const [dotPath, expr] of Object.entries(variableFields)) {
      const m = ENTRY_OR_SINGLE_KEY_RE.exec(expr);
      if (m) variableKeys[dotPath] = m[1].trim();
      ENTRY_OR_SINGLE_KEY_RE.lastIndex = 0;
    }
    if (Object.keys(variableKeys).length > 0) {
      (section as Record<string, unknown>)._variableKeys = variableKeys;
    }
  }
}

export function mergeSingleTemplate(
  contentType: string,
  locale: string,
  slug?: string,
  accum?: PerEntryAccum,
  contentRoot?: string,
  /** When set, load `template.{variant}.{locale}.yml` (legacy `single.*`) instead of live shell. */
  templateVariant?: string,
  /**
   * When set, overlay `{variant}.{locale}.yml` from the entry folder (e.g. draft preview)
   * instead of live `{locale}.yml`. Attached entries still apply data-only (ignore sections).
   */
  entryVariant?: string,
): Record<string, unknown> | null {
  const resolvedRoot = contentRoot ?? getDefaultContentRoot();
  const folder = getFolder(contentType, resolvedRoot);
  const templateDir = path.join(resolvedRoot, folder);
  const singleCommonPath = resolveCommonTemplatePath(templateDir);
  const commonPath = path.join(templateDir, "_common.yml");
  const localePath = resolveTemplateLocalePath(templateDir, locale, {
    variant: templateVariant,
    fallbackLocale: "en",
  });
  if (!fs.existsSync(localePath)) return null;

  let baseData: Record<string, unknown> = {};
  if (fs.existsSync(singleCommonPath)) {
    const parsed = contentIndex.safeYamlLoad(fs.readFileSync(singleCommonPath, "utf-8"));
    if (parsed) {
      // Shared-layout: _common.template.yml is layout defaults only — never carry sections
      const { sections: _ignoredSections, ...rest } = parsed;
      if (_ignoredSections !== undefined) {
        log.warn(
          `[mergeSingleTemplate] Ignoring sections in layout defaults for ${contentType} (structure lives in template.{locale}.yml)`,
        );
      }
      baseData = rest;
    }
  }
  if (fs.existsSync(commonPath)) {
    const parsed = contentIndex.safeYamlLoad(fs.readFileSync(commonPath, "utf-8"));
    if (parsed) {
      const { sections: _ignoredSections, ...rest } = parsed;
      if (_ignoredSections !== undefined) {
        log.warn(
          `[mergeSingleTemplate] Ignoring sections in type _common.yml for ${contentType}`,
        );
      }
      baseData = Object.keys(baseData).length > 0 ? deepMerge(baseData, rest) : rest;
    }
  }
  const localeData = contentIndex.safeYamlLoad(fs.readFileSync(localePath, "utf-8"));
  if (!localeData) return null;
  let merged: Record<string, unknown> = Object.keys(baseData).length > 0
    ? deepMerge(baseData, localeData)
    : { ...localeData };

  // Entry merge: shell dates must not masquerade as the entry's editorial clock.
  if (slug) {
    stripShellEditorialDates(merged);
  }

  // Capture stable base-template section-id → index map BEFORE any per-entry layers
  // so that originalIndex values in accum.removedSections are always relative to the
  // immutable shared template, regardless of how many per-entry layers fire.
  if (slug && accum) {
    const baseSectionsSnapshot = Array.isArray(merged.sections)
      ? (merged.sections as Record<string, unknown>[])
      : [];
    const baseIndexById = new Map<string, number>();
    baseSectionsSnapshot.forEach((s, idx) => {
      const id = canonicalSectionId(s);
      if (id) baseIndexById.set(id, idx);
    });
    accum.baseIndexById = baseIndexById;
  }

  // Layer 4 & 5: per-entry YML overrides (only when slug is provided).
  // Each layer is applied sequentially so section directives from layer 4
  // (_common.yml) are not lost when layer 5 ({locale}.yml) also has sections.
  if (slug) {
    // Load alias map once (silently skipped if file doesn't exist)
    let aliases: Record<string, string | null> | undefined;
    try {
      const anchors = readSectionAnchors(contentType);
      if (Object.keys(anchors.aliases).length > 0) {
        // Step 5: clear stale aliases whose original section ID is now back in the template.
        // This handles the case where a section was deleted and then re-created with the same ID.
        const baseSectionIds = new Set<string>(
          Array.isArray(merged.sections)
            ? (merged.sections as Record<string, unknown>[]).flatMap((s) =>
                sectionIdCandidates(s),
              )
            : [],
        );
        const staleKeys = Object.keys(anchors.aliases).filter((k) => baseSectionIds.has(k));
        if (staleKeys.length > 0) {
          for (const k of staleKeys) delete anchors.aliases[k];
          try {
            writeSectionAnchors(contentType, anchors);
          } catch { /* non-fatal */ }
        }
        if (Object.keys(anchors.aliases).length > 0) {
          aliases = anchors.aliases;
        }
      }
    } catch { /* non-fatal — alias resolution is best-effort */ }

    const entryDir = path.join(templateDir, slug);
    if (fs.existsSync(entryDir) && fs.statSync(entryDir).isDirectory()) {
      // Attached entries: data-only overlays (ignore sections/layout).
      // Detached entries should not use mergeSingleTemplate for render.
      const dataOnly = !isEntryDetached(contentType, slug, resolvedRoot);
      const entryCommonPath = path.join(entryDir, "_common.yml");
      if (fs.existsSync(entryCommonPath)) {
        const parsed = contentIndex.safeYamlLoad(fs.readFileSync(entryCommonPath, "utf-8"));
        if (parsed) merged = applyPerEntryLayer(merged, parsed, accum, aliases, dataOnly);
      }
      // Explicit entry variant (e.g. draft preview): use only that file — do not
      // fall back to live `{locale}.yml`, so a missing draft cannot leak the shell alone.
      let entryLocalePath: string | null = null;
      if (entryVariant) {
        const variantPath = path.join(entryDir, `${entryVariant}.${locale}.yml`);
        if (fs.existsSync(variantPath)) entryLocalePath = variantPath;
      } else {
        const livePath = path.join(entryDir, `${locale}.yml`);
        if (fs.existsSync(livePath)) entryLocalePath = livePath;
      }
      if (entryLocalePath) {
        const parsed = contentIndex.safeYamlLoad(fs.readFileSync(entryLocalePath, "utf-8"));
        if (parsed) merged = applyPerEntryLayer(merged, parsed, accum, aliases, dataOnly);
      } else if (entryVariant) {
        // Caller asked for a variant that is not on disk — refuse the shell-only merge.
        return null;
      }
    }
  }

  return applySectionLayoutDefaults(merged);
}

/**
 * Live `{locale}.yml`, or `{variant}.{locale}.yml` when previewing a named variant.
 * Used by detached shared-layout entries (draft-only has no live locale file).
 */
export function resolveDetachedEntryLocalePath(
  entryDir: string,
  locale: string,
  entryVariant?: string,
): string | null {
  if (entryVariant) {
    const variantPath = path.join(entryDir, `${entryVariant}.${locale}.yml`);
    if (fs.existsSync(variantPath)) return variantPath;
  }
  const livePath = path.join(entryDir, `${locale}.yml`);
  return fs.existsSync(livePath) ? livePath : null;
}

/**
 * True when a static shared-layout entry has a live `{slug}/{locale}.yml`.
 * Used by public delivery so missing slugs 404 instead of serving the empty
 * `template.*.yml` shell.
 */
export function hasStaticSharedLayoutEntryLocale(
  contentType: string,
  slug: string,
  locale: string,
  contentRoot?: string,
): boolean {
  const resolvedRoot = contentRoot ?? getDefaultContentRoot();
  const folder = getFolder(contentType, resolvedRoot);
  const entryLocalePath = path.join(resolvedRoot, folder, slug, `${locale}.yml`);
  return fs.existsSync(entryLocalePath);
}

/**
 * Load a merged single-entry page for per-entry section ops.
 * Works for both DB-backed types and static types with `single_template: true`
 * (e.g. blog after convert-to-static). Prefer this over `loadDatabaseSinglePage`
 * in edit/delete routes that must support both.
 */
export async function loadMergedSinglePage(
  contentType: string,
  slug: string,
  locale: string,
  contentRoot?: string,
  db: DatabaseManager = databaseManager,
): Promise<TemplatePage | null> {
  const resolvedRoot = contentRoot ?? getDefaultContentRoot();

  if (hasDatabaseSingle(contentType, resolvedRoot)) {
    return loadDatabaseSinglePage(contentType, slug, locale, resolvedRoot, db);
  }

  const config = getContentTypeConfig(contentType, resolvedRoot);
  if (!config?.single_template) return null;

  if (!hasStaticSharedLayoutEntryLocale(contentType, slug, locale, resolvedRoot)) {
    log.info(
      `[MergedSingle] Static entry not found: ${contentType}/${slug}/${locale}.yml`,
    );
    return null;
  }

  const accum: PerEntryAccum = { removedSections: [] };
  const merged = mergeSingleTemplate(contentType, locale, slug, accum, resolvedRoot);
  if (!merged) {
    log.error(
      `[MergedSingle] Template not found for static single_template type: ${contentType}`,
    );
    return null;
  }

  const sections = (merged.sections as TemplatePage["sections"]) || [];
  attachVariableFieldsToSections(sections as unknown[]);
  applyComponentSectionDefaults(sections as unknown[]);
  applyComponentImageSizes(sections as unknown[]);

  return {
    slug: (merged.slug as string) || slug,
    title: (merged.title as string) || slug,
    meta: (merged.meta as TemplatePage["meta"]) || {},
    sections,
    settings: (merged.settings as TemplatePage["settings"]) || undefined,
    schema: (merged.schema as TemplatePage["schema"]) || undefined,
    perEntryRemovedSections:
      accum.removedSections.length > 0 ? accum.removedSections : undefined,
  };
}

export async function loadDatabaseSinglePage(
  contentType: string,
  slug: string,
  locale: string,
  contentRoot?: string,
  db: DatabaseManager = databaseManager,
  /**
   * Attached: `single.{variant}.{locale}.yml` (template A/B).
   * Detached: `{variant}.{locale}.yml` (entry preview, e.g. draft).
   */
  templateVariant?: string,
): Promise<TemplatePage | null> {
  const resolvedRoot = contentRoot ?? getDefaultContentRoot();
  const dbName = getDatabaseName(contentType, resolvedRoot);
  if (!dbName) return null;

  const detached = isEntryDetached(contentType, slug, resolvedRoot);

  // Detached: structure from entry YAML (classic page), not shared template
  let merged: Record<string, unknown> | null = null;
  let perEntryRemovedSections: Array<{ section: Record<string, unknown>; originalIndex: number }> = [];

  if (detached) {
    const folder = getFolder(contentType, resolvedRoot);
    const entryDir = path.join(resolvedRoot, folder, slug);
    const commonPath = path.join(entryDir, "_common.yml");
    const localePath = resolveDetachedEntryLocalePath(entryDir, locale, templateVariant);
    if (!localePath) {
      log.info(
        `[DatabaseSingle] Detached entry locale not found: ${contentType}/${slug}/${templateVariant ? `${templateVariant}.` : ""}${locale}.yml`,
      );
      return null;
    }
    let base: Record<string, unknown> = {};
    if (fs.existsSync(commonPath)) {
      const parsed = contentIndex.safeYamlLoad(fs.readFileSync(commonPath, "utf-8"));
      if (parsed) base = parsed;
    }
    const localeData = contentIndex.safeYamlLoad(fs.readFileSync(localePath, "utf-8"));
    if (!localeData) return null;
    merged = Object.keys(base).length > 0 ? deepMerge(base, localeData) : { ...localeData };
    // Strip detach bookkeeping from render payload
    delete (merged as Record<string, unknown>).detached;
    merged = applySectionLayoutDefaults(merged);
  } else {
    const accum: PerEntryAccum = { removedSections: [] };
    merged = mergeSingleTemplate(
      contentType,
      locale,
      slug,
      accum,
      resolvedRoot,
      templateVariant,
    );

    if (!merged) {
      log.error(
        `[DatabaseSingle] Template not found: single.${templateVariant ? `${templateVariant}.` : ""}${locale}.yml for ${contentType}`,
      );
      return null;
    }

    if (accum.removedSections.length > 0) {
      perEntryRemovedSections = accum.removedSections;
    }
  }

  if (!db.exists(dbName)) {
    log.error(`[DatabaseSingle] Database "${dbName}" not found`);
    return null;
  }

  try {
    const result = await db.fetchItems(dbName);
    const lookupKey = getLookupKey(contentType, resolvedRoot) || "slug";
    const fieldMapping = getFieldMapping(contentType, resolvedRoot);
    const fullMapping = getFullFieldMapping(contentType, resolvedRoot);

    let items = result.items as Record<string, unknown>[];

    if (fieldMapping || fullMapping?.[RESERVED_IMAGE_FIELD] || fullMapping?.[RESERVED_SLUG_FIELD] || fullMapping?.[RESERVED_UPDATED_AT_FIELD]) {
      items = items.map((item) => {
        const mapped: Record<string, unknown> = { ...item };
        const itemSlug = String(item[lookupKey] ?? item.slug ?? "unknown");
        if (fieldMapping) {
          for (const [targetField, sourcePath] of Object.entries(fieldMapping)) {
            const value = resolveFieldValue(sourcePath, item, targetField, {
              contentType,
              slug: itemSlug,
              fieldPath: targetField,
            });
            if (value !== undefined) mapped[targetField] = value;
          }
        }
        const slugMapSource = fullMapping?.[RESERVED_SLUG_FIELD];
        if (slugMapSource) {
          const slugValue = resolveFieldValue(slugMapSource, item, RESERVED_SLUG_FIELD, {
            contentType,
            slug: itemSlug,
            fieldPath: RESERVED_SLUG_FIELD,
          });
          applySlugAliasToEntry(mapped, slugValue);
        }
        const localeMapSource = fullMapping?.[RESERVED_LOCALE_FIELD];
        if (localeMapSource) {
          const localeValue = resolveFieldValue(localeMapSource, item, RESERVED_LOCALE_FIELD, {
            contentType,
            slug: itemSlug,
            fieldPath: RESERVED_LOCALE_FIELD,
          });
          applyLocaleAliasToEntry(mapped, localeValue);
        }
        const imageSource = fullMapping?.[RESERVED_IMAGE_FIELD];
        if (imageSource) {
          const imageValue = resolveFieldValue(imageSource, item, RESERVED_IMAGE_FIELD, {
            contentType,
            slug: itemSlug,
            fieldPath: RESERVED_IMAGE_FIELD,
          });
          applyImageAliasToEntry(mapped, imageValue);
        }
        const updatedAtSource = fullMapping?.[RESERVED_UPDATED_AT_FIELD];
        if (updatedAtSource) {
          const updatedAtValue = resolveFieldValue(updatedAtSource, item, RESERVED_UPDATED_AT_FIELD, {
            contentType,
            slug: itemSlug,
            fieldPath: RESERVED_UPDATED_AT_FIELD,
          });
          applyUpdatedAtAliasToEntry(mapped, updatedAtValue);
        }
        const iso = resolveEntryUpdatedAt({
          contentType,
          slug: itemSlug,
          locale: String(mapped.locale || item.locale || ""),
          record: mapped,
          contentRoot: resolvedRoot,
          isDb: true,
        });
        applyUpdatedAtAliasToEntry(mapped, iso);
        return mapped;
      });
    }

    const localeKey = getLocaleKey(contentType, resolvedRoot);
    const localeSource = getLocaleSource(contentType, resolvedRoot);
    let matchItem: Record<string, unknown> | undefined;

    if (localeKey) {
      const normalizedLocale = localeSource
        ? applyTransformIfNeeded(localeSource, locale)
        : locale;
      matchItem = items.find((item) => {
        const itemLocale = String(item[localeKey] || "");
        const normalizedItemLocale = localeSource
          ? applyTransformIfNeeded(localeSource, itemLocale)
          : itemLocale;
        return (
          item[lookupKey] === slug && normalizedItemLocale === normalizedLocale
        );
      });
      if (!matchItem) {
        matchItem = items.find((item) => item[lookupKey] === slug);
      }
    } else {
      matchItem = items.find((item) => item[lookupKey] === slug);
    }

    if (!matchItem) {
      log.info(
        `[DatabaseSingle] Item not found: ${lookupKey}=${slug} in ${dbName}`,
      );
      return null;
    }

    let content = (matchItem as any).content || "";
    if (!content && (matchItem as any).content_url) {
      content = await fetchMarkdownContent(
        (matchItem as any).content_url as string,
      );
    }
    if (!content && (matchItem as any).readme_url) {
      content = await fetchMarkdownContent(
        (matchItem as any).readme_url as string,
      );
    }
    const singleItemBase = { ...matchItem, content };
    const ctOverrides = readFieldOverrides(contentType, slug, locale, resolvedRoot);
    const singleItem = applyFieldOverridesToItem(singleItemBase, ctOverrides);
    applyUpdatedAtAliasToEntry(
      singleItem,
      resolveEntryUpdatedAt({
        contentType,
        slug,
        locale,
        record: singleItem,
        contentRoot: resolvedRoot,
        isDb: true,
      }),
    );

    const sections = (merged.sections as TemplatePage["sections"]) || [];
    attachVariableFieldsToSections(sections as unknown[]);
    applyComponentSectionDefaults(sections as unknown[]);
    applyComponentImageSizes(sections as unknown[]);

    const page: TemplatePage = {
      slug: (merged.slug as string) || slug,
      title: (merged.title as string) || (singleItem.title as string) || slug,
      meta: (merged.meta as TemplatePage["meta"]) || {},
      sections,
      settings: (merged.settings as TemplatePage["settings"]) || undefined,
      schema: (merged.schema as TemplatePage["schema"]) || undefined,
      singleEntry: finalizeSingleEntryForTemplates(singleItem as Record<string, unknown>, {
        slug,
        locale,
      }),
      perEntryRemovedSections: perEntryRemovedSections.length > 0 ? perEntryRemovedSections : undefined,
    };

    return page;
  } catch (err) {
    log.error(
      `[DatabaseSingle] Error loading ${contentType}/${slug}:`,
      err,
    );
    return null;
  }
}
