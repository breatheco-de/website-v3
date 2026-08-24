/**
 * Re-apply `{{ single.* }}` / `{{ global.* }}` expressions from `_variableFields`
 * onto a section before dumping it into the Code editor.
 *
 * Delivery resolves those binds for the live page, so without this restore the
 * editor would show baked values (e.g. `miami-usa`) instead of the authored
 * placeholders staff need to edit.
 */

function setValueAtDotPath(obj: Record<string, unknown>, pathStr: string, value: unknown): void {
  const parts = pathStr.replace(/\[(\d+)\]/g, ".$1").split(".").filter(Boolean);
  if (parts.length === 0) return;

  let current: Record<string, unknown> | unknown[] = obj;
  for (let i = 0; i < parts.length - 1; i++) {
    const part = parts[i];
    const nextPart = parts[i + 1];
    const asRecord = current as Record<string, unknown>;
    if (asRecord[part] === undefined || asRecord[part] === null) {
      asRecord[part] = /^\d+$/.test(nextPart) ? [] : {};
    }
    current = asRecord[part] as Record<string, unknown> | unknown[];
  }

  const last = parts[parts.length - 1];
  (current as Record<string, unknown>)[last] = value;
}

/**
 * Strip runtime keys (`_*`, resolved `items`) then put template expressions back.
 * Paths in `skipPaths` are left as-is (staff unbound them in this session).
 */
export function restoreVariableFieldsForEditor(
  section: unknown,
  skipPaths?: Iterable<string>,
): unknown {
  if (!section || typeof section !== "object") return section;

  const sec = section as Record<string, unknown>;
  const variableFields = sec._variableFields as Record<string, string> | undefined;
  const skip = skipPaths ? new Set(skipPaths) : null;

  const withoutPrivate = Object.fromEntries(
    Object.entries(sec).filter(([k]) => !k.startsWith("_")),
  );

  let authored: Record<string, unknown> = withoutPrivate;
  if (withoutPrivate.dynamic_entries) {
    const { items: _items, ...rest } = withoutPrivate;
    authored = rest;
  }

  if (!variableFields || Object.keys(variableFields).length === 0) {
    return authored;
  }

  const result = JSON.parse(JSON.stringify(authored)) as Record<string, unknown>;
  for (const [dotPath, templateExpr] of Object.entries(variableFields)) {
    if (!dotPath || typeof templateExpr !== "string") continue;
    if (skip?.has(dotPath)) continue;
    setValueAtDotPath(result, dotPath, templateExpr);
  }
  return result;
}

const TEMPLATE_VAR_RE = /\{\{[\s\S]*?\}\}/;

export function getValueAtDotPath(obj: unknown, fieldPath: string): unknown {
  const parts = fieldPath.replace(/\[(\d+)\]/g, ".$1").split(".").filter(Boolean);
  let current: unknown = obj;
  for (const part of parts) {
    if (current === null || current === undefined) return undefined;
    if (typeof current !== "object") return undefined;
    current = (current as Record<string, unknown>)[part];
  }
  return current;
}

/** Paths that were template-bound at load but are now static strings (no `{{ }}`). */
export function detectUnboundTemplatePaths(
  originalPaths: Record<string, string>,
  current: Record<string, unknown>,
): string[] {
  return Object.keys(originalPaths).filter((path) => {
    const val = getValueAtDotPath(current, path);
    if (val === undefined) return false;
    if (typeof val !== "string") return false;
    return !TEMPLATE_VAR_RE.test(val);
  });
}

export function findFieldPathForExpression(
  variableFields: Record<string, string>,
  expr: string,
): string | undefined {
  const trimmed = expr.trim();
  for (const [path, templateExpr] of Object.entries(variableFields)) {
    if (templateExpr.trim() === trimmed) return path;
    const fieldVal = templateExpr;
    if (fieldVal.includes(trimmed)) return path;
  }
  return undefined;
}

/** Collect dot-paths whose string leaves contain `{{ ... }}`. */
export function collectTemplateExprPaths(
  obj: unknown,
  prefix = "",
): Record<string, string> {
  const result: Record<string, string> = {};
  if (typeof obj !== "object" || obj === null) return result;
  const entries: Array<[string, unknown]> = Array.isArray(obj)
    ? obj.map((v, i) => [String(i), v] as [string, unknown])
    : Object.entries(obj as Record<string, unknown>).filter(([k]) => !k.startsWith("_"));
  for (const [key, value] of entries) {
    const dotPath = prefix ? `${prefix}.${key}` : key;
    if (typeof value === "string" && TEMPLATE_VAR_RE.test(value)) {
      result[dotPath] = value.trim();
    } else if (typeof value === "object" && value !== null) {
      Object.assign(result, collectTemplateExprPaths(value, dotPath));
    }
  }
  return result;
}

/**
 * After save, the client has authored YAML (often with `{{ single.* }}` and no
 * `items`). Pushing that straight into the live tree makes FAQ sections flash
 * "no results" until refetch. Keep the previous resolved `items` / meta and
 * refresh `_variableFields` from the saved payload.
 */
export function mergeSavedSectionForLivePreview(
  previous: Record<string, unknown> | null | undefined,
  saved: Record<string, unknown>,
): Record<string, unknown> {
  const merged: Record<string, unknown> = { ...saved };
  const nextVf = collectTemplateExprPaths(saved);
  if (Object.keys(nextVf).length > 0) {
    merged._variableFields = nextVf;
  } else if ("_variableFields" in merged) {
    delete merged._variableFields;
  }

  const hasDynamic =
    merged.dynamic_entries != null && typeof merged.dynamic_entries === "object";
  const savedItems = merged.items;
  const savedHasItems = Array.isArray(savedItems) && savedItems.length > 0;
  const prevItems = previous?.items;
  const prevHasItems = Array.isArray(prevItems) && prevItems.length > 0;

  if (hasDynamic && !savedHasItems && prevHasItems) {
    merged.items = prevItems;
    if (previous?._dynamic_meta != null) {
      merged._dynamic_meta = previous._dynamic_meta;
    }
  }

  return merged;
}
