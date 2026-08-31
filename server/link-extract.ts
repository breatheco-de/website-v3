/**
 * Shared internal-link extraction from YAML/DB field trees.
 */

import { createPublicUrlResolver, type PublicUrlResolver } from "./redirects";
import { contentIndex } from "./content-index";
import { seoEntryId } from "./seo-index";
import { getAllConfigs, getFullFieldMapping } from "./content-types";
import { databaseManager } from "./database";
import { mappingSourceString, type FieldMappingValue } from "@shared/validateEditorFieldTypes";

export interface InternalLinkHit {
  link: string;
  fieldPath: string;
  component?: string;
}

const INTERNAL_URL_PATTERN = /(?:^|\s)(\/(?:en|es)\/[^\s"'<>]*)/g;

/** Fields likely to contain hrefs in DB-backed rows. */
const DB_LINK_FIELD_HINTS = new Set([
  "body",
  "content",
  "description",
  "excerpt",
  "html",
  "markdown",
  "text",
]);

export function findInternalLinks(
  obj: unknown,
  hits: InternalLinkHit[],
  currentPath = "",
  sectionType?: string,
): void {
  if (!obj || typeof obj !== "object") {
    if (typeof obj === "string") {
      let match: RegExpExecArray | null;
      const re = new RegExp(INTERNAL_URL_PATTERN.source, "g");
      while ((match = re.exec(obj)) !== null) {
        hits.push({
          link: match[1]!,
          fieldPath: currentPath || "(root)",
          component: sectionType,
        });
      }
    }
    return;
  }

  if (Array.isArray(obj)) {
    const underSections =
      currentPath === "sections" || currentPath.endsWith(".sections");
    obj.forEach((item, index) => {
      const itemPath = `${currentPath}[${index}]`;
      let nextSectionType = sectionType;
      if (
        underSections &&
        item &&
        typeof item === "object" &&
        !Array.isArray(item)
      ) {
        const t = (item as Record<string, unknown>).type;
        if (typeof t === "string" && t.length > 0) nextSectionType = t;
      }
      findInternalLinks(item, hits, itemPath, nextSectionType);
    });
    return;
  }

  const record = obj as Record<string, unknown>;
  for (const [key, value] of Object.entries(record)) {
    const fieldPath = currentPath ? `${currentPath}.${key}` : key;
    findInternalLinks(value, hits, fieldPath, sectionType);
  }
}

function normalizeOutboundPath(link: string, resolver: PublicUrlResolver, locale: string): string | null {
  const trimmed = link.trim();
  if (!trimmed.startsWith("/")) return null;
  const norm = trimmed.replace(/\/$/, "") || "/";
  if (!resolver.isLive(norm, locale)) return norm;
  return norm;
}

export function collectOutboundPathsFromData(
  data: Record<string, unknown>,
  locale: string,
  resolver?: PublicUrlResolver,
): string[] {
  const publicUrls = resolver ?? createPublicUrlResolver(contentIndex);
  const hits: InternalLinkHit[] = [];
  findInternalLinks(data, hits);
  const out = new Set<string>();
  for (const hit of hits) {
    const norm = normalizeOutboundPath(hit.link, publicUrls, locale);
    if (norm) out.add(norm);
  }
  return [...out].sort();
}

function dbLinkFieldPaths(fieldMapping: Record<string, FieldMappingValue> | undefined): string[] {
  if (!fieldMapping) return [...DB_LINK_FIELD_HINTS];
  const paths: string[] = [];
  for (const [dest, src] of Object.entries(fieldMapping)) {
    if (dest.startsWith("_")) continue;
    const srcStr = mappingSourceString(src).toLowerCase();
    const destLower = dest.toLowerCase();
    if (
      DB_LINK_FIELD_HINTS.has(destLower) ||
      DB_LINK_FIELD_HINTS.has(srcStr.split(".").pop() || "") ||
      destLower.includes("body") ||
      destLower.includes("content")
    ) {
      paths.push(dest);
    }
  }
  return paths.length > 0 ? paths : [...DB_LINK_FIELD_HINTS];
}

function extractDbRowLinkFields(row: Record<string, unknown>, fieldPaths: string[]): Record<string, unknown> {
  const slice: Record<string, unknown> = {};
  for (const fp of fieldPaths) {
    const val = row[fp];
    if (typeof val === "string" && val.trim()) slice[fp] = val;
  }
  return slice;
}

export function collectOutboundPathsFromDbItem(
  contentType: string,
  item: Record<string, unknown>,
  locale: string,
  contentRoot?: string,
  resolver?: PublicUrlResolver,
): string[] {
  const configs = getAllConfigs(contentRoot);
  const config = configs[contentType];
  const mapping = getFullFieldMapping(contentType, contentRoot);
  const fieldPaths = dbLinkFieldPaths(mapping as Record<string, FieldMappingValue> | undefined);
  const slice = extractDbRowLinkFields(item, fieldPaths);
  if (Object.keys(slice).length === 0) return [];
  return collectOutboundPathsFromData(slice, locale, resolver);
}

export function collectDbBackedOutboundByEntry(
  contentRoot?: string,
  resolver?: PublicUrlResolver,
): Record<string, string[]> {
  const publicUrls = resolver ?? createPublicUrlResolver(contentIndex);
  const configs = getAllConfigs(contentRoot);
  const out: Record<string, string[]> = {};
  const dbm = contentRoot ? databaseManager : databaseManager;

  for (const [contentType, config] of Object.entries(configs)) {
    if (!config?.database?.slug) continue;
    const items = (dbm.getMappedItems(config.database.slug) || []) as Record<string, unknown>[];
    for (const item of items) {
      const slug = String(item.slug || "").trim();
      if (!slug) continue;
      const itemLocale = String(item.language || item.lang || item.locale || "en");
      const loc = itemLocale === "_common" ? "en" : itemLocale;
      const paths = collectOutboundPathsFromDbItem(
        contentType,
        item,
        loc,
        contentRoot,
        publicUrls,
      );
      if (paths.length === 0) continue;
      const id = seoEntryId(contentType, slug, loc);
      out[id] = paths;
    }
  }
  return out;
}

export function entryIdFromContentFile(
  contentType: string,
  slug: string,
  locale: string,
): string {
  return seoEntryId(contentType, slug, locale === "_common" ? "en" : locale);
}
