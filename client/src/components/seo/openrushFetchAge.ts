/** Compact cache age for OpenRush fetch controls (keyword / SERP). */
export function formatOpenRushFetchedAge(
  fetchedAt: string | null | undefined,
  stale?: boolean,
): string {
  if (!fetchedAt) return "";
  const t = Date.parse(fetchedAt);
  if (Number.isNaN(t)) return "";
  const days = Math.floor((Date.now() - t) / (24 * 60 * 60 * 1000));
  if (stale) return days <= 0 ? "stale" : `stale · ${days}d`;
  if (days <= 0) return "today";
  if (days === 1) return "1d ago";
  return `${days}d ago`;
}
