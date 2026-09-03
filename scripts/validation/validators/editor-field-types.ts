/**
 * Validates content-type editor contracts and entry Field value shapes/schemas.
 * Does not check required emptiness, mapping source presence, or relation targets.
 */

import type { Validator, ValidatorResult, ValidationContext, ValidationIssue } from "../shared/types";
import {
  getAllConfigs,
  getContentTypeConfig,
  getDatabaseName,
  type ContentTypeEntry,
} from "../../../server/content-types";
import { databaseManager } from "../../../server/database";
import {
  extractByDotPath,
  isSkippedMappingSource,
  mappingSourceString,
  mergeEditorHints,
  skipFieldWithoutEditor,
  validateEditorConfig,
  validateEditorFieldValue,
  type EditorFieldIssue,
  type EditorHint,
  type FieldMappingValue,
} from "@shared/validateEditorFieldTypes";
import { EDITOR_FIELD_TYPES_ISSUE_CODES } from "./editor-field-types.issueCodes";

function isSharedSingleTemplate(filePath: string): boolean {
  const base = filePath.split(/[/\\]/).pop() || "";
  return /^single\./i.test(base);
}

function issueToValidation(
  issue: EditorFieldIssue,
  file?: string,
): ValidationIssue {
  return {
    type: issue.severity,
    code: issue.code,
    message: issue.message,
    file,
    suggestion: issue.suggestion,
  };
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

export const editorFieldTypesValidator: Validator = {
  name: "editor-field-types",
  issueCodes: EDITOR_FIELD_TYPES_ISSUE_CODES,
  description:
    "Validates content-type editor types/schemas and that live Field values match those contracts",
  apiExposed: true,
  estimatedDuration: "medium",
  category: "integrity",

  async run(context: ValidationContext): Promise<ValidatorResult> {
    const startTime = Date.now();
    const errors: ValidationIssue[] = [];
    const warnings: ValidationIssue[] = [];

    const configs = getAllConfigs(context.contentRoot);
    const contentTypesPath = context.contentRoot
      ? `${context.contentRoot}/content-types.yml`
      : "content-types.yml";

    let configsChecked = 0;
    let configIssues = 0;
    const editorByType = new Map<string, Record<string, EditorHint>>();

    for (const [typeName, config] of Object.entries(configs)) {
      configsChecked++;
      const editor = mergedEditorForConfig(config, typeName, context.contentRoot);
      editorByType.set(typeName, editor);
      const mapping = (config.field_mapping || {}) as Record<string, FieldMappingValue>;
      const issues = validateEditorConfig(editor, mapping);
      for (const issue of issues) {
        configIssues++;
        const mapped = issueToValidation(
          {
            ...issue,
            message: `${typeName}: ${issue.message}`,
          },
          contentTypesPath,
        );
        if (mapped.type === "error") errors.push(mapped);
        else warnings.push(mapped);
      }
    }

    let entriesChecked = 0;
    let typeMismatches = 0;

    for (const file of context.contentFiles) {
      if (!file.type) continue;
      if (isSharedSingleTemplate(file.filePath)) continue;

      const config = getContentTypeConfig(file.type, context.contentRoot) ?? configs[file.type];
      if (!config) continue;
      const typeKey = file.type;
      const editor = editorByType.get(typeKey) || mergedEditorForConfig(config, typeKey, context.contentRoot);
      const mapping = (config.field_mapping || {}) as Record<string, FieldMappingValue>;
      const data = (file.entryFields || {}) as Record<string, unknown>;
      entriesChecked++;

      for (const [key, mappingValue] of Object.entries(mapping)) {
        if (skipFieldWithoutEditor(key, editor)) continue;
        const source = mappingSourceString(mappingValue);
        if (isSkippedMappingSource(source)) continue;
        const hint = editor[key];
        if (!hint?.type) continue;
        const value = key.includes(".") ? extractByDotPath(data, key) : data[key];
        const issues = validateEditorFieldValue(key, value, hint);
        for (const issue of issues) {
          typeMismatches++;
          const mapped = issueToValidation(issue, file.filePath);
          if (mapped.type === "error") errors.push(mapped);
          else warnings.push(mapped);
        }
      }
    }

    const duration = Date.now() - startTime;
    return {
      name: this.name,
      description: this.description,
      status: errors.length > 0 ? "failed" : warnings.length > 0 ? "warning" : "passed",
      errors,
      warnings,
      duration,
      artifacts: {
        configsChecked,
        entriesChecked,
        typeMismatches,
        configIssues,
      },
    };
  },
};
