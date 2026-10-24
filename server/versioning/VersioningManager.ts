import fs from "fs";
import path from "path";
import * as yaml from "js-yaml";
import { escapeTemplateVars, unescapeObjectVars } from "../../shared/templateVars";
import { deepMerge } from "../utils/deepMerge";
import { getFolder, getType } from "../content-types";
import { addFileModifiedListener, markFileAsModified } from "../sync-state";
import { siteSyncGcsKey, SYNC_FILENAMES, versioningStateReadKeys } from "@shared/gcsKeys";
import { gcs } from "../gcs";
import { hashUserId } from "./cookie-utils";
import {
  DEFAULT_VARIANT_SLUG,
  allocatedTotal,
  experimentId,
  hasActiveTraffic,
  pickVariant,
} from "./assignment";

/** `_draft` is variant-file system metadata, never page content (see draft-meta.ts). */
function stripDraftMeta(data: Record<string, unknown>): Record<string, unknown> {
  if (!("_draft" in data)) return data;
  const { _draft: _omit, ...rest } = data;
  return rest;
}
import { child } from "../logger";
import { getDefaultContentFolder, getDefaultContentRoot } from "../site-config";
import {
  TEMPLATE_VERSIONING_SLUG,
  isTemplateVersioningSlug,
} from "../shared-layout-entry";
import {
  VARIANT_SHELL_BASENAME_RE,
  LIVE_SHELL_BASENAME_RE,
  isReservedTemplateVariantSlug,
  isSharedTemplateBasename,
  variantTemplateBasename,
  shellBasenameCandidates,
} from "../shared-layout-paths";
const log = child({ module: "versioning/VersioningManager" });

export type VariantContentSuccess = { ok: true; data: unknown };
export type VariantContentFailure = {
  ok: false;
  reason: "missing" | "parse_error";
  message: string;
  /** Absolute path when known (parse_error); empty when missing. */
  filePath: string;
};
export type VariantContentResult = VariantContentSuccess | VariantContentFailure;

function formatYamlLoadError(error: unknown): string {
  if (error && typeof error === "object" && "mark" in error) {
    const e = error as { message?: string; mark?: { line: number; column: number } };
    if (e.mark && typeof e.mark.line === "number") {
      const base = e.message?.trim() || "YAML parse error";
      return `${base} (line ${e.mark.line + 1}, column ${(e.mark.column ?? 0) + 1})`;
    }
  }
  return error instanceof Error ? error.message : String(error);
}

const IS_PRODUCTION = process.env.NODE_ENV === "production";

function getDefaultContentFolderName(): string {
  try {
    const { getDefaultSite } = require('../site-manager') as typeof import('../site-manager');
    return getDefaultSite().contentRootName;
  } catch {
    return getDefaultContentFolder();
  }
}

function isKnownSiteContentFolder(folderName: string): boolean {
  try {
    const { getSiteConfigs } = require('../site-config') as typeof import('../site-config');
    return getSiteConfigs().some((s: import('../site-config').SiteConfig) => s.contentFolder === folderName);
  } catch {
    return folderName === getDefaultContentFolder();
  }
}

function getContentDir(): string {
  return getDefaultContentRoot();
}

function getStateFile(): string {
  return path.join(getContentDir(), ".versioning-state.json");
}

export interface VersioningVariant {
  slug: string;
  allocation: number;
}

export interface VersioningLocale {
  variants: VersioningVariant[];
  /** ISO date (YYYY-MM-DD) the current test run started; part of experiment_id. */
  started_at?: string;
}

export interface VersioningFile {
  [locale: string]: VersioningLocale;
}

/** Bump to archive and reset counts on deploy (assignment/counting semantics changed). */
export const VERSIONING_STATE_EPOCH = 2;

interface VersioningState {
  epoch: number;
  counts: Record<string, number>;
  visitors: Record<string, string[]>;
  lastFlushed: number;
}

export type ExistingAssignment = string | { variantSlug: string; run?: string | null };

/** Counts key: `contentType/slug/locale[@run]/variant`. */
export function exposureStateKey(
  contentType: string,
  slug: string,
  locale: string,
  run: string | null | undefined,
  variantSlug: string,
): string {
  return `${contentType}/${slug}/${locale}${run ? `@${run}` : ""}/${variantSlug}`;
}

const SAVE_DEBOUNCE_MS = 2_000;

export class VersioningManager {
  /** Per-site dedupe of counted visitors (keys are not site-qualified). */
  private visitorSets: Map<string, Set<string>> = new Map();
  private configCache: Map<string, VersioningFile> = new Map();
  private contentCache: Map<string, unknown> = new Map();
  private state: VersioningState = {
    epoch: VERSIONING_STATE_EPOCH,
    counts: {},
    visitors: {},
    lastFlushed: Date.now(),
  };
  private saveTimer: NodeJS.Timeout | null = null;
  private readonly contentRoot: string;

  constructor(contentRoot?: string) {
    this.contentRoot = contentRoot ?? getContentDir();
    this.loadState();
    this.loadStateFromBucket();
    this.registerFileModifiedListener();
  }

  private contentDir(): string {
    return this.contentRoot;
  }

  private contentFolderName(): string {
    return path.relative(process.cwd(), this.contentRoot);
  }

  /**
   * Parse a relative file path and return variant coordinates if it is a
   * variant content file (e.g. "4geeks-com/landings/my-page/test.en.yml"
   * or type-root "4geeks-com/how-to/single.draft.en.yml").
   * Returns null for regular locale files, shared templates, or internal files.
   */
  private parseVariantFilePath(relativePath: string): {
    contentType: string;
    slug: string;
    variantSlug: string;
    locale: string;
  } | null {
    const parts = relativePath.replace(/\\/g, "/").split("/");
    if (!isKnownSiteContentFolder(parts[0]) || !parts[parts.length - 1]?.endsWith(".yml")) {
      return null;
    }

    const file = parts[parts.length - 1];
    const base = file.slice(0, -4); // strip .yml

    // Type-root template variant: template|single.{variant}.{locale}.yml (3 path segments after site)
    if (parts.length === 3) {
      const m = VARIANT_SHELL_BASENAME_RE.exec(file);
      if (!m) return null;
      const variantSlug = m[1];
      const locale = m[2];
      if (variantSlug.startsWith("_") || isReservedTemplateVariantSlug(variantSlug)) return null;
      const folder = parts[1];
      const contentType = getType(folder);
      return { contentType, slug: TEMPLATE_VERSIONING_SLUG, variantSlug, locale };
    }

    // Expected structure: {content-folder} / {folder} / {slug} / {file}.yml
    if (parts.length !== 4) return null;

    const lastDot = base.lastIndexOf(".");
    if (lastDot === -1) return null; // "en.yml" — plain locale file, no variant

    const variantSlug = base.slice(0, lastDot);
    const locale = base.slice(lastDot + 1);

    // Exclude shared templates and reserved/internal names
    if (!variantSlug || isReservedTemplateVariantSlug(variantSlug) || variantSlug.startsWith("_")) return null;
    // Locale codes are short alpha-only strings
    if (!/^[a-z]{2,5}$/.test(locale)) return null;

    const folder = parts[1];
    const slug = parts[2];
    const contentType = getType(folder);

    return { contentType, slug, variantSlug, locale };
  }

  /** Directory that holds versioning.yml and variant YAML files. */
  public getVersioningContentDir(contentType: string, slug: string): string {
    const folder = getFolder(contentType);
    if (isTemplateVersioningSlug(slug)) {
      return path.join(this.contentDir(), folder);
    }
    return path.join(this.contentDir(), folder, slug);
  }

  public getVersioningFilePath(contentType: string, slug: string): string {
    return path.join(this.getVersioningContentDir(contentType, slug), "versioning.yml");
  }

  /**
   * Path to a variant YAML file.
   * Template mode: template.{variant}.{locale}.yml at type root (writes always template.*).
   * Entry mode: {variant}.{locale}.yml under the entry folder.
   */
  public getVariantFilePath(
    contentType: string,
    slug: string,
    variantSlug: string,
    locale: string,
  ): string {
    const dir = this.getVersioningContentDir(contentType, slug);
    if (isTemplateVersioningSlug(slug)) {
      return path.join(dir, variantTemplateBasename(variantSlug, locale));
    }
    return path.join(dir, `${variantSlug}.${locale}.yml`);
  }

  private registerFileModifiedListener(): void {
    addFileModifiedListener((evt) => {
      const filePath = evt.filePath;
      const parsed = this.parseVariantFilePath(filePath);
      if (parsed) {
        const { contentType, slug, variantSlug, locale } = parsed;
        this.invalidateVariantCache(contentType, slug, variantSlug, locale);
      }
    });
  }

  private stateFile(): string {
    return path.join(this.contentDir(), ".versioning-state.json");
  }

  private gcsStateKey(): string {
    return siteSyncGcsKey(this.contentFolderName(), SYNC_FILENAMES.versioningState);
  }

  private gcsStateReadKeys(): string[] {
    return versioningStateReadKeys(this.contentFolderName());
  }

  private loadState(): void {
    try {
      if (fs.existsSync(this.stateFile())) {
        const data = fs.readFileSync(this.stateFile(), "utf-8");
        this.applyLoadedState(JSON.parse(data));
      }
    } catch (error) {
      log.error({ err: error }, "[Versioning] Error loading state:");
    }
  }

  private applyLoadedState(loaded: any): void {
    const loadedEpoch = typeof loaded?.epoch === "number" ? loaded.epoch : 1;
    if (loadedEpoch < VERSIONING_STATE_EPOCH) {
      this.archiveOldEpoch(loaded, loadedEpoch);
      this.state = {
        epoch: VERSIONING_STATE_EPOCH,
        counts: {},
        visitors: {},
        lastFlushed: Date.now(),
      };
      this.visitorSets.clear();
      this.saveState();
      log.info(`[Versioning] State epoch ${loadedEpoch} archived; counts reset for epoch ${VERSIONING_STATE_EPOCH}`);
      return;
    }

    this.state = {
      epoch: loadedEpoch,
      counts: loaded.counts || {},
      visitors: loaded.visitors || {},
      lastFlushed: loaded.lastFlushed || Date.now(),
    };

    this.visitorSets.clear();
    for (const [key, visitorIds] of Object.entries(this.state.visitors)) {
      this.visitorSets.set(key, new Set(visitorIds as string[]));
    }

    log.info("[Versioning] Loaded state:", Object.keys(this.state.counts).length, "variant keys");
  }

  /** Path of the one-time archive written when an older state epoch is loaded. */
  public getEpochArchivePath(epoch: number): string {
    return this.stateFile().replace(/\.json$/, `.epoch${epoch}.json`);
  }

  private archiveOldEpoch(loaded: unknown, epoch: number): void {
    const content = JSON.stringify(loaded, null, 2);
    try {
      fs.writeFileSync(this.getEpochArchivePath(epoch), content);
    } catch (error) {
      log.error({ err: error }, "[Versioning] Error archiving old state epoch locally:");
    }
    if (IS_PRODUCTION && gcs.available) {
      const key = this.gcsStateKey().replace(/\.json$/, `.epoch${epoch}.json`);
      gcs.upload(key, Buffer.from(content, "utf-8"), "application/json").catch((error: unknown) => {
        log.error({ err: error }, "[Versioning] Error archiving old state epoch to bucket:");
      });
    }
  }

  private async loadStateFromBucket(): Promise<void> {
    if (!IS_PRODUCTION || !gcs.available) {
      if (!IS_PRODUCTION) log.info("[Versioning] Development mode, using local file only");
      return;
    }

    try {
      const result = await gcs.downloadFirstExisting(this.gcsStateReadKeys());
      if (!result) {
        log.info("[Versioning] No state found in bucket, using local file");
        return;
      }

      const loaded = JSON.parse(result.data.toString("utf-8"));
      this.applyLoadedState(loaded);
      this.saveStateLocal();
      log.info("[Versioning] Loaded state from GCS bucket");
    } catch (error) {
      log.error({ err: error }, "[Versioning] Error loading from bucket:");
    }
  }

  private saveStateLocal(): void {
    try {
      this.state.lastFlushed = Date.now();
      fs.writeFileSync(this.stateFile(), JSON.stringify(this.state, null, 2));
    } catch (error) {
      log.error({ err: error }, "[Versioning] Error saving state locally:");
    }
  }

  private saveStateToBucket(): void {
    if (!IS_PRODUCTION || !gcs.available) return;

    const content = JSON.stringify(this.state, null, 2);
    gcs.debouncedUpload(this.gcsStateKey(), Buffer.from(content, "utf-8"), "application/json", 30_000);
  }

  private saveState(): void {
    this.saveStateLocal();
    this.saveStateToBucket();
  }

  /** Coalesce per-visitor writes; shutdown() flushes. */
  private scheduleSave(): void {
    if (this.saveTimer) return;
    this.saveTimer = setTimeout(() => {
      this.saveTimer = null;
      this.saveState();
    }, SAVE_DEBOUNCE_MS);
    this.saveTimer.unref?.();
  }

  /** Write pending state now (tests, shutdown). */
  public flushState(): void {
    if (this.saveTimer) {
      clearTimeout(this.saveTimer);
      this.saveTimer = null;
    }
    this.saveState();
  }

  public async shutdown(): Promise<void> {
    if (this.saveTimer) {
      clearTimeout(this.saveTimer);
      this.saveTimer = null;
    }
    this.saveStateLocal();
    if (IS_PRODUCTION && gcs.available) {
      await gcs.flushPending();
      try {
        const content = JSON.stringify(this.state, null, 2);
        await gcs.upload(this.gcsStateKey(), Buffer.from(content, "utf-8"), "application/json");
      } catch (error) {
        log.error({ err: error }, "[Versioning] Error saving to bucket on shutdown:");
      }
    }
  }

  /** Reload assignment state from GCS (prod) or keep/reload local. Admin Cloud Sync. */
  public async reloadStateFromBucket(): Promise<"gcs" | "local"> {
    if (IS_PRODUCTION) {
      if (!gcs.available) gcs.initBootstrapFromEnv();
      if (gcs.available) {
        try {
          const result = await gcs.downloadFirstExisting(this.gcsStateReadKeys());
          if (result) {
            const loaded = JSON.parse(result.data.toString("utf-8"));
            this.applyLoadedState(loaded);
            this.saveStateLocal();
            log.info("[Versioning] Reloaded state from GCS via admin action");
            return "gcs";
          }
        } catch (error) {
          log.error({ err: error }, "[Versioning] Error reloading from bucket:");
        }
      }
    }
    this.loadState();
    return "local";
  }

  /** Force-upload versioning state to GCS immediately. Admin Cloud Sync. */
  public async forceUploadStateToBucket(): Promise<{
    success: boolean;
    uploaded: boolean;
    gcsKey: string;
    reason?: string;
  }> {
    const gcsKey = this.gcsStateKey();
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
    const statePath = this.stateFile();
    if (!fs.existsSync(statePath) && Object.keys(this.state.counts).length === 0) {
      return {
        success: false,
        uploaded: false,
        gcsKey,
        reason: "No local versioning-state file found to upload.",
      };
    }
    this.saveStateLocal();
    const content = JSON.stringify(this.state, null, 2);
    await gcs.upload(gcsKey, Buffer.from(content, "utf-8"), "application/json");
    log.info("[Versioning] Re-uploaded state to GCS via admin action");
    return { success: true, uploaded: true, gcsKey };
  }

  public getStateLocalPath(): string {
    return this.stateFile();
  }

  public getStateGcsKey(): string {
    return this.gcsStateKey();
  }

  private loadVersioningConfig(contentType: string, slug: string): VersioningFile | null {
    const cacheKey = `${contentType}:${slug}`;

    if (this.configCache.has(cacheKey)) {
      return this.configCache.get(cacheKey)!;
    }

    const configPath = this.getVersioningFilePath(contentType, slug);

    if (!fs.existsSync(configPath)) {
      return null;
    }

    try {
      const content = fs.readFileSync(configPath, "utf-8");
      const { escaped, map } = escapeTemplateVars(content);
      const rawParsed = yaml.load(escaped);
      const parsed = (rawParsed ? unescapeObjectVars(rawParsed, map) : rawParsed) as VersioningFile;
      this.configCache.set(cacheKey, parsed);
      return parsed;
    } catch (error) {
      log.error({ err: error }, `[Versioning] Error loading config for ${contentType}/${slug}:`);
      return null;
    }
  }

  /**
   * Find the actual YAML file for a variant slug + locale.
   * Template mode: template.{variant}.{locale}.yml (fallback single.*)
   * Entry mode: {variant}.{locale}.yml (or legacy {variant}.v*.{locale}.yml)
   */
  private findVariantFile(contentDir: string, variantSlug: string, locale: string, templateMode = false): string | null {
    if (templateMode) {
      for (const name of shellBasenameCandidates(locale, variantSlug)) {
        const p = path.join(contentDir, name);
        if (fs.existsSync(p)) return p;
      }
      return null;
    }

    const newPath = path.join(contentDir, `${variantSlug}.${locale}.yml`);
    if (fs.existsSync(newPath)) {
      return newPath;
    }

    try {
      const files = fs.readdirSync(contentDir);
      const oldPattern = new RegExp(`^${variantSlug}\\.v\\d+\\.${locale}\\.yml$`);
      const match = files.find((f) => oldPattern.test(f));
      if (match) {
        return path.join(contentDir, match);
      }
    } catch {
    }

    return null;
  }

  private loadVariantContentResult(
    contentType: string,
    slug: string,
    variantSlug: string,
    locale: string
  ): VariantContentResult {
    const cacheKey = `${contentType}:${slug}:${variantSlug}.${locale}`;

    if (this.contentCache.has(cacheKey)) {
      return { ok: true, data: this.contentCache.get(cacheKey) };
    }

    const templateMode = isTemplateVersioningSlug(slug);
    const contentDir = this.getVersioningContentDir(contentType, slug);
    const filePath = this.findVariantFile(contentDir, variantSlug, locale, templateMode);

    if (!filePath) {
      const expected = templateMode
        ? variantTemplateBasename(variantSlug, locale)
        : `${variantSlug}.${locale}.yml`;
      log.warn(`[Versioning] Variant file not found: ${expected} in ${contentDir}`);
      return {
        ok: false,
        reason: "missing",
        message: `Variant file not found: ${expected}`,
        filePath: "",
      };
    }

    try {
      if (templateMode) {
        const content = fs.readFileSync(filePath, "utf-8");
        const { escaped: vEsc, map: vMap } = escapeTemplateVars(content);
        const vParsed = yaml.load(vEsc) as Record<string, unknown>;
        const variantData = stripDraftMeta(
          (vParsed ? unescapeObjectVars(vParsed, vMap) : {}) as Record<string, unknown>,
        );
        this.contentCache.set(cacheKey, variantData);
        return { ok: true, data: variantData };
      }

      const commonPath = path.join(contentDir, "_common.yml");
      let commonData: Record<string, unknown> = {};
      if (fs.existsSync(commonPath)) {
        const commonContent = fs.readFileSync(commonPath, "utf-8");
        const { escaped: cEsc, map: cMap } = escapeTemplateVars(commonContent);
        const cParsed = yaml.load(cEsc) as Record<string, unknown>;
        commonData = (cParsed ? unescapeObjectVars(cParsed, cMap) : {}) as Record<string, unknown>;
      }

      const content = fs.readFileSync(filePath, "utf-8");
      const { escaped: vEsc, map: vMap } = escapeTemplateVars(content);
      const vParsed = yaml.load(vEsc) as Record<string, unknown>;
      const variantData = stripDraftMeta(
        (vParsed ? unescapeObjectVars(vParsed, vMap) : {}) as Record<string, unknown>,
      );

      const merged = deepMerge(commonData, variantData);
      this.contentCache.set(cacheKey, merged);
      return { ok: true, data: merged };
    } catch (error) {
      const message = formatYamlLoadError(error);
      log.error({ err: error }, `[Versioning] Error loading variant content:`);
      return {
        ok: false,
        reason: "parse_error",
        message,
        filePath,
      };
    }
  }

  private recordExposure(
    contentType: string,
    slug: string,
    locale: string,
    run: string | null,
    variantSlug: string,
    userId: string
  ): void {
    const stateKey = exposureStateKey(contentType, slug, locale, run, variantSlug);
    const hashedId = hashUserId(userId);

    if (!this.visitorSets.has(stateKey)) {
      this.visitorSets.set(stateKey, new Set());
    }
    const visitorSet = this.visitorSets.get(stateKey)!;

    if (visitorSet.has(hashedId)) return;

    visitorSet.add(hashedId);

    if (!this.state.counts[stateKey]) {
      this.state.counts[stateKey] = 0;
    }
    if (!this.state.visitors[stateKey]) {
      this.state.visitors[stateKey] = [];
    }

    this.state.visitors[stateKey].push(hashedId);
    this.state.counts[stateKey]++;
    this.scheduleSave();
  }

  /** Current run marker (`started_at`) for a locale, or null for legacy configs. */
  public getRun(contentType: string, slug: string, locale: string): string | null {
    return this.loadVersioningConfig(contentType, slug)?.[locale]?.started_at ?? null;
  }

  /** True when the locale has at least one variant with traffic. */
  public hasActiveTest(contentType: string, slug: string, locale: string): boolean {
    return hasActiveTraffic(this.loadVersioningConfig(contentType, slug)?.[locale]?.variants);
  }

  /** `contentType:slug:locale[@run]` for the locale's current run. */
  public getExperimentId(contentType: string, slug: string, locale: string): string {
    return experimentId(contentType, slug, locale, this.getRun(contentType, slug, locale));
  }

  /**
   * Get the version for a visitor. Returns a variant slug, `"default"` (the visitor
   * is in Default's share of an active test), or null when the locale has no active
   * test. Assignments are sticky per run; `record: false` skips counting (check traffic).
   */
  public getAssignment(
    contentType: string,
    slug: string,
    locale: string,
    sessionId: string,
    existingAssignment?: ExistingAssignment,
    opts: { record?: boolean } = {},
  ): string | null {
    const config = this.loadVersioningConfig(contentType, slug);
    if (!config) return null;

    const localeConfig = config[locale];
    const variants = localeConfig?.variants ?? [];
    if (!hasActiveTraffic(variants)) return null;

    const run = localeConfig.started_at ?? null;
    const record = opts.record !== false;
    const existing =
      typeof existingAssignment === "string"
        ? { variantSlug: existingAssignment, run: null }
        : existingAssignment;

    if (existing && (existing.run ?? null) === run) {
      const stillValid =
        existing.variantSlug === DEFAULT_VARIANT_SLUG
          ? allocatedTotal(variants) < 100
          : variants.some((v) => v.slug === existing.variantSlug && v.allocation > 0);
      if (stillValid) {
        if (record) this.recordExposure(contentType, slug, locale, run, existing.variantSlug, sessionId);
        return existing.variantSlug;
      }
    }

    const selected = pickVariant(sessionId, experimentId(contentType, slug, locale, run), variants);
    if (!selected) return null;

    if (record) this.recordExposure(contentType, slug, locale, run, selected, sessionId);
    return selected;
  }

  /**
   * Load variant content with structured success/failure (missing vs parse error).
   */
  public getVariantContentResult(
    contentType: string,
    slug: string,
    variantSlug: string,
    locale: string
  ): VariantContentResult {
    return this.loadVariantContentResult(contentType, slug, variantSlug, locale);
  }

  /**
   * Load variant content. Used when force_variant is set or after assignment.
   */
  public getVariantContent(
    contentType: string,
    slug: string,
    variantSlug: string,
    locale: string
  ): unknown | null {
    const result = this.loadVariantContentResult(contentType, slug, variantSlug, locale);
    return result.ok ? result.data : null;
  }

  /**
   * Get versioning config for a content type and slug (for debug panel).
   */
  public getVersioningForContent(
    contentType: string,
    slug: string
  ): VersioningFile | null {
    return this.loadVersioningConfig(contentType, slug);
  }

  /**
   * Get variant counts for diagnostics.
   */
  public getStats(): Record<string, number> {
    return { ...this.state.counts };
  }

  /** Unique visitors per version (`default` included) for the locale's current run. */
  public getRunCounts(contentType: string, slug: string, locale: string): Record<string, number> {
    const run = this.getRun(contentType, slug, locale);
    const prefix = exposureStateKey(contentType, slug, locale, run, "");
    const out: Record<string, number> = {};
    for (const [key, n] of Object.entries(this.state.counts)) {
      if (key.startsWith(prefix)) out[key.slice(prefix.length)] = n;
    }
    return out;
  }

  /**
   * Save updated versioning.yml for a content type and slug.
   * Pass the person who made the change so versioning.yml commits with their variant file;
   * the default service author is for background jobs only.
   */
  public updateVersioning(
    contentType: string,
    slug: string,
    data: VersioningFile,
    opts?: { author?: string | null; contentRoot?: string },
  ): void {
    const configPath = this.getVersioningFilePath(contentType, slug);
    const yamlContent = yaml.dump(data, {
      indent: 2,
      lineWidth: 120,
      quotingType: '"',
      forceQuotes: false,
    });
    fs.writeFileSync(configPath, yamlContent, "utf-8");
    const cacheKey = `${contentType}:${slug}`;
    this.configCache.delete(cacheKey);
    this.contentCache.clear();
    markFileAsModified(configPath, opts?.author || "System", undefined, opts?.contentRoot ?? this.contentRoot);
    log.info(`[Versioning] Updated versioning.yml for ${contentType}/${slug} — queued for auto-commit (${configPath})`);
  }

  /** Remove versioning.yml when no variants remain. */
  public deleteVersioningConfig(
    contentType: string,
    slug: string,
    author = "system",
    contentRoot?: string,
  ): boolean {
    const configPath = this.getVersioningFilePath(contentType, slug);
    if (!fs.existsSync(configPath)) return false;
    fs.unlinkSync(configPath);
    const cacheKey = `${contentType}:${slug}`;
    this.configCache.delete(cacheKey);
    this.contentCache.clear();
    markFileAsModified(configPath, author, undefined, contentRoot);
    log.info(`[Versioning] Deleted versioning.yml for ${contentType}/${slug} (${configPath})`);
    return true;
  }

  /**
   * Invalidate the content cache for a specific variant after an external write.
   * Call this whenever a variant file is saved to disk outside VersioningManager.
   */
  public invalidateVariantCache(contentType: string, slug: string, variantSlug: string, locale: string): void {
    const cacheKey = `${contentType}:${slug}:${variantSlug}.${locale}`;
    this.contentCache.delete(cacheKey);
    log.info(`[Versioning] Cache invalidated for ${cacheKey}`);
  }

  /**
   * Clear caches (for hot reload in dev).
   */
  public clearCache(): void {
    this.configCache.clear();
    this.contentCache.clear();
    log.info("[Versioning] Cache cleared");
  }

  /**
   * Get available variants for a content type and slug.
   * Parses YAML files following naming conventions.
   */
  public getAvailableVariants(
    contentType: string,
    slug: string
  ): {
    variants: Array<{
      filename: string;
      name: string;
      variantSlug: string;
      version: number | null;
      locale: string;
      displayName: string;
      isPromoted: boolean;
    }>;
    contentType: string;
    slug: string;
    folderPath: string;
  } | null {
    const templateMode = isTemplateVersioningSlug(slug);
    const contentDir = this.getVersioningContentDir(contentType, slug);
    const folderPath = templateMode
      ? `${this.contentFolderName()}/${getFolder(contentType)}`
      : `${this.contentFolderName()}/${getFolder(contentType)}/${slug}`;

    if (!fs.existsSync(contentDir)) {
      return null;
    }

    try {
      const files = fs.readdirSync(contentDir);

      const variants = files
        .filter((file) => {
          if (!file.endsWith(".yml") || file === "versioning.yml" || file.startsWith("_")) {
            return false;
          }
          if (templateMode) {
            return isSharedTemplateBasename(file) && !file.startsWith("_");
          }
          return !isSharedTemplateBasename(file);
        })
        .map((file) => {
          const name = file.replace(".yml", "");
          const parts = name.split(".");

          if (templateMode) {
            // template|single.{locale}.yml (promoted) or template|single.{variant}.{locale}.yml
            const liveM = LIVE_SHELL_BASENAME_RE.exec(file);
            if (liveM) {
              return {
                filename: file,
                name,
                variantSlug: "promoted",
                version: null,
                locale: liveM[1],
                displayName: `Promoted (${liveM[1].toUpperCase()})`,
                isPromoted: true,
              };
            }
            const varM = VARIANT_SHELL_BASENAME_RE.exec(file);
            if (!varM) return null;
            const variantSlug = varM[1];
            const locale = varM[2];
            if (isReservedTemplateVariantSlug(variantSlug)) return null;
            return {
              filename: file,
              name,
              variantSlug,
              version: null,
              locale,
              displayName: `${variantSlug} (${locale.toUpperCase()})`,
              isPromoted: false,
            };
          }

          if (parts.length === 1) {
            return {
              filename: file,
              name,
              variantSlug: "promoted",
              version: null,
              locale: parts[0],
              displayName: `Promoted (${parts[0].toUpperCase()})`,
              isPromoted: true,
            };
          }

          const locale = parts[parts.length - 1];
          const versionMatch = parts[parts.length - 2]?.match(/^v(\d+)$/);

          if (versionMatch) {
            const version = parseInt(versionMatch[1], 10);
            const variantSlug = parts.slice(0, -2).join(".");
            return {
              filename: file,
              name,
              variantSlug,
              version,
              locale,
              displayName: `${variantSlug} (${locale.toUpperCase()})`,
              isPromoted: false,
            };
          }

          const variantSlug = parts.slice(0, -1).join(".");
          return {
            filename: file,
            name,
            variantSlug,
            version: null,
            locale,
            displayName: `${variantSlug} (${locale.toUpperCase()})`,
            isPromoted: false,
          };
        })
        .filter((v): v is NonNullable<typeof v> => v != null)
        .sort((a, b) => {
          if (a.isPromoted !== b.isPromoted) return a.isPromoted ? -1 : 1;
          if (a.variantSlug !== b.variantSlug) return a.variantSlug.localeCompare(b.variantSlug);
          if (a.version !== b.version) return (a.version || 0) - (b.version || 0);
          return a.locale.localeCompare(b.locale);
        });

      return {
        variants,
        contentType,
        slug,
        folderPath,
      };
    } catch (error) {
      log.error({ err: error }, `[Versioning] Error getting variants for ${contentType}/${slug}:`);
      return null;
    }
  }

  /**
   * Get version counts per locale for a content entry.
   * Used by ContentTypeManagePage to show "EN · 3" badges.
   */
  public getVersionCounts(contentType: string, slug: string): Record<string, number> {
    const config = this.getVersioningForContent(contentType, slug);
    if (!config) return {};

    const result: Record<string, number> = {};
    for (const [locale, localeData] of Object.entries(config)) {
      if (localeData?.variants?.length > 1) {
        result[locale] = localeData.variants.length;
      }
    }
    return result;
  }
}

let instance: VersioningManager | null = null;

export function getVersioningManager(): VersioningManager {
  if (!instance) {
    instance = new VersioningManager();
  }
  return instance;
}
