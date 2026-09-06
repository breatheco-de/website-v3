/**
 * Validate / coerce `editor.type: json` fields in save payloads.
 */
import {
  coerceJsonFieldInput,
  compileJsonSchema,
  type JsonSchema,
} from "@shared/json-field";
import { validateCallToActionSemantics } from "@shared/call-to-action-field";
import type { ContentTypeEditorHint } from "./content-types";

export type JsonFieldValidationFailure = {
  field: string;
  error: string;
  errors?: Array<{ path: string; message: string }>;
  schema?: JsonSchema;
};

export type ValidateJsonFieldsResult =
  | { ok: true; fields: Record<string, unknown> }
  | { ok: false; failures: JsonFieldValidationFailure[] };

export type JsonFieldSemanticContext = {
  /** Known tracking.conversion_events names */
  conversionNames?: string[];
  /** tracking.leads_expected_tags CRM allowlist */
  crmTags?: string[];
};

export function validateEditorHintsHaveJsonSchemas(
  editor: Record<string, ContentTypeEditorHint | { type?: string; schema?: unknown }> | undefined | null,
): { ok: true } | { ok: false; error: string; field?: string } {
  if (!editor || typeof editor !== "object") return { ok: true };
  for (const [field, hint] of Object.entries(editor)) {
    if (!hint || hint.type !== "json") continue;
    if (!hint.schema || typeof hint.schema !== "object" || Array.isArray(hint.schema)) {
      return {
        ok: false,
        field,
        error: `editor.${field}: type json requires a compilable schema object`,
      };
    }
    const compiled = compileJsonSchema(hint.schema);
    if (!compiled.ok) {
      return { ok: false, field, error: `editor.${field}: ${compiled.error}` };
    }
  }
  return { ok: true };
}

/**
 * For each key in `fields` whose editor type is json: coerce (parse string once) + schema-validate.
 * Non-json keys pass through unchanged. Missing editor type → pass through.
 * When `semantics` is provided, `call_to_action` also checks conversion_name + CRM tags.
 */
export function validateAndCoerceJsonFields(
  fields: Record<string, unknown>,
  editor: Record<string, { type?: string; schema?: unknown }> | undefined | null,
  semantics?: JsonFieldSemanticContext,
): ValidateJsonFieldsResult {
  if (!editor) return { ok: true, fields: { ...fields } };
  const out: Record<string, unknown> = { ...fields };
  const failures: JsonFieldValidationFailure[] = [];

  for (const [field, raw] of Object.entries(fields)) {
    const hint = editor[field];
    if (!hint || hint.type !== "json") continue;
    const schema =
      hint.schema && typeof hint.schema === "object" && !Array.isArray(hint.schema)
        ? (hint.schema as JsonSchema)
        : null;
    const coerced = coerceJsonFieldInput(raw, schema);
    if (!coerced.ok) {
      failures.push({
        field,
        error: coerced.error,
        errors: coerced.errors,
        schema: coerced.schema ?? (schema ?? undefined),
      });
      continue;
    }
    out[field] = coerced.value;

    if (field === "call_to_action" && semantics) {
      const semantic = validateCallToActionSemantics(coerced.value, {
        conversionNames: semantics.conversionNames ?? [],
        crmTags: semantics.crmTags ?? [],
      });
      if (!semantic.ok) {
        failures.push({ field, error: semantic.error });
      }
    }
  }

  if (failures.length > 0) return { ok: false, failures };
  return { ok: true, fields: out };
}

export function jsonFieldFailureHttpBody(failures: JsonFieldValidationFailure[]) {
  const first = failures[0];
  return {
    error: first
      ? `Invalid json field "${first.field}": ${first.error}`
      : "Invalid json field(s)",
    details: failures,
    schema: first?.schema,
    errors: first?.errors,
  };
}

/** Structural YAML keys that are never entry Fields JSON. */
const NON_FIELD_ROOTS = new Set(["sections", "layout", "meta"]);

/** Root field keys touched by dotted update paths (e.g. call_to_action.title → call_to_action). */
export function rootFieldKeysFromTouchedPaths(paths: string[]): string[] {
  const keys = new Set<string>();
  for (const p of paths) {
    if (!p || typeof p !== "string") continue;
    const root = p.split(".")[0]?.trim();
    if (!root || NON_FIELD_ROOTS.has(root)) continue;
    keys.add(root);
  }
  return Array.from(keys);
}

/**
 * When a touched Field has editor.type json + schema, coerce/validate the post-merge
 * document value. Clears (null/undefined / missing) skip schema. Returns coerced
 * subset to write back onto the document.
 */
export function validateTouchedJsonFieldsInDocument(
  data: Record<string, unknown>,
  touchedPaths: string[],
  editor: Record<string, { type?: string; schema?: unknown }> | undefined | null,
  semantics?: JsonFieldSemanticContext,
): ValidateJsonFieldsResult {
  if (!editor) return { ok: true, fields: {} };
  const subset: Record<string, unknown> = {};
  for (const key of rootFieldKeysFromTouchedPaths(touchedPaths)) {
    const hint = editor[key];
    if (!hint || hint.type !== "json") continue;
    if (!hint.schema || typeof hint.schema !== "object" || Array.isArray(hint.schema)) {
      continue;
    }
    if (!(key in data) || data[key] === undefined || data[key] === null) continue;
    subset[key] = data[key];
  }
  if (Object.keys(subset).length === 0) return { ok: true, fields: {} };
  return validateAndCoerceJsonFields(subset, editor, semantics);
}
