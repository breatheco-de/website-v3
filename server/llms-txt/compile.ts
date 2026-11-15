/**
 * Deterministic compile of llms.template.md → public /llms.txt body + in-memory cache.
 * Cache keys include template mtime so the web process picks up Sidequest writes
 * without a cross-process invalidate.
 */

import fs from "fs";
import { resolveAllTemplateVars } from "../resolve-template-vars";
import { getDefaultContentRoot } from "../site-config";
import { readLlmsTemplate, llmsTemplatePath } from "./regenerate-prompt";

type CacheEntry = { body: string; mtimeMs: number };

const compiledCache = new Map<string, CacheEntry>();

function cacheKey(contentRoot?: string): string {
  return contentRoot ?? getDefaultContentRoot();
}

export function getLlmsTemplateMtimeMs(contentRoot?: string): number | null {
  try {
    return fs.statSync(llmsTemplatePath(contentRoot)).mtimeMs;
  } catch {
    return null;
  }
}

export function invalidateLlmsCompiledCache(contentRoot?: string): void {
  if (contentRoot !== undefined) {
    compiledCache.delete(contentRoot);
    return;
  }
  compiledCache.clear();
}

export type CompileLlmsResult =
  | { ok: true; body: string; fromCache: boolean }
  | { ok: false; reason: "missing_template" };

/** Resolve template variables; no OpenRouter. */
export function compileLlmsTxt(contentRoot?: string): CompileLlmsResult {
  const key = cacheKey(contentRoot);
  const mtimeMs = getLlmsTemplateMtimeMs(contentRoot);
  if (mtimeMs === null) {
    compiledCache.delete(key);
    return { ok: false, reason: "missing_template" };
  }

  const hit = compiledCache.get(key);
  if (hit && hit.mtimeMs === mtimeMs) {
    return { ok: true, body: hit.body, fromCache: true };
  }

  const template = readLlmsTemplate(contentRoot);
  if (template === null) {
    compiledCache.delete(key);
    return { ok: false, reason: "missing_template" };
  }

  const resolved = resolveAllTemplateVars(template, {
    contentRoot: contentRoot ?? getDefaultContentRoot(),
    context: { locale: "en" },
    skipSiteVars: false,
  });

  const body = typeof resolved === "string" ? resolved : String(resolved ?? "");
  compiledCache.set(key, { body, mtimeMs });
  return { ok: true, body, fromCache: false };
}

export function llmsTemplateExists(contentRoot?: string): boolean {
  return readLlmsTemplate(contentRoot) !== null;
}

export { llmsTemplatePath };
