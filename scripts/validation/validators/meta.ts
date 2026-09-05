/**
 * Meta Validator
 *
 * Validates meta properties in content files:
 * - Required fields (page_title, description) as errors on live files
 * - Priority values (0-1)
 * - Change frequency values
 *
 * Resolves {{ single.* }} / {{ entry.* }} and site vars (global.* / brand.*)
 * the same way as the live SEO gate before required checks.
 */

import * as path from "path";
import type { Validator, ValidatorResult, ValidationContext, ValidationIssue } from "../shared/types";
import { validateRequiredMeta } from "../../../shared/validateRequiredMeta";
import { resolveAllTemplateVars } from "../../../server/resolve-template-vars";
import { getDefaultContentRoot } from "../../../server/site-config";
import { liveFilesForSeo } from "../shared/seoValidationScope";
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

const TEMPLATE_RE = /\{\{[\s\S]*?\}\}/;

function resolveContentRoot(context: ValidationContext): string {
  if (context.contentRoot) {
    return path.isAbsolute(context.contentRoot)
      ? context.contentRoot
      : path.join(process.cwd(), context.contentRoot);
  }
  return path.resolve(getDefaultContentRoot());
}

function buildSingleEntry(file: {
  entryFields?: Record<string, unknown>;
  title?: string;
  description?: string;
  slug?: string;
  locale?: string;
}): Record<string, unknown> {
  const fromEntry =
    file.entryFields && typeof file.entryFields === "object" ? { ...file.entryFields } : {};
  return {
    ...fromEntry,
    title: fromEntry.title ?? file.title,
    description: fromEntry.description ?? file.description,
    slug: fromEntry.slug ?? file.slug,
  };
}

function entryRegion(entryFields: Record<string, unknown> | undefined): string | undefined {
  const region = entryFields?.region;
  if (typeof region === "string" && region.trim()) return region.trim();
  return undefined;
}

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
    const contentRoot = resolveContentRoot(context);

    for (const file of liveFilesForSeo(context)) {
      const rawMeta =
        file.meta && typeof file.meta === "object" && !Array.isArray(file.meta)
          ? (file.meta as Record<string, unknown>)
          : {};
      const singleEntry = buildSingleEntry(file);
      const region = entryRegion(file.entryFields);

      const meta = resolveAllTemplateVars(rawMeta, {
        singleEntry,
        meta: rawMeta,
        contentRoot,
        context: { locale: file.locale, region },
        skipSiteVars: false,
      }) as Record<string, unknown>;

      const titleHasTemplate = TEMPLATE_RE.test(String(meta.page_title ?? "").trim());
      const descHasTemplate = TEMPLATE_RE.test(String(meta.description ?? "").trim());

      if (titleHasTemplate || descHasTemplate) {
        errors.push({
          type: "error",
          code: "UNRESOLVED_META_TEMPLATE",
          message: "meta.page_title / meta.description still contain unresolved {{ }} templates",
          file: file.filePath,
          suggestion:
            "Ensure mapped single.*/entry.* fields and site vars (global.*/brand.*) that feed meta are filled, or add a pipe fallback",
        });
      }

      const required = validateRequiredMeta(meta);
      if (!required.ok) {
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
