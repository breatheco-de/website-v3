/**
 * Per-site runtime issues store — in-memory aggregates flushed to local + GCS.
 * Last-write-wins on GCS (v1). Never await GCS on the request hot path.
 */

import * as fs from "fs";
import * as path from "path";
import {
  SYNC_FILENAMES,
  runtimeIssuesStateReadKeys,
  siteSyncGcsKey,
} from "@shared/gcsKeys";
import {
  emptyRuntimeIssuesState,
  fingerprintNotFound,
  localeFromPath,
  normalizeRuntimePath,
  pruneRuntimeIssuesState,
  shouldHardDropNotFound,
  stripReferrerQuery,
  classifyRuntimeHit,
  hitHasSeoSignal,
  incrementByHour,
  sumByHourTotals,
  unionSources,
  resolvedDropScrapers,
  MAX_RECENT,
  type RuntimeIssuesState,
  type RuntimeIssueRecord,
} from "@shared/runtime-issues";
import { pathMatchesAnyIgnoreRule, type IgnoreRule, type IgnoreRuleInput } from "@shared/runtime-issues-ignore";
import { gcs } from "./gcs";
import { child } from "./logger";
import {
  _resetRuntimeIssuesIgnoreForTests,
  addIgnoreRules as addIgnoreRulesToStore,
  isPathIgnored,
  listIgnoreRules,
  loadRuntimeIssuesIgnoreForSite,
  removeIgnoreRules as removeIgnoreRulesFromStore,
} from "./runtime-issues-ignore-store";

const log = child({ module: "runtime-issues" });
const IS_PRODUCTION = process.env.NODE_ENV === "production";
const DEBOUNCE_MS = 5_000;

type SiteBucket = {
  state: RuntimeIssuesState;
  loaded: boolean;
  contentRoot?: string;
};

const bySite = new Map<string, SiteBucket>();

function localPathForSite(site: string, contentRoot?: string): string {
  if (contentRoot) {
    return path.join(contentRoot, `.${SYNC_FILENAMES.runtimeIssuesState}`);
  }
  return path.join(process.cwd(), "data", "runtime-issues", `${site}.json`);
}

function gcsKey(site: string): string {
  return siteSyncGcsKey(site, SYNC_FILENAMES.runtimeIssuesState);
}

function ensureBucket(site: string, contentRoot?: string): SiteBucket {
  let b = bySite.get(site);
  if (!b) {
    b = { state: emptyRuntimeIssuesState(), loaded: false, contentRoot };
    bySite.set(site, b);
  } else if (contentRoot && !b.contentRoot) {
    b.contentRoot = contentRoot;
  }
  return b;
}

function saveLocal(site: string): void {
  const b = bySite.get(site);
  if (!b) return;
  try {
    const file = localPathForSite(site, b.contentRoot);
    const dir = path.dirname(file);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(file, JSON.stringify(b.state, null, 2), "utf-8");
  } catch (err) {
    log.error({ err, site }, "failed to save local runtime-issues");
  }
}

function saveToBucket(site: string): void {
  if (!IS_PRODUCTION || !gcs.available) return;
  const b = bySite.get(site);
  if (!b) return;
  try {
    const content = JSON.stringify(b.state, null, 2);
    gcs.debouncedUpload(gcsKey(site), Buffer.from(content, "utf-8"), "application/json", DEBOUNCE_MS);
  } catch (err) {
    log.error({ err, site }, "failed to schedule GCS upload for runtime-issues");
  }
}

function save(site: string): void {
  const b = bySite.get(site);
  if (!b) return;
  b.state = pruneRuntimeIssuesState(b.state);
  saveLocal(site);
  saveToBucket(site);
}

function loadLocalInto(site: string, contentRoot?: string): RuntimeIssuesState {
  try {
    const file = localPathForSite(site, contentRoot);
    if (fs.existsSync(file)) {
      const text = fs.readFileSync(file, "utf-8").trim();
      if (!text) return emptyRuntimeIssuesState();
      const raw = JSON.parse(text);
      if (raw && raw.version === 1 && raw.issues) {
        return pruneRuntimeIssuesState(raw as RuntimeIssuesState);
      }
    }
  } catch (err) {
    log.error({ err, site }, "failed to load local runtime-issues");
  }
  return emptyRuntimeIssuesState();
}

function applyLoadedState(b: SiteBucket, state: RuntimeIssuesState): void {
  b.state = pruneRuntimeIssuesState(state);
}

/**
 * Load one site's runtime issues from GCS (prod) or local file.
 */
export async function loadRuntimeIssuesForSite(
  site: string,
  contentRoot?: string,
): Promise<void> {
  const b = ensureBucket(site, contentRoot);
  await loadRuntimeIssuesIgnoreForSite(site, contentRoot);

  if (!IS_PRODUCTION || !gcs.available) {
    applyLoadedState(b, loadLocalInto(site, contentRoot));
    b.loaded = true;
    return;
  }

  try {
    const result = await gcs.downloadFirstExisting(runtimeIssuesStateReadKeys(site));
    if (result) {
      const parsed = JSON.parse(result.data.toString("utf-8")) as RuntimeIssuesState;
      applyLoadedState(b, parsed);
      saveLocal(site);
      log.info({ site }, "loaded runtime-issues from GCS");
    } else {
      applyLoadedState(b, loadLocalInto(site, contentRoot));
      log.info({ site }, "no runtime-issues in GCS — using local");
    }
  } catch (err) {
    log.error({ err, site }, "GCS load failed for runtime-issues");
    applyLoadedState(b, loadLocalInto(site, contentRoot));
  }
  b.loaded = true;
}

export async function loadAllRuntimeIssuesFromBucket(
  sites: Array<{ site: string; contentRoot: string }>,
): Promise<void> {
  await Promise.all(sites.map((s) => loadRuntimeIssuesForSite(s.site, s.contentRoot)));
}

function ensureLoadedSync(site: string, contentRoot?: string): SiteBucket {
  const b = ensureBucket(site, contentRoot);
  if (!b.loaded) {
    applyLoadedState(b, loadLocalInto(site, contentRoot));
    b.loaded = true;
  }
  return b;
}

export interface RecordNotFoundInput {
  site: string;
  contentRoot?: string;
  path: string;
  locale?: string;
  hostname?: string;
  referrer?: string | null;
  userAgent?: string | null;
  ts?: number;
}

/**
 * Record a public HTML 404. Synchronous; never awaits GCS.
 * Returns false if hard-dropped.
 */
export function recordPublicNotFound(input: RecordNotFoundInput): boolean {
  const pathNorm = normalizeRuntimePath(input.path);
  if (pathNorm.startsWith("/api/") || pathNorm.startsWith("/private/")) return false;
  const site = input.site || "default";
  const b = ensureLoadedSync(site, input.contentRoot);
  const dropScrapers = resolvedDropScrapers(b.state);
  if (shouldHardDropNotFound(pathNorm, input.userAgent, input.referrer, dropScrapers)) return false;
  if (isPathIgnored(site, pathNorm, input.contentRoot)) return false;
  const locale = (input.locale || localeFromPath(pathNorm)).toLowerCase();
  const ts = input.ts ?? Date.now();
  const fingerprint = fingerprintNotFound(site, locale, pathNorm);
  const sampleReferrer = stripReferrerQuery(input.referrer);
  const classified = classifyRuntimeHit(pathNorm, input.userAgent, input.referrer);
  const seoHit = hitHasSeoSignal(classified.tags);

  const existing = b.state.issues[fingerprint];
  const byHour = incrementByHour(existing?.byHour, ts, classified.tags);
  const sources = unionSources(existing?.sources, classified.tags);
  const next: RuntimeIssueRecord = existing
    ? {
        ...existing,
        count: sumByHourTotals(byHour),
        lastSeen: ts,
        sampleReferrer: seoHit
          ? (sampleReferrer ?? existing.sampleReferrer)
          : (existing.sampleReferrer ?? sampleReferrer),
        uaBucket: seoHit ? classified.uaBucket : (existing.uaBucket || classified.uaBucket),
        hostname: input.hostname || existing.hostname,
        likelyBot: existing.likelyBot || classified.likelyBot,
        sources,
        byHour,
      }
    : {
        fingerprint,
        kind: "http.not_found",
        path: pathNorm,
        locale,
        count: 1,
        firstSeen: ts,
        lastSeen: ts,
        sampleReferrer,
        uaBucket: classified.uaBucket,
        hostname: input.hostname,
        likelyBot: classified.likelyBot,
        sources,
        byHour,
      };

  b.state.issues[fingerprint] = next;
  const recent = b.state.recent ?? [];
  recent.push({ fingerprint, ts, referrer: sampleReferrer });
  b.state.recent = recent.slice(-MAX_RECENT);
  b.state.updatedAt = ts;
  save(site);
  return true;
}

export function getRuntimeIssue(
  site: string,
  fingerprint: string,
  contentRoot?: string,
): RuntimeIssueRecord | null {
  const b = ensureLoadedSync(site, contentRoot);
  return b.state.issues[fingerprint] ?? null;
}

export function saveIssueProbe(
  site: string,
  fingerprint: string,
  probe: RuntimeIssueRecord["lastProbe"],
  contentRoot?: string,
): RuntimeIssueRecord | null {
  if (!probe) return getRuntimeIssue(site, fingerprint, contentRoot);
  const b = ensureLoadedSync(site, contentRoot);
  const existing = b.state.issues[fingerprint];
  if (!existing) return null;
  const next: RuntimeIssueRecord = { ...existing, lastProbe: probe };
  b.state.issues[fingerprint] = next;
  b.state.updatedAt = probe.at;
  save(site);
  return next;
}

export function listRuntimeIssues(
  site: string,
  opts?: { contentRoot?: string },
): {
  site: string;
  updatedAt: number;
  totalCount: number;
  issues: RuntimeIssueRecord[];
  ignored: IgnoreRule[];
  dropScrapers: boolean;
} {
  const b = ensureLoadedSync(site, opts?.contentRoot);
  const issues = Object.values(b.state.issues);
  issues.sort((a, b2) => {
    if (b2.count !== a.count) return b2.count - a.count;
    return b2.lastSeen - a.lastSeen;
  });
  const totalCount = issues.reduce((sum, i) => sum + i.count, 0);
  return {
    site,
    updatedAt: b.state.updatedAt,
    totalCount,
    issues,
    ignored: listIgnoreRules(site, opts?.contentRoot),
    dropScrapers: resolvedDropScrapers(b.state),
  };
}

export async function shutdownRuntimeIssues(): Promise<void> {
  for (const site of Array.from(bySite.keys())) {
    saveLocal(site);
  }
  if (!IS_PRODUCTION || !gcs.available) return;
  await gcs.flushPending();
  for (const [site, b] of Array.from(bySite.entries())) {
    try {
      const content = JSON.stringify(b.state, null, 2);
      await gcs.upload(gcsKey(site), Buffer.from(content, "utf-8"), "application/json");
    } catch (err) {
      log.error({ err, site }, "runtime-issues shutdown upload failed");
    }
  }
}

export interface ReuploadRuntimeIssuesResult {
  success: boolean;
  uploaded: boolean;
  gcsKey: string;
  reason?: string;
}

/** Force-upload one site's runtime issues to GCS immediately (admin Cloud Sync). */
export async function reuploadRuntimeIssuesToBucket(
  site: string,
  contentRoot?: string,
): Promise<ReuploadRuntimeIssuesResult> {
  const key = gcsKey(site);

  if (!IS_PRODUCTION) {
    return {
      success: false,
      uploaded: false,
      gcsKey: key,
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
      gcsKey: key,
      reason: "GCS is unavailable — missing GCS_BUCKET_NAME or credentials.",
    };
  }

  const b = ensureLoadedSync(site, contentRoot);
  const file = localPathForSite(site, b.contentRoot);
  if (!fs.existsSync(file) && Object.keys(b.state.issues).length === 0) {
    return {
      success: false,
      uploaded: false,
      gcsKey: key,
      reason: "No local runtime-issues file found to upload.",
    };
  }

  saveLocal(site);
  await gcs.upload(key, Buffer.from(JSON.stringify(b.state, null, 2), "utf-8"), "application/json");
  log.info({ site }, "re-uploaded runtime-issues to GCS via admin action");
  return { success: true, uploaded: true, gcsKey: key };
}

export interface PullRuntimeIssuesResult {
  success: boolean;
  pulled: boolean;
  gcsKey: string;
  issueCount: number;
  reason?: string;
}

/**
 * Replace this process's runtime-issues log with the GCS (production) snapshot.
 * Writes local JSON only — never uploads. Development ingest continues afterward.
 */
export async function pullRuntimeIssuesFromGcs(
  site: string,
  contentRoot?: string,
): Promise<PullRuntimeIssuesResult> {
  const key = gcsKey(site);
  const currentCount = () => Object.keys(ensureLoadedSync(site, contentRoot).state.issues).length;

  if (IS_PRODUCTION) {
    return {
      success: false,
      pulled: false,
      gcsKey: key,
      issueCount: currentCount(),
      reason: "Pull production is only available in development. This host already records production 404s.",
    };
  }

  if (!gcs.available) {
    gcs.initBootstrapFromEnv();
  }
  if (!gcs.available) {
    return {
      success: false,
      pulled: false,
      gcsKey: key,
      issueCount: currentCount(),
      reason: "GCS is unavailable — missing GCS_BUCKET_NAME or credentials.",
    };
  }

  try {
    const result = await gcs.downloadFirstExisting(runtimeIssuesStateReadKeys(site));
    if (!result) {
      return {
        success: false,
        pulled: false,
        gcsKey: key,
        issueCount: currentCount(),
        reason: "No runtime-issues file found in GCS.",
      };
    }

    const parsed = JSON.parse(result.data.toString("utf-8")) as RuntimeIssuesState;
    if (!parsed || parsed.version !== 1 || !parsed.issues) {
      return {
        success: false,
        pulled: false,
        gcsKey: result.key,
        issueCount: currentCount(),
        reason: "GCS runtime-issues file is invalid.",
      };
    }

    const b = ensureBucket(site, contentRoot);
    applyLoadedState(b, parsed);
    b.loaded = true;
    saveLocal(site);
    const issueCount = Object.keys(b.state.issues).length;
    log.info(
      { site, gcsKey: result.key, issueCount },
      "pulled runtime-issues from GCS (local snapshot; ingest continues locally)",
    );
    return { success: true, pulled: true, gcsKey: result.key, issueCount };
  } catch (err) {
    log.error({ err, site }, "failed to pull runtime-issues from GCS");
    return {
      success: false,
      pulled: false,
      gcsKey: key,
      issueCount: currentCount(),
      reason: err instanceof Error ? err.message : "Failed to pull runtime issues from GCS.",
    };
  }
}

export function getRuntimeIssuesLocalPath(site: string, contentRoot?: string): string {
  return localPathForSite(site, contentRoot);
}

/** Wipe in-memory + local issues for a site, then attempt GCS upload (prod). Keeps ingest settings. */
export function resetRuntimeIssuesForSite(site: string, contentRoot?: string): RuntimeIssuesState {
  const b = ensureLoadedSync(site, contentRoot);
  const dropScrapers = resolvedDropScrapers(b.state);
  b.state = emptyRuntimeIssuesState();
  b.state.dropScrapers = dropScrapers;
  b.state.updatedAt = Date.now();
  save(site);
  return b.state;
}

export function setDropScrapers(
  site: string,
  enabled: boolean,
  contentRoot?: string,
): { dropScrapers: boolean } {
  const b = ensureLoadedSync(site, contentRoot);
  b.state.dropScrapers = Boolean(enabled);
  b.state.updatedAt = Date.now();
  save(site);
  return { dropScrapers: resolvedDropScrapers(b.state) };
}

export function addIgnoreRules(
  site: string,
  rules: IgnoreRuleInput[],
  opts?: { contentRoot?: string; seedPaths?: string[] },
): { ignored: IgnoreRule[]; removed: number } {
  const { ignored, added } = addIgnoreRulesToStore(site, rules, opts);
  let removed = 0;
  if (added.length) {
    const b = ensureLoadedSync(site, opts?.contentRoot);
    const nextIssues: Record<string, RuntimeIssueRecord> = {};
    for (const [fp, issue] of Object.entries(b.state.issues)) {
      if (pathMatchesAnyIgnoreRule(issue.path, added)) {
        removed += 1;
        continue;
      }
      nextIssues[fp] = issue;
    }
    b.state.issues = nextIssues;
    b.state.recent = (b.state.recent ?? []).filter((r) => nextIssues[r.fingerprint]);
    b.state.updatedAt = Date.now();
    save(site);
  }
  return { ignored, removed };
}

export function removeIgnoreRules(
  site: string,
  ids: string[],
  contentRoot?: string,
): { ignored: IgnoreRule[] } {
  return removeIgnoreRulesFromStore(site, ids, contentRoot);
}

export async function resetAndUploadRuntimeIssues(
  site: string,
  contentRoot?: string,
): Promise<ReuploadRuntimeIssuesResult> {
  resetRuntimeIssuesForSite(site, contentRoot);
  const uploaded = await reuploadRuntimeIssuesToBucket(site, contentRoot);
  if (!uploaded.success) {
    return {
      success: true,
      uploaded: false,
      gcsKey: uploaded.gcsKey,
      reason: uploaded.reason,
    };
  }
  return uploaded;
}

/** Test helper */
export function _resetRuntimeIssuesForTests(): void {
  bySite.clear();
  _resetRuntimeIssuesIgnoreForTests();
}
