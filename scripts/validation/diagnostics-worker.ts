/**
 * Forked diagnostics worker — runs validators off the Express event loop.
 * Started via child_process.fork with tsx. Communicates progress over IPC.
 *
 * Site-wide jobs exit after one start. The shared child stays up until the
 * parent sends `stop` (queue empty). It never writes the issues cache.
 */

import * as fs from "fs";
import * as path from "path";
import { ContentIndex } from "../../server/content-index";
import { MediaGallery } from "../../server/media-gallery";
import { DatabaseManager } from "../../server/database";
import { ValidationCacheService } from "../../server/services/validationCacheService";
import { randomUUID } from "node:crypto";
import { flushTick, startTick } from "../../server/process-stats";
import { runDiagnosticsJob } from "./runDiagnosticsJob";
import { runOffThreadJob } from "./runOffThreadJob";
import type {
  DiagnosticsWorkerInboundMessage,
  DiagnosticsWorkerOutboundMessage,
  DiagnosticsWorkerStartMessage,
} from "./diagnosticsIpc";
import { registerJobClass } from "../../server/jobs/queue";
import { AiImageGcJob } from "../../server/jobs/definitions/ai-image-gc";

/**
 * Marks this process as the forked diagnostics worker.
 * Registers ai_image_gc for catch-up enqueue; index_refresh is web-only
 * (`WEBLIFY_PROCESS=web`).
 */
process.env.DIAGNOSTICS_WORKER = "1";
registerJobClass("ai_image_gc", AiImageGcJob);

function send(msg: DiagnosticsWorkerOutboundMessage): void {
  if (typeof process.send === "function") {
    process.send(msg);
  } else {
    console.error("[diagnostics-worker] no IPC channel", msg);
  }
}

async function bootstrapSite(contentRoot: string, contentRootName: string): Promise<{
  ci: ContentIndex;
  cache: ValidationCacheService;
}> {
  const contentFolder = contentRootName || path.relative(process.cwd(), contentRoot);
  const mg = new MediaGallery(contentFolder);
  const database = new DatabaseManager(contentRoot, mg);
  const ci = new ContentIndex(contentFolder, database);
  ci.getStats();

  const cache = new ValidationCacheService(contentRoot);
  cache.setSkipGcsUpload(true);
  return { ci, cache };
}

const siteCache = new Map<string, { ci: ContentIndex; cache: ValidationCacheService }>();

async function siteFor(contentRoot: string, contentRootName: string) {
  const hit = siteCache.get(contentRoot);
  if (hit) return hit;
  const boot = await bootstrapSite(contentRoot, contentRootName);
  siteCache.set(contentRoot, boot);
  return boot;
}

async function handleStart(msg: DiagnosticsWorkerStartMessage): Promise<void> {
  const { jobId, contentRoot, contentRootName, resultsPath } = msg;
  let lastProcessed = 0;
  let lastTotal = 1;
  try {
    send({
      type: "progress",
      jobId,
      processed: 0,
      total: 1,
      status: "running",
      message: "Bootstrapping site context",
    });

    const { ci, cache } = await siteFor(contentRoot, contentRootName);
    const kind = msg.kind ?? "diagnostics";
    const usesDiagnosticsRunner =
      kind === "diagnostics" || kind === "seo-duplicates";

    const output = usesDiagnosticsRunner
      ? await runDiagnosticsJob({
          contentRoot,
          ci,
          cache,
          slugs: msg.slugs,
          urls: msg.urls,
          files: msg.file ? [msg.file] : undefined,
          freshness: msg.freshness,
          max_age_seconds: msg.max_age_seconds,
          validators: kind === "seo-duplicates" ? ["seo-duplicates"] : msg.validators,
          include_artifacts: msg.include_artifacts,
          categories: msg.categories,
          validator_only: msg.validator_only,
          onProgress: (p) => {
            lastProcessed = p.processed;
            lastTotal = p.total;
            send({
              type: "progress",
              jobId,
              processed: p.processed,
              total: p.total,
              staleUrlCount: p.staleUrlCount,
              urlCount: p.urlCount,
              message: p.message,
              status: "running",
            });
          },
        })
      : {
          summary: { errorCount: 0, warningCount: 0 },
          resultsPayload: await runOffThreadJob(msg, ci),
        };

    const payload = "resultsPayload" in output ? output.resultsPayload : output;
    const summary = payload.summary;
    if (!usesDiagnosticsRunner) {
      lastProcessed = 1;
      lastTotal = 1;
    }

    fs.mkdirSync(path.dirname(resultsPath), { recursive: true });
    fs.writeFileSync(resultsPath, JSON.stringify(payload, null, 2) + "\n", "utf-8");

    send({
      type: "completed",
      jobId,
      processed: Math.max(lastProcessed, lastTotal),
      total: lastTotal,
      summary,
      resultsPath,
    });
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    send({ type: "failed", jobId, error });
  }
}

function flushStats(): void {
  try {
    flushTick();
  } catch (err) {
    console.error("[diagnostics-worker] process stats flush failed", err);
  }
}

let reusable = false;
let stopAfter = false;
let working = false;
const inbox: DiagnosticsWorkerStartMessage[] = [];

async function drain(): Promise<void> {
  if (working) return;
  const msg = inbox.shift();
  if (!msg) {
    if (stopAfter || !reusable) {
      flushStats();
      process.exit(0);
    }
    return;
  }
  working = true;
  if (msg.reusable) reusable = true;
  await handleStart(msg);
  working = false;
  if (inbox.length > 0) {
    void drain();
    return;
  }
  if (stopAfter || !reusable) {
    flushStats();
    process.exit(0);
  }
}

process.on("SIGTERM", () => {
  flushStats();
  process.exit(0);
});
process.on("SIGINT", () => {
  flushStats();
  process.exit(0);
});

process.on("message", (raw: DiagnosticsWorkerInboundMessage) => {
  if (!raw || typeof raw !== "object") return;
  if (raw.type === "stop") {
    stopAfter = true;
    if (!working && inbox.length === 0) {
      flushStats();
      process.exit(0);
    }
    return;
  }
  if (raw.type !== "start") return;
  inbox.push(raw);
  void drain();
});

startTick({ processName: "diagnostics-worker", processStartId: randomUUID() });
