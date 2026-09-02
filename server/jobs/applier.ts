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

const log = child({ module: "job-applier" });

let timer: ReturnType<typeof setInterval> | null = null;

const lastAppliedSnapshot = new Map<string, { generation: number; appliedAt: number }>();
const lastAppliedSeoSnapshot = new Map<string, { generation: number; appliedAt: number }>();
const refreshEnqueuePending = new Set<string>();
/** Max binding_propagation_done id already applied for CMS side-effects (mark/auto-commit). */
const lastAppliedBindingDoneId = new Map<string, number>();

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
  const tick = () => {
    for (const ctx of getSiteContextMap().values()) {
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
  const lastApplied = getLastAppliedSnapshot(site)?.generation ?? 0;

  const events = listEvents({ site, type: "index_snapshot_ready", limit: 30 });
  const candidates: Array<{ generation: number; snapshotPath: string }> = [];
  for (const event of events) {
    const snapshotPath = event.payload.snapshotPath as string | undefined;
    const generation = event.payload.generation as number | undefined;
    if (!snapshotPath || !generation || !fs.existsSync(snapshotPath)) continue;
    candidates.push({ generation, snapshotPath });
  }

  candidates.sort((a, b) => b.generation - a.generation);

  let appliedGeneration = lastApplied;
  for (const { generation, snapshotPath } of candidates) {
    if (generation <= appliedGeneration) {
      deleteSnapshotFile(snapshotPath);
      continue;
    }
    if (latestWriteGen > generation) {
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
    const generation = event.payload.generation as number | undefined;
    if (!generation) continue;
    const lastSeo = getLastAppliedSeoSnapshot(site)?.generation ?? 0;
    if (generation <= lastSeo) continue;
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
      flushAfterContentWrites({
        ci,
        contentTypes: updatedFiles.map((f) => f.split("/")[0]!).filter(Boolean),
        sitemapEntries: updatedFiles.map((f) => {
          const [t, s] = f.split("/");
          return { contentType: t!, slug: s!, locale };
        }),
        siteId: site,
        htmlPaths,
      });
    }

    lastAppliedBindingDoneId.set(site, event.id);
    log.info(
      { site, eventId: event.id, files: updatedPaths.length },
      "[Applier] binding_propagation_done side-effects applied",
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
