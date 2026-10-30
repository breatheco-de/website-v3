import type { ArchiveRecord } from "@shared/evidence-archive";
import { markFileAsModified } from "../sync-state";
import { evidenceDatabase, mergeArchiveResult, updateArchiveRecords, type ArchiveResult } from "./rows";

/** Service author for archive writes (pushed with the service token). */
export const EVIDENCE_ARCHIVE_AUTHOR = "evidence-archive";

type CacheOwner = { clearCache(name: string): void } | null | undefined;

/**
 * Web process: write `_archive` changes for one source link, clear the database cache and
 * mark the file modified so auto-commit pushes it. Returns how many rows changed.
 */
export function writeArchiveRecords(opts: {
  contentRoot: string;
  database: string;
  sourceUrl: string;
  next: (prev: ArchiveRecord | null) => ArchiveRecord | null;
  dbm?: CacheOwner;
  author?: string;
}): number {
  const db = evidenceDatabase(opts.contentRoot, opts.database);
  if (!db) return 0;
  const changed = updateArchiveRecords(db, opts.sourceUrl, opts.next);
  if (changed > 0) {
    opts.dbm?.clearCache(db.dbName);
    markFileAsModified(db.relPath, opts.author ?? EVIDENCE_ARCHIVE_AUTHOR, undefined, opts.contentRoot);
  }
  return changed;
}

function isArchiveResult(v: unknown): v is ArchiveResult {
  if (!v || typeof v !== "object") return false;
  const r = v as Record<string, unknown>;
  if (typeof r.at !== "string") return false;
  if (r.kind === "original") return r.original === "ok" || r.original === "gone";
  if (r.kind !== "archive" || !r.outcome || typeof r.outcome !== "object") return false;
  const o = r.outcome as Record<string, unknown>;
  return (o.status === "archived" && typeof o.url === "string") || (o.status === "failed" && typeof o.error === "string");
}

/** Applier handler for one `evidence_archive_done` event payload. Idempotent: re-applying changes nothing. */
export function applyEvidenceArchiveDone(contentRoot: string, payload: Record<string, unknown>, dbm?: CacheOwner): number {
  const database = typeof payload.database === "string" ? payload.database : "";
  const sourceUrl = typeof payload.source_url === "string" ? payload.source_url : "";
  const result = payload.result;
  if (!database || !sourceUrl || !isArchiveResult(result)) return 0;
  return writeArchiveRecords({
    contentRoot,
    database,
    sourceUrl,
    dbm,
    next: (prev) => mergeArchiveResult(prev, sourceUrl, result),
  });
}
