import * as fs from "fs";
import { getDefaultContentFolder } from "./site-config";
import * as path from "path";
import * as yaml from "js-yaml";
import { escapeTemplateVars, unescapeObjectVars } from "../shared/templateVars";
import { markFileAsModified } from "./sync-state";
import { getPackageRoot } from "@shared/paths";

const ATTACHED_ASSETS_DIR = path.join(getPackageRoot(), "attached_assets");

interface SiteRoot {
  contentDir: string;
  contentFolderName: string;
  imagesDir: string;
  registryPath: string;
}

function getAllSiteRoots(): SiteRoot[] {
  try {
    const { getSiteConfigs } = require("./site-config") as typeof import("./site-config");
    const sites = getSiteConfigs();
    if (sites.length > 0) {
      return sites.map(s => {
        const contentDir = path.join(process.cwd(), s.contentFolder);
        return {
          contentDir,
          contentFolderName: s.contentFolder.replace(/\/$/, ""),
          imagesDir: path.join(contentDir, "images"),
          registryPath: path.join(contentDir, "image-registry.json"),
        };
      });
    }
  } catch { /* fall through */ }
  const fallbackFolder = getDefaultContentFolder();
  const contentDir = path.join(process.cwd(), fallbackFolder);
  return [{
    contentDir,
    contentFolderName: fallbackFolder,
    imagesDir: path.join(contentDir, "images"),
    registryPath: path.join(contentDir, "image-registry.json"),
  }];
}

function getDefaultSiteRoot(): SiteRoot {
  const all = getAllSiteRoots();
  return all[0];
}

const IMAGE_EXTENSIONS = new Set([".png", ".jpg", ".jpeg", ".webp", ".svg", ".avif", ".gif"]);

const SCREENSHOT_PATTERNS = [/^Screenshot_/i, /^Captura_/i, /^Capture_/i, /^Screen[\s_]?Shot/i];

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

export interface ScanResult {
  newImages: ScanNewImage[];
  updatedImages: ScanUpdatedImage[];
  brokenReferences: BrokenReference[];
  registeredCount: number;
  scannedImagesCount: number;
  summary: {
    new: number;
    updated: number;
    broken: number;
  };
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

function scanImageDirectory(baseDir: string, urlPrefix: string, skipScreenshots: boolean): Map<string, string> {
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
        if (IMAGE_EXTENSIONS.has(ext)) {
          const relPath = `${prefix}${entry.name}`;
          imageFiles.set(relPath, `${urlPrefix}${relPath}`);
        }
      }
    }
  }

  walkDir(baseDir, "");
  return imageFiles;
}

function scanAllImageDirectories(): Map<string, string> {
  const combined = new Map<string, string>();
  const attachedAssets = scanImageDirectory(ATTACHED_ASSETS_DIR, "/attached_assets/", true);
  attachedAssets.forEach((src, key) => combined.set(key, src));
  for (const site of getAllSiteRoots()) {
    const siteImages = scanImageDirectory(site.imagesDir, `/${site.contentFolderName}/images/`, false);
    siteImages.forEach((src, key) => combined.set(key, src));
  }
  return combined;
}

function loadRegistry(registryPath?: string): { presets: Record<string, any>; images: Record<string, any> } {
  const target = registryPath ?? getDefaultSiteRoot().registryPath;
  try {
    const content = fs.readFileSync(target, "utf8");
    return JSON.parse(content);
  } catch {
    return { presets: {}, images: {} };
  }
}

function findImageRefsInValue(
  value: any,
  currentPath: string,
  results: Array<{ field: string; src: string }>
): void {
  if (typeof value === "string") {
    const siteImagePrefixes = getAllSiteRoots().flatMap(site => [
      `/${site.contentFolderName}/images/`,
      `${site.contentFolderName}/images/`,
    ]);
    const isImageRef = value.startsWith("/attached_assets/") || value.startsWith("attached_assets/") ||
      siteImagePrefixes.some(prefix => value.startsWith(prefix));
    if (isImageRef) {
      results.push({ field: currentPath, src: value });
    }
  } else if (Array.isArray(value)) {
    value.forEach((item, index) => {
      findImageRefsInValue(item, `${currentPath}[${index}]`, results);
    });
  } else if (value && typeof value === "object") {
    for (const [key, val] of Object.entries(value)) {
      findImageRefsInValue(val, currentPath ? `${currentPath}.${key}` : key, results);
    }
  }
}

function scanYamlFiles(): Array<{ yamlFile: string; field: string; src: string }> {
  const refs: Array<{ yamlFile: string; field: string; src: string }> = [];

  function walkDir(dir: string) {
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
            findImageRefsInValue(parsed, "", fileRefs);
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
  }

  for (const site of getAllSiteRoots()) {
    walkDir(site.contentDir);
  }
  return refs;
}

export function scanImageRegistry(): ScanResult {
  const defaultSite = getDefaultSiteRoot();
  const registry = loadRegistry(defaultSite.registryPath);
  const allImages = scanAllImageDirectories();
  // Combine all site image dirs for new/updated detection
  const marketingOnly = new Map<string, string>();
  for (const site of getAllSiteRoots()) {
    const siteImages = scanImageDirectory(site.imagesDir, `/${site.contentFolderName}/images/`, false);
    siteImages.forEach((src, key) => marketingOnly.set(key, src));
  }
  const yamlRefs = scanYamlFiles();

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

  // Only flag images from 4geeks-com/images/ as new/unregistered
  // attached_assets/ is legacy and should not produce new registration suggestions
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
    const normalizedSrc = ref.src.startsWith("/") ? ref.src : `/${ref.src}`;
    if (checkedSrcs.has(`${ref.yamlFile}:${normalizedSrc}`)) continue;
    checkedSrcs.add(`${ref.yamlFile}:${normalizedSrc}`);

    const diskPath = path.join(process.cwd(), normalizedSrc);
    if (!fs.existsSync(diskPath)) {
      brokenReferences.push({
        yamlFile: ref.yamlFile,
        field: ref.field,
        missingSrc: normalizedSrc,
      });
    }
  }

  for (const [id, entry] of Object.entries(registry.images)) {
    const src = (entry as any).src;
    if (!src || typeof src !== "string") continue;
    const normalizedSrc = src.startsWith("/") ? src : `/${src}`;
    const diskPath = path.join(process.cwd(), normalizedSrc);
    if (!fs.existsSync(diskPath)) {
      brokenReferences.push({
        yamlFile: `image-registry.json (id: ${id})`,
        field: "src",
        missingSrc: normalizedSrc,
      });
    }
  }

  return {
    newImages,
    updatedImages,
    brokenReferences,
    registeredCount: Object.keys(registry.images).length,
    scannedImagesCount: allImages.size,
    summary: {
      new: newImages.length,
      updated: updatedImages.length,
      broken: brokenReferences.length,
    },
  };
}

function replacePathsInYamlFiles(
  oldSrc: string,
  newSrc: string
): string[] {
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

  for (const site of getAllSiteRoots()) {
    walkDir(site.contentDir);
  }
  return updatedFiles;
}

export function applyRegistryChanges(scanResult: ScanResult): {
  added: number;
  updated: number;
  yamlFilesUpdated: string[];
} {
  const registry = loadRegistry();
  const allYamlFilesUpdated: string[] = [];

  for (const img of scanResult.newImages) {
    registry.images[img.id] = {
      src: img.src,
      alt: `TODO: Add alt text for ${img.filename}`,
      focal_point: "center",
      tags: [],
      usage_count: 0,
    };
  }

  for (const img of scanResult.updatedImages) {
    if (registry.images[img.id]) {
      registry.images[img.id].src = img.newSrc;
    }
    const files = replacePathsInYamlFiles(img.oldSrc, img.newSrc);
    allYamlFilesUpdated.push(...files);
  }

  const defaultSite = getDefaultSiteRoot();
  fs.writeFileSync(defaultSite.registryPath, JSON.stringify(registry, null, 2) + "\n", "utf8");
  markFileAsModified(`${defaultSite.contentFolderName}/image-registry.json`);

  return {
    added: scanResult.newImages.length,
    updated: scanResult.updatedImages.length,
    yamlFilesUpdated: Array.from(new Set(allYamlFilesUpdated)),
  };
}
