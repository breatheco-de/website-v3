/**
 * Expand a single field cell into option/tag tokens for select/tags editors.
 * Arrays always flatten one level; strings optionally split on commas.
 * Objects with a string `slug` yield that slug (legacy unwrap defense).
 * Other non-string / empty values are dropped.
 */
export function expandEditorFieldTokens(
  raw: unknown,
  opts: { splitComma?: boolean } = {},
): string[] {
  const splitComma = opts.splitComma === true;
  const out: string[] = [];

  const pushToken = (v: unknown) => {
    const scalar = coerceEditorSelectScalar(v);
    if (scalar) out.push(scalar);
  };

  if (Array.isArray(raw)) {
    for (const el of raw) pushToken(el);
    return out;
  }

  if (raw !== null && typeof raw === "object") {
    pushToken(raw);
    return out;
  }

  if (typeof raw !== "string") return out;
  const s = raw.trim();
  if (!s) return out;

  if (splitComma) {
    for (const part of s.split(",")) pushToken(part);
    return out;
  }

  out.push(s);
  return out;
}

/**
 * Coerce a select/tags cell to a plain string for the item editor.
 * Supports plain strings and `{ slug: string }` (legacy unwrap defense).
 */
export function coerceEditorSelectScalar(raw: unknown): string {
  if (typeof raw === "string") {
    return raw.trim();
  }
  if (raw !== null && typeof raw === "object" && !Array.isArray(raw)) {
    const slug = (raw as Record<string, unknown>).slug;
    if (typeof slug === "string") return slug.trim();
  }
  if (typeof raw === "number" || typeof raw === "boolean") {
    return String(raw);
  }
  return "";
}

/** Collect distinct sorted tokens across items for one field. */
export function collectEditorFieldTokens(
  items: Record<string, unknown>[],
  field: string,
  opts: { splitComma?: boolean } = {},
): string[] {
  const seen = new Set<string>();
  for (const item of items) {
    for (const token of expandEditorFieldTokens(item[field], opts)) {
      seen.add(token);
    }
  }
  return [...seen].sort((a, b) => a.localeCompare(b));
}
