/**
 * Checks editor.type: relation pointers exist in the source content type or database.
 * Shape-invalid values are owned by editor-field-types.
 */

import type { Validator, ValidatorResult, ValidationContext, ValidationIssue } from "../shared/types";
import {
  getAllConfigs,
  getContentTypeConfig,
  getDatabaseName,
  type ContentTypeEntry,
} from "../../../server/content-types";
import { databaseManager } from "../../../server/database";
import { contentIndex, type ContentType } from "../../../server/content-index";
import { resolveSourceName } from "../../../server/query-options";
import { getDefaultLocale, getSupportedLocales } from "../../../server/settings";
import {
  extractByDotPath,
  isSkippedEmptyValue,
  isSkippedMappingSource,
  isTemplateValue,
  mappingSourceString,
  mergeEditorHints,
  skipFieldWithoutEditor,
  type EditorHint,
  type FieldMappingValue,
} from "@shared/validateEditorFieldTypes";
import { coerceRelationFieldInput, normalizeRelationPointers } from "@shared/relation-field";
import {
  collectIdsFromItems,
  idFromItem,
  relationIndexKey,
  relationTargetMissing,
} from "@shared/validateRelationTargets";
import { skipCrossEntryVariantRow } from "../shared/draftFiles";

function isSharedSingleTemplate(filePath: string): boolean {
  const base = filePath.split(/[/\\]/).pop() || "";
  return /^single\./i.test(base);
}

function localeUnionOrder(contentRoot?: string): string[] {
  const supported = getSupportedLocales(contentRoot);
  const def = getDefaultLocale(contentRoot);
  const ordered: string[] = [];
  const push = (l?: string) => {
    if (l && supported.includes(l) && !ordered.includes(l)) ordered.push(l);
  };
  push(def);
  for (const l of supported) push(l);
  return ordered;
}

function mergedEditorForConfig(
  config: ContentTypeEntry,
  typeName: string,
  contentRoot?: string,
): Record<string, EditorHint> {
  const dbSlug = config.database?.slug || getDatabaseName(typeName, contentRoot);
  let dbEditor: Record<string, EditorHint> | undefined;
  if (dbSlug && databaseManager.exists(dbSlug)) {
    dbEditor = databaseManager.get(dbSlug).editor as Record<string, EditorHint> | undefined;
  }
  return mergeEditorHints(
    config.editor as Record<string, EditorHint> | undefined,
    dbEditor,
  );
}

function collectContentTypeIds(
  typeName: string,
  valuePath: string,
  contentRoot?: string,
): Set<string> {
  const ids = new Set<string>();
  const slugs = contentIndex.listContentSlugs(typeName as ContentType);
  if (valuePath === "slug" || !valuePath) {
    for (const slug of slugs) ids.add(slug);
  }
  const locales = localeUnionOrder(contentRoot);
  for (const slug of slugs) {
    const available = contentIndex.getAvailableLocalesOrVariants(typeName as ContentType, slug);
    const tryLocales = [
      ...locales.filter((l) => available.includes(l)),
      ...available.filter((l) => !l.startsWith("_") && !l.includes(".")),
    ];
    const seen = new Set<string>();
    for (const locale of tryLocales) {
      if (seen.has(locale)) continue;
      seen.add(locale);
      const { data } = contentIndex.loadMergedContent(typeName, slug, locale);
      if (!data || typeof data !== "object") continue;
      const id = idFromItem(data as Record<string, unknown>, valuePath || "slug");
      if (id) ids.add(id);
    }
  }
  return ids;
}

function loadIndexForSource(
  source: string,
  valuePath: string,
  contentRoot: string | undefined,
  cache: Map<string, Set<string> | "bad-source">,
  sourceErrors: ValidationIssue[],
  configFile: string,
): Set<string> | null {
  const key = relationIndexKey(source, valuePath);
  const cached = cache.get(key);
  if (cached === "bad-source") return null;
  if (cached) return cached;

  const resolved = resolveSourceName(source, contentRoot, databaseManager);
  if (resolved.kind === "not_found" || resolved.kind === "collision") {
    cache.set(key, "bad-source");
    const already = sourceErrors.some((e) => e.message.includes(`"${source}"`));
    if (!already) {
      sourceErrors.push({
        type: "error",
        code:
          resolved.kind === "collision"
            ? "RELATION_SOURCE_COLLISION"
            : "RELATION_SOURCE_NOT_FOUND",
        message:
          resolved.kind === "collision"
            ? `Relation source "${source}" collides as both a content type and a database slug`
            : `Relation source "${source}" is not a content type or database`,
        file: configFile,
        suggestion:
          resolved.kind === "collision"
            ? "Rename one side so query-options / relation source names stay unique"
            : `Set editor.<field>.source to a known content-type key or database slug`,
      });
    }
    return null;
  }

  let ids: Set<string>;
  if (resolved.kind === "database") {
    const items = (databaseManager.getMappedItems(resolved.name) || []) as Record<
      string,
      unknown
    >[];
    ids = collectIdsFromItems(items, valuePath);
  } else {
    ids = collectContentTypeIds(resolved.name, valuePath, contentRoot);
  }
  cache.set(key, ids);
  return ids;
}

export const relationTargetsValidator: Validator = {
  name: "relation-targets",
  description:
    "Validates editor.type: relation pointers resolve to an existing content-type or database entry",
  apiExposed: true,
  estimatedDuration: "medium",
  category: "integrity",
  runClass: "cross-entry",

  async run(context: ValidationContext): Promise<ValidatorResult> {
    const startTime = Date.now();
    const errors: ValidationIssue[] = [];
    const warnings: ValidationIssue[] = [];
    const configs = getAllConfigs(context.contentRoot);
    const configFile = context.contentRoot
      ? `${context.contentRoot}/content-types.yml`
      : "content-types.yml";
    const indexCache = new Map<string, Set<string> | "bad-source">();
    const sourceErrors: ValidationIssue[] = [];

    let entriesChecked = 0;
    let pointersChecked = 0;
    let missing = 0;

    for (const file of context.contentFiles) {
      if (skipCrossEntryVariantRow(file)) continue;
      if (!file.type) continue;
      if (isSharedSingleTemplate(file.filePath)) continue;
      const config = getContentTypeConfig(file.type, context.contentRoot) ?? configs[file.type];
      if (!config) continue;
      const editor = mergedEditorForConfig(config, file.type, context.contentRoot);
      const mapping = (config.field_mapping || {}) as Record<string, FieldMappingValue>;
      const data = (file.entryFields || {}) as Record<string, unknown>;
      entriesChecked++;

      for (const [key, mappingValue] of Object.entries(mapping)) {
        if (skipFieldWithoutEditor(key, editor)) continue;
        if (isSkippedMappingSource(mappingSourceString(mappingValue))) continue;
        const hint = editor[key];
        if (!hint || hint.type !== "relation") continue;
        const source = typeof hint.source === "string" ? hint.source.trim() : "";
        if (!source) continue;

        const raw = key.includes(".") ? extractByDotPath(data, key) : data[key];
        if (isSkippedEmptyValue(raw) || isTemplateValue(raw)) continue;
        const shape = coerceRelationFieldInput(raw, hint);
        if (!shape.ok) continue;

        const normalized = normalizeRelationPointers(raw);
        if (!normalized.ok || normalized.value === null) continue;
        const pointers = Array.isArray(normalized.value)
          ? normalized.value
          : [normalized.value];
        const valuePath = hint.value?.trim() || "slug";
        const ids = loadIndexForSource(
          source,
          valuePath,
          context.contentRoot,
          indexCache,
          sourceErrors,
          configFile,
        );
        if (!ids) continue;

        for (const pointer of pointers) {
          pointersChecked++;
          if (relationTargetMissing(pointer, ids)) {
            missing++;
            errors.push({
              type: "error",
              code: "FIELD_RELATION_TARGET_MISSING",
              message: `Relation "${key}" pointer "${pointer}" not found in source "${source}"`,
              file: file.filePath,
              suggestion: `Use a slug that exists on ${source} (value path: ${valuePath})`,
            });
          }
        }
      }
    }

    errors.unshift(...sourceErrors);

    const duration = Date.now() - startTime;
    return {
      name: this.name,
      description: this.description,
      status: errors.length > 0 ? "failed" : warnings.length > 0 ? "warning" : "passed",
      errors,
      warnings,
      duration,
      artifacts: {
        entriesChecked,
        pointersChecked,
        missing,
        sourcesIndexed: [...indexCache.keys()].filter((k) => indexCache.get(k) !== "bad-source")
          .length,
      },
    };
  },
};
