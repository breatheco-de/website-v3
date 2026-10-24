/**
 * Deploy content check: list content changes on this server that GitHub does not have yet,
 * and push them before a deploy replaces the content folders with a fresh pull.
 */

import { detectPendingChanges, isProtectedLocalDelete, loadSyncState } from "./sync-state";
import {
  flushPendingChanges,
  getAutoCommitStatus,
  getConflictedFiles,
  isAutoCommitEnabled,
  requeueTrackedLocalDirties,
} from "./auto-commit";
import { getSiteConfigs } from "./site-config";
import { logSync } from "./sync-log";

export type UnpushedFile = {
  file: string;
  author: string | null;
  kind: "edit" | "add" | "delete";
};

export type UnpushedList = {
  files: UnpushedFile[];
  /** No recorded sync base: every file would look new, so nothing is counted. */
  baselineMissing: boolean;
};

export type RemainingReason = "conflict" | "push_failed" | "auto_commit_disabled";

export type SiteFlushReport = {
  site: string;
  content_root: string;
  pushed: number;
  pushed_with_service_account: string[];
  remaining: Array<UnpushedFile & { reason: RemainingReason; error?: string }>;
  baseline_missing: boolean;
};

export type FlushReport = { ok: boolean; sites: SiteFlushReport[] };

/** Local edits, additions and intentional deletes of tracked files (incoming remote changes excluded). */
export function listUnpushedContent(contentRoot: string): UnpushedList {
  const state = loadSyncState(contentRoot);
  if (!state.lastSyncedCommit) return { files: [], baselineMissing: true };
  const files: UnpushedFile[] = [];
  for (const change of detectPendingChanges(contentRoot)) {
    if (change.source !== "local") continue;
    if (change.status === "deleted") {
      const info = state.files[change.file];
      if (!info || !isProtectedLocalDelete(info)) continue;
    }
    files.push({
      file: change.file,
      author: change.author ?? null,
      kind: change.status === "deleted" ? "delete" : change.status === "added" ? "add" : "edit",
    });
  }
  return { files: files.sort((a, b) => a.file.localeCompare(b.file)), baselineMissing: false };
}

/** Push every site's unpushed content (service token for authors without a GitHub connection). */
export async function flushUnpushedContent(): Promise<FlushReport> {
  const sites = getSiteConfigs();
  const before = new Map(sites.map((s) => [s.contentFolder, listUnpushedContent(s.contentFolder)]));
  const enabled = isAutoCommitEnabled();

  let flushError: string | undefined;
  let servicePushed = new Set<string>();
  const toPush = Array.from(before.values()).flatMap((l) => l.files);
  if (enabled && toPush.length > 0) {
    requeueTrackedLocalDirties(toPush.map((f) => ({ filePath: f.file, author: f.author ?? undefined })));
    const res = await flushPendingChanges({ serviceTokenForUnconnected: true, waitForCommitMs: 120_000 });
    flushError = res.error;
    servicePushed = new Set(res.servicePushedFiles);
  }

  const conflicted = new Set(getConflictedFiles());
  const lastError = flushError ?? getAutoCommitStatus().lastError ?? undefined;
  const reports: SiteFlushReport[] = sites.map((s) => {
    const prior = before.get(s.contentFolder)!;
    const after = listUnpushedContent(s.contentFolder);
    const remaining = after.files.map((f) => {
      const reason: RemainingReason = !enabled
        ? "auto_commit_disabled"
        : conflicted.has(f.file)
          ? "conflict"
          : "push_failed";
      return { ...f, reason, ...(reason === "push_failed" && lastError ? { error: lastError } : {}) };
    });
    const stillThere = new Set(after.files.map((f) => f.file));
    const report: SiteFlushReport = {
      site: s.domain,
      content_root: s.contentFolder,
      pushed: prior.files.filter((f) => !stillThere.has(f.file)).length,
      pushed_with_service_account: prior.files
        .map((f) => f.file)
        .filter((f) => servicePushed.has(f) && !stillThere.has(f)),
      remaining,
      baseline_missing: prior.baselineMissing,
    };
    if (prior.files.length > 0 || remaining.length > 0) {
      logSync(
        remaining.length ? "ERROR" : "COMMIT",
        `Deploy check: pushed ${report.pushed} unpushed file(s)` +
          (report.pushed_with_service_account.length
            ? ` (${report.pushed_with_service_account.length} with the service account, author had no GitHub connection)`
            : "") +
          (remaining.length ? `; ${remaining.length} could not be pushed: ${remaining.map((r) => r.file).join(", ")}` : ""),
        undefined,
        undefined,
        s.contentFolder,
      );
    }
    return report;
  });

  return { ok: reports.every((r) => r.remaining.length === 0), sites: reports };
}
