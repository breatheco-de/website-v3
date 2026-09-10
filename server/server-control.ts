import crypto from "crypto";
import { reloadSiteConfigs, snapshotSiteConfigs, restoreSiteConfigs } from "./site-config";
import {
  rebuildSiteContextMap,
  getSiteContextMap,
  snapshotSiteContextMap,
  restoreSiteContextMap,
} from "./site-manager";
import { scanProductContent as scanEcommerceContent } from "./product/product-index";
import { clearImageRegistryCache } from "./image-registry";
import { child } from "./logger";

const log = child({ module: "server-control" });

/**
 * Process boot identifier — generated once when this module is first loaded
 * (i.e. once per process). Clients compare this against a previously observed
 * value to detect when a restarted process has come back online.
 */
export const BOOT_ID = crypto.randomUUID();

/** Epoch millis when this process started (module load time). */
export const BOOT_TIME = Date.now();

let lastSoftReloadAt: string | null = null;
let lastSoftReloadId: string | null = null;

export function getLastSoftReload(): { at: string | null; id: string | null } {
  return { at: lastSoftReloadAt, id: lastSoftReloadId };
}

/** Record that a soft reload just completed. Returns the new marker. */
export function markSoftReload(): { at: string; id: string } {
  lastSoftReloadAt = new Date().toISOString();
  lastSoftReloadId = crypto.randomUUID();
  return { at: lastSoftReloadAt, id: lastSoftReloadId };
}

// ─── Graceful shutdown bridge ─────────────────────────────────────────────────
// gracefulShutdown lives inside the server bootstrap IIFE in index.ts. It is
// registered here so a staff-gated admin route can trigger it without importing
// server internals (and without duplicating its 10s force-exit safety logic).

type ShutdownFn = (signal: string) => void | Promise<void>;
let shutdownHandler: ShutdownFn | null = null;

export function registerShutdownHandler(fn: ShutdownFn): void {
  shutdownHandler = fn;
}

export function isShutdownHandlerRegistered(): boolean {
  return shutdownHandler !== null;
}

/**
 * Trigger the registered graceful shutdown. Returns false if no handler is
 * registered (in which case the caller should report the restart as unavailable).
 */
export function triggerGracefulShutdown(signal = "ADMIN_HARD_RESTART"): boolean {
  if (!shutdownHandler) return false;
  log.warn({ signal }, "[ServerControl] Hard restart requested — initiating graceful shutdown");
  void Promise.resolve(shutdownHandler(signal)).catch((err) => {
    log.error({ err }, "[ServerControl] Error while triggering graceful shutdown");
  });
  return true;
}

// ─── Soft reload ──────────────────────────────────────────────────────────────

export interface SoftReloadStepResult {
  step: string;
  ok: boolean;
  error?: string;
}

export interface SoftReloadResult {
  success: boolean;
  steps: SoftReloadStepResult[];
  reloadedAt: string;
  reloadId: string;
}

/**
 * Re-initialize all derived in-memory state without killing the process:
 *   - reset + rebuild site config and site context map (also rebuilds
 *     per-site validation caches, which reload from disk on construction)
 *   - re-run the fast content scan for every site
 *   - re-run the ecommerce scan
 *   - clear the image registry cache (reloads lazily on next access)
 *   - warm up per-site databases and re-run the fast scan so DB-backed URLs
 *     are indexed (mirrors startup ordering)
 *
 * Each step is isolated: a failure in one sub-system is captured and reported
 * rather than thrown, so a partial failure is visible and never crashes the
 * process. The config + context-map rebuild is fully atomic — new state is
 * constructed off to the side and only swapped in on success, with a
 * snapshot/restore rollback on failure, so a broken reload never leaves the
 * previously serving state half-torn-down.
 */
export async function performSoftReload(): Promise<SoftReloadResult> {
  const steps: SoftReloadStepResult[] = [];
  const run = async (name: string, fn: () => void | Promise<void>): Promise<void> => {
    try {
      await fn();
      steps.push({ step: name, ok: true });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      log.error({ err, step: name }, "[ServerControl] Soft reload step failed");
      steps.push({ step: name, ok: false, error: message });
    }
  };

  await run("Reload site config & rebuild site context map", () => {
    // Rebuild atomically: a fresh config + context map is constructed off to the
    // side and only swapped in on success. Snapshot the live state first and
    // roll it back on any failure, so an invalid sites.yml or a construction
    // error leaves the previously serving config/map completely intact rather
    // than half-torn-down.
    const cfgSnapshot = snapshotSiteConfigs();
    const mapSnapshot = snapshotSiteContextMap();
    try {
      reloadSiteConfigs();
      rebuildSiteContextMap();
    } catch (err) {
      restoreSiteConfigs(cfgSnapshot);
      restoreSiteContextMap(mapSnapshot);
      throw err;
    }
  });

  await run("Fast content scan", () => {
    const errors: string[] = [];
    for (const ctx of getSiteContextMap().values()) {
      try {
        ctx.contentIndex.scanFast();
      } catch (e) {
        errors.push(`${ctx.contentRootName}: ${e instanceof Error ? e.message : String(e)}`);
      }
    }
    if (errors.length) throw new Error(errors.join("; "));
  });

  await run("Ecommerce scan", () => {
    scanEcommerceContent();
  });

  await run("Clear image registry cache", () => {
    clearImageRegistryCache();
  });

  await run("Database warmup", async () => {
    const errors: string[] = [];
    await Promise.all(
      [...getSiteContextMap().values()].map(async (ctx) => {
        try {
          await ctx.database.warmup();
        } catch (e) {
          errors.push(`${ctx.contentRootName}: ${e instanceof Error ? e.message : String(e)}`);
        }
      }),
    );
    // Re-run the fast scan so DB-backed content types pick up the warmed cache.
    for (const ctx of getSiteContextMap().values()) {
      try {
        ctx.contentIndex.scanFast();
        ctx.contentIndex.startSlowScanAsync();
      } catch (e) {
        errors.push(`${ctx.contentRootName} (rescan): ${e instanceof Error ? e.message : String(e)}`);
      }
    }
    if (errors.length) throw new Error(errors.join("; "));
  });

  // Best-effort background slow scan (image/variable/redirect/SEO indexing).
  // Debounced/coalesced with any startSlowScanAsync from the post-warmup rescan above.
  try {
    for (const ctx of getSiteContextMap().values()) {
      ctx.contentIndex.startSlowScanAsync();
    }
  } catch (err) {
    log.warn({ err }, "[ServerControl] Failed to kick off background slow scan (non-fatal)");
  }

  const marker = markSoftReload();
  const success = steps.every((s) => s.ok);
  log.info(
    { success, steps: steps.length, reloadId: marker.id },
    `[ServerControl] Soft reload ${success ? "completed" : "completed with errors"}`,
  );
  return { success, steps, reloadedAt: marker.at, reloadId: marker.id };
}
