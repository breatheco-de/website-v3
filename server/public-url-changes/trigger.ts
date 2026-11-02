/**
 * Web-process side of the change log: enqueue the debounced scan and stash
 * database-row updates (the debounced job keeps only one set of arguments).
 */

import type { ContentIndex } from "../content-index";
import { getUpdatedAtSource } from "../content-types";
import type { RefreshedDatabaseRow } from "../database-refresh-diff";
import { refreshedRowPaths } from "../events/schedule-html-from-event";
import { enqueueJob } from "../jobs/queue";
import { child } from "../logger";
import { queuePendingUpdates } from "./store";

const log = child({ module: "public-url-changes-trigger" });

export const PUBLIC_URL_SCAN_DELAY_MS = 30_000;

export async function enqueuePublicUrlScan(site: string, contentRoot: string, now = Date.now()): Promise<void> {
  await enqueueJob(
    "public_url_changes_scan",
    { site, contentRoot, window: Math.floor(now / PUBLIC_URL_SCAN_DELAY_MS) },
    { uniqueKey: `public-urls:${site}`, uniqueWhileAlive: true, delayMs: PUBLIC_URL_SCAN_DELAY_MS },
  );
}

function siteBaseUrl(domain: string | undefined | null): string {
  const host = (domain || "").trim().replace(/^https?:\/\//i, "").replace(/\/.*$/, "");
  if (host) return `https://${host}`;
  return (process.env.SITE_URL || "http://localhost:5000").replace(/\/$/, "");
}

/** Database pages whose type has no updated-date source: queue their changed rows as updates. */
export function queueDatabaseRowUpdates(opts: {
  site: string;
  contentRoot: string;
  domain?: string | null;
  contentIndex: ContentIndex;
  dbName: string;
  rows: RefreshedDatabaseRow[];
  causeEventId: number;
}): number {
  if (!opts.dbName || opts.rows.length === 0) return 0;
  try {
    const paths = refreshedRowPaths(
      opts.contentIndex,
      opts.dbName,
      opts.rows,
      (contentType) => !getUpdatedAtSource(contentType, opts.contentRoot)?.trim(),
    );
    if (paths.length === 0) return 0;
    const base = siteBaseUrl(opts.domain);
    const unique = [...new Set(paths)];
    return queuePendingUpdates(
      opts.site,
      unique.map((p) => ({ url: `${base}${p.startsWith("/") ? "" : "/"}${p}`, entryKey: null, causeEventId: opts.causeEventId })),
    );
  } catch (err) {
    log.warn({ err, site: opts.site, dbName: opts.dbName }, "Queueing database row updates failed");
    return 0;
  }
}
