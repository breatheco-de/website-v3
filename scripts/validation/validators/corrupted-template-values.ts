/**
 * Corrupted Template Values Validator
 *
 * Flags content YAML where a `{{ … }}` placeholder was destroyed into
 * `{"[object Object]": null}` (a plain js-yaml read of an unquoted placeholder,
 * then a write). Saves of such files are blocked by `dumpContentYaml`.
 */

import * as fs from "fs";
import * as path from "path";
import type { Validator, ValidatorResult, ValidationContext, ValidationIssue } from "../shared/types";
import { resolveScanRoot } from "../shared/draft-scan";
import { CORRUPTED_TEMPLATE_KEY, findCorruptedTemplateKeys } from "../../../shared/templateVars";
import { loadContentYaml } from "../../../server/content-yaml";
import {
  CORRUPTED_TEMPLATE_VALUES_ISSUE_CODES,
  CORRUPTED_TEMPLATE_VALUES_VALIDATOR_NAME,
} from "./corrupted-template-values.issueCodes";

const SKIP_DIRS = new Set(["node_modules", ".git", ".cache"]);

function walkYamlFiles(dir: string, out: string[] = []): string[] {
  if (!fs.existsSync(dir)) return out;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (!SKIP_DIRS.has(entry.name)) walkYamlFiles(path.join(dir, entry.name), out);
    } else if (/\.ya?ml$/.test(entry.name)) {
      out.push(path.join(dir, entry.name));
    }
  }
  return out;
}

export const corruptedTemplateValuesValidator: Validator = {
  name: CORRUPTED_TEMPLATE_VALUES_VALIDATOR_NAME,
  issueCodes: CORRUPTED_TEMPLATE_VALUES_ISSUE_CODES,
  description: 'Flags {{ … }} placeholders saved as {"[object Object]": null}',
  apiExposed: true,
  estimatedDuration: "fast",
  category: "integrity",

  async run(context: ValidationContext): Promise<ValidatorResult> {
    const startTime = Date.now();
    const errors: ValidationIssue[] = [];
    const root = resolveScanRoot(context.contentRoot);
    const suggestion = CORRUPTED_TEMPLATE_VALUES_ISSUE_CODES.CORRUPTED_TEMPLATE_VALUE.suggestion;

    for (const filePath of walkYamlFiles(root)) {
      const raw = fs.readFileSync(filePath, "utf-8");
      if (!raw.includes(CORRUPTED_TEMPLATE_KEY)) continue;
      let paths: string[];
      try {
        paths = findCorruptedTemplateKeys(loadContentYaml(raw));
      } catch {
        continue;
      }
      if (paths.length === 0) continue;
      const relativePath = path.relative(process.cwd(), filePath);
      errors.push({
        type: "error",
        code: "CORRUPTED_TEMPLATE_VALUE",
        message: `Broken template placeholder at ${paths.join(", ")} in ${relativePath}. Saves of this file are blocked until it is repaired.`,
        file: relativePath,
        suggestion,
      });
    }

    return {
      name: this.name,
      description: this.description,
      status: errors.length > 0 ? "failed" : "passed",
      errors,
      warnings: [],
      duration: Date.now() - startTime,
    };
  },
};
