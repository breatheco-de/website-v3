import { Job } from "sidequest";
import { renderHubHtml } from "../../render-hub-html";
import { buildHtmlCacheKey, getHtmlBuildId, notifyHtmlCacheAdopted } from "../../html-page-cache";
import { buildHtmlRebuildSite } from "../../html-rebuild";
import { getContentTypeListingUsage } from "../../content-type-usage";
import type { HotHtmlPageSnapshot } from "../../html-page-cache";
import { child } from "../../logger";
import { markJobFinished, markJobStarted } from "../heartbeat";
import { AUDIENCE_LLM_VARIANT } from "../../../shared/llm-html-audience";

const log = child({ module: "job:html-content-type-listing-rebuild" });

export type HtmlContentTypeListingPayload = {
  siteId: string;
  contentRoot: string;
  contentType: string;
  buildId: string;
  pages: HotHtmlPageSnapshot[];
};

export class HtmlContentTypeListingRebuildJob extends Job {
  async run(payload: HtmlContentTypeListingPayload): Promise<{ ok: boolean; rebuilt: number }> {
    markJobStarted("html_content_type_listing_rebuild");
    try {
      if (!payload?.contentType || !payload.contentRoot || !payload.siteId) {
        return { ok: false, rebuilt: 0 };
      }
      if (payload.buildId && payload.buildId !== getHtmlBuildId()) {
        return { ok: true, rebuilt: 0 };
      }
      const site = buildHtmlRebuildSite(payload.contentRoot, payload.siteId);
      const ci = site.contentIndex;

      const hits = getContentTypeListingUsage(site.contentRoot, payload.contentType);
      const adopted: string[] = [];
      const seen = new Set<string>();
      for (const hit of hits) {
        const pathname = ci.buildUrl(hit.contentType, hit.locale, hit.slug);
        if (!pathname || pathname === "/") continue;
        const hot = (payload.pages || []).filter((page) => page.pathname === pathname);
        const targets = hot.length > 0 ? hot : [{ pathname, variantKey: "live", generation: 0 }];
        for (const page of targets) {
          const variantKey = page.variantKey || "live";
          const key = buildHtmlCacheKey(payload.siteId, pathname, variantKey);
          if (seen.has(key)) continue;
          seen.add(key);
          const rendered = await renderHubHtml({
            site,
            pathname,
            variantKey,
            writeCache: true,
            generation: page.generation + 1,
          });
          if (rendered?.status === 200) adopted.push(key);
          if (variantKey === "live") {
            const llmKey = buildHtmlCacheKey(payload.siteId, pathname, AUDIENCE_LLM_VARIANT);
            if (!seen.has(llmKey)) {
              seen.add(llmKey);
              const llm = await renderHubHtml({
                site,
                pathname,
                variantKey: AUDIENCE_LLM_VARIANT,
                writeCache: true,
                generation: page.generation + 1,
              });
              if (llm?.status === 200) adopted.push(llmKey);
            }
          }
        }
      }
      await notifyHtmlCacheAdopted(adopted);
      log.info(
        { contentType: payload.contentType, listings: hits.length, rebuilt: adopted.length },
        "content type listing html rebuild",
      );
      return { ok: true, rebuilt: adopted.length };
    } finally {
      markJobFinished("html_content_type_listing_rebuild");
    }
  }
}
