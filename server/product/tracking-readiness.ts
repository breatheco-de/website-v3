/**
 * Per-site switch for product / persona tracking fields.
 *
 * Off until every active product and persona on the site has a tracking key. The first
 * time that is true the site records `tracking_keys_ready_at` in pipeline_state and the
 * switch stays on for good (a key missing later only falls back to the full id).
 * Flipping on clears the site's cached HTML so first page views carry the codes.
 */

import { listMissingShortKeys, type MissingShortKey } from "@shared/tracking-keys";
import { getSiteSqlite } from "../db";
import { ensurePipelineDb } from "../pipeline-db/runner";
import { invalidateHtmlPageCacheKey, listStoredHtmlCacheKeys } from "../html-page-cache";
import { child } from "../logger";
import { contentRootAbsolute, loadTrackingKeyIndex, siteIdForContentRoot } from "./tracking-key-index";

const log = child({ module: "product/tracking-readiness" });

const STATE_KEY = "tracking_keys_ready_at";
const NEGATIVE_TTL_MS = 30_000;

const readyAt = new Map<string, string>();
const notReadyCheckedAt = new Map<string, number>();

/** Vitest runs against temp content roots; keep the latch in memory there. */
const persistLatch = !process.env.VITEST;

function readLatch(site: string): string | null {
  if (!persistLatch) return null;
  ensurePipelineDb(site);
  const row = getSiteSqlite(site)
    .prepare("SELECT value_json FROM pipeline_state WHERE key = ?")
    .get(STATE_KEY) as { value_json: string } | undefined;
  if (!row) return null;
  try {
    const parsed = JSON.parse(row.value_json) as { at?: unknown };
    return typeof parsed.at === "string" ? parsed.at : null;
  } catch {
    return null;
  }
}

function writeLatch(site: string, at: string): void {
  if (!persistLatch) return;
  ensurePipelineDb(site);
  getSiteSqlite(site)
    .prepare(
      `INSERT INTO pipeline_state (key, value_json) VALUES (?, ?)
       ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json`,
    )
    .run(STATE_KEY, JSON.stringify({ at }));
}

function clearSiteHtmlCache(site: string): void {
  for (const key of listStoredHtmlCacheKeys(site)) invalidateHtmlPageCacheKey(key);
}

/** True when product / persona tracking fields are on for this site. Never throws. */
export function isTrackingReady(contentRoot?: string): boolean {
  const root = contentRootAbsolute(contentRoot);
  const site = siteIdForContentRoot(root);
  if (readyAt.has(site)) return true;
  const checked = notReadyCheckedAt.get(site);
  if (checked && Date.now() - checked < NEGATIVE_TTL_MS) return false;
  try {
    const latched = readLatch(site);
    if (latched) {
      readyAt.set(site, latched);
      return true;
    }
    const missing = listMissingShortKeys(loadTrackingKeyIndex(root).products);
    if (missing.length > 0) {
      notReadyCheckedAt.set(site, Date.now());
      return false;
    }
    const at = new Date().toISOString();
    writeLatch(site, at);
    readyAt.set(site, at);
    notReadyCheckedAt.delete(site);
    clearSiteHtmlCache(site);
    log.info({ site }, "[tracking] every product and persona has a tracking key — product/persona tracking is on");
    return true;
  } catch (err) {
    log.warn({ err, site }, "[tracking] readiness check failed; treating as off");
    return false;
  }
}

/**
 * Read-only answer for other processes (Diagnostics worker): never writes the latch, so the
 * web process is the one that flips it and clears its HTML cache.
 */
export function peekTrackingReady(contentRoot?: string): boolean {
  const root = contentRootAbsolute(contentRoot);
  const site = siteIdForContentRoot(root);
  if (readyAt.has(site)) return true;
  try {
    if (readLatch(site)) return true;
    return listMissingShortKeys(loadTrackingKeyIndex(root).products).length === 0;
  } catch {
    return false;
  }
}

/** Forget the cached "not ready" answer and check again (after key writes). */
export function recheckTrackingReadiness(contentRoot?: string): boolean {
  notReadyCheckedAt.delete(siteIdForContentRoot(contentRoot));
  return isTrackingReady(contentRoot);
}

export type TrackingReadiness = {
  ready: boolean;
  ready_at: string | null;
  /** Active products / personas still without a key (fall back to full id when ready). */
  missing: MissingShortKey[];
};

export function getTrackingReadiness(contentRoot?: string): TrackingReadiness {
  const ready = recheckTrackingReadiness(contentRoot);
  const site = siteIdForContentRoot(contentRoot);
  return {
    ready,
    ready_at: readyAt.get(site) ?? null,
    missing: listMissingShortKeys(loadTrackingKeyIndex(contentRoot).products),
  };
}

/** Test helper: drop in-memory readiness state. */
export function resetTrackingReadinessMemo(): void {
  readyAt.clear();
  notReadyCheckedAt.clear();
}
