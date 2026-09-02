/**
 * Forms Validator
 *
 * Scans all content files and reports:
 * - conversion_name values that are set but not in the known conversion events list
 * - missing conversion_name when a bound form-settings object is present
 *   (absent nested forms, e.g. CTA-only heroes, are allowed)
 * - form fields.*.source.related_field issues (empty/missing/broken/slugs combo)
 */

import * as fs from "fs";
import * as path from "path";
import * as yaml from "js-yaml";
import type { Validator, ValidatorResult, ValidationContext, ValidationIssue } from "../shared/types";
import {
  validateFormSection,
  validateRequiredConversionName,
} from "../../../shared/validateFormSection";
import { validateSignupFormFields } from "../../../shared/authSignupFieldMap";
import { validateFormFieldSources } from "../../../shared/validateFormFieldSources";
import { resolveBoundFormSettingsPath } from "../../../shared/wipeOnDuplicate";
import {
  getAllDirectories,
  getContentTypeConfig,
  getType,
} from "../../../server/content-types";
import { getTrackingSettings, getAuthSettings, getAuthConversionEventConfig } from "../../../server/settings";
import { loadAllFieldEditors } from "../../../server/component-registry";
import { escapeTemplateVars, unescapeObjectVars } from "../../../shared/templateVars";
import { getDefaultContentRoot } from "../../../server/site-config";

const CONTENT_ROOT = getDefaultContentRoot();
const CONTENT_DIRS = getAllDirectories().map((dir) => path.join(CONTENT_ROOT, dir));

function walkYamlFiles(dir: string): string[] {
  const results: string[] = [];
  if (!fs.existsSync(dir)) return results;

  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...walkYamlFiles(fullPath));
    } else if (entry.name.endsWith(".yml") || entry.name.endsWith(".yaml")) {
      results.push(fullPath);
    }
  }
  return results;
}

function safeLoadYaml(filePath: string): Record<string, unknown> | null {
  try {
    const raw = fs.readFileSync(filePath, "utf-8");
    const { escaped, map } = escapeTemplateVars(raw);
    const loaded = yaml.load(escaped);
    if (!loaded || typeof loaded !== "object" || Array.isArray(loaded)) return null;
    return unescapeObjectVars(loaded, map) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function contentTypeFromPath(filePath: string): string | null {
  const rel = path.relative(path.join(process.cwd(), CONTENT_ROOT), filePath);
  const parts = rel.split(path.sep);
  const dir = parts[0];
  if (!dir) return null;
  try {
    return getType(dir, CONTENT_ROOT);
  } catch {
    return dir;
  }
}

export const formsValidator: Validator = {
  name: "forms",
  description:
    "Validates form conversion_name and fields.*.source.related_field (publish rules)",
  apiExposed: true,
  estimatedDuration: "fast",
  category: "forms",

  async run(_context: ValidationContext): Promise<ValidatorResult> {
    const startTime = Date.now();
    const errors: ValidationIssue[] = [];
    const warnings: ValidationIssue[] = [];
    const conversionNames = getTrackingSettings().conversion_events.map((e) => e.name);
    const authConversion = getAuthConversionEventConfig();
    const signupFieldMap = getAuthSettings().signup?.field_map;
    const allFieldEditors = loadAllFieldEditors();

    for (const fullDir of CONTENT_DIRS) {
      const yamlFiles = walkYamlFiles(fullDir);

      for (const filePath of yamlFiles) {
        const parsed = safeLoadYaml(filePath);
        if (!parsed) continue;

        const relativePath = path.relative(process.cwd(), filePath);
        const sections = Array.isArray(parsed.sections) ? parsed.sections : [];
        const base = path.basename(filePath);
        const isCommon = base === "_common.yml" || base === "_common.yaml";
        if (isCommon) continue;

        const commonPath = path.join(path.dirname(filePath), "_common.yml");
        const common = safeLoadYaml(commonPath) || {};
        const singleEntry = { ...common, ...parsed };
        const ct = contentTypeFromPath(filePath);
        const config = ct ? getContentTypeConfig(ct, CONTENT_ROOT) : undefined;
        const editor = config?.editor as Record<string, { type?: string }> | undefined;
        const isDraft = base.startsWith("draft.");

        if (sections.length > 0 && editor) {
          const sourceIssues = validateFormFieldSources({
            singleEntry,
            editor,
            sections,
            mode: isDraft ? "draft" : "publish",
          });
          for (const issue of sourceIssues) {
            const target = issue.severity === "error" ? errors : warnings;
            target.push({
              type: issue.severity === "error" ? "error" : "warning",
              code: `FORM_SOURCE_${issue.code.toUpperCase()}`,
              message: `sections[${issue.sectionIndex ?? "?"}].${issue.formPath}: ${issue.message}. File: ${relativePath}`,
              file: relativePath,
              suggestion: issue.staffMessage,
            });
          }
        }

        for (let i = 0; i < sections.length; i++) {
          const section = sections[i];
          if (!section || typeof section !== "object" || Array.isArray(section)) continue;
          const sec = section as Record<string, unknown>;

          const err = validateFormSection(sec, conversionNames, authConversion);
          if (err) {
            errors.push({
              type: "error",
              code: "FORM_INVALID_CONVERSION_NAME",
              message: `sections[${i}].form conversion_name is invalid. File: ${relativePath}`,
              file: relativePath,
              suggestion: err,
            });
          }

          const sectionType = String(sec.type ?? "");
          const editors = allFieldEditors[sectionType] ?? {};
          const variant = typeof sec.variant === "string" ? sec.variant : undefined;
          const formSettingsPath = resolveBoundFormSettingsPath(editors, variant);
          const requiredErr = validateRequiredConversionName(sec, formSettingsPath);
          if (requiredErr) {
            errors.push({
              type: "error",
              code: "FORM_MISSING_CONVERSION_NAME",
              message: `sections[${i}]: ${requiredErr}. File: ${relativePath}`,
              file: relativePath,
              suggestion: requiredErr,
            });
          }

          if (formSettingsPath != null) {
            const formObj = (() => {
              if (!formSettingsPath) return sec;
              const parts = formSettingsPath.split(".").filter(Boolean);
              let current: unknown = sec;
              for (const part of parts) {
                if (!current || typeof current !== "object" || Array.isArray(current)) return null;
                current = (current as Record<string, unknown>)[part];
              }
              if (!current || typeof current !== "object" || Array.isArray(current)) return null;
              return current as Record<string, unknown>;
            })();
            const formLabel = formSettingsPath || "form";
            const signupErr = validateSignupFormFields(formObj, signupFieldMap, formLabel);
            if (signupErr) {
              errors.push({
                type: "error",
                code: "FORM_SIGNUP_FIELD_MAP",
                message: `sections[${i}]: ${signupErr}. File: ${relativePath}`,
                file: relativePath,
                suggestion: signupErr,
              });
            }
          }
        }
      }
    }

    return {
      name: this.name,
      description: this.description,
      status: errors.length > 0 ? "failed" : "passed",
      errors,
      warnings,
      duration: Date.now() - startTime,
    };
  },
};
