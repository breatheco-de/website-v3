/**
 * Blog category must live on locale YAML and match same-locale peer slugs.
 */

import fs from "fs";
import path from "path";
import yaml from "js-yaml";
import type { Validator, ValidatorResult, ValidationContext, ValidationIssue } from "../shared/types";
import { getContentTypeConfig } from "../../../server/content-types";
import {
  extractParamSlug,
  observeParamValues,
} from "../../../server/url-param-peers";

function safeLoad(raw: string): Record<string, unknown> | null {
  try {
    const parsed = yaml.load(raw);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

function readCategoryFromFile(filePath: string): string | null {
  if (!fs.existsSync(filePath)) return null;
  try {
    const data = safeLoad(fs.readFileSync(filePath, "utf-8"));
    return extractParamSlug(data?.category);
  } catch {
    return null;
  }
}

export const blogCategoryLocaleValidator: Validator = {
  name: "blog-category-locale",
  description:
    "Blog category must be on locale YAML (not _common) and use a slug observed among same-locale peers",
  apiExposed: true,
  estimatedDuration: "fast",
  category: "integrity",

  async run(context: ValidationContext): Promise<ValidatorResult> {
    const startTime = Date.now();
    const errors: ValidationIssue[] = [];
    const warnings: ValidationIssue[] = [];
    let checked = 0;

    const config = getContentTypeConfig("blog", context.contentRoot);
    if (!config) {
      return {
        name: this.name,
        description: this.description,
        status: "passed",
        errors,
        warnings,
        duration: Date.now() - startTime,
        artifacts: { skipped: "no blog type" },
      };
    }

    const contentPath = context.contentRoot
      ? path.isAbsolute(context.contentRoot)
        ? context.contentRoot
        : path.join(process.cwd(), context.contentRoot)
      : path.join(process.cwd(), "site_4geeks-com");

    for (const file of context.contentFiles) {
      if (file.type !== "blog") continue;
      if (file.locale === "_common") {
        const cat = readCategoryFromFile(file.filePath);
        if (cat) {
          errors.push({
            type: "error",
            code: "CATEGORY_ON_COMMON",
            message:
              `Blog category "${cat}" is on _common.yml — move it to en.yml / es.yml (language-specific slug per locale).`,
            file: file.filePath,
            suggestion:
              "Remove category from _common.yml and set it on each live locale file. EN posts use English slugs (e.g. ai-tools); ES posts use Spanish slugs (e.g. herramientas-ia).",
          });
        }
        continue;
      }

      if (!file.locale || file.locale.startsWith("_") || file.locale.includes(".")) continue;
      checked++;

      const category = extractParamSlug((file.entryFields as Record<string, unknown> | undefined)?.category);
      if (!category) continue;

      const observed = observeParamValues(contentPath, "blog", config, "category", file.locale);
      if (observed.length > 0 && !observed.includes(category)) {
        errors.push({
          type: "error",
          code: "CATEGORY_LOCALE_PEER_MISMATCH",
          message:
            `Blog category "${category}" on ${file.locale} locale is not used by any other ${file.locale} peer.`,
          file: file.filePath,
          suggestion:
            `Pick a category from ${file.locale} peers (get_content_type_info observed_values_by_locale) or create a new slug via MCP with confirm_new_values after principal approval.`,
        });
      }
    }

    const duration = Date.now() - startTime;
    return {
      name: this.name,
      description: this.description,
      status: errors.length > 0 ? "failed" : "passed",
      errors,
      warnings,
      duration,
      artifacts: { checked },
    };
  },
};
