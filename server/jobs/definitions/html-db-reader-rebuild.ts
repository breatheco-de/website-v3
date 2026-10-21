import { Job } from "sidequest";
import { getDatabaseUsage } from "../../database-usage";
import { renderHubHtml } from "../../render-hub-html";
import { buildHtmlCacheKey, getHtmlBuildId, notifyHtmlCacheAdopted } from "../../html-page-cache";
import { buildHtmlRebuildSite } from "../../html-rebuild";
import { pageReadsDatabase } from "../../content-type-usage";
import { child } from "../../logger";
import { markJobFinished, markJobStarted } from "../heartbeat";
import { AUDIENCE_LLM_VARIANT } from "../../../shared/llm-html-audience";

const log = child({ module: "job:html-db-reader-rebuild" });

export type HtmlDbReaderPage = {
  pathname: string;
  variantKey: string;
  generation: number;
};

export type HtmlDbReaderRebuildPayload = {
  siteId: string;
  contentRoot: string;
  dbName: string;
  buildId: string;
  pages: HtmlDbReaderPage[];
};

function pageLocale(resolved: {
  params?: Record<string, string>;
  patternLocale?: string;
}): string {
  if (resolved.params?.locale) return resolved.params.locale;
  if (resolved.patternLocale && resolved.patternLocale !== "default") return resolved.patternLocale;
  return "en";
}

export class HtmlDbReaderRebuildJob extends Job {
  async run(payload: HtmlDbReaderRebuildPayload): Promise<{ ok: boolean; rebuilt: number }> {
    markJobStarted("html_db_reader_rebuild");
    try {
      if (!payload?.dbName || !payload.contentRoot || !payload.pages?.length) {
        return { ok: false, rebuilt: 0 };
      }
      if (payload.buildId && payload.buildId !== getHtmlBuildId()) {
        return { ok: true, rebuilt: 0 };
      }
      const site = buildHtmlRebuildSite(payload.contentRoot, payload.siteId);
      const ci = site.contentIndex;
      const usage = getDatabaseUsage(payload.dbName, { contentRoot: site.contentRoot, db: site.database });

      const adopted: string[] = [];
      const seen = new Set<string>();
      const renderPage = async (pathname: string, variantKey: string, generation: number) => {
        const key = buildHtmlCacheKey(payload.siteId, pathname, variantKey || "live");
        if (seen.has(key)) return;
        seen.add(key);
        const rendered = await renderHubHtml({
          site,
          pathname,
          variantKey,
          writeCache: true,
          generation,
        });
        if (rendered?.status === 200) adopted.push(key);
        if ((variantKey || "live") === "live") {
          await renderPage(pathname, AUDIENCE_LLM_VARIANT, generation);
        }
      };

      for (const page of payload.pages || []) {
        const resolved = ci.resolveUrl(page.pathname);
        if (!resolved) continue;
        const reads = pageReadsDatabase(
          {
            contentType: resolved.contentType,
            slug: resolved.slug,
            locale: pageLocale(resolved),
          },
          usage.queries,
        );
        if (!reads) continue;
        await renderPage(page.pathname, page.variantKey || "live", page.generation + 1);
      }

      for (const query of usage.queries) {
        if (!query.slug || query.kind === "field_editor") continue;
        const locale = query.locale && query.locale !== "default" ? query.locale : "en";
        const pathname = ci.buildUrl(query.content_type, locale, query.slug);
        if (!pathname || pathname === "/") continue;
        const hot = (payload.pages || []).filter((page) => page.pathname === pathname);
        if (hot.length === 0) await renderPage(pathname, "live", 1);
      }
      await notifyHtmlCacheAdopted(adopted);
      log.info(
        { dbName: payload.dbName, hot: (payload.pages || []).length, rebuilt: adopted.length },
        "database reader html rebuild",
      );
      return { ok: true, rebuilt: adopted.length };
    } finally {
      markJobFinished("html_db_reader_rebuild");
    }
  }
}
