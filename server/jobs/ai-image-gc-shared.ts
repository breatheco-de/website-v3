/**
 * Shared AI image GC: eligibility check, unregister, emit audit event, enqueue job.
 */
import type { ImageEntry } from "@shared/schema";
import {
  isAiOrigin,
  isAiImagePastGrace,
  AI_IMAGE_GC_GRACE_MS,
} from "@shared/ai-image-gc";
import type { MediaGallery } from "../media-gallery";
import { emitEvent, singleAttribution } from "../events/event-store";
import { enqueueJob } from "./queue";
import { child } from "../logger";

const log = child({ module: "job:ai-image-gc" });

export const AI_IMAGE_GC_DELAY_MS = AI_IMAGE_GC_GRACE_MS;

export type AiImageGcPayload = {
  site: string;
  contentRoot: string;
  imageId: string;
};

export function isAiImageEligibleForGc(
  gallery: MediaGallery,
  imageId: string,
  entry: ImageEntry,
  nowMs = Date.now(),
): { ok: true } | { ok: false; reason: string } {
  if (!isAiOrigin(entry)) return { ok: false, reason: "not_ai" };
  if (entry.protected) return { ok: false, reason: "protected" };

  const srcsetUrls = Array.isArray(entry.srcset) ? entry.srcset.map((s) => s.url) : [];
  const usage = gallery.getUsage(imageId, entry.src, srcsetUrls);
  if (usage.length > 0) return { ok: false, reason: "in_use" };

  if (!isAiImagePastGrace(entry, nowMs)) return { ok: false, reason: "in_grace" };

  return { ok: true };
}

export async function unregisterAiImageAndEmit(opts: {
  gallery: MediaGallery;
  site: string;
  imageId: string;
  registryRelativePath: string;
}): Promise<{ deleted: boolean; reason?: string }> {
  const { gallery, site, imageId, registryRelativePath } = opts;
  const registry = gallery.getRegistry();
  if (!registry) return { deleted: false, reason: "no_registry" };

  const entry = registry.images[imageId];
  if (!entry) return { deleted: false, reason: "not_found" };

  const eligible = isAiImageEligibleForGc(gallery, imageId, entry);
  if (!eligible.ok) return { deleted: false, reason: eligible.reason };

  const src = entry.src;
  const last_impression_at = entry.last_impression_at;
  const generated_at = entry.ai?.generated_at;

  const result = await gallery.unregister(imageId);
  if (!result.success) {
    return { deleted: false, reason: result.error || "unregister_failed" };
  }

  emitEvent({
    site,
    type: "ai_image_gc_completed",
    attribution: singleAttribution(undefined, { type: "system", source: "ai-image-gc" }),
    resource: { path: registryRelativePath },
    payload: {
      imageId,
      src,
      reason: "unused_past_grace",
      ...(last_impression_at ? { last_impression_at } : {}),
      ...(generated_at ? { generated_at } : {}),
    },
  });

  log.info({ site, imageId }, "[ai-image-gc] deleted unused AI image");
  return { deleted: true };
}

export async function enqueueAiImageGc(opts: {
  site: string;
  contentRoot: string;
  imageId: string;
  delayMs?: number;
}): Promise<void> {
  try {
    await enqueueJob(
      "ai_image_gc",
      {
        site: opts.site,
        contentRoot: opts.contentRoot,
        imageId: opts.imageId,
      },
      {
        delayMs: opts.delayMs,
        uniqueKey: `ai-gc:${opts.imageId}`,
        uniqueWithArgs: true,
      },
    );
  } catch (err) {
    log.warn({ err, imageId: opts.imageId }, "[ai-image-gc] enqueue failed");
  }
}
