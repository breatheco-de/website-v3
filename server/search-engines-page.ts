/**
 * Per-page search-engine indexing payload for MCP get_entry_seo (include_search_engines).
 * Google: read-only GSC URL Inspection cache. Bing: phase-1 stub (not_configured).
 */

import path from "path";
import {
  canonicalMismatch,
  googleToCrawlerStatus,
  type CrawlerIndexStatus,
  type SearchEngineInspectionRecord,
  type SearchEngineResolvedUrl,
} from "@shared/search-engine-status";
import { ContentIndex, contentIndex } from "./content-index";
import { DatabaseManager } from "./database";
import {
  getGscConfig,
  getRecord,
  isStale,
  resolvePublicInspectLoc,
  toUrlPath,
  type GscInspectionRecord,
} from "./gsc-url-inspection";
import { getDebugSitemapUrls, type ActiveSiteCtx, type DebugSitemapUrl } from "./sitemap";

export type SearchEngineWarning = {
  code: string;
  message: string;
};

export type GoogleEngineStatus = {
  configured: boolean;
  status: CrawlerIndexStatus;
  detail?: string;
  stale: boolean;
  checkedAt?: string;
  lastCrawlAt?: string;
  canonical_mismatch: boolean;
  resolved: SearchEngineResolvedUrl;
  record: SearchEngineInspectionRecord | null;
};

export type BingEngineStatus = {
  configured: boolean;
  status: CrawlerIndexStatus;
  detail?: string;
  record: null;
};

export type SearchEnginesPagePayload = {
  search_engines: {
    google: GoogleEngineStatus;
    bing: BingEngineStatus;
  };
  warnings: SearchEngineWarning[];
};

function hostFromDomain(domain: string | undefined | null): string | null {
  const raw = (domain || "").trim();
  if (!raw) return null;
  const host = raw.replace(/^https?:\/\//i, "").replace(/\/.*$/, "").toLowerCase();
  if (!host || host === "localhost" || host.endsWith(".localhost") || host === "127.0.0.1") {
    return null;
  }
  return host;
}

/** Build https://{domain}{path} for GSC cache key fallback. */
export function toAbsolutePublicUrl(requested: string, domain: string | undefined | null): string | null {
  const host = hostFromDomain(domain);
  if (!host) return null;
  const trimmed = requested.trim();
  if (!trimmed) return null;
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  const p = toUrlPath(trimmed);
  return `https://${host}${p.startsWith("/") ? p : `/${p}`}`;
}

export function buildSitemapCtx(opts: {
  contentFolder: string;
  contentRoot: string;
  domain?: string;
}): ActiveSiteCtx {
  const folder = opts.contentFolder;
  const host = hostFromDomain(opts.domain);
  const baseUrl = host ? `https://${host}` : undefined;

  if (
    contentIndex.contentRootName === folder ||
    contentIndex.contentRoot === opts.contentRoot ||
    path.basename(contentIndex.contentRoot) === folder
  ) {
    return {
      contentIndex,
      contentRootName: contentIndex.contentRootName,
      database: contentIndex.getDatabase(),
      baseUrl,
    };
  }

  const database = new DatabaseManager(opts.contentRoot);
  const ci = new ContentIndex(folder, database);
  return {
    contentIndex: ci,
    contentRootName: ci.contentRootName,
    database,
    baseUrl,
  };
}

export function buildBingEngineStatus(): BingEngineStatus {
  return {
    configured: false,
    status: "not_configured",
    detail: "Bing Webmaster is not configured on this site yet.",
    record: null,
  };
}

function lookupGoogleRecord(
  contentRootName: string,
  resolvedLoc: string | null,
  requested: string,
  domain: string | undefined,
): { record: GscInspectionRecord | undefined; locUsed: string | null } {
  if (resolvedLoc) {
    const byLoc = getRecord(contentRootName, resolvedLoc);
    if (byLoc) return { record: byLoc, locUsed: resolvedLoc };
  }

  const abs = toAbsolutePublicUrl(requested, domain);
  if (abs) {
    const byAbs = getRecord(contentRootName, abs);
    if (byAbs) return { record: byAbs, locUsed: abs };
    // Some stores may key without trailing slash variance
    const alt = abs.endsWith("/") ? abs.slice(0, -1) : `${abs}/`;
    const byAlt = getRecord(contentRootName, alt);
    if (byAlt) return { record: byAlt, locUsed: alt };
  }

  const pathOnly = toUrlPath(requested);
  if (pathOnly && pathOnly !== requested) {
    const byPath = getRecord(contentRootName, pathOnly);
    if (byPath) return { record: byPath, locUsed: pathOnly };
  }

  return { record: undefined, locUsed: resolvedLoc };
}

export function buildGoogleEngineStatus(opts: {
  contentRoot: string;
  contentRootName: string;
  domain?: string;
  requestedUrl: string | undefined | null;
  debugUrls?: DebugSitemapUrl[];
  now?: number;
}): GoogleEngineStatus {
  const cfg = getGscConfig(opts.contentRoot);
  const requested = (opts.requestedUrl || "").trim();
  const debugUrls = opts.debugUrls ?? [];

  if (!requested) {
    return {
      configured: cfg.configured,
      status: "not_applicable",
      detail: "No public URL resolved for this locale",
      stale: false,
      canonical_mismatch: false,
      resolved: {
        requested: "",
        loc: null,
        inSitemap: false,
        isDraft: false,
      },
      record: null,
    };
  }

  const resolvedRaw = resolvePublicInspectLoc(requested, debugUrls);
  const { record, locUsed } = lookupGoogleRecord(
    opts.contentRootName,
    resolvedRaw.loc,
    requested,
    opts.domain,
  );

  const resolved: SearchEngineResolvedUrl = {
    requested,
    loc: locUsed ?? resolvedRaw.loc,
    inSitemap: resolvedRaw.inSitemap,
    isDraft: resolvedRaw.isDraft,
  };

  const mapped = googleToCrawlerStatus({
    configured: cfg.configured,
    record: record ?? null,
    resolved,
  });

  const stale = record ? isStale(record, opts.now) : false;

  return {
    configured: cfg.configured,
    status: mapped.status,
    detail: mapped.detail,
    stale,
    checkedAt: mapped.checkedAt,
    lastCrawlAt: mapped.lastCrawlAt,
    canonical_mismatch: canonicalMismatch(record ?? null),
    resolved,
    record: record ?? null,
  };
}

export function buildSearchEnginesPagePayload(opts: {
  contentRoot: string;
  contentFolder: string;
  domain?: string;
  requestedUrl: string | undefined | null;
  now?: number;
}): SearchEnginesPagePayload {
  const sitemapCtx = buildSitemapCtx({
    contentFolder: opts.contentFolder,
    contentRoot: opts.contentRoot,
    domain: opts.domain,
  });
  const debugUrls = getDebugSitemapUrls(sitemapCtx);

  const google = buildGoogleEngineStatus({
    contentRoot: opts.contentRoot,
    contentRootName: sitemapCtx.contentRootName,
    domain: opts.domain,
    requestedUrl: opts.requestedUrl,
    debugUrls,
    now: opts.now,
  });

  const bing = buildBingEngineStatus();
  const warnings: SearchEngineWarning[] = [
    {
      code: "bing_not_configured",
      message: "Bing Webmaster is not configured on this site yet (phase 2).",
    },
  ];

  if (google.stale && google.record) {
    warnings.push({
      code: "search_engines_stale",
      message:
        "Google Search Console inspection data is older than 7 days. Re-inspect from staff SEO/GEO → Search Console; this tool does not refresh the cache.",
    });
  }

  return {
    search_engines: { google, bing },
    warnings,
  };
}
