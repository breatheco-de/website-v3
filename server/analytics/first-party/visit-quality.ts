/**
 * Which stored page views count as visits, shared by every reader of visits.db so page
 * stats and get_analytics_report count the same rows.
 */

/** Missing summary after this long = final (counted, not engaged). */
export const SUMMARY_GRACE_MS = 30 * 60 * 1000;

/** SQL for "suspected low quality": marked on summary, or never visible with no summary after the grace period. */
export function lowQualitySql(staleBefore: number): string {
  return `(low_quality = 1 OR (summary_received = 0 AND never_visible = 1 AND arrived_at < ${Math.floor(staleBefore)}))`;
}

/** SQL for a counted visit: not a reload / back-forward, not suspected low quality. */
export function goodVisitSql(staleBefore: number): string {
  return `counted_visit = 1 AND NOT ${lowQualitySql(staleBefore)}`;
}
