import { Job } from "sidequest";
import { ValidationCacheService } from "../../services/validationCacheService";
import {
  queueLinkIndexRemove,
  flushLinkIndexPendingSync,
} from "../../link-index";
import { child } from "../../logger";

const log = child({ module: "job:entry-delete-cleanup" });

export type EntryDeleteCleanupPayload = {
  site: string;
  contentRoot: string;
  entryKeys: string[];
};

export class EntryDeleteCleanupJob extends Job {
  async run(payload: EntryDeleteCleanupPayload): Promise<{ ok: boolean }> {
    const { contentRoot, entryKeys } = payload;
    if (entryKeys.length === 0) {
      return { ok: true };
    }

    const cache = new ValidationCacheService(contentRoot);
    cache.setSkipGcsUpload(true);
    for (const entryKey of entryKeys) {
      cache.clearEntryKey(entryKey);
    }
    await cache.flush();

    queueLinkIndexRemove(entryKeys, contentRoot);
    flushLinkIndexPendingSync(contentRoot);

    log.info(
      { site: payload.site, entryKeys: entryKeys.length },
      "[EntryDeleteCleanupJob] cache cleared and link-index remove queued",
    );
    return { ok: true };
  }
}
