import type { Express, Request, Response } from "express";
import { getDefaultContentRoot, getSiteConfigs } from "../site-config";
import { createServer, type Server } from "http";
import { storage } from "../storage";
import { geoGet, geoSet } from "../geo-cache";
import { getQueueStats, enqueueOptimization, getPendingOptimizations, getFailedEntries, retryFailedImages, resetOptimizeSession, getOptimizeSession, enqueueExternalImage } from "../image-registry";
import { getAllQueueState } from "../image-queue-state";
import { displayIndexStatus, getAllJobStates, type DbJobState } from "../db-job-state";
import { countDatabaseCacheErrors } from "../../scripts/validation/shared/databaseHealthChecks";
import { getValidationCacheService } from "../services/validationCacheService";
import { getDatabaseUsage } from "../database-usage";

import * as fs from "fs";
import * as path from "path";
import * as yaml from "js-yaml";
import { execSync as _execSync } from "child_process";
import {
  versioningUpdateSchema,
  type CareerProgram,
  type LandingPage,
  type LocationPage,
  type TemplatePage,
} from "@shared/schema";
import { parseDatabaseItemsSort, sortDatabaseItemEntries } from "@shared/database-items-sort";
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
import { databaseManager, redactDatabaseSourceConnection, type DatabaseManager } from "../database";
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
import { isEntryDetached, resolvePreviewBaseSlug } from "../shared-layout-entry";
import { getBaseUrl } from "../hreflang";
import * as userManager from "../user-manager";
import * as userStore from "../user-store";
import type { CapabilityName } from "../user-store";


import {

  BREATHECODE_HOST,
  extractToken,
  requireCapability,
  requireDatabasesBrowseAccess,
  isMcpLoopbackRequest,
  markContentFileModified,
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
import { api } from "../rate-limit/api";
import { applyRowStamp, applyRowStampsBulk, stripRowStamp, verifiedStamp, type RowWriter } from "../database-row-stamp";
import { ROW_STAMP_KEY, readEvidenceConfig, rowTrust, validateEvidenceConfig } from "@shared/evidence-kinds";
import { archiveView, isArchiveCopyUrl, normalizeBackupArchiveUrl, rowProofLink } from "@shared/evidence-archive";
import { writeArchiveRecords } from "../evidence-archive/apply";
import { markRowsPendingArchive, queueArchiveJobs } from "../evidence-archive/on-save";
import { manualRecord, pendingRecord } from "../evidence-archive/rows";
import { isLiveServer } from "../live-server";
import {
  defaultMigrationDeps,
  listMigrations,
  markMigrationDone,
  startMigration,
} from "../data-migrations/service";
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
/** Event-store site key (what the applier reads events under). */
function getSiteKey(res: Response): string {
  return (res.locals.site as { contentRootName?: string } | undefined)?.contentRootName ?? getContentRootName(res);
}

/** Per-site DatabaseManager for the active request (multi-site / dev-site override aware). */
function getDB(res: Response): DatabaseManager {
  return (res.locals.site as import("../site-manager").SiteContext | undefined)?.database ?? databaseManager;
}

function getValidationCache(res: Response) {
  return (res.locals.site as any)?.validationCache ?? getValidationCacheService();
}

/** Who is writing a database row: MCP loopback (or x-mcp-author) is an agent; everything else is staff. */
function rowWriterFor(req: Request, author: string | null): RowWriter {
  const isAgent = isMcpLoopbackRequest(req) || typeof req.headers["x-mcp-author"] === "string";
  return { type: isAgent ? "agent" : "staff", author };
}

/** Domains whose fallback_content_folder is this site, so they also use its evidence databases. */
function sitesFallingBackTo(contentRootName: string): string[] {
  return getSiteConfigs()
    .filter((c) => c.fallbackContentFolder?.trim() === contentRootName && c.contentFolder !== contentRootName)
    .map((c) => c.domain);
}

export function registerDatabasesRoutes(app: Express): void {
  /** Legacy alias kept for cached clients: entry pages are served by /api/content-pages. */
  app.get("/api/database-single/:contentType/:slug", (req, res) => {
    const { contentType, slug } = req.params;
    const qIndex = req.originalUrl.indexOf("?");
    const query = qIndex >= 0 ? req.originalUrl.slice(qIndex) : "";
    res.redirect(307, `/api/content-pages/${encodeURIComponent(contentType)}/${encodeURIComponent(slug)}${query}`);
  });
  api.get(app, "/api/migrations", { rate: "staffWrite" }, async (req, res) => {
    const auth = await requireCapability(req, res, "migrations_run");
    if (!auth.authorized) return;
    try {
      res.json(listMigrations(defaultMigrationDeps(), getContentRootName(res)));
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  api.post(app, "/api/migrations/run", { rate: "staffWrite" }, async (req, res) => {
    const auth = await requireCapability(req, res, "migrations_run");
    if (!auth.authorized) return;
    const { filename, mode, confirm_rerun } = req.body || {};
    try {
      const result = startMigration(defaultMigrationDeps(), {
        filename,
        mode: mode === "dry_run" ? "dry_run" : "run",
        confirmRerun: confirm_rerun,
        actor: auth.author ?? auth.username ?? null,
        currentSite: getContentRootName(res),
      });
      if (!result.ok) {
        res.status(result.status).json({ success: false, code: result.code, error: result.error });
        return;
      }
      res.status(202).json({ success: true, run_id: result.run_id, recorded_in: result.recorded_in });
    } catch (err) {
      res.status(500).json({ success: false, error: err instanceof Error ? err.message : String(err) });
    }
  });

  api.post(app, "/api/migrations/mark-done", { rate: "staffWrite" }, async (req, res) => {
    const auth = await requireCapability(req, res, "migrations_run");
    if (!auth.authorized) return;
    const { filename, note } = req.body || {};
    try {
      const result = markMigrationDone(defaultMigrationDeps(), {
        filename,
        note,
        actor: auth.author ?? auth.username ?? null,
        currentSite: getContentRootName(res),
      });
      if (!result.ok) {
        res.status(result.status).json({ success: false, code: result.code, error: result.error });
        return;
      }
      res.json({ success: true, run: result.run, recorded_in: result.recorded_in });
    } catch (err) {
      res.status(500).json({ success: false, error: err instanceof Error ? err.message : String(err) });
    }
  });
  // ── Database routes ──────────────────────────────────────────
  app.get("/api/databases", async (req, res) => {
    const auth = await requireDatabasesBrowseAccess(req, res);
    if (!auth.authorized) return;
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

  app.post("/api/databases/reload", async (req, res) => {
    const auth = await requireCapability(req, res, "databases_manage");
    if (!auth.authorized) return;
    try {
      const dbm = getDB(res);
      dbm.reload();
      res.json({ success: true, count: dbm.list().length });
    } catch (err) {
      res.status(500).json({ error: String(err) });
    }
  });

  app.post("/api/databases", async (req, res) => {
    const auth = await requireCapability(req, res, "databases_manage");
    if (!auth.authorized) return;
    try {
      const { slug, config } = req.body;
      if (!slug || !config || !config.name || !config.source) {
        res
          .status(400)
          .json({ error: "slug, config.name, and config.source are required" });
        return;
      }
      const evidenceError = validateEvidenceConfig(config.evidence);
      if (evidenceError) {
        res.status(400).json({ error: evidenceError, field: "evidence" });
        return;
      }
      getDB(res).create(slug, config, auth.author ?? "api");
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

  app.get("/api/databases/:name", async (req, res) => {
    const auth = await requireDatabasesBrowseAccess(req, res);
    if (!auth.authorized) return;
    try {
      const dbm = getDB(res);
      const config = dbm.get(req.params.name);
      const cacheInfo = dbm.getCacheInfo(req.params.name);
      const dbCache = getValidationCache(res).getByDatabase(req.params.name);
      const errorCount = dbCache ? countDatabaseCacheErrors(dbCache.errors) : 0;
      res.json({
        name: req.params.name,
        config: auth.canManage ? config : redactDatabaseSourceConnection(config),
        connection_hidden: !auth.canManage,
        evidence_fallback_sites: sitesFallingBackTo(getContentRootName(res)),
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

  app.get("/api/databases/:name/usage", async (req, res) => {
    const auth = await requireDatabasesBrowseAccess(req, res);
    if (!auth.authorized) return;
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

  app.get("/api/databases/:name/raw-fields", async (req, res) => {
    const auth = await requireDatabasesBrowseAccess(req, res);
    if (!auth.authorized) return;
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

  app.get("/api/databases/:name/raw-sample", async (req, res) => {
    const auth = await requireDatabasesBrowseAccess(req, res);
    if (!auth.authorized) return;
    try {
      const rawItems = getDB(res).getRawItems(req.params.name);
      if (!rawItems || rawItems.length === 0) {
        res.json({ items: [], count: 0 });
        return;
      }
      const limit = Math.min(Number(req.query.limit) || 3, 10);
      res.json({ items: rawItems.slice(0, limit).map((i) => stripRowStamp(i)), count: rawItems.length });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes("not found")) {
        res.status(404).json({ error: msg });
      } else {
        res.status(500).json({ error: msg });
      }
    }
  });

  app.get("/api/databases/:name/raw-items", async (req, res) => {
    const auth = await requireDatabasesBrowseAccess(req, res);
    if (!auth.authorized) return;
    try {
      const page = Math.max(1, parseInt(String(req.query.page || "1"), 10));
      const limit = Math.max(1, Math.min(1000, parseInt(String(req.query.limit || "100"), 10)));
      const rawItems = getDB(res).getRawItems(req.params.name);
      const sort = parseDatabaseItemsSort(req.query.sort, req.query.dir);
      const entries = sortDatabaseItemEntries(
        (rawItems || []).map((item, index) => ({ item, index })),
        sort,
      );
      const total_count = entries.length;
      const start = (page - 1) * limit;
      const pageEntries = entries.slice(start, start + limit);
      res.json({
        items: pageEntries.map((e) => stripRowStamp(e.item as Record<string, unknown>)),
        indices: pageEntries.map((e) => e.index),
        total_count,
        page,
        limit,
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

  app.post("/api/databases/:name/analyze-fields", async (req, res) => {
    const auth = await requireCapability(req, res, "databases_manage");
    if (!auth.authorized) return;
    try {
      const dbName = req.params.name;
      const rawItems = getDB(res).getRawItems(dbName);
      if (!rawItems || rawItems.length === 0) {
        res
          .status(400)
          .json({ error: "No cached data available. Fetch data first." });
        return;
      }

      const sample = rawItems.slice(0, 3).map((i) => stripRowStamp(i));
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
    const auth = await requireDatabasesBrowseAccess(req, res);
    if (!auth.authorized) return;
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
    const auth = await requireDatabasesBrowseAccess(req, res);
    if (!auth.authorized) return;
    try {
      const page = Math.max(1, parseInt(String(req.query.page || "1"), 10));
      const limit = Math.max(1, Math.min(1000, parseInt(String(req.query.limit || "100"), 10)));
      const result = await getDB(res).fetchItems(req.params.name);

      // Apply tag/select field filters: filter[fieldName]=value (multi-value OR per field, AND across fields)
      const filterParam = req.query.filter as Record<string, string | string[]> | undefined;
      let entries = result.items.map((item, index) => ({ item, index }));
      if (filterParam && typeof filterParam === "object") {
        for (const [field, rawValues] of Object.entries(filterParam)) {
          const values = Array.isArray(rawValues) ? rawValues : [rawValues];
          if (values.length === 0) continue;
          entries = entries.filter(({ item }) => {
            const fieldVal = item[field];
            if (Array.isArray(fieldVal)) {
              return values.some((v) => (fieldVal as unknown[]).map(String).includes(v));
            }
            return values.includes(String(fieldVal ?? ""));
          });
        }
      }

      entries = sortDatabaseItemEntries(entries, parseDatabaseItemsSort(req.query.sort, req.query.dir));

      const total_count = entries.length;
      const start = (page - 1) * limit;
      const pageEntries = entries.slice(start, start + limit);
      const evidenceCfg = readEvidenceConfig(getDB(res).get(req.params.name).evidence);
      const rawRows = evidenceCfg ? getDB(res).getRawItems(req.params.name) ?? [] : [];
      res.json({
        ...result,
        items: pageEntries.map((e) => e.item),
        // Stored position of each returned row; PATCH/DELETE /items/:index expect this, not the page row.
        indices: pageEntries.map((e) => e.index),
        ...(evidenceCfg
          ? {
              evidence_trust: pageEntries.map((e) => rowTrust(rawRows[e.index] as Record<string, unknown> | undefined)),
              evidence_archive: pageEntries.map((e) =>
                archiveView(rawRows[e.index] as Record<string, unknown> | undefined, evidenceCfg.proof_field),
              ),
            }
          : {}),
        total_count,
        page,
        limit,
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

  app.put("/api/databases/:name/items", async (req, res) => {
    const auth = await requireCapability(req, res, "databases_edit_data", req.params.name);
    if (!auth.authorized) return;
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

      const { items: prevRows } = readLocalItems(dbm, dbName, getContentRoot(res));
      const stamped = applyRowStampsBulk({
        prevRows,
        nextRows: items as Record<string, unknown>[],
        evidence: config.evidence,
        writer: rowWriterFor(req, auth.author),
      });
      const archiveLinks = markRowsPendingArchive(stamped, config.evidence);
      const data: unknown = resultsPath ? { [resultsPath]: stamped } : stamped;
      const yamlStr = safeYamlDump(data, { lineWidth: 120 });
      fs.writeFileSync(filePath, yamlStr);

      dbm.clearCache(dbName);

      const relPath = `db/${dbName}/${filename}`;
      markContentFileModified(relPath, { author: auth.author ?? "api", req, contentRoot: getContentRoot(res) });
      queueArchiveJobs({ site: getSiteKey(res), contentRoot: getContentRoot(res), database: dbName, links: archiveLinks });

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
    writer?: { req: Request; author: string | null },
  ) {
    const data: unknown = resultsPath ? { [resultsPath]: items } : items;
    const yamlStr = safeYamlDump(data, { lineWidth: 120 });
    if (!fs.existsSync(path.dirname(filePath))) {
      throw new Error(`Database directory not found`);
    }
    fs.writeFileSync(filePath, yamlStr);
    dbm.clearCache(dbName);
    const relPath = `db/${dbName}/${filename}`;
    if (writer) {
      markContentFileModified(relPath, { author: writer.author ?? "api", req: writer.req, contentRoot });
    } else {
      markFileAsModified(relPath, "api", undefined, contentRoot);
    }
  }

  app.post("/api/databases/:name/items", async (req, res) => {
    const auth = await requireCapability(req, res, "databases_edit_data", req.params.name);
    if (!auth.authorized) return;
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
        coercedItems.push(
          applyRowStamp({
            prev: null,
            next: relationCoerced.fields,
            evidence: config.evidence,
            writer: rowWriterFor(req, auth.author),
          }),
        );
      }
      const localConfig = config.source.local!;
      const { items: existing, filePath, resultsPath } = readLocalItems(dbm, dbName, getContentRoot(res));
      const archiveLinks = markRowsPendingArchive(coercedItems, config.evidence);
      writeLocalItems(dbm, dbName, filePath, resultsPath, [...existing, ...coercedItems], localConfig.filename, getContentRoot(res), { req, author: auth.author });
      queueArchiveJobs({ site: getSiteKey(res), contentRoot: getContentRoot(res), database: dbName, links: archiveLinks });
      res.json({ success: true, count: existing.length + coercedItems.length });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      res.status(msg.includes("not found") ? 404 : 500).json({ error: msg });
    }
  });

  app.patch("/api/databases/:name/items/:index", async (req, res) => {
    const auth = await requireCapability(req, res, "databases_edit_data", req.params.name);
    if (!auth.authorized) return;
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
      items[idx] = applyRowStamp({
        prev: items[idx],
        next: { ...items[idx], ...relationCoerced.fields },
        evidence: config.evidence,
        writer: rowWriterFor(req, auth.author),
      });
      const archiveLinks = markRowsPendingArchive([items[idx]], config.evidence);
      writeLocalItems(dbm, dbName, filePath, resultsPath, items, localConfig.filename, getContentRoot(res), { req, author: auth.author });
      queueArchiveJobs({ site: getSiteKey(res), contentRoot: getContentRoot(res), database: dbName, links: archiveLinks });
      res.json({ success: true, item: stripRowStamp(items[idx]) });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      res.status(msg.includes("not found") ? 404 : 500).json({ error: msg });
    }
  });

  app.delete("/api/databases/:name/items/:index", async (req, res) => {
    const auth = await requireCapability(req, res, "databases_edit_data", req.params.name);
    if (!auth.authorized) return;
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
      writeLocalItems(dbm, dbName, filePath, resultsPath, items, localConfig.filename, getContentRoot(res), { req, author: auth.author });
      res.json({ success: true, count: items.length });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      res.status(msg.includes("not found") ? 404 : 500).json({ error: msg });
    }
  });

  api.post(app, "/api/databases/:name/items/:index/verify", { rate: "staffWrite" }, async (req, res) => {
    if (isMcpLoopbackRequest(req) || typeof req.headers["x-mcp-author"] === "string") {
      res.status(403).json({ error: "Verifying evidence rows is staff UI only.", code: "staff_only" });
      return;
    }
    const auth = await requireCapability(req, res, "databases_edit_data", req.params.name);
    if (!auth.authorized) return;
    try {
      const dbName = req.params.name;
      const idx = parseInt(req.params.index, 10);
      if (isNaN(idx) || idx < 0) {
        res.status(400).json({ error: "Invalid index" });
        return;
      }
      const dbm = getDB(res);
      const config = dbm.get(dbName);
      if (!readEvidenceConfig(config.evidence)) {
        res.status(400).json({ error: "This database is not an evidence source.", code: "not_evidence" });
        return;
      }
      const localConfig = config.source.local!;
      const { items, filePath, resultsPath } = readLocalItems(dbm, dbName, getContentRoot(res));
      if (idx >= items.length) {
        res.status(404).json({ error: `Item at index ${idx} not found` });
        return;
      }
      items[idx] = { ...items[idx], [ROW_STAMP_KEY]: verifiedStamp(auth.author) };
      writeLocalItems(dbm, dbName, filePath, resultsPath, items, localConfig.filename, getContentRoot(res), { req, author: auth.author });
      res.json({ success: true, index: idx, trust: rowTrust(items[idx]) });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      res.status(msg.includes("not found") || msg.includes("Only local") ? 404 : 500).json({ error: msg });
    }
  });

  /** Evidence row + its proof link for the staff archive routes; sends the error response and returns null otherwise. */
  async function evidenceRowForArchive(req: Request, res: Response) {
    if (isMcpLoopbackRequest(req) || typeof req.headers["x-mcp-author"] === "string") {
      res.status(403).json({ error: "Archive copies are managed from the staff Databases page only.", code: "staff_only" });
      return null;
    }
    const auth = await requireCapability(req, res, "databases_edit_data", req.params.name);
    if (!auth.authorized) return null;
    const idx = parseInt(req.params.index, 10);
    if (isNaN(idx) || idx < 0) {
      res.status(400).json({ error: "Invalid index" });
      return null;
    }
    const dbName = req.params.name;
    const dbm = getDB(res);
    const cfg = readEvidenceConfig(dbm.get(dbName).evidence);
    if (!cfg) {
      res.status(400).json({ error: "This database is not an evidence source.", code: "not_evidence" });
      return null;
    }
    const { items } = readLocalItems(dbm, dbName, getContentRoot(res));
    if (idx >= items.length) {
      res.status(404).json({ error: `Item at index ${idx} not found` });
      return null;
    }
    const link = rowProofLink(items[idx], cfg.proof_field);
    if (!link) {
      res.status(400).json({ error: `This row has no ${cfg.proof_field} to archive.`, code: "no_link" });
      return null;
    }
    return { auth, dbm, dbName, cfg, link, idx };
  }

  function archiveResponse(res: Response, dbm: DatabaseManager, dbName: string, idx: number, proofField: string) {
    const { items } = readLocalItems(dbm, dbName, getContentRoot(res));
    res.json({ success: true, index: idx, archive: archiveView(items[idx], proofField) });
  }

  api.post(app, "/api/databases/:name/items/:index/archive", { rate: "staffWrite" }, async (req, res) => {
    try {
      const ctx = await evidenceRowForArchive(req, res);
      if (!ctx) return;
      if (isArchiveCopyUrl(ctx.link)) {
        res.status(400).json({ error: "This row's link is already a saved archive copy.", code: "already_archive_link" });
        return;
      }
      if (!isLiveServer()) {
        res.status(409).json({
          error: "Archiving runs only on the live server. Use Archive now there, or paste a backup link.",
          code: "not_live_server",
        });
        return;
      }
      const at = new Date().toISOString();
      writeArchiveRecords({
        contentRoot: getContentRoot(res),
        database: ctx.dbName,
        sourceUrl: ctx.link,
        dbm: ctx.dbm,
        author: ctx.auth.author ?? "api",
        next: (prev) => pendingRecord(prev, ctx.link, at),
      });
      queueArchiveJobs({ site: getSiteKey(res), contentRoot: getContentRoot(res), database: ctx.dbName, links: [ctx.link] });
      archiveResponse(res, ctx.dbm, ctx.dbName, ctx.idx, ctx.cfg.proof_field);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      res.status(msg.includes("not found") || msg.includes("Only local") ? 404 : 500).json({ error: msg });
    }
  });

  api.put(app, "/api/databases/:name/items/:index/archive-link", { rate: "staffWrite" }, async (req, res) => {
    try {
      const ctx = await evidenceRowForArchive(req, res);
      if (!ctx) return;
      const url = normalizeBackupArchiveUrl((req.body as { url?: unknown } | undefined)?.url);
      if (!url) {
        res.status(400).json({ error: "Paste a full http(s) link to the saved copy.", code: "invalid_url" });
        return;
      }
      const at = new Date().toISOString();
      writeArchiveRecords({
        contentRoot: getContentRoot(res),
        database: ctx.dbName,
        sourceUrl: ctx.link,
        dbm: ctx.dbm,
        author: ctx.auth.author ?? "api",
        next: (prev) => manualRecord(prev, ctx.link, url, ctx.auth.author ?? null, at),
      });
      archiveResponse(res, ctx.dbm, ctx.dbName, ctx.idx, ctx.cfg.proof_field);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      res.status(msg.includes("not found") || msg.includes("Only local") ? 404 : 500).json({ error: msg });
    }
  });

  app.post("/api/databases/:name/refresh", async (req, res) => {
    const auth = await requireCapability(req, res, "databases_manage");
    if (!auth.authorized) return;
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
    const auth = await requireCapability(req, res, "databases_manage");
    if (!auth.authorized) return;
    try {
      const name = req.params.name;
      const dbm = getDB(res);
      const config = dbm.get(name);
      const vsConfig = (config as any).vector_search as { enabled?: boolean; fields?: string[] } | undefined;
      if (!vsConfig?.enabled || !vsConfig.fields?.length) {
        res.status(400).json({ error: "Semantic search is not enabled for this database" });
        return;
      }
      const cached = await dbm.fetchItems(name, false, { skipVectorIndex: true });
      const queued = await dbm.queueVectorIndex(name, "manual");
      res.json({
        success: true,
        queued: queued.queued || queued.deduped === true,
        ...(queued.deduped ? { already_queued: true } : {}),
        count: cached.items.length,
      });
    } catch (err: unknown) {
      res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  app.get("/api/databases/:name/job-status", async (req, res) => {
    const auth = await requireDatabasesBrowseAccess(req, res);
    if (!auth.authorized) return;
    try {
      const allStates = getAllJobStates(getContentRoot(res));
      const defaultState: DbJobState = {
        fetch: { status: "idle" },
        index: { status: "idle" },
      };
      const state = allStates[req.params.name] ?? defaultState;
      const { getDatabaseSearchCacheStats } = await import("../database-search");
      const searchCache = getDatabaseSearchCacheStats(req.params.name);
      let index = state.index;
      if (index.status === "queued") {
        const { getEngineStatus } = await import("../jobs/queue");
        const workerRunning = (await getEngineStatus()).status === "running";
        index = { ...index, status: displayIndexStatus(index, workerRunning) };
      }
      res.json({
        ...state,
        index,
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
    const auth = await requireDatabasesBrowseAccess(req, res);
    if (!auth.authorized) return;
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
    const auth = await requireCapability(req, res, "databases_manage");
    if (!auth.authorized) return;
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

  app.put("/api/databases/:name/config", async (req, res) => {
    const auth = await requireCapability(req, res, "databases_manage");
    if (!auth.authorized) return;
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
      const evidenceError = validateEvidenceConfig(config.evidence);
      if (evidenceError) {
        res.status(400).json({ error: evidenceError, field: "evidence" });
        return;
      }
      getDB(res).update(req.params.name, config, auth.author ?? "api");
      res.json({ success: true });
    } catch (err: unknown) {
      res
        .status(500)
        .json({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  app.delete("/api/databases/:name", async (req, res) => {
    const auth = await requireCapability(req, res, "databases_manage");
    if (!auth.authorized) return;
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
    const auth = await requireCapability(req, res, "databases_manage");
    if (!auth.authorized) return;
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

  app.get("/api/databases/check-file", async (req, res) => {
    const auth = await requireCapability(req, res, "databases_manage");
    if (!auth.authorized) return;
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
    const auth = await requireCapability(req, res, "databases_manage");
    if (!auth.authorized) return;
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
      const auth = await requireCapability(req, res, "databases_manage");
      if (!auth.authorized) return;
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
