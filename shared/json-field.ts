/**
 * Parse / coerce / schema-validate content-type `editor.type: json` fields.
 * Platform-generic — no consumer-specific shapes (FAQ, etc.).
 *
 * Uses a browser-safe JSON Schema subset validator (no Ajv/CJS) so the same
 * module works in Vite client bundles and on the server.
 */

import {
  ENTRY_OR_SINGLE_VAR_PATTERN,
  EXACT_ENTRY_OR_SINGLE_VAR_PATTERN,
} from "./entryTemplateVars";

export type JsonSchema = Record<string, unknown>;

export type JsonFieldParseOk = { ok: true; value: unknown };
export type JsonFieldParseErr = { ok: false; error: string };
export type JsonFieldParseResult = JsonFieldParseOk | JsonFieldParseErr;

export type JsonSchemaError = {
  path: string;
  message: string;
};

export type JsonValidateOk = { ok: true };
export type JsonValidateErr = {
  ok: false;
  errors: JsonSchemaError[];
  schema: JsonSchema;
};
export type JsonValidateResult = JsonValidateOk | JsonValidateErr;

export type CoerceJsonOk = { ok: true; value: unknown };
export type CoerceJsonErr = {
  ok: false;
  error: string;
  errors?: JsonSchemaError[];
  schema?: JsonSchema;
};
export type CoerceJsonResult = CoerceJsonOk | CoerceJsonErr;

/** Empty / whitespace editor text → null (unset). Otherwise JSON.parse. */
export function parseJsonFieldText(text: string): JsonFieldParseResult {
  const trimmed = text.trim();
  if (trimmed === "") return { ok: true, value: null };
  try {
    return { ok: true, value: JSON.parse(trimmed) as unknown };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Invalid JSON",
    };
  }
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}

/**
 * Structural check that a document looks like a usable JSON Schema object.
 * Does not pull Ajv into the client bundle.
 */
export function compileJsonSchema(
  schema: unknown,
): { ok: true; schema: JsonSchema } | { ok: false; error: string } {
  if (!isPlainObject(schema)) {
    return { ok: false, error: "Schema must be a JSON object" };
  }
  const walk = (node: unknown, path: string): string | null => {
    if (!isPlainObject(node)) {
      return `${path || "/"}: schema node must be an object`;
    }
    if (node.type !== undefined) {
      const t = node.type;
      const okType =
        typeof t === "string" ||
        (Array.isArray(t) && t.every((x) => typeof x === "string"));
      if (!okType) return `${path || "/"}: type must be a string or string[]`;
    }
    if (node.properties !== undefined) {
      if (!isPlainObject(node.properties)) {
        return `${path || "/"}: properties must be an object`;
      }
      for (const [k, child] of Object.entries(node.properties)) {
        const err = walk(child, `${path}/${k}`);
        if (err) return err;
      }
    }
    if (node.items !== undefined) {
      if (Array.isArray(node.items)) {
        for (let i = 0; i < node.items.length; i++) {
          const err = walk(node.items[i], `${path}/items/${i}`);
          if (err) return err;
        }
      } else {
        const err = walk(node.items, `${path}/items`);
        if (err) return err;
      }
    }
    if (node.required !== undefined) {
      if (!Array.isArray(node.required) || !node.required.every((x) => typeof x === "string")) {
        return `${path || "/"}: required must be an array of strings`;
      }
    }
    return null;
  };
  const err = walk(schema, "");
  if (err) return { ok: false, error: err };
  return { ok: true, schema: schema as JsonSchema };
}

function typeMatches(value: unknown, typeName: string): boolean {
  switch (typeName) {
    case "object":
      return isPlainObject(value);
    case "array":
      return Array.isArray(value);
    case "string":
      return typeof value === "string";
    case "number":
      return typeof value === "number" && Number.isFinite(value);
    case "integer":
      return typeof value === "number" && Number.isInteger(value);
    case "boolean":
      return typeof value === "boolean";
    case "null":
      return value === null;
    default:
      return true;
  }
}

function validateNode(
  value: unknown,
  schema: JsonSchema,
  path: string,
  errors: JsonSchemaError[],
): void {
  const type = schema.type;
  if (typeof type === "string") {
    if (!typeMatches(value, type)) {
      errors.push({ path, message: `must be ${type}` });
      return;
    }
  } else if (Array.isArray(type)) {
    if (!type.some((t) => typeof t === "string" && typeMatches(value, t))) {
      errors.push({ path, message: `must be ${type.join(" | ")}` });
      return;
    }
  }

  if (Array.isArray(schema.enum)) {
    const ok = schema.enum.some((e) => Object.is(e, value) || JSON.stringify(e) === JSON.stringify(value));
    if (!ok) {
      errors.push({ path, message: "must be equal to one of the enum values" });
      return;
    }
  }

  if (isPlainObject(value) && isPlainObject(schema.properties)) {
    const required = Array.isArray(schema.required)
      ? schema.required.filter((k): k is string => typeof k === "string")
      : [];
    for (const key of required) {
      if (!Object.prototype.hasOwnProperty.call(value, key)) {
        errors.push({ path: `${path}/${key}`, message: "is required" });
      }
    }
    for (const [key, childSchema] of Object.entries(schema.properties)) {
      if (!Object.prototype.hasOwnProperty.call(value, key)) continue;
      if (isPlainObject(childSchema)) {
        validateNode(value[key], childSchema, `${path}/${key}`, errors);
      }
    }
    if (schema.additionalProperties === false) {
      for (const key of Object.keys(value)) {
        if (!Object.prototype.hasOwnProperty.call(schema.properties, key)) {
          errors.push({ path: `${path}/${key}`, message: "must NOT have additional properties" });
        }
      }
    } else if (isPlainObject(schema.additionalProperties)) {
      for (const key of Object.keys(value)) {
        if (Object.prototype.hasOwnProperty.call(schema.properties, key)) continue;
        validateNode(value[key], schema.additionalProperties, `${path}/${key}`, errors);
      }
    }
  }

  if (Array.isArray(value) && schema.items !== undefined) {
    if (isPlainObject(schema.items)) {
      value.forEach((item, i) => validateNode(item, schema.items as JsonSchema, `${path}/${i}`, errors));
    } else if (Array.isArray(schema.items)) {
      schema.items.forEach((itemSchema, i) => {
        if (i >= value.length) return;
        if (isPlainObject(itemSchema)) {
          validateNode(value[i], itemSchema, `${path}/${i}`, errors);
        }
      });
    }
    if (typeof schema.minItems === "number" && value.length < schema.minItems) {
      errors.push({ path, message: `must NOT have fewer than ${schema.minItems} items` });
    }
    if (typeof schema.maxItems === "number" && value.length > schema.maxItems) {
      errors.push({ path, message: `must NOT have more than ${schema.maxItems} items` });
    }
  }
}

export function validateJsonAgainstSchema(
  value: unknown,
  schema: JsonSchema,
): JsonValidateResult {
  const compiled = compileJsonSchema(schema);
  if (!compiled.ok) {
    return {
      ok: false,
      errors: [{ path: "", message: compiled.error }],
      schema,
    };
  }
  const errors: JsonSchemaError[] = [];
  validateNode(value, compiled.schema, "", errors);
  if (errors.length === 0) return { ok: true };
  return { ok: false, errors, schema: compiled.schema };
}

/**
 * Coerce API/MCP input: strings are parsed once; then validated when schema is provided.
 * `null` is allowed without schema checks (clear/unset).
 */
export function coerceJsonFieldInput(
  raw: unknown,
  schema?: JsonSchema | null,
): CoerceJsonResult {
  let value: unknown = raw;
  if (typeof raw === "string") {
    const parsed = parseJsonFieldText(raw);
    if (!parsed.ok) return { ok: false, error: parsed.error };
    value = parsed.value;
  }

  if (value === null || value === undefined) {
    return { ok: true, value: null };
  }

  if (!schema || typeof schema !== "object" || Array.isArray(schema)) {
    return {
      ok: false,
      error: "json fields require a compilable editor.schema",
    };
  }

  const result = validateJsonAgainstSchema(value, schema as JsonSchema);
  if (!result.ok) {
    return {
      ok: false,
      error: result.errors.map((e) => `${e.path || "/"}: ${e.message}`).join("; "),
      errors: result.errors,
      schema: result.schema,
    };
  }
  return { ok: true, value };
}

/**
 * Exact-match template pipe fallback: if the trimmed string parses as JSON
 * (array/object/null/bool/number), return that value; otherwise return the string.
 * Used by resolveSingleVars / resolveBagVars / client variable-manager.
 */
export function parsePipeFallback(fallback: string): unknown {
  const trimmed = fallback.trim();
  if (trimmed === "") return "";
  try {
    return JSON.parse(trimmed) as unknown;
  } catch {
    return trimmed;
  }
}

function getNestedBagValue(obj: Record<string, unknown>, dotPath: string): unknown {
  const parts = dotPath.split(".");
  let current: unknown = obj;
  for (const part of parts) {
    if (current === null || current === undefined) return undefined;
    if (typeof current !== "object") return undefined;
    current = (current as Record<string, unknown>)[part];
  }
  return current;
}

/**
 * Resolve `{{ entry.* }}` / legacy `{{ single.* }}` tokens against a bag
 * (exact match keeps structured values like FAQ JSON arrays; inline
 * interpolation stringifies objects). Used by dynamic_entries (before
 * resolveSingleVars) and FAQ editor preview.
 */
export function resolveSingleTemplateValue(
  template: unknown,
  bag: Record<string, unknown>,
): unknown {
  if (typeof template === "string") {
    const exactMatch = template.match(EXACT_ENTRY_OR_SINGLE_VAR_PATTERN);
    if (exactMatch) {
      const fieldPath = exactMatch[1];
      const hasFallback = exactMatch[2] !== undefined;
      const fallback = exactMatch[2]?.trim();
      const value = getNestedBagValue(bag, fieldPath);
      if (value !== undefined && value !== null) return value;
      if (hasFallback) return parsePipeFallback(fallback ?? "");
      return "";
    }

    const globalPattern = new RegExp(
      ENTRY_OR_SINGLE_VAR_PATTERN.source,
      ENTRY_OR_SINGLE_VAR_PATTERN.flags,
    );
    if (!globalPattern.test(template)) return template;
    globalPattern.lastIndex = 0;

    return template.replace(
      globalPattern,
      (_match, fieldPath: string, fallback?: string) => {
        const value = getNestedBagValue(bag, fieldPath);
        if (value !== undefined && value !== null) {
          if (typeof value === "object") return JSON.stringify(value);
          return String(value);
        }
        if (fallback !== undefined) return fallback.trim();
        return "";
      },
    );
  }

  if (Array.isArray(template)) {
    return template.map((t) => resolveSingleTemplateValue(t, bag));
  }

  if (template !== null && typeof template === "object") {
    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(template as Record<string, unknown>)) {
      result[key] = resolveSingleTemplateValue(value, bag);
    }
    return result;
  }

  return template;
}

/** Pretty-print structured value for the json CodeMirror draft. */
export function formatJsonFieldDraft(value: unknown): string {
  if (value === null || value === undefined) return "";
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}
