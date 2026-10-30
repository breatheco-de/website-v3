/**
 * Evidence database files on disk and the merge rules for `_archive` records.
 * Reads are safe in the Sidequest worker; writes run in the web process (routes / applier),
 * which then marks the file modified so auto-commit pushes it.
 */

import fs from "fs";
import path from "path";
import yaml from "js-yaml";
import { readEvidenceConfig, type DatabaseEvidenceConfig } from "@shared/evidence-kinds";
import {
  ARCHIVE_KEY,
  readArchiveRecord,
  rowProofLink,
  archiveCopyCapturedAt,
  type ArchiveRecord,
} from "@shared/evidence-archive";
import { dumpContentYaml } from "../content-yaml";
import { loadYamlWithTemplateVars } from "../yaml-parse-cache";
import type { ArchiveOutcome } from "./archive-org-client";

const VALID_DB_NAME = /^[a-z0-9_-]+$/;

export type EvidenceDbFile = {
  dbName: string;
  cfg: DatabaseEvidenceConfig;
  filePath: string;
  /** Path relative to the content root (`db/<name>/<file>`), for markFileAsModified. */
  relPath: string;
  resultsPath?: string;
};

type RawDbConfig = {
  source?: { type?: string; local?: { filename?: string; results_path?: string } };
  evidence?: unknown;
};

export function evidenceDatabase(contentRoot: string, dbName: string): EvidenceDbFile | null {
  if (!VALID_DB_NAME.test(dbName)) return null;
  const configPath = path.join(contentRoot, "db", dbName, "config.yml");
  if (!fs.existsSync(configPath)) return null;
  let config: RawDbConfig | null;
  try {
    config = yaml.load(fs.readFileSync(configPath, "utf-8")) as RawDbConfig | null;
  } catch {
    return null;
  }
  const cfg = readEvidenceConfig(config?.evidence);
  const filename = config?.source?.local?.filename;
  if (!cfg || config?.source?.type !== "local" || !filename || filename.includes("/") || filename.includes("..")) {
    return null;
  }
  return {
    dbName,
    cfg,
    filePath: path.join(contentRoot, "db", dbName, filename),
    relPath: `db/${dbName}/${filename}`,
    ...(config.source.local?.results_path ? { resultsPath: config.source.local.results_path } : {}),
  };
}

export function listEvidenceDatabases(contentRoot: string): EvidenceDbFile[] {
  const dbDir = path.join(contentRoot, "db");
  if (!fs.existsSync(dbDir)) return [];
  return fs
    .readdirSync(dbDir)
    .map((name) => evidenceDatabase(contentRoot, name))
    .filter((d): d is EvidenceDbFile => d !== null);
}

export function readEvidenceRows(db: EvidenceDbFile): Record<string, unknown>[] {
  if (!fs.existsSync(db.filePath)) return [];
  const data = loadYamlWithTemplateVars(fs.readFileSync(db.filePath, "utf-8"));
  if (Array.isArray(data)) return data as Record<string, unknown>[];
  if (db.resultsPath && data && typeof data === "object") {
    const rows = (data as Record<string, unknown>)[db.resultsPath];
    return Array.isArray(rows) ? (rows as Record<string, unknown>[]) : [];
  }
  return [];
}

export function writeEvidenceRows(db: EvidenceDbFile, rows: Record<string, unknown>[]): void {
  const data: unknown = db.resultsPath ? { [db.resultsPath]: rows } : rows;
  fs.writeFileSync(db.filePath, dumpContentYaml(data, { lineWidth: 120 }));
}

/** Result of one archive / original-link check for a source link, carried by `evidence_archive_done`. */
export type ArchiveResult =
  | { kind: "archive"; outcome: ArchiveOutcome; at: string }
  | { kind: "original"; original: "ok" | "gone"; at: string };

function ms(iso: string | null | undefined): number {
  const t = Date.parse(iso ?? "");
  return Number.isFinite(t) ? t : 0;
}

/**
 * Next `_archive` record for a row whose current link is `sourceUrl`, or null when nothing changes.
 * Staff-pasted (manual) copies are never replaced by a job; results older than the record are dropped;
 * a failure never downgrades an archived copy.
 */
export function mergeArchiveResult(prev: ArchiveRecord | null, sourceUrl: string, result: ArchiveResult): ArchiveRecord | null {
  if (result.kind === "original") {
    if (!prev) return null;
    if (prev.original?.status === result.original && ms(prev.original.checked_at) >= ms(result.at)) return null;
    return { ...prev, original: { status: result.original, checked_at: result.at } };
  }
  if (prev?.status === "manual") return null;
  if (prev && ms(prev.updated_at) > ms(result.at)) return null;
  const base: ArchiveRecord = {
    source_url: sourceUrl,
    status: "pending",
    url: null,
    captured_at: null,
    error: null,
    set_by: null,
    updated_at: result.at,
    original: prev?.original ?? null,
  };
  const o = result.outcome;
  if (o.status === "archived") {
    if (prev?.status === "archived" && prev.url === o.url) return null;
    return { ...base, status: "archived", url: o.url, captured_at: o.captured_at };
  }
  if (prev?.status === "archived") return null;
  return { ...base, status: "failed", error: o.error };
}

export function pendingRecord(prev: ArchiveRecord | null, sourceUrl: string, at: string): ArchiveRecord {
  return {
    source_url: sourceUrl,
    status: "pending",
    url: null,
    captured_at: null,
    error: null,
    set_by: null,
    updated_at: at,
    original: prev?.source_url === sourceUrl ? prev.original : null,
  };
}

export function manualRecord(prev: ArchiveRecord | null, sourceUrl: string, url: string, setBy: string | null, at: string): ArchiveRecord {
  return {
    source_url: sourceUrl,
    status: "manual",
    url,
    captured_at: archiveCopyCapturedAt(url),
    error: null,
    set_by: setBy,
    updated_at: at,
    original: prev?.source_url === sourceUrl ? prev.original : null,
  };
}

/** Record that belongs to the row's current link (stale ones count as absent). */
function currentRecord(row: Record<string, unknown>, sourceUrl: string): ArchiveRecord | null {
  const rec = readArchiveRecord(row);
  return rec && rec.source_url === sourceUrl ? rec : null;
}

/**
 * Apply `next(prevRecord)` to every row whose proof link equals `sourceUrl`. Rows are matched by link,
 * never by index, so reorders or deletes during a save cannot land the result on another row.
 * Writes the file only when something changed; returns how many rows changed.
 */
export function updateArchiveRecords(
  db: EvidenceDbFile,
  sourceUrl: string,
  next: (prev: ArchiveRecord | null) => ArchiveRecord | null,
): number {
  const rows = readEvidenceRows(db);
  let changed = 0;
  const out = rows.map((row) => {
    if (!row || typeof row !== "object" || rowProofLink(row, db.cfg.proof_field) !== sourceUrl) return row;
    const rec = next(currentRecord(row, sourceUrl));
    if (!rec) return row;
    changed++;
    return { ...row, [ARCHIVE_KEY]: rec };
  });
  if (changed > 0) writeEvidenceRows(db, out);
  return changed;
}
