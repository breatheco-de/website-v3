import {
  ROW_STAMP_KEY,
  evidenceProofFields,
  readEvidenceConfig,
  readRowStamp,
  type DatabaseEvidenceConfig,
  type RowStamp,
  type RowStampType,
} from "@shared/evidence-kinds";
import { ARCHIVE_KEY, readArchiveRecord, rowProofLink } from "@shared/evidence-archive";

export type RowWriter = { type: RowStampType; author: string | null };

/** Row keys only the server writes; dropped from client input and from every public read. */
export const SERVER_ROW_KEYS: readonly string[] = [ROW_STAMP_KEY, ARCHIVE_KEY];

/** Row without server-only keys (`_changed_by`, `_archive`). */
export function stripRowStamp<T extends Record<string, unknown>>(row: T): T {
  if (!row || typeof row !== "object" || !SERVER_ROW_KEYS.some((k) => k in row)) return row;
  const rest: Record<string, unknown> = { ...row };
  for (const k of SERVER_ROW_KEYS) delete rest[k];
  return rest as T;
}

function sameValue(a: unknown, b: unknown): boolean {
  return JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
}

export function proofFieldsChanged(
  prev: Record<string, unknown> | null | undefined,
  next: Record<string, unknown>,
  cfg: DatabaseEvidenceConfig,
): boolean {
  if (!prev) return true;
  return evidenceProofFields(cfg).some((f) => !sameValue(prev[f], next[f]));
}

function newStamp(writer: RowWriter, now: Date): RowStamp {
  return { type: writer.type, author: writer.author, at: now.toISOString() };
}

function withServerKeys(
  clean: Record<string, unknown>,
  stamp: RowStamp | null,
  archive: unknown,
): Record<string, unknown> {
  return {
    ...clean,
    ...(stamp ? { [ROW_STAMP_KEY]: stamp } : {}),
    ...(archive !== undefined && archive !== null ? { [ARCHIVE_KEY]: archive } : {}),
  };
}

/**
 * Row as it should be stored on an evidence database. Client-sent server keys are always dropped;
 * the previous `_archive` record is carried forward (a link change makes it stale, not deleted).
 * The stamp changes only when the write touches the claim or its proof (proof_field,
 * match_fields, title, excerpt) or the row is new; other edits keep the previous stamp.
 * Non-evidence databases are left unstamped.
 */
export function applyRowStamp(opts: {
  prev: Record<string, unknown> | null | undefined;
  next: Record<string, unknown>;
  evidence: unknown;
  writer: RowWriter;
  now?: Date;
}): Record<string, unknown> {
  const clean = stripRowStamp(opts.next);
  const cfg = readEvidenceConfig(opts.evidence);
  const prevStamp = opts.prev ? readRowStamp(opts.prev) : null;
  const prevArchive = opts.prev?.[ARCHIVE_KEY];
  if (!cfg) return withServerKeys(clean, prevStamp, prevArchive);
  if (proofFieldsChanged(opts.prev ? stripRowStamp(opts.prev) : null, clean, cfg)) {
    return withServerKeys(clean, newStamp(opts.writer, opts.now ?? new Date()), prevArchive);
  }
  return withServerKeys(clean, prevStamp, prevArchive);
}

/** Bulk replace: each incoming row keeps the stamp and archive of a previous row with identical proof fields. */
export function applyRowStampsBulk(opts: {
  prevRows: Record<string, unknown>[];
  nextRows: Record<string, unknown>[];
  evidence: unknown;
  writer: RowWriter;
  now?: Date;
}): Record<string, unknown>[] {
  const cfg = readEvidenceConfig(opts.evidence);
  const fields = cfg ? evidenceProofFields(cfg) : [];
  const keyOf = (row: Record<string, unknown>) => JSON.stringify(fields.map((f) => row[f] ?? null));
  const prevByKey = new Map<string, Record<string, unknown>>();
  for (const p of opts.prevRows) {
    const k = keyOf(p);
    if (!prevByKey.has(k)) prevByKey.set(k, p);
  }
  const archiveByLink = new Map<string, unknown>();
  if (cfg) {
    for (const p of opts.prevRows) {
      const rec = readArchiveRecord(p);
      if (rec && !archiveByLink.has(rec.source_url)) archiveByLink.set(rec.source_url, p[ARCHIVE_KEY]);
    }
  }
  return opts.nextRows.map((next, i) => {
    const clean = stripRowStamp(next);
    const prev = cfg ? prevByKey.get(keyOf(clean)) ?? null : opts.prevRows[i] ?? null;
    const row = applyRowStamp({ prev, next: clean, evidence: opts.evidence, writer: opts.writer, now: opts.now });
    if (cfg && !(ARCHIVE_KEY in row)) {
      const link = rowProofLink(clean, cfg.proof_field);
      const archive = link ? archiveByLink.get(link) : undefined;
      if (archive !== undefined) row[ARCHIVE_KEY] = archive;
    }
    return row;
  });
}

export function verifiedStamp(author: string | null, now: Date = new Date()): RowStamp {
  return { type: "staff", author, at: now.toISOString() };
}
