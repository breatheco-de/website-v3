import fs from "fs";
import { getDefaultContentFolder } from "./site-config";
import path from "path";
import yaml from "js-yaml";
import { getContentTypeConfig, getLocaleKey, getFieldMapping, getFullFieldMapping, RESERVED_IMAGE_FIELD, RESERVED_SLUG_FIELD, RESERVED_LOCALE_FIELD, applyImageAliasToEntry, applySlugAliasToEntry, applyLocaleAliasToEntry } from "./content-types";
import { getValueByPath, resolveFieldValue, isTransformer, compileTransformer, runTransformer } from "./transform";
import { ExternalImageCacher } from "./external-image-cacher";
import { resolveBySourceUrl } from "./image-registry";
import { IDatabaseCache, CacheEntry, SqliteCache, CACHE_DIR } from "./db-cache";
import { markFileAsModified } from "./sync-state";
import { applyEditorialStampToDbMappedUpdates } from "./editorial-updated-at";
import { setJobState } from "./db-job-state";
import type { MediaGallery } from "./media-gallery";
import { expandEditorFieldTokens } from "@shared/editor-field-values";
import { child } from "./logger";
const log = child({ module: "database" });



function getDbDir(contentRoot?: string): string {
  if (contentRoot) return path.join(contentRoot, "db");
  try {
    const { getDefaultSite } = require('./site-manager') as typeof import('./site-manager');
    return path.join(getDefaultSite().contentRoot, "db");
  } catch {
    return path.join(process.cwd(), getDefaultContentFolder(), "db");
  }
}
const DB_DIR = path.join(process.cwd(), getDefaultContentFolder(), "db");

export interface VectorSearchConfig {
  enabled: boolean;
  fields: string[];
}

export interface DatabaseConfig {
  name: string;
  description?: string;
  source: {
    type: "api" | "csv" | "yaml" | "local" | "remote";
    api?: {
      endpoint: string;
      params?: Record<string, unknown>;
      results_path?: string;
      auth?: {
        token_env_var?: string;
        prefix?: string;
      };
      headers?: Record<string, string>;
    };
    local?: {
      filename: string;
      results_path?: string;
    };
    remote?: {
      url: string;
      results_path?: string;
    };
  };
  cache?: {
    ttl_hours?: number;
  };
  field_mapping?: Record<string, string>;
  filter_by_locale?: boolean;
  editor?: Record<string, { type?: string; options?: (string | { value: string; label: string })[]; populate_options?: boolean; allow_custom_values?: boolean; split_comma_values?: boolean; cache_images?: boolean; description?: string }>;
  vector_search?: VectorSearchConfig;
  search_fields?: string[];
}

const VALID_DB_NAME = /^[a-z0-9_-]+$/;

function setValueByPath(obj: Record<string, unknown>, dotPath: string, value: unknown): void {
  const parts = dotPath.split(".");
  let current: Record<string, unknown> = obj;
  for (let i = 0; i < parts.length - 1; i++) {
    const part = parts[i];
    if (current[part] === null || current[part] === undefined || typeof current[part] !== "object") {
      current[part] = {};
    }
    current = current[part] as Record<string, unknown>;
  }
  current[parts[parts.length - 1]] = value;
}

const TRANSFORM_ERROR_SENTINEL = "__transform_error__";

export { TRANSFORM_ERROR_SENTINEL };

function countTransformErrorsInValue(val: unknown): number {
  if (val === TRANSFORM_ERROR_SENTINEL) return 1;
  if (Array.isArray(val)) {
    return val.reduce((sum, el) => sum + countTransformErrorsInValue(el), 0);
  }
  if (val && typeof val === "object") {
    return Object.values(val as Record<string, unknown>).reduce(
      (sum, el) => sum + countTransformErrorsInValue(el),
      0,
    );
  }
  return 0;
}

function countTransformErrorsInItems(items: Record<string, unknown>[]): number {
  return items.reduce((sum, item) => sum + countTransformErrorsInValue(item), 0);
}

async function withFetchJobState<T>(
  dbName: string | undefined,
  fn: () => Promise<T>,
  getFetchedCount?: (result: T) => number,
): Promise<T> {
  if (dbName) {
    setJobState(dbName, "fetch", {
      status: "running",
      startedAt: new Date().toISOString(),
    });
  }
  try {
    const result = await fn();
    if (dbName) {
      const fetched = getFetchedCount
        ? getFetchedCount(result)
        : Array.isArray(result)
          ? result.length
          : 0;
      setJobState(dbName, "fetch", {
        status: "done",
        fetched,
        finishedAt: new Date().toISOString(),
      });
    }
    return result;
  } catch (err) {
    if (dbName) {
      setJobState(dbName, "fetch", {
        status: "error",
        error: err instanceof Error ? err.message : String(err),
        finishedAt: new Date().toISOString(),
      });
    }
    throw err;
  }
}

function applyFieldMapping(
  item: Record<string, unknown>,
  mapping: Record<string, string>
): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [normalizedKey, sourcePath] of Object.entries(mapping)) {
    if (sourcePath === null || sourcePath === undefined) {
      result[normalizedKey] = null;
    } else if (isTransformer(sourcePath)) {
      const compiled = compileTransformer(sourcePath);
      if (!compiled) {
        result[normalizedKey] = TRANSFORM_ERROR_SENTINEL;
      } else {
        const output = runTransformer(compiled, item[normalizedKey], item, { fieldPath: normalizedKey });
        result[normalizedKey] = output === undefined ? TRANSFORM_ERROR_SENTINEL : output;
      }
    } else {
      result[normalizedKey] = getValueByPath(item, sourcePath);
    }
  }
  return result;
}

function collectAllPaths(obj: unknown, prefix: string, keys: Set<string>): void {
  if (obj == null || typeof obj !== "object" || Array.isArray(obj)) return;
  for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
    const fullPath = prefix ? `${prefix}.${k}` : k;
    keys.add(fullPath);
    if (v != null && typeof v === "object" && !Array.isArray(v)) {
      collectAllPaths(v, fullPath, keys);
    }
  }
}

const DATASET_EXTENSIONS = [".json", ".csv", ".yaml", ".yml"];

function parseFileContent(content: string, ext: string, resultsPath?: string): unknown[] {
  let data: unknown;
  if (ext === ".json") {
    data = JSON.parse(content);
  } else if (ext === ".yaml" || ext === ".yml") {
    data = yaml.load(content);
  } else if (ext === ".csv") {
    const lines = content.trim().split("\n");
    if (lines.length < 2) return [];
    const headers = lines[0].split(",").map((h) => h.trim().replace(/^"|"$/g, ""));
    data = lines.slice(1).map((line) => {
      const vals = line.split(",").map((v) => v.trim().replace(/^"|"$/g, ""));
      const row: Record<string, unknown> = {};
      headers.forEach((h, i) => { row[h] = vals[i] ?? ""; });
      return row;
    });
  } else {
    throw new Error(`Unsupported file extension: ${ext}`);
  }

  if (resultsPath) {
    const items = getValueByPath(data, resultsPath);
    if (!Array.isArray(items)) {
      throw new Error(`results_path "${resultsPath}" did not resolve to an array`);
    }
    return items;
  }
  if (Array.isArray(data)) return data;
  if (data && typeof data === "object") {
    const arrayKeys = Object.keys(data as Record<string, unknown>).filter(
      (k) => Array.isArray((data as Record<string, unknown>)[k])
    );
    if (arrayKeys.length === 1) {
      return (data as Record<string, unknown>)[arrayKeys[0]] as unknown[];
    }
    if (arrayKeys.length > 1) {
      throw new Error(
        `File contains multiple array keys: ${arrayKeys.map((k) => `"${k}"`).join(", ")}. ` +
        `Set the Results Path field to one of these.`
      );
    }
  }
  throw new Error("File content is not an array and no results_path configured");
}

async function fetchFromLocal(
  dbSlug: string,
  localConfig: NonNullable<DatabaseConfig["source"]["local"]>,
  dbDir: string = DB_DIR
): Promise<unknown[]> {
  const filePath = path.join(dbDir, dbSlug, localConfig.filename);
  if (!fs.existsSync(filePath)) {
    throw new Error(
      `Local file not found: ${path.relative(process.cwd(), filePath)}`
    );
  }
  const content = fs.readFileSync(filePath, "utf-8");
  const ext = path.extname(localConfig.filename).toLowerCase();
  if (!DATASET_EXTENSIONS.includes(ext)) {
    throw new Error(`Unsupported file extension "${ext}". Allowed: ${DATASET_EXTENSIONS.join(", ")}`);
  }
  return parseFileContent(content, ext, localConfig.results_path);
}

async function fetchFromRemote(
  remoteConfig: NonNullable<DatabaseConfig["source"]["remote"]>
): Promise<unknown[]> {
  const response = await fetch(remoteConfig.url);
  if (!response.ok) {
    throw new Error(`Remote URL returned ${response.status}: ${await response.text().catch(() => "")}`);
  }
  const contentType = response.headers.get("content-type") || "";
  const url = new URL(remoteConfig.url);
  const ext = path.extname(url.pathname).toLowerCase() || ".json";

  let content: string;
  if (ext === ".json" || contentType.includes("json")) {
    content = await response.text();
    return parseFileContent(content, ".json", remoteConfig.results_path);
  } else if (ext === ".yaml" || ext === ".yml" || contentType.includes("yaml")) {
    content = await response.text();
    return parseFileContent(content, ".yaml", remoteConfig.results_path);
  } else if (ext === ".csv" || contentType.includes("csv")) {
    content = await response.text();
    return parseFileContent(content, ".csv", remoteConfig.results_path);
  } else {
    content = await response.text();
    return parseFileContent(content, ".json", remoteConfig.results_path);
  }
}

async function fetchFromApi(
  apiConfig: NonNullable<DatabaseConfig["source"]["api"]>,
  dbName?: string
): Promise<unknown[]> {
  const headers: Record<string, string> = {
    Accept: "application/json",
    ...(apiConfig.headers || {}),
  };

  if (apiConfig.auth?.token_env_var) {
    const token = process.env[apiConfig.auth.token_env_var];
    if (token) {
      const prefix = apiConfig.auth.prefix || "Bearer";
      headers["Authorization"] = `${prefix} ${token}`;
    }
  }

  const baseParams: Record<string, unknown> = { ...(apiConfig.params || {}) };
  const hasResultsPath = !!apiConfig.results_path;
  const rawLimit = baseParams.limit;
  const pageSize = rawLimit !== undefined ? parseInt(String(rawLimit), 10) : NaN;

  if (!hasResultsPath || isNaN(pageSize) || pageSize <= 0) {
    if (dbName) {
      setJobState(dbName, "fetch", {
        status: "running",
        startedAt: new Date().toISOString(),
      });
    }

    try {
      const url = new URL(apiConfig.endpoint);
      for (const [key, value] of Object.entries(baseParams)) {
        url.searchParams.set(key, String(value));
      }

      const response = await fetch(url.toString(), { headers });
      if (!response.ok) {
        throw new Error(
          `API returned ${response.status}: ${await response.text().catch(() => "")}`
        );
      }

      const data = await response.json();

      let items: unknown[];
      if (hasResultsPath) {
        const resolved = getValueByPath(data, apiConfig.results_path!);
        if (!Array.isArray(resolved)) {
          throw new Error(
            `results_path "${apiConfig.results_path}" did not resolve to an array`
          );
        }
        items = resolved;
      } else if (Array.isArray(data)) {
        items = data;
      } else if (data && typeof data === "object") {
        const arrayKeys = Object.keys(data as Record<string, unknown>).filter(
          (k) => Array.isArray((data as Record<string, unknown>)[k])
        );
        if (arrayKeys.length === 1) {
          items = (data as Record<string, unknown>)[arrayKeys[0]] as unknown[];
        } else if (arrayKeys.length > 1) {
          throw new Error(
            `Response contains multiple array keys: ${arrayKeys.map((k) => `"${k}"`).join(", ")}. ` +
            `Set the Results Path field to one of these.`
          );
        } else {
          throw new Error("API response is not an array and no results_path configured");
        }
      } else {
        throw new Error("API response is not an array and no results_path configured");
      }

      if (dbName) {
        setJobState(dbName, "fetch", {
          status: "done",
          fetched: items.length,
          finishedAt: new Date().toISOString(),
        });
      }

      return items;
    } catch (err) {
      if (dbName) {
        setJobState(dbName, "fetch", {
          status: "error",
          error: err instanceof Error ? err.message : String(err),
          finishedAt: new Date().toISOString(),
        });
      }
      throw err;
    }
  }

  const allItems: unknown[] = [];
  let offset = parseInt(String(baseParams.offset ?? 0), 10);
  if (isNaN(offset)) offset = 0;
  let page = 0;

  if (dbName) {
    setJobState(dbName, "fetch", {
      status: "running",
      fetched: 0,
      total: null,
      page: 0,
      startedAt: new Date().toISOString(),
    });
  }

  try {
    while (true) {
      const url = new URL(apiConfig.endpoint);
      for (const [key, value] of Object.entries(baseParams)) {
        url.searchParams.set(key, String(value));
      }
      url.searchParams.set("limit", String(pageSize));
      url.searchParams.set("offset", String(offset));

      log.info(
        `[fetchFromApi] Fetching page ${page + 1} (offset=${offset}, limit=${pageSize}) from ${apiConfig.endpoint}`
      );

      const response = await fetch(url.toString(), { headers });
      if (!response.ok) {
        throw new Error(
          `API returned ${response.status}: ${await response.text().catch(() => "")}`
        );
      }

      const data = await response.json();
      const items = getValueByPath(data, apiConfig.results_path!) as unknown[];
      if (!Array.isArray(items)) {
        throw new Error(
          `results_path "${apiConfig.results_path}" did not resolve to an array`
        );
      }

      allItems.push(...items);

      if (dbName) {
        setJobState(dbName, "fetch", {
          status: "running",
          fetched: allItems.length,
          page: page + 1,
        });
      }

      if (items.length < pageSize) {
        break;
      }

      offset += pageSize;
      page++;
    }
  } catch (err) {
    if (dbName) {
      setJobState(dbName, "fetch", {
        status: "error",
        error: err instanceof Error ? err.message : String(err),
        finishedAt: new Date().toISOString(),
      });
    }
    throw err;
  }

  if (dbName) {
    setJobState(dbName, "fetch", {
      status: "done",
      fetched: allItems.length,
      finishedAt: new Date().toISOString(),
    });
  }

  log.info(`[fetchFromApi] Fetched ${allItems.length} total items from ${apiConfig.endpoint}`);
  return allItems;
}

function slugify(text: string): string {
  return text
    .toLowerCase()
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 200);
}

function applyContentTypeMapping(
  items: Record<string, unknown>[],
  mapping: Record<string, string>,
  contentType?: string,
  fullMapping?: Record<string, string> | null,
): Record<string, unknown>[] {
  return items.map((src, idx) => {
    const mapped: Record<string, unknown> = { ...src };
    const itemSlug = String(src.slug ?? src.id ?? idx);

    for (const [targetKey, sourcePath] of Object.entries(mapping)) {
      const value = resolveFieldValue(sourcePath, src, targetKey, contentType ? {
        contentType,
        slug: itemSlug,
        fieldPath: targetKey,
      } : undefined);
      if (value !== undefined) {
        mapped[targetKey] = value;
      }
    }

    const slugMapSource = fullMapping?.[RESERVED_SLUG_FIELD];
    if (slugMapSource) {
      const slugValue = resolveFieldValue(slugMapSource, src, RESERVED_SLUG_FIELD, contentType ? {
        contentType,
        slug: itemSlug,
        fieldPath: RESERVED_SLUG_FIELD,
      } : undefined);
      applySlugAliasToEntry(mapped, slugValue);
    }

    const localeMapSource = fullMapping?.[RESERVED_LOCALE_FIELD];
    if (localeMapSource) {
      const localeValue = resolveFieldValue(localeMapSource, src, RESERVED_LOCALE_FIELD, contentType ? {
        contentType,
        slug: itemSlug,
        fieldPath: RESERVED_LOCALE_FIELD,
      } : undefined);
      applyLocaleAliasToEntry(mapped, localeValue);
    }

    const imageSource = fullMapping?.[RESERVED_IMAGE_FIELD];
    if (imageSource) {
      const imageValue = resolveFieldValue(imageSource, src, RESERVED_IMAGE_FIELD, contentType ? {
        contentType,
        slug: itemSlug,
        fieldPath: RESERVED_IMAGE_FIELD,
      } : undefined);
      applyImageAliasToEntry(mapped, imageValue);
    }

    if (!mapped.slug && mapped.title && typeof mapped.title === "string") {
      mapped.slug = slugify(mapped.title);
    }

    // Category is a plain URL slug string (never `{ slug }`).
    if (mapped.category !== undefined && typeof mapped.category === "string") {
      // keep as string
    } else if (
      mapped.category &&
      typeof mapped.category === "object" &&
      !Array.isArray(mapped.category) &&
      typeof (mapped.category as { slug?: unknown }).slug === "string"
    ) {
      mapped.category = String((mapped.category as { slug: string }).slug);
    } else if (mapped.category === undefined || mapped.category === null) {
      if (mapping.category) {
        mapped.category = "uncategorized";
      }
    }

    if (!mapped.id) mapped.id = idx;

    return mapped;
  });
}

interface OverridesFile {
  lookup_key: string;
  entries: Record<string, Record<string, unknown>>;
}

export class DatabaseManager {
  private configs = new Map<string, DatabaseConfig>();
  private memoryCache = new Map<string, { data: CacheEntry; expires: number }>();
  private cache: IDatabaseCache = new SqliteCache();

  private overridesPath(dbName: string): string {
    return path.join(this.dbDir, dbName, "overrides.json");
  }

  private loadOverridesFile(dbName: string): OverridesFile | null {
    const filePath = this.overridesPath(dbName);
    if (!fs.existsSync(filePath)) return null;
    try {
      const parsed = JSON.parse(fs.readFileSync(filePath, "utf-8"));
      if (!parsed || typeof parsed !== "object") return null;
      const lookup_key = typeof parsed.lookup_key === "string" ? parsed.lookup_key : "slug";
      const entries =
        parsed.entries && typeof parsed.entries === "object" && !Array.isArray(parsed.entries)
          ? (parsed.entries as Record<string, Record<string, unknown>>)
          : {};
      return { lookup_key, entries };
    } catch {
      return null;
    }
  }

  private saveOverridesFile(dbName: string, file: OverridesFile): void {
    const filePath = this.overridesPath(dbName);
    const dir = path.dirname(filePath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(filePath, JSON.stringify(file, null, 2));
  }

  private applyOverridesToItems(
    items: Record<string, unknown>[],
    lookupKey: string,
    entries: Record<string, Record<string, unknown>>
  ): Record<string, unknown>[] {
    if (Object.keys(entries).length === 0) return items;
    return items.map((item) => {
      const slugVal = String(item[lookupKey] ?? "");
      const itemOverrides = entries[slugVal];
      if (!itemOverrides || Object.keys(itemOverrides).length === 0) return item;
      return { ...item, ...itemOverrides };
    });
  }

  private readonly dbDir: string;
  private readonly contentRoot: string;
  private readonly mediaGallery: MediaGallery | null;

  constructor(contentRoot?: string, mediaGallery?: MediaGallery) {
    this.dbDir = getDbDir(contentRoot);
    this.contentRoot = path.dirname(this.dbDir);
    this.mediaGallery = mediaGallery ?? null;
    this.reload();
    this.migrateJsonCaches();
  }

  private migrateJsonCaches(): void {
    if (!(this.cache instanceof SqliteCache)) return;
    const dbNames = Array.from(this.configs.keys());
    if (dbNames.length === 0) return;

    const migrated = this.cache.migrateFromJson(dbNames, CACHE_DIR);
    if (migrated.length > 0) {
      log.info(
        `[DatabaseManager] Migrated ${migrated.length} database(s) from JSON cache to SQLite: ${migrated.join(", ")}`
      );
    } else {
      log.info(`[DatabaseManager] No legacy JSON cache files to migrate`);
    }
  }

  reload(): void {
    this.configs.clear();
    if (!fs.existsSync(this.dbDir)) return;

    const folders = fs.readdirSync(this.dbDir).filter((f) => {
      const full = path.join(this.dbDir, f);
      return (
        fs.statSync(full).isDirectory() &&
        fs.existsSync(path.join(full, "config.yml"))
      );
    });

    for (const folder of folders) {
      try {
        const configPath = path.join(this.dbDir, folder, "config.yml");
        const raw = fs.readFileSync(configPath, "utf-8");
        this.configs.set(folder, yaml.load(raw) as DatabaseConfig);
      } catch (err) {
        log.error({ err: err }, `[DatabaseManager] Failed to load config for "${folder}":`);
      }
    }

    log.info(`[DatabaseManager] Loaded ${this.configs.size} database(s)`);
  }

  private validateName(name: string): void {
    if (!name || !VALID_DB_NAME.test(name)) {
      throw new Error(
        `Invalid database name "${name}" — only lowercase letters, digits, hyphens, and underscores allowed`
      );
    }
  }

  list(): { name: string; config: DatabaseConfig }[] {
    return Array.from(this.configs.entries()).map(([name, config]) => ({
      name,
      config,
    }));
  }

  get(name: string): DatabaseConfig {
    this.validateName(name);
    const config = this.configs.get(name);
    if (!config) {
      throw new Error(`Database "${name}" not found`);
    }
    return config;
  }

  exists(name: string): boolean {
    return this.configs.has(name);
  }

  create(name: string, config: DatabaseConfig): void {
    this.validateName(name);
    if (this.configs.has(name)) {
      throw new Error(`Database "${name}" already exists`);
    }
    const { assertSourceNameAvailable } = require("./query-options") as typeof import("./query-options");
    assertSourceNameAvailable(name, "database", this.contentRoot, this);
    this.writeToDisk(name, config);
    this.configs.set(name, config);
  }

  update(name: string, config: DatabaseConfig): void {
    this.validateName(name);
    this.writeToDisk(name, config);
    this.configs.set(name, config);
    this.memoryCache.delete(name);
  }

  delete(name: string): void {
    this.validateName(name);
    const dir = path.join(this.dbDir, name);
    if (fs.existsSync(dir)) {
      fs.rmSync(dir, { recursive: true });
    }
    this.configs.delete(name);
    this.memoryCache.delete(name);
    this.cache.clear(name);
  }

  private scheduleExternalImages(
    dbName: string,
    config: DatabaseConfig,
    items: Record<string, unknown>[],
  ): void {
    if (!this.mediaGallery) return;
    ExternalImageCacher.scheduleItems(dbName, config, items, this.mediaGallery);
  }

  async fetchItems(
    name: string,
    forceRefresh = false
  ): Promise<{
    items: Record<string, unknown>[];
    raw_count: number;
    fetched_at: string;
    from_cache: boolean;
    facets?: Record<string, string[]>;
  }> {
    const config = this.get(name);
    const ttl = config.cache?.ttl_hours ?? 24;

    if (!forceRefresh) {
      const memEntry = this.memoryCache.get(name);
      if (memEntry && Date.now() < memEntry.expires) {
        this.scheduleExternalImages(name, config, memEntry.data.items);
        return { ...memEntry.data, from_cache: true };
      }

      const cached = this.cache.read(name, ttl);
      if (cached) {
        if (!cached.facets && config.editor) {
          const facets: Record<string, string[]> = {};
          for (const [field, hint] of Object.entries(config.editor)) {
            if (hint.type === "tags" || hint.type === "select") {
              const valueSet = new Set<string>();
              for (const item of cached.items) {
                const v = item[field];
                if (Array.isArray(v)) {
                  for (const el of v) { if (el != null && el !== "") valueSet.add(String(el)); }
                } else if (v != null && v !== "") {
                  valueSet.add(String(v));
                }
              }
              if (valueSet.size > 0) facets[field] = [...valueSet].sort((a, b) => a.localeCompare(b));
            }
          }
          if (Object.keys(facets).length > 0) cached.facets = facets;
        }
        this.memoryCache.set(name, {
          data: cached,
          expires: Date.now() + ttl * 60 * 60 * 1000,
        });
        this.scheduleExternalImages(name, config, cached.items);
        return { ...cached, from_cache: true };
      }
    }

    let rawItems: unknown[];

    if (config.source.type === "api") {
      if (!config.source.api) throw new Error("API source config missing");
      rawItems = await fetchFromApi(config.source.api, name);
    } else if (config.source.type === "local") {
      if (!config.source.local) throw new Error("Local source config missing");
      rawItems = await withFetchJobState(name, () =>
        fetchFromLocal(name, config.source.local!, this.dbDir),
      );
    } else if (config.source.type === "remote") {
      if (!config.source.remote) throw new Error("Remote source config missing");
      rawItems = await withFetchJobState(name, () =>
        fetchFromRemote(config.source.remote!),
      );
    } else {
      throw new Error(`Unsupported source type: ${config.source.type}`);
    }

    const fetchedAt = new Date().toISOString();

    const rawEntry: CacheEntry = {
      fetched_at: fetchedAt,
      items: rawItems as Record<string, unknown>[],
      raw_count: rawItems.length,
    };
    this.cache.write(name, rawEntry, true);

    let items = config.field_mapping
      ? rawItems.map((item) =>
          applyFieldMapping(
            item as Record<string, unknown>,
            config.field_mapping!
          )
        )
      : (rawItems as Record<string, unknown>[]);

    const overridesFile = this.loadOverridesFile(name);
    if (overridesFile && Object.keys(overridesFile.entries).length > 0) {
      items = this.applyOverridesToItems(items, overridesFile.lookup_key, overridesFile.entries);
      log.info(`[DatabaseManager] Applied persistent overrides to ${name} (${Object.keys(overridesFile.entries).length} slug(s))`);
    }

    // Compute facets: distinct sorted values per tag/select editor field
    const facets: Record<string, string[]> = {};
    if (config.editor) {
      for (const [field, hint] of Object.entries(config.editor)) {
        if (hint.type === "tags" || hint.type === "select") {
          const valueSet = new Set<string>();
          const splitComma = hint.split_comma_values === true;
          for (const item of items) {
            for (const token of expandEditorFieldTokens(item[field], { splitComma })) {
              valueSet.add(token);
            }
          }
          if (valueSet.size > 0) {
            facets[field] = [...valueSet].sort((a, b) => a.localeCompare(b));
          }
        }
      }
    }

    const entry: CacheEntry = {
      fetched_at: fetchedAt,
      items,
      raw_count: rawItems.length,
      ...(Object.keys(facets).length > 0 ? { facets } : {}),
    };

    this.cache.write(name, entry);
    this.memoryCache.set(name, {
      data: entry,
      expires: Date.now() + ttl * 60 * 60 * 1000,
    });

    this.scheduleExternalImages(name, config, items);

    const vsConfig = (config as DatabaseConfig).vector_search;
    if (vsConfig?.enabled && vsConfig.fields?.length > 0) {
      import("./vector-search").then(({ indexItems }) => {
        indexItems(name, items, vsConfig.fields).catch((err) => {
          log.error({ err: err }, `[DatabaseManager] Background vector indexing failed for "${name}":`);
        });
      }).catch((err) => {
        log.error({ err: err }, `[DatabaseManager] Failed to import vector-search module:`);
      });
    }

    return { ...entry, from_cache: false };
  }

  async warmup(): Promise<void> {
    const names = Array.from(this.configs.keys());
    if (names.length === 0) return;

    const toWarm = names.filter((name) => {
      const config = this.configs.get(name)!;
      const ttl = config.cache?.ttl_hours ?? 24;
      return !this.cache.has(name, ttl);
    });

    if (toWarm.length === 0) {
      log.info(`[DatabaseManager] Warmup: all ${names.length} database(s) already cached`);
      return;
    }

    log.info(`[DatabaseManager] Warmup: pre-fetching ${toWarm.length} database(s): ${toWarm.join(", ")}`);

    for (const name of toWarm) {
      try {
        await this.fetchItems(name);
        log.info(`[DatabaseManager] Warmup: "${name}" cached successfully`);
      } catch (err) {
        log.error({ err: err }, `[DatabaseManager] Warmup: failed to fetch "${name}":`);
      }
    }

    log.info(`[DatabaseManager] Warmup complete`);
  }

  async test(
    sourceConfig: DatabaseConfig["source"],
    dbSlug?: string
  ): Promise<{
    success: boolean;
    item_count?: number;
    samples?: unknown[];
    error?: string;
  }> {
    try {
      let items: unknown[];
      if (sourceConfig.type === "api") {
        if (!sourceConfig.api) throw new Error("API config missing");
        items = await fetchFromApi(sourceConfig.api);
      } else if (sourceConfig.type === "local") {
        if (!sourceConfig.local) throw new Error("Local source config missing");
        if (!dbSlug) throw new Error("Database slug required for local source testing");
        items = await fetchFromLocal(dbSlug, sourceConfig.local, this.dbDir);
      } else if (sourceConfig.type === "remote") {
        if (!sourceConfig.remote) throw new Error("Remote source config missing");
        items = await fetchFromRemote(sourceConfig.remote);
      } else {
        return {
          success: false,
          error: `Unsupported source type: ${sourceConfig.type}`,
        };
      }
      return {
        success: true,
        item_count: items.length,
        samples: items.slice(0, 5) as Record<string, unknown>[],
      };
    } catch (err: unknown) {
      return {
        success: false,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }

  private writeToDisk(name: string, config: DatabaseConfig): void {
    const configPath = path.join(this.dbDir, name, "config.yml");
    const dir = path.dirname(configPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(configPath, yaml.dump(config, { lineWidth: 120 }));
  }

  getFieldCount(name: string): number {
    const config = this.configs.get(name);
    if (!config) return 0;

    const memEntry = this.memoryCache.get(name);
    const items = memEntry?.data?.items;
    if (items && items.length > 0) {
      const keys = new Set<string>();
      for (const item of items) {
        for (const k of Object.keys(item)) keys.add(k);
      }
      return keys.size;
    }

    const ttl = config.cache?.ttl_hours ?? 24;
    const cached = this.cache.read(name, ttl);
    if (cached && cached.items.length > 0) {
      const keys = new Set<string>();
      for (const item of cached.items) {
        for (const k of Object.keys(item)) keys.add(k);
      }
      return keys.size;
    }

    if (config.field_mapping) {
      return Object.keys(config.field_mapping).length;
    }
    return 0;
  }

  async fetchMappedItems(
    contentType: string,
    forceRefresh = false,
  ): Promise<Record<string, unknown>[]> {
    const ctConfig = getContentTypeConfig(contentType, this.contentRoot);
    if (!ctConfig?.database?.slug) {
      log.warn(`[DatabaseManager] No database configured for content type "${contentType}"`);
      return [];
    }

    const dbName = ctConfig.database.slug;
    if (!this.exists(dbName)) {
      log.warn(`[DatabaseManager] Database "${dbName}" not found for content type "${contentType}"`);
      return [];
    }

    try {
      const result = await this.fetchItems(dbName, forceRefresh);
      let rawItems = result.items;

      const dbConfig = this.get(dbName);
      if (dbConfig.editor) {
        const cacheFields = Object.entries(dbConfig.editor)
          .filter(([, hint]) => hint.cache_images === true)
          .map(([field]) => field);
        if (cacheFields.length > 0) {
          rawItems = rawItems.map((item) => {
            const updated = { ...item };
            for (const field of cacheFields) {
              const val = item[field];
              if (typeof val === "string" && val.startsWith("http")) {
                const resolved = resolveBySourceUrl(val);
                if (resolved) updated[field] = resolved;
              }
            }
            return updated;
          });
        }
      }

      const ctMapping = getFieldMapping(contentType, this.contentRoot);
      const fullMapping = getFullFieldMapping(contentType, this.contentRoot);
      if ((!ctMapping || Object.keys(ctMapping).length === 0) && !fullMapping?.[RESERVED_IMAGE_FIELD] && !fullMapping?.[RESERVED_SLUG_FIELD]) {
        return rawItems;
      }
      return applyContentTypeMapping(rawItems, ctMapping || {}, contentType, fullMapping);
    } catch (err) {
      log.error({ err: err }, `[DatabaseManager] Failed to fetch mapped items for "${contentType}":`);
      return [];
    }
  }

  getCacheInfo(name: string): { fetched_at: string; item_count: number } | null {
    const memEntry = this.memoryCache.get(name);
    if (memEntry && Date.now() < memEntry.expires) {
      return {
        fetched_at: memEntry.data.fetched_at,
        item_count: memEntry.data.items.length,
      };
    }

    const config = this.configs.get(name);
    if (!config) return null;
    const ttl = config.cache?.ttl_hours ?? 24;
    const cached = this.cache.read(name, ttl);
    if (cached) {
      return {
        fetched_at: cached.fetched_at,
        item_count: cached.items.length,
      };
    }
    return null;
  }

  countTransformErrors(name: string): number {
    const config = this.configs.get(name);
    if (!config) return 0;
    const ttl = config.cache?.ttl_hours ?? 24;
    const cached = this.cache.read(name, ttl);
    if (!cached) return 0;
    return countTransformErrorsInItems(cached.items);
  }

  getCacheStats(): import("./db-cache").CacheStats {
    return this.cache.getCacheStats();
  }

  getRawItems(name: string): Record<string, unknown>[] | null {
    const config = this.configs.get(name);
    if (!config) return null;
    const ttl = config.cache?.ttl_hours ?? 24;
    const rawEntry = this.cache.read(name, ttl, true);
    if (rawEntry) return rawEntry.items;
    const mappedEntry = this.cache.read(name, ttl);
    if (mappedEntry) return mappedEntry.items;
    return null;
  }

  getMappedItems(name: string): Record<string, unknown>[] | null {
    const config = this.configs.get(name);
    if (!config) return null;
    const ttl = config.cache?.ttl_hours ?? 24;
    const mappedEntry = this.cache.read(name, ttl);
    if (mappedEntry) return mappedEntry.items;
    return null;
  }

  getOriginalMappedItem(
    name: string,
    slug: string,
    lookupKey: string,
  ): Record<string, unknown> | null {
    const rawItems = this.getRawItems(name);
    if (!rawItems) return null;
    const config = this.configs.get(name);
    const mappedItems = config?.field_mapping
      ? rawItems.map((item) =>
          applyFieldMapping(item as Record<string, unknown>, config.field_mapping!)
        )
      : (rawItems as Record<string, unknown>[]);
    return mappedItems.find((item) => String(item[lookupKey] ?? "") === slug) ?? null;
  }

  getRawFields(name: string): string[] {
    const rawItems = this.getRawItems(name);
    if (!rawItems || rawItems.length === 0) return [];
    const keys = new Set<string>();
    const sample = rawItems.slice(0, 5);
    for (const item of sample) {
      collectAllPaths(item, "", keys);
    }
    return Array.from(keys).sort();
  }

  clearCache(name: string): void {
    this.memoryCache.delete(name);
    this.cache.clear(name);
  }

  patchDbEntry(
    dbName: string,
    lookupKey: string,
    slugValue: string,
    mappedUpdates: Record<string, unknown>,
    fieldMapping: Record<string, string> | null = null,
    author?: string,
    contentRoot?: string
  ): boolean {
    try {
      applyEditorialStampToDbMappedUpdates(mappedUpdates, fieldMapping);
      const dbKeyedOverrides: Record<string, unknown> = {};
      for (const [templateKey, newValue] of Object.entries(mappedUpdates)) {
        const mappedPath = fieldMapping ? fieldMapping[templateKey] : undefined;
        const dbKey =
          mappedPath && typeof mappedPath === "string" && !mappedPath.startsWith("function:")
            ? mappedPath
            : templateKey;
        dbKeyedOverrides[dbKey] = newValue;
      }

      let patchedIdx = -1;

      const mappedEntry = this.cache.read(dbName, Infinity);
      if (mappedEntry) {
        const idx = mappedEntry.items.findIndex(
          (i) => String(i[lookupKey]) === String(slugValue)
        );
        if (idx !== -1) {
          patchedIdx = idx;
          Object.assign(mappedEntry.items[idx], dbKeyedOverrides);
          this.cache.write(dbName, mappedEntry, false);
        }
      }

      if (fieldMapping && patchedIdx !== -1) {
        const rawEntry = this.cache.read(dbName, Infinity, true);
        if (rawEntry && rawEntry.items[patchedIdx]) {
          for (const [templateKey, newValue] of Object.entries(mappedUpdates)) {
            const rawPath = fieldMapping[templateKey];
            if (rawPath) {
              setValueByPath(
                rawEntry.items[patchedIdx] as Record<string, unknown>,
                rawPath,
                newValue
              );
            }
          }
          this.cache.write(dbName, rawEntry, true);
        }
      }

      const overridesFile = this.loadOverridesFile(dbName) ?? {
        lookup_key: lookupKey,
        entries: {},
      };
      overridesFile.lookup_key = lookupKey;
      overridesFile.entries[slugValue] = {
        ...(overridesFile.entries[slugValue] ?? {}),
        ...dbKeyedOverrides,
      };
      this.saveOverridesFile(dbName, overridesFile);
      markFileAsModified(path.relative(process.cwd(), path.join(this.dbDir, dbName, "overrides.json")), author);

      this.memoryCache.delete(dbName);
      return patchedIdx !== -1;
    } catch {
      return false;
    }
  }

  getDbOverridesForEntry(
    dbName: string,
    slugValue: string
  ): Record<string, unknown> | null {
    try {
      this.validateName(dbName);
      const overridesFile = this.loadOverridesFile(dbName);
      if (!overridesFile) return null;
      const entryOverrides = overridesFile.entries[slugValue];
      if (!entryOverrides || Object.keys(entryOverrides).length === 0) return null;
      return { ...entryOverrides };
    } catch {
      return null;
    }
  }

  listOverrides(dbName: string): { slug: string; fields: Record<string, unknown> }[] {
    const overridesFile = this.loadOverridesFile(dbName);
    if (!overridesFile) return [];
    return Object.entries(overridesFile.entries).map(([slug, fields]) => ({ slug, fields }));
  }

  clearDbOverride(
    dbName: string,
    slugValue: string,
    fieldKey?: string,
    author?: string,
    contentRoot?: string
  ): boolean {
    try {
      this.validateName(dbName);
      const overridesFile = this.loadOverridesFile(dbName);
      if (!overridesFile) return false;

      if (fieldKey !== undefined) {
        if (!overridesFile.entries[slugValue]) return false;
        delete overridesFile.entries[slugValue][fieldKey];
        if (Object.keys(overridesFile.entries[slugValue]).length === 0) {
          delete overridesFile.entries[slugValue];
        }
      } else {
        if (!overridesFile.entries[slugValue]) return false;
        delete overridesFile.entries[slugValue];
      }

      this.saveOverridesFile(dbName, overridesFile);
      markFileAsModified(path.relative(process.cwd(), path.join(this.dbDir, dbName, "overrides.json")), author);

      this.memoryCache.delete(dbName);
      this.cache.clear(dbName);

      return true;
    } catch {
      return false;
    }
  }

  /** Sync read of cached mapped items for seo-index rebuild (empty when cache is cold). */
  getMappedItemsFromCacheSync(contentType: string): Record<string, unknown>[] {
    const ctConfig = getContentTypeConfig(contentType, this.contentRoot);
    if (!ctConfig?.database?.slug) return [];
    const dbName = ctConfig.database.slug;
    if (!this.exists(dbName)) return [];

    const memEntry = this.memoryCache.get(dbName);
    let rawItems: Record<string, unknown>[] | undefined = memEntry?.data?.items as
      | Record<string, unknown>[]
      | undefined;
    if (!rawItems?.length) {
      const cached = this.cache.read(dbName, Infinity);
      rawItems = cached?.items as Record<string, unknown>[] | undefined;
    }
    if (!rawItems?.length) return [];

    const ctMapping = getFieldMapping(contentType, this.contentRoot);
    const fullMapping = getFullFieldMapping(contentType, this.contentRoot);
    if (
      (!ctMapping || Object.keys(ctMapping).length === 0) &&
      !fullMapping?.[RESERVED_IMAGE_FIELD] &&
      !fullMapping?.[RESERVED_SLUG_FIELD]
    ) {
      return rawItems;
    }
    return applyContentTypeMapping(rawItems, ctMapping || {}, contentType, fullMapping);
  }
}

/** Cached mapped row count for a database (0 when configured but not yet fetched). */
export function getCachedDatabaseEntryCount(dbm: DatabaseManager, dbName: string): number {
  if (!dbName) return 0;
  const stats = dbm.getCacheStats().perDb[dbName];
  if (stats) return stats.item_count;
  if (!dbm.exists(dbName)) return 0;
  return dbm.getMappedItems(dbName)?.length ?? 0;
}

export const databaseManager = new DatabaseManager();
