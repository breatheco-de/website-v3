/**
 * Fill in an entry's meta the same way live delivery does:
 * field-mapped `{{ entry.* }}` / `{{ single.* }}` bag, then meta/seo/site vars
 * (brand.* / global.* / reserved.*) with default variable values.
 *
 * Shared by the live SEO gate and the SEO validators so both check the text
 * visitors see in the browser tab.
 */

import { resolveSingleVars } from "./single-resolver";
import { buildSingleEntryFromContent } from "./build-single-entry";
import { finalizeSingleEntryForTemplates } from "./content-types";
import { resolveAllTemplateVars } from "./resolve-template-vars";
import { getDefaultContentRoot } from "./site-config";

export type ResolveEntryMetaOptions = {
  contentType: string;
  slug: string;
  locale: string;
  /** Merged page data (common + locale, plus shared-layout template when attached). */
  pageData: Record<string, unknown>;
  contentRoot?: string;
  /** Already-mapped entry bag (database items). Skips re-applying the field mapping. */
  singleEntry?: Record<string, unknown>;
};

export type ResolvedEntryMeta = {
  singleEntry: Record<string, unknown>;
  /** pageData with `{{ entry.* }}` / `{{ single.* }}` filled in. */
  resolvedPage: Record<string, unknown>;
  /** Fully filled-in meta (entry, meta, seo and site vars). */
  meta: Record<string, unknown>;
};

export function resolveEntryMeta(opts: ResolveEntryMetaOptions): ResolvedEntryMeta {
  const { contentType, slug, locale, pageData, contentRoot } = opts;

  const singleEntry =
    finalizeSingleEntryForTemplates(
      opts.singleEntry ??
        (buildSingleEntryFromContent(contentType, pageData, {
          slug,
          locale,
          contentRoot,
        }) || {}),
      { slug, locale },
    ) || {};

  const resolvedPage = resolveSingleVars(pageData, singleEntry) as Record<string, unknown>;

  const region =
    typeof pageData.region === "string" && pageData.region.trim()
      ? pageData.region.trim()
      : undefined;
  const rawMeta = resolvedPage.meta;
  const metaInput =
    rawMeta && typeof rawMeta === "object" && !Array.isArray(rawMeta)
      ? (rawMeta as Record<string, unknown>)
      : undefined;

  const resolvedMeta = resolveAllTemplateVars(metaInput ?? {}, {
    singleEntry,
    meta: metaInput,
    contentRoot: contentRoot ?? getDefaultContentRoot(),
    context: { locale, region },
    skipSiteVars: false,
  });

  const meta =
    resolvedMeta && typeof resolvedMeta === "object" && !Array.isArray(resolvedMeta)
      ? (resolvedMeta as Record<string, unknown>)
      : {};

  return { singleEntry, resolvedPage, meta };
}
