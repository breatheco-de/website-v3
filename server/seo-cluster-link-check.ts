/**
 * Bidirectional SEO cluster link checks (hub → members and members → hub).
 * Uses YAML/data path collection; optional rendered HTML when provided.
 */

import { contentIndex } from "./content-index";
import type { ContentIndex } from "./content-index";
import {
  CLUSTER_LINK_ANCHOR_ONLY_HINT,
  collectInternalPathsFromData,
  findMissingMemberLinks,
  pageLinksToHub,
} from "./cluster-hub-links";
import { loadSeoIndex, seoEntryId, type SeoIndex } from "./seo-index";
import { isSeoMonitoringEnabled } from "./seo-monitoring";

export const HUB_MISSING_MEMBER_LINKS = "HUB_MISSING_MEMBER_LINKS";
export const MEMBER_MISSING_HUB_LINK = "MEMBER_MISSING_HUB_LINK";

export type ClusterLinkIssue = {
  code: typeof HUB_MISSING_MEMBER_LINKS | typeof MEMBER_MISSING_HUB_LINK;
  message: string;
  suggestion: string;
  file?: string;
  missing?: Array<{ memberPath: string; memberSlug: string; memberId: string }>;
  hubPath?: string;
};

function sourcePathsForPage(opts: {
  pageData?: Record<string, unknown> | null;
  html?: string | null;
}): string[] {
  const fromData = opts.pageData ? collectInternalPathsFromData(opts.pageData) : [];
  return fromData;
}

/** Check one hub page for outbound links to each cluster member. */
export function checkHubOutboundLinks(opts: {
  hubId: string;
  hubPath: string;
  hubLocale: string;
  hubFile?: string;
  pageData?: Record<string, unknown> | null;
  html?: string | null;
  index: SeoIndex;
  ci?: ContentIndex;
}): ClusterLinkIssue | null {
  const ci = opts.ci ?? contentIndex;
  const cluster = opts.index.clusters[opts.hubId];
  if (!cluster?.members?.length) return null;

  const members = cluster.members
    .map((id) => {
      const row = opts.index.entries[id];
      return {
        memberId: id,
        memberSlug: row?.slug || id,
        memberPath: row?.path || "",
        locale: row?.locale || opts.hubLocale,
      };
    })
    .filter((m) => m.memberPath.trim());

  if (members.length === 0) return null;

  const missing = findMissingMemberLinks({
    html: opts.html || undefined,
    sourcePaths: sourcePathsForPage(opts),
    members,
    ci,
  });
  if (missing.length === 0) return null;

  return {
    code: HUB_MISSING_MEMBER_LINKS,
    message: `Hub is missing in-body links to ${missing.length} cluster member(s): ${missing
      .map((m) => m.memberSlug)
      .join(", ")}.`,
    suggestion: `Add <a href> links from the hub to each member path. ${CLUSTER_LINK_ANCHOR_ONLY_HINT}`,
    file: opts.hubFile,
    missing,
    hubPath: opts.hubPath,
  };
}

/** Check one member page for a back-link to its hub. */
export function checkMemberBackLink(opts: {
  memberFile?: string;
  memberLocale: string;
  pillarPath: string;
  pageData?: Record<string, unknown> | null;
  html?: string | null;
  ci?: ContentIndex;
}): ClusterLinkIssue | null {
  const ci = opts.ci ?? contentIndex;
  const hubPath = opts.pillarPath.trim();
  if (!hubPath) return null;

  const ok = pageLinksToHub({
    html: opts.html || undefined,
    sourcePaths: sourcePathsForPage(opts),
    hubPath,
    locale: opts.memberLocale,
    ci,
  });
  if (ok) return null;

  return {
    code: MEMBER_MISSING_HUB_LINK,
    message: `Cluster member is missing an in-body link back to its hub (${hubPath}).`,
    suggestion: `Add an <a href="${hubPath}"> (or markdown / url field) to the hub. ${CLUSTER_LINK_ANCHOR_ONLY_HINT}`,
    file: opts.memberFile,
    hubPath,
  };
}

/**
 * Evaluate cluster link rules for one entry (publish gate / targeted check).
 * Skips when type monitoring is off or entry opted out of clustering.
 */
export function evaluateClusterLinksForEntry(opts: {
  contentType: string;
  slug: string;
  locale: string;
  pageData: Record<string, unknown>;
  contentRoot?: string;
  ci?: ContentIndex;
  html?: string | null;
}): ClusterLinkIssue | null {
  const contentRoot = opts.contentRoot;
  if (!isSeoMonitoringEnabled(opts.contentType, contentRoot)) return null;

  const seo =
    opts.pageData.seo && typeof opts.pageData.seo === "object" && !Array.isArray(opts.pageData.seo)
      ? (opts.pageData.seo as Record<string, unknown>)
      : {};

  if (seo.pillar_path === null) return null;

  const index = loadSeoIndex(contentRoot);
  const id = seoEntryId(opts.contentType, opts.slug, opts.locale);
  const row = index.entries[id];
  const isPillar = seo.is_pillar === true || row?.is_pillar === true;

  if (isPillar) {
    const hubPath =
      (typeof row?.path === "string" && row.path) ||
      (typeof seo.pillar_path === "string" && seo.pillar_path) ||
      "";
    return checkHubOutboundLinks({
      hubId: id,
      hubPath,
      hubLocale: opts.locale,
      hubFile: row?.file,
      pageData: opts.pageData,
      html: opts.html,
      index,
      ci: opts.ci,
    });
  }

  const pillarPath =
    (typeof seo.pillar_path === "string" && seo.pillar_path.trim()) ||
    (typeof row?.pillar_path === "string" && row.pillar_path.trim()) ||
    "";
  if (!pillarPath) return null;

  return checkMemberBackLink({
    memberFile: row?.file,
    memberLocale: opts.locale,
    pillarPath,
    pageData: opts.pageData,
    html: opts.html,
    ci: opts.ci,
  });
}
