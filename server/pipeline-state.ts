/**
 * Persisted pipeline counters per site (survives process restart).
 */

import { getSiteSqlite } from "./db";
import { ensurePipelineDb } from "./pipeline-db/runner";

const KEY_LAST_APPLIED_INDEX = "last_applied_index";
const KEY_LAST_APPLIED_SEO = "last_applied_seo_index";

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
 * Stash the entry_locale_saved id for an on_save_validation job.
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

export type PendingFactLiteralsDelta = {
  field_path: string;
  text: string;
};

function pendingFactLiteralsKey(entryKey: string): string {
  return `pending_fact_literals_delta:${entryKey}`;
}

/** Stash changed-field text for a cue-invited fact-literals on-save run (coalesced). */
export function setPendingFactLiteralsDelta(
  site: string,
  entryKey: string,
  delta: PendingFactLiteralsDelta[],
): void {
  if (!delta.length) return;
  ensureSchema(site);
  const db = getSiteSqlite(site);
  const key = pendingFactLiteralsKey(entryKey);
  let merged = [...delta];
  const row = db.prepare("SELECT value_json FROM pipeline_state WHERE key = ?").get(key) as
    | { value_json: string }
    | undefined;
  if (row) {
    try {
      const prev = JSON.parse(row.value_json) as { delta?: PendingFactLiteralsDelta[] };
      if (Array.isArray(prev.delta)) merged = [...prev.delta, ...delta];
    } catch {
      /* replace */
    }
  }
  // Dedupe by field_path keeping last text
  const byPath = new Map<string, PendingFactLiteralsDelta>();
  for (const d of merged) {
    if (typeof d.field_path === "string" && typeof d.text === "string") {
      byPath.set(d.field_path, { field_path: d.field_path, text: d.text });
    }
  }
  db.prepare(
    `INSERT INTO pipeline_state (key, value_json) VALUES (?, ?)
     ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json`,
  ).run(key, JSON.stringify({ delta: [...byPath.values()] }));
}

/** Read+clear pending fact-literals delta for an entry (job-side). */
export function takePendingFactLiteralsDelta(
  site: string,
  entryKey: string,
): PendingFactLiteralsDelta[] {
  ensureSchema(site);
  const db = getSiteSqlite(site);
  const key = pendingFactLiteralsKey(entryKey);
  const row = db.prepare("SELECT value_json FROM pipeline_state WHERE key = ?").get(key) as
    | { value_json: string }
    | undefined;
  if (!row) return [];
  db.prepare("DELETE FROM pipeline_state WHERE key = ?").run(key);
  try {
    const parsed = JSON.parse(row.value_json) as { delta?: PendingFactLiteralsDelta[] };
    return Array.isArray(parsed.delta)
      ? parsed.delta.filter(
          (d) => d && typeof d.field_path === "string" && typeof d.text === "string",
        )
      : [];
  } catch {
    return [];
  }
}

export function getPersistedLastAppliedSeoIndex(site: string): LastAppliedIndexState | null {
  ensureSchema(site);
  const row = getSiteSqlite(site)
    .prepare("SELECT value_json FROM pipeline_state WHERE key = ?")
    .get(KEY_LAST_APPLIED_SEO) as { value_json: string } | undefined;
  if (!row) return null;
  try {
    const parsed = JSON.parse(row.value_json) as LastAppliedIndexState;
    if (typeof parsed.generation !== "number" || typeof parsed.appliedAt !== "number") return null;
    return parsed;
  } catch {
    return null;
  }
}

export function setPersistedLastAppliedSeoIndex(
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
    .run(KEY_LAST_APPLIED_SEO, JSON.stringify(payload));
}
