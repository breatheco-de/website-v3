/**
 * CTA tracking + purchasable validators (bound cta-tracking paths only).
 */

import * as fs from "fs";
import * as path from "path";
import * as yaml from "js-yaml";
import type { Validator, ValidatorResult, ValidationContext, ValidationIssue } from "../shared/types";
import {
  validateCtaTracking,
  validateCtaPurchasable,
  resolveBoundCtaPaths,
} from "../../../shared/validateCtaTracking";
import { getAllDirectories } from "../../../server/content-types";
import { loadAllFieldEditors } from "../../../server/component-registry";
import { ecommerceManager } from "../../../server/ecommerce/ecommerce-manager";
import { scanEcommerceContent } from "../../../server/ecommerce/ecommerce-index";
import { CTA_TRACKING_ISSUE_CODES } from "./cta-tracking.issueCodes";

const CONTENT_DIRS = getAllDirectories().map((dir) => `4geeks-com/${dir}`);

function walkYamlFiles(dir: string): string[] {
  const results: string[] = [];
  if (!fs.existsSync(dir)) return results;

  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...walkYamlFiles(fullPath));
    } else if (entry.name.endsWith(".yml") || entry.name.endsWith(".yaml")) {
      if (entry.name.startsWith("_") && entry.name !== "_common.yml") continue;
      results.push(fullPath);
    }
  }
  return results;
}

function inferContentContext(filePath: string): { contentType?: string; contentSlug?: string } {
  // .../programs/ai-fluency/en.yml
  const parts = filePath.split(path.sep);
  const programsIdx = parts.findIndex((p) => p === "programs");
  if (programsIdx >= 0 && parts[programsIdx + 1]) {
    return { contentType: "program", contentSlug: parts[programsIdx + 1] };
  }
  const pagesIdx = parts.findIndex((p) => p === "pages");
  if (pagesIdx >= 0 && parts[pagesIdx + 1]) {
    return { contentType: "page", contentSlug: parts[pagesIdx + 1] };
  }
  return {};
}

export const ctaTrackingValidator: Validator = {
  name: "cta-tracking",
  issueCodes: CTA_TRACKING_ISSUE_CODES,
  description:
    "Validates cta.tracking enum and purchasable product linkage on field-editor cta-tracking paths",
  apiExposed: true,
  estimatedDuration: "fast",
  category: "forms",

  async run(_context: ValidationContext): Promise<ValidatorResult> {
    const startTime = Date.now();
    const errors: ValidationIssue[] = [];
    const warnings: ValidationIssue[] = [];

    try {
      scanEcommerceContent();
    } catch {
      // index may already be loaded
    }

    const allFieldEditors = loadAllFieldEditors();
    const resolveProduct = (programId: string) => {
      const byCms = ecommerceManager.findProductByCmsEntry("program", programId);
      if (byCms) return { product_id: byCms.product_id, active: byCms.actively_selling };
      const byId = ecommerceManager.getProduct(programId);
      if (byId) return { product_id: byId.product_id, active: byId.actively_selling };
      return undefined;
    };

    for (const contentDir of CONTENT_DIRS) {
      const fullDir = path.join(process.cwd(), contentDir.replace(/^4geeks-com\//, "site_4geeks-com/"));
      const altDir = path.join(process.cwd(), contentDir);
      const dir = fs.existsSync(fullDir) ? fullDir : altDir;
      const yamlFiles = walkYamlFiles(dir);

      for (const filePath of yamlFiles) {
        let parsed: Record<string, unknown>;
        try {
          const loaded = yaml.load(fs.readFileSync(filePath, "utf-8"));
          if (!loaded || typeof loaded !== "object" || Array.isArray(loaded)) continue;
          parsed = loaded as Record<string, unknown>;
        } catch {
          continue;
        }

        const sections = Array.isArray(parsed.sections) ? parsed.sections : [];
        const ctx = inferContentContext(filePath);
        const relativePath = path.relative(process.cwd(), filePath);

        for (let i = 0; i < sections.length; i++) {
          const section = sections[i];
          if (!section || typeof section !== "object" || Array.isArray(section)) continue;
          const sec = section as Record<string, unknown>;
          const sectionType = String(sec.type ?? "");
          const editors = allFieldEditors[sectionType] ?? {};
          const variant = typeof sec.variant === "string" ? sec.variant : undefined;
          const ctaPaths = resolveBoundCtaPaths(editors, variant);
          if (!ctaPaths.length) continue;

          const trackingErr = validateCtaTracking(sec, ctaPaths);
          if (trackingErr) {
            errors.push({
              type: "error",
              code: "CTA_TRACKING_INVALID",
              message: `sections[${i}]: ${trackingErr}. File: ${relativePath}`,
              file: relativePath,
              suggestion: trackingErr,
            });
          }

          const purchasableErr = validateCtaPurchasable(sec, ctaPaths, {
            ...ctx,
            resolveProduct,
          });
          if (purchasableErr) {
            errors.push({
              type: "error",
              code: "CTA_PURCHASABLE_MISSING",
              message: `sections[${i}]: ${purchasableErr}. File: ${relativePath}`,
              file: relativePath,
              suggestion: purchasableErr,
            });
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
