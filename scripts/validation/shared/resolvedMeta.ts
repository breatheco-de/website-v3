/**
 * Filled-in meta for SEO validators — same resolution as live delivery / the
 * live SEO gate (field-mapped entry bag + site vars at default values).
 * Memoized per ContentFile so meta / seo-depth / seo-duplicates resolve once.
 */

import * as path from "path";
import type { ContentFile, ValidationContext } from "./types";
import { resolveEntryMeta } from "../../../server/resolve-entry-meta";
import { getDefaultContentRoot } from "../../../server/site-config";

export type ResolvedMetaResult =
  | { ok: true; meta: Record<string, unknown>; singleEntry: Record<string, unknown> }
  | { ok: false; error: string };

const TEMPLATE_RE = /\{\{[\s\S]*?\}\}/;

export function hasTemplate(value: unknown): boolean {
  return typeof value === "string" && TEMPLATE_RE.test(value);
}

export function resolveContentRoot(context: ValidationContext): string {
  if (context.contentRoot) {
    return path.isAbsolute(context.contentRoot)
      ? context.contentRoot
      : path.join(process.cwd(), context.contentRoot);
  }
  return path.resolve(getDefaultContentRoot());
}

const cache = new WeakMap<ContentFile, ResolvedMetaResult>();

function pageDataFor(file: ContentFile): Record<string, unknown> {
  if (file.entryFields && typeof file.entryFields === "object") {
    return file.entryFields.meta === undefined && file.meta
      ? { ...file.entryFields, meta: file.meta }
      : file.entryFields;
  }
  return { meta: file.meta ?? {} };
}

export function getResolvedMeta(
  file: ContentFile,
  context: ValidationContext,
): ResolvedMetaResult {
  const hit = cache.get(file);
  if (hit) return hit;

  let result: ResolvedMetaResult;
  try {
    const { meta, singleEntry } = resolveEntryMeta({
      contentType: file.type,
      slug: file.slug,
      locale: file.locale,
      pageData: pageDataFor(file),
      contentRoot: resolveContentRoot(context),
      singleEntry: file.singleEntry,
    });
    result = { ok: true, meta, singleEntry };
  } catch (err) {
    result = { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
  cache.set(file, result);
  return result;
}
