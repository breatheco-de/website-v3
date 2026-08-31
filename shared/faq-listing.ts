/**
 * Shared FAQ listing helpers (ignore keys, location overrides).
 * Used by resolveDynamicEntries, SSR FAQPage, and FaqDefault.
 */

export function faqItemKey(question: string): string {
  return String(question ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, "")
    .replace(/\s+/g, "-")
    .slice(0, 80);
}

/** Prefer stable slug/id; fall back to question-key (legacy ignored_entries). */
export function faqIgnoreIdentity(item: Record<string, unknown>): string {
  const slug = item.slug ?? item.id;
  if (slug !== undefined && slug !== null && String(slug).trim()) {
    return String(slug).toLowerCase().trim();
  }
  return faqItemKey(String(item.question ?? ""));
}

/**
 * Drop rows whose stable slug/id or content key appears in `ignored_entries`.
 *
 * `contentKey` lets non-FAQ listings key on their own identity field (e.g.
 * testimonials key on `student_name`); slug/id always wins when present.
 */
export function applyIgnoredEntries(
  items: Record<string, unknown>[],
  ignored: string[] | undefined,
  contentKey?: (item: Record<string, unknown>) => string,
): Record<string, unknown>[] {
  if (!ignored?.length) return items;
  const ignoredSet = new Set(ignored.map((k: string) => k.toLowerCase().trim()));
  return items.filter((item) => {
    const slug = item.slug ?? item.id;
    if (slug !== undefined && slug !== null && String(slug).trim()) {
      if (ignoredSet.has(String(slug).toLowerCase().trim())) return false;
    }
    const key = contentKey ? contentKey(item) : faqItemKey(String(item.question ?? ""));
    return !ignoredSet.has(key);
  });
}

export type FaqItemOverride = { hideOnLocations?: string[] };

/**
 * Drop items hidden for the current location via item_overrides (accordion + FAQPage).
 */
export function applyFaqHideOnLocations<T extends { question: string; answer: string }>(
  items: T[],
  itemOverrides: Record<string, FaqItemOverride> | undefined,
  locationSlug: string | undefined,
): T[] {
  if (!locationSlug || !itemOverrides || Object.keys(itemOverrides).length === 0) {
    return items;
  }
  return items.filter((item) => {
    const key = faqItemKey(item.question);
    const override = itemOverrides[key];
    return !override?.hideOnLocations?.includes(locationSlug);
  });
}

export function normalizeFaqEntries(value: unknown): Array<{ question: string; answer: string }> {
  if (!Array.isArray(value)) return [];
  const out: Array<{ question: string; answer: string }> = [];
  for (const item of value) {
    if (!item || typeof item !== "object" || Array.isArray(item)) continue;
    const row = item as Record<string, unknown>;
    if (typeof row.question !== "string" || typeof row.answer !== "string") continue;
    out.push({ question: row.question, answer: row.answer });
  }
  return out;
}
