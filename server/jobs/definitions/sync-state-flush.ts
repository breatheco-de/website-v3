import { Job } from "sidequest";
import { flushPendingSyncStateWrites } from "../../sync-state";
import { markJobFinished, markJobStarted } from "../heartbeat";
import { child } from "../../logger";

const log = child({ module: "job:sync-state-flush" });

export type SyncStateFlushPayload = {
  site: string;
  contentRoot: string;
};

export class SyncStateFlushJob extends Job {
  async run(payload: SyncStateFlushPayload): Promise<{ ok: boolean }> {
    markJobStarted("sync_state_flush");
    try {
      flushPendingSyncStateWrites(payload.contentRoot);
      log.info({ site: payload.site }, "[SyncStateFlushJob] flushed sync state");
      return { ok: true };
    } finally {
      markJobFinished("sync_state_flush");
    }
  }
}
