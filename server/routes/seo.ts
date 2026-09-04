import type { Express, Request, Response } from "express";
import { getDefaultContentRoot, getDefaultContentFolder } from "../site-config";
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
  getDebugSitemapUrls,
  invalidateSitemapEntry,
  invalidateSitemapEntriesByContentKey,
  refreshSitemapEntry,
  refreshSitemapEntriesForContentKey,
  type ActiveSiteCtx,
  toActiveSiteCtx,
} from "../sitemap";
import { filterSitemapUrlsByLocale } from "../sitemap-locale";
import type { SiteContext } from "../site-manager";
import { markFileAsModified } from "../sync-state";
import { deepMerge } from "../utils/deepMerge";
import { regenerateSectionIds } from "../utils/regenerateSectionIds";
import { databaseManager, type DatabaseManager } from "../database";
import {
  redirectMiddleware,
  getRedirects,
  clearRedirectCache,
  testRedirect,
} from "../redirects";
import {
  getSchema,
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
  hasDatabaseSingle,
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
  resolveEntryUpdatedAt,
} from "../content-types";
import { resolveFieldValue, applyTransformIfNeeded } from "../transform";
import { resolveAllTemplateVars } from "../resolve-template-vars";
import {
  normalizeLocale,
  getSupportedLocales,
  getDefaultLocale,
  getLocaleEntries,
  updateLocaleSettings,
  getHomePage,
  getOptimizationSettings,
  updateOptimizationSettings,
  getRobotsSettings,
  buildRobotsTxtContent,
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
  resolvePageRobots,
} from "../ssr-schema";
import { collectSectionSchemasDetailed } from "../schema-components";
import {
  getSchemaOrgType,
  hasSchemaOrgContributors,
  isSchemaOrgSection,
} from "@shared/schema-org-sections";
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
  DEFAULT_DRAFT_VARIANT,
  findSourceDraftVariant,
  getEntryContentDir,
  hasLiveLocaleFile,
  listVariantSlugsForLocale,
} from "../draft-entry";


import {

  BREATHECODE_HOST,
  extractToken,
  requireCapability,
  requireAnyCapability,
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
  requireStaffSession,
} from "./_helpers";
import { child } from "../logger";
import { api } from "../rate-limit/api";
import {
  assertInspectBatch,
  buildSummary,
  getGscConfig,
  getRecord,
  gscPropertyAccessFromRecords,
  isStale,
  hasMainSeoKeyword,
  homepageLocFromDebug,
  inspectAndStore,
  isPreviewLoc,
  listGscSites,
  loadStore,
  pullGscInspectionStoreFromBucket,
  resolvePublicInspectLoc,
  sitemapHostMatchesGsc,
  suggestedGscSiteUrl,
} from "../gsc-url-inspection";
import {
  enqueueGscInspects,
  getGscInspectQueueStats,
  cancelGscInspects,
  GscInspectAlreadyRunningError,
  type GscInspectMode,
} from "../gsc-inspect-queue";
import { renderHubHtml } from "../render-hub-html";
import { findMissingMemberLinks } from "../cluster-hub-links";
import { readFunnelBlockFromFile, commonYmlPath } from "../funnel-fields";
import { toSitemapLastmod } from "@shared/normalizeFlexibleDate";

const log = child({ module: "routes/seo" });

/** Returns the per-site ContentIndex for this request, falling back to the global singleton in single-site mode. */
function getCI(res: Response): typeof contentIndex {
  return (res.locals.site as any)?.contentIndex ?? contentIndex;
}
function getContentRoot(res: Response): string {
  return (res.locals.site as any)?.contentRoot ?? getDefaultContentRoot();
}
function getContentRootName(res: Response): string {
  return (res.locals.site as any)?.contentRootName ?? (getDefaultContentFolder());
}
function getDB(res: Response): DatabaseManager {
  return (res.locals.site as SiteContext | undefined)?.database ?? databaseManager;
}
function getSiteSitemapCtx(res: Response): ActiveSiteCtx | undefined {
  const site = res.locals.site as SiteContext | undefined;
  if (!site?.contentIndex || !site?.contentRootName || !site?.database) return undefined;
  return toActiveSiteCtx(site);
}

function clusterMemberFromIndex(
  id: string,
  row?: {
    slug?: string;
    content_type?: string;
    locale?: string;
    path?: string;
    main_keyword?: string | null;
    file?: string;
  },
) {
  const parts = id.split("/");
  const contentType = row?.content_type || parts[0] || "";
  const locale = row?.locale || parts[parts.length - 1] || "";
  const slug =
    row?.slug || (parts.length >= 3 ? parts.slice(1, -1).join("/") : parts[1] || id);
  return {
    id,
    slug,
    contentType,
    locale,
    path: row?.path || "",
    keyword: row?.main_keyword ?? null,
    file: row?.file || "",
  };
}

function metaRecord(data: Record<string, unknown> | null | undefined): Record<string, unknown> {
  const meta = data?.meta;
  if (meta && typeof meta === "object" && !Array.isArray(meta)) {
    return { ...(meta as Record<string, unknown>) };
  }
  return {};
}

type SeoContextOption =
  | { type: "live" }
  | { type: "variant"; variant: string };

function listSeoContextsForLocale(
  contentType: string,
  slug: string,
  locale: string,
  contentRoot: string,
): { contexts: SeoContextOption[]; default: SeoContextOption | null } {
  const dir = getEntryContentDir(contentType, slug, contentRoot);
  const contexts: SeoContextOption[] = [];
  if (hasLiveLocaleFile(dir, locale)) {
    contexts.push({ type: "live" });
  }
  for (const variant of listVariantSlugsForLocale(dir, locale)) {
    contexts.push({ type: "variant", variant });
  }
  let defaultCtx: SeoContextOption | null = null;
  if (contexts.some((c) => c.type === "live")) {
    defaultCtx = { type: "live" };
  } else if (contexts.some((c) => c.type === "variant" && c.variant === DEFAULT_DRAFT_VARIANT)) {
    defaultCtx = { type: "variant", variant: DEFAULT_DRAFT_VARIANT };
  } else if (contexts.length > 0) {
    defaultCtx = contexts[0];
  }
  return { contexts, default: defaultCtx };
}

export function registerSeoRoutes(app: Express): void {
  // Dynamic robots.txt — uses SITE_URL at request time so staging and production
  // always point to the correct sitemap domain. Registered before static-file
  // middleware so this route takes precedence over public/robots.txt.
  app.get("/robots.txt", (req, res) => {
    function getRobotsBaseUrl(): string {
      if (process.env.SITE_URL) return process.env.SITE_URL.replace(/\/$/, "");
      if (process.env.REPLIT_DEV_DOMAIN) return `https://${process.env.REPLIT_DEV_DOMAIN}`;
      return "http://localhost:5000";
    }
    const baseUrl = getRobotsBaseUrl();
    const robots = getRobotsSettings(getContentRoot(res));
    const content = buildRobotsTxtContent(robots, baseUrl);
    res.set("Content-Type", "text/plain");
    res.set("Cache-Control", "public, max-age=3600");
    res.send(content);
  });

  // Dynamic sitemap with caching
  app.get("/sitemap.xml", (req, res) => {
    const siteCtx = getSiteSitemapCtx(res);
    const xml = getSitemap(siteCtx);
    res.set("Content-Type", "application/xml");
    res.set("Cache-Control", "public, max-age=3600"); // Browser cache for 1 hour
    res.send(xml);
  });

  // Get Breathecode host configuration (for debug tools)
  app.get("/api/debug/breathecode-host", (req, res) => {
    const defaultHost = "https://breathecode.herokuapp.com";
    res.json({
      host: BREATHECODE_HOST,
      isDefault: BREATHECODE_HOST === defaultHost,
    });
  });

  // Sitemap cache status (for debug tools)
  app.get("/api/debug/sitemap-cache-status", (req, res) => {
    const siteCtx = getSiteSitemapCtx(res);
    const status = getSitemapCacheStatus();
    if (siteCtx) {
      const urls = getSitemapUrls(siteCtx);
      res.json({ ...status, entryCount: urls.length });
    } else {
      res.json(status);
    }
  });

  // Sitemap URLs as JSON (for debug tools) — includes excluded + drafts
  app.get("/api/debug/sitemap-urls", (req, res) => {
    const urls = getDebugSitemapUrls(getSiteSitemapCtx(res));
    res.json(urls);
  });

  app.get("/api/debug/gsc-inspection", (req, res) => {
    const contentRootName = getContentRootName(res);
    const siteCtx = getSiteSitemapCtx(res);
    const debugUrls = getDebugSitemapUrls(siteCtx);
    const contentRoot = getContentRoot(res);
    const cfg = getGscConfig(contentRoot);
    const store = loadStore(contentRootName);
    const summary = buildSummary(store.records, debugUrls);
    const sampleLoc = homepageLocFromDebug(debugUrls);
    const siteUrlMatch = sitemapHostMatchesGsc(sampleLoc ?? undefined, cfg.siteUrl);
    const urlParam = typeof req.query.url === "string" ? req.query.url.trim() : "";
    const includeRecords = req.query.include === "records";
    const site = res.locals.site as SiteContext | undefined;

    const payload: Record<string, unknown> = {
      configured: cfg.configured,
      siteUrl: cfg.siteUrl,
      suggestedSiteUrl: suggestedGscSiteUrl(site?.config?.domain),
      credentialsConfigured: cfg.credentialsConfigured,
      credentialsSource: cfg.credentialsSource,
      credentialsEnvVar: cfg.credentialsEnvVar,
      serviceAccountEmail: cfg.serviceAccountEmail,
      propertyAccess: gscPropertyAccessFromRecords(store.records),
      siteUrlMatch,
      homepageLoc: sampleLoc,
      summary,
    };

    if (urlParam) {
      const resolved = resolvePublicInspectLoc(urlParam, debugUrls);
      payload.resolved = {
        requested: urlParam,
        loc: resolved.loc,
        inSitemap: resolved.inSitemap,
        isDraft: resolved.isDraft,
        isPreview: isPreviewLoc(urlParam),
      };
      payload.record = resolved.loc ? getRecord(contentRootName, resolved.loc) ?? null : null;
    } else if (includeRecords) {
      payload.records = store.records;
    }

    res.json(payload);
  });

  app.get("/api/debug/gsc-inspection/sites", async (_req, res) => {
    const cfg = getGscConfig(getContentRoot(res));
    if (!cfg.credentialsConfigured) {
      res.status(503).json({
        error:
          "Search Console credentials are not configured. Set GCS_CREDENTIALS_JSON or GCS_KEY_FILENAME.",
        sites: [],
      });
      return;
    }
    try {
      const sites = await listGscSites();
      res.json({
        sites,
        serviceAccountEmail: cfg.serviceAccountEmail,
      });
    } catch (err) {
      log.error({ err }, "GSC sites.list failed");
      res.status(502).json({
        error: err instanceof Error ? err.message : "Failed to list Search Console properties",
        sites: [],
      });
    }
  });

  app.post("/api/debug/gsc-inspection", async (req, res) => {
    try {
      const auth = await requireCapability(req, res, "seo_settings");
      if (!auth.authorized) return;

      const contentRoot = getContentRoot(res);
      const cfg = getGscConfig(contentRoot);
      if (!cfg.configured) {
        res.status(503).json({
          error:
            "Search Console is not configured. Save a property in SEO/GEO → Search Console and set GCS_CREDENTIALS_JSON or GCS_KEY_FILENAME.",
        });
        return;
      }

      const urls = req.body?.urls as unknown;
      const force = Boolean(req.body?.force);
      const batchError = assertInspectBatch(urls);
      if (batchError) {
        res.status(400).json({ error: batchError });
        return;
      }

      const contentRootName = getContentRootName(res);
      const debugUrls = getDebugSitemapUrls(getSiteSitemapCtx(res));
      const results = await inspectAndStore({
        contentRootName,
        contentRoot,
        urls: (urls as string[]).map((u) => u.trim()),
        force,
        debugUrls,
      });
      const store = loadStore(contentRootName);
      res.json({
        results,
        summary: buildSummary(store.records, debugUrls),
      });
    } catch (err) {
      log.error({ err }, "GSC inspect failed");
      res.status(500).json({ error: err instanceof Error ? err.message : "Inspect failed" });
    }
  });

  app.get("/api/debug/gsc-inspection/queue", (_req, res) => {
    res.json(getGscInspectQueueStats());
  });

  app.post("/api/debug/gsc-inspection/cancel", async (req, res) => {
    try {
      const auth = await requireCapability(req, res, "seo_settings");
      if (!auth.authorized) return;

      const result = cancelGscInspects();
      res.json({
        success: true,
        stopped: result.stopped,
        queue: result.queue,
        message: result.stopped
          ? "Inspect stopped. Rows already written were kept. Use Never inspected to continue missing URLs."
          : "No inspect job was running.",
      });
    } catch (err) {
      log.error({ err }, "GSC inspect cancel failed");
      res.status(500).json({ error: err instanceof Error ? err.message : "Cancel failed" });
    }
  });

  /** Dev-only: overwrite local .cache sidecar with the production GCS copy (no Google inspect calls). */
  app.post("/api/debug/gsc-inspection/pull-from-gcs", async (req, res) => {
    try {
      if (process.env.NODE_ENV === "production") {
        res.status(403).json({
          error: "Pulling the production Search Console cache is only available in development.",
          code: "dev_only",
        });
        return;
      }

      const auth = await requireCapability(req, res, "seo_settings");
      if (!auth.authorized) return;

      const contentRootName = getContentRootName(res);
      const result = await pullGscInspectionStoreFromBucket(contentRootName);
      if (result.source !== "gcs") {
        res.status(404).json({
          error:
            result.source === "empty"
              ? "No Search Console inspection sidecar found in GCS (and no local file)."
              : "Could not download from GCS — kept or fell back to the local sidecar. Check GCS_BUCKET_NAME and credentials.",
          code: "gcs_pull_failed",
          ...result,
        });
        return;
      }

      res.json({
        success: true,
        ...result,
        message: `Loaded ${result.recordCount} inspection row(s) from ${result.gcsKey} into local .cache.`,
      });
    } catch (err) {
      log.error({ err }, "GSC pull-from-gcs failed");
      res.status(500).json({ error: err instanceof Error ? err.message : "Pull from GCS failed" });
    }
  });

  app.post("/api/debug/gsc-inspection/enqueue", async (req, res) => {
    try {
      const auth = await requireCapability(req, res, "seo_settings");
      if (!auth.authorized) return;

      const contentRoot = getContentRoot(res);
      const cfg = getGscConfig(contentRoot);
      if (!cfg.configured) {
        res.status(503).json({
          error:
            "Search Console is not configured. Save a property in SEO/GEO → Search Console and set GCS_CREDENTIALS_JSON or GCS_KEY_FILENAME.",
        });
        return;
      }

      const mode = req.body?.mode as unknown;
      if (mode !== "never" && mode !== "stale" && mode !== "all") {
        res.status(400).json({ error: "mode must be \"never\", \"stale\", or \"all\"" });
        return;
      }

      const contentRootName = getContentRootName(res);
      const debugUrls = getDebugSitemapUrls(getSiteSitemapCtx(res));
      const result = enqueueGscInspects({
        mode: mode as GscInspectMode,
        contentRoot,
        contentRootName,
        debugUrls,
      });
      res.status(202).json(result);
    } catch (err) {
      if (err instanceof GscInspectAlreadyRunningError) {
        res.status(409).json({
          error: err.message,
          code: err.code,
          queue: err.queue,
        });
        return;
      }
      log.error({ err }, "GSC inspect enqueue failed");
      res.status(500).json({ error: err instanceof Error ? err.message : "Enqueue failed" });
    }
  });

  // Public sitemap URLs endpoint for menu editor
  app.get("/api/sitemap-urls", (req, res) => {
    const locale = req.query.locale as string | undefined;
    const urls = getSitemapUrls(getSiteSitemapCtx(res));
    res.json(filterSitemapUrlsByLocale(urls, locale));
  });

  // Returns sections for a given page path — used by LinkPicker's Section/Modal tabs
  // when a contextPath is set (e.g. in per-page CTA override rows)
  app.get("/api/page-sections", async (req, res) => {
    try {
      const pagePath = req.query.path as string;

      if (!pagePath) {
        res.status(400).json({ error: "Missing path query parameter", sections: [] });
        return;
      }

      const normalizedPath = normalizeUrl(pagePath);
      const resolved = getCI(res).resolveUrl(normalizedPath);

      let effectiveLocale = (req.query.locale as string) || "en";
      if (resolved && !req.query.locale && resolved.patternLocale) {
        effectiveLocale =
          resolved.patternLocale === "default" ? "en" : resolved.patternLocale;
      }

      let rawData: Record<string, unknown> | null = null;

      if (resolved && !resolved.fromDatabase) {
        const merged = getCI(res).loadMergedContent(
          resolved.contentType,
          resolved.slug,
          effectiveLocale,
        );
        if (merged.data) {
          rawData = merged.data;
        }
      }

      if (!rawData) {
        const service = getValidationService();
        let context = service.getContext();
        if (!context) {
          context = await service.buildContext();
        }

        const matchingFiles = (context.contentFiles as any[]).filter(
          (f: any) => normalizeUrl(getCanonicalUrl(f)) === normalizedPath,
        );

        const file =
          matchingFiles.find((f: any) => f.locale === effectiveLocale) ||
          matchingFiles.find((f: any) => f.locale !== "_common") ||
          matchingFiles[0] ||
          null;

        if (!file) {
          res.json({ sections: [] });
          return;
        }

        rawData = {};
        try {
          const commonPath = path.join(path.dirname(file.filePath), "_common.yml");
          if (fs.existsSync(commonPath)) {
            const commonData =
              (safeYamlLoad(fs.readFileSync(commonPath, "utf-8")) as Record<string, unknown>) || {};
            rawData = { ...commonData };
          }
          if (fs.existsSync(file.filePath)) {
            const localeData =
              (safeYamlLoad(fs.readFileSync(file.filePath, "utf-8")) as Record<string, unknown>) || {};
            rawData = { ...rawData, ...localeData };
          }
        } catch {}
      }

      const includeYaml = req.query.includeYaml === "true";
      const rawSections = (rawData.sections as any[]) || [];
      const sections = rawSections
        .filter((s: any) => s?.type)
        .map((s: any, index: number) => {
          const base: Record<string, unknown> = {
            type: s.type as string,
            section_id: (s.section_id as string) || null,
            label:
              (s.title as string) ||
              (s.heading as string) ||
              `${s.type} (section ${index + 1})`,
          };
          if (includeYaml) {
            base.yamlContent = safeYamlDump([s], { lineWidth: -1 });
          }
          return base;
        });

      res.json({ sections });
    } catch (e) {
      res.status(500).json({ error: String(e), sections: [] });
    }
  });

  // ============================================================================
  // Blog API routes
  // ============================================================================
  app.get("/api/seo/overview", async (req, res) => {
    try {
      const entries = getCI(res).listAll();

      const intentDistribution: Record<string, Record<string, number>> = {};
      const funnelStageSeen = new Set<string>();
      const featureCoverage: Record<string, number> = {};
      const faqCoverage: { slug: string; contentType: string; locale: string; faqCount: number }[] = [];
      const schemaCoverage: Record<string, number> = {};

      let totalPages = 0;
      let withIntent = 0;
      let withFocusFeatures = 0;
      let withFaq = 0;
      let withSchema = 0;
      let withKeyword = 0;

      for (const entry of entries) {
        const ct = entry.contentType;
        const slugKey = `${ct}/${entry.slug}`;
        if (!funnelStageSeen.has(slugKey)) {
          funnelStageSeen.add(slugKey);
          const funnel = readFunnelBlockFromFile(
            commonYmlPath(ct, entry.slug, getContentRoot(res)),
          );
          const stage =
            typeof funnel.stage === "string" && funnel.stage.trim()
              ? funnel.stage.trim()
              : "unknown";
          if (!intentDistribution[ct]) intentDistribution[ct] = {};
          intentDistribution[ct][stage] = (intentDistribution[ct][stage] || 0) + 1;
          if (stage !== "unknown") withIntent++;
        }

        for (const locale of entry.locales) {
          if (locale.startsWith("_") || locale.includes(".")) continue;
          totalPages++;

          const merged = getCI(res).loadMergedContent(ct, entry.slug, locale);
          if (!merged.data) continue;
          const data = merged.data as Record<string, unknown>;

          const seo = data.seo as Record<string, unknown> | undefined;
          const sections = data.sections as { type?: string }[] | undefined;

          const focusFeatures = Array.isArray(seo?.focus_features)
            ? (seo!.focus_features as string[]).filter((f) => typeof f === "string")
            : [];

          if (hasMainSeoKeyword(data)) withKeyword++;

          if (focusFeatures.length > 0) {
            withFocusFeatures++;
            for (const f of focusFeatures) {
              featureCoverage[f] = (featureCoverage[f] || 0) + 1;
            }
          }

          if (Array.isArray(sections)) {
            const faqSections = sections.filter((s) => s?.type === "faq");
            if (faqSections.length > 0) {
              withFaq++;
              faqCoverage.push({
                slug: entry.slug,
                contentType: ct,
                locale,
                faqCount: faqSections.length,
              });
            }

            if (hasSchemaOrgContributors(sections)) {
              withSchema++;
              for (const sec of sections) {
                if (!sec || typeof sec !== "object") continue;
                const t = String((sec as { type?: string }).type ?? "");
                if (isSchemaOrgSection(sec)) {
                  const st = getSchemaOrgType(sec as Record<string, unknown>) || "schema_org";
                  schemaCoverage[st] = (schemaCoverage[st] || 0) + 1;
                } else if (t === "faq") {
                  schemaCoverage["FAQPage"] = (schemaCoverage["FAQPage"] || 0) + 1;
                } else if (t === "article") {
                  schemaCoverage["Article"] = (schemaCoverage["Article"] || 0) + 1;
                } else if (t === "breadcrumb") {
                  schemaCoverage["BreadcrumbList"] =
                    (schemaCoverage["BreadcrumbList"] || 0) + 1;
                }
              }
            }
          }
        }
      }

      const contentRoot = getContentRoot(res);
      const contentFolder = getContentRootName(res);
      const marketParam =
        typeof req.query.market === "string" && req.query.market.trim()
          ? req.query.market.trim()
          : "worldwide";
      const { loadSeoIndex, computeClusterHealth, listBrokenClusterRefs } = await import("../seo-index");
      const {
        buildOrganicPathTraffic,
        lookupPathTraffic,
        sumPathTraffic,
      } = await import("../gsc-organic-path-traffic");
      const { buildSiteOrganicTraffic } = await import("../gsc-organic-site-traffic");
      const { buildOtherHighTraffic, clusteredPathsFromSeoIndex } = await import(
        "../gsc-organic-other-traffic"
      );
      const seoIndex = loadSeoIndex(contentRoot);
      const clusterHealth = computeClusterHealth(seoIndex, getCI(res), contentRoot);
      const brokenClusterRefs = listBrokenClusterRefs(seoIndex, getCI(res));
      const organic = buildOrganicPathTraffic({
        contentFolder,
        contentRoot,
        market: marketParam,
        kpiPaths: clusteredPathsFromSeoIndex(seoIndex),
      });
      const siteOrganicTraffic = await buildSiteOrganicTraffic({
        contentRoot,
        contentFolder,
      });
      const ci = getCI(res);
      const otherHighTraffic = buildOtherHighTraffic({
        contentFolder,
        contentRoot,
        market: marketParam,
        seoIndex,
        isKnownUrl: (path) => ci.isKnownUrl(path),
      });
      const clusters = Object.entries(seoIndex.clusters).map(([hubId, cluster]) => {
        const hub = seoIndex.entries[hubId];
        const keyword =
          typeof hub?.main_keyword === "string" && hub.main_keyword.trim()
            ? hub.main_keyword.trim()
            : null;
        const hubPath = cluster.path || hub?.path || "";
        const hubTraffic = lookupPathTraffic(organic.byPath, hubPath);
        const memberTraffics: Array<ReturnType<typeof lookupPathTraffic>> = [];
        const members = cluster.members.map((id) => {
          const base = clusterMemberFromIndex(id, seoIndex.entries[id]);
          const updatedAt = resolveEntryUpdatedAt({
            contentType: base.contentType,
            slug: base.slug,
            locale: base.locale,
            contentRoot,
          });
          const traffic = lookupPathTraffic(organic.byPath, base.path);
          memberTraffics.push(traffic);
          return {
            ...base,
            updated_at: updatedAt,
            lastmod: toSitemapLastmod(updatedAt, false),
            ...(traffic ? { traffic } : {}),
          };
        });
        const clusterTraffic = sumPathTraffic([hubTraffic, ...memberTraffics]);
        return {
          hubId,
          pillarUrl: cluster.path,
          keyword,
          locale: hub?.locale,
          members,
          clusterSlugs: members.map((m) => m.slug),
          memberIds: cluster.members,
          clusterCount: cluster.members.length,
          ...(hubTraffic ? { hubTraffic } : {}),
          ...(clusterTraffic ? { clusterTraffic } : {}),
        };
      });
      const uniqueOrphans = brokenClusterRefs.map((row) => ({
        slug: row.slug,
        contentType: row.contentType,
        intent: "unknown",
        filePath: row.filePath,
        locale: row.locale,
        pillar_path: row.pillar_path,
        reason: row.reason,
      }));
      const withPillar = Object.values(seoIndex.entries).filter(
        (e) => e.is_pillar || (typeof e.pillar_path === "string" && e.pillar_path.trim()),
      ).length;

      res.json({
        intentDistribution,
        clusters,
        clusterHealth,
        brokenClusterRefs,
        orphanPages: uniqueOrphans,
        featureCoverage,
        faqCoverage,
        schemaCoverage,
        indexRebuilt: !!seoIndex.rebuilt,
        organicTraffic: {
          window: organic.window,
          days_present: organic.days_present,
          days_in_window: organic.days_in_window,
          days_expected: organic.days_expected,
          incomplete: organic.incomplete,
          country_less: organic.country_less,
          truncated: organic.truncated,
          market: organic.market,
          markets: organic.markets,
          market_warning: organic.market_warning,
          totals: organic.totals,
          series: organic.series,
        },
        siteOrganicTraffic: {
          window: siteOrganicTraffic.window,
          days_in_window: siteOrganicTraffic.days_in_window,
          days_expected: siteOrganicTraffic.days_expected,
          incomplete: siteOrganicTraffic.incomplete,
          configured: siteOrganicTraffic.configured,
          source: siteOrganicTraffic.source,
          error: siteOrganicTraffic.error,
          totals: siteOrganicTraffic.totals,
          series: siteOrganicTraffic.series,
        },
        otherHighTraffic: {
          window: otherHighTraffic.window,
          market: otherHighTraffic.market,
          days_in_window: otherHighTraffic.days_in_window,
          days_expected: otherHighTraffic.days_expected,
          incomplete: otherHighTraffic.incomplete,
          known: otherHighTraffic.known,
          unknown: otherHighTraffic.unknown,
        },
        totals: {
          totalPages,
          withPillar,
          withKeyword,
          withIntent,
          withFocusFeatures,
          withFaq,
          withSchema,
        },
      });
    } catch (err) {
      res.status(500).json({ error: "Failed to build SEO overview", message: String(err) });
    }
  });

  app.get("/api/seo/cluster-entries", async (req, res) => {
    try {
      const bucketRaw = typeof req.query.bucket === "string" ? req.query.bucket : "";
      const {
        loadSeoIndex,
        listClusterBucketEntries,
        isClusterFilterBucket,
        enrichClusterBucketRowsWithKeywordMetrics,
      } = await import("../seo-index");
      const { buildOrganicPathTraffic, lookupPathTraffic } = await import("../gsc-organic-path-traffic");
      if (!isClusterFilterBucket(bucketRaw)) {
        res.status(400).json({
          error:
            "Invalid bucket. Must be one of: unclustered, partiallySet, brokenRefs, emptyHubs, clustered",
        });
        return;
      }
      const q = typeof req.query.q === "string" ? req.query.q : "";
      const page = Math.max(1, parseInt(String(req.query.page || "1"), 10) || 1);
      const pageSizeRaw = parseInt(String(req.query.pageSize || "25"), 10) || 25;
      const pageSize = Math.min(100, Math.max(1, pageSizeRaw));
      const marketParam =
        typeof req.query.market === "string" && req.query.market.trim()
          ? req.query.market.trim()
          : "worldwide";
      const contentRoot = getContentRoot(res);
      const contentFolder = getContentRootName(res);
      const seoIndex = loadSeoIndex(contentRoot);
      const result = listClusterBucketEntries(seoIndex, {
        bucket: bucketRaw,
        q,
        page,
        pageSize,
        ci: getCI(res),
        contentRoot,
      });
      const enriched = enrichClusterBucketRowsWithKeywordMetrics(result.items, {
        contentRoot,
        contentFolder,
      });
      const organic = buildOrganicPathTraffic({
        contentFolder,
        contentRoot,
        market: marketParam,
      });
      const items = enriched.map((item) => {
        const traffic = lookupPathTraffic(organic.byPath, item.path);
        return traffic ? { ...item, traffic } : item;
      });
      res.json({
        ...result,
        items,
      });
    } catch (err) {
      res.status(500).json({ error: "Failed to list cluster entries", message: String(err) });
    }
  });

  app.get("/api/seo/entry/:contentType/:slug", async (req, res) => {
    try {
      const { contentType, slug } = req.params;
      const locale = normalizeLocale(
        (req.query.locale as string) || getDefaultLocale(),
      );
      if (!isValidType(contentType)) {
        res.status(400).json({
          error: `Invalid content type. Must be one of: ${getAllFolders().join(", ")}`,
        });
        return;
      }

      const { loadSeoIndex, seoEntryId } = await import("../seo-index");
      const contentRoot = getContentRoot(res);
      const seoIndex = loadSeoIndex(contentRoot);
      const id = seoEntryId(contentType, slug, locale);
      const row = seoIndex.entries[id];
      const merged = getCI(res).loadMergedContent(contentType, slug, locale);
      const data = (merged.data || {}) as Record<string, unknown>;
      if (!row && !merged.data) {
        res.status(404).json({ error: "Entry not found" });
        return;
      }

      const meta =
        data.meta && typeof data.meta === "object" && !Array.isArray(data.meta)
          ? (data.meta as Record<string, unknown>)
          : {};
      const seo =
        data.seo && typeof data.seo === "object" && !Array.isArray(data.seo)
          ? (data.seo as Record<string, unknown>)
          : {};
      const title = typeof data.title === "string" && data.title.trim() ? data.title.trim() : null;
      const pageTitle =
        typeof meta.page_title === "string" && meta.page_title.trim() ? meta.page_title.trim() : null;
      const description =
        typeof meta.description === "string" && meta.description.trim() ? meta.description.trim() : null;
      const yamlKeyword =
        typeof seo.main_keyword === "string" && seo.main_keyword.trim()
          ? seo.main_keyword.trim()
          : null;
      const updatedAt = resolveEntryUpdatedAt({
        contentType,
        slug: row?.slug || slug,
        locale: row?.locale || locale,
        record: data,
        contentRoot,
      });

      const contentRootName = getContentRootName(res);
      const gscCfg = getGscConfig(contentRoot);
      const entryPath = row?.path || "";
      let gscStatus: {
        configured: boolean;
        record: ReturnType<typeof getRecord> | null;
        stale: boolean;
      } = { configured: gscCfg.configured, record: null, stale: true };
      if (entryPath) {
        const siteCtx = getSiteSitemapCtx(res);
        const debugUrls = getDebugSitemapUrls(siteCtx);
        const resolved = resolvePublicInspectLoc(entryPath, debugUrls);
        const record = resolved.loc ? getRecord(contentRootName, resolved.loc) ?? null : null;
        gscStatus = {
          configured: gscCfg.configured,
          record,
          stale: isStale(record ?? undefined),
        };
      }

      const yamlVol =
        typeof row?.kw_monthly_volume === "number"
          ? row.kw_monthly_volume
          : typeof seo.kw_monthly_volume === "number"
            ? seo.kw_monthly_volume
            : null;
      const yamlDiff =
        typeof row?.kw_difficulty === "number"
          ? row.kw_difficulty
          : typeof seo.kw_difficulty === "number"
            ? seo.kw_difficulty
            : null;
      const mainKeyword = row?.main_keyword || yamlKeyword;
      const { resolveKeywordMetrics } = await import("../openrush-keyword-cache");
      const keyword_metrics = resolveKeywordMetrics({
        keyword: mainKeyword,
        contentRoot,
        contentFolder: contentRootName,
        yamlVolume: yamlVol,
        yamlDifficulty: yamlDiff,
      });

      res.json({
        id,
        contentType,
        slug: row?.slug || (typeof data.slug === "string" ? data.slug : slug),
        locale: row?.locale || locale,
        title,
        page_title: pageTitle,
        description,
        path: row?.path || "",
        main_keyword: mainKeyword,
        kw_monthly_volume: yamlVol,
        kw_difficulty: yamlDiff,
        keyword_metrics,
        is_pillar: row?.is_pillar === true || seo.is_pillar === true,
        pillar_path:
          (typeof row?.pillar_path === "string" && row.pillar_path) ||
          (typeof seo.pillar_path === "string" ? seo.pillar_path : null),
        file: row?.file || merged.filePath || null,
        updated_at: updatedAt,
        lastmod: toSitemapLastmod(updatedAt, false),
        gscStatus,
      });
    } catch (err) {
      res.status(500).json({ error: "Failed to load cluster entry", message: String(err) });
    }
  });

  app.get("/api/seo/cluster-diagnostics", async (req, res) => {
    try {
      const auth = await requireStaffSession(req, res);
      if (!auth.authorized) return;

      const hubId = typeof req.query.hubId === "string" ? req.query.hubId.trim() : "";
      if (!hubId) {
        res.status(400).json({ error: "hubId query parameter is required" });
        return;
      }

      const contentRoot = getContentRoot(res);
      const { loadSeoIndex } = await import("../seo-index");
      const seoIndex = loadSeoIndex(contentRoot);
      const cluster = seoIndex.clusters[hubId];
      if (!cluster?.path) {
        res.status(404).json({ error: "Cluster not found" });
        return;
      }

      const site = res.locals.site as SiteContext | undefined;
      if (!site?.contentIndex) {
        res.status(500).json({ error: "Site context unavailable" });
        return;
      }

      const rendered = await renderHubHtml({
        site,
        pathname: cluster.path,
        variantKey: "live",
      });

      const scannedAt = new Date().toISOString();
      if (!rendered || rendered.status !== 200 || !rendered.html.trim()) {
        res.json({
          hubId,
          pillarUrl: cluster.path,
          scanStatus: "render_failed",
          missingLinks: [],
          scannedAt,
          fromCache: false,
        });
        return;
      }

      const members = cluster.members
        .map((id) => {
          const row = seoIndex.entries[id];
          return {
            memberId: id,
            memberSlug: row?.slug || id.split("/").slice(1, -1).join("/") || id,
            memberPath: row?.path || "",
            locale: row?.locale || "en",
          };
        })
        .filter((m) => m.memberPath.trim());

      const missingLinks = findMissingMemberLinks({
        html: rendered.html,
        members,
        ci: getCI(res),
      });

      res.json({
        hubId,
        pillarUrl: cluster.path,
        scanStatus: "ok",
        missingLinks,
        scannedAt,
        fromCache: rendered.fromCache,
      });
    } catch (err) {
      res.status(500).json({ error: "Failed to scan cluster hub links", message: String(err) });
    }
  });

  app.get("/api/seo-preview/:contentType/:slug/contexts", (req, res) => {
    try {
      const { contentType, slug } = req.params;
      const locale = normalizeLocale(
        (req.query.locale as string) || getDefaultLocale(),
      );

      if (!isValidType(contentType)) {
        res.status(400).json({
          error: `Invalid content type. Must be one of: ${getAllFolders().join(", ")}`,
        });
        return;
      }

      // DB-backed / shared-layout singles: live-only (C1)
      if (hasDatabaseSingle(contentType, getContentRoot(res))) {
        res.json({
          contexts: [{ type: "live" }] satisfies SeoContextOption[],
          default: { type: "live" } satisfies SeoContextOption,
        });
        return;
      }

      const listed = listSeoContextsForLocale(
        contentType,
        slug,
        locale,
        getContentRoot(res),
      );
      res.json(listed);
    } catch (error) {
      log.error({ err: error }, "[SEO Preview] contexts error:");
      res.status(500).json({ error: "Internal server error" });
    }
  });

  app.get("/api/seo-preview/:contentType/:slug", async (req, res) => {
    try {
      const { contentType, slug } = req.params;
      const locale = normalizeLocale(
        (req.query.locale as string) || getDefaultLocale(),
      );
      const queryVariantRaw = req.query.variant;
      const queryVariant =
        typeof queryVariantRaw === "string" &&
        queryVariantRaw &&
        queryVariantRaw !== "default"
          ? queryVariantRaw
          : undefined;

      if (!isValidType(contentType)) {
        res.status(400).json({
          error: `Invalid content type. Must be one of: ${getAllFolders().join(", ")}`,
        });
        return;
      }

      if (hasDatabaseSingle(contentType, getContentRoot(res))) {
        const page = await loadDatabaseSinglePage(contentType, slug, locale, getContentRoot(res), getDB(res));
        if (!page) {
          res.status(404).json({ error: "Content not found" });
          return;
        }

        const singleEntry = (page.singleEntry as Record<string, unknown>) || {};
        // Editable meta must stay unresolved so Save does not bake site globals.
        const rawMeta = metaRecord(page);
        const resolvedPage = resolveAllTemplateVars(page, {
          singleEntry,
          contentRoot: getContentRoot(res),
          context: { locale },
          skipSiteVars: false,
        }) as typeof page;

        const resolvedMeta = (resolvedPage.meta as Record<string, unknown>) || {};
        const dbSections = resolvedPage.sections as Array<Record<string, unknown>> | undefined;
        let faqSchema: Record<string, unknown> | null = null;
        let schemaOrg: Record<string, unknown>[] = [];
        let schemaOrgDocuments: Array<{
          schema: Record<string, unknown>;
          source: string;
        }> = [];

        if (Array.isArray(dbSections)) {
          const withDynamic = (await resolveDynamicEntries(dbSections, locale, {
            contentRoot: getContentRoot(res),
            contentIndex: getCI(res),
            singleEntry,
          })) as Array<Record<string, unknown>>;
          const collected = collectSectionSchemasDetailed(withDynamic, {
            locale,
            contentRoot: getContentRoot(res),
            baseUrl: getBaseUrl(),
            contentType,
            pageUrl: typeof resolvedMeta.canonical_url === "string" ? resolvedMeta.canonical_url : undefined,
            title: typeof resolvedMeta.page_title === "string" ? resolvedMeta.page_title : undefined,
            description: typeof resolvedMeta.description === "string" ? resolvedMeta.description : undefined,
            image: typeof resolvedMeta.og_image === "string" ? resolvedMeta.og_image : undefined,
          });
          schemaOrg = collected.documents;
          schemaOrgDocuments = collected.preview;
          faqSchema =
            collected.preview.find((p) => p.source === "faq")?.schema ??
            collected.documents.find((s) => s["@type"] === "FAQPage") ??
            null;
        }

        const schema = resolvedPage.schema as
          | {
              include?: string[];
              overrides?: Record<string, Record<string, unknown>>;
            }
          | undefined;

        res.json({
          meta: rawMeta,
          liveMeta: rawMeta,
          resolvedMeta,
          metaOverrides: [],
          context: "live" as const,
          faqSchema,
          schemaOrg,
          schemaOrgDocuments,
          schemaInclude: (schema?.include as string[]) || [],
          schemaOverrides:
            (schema?.overrides as Record<string, Record<string, unknown>>) || {},
          title: (resolvedPage.title as string) || "",
          slug: (resolvedPage.slug as string) || slug,
        });
        return;
      }

      const ci = getCI(res);
      const contentRoot = getContentRoot(res);
      const contentDir = getEntryContentDir(contentType, slug, contentRoot);
      const commonData = (ci.loadCommonData(contentType as ContentType, slug) ||
        {}) as Record<string, unknown>;
      const commonMeta = metaRecord(commonData);

      const liveFile = ci.loadLocaleData(contentType, slug, locale);
      const hasLive = !!liveFile.data && !liveFile.error;
      const liveOwnMeta = hasLive ? metaRecord(liveFile.data) : {};
      const liveMeta = deepMerge(commonMeta, liveOwnMeta);

      let resolvedVariant = queryVariant;
      // Variant-only entries: auto-pick when caller omitted variant
      if (!resolvedVariant && !hasLive) {
        resolvedVariant =
          findSourceDraftVariant(contentDir, locale) ?? undefined;
      }

      const contextIsVariant = !!resolvedVariant;
      let pageData: Record<string, unknown> | null = null;
      let variantOwnMeta: Record<string, unknown> = {};
      let metaOverrides: string[] = [];
      let displayMeta: Record<string, unknown> = liveMeta;

      if (contextIsVariant && resolvedVariant) {
        const variantFile = ci.loadLocaleData(
          contentType,
          slug,
          locale,
          resolvedVariant,
        );
        if (!variantFile.data) {
          res.status(404).json({ error: "Content not found" });
          return;
        }
        variantOwnMeta = metaRecord(variantFile.data);
        metaOverrides = Object.keys(variantOwnMeta);
        displayMeta = deepMerge(liveMeta, variantOwnMeta);
        pageData = deepMerge(
          deepMerge(commonData, hasLive ? liveFile.data! : {}),
          variantFile.data,
        );
      } else if (hasLive) {
        pageData = deepMerge(commonData, liveFile.data!);
        displayMeta = liveMeta;
      } else {
        res.status(404).json({ error: "Content not found" });
        return;
      }

      const schema = pageData.schema as
        | {
            include?: string[];
            overrides?: Record<string, Record<string, unknown>>;
          }
        | undefined;

      // Sections from the active context file (variant or live)
      const mergedContent = ci.loadMergedContent(
        contentType,
        slug,
        locale,
        contextIsVariant ? resolvedVariant : undefined,
      );
      let sectionsSource = mergedContent.data ?? pageData;
      if (mergedContent.data && mergedContent.isSharedTemplate) {
        sectionsSource = resolveAllTemplateVars(sectionsSource, {
          singleEntry: sectionsSource as Record<string, unknown>,
          contentRoot,
          context: { locale },
          skipSiteVars: false,
        }) as Record<string, unknown>;
      }
      const sections = sectionsSource.sections as
        | Array<Record<string, unknown>>
        | undefined;

      let faqSchema: Record<string, unknown> | null = null;
      let schemaOrg: Record<string, unknown>[] = [];
      let schemaOrgDocuments: Array<{
        schema: Record<string, unknown>;
        source: string;
      }> = [];

      if (Array.isArray(sections)) {
        const singleEntry: Record<string, unknown> = {
          ...(sectionsSource as Record<string, unknown>),
          slug,
          _slug: slug,
        };
        const withDynamic = (await resolveDynamicEntries(sections, locale, {
          contentRoot,
          contentIndex: ci,
          singleEntry,
        })) as Array<Record<string, unknown>>;
        const collected = collectSectionSchemasDetailed(withDynamic, {
          locale,
          contentRoot,
          baseUrl: getBaseUrl(),
          contentType,
          locationSlug: getType(contentType) === "location" ? slug : undefined,
          programSlug: getType(contentType) === "program" ? slug : undefined,
          pageUrl:
            typeof displayMeta.canonical_url === "string"
              ? displayMeta.canonical_url
              : undefined,
          title:
            typeof displayMeta.page_title === "string"
              ? displayMeta.page_title
              : undefined,
          description:
            typeof displayMeta.description === "string"
              ? displayMeta.description
              : undefined,
          image:
            typeof displayMeta.og_image === "string"
              ? displayMeta.og_image
              : undefined,
        });
        schemaOrg = collected.documents;
        schemaOrgDocuments = collected.preview;
        faqSchema =
          collected.preview.find((p) => p.source === "faq")?.schema ??
          collected.documents.find((s) => s["@type"] === "FAQPage") ??
          null;
      }

      const schemaInclude = (schema?.include as string[]) || [];
      const schemaOverrides =
        (schema?.overrides as Record<string, Record<string, unknown>>) || {};

      const responseData: Record<string, unknown> = {
        meta: displayMeta,
        liveMeta,
        metaOverrides,
        context: contextIsVariant ? "variant" : "live",
        ...(contextIsVariant && resolvedVariant
          ? { variant: resolvedVariant }
          : {}),
        faqSchema,
        schemaOrg,
        schemaOrgDocuments,
        schemaInclude,
        schemaOverrides,
        title: (pageData.title as string) || "",
        slug: (pageData.slug as string) || slug,
      };

      const region =
        typeof pageData.region === "string" && pageData.region.trim()
          ? pageData.region.trim()
          : undefined;
      responseData.resolvedMeta = resolveAllTemplateVars(displayMeta, {
        singleEntry: {
          ...(pageData as Record<string, unknown>),
          slug,
          _slug: slug,
        },
        meta: displayMeta,
        contentRoot,
        context: { locale, region },
        skipSiteVars: false,
      });

      if (getType(contentType) === "landing") {
        const commonLocs = Array.isArray(commonData?.locations)
          ? (commonData.locations as string[])
          : [];
        const localeLocs =
          hasLive && liveFile.data && Array.isArray(liveFile.data.locations)
            ? (liveFile.data.locations as string[])
            : [];
        responseData.locations =
          commonLocs.length > 0 ? commonLocs : localeLocs;
        responseData.availableLocations = listLocationPages(locale, ci).map(
          (loc) => ({
            slug: loc.slug,
            name: loc.name,
            city: loc.city,
            country: loc.country,
          }),
        );
      }

      res.json(responseData);
    } catch (error) {
      log.error({ err: error }, "[SEO Preview] Error:");
      res.status(500).json({ error: "Internal server error" });
    }
  });

  app.post("/api/content/update-locations", async (req, res) => {
    try {
      const auth = await requireCapability(req, res, "content_edit_structure", req.body.contentType || req.body.type || undefined);
      if (!auth.authorized) return;

      const { contentType, slug, locations, author } = req.body;
      if (!contentType || !slug || !Array.isArray(locations)) {
        res.status(400).json({
          error:
            "Missing required fields: contentType, slug, locations (array)",
        });
        return;
      }
      if (getType(contentType) !== "landing") {
        res
          .status(400)
          .json({ error: "Locations can only be updated for landings" });
        return;
      }

      const authorName =
        author && typeof author === "string" ? author : undefined;

      const result = editCommonContent({
        contentType,
        slug,
        operations: [
          {
            action: "update_field",
            path: "locations",
            value: locations.length > 0 ? locations : null,
          },
        ],
        author: authorName,
        ci: getCI(res),
        contentRootName: getContentRootName(res),
      });

      if (!result.success) {
        res.status(400).json({ error: result.error });
        return;
      }

      const landingDir = getCI(res).getContentFolderPath(contentType, slug);
      const variantFiles = fs
        .readdirSync(landingDir)
        .filter((f) => f.endsWith(".yml") && f !== "_common.yml");
      const strippedVariants: string[] = [];
      for (const variantFile of variantFiles) {
        const variantPath = path.join(landingDir, variantFile);
        try {
          const variantContent = fs.readFileSync(variantPath, "utf-8");
          const variantData = safeYamlLoad(variantContent) as Record<
            string,
            unknown
          >;
          if (variantData && "locations" in variantData) {
            delete variantData.locations;
            const variantYaml = safeYamlDump(variantData, {
              lineWidth: -1,
              noRefs: true,
              quotingType: '"',
              forceQuotes: false,
            });
            fs.writeFileSync(variantPath, variantYaml, "utf-8");
            markFileAsModified(variantPath, authorName);
            strippedVariants.push(variantFile);
          }
        } catch (e) {
          log.warn(
            `[Update Locations] Could not process variant ${variantFile}:`,
            e,
          );
        }
      }
      if (strippedVariants.length > 0) {
        log.info(
          `[Update Locations] Removed locations from variants: ${strippedVariants.join(", ")}`,
        );
      }

      getCI(res).refresh();
      invalidateContentCaches(contentType);

      res.json({
        success: true,
        locations: locations.length > 0 ? locations : [],
        strippedVariants,
      });
    } catch (error) {
      log.error({ err: error }, "[Update Locations] Error:");
      res.status(500).json({ error: "Internal server error" });
    }
  });

  app.get("/api/seo/organic/opportunities", async (req, res) => {
    const auth = await requireAnyCapability(req, res, ["metrics_view", "seo_settings"]);
    if (!auth.authorized) return;
    try {
      const decayRaw = String(req.query.decay_window || "7");
      const decayWindow = decayRaw === "28" ? 28 : 7;
      const pullLatest = String(req.query.pull_latest || "1") !== "0";
      const { buildOrganicOpportunities } = await import("../seo-organic-opportunities");
      const ci = getCI(res);
      const data = await buildOrganicOpportunities({
        contentRoot: getContentRoot(res),
        contentFolder: getContentRootName(res),
        decayWindow,
        pullLatest,
        isKnownUrl: (path) => ci.isKnownUrl(path),
      });
      res.json(data);
    } catch (err) {
      log.error({ err }, "organic opportunities failed");
      res.status(500).json({ error: err instanceof Error ? err.message : "Failed to load opportunities" });
    }
  });

  app.post("/api/seo/reindex", async (req, res) => {
    const auth = await requireCapability(req, res, "seo_settings");
    if (!auth.authorized) return;
    try {
      const started = Date.now();
      const { invalidateSeoIndexCache, rebuildSeoIndex } = await import("../seo-index");
      invalidateSeoIndexCache();
      const index = rebuildSeoIndex({
        contentRoot: getContentRoot(res),
        reason: "manual_reindex",
        mark: false,
      });
      res.json({
        ok: true,
        entries: Object.keys(index.entries).length,
        clusters: Object.keys(index.clusters).length,
        orphans: index.orphans.length,
        warnings: index.warnings.length,
        generated_at: index.generated_at,
        durationMs: Date.now() - started,
      });
    } catch (err) {
      log.error({ err }, "manual seo reindex failed");
      res.status(500).json({ error: err instanceof Error ? err.message : "Re-index failed" });
    }
  });

  app.post("/api/seo/organic/days/backfill", async (req, res) => {
    const auth = await requireCapability(req, res, "seo_settings");
    if (!auth.authorized) return;
    try {
      const mode = req.body?.mode === "rebuild_60" ? "rebuild_60" : "missing";
      const since = typeof req.body?.since === "string" && req.body.since.trim() ? req.body.since.trim() : undefined;
      const { ingestNextMissingDay } = await import("../gsc-organic-days");
      const result = await ingestNextMissingDay({
        contentRoot: getContentRoot(res),
        contentFolder: getContentRootName(res),
        forceAll: mode === "rebuild_60",
        since: mode === "rebuild_60" ? since : undefined,
      });
      res.status(result.ok ? 200 : 400).json({ ...result, mode });
    } catch (err) {
      log.error({ err }, "organic days backfill failed");
      res.status(500).json({ error: err instanceof Error ? err.message : "Backfill failed" });
    }
  });

  app.post("/api/seo/organic/serp/refresh", async (req, res) => {
    const auth = await requireCapability(req, res, "seo_settings");
    if (!auth.authorized) return;
    try {
      const { isOpenRushConfigured, inspectSerpQuery } = await import("../openrush-client");
      const contentRoot = getContentRoot(res);
      const contentFolder = getContentRootName(res);
      if (!isOpenRushConfigured(contentRoot)) {
        return res.status(400).json({ error: "OpenRush is not configured" });
      }
      const { getOpenRushSettings } = await import("../settings");
      const settings = getOpenRushSettings(contentRoot);
      const cap = Math.min(100, Math.max(1, settings.serp_top_n || 20));

      let queries: string[] = [];
      if (typeof req.body?.query === "string" && req.body.query.trim()) {
        queries = [req.body.query.trim()];
      } else if (req.body?.mode === "stale") {
        const { listPage1Queries } = await import("../seo-organic-opportunities");
        const { loadSerpCache, listStaleOrMissingQueries } = await import("../openrush-serp-cache");
        const wanted = listPage1Queries(contentFolder);
        queries = listStaleOrMissingQueries(wanted, loadSerpCache(contentFolder).entries).slice(0, cap);
      } else {
        return res.status(400).json({ error: "Provide { query } or { mode: \"stale\" }" });
      }

      const results: Array<{ query: string; ok: boolean; error?: string }> = [];
      for (const query of queries) {
        const r = await inspectSerpQuery({ query, contentRoot, contentFolder });
        results.push({ query, ok: r.ok, error: r.error });
        if (!r.ok && queries.length === 1) {
          return res.status(400).json({ error: r.error, results });
        }
      }
      res.json({
        ok: results.every((r) => r.ok),
        refreshed: results.filter((r) => r.ok).length,
        remaining_stale: Math.max(0, queries.length - results.filter((r) => r.ok).length),
        results,
      });
    } catch (err) {
      log.error({ err }, "organic serp refresh failed");
      res.status(500).json({ error: err instanceof Error ? err.message : "SERP refresh failed" });
    }
  });

  /**
   * Force OpenRush inspect_keyword for an entry’s main keyword.
   * Upserts shared keyword cache (partial merge); does not write YAML seo.kw_*.
   */
  api.post(app, "/api/seo/keyword/refresh", { rate: "staffWrite" }, async (req, res) => {
    try {
      const contentType = typeof req.body?.contentType === "string" ? req.body.contentType.trim() : "";
      const slug = typeof req.body?.slug === "string" ? req.body.slug.trim() : "";
      const locale = normalizeLocale(
        (typeof req.body?.locale === "string" && req.body.locale) || getDefaultLocale(),
      );
      const keywordOverride =
        typeof req.body?.keyword === "string" && req.body.keyword.trim()
          ? req.body.keyword.trim()
          : "";
      if (!contentType || !slug) {
        return res.status(400).json({ error: "contentType and slug are required" });
      }
      if (!isValidType(contentType)) {
        return res.status(400).json({
          error: `Invalid content type. Must be one of: ${getAllFolders().join(", ")}`,
        });
      }

      const auth = await requireCapability(req, res, "seo_edit", contentType);
      if (!auth.authorized) return;

      const {
        isOpenRushConfigured,
        inspectKeywordQuery,
        OPENRUSH_INSPECT_KEYWORD_CREDITS,
      } = await import("../openrush-client");
      const contentRoot = getContentRoot(res);
      const contentFolder = getContentRootName(res);
      if (!isOpenRushConfigured(contentRoot)) {
        return res.status(400).json({
          error: "OpenRush must be activated to refresh keyword metrics",
          code: "openrush_inactive",
        });
      }

      let keyword = keywordOverride;
      if (!keyword) {
        const { loadSeoIndex, seoEntryId } = await import("../seo-index");
        const seoIndex = loadSeoIndex(contentRoot);
        const row = seoIndex.entries[seoEntryId(contentType, slug, locale)];
        const merged = getCI(res).loadMergedContent(contentType, slug, locale);
        const data = (merged.data || {}) as Record<string, unknown>;
        const seo =
          data.seo && typeof data.seo === "object" && !Array.isArray(data.seo)
            ? (data.seo as Record<string, unknown>)
            : {};
        const fromYaml =
          typeof seo.main_keyword === "string" && seo.main_keyword.trim()
            ? seo.main_keyword.trim()
            : "";
        const fromIndex =
          typeof row?.main_keyword === "string" && row.main_keyword.trim()
            ? row.main_keyword.trim()
            : "";
        keyword = fromYaml || fromIndex;
      }
      if (!keyword) {
        return res.status(400).json({ error: "No keyword configured for this entry" });
      }

      const inspected = await inspectKeywordQuery({ keyword, contentRoot, contentFolder });
      if (!inspected.ok || !inspected.metrics) {
        return res.status(400).json({ error: inspected.error || "OpenRush keyword lookup failed" });
      }

      const volume = inspected.entry?.monthly_volume ?? inspected.metrics.monthly_volume;
      const difficulty = inspected.entry?.kw_difficulty ?? inspected.metrics.kw_difficulty;
      if (volume == null && difficulty == null && !inspected.entry) {
        return res.status(400).json({
          error: "OpenRush returned no volume or difficulty for this keyword",
          keyword,
          metrics: inspected.metrics,
        });
      }

      res.json({
        ok: true,
        keyword: inspected.metrics.keyword,
        kw_monthly_volume: volume,
        kw_difficulty: difficulty,
        fetched_at: inspected.entry?.fetched_at ?? null,
        notes: inspected.entry?.notes ?? null,
        source: "openrush_cache",
        credits: OPENRUSH_INSPECT_KEYWORD_CREDITS,
        credits_note: inspected.credits_note,
      });
    } catch (err) {
      log.error({ err }, "keyword refresh failed");
      res.status(500).json({ error: err instanceof Error ? err.message : "Keyword refresh failed" });
    }
  });

}
