import { Job } from "sidequest";
import { emitEvent } from "../../events/event-store";
import { systemJobAttribution } from "../../events/types";
import { archiveUrl, type ArchiveOutcome } from "../../evidence-archive/archive-org-client";
import type { ArchiveResult } from "../../evidence-archive/rows";
import { isLiveServer } from "../../live-server";
import { child } from "../../logger";
import { markJobFinished, markJobStarted } from "../heartbeat";
import { enqueueJob } from "../queue";

const log = child({ module: "job:evidence-archive" });

export const EVIDENCE_ARCHIVE_JOB = "evidence_archive";
const MAX_ATTEMPTS = 3;
const RETRY_BASE_MS = 30 * 60_000;

export type EvidenceArchivePayload = {
  /** Event-store site key (content root relative to cwd). */
  site: string;
  contentRoot: string;
  database: string;
  source_url: string;
  attempt?: number;
};

export type EvidenceArchiveDonePayload = {
  database: string;
  source_url: string;
  result: ArchiveResult;
};

/** Worker → web applier: the applier writes `_archive` on rows whose link matches and pushes the file. */
export function emitEvidenceArchiveDone(site: string, payload: EvidenceArchiveDonePayload, emit: typeof emitEvent = emitEvent): void {
  emit({
    site,
    type: "evidence_archive_done",
    resource: { path: `db/${payload.database}` },
    attribution: systemJobAttribution("evidence-archive"),
    payload: payload as unknown as Record<string, unknown>,
  });
}

/** Queue one archive attempt per site / database / link (deduped while one is waiting or running). */
export async function enqueueEvidenceArchive(
  payload: EvidenceArchivePayload,
  opts: { delayMs?: number } = {},
  enqueue: typeof enqueueJob = enqueueJob,
): Promise<boolean> {
  const res = await enqueue(EVIDENCE_ARCHIVE_JOB, payload as unknown as Record<string, unknown>, {
    uniqueKey: `${EVIDENCE_ARCHIVE_JOB}:${payload.site}:${payload.database}:${payload.source_url}`,
    uniqueWhileAlive: true,
    ...(opts.delayMs ? { delayMs: opts.delayMs } : {}),
  });
  return res.queued || res.deduped === true;
}

export type EvidenceArchiveDeps = {
  isLive: () => boolean;
  archive: (url: string) => Promise<ArchiveOutcome>;
  emit: typeof emitEvent;
  enqueue: typeof enqueueJob;
  now: () => Date;
};

const defaultDeps: EvidenceArchiveDeps = {
  isLive: isLiveServer,
  archive: (url) => archiveUrl(url),
  emit: emitEvent,
  enqueue: enqueueJob,
  now: () => new Date(),
};

/**
 * Find or create an archive.org copy of one source link (live server only). Busy / rate-limited
 * failures retry up to MAX_ATTEMPTS with growing delays before the failure is reported.
 */
export async function runEvidenceArchive(
  payload: EvidenceArchivePayload,
  deps: EvidenceArchiveDeps = defaultDeps,
): Promise<{ status: "skipped" | "retry_scheduled" | ArchiveOutcome["status"] }> {
  if (!deps.isLive()) {
    log.info("[EvidenceArchiveJob] skipped: not the live server");
    return { status: "skipped" };
  }
  if (!payload?.site || !payload.database || !payload.source_url) return { status: "skipped" };
  const outcome = await deps.archive(payload.source_url);
  const attempt = payload.attempt ?? 1;
  if (outcome.status === "failed" && outcome.retryable && attempt < MAX_ATTEMPTS) {
    await enqueueEvidenceArchive(
      { ...payload, attempt: attempt + 1 },
      { delayMs: RETRY_BASE_MS * 2 ** (attempt - 1) },
      deps.enqueue,
    );
    log.info({ database: payload.database, url: payload.source_url, attempt, error: outcome.error }, "[EvidenceArchiveJob] retry scheduled");
    return { status: "retry_scheduled" };
  }
  emitEvidenceArchiveDone(
    payload.site,
    {
      database: payload.database,
      source_url: payload.source_url,
      result: { kind: "archive", outcome, at: deps.now().toISOString() },
    },
    deps.emit,
  );
  log.info({ database: payload.database, url: payload.source_url, status: outcome.status }, "[EvidenceArchiveJob] done");
  return { status: outcome.status };
}

export class EvidenceArchiveJob extends Job {
  async run(payload: EvidenceArchivePayload): Promise<{ status: string }> {
    markJobStarted(EVIDENCE_ARCHIVE_JOB);
    try {
      return await runEvidenceArchive(payload);
    } finally {
      markJobFinished(EVIDENCE_ARCHIVE_JOB);
    }
  }
}
