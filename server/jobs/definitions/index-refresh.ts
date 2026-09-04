import fs from "fs";
import path from "path";
import { Job } from "sidequest";
import { ContentIndex } from "../../content-index";
import { MediaGallery } from "../../media-gallery";
import { DatabaseManager } from "../../database";
import {
  emitEvent,
  getLastSnapshotGeneration,
  getLatestWriteGeneration,
  getWriteEventsBetween,
} from "../../events/event-store";
import { systemJobAttribution } from "../../events/types";
import { child } from "../../logger";
import { markJobFinished, markJobStarted } from "../heartbeat";

const log = child({ module: "job:index-refresh" });

export type IndexRefreshPayload = {
  site: string;
  contentRoot: string;
  generation: number;
};

export class IndexRefreshJob extends Job {
  async run(payload: IndexRefreshPayload): Promise<{ ok: boolean }> {
    markJobStarted("index_refresh");
    try {
    const { site, contentRoot } = payload;
    const contentRootName = path.relative(process.cwd(), contentRoot);
    const mg = new MediaGallery(contentRootName);
    const database = new DatabaseManager(contentRoot, mg);
    const ci = new ContentIndex(contentRootName, database);
    ci.scanFast();
    ci.scanSlow();

    // Stamp at end so generation reflects writes covered by this scan (not pipeline bookkeeping events).
    const generation = Math.max(payload.generation, getLatestWriteGeneration(site));
    const prevCovered = getLastSnapshotGeneration(site);
    const parentWrites = getWriteEventsBetween(site, prevCovered, generation);
    const triggeredByEventIds = parentWrites.map((w) => w.id);
    const attribution = systemJobAttribution("index-refresh");
    const sessionIds = [
      ...new Set(
        parentWrites
          .map((w) => w.agent_session_id)
          .filter((id): id is string => typeof id === "string" && id.length > 0),
      ),
    ];
    const agent_session_id = sessionIds.length === 1 ? sessionIds[0] : undefined;

    const snapshot = ci.exportSnapshot(generation);
    const entryCount = ci.getStats().total;
    const cacheDir = path.join(contentRoot, ".cache", "index-snapshots");
    fs.mkdirSync(cacheDir, { recursive: true });
    const snapshotPath = path.join(cacheDir, `snapshot-${generation}.json`);
    fs.writeFileSync(snapshotPath, JSON.stringify(snapshot), "utf-8");

    emitEvent({
      site,
      type: "index_snapshot_ready",
      triggeredByEventIds,
      attribution,
      agent_session_id,
      payload: { generation, snapshotPath, entryCount },
    });

    log.info(
      { site, generation, snapshotPath, entryCount, parentCount: triggeredByEventIds.length },
      "[IndexRefreshJob] snapshot written",
    );
    return { ok: true };
    } finally {
      markJobFinished("index_refresh");
    }
  }
}
