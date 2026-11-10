/**
 * Staff "Refresh public page": how fresh the cached public copies of one entry
 * locale are, and an immediate rebuild of those copies on the web process.
 * The status path never serves, loads or parses a cached page.
 */

import fs from "fs";
import path from "path";
import type { ContentIndex } from "./content-index";
import type { SiteContext } from "./site-manager";
import type { VersioningManager } from "./versioning/VersioningManager";
import { collectEntryHtmlPaths } from "./content-write-flush";
import {
  buildHtmlCacheKey,
  bumpHtmlGeneration,
  peekHtmlCacheEntry,
  singleflight,
} from "./html-page-cache";
import { AB_DEFAULT_HTML_KEY } from "./html-variant-key";
import { renderHubHtml } from "./render-hub-html";
import { isEntryDetached, isSharedLayoutType, versioningContentSlug } from "./shared-layout-entry";
import { resolveCommonTemplatePath, resolveTemplateLocalePath } from "./shared-layout-paths";
import { AUDIENCE_LLM_VARIANT } from "../shared/llm-html-audience";
import { child } from "./logger";

const log = child({ module: "public-cache" });

export type PublicCacheState = "fresh" | "stale" | "rebuilding" | "not_cached";

export type PublicCacheCopy = {
  pathname: string;
  variantKey: string;
  state: PublicCacheState;
  storedAt: number | null;
};

export type PublicCacheStatus = {
  state: PublicCacheState;
  contentChangedAt: number | null;
  livePath: string | null;
  copies: PublicCacheCopy[];
};

export type PublicCacheTarget = {
  siteId: string;
  contentRoot: string;
  ci: ContentIndex;
  versioningManager: Pick<VersioningManager, "getVersioningForContent">;
  contentType: string;
  /** Entry folder slug (already resolved from any locale slug). */
  slug: string;
  locale: string;
};

export type PublicCacheRefreshResult = {
  refreshed: Array<{ pathname: string; variantKey: string }>;
  failed: Array<{ pathname: string; variantKey: string; reason: string }>;
  livePath: string | null;
};

/** Public paths of this entry in this locale, as the cache keys them. */
export function publicCachePaths(target: PublicCacheTarget): string[] {
  return collectEntryHtmlPaths(target.ci, target.contentType, target.slug, target.locale);
}

function variantSlugsFor(target: PublicCacheTarget): string[] {
  const versioningSlug = versioningContentSlug(target.contentType, target.slug, target.contentRoot);
  try {
    const variants =
      target.versioningManager.getVersioningForContent(target.contentType, versioningSlug)?.[target.locale]?.variants ??
      [];
    return variants.map((v) => v.slug).filter((s): s is string => typeof s === "string" && s.length > 0);
  } catch {
    return [];
  }
}

/** Every cache variant a visitor of this path can be served, live first. */
function candidateVariantKeys(target: PublicCacheTarget): string[] {
  const variants = variantSlugsFor(target).filter((s) => s !== "live" && s !== "default");
  return [...new Set(["live", AUDIENCE_LLM_VARIANT, AB_DEFAULT_HTML_KEY, ...variants])];
}

function mtimeOf(file: string): number {
  try {
    return fs.statSync(file).mtimeMs;
  } catch {
    return 0;
  }
}

/** Newest edit time of the files this entry locale renders from. 0 when none are on disk (database entries). */
export function entryContentChangedAt(target: PublicCacheTarget): number {
  const typeDir = path.join(target.contentRoot, target.ci.getFolderName(target.contentType));
  const entryDir = path.join(typeDir, target.slug);
  const files = [path.join(entryDir, `${target.locale}.yml`), path.join(entryDir, "_common.yml")];
  if (
    isSharedLayoutType(target.contentType, target.contentRoot) &&
    !isEntryDetached(target.contentType, target.slug, target.contentRoot)
  ) {
    files.push(resolveTemplateLocalePath(typeDir, target.locale), resolveCommonTemplatePath(typeDir));
  }
  return Math.max(0, ...files.map(mtimeOf));
}

function copyState(key: string, contentChangedAt: number): { state: PublicCacheState; storedAt: number | null } {
  const peek = peekHtmlCacheEntry(key);
  if (!peek) return { state: "not_cached", storedAt: null };
  if (peek.pendingGeneration > peek.generation) return { state: "rebuilding", storedAt: peek.storedAt };
  if (contentChangedAt > peek.storedAt) return { state: "stale", storedAt: peek.storedAt };
  return { state: "fresh", storedAt: peek.storedAt };
}

const STATE_RANK: Record<PublicCacheState, number> = { stale: 3, rebuilding: 2, fresh: 1, not_cached: 0 };

export function getPublicCacheStatus(target: PublicCacheTarget): PublicCacheStatus {
  const paths = publicCachePaths(target);
  const contentChangedAt = entryContentChangedAt(target);
  const keys = candidateVariantKeys(target);
  const copies: PublicCacheCopy[] = [];
  let state: PublicCacheState = "not_cached";
  for (const pathname of paths) {
    for (const variantKey of keys) {
      const copy = copyState(buildHtmlCacheKey(target.siteId, pathname, variantKey), contentChangedAt);
      if (copy.state === "not_cached") continue;
      copies.push({ pathname, variantKey, ...copy });
      if (STATE_RANK[copy.state] > STATE_RANK[state]) state = copy.state;
    }
  }
  return { state, contentChangedAt: contentChangedAt || null, livePath: paths[0] ?? null, copies };
}

/**
 * Rebuild every copy of this entry locale now. `live` and `audience-llm` are always built
 * (a page with no copy gets one); variant copies only when one already exists. A failed
 * build leaves the previous copy in place.
 */
export async function refreshPublicCache(
  target: PublicCacheTarget,
  site: SiteContext,
): Promise<PublicCacheRefreshResult> {
  const paths = publicCachePaths(target);
  const flightKey = `public-cache-refresh::${target.siteId}::${target.contentType}::${target.slug}::${target.locale}`;
  return singleflight(flightKey, async () => {
    const result: PublicCacheRefreshResult = { refreshed: [], failed: [], livePath: paths[0] ?? null };
    const keys = candidateVariantKeys(target);
    for (const pathname of paths) {
      for (const variantKey of keys) {
        const key = buildHtmlCacheKey(target.siteId, pathname, variantKey);
        const always = variantKey === "live" || variantKey === AUDIENCE_LLM_VARIANT;
        if (!always && !peekHtmlCacheEntry(key)) continue;
        const generation = bumpHtmlGeneration(key);
        try {
          const rendered = await renderHubHtml({ site, pathname, variantKey, writeCache: true, generation });
          if (!rendered) {
            result.failed.push({ pathname, variantKey, reason: "render_failed" });
          } else if (rendered.status === 200) {
            result.refreshed.push({ pathname, variantKey });
          } else if (rendered.status !== 204) {
            result.failed.push({ pathname, variantKey, reason: `status_${rendered.status}` });
          }
        } catch (err) {
          log.warn({ err, pathname, variantKey }, "public cache refresh render threw");
          result.failed.push({ pathname, variantKey, reason: "render_failed" });
        }
      }
    }
    log.info(
      {
        contentType: target.contentType,
        slug: target.slug,
        locale: target.locale,
        refreshed: result.refreshed.length,
        failed: result.failed.length,
      },
      "public cache refresh",
    );
    return result;
  });
}
