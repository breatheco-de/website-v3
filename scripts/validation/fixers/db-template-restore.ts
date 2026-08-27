/**
 * Fixer: db-template-restore
 *
 * Scans single.en.yml templates for each DB-backed content type and
 * identifies section fields whose values are hardcoded strings instead of
 * the expected {{ entry.X | <default> }} template expressions.
 *
 * Before fix #176, the section editor incorrectly wrote hardcoded image URLs
 * into the shared template, so every blog post would show the same image.
 * This fixer detects and restores those fields.
 *
 * Detection: a leaf string value in sections is a candidate if:
 *   1. It does not already contain a {{ }} template expression
 *      (after escaping, these become __TPL_N__ placeholders)
 *   2. Its field key or an ancestor key matches a key in the content
 *      type's field_mapping (meaning it should resolve from single.*)
 *
 * Fix: replaces the hardcoded value with {{ entry.<key> | <hardcoded_value> }}
 *      so each DB entry renders its own data, while the hardcoded value
 *      becomes the fallback default.
 */

import * as fs from "fs";
import * as path from "path";
import * as jsYaml from "js-yaml";
import type { Fixer, FixerContext, FixerResult } from "./types";
import { escapeTemplateVars, unescapeStringVars } from "../../../shared/templateVars";
import { getAllConfigs, getFieldMapping, getDatabaseName } from "../../../server/content-types";

const MARKETING_CONTENT_DIR = path.join(process.cwd(), "4geeks-com");

const PLACEHOLDER_RE = /__TPL_\d+__/;

interface HardcodedField {
  contentType: string;
  templateFile: string;
  dotPath: string;
  currentValue: string;
  suggestedExpression: string;
  singleKey: string;
}

function setNestedValue(obj: unknown, keys: string[], value: unknown): void {
  let current: unknown = obj;
  for (let i = 0; i < keys.length - 1; i++) {
    if (current == null || typeof current !== "object") return;
    const key = keys[i];
    if (Array.isArray(current)) {
      current = (current as unknown[])[parseInt(key, 10)];
    } else {
      current = (current as Record<string, unknown>)[key];
    }
  }
  if (current == null || typeof current !== "object") return;
  const lastKey = keys[keys.length - 1];
  if (Array.isArray(current)) {
    (current as unknown[])[parseInt(lastKey, 10)] = value;
  } else {
    (current as Record<string, unknown>)[lastKey] = value;
  }
}

function scanForHardcoded(
  obj: unknown,
  fieldMappingKeys: Set<string>,
  pathKeys: string[],
  results: Array<{ pathKeys: string[]; value: string; matchedKey: string }>,
): void {
  if (typeof obj !== "object" || obj === null) return;

  if (Array.isArray(obj)) {
    obj.forEach((item, i) =>
      scanForHardcoded(item, fieldMappingKeys, [...pathKeys, String(i)], results),
    );
    return;
  }

  for (const [key, value] of Object.entries(obj as Record<string, unknown>)) {
    const childKeys = [...pathKeys, key];

    if (typeof value === "string") {
      if (PLACEHOLDER_RE.test(value)) continue;

      const exactMatch = fieldMappingKeys.has(key);
      const isUrlValue = value.startsWith("http://") || value.startsWith("https://");
      const ancestorMatch = !exactMatch && isUrlValue
        ? pathKeys.find(seg => fieldMappingKeys.has(seg))
        : undefined;
      const matchedKey = exactMatch ? key : ancestorMatch;

      if (matchedKey && (exactMatch || isUrlValue)) {
        results.push({ pathKeys: childKeys, value, matchedKey });
      }
    } else if (typeof value === "object" && value !== null) {
      scanForHardcoded(value, fieldMappingKeys, childKeys, results);
    }
  }
}

function buildSingleExpression(singleKey: string, currentValue: string): string {
  return `{{ entry.${singleKey} | ${currentValue} }}`;
}

function detectHardcodedFields(
  contentType: string,
  templatePath: string,
  fieldMappingKeys: Set<string>,
): HardcodedField[] {
  let raw: string;
  try {
    raw = fs.readFileSync(templatePath, "utf-8");
  } catch {
    return [];
  }

  const { escaped, map } = escapeTemplateVars(raw);

  let parsed: Record<string, unknown>;
  try {
    parsed = (jsYaml.load(escaped) as Record<string, unknown>) || {};
  } catch {
    return [];
  }

  const sections = parsed.sections;
  if (!Array.isArray(sections)) return [];

  const rawResults: Array<{ pathKeys: string[]; value: string; matchedKey: string }> = [];
  scanForHardcoded(sections, fieldMappingKeys, ["sections"], rawResults);

  return rawResults.map(({ pathKeys, value, matchedKey }) => {
    const unescapedValue = unescapeStringVars(value, map);
    return {
      contentType,
      templateFile: path.relative(process.cwd(), templatePath),
      dotPath: pathKeys.join("."),
      currentValue: unescapedValue,
      suggestedExpression: buildSingleExpression(matchedKey, unescapedValue),
      singleKey: matchedKey,
    };
  });
}

function applyFix(templatePath: string, fields: HardcodedField[]): void {
  const raw = fs.readFileSync(templatePath, "utf-8");
  const { escaped, map } = escapeTemplateVars(raw);

  let parsed: Record<string, unknown>;
  try {
    parsed = (jsYaml.load(escaped) as Record<string, unknown>) || {};
  } catch (err) {
    throw new Error(`Failed to parse ${templatePath}: ${err}`);
  }

  for (const field of fields) {
    const expr = buildSingleExpression(field.singleKey, field.currentValue);
    setNestedValue(parsed, field.dotPath.split("."), expr);
  }

  const dumped = jsYaml.dump(parsed, { lineWidth: 200, noRefs: true, sortKeys: false });
  const unescaped = unescapeStringVars(dumped, map);
  fs.writeFileSync(templatePath, unescaped, "utf-8");
}

export const dbTemplateRestoreFixer: Fixer = {
  name: "db-template-restore",
  description:
    "Scans single.en.yml templates for DB-backed content types and restores hardcoded values to {{ entry.X | default }} expressions",

  async run(ctx: FixerContext): Promise<FixerResult> {
    const dryRun = ctx.dryRun !== false;
    const allConfigs = getAllConfigs();

    const allFindings: HardcodedField[] = [];
    const checkedTypes: string[] = [];

    for (const [typeName] of Object.entries(allConfigs)) {
      const dbName = getDatabaseName(typeName);
      if (!dbName) continue;

      const fieldMapping = getFieldMapping(typeName);
      if (!fieldMapping) continue;

      checkedTypes.push(typeName);
      const fieldMappingKeys = new Set(Object.keys(fieldMapping));
      const dir = path.join(MARKETING_CONTENT_DIR, allConfigs[typeName].directory);

      for (const fileName of ["single.en.yml", "single.es.yml"]) {
        const templatePath = path.join(dir, fileName);
        if (!fs.existsSync(templatePath)) continue;

        const findings = detectHardcodedFields(typeName, templatePath, fieldMappingKeys);
        allFindings.push(...findings);
      }
    }

    if (allFindings.length === 0) {
      return {
        ok: true,
        message: "No hardcoded template fields found — all single.en.yml templates look correct",
        details: { checkedTypes },
      };
    }

    const summary = allFindings.map(f => ({
      file: f.templateFile,
      field: f.dotPath,
      currentValue:
        f.currentValue.length > 100
          ? f.currentValue.slice(0, 100) + "..."
          : f.currentValue,
      willBecome: f.suggestedExpression,
    }));

    if (dryRun) {
      return {
        ok: true,
        message: `Found ${allFindings.length} hardcoded field(s) that should be template expressions. Run with dryRun=false to fix.`,
        details: { dryRun: true, findings: summary },
      };
    }

    const byFile = new Map<string, HardcodedField[]>();
    for (const f of allFindings) {
      const absPath = path.join(process.cwd(), f.templateFile);
      if (!byFile.has(absPath)) byFile.set(absPath, []);
      byFile.get(absPath)!.push(f);
    }

    const errors: string[] = [];
    let fixedCount = 0;

    for (const [absPath, fields] of byFile) {
      try {
        applyFix(absPath, fields);
        fixedCount += fields.length;
        console.log(
          `[Fixer:db-template-restore] Fixed ${fields.length} field(s) in ${path.relative(process.cwd(), absPath)}`,
        );
      } catch (err) {
        errors.push(
          `${path.relative(process.cwd(), absPath)}: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }

    if (errors.length > 0) {
      return {
        ok: false,
        message: `Fixed ${fixedCount} field(s) but encountered errors in ${errors.length} file(s)`,
        details: { fixedCount, errors, findings: summary },
      };
    }

    return {
      ok: true,
      message: `Restored ${fixedCount} hardcoded field(s) to {{ entry.X | default }} expressions`,
      details: { fixedCount, fixed: summary },
    };
  },
};
