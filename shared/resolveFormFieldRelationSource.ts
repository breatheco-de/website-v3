/**
 * Resolve lead-form options from an entry content-type relation field.
 * Accepts pointer slug[] or hydrated related objects (SSR).
 */

import {
  deslugifyLabel,
  isRelationEditorHint,
  normalizeRelationPointers,
  type RelationEditorHint,
} from "./relation-field";

export type FormFieldOption = {
  value: string;
  label: string;
  /** Prefer for CRM submit when present */
  bc_slug?: string;
};

export type ResolveFormFieldRelationSourceOk = {
  ok: true;
  options: FormFieldOption[];
  relationField: string;
};

export type ResolveFormFieldRelationSourceErr = {
  ok: false;
  error: string;
  /** Friendly staff-facing message */
  staffMessage: string;
  relationField: string;
  formFieldName?: string;
  /** Broken pointer slug when applicable */
  badPointer?: string;
  code:
    | "missing_hint"
    | "not_relation"
    | "empty"
    | "invalid_shape"
    | "broken_pointer";
};

export type ResolveFormFieldRelationSourceResult =
  | ResolveFormFieldRelationSourceOk
  | ResolveFormFieldRelationSourceErr;

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}

function pickString(obj: Record<string, unknown>, path: string): string | undefined {
  if (!path.includes(".")) {
    const v = obj[path];
    if (typeof v === "string" && v.trim()) return v.trim();
    return undefined;
  }
  const parts = path.split(".");
  let cur: unknown = obj;
  for (const part of parts) {
    if (!isPlainObject(cur)) return undefined;
    cur = cur[part];
  }
  return typeof cur === "string" && cur.trim() ? cur.trim() : undefined;
}

/**
 * Extract pointer + display fields from raw entry value (pointers or hydrated).
 */
export function extractRelationOptionItems(
  raw: unknown,
  valuePath: string,
  labelPath?: string,
): {
  ok: true;
  items: Array<{ pointer: string; label?: string; bc_slug?: string }>;
} | { ok: false; error: string } {
  if (raw === null || raw === undefined || raw === "") {
    return { ok: true, items: [] };
  }

  // Hydrated single object
  if (isPlainObject(raw) && !Array.isArray(raw)) {
    const pointer = pickString(raw, valuePath);
    if (!pointer) {
      return { ok: false, error: "hydrated relation object is missing the value_path field" };
    }
    return {
      ok: true,
      items: [
        {
          pointer,
          label: labelPath ? pickString(raw, labelPath) : undefined,
          bc_slug: pickString(raw, "bc_slug"),
        },
      ],
    };
  }

  if (Array.isArray(raw)) {
    if (raw.length === 0) return { ok: true, items: [] };
    // All strings → pointers
    if (raw.every((el) => typeof el === "string")) {
      const normalized = normalizeRelationPointers(raw);
      if (!normalized.ok) return { ok: false, error: normalized.error };
      const list = normalized.value;
      if (!list) return { ok: true, items: [] };
      const pointers = Array.isArray(list) ? list : [list];
      return {
        ok: true,
        items: pointers.map((pointer) => ({ pointer })),
      };
    }
    // Hydrated objects
    const items: Array<{ pointer: string; label?: string; bc_slug?: string }> = [];
    for (let i = 0; i < raw.length; i++) {
      const el = raw[i];
      if (typeof el === "string" && el.trim()) {
        items.push({ pointer: el.trim() });
        continue;
      }
      if (!isPlainObject(el)) {
        return {
          ok: false,
          error: `relation array item at index ${i} must be a slug string or related object`,
        };
      }
      const pointer = pickString(el, valuePath);
      if (!pointer) {
        return {
          ok: false,
          error: `relation array item at index ${i} is missing the value_path field`,
        };
      }
      items.push({
        pointer,
        label: labelPath ? pickString(el, labelPath) : undefined,
        bc_slug: pickString(el, "bc_slug"),
      });
    }
    return { ok: true, items };
  }

  if (typeof raw === "string") {
    const normalized = normalizeRelationPointers(raw);
    if (!normalized.ok) return { ok: false, error: normalized.error };
    const list = normalized.value;
    if (!list) return { ok: true, items: [] };
    const pointers = Array.isArray(list) ? list : [list];
    return { ok: true, items: pointers.map((pointer) => ({ pointer })) };
  }

  return {
    ok: false,
    error: "relation value must be a slug, slug[], or hydrated related object(s)",
  };
}

export type ResolveFormFieldRelationSourceInput = {
  /** Form field name (for error messages), e.g. program */
  formFieldName?: string;
  /** CT field name, e.g. programs */
  relationField: string;
  singleEntry: Record<string, unknown> | undefined | null;
  editorHint: RelationEditorHint | undefined | null;
  /** Override value path on hydrated objects (required from form source.value_path) */
  valuePath?: string;
  labelPath?: string;
  /**
   * Optional map pointer → { label, bc_slug } from catalog / form-options.
   * Used to enrich labels and CRM values; missing entries are not "broken" unless
   * `requireCatalogHit` is true.
   */
  catalogByPointer?: Map<
    string,
    { label?: string; bc_slug?: string }
  >;
  /** When true, unknown pointers (not in catalog) fail as broken_pointer */
  requireCatalogHit?: boolean;
};

/**
 * Resolve options for a form field bound with source.related_field.
 */
export function resolveFormFieldRelationSource(
  input: ResolveFormFieldRelationSourceInput,
): ResolveFormFieldRelationSourceResult {
  const {
    formFieldName,
    relationField,
    singleEntry,
    editorHint,
    catalogByPointer,
    requireCatalogHit,
  } = input;

  const formPath = formFieldName
    ? `fields.${formFieldName}.source.related_field`
    : `source.related_field`;

  if (!editorHint) {
    return {
      ok: false,
      code: "missing_hint",
      relationField,
      formFieldName,
      error: `${formPath} points at "${relationField}", but this content type has no editor.${relationField} field`,
      staffMessage: `This form looks for a content field named "${relationField}", but that field is not set up on this page type. Ask someone with content-types access to add it, or change the form to use a catalog source instead.`,
    };
  }

  if (!isRelationEditorHint(editorHint)) {
    return {
      ok: false,
      code: "not_relation",
      relationField,
      formFieldName,
      error: `${formPath} → "${relationField}" must be editor.type: relation (found type=${editorHint.type ?? "undefined"})`,
      staffMessage: `The content field "${relationField}" is not a relation field, so this form cannot use it for options. Use a relation field or switch the form to a catalog source.`,
    };
  }

  const valuePath = input.valuePath;
  const labelPath = input.labelPath;
  const raw = singleEntry ? singleEntry[relationField] : undefined;
  if (!valuePath) {
    return {
      ok: false,
      code: "invalid_shape",
      relationField,
      formFieldName,
      error: `${formPath} requires value_path`,
      staffMessage: `The form source for "${relationField}" is missing value_path (which property on each related item to use as the option value).`,
    };
  }
  const extracted = extractRelationOptionItems(raw, valuePath, labelPath);
  if (!extracted.ok) {
    return {
      ok: false,
      code: "invalid_shape",
      relationField,
      formFieldName,
      error: `${formPath} → entry "${relationField}": ${extracted.error}`,
      staffMessage: `The "${relationField}" field on this entry has an unexpected shape. It should be a list of slugs (e.g. on _common.yml).`,
    };
  }

  if (extracted.items.length === 0) {
    return {
      ok: false,
      code: "empty",
      relationField,
      formFieldName,
      error: `${formPath} → entry "${relationField}" is empty (no pointers)`,
      staffMessage: `Add at least one value to the "${relationField}" field on this entry (usually in _common.yml) before publishing. Forms that use source.related_field: ${relationField} need it.`,
    };
  }

  const options: FormFieldOption[] = [];
  for (const item of extracted.items) {
    const catalog = catalogByPointer?.get(item.pointer);
    if (requireCatalogHit && catalogByPointer && !catalog) {
      return {
        ok: false,
        code: "broken_pointer",
        relationField,
        formFieldName,
        badPointer: item.pointer,
        error: `${formPath} → entry "${relationField}" includes unknown pointer "${item.pointer}" (not found in related catalog)`,
        staffMessage: `The "${relationField}" field includes "${item.pointer}", which is not a valid related entry. Remove it or pick a real entry from the catalog.`,
      };
    }

    const label =
      item.label ||
      catalog?.label ||
      deslugifyLabel(item.pointer);

    options.push({
      value: item.pointer,
      label,
      bc_slug: item.bc_slug || catalog?.bc_slug,
    });
  }

  return { ok: true, options, relationField };
}

/** Apply choice-control cardinality from option count. */
export function applyChoiceCardinality<T extends { visible?: boolean; required?: boolean; default?: string }>(
  authored: T,
  options: FormFieldOption[],
): T & { visible: boolean; required: boolean; default: string; mode: "empty" | "single" | "multi" } {
  const n = options.length;
  if (n === 0) {
    return {
      ...authored,
      visible: false,
      required: false,
      default: typeof authored.default === "string" ? authored.default : "",
      mode: "empty",
    };
  }
  if (n === 1) {
    const only = options[0]!;
    return {
      ...authored,
      visible: false,
      required: false,
      default: only.bc_slug || only.value,
      mode: "single",
    };
  }
  return {
    ...authored,
    visible: true,
    required: true,
    default: "",
    mode: "multi",
  };
}

/**
 * Prefer CRM bc_slug when submitting a selected pointer value.
 */
export function resolveSubmitValueFromOptions(
  selected: string,
  options: FormFieldOption[],
): string {
  if (!selected) return "";
  const hit = options.find(
    (o) => o.value === selected || o.bc_slug === selected,
  );
  if (hit) return hit.bc_slug || hit.value;
  return selected;
}
