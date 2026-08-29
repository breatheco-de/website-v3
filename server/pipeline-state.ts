/**
 * Persisted pipeline counters per site (survives process restart).
 */

import { getSiteSqlite } from "./db";
import { ensurePipelineDb } from "./pipeline-db/runner";

const KEY_LAST_APPLIED_INDEX = "last_applied_index";

function ensureSchema(site: string): void {
  ensurePipelineDb(site);
}

export type LastAppliedIndexState = {
  generation: number;
  appliedAt: number;
};

export function getPersistedLastAppliedIndex(site: string): LastAppliedIndexState | null {
  ensureSchema(site);
  const row = getSiteSqlite(site)
    .prepare("SELECT value_json FROM pipeline_state WHERE key = ?")
    .get(KEY_LAST_APPLIED_INDEX) as { value_json: string } | undefined;
  if (!row) return null;
  try {
    const parsed = JSON.parse(row.value_json) as LastAppliedIndexState;
    if (typeof parsed.generation !== "number" || typeof parsed.appliedAt !== "number") return null;
    return parsed;
  } catch {
    return null;
  }
}

export function setPersistedLastAppliedIndex(
  site: string,
  generation: number,
  appliedAt: number,
): void {
  ensureSchema(site);
  const payload: LastAppliedIndexState = { generation, appliedAt };
  getSiteSqlite(site)
    .prepare(
      `INSERT INTO pipeline_state (key, value_json) VALUES (?, ?)
       ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json`,
    )
    .run(KEY_LAST_APPLIED_INDEX, JSON.stringify(payload));
}

function pendingValidationKey(entryKey: string): string {
  return `pending_validation_write:${entryKey}`;
}

/**
 * Stash the content_file_written id for an on_save_validation job.
 * Kept out of Sidequest job args so the 1-min debounce scheduler can update
 * the latest write id while coalescing bursts for the same entryKey.
 * Same SQLite file is visible to the Sidequest jobs bundle.
 */
export function setPendingValidationWriteId(
  site: string,
  entryKey: string,
  writeEventId: number,
): void {
  ensureSchema(site);
  getSiteSqlite(site)
    .prepare(
      `INSERT INTO pipeline_state (key, value_json) VALUES (?, ?)
       ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json`,
    )
    .run(pendingValidationKey(entryKey), JSON.stringify({ writeEventId }));
}

/** Read+clear pending write id for an entry (job-side). */
export function takePendingValidationWriteId(site: string, entryKey: string): number | null {
  ensureSchema(site);
  const db = getSiteSqlite(site);
  const key = pendingValidationKey(entryKey);
  const row = db.prepare("SELECT value_json FROM pipeline_state WHERE key = ?").get(key) as
    | { value_json: string }
    | undefined;
  if (!row) return null;
  db.prepare("DELETE FROM pipeline_state WHERE key = ?").run(key);
  try {
    const parsed = JSON.parse(row.value_json) as { writeEventId?: number };
    return typeof parsed.writeEventId === "number" ? parsed.writeEventId : null;
  } catch {
    return null;
  }
}
