/**
 * AI crawlers read audience-llm. A miss renders that copy with the same
 * function Sidequest uses. A page that does not branch falls through to live.
 * This request does not assign an experiment.
 */

import type { Request, Response } from "express";
import { isLlmHtmlAudience } from "../shared/runtime-issues";
import { AUDIENCE_LLM_VARIANT } from "../shared/llm-html-audience";
import {
  buildHtmlCacheKey,
  getCachedHtml,
  pickCachedEncoding,
  type CachedHtmlPage,
} from "./html-page-cache";
import { renderHubHtml } from "./render-hub-html";
import type { SiteContext } from "./site-manager";

export const LLM_HTML_CACHE_CONTROL = "private, no-store";

export function prepareLlmHtmlRequest(
  req: Request,
  res: Response,
  siteId: string,
  cachePath: string,
): CachedHtmlPage | null {
  if (!isLlmHtmlAudience(typeof req.get === "function" ? req.get("user-agent") : undefined)) {
    return null;
  }
  (res.locals as { htmlVariantKey?: string }).htmlVariantKey = "live";
  return getCachedHtml(buildHtmlCacheKey(siteId, cachePath, AUDIENCE_LLM_VARIANT));
}

export function sendCachedHtmlPage(
  req: Request,
  res: Response,
  cached: CachedHtmlPage,
  cacheControl: string,
): void {
  const encoding = pickCachedEncoding(req.headers["accept-encoding"]);
  const body = encoding === "br" ? cached.br : encoding === "gzip" ? cached.gzip : cached.html;
  if (encoding !== "identity") {
    req.headers["x-no-compression"] = "1";
  }
  res.status(cached.status);
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.setHeader("Cache-Control", cacheControl);
  res.setHeader("X-HTML-Cache", "HIT");
  res.setHeader("Vary", "Accept-Encoding");
  if (encoding !== "identity") res.setHeader("Content-Encoding", encoding);
  res.send(body);
}

/**
 * Cache miss for an AI crawler. Writes audience-llm only, never the live key.
 * Returns true when the response was sent.
 */
export async function renderAudienceLlmMiss(
  req: Request,
  res: Response,
  site: SiteContext | undefined,
  cachePath: string,
): Promise<boolean> {
  if (!isLlmHtmlAudience(typeof req.get === "function" ? req.get("user-agent") : undefined)) {
    return false;
  }
  const locals = res.locals as { audienceLlmMissTried?: boolean };
  if (locals.audienceLlmMissTried || !site) return false;
  locals.audienceLlmMissTried = true;
  const siteId =
    site.contentRootName || site.contentRoot || (site as { domain?: string }).domain || "default";
  const cached = getCachedHtml(buildHtmlCacheKey(siteId, cachePath, AUDIENCE_LLM_VARIANT));
  if (cached?.html) {
    sendCachedHtmlPage(req, res, cached, LLM_HTML_CACHE_CONTROL);
    return true;
  }
  const rendered = await renderHubHtml({
    site,
    pathname: cachePath,
    variantKey: AUDIENCE_LLM_VARIANT,
    writeCache: true,
  });
  if (!rendered || rendered.status !== 200 || !rendered.html) return false;
  res.status(rendered.status);
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.setHeader("Cache-Control", LLM_HTML_CACHE_CONTROL);
  res.setHeader("X-HTML-Cache", "MISS");
  res.setHeader("Vary", "Accept-Encoding");
  res.send(rendered.html);
  return true;
}
