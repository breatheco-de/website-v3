import { Job } from "sidequest";
import { renderHubHtml } from "../../render-hub-html";
import {
  buildHtmlCacheKey,
  getHtmlBuildId,
  htmlDiskGeneration,
  listStoredHtmlCacheKeys,
  notifyHtmlCacheAdopted,
  parseHtmlCacheKey,
  type HotHtmlPageSnapshot,
} from "../../html-page-cache";
import { buildHtmlRebuildSite } from "../../html-rebuild";
import { getContentTypeListingUsage } from "../../content-type-usage";
import {
  planContentTypeHtmlUpdate,
  publicUrlsForType,
  storedPathsForContentType,
} from "./content-type-html-scope";
import { child } from "../../logger";
import { markJobFinished, markJobStarted } from "../heartbeat";

const log = child({ module: "job:html-content-type-rebuild" });

export type HtmlContentTypeRebuildPayload = {
  siteId: string;
  contentRoot: string;
  contentType: string;
  buildId: string;
  pages: HotHtmlPageSnapshot[];
  urlPatternChanged: boolean;
  previousUrlPattern?: Record<string, string> | string | null;
};

export class HtmlContentTypeRebuildJob extends Job {
  async run(payload: HtmlContentTypeRebuildPayload): Promise<{ ok: boolean; rebuilt: number; dropped: number }> {
    markJobStarted("html_content_type_rebuild");
    try {
      if (!payload?.contentType || !payload.contentRoot || !payload.siteId) {
        return { ok: false, rebuilt: 0, dropped: 0 };
      }
      if (payload.buildId && payload.buildId !== getHtmlBuildId()) {
        return { ok: true, rebuilt: 0, dropped: 0 };
      }
      const site = buildHtmlRebuildSite(payload.contentRoot, payload.siteId);
      const ci = site.contentIndex;
      const hot = payload.pages || [];
      const stored = storedPathsForContentType(
        ci,
        payload.siteId,
        payload.contentType,
        hot.map((page) => page.pathname),
      );
      const plan = planContentTypeHtmlUpdate({
        urlPatternChanged: payload.urlPatternChanged === true,
        previousUrls: payload.urlPatternChanged
          ? publicUrlsForType(ci, payload.contentType, payload.previousUrlPattern ?? null)
          : [],
        nextUrls: payload.urlPatternChanged ? publicUrlsForType(ci, payload.contentType) : [],
        storedPaths: stored,
      });

      const drop = new Set(plan.drop);
      const dropKeys: string[] = [];
      const seenDrop = new Set<string>();
      const noteDrop = (key: string) => {
        if (!key || seenDrop.has(key)) return;
        seenDrop.add(key);
        dropKeys.push(key);
      };
      for (const key of listStoredHtmlCacheKeys(payload.siteId)) {
        const parsed = parseHtmlCacheKey(key);
        if (parsed && drop.has(parsed.pathname)) noteDrop(key);
      }
      for (const page of hot) {
        if (drop.has(page.pathname)) {
          noteDrop(buildHtmlCacheKey(payload.siteId, page.pathname, page.variantKey || "live"));
        }
      }

      const adopted: string[] = [];
      const seen = new Set<string>();
      const renderPage = async (pathname: string, variantKey: string, generation: number) => {
        const key = buildHtmlCacheKey(payload.siteId, pathname, variantKey || "live");
        if (seen.has(key)) return;
        seen.add(key);
        const rendered = await renderHubHtml({
          site,
          pathname,
          variantKey: variantKey || "live",
          writeCache: true,
          generation,
        });
        if (rendered?.status === 200) adopted.push(key);
      };

      const wanted = new Set(plan.rebuild);
      for (const page of hot) {
        if (!wanted.has(page.pathname)) continue;
        await renderPage(page.pathname, page.variantKey || "live", page.generation + 1);
      }
      for (const key of listStoredHtmlCacheKeys(payload.siteId)) {
        const parsed = parseHtmlCacheKey(key);
        if (!parsed || !wanted.has(parsed.pathname)) continue;
        await renderPage(parsed.pathname, parsed.variantKey, htmlDiskGeneration(key) + 1);
      }
      for (const pathname of plan.rebuild) {
        await renderPage(pathname, "live", 1);
      }

      for (const hit of getContentTypeListingUsage(site.contentRoot, payload.contentType)) {
        const pathname = ci.buildUrl(hit.contentType, hit.locale, hit.slug);
        if (!pathname || pathname === "/") continue;
        const matches = hot.filter((page) => page.pathname === pathname);
        if (matches.length === 0) {
          await renderPage(pathname, "live", 1);
          continue;
        }
        for (const page of matches) {
          await renderPage(page.pathname, page.variantKey || "live", page.generation + 1);
        }
      }

      await notifyHtmlCacheAdopted(adopted, dropKeys);
      log.info(
        { contentType: payload.contentType, rebuilt: adopted.length, dropped: dropKeys.length },
        "content type html rebuild",
      );
      return { ok: true, rebuilt: adopted.length, dropped: dropKeys.length };
    } finally {
      markJobFinished("html_content_type_rebuild");
    }
  }
}
