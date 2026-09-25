/**
 * Content Loader
 *
 * Builds the list of resolved ContentFile entries for validation by delegating
 * entirely to ContentIndex, which is the single source of truth for content
 * merging (_common.template.yml → _common.yml → locale.yml; legacy _common.single.yml still loads).
 *
 * Also loads published A/B variants (allocation > 0) as separate ContentFiles
 * with `variant` set so entry-local validators score them independently.
 */

import * as fs from "fs";
import * as path from "path";
import * as yaml from "js-yaml";
import { contentIndex as defaultContentIndex } from "../../../server/content-index";
import type { ContentIndex } from "../../../server/content-index";
import {
  extractUrlPatternParams,
  getFullFieldMapping,
} from "../../../server/content-types";
import {
  findSourceDraftVariant,
  getEntryContentDir,
  isDraftEntry,
  listDraftLocales,
} from "../../../server/draft-entry";
import { isTemplateVersioningSlug } from "../../../server/shared-layout-entry";
import { listEntryKeys, loadEntry, type EntryKeyList } from "../../../server/entry-layer";
import type { ContentFile } from "./types";

type VersioningFile = Record<
  string,
  { variants?: Array<{ slug: string; allocation: number }> }
>;

function toContentFile(
  index: ContentIndex,
  contentType: string,
  slug: string,
  locale: string,
  data: Record<string, unknown>,
  filePath: string,
  extra?: Partial<ContentFile>,
): ContentFile {
  const config = index.getContentTypeConfig(contentType);
  const pattern =
    config?.url_pattern?.[locale] ||
    config?.url_pattern?.["default"] ||
    config?.url_pattern?.["en"];
  const localeSlug =
    typeof data.slug === "string" && data.slug ? data.slug : slug;
  let url: string | undefined;
  if (pattern) {
    const mapping = getFullFieldMapping(contentType, index.contentRoot);
    const { params } = extractUrlPatternParams(pattern, data, mapping);
    url = index.buildUrl(contentType, locale, localeSlug, params);
  }

  return {
    slug,
    title: ((data.title || data.name || slug) as string) || slug,
    description: typeof data.description === "string" ? data.description : undefined,
    meta: data.meta as ContentFile["meta"],
    schema: data.schema as ContentFile["schema"],
    seo: data.seo as ContentFile["seo"],
    type: contentType,
    locale,
    filePath,
    url,
    entryFields: data,
    ...extra,
  };
}

/** Strip redirects from published-variant rows (redirects are live-only). */
function withoutRedirects(data: Record<string, unknown>): Record<string, unknown> {
  const meta = data.meta;
  if (!meta || typeof meta !== "object" || Array.isArray(meta)) return data;
  const { redirects: _r, ...restMeta } = meta as Record<string, unknown>;
  return { ...data, meta: restMeta };
}

function readVersioningFile(contentDir: string): VersioningFile | null {
  const p = path.join(contentDir, "versioning.yml");
  if (!fs.existsSync(p)) return null;
  try {
    const raw = fs.readFileSync(p, "utf-8");
    const parsed = yaml.load(raw) as VersioningFile | null;
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch {
    return null;
  }
}

function loadLiveContent(index: ContentIndex, list: EntryKeyList): ContentFile[] {
  const files: ContentFile[] = [];

  for (const key of list.keys) {
    for (const locale of key.locales) {
      const result = loadEntry(index, key.contentType, key.slug, locale, list.itemsByType);
      if (!result) continue;

      files.push(
        toContentFile(
          index,
          key.contentType,
          key.slug,
          locale,
          result.data,
          result.filePath,
          result.singleEntry
            ? { singleEntry: result.singleEntry, translationGroup: result.translationGroup }
            : undefined,
        ),
      );
    }
  }

  return files;
}

/** Published A/B variants (allocation > 0) as separate validation pages. */
function loadPublishedVariants(index: ContentIndex): ContentFile[] {
  const files: ContentFile[] = [];
  const entries = index.listAll();

  for (const entry of entries) {
    const templateMode = isTemplateVersioningSlug(entry.slug);
    const dir = getEntryContentDir(entry.contentType, entry.slug, index.contentRoot);
    const versioning = readVersioningFile(dir);
    if (!versioning) continue;

    for (const [locale, localeData] of Object.entries(versioning)) {
      if (!localeData?.variants?.length) continue;
      for (const v of localeData.variants) {
        if (!v.slug || !(v.allocation > 0)) continue;
        const result = index.loadMergedContent(
          entry.contentType,
          entry.slug,
          locale,
          v.slug,
        );
        if (!result.data) continue;
        const data = withoutRedirects(result.data as Record<string, unknown>);
        files.push(
          toContentFile(
            index,
            entry.contentType,
            entry.slug,
            locale,
            data,
            result.filePath,
            { variant: v.slug },
          ),
        );
        void templateMode;
      }
    }
  }

  return files;
}

function loadDraftOnlyContent(index: ContentIndex): ContentFile[] {
  const files: ContentFile[] = [];
  const indexed = new Set(
    index.listAll().map((e) => `${e.contentType}:${e.slug}`),
  );

  for (const contentType of index.getContentTypes()) {
    const config = index.getContentTypeConfig(contentType);
    if (config?.database?.slug) continue;

    for (const slug of index.listContentSlugs(contentType)) {
      if (indexed.has(`${contentType}:${slug}`)) continue;
      if (!isDraftEntry(contentType, slug, index.contentRoot)) continue;

      const templateMode = isTemplateVersioningSlug(slug);
      const dir = getEntryContentDir(contentType, slug, index.contentRoot);
      const locales = listDraftLocales(dir, templateMode);
      for (const locale of locales) {
        const variant = findSourceDraftVariant(dir, locale, undefined, templateMode);
        if (!variant) continue;
        const result = index.loadMergedContent(contentType, slug, locale, variant);
        if (!result.data) continue;
        files.push(
          toContentFile(
            index,
            contentType,
            slug,
            locale,
            result.data as Record<string, unknown>,
            result.filePath,
            { variant, isDraft: true },
          ),
        );
      }
    }
  }

  return files;
}

export type LoadedContent = {
  files: ContentFile[];
  /** Databases with no cached items; their pages are not in `files`. */
  skippedDatabases: string[];
  /** Content types whose pages were not loaded (their database cache is empty). */
  skippedContentTypes: string[];
};

export function loadContent(ci?: typeof defaultContentIndex): LoadedContent {
  const index = ci ?? defaultContentIndex;
  const list = listEntryKeys(index);
  return {
    files: [
      ...loadLiveContent(index, list),
      ...loadPublishedVariants(index),
      ...loadDraftOnlyContent(index),
    ],
    skippedDatabases: list.emptyDatabases,
    skippedContentTypes: list.skippedContentTypes,
  };
}

export function loadAllContent(ci?: typeof defaultContentIndex): ContentFile[] {
  return loadContent(ci).files;
}
