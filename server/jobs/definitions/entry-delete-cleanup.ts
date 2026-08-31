import { Job } from "sidequest";
import { ValidationCacheService } from "../../services/validationCacheService";
import {
  queueLinkIndexRemove,
  flushLinkIndexPendingSync,
} from "../../link-index";
import {
  queueRelationIndexRemove,
  queueRelationIndexStripTarget,
  flushRelationIndexPendingSync,
} from "../../relation-index";
import { child } from "../../logger";

const log = child({ module: "job:entry-delete-cleanup" });

export type EntryDeleteCleanupPayload = {
  site: string;
  contentRoot: string;
  entryKeys: string[];
};

/** Map link-style keys (type/slug/locale) to relation keys (type/slug). */
function relationKeysFromEntryKeys(entryKeys: string[]): string[] {
  const out = new Set<string>();
  for (const key of entryKeys) {
    const parts = key.split("/");
    if (parts.length >= 2) out.add(`${parts[0]}/${parts[1]}`);
    else out.add(key);
  }
  return [...out];
}

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

    const relKeys = relationKeysFromEntryKeys(entryKeys);
    queueRelationIndexRemove(relKeys, contentRoot);
    for (const key of relKeys) {
      queueRelationIndexStripTarget(key, contentRoot);
    }
    flushRelationIndexPendingSync(contentRoot);

    log.info(
      { site: payload.site, entryKeys: entryKeys.length },
      "[EntryDeleteCleanupJob] cache cleared; link + relation index remove queued",
    );
    return { ok: true };
  }
}
