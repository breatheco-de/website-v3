import * as fs from "fs";
import { getDefaultContentRoot } from "./site-config";
import * as path from "path";
import * as yaml from "js-yaml";
import { getOrganizationTwitterHandle, getWebsiteDefaultSocialImage } from "./schema-org";
import { contentIndex } from "./content-index";
import { deepMerge } from "./utils/deepMerge";
import { escapeTemplateVars, unescapeObjectVars } from "@shared/templateVars";
import { getFolder, getContentTypeConfig, resolveUrlPatternWithMapping, resolveEntryUpdatedAt } from "./content-types";
import { getBaseUrl, generateHreflangTags, generateListingHreflangTags, generateHomepageHreflangTags } from "./hreflang";
import { getHomePage, getSupportedLocales, getDefaultLocale, resolveEffectiveRobots, isIndexingBlocked } from "./settings";
import { resolveDynamicEntries } from "./dynamic-entries";
import { mergeSingleTemplate } from "./database-single-loader";
import { resolveAllTemplateVars } from "./resolve-template-vars";
import { collectSectionSchemas, type SchemaComponentContext } from "./schema-components";
import { combinedArticleContentFromSections } from "@shared/reading-time";
import { resolveRelationsOnEntry } from "./resolve-relations";
import {
  applyFaqHideOnLocations,
  normalizeFaqEntries,
  type FaqItemOverride,
} from "@shared/faq-listing";
import { child } from "./logger";
const log = child({ module: "ssr-schema" });

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Match a single `<meta …>` (possibly multiline) that carries attr="value".
 * Stops at the tag's own `>` so it does not swallow neighboring metas.
 */
function removeMetaTagsByAttr(html: string, attr: "name" | "property", value: string): string {
  const re = new RegExp(
    `<meta\\b(?:(?!\\/?>)[\\s\\S])*?\\b${attr}\\s*=\\s*["']${escapeRegExp(value)}["'](?:(?!\\/?>)[\\s\\S])*?\\/?>\\s*`,
    "gi",
  );
  return html.replace(re, "");
}

/**
 * Append SSR head fragments without duplicating tags already present in the
 * document shell (index.html defaults and/or injectSsrMetaTags updates).
 */
export function injectSsrSchemaHtml(html: string, ssrSchemaHtml: string): string {
  if (!ssrSchemaHtml || !html.includes("</head>")) return html;

  const names = new Set<string>();
  const properties = new Set<string>();
  for (const match of ssrSchemaHtml.matchAll(/\bname\s*=\s*["']([^"']+)["']/gi)) {
    names.add(match[1]);
  }
  for (const match of ssrSchemaHtml.matchAll(/\bproperty\s*=\s*["']([^"']+)["']/gi)) {
    properties.add(match[1]);
  }

  for (const name of names) {
    html = removeMetaTagsByAttr(html, "name", name);
  }
  for (const property of properties) {
    html = removeMetaTagsByAttr(html, "property", property);
  }

  if (/<title[\s>]/i.test(ssrSchemaHtml)) {
    html = html.replace(/<title\b[^>]*>[\s\S]*?<\/title>\s*/i, "");
  }
  if (/\brel\s*=\s*["']canonical["']/i.test(ssrSchemaHtml)) {
    html = html.replace(/<link\b(?:(?!\/>)[\s\S])*?\brel\s*=\s*["']canonical["'](?:(?!\/>)[\s\S])*?\/?>\s*/gi, "");
  }

  return html.replace("</head>", `${ssrSchemaHtml}\n</head>`);
}

/**
 * Static listing projections omit `content`. Blog templates bind
 * `{{ single.content }}` into the article section — without this body,
 * BlogPosting (and nested Person author) never emit.
 */
function ensureRecordArticleContent(
  contentType: string,
  record: Record<string, unknown>,
  locale: string,
  contentRoot: string,
): Record<string, unknown> {
  if (typeof record.content === "string" && record.content.trim()) return record;
  const slug = typeof record.slug === "string" ? record.slug : "";
  if (!slug) return record;
  try {
    const merged = mergeSingleTemplate(contentType, locale, slug, undefined, contentRoot);
    if (!merged) return record;
    const body = merged.content;
    if (typeof body === "string" && body.trim()) {
      return { ...record, content: body };
    }
    const fromArticles = combinedArticleContentFromSections(merged.sections);
    if (fromArticles) {
      return { ...record, content: fromArticles };
    }
  } catch {
    /* keep listing row as-is */
  }
  return record;
}



const DEFAULT_CONTENT_ROOT = getDefaultContentRoot();

const DEFAULT_IMAGE_DIMENSIONS = { width: 1200, height: 630 };
const imageRegistryByRoot = new Map<string, Record<string, { src?: string; width?: number; height?: number }>>();

function getImageRegistryImages(contentRoot: string): Record<string, { src?: string; width?: number; height?: number }> {
  if (imageRegistryByRoot.has(contentRoot)) return imageRegistryByRoot.get(contentRoot)!;
  try {
    const regPath = path.join(contentRoot, "image-registry.json");
    if (!fs.existsSync(regPath)) return {};
    const parsed = JSON.parse(fs.readFileSync(regPath, "utf-8")) as { images?: Record<string, { src?: string; width?: number; height?: number }> };
    const result = parsed.images || {};
    imageRegistryByRoot.set(contentRoot, result);
    return result;
  } catch {
    return {};
  }
}

function getImageDimensions(imageUrl: string, contentRoot: string): { width: number; height: number } {
  if (!imageUrl) return DEFAULT_IMAGE_DIMENSIONS;
  const images = getImageRegistryImages(contentRoot);
  const entry = Object.values(images).find((img) => img.src === imageUrl);
  if (entry?.width && entry?.height) return { width: entry.width, height: entry.height };
  return DEFAULT_IMAGE_DIMENSIONS;
}

function safeYamlLoad(yamlStr: string): unknown {
  const { escaped, map } = escapeTemplateVars(yamlStr);
  const parsed = yaml.load(escaped);
  return unescapeObjectVars(parsed, map);
}

interface FaqItem {
  question: string;
  answer: string;
}

interface FaqDynamicEntries {
  database?: string;
  content_type?: string;
  limit?: number;
  sort?: string;
  search?: string;
  permanent_filters?: Array<{ item_property_slug: string; value: unknown }>;
  ignored_entries?: string[];
  hardcoded_entries?: FaqItem[];
}

export interface FaqSection {
  type: "faq";
  title?: string;
  /** Runtime-resolved by resolveDynamicEntries. */
  items?: FaqItem[];
  dynamic_entries?: FaqDynamicEntries;
  hardcoded_entries?: FaqItem[];
  item_overrides?: Record<string, FaqItemOverride>;
}

export interface BreadcrumbSectionItem {
  label: string;
  url?: string;
}

export interface BreadcrumbSection {
  type: "breadcrumb";
  items: BreadcrumbSectionItem[];
}

interface ParsedRoute {
  contentType: string;
  slug: string;
  locale: string;
}

export function clearSsrSchemaCache(): void {
  imageRegistryByRoot.clear();
}

function parseRoute(url: string, ci: typeof contentIndex = contentIndex): ParsedRoute | null {
  const cleanUrl = url.split("?")[0].split("#")[0];

  const supportedLocales = getSupportedLocales();
  const defaultLocale = getDefaultLocale();
  const localeSegmentMatch = cleanUrl.match(/^\/([a-z]{2,3})\/?$/);
  const isHomepage =
    cleanUrl === "/" ||
    (localeSegmentMatch !== null && supportedLocales.includes(localeSegmentMatch[1]));
  if (isHomepage) {
    const homePage = getHomePage();
    if (!homePage?.type || !homePage?.slug) return null;
    const locale = localeSegmentMatch && supportedLocales.includes(localeSegmentMatch[1])
      ? localeSegmentMatch[1]
      : defaultLocale;
    return { contentType: homePage.type, slug: homePage.slug, locale };
  }

  const resolved = ci.resolveUrl(cleanUrl);
  if (resolved && !resolved.fromDatabase) {
    let locale = cleanUrl.match(/^\/(es)\b/) ? "es" : "en";
    if (resolved.params?.locale) {
      locale = resolved.params.locale;
    } else if (!cleanUrl.match(/^\/(en|es)\b/)) {
      const commonData = ci.loadCommonData(resolved.contentType, resolved.slug);
      if (commonData?.locale && typeof commonData.locale === "string") {
        locale = commonData.locale;
      }
    }
    return { contentType: resolved.contentType, slug: resolved.slug, locale };
  }

  return null;
}

export function loadRawYaml(contentType: string, slug: string, locale: string, ci: typeof contentIndex = contentIndex, contentRoot: string = DEFAULT_CONTENT_ROOT): Record<string, unknown> | null {
  const resolvedSlug = ci.resolveBaseSlug(slug, contentType);
  const folder = getFolder(contentType);
  const contentDir = path.join(contentRoot, folder, resolvedSlug);
  const commonPath = path.join(contentDir, "_common.yml");

  const contentPath = path.join(contentDir, `${locale}.yml`);

  if (!fs.existsSync(contentPath)) return null;

  try {
    let commonData: Record<string, unknown> = {};
    if (fs.existsSync(commonPath)) {
      commonData = safeYamlLoad(fs.readFileSync(commonPath, "utf-8")) as Record<string, unknown>;
    }

    const contentData = safeYamlLoad(fs.readFileSync(contentPath, "utf-8")) as Record<string, unknown>;
    return deepMerge(commonData, contentData);
  } catch {
    return null;
  }
}

export function buildFaqPageSchema(faqItems: Array<{ question: string; answer: string }>): Record<string, unknown> {
  return {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: faqItems.map((item) => ({
      "@type": "Question",
      name: item.question,
      acceptedAnswer: {
        "@type": "Answer",
        text: item.answer,
      },
    })),
  };
}

export function buildBreadcrumbListSchema(items: BreadcrumbSectionItem[], baseUrl: string): Record<string, unknown> {
  return {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: items.map((item, index) => {
      const element: Record<string, unknown> = {
        "@type": "ListItem",
        position: index + 1,
        name: item.label,
      };
      if (item.url) {
        element.item = item.url.startsWith("http") ? item.url : `${baseUrl}${item.url}`;
      }
      return element;
    }),
  };
}

/**
 * Prefer post-DE `items`, else authored hardcoded_entries.
 * Applies item_overrides.hideOnLocations for FAQPage parity with FaqDefault.
 * Callers must run resolveDynamicEntries before collect when sections use dynamic_entries.
 */
export function resolveFaqItems(
  section: FaqSection,
  _locale: string,
  locationSlug?: string,
  _programSlug?: string,
  _contentRoot: string = DEFAULT_CONTENT_ROOT,
): Array<{ question: string; answer: string }> {
  const fromItems = normalizeFaqEntries(section.items);
  const fromHardcoded = normalizeFaqEntries(
    section.hardcoded_entries ?? section.dynamic_entries?.hardcoded_entries,
  );
  let items = fromItems.length > 0 ? fromItems : fromHardcoded;
  items = applyFaqHideOnLocations(items, section.item_overrides, locationSlug);
  return items;
}

/** Dedupe FAQ items by normalized question text, preserving first occurrence. */
export function dedupeFaqItems(
  items: Array<{ question: string; answer: string }>,
): Array<{ question: string; answer: string }> {
  const seen = new Set<string>();
  const result: Array<{ question: string; answer: string }> = [];
  for (const item of items) {
    const key = item.question.trim().toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(item);
  }
  return result;
}

export async function generateDatabaseSsrHtml(
  contentType: string,
  record: Record<string, unknown>,
  locale: string,
  ci: typeof contentIndex = contentIndex,
  contentRoot: string = DEFAULT_CONTENT_ROOT,
): Promise<string> {
  const baseUrl = getBaseUrl();
  const config = getContentTypeConfig(contentType, contentRoot);
  if (!config?.url_pattern) return "";

  record = ensureRecordArticleContent(contentType, { ...record }, locale, contentRoot);

  const hydrated = await resolveRelationsOnEntry(contentType, record, {
    contentRoot,
    locale,
    contentIndex: ci,
    baseUrl,
  });
  record = hydrated;

  const urlPattern = config.url_pattern[locale] || config.url_pattern["en"];
  if (!urlPattern) return "";

  // Normalize any object-type fields used in URL patterns (e.g. blog `category` is {slug:...})
  const recordForUrl: Record<string, unknown> = { ...record };
  for (const key of Object.keys(recordForUrl)) {
    const val = recordForUrl[key];
    if (val !== null && typeof val === "object" && !Array.isArray(val)) {
      const obj = val as Record<string, unknown>;
      if (typeof obj.slug === "string") {
        recordForUrl[key] = obj.slug;
      } else if (typeof obj.name === "string") {
        recordForUrl[key] = obj.name;
      }
    }
  }
  const recordUrl = `${baseUrl}${resolveUrlPatternWithMapping(urlPattern, recordForUrl, locale, null)}`;
  const scripts: string[] = [];

  const image = (record.preview as string) || (record.image as string) || "";
  const publishedAt = (record.published_at as string) || "";
  const updatedAt =
    resolveEntryUpdatedAt({
      contentType,
      slug: typeof record.slug === "string" ? record.slug : undefined,
      locale,
      record,
      contentRoot,
    }) || undefined;

  let authorName = "4Geeks Academy";
  if (record.author && typeof record.author === "object") {
    const author = record.author as Record<string, unknown>;
    authorName = `${author.first_name || ""} ${author.last_name || ""}`.trim() || "4Geeks Academy";
  } else if (typeof record.author === "string") {
    authorName = record.author || "4Geeks Academy";
  }

  let authorsForLd: Array<Record<string, unknown> | string> | undefined;
  if (Array.isArray(record.authors) && record.authors.length > 0) {
    authorsForLd = record.authors as Array<Record<string, unknown> | string>;
  }

  // Section-driven schema contributions only (no hardcoded BlogPosting / synthetic breadcrumb).
  try {
    const template = mergeSingleTemplate(contentType, locale, (record.slug as string) || undefined, undefined, contentRoot);
    const templateSections = template?.sections;
    if (Array.isArray(templateSections)) {
      const resolvedSections = resolveAllTemplateVars(templateSections, {
        singleEntry: record,
        meta: (template?.meta as Record<string, unknown> | undefined),
        contentRoot,
        context: { locale },
        skipSiteVars: false,
      }) as Array<Record<string, unknown>>;
      const withDynamic = (await resolveDynamicEntries(resolvedSections, locale, {
        contentRoot,
        contentIndex: ci,
        singleEntry: record,
      })) as Array<Record<string, unknown>>;
      const context: SchemaComponentContext = {
        locale,
        contentRoot,
        baseUrl,
        contentType,
        pageUrl: recordUrl,
        title: (record.title as string) || undefined,
        description: ((record.description as string) || (record.preview as string) || undefined),
        image: image || undefined,
        publishedAt: publishedAt || undefined,
        updatedAt: updatedAt || undefined,
        authorName,
        authors: authorsForLd,
        singleEntry: record,
      };
      for (const sectionSchema of collectSectionSchemas(withDynamic, context)) {
        scripts.push(
          `<script type="application/ld+json" data-ssr="true">${JSON.stringify(sectionSchema)}</script>`
        );
      }
    }
  } catch (err) {
    log.error({ err }, `[SSR-Schema] Error collecting section schemas for ${contentType}`);
  }

  // Title / description / robots / og|twitter title+description are owned by
  // injectSsrMetaTags (shared single_template meta). Re-emitting them here
  // duplicated every database/blog <head> when this fragment is appended.
  const ogType = contentType === "blog" ? "article" : "website";
  const twitterHandle = getOrganizationTwitterHandle(contentRoot);
  const imageDimensions = image ? getImageDimensions(image, contentRoot) : null;
  const metaTags = [
    `<meta property="og:type" content="${ogType}" />`,
    `<meta property="og:url" content="${recordUrl}" />`,
    image ? `<meta property="og:image" content="${image}" />` : "",
    imageDimensions ? `<meta property="og:image:width" content="${imageDimensions.width}" />` : "",
    imageDimensions ? `<meta property="og:image:height" content="${imageDimensions.height}" />` : "",
    `<meta name="twitter:card" content="${image ? "summary_large_image" : "summary"}" />`,
    twitterHandle ? `<meta name="twitter:site" content="${twitterHandle}" />` : "",
    twitterHandle ? `<meta name="twitter:creator" content="${twitterHandle}" />` : "",
    image ? `<meta name="twitter:image" content="${image}" />` : "",
    publishedAt ? `<meta property="article:published_time" content="${publishedAt}" />` : "",
    updatedAt ? `<meta property="article:modified_time" content="${updatedAt}" />` : "",
    `<meta property="article:author" content="${authorName}" />`,
    `<link rel="canonical" href="${recordUrl}" />`,
  ].filter(Boolean);

  const hreflangTags = generateHreflangTags(contentType, (record.slug as string) || "", locale, record, undefined, ci);
  return [...hreflangTags, ...metaTags, ...scripts].join("\n");
}

export function generateListingSsrHtml(contentType: string, locale: string, contentRoot: string = DEFAULT_CONTENT_ROOT): string {
  const baseUrl = getBaseUrl();
  const config = getContentTypeConfig(contentType);
  if (!config?.url_pattern) return "";

  const pattern = config.url_pattern[locale] || config.url_pattern["en"];
  if (!pattern) return "";

  const listingUrl = `${baseUrl}${pattern.replace(/\/:[a-zA-Z_]+/g, "").replace(/\/+$/, "") || "/"}`;
  const label = contentType.charAt(0).toUpperCase() + contentType.slice(1);
  const title = `${label} | 4Geeks Academy`;
  const description = locale === "es"
    ? `Explora nuestro contenido de ${label.toLowerCase()} en 4Geeks Academy.`
    : `Explore our ${label.toLowerCase()} content at 4Geeks Academy.`;

  const twitterHandle = getOrganizationTwitterHandle(contentRoot);
  const defaultSocialImage = getWebsiteDefaultSocialImage(contentRoot);
  const defaultImageDimensions = defaultSocialImage ? getImageDimensions(defaultSocialImage, contentRoot) : null;
  const metaTags = [
    `<title>${title}</title>`,
    `<meta name="robots" content="${resolveEffectiveRobots(undefined, contentRoot)}" />`,
    `<meta name="description" content="${description}" />`,
    `<meta property="og:type" content="website" />`,
    `<meta property="og:title" content="${title}" />`,
    `<meta property="og:description" content="${description}" />`,
    `<meta property="og:url" content="${listingUrl}" />`,
    defaultSocialImage ? `<meta property="og:image" content="${defaultSocialImage}" />` : "",
    defaultImageDimensions ? `<meta property="og:image:width" content="${defaultImageDimensions.width}" />` : "",
    defaultImageDimensions ? `<meta property="og:image:height" content="${defaultImageDimensions.height}" />` : "",
    `<meta name="twitter:card" content="${defaultSocialImage ? "summary_large_image" : "summary"}" />`,
    twitterHandle ? `<meta name="twitter:site" content="${twitterHandle}" />` : "",
    twitterHandle ? `<meta name="twitter:creator" content="${twitterHandle}" />` : "",
    `<meta name="twitter:title" content="${title}" />`,
    `<meta name="twitter:description" content="${description}" />`,
    defaultSocialImage ? `<meta name="twitter:image" content="${defaultSocialImage}" />` : "",
    `<link rel="canonical" href="${listingUrl}" />`,
  ].filter(Boolean);

  const hreflangTags = generateListingHreflangTags(contentType, locale);
  return [...hreflangTags, ...metaTags].join("\n");
}

export function resolvePageRobots(url: string, ci: typeof contentIndex = contentIndex, contentRoot: string = DEFAULT_CONTENT_ROOT): string {
  try {
    if (isIndexingBlocked(contentRoot)) return "noindex, nofollow";
    const route = parseRoute(url, ci);
    if (!route) return "index, follow";
    const pageData = loadRawYaml(route.contentType, route.slug, route.locale, ci, contentRoot);
    if (!pageData) return "index, follow";
    const meta = pageData.meta as Record<string, unknown> | undefined;
    return resolveEffectiveRobots(
      typeof meta?.robots === "string" ? meta.robots : undefined,
      contentRoot,
    );
  } catch {
    return resolveEffectiveRobots(undefined, contentRoot);
  }
}

export async function generateSsrSchemaHtml(url: string, ci: typeof contentIndex = contentIndex, contentRoot: string = DEFAULT_CONTENT_ROOT): Promise<string> {
  try {
    const route = parseRoute(url, ci);
    if (!route) return "";

    // Use fully merged content (shared single_template + per-entry layers) so
    // schema contributors see the same sections the page actually renders.
    const merged = ci.loadMergedContent(route.contentType, route.slug, route.locale);
    let pageData = merged.data ?? loadRawYaml(route.contentType, route.slug, route.locale, ci, contentRoot);
    if (!pageData) return "";
    if (merged.data && merged.isSharedTemplate) {
      // Shared-template pages may reference {{ single.* }} vars; the merged
      // entry data itself is the "single" record for static entries.
      pageData = resolveAllTemplateVars(pageData, {
        singleEntry: pageData,
        contentRoot,
        context: { locale: route.locale },
        skipSiteVars: false,
      }) as Record<string, unknown>;
    }

    const scripts: string[] = [];
    const yamlUpdatedAt = resolveEntryUpdatedAt({
      contentType: route.contentType,
      slug: route.slug,
      locale: route.locale,
      record: pageData,
      contentRoot,
    });

    // Production emitters: SSR section pipeline only (no schema.include).
    const sections = pageData.sections as Array<Record<string, unknown>> | undefined;
    if (Array.isArray(sections)) {
      const singleEntry: Record<string, unknown> = {
        ...pageData,
        slug: route.slug,
        _slug: route.slug,
      };
      const withDynamic = (await resolveDynamicEntries(sections, route.locale, {
        contentRoot,
        contentIndex: ci,
        singleEntry,
      })) as Array<Record<string, unknown>>;
      const metaForSchema = pageData.meta as Record<string, unknown> | undefined;
      const context: SchemaComponentContext = {
        locale: route.locale,
        contentRoot,
        baseUrl: getBaseUrl(),
        locationSlug: route.contentType === "location" ? route.slug : undefined,
        programSlug: route.contentType === "program" ? route.slug : undefined,
        contentType: route.contentType,
        pageUrl: `${getBaseUrl()}${url.split("?")[0]}`,
        title:
          (typeof metaForSchema?.page_title === "string" ? metaForSchema.page_title : undefined) ||
          (typeof pageData.title === "string" ? pageData.title : undefined),
        description:
          typeof metaForSchema?.description === "string" ? metaForSchema.description : undefined,
        image: typeof metaForSchema?.og_image === "string" ? metaForSchema.og_image : undefined,
        updatedAt: yamlUpdatedAt || undefined,
      };
      for (const sectionSchema of collectSectionSchemas(withDynamic, context)) {
        scripts.push(
          `<script type="application/ld+json" data-ssr="true">${JSON.stringify(sectionSchema)}</script>`
        );
      }
    }

    const meta = pageData.meta as Record<string, unknown> | undefined;
    const robots = resolveEffectiveRobots(
      typeof meta?.robots === "string" ? meta.robots : undefined,
      contentRoot,
    );
    const robotsTag = `<meta name="robots" content="${robots}" />`;

    const ogImage = typeof meta?.og_image === "string" ? meta.og_image : null;
    const twitterHandle = getOrganizationTwitterHandle(contentRoot);
    const socialImageUrl = ogImage || getWebsiteDefaultSocialImage(contentRoot);
    const socialImageDimensions = socialImageUrl ? getImageDimensions(socialImageUrl, contentRoot) : null;
    const socialTags = [
      twitterHandle ? `<meta name="twitter:site" content="${twitterHandle}" />` : "",
      twitterHandle ? `<meta name="twitter:creator" content="${twitterHandle}" />` : "",
      socialImageUrl && !ogImage ? `<meta property="og:image" content="${socialImageUrl}" />` : "",
      socialImageDimensions ? `<meta property="og:image:width" content="${socialImageDimensions.width}" />` : "",
      socialImageDimensions ? `<meta property="og:image:height" content="${socialImageDimensions.height}" />` : "",
      yamlUpdatedAt ? `<meta property="article:modified_time" content="${yamlUpdatedAt}" />` : "",
    ].filter(Boolean);

    const homePage = getHomePage();
    const isHomepageRoute = homePage?.type === route.contentType && homePage?.slug === route.slug;
    const hreflangTags = isHomepageRoute
      ? generateHomepageHreflangTags()
      : generateHreflangTags(route.contentType, route.slug, route.locale, undefined, undefined, ci);
    return [...hreflangTags, robotsTag, ...socialTags, ...scripts].join("\n");
  } catch (err) {
    log.error({ err }, `[SSR-Schema] Error generating schema for ${url}`);
    return "";
  }
}
