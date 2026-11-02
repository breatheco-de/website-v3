/**
 * Saved result per external URL (`link-status.json` in the content root).
 * Written by the diagnostics worker (checks) and the web process ("This link works");
 * validators only read it. Production persists it to GCS so deploys keep history.
 */

import * as fs from "fs";
import * as path from "path";
import { siteSyncGcsKey, SYNC_FILENAMES } from "@shared/gcsKeys";
import { gcs } from "../gcs";
import { getDefaultContentRoot } from "../site-config";
import { child } from "../logger";
import { invertExternalLinks } from "../link-index";
import type { LinkCheckReason, LinkCheckResult, LinkCheckStatus } from "./classify";

const log = child({ module: "link-status" });

export const LINK_STATUS_FILENAME = SYNC_FILENAMES.linkStatus;
/** A dead or unreachable result counts only after a second one at least this long after the first. */
export const CONFIRM_MIN_GAP_MS = 3 * 24 * 60 * 60 * 1000;

export type VerifiedOk = { by: string; at: string; reason: string };

export type LinkStatusRecord = {
  status: LinkCheckStatus;
  reason?: LinkCheckReason;
  http_status?: number;
  final_url?: string;
  error?: string;
  checked_at: string;
  first_seen_at: string;
  gone_streak: number;
  unreachable_streak: number;
  /** `checked_at` of the first result in the current gone / unreachable streak. */
  streak_started_at?: string;
  verified_ok?: VerifiedOk;
  /** Created by "This link works" before any check ran. */
  never_checked?: true;
};

export type LinkStatusFile = {
  version: 1;
  updated_at: string;
  urls: Record<string, LinkStatusRecord>;
};

export type LinkCoverage = {
  total: number;
  checked: number;
  gone: number;
  unreachable: number;
  verified_ok: number;
};

function absRoot(contentRoot?: string): string {
  if (!contentRoot) return getDefaultContentRoot();
  return path.isAbsolute(contentRoot) ? contentRoot : path.join(process.cwd(), contentRoot);
}

function filePath(contentRoot?: string): string {
  return path.join(absRoot(contentRoot), LINK_STATUS_FILENAME);
}

function emptyFile(): LinkStatusFile {
  return { version: 1, updated_at: new Date().toISOString(), urls: {} };
}

const hydrated = new Set<string>();

/** Production: pull the GCS copy when there is no local file (fresh release folder). */
export async function hydrateLinkStatusFromGcs(contentRoot?: string): Promise<void> {
  const root = absRoot(contentRoot);
  if (hydrated.has(root)) return;
  hydrated.add(root);
  if (process.env.NODE_ENV !== "production") return;
  if (fs.existsSync(filePath(contentRoot))) return;
  if (!gcs.available) gcs.initBootstrapFromEnv();
  if (!gcs.available) return;
  const key = siteSyncGcsKey(path.basename(root), LINK_STATUS_FILENAME);
  try {
    const result = await gcs.downloadFirstExisting([key]);
    if (!result) return;
    fs.writeFileSync(filePath(contentRoot), result.data.toString("utf-8"), "utf-8");
    log.info({ key }, "[LinkStatus] Hydrated from GCS");
  } catch (err) {
    log.warn({ err, key }, "[LinkStatus] GCS hydrate failed");
  }
}

export async function loadLinkStatusFromBucket(sites: Array<{ contentRoot?: string }>): Promise<void> {
  await Promise.all(sites.map((s) => hydrateLinkStatusFromGcs(s.contentRoot)));
}

/** Always reads disk: two processes write this file. */
export function loadLinkStatus(contentRoot?: string): LinkStatusFile {
  const fp = filePath(contentRoot);
  if (!fs.existsSync(fp)) return emptyFile();
  try {
    const parsed = JSON.parse(fs.readFileSync(fp, "utf-8")) as LinkStatusFile;
    if (!parsed || parsed.version !== 1 || typeof parsed.urls !== "object" || !parsed.urls) return emptyFile();
    return parsed;
  } catch {
    return emptyFile();
  }
}

let lastUpload: Promise<void> = Promise.resolve();

function save(data: LinkStatusFile, contentRoot?: string): void {
  data.updated_at = new Date().toISOString();
  const fp = filePath(contentRoot);
  const body = JSON.stringify(data, null, 2) + "\n";
  const tmp = `${fp}.${process.pid}.tmp`;
  fs.mkdirSync(path.dirname(fp), { recursive: true });
  fs.writeFileSync(tmp, body, "utf-8");
  fs.renameSync(tmp, fp);
  if (process.env.NODE_ENV !== "production") return;
  if (!gcs.available) gcs.initBootstrapFromEnv();
  if (!gcs.available) return;
  const key = siteSyncGcsKey(path.basename(absRoot(contentRoot)), LINK_STATUS_FILENAME);
  lastUpload = gcs
    .upload(key, Buffer.from(body, "utf-8"), "application/json")
    .then(() => undefined)
    .catch((err) => log.warn({ err, key }, "[LinkStatus] GCS upload failed"));
}

/** Resolves once the most recent GCS upload settled (the diagnostics worker awaits it before exiting). */
export function linkStatusUploadSettled(): Promise<void> {
  return lastUpload;
}

/** Re-read, mutate, write — keeps the window for clobbering the other writer short. */
export function updateLinkStatus(contentRoot: string | undefined, mutate: (data: LinkStatusFile) => void): LinkStatusFile {
  const data = loadLinkStatus(contentRoot);
  mutate(data);
  save(data, contentRoot);
  return data;
}

/** Next record after one check. `unknown` keeps streaks as they are; `ok` resets them. */
export function applyCheckResult(
  prev: LinkStatusRecord | undefined,
  result: LinkCheckResult,
  now: Date = new Date(),
): LinkStatusRecord {
  const at = now.toISOString();
  const base: LinkStatusRecord = {
    status: result.status,
    ...(result.reason ? { reason: result.reason } : {}),
    ...(result.http_status !== undefined ? { http_status: result.http_status } : {}),
    ...(result.final_url ? { final_url: result.final_url } : {}),
    ...(result.error ? { error: result.error } : {}),
    checked_at: at,
    first_seen_at: prev?.first_seen_at ?? at,
    gone_streak: 0,
    unreachable_streak: 0,
    ...(prev?.verified_ok ? { verified_ok: prev.verified_ok } : {}),
  };
  if (result.status === "gone") {
    const continuing = (prev?.gone_streak ?? 0) > 0;
    base.gone_streak = continuing ? prev!.gone_streak + 1 : 1;
    base.streak_started_at = continuing ? prev!.streak_started_at ?? prev!.checked_at : at;
  } else if (result.status === "unreachable") {
    const continuing = (prev?.unreachable_streak ?? 0) > 0;
    base.unreachable_streak = continuing ? prev!.unreachable_streak + 1 : 1;
    base.streak_started_at = continuing ? prev!.streak_started_at ?? prev!.checked_at : at;
  } else if (result.status === "unknown" && prev) {
    base.gone_streak = prev.gone_streak;
    base.unreachable_streak = prev.unreachable_streak;
    if (prev.streak_started_at) base.streak_started_at = prev.streak_started_at;
    // Keep the last definite answer so a flaky recheck does not hide a confirmed result.
    if (prev.status === "gone" || prev.status === "unreachable") {
      base.status = prev.status;
      if (prev.reason) base.reason = prev.reason;
      if (prev.final_url) base.final_url = prev.final_url;
    }
  }
  return base;
}

function streakSpanOk(rec: LinkStatusRecord): boolean {
  if (!rec.streak_started_at) return false;
  return Date.parse(rec.checked_at) - Date.parse(rec.streak_started_at) >= CONFIRM_MIN_GAP_MS;
}

export function isConfirmedGone(rec: LinkStatusRecord | undefined): boolean {
  return !!rec && !rec.verified_ok && rec.gone_streak >= 2 && streakSpanOk(rec);
}

export function isConfirmedUnreachable(rec: LinkStatusRecord | undefined): boolean {
  return !!rec && !rec.verified_ok && rec.unreachable_streak >= 2 && streakSpanOk(rec);
}

export function recordCheckResults(
  contentRoot: string | undefined,
  results: Array<{ url: string; result: LinkCheckResult }>,
  now: Date = new Date(),
): void {
  if (results.length === 0) return;
  updateLinkStatus(contentRoot, (data) => {
    for (const { url, result } of results) data.urls[url] = applyCheckResult(data.urls[url], result, now);
  });
}

export function setVerifiedOk(
  contentRoot: string | undefined,
  url: string,
  mark: { by: string; reason: string },
  now: Date = new Date(),
): LinkStatusRecord {
  let out!: LinkStatusRecord;
  updateLinkStatus(contentRoot, (data) => {
    const at = now.toISOString();
    const prev = data.urls[url];
    out = {
      ...(prev ?? {
        status: "unknown",
        checked_at: at,
        first_seen_at: at,
        gone_streak: 0,
        unreachable_streak: 0,
        never_checked: true,
      }),
      verified_ok: { by: mark.by, at, reason: mark.reason },
    };
    data.urls[url] = out;
  });
  return out;
}

/** Returns true when a mark was removed. */
export function clearVerifiedOk(contentRoot: string | undefined, url: string): boolean {
  let removed = false;
  updateLinkStatus(contentRoot, (data) => {
    const rec = data.urls[url];
    if (!rec?.verified_ok) return;
    delete rec.verified_ok;
    removed = true;
  });
  return removed;
}

/** Drop URLs no entry uses any more (their "This link works" mark goes with them). */
export function pruneLinkStatus(contentRoot: string | undefined, usedUrls: Set<string>): number {
  let removed = 0;
  const current = loadLinkStatus(contentRoot);
  if (!Object.keys(current.urls).some((u) => !usedUrls.has(u))) return 0;
  updateLinkStatus(contentRoot, (data) => {
    for (const url of Object.keys(data.urls)) {
      if (usedUrls.has(url)) continue;
      delete data.urls[url];
      removed++;
    }
  });
  return removed;
}

export function computeCoverage(urls: Iterable<string>, statuses: Record<string, LinkStatusRecord>): LinkCoverage {
  const out: LinkCoverage = { total: 0, checked: 0, gone: 0, unreachable: 0, verified_ok: 0 };
  for (const url of urls) {
    out.total++;
    const rec = statuses[url];
    if (!rec) continue;
    if (rec.verified_ok) out.verified_ok++;
    if (!rec.never_checked) out.checked++;
    if (isConfirmedGone(rec)) out.gone++;
    else if (isConfirmedUnreachable(rec)) out.unreachable++;
  }
  return out;
}

/** External URLs in the link index vs. what has been checked so far. */
export function getCoverage(contentRoot?: string): LinkCoverage {
  return computeCoverage(invertExternalLinks(contentRoot).keys(), loadLinkStatus(contentRoot).urls);
}
