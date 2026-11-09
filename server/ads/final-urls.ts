function str(v: unknown): string | null {
  if (v == null) return null;
  if (typeof v === "object" && "value" in (v as object)) return str((v as { value: unknown }).value);
  const t = String(v).trim();
  return t ? t : null;
}

/**
 * Google final URLs from the transfer column (or a stored catalog link). `TO_JSON_STRING` over a
 * column that is already a JSON array string double-encodes it (`"[\"https://…\"]"`), so JSON
 * strings and array items are decoded again.
 */
export function parseFinalUrls(raw: unknown, depth = 0): string[] {
  const t = str(raw);
  if (!t) return [];
  if (/^https?:\/\//i.test(t)) return [t];
  if (depth > 3) return [];
  try {
    const parsed = JSON.parse(t) as unknown;
    if (Array.isArray(parsed)) return parsed.flatMap((u) => (typeof u === "string" ? parseFinalUrls(u, depth + 1) : []));
    if (typeof parsed === "string") return parseFinalUrls(parsed, depth + 1);
  } catch {
    /* not JSON */
  }
  return [];
}
