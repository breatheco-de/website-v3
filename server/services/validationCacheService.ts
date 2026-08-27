/**
 * Validation Cache Service (v5)
 *
 * Unified issue store: issues map + indexes (byEntry, byScope, …).
 * Persists to <contentRoot>/validation-cache.json and GCS in production.
 */

import * as fs from "fs";
import { getDefaultContentRoot } from "../site-config";
import * as path from "path";
import type {
  ContentFile,
  DatabaseCacheEntry,
  EntryRunMeta,
  PageCacheEntry,
  StoredValidationIssue,
  ValidationCacheFile,
  ValidationCacheFileV5,
  ValidationCacheIndexes,
  ValidationIssue,
  ValidationIssueActor,
  ValidationIssueClaim,
  ValidationIssueCompletion,
  ValidatorResult,
} from "../../scripts/validation/shared/types";
import type { ValidationScope } from "../../scripts/validation/shared/runClass";
import {
  getValidatorRunClass,
  isCrossEntryValidator,
  isDatabaseValidator,
  isEntryLocalValidator,
  isMediaValidator,
} from "../../scripts/validation/shared/runClass";
import { entryKeyFromContentFile } from "../../scripts/validation/shared/entryKey";
import { getCanonicalUrl } from "../../scripts/validation/shared/canonicalUrls";
import { siteSyncGcsKey, SYNC_FILENAMES, validationCacheReadKeys } from "@shared/gcsKeys";
import { gcs } from "../gcs";
import { getSiteContextMap } from "../site-manager";
import { child } from "../logger";
import {
  issueToStored,
  pageEntryFromStored,
} from "./validationCacheMerge";
import { emitValidationIssueWorkflowEvent } from "../validation-events";

const log = child({ module: "validationCacheService" });

const IS_PRODUCTION = process.env.NODE_ENV === "production";
const CACHE_VERSION = 5;
/** Soft claim TTL — same author can refresh; others wait for expiry or release. */
export const CLAIM_TTL_MS = 30 * 60 * 1000;

export function claimToApiRow(claim: ValidationIssueClaim): {
  by: string;
  at: string;
  expiresAt: string;
  actor?: ValidationIssueActor;
  report?: string;
} {
  return {
    by: claim.claimedBy,
    at: claim.claimedAt,
    expiresAt: claim.expiresAt,
    ...(claim.actor ? { actor: claim.actor } : {}),
    ...(claim.report ? { report: claim.report } : {}),
  };
}

export function completionToApiRow(completion: ValidationIssueCompletion): {
  by: string;
  at: string;
  actor?: ValidationIssueActor;
  report?: string;
} {
  return {
    by: completion.completedBy,
    at: completion.completedAt,
    ...(completion.actor ? { actor: completion.actor } : {}),
    ...(completion.report ? { report: completion.report } : {}),
  };
}

export type CacheIssueUpdateAction = "claim" | "release" | "complete" | "uncomplete";

function emptyIndexes(): ValidationCacheIndexes {
  return {
    byEntry: {},
    byScope: {},
    byMedia: {},
    byDatabase: {},
    byRedirect: {},
    byUrl: {},
  };
}

function emptyCache(): ValidationCacheFileV5 {
  return {
    meta: { version: 5, lastFullRunAt: null, lastSiteWideRunAt: null },
    issues: {},
    indexes: emptyIndexes(),
    runMeta: { byEntry: {}, byScope: {} },
    completions: {},
    claims: {},
    databases: {},
  };
}

function rebuildIndexes(
  issues: Record<string, StoredValidationIssue>,
  byUrl: Record<string, string> = {},
): ValidationCacheIndexes {
  const indexes = emptyIndexes();
  indexes.byUrl = { ...byUrl };

  for (const issue of Object.values(issues)) {
    const push = (bag: Record<string, string[]>, key: string) => {
      if (!bag[key]) bag[key] = [];
      if (!bag[key]!.includes(issue.id)) bag[key]!.push(issue.id);
    };
    const pushScope = (scope: ValidationScope) => {
      if (!indexes.byScope[scope]) indexes.byScope[scope] = [];
      if (!indexes.byScope[scope]!.includes(issue.id)) indexes.byScope[scope]!.push(issue.id);
    };

    for (const scope of issue.scopes) pushScope(scope);
    for (const t of issue.targets) {
      if (t.type === "entry") {
        push(indexes.byEntry, t.entryKey);
        if (t.url) indexes.byUrl[t.url] = t.entryKey;
      } else if (t.type === "media") {
        push(indexes.byMedia, t.imageId);
      } else if (t.type === "database") {
        push(indexes.byDatabase, t.dbSlug);
      } else if (t.type === "redirect") {
        push(indexes.byRedirect, t.from);
      }
    }
  }
  return indexes;
}

function migratePagesToV4(
  pages: Record<string, PageCacheEntry>,
): Record<string, PageCacheEntry> {
  const out: typeof pages = {};
  for (const [url, entry] of Object.entries(pages ?? {})) {
    out[url] = {
      ...entry,
      lastFullRunAt: entry.lastFullRunAt ?? entry.lastRunAt,
    };
  }
  return out;
}

function migrateV4ToV5(v4: {
  meta: { lastFullRunAt: string | null; version: number };
  pages: Record<string, PageCacheEntry>;
  databases?: Record<string, DatabaseCacheEntry>;
}): ValidationCacheFileV5 {
  const nowIso = new Date().toISOString();
  const issues: Record<string, StoredValidationIssue> = {};
  const byUrl: Record<string, string> = {};
  const runMetaByEntry: Record<string, EntryRunMeta> = {};

  for (const [url, entry] of Object.entries(v4.pages ?? {})) {
    const entryKey = `legacy${url.replace(/\//g, "__")}`;
    byUrl[url] = entryKey;
    const byValidator: Record<string, string> = {};

    const add = (raw: ValidationIssue, severity: "error" | "warning") => {
      const validator = raw.validator || "legacy";
      const id = `${validator}:${raw.code}:${entryKey}:${severity}`.slice(0, 64);
      const stored: StoredValidationIssue = {
        id,
        code: raw.code,
        severity,
        message: raw.message,
        suggestion: raw.suggestion,
        validator,
        scopes: validator === "redirects" ? ["site", "entry", "redirects"] : ["entry"],
        targets: [{ type: "entry", entryKey, url, file: raw.file }],
        file: raw.file,
        line: raw.line,
        category: raw.category,
        lastSeenAt: entry.lastRunAt || nowIso,
        lastRunAt: entry.lastRunAt || nowIso,
      };
      let finalId = id;
      let n = 0;
      while (issues[finalId] && issues[finalId]!.message !== stored.message) {
        finalId = `${id}:${++n}`;
      }
      stored.id = finalId;
      issues[finalId] = stored;
      byValidator[validator] = entry.lastRunAt || nowIso;
    };

    for (const e of entry.errors ?? []) add(e, "error");
    for (const w of entry.warnings ?? []) add(w, "warning");

    runMetaByEntry[entryKey] = {
      lastRunAt: entry.lastRunAt || nowIso,
      byValidator,
      dirty: false,
    };
  }

  return {
    meta: {
      version: 5,
      lastFullRunAt: v4.meta?.lastFullRunAt ?? null,
      lastSiteWideRunAt: v4.meta?.lastFullRunAt ?? null,
    },
    issues,
    indexes: rebuildIndexes(issues, byUrl),
    runMeta: { byEntry: runMetaByEntry, byScope: {} },
    completions: {},
    claims: {},
    databases: v4.databases ?? {},
  };
}

function migrateCache(parsed: ValidationCacheFile): ValidationCacheFileV5 {
  const version = parsed.meta?.version ?? 0;
  if (version >= 5 && "issues" in parsed && (parsed as ValidationCacheFileV5).issues) {
    const v5 = parsed as ValidationCacheFileV5;
    return {
      ...v5,
      meta: {
        version: 5,
        lastFullRunAt: v5.meta.lastFullRunAt ?? null,
        lastSiteWideRunAt: v5.meta.lastSiteWideRunAt ?? v5.meta.lastFullRunAt ?? null,
      },
      indexes: v5.indexes ?? rebuildIndexes(v5.issues, v5.indexes?.byUrl ?? {}),
      runMeta: v5.runMeta ?? { byEntry: {}, byScope: {} },
      completions: v5.completions ?? {},
      claims: v5.claims ?? {},
      databases: v5.databases ?? {},
    };
  }

  if (version === 4 || version === 3 || version === 2) {
    log.info(`[ValidationCache] Migrating v${version} cache to v5`);
    const pages = migratePagesToV4(
      (parsed as { pages: Record<string, PageCacheEntry> }).pages,
    );
    return migrateV4ToV5({
      meta: {
        lastFullRunAt: parsed.meta?.lastFullRunAt ?? null,
        version: 4,
      },
      pages,
      databases: (parsed as { databases?: Record<string, DatabaseCacheEntry> }).databases,
    });
  }

  log.info("[ValidationCache] Stale cache version — discarding and starting fresh");
  return emptyCache();
}

function readFromDisk(cacheFile: string): ValidationCacheFileV5 {
  try {
    if (fs.existsSync(cacheFile)) {
      const raw = fs.readFileSync(cacheFile, "utf-8");
      const parsed = JSON.parse(raw) as ValidationCacheFile;
      if (parsed && typeof parsed === "object") {
        return migrateCache(parsed);
      }
    }
  } catch (err) {
    log.warn({ err }, "Failed to read validation-cache.json, starting fresh");
  }
  return emptyCache();
}

function issueScopesForValidatorName(name: string): ValidationScope[] {
  if (name === "redirects") return ["redirects", "site"];
  if (name === "sitemap") return ["sitemap", "site"];
  if (isMediaValidator(name)) return ["media", "site"];
  return ["site"];
}

export type ApplyValidatorResultsOptions = {
  contentFiles: ContentFile[];
  entryKeys?: string[];
  markSiteWide?: boolean;
};

export class ValidationCacheService {
  private issues: Record<string, StoredValidationIssue> = {};
  private indexes: ValidationCacheIndexes = emptyIndexes();
  private runMetaByEntry: Record<string, EntryRunMeta> = {};
  private runMetaByScope: Partial<
    Record<ValidationScope, { lastRunAt: string; byValidator: Record<string, string>; dirty?: boolean }>
  > = {};
  private completions: Record<string, ValidationIssueCompletion> = {};
  private claims: Record<string, ValidationIssueClaim> = {};
  private dbMap: Map<string, DatabaseCacheEntry> = new Map();
  private lastFullRunAt: string | null = null;
  private lastSiteWideRunAt: string | null = null;
  private writeQueue: Promise<void> = Promise.resolve();
  private cacheFile: string;
  private contentFolder: string;
  /** When true, flush writes local file only (diagnostics worker; parent owns GCS). */
  private skipGcsUpload = false;

  constructor(contentRoot: string) {
    this.cacheFile = path.join(contentRoot, "validation-cache.json");
    this.contentFolder = path.relative(process.cwd(), contentRoot);
    this.loadFromDisk();
  }

  /** Site folder name (e.g. site_4geeks-com) for admin events. */
  getSiteFolder(): string {
    return this.contentFolder;
  }

  setSkipGcsUpload(skip: boolean): void {
    this.skipGcsUpload = skip;
  }

  /** Re-read validation-cache.json into memory (e.g. after worker flush). */
  reloadFromDisk(): void {
    this.loadFromDisk();
  }

  private gcsKey(): string {
    return siteSyncGcsKey(this.contentFolder, SYNC_FILENAMES.validationCache);
  }

  private applyLoadedData(data: ValidationCacheFileV5): void {
    this.lastFullRunAt = data.meta?.lastFullRunAt ?? null;
    this.lastSiteWideRunAt = data.meta?.lastSiteWideRunAt ?? null;
    this.issues = { ...(data.issues ?? {}) };
    this.indexes = data.indexes ?? rebuildIndexes(this.issues);
    this.runMetaByEntry = { ...(data.runMeta?.byEntry ?? {}) };
    this.runMetaByScope = { ...(data.runMeta?.byScope ?? {}) };
    this.completions = { ...(data.completions ?? {}) };
    this.claims = { ...(data.claims ?? {}) };
    this.dbMap = new Map(Object.entries(data.databases ?? {}));
    this.gcOrphanOverlays();
  }

  private dropCompletions(ids: Iterable<string>): void {
    for (const id of ids) {
      delete this.completions[id];
    }
  }

  private dropClaims(ids: Iterable<string>): void {
    for (const id of ids) {
      delete this.claims[id];
    }
  }

  /** Drop overlay records whose issue id is gone, and expired claims. */
  private gcOrphanOverlays(): void {
    for (const id of Object.keys(this.completions)) {
      if (!this.issues[id]) delete this.completions[id];
    }
    const now = Date.now();
    for (const [id, claim] of Object.entries(this.claims)) {
      if (!this.issues[id] || new Date(claim.expiresAt).getTime() <= now) {
        delete this.claims[id];
      }
    }
  }

  isIssueCompleted(issueId: string): boolean {
    return Boolean(this.completions[issueId]);
  }

  getCompletion(issueId: string): ValidationIssueCompletion | undefined {
    return this.completions[issueId];
  }

  getCompletions(): Record<string, ValidationIssueCompletion> {
    return { ...this.completions };
  }

  getIssueById(issueId: string): StoredValidationIssue | undefined {
    return this.issues[issueId];
  }

  /** Active (non-expired) claim, or undefined. Expired rows are GC'd. */
  getActiveClaim(issueId: string, nowMs: number = Date.now()): ValidationIssueClaim | undefined {
    const claim = this.claims[issueId];
    if (!claim) return undefined;
    if (new Date(claim.expiresAt).getTime() <= nowMs) {
      delete this.claims[issueId];
      return undefined;
    }
    return claim;
  }

  isClaimActive(issueId: string, nowMs: number = Date.now()): boolean {
    return Boolean(this.getActiveClaim(issueId, nowMs));
  }

  private buildClaim(
    claimedBy: string,
    actor?: ValidationIssueActor,
    report?: string,
    nowMs: number = Date.now(),
  ): ValidationIssueClaim {
    return {
      claimedBy,
      claimedAt: new Date(nowMs).toISOString(),
      expiresAt: new Date(nowMs + CLAIM_TTL_MS).toISOString(),
      ...(actor ? { actor } : {}),
      ...(report ? { report } : {}),
    };
  }

  /**
   * Soft-complete: hide from open lists/counts until the next cache write resurfaces the id.
   * Also clears any active claim on the issue.
   */
  async completeIssue(
    issueId: string,
    completedBy: string,
    actor?: ValidationIssueActor,
    report?: string,
  ): Promise<{ ok: true; completion: ValidationIssueCompletion } | { ok: false; error: string }> {
    if (!this.issues[issueId]) {
      return { ok: false, error: `Unknown issue id: ${issueId}` };
    }
    const completion: ValidationIssueCompletion = {
      completedBy,
      completedAt: new Date().toISOString(),
      ...(actor ? { actor } : {}),
      ...(report ? { report } : {}),
    };
    this.completions[issueId] = completion;
    delete this.claims[issueId];
    await this.flush();
    return { ok: true, completion };
  }

  async uncompleteIssue(
    issueId: string,
  ): Promise<{ ok: true } | { ok: false; error: string }> {
    if (!this.completions[issueId]) {
      if (!this.issues[issueId]) {
        return { ok: false, error: `Unknown issue id: ${issueId}` };
      }
      return { ok: true };
    }
    delete this.completions[issueId];
    await this.flush();
    return { ok: true };
  }

  async claimIssue(
    issueId: string,
    claimedBy: string,
    actor?: ValidationIssueActor,
    report?: string,
  ): Promise<
    | { ok: true; claim: ValidationIssueClaim }
    | { ok: false; error: string; code?: string; claimedBy?: string }
  > {
    if (!this.issues[issueId]) {
      return { ok: false, error: `Unknown issue id: ${issueId}` };
    }
    const existing = this.getActiveClaim(issueId);
    if (existing && existing.claimedBy !== claimedBy) {
      return {
        ok: false,
        error: `Issue already claimed by ${existing.claimedBy} until ${existing.expiresAt}`,
        code: "issue_already_claimed",
        claimedBy: existing.claimedBy,
      };
    }
    const claimReport =
      report ?? (existing?.claimedBy === claimedBy ? existing.report : undefined);
    const claim = this.buildClaim(claimedBy, actor, claimReport);
    this.claims[issueId] = claim;
    await this.flush();
    return { ok: true, claim };
  }

  /**
   * Release a claim. `force` allows staff to clear another author's claim.
   */
  async releaseIssue(
    issueId: string,
    author: string,
    options?: { force?: boolean },
  ): Promise<{ ok: true } | { ok: false; error: string; code?: string }> {
    if (!this.issues[issueId] && !this.claims[issueId]) {
      return { ok: false, error: `Unknown issue id: ${issueId}` };
    }
    const existing = this.getActiveClaim(issueId);
    if (!existing) {
      delete this.claims[issueId];
      await this.flush();
      return { ok: true };
    }
    if (existing.claimedBy !== author && !options?.force) {
      return {
        ok: false,
        error: `Claimed by ${existing.claimedBy}; only that author or staff can release`,
        code: "claim_not_owned",
      };
    }
    delete this.claims[issueId];
    await this.flush();
    return { ok: true };
  }

  async updateIssue(
    issueId: string,
    action: CacheIssueUpdateAction,
    author: string,
    options?: { staffForceRelease?: boolean; actor?: ValidationIssueActor; report?: string },
  ): Promise<
    | {
        ok: true;
        action: CacheIssueUpdateAction;
        completed?: { by: string; at: string; actor?: ValidationIssueActor; report?: string } | null;
        claimed?: {
          by: string;
          at: string;
          expiresAt: string;
          actor?: ValidationIssueActor;
          report?: string;
        } | null;
      }
    | { ok: false; error: string; code?: string; status?: number; claimedBy?: string }
  > {
    const actor = options?.actor;
    const report = options?.report;
    switch (action) {
      case "claim": {
        const r = await this.claimIssue(issueId, author, actor, report);
        if (!r.ok) {
          return {
            ok: false,
            error: r.error,
            code: r.code,
            status: r.code === "issue_already_claimed" ? 409 : 404,
            claimedBy: r.claimedBy,
          };
        }
        return {
          ok: true,
          action,
          claimed: claimToApiRow(r.claim),
          completed: null,
        };
      }
      case "release": {
        const r = await this.releaseIssue(issueId, author, {
          force: options?.staffForceRelease === true,
        });
        if (!r.ok) {
          return {
            ok: false,
            error: r.error,
            code: r.code,
            status: r.code === "claim_not_owned" ? 403 : 404,
          };
        }
        return { ok: true, action, claimed: null };
      }
      case "complete": {
        const r = await this.completeIssue(issueId, author, actor, report);
        if (!r.ok) return { ok: false, error: r.error, status: 404 };
        return {
          ok: true,
          action,
          completed: completionToApiRow(r.completion),
          claimed: null,
        };
      }
      case "uncomplete": {
        const r = await this.uncompleteIssue(issueId);
        if (!r.ok) return { ok: false, error: r.error, status: 404 };
        const claim = this.getActiveClaim(issueId);
        return {
          ok: true,
          action,
          completed: null,
          claimed: claim ? claimToApiRow(claim) : null,
        };
      }
      default:
        return { ok: false, error: `Unknown action: ${action}`, status: 400 };
    }
  }

  /** Issues for an entry that are not soft-completed (open work queue / counts). */
  getOpenIssuesByEntryKey(entryKey: string): StoredValidationIssue[] {
    return this.getIssuesByEntryKey(entryKey).filter((i) => !this.completions[i.id]);
  }

  private loadFromDisk(): void {
    const data = readFromDisk(this.cacheFile);
    this.applyLoadedData(data);
    log.info(
      `[ValidationCache] Loaded ${Object.keys(this.issues).length} issues, ${this.dbMap.size} database entries from disk`,
    );
  }

  async loadFromBucket(): Promise<void> {
    if (!IS_PRODUCTION || !gcs.available) {
      if (!IS_PRODUCTION) {
        log.info("[ValidationCache] Development mode, using local file only");
      }
      return;
    }

    try {
      const result = await gcs.downloadFirstExisting(validationCacheReadKeys(this.contentFolder));
      if (!result) {
        log.info("[ValidationCache] No cache found in bucket, using local file");
        return;
      }

      const parsed = JSON.parse(result.data.toString("utf-8")) as ValidationCacheFile;
      if (!parsed || typeof parsed !== "object") {
        log.warn("[ValidationCache] Invalid cache in bucket, keeping local file");
        return;
      }

      this.applyLoadedData(migrateCache(parsed));
      this.writeLocalFile();
      log.info(`[ValidationCache] Loaded ${Object.keys(this.issues).length} issues from GCS`);
    } catch (err) {
      log.error({ err }, "[ValidationCache] Error loading from bucket:");
    }
  }

  /**
   * Dev-only: overwrite local validation-cache.json with the production GCS copy.
   * Never uploads. Production hosts already load from the bucket on boot.
   */
  async pullFromBucket(): Promise<{
    success: boolean;
    pulled: boolean;
    gcsKey: string;
    issueCount: number;
    reason?: string;
  }> {
    const gcsKey = this.gcsKey();
    const currentCount = () => Object.keys(this.issues).length;

    if (IS_PRODUCTION) {
      return {
        success: false,
        pulled: false,
        gcsKey,
        issueCount: currentCount(),
        reason:
          "Pull production is only available in development. This host already uses the production validation cache.",
      };
    }

    if (!gcs.available) {
      gcs.initBootstrapFromEnv();
    }
    if (!gcs.available) {
      return {
        success: false,
        pulled: false,
        gcsKey,
        issueCount: currentCount(),
        reason: "GCS is unavailable — missing GCS_BUCKET_NAME or credentials.",
      };
    }

    try {
      const result = await gcs.downloadFirstExisting(validationCacheReadKeys(this.contentFolder));
      if (!result) {
        return {
          success: false,
          pulled: false,
          gcsKey,
          issueCount: currentCount(),
          reason: "No validation-cache.json found in GCS.",
        };
      }

      const parsed = JSON.parse(result.data.toString("utf-8")) as ValidationCacheFile;
      if (!parsed || typeof parsed !== "object") {
        return {
          success: false,
          pulled: false,
          gcsKey: result.key,
          issueCount: currentCount(),
          reason: "GCS validation-cache.json is invalid.",
        };
      }

      this.applyLoadedData(migrateCache(parsed));
      this.writeLocalFile();
      const issueCount = Object.keys(this.issues).length;
      log.info(
        { gcsKey: result.key, issueCount },
        "[ValidationCache] Pulled production cache from GCS (local only; no upload)",
      );
      return { success: true, pulled: true, gcsKey: result.key, issueCount };
    } catch (err) {
      log.error({ err }, "[ValidationCache] Failed to pull from GCS:");
      return {
        success: false,
        pulled: false,
        gcsKey,
        issueCount: currentCount(),
        reason: err instanceof Error ? err.message : "Failed to pull validation cache from GCS.",
      };
    }
  }

  resolveEntryKeyFromUrl(url: string): string | undefined {
    return this.indexes.byUrl[url];
  }

  registerUrl(url: string, entryKey: string): void {
    this.indexes.byUrl[url] = entryKey;
  }

  getIssuesByEntryKey(entryKey: string): StoredValidationIssue[] {
    const ids = this.indexes.byEntry[entryKey] ?? [];
    return ids.map((id) => this.issues[id]).filter(Boolean) as StoredValidationIssue[];
  }

  getIssuesByScope(scope: ValidationScope): StoredValidationIssue[] {
    const ids = this.indexes.byScope[scope] ?? [];
    return ids.map((id) => this.issues[id]).filter(Boolean) as StoredValidationIssue[];
  }

  getAllIssues(): StoredValidationIssue[] {
    return Object.values(this.issues);
  }

  getRunMetaForEntry(entryKey: string): EntryRunMeta | undefined {
    return this.runMetaByEntry[entryKey];
  }

  markEntryDirty(entryKey: string): void {
    const existing = this.runMetaByEntry[entryKey] ?? {
      lastRunAt: new Date().toISOString(),
      byValidator: {},
    };
    this.runMetaByEntry[entryKey] = { ...existing, dirty: true };
  }

  /** Remove all issues and run-meta for an entry key (e.g. unpublish / delete variant). */
  clearEntryKey(entryKey: string): void {
    const ids = [...(this.indexes.byEntry[entryKey] ?? [])];
    this.dropCompletions(ids);
    this.dropClaims(ids);
    for (const id of ids) {
      delete this.issues[id];
    }
    delete this.indexes.byEntry[entryKey];
    delete this.runMetaByEntry[entryKey];
    this.indexes = rebuildIndexes(this.issues, this.indexes.byUrl);
  }

  markScopeDirty(scope: ValidationScope): void {
    const existing = this.runMetaByScope[scope] ?? {
      lastRunAt: new Date().toISOString(),
      byValidator: {},
    };
    this.runMetaByScope[scope] = { ...existing, dirty: true };
  }

  applyValidatorResults(
    validators: ValidatorResult[],
    options: ApplyValidatorResultsOptions,
  ): void {
    const nowIso = new Date().toISOString();
    const contentFiles = options.contentFiles;
    const entryKeySet =
      options.entryKeys && options.entryKeys.length > 0
        ? new Set(options.entryKeys)
        : null;

    for (const file of contentFiles) {
      // Shared public URLs: only live (non-variant) rows own byUrl → entryKey.
      if (file.variant) continue;
      const ek = entryKeyFromContentFile(file);
      const url = getCanonicalUrl(file);
      this.indexes.byUrl[url] = ek;
    }

    for (const v of validators) {
      const runClass = getValidatorRunClass(v.name);
      this.clearValidatorSlice(v.name, runClass, entryKeySet);

      const stampedErrors = v.errors.map((i) => ({
        ...i,
        validator: v.name,
        category: i.category ?? v.category,
      }));
      const stampedWarnings = v.warnings.map((i) => ({
        ...i,
        validator: v.name,
        category: i.category ?? v.category,
      }));

      for (const raw of [...stampedErrors, ...stampedWarnings]) {
        const stored = issueToStored(raw, v.name, nowIso, contentFiles);
        const priorCompletion = this.completions[stored.id];
        if (priorCompletion) {
          const priorIssue = this.issues[stored.id];
          emitValidationIssueWorkflowEvent({
            type: "validation_issue_reopened",
            site: this.contentFolder,
            issue: priorIssue ?? stored,
            author: priorCompletion.completedBy,
            priorCompletion,
          });
        }
        // Fresh write resurfaces: clear soft-complete for this id.
        delete this.completions[stored.id];
        this.issues[stored.id] = stored;
      }

      if (isEntryLocalValidator(v.name) && entryKeySet) {
        for (const ek of entryKeySet) {
          const prev = this.runMetaByEntry[ek] ?? { lastRunAt: nowIso, byValidator: {} };
          this.runMetaByEntry[ek] = {
            lastRunAt: nowIso,
            byValidator: { ...prev.byValidator, [v.name]: nowIso },
            dirty: false,
          };
        }
      } else if (isCrossEntryValidator(v.name) || isMediaValidator(v.name)) {
        for (const issue of Object.values(this.issues)) {
          if (issue.validator !== v.name) continue;
          for (const t of issue.targets) {
            if (t.type !== "entry") continue;
            const prev = this.runMetaByEntry[t.entryKey] ?? {
              lastRunAt: nowIso,
              byValidator: {},
            };
            this.runMetaByEntry[t.entryKey] = {
              lastRunAt: nowIso,
              byValidator: { ...prev.byValidator, [v.name]: nowIso },
              dirty: false,
            };
          }
        }
        for (const scope of issueScopesForValidatorName(v.name)) {
          const prev = this.runMetaByScope[scope] ?? {
            lastRunAt: nowIso,
            byValidator: {},
          };
          this.runMetaByScope[scope] = {
            lastRunAt: nowIso,
            byValidator: { ...prev.byValidator, [v.name]: nowIso },
            dirty: false,
          };
        }
      } else if (isDatabaseValidator(v.name)) {
        const prev = this.runMetaByScope.database ?? {
          lastRunAt: nowIso,
          byValidator: {},
        };
        this.runMetaByScope.database = {
          lastRunAt: nowIso,
          byValidator: { ...prev.byValidator, [v.name]: nowIso },
          dirty: false,
        };
      }

      if (isEntryLocalValidator(v.name) && !entryKeySet) {
        for (const file of contentFiles) {
          const ek = entryKeyFromContentFile(file);
          const prev = this.runMetaByEntry[ek] ?? { lastRunAt: nowIso, byValidator: {} };
          this.runMetaByEntry[ek] = {
            lastRunAt: nowIso,
            byValidator: { ...prev.byValidator, [v.name]: nowIso },
            dirty: false,
          };
        }
      }
    }

    this.indexes = rebuildIndexes(this.issues, this.indexes.byUrl);
    this.gcOrphanOverlays();
    this.lastFullRunAt = nowIso;
    if (options.markSiteWide) {
      this.lastSiteWideRunAt = nowIso;
    }
  }

  private clearValidatorSlice(
    validatorName: string,
    runClass: ReturnType<typeof getValidatorRunClass>,
    entryKeySet: Set<string> | null,
  ): void {
    const toDelete: string[] = [];
    for (const [id, issue] of Object.entries(this.issues)) {
      if (issue.validator !== validatorName) continue;

      if (runClass === "cross-entry" || runClass === "media" || runClass === "database") {
        toDelete.push(id);
        continue;
      }

      if (!entryKeySet) {
        toDelete.push(id);
        continue;
      }
      const touches = issue.targets.some(
        (t) => t.type === "entry" && entryKeySet.has(t.entryKey),
      );
      const isFileOnlyTarget =
        issue.targets.length > 0 && issue.targets.every((t) => t.type === "file");
      // section-variants re-scans shared templates (single.*.yml) on every partial run;
      // file-only cached rows must be cleared even when entryKeySet is scoped to one URL.
      if (
        touches ||
        issue.targets.length === 0 ||
        (validatorName === "section-variants" && isFileOnlyTarget)
      ) {
        toDelete.push(id);
      }
    }
    // Completions for deleted ids are cleared in the rewrite loop (reopen event) or gcOrphanOverlays.
    for (const id of toDelete) delete this.issues[id];
  }

  getByUrl(url: string): PageCacheEntry | undefined {
    const entryKey = this.indexes.byUrl[url];
    if (!entryKey) {
      const legacyKey = `legacy${url.replace(/\//g, "__")}`;
      const legacyIssues = this.getOpenIssuesByEntryKey(legacyKey);
      if (legacyIssues.length === 0 && !this.runMetaByEntry[legacyKey]) return undefined;
      return pageEntryFromStored(legacyIssues, this.runMetaByEntry[legacyKey]);
    }
    const issues = this.getOpenIssuesByEntryKey(entryKey);
    const meta = this.runMetaByEntry[entryKey];
    if (issues.length === 0 && !meta) return undefined;
    return pageEntryFromStored(issues, {
      lastRunAt: meta?.lastRunAt,
      lastFullRunAt: meta?.lastRunAt,
    });
  }

  getByEntryKey(entryKey: string): PageCacheEntry | undefined {
    const issues = this.getOpenIssuesByEntryKey(entryKey);
    const meta = this.runMetaByEntry[entryKey];
    if (issues.length === 0 && !meta) return undefined;
    return pageEntryFromStored(issues, {
      lastRunAt: meta?.lastRunAt,
      lastFullRunAt: meta?.lastRunAt,
    });
  }

  setByUrl(url: string, entry: PageCacheEntry): void {
    let entryKey = this.indexes.byUrl[url];
    if (!entryKey) {
      entryKey = `legacy${url.replace(/\//g, "__")}`;
      this.indexes.byUrl[url] = entryKey;
    }

    const existingIds = [...(this.indexes.byEntry[entryKey] ?? [])];
    this.dropCompletions(existingIds);
    this.dropClaims(existingIds);
    for (const id of existingIds) delete this.issues[id];

    const nowIso = entry.lastRunAt || new Date().toISOString();
    const byValidator: Record<string, string> = {};

    const add = (raw: ValidationIssue, severity: "error" | "warning") => {
      const validator = raw.validator || "legacy";
      const stored = issueToStored(
        { ...raw, type: severity, validator },
        validator,
        nowIso,
        [],
        [{ type: "entry", entryKey, url, file: raw.file }],
      );
      this.issues[stored.id] = stored;
      byValidator[validator] = nowIso;
    };
    for (const e of entry.errors) add(e, "error");
    for (const w of entry.warnings) add(w, "warning");

    this.runMetaByEntry[entryKey] = {
      lastRunAt: nowIso,
      byValidator,
      dirty: false,
    };
    this.indexes = rebuildIndexes(this.issues, this.indexes.byUrl);
  }

  getAll(): Map<string, PageCacheEntry> {
    const map = new Map<string, PageCacheEntry>();
    for (const [url, entryKey] of Object.entries(this.indexes.byUrl)) {
      const entry = this.getByEntryKey(entryKey);
      if (entry) map.set(url, entry);
    }
    return map;
  }

  getAllByEntryKey(): Map<string, PageCacheEntry> {
    const map = new Map<string, PageCacheEntry>();
    const keys = new Set([
      ...Object.keys(this.indexes.byEntry),
      ...Object.keys(this.runMetaByEntry),
    ]);
    for (const ek of keys) {
      const entry = this.getByEntryKey(ek);
      if (entry) map.set(ek, entry);
    }
    return map;
  }

  getByDatabase(name: string): DatabaseCacheEntry | undefined {
    return this.dbMap.get(name);
  }

  setByDatabase(name: string, entry: DatabaseCacheEntry): void {
    this.dbMap.set(name, entry);
  }

  getAllDatabases(): Map<string, DatabaseCacheEntry> {
    return this.dbMap;
  }

  markFullRunAt(ts: string): void {
    this.lastFullRunAt = ts;
  }

  getLastFullRunAt(): string | null {
    return this.lastFullRunAt;
  }

  getLastSiteWideRunAt(): string | null {
    return this.lastSiteWideRunAt;
  }

  /** Remove all cached issues for a specific URL+code pair and flush to disk. */
  async dismissIssuesByUrlAndCode(url: string, code: string): Promise<number> {
    const toDelete = Object.values(this.issues).filter(
      (issue) => issue.code === code && issue.targets?.some((t) => t.type === "entry" && t.url === url),
    );
    this.dropCompletions(toDelete.map((i) => i.id));
    this.dropClaims(toDelete.map((i) => i.id));
    for (const issue of toDelete) delete this.issues[issue.id];
    if (toDelete.length > 0) {
      this.indexes = rebuildIndexes(this.issues, this.indexes.byUrl);
      await this.flush();
      log.info(`[ValidationCache] Dismissed ${toDelete.length} issue(s) for url=${url} code=${code}`);
    }
    return toDelete.length;
  }

  async dismissIssuesByFileAndCode(file: string, code: string): Promise<number> {
    const toDelete = Object.values(this.issues).filter(
      (issue) => issue.code === code && issue.file === file,
    );
    this.dropCompletions(toDelete.map((i) => i.id));
    this.dropClaims(toDelete.map((i) => i.id));
    for (const issue of toDelete) delete this.issues[issue.id];
    if (toDelete.length > 0) {
      this.indexes = rebuildIndexes(this.issues, this.indexes.byUrl);
      await this.flush();
      log.info(`[ValidationCache] Dismissed ${toDelete.length} issue(s) for file=${file} code=${code}`);
    }
    return toDelete.length;
  }

  /** Wipe all stored issues, indexes, run meta, and database health entries; flush to disk. */
  async clearAll(): Promise<void> {
    this.issues = {};
    this.indexes = emptyIndexes();
    this.runMetaByEntry = {};
    this.runMetaByScope = {};
    this.completions = {};
    this.claims = {};
    this.dbMap = new Map();
    this.lastFullRunAt = null;
    this.lastSiteWideRunAt = null;
    await this.flush();
    log.info("[ValidationCache] Cleared all issues and run metadata");
  }

  /**
   * Drop v4→v5 migration orphans tagged `validator: "legacy"`.
   * Replace-by-validator never clears these when real validators re-run.
   * Does not touch other issues or wipe run metadata (only removes `legacy` stamps).
   */
  async purgeLegacyIssues(): Promise<{ removed: number }> {
    const toDelete = Object.values(this.issues).filter(
      (issue) => issue.validator === "legacy",
    );
    this.dropCompletions(toDelete.map((i) => i.id));
    this.dropClaims(toDelete.map((i) => i.id));
    for (const issue of toDelete) delete this.issues[issue.id];

    for (const meta of Object.values(this.runMetaByEntry)) {
      if (meta.byValidator?.legacy) {
        delete meta.byValidator.legacy;
      }
    }
    for (const meta of Object.values(this.runMetaByScope)) {
      if (meta?.byValidator?.legacy) {
        delete meta.byValidator.legacy;
      }
    }

    if (toDelete.length > 0) {
      this.indexes = rebuildIndexes(this.issues, this.indexes.byUrl);
      await this.flush();
      log.info(
        `[ValidationCache] Purged ${toDelete.length} legacy validator issue(s)`,
      );
    }
    return { removed: toDelete.length };
  }

  flush(): Promise<void> {
    this.writeQueue = this.writeQueue.then(() => this.doFlush()).catch((err) => {
      log.error({ err }, "[ValidationCache] Flush error");
    });
    return this.writeQueue;
  }

  private buildCacheFile(): ValidationCacheFileV5 {
    const pages: Record<string, PageCacheEntry> = {};
    for (const [url] of Object.entries(this.indexes.byUrl)) {
      const entry = this.getByUrl(url);
      if (entry) pages[url] = entry;
    }

    return {
      meta: {
        version: CACHE_VERSION,
        lastFullRunAt: this.lastFullRunAt,
        lastSiteWideRunAt: this.lastSiteWideRunAt,
      },
      issues: this.issues,
      indexes: this.indexes,
      runMeta: {
        byEntry: this.runMetaByEntry,
        byScope: this.runMetaByScope,
      },
      completions: this.completions,
      claims: this.claims,
      pages,
      databases: Object.fromEntries(this.dbMap.entries()),
    };
  }

  private writeLocalFile(): void {
    const data = this.buildCacheFile();
    fs.writeFileSync(this.cacheFile, JSON.stringify(data, null, 2) + "\n", "utf-8");
  }

  private saveToBucket(): void {
    if (!IS_PRODUCTION || !gcs.available) return;
    const content = JSON.stringify(this.buildCacheFile(), null, 2) + "\n";
    gcs.debouncedUpload(this.gcsKey(), Buffer.from(content, "utf-8"), "application/json", 30_000);
  }

  private async doFlush(): Promise<void> {
    try {
      this.writeLocalFile();
      log.info(
        `[ValidationCache] Flushed ${Object.keys(this.issues).length} issues, ${this.dbMap.size} database entries to disk`,
      );
    } catch (err) {
      log.error({ err }, "[ValidationCache] Failed to write cache file");
      return;
    }
    if (!this.skipGcsUpload) {
      this.saveToBucket();
    }
  }

  async shutdown(): Promise<void> {
    try {
      this.writeLocalFile();
    } catch (err) {
      log.error({ err }, "[ValidationCache] Failed to write cache file on shutdown");
      return;
    }
    if (!IS_PRODUCTION || !gcs.available) return;
    await gcs.flushPending();
    try {
      const content = JSON.stringify(this.buildCacheFile(), null, 2) + "\n";
      await gcs.upload(this.gcsKey(), Buffer.from(content, "utf-8"), "application/json");
    } catch (err) {
      log.error({ err }, "[ValidationCache] Error saving to bucket on shutdown");
    }
  }

  /** Force-upload validation cache to GCS immediately. Admin Cloud Sync. */
  async forceUploadToBucket(): Promise<{
    success: boolean;
    uploaded: boolean;
    gcsKey: string;
    reason?: string;
  }> {
    const gcsKey = this.gcsKey();
    if (!IS_PRODUCTION) {
      return {
        success: false,
        uploaded: false,
        gcsKey,
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
        gcsKey,
        reason: "GCS is unavailable — missing GCS_BUCKET_NAME or credentials.",
      };
    }
    if (!fs.existsSync(this.cacheFile) && Object.keys(this.issues).length === 0) {
      return {
        success: false,
        uploaded: false,
        gcsKey,
        reason: "No local validation-cache file found to upload.",
      };
    }
    this.writeLocalFile();
    const content = JSON.stringify(this.buildCacheFile(), null, 2) + "\n";
    await gcs.upload(gcsKey, Buffer.from(content, "utf-8"), "application/json");
    log.info("[ValidationCache] Re-uploaded cache to GCS via admin action");
    return { success: true, uploaded: true, gcsKey };
  }

  getLocalPath(): string {
    return this.cacheFile;
  }

  getGcsObjectKey(): string {
    return this.gcsKey();
  }
}

export type CacheIssueListRow = {
  id: string;
  url: string;
  entryKey?: string;
  severity: "error" | "warning";
  code: string;
  message: string;
  validator?: string;
  category?: string;
  lastFullRunAt?: string;
  suggestion?: string;
  file?: string;
  completed?: { by: string; at: string; actor?: ValidationIssueActor; report?: string };
  claimed?: { by: string; at: string; expiresAt: string; actor?: ValidationIssueActor; report?: string };
};

export type CacheIssueFacets = {
  validator: string[];
  category: string[];
  code: string[];
  severity: Array<"error" | "warning">;
};

export type ListCacheIssuesFilters = {
  entryKey?: string;
  url?: string;
  scope?: ValidationScope;
  redirect?: string;
  media?: string;
  database?: string;
  file?: string;
  validator?: string;
  category?: string;
  code?: string;
  severity?: "error" | "warning";
  /** When true, include soft-completed issues (default: open only). */
  includeCompleted?: boolean;
};

function uniqueSorted(values: Iterable<string>): string[] {
  return [...new Set(values)].filter(Boolean).sort((a, b) => a.localeCompare(b));
}

export function buildCacheIssueFacets(rows: CacheIssueListRow[]): CacheIssueFacets {
  const severities = new Set<"error" | "warning">();
  for (const r of rows) {
    if (r.severity === "error" || r.severity === "warning") severities.add(r.severity);
  }
  return {
    validator: uniqueSorted(rows.map((r) => r.validator ?? "")),
    category: uniqueSorted(rows.map((r) => r.category ?? "")),
    code: uniqueSorted(rows.map((r) => r.code)),
    severity: (["error", "warning"] as const).filter((s) => severities.has(s)),
  };
}

export function listCacheIssuesFromStore(
  cache: ValidationCacheService,
  filters?: ListCacheIssuesFilters,
): { issues: CacheIssueListRow[]; facets: CacheIssueFacets } {
  let issues = cache.getAllIssues();

  if (filters?.entryKey) {
    issues = cache.getIssuesByEntryKey(filters.entryKey);
  } else if (filters?.url) {
    const ek = cache.resolveEntryKeyFromUrl(filters.url);
    issues = ek ? cache.getIssuesByEntryKey(ek) : [];
  } else if (filters?.scope) {
    issues = cache.getIssuesByScope(filters.scope);
  } else if (filters?.redirect) {
    issues = cache
      .getAllIssues()
      .filter((i) =>
        i.targets.some((t) => t.type === "redirect" && t.from === filters.redirect),
      );
  } else if (filters?.media) {
    issues = cache
      .getAllIssues()
      .filter((i) =>
        i.targets.some((t) => t.type === "media" && t.imageId === filters.media),
      );
  } else if (filters?.database) {
    issues = cache
      .getAllIssues()
      .filter((i) =>
        i.targets.some((t) => t.type === "database" && t.dbSlug === filters.database),
      );
  } else if (filters?.file) {
    issues = cache.getAllIssues().filter((i) => i.file === filters.file);
  }

  if (filters?.validator) {
    issues = issues.filter((i) => i.validator === filters.validator);
  }
  if (filters?.category) {
    issues = issues.filter((i) => i.category === filters.category);
  }
  if (filters?.code) {
    issues = issues.filter((i) => i.code === filters.code);
  }
  if (filters?.severity) {
    issues = issues.filter((i) => i.severity === filters.severity);
  }

  if (!filters?.includeCompleted) {
    issues = issues.filter((i) => !cache.isIssueCompleted(i.id));
  }

  const out: CacheIssueListRow[] = [];

  for (const issue of issues) {
    if (issue.severity === "info") continue;
    const completion = cache.getCompletion(issue.id);
    const completed = completion ? completionToApiRow(completion) : undefined;
    const claim = cache.getActiveClaim(issue.id);
    const claimed = claim ? claimToApiRow(claim) : undefined;
    const entryTargets = issue.targets.filter((t) => t.type === "entry") as Array<{
      type: "entry";
      entryKey: string;
      url?: string;
    }>;
    if (entryTargets.length === 0) {
      out.push({
        id: issue.id,
        url: "",
        severity: issue.severity,
        code: issue.code,
        message: issue.message,
        validator: issue.validator,
        category: issue.category,
        lastFullRunAt: issue.lastRunAt,
        suggestion: issue.suggestion,
        file: issue.file,
        completed,
        claimed,
      });
      continue;
    }
    for (const t of entryTargets) {
      out.push({
        id: issue.id,
        url: t.url ?? "",
        entryKey: t.entryKey,
        severity: issue.severity,
        code: issue.code,
        message: issue.message,
        validator: issue.validator,
        category: issue.category,
        lastFullRunAt: issue.lastRunAt,
        suggestion: issue.suggestion,
        file: issue.file,
        completed,
        claimed,
      });
    }
  }
  return { issues: out, facets: buildCacheIssueFacets(out) };
}

let _defaultInstance: ValidationCacheService | null = null;

export function getValidationCacheService(): ValidationCacheService {
  if (!_defaultInstance) {
    const contentRoot = getDefaultContentRoot();
    _defaultInstance = new ValidationCacheService(contentRoot);
  }
  return _defaultInstance;
}

export async function loadValidationCachesFromBucket(): Promise<void> {
  await Promise.all(
    [...getSiteContextMap().values()].map((ctx) => ctx.validationCache.loadFromBucket()),
  );
}

export async function shutdownValidationCaches(): Promise<void> {
  await Promise.all(
    [...getSiteContextMap().values()].map((ctx) => ctx.validationCache.shutdown()),
  );
}
