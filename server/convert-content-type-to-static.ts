import fs from "fs";
import path from "path";
import yaml from "js-yaml";
import { escapeObjectVars, unescapeYamlDump } from "@shared/templateVars";
import { isTemplateVersioningSlug } from "@shared/sharedLayoutPaths";
import { contentIndex } from "./content-index";
import {
  getContentTypeConfig,
  getDirectory,
  getFieldMapping,
  getLocaleKey,
  getHreflangsSource,
  resolveHreflangsFromRecord,
  getCanonicalHreflangSlug,
  updateContentTypeConfig,
  type ContentTypeEntry,
} from "./content-types";
import { databaseManager, type DatabaseManager } from "./database";
import { mergeSingleTemplate } from "./database-single-loader";
import { fetchMarkdownContent } from "./markdown";
import { resolveSingleVars } from "./single-resolver";
import { clearSitemapCache, refreshSitemapEntriesForContentKey } from "./sitemap";
import { markFileAsModified } from "./sync-state";
import { isEntryDetached } from "./shared-layout-entry";
import { deepMerge } from "./utils/deepMerge";
import { child } from "./logger";

const log = child({ module: "convert-to-static" });

const YAML_DUMP_OPTS: yaml.DumpOptions = { lineWidth: 120, noRefs: true, sortKeys: false };

const STRIP_KEYS = new Set([
  "_variableFields",
  "_variableKeys",
  "_perEntrySource",
  "_insertAfterSectionId",
  "singleEntry",
  "perEntryRemovedSections",
]);

/** Keys that always live on locale files (never only in _common). */
const LOCALE_FILE_KEYS = new Set(["meta", "sections", "settings", "title", "description", "content"]);

/** Non-data keys stripped from attached overlays (layout stays in shared template). */
const ATTACHED_STRIP_KEYS = new Set(["sections", "layout", "detached"]);

export type ConvertSkipped = {
  reason: string;
  detail?: string;
  slug?: string;
  locale?: string;
  source_url?: string;
};

function safeYamlDump(obj: unknown): string {
  const { escaped, map } = escapeObjectVars(obj);
  return unescapeYamlDump(yaml.dump(escaped, YAML_DUMP_OPTS), map);
}

function stripRuntimeKeys(obj: unknown): unknown {
  if (Array.isArray(obj)) return obj.map(stripRuntimeKeys);
  if (obj !== null && typeof obj === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(obj as Record<string, unknown>)) {
      if (STRIP_KEYS.has(key)) continue;
      out[key] = stripRuntimeKeys(value);
    }
    return out;
  }
  return obj;
}

function deepEqual(a: unknown, b: unknown): boolean {
  try {
    return JSON.stringify(a) === JSON.stringify(b);
  } catch {
    return false;
  }
}

function contentRootNameFromPath(contentRoot: string): string {
  return path.basename(contentRoot);
}

function loadYamlObject(filePath: string): Record<string, unknown> | null {
  if (!fs.existsSync(filePath)) return null;
  try {
    const parsed = contentIndex.safeYamlLoad(fs.readFileSync(filePath, "utf-8"));
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch {
    /* ignore */
  }
  return null;
}

/**
 * Resolve body markdown. Returns ok:false when a remote URL was expected but fetch yielded empty.
 */
async function resolveItemContent(item: Record<string, unknown>): Promise<{
  ok: boolean;
  content: string;
  source_url?: string;
}> {
  if (typeof item.content === "string" && item.content.trim()) {
    return { ok: true, content: item.content };
  }
  const contentUrl =
    typeof item.content_url === "string" && item.content_url.trim()
      ? item.content_url.trim()
      : null;
  const readmeUrl =
    typeof item.readme_url === "string" && item.readme_url.trim()
      ? item.readme_url.trim()
      : null;
  const source_url = contentUrl || readmeUrl || undefined;

  let content = "";
  if (contentUrl) content = await fetchMarkdownContent(contentUrl);
  if (!content && readmeUrl) content = await fetchMarkdownContent(readmeUrl);

  if (source_url && !content.trim()) {
    return { ok: false, content: "", source_url };
  }
  return { ok: true, content, source_url };
}

function normalizeLocale(raw: unknown, fallback = "en"): string {
  const s = String(raw || fallback).trim().toLowerCase();
  if (!s) return fallback;
  const m = s.match(/^([a-z]{2})/);
  return m ? m[1] : fallback;
}

function identityFieldsFromItem(
  item: Record<string, unknown>,
  fieldMapping: Record<string, string> | null,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (!fieldMapping) {
    if (item.slug != null) out.slug = item.slug;
    if (item.title != null) out.title = item.title;
    return out;
  }
  for (const key of Object.keys(fieldMapping)) {
    if (key.startsWith("_")) continue;
    if (item[key] !== undefined && item[key] !== null) {
      out[key] = item[key];
    }
  }
  if (item.slug != null && out.slug === undefined) out.slug = item.slug;
  return out;
}

function buildIdentityFieldMapping(
  existing: ContentTypeEntry["field_mapping"],
): Record<string, string> {
  const result: Record<string, string> = {};
  if (!existing) return { slug: "slug", title: "title" };
  for (const key of Object.keys(existing)) {
    if (key.startsWith("_")) continue;
    result[key] = key;
  }
  if (!result.slug) result.slug = "slug";
  return result;
}

function listSharedTemplateFiles(typeDir: string): string[] {
  if (!fs.existsSync(typeDir)) return [];
  return fs
    .readdirSync(typeDir)
    .filter((f) => /^(?:template|single)\.[a-z0-9-]+\.ya?ml$/i.test(f))
    .map((f) => path.join(typeDir, f));
}

function listOrphanSlugFolders(typeDir: string, dbSlugs: Set<string>): string[] {
  if (!fs.existsSync(typeDir)) return [];
  return fs
    .readdirSync(typeDir, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name)
    .filter((name) => {
      if (name.startsWith("_")) return false;
      if (isTemplateVersioningSlug(name)) return false;
      return !dbSlugs.has(name);
    })
    .sort();
}

function stripAttachedOverlayKeys(obj: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(obj)) {
    if (ATTACHED_STRIP_KEYS.has(key)) continue;
    if (STRIP_KEYS.has(key)) continue;
    out[key] = value;
  }
  return out;
}

/** Overlay wins on conflicts (deepMerge(base, overlay) → overlay keys win). */
function mergeOverrideWins(
  base: Record<string, unknown>,
  overlay: Record<string, unknown> | null,
): Record<string, unknown> {
  if (!overlay || Object.keys(overlay).length === 0) return { ...base };
  return deepMerge(base, stripAttachedOverlayKeys(overlay));
}

function loadEntryOverlayLayer(
  entryDir: string,
  locale: string,
): { common: Record<string, unknown> | null; locale: Record<string, unknown> | null } {
  return {
    common: loadYamlObject(path.join(entryDir, "_common.yml")),
    locale: loadYamlObject(path.join(entryDir, `${locale}.yml`)),
  };
}

function splitCommonAndLocales(
  localePages: Map<string, Record<string, unknown>>,
): { common: Record<string, unknown>; locales: Map<string, Record<string, unknown>> } {
  const locales = new Map<string, Record<string, unknown>>();
  const pages = Array.from(localePages.entries());
  if (pages.length === 0) {
    return { common: {}, locales };
  }

  const first = pages[0][1];
  const common: Record<string, unknown> = {};
  const candidateKeys = new Set<string>();
  for (const [, page] of pages) {
    for (const key of Object.keys(page)) candidateKeys.add(key);
  }

  for (const key of candidateKeys) {
    if (LOCALE_FILE_KEYS.has(key)) continue;
    const values = pages.map(([, page]) => page[key]);
    if (values.every((v) => v !== undefined && deepEqual(v, values[0]))) {
      common[key] = values[0];
    }
  }

  if (first.slug !== undefined && common.slug === undefined) {
    common.slug = first.slug;
  }

  for (const [locale, page] of pages) {
    const localeObj: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(page)) {
      if (key in common && deepEqual(common[key], value) && !LOCALE_FILE_KEYS.has(key)) {
        continue;
      }
      localeObj[key] = value;
    }
    locales.set(locale, localeObj);
  }

  return { common, locales };
}

export interface ConvertToStaticPreview {
  dry_run: true;
  content_type: string;
  directory: string;
  database_slug: string;
  entry_count: number;
  locale_count: number;
  files_to_write: number;
  files_to_overwrite: number;
  existing_slug_folders: string[];
  templates_preserved: string[];
  orphan_slug_folders: string[];
  skipped: ConvertSkipped[];
  message: string;
}

export interface ConvertToStaticResult {
  dry_run: false;
  success: true;
  content_type: string;
  directory: string;
  unlinked_database: string;
  written: string[];
  overwritten: string[];
  templates_preserved: string[];
  orphan_slug_folders: string[];
  skipped: ConvertSkipped[];
  entry_count: number;
  locale_count: number;
}

export type ConvertToStaticOutput = ConvertToStaticPreview | ConvertToStaticResult;

export class ConvertToStaticError extends Error {
  statusCode: number;
  constructor(message: string, statusCode = 400) {
    super(message);
    this.name = "ConvertToStaticError";
    this.statusCode = statusCode;
  }
}

export interface ConvertToStaticOptions {
  contentType: string;
  contentRoot: string;
  dryRun?: boolean;
  author?: string;
  db?: DatabaseManager;
  /** Site-scoped content index; defaults to the process singleton. */
  refreshIndex?: () => void;
  invalidateCommonFields?: (contentType: string) => void;
}

export async function convertContentTypeToStatic(
  opts: ConvertToStaticOptions,
): Promise<ConvertToStaticOutput> {
  const { contentType, contentRoot, dryRun = false, author } = opts;
  const db = opts.db ?? databaseManager;
  const rootName = contentRootNameFromPath(contentRoot);

  const config = getContentTypeConfig(contentType, contentRoot);
  if (!config) {
    throw new ConvertToStaticError(`Content type "${contentType}" not found`, 404);
  }
  if (!config.database?.slug) {
    throw new ConvertToStaticError(
      `Content type "${contentType}" has no database configured — nothing to convert`,
      400,
    );
  }

  const dbName = config.database.slug;
  if (!db.exists(dbName)) {
    throw new ConvertToStaticError(`Database "${dbName}" not found`, 404);
  }

  const cacheInfo = db.getCacheInfo(dbName);
  if (!cacheInfo) {
    throw new ConvertToStaticError(
      `No cache for database "${dbName}". Refresh the database cache before converting.`,
      400,
    );
  }

  const items = await db.fetchMappedItems(contentType);
  if (items.length === 0) {
    throw new ConvertToStaticError(
      `Database "${dbName}" cache has no mapped items for "${contentType}"`,
      400,
    );
  }

  const directory = getDirectory(contentType, contentRoot) || config.directory;
  const typeDir = path.join(contentRoot, directory);
  const localeKey = getLocaleKey(contentType, contentRoot) || "lang";
  const fieldMapping = getFieldMapping(contentType, contentRoot);
  const templateFiles = listSharedTemplateFiles(typeDir);
  const templatesPreserved = templateFiles.map((f) => path.relative(contentRoot, f));
  const hreflangsConfigured = !!getHreflangsSource(contentType, contentRoot);

  const bySlug = new Map<string, Map<string, Record<string, unknown>>>();
  const skipped: ConvertSkipped[] = [];
  const assignedSlugs = new Set<string>();

  const addToCluster = (
    folderSlug: string,
    locale: string,
    item: Record<string, unknown>,
  ): boolean => {
    if (!bySlug.has(folderSlug)) bySlug.set(folderSlug, new Map());
    const localeMap = bySlug.get(folderSlug)!;
    if (localeMap.has(locale)) {
      skipped.push({
        reason: "duplicate_locale",
        detail: `${folderSlug}/${locale} (item ${String(item.slug ?? "")})`,
        slug: folderSlug,
        locale,
      });
      return false;
    }
    localeMap.set(locale, item);
    return true;
  };

  if (hreflangsConfigured) {
    for (const item of items) {
      const itemSlug = String(item.slug ?? "").trim();
      if (!itemSlug || assignedSlugs.has(itemSlug)) continue;

      const map = resolveHreflangsFromRecord(item, contentType, contentRoot) || {};
      const canonical = getCanonicalHreflangSlug(map) || itemSlug;

      for (const [loc, locSlug] of Object.entries(map)) {
        if (!locSlug || assignedSlugs.has(locSlug)) continue;
        const target =
          items.find((i) => String(i.slug ?? "").trim() === locSlug) || null;
        if (!target) {
          skipped.push({ reason: "hreflang_dangling", detail: `${loc}:${locSlug}` });
          continue;
        }
        const targetLocale = normalizeLocale(
          target[localeKey] ?? target.lang ?? target.language ?? target.locale ?? loc,
        );
        if (addToCluster(canonical, targetLocale, target)) {
          assignedSlugs.add(locSlug);
        }
      }

      if (!assignedSlugs.has(itemSlug)) {
        const locale = normalizeLocale(
          item[localeKey] ?? item.lang ?? item.language ?? item.locale,
        );
        if (addToCluster(canonical, locale, item)) {
          assignedSlugs.add(itemSlug);
        }
      }
    }

    for (const item of items) {
      const itemSlug = String(item.slug ?? "").trim();
      if (!itemSlug || assignedSlugs.has(itemSlug)) continue;
      const locale = normalizeLocale(
        item[localeKey] ?? item.lang ?? item.language ?? item.locale,
      );
      if (addToCluster(itemSlug, locale, item)) {
        assignedSlugs.add(itemSlug);
      }
    }
  } else {
    for (const item of items) {
      const slug = String(item.slug ?? "").trim();
      if (!slug) {
        skipped.push({ reason: "missing_slug", detail: JSON.stringify(item).slice(0, 120) });
        continue;
      }
      const locale = normalizeLocale(item[localeKey] ?? item.lang ?? item.language ?? item.locale);
      addToCluster(slug, locale, item);
    }
  }

  if (bySlug.size === 0) {
    throw new ConvertToStaticError(`No valid entries with slugs found for "${contentType}"`, 400);
  }

  const orphanSlugFolders = listOrphanSlugFolders(typeDir, new Set(bySlug.keys()));

  let filesToWrite = 0;
  let filesToOverwrite = 0;
  const existingSlugFolders: string[] = [];
  let localeCount = 0;

  for (const [slug, localeMap] of bySlug) {
    localeCount += localeMap.size;
    const entryDir = path.join(typeDir, slug);
    const folderExists = fs.existsSync(entryDir) && fs.statSync(entryDir).isDirectory();
    if (folderExists) existingSlugFolders.push(slug);

    const plannedFiles = ["_common.yml", ...Array.from(localeMap.keys()).map((l) => `${l}.yml`)];
    for (const file of plannedFiles) {
      const full = path.join(entryDir, file);
      if (fs.existsSync(full)) filesToOverwrite += 1;
      else filesToWrite += 1;
    }
  }

  if (dryRun) {
    return {
      dry_run: true,
      content_type: contentType,
      directory,
      database_slug: dbName,
      entry_count: bySlug.size,
      locale_count: localeCount,
      files_to_write: filesToWrite,
      files_to_overwrite: filesToOverwrite,
      existing_slug_folders: existingSlugFolders,
      templates_preserved: templatesPreserved,
      orphan_slug_folders: orphanSlugFolders,
      skipped,
      message:
        `Will convert ${bySlug.size} slug(s) / ${localeCount} locale file(s) from database "${dbName}" ` +
        `into ${directory}/ as data overlays (_common.yml + locale YAML), unlink the database, keep single_template: true, ` +
        `and preserve ${templatesPreserved.length} shared template shell(s). ` +
        `Existing per-entry field overrides win over database values. Detached entries get a full page bake. ` +
        `${orphanSlugFolders.length} orphan folder(s) on disk are listed and will not be deleted. ` +
        `Failed body downloads are skipped (not written empty).`,
    };
  }

  const written: string[] = [];
  const overwritten: string[] = [];
  const createdDirs: string[] = [];

  try {
    for (const [folderSlug, localeMap] of bySlug) {
      const localePages = new Map<string, Record<string, unknown>>();
      const entryDir = path.join(typeDir, folderSlug);
      const detached = isEntryDetached(contentType, folderSlug, contentRoot);

      for (const [locale, item] of localeMap) {
        const resolved = await resolveItemContent(item);
        if (!resolved.ok) {
          skipped.push({
            reason: "content_fetch_failed",
            detail: `Remote markdown empty or unreachable for ${folderSlug}/${locale}`,
            slug: folderSlug,
            locale,
            source_url: resolved.source_url,
          });
          continue;
        }

        const singleItem = { ...item, content: resolved.content };
        const identity = identityFieldsFromItem(singleItem, fieldMapping);
        const urlSlug = String(item.slug ?? folderSlug).trim() || folderSlug;

        if (detached) {
          const merged = mergeSingleTemplate(
            contentType,
            locale,
            folderSlug,
            undefined,
            contentRoot,
          );
          if (!merged) {
            skipped.push({
              reason: "missing_template",
              detail: `template.${locale}.yml for ${contentType}`,
              slug: folderSlug,
              locale,
            });
            continue;
          }
          const baked = stripRuntimeKeys(
            resolveSingleVars(merged, singleItem),
          ) as Record<string, unknown>;
          const page: Record<string, unknown> = {
            ...identity,
            ...baked,
            slug: urlSlug,
            detached: true,
          };
          if (typeof page.title !== "string" || !page.title) {
            page.title = typeof singleItem.title === "string" ? singleItem.title : urlSlug;
          }
          localePages.set(locale, page);
          continue;
        }

        // Attached: data overlay only — DB identity + content, then existing overlay wins
        let page: Record<string, unknown> = {
          ...identity,
          content: resolved.content,
          slug: urlSlug,
        };
        if (typeof page.title !== "string" || !page.title) {
          page.title =
            typeof singleItem.title === "string" ? singleItem.title : urlSlug;
        }
        if (
          typeof singleItem.description === "string" &&
          page.description === undefined
        ) {
          page.description = singleItem.description;
        }

        const overlay = loadEntryOverlayLayer(entryDir, locale);
        page = mergeOverrideWins(page, overlay.common);
        page = mergeOverrideWins(page, overlay.locale);
        // Ensure URL slug from cluster item still wins for non-canonical locales
        page.slug = urlSlug;
        delete page.sections;
        delete page.layout;

        localePages.set(locale, page);
      }

      if (localePages.size === 0) continue;

      const { common, locales } = splitCommonAndLocales(localePages);

      for (const [locale, localeObj] of locales) {
        const page = localePages.get(locale);
        const urlSlug = page && typeof page.slug === "string" ? page.slug : null;
        if (urlSlug && urlSlug !== folderSlug) {
          localeObj.slug = urlSlug;
          if (common.slug === urlSlug) delete common.slug;
        }
      }
      if (common.slug === undefined) {
        common.slug = folderSlug;
      }
      if (detached) {
        common.detached = true;
      }

      const existedBefore = fs.existsSync(entryDir) && fs.statSync(entryDir).isDirectory();
      if (!existedBefore) {
        fs.mkdirSync(entryDir, { recursive: true });
        createdDirs.push(entryDir);
      }

      const commonPath = path.join(entryDir, "_common.yml");
      const commonRel = `${rootName}/${directory}/${folderSlug}/_common.yml`;
      const commonExisted = fs.existsSync(commonPath);
      fs.writeFileSync(commonPath, safeYamlDump(common), "utf-8");
      markFileAsModified(commonRel, author, undefined, contentRoot);
      (commonExisted ? overwritten : written).push(commonRel);

      for (const [locale, localeObj] of locales) {
        const localePath = path.join(entryDir, `${locale}.yml`);
        const localeRel = `${rootName}/${directory}/${folderSlug}/${locale}.yml`;
        const localeExisted = fs.existsSync(localePath);
        fs.writeFileSync(localePath, safeYamlDump(localeObj), "utf-8");
        markFileAsModified(localeRel, author, undefined, contentRoot);
        (localeExisted ? overwritten : written).push(localeRel);
      }

      refreshSitemapEntriesForContentKey(contentType, folderSlug, Array.from(locales.keys()));
    }

    const newMapping = buildIdentityFieldMapping(config.field_mapping);
    updateContentTypeConfig(
      contentType,
      {
        database: null,
        field_mapping: newMapping,
        single_template: true,
      },
      contentRoot,
    );

    if (opts.refreshIndex) {
      opts.refreshIndex();
    } else {
      contentIndex.refresh();
    }
    clearSitemapCache();
    if (opts.invalidateCommonFields) {
      opts.invalidateCommonFields(contentType);
    } else {
      contentIndex.invalidateCommonFields(contentType);
    }

    log.info(
      `[ConvertToStatic] Converted "${contentType}" from db "${dbName}": ` +
        `${written.length} new, ${overwritten.length} overwritten, ` +
        `${templatesPreserved.length} templates preserved, ${orphanSlugFolders.length} orphans listed`,
    );

    return {
      dry_run: false,
      success: true,
      content_type: contentType,
      directory,
      unlinked_database: dbName,
      written,
      overwritten,
      templates_preserved: templatesPreserved,
      orphan_slug_folders: orphanSlugFolders,
      skipped,
      entry_count: bySlug.size,
      locale_count: localeCount,
    };
  } catch (err) {
    for (const dir of createdDirs) {
      try {
        if (fs.existsSync(dir)) fs.rmSync(dir, { recursive: true, force: true });
      } catch {
        /* ignore */
      }
    }
    throw err;
  }
}
