/**
 * Early crawl control for public document requests: hard-deny known LLM crawlers
 * when indexing_block is `ai` or `all`, without blocking /robots.txt.
 */

import type { Request, Response } from "express";
import { shouldHardDenyLlmCrawler } from "./settings";

/** Paths crawlers must still reach so they can honor Disallow / sitemap rules. */
export function isSeoControlPath(pathname: string): boolean {
  const path = (pathname.split("?")[0] || "/").replace(/\/+$/, "") || "/";
  return path === "/robots.txt" || path === "/sitemap.xml";
}

/**
 * If this request should be hard-denied, send 403 and return true.
 * Callers skip further HTML rendering when true.
 */
export function maybeHardDenyLlmRequest(
  req: Request,
  res: Response,
  contentRoot?: string,
): boolean {
  const pathname = (req.path || req.url || "/").split("?")[0] || "/";
  if (isSeoControlPath(pathname)) return false;
  if (pathname.startsWith("/api/") || pathname.startsWith("/private/")) return false;

  const ua = typeof req.get === "function" ? req.get("user-agent") : undefined;
  if (!shouldHardDenyLlmCrawler(ua, contentRoot)) return false;

  res.status(403);
  res.setHeader("Content-Type", "text/plain; charset=utf-8");
  res.setHeader("Cache-Control", "private, no-store");
  res.send("Forbidden");
  return true;
}
