/**
 * Content-change markers for the page's timelines: staff / agent saves on this entry per day
 * (same write types and actors as the Activity button).
 */

import { getSiteSqlite } from "../../db";
import { ensurePipelineDb } from "../../pipeline-db/runner";
import { ENTRY_ACTIVITY_WRITE_TYPES } from "@shared/event-log-filters";
import type { ChangesFacts, Section } from "@shared/page-stats";

export function queryPageChanges(opts: {
  site: string;
  entry: { content_type: string; slug: string } | null;
  start: string;
  end: string;
}): Section<ChangesFacts> {
  if (!opts.entry) return { status: "ok", as_of: null, data: { markers: [] } };
  try {
    ensurePipelineDb(opts.site);
    const db = getSiteSqlite(opts.site);
    const prefix = `${opts.entry.content_type}/${opts.entry.slug}/`;
    const placeholders = ENTRY_ACTIVITY_WRITE_TYPES.map(() => "?").join(", ");
    const rows = db
      .prepare(
        `SELECT strftime('%Y-%m-%d', created_at / 1000, 'unixepoch') AS day,
           COALESCE(
             NULLIF(TRIM(json_extract(payload_json, '$.entryKey')), ''),
             json_extract(resource_json, '$.contentType') || '/' || json_extract(resource_json, '$.slug') || '/' ||
               IFNULL(json_extract(resource_json, '$.locale'), '')
           ) AS entry_key
         FROM events
         WHERE site = ? AND created_at >= ? AND created_at < ?
           AND type IN (${placeholders})
           AND json_extract(attribution_json, '$[0].actor.type') IN ('ui', 'mcp')`,
      )
      .all(
        opts.site,
        Date.parse(`${opts.start}T00:00:00.000Z`),
        Date.parse(`${opts.end}T00:00:00.000Z`) + 86_400_000,
        ...ENTRY_ACTIVITY_WRITE_TYPES,
      ) as Array<{ day: string; entry_key: string | null }>;
    const byDay = new Map<string, number>();
    for (const r of rows) {
      if (!r.entry_key?.startsWith(prefix)) continue;
      byDay.set(r.day, (byDay.get(r.day) ?? 0) + 1);
    }
    const markers = [...byDay.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([day, writes]) => ({ day, writes }));
    return { status: "ok", as_of: new Date().toISOString(), data: { markers } };
  } catch (err) {
    return { status: "error", as_of: null, message: err instanceof Error ? err.message : String(err), data: null };
  }
}
