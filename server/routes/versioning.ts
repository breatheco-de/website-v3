import type { Express, Request, Response } from "express";
import { getDefaultContentRoot } from "../site-config";
import { createServer, type Server } from "http";
import { storage } from "../storage";
import { geoGet, geoSet } from "../geo-cache";
import { getQueueStats, enqueueOptimization, getPendingOptimizations, getFailedEntries, retryFailedImages, resetOptimizeSession, getOptimizeSession, enqueueExternalImage } from "../image-registry";
import { getAllQueueState } from "../image-queue-state";


import * as fs from "fs";
import * as path from "path";
import * as yaml from "js-yaml";
import { execSync as _execSync, execFile } from "child_process";
import { canonicalSectionId } from "../utils/sectionIdentity";
import {
  versioningUpdateSchema,
  type CareerProgram,
  type LandingPage,
  type LocationPage,
  type TemplatePage,
} from "@shared/schema";
import {
  getSitemap,
  clearSitemapCache,
  getSitemapCacheStatus,
  getSitemapUrls,
  invalidateSitemapEntry,
  invalidateSitemapEntriesByContentKey,
  refreshSitemapEntry,
  refreshSitemapEntriesForContentKey,
} from "../sitemap";
import { markFileAsModified } from "../sync-state";
import { deepMerge } from "../utils/deepMerge";
import { assertLocaleUrlAvailable } from "../locale-url-slug";
import { regenerateSectionIds } from "../utils/regenerateSectionIds";
import { databaseManager } from "../database";
import {
  redirectMiddleware,
  getRedirects,
  clearRedirectCache,
  testRedirect,
} from "../redirects";
import {
  getSchema,
  getMergedSchemas,
  getAvailableSchemaKeys,
  clearSchemaCache,
  getOrganizationTwitterHandle,
  getOrganizationSameAsUrl,
  getWebsiteDefaultSocialImage,
  updateWebsiteDefaultSocialImage,
  updateOrganizationTwitterHandle,
  updateOrganizationSameAsUrl,
} from "../schema-org";
import {
  getRegistryOverview,
  getComponentInfo,
  listVersions,
  loadSchema,
  loadExamples,
  createNewVersion,
  getExampleFilePath,
  saveExample,
  createExample,
  loadAllFieldEditors,
  applyComponentSectionDefaults,
  applyComponentImageSizes,
  getVariantByExample,
  getVariantExamples,
  deleteExample,
  deleteVariant,
} from "../component-registry";
import {
  editContent,
  editCommonContent,
  getContentForEdit,
  createContentEntry,
  deleteContentEntry,
  renameContentSlug,
} from "../content-editor";
import { validateYamlIdentity } from "../validate-content-identity";
import { bindingManager } from "../bindings";
import {
  escapeTemplateVars,
  escapeObjectVars,
  unescapeObjectVars,
  unescapeYamlDump,
} from "@shared/templateVars";
import {
  getVersioningManager,
  readUserId,
  getVersioningCookie,
  setVersioningCookie,
  buildUserContext,
} from "../versioning";
import { mediaGallery } from "../media-gallery";
import { media } from "../media";
import multer from "multer";
import { contentIndex, type ContentType } from "../content-index";
import { runScan as runComponentInsightsScan, readInsightsFile, suggestNext as suggestNextComponent } from "../component-insights";
import { validateFieldSource, validateFieldMapping, extractByDotPath } from "../../scripts/validation/shared/fieldMappingValidator";
import {
  getFolder,
  getType,
  isValidType,
  getAllTypes,
  getAllFolders,
  getAllConfigs,
  getDatabaseName,
  getFieldMapping,
  getLookupKey,
  getLocaleKey,
  getLocaleDefault,
  getIndexes,
  getContentTypeConfig,
  updateContentTypeConfig,
  addContentType,
  getDatabaseConfig,
  getLabel,
  normalizeUrlPattern,
  getLocaleSource,
  resolveContentTypeUrl,
  getLayout,
  resolveLayout,
  listAvailableMenus,
  getDirectory,
} from "../content-types";
import {
  isEntryDetached,
  isSharedLayoutType,
  resolveVersioningReadSlug,
  resolveWritableVersioningTarget,
  isTemplateVersioningSlug,
  resolvePreviewBaseSlug,
} from "../shared-layout-entry";
import {
  buildMirroredLocaleSingle,
  listSiblingSinglePaths,
} from "../shared-layout-sync";
import {
  hasAnyLiveLocale,
  hasLiveLocaleFile,
  listDraftLocales,
  countVariantFiles,
  findSourceDraftVariant,
  usesDraftFirstCreate,
} from "../draft-entry";
import { ensurePublishedAtOnce } from "../published-at";
import { resolveFieldValue, applyTransformIfNeeded } from "../transform";
import { resolveSingleVars } from "../single-resolver";
import { getValidationCacheService } from "../services/validationCacheService";
import { validatePublishedVariantLayer } from "../services/validatePublishedVariant";
import { buildEntryKey } from "../../scripts/validation/shared/entryKey";
import { scheduleOnSaveValidation } from "../services/onSaveValidation";
import {
  normalizeLocale,
  getSupportedLocales,
  getDefaultLocale,
  getLocaleEntries,
  updateLocaleSettings,
  getHomePage,
  getOptimizationSettings,
  updateOptimizationSettings,
} from "../settings";
import { variableManager } from "../variable-manager";
import { getValidationService } from "../../scripts/validation/service";
import { getCanonicalUrl, normalizeUrl } from "../../scripts/validation/shared/canonicalUrls";
import {
  isNonLocalFilesystemSrc,
  buildRegistrySrcToIdMap,
  resolveRegistryReference,
} from "../../scripts/validation/shared/imageRegistrySrc";
import type { ProgressEvent } from "../../scripts/validation/fixers/types";
import { gcs } from "../gcs";
import { z } from "zod";
import {
  generateSsrSchemaHtml,
  generateDatabaseSsrHtml,
  generateListingSsrHtml,
  clearSsrSchemaCache,
  loadRawYaml,
  resolveFaqItems,
  buildFaqPageSchema,
  resolvePageRobots,
  type FaqSection,
} from "../ssr-schema";
import {
  fetchMarkdownContent,
  clearMarkdownCache,
  clearMarkdownCacheByUrl,
} from "../markdown";
import { resolveDynamicEntries } from "../dynamic-entries";
import { loadDatabaseSinglePage, mergeSingleTemplate } from "../database-single-loader";
import { getBaseUrl } from "../hreflang";
import * as userManager from "../user-manager";
import * as userStore from "../user-store";
import type { CapabilityName } from "../user-store";


import {
  BREATHECODE_HOST,
  extractToken,
  requireCapability,
  safeYamlLoad,
  safeYamlDump,
  resolveVariantAssignment,
  invalidateContentCaches,
  createValidationFixRun,
  appendValidationRunLog,
  applyFixerProgress,
  resolveFixerPipeline,
  validationRuns,
  validationRunOrder,
  MAX_VALIDATION_RUNS,
  MAX_RUN_LOG_ENTRIES,
  careerProgramsListingSchema,
  loadCareerProgramsListing,
  applyMetaFallback,
  injectCanonicalIfMissing,
  loadCareerProgram,
  listCareerPrograms,
  loadLandingPage,
  listLandingPages,
  loadLocationPage,
  listLocationPages,
  loadTemplatePage,
  buildSingleEntryFromContent,
  listTemplatePages,
  detectLanguageFromRequest,
  ValidationFixRunState,
  ValidationFixRunLogEntry,
  FixerItemStatus,
} from "./_helpers";

/** Returns the per-site ContentIndex for this request, falling back to the global singleton in single-site mode. */
function getCI(res: Response): typeof contentIndex {
  return (res.locals.site as any)?.contentIndex ?? contentIndex;
}
function getContentRoot(res: Response): string {
  return (res.locals.site as any)?.contentRoot ?? getDefaultContentRoot();
}
function getContentRootName(res: Response): string {
  const cr = getContentRoot(res);
  return path.isAbsolute(cr) ? path.relative(process.cwd(), cr) : cr;
}
function getValidationCache(res: Response) {
  return (
    (res.locals.site as any)?.validationCache ?? getValidationCacheService()
  );
}


/** Resolve writable versioning slug (entry drafts or template `single`). */
function resolveWritableVersioningSlug(
  contentType: string,
  contentSlug: string,
  contentRoot: string,
): { ok: true; slug: string; templateMode: boolean } | { ok: false; error: string; status: number } {
  return resolveWritableVersioningTarget(contentType, contentSlug, contentRoot);
}

export function registerVersioningRoutes(app: Express): void {
  app.get("/api/debug/versioning", (req, res) => {
    const versioningManager = (res.locals.site as any)?.versioningManager ?? getVersioningManager();
    const stats = versioningManager.getStats();
    res.json({
      stats,
      totalVariants: Object.keys(stats).length,
    });
  });

  app.post("/api/debug/clear-versioning-cache", async (req, res) => {
    const auth = await requireCapability(req, res, "content_allocate_traffic");
    if (!auth.authorized) return;
    const versioningManager = (res.locals.site as any)?.versioningManager ?? getVersioningManager();
    versioningManager.clearCache();
    res.json({ success: true, message: "Versioning cache cleared" });
  });
  app.get("/api/variants/:contentType/:slug", (req, res) => {
    const { contentType, slug: requestSlug } = req.params;

    if (!isValidType(contentType)) {
      res
        .status(400)
        .json({ error: "Invalid content type", validTypes: getAllFolders() });
      return;
    }

    const slug = resolvePreviewBaseSlug(requestSlug, contentType, getCI(res));
    const versioningManager = (res.locals.site as any)?.versioningManager ?? getVersioningManager();
    const result = versioningManager.getAvailableVariants(contentType, slug);

    if (!result) {
      res.status(404).json({ error: "Content folder not found" });
      return;
    }

    res.json(result);
  });

  // Get versioning data for a specific content type and slug
  app.get("/api/versioning/:contentType/:contentSlug", (req, res) => {
    const { contentType, contentSlug: requestSlug } = req.params;

    if (!isValidType(contentType)) {
      res.status(400).json({
        error: "Invalid content type",
        validTypes: getAllFolders(),
      });
      return;
    }

    const contentSlug = resolvePreviewBaseSlug(requestSlug, contentType, getCI(res));
    const root = getContentRoot(res);
    const shared = isSharedLayoutType(contentType, root);
    const entrySlug = isTemplateVersioningSlug(contentSlug) ? null : contentSlug;
    const detached = entrySlug ? isEntryDetached(contentType, entrySlug, root) : false;
    // Entry-level translation drafts (translate_entry) win over template remapping
    const resolvedSlug = resolveVersioningReadSlug(contentType, contentSlug, root);
    const availableLocales = getLocaleEntries().map((l: { code: string }) => l.code);

    const versioningManager = (res.locals.site as any)?.versioningManager ?? getVersioningManager();
    const versioning = versioningManager.getVersioningForContent(contentType, resolvedSlug);
    const filePath = versioningManager.getVersioningFilePath(contentType, resolvedSlug);
    const contentDir = versioningManager.getVersioningContentDir(contentType, resolvedSlug);
    const templateMode = isTemplateVersioningSlug(resolvedSlug);
    const liveByLocale: Record<string, boolean> = {};
    for (const loc of availableLocales) {
      liveByLocale[loc] = hasLiveLocaleFile(contentDir, loc, templateMode);
    }
    const hasLiveDefault = hasAnyLiveLocale(contentDir, templateMode, availableLocales);

    if (!versioning) {
      res.json({
        versioning: null,
        hasVersioningFile: false,
        filePath,
        availableLocales,
        detached,
        isSharedLayout: shared,
        versioningSlug: resolvedSlug,
        hasLiveDefault,
        liveByLocale,
        isDraft: !hasLiveDefault && !shared,
      });
      return;
    }

    res.json({
      versioning,
      hasVersioningFile: true,
      filePath,
      availableLocales,
      detached,
      isSharedLayout: shared,
      versioningSlug: resolvedSlug,
      hasLiveDefault,
      liveByLocale,
      isDraft: !hasLiveDefault && !shared,
    });
  });

  // Update versioning allocations for a locale
  app.patch(
    "/api/versioning/:contentType/:contentSlug/:locale",
    async (req, res) => {
      const { contentType, contentSlug, locale } = req.params;

      if (!isValidType(contentType)) {
        res
          .status(400)
          .json({ error: "Invalid content type", validTypes: getAllFolders() });
        return;
      }

      const auth = await requireCapability(req, res, "content_allocate_traffic", contentType);
      if (!auth.authorized) return;

      const resolved = resolveWritableVersioningSlug(contentType, contentSlug, getContentRoot(res));
      if (!resolved.ok) {
        res.status(resolved.status).json({ error: resolved.error });
        return;
      }

      const parseResult = versioningUpdateSchema.safeParse(req.body);
      if (!parseResult.success) {
        res.status(400).json({
          error: "Invalid update data",
          details: parseResult.error.issues.map((i) => ({
            path: i.path.join("."),
            message: i.message,
          })),
        });
        return;
      }

      const versioningManager = (res.locals.site as any)?.versioningManager ?? getVersioningManager();
      try {
        const contentDir = versioningManager.getVersioningContentDir(contentType, resolved.slug);
        if (!hasAnyLiveLocale(contentDir, resolved.templateMode)) {
          res.status(400).json({
            error: "Cannot allocate traffic until a live locale exists. Publish a draft first.",
          });
          return;
        }

        // Allocating traffic requires the locale variant file to exist
        for (const v of parseResult.data.variants) {
          if (v.allocation > 0) {
            const vp = versioningManager.getVariantFilePath(contentType, resolved.slug, v.slug, locale);
            if (!fs.existsSync(vp)) {
              res.status(400).json({
                error: `Cannot allocate traffic: missing variant file ${path.basename(vp)}`,
              });
              return;
            }
          }
        }

        const existing = versioningManager.getVersioningForContent(contentType, resolved.slug) || {};
        const prevVariants = existing[locale]?.variants ?? [];
        const prevBySlug = new Map(prevVariants.map((v) => [v.slug, v.allocation]));
        const newVariants = parseResult.data.variants;
        const newSlugSet = new Set(newVariants.map((v) => v.slug));

        const newlyPublished = newVariants.filter((v) => {
          const prev = prevBySlug.get(v.slug) ?? 0;
          return prev === 0 && v.allocation > 0;
        });
        const unpublishedSlugs: string[] = [];
        for (const prev of prevVariants) {
          const next = newVariants.find((v) => v.slug === prev.slug);
          if (prev.allocation > 0 && (!next || next.allocation === 0)) {
            unpublishedSlugs.push(prev.slug);
          }
        }
        for (const prev of prevVariants) {
          if (prev.allocation > 0 && !newSlugSet.has(prev.slug) && !unpublishedSlugs.includes(prev.slug)) {
            unpublishedSlugs.push(prev.slug);
          }
        }

        if (newlyPublished.length > 0 && !parseResult.data.confirm_publish_variants) {
          res.status(400).json({
            error: "action_required",
            code: "confirm_publish_variants",
            message:
              "Assigning traffic publishes these variants and runs validation. Confirm to continue.",
            variants: newlyPublished.map((v) => v.slug),
          });
          return;
        }

        const root = getContentRoot(res);
        const ci = getCI(res);
        const cache = getValidationCache(res);
        const warningsByVariant: Record<string, unknown[]> = {};
        const issuesByVariant: Record<string, unknown[]> = {};
        const validationBySlug = new Map<
          string,
          Awaited<ReturnType<typeof validatePublishedVariantLayer>>
        >();

        if (newlyPublished.length > 0) {
          const commonData =
            (ci.loadCommonData(contentType, resolved.slug) as Record<string, unknown>) ||
            {};
          for (const v of newlyPublished) {
            const vp = versioningManager.getVariantFilePath(
              contentType,
              resolved.slug,
              v.slug,
              locale,
            );
            const variantRaw =
              (ci.safeYamlLoad(fs.readFileSync(vp, "utf-8")) as Record<string, unknown>) ||
              {};
            const result = await validatePublishedVariantLayer({
              contentType,
              slug: resolved.slug,
              locale,
              variantSlug: v.slug,
              contentRoot: root,
              ci,
              variantRaw,
              commonData,
            });
            validationBySlug.set(v.slug, result);
            if (!result.ok) {
              issuesByVariant[v.slug] = result.errors;
            }
            if (result.warnings.length) {
              warningsByVariant[v.slug] = result.warnings;
            }
          }

          if (Object.keys(issuesByVariant).length > 0) {
            res.status(400).json({
              error: "Published variant validation failed",
              code: "variant_validation_failed",
              issuesByVariant,
              warningsByVariant:
                Object.keys(warningsByVariant).length > 0
                  ? warningsByVariant
                  : undefined,
            });
            return;
          }
        }

        const updated = { ...existing, [locale]: { variants: newVariants } };
        versioningManager.updateVersioning(contentType, resolved.slug, updated);
        invalidateContentCaches(contentType, ci);

        for (const slug of unpublishedSlugs) {
          cache.clearEntryKey(buildEntryKey(contentType, resolved.slug, locale, slug));
        }

        for (const [slug, result] of validationBySlug) {
          if (!result.ok || !result.validators || !result.contentFile) continue;
          cache.applyValidatorResults(result.validators, {
            contentFiles: [result.contentFile],
            entryKeys: [result.entryKey],
            markSiteWide: false,
          });
        }

        if (newlyPublished.length > 0 || unpublishedSlugs.length > 0) {
          await cache.flush();
        }

        // Warm live + traffic-receiving variants on next anonymous render (invalidate is enough to force MISS).
        res.json({
          success: true,
          contentType,
          contentSlug: resolved.slug,
          locale,
          published: newlyPublished.map((v) => v.slug),
          unpublished: unpublishedSlugs,
          warningsByVariant:
            Object.keys(warningsByVariant).length > 0 ? warningsByVariant : undefined,
        });
      } catch (error) {
        res.status(400).json({
          error:
            error instanceof Error
              ? error.message
              : "Failed to update versioning",
        });
      }
    },
  );

  // Create a new content variant (copies locale file + registers in versioning.yml at 0% allocation)
  app.post("/api/versioning/:contentType/:contentSlug", async (req, res) => {
    const { contentType, contentSlug } = req.params;

    if (!isValidType(contentType)) {
      res.status(400).json({ error: "Invalid content type", validTypes: getAllFolders() });
      return;
    }

    const auth = await requireCapability(req, res, "content_create_variant", contentType);
    if (!auth.authorized) return;

    const resolved = resolveWritableVersioningSlug(contentType, contentSlug, getContentRoot(res));
    if (!resolved.ok) {
      res.status(resolved.status).json({ error: resolved.error });
      return;
    }

    const { variantSlug, locale, sourceVariant } = req.body as {
      variantSlug?: string;
      locale?: string;
      sourceVariant?: string;
    };

    if (!variantSlug || !locale) {
      res.status(400).json({ error: "variantSlug and locale are required" });
      return;
    }

    if (!/^[a-z0-9-]+$/.test(variantSlug)) {
      res.status(400).json({ error: "variantSlug must be lowercase letters, numbers, and hyphens only" });
      return;
    }

    const versioningManager = (res.locals.site as any)?.versioningManager ?? getVersioningManager();
    const contentDir = versioningManager.getVersioningContentDir(contentType, resolved.slug);
    const root = getContentRoot(res);
    const folder = getFolder(contentType as ContentType);

    if (!fs.existsSync(contentDir)) {
      res.status(404).json({ error: "Content folder not found" });
      return;
    }

    const variantFilePath = versioningManager.getVariantFilePath(contentType, resolved.slug, variantSlug, locale);
    if (fs.existsSync(variantFilePath)) {
      res.status(409).json({
        error: resolved.templateMode
          ? `Variant single.${variantSlug}.${locale}.yml already exists`
          : `Variant ${variantSlug}.${locale}.yml already exists`,
      });
      return;
    }

    const liveSourcePath = resolved.templateMode
      ? path.join(contentDir, `single.${locale}.yml`)
      : path.join(contentDir, `${locale}.yml`);

    let sourceFilePath = liveSourcePath;
    if (!fs.existsSync(sourceFilePath)) {
      // Draft mode: copy from an existing draft/variant for this locale
      const srcSlug = findSourceDraftVariant(
        contentDir,
        locale,
        sourceVariant,
        resolved.templateMode,
      );
      if (!srcSlug) {
        res.status(404).json({
          error: resolved.templateMode
            ? `Source file single.${locale}.yml not found and no draft variants exist for ${locale}`
            : `Source file ${locale}.yml not found and no draft variants exist for ${locale}`,
        });
        return;
      }
      sourceFilePath = versioningManager.getVariantFilePath(
        contentType,
        resolved.slug,
        srcSlug,
        locale,
      );
    }

    try {
      const sourceContent = fs.readFileSync(sourceFilePath, "utf-8");
      fs.writeFileSync(variantFilePath, sourceContent, "utf-8");
      const relPrimary = resolved.templateMode
        ? `${folder}/single.${variantSlug}.${locale}.yml`
        : `${folder}/${resolved.slug}/${variantSlug}.${locale}.yml`;
      markFileAsModified(relPrimary, auth.author || "api", undefined, root);

      // Template mode: fan out sibling-locale variant files with _label pending translation
      const createdSiblings: string[] = [];
      if (resolved.templateMode && fs.existsSync(liveSourcePath)) {
        const sourceData = (getCI(res).safeYamlLoad(sourceContent) as Record<string, unknown>) || {};
        const requesterId = auth.author || undefined;
        for (const sibling of listSiblingSinglePaths(contentDir, locale)) {
          const siblingVariantPath = path.join(contentDir, `single.${variantSlug}.${sibling.locale}.yml`);
          if (fs.existsSync(siblingVariantPath)) continue;
          const mirrored = buildMirroredLocaleSingle(sourceData, requesterId);
          // Preserve layout from sibling live single when present
          try {
            const siblingLive = getCI(res).safeYamlLoad(fs.readFileSync(sibling.filePath, "utf-8")) as Record<string, unknown> | null;
            if (siblingLive?.layout) mirrored.layout = siblingLive.layout;
          } catch { /* ignore */ }
          const { escapeObjectVars, unescapeYamlDump } = await import("@shared/templateVars");
          const { escaped, map } = escapeObjectVars(mirrored);
          const dumped = yaml.dump(escaped, { lineWidth: -1, noRefs: true, quotingType: '"', forceQuotes: false });
          fs.writeFileSync(siblingVariantPath, unescapeYamlDump(dumped, map), "utf-8");
          markFileAsModified(`${folder}/single.${variantSlug}.${sibling.locale}.yml`, auth.author || "api", undefined, root);
          createdSiblings.push(sibling.locale);
        }
      }

      const existing = versioningManager.getVersioningForContent(contentType, resolved.slug) || {};
      const localeData = existing[locale]
        ? { variants: [...(existing[locale].variants || [])] }
        : { variants: [] };

      if (!localeData.variants.some((v) => v.slug === variantSlug)) {
        localeData.variants.push({ slug: variantSlug, allocation: 0 });
      }

      versioningManager.updateVersioning(contentType, resolved.slug, { ...existing, [locale]: localeData });

      res.json({
        success: true,
        variantSlug,
        locale,
        templateMode: resolved.templateMode,
        siblingLocales: createdSiblings,
        filePath: `${getContentRootName(res)}/${relPrimary}`,
        seededFromDraft: !fs.existsSync(liveSourcePath),
      });
    } catch (error) {
      res.status(500).json({ error: String(error) });
    }
  });

  // Publish all draft locales (all-or-nothing): promote variantSlug for every unpublished locale that has it
  app.post("/api/versioning/:contentType/:contentSlug/publish", async (req, res) => {
    const { contentType, contentSlug } = req.params;

    if (!isValidType(contentType)) {
      res.status(400).json({ error: "Invalid content type", validTypes: getAllFolders() });
      return;
    }

    const auth = await requireCapability(req, res, "content_promote_variant", contentType);
    if (!auth.authorized) return;

    const resolved = resolveWritableVersioningSlug(contentType, contentSlug, getContentRoot(res));
    if (!resolved.ok) {
      res.status(resolved.status).json({ error: resolved.error });
      return;
    }

    const { variantSlug } = req.body as { variantSlug?: string };
    if (!variantSlug || !/^[a-z0-9-]+$/.test(variantSlug)) {
      res.status(400).json({ error: "variantSlug is required (lowercase letters, numbers, hyphens)" });
      return;
    }

    const versioningManager = (res.locals.site as any)?.versioningManager ?? getVersioningManager();
    const contentDir = path.resolve(versioningManager.getVersioningContentDir(contentType, resolved.slug));
    const root = getContentRoot(res);
    const folder = getFolder(contentType as ContentType);

    if (!fs.existsSync(contentDir)) {
      res.status(404).json({ error: "Content folder not found" });
      return;
    }

    if (hasAnyLiveLocale(contentDir, resolved.templateMode)) {
      res.status(400).json({
        error:
          "Entry already has a live locale. Use per-locale promote to replace the live default.",
      });
      return;
    }

    const draftLocales = listDraftLocales(contentDir, resolved.templateMode);
    if (draftLocales.length === 0) {
      res.status(400).json({ error: "No draft locales found to publish" });
      return;
    }

    const missing: string[] = [];
    for (const loc of draftLocales) {
      const vp = versioningManager.getVariantFilePath(contentType, resolved.slug, variantSlug, loc);
      if (!fs.existsSync(vp)) missing.push(loc);
    }
    if (missing.length > 0) {
      res.status(400).json({
        error:
          `Draft variant "${variantSlug}" is missing for locale(s): ${missing.join(", ")}. ` +
          `Pick a variant present on all remaining draft locales, or delete incomplete locales first.`,
        missingLocales: missing,
      });
      return;
    }

    const publishedLocales: string[] = [];
    try {
      for (const locale of draftLocales) {
        const variantFilePath = path.resolve(
          versioningManager.getVariantFilePath(contentType, resolved.slug, variantSlug, locale),
        );
        const defaultFilePath = path.resolve(
          contentDir,
          resolved.templateMode ? `single.${locale}.yml` : `${locale}.yml`,
        );
        const variantContent = fs.readFileSync(variantFilePath, "utf-8");
        const identityErr = validateYamlIdentity(variantContent, {
          contentType,
          contentSlug: resolved.slug,
        });
        if (identityErr) {
          res.status(400).json({
            error:
              `Cannot publish: ${identityErr} (locale ${locale}). ` +
              `Set conversion_name / CTA tracking / funnel.products on _common.yml (Funnel tab) before publishing.`,
            locale,
          });
          return;
        }
        const parsedVariant =
          (getCI(res).safeYamlLoad(variantContent) as Record<string, unknown>) || {};
        const commonForGate =
          getCI(res).loadCommonData(contentType, resolved.slug) || {};
        const { assertLiveEntrySeoAndRequiredFields } = await import(
          "../live-entry-seo-gate"
        );
        const seoGateErr = assertLiveEntrySeoAndRequiredFields({
          contentType,
          slug: resolved.slug,
          locale,
          pageData: deepMerge(commonForGate, parsedVariant) as Record<
            string,
            unknown
          >,
          contentRoot: root,
          mode: "publish",
          intent: "publish",
          isDraftWrite: false,
        });
        if (seoGateErr) {
          res.status(400).json({ error: `Cannot publish: ${seoGateErr}`, locale });
          return;
        }
        if (!resolved.templateMode) {
          const mergedForUrl = deepMerge(commonForGate, parsedVariant) as Record<string, unknown>;
          const urlCheck = assertLocaleUrlAvailable({
            contentType,
            entryIdentity: resolved.slug,
            locale,
            mergedPageData: mergedForUrl,
            ci: getCI(res),
          });
          if (!urlCheck.ok) {
            res.status(urlCheck.statusCode).json({
              error: `Cannot publish: ${urlCheck.error}`,
              locale,
              code: urlCheck.code,
              url: urlCheck.url,
            });
            return;
          }
        }
        fs.writeFileSync(defaultFilePath, variantContent, "utf-8");

        const existing = versioningManager.getVersioningForContent(contentType, resolved.slug) || {};
        const localeData = existing[locale];
        if (localeData) {
          const updatedVariants = (localeData.variants || []).filter((v) => v.slug !== variantSlug);
          versioningManager.updateVersioning(contentType, resolved.slug, {
            ...existing,
            [locale]: { variants: updatedVariants },
          });
        }

        fs.unlinkSync(variantFilePath);

        if (resolved.templateMode) {
          markFileAsModified(`${folder}/single.${locale}.yml`, auth.author || "api", undefined, root);
          markFileAsModified(`${folder}/single.${variantSlug}.${locale}.yml`, auth.author || "api", undefined, root);
        } else {
          markFileAsModified(`${folder}/${resolved.slug}/${locale}.yml`, auth.author || "api", undefined, root);
          markFileAsModified(`${folder}/${resolved.slug}/${variantSlug}.${locale}.yml`, auth.author || "api", undefined, root);
        }
        publishedLocales.push(locale);
      }

      if (!resolved.templateMode) {
        ensurePublishedAtOnce(contentType, resolved.slug, {
          author: auth.author || "api",
          contentRoot: root,
        });
      }

      getCI(res).refresh();
      getCI(res).invalidateCommonFields(contentType);
      clearSsrSchemaCache();
      invalidateContentCaches(contentType, getCI(res));
      if (!resolved.templateMode) {
        refreshSitemapEntriesForContentKey(contentType, resolved.slug, publishedLocales);
      }

      res.json({
        success: true,
        published: true,
        variantSlug,
        locales: publishedLocales,
      });
    } catch (error) {
      res.status(500).json({ error: String(error) });
    }
  });

  // Promote a variant: overwrite the default locale file, remove from versioning.yml, delete variant file
  app.post("/api/versioning/:contentType/:contentSlug/:locale/promote/:variantSlug", async (req, res) => {
    const { contentType, contentSlug, locale, variantSlug } = req.params;

    if (!isValidType(contentType)) {
      res.status(400).json({ error: "Invalid content type", validTypes: getAllFolders() });
      return;
    }

    const auth = await requireCapability(req, res, "content_promote_variant", contentType);
    if (!auth.authorized) return;

    const resolved = resolveWritableVersioningSlug(contentType, contentSlug, getContentRoot(res));
    if (!resolved.ok) {
      res.status(resolved.status).json({ error: resolved.error });
      return;
    }

    if (!/^[a-z0-9-]+$/.test(variantSlug)) {
      res.status(400).json({ error: "variantSlug must be lowercase letters, numbers, and hyphens only" });
      return;
    }

    if (!/^[a-z]{2}(-[A-Z]{2})?$/.test(locale)) {
      res.status(400).json({ error: "locale must be a valid language code (e.g. en, es, pt-BR)" });
      return;
    }

    const versioningManager = (res.locals.site as any)?.versioningManager ?? getVersioningManager();
    const contentDir = path.resolve(versioningManager.getVersioningContentDir(contentType, resolved.slug));
    const root = getContentRoot(res);
    const folder = getFolder(contentType as ContentType);

    if (!fs.existsSync(contentDir)) {
      res.status(404).json({ error: "Content folder not found" });
      return;
    }

    const variantFilePath = path.resolve(versioningManager.getVariantFilePath(contentType, resolved.slug, variantSlug, locale));
    const defaultFilePath = path.resolve(
      contentDir,
      resolved.templateMode ? `single.${locale}.yml` : `${locale}.yml`,
    );

    if (!variantFilePath.startsWith(contentDir + path.sep) || !defaultFilePath.startsWith(contentDir + path.sep)) {
      res.status(400).json({ error: "Invalid file path" });
      return;
    }

    if (!fs.existsSync(variantFilePath)) {
      res.status(404).json({
        error: resolved.templateMode
          ? `Variant file single.${variantSlug}.${locale}.yml not found`
          : `Variant file ${variantSlug}.${locale}.yml not found`,
      });
      return;
    }

    const wasUnpublished =
      !resolved.templateMode && !hasAnyLiveLocale(contentDir, resolved.templateMode);

    try {
      const variantContent = fs.readFileSync(variantFilePath, "utf-8");
      const identityErr = validateYamlIdentity(variantContent, {
        contentType,
        contentSlug: resolved.slug,
      });
      if (identityErr) {
        res.status(400).json({
          error:
            `Cannot promote: ${identityErr}. ` +
            `Set conversion_name / CTA tracking / funnel.products on _common.yml (Funnel tab) before promoting.`,
        });
        return;
      }
      const parsedVariant =
        (getCI(res).safeYamlLoad(variantContent) as Record<string, unknown>) || {};
      const commonForGate =
        getCI(res).loadCommonData(contentType, resolved.slug) || {};
      const { assertLiveEntrySeoAndRequiredFields } = await import(
        "../live-entry-seo-gate"
      );
      const seoGateErr = assertLiveEntrySeoAndRequiredFields({
        contentType,
        slug: resolved.slug,
        locale,
        pageData: deepMerge(commonForGate, parsedVariant) as Record<
          string,
          unknown
        >,
        contentRoot: root,
        mode: "publish",
        intent: "publish",
        isDraftWrite: false,
      });
      if (seoGateErr) {
        res.status(400).json({ error: `Cannot promote: ${seoGateErr}` });
        return;
      }
      if (!resolved.templateMode) {
        const mergedForUrl = deepMerge(commonForGate, parsedVariant) as Record<string, unknown>;
        const urlCheck = assertLocaleUrlAvailable({
          contentType,
          entryIdentity: resolved.slug,
          locale,
          mergedPageData: mergedForUrl,
          ci: getCI(res),
        });
        if (!urlCheck.ok) {
          res.status(urlCheck.statusCode).json({
            error: `Cannot promote: ${urlCheck.error}`,
            code: urlCheck.code,
            url: urlCheck.url,
          });
          return;
        }
      }
      fs.writeFileSync(defaultFilePath, variantContent, "utf-8");

      const existing = versioningManager.getVersioningForContent(contentType, resolved.slug) || {};
      const localeData = existing[locale];
      if (localeData) {
        const updatedVariants = (localeData.variants || []).filter((v) => v.slug !== variantSlug);
        versioningManager.updateVersioning(contentType, resolved.slug, {
          ...existing,
          [locale]: { variants: updatedVariants },
        });
      }

      fs.unlinkSync(variantFilePath);

      if (wasUnpublished) {
        ensurePublishedAtOnce(contentType, resolved.slug, {
          author: auth.author || "api",
          contentRoot: root,
        });
      }

      getCI(res).invalidateCommonFields(contentType);
      clearSsrSchemaCache();
      invalidateContentCaches(contentType, getCI(res));

      const cache = getValidationCache(res);
      cache.clearEntryKey(buildEntryKey(contentType, resolved.slug, locale, variantSlug));

      if (resolved.templateMode) {
        markFileAsModified(`${folder}/single.${locale}.yml`, auth.author || "api", undefined, root);
        markFileAsModified(`${folder}/single.${variantSlug}.${locale}.yml`, auth.author || "api", undefined, root);
      } else {
        markFileAsModified(`${folder}/${resolved.slug}/${locale}.yml`, auth.author || "api", undefined, root);
        markFileAsModified(`${folder}/${resolved.slug}/${variantSlug}.${locale}.yml`, auth.author || "api", undefined, root);
        // If this was the first live locale, refresh index + sitemap
        getCI(res).refresh();
        refreshSitemapEntriesForContentKey(contentType, resolved.slug, [locale]);
      }

      scheduleOnSaveValidation({
        contentRoot: root,
        contentRootName: getContentRootName(res),
        ci: getCI(res),
        cache,
        contentType,
        slug: resolved.slug,
        locale,
        filePath: defaultFilePath,
      });
      await cache.flush();

      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ error: String(error) });
    }
  });

  // Convert live locale to draft (inverse of per-locale promote). Blocked on shared templates.
  app.post(
    "/api/versioning/:contentType/:contentSlug/:locale/convert-to-draft",
    async (req, res) => {
      const { contentType, contentSlug, locale } = req.params;

      if (!isValidType(contentType)) {
        res.status(400).json({ error: "Invalid content type", validTypes: getAllFolders() });
        return;
      }

      const auth = await requireCapability(req, res, "content_promote_variant", contentType);
      if (!auth.authorized) return;

      if (!/^[a-z]{2}(-[A-Z]{2})?$/.test(locale)) {
        res.status(400).json({ error: "locale must be a valid language code (e.g. en, es, pt-BR)" });
        return;
      }

      const resolved = resolveWritableVersioningSlug(contentType, contentSlug, getContentRoot(res));
      if (!resolved.ok) {
        res.status(resolved.status).json({ error: resolved.error });
        return;
      }

      if (resolved.templateMode) {
        res.status(400).json({
          error:
            "Convert to draft is blocked on the shared template. Detach this entry first, then convert this entry only.",
        });
        return;
      }

      const root = getContentRoot(res);
      const { convertLiveLocaleToDraft } = await import("../convert-live-locale-to-draft");
      const result = convertLiveLocaleToDraft({
        contentType,
        slug: resolved.slug,
        locale,
        contentRoot: root,
        author: auth.author || "api",
      });

      if (!result.ok) {
        res.status(result.status).json({ error: result.error });
        return;
      }

      getCI(res).invalidateCommonFields(contentType);
      clearSsrSchemaCache();
      invalidateContentCaches(contentType, getCI(res));
      getCI(res).refresh();
      refreshSitemapEntriesForContentKey(contentType, resolved.slug, [locale]);

      res.json({
        success: true,
        variantSlug: result.variantSlug,
        locale,
        lastLiveLocale: result.lastLiveLocale,
        liveRelPath: result.liveRelPath,
        draftRelPath: result.draftRelPath,
        versioningRelPath: result.versioningRelPath,
      });
    },
  );

  // Delete a variant: remove its YML file and strip its entry from versioning.yml
  app.delete("/api/versioning/:contentType/:contentSlug/:locale/:variantSlug", async (req, res) => {
    const { contentType, contentSlug, locale, variantSlug } = req.params;

    if (!isValidType(contentType)) {
      res.status(400).json({ error: "Invalid content type", validTypes: getAllFolders() });
      return;
    }

    const auth = await requireCapability(req, res, "content_delete_variant", contentType);
    if (!auth.authorized) return;

    const resolved = resolveWritableVersioningSlug(contentType, contentSlug, getContentRoot(res));
    if (!resolved.ok) {
      res.status(resolved.status).json({ error: resolved.error });
      return;
    }

    if (!/^[a-z0-9-]+$/.test(variantSlug)) {
      res.status(400).json({ error: "variantSlug must be lowercase letters, numbers, and hyphens only" });
      return;
    }

    if (!/^[a-z]{2}(-[A-Z]{2})?$/.test(locale)) {
      res.status(400).json({ error: "locale must be a valid language code (e.g. en, es, pt-BR)" });
      return;
    }

    const versioningManager = (res.locals.site as any)?.versioningManager ?? getVersioningManager();
    const contentDir = path.resolve(versioningManager.getVersioningContentDir(contentType, resolved.slug));
    const root = getContentRoot(res);
    const folder = getFolder(contentType as ContentType);

    if (!fs.existsSync(contentDir)) {
      res.status(404).json({ error: "Content folder not found" });
      return;
    }

    const variantFilePath = path.resolve(versioningManager.getVariantFilePath(contentType, resolved.slug, variantSlug, locale));

    if (!variantFilePath.startsWith(contentDir + path.sep)) {
      res.status(400).json({ error: "Invalid file path" });
      return;
    }

    if (!fs.existsSync(variantFilePath)) {
      res.status(404).json({
        error: resolved.templateMode
          ? `Variant file single.${variantSlug}.${locale}.yml not found`
          : `Variant file ${variantSlug}.${locale}.yml not found`,
      });
      return;
    }

    try {
      const wasDraftEntry =
        !resolved.templateMode &&
        usesDraftFirstCreate(contentType, root) &&
        !hasAnyLiveLocale(contentDir, false);

      fs.unlinkSync(variantFilePath);
      if (resolved.templateMode) {
        markFileAsModified(`${folder}/single.${variantSlug}.${locale}.yml`, auth.author || "api", undefined, root);
      } else {
        markFileAsModified(`${folder}/${resolved.slug}/${variantSlug}.${locale}.yml`, auth.author || "api", undefined, root);
      }

      const existing = versioningManager.getVersioningForContent(contentType, resolved.slug) || {};
      const localeData = existing[locale];
      if (localeData) {
        const updatedVariants = (localeData.variants || []).filter((v) => v.slug !== variantSlug);
        versioningManager.updateVersioning(contentType, resolved.slug, {
          ...existing,
          [locale]: { variants: updatedVariants },
        });
      }

      // Deleting the last draft on an unpublished entry removes the whole entry
      if (wasDraftEntry && countVariantFiles(contentDir, false) === 0) {
        const del = await deleteContentEntry({
          type: contentType,
          slug: resolved.slug,
          author: auth.author || "api",
          contentRootName: getContentRootName(res),
        });
        if (!del.success) {
          res.status(del.statusCode).json({ error: del.error });
          return;
        }
        res.json({
          success: true,
          entryDeleted: true,
          message: "Last draft deleted; unpublished entry removed.",
        });
        return;
      }

      getCI(res).invalidateCommonFields(contentType);
      clearSsrSchemaCache();
      invalidateContentCaches(contentType, getCI(res));

      const cache = getValidationCache(res);
      cache.clearEntryKey(buildEntryKey(contentType, resolved.slug, locale, variantSlug));
      await cache.flush();

      const updated = versioningManager.getVersioningForContent(contentType, resolved.slug) || {};
      const availableLocales = resolved.templateMode
        ? getLocaleEntries().map((l: { code: string }) => l.code)
        : getCI(res).getAvailableLocalesOrVariants(contentType as ContentType, resolved.slug);
      res.json({
        hasVersioningFile: true,
        versioning: updated,
        availableLocales,
      });
    } catch (error) {
      res.status(500).json({ error: String(error) });
    }
  });

}
