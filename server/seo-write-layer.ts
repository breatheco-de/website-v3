/**
 * SEO write-layer rules: live locale, or draft only when the entry has no live locales.
 * A/B experiment variants cannot change seo: (leftover YAML is left alone; promote preserves live seo:).
 */

import * as fs from "fs";
import * as path from "path";
import {
  DEFAULT_DRAFT_VARIANT,
  getEntryContentDir,
  hasAnyLiveLocale,
} from "./draft-entry";
import { isTemplateVersioningSlug } from "./shared-layout-entry";
import {
  readSeoBlockFromYamlText,
  surgicalRemoveTopLevelKey,
  surgicalReplaceSeoBlock,
  yamlHasSeoKey,
  type SeoBlock,
} from "./seo-fields";

export const SEO_VARIANT_FORBIDDEN = "seo_variant_forbidden";
export const SEO_DRAFT_WHILE_LIVE_FORBIDDEN = "seo_draft_while_live_forbidden";

export type SeoWriteLayerOk = {
  ok: true;
  layer: "live" | "draft_unpublished";
};

export type SeoWriteLayerErr = {
  ok: false;
  code: typeof SEO_VARIANT_FORBIDDEN | typeof SEO_DRAFT_WHILE_LIVE_FORBIDDEN;
  error: string;
  statusCode: 400;
};

export type SeoWriteLayerResult = SeoWriteLayerOk | SeoWriteLayerErr;

function normalizeVariant(variant?: string | null): string | null {
  if (typeof variant !== "string") return null;
  const v = variant.trim();
  if (!v || v === "default") return null;
  return v;
}

/** Whether this entry folder already has any live `{locale}.yml`. */
export function entryHasAnyLiveLocale(
  contentType: string,
  slug: string,
  contentRoot?: string,
): boolean {
  const dir = getEntryContentDir(contentType, slug, contentRoot);
  return hasAnyLiveLocale(dir, isTemplateVersioningSlug(slug));
}

/**
 * Cluster SEO may be written only on live `{locale}.yml`, or on `draft.{locale}.yml`
 * when the entry has no live locales yet.
 */
export function assertSeoWriteLayerAllowed(opts: {
  contentType: string;
  slug: string;
  locale: string;
  variant?: string | null;
  contentRoot?: string;
}): SeoWriteLayerResult {
  const variant = normalizeVariant(opts.variant);
  if (!variant) {
    return { ok: true, layer: "live" };
  }

  const hasLive = entryHasAnyLiveLocale(opts.contentType, opts.slug, opts.contentRoot);

  if (variant === DEFAULT_DRAFT_VARIANT) {
    if (hasLive) {
      return {
        ok: false,
        code: SEO_DRAFT_WHILE_LIVE_FORBIDDEN,
        statusCode: 400,
        error:
          "Cluster SEO cannot be edited on draft while a live locale exists. Edit the live page instead.",
      };
    }
    return { ok: true, layer: "draft_unpublished" };
  }

  return {
    ok: false,
    code: SEO_VARIANT_FORBIDDEN,
    statusCode: 400,
    error:
      "Cluster SEO cannot be edited on experiment variants. Use the live locale (or draft only when the page is not live yet).",
  };
}

/**
 * When promoting over an existing live file, keep live `seo:` and drop variant `seo:`.
 * First go-live (no live file yet) keeps the variant/draft SEO as-is.
 */
export function yamlForPromotePreservingLiveSeo(
  variantContent: string,
  liveContent: string | null,
): { content: string; ignoredVariantSeo: boolean } {
  if (!liveContent) {
    return { content: variantContent, ignoredVariantSeo: false };
  }

  const variantHadSeo = yamlHasSeoKey(variantContent);
  const liveHadSeo = yamlHasSeoKey(liveContent);
  let out = variantContent;

  if (liveHadSeo) {
    const liveSeo = readSeoBlockFromYamlText(liveContent) as SeoBlock;
    out = surgicalReplaceSeoBlock(out, liveSeo);
  } else if (variantHadSeo) {
    out = surgicalRemoveTopLevelKey(out, "seo");
  }

  return { content: out, ignoredVariantSeo: variantHadSeo };
}

/** Basename helpers for tests / UI. */
export function isDraftVariantName(variant?: string | null): boolean {
  return normalizeVariant(variant) === DEFAULT_DRAFT_VARIANT;
}

export function seoWriteLayerAllowedForUi(opts: {
  contentType: string;
  slug: string;
  isVariantLayer: boolean;
  resolvedVariant?: string | null;
  contentRoot?: string;
}): { allowed: boolean; reason?: string } {
  if (!opts.isVariantLayer) return { allowed: true };
  const gate = assertSeoWriteLayerAllowed({
    contentType: opts.contentType,
    slug: opts.slug,
    locale: "en",
    variant: opts.resolvedVariant ?? DEFAULT_DRAFT_VARIANT,
    contentRoot: opts.contentRoot,
  });
  if (gate.ok) return { allowed: true };
  return { allowed: false, reason: gate.error };
}

/** Resolve entry dir for tests without exporting draft-entry internals twice. */
export function entryDirForSeoWrite(
  contentType: string,
  slug: string,
  contentRoot?: string,
): string {
  return getEntryContentDir(contentType, slug, contentRoot);
}

export function liveLocalePathInEntry(entryDir: string, locale: string): string {
  return path.join(entryDir, `${locale}.yml`);
}

export function draftLocalePathInEntry(entryDir: string, locale: string): string {
  return path.join(entryDir, `${DEFAULT_DRAFT_VARIANT}.${locale}.yml`);
}

export function ensureDir(dir: string): void {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}
