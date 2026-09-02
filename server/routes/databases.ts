import type { Express, Request, Response } from "express";
import { getDefaultContentRoot } from "../site-config";
import { createServer, type Server } from "http";
import { storage } from "../storage";
import { geoGet, geoSet } from "../geo-cache";
import { getQueueStats, enqueueOptimization, getPendingOptimizations, getFailedEntries, retryFailedImages, resetOptimizeSession, getOptimizeSession, enqueueExternalImage } from "../image-registry";
import { getAllQueueState } from "../image-queue-state";
import { getAllJobStates, type DbJobState } from "../db-job-state";
import { countDatabaseCacheErrors } from "../../scripts/validation/shared/databaseHealthChecks";
import { getValidationCacheService } from "../services/validationCacheService";
import { getDatabaseUsage } from "../database-usage";


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
import { databaseManager, type DatabaseManager } from "../database";
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
import { isEntryDetached, resolvePreviewBaseSlug } from "../shared-layout-entry";
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
import { child } from "../logger";
const log = child({ module: "routes/databases" });

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

/** Per-site DatabaseManager for the active request (multi-site / dev-site override aware). */
function getDB(res: Response): DatabaseManager {
  return (res.locals.site as import("../site-manager").SiteContext | undefined)?.database ?? databaseManager;
}

function getValidationCache(res: Response) {
  return (res.locals.site as any)?.validationCache ?? getValidationCacheService();
}

export function registerDatabasesRoutes(app: Express): void {
  app.get("/api/database-single/:contentType/:slug", async (req, res) => {
    try {
      const { contentType, slug: requestSlug } = req.params;
      const locale = normalizeLocale(req.query.locale as string);
      const forceVariant = req.query.force_variant as string | undefined;

      if (!hasDatabaseSingle(contentType, getContentRoot(res))) {
        res
          .status(400)
          .json({
            error: `Content type "${contentType}" is not database-backed`,
          });
        return;
      }

      const root = getContentRoot(res);
      const slug = resolvePreviewBaseSlug(requestSlug, contentType, getCI(res));
      const {
        buildLocaleUnavailablePayload,
        isEmptyDetachedLocaleEntry,
        skipEmptyLocaleGateForForceVariant,
      } = await import("../empty-locale");
      if (
        !skipEmptyLocaleGateForForceVariant(forceVariant) &&
        isEmptyDetachedLocaleEntry({
          contentType,
          slug,
          locale,
          contentRoot: root,
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

      const detached = isEntryDetached(contentType, slug, root);
      let templateVariant: string | undefined;
      if (!detached) {
        const { resolveAssignedVariantSlug } = await import("./_helpers");
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
      if (!page) {
        res
          .status(404)
          .json({ error: `Item not found: ${contentType}/${slug}` });
        return;
      }

      const dbSingleData = page as unknown as Record<string, unknown>;
      const dbSingleEntry = (dbSingleData.singleEntry as Record<string, unknown>) || {};
      if (page.sections && Array.isArray(page.sections)) {
        page.sections = (await resolveDynamicEntries(page.sections, locale, {
          db: getDB(res),
          contentRoot: getContentRoot(res),
          contentIndex: getCI(res),
          singleEntry: dbSingleEntry,
        })) as any;
      }
      if (Object.keys(dbSingleEntry).length > 0) {
        try {
          const site = res.locals.site as import("../site-manager").SiteContext | undefined;
          if (site?.entryPreviewManager) {
            const { applyEntryPreviewOgImage } = await import("../entry-preview-manager");
            const { getPreviewConfig } = await import("../content-types");
            await applyEntryPreviewOgImage(site.entryPreviewManager, {
              contentType,
              entry: dbSingleEntry,
              previewConfig: getPreviewConfig(contentType, getContentRoot(res)),
              pageData: dbSingleData,
            });
          }
        } catch {
          /* non-fatal */
        }
        const resolved = resolveAllTemplateVars(dbSingleData, {
          singleEntry: dbSingleEntry,
          contentRoot: getContentRoot(res),
          context: { locale },
        }) as Record<string, unknown>;
        Object.assign(dbSingleData, resolved);
      } else {
        const resolved = resolveAllTemplateVars(dbSingleData, {
          contentRoot: getContentRoot(res),
          context: { locale },
        }) as Record<string, unknown>;
        Object.assign(dbSingleData, resolved);
      }

      const { enhanceArticleSectionsInPage } = await import("../markdown-enhance");
      await enhanceArticleSectionsInPage(dbSingleData);

      const dbSingleRaw = getCI(res).loadMergedContent(contentType, slug, locale);
      const dbSingleLayout = resolveLayout(contentType, dbSingleRaw.data || dbSingleData, getContentRoot(res));
      injectCanonicalIfMissing(dbSingleData, contentType, locale);
      const { layout: _dbSingleStripLayout, ...dbSingleRest } = dbSingleData;
      res.json({
        ...dbSingleRest,
        layout: dbSingleLayout,
        detached,
      });
    } catch (error) {
      log.error({ err: error }, "[DatabaseSingle] Error:");
      res.status(500).json({ error: "Failed to load database single page" });
    }
  });
  app.get("/api/migrations", (_req, res) => {
    try {
      const migrationsDir = path.join(process.cwd(), "scripts", "migrations");
      if (!fs.existsSync(migrationsDir)) {
        res.json([]);
        return;
      }
      const files = fs.readdirSync(migrationsDir)
        .filter(f => /^\d{3}_[\w]+\.ts$/.test(f))
        .sort();
      const result = files.map(filename => {
        const fullPath = path.join(migrationsDir, filename);
        const content = fs.readFileSync(fullPath, "utf-8");
        const nameMatch = content.match(/@migration\s+([^\n*]+)/);
        const descMatch = content.match(/@description\s+([^\n*]+(?:\n\s*\*\s+[^\n*@]+)*)/);
        const name = nameMatch ? nameMatch[1].trim() : filename.replace(/\.ts$/, "");
        const description = descMatch
          ? descMatch[1].replace(/\n\s*\*\s*/g, " ").trim()
          : "No description provided.";
        return { filename, name, description };
      });
      res.json(result);
    } catch (err: any) {
      res.status(500).json({ error: err.message || String(err) });
    }
  });

  app.post("/api/migrations/run", async (req, res) => {
    const auth = await requireCapability(req, res, "migrations_run");
    if (!auth.authorized) return;

    const { filename } = req.body || {};
    if (!filename || !/^\d{3}_[\w]+\.ts$/.test(filename)) {
      res.status(400).json({ error: "Invalid migration filename." });
      return;
    }
    const migrationsDir = path.join(process.cwd(), "scripts", "migrations");
    const fullPath = path.join(migrationsDir, filename);
    if (!fs.existsSync(fullPath)) {
      res.status(404).json({ error: "Migration script not found." });
      return;
    }
    execFile(
      "npx",
      ["tsx", fullPath],
      { cwd: process.cwd(), timeout: 120000 },
      (err, stdout, stderr) => {
        const output = [stdout, stderr].filter(Boolean).join("\n").trim();
        if (err && err.killed) {
          res.json({ success: false, output: `Timed out after 120s.\n${output}` });
        } else if (err && err.code !== 0) {
          res.json({ success: false, output: output || err.message });
        } else {
          res.json({ success: true, output });
        }
      },
    );
  });
  // ── Database routes ──────────────────────────────────────────
  app.get("/api/databases", (_req, res) => {
    try {
      const dbm = getDB(res);
      const databases = dbm.list();
      const cacheStats = dbm.getCacheStats();
      const validationCache = getValidationCache(res);
      res.json(
        databases.map((db) => {
          const dbCache = validationCache.getByDatabase(db.name);
          const errorCount = dbCache ? countDatabaseCacheErrors(dbCache.errors) : 0;
          return {
            name: db.name,
            label: db.config.name,
            description: db.config.description || null,
            source_type: db.config.source.type,
            field_count: dbm.getFieldCount(db.name),
            cache_item_count: cacheStats.perDb[db.name]?.item_count ?? null,
            cache_fetched_at: cacheStats.perDb[db.name]?.fetched_at ?? null,
            cache_file_size_bytes: cacheStats.totalFileSizeBytes,
            error_count: errorCount,
            error_summary: dbCache?.errors[0]?.message,
          };
        }),
      );
    } catch (err) {
      res.status(500).json({ error: String(err) });
    }
  });

  app.post("/api/databases/reload", (_req, res) => {
    try {
      const dbm = getDB(res);
      dbm.reload();
      res.json({ success: true, count: dbm.list().length });
    } catch (err) {
      res.status(500).json({ error: String(err) });
    }
  });

  app.post("/api/databases", (req, res) => {
    try {
      const { slug, config } = req.body;
      if (!slug || !config || !config.name || !config.source) {
        res
          .status(400)
          .json({ error: "slug, config.name, and config.source are required" });
        return;
      }
      getDB(res).create(slug, config);
      res.json({ success: true, name: slug, config });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes("already exists")) {
        res.status(409).json({ error: msg });
      } else {
        res.status(400).json({ error: msg });
      }
    }
  });

  app.get("/api/databases/:name", (req, res) => {
    try {
      const dbm = getDB(res);
      const config = dbm.get(req.params.name);
      const cacheInfo = dbm.getCacheInfo(req.params.name);
      const dbCache = getValidationCache(res).getByDatabase(req.params.name);
      const errorCount = dbCache ? countDatabaseCacheErrors(dbCache.errors) : 0;
      res.json({
        name: req.params.name,
        config,
        cache_status: cacheInfo,
        error_count: errorCount,
        error_summary: dbCache?.errors[0]?.message,
        validation_errors: dbCache?.errors ?? [],
        validation_warnings: dbCache?.warnings ?? [],
      });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes("not found")) {
        res.status(404).json({ error: msg });
      } else {
        res.status(500).json({ error: msg });
      }
    }
  });

  app.get("/api/databases/:name/usage", (req, res) => {
    try {
      const dbm = getDB(res);
      const name = req.params.name;
      if (!dbm.exists(name)) {
        res.status(404).json({ error: `Database "${name}" not found` });
        return;
      }
      const report = getDatabaseUsage(name, {
        contentRoot: getContentRoot(res),
        db: dbm,
      });
      res.json(report);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      res.status(500).json({ error: msg });
    }
  });

  app.get("/api/databases/:name/raw-fields", (req, res) => {
    try {
      const fields = getDB(res).getRawFields(req.params.name);
      res.json({ fields });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes("not found")) {
        res.status(404).json({ error: msg });
      } else {
        res.status(500).json({ error: msg });
      }
    }
  });

  app.get("/api/databases/:name/raw-sample", (req, res) => {
    try {
      const rawItems = getDB(res).getRawItems(req.params.name);
      if (!rawItems || rawItems.length === 0) {
        res.json({ items: [], count: 0 });
        return;
      }
      const limit = Math.min(Number(req.query.limit) || 3, 10);
      res.json({ items: rawItems.slice(0, limit), count: rawItems.length });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes("not found")) {
        res.status(404).json({ error: msg });
      } else {
        res.status(500).json({ error: msg });
      }
    }
  });

  app.get("/api/databases/:name/raw-items", (req, res) => {
    try {
      const page = Math.max(1, parseInt(String(req.query.page || "1"), 10));
      const limit = Math.max(1, Math.min(1000, parseInt(String(req.query.limit || "100"), 10)));
      const rawItems = getDB(res).getRawItems(req.params.name);
      const allItems = rawItems || [];
      const total_count = allItems.length;
      const start = (page - 1) * limit;
      const paginatedItems = allItems.slice(start, start + limit);
      res.json({ items: paginatedItems, total_count, page, limit });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes("not found")) {
        res.status(404).json({ error: msg });
      } else {
        res.status(500).json({ error: msg });
      }
    }
  });

  app.post("/api/databases/:name/analyze-fields", async (req, res) => {
    try {
      const dbName = req.params.name;
      const rawItems = getDB(res).getRawItems(dbName);
      if (!rawItems || rawItems.length === 0) {
        res
          .status(400)
          .json({ error: "No cached data available. Fetch data first." });
        return;
      }

      const sample = rawItems.slice(0, 3);
      const sampleKeys = Object.keys(sample[0] || {}).slice(0, 50);

      const prompt = `You are analyzing raw API response data to suggest a field mapping that normalizes it into clean database fields.

Here are ${sample.length} sample items from the API (showing up to 50 top-level keys):
${JSON.stringify(
  sample.map((item) => {
    const filtered: Record<string, unknown> = {};
    for (const k of sampleKeys) {
      const val = item[k];
      if (val !== null && val !== undefined && val !== "") {
        filtered[k] =
          typeof val === "object" ? JSON.stringify(val).slice(0, 100) : val;
      }
    }
    return filtered;
  }),
  null,
  2,
)}

Suggest a field_mapping that maps the most useful raw fields to clean, normalized keys.
Focus on fields that are commonly needed: id, slug, title, description, status, language/locale, dates, author info, categories, tags, images, URLs.
Skip fields that are internal IDs, computed values, or rarely useful.

Return JSON with this exact structure:
{
  "field_mapping": {
    "normalized_key": "source.field.path",
    ...
  },
  "notes": "Brief explanation of the mapping choices"
}

Values should be dot-notation paths into the raw data (e.g., "author.name" for { author: { name: "..." } }).
Do NOT prefix values with "raw." or "db." — just use the plain field path.
Keep normalized keys lowercase with underscores. Aim for 10-25 of the most useful fields.`;

      const { getLLMService } = await import("../ai/LLMService");
      const llm = getLLMService();

      const systemPrompt =
        "You are a data analyst that suggests field mappings for normalizing raw API data. Respond with valid JSON only, no markdown.";
      const result = await llm.complete(prompt, {
        systemPrompt,
        temperature: 0.2,
        maxTokens: 2000,
      });
      let parsed: Record<string, unknown>;
      try {
        const jsonMatch = result.match(/\{[\s\S]*\}/);
        parsed = jsonMatch
          ? JSON.parse(jsonMatch[0])
          : { raw: result, error: "No JSON found" };
      } catch {
        parsed = { raw: result, error: "Failed to parse AI response" };
      }

      if (parsed.field_mapping && typeof parsed.field_mapping === "object") {
        const cleaned: Record<string, string> = {};
        for (const [key, val] of Object.entries(
          parsed.field_mapping as Record<string, string>,
        )) {
          const strVal = String(val);
          cleaned[key] = strVal.startsWith("raw.")
            ? strVal.slice(4)
            : strVal.startsWith("db.")
              ? strVal.slice(3)
              : strVal;
        }
        parsed.field_mapping = cleaned;
      }

      res.json(parsed);
    } catch (err) {
      log.error({ err: err }, "AI analyze-fields (database) error:");
      res.status(500).json({ error: String(err) });
    }
  });

  app.get("/api/databases/:name/search", async (req, res) => {
    try {
      const dbName = req.params.name;
      const q = (req.query.q as string || "").trim();
      const limit = Math.min(Number(req.query.limit) || 20, 100);
      const locale = (req.query.locale as string) || undefined;

      if (!q) {
        res.status(400).json({ error: "q parameter is required" });
        return;
      }

      const { searchDatabaseItems } = await import("../database-search");
      const result = await searchDatabaseItems(dbName, q, {
        limit,
        locale,
        db: getDB(res),
        contentFolder: getContentRootName(res),
      });

      res.json({
        items: result.items,
        count: result.count,
        semantic: result.semantic,
        ...(result.scores && { scores: result.scores }),
        ...(result.fallback_reason && {
          fallback_reason: result.fallback_reason,
          fallback_message: result.fallback_message,
        }),
        ...(result.cache && result.cache !== "miss" && { cache: result.cache }),
      });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes("not found")) {
        res.status(404).json({ error: msg });
      } else {
        res.status(500).json({ error: msg });
      }
    }
  });

  app.get("/api/databases/:name/items", async (req, res) => {
    try {
      const page = Math.max(1, parseInt(String(req.query.page || "1"), 10));
      const limit = Math.max(1, Math.min(1000, parseInt(String(req.query.limit || "100"), 10)));
      const result = await getDB(res).fetchItems(req.params.name);

      // Apply tag/select field filters: filter[fieldName]=value (multi-value OR per field, AND across fields)
      const filterParam = req.query.filter as Record<string, string | string[]> | undefined;
      let items = result.items;
      if (filterParam && typeof filterParam === "object") {
        for (const [field, rawValues] of Object.entries(filterParam)) {
          const values = Array.isArray(rawValues) ? rawValues : [rawValues];
          if (values.length === 0) continue;
          items = items.filter((item) => {
            const fieldVal = item[field];
            if (Array.isArray(fieldVal)) {
              return values.some((v) => (fieldVal as unknown[]).map(String).includes(v));
            }
            return values.includes(String(fieldVal ?? ""));
          });
        }
      }

      const total_count = items.length;
      const start = (page - 1) * limit;
      const paginatedItems = items.slice(start, start + limit);
      res.json({ ...result, items: paginatedItems, total_count, page, limit });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes("not found")) {
        res.status(404).json({ error: msg });
      } else {
        res.status(500).json({ error: msg });
      }
    }
  });

  app.put("/api/databases/:name/items", async (req, res) => {
    try {
      const dbName = req.params.name;
      const dbm = getDB(res);
      const config = dbm.get(dbName);

      if (config.source.type !== "local") {
        res.status(400).json({ error: "Only local databases support item editing" });
        return;
      }

      const { items } = req.body;
      if (!Array.isArray(items)) {
        res.status(400).json({ error: "items must be an array" });
        return;
      }

      const localConfig = config.source.local!;
      const filename = localConfig.filename;
      const resultsPath = localConfig.results_path;

      const filePath = path.join(getContentRoot(res), "db", dbName, filename);
      if (!fs.existsSync(path.dirname(filePath))) {
        res.status(404).json({ error: `Database directory not found` });
        return;
      }

      const data: unknown = resultsPath ? { [resultsPath]: items } : items;
      const yamlStr = safeYamlDump(data, { lineWidth: 120 });
      fs.writeFileSync(filePath, yamlStr);

      dbm.clearCache(dbName);

      const relPath = `db/${dbName}/${filename}`;
      markFileAsModified(relPath, "api", undefined, getContentRoot(res));

      res.json({ success: true, count: items.length });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes("not found")) {
        res.status(404).json({ error: msg });
      } else {
        res.status(500).json({ error: msg });
      }
    }
  });

  // ── Helper: read raw items array from local file ─────────────
  function readLocalItems(dbm: DatabaseManager, dbName: string, contentRoot: string): {
    items: Record<string, unknown>[];
    filePath: string;
    resultsPath: string | undefined;
  } {
    const config = dbm.get(dbName);
    if (config.source.type !== "local") {
      throw new Error("Only local databases support item editing");
    }
    const localConfig = config.source.local!;
    const filePath = path.join(contentRoot, "db", dbName, localConfig.filename);
    const resultsPath = localConfig.results_path;
    let rawData: unknown = resultsPath ? { [resultsPath]: [] } : [];
    if (fs.existsSync(filePath)) {
      rawData = safeYamlLoad(fs.readFileSync(filePath, "utf-8")) ?? rawData;
    }
    const items: Record<string, unknown>[] = Array.isArray(rawData)
      ? (rawData as Record<string, unknown>[])
      : resultsPath && typeof rawData === "object" && rawData !== null
        ? (((rawData as Record<string, unknown>)[resultsPath] as Record<string, unknown>[]) || [])
        : [];
    return { items, filePath, resultsPath };
  }

  function writeLocalItems(
    dbm: DatabaseManager,
    dbName: string,
    filePath: string,
    resultsPath: string | undefined,
    items: Record<string, unknown>[],
    filename: string,
    contentRoot: string,
  ) {
    const data: unknown = resultsPath ? { [resultsPath]: items } : items;
    const yamlStr = safeYamlDump(data, { lineWidth: 120 });
    if (!fs.existsSync(path.dirname(filePath))) {
      throw new Error(`Database directory not found`);
    }
    fs.writeFileSync(filePath, yamlStr);
    dbm.clearCache(dbName);
    const relPath = `db/${dbName}/${filename}`;
    markFileAsModified(relPath, "api", undefined, contentRoot);
  }

  app.post("/api/databases/:name/items", async (req, res) => {
    try {
      const dbName = req.params.name;
      const { item, items: bulkItems } = req.body as {
        item?: Record<string, unknown>;
        items?: Record<string, unknown>[];
      };

      const newItems: Record<string, unknown>[] = bulkItems
        ? bulkItems
        : item
          ? [item]
          : [];
      if (newItems.length === 0) {
        res.status(400).json({ error: "Provide item or items in the request body" });
        return;
      }

      const dbm = getDB(res);
      const config = dbm.get(dbName);
      const editor = (config as { editor?: Record<string, { type?: string; schema?: unknown }> }).editor;
      const coercedItems: Record<string, unknown>[] = [];
      for (let i = 0; i < newItems.length; i++) {
        const coerced = validateAndCoerceJsonFields(newItems[i], editor);
        if (!coerced.ok) {
          res.status(400).json(jsonFieldFailureHttpBody(coerced.failures));
          return;
        }
        const relationCoerced = validateAndCoerceRelationFields(coerced.fields, editor);
        if (!relationCoerced.ok) {
          res.status(400).json(relationFieldFailureHttpBody(relationCoerced.failures));
          return;
        }
        coercedItems.push(relationCoerced.fields);
      }
      const localConfig = config.source.local!;
      const { items: existing, filePath, resultsPath } = readLocalItems(dbm, dbName, getContentRoot(res));
      writeLocalItems(dbm, dbName, filePath, resultsPath, [...existing, ...coercedItems], localConfig.filename, getContentRoot(res));
      res.json({ success: true, count: existing.length + coercedItems.length });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      res.status(msg.includes("not found") ? 404 : 500).json({ error: msg });
    }
  });

  app.patch("/api/databases/:name/items/:index", async (req, res) => {
    try {
      const dbName = req.params.name;
      const idx = parseInt(req.params.index, 10);
      if (isNaN(idx) || idx < 0) {
        res.status(400).json({ error: "Invalid index" });
        return;
      }
      const newData = req.body as Record<string, unknown>;
      if (!newData || typeof newData !== "object") {
        res.status(400).json({ error: "Request body must be a JSON object" });
        return;
      }

      const dbm = getDB(res);
      const config = dbm.get(dbName);
      const editor = (config as { editor?: Record<string, { type?: string; schema?: unknown }> }).editor;
      const coerced = validateAndCoerceJsonFields(newData, editor);
      if (!coerced.ok) {
        res.status(400).json(jsonFieldFailureHttpBody(coerced.failures));
        return;
      }
      const relationCoerced = validateAndCoerceRelationFields(coerced.fields, editor);
      if (!relationCoerced.ok) {
        res.status(400).json(relationFieldFailureHttpBody(relationCoerced.failures));
        return;
      }
      const localConfig = config.source.local!;
      const { items, filePath, resultsPath } = readLocalItems(dbm, dbName, getContentRoot(res));
      if (idx >= items.length) {
        res.status(404).json({ error: `Item at index ${idx} not found` });
        return;
      }
      items[idx] = { ...items[idx], ...relationCoerced.fields };
      writeLocalItems(dbm, dbName, filePath, resultsPath, items, localConfig.filename, getContentRoot(res));
      res.json({ success: true, item: items[idx] });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      res.status(msg.includes("not found") ? 404 : 500).json({ error: msg });
    }
  });

  app.delete("/api/databases/:name/items/:index", async (req, res) => {
    try {
      const dbName = req.params.name;
      const idx = parseInt(req.params.index, 10);
      if (isNaN(idx) || idx < 0) {
        res.status(400).json({ error: "Invalid index" });
        return;
      }

      const dbm = getDB(res);
      const config = dbm.get(dbName);
      const localConfig = config.source.local!;
      const { items, filePath, resultsPath } = readLocalItems(dbm, dbName, getContentRoot(res));
      if (idx >= items.length) {
        res.status(404).json({ error: `Item at index ${idx} not found` });
        return;
      }
      items.splice(idx, 1);
      writeLocalItems(dbm, dbName, filePath, resultsPath, items, localConfig.filename, getContentRoot(res));
      res.json({ success: true, count: items.length });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      res.status(msg.includes("not found") ? 404 : 500).json({ error: msg });
    }
  });

  app.post("/api/databases/:name/refresh", async (req, res) => {
    const name = req.params.name;
    const dbm = getDB(res);
    try {
      const result = await dbm.fetchItems(name, true);
      res.json(result);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      let label = name;
      try {
        label = dbm.get(name).name || name;
      } catch {
        // database config unavailable
      }
      res.status(500).json({
        error: message || `There was an error fetching "${label}".`,
        database: name,
        label,
      });
    }
  });

  app.post("/api/databases/:name/reindex", async (req, res) => {
    try {
      const name = req.params.name;
      const dbm = getDB(res);
      const config = dbm.get(name);
      const vsConfig = (config as any).vector_search as { enabled?: boolean; fields?: string[] } | undefined;
      if (!vsConfig?.enabled || !vsConfig.fields?.length) {
        res.status(400).json({ error: "Semantic search is not enabled for this database" });
        return;
      }
      const cached = await dbm.fetchItems(name, false);
      const { indexItems } = await import("../vector-search");
      indexItems(name, cached.items, vsConfig.fields).catch((err: unknown) => {
        log.error({ err: err }, `[reindex] Background indexing error for "${name}":`);
      });
      res.json({ success: true, count: cached.items.length });
    } catch (err: unknown) {
      res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  app.get("/api/databases/:name/job-status", async (req, res) => {
    try {
      const allStates = getAllJobStates(getContentRoot(res));
      const defaultState: DbJobState = {
        fetch: { status: "idle" },
        index: { status: "idle" },
      };
      const state = allStates[req.params.name] ?? defaultState;
      const { getDatabaseSearchCacheStats } = await import("../database-search");
      const searchCache = getDatabaseSearchCacheStats(req.params.name);
      res.json({
        ...state,
        search_cache: {
          memoryEntries: searchCache.memoryEntries,
          lastWrittenAt: searchCache.lastWrittenAt,
        },
      });
    } catch (err: unknown) {
      res
        .status(500)
        .json({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  /** On-demand GCS search-cache count — do not poll from the KPI card. */
  app.get("/api/databases/:name/search-cache-stats", async (req, res) => {
    try {
      const {
        getDatabaseSearchCacheStats,
        countDatabaseSearchCacheGcs,
      } = await import("../database-search");
      const memory = getDatabaseSearchCacheStats(req.params.name);
      const includeGcs = req.query.includeGcs === "1" || req.query.includeGcs === "true";
      const payload: Record<string, unknown> = {
        memoryEntries: memory.memoryEntries,
        lastWrittenAt: memory.lastWrittenAt,
      };
      if (includeGcs) {
        payload.gcsEntries = await countDatabaseSearchCacheGcs(
          req.params.name,
          getContentRootName(res),
        );
      }
      res.json(payload);
    } catch (err: unknown) {
      res
        .status(500)
        .json({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  app.post("/api/databases/:name/ai/fix-transform", async (req, res) => {
    try {
      const { getLLMService } = await import("../ai/LLMService");
      const llm = getLLMService();
      const { fieldKey, fnBody, errorMessage, sampleInput, sampleRawItem } = req.body as {
        fieldKey: string;
        fnBody: string;
        errorMessage: string;
        sampleInput?: string;
        sampleRawItem?: Record<string, unknown>;
      };
      if (!fieldKey || !fnBody || !errorMessage) {
        res.status(400).json({ error: "fieldKey, fnBody, errorMessage required" });
        return;
      }
      const prompt = `You are fixing a JavaScript transform function used in a data pipeline.

The function is an arrow function expression assigned to a field named "${fieldKey}".
It receives two arguments: \`value\` (the raw field value) and \`item\` (the full raw record as an object).
It must return the transformed value for the field.

CURRENT FUNCTION BODY:
\`\`\`js
${fnBody}
\`\`\`

ERROR when running:
${errorMessage}
${sampleInput !== undefined ? `\nSample input value (value argument): ${JSON.stringify(sampleInput)}` : ""}
${sampleRawItem ? `\nSample raw item (item argument keys): ${Object.keys(sampleRawItem).join(", ")}` : ""}

Write a fixed version. Return ONLY the function expression itself (e.g. \`(value, item) => ...\`), no explanation, no markdown, no backticks, no semicolons at the end.`;

      const result = await llm.complete(prompt, { temperature: 0.2, maxTokens: 400 });
      const cleaned = result.trim().replace(/^```[a-z]*\n?/, "").replace(/\n?```$/, "").trim();
      res.json({ fnBody: cleaned });
    } catch (err: unknown) {
      res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  app.put("/api/databases/:name/config", (req, res) => {
    try {
      const config = req.body;
      if (!config || !config.name || !config.source) {
        res
          .status(400)
          .json({ error: "Invalid config: name and source are required" });
        return;
      }
      if (config.editor !== undefined && config.editor !== null) {
        const editorCheck = validateEditorHintsHaveJsonSchemas(config.editor);
        if (!editorCheck.ok) {
          res.status(400).json({ error: editorCheck.error, field: editorCheck.field });
          return;
        }
        const relationCheck = validateEditorHintsHaveRelationSources(config.editor);
        if (!relationCheck.ok) {
          res.status(400).json({ error: relationCheck.error, field: relationCheck.field });
          return;
        }
      }
      getDB(res).update(req.params.name, config);
      res.json({ success: true });
    } catch (err: unknown) {
      res
        .status(500)
        .json({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  app.delete("/api/databases/:name", (req, res) => {
    try {
      getDB(res).delete(req.params.name);
      res.json({ success: true });
    } catch (err: unknown) {
      res
        .status(500)
        .json({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  app.post("/api/databases/:name/test", async (req, res) => {
    try {
      const source = req.body?.source;
      if (!source) {
        res.status(400).json({ error: "source config required in body" });
        return;
      }
      const dbSlug = req.params.name === "_test" ? req.body?.slug : req.params.name;
      const result = await getDB(res).test(source, dbSlug);
      res.json(result);
    } catch (err: unknown) {
      res
        .status(500)
        .json({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  // ── Dataset file management routes ───────────────────────────

  const DATASET_EXTENSIONS_SET = new Set([".json", ".csv", ".yaml", ".yml"]);

  app.get("/api/databases/check-file", (req, res) => {
    const slug = (req.query.slug as string) || "";
    const filename = (req.query.filename as string) || "";
    if (!slug || !filename) {
      res.status(400).json({ error: "slug and filename are required" });
      return;
    }
    const filePath = path.join(getContentRoot(res), "db", slug, filename);
    res.json({ exists: fs.existsSync(filePath), path: `${getContentRootName(res)}/db/${slug}/${filename}` });
  });

  app.get("/api/databases/datasets", async (req, res) => {
    try {
      const results: {
        id: string;
        filename: string;
        dbSlug: string;
        provider: "local";
        path: string;
      }[] = [];

      const dbBaseDir = path.join(getContentRoot(res), "db");
      if (fs.existsSync(dbBaseDir)) {
        const dbDir = dbBaseDir;
        const slugDirs = fs.readdirSync(dbDir).filter((f) => {
          return fs.statSync(path.join(dbDir, f)).isDirectory();
        });
        for (const slug of slugDirs) {
          const slugDir = path.join(dbDir, slug);
          const files = fs.readdirSync(slugDir).filter((f) => {
            const ext = path.extname(f).toLowerCase();
            return DATASET_EXTENSIONS_SET.has(ext) && f !== "config.yml";
          });
          for (const file of files) {
            results.push({
              id: `${slug}/${file}`,
              filename: file,
              dbSlug: slug,
              provider: "local",
              path: `${getContentRootName(res)}/db/${slug}/${file}`,
            });
          }
        }
      }

      res.json({ datasets: results });
    } catch (err: unknown) {
      res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  const datasetUpload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 50 * 1024 * 1024 },
    fileFilter: (_req, file, cb) => {
      const ext = path.extname(file.originalname).toLowerCase();
      if (DATASET_EXTENSIONS_SET.has(ext)) {
        cb(null, true);
      } else {
        cb(new Error(`Unsupported file type: ${ext}. Allowed: .json, .csv, .yaml, .yml`));
      }
    },
  });

  app.post(
    "/api/databases/upload-dataset",
    datasetUpload.single("file"),
    async (req, res) => {
      try {
        const file = (req as any).file;
        if (!file) {
          res.status(400).json({ error: "No file provided" });
          return;
        }
        const slug = (req.body?.slug as string) || "";
        if (!slug || !/^[a-z0-9_-]+$/.test(slug)) {
          res.status(400).json({ error: "A valid database slug is required" });
          return;
        }
        const ext = path.extname(file.originalname).toLowerCase();
        if (!DATASET_EXTENSIONS_SET.has(ext)) {
          res.status(400).json({ error: `Unsupported file type: ${ext}` });
          return;
        }

        const targetDir = path.join(getContentRoot(res), "db", slug);
        if (!fs.existsSync(targetDir)) {
          fs.mkdirSync(targetDir, { recursive: true });
        }

        const filename = file.originalname;
        const targetPath = path.join(targetDir, filename);
        fs.writeFileSync(targetPath, file.buffer);

        res.json({
          provider: "local",
          filename,
          slug,
          path: `${getContentRootName(res)}/db/${slug}/${filename}`,
        });
      } catch (error: any) {
        res.status(500).json({ error: error.message || "Upload failed" });
      }
    }
  );
}
