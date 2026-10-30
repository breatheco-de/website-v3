/**
 * archive.org client for evidence copies: Wayback availability lookup (no key) and
 * Save Page Now 2 (needs ARCHIVE_ORG_ACCESS_KEY / ARCHIVE_ORG_SECRET_KEY).
 */

import {
  archiveCopyCapturedAt,
  isArchiveCopyUrl,
  waybackCapturedAt,
  waybackTimestampToIso,
} from "@shared/evidence-archive";

const AVAILABILITY_URL = "https://archive.org/wayback/available";
const SAVE_URL = "https://web.archive.org/save";
const STATUS_URL = "https://web.archive.org/save/status";
const USER_AGENT = "website-v3 evidence-archive (+https://archive.org/account)";
const REQUEST_TIMEOUT_MS = 30_000;

export type FetchLike = typeof fetch;

export type ArchiveOrgKeys = { access: string; secret: string };

export function getArchiveOrgKeys(env: NodeJS.ProcessEnv = process.env): ArchiveOrgKeys | null {
  const access = env.ARCHIVE_ORG_ACCESS_KEY?.trim();
  const secret = env.ARCHIVE_ORG_SECRET_KEY?.trim();
  return access && secret ? { access, secret } : null;
}

export type Snapshot = { url: string; captured_at: string | null };

export type ArchiveOutcome =
  | { status: "archived"; url: string; captured_at: string | null }
  | { status: "failed"; error: string; retryable: boolean };

function authHeaders(keys: ArchiveOrgKeys): Record<string, string> {
  return { Authorization: `LOW ${keys.access}:${keys.secret}` };
}

function toHttps(url: string): string {
  return url.replace(/^http:\/\//i, "https://");
}

/** Closest existing Wayback snapshot that loaded with a 2xx, or null. Throws on network errors. */
export async function lookupSnapshot(url: string, fetchImpl: FetchLike = fetch): Promise<Snapshot | null> {
  const res = await fetchImpl(`${AVAILABILITY_URL}?url=${encodeURIComponent(url)}`, {
    headers: { Accept: "application/json", "User-Agent": USER_AGENT },
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`archive.org lookup returned HTTP ${res.status}`);
  const body = (await res.json()) as {
    archived_snapshots?: { closest?: { available?: boolean; url?: string; timestamp?: string; status?: string } };
  };
  const c = body.archived_snapshots?.closest;
  if (!c?.available || typeof c.url !== "string" || !String(c.status ?? "").startsWith("2")) return null;
  const snapshotUrl = toHttps(c.url);
  return {
    url: snapshotUrl,
    captured_at: (c.timestamp && waybackTimestampToIso(c.timestamp)) || waybackCapturedAt(snapshotUrl),
  };
}

const RETRYABLE_SPN_ERRORS = new Set([
  "error:service-unavailable",
  "error:user-session-limit",
  "error:too-many-daily-captures",
  "error:soft-time-limit-exceeded",
  "error:browsing-timeout",
  "error:proxy-error",
  "error:internal-server-error",
  "error:gateway-timeout",
  "error:celery",
  "error:capture-location-error",
  "error:cannot-fetch",
]);

const SPN_ERROR_TEXT: Record<string, string> = {
  "error:blocked": "This site blocks archive.org.",
  "error:blocked-url": "This site blocks archive.org.",
  "error:blocked-client-ip": "This site blocks archive.org.",
  "error:robots-txt": "This site blocks archive.org (robots.txt).",
  "error:no-access": "The page needs a login or refused archive.org.",
  "error:not-found": "The page returned 404 when archive.org visited it.",
  "error:invalid-url-syntax": "archive.org could not read this link.",
  "error:invalid-host-resolution": "The link's domain does not resolve.",
  "error:too-many-redirects": "The page redirects too many times.",
  "error:too-many-daily-captures": "archive.org's daily save limit was reached; it will retry.",
  "error:user-session-limit": "archive.org is busy with other saves; it will retry.",
};

function spnFailure(statusExt: string | undefined, message: string | undefined): ArchiveOutcome {
  const code = (statusExt ?? "").trim();
  return {
    status: "failed",
    error: SPN_ERROR_TEXT[code] ?? (message?.trim() || (code ? `archive.org: ${code}` : "archive.org could not save the page.")),
    retryable: RETRYABLE_SPN_ERRORS.has(code),
  };
}

/** Starts a Save Page Now 2 capture. */
export async function requestSave(
  url: string,
  keys: ArchiveOrgKeys,
  fetchImpl: FetchLike = fetch,
): Promise<{ ok: true; jobId: string } | { ok: false; outcome: ArchiveOutcome }> {
  const res = await fetchImpl(SAVE_URL, {
    method: "POST",
    headers: {
      ...authHeaders(keys),
      Accept: "application/json",
      "Content-Type": "application/x-www-form-urlencoded",
      "User-Agent": USER_AGENT,
    },
    body: new URLSearchParams({ url, skip_first_archive: "1" }).toString(),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  if (res.status === 401 || res.status === 403) {
    return { ok: false, outcome: { status: "failed", error: "archive.org rejected the API keys.", retryable: false } };
  }
  if (res.status === 429 || res.status >= 500) {
    return {
      ok: false,
      outcome: { status: "failed", error: `archive.org is busy (HTTP ${res.status}); it will retry.`, retryable: true },
    };
  }
  const body = (await res.json().catch(() => ({}))) as { job_id?: string; status?: string; status_ext?: string; message?: string };
  if (typeof body.job_id === "string" && body.job_id) return { ok: true, jobId: body.job_id };
  return { ok: false, outcome: spnFailure(body.status_ext, body.message) };
}

export type SaveStatus = { state: "pending" } | { state: "done"; outcome: ArchiveOutcome };

export async function getSaveStatus(
  jobId: string,
  keys: ArchiveOrgKeys,
  fetchImpl: FetchLike = fetch,
): Promise<SaveStatus> {
  const res = await fetchImpl(`${STATUS_URL}/${encodeURIComponent(jobId)}`, {
    headers: { ...authHeaders(keys), Accept: "application/json", "User-Agent": USER_AGENT },
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  if (res.status === 429 || res.status >= 500) return { state: "pending" };
  const body = (await res.json().catch(() => ({}))) as {
    status?: string;
    timestamp?: string;
    original_url?: string;
    status_ext?: string;
    message?: string;
  };
  if (body.status === "pending") return { state: "pending" };
  if (body.status === "success" && body.timestamp && body.original_url) {
    return {
      state: "done",
      outcome: {
        status: "archived",
        url: `https://web.archive.org/web/${body.timestamp}/${body.original_url}`,
        captured_at: waybackTimestampToIso(body.timestamp),
      },
    };
  }
  return { state: "done", outcome: spnFailure(body.status_ext, body.message) };
}

export type ArchiveUrlOpts = {
  keys?: ArchiveOrgKeys | null;
  fetchImpl?: FetchLike;
  pollIntervalMs?: number;
  maxWaitMs?: number;
  sleep?: (ms: number) => Promise<void>;
};

const defaultSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/**
 * Existing snapshot when there is one; otherwise a new Save Page Now capture, polled until done
 * or maxWaitMs. Never throws: network trouble becomes a retryable failure.
 */
export async function archiveUrl(url: string, opts: ArchiveUrlOpts = {}): Promise<ArchiveOutcome> {
  const fetchImpl = opts.fetchImpl ?? fetch;
  const sleep = opts.sleep ?? defaultSleep;
  const keys = opts.keys === undefined ? getArchiveOrgKeys() : opts.keys;
  if (isArchiveCopyUrl(url)) return { status: "archived", url, captured_at: archiveCopyCapturedAt(url) };
  try {
    const hit = await lookupSnapshot(url, fetchImpl);
    if (hit) return { status: "archived", url: hit.url, captured_at: hit.captured_at };
  } catch (err) {
    if (!keys) {
      return { status: "failed", error: `archive.org lookup failed: ${(err as Error).message}`, retryable: true };
    }
  }
  if (!keys) return { status: "failed", error: "archive.org keys not set", retryable: false };
  try {
    const started = await requestSave(url, keys, fetchImpl);
    if (!started.ok) return started.outcome;
    const deadline = Date.now() + (opts.maxWaitMs ?? 4 * 60_000);
    const interval = opts.pollIntervalMs ?? 10_000;
    while (Date.now() < deadline) {
      await sleep(interval);
      const status = await getSaveStatus(started.jobId, keys, fetchImpl);
      if (status.state === "done") return status.outcome;
    }
    return { status: "failed", error: "archive.org is still saving the page; it will retry.", retryable: true };
  } catch (err) {
    return { status: "failed", error: `archive.org request failed: ${(err as Error).message}`, retryable: true };
  }
}

export type OriginalCheck = "ok" | "gone" | "unknown";

/** 404 / 410 → gone; 2xx / 3xx → ok; anything else (timeouts, 5xx, 403 walls) → unknown. */
export async function checkOriginal(url: string, fetchImpl: FetchLike = fetch): Promise<OriginalCheck> {
  const attempt = async (method: "HEAD" | "GET") =>
    fetchImpl(url, {
      method,
      redirect: "follow",
      headers: { "User-Agent": USER_AGENT, Accept: "text/html,*/*" },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  try {
    let res = await attempt("HEAD");
    if (res.status === 405 || res.status === 403 || res.status === 501) res = await attempt("GET");
    if (res.status === 404 || res.status === 410) return "gone";
    if (res.status >= 200 && res.status < 400) return "ok";
    return "unknown";
  } catch {
    return "unknown";
  }
}
