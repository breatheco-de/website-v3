/**
 * In-memory AI image impression buffer.
 * Public beacon updates this map; a timer flushes to image-registry.json.
 */
import type { MediaGallery } from "./media-gallery";
import { child } from "./logger";

const log = child({ module: "media-impressions" });

const DEBOUNCE_MS = 60 * 60 * 1000; // 1 hour per id
const FLUSH_INTERVAL_MS = 10 * 60 * 1000; // 10 minutes

type ImpressionRecord = { at: string; lastBumpMs: number };

/** contentRootName → imageId → record */
const buffers = new Map<string, Map<string, ImpressionRecord>>();

let flushTimer: ReturnType<typeof setInterval> | null = null;
let galleryResolver: ((contentRootName: string) => MediaGallery | null) | null = null;

export function configureImpressionFlush(
  resolveGallery: (contentRootName: string) => MediaGallery | null,
): void {
  galleryResolver = resolveGallery;
  if (flushTimer) return;
  flushTimer = setInterval(() => {
    void flushAllImpressionBuffers().catch((err) => {
      log.warn({ err }, "[impressions] flush failed");
    });
  }, FLUSH_INTERVAL_MS);
  if (typeof flushTimer.unref === "function") flushTimer.unref();
}

export function recordImageImpression(
  contentRootName: string,
  imageId: string,
  isAi: boolean,
): { accepted: boolean } {
  if (!isAi || !imageId.trim()) return { accepted: false };

  let siteMap = buffers.get(contentRootName);
  if (!siteMap) {
    siteMap = new Map();
    buffers.set(contentRootName, siteMap);
  }

  const now = Date.now();
  const existing = siteMap.get(imageId);
  if (existing && now - existing.lastBumpMs < DEBOUNCE_MS) {
    return { accepted: false };
  }

  siteMap.set(imageId, { at: new Date(now).toISOString(), lastBumpMs: now });
  return { accepted: true };
}

export async function flushImpressionBuffer(
  contentRootName: string,
  gallery: MediaGallery,
): Promise<number> {
  const siteMap = buffers.get(contentRootName);
  if (!siteMap || siteMap.size === 0) return 0;

  const registry = gallery.getRegistry();
  if (!registry) return 0;

  let updated = 0;
  const flushedIds: string[] = [];
  for (const [id, rec] of siteMap) {
    const entry = registry.images[id];
    if (!entry || entry.origin !== "ai") {
      flushedIds.push(id);
      continue;
    }
    const prev = entry.last_impression_at ? Date.parse(entry.last_impression_at) : 0;
    const next = Date.parse(rec.at);
    if (!Number.isNaN(next) && next >= prev) {
      (entry as { last_impression_at?: string }).last_impression_at = rec.at;
      updated++;
    }
    flushedIds.push(id);
  }

  for (const id of flushedIds) siteMap.delete(id);
  if (siteMap.size === 0) buffers.delete(contentRootName);

  if (updated > 0) {
    gallery.persistRegistry();
    log.info({ contentRootName, updated }, "[impressions] flushed to registry");
  }
  return updated;
}

export async function flushAllImpressionBuffers(): Promise<void> {
  if (!galleryResolver) return;
  for (const contentRootName of [...buffers.keys()]) {
    const gallery = galleryResolver(contentRootName);
    if (!gallery) continue;
    await flushImpressionBuffer(contentRootName, gallery);
  }
}
