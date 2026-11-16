import path from "path";
import { enqueueJob } from "../jobs/queue";
import { getDefaultContentRoot } from "../site-config";
import { child } from "../logger";

const log = child({ module: "llms-txt/enqueue" });

export const LLMS_TXT_REGENERATE_JOB = "llms_txt_regenerate";

export type EnqueueLlmsTxtReason = "staff" | "missing_template";

export async function enqueueLlmsTxtRegenerate(opts: {
  contentRoot?: string;
  siteId?: string;
  reason: EnqueueLlmsTxtReason;
}): Promise<{ queued: boolean; deduped?: boolean; busy?: boolean; siteId: string }> {
  const contentRoot = opts.contentRoot ?? getDefaultContentRoot();
  const siteId =
    opts.siteId ||
    (path.isAbsolute(contentRoot)
      ? path.basename(contentRoot)
      : contentRoot.replace(/\/$/, "").split("/").pop()) ||
    "site";

  const result = await enqueueJob(
    LLMS_TXT_REGENERATE_JOB,
    {
      siteId,
      contentRoot,
      reason: opts.reason,
    },
    {
      uniqueKey: `${LLMS_TXT_REGENERATE_JOB}:${siteId}`,
      uniqueWhileAlive: true,
    },
  );

  if (result.busy) {
    log.warn({ siteId }, "[llms.txt] enqueue skipped — queue busy");
  } else if (!result.queued && !result.deduped) {
    log.warn({ siteId }, "[llms.txt] enqueue failed — job class missing?");
  }

  return { ...result, siteId };
}
