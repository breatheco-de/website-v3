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
import { extractInternalLinkHits } from "./internal-link-hits";
import { DEFAULT_HUB_LOAD_THRESHOLDS, type HubLoadThresholds } from "./seo-config";

export const HUB_MISSING_MEMBER_LINKS = "HUB_MISSING_MEMBER_LINKS";
export const MEMBER_MISSING_HUB_LINK = "MEMBER_MISSING_HUB_LINK";
export const HUB_THIN_LINK_DENSE = "HUB_THIN_LINK_DENSE";
export const HUB_OVERLOADED = "HUB_OVERLOADED";

/** Keys whose text is not reader body copy (SEO block, links, media, layout knobs). */
const NON_BODY_KEYS = new Set([
  "seo",
  "meta",
  "redirects",
  "funnel",
  "type",
  "variant",
  "version",
  "background",
  "paddingY",
  "marginY",
  "image",
  "src",
  "alt",
  "icon",
  "url",
  "href",
  "slug",
]);

/** Approximate reader word count across string fields (HTML tags and markdown link targets stripped). */
export function countBodyWords(data: unknown): number {
  let words = 0;
  const walk = (node: unknown, key?: string) => {
    if (key && NON_BODY_KEYS.has(key)) return;
    if (typeof node === "string") {
      const text = node
        .replace(/<[^>]+>/g, " ")
        .replace(/\]\([^)]*\)/g, "]")
        .replace(/[#*_`>[\]|]/g, " ");
      const n = text.split(/\s+/).filter((w) => /[\p{L}\p{N}]/u.test(w)).length;
      if (n >= 3) words += n;
      return;
    }
    if (Array.isArray(node)) {
      for (const child of node) walk(child);
      return;
    }
    if (node && typeof node === "object") {
      for (const [k, v] of Object.entries(node as Record<string, unknown>)) walk(v, k);
    }
  };
  walk(data);
  return words;
}

export type HubLoadIssue = {
  code: typeof HUB_THIN_LINK_DENSE | typeof HUB_OVERLOADED;
  message: string;
  suggestion: string;
  members: number;
  links: number;
  words: number;
  links_per_100_words: number;
};

/**
 * Hub size vs body: thin + link-dense (expand the hub) or many members (look for a sub-hub).
 * `openSplits` lists in-flight hub-mode ideas already claiming members of this hub.
 */
export function checkHubLoad(opts: {
  pageData: Record<string, unknown> | null | undefined;
  memberCount: number;
  thresholds?: HubLoadThresholds;
  openSplits?: Array<{ id: string; title: string; members: string[] }>;
}): HubLoadIssue | null {
  const t = opts.thresholds ?? DEFAULT_HUB_LOAD_THRESHOLDS;
  const data = opts.pageData ?? {};
  const links = extractInternalLinkHits(data, { absolute: "all" }).filter((h) => h.kind !== "bare").length;
  const words = countBodyWords(data);
  const density = words > 0 ? (links / words) * 100 : links > 0 ? Infinity : 0;
  const density1 = Number.isFinite(density) ? Math.round(density * 10) / 10 : density;
  const base = { members: opts.memberCount, links, words, links_per_100_words: density1 };

  if (opts.memberCount >= t.overloaded_min_members) {
    const splits = opts.openSplits ?? [];
    return {
      code: HUB_OVERLOADED,
      message:
        `Hub has ${opts.memberCount} member pages (threshold ${t.overloaded_min_members}). ` +
        (splits.length
          ? `Open split ideas already claim some of them: ${splits
              .map((s) => `"${s.title}" (${s.id}: ${s.members.join(", ")})`)
              .join("; ")}. Join or review those before filing another.`
          : "No open split idea yet."),
      suggestion:
        "Group the members by subtopic. If one group (about 5+ pages) has its own identity, file an idea with idea_seo_target.cluster.mode \"hub\" naming those members; the original hub is then rewritten to point at the new hub (review situation hub_split).",
      ...base,
    };
  }
  if (opts.memberCount < t.thin_max_members && density > t.thin_links_per_100_words) {
    return {
      code: HUB_THIN_LINK_DENSE,
      message:
        `Hub body has ${links} internal links in about ${words} words (${density1} per 100 words, threshold ${t.thin_links_per_100_words}) ` +
        `with only ${opts.memberCount} member pages — it reads like a link list.`,
      suggestion:
        "Expand the hub: give each linked page a sentence or paragraph that says what it answers, grouped under subtopic headings. Do not split a hub this small.",
      ...base,
    };
  }
  return null;
}

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
 * Evaluate cluster link rules for one entry (diagnostics / cluster-diagnostics API).
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
