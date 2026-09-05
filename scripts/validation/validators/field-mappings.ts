import type { Validator, ValidatorResult, ValidationContext, ValidationIssue } from "../shared/types";
import { getAllConfigs } from "../../../server/content-types";
import {
  effectiveRequiredMode,
  type EditorRequiredHint,
} from "../../../shared/validateRequiredFields";
import { validateFieldMapping } from "../shared/fieldMappingValidator";
import { FIELD_MAPPINGS_ISSUE_CODES } from "./field-mappings.issueCodes";

/** editor.required true | "attached" — optional / unset fields never raise integrity issues. */
function isEditorRequiredField(
  editor: Record<string, EditorRequiredHint> | undefined,
  fieldKey: string,
): boolean {
  return effectiveRequiredMode(editor?.[fieldKey]) != null;
}

export const fieldMappingsValidator: Validator = {
  name: "field-mappings",
  issueCodes: FIELD_MAPPINGS_ISSUE_CODES,
  description:
    "Validates that required (editor.required) field mapping sources exist in non-database content entries; optional fields are ignored",
  apiExposed: true,
  estimatedDuration: "medium",
  category: "integrity",

  async run(_context: ValidationContext): Promise<ValidatorResult> {
    const startTime = Date.now();
    const errors: ValidationIssue[] = [];
    const warnings: ValidationIssue[] = [];

    const configs = getAllConfigs();
    let totalChecked = 0;
    let issuesFound = 0;

    for (const [typeName, config] of Object.entries(configs)) {
      if (config.database) continue;
      if (!config.field_mapping) continue;

      const rawMapping = config.field_mapping;
      const editor = config.editor as Record<string, EditorRequiredHint> | undefined;

      const normalizedMapping: Record<string, string> = {};
      for (const [key, value] of Object.entries(rawMapping)) {
        if (key.startsWith("_")) continue;
        if (typeof value === "string") {
          normalizedMapping[key] = value;
        } else if (value && typeof value === "object" && typeof value.source === "string") {
          normalizedMapping[key] = value.source;
        }
      }

      if (Object.keys(normalizedMapping).length === 0) continue;

      const result = validateFieldMapping(typeName, normalizedMapping);

      for (const [fieldKey, fieldResult] of Object.entries(result.results)) {
        totalChecked++;
        if (!isEditorRequiredField(editor, fieldKey)) continue;

        const source = normalizedMapping[fieldKey];

        if (fieldResult.found === 0 && fieldResult.total > 0) {
          issuesFound++;
          const missingFiles = fieldResult.missing.flatMap((m) => m.files);
          errors.push({
            type: "error",
            code: "FIELD_MAPPING_MISSING",
            message: `${typeName}: field "${fieldKey}" source "${source}" present in 0/${fieldResult.total} entries`,
            suggestion: `Add "${source}" to: ${missingFiles.join(", ")}`,
          });
        } else if (fieldResult.found > 0 && fieldResult.found < fieldResult.total) {
          issuesFound++;
          const missingFiles = fieldResult.missing.flatMap((m) => m.files);
          warnings.push({
            type: "warning",
            code: "FIELD_MAPPING_PARTIAL",
            message: `${typeName}: field "${fieldKey}" source "${source}" present in ${fieldResult.found}/${fieldResult.total} entries`,
            suggestion: `Add "${source}" to: ${missingFiles.join(", ")}`,
          });
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
        totalChecked,
        issuesFound,
      },
    };
  },
};
