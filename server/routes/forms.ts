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
} from "../content-types";
import { resolveFieldValue, applyTransformIfNeeded } from "../transform";
import { resolveSingleVars } from "../single-resolver";
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
import { getTrackingSettings } from "../settings";
import { buildLeadPayload } from "../utils/buildLeadPayload";
import { isPrivateDestination } from "../../shared/ssrf";
import { DatabaseManager } from "../database";
import {
  fetchQueryOptions,
  parseFilterQueryParams,
  logSourceNameCollisions,
} from "../query-options";
import { child } from "../logger";
const log = child({ module: "routes/forms" });

function getDB(res: Response): DatabaseManager {
  return (res.locals.site as { database?: DatabaseManager } | undefined)?.database ?? databaseManager;
}

function getCI(res: Response): typeof contentIndex {
  return (res.locals.site as { contentIndex?: typeof contentIndex } | undefined)?.contentIndex ?? contentIndex;
}

function getContentRoot(res: Response): string {
  return (res.locals.site as { contentRoot?: string } | undefined)?.contentRoot ?? getDefaultContentRoot();
}

export function registerFormsRoutes(app: Express): void {
  logSourceNameCollisions(getDefaultContentRoot(), databaseManager);
  app.get("/api/turnstile/status", (_req, res) => {
    const siteKey = process.env.TURNSTILE_SITE_KEY;
    const secretKey = process.env.TURNSTILE_SECRET_KEY;
    const configured = Boolean(siteKey && siteKey.length > 0 && secretKey && secretKey.length > 0);
    res.json({ configured });
  });

  app.get("/api/turnstile/site-key", (_req, res) => {
    const siteKey = process.env.TURNSTILE_SITE_KEY;
    if (!siteKey) {
      res.status(500).json({ error: "Turnstile site key not configured" });
      return;
    }
    res.json({ siteKey });
  });

  app.post("/api/turnstile/verify", async (req, res) => {
    try {
      const { token } = req.body;
      const secretKey = process.env.TURNSTILE_SECRET_KEY;

      if (!token) {
        res.status(400).json({ success: false, error: "Token required" });
        return;
      }

      if (!secretKey) {
        res.status(500).json({
          success: false,
          error: "Turnstile secret key not configured",
        });
        return;
      }

      const verifyResponse = await fetch(
        "https://challenges.cloudflare.com/turnstile/v0/siteverify",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            secret: secretKey,
            response: token,
          }),
        },
      );

      const result = (await verifyResponse.json()) as {
        success: boolean;
        "error-codes"?: string[];
      };

      if (result.success) {
        res.json({ success: true });
      } else {
        res.status(400).json({
          success: false,
          error: "Verification failed",
          codes: result["error-codes"],
        });
      }
    } catch (error) {
      log.error({ err: error }, "Turnstile verification error:");
      res.status(500).json({ success: false, error: "Verification failed" });
    }
  });
  app.post("/api/apply", (req, res) => {
    try {
      const {
        program,
        location,
        firstName,
        lastName,
        email,
        phone,
        consentMarketing,
        consentSms,
        locale,
      } = req.body;

      // Validate required fields
      if (
        !program ||
        !location ||
        !firstName ||
        !lastName ||
        !email ||
        !phone
      ) {
        res.status(400).json({ error: "Missing required fields" });
        return;
      }

      // Log the application (in production, this would send to a CRM or database)
      log.info("New application received:", {
        program,
        location,
        firstName,
        lastName,
        email,
        phone,
        consentMarketing,
        consentSms,
        locale,
        timestamp: new Date().toISOString(),
      });

      // In the future, this could:
      // 1. Send to Breathecode API
      // 2. Add to a CRM
      // 3. Send confirmation email
      // 4. Store in database

      res.json({ success: true, message: "Application received" });
    } catch (error) {
      log.error({ err: error }, "Error processing application:");
      res.status(500).json({ error: "Failed to process application" });
    }
  });

  // ─── Lead Form & Form Options API ─────────────────────────────────────────
  // Lead Form API endpoints

  // Get form options (programs and locations for dropdowns)
  app.get(["/api/form-options", "/api/form-options/:locale"], (req, res) => {
    const locale = normalizeLocale(
      (req.params as { locale?: string }).locale ||
        (req.query.locale as string),
    );

    // Get all programs for dropdown
    const programs = listCareerPrograms(locale).map((p) => ({
      slug: p.slug,
      bc_slug: p.bc_slug,
      title: p.title,
    }));

    // Get all visible locations grouped by region
    const locationsPath = path.join(
      (res.locals.site as any)?.contentRoot ?? getDefaultContentRoot(),
      getFolder("location"),
    );
    const locationsList: Array<{
      slug: string;
      name: string;
      city: string;
      country: string;
      region: string;
    }> = [];

    try {
      if (fs.existsSync(locationsPath)) {
        const dirs = fs.readdirSync(locationsPath);
        for (const dir of dirs) {
          const commonPath = path.join(locationsPath, dir, "_common.yml");
          if (fs.existsSync(commonPath)) {
            const campusData = safeYamlLoad(
              fs.readFileSync(commonPath, "utf8"),
            ) as {
              slug: string;
              name: string;
              city: string;
              country: string;
              country_code?: string;
              region?: string;
              visibility?: string;
            };
            if (campusData && campusData.visibility !== "unlisted") {
              locationsList.push({
                slug: campusData.slug,
                name: campusData.name,
                city: campusData.city,
                country: campusData.country,
                region: campusData.region || "other",
              });
            }
          }
        }
      }
    } catch (error) {
      log.error({ err: error }, "Error loading locations:");
    }

    // Group locations by region
    const regions = [
      {
        slug: "usa-canada",
        label: locale === "es" ? "EE.UU. y Canadá" : "USA & Canada",
      },
      {
        slug: "latam",
        label: locale === "es" ? "Latinoamérica" : "Latin America",
      },
      { slug: "europe", label: locale === "es" ? "Europa" : "Europe" },
      { slug: "online", label: "Online" },
    ];

    res.json({
      programs,
      locations: locationsList,
      regions,
    });
  });

  // Query-driven dropdown options (content type or database via `source`)
  app.get("/api/query-options", async (req, res) => {
    try {
      const parsed = parseFilterQueryParams(req.query as Record<string, unknown>);
      if (parsed.content_type && parsed.database) {
        res.status(400).json({ error: "Pass either content_type or database, not both" });
        return;
      }
      if (!parsed.content_type && !parsed.database && !parsed.source) {
        res.status(400).json({
          error: "content_type, database, or source query parameter is required",
        });
        return;
      }

      const locale = parsed.locale
        ? normalizeLocale(parsed.locale)
        : undefined;

      const result = await fetchQueryOptions(
        {
          source: parsed.source,
          contentType: parsed.content_type,
          database: parsed.database,
          filters: parsed.filters,
          sort: parsed.sort,
          limit: parsed.limit,
          locale,
          valuePath: parsed.valuePath,
          labelPath: parsed.labelPath,
        },
        {
          db: getDB(res),
          contentIndex: getCI(res),
          contentRoot: getContentRoot(res),
        },
      );

      if (!result.ok) {
        res.status(result.status).json({ error: result.error });
        return;
      }

      res.json({ options: result.options, meta: result.meta });
    } catch (error) {
      log.error({ err: error }, "Error loading query options:");
      res.status(500).json({ error: "Failed to load query options" });
    }
  });

  // Submit lead form
  app.post("/api/leads", async (req, res) => {
    try {
      const leadData = req.body;

      // Validate required fields
      if (!leadData.email) {
        res.status(400).json({ error: "Email is required" });
        return;
      }

      const cleanPayload = buildLeadPayload(leadData as Record<string, unknown>);

      // Resolve webhook destination: global settings → DEFAULT_WEBHOOK_URL env var
      const globalWebhook = getTrackingSettings().webhook;
      const webhookUrl: string | undefined = globalWebhook?.url || process.env.DEFAULT_WEBHOOK_URL;
      const webhookMethod: string = globalWebhook?.url
        ? (globalWebhook.method || "POST")
        : (process.env.DEFAULT_WEBHOOK_METHOD || "POST");
      const webhookAuthHeader: string | undefined = globalWebhook?.url ? globalWebhook.auth_header : undefined;

      if (!webhookUrl) {
        res.json({ success: true, skipped: "no_webhook" });
        return;
      }

      if (isPrivateDestination(webhookUrl)) {
        log.warn(`[LeadSubmission] Blocked private/internal destination: ${webhookUrl}`);
        res.json({ success: true, skipped: "no_webhook" });
        return;
      }

      const fetchOptions: RequestInit = {
        method: webhookMethod,
        headers: {
          "Content-Type": "application/json",
          ...(webhookAuthHeader ? { Authorization: webhookAuthHeader } : {}),
        },
        body: JSON.stringify(cleanPayload),
      };

      const webhookResponse = await fetch(webhookUrl, fetchOptions);

      if (!webhookResponse.ok) {
        const errorText = await webhookResponse.text();
        log.error("Lead webhook delivery error:", webhookResponse.status, errorText);
        res.status(webhookResponse.status).json({
          error: "Failed to submit lead",
          details: errorText,
        });
        return;
      }

      const result = await webhookResponse.json().catch(() => ({}));
      res.json({ success: true, data: result });
    } catch (error) {
      log.error({ err: error }, "Lead submission error:");
      res.status(500).json({ error: "Internal server error" });
    }
  });

}
