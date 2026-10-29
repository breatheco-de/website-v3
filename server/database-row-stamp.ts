import {
  ROW_STAMP_KEY,
  evidenceProofFields,
  readEvidenceConfig,
  readRowStamp,
  type DatabaseEvidenceConfig,
  type RowStamp,
  type RowStampType,
} from "@shared/evidence-kinds";

export type RowWriter = { type: RowStampType; author: string | null };

export function stripRowStamp<T extends Record<string, unknown>>(row: T): T {
  if (!row || typeof row !== "object" || !(ROW_STAMP_KEY in row)) return row;
  const { [ROW_STAMP_KEY]: _drop, ...rest } = row;
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

/**
 * Row as it should be stored on an evidence database. A client-sent stamp is always dropped.
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
  if (!cfg) {
    return prevStamp ? { ...clean, [ROW_STAMP_KEY]: prevStamp } : clean;
  }
  if (proofFieldsChanged(opts.prev ? stripRowStamp(opts.prev) : null, clean, cfg)) {
    return { ...clean, [ROW_STAMP_KEY]: newStamp(opts.writer, opts.now ?? new Date()) };
  }
  return prevStamp ? { ...clean, [ROW_STAMP_KEY]: prevStamp } : clean;
}

/** Bulk replace: each incoming row keeps the stamp of a previous row with identical proof fields. */
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
  return opts.nextRows.map((next, i) => {
    const clean = stripRowStamp(next);
    const prev = cfg ? prevByKey.get(keyOf(clean)) ?? null : opts.prevRows[i] ?? null;
    return applyRowStamp({ prev, next: clean, evidence: opts.evidence, writer: opts.writer, now: opts.now });
  });
}

export function verifiedStamp(author: string | null, now: Date = new Date()): RowStamp {
  return { type: "staff", author, at: now.toISOString() };
}
