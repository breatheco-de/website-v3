/**
 * Variables Metadata Validator
 *
 * Every non-system variable in variables.yml needs a description and category so
 * agents can pick the right fact (list_variables) and reviewers know which edits
 * need the outcome-figures review.
 */

import * as fs from "fs";
import * as path from "path";
import type { Validator, ValidatorResult, ValidationContext, ValidationIssue } from "../shared/types";
import { getDefaultContentRoot } from "../../../server/site-config";
import { getVariableManager, type VariableDefinition } from "../../../server/variable-manager";
import {
  isSystemManagedVariable,
  isVariableCategory,
  isVariableSource,
  isVariableUnit,
  missingVariableMetadata,
  normalizeVariableProducts,
} from "../../../shared/variable-metadata";
import {
  VARIABLES_METADATA_ISSUE_CODES,
  VARIABLES_METADATA_VALIDATOR_NAME,
} from "./variables-metadata.issueCodes";
import { listProductRows } from "../../../server/product/product-io";

const TOKEN_RE = /\{\{\s*(global\.[a-zA-Z0-9_.]+)\s*(?:\|[^}]*)?\}\}/g;

function resolveContentRoot(context: ValidationContext): string {
  if (context.contentRoot) {
    return path.isAbsolute(context.contentRoot)
      ? context.contentRoot
      : path.join(process.cwd(), context.contentRoot);
  }
  return path.resolve(getDefaultContentRoot());
}

function walkYamlFiles(dir: string): string[] {
  const out: string[] = [];
  if (!fs.existsSync(dir)) return out;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === "node_modules" || entry.name === ".git" || entry.name === ".cache") continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walkYamlFiles(full));
    else if (entry.name.endsWith(".yml") || entry.name.endsWith(".yaml")) out.push(full);
  }
  return out;
}

function allValues(def: VariableDefinition): string[] {
  const vals: string[] = [];
  if (typeof def.default === "string") vals.push(def.default);
  for (const c of def.conditions ?? []) if (typeof c.value === "string") vals.push(c.value);
  for (const m of [def.by_region, def.by_location, def.by_locale]) {
    for (const v of Object.values(m ?? {})) if (typeof v === "string") vals.push(v);
  }
  return vals;
}

const NUMERIC = /^[0-9][0-9.,\s]*$/;

/** Returns a short reason when a value does not fit its unit; null when it fits or the value is empty. */
export function unitMismatch(unit: string | undefined, value: string): string | null {
  const v = value.trim();
  if (!v || !unit || unit === "text") return null;
  if (/\{\{/.test(v)) return null;
  switch (unit) {
    case "percent":
      if (v.includes("%")) return "contains %";
      return NUMERIC.test(v) ? null : "not a number";
    case "usd":
    case "eur":
      if (/[$€]|\b(usd|eur)\b/i.test(v)) return "contains a currency symbol";
      return NUMERIC.test(v) ? null : "not a number";
    case "count":
      return /^[0-9][0-9.,\s]*\+?$/.test(v) ? null : "not a count";
    case "weeks":
    case "rating":
      return NUMERIC.test(v) ? null : "not a number";
    case "url":
      return /^(https?:\/\/|\/|mailto:|tel:)/i.test(v) ? null : "not a URL or path";
    default:
      return null;
  }
}

export function duplicateKey(name: string): string {
  return name.replace(/^global\./, "").toLowerCase().replace(/[^a-z0-9]/g, "");
}

export const variablesMetadataValidator: Validator = {
  name: VARIABLES_METADATA_VALIDATOR_NAME,
  issueCodes: VARIABLES_METADATA_ISSUE_CODES,
  description:
    "Site variables (facts) need description + category; flags unit/source/products issues, deprecated variables in use, broken replaced_by, near-duplicate names",
  apiExposed: true,
  estimatedDuration: "fast",
  category: "integrity",
  runClass: "cross-entry",

  async run(context: ValidationContext): Promise<ValidatorResult> {
    const startTime = Date.now();
    const errors: ValidationIssue[] = [];
    const warnings: ValidationIssue[] = [];
    const contentRoot = resolveContentRoot(context);
    const variablesFile = path.relative(process.cwd(), path.join(contentRoot, "variables.yml"));

    const defs = getVariableManager(contentRoot).getDefinitions();
    const own = Object.entries(defs).filter(
      ([name, def]) => name.startsWith("global.") && !isSystemManagedVariable(name, def),
    );
    let knownProductSlugs: Set<string> | null = null;
    try {
      knownProductSlugs = new Set(
        listProductRows({ includePaused: true, contentRoot }).map((p) => p.content_slug),
      );
    } catch {
      knownProductSlugs = null;
    }

    for (const [name, def] of own) {
      const missing = missingVariableMetadata(name, def);
      if (missing.description) {
        errors.push({
          type: "error",
          code: "VARIABLE_MISSING_DESCRIPTION",
          message: `Variable "${name}" has no description.`,
          file: variablesFile,
          suggestion: VARIABLES_METADATA_ISSUE_CODES.VARIABLE_MISSING_DESCRIPTION.suggestion,
        });
      }
      if (!def.category?.trim()) {
        errors.push({
          type: "error",
          code: "VARIABLE_MISSING_CATEGORY",
          message: `Variable "${name}" has no category.`,
          file: variablesFile,
          suggestion: VARIABLES_METADATA_ISSUE_CODES.VARIABLE_MISSING_CATEGORY.suggestion,
        });
      } else if (!isVariableCategory(def.category)) {
        errors.push({
          type: "error",
          code: "VARIABLE_INVALID_CATEGORY",
          message: `Variable "${name}" has unknown category "${def.category}".`,
          file: variablesFile,
          suggestion: VARIABLES_METADATA_ISSUE_CODES.VARIABLE_INVALID_CATEGORY.suggestion,
        });
      }
      if (def.unit && !isVariableUnit(def.unit)) {
        errors.push({
          type: "error",
          code: "VARIABLE_INVALID_UNIT",
          message: `Variable "${name}" has unknown unit "${def.unit}".`,
          file: variablesFile,
          suggestion: VARIABLES_METADATA_ISSUE_CODES.VARIABLE_INVALID_UNIT.suggestion,
        });
      } else if (def.unit) {
        const bad = allValues(def)
          .map((v) => ({ v, reason: unitMismatch(def.unit, v) }))
          .filter((x) => x.reason);
        if (bad.length) {
          warnings.push({
            type: "warning",
            code: "VARIABLE_UNIT_MISMATCH",
            message: `Variable "${name}" (unit ${def.unit}): ${bad
              .slice(0, 3)
              .map((b) => `"${b.v}" ${b.reason}`)
              .join("; ")}.`,
            file: variablesFile,
            suggestion: VARIABLES_METADATA_ISSUE_CODES.VARIABLE_UNIT_MISMATCH.suggestion,
          });
        }
      }
      if (def.source && !isVariableSource(def.source)) {
        errors.push({
          type: "error",
          code: "VARIABLE_INVALID_SOURCE",
          message: `Variable "${name}" has unknown source "${def.source}".`,
          file: variablesFile,
          suggestion: VARIABLES_METADATA_ISSUE_CODES.VARIABLE_INVALID_SOURCE.suggestion,
        });
      }
      if (def.products != null) {
        if (!Array.isArray(def.products) || def.products.some((p) => typeof p !== "string")) {
          errors.push({
            type: "error",
            code: "VARIABLE_INVALID_PRODUCTS",
            message: `Variable "${name}" products must be a list of product content slugs.`,
            file: variablesFile,
            suggestion: VARIABLES_METADATA_ISSUE_CODES.VARIABLE_INVALID_PRODUCTS.suggestion,
          });
        } else if (knownProductSlugs && knownProductSlugs.size > 0) {
          const normalized = normalizeVariableProducts(def.products) ?? [];
          const unknown = normalized.filter((slug) => !knownProductSlugs!.has(slug));
          if (unknown.length) {
            warnings.push({
              type: "warning",
              code: "VARIABLE_UNKNOWN_PRODUCT",
              message: `Variable "${name}" products unknown on this site: ${unknown.join(", ")}.`,
              file: variablesFile,
              suggestion: VARIABLES_METADATA_ISSUE_CODES.VARIABLE_UNKNOWN_PRODUCT.suggestion,
            });
          }
        }
      }
      if (def.deprecated && def.replaced_by) {
        const target = defs[def.replaced_by];
        if (!target || target.deprecated) {
          warnings.push({
            type: "warning",
            code: "VARIABLE_REPLACED_BY_BROKEN",
            message: `Variable "${name}" replaced_by "${def.replaced_by}" ${target ? "is itself deprecated" : "does not exist"}.`,
            file: variablesFile,
            suggestion: VARIABLES_METADATA_ISSUE_CODES.VARIABLE_REPLACED_BY_BROKEN.suggestion,
          });
        }
      }
    }

    const byKey = new Map<string, string[]>();
    for (const [name, def] of own) {
      if (def.deprecated) continue;
      const key = duplicateKey(name);
      byKey.set(key, [...(byKey.get(key) ?? []), name]);
    }
    for (const names of byKey.values()) {
      if (names.length < 2) continue;
      warnings.push({
        type: "warning",
        code: "VARIABLE_NEAR_DUPLICATE",
        message: `Near-duplicate variables: ${names.sort().join(", ")}.`,
        file: variablesFile,
        suggestion: VARIABLES_METADATA_ISSUE_CODES.VARIABLE_NEAR_DUPLICATE.suggestion,
      });
    }

    const deprecated = new Map(own.filter(([, d]) => d.deprecated).map(([n, d]) => [n, d]));
    if (deprecated.size > 0) {
      const usage = new Map<string, Set<string>>();
      for (const filePath of walkYamlFiles(contentRoot)) {
        if (path.basename(filePath) === "variables.yml") continue;
        let raw: string;
        try {
          raw = fs.readFileSync(filePath, "utf-8");
        } catch {
          continue;
        }
        if (!raw.includes("global.")) continue;
        const re = new RegExp(TOKEN_RE.source, TOKEN_RE.flags);
        let m: RegExpExecArray | null;
        while ((m = re.exec(raw)) !== null) {
          if (!deprecated.has(m[1])) continue;
          const set = usage.get(m[1]) ?? new Set<string>();
          set.add(path.relative(process.cwd(), filePath));
          usage.set(m[1], set);
        }
      }
      for (const [name, files] of usage) {
        const def = deprecated.get(name)!;
        const list = [...files];
        warnings.push({
          type: "warning",
          code: "VARIABLE_DEPRECATED_IN_USE",
          message: `Deprecated variable "${name}" is used in ${list.length} file(s): ${list.slice(0, 5).join("; ")}${
            list.length > 5 ? ` (+${list.length - 5} more)` : ""
          }.${def.replaced_by ? ` Use ${def.replaced_by}.` : ""}`,
          file: list[0],
          suggestion: VARIABLES_METADATA_ISSUE_CODES.VARIABLE_DEPRECATED_IN_USE.suggestion,
        });
      }
    }

    return {
      name: this.name,
      description: this.description,
      status: errors.length > 0 ? "failed" : "passed",
      errors,
      warnings,
      duration: Date.now() - startTime,
      artifacts: { variablesChecked: own.length },
    };
  },
};
