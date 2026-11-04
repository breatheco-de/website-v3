/**
 * Refresh saved external-link statuses from the diagnostics worker. Only the live server
 * (or a dev with LINK_CHECK_LOCAL=1) makes network requests; everyone else reads the
 * synced `link-status.json`.
 */

import { isLiveServer } from "../live-server";
import { child } from "../logger";
import { classifyUrl, type LinkCheckResult } from "./classify";
import {
  hydrateLinkStatusFromGcs,
  linkStatusUploadSettled,
  loadLinkStatus,
  recordCheckResults,
  type LinkStatusRecord,
} from "./status-store";

const log = child({ module: "link-check-refresh" });

export const REFRESH_STALE_MS = 7 * 24 * 60 * 60 * 1000;
export const REFRESH_CAP = 300;
export const PER_HOST_GAP_MS = 2_000;
export const MAX_HOSTS_IN_FLIGHT = 8;
export const REFRESH_BUDGET_MS = 5 * 60 * 1000;
export const REFRESH_REQUEST_TIMEOUT_MS = 10_000;
const SAVE_EVERY = 25;

export function linkChecksEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.LINK_CHECK_LOCAL === "1" || isLiveServer();
}

/**
 * URLs due for a check, never-checked first then oldest. `force` (single-post hard run)
 * ignores the freshness window. "This link works" URLs are skipped unless forced.
 */
export function selectUrlsToCheck(
  urls: Iterable<string>,
  statuses: Record<string, LinkStatusRecord>,
  opts: { now?: number; force?: boolean; staleMs?: number; cap?: number } = {},
): string[] {
  const now = opts.now ?? Date.now();
  const staleMs = opts.staleMs ?? REFRESH_STALE_MS;
  const due: Array<{ url: string; at: number }> = [];
  for (const url of new Set(urls)) {
    const rec = statuses[url];
    if (!rec || rec.never_checked) {
      if (rec?.verified_ok && !opts.force) continue;
      due.push({ url, at: -Infinity });
      continue;
    }
    if (rec.verified_ok && !opts.force) continue;
    const at = Date.parse(rec.checked_at) || 0;
    if (opts.force || now - at >= staleMs) due.push({ url, at });
  }
  due.sort((a, b) => a.at - b.at || a.url.localeCompare(b.url));
  return due.slice(0, opts.cap ?? REFRESH_CAP).map((d) => d.url);
}

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return url;
  }
}

export type RefreshDeps = {
  classify?: (url: string) => Promise<LinkCheckResult>;
  sleep?: (ms: number) => Promise<void>;
  clock?: () => number;
};

export type RefreshOutcome = { selected: number; checked: number; stopped_early: boolean };

/**
 * Check `urls` (already selected): one request at a time per host, `PER_HOST_GAP_MS`
 * between requests to the same host, at most `MAX_HOSTS_IN_FLIGHT` hosts at once.
 * Stops at the time budget; the rest wait for the next run. Results save in batches.
 */
export async function checkUrls(
  contentRoot: string | undefined,
  urls: string[],
  opts: RefreshDeps & {
    budgetMs?: number;
    onProgress?: (done: number, total: number) => void;
  } = {},
): Promise<RefreshOutcome> {
  const classify = opts.classify ?? ((u: string) => classifyUrl(u, { timeoutMs: REFRESH_REQUEST_TIMEOUT_MS }));
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const clock = opts.clock ?? Date.now;
  const deadline = clock() + (opts.budgetMs ?? REFRESH_BUDGET_MS);

  const byHost = new Map<string, string[]>();
  for (const url of urls) {
    const host = hostOf(url);
    const list = byHost.get(host) ?? [];
    list.push(url);
    byHost.set(host, list);
  }
  const hosts = [...byHost.keys()];
  let pending: Array<{ url: string; result: LinkCheckResult }> = [];
  let checked = 0;
  let stoppedEarly = false;

  const flush = () => {
    if (pending.length === 0) return;
    recordCheckResults(contentRoot, pending);
    pending = [];
  };

  const runHost = async (host: string) => {
    const list = byHost.get(host)!;
    for (let i = 0; i < list.length; i++) {
      if (clock() >= deadline) {
        stoppedEarly = true;
        return;
      }
      if (i > 0) await sleep(PER_HOST_GAP_MS);
      const url = list[i]!;
      let result: LinkCheckResult;
      try {
        result = await classify(url);
      } catch (err) {
        result = { status: "unknown", error: (err as Error)?.message ?? "check_failed" };
      }
      pending.push({ url, result });
      checked++;
      opts.onProgress?.(checked, urls.length);
      if (pending.length >= SAVE_EVERY) flush();
    }
  };

  let next = 0;
  const lane = async () => {
    while (next < hosts.length) {
      const host = hosts[next++]!;
      await runHost(host);
    }
  };
  await Promise.all(Array.from({ length: Math.min(MAX_HOSTS_IN_FLIGHT, hosts.length) }, lane));
  flush();
  return { selected: urls.length, checked, stopped_early: stoppedEarly };
}

/** Diagnostics-worker entry: select due URLs for this run's scope and check them. */
export async function refreshExternalLinkStatuses(input: {
  contentRoot: string;
  urls: Iterable<string>;
  force: boolean;
  onProgress?: (done: number, total: number) => void;
}): Promise<RefreshOutcome | null> {
  if (!linkChecksEnabled()) return null;
  await hydrateLinkStatusFromGcs(input.contentRoot);
  const selected = selectUrlsToCheck(input.urls, loadLinkStatus(input.contentRoot).urls, { force: input.force });
  if (selected.length === 0) return { selected: 0, checked: 0, stopped_early: false };
  const outcome = await checkUrls(input.contentRoot, selected, { onProgress: input.onProgress });
  await linkStatusUploadSettled();
  log.info(outcome, "[LinkCheck] refresh done");
  return outcome;
}
