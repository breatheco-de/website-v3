import { Job } from "sidequest";
import { child } from "../../logger";
import { markJobFinished, markJobStarted } from "../heartbeat";
import { runPublicUrlScanForSite } from "../../public-url-changes/run-scan";
import { enqueueIndexNowSubmit } from "../../indexnow";

const log = child({ module: "job:public-url-changes-scan" });

export type PublicUrlChangesScanPayload = {
  site: string;
  contentRoot: string;
  /** Uniqueness only: events in the same window share one scan. */
  window?: number;
};

export class PublicUrlChangesScanJob extends Job {
  async run(payload: PublicUrlChangesScanPayload): Promise<{ ok: boolean; status?: string }> {
    markJobStarted("public_url_changes_scan");
    try {
      if (!payload?.site || !payload.contentRoot) return { ok: false };
      const result = runPublicUrlScanForSite(payload.site, payload.contentRoot);
      const changed = result.published + result.updated + result.moved + result.removed;
      if (result.status === "ok" && changed > 0) {
        await enqueueIndexNowSubmit({ site: payload.site, contentRoot: payload.contentRoot });
      }
      log.info({ site: payload.site, ...result }, "public URL scan finished");
      return { ok: true, status: result.status };
    } finally {
      markJobFinished("public_url_changes_scan");
    }
  }
}
