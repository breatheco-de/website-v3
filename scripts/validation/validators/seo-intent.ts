/**
 * Funnel intent + focus features validator.
 * Cluster / pillar graph rules live in seo-cluster.
 */

import fs from "fs";
import path from "path";
import yaml from "js-yaml";
import type { Validator, ValidatorResult, ValidationContext, ValidationIssue } from "../shared/types";
import { liveFilesForSeo } from "../shared/seoValidationScope";
import { SEO_INTENT_ISSUE_CODES } from "./seo-intent.issueCodes";

interface SeoConfig {
  intents: Record<string, { label: string; description: string }>;
  intent_defaults: Record<string, string>;
  focus_features: Record<string, { label: string; description: string }>;
}

function loadSeoConfig(contentRoot?: string): SeoConfig | null {
  const candidates: string[] = [];
  if (contentRoot) {
    const root = path.isAbsolute(contentRoot) ? contentRoot : path.join(process.cwd(), contentRoot);
    candidates.push(path.join(root, "seo-config.yml"));
  }
  candidates.push(
    path.join(process.cwd(), "site_4geeks-com", "seo-config.yml"),
    path.join(process.cwd(), "4geeks-com", "seo-config.yml"),
  );
  const configPath = candidates.find((p) => fs.existsSync(p));
  if (!configPath) return null;
  try {
    const raw = fs.readFileSync(configPath, "utf-8");
    return yaml.load(raw) as SeoConfig;
  } catch {
    return null;
  }
}

export const seoIntentValidator: Validator = {
  name: "seo-intent",
  issueCodes: SEO_INTENT_ISSUE_CODES,
  description: "Validates seo.intent and seo.focus_features against seo-config.yml",
  apiExposed: true,
  estimatedDuration: "fast",
  category: "seo",

  async run(context: ValidationContext): Promise<ValidatorResult> {
    const startTime = Date.now();
    const errors: ValidationIssue[] = [];
    const warnings: ValidationIssue[] = [];

    const config = loadSeoConfig(context.contentRoot);
    if (!config) {
      return {
        name: this.name,
        description: this.description,
        status: "failed",
        errors: [
          {
            type: "error",
            code: "CONFIG_MISSING",
            message: "seo-config.yml not found",
            suggestion: "Create seo-config.yml with intents, intent_defaults, and focus_features",
          },
        ],
        warnings: [],
        duration: Date.now() - startTime,
      };
    }

    const validIntents = new Set(Object.keys(config.intents));
    const validFeatures = new Set(Object.keys(config.focus_features));
    const seen = new Set<string>();

    for (const file of liveFilesForSeo(context)) {
      const key = `${file.slug}:${file.type}:${file.locale}`;
      if (seen.has(key)) continue;
      seen.add(key);

      const seo = file.seo;
      if (!seo) continue;

      if (seo.intent !== undefined && seo.intent !== null) {
        if (!validIntents.has(seo.intent)) {
          errors.push({
            type: "error",
            code: "INVALID_INTENT",
            message: `Invalid intent "${seo.intent}" for "${file.slug}" (${file.locale})`,
            file: file.filePath,
            suggestion: `Valid values: ${[...validIntents].join(", ")}`,
          });
        }
      }

      if (Array.isArray(seo.focus_features) && seo.focus_features.length > 0) {
        for (const feature of seo.focus_features) {
          if (!validFeatures.has(feature)) {
            errors.push({
              type: "error",
              code: "INVALID_FOCUS_FEATURE",
              message: `Unknown focus_feature "${feature}" in "${file.slug}" (${file.locale})`,
              file: file.filePath,
              suggestion: `Valid focus_features: ${[...validFeatures].join(", ")}`,
            });
          }
        }
      }
    }

    const status = errors.length > 0 ? "failed" : warnings.length > 0 ? "warning" : "passed";

    return {
      name: this.name,
      description: this.description,
      status,
      errors,
      warnings,
      duration: Date.now() - startTime,
    };
  },
};
