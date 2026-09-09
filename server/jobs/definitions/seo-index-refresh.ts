import path from "path";
import { Job } from "sidequest";
import { invalidateSeoIndexCache, rebuildSeoIndex, loadSeoIndex } from "../../seo-index";
import { ContentIndex } from "../../content-index";
import { MediaGallery } from "../../media-gallery";
import { DatabaseManager } from "../../database";
import { emitEvent } from "../../events/event-store";
import { child } from "../../logger";
import { markJobFinished, markJobStarted } from "../heartbeat";

const log = child({ module: "job:seo-index-refresh" });

export type SeoIndexRefreshPayload = {
  site: string;
  contentRoot: string;
  generation: number;
  /** Always treated as full rebuild; kept for event payload compatibility. */
  mode?: "patch" | "rebuild";
  triggeredByEventId?: number;
  entryKeys?: string[];
};

/**
 * Full rebuild of seo-index.json from live YAML.
 * Uses a fresh ContentIndex for this contentRoot (never the web/worker singleton),
 * matching IndexRefreshJob — otherwise path resolution drifts after content pulls.
 */
export class SeoIndexRefreshJob extends Job {
  async run(payload: SeoIndexRefreshPayload): Promise<{ ok: boolean }> {
    markJobStarted("seo_index_refresh");
    try {
      const { site, contentRoot } = payload;
      const contentRootName = path.relative(process.cwd(), contentRoot);
      const mg = new MediaGallery(contentRootName);
      const database = new DatabaseManager(contentRoot, mg);
      const ci = new ContentIndex(contentRootName, database);
      ci.scanFast();
      ci.scanSlow();

      rebuildSeoIndex({
        contentRoot,
        ci,
        reason: "seo_index_refresh",
      });

      invalidateSeoIndexCache();
      try {
        const index = loadSeoIndex(contentRoot);
        log.info(
          { site, mode: "rebuild", entries: Object.keys(index.entries).length },
          "[SeoIndexRefreshJob] completed",
        );
      } catch {
        /* non-fatal */
      }

      emitEvent({
        site,
        type: "seo_index_ready",
        triggeredByEventId: payload.triggeredByEventId,
        payload: {
          generation: payload.generation,
          mode: "rebuild",
          entryKeys: payload.entryKeys ?? [],
        },
      });

      return { ok: true };
    } finally {
      markJobFinished("seo_index_refresh");
    }
  }
}
