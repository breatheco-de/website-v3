/**
 * URL-pattern params must live on locale YAML and match same-locale peer slugs.
 */

import fs from "fs";
import path from "path";
import yaml from "js-yaml";
import type { Validator, ValidatorResult, ValidationContext, ValidationIssue } from "../shared/types";
import {
  getContentTypeConfig,
  getFieldMapping,
  getRawUrlParamValue,
} from "../../../server/content-types";
import {
  extractParamSlug,
  observeParamValues,
  urlPatternParams,
} from "../../../server/url-param-peers";
import { URL_PARAM_LOCALE_ISSUE_CODES } from "./url-param-locale.issueCodes";

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

function readParamFromFile(filePath: string, param: string, mapping: Record<string, string | null> | undefined): string | null {
  if (!fs.existsSync(filePath)) return null;
  try {
    const data = safeLoad(fs.readFileSync(filePath, "utf-8"));
    if (!data) return null;
    return extractParamSlug(getRawUrlParamValue(data, param, mapping));
  } catch {
    return null;
  }
}

export const urlParamLocaleValidator: Validator = {
  name: "url-param-locale",
  issueCodes: URL_PARAM_LOCALE_ISSUE_CODES,
  description:
    "URL-pattern params must be on locale YAML (not _common) and use slugs observed among same-locale peers",
  apiExposed: true,
  estimatedDuration: "fast",
  category: "integrity",

  async run(context: ValidationContext): Promise<ValidatorResult> {
    const startTime = Date.now();
    const errors: ValidationIssue[] = [];
    const warnings: ValidationIssue[] = [];
    let checked = 0;

    const contentPath = context.contentRoot
      ? path.isAbsolute(context.contentRoot)
        ? context.contentRoot
        : path.join(process.cwd(), context.contentRoot)
      : path.join(process.cwd(), "site_4geeks-com");

    for (const file of context.contentFiles) {
      const config = getContentTypeConfig(file.type, context.contentRoot);
      if (!config) continue;
      const params = urlPatternParams(config);
      if (params.length === 0) continue;
      const mapping = getFieldMapping(file.type, context.contentRoot);

      if (file.locale === "_common") {
        for (const param of params) {
          const fromFields =
            file.entryFields &&
            extractParamSlug(getRawUrlParamValue(file.entryFields, param, mapping));
          const slug = fromFields ?? readParamFromFile(file.filePath, param, mapping);
          if (slug) {
            errors.push({
              type: "error",
              code: "URL_PARAM_ON_COMMON",
              message:
                `URL param "${param}" ("${slug}") is on _common.yml — move it to en.yml / es.yml (language-specific slug per locale).`,
              file: file.filePath,
              suggestion:
                `Remove ${param} from _common.yml and set it on each live locale file with the correct slug for that language.`,
            });
          }
        }
        continue;
      }

      if (!file.locale || file.locale.startsWith("_") || file.locale.includes(".")) continue;
      checked++;

      for (const param of params) {
        const raw = file.entryFields
          ? getRawUrlParamValue(file.entryFields, param, mapping)
          : undefined;
        const slug = extractParamSlug(raw);
        if (!slug) continue;

        const observed = observeParamValues(contentPath, file.type, config, param, file.locale);
        if (observed.length > 0 && !observed.includes(slug)) {
          errors.push({
            type: "error",
            code: "URL_PARAM_LOCALE_PEER_MISMATCH",
            message:
              `URL param "${param}" value "${slug}" on ${file.locale} locale is not used by any other ${file.locale} peer.`,
            file: file.filePath,
            suggestion:
              `Pick a ${param} from ${file.locale} peers (get_content_type_info observed_values_by_locale) or create a new slug via MCP with confirm_new_values after principal approval.`,
          });
        }
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
