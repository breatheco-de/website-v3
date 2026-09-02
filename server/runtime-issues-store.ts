/**
 * Per-site runtime issues store — in-memory aggregates flushed to local + GCS.
 * Last-write-wins on GCS (v1). Never await GCS on the request hot path.
 *
 * Hydrate gate: in production with GCS, do not ingest or upload until
 * `loadRuntimeIssuesForSite` finishes. Early 404s on an empty disk must not
 * mark the store "loaded" and push a thin snapshot that overwrites GCS.
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
  hasStaffQueryParams,
  parseRuntimeQueryAttribution,
  mergeQueryAttribution,
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
const DEBOUNCE_MS = 5_000;

/** Override for vitest — when set, replaces NODE_ENV===production checks. */
let productionOverrideForTests: boolean | undefined;

export function _setRuntimeIssuesProductionForTests(value: boolean | undefined): void {
  productionOverrideForTests = value;
}

function isProduction(): boolean {
  return productionOverrideForTests ?? process.env.NODE_ENV === "production";
}

type SiteBucket = {
  state: RuntimeIssuesState;
  /** True after intentional hydrate (GCS in prod, local otherwise). Gates ingest + GCS upload. */
  hydrated: boolean;
  contentRoot?: string;
};

const bySite = new Map<string, SiteBucket>();
/** Site → timer; fires with a fresh JSON snapshot of current in-memory state. */
const pendingUploadTimers = new Map<string, ReturnType<typeof setTimeout>>();

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
    b = { state: emptyRuntimeIssuesState(), hydrated: false, contentRoot };
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

/**
 * Schedule GCS upload of the *current* in-memory state when the timer fires
 * (not a stale buffer captured at schedule time).
 */
function saveToBucket(site: string): void {
  if (!isProduction() || !gcs.available) return;
  const b = bySite.get(site);
  if (!b?.hydrated) return;

  const existing = pendingUploadTimers.get(site);
  if (existing) clearTimeout(existing);

  const timer = setTimeout(() => {
    pendingUploadTimers.delete(site);
    const latest = bySite.get(site);
    if (!latest?.hydrated) return;
    const key = gcsKey(site);
    const payload = Buffer.from(JSON.stringify(latest.state, null, 2), "utf-8");
    void gcs.upload(key, payload, "application/json").catch((err) => {
      log.error({ err, site }, "runtime-issues GCS upload failed");
    });
  }, DEBOUNCE_MS);

  pendingUploadTimers.set(site, timer);
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
 * Marks the site hydrated — ingest and GCS uploads are allowed afterward.
 */
export async function loadRuntimeIssuesForSite(
  site: string,
  contentRoot?: string,
): Promise<void> {
  const b = ensureBucket(site, contentRoot);
  await loadRuntimeIssuesIgnoreForSite(site, contentRoot);

  if (!isProduction() || !gcs.available) {
    applyLoadedState(b, loadLocalInto(site, contentRoot));
    b.hydrated = true;
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
  b.hydrated = true;
}

export async function loadAllRuntimeIssuesFromBucket(
  sites: Array<{ site: string; contentRoot: string }>,
): Promise<void> {
  await Promise.all(sites.map((s) => loadRuntimeIssuesForSite(s.site, s.contentRoot)));
}

/**
 * Ready for ingest/mutate. In prod+GCS, returns null until `loadRuntimeIssuesForSite`
 * so we never treat empty post-deploy disk as authoritative.
 */
function tryHydrateForWrite(site: string, contentRoot?: string): SiteBucket | null {
  const b = ensureBucket(site, contentRoot);
  if (b.hydrated) return b;
  if (isProduction() && gcs.available) return null;
  applyLoadedState(b, loadLocalInto(site, contentRoot));
  b.hydrated = true;
  return b;
}

/** Read path: hydrate from local when not waiting on GCS; otherwise return bucket as-is. */
function ensureLoadedSync(site: string, contentRoot?: string): SiteBucket {
  const ready = tryHydrateForWrite(site, contentRoot);
  if (ready) return ready;
  return ensureBucket(site, contentRoot);
}

export interface RecordNotFoundInput {
  site: string;
  contentRoot?: string;
  path: string;
  locale?: string;
  hostname?: string;
  referrer?: string | null;
  userAgent?: string | null;
  querySearch?: string;
  ts?: number;
}

/**
 * Record a public HTML 404. Synchronous; never awaits GCS.
 * Returns false if hard-dropped or the store is not hydrated yet (prod+GCS boot).
 */
export function recordPublicNotFound(input: RecordNotFoundInput): boolean {
  if (hasStaffQueryParams(input.querySearch)) return false;
  const pathNorm = normalizeRuntimePath(input.path);
  if (pathNorm.startsWith("/api/") || pathNorm.startsWith("/private/")) return false;
  const site = input.site || "default";
  const b = tryHydrateForWrite(site, input.contentRoot);
  if (!b) return false;
  const dropScrapers = resolvedDropScrapers(b.state);
  if (shouldHardDropNotFound(pathNorm, input.userAgent, input.referrer, dropScrapers)) return false;
  if (isPathIgnored(site, pathNorm, input.contentRoot)) return false;
  const locale = (input.locale || localeFromPath(pathNorm)).toLowerCase();
  const ts = input.ts ?? Date.now();
  const fingerprint = fingerprintNotFound(site, locale, pathNorm);
  const sampleReferrer = stripReferrerQuery(input.referrer);
  const classified = classifyRuntimeHit(pathNorm, input.userAgent, input.referrer);
  const seoHit = hitHasSeoSignal(classified.tags);
  const incomingAttribution = parseRuntimeQueryAttribution(input.querySearch);

  const existing = b.state.issues[fingerprint];
  const byHour = incrementByHour(existing?.byHour, ts, classified.tags);
  const sources = unionSources(existing?.sources, classified.tags);
  const queryAttribution = mergeQueryAttribution(existing?.queryAttribution, incomingAttribution);
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
        queryAttribution,
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
        queryAttribution,
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
  const b = tryHydrateForWrite(site, contentRoot);
  if (!b) return null;
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
  const before = Object.keys(b.state.issues).length;
  b.state = pruneRuntimeIssuesState(b.state);
  // Persist when hard-drop rules newly remove rows (e.g. /.env.production).
  if (Object.keys(b.state.issues).length < before) {
    saveLocal(site);
    saveToBucket(site);
  }
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
  for (const [site, timer] of Array.from(pendingUploadTimers.entries())) {
    clearTimeout(timer);
    pendingUploadTimers.delete(site);
  }
  for (const site of Array.from(bySite.keys())) {
    saveLocal(site);
  }
  if (!isProduction() || !gcs.available) return;
  for (const [site, b] of Array.from(bySite.entries())) {
    if (!b.hydrated) continue;
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

  if (!isProduction()) {
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

  const b = tryHydrateForWrite(site, contentRoot) ?? ensureLoadedSync(site, contentRoot);
  if (!b.hydrated) {
    applyLoadedState(b, loadLocalInto(site, contentRoot));
    b.hydrated = true;
  }
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

  if (isProduction()) {
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
    b.hydrated = true;
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
  const b = tryHydrateForWrite(site, contentRoot) ?? ensureLoadedSync(site, contentRoot);
  if (!b.hydrated) {
    applyLoadedState(b, loadLocalInto(site, contentRoot));
    b.hydrated = true;
  }
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
  const b = tryHydrateForWrite(site, contentRoot) ?? ensureLoadedSync(site, contentRoot);
  if (!b.hydrated) {
    applyLoadedState(b, loadLocalInto(site, contentRoot));
    b.hydrated = true;
  }
  b.state.dropScrapers = Boolean(enabled);
  b.state.updatedAt = Date.now();
  save(site);
  return { dropScrapers: resolvedDropScrapers(b.state) };
}

function ensureHydratedForMutation(site: string, contentRoot?: string): SiteBucket {
  const b = tryHydrateForWrite(site, contentRoot) ?? ensureLoadedSync(site, contentRoot);
  if (!b.hydrated) {
    applyLoadedState(b, loadLocalInto(site, contentRoot));
    b.hydrated = true;
  }
  return b;
}

function purgeIssuesFromBucket(
  site: string,
  b: SiteBucket,
  shouldRemove: (issue: RuntimeIssueRecord) => boolean,
): number {
  const nextIssues: Record<string, RuntimeIssueRecord> = {};
  let removed = 0;
  for (const [fp, issue] of Object.entries(b.state.issues)) {
    if (shouldRemove(issue)) {
      removed += 1;
      continue;
    }
    nextIssues[fp] = issue;
  }
  if (removed === 0) return 0;
  b.state.issues = nextIssues;
  b.state.recent = (b.state.recent ?? []).filter((r) => nextIssues[r.fingerprint]);
  b.state.updatedAt = Date.now();
  save(site);
  return removed;
}

export function deleteRuntimeIssuesByFingerprints(
  site: string,
  fingerprints: string[],
  contentRoot?: string,
): { removed: number } {
  const ids = Array.from(
    new Set(fingerprints.filter((fp): fp is string => typeof fp === "string" && fp.trim().length > 0)),
  );
  if (!ids.length) return { removed: 0 };
  const b = ensureHydratedForMutation(site, contentRoot);
  const idSet = new Set(ids);
  const removed = purgeIssuesFromBucket(site, b, (issue) => idSet.has(issue.fingerprint));
  return { removed };
}

export function purgeIssuesMatchingIgnoreRules(
  site: string,
  contentRoot?: string,
): { removed: number } {
  const rules = listIgnoreRules(site, contentRoot);
  if (!rules.length) return { removed: 0 };
  const b = ensureHydratedForMutation(site, contentRoot);
  const removed = purgeIssuesFromBucket(site, b, (issue) =>
    pathMatchesAnyIgnoreRule(issue.path, rules),
  );
  return { removed };
}

export function addIgnoreRules(
  site: string,
  rules: IgnoreRuleInput[],
  opts?: { contentRoot?: string; seedPaths?: string[]; purgeFingerprints?: string[] },
): { ignored: IgnoreRule[]; removed: number; added: number } {
  const { ignored, added } = addIgnoreRulesToStore(site, rules, opts);
  let removed = 0;
  if (opts?.purgeFingerprints?.length) {
    removed = deleteRuntimeIssuesByFingerprints(site, opts.purgeFingerprints, opts.contentRoot).removed;
  }
  return { ignored, removed, added: added.length };
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
  for (const timer of pendingUploadTimers.values()) clearTimeout(timer);
  pendingUploadTimers.clear();
  bySite.clear();
  productionOverrideForTests = undefined;
  _resetRuntimeIssuesIgnoreForTests();
}
