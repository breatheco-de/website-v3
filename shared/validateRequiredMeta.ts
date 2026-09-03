/**
 * Live SEO meta must resolve to real page_title + description (no leftover {{ }}).
 */

export type MetaFieldError = {
  field: "meta.page_title" | "meta.description";
  message: string;
};

export type ValidateRequiredMetaResult =
  | { ok: true }
  | { ok: false; errors: MetaFieldError[] };

const TEMPLATE_RE = /\{\{[\s\S]*?\}\}/;

function isUsableMetaString(value: unknown): boolean {
  // Coerce numbers (e.g. from parsePipeFallback("84") when a numeric pipe fallback is used)
  const str = typeof value === "number" ? String(value) : value;
  if (typeof str !== "string") return false;
  const trimmed = str.trim();
  if (!trimmed) return false;
  if (TEMPLATE_RE.test(trimmed)) return false;
  return true;
}

/**
 * Validate resolved meta for a live page/entry.
 * Pass meta *after* {{ single.* }} (and similar) resolution.
 */
const META_KEY_MESSAGES: Record<"page_title" | "description", MetaFieldError> = {
  page_title: {
    field: "meta.page_title",
    message:
      "meta.page_title is required before saving a live page (must be non-empty and fully resolved — no {{ }} templates).",
  },
  description: {
    field: "meta.description",
    message:
      "meta.description is required before saving a live page (must be non-empty and fully resolved — no {{ }} templates).",
  },
};

/** Validate only selected meta snippet keys (micro-save). */
export function validateRequiredMetaKeys(
  meta: unknown,
  keys: readonly ("page_title" | "description")[],
): ValidateRequiredMetaResult {
  if (keys.length === 0) return { ok: true };
  const m =
    meta && typeof meta === "object" && !Array.isArray(meta)
      ? (meta as Record<string, unknown>)
      : {};
  const errors: MetaFieldError[] = [];
  for (const key of keys) {
    const fieldKey = key === "page_title" ? "page_title" : "description";
    if (!isUsableMetaString(m[fieldKey])) {
      errors.push(META_KEY_MESSAGES[key]);
    }
  }
  if (errors.length > 0) return { ok: false, errors };
  return { ok: true };
}

export function validateRequiredMeta(
  meta: unknown,
): ValidateRequiredMetaResult {
  return validateRequiredMetaKeys(meta, ["page_title", "description"]);
}

export function formatMetaValidationErrors(
  result: ValidateRequiredMetaResult,
): string | null {
  if (result.ok) return null;
  return result.errors.map((e) => e.message).join(" ");
}
