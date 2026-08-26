/**
 * content-types.yml `strategy` — type-level purpose/constraints for staff and agents.
 * Context only for field fill_intent; never replaces per-field briefs.
 * Any editor.required true|attached requires a valid strategy (non-empty purpose).
 */

export type ContentTypeStrategy = {
  purpose: string;
  constraints?: string[];
};

/**
 * Normalize unknown YAML/JSON into ContentTypeStrategy or null if unusable.
 */
export function parseContentTypeStrategy(raw: unknown): ContentTypeStrategy | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const obj = raw as Record<string, unknown>;
  const purpose = typeof obj.purpose === "string" ? obj.purpose.trim() : "";
  if (!purpose) return null;
  const constraintsRaw = obj.constraints;
  let constraints: string[] | undefined;
  if (Array.isArray(constraintsRaw)) {
    const list = constraintsRaw
      .filter((c): c is string => typeof c === "string")
      .map((c) => c.trim())
      .filter(Boolean);
    if (list.length > 0) constraints = list;
  }
  return constraints ? { purpose, constraints } : { purpose };
}

export function isValidContentTypeStrategy(raw: unknown): raw is ContentTypeStrategy {
  return parseContentTypeStrategy(raw) !== null;
}

function editorHasRequiredField(
  editor: Record<string, { required?: unknown }> | null | undefined,
): boolean {
  if (!editor) return false;
  for (const hint of Object.values(editor)) {
    const req = hint?.required;
    if (req === true || req === "attached") return true;
  }
  return false;
}

/**
 * When any editor field is required true|attached, strategy must be valid.
 */
export function assertEditorRequiredHasStrategy(
  strategy: unknown,
  editor: Record<string, { required?: unknown }> | null | undefined,
): { ok: true } | { ok: false; error: string; code: "missing_strategy" } {
  if (!editorHasRequiredField(editor)) return { ok: true };
  if (isValidContentTypeStrategy(strategy)) return { ok: true };
  return {
    ok: false,
    code: "missing_strategy",
    error:
      "Content types with required fields need a valid strategy (non-empty purpose). " +
      "Set strategy on the content type manage page or in content-types.yml before marking fields required.",
  };
}

/**
 * Clearing strategy is forbidden while any field remains required.
 */
export function assertCanClearStrategy(
  editor: Record<string, { required?: unknown }> | null | undefined,
): { ok: true } | { ok: false; error: string; code: "missing_strategy" } {
  if (!editorHasRequiredField(editor)) return { ok: true };
  return {
    ok: false,
    code: "missing_strategy",
    error:
      "Cannot clear strategy while required fields exist. Remove required/attached from all fields first, or keep a valid strategy.",
  };
}
