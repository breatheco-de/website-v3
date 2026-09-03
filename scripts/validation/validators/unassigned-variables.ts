/**
 * Unassigned Variables Validator
 *
 * Flags global.* / brand.* variables that are used on the site but have no
 * assigned value (missing definition, or resolve with empty context is blank).
 *
 * Usage sources:
 * - Content YAML {{ name }} / {{ name | fallback }} (skip when every usage has
 *   a non-empty pipe fallback)
 * - auth.signup.field_map global entries (always strict)
 * - content-types.yml preview.props brand.* / global.* (always strict)
 */

import * as fs from "fs";
import * as path from "path";
import type { Validator, ValidatorResult, ValidationContext, ValidationIssue } from "../shared/types";
import { getDefaultContentRoot } from "../../../server/site-config";
import { getVariableManager } from "../../../server/variable-manager";
import { getAuthSettings } from "../../../server/settings";
import { getAllConfigs } from "../../../server/content-types";
import { isGlobalEntry } from "../../../shared/authSignupFieldMap";
import { UNASSIGNED_VARIABLES_ISSUE_CODES } from "./unassigned-variables.issueCodes";

const TEMPLATE_RE =
  /\{\{\s*([a-zA-Z_][a-zA-Z0-9_.]*)\s*(?:\|\s*([\s\S]*?))?\s*\}\}/g;

const SITE_VAR_RE = /^(global|brand)\./;

type YamlUsage = {
  name: string;
  file: string;
  hasNonEmptyFallback: boolean;
};

function resolveContentRoot(context: ValidationContext): string {
  if (context.contentRoot) {
    return path.isAbsolute(context.contentRoot)
      ? context.contentRoot
      : path.join(process.cwd(), context.contentRoot);
  }
  return path.resolve(getDefaultContentRoot());
}

function walkYamlFiles(dir: string): string[] {
  const results: string[] = [];
  if (!fs.existsSync(dir)) return results;
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.name === "node_modules" || entry.name === ".git" || entry.name === ".cache") {
      continue;
    }
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...walkYamlFiles(fullPath));
    } else if (entry.name.endsWith(".yml") || entry.name.endsWith(".yaml")) {
      results.push(fullPath);
    }
  }
  return results;
}

function extractYamlUsages(raw: string, fileRel: string): YamlUsage[] {
  const out: YamlUsage[] = [];
  const re = new RegExp(TEMPLATE_RE.source, TEMPLATE_RE.flags);
  let m: RegExpExecArray | null;
  while ((m = re.exec(raw)) !== null) {
    const name = m[1];
    if (!SITE_VAR_RE.test(name)) continue;
    const fallback = (m[2] ?? "").trim();
    out.push({
      name,
      file: fileRel,
      hasNonEmptyFallback: fallback.length > 0,
    });
  }
  return out;
}

function isUnassigned(contentRoot: string, name: string): boolean {
  const vm = getVariableManager(contentRoot);
  const resolved = vm.resolveVariable(name, {});
  if (!resolved) return true;
  return resolved.value.trim() === "";
}

export const unassignedVariablesValidator: Validator = {
  name: "unassigned-variables",
  issueCodes: UNASSIGNED_VARIABLES_ISSUE_CODES,
  description:
    "Flags used global.*/brand.* variables with no assigned default (YAML, signup field_map, OG preview.props)",
  apiExposed: true,
  estimatedDuration: "fast",
  category: "integrity",
  runClass: "cross-entry",

  async run(context: ValidationContext): Promise<ValidatorResult> {
    const startTime = Date.now();
    const errors: ValidationIssue[] = [];
    const warnings: ValidationIssue[] = [];
    const contentRoot = resolveContentRoot(context);

    /** name → where used (for messaging) */
    const strictUsages = new Map<string, string[]>();
    /** name → YAML usages (for pipe-skip rule) */
    const yamlByName = new Map<string, YamlUsage[]>();

    const addStrict = (name: string, where: string) => {
      if (!SITE_VAR_RE.test(name)) return;
      const list = strictUsages.get(name) ?? [];
      list.push(where);
      strictUsages.set(name, list);
    };

    // 1) Content YAML templates
    for (const filePath of walkYamlFiles(contentRoot)) {
      let raw: string;
      try {
        raw = fs.readFileSync(filePath, "utf-8");
      } catch {
        continue;
      }
      const rel = path.relative(process.cwd(), filePath);
      for (const usage of extractYamlUsages(raw, rel)) {
        const list = yamlByName.get(usage.name) ?? [];
        list.push(usage);
        yamlByName.set(usage.name, list);
      }
    }

    for (const [name, usages] of yamlByName) {
      const allHaveFallback = usages.every((u) => u.hasNonEmptyFallback);
      if (allHaveFallback) continue;
      for (const u of usages.filter((x) => !x.hasNonEmptyFallback)) {
        addStrict(name, u.file);
      }
    }

    // 2) Auth signup field_map globals
    try {
      const fieldMap = getAuthSettings(contentRoot).signup?.field_map ?? [];
      for (const entry of fieldMap) {
        if (!isGlobalEntry(entry)) continue;
        addStrict(entry.global, "auth.signup.field_map");
      }
    } catch {
      // settings missing — skip
    }

    // 3) OG / entry preview props
    try {
      const configs = getAllConfigs(contentRoot);
      for (const [typeName, cfg] of Object.entries(configs)) {
        const props = cfg.preview?.props;
        if (!props || typeof props !== "object") continue;
        for (const [propKey, source] of Object.entries(props)) {
          if (typeof source !== "string") continue;
          const t = source.trim();
          if (!SITE_VAR_RE.test(t)) continue;
          addStrict(
            t,
            `content-types.yml preview.props (${typeName}.${propKey})`,
          );
        }
      }
    } catch {
      // registry missing — skip
    }

    for (const [name, wheres] of strictUsages) {
      if (!isUnassigned(contentRoot, name)) continue;
      const uniqueWheres = [...new Set(wheres)];
      const whereText = uniqueWheres.slice(0, 5).join("; ");
      const more =
        uniqueWheres.length > 5 ? ` (+${uniqueWheres.length - 5} more)` : "";
      errors.push({
        type: "error",
        code: "UNASSIGNED_VARIABLE",
        message: `Variable "${name}" is used but has no assigned value (empty or missing default). Used in: ${whereText}${more}`,
        file: uniqueWheres[0]?.startsWith("auth.") || uniqueWheres[0]?.startsWith("content-types")
          ? undefined
          : uniqueWheres[0],
        suggestion:
          name.startsWith("brand.")
            ? "Set a value in Settings → Brand, or remove this reference from preview.props / YAML."
            : "Set a default in Variables (/private/variables), or remove this reference.",
      });
    }

    const duration = Date.now() - startTime;
    return {
      name: this.name,
      description: this.description,
      status: errors.length > 0 ? "failed" : "passed",
      errors,
      warnings,
      duration,
      artifacts: {
        variablesChecked: strictUsages.size,
        unassigned: errors.length,
      },
    };
  },
};
