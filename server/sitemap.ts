import { contentIndex, MARKETING_CONTENT_PATH as BASE_CONTENT_PATH } from "./content-index";
import { getContentTypeConfig, getLocaleKey, getLocaleSource, getFieldMapping, getFullFieldMapping, getFieldMappingDefaults, resolveUrlPatternWithMapping, extractUrlPatternParams, getAllConfigs, resolveHreflangsFromRecord, getCanonicalHreflangSlug, resolveEntryUpdatedAt } from "./content-types";
import { getSupportedLocales, isIndexingBlocked } from "./settings";
import { applyTransformIfNeeded } from "./transform";
import { toSitemapLastmod } from "@shared/normalizeFlexibleDate";
import { databaseManager, type DatabaseManager } from "./database";
import { child } from "./logger";
import type { SiteContext } from "./site-manager";
import { getDefaultContentFolder } from "./site-config";
import { isEmptyDetachedLocaleEntry } from "./empty-locale";
import {
  getEntryContentDir,
  isDraftEntry,
  listDraftLocales,
} from "./draft-entry";
import { isTemplateVersioningSlug } from "./shared-layout-entry";
import path from "path";
const log = child({ module: "sitemap" });

function shouldSkipEmptyDetachedLocale(
  contentType: string,
  slug: string,
  locale: string,
  ci: typeof contentIndex,
): boolean {
  return isEmptyDetachedLocaleEntry({
    contentType,
    slug,
    locale,
    contentRoot: ci.contentRoot,
    ci,
  });
}

// Per-request site context for per-site sitemap generation.
// Set synchronously inside getCanonicalEntries before calling buildCanonicalSitemapEntries.
// All callee functions are synchronous — safe in Node.js single-threaded event loop.
export interface ActiveSiteCtx {
  contentIndex: typeof contentIndex;
  contentRootName: string;
  database: DatabaseManager;
  baseUrl?: string;
}

export function toActiveSiteCtx(site: Pick<SiteContext, "contentIndex" | "contentRootName" | "database" | "config">): ActiveSiteCtx {
  return {
    contentIndex: site.contentIndex,
    contentRootName: site.contentRootName,
    database: site.database,
    baseUrl: site.config.domain ? `https://${site.config.domain}` : undefined,
  };
}

let _activeSiteCtx: ActiveSiteCtx | null = null;
function _ci(): typeof contentIndex { return _activeSiteCtx?.contentIndex ?? contentIndex; }
function _db(): DatabaseManager { return _activeSiteCtx?.database ?? databaseManager; }
function _contentFolder(): string {
  return _activeSiteCtx?.contentRootName ?? getDefaultContentFolder();
}



const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

function getBaseUrl(ctx?: ActiveSiteCtx): string {
  // Use per-site baseUrl when available (multi-site mode)
  if (ctx?.baseUrl) {
    return ctx.baseUrl.replace(/\/$/, "");
  }

  // Use explicit SITE_URL if set
  if (process.env.SITE_URL) {
    return process.env.SITE_URL.replace(/\/$/, "");
  }

  // Fall back to Replit's domain
  if (process.env.REPLIT_DEV_DOMAIN) {
    return `https://${process.env.REPLIT_DEV_DOMAIN}`;
  }

  // Development fallback
  return "http://localhost:5000";
}

// ============================================================================
// CANONICAL SITEMAP ENTRY - Single Source of Truth
// ============================================================================

type EntryType =
  | "static"
  | "program"
  | "landing"
  | "location"
  | "template_page"
  | string;

interface CanonicalSitemapEntry {
  loc: string;
  lastmod?: string;
  label: string;
  type: EntryType;
  locale?: string;
  contentKey?: string;
}

interface SitemapCache {
  entries: Map<string, CanonicalSitemapEntry>;
  generatedAt: number;
}

let sitemapCache: SitemapCache | null = null;
const _perSiteSitemapCache = new Map<typeof contentIndex, SitemapCache>();

// ============================================================================
// Content Meta Interfaces
// ============================================================================

interface ContentMeta {
  page_title?: string;
  robots?: string;
  redirects?: string[];
}

interface AvailableProgram {
  slug: string;
  dirSlug: string;
  locale: string;
  title: string;
  meta: ContentMeta;
}

interface AvailableLocation {
  slug: string;
  dirSlug: string;
  locale: string;
  name: string;
  meta: ContentMeta;
}

interface AvailableTemplatePage {
  slug: string;
  dirSlug: string;
  locale: string;
  title: string;
  meta: ContentMeta;
}

// ============================================================================
// Data Fetchers - Using shared contentLoader helpers
// ============================================================================

function loadMergedContent(
  contentType: string,
  slug: string,
  localeOrVariant: string,
  ci: typeof contentIndex = _ci(),
): Record<string, unknown> | null {
  const { data } = ci.loadMergedContent(contentType, slug, localeOrVariant);
  return data;
}

function getAvailablePrograms(ci: typeof contentIndex = _ci()): AvailableProgram[] {
  try {
    const programs: AvailableProgram[] = [];
    const slugs = ci.listContentSlugs("program");

    for (const slug of slugs) {
      const locales = ci.getAvailableLocalesOrVariants("program", slug);

      for (const locale of locales) {
        if (shouldSkipEmptyDetachedLocale("program", slug, locale, ci)) continue;
        const merged = loadMergedContent("program", slug, locale, ci);
        if (!merged) continue;

        const meta = (merged.meta as ContentMeta) || {};
        programs.push({
          slug: (merged.slug as string) || slug,
          dirSlug: slug,
          locale,
          title: meta.page_title || (merged.title as string) || slug,
          meta,
        });
      }
    }

    return programs;
  } catch (error) {
    log.error({ err: error }, "Error scanning programs:");
    return [];
  }
}

function getAvailableLocations(ci: typeof contentIndex = _ci()): AvailableLocation[] {
  try {
    const locations: AvailableLocation[] = [];
    const slugs = ci.listContentSlugs("location");

    for (const slug of slugs) {
      const locales = ci.getAvailableLocalesOrVariants("location", slug);

      for (const locale of locales) {
        if (shouldSkipEmptyDetachedLocale("location", slug, locale, ci)) continue;
        const merged = loadMergedContent("location", slug, locale, ci);
        if (!merged) continue;

        const meta = (merged.meta as ContentMeta) || {};
        locations.push({
          slug: (merged.slug as string) || slug,
          dirSlug: slug,
          locale,
          name: meta.page_title || (merged.name as string) || slug,
          meta,
        });
      }
    }

    return locations;
  } catch (error) {
    log.error({ err: error }, "Error scanning locations:");
    return [];
  }
}

function getAvailableTemplatePages(ci: typeof contentIndex = _ci(), cf: string = _contentFolder()): AvailableTemplatePage[] {
  try {
    const pages: AvailableTemplatePage[] = [];
    const slugs = ci.listContentSlugs("page");

    for (const dirSlug of slugs) {
      const locales = ci.getAvailableLocalesOrVariants("page", dirSlug);

      for (const locale of locales) {
        // Only process locale files (en, es)
        if (!getSupportedLocales(cf).includes(locale)) continue;
        if (shouldSkipEmptyDetachedLocale("page", dirSlug, locale, ci)) continue;

        const merged = loadMergedContent("page", dirSlug, locale, ci);
        if (!merged) continue;

        const meta = (merged.meta as ContentMeta) || {};
        pages.push({
          slug: (merged.slug as string) || dirSlug,
          dirSlug,
          locale,
          title: meta.page_title || (merged.title as string) || dirSlug,
          meta,
        });
      }
    }

    return pages;
  } catch (error) {
    log.error({ err: error }, "Error scanning template pages:");
    return [];
  }
}

// ============================================================================
// Helper Functions
// ============================================================================

function shouldIndex(robots?: string, contentRoot?: string): boolean {
  if (isIndexingBlocked(contentRoot)) return false;
  if (!robots) return true;
  return !robots.toLowerCase().includes("noindex");
}

/**
 * Resolve robots for a DB-mapped item — same defaults as YAML:
 * entry override → field_mapping default → "" (index).
 */
function resolveDbItemRobots(
  item: Record<string, unknown>,
  typeName: string,
  cf: string,
): string {
  if (typeof item.robots === "string") return item.robots;
  const defaults = getFieldMappingDefaults(typeName, cf);
  if (typeof defaults.robots === "string") return defaults.robots;
  return "";
}

/** Unresolved {{ }} placeholders (e.g. slug: {{ entry.slug }} from _common.template.yml). */
const TEMPLATE_EXPR_RE = /\{\{[\s\S]*?\}\}/;

/**
 * URL slug for sitemap loc. Returns null when missing or still a template
 * expression — those locales must not be indexed (stub / incomplete entries).
 */
function resolveSitemapUrlSlug(mergedSlug: unknown): string | null {
  if (typeof mergedSlug !== "string") return null;
  const trimmed = mergedSlug.trim();
  if (!trimmed || TEMPLATE_EXPR_RE.test(trimmed)) return null;
  return trimmed;
}

function resolveSitemapContentRoot(ctx?: ActiveSiteCtx): string {
  const name = ctx?.contentRootName ?? getDefaultContentFolder();
  return path.isAbsolute(name) ? name : path.join(process.cwd(), name);
}

function formatLocaleLabel(locale: string): string {
  return locale === "es" ? "ES" : "EN";
}

/**
 * Editorial lastmod (YYYY-MM-DD) from locale YAML `updated_at` else `published_at`.
 * Empty when neither is set — callers omit `<lastmod>` rather than using today.
 */
function getYmlFileLastmod(contentType: string, dirSlug: string, locale: string): string {
  const iso = resolveEntryUpdatedAt({
    contentType,
    slug: dirSlug,
    locale,
    contentRoot: _activeSiteCtx?.contentRootName ?? _contentFolder(),
    isDb: false,
  });
  return toSitemapLastmod(iso, false);
}

/**
 * Compute the map key for a canonical sitemap entry.
 * Uses `${contentKey}:${locale}` when both are present, otherwise falls back to `loc` URL.
 */
function buildMapKey(entry: CanonicalSitemapEntry): string {
  if (entry.contentKey && entry.locale) {
    return `${entry.contentKey}:${entry.locale}`;
  }
  return entry.loc;
}

// ============================================================================
// CANONICAL BUILDER - Single Source of Truth
// ============================================================================

function buildCanonicalSitemapEntries(ctx?: ActiveSiteCtx): Map<string, CanonicalSitemapEntry> {
  _activeSiteCtx = ctx ?? null;
  try {
  const contentRoot = resolveSitemapContentRoot(ctx);
  if (isIndexingBlocked(contentRoot)) {
    log.info(`[Sitemap] Indexing blocked — returning empty sitemap (${ctx?.contentRootName ?? "__global__"})`);
    return new Map();
  }
  const ci = ctx?.contentIndex ?? contentIndex;
  const db = ctx?.database ?? databaseManager;
  const cf = ctx?.contentRootName ?? getDefaultContentFolder();

  const entriesMap = new Map<string, CanonicalSitemapEntry>();

  const addEntry = (entry: CanonicalSitemapEntry) => {
    entriesMap.set(buildMapKey(entry), entry);
  };

  // Homes come from template/content pages only (e.g. /en/home, /es/inicio).
  // Do not invent a static "/" — locale-root aliases 301 to those canonicals.

  // Dynamic career program pages
  const programs = getAvailablePrograms(ci);
  for (const program of programs) {
    if (!shouldIndex(program.meta.robots, contentRoot)) {
      log.info(
        `[Sitemap] Skipping noindex program: ${program.slug} (${program.locale})`,
      );
      continue;
    }

    const url = `${getBaseUrl(ctx)}${ci.buildUrl("program", program.locale, program.slug)}`;

    addEntry({
      loc: url,
      lastmod: getYmlFileLastmod("program", program.dirSlug, program.locale),
      label: `${program.title} (${formatLocaleLabel(program.locale)})`,
      type: "program",
      locale: program.locale,
      contentKey: `program:${program.dirSlug}`,
    });
  }

  // Dynamic location pages
  const locations = getAvailableLocations(ci);
  for (const location of locations) {
    if (!shouldIndex(location.meta.robots, contentRoot)) {
      log.info(
        `[Sitemap] Skipping noindex location: ${location.slug} (${location.locale})`,
      );
      continue;
    }

    const url = `${getBaseUrl(ctx)}${ci.buildUrl("location", location.locale, location.slug)}`;

    addEntry({
      loc: url,
      lastmod: getYmlFileLastmod("location", location.dirSlug, location.locale),
      label: `Location: ${location.name} (${formatLocaleLabel(location.locale)})`,
      type: "location",
      locale: location.locale,
      contentKey: `location:${location.dirSlug}`,
    });
  }

  // Dynamic template pages
  const templatePages = getAvailableTemplatePages(ci, cf);
  for (const page of templatePages) {
    if (!shouldIndex(page.meta.robots, contentRoot)) {
      log.info(
        `[Sitemap] Skipping noindex template page: ${page.slug} (${page.locale})`,
      );
      continue;
    }

    addEntry({
      loc: `${getBaseUrl(ctx)}${ci.buildUrl("page", page.locale, page.slug)}`,
      lastmod: getYmlFileLastmod("page", page.dirSlug, page.locale),
      label: `Page: ${page.title} (${formatLocaleLabel(page.locale)})`,
      type: "template_page",
      locale: page.locale,
      contentKey: `page:${page.dirSlug}`,
    });
  }

  // DB-backed content types — read synchronously from the SQLite cache
  try {
    const allTypeConfigs = getAllConfigs(cf);
    for (const [typeName, typeConfig] of Object.entries(allTypeConfigs)) {
      if (!typeConfig.database?.slug) continue;
      const dbName = typeConfig.database.slug;
      const items = db.getMappedItems(dbName);
      if (!items || items.length === 0) {
        log.warn(`[Sitemap] No cached items for DB-backed type "${typeName}" (db: ${dbName}) — skipping`);
        continue;
      }
      const localeFieldKey = getLocaleKey(typeName);
      const localeSource = getLocaleSource(typeName);
      const urlPatterns = typeConfig.url_pattern;
      const fieldMapping = getFullFieldMapping(typeName);
      const typeLabel = typeName.charAt(0).toUpperCase() + typeName.slice(1);
      for (const item of items) {
        let locale = "en";
        if (localeFieldKey) {
          const resolvedLocaleField = (fieldMapping && localeFieldKey in fieldMapping)
            ? fieldMapping[localeFieldKey]
            : localeFieldKey;
          const langVal = String(item[resolvedLocaleField] || item[localeFieldKey] || "en");
          locale = localeSource ? applyTransformIfNeeded(localeSource, langVal) : langVal;
        }
        const urlPattern = urlPatterns[locale] || urlPatterns["en"];
        if (!urlPattern) continue;
        const defaults = getFieldMappingDefaults(typeName, cf);
        const { missing } = extractUrlPatternParams(urlPattern, item, fieldMapping, defaults);
        if (missing.length > 0) {
          log.warn(
            `[Sitemap] Skipping ${typeName} entry "${String(item.slug || item.id || "")}" (${locale}): cannot resolve URL pattern variable(s) ${missing.map((m) => `:${m}`).join(", ")} from entry data`,
          );
          continue;
        }
        const robots = resolveDbItemRobots(item, typeName, cf);
        if (!shouldIndex(robots, contentRoot)) {
          log.info(
            `[Sitemap] Skipping noindex ${typeName}: ${String(item.slug || item.id || "")} (${locale})`,
          );
          continue;
        }
        const itemUrl = `${getBaseUrl(ctx)}${resolveUrlPatternWithMapping(urlPattern, item, locale, fieldMapping, defaults)}`;
        const title = String(item.title || item.slug || item.id || "");
        const itemSlug = String(item.slug || item.id || "");
        const updatedIso = resolveEntryUpdatedAt({
          contentType: typeName,
          slug: itemSlug,
          locale,
          record: item,
          contentRoot: cf,
          isDb: true,
        });
        const hreflangMap = resolveHreflangsFromRecord(item, typeName, cf);
        const canonicalSlug = hreflangMap
          ? getCanonicalHreflangSlug(hreflangMap)
          : null;
        const contentKey = canonicalSlug
          ? `${typeName}:${canonicalSlug}`
          : itemSlug
            ? `${typeName}:${itemSlug}`
            : undefined;
        const lastmod = toSitemapLastmod(updatedIso, false);
        addEntry({
          loc: itemUrl,
          ...(lastmod ? { lastmod } : {}),
          label: `${typeLabel}: ${title} (${formatLocaleLabel(locale)})`,
          type: "static",
          locale,
          contentKey,
        });
      }
    }
  } catch (err) {
    log.warn("[Sitemap] Could not load DB-backed content types for sitemap:", err);
  }

  const handledTypes = new Set(["program", "location", "page"]);
  try {
    const allTypeConfigs = getAllConfigs(cf);
    for (const [typeName, typeConfig] of Object.entries(allTypeConfigs)) {
      if (handledTypes.has(typeName)) continue;
      if (typeConfig.database) continue;

      const slugs = ci.listContentSlugs(typeName);
      for (const slug of slugs) {
        const locales = ci.getAvailableLocalesOrVariants(typeName, slug);
        for (const locale of locales) {
          if (!getSupportedLocales(cf).includes(locale)) continue;
          if (shouldSkipEmptyDetachedLocale(typeName, slug, locale, ci)) {
            log.info(`[Sitemap] Skipping empty detached locale ${typeName}: ${slug} (${locale})`);
            continue;
          }

          const merged = loadMergedContent(typeName, slug, locale, ci);
          if (!merged) continue;

          const meta = (merged.meta as ContentMeta) || {};
          if (!shouldIndex(meta.robots, contentRoot)) {
            log.info(`[Sitemap] Skipping noindex ${typeName}: ${slug} (${locale})`);
            continue;
          }

          const urlPattern = typeConfig.url_pattern?.[locale] || typeConfig.url_pattern?.["default"];
          let params: Record<string, string> | undefined;
          if (urlPattern) {
            const fieldMapping = getFullFieldMapping(typeName, cf);
            const defaults = getFieldMappingDefaults(typeName, cf);
            const extracted = extractUrlPatternParams(urlPattern, merged, fieldMapping, defaults);
            if (extracted.missing.length > 0) {
              log.warn(
                `[Sitemap] Skipping ${typeName} entry "${slug}" (${locale}): cannot resolve URL pattern variable(s) ${extracted.missing.map((m) => `:${m}`).join(", ")} from entry data`,
              );
              continue;
            }
            params = extracted.params;
          }
          const urlSlug = resolveSitemapUrlSlug(merged.slug);
          if (!urlSlug) {
            log.warn(
              `[Sitemap] Skipping ${typeName} entry "${slug}" (${locale}): slug is missing or unresolved template expression`,
            );
            continue;
          }
          const url = `${getBaseUrl(ctx)}${ci.buildUrl(typeName, locale, urlSlug, params)}`;
          const title = meta.page_title || (merged.title as string) || slug;
          const typeLabel = typeName.charAt(0).toUpperCase() + typeName.slice(1);

          addEntry({
            loc: url,
            lastmod: getYmlFileLastmod(typeName, slug, locale),
            label: `${typeLabel}: ${title} (${formatLocaleLabel(locale)})`,
            type: typeName,
            locale,
            contentKey: `${typeName}:${slug}`,
          });
        }
      }
    }
  } catch (err) {
    log.warn("[Sitemap] Error generating dynamic content type entries:", err);
  }

  return entriesMap;
  } finally {
    _activeSiteCtx = null;
  }
}

// ============================================================================
// Output Transformers - Derive from Canonical Source
// ============================================================================

function buildAlternatesMap(entries: CanonicalSitemapEntry[]): Map<string, Map<string, string>> {
  const groups = new Map<string, Map<string, string>>();

  for (const entry of entries) {
    if (!entry.contentKey || !entry.locale) continue;
    if (!groups.has(entry.contentKey)) {
      groups.set(entry.contentKey, new Map());
    }
    groups.get(entry.contentKey)!.set(entry.locale, entry.loc);
  }

  const alternatesMap = new Map<string, Map<string, string>>();
  for (const [, localeMap] of groups) {
    if (localeMap.size < 2) continue;
    for (const [, loc] of localeMap) {
      alternatesMap.set(loc, localeMap);
    }
  }

  return alternatesMap;
}

function entriesToXml(entries: CanonicalSitemapEntry[]): string {
  const alternatesMap = buildAlternatesMap(entries);

  const urlEntries = entries
    .map((entry) => {
      const localeMap = alternatesMap.get(entry.loc);
      let alternateLines = "";
      if (localeMap) {
        const lines: string[] = [];
        for (const [locale, href] of localeMap) {
          lines.push(`    <xhtml:link rel="alternate" hreflang="${locale}" href="${href}" />`);
        }
        const defaultHref = localeMap.get("en") || localeMap.values().next().value;
        if (defaultHref) {
          lines.push(`    <xhtml:link rel="alternate" hreflang="x-default" href="${defaultHref}" />`);
        }
        alternateLines = "\n" + lines.join("\n");
      }
      return `  <url>
    <loc>${entry.loc}</loc>${entry.lastmod ? `\n    <lastmod>${entry.lastmod}</lastmod>` : ""}${alternateLines}
  </url>`;
    })
    .join("\n");

  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"
        xmlns:xhtml="http://www.w3.org/1999/xhtml">
${urlEntries}
</urlset>`;
}

function entriesToHumanReadable(
  entries: CanonicalSitemapEntry[],
): Array<{
  loc: string;
  label: string;
  locale?: string;
  content_type?: string;
  slug?: string;
}> {
  return entries.map((entry) => {
    let content_type: string | undefined;
    let slug: string | undefined;
    if (entry.contentKey) {
      const colon = entry.contentKey.indexOf(":");
      if (colon > 0) {
        content_type = entry.contentKey.slice(0, colon);
        slug = entry.contentKey.slice(colon + 1);
      }
    }
    return {
      loc: entry.loc,
      label: entry.label,
      ...(entry.locale ? { locale: entry.locale } : {}),
      ...(content_type && slug ? { content_type, slug } : {}),
    };
  });
}

// ============================================================================
// Cached Access - Both outputs derive from same canonical data
// ============================================================================

function getCanonicalEntries(ctx?: ActiveSiteCtx): Map<string, CanonicalSitemapEntry> {
  const now = Date.now();
  const isSiteSpecific = !!ctx;
  const cache = isSiteSpecific ? _perSiteSitemapCache.get(ctx!.contentIndex) : sitemapCache;

  if (cache && now - cache.generatedAt < CACHE_TTL_MS) {
    log.info(`[Sitemap] Serving from cache (${ctx?.contentRootName ?? "__global__"})`);
    return cache.entries;
  }

  log.info(`[Sitemap] Generating fresh sitemap entries (${ctx?.contentRootName ?? "__global__"})`);
  let entriesMap: Map<string, CanonicalSitemapEntry>;
  entriesMap = buildCanonicalSitemapEntries(ctx);

  const newCache: SitemapCache = { entries: entriesMap, generatedAt: now };
  if (isSiteSpecific) {
    _perSiteSitemapCache.set(ctx!.contentIndex, newCache);
  } else {
    sitemapCache = newCache;
  }

  return entriesMap;
}

// ============================================================================
// Public API
// ============================================================================

export function getSitemap(ctx?: ActiveSiteCtx): string {
  const entriesMap = getCanonicalEntries(ctx);
  return entriesToXml(Array.from(entriesMap.values()));
}

export function getSitemapUrls(ctx?: ActiveSiteCtx): Array<{
  loc: string;
  label: string;
  locale?: string;
  content_type?: string;
  slug?: string;
}> {
  const entriesMap = getCanonicalEntries(ctx);
  return entriesToHumanReadable(Array.from(entriesMap.values()));
}

export type DebugSitemapUrl = {
  loc: string;
  label: string;
  locale?: string;
  content_type?: string;
  slug?: string;
  inSitemap: boolean;
  excludeReason?: string;
  isDraft?: boolean;
};

function splitContentKey(contentKey?: string): { content_type?: string; slug?: string } {
  if (!contentKey) return {};
  const colon = contentKey.indexOf(":");
  if (colon <= 0) return {};
  return {
    content_type: contentKey.slice(0, colon),
    slug: contentKey.slice(colon + 1),
  };
}

function pushDebugUrl(
  out: DebugSitemapUrl[],
  opts: {
    loc: string;
    label: string;
    locale?: string;
    contentKey?: string;
    inSitemap: boolean;
    excludeReason?: string;
    isDraft?: boolean;
  },
): void {
  const { content_type, slug } = splitContentKey(opts.contentKey);
  out.push({
    loc: opts.loc,
    label: opts.label,
    ...(opts.locale ? { locale: opts.locale } : {}),
    ...(content_type && slug ? { content_type, slug } : {}),
    inSitemap: opts.inSitemap,
    ...(opts.excludeReason && !opts.inSitemap && !opts.isDraft
      ? { excludeReason: opts.excludeReason }
      : {}),
    ...(opts.isDraft ? { isDraft: true } : {}),
  });
}

/**
 * Debug-only content URL list: indexed + excluded (and drafts with preview locs).
 * Does not write to the XML sitemap cache.
 */
export function getDebugSitemapUrls(ctx?: ActiveSiteCtx): DebugSitemapUrl[] {
  _activeSiteCtx = ctx ?? null;
  try {
    const contentRoot = resolveSitemapContentRoot(ctx);
    const siteBlocked = isIndexingBlocked(contentRoot);
    const ci = ctx?.contentIndex ?? contentIndex;
    const db = ctx?.database ?? databaseManager;
    const cf = ctx?.contentRootName ?? getDefaultContentFolder();
    const base = getBaseUrl(ctx);
    const out: DebugSitemapUrl[] = [];
    const seen = new Set<string>();

    const emit = (opts: {
      loc: string;
      label: string;
      locale?: string;
      contentKey?: string;
      indexable: boolean;
      excludeReason?: string;
      isDraft?: boolean;
    }) => {
      if (seen.has(opts.loc)) return;
      seen.add(opts.loc);
      const inSitemap = !siteBlocked && opts.indexable && !opts.isDraft;
      pushDebugUrl(out, {
        loc: opts.loc,
        label: opts.label,
        locale: opts.locale,
        contentKey: opts.contentKey,
        inSitemap,
        excludeReason: siteBlocked
          ? "site_blocked"
          : opts.isDraft
            ? undefined
            : opts.excludeReason,
        isDraft: opts.isDraft,
      });
    };

    // Homes come from template pages below (e.g. /en/home, /es/inicio), not a static "/".

    // Programs
    {
      const slugs = ci.listContentSlugs("program");
      for (const dirSlug of slugs) {
        if (isDraftEntry("program", dirSlug, cf)) {
          const dir = getEntryContentDir("program", dirSlug, cf);
          const draftLocales = listDraftLocales(dir, false);
          const locales = draftLocales.length > 0 ? draftLocales : getSupportedLocales(cf).slice(0, 1);
          for (const locale of locales) {
            emit({
              loc: `${base}/private/preview/program/${dirSlug}?locale=${locale}`,
              label: `Program: ${dirSlug} (${formatLocaleLabel(locale)})`,
              locale,
              contentKey: `program:${dirSlug}`,
              indexable: false,
              isDraft: true,
            });
          }
          continue;
        }
        const locales = ci.getAvailableLocalesOrVariants("program", dirSlug);
        for (const locale of locales) {
          if (!getSupportedLocales(cf).includes(locale)) continue;
          if (shouldSkipEmptyDetachedLocale("program", dirSlug, locale, ci)) {
            continue;
          }
          const merged = loadMergedContent("program", dirSlug, locale, ci);
          if (!merged) continue;
          const meta = (merged.meta as ContentMeta) || {};
          const urlSlug = resolveSitemapUrlSlug(merged.slug) ?? dirSlug;
          const loc = `${base}${ci.buildUrl("program", locale, urlSlug)}`;
          const title = meta.page_title || (merged.title as string) || dirSlug;
          const entryNoindex = !!meta.robots?.toLowerCase().includes("noindex");
          emit({
            loc,
            label: `${title} (${formatLocaleLabel(locale)})`,
            locale,
            contentKey: `program:${dirSlug}`,
            indexable: !entryNoindex,
            excludeReason: entryNoindex ? "noindex" : undefined,
          });
        }
      }
    }

    // Locations (robots only — no visibility gate)
    {
      const slugs = ci.listContentSlugs("location");
      for (const dirSlug of slugs) {
        if (isDraftEntry("location", dirSlug, cf)) {
          const dir = getEntryContentDir("location", dirSlug, cf);
          const draftLocales = listDraftLocales(dir, false);
          const locales = draftLocales.length > 0 ? draftLocales : getSupportedLocales(cf).slice(0, 1);
          for (const locale of locales) {
            emit({
              loc: `${base}/private/preview/location/${dirSlug}?locale=${locale}`,
              label: `Location: ${dirSlug} (${formatLocaleLabel(locale)})`,
              locale,
              contentKey: `location:${dirSlug}`,
              indexable: false,
              isDraft: true,
            });
          }
          continue;
        }
        const locales = ci.getAvailableLocalesOrVariants("location", dirSlug);
        for (const locale of locales) {
          if (!getSupportedLocales(cf).includes(locale)) continue;
          if (shouldSkipEmptyDetachedLocale("location", dirSlug, locale, ci)) continue;
          const merged = loadMergedContent("location", dirSlug, locale, ci);
          if (!merged) continue;
          const meta = (merged.meta as ContentMeta) || {};
          const urlSlug = resolveSitemapUrlSlug(merged.slug) ?? dirSlug;
          const loc = `${base}${ci.buildUrl("location", locale, urlSlug)}`;
          const name = meta.page_title || (merged.name as string) || dirSlug;
          const entryNoindex = !!meta.robots?.toLowerCase().includes("noindex");
          emit({
            loc,
            label: `Location: ${name} (${formatLocaleLabel(locale)})`,
            locale,
            contentKey: `location:${dirSlug}`,
            indexable: !entryNoindex,
            excludeReason: entryNoindex ? "noindex" : undefined,
          });
        }
      }
    }

    // Template pages
    {
      const slugs = ci.listContentSlugs("page");
      for (const dirSlug of slugs) {
        if (isDraftEntry("page", dirSlug, cf)) {
          const dir = getEntryContentDir("page", dirSlug, cf);
          const draftLocales = listDraftLocales(dir, isTemplateVersioningSlug(dirSlug));
          const locales = draftLocales.length > 0 ? draftLocales : getSupportedLocales(cf).slice(0, 1);
          for (const locale of locales) {
            emit({
              loc: `${base}/private/preview/page/${dirSlug}?locale=${locale}`,
              label: `Page: ${dirSlug} (${formatLocaleLabel(locale)})`,
              locale,
              contentKey: `page:${dirSlug}`,
              indexable: false,
              isDraft: true,
            });
          }
          continue;
        }
        const locales = ci.getAvailableLocalesOrVariants("page", dirSlug);
        for (const locale of locales) {
          if (!getSupportedLocales(cf).includes(locale)) continue;
          if (shouldSkipEmptyDetachedLocale("page", dirSlug, locale, ci)) continue;
          const merged = loadMergedContent("page", dirSlug, locale, ci);
          if (!merged) continue;
          const meta = (merged.meta as ContentMeta) || {};
          const urlSlug = resolveSitemapUrlSlug(merged.slug) ?? dirSlug;
          const loc = `${base}${ci.buildUrl("page", locale, urlSlug)}`;
          const title = meta.page_title || (merged.title as string) || dirSlug;
          const entryNoindex = !!meta.robots?.toLowerCase().includes("noindex");
          emit({
            loc,
            label: `Page: ${title} (${formatLocaleLabel(locale)})`,
            locale,
            contentKey: `page:${dirSlug}`,
            indexable: !entryNoindex,
            excludeReason: entryNoindex ? "noindex" : undefined,
          });
        }
      }
    }

    // DB-backed types
    try {
      const allTypeConfigs = getAllConfigs(cf);
      for (const [typeName, typeConfig] of Object.entries(allTypeConfigs)) {
        if (!typeConfig.database?.slug) continue;
        const dbName = typeConfig.database.slug;
        const items = db.getMappedItems(dbName);
        if (!items || items.length === 0) continue;
        const localeFieldKey = getLocaleKey(typeName);
        const localeSource = getLocaleSource(typeName);
        const urlPatterns = typeConfig.url_pattern;
        const fieldMapping = getFullFieldMapping(typeName);
        const typeLabel = typeName.charAt(0).toUpperCase() + typeName.slice(1);
        for (const item of items) {
          let locale = "en";
          if (localeFieldKey) {
            const resolvedLocaleField =
              fieldMapping && localeFieldKey in fieldMapping
                ? fieldMapping[localeFieldKey]
                : localeFieldKey;
            const langVal = String(item[resolvedLocaleField] || item[localeFieldKey] || "en");
            locale = localeSource ? applyTransformIfNeeded(localeSource, langVal) : langVal;
          }
          const urlPattern = urlPatterns[locale] || urlPatterns["en"];
          if (!urlPattern) continue;
          const defaults = getFieldMappingDefaults(typeName, cf);
          const { missing } = extractUrlPatternParams(urlPattern, item, fieldMapping, defaults);
          if (missing.length > 0) continue;
          const itemUrl = `${base}${resolveUrlPatternWithMapping(urlPattern, item, locale, fieldMapping, defaults)}`;
          const title = String(item.title || item.slug || item.id || "");
          const itemSlug = String(item.slug || item.id || "");
          const hreflangMap = resolveHreflangsFromRecord(item, typeName, cf);
          const canonicalSlug = hreflangMap ? getCanonicalHreflangSlug(hreflangMap) : null;
          const contentKey = canonicalSlug
            ? `${typeName}:${canonicalSlug}`
            : itemSlug
              ? `${typeName}:${itemSlug}`
              : undefined;
          const robots = resolveDbItemRobots(item, typeName, cf);
          const entryNoindex = robots.toLowerCase().includes("noindex");
          emit({
            loc: itemUrl,
            label: `${typeLabel}: ${title} (${formatLocaleLabel(locale)})`,
            locale,
            contentKey,
            indexable: !entryNoindex,
            excludeReason: entryNoindex ? "noindex" : undefined,
          });
        }
      }
    } catch (err) {
      log.warn("[Sitemap] Debug list: could not load DB-backed types:", err);
    }

    // Other YAML content types
    const handledTypes = new Set(["program", "location", "page"]);
    try {
      const allTypeConfigs = getAllConfigs(cf);
      for (const [typeName, typeConfig] of Object.entries(allTypeConfigs)) {
        if (handledTypes.has(typeName)) continue;
        if (typeConfig.database) continue;

        const slugs = ci.listContentSlugs(typeName);
        for (const slug of slugs) {
          if (isDraftEntry(typeName, slug, cf)) {
            const dir = getEntryContentDir(typeName, slug, cf);
            const draftLocales = listDraftLocales(dir, isTemplateVersioningSlug(slug));
            const locales = draftLocales.length > 0 ? draftLocales : getSupportedLocales(cf).slice(0, 1);
            for (const locale of locales) {
              emit({
                loc: `${base}/private/preview/${typeName}/${slug}?locale=${locale}`,
                label: `${typeName}: ${slug} (${formatLocaleLabel(locale)})`,
                locale,
                contentKey: `${typeName}:${slug}`,
                indexable: false,
                isDraft: true,
              });
            }
            continue;
          }

          const locales = ci.getAvailableLocalesOrVariants(typeName, slug);
          for (const locale of locales) {
            if (!getSupportedLocales(cf).includes(locale)) continue;
            if (shouldSkipEmptyDetachedLocale(typeName, slug, locale, ci)) {
              // empty detached — no reliable public URL; skip per plan (only emit when loc resolvable)
              continue;
            }

            const merged = loadMergedContent(typeName, slug, locale, ci);
            if (!merged) continue;

            const meta = (merged.meta as ContentMeta) || {};
            const urlPattern =
              typeConfig.url_pattern?.[locale] || typeConfig.url_pattern?.["default"];
            let params: Record<string, string> | undefined;
            if (urlPattern) {
              const fieldMapping = getFullFieldMapping(typeName, cf);
              const defaults = getFieldMappingDefaults(typeName, cf);
              const extracted = extractUrlPatternParams(
                urlPattern,
                merged,
                fieldMapping,
                defaults,
              );
              if (extracted.missing.length > 0) continue;
              params = extracted.params;
            }
            const urlSlug = resolveSitemapUrlSlug(merged.slug);
            if (!urlSlug) continue;
            const loc = `${base}${ci.buildUrl(typeName, locale, urlSlug, params)}`;
            const title = meta.page_title || (merged.title as string) || slug;
            const typeLabel = typeName.charAt(0).toUpperCase() + typeName.slice(1);
            const entryNoindex = !!meta.robots?.toLowerCase().includes("noindex");
            emit({
              loc,
              label: `${typeLabel}: ${title} (${formatLocaleLabel(locale)})`,
              locale,
              contentKey: `${typeName}:${slug}`,
              indexable: !entryNoindex,
              excludeReason: entryNoindex ? "noindex" : undefined,
            });
          }
        }
      }
    } catch (err) {
      log.warn("[Sitemap] Debug list: error scanning YAML content types:", err);
    }

    return out;
  } finally {
    _activeSiteCtx = null;
  }
}

export function clearSitemapCache(): { success: boolean; message: string } {
  const hadSiteCount = _perSiteSitemapCache.size;

  if (sitemapCache) {
    const age = Date.now() - sitemapCache.generatedAt;
    const ageMinutes = Math.round(age / 1000 / 60);
    sitemapCache = null;
    _perSiteSitemapCache.clear();
    log.info("[Sitemap] Cache cleared (global + per-site)");
    return {
      success: true,
      message: `Cache cleared. Previous global cache was ${ageMinutes} minutes old; ${hadSiteCount} per-site cache(s) cleared.`,
    };
  }

  if (hadSiteCount > 0) {
    _perSiteSitemapCache.clear();
    log.info("[Sitemap] Per-site cache cleared");
    return { success: true, message: `${hadSiteCount} per-site cache(s) cleared.` };
  }

  return {
    success: true,
    message: "No cache to clear.",
  };
}

export function getSitemapCacheStatus(): {
  cached: boolean;
  generatedAt: number | null;
  ageMinutes: number | null;
  expiresInMinutes: number | null;
  entryCount: number | null;
} {
  if (!sitemapCache) {
    return {
      cached: false,
      generatedAt: null,
      ageMinutes: null,
      expiresInMinutes: null,
      entryCount: null,
    };
  }

  const now = Date.now();
  const ageMs = now - sitemapCache.generatedAt;
  const expiresInMs = CACHE_TTL_MS - ageMs;

  return {
    cached: true,
    generatedAt: sitemapCache.generatedAt,
    ageMinutes: Math.round(ageMs / 1000 / 60),
    expiresInMinutes: Math.max(0, Math.round(expiresInMs / 1000 / 60)),
    entryCount: sitemapCache.entries.size,
  };
}

// ============================================================================
// Targeted cache mutation API
// ============================================================================

/**
 * Remove exactly one entry from the cache by its composite map key.
 * Key format: `${contentKey}:${locale}` (or `loc` URL for static/keyless entries).
 * No-op when cache is cold.
 */
export function invalidateSitemapEntry(mapKey: string): void {
  if (!sitemapCache) return;
  sitemapCache.entries.delete(mapKey);
  log.info(`[Sitemap] Invalidated entry: ${mapKey}`);
}

/**
 * Remove all entries whose `contentKey` field equals the given value.
 * Covers all locales of a single piece of content, and clears stale URL
 * entries produced by slug-field edits.
 * No-op when cache is cold.
 */
export function invalidateSitemapEntriesByContentKey(contentKey: string): void {
  if (!sitemapCache) return;
  let removed = 0;
  for (const [key, entry] of sitemapCache.entries) {
    if (entry.contentKey === contentKey) {
      sitemapCache.entries.delete(key);
      removed++;
    }
  }
  if (removed > 0) {
    log.info(`[Sitemap] Invalidated ${removed} entr${removed === 1 ? "y" : "ies"} for contentKey: ${contentKey}`);
  }
}

/**
 * Insert or replace one entry in the cache.
 * No-op when cache is cold (avoids creating a partial single-entry cache).
 */
export function upsertSitemapEntry(entry: CanonicalSitemapEntry): void {
  if (!sitemapCache) return;
  const key = buildMapKey(entry);
  sitemapCache.entries.set(key, entry);
  log.info(`[Sitemap] Upserted entry: ${key} → ${entry.loc}`);
}

/**
 * Build a single CanonicalSitemapEntry for one locale of a YAML-driven content
 * type. Returns null when the content is not found or not indexable.
 * Blog posts are DB-backed and are not handled here.
 * Location indexing is robots-only (visibility no longer gates the sitemap).
 */
function buildSingleEntry(type: string, dirSlug: string, locale: string): CanonicalSitemapEntry | null {
  const merged = loadMergedContent(type, dirSlug, locale);
  if (!merged) return null;

  const meta = (merged.meta as ContentMeta) || {};
  if (!shouldIndex(meta.robots, resolveSitemapContentRoot(_activeSiteCtx ?? undefined))) return null;

  // Prefer resolved merged.slug; fall back to dirSlug only when merged has no slug field
  // (classic YAML types). Never index unresolved {{ single.slug }} placeholders.
  const urlSlug =
    resolveSitemapUrlSlug(merged.slug) ??
    (merged.slug == null || merged.slug === "" ? dirSlug : null);
  if (!urlSlug) {
    log.warn(
      `[Sitemap] Skipping ${type} entry "${dirSlug}" (${locale}): slug is missing or unresolved template expression`,
    );
    return null;
  }
  const url = `${getBaseUrl(_activeSiteCtx ?? undefined)}${_ci().buildUrl(type, locale, urlSlug)}`;
  const title = meta.page_title || (merged.title as string) || (merged.name as string) || dirSlug;

  let entryType: EntryType = type;
  let label: string;

  if (type === "program") {
    label = `${title} (${formatLocaleLabel(locale)})`;
  } else if (type === "location") {
    label = `Location: ${title} (${formatLocaleLabel(locale)})`;
  } else if (type === "page") {
    entryType = "template_page";
    label = `Page: ${title} (${formatLocaleLabel(locale)})`;
  } else {
    const typeLabel = type.charAt(0).toUpperCase() + type.slice(1);
    label = `${typeLabel}: ${title} (${formatLocaleLabel(locale)})`;
  }

  return {
    loc: url,
    lastmod: getYmlFileLastmod(type, dirSlug, locale),
    label,
    type: entryType,
    locale,
    contentKey: `${type}:${dirSlug}`,
  };
}

/**
 * Targeted update for one locale of a YAML-driven content entry.
 *
 * Only removes the exact map entry for this type+dirSlug+locale triple
 * (key: `${type}:${dirSlug}:${locale}`), then re-reads the source YAML
 * and upserts if `shouldIndex()` is true.
 *
 * Because the map key is stable and does not include the URL, slug-field
 * changes in the YAML are handled correctly: the stale URL entry is removed
 * and the new URL is inserted at the same key — without affecting sibling
 * locales.
 *
 * No-op for DB-backed content types and unsupported locales.
 * Safe to call when cache is cold — invalidation is a no-op and no partial
 * cache is created.
 */
export function refreshSitemapEntry(type: string, dirSlug: string, locale: string): void {
  // DB-backed types are not handled via YAML refresh
  if (getContentTypeConfig(type)?.database) return;

  // Only process supported locales
  if (!getSupportedLocales(_contentFolder()).includes(locale)) return;

  // Remove only this locale's entry — does not affect sibling locales
  invalidateSitemapEntry(`${type}:${dirSlug}:${locale}`);

  // If cache isn't warm, don't pre-populate a partial cache
  if (!sitemapCache) return;

  const entry = buildSingleEntry(type, dirSlug, locale);
  if (entry) {
    upsertSitemapEntry(entry);
  }
}

/**
 * Targeted update for multiple locales of a YAML-driven content entry in a
 * single pass.
 *
 * Invalidates the content key once (covering stale URLs from slug-field edits
 * and noindex transitions), then re-reads and upserts each valid locale.
 * This avoids the re-invalidation problem that would occur if `refreshSitemapEntry`
 * were called per-locale in a loop: each call would purge the locales added by
 * previous calls.
 *
 * Use this for edits that affect all locales simultaneously (e.g. `_common.yml`
 * saves or `edit-common` requests where no locale is specified).
 *
 * No-op for DB-backed content types.
 * Safe to call when cache is cold.
 */
export function refreshSitemapEntriesForContentKey(type: string, dirSlug: string, locales: string[]): void {
  // Purge all stale entries for this content key once
  invalidateSitemapEntriesByContentKey(`${type}:${dirSlug}`);

  // If cache isn't warm, don't pre-populate a partial cache
  if (!sitemapCache) return;

  // DB-backed types are not handled via YAML refresh
  if (getContentTypeConfig(type)?.database) return;

  const supported = getSupportedLocales(_contentFolder());
  for (const locale of locales) {
    if (!supported.includes(locale)) continue;
    const entry = buildSingleEntry(type, dirSlug, locale);
    if (entry) {
      upsertSitemapEntry(entry);
    }
  }
}
