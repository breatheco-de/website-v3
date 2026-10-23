/**
 * Page stats identity: the public path(s) a report covers, the content entry behind them, its
 * funnel stage, and a cached site-wide path → stage index used to classify where visitors go next.
 */

import type { ContentIndex } from "../../content-index";
import { readFunnelBlockFromFile } from "../../funnel-fields";
import { normalizeAnalyticsPath } from "../../ecommerce/journey-analytics";
import { makeDestinationResolver } from "../../ads/ads-report";
import { isFunnelStage, type FunnelStage } from "@shared/funnel";
import { child } from "../../logger";

const log = child({ module: "page-stats/resolve" });

const INDEX_TTL_MS = 10 * 60 * 1000;

export type PageStatsScope = "url" | "entry";

export type PathStageInfo = {
  key: string;
  content_type: string;
  slug: string;
  locale: string;
  stage: FunnelStage | null;
};

export type PathStageIndex = {
  byPath: Map<string, PathStageInfo>;
  /** Public paths per stage (every locale URL of every entry in that stage). */
  pathsByStage: Record<FunnelStage, string[]>;
  built_at: number;
};

export type ResolvedPage = {
  /** Normalized path the drawer was opened on. */
  path: string;
  /** Paths the report covers (one for `url`, every locale URL for `entry`). */
  paths: string[];
  scope: PageStatsScope;
  entry: { content_type: string; slug: string; locale: string; key: string; title: string | null } | null;
  stage: FunnelStage | null;
  /** All locale URLs of the entry (for the language toggle), keyed by locale. */
  locale_urls: Record<string, string>;
};

const indexCache = new Map<string, PathStageIndex>();

function readStage(ci: ContentIndex, contentType: string, slug: string): FunnelStage | null {
  try {
    const stage = readFunnelBlockFromFile(ci.getCommonFilePath(contentType, slug)).stage;
    return typeof stage === "string" && isFunnelStage(stage) ? stage : null;
  } catch {
    return null;
  }
}

/** Every entry's public URLs → stage. Rebuilt at most every 10 minutes per site. */
export function getPathStageIndex(site: string, ci: ContentIndex, now = Date.now()): PathStageIndex {
  const hit = indexCache.get(site);
  if (hit && now - hit.built_at < INDEX_TTL_MS) return hit;
  const byPath = new Map<string, PathStageInfo>();
  const pathsByStage: Record<FunnelStage, string[]> = {
    awareness: [],
    consideration: [],
    decision: [],
    "post-enrollment": [],
  };
  let entries: ReturnType<ContentIndex["listAll"]> = [];
  try {
    entries = ci.listAll();
  } catch (err) {
    log.warn({ err, site }, "[page-stats] content index unavailable");
  }
  for (const e of entries) {
    let urls: Record<string, string> = {};
    try {
      urls = ci.getLocaleUrls(e.slug, e.contentType) ?? {};
    } catch {
      continue;
    }
    const stage = readStage(ci, e.contentType, e.slug);
    for (const [locale, url] of Object.entries(urls)) {
      const p = typeof url === "string" ? normalizeAnalyticsPath(url) : "";
      if (!p || byPath.has(p)) continue;
      byPath.set(p, {
        key: `${e.contentType}/${e.slug}/${locale}`,
        content_type: e.contentType,
        slug: e.slug,
        locale,
        stage,
      });
      if (stage) pathsByStage[stage].push(p);
    }
  }
  const index = { byPath, pathsByStage, built_at: now };
  indexCache.set(site, index);
  return index;
}

export function clearPathStageIndex(): void {
  indexCache.clear();
}

/** Stage of any public path (unknown pages and pages without a stage → null). */
export function stageOfPath(index: PathStageIndex, rawPath: string): FunnelStage | null {
  const p = normalizeAnalyticsPath(rawPath);
  return (p && index.byPath.get(p)?.stage) || null;
}

/** Resolve the drawer's path to its entry (following redirects like the public site) and stage. */
export function resolvePage(opts: {
  site: string;
  ci: ContentIndex;
  path: string;
  scope: PageStatsScope;
  index: PathStageIndex;
}): ResolvedPage | null {
  const path = normalizeAnalyticsPath(opts.path);
  if (!path) return null;

  let entry: ResolvedPage["entry"] = null;
  const indexed = opts.index.byPath.get(path);
  if (indexed) {
    const { stage: _stage, ...identity } = indexed;
    entry = { ...identity, title: null };
  } else {
    try {
      const r = makeDestinationResolver(opts.site, opts.ci)("", path);
      if (r.kind === "entry" && r.content_type && r.slug) {
        entry = {
          content_type: r.content_type,
          slug: r.slug,
          locale: r.locale ?? "en",
          key: `${r.content_type}/${r.slug}/${r.locale ?? "en"}`,
          title: null,
        };
      }
    } catch (err) {
      log.warn({ err, path }, "[page-stats] destination resolve failed");
    }
  }

  let localeUrls: Record<string, string> = {};
  let stage: FunnelStage | null = null;
  if (entry) {
    try {
      localeUrls = opts.ci.getLocaleUrls(entry.slug, entry.content_type) ?? {};
    } catch {
      localeUrls = {};
    }
    stage = readStage(opts.ci, entry.content_type, entry.slug);
    try {
      const listed = opts.ci.findByType(entry.content_type).find((e) => e.slug === entry!.slug);
      entry.title = listed?.title ?? null;
    } catch {
      entry.title = null;
    }
  }

  const entryPaths = Object.values(localeUrls)
    .map((u) => (typeof u === "string" ? normalizeAnalyticsPath(u) : ""))
    .filter(Boolean);
  const paths =
    opts.scope === "entry" && entryPaths.length > 0
      ? Array.from(new Set([path, ...entryPaths]))
      : [path];

  return { path, paths, scope: opts.scope, entry, stage, locale_urls: localeUrls };
}
