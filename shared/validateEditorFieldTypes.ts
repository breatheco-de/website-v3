/**
 * Content-type Fields: editor config + value shape/schema checks.
 * Emptiness is required-fields; mapping source presence is field-mappings;
 * relation slug existence is relation-targets.
 */

import {
  coerceJsonFieldInput,
  compileJsonSchema,
  type JsonSchema,
} from "./json-field";
import { coerceRelationFieldInput, type RelationEditorHint } from "./relation-field";
import { parseFlexibleDate } from "./normalizeFlexibleDate";

export const SAFE_EDITOR_TYPES = new Set([
  "text",
  "textarea",
  "markdown",
  "tags",
  "select",
  "datetime",
  "date",
  "image",
  "pdf",
  "boolean",
  "number",
  "json",
  "relation",
]);

const SYSTEM_SPECIALS = new Set([
  "_slug",
  "_locale",
  "_hreflangs",
  "_updated_at",
  "_image",
]);

const SKIP_WITHOUT_EDITOR = new Set(["published_at", ...SYSTEM_SPECIALS]);

const TEMPLATE_RE = /\{\{[\s\S]*?\}\}/;

export type EditorHint = {
  type?: string;
  options?: (string | { value: string; label: string })[];
  populate_options?: boolean;
  allow_custom_values?: boolean;
  split_comma_values?: boolean;
  required?: boolean | "attached";
  schema?: Record<string, unknown>;
  source?: string;
  value?: string;
  label?: string;
  multiple?: boolean;
  description?: string;
};

export type FieldMappingValue = string | { source: string; default: string | null };

export type EditorFieldIssue = {
  severity: "error" | "warning";
  code: string;
  field?: string;
  message: string;
  suggestion?: string;
};

export function mergeEditorHints(
  ctEditor?: Record<string, EditorHint> | null,
  dbEditor?: Record<string, EditorHint> | null,
): Record<string, EditorHint> {
  return { ...(dbEditor || {}), ...(ctEditor || {}) };
}

export function mappingSourceString(value: FieldMappingValue | undefined): string {
  if (!value) return "";
  return typeof value === "object" ? value.source : value;
}

export function mappingDefault(
  value: FieldMappingValue | undefined,
): string | null | undefined {
  if (value && typeof value === "object" && "default" in value) return value.default;
  return undefined;
}

export function isTemplateValue(value: unknown): boolean {
  return typeof value === "string" && TEMPLATE_RE.test(value);
}

/** Skip type checks: unset, blank, or empty array (required-fields owns emptiness). */
export function isSkippedEmptyValue(value: unknown): boolean {
  if (value === undefined || value === null) return true;
  if (typeof value === "string" && value.trim() === "") return true;
  if (Array.isArray(value) && value.length === 0) return true;
  return false;
}

export function isSkippedMappingSource(source: string): boolean {
  return source.startsWith("function:") || source.startsWith("?");
}

/** System specials / published_at: only check when editor hint exists. */
export function skipFieldWithoutEditor(field: string, editor: Record<string, EditorHint>): boolean {
  if (!SKIP_WITHOUT_EDITOR.has(field) && !field.startsWith("_")) return false;
  const hint = editor[field];
  return !hint || typeof hint !== "object";
}

export function extractByDotPath(obj: unknown, dotPath: string): unknown {
  let current = obj;
  const segments = dotPath.split(".");
  for (const key of segments) {
    if (current == null || typeof current !== "object") return undefined;
    current = (current as Record<string, unknown>)[key];
  }
  return current;
}

function selectOptionValues(hint: EditorHint): string[] {
  const opts = hint.options;
  if (!Array.isArray(opts)) return [];
  return opts.map((o) => (typeof o === "string" ? o : String(o?.value ?? "")));
}

function isNumericString(s: string): boolean {
  const t = s.trim();
  if (!t || t === "+" || t === "-" || t === ".") return false;
  if (!/^[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?$/.test(t)) return false;
  return Number.isFinite(Number(t));
}

export function validateEditorConfig(
  editor: Record<string, EditorHint> | null | undefined,
  fieldMapping: Record<string, FieldMappingValue> | null | undefined,
): EditorFieldIssue[] {
  const issues: EditorFieldIssue[] = [];
  const hints = editor && typeof editor === "object" ? editor : {};
  const mapping = fieldMapping && typeof fieldMapping === "object" ? fieldMapping : {};

  const mappingKeys = new Set(Object.keys(mapping).filter((k) => !k.startsWith("_") || hints[k]));

  for (const [field, hint] of Object.entries(hints)) {
    if (!hint || typeof hint !== "object") continue;
    if (!mapping[field] && !field.startsWith("_")) {
      issues.push({
        severity: "warning",
        code: "EDITOR_ORPHAN_HINT",
        field,
        message: `editor.${field} has no matching field_mapping key`,
        suggestion: `Add "${field}" to field_mapping or remove the editor hint`,
      });
    }
    const type = hint.type;
    if (!type) continue;
    if (!SAFE_EDITOR_TYPES.has(type)) {
      issues.push({
        severity: "error",
        code: "EDITOR_TYPE_UNKNOWN",
        field,
        message: `editor.${field}: unknown type "${type}"`,
        suggestion: `Use one of: ${[...SAFE_EDITOR_TYPES].join(", ")}`,
      });
      continue;
    }
    if (type === "json") {
      if (!hint.schema || typeof hint.schema !== "object" || Array.isArray(hint.schema)) {
        issues.push({
          severity: "error",
          code: "EDITOR_JSON_SCHEMA_MISSING",
          field,
          message: `editor.${field}: type json requires a compilable schema object`,
        });
      } else {
        const compiled = compileJsonSchema(hint.schema);
        if (!compiled.ok) {
          issues.push({
            severity: "error",
            code: "EDITOR_JSON_SCHEMA_MISSING",
            field,
            message: `editor.${field}: ${compiled.error}`,
          });
        }
      }
    }
    if (type === "relation") {
      if (!hint.source || typeof hint.source !== "string" || !hint.source.trim()) {
        issues.push({
          severity: "error",
          code: "EDITOR_RELATION_SOURCE_MISSING",
          field,
          message: `editor.${field}: type relation requires a non-empty source (content type or database slug)`,
        });
      }
    }
  }

  for (const key of mappingKeys) {
    if (skipFieldWithoutEditor(key, hints)) continue;
    const hint = hints[key];
    if (!hint?.type) {
      issues.push({
        severity: "warning",
        code: "EDITOR_TYPE_MISSING",
        field: key,
        message: `field_mapping "${key}" has no editor.type`,
        suggestion: `Set editor.${key}.type in content-types.yml (or the attached database editor)`,
      });
    }
    const rawMapping = mapping[key];
    const def = mappingDefault(rawMapping);
    if (def !== undefined && def !== null && hint?.type) {
      const defIssues = validateEditorFieldValue(key, def, hint);
      for (const issue of defIssues) {
        issues.push({
          ...issue,
          message: `field_mapping.${key}.default: ${issue.message}`,
        });
      }
    }
  }

  return issues;
}

export function validateEditorFieldValue(
  field: string,
  value: unknown,
  hint: EditorHint | null | undefined,
): EditorFieldIssue[] {
  if (!hint?.type) return [];
  if (isSkippedEmptyValue(value)) return [];
  if (isTemplateValue(value)) return [];

  const type = hint.type;
  if (!SAFE_EDITOR_TYPES.has(type)) return [];

  if (type === "json") {
    const schema =
      hint.schema && typeof hint.schema === "object" && !Array.isArray(hint.schema)
        ? (hint.schema as JsonSchema)
        : null;
    const coerced = coerceJsonFieldInput(value, schema);
    if (!coerced.ok) {
      return [
        {
          severity: "error",
          code: "FIELD_JSON_INVALID",
          field,
          message: `Invalid json field "${field}": ${coerced.error}`,
          suggestion: "Fix the value to match editor.<field>.schema",
        },
      ];
    }
    if (typeof value === "string") {
      return [
        {
          severity: "warning",
          code: "FIELD_JSON_STORED_AS_STRING",
          field,
          message: `json field "${field}" is stored as a string (parsed OK); prefer a YAML object/array`,
        },
      ];
    }
    return [];
  }

  if (type === "relation") {
    const coerced = coerceRelationFieldInput(value, hint as RelationEditorHint);
    if (!coerced.ok) {
      return [
        {
          severity: "error",
          code: "FIELD_RELATION_INVALID",
          field,
          message: `Invalid relation field "${field}": ${coerced.error}`,
          suggestion: "Store a slug string or string[] of slugs, not related entry objects",
        },
      ];
    }
    return [];
  }

  const mismatch = (message: string): EditorFieldIssue[] => [
    {
      severity: "warning",
      code: "FIELD_TYPE_MISMATCH",
      field,
      message,
      suggestion: `Use a ${type}-shaped value for "${field}"`,
    },
  ];

  if (type === "number") {
    if (typeof value === "number" && Number.isFinite(value)) return [];
    if (typeof value === "string" && isNumericString(value)) return [];
    return mismatch(`Field "${field}" should be a finite number (got ${describeType(value)})`);
  }

  if (type === "boolean") {
    if (typeof value === "boolean") return [];
    if (typeof value === "string") {
      const t = value.trim().toLowerCase();
      if (t === "true" || t === "false") return [];
    }
    return mismatch(`Field "${field}" should be a boolean (got ${describeType(value)})`);
  }

  if (type === "tags") {
    if (Array.isArray(value)) {
      if (value.every((el) => typeof el === "string")) return [];
      return mismatch(`Field "${field}" tags array items must be strings`);
    }
    if (typeof value === "string") {
      if (value.includes(",") && hint.split_comma_values !== true) {
        return mismatch(
          `Field "${field}" looks like CSV but split_comma_values is not set; use a string[] or enable split_comma_values`,
        );
      }
      return [];
    }
    return mismatch(`Field "${field}" should be a string or string[] of tags`);
  }

  if (type === "select") {
    if (typeof value !== "string") {
      return mismatch(`Field "${field}" should be a string (select)`);
    }
    const staticEnum =
      selectOptionValues(hint).length > 0 &&
      hint.populate_options !== true &&
      hint.allow_custom_values !== true;
    if (staticEnum) {
      const allowed = selectOptionValues(hint);
      if (!allowed.includes(value)) {
        return mismatch(
          `Field "${field}" value "${value}" is not in editor.options (${allowed.join(", ")})`,
        );
      }
    }
    return [];
  }

  if (type === "date" || type === "datetime") {
    if (parseFlexibleDate(value) == null) {
      return mismatch(`Field "${field}" is not a valid ${type}`);
    }
    return [];
  }

  if (type === "image" || type === "pdf") {
    if (typeof value !== "string") {
      return mismatch(`Field "${field}" should be a string (${type} pointer)`);
    }
    return [];
  }

  if (type === "text" || type === "textarea" || type === "markdown") {
    if (typeof value !== "string") {
      return mismatch(`Field "${field}" should be a string (${type})`);
    }
    return [];
  }

  return [];
}

function describeType(value: unknown): string {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  return typeof value;
}
