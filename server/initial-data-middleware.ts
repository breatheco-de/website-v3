import * as fs from "fs";
import { getDefaultContentRoot } from "./site-config";
import * as path from "path";
import * as yaml from "js-yaml";
import type { Request, Response, NextFunction } from "express";
import { contentIndex, ContentIndex } from "./content-index";
import { resolveDynamicEntries } from "./dynamic-entries";
import { resolveLayout, getAllConfigs, getContentTypeConfig, getLabel, getLayout, getPreviewConfig } from "./content-types";
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
import { attachVariableFieldsToSections } from "./database-single-loader";
import { loadEntryForDelivery } from "./entry-delivery";
import { layoutOwnerForEntry, typeUsesSharedTemplate } from "./layout-owner";
import { getVersioningManager } from "./versioning/VersioningManager";
import type { ServedPageVersion } from "./versioning/assign-request";
import { resolveAllTemplateVars, buildContentDeliveryParamBag } from "./resolve-template-vars";
import {
  htmlDocumentCacheControlFor,
  requestBakesQueryParamTemplate,
  urlHasContentQuery,
} from "./html-page-cache";
import { buildSingleEntryFromContent } from "./build-single-entry";
import { hydrateEntryForDelivery } from "./hydrate-entry-delivery";
import { databaseManager, type DatabaseManager } from "./database";
import { applyEntryModulePreload } from "./utils/html-transforms";
import {
  buildInitialDataScriptTag,
  injectPageTrackingDataLayer,
  injectPageVersionDataLayer,
  insertBefore,
  replaceLiteral,
} from "./utils/html-inject";
import { isLlmHtmlAudience } from "../shared/runtime-issues";
import { resolveHtmlVariant } from "./html-variant-key";
import { servedVariantSlug } from "./versioning/assign-request";
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
import { resolveEffectiveCanonical } from "./resolve-effective-canonical";
import { isLocaleHomeAlias } from "@shared/public-app-routes";
import { isSiteThemedPath, type ThemePaint } from "@shared/theme-palette";
import { loadSiteTheme } from "./theme-config";
import { injectThemeOverrides } from "./theme-html";
import { buildServerPageTracking } from "./tracking-page-context";

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
  /** Stripped before the payload is sent to the client. */
  skipHtmlCache?: boolean;
}

export interface InitialDataPayload {
  queries: SingleQuery[];
  locale?: string;
  /** When set, SSR HTML response should use this status (e.g. empty detached locale). */
  httpStatus?: number;
  /** Light colors used to paint section backgrounds as real colors. */
  themePaint?: import("@shared/theme-palette").ThemePaint;
  /**
   * Query-string {{ param.* }} must not be stored under a path-only cache key.
   * Removed before `__INITIAL_DATA__` is written.
   */
  skipHtmlCache?: boolean;
}

/** Page test assignment for this request (from resolveHtmlVariant). */
export interface InitialDataAssignment {
  /** Real variant slug to load; null serves the live page (Default group or no test). */
  variant: string | null;
  /** Seeded into page data as `_page_version` so the client reports the exposure. */
  pageVersion: ServedPageVersion | null;
}

export async function resolvePageQuery(
  url: string,
  ci: ContentIndex = contentIndex,
  dbm: DatabaseManager = databaseManager,
  site?: SiteContext,
  assignment?: InitialDataAssignment,
): Promise<SingleQuery | null> {
  const query = await resolvePageQueryInner(url, ci, dbm, site, assignment?.variant ?? null);
  if (query && assignment?.pageVersion && query.data && typeof query.data === "object" && !Array.isArray(query.data)) {
    query.data = { ...(query.data as Record<string, unknown>), _page_version: assignment.pageVersion };
  }
  if (query && query.data && typeof query.data === "object" && !Array.isArray(query.data)) {
    const data = query.data as Record<string, unknown>;
    const resolved = data.locale_unavailable ? null : ci.resolveUrl(url.split("?")[0].split("#")[0]);
    const tracking = resolved
      ? buildServerPageTracking({
          contentRoot: ci.contentRoot,
          contentType: resolved.contentType,
          slug: resolved.slug,
          data,
        })
      : null;
    if (tracking) query.data = { ...data, _tracking: tracking };
  }
  return query;
}

async function resolvePageQueryInner(
  url: string,
  ci: ContentIndex,
  dbm: DatabaseManager,
  site: SiteContext | undefined,
  variant: string | null,
): Promise<SingleQuery | null> {
  // Don't seed page data for force_variant requests — the SSR render would use
  // the default-page data while the client needs a different query key for the
  // variant, causing a hydration mismatch. Return null so SSR emits an empty
  // shell; the client spinner + fetch handles it cleanly.
  if (url.includes("force_variant=")) return null;

  const cleanUrl = url.split("?")[0].split("#")[0];

  // Locale-home aliases (`/`, `/en`, `/es`, `/us`, `/es/home`) must 301 via
  // redirectMiddleware — never soft-serve the homepage document here.
  if (isLocaleHomeAlias(cleanUrl)) return null;

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
        return {
          queryKey: [getApiPath(contentType), slug, normalizedProbe],
          data: { ...payload, locale_unavailable: true },
        };
      }
    }

    if (typeUsesSharedTemplate(getContentTypeConfig(contentType, ci.contentRoot))) {
      try {
        let locale = cleanUrl.match(/^\/(es)\b/) ? "es" : "en";
        if (resolved.params?.locale) {
          locale = resolved.params.locale;
        }
        const normalizedLocale = normalizeLocale(locale);
        const attached =
          !!variant && layoutOwnerForEntry(contentType, slug, ci.contentRoot) === "shared_template";
        const delivered = await loadEntryForDelivery(
          ci,
          contentType,
          slug,
          normalizedLocale,
          variant ? (attached ? { templateVariant: variant } : { entryVariant: variant }) : {},
        );
        if (!delivered) return null;
        const pageData = delivered.data;
        const layout = resolveLayout(contentType, pageData, ci.contentRoot);
        const singleEntry = delivered.singleEntry;
        const param = buildContentDeliveryParamBag({
          contentType,
          slug,
          locale: normalizedLocale,
          record: { ...pageData, ...(singleEntry || {}) },
          query: requestQuery,
          contentRoot: ci.contentRoot,
        });
        // Prefer URL-matched path params when present
        if (urlPathParams) {
          Object.assign(param, urlPathParams);
        }
        pageData.param = param;
        if (singleEntry) pageData.singleEntry = singleEntry;
        if (Array.isArray(pageData.sections)) {
          pageData.sections = (await resolveDynamicEntries(pageData.sections, normalizedLocale, {
            db: dbm,
            contentRoot: ci.contentRoot,
            contentIndex: ci,
            singleEntry,
          })) as any;
          applyComponentImageSizes(pageData.sections as unknown[]);
        }
        // Fill missing image from entry-preview BEFORE template resolution so
        // {{ entry.image | fallback }} does not bake the pipe default into sections.
        if (singleEntry && site?.entryPreviewManager) {
          await applyEntryPreviewOgImage(site.entryPreviewManager, {
            contentType,
            entry: singleEntry,
            previewConfig: getPreviewConfig(contentType, ci.contentRoot),
            pageData,
          });
        }
        const skipHtmlCache = requestBakesQueryParamTemplate(
          url,
          pageData,
          urlPathParams ? Object.keys(urlPathParams) : undefined,
        );
        const resolvedVars = resolveAllTemplateVars(pageData, {
          ...(singleEntry && Object.keys(singleEntry).length > 0 ? { singleEntry } : {}),
          param,
          contentRoot: ci.contentRoot,
          context: { locale: normalizedLocale },
        }) as Record<string, unknown>;
        Object.assign(pageData, resolvedVars);
        const { enhanceArticleSectionsInPage } = await import("./markdown-enhance");
        await enhanceArticleSectionsInPage(pageData);
        const { layout: _strip, ...pageRest } = pageData;
        return {
          queryKey: [getApiPath(contentType), slug, normalizedLocale],
          ...(skipHtmlCache ? { skipHtmlCache: true } : {}),
          data: {
            ...pageRest,
            layout,
            detached: delivered.detached,
            ...(delivered.perEntryRemovedSections ? { perEntryRemovedSections: delivered.perEntryRemovedSections } : {}),
          },
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

      let variantData: Record<string, unknown> | null = null;
      if (variant) {
        const vm = site?.versioningManager ?? getVersioningManager();
        const loaded = vm.getVariantContent(contentType, slug, variant, locale);
        // VersioningManager caches the parsed object; never mutate it.
        if (loaded && typeof loaded === "object") variantData = structuredClone(loaded) as Record<string, unknown>;
      }

      const result = variantData
        ? { success: true as const, data: variantData }
        : ci.loadContent({
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
        singleEntry = await hydrateEntryForDelivery(contentType, singleEntry, {
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

      const skipHtmlCache = requestBakesQueryParamTemplate(
        url,
        data,
        urlPathParams ? Object.keys(urlPathParams) : undefined,
      );
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
        ...(skipHtmlCache ? { skipHtmlCache: true } : {}),
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
  if (pattern.test(html)) {
    return html.replace(pattern, (_m, open: string, close: string) => open + escaped + close);
  }
  if (patternRev.test(html)) {
    return html.replace(patternRev, (_m, open: string, close: string) => open + escaped + close);
  }
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
  html = html.replace(
    /(<html\s[^>]*lang=")[^"]*(")/i,
    (_m, open: string, close: string) => open + escapeAttr(lang) + close,
  );
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
      html = insertBefore(html, "</head>", `<meta name="robots" content="noindex" />\n`);
    }
    return html;
  }
  let meta = data.meta as Record<string, unknown> | undefined;
  if (!meta) {
    meta = {};
  }

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
    html = replaceLiteral(html, /<title>[\s\S]*?<\/title>/, `<title>${escapeAttr(meta.page_title)}</title>`);
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
      html = insertBefore(html, "</head>", `<meta property="og:image" content="${escaped}" />\n`);
    }
    if (html.includes('name="twitter:image"')) {
      html = replaceMetaContent(html, "name", "twitter:image", meta.og_image);
    } else {
      html = insertBefore(html, "</head>", `<meta name="twitter:image" content="${escaped}" />\n`);
    }
  }

  const robotsValue = resolveEffectiveRobots(
    typeof meta.robots === "string" ? meta.robots : undefined,
    contentRoot,
  );
  if (html.includes('name="robots"')) {
    html = replaceMetaContent(html, "name", "robots", robotsValue);
  } else {
    html = insertBefore(html, "</head>", `<meta name="robots" content="${escapeAttr(robotsValue)}" />\n`);
  }

  const contentTypeForCanonical = contentTypeFromPageQuery(pageQuery);
  const localeForCanonical =
    (typeof data.locale === "string" && data.locale) ||
    payload.locale ||
    "en";
  const recordForCanonical = {
    ...data,
    ...(singleEntry && typeof singleEntry === "object" ? singleEntry : {}),
    slug:
      (typeof data.slug === "string" && data.slug) ||
      (typeof singleEntry?.slug === "string" && singleEntry.slug) ||
      (contentTypeForCanonical?.slug ?? undefined),
  };
  if (contentTypeForCanonical?.contentType) {
    const canonicalHref = resolveEffectiveCanonical({
      meta,
      contentType: contentTypeForCanonical.contentType,
      record: recordForCanonical,
      locale: localeForCanonical,
      requestUrl,
      contentRoot,
    });
    if (canonicalHref) {
      const escaped = escapeAttr(canonicalHref);
      const canonicalTag = `<link rel="canonical" href="${escaped}" />`;
      if (/\brel\s*=\s*["']canonical["']/i.test(html)) {
        html = html.replace(
          /<link\b(?:(?!\/>)[\s\S])*?\brel\s*=\s*["']canonical["'](?:(?!\/>)[\s\S])*?\/?>\s*/gi,
          "",
        );
      }
      html = insertBefore(html, "</head>", `${canonicalTag}\n`);

      if (html.includes('property="og:url"')) {
        html = replaceMetaContent(html, "property", "og:url", canonicalHref);
      } else {
        html = insertBefore(html, "</head>", `<meta property="og:url" content="${escaped}" />\n`);
      }
    }
  }

  return html;
}

function contentTypeFromPageQuery(
  pageQuery: SingleQuery,
): { contentType: string; slug?: string } | null {
  const key = pageQuery.queryKey;
  const key0 = key[0];
  if (typeof key0 !== "string") return null;

  if (key0 === "/api/database-single") {
    const contentType = typeof key[1] === "string" ? key[1] : null;
    if (!contentType) return null;
    return {
      contentType,
      slug: typeof key[2] === "string" ? key[2] : undefined,
    };
  }

  if (key0.startsWith("/api/content-pages/")) {
    return {
      contentType: key0.slice("/api/content-pages/".length),
      slug: typeof key[1] === "string" ? key[1] : undefined,
    };
  }

  for (const type of Object.keys(getAllConfigs())) {
    if (getApiPath(type) === key0) {
      return {
        contentType: type,
        slug: typeof key[1] === "string" ? key[1] : undefined,
      };
    }
  }
  return null;
}

/**
 * A `?` that fills `{{ param.X }}` in the page YAML must be rendered, not served from the path copy.
 * Query keys the page does not use (`utm`, `plan`) leave the copy in place.
 */
export function urlBakesStoredPageQuery(url: string, ci: ContentIndex | undefined): boolean {
  if (!ci || !urlHasContentQuery(url)) return false;
  const clean = url.split("?")[0].split("#")[0] || "/";
  const resolved = ci.resolveUrl(clean);
  if (!resolved) return false;
  let locale = clean.startsWith("/es") ? "es" : "en";
  if (resolved.params?.locale) locale = resolved.params.locale;
  else if (resolved.patternLocale && resolved.patternLocale !== "default") locale = resolved.patternLocale;
  const { data } = ci.loadMergedContent(resolved.contentType, resolved.slug, locale);
  if (!data) return false;
  return requestBakesQueryParamTemplate(url, data, resolved.params ? Object.keys(resolved.params) : undefined);
}

export async function resolveInitialData(
  url: string,
  ci: ContentIndex = contentIndex,
  dbm: DatabaseManager = databaseManager,
  site?: SiteContext,
  assignment?: InitialDataAssignment,
): Promise<InitialDataPayload | null> {
  const cleanUrl = url.split("?")[0].split("#")[0];

  const pageQuery = await resolvePageQuery(url, ci, dbm, site, assignment);
  const parsedUrl = ci.parseContentUrl(cleanUrl);

  const variablesQuery: SingleQuery = {
    queryKey: ["/api/variables"],
    data: getVariableManager(ci.contentRoot).getDefinitions(),
  };

  const queries: SingleQuery[] = [];
  const skipHtmlCache = pageQuery?.skipHtmlCache === true;
  if (pageQuery) {
    delete pageQuery.skipHtmlCache;
    queries.push(pageQuery);
  }
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

  const contentTypesPayload = buildContentTypesPayload(ci);
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

  const themePaint = themePaintFor(ci.contentRoot);
  return {
    queries,
    locale: resolvedLocale,
    ...(themePaint ? { themePaint } : {}),
    ...(httpStatus ? { httpStatus } : {}),
    ...(skipHtmlCache ? { skipHtmlCache: true } : {}),
  };
}

function buildContentTypesPayload(
  ci: ContentIndex = contentIndex,
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
      layout: getLayout(type, ci.contentRoot),
    });
  }
  return result;
}

function themePaintFor(contentRoot: string): ThemePaint | undefined {
  const theme = loadSiteTheme(contentRoot);
  const light = theme?.colors?.light;
  if (!light || Object.keys(light).length === 0) return undefined;
  const backgrounds = (theme?.backgrounds ?? [])
    .filter((entry) => entry.id)
    .map((entry) => ({
      id: entry.id,
      ...(entry.cssVar ? { cssVar: entry.cssVar } : {}),
      ...(entry.value ? { value: entry.value } : {}),
      ...(entry.lightValue ? { lightValue: entry.lightValue } : {}),
    }));
  return { light, backgrounds };
}

/** Page-rendering private routes (preview, demos): theme style only, no initial data. */
function themeOnlyHtmlHook(res: Response, contentRoot: string): void {
  const originalEnd = res.end;
  res.end = function (this: Response, chunk?: any, ...args: any[]) {
    const contentType = res.getHeader("content-type");
    if (contentType && String(contentType).includes("text/html") && chunk) {
      try {
        const html = typeof chunk === "string" ? chunk : chunk.toString("utf-8");
        const injected = injectThemeOverrides(html, contentRoot);
        if (injected !== html) res.setHeader("content-length", Buffer.byteLength(injected, "utf-8"));
        return originalEnd.call(this, injected, ...args);
      } catch {
        return originalEnd.call(this, chunk, ...args);
      }
    }
    return originalEnd.call(this, chunk, ...args);
  } as any;
}

export function initialDataMiddleware(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  if (req.path.startsWith("/api/")) {
    return next();
  }
  if (req.path === "/private" || req.path.startsWith("/private/")) {
    if (isSiteThemedPath(req.path)) {
      const site = (res.locals as any).site as SiteContext | undefined;
      themeOnlyHtmlHook(res, site?.contentRoot ?? getDefaultContentRoot());
    }
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
  const locals = res.locals as {
    initialDataPromise?: Promise<InitialDataPayload | null>;
    htmlVariantKey?: string;
    abTestedPage?: boolean;
  };
  let assignment: InitialDataAssignment | undefined;
  // AI crawlers keep the key unset so the LLM HTML branch in vite.ts still handles them.
  if (!locals.initialDataPromise && !isLlmHtmlAudience(req.get?.("user-agent"))) {
    try {
      const resolution = resolveHtmlVariant(req, res);
      locals.htmlVariantKey ??= resolution.key;
      if (resolution.assignment) {
        assignment = {
          variant: servedVariantSlug(resolution.assignment),
          pageVersion: {
            experiment_id: resolution.assignment.experimentId,
            variant: resolution.assignment.variant,
          },
        };
      }
    } catch {
      assignment = undefined;
    }
  }
  const payloadPromise =
    locals.initialDataPromise ??
    resolveInitialData(req.originalUrl, ci, dbm, site, assignment).catch(() => null);
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
            injected = injectPageVersionDataLayer(injected, payload);
            injected = injectPageTrackingDataLayer(injected, payload);
            if (locals.abTestedPage && !res.headersSent) {
              res.setHeader("Cache-Control", htmlDocumentCacheControlFor(res));
            }

            if (!injected.includes('storage.googleapis.com')) {
              const gcsHints =
                '<link rel="preconnect" href="https://storage.googleapis.com" crossorigin />\n' +
                '<link rel="dns-prefetch" href="https://storage.googleapis.com" />\n';
              injected = insertBefore(injected, "</head>", gcsHints);
            }

            if (payload) {
              injected = insertBefore(injected, "</body>", buildInitialDataScriptTag(payload));
            }
            injected = injectThemeOverrides(injected, ci.contentRoot);
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
