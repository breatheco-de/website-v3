/**
 * Applies worker results (snapshots, validation) to the live web process.
 */

import fs from "fs";
import { listEvents, getLatestWriteGeneration } from "../events/event-store";
import { primaryAuthor } from "../events/types";
import type { IndexSnapshot } from "../content-index-snapshot";
import { getSiteContextMap } from "../site-manager";
import { collectEntryHtmlPaths, flushAfterContentWrites } from "../content-write-flush";
import {
  getPersistedLastAppliedIndex,
  setPersistedLastAppliedIndex,
  getPersistedLastAppliedSeoIndex,
  setPersistedLastAppliedSeoIndex,
} from "../pipeline-state";
import { markFileAsModified } from "../sync-state";
import { runInSaveBatch } from "../events/save-batch-context";
import { invalidateSeoIndexCache } from "../seo-index";
import { enqueueJob } from "./queue";
import { wakeEventDispatcher } from "../events/dispatcher";
import { child } from "../logger";
import {
  queueLinkIndexSet,
  flushLinkIndexPending,
} from "../link-index";
import {
  collectOutboundPathsFromData,
  entryIdFromContentFile,
} from "../link-extract";
import { createPublicUrlResolver } from "../redirects";
import { processPendingAdsResults } from "../ads/diagnostics/save";
import { recoverInterruptedAdsRuns } from "../ads/diagnostics/fork-service";
import { removeLegacyAdsDiagnosticsFiles } from "../ads/diagnostics/jobs";

const log = child({ module: "job-applier" });

let timer: ReturnType<typeof setInterval> | null = null;

const lastAppliedSnapshot = new Map<string, { generation: number; appliedAt: number }>();
const lastAppliedSeoSnapshot = new Map<string, { generation: number; appliedAt: number }>();
const refreshEnqueuePending = new Set<string>();
/** Max binding_propagation_done id already applied for CMS side-effects (mark/auto-commit). */
const lastAppliedBindingDoneId = new Map<string, number>();
/** Max cluster_hub_path_rewrite_done id already applied for markFileAsModified. */
const lastAppliedClusterHubRewriteDoneId = new Map<string, number>();

function recordLastApplied(site: string, generation: number): void {
  const prev = lastAppliedSnapshot.get(site);
  if (prev && prev.generation >= generation) return;
  const state = { generation, appliedAt: Date.now() };
  lastAppliedSnapshot.set(site, state);
  setPersistedLastAppliedIndex(site, generation, state.appliedAt);
}

function recordLastAppliedSeo(site: string, generation: number): void {
  const prev = lastAppliedSeoSnapshot.get(site);
  if (prev && prev.generation >= generation) return;
  const state = { generation, appliedAt: Date.now() };
  lastAppliedSeoSnapshot.set(site, state);
  setPersistedLastAppliedSeoIndex(site, generation, state.appliedAt);
}

function hydrateLastAppliedSeo(site: string): void {
  if (lastAppliedSeoSnapshot.has(site)) return;
  const persisted = getPersistedLastAppliedSeoIndex(site);
  if (persisted) {
    lastAppliedSeoSnapshot.set(site, persisted);
  }
}

export function getLastAppliedSeoSnapshot(site: string): { generation: number; appliedAt: number } | null {
  hydrateLastAppliedSeo(site);
  return lastAppliedSeoSnapshot.get(site) ?? null;
}

function hydrateLastApplied(site: string): void {
  if (lastAppliedSnapshot.has(site)) return;
  const persisted = getPersistedLastAppliedIndex(site);
  if (persisted) {
    lastAppliedSnapshot.set(site, persisted);
  }
}

export function getLastAppliedSnapshot(site: string): { generation: number; appliedAt: number } | null {
  hydrateLastApplied(site);
  return lastAppliedSnapshot.get(site) ?? null;
}

/** Generation 0 is a real snapshot (boot, before any write event). Missing or NaN is not. */
export function snapshotGeneration(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : null;
}

/** A snapshot applies when none has been applied yet, or this generation is newer. */
export function isNewerSnapshot(generation: number, lastApplied: number | null): boolean {
  return lastApplied == null || generation > lastApplied;
}

export type SnapshotDecision = "apply" | "already-applied" | "stale";

/**
 * A restart drops the in-memory index. The persisted generation can be ahead of a
 * new snapshot (dev wipes the event log back to 0). That snapshot still has to load
 * while the slow phase is empty. Once the slow phase is in memory, an older
 * generation is discarded. A snapshot behind the latest write is always stale.
 */
export function decideSnapshot(opts: {
  generation: number;
  lastApplied: number | null;
  slowPhaseReady: boolean;
  latestWriteGen: number;
}): SnapshotDecision {
  if (opts.latestWriteGen > opts.generation) return "stale";
  if (!opts.slowPhaseReady || isNewerSnapshot(opts.generation, opts.lastApplied)) return "apply";
  return "already-applied";
}

function deleteSnapshotFile(snapshotPath: string): void {
  try {
    fs.unlinkSync(snapshotPath);
  } catch {
    /* non-fatal */
  }
}

function maybeEnqueueIndexRefresh(site: string, contentRoot: string, generation: number): void {
  if (refreshEnqueuePending.has(site)) return;
  refreshEnqueuePending.add(site);
  void enqueueJob(
    "index_refresh",
    { site, contentRoot, generation },
    { uniqueKey: `index:${site}`, uniqueWithArgs: false },
  ).finally(() => {
    refreshEnqueuePending.delete(site);
  });
}

export function startJobApplier(): void {
  if (timer) return;
  for (const ctx of Array.from(getSiteContextMap().values())) {
    try {
      recoverInterruptedAdsRuns(ctx.contentRootName);
      removeLegacyAdsDiagnosticsFiles(ctx.contentRootName);
    } catch (err) {
      log.warn({ err, site: ctx.contentRootName }, "[Applier] Ads Run recovery failed");
    }
  }
  const tick = () => {
    wakeEventDispatcher();
    for (const ctx of Array.from(getSiteContextMap().values())) {
      void processPendingAdsResults(ctx.contentRootName).catch((err) =>
        log.warn({ err, site: ctx.contentRootName }, "[Applier] Ads results save failed"),
      );
      try {
        hydrateLastApplied(ctx.contentRootName);
        hydrateLastAppliedSeo(ctx.contentRootName);
        applyPendingSnapshots(
          ctx.contentRootName,
          ctx.contentIndex,
          ctx.validationCache,
          ctx.contentRoot,
        );
      } catch (err) {
        log.error({ err, site: ctx.contentRootName }, "[Applier] tick failed");
      }
    }
  };
  tick();
  timer = setInterval(tick, 2000);
  timer.unref();
}

async function applyPendingSnapshots(
  site: string,
  ci: import("../content-index").ContentIndex,
  cache: import("../services/validationCacheService").ValidationCacheService,
  contentRoot: string,
): Promise<void> {
  const latestWriteGen = getLatestWriteGeneration(site);
  const lastApplied = getLastAppliedSnapshot(site)?.generation ?? null;

  const events = listEvents({ site, type: "index_snapshot_ready", limit: 30 });
  const candidates: Array<{ generation: number; snapshotPath: string }> = [];
  for (const event of events) {
    const snapshotPath = event.payload.snapshotPath as string | undefined;
    const generation = snapshotGeneration(event.payload.generation);
    if (!snapshotPath || generation == null || !fs.existsSync(snapshotPath)) continue;
    candidates.push({ generation, snapshotPath });
  }

  candidates.sort((a, b) => b.generation - a.generation);

  let appliedGeneration = lastApplied;
  for (const { generation, snapshotPath } of candidates) {
    const decision = decideSnapshot({
      generation,
      lastApplied: appliedGeneration,
      slowPhaseReady: ci.isSlowPhaseReady(),
      latestWriteGen,
    });
    if (decision === "already-applied") {
      deleteSnapshotFile(snapshotPath);
      continue;
    }
    if (decision === "stale") {
      log.debug({ site, generation, latestWriteGen }, "[Applier] dropping stale snapshot");
      deleteSnapshotFile(snapshotPath);
      continue;
    }
    try {
      const raw = fs.readFileSync(snapshotPath, "utf-8");
      const snapshot = JSON.parse(raw) as IndexSnapshot;
      const applied = ci.applySnapshot(snapshot, latestWriteGen);
      if (applied) {
        recordLastApplied(site, generation);
        appliedGeneration = generation;
        log.info({ site, generation }, "[Applier] snapshot applied");
        deleteSnapshotFile(snapshotPath);
        break;
      }
    } catch (err) {
      log.warn({ err, site, snapshotPath }, "[Applier] snapshot apply failed");
    }
  }

  const effectiveLastApplied = getLastAppliedSnapshot(site)?.generation ?? 0;
  if (latestWriteGen > effectiveLastApplied) {
    maybeEnqueueIndexRefresh(site, contentRoot, latestWriteGen);
  }

  const valEvents = listEvents({ site, type: "validation_results_ready", limit: 10 });
  for (const event of valEvents) {
    const resultsPath = event.payload.resultsPath as string | undefined;
    if (!resultsPath || !fs.existsSync(resultsPath)) continue;
    try {
      const raw = fs.readFileSync(resultsPath, "utf-8");
      const parsed = JSON.parse(raw) as {
        validators?: import("../../scripts/validation/service").ValidatorResult[];
        entryKeys?: string[];
      };
      if (parsed.validators) {
        cache.applyValidatorResults(parsed.validators, {
          contentFiles: [],
          entryKeys: parsed.entryKeys,
          markSiteWide: false,
        });
        await cache.flush();
      }
      fs.unlinkSync(resultsPath);
    } catch (err) {
      log.warn({ err, resultsPath }, "[Applier] validation apply failed");
    }
  }

  const seoEvents = listEvents({ site, type: "seo_index_ready", limit: 10 });
  for (const event of seoEvents) {
    const generation = snapshotGeneration(event.payload.generation);
    if (generation == null) continue;
    const lastSeo = getLastAppliedSeoSnapshot(site)?.generation ?? null;
    if (!isNewerSnapshot(generation, lastSeo)) continue;
    invalidateSeoIndexCache();
    recordLastAppliedSeo(site, generation);
    log.info({ site, generation }, "[Applier] seo index cache invalidated");
    break;
  }

  const bindEvents = listEvents({ site, type: "binding_propagation_done", limit: 5 });
  // Newest first from listEvents — apply oldest-unseen first within the batch.
  const pendingBind = bindEvents
    .filter((e) => e.id > (lastAppliedBindingDoneId.get(site) ?? 0))
    .sort((a, b) => a.id - b.id);

  for (const event of pendingBind) {
    const updatedFiles = (event.payload.updatedFiles as string[]) ?? [];
    const updatedPaths = (event.payload.updatedPaths as string[]) ?? [];
    const author =
      (typeof event.payload.author === "string" ? event.payload.author : undefined) ||
      primaryAuthor(event);

    // Host-process mark: auto-commit + entry event listeners (job bundle cannot).
    runInSaveBatch({ suppressPipelineEmit: true, reason: "binding_propagation" }, () => {
      for (const filePath of updatedPaths) {
        if (typeof filePath === "string" && filePath.length > 0) {
          markFileAsModified(filePath, author);
        }
      }
    });

    if (updatedFiles.length > 0) {
      const locale = (event.payload.locale as string) || "en";
      const publicUrls = createPublicUrlResolver(ci);
      for (const bound of updatedFiles) {
        const [boundType, boundSlug] = bound.split("/");
        if (!boundType || !boundSlug) continue;
        try {
          const merged = ci.loadMergedContent(boundType, boundSlug, locale);
          if (merged.data) {
            const paths = collectOutboundPathsFromData(
              merged.data as Record<string, unknown>,
              locale,
              publicUrls,
            );
            queueLinkIndexSet(
              entryIdFromContentFile(boundType, boundSlug, locale),
              paths,
              contentRoot,
            );
          }
        } catch {
          /* non-fatal */
        }
      }
      const htmlPaths: string[] = [];
      for (const bound of updatedFiles) {
        const [boundType, boundSlug] = bound.split("/");
        if (boundType && boundSlug) {
          htmlPaths.push(...collectEntryHtmlPaths(ci, boundType, boundSlug, locale));
        }
      }
      if (htmlPaths.length > 0) {
        void import("../html-rebuild")
          .then(({ scheduleSavedHtmlPaths, scheduleContentTypeListingRebuild }) => {
            scheduleSavedHtmlPaths(site, htmlPaths, contentRoot);
            for (const contentType of new Set(updatedFiles.map((f) => f.split("/")[0]!).filter(Boolean))) {
              scheduleContentTypeListingRebuild({ siteId: site, contentRoot, contentType });
            }
          })
          .catch(() => {});
      }
      flushAfterContentWrites({
        ci,
        contentTypes: updatedFiles.map((f) => f.split("/")[0]!).filter(Boolean),
        sitemapEntries: updatedFiles.map((f) => {
          const [t, s] = f.split("/");
          return { contentType: t!, slug: s!, locale };
        }),
        siteId: site,
      });
    }

    lastAppliedBindingDoneId.set(site, event.id);
    log.info(
      { site, eventId: event.id, files: updatedPaths.length },
      "[Applier] binding_propagation_done side-effects applied",
    );
  }

  const clusterRewriteEvents = listEvents({ site, type: "cluster_hub_path_rewrite_done", limit: 5 });
  const pendingClusterRewrite = clusterRewriteEvents
    .filter((e) => e.id > (lastAppliedClusterHubRewriteDoneId.get(site) ?? 0))
    .sort((a, b) => a.id - b.id);

  for (const event of pendingClusterRewrite) {
    const updatedPaths = (event.payload.updatedPaths as string[]) ?? [];
    const author =
      (typeof event.payload.author === "string" ? event.payload.author : undefined) ||
      primaryAuthor(event);

    runInSaveBatch({ suppressPipelineEmit: true, reason: "hub_seo_rewrite" }, () => {
      for (const filePath of updatedPaths) {
        if (typeof filePath === "string" && filePath.length > 0) {
          markFileAsModified(filePath, author);
        }
      }
    });

    lastAppliedClusterHubRewriteDoneId.set(site, event.id);
    log.info(
      { site, eventId: event.id, files: updatedPaths.length },
      "[Applier] cluster_hub_path_rewrite_done side-effects applied",
    );
  }

  void flushLinkIndexPending(contentRoot);
}

export function stopJobApplier(): void {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
}
