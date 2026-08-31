/**
 * Fixer: ai-unused-images-cleanup
 *
 * Removes AI-origin registry entries that are unused and past the grace window.
 * Emits ai_image_gc_completed for each successful delete.
 */
import type { Fixer, FixerContext, FixerResult } from "./types";
import { mediaGallery } from "../../../server/media-gallery";
import { isAiOrigin, isAiImagePastGrace } from "../../../shared/ai-image-gc";
import { unregisterAiImageAndEmit } from "../../../server/jobs/ai-image-gc-shared";

export const aiUnusedImagesCleanupFixer: Fixer = {
  name: "ai-unused-images-cleanup",
  description:
    "Removes unused AI-generated images past the grace window (48h since last impression or generation)",

  async run(ctx: FixerContext): Promise<FixerResult> {
    const dryRun = Boolean(ctx.dryRun);
    const gallery = mediaGallery;
    const registry = gallery.getRegistry();
    if (!registry) {
      return { ok: false, message: "Failed to load image registry" };
    }

    // Prefer site folder name from registry path via gallery internals when possible
    const site =
      (typeof ctx.contentRootName === "string" && ctx.contentRootName) ||
      (typeof ctx.site === "string" && ctx.site) ||
      "site_4geeks-com";

    const candidates: string[] = [];
    for (const [id, entry] of Object.entries(registry.images)) {
      if (!isAiOrigin(entry)) continue;
      if (entry.protected) continue;
      if (entry.source_url || entry.source_item) continue;
      const srcsetUrls = Array.isArray(entry.srcset) ? entry.srcset.map((s) => s.url) : [];
      const usage = gallery.getUsage(id, entry.src, srcsetUrls);
      if (usage.length > 0) continue;
      if (!isAiImagePastGrace(entry)) continue;
      candidates.push(id);
    }

    ctx.onProgress?.({ type: "start", total: candidates.length });

    let removedCount = 0;
    let skippedCount = 0;
    const results: Array<{ id: string; status: string; reason?: string }> = [];

    for (const imageId of candidates) {
      if (dryRun) {
        results.push({ id: imageId, status: "would-remove" });
        removedCount++;
        ctx.onProgress?.({ type: "item", id: imageId, status: "ok", message: "would-remove" });
        continue;
      }

      const result = await unregisterAiImageAndEmit({
        gallery,
        site,
        imageId,
        registryRelativePath: `${site}/image-registry.json`,
      });

      if (result.deleted) {
        removedCount++;
        results.push({ id: imageId, status: "removed" });
        ctx.onProgress?.({ type: "item", id: imageId, status: "ok", message: "removed" });
      } else {
        skippedCount++;
        results.push({ id: imageId, status: "skipped", reason: result.reason });
        ctx.onProgress?.({
          type: "item",
          id: imageId,
          status: "skipped",
          message: result.reason || "skipped",
        });
      }
    }

    return {
      ok: true,
      message: dryRun
        ? `Would remove ${removedCount} unused AI image(s)`
        : `Removed ${removedCount} unused AI image(s), skipped ${skippedCount}`,
      details: {
        removedCount,
        skippedCount,
        dryRun,
        results,
      },
    };
  },
};
