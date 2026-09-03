/**
 * Component behaviors validator — full matrix for form-settings / dynamic_entries /
 * schema_org handlers / ecommerce funnel components.
 */

import * as fs from "fs";
import * as path from "path";
import * as yaml from "js-yaml";
import type { Validator, ValidatorResult, ValidationContext, ValidationIssue } from "../shared/types";
import { resolveComponentBehaviors } from "../../../shared/component-behaviors";
import { getDefaultContentRoot } from "../../../server/site-config";
import { COMPONENT_BEHAVIORS_ISSUE_CODES } from "./component-behaviors.issueCodes";

function findRegistryRoots(): string[] {
  const roots: string[] = [];
  const shared = path.join(process.cwd(), "shared/component-registry");
  if (fs.existsSync(shared)) roots.push(shared);
  try {
    const contentRoot = getDefaultContentRoot();
    const siteReg = path.join(contentRoot, "component-registry");
    if (fs.existsSync(siteReg)) roots.push(siteReg);
  } catch {
    const fallback = path.join(process.cwd(), "site_4geeks-com/component-registry");
    if (fs.existsSync(fallback)) roots.push(fallback);
  }
  return roots;
}

function loadFieldEditorsMap(versionDir: string): Record<string, string> {
  const fePath = path.join(versionDir, "field-editors.ts");
  if (!fs.existsSync(fePath)) return {};
  const content = fs.readFileSync(fePath, "utf8");
  const match = content.match(/export\s+const\s+fieldEditors\s*[^=]*=\s*(\{[\s\S]*?\});/);
  if (!match) return {};
  const entries: Record<string, string> = {};
  const entryRegex = /"([^"]+)":\s*"([^"]+)"/g;
  let m;
  while ((m = entryRegex.exec(match[1]!)) !== null) {
    entries[m[1]!] = m[2]!;
  }
  return entries;
}

function hasDynamicEntriesSignal(schema: Record<string, unknown>, fieldEditors: Record<string, string>): boolean {
  if (schema.dynamic_entries || schema.dynamic_item_fields) return true;
  return Object.values(fieldEditors).some((ed) => String(ed).includes("dynamic_entries") || ed === "db-field-values-picker");
}

function hasFormSettings(fieldEditors: Record<string, string>): boolean {
  return Object.values(fieldEditors).some((ed) => String(ed).split(":")[0] === "form-settings");
}

function hasCtaTracking(fieldEditors: Record<string, string>): boolean {
  return Object.values(fieldEditors).some((ed) => String(ed).split(":")[0] === "cta-tracking");
}

export const componentBehaviorsValidator: Validator = {
  name: "component-behaviors",
  issueCodes: COMPONENT_BEHAVIORS_ISSUE_CODES,
  description:
    "Ensures component schema.yml declares behaviors for form-settings, listing, schema_org, and ecommerce signals",
  apiExposed: true,
  estimatedDuration: "fast",
  category: "components",

  async run(_context: ValidationContext): Promise<ValidatorResult> {
    const startTime = Date.now();
    const errors: ValidationIssue[] = [];
    const warnings: ValidationIssue[] = [];

    for (const root of findRegistryRoots()) {
      if (!fs.existsSync(root)) continue;
      const types = fs.readdirSync(root, { withFileTypes: true }).filter((d) => d.isDirectory());
      for (const typeDir of types) {
        const typePath = path.join(root, typeDir.name);
        const versions = fs
          .readdirSync(typePath, { withFileTypes: true })
          .filter((d) => d.isDirectory() && /^v\d/.test(d.name))
          .sort((a, b) => b.name.localeCompare(a.name));
        if (versions.length === 0) continue;
        const versionPath = path.join(typePath, versions[0]!.name);
        const schemaPath = path.join(versionPath, "schema.yml");
        if (!fs.existsSync(schemaPath)) continue;

        let parsed: Record<string, unknown>;
        try {
          const loaded = yaml.load(fs.readFileSync(schemaPath, "utf-8"));
          if (!loaded || typeof loaded !== "object" || Array.isArray(loaded)) continue;
          parsed = loaded as Record<string, unknown>;
        } catch {
          continue;
        }

        const behaviors = resolveComponentBehaviors(parsed);
        const fieldEditors = loadFieldEditorsMap(versionPath);
        const relativePath = path.relative(process.cwd(), schemaPath);

        if (hasFormSettings(fieldEditors) && !behaviors.conversion) {
          errors.push({
            type: "error",
            code: "BEHAVIOR_MISSING_CONVERSION",
            message: `${typeDir.name}: field-editors include form-settings but behaviors.conversion is missing`,
            file: relativePath,
            suggestion: "Add behaviors.conversion with via: form-settings",
          });
        }

        if (hasDynamicEntriesSignal(parsed, fieldEditors) && !behaviors.listing) {
          errors.push({
            type: "error",
            code: "BEHAVIOR_MISSING_LISTING",
            message: `${typeDir.name}: listing/dynamic_entries signal present but behaviors.listing is missing`,
            file: relativePath,
            suggestion: "Add behaviors.listing with source: dynamic_entries",
          });
        }

        if (parsed.schema_org && !behaviors.schema_org) {
          errors.push({
            type: "error",
            code: "BEHAVIOR_MISSING_SCHEMA_ORG",
            message: `${typeDir.name}: top-level schema_org present but resolveComponentBehaviors found none`,
            file: relativePath,
            suggestion: "Move to behaviors.schema_org or keep legacy handler object",
          });
        }

        if (hasCtaTracking(fieldEditors) && !behaviors.ecommerce) {
          errors.push({
            type: "error",
            code: "BEHAVIOR_MISSING_ECOMMERCE",
            message: `${typeDir.name}: cta-tracking field-editors present but behaviors.ecommerce is missing`,
            file: relativePath,
            suggestion: "Add behaviors.ecommerce with role and events",
          });
        }

        // Soft check: known ecommerce component types
        if (
          ["enrollment_selector", "pricing_plans"].includes(typeDir.name) &&
          !behaviors.ecommerce
        ) {
          errors.push({
            type: "error",
            code: "BEHAVIOR_MISSING_ECOMMERCE",
            message: `${typeDir.name}: expected behaviors.ecommerce`,
            file: relativePath,
            suggestion: "Declare ecommerce funnel/catalog behaviors",
          });
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
