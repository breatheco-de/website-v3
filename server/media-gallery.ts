import * as fs from "fs";
import * as path from "path";
import * as crypto from "crypto";
import * as yaml from "js-yaml";
import sharp from "sharp";
import { escapeTemplateVars, unescapeObjectVars } from "../shared/templateVars";
import { entryBagFieldPathFromVarName } from "@shared/entryTemplateVars";
import type { ImageRegistry, ImageEntry } from "@shared/schema";
import {
  MEDIA_EXTENSIONS,
  defaultAltForDoctype,
  extensionFromPath,
  inferDoctypeFromFilename,
  inferDoctypeFromSrc,
} from "@shared/media-doctype";
import { media, GCSProvider, createSiteGCSProvider } from "./media";
import type { StorageProvider } from "./media/types";
import { markFileAsModified } from "./sync-state";
import { processImageBuffer } from "./image-optimizer";
import type { Preset } from "./image-optimizer";
import { getImageQueueState, type ImageQueueState } from "./image-queue-state";
import { getDefaultContentFolder } from "./site-config";
import { child } from "./logger";
const log = child({ module: "media-gallery" });

const OPTIMIZABLE_EXTENSIONS = new Set([".png", ".jpg", ".jpeg", ".webp", ".avif"]);
const SCREENSHOT_PATTERNS = [/^Screenshot_/i, /^Captura_/i, /^Capture_/i, /^Screen[\s_]?Shot/i];
const EXISTENCE_CACHE_TTL_MS = 24 * 60 * 60 * 1000;

export interface ScanNewImage {
  id: string;
  src: string;
  filename: string;
}

export interface ScanUpdatedImage {
  id: string;
  oldSrc: string;
  newSrc: string;
}

export interface BrokenReference {
  yamlFile: string;
  field: string;
  missingSrc: string;
}

export interface DuplicateGroup {
  hash: string;
  ids: string[];
  canonical: string;
}

export interface ScanResult {
  newImages: ScanNewImage[];
  updatedImages: ScanUpdatedImage[];
  brokenReferences: BrokenReference[];
  duplicates: DuplicateGroup[];
  hashesComputed: number;
  registeredCount: number;
  scannedImagesCount: number;
  summary: {
    new: number;
    updated: number;
    broken: number;
    duplicates: number;
  };
}

interface ExistenceCache {
  exists: boolean;
  checkedAt: number;
}

function filenameToId(filename: string): string {
  const name = path.parse(filename).name;
  return name
    .replace(/[_\s]+/g, "-")
    .replace(/[^a-zA-Z0-9-]/g, "")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .toLowerCase();
}

function getIdBase(filename: string): string {
  const name = path.parse(filename).name;
  const withoutTimestamp = name.replace(/_\d{13,}$/, "");
  return withoutTimestamp
    .replace(/[_\s]+/g, "-")
    .replace(/[^a-zA-Z0-9-]/g, "")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .toLowerCase();
}

function extractTimestamp(filename: string): number {
  const name = path.parse(filename).name;
  const match = name.match(/_(\d{13,})$/);
  return match ? parseInt(match[1], 10) : 0;
}

function isScreenshot(filename: string): boolean {
  return SCREENSHOT_PATTERNS.some(pattern => pattern.test(filename));
}

export interface ImageRefLocation {
  yamlFile: string;
  contentType: string;
  slug: string;
  locale: string;
  sectionIndex: number;
  sectionType: string;
  sectionId?: string;
}

export interface ImageReferenceScan {
  imageIds: Set<string>;
  srcValues: Set<string>;
  byRef: Map<string, Set<string>>;
  imageIdLocations: Map<string, ImageRefLocation[]>;
}

export class MediaGallery {
  private readonly contentFolderName: string;
  private readonly contentDir: string;
  private readonly imagesDir: string;
  private readonly imagesUrlPrefix: string;
  private readonly registryPath: string;

  private registryCache: ImageRegistry | null = null;
  private lastModified: number = 0;
  private existenceCache: Map<string, ExistenceCache> = new Map();
  private imageRefCache: ImageReferenceScan | null = null;

  /**
   * Per-site GCS provider scoped to `{contentFolderName}/{GCS_BASE_PATH|media}/`.
   * `undefined` = not yet resolved; `null` = GCS unavailable for this site.
   */
  private _siteGCSProvider: GCSProvider | null | undefined = undefined;

  constructor(contentFolder?: string) {
    this.contentFolderName = contentFolder || process.env.CONTENT_FOLDER || getDefaultContentFolder();
    this.contentDir = path.isAbsolute(this.contentFolderName)
      ? this.contentFolderName
      : path.join(process.cwd(), this.contentFolderName);
    this.imagesDir = path.join(this.contentDir, "images");
    this.imagesUrlPrefix = `/${path.relative(process.cwd(), this.contentDir)}/images/`;
    this.registryPath = path.join(this.contentDir, "image-registry.json");
    // Do NOT initialize siteGCSProvider here — GCS may not be initialized yet
    // at module-load time. It is resolved lazily on first use.
  }

  /**
   * Lazily resolves and caches the per-site GCS provider.
   * Calling `media.getDefaultProvider()` first ensures the global GCS client
   * has been initialized (via `media.ensureInit()` → `gcs.initFromEnv()`).
   */
  private getSiteGCSProvider(): GCSProvider | null {
    if (this._siteGCSProvider === undefined) {
      // Trigger media/gcs initialization if it hasn't happened yet.
      media.getDefaultProvider();
      this._siteGCSProvider = createSiteGCSProvider(this.contentFolderName);
    }
    return this._siteGCSProvider;
  }

  /**
   * Returns the storage provider that should be used for new uploads for this site.
   * Prefers the per-site GCS provider when GCS is available, otherwise falls back
   * to the local provider.
   */
  getDefaultStorageProvider(): import("./media/types").StorageProvider {
    const siteGCS = this.getSiteGCSProvider();
    if (siteGCS) return siteGCS;
    return media.getProvider("local") ?? media.getDefaultProvider();
  }

  /**
   * List all object keys currently stored under this site's GCS media prefix.
   * Returns an empty array when GCS is not available.
   */
  async listGCSObjects(): Promise<string[]> {
    const siteGCS = this.getSiteGCSProvider();
    if (!siteGCS) return [];
    return siteGCS.list();
  }

  /**
   * Delete a file by its public src URL, using the per-site GCS provider when
   * the URL belongs to this site's prefix. Falls back to the global media helper
   * for local files or legacy GCS URLs outside the site prefix.
   */
  private async deleteBySrc(src: string): Promise<void> {
    const siteGCS = this.getSiteGCSProvider();
    if (siteGCS && siteGCS.owns(src)) {
      const key = siteGCS.extractKey(src);
      if (key !== null) {
        return siteGCS.delete(key);
      }
    }
    return media.delete(src);
  }

  getContentDir(): string {
    return this.contentDir;
  }

  getRegistry(opts?: { silent?: boolean }): ImageRegistry | null {
    try {
      const stats = fs.statSync(this.registryPath);
      const currentModified = stats.mtimeMs;

      if (this.registryCache && currentModified === this.lastModified) {
        return this.registryCache;
      }

      const content = fs.readFileSync(this.registryPath, "utf8");
      const raw = JSON.parse(content) as ImageRegistry;

      // Migrate any legacy failed_at / queued_at still present in the JSON
      const toMigrate: Record<string, { failed_at?: string; queued_at?: string }> = {};
      for (const [id, entry] of Object.entries(raw.images)) {
        const e = entry as ImageEntry & { failed_at?: string; queued_at?: string };
        if (e.failed_at || e.queued_at) {
          toMigrate[id] = {
            ...(e.failed_at ? { failed_at: e.failed_at } : {}),
            ...(e.queued_at ? { queued_at: e.queued_at } : {}),
          };
          delete e.failed_at;
          delete e.queued_at;
        }
      }
      if (Object.keys(toMigrate).length > 0) {
        getImageQueueState(this.contentDir).importMigrated(toMigrate);
        log.info(`[MediaGallery] Migrated queue state for ${Object.keys(toMigrate).length} entries to .image-queue-state.json`);
        // Write the cleaned registry back to disk immediately so the fields
        // are never committed to version control again.
        fs.writeFileSync(this.registryPath, JSON.stringify(raw, null, 2) + "\n", "utf8");
        markFileAsModified(`${this.contentFolderName}/image-registry.json`);
      }

      this.registryCache = raw;
      this.lastModified = fs.statSync(this.registryPath).mtimeMs;

      log.info(`[MediaGallery] Loaded ${Object.keys(this.registryCache.images).length} images, ${Object.keys(this.registryCache.presets).length} presets`);
      return this.registryCache;
    } catch (error) {
      const err = error as NodeJS.ErrnoException;
      if (!(opts?.silent && err?.code === "ENOENT")) {
        log.error({ err: error }, "[MediaGallery] Failed to load registry:");
      }
      return null;
    }
  }

  clearCache(): void {
    this.registryCache = null;
    this.lastModified = 0;
    this.imageRefCache = null;
  }

  collectImageReferences(): ImageReferenceScan {
    if (this.imageRefCache) return this.imageRefCache;

    const imageIds = new Set<string>();
    const srcValues = new Set<string>();
    const byRef = new Map<string, Set<string>>();
    const imageIdLocations = new Map<string, ImageRefLocation[]>();

    const addRef = (ref: string, filePath: string) => {
      if (!ref) return;
      const existing = byRef.get(ref);
      if (existing) {
        existing.add(filePath);
      } else {
        byRef.set(ref, new Set([filePath]));
      }
    };

    const addImageIdLocation = (imageId: string, loc: ImageRefLocation) => {
      const existing = imageIdLocations.get(imageId);
      if (existing) {
        existing.push(loc);
      } else {
        imageIdLocations.set(imageId, [loc]);
      }
    };

    const escapedPrefix = this.imagesUrlPrefix.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const URL_PATTERN = new RegExp(`(?:https?:\\/\\/[^\\s"']+|\\/attached_assets\\/[^\\s"']+|${escapedPrefix}[^\\s"']+)`, "g");
    const isLikelyRegistryId = (value: string): boolean =>
      /^[a-z0-9][a-z0-9-]{3,}$/.test(value) &&
      !value.includes("/") &&
      !value.includes(":") &&
      !value.includes(".");

    /** Last YAML key segment from keyPath like "sections[0].col3_image_id" → "col3_image_id" */
    const lastKeySegment = (keyPath: string): string => {
      const afterDot = keyPath.includes(".") ? keyPath.slice(keyPath.lastIndexOf(".") + 1) : keyPath;
      return afterDot.replace(/\[\d+\]$/, "");
    };

    const isRegistryImageIdKeyPath = (keyPath: string): boolean => {
      const seg = lastKeySegment(keyPath);
      return (
        seg === "image_id" ||
        seg === "imageId" ||
        /_image_id$/i.test(seg) ||
        /^[a-z][a-z0-9]*[Ii]mage[Ii]d$/.test(seg)
      );
    };

    const isLogoKeyPath = (keyPath: string): boolean => lastKeySegment(keyPath) === "logo";

    const extractRefs = (obj: unknown, keyPath: string, filePath: string): void => {
      if (obj === null || obj === undefined) return;
      if (typeof obj === "string") {
        if (
          isRegistryImageIdKeyPath(keyPath) ||
          isLogoKeyPath(keyPath) ||
          /\.avatars\[\d+\]$/.test(keyPath) ||
          /^avatars\[\d+\]$/.test(keyPath)
        ) {
          if (!isLogoKeyPath(keyPath) || isLikelyRegistryId(obj)) {
            imageIds.add(obj);
            addRef(obj, filePath);
          }
        }
        srcValues.add(obj);
        if (
          obj.startsWith("/attached_assets/") || obj.startsWith("attached_assets/") ||
          obj.startsWith(this.imagesUrlPrefix) || obj.startsWith(`${this.contentFolderName}/images/`) ||
          obj.startsWith("https://storage.googleapis.com/") ||
          obj.startsWith("http://") || obj.startsWith("https://")
        ) {
          addRef(obj, filePath);
        }
        if (obj.includes("\n")) {
          try {
            const nested = yaml.load(obj);
            if (nested && typeof nested === "object") {
              extractRefs(nested, keyPath, filePath);
              return;
            }
          } catch {}
          const urlMatches = obj.match(URL_PATTERN);
          if (urlMatches) {
            for (const url of urlMatches) {
              srcValues.add(url);
              addRef(url, filePath);
            }
          }
        }
        return;
      }
      if (Array.isArray(obj)) {
        obj.forEach((item, i) => extractRefs(item, `${keyPath}[${i}]`, filePath));
        return;
      }
      if (typeof obj === "object") {
        for (const [key, val] of Object.entries(obj as Record<string, unknown>)) {
          extractRefs(val, keyPath ? `${keyPath}.${key}` : key, filePath);
        }
      }
    };

    // Parse a YAML file's relative path into content type, slug and locale.
    // Expected pattern: {contentFolder}/{contentType}/{slug}/{locale}.yml
    const parseYamlFilePath = (relPath: string): { contentType: string; slug: string; locale: string } | null => {
      const match = relPath.match(new RegExp(`^${this.contentFolderName}\\/([^/]+)\\/([^/]+)\\/([^/.]+)\\.ya?ml$`));
      if (!match) return null;
      return { contentType: match[1], slug: match[2], locale: match[3] };
    };

    // Walk a single section object collecting every image_id key.
    const collectImageIdsInObj = (
      obj: unknown,
      sectionIndex: number,
      sectionType: string,
      relPath: string,
      meta: { contentType: string; slug: string; locale: string },
      sectionId?: string
    ): void => {
      if (!obj || typeof obj !== "object") return;
      if (Array.isArray(obj)) {
        obj.forEach(item => collectImageIdsInObj(item, sectionIndex, sectionType, relPath, meta, sectionId));
        return;
      }
      for (const [key, val] of Object.entries(obj as Record<string, unknown>)) {
        const isImageIdLikeKey =
          key === "image_id" ||
          key === "imageId" ||
          /_image_id$/i.test(key) ||
          /^[a-z][a-z0-9]*[Ii]mage[Ii]d$/.test(key);
        if ((isImageIdLikeKey || key === "logo") && typeof val === "string" && val) {
          if (key !== "logo" || isLikelyRegistryId(val)) {
          addImageIdLocation(val, {
            yamlFile: relPath,
            contentType: meta.contentType,
            slug: meta.slug,
            locale: meta.locale,
            sectionIndex,
            sectionType,
            sectionId,
          });
          }
        } else {
          collectImageIdsInObj(val, sectionIndex, sectionType, relPath, meta, sectionId);
        }
      }
    };

    const walkDir = (dir: string) => {
      if (!fs.existsSync(dir)) return;
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          walkDir(fullPath);
        } else if (entry.name.endsWith(".yml") || entry.name.endsWith(".yaml")) {
          try {
            const content = fs.readFileSync(fullPath, "utf8");
            const { escaped, map } = escapeTemplateVars(content);
            const rawParsed = yaml.load(escaped);
            const parsed = rawParsed ? unescapeObjectVars(rawParsed, map) : rawParsed;
            if (parsed && typeof parsed === "object") {
              const relPath = path.relative(process.cwd(), fullPath);
              extractRefs(parsed, "", relPath);

              // Additionally track per-section locations for image_id fields
              const meta = parseYamlFilePath(relPath);
              if (meta) {
                const sections = (parsed as Record<string, unknown>).sections;
                if (Array.isArray(sections)) {
                  sections.forEach((section: unknown, idx: number) => {
                    if (!section || typeof section !== "object") return;
                    const sec = section as Record<string, unknown>;
                    const sectionType = typeof sec.type === "string" ? String(sec.type) : "unknown";
                    const sectionId = typeof sec.section_id === "string" ? sec.section_id : undefined;
                    collectImageIdsInObj(section, idx, sectionType, relPath, meta, sectionId);
                  });
                }
              }
            }
          } catch {}
        }
      }
    };

    walkDir(this.contentDir);

    const IMAGE_ID_PATTERN = /["']([a-z0-9]+-[a-z0-9-]+-[a-f0-9]{6,8})["']/g;
    const scanSourceDir = (dir: string) => {
      if (!fs.existsSync(dir)) return;
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          if (entry.name === "node_modules" || entry.name === ".git") continue;
          scanSourceDir(fullPath);
        } else if (entry.name.endsWith(".ts") || entry.name.endsWith(".tsx")) {
          try {
            const content = fs.readFileSync(fullPath, "utf8");
            let match: RegExpExecArray | null;
            while ((match = IMAGE_ID_PATTERN.exec(content)) !== null) {
              const candidate = match[1];
              imageIds.add(candidate);
              const relPath = path.relative(process.cwd(), fullPath);
              addRef(candidate, relPath);
            }
          } catch {}
        }
      }
    };
    scanSourceDir(path.join(process.cwd(), "client", "src"));
    scanSourceDir(path.join(process.cwd(), "server"));
    scanSourceDir(path.join(process.cwd(), "shared"));

    this.imageRefCache = { imageIds, srcValues, byRef, imageIdLocations };
    return this.imageRefCache;
  }

  getImage(id: string): { src: string; alt: string } | null {
    const registry = this.getRegistry();
    if (!registry) return null;
    const entry = registry.images[id];
    if (!entry) return null;
    return { src: entry.src, alt: entry.alt };
  }

  getPreset(name: string): any | null {
    const registry = this.getRegistry();
    if (!registry) return null;
    return registry.presets[name] || null;
  }

  listImages() {
    const registry = this.getRegistry();
    if (!registry) return [];
    return Object.entries(registry.images).map(([id, entry]) => ({ id, ...entry }));
  }

  listPresets() {
    const registry = this.getRegistry();
    if (!registry) return [];
    return Object.entries(registry.presets).map(([name, preset]) => ({ name, ...preset }));
  }

  getUsage(imageId: string, imageSrc?: string, srcsetUrls?: string[]): string[] {
    const refs = this.collectImageReferences();
    const files = new Set<string>();
    const byId = refs.byRef.get(imageId);
    if (byId) byId.forEach(f => files.add(f));
    if (imageSrc) {
      const bySrc = refs.byRef.get(imageSrc);
      if (bySrc) bySrc.forEach(f => files.add(f));
    }
    if (srcsetUrls) {
      for (const url of srcsetUrls) {
        const bySrcset = refs.byRef.get(url);
        if (bySrcset) bySrcset.forEach(f => files.add(f));
      }
    }
    return Array.from(files);
  }

  clearImageRefCache(): void {
    this.imageRefCache = null;
  }

  getFamilyUsage(ids: string[]): Array<{
    filePath: string; slug: string; contentType: string; locale: string;
    sectionIndex: number; sectionType: string; sectionId?: string; currentSrc: string; currentId: string;
    title?: string; isNoindex: boolean;
  }> {
    const registry = this.getRegistry();
    if (!registry || !ids.length) return [];

    const refs = this.collectImageReferences();
    const results: Array<{
      filePath: string; slug: string; contentType: string; locale: string;
      sectionIndex: number; sectionType: string; sectionId?: string; currentSrc: string; currentId: string;
    }> = [];
    const seen = new Set<string>();

    const parseYamlPath = (fp: string) => {
      const m = fp.match(new RegExp(`^${this.contentFolderName}\\/([^/]+)\\/([^/]+)\\/([^/.]+)\\.ya?ml$`));
      return m ? { contentType: m[1], slug: m[2], locale: m[3] } : null;
    };

    for (const id of ids) {
      const entry = registry.images[id];
      if (!entry) continue;

      // 1. Use imageIdLocations for section-level info (image_id field references)
      const locations = refs.imageIdLocations.get(id) ?? [];
      for (const loc of locations) {
        const key = `${loc.yamlFile}::${loc.sectionIndex}::${id}`;
        if (seen.has(key)) continue;
        seen.add(key);
        results.push({
          filePath: loc.yamlFile, slug: loc.slug, contentType: loc.contentType,
          locale: loc.locale, sectionIndex: loc.sectionIndex, sectionType: loc.sectionType,
          sectionId: loc.sectionId,
          currentSrc: entry.src, currentId: id,
        });
      }

      // 2. Handle src-based references not already captured by imageIdLocations
      const allFiles = new Set<string>();
      (refs.byRef.get(entry.src) ?? new Set()).forEach(f => allFiles.add(f));
      (refs.byRef.get(id) ?? new Set()).forEach(f => allFiles.add(f));

      for (const filePath of allFiles) {
        if (!filePath.endsWith(".yml") && !filePath.endsWith(".yaml")) continue;
        const meta = parseYamlPath(filePath);
        if (!meta) continue;
        // skip if all sections already covered by imageIdLocations
        if (locations.some(loc => loc.yamlFile === filePath)) continue;

        try {
          const fullPath = path.join(process.cwd(), filePath);
          const content = fs.readFileSync(fullPath, "utf8");
          const { escaped, map } = escapeTemplateVars(content);
          const parsed = unescapeObjectVars(yaml.load(escaped) as object, map) as Record<string, unknown>;
          if (!parsed) continue;

          const sections = parsed.sections;
          if (Array.isArray(sections)) {
            let foundInSection = false;
            (sections as unknown[]).forEach((section: unknown, idx: number) => {
              const sectionStr = JSON.stringify(section);
              if (!sectionStr.includes(entry.src) && !sectionStr.includes(id)) return;
              const key = `${filePath}::${idx}::${id}`;
              if (seen.has(key)) return;
              seen.add(key);
              foundInSection = true;
              results.push({
                filePath, ...meta, sectionIndex: idx,
                sectionType: (typeof (section as Record<string, unknown>)?.type === "string"
                  ? String((section as Record<string, unknown>).type) : "unknown"),
                currentSrc: entry.src, currentId: id,
              });
            });
            if (!foundInSection) {
              const key = `${filePath}::-1::${id}`;
              if (!seen.has(key)) {
                seen.add(key);
                results.push({ filePath, ...meta, sectionIndex: -1, sectionType: "unknown", currentSrc: entry.src, currentId: id });
              }
            }
          } else {
            const key = `${filePath}::-1::${id}`;
            if (!seen.has(key)) {
              seen.add(key);
              results.push({ filePath, ...meta, sectionIndex: -1, sectionType: "unknown", currentSrc: entry.src, currentId: id });
            }
          }
        } catch {}
      }
    }

    // Enrich results with page title and noindex flag (read each unique file once)
    const titleByFile = new Map<string, string | undefined>();
    const noindexByFile = new Map<string, boolean>();
    const uniqueFiles = [...new Set(results.map(r => r.filePath))];
    for (const fp of uniqueFiles) {
      try {
        const fullPath = path.join(process.cwd(), fp);
        const content = fs.readFileSync(fullPath, "utf8");
        const { escaped, map } = escapeTemplateVars(content);
        const parsed = unescapeObjectVars(yaml.load(escaped) as object, map) as Record<string, unknown>;
        const metaObj = parsed?.meta as Record<string, unknown> | undefined;
        const t = (metaObj?.title ?? parsed?.title) as string | undefined;
        titleByFile.set(fp, typeof t === "string" && t ? t : undefined);
        const robotsStr = ((metaObj?.robots ?? parsed?.robots) as string | undefined) ?? "";
        noindexByFile.set(fp, robotsStr.toLowerCase().includes("noindex"));
      } catch {
        titleByFile.set(fp, undefined);
        noindexByFile.set(fp, false);
      }
    }

    return results.map(r => ({
      ...r,
      title: titleByFile.get(r.filePath),
      isNoindex: noindexByFile.get(r.filePath) ?? false,
    }));
  }

  /**
   * Given a variable name like "single.image", look up the content type and DB field
   * in content-types.yml. Returns { dbSlug, dbField } or null if not found.
   */
  private resolveContentTypeField(variableName: string): { dbSlug: string; dbField: string } | null {
    try {
      const contentTypesPath = path.join(this.contentDir, "content-types.yml");
      if (!fs.existsSync(contentTypesPath)) return null;
      const raw = yaml.load(fs.readFileSync(contentTypesPath, "utf8")) as Record<string, any>;
      // variableName is like "entry.image" (or legacy "single.image")
      const fieldKey = entryBagFieldPathFromVarName(variableName) ?? variableName;
      for (const [, ctDef] of Object.entries(raw)) {
        if (!ctDef || typeof ctDef !== "object") continue;
        const dbSlug = ctDef.database?.slug as string | undefined;
        if (!dbSlug) continue;
        const fieldMapping = ctDef.field_mapping as Record<string, string> | undefined;
        if (!fieldMapping) continue;
        if (Object.prototype.hasOwnProperty.call(fieldMapping, fieldKey)) {
          const dbField = fieldMapping[fieldKey];
          return { dbSlug, dbField };
        }
      }
    } catch {}
    return null;
  }

  /**
   * Ensure `cache_images: true` is set on a DB field in its config.yml.
   * Returns true if the flag is already set or was successfully enabled.
   */
  private ensureCacheImagesEnabled(dbSlug: string, dbField: string): boolean {
    try {
      const configPath = path.join(this.contentDir, "db", dbSlug, "config.yml");
      if (!fs.existsSync(configPath)) return false;
      const raw = yaml.load(fs.readFileSync(configPath, "utf8")) as Record<string, any>;
      if (!raw || typeof raw !== "object") return false;
      if (!raw.editor || typeof raw.editor !== "object") raw.editor = {};
      if (!raw.editor[dbField] || typeof raw.editor[dbField] !== "object") raw.editor[dbField] = {};
      if (raw.editor[dbField].cache_images === true) {
        if (raw.editor[dbField].type !== "image") {
          raw.editor[dbField].type = "image";
          fs.writeFileSync(configPath, yaml.dump(raw, { lineWidth: -1 }), "utf8");
          markFileAsModified(`${this.contentFolderName}/db/${dbSlug}/config.yml`);
        }
        return true;
      }
      raw.editor[dbField].cache_images = true;
      raw.editor[dbField].type = "image";
      fs.writeFileSync(configPath, yaml.dump(raw, { lineWidth: -1 }), "utf8");
      markFileAsModified(`${this.contentFolderName}/db/${dbSlug}/config.yml`);
      return true;
    } catch {}
    return false;
  }

  /**
   * Update the image-registry.json entry whose src or source_url matches fromSrc,
   * setting its src to toSrc. Returns true if the registry was updated.
   */
  private updateRegistrySrc(fromSrc: string, toSrc: string): boolean {
    try {
      const registry = this.getRegistry();
      if (!registry) return false;
      let updated = false;
      for (const entry of Object.values(registry.images)) {
        if (entry.src === fromSrc || entry.source_url === fromSrc) {
          entry.src = toSrc;
          updated = true;
        }
      }
      if (updated) {
        fs.writeFileSync(this.registryPath, JSON.stringify(registry, null, 2) + "\n", "utf8");
        markFileAsModified(`${this.contentFolderName}/image-registry.json`);
        this.registryCache = null;
        this.lastModified = 0;
      }
      return updated;
    } catch {}
    return false;
  }

  bulkReplaceUsage(
    fileReplacements: Array<{ filePath: string; fromId: string; fromSrc: string; toId: string; toSrc: string }>
  ): { filesUpdated: number; files: string[] } {
    if (!fileReplacements.length) return { filesUpdated: 0, files: [] };

    // Group replacements by filePath so each file is written only once
    const byFile = new Map<string, Array<{ fromId: string; fromSrc: string; toId: string; toSrc: string }>>();
    for (const r of fileReplacements) {
      if (!r.filePath || !r.fromId || !r.toId || r.fromId === r.toId) continue;
      const list = byFile.get(r.filePath) ?? [];
      list.push(r);
      byFile.set(r.filePath, list);
    }

    const updatedFiles: string[] = [];
    for (const [relPath, pairs] of byFile) {
      try {
        const fullPath = path.join(process.cwd(), relPath);
        if (!fs.existsSync(fullPath)) continue;
        let content = fs.readFileSync(fullPath, "utf8");
        let changed = false;
        for (const { fromId, fromSrc, toId, toSrc } of pairs) {
          if (fromSrc && toSrc && fromSrc !== toSrc && content.includes(fromSrc)) {
            // For each occurrence of fromSrc, determine whether it is inside a {{ ... }}
            // placeholder expression. Placeholder occurrences → registry update only.
            // Non-placeholder occurrences → normal text substitution.
            const escapedSrc = fromSrc.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
            const srcPattern = new RegExp(escapedSrc, 'g');
            let hasPlaceholderOccurrence = false;
            let firstPlaceholderVarName: string | null = null;
            const newContent = content.replace(srcPattern, (match, offset) => {
              // Find the last {{ that appears at or before this offset
              const openIdx = content.lastIndexOf('{{', offset);
              if (openIdx === -1) return toSrc; // not inside {{ }}
              // Find the }} that closes that {{ block — it must end at or after our match
              const closeIdx = content.indexOf('}}', openIdx + 2);
              if (closeIdx === -1 || closeIdx < offset + match.length) return toSrc;
              // This occurrence is inside a {{ ... }} placeholder
              if (!hasPlaceholderOccurrence) {
                // Extract the variable name once: "single.image" from "{{ single.image | https://... }}"
                const inner = content.slice(openIdx + 2, closeIdx).trim();
                firstPlaceholderVarName = inner.split('|')[0].trim();
              }
              hasPlaceholderOccurrence = true;
              return match; // preserve the placeholder — do not replace in YAML
            });
            if (newContent !== content) {
              content = newContent;
              changed = true;
            }
            if (hasPlaceholderOccurrence) {
              // Resolve content type/field and confirm cache_images is (or can be) enabled
              const resolved = firstPlaceholderVarName
                ? this.resolveContentTypeField(firstPlaceholderVarName)
                : null;
              const cacheEnabled = resolved
                ? this.ensureCacheImagesEnabled(resolved.dbSlug, resolved.dbField)
                : false;
              // Only update the registry if we confirmed cache_images is enabled
              if (cacheEnabled) {
                this.updateRegistrySrc(fromSrc, toSrc);
              }
            }
          }
          // Replace bare ID references (e.g. image_id: field) only when the ID is not followed
          // by characters that would indicate it's part of a longer ID or URL path (-_alphanum)
          if (fromId !== toId) {
            const idPattern = new RegExp(fromId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '(?![a-zA-Z0-9_-])', 'g');
            const newContent = content.replace(idPattern, toId);
            if (newContent !== content) {
              content = newContent;
              changed = true;
            }
          }
        }
        if (changed) {
          fs.writeFileSync(fullPath, content, "utf8");
          markFileAsModified(relPath);
          updatedFiles.push(relPath);
        }
      } catch {}
    }

    this.imageRefCache = null;
    return { filesUpdated: updatedFiles.length, files: updatedFiles };
  }

  private async checkExists(src: string): Promise<boolean> {
    const cached = this.existenceCache.get(src);
    const now = Date.now();
    if (cached && (now - cached.checkedAt) < EXISTENCE_CACHE_TTL_MS) {
      return cached.exists;
    }

    const exists = await media.exists(src);
    this.existenceCache.set(src, { exists, checkedAt: now });
    return exists;
  }

  private scanLocalImageDirectory(baseDir: string, urlPrefix: string, skipScreenshots: boolean): Map<string, string> {
    const imageFiles = new Map<string, string>();
    if (!fs.existsSync(baseDir)) return imageFiles;

    function walkDir(dir: string, prefix: string) {
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.isDirectory()) {
          walkDir(path.join(dir, entry.name), `${prefix}${entry.name}/`);
        } else {
          if (skipScreenshots && isScreenshot(entry.name)) continue;
          const ext = path.extname(entry.name).toLowerCase();
          if (MEDIA_EXTENSIONS.has(ext)) {
            const relPath = `${prefix}${entry.name}`;
            imageFiles.set(relPath, `${urlPrefix}${relPath}`);
          }
        }
      }
    }

    walkDir(baseDir, "");
    return imageFiles;
  }

  private scanAllLocalImages(): Map<string, string> {
    const attachedAssets = this.scanLocalImageDirectory(
      path.join(process.cwd(), "attached_assets"), "/attached_assets/", true
    );
    const marketingImages = this.scanLocalImageDirectory(this.imagesDir, this.imagesUrlPrefix, false);
    const combined = new Map<string, string>();
    attachedAssets.forEach((src, key) => combined.set(key, src));
    marketingImages.forEach((src, key) => combined.set(key, src));
    return combined;
  }

  private findImageRefsInValue(
    value: any,
    currentPath: string,
    results: Array<{ field: string; src: string }>
  ): void {
    if (typeof value === "string") {
      if (value.startsWith("/attached_assets/") || value.startsWith("attached_assets/") ||
          value.startsWith(this.imagesUrlPrefix) || value.startsWith(`${this.contentFolderName}/images/`) ||
          value.startsWith("https://storage.googleapis.com/")) {
        results.push({ field: currentPath, src: value });
      }
    } else if (Array.isArray(value)) {
      value.forEach((item, index) => {
        this.findImageRefsInValue(item, `${currentPath}[${index}]`, results);
      });
    } else if (value && typeof value === "object") {
      for (const [key, val] of Object.entries(value)) {
        this.findImageRefsInValue(val, currentPath ? `${currentPath}.${key}` : key, results);
      }
    }
  }

  private scanYamlFiles(): Array<{ yamlFile: string; field: string; src: string }> {
    const refs: Array<{ yamlFile: string; field: string; src: string }> = [];

    const walkDir = (dir: string) => {
      if (!fs.existsSync(dir)) return;
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          walkDir(fullPath);
        } else if (entry.name.endsWith(".yml") || entry.name.endsWith(".yaml")) {
          try {
            const content = fs.readFileSync(fullPath, "utf8");
            const { escaped, map } = escapeTemplateVars(content);
            const rawParsed = yaml.load(escaped);
            const parsed = rawParsed ? unescapeObjectVars(rawParsed, map) : rawParsed;
            if (parsed && typeof parsed === "object") {
              const fileRefs: Array<{ field: string; src: string }> = [];
              this.findImageRefsInValue(parsed, "", fileRefs);
              const relPath = path.relative(process.cwd(), fullPath);
              for (const ref of fileRefs) {
                refs.push({ yamlFile: relPath, field: ref.field, src: ref.src });
              }
            }
          } catch {
            // skip unparseable YAML
          }
        }
      }
    };

    walkDir(this.contentDir);
    return refs;
  }

  private computeFileHash(filePath: string): string | null {
    try {
      const data = fs.readFileSync(filePath);
      return crypto.createHash("sha256").update(data).digest("hex");
    } catch {
      return null;
    }
  }

  computeBufferHash(data: Buffer): string {
    return crypto.createHash("sha256").update(data).digest("hex");
  }

  private resolveLocalPath(src: string): string | null {
    const normalizedSrc = src.startsWith("/") ? src : `/${src}`;
    const diskPath = path.join(process.cwd(), normalizedSrc);
    if (fs.existsSync(diskPath)) return diskPath;
    return null;
  }

  findByHash(hash: string): { id: string; entry: ImageEntry } | null {
    const registry = this.getRegistry();
    if (!registry) return null;
    for (const [id, entry] of Object.entries(registry.images)) {
      if (entry.hash === hash) return { id, entry };
    }
    return null;
  }

  async scan(): Promise<ScanResult> {
    const registry = this.getRegistry() || { presets: {}, images: {} };
    const allImages = this.scanAllLocalImages();
    const marketingOnly = this.scanLocalImageDirectory(this.imagesDir, this.imagesUrlPrefix, false);
    const yamlRefs = this.scanYamlFiles();

    const existingSrcSet = new Set<string>();
    const existingIdByBase = new Map<string, { id: string; src: string } | null>();

    for (const [id, entry] of Object.entries(registry.images)) {
      existingSrcSet.add(entry.src);
      const filename = entry.src.split("/").pop() || "";
      const base = getIdBase(filename);
      if (base) {
        if (existingIdByBase.has(base)) {
          existingIdByBase.set(base, null);
        } else {
          existingIdByBase.set(base, { id, src: entry.src });
        }
      }
    }

    const newImages: ScanNewImage[] = [];
    const updatedImages: ScanUpdatedImage[] = [];

    marketingOnly.forEach((src, filename) => {
      if (existingSrcSet.has(src)) return;

      const base = getIdBase(filename);
      const existing = existingIdByBase.get(base) ?? undefined;

      if (existing) {
        const oldFile = existing.src.split("/").pop() || "";
        const oldExt = path.extname(oldFile).toLowerCase();
        const newExt = path.extname(filename).toLowerCase();
        if (oldExt !== newExt) {
          const oldTs = extractTimestamp(oldFile);
          const newTs = extractTimestamp(filename);
          if (newTs >= oldTs) {
            updatedImages.push({
              id: existing.id,
              oldSrc: existing.src,
              newSrc: src,
            });
          }
        }
      } else {
        const basename = path.basename(filename);
        const id = filenameToId(basename);
        if (id && !registry.images[id]) {
          newImages.push({ id, src, filename });
        }
      }
    });

    const brokenReferences: BrokenReference[] = [];
    const checkedSrcs = new Set<string>();

    for (const ref of yamlRefs) {
      const isRemote = ref.src.startsWith("http://") || ref.src.startsWith("https://");
      const displaySrc = isRemote ? ref.src : (ref.src.startsWith("/") ? ref.src : `/${ref.src}`);
      const cacheKey = `${ref.yamlFile}:${displaySrc}`;
      if (checkedSrcs.has(cacheKey)) continue;
      checkedSrcs.add(cacheKey);

      const exists = await this.checkExists(ref.src);
      if (!exists) {
        brokenReferences.push({
          yamlFile: ref.yamlFile,
          field: ref.field,
          missingSrc: displaySrc,
        });
      }
    }

    for (const [id, entry] of Object.entries(registry.images)) {
      const src = entry.src;
      if (!src || typeof src !== "string") continue;

      const exists = await this.checkExists(src);
      if (!exists) {
        const isRemote = src.startsWith("http://") || src.startsWith("https://");
        const displaySrc = isRemote ? src : (src.startsWith("/") ? src : `/${src}`);
        brokenReferences.push({
          yamlFile: `image-registry.json (id: ${id})`,
          field: "src",
          missingSrc: displaySrc,
        });
      }
    }

    let hashesComputed = 0;
    let registryDirty = false;
    for (const [id, entry] of Object.entries(registry.images)) {
      if (entry.hash) continue;
      const isLocal = !entry.src.startsWith("http://") && !entry.src.startsWith("https://");
      if (!isLocal) continue;
      const localPath = this.resolveLocalPath(entry.src);
      if (!localPath) continue;
      const hash = this.computeFileHash(localPath);
      if (hash) {
        (registry.images[id] as any).hash = hash;
        hashesComputed++;
        registryDirty = true;
      }
    }
    if (registryDirty) {
      this.saveRegistry(registry);
    }

    const hashGroups = new Map<string, string[]>();
    for (const [id, entry] of Object.entries(registry.images)) {
      if (!entry.hash) continue;
      const group = hashGroups.get(entry.hash) || [];
      group.push(id);
      hashGroups.set(entry.hash, group);
    }

    const duplicates: DuplicateGroup[] = [];
    for (const [hash, ids] of hashGroups) {
      if (ids.length < 2) continue;
      const sorted = [...ids].sort((a, b) => a.length - b.length || a.localeCompare(b));
      duplicates.push({ hash, ids: sorted, canonical: sorted[0] });
    }

    return {
      newImages,
      updatedImages,
      brokenReferences,
      duplicates,
      hashesComputed,
      registeredCount: Object.keys(registry.images).length,
      scannedImagesCount: allImages.size,
      summary: {
        new: newImages.length,
        updated: updatedImages.length,
        broken: brokenReferences.length,
        duplicates: duplicates.length,
      },
    };
  }

  private replacePathsInYamlFiles(oldSrc: string, newSrc: string): string[] {
    const updatedFiles: string[] = [];

    function walkDir(dir: string) {
      if (!fs.existsSync(dir)) return;
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          walkDir(fullPath);
        } else if (entry.name.endsWith(".yml") || entry.name.endsWith(".yaml")) {
          const content = fs.readFileSync(fullPath, "utf8");
          if (content.includes(oldSrc)) {
            const updated = content.split(oldSrc).join(newSrc);
            fs.writeFileSync(fullPath, updated, "utf8");
            updatedFiles.push(path.relative(process.cwd(), fullPath));
          }
        }
      }
    }

    walkDir(this.contentDir);
    return updatedFiles;
  }

  applyChanges(scanResult: ScanResult): { added: number; updated: number; yamlFilesUpdated: string[] } {
    const registry = this.getRegistry() || { presets: {}, images: {} };
    const allYamlFilesUpdated: string[] = [];

    for (const img of scanResult.newImages) {
      (registry.images as Record<string, any>)[img.id] = {
        src: img.src,
        alt: `TODO: Add alt text for ${img.filename}`,
        focal_point: "center",
        tags: [],
        usage_count: 0,
      };
    }

    for (const img of scanResult.updatedImages) {
      if (registry.images[img.id]) {
        (registry.images[img.id] as any).src = img.newSrc;
      }
      const files = this.replacePathsInYamlFiles(img.oldSrc, img.newSrc);
      allYamlFilesUpdated.push(...files);
    }

    this.saveRegistry(registry);
    this.existenceCache.clear();

    return {
      added: scanResult.newImages.length,
      updated: scanResult.updatedImages.length,
      yamlFilesUpdated: Array.from(new Set(allYamlFilesUpdated)),
    };
  }

  register(id: string, entry: Partial<ImageEntry> & { src: string; alt: string }): void {
    const registry = this.getRegistry();
    if (!registry) throw new Error("Failed to load registry");

    (registry.images as Record<string, any>)[id] = {
      src: entry.src,
      alt: entry.alt,
      focal_point: entry.focal_point || "center",
      tags: entry.tags || [],
      ...(entry.protected ? { protected: true } : {}),
      usage_count: entry.usage_count || 0,
      ...(entry.hash ? { hash: entry.hash } : {}),
      ...(entry.width ? { width: entry.width } : {}),
      ...(entry.height ? { height: entry.height } : {}),
      ...(entry.format ? { format: entry.format } : {}),
      ...(entry.parentId ? { parentId: entry.parentId } : {}),
      ...(entry.quality_override != null ? { quality_override: entry.quality_override } : {}),
    };

    this.saveRegistry(registry);
  }

  private async deletePhysicalFiles(imageEntry: ImageEntry): Promise<string[]> {
    const errors: string[] = [];
    try {
      await this.deleteBySrc(imageEntry.src);
    } catch (err) {
      const msg = `Failed to delete primary file ${imageEntry.src}: ${err instanceof Error ? err.message : String(err)}`;
      log.warn(`[MediaGallery] ${msg}`);
      errors.push(msg);
    }
    if (imageEntry.srcset) {
      for (const entry of imageEntry.srcset) {
        try {
          await this.deleteBySrc(entry.url);
        } catch (err) {
          const msg = `Failed to delete srcset variant ${entry.url}: ${err instanceof Error ? err.message : String(err)}`;
          log.warn(`[MediaGallery] ${msg}`);
          errors.push(msg);
        }
      }
    }
    return errors;
  }

  private getSrcsetUrls(imageEntry: ImageEntry): string[] {
    if (!imageEntry.srcset) return [];
    return imageEntry.srcset.map(e => e.url);
  }

  async unregister(id: string): Promise<{ success: boolean; error?: string; usedIn?: string[]; cleanupErrors?: string[] }> {
    const registry = this.getRegistry();
    if (!registry) return { success: false, error: "Failed to load registry" };

    const imageEntry = registry.images[id];
    if (!imageEntry) return { success: false, error: `Image "${id}" not found in registry` };

    if (imageEntry.protected) {
      return { success: false, error: `Cannot delete "${id}" because it is marked as protected` };
    }

    const srcsetUrls = this.getSrcsetUrls(imageEntry);
    const usedIn = this.getUsage(id, imageEntry.src, srcsetUrls);
    if (usedIn.length > 0) {
      return {
        success: false,
        error: `Cannot delete "${id}" because it is referenced in ${usedIn.length} file(s)`,
        usedIn,
      };
    }

    delete (registry.images as Record<string, any>)[id];
    this.saveRegistry(registry);

    const cleanupErrors = await this.deletePhysicalFiles(imageEntry);
    return { success: true, ...(cleanupErrors.length > 0 ? { cleanupErrors } : {}) };
  }

  async bulkUnregister(ids: string[]): Promise<{ results: Array<{ id: string; success: boolean; message: string }>; deletedCount: number }> {
    const registry = this.getRegistry();
    if (!registry) {
      return {
        results: ids.map(id => ({ id, success: false, message: "Failed to load registry" })),
        deletedCount: 0,
      };
    }

    const resultMap = new Map<string, { id: string; success: boolean; message: string }>();
    let deletedCount = 0;
    const entriesToDelete: Array<{ id: string; entry: ImageEntry }> = [];

    for (const imageId of ids) {
      const imageEntry = registry.images[imageId];
      if (!imageEntry) {
        resultMap.set(imageId, { id: imageId, success: false, message: "Not found in registry" });
        continue;
      }

      const srcsetUrls = this.getSrcsetUrls(imageEntry);
      const usedIn = this.getUsage(imageId, imageEntry.src, srcsetUrls);
      if (usedIn.length > 0) {
        resultMap.set(imageId, {
          id: imageId,
          success: false,
          message: `Referenced in ${usedIn.length} file(s): ${usedIn.join(", ")}`,
        });
        continue;
      }

      entriesToDelete.push({ id: imageId, entry: imageEntry });
      delete (registry.images as Record<string, any>)[imageId];
      deletedCount++;
    }

    if (deletedCount > 0) {
      this.saveRegistry(registry);
    }

    for (const { id: imageId, entry } of entriesToDelete) {
      const cleanupErrors = await this.deletePhysicalFiles(entry);
      if (cleanupErrors.length > 0) {
        resultMap.set(imageId, { id: imageId, success: true, message: `Deleted (file cleanup issues: ${cleanupErrors.join("; ")})` });
      } else {
        resultMap.set(imageId, { id: imageId, success: true, message: "Deleted" });
      }
    }

    const results = ids.map(id => resultMap.get(id)!);
    return { results, deletedCount };
  }

  private toDestKey(sourceKey: string, prefix?: string): string {
    let relative = sourceKey;
    const localPrefixes = [this.imagesUrlPrefix, "/attached_assets/", `${this.contentFolderName}/images/`, "attached_assets/"];
    for (const p of localPrefixes) {
      if (relative.startsWith(p)) {
        relative = relative.slice(p.length);
        break;
      }
    }
    return prefix ? `${prefix}/${relative}` : relative;
  }

  private static MIME_MAP: Record<string, string> = {
    ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg",
    ".webp": "image/webp", ".svg": "image/svg+xml", ".avif": "image/avif", ".gif": "image/gif",
    ".mp4": "video/mp4", ".webm": "video/webm", ".mov": "video/quicktime",
    ".ogg": "video/ogg", ".m4v": "video/x-m4v",
    ".pdf": "application/pdf",
  };

  private async readSourceData(from: import("./media/types").StorageProvider, key: string): Promise<Buffer | null> {
    if (from.name === "local") {
      const normalizedKey = key.startsWith("/") ? key : `/${key}`;
      const diskPath = path.join(process.cwd(), normalizedKey);
      if (!fs.existsSync(diskPath)) return null;
      return fs.readFileSync(diskPath);
    }
    return null;
  }

  async migrate(
    fromProvider: string,
    toProvider: string,
    options: { dryRun?: boolean; prefix?: string } = {}
  ): Promise<Array<{ id: string; oldSrc: string; newSrc: string; status: string }>> {
    const registry = this.getRegistry();
    if (!registry) throw new Error("Failed to load registry");

    const from = media.getProvider(fromProvider as any);
    const to = media.getProvider(toProvider as any);
    if (!from) throw new Error(`Provider "${fromProvider}" not configured. Available: ${media.getAllProviderNames().join(", ")}`);
    if (!to) throw new Error(`Provider "${toProvider}" not configured. Available: ${media.getAllProviderNames().join(", ")}`);

    const results: Array<{ id: string; oldSrc: string; newSrc: string; status: string }> = [];

    for (const [id, entry] of Object.entries(registry.images)) {
      if (!from.owns(entry.src)) continue;

      const sourceKey = from.extractKey(entry.src);
      if (!sourceKey) {
        results.push({ id, oldSrc: entry.src, newSrc: "", status: "skipped: could not extract key" });
        continue;
      }

      const destKey = this.toDestKey(sourceKey, options.prefix);

      if (options.dryRun) {
        results.push({ id, oldSrc: entry.src, newSrc: to.getPublicUrl(destKey), status: "dry-run" });
        continue;
      }

      try {
        const data = await this.readSourceData(from, sourceKey);
        if (!data) {
          results.push({ id, oldSrc: entry.src, newSrc: "", status: "skipped: source file not found" });
          continue;
        }

        const ext = path.extname(sourceKey).toLowerCase();
        const contentType = MediaGallery.MIME_MAP[ext] || "application/octet-stream";

        const newSrc = await to.upload(destKey, data, contentType);

        (registry.images[id] as any).src = newSrc;
        this.replacePathsInYamlFiles(entry.src, newSrc);
        results.push({ id, oldSrc: entry.src, newSrc, status: "migrated" });
      } catch (err: any) {
        results.push({ id, oldSrc: entry.src, newSrc: "", status: `error: ${err.message}` });
      }
    }

    if (!options.dryRun && results.some(r => r.status === "migrated")) {
      this.saveRegistry(registry);
      this.existenceCache.clear();
    }

    return results;
  }

  async uploadAndRegister(
    filename: string,
    data: Buffer,
    contentType: string,
    opts?: {
      alt?: string;
      tags?: string[];
      origin?: "upload" | "import" | "ai";
      ai?: {
        generated: true;
        model?: string;
        prompt?: string;
        generated_at?: string;
      };
    }
  ): Promise<{ id: string; src: string; alt: string; duplicate?: boolean; existingId?: string }> {
    const registry = this.getRegistry();
    if (!registry) throw new Error("Failed to load registry");

    const ext = path.extname(filename).toLowerCase();
    if (!MEDIA_EXTENSIONS.has(ext)) {
      throw new Error(`Unsupported file type: ${ext}`);
    }

    const hash = this.computeBufferHash(data);
    const existing = this.findByHash(hash);
    if (existing) {
      return {
        id: existing.id,
        src: existing.entry.src,
        alt: existing.entry.alt,
        duplicate: true,
        existingId: existing.id,
      };
    }

    const sanitized = filename
      .replace(/[^a-zA-Z0-9._-]/g, "-")
      .replace(/-+/g, "-")
      .replace(/^-|-$/g, "");

    const id = filenameToId(sanitized);
    if (!id) throw new Error("Could not derive a valid ID from filename");

    let uniqueId = id;
    let counter = 1;
    while (registry.images[uniqueId]) {
      uniqueId = `${id}-${counter}`;
      counter++;
    }

    const storageProvider = this.getDefaultStorageProvider();
    let src: string;

    if (storageProvider.name === "local") {
      const destDir = this.imagesDir;
      if (!fs.existsSync(destDir)) {
        fs.mkdirSync(destDir, { recursive: true });
      }
      const destPath = path.join(destDir, sanitized);
      fs.writeFileSync(destPath, data);
      src = `${this.imagesUrlPrefix}${sanitized}`;
    } else {
      const key = sanitized;
      src = await storageProvider.upload(key, data, contentType);
    }

    const doctype = inferDoctypeFromFilename(filename);
    const alt = opts?.alt || defaultAltForDoctype(doctype, path.parse(filename).name);
    const origin = opts?.origin ?? "upload";
    this.register(uniqueId, {
      src,
      alt,
      tags: opts?.tags || [],
      hash,
      origin,
      ...(opts?.ai ? { ai: opts.ai } : {}),
    });

    this.existenceCache.clear();

    if (OPTIMIZABLE_EXTENSIONS.has(ext)) {
      this.optimizeInBackground(uniqueId, data, src, opts?.tags || []);
    }

    // AI vision auto-tag is image-only; skip videos and PDFs.
    // Skip auto-tag for AI-generated images (prompt-based alt / provenance already set).
    if (doctype === "image" && origin !== "ai" && (!opts?.tags || opts.tags.length === 0)) {
      this.classifyInBackground(uniqueId);
    }

    return { id: uniqueId, src, alt };
  }

  /**
   * In-place replace: keep registry ID and metadata; overwrite stored bytes.
   * Images are always converted to WebP. Same doctype only. Hash match on another
   * ID returns a duplicate conflict (no mutation).
   */
  async replaceAndRegister(
    id: string,
    filename: string,
    data: Buffer,
    _contentType: string,
  ): Promise<
    | {
        ok: true;
        id: string;
        src: string;
        alt: string;
        srcChanged: boolean;
        childIds: string[];
        noop?: boolean;
      }
    | {
        ok: false;
        conflict: "duplicate";
        existingId: string;
        existingSrc: string;
      }
  > {
    const registry = this.getRegistry();
    if (!registry) throw new Error("Failed to load registry");

    const imageEntry = registry.images[id];
    if (!imageEntry) {
      throw new Error(`Image "${id}" not found in registry`);
    }

    const uploadExt = extensionFromPath(filename);
    if (!MEDIA_EXTENSIONS.has(uploadExt)) {
      throw new Error(`Unsupported file type: ${uploadExt || "(none)"}`);
    }

    const currentDoctype = inferDoctypeFromSrc(imageEntry.src);
    const uploadDoctype = inferDoctypeFromFilename(filename);
    if (!currentDoctype || !uploadDoctype) {
      throw new Error("Could not determine media type for replace");
    }
    if (currentDoctype !== uploadDoctype) {
      throw new Error(
        `Cannot change media type from ${currentDoctype} to ${uploadDoctype}`,
      );
    }

    const childIds = Object.entries(registry.images)
      .filter(([, entry]) => entry.parentId === id)
      .map(([childId]) => childId);

    let storeBuffer = data;
    let storeExt = uploadExt;
    let storeContentType = _contentType || "application/octet-stream";
    let registryFormat: ImageEntry["format"] | undefined = imageEntry.format;

    if (currentDoctype === "image") {
      try {
        storeBuffer = await sharp(data).webp({ quality: 85 }).toBuffer();
      } catch (err) {
        throw new Error(
          `Failed to convert image to WebP: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
      storeExt = ".webp";
      storeContentType = "image/webp";
      registryFormat = "webp";
    }

    const hash = this.computeBufferHash(storeBuffer);
    if (imageEntry.hash && imageEntry.hash === hash) {
      return {
        ok: true,
        id,
        src: imageEntry.src,
        alt: imageEntry.alt,
        srcChanged: false,
        childIds,
        noop: true,
      };
    }

    const existing = this.findByHash(hash);
    if (existing && existing.id !== id) {
      return {
        ok: false,
        conflict: "duplicate",
        existingId: existing.id,
        existingSrc: existing.entry.src,
      };
    }

    await this.deleteSrcsetVariants(imageEntry);

    const provider = this.resolveProviderForSrc(imageEntry.src);
    const oldSrc = imageEntry.src;
    const oldExt = extensionFromPath(oldSrc);
    let src = oldSrc;
    let srcChanged = false;

    if (storeExt === oldExt) {
      const oldKey = provider.extractKey(oldSrc);
      if (!oldKey) {
        throw new Error(`Could not resolve storage key for "${oldSrc}"`);
      }
      const uploaded = await provider.upload(oldKey, storeBuffer, storeContentType);
      src = uploaded || oldSrc;
      // Keep canonical registry src when overwrite returns an equivalent URL
      if (src !== oldSrc && this.normalizeSrcCompare(src) === this.normalizeSrcCompare(oldSrc)) {
        src = oldSrc;
      } else if (src !== oldSrc) {
        // Provider returned a different public URL for the same key — treat as changed
        srcChanged = true;
        this.replacePathsInYamlFiles(oldSrc, src);
      }
    } else {
      const filenameForStore = `${id}${storeExt}`;
      src = await this.uploadPrimaryFile(provider, filenameForStore, storeBuffer, storeContentType);
      srcChanged = src !== oldSrc;
      if (srcChanged) {
        this.replacePathsInYamlFiles(oldSrc, src);
        try {
          await this.deleteBySrc(oldSrc);
        } catch (err) {
          log.warn(
            `[MediaGallery] Failed to delete old primary after replace "${id}":`,
            err instanceof Error ? err.message : String(err),
          );
        }
      }
    }

    this.register(id, {
      src,
      alt: imageEntry.alt,
      tags: imageEntry.tags || [],
      focal_point: imageEntry.focal_point,
      ...(imageEntry.protected ? { protected: true } : {}),
      parentId: imageEntry.parentId,
      ...(imageEntry.quality_override != null
        ? { quality_override: imageEntry.quality_override }
        : {}),
      hash,
      ...(registryFormat ? { format: registryFormat } : {}),
      usage_count: imageEntry.usage_count || 0,
    });

    this.existenceCache.clear();

    if (OPTIMIZABLE_EXTENSIONS.has(storeExt)) {
      this.optimizeInBackground(id, storeBuffer, src, imageEntry.tags || []);
    }

    return {
      ok: true,
      id,
      src,
      alt: imageEntry.alt,
      srcChanged,
      childIds,
    };
  }

  private normalizeSrcCompare(src: string): string {
    return src.replace(/\?.*$/, "").replace(/\/$/, "");
  }

  private resolveProviderForSrc(src: string): StorageProvider {
    const siteGCS = this.getSiteGCSProvider();
    if (siteGCS && siteGCS.owns(src)) return siteGCS;
    return media.resolveProvider(src);
  }

  private async uploadPrimaryFile(
    provider: StorageProvider,
    filename: string,
    data: Buffer,
    contentType: string,
  ): Promise<string> {
    if (provider.name === "local") {
      return provider.upload(`${this.imagesUrlPrefix}${filename}`, data, contentType);
    }
    return provider.upload(filename, data, contentType);
  }

  private async deleteSrcsetVariants(imageEntry: ImageEntry): Promise<void> {
    if (!imageEntry.srcset) return;
    for (const entry of imageEntry.srcset) {
      try {
        await this.deleteBySrc(entry.url);
      } catch (err) {
        log.warn(
          `[MediaGallery] Failed to delete srcset variant ${entry.url}:`,
          err instanceof Error ? err.message : String(err),
        );
      }
    }
  }

  private classifyInBackground(imageId: string): void {
    import("./image-auto-tagger")
      .then(({ classifyAndApply }) => classifyAndApply(imageId))
      .then((result) => {
        if (result.added.length > 0) {
          log.info(
            `[MediaGallery] Auto-tagged "${imageId}" with: ${result.added.join(", ")}`,
          );
        }
      })
      .catch((err) => {
        log.warn(
          `[MediaGallery] Auto-tag failed for "${imageId}":`,
          err instanceof Error ? err.message : String(err),
        );
      });
  }

  private optimizeInBackground(id: string, buffer: Buffer, src: string, tags: string[]): void {
    const registry = this.getRegistry();
    if (!registry) return;

    const presets = registry.presets as Record<string, Preset>;
    const tagDefinitions = registry.tagDefinitions as Record<string, { presets?: string[] }> | undefined;

    processImageBuffer(id, buffer, src, tags, presets, false, undefined, tagDefinitions)
      .then((result) => {
        if (!result) {
          log.info(`[MediaGallery] Background optimization produced no variants for "${id}"`);
          return;
        }

        const currentRegistry = this.getRegistry();
        if (!currentRegistry) return;

        const existing = currentRegistry.images[id];
        if (!existing) {
          log.info(`[MediaGallery] Image "${id}" no longer in registry, skipping optimization update`);
          return;
        }

        (currentRegistry.images as Record<string, any>)[id] = {
          ...existing,
          width: result.width,
          height: result.height,
          preset: result.preset,
          widths_generated: result.widths_generated,
          format: result.format,
          srcset: result.srcset,
        };

        this.saveRegistry(currentRegistry);
        log.info(
          `[MediaGallery] Optimized "${id}": ${result.width}x${result.height} → ${result.srcset.length} variant(s) [${result.preset.join(", ")}]`
        );
      })
      .catch((err) => {
        log.error({ err: err }, `[MediaGallery] Background optimization failed for "${id}":`);
      });
  }

  removeDuplicates(duplicateGroups: DuplicateGroup[]): {
    removedCount: number;
    yamlFilesUpdated: string[];
    results: Array<{ id: string; status: string; rewrittenTo?: string }>;
  } {
    const registry = this.getRegistry();
    if (!registry) throw new Error("Failed to load registry");

    const results: Array<{ id: string; status: string; rewrittenTo?: string }> = [];
    const allYamlFilesUpdated: string[] = [];
    let removedCount = 0;

    for (const group of duplicateGroups) {
      const canonical = group.canonical;
      const canonicalEntry = registry.images[canonical];
      if (!canonicalEntry) continue;

      for (const id of group.ids) {
        if (id === canonical) {
          results.push({ id, status: "kept" });
          continue;
        }

        const entry = registry.images[id];
        if (!entry) {
          results.push({ id, status: "not_found" });
          continue;
        }

        if (entry.src !== canonicalEntry.src) {
          const files = this.replacePathsInYamlFiles(entry.src, canonicalEntry.src);
          allYamlFilesUpdated.push(...files);
        }

        delete (registry.images as Record<string, any>)[id];
        removedCount++;
        results.push({ id, status: "removed", rewrittenTo: canonical });
      }
    }

    if (removedCount > 0) {
      this.saveRegistry(registry);
      this.existenceCache.clear();
    }

    return {
      removedCount,
      yamlFilesUpdated: Array.from(new Set(allYamlFilesUpdated)),
      results,
    };
  }

  findRedundantImages(): Array<{ id: string; cloudUrl: string; localPath: string }> {
    const registry = this.getRegistry();
    if (!registry) return [];

    const ATTACHED_ASSETS_DIR = path.join(process.cwd(), "attached_assets");
    const redundant: Array<{ id: string; cloudUrl: string; localPath: string }> = [];

    for (const [id, entry] of Object.entries(registry.images)) {
      if (!entry.src.startsWith("http")) continue;

      const filename = entry.src.split("/").pop();
      if (!filename) continue;

      const inImages = path.join(this.imagesDir, filename);
      const inAssets = path.join(ATTACHED_ASSETS_DIR, filename);

      if (fs.existsSync(inImages)) {
        redundant.push({ id, cloudUrl: entry.src, localPath: `${this.imagesUrlPrefix}${filename}` });
      } else if (fs.existsSync(inAssets)) {
        redundant.push({ id, cloudUrl: entry.src, localPath: `/attached_assets/${filename}` });
      }
    }

    return redundant;
  }

  async resolveRedundancy(
    action: "delete-local" | "delete-cloud",
    ids?: string[],
  ): Promise<{ resolved: number; errors: string[] }> {
    const registry = this.getRegistry();
    if (!registry) throw new Error("Failed to load registry");

    const ATTACHED_ASSETS_DIR = path.join(process.cwd(), "attached_assets");
    const all = this.findRedundantImages();
    const targets = ids && ids.length > 0 ? all.filter(r => ids.includes(r.id)) : all;

    let resolved = 0;
    const errors: string[] = [];

    for (const item of targets) {
      try {
        if (action === "delete-local") {
          const localDiskPath = path.join(process.cwd(), item.localPath);
          if (fs.existsSync(localDiskPath)) {
            fs.unlinkSync(localDiskPath);
          }
          resolved++;
        } else {
          await this.deleteBySrc(item.cloudUrl);
          const localDiskPath = path.join(process.cwd(), item.localPath);
          const fileExists = fs.existsSync(localDiskPath);
          if (fileExists) {
            const entry = registry.images[item.id];
            if (entry) {
              (registry.images as Record<string, ImageEntry>)[item.id] = {
                ...entry,
                src: item.localPath,
              };
            }
          }
          resolved++;
        }
      } catch (err: any) {
        errors.push(`[${item.id}] ${err.message || String(err)}`);
      }
    }

    if (action === "delete-cloud" && resolved > 0) {
      this.saveRegistry(registry);
    }

    return { resolved, errors };
  }

  persistRegistry(): void {
    const registry = this.getRegistry();
    if (registry) {
      this.saveRegistry(registry);
    }
  }

  private saveRegistry(registry: ImageRegistry): void {
    // Strip transient queue-state fields before persisting to the tracked file
    const clean: ImageRegistry = {
      ...registry,
      images: Object.fromEntries(
        Object.entries(registry.images).map(([id, entry]) => {
          const { failed_at, queued_at, ...rest } = entry as ImageEntry & {
            failed_at?: string;
            queued_at?: string;
          };
          void failed_at;
          void queued_at;
          return [id, rest as ImageEntry];
        })
      ),
    };
    const nextContent = JSON.stringify(clean, null, 2) + "\n";
    const currentContent = fs.existsSync(this.registryPath)
      ? fs.readFileSync(this.registryPath, "utf8")
      : null;

    // Avoid triggering auto-commit when persisted content is identical.
    if (currentContent === nextContent) {
      this.clearCache();
      return;
    }

    fs.writeFileSync(this.registryPath, nextContent, "utf8");
    markFileAsModified(`${this.contentFolderName}/image-registry.json`);
    this.clearCache();
  }
}

let _defaultMediaGallery: MediaGallery | undefined;

function resolveDefaultMediaGallery(): MediaGallery {
  if (_defaultMediaGallery) return _defaultMediaGallery;
  try {
    const { getDefaultSite } = require("./site-manager") as typeof import("./site-manager");
    _defaultMediaGallery = getDefaultSite().mediaGallery;
  } catch {
    _defaultMediaGallery = new MediaGallery();
  }
  return _defaultMediaGallery;
}

/** Backward-compat singleton — delegates to the default site's MediaGallery instance. */
export const mediaGallery: MediaGallery = new Proxy({} as MediaGallery, {
  get(_target, prop) {
    const instance = resolveDefaultMediaGallery();
    const value = Reflect.get(instance, prop, instance);
    return typeof value === "function" ? value.bind(instance) : value;
  },
});
