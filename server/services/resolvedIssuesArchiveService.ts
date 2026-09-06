/**
 * Archive of successfully resolved validation issues (rolling 60-day retention).
 * Persists to validation-resolved-archive.json + GCS in production.
 */

import * as fs from "fs";
import * as path from "path";
import type {
  ResolvedIssueArchiveRow,
  ResolvedIssuesArchiveFileV1,
  StoredValidationIssue,
  ValidationIssueActor,
} from "../../scripts/validation/shared/types";
import {
  siteSyncGcsKey,
  SYNC_FILENAMES,
  validationResolvedArchiveReadKeys,
} from "@shared/gcsKeys";
import { gcs } from "../gcs";
import { child } from "../logger";
import type { ValidationCacheService } from "./validationCacheService";

const log = child({ module: "resolvedIssuesArchive" });

const IS_PRODUCTION = process.env.NODE_ENV === "production";
/** Rolling retention window for resolved archive rows (by `resolvedAt`). */
export const ARCHIVE_RETENTION_MS = 60 * 24 * 60 * 60 * 1000;
/** Safety cap after age prune — newest-first list, oldest beyond this are dropped. */
export const ARCHIVE_MAX_ROWS = 40_000;
export const STAFF_DEFAULT_REPORT = "Marked fixed in UI.";

/**
 * Drop rows older than the retention window, then apply a max-row safety cap.
 * Invalid/missing `resolvedAt` values are treated as expired.
 */
export function pruneArchiveRows(
  rows: ResolvedIssueArchiveRow[],
  options?: {
    now?: number;
    retentionMs?: number;
    maxRows?: number;
  },
): { rows: ResolvedIssueArchiveRow[]; prunedByAge: number; prunedByCap: number } {
  const now = options?.now ?? Date.now();
  const retentionMs = options?.retentionMs ?? ARCHIVE_RETENTION_MS;
  const maxRows = options?.maxRows ?? ARCHIVE_MAX_ROWS;
  const cutoff = now - retentionMs;

  const kept: ResolvedIssueArchiveRow[] = [];
  let prunedByAge = 0;
  for (const row of rows) {
    const ts = Date.parse(row.resolvedAt);
    if (!Number.isFinite(ts) || ts < cutoff) {
      prunedByAge += 1;
      continue;
    }
    kept.push(row);
  }

  let prunedByCap = 0;
  if (kept.length > maxRows) {
    prunedByCap = kept.length - maxRows;
    return { rows: kept.slice(0, maxRows), prunedByAge, prunedByCap };
  }
  return { rows: kept, prunedByAge, prunedByCap };
}

export type ResolvedIssuesListFilters = {
  entryKey?: string;
  url?: string;
  severity?: "error" | "warning";
  validator?: string;
  category?: string;
  code?: string;
  search?: string;
  includeReopened?: boolean;
  limit?: number;
  offset?: number;
};

export type ResolvedIssuesSummary = {
  total: number;
  errors: number;
  warnings: number;
  reopened: number;
  resolvedCount: number;
};

function entryKeyFromIssue(issue: StoredValidationIssue): string {
  const target = issue.targets.find((t) => t.type === "entry") as
    | { type: "entry"; entryKey?: string }
    | undefined;
  return target?.entryKey ?? "";
}

function urlFromIssue(issue: StoredValidationIssue): string | undefined {
  const target = issue.targets.find((t) => t.type === "entry") as
    | { type: "entry"; url?: string }
    | undefined;
  return target?.url;
}

function emptyArchiveFile(): ResolvedIssuesArchiveFileV1 {
  return { meta: { version: 1 }, rows: [] };
}

function readArchiveFile(filePath: string): ResolvedIssuesArchiveFileV1 {
  if (!fs.existsSync(filePath)) return emptyArchiveFile();
  try {
    const raw = fs.readFileSync(filePath, "utf-8");
    const parsed = JSON.parse(raw) as ResolvedIssuesArchiveFileV1;
    if (!parsed || parsed.meta?.version !== 1 || !Array.isArray(parsed.rows)) {
      return emptyArchiveFile();
    }
    return parsed;
  } catch {
    return emptyArchiveFile();
  }
}

export function issueToArchiveRow(
  issue: StoredValidationIssue,
  args: {
    resolvedBy: string;
    resolvedAt?: string;
    actor?: ValidationIssueActor;
    report?: string;
    agent_session_id?: string;
    resolution: ResolvedIssueArchiveRow["resolution"];
  },
): ResolvedIssueArchiveRow {
  return {
    issueId: issue.id,
    entryKey: entryKeyFromIssue(issue),
    url: urlFromIssue(issue),
    code: issue.code,
    message: issue.message,
    severity: issue.severity === "error" ? "error" : "warning",
    validator: issue.validator,
    category: issue.category,
    file: issue.file,
    suggestion: issue.suggestion,
    resolvedAt: args.resolvedAt ?? new Date().toISOString(),
    resolvedBy: args.resolvedBy,
    ...(args.actor ? { actor: args.actor } : {}),
    ...(args.report ? { report: args.report } : {}),
    ...(args.agent_session_id ? { agent_session_id: args.agent_session_id } : {}),
    resolution: args.resolution,
  };
}

export class ResolvedIssuesArchiveService {
  private rows: ResolvedIssueArchiveRow[] = [];
  private meta: ResolvedIssuesArchiveFileV1["meta"] = { version: 1 };
  private writeQueue: Promise<void> = Promise.resolve();
  private archiveFile: string;
  private contentFolder: string;
  private skipGcsUpload = false;

  constructor(contentRoot: string) {
    this.archiveFile = path.join(contentRoot, SYNC_FILENAMES.validationResolvedArchive);
    this.contentFolder = path.relative(process.cwd(), contentRoot);
    this.loadFromDisk();
  }

  setSkipGcsUpload(skip: boolean): void {
    this.skipGcsUpload = skip;
  }

  private gcsKey(): string {
    return siteSyncGcsKey(this.contentFolder, SYNC_FILENAMES.validationResolvedArchive);
  }

  private loadFromDisk(): void {
    const data = readArchiveFile(this.archiveFile);
    this.meta = data.meta ?? { version: 1 };
    this.rows = data.rows ?? [];
    if (this.enforceRetention()) {
      try {
        this.writeLocalFile();
      } catch (err) {
        log.error({ err }, "[ResolvedArchive] Failed to persist retention prune on load");
      }
      this.saveToBucket();
    }
  }

  private buildFile(): ResolvedIssuesArchiveFileV1 {
    return { meta: this.meta, rows: this.rows };
  }

  private writeLocalFile(): void {
    fs.writeFileSync(this.archiveFile, JSON.stringify(this.buildFile(), null, 2) + "\n", "utf-8");
  }

  private saveToBucket(): void {
    if (!IS_PRODUCTION || !gcs.available || this.skipGcsUpload) return;
    const content = JSON.stringify(this.buildFile(), null, 2) + "\n";
    gcs.debouncedUpload(this.gcsKey(), Buffer.from(content, "utf-8"), "application/json", 30_000);
  }

  flush(): Promise<void> {
    this.writeQueue = this.writeQueue.then(() => this.doFlush()).catch((err) => {
      log.error({ err }, "[ResolvedArchive] Flush error");
    });
    return this.writeQueue;
  }

  private async doFlush(): Promise<void> {
    try {
      this.writeLocalFile();
    } catch (err) {
      log.error({ err }, "[ResolvedArchive] Failed to write archive file");
      return;
    }
    this.saveToBucket();
  }

  /** @returns true if any rows were removed */
  private enforceRetention(now = Date.now()): boolean {
    const before = this.rows.length;
    const { rows, prunedByAge, prunedByCap } = pruneArchiveRows(this.rows, { now });
    this.rows = rows;
    if (prunedByAge > 0 || prunedByCap > 0) {
      log.debug(
        {
          prunedByAge,
          prunedByCap,
          before,
          after: this.rows.length,
          retentionMs: ARCHIVE_RETENTION_MS,
          maxRows: ARCHIVE_MAX_ROWS,
        },
        "[ResolvedArchive] Pruned archive rows",
      );
      return true;
    }
    return false;
  }

  async appendResolved(
    issue: StoredValidationIssue,
    args: {
      resolvedBy: string;
      actor?: ValidationIssueActor;
      report?: string;
      agent_session_id?: string;
      resolution: ResolvedIssueArchiveRow["resolution"];
    },
  ): Promise<void> {
    const report =
      args.report ??
      (args.actor?.type !== "mcp" ? STAFF_DEFAULT_REPORT : undefined);
    this.rows.unshift(
      issueToArchiveRow(issue, {
        resolvedBy: args.resolvedBy,
        actor: args.actor,
        report,
        agent_session_id: args.agent_session_id,
        resolution: args.resolution,
      }),
    );
    this.enforceRetention();
    await this.flush();
  }

  async appendResolvedBatch(
    issues: StoredValidationIssue[],
    args: {
      resolvedBy: string;
      actor?: ValidationIssueActor;
      report?: string;
      agent_session_id?: string;
      resolution: ResolvedIssueArchiveRow["resolution"];
    },
  ): Promise<void> {
    if (issues.length === 0) return;
    const report =
      args.report ??
      (args.actor?.type !== "mcp" ? STAFF_DEFAULT_REPORT : undefined);
    const resolvedAt = new Date().toISOString();
    const newRows = issues.map((issue) =>
      issueToArchiveRow(issue, {
        resolvedBy: args.resolvedBy,
        resolvedAt,
        actor: args.actor,
        report,
        agent_session_id: args.agent_session_id,
        resolution: args.resolution,
      }),
    );
    this.rows.unshift(...newRows);
    this.enforceRetention();
    await this.flush();
  }

  async markReopened(issueId: string, reopenedAt?: string): Promise<boolean> {
    const at = reopenedAt ?? new Date().toISOString();
    const idx = this.rows.findIndex((r) => r.issueId === issueId && !r.reopenedAt);
    if (idx < 0) return false;
    this.rows[idx] = { ...this.rows[idx]!, reopenedAt: at };
    this.enforceRetention();
    await this.flush();
    return true;
  }

  onOpenIssueInserted(issueId: string): void {
    void this.markReopened(issueId).catch((err) => {
      log.warn({ err, issueId }, "[ResolvedArchive] markReopened on insert failed");
    });
  }

  async migrateFromCompletionsOverlay(cache: ValidationCacheService): Promise<number> {
    if (this.meta.migratedCompletions) return 0;
    const completions = cache.getCompletions();
    let migrated = 0;
    for (const [issueId, completion] of Object.entries(completions)) {
      const issue = cache.getIssueById(issueId);
      if (!issue) continue;
      this.rows.unshift(
        issueToArchiveRow(issue, {
          resolvedBy: completion.completedBy,
          resolvedAt: completion.completedAt,
          actor: completion.actor,
          report: completion.report ?? STAFF_DEFAULT_REPORT,
          resolution: "soft_complete",
        }),
      );
      migrated += 1;
    }
    if (migrated > 0) {
      this.enforceRetention();
    }
    this.meta = { ...this.meta, migratedCompletions: true };
    await this.flush();
    if (migrated > 0) {
      log.info({ migrated }, "[ResolvedArchive] Migrated soft-completions overlay");
    }
    return migrated;
  }

  private filterRows(filters?: ResolvedIssuesListFilters): ResolvedIssueArchiveRow[] {
    let rows = [...this.rows];
    if (filters?.includeReopened === false) {
      rows = rows.filter((r) => !r.reopenedAt);
    }
    if (filters?.entryKey) {
      rows = rows.filter((r) => r.entryKey === filters.entryKey);
    }
    if (filters?.url) {
      const want = filters.url.replace(/\/$/, "");
      rows = rows.filter((r) => {
        const got = (r.url ?? "").replace(/\/$/, "");
        return got === want || got.endsWith(want) || want.endsWith(got);
      });
    }
    if (filters?.severity) {
      rows = rows.filter((r) => r.severity === filters.severity);
    }
    if (filters?.validator) {
      rows = rows.filter((r) => r.validator === filters.validator);
    }
    if (filters?.category) {
      rows = rows.filter((r) => r.category === filters.category);
    }
    if (filters?.code) {
      rows = rows.filter((r) => r.code === filters.code);
    }
    if (filters?.search?.trim()) {
      const q = filters.search.trim().toLowerCase();
      rows = rows.filter((r) => {
        const hay = [r.message, r.code, r.url, r.validator, r.category, r.report]
          .filter(Boolean)
          .join(" ")
          .toLowerCase();
        return hay.includes(q);
      });
    }
    return rows;
  }

  summary(filters?: Omit<ResolvedIssuesListFilters, "limit" | "offset">): ResolvedIssuesSummary {
    const rows = this.filterRows({ ...filters, includeReopened: true });
    const errors = rows.filter((r) => r.severity === "error").length;
    const warnings = rows.filter((r) => r.severity === "warning").length;
    const reopened = rows.filter((r) => r.reopenedAt).length;
    const resolvedCount = rows.filter((r) => !r.reopenedAt).length;
    return {
      total: rows.length,
      errors,
      warnings,
      reopened,
      resolvedCount,
    };
  }

  list(filters?: ResolvedIssuesListFilters): {
    rows: ResolvedIssueArchiveRow[];
    total: number;
    summary: ResolvedIssuesSummary;
  } {
    const filtered = this.filterRows(filters);
    const total = filtered.length;
    const offset = Math.max(0, filters?.offset ?? 0);
    const limit = Math.min(200, Math.max(1, filters?.limit ?? 50));
    const rows = filtered.slice(offset, offset + limit);
    const summary = this.summary(filters);
    return { rows, total, summary };
  }

  async loadFromBucket(): Promise<void> {
    if (!IS_PRODUCTION || !gcs.available) return;
    try {
      const result = await gcs.downloadFirstExisting(
        validationResolvedArchiveReadKeys(this.contentFolder),
      );
      if (!result) return;
      const parsed = JSON.parse(result.data.toString("utf-8")) as ResolvedIssuesArchiveFileV1;
      if (!parsed || parsed.meta?.version !== 1 || !Array.isArray(parsed.rows)) return;
      this.meta = parsed.meta;
      this.rows = parsed.rows;
      const pruned = this.enforceRetention();
      this.writeLocalFile();
      if (pruned) this.saveToBucket();
      log.info(`[ResolvedArchive] Loaded ${this.rows.length} rows from GCS`);
    } catch (err) {
      log.error({ err }, "[ResolvedArchive] Error loading from bucket");
    }
  }

  async pullFromBucket(): Promise<{
    success: boolean;
    pulled: boolean;
    gcsKey: string;
    rowCount: number;
    reason?: string;
  }> {
    const gcsKey = this.gcsKey();
    const currentCount = () => this.rows.length;

    if (IS_PRODUCTION) {
      return {
        success: false,
        pulled: false,
        gcsKey,
        rowCount: currentCount(),
        reason:
          "Pull production is only available in development. This host already uses the production archive.",
      };
    }

    if (!gcs.available) {
      gcs.initBootstrapFromEnv();
    }
    if (!gcs.available) {
      return {
        success: false,
        pulled: false,
        gcsKey,
        rowCount: currentCount(),
        reason: "GCS is unavailable — missing GCS_BUCKET_NAME or credentials.",
      };
    }

    try {
      const result = await gcs.downloadFirstExisting(
        validationResolvedArchiveReadKeys(this.contentFolder),
      );
      if (!result) {
        return {
          success: false,
          pulled: false,
          gcsKey,
          rowCount: currentCount(),
          reason: "No validation-resolved-archive.json found in GCS.",
        };
      }

      const parsed = JSON.parse(result.data.toString("utf-8")) as ResolvedIssuesArchiveFileV1;
      if (!parsed || parsed.meta?.version !== 1 || !Array.isArray(parsed.rows)) {
        return {
          success: false,
          pulled: false,
          gcsKey,
          rowCount: currentCount(),
          reason: "GCS validation-resolved-archive.json is invalid.",
        };
      }

      this.meta = parsed.meta;
      this.rows = parsed.rows;
      this.enforceRetention();
      this.writeLocalFile();
      return {
        success: true,
        pulled: true,
        gcsKey: result.key ?? gcsKey,
        rowCount: this.rows.length,
      };
    } catch (err) {
      log.error({ err }, "[ResolvedArchive] pullFromBucket failed");
      return {
        success: false,
        pulled: false,
        gcsKey,
        rowCount: currentCount(),
        reason: err instanceof Error ? err.message : String(err),
      };
    }
  }

  getLocalPath(): string {
    return this.archiveFile;
  }

  getGcsObjectKey(): string {
    return this.gcsKey();
  }

  async forceUploadToBucket(): Promise<{
    success: boolean;
    uploaded: boolean;
    gcsKey: string;
    reason?: string;
  }> {
    const gcsKey = this.gcsKey();
    if (!IS_PRODUCTION) {
      return {
        success: false,
        uploaded: false,
        gcsKey,
        reason: "GCS sync only runs in production (NODE_ENV=production).",
      };
    }
    if (!gcs.available) {
      gcs.initBootstrapFromEnv();
    }
    if (!gcs.available) {
      return {
        success: false,
        uploaded: false,
        gcsKey,
        reason: "GCS is unavailable — missing GCS_BUCKET_NAME or credentials.",
      };
    }
    if (!fs.existsSync(this.archiveFile) && this.rows.length === 0) {
      return {
        success: false,
        uploaded: false,
        gcsKey,
        reason: "No local resolved archive file found to upload.",
      };
    }
    this.writeLocalFile();
    const content = JSON.stringify(this.buildFile(), null, 2) + "\n";
    await gcs.upload(gcsKey, Buffer.from(content, "utf-8"), "application/json");
    log.info("[ResolvedArchive] Re-uploaded archive to GCS via admin action");
    return { success: true, uploaded: true, gcsKey };
  }
}

export async function loadResolvedArchivesFromBucket(): Promise<void> {
  const { getSiteContextMap } = await import("../site-manager");
  await Promise.all(
    [...getSiteContextMap().values()].map((ctx) => ctx.resolvedIssuesArchive.loadFromBucket()),
  );
}
