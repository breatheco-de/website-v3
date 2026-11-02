/**
 * Builds a fresh site slice (the Sidequest worker has no Express site map),
 * reads the public URL snapshot and redirect map, and runs the scanner.
 */

import path from "path";
import { buildHtmlRebuildSite } from "../html-rebuild";
import { getPublicUrlSnapshot, toActiveSiteCtx } from "../sitemap";
import { createPublicUrlResolver } from "../redirects";
import { isIndexingBlocked } from "../settings";
import { getLatestWriteGeneration } from "../events/event-store";
import { scanPublicUrlChanges, type ScanPublicUrlChangesResult } from "./scanner";

export function runPublicUrlScanForSite(site: string, contentRootInput: string): ScanPublicUrlChangesResult {
  const contentRoot = path.resolve(contentRootInput);
  let causeEventId: number | null = null;
  try {
    causeEventId = getLatestWriteGeneration(site) || null;
  } catch {
    causeEventId = null;
  }

  if (isIndexingBlocked(contentRoot)) {
    return scanPublicUrlChanges({ site, snapshot: [], indexingBlocked: true, causeEventId });
  }

  const siteCtx = buildHtmlRebuildSite(contentRoot, site);
  siteCtx.contentIndex.scanSlow();
  const activeCtx = toActiveSiteCtx(siteCtx);
  const snapshot = getPublicUrlSnapshot(activeCtx);
  const resolver = createPublicUrlResolver(siteCtx.contentIndex, { freshRedirects: false });

  return scanPublicUrlChanges({
    site,
    snapshot,
    indexingBlocked: false,
    causeEventId,
    resolveRedirect(url, locale) {
      let parsed: URL;
      try {
        parsed = new URL(url);
      } catch {
        return null;
      }
      const result = resolver.test(parsed.pathname, locale ?? "en");
      if (!result.match || !result.resolvedTo) return null;
      if (/^https?:\/\//i.test(result.resolvedTo)) return result.resolvedTo;
      return `${parsed.origin}${result.resolvedTo.startsWith("/") ? "" : "/"}${result.resolvedTo}`;
    },
  });
}
