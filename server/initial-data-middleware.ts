import * as fs from "fs";
import { getDefaultContentRoot } from "./site-config";
import * as path from "path";
import * as yaml from "js-yaml";
import type { Request, Response, NextFunction } from "express";
import { contentIndex, ContentIndex } from "./content-index";
import { resolveDynamicEntries } from "./dynamic-entries";
import { resolveLayout, getAllConfigs, getLabel, getLayout, getPreviewConfig, finalizeSingleEntryForTemplates } from "./content-types";
import {
  applyComponentSectionDefaults,
  applyComponentImageSizes,
  buildImageIdToSchemaSizesMap,
} from "./component-registry";
import { getVariableManager } from "./variable-manager";
import { loadImageRegistry } from "./image-registry";
import { getMergedImageRegistry } from "./image-registry-resolver";
import type { SiteContext } from "./site-manager";
import { readNavigationEagerManifest } from "./navigation-eager-manifest";
import { getDefaultLocale, normalizeLocale, resolveEffectiveRobots } from "./settings";
import { getApiPath } from "../shared/api-paths";
import { toOgLocale } from "../shared/locale";
import { loadDatabaseSinglePage, attachVariableFieldsToSections } from "./database-single-loader";
import { resolveAllTemplateVars, buildContentDeliveryParamBag } from "./resolve-template-vars";
import { buildSingleEntryFromContent } from "./build-single-entry";
import { resolveRelationsOnEntry } from "./resolve-relations";
import { databaseManager, type DatabaseManager, getCachedDatabaseEntryCount } from "./database";
import { applyEntryModulePreload } from "./utils/html-transforms";
import { applyEntryPreviewOgImage } from "./entry-preview-manager";
import {
  buildLocaleUnavailablePayload,
  isEmptyDetachedLocaleEntry,
} from "./empty-locale";
import {
  buildPageImageRegistrySubset,
  createEmptyImageRefs,
  extractImageRefsFromValue,
  type ImageRefs,
} from "./image-registry-subset";
import { buildListingCanonicalHref } from "../shared/listing-canonical";

const DEFAULT_SRCSET_SIZES =
  "(max-width: 640px) 100vw, (max-width: 1024px) 50vw, 33vw";

function parseUrlQuery(url: string): Record<string, unknown> {
  const qIndex = url.indexOf("?");
  if (qIndex < 0) return {};
  const qs = url.slice(qIndex + 1).split("#")[0];
  const out: Record<string, unknown> = {};
  for (const part of qs.split("&")) {
    if (!part) continue;
    const eq = part.indexOf("=");
    const key = decodeURIComponent(eq >= 0 ? part.slice(0, eq) : part);
    const raw = eq >= 0 ? decodeURIComponent(part.slice(eq + 1).replace(/\+/g, " ")) : "";
    if (key in out) {
      const prev = out[key];
      out[key] = Array.isArray(prev) ? [...prev, raw] : [prev, raw];
    } else {
      out[key] = raw;
    }
  }
  return out;
}

function firstPresetSizesFromImageEntry(
  imageEntry: { preset?: string[] } | null | undefined,
  presets: Record<string, { sizes?: string }> | undefined,
): string | undefined {
  if (!imageEntry?.preset?.length || !presets) return undefined;
  for (const name of imageEntry.preset) {
    const s = presets[name]?.sizes;
    if (typeof s === "string" && s.trim()) return s;
  }
  return undefined;
}

interface SingleQuery {
  queryKey: unknown[];
  data: unknown;
}

export interface InitialDataPayload {
  queries: SingleQuery[];
  locale?: string;
  /** When set, SSR HTML response should use this status (e.g. empty detached locale). */
  httpStatus?: number;
}

export async function resolvePageQuery(
  url: string,
  ci: ContentIndex = contentIndex,
  dbm: DatabaseManager = databaseManager,
  site?: SiteContext,
): Promise<SingleQuery | null> {
  // Don't seed page data for force_variant requests — the SSR render would use
  // the default-page data while the client needs a different query key for the
  // variant, causing a hydration mismatch. Return null so SSR emits an empty
  // shell; the client spinner + fetch handles it cleanly.
  if (url.includes("force_variant=")) return null;

  const cleanUrl = url.split("?")[0].split("#")[0];

  if (
    cleanUrl === "/" ||
    cleanUrl === "/en" ||
    cleanUrl === "/en/" ||
    cleanUrl === "/es" ||
    cleanUrl === "/es/"
  ) {
    const locale = cleanUrl.startsWith("/es") ? "es" : "en";
    const slug = "home";
    const result = ci.loadContent({
      contentType: "page",
      slug,
      localeOrVariant: locale,
    });
    if (result.success) {
      const data = result.data as any;
      if (data.sections && Array.isArray(data.sections)) {
        applyComponentSectionDefaults(data.sections);
        data.sections = (await resolveDynamicEntries(
          data.sections,
          locale,
          { db: dbm, contentRoot: ci.contentRoot, contentIndex: ci },
        )) as any;
        applyComponentImageSizes(data.sections);
      }
      const pageRaw = ci.loadMergedContent("page", slug, locale);
      const layout = resolveLayout("page", pageRaw.data || {}, ci.contentRoot);
      data.layout = layout;
      return {
        queryKey: ["/api/pages", slug, locale],
        data,
      };
    }
    return null;
  }

  try {
    const resolved = ci.resolveUrl(cleanUrl);
    if (!resolved) return null;

    const { contentType, slug, fromDatabase, patternLocale, params: urlPathParams } = resolved;
    const isNonLocalized = patternLocale === "default";
    const requestQuery = parseUrlQuery(url);

    {
      let probeLocale = cleanUrl.match(/^\/(es)\b/) ? "es" : "en";
      if (resolved.params?.locale) probeLocale = resolved.params.locale;
      const normalizedProbe = normalizeLocale(probeLocale);
      if (
        isEmptyDetachedLocaleEntry({
          contentType,
          slug,
          locale: normalizedProbe,
          contentRoot: ci.contentRoot,
          ci,
        })
      ) {
        const availableUrls = ci.getAlternateUrls(slug, contentType);
        const payload = buildLocaleUnavailablePayload({
          contentType,
          slug,
          locale: normalizedProbe,
          availableUrls,
        });
        const apiPath = fromDatabase
          ? "/api/database-single"
          : getApiPath(contentType);
        return {
          queryKey: fromDatabase
            ? ["/api/database-single", contentType, slug, normalizedProbe]
            : [apiPath, slug, normalizedProbe],
          data: { ...payload, locale_unavailable: true },
        };
      }
    }

    if (fromDatabase) {
      try {
        let locale = cleanUrl.match(/^\/(es)\b/) ? "es" : "en";
        if (resolved.params?.locale) {
          locale = resolved.params.locale;
        }
        const normalizedLocale = normalizeLocale(locale);
        const page = await loadDatabaseSinglePage(contentType, slug, normalizedLocale, ci.contentRoot, dbm);
        if (!page) return null;
        const pageData = page as unknown as Record<string, unknown>;
        const singleEntry = finalizeSingleEntryForTemplates(
          (pageData.singleEntry as Record<string, unknown>) || {},
          { slug, locale: normalizedLocale },
        ) || {};
        pageData.singleEntry = singleEntry;
        const param = buildContentDeliveryParamBag({
          contentType,
          slug,
          locale: normalizedLocale,
          record: singleEntry,
          query: requestQuery,
          contentRoot: ci.contentRoot,
        });
        // Prefer URL-matched path params when present
        if (urlPathParams) {
          Object.assign(param, urlPathParams);
        }
        pageData.param = param;
        if (page.sections && Array.isArray(page.sections)) {
          page.sections = (await resolveDynamicEntries(page.sections, normalizedLocale, {
            db: dbm,
            contentRoot: ci.contentRoot,
            contentIndex: ci,
            singleEntry,
          })) as any;
          applyComponentImageSizes(page.sections as unknown[]);
        }
        // Fill missing image from entry-preview BEFORE template resolution so
        // {{ single.image | fallback }} does not bake the pipe default into sections.
        if (site?.entryPreviewManager) {
          await applyEntryPreviewOgImage(site.entryPreviewManager, {
            contentType,
            entry: singleEntry,
            previewConfig: getPreviewConfig(contentType, ci.contentRoot),
            pageData,
          });
        }
        if (Object.keys(singleEntry).length > 0) {
          const resolvedVars = resolveAllTemplateVars(pageData, {
            singleEntry,
            param,
            contentRoot: ci.contentRoot,
            context: { locale: normalizedLocale },
          }) as Record<string, unknown>;
          Object.assign(pageData, resolvedVars);
        } else {
          const resolvedVars = resolveAllTemplateVars(pageData, {
            param,
            contentRoot: ci.contentRoot,
            context: { locale: normalizedLocale },
          }) as Record<string, unknown>;
          Object.assign(pageData, resolvedVars);
        }
        const { enhanceArticleSectionsInPage } = await import("./markdown-enhance");
        await enhanceArticleSectionsInPage(pageData);
        const dbSingleRaw = ci.loadMergedContent(contentType, slug, normalizedLocale);
        const layout = resolveLayout(contentType, dbSingleRaw.data || pageData, ci.contentRoot);
        const { layout: _strip, ...pageRest } = pageData;
        return {
          queryKey: ["/api/database-single", contentType, slug, normalizedLocale],
          data: { ...pageRest, layout },
        };
      } catch {
        return null;
      }
    }

    const apiPath = getApiPath(contentType);
    let locale = cleanUrl.match(/^\/(es)\b/) ? "es" : "en";
    if (resolved.params?.locale) {
      locale = resolved.params.locale;
    } else if (!cleanUrl.match(/^\/(en|es)\b/)) {
      const commonData = ci.loadCommonData(contentType, slug);
      if (commonData?.locale && typeof commonData.locale === "string") {
        locale = commonData.locale;
      }
    }

    if (apiPath) {
      const localeOrVariant = locale;

      const result = ci.loadContent({
        contentType,
        slug,
        localeOrVariant,
      });

      if (!result.success) return null;

      const data = result.data as any;
      if (data.sections && Array.isArray(data.sections)) {
        applyComponentSectionDefaults(data.sections);
      }
      const rawContent = ci.loadMergedContent(
        contentType,
        slug,
        locale,
      );
      const layout = resolveLayout(contentType, rawContent.data || {}, ci.contentRoot);
      data.layout = layout;
      data.locale = locale;

      // Match /api/content-pages: attach singleEntry (including _image → image) and
      // resolve {{ single.* }} so SSR/hydration is not left on pipe fallbacks.
      // Build singleEntry before dynamic_entries so permanent_filters can use it.
      let singleEntry = buildSingleEntryFromContent(contentType, data as Record<string, unknown>, {
        slug,
        locale,
        contentRoot: ci.contentRoot,
      });
      if (singleEntry) {
        singleEntry = await resolveRelationsOnEntry(contentType, singleEntry, {
          contentRoot: ci.contentRoot,
          locale,
          db: dbm,
          contentIndex: ci,
        });
        data.singleEntry = singleEntry;
      }

      const param = buildContentDeliveryParamBag({
        contentType,
        slug,
        locale,
        record: { ...(data as Record<string, unknown>), ...(singleEntry || {}) },
        query: requestQuery,
        contentRoot: ci.contentRoot,
      });
      if (urlPathParams) Object.assign(param, urlPathParams);
      data.param = param;

      if (data.sections && Array.isArray(data.sections)) {
        attachVariableFieldsToSections(data.sections);
        data.sections = (await resolveDynamicEntries(
          data.sections,
          locale,
          { db: dbm, contentRoot: ci.contentRoot, contentIndex: ci, singleEntry },
        )) as any;
        applyComponentImageSizes(data.sections);
      }

      // Fill missing image from entry-preview BEFORE template resolution.
      if (singleEntry && site?.entryPreviewManager) {
        await applyEntryPreviewOgImage(site.entryPreviewManager, {
          contentType,
          entry: singleEntry,
          previewConfig: getPreviewConfig(contentType, ci.contentRoot),
          pageData: data,
        });
      }

      if (singleEntry) {
        const resolved = resolveAllTemplateVars(data, {
          singleEntry,
          param,
          contentRoot: ci.contentRoot,
          context: { locale },
        }) as Record<string, unknown>;
        Object.assign(data, resolved);
      } else {
        const resolved = resolveAllTemplateVars(data, {
          param,
          contentRoot: ci.contentRoot,
          context: { locale },
        }) as Record<string, unknown>;
        Object.assign(data, resolved);
      }

      const { enhanceArticleSectionsInPage } = await import("./markdown-enhance");
      await enhanceArticleSectionsInPage(data);

      return {
        queryKey: [apiPath, slug, isNonLocalized ? "auto" : locale],
        data,
      };
    }

    return null;
  } catch {
    return null;
  }
}

function resolveMenuQuery(menuId: string, locale: string, contentRoot = getDefaultContentRoot()): SingleQuery | null {
  try {
    const menusDir = path.join(contentRoot, "menus");
    let filePath: string | null = null;

    if (locale && locale !== getDefaultLocale()) {
      const localizedBase = `${menuId}.${locale}`;
      const localizedYml = path.join(menusDir, `${localizedBase}.yml`);
      const localizedYaml = path.join(menusDir, `${localizedBase}.yaml`);
      if (fs.existsSync(localizedYml)) filePath = localizedYml;
      else if (fs.existsSync(localizedYaml)) filePath = localizedYaml;
    }

    if (!filePath) {
      const baseYml = path.join(menusDir, `${menuId}.yml`);
      const baseYaml = path.join(menusDir, `${menuId}.yaml`);
      if (fs.existsSync(baseYml)) filePath = baseYml;
      else if (fs.existsSync(baseYaml)) filePath = baseYaml;
    }

    if (!filePath) return null;

    const content = fs.readFileSync(filePath, "utf-8");
    const data = yaml.load(content);
    const context = { locale };
    const resolved = resolveAllTemplateVars(data, {
      contentRoot,
      context,
      skipSiteVars: false,
    });

    return {
      queryKey: ["/api/menus", menuId, locale],
      data: { name: menuId, locale, data: resolved },
    };
  } catch {
    return null;
  }
}

const DEFAULT_EAGER_COUNT = 3;

export interface PreloadHint {
  src: string;
  srcset?: string;
  sizes?: string;
  /** When true, emit fetchpriority=high. Only the LCP candidate should set this. */
  highPriority?: boolean;
}

type PreloadRegistryImageEntry = {
  src: string;
  preset?: string[];
  srcset?: Array<{ w: number; url: string }>;
  width?: number;
};

type PreloadRegistryPayload = {
  presets?: Record<string, { sizes?: string }>;
  images: Record<string, PreloadRegistryImageEntry>;
};

/**
 * Total cap on <link rel="preload" as="image"> hints per page. Preloads compete
 * with the render-blocking CSS for bandwidth; on pages whose LCP is text (e.g.
 * the home hero headline), a large preload fan-out delays first paint.
 */
const MAX_IMAGE_PRELOADS = 6;

/**
 * Small logos/icons (hero partner pills, badges) are never the LCP element.
 * Preloading them with fetchpriority=high starves the critical CSS request.
 */
function isSmallLogoEntry(entry: PreloadRegistryImageEntry | undefined): boolean {
  if (!entry) return false;
  if (entry.preset?.some((p) => p === "logo" || p === "icon")) return true;
  if (typeof entry.width === "number" && entry.width > 0 && entry.width < 400) return true;
  return false;
}

export function resolvePreloadHints(
  payload: InitialDataPayload | null,
): PreloadHint[] {
  if (!payload) return [];

  let pageData: Record<string, unknown> | null = null;
  let registryData: PreloadRegistryPayload | null = null;

  const knownPageApiPaths = new Set(
    Object.keys(getAllConfigs()).map((type) => getApiPath(type)),
  );
  knownPageApiPaths.add("/api/database-single");

  for (const q of payload.queries) {
    const key0 = q.queryKey[0];
    if (
      typeof key0 === "string" &&
      (knownPageApiPaths.has(key0) || key0.startsWith("/api/content-pages/"))
    ) {
      pageData = q.data as Record<string, unknown>;
    }
    if (key0 === "/api/image-registry") {
      registryData = q.data as PreloadRegistryPayload;
    }
  }

  if (!pageData || !registryData) return [];

  const sections = pageData.sections as unknown[] | undefined;
  if (!Array.isArray(sections)) return [];

  const settings = pageData.settings as { loading?: { eager_count?: number } } | undefined;
  const eagerCount = settings?.loading?.eager_count ?? DEFAULT_EAGER_COUNT;

  // Prefer images from the first (hero) section as the LCP candidate; collect
  // remaining eager-window images as secondary preloads without high priority.
  const lcpRefs: ImageRefs = createEmptyImageRefs();
  const secondaryRefs: ImageRefs = createEmptyImageRefs();
  const prioritySections = sections.slice(0, eagerCount);
  if (prioritySections[0]) {
    extractImageRefsFromValue(prioritySections[0], lcpRefs);
  }
  for (const section of prioritySections.slice(1)) {
    extractImageRefsFromValue(section, secondaryRefs);
  }

  const schemaIdToSizes = new Map<string, string>();
  for (const section of prioritySections) {
    if (!section || typeof section !== "object") continue;
    const s = section as Record<string, unknown>;
    const fromSchema = buildImageIdToSchemaSizesMap(s);
    fromSchema.forEach((sz, id) => {
      schemaIdToSizes.set(id, sz);
    });
  }

  const hints: PreloadHint[] = [];
  const seen = new Set<string>();

  const srcToEntry = new Map<
    string,
    { src: string; preset?: string[]; srcset?: Array<{ w: number; url: string }> }
  >();
  for (const entry of Object.values(registryData.images)) {
    if (entry.src) srcToEntry.set(entry.src, entry);
  }

  const pushHint = (
    id: string | null,
    src: string,
    preset: string | undefined,
    highPriority: boolean,
  ) => {
    if (seen.has(src)) return;
    if (hints.length >= MAX_IMAGE_PRELOADS) return;
    seen.add(src);
    const entry = (id && registryData.images[id]) || srcToEntry.get(src);
    const hint: PreloadHint = { src, highPriority };
    if (entry?.srcset && entry.srcset.length > 0) {
      hint.srcset = entry.srcset
        .map((s: { w: number; url: string }) => `${s.url} ${s.w}w`)
        .join(", ");
      const presetConfig = preset ? registryData.presets?.[preset] : undefined;
      const schemaSizes = id ? schemaIdToSizes.get(id) : undefined;
      const fromImagePresets = firstPresetSizesFromImageEntry(entry, registryData.presets);
      hint.sizes =
        schemaSizes ??
        fromImagePresets ??
        presetConfig?.sizes ??
        DEFAULT_SRCSET_SIZES;
    }
    hints.push(hint);
  };

  // First non-logo image from the hero section is the sole high-priority LCP
  // preload. Small logos (partner pills, badges) are preloaded at normal
  // priority only — they are never the LCP element.
  let lcpAssigned = false;
  for (const [id, preset] of lcpRefs.ids) {
    const entry = registryData.images[id];
    if (!entry?.src) continue;
    const high = !lcpAssigned && !isSmallLogoEntry(entry);
    pushHint(id, entry.src, preset, high);
    if (high) lcpAssigned = true;
  }
  for (const url of lcpRefs.directUrls) {
    const high = !lcpAssigned && !isSmallLogoEntry(srcToEntry.get(url));
    pushHint(null, url, undefined, high);
    if (high) lcpAssigned = true;
  }

  for (const [id, preset] of secondaryRefs.ids) {
    const entry = registryData.images[id];
    if (entry?.src) pushHint(id, entry.src, preset, false);
  }
  for (const url of secondaryRefs.directUrls) {
    pushHint(null, url, undefined, false);
  }

  return hints;
}

function escapeAttr(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function replaceMetaContent(html: string, attr: string, attrValue: string, replacement: string): string {
  const escaped = escapeAttr(replacement);
  const pattern = new RegExp(`(<meta[^>]*${attr.replace(":", "\\:")}="${attrValue}"[^>]*content=")[^"]*(")`);
  const patternRev = new RegExp(`(<meta[^>]*content=")[^"]*("[^>]*${attr.replace(":", "\\:")}="${attrValue}")`);
  if (pattern.test(html)) return html.replace(pattern, `$1${escaped}$2`);
  if (patternRev.test(html)) return html.replace(patternRev, `$1${escaped}$2`);
  return html;
}

export function injectSsrMetaTags(
  html: string,
  payload: InitialDataPayload | null,
  contentRoot?: string,
  requestUrl?: string | null,
): string {
  if (!payload) return html;

  const lang = payload.locale || "en";
  html = html.replace(/(<html\s[^>]*lang=")[^"]*(")/i, `$1${lang}$2`);
  html = replaceMetaContent(html, "property", "og:locale", toOgLocale(lang));

  const knownPageApiPaths = new Set(
    Object.keys(getAllConfigs()).map((type) => getApiPath(type)),
  );
  knownPageApiPaths.add("/api/database-single");

  let pageQuery: SingleQuery | null = null;
  for (const q of payload.queries) {
    const key0 = q.queryKey[0];
    if (typeof key0 === "string" && (knownPageApiPaths.has(key0) || key0.startsWith("/api/content-pages/"))) {
      pageQuery = q;
      break;
    }
  }

  if (!pageQuery?.data) return html;

  const data = pageQuery.data as Record<string, unknown>;
  if (data.locale_unavailable === true || data.error === "locale_unavailable") {
    if (html.includes('name="robots"')) {
      html = replaceMetaContent(html, "name", "robots", "noindex");
    } else {
      html = html.replace("</head>", `<meta name="robots" content="noindex" />\n</head>`);
    }
    return html;
  }
  let meta = data.meta as Record<string, unknown> | undefined;
  if (!meta) return html;

  const singleEntry = data.singleEntry as Record<string, unknown> | undefined;
  const region =
    typeof data.region === "string" && data.region.trim()
      ? data.region.trim()
      : undefined;
  meta = resolveAllTemplateVars(meta, {
    singleEntry,
    meta,
    contentRoot,
    context: {
      locale: typeof data.locale === "string" ? data.locale : undefined,
      region,
    },
    skipSiteVars: false,
  }) as Record<string, unknown>;

  if (typeof meta.page_title === "string" && !meta.page_title.includes("{{")) {
    html = html.replace(/<title>[\s\S]*?<\/title>/, `<title>${escapeAttr(meta.page_title)}</title>`);
    html = replaceMetaContent(html, "property", "og:title", meta.page_title);
    html = replaceMetaContent(html, "name", "twitter:title", meta.page_title);
  }

  if (typeof meta.description === "string" && !meta.description.includes("{{")) {
    html = replaceMetaContent(html, "name", "description", meta.description);
    html = replaceMetaContent(html, "property", "og:description", meta.description);
    html = replaceMetaContent(html, "name", "twitter:description", meta.description);
  }

  if (typeof meta.og_image === "string" && !meta.og_image.includes("{{")) {
    const escaped = escapeAttr(meta.og_image);
    if (html.includes('property="og:image"')) {
      html = replaceMetaContent(html, "property", "og:image", meta.og_image);
    } else {
      html = html.replace("</head>", `<meta property="og:image" content="${escaped}" />\n</head>`);
    }
    if (html.includes('name="twitter:image"')) {
      html = replaceMetaContent(html, "name", "twitter:image", meta.og_image);
    } else {
      html = html.replace("</head>", `<meta name="twitter:image" content="${escaped}" />\n</head>`);
    }
  }

  const robotsValue = resolveEffectiveRobots(
    typeof meta.robots === "string" ? meta.robots : undefined,
    contentRoot,
  );
  if (html.includes('name="robots"')) {
    html = replaceMetaContent(html, "name", "robots", robotsValue);
  } else {
    html = html.replace("</head>", `<meta name="robots" content="${escapeAttr(robotsValue)}" />\n</head>`);
  }

  if (typeof meta.canonical_url === "string" && meta.canonical_url.trim() && !meta.canonical_url.includes("{{")) {
    const canonicalHref = buildListingCanonicalHref(meta.canonical_url.trim(), requestUrl);
    const escaped = escapeAttr(canonicalHref);
    const canonicalTag = `<link rel="canonical" href="${escaped}" />`;
    if (/\brel\s*=\s*["']canonical["']/i.test(html)) {
      html = html.replace(
        /<link\b(?:(?!\/>)[\s\S])*?\brel\s*=\s*["']canonical["'](?:(?!\/>)[\s\S])*?\/?>\s*/gi,
        "",
      );
    }
    html = html.replace("</head>", `${canonicalTag}\n</head>`);
  }

  return html;
}

export async function resolveInitialData(
  url: string,
  ci: ContentIndex = contentIndex,
  dbm: DatabaseManager = databaseManager,
  site?: SiteContext,
): Promise<InitialDataPayload | null> {
  const cleanUrl = url.split("?")[0].split("#")[0];

  const pageQuery = await resolvePageQuery(url, ci, dbm, site);
  const parsedUrl = ci.parseContentUrl(cleanUrl);

  const variablesQuery: SingleQuery = {
    queryKey: ["/api/variables"],
    data: getVariableManager(ci.contentRoot).getDefinitions(),
  };

  const queries: SingleQuery[] = [];
  if (pageQuery) queries.push(pageQuery);
  queries.push(variablesQuery);

  // Seed main-navbar and main-footer unconditionally so the header and footer
  // are always present in the server-rendered HTML, even when pageQuery is null
  // (e.g. database-backed pages where the DB query failed or returned no result).
  const defaultLocale = cleanUrl.startsWith("/es") ? "es" : "en";
  const defaultNavbarQuery = resolveMenuQuery("main-navbar", defaultLocale, ci.contentRoot);
  if (defaultNavbarQuery) queries.push(defaultNavbarQuery);
  const defaultFooterQuery = resolveMenuQuery("main-footer", defaultLocale, ci.contentRoot);
  if (defaultFooterQuery) queries.push(defaultFooterQuery);

  // If SSR resolved a canonical/base slug but the current URL uses a localized
  // alias slug, hydrate both keys to avoid first-render cache miss on client.
  if (pageQuery && parsedUrl?.slug) {
    const key = pageQuery.queryKey;
    if (Array.isArray(key)) {
      const key0 = key[0];
      if (typeof key0 === "string") {
        if (
          typeof key[1] === "string" &&
          getApiPath(parsedUrl.contentType) === key0 &&
          key[1] !== parsedUrl.slug
        ) {
          const aliasKey = [key0, parsedUrl.slug, key[2]];
          if (!queries.some((q) => q.queryKey.length === aliasKey.length && q.queryKey.every((v, i) => v === aliasKey[i]))) {
            queries.push({ queryKey: aliasKey, data: pageQuery.data });
          }
        }
      }
    }
  }

  let resolvedLocale: string | undefined;

  if (pageQuery) {
    const pageData = pageQuery.data as Record<string, unknown>;
    const layout = pageData?.layout as
      | { menu?: { top?: string | null; bottom?: string | null } }
      | undefined;
    // queryKey shape differs by route:
    //   database-single → ["/api/database-single", contentType, slug, locale]  (locale at index 3)
    //   all others      → [apiPath, slug, locale]                               (locale at index 2)
    const isDatabaseSingle = pageQuery.queryKey[0] === "/api/database-single";
    const localeFromKey = isDatabaseSingle
      ? (pageQuery.queryKey[3] as string | undefined)
      : (pageQuery.queryKey[2] as string | undefined);
    const locale =
      (typeof pageData?.locale === "string" && pageData.locale ? pageData.locale : undefined) ||
      (typeof localeFromKey === "string" && localeFromKey ? localeFromKey : undefined) ||
      defaultLocale;

    resolvedLocale = locale;

    // Seed menus for the content locale AND the URL-inferred locale when they
    // differ (e.g. /landing/foo with no /es prefix but es.yml). The header may
    // switch language after hydrate; the SSR subset must include both.
    const menuLocales = new Set<string>([locale, defaultLocale].filter(Boolean));
    const topMenuId = layout?.menu?.top ?? "main-navbar";
    const bottomMenuId = layout?.menu?.bottom ?? "main-footer";
    for (const menuLocale of menuLocales) {
      if (topMenuId) {
        const mq = resolveMenuQuery(topMenuId, menuLocale, ci.contentRoot);
        if (
          mq &&
          !queries.some(
            (q) =>
              Array.isArray(q.queryKey) &&
              q.queryKey[0] === "/api/menus" &&
              q.queryKey[1] === topMenuId &&
              q.queryKey[2] === menuLocale,
          )
        ) {
          queries.push(mq);
        }
      }
      if (bottomMenuId) {
        const mq = resolveMenuQuery(bottomMenuId, menuLocale, ci.contentRoot);
        if (
          mq &&
          !queries.some(
            (q) =>
              Array.isArray(q.queryKey) &&
              q.queryKey[0] === "/api/menus" &&
              q.queryKey[1] === bottomMenuId &&
              q.queryKey[2] === menuLocale,
          )
        ) {
          queries.push(mq);
        }
      }
    }
  }

  const contentTypesPayload = buildContentTypesPayload(ci, dbm);
  queries.push({
    queryKey: ["/api/content-types"],
    data: contentTypesPayload,
  });

  const registry = site
    ? getMergedImageRegistry(site)
    : loadImageRegistry(ci.contentRoot);
  if (registry) {
    // Inline only images referenced by this page + menus (not the full ~500KB registry).
    // Editors refetch the full registry via /api/image-registry when edit mode opens.
    const pageData = pageQuery?.data ?? null;
    const menuDatas = queries
      .filter((q) => Array.isArray(q.queryKey) && q.queryKey[0] === "/api/menus")
      .map((q) => q.data);
    const subset = buildPageImageRegistrySubset(registry as any, pageData, menuDatas, {
      variables: variablesQuery.data,
    });
    queries.push({
      queryKey: ["/api/image-registry"],
      data: subset,
    });
  }

  const navigationManifest = readNavigationEagerManifest(ci.contentRoot);
  if (navigationManifest) {
    queries.push({
      queryKey: ["navigation-eager-manifest"],
      data: navigationManifest,
    });
  }

  const pageData = pageQuery?.data as Record<string, unknown> | undefined;
  const httpStatus =
    pageData?.locale_unavailable === true || pageData?.error === "locale_unavailable"
      ? 404
      : undefined;

  return { queries, locale: resolvedLocale, ...(httpStatus ? { httpStatus } : {}) };
}

function buildContentTypesPayload(
  ci: ContentIndex = contentIndex,
  dbm: DatabaseManager = databaseManager,
): Record<string, unknown>[] {
  const configs = getAllConfigs(ci.contentRoot);
  const result: Record<string, unknown>[] = [];
  for (const [type, config] of Object.entries(configs)) {
    result.push({
      name: type,
      label: getLabel(type, ci.contentRoot),
      directory: config.directory,
      has_database: !!config.database?.slug,
      database_slug: config.database?.slug || null,
      single_template: !!config.single_template,
      has_field_mapping: !!(
        config.field_mapping &&
        Object.keys(config.field_mapping).filter(
          (k) => !k.startsWith("_"),
        ).length > 0
      ),
      unique_fields: config.unique_fields ?? ["slug"],
      field_mapping_keys: Object.keys(config.field_mapping ?? {}).filter(
        (k) => !k.startsWith("_"),
      ),
      url_pattern: config.url_pattern,
      locale_key: config.field_mapping?._locale || null,
      static_entry_count: ci.findByType(type).length,
      database_entry_count: config.database?.slug
        ? getCachedDatabaseEntryCount(dbm, config.database.slug)
        : null,
      layout: getLayout(type, ci.contentRoot),
    });
  }
  return result;
}

function buildThemeCssOverrides(contentRoot = getDefaultContentRoot()): string {
  try {
    const themePath = path.join(contentRoot, "theme.json");
    if (!fs.existsSync(themePath)) return "";
    const theme = JSON.parse(fs.readFileSync(themePath, "utf-8")) as {
      colors?: { light?: Record<string, string>; dark?: Record<string, string> };
    };
    const colors = theme.colors;
    if (!colors) return "";
    let css = "";
    if (colors.light && Object.keys(colors.light).length > 0) {
      const vars = Object.entries(colors.light)
        .map(([k, v]) => `  ${k}: ${v};`)
        .join("\n");
      css += `:root {\n${vars}\n}\n`;
    }
    if (colors.dark && Object.keys(colors.dark).length > 0) {
      const vars = Object.entries(colors.dark)
        .map(([k, v]) => `  ${k}: ${v};`)
        .join("\n");
      css += `.dark {\n${vars}\n}\n`;
    }
    return css ? `<style id="__theme_overrides__">\n${css}</style>` : "";
  } catch {
    return "";
  }
}

export function initialDataMiddleware(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  if (req.path.startsWith("/api/") || req.path.startsWith("/private/")) {
    return next();
  }

  const ext = req.path.split(".").pop();
  if (
    ext &&
    [
      "js",
      "ts",
      "tsx",
      "css",
      "map",
      "woff2",
      "woff",
      "ttf",
      "png",
      "jpg",
      "jpeg",
      "webp",
      "svg",
      "ico",
      "json",
    ].includes(ext)
  ) {
    return next();
  }

  const ci = ((res.locals as any).site?.contentIndex ?? contentIndex) as ContentIndex;
  const dbm = ((res.locals as any).site?.database ?? databaseManager) as DatabaseManager;
  const site = (res.locals as any).site as SiteContext | undefined;
  // Resolve once per request; SSR catch-all reuses res.locals.initialDataPromise.
  const locals = res.locals as { initialDataPromise?: Promise<InitialDataPayload | null> };
  const payloadPromise =
    locals.initialDataPromise ??
    resolveInitialData(req.originalUrl, ci, dbm, site).catch(() => null);
  locals.initialDataPromise = payloadPromise;

  const originalEnd = res.end;
  res.end = function (this: Response, chunk?: any, ...args: any[]) {
    const contentType = res.getHeader("content-type");
    if (contentType && String(contentType).includes("text/html") && chunk) {
      payloadPromise
        .then((payload) => {
          try {
            const html =
              typeof chunk === "string" ? chunk : chunk.toString("utf-8");
            let injected = html.includes('id="__INITIAL_DATA__"')
              ? html.replace(/<script id="__INITIAL_DATA__" type="application\/json">[\s\S]*?<\/script>/, '')
              : html;

            if (!injected.includes('storage.googleapis.com')) {
              const gcsHints =
                '<link rel="preconnect" href="https://storage.googleapis.com" crossorigin />\n' +
                '<link rel="dns-prefetch" href="https://storage.googleapis.com" />\n';
              injected = injected.replace("</head>", gcsHints + "</head>");
            }

            if (payload) {
              const scriptTag = `<script id="__INITIAL_DATA__" type="application/json">${JSON.stringify(payload).replace(/</g, "\\u003c")}</script>`;
              injected = injected.replace("</body>", scriptTag + "</body>");
              const themeStyle = buildThemeCssOverrides(ci.contentRoot);
              if (themeStyle && !injected.includes('id="__theme_overrides__"')) {
                injected = injected.replace("</head>", themeStyle + "</head>");
              }
            }
            injected = applyEntryModulePreload(injected);

            const newLength = Buffer.byteLength(injected, "utf-8");
            res.setHeader("content-length", newLength);

            originalEnd.call(this, injected, ...args);
          } catch {
            originalEnd.call(this, chunk, ...args);
          }
        })
        .catch(() => {
          originalEnd.call(this, chunk, ...args);
        });
      return this;
    }
    return originalEnd.call(this, chunk, ...args);
  } as any;

  next();
}
