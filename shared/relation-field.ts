/**
 * Coerce / validate content-type `editor.type: relation` fields.
 * Stored value is a pointer string or string[] (when multiple).
 */

export type RelationEditorHint = {
  type?: string;
  source?: string;
  value?: string;
  label?: string;
  multiple?: boolean;
  required?: boolean | "attached";
  description?: string;
};

export type RelationCoerceOk = { ok: true; value: string | string[] | null };
export type RelationCoerceErr = { ok: false; error: string };
export type RelationCoerceResult = RelationCoerceOk | RelationCoerceErr;

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}

/** Normalize to string[]; empty → []. Rejects objects / nested structures. */
export function normalizeRelationPointers(raw: unknown): RelationCoerceResult {
  if (raw === null || raw === undefined || raw === "") {
    return { ok: true, value: null };
  }
  if (typeof raw === "string") {
    const t = raw.trim();
    if (!t) return { ok: true, value: null };
    return { ok: true, value: [t] };
  }
  if (Array.isArray(raw)) {
    const out: string[] = [];
    for (let i = 0; i < raw.length; i++) {
      const el = raw[i];
      if (typeof el !== "string" || !el.trim()) {
        return {
          ok: false,
          error: `relation array items must be non-empty strings (index ${i})`,
        };
      }
      out.push(el.trim());
    }
    return { ok: true, value: out };
  }
  if (isPlainObject(raw)) {
    return {
      ok: false,
      error:
        "relation fields store pointer slug(s) only — do not write related entry objects (Person JSON belongs on the source content type)",
    };
  }
  return { ok: false, error: "relation value must be a string or string[] of slugs" };
}

/**
 * Coerce for save. When `multiple`, always persist string[] (never bare string).
 * When not multiple, persist a single string or null.
 * Empty array / null → null when not required; required fails on empty.
 */
export function coerceRelationFieldInput(
  raw: unknown,
  hint: RelationEditorHint | undefined | null,
): RelationCoerceResult {
  const normalized = normalizeRelationPointers(raw);
  if (!normalized.ok) return normalized;

  const multiple = !!hint?.multiple;
  const required = !!hint?.required;
  const pointers = normalized.value;

  if (pointers === null || (Array.isArray(pointers) && pointers.length === 0)) {
    if (required) {
      return { ok: false, error: "relation field is required (empty array is not allowed)" };
    }
    return { ok: true, value: null };
  }

  const list = Array.isArray(pointers) ? pointers : [pointers];
  if (multiple) return { ok: true, value: list };
  if (list.length > 1) {
    return {
      ok: false,
      error: "relation field does not allow multiple values (set editor.multiple: true)",
    };
  }
  return { ok: true, value: list[0]! };
}

export function isRelationEditorHint(
  hint: { type?: string } | undefined | null,
): boolean {
  return hint?.type === "relation";
}

/** Deslugify for listing labels: `ada-lovelace` → `Ada Lovelace`. */
export function deslugifyLabel(slug: string): string {
  return slug
    .split(/[\s\-_]+/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join(" ");
}
