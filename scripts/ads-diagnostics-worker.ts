/**
 * Forked Ads diagnostics worker — full Runs and big-scope Re-checks off the Express event loop.
 * Started by server/ads/diagnostics/fork-service.ts (child_process.fork + tsx). Writes a result
 * file and reports over IPC; the web process saves results into the validation cache.
 */

import { runAdsChecks } from "../server/ads/diagnostics/engine";
import { writeAdsJobResult } from "../server/ads/diagnostics/jobs";
import { lightContentIndex } from "../server/ads/diagnostics/light-index";
import type { AdsWorkerOutboundMessage, AdsWorkerStartMessage } from "../server/ads/diagnostics/fork-service";

/** Parent web may pass WEBLIFY_PROCESS=web; index_refresh enqueue is web-only. */
delete process.env.WEBLIFY_PROCESS;

function send(msg: AdsWorkerOutboundMessage): void {
  if (typeof process.send === "function") process.send(msg);
  else console.error("[ads-diagnostics-worker] no IPC channel", msg);
}

async function handleStart(msg: AdsWorkerStartMessage): Promise<void> {
  try {
    const result = await runAdsChecks({
      site: msg.site,
      contentRoot: msg.contentRoot,
      jobId: msg.job_id,
      kind: msg.kind,
      mode: msg.mode,
      platforms: msg.platforms,
      pending: msg.pending,
      scopes: msg.scopes,
      refreshMeta: msg.refreshMeta,
      requestedBy: msg.requested_by ?? null,
      ...(msg.contentRoot ? { contentIndex: lightContentIndex(msg.site, msg.contentRoot) } : {}),
      onStep: (message) => send({ type: "progress", job_id: msg.job_id, message }),
    });
    const resultsPath = writeAdsJobResult(msg.site, result);
    send({ type: "completed", job_id: msg.job_id, results_path: resultsPath });
  } catch (err) {
    send({ type: "failed", job_id: msg.job_id, error: err instanceof Error ? err.message : String(err) });
  }
}

process.on("message", (raw: unknown) => {
  const msg = raw as AdsWorkerStartMessage;
  if (msg?.type === "start") void handleStart(msg);
});

process.on("disconnect", () => process.exit(0));
