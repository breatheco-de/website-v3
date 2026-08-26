/** Editorial content-change window for the manage-page update timeline. */
export const CONTENT_UPDATE_WINDOW_MS = 14 * 24 * 60 * 60 * 1000;

export type ContentUpdateTimelineItem = {
  id: string;
  slug: string;
  title: string;
  updatedAtMs: number;
  urls: Record<string, string>;
};

export type ContentUpdateTimelineSource = {
  slug: string;
  title?: string | null;
  updated_at?: unknown;
  urls?: Record<string, string> | null;
};

export function parseUpdatedAtMs(value: unknown): number | null {
  if (value == null || value === "") return null;
  const ms = Date.parse(String(value));
  return Number.isNaN(ms) ? null : ms;
}

/**
 * Union static + DB rows by slug (static URLs win; fill missing locale URLs from DB).
 * Keep the newer `updated_at`, drop missing/unparseable timestamps and rows outside the window.
 */
export function buildContentUpdateTimelineItems(
  staticEntries: ContentUpdateTimelineSource[],
  dbEntries: ContentUpdateTimelineSource[],
  options?: { nowMs?: number; windowMs?: number },
): ContentUpdateTimelineItem[] {
  const now = options?.nowMs ?? Date.now();
  const windowMs = options?.windowMs ?? CONTENT_UPDATE_WINDOW_MS;
  const cutoff = now - windowMs;
  const bySlug = new Map<string, ContentUpdateTimelineItem>();

  for (const e of staticEntries) {
    const slug = String(e.slug || "").trim();
    if (!slug) continue;
    const ms = parseUpdatedAtMs(e.updated_at);
    if (ms == null) continue;
    const title = String(e.title || "").trim() || slug;
    bySlug.set(slug, {
      id: slug,
      slug,
      title,
      updatedAtMs: ms,
      urls: { ...(e.urls || {}) },
    });
  }

  for (const e of dbEntries) {
    const slug = String(e.slug || "").trim();
    if (!slug) continue;
    const ms = parseUpdatedAtMs(e.updated_at);
    if (ms == null) continue;
    const title = String(e.title || "").trim() || slug;
    const urls = { ...(e.urls || {}) };
    const existing = bySlug.get(slug);
    if (!existing) {
      bySlug.set(slug, {
        id: slug,
        slug,
        title,
        updatedAtMs: ms,
        urls,
      });
      continue;
    }
    if (ms > existing.updatedAtMs) existing.updatedAtMs = ms;
    if (existing.title === existing.slug && title !== slug) existing.title = title;
    for (const [loc, url] of Object.entries(urls)) {
      if (url && !existing.urls[loc]) existing.urls[loc] = url;
    }
  }

  return [...bySlug.values()]
    .filter((item) => item.updatedAtMs >= cutoff && item.updatedAtMs <= now)
    .sort((a, b) => a.updatedAtMs - b.updatedAtMs);
}
