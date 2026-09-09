import { getProjectRoot } from "@shared/paths";
import * as path from "path";
import { createScreenshotCacheStore, safeScreenshotKey } from "./screenshot-cache";
import { getDefaultContentFolder, getInheritComponentsFrom } from "./site-config";
import { resolveComponentPath, type RegistryOrigin } from "../shared/registry-resolve";
import { child } from "./logger";

const log = child({ module: "component-screenshots" });

export interface ScreenshotMeta {
  version: string;
  example: string;
  sourceMtime: number;
  sourceSize: number;
  capturedAt: string;
  origin?: RegistryOrigin;
}

export interface ScreenshotIndexEntry {
  url: string;
  stale: boolean;
  meta: ScreenshotMeta | null;
}

/** Sanitize example name for filesystem keys (keeps letters, digits, _ -). */
export function safeExampleKey(example: string): string {
  return safeScreenshotKey(example) === "key" && !example
    ? "example"
    : safeScreenshotKey(example);
}

/**
 * Primary gallery shots use `{type}.webp`.
 * Lazy per-example shots use `{type}--{safeExample}.webp` when `example` is set.
 */
function cacheBase(componentType: string, example?: string | null): string {
  if (!example) return componentType;
  return `${componentType}--${safeExampleKey(example)}`;
}

function siteCacheDir(contentFolder: string): string {
  // Per-site local cache (GCS can wrap this later). Site-keyed so brands do not collide.
  return path.join(getProjectRoot(), ".cache", contentFolder, "component-screenshots");
}

function sharedScreenshotsDir(componentType: string): string {
  return path.join(
    getProjectRoot(),
    "shared",
    "component-registry",
    componentType,
    "screenshots",
  );
}

function storeFor(componentType: string, contentFolder?: string) {
  const folder = contentFolder || getDefaultContentFolder();
  const resolved = resolveComponentPath(
    componentType,
    folder,
    getProjectRoot(),
    getInheritComponentsFrom(folder),
  );

  if (!resolved) {
    // Fallback: treat as site cache (legacy captures / unknown types)
    return {
      origin: "site" as RegistryOrigin,
      store: createScreenshotCacheStore(siteCacheDir(folder)),
    };
  }
  if (resolved.origin === "shared") {
    return {
      origin: "shared" as RegistryOrigin,
      store: createScreenshotCacheStore(sharedScreenshotsDir(componentType)),
    };
  }
  return {
    origin: "site" as RegistryOrigin,
    store: createScreenshotCacheStore(siteCacheDir(folder)),
  };
}

export function readScreenshotMeta(
  componentType: string,
  example?: string | null,
  contentFolder?: string,
): ScreenshotMeta | null {
  const { store, origin } = storeFor(componentType, contentFolder);
  const raw = store.readMeta<ScreenshotMeta>(cacheBase(componentType, example));
  if (!raw) return null;
  if (
    typeof raw.version !== "string" ||
    typeof raw.example !== "string" ||
    typeof raw.sourceMtime !== "number" ||
    typeof raw.sourceSize !== "number"
  ) {
    return null;
  }
  return { ...raw, origin };
}

export function hasScreenshotImage(
  componentType: string,
  example?: string | null,
  contentFolder?: string,
): boolean {
  const { store } = storeFor(componentType, contentFolder);
  return store.hasImage(cacheBase(componentType, example));
}

export function isScreenshotStale(
  componentType: string,
  sourceMtime: number | undefined,
  sourceSize: number | undefined,
  example?: string | null,
  contentFolder?: string,
): boolean {
  if (!hasScreenshotImage(componentType, example, contentFolder)) return true;
  const meta = readScreenshotMeta(componentType, example, contentFolder);
  if (!meta) return true;
  if (sourceMtime === undefined || sourceSize === undefined) return false;
  return meta.sourceMtime !== sourceMtime || meta.sourceSize !== sourceSize;
}

function screenshotUrl(
  componentType: string,
  cacheBust: number,
  example?: string | null,
): string {
  const params = new URLSearchParams({ t: String(cacheBust) });
  if (example) params.set("example", example);
  return `/api/private/component-screenshots/${encodeURIComponent(componentType)}?${params}`;
}

export function getScreenshotIndex(
  components: Array<{
    type: string;
    primaryExample?: { sourceMtime: number; sourceSize: number };
  }>,
  contentFolder?: string,
): Record<string, ScreenshotIndexEntry> {
  const out: Record<string, ScreenshotIndexEntry> = {};
  for (const comp of components) {
    const meta = readScreenshotMeta(comp.type, null, contentFolder);
    const hasImage = hasScreenshotImage(comp.type, null, contentFolder);
    const stale = isScreenshotStale(
      comp.type,
      comp.primaryExample?.sourceMtime,
      comp.primaryExample?.sourceSize,
      null,
      contentFolder,
    );
    const cacheBust = meta?.capturedAt
      ? Date.parse(meta.capturedAt) || meta.sourceMtime
      : meta?.sourceMtime ?? 0;
    out[comp.type] = {
      url: hasImage ? screenshotUrl(comp.type, cacheBust) : "",
      stale: !hasImage || stale,
      meta: hasImage ? meta : null,
    };
  }
  return out;
}

/** Index entry for a single lazy example shot (picker). */
export function getExampleScreenshotEntry(
  componentType: string,
  example: string,
  sourceMtime?: number,
  sourceSize?: number,
  contentFolder?: string,
): ScreenshotIndexEntry {
  const meta = readScreenshotMeta(componentType, example, contentFolder);
  const hasImage = hasScreenshotImage(componentType, example, contentFolder);
  const stale = isScreenshotStale(
    componentType,
    sourceMtime,
    sourceSize,
    example,
    contentFolder,
  );
  const cacheBust = meta?.capturedAt
    ? Date.parse(meta.capturedAt) || meta.sourceMtime
    : meta?.sourceMtime ?? 0;
  return {
    url: hasImage ? screenshotUrl(componentType, cacheBust, example) : "",
    stale: !hasImage || stale,
    meta: hasImage ? meta : null,
  };
}

export function readScreenshotImage(
  componentType: string,
  example?: string | null,
  contentFolder?: string,
): Buffer | null {
  const { store } = storeFor(componentType, contentFolder);
  return store.readImage(cacheBase(componentType, example));
}

export function saveScreenshot(
  componentType: string,
  image: Buffer,
  meta: Omit<ScreenshotMeta, "capturedAt"> & { capturedAt?: string },
  options?: { exampleKeyed?: boolean; contentFolder?: string },
): { success: boolean; error?: string } {
  try {
    if (!/^[a-z0-9_]+$/i.test(componentType)) {
      return { success: false, error: "Invalid component type" };
    }
    const exampleKey = options?.exampleKeyed ? meta.example : null;
    if (options?.exampleKeyed && !meta.example) {
      return { success: false, error: "example required for keyed screenshot" };
    }
    const { store, origin } = storeFor(componentType, options?.contentFolder);
    const fullMeta: ScreenshotMeta = {
      version: meta.version,
      example: meta.example,
      sourceMtime: meta.sourceMtime,
      sourceSize: meta.sourceSize,
      capturedAt: meta.capturedAt || new Date().toISOString(),
      origin,
    };
    const base = cacheBase(componentType, exampleKey);
    store.writeImage(base, image);
    store.writeMeta(base, fullMeta);
    return { success: true };
  } catch (error) {
    log.error({ err: error, componentType }, "Failed to save screenshot");
    return { success: false, error: String(error) };
  }
}

export function deleteScreenshot(
  componentType: string,
  example?: string | null,
  contentFolder?: string,
): { success: boolean; error?: string } {
  try {
    const { store } = storeFor(componentType, contentFolder);
    store.deletePair(cacheBase(componentType, example));
    return { success: true };
  } catch (error) {
    log.error({ err: error, componentType, example }, "Failed to delete screenshot");
    return { success: false, error: String(error) };
  }
}
