/**
 * Meta Validator
 *
 * Validates meta properties in content files:
 * - Required fields (page_title, description) as errors on live files
 * - Priority values (0-1)
 * - Change frequency values
 */

import type { Validator, ValidatorResult, ValidationContext, ValidationIssue } from "../shared/types";
import { validateRequiredMeta } from "../../../shared/validateRequiredMeta";
import { resolveSingleVars } from "../../../server/single-resolver";
import { liveFilesForSeo } from "../shared/seoValidationScope";

const VALID_CHANGE_FREQUENCIES = [
  "always",
  "hourly",
  "daily",
  "weekly",
  "monthly",
  "yearly",
  "never",
];

const TEMPLATE_RE = /\{\{[\s\S]*?\}\}/;
const GLOBAL_VAR_RE = /\{\{\s*global\./;

export const metaValidator: Validator = {
  name: "meta",
  description: "Validates meta properties (page_title, description, priority, change_frequency)",
  apiExposed: true,
  estimatedDuration: "fast",
  category: "seo",

  async run(context: ValidationContext): Promise<ValidatorResult> {
    const startTime = Date.now();
    const errors: ValidationIssue[] = [];
    const warnings: ValidationIssue[] = [];

    for (const file of liveFilesForSeo(context)) {
      const rawMeta = file.meta || {};
      // Resolve {{ single.* }} against file data when possible so template-only meta fails if empty
      const bag: Record<string, unknown> = {
        ...(file as unknown as Record<string, unknown>),
        title: (file as { title?: string }).title,
        description: (file as { description?: string }).description,
        slug: (file as { slug?: string }).slug,
      };
      const resolvedMeta = resolveSingleVars({ meta: rawMeta }, bag) as {
        meta?: Record<string, unknown>;
      };
      const meta = resolvedMeta.meta || rawMeta;

      // Warn when global.* vars appear in meta — the validator bag has no global data,
      // so the live value is always the pipe fallback. Make sure a fallback exists.
      if (
        GLOBAL_VAR_RE.test(String(rawMeta.page_title || "")) ||
        GLOBAL_VAR_RE.test(String(rawMeta.description || ""))
      ) {
        warnings.push({
          type: "warning",
          code: "META_USES_GLOBAL_VAR",
          message:
            "meta.page_title / meta.description uses {{ global.* }} which cannot be resolved at validation time — ensure a pipe fallback is set (e.g. {{ global.global_job_placement_rate | '84' }})",
          file: file.filePath,
          suggestion: "Add a pipe fallback value so the meta renders correctly even when the global variable is unavailable",
        });
      }

      const required = validateRequiredMeta(meta);
      if (!required.ok) {
        for (const err of required.errors) {
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
      } else if (TEMPLATE_RE.test(String(meta.page_title || "")) || TEMPLATE_RE.test(String(meta.description || ""))) {
        errors.push({
          type: "error",
          code: "UNRESOLVED_META_TEMPLATE",
          message: "meta.page_title / meta.description still contain unresolved {{ }} templates",
          file: file.filePath,
          suggestion: "Ensure mapped single.* fields that feed meta are filled on the entry",
        });
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
