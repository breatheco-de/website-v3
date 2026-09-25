/**
 * Meta Validator
 *
 * Validates meta properties in content files:
 * - Required fields (page_title, description) as errors on live files
 * - Priority values (0-1)
 * - Change frequency values
 *
 * Resolves {{ single.* }} / {{ entry.* }} (field-mapped) and site vars
 * (global.* / brand.*) via resolveEntryMeta — same as the live SEO gate.
 */

import type { Validator, ValidatorResult, ValidationContext, ValidationIssue } from "../shared/types";
import { validateRequiredMeta } from "../../../shared/validateRequiredMeta";
import { liveFilesForSeo } from "../shared/seoValidationScope";
import { getResolvedMeta, hasTemplate } from "../shared/resolvedMeta";
import { templatesOnlyReferenceLiveFields } from "../shared/liveFields";
import { META_ISSUE_CODES } from "./meta.issueCodes";

const VALID_CHANGE_FREQUENCIES = [
  "always",
  "hourly",
  "daily",
  "weekly",
  "monthly",
  "yearly",
  "never",
];

export const metaValidator: Validator = {
  name: "meta",
  issueCodes: META_ISSUE_CODES,
  description: "Validates meta properties (page_title, description, priority, change_frequency)",
  apiExposed: true,
  estimatedDuration: "fast",
  category: "seo",

  async run(context: ValidationContext): Promise<ValidatorResult> {
    const startTime = Date.now();
    const errors: ValidationIssue[] = [];
    const warnings: ValidationIssue[] = [];

    for (const file of liveFilesForSeo(context)) {
      const resolved = getResolvedMeta(file, context);
      // Resolve failures are reported once by seo-depth (META_RESOLVE_FAILED).
      const meta = resolved.ok ? resolved.meta : null;

      const titleHasTemplate = meta ? hasTemplate(meta.page_title) : false;
      const descHasTemplate = meta ? hasTemplate(meta.description) : false;
      const titleUnresolved =
        titleHasTemplate &&
        !templatesOnlyReferenceLiveFields(meta?.page_title, file.type, context.contentRoot);
      const descUnresolved =
        descHasTemplate &&
        !templatesOnlyReferenceLiveFields(meta?.description, file.type, context.contentRoot);

      if (meta && (titleUnresolved || descUnresolved)) {
        errors.push({
          type: "error",
          code: "UNRESOLVED_META_TEMPLATE",
          message: "meta.page_title / meta.description still contain unresolved {{ }} templates",
          file: file.filePath,
          suggestion:
            "Ensure mapped single.*/entry.* fields and site vars (global.*/brand.*) that feed meta are filled, or add a pipe fallback",
        });
      }

      const required = meta ? validateRequiredMeta(meta) : null;
      if (required && !required.ok) {
        for (const err of required.errors) {
          const fieldHasTemplate =
            err.field === "meta.page_title" ? titleHasTemplate : descHasTemplate;
          // Leftover templates are reported as UNRESOLVED_META_TEMPLATE above — not MISSING_*.
          if (fieldHasTemplate) continue;
          errors.push({
            type: "error",
            code: err.field === "meta.page_title" ? "MISSING_PAGE_TITLE" : "MISSING_DESCRIPTION",
            message: err.message,
            file: file.filePath,
            suggestion:
              err.field === "meta.page_title"
                ? "Add a descriptive page_title for better SEO"
                : "Add a meta description (150-160 characters) for better SEO",
          });
        }
      }

      if (file.meta?.priority !== undefined) {
        if (typeof file.meta.priority !== "number" || file.meta.priority < 0 || file.meta.priority > 1) {
          errors.push({
            type: "error",
            code: "INVALID_PRIORITY",
            message: `Invalid priority value: ${file.meta.priority}. Must be a number between 0 and 1`,
            file: file.filePath,
            suggestion: "Set priority to a value between 0.0 and 1.0 (e.g., 0.8)",
          });
        }
      }

      if (file.meta?.change_frequency) {
        if (!VALID_CHANGE_FREQUENCIES.includes(file.meta.change_frequency)) {
          errors.push({
            type: "error",
            code: "INVALID_CHANGE_FREQUENCY",
            message: `Invalid change_frequency: "${file.meta.change_frequency}"`,
            file: file.filePath,
            suggestion: `Use one of: ${VALID_CHANGE_FREQUENCIES.join(", ")}`,
          });
        }
      }

      if (file.meta?.robots) {
        const validDirectives = ["index", "noindex", "follow", "nofollow", "none", "all"];
        const robotParts = file.meta.robots.split(",").map((s) => s.trim().toLowerCase());
        for (const part of robotParts) {
          if (!validDirectives.includes(part)) {
            warnings.push({
              type: "warning",
              code: "UNKNOWN_ROBOTS_DIRECTIVE",
              message: `Unknown robots directive: "${part}"`,
              file: file.filePath,
              suggestion: `Valid directives: ${validDirectives.join(", ")}`,
            });
          }
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
        filesChecked: context.contentFiles.length,
        missingTitles: errors.filter((w) => w.code === "MISSING_PAGE_TITLE").length,
        missingDescriptions: errors.filter((w) => w.code === "MISSING_DESCRIPTION").length,
      },
    };
  },
};
