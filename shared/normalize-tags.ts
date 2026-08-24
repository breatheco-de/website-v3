/** Normalize tag lists from YAML (array, comma/pipe string, or JSON array string). */
export function normalizeTags(tags: unknown): string[] {
  if (!tags) return [];
  if (Array.isArray(tags)) {
    return tags.map(String).map((t) => t.trim()).filter(Boolean);
  }
  if (typeof tags === "string") {
    const trimmed = tags.trim();
    if (!trimmed || trimmed.startsWith("{{")) return [];
    try {
      const parsed = JSON.parse(trimmed);
      if (Array.isArray(parsed)) return normalizeTags(parsed);
    } catch {
      /* not JSON */
    }
    return trimmed.split(/[,|]/).map((t) => t.trim()).filter(Boolean);
  }
  return [];
}
