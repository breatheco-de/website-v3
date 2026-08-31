/**
 * Extract outbound relation pointers from entry data + editor hints.
 */

import {
  extractByDotPath,
  mergeEditorHints,
  type EditorHint,
  type FieldMappingValue,
  mappingSourceString,
  isSkippedMappingSource,
  skipFieldWithoutEditor,
} from "@shared/validateEditorFieldTypes";
import { normalizeRelationPointers } from "@shared/relation-field";
import {
  getAllConfigs,
  getContentTypeConfig,
  getDatabaseName,
  type ContentTypeEditorHint,
  type ContentTypeEntry,
} from "./content-types";
import { databaseManager } from "./database";
import { resolveSourceName } from "./query-options";
import { contentIndex, type ContentType } from "./content-index";

export function relationEntryKey(contentType: string, slug: string): string {
  return `${contentType}/${slug}`;
}

export function relationTargetKey(source: string, pointerSlug: string): string {
  return `${source}/${pointerSlug}`;
}

export function mergedEditorForType(
  contentType: string,
  contentRoot?: string,
): Record<string, EditorHint> {
  const config = getContentTypeConfig(contentType, contentRoot);
  if (!config) return {};
  const dbSlug = config.database?.slug || getDatabaseName(contentType, contentRoot);
  let dbEditor: Record<string, EditorHint> | undefined;
  if (dbSlug && databaseManager.exists(dbSlug)) {
    dbEditor = databaseManager.get(dbSlug).editor as Record<string, EditorHint> | undefined;
  }
  return mergeEditorHints(
    config.editor as Record<string, EditorHint> | undefined,
    dbEditor,
  );
}

/**
 * Collect outbound target keys (`source/pointer`) from relation editor fields on entry data.
 */
export function collectOutboundRelationTargets(
  data: Record<string, unknown>,
  opts: {
    contentType: string;
    contentRoot?: string;
    editor?: Record<string, EditorHint | ContentTypeEditorHint>;
    fieldMapping?: Record<string, FieldMappingValue>;
  },
): string[] {
  const editor =
    opts.editor ??
    mergedEditorForType(opts.contentType, opts.contentRoot);
  const config = getContentTypeConfig(opts.contentType, opts.contentRoot);
  const mapping =
    opts.fieldMapping ??
    ((config?.field_mapping || {}) as Record<string, FieldMappingValue>);

  const out = new Set<string>();

  const fieldKeys = new Set<string>([
    ...Object.keys(mapping),
    ...Object.keys(editor),
  ]);

  for (const key of fieldKeys) {
    if (skipFieldWithoutEditor(key, editor as Record<string, EditorHint>)) continue;
    const mappingValue = mapping[key];
    if (
      mappingValue !== undefined &&
      isSkippedMappingSource(mappingSourceString(mappingValue))
    ) {
      continue;
    }
    const hint = editor[key] as EditorHint | undefined;
    if (!hint || hint.type !== "relation") continue;
    const source = typeof hint.source === "string" ? hint.source.trim() : "";
    if (!source) continue;

    const resolved = resolveSourceName(source, opts.contentRoot, databaseManager);
    if (resolved.kind === "collision") continue;
    const sourceName =
      resolved.kind === "contentType" || resolved.kind === "database"
        ? resolved.name
        : source;

    const raw = key.includes(".") ? extractByDotPath(data, key) : data[key];
    const normalized = normalizeRelationPointers(raw);
    if (!normalized.ok || normalized.value === null) continue;
    const pointers = Array.isArray(normalized.value)
      ? normalized.value
      : [normalized.value];
    for (const pointer of pointers) {
      if (pointer) out.add(relationTargetKey(sourceName, pointer));
    }
  }

  return [...out].sort();
}

/** Union relation targets from multiple data bags (e.g. _common + locales). */
export function unionOutboundRelationTargets(
  bags: Array<Record<string, unknown> | null | undefined>,
  opts: {
    contentType: string;
    contentRoot?: string;
  },
): string[] {
  const out = new Set<string>();
  for (const bag of bags) {
    if (!bag || typeof bag !== "object") continue;
    for (const t of collectOutboundRelationTargets(bag, opts)) {
      out.add(t);
    }
  }
  return [...out].sort();
}

/**
 * Full-site crawl: content-type/slug → outbound target keys.
 */
export function collectSiteOutboundRelations(contentRoot?: string): Record<string, string[]> {
  const configs = getAllConfigs(contentRoot);
  const outbound: Record<string, string[]> = {};

  for (const [typeName] of Object.entries(configs) as [string, ContentTypeEntry][]) {
    const editor = mergedEditorForType(typeName, contentRoot);
    const hasRelation = Object.values(editor).some((h) => h?.type === "relation");
    if (!hasRelation) continue;

    let slugs: string[] = [];
    try {
      slugs = contentIndex.listContentSlugs(typeName as ContentType);
    } catch {
      continue;
    }

    for (const slug of slugs) {
      const bags: Array<Record<string, unknown>> = [];
      try {
        const locales = contentIndex.getAvailableLocalesOrVariants(
          typeName as ContentType,
          slug,
        );
        const tryLocales = locales.filter((l) => !l.startsWith("_") && !l.includes("."));
        const localesToLoad = tryLocales.length > 0 ? tryLocales.slice(0, 4) : ["en"];
        for (const locale of localesToLoad) {
          const { data } = contentIndex.loadMergedContent(typeName, slug, locale);
          if (data && typeof data === "object") {
            bags.push(data as Record<string, unknown>);
          }
        }
      } catch {
        continue;
      }
      const targets = unionOutboundRelationTargets(bags, {
        contentType: typeName,
        contentRoot,
      });
      if (targets.length > 0) {
        outbound[relationEntryKey(typeName, slug)] = targets;
      }
    }
  }

  return outbound;
}
