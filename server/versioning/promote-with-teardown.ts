/**
 * Shared promote + optional experiment teardown for versioning routes and proposal apply.
 * Teardown of traffic-bearing siblings bypasses variantTrafficBlock (confirm already required).
 */
import fs from "fs";
import path from "path";
import { createHash } from "crypto";
import type { ContentType } from "@shared/schema";
import type { ContentIndex } from "../content-index";
import type { VersioningManager, VersioningFile } from "./VersioningManager";
import { pruneVersioningAfterVariantRemove } from "./delete-variant";
import { markFileAsModified } from "../sync-state";
import { deepMerge } from "../utils/deepMerge";
import {
  liveTemplateBasename,
  variantTemplateBasename,
  isReservedTemplateVariantSlug,
} from "../shared-layout-paths";
import { hasAnyLiveLocale, liveLocaleFileName } from "../draft-entry";
import { validateYamlIdentity } from "../validate-content-identity";
import { assertLocaleUrlAvailable } from "../locale-url-slug";
import { ensurePublishedAtOnce } from "../published-at";
import { clearSsrSchemaCache } from "../ssr-schema";
import { invalidateContentCaches } from "../routes/_helpers";
import { buildEntryKey } from "../../scripts/validation/shared/entryKey";
import { scheduleOnSaveValidation } from "../services/onSaveValidation";
import { emitEntryLocalePromoted } from "../content-events";
import { refreshSitemapEntriesForContentKey } from "../sitemap";
import type { ValidationCacheService } from "../services/validationCacheService";

export type TrafficSibling = {
  slug: string;
  locale: string;
  allocation: number;
};

export function hashVariantFileContents(raw: string): string {
  return createHash("sha256").update(raw).digest("hex").slice(0, 24);
}

export function listTrafficSiblings(opts: {
  versioning: VersioningFile | null | undefined;
  locale: string;
  excludeVariantSlug: string;
}): TrafficSibling[] {
  const variants = opts.versioning?.[opts.locale]?.variants ?? [];
  return variants
    .filter((v) => v.slug !== opts.excludeVariantSlug && (v.allocation ?? 0) > 0)
    .map((v) => ({
      slug: v.slug,
      locale: opts.locale,
      allocation: v.allocation ?? 0,
    }));
}

export type PromoteWithTeardownArgs = {
  contentType: string;
  slug: string;
  locale: string;
  variantSlug: string;
  author: string;
  contentRoot: string;
  contentRootName: string;
  folder: string;
  templateMode: boolean;
  versioningManager: VersioningManager;
  ci: ContentIndex;
  cache: ValidationCacheService;
  /** When true (proposal apply), traffic siblings require confirm_end_experiment and are deleted. When false (Versions UI), siblings are left alone. */
  endExperimentMode?: boolean;
  /** When true in endExperimentMode, delete other variants on this locale with allocation > 0. */
  confirmEndExperiment?: boolean;
};

export type PromoteWithTeardownResult =
  | {
      ok: true;
      ignoredVariantSeo: boolean;
      deletedSiblings: TrafficSibling[];
    }
  | {
      ok: false;
      code: string;
      error: string;
      traffic_siblings?: TrafficSibling[];
      status?: number;
    };

export async function promoteVariantWithOptionalTeardown(
  args: PromoteWithTeardownArgs,
): Promise<PromoteWithTeardownResult> {
  const {
    contentType,
    slug,
    locale,
    variantSlug,
    author,
    contentRoot,
    contentRootName,
    folder,
    templateMode,
    versioningManager,
    ci,
    cache,
    endExperimentMode,
    confirmEndExperiment,
  } = args;

  if (!/^[a-z0-9-]+$/.test(variantSlug)) {
    return { ok: false, code: "invalid_variant", error: "variantSlug must be lowercase letters, numbers, and hyphens only" };
  }
  if (isReservedTemplateVariantSlug(variantSlug)) {
    return {
      ok: false,
      code: "reserved_variant",
      error: 'Variant slug "template" and "single" are reserved for the shared-layout shell',
    };
  }
  if (!/^[a-z]{2}(-[A-Z]{2})?$/.test(locale)) {
    return { ok: false, code: "invalid_locale", error: "locale must be a valid language code (e.g. en, es, pt-BR)" };
  }

  const contentDir = path.resolve(versioningManager.getVersioningContentDir(contentType, slug));
  if (!fs.existsSync(contentDir)) {
    return { ok: false, code: "not_found", error: "Content folder not found", status: 404 };
  }

  const variantFilePath = path.resolve(
    versioningManager.getVariantFilePath(contentType, slug, variantSlug, locale),
  );
  const defaultFilePath = path.resolve(
    contentDir,
    templateMode ? liveLocaleFileName(locale, true) : `${locale}.yml`,
  );

  if (
    !variantFilePath.startsWith(contentDir + path.sep) ||
    !defaultFilePath.startsWith(contentDir + path.sep)
  ) {
    return { ok: false, code: "invalid_path", error: "Invalid file path" };
  }

  if (!fs.existsSync(variantFilePath)) {
    return {
      ok: false,
      code: "variant_missing",
      error: templateMode
        ? `Variant file ${variantTemplateBasename(variantSlug, locale)} not found`
        : `Variant file ${variantSlug}.${locale}.yml not found`,
      status: 404,
    };
  }

  const existing = versioningManager.getVersioningForContent(contentType, slug) || {};
  const trafficSiblings = listTrafficSiblings({
    versioning: existing,
    locale,
    excludeVariantSlug: variantSlug,
  });

  if (endExperimentMode && trafficSiblings.length > 0 && !confirmEndExperiment) {
    return {
      ok: false,
      code: "confirm_end_experiment",
      error:
        "Other variants still have traffic allocated. Pass confirm_end_experiment: true to promote and remove those traffic-bearing versions.",
      traffic_siblings: trafficSiblings,
    };
  }

  const wasUnpublished = !templateMode && !hasAnyLiveLocale(contentDir, templateMode);
  const deletedSiblings: TrafficSibling[] = [];

  try {
    if (endExperimentMode && trafficSiblings.length > 0 && confirmEndExperiment) {
      let versioningState: VersioningFile = { ...existing };
      for (const sib of trafficSiblings) {
        const sibPath = path.resolve(
          versioningManager.getVariantFilePath(contentType, slug, sib.slug, sib.locale),
        );
        if (fs.existsSync(sibPath) && sibPath.startsWith(contentDir + path.sep)) {
          fs.unlinkSync(sibPath);
          if (templateMode) {
            markFileAsModified(
              `${folder}/${variantTemplateBasename(sib.slug, sib.locale)}`,
              author,
              undefined,
              contentRoot,
            );
          } else {
            markFileAsModified(
              `${folder}/${slug}/${sib.slug}.${sib.locale}.yml`,
              author,
              undefined,
              contentRoot,
            );
          }
        }
        const pruned = pruneVersioningAfterVariantRemove(versioningState, sib.locale, sib.slug);
        versioningState = pruned.data;
        deletedSiblings.push(sib);
        cache.clearEntryKey(buildEntryKey(contentType, slug, sib.locale, sib.slug));
      }
      versioningManager.updateVersioning(contentType, slug, versioningState);
    }

    const variantContent = fs.readFileSync(variantFilePath, "utf-8");
    const identityErr = validateYamlIdentity(variantContent, {
      contentType,
      contentSlug: slug,
    });
    if (identityErr) {
      return {
        ok: false,
        code: "identity",
        error:
          `Cannot promote: ${identityErr}. ` +
          `Set conversion_name / CTA tracking / funnel.products on _common.yml (Funnel tab) before promoting.`,
      };
    }
    const parsedVariant = (ci.safeYamlLoad(variantContent) as Record<string, unknown>) || {};
    const commonForGate = ci.loadCommonData(contentType, slug) || {};
    const { assertLiveEntrySeoAndRequiredFields } = await import("../live-entry-seo-gate");
    const seoGateErr = assertLiveEntrySeoAndRequiredFields({
      contentType,
      slug,
      locale,
      pageData: deepMerge(commonForGate, parsedVariant) as Record<string, unknown>,
      contentRoot,
      mode: "publish",
      intent: "publish",
      isDraftWrite: false,
    });
    if (seoGateErr) {
      return { ok: false, code: "seo_gate", error: `Cannot promote: ${seoGateErr}` };
    }
    if (!templateMode) {
      const mergedForUrl = deepMerge(commonForGate, parsedVariant) as Record<string, unknown>;
      const urlCheck = assertLocaleUrlAvailable({
        contentType,
        entryIdentity: slug,
        locale,
        mergedPageData: mergedForUrl,
        ci,
      });
      if (!urlCheck.ok) {
        return {
          ok: false,
          code: urlCheck.code || "url_conflict",
          error: `Cannot promote: ${urlCheck.error}`,
          status: urlCheck.statusCode,
        };
      }
    }

    const liveExisted = fs.existsSync(defaultFilePath);
    const liveContent = liveExisted ? fs.readFileSync(defaultFilePath, "utf-8") : null;
    const { yamlForPromotePreservingLiveSeo } = await import("../seo-write-layer");
    const promoted = yamlForPromotePreservingLiveSeo(variantContent, liveContent);
    fs.writeFileSync(defaultFilePath, promoted.content, "utf-8");

    const afterTeardown =
      versioningManager.getVersioningForContent(contentType, slug) || {};
    const localeData = afterTeardown[locale];
    if (localeData) {
      const updatedVariants = (localeData.variants || []).filter((v) => v.slug !== variantSlug);
      versioningManager.updateVersioning(contentType, slug, {
        ...afterTeardown,
        [locale]: { variants: updatedVariants },
      });
    }

    fs.unlinkSync(variantFilePath);

    if (wasUnpublished) {
      ensurePublishedAtOnce(contentType, slug, {
        author,
        contentRoot,
      });
    }

    ci.invalidateCommonFields(contentType);
    clearSsrSchemaCache();
    invalidateContentCaches(contentType as ContentType, ci);

    cache.clearEntryKey(buildEntryKey(contentType, slug, locale, variantSlug));

    if (templateMode) {
      markFileAsModified(`${folder}/${liveTemplateBasename(locale)}`, author, undefined, contentRoot);
      markFileAsModified(
        `${folder}/${variantTemplateBasename(variantSlug, locale)}`,
        author,
        undefined,
        contentRoot,
      );
    } else {
      markFileAsModified(`${folder}/${slug}/${locale}.yml`, author, undefined, contentRoot);
      markFileAsModified(
        `${folder}/${slug}/${variantSlug}.${locale}.yml`,
        author,
        undefined,
        contentRoot,
      );
      ci.refresh();
      refreshSitemapEntriesForContentKey(contentType, slug, [locale]);
    }

    scheduleOnSaveValidation({
      contentRoot,
      contentRootName,
      ci,
      cache,
      contentType,
      slug,
      locale,
      filePath: defaultFilePath,
    });
    await cache.flush();

    emitEntryLocalePromoted({
      site: contentRootName,
      contentType,
      slug,
      locale,
      author,
    });

    try {
      const { syncSeoIndexEntryFromLiveDisk } = await import("../seo-index");
      syncSeoIndexEntryFromLiveDisk({
        contentType,
        slug,
        locale,
        contentRoot,
        author,
        ci,
      });
    } catch {
      /* non-fatal */
    }

    return {
      ok: true,
      ignoredVariantSeo: promoted.ignoredVariantSeo,
      deletedSiblings,
    };
  } catch (error) {
    return { ok: false, code: "promote_failed", error: String(error), status: 500 };
  }
}
