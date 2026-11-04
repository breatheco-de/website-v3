/**
 * IndexNow: tells Bing and other IndexNow engines which public URLs changed.
 * Reads the public URL change log after its own bookmark. Only the live server sends.
 * IndexNow never reports indexing; a 200/202 only means the notice was accepted.
 */

import { child } from "./logger";
import { isLiveServer } from "./live-server";
import { getIndexNowSettings, isIndexingBlocked } from "./settings";
import { getSiteConfigs } from "./site-config";
import { enqueueJob } from "./jobs/queue";
import {
  countChangesAfter,
  countState,
  getConsumer,
  getMaxChangeId,
  getScanState,
  listChangesAfter,
  listStateUrlsAfter,
  oldestChangeAfter,
  updateConsumer,
  type PublicUrlChange,
  type PublicUrlConsumer,
} from "./public-url-changes/store";

const log = child({ module: "indexnow" });

export const INDEXNOW_CONSUMER = "indexnow";
export const INDEXNOW_ENDPOINT = "https://api.indexnow.org/indexnow";
export const INDEXNOW_CHUNK_URLS = 500;
export const INDEXNOW_TIMEOUT_MS = 15_000;
export const INDEXNOW_NEXT_CHUNK_DELAY_MS = 120_000;
export const INDEXNOW_STUCK_AFTER_MS = 60 * 60 * 1000;
export const INDEXNOW_REJECTION_WINDOW_MS = 24 * 60 * 60 * 1000;

const MIN = 60 * 1000;
const HOUR = 60 * MIN;
const TRANSIENT_BACKOFF_MS = [2 * MIN, 10 * MIN, 30 * MIN, HOUR];

export type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;

export type IndexNowOutcome =
  | "accepted"
  | "accepted_pending_key"
  | "rejected_key"
  | "rejected_urls"
  | "rate_limited"
  | "error";

export type IndexNowSubmitResult = {
  outcome: IndexNowOutcome;
  status: number | null;
  detail: string;
};

export type IndexNowSubmitPayload = {
  site: string;
  contentRoot: string;
  mode?: "changes" | "all";
  /** Submit-all cursor: last URL already sent. */
  afterUrl?: string;
  /** Submit-all: bookmark target captured when the walk started. */
  allUpToChangeId?: number;
  transientAttempt?: number;
  /** Uniqueness only (coalescing window or self re-enqueue time). */
  window?: number;
  runAt?: number;
};

// ---------------------------------------------------------------------------
// Host + HTTP
// ---------------------------------------------------------------------------

export function normalizeHost(domain: string | null | undefined): string | null {
  const raw = (domain || "").trim();
  if (!raw) return null;
  const host = raw.replace(/^https?:\/\//i, "").replace(/\/.*$/, "").toLowerCase();
  if (!host || host === "localhost" || host.endsWith(".localhost") || host === "127.0.0.1") return null;
  return host;
}

/** sites.yml main domain for a content folder (never aliases). */
export function getSiteMainHost(site: string): string | null {
  try {
    const match = getSiteConfigs().find((c) => c.contentFolder === site);
    return normalizeHost(match?.domain);
  } catch {
    return null;
  }
}

export function keyFileUrl(host: string, key: string): string {
  return `https://${host}/${key}.txt`;
}

export function classifyIndexNowStatus(status: number): IndexNowOutcome {
  if (status === 200) return "accepted";
  if (status === 202) return "accepted_pending_key";
  if (status === 403) return "rejected_key";
  if (status === 422) return "rejected_urls";
  if (status === 429) return "rate_limited";
  return "error";
}

export function indexNowOutcomeDetail(outcome: IndexNowOutcome, status: number | null): string {
  switch (outcome) {
    case "accepted":
      return "Accepted";
    case "accepted_pending_key":
      return "Accepted; the search engine is still checking the key file";
    case "rejected_key":
      return "Key not verified: the key file is not reachable on the live domain or does not match";
    case "rejected_urls":
      return "Rejected: some URLs do not belong to this domain";
    case "rate_limited":
      return "Rate limited, will retry";
    default:
      return status ? `Search engine error (HTTP ${status}), will retry` : "Could not reach IndexNow, will retry";
  }
}

export async function submitUrls(
  host: string,
  key: string,
  urls: string[],
  fetchFn: FetchLike = fetch,
): Promise<IndexNowSubmitResult> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), INDEXNOW_TIMEOUT_MS);
  try {
    const res = await fetchFn(INDEXNOW_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json; charset=utf-8" },
      body: JSON.stringify({ host, key, keyLocation: keyFileUrl(host, key), urlList: urls }),
      signal: controller.signal,
    });
    const outcome = classifyIndexNowStatus(res.status);
    return { outcome, status: res.status, detail: indexNowOutcomeDetail(outcome, res.status) };
  } catch (err) {
    log.warn({ err, host, count: urls.length }, "IndexNow request failed");
    return { outcome: "error", status: null, detail: indexNowOutcomeDetail("error", null) };
  } finally {
    clearTimeout(timer);
  }
}

export type KeyFileCheck = { ok: boolean; url: string; detail: string };

export async function checkKeyFile(host: string, key: string, fetchFn: FetchLike = fetch): Promise<KeyFileCheck> {
  const url = keyFileUrl(host, key);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10_000);
  try {
    const res = await fetchFn(url, { method: "GET", signal: controller.signal, redirect: "manual" });
    if (res.status !== 200) {
      return { ok: false, url, detail: `The live site answered HTTP ${res.status} for the key file` };
    }
    const body = (await res.text()).trim();
    if (body !== key) return { ok: false, url, detail: "The live site serves a different key" };
    return { ok: true, url, detail: "The live site serves the key" };
  } catch {
    return { ok: false, url, detail: "Could not reach the live site" };
  } finally {
    clearTimeout(timer);
  }
}

// ---------------------------------------------------------------------------
// Retry schedule
// ---------------------------------------------------------------------------

export function transientBackoffMs(attempt: number): number {
  return TRANSIENT_BACKOFF_MS[Math.min(Math.max(attempt, 0), TRANSIENT_BACKOFF_MS.length - 1)]!;
}

/** 15 min after the first rejection, then 1 h, then every 4 h. */
export function rejectionBackoffMs(rejectedSince: number, now: number): number {
  const elapsed = now - rejectedSince;
  if (elapsed <= 0) return 15 * MIN;
  if (elapsed < 75 * MIN) return HOUR;
  return 4 * HOUR;
}

/** Clear stopped / rejection state after staff fix something. */
export function resumeIndexNow(site: string): PublicUrlConsumer {
  return updateConsumer(site, INDEXNOW_CONSUMER, { stoppedAt: null, rejectedSince: null, nextAttemptAt: null });
}

// ---------------------------------------------------------------------------
// Enqueue
// ---------------------------------------------------------------------------

export async function enqueueIndexNowSubmit(
  payload: IndexNowSubmitPayload,
  opts?: { delayMs?: number },
): Promise<boolean> {
  if (!isLiveServer()) return false;
  const delayMs = opts?.delayMs ?? 0;
  const body: IndexNowSubmitPayload = {
    ...payload,
    mode: payload.mode ?? "changes",
    ...(payload.runAt == null && payload.window == null ? { window: Math.floor(Date.now() / 30_000) } : {}),
  };
  try {
    const res = await enqueueJob("indexnow_submit", body as unknown as Record<string, unknown>, {
      uniqueKey: `indexnow:${payload.site}`,
      uniqueWhileAlive: true,
      delayMs,
    });
    return res.queued || res.deduped === true;
  } catch (err) {
    log.warn({ err, site: payload.site }, "IndexNow enqueue failed");
    return false;
  }
}

// ---------------------------------------------------------------------------
// Job body
// ---------------------------------------------------------------------------

export type IndexNowRunDeps = {
  now?: number;
  live?: boolean;
  submit?: (host: string, key: string, urls: string[]) => Promise<IndexNowSubmitResult>;
  enqueue?: (payload: IndexNowSubmitPayload, opts?: { delayMs?: number }) => Promise<boolean>;
};

export type IndexNowRunResult = {
  status:
    | "skipped_off_live"
    | "skipped_disabled"
    | "skipped_paused"
    | "skipped_stopped"
    | "skipped_waiting"
    | "nothing_to_send"
    | "sent"
    | "failed";
  sent: number;
  outcome?: IndexNowOutcome;
  more?: boolean;
};

export function changesToUrls(changes: PublicUrlChange[]): string[] {
  const out: string[] = [];
  for (const c of changes) {
    if (c.kind === "moved" && c.previousUrl) out.push(c.previousUrl);
    out.push(c.url);
  }
  return out;
}

function onMainHost(url: string, host: string): boolean {
  try {
    return new URL(url).host.toLowerCase() === host;
  } catch {
    return false;
  }
}

/** Pick changes after the bookmark until the URL list reaches the chunk size. */
export function pickChunk(
  changes: PublicUrlChange[],
  host: string,
  maxUrls = INDEXNOW_CHUNK_URLS,
): { urls: string[]; lastId: number } {
  const urls = new Set<string>();
  let lastId = 0;
  for (const c of changes) {
    const candidate = changesToUrls([c]).filter((u) => onMainHost(u, host));
    if (urls.size > 0 && urls.size + candidate.length > maxUrls) break;
    for (const u of candidate) urls.add(u);
    lastId = c.id;
  }
  return { urls: [...urls], lastId };
}

export async function runIndexNowSubmit(
  payload: IndexNowSubmitPayload,
  deps: IndexNowRunDeps = {},
): Promise<IndexNowRunResult> {
  const { site, contentRoot } = payload;
  const now = deps.now ?? Date.now();
  const live = deps.live ?? isLiveServer();
  const submit = deps.submit ?? ((h, k, u) => submitUrls(h, k, u));
  const enqueue = deps.enqueue ?? enqueueIndexNowSubmit;
  const mode = payload.mode ?? "changes";

  if (!live) return { status: "skipped_off_live", sent: 0 };
  const settings = getIndexNowSettings(contentRoot);
  const host = getSiteMainHost(site);
  if (!settings.enabled || !settings.key || !host) return { status: "skipped_disabled", sent: 0 };
  if (isIndexingBlocked(contentRoot)) return { status: "skipped_paused", sent: 0 };

  const consumer = getConsumer(site, INDEXNOW_CONSUMER);
  if (consumer.stoppedAt) return { status: "skipped_stopped", sent: 0 };
  if (consumer.nextAttemptAt && now + 1000 < consumer.nextAttemptAt) {
    return { status: "skipped_waiting", sent: 0 };
  }

  let urls: string[];
  let advanceTo: number | null = null;
  let nextAfterUrl: string | null = null;
  const allUpTo = payload.allUpToChangeId ?? getMaxChangeId(site);

  if (mode === "all") {
    const page = listStateUrlsAfter(site, payload.afterUrl ?? "", INDEXNOW_CHUNK_URLS);
    urls = page.filter((u) => onMainHost(u, host));
    nextAfterUrl = page.length === INDEXNOW_CHUNK_URLS ? page[page.length - 1]! : null;
    if (!nextAfterUrl) advanceTo = allUpTo;
  } else {
    const changes = listChangesAfter(site, consumer.lastChangeId, INDEXNOW_CHUNK_URLS);
    if (changes.length === 0) return { status: "nothing_to_send", sent: 0 };
    const chunk = pickChunk(changes, host);
    urls = chunk.urls;
    advanceTo = chunk.lastId;
  }

  const hasMore = () =>
    mode === "all" ? nextAfterUrl !== null : countChangesAfter(site, advanceTo ?? consumer.lastChangeId) > 0;

  if (urls.length === 0) {
    if (advanceTo != null && advanceTo > consumer.lastChangeId) {
      updateConsumer(site, INDEXNOW_CONSUMER, { lastChangeId: advanceTo });
    }
    const more = hasMore();
    if (more) await enqueue({ ...payload, afterUrl: nextAfterUrl ?? undefined, allUpToChangeId: allUpTo, runAt: now }, {});
    return { status: "nothing_to_send", sent: 0, more };
  }

  const result = await submit(host, settings.key, urls);
  const base = { lastRunAt: now, lastStatus: result.outcome };

  if (result.outcome === "accepted" || result.outcome === "accepted_pending_key") {
    const patch: Partial<PublicUrlConsumer> = {
      ...base,
      lastError: null,
      lastSubmittedCount: urls.length,
      rejectedSince: null,
      nextAttemptAt: null,
    };
    if (advanceTo != null && advanceTo > consumer.lastChangeId) patch.lastChangeId = advanceTo;
    if (result.outcome === "accepted" && !consumer.verifiedAt) patch.verifiedAt = now;
    updateConsumer(site, INDEXNOW_CONSUMER, patch);
    const more = hasMore();
    if (more) {
      await enqueue(
        { site, contentRoot, mode, afterUrl: nextAfterUrl ?? undefined, allUpToChangeId: allUpTo, runAt: now },
        { delayMs: INDEXNOW_NEXT_CHUNK_DELAY_MS },
      );
    }
    log.info({ site, sent: urls.length, outcome: result.outcome, more }, "IndexNow notices sent");
    return { status: "sent", sent: urls.length, outcome: result.outcome, more };
  }

  if (result.outcome === "rejected_key" || result.outcome === "rejected_urls") {
    const rejectedSince = consumer.rejectedSince ?? now;
    if (now - rejectedSince >= INDEXNOW_REJECTION_WINDOW_MS) {
      updateConsumer(site, INDEXNOW_CONSUMER, {
        ...base,
        lastError: result.detail,
        rejectedSince,
        nextAttemptAt: null,
        stoppedAt: now,
      });
      log.warn({ site, outcome: result.outcome }, "IndexNow stopped after 24 hours of rejections");
      return { status: "failed", sent: 0, outcome: result.outcome };
    }
    const delay = rejectionBackoffMs(consumer.rejectedSince ?? now, now);
    updateConsumer(site, INDEXNOW_CONSUMER, {
      ...base,
      lastError: result.detail,
      rejectedSince,
      nextAttemptAt: now + delay,
    });
    await enqueue({ site, contentRoot, mode, afterUrl: payload.afterUrl, allUpToChangeId: allUpTo, runAt: now }, {
      delayMs: delay,
    });
    return { status: "failed", sent: 0, outcome: result.outcome };
  }

  const attempt = payload.transientAttempt ?? 0;
  const delay = transientBackoffMs(attempt);
  updateConsumer(site, INDEXNOW_CONSUMER, { ...base, lastError: result.detail, nextAttemptAt: now + delay });
  await enqueue(
    {
      site,
      contentRoot,
      mode,
      afterUrl: payload.afterUrl,
      allUpToChangeId: allUpTo,
      transientAttempt: attempt + 1,
      runAt: now,
    },
    { delayMs: delay },
  );
  return { status: "failed", sent: 0, outcome: result.outcome };
}

// ---------------------------------------------------------------------------
// Status (staff)
// ---------------------------------------------------------------------------

export type IndexNowStatus = {
  enabled: boolean;
  key: string;
  keyFileUrl: string | null;
  host: string | null;
  live: boolean;
  bookmark: number;
  waiting: number;
  totalUrls: number;
  lastRunAt: number | null;
  lastStatus: string | null;
  lastError: string | null;
  lastSubmittedCount: number;
  verifiedAt: number | null;
  rejectedSince: number | null;
  nextAttemptAt: number | null;
  stoppedAt: number | null;
  paused: boolean;
  held: { reason: "large_drop"; removedCount: number; at: number | null } | null;
  stuck: boolean;
};

export function getIndexNowStatus(site: string, contentRoot: string, opts?: { now?: number; live?: boolean }): IndexNowStatus {
  const now = opts?.now ?? Date.now();
  const live = opts?.live ?? isLiveServer();
  const settings = getIndexNowSettings(contentRoot);
  const host = getSiteMainHost(site);
  const consumer = getConsumer(site, INDEXNOW_CONSUMER);
  const scan = getScanState(site);
  const waiting = countChangesAfter(site, consumer.lastChangeId);
  const oldest = waiting > 0 ? oldestChangeAfter(site, consumer.lastChangeId) : null;
  const stuck =
    live &&
    settings.enabled &&
    (consumer.stoppedAt != null || (oldest != null && now - oldest.detectedAt > INDEXNOW_STUCK_AFTER_MS));
  return {
    enabled: settings.enabled,
    key: settings.key,
    keyFileUrl: host && settings.key ? keyFileUrl(host, settings.key) : null,
    host,
    live,
    bookmark: consumer.lastChangeId,
    waiting,
    totalUrls: countState(site),
    lastRunAt: consumer.lastRunAt,
    lastStatus: consumer.lastStatus,
    lastError: consumer.lastError,
    lastSubmittedCount: consumer.lastSubmittedCount,
    verifiedAt: consumer.verifiedAt,
    rejectedSince: consumer.rejectedSince,
    nextAttemptAt: consumer.nextAttemptAt,
    stoppedAt: consumer.stoppedAt,
    paused: isIndexingBlocked(contentRoot),
    held:
      scan.heldReason === "large_drop"
        ? { reason: "large_drop", removedCount: scan.heldRemovedCount, at: scan.heldAt }
        : null,
    stuck,
  };
}
