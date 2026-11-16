/**
 * Write rules for /api/variables: description + category are required on every
 * create/update/rename, and figure-category value changes need an explicit confirm.
 */

import {
  isFigureCategory,
  isSystemManagedVariable,
  isVariableCategory,
  isVariableSource,
  isVariableUnit,
  normalizeVariableProducts,
  VARIABLE_CATEGORIES,
  VARIABLE_SOURCES,
  VARIABLE_UNITS,
} from "@shared/variable-metadata";
import type { VariableDefinition, VariableMetadataPatch } from "./variable-manager";

export type VariableWriteAction =
  | "set_default"
  | "add_condition"
  | "update_condition"
  | "delete_condition"
  | "reorder_conditions"
  | "set_metadata"
  | "rename";

export type VariableWriteRejection = {
  ok: false;
  status: 400 | 409;
  code:
    | "description_required"
    | "category_required"
    | "invalid_category"
    | "invalid_unit"
    | "invalid_source"
    | "invalid_products"
    | "replaced_by_unknown"
    | "confirm_figure_change";
  error: string;
  details?: Record<string, unknown>;
};

export type VariableWriteDecision =
  | { ok: true; metadataPatch: VariableMetadataPatch | null }
  | VariableWriteRejection;

const VALUE_ACTIONS = new Set<VariableWriteAction>(["set_default", "add_condition", "update_condition"]);
const METADATA_REQUIRED_ACTIONS = new Set<VariableWriteAction>([
  "set_default",
  "add_condition",
  "update_condition",
  "reorder_conditions",
  "set_metadata",
  "rename",
]);

function str(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

export type MetadataInputResult =
  | { ok: true; patch: VariableMetadataPatch | null }
  | {
      ok: false;
      status: 400;
      code: "invalid_products";
      error: string;
    };

/** Metadata fields from `body.metadata` (any action) or the body itself (`set_metadata`). */
export function readMetadataInput(
  action: VariableWriteAction,
  body: Record<string, unknown>,
): MetadataInputResult {
  const source =
    body.metadata && typeof body.metadata === "object"
      ? (body.metadata as Record<string, unknown>)
      : action === "set_metadata"
        ? body
        : null;
  if (!source) return { ok: true, patch: null };
  const patch: VariableMetadataPatch = {};
  if (str(source.description) !== undefined) patch.description = str(source.description);
  if (str(source.category) !== undefined) patch.category = str(source.category);
  if ("unit" in source) patch.unit = str(source.unit) ?? null;
  if ("source" in source) patch.source = str(source.source) ?? null;
  if ("products" in source) {
    if (source.products == null) {
      patch.products = null;
    } else if (Array.isArray(source.products) && source.products.every((p) => typeof p === "string")) {
      patch.products = normalizeVariableProducts(source.products) ?? [];
    } else {
      return {
        ok: false,
        status: 400,
        code: "invalid_products",
        error: 'products must be a list of product content slugs (e.g. ["ai-flex", "full-stack"]).',
      };
    }
  }
  if (typeof source.deprecated === "boolean") patch.deprecated = source.deprecated;
  if ("replaced_by" in source) patch.replaced_by = str(source.replaced_by) ?? null;
  return { ok: true, patch: Object.keys(patch).length > 0 ? patch : null };
}

function conditionKey(query: Record<string, string> | undefined): string {
  if (!query) return "";
  return Object.keys(query)
    .sort()
    .map((k) => `${k}=${query[k]}`)
    .join("&");
}

/** Old/new value pair for a value write, or null when nothing a visitor sees would change. */
export function figureValueChange(
  action: VariableWriteAction,
  existing: VariableDefinition | null,
  body: Record<string, unknown>,
): { old_value: string | null; new_value: string; condition?: Record<string, string> } | null {
  if (!existing) return null;
  if (action === "set_default") {
    const next = str(body.value);
    if (next === undefined) return null;
    const prev = existing.default ?? null;
    return prev === next ? null : { old_value: prev, new_value: next };
  }
  const condition = body.condition as { query?: Record<string, string>; value?: string } | undefined;
  if (!condition || typeof condition.value !== "string") return null;
  if (action === "add_condition") {
    return { old_value: null, new_value: condition.value, condition: condition.query };
  }
  if (action === "update_condition") {
    const index = typeof body.index === "number" ? body.index : -1;
    const prev = existing.conditions?.[index];
    if (!prev) return null;
    const sameQuery = conditionKey(prev.query) === conditionKey(condition.query);
    if (sameQuery && prev.value === condition.value) return null;
    return { old_value: prev.value, new_value: condition.value, condition: condition.query };
  }
  return null;
}

export function evaluateVariableWrite(opts: {
  name: string;
  action: VariableWriteAction;
  existing: VariableDefinition | null;
  body: Record<string, unknown>;
  knownNames: string[];
  usageCount: () => number;
}): VariableWriteDecision {
  const { name, action, existing, body } = opts;
  if (isSystemManagedVariable(name, existing)) return { ok: true, metadataPatch: null };
  if (!METADATA_REQUIRED_ACTIONS.has(action)) return { ok: true, metadataPatch: null };

  const metaInput = readMetadataInput(action, body);
  if (!metaInput.ok) return metaInput;
  const patch = metaInput.patch;
  const merged = {
    description: (patch?.description ?? existing?.description ?? "").trim(),
    category: (patch?.category ?? existing?.category ?? "").trim(),
    deprecated: patch?.deprecated ?? existing?.deprecated ?? false,
  };

  if (!merged.description) {
    return {
      ok: false,
      status: 400,
      code: "description_required",
      error: existing
        ? `"${name}" has no description yet. Add one before saving — writers and agents use it to pick the right fact.`
        : "Add a description for the new variable before saving.",
    };
  }
  if (!merged.category) {
    return {
      ok: false,
      status: 400,
      code: "category_required",
      error: existing
        ? `"${name}" has no category yet. Pick one before saving — reviewers use it to decide how carefully to check changes.`
        : "Pick a category for the new variable before saving.",
      details: { valid_categories: [...VARIABLE_CATEGORIES] },
    };
  }
  if (!isVariableCategory(merged.category)) {
    return {
      ok: false,
      status: 400,
      code: "invalid_category",
      error: `Unknown category "${merged.category}".`,
      details: { valid_categories: [...VARIABLE_CATEGORIES] },
    };
  }
  if (patch?.unit && !isVariableUnit(patch.unit)) {
    return {
      ok: false,
      status: 400,
      code: "invalid_unit",
      error: `Unknown unit "${patch.unit}".`,
      details: { valid_units: [...VARIABLE_UNITS] },
    };
  }
  if (patch?.source && !isVariableSource(patch.source)) {
    return {
      ok: false,
      status: 400,
      code: "invalid_source",
      error: `Unknown source "${patch.source}".`,
      details: { valid_sources: [...VARIABLE_SOURCES] },
    };
  }
  if (patch?.replaced_by && merged.deprecated) {
    const target = patch.replaced_by.trim();
    if (target === name || !opts.knownNames.includes(target)) {
      return {
        ok: false,
        status: 400,
        code: "replaced_by_unknown",
        error: `Replacement "${target}" is not another existing variable.`,
      };
    }
  }

  if (VALUE_ACTIONS.has(action) && isFigureCategory(merged.category) && body.confirm_figure_change !== true) {
    const change = figureValueChange(action, existing, body);
    if (change) {
      return {
        ok: false,
        status: 409,
        code: "confirm_figure_change",
        error: `"${name}" is a ${merged.category.replace("_", " ")} figure. Confirm the new value before saving.`,
        details: { usage_count: opts.usageCount(), ...change },
      };
    }
  }

  return { ok: true, metadataPatch: patch };
}
