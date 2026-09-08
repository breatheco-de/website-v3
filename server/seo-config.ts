/**
 * Site SEO policy config at `{contentRoot}/seo-config.yml`.
 * Authored / synced (unlike derived seo-index.json).
 * Holds intent catalogs plus staff triage such as cluster_priority.
 */

import * as fs from "fs";
import * as path from "path";
import yaml from "js-yaml";
import { getDefaultContentRoot } from "./site-config";
import { markFileAsModified } from "./sync-state";
import { child } from "./logger";

const log = child({ module: "seo-config" });

export const SEO_CONFIG_FILENAME = "seo-config.yml";

/** Cluster triage priority: High=1, Mid=2, Low=3 (lower = better). */
export type ClusterPriority = 1 | 2 | 3;

export function isClusterPriority(value: unknown): value is ClusterPriority {
  return value === 1 || value === 2 || value === 3;
}

function contentRootAbs(contentRoot?: string): string {
  const root = contentRoot ?? getDefaultContentRoot();
  return path.isAbsolute(root) ? root : path.join(process.cwd(), root);
}

export function seoConfigPath(contentRoot?: string): string {
  return path.join(contentRootAbs(contentRoot), SEO_CONFIG_FILENAME);
}

function loadSeoConfigObject(contentRoot?: string): Record<string, unknown> {
  const file = seoConfigPath(contentRoot);
  if (!fs.existsSync(file)) return {};
  try {
    const parsed = yaml.load(fs.readFileSync(file, "utf-8"));
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    return parsed as Record<string, unknown>;
  } catch (err) {
    log.warn({ err, file }, "seo-config.yml unreadable");
    return {};
  }
}

function saveSeoConfigObject(
  data: Record<string, unknown>,
  opts?: { contentRoot?: string; author?: string; mark?: boolean },
): string {
  const file = seoConfigPath(opts?.contentRoot);
  const dumped = yaml.dump(data, { lineWidth: 120, noRefs: true, sortKeys: false });
  fs.writeFileSync(file, dumped.endsWith("\n") ? dumped : `${dumped}\n`, "utf-8");
  if (opts?.mark !== false) {
    markFileAsModified(file, opts?.author, undefined, opts?.contentRoot);
  }
  return file;
}

/** Read hubId → priority map from seo-config.yml (invalid entries dropped). */
export function readClusterPriorities(contentRoot?: string): Record<string, ClusterPriority> {
  const raw = loadSeoConfigObject(contentRoot).cluster_priority;
  const out: Record<string, ClusterPriority> = {};
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return out;
  for (const [hubId, value] of Object.entries(raw as Record<string, unknown>)) {
    const id = typeof hubId === "string" ? hubId.trim() : "";
    if (!id || !isClusterPriority(value)) continue;
    out[id] = value;
  }
  return out;
}

/**
 * Set or clear one hub's triage priority in seo-config.yml.
 * Does not require the hub to exist in seo-index (caller may validate).
 */
export function writeClusterPriority(opts: {
  hubId: string;
  priority: ClusterPriority | null;
  contentRoot?: string;
  author?: string;
  mark?: boolean;
}): { success: true; path: string; priority: ClusterPriority | null } | { success: false; error: string } {
  const hubId = opts.hubId.trim();
  if (!hubId) return { success: false, error: "hubId is required" };
  if (opts.priority != null && !isClusterPriority(opts.priority)) {
    return { success: false, error: "priority must be 1, 2, 3, or null" };
  }

  const data = loadSeoConfigObject(opts.contentRoot);
  const map: Record<string, ClusterPriority> = { ...readClusterPriorities(opts.contentRoot) };
  if (opts.priority == null) {
    delete map[hubId];
  } else {
    map[hubId] = opts.priority;
  }

  if (Object.keys(map).length === 0) {
    delete data.cluster_priority;
  } else {
    data.cluster_priority = map;
  }

  const filePath = saveSeoConfigObject(data, {
    contentRoot: opts.contentRoot,
    author: opts.author,
    mark: opts.mark,
  });
  return { success: true, path: filePath, priority: opts.priority };
}
