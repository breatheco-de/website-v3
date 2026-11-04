import { Job } from "sidequest";
import { child } from "../../logger";
import { markJobFinished, markJobStarted } from "../heartbeat";
import { runIndexNowSubmit, type IndexNowSubmitPayload } from "../../indexnow";

const log = child({ module: "job:indexnow-submit" });

export class IndexNowSubmitJob extends Job {
  async run(payload: IndexNowSubmitPayload): Promise<{ ok: boolean; status?: string }> {
    markJobStarted("indexnow_submit");
    try {
      if (!payload?.site || !payload.contentRoot) return { ok: false };
      const result = await runIndexNowSubmit(payload);
      log.info({ site: payload.site, mode: payload.mode ?? "changes", ...result }, "IndexNow run finished");
      return { ok: true, status: result.status };
    } finally {
      markJobFinished("indexnow_submit");
    }
  }
}
