import type { Express, Request, Response } from "express";
import express from "express";
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
import { regenerateSectionIds } from "../utils/regenerateSectionIds";
import { SECTION_LAYOUT_DEFAULT_KEYS } from "../section-layout-defaults";
import { databaseManager, DatabaseManager, getCachedDatabaseEntryCount } from "../database";
import { TESTIMONIALS_DATABASE } from "@shared/testimonials-listing";

function getDB(res: import("express").Response): DatabaseManager {
  return (res.locals.site as import("../site-manager").SiteContext)?.database ?? databaseManager;
}

function getEntryPreviewManager(res: import("express").Response) {
  const site = res.locals.site as import("../site-manager").SiteContext | undefined;
  if (!site?.entryPreviewManager) {
    throw new Error("EntryPreviewManager not available for this site");
  }
  return site.entryPreviewManager;
}

function getMediaGallery(res: import("express").Response) {
  return (res.locals.site as import("../site-manager").SiteContext | undefined)?.mediaGallery ?? mediaGallery;
}

async function loadEntriesForPreview(
  res: import("express").Response,
  type: string,
  localeFilter?: string,
  opts?: { hydrateMappedContent?: boolean },
): Promise<Array<Record<string, unknown>>> {
  const config = getContentTypeConfig(type, ctRoot(res));
  if (!config) return [];
  if (config.database?.slug) {
    const items = await getDB(res).fetchMappedItems(type);
    const localeKey = getLocaleKey(type, ctRoot(res)) || "lang";
    return items.filter(
      (item) => !localeFilter || String(item[localeKey] || "en") === localeFilter,
    ) as Array<Record<string, unknown>>;
  }
  const { items } = await queryEntries(
    {
      from: { contentType: type },
      locale: localeFilter ? normalizeLocale(localeFilter) : undefined,
    },
    {
      db: getDB(res),
      contentIndex: getCI(res),
      contentRoot: getContentRoot(res),
    },
  );
  // Static listing projections omit `content`. Hydrate it when preview maps that field
  // so OG reading-time (and capture) can use the real article body.
  // Stats polls skip this when dirty_on_prop_change is off (no props-hash needed).
  if (opts?.hydrateMappedContent === false) {
    return items as Array<Record<string, unknown>>;
  }
  const preview = getPreviewConfig(type, ctRoot(res));
  const needsContent =
    !!preview?.props &&
    Object.values(preview.props).some((src) => src.trim() === "content");
  if (!needsContent) return items as Array<Record<string, unknown>>;

  return hydrateStaticListingContent(items as Array<Record<string, unknown>>, type, {
    ci: getCI(res),
    contentRoot: ctRoot(res),
  });
}

function buildPreviewSection(
  preview: NonNullable<ReturnType<typeof getPreviewConfig>>,
  ctx: import("@shared/entry-preview-props").PreviewPropResolveContext,
): { section: Record<string, unknown>; missing: string[] } {
  const data: Record<string, unknown> = {};
  const { missing } = applyPreviewPropMappings(data, preview.props, ctx, RESERVED_IMAGE_FIELD);
  materializeOgPreviewReadingTime(data, preview.props, ctx.entry);

  // Only required component props block capture. Optional mappings (category, author,
  // content → reading_time, etc.) simply omit that part of the card when empty.
  const schema = loadSchema(preview.component, preview.version || "1.0");
  const mappable = collectMappablePropsFromSchema(schema, preview.variant || "default");
  const requiredKeys = new Set(mappable.filter((p) => p.required).map((p) => p.key));
  const missingVisible = missing.filter((k) => requiredKeys.has(k));

  return {
    section: {
      type: preview.component,
      version: preview.version || "1.0",
      variant: preview.variant || "default",
      ...data,
      section_id: `entry-preview-${preview.component}`,
    },
    missing: missingVisible,
  };
}
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
  getContentTypeSchemaOrgRequirements,
  getSchemaOrgRequirementCoverage,
  ensureContentTypeSchemaOrg,
} from "../schema-org-requirements";
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
import fs from "fs";
import path from "path";
import { contentIndex, type ContentType } from "../content-index";
import { observeParamValuesByLocale, localeYamlCandidatesForObserve } from "../url-param-peers";
import {
  usesDraftFirstCreate,
  getEntryContentDir,
  listDraftLocales,
  listVariantSlugsForLocale,
  DEFAULT_DRAFT_VARIANT,
} from "../draft-entry";
import { runScan as runComponentInsightsScan, readInsightsFile, suggestNext as suggestNextComponent } from "../component-insights";
import { validateFieldSource, validateFieldMapping, extractByDotPath } from "../../scripts/validation/shared/fieldMappingValidator";
import {
  convertContentTypeToStatic,
  ConvertToStaticError,
} from "../convert-content-type-to-static";
import {
  alignSiblingSinglesToBase,
  summarizeSingleTemplateLocales,
} from "../shared-layout-sync";
import {
  assessTemplateEntrySource,
  enableSharedLayoutFromEntry,
  isEnablingSharedLayout,
  summarizeTemplateLocales,
} from "../shared-layout-enable";
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
  hasDatabaseSingle,
  getContentTypeConfig,
  getPreviewConfig,
  updateContentTypeConfig,
  addContentType,
  deleteContentType,
  getDatabaseConfig,
  getLabel,
  normalizeUrlPattern,
  getLocaleSource,
  resolveContentTypeUrl,
  getLayout,
  resolveLayout,
  listAvailableMenus,
  getDirectory,
  readRawContentTypesYml,
  writeRawContentTypesYml,
  listExtraUrlPatternParams,
  resolveFieldValue as resolveUrlFieldValue,
  detectUrlParamValueShape,
  getRawUrlParamValue,
  type UrlParamValueShape,
  resolveStaticEntryUpdatedAt,
  isKnownSeoFieldPath,
} from "../content-types";
import { resolveFieldValue, applyTransformIfNeeded } from "../transform";
import { resolveAllTemplateVars, buildContentDeliveryParamBag } from "../resolve-template-vars";
import {
  buildFieldProvenance,
  writeMappedFields,
  clearFieldOverride,
  resetStaticMappedField,
} from "../field-overrides";
import {
  jsonFieldFailureHttpBody,
  validateAndCoerceJsonFields,
  validateEditorHintsHaveJsonSchemas,
} from "../json-field-validate";
import {
  relationFieldFailureHttpBody,
  validateAndCoerceRelationFields,
  validateEditorHintsHaveRelationSources,
} from "../relation-field-validate";
import {
  normalizeLocale,
  getSupportedLocales,
  getDefaultLocale,
  getLocaleEntries,
  updateLocaleSettings,
  getHomePage,
  getOptimizationSettings,
  updateOptimizationSettings,
  getTrackingSettings,
} from "../settings";
import { getVM } from "../site-manager";
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
import {
  hydrateStaticListingContent,
  queryEntries,
  type QueryFilter,
} from "../query-entries";
import { invalidateStaticListingCache } from "../static-listing-cache";
import {
  collectQueryFieldFilters,
  matchesManageItemsSearch,
  matchesManageTagFilter,
  paginateList,
  parseListPagination,
  parseSortDir,
  sortByUpdatedAtField,
} from "./list-pagination";
import { loadDatabaseSinglePage, mergeSingleTemplate, attachVariableFieldsToSections, hasStaticSharedLayoutEntryLocale } from "../database-single-loader";
import {
  DEFAULT_PREVIEW_MAX_HEIGHT,
  DEFAULT_PREVIEW_WIDTH,
  applyEntryPreviewOgImage,
  hashPreviewProps,
  type EntryPreviewMeta,
} from "../entry-preview-manager";
import {
  isPreviewCaptureReady,
  validatePreviewPropMappings,
} from "../entry-preview-config";
import { applyPreviewPropMappings, collectMappablePropsFromSchema, isBlockedPreviewSource, materializeOgPreviewReadingTime, formatMissingPreviewPropsMessage } from "@shared/entry-preview-props";
import {
  estimateReadingMinutes,
  estimateReadingMinutesFromSections,
} from "@shared/reading-time";
import { RESERVED_IMAGE_FIELD, IMAGE_ALIAS_FIELD } from "../content-types";
import { buildPreviewPropResolveContext } from "../entry-preview-resolve";
import {
  hasEntryLevelVersioning,
  isEntryDetached,
  isSharedLayoutType,
  isTemplateVersioningSlug,
  resolvePreviewBaseSlug,
  resolveVersioningReadSlug,
} from "../shared-layout-entry";
import { detachEntry, reattachEntry, getReattachSectionLossPreview, ReattachRequiredFieldsError } from "../shared-layout-detach";
import { resolveCommonTemplatePath } from "../shared-layout-paths";
import {
  buildLocaleUnavailablePayload,
  isEmptyDetachedLocaleEntry,
  skipEmptyLocaleGateForForceVariant,
} from "../empty-locale";
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
  resolveAssignedVariantSlug,
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
import { api } from "../rate-limit/api.js";
import { resolveRelationsOnEntry } from "../resolve-relations";
import { child } from "../logger";
const log = child({ module: "routes/content" });

/** Returns the per-site ContentIndex for this request, falling back to the global singleton in single-site mode. */
function getCI(res: Response): typeof contentIndex {
  return (res.locals.site as any)?.contentIndex ?? contentIndex;
}
function getContentRoot(res: Response): string {
  return (res.locals.site as any)?.contentRoot ?? getDefaultContentRoot();
}

function contentParamBag(
  req: { query: Request["query"] },
  res: Response,
  contentType: string,
  slug: string,
  locale: string,
  record?: Record<string, unknown> | null,
): Record<string, unknown> {
  return buildContentDeliveryParamBag({
    contentType,
    slug,
    locale,
    record: record ?? undefined,
    query: req.query as Record<string, unknown>,
    contentRoot: getContentRoot(res),
  });
}

function getContentRootName(res: Response): string {
  const cr = getContentRoot(res);
  return path.isAbsolute(cr) ? path.relative(process.cwd(), cr) : cr;
}

function ctRoot(res: Response): string {
  return getContentRoot(res);
}

function dynamicEntriesOptions(res: Response) {
  return {
    db: getDB(res),
    contentRoot: getContentRoot(res),
    contentIndex: getCI(res),
  };
}

export function registerContentRoutes(app: Express): void {
  app.get("/api/career-programs", (req, res) => {
    const locale = normalizeLocale(req.query.locale as string);
    const _location = req.query.location as string | undefined;
    const programs = listCareerPrograms(locale, getCI(res));
    res.json(programs);
  });

  app.get("/api/career-programs/:slug", async (req, res) => {
    const { slug } = req.params;
    const locale = normalizeLocale(req.query.locale as string);
    const forceVariant = req.query.force_variant as string | undefined;
    const forceVersion = req.query.force_version
      ? parseInt(req.query.force_version as string, 10)
      : undefined;

    let program: CareerProgram | null = null;

    // If force_variant is provided, load that variant directly (for preview)
    if (forceVariant) {
      const versioningManager = (res.locals.site as any)?.versioningManager ?? getVersioningManager();
      const forcedContent = versioningManager.getVariantContent("program", slug, forceVariant, locale);
      if (forcedContent) {
        program = forcedContent as unknown as CareerProgram;
      }
    }

    // Normal versioning flow if not forcing a variant
    if (!program) {
      const assigned = resolveVariantAssignment(req, res, "program", slug, locale);
      if (assigned) {
        program = assigned as unknown as CareerProgram;
      }
    }

    // Fall back to default content
    if (!program) {
      program = loadCareerProgram(slug, locale, getCI(res));
    }

    if (!program) {
      res.status(404).json({ error: "Career program not found" });
      return;
    }

    const programData = program as unknown as Record<string, unknown>;
    const programRaw = getCI(res).loadMergedContent("program", slug, locale);
    const layout = resolveLayout("program", programRaw.data || {}, getContentRoot(res));
    const singleEntry = buildSingleEntryFromContent("program", programData, {
      slug,
      locale,
      contentRoot: getContentRoot(res),
    });
    // singleEntry must exist before dynamic_entries so {{ single.* }} filters resolve
    // (otherwise pipe fallbacks like miami-usa bake the wrong FAQ list into items).
    if (Array.isArray(programData.sections)) {
      attachVariableFieldsToSections(programData.sections as unknown[]);
      programData.sections = await resolveDynamicEntries(programData.sections, locale, {
        ...dynamicEntriesOptions(res),
        singleEntry: singleEntry || undefined,
      }) as any;
    }
    const param = contentParamBag(req, res, "program", slug, locale, programData);
    if (singleEntry) {
      Object.assign(
        programData,
        resolveAllTemplateVars(programData, {
          singleEntry,
          param,
          contentRoot: getContentRoot(res),
          context: { locale },
        }) as Record<string, unknown>,
      );
    } else {
      Object.assign(
        programData,
        resolveAllTemplateVars(programData, {
          param,
          contentRoot: getContentRoot(res),
          context: { locale },
        }) as Record<string, unknown>,
      );
    }
    injectCanonicalIfMissing(programData, "program", locale);
    const { layout: _stripLayout, ...rest } = programData;
    res.json({
      ...rest,
      ...(singleEntry ? { singleEntry } : {}),
      param,
      layout,
    });
  });

  // Landing pages API
  app.get("/api/landings", (_req, res) => {
    const landings = listLandingPages(getCI(res));
    res.json(landings);
  });

  app.get("/api/landings/:slug", async (req, res) => {
    const { slug } = req.params;
    const forceVariant = req.query.force_variant as string | undefined;
    const forceVersion = req.query.force_version
      ? parseInt(req.query.force_version as string, 10)
      : undefined;

    // Resolve the folder slug first — the URL slug may be locale-specific
    // (e.g. "4geeks-vs-otros-landing" → folder "4geeks-vs-others-landing")
    const baseSlug = getCI(res).resolveBaseSlug(slug, "landing");

    // Get locale from query param, _common.yml, or default — then verify it exists
    const queryLocale = req.query.locale as string | undefined;
    const supported = getSupportedLocales();
    const validQueryLocale = queryLocale && supported.includes(queryLocale) ? queryLocale : undefined;
    const commonData = getCI(res).loadCommonData("landing", baseSlug);
    let locale = validQueryLocale || (commonData?.locale as string) || getDefaultLocale();
    const availableLocales = getCI(res).getAvailableLocalesOrVariants("landing" as ContentType, baseSlug);
    if (availableLocales.length > 0 && !availableLocales.includes(locale)) {
      locale = availableLocales[0];
    }
    // If the URL slug is locale-specific (e.g. the ES slug of a bilingual page),
    // detect which locale it belongs to and override the default locale detection
    if (!validQueryLocale) {
      const detectedLocale = getCI(res).resolveLocaleFromUrlSlug(slug, "landing");
      if (detectedLocale && availableLocales.includes(detectedLocale)) {
        locale = detectedLocale;
      }
    }

    let landing: LandingPage | null = null;

    // If force_variant is provided, load that variant directly (for preview)
    if (forceVariant) {
      const versioningManager = (res.locals.site as any)?.versioningManager ?? getVersioningManager();
      const forcedContent = versioningManager.getVariantContent("landing", baseSlug, forceVariant, locale);
      if (forcedContent) {
        landing = forcedContent as LandingPage;
      }
    }

    // Normal versioning flow if not forcing a variant
    if (!landing) {
      const assigned = resolveVariantAssignment(req, res, "landing", baseSlug, locale);
      if (assigned) {
        landing = assigned as LandingPage;
      }
    }

    // Fall back to default content
    if (!landing) {
      landing = loadLandingPage(slug, locale, getCI(res));
    }

    if (!landing) {
      res.status(404).json({ error: "Landing page not found" });
      return;
    }

    const landingLocations =
      (commonData?.locations as string[] | undefined) || undefined;
    const landingData = landing as unknown as Record<string, unknown>;

    const rawMerged = getCI(res).loadMergedContent("landing", slug, locale);
    const layout = resolveLayout("landing", rawMerged.data || commonData || {}, getContentRoot(res));
    const singleEntry = buildSingleEntryFromContent("landing", landingData, {
      slug: baseSlug,
      locale,
      contentRoot: getContentRoot(res),
    });
    // singleEntry before dynamic_entries — listing filters use {{ single.* }}.
    if (landing.sections && Array.isArray(landing.sections)) {
      attachVariableFieldsToSections(landing.sections as unknown[]);
      (landing as any).sections = await resolveDynamicEntries(landing.sections as any, locale, {
        ...dynamicEntriesOptions(res),
        singleEntry: singleEntry || undefined,
      });
      applyComponentImageSizes((landing as any).sections as unknown[]);
    }

    const param = contentParamBag(req, res, "landing", slug, locale, landingData);
    if (singleEntry) {
      Object.assign(
        landingData,
        resolveAllTemplateVars(landingData, {
          singleEntry,
          param,
          contentRoot: getContentRoot(res),
          context: { locale },
        }) as Record<string, unknown>,
      );
    } else {
      Object.assign(
        landingData,
        resolveAllTemplateVars(landingData, {
          param,
          contentRoot: getContentRoot(res),
          context: { locale },
        }) as Record<string, unknown>,
      );
    }
    injectCanonicalIfMissing(landingData, "landing", locale);
    const { layout: _stripLayout, ...restLanding } = landingData;
    res.json({
      ...restLanding,
      ...(singleEntry ? { singleEntry } : {}),
      param,
      locale,
      landing_locations: landingLocations,
      layout,
    });
  });

  // Locations API
  app.get("/api/locations", (req, res) => {
    const locale = normalizeLocale(req.query.locale as string);
    const region = req.query.region as string | undefined;
    let locations = listLocationPages(locale, getCI(res));

    if (region) {
      locations = locations.filter((loc) => loc.region === region);
    }

    res.json(locations);
  });

  app.get("/api/locations/:slug", async (req, res) => {
    const { slug } = req.params;
    const locale = normalizeLocale(req.query.locale as string);
    const forceVariant = req.query.force_variant as string | undefined;

    let location = null;

    if (forceVariant) {
      const versioningManager = (res.locals.site as any)?.versioningManager ?? getVersioningManager();
      const forcedContent = versioningManager.getVariantContent("location", slug, forceVariant, locale);
      if (forcedContent) {
        location = forcedContent as ReturnType<typeof loadLocationPage>;
      }
    }

    if (!location) {
      const assigned = resolveVariantAssignment(req, res, "location", slug, locale);
      if (assigned) {
        location = assigned as ReturnType<typeof loadLocationPage>;
      }
    }

    if (!location) {
      location = loadLocationPage(slug, locale, getCI(res));
    }

    if (!location) {
      res.status(404).json({ error: "Location not found" });
      return;
    }

    const locationData = location as unknown as Record<string, unknown>;
    const locationRaw = getCI(res).loadMergedContent("location", slug, locale);
    const layout = resolveLayout("location", locationRaw.data || {}, getContentRoot(res));
    const singleEntry = buildSingleEntryFromContent("location", locationData, {
      slug,
      locale,
      contentRoot: getContentRoot(res),
    });
    // Build singleEntry first: FAQ permanent_filters use {{ single.slug | miami-usa }}.
    // Resolving dynamic_entries without singleEntry always hit the miami-usa fallback,
    // while resolveAllTemplateVars later rewrote the filter string to the real slug —
    // so the editor showed Atlanta/Dallas while the page kept Miami items.
    if (locationData.sections && Array.isArray(locationData.sections)) {
      applyComponentSectionDefaults(locationData.sections);
      // Capture {{ }} binds before resolve so the editor can restore placeholders.
      attachVariableFieldsToSections(locationData.sections);
      locationData.sections = await resolveDynamicEntries(locationData.sections as any, locale, {
        ...dynamicEntriesOptions(res),
        singleEntry: singleEntry || undefined,
      }) as any;
      applyComponentImageSizes(locationData.sections);
    }
    const param = contentParamBag(req, res, "location", slug, locale, locationData);
    if (singleEntry) {
      Object.assign(
        locationData,
        resolveAllTemplateVars(locationData, {
          singleEntry,
          param,
          contentRoot: getContentRoot(res),
          context: { locale },
        }) as Record<string, unknown>,
      );
    } else {
      Object.assign(
        locationData,
        resolveAllTemplateVars(locationData, {
          param,
          contentRoot: getContentRoot(res),
          context: { locale },
        }) as Record<string, unknown>,
      );
    }
    injectCanonicalIfMissing(locationData, "location", locale);
    const { layout: _stripLayout, ...restLocation } = locationData;
    res.json({
      ...restLocation,
      ...(singleEntry ? { singleEntry } : {}),
      param,
      layout,
    });
  });

  // Template Pages API
  app.get("/api/pages", (req, res) => {
    const locale = normalizeLocale(req.query.locale as string);
    const pages = listTemplatePages(locale, getCI(res));
    res.json(pages);
  });

  // Special handler for career-programs listing page (custom page type)
  app.get("/api/pages/career-programs", (req, res) => {
    const locale = normalizeLocale(req.query.locale as string);

    const page = loadCareerProgramsListing(locale, getCI(res));

    if (!page) {
      res.status(404).json({ error: "Career programs listing page not found" });
      return;
    }

    const cpPageData = page as unknown as Record<string, unknown>;
    const cpRaw = getCI(res).loadMergedContent("page", "career-programs", locale);
    const cpLayout = resolveLayout("page", cpRaw.data || {}, getContentRoot(res));
    injectCanonicalIfMissing(cpPageData, "page", locale);
    const { layout: _cpStripLayout, ...cpRest } = cpPageData;
    res.json({ ...cpRest, layout: cpLayout });
  });

  // Special handler for apply page (includes programs and locations from _common.yml)
  app.get("/api/pages/apply", (req, res) => {
    const locale = normalizeLocale(req.query.locale as string);
    const forceVariant = req.query.force_variant as string | undefined;

    let page = null;

    if (forceVariant) {
      const versioningManager = (res.locals.site as any)?.versioningManager ?? getVersioningManager();
      const forcedContent = versioningManager.getVariantContent("page", "apply", forceVariant, locale);
      if (forcedContent) {
        page = forcedContent as ReturnType<typeof loadTemplatePage>;
      }
    }

    if (!page) {
      const assigned = resolveVariantAssignment(req, res, "page", "apply", locale);
      if (assigned) {
        page = assigned as ReturnType<typeof loadTemplatePage>;
      }
    }

    if (!page) {
      page = loadTemplatePage("apply", locale, getCI(res));
    }

    if (!page) {
      res.status(404).json({ error: "Apply page not found" });
      return;
    }

    const commonData = getCI(res).loadCommonData("page", "apply");
    const applyRaw = getCI(res).loadMergedContent("page", "apply", locale);
    const layout = resolveLayout("page", applyRaw.data || {}, getContentRoot(res));
    const applyData = page as unknown as Record<string, unknown>;
    injectCanonicalIfMissing(applyData, "page", locale);
    const { layout: _stripLayout, ...restApply } = applyData;

    res.json({
      ...restApply,
      programs: commonData?.programs || [],
      locations: commonData?.locations || [],
      layout,
    });
  });

  // Apply form submission endpoint
  app.get("/api/pages/:slug", async (req, res) => {
    const { slug } = req.params;
    const locale = normalizeLocale(req.query.locale as string);
    const forceVariant = req.query.force_variant as string | undefined;

    let page = null;

    if (forceVariant) {
      const versioningManager = (res.locals.site as any)?.versioningManager ?? getVersioningManager();
      const forcedContent = versioningManager.getVariantContent("page", slug, forceVariant, locale);
      if (forcedContent) {
        page = forcedContent as ReturnType<typeof loadTemplatePage>;
      }
    }

    if (!page) {
      const assigned = resolveVariantAssignment(req, res, "page", slug, locale);
      if (assigned) {
        page = assigned as ReturnType<typeof loadTemplatePage>;
      }
    }

    if (!page) {
      page = loadTemplatePage(slug, locale, getCI(res));
    }

    if (!page) {
      res.status(404).json({ error: "Template page not found" });
      return;
    }

    const pageData = page as unknown as Record<string, unknown>;
    const pageRaw = getCI(res).loadMergedContent("page", slug, locale);
    const layout = resolveLayout("page", pageRaw.data || {}, getContentRoot(res));
    const singleEntry = buildSingleEntryFromContent("page", pageData, {
      slug,
      locale,
      contentRoot: getContentRoot(res),
    });
    if (page.sections && Array.isArray(page.sections)) {
      attachVariableFieldsToSections(page.sections as unknown[]);
      page.sections = (await resolveDynamicEntries(
        page.sections,
        locale,
        {
          ...dynamicEntriesOptions(res),
          singleEntry: singleEntry || undefined,
        },
      )) as any;
      applyComponentSectionDefaults(page.sections);
      applyComponentImageSizes(page.sections);
    }

    const param = contentParamBag(req, res, "page", slug, locale, pageData);
    if (singleEntry) {
      pageData.singleEntry = singleEntry;
    }
    const resolvedPage = resolveAllTemplateVars(pageData, {
      singleEntry: singleEntry || undefined,
      param,
      contentRoot: getContentRoot(res),
      context: { locale },
    }) as Record<string, unknown>;
    Object.assign(pageData, resolvedPage);
    injectCanonicalIfMissing(pageData, "page", locale);
    const { enhanceArticleSectionsInPage: enhancePage } = await import("../markdown-enhance");
    await enhancePage(pageData);
    const { layout: _stripLayout, ...restPage } = pageData;
    res.json({ ...restPage, param, layout });
  });

  app.get("/api/content-pages/:contentType/:slug", async (req, res) => {
    const { contentType, slug: requestSlug } = req.params;
    const locale = normalizeLocale(req.query.locale as string);
    const forceVariant = req.query.force_variant as string | undefined;

    if (!isValidType(contentType, ctRoot(res))) {
      res.status(404).json({ error: `Unknown content type: ${contentType}` });
      return;
    }

    const slug = resolvePreviewBaseSlug(requestSlug, contentType, getCI(res));
    const emptyRoot = getContentRoot(res);
    if (
      !skipEmptyLocaleGateForForceVariant(forceVariant) &&
      isEmptyDetachedLocaleEntry({
        contentType,
        slug,
        locale,
        contentRoot: emptyRoot,
        ci: getCI(res),
      })
    ) {
      const availableUrls = getCI(res).getAlternateUrls(slug, contentType);
      res.status(404).json(
        buildLocaleUnavailablePayload({
          contentType,
          slug,
          locale,
          availableUrls,
        }),
      );
      return;
    }

    const templateShell =
      isTemplateVersioningSlug(requestSlug) && isSharedLayoutType(contentType, getContentRoot(res));

    if (hasDatabaseSingle(contentType, getContentRoot(res)) && !templateShell) {
      const root = getContentRoot(res);
      const detached = isEntryDetached(contentType, slug, root);
      let templateVariant: string | undefined;
      if (!detached) {
        templateVariant =
          forceVariant ||
          resolveAssignedVariantSlug(req, res, contentType, slug, locale) ||
          undefined;
      } else if (forceVariant) {
        templateVariant = forceVariant;
      }
      const page = await loadDatabaseSinglePage(
        contentType,
        slug,
        locale,
        root,
        getDB(res),
        templateVariant,
      );
      if (page) {
        const dbPageData = page as unknown as Record<string, unknown>;
        const dbSingleEntry = (dbPageData.singleEntry as Record<string, unknown>) || {};
        const param = contentParamBag(req, res, contentType, slug, locale, dbSingleEntry);
        if (page.sections && Array.isArray(page.sections)) {
          page.sections = (await resolveDynamicEntries(page.sections, locale, {
            ...dynamicEntriesOptions(res),
            singleEntry: dbSingleEntry,
          })) as any;
          applyComponentImageSizes(page.sections as unknown[]);
        }
        // Fill missing image before resolving {{ single.image | fallback }} into sections.
        await applyEntryPreviewOgImage(getEntryPreviewManager(res), {
          contentType,
          entry: dbSingleEntry,
          previewConfig: getPreviewConfig(contentType, ctRoot(res)),
          pageData: dbPageData,
        });
        if (Object.keys(dbSingleEntry).length > 0) {
          const dbResolved = resolveAllTemplateVars(dbPageData, {
            singleEntry: dbSingleEntry,
            param,
            contentRoot: ctRoot(res),
            context: { locale },
          }) as Record<string, unknown>;
          Object.assign(dbPageData, dbResolved);
        } else {
          const dbResolved = resolveAllTemplateVars(dbPageData, {
            param,
            contentRoot: ctRoot(res),
            context: { locale },
          }) as Record<string, unknown>;
          Object.assign(dbPageData, dbResolved);
        }
        const { enhanceArticleSectionsInPage } = await import("../markdown-enhance");
        await enhanceArticleSectionsInPage(dbPageData);
        const dbRaw = getCI(res).loadMergedContent(contentType, slug, locale);
        const dbLayout = resolveLayout(contentType, dbRaw.data || {}, getContentRoot(res));
        injectCanonicalIfMissing(dbPageData, contentType, locale);
        const { layout: _dbStripLayout, ...dbRest } = dbPageData;
        res.json({
          ...dbRest,
          param,
          layout: dbLayout,
          detached,
        });
        return;
      }
      // Slug not found in DB — do not fall through to shared template shell
      res.status(404).json({ error: `Item not found: ${contentType}/${slug}` });
      return;
    }

    // Variant resolution for YAML-backed content types
    const root = getContentRoot(res);
    const sharedAttached =
      isSharedLayoutType(contentType, root) && !isEntryDetached(contentType, slug, root);

    // Attached shared-layout: apply template variant via mergeSingleTemplate
    // Require the entry locale file (same gate as loadMergedSinglePage) so a
    // missing slug cannot return the empty single.*.yml shell.
    // Entry-level drafts (translate_entry / convert-to-draft) skip this path
    // so force_variant can load `{variant}.{locale}.yml` from the entry folder.
    const entryLevelForceVariant =
      !!forceVariant && hasEntryLevelVersioning(contentType, slug, root);
    const hasLiveLocale =
      templateShell ||
      hasStaticSharedLayoutEntryLocale(
        contentType,
        slug,
        locale,
        root,
      );

    if (sharedAttached && !entryLevelForceVariant) {
      if (!hasLiveLocale && !forceVariant) {
        res.status(404).json({ error: `${contentType} entry not found` });
        return;
      }
      if (hasLiveLocale) {
        const templateVariant =
          forceVariant ||
          resolveAssignedVariantSlug(req, res, contentType, slug, locale) ||
          undefined;
        const merged = mergeSingleTemplate(
          contentType,
          locale,
          templateShell ? undefined : slug,
          undefined,
          root,
          templateVariant,
        );
        if (merged) {
          const variantLayout = resolveLayout(contentType, merged, root);
          let singleEntry = buildSingleEntryFromContent(contentType, merged, {
            slug,
            locale,
            contentRoot: root,
          });
          if (singleEntry) {
            singleEntry = await resolveRelationsOnEntry(contentType, singleEntry, {
              contentRoot: root,
              locale,
              contentIndex: getCI(res),
              db: getDB(res),
            });
          }
          if (merged.sections && Array.isArray(merged.sections)) {
            attachVariableFieldsToSections(merged.sections as unknown[]);
            merged.sections = (await resolveDynamicEntries(
              merged.sections as unknown[],
              locale,
              {
                ...dynamicEntriesOptions(res),
                singleEntry: singleEntry || undefined,
              },
            )) as any;
            applyComponentImageSizes(merged.sections as unknown[]);
          }
          const param = contentParamBag(req, res, contentType, slug, locale, merged);
          if (singleEntry) {
            merged.singleEntry = singleEntry;
            await applyEntryPreviewOgImage(getEntryPreviewManager(res), {
              contentType,
              entry: singleEntry,
              previewConfig: getPreviewConfig(contentType, root),
              pageData: merged,
            });
            const resolved = resolveAllTemplateVars(merged, {
              singleEntry,
              param,
              contentRoot: root,
              context: { locale },
            }) as Record<string, unknown>;
            Object.assign(merged, resolved);
          } else {
            const resolved = resolveAllTemplateVars(merged, {
              param,
              contentRoot: root,
              context: { locale },
            }) as Record<string, unknown>;
            Object.assign(merged, resolved);
          }
          const { enhanceArticleSectionsInPage: enhanceAttached } = await import("../markdown-enhance");
          await enhanceAttached(merged);
          injectCanonicalIfMissing(merged, contentType, locale);
          const { layout: _strip, ...rest } = merged;
          res.json({
            ...rest,
            param,
            layout: variantLayout,
            detached: false,
          });
          return;
        }
      }
    }

    let variantPage: Record<string, unknown> | null = null;

    if (forceVariant) {
      const versioningManager = (res.locals.site as any)?.versioningManager ?? getVersioningManager();
      const versioningSlug = resolveVersioningReadSlug(contentType, slug, root);
      const forcedContent = versioningManager.getVariantContent(contentType, versioningSlug, forceVariant, locale);
      if (forcedContent) {
        variantPage = forcedContent as Record<string, unknown>;
      }
    }

    if (!variantPage) {
      const assigned = resolveVariantAssignment(req, res, contentType, slug, locale);
      if (assigned) {
        variantPage = assigned as Record<string, unknown>;
      }
    }

    if (variantPage) {
      const variantSingleEntry = buildSingleEntryFromContent(contentType, variantPage);
      if (variantSingleEntry) {
        variantPage.singleEntry = variantSingleEntry;
      }
      const param = contentParamBag(req, res, contentType, slug, locale, variantPage);
      const variantSections = variantPage.sections;
      if (variantSections && Array.isArray(variantSections)) {
        (variantPage as any).sections = (await resolveDynamicEntries(variantSections, locale, {
          ...dynamicEntriesOptions(res),
          singleEntry: variantSingleEntry || undefined,
        })) as any;
        applyComponentImageSizes((variantPage as any).sections as unknown[]);
      }
      const variantRaw = getCI(res).loadMergedContent(
        contentType,
        slug,
        locale,
        forceVariant,
      );
      const variantLayout = resolveLayout(contentType, variantRaw.data || {}, getContentRoot(res));
      if (variantSingleEntry) {
        const resolved = resolveAllTemplateVars(variantPage, {
          singleEntry: variantSingleEntry,
          param,
          contentRoot: getContentRoot(res),
          context: { locale },
        }) as Record<string, unknown>;
        Object.assign(variantPage, resolved);
      } else {
        const resolved = resolveAllTemplateVars(variantPage, {
          param,
          contentRoot: getContentRoot(res),
          context: { locale },
        }) as Record<string, unknown>;
        Object.assign(variantPage, resolved);
      }
      const { enhanceArticleSectionsInPage: enhanceVariant } = await import("../markdown-enhance");
      await enhanceVariant(variantPage);
      injectCanonicalIfMissing(variantPage, contentType, locale);
      const { layout: _variantStripLayout, ...variantRest } = variantPage;
      res.json({
        ...variantRest,
        param,
        layout: variantLayout,
        detached: isEntryDetached(contentType, slug, getContentRoot(res)),
      });
      return;
    }

    const result = getCI(res).loadContent({
      contentType,
      slug,
      localeOrVariant: locale,
    });

    if (!result.success) {
      res.status(404).json({ error: `${contentType} entry not found` });
      return;
    }

    const page = result.data;
    const genericPageData = page as unknown as Record<string, unknown>;
    let singleEntry = buildSingleEntryFromContent(contentType, genericPageData, {
      slug,
      locale,
      contentRoot: getContentRoot(res),
    });
    if (singleEntry) {
      singleEntry = await resolveRelationsOnEntry(contentType, singleEntry, {
        contentRoot: getContentRoot(res),
        locale,
        contentIndex: getCI(res),
        db: getDB(res),
      });
      genericPageData.singleEntry = singleEntry;
    }

    if (page.sections && Array.isArray(page.sections)) {
      page.sections = (await resolveDynamicEntries(page.sections, locale, {
        ...dynamicEntriesOptions(res),
        singleEntry: singleEntry || undefined,
      })) as any;
      applyComponentImageSizes(page.sections as unknown[]);
    }

    const genericRaw = getCI(res).loadMergedContent(contentType, slug, locale);
    const genericLayout = resolveLayout(contentType, genericRaw.data || {}, getContentRoot(res));
    const param = contentParamBag(req, res, contentType, slug, locale, genericPageData);
    if (singleEntry) {
      const resolved = resolveAllTemplateVars(genericPageData, {
        singleEntry,
        param,
        contentRoot: getContentRoot(res),
        context: { locale },
      }) as Record<string, unknown>;
      Object.assign(genericPageData, resolved);
    } else {
      const resolved = resolveAllTemplateVars(genericPageData, {
        param,
        contentRoot: getContentRoot(res),
        context: { locale },
      }) as Record<string, unknown>;
      Object.assign(genericPageData, resolved);
    }
    const { enhanceArticleSectionsInPage: enhanceGeneric } = await import("../markdown-enhance");
    await enhanceGeneric(genericPageData);
    injectCanonicalIfMissing(genericPageData, contentType, locale);
    const { layout: _genericStripLayout, ...genericRest } = genericPageData;
    res.json({
      ...genericRest,
      param,
      layout: genericLayout,
      detached: isEntryDetached(contentType, slug, getContentRoot(res)),
    });
  });
  app.get("/api/blog/posts", async (req, res) => {
    try {
      const locale = req.query.locale as string | undefined;
      const category = req.query.category as string | undefined;
      const page = req.query.page
        ? parseInt(req.query.page as string, 10)
        : undefined;
      const limit = Math.min(
        parseInt(req.query.limit as string, 10) || 12,
        100,
      );
      const filters: QueryFilter[] = [];
      if (category) {
        filters.push({ field: "category", value: category });
      }
      const { items: posts } = await queryEntries(
        {
          from: { contentType: "blog" },
          locale: locale ? normalizeLocale(locale) : undefined,
          filters: filters.length ? filters : undefined,
          sort: "-published_at",
        },
        {
          db: getDB(res),
          contentIndex: getCI(res),
          contentRoot: getContentRoot(res),
        },
      );

      const categories = Array.from(
        new Set(
          posts
            .map((p: any) => (typeof p.category === "string" ? p.category : "") || "")
            .filter(Boolean),
        ),
      ).sort();

      // Re-query without category filter for category facet list when filtered
      let categoryList = categories;
      if (category) {
        const { items: allLocalePosts } = await queryEntries(
          {
            from: { contentType: "blog" },
            locale: locale ? normalizeLocale(locale) : undefined,
          },
          {
            db: getDB(res),
            contentIndex: getCI(res),
            contentRoot: getContentRoot(res),
          },
        );
        categoryList = Array.from(
          new Set(
            allLocalePosts
              .map((p: any) => (typeof p.category === "string" ? p.category : "") || "")
              .filter(Boolean),
          ),
        ).sort();
      }

      const total = posts.length;
      const stripped = posts.map((p: any) => {
        const { content, readme, ...rest } = p;
        return rest;
      });

      if (page && page > 0) {
        const totalPages = Math.ceil(total / limit);
        const start = (page - 1) * limit;
        const paginated = stripped.slice(start, start + limit);
        res.json({
          count: paginated.length,
          total,
          page,
          totalPages,
          hasNext: page < totalPages,
          hasPrev: page > 1,
          categories: categoryList,
          results: paginated,
        });
      } else {
        res.json({
          count: total,
          total,
          categories: categoryList,
          results: stripped,
        });
      }
    } catch (error) {
      log.error({ err: error }, "[Blog] Error fetching posts:");
      res.status(500).json({ error: "Failed to fetch blog posts" });
    }
  });

  app.get("/api/blog/posts/:slug", async (req, res) => {
    try {
      const { slug } = req.params;
      const locale = req.query.locale as string | undefined;
      const normalizedLocale = locale ? normalizeLocale(locale) : undefined;
      const blogRoot = getContentRoot(res);

      if (
        normalizedLocale &&
        isEmptyDetachedLocaleEntry({
          contentType: "blog",
          slug,
          locale: normalizedLocale,
          contentRoot: blogRoot,
          ci: getCI(res),
        })
      ) {
        const availableUrls = getCI(res).getAlternateUrls(slug, "blog");
        res.status(404).json(
          buildLocaleUnavailablePayload({
            contentType: "blog",
            slug,
            locale: normalizedLocale,
            availableUrls,
          }),
        );
        return;
      }

      const { items: posts } = await queryEntries(
        {
          from: { contentType: "blog" },
          locale: normalizedLocale,
        },
        {
          db: getDB(res),
          contentIndex: getCI(res),
          contentRoot: blogRoot,
        },
      );
      const localeKey = getLocaleKey("blog", ctRoot(res)) || "lang";
      const post = normalizedLocale
        ? posts.find(
            (p) =>
              p.slug === slug && (p as any)[localeKey] === normalizedLocale,
          )
        : posts.find((p) => p.slug === slug);

      if (!post) {
        res.status(404).json({ error: "Blog post not found" });
        return;
      }

      let content = (post as any).content || "";
      if (!content && (post as any).readme_url) {
        content = await fetchMarkdownContent((post as any).readme_url);
      }
      // Static posts keep markdown in the locale YAML; load if omitted from listing projection
      if (!content) {
        const { data } = getCI(res).loadMergedContent(
          "blog",
          slug,
          normalizedLocale || "en",
        );
        if (typeof data?.content === "string") content = data.content;
      }

      const blogLayout = resolveLayout("blog", post as unknown as Record<string, unknown>, getContentRoot(res));
      res.json({ ...post, content, layout: blogLayout });
    } catch (error) {
      log.error({ err: error }, "[Blog] Error fetching post:");
      res.status(500).json({ error: "Failed to fetch blog post" });
    }
  });

  app.get("/api/blog/cache-status", (_req, res) => {
    const dbName = getDatabaseName("blog", ctRoot(res));
    if (!dbName) {
      // Static content type — report projection cache via a lightweight query
      res.json({ exists: true, age_hours: 0, post_count: null, source: "static" });
      return;
    }
    const info = getDB(res).getCacheInfo(dbName);
    res.json({
      exists: !!info,
      age_hours: info
        ? Math.round(
            ((Date.now() - new Date(info.fetched_at).getTime()) /
              (60 * 60 * 1000)) *
              10,
          ) / 10
        : null,
      post_count: info?.item_count ?? null,
    });
  });

  app.delete("/api/blog/cache/:slug", async (req, res) => {
    try {
      const { slug } = req.params;
      const { items: posts } = await queryEntries(
        { from: { contentType: "blog" } },
        {
          db: getDB(res),
          contentIndex: getCI(res),
          contentRoot: getContentRoot(res),
        },
      );
      const post = posts.find((p) => p.slug === slug);
      if ((post as any)?.readme_url) {
        clearMarkdownCacheByUrl((post as any).readme_url);
      }
      clearMarkdownCache(slug);
      invalidateStaticListingCache("blog", getContentRoot(res));
      res.json({ success: true, message: `Cache cleared for "${slug}"` });
    } catch (error) {
      log.error({ err: error }, "[Blog] Error clearing post cache:");
      res.status(500).json({ error: "Failed to clear post cache" });
    }
  });

  app.post("/api/debug/clear-blog-cache", async (_req, res) => {
    const dbName = getDatabaseName("blog", ctRoot(res));
    if (dbName && getDB(res).exists(dbName)) {
      await getDB(res).fetchItems(dbName, true).catch(() => {});
    }
    invalidateStaticListingCache("blog", getContentRoot(res));
    clearMarkdownCache();
    res.json({
      success: true,
      message: "Blog cache cleared (database will re-fetch on next request)",
    });
  });

  app.get("/api/blog/config", (_req, res) => {
    try {
      const config = getContentTypeConfig("blog", ctRoot(res));
      res.json(config || {});
    } catch (err) {
      res.status(500).json({ error: String(err) });
    }
  });

  app.put("/api/blog/config", (req, res) => {
    try {
      const body = req.body;
      if (!body || typeof body !== "object") {
        res.status(400).json({ error: "Request body must be a JSON object" });
        return;
      }
      const update: import("../content-types").ContentTypeConfigUpdate = {};
      if (body.url_pattern !== undefined) update.url_pattern = body.url_pattern;
      if (body.database !== undefined) update.database = body.database;
      updateContentTypeConfig("blog", update, getContentRoot(res));
      res.json({ success: true });
    } catch (err) {
      res.status(500).json({ error: String(err) });
    }
  });

  // ── Generic Content Type API Routes ──

  app.get("/api/content-types", (_req, res) => {
    try {
      const cr = getContentRoot(res);
      const configs = getAllConfigs(cr);
      const result: Record<string, unknown>[] = [];
      for (const [type, config] of Object.entries(configs)) {
        result.push({
          name: type,
          label: getLabel(type, cr),
          directory: config.directory,
          has_database: !!config.database?.slug,
          database_slug: config.database?.slug || null,
          single_template: !!config.single_template,
          has_field_mapping: !!(
            config.field_mapping &&
            Object.keys(config.field_mapping).filter(
              (k) => !k.startsWith("_"),
            ).length > 0
          ),
          unique_fields: config.unique_fields ?? ["slug"],
          field_mapping_keys: Object.keys(config.field_mapping ?? {}).filter(
            (k) => !k.startsWith("_"),
          ),
          url_pattern: config.url_pattern,
          locale_key: config.field_mapping?._locale || null,
          static_entry_count: getCI(res).findByType(type).length,
          database_entry_count: config.database?.slug
            ? getCachedDatabaseEntryCount(getDB(res), config.database.slug)
            : null,
          layout: getLayout(type, cr),
        });
      }
      res.json(result);
    } catch (err) {
      res.status(500).json({ error: String(err) });
    }
  });

  app.post("/api/content-types", (req, res) => {
    try {
      const { name, directory, url_pattern } = req.body;
      if (!name || typeof name !== "string") {
        res.status(400).json({ error: "Name is required" });
        return;
      }
      if (!/^[a-z][a-z0-9_-]*$/.test(name)) {
        res
          .status(400)
          .json({
            error:
              "Name must be lowercase alphanumeric (hyphens and underscores allowed)",
          });
        return;
      }
      if (!url_pattern) {
        res.status(400).json({ error: "URL pattern is required" });
        return;
      }

      const normalizedPattern = normalizeUrlPattern(url_pattern);

      const patternValues = Object.values(normalizedPattern) as string[];
      for (const p of patternValues) {
        if (!p.includes(":slug")) {
          res.status(400).json({ error: "URL pattern must include :slug" });
          return;
        }
        if (!p.startsWith("/")) {
          res.status(400).json({ error: "URL pattern must start with /" });
          return;
        }
      }
      const dir = directory || name;

      addContentType(name, {
        directory: dir,
        url_pattern: normalizedPattern,
      }, getContentRoot(res));

      getCI(res).refresh();
      clearSitemapCache();

      res.json({
        success: true,
        name,
        directory: dir,
        url_pattern: normalizedPattern,
      });
    } catch (err) {
      res.status(400).json({ error: String(err) });
    }
  });

  app.get("/api/content-types/yml", (_req, res) => {
    try {
      const file = readRawContentTypesYml(getContentRoot(res));
      if (!file) {
        res.status(404).json({ exists: false, error: "content-types.yml not found" });
        return;
      }
      const relativePath = `${getContentRootName(res)}/content-types.yml`;
      res.json({ exists: true, path: relativePath, content: file.content });
    } catch (err) {
      res.status(500).json({ error: String(err) });
    }
  });

  app.put("/api/content-types/yml", async (req, res) => {
    try {
      const auth = await requireCapability(req, res, "content_types_manage");
      if (!auth.authorized) return;

      const { content, author: requestAuthor } = req.body as {
        content?: string;
        author?: string;
      };
      if (typeof content !== "string") {
        res.status(400).json({ error: "content is required" });
        return;
      }

      const authorName =
        auth.author || (requestAuthor && typeof requestAuthor === "string" ? requestAuthor : undefined);

      writeRawContentTypesYml(content, getContentRoot(res), authorName);
      getCI(res).refresh();
      clearSitemapCache();
      invalidateContentCaches(undefined, getCI(res));

      res.json({ success: true, path: `${getContentRootName(res)}/content-types.yml` });
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  app.delete("/api/content-types/:type", (req, res) => {
    try {
      const { type } = req.params;
      const dryRun = req.query.dry_run === "true";

      const config = getContentTypeConfig(type, ctRoot(res));
      if (!config) {
        res.status(404).json({ error: `Content type "${type}" not found` });
        return;
      }

      const staticEntries = getCI(res).findByType(type);
      const staticCount = staticEntries.length;
      const hasDatabase = !!config.database?.slug;

      if (dryRun) {
        const affectedUrls: string[] = [];
        for (const entry of staticEntries) {
          const locales = entry.locales.length > 0 ? entry.locales : Object.keys(config.url_pattern).filter(k => k !== "default");
          for (const locale of locales) {
            const url = getCI(res).buildUrl(type, locale, entry.slug);
            if (url && !affectedUrls.includes(url)) {
              affectedUrls.push(url);
            }
          }
        }

        res.json({
          dry_run: true,
          type,
          directory: config.directory,
          static_entry_count: staticCount,
          has_database: hasDatabase,
          database_slug: config.database?.slug || null,
          affected_urls: affectedUrls,
          message: `Deleting "${type}" will remove its definition from content-types.yml. The ${staticCount} content file(s) in ${getContentRootName(res)}/${config.directory}/ will NOT be deleted but will no longer be served.`,
        });
        return;
      }

      deleteContentType(type, getContentRoot(res));
      getCI(res).refresh();
      clearSitemapCache();
      res.json({ success: true, deleted: type });
    } catch (err) {
      res.status(400).json({ error: String(err) });
    }
  });

  app.get("/api/content-types/:type/config", (req, res) => {
    try {
      const { type } = req.params;
      const config = getContentTypeConfig(type, ctRoot(res));
      if (!config) {
        res.status(404).json({ error: `Content type "${type}" not found` });
        return;
      }
      res.json({
        name: type,
        label: getLabel(type, ctRoot(res)),
        directory: config.directory,
        field_mapping: config.field_mapping || null,
        editor: config.editor || null,
        indexes: config.indexes || null,
        unique_fields: config.unique_fields || null,
        database: config.database || null,
        url_pattern: config.url_pattern,
        single_template: !!config.single_template,
        protected_slugs: config.protected_slugs || [],
        preview: config.preview || null,
        schema_org_requirements: config.schema_org_requirements || [],
        seo_monitoring: config.seo_monitoring || null,
        strategy: config.strategy || null,
        static_entry_count: getCI(res).findByType(type).length,
      });
    } catch (err) {
      res.status(500).json({ error: String(err) });
    }
  });

  /** Coverage of content-type schema_org_requirements (present / missing slugs). */
  app.get("/api/content-types/:type/schema-org-coverage", (req, res) => {
    try {
      const { type } = req.params;
      const config = getContentTypeConfig(type, ctRoot(res));
      if (!config) {
        res.status(404).json({ error: `Content type "${type}" not found` });
        return;
      }
      const requirements = getContentTypeSchemaOrgRequirements(type, getContentRoot(res));
      const schemaTypeParam =
        typeof req.query.schema_type === "string" ? req.query.schema_type : undefined;
      const typesToReport =
        schemaTypeParam
          ? [{ schema_type: schemaTypeParam }]
          : requirements.length > 0
            ? requirements
            : [];
      if (typesToReport.length === 0) {
        res.json({
          contentType: type,
          requirements: [],
          coverage: [],
          message: "No schema_org_requirements on this content type",
        });
        return;
      }
      const coverage = typesToReport.map((r) =>
        getSchemaOrgRequirementCoverage(type, r.schema_type, getContentRoot(res), getCI(res)),
      );
      res.json({
        contentType: type,
        requirements,
        coverage,
      });
    } catch (err) {
      res.status(500).json({ error: String(err) });
    }
  });

  /** Ensure missing entries get a leading seeded schema_org section (e.g. LocalBusiness). */
  app.post("/api/content-types/:type/schema-org-ensure", async (req, res) => {
    try {
      const { type } = req.params;
      const auth = await requireCapability(req, res, "seo_settings");
      if (!auth.authorized) return;

      const config = getContentTypeConfig(type, ctRoot(res));
      if (!config) {
        res.status(404).json({ error: `Content type "${type}" not found` });
        return;
      }

      const body = (req.body || {}) as {
        schema_type?: string;
        dry_run?: boolean;
        slugs?: string[];
      };

      const requirements = getContentTypeSchemaOrgRequirements(type, getContentRoot(res));
      const schemaType =
        (typeof body.schema_type === "string" && body.schema_type.trim()) ||
        requirements[0]?.schema_type;
      if (!schemaType) {
        res.status(400).json({
          error:
            "schema_type is required when the content type has no schema_org_requirements",
        });
        return;
      }

      const result = ensureContentTypeSchemaOrg({
        contentType: type,
        schemaType,
        contentRoot: getContentRoot(res),
        author: auth.author || "api",
        dryRun: !!body.dry_run,
        slugs: Array.isArray(body.slugs) ? body.slugs.filter((s) => typeof s === "string") : undefined,
        ci: getCI(res),
      });

      getCI(res).refresh();
      invalidateContentCaches(type, getCI(res));

      res.json({ success: true, ...result });
    } catch (err) {
      res.status(500).json({ error: String(err) });
    }
  });

  app.get("/api/content-types/:type/validate-field", (req, res) => {
    try {
      const { type } = req.params;
      const source = req.query.source as string;
      if (!source) {
        res.status(400).json({ error: "source query parameter is required" });
        return;
      }
      const config = getContentTypeConfig(type, ctRoot(res));
      if (!config) {
        res.status(404).json({ error: `Content type "${type}" not found` });
        return;
      }
      const result = validateFieldSource(type, source);
      res.json(result);
    } catch (err) {
      res.status(500).json({ error: String(err) });
    }
  });

  app.post("/api/content-types/:type/validate-mappings", (req, res) => {
    try {
      const { type } = req.params;
      const config = getContentTypeConfig(type, ctRoot(res));
      if (!config) {
        res.status(404).json({ error: `Content type "${type}" not found` });
        return;
      }
      const { field_mapping } = req.body || {};
      if (!field_mapping || typeof field_mapping !== "object") {
        res.status(400).json({ error: "field_mapping object is required in body" });
        return;
      }
      const result = validateFieldMapping(type, field_mapping);
      res.json(result);
    } catch (err) {
      res.status(500).json({ error: String(err) });
    }
  });

  app.post("/api/content-types/:type/backfill-property", (req, res) => {
    try {
      const { type } = req.params;
      const config = getContentTypeConfig(type, ctRoot(res));
      if (!config) {
        res.status(404).json({ error: `Content type "${type}" not found` });
        return;
      }
      if (config.database?.slug) {
        res.status(400).json({ error: "Backfill is only supported for YAML-backed content types" });
        return;
      }
      const { source, value } = req.body || {};
      if (typeof source !== "string" || !source.trim()) {
        res.status(400).json({ error: "source string is required in body" });
        return;
      }
      if (value === undefined || value === null || (typeof value === "string" && !value.trim())) {
        res.status(400).json({ error: "value is required in body" });
        return;
      }
      const effectiveSource = source.startsWith("?") ? source.slice(1) : source;
      const ci = getCI(res);
      const slugs = ci.listContentSlugs(type as ContentType);
      const failed: { slug: string; error: string }[] = [];
      let updated = 0;
      let alreadySet = 0;

      for (const slug of slugs) {
        const locales = ci.getAvailableLocalesOrVariants(type as ContentType, slug);
        const locale = locales.includes("en") ? "en" : locales[0];
        const { data } = locale
          ? ci.loadMergedContent(type, slug, locale)
          : { data: null };
        if (data && extractByDotPath(data, effectiveSource) !== undefined) {
          alreadySet++;
          continue;
        }
        const result = editCommonContent({
          contentType: type,
          slug,
          operations: [{ action: "update_field", path: effectiveSource, value }],
          author: "backfill-property",
          ci,
          contentRootName: getContentRootName(res),
        });
        if (result.success) {
          updated++;
        } else {
          failed.push({ slug, error: result.error || "Unknown error" });
        }
      }

      ci.refresh();
      ci.invalidateCommonFields(type);

      if (failed.length > 0) {
        res.status(500).json({
          error: `Failed to update ${failed.length} of ${slugs.length} entries`,
          updated,
          already_set: alreadySet,
          failed,
          total: slugs.length,
        });
        return;
      }
      res.json({ success: true, updated, already_set: alreadySet, total: slugs.length });
    } catch (err) {
      res.status(500).json({ error: String(err) });
    }
  });

  app.put("/api/content-types/:type/config", async (req, res) => {
    try {
      const { type } = req.params;
      const config = getContentTypeConfig(type, ctRoot(res));
      if (!config) {
        res.status(404).json({ error: `Content type "${type}" not found` });
        return;
      }
      const body = req.body;
      if (!body || typeof body !== "object") {
        res.status(400).json({ error: "Request body must be a JSON object" });
        return;
      }

      if (body.field_mapping && !config.database?.slug) {
        const flatMapping: Record<string, string> = {};
        for (const [k, v] of Object.entries(body.field_mapping as Record<string, unknown>)) {
          if (typeof v === "string") flatMapping[k] = v;
          else if (v && typeof v === "object" && "source" in (v as object)) {
            flatMapping[k] = String((v as { source: string }).source ?? "");
          }
        }
        const validation = validateFieldMapping(type, flatMapping);
        if (!validation.allValid) {
          const invalidFields = Object.entries(validation.results)
            .filter(([, r]) => !r.valid)
            .map(([k]) => k);
          res.status(400).json({
            error: `Some field mappings reference properties not found in all entries: ${invalidFields.join(", ")}`,
            validation: validation.results,
          });
          return;
        }
      }

      const update: import("../content-types").ContentTypeConfigUpdate = {};
      if (body.url_pattern !== undefined) update.url_pattern = body.url_pattern;
      if (body.field_mapping !== undefined) update.field_mapping = body.field_mapping;
      if (body.indexes !== undefined) update.indexes = body.indexes;
      if (body.unique_fields !== undefined) update.unique_fields = body.unique_fields;
      if (body.database !== undefined) update.database = body.database;
      if (body.editor !== undefined) {
        if (body.editor === null) {
          update.editor = null;
        } else if (typeof body.editor === "object") {
          const editorCheck = validateEditorHintsHaveJsonSchemas(
            body.editor as Record<string, import("../content-types").ContentTypeEditorHint>,
          );
          if (!editorCheck.ok) {
            res.status(400).json({ error: editorCheck.error, field: editorCheck.field });
            return;
          }
          const relationCheck = validateEditorHintsHaveRelationSources(
            body.editor as Record<string, import("../content-types").ContentTypeEditorHint>,
          );
          if (!relationCheck.ok) {
            res.status(400).json({ error: relationCheck.error, field: relationCheck.field });
            return;
          }
          const { assertRequiredFieldsHaveFillIntent } = await import(
            "../../shared/fillIntent.js"
          );
          const fillIntentCheck = assertRequiredFieldsHaveFillIntent(
            body.editor as Record<string, { required?: unknown; fill_intent?: unknown }>,
          );
          if (!fillIntentCheck.ok) {
            res.status(400).json({
              error: fillIntentCheck.error,
              code: "missing_fill_intent",
              fields: fillIntentCheck.fields,
            });
            return;
          }
          update.editor = body.editor as import("../content-types").ContentTypeEntry["editor"];
        } else {
          res.status(400).json({ error: "editor must be an object or null" });
          return;
        }
      }
      if (body.strategy !== undefined) {
        if (body.strategy === null) {
          update.strategy = null;
        } else if (typeof body.strategy === "object") {
          const { parseContentTypeStrategy } = await import(
            "../../shared/contentTypeStrategy.js"
          );
          const parsed = parseContentTypeStrategy(body.strategy);
          if (!parsed) {
            res.status(400).json({
              error: "strategy requires a non-empty purpose string (constraints optional).",
              code: "missing_strategy",
            });
            return;
          }
          update.strategy = parsed;
        } else {
          res.status(400).json({ error: "strategy must be an object or null" });
          return;
        }
      }
      if (body.single_template !== undefined) update.single_template = !!body.single_template;
      if (body.preview !== undefined) {
        if (body.preview === null) {
          update.preview = null;
        } else if (typeof body.preview === "object" && body.preview !== null) {
          const p = body.preview as Record<string, unknown>;
          if (typeof p.component !== "string" || !p.component.trim()) {
            res.status(400).json({ error: "preview.component is required" });
            return;
          }
          const props = p.props && typeof p.props === "object" ? (p.props as Record<string, string>) : undefined;
          const circularProps: string[] = [];
          if (props) {
            for (const [k, v] of Object.entries(props)) {
              if (
                isBlockedPreviewSource(k, RESERVED_IMAGE_FIELD) ||
                isBlockedPreviewSource(String(v), RESERVED_IMAGE_FIELD)
              ) {
                circularProps.push(`${k}→${v}`);
              }
            }
          }
          const draftPreview = {
            component: p.component.trim(),
            variant: typeof p.variant === "string" ? p.variant : undefined,
            version: typeof p.version === "string" ? p.version : undefined,
            theme: p.theme === "light" || p.theme === "dark" ? p.theme : undefined,
            widths: Array.isArray(p.widths) ? p.widths.map(Number).filter((n) => Number.isFinite(n) && n > 0) : undefined,
            maxHeight: typeof p.maxHeight === "number" ? p.maxHeight : undefined,
            dirty_on_prop_change: !!p.dirty_on_prop_change,
            props,
          };
          const mappingCheck = validatePreviewPropMappings(draftPreview);
          if (!mappingCheck.ok) {
            res.status(400).json({
              error: mappingCheck.error || "Preview property mappings are incomplete",
              missingRequired: mappingCheck.missingRequired,
              mappableCount: mappingCheck.mappableCount,
              mappedCount: mappingCheck.mappedCount,
            });
            return;
          }
          update.preview = draftPreview;
          if (circularProps.length > 0) {
            (res.locals as { previewCircularWarn?: string[] }).previewCircularWarn = circularProps;
          }
        } else {
          res.status(400).json({ error: "preview must be an object or null" });
          return;
        }
      }

      const priorConfig = getContentTypeConfig(type, ctRoot(res));
      const willHaveDb =
        body.database === null
          ? false
          : !!(
              (body.database && typeof body.database === "object" && (body.database as { slug?: string }).slug) ||
              (body.database === undefined && priorConfig?.database?.slug)
            );
      if (willHaveDb && body.single_template === false) {
        res.status(400).json({
          error:
            "Cannot disable shared layout while this content type is linked to a database. Unlink the database first.",
        });
        return;
      }
      if (willHaveDb) {
        update.single_template = true;
      }
      if (body.seo_monitoring !== undefined) {
        if (body.seo_monitoring === null) {
          update.seo_monitoring = null;
        } else if (typeof body.seo_monitoring === "object") {
          const sm = body.seo_monitoring as Record<string, unknown>;
          update.seo_monitoring = {
            enabled: sm.enabled === true,
            require_cluster: sm.require_cluster === true,
          };
        } else {
          res.status(400).json({ error: "seo_monitoring must be an object or null" });
          return;
        }
      }

      // Gate: required fields need a valid CT strategy (merged post-update view).
      {
        const {
          assertEditorRequiredHasStrategy,
          assertCanClearStrategy,
        } = await import("../../shared/contentTypeStrategy.js");
        const prior = getContentTypeConfig(type, ctRoot(res));
        const nextEditor =
          update.editor === null
            ? undefined
            : update.editor !== undefined
              ? update.editor
              : prior?.editor;
        const nextStrategy =
          update.strategy === null
            ? undefined
            : update.strategy !== undefined
              ? update.strategy
              : prior?.strategy;
        if (update.strategy === null) {
          const clearCheck = assertCanClearStrategy(nextEditor);
          if (!clearCheck.ok) {
            res.status(400).json({
              error: clearCheck.error,
              code: clearCheck.code,
            });
            return;
          }
        }
        const strategyCheck = assertEditorRequiredHasStrategy(nextStrategy, nextEditor);
        if (!strategyCheck.ok) {
          res.status(400).json({
            error: strategyCheck.error,
            code: strategyCheck.code,
          });
          return;
        }
      }

      const newlyLinkingDb =
        !priorConfig?.database?.slug &&
        !!(
          body.database &&
          typeof body.database === "object" &&
          (body.database as { slug?: string }).slug
        );

      const enablingShared = isEnablingSharedLayout({
        priorSingleTemplate: !!priorConfig?.single_template,
        bodySingleTemplate:
          body.single_template === undefined ? undefined : !!body.single_template,
        linkingDatabaseEnablesShared: newlyLinkingDb,
      });

      let enableBootstrap: ReturnType<typeof enableSharedLayoutFromEntry> | null = null;
      if (enablingShared) {
        const { escapeObjectVars, unescapeYamlDump } = await import("@shared/templateVars");
        const yaml = await import("js-yaml");
        const dumpYaml = (d: unknown) => {
          const { escaped, map } = escapeObjectVars(d);
          return unescapeYamlDump(
            yaml.dump(escaped, { lineWidth: -1, noRefs: true, quotingType: '"', forceQuotes: false }),
            map,
          );
        };
        enableBootstrap = enableSharedLayoutFromEntry({
          contentType: type,
          contentRoot: getContentRoot(res),
          templateMode: body.template_mode,
          templateEntrySourceSlug:
            typeof body.template_entry_source_slug === "string"
              ? body.template_entry_source_slug
              : undefined,
          templateEntrySourceLocale:
            typeof body.template_entry_source_locale === "string"
              ? body.template_entry_source_locale
              : undefined,
          sharedLayoutBaseLocale:
            typeof body.shared_layout_base_locale === "string"
              ? body.shared_layout_base_locale
              : undefined,
          confirm: body.confirm === true,
          safeYamlLoad: (r) => getCI(res).safeYamlLoad(r),
          dumpYaml,
          getAvailableLocales: (ct, slug) =>
            getCI(res).getAvailableLocalesOrVariants(ct as import("@shared/schema").ContentType, slug),
          onWritten: (filePath) => markFileAsModified(filePath),
        });
        if (!enableBootstrap.ok) {
          res.status(enableBootstrap.status).json({
            error: enableBootstrap.error,
            code: enableBootstrap.code,
            ...(enableBootstrap.locales ? { locales: enableBootstrap.locales } : {}),
            ...(enableBootstrap.preview ? { preview: enableBootstrap.preview } : {}),
            ...(enableBootstrap.invalidSections
              ? { invalidSections: enableBootstrap.invalidSections }
              : {}),
          });
          return;
        }
      }

      try {
        updateContentTypeConfig(type, update, getContentRoot(res));
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        if (msg.includes("Cannot disable shared layout") || msg.includes("requires _slug") || msg.includes("Invalid field_mapping key")) {
          res.status(400).json({ error: msg });
          return;
        }
        throw err;
      }
      getCI(res).invalidateCommonFields(type);

      if (body.seo_monitoring !== undefined) {
        try {
          const { invalidateSeoIndexCache, rebuildSeoIndex } = await import("../seo-index");
          invalidateSeoIndexCache();
          rebuildSeoIndex({
            contentRoot: getContentRoot(res),
            reason: "seo_monitoring_toggle",
            mark: false,
          });
        } catch (seoErr) {
          log.warn({ seoErr, type }, "seo-index rebuild after monitoring toggle failed");
        }
      }

      // When enabling shared layout, dissolve bindings for this type (bindings and templates don't mix)
      let bindingsDissolved: unknown = undefined;
      if (enablingShared) {
        const dissolved = bindingManager.dissolveGroupsForContentType(type);
        if (dissolved.count > 0) {
          bindingsDissolved = {
            count: dissolved.count,
            groups: dissolved.dissolved.map((g) => ({
              id: g.id,
              name: g.name,
              component: g.component,
              locale: g.locale,
              memberCount: g.members.length,
              members: g.members.map((m) => ({
                contentType: m.contentType,
                slug: m.slug,
                sectionId: m.sectionId,
              })),
            })),
          };
        }
      }

      // Legacy path: align when already shared and only base locale sent (no enable bootstrap)
      let alignResult: unknown = enableBootstrap?.ok ? enableBootstrap.align : undefined;
      if (
        !enablingShared &&
        body.single_template === true &&
        typeof body.shared_layout_base_locale === "string" &&
        body.shared_layout_base_locale
      ) {
        const { escapeObjectVars, unescapeYamlDump } = await import("@shared/templateVars");
        const yaml = await import("js-yaml");
        const folder = getFolder(type, getContentRoot(res));
        const templateDir = path.join(getContentRoot(res), folder);
        const dumpYaml = (d: unknown) => {
          const { escaped, map } = escapeObjectVars(d);
          return unescapeYamlDump(
            yaml.dump(escaped, { lineWidth: -1, noRefs: true, quotingType: '"', forceQuotes: false }),
            map,
          );
        };
        alignResult = alignSiblingSinglesToBase({
          templateDir,
          baseLocale: body.shared_layout_base_locale,
          safeYamlLoad: (r) => getCI(res).safeYamlLoad(r),
          dumpYaml,
          onWritten: (filePath) => markFileAsModified(filePath),
        });
      }

      res.json({
        success: true,
        ...(alignResult ? { align: alignResult } : {}),
        ...(bindingsDissolved ? { bindingsDissolved } : {}),
        ...(enableBootstrap?.ok
          ? {
              shared_layout_enable: {
                template_mode: enableBootstrap.templateMode,
                written_paths: enableBootstrap.writtenPaths,
                source_slug: enableBootstrap.sourceSlug,
                source_locale: enableBootstrap.sourceLocale,
              },
            }
          : {}),
        ...((res.locals as { previewCircularWarn?: string[] }).previewCircularWarn
          ? {
              warning: `preview.props references reserved image field (circular): ${(res.locals as { previewCircularWarn: string[] }).previewCircularWarn.join(", ")}`,
            }
          : {}),
      });
    } catch (err) {
      res.status(500).json({ error: String(err) });
    }
  });

  app.get("/api/content-types/:type/shared-layout-status", (req, res) => {
    try {
      const { type } = req.params;
      const config = getContentTypeConfig(type, ctRoot(res));
      if (!config) {
        res.status(404).json({ error: `Content type "${type}" not found` });
        return;
      }
      const folder = getFolder(type, getContentRoot(res));
      const templateDir = path.join(getContentRoot(res), folder);
      const templateLocales = summarizeTemplateLocales(templateDir, (r) =>
        getCI(res).safeYamlLoad(r),
      );
      const locales = summarizeSingleTemplateLocales(templateDir, (r) =>
        getCI(res).safeYamlLoad(r),
      );
      const usable_template = templateLocales.some((l) => l.sectionCount > 0);
      const bindingGroups = bindingManager.findGroupsForContentType(type).map((g) => ({
        id: g.id,
        name: g.name,
        component: g.component,
        locale: g.locale,
        memberCount: g.members.length,
        members: g.members.map((m) => ({
          contentType: m.contentType,
          slug: m.slug,
          sectionId: m.sectionId,
        })),
      }));

      const entrySlug =
        typeof req.query.entry === "string" ? req.query.entry.trim() : "";
      const entryLocaleQuery =
        typeof req.query.locale === "string" ? req.query.locale.trim() : "";
      let entry_locales: string[] | undefined;
      let entry_assessment:
        | {
            ok: true;
            source_locale: string;
            section_count: number;
            section_ids: string[];
          }
        | {
            ok: false;
            code: string;
            error: string;
            invalid_sections?: Array<{
              sectionId: string | null;
              index: number;
              reason: string;
            }>;
          }
        | undefined;

      if (entrySlug) {
        entry_locales = getCI(res).getAvailableLocalesOrVariants(
          type as import("@shared/schema").ContentType,
          entrySlug,
        );

        const needsLocale =
          (entry_locales?.length ?? 0) > 1 && !entryLocaleQuery;
        if (!needsLocale) {
          const assessed = assessTemplateEntrySource({
            contentType: type,
            contentRoot: getContentRoot(res),
            templateEntrySourceSlug: entrySlug,
            templateEntrySourceLocale: entryLocaleQuery || undefined,
            safeYamlLoad: (r) => getCI(res).safeYamlLoad(r),
            getAvailableLocales: (ct, slug) =>
              getCI(res).getAvailableLocalesOrVariants(
                ct as import("@shared/schema").ContentType,
                slug,
              ),
          });
          if (assessed.ok) {
            entry_assessment = {
              ok: true,
              source_locale: assessed.sourceLocale,
              section_count: assessed.sectionCount,
              section_ids: assessed.sectionIds,
            };
          } else {
            entry_assessment = {
              ok: false,
              code: assessed.code,
              error: assessed.error,
              ...(assessed.invalidSections
                ? { invalid_sections: assessed.invalidSections }
                : {}),
            };
          }
        }
      }

      res.json({
        single_template: !!config.single_template,
        database: !!config.database?.slug,
        usable_template,
        template_locales: templateLocales,
        locales,
        bindings: bindingGroups,
        ...(entry_locales
          ? {
              entry_locales,
              entry_slug: entrySlug,
              ...(entry_assessment ? { entry_assessment } : {}),
            }
          : {}),
      });
    } catch (err) {
      res.status(500).json({ error: String(err) });
    }
  });

  app.post("/api/content-types/:type/convert-to-static", async (req, res) => {
    try {
      const auth = await requireCapability(req, res, "content_types_manage");
      if (!auth.authorized) return;

      const { type } = req.params;
      const dryRun = req.body?.dry_run === true || req.query.dry_run === "true";
      const authorName =
        (typeof req.body?.author === "string" && req.body.author) ||
        auth.username ||
        "convert-to-static";

      const result = await convertContentTypeToStatic({
        contentType: type,
        contentRoot: getContentRoot(res),
        dryRun,
        author: authorName,
        db: getDB(res),
        refreshIndex: () => getCI(res).refresh(),
        invalidateCommonFields: (ct) => getCI(res).invalidateCommonFields(ct),
      });

      res.json(result);
    } catch (err) {
      if (err instanceof ConvertToStaticError) {
        res.status(err.statusCode).json({ error: err.message });
        return;
      }
      log.error({ err }, "[convert-to-static] Error:");
      res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  app.get("/api/content-types/:type/available-properties", (req, res) => {
    try {
      const { type } = req.params;
      const config = getContentTypeConfig(type, ctRoot(res));
      if (!config) {
        res.status(404).json({ error: `Content type "${type}" not found` });
        return;
      }
      const result = getCI(res).getCommonFields(type);
      const excludeMapped = req.query.exclude_mapped === "true";
      if (excludeMapped && config.field_mapping) {
        const mappedSources = new Set(
          Object.values(config.field_mapping).map((v) => {
            const src = typeof v === "string" ? (v.startsWith("function:") ? null : v) : (v as { source: string }).source;
            return src && src.startsWith("?") ? src.slice(1) : src;
          }).filter(Boolean)
        );
        return res.json({
          common: result.common.filter((k) => !mappedSources.has(k)),
          partial: result.partial.filter((p) => !mappedSources.has(p.key)),
        });
      }
      res.json(result);
    } catch (err) {
      res.status(500).json({ error: String(err) });
    }
  });

  app.get("/api/content-types/:type/url-param-options", (req, res) => {
    try {
      const { type } = req.params;
      const config = getContentTypeConfig(type, ctRoot(res));
      if (!config) {
        res.status(404).json({ error: `Content type "${type}" not found` });
        return;
      }

      const params = listExtraUrlPatternParams(config.url_pattern);
      const options: Record<string, string[]> = {};
      const optionsByLocale: Record<string, Record<string, string[]>> = {};
      const shapes: Record<string, UrlParamValueShape> = {};
      for (const param of params) {
        options[param] = [];
        optionsByLocale[param] = {};
        shapes[param] = "string";
      }

      if (params.length === 0) {
        res.json({ params, options, optionsByLocale, shapes });
        return;
      }

      const mapping = getFieldMapping(type, ctRoot(res));
      const shapeVotes: Record<string, { object_slug: number; string: number }> = {};
      for (const param of params) {
        shapeVotes[param] = { object_slug: 0, string: 0 };
      }

      const contentPath = ctRoot(res);
      const typeDir = path.join(contentPath, getDirectory(type, contentPath));
      const supportedLocales = getSupportedLocales();

      for (const param of params) {
        optionsByLocale[param] = observeParamValuesByLocale(contentPath, type, config, param, supportedLocales);
        options[param] = [...new Set(Object.values(optionsByLocale[param]).flat())].sort((a, b) =>
          a.localeCompare(b),
        );
      }

      if (fs.existsSync(typeDir)) {
        const ci = getCI(res);
        for (const entry of fs.readdirSync(typeDir, { withFileTypes: true })) {
          if (!entry.isDirectory() || entry.name.startsWith("_")) continue;
          const slugDir = path.join(typeDir, entry.name);
          for (const locale of supportedLocales) {
            for (const candidate of localeYamlCandidatesForObserve(locale)) {
              const filePath = path.join(slugDir, candidate);
              if (!fs.existsSync(filePath)) continue;
              try {
                const raw = fs.readFileSync(filePath, "utf-8");
                const record = ci.safeYamlLoad(raw) as Record<string, unknown> | null;
                if (!record) continue;
                for (const param of params) {
                  const rawValue = getRawUrlParamValue(record, param, mapping);
                  if (rawValue === undefined || rawValue === null) continue;
                  shapeVotes[param][detectUrlParamValueShape(rawValue)] += 1;
                }
              } catch {
                /* skip */
              }
            }
          }
        }
      }

      for (const param of params) {
        // `:category` is always a plain string URL slug — never `{ slug }`.
        if (param === "category") {
          shapes[param] = "string";
          continue;
        }
        const votes = shapeVotes[param];
        shapes[param] =
          votes.object_slug > votes.string ? "object_slug" : "string";
      }

      res.json({ params, options, optionsByLocale, shapes });
    } catch (err) {
      res.status(500).json({ error: String(err) });
    }
  });

  app.get("/api/content-types/:type/single-field-values", (req, res) => {
    try {
      const { type } = req.params;
      const field = req.query.field as string;
      const locale = (req.query.locale as string) || "en";
      if (!field) {
        res.status(400).json({ error: "field query parameter is required" });
        return;
      }
      const config = getContentTypeConfig(type, ctRoot(res));
      if (!config) {
        res.status(404).json({ error: `Content type "${type}" not found` });
        return;
      }
      const mapping = getFieldMapping(type, ctRoot(res));
      const source = mapping?.[field];
      if (!source || typeof source !== "string") {
        res.status(404).json({ error: `Field "${field}" not found in field_mapping` });
        return;
      }

      const slugs = getCI(res).listContentSlugs(type as ContentType);
      const entries: Array<{ slug: string; value: unknown; url: string | null }> = [];
      for (const slug of slugs) {
        const locales = getCI(res).getAvailableLocalesOrVariants(type as ContentType, slug);
        const entryLocale = locales.includes(locale) ? locale : locales[0];
        if (!entryLocale) continue;
        const { data } = getCI(res).loadMergedContent(type, slug, entryLocale);
        if (!data) continue;
        const value = extractByDotPath(data, source);
        let url: string | null = null;
        try {
          url = resolveContentTypeUrl(type, data as Record<string, unknown>, entryLocale);
        } catch {}
        entries.push({ slug, value: value ?? null, url });
      }
      res.json({ field, source, entries });
    } catch (err) {
      res.status(500).json({ error: String(err) });
    }
  });

  app.get("/api/content-types/:type/single-template-sections", (req, res) => {
    try {
      const { type } = req.params;
      const locale = ((req.query.locale as string) || "en").replace(/[^a-z-]/g, "");
      const root = getContentRoot(res);
      if (!isValidType(type, ctRoot(res))) {
        res.status(404).json({ error: `Unknown content type: ${type}` });
        return;
      }
      // DB-backed and static single_template shared-layout types both use template.{locale}.yml
      if (!isSharedLayoutType(type, root)) {
        res.status(400).json({ error: `Content type "${type}" does not use a single template` });
        return;
      }
      const variantSlug = req.query.variantSlug as string | undefined;
      const merged = mergeSingleTemplate(type, locale, undefined, undefined, root, variantSlug);
      if (!merged) {
        res.status(404).json({ error: "Single template not found" });
        return;
      }
      if (!Array.isArray(merged.sections)) {
        res.status(404).json({ error: "No sections array in single template" });
        return;
      }
      const sectionYamls = (merged.sections as unknown[]).map((s) =>
        safeYamlDump(s, { lineWidth: -1, noRefs: true }),
      );
      res.json({ sections: sectionYamls });
    } catch (err) {
      res.status(500).json({ error: String(err) });
    }
  });

  app.get("/api/content-types/:type/entry-fields", (req, res) => {
    try {
      const { type } = req.params;
      const slugParam = req.query.slug as string | undefined;
      const localeParam = req.query.locale as string | undefined;

      const config = getContentTypeConfig(type, ctRoot(res));
      if (!config) {
        res.status(404).json({ error: `Content type "${type}" not found` });
        return;
      }

      const fieldMapping = config.field_mapping ?? {};
      const fieldKeys = Object.keys(fieldMapping).filter((k) => !k.startsWith("_"));

      const slugs = getCI(res).listContentSlugs(type as ContentType);
      if (slugs.length === 0) {
        res.json({ slug: null, title: null, fields: {}, computed: [] });
        return;
      }

      const targetSlug = slugParam && slugs.includes(slugParam) ? slugParam : slugs[0];
      const availableLocales = getCI(res).getAvailableLocalesOrVariants(type as ContentType, targetSlug);
      const entryLocale = localeParam && availableLocales.includes(localeParam) ? localeParam : availableLocales[0];
      if (!entryLocale) {
        res.json({ slug: null, title: null, fields: {}, computed: [] });
        return;
      }

      const { data } = getCI(res).loadMergedContent(type, targetSlug, entryLocale);
      if (!data) {
        res.json({ slug: null, title: null, fields: {}, computed: [] });
        return;
      }

      const fields: Record<string, string | boolean | number | null> = {};
      const computed: string[] = [];

      for (const key of fieldKeys) {
        const rawMapping = fieldMapping[key];
        const mappingValue =
          typeof rawMapping === "string"
            ? rawMapping
            : typeof rawMapping === "object" && rawMapping !== null
            ? (rawMapping as { source: string }).source
            : null;

        if (typeof mappingValue === "string" && mappingValue.startsWith("function:")) {
          computed.push(key);
          const fallback = extractByDotPath(data, key);
          fields[key] = fallback != null ? String(fallback) : null;
        } else if (typeof mappingValue === "string") {
          const value = extractByDotPath(data, mappingValue);
          if (value == null) {
            fields[key] = null;
          } else if (typeof value === "boolean" || typeof value === "number") {
            fields[key] = value;
          } else {
            fields[key] = String(value);
          }
        } else {
          fields[key] = null;
        }
      }

      const nullFields = Object.entries(fields)
        .filter(([k, v]) => v === null && !computed.includes(k))
        .map(([k]) => k);
      if (nullFields.length > 0) {
        for (const otherSlug of slugs) {
          if (nullFields.length === 0) break;
          if (otherSlug === targetSlug) continue;
          const otherLocales = getCI(res).getAvailableLocalesOrVariants(type as ContentType, otherSlug);
          if (!otherLocales.length) continue;
          const otherResult = getCI(res).loadMergedContent(type, otherSlug, otherLocales[0]);
          if (!otherResult?.data) continue;
          for (let i = nullFields.length - 1; i >= 0; i--) {
            const fk = nullFields[i];
            const mp = fieldMapping[fk];
            const mv = typeof mp === "string" ? mp : typeof mp === "object" && mp !== null ? (mp as { source: string }).source : null;
            if (typeof mv !== "string" || mv.startsWith("function:")) continue;
            const v = extractByDotPath(otherResult.data, mv);
            if (v != null) {
              if (typeof v === "boolean" || typeof v === "number") {
                fields[fk] = v;
              } else {
                fields[fk] = String(v);
              }
              nullFields.splice(i, 1);
            }
          }
        }
      }

      const titleRaw = extractByDotPath(data, "title");
      const title = titleRaw != null ? String(titleRaw) : null;

      res.json({ slug: targetSlug, title, fields, computed });
    } catch (err) {
      res.status(500).json({ error: String(err) });
    }
  });

  app.get("/api/content-type/:name/single-defaults", (req, res) => {
    try {
      const { name } = req.params;
      const folder = getFolder(name);
      if (!folder) {
        res.status(404).json({ error: `Content type "${name}" not found` });
        return;
      }
      const filePath = resolveCommonTemplatePath(path.join(getContentRoot(res), folder));
      if (!fs.existsSync(filePath)) {
        res.json({ defaults: {} });
        return;
      }
      const raw = fs.readFileSync(filePath, "utf-8");
      const parsed = getCI(res).safeYamlLoad(raw) || {};
      res.json({ defaults: parsed });
    } catch (err) {
      res.status(500).json({ error: String(err) });
    }
  });

  app.put("/api/content-type/:name/single-defaults", (req, res) => {
    try {
      const { name } = req.params;
      const folder = getFolder(name);
      if (!folder) {
        res.status(404).json({ error: `Content type "${name}" not found` });
        return;
      }
      const body = req.body;
      if (!body || typeof body !== "object") {
        res.status(400).json({ error: "Request body must be a JSON object" });
        return;
      }
      const filePath = resolveCommonTemplatePath(path.join(getContentRoot(res), folder), {
        forWrite: true,
      });
      let existing: Record<string, unknown> = {};
      const existingPath = resolveCommonTemplatePath(path.join(getContentRoot(res), folder));
      if (fs.existsSync(existingPath)) {
        const raw = fs.readFileSync(existingPath, "utf-8");
        existing = getCI(res).safeYamlLoad(raw) || {};
      }
      const { author: _authorIgnored, ...bodyWithoutAuthor } = body as Record<string, unknown>;
      const merged = deepMerge(existing, bodyWithoutAuthor);
      // Clear legacy nested layout keys when writing top-level layout defaults
      const wroteLayoutKey = SECTION_LAYOUT_DEFAULT_KEYS.some((k) => k in bodyWithoutAuthor);
      if (wroteLayoutKey && merged.section_defaults && typeof merged.section_defaults === "object" && !Array.isArray(merged.section_defaults)) {
        const sd = { ...(merged.section_defaults as Record<string, unknown>) };
        for (const key of SECTION_LAYOUT_DEFAULT_KEYS) {
          if (key in bodyWithoutAuthor) delete sd[key];
        }
        if (Object.keys(sd).length === 0) delete merged.section_defaults;
        else merged.section_defaults = sd;
      }
      const { escaped, map } = escapeObjectVars(merged);
      const dumped = yaml.dump(escaped, { lineWidth: 120, noRefs: true });
      const yamlStr = unescapeYamlDump(dumped, map);
      fs.writeFileSync(filePath, yamlStr, "utf-8");
      const author = (req.body as Record<string, unknown>).author as string | undefined;
      markFileAsModified(filePath, author || "api");
      invalidateContentCaches(name, getCI(res));
      res.json({ success: true, defaults: merged });
    } catch (err) {
      res.status(500).json({ error: String(err) });
    }
  });

  app.get("/api/content-types/:type/items", async (req, res) => {
    try {
      const { type } = req.params;
      const config = getContentTypeConfig(type, ctRoot(res));
      if (!config) {
        res.status(404).json({ error: `Content type "${type}" not found` });
        return;
      }

      const pagination = parseListPagination(req.query as Record<string, unknown>);
      const locale = req.query.locale as string | undefined;
      const sort = typeof req.query.sort === "string" ? req.query.sort : undefined;
      const sortDir = parseSortDir(req.query.sortDir);
      const q =
        typeof req.query.q === "string" && req.query.q.trim()
          ? req.query.q.trim()
          : "";
      const limitRaw = req.query.limit
        ? parseInt(String(req.query.limit), 10)
        : undefined;
      // When paginating, load the full candidate set then filter/sort/slice here.
      const limit = pagination.paginate
        ? undefined
        : limitRaw !== undefined && !Number.isNaN(limitRaw) && limitRaw > 0
          ? limitRaw
          : undefined;

      const filters: QueryFilter[] = [];
      const indexes = getIndexes(type, ctRoot(res));
      if (pagination.paginate) {
        for (const f of collectQueryFieldFilters(req.query as Record<string, unknown>)) {
          filters.push({ field: f.field, value: f.value });
        }
      } else {
        for (const idx of indexes) {
          const filterVal = req.query[idx] as string | undefined;
          if (filterVal !== undefined && filterVal !== "") {
            filters.push({ field: idx, value: filterVal });
          }
        }
      }

      const { items, meta } = await queryEntries(
        {
          from: { contentType: type },
          locale: locale ? normalizeLocale(locale) : undefined,
          // When paginating with multi-value tag filters, apply them after fetch
          // so AND-of-values matches the manage UI (queryEntries OR-in-array semantics differ).
          filters:
            pagination.paginate && filters.length
              ? undefined
              : filters.length
                ? filters
                : undefined,
          sort: pagination.paginate && sortDir ? undefined : sort,
          limit,
        },
        {
          db: getDB(res),
          contentIndex: getCI(res),
          contentRoot: getContentRoot(res),
        },
      );

      const includeContent =
        req.query.include_content === "1" ||
        req.query.include_content === "true";

      // Static listing projections omit `content`. When the caller asks for bodies
      // (OG entry-preview live samples), restore them so reading_time can be derived.
      let workingItems =
        includeContent && meta.source === "content_type"
          ? hydrateStaticListingContent(items as Array<Record<string, unknown>>, type, {
              ci: getCI(res),
              contentRoot: getContentRoot(res),
            })
          : (items as Array<Record<string, unknown>>);

      if (pagination.paginate) {
        for (const f of filters) {
          workingItems = workingItems.filter((item) =>
            matchesManageTagFilter(item, f.field, String(f.value)),
          );
        }
        if (q) {
          workingItems = workingItems.filter((item) =>
            matchesManageItemsSearch(item, q),
          );
        }
        workingItems = sortByUpdatedAtField(
          workingItems,
          sortDir,
          (item) => item.updated_at,
        );
      }

      const stripped = workingItems.map((item) => {
        const body = item.content;
        const reading_minutes =
          typeof body === "string" && body.trim()
            ? estimateReadingMinutes(body)
            : estimateReadingMinutesFromSections(item.sections);
        if (includeContent) {
          return reading_minutes != null ? { ...item, reading_minutes } : item;
        }
        // List projections omit heavy bodies; keep reading_minutes for OG live preview.
        const { content, readme, ...rest } = item;
        return reading_minutes != null ? { ...rest, reading_minutes } : rest;
      });

      let facets: Record<string, string[]> | undefined;
      if (config.database?.slug && getDB(res).exists(config.database.slug)) {
        const dbResult = await getDB(res).fetchItems(config.database.slug);
        facets = dbResult.facets;
        if (!facets) {
          const dbConfig = getDB(res).get(config.database.slug);
          if (dbConfig.editor) {
            const computed: Record<string, string[]> = {};
            for (const [field, hint] of Object.entries(dbConfig.editor)) {
              if (hint.type === "tags" || hint.type === "select") {
                const valueSet = new Set<string>();
                for (const item of dbResult.items) {
                  const v = item[field];
                  if (Array.isArray(v)) {
                    for (const el of v) {
                      if (el != null && el !== "") valueSet.add(String(el));
                    }
                  } else if (v != null && v !== "") {
                    valueSet.add(String(v));
                  }
                }
                if (valueSet.size > 0) {
                  computed[field] = [...valueSet].sort((a, b) =>
                    a.localeCompare(b),
                  );
                }
              }
            }
            if (Object.keys(computed).length > 0) facets = computed;
          }
        }
      }

      if (pagination.paginate) {
        const paged = paginateList(stripped, pagination.page, pagination.pageSize);
        res.json({
          count: paged.pageItems.length,
          results: paged.pageItems,
          source: meta.source,
          total: paged.total,
          page: paged.page,
          pageSize: paged.pageSize,
          totalPages: paged.totalPages,
          ...(facets ? { facets } : {}),
        });
        return;
      }

      res.json({
        count: stripped.length,
        results: stripped,
        source: meta.source,
        ...(facets ? { facets } : {}),
      });
    } catch (err) {
      log.error(
        `[ContentTypes] Error fetching items for ${req.params.type}:`,
        err,
      );
      res.status(500).json({ error: String(err) });
    }
  });

  app.get("/api/content-types/:type/static-entries", (req, res) => {
    try {
      const { type } = req.params;
      const pagination = parseListPagination(req.query as Record<string, unknown>);
      const sortDir = parseSortDir(req.query.sortDir);
      const q =
        typeof req.query.q === "string" && req.query.q.trim()
          ? req.query.q.trim().toLowerCase()
          : "";
      const allEntries = getCI(res).findByType(type);
      const versioningManager = (res.locals.site as any)?.versioningManager ?? getVersioningManager();
      const root = ctRoot(res);
      const indexedSlugs = new Set(allEntries.map((e) => e.slug));

      const matchesQuery = (title: string, slug: string) =>
        !q ||
        title.toLowerCase().includes(q) ||
        slug.toLowerCase().includes(q);

      // When searching, skip expensive enrichment for non-matching entries.
      const entries = q
        ? allEntries.filter((e) => matchesQuery(e.title || e.slug, e.slug))
        : allEntries;

      const enrichEntry = (entry: (typeof allEntries)[number]) => {
        const urls = getCI(res).getLocaleUrls(entry.slug, type, {
          includeEmptyLocales: true,
        });
        const versionCounts = versioningManager.getVersionCounts(type, entry.slug);
        const locales = entry.locales.filter(
          (l) => !l.startsWith("_") && !l.includes("."),
        );
        return {
          slug: entry.slug,
          title: entry.title || entry.slug,
          locales,
          urls,
          versionCounts,
          updated_at: resolveStaticEntryUpdatedAt(type, entry.slug, locales, root),
          status: "published" as const,
        };
      };

      const results = entries.map(enrichEntry);

      // Include draft-only folders (no live locales) for non-shared-layout types
      if (usesDraftFirstCreate(type, root)) {
        const allSlugs = getCI(res).listContentSlugs(type as ContentType);
        for (const slug of allSlugs) {
          if (indexedSlugs.has(slug)) continue;
          const dir = getEntryContentDir(type, slug, root);
          const draftLocales = listDraftLocales(dir, false);
          if (draftLocales.length === 0 && !fs.existsSync(path.join(dir, "_common.yml"))) continue;

          let title = slug;
          const commonPath = path.join(dir, "_common.yml");
          if (fs.existsSync(commonPath)) {
            try {
              const common = getCI(res).safeYamlLoad(fs.readFileSync(commonPath, "utf-8")) as Record<string, unknown> | null;
              if (typeof common?.title === "string" && common.title.trim()) title = common.title.trim();
            } catch { /* ignore */ }
          }

          if (!matchesQuery(title, slug)) continue;

          const draftVariants = new Set<string>();
          for (const loc of draftLocales) {
            for (const v of listVariantSlugsForLocale(dir, loc, false)) draftVariants.add(v);
          }
          const primaryVariant = draftVariants.has(DEFAULT_DRAFT_VARIANT)
            ? DEFAULT_DRAFT_VARIANT
            : [...draftVariants][0] ?? DEFAULT_DRAFT_VARIANT;
          const primaryLocale = draftLocales.includes("en") ? "en" : (draftLocales[0] ?? "en");

          results.push({
            slug,
            title,
            locales: draftLocales,
            urls: {},
            versionCounts: versioningManager.getVersionCounts(type, slug),
            updated_at: resolveStaticEntryUpdatedAt(type, slug, draftLocales, root),
            status: "draft" as const,
            draftVariant: primaryVariant,
            previewPath: `/private/preview/${type}/${slug}?variant=${encodeURIComponent(primaryVariant)}&locale=${primaryLocale}`,
          } as any);
        }
      }

      if (!pagination.paginate) {
        res.json({ count: results.length, results });
        return;
      }

      let filtered = results as Array<{
        slug: string;
        title: string;
        updated_at?: string | null;
        [key: string]: unknown;
      }>;
      // q already applied when building `results`; keep a defensive pass for title/slug.
      if (q) {
        filtered = filtered.filter(
          (e) =>
            e.title.toLowerCase().includes(q) ||
            e.slug.toLowerCase().includes(q),
        );
      }
      filtered = sortByUpdatedAtField(filtered, sortDir, (e) => e.updated_at);

      const paged = paginateList(filtered, pagination.page, pagination.pageSize);
      res.json({
        count: paged.pageItems.length,
        results: paged.pageItems,
        total: paged.total,
        page: paged.page,
        pageSize: paged.pageSize,
        totalPages: paged.totalPages,
      });
    } catch (err) {
      res.status(500).json({ error: String(err) });
    }
  });

  app.get("/api/content-types/:type/cache-status", (req, res) => {
    try {
      const { type } = req.params;
      const config = getContentTypeConfig(type, ctRoot(res));
      if (!config?.database?.slug) {
        res.json({ exists: false, age_hours: null, post_count: null });
        return;
      }
      const dbName = config.database.slug;
      const stats = getDB(res).getCacheStats().perDb[dbName];
      if (!stats?.fetched_at) {
        res.json({ exists: false, age_hours: null, post_count: null });
        return;
      }
      const ageMs = Date.now() - new Date(stats.fetched_at).getTime();
      const ageHours = Math.round((ageMs / (60 * 60 * 1000)) * 10) / 10;
      res.json({
        exists: true,
        age_hours: ageHours,
        post_count: stats.item_count,
      });
    } catch (err) {
      res.status(500).json({ error: String(err) });
    }
  });

  app.get("/api/content-types/:type/seo-entries", async (req, res) => {
    try {
      const { type } = req.params;
      const localeFilter = req.query.locale as string | undefined;
      const pagination = parseListPagination(req.query as Record<string, unknown>);
      const q =
        typeof req.query.q === "string" && req.query.q.trim()
          ? req.query.q.trim().toLowerCase()
          : "";
      const config = getContentTypeConfig(type, ctRoot(res));
      if (!config) {
        res.status(404).json({ error: `Content type "${type}" not found` });
        return;
      }
      const urlPattern = config.url_pattern as Record<string, string> | undefined;

      const finishSeoEntries = (
        base: Record<string, unknown>,
        entries: Array<Record<string, unknown>>,
      ) => {
        if (!pagination.paginate) {
          res.json({ ...base, count: entries.length, entries });
          return;
        }
        let filtered = entries;
        if (q) {
          filtered = filtered.filter((e) => {
            const title = String(e.title || "").toLowerCase();
            const slug = String(e.slug || "").toLowerCase();
            const pageTitle = String(
              (e.meta as Record<string, unknown> | undefined)?.page_title || "",
            ).toLowerCase();
            return (
              title.includes(q) || slug.includes(q) || pageTitle.includes(q)
            );
          });
        }
        const paged = paginateList(filtered, pagination.page, pagination.pageSize);
        res.json({
          ...base,
          count: paged.pageItems.length,
          entries: paged.pageItems,
          total: paged.total,
          page: paged.page,
          pageSize: paged.pageSize,
          totalPages: paged.totalPages,
        });
      };

      // ── DB-backed ────────────────────────────────────────────────────────────
      if (config.database?.slug) {
        const dbName = config.database.slug;
        if (!getDB(res).exists(dbName)) {
          res.status(404).json({ error: `Database "${dbName}" not found` });
          return;
        }
        // Same path as the default DB list: fetchMappedItems refreshes when TTL expired.
        // Do not gate on getCacheInfo() — expired TTL would falsely report cache_missing.
        const items = await getDB(res).fetchMappedItems(type);
        const cacheInfo = getDB(res).getCacheInfo(dbName);
        if (items.length === 0 && !cacheInfo) {
          finishSeoEntries(
            { contentType: type, source: "db", cache_missing: true, cache_age_hours: null },
            [],
          );
          return;
        }
        const localeKey = getLocaleKey(type, ctRoot(res)) || "lang";
        const cacheAgeHours = cacheInfo?.fetched_at
          ? Math.round((Date.now() - new Date(cacheInfo.fetched_at).getTime()) / (60 * 60 * 1000) * 10) / 10
          : null;

        const uniqueLocales = [...new Set(items.map(item => String(item[localeKey] || "en")))];
        const templates: Record<string, Record<string, unknown> | null> = {};
        for (const locale of uniqueLocales) {
          templates[locale] = mergeSingleTemplate(type, locale, undefined, undefined, getContentRoot(res));
        }

        const preview = getPreviewConfig(type, ctRoot(res));
        let epm: ReturnType<typeof getEntryPreviewManager> | null = null;
        try {
          epm = getEntryPreviewManager(res);
        } catch {
          epm = null;
        }

        const entries: Array<Record<string, unknown>> = [];
        for (const item of items) {
          if (localeFilter && String(item[localeKey] || "en") !== localeFilter) continue;
          const locale = String(item[localeKey] || "en");
          const template = templates[locale];
          const rawMeta = resolveAllTemplateVars(template?.meta ?? {}, {
            singleEntry: item as Record<string, unknown>,
            contentRoot: getContentRoot(res),
            context: { locale },
            skipSiteVars: false,
          }) as Record<string, unknown>;
          const resolvedMeta: Record<string, unknown> = {};
          for (const [k, v] of Object.entries(rawMeta)) {
            resolvedMeta[k] = (typeof v === "string" && /\{\{.*?\}\}/.test(v)) ? null : v;
          }
          if (epm && (!resolvedMeta.og_image || resolvedMeta.og_image === null)) {
            const url = await applyEntryPreviewOgImage(epm, {
              contentType: type,
              entry: item as Record<string, unknown>,
              previewConfig: preview,
              skipHeadCheck: true,
            });
            if (url) resolvedMeta.og_image = url;
          }
          let url: string | null = null;
          if (urlPattern && typeof item.slug === "string") {
            const tpl = urlPattern[locale] || urlPattern["default"] || null;
            if (tpl) {
              url = tpl.replace(/:([a-zA-Z_][a-zA-Z0-9_]*)/g, (_match, key: string) => {
                if (key === "slug") return item.slug as string;
                const val = item[key];
                if (val === undefined || val === null || val === "") return "";
                if (typeof val === "object" && "slug" in (val as Record<string, unknown>)) {
                  return String((val as Record<string, unknown>).slug) || "";
                }
                return String(val);
              });
            }
          }
          entries.push({
            slug: item.slug ?? null,
            contentType: type,
            locale,
            url,
            title: item.title ?? null,
            meta: resolvedMeta,
            schema: template?.schema ?? null,
          });
        }

        finishSeoEntries(
          { contentType: type, source: "db", cache_age_hours: cacheAgeHours },
          entries,
        );
        return;
      }

      // ── YAML-backed ──────────────────────────────────────────────────────────
      const dir = getDirectory(type);
      const contentDir = path.join(getContentRoot(res), dir);
      if (!fs.existsSync(contentDir)) {
        res.status(404).json({ error: `Content directory not found: ${getContentRootName(res)}/${dir}` });
        return;
      }

      const entries: Array<Record<string, unknown>> = [];
      const slugDirs = fs.readdirSync(contentDir, { withFileTypes: true }).filter(d => d.isDirectory());

      for (const slugDir of slugDirs) {
        const slug = slugDir.name;
        const slugPath = path.join(contentDir, slug);
        try {
          const files = fs.readdirSync(slugPath).filter(f => f.endsWith(".yml") || f.endsWith(".yaml"));

          const localeFiles = files
            .map(f => f.replace(/\.(yml|yaml)$/, ""))
            .filter(n => /^[a-z]{2}(-[a-z]{2})?$/.test(n));

          if (localeFiles.length === 0) continue;

          let commonData: Record<string, unknown> = {};
          const commonPath = path.join(slugPath, "_common.yml");
          if (fs.existsSync(commonPath)) {
            try {
              commonData = getCI(res).safeYamlLoad(fs.readFileSync(commonPath, "utf-8")) || {};
            } catch { /* ignore broken _common.yml */ }
          }

          for (const locale of localeFiles) {
            if (localeFilter && locale !== localeFilter) continue;
            const localePath = path.join(slugPath, `${locale}.yml`);
            if (!fs.existsSync(localePath)) continue;

            try {
              const localeData = getCI(res).safeYamlLoad(fs.readFileSync(localePath, "utf-8")) || {};
              const merged = deepMerge(commonData, localeData) as Record<string, unknown>;

              const rawMeta = (merged.meta as Record<string, unknown>) ?? {};
              const resolvedMeta = resolveAllTemplateVars(rawMeta, {
                contentRoot: getContentRoot(res),
                context: { locale },
                skipSiteVars: false,
              }) as Record<string, unknown>;

              let url: string | null = null;
              if (urlPattern) {
                const tpl = urlPattern[locale] || urlPattern["default"] || null;
                if (tpl) url = tpl.replace(":slug", slug);
              }

              entries.push({
                slug,
                contentType: type,
                locale,
                url,
                title: typeof merged.title === "string" ? merged.title : null,
                meta: resolvedMeta,
                schema: (merged.schema as Record<string, unknown>) ?? null,
              });
            } catch (fileErr) {
              entries.push({ slug, contentType: type, locale, url: null, title: null, meta: {}, schema: null, parse_error: String(fileErr) });
            }
          }
        } catch (slugErr) {
          entries.push({ slug, contentType: type, locale: null, url: null, title: null, meta: {}, schema: null, parse_error: String(slugErr) });
        }
      }

      finishSeoEntries(
        { contentType: type, source: "yaml", cache_age_hours: null },
        entries,
      );
    } catch (err) {
      res.status(500).json({ error: String(err) });
    }
  });

  // ── Entry preview screenshots (OG / admin thumbs) ───────────────────────────
  app.get("/api/content-types/:type/entry-previews", async (req, res) => {
    try {
      const { type } = req.params;
      const config = getContentTypeConfig(type, ctRoot(res));
      if (!config) {
        res.status(404).json({ error: `Content type "${type}" not found` });
        return;
      }
      const preview = getPreviewConfig(type, ctRoot(res));
      const captureReady = isPreviewCaptureReady(preview);
      const mappingValidation = preview ? validatePreviewPropMappings(preview) : null;
      const epm = getEntryPreviewManager(res);
      const width = preview?.widths?.[0] ?? DEFAULT_PREVIEW_WIDTH;
      const localeFilter = typeof req.query.locale === "string" ? req.query.locale : undefined;
      const entries = await loadEntriesForPreview(res, type, localeFilter);
      const localeKey = getLocaleKey(type, ctRoot(res));
      const index: Record<
        string,
        {
          slug: string;
          locale: string;
          meta: EntryPreviewMeta | null;
          cacheBustedUrl: string | null;
          needsCapture: boolean;
          fromSource: boolean;
          propsHash?: string;
        }
      > = {};
      for (const entry of entries) {
        const slug = String(entry.slug ?? "");
        if (!slug) continue;
        const locale = localeKey
          ? String(entry[localeKey] || "en")
          : String(entry.lang ?? entry.locale ?? entry.language ?? "en");
        const imageStr =
          typeof entry[IMAGE_ALIAS_FIELD] === "string"
            ? (entry[IMAGE_ALIAS_FIELD] as string).trim()
            : typeof entry[RESERVED_IMAGE_FIELD] === "string"
              ? (entry[RESERVED_IMAGE_FIELD] as string).trim()
              : typeof entry.preview === "string"
                ? (entry.preview as string).trim()
                : "";
        const fromSource = !!(imageStr && !/\{\{/.test(imageStr));
        const meta = await epm.getMeta(type, slug, locale, width);
        let propsHash: string | undefined;
        if (preview) {
          const ctx = await buildPreviewPropResolveContext({
            contentType: type,
            slug,
            locale,
            entry,
            contentRoot: getContentRoot(res),
            db: getDB(res),
            mediaGallery: getMediaGallery(res),
            theme: preview.theme === "light" ? "light" : "dark",
          });
          propsHash = hashPreviewProps(preview.props, ctx);
        }
        const needsCapture =
          captureReady &&
          !fromSource &&
          !!preview &&
          epm.needsCapture(meta, propsHash, !!preview.dirty_on_prop_change);
        index[`${slug}:${locale}`] = {
          slug,
          locale,
          meta,
          cacheBustedUrl: epm.cacheBustedUrl(meta),
          needsCapture,
          fromSource,
          propsHash,
        };
      }
      res.json({
        contentType: type,
        preview,
        captureReady,
        captureReadyError: mappingValidation && !mappingValidation.ok ? mappingValidation.error : undefined,
        width,
        maxHeight: preview?.maxHeight ?? DEFAULT_PREVIEW_MAX_HEIGHT,
        count: Object.keys(index).length,
        index,
      });
    } catch (err) {
      res.status(500).json({ error: String(err) });
    }
  });

  app.get("/api/content-types/:type/entry-previews/stats", async (req, res) => {
    try {
      const { type } = req.params;
      const config = getContentTypeConfig(type, ctRoot(res));
      if (!config) {
        res.status(404).json({ error: `Content type "${type}" not found` });
        return;
      }
      const preview = getPreviewConfig(type, ctRoot(res));
      const captureReady = isPreviewCaptureReady(preview);
      const mappingValidation = preview ? validatePreviewPropMappings(preview) : null;
      // Avoid hydrating every article body unless stats must recompute props hashes.
      const entries = await loadEntriesForPreview(res, type, undefined, {
        hydrateMappedContent: !!preview?.dirty_on_prop_change,
      });
      const localeKey = getLocaleKey(type, ctRoot(res));
      const stats = await getEntryPreviewManager(res).stats(
        type,
        entries,
        captureReady ? preview : null,
        localeKey,
      );
      res.setHeader("Cache-Control", "no-store");
      res.json({
        contentType: type,
        preview: !!preview,
        captureReady,
        captureReadyError:
          mappingValidation && !mappingValidation.ok ? mappingValidation.error : undefined,
        ...stats,
      });
    } catch (err) {
      res.status(500).json({ error: String(err) });
    }
  });

  /**
   * Resolved SEO meta + brand for live Entry Preview admin (draft prop mappings).
   * Same meta/brand path as capture — listing projections omit raw `meta`.
   */
  app.get(
    "/api/content-types/:type/entries/:slug/preview-resolve-context",
    async (req, res) => {
      try {
        const { type, slug } = req.params;
        const locale = normalizeLocale((req.query.locale as string) || "en");
        const config = getContentTypeConfig(type, ctRoot(res));
        if (!config) {
          res.status(404).json({ error: `Content type "${type}" not found` });
          return;
        }
        const themeQuery = typeof req.query.theme === "string" ? req.query.theme : "";
        const theme: "dark" | "light" =
          themeQuery === "light" || themeQuery === "dark" ? themeQuery : "dark";

        const entries = await loadEntriesForPreview(res, type, locale, {
          hydrateMappedContent: false,
        });
        const localeKey = getLocaleKey(type, ctRoot(res));
        const entry =
          entries.find((item) => {
            const itemLocale = localeKey
              ? String(item[localeKey] || "en")
              : String(item.lang ?? item.locale ?? item.language ?? "en");
            return String(item.slug ?? "") === slug && itemLocale === locale;
          }) || entries.find((item) => String(item.slug ?? "") === slug);
        if (!entry) {
          res.status(404).json({ error: `Entry not found: ${type}/${slug}` });
          return;
        }

        const ctx = await buildPreviewPropResolveContext({
          contentType: type,
          slug,
          locale,
          entry,
          contentRoot: getContentRoot(res),
          db: getDB(res),
          mediaGallery: getMediaGallery(res),
          theme,
        });
        res.json({
          contentType: type,
          slug,
          locale,
          theme,
          meta: ctx.meta || {},
          brand: ctx.brand || {},
        });
      } catch (err) {
        res.status(500).json({ error: String(err) });
      }
    },
  );

  app.get("/api/content-types/:type/entries/:slug/preview-frame", async (req, res) => {
    try {
      const { type, slug } = req.params;
      const locale = normalizeLocale((req.query.locale as string) || "en");
      const captureToken =
        typeof req.query.capture_token === "string" ? req.query.capture_token : "";
      const expRaw = typeof req.query.exp === "string" ? req.query.exp : "";
      if (captureToken || expRaw) {
        const { verifyEntryPreviewCaptureToken } = await import("../entry-preview-capture-auth");
        const exp = Number(expRaw);
        const verified = verifyEntryPreviewCaptureToken({
          contentType: type,
          slug,
          locale,
          exp,
          token: captureToken,
        });
        if (!verified.ok) {
          res.status(401).json({ error: verified.error });
          return;
        }
      }
      const preview = getPreviewConfig(type, ctRoot(res));
      if (!preview) {
        res.status(404).json({ error: `No preview config for content type "${type}"` });
        return;
      }
      const mappingCheck = validatePreviewPropMappings(preview);
      if (!mappingCheck.ok) {
        res.status(400).json({
          error: mappingCheck.error || "Preview property mappings are incomplete",
          missingRequired: mappingCheck.missingRequired,
        });
        return;
      }
      const entries = await loadEntriesForPreview(res, type, locale);
      const localeKey = getLocaleKey(type, ctRoot(res));
      const entry =
        entries.find((item) => {
          const itemLocale = localeKey
            ? String(item[localeKey] || "en")
            : String(item.lang ?? item.locale ?? item.language ?? "en");
          return String(item.slug ?? "") === slug && itemLocale === locale;
        }) || entries.find((item) => String(item.slug ?? "") === slug);
      if (!entry) {
        res.status(404).json({ error: `Entry not found: ${type}/${slug}` });
        return;
      }
      // Capture job can override theme via ?theme= so logo resolve matches the iframe.
      const themeQuery = typeof req.query.theme === "string" ? req.query.theme : "";
      const theme: "dark" | "light" =
        themeQuery === "light" || themeQuery === "dark"
          ? themeQuery
          : preview.theme === "light"
            ? "light"
            : "dark";
      const ctx = await buildPreviewPropResolveContext({
        contentType: type,
        slug,
        locale,
        entry,
        contentRoot: getContentRoot(res),
        db: getDB(res),
        mediaGallery: getMediaGallery(res),
        theme,
      });
      const { section, missing } = buildPreviewSection(preview, ctx);
      if (missing.length > 0) {
        res.status(400).json({
          error: formatMissingPreviewPropsMessage(missing, preview.props, ctx),
          missing,
        });
        return;
      }
      const propsHash = hashPreviewProps(preview.props, ctx);
      res.json({
        contentType: type,
        slug,
        locale,
        theme,
        width: preview.widths?.[0] ?? DEFAULT_PREVIEW_WIDTH,
        maxHeight: preview.maxHeight ?? DEFAULT_PREVIEW_MAX_HEIGHT,
        propsHash,
        section,
      });
    } catch (err) {
      res.status(500).json({ error: String(err) });
    }
  });

  app.put(
    "/api/content-types/:type/entries/:slug/preview-image",
    express.raw({ type: "image/webp", limit: "5mb" }),
    async (req, res) => {
      try {
        const { type, slug } = req.params;
        const auth = await requireCapability(req, res, "content_edit_media", type);
        if (!auth.authorized) return;
        const locale = normalizeLocale((req.query.locale as string) || "en");
        const preview = getPreviewConfig(type, ctRoot(res));
        if (!isPreviewCaptureReady(preview)) {
          const mappingCheck = preview ? validatePreviewPropMappings(preview) : null;
          res.status(400).json({
            error:
              mappingCheck?.error ||
              "Preview is not properly configured — fix property mappings before uploading captures",
          });
          return;
        }
        const width = Number(req.query.width) || preview?.widths?.[0] || DEFAULT_PREVIEW_WIDTH;
        const epm = getEntryPreviewManager(res);
        const image = Buffer.isBuffer(req.body) ? req.body : Buffer.from(req.body ?? []);
        if (image.length === 0) {
          const failed = await epm.markFailed(type, slug, locale, width, "empty_body");
          res.status(400).json({ error: "Empty image body", meta: failed });
          return;
        }
        let propsHash =
          typeof req.query.propsHash === "string" && req.query.propsHash
            ? req.query.propsHash
            : undefined;
        if (!propsHash && preview) {
          const entries = await loadEntriesForPreview(res, type, locale);
          const localeKey = getLocaleKey(type, ctRoot(res));
          const entry =
            entries.find((item) => {
              const itemLocale = localeKey
                ? String(item[localeKey] || "en")
                : String(item.lang ?? item.locale ?? item.language ?? "en");
              return String(item.slug ?? "") === slug && itemLocale === locale;
            }) || entries.find((item) => String(item.slug ?? "") === slug);
          if (entry) {
            const ctx = await buildPreviewPropResolveContext({
              contentType: type,
              slug,
              locale,
              entry,
              contentRoot: getContentRoot(res),
              db: getDB(res),
              mediaGallery: getMediaGallery(res),
              theme: preview.theme === "light" ? "light" : "dark",
            });
            propsHash = hashPreviewProps(preview.props, ctx);
          }
        }
        try {
          const meta = await epm.upsertWebp({
            contentType: type,
            slug,
            locale,
            width,
            buffer: image,
            propsHash,
          });
          res.json({
            success: true,
            meta,
            url: epm.cacheBustedUrl(meta),
          });
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          if (!msg.includes("capture_too_small")) {
            await epm.markFailed(type, slug, locale, width, msg);
          }
          res.status(400).json({ error: msg });
        }
      } catch (err) {
        res.status(500).json({ error: String(err) });
      }
    },
  );

  app.post("/api/content-types/:type/entries/:slug/preview-dirty", async (req, res) => {
    try {
      const { type, slug } = req.params;
      const auth = await requireCapability(req, res, "content_edit_media", type);
      if (!auth.authorized) return;
      const locale = normalizeLocale(
        (req.body?.locale as string) || (req.query.locale as string) || "en",
      );
      const preview = getPreviewConfig(type, ctRoot(res));
      const width =
        Number(req.body?.width) ||
        Number(req.query.width) ||
        preview?.widths?.[0] ||
        DEFAULT_PREVIEW_WIDTH;
      const meta = await getEntryPreviewManager(res).markDirty(type, slug, locale, width);
      res.json({ success: true, meta });
    } catch (err) {
      res.status(500).json({ error: String(err) });
    }
  });

  app.post("/api/content-types/:type/entries/:slug/preview-failed", async (req, res) => {
    try {
      const { type, slug } = req.params;
      const auth = await requireCapability(req, res, "content_edit_media", type);
      if (!auth.authorized) return;
      const locale = normalizeLocale(
        (req.body?.locale as string) || (req.query.locale as string) || "en",
      );
      const preview = getPreviewConfig(type, ctRoot(res));
      const width =
        Number(req.body?.width) ||
        Number(req.query.width) ||
        preview?.widths?.[0] ||
        DEFAULT_PREVIEW_WIDTH;
      const error =
        typeof req.body?.error === "string" && req.body.error.trim()
          ? req.body.error.trim()
          : "capture_failed";
      const meta = await getEntryPreviewManager(res).markFailed(type, slug, locale, width, error);
      res.json({ success: true, meta });
    } catch (err) {
      res.status(500).json({ error: String(err) });
    }
  });

  app.post("/api/content-types/:type/entry-previews/retry-failed", async (req, res) => {
    try {
      const { type } = req.params;
      const auth = await requireCapability(req, res, "content_edit_media", type);
      if (!auth.authorized) return;
      const epm = getEntryPreviewManager(res);
      const preview = getPreviewConfig(type, ctRoot(res));
      const mappingCheck = preview ? validatePreviewPropMappings(preview) : null;
      if (!preview || !mappingCheck?.ok) {
        res.status(400).json({
          error:
            mappingCheck?.error ||
            "Preview is not properly configured — fix property mappings before retrying captures",
        });
        return;
      }
      const width = preview?.widths?.[0] ?? DEFAULT_PREVIEW_WIDTH;
      const bodySlug = typeof req.body?.slug === "string" ? req.body.slug : null;
      const bodyLocale =
        typeof req.body?.locale === "string" ? normalizeLocale(req.body.locale) : null;

      if (bodySlug && bodyLocale) {
        const meta = await epm.retryFailed(type, bodySlug, bodyLocale, width);
        res.json({ success: true, retried: 1, meta });
        return;
      }

      const entries = await loadEntriesForPreview(res, type);
      const localeKey = getLocaleKey(type, ctRoot(res));
      let retried = 0;
      for (const entry of entries) {
        const slug = String(entry.slug ?? "");
        if (!slug) continue;
        const locale = localeKey
          ? String(entry[localeKey] || "en")
          : String(entry.lang ?? entry.locale ?? entry.language ?? "en");
        const meta = await epm.getMeta(type, slug, locale, width);
        if (meta?.failedAt) {
          await epm.retryFailed(type, slug, locale, width);
          retried++;
        }
      }
      res.json({ success: true, retried });
    } catch (err) {
      res.status(500).json({ error: String(err) });
    }
  });

  api.post(
    app,
    "/api/content-types/:type/entry-previews/enqueue",
    { rate: "expensiveCapture" },
    async (req, res) => {
    try {
      const { type } = req.params;
      const auth = await requireCapability(req, res, "content_edit_media", type);
      if (!auth.authorized) return;
      const site = res.locals.site as import("../site-manager").SiteContext | undefined;
      if (!site) {
        res.status(500).json({ error: "Site context missing", code: "site_missing" });
        return;
      }

      const localesRaw = req.body?.locales;
      if (!Array.isArray(localesRaw) || localesRaw.length === 0) {
        res.status(400).json({
          error: "locales is required and must be a non-empty array",
          code: "locales_required",
        });
        return;
      }
      const locales = localesRaw.map((l: unknown) => String(l));
      const modeRaw = req.body?.mode;
      const mode =
        modeRaw === "all" || modeRaw === "failed" || modeRaw === "missing" ? modeRaw : "missing";
      const slugs = Array.isArray(req.body?.slugs)
        ? req.body.slugs.map((s: unknown) => String(s)).filter(Boolean)
        : undefined;

      const {
        enqueueEntryPreviewsForType,
      } = await import("../entry-preview-capture-queue");

      try {
        const result = await enqueueEntryPreviewsForType(site, {
          contentType: type,
          locales,
          slugs,
          mode,
        });
        res.json({
          success: true,
          mode,
          locales,
          ...result,
          queue: (
            await import("../entry-preview-capture-queue")
          ).getEntryPreviewQueueStats(site.contentRootName),
        });
      } catch (err) {
        const code =
          err && typeof err === "object" && "code" in err
            ? String((err as { code?: string }).code)
            : undefined;
        const message = err instanceof Error ? err.message : String(err);
        const status =
          code === "preview_not_configured" ||
          code === "locales_required" ||
          code === "capture_misconfigured"
            ? 400
            : 500;
        res.status(status).json({ error: message, code: code || "enqueue_failed" });
      }
    } catch (err) {
      res.status(500).json({ error: String(err) });
    }
  });

  app.get("/api/content-types/:type/entry-previews/queue", async (req, res) => {
    try {
      const { type } = req.params;
      const auth = await requireCapability(req, res, "content_edit_media", type);
      if (!auth.authorized) return;
      const site = res.locals.site as import("../site-manager").SiteContext | undefined;
      if (!site) {
        res.status(500).json({ error: "Site context missing" });
        return;
      }
      const { getEntryPreviewQueueStats } = await import("../entry-preview-capture-queue");
      const { cloudflareBrowserConfigError } = await import("../cloudflare-browser");
      res.json({
        contentType: type,
        configError: cloudflareBrowserConfigError(site.contentRoot),
        queue: getEntryPreviewQueueStats(site.contentRootName),
      });
    } catch (err) {
      res.status(500).json({ error: String(err) });
    }
  });

  app.post("/api/content-types/:type/clear-cache", async (req, res) => {
    try {
      const { type } = req.params;
      const config = getContentTypeConfig(type, ctRoot(res));
      if (!config?.database?.slug) {
        res
          .status(400)
          .json({ error: `Content type "${type}" has no database configured` });
        return;
      }
      const dbName = config.database.slug;
      if (getDB(res).exists(dbName)) {
        await getDB(res).fetchItems(dbName, true);
      }
      clearMarkdownCache();
      res.json({
        success: true,
        message: `Cache cleared for "${type}" (database: ${dbName})`,
      });
    } catch (err) {
      res.status(500).json({ error: String(err) });
    }
  });

  app.delete("/api/content-types/:type/cache/:slug", async (req, res) => {
    try {
      const { type, slug } = req.params;
      const config = getContentTypeConfig(type, ctRoot(res));
      if (!config?.database?.slug) {
        res
          .status(400)
          .json({ error: `Content type "${type}" has no database configured` });
        return;
      }
      clearMarkdownCache(slug);
      res.json({ success: true, message: `Cache cleared for "${slug}"` });
    } catch (err) {
      res.status(500).json({ error: String(err) });
    }
  });

  app.get("/api/content-types/:type/db-overrides/:slug", (req, res) => {
    try {
      const { type, slug } = req.params;
      const config = getContentTypeConfig(type, ctRoot(res));
      if (!config?.database?.slug) {
        res.status(400).json({ error: `Content type "${type}" has no database configured` });
        return;
      }
      const dbName = config.database.slug;
      if (!getDB(res).exists(dbName)) {
        res.status(404).json({ error: `Database "${dbName}" not found` });
        return;
      }
      const rawOverrides = getDB(res).getDbOverridesForEntry(dbName, slug);
      if (!rawOverrides) {
        res.json({ overrides: {}, originals: {} });
        return;
      }
      // Build a reverse map: dbPath -> templateKey using the field mapping
      const fm = getFieldMapping(type, ctRoot(res));
      const reverseMap: Record<string, string> = {};
      if (fm) {
        for (const [templateKey, dbPath] of Object.entries(fm)) {
          if (typeof dbPath === "string" && !dbPath.startsWith("function:") && !templateKey.startsWith("_")) {
            reverseMap[dbPath] = templateKey;
          }
        }
      }
      // Return overrides keyed by template key (falling back to DB key if no reverse mapping)
      const overrides: Record<string, unknown> = {};
      for (const [dbKey, value] of Object.entries(rawOverrides)) {
        const templateKey = reverseMap[dbKey] ?? dbKey;
        overrides[templateKey] = value;
      }
      // Return originals: the raw (pre-override) field values for each overridden key.
      // The fm (content-types registry field mapping) maps templateKey → dbConfigFieldName,
      // which is the key that exists in the DB-config-mapped item from getOriginalMappedItem.
      const lookupKey = getLookupKey(type) || "slug";
      const originalItem = getDB(res).getOriginalMappedItem(dbName, slug, lookupKey);
      const originals: Record<string, unknown> = {};
      if (originalItem) {
        for (const templateKey of Object.keys(overrides)) {
          // fm[templateKey] gives the DB config field name (e.g. "preview_image" for "image")
          const dbConfigField = fm?.[templateKey] ?? templateKey;
          const raw = originalItem[dbConfigField] ?? originalItem[templateKey];
          if (raw !== undefined && raw !== null) originals[templateKey] = raw;
        }
      }
      res.json({ overrides, originals });
    } catch (err) {
      res.status(500).json({ error: String(err) });
    }
  });

  app.get("/api/db-overrides", async (_req, res) => {
    try {
      const allConfigs = getAllConfigs(ctRoot(res));
      const IMAGE_EXT_RE = /\.(jpe?g|png|webp|gif|svg|avif|tiff?|bmp|ico)(\?[^)]*)?$/i;
      const result: Array<{ contentType: string; dbName: string; slug: string; fields: Record<string, unknown> }> = [];
      for (const [contentType, config] of Object.entries(allConfigs)) {
        const dbName = config.database?.slug;
        if (!dbName) continue;
        const overrides = getDB(res).listOverrides(dbName);
        for (const { slug, fields } of overrides) {
          const imageFields: Record<string, unknown> = {};
          for (const [key, value] of Object.entries(fields)) {
            if (typeof value === "string" && IMAGE_EXT_RE.test(value)) {
              imageFields[key] = value;
            }
          }
          if (Object.keys(imageFields).length > 0) {
            result.push({ contentType, dbName, slug, fields: imageFields });
          }
        }
      }
      res.json({ overrides: result });
    } catch (err) {
      res.status(500).json({ error: String(err) });
    }
  });

  app.delete("/api/content-types/:type/db-overrides/:slug", async (req, res) => {
    try {
      const { type, slug } = req.params;
      const rawFieldKey = req.query.field as string | undefined;
      const rawAuthor = (req.body as Record<string, unknown> | undefined)?.author;
      const authorName = rawAuthor && typeof rawAuthor === "string" ? rawAuthor : undefined;
      const config = getContentTypeConfig(type, ctRoot(res));
      if (!config?.database?.slug) {
        res.status(400).json({ error: `Content type "${type}" has no database configured` });
        return;
      }
      const dbName = config.database.slug;
      if (!getDB(res).exists(dbName)) {
        res.status(404).json({ error: `Database "${dbName}" not found` });
        return;
      }
      let fieldKey = rawFieldKey;
      if (rawFieldKey) {
        const fm = getFieldMapping(type, ctRoot(res));
        const mappedPath = fm ? fm[rawFieldKey] : undefined;
        if (mappedPath && typeof mappedPath === "string" && !mappedPath.startsWith("function:")) {
          fieldKey = mappedPath;
        }
      }
      const cleared = getDB(res).clearDbOverride(dbName, slug, fieldKey, authorName, getContentRoot(res));
      res.json({
        success: true,
        cleared,
        message: cleared
          ? rawFieldKey
            ? `Override for field "${rawFieldKey}" on "${slug}" cleared`
            : `All overrides for "${slug}" cleared`
          : `No override found for "${slug}"${rawFieldKey ? ` field "${rawFieldKey}"` : ""}`,
      });
    } catch (err) {
      res.status(500).json({ error: String(err) });
    }
  });

  app.get("/api/content-types/:type/field-provenance/:slug", async (req, res) => {
    try {
      const { type, slug } = req.params;
      const locale = String(req.query.locale || "en");
      const variant =
        typeof req.query.variant === "string" && req.query.variant.trim()
          ? req.query.variant.trim()
          : undefined;
      if (!getContentTypeConfig(type, ctRoot(res))) {
        res.status(404).json({ error: `Content type "${type}" not found` });
        return;
      }
      const result = await buildFieldProvenance({
        contentType: type,
        slug,
        locale,
        contentRoot: ctRoot(res),
        db: getDB(res),
        variant,
      });
      res.json(result);
    } catch (err) {
      res.status(500).json({ error: String(err) });
    }
  });

  app.put("/api/content-types/:type/field-overrides/:slug", async (req, res) => {
    try {
      const { type, slug } = req.params;
      const locale = String(req.body?.locale || req.query.locale || "en");
      const variantRaw = req.body?.variant ?? req.query.variant;
      const variant =
        typeof variantRaw === "string" && variantRaw.trim() ? variantRaw.trim() : undefined;
      const fields = req.body?.fields as Record<string, unknown> | undefined;
      const author = typeof req.body?.author === "string" ? req.body.author : undefined;
      if (!fields || typeof fields !== "object" || Array.isArray(fields)) {
        res.status(400).json({ error: "body.fields must be an object of field → value" });
        return;
      }
      const ctConfig = getContentTypeConfig(type, ctRoot(res));
      if (!ctConfig) {
        res.status(404).json({ error: `Content type "${type}" not found` });
        return;
      }
      let editorHints = { ...(ctConfig.editor || {}) };
      if (ctConfig.database?.slug && getDB(res).exists(ctConfig.database.slug)) {
        try {
          const dbConfig = getDB(res).get(ctConfig.database.slug) as {
            editor?: Record<string, { type?: string; schema?: unknown }>;
          };
          editorHints = { ...(dbConfig.editor || {}), ...editorHints };
        } catch {
          // ignore missing DB editor
        }
      }
      const tracking = getTrackingSettings(ctRoot(res));
      const coerced = validateAndCoerceJsonFields(fields, editorHints, {
        conversionNames: tracking.conversion_events.map((e) => e.name),
        crmTags: tracking.leads_expected_tags ?? [],
      });
      if (!coerced.ok) {
        res.status(400).json(jsonFieldFailureHttpBody(coerced.failures));
        return;
      }
      const relationCoerced = validateAndCoerceRelationFields(coerced.fields, editorHints);
      if (!relationCoerced.ok) {
        res.status(400).json(relationFieldFailureHttpBody(relationCoerced.failures));
        return;
      }
      const result = writeMappedFields(type, slug, locale, relationCoerced.fields, {
        author,
        contentRoot: ctRoot(res),
        variant,
      });
      if (!result.success) {
        res.status(result.statusCode || 400).json({
          error: result.error || "Failed to write mapped fields",
          storage: result.storage,
          path: result.relativePath,
          isVariantLayer: result.isVariantLayer,
        });
        return;
      }
      res.json({
        success: true,
        storage: result.storage,
        path: result.relativePath,
        isVariantLayer: result.isVariantLayer,
      });
    } catch (err) {
      res.status(500).json({ error: String(err) });
    }
  });

  app.delete("/api/content-types/:type/field-overrides/:slug", async (req, res) => {
    try {
      const { type, slug } = req.params;
      const locale = String(req.query.locale || "en");
      const variant =
        typeof req.query.variant === "string" && req.query.variant.trim()
          ? req.query.variant.trim()
          : undefined;
      const field = req.query.field as string | undefined;
      const author = typeof (req.body as { author?: string } | undefined)?.author === "string"
        ? (req.body as { author: string }).author
        : undefined;
      if (!field) {
        res.status(400).json({ error: "query.field is required" });
        return;
      }
      if (!getContentTypeConfig(type, ctRoot(res))) {
        res.status(404).json({ error: `Content type "${type}" not found` });
        return;
      }
      const result = clearFieldOverride(type, slug, locale, field, author, ctRoot(res), variant);
      if (!result.success) {
        res.status(result.statusCode || 400).json({
          error: result.error || "Failed to clear field",
          storage: result.storage,
          path: result.relativePath,
        });
        return;
      }
      res.json({
        success: true,
        storage: result.storage,
        path: result.relativePath,
        isVariantLayer: result.isVariantLayer,
      });
    } catch (err) {
      res.status(500).json({ error: String(err) });
    }
  });

  app.put("/api/content-types/:type/db-overrides/:slug", async (req, res) => {
    try {
      const { type, slug } = req.params;
      const fields = req.body?.fields as Record<string, unknown> | undefined;
      const author = typeof req.body?.author === "string" ? req.body.author : undefined;
      if (!fields || typeof fields !== "object" || Array.isArray(fields)) {
        res.status(400).json({ error: "body.fields must be an object of field → value" });
        return;
      }
      const config = getContentTypeConfig(type, ctRoot(res));
      if (!config?.database?.slug) {
        res.status(400).json({ error: `Content type "${type}" has no database configured` });
        return;
      }
      const dbName = config.database.slug;
      if (!getDB(res).exists(dbName)) {
        res.status(404).json({ error: `Database "${dbName}" not found` });
        return;
      }
      const lookupKey = getLookupKey(type, ctRoot(res)) || "slug";
      const fm = getFieldMapping(type, ctRoot(res));
      const fieldMapping: Record<string, string> | null = fm
        ? Object.fromEntries(
            Object.entries(fm)
              .filter(([, v]) => typeof v === "string")
              .map(([k, v]) => [k, v as string]),
          )
        : null;
      if (Object.prototype.hasOwnProperty.call(fields, "published_at")) {
        const pubVal = fields.published_at;
        if (pubVal === null || pubVal === undefined || (typeof pubVal === "string" && pubVal.trim() === "")) {
          res.status(400).json({
            error: "published_at cannot be cleared; set a non-empty datetime to backdate.",
          });
          return;
        }
      }
      let editorHints = { ...(config.editor || {}) };
      try {
        const dbConfig = getDB(res).get(dbName) as {
          editor?: Record<string, { type?: string; schema?: unknown }>;
        };
        editorHints = { ...(dbConfig.editor || {}), ...editorHints };
      } catch {
        // ignore
      }
      const tracking = getTrackingSettings(getContentRoot(res));
      const coerced = validateAndCoerceJsonFields(fields, editorHints, {
        conversionNames: tracking.conversion_events.map((e) => e.name),
        crmTags: tracking.leads_expected_tags ?? [],
      });
      if (!coerced.ok) {
        res.status(400).json(jsonFieldFailureHttpBody(coerced.failures));
        return;
      }
      const relationCoerced = validateAndCoerceRelationFields(coerced.fields, editorHints);
      if (!relationCoerced.ok) {
        res.status(400).json(relationFieldFailureHttpBody(relationCoerced.failures));
        return;
      }
      const patched = getDB(res).patchDbEntry(
        dbName,
        lookupKey,
        slug,
        relationCoerced.fields,
        fieldMapping,
        author,
        getContentRoot(res),
      );
      if (!patched) {
        res.status(404).json({ error: `No matching database entry for slug "${slug}"` });
        return;
      }
      res.json({ success: true });
    } catch (err) {
      res.status(500).json({ error: String(err) });
    }
  });

  /** Reset one field: static deletes layer root key; DB clears CT FO + DB override; seo.* clears locale seo: key. */
  app.post("/api/content-types/:type/field-reset/:slug", async (req, res) => {
    try {
      const { type, slug } = req.params;
      const field = String(req.body?.field || req.query.field || "");
      const locale = String(req.body?.locale || req.query.locale || "en");
      const variantRaw = req.body?.variant ?? req.query.variant;
      const variant =
        typeof variantRaw === "string" && variantRaw.trim() ? variantRaw.trim() : undefined;
      const author = typeof req.body?.author === "string" ? req.body.author : undefined;
      if (!field) {
        res.status(400).json({ error: "field is required" });
        return;
      }
      if (field === "published_at") {
        res.status(400).json({
          error: "published_at cannot be reset or cleared; set a non-empty datetime to backdate.",
        });
        return;
      }
      const config = getContentTypeConfig(type, ctRoot(res));
      if (!config) {
        res.status(404).json({ error: `Content type "${type}" not found` });
        return;
      }

      const isSeoField = isKnownSeoFieldPath(field) || field === "seo.pillar";
      const resetCap = isSeoField ? "seo_edit" : "content_edit_text";
      const auth = await requireCapability(req, res, resetCap, type);
      if (!auth.authorized) return;

      if (isSeoField) {
        const fieldPath = field === "seo.pillar" ? "seo.pillar_path" : field;
        let dbItem: Record<string, unknown> | null = null;
        const dbName = config.database?.slug;
        if (dbName && getDB(res).exists(dbName)) {
          const lookupKey = getLookupKey(type, ctRoot(res)) || "slug";
          const localeKey = getLocaleKey(type, ctRoot(res)) || "locale";
          const cached = await getDB(res).fetchItems(dbName);
          const items = cached.items as Record<string, unknown>[];
          const loc = locale.toLowerCase();
          dbItem =
            items.find((i) => {
              if (String(i[lookupKey] ?? "") !== slug) return false;
              const fromItem = i[localeKey] ?? i.locale ?? i.lang;
              return typeof fromItem === "string" && fromItem.trim().toLowerCase() === loc;
            }) ??
            items.find((i) => String(i[lookupKey] ?? "") === slug) ??
            null;
        }
        const { resetSeoOverlayField } = await import("../seo-index");
        const result = resetSeoOverlayField({
          contentType: type,
          slug,
          locale,
          fieldPath,
          author,
          contentRoot: ctRoot(res),
          variant,
          dbItem,
        });
        if (!result.success) {
          res.status(result.statusCode || 400).json({
            error: result.error || "Failed to reset SEO field",
            noop: result.noop,
          });
          return;
        }
        res.json({
          success: true,
          path: result.relativePath,
          noop: result.noop,
          message: result.noop ? result.error : undefined,
          isVariantLayer: result.isVariantLayer,
          indexRebuilt: result.indexRebuilt,
        });
        return;
      }

      if (!config.database?.slug) {
        const result = resetStaticMappedField({
          contentType: type,
          slug,
          locale,
          field,
          author,
          contentRoot: ctRoot(res),
          variant,
        });
        if (!result.success) {
          res.status(result.statusCode || 400).json({
            error: result.error || "Failed to reset field",
            storage: result.storage,
            path: result.relativePath,
            noop: result.noop,
          });
          return;
        }
        res.json({
          success: true,
          storage: result.storage,
          path: result.relativePath,
          noop: result.noop,
          message: result.noop ? result.error : undefined,
          isVariantLayer: result.isVariantLayer,
        });
        return;
      }

      const cleared = clearFieldOverride(type, slug, locale, field, author, ctRoot(res), variant);

      const dbName = config.database.slug;
      if (getDB(res).exists(dbName)) {
        const fm = getFieldMapping(type, ctRoot(res));
        let fieldKey: string | undefined = field;
        const mappedPath = fm?.[field];
        if (mappedPath && typeof mappedPath === "string" && !mappedPath.startsWith("function:")) {
          fieldKey = mappedPath.startsWith("?") ? mappedPath.slice(1) : mappedPath;
        }
        getDB(res).clearDbOverride(dbName, slug, fieldKey, author, getContentRoot(res));
        getDB(res).clearCache(dbName);
        await getDB(res).fetchItems(dbName, true).catch(() => {});
      }

      res.json({
        success: true,
        storage: "field_overrides",
        path: cleared.relativePath,
      });
    } catch (err) {
      res.status(500).json({ error: String(err) });
    }
  });

  app.post("/api/content-types/:type/entries/:slug/migrate-legacy", async (req, res) => {
    try {
      const { type, slug } = req.params;
      const config = getContentTypeConfig(type, ctRoot(res));
      if (!config) {
        res.status(400).json({ error: `Unknown content type "${type}"` });
        return;
      }
      const dir = path.join(getContentRoot(res), config.directory, slug);
      const promotedPath = path.join(dir, "promoted.yml");
      if (!fs.existsSync(promotedPath)) {
        res.status(400).json({ error: "Not a legacy entry — promoted.yml not found" });
        return;
      }
      const commonPath = path.join(dir, "_common.yml");
      let locale = "en";
      if (fs.existsSync(commonPath)) {
        const commonData = safeYamlLoad(fs.readFileSync(commonPath, "utf-8")) as Record<string, unknown> | null;
        if (commonData?.locale && typeof commonData.locale === "string") {
          locale = commonData.locale.trim().replace(/^["']|["']$/g, "");
        }
      }
      const destPath = path.join(dir, `${locale}.yml`);
      if (fs.existsSync(destPath)) {
        res.status(409).json({ error: `Already migrated — ${locale}.yml already exists` });
        return;
      }
      fs.renameSync(promotedPath, destPath);
      getCI(res).refresh();
      clearSitemapCache();
      invalidateContentCaches(type, getCI(res));
      res.json({ success: true, locale, newFile: `${locale}.yml` });
    } catch (err) {
      res.status(500).json({ error: String(err) });
    }
  });

  /** Detach a shared-layout entry from the type template (bake live single structure). */
  app.post("/api/content/:type/:slug/detach", async (req, res) => {
    try {
      const { type, slug } = req.params;
      const auth = await requireCapability(req, res, "content_edit_structure", type);
      if (!auth.authorized) return;

      if (!isValidType(type, ctRoot(res))) {
        res.status(400).json({ error: `Unknown content type "${type}"` });
        return;
      }
      if (!isSharedLayoutType(type, getContentRoot(res))) {
        res.status(400).json({ error: `Content type "${type}" is not a shared-layout type` });
        return;
      }

      const locales = Array.isArray(req.body?.locales)
        ? (req.body.locales as unknown[]).filter((l): l is string => typeof l === "string")
        : undefined;

      const result = detachEntry({
        contentType: type,
        slug,
        contentRoot: getContentRoot(res),
        author: auth.author,
        locales,
      });

      getCI(res).refresh();
      invalidateContentCaches(type, getCI(res));

      res.json({ success: true, detached: true, ...result });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      const status =
        msg.includes("already detached") ||
        msg.includes("not a shared-layout") ||
        msg.includes("Invalid entry") ||
        msg.includes("Unknown content type") ||
        msg.includes("No live single") ||
        msg.includes("no live locale files")
          ? 400
          : 500;
      res.status(status).json({ error: msg });
    }
  });

  /** Hard re-attach: strip sections/layout, clear entry versioning, resume shared template. */
  app.post("/api/content/:type/:slug/reattach", async (req, res) => {
    try {
      const { type, slug } = req.params;
      const auth = await requireCapability(req, res, "content_edit_structure", type);
      if (!auth.authorized) return;

      if (!isValidType(type, ctRoot(res))) {
        res.status(400).json({ error: `Unknown content type "${type}"` });
        return;
      }
      if (!isSharedLayoutType(type, getContentRoot(res))) {
        res.status(400).json({ error: `Content type "${type}" is not a shared-layout type` });
        return;
      }

      const confirm = req.body?.confirm === true;
      try {
        const result = reattachEntry({
          contentType: type,
          slug,
          contentRoot: getContentRoot(res),
          author: auth.author,
          confirm,
        });

        getCI(res).refresh();
        invalidateContentCaches(type, getCI(res));

        res.json({ success: true, detached: false, ...result });
      } catch (err) {
        if (err instanceof ReattachRequiredFieldsError) {
          res.status(400).json({
            error: err.message,
            code: err.code,
            missing_fields: err.missing_fields,
            per_locale: err.per_locale,
          });
          return;
        }
        throw err;
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      const status =
        msg.includes("confirm") ||
        msg.includes("not detached") ||
        msg.includes("not a shared-layout") ||
        msg.includes("Invalid entry") ||
        msg.includes("Unknown content type") ||
        msg.includes("not found") ||
        msg.includes("reattach_missing_required")
          ? 400
          : 500;
      res.status(status).json({ error: msg });
    }
  });

  /** Attach/detach status for shared-layout entries (DebugBubble / editors). */
  app.get("/api/content/:type/:slug/attach-status", (req, res) => {
    try {
      const { type, slug } = req.params;
      if (!isValidType(type, ctRoot(res))) {
        res.status(400).json({ error: `Unknown content type "${type}"` });
        return;
      }
      const root = getContentRoot(res);
      const shared = isSharedLayoutType(type, root);
      const detached = shared ? isEntryDetached(type, slug, root) : false;
      const locale = normalizeLocale((req.query.locale as string) || "en");
      const payload: Record<string, unknown> = {
        isSharedLayout: shared,
        detached,
      };
      if (shared && detached) {
        const preview = getReattachSectionLossPreview({
          contentType: type,
          slug,
          locale,
          contentRoot: root,
        });
        payload.sectionsThatWillBeLost = preview.sectionsThatWillBeLost;
        payload.variantsThatWillBeLost = preview.variantsThatWillBeLost;
        payload.hasLayoutOverride = preview.hasLayoutOverride;
        payload.locale = locale;
      }
      res.json(payload);
    } catch (err) {
      res.status(500).json({ error: String(err) });
    }
  });

  app.post("/api/content-types/:type/ai/analyze-fields", async (req, res) => {
    try {
      const { sample_posts } = req.body || {};
      if (
        !sample_posts ||
        !Array.isArray(sample_posts) ||
        sample_posts.length === 0
      ) {
        res.status(400).json({ error: "sample_posts array is required" });
        return;
      }

      const { getLLMService } = await import("../ai/LLMService");
      const llm = getLLMService();

      const samples = sample_posts.slice(0, 3);
      const truncated = JSON.stringify(samples, null, 2).slice(0, 8000);
      const contentTypeName = req.params.type;

      const systemPrompt = `You are a data analyst. Given sample data objects from an API, identify which fields map to standard content properties. Only map fields that actually exist in the data.

Respond with valid JSON only, no markdown.`;

      const userPrompt = `Analyze these sample "${contentTypeName}" objects and map their fields to standard properties:

${truncated}

Return JSON with this exact structure:
{
  "field_mapping": {
    "title": "<source field name or dot.path>",
    "slug": "<source field name or dot.path>",
    "description": "<source field name or dot.path or null>",
    "image": "<source field name or dot.path or null>",
    "author": "<source field name or dot.path or null>",
    "published_at": "<source field name or dot.path or null>",
    "_updated_at": "<source field name or dot.path for last-modified date or null>",
    "status": "<source field name or dot.path or null>",
    "category": "<source field name or dot.path or null>",
    "tags": "<source field name or dot.path or null>",
    "lang": "<source field name or dot.path or null>",
    "content": "<source field name or dot.path to body/markdown/html content or null>",
    "content_url": "<source field name or dot.path to markdown/content URL or null>"
  },
  "available_fields": ["<all top-level and notable nested fields found>"],
  "notes": "<any observations about the data structure>"
}

Important: Only include mappings where you are confident the field exists. Use dot notation for nested fields (e.g. "author.name"). Blog category is a plain string field, not category.slug.`;

      const result = await llm.complete(userPrompt, {
        systemPrompt,
        temperature: 0.1,
        maxTokens: 1500,
      });

      let parsed;
      try {
        const cleaned = result
          .replace(/```json?\n?/g, "")
          .replace(/```\n?/g, "")
          .trim();
        parsed = JSON.parse(cleaned);
      } catch {
        parsed = { raw: result, error: "Failed to parse AI response" };
      }

      res.json(parsed);
    } catch (err) {
      log.error({ err: err }, "AI analyze-fields error:");
      res.status(500).json({ error: String(err) });
    }
  });

  // ── End Generic Content Type API Routes ──

  app.post("/api/blog/ai/analyze-response", async (req, res) => {
    try {
      const { sample_payload } = req.body || {};
      if (!sample_payload) {
        res.status(400).json({ error: "sample_payload is required" });
        return;
      }

      const { getLLMService } = await import("../ai/LLMService");
      const llm = getLLMService();

      const truncated = JSON.stringify(sample_payload).slice(0, 8000);

      const systemPrompt = `You are an API response analyst. Given a JSON API response, determine:
1. The dot-notation path to the array of items (posts/articles). If the response IS a direct array, use empty string "".
2. Whether pagination is present, and if so what type (offset-based, cursor-based, page-based, or none).
3. The pagination metadata fields and how to use them.

Respond with valid JSON only, no markdown.`;

      const userPrompt = `Analyze this API response and determine the data extraction path and pagination strategy:

${truncated}

Return JSON with this exact structure:
{
  "results_path": "<dot.path to array or empty string if direct array>",
  "array_length": <number of items found>,
  "pagination": {
    "type": "none" | "offset" | "cursor" | "page",
    "has_more_field": "<field name or null>",
    "total_field": "<field name indicating total count or null>",
    "next_field": "<field with next page URL or cursor or null>",
    "strategy_description": "<human-readable description of how to paginate>"
  },
  "sample_item_keys": ["<list of top-level keys from first item>"]
}`;

      const result = await llm.complete(userPrompt, {
        systemPrompt,
        temperature: 0.1,
        maxTokens: 1000,
      });

      let parsed;
      try {
        const cleaned = result
          .replace(/```json?\n?/g, "")
          .replace(/```\n?/g, "")
          .trim();
        parsed = JSON.parse(cleaned);
      } catch {
        parsed = { raw: result, error: "Failed to parse AI response" };
      }

      res.json(parsed);
    } catch (err) {
      log.error({ err: err }, "AI analyze-response error:");
      res.status(500).json({ error: String(err) });
    }
  });

  app.post("/api/blog/ai/analyze-fields", async (req, res) => {
    try {
      const { sample_posts } = req.body || {};
      if (
        !sample_posts ||
        !Array.isArray(sample_posts) ||
        sample_posts.length === 0
      ) {
        res.status(400).json({ error: "sample_posts array is required" });
        return;
      }

      const { getLLMService } = await import("../ai/LLMService");
      const llm = getLLMService();

      const samples = sample_posts.slice(0, 3);
      const truncated = JSON.stringify(samples, null, 2).slice(0, 8000);

      const systemPrompt = `You are a blog post data analyst. Given sample blog post objects from an API, identify which fields map to standard blog post properties. Only map fields that actually exist in the data.

Respond with valid JSON only, no markdown.`;

      const userPrompt = `Analyze these sample blog post objects and map their fields to standard properties:

${truncated}

Return JSON with this exact structure:
{
  "field_mapping": {
    "title": "<source field name or dot.path>",
    "slug": "<source field name or dot.path>",
    "description": "<source field name or dot.path or null>",
    "image": "<source field name or dot.path or null>",
    "author": "<source field name or dot.path or null>",
    "published_at": "<source field name or dot.path or null>",
    "_updated_at": "<source field name or dot.path for last-modified date or null>",
    "status": "<source field name or dot.path or null>",
    "category": "<source field name or dot.path or null>",
    "tags": "<source field name or dot.path or null>",
    "lang": "<source field name or dot.path or null>",
    "content": "<source field name or dot.path to body/markdown/html content or null>",
    "content_url": "<source field name or dot.path to markdown/content URL or null>"
  },
  "available_fields": ["<all top-level and notable nested fields found>"],
  "notes": "<any observations about the data structure>"
}

Important: Only include mappings where you are confident the field exists. Use dot notation for nested fields (e.g. "author.name"). Blog category is a plain string field, not category.slug.`;

      const result = await llm.complete(userPrompt, {
        systemPrompt,
        temperature: 0.1,
        maxTokens: 1500,
      });

      let parsed;
      try {
        const cleaned = result
          .replace(/```json?\n?/g, "")
          .replace(/```\n?/g, "")
          .trim();
        parsed = JSON.parse(cleaned);
      } catch {
        parsed = { raw: result, error: "Failed to parse AI response" };
      }

      res.json(parsed);
    } catch (err) {
      log.error({ err: err }, "AI analyze-fields error:");
      res.status(500).json({ error: String(err) });
    }
  });

  /**
   * Compat shim. Testimonials sections now resolve through `dynamic_entries` over
   * the `testimonials` database, so this reads the same merged bank and filters by
   * locale. Kept only for staff pickers that still ask per locale; remove once
   * nothing calls it. Falls back to the deprecated flat `testimonials/{locale}.yml`
   * on content roots that have not been migrated yet.
   */
  app.get("/api/testimonials/:locale", async (req, res) => {
    const { locale } = req.params;
    const normalizedLocale = normalizeLocale(locale);

    if (getDB(res).exists(TESTIMONIALS_DATABASE)) {
      try {
        const { items } = await getDB(res).fetchItems(TESTIMONIALS_DATABASE);
        const testimonials = items.filter(
          (item) => String((item as Record<string, unknown>).locale ?? "") === normalizedLocale,
        );
        res.json({ testimonials, source: `db/${TESTIMONIALS_DATABASE}` });
        return;
      } catch (error) {
        log.error({ err: error }, "Error loading testimonials from database:");
        // fall through to the flat bank so staff UIs keep working
      }
    }

    const testimonialsPath = path.join(
      getContentRoot(res),
      "testimonials",
      `${normalizedLocale}.yml`,
    );

    if (!fs.existsSync(testimonialsPath)) {
      res.status(404).json({ error: "Testimonials not found for locale" });
      return;
    }

    try {
      const content = fs.readFileSync(testimonialsPath, "utf8");
      const data = safeYamlLoad(content) as unknown[];
      res.json({ testimonials: data || [], source: "flat-yaml" });
    } catch (error) {
      log.error({ err: error }, "Error loading testimonials:");
      res.status(500).json({ error: "Failed to load testimonials" });
    }
  });

}
