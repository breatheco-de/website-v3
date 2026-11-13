/**
 * Migration 013: the workshops database asks Breathecode for the lookback window (`ago`)
 * instead of downloading every event (`all_time`) and gating pages with a computed
 * 12-month `is_recent` field.
 *
 * Before anything is written, the live API must prove `ago` works the way pages need:
 * an invalid value is rejected, every upcoming event is still returned, and nothing that
 * ended before the window comes back.
 */

import fs from "fs";
import path from "path";
import * as yaml from "js-yaml";
import type { DatabaseConfig } from "./database";
import type { ContentTypeConfigUpdate, ContentTypeEntry } from "./content-types";

type Log = (...args: unknown[]) => void;

export const WORKSHOP_TYPE = "workshop";
export const WORKSHOP_DB = "workshops";
/** Starting lookback; staff change it later in the database's request params. */
export const DEFAULT_AGO_MS = 365 * 24 * 60 * 60 * 1000;
const RECENT_FIELD = "is_recent";
const OLD_CONSTRAINT_PREFIX = "Only upcoming workshops and ones that ended in the last 12 months";
export const NEW_CONSTRAINT =
  "Pages come from the workshops database: upcoming workshops plus the lookback set by the ago param on its " +
  "Breathecode request (12 months by default); older ones are not fetched and 404. Finished pages offer the " +
  "recording after signup/login, and finished workshops without a recording are noindex.";

type ApiSource = NonNullable<DatabaseConfig["source"]["api"]>;

/** Next database config with `all_time` replaced by `ago`, or null when it already uses `ago` only. */
export function planWorkshopsDbConfig(config: DatabaseConfig, agoMs = DEFAULT_AGO_MS): DatabaseConfig | null {
  const api = config.source?.api;
  if (config.source?.type !== "api" || !api) return null;
  const params: Record<string, unknown> = { ...(api.params ?? {}) };
  const hasAgo = params.ago != null && String(params.ago).trim() !== "";
  if (hasAgo && !("all_time" in params)) return null;
  delete params.all_time;
  if (!hasAgo) params.ago = String(agoMs);
  return { ...config, source: { ...config.source, api: { ...api, params } } };
}

/** Content type keys to update so pages no longer depend on the computed 12-month field, or null. */
export function planWorkshopContentType(
  entry: Pick<ContentTypeEntry, "field_mapping" | "entry_filters" | "editor" | "strategy">,
): Pick<ContentTypeConfigUpdate, "field_mapping" | "entry_filters" | "editor" | "strategy"> | null {
  const update: Pick<ContentTypeConfigUpdate, "field_mapping" | "entry_filters" | "editor" | "strategy"> = {};

  if (entry.field_mapping && RECENT_FIELD in entry.field_mapping) {
    const { [RECENT_FIELD]: _drop, ...rest } = entry.field_mapping;
    update.field_mapping = rest;
  }
  const filters = entry.entry_filters ?? [];
  if (filters.some((f) => f?.item_property_slug === RECENT_FIELD)) {
    update.entry_filters = filters.filter((f) => f?.item_property_slug !== RECENT_FIELD);
  }
  if (entry.editor && RECENT_FIELD in entry.editor) {
    const { [RECENT_FIELD]: _drop, ...rest } = entry.editor;
    update.editor = rest;
  }
  const constraints = entry.strategy?.constraints;
  if (entry.strategy && constraints?.some((c) => c.startsWith(OLD_CONSTRAINT_PREFIX))) {
    update.strategy = {
      ...entry.strategy,
      constraints: constraints.map((c) => (c.startsWith(OLD_CONSTRAINT_PREFIX) ? NEW_CONSTRAINT : c)),
    };
  }
  return Object.keys(update).length > 0 ? update : null;
}

export type FetchJson = (url: string, headers: Record<string, string>) => Promise<{ status: number; body: unknown }>;

type EventRow = { slug?: unknown; starting_at?: unknown; ending_at?: unknown; ended_at?: unknown };

function requestUrl(api: ApiSource, params: Record<string, unknown>): string {
  const url = new URL(api.endpoint);
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, String(value));
  return url.toString();
}

function rowsOf(body: unknown): EventRow[] {
  return Array.isArray(body) ? (body as EventRow[]) : [];
}

function endMs(row: EventRow): number {
  return Date.parse(String(row.ending_at ?? row.ended_at ?? ""));
}

/**
 * Proves the live API supports `ago` as a lower bound only. `api.params` must already
 * carry the planned `ago` and no `all_time`.
 */
export async function preflightAgo(
  api: ApiSource,
  fetchJson: FetchJson,
  now = Date.now(),
): Promise<{ ok: true; windowCount: number; upcoming: number } | { ok: false; reason: string }> {
  const params = { ...(api.params ?? {}) };
  const agoMs = Number(params.ago);
  if (!Number.isInteger(agoMs) || agoMs <= 0) return { ok: false, reason: `ago must be a positive integer, got "${params.ago}"` };
  const headers = { Accept: "application/json", ...(api.headers ?? {}) };
  const { ago: _ago, ...base } = params;

  const invalid = await fetchJson(requestUrl(api, { ...base, ago: -1 }), headers);
  if (invalid.status !== 400) {
    return {
      ok: false,
      reason: `Breathecode does not support ago yet: ago=-1 answered ${invalid.status} instead of 400. Deploy the ago filter, then run this again.`,
    };
  }

  const upcomingRes = await fetchJson(requestUrl(api, base), headers);
  const windowRes = await fetchJson(requestUrl(api, params), headers);
  if (upcomingRes.status !== 200 || windowRes.status !== 200) {
    return { ok: false, reason: `Breathecode answered ${upcomingRes.status} / ${windowRes.status} instead of 200` };
  }
  const upcoming = rowsOf(upcomingRes.body).filter((r) => String(r.slug ?? ""));
  const windowRows = rowsOf(windowRes.body);
  if (upcoming.length === 0) {
    return {
      ok: false,
      reason: "No upcoming workshops right now, so we cannot confirm ago keeps them. Run this again once one is scheduled.",
    };
  }
  const windowSlugs = new Set(windowRows.map((r) => String(r.slug ?? "")));
  const missing = upcoming.map((r) => String(r.slug)).filter((slug) => !windowSlugs.has(slug));
  if (missing.length > 0) {
    return {
      ok: false,
      reason: `ago drops upcoming workshops (${missing.slice(0, 5).join(", ")}${missing.length > 5 ? ", …" : ""}). It must only set the lower bound (ending_at >= now - ago).`,
    };
  }
  const tooOld = windowRows.filter((r) => Number.isFinite(endMs(r)) && endMs(r) < now - agoMs);
  if (tooOld.length > 0) {
    return { ok: false, reason: `ago returned ${tooOld.length} event(s) that ended before the window` };
  }
  return { ok: true, windowCount: windowRows.length, upcoming: upcoming.length };
}

export type WorkshopsAgoDeps = {
  sites: () => Array<{ name: string; contentRoot: string }>;
  pending: (site: string) => string[];
  markModified: (absFile: string, contentRoot: string) => void;
  push: (site: string, files: string[], message: string) => Promise<{ success: boolean; commitHash?: string; error?: string }>;
  fetchJson: FetchJson;
  contentType: (root: string) => ContentTypeEntry | null;
  updateContentType: (root: string, update: ContentTypeConfigUpdate) => void;
  /** Re-fetch the workshops database with the config on disk; returns the stored row count. */
  refreshDb: (root: string) => Promise<number>;
};

async function defaultDeps(): Promise<WorkshopsAgoDeps> {
  const { getSiteContextMap } = await import("./site-manager");
  const { detectPendingChanges, markFileAsModified, flushPendingSyncStateWrites } = await import("./sync-state");
  const { commitAndPush } = await import("./github");
  const { getContentTypeConfig, updateContentTypeConfig } = await import("./content-types");
  const { DatabaseManager } = await import("./database");
  return {
    sites: () => Array.from(getSiteContextMap().values()).map((c) => ({ name: c.contentRootName, contentRoot: c.contentRoot })),
    pending: (site) =>
      detectPendingChanges(site)
        .filter((c) => c.source === "local")
        .map((c) => c.file),
    markModified: (absFile, contentRoot) => {
      markFileAsModified(absFile, "migration:013", undefined, contentRoot);
      flushPendingSyncStateWrites(contentRoot);
    },
    push: (site, files, message) => commitAndPush(message, { files, contentRoot: site, onlyBlockOnOverlap: true }),
    fetchJson: async (url, headers) => {
      const res = await fetch(url, { headers });
      const body = await res.json().catch(() => null);
      return { status: res.status, body };
    },
    contentType: (root) => (getContentTypeConfig(WORKSHOP_TYPE, root) as ContentTypeEntry | undefined) ?? null,
    updateContentType: (root, update) => updateContentTypeConfig(WORKSHOP_TYPE, update, root),
    refreshDb: async (root) => {
      const db = new DatabaseManager(root);
      const res = await db.fetchItems(WORKSHOP_DB, true, { skipVectorIndex: true, includeRejected: true });
      return res.items.length;
    },
  };
}

export async function runWorkshopsAgoMigration(opts: {
  site?: string;
  dryRun: boolean;
  log?: Log;
  error?: Log;
  deps?: WorkshopsAgoDeps;
}): Promise<{ failed: boolean; changed: number }> {
  const log = opts.log ?? console.log;
  const error = opts.error ?? console.error;
  const deps = opts.deps ?? (await defaultDeps());
  const rootOf = (contentRoot: string) => (path.isAbsolute(contentRoot) ? contentRoot : path.join(process.cwd(), contentRoot));
  let failed = false;
  let matched = false;
  let changed = 0;

  for (const s of deps.sites()) {
    if (opts.site && s.name !== opts.site) continue;
    matched = true;
    log("site", s.name);
    const root = rootOf(s.contentRoot);
    const dbConfigPath = path.join(root, "db", WORKSHOP_DB, "config.yml");
    const entry = deps.contentType(root);
    if (!fs.existsSync(dbConfigPath) || !entry || entry.database?.slug !== WORKSHOP_DB) {
      log("skip", "no workshop content type backed by its own workshops database");
      continue;
    }
    const repoDbConfig = `${s.name}/db/${WORKSHOP_DB}/config.yml`;
    const repoContentTypes = `${s.name}/content-types.yml`;
    // Recovery: files an earlier run wrote but did not push.
    const pending = deps.pending(s.name).filter((f) => f === repoDbConfig || f === repoContentTypes);

    const dbConfig = yaml.load(fs.readFileSync(dbConfigPath, "utf-8")) as DatabaseConfig;
    const dbPlan = planWorkshopsDbConfig(dbConfig);
    const typePlan = planWorkshopContentType(entry);

    if (dbPlan || typePlan) {
      const api = (dbPlan ?? dbConfig).source.api!;
      log("check", "asking Breathecode whether ago is live and keeps upcoming workshops");
      const check = await preflightAgo(api, deps.fetchJson);
      if (!check.ok) {
        error("not_ready", check.reason);
        failed = true;
        continue;
      }
      log("check_passed", `window returns ${check.windowCount} event(s), including all ${check.upcoming} upcoming`);
      changed += 1;
      if (dbPlan) log("database", `${repoDbConfig}: all_time removed, ago=${String(dbPlan.source.api?.params?.ago)}`);
      if (typePlan) log("content_type", `${repoContentTypes}: ${WORKSHOP_TYPE}.${RECENT_FIELD} field and page filter removed`);
      if (opts.dryRun) continue;
    }

    const files: string[] = [];
    if (dbPlan) {
      fs.writeFileSync(dbConfigPath, yaml.dump(dbPlan, { lineWidth: 120 }), "utf-8");
      deps.markModified(dbConfigPath, s.contentRoot);
      files.push(repoDbConfig);
    }
    if (typePlan) {
      // Refill the cache with the new window first so dropping the page gate never exposes old rows.
      try {
        const count = await deps.refreshDb(root);
        log("refreshed", `${WORKSHOP_DB}: ${count} row(s) stored`);
      } catch (err) {
        error("refresh_failed", err instanceof Error ? err.message : String(err));
        failed = true;
        continue;
      }
      deps.updateContentType(root, typePlan);
      deps.markModified(path.join(root, "content-types.yml"), s.contentRoot);
      files.push(repoContentTypes);
    }

    for (const f of pending) if (!files.includes(f)) files.push(f);
    if (pending.length) log("recovery", "pushing files left by an interrupted run", pending);
    if (opts.dryRun || files.length === 0) {
      if (!opts.dryRun) log("nothing_to_do");
      continue;
    }
    const res = await deps.push(
      s.name,
      files,
      "Workshops: fetch the lookback window from Breathecode (ago) instead of filtering 12 months on the site",
    );
    if (!res.success || !res.commitHash) {
      error("push_failed", res.error ?? "no commit SHA returned");
      error("files", files);
      failed = true;
      continue;
    }
    log("commitSha", res.commitHash);
  }

  if (opts.site && !matched) {
    error("site_not_found", opts.site);
    failed = true;
  }
  return { failed, changed };
}
