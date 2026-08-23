/**
 * Unified JSON-LD collection for static and database-backed pages.
 * Used by SSR head injection and schema-completeness validation.
 */

import { getDefaultContentRoot } from "./site-config";
import type { ContentIndex } from "./content-index";
import { resolveDynamicEntries } from "./dynamic-entries";
import { mergeSingleTemplate } from "./database-single-loader";
import { resolveAllTemplateVars } from "./resolve-template-vars";
import {
  collectSectionSchemasDetailed,
  type CollectSectionSchemasResult,
  type SchemaComponentContext,
} from "./schema-components";
import { combinedArticleContentFromSections } from "@shared/reading-time";
import { resolveRelationsOnEntry } from "./resolve-relations";
import {
  getContentTypeConfig,
  getLocaleKey,
  resolveEntryUpdatedAt,
  resolveUrlPatternWithMapping,
} from "./content-types";
import { getBaseUrl } from "./hreflang";
import { getDefaultLocale } from "./settings";
import { queryEntries } from "./query-entries";
import { loadRawYaml, parseRoute } from "./ssr-route";
import { child } from "./logger";

const log = child({ module: "page-schema-collect" });

export type PageSchemaCollectResult = CollectSectionSchemasResult & {
  renderError?: string;
};

function emptyResult(): PageSchemaCollectResult {
  return { documents: [], preview: [] };
}

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

function normalizeRecordForUrl(record: Record<string, unknown>): Record<string, unknown> {
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
  return recordForUrl;
}

function resolveAuthorName(record: Record<string, unknown>): string {
  let authorName = "4Geeks Academy";
  if (record.author && typeof record.author === "object") {
    const author = record.author as Record<string, unknown>;
    authorName = `${author.first_name || ""} ${author.last_name || ""}`.trim() || "4Geeks Academy";
  } else if (typeof record.author === "string") {
    authorName = record.author || "4Geeks Academy";
  }
  return authorName;
}

export async function collectDatabaseRecordSchemas(
  contentType: string,
  record: Record<string, unknown>,
  locale: string,
  ci: ContentIndex,
  contentRoot: string,
): Promise<PageSchemaCollectResult> {
  const baseUrl = getBaseUrl();
  const config = getContentTypeConfig(contentType, contentRoot);
  if (!config?.url_pattern) return emptyResult();

  record = ensureRecordArticleContent(contentType, { ...record }, locale, contentRoot);

  const hydrated = await resolveRelationsOnEntry(contentType, record, {
    contentRoot,
    locale,
    contentIndex: ci,
    baseUrl,
  });
  record = hydrated;

  const urlPattern = config.url_pattern[locale] || config.url_pattern["en"];
  if (!urlPattern) return emptyResult();

  const recordForUrl = normalizeRecordForUrl(record);
  const recordUrl = `${baseUrl}${resolveUrlPatternWithMapping(urlPattern, recordForUrl, locale, null)}`;

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

  const authorName = resolveAuthorName(record);

  let authorsForLd: Array<Record<string, unknown> | string> | undefined;
  if (Array.isArray(record.authors) && record.authors.length > 0) {
    authorsForLd = record.authors as Array<Record<string, unknown> | string>;
  }

  try {
    const template = mergeSingleTemplate(
      contentType,
      locale,
      (record.slug as string) || undefined,
      undefined,
      contentRoot,
    );
    const templateSections = template?.sections;
    if (!Array.isArray(templateSections)) return emptyResult();

    const resolvedSections = resolveAllTemplateVars(templateSections, {
      singleEntry: record,
      meta: template?.meta as Record<string, unknown> | undefined,
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
      updatedAt,
      authorName,
      authors: authorsForLd,
      singleEntry: record,
    };

    return collectSectionSchemasDetailed(withDynamic, context);
  } catch (err) {
    log.error({ err }, `[page-schema-collect] database collect failed for ${contentType}`);
    return {
      ...emptyResult(),
      renderError: err instanceof Error ? err.message : String(err),
    };
  }
}

export async function collectStaticPageSchemas(
  route: { contentType: string; slug: string; locale: string },
  url: string,
  ci: ContentIndex,
  contentRoot: string,
): Promise<PageSchemaCollectResult> {
  try {
    const merged = ci.loadMergedContent(route.contentType, route.slug, route.locale);
    let pageData = merged.data ?? loadRawYaml(route.contentType, route.slug, route.locale, ci, contentRoot);
    if (!pageData) return emptyResult();

    if (merged.data && merged.isSharedTemplate) {
      pageData = resolveAllTemplateVars(pageData, {
        singleEntry: pageData,
        contentRoot,
        context: { locale: route.locale },
        skipSiteVars: false,
      }) as Record<string, unknown>;
    }

    const sections = pageData.sections as Array<Record<string, unknown>> | undefined;
    if (!Array.isArray(sections)) return emptyResult();

    const yamlUpdatedAt = resolveEntryUpdatedAt({
      contentType: route.contentType,
      slug: route.slug,
      locale: route.locale,
      record: pageData,
      contentRoot,
    });

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
    const publishedAtRaw =
      (typeof pageData.published_at === "string" ? pageData.published_at : undefined) ||
      (typeof metaForSchema?.published_at === "string" ? metaForSchema.published_at : undefined);

    let authorsForLd: Array<Record<string, unknown> | string> | undefined;
    if (Array.isArray(pageData.authors) && pageData.authors.length > 0) {
      authorsForLd = pageData.authors as Array<Record<string, unknown> | string>;
    }

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
      publishedAt: publishedAtRaw || undefined,
      updatedAt: yamlUpdatedAt || undefined,
      authorName: resolveAuthorName(pageData),
      authors: authorsForLd,
      singleEntry: pageData,
    };

    return collectSectionSchemasDetailed(withDynamic, context);
  } catch (err) {
    log.error({ err }, `[page-schema-collect] static collect failed for ${url}`);
    return {
      ...emptyResult(),
      renderError: err instanceof Error ? err.message : String(err),
    };
  }
}

async function fetchDatabaseEntry(
  contentType: string,
  slug: string,
  locale: string,
  ci: ContentIndex,
  contentRoot: string,
): Promise<Record<string, unknown> | null> {
  const { items } = await queryEntries(
    {
      from: { contentType },
      locale,
      filters: [{ field: "slug", value: slug }],
      limit: 5,
    },
    {
      db: ci.getDatabase(),
      contentIndex: ci,
      contentRoot,
    },
  );

  const localeKey = getLocaleKey(contentType, contentRoot) || "lang";
  return (
    items.find((p) => p.slug === slug && (p as Record<string, unknown>)[localeKey] === locale) ||
    items.find((p) => p.slug === slug) ||
    null
  );
}

export async function resolvePageSchemaDocuments(
  url: string,
  ci: ContentIndex,
  contentRoot?: string,
): Promise<PageSchemaCollectResult> {
  const root = contentRoot ?? getDefaultContentRoot();
  const cleanUrl = url.split("?")[0].split("#")[0];

  try {
    const resolved = ci.resolveUrl(cleanUrl);
    const isDatabaseRoute = !!(resolved && resolved.fromDatabase);

    if (isDatabaseRoute && resolved) {
      const locale =
        resolved.patternLocale && resolved.patternLocale !== "default"
          ? resolved.patternLocale
          : getDefaultLocale();
      const post = await fetchDatabaseEntry(resolved.contentType, resolved.slug, locale, ci, root);
      if (!post) return emptyResult();
      return collectDatabaseRecordSchemas(resolved.contentType, post, locale, ci, root);
    }

    const blogUrlMatch = !isDatabaseRoute
      ? cleanUrl.match(/^\/(en|es)\/blog\/[^/]+\/([^/?#]+)$/)
      : null;

    if (blogUrlMatch) {
      const locale = blogUrlMatch[1];
      const slug = blogUrlMatch[2];
      const post = await fetchDatabaseEntry("blog", slug, locale, ci, root);
      if (!post) return emptyResult();
      return collectDatabaseRecordSchemas("blog", post, locale, ci, root);
    }

    const route = parseRoute(cleanUrl, ci);
    if (!route) return emptyResult();

    return collectStaticPageSchemas(route, cleanUrl, ci, root);
  } catch (err) {
    return {
      ...emptyResult(),
      renderError: err instanceof Error ? err.message : String(err),
    };
  }
}
