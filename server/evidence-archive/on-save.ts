import { ARCHIVE_KEY, readArchiveRecord, rowNeedsArchive, rowProofLink } from "@shared/evidence-archive";
import { readEvidenceConfig } from "@shared/evidence-kinds";
import { enqueueEvidenceArchive } from "../jobs/definitions/evidence-archive";
import { isLiveServer } from "../live-server";
import { child } from "../logger";
import { pendingRecord } from "./rows";

const log = child({ module: "evidence-archive" });

/** archive.org rate-limits saves: cap and space the attempts one save queues. */
const MAX_PER_SAVE = 25;
const SPACING_MS = 2 * 60_000;

/**
 * Live server only: rows (about to be written) whose link has no copy yet get a pending `_archive`
 * record, in place. Returns the links to queue once the file is written. Failed copies are not
 * retried here (staff Retry or the weekly sweep do that).
 */
export function markRowsPendingArchive(
  rows: Record<string, unknown>[],
  evidence: unknown,
  opts: { live?: boolean; now?: Date } = {},
): string[] {
  const cfg = readEvidenceConfig(evidence);
  if (!cfg || !(opts.live ?? isLiveServer())) return [];
  const at = (opts.now ?? new Date()).toISOString();
  const links = new Set<string>();
  for (const row of rows) {
    if (links.size >= MAX_PER_SAVE) break;
    if (!rowNeedsArchive(row, cfg.proof_field, { retryFailedAfterMs: Number.POSITIVE_INFINITY })) continue;
    const link = rowProofLink(row, cfg.proof_field)!;
    row[ARCHIVE_KEY] = pendingRecord(readArchiveRecord(row), link, at);
    links.add(link);
  }
  return Array.from(links);
}

export function queueArchiveJobs(opts: { site: string; contentRoot: string; database: string; links: string[] }): void {
  opts.links.forEach((link, i) => {
    void enqueueEvidenceArchive(
      { site: opts.site, contentRoot: opts.contentRoot, database: opts.database, source_url: link },
      { delayMs: i * SPACING_MS },
    ).catch((err) => log.warn({ err, database: opts.database, link }, "[EvidenceArchive] could not queue archive job"));
  });
}
