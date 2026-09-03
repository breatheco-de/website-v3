/**
 * Soft-block becoming a pillar or opting out while ORPHAN_PAGE / PARTIALLY_SET_CLUSTER is open.
 */

import fs from "fs";
import path from "path";
import {
  SEO_INCLUDE_IN_CLUSTERING,
  SEO_IS_PILLAR,
  SEO_PILLAR_PATH,
  type FieldUpdate,
} from "./seo-cluster-toggle.js";
import type { NextAction } from "./respond.js";

export const CLUSTER_GAP_CODES = new Set(["ORPHAN_PAGE", "PARTIALLY_SET_CLUSTER"]);

export function isRiskyClusterResolutionWrite(updates: FieldUpdate[]): boolean {
  for (const u of updates) {
    if (u.field_path === SEO_IS_PILLAR && (u.value === true || u.value === "true")) {
      return true;
    }
    if (u.field_path === SEO_INCLUDE_IN_CLUSTERING && (u.value === false || u.value === "false")) {
      return true;
    }
    if (u.field_path === SEO_PILLAR_PATH && u.value === null) {
      return true;
    }
  }
  return false;
}

export function entryHasOpenClusterGapIssue(opts: {
  contentPath: string;
  contentType: string;
  slug: string;
  locale: string;
}): { open: boolean; codes: string[] } {
  const cachePath = path.join(opts.contentPath, "validation-cache.json");
  try {
    if (!fs.existsSync(cachePath)) return { open: false, codes: [] };
    const cache = JSON.parse(fs.readFileSync(cachePath, "utf-8")) as {
      issues?: Record<
        string,
        { code: string; severity?: string; validator?: string }
      >;
      indexes?: { byEntry?: Record<string, string[]> };
      completions?: Record<string, unknown>;
    };
    const entryKey = `${opts.contentType}/${opts.slug}/${opts.locale}`;
    const ids = cache.indexes?.byEntry?.[entryKey] ?? [];
    const completions = cache.completions ?? {};
    const codes: string[] = [];
    for (const id of ids) {
      if (completions[id]) continue;
      const issue = cache.issues?.[id];
      if (!issue) continue;
      if (CLUSTER_GAP_CODES.has(issue.code)) codes.push(issue.code);
    }
    return { open: codes.length > 0, codes: [...new Set(codes)] };
  } catch {
    return { open: false, codes: [] };
  }
}

export function clusterResolutionConfirmRequired(opts: {
  contentPath: string;
  contentType: string;
  slug: string;
  locale: string;
  updates: FieldUpdate[];
  confirm_cluster_resolution?: boolean;
  site?: string;
}):
  | { blocked: false }
  | {
      blocked: true;
      code: "confirm_cluster_resolution";
      message: string;
      next_actions: NextAction[];
      details: Record<string, unknown>;
    } {
  if (opts.confirm_cluster_resolution === true) return { blocked: false };
  if (!isRiskyClusterResolutionWrite(opts.updates)) return { blocked: false };
  const gap = entryHasOpenClusterGapIssue({
    contentPath: opts.contentPath,
    contentType: opts.contentType,
    slug: opts.slug,
    locale: opts.locale,
  });
  if (!gap.open) return { blocked: false };

  const siteArg = opts.site ? { site: opts.site } : {};
  return {
    blocked: true,
    code: "confirm_cluster_resolution",
    message:
      `This entry has an open cluster gap (${gap.codes.join(", ")}). ` +
      `Prefer joining an existing hub with seo.pillar_path (no confirm needed). ` +
      `Becoming a hub (seo.is_pillar: true) or opting out requires confirm_cluster_resolution: true after you have listed hubs.`,
    details: { open_codes: gap.codes },
    next_actions: [
      {
        tool: "list_seo_clusters",
        priority: "recommended",
        reason: "Find an existing hub to join before becoming a pillar or opting out.",
        args_hint: { ...siteArg },
      },
      {
        tool: "update_fields",
        priority: "optional",
        reason: "Retry pillar/opt-out only if intentional, with confirm_cluster_resolution: true.",
        args_hint: {
          slug: opts.slug,
          locale: opts.locale,
          contentType: opts.contentType,
          confirm_cluster_resolution: true,
          ...siteArg,
        },
      },
    ],
  };
}
