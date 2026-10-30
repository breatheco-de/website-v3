import fs from "fs";
import os from "os";
import path from "path";
import { Job } from "sidequest";
import { currentArchiveRecord, isArchiveCopyUrl, rowNeedsArchive, rowProofLink } from "@shared/evidence-archive";
import { emitEvent } from "../../events/event-store";
import { checkOriginal, type OriginalCheck } from "../../evidence-archive/archive-org-client";
import { listEvidenceDatabases, readEvidenceRows } from "../../evidence-archive/rows";
import { isLiveServer, liveServerStatus } from "../../live-server";
import { child } from "../../logger";
import { getSiteConfigs } from "../../site-config";
import { markJobFinished, markJobStarted } from "../heartbeat";
import { enqueueJob, scheduleJob } from "../queue";
import { emitEvidenceArchiveDone, enqueueEvidenceArchive } from "./evidence-archive";

const log = child({ module: "job:evidence-archive-sweep" });

export const EVIDENCE_ARCHIVE_SWEEP_JOB = "evidence_archive_sweep";
/** Mondays 6 AM ET. */
export const EVIDENCE_ARCHIVE_SWEEP_CRON = "0 6 * * 1";
export const EVIDENCE_ARCHIVE_SWEEP_TZ = "America/New_York";
const WEEK_MS = 7 * 24 * 60 * 60 * 1000;
/** archive.org rate-limits saves: cap and space the archive attempts one sweep queues. */
const MAX_ARCHIVES_PER_RUN = 25;
const ARCHIVE_SPACING_MS = 2 * 60_000;

const stateFile = process.env.VITEST
  ? path.join(os.tmpdir(), `website-v3-vitest-evidence-sweep-${process.pid}.json`)
  : path.resolve("data", "evidence-archive-sweep.json");

export function lastSweepStartedAt(file: string = stateFile): string | undefined {
  try {
    const raw = JSON.parse(fs.readFileSync(file, "utf-8")) as { lastStartedAt?: unknown };
    return typeof raw.lastStartedAt === "string" ? raw.lastStartedAt : undefined;
  } catch {
    return undefined;
  }
}

function recordSweepStarted(at: string, file: string = stateFile): void {
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify({ lastStartedAt: at }));
  } catch (err) {
    log.warn({ err }, "[EvidenceArchiveSweep] could not record the run time");
  }
}

export type SweepSite = { site: string; contentRoot: string };

function sweepSites(): SweepSite[] {
  return getSiteConfigs().map((config) => {
    const contentRoot = path.isAbsolute(config.contentFolder)
      ? config.contentFolder
      : path.join(process.cwd(), config.contentFolder);
    return { site: path.relative(process.cwd(), contentRoot), contentRoot };
  });
}

export type EvidenceArchiveSweepDeps = {
  isLive: () => boolean;
  sites: () => SweepSite[];
  checkOriginal: (url: string) => Promise<OriginalCheck>;
  enqueueArchive: typeof enqueueEvidenceArchive;
  emit: typeof emitEvent;
  now: () => Date;
  recordStarted: (at: string) => void;
};

const defaultDeps: EvidenceArchiveSweepDeps = {
  isLive: isLiveServer,
  sites: sweepSites,
  checkOriginal: (url) => checkOriginal(url),
  enqueueArchive: enqueueEvidenceArchive,
  emit: emitEvent,
  now: () => new Date(),
  recordStarted: (at) => recordSweepStarted(at),
};

/**
 * Weekly (live server only), for every evidence database row with a link:
 * queue an archive attempt when there is no copy, a stale one, a stuck pending one or a failure
 * older than a week; and check whether the original still loads (404 / 410 = gone).
 * The first run fills in rows that predate archiving.
 */
export async function runEvidenceArchiveSweep(
  deps: EvidenceArchiveSweepDeps = defaultDeps,
): Promise<{ queued: number; original_changed: number; skipped?: true }> {
  if (!deps.isLive()) {
    log.info("[EvidenceArchiveSweep] skipped: not the live server");
    return { queued: 0, original_changed: 0, skipped: true };
  }
  const startedAt = deps.now();
  deps.recordStarted(startedAt.toISOString());
  let queued = 0;
  let originalChanged = 0;
  for (const { site, contentRoot } of deps.sites()) {
    for (const db of listEvidenceDatabases(contentRoot)) {
      const seen = new Set<string>();
      let rows: Record<string, unknown>[];
      try {
        rows = readEvidenceRows(db);
      } catch (err) {
        log.warn({ err, site, database: db.dbName }, "[EvidenceArchiveSweep] could not read rows");
        continue;
      }
      for (const row of rows) {
        const link = rowProofLink(row, db.cfg.proof_field);
        if (!link || isArchiveCopyUrl(link) || seen.has(link)) continue;
        seen.add(link);
        if (queued < MAX_ARCHIVES_PER_RUN && rowNeedsArchive(row, db.cfg.proof_field, { now: startedAt.getTime(), retryFailedAfterMs: WEEK_MS })) {
          const ok = await deps.enqueueArchive(
            { site, contentRoot, database: db.dbName, source_url: link },
            { delayMs: queued * ARCHIVE_SPACING_MS },
          );
          if (ok) queued++;
        }
        const rec = currentArchiveRecord(row, db.cfg.proof_field);
        if (!rec) continue;
        const check = await deps.checkOriginal(link);
        if (check === "unknown" || rec.original?.status === check) continue;
        if (!rec.original && check === "ok") continue;
        emitEvidenceArchiveDone(
          site,
          { database: db.dbName, source_url: link, result: { kind: "original", original: check, at: deps.now().toISOString() } },
          deps.emit,
        );
        originalChanged++;
      }
    }
  }
  log.info({ queued, original_changed: originalChanged }, "[EvidenceArchiveSweep] done");
  return { queued, original_changed: originalChanged };
}

export class EvidenceArchiveSweepJob extends Job {
  async run(): Promise<{ queued: number; original_changed: number }> {
    markJobStarted(EVIDENCE_ARCHIVE_SWEEP_JOB);
    try {
      return await runEvidenceArchiveSweep();
    } finally {
      markJobFinished(EVIDENCE_ARCHIVE_SWEEP_JOB);
    }
  }
}

export type ScheduleEvidenceArchiveSweepDeps = {
  isLive: () => boolean;
  lastStartedAt: () => string | undefined;
  schedule: typeof scheduleJob;
  enqueue: typeof enqueueJob;
  now: () => number;
};

const defaultScheduleDeps: ScheduleEvidenceArchiveSweepDeps = {
  isLive: isLiveServer,
  lastStartedAt: () => lastSweepStartedAt(),
  schedule: scheduleJob,
  enqueue: enqueueJob,
  now: Date.now,
};

/** Worker startup: register the weekly cron and catch up when no sweep ran in the last week (or ever). */
export async function scheduleEvidenceArchiveSweep(
  deps: ScheduleEvidenceArchiveSweepDeps = defaultScheduleDeps,
): Promise<{ scheduled: boolean; catch_up: boolean }> {
  if (!deps.isLive()) {
    if (liveServerStatus().production_mode) {
      log.warn("[EvidenceArchiveSweep] evidence archiving is off on this server: production mode, but SITE_URL is not a sites.yml domain");
    }
    return { scheduled: false, catch_up: false };
  }
  const scheduled = await deps.schedule(EVIDENCE_ARCHIVE_SWEEP_JOB, EVIDENCE_ARCHIVE_SWEEP_CRON, {
    timezone: EVIDENCE_ARCHIVE_SWEEP_TZ,
  });
  const last = Date.parse(deps.lastStartedAt() ?? "");
  if (Number.isFinite(last) && deps.now() - last < WEEK_MS) return { scheduled, catch_up: false };
  await deps.enqueue(EVIDENCE_ARCHIVE_SWEEP_JOB, {}, { uniqueKey: EVIDENCE_ARCHIVE_SWEEP_JOB, uniqueWithArgs: false });
  log.info("[EvidenceArchiveSweep] queued catch-up sweep");
  return { scheduled, catch_up: true };
}
