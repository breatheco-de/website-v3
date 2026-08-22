
import fs from "fs";
import { getDefaultContentRoot, getDefaultContentFolder } from "./site-config";
import path from "path";
import yaml from "js-yaml";
import type { ZodSchema } from "zod";
import { escapeTemplateVars, unescapeObjectVars, escapeObjectVars, unescapeYamlDump } from "../shared/templateVars";
import { deepMerge } from "./utils/deepMerge";
import { regenerateSectionIds } from "./utils/regenerateSectionIds";
import { normalizeUrlPattern, getAllConfigs, getFieldMapping, resolveUrlPatternWithMapping, getFullFieldMapping, getFieldMappingDefaults, extractUrlPatternParams, getContentTypeConfig, getHreflangsSource, resolveHreflangsFromRecord } from "./content-types";
import { databaseManager, type DatabaseManager } from "./database";
import { applyPerEntryLayer } from "./section-merge";
import { applySectionLayoutDefaults } from "./section-layout-defaults";
import { invalidateStaticListingCache } from "./static-listing-cache";
import { isEntryDetached } from "./shared-layout-entry";
import { isEmptyDetachedLocaleEntry } from "./empty-locale";
import {
  findBestSingleMirrorSource,
  buildMirroredLocaleSingle,
  listAllSinglePaths,
} from "./shared-layout-sync";
import { child } from "./logger";
import {
  wipeDocumentSectionsOnDuplicate,
  type ClearedField,
} from "../shared/wipeOnDuplicate";
import { loadAllFieldEditors } from "./component-registry";
const log = child({ module: "content-index" });



/** Backward-compat: resolves from CONTENT_FOLDER env var or falls back to the canonical content folder name. */
export const MARKETING_CONTENT_PATH = getDefaultContentRoot();

function stripNullValues<T>(obj: T): T {
  if (obj === null) {
    return undefined as unknown as T;
  }
  if (Array.isArray(obj)) {
    return obj
      .map(item => stripNullValues(item))
      .filter(item => item !== undefined) as unknown as T;
  }
  if (typeof obj === "object" && obj !== null) {
    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(obj)) {
      if (value !== null) {
        result[key] = stripNullValues(value);
      }
    }
    return result as T;
  }
  return obj;
}

export type ContentType = string;

export interface LoadContentOptions<T> {
  contentType: ContentType;
  slug: string;
  schema?: ZodSchema<T>;
  localeOrVariant: string;
  requireCommon?: boolean;
}

export type LoadContentResult<T> =
  | { success: true; data: T }
  | { success: false; error: string };

export interface ContentTypeConfig {
  directory: string;
  url_pattern: Record<string, string>;
  database?: {
    slug: string;
    field_mapping?: Record<string, string | { source: string; default: string }>;
    indexes?: string[];
  };
}

export interface ContentEntry {
  slug: string;
  contentType: string;
  directory: string;
  files: string[];
  locales: string[];
  title?: string;
}

export interface FindOptions {
  contentType?: string;
}

export interface RedirectEntry {
  from: string;
  to: string | Record<string, string>;
  type: string;
  source: string;
  status: number;
  priority?: "before" | "fallback";
}

function redirectEntrySignature(entry: RedirectEntry): string {
  const to = typeof entry.to === "string" ? entry.to : JSON.stringify(entry.to);
  return `${entry.from}\0${to}\0${entry.type}\0${entry.status}\0${entry.priority ?? "before"}\0${entry.source}`;
}

function redirectEntriesEqual(a: RedirectEntry[], b: RedirectEntry[]): boolean {
  if (a.length !== b.length) return false;
  const sa = a.map(redirectEntrySignature).sort();
  const sb = b.map(redirectEntrySignature).sort();
  return sa.every((v, i) => v === sb[i]);
}

export interface SeoEntry {
  slug: string;
  contentType: string;
  intent?: string;
  pillar?: string;
  focusFeatures?: string[];
  file: string;
}

export interface CommonFieldInfo {
  common: string[];
  partial: { key: string; count: number; total: number }[];
}

export class ContentIndex {
  private entries: ContentEntry[] = [];
  private bySlug: Map<string, ContentEntry[]> = new Map();
  private byPath: Map<string, ContentEntry> = new Map();
  private imageUsage: Map<string, Set<string>> = new Map();
  private variableUsage: Map<string, Set<string>> = new Map();
  private redirectEntries: RedirectEntry[] = [];
  private localeSlugMap: Map<string, string> = new Map();
  private contentTypeConfigs: Record<string, ContentTypeConfig> = {};
  private commonFieldsCache: Map<string, CommonFieldInfo> = new Map();
  private menuUsage: Map<string, { contentType: string; slug: string; source: string; position: "top" | "bottom" }[]> = new Map();
  private seoIndex: Map<string, SeoEntry> = new Map();
  private clusterIndex: Map<string, string[]> = new Map();
  private byUrl: Map<string, { contentType: string; slug: string; entry: ContentEntry; params: Record<string, string>; patternLocale: string }> = new Map();
  private dbIndexedTypes: Set<string> = new Set();
  private initialized = false;
  private slowPhaseReady = false;
  /** Debounce timer for coalescing background slow scans. */
  private slowScanTimer: ReturnType<typeof setTimeout> | null = null;
  private slowScanRunning = false;
  private slowScanQueued = false;
  private refreshRunning = false;
  private refreshQueued = false;
  /**
   * When set, image/variable/menu/SEO extractors write into these maps instead of
   * the live ones so scanSlow can swap atomically (same idea as redirectEntries).
   */
  private slowScratch: {
    imageUsage: Map<string, Set<string>>;
    variableUsage: Map<string, Set<string>>;
    menuUsage: Map<string, { contentType: string; slug: string; source: string; position: "top" | "bottom" }[]>;
    seoIndex: Map<string, SeoEntry>;
  } | null = null;
  private static readonly SLOW_SCAN_DEBOUNCE_MS = 250;

  /** Absolute path to the content root folder (e.g. /home/user/project/content). */
  readonly contentRoot: string;
  /** Relative path from process.cwd() (e.g. "content" or "4geeks-com"). */
  readonly contentRootName: string;
  private readonly database: DatabaseManager;

  constructor(contentFolder?: string, database?: DatabaseManager) {
    const folder = contentFolder || getDefaultContentFolder();
    this.contentRoot = path.isAbsolute(folder) ? folder : path.join(process.cwd(), folder);
    this.contentRootName = path.relative(process.cwd(), this.contentRoot);
    this.database = database ?? databaseManager;
  }

  /** Site DatabaseManager bound to this index (for ActiveSiteCtx / diagnostics worker). */
  getDatabase(): DatabaseManager {
    return this.database;
  }

  /** @deprecated Use `new ContentIndex(contentFolder?)` directly. */
  static getInstance(): ContentIndex {
    return new ContentIndex();
  }

  private loadContentTypes(): Record<string, ContentTypeConfig> {
    const configPath = path.join(this.contentRoot, "content-types.yml");
    if (!fs.existsSync(configPath)) {
      log.warn("[ContentIndex] content-types.yml not found, using empty config");
      return {};
    }
    try {
      const raw = fs.readFileSync(configPath, "utf-8");
      const parsed = this.safeYamlLoad(raw) as Record<string, any> | null;
      if (!parsed) return {};
      for (const config of Object.values(parsed)) {
        if (config?.url_pattern) {
          config.url_pattern = normalizeUrlPattern(config.url_pattern);
        }
      }
      return parsed as Record<string, ContentTypeConfig>;
    } catch (err) {
      log.error({ err: err }, "[ContentIndex] Failed to read content-types.yml:");
      return {};
    }
  }

  buildUrl(contentType: string, locale: string, slug: string, params?: Record<string, string>): string {
    const normalized = this.normalizeType(contentType);
    const config = this.contentTypeConfigs[normalized];
    if (!config?.url_pattern) {
      return `/${locale}/${slug}`;
    }

    let url = config.url_pattern[locale] || config.url_pattern["default"] || `/${locale}/${slug}`;
    if (params) {
      for (const [key, value] of Object.entries(params)) {
        url = url.replace(`:${key}`, value);
      }
    }
    const unresolved: string[] = [];
    url = url.replace(/:([a-zA-Z_]+)/g, (_m, paramName) => {
      if (paramName === "slug") return slug;
      unresolved.push(paramName);
      return "";
    });
    if (unresolved.length > 0) {
      log.warn(
        `[ContentIndex] buildUrl(${normalized}, ${locale}, ${slug}): unresolved URL pattern variable(s) ${unresolved.map((p) => `:${p}`).join(", ")} — pass them via params`,
      );
      url = url.replace(/\/\/+/g, "/");
    }
    return url;
  }

  getContentTypes(): string[] {
    this.ensureInitialized();
    return Object.keys(this.contentTypeConfigs);
  }

  getContentTypeConfig(contentType: string): ContentTypeConfig | undefined {
    this.ensureInitialized();
    const normalized = this.normalizeType(contentType);
    return this.contentTypeConfigs[normalized];
  }

  normalizeType(typeOrFolder: string): string {
    const config = this.contentTypeConfigs[typeOrFolder];
    if (config) return typeOrFolder;
    for (const [type, cfg] of Object.entries(this.contentTypeConfigs)) {
      if (cfg.directory === typeOrFolder) return type;
    }
    return typeOrFolder;
  }

  getFolderName(type: string): string {
    const config = this.contentTypeConfigs[type];
    if (config?.directory) return config.directory;
    for (const [, cfg] of Object.entries(this.contentTypeConfigs)) {
      if (cfg.directory === type) return type;
    }
    return type;
  }

  /**
   * Phase 1 — fast scan: builds the URL/slug index needed to serve page requests.
   * Avoids full YAML parsing; uses lightweight regex for slug/title extraction.
   * Completes before the server begins listening so the first request is never delayed.
   */
  scanFast(): void {
    const baseDir = this.contentRoot;
    this.contentTypeConfigs = this.loadContentTypes();
    const contentTypes = Object.keys(this.contentTypeConfigs);

    this.entries = [];
    this.bySlug = new Map();
    this.byPath = new Map();
    // Keep previous slow-phase maps (image/variable/menu/SEO/redirects) +
    // slowPhaseReady until scanSlow swaps in a fresh set — avoids empty
    // admin/API windows during async reindexing after content edits.
    this.localeSlugMap = new Map();
    this.commonFieldsCache = new Map();
    this.byUrl = new Map();
    this.dbIndexedTypes = new Set();

    for (const contentType of contentTypes) {
      const diskFolder = this.contentTypeConfigs[contentType]?.directory || contentType;
      const typeDir = path.join(baseDir, diskFolder);
      if (!fs.existsSync(typeDir)) continue;

      const folders = fs.readdirSync(typeDir, { withFileTypes: true })
        .filter(d => d.isDirectory())
        .map(d => d.name);

      for (const folderName of folders) {
        const folderPath = path.join(typeDir, folderName);
        const relFolder = `${this.contentRootName}/${diskFolder}/${folderName}`;
        const files = fs.readdirSync(folderPath)
          .filter(f => f.endsWith(".yml") || f.endsWith(".yaml"));

        if (files.length === 0) continue;

        const slug = this.extractSlug(folderPath, folderName, files);
        const locales = this.extractLocales(files, contentType);

        // Skip directories that have no locale files — they cannot be rendered as pages.
        // e.g. a folder that only has _ecommerce.yml is not a valid content entry.
        // The ecommerce scanner reads files directly from disk so it is unaffected.
        if (locales.length === 0) continue;

        // Lightweight title extraction via regex — avoids full YAML parse at startup
        let title: string | undefined;
        for (const candidate of ["_common.yml", "_common.yaml", "en.yml", "en.yaml"]) {
          if (files.includes(candidate)) {
            try {
              const raw = fs.readFileSync(path.join(folderPath, candidate), "utf-8");
              const m = raw.match(/^(?:title|name):\s+["']?([^"'\n#]+)["']?/m);
              if (m) title = m[1].trim();
            } catch {}
            break;
          }
        }

        // Lightweight localeSlugMap update via regex — avoids full YAML parse per locale file
        for (const file of files) {
          const locale = file.replace(/\.(yml|yaml)$/, "");
          if (locale.startsWith("_") || !/^[a-z]{2}(-[a-z]{2})?$/.test(locale)) continue;
          try {
            const raw = fs.readFileSync(path.join(folderPath, file), "utf-8");
            const m = raw.match(/^slug:\s+["']?([^\s"'\n#]+)["']?/m);
            if (m) {
              const localeSlug = m[1].trim();
              if (localeSlug !== slug) {
                this.localeSlugMap.set(`${localeSlug}:${contentType}`, slug);
              }
            }
          } catch {}
        }

        const entry: ContentEntry = {
          slug,
          contentType,
          directory: relFolder,
          files,
          locales,
          title,
        };

        this.entries.push(entry);
        const existing = this.bySlug.get(slug) || [];
        existing.push(entry);
        this.bySlug.set(slug, existing);
        this.byPath.set(relFolder, entry);
      }
    }

    this.autoCreateSingleTemplates(baseDir);

    // Build URL index for DB-backed content types from SQLite cache
    for (const [contentType, config] of Object.entries(this.contentTypeConfigs)) {
      if (!config?.database?.slug || !config?.url_pattern) continue;
      const dbName = config.database.slug;
      const items = this.database.getMappedItems(dbName);
      if (!items || items.length === 0) continue;
      try {
        const fieldMapping = getFullFieldMapping(contentType, this.contentRoot);
        const defaults = getFieldMappingDefaults(contentType, this.contentRoot);
        const templateEntry: ContentEntry = {
          slug: contentType,
          contentType,
          directory: `${this.contentRootName}/${config.directory || contentType}`,
          files: [],
          locales: [],
        };
        for (const item of items) {
          const itemSlug = String(item.slug || "");
          if (!itemSlug) continue;
          // Detect the item's own locale so we don't register it under every language's URL pattern.
          // If no locale field is found, fall back to registering under all patterns (backward compat).
          const itemLocale = String(item["language"] || item["lang"] || item["locale"] || "");
          for (const [localeKey, pattern] of Object.entries(config.url_pattern)) {
            const locale = localeKey === "default" ? "en" : localeKey;
            if (itemLocale && itemLocale !== locale) continue;
            const url = resolveUrlPatternWithMapping(pattern, item, locale, fieldMapping, defaults);
            if (!url) continue;
            const params = this.extractUrlParams(pattern, url) || {};
            this.byUrl.set(url, { contentType, slug: itemSlug, entry: templateEntry, params, patternLocale: localeKey });
          }
        }
        this.dbIndexedTypes.add(contentType);
      } catch {}
    }

    this.initialized = true;
    log.info(`[ContentIndex] Fast scan: ${this.entries.length} YAML entries, ${this.byUrl.size} DB-backed URLs in lookup (image/variable/redirect/SEO deferred to background)`);
  }

  /**
   * Phase 2 — slow scan: indexes image refs, variable refs, redirects, SEO, and menus.
   * Builds into temporary structures and atomically swaps when complete so
   * live traffic keeps the previous snapshot until the new one is ready.
   */
  scanSlow(): void {
    const baseDir = this.contentRoot;
    const nextRedirects: RedirectEntry[] = [];
    this.slowScratch = {
      imageUsage: new Map(),
      variableUsage: new Map(),
      menuUsage: new Map(),
      seoIndex: new Map(),
    };

    try {
    for (const entry of this.entries) {
      const folderPath = path.join(process.cwd(), entry.directory);
      const folderName = path.basename(entry.directory);
      for (const file of entry.files) {
        const filePath = path.join(folderPath, file);
        const relFilePath = `${entry.directory}/${file}`;
        try {
          const raw = fs.readFileSync(filePath, "utf-8");
          this.extractVariableReferences(raw, relFilePath);
          const parsed = this.safeYamlLoad(raw);
          this.extractImageReferences(parsed, relFilePath);
          this.extractMenuReferences(parsed, entry.contentType, folderName, file);
          const locale = file.replace(/\.(yml|yaml)$/, "");
          if (locale !== "_common" && !locale.startsWith("_")) {
            this.extractSeoData(parsed, entry.slug, entry.contentType, relFilePath);
          }
          if (parsed && this.contentTypeHasRedirects(entry.contentType)) {
            const baseName = file.replace(/\.(yml|yaml)$/i, "");
            const isLiveLocale = /^[a-z]{2}(-[a-z]{2})?$/i.test(baseName);
            const variantLocaleMatch = !isLiveLocale
              ? baseName.match(/(?:^|\.)([a-z]{2}(?:-[a-z]{2})?)$/i)
              : null;
            const isVariantLayer =
              !isLiveLocale &&
              (Boolean(variantLocaleMatch) ||
                /^single\.[a-z0-9-]+\./i.test(baseName) ||
                /^[a-z0-9-]+\.[a-z]{2}/i.test(baseName));
            if (isVariantLayer && variantLocaleMatch) {
              const liveLocale = variantLocaleMatch[1]!;
              const hasLive =
                entry.files.some(
                  (f) =>
                    f === `${liveLocale}.yml` ||
                    f === `${liveLocale}.yaml` ||
                    f === `single.${liveLocale}.yml` ||
                    f === `single.${liveLocale}.yaml`,
                ) || entry.locales.includes(liveLocale);
              if (hasLive) {
                // Redirects on variant overlays are ignored when a live locale exists.
              } else {
                const localeSlugForRedirect =
                  parsed.slug && typeof parsed.slug === "string" ? parsed.slug : entry.slug;
                this.extractRedirects(
                  parsed,
                  entry.slug,
                  liveLocale,
                  entry.contentType,
                  relFilePath,
                  localeSlugForRedirect,
                  nextRedirects,
                );
              }
            } else if (isLiveLocale || baseName === "_common") {
              const localeSlugForRedirect =
                parsed.slug && typeof parsed.slug === "string" ? parsed.slug : entry.slug;
              this.extractRedirects(
                parsed,
                entry.slug,
                baseName,
                entry.contentType,
                relFilePath,
                localeSlugForRedirect,
                nextRedirects,
              );
            }
          }
          // Refine localeSlugMap with accurate YAML-parsed values
          if (parsed?.slug && typeof parsed.slug === "string") {
            const localeSlug = parsed.slug;
            if (localeSlug !== entry.slug) {
              this.localeSlugMap.set(`${localeSlug}:${entry.contentType}`, entry.slug);
            }
          }
        } catch {}
      }
    }

    this.scanCustomRedirects(baseDir, nextRedirects);
    this.warnMissingSlugMappings();

    const changed = !redirectEntriesEqual(this.redirectEntries, nextRedirects);
    this.redirectEntries = nextRedirects;
    if (this.slowScratch) {
      this.imageUsage = this.slowScratch.imageUsage;
      this.variableUsage = this.slowScratch.variableUsage;
      this.menuUsage = this.slowScratch.menuUsage;
      this.seoIndex = this.slowScratch.seoIndex;
      this.slowScratch = null;
    }
    this.slowPhaseReady = true;

    if (changed) {
      this.clearLiveRedirectCache();
    }

    log.info(`[ContentIndex] Slow scan complete: ${this.imageUsage.size} image refs, ${this.variableUsage.size} variable refs, ${this.menuUsage.size} menu refs, ${this.redirectEntries.length} redirects, ${this.seoIndex.size} SEO entries${changed ? " (redirect cache cleared)" : " (redirects unchanged)"}`);
    } catch (err) {
      this.slowScratch = null;
      throw err;
    }
  }

  /**
   * Schedule a debounced background slow scan. Repeated calls coalesce into one
   * run; if another request arrives while a scan is running, one follow-up runs.
   */
  startSlowScanAsync(debounceMs: number = ContentIndex.SLOW_SCAN_DEBOUNCE_MS): void {
    this.slowScanQueued = true;
    if (this.slowScanTimer) clearTimeout(this.slowScanTimer);
    this.slowScanTimer = setTimeout(() => {
      this.slowScanTimer = null;
      this.runSlowScanSerialized();
    }, debounceMs);
  }

  private cancelPendingSlowScan(): void {
    if (this.slowScanTimer) {
      clearTimeout(this.slowScanTimer);
      this.slowScanTimer = null;
    }
    this.slowScanQueued = false;
  }

  private runSlowScanSerialized(): void {
    if (this.slowScanRunning) {
      this.slowScanQueued = true;
      return;
    }
    this.slowScanQueued = false;
    this.slowScanRunning = true;
    setImmediate(() => {
      try {
        this.scanSlow();
      } catch (err) {
        log.error({ err: err }, "[ContentIndex] Error during background slow scan:");
      } finally {
        this.slowScanRunning = false;
        if (this.slowScanQueued) {
          this.runSlowScanSerialized();
        }
      }
    });
  }

  /** Invalidate middleware redirect maps after a successful redirect-set swap. */
  private clearLiveRedirectCache(): void {
    // Dynamic import avoids a circular dependency with redirects.ts (ESM; no require).
    void import("./redirects")
      .then(({ clearRedirectCache }) => {
        clearRedirectCache();
      })
      .catch((err) => {
        log.warn({ err }, "[ContentIndex] Failed to clear live redirect cache:");
      });
  }

  /** Returns true once the slow phase (image/variable/redirect/SEO indexing) has completed. */
  isSlowPhaseReady(): boolean {
    return this.slowPhaseReady;
  }

  /**
   * Full synchronous scan (fast + slow phases in sequence).
   * Used for explicit re-scans triggered by content edits.
   */
  scan(): void {
    this.cancelPendingSlowScan();
    this.scanFast();
    this.slowScanRunning = true;
    try {
      this.scanSlow();
    } finally {
      this.slowScanRunning = false;
      if (this.slowScanQueued) {
        this.startSlowScanAsync(0);
      }
    }
    // Re-emit a unified log for callers that expect the original combined message
    log.info(`[ContentIndex] Scanned ${this.entries.length} content entries, ${this.imageUsage.size} image references tracked, ${this.variableUsage.size} variable references tracked, ${this.menuUsage.size} menu references tracked, ${this.redirectEntries.length} redirects, ${this.seoIndex.size} seo entries tracked`);
  }

  safeYamlLoad(raw: string): Record<string, unknown> | null {
    const { escaped, map } = escapeTemplateVars(raw);
    const parsed = yaml.load(escaped) as Record<string, unknown> | null;
    if (!parsed) return null;
    return unescapeObjectVars(parsed, map) as Record<string, unknown>;
  }

  private contentTypeHasRedirects(contentType: string): boolean {
    return (
      contentType === "program" ||
      contentType === "landing" ||
      contentType === "page" ||
      contentType === "location" ||
      contentType === "blog"
    );
  }

  private addImageRef(ref: string, filePath: string): void {
    if (!ref || typeof ref !== "string") return;
    const map = this.slowScratch?.imageUsage ?? this.imageUsage;
    const existing = map.get(ref);
    if (existing) {
      existing.add(filePath);
    } else {
      map.set(ref, new Set([filePath]));
    }
  }

  private addVariableRef(varName: string, filePath: string): void {
    if (!varName || typeof varName !== "string") return;
    const map = this.slowScratch?.variableUsage ?? this.variableUsage;
    const existing = map.get(varName);
    if (existing) {
      existing.add(filePath);
    } else {
      map.set(varName, new Set([filePath]));
    }
  }

  private extractVariableReferences(rawContent: string, filePath: string): void {
    const regex = /\{\{\s*([a-zA-Z_][a-zA-Z0-9_]*)\s*(?:\|[^}]*)?\}\}/g;
    let match: RegExpExecArray | null;
    while ((match = regex.exec(rawContent)) !== null) {
      this.addVariableRef(match[1], filePath);
    }
  }

  private addMenuRef(menuId: string, contentType: string, slug: string, source: string, position: "top" | "bottom"): void {
    if (!menuId || typeof menuId !== "string") return;
    const map = this.slowScratch?.menuUsage ?? this.menuUsage;
    const existing = map.get(menuId) || [];
    existing.push({ contentType, slug, source, position });
    map.set(menuId, existing);
  }

  private extractMenuReferences(parsed: Record<string, unknown> | null, contentType: string, slug: string, fileName: string): void {
    if (!parsed) return;
    const layout = parsed.layout as { menu?: { top?: string | null; bottom?: string | null } } | undefined;
    if (!layout?.menu) return;
    if (layout.menu.top && typeof layout.menu.top === "string") {
      this.addMenuRef(layout.menu.top, contentType, slug, fileName, "top");
    }
    if (layout.menu.bottom && typeof layout.menu.bottom === "string") {
      this.addMenuRef(layout.menu.bottom, contentType, slug, fileName, "bottom");
    }
  }

  getMenuUsageByMenuId(menuId: string): { contentType: string; slug: string; source: string; position: "top" | "bottom" }[] {
    this.ensureInitialized();
    return this.menuUsage.get(menuId) || [];
  }

  getAllMenuUsage(): Map<string, { contentType: string; slug: string; source: string; position: "top" | "bottom" }[]> {
    this.ensureInitialized();
    return this.menuUsage;
  }

  private extractSeoData(parsed: Record<string, unknown> | null, slug: string, contentType: string, filePath: string): void {
    if (!parsed) return;
    const seo = parsed.seo as Record<string, unknown> | undefined;
    if (!seo || typeof seo !== "object") return;

    const intent = typeof seo.intent === "string" ? seo.intent : undefined;
    const pillarPath =
      (typeof seo.pillar_path === "string" && seo.pillar_path) ||
      (typeof seo.pillar === "string" && seo.pillar) ||
      undefined;
    const focusFeatures = Array.isArray(seo.focus_features)
      ? (seo.focus_features as unknown[]).filter((f): f is string => typeof f === "string")
      : undefined;

    const key = `${slug}:${contentType}`;
    const seoMap = this.slowScratch?.seoIndex ?? this.seoIndex;
    const existing = seoMap.get(key);
    const entry: SeoEntry = {
      slug,
      contentType,
      intent: intent ?? existing?.intent,
      pillar: pillarPath ?? existing?.pillar,
      focusFeatures: focusFeatures ?? existing?.focusFeatures,
      file: filePath,
    };
    seoMap.set(key, entry);
  }

  getSeoEntry(slug: string, contentType: string): SeoEntry | undefined {
    this.ensureInitialized();
    return this.seoIndex.get(`${slug}:${contentType}`);
  }

  getCluster(pillarUrl: string): string[] {
    try {
      const { getClusterFromIndex } = require("./seo-index") as typeof import("./seo-index");
      const cluster = getClusterFromIndex(pillarUrl);
      if (cluster) return cluster.members;
    } catch {
      /* YAML clusterIndex is not the live API */
    }
    this.ensureInitialized();
    return this.clusterIndex.get(pillarUrl) || [];
  }

  getAllSeoEntries(): SeoEntry[] {
    this.ensureInitialized();
    return Array.from(this.seoIndex.values());
  }

  private extractImageReferences(obj: unknown, filePath: string): void {
    if (!obj || typeof obj !== "object") return;

    if (Array.isArray(obj)) {
      for (const item of obj) {
        this.extractImageReferences(item, filePath);
      }
      return;
    }

    const record = obj as Record<string, unknown>;
    for (const [key, value] of Object.entries(record)) {
      if (typeof value === "string" && value.trim()) {
        if (key === "image_id") {
          this.addImageRef(value, filePath);
        } else if (
          (key === "image" || key === "src" || key === "background_image" || key === "logo" || key === "icon_image") &&
          (value.startsWith("/attached_assets/") || (() => { try { const { getSiteConfigs } = require('./site-config') as typeof import('./site-config'); return getSiteConfigs().some((s: import('./site-config').SiteConfig) => value.startsWith(`/${s.contentFolder}/images/`)); } catch { return value.startsWith(`/${this.contentRootName}/images/`); } })() || value.startsWith("http://") || value.startsWith("https://"))
        ) {
          this.addImageRef(value, filePath);
        }
      } else if (typeof value === "object" && value !== null) {
        this.extractImageReferences(value, filePath);
      }
    }
  }

  /**
   * Resolves extra url_pattern variables (e.g. :category) from the merged
   * entry data so URLs match what the sitemap/router emit.
   */
  private resolveUrlPatternParamsForEntry(
    contentType: string,
    slug: string,
    locale: string,
  ): Record<string, string> | undefined {
    const config = this.contentTypeConfigs[this.normalizeType(contentType)];
    const pattern = config?.url_pattern?.[locale] || config?.url_pattern?.["default"];
    if (!pattern || !/:(?!slug\b|locale\b)[a-zA-Z_]+/.test(pattern)) return undefined;
    const fieldMapping = getFullFieldMapping(contentType, this.contentRoot);
    const defaults = getFieldMappingDefaults(contentType, this.contentRoot);
    try {
      const { data } = this.loadMergedContent(contentType, slug, locale);
      if (data) {
        const extracted = extractUrlPatternParams(pattern, data, fieldMapping, defaults);
        if (extracted.missing.length === 0) return extracted.params;
        // Locale YAML may fail or omit URL params that live on _common.yml
        // (e.g. blog category). Fill gaps from common without dropping known params.
        const fromCommon = this.readUrlPatternParamsFromCommon(
          contentType,
          slug,
          pattern,
          fieldMapping,
          defaults,
        );
        if (fromCommon) {
          return { ...fromCommon, ...extracted.params };
        }
        if (Object.keys(extracted.params).length > 0) return extracted.params;
      } else {
        // Merged load failed (often unparseable locale YAML) — still try _common.yml.
        return this.readUrlPatternParamsFromCommon(
          contentType,
          slug,
          pattern,
          fieldMapping,
          defaults,
        );
      }
    } catch {}
    return undefined;
  }

  /** URL-pattern extras (e.g. category) often live only on entry `_common.yml`. */
  private readUrlPatternParamsFromCommon(
    contentType: string,
    slug: string,
    pattern: string,
    fieldMapping: ReturnType<typeof getFullFieldMapping>,
    defaults: ReturnType<typeof getFieldMappingDefaults>,
  ): Record<string, string> | undefined {
    try {
      const contentFolder = this.getContentFolderPath(contentType, slug);
      const commonPath = path.join(contentFolder, "_common.yml");
      if (!fs.existsSync(commonPath)) return undefined;
      const commonData = this.safeYamlLoad(fs.readFileSync(commonPath, "utf-8"));
      if (!commonData) return undefined;
      const extracted = extractUrlPatternParams(pattern, commonData, fieldMapping, defaults);
      return Object.keys(extracted.params).length > 0 ? extracted.params : undefined;
    } catch {
      return undefined;
    }
  }

  private buildLocaleUrlsInternal(slug: string, contentType: string): Record<string, string> {
    return this.getAlternateUrls(slug, contentType);
  }

  private getCanonicalUrl(contentType: string, slug: string, locale: string): string {
    return this.buildUrl(
      contentType,
      locale,
      slug,
      this.resolveUrlPatternParamsForEntry(contentType, slug, locale),
    );
  }

  /**
   * Locale → URL path for a content entry (YAML folder or DB `_hreflangs` cluster).
   * Alias kept for callers; prefer getAlternateUrls for new code.
   */
  getLocaleUrls(
    slug: string,
    contentType: string,
    options?: { includeEmptyLocales?: boolean },
  ): Record<string, string> {
    return this.getAlternateUrls(slug, contentType, options);
  }

  /**
   * Unified alternate URL resolver.
   * - YAML: folder locales + optional per-file slug override
   * - DB: `_hreflangs` locale→slug map on the mapped item (lookup by current URL slug)
   * By default skips empty detached locales (public). Pass includeEmptyLocales for admin.
   */
  getAlternateUrls(
    slug: string,
    contentType: string,
    options?: { includeEmptyLocales?: boolean },
  ): Record<string, string> {
    this.ensureInitialized();
    const normalized = this.normalizeType(contentType);
    const config = this.contentTypeConfigs[normalized];
    const includeEmpty = options?.includeEmptyLocales === true;

    if (config?.database?.slug && getHreflangsSource(normalized, this.contentRoot)) {
      const dbUrls = this.getAlternateUrlsFromDatabase(slug, normalized);
      if (dbUrls !== null) {
        return includeEmpty
          ? dbUrls
          : this.filterEmptyDetachedAlternateUrls(slug, normalized, dbUrls);
      }
    }

    // YAML: map per-locale URL slug → folder slug when needed
    const baseSlug = this.resolveBaseSlug(slug, normalized);
    const urls = this.getAlternateUrlsFromYaml(baseSlug, normalized);
    return includeEmpty
      ? urls
      : this.filterEmptyDetachedAlternateUrls(baseSlug, normalized, urls);
  }

  private filterEmptyDetachedAlternateUrls(
    slug: string,
    contentType: string,
    urls: Record<string, string>,
  ): Record<string, string> {
    if (!isEntryDetached(contentType, slug, this.contentRoot)) return urls;
    const out: Record<string, string> = {};
    for (const [locale, url] of Object.entries(urls)) {
      if (
        isEmptyDetachedLocaleEntry({
          contentType,
          slug,
          locale,
          contentRoot: this.contentRoot,
          ci: this,
        })
      ) {
        continue;
      }
      out[locale] = url;
    }
    return out;
  }

  /** Returns null if the slug is not a DB item (caller may fall through to YAML). */
  private getAlternateUrlsFromDatabase(
    slug: string,
    contentType: string,
  ): Record<string, string> | null {
    const config = this.contentTypeConfigs[contentType];
    const dbName = config?.database?.slug;
    if (!dbName) return null;

    const items = this.database.getMappedItems(dbName);
    if (!items || items.length === 0) return null;

    const item = items.find((i) => String(i.slug ?? "") === slug);
    if (!item) return null;

    const map = resolveHreflangsFromRecord(item, contentType, this.contentRoot);
    if (!map || Object.keys(map).length === 0) return {};

    const patternLocales = new Set(
      Object.keys(config.url_pattern || {})
        .filter((k) => k !== "default")
        .map((k) => (k === "default" ? "en" : k)),
    );
    if (patternLocales.size === 0) patternLocales.add("en");

    const knownSlugs = new Set(items.map((i) => String(i.slug ?? "")).filter(Boolean));
    const urls: Record<string, string> = {};

    for (const [locale, localeSlug] of Object.entries(map)) {
      if (!patternLocales.has(locale)) continue;
      if (!knownSlugs.has(localeSlug)) continue;
      const pattern = config.url_pattern?.[locale] || config.url_pattern?.["default"];
      if (!pattern) continue;
      // Prefer pattern params from the target item when available
      const targetItem = items.find((i) => String(i.slug ?? "") === localeSlug) || item;
      const fieldMapping = getFullFieldMapping(contentType, this.contentRoot);
      const defaults = getFieldMappingDefaults(contentType, this.contentRoot);
      const url = resolveUrlPatternWithMapping(pattern, targetItem, locale, fieldMapping, defaults);
      if (url) urls[locale] = url;
    }

    return urls;
  }

  private getAlternateUrlsFromYaml(slug: string, contentType: string): Record<string, string> {
    const entries = this.findBySlug(slug, { contentType });
    if (entries.length === 0) return {};

    const entry = entries[0];
    const basePath = path.join(process.cwd(), entry.directory);
    const urls: Record<string, string> = {};

    for (const locale of entry.locales) {
      if (locale.startsWith("_") || locale.includes(".")) continue;

      let localeSlug = slug;
      const candidates = [`${locale}.yml`, `${locale}.yaml`];
      for (const candidate of candidates) {
        const filePath = path.join(basePath, candidate);
        if (fs.existsSync(filePath)) {
          try {
            const raw = fs.readFileSync(filePath, "utf-8");
            const parsed = this.safeYamlLoad(raw);
            if (parsed?.slug && typeof parsed.slug === "string") {
              localeSlug = parsed.slug;
            }
          } catch {}
          break;
        }
      }

      urls[locale] = this.buildUrl(
        contentType,
        locale,
        localeSlug,
        this.resolveUrlPatternParamsForEntry(contentType, slug, locale),
      );
    }

    return urls;
  }

  private extractRedirects(
    parsed: Record<string, unknown>,
    slug: string,
    locale: string,
    contentType: string,
    filePath: string,
    localeSlug?: string,
    into: RedirectEntry[] = this.redirectEntries,
  ): void {
    const meta = parsed.meta as Record<string, unknown> | undefined;
    const redirects = meta?.redirects as unknown[] | undefined;
    if (!Array.isArray(redirects)) return;

    const isCommon = locale === "_common";
    const typeLabel = isCommon ? `${contentType}-common` : contentType;

    let targetTo: string | Record<string, string>;
    if (isCommon) {
      targetTo = this.buildLocaleUrlsInternal(slug, contentType);
      if (Object.keys(targetTo).length === 0) {
        targetTo = this.getCanonicalUrl(contentType, slug, "en");
      }
    } else {
      const effectiveSlug = localeSlug || slug;
      targetTo = this.getCanonicalUrl(contentType, effectiveSlug, locale);
    }

    for (const redirect of redirects) {
      let rawPath: string;
      let status = 301;

      if (typeof redirect === "string") {
        rawPath = redirect;
      } else if (typeof redirect === "object" && redirect !== null && "path" in redirect) {
        const obj = redirect as { path: string; status?: number };
        rawPath = obj.path;
        if (obj.status && [301, 302].includes(obj.status)) {
          status = obj.status;
        }
      } else {
        continue;
      }

      let normalized = rawPath.startsWith("/") ? rawPath : `/${rawPath}`;
      normalized = normalized.toLowerCase();
      if (normalized.length > 1 && normalized.endsWith("/")) {
        normalized = normalized.slice(0, -1);
      }
      into.push({
        from: normalized,
        to: targetTo,
        type: typeLabel,
        source: filePath,
        status,
      });
    }
  }

  private scanCustomRedirects(baseDir: string, into: RedirectEntry[] = this.redirectEntries): void {
    const customFile = path.join(baseDir, "custom-redirects.yml");
    if (!fs.existsSync(customFile)) return;

    try {
      const raw = fs.readFileSync(customFile, "utf-8");
      const parsed = this.safeYamlLoad(raw) as { redirects?: unknown[] } | null;
      if (!parsed || !Array.isArray(parsed.redirects)) return;

      for (const entry of parsed.redirects) {
        if (typeof entry !== "object" || entry === null || !("from" in entry) || !("to" in entry)) continue;
        const obj = entry as { from: string; to: string | Record<string, string>; status?: number; priority?: string };

        let normalizedFrom = obj.from.startsWith("/") ? obj.from : `/${obj.from}`;
        normalizedFrom = normalizedFrom.toLowerCase();
        if (normalizedFrom.length > 1 && normalizedFrom.endsWith("/")) {
          normalizedFrom = normalizedFrom.slice(0, -1);
        }

        const status = obj.status && [301, 302].includes(obj.status) ? obj.status : 301;
        const priority = obj.priority === "fallback" ? "fallback" : "before";

        into.push({
          from: normalizedFrom,
          to: obj.to,
          type: "custom",
          source: `${this.contentRootName}/custom-redirects.yml`,
          status,
          priority,
        });
      }
    } catch (err) {
      log.error({ err: err }, "[ContentIndex] Failed to read custom-redirects.yml:");
    }
  }

  private warnMissingSlugMappings(): void {
    try {
      const configs = getAllConfigs();
      for (const [typeName, config] of Object.entries(configs)) {
        if (config.database && !config.field_mapping?._slug) {
          log.warn(`[ContentIndex] WARNING: Database-backed content type "${typeName}" is missing _slug in field_mapping. This is required for URL resolution.`);
        }
        if (config.database && !config.field_mapping?._locale) {
          log.warn(`[ContentIndex] WARNING: Database-backed content type "${typeName}" is missing _locale in field_mapping. This is required for locale resolution.`);
        }
        if (
          config.database &&
          !config.field_mapping?._hreflangs &&
          config.url_pattern &&
          Object.keys(config.url_pattern).filter((k) => k !== "default").length >= 2
        ) {
          log.warn(
            `[ContentIndex] WARNING: Database-backed content type "${typeName}" has multi-locale url_pattern but no _hreflangs in field_mapping. Alternate URLs / hreflang may be incorrect when slugs differ per locale.`,
          );
        }
      }
    } catch {}
  }

  private autoCreateSingleTemplates(baseDir: string): void {
    const yamlDump = (data: unknown) =>
      yaml.dump(data, { lineWidth: -1, noRefs: true, quotingType: '"', forceQuotes: false });

    for (const [contentType, config] of Object.entries(this.contentTypeConfigs)) {
      const isSharedLayout = !!(config.database?.slug || (config as { single_template?: boolean }).single_template);
      if (!isSharedLayout) continue;

      const folder = config.directory || contentType;
      const typeDir = path.join(baseDir, folder);

      if (!fs.existsSync(typeDir)) {
        fs.mkdirSync(typeDir, { recursive: true });
        log.info(`[ContentIndex] Auto-created folder: ${this.contentRootName}/${folder}/`);
      }

      const commonPath = path.join(typeDir, "_common.single.yml");
      if (!fs.existsSync(commonPath)) {
        fs.writeFileSync(
          commonPath,
          "# Layout defaults for shared-layout singles (no sections — structure lives in single.{locale}.yml)\n",
        );
        log.info(`[ContentIndex] Auto-created: ${this.contentRootName}/${folder}/_common.single.yml`);
      }

      const locales = Object.keys(config.url_pattern || {}).filter((k) => k !== "default");
      if (locales.length === 0) locales.push("en");

      const mirrorSource = findBestSingleMirrorSource(typeDir, (raw) => this.safeYamlLoad(raw));

      for (const locale of locales) {
        const singlePath = path.join(typeDir, `single.${locale}.yml`);
        const exists = fs.existsSync(singlePath);

        if (exists) {
          try {
            const existing = this.safeYamlLoad(fs.readFileSync(singlePath, "utf-8"));
            const sections = Array.isArray(existing?.sections) ? existing.sections : [];
            if (sections.length === 0 && mirrorSource && mirrorSource.locale !== locale) {
              const mirrored = buildMirroredLocaleSingle(mirrorSource.data);
              if (existing?.meta) mirrored.meta = existing.meta;
              fs.writeFileSync(singlePath, yamlDump(mirrored) + "\n", "utf-8");
              log.info(
                `[ContentIndex] Repaired empty single stub from ${mirrorSource.locale}: ${this.contentRootName}/${folder}/single.${locale}.yml`,
              );
            }
          } catch (err) {
            log.warn(`[ContentIndex] Could not inspect single.${locale}.yml:`, err instanceof Error ? err.message : err);
          }
          continue;
        }

        if (mirrorSource) {
          const mirrored = buildMirroredLocaleSingle(mirrorSource.data);
          fs.writeFileSync(singlePath, yamlDump(mirrored) + "\n", "utf-8");
          log.info(
            `[ContentIndex] Auto-created single template (mirrored from ${mirrorSource.locale}): ${this.contentRootName}/${folder}/single.${locale}.yml`,
          );
        } else {
          const template = [
            "meta:",
            '  page_title: "{{ single.title }}"',
            '  description: "{{ single.description }}"',
            "sections: []",
            "",
          ].join("\n");
          fs.writeFileSync(singlePath, template);
          log.info(`[ContentIndex] Auto-created empty single template: ${this.contentRootName}/${folder}/single.${locale}.yml`);
        }
      }

      for (const { locale, filePath } of listAllSinglePaths(typeDir)) {
        if (locales.includes(locale)) continue;
        try {
          const existing = this.safeYamlLoad(fs.readFileSync(filePath, "utf-8"));
          const sections = Array.isArray(existing?.sections) ? existing.sections : [];
          if (sections.length === 0 && mirrorSource && mirrorSource.locale !== locale) {
            const mirrored = buildMirroredLocaleSingle(mirrorSource.data);
            if (existing?.meta) mirrored.meta = existing.meta;
            fs.writeFileSync(filePath, yamlDump(mirrored) + "\n", "utf-8");
            log.info(`[ContentIndex] Repaired extra empty single.${locale}.yml from ${mirrorSource.locale}`);
          }
        } catch { /* non-fatal */ }
      }
    }
  }

  private extractSlug(_folderPath: string, folderName: string, _files: string[]): string {
    return folderName;
  }

  private extractTitle(folderPath: string, files: string[], _contentType: string): string | undefined {
    const candidates = ["_common.yml", "_common.yaml", "en.yml", "en.yaml"];
    for (const candidate of candidates) {
      if (files.includes(candidate)) {
        try {
          const content = fs.readFileSync(path.join(folderPath, candidate), "utf-8");
          const parsed = this.safeYamlLoad(content);
          if (parsed?.title && typeof parsed.title === "string") {
            return parsed.title;
          }
          if (parsed?.name && typeof parsed.name === "string") {
            return parsed.name;
          }
        } catch {}
      }
    }
    return undefined;
  }

  private extractLocales(files: string[], _contentType: string): string[] {
    return files
      .map(f => f.replace(/\.(yml|yaml)$/, ""))
      .filter(name => /^[a-z]{2}(-[a-z]{2})?$/.test(name));
  }

  private ensureInitialized(): void {
    if (!this.initialized) {
      this.scanFast();
      this.startSlowScanAsync();
    }
  }

  findBySlug(slug: string, opts?: FindOptions): ContentEntry[] {
    this.ensureInitialized();
    const matches = this.bySlug.get(slug) || [];
    if (opts?.contentType) {
      const normalized = this.normalizeType(opts.contentType);
      return matches.filter(e => e.contentType === normalized);
    }
    return matches;
  }

  findByPath(folderPath: string): ContentEntry | undefined {
    this.ensureInitialized();
    return this.byPath.get(folderPath);
  }

  findByType(contentType: string): ContentEntry[] {
    this.ensureInitialized();
    const normalized = this.normalizeType(contentType);
    return this.entries.filter(e => e.contentType === normalized);
  }

  listAll(): ContentEntry[] {
    this.ensureInitialized();
    return [...this.entries];
  }

  getFileContent(slug: string, locale: string, opts?: FindOptions): { content: string; filePath: string } | null {
    const matches = this.findBySlug(slug, opts);
    if (matches.length === 0) return null;

    for (const entry of matches) {
      const basePath = path.join(process.cwd(), entry.directory);
      const candidates = [
        `${locale}.yml`,
        `${locale}.yaml`,
      ];
      candidates.push("_common.yml", "_common.yaml");
      for (const candidate of candidates) {
        const filePath = path.join(basePath, candidate);
        if (fs.existsSync(filePath)) {
          return {
            content: fs.readFileSync(filePath, "utf-8"),
            filePath: `${entry.directory}/${candidate}`,
          };
        }
      }
    }
    return null;
  }

  getAllFiles(slug: string, opts?: FindOptions): { filePath: string; content: string }[] {
    const matches = this.findBySlug(slug, opts);
    const results: { filePath: string; content: string }[] = [];

    for (const entry of matches) {
      const basePath = path.join(process.cwd(), entry.directory);
      for (const file of entry.files) {
        const fullPath = path.join(basePath, file);
        try {
          results.push({
            filePath: `${entry.directory}/${file}`,
            content: fs.readFileSync(fullPath, "utf-8"),
          });
        } catch {}
      }
    }
    return results;
  }

  resolveBaseSlug(slug: string, contentType: string): string {
    this.ensureInitialized();
    const normalized = this.normalizeType(contentType);
    if (this.bySlug.has(slug) && this.bySlug.get(slug)?.some(e => e.contentType === normalized)) return slug;
    return this.localeSlugMap.get(`${slug}:${normalized}`) || slug;
  }

  resolveLocaleFromUrlSlug(urlSlug: string, contentType: string): string | undefined {
    this.ensureInitialized();
    const folderSlug = this.resolveBaseSlug(urlSlug, contentType);
    if (folderSlug === urlSlug) return undefined;
    const available = this.getAvailableLocalesOrVariants(contentType as ContentType, folderSlug);
    for (const loc of available) {
      if (this.getLocaleSlug(folderSlug, contentType, loc) === urlSlug) {
        return loc;
      }
    }
    return undefined;
  }

  getLocaleSlug(baseSlug: string, contentType: string, locale: string): string {
    this.ensureInitialized();
    try {
      const normalized = this.normalizeType(contentType);
      const folderPath = this.getContentFolderPath(normalized, baseSlug);
      const localeFile = path.join(folderPath, `${locale}.yml`);
      if (fs.existsSync(localeFile)) {
        const raw = fs.readFileSync(localeFile, "utf-8");
        const parsed = this.safeYamlLoad(raw);
        if (parsed?.slug && typeof parsed.slug === "string") {
          return parsed.slug;
        }
      }
    } catch {}
    return baseSlug;
  }

  getImageUsage(imageId: string, imageSrc?: string, srcsetUrls?: string[]): string[] {
    const { mediaGallery } = require("./media-gallery");
    return mediaGallery.getUsage(imageId, imageSrc, srcsetUrls);
  }

  getVariableUsage(variableName: string): string[] {
    this.ensureInitialized();
    const refs = this.variableUsage.get(variableName);
    return refs ? Array.from(refs) : [];
  }

  getRedirects(): RedirectEntry[] {
    this.ensureInitialized();
    // Prefer a previous complete snapshot over an empty list during rebuild.
    // Only return [] on cold start before the first successful slow scan.
    if (!this.slowPhaseReady) return [];
    return [...this.redirectEntries];
  }

  /**
   * Re-read custom-redirects.yml from disk into redirectEntries.
   * Never leaves the index in a misleading custom-only + ready state: if content
   * redirects are missing or the slow phase is not ready, runs a full slow rebuild.
   */
  refreshCustomRedirects(): RedirectEntry[] {
    this.ensureInitialized();

    const hasContentRedirects = this.redirectEntries.some((e) => e.type !== "custom");
    if (!this.slowPhaseReady || !hasContentRedirects) {
      this.cancelPendingSlowScan();
      this.slowScanRunning = true;
      try {
        this.scanSlow();
      } finally {
        this.slowScanRunning = false;
        if (this.slowScanQueued) {
          this.startSlowScanAsync(0);
        }
      }
      return [...this.redirectEntries];
    }

    const next: RedirectEntry[] = this.redirectEntries.filter((e) => e.type !== "custom");
    this.scanCustomRedirects(this.contentRoot, next);
    const changed = !redirectEntriesEqual(this.redirectEntries, next);
    this.redirectEntries = next;
    if (changed) {
      this.clearLiveRedirectCache();
    }
    return [...this.redirectEntries];
  }

  getAllValidUrls(): Set<string> {
    this.ensureInitialized();
    const urls = new Set<string>();
    for (const entry of this.entries) {
      for (const locale of entry.locales) {
        if (locale.startsWith("_") || locale.includes(".")) continue;
        const localeUrls = this.getLocaleUrls(entry.slug, entry.contentType);
        for (const url of Object.values(localeUrls)) {
          urls.add(url);
        }
        break;
      }
    }
    return urls;
  }

  private extractUrlParams(pattern: string, url: string): Record<string, string> | null {
    const paramNames: string[] = [];
    const regexStr = "^" + pattern.replace(/:([a-zA-Z_]+)/g, (_m, name) => {
      paramNames.push(name);
      return "([^/]+)";
    }) + "$";
    const match = url.match(new RegExp(regexStr));
    if (!match) return null;
    const params: Record<string, string> = {};
    for (let i = 0; i < paramNames.length; i++) {
      params[paramNames[i]] = match[i + 1];
    }
    return params;
  }

  private getLastParamValue(params: Record<string, string>, pattern: string): string {
    const paramNames = (pattern.match(/:([a-zA-Z_]+)/g) || []).map(p => p.slice(1));
    if (paramNames.length === 0) return "";
    return params[paramNames[paramNames.length - 1]] || "";
  }

  parseContentUrl(url: string): { contentType: string; slug: string; locale: string; params?: Record<string, string> } | null {
    this.ensureInitialized();
    const qIndex = url.indexOf("?");
    const hashIndex = url.indexOf("#");
    const cleanUrl = url.slice(0, qIndex >= 0 ? qIndex : hashIndex >= 0 ? hashIndex : undefined).split("#")[0];
    const query = qIndex >= 0 ? url.slice(qIndex + 1, hashIndex >= 0 ? hashIndex : undefined) : "";
    const queryLocale = query ? new URLSearchParams(query).get("locale") : null;

    const allTypes = Object.keys(this.contentTypeConfigs);
    const allFolders = allTypes.map(t => this.contentTypeConfigs[t]?.directory || t);
    const combined = allTypes.concat(allFolders);
    const allAccepted = combined.filter((v, i) => combined.indexOf(v) === i);
    const previewRegex = new RegExp(`^\\/private\\/preview\\/(${allAccepted.join("|")})\\/([^/?]+)`);
    const previewMatch = cleanUrl.match(previewRegex);
    if (previewMatch) {
      return {
        contentType: this.normalizeType(previewMatch[1]),
        slug: previewMatch[2],
        locale: queryLocale || "en",
      };
    }

    for (const [contentType, config] of Object.entries(this.contentTypeConfigs)) {
      if (!config?.url_pattern) continue;
      for (const [locale, pattern] of Object.entries(config.url_pattern)) {
        const params = this.extractUrlParams(pattern, cleanUrl);
        if (params) {
          const slug = this.getLastParamValue(params, pattern);
          const effectiveLocale = locale === "default" ? "en" : locale;
          return { contentType, slug, locale: effectiveLocale, params };
        }

        if (locale !== "default") {
          const strippedPattern = pattern.replace(/^\/(en|es)\//, "/");
          if (strippedPattern !== pattern) {
            const strippedParams = this.extractUrlParams(strippedPattern, cleanUrl);
            if (strippedParams) {
              const slug = this.getLastParamValue(strippedParams, strippedPattern);
              return { contentType, slug, locale, params: strippedParams };
            }
          }
        }
      }
    }

    // Fallback: handle regional locale URLs like /es-mx/slug or /es-mx/programas-de-carrera/slug
    // by stripping the regional locale prefix and matching the remainder against locale-stripped patterns.
    const regionalLocalePrefix = cleanUrl.match(/^\/([a-z]{2}-[a-z]{2})(\/.*)?$/);
    if (regionalLocalePrefix) {
      const regionalLocale = regionalLocalePrefix[1]; // e.g. "es-mx"
      const urlRemainder = regionalLocalePrefix[2] || "/"; // e.g. "/mi-pagina"

      // Try matching the remainder against all content type patterns with locale prefix stripped
      for (const [contentType2, config2] of Object.entries(this.contentTypeConfigs)) {
        if (!config2?.url_pattern) continue;
        for (const [, pattern2] of Object.entries(config2.url_pattern)) {
          // Strip the leading locale segment from the pattern (e.g. /en/ or /es/ or /es-mx/)
          const strippedPattern = pattern2.replace(/^\/[a-z]{2}(?:-[a-z]{2})?\//, "/");
          if (strippedPattern === pattern2) continue; // pattern had no locale prefix to strip
          const params = this.extractUrlParams(strippedPattern, urlRemainder);
          if (params) {
            const slug = this.getLastParamValue(params, strippedPattern);
            return { contentType: contentType2, slug, locale: regionalLocale, params };
          }
        }
      }

      // Simple fallback: treat as a page with the first path segment as slug
      const simpleMatch = urlRemainder.match(/^\/([^/]+)\/?$/);
      if (simpleMatch) {
        return { contentType: "page", slug: simpleMatch[1], locale: regionalLocale };
      }
    }

    const bareMatch = cleanUrl.match(/^\/([^/]+)$/);
    if (bareMatch) {
      return { contentType: "page", slug: bareMatch[1], locale: "en" };
    }

    return null;
  }

  resolveUrl(url: string): { contentType: string; slug: string; entry: ContentEntry; fromDatabase?: boolean; params?: Record<string, string>; patternLocale?: string } | null {
    this.ensureInitialized();
    const cleanUrl = url.split("?")[0].split("#")[0];

    // For DB-backed content types: use exact URL index (prevents duplicate URLs and false positives)
    const dbMatch = this.byUrl.get(cleanUrl);
    if (dbMatch) {
      return { contentType: dbMatch.contentType, slug: dbMatch.slug, entry: dbMatch.entry, fromDatabase: true, params: dbMatch.params, patternLocale: dbMatch.patternLocale };
    }

    for (const [contentType, config] of Object.entries(this.contentTypeConfigs)) {
      if (!config?.url_pattern) continue;
      for (const [localeKey, pattern] of Object.entries(config.url_pattern)) {
        const params = this.extractUrlParams(pattern, cleanUrl);
        if (params) {
          const slug = this.getLastParamValue(params, pattern);

          // DB-backed: if indexed (cache was loaded), exact URL check already failed above → 404
          // If not indexed (empty/missing cache), fall back to fromDatabase for resilience
          if (config.database?.slug) {
            if (this.dbIndexedTypes.has(contentType)) return null;
            return {
              contentType,
              slug,
              entry: { slug, contentType, directory: `${this.contentRootName}/${config.directory}`, files: [], locales: [] },
              fromDatabase: true,
              params,
              patternLocale: localeKey,
            };
          }

          const found = this.findBySlug(slug, { contentType });
          if (found.length > 0) {
            const patternLocale = localeKey === "default" ? "en" : localeKey;
            const expectedParams = this.resolveUrlPatternParamsForEntry(contentType, found[0].slug, patternLocale);
            if (expectedParams) {
              const mismatch = Object.entries(expectedParams).some(
                ([k, v]) => params[k] !== undefined && params[k] !== v,
              );
              if (mismatch) continue;
            }
            return { contentType, slug, entry: found[0], params, patternLocale: localeKey };
          }

          const resolvedSlug = this.resolveBaseSlug(slug, contentType);
          if (resolvedSlug !== slug) {
            const foundResolved = this.findBySlug(resolvedSlug, { contentType });
            if (foundResolved.length > 0) {
              const patternLocale = localeKey === "default" ? "en" : localeKey;
              const expectedParams = this.resolveUrlPatternParamsForEntry(
                contentType,
                foundResolved[0].slug,
                patternLocale,
              );
              if (expectedParams) {
                const mismatch = Object.entries(expectedParams).some(
                  ([k, v]) => params[k] !== undefined && params[k] !== v,
                );
                if (mismatch) continue;
              }
              return { contentType, slug: resolvedSlug, entry: foundResolved[0], params, patternLocale: localeKey };
            }
          }

          return null;
        }
      }
    }

    // Fallback: handle regional locale URLs like /es-mx/slug or /es-mx/programas-de-carrera/slug
    const regionalPrefix2 = cleanUrl.match(/^\/([a-z]{2}-[a-z]{2})(\/.*)?$/);
    if (regionalPrefix2) {
      const urlRemainder2 = regionalPrefix2[2] || "/";
      for (const [contentType2, config2] of Object.entries(this.contentTypeConfigs)) {
        if (!config2?.url_pattern) continue;
        for (const [localeKey2, pattern2] of Object.entries(config2.url_pattern)) {
          const strippedPattern2 = pattern2.replace(/^\/[a-z]{2}(?:-[a-z]{2})?\//, "/");
          if (strippedPattern2 === pattern2) continue;
          const params2 = this.extractUrlParams(strippedPattern2, urlRemainder2);
          if (params2) {
            const slug2 = this.getLastParamValue(params2, strippedPattern2);
            const found2 = this.findBySlug(slug2, { contentType: contentType2 });
            if (found2.length > 0) return { contentType: contentType2, slug: slug2, entry: found2[0], params: params2, patternLocale: localeKey2 };
          }
        }
      }
    }

    return null;
  }

  resolveListingUrl(url: string): { contentType: string; locale: string } | null {
    this.ensureInitialized();
    const cleanUrl = url.split("?")[0].split("#")[0].replace(/\/$/, "");

    for (const [contentType, config] of Object.entries(this.contentTypeConfigs)) {
      if (!config?.url_pattern || !config?.database?.slug) continue;
      for (const [localeKey, pattern] of Object.entries(config.url_pattern)) {
        const staticPrefix = pattern.replace(/\/:[^/]+.*$/, "");
        if (staticPrefix && cleanUrl === staticPrefix) {
          return { contentType, locale: localeKey === "default" ? "en" : localeKey };
        }
      }
    }
    return null;
  }

  isKnownUrl(url: string): boolean {
    const result = this.resolveUrl(url) !== null;
    if (url.includes("/blog/") && !url.startsWith("/api/")) {
      log.info(`[ContentIndex] isKnownUrl(${url}) = ${result} (byUrl.size=${this.byUrl.size})`);
    }
    return result;
  }

  /**
   * Reindex content. Default is non-blocking: scanFast + coalesced background
   * scanSlow (same as the file-watcher path). Pass `{ syncSlow: true }` when
   * redirects/index must be correct before the caller returns (GitHub pull,
   * rename-with-redirect, raw YAML save, explicit refresh-cache).
   */
  refresh(opts?: { syncSlow?: boolean }): void {
    const syncSlow = opts?.syncSlow === true;

    if (!syncSlow) {
      this.scanFast();
      this.startSlowScanAsync();
      invalidateStaticListingCache(undefined, this.contentRoot);
      return;
    }

    if (this.refreshRunning) {
      this.refreshQueued = true;
      return;
    }
    this.refreshRunning = true;
    try {
      do {
        this.refreshQueued = false;
        this.scan();
      } while (this.refreshQueued);
    } finally {
      this.refreshRunning = false;
    }
    invalidateStaticListingCache(undefined, this.contentRoot);
    void import("./html-page-cache")
      .then(({ invalidateHtmlPageCache }) => invalidateHtmlPageCache())
      .catch(() => {});
  }

  getStats(): { total: number; byType: Record<string, number> } {
    this.ensureInitialized();
    const byType: Record<string, number> = {};
    for (const entry of this.entries) {
      byType[entry.contentType] = (byType[entry.contentType] || 0) + 1;
    }
    return { total: this.entries.length, byType };
  }

  getKnownUrlCount(): number {
    this.ensureInitialized();
    return this.byUrl.size;
  }

  isDatabaseBacked(contentType: string): boolean {
    const config = this.getContentTypeConfig(contentType);
    return !!config?.database?.slug;
  }

  getContentFolderPath(contentType: string, slug: string): string {
    const folder = this.getFolderName(contentType);
    const resolved = this.resolveBaseSlug(slug, contentType);
    const slugDir = path.join(this.contentRoot, folder, resolved);
    if (fs.existsSync(slugDir)) return slugDir;
    if (this.isDatabaseBacked(contentType)) {
      return path.join(this.contentRoot, folder);
    }
    return slugDir;
  }

  getCommonFilePath(contentType: string, slug: string): string {
    const folder = this.getContentFolderPath(contentType, slug);
    return path.join(folder, "_common.yml");
  }

  getContentFilePath(
    contentType: string,
    slug: string,
    locale: string,
    variant?: string,
    version?: number
  ): string {
    // For DB-backed types, getContentFolderPath falls back to the type root when
    // the per-entry directory doesn't exist yet. That makes perSlugPath resolve to
    // `{typeRoot}/{locale}.yml` (e.g. `blog/en.yml`) — a path that must never be
    // treated as a valid per-entry file. Derive the slug dir directly instead.
    if (this.isDatabaseBacked(contentType)) {
      const typeRoot = path.join(this.contentRoot, this.getFolderName(contentType));
      const resolved = this.resolveBaseSlug(slug, contentType);
      const slugDir = path.join(typeRoot, resolved);

      if (variant && variant !== "default") {
        return path.join(slugDir, `${variant}.${locale}.yml`);
      }

      const perSlugPath = path.join(slugDir, `${locale}.yml`);
      if (fs.existsSync(perSlugPath)) return perSlugPath;

      const singlePath = path.join(typeRoot, `single.${locale}.yml`);
      if (fs.existsSync(singlePath)) return singlePath;

      return perSlugPath;
    }

    const folder = this.getContentFolderPath(contentType, slug);

    if (variant && variant !== "default") {
      return path.join(folder, `${variant}.${locale}.yml`);
    }

    const perSlugPath = path.join(folder, `${locale}.yml`);
    if (fs.existsSync(perSlugPath)) return perSlugPath;

    return perSlugPath;
  }

  loadLocaleData(
    contentType: string,
    slug: string,
    locale: string,
    variant?: string,
    version?: number
  ): { data: Record<string, unknown> | null; filePath: string; error?: string; isSharedTemplate?: boolean } {
    try {
      const filePath = this.getContentFilePath(contentType, slug, locale, variant, version);
      if (!fs.existsSync(filePath)) {
        return { data: null, filePath, error: `Content file not found: ${filePath}` };
      }
      const raw = fs.readFileSync(filePath, "utf-8");
      const data = this.safeYamlLoad(raw) as Record<string, unknown>;
      const isSharedTemplate = path.basename(filePath).startsWith("single.");
      return { data, filePath, isSharedTemplate };
    } catch (error) {
      return { data: null, filePath: "", error: `Error loading locale data: ${error}` };
    }
  }

  loadCommonData(contentType: ContentType, slug: string): Record<string, unknown> | null {
    const resolved = this.resolveBaseSlug(slug, contentType);
    let commonPath = path.join(this.contentRoot, this.getFolderName(contentType), resolved, "_common.yml");

    if (!fs.existsSync(commonPath) && this.isDatabaseBacked(contentType)) {
      commonPath = path.join(this.contentRoot, this.getFolderName(contentType), "_common.single.yml");
    }

    if (!fs.existsSync(commonPath)) {
      return null;
    }

    try {
      const content = fs.readFileSync(commonPath, "utf8");
      return this.safeYamlLoad(content) as Record<string, unknown>;
    } catch (error) {
      log.error({ err: error }, `Error loading common data for ${contentType}/${slug}:`);
      return null;
    }
  }

  loadMergedContent(
    contentType: string,
    slug: string,
    locale: string,
    variant?: string,
    version?: number
  ): { data: Record<string, unknown> | null; filePath: string; error?: string; isSharedTemplate?: boolean } {
    try {
      const filePath = this.getContentFilePath(contentType, slug, locale, variant, version);
      if (!fs.existsSync(filePath)) {
        return { data: null, filePath, error: `Content file not found: ${filePath}` };
      }

      const folder = this.getFolderName(contentType);
      const singleCommonPath = path.join(this.contentRoot, folder, "_common.single.yml");
      const typeCommonPath = path.join(this.contentRoot, folder, "_common.yml");
      const useSingleTemplate =
        !!getContentTypeConfig(contentType, this.contentRoot)?.single_template &&
        !isEntryDetached(contentType, slug, this.contentRoot);

      let baseData: Record<string, unknown> = {};
      if (fs.existsSync(singleCommonPath)) {
        const singleCommonContent = fs.readFileSync(singleCommonPath, "utf-8");
        baseData = (this.safeYamlLoad(singleCommonContent) as Record<string, unknown>) || {};
      }

      const contentFolder = this.getContentFolderPath(contentType, slug);
      const commonPath = path.join(contentFolder, "_common.yml");
      const raw = fs.readFileSync(filePath, "utf-8");
      const localeData = this.safeYamlLoad(raw) as Record<string, unknown>;

      let merged: Record<string, unknown>;
      if (useSingleTemplate) {
        if (fs.existsSync(typeCommonPath)) {
          const typeCommon = this.safeYamlLoad(fs.readFileSync(typeCommonPath, "utf-8")) as Record<string, unknown> | null;
          if (typeCommon) {
            baseData = Object.keys(baseData).length > 0 ? deepMerge(baseData, typeCommon) : typeCommon;
          }
        }
        let singleLocalePath = path.join(this.contentRoot, folder, `single.${locale}.yml`);
        if (!fs.existsSync(singleLocalePath)) {
          singleLocalePath = path.join(this.contentRoot, folder, "single.en.yml");
        }
        if (fs.existsSync(singleLocalePath) && path.resolve(singleLocalePath) !== path.resolve(filePath)) {
          const singleLocale = this.safeYamlLoad(fs.readFileSync(singleLocalePath, "utf-8")) as Record<string, unknown> | null;
          if (singleLocale) {
            baseData = Object.keys(baseData).length > 0 ? deepMerge(baseData, singleLocale) : singleLocale;
          }
        }
        merged = { ...baseData };
        const dataOnly = true; // attached path only — detached uses classic merge above
        if (fs.existsSync(commonPath)) {
          const commonData = this.safeYamlLoad(fs.readFileSync(commonPath, "utf-8")) as Record<string, unknown> | null;
          if (commonData) merged = applyPerEntryLayer(merged, commonData, undefined, undefined, dataOnly);
        }
        if (localeData) merged = applyPerEntryLayer(merged, localeData, undefined, undefined, dataOnly);
      } else {
        if (fs.existsSync(commonPath)) {
          const commonContent = fs.readFileSync(commonPath, "utf-8");
          const commonData = this.safeYamlLoad(commonContent) as Record<string, unknown>;
          baseData = Object.keys(baseData).length > 0
            ? deepMerge(baseData, commonData)
            : commonData;
        }
        merged = Object.keys(baseData).length > 0
          ? deepMerge(baseData, localeData)
          : localeData;
      }

      const isSharedTemplate = useSingleTemplate || path.basename(filePath).startsWith("single.");
      return { data: merged, filePath, isSharedTemplate };
    } catch (error) {
      return { data: null, filePath: "", error: `Error loading merged content: ${error}` };
    }
  }

  loadContent<T>(options: LoadContentOptions<T>): LoadContentResult<T> {
    const { contentType, slug, schema, localeOrVariant, requireCommon = false } = options;

    try {
      const folder = this.getFolderName(contentType);
      let resolvedSlug = slug;
      const initialDir = path.join(this.contentRoot, folder, slug);
      if (!fs.existsSync(initialDir)) {
        resolvedSlug = this.resolveBaseSlug(slug, contentType);
      }

      const contentDir = path.join(this.contentRoot, folder, resolvedSlug);
      const commonPath = path.join(contentDir, "_common.yml");
      const contentPath = path.join(contentDir, `${localeOrVariant}.yml`);

      if (!fs.existsSync(contentPath)) {
        return { success: false, error: `Content file not found: ${contentPath}` };
      }

      if (requireCommon && !fs.existsSync(commonPath)) {
        return { success: false, error: `Required _common.yml not found: ${commonPath}` };
      }

      const singleCommonPath = path.join(this.contentRoot, folder, "_common.single.yml");
      const typeCommonPath = path.join(this.contentRoot, folder, "_common.yml");
      const useSingleTemplate =
        !!getContentTypeConfig(contentType, this.contentRoot)?.single_template &&
        !isEntryDetached(contentType, resolvedSlug, this.contentRoot);

      let baseData: Record<string, unknown> = {};
      if (fs.existsSync(singleCommonPath)) {
        const singleCommonContent = fs.readFileSync(singleCommonPath, "utf-8");
        baseData = (this.safeYamlLoad(singleCommonContent) as Record<string, unknown>) || {};
      }

      let cleanedData: Record<string, unknown>;

      if (useSingleTemplate) {
        // Shared-template mode: mirror DB mergeSingleTemplate base layers, then
        // id-patch entry _common.yml + locale (instead of replacing sections arrays).
        if (fs.existsSync(typeCommonPath)) {
          const typeCommon = this.safeYamlLoad(fs.readFileSync(typeCommonPath, "utf-8")) as Record<string, unknown> | null;
          if (typeCommon) {
            baseData = Object.keys(baseData).length > 0 ? deepMerge(baseData, typeCommon) : typeCommon;
          }
        }
        let singleLocalePath = path.join(this.contentRoot, folder, `single.${localeOrVariant}.yml`);
        if (!fs.existsSync(singleLocalePath)) {
          singleLocalePath = path.join(this.contentRoot, folder, "single.en.yml");
        }
        if (fs.existsSync(singleLocalePath)) {
          const singleLocale = this.safeYamlLoad(fs.readFileSync(singleLocalePath, "utf-8")) as Record<string, unknown> | null;
          if (singleLocale) {
            baseData = Object.keys(baseData).length > 0 ? deepMerge(baseData, singleLocale) : singleLocale;
          }
        }

        let merged: Record<string, unknown> = { ...baseData };
        const dataOnly = true;
        if (fs.existsSync(commonPath)) {
          const commonData = this.safeYamlLoad(fs.readFileSync(commonPath, "utf8")) as Record<string, unknown> | null;
          if (commonData) merged = applyPerEntryLayer(merged, commonData, undefined, undefined, dataOnly);
        }
        const contentData = this.safeYamlLoad(fs.readFileSync(contentPath, "utf8")) as Record<string, unknown> | null;
        if (contentData) merged = applyPerEntryLayer(merged, contentData, undefined, undefined, dataOnly);
        cleanedData = stripNullValues(applySectionLayoutDefaults(merged));
      } else {
        if (fs.existsSync(commonPath)) {
          const commonContent = fs.readFileSync(commonPath, "utf8");
          const commonData = this.safeYamlLoad(commonContent) as Record<string, unknown>;
          baseData = Object.keys(baseData).length > 0
            ? deepMerge(baseData, commonData)
            : commonData;
        }

        const contentContent = fs.readFileSync(contentPath, "utf8");
        const contentData = this.safeYamlLoad(contentContent) as Record<string, unknown>;

        const mergedData = deepMerge(baseData, contentData);
        cleanedData = stripNullValues(applySectionLayoutDefaults(mergedData));
      }

      if (schema) {
        const result = schema.safeParse(cleanedData);
        if (!result.success) {
          return {
            success: false,
            error: `Invalid YAML structure for ${contentType}/${slug}/${localeOrVariant}: ${result.error.message}`
          };
        }
        return { success: true, data: result.data };
      }

      return { success: true, data: cleanedData as T };
    } catch (error) {
      return {
        success: false,
        error: `Error loading ${contentType}/${slug}/${localeOrVariant}: ${error}`
      };
    }
  }

  listContentSlugs(contentType: ContentType): string[] {
    this.ensureInitialized();
    const contentDir = path.join(this.contentRoot, this.getFolderName(contentType));

    if (!fs.existsSync(contentDir)) {
      return [];
    }

    try {
      const entries = fs.readdirSync(contentDir, { withFileTypes: true });
      return entries
        .filter(entry => entry.isDirectory())
        .map(entry => entry.name);
    } catch (error) {
      log.error({ err: error }, `Error listing ${contentType}:`);
      return [];
    }
  }

  getAvailableLocalesOrVariants(contentType: ContentType, slug: string): string[] {
    this.ensureInitialized();
    const contentDir = path.join(this.contentRoot, this.getFolderName(contentType), slug);

    if (!fs.existsSync(contentDir)) {
      return [];
    }

    try {
      const files = fs.readdirSync(contentDir);
      return files
        .filter(f => {
          if (!f.endsWith(".yml") || f.startsWith("_")) return false;
          if (f === "versioning.yml") return false;
          const stem = f.slice(0, -4);
          return !stem.includes(".");
        })
        .map(f => f.replace(".yml", ""));
    } catch (error) {
      log.error({ err: error }, `Error getting locales for ${contentType}/${slug}:`);
      return [];
    }
  }

  private collectDotPaths(obj: unknown, prefix: string, maxDepth: number, depth: number = 0): string[] {
    if (depth >= maxDepth || obj == null || typeof obj !== "object" || Array.isArray(obj)) {
      return [];
    }
    const paths: string[] = [];
    for (const [key, value] of Object.entries(obj as Record<string, unknown>)) {
      if (key.startsWith("_")) continue;
      const dotPath = prefix ? `${prefix}.${key}` : key;
      if (typeof value === "string" && (value.includes("{{") || value.startsWith("function:"))) continue;
      paths.push(dotPath);
      if (value != null && typeof value === "object" && !Array.isArray(value)) {
        paths.push(...this.collectDotPaths(value, dotPath, maxDepth, depth + 1));
      }
    }
    return paths;
  }

  private computeCommonFields(contentType: string): CommonFieldInfo {
    const slugs = this.listContentSlugs(contentType as ContentType);
    if (slugs.length === 0) {
      return { common: [], partial: [] };
    }

    const keyCounts = new Map<string, number>();
    let total = 0;

    for (const slug of slugs) {
      const locales = this.getAvailableLocalesOrVariants(contentType as ContentType, slug);
      const locale = locales.includes("en") ? "en" : locales[0];
      if (!locale) continue;

      const { data } = this.loadMergedContent(contentType, slug, locale);
      if (!data) continue;

      total++;
      const paths = this.collectDotPaths(data, "", 2);
      for (const p of paths) {
        keyCounts.set(p, (keyCounts.get(p) || 0) + 1);
      }
    }

    const common: string[] = [];
    const partial: { key: string; count: number; total: number }[] = [];

    for (const [key, count] of keyCounts) {
      if (count === total) {
        common.push(key);
      } else {
        partial.push({ key, count, total });
      }
    }

    common.sort();
    partial.sort((a, b) => b.count - a.count || a.key.localeCompare(b.key));

    return { common, partial };
  }

  getCommonFields(contentType: string): CommonFieldInfo {
    this.ensureInitialized();
    const normalized = this.normalizeType(contentType);
    let cached = this.commonFieldsCache.get(normalized);
    if (!cached) {
      cached = this.computeCommonFields(normalized);
      this.commonFieldsCache.set(normalized, cached);
    }
    return cached;
  }

  invalidateCommonFields(contentType: string): void {
    const normalized = this.normalizeType(contentType);
    this.commonFieldsCache.delete(normalized);
    invalidateStaticListingCache(normalized, this.contentRoot);
  }

  duplicateWithTypeChange(opts: {
    sourceDir: string;
    sourceType: string;
    targetType: string;
    targetDir: string;
    newSlugs: { en?: string; es?: string };
    title: string;
    skipLocales: string[];
    localeTitles?: Record<string, string>;
  }): {
    copiedFiles: string[];
    strippedFields: string[];
    replacedVars: number;
    clearedFields: ClearedField[];
  } {
    this.ensureInitialized();

    const { sourceDir, sourceType, targetType, targetDir, newSlugs, title, skipLocales, localeTitles } = opts;

    const sourceFieldMapping = getFieldMapping(sourceType) || {};
    const targetFieldMapping = getFieldMapping(targetType) || {};

    const sourceKeys = Object.keys(sourceFieldMapping);
    const targetKeySet: Record<string, boolean> = {};
    for (const k of Object.keys(targetFieldMapping)) targetKeySet[k] = true;
    const universalKeys: Record<string, boolean> = { slug: true, title: true };
    const keysToStrip = sourceKeys.filter(k => !targetKeySet[k] && !universalKeys[k]);

    const sourceSlug = path.basename(sourceDir);
    const mergedByLocale: Record<string, Record<string, unknown>> = {};
    const locales = ["en", "es"];
    for (const locale of locales) {
      if (skipLocales.includes(locale)) continue;
      const { data } = this.loadMergedContent(sourceType, sourceSlug, locale);
      if (data) {
        mergedByLocale[locale] = data;
      }
    }

    if (!fs.existsSync(targetDir)) {
      fs.mkdirSync(targetDir, { recursive: true });
    }

    const copiedFiles: string[] = [];
    const strippedFields: string[] = [...keysToStrip];
    const clearedFields: ClearedField[] = [];
    let replacedVars = 0;

    const absSourceDir = path.isAbsolute(sourceDir) ? sourceDir : path.join(process.cwd(), sourceDir);
    if (!fs.existsSync(absSourceDir)) {
      return { copiedFiles, strippedFields, replacedVars, clearedFields };
    }

    const sourceFiles = fs.readdirSync(absSourceDir).filter(f => f.endsWith(".yml") || f.endsWith(".yaml"));

    // First pass: parse all files, strip IDs, apply slug/title — collect for regeneration
    const parsedFiles: Array<{ file: string; parsed: Record<string, unknown> }> = [];

    for (const file of sourceFiles) {
      if (file === "_common.single.yml" || file.startsWith("single.")) continue;

      const fileLocale = file.replace(/\.(yml|yaml)$/, "");
      if (fileLocale !== "_common" && skipLocales.includes(fileLocale)) continue;

      const sourceFilePath = path.join(absSourceDir, file);
      let raw = fs.readFileSync(sourceFilePath, "utf-8");

      const locale = fileLocale === "_common" ? "en" : fileLocale;
      const mergedData = mergedByLocale[locale] || mergedByLocale["en"] || {};

      const varResult = this.replaceTemplateVars(raw, mergedData, sourceFieldMapping);
      raw = varResult.content;
      replacedVars += varResult.count;

      const parsed = this.safeYamlLoad(raw);
      if (parsed) {
        for (const key of keysToStrip) {
          delete parsed[key];
        }

        delete parsed.redirects;
        if (parsed.meta && typeof parsed.meta === "object") {
          delete (parsed.meta as Record<string, unknown>).redirects;
        }

        this.stripSectionIds(parsed);

        if (fileLocale === "_common") {
          parsed.slug = Object.values(newSlugs).find(Boolean) || path.basename(targetDir);
          parsed.title = title;
          delete parsed.funnel;
          for (const targetKey of Object.keys(targetFieldMapping)) {
            if (!parsed[targetKey] && !sourceKeys.includes(targetKey)) {
              if (targetKey === "locale") {
                const activeLocales = locales.filter(l => !skipLocales.includes(l));
                parsed.locale = activeLocales[0] || "en";
              }
            }
          }
        } else if (newSlugs[fileLocale as keyof typeof newSlugs]) {
          parsed.slug = newSlugs[fileLocale as keyof typeof newSlugs];
          parsed.title = localeTitles?.[fileLocale] ?? title;
        }

        parsedFiles.push({ file, parsed });
      }
    }

    const fieldEditorsByType = loadAllFieldEditors();
    for (const { file, parsed } of parsedFiles) {
      clearedFields.push(
        ...wipeDocumentSectionsOnDuplicate(parsed, fieldEditorsByType, { file }),
      );
    }

    const allParsed = parsedFiles.map(f => f.parsed);
    const { objs: regenerated } = regenerateSectionIds(allParsed);

    const absTargetDir = path.isAbsolute(targetDir) ? targetDir : path.join(process.cwd(), targetDir);
    if (!fs.existsSync(absTargetDir)) {
      fs.mkdirSync(absTargetDir, { recursive: true });
    }
    for (let i = 0; i < parsedFiles.length; i++) {
      const { file } = parsedFiles[i];
      const outputPath = path.join(absTargetDir, file);
      const { escaped, map } = escapeObjectVars(regenerated[i]);
      const dumped = yaml.dump(escaped, { lineWidth: 120, noRefs: true, sortKeys: false });
      const yamlStr = unescapeYamlDump(dumped, map);
      fs.writeFileSync(outputPath, yamlStr, "utf-8");
      copiedFiles.push(file);
    }

    return { copiedFiles, strippedFields, replacedVars, clearedFields };
  }

  private replaceTemplateVars(
    content: string,
    mergedData: Record<string, unknown>,
    fieldMapping: Record<string, string>
  ): { content: string; count: number } {
    let count = 0;

    const dynamicEntriesRegex = /dynamic_entries\s*:[\s\S]*?item_template\s*:[\s\S]*?(?=\n\S|\n\s*-\s+type\s*:|\s*$)/g;
    const dynamicRanges: { start: number; end: number }[] = [];
    let dynMatch: RegExpExecArray | null;
    while ((dynMatch = dynamicEntriesRegex.exec(content)) !== null) {
      dynamicRanges.push({ start: dynMatch.index, end: dynMatch.index + dynMatch[0].length });
    }

    const isInDynamicRange = (pos: number): boolean => {
      for (const range of dynamicRanges) {
        if (pos >= range.start && pos < range.end) return true;
      }
      return false;
    };

    const singleVarRegex = /\{\{\s*single\.([a-zA-Z_][a-zA-Z0-9_]*)\s*(?:\|\s*([^}]*))?\s*\}\}/g;
    let result = "";
    let lastIndex = 0;
    let varMatch: RegExpExecArray | null;

    while ((varMatch = singleVarRegex.exec(content)) !== null) {
      if (isInDynamicRange(varMatch.index)) continue;

      const fieldName = varMatch[1];
      const fallback = varMatch[2]?.trim();

      let replacement: string | undefined;
      if (fallback !== undefined && fallback !== "") {
        replacement = fallback;
      } else {
        const mappedKey = fieldMapping[fieldName] || fieldName;
        const value = this.extractDotPathValue(mergedData, mappedKey);
        if (value !== undefined && value !== null) {
          replacement = String(value);
        }
      }

      if (replacement !== undefined) {
        result += content.slice(lastIndex, varMatch.index) + replacement;
        lastIndex = varMatch.index + varMatch[0].length;
        count++;
      }
    }

    result += content.slice(lastIndex);
    return { content: result, count };
  }

  private extractDotPathValue(obj: Record<string, unknown>, dotPath: string): unknown {
    const parts = dotPath.split(".");
    let current: unknown = obj;
    for (const part of parts) {
      if (current == null || typeof current !== "object") return undefined;
      current = (current as Record<string, unknown>)[part];
    }
    return current;
  }

  removeAllVariantSectionsFromPages(
    componentType: string,
    variantName: string,
    dryRun = false
  ): Array<{
    contentType: string;
    slug: string;
    locale: string;
    filePath: string;
    removedCount: number;
    removedSectionIds: string[];
  }> {
    this.ensureInitialized();

    const normalizeV = (v: string) => v.toLowerCase().replace(/[-_\s]/g, "");
    const normalizedTarget = normalizeV(variantName);

    const results: Array<{
      contentType: string;
      slug: string;
      locale: string;
      filePath: string;
      removedCount: number;
      removedSectionIds: string[];
    }> = [];

    if (dryRun) {
      // For impact preview: use loadMergedContent per locale so inherited _common.yml
      // sections are reported under real page paths (/en/slug, /es/slug) not /_common/slug
      for (const entry of this.entries) {
        for (const locale of entry.locales) {
          const { data } = this.loadMergedContent(entry.contentType, entry.slug, locale);
          if (!data || !Array.isArray(data.sections)) continue;
          const sections = data.sections as Record<string, unknown>[];
          const matching = sections.filter((s) => {
            const sType = s.type as string | undefined;
            const sVariant = s.variant as string | undefined;
            return sType === componentType && sVariant && normalizeV(sVariant) === normalizedTarget;
          });
          if (matching.length === 0) continue;
          results.push({
            contentType: entry.contentType,
            slug: entry.slug,
            locale,
            filePath: `${entry.directory}/${locale}.yml`,
            removedCount: matching.length,
            removedSectionIds: matching.map((s) => (s.section_id as string) || "").filter(Boolean),
          });
        }
      }
      return results;
    }

    // Actual deletion: scan and modify underlying files directly
    // (locale files + _common.yml, since _common is not in entry.locales)
    const processFile = (absFilePath: string, entryContentType: string, slug: string) => {
      if (!fs.existsSync(absFilePath)) return;
      try {
        const raw = fs.readFileSync(absFilePath, "utf-8");
        const { escaped, map } = escapeTemplateVars(raw);
        const parsed = yaml.load(escaped) as Record<string, unknown>;
        if (!parsed || !Array.isArray(parsed.sections)) return;

        const sections = parsed.sections as Record<string, unknown>[];
        const removedIds: string[] = [];
        const kept: Record<string, unknown>[] = [];

        for (const section of sections) {
          const sType = section.type as string | undefined;
          const sVariant = section.variant as string | undefined;
          if (sType === componentType && sVariant && normalizeV(sVariant) === normalizedTarget) {
            removedIds.push((section.section_id as string) || "");
          } else {
            kept.push(section);
          }
        }

        if (removedIds.length === 0) return;

        results.push({
          contentType: entryContentType,
          slug,
          locale: path.basename(absFilePath).replace(/\.(yml|yaml)$/, ""),
          filePath: absFilePath,
          removedCount: removedIds.length,
          removedSectionIds: removedIds.filter(Boolean),
        });

        parsed.sections = kept;
        const { escaped: escapedOut, map: mapOut } = escapeObjectVars(parsed);
        const dumped = yaml.dump(escapedOut, { lineWidth: 120, noRefs: true, sortKeys: false });
        fs.writeFileSync(absFilePath, unescapeYamlDump(dumped, mapOut), "utf-8");
      } catch (e) {
        log.error({ err: e }, `Error processing ${absFilePath}:`);
      }
    };

    for (const entry of this.entries) {
      const entryDir = path.join(process.cwd(), entry.directory);
      for (const locale of entry.locales) {
        processFile(path.join(entryDir, `${locale}.yml`), entry.contentType, entry.slug);
      }
      processFile(path.join(entryDir, "_common.yml"), entry.contentType, entry.slug);
    }

    return results;
  }

  private stripSectionIds(parsed: Record<string, unknown>): void {
    const sections = parsed.sections;
    if (Array.isArray(sections)) {
      for (const section of sections) {
        if (section && typeof section === "object") {
          delete (section as Record<string, unknown>).section_id;
        }
      }
    }
  }
}

export { stripNullValues };

/**
 * Default singleton instance — used by code that hasn't migrated to per-site
 * routing yet. Reads contentRoot from CONTENT_FOLDER env var (default: "4geeks-com").
 */
export const contentIndex = new ContentIndex();
