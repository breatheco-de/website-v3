import { Job } from "sidequest";
import { renderHubHtml } from "../../render-hub-html";
import { buildHtmlCacheKey, getHtmlBuildId, notifyHtmlCacheAdopted } from "../../html-page-cache";
import { buildHtmlRebuildSite } from "../../html-rebuild";
import { AUDIENCE_LLM_VARIANT } from "../../../shared/llm-html-audience";
import { child } from "../../logger";
import { markJobFinished, markJobStarted } from "../heartbeat";

const log = child({ module: "job:html-page-rebuild" });

export type HtmlPageRebuildPayload = {
  siteId: string;
  contentRoot: string;
  pathname: string;
  variantKey?: string;
  generation: number;
  buildId: string;
};

export class HtmlPageRebuildJob extends Job {
  async run(payload: HtmlPageRebuildPayload): Promise<{ ok: boolean; reason?: string }> {
    markJobStarted("html_page_rebuild");
    try {
      if (!payload?.pathname || !payload.contentRoot || !payload.siteId) {
        return { ok: false, reason: "invalid_payload" };
      }
      if (payload.buildId && payload.buildId !== getHtmlBuildId()) {
        return { ok: true, reason: "stale_build" };
      }
      const site = buildHtmlRebuildSite(payload.contentRoot, payload.siteId);
      const variantKey = payload.variantKey || "live";
      const rendered = await renderHubHtml({
        site,
        pathname: payload.pathname,
        variantKey,
        writeCache: true,
        generation: payload.generation,
      });
      // Temporary prod-parity probe: does SSR leave browser-like globals in this worker?
      {
        const g = globalThis as typeof globalThis & { window?: { document?: unknown }; document?: unknown };
        log.warn(
          {
            pathname: payload.pathname,
            status: rendered?.status,
            pid: process.pid,
            weblify: process.env.WEBLIFY_PROCESS,
            typeof_window: typeof g.window,
            typeof_document: typeof g.document,
            typeof_navigator: typeof navigator,
            has_window_document: !!g.window?.document,
          },
          "[env-probe] after html SSR",
        );
      }
      if (!rendered || (rendered.status !== 200 && rendered.status !== 204)) {
        log.warn({ pathname: payload.pathname, status: rendered?.status }, "html rebuild missed");
        return { ok: false, reason: "render_failed" };
      }
      if (rendered.status === 204) {
        return { ok: true, reason: "not_branching" };
      }
      const adopted = [buildHtmlCacheKey(payload.siteId, payload.pathname, variantKey)];
      if (variantKey === "live") {
        const llm = await renderHubHtml({
          site,
          pathname: payload.pathname,
          variantKey: AUDIENCE_LLM_VARIANT,
          writeCache: true,
          generation: payload.generation,
        });
        if (!llm || (llm.status !== 200 && llm.status !== 204)) {
          log.warn({ pathname: payload.pathname, status: llm?.status }, "audience-llm rebuild missed");
          return { ok: false, reason: "render_failed" };
        }
        if (llm.status === 200) {
          adopted.push(buildHtmlCacheKey(payload.siteId, payload.pathname, AUDIENCE_LLM_VARIANT));
        }
      }
      await notifyHtmlCacheAdopted(adopted);
      log.info(
        { pathname: payload.pathname, generation: payload.generation, fromCache: rendered.fromCache },
        "html rebuild wrote",
      );
      return { ok: true };
    } finally {
      markJobFinished("html_page_rebuild");
    }
  }
}
