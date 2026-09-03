/**
 * Warns when merged entry bags have keys that are not field_mapping or YAML structure.
 */

import type { Validator, ValidatorResult, ValidationContext, ValidationIssue } from "../shared/types";
import { getAllConfigs, getContentTypeConfig } from "../../../server/content-types";
import { collectUnknownFieldKeys } from "@shared/validateUnknownFieldKeys";
import { UNKNOWN_KEYS_ISSUE_CODES } from "./unknown-keys.issueCodes";

function isSharedSingleTemplate(filePath: string): boolean {
  const base = filePath.split(/[/\\]/).pop() || "";
  return /^single\./i.test(base);
}

export const unknownKeysValidator: Validator = {
  name: "unknown-keys",
  issueCodes: UNKNOWN_KEYS_ISSUE_CODES,
  description:
    "Warns when live entry YAML/Fields contain keys that are not in field_mapping or structural allowlist",
  apiExposed: true,
  estimatedDuration: "fast",
  category: "integrity",

  async run(context: ValidationContext): Promise<ValidatorResult> {
    const startTime = Date.now();
    const errors: ValidationIssue[] = [];
    const warnings: ValidationIssue[] = [];
    const configs = getAllConfigs(context.contentRoot);
    let entriesChecked = 0;
    let unknownKeys = 0;

    for (const file of context.contentFiles) {
      if (!file.type) continue;
      if (isSharedSingleTemplate(file.filePath)) continue;
      const config = getContentTypeConfig(file.type, context.contentRoot) ?? configs[file.type];
      if (!config) continue;
      const data = (file.entryFields || {}) as Record<string, unknown>;
      entriesChecked++;
      const hits = collectUnknownFieldKeys(data, config.field_mapping as Record<string, unknown>);
      for (const hit of hits) {
        unknownKeys++;
        warnings.push({
          type: "warning",
          code: "UNKNOWN_FIELD_KEY",
          message: hit.inOverrides
            ? `Unknown field_overrides key "${hit.key}" is not in field_mapping`
            : `Unknown Field key "${hit.key}" is not in field_mapping or structural allowlist`,
          file: file.filePath,
          suggestion: `Add "${hit.key}" to field_mapping (and editor) or remove it from the entry YAML`,
        });
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
        entriesChecked,
        unknownKeys,
      },
    };
  },
};
