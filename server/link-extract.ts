/**
 * Shared internal-link extraction from YAML/DB field trees.
 */

import { createPublicUrlResolver, type PublicUrlResolver } from "./redirects";
import { listTypePages } from "./entry-layer";
import { contentIndex } from "./content-index";
import { seoEntryId } from "./seo-index";
import { getAllConfigs, getFullFieldMapping } from "./content-types";
import { databaseManager } from "./database";
import { mappingSourceString, type FieldMappingValue } from "@shared/validateEditorFieldTypes";
import { extractExternalLinkHits, extractInternalLinkHits, type InternalLinkHit } from "./internal-link-hits";

export {
  extractExternalLinkHits,
  extractInternalLinkHits,
  type ExternalLinkHit,
  type InternalLinkHit,
} from "./internal-link-hits";

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

export function findInternalLinks(obj: unknown, hits: InternalLinkHit[]): void {
  hits.push(...extractInternalLinkHits(obj));
}

export function collectOutboundPathsFromData(
  data: Record<string, unknown>,
  _locale: string,
  _resolver?: PublicUrlResolver,
): string[] {
  const out = new Set<string>();
  for (const hit of extractInternalLinkHits(data)) {
    out.add(hit.path.replace(/\/$/, "") || "/");
  }
  return [...out].sort();
}

/** Sorted unique external URLs (links and images) for the link index. */
export function collectExternalUrlsFromData(
  data: Record<string, unknown>,
  ownHosts: string[],
): string[] {
  return [...new Set(extractExternalLinkHits(data, { ownHosts }).map((h) => h.url))].sort();
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

  for (const contentType of Object.keys(configs)) {
    const listed = listTypePages(contentIndex, contentType);
    for (const { slug, locale: loc, item } of listed?.pages ?? []) {
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
