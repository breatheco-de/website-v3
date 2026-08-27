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
import { decodeHtmlValues } from "@shared/htmlEncoding";
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
  getScreenshotIndex,
  getExampleScreenshotEntry,
  readScreenshotImage,
  saveScreenshot,
  deleteScreenshot,
} from "../component-screenshots";
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
import { isEntryDetached, isSharedLayoutType } from "../shared-layout-entry";
import {
  buildRawFileExplain,
  localeFromYamlFilename,
  rawFileRole,
} from "../raw-file-explain";
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
  requireStaffSession,
  isMcpLoopbackRequest,
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
  markContentFileModified,
} from "./_helpers";
import {
  DEMO_HASH_RE,
  createDemo,
  parseAndValidateDemoYaml,
  readDemo,
} from "../component-section-demos";
import { child } from "../logger";
const log = child({ module: "routes/components" });

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

export function registerComponentsRoutes(app: Express): void {

  // Disposable single-section demos (MCP create → /private/demo/:hash preview).
  // GET is public (hash is the secret). POST requires MCP loopback or staff.
  app.get("/api/component-section-demos/:hash", (req, res) => {
    const { hash } = req.params;
    if (!DEMO_HASH_RE.test(hash)) {
      res.status(400).json({ error: "Invalid demo hash" });
      return;
    }
    const demo = readDemo(hash);
    if (!demo) {
      res.status(404).json({ error: "Demo not found" });
      return;
    }
    res.json({
      hash,
      componentType: demo.component_type,
      version: demo.version,
      createdAt: demo.created_at,
      section: demo.section,
    });
  });

  app.post("/api/component-section-demos", async (req, res) => {
    try {
      if (!isMcpLoopbackRequest(req)) {
        const staff = await requireStaffSession(req, res);
        if (!staff.authorized) return;
      }

      const componentType =
        typeof req.body?.componentType === "string" ? req.body.componentType.trim() : "";
      const version =
        typeof req.body?.version === "string" ? req.body.version.trim() : undefined;
      const yamlText =
        typeof req.body?.yaml === "string"
          ? req.body.yaml
          : typeof req.body?.yamlText === "string"
            ? req.body.yamlText
            : "";

      if (!componentType) {
        res.status(400).json({ error: "componentType is required" });
        return;
      }
      if (!yamlText.trim()) {
        res.status(400).json({ error: "yaml is required" });
        return;
      }

      const contentFolder = getContentRootName(res);
      const validated = parseAndValidateDemoYaml({
        yamlText,
        componentType,
        version,
        contentFolder,
      });
      if (!validated.ok) {
        res.status(400).json({
          error: validated.error.message,
          property_path: validated.error.property_path,
          details: validated.error.details,
        });
        return;
      }

      let created: ReturnType<typeof createDemo>;
      try {
        created = createDemo({
          componentType,
          version: validated.version,
          section: validated.section,
        });
      } catch (e) {
        const message = (e as Error).message;
        if (message.includes("SITE_URL")) {
          res.status(500).json({ error: message });
          return;
        }
        throw e;
      }

      res.status(201).json({
        hash: created.hash,
        preview_url: created.previewUrl,
        path: created.relativePath,
        componentType,
        version: validated.version,
      });
    } catch (error) {
      log.error({ err: error }, "Failed to create component section demo");
      res.status(500).json({ error: "Failed to create component section demo" });
    }
  });

  // Schema.org API endpoints
  app.get("/api/schema", (req, res) => {
    const keys = getAvailableSchemaKeys();
    res.json({ available: keys });
  });

  app.get("/api/schema/:key", (req, res) => {
    const { key } = req.params;
    const locale = normalizeLocale(req.query.locale as string);

    const schema = getSchema(key, locale);

    if (!schema) {
      res.status(404).json({ error: "Schema not found" });
      return;
    }

    res.json(schema);
  });

  app.post("/api/schema/merge", (req, res) => {
    const { include, overrides } = req.body;
    const locale = normalizeLocale(req.query.locale as string);

    if (!include || !Array.isArray(include)) {
      res.status(400).json({ error: "include array required" });
      return;
    }

    const schemas = getMergedSchemas({ include, overrides }, locale);
    res.json({ schemas });
  });

  app.post("/api/debug/clear-schema-cache", (req, res) => {
    clearSchemaCache();
    clearSsrSchemaCache();
    res.json({ success: true, message: "Schema cache cleared" });
  });
  // Molecules Showcase API endpoint
  app.get("/api/molecules", (_req, res) => {
    const moleculesPath = path.join(getContentRoot(res), "molecules.json");
    try {
      const moleculesData = JSON.parse(fs.readFileSync(moleculesPath, "utf-8"));
      res.json(moleculesData);
    } catch (error) {
      res.status(500).json({
        error: "Failed to load molecules data",
        details: String(error),
      });
    }
  });

  // Component Registry API endpoints
  app.get("/api/component-registry", (req, res) => {
    const overview = getRegistryOverview(getContentRootName(res));
    res.json(overview);
  });

  // Field editors endpoint - returns all field editor configs from component registry
  app.get("/api/component-registry/field-editors", (_req, res) => {
    const fieldEditors = loadAllFieldEditors(getContentRootName(res));
    res.json(fieldEditors);
  });

  app.get("/api/component-registry/:componentType", (req, res) => {
    const { componentType } = req.params;
    const info = getComponentInfo(componentType);

    if (!info) {
      res.status(404).json({ error: "Component not found" });
      return;
    }

    res.json(info);
  });

  app.get("/api/component-registry/:componentType/validate", (req, res) => {
    const { componentType } = req.params;
    const version = req.query.version as string | undefined;

    // Dynamic import to avoid circular dependencies
    import("../../scripts/utils/validateComponent")
      .then(({ validateComponent }) => {
        const result = validateComponent(componentType, version);
        res.json(result);
      })
      .catch((error) => {
        res.status(500).json({
          error: "Failed to load validation module",
          details: String(error),
        });
      });
  });

  app.get("/api/component-registry/:componentType/versions", (req, res) => {
    const { componentType } = req.params;
    const versions = listVersions(componentType);
    res.json({ versions });
  });

  app.get(
    "/api/component-registry/:componentType/:version/schema",
    (req, res) => {
      const { componentType, version } = req.params;
      const schema = loadSchema(componentType, version);

      if (!schema) {
        res.status(404).json({ error: "Schema not found" });
        return;
      }

      res.json(schema);
    },
  );

  app.get(
    "/api/component-registry/:componentType/:version/examples",
    (req, res) => {
      const { componentType, version } = req.params;
      const examples = loadExamples(componentType, version);
      res.json({ examples });
    },
  );

  app.get(
    "/api/component-registry/:componentType/:version/example-path",
    (req, res) => {
      const { componentType, version } = req.params;
      const filePath = getExampleFilePath(componentType, version);
      res.json({ path: filePath });
    },
  );

  app.post(
    "/api/component-registry/:componentType/create-version",
    (req, res) => {
      const { componentType } = req.params;
      const { baseVersion } = req.body;

      if (!baseVersion) {
        res.status(400).json({ error: "baseVersion required" });
        return;
      }

      const result = createNewVersion(componentType, baseVersion);

      if (!result.success) {
        res.status(400).json({ error: result.error });
        return;
      }

      res.json({ success: true, newVersion: result.newVersion });
    },
  );

  app.post(
    "/api/component-registry/:componentType/:version/save-example",
    (req, res) => {
      const { componentType, version } = req.params;
      const { exampleName, yamlContent } = req.body;

      if (!exampleName || !yamlContent) {
        res.status(400).json({ error: "exampleName and yamlContent required" });
        return;
      }

      const result = saveExample(
        componentType,
        version,
        exampleName,
        yamlContent,
      );

      if (!result.success) {
        res.status(400).json({ error: result.error });
        return;
      }

      if (result.filePath) {
        const relPath = path.relative(process.cwd(), result.filePath);
        markFileAsModified(relPath, undefined, new Set([relPath]));
      }

      res.json({ success: true });
    },
  );

  app.post(
    "/api/component-registry/:componentType/:version/examples",
    (req, res) => {
      const { componentType, version } = req.params;
      const { yamlContent, sectionId, name, description } = req.body as {
        yamlContent?: string;
        sectionId?: string;
        name?: string;
        description?: string;
      };

      if (!yamlContent) {
        res.status(400).json({ error: "yamlContent is required" });
        return;
      }

      const displayName = typeof name === "string" ? name : undefined;
      const desc = typeof description === "string" ? description : undefined;

      const result = createExample(componentType, version, yamlContent, sectionId, {
        displayName,
        description: desc,
      });

      if (!result.success) {
        res.status(400).json({ error: result.error });
        return;
      }

      if (result.filePath) {
        const relPath = path.relative(process.cwd(), result.filePath);
        markFileAsModified(relPath, undefined, new Set([relPath]));
      }

      res.json({ success: true, filename: result.filename, exampleName: result.exampleName });
    }
  );

  app.get(
    "/api/component-registry/:componentType/variant-impact",
    (req, res) => {
      const { componentType } = req.params;
      const { version, exampleName } = req.query as { version?: string; exampleName?: string };

      if (!version || !exampleName) {
        res.status(400).json({ error: "version and exampleName are required" });
        return;
      }

      const variantName = getVariantByExample(componentType, version, exampleName);
      if (!variantName) {
        res.status(404).json({ error: `Could not determine variant for example "${exampleName}"` });
        return;
      }

      const toPascal = (s: string) =>
        s.replace(/[-_](.)/g, (_, c: string) => c.toUpperCase()).replace(/^(.)/, (c: string) => c.toUpperCase());
      const componentName = `${toPascal(componentType)}${toPascal(variantName)}`;
      const tsxPath = `client/src/components/${componentType}/variants/${componentName}.tsx`;

      const examples = getVariantExamples(componentType, variantName).map((e) => e.name);

      const pagesRaw = getCI(res).removeAllVariantSectionsFromPages(componentType, variantName, true);
      const pagesMap = new Map<string, { count: number; sectionIds: string[] }>();
      for (const p of pagesRaw) {
        const key = `/${p.locale}/${p.slug}`;
        const existing = pagesMap.get(key);
        if (existing) {
          existing.count += p.removedCount;
          existing.sectionIds.push(...p.removedSectionIds);
        } else {
          pagesMap.set(key, { count: p.removedCount, sectionIds: p.removedSectionIds });
        }
      }
      const pages = Array.from(pagesMap.entries()).map(([path, data]) => ({
        path,
        count: data.count,
        sectionIds: data.sectionIds,
      }));

      res.json({ variantName, componentName, tsxPath, examples, pages });
    }
  );

  app.delete(
    "/api/component-registry/:componentType/versions/:version/examples/:exampleName",
    (req, res) => {
      const { componentType, version, exampleName } = req.params;
      const result = deleteExample(componentType, version, decodeURIComponent(exampleName));
      if (!result.success) {
        res.status(400).json({ error: result.error });
        return;
      }
      if (result.filePath) {
        const relPath = path.relative(process.cwd(), result.filePath);
        markFileAsModified(relPath, undefined, new Set([relPath]));
      }
      res.json({ success: true });
    }
  );

  app.delete(
    "/api/component-registry/:componentType/variants/:variantName",
    (req, res) => {
      const { componentType, variantName } = req.params;

      const variantResult = deleteVariant(componentType, decodeURIComponent(variantName));
      if (!variantResult.success) {
        res.status(400).json({ error: variantResult.error });
        return;
      }

      const cwd = process.cwd();
      const allDeletedPaths = [
        variantResult.tsxPath,
        ...variantResult.deletedExamplePaths,
      ];
      const relPaths = allDeletedPaths.map((p) => path.relative(cwd, p));
      const exceptions = new Set(relPaths);
      for (const relPath of relPaths) {
        markFileAsModified(relPath, undefined, exceptions);
      }

      const pagesAffected = getCI(res).removeAllVariantSectionsFromPages(componentType, decodeURIComponent(variantName));

      res.json({
        success: true,
        deletedExamples: variantResult.deletedExamples,
        pagesAffected: pagesAffected.length,
      });
    }
  );

  // Component gallery screenshot cache (private admin)
  app.get("/api/private/component-screenshots", (req, res) => {
    const folder = getContentRootName(res);
    const overview = getRegistryOverview(folder);
    res.json(getScreenshotIndex(overview.components, folder));
  });

  app.get("/api/private/component-screenshots/:componentType", (req, res) => {
    const { componentType } = req.params;
    const folder = getContentRootName(res);
    const example =
      typeof req.query.example === "string" && req.query.example.trim()
        ? req.query.example.trim()
        : null;
    const image = readScreenshotImage(componentType, example, folder);
    if (!image) {
      res.status(404).json({ error: "Screenshot not found" });
      return;
    }
    res.setHeader("Content-Type", "image/webp");
    // Private admin cache — avoid long-lived browser cache so refreshes show new captures
    res.setHeader("Cache-Control", "private, no-cache, must-revalidate");
    res.send(image);
  });

  app.put("/api/private/component-screenshots/:componentType", express.raw({ type: "image/webp", limit: "5mb" }), (req, res) => {
    const { componentType } = req.params;
    const version = typeof req.query.version === "string" ? req.query.version : "";
    const example = typeof req.query.example === "string" ? req.query.example : "";
    const sourceMtime = Number(req.query.sourceMtime);
    const sourceSize = Number(req.query.sourceSize);
    const exampleKeyed =
      req.query.keyed === "1" ||
      req.query.keyed === "true" ||
      req.query.exampleKeyed === "1";

    if (!version || !example) {
      res.status(400).json({ error: "version and example query params required" });
      return;
    }
    if (!Number.isFinite(sourceMtime) || !Number.isFinite(sourceSize)) {
      res.status(400).json({ error: "sourceMtime and sourceSize query params required" });
      return;
    }

    const image = Buffer.isBuffer(req.body) ? req.body : Buffer.from(req.body ?? []);
    if (image.length === 0) {
      res.status(400).json({ error: "Empty image body" });
      return;
    }

    const capturedAt = new Date().toISOString();
    const result = saveScreenshot(
      componentType,
      image,
      {
        version,
        example,
        sourceMtime,
        sourceSize,
        capturedAt,
      },
      { exampleKeyed, contentFolder: getContentRootName(res) },
    );
    if (!result.success) {
      res.status(500).json({ error: result.error || "Failed to save screenshot" });
      return;
    }
    const params = new URLSearchParams({ t: String(Date.parse(capturedAt)) });
    if (exampleKeyed) params.set("example", example);
    res.json({
      success: true,
      url: `/api/private/component-screenshots/${encodeURIComponent(componentType)}?${params}`,
    });
  });

  app.delete("/api/private/component-screenshots/:componentType", (req, res) => {
    const { componentType } = req.params;
    const example =
      typeof req.query.example === "string" && req.query.example.trim()
        ? req.query.example.trim()
        : null;
    const result = deleteScreenshot(componentType, example, getContentRootName(res));
    if (!result.success) {
      res.status(500).json({ error: result.error || "Failed to delete screenshot" });
      return;
    }
    res.json({ success: true });
  });

  /** Per-example screenshot index for the fork picker (lazy; not used by main gallery). */
  app.get("/api/private/component-screenshots/:componentType/examples", (req, res) => {
    const { componentType } = req.params;
    const version =
      typeof req.query.version === "string" && req.query.version
        ? req.query.version
        : undefined;
    const overview = getRegistryOverview(getContentRootName(res));
    const comp = overview.components.find((c) => c.type === componentType);
    const resolvedVersion = version || comp?.latestVersion || "v1.0";
    const examples = loadExamples(componentType, resolvedVersion);
    const index: Record<string, ReturnType<typeof getExampleScreenshotEntry>> = {};
    for (const ex of examples) {
      index[ex.name] = getExampleScreenshotEntry(
        componentType,
        ex.name,
        ex.sourceMtime,
        ex.sourceSize,
        getContentRootName(res),
      );
    }
    res.json({ version: resolvedVersion, examples, index });
  });

  app.get("/api/content/folder-files", (req, res) => {
    try {
      const folderPath = req.query.path as string;
      if (!folderPath) {
        res.status(400).json({ error: "Folder path is required" });
        return;
      }
      const normalizedPath = path.normalize(folderPath);
      if (
        !normalizedPath.startsWith(getContentRootName(res) + "/") ||
        normalizedPath.includes("..")
      ) {
        res.status(403).json({ error: "Access denied" });
        return;
      }
      const entry = getCI(res).findByPath(normalizedPath);
      if (!entry) {
        res.status(404).json({ error: "Folder not found" });
        return;
      }
      res.json({ files: entry.files, directory: entry.directory });
    } catch (error) {
      log.error({ err: error }, "Error listing folder:");
      res.status(500).json({ error: "Failed to list folder" });
    }
  });

  app.get("/api/content/resolve-folder", (req, res) => {
    try {
      const slug = req.query.slug as string;
      const type = req.query.type as string | undefined;
      if (!slug) {
        res.status(400).json({ error: "slug is required" });
        return;
      }
      const opts = type ? { contentType: type as any } : undefined;
      const matches = getCI(res).findBySlug(slug, opts);
      if (matches.length === 0) {
        res
          .status(404)
          .json({ error: "No content folder found for this slug" });
        return;
      }
      if (matches.length === 1) {
        const entry = matches[0];
        res.json({
          directory: entry.directory,
          contentType: entry.contentType,
          files: entry.files,
          title: entry.title,
        });
      } else {
        res.json({
          multiple: true,
          matches: matches.map((e) => ({
            directory: e.directory,
            contentType: e.contentType,
            files: e.files,
            title: e.title,
          })),
        });
      }
    } catch (error) {
      log.error({ err: error }, "Error resolving folder:");
      res.status(500).json({ error: "Failed to resolve folder" });
    }
  });

  app.get("/api/content/index", (_req, res) => {
    try {
      const entries = getCI(res).listAll();
      const stats = getCI(res).getStats();
      res.json({ entries, stats });
    } catch (error) {
      log.error({ err: error }, "Error listing content index:");
      res.status(500).json({ error: "Failed to list content index" });
    }
  });

  app.post("/api/content/index/refresh", (_req, res) => {
    try {
      getCI(res).refresh({ syncSlow: true });
      const stats = getCI(res).getStats();
      res.json({ refreshed: true, stats });
    } catch (error) {
      log.error({ err: error }, "Error refreshing content index:");
      res.status(500).json({ error: "Failed to refresh content index" });
    }
  });

  app.get("/api/content/file", (req, res) => {
    try {
      const filePath = req.query.path as string;

      if (!filePath) {
        res.status(400).json({ error: "File path is required" });
        return;
      }

      // Security: only allow files within the site's content directory
      const normalizedPath = path.normalize(filePath);
      if (
        !normalizedPath.startsWith(getContentRootName(res) + "/") ||
        normalizedPath.includes("..")
      ) {
        res.status(403).json({
          error: `Access denied: Only ${getContentRootName(res)} files allowed`,
        });
        return;
      }

      const fullPath = path.join(process.cwd(), normalizedPath);

      if (!fs.existsSync(fullPath)) {
        res.status(404).json({ error: "File not found" });
        return;
      }

      const content = fs.readFileSync(fullPath, "utf-8");
      res.type("text/yaml").send(content);
    } catch (error) {
      log.error({ err: error }, "Error reading file:");
      res.status(500).json({ error: "Failed to read file" });
    }
  });

  app.get("/api/content/raw-file", (req, res) => {
    try {
      const contentType = req.query.contentType as string;
      const slug = req.query.slug as string;
      const locale = (req.query.locale as string) || getDefaultLocale();

      if (!contentType || !slug) {
        res.status(400).json({ error: "contentType and slug are required" });
        return;
      }

      if (!isValidType(contentType)) {
        res.status(400).json({ error: `Unknown content type: ${contentType}` });
        return;
      }
      const contentRoot = getContentRoot(res);
      const folder = getFolder(contentType, contentRoot);
      const contentRootName = getContentRootName(res);
      const baseDir = path.join(contentRoot, folder);
      const isSharedLayout = isSharedLayoutType(contentType, contentRoot);

      // Type-level single template: `_common.single.yml` (+ optional `single.{locale}.yml`)
      // When variantSlug is provided, load `single.{variantSlug}.{locale}.yml` instead.
      if (slug === "_common.single") {
        const variantSlug = req.query.variantSlug as string | undefined;
        const files: {
          locale?: { path: string; content: string; role?: string; locale?: string };
          locales?: { path: string; content: string; locale: string; role?: string }[];
          common?: { path: string; content: string; role?: string };
        } = {};
        let localeFallback = false;
        let displayedLocale: string | null = null;

        const singleCommonPath = path.join(baseDir, "_common.single.yml");
        if (fs.existsSync(singleCommonPath)) {
          files.common = {
            path: `${contentRootName}/${folder}/_common.single.yml`,
            content: fs.readFileSync(singleCommonPath, "utf-8"),
            role: rawFileRole({ isTemplate: true, isCommon: true, variantSlug }),
          };
        }

        if (variantSlug) {
          // Variant template: single.{variantSlug}.{locale}.yml
          let singleLocalePath = path.join(baseDir, `single.${variantSlug}.${locale}.yml`);
          if (!fs.existsSync(singleLocalePath)) {
            const fallbackPath = path.join(baseDir, `single.${variantSlug}.en.yml`);
            if (fs.existsSync(fallbackPath)) {
              localeFallback = true;
              singleLocalePath = fallbackPath;
            }
          }
          if (fs.existsSync(singleLocalePath)) {
            const basename = path.basename(singleLocalePath);
            displayedLocale = localeFromYamlFilename(basename);
            files.locale = {
              path: `${contentRootName}/${folder}/${basename}`,
              content: fs.readFileSync(singleLocalePath, "utf-8"),
              locale: displayedLocale ?? locale,
              role: rawFileRole({ isTemplate: true, isCommon: false, variantSlug }),
            };
          }
        } else {
          // Default template: load every `single.{locale}.yml` (not variant files)
          const localeFiles: { path: string; content: string; locale: string; role: string }[] = [];
          if (fs.existsSync(baseDir)) {
            for (const name of fs.readdirSync(baseDir)) {
              const match = name.match(/^single\.([a-z]{2,5})\.yml$/i);
              if (!match) continue;
              const localeCode = match[1].toLowerCase();
              localeFiles.push({
                path: `${contentRootName}/${folder}/${name}`,
                content: fs.readFileSync(path.join(baseDir, name), "utf-8"),
                locale: localeCode,
                role: rawFileRole({ isTemplate: true, isCommon: false }),
              });
            }
          }
          localeFiles.sort((a, b) => {
            if (a.locale === locale) return -1;
            if (b.locale === locale) return 1;
            if (a.locale === "en") return -1;
            if (b.locale === "en") return 1;
            return a.locale.localeCompare(b.locale);
          });
          if (localeFiles.length > 0) {
            files.locales = localeFiles;
            files.locale = localeFiles[0];
            displayedLocale = localeFiles[0].locale;
          }
        }

        if (!files.locale && !files.common && !(files.locales && files.locales.length > 0)) {
          res.status(404).json({ exists: false });
          return;
        }

        const hasLocaleFile = !!(files.locale || (files.locales && files.locales.length > 0));
        const context = buildRawFileExplain({
          contentRootName,
          folder,
          contentType,
          slug: "_common.single",
          isTemplate: true,
          isSharedLayout,
          detached: false,
          requestedLocale: locale,
          variantSlug,
          localeFallback,
          displayedLocale,
          hasLocaleFile,
        });

        res.json({ exists: true, files, resolvedSlug: "_common.single", context });
        return;
      }

      let resolvedSlug = slug;
      try {
        resolvedSlug = getCI(res).resolveBaseSlug(slug, folder);
      } catch {
        // keep original slug if resolution fails
      }

      let contentDir = path.join(baseDir, resolvedSlug);

      if (!fs.existsSync(contentDir)) {
        const subdirs = fs.existsSync(baseDir)
          ? fs
              .readdirSync(baseDir, { withFileTypes: true })
              .filter((d) => d.isDirectory())
              .map((d) => d.name)
          : [];
        for (const dir of subdirs) {
          const candidateDir = path.join(baseDir, dir);
          const ymlFiles = fs
            .readdirSync(candidateDir)
            .filter((f) => f.endsWith(".yml") && f !== "_common.yml");
          for (const yf of ymlFiles) {
            try {
              const raw = fs.readFileSync(path.join(candidateDir, yf), "utf-8");
              const slugMatch = raw.match(/^slug:\s*(.+)$/m);
              if (slugMatch && slugMatch[1].trim() === slug) {
                resolvedSlug = dir;
                contentDir = candidateDir;
                break;
              }
            } catch {
              /* skip unreadable files */
            }
          }
          if (contentDir === candidateDir) break;
        }
      }

      const variantSlug = req.query.variantSlug as string | undefined;
      const localePath = variantSlug
        ? path.join(contentDir, `${variantSlug}.${locale}.yml`)
        : path.join(contentDir, `${locale}.yml`);
      const commonPath = path.join(contentDir, "_common.yml");
      const detached = isSharedLayout ? isEntryDetached(contentType, resolvedSlug, contentRoot) : false;

      const files: {
        locale?: { path: string; content: string; role?: string; locale?: string };
        common?: { path: string; content: string; role?: string };
      } = {};

      if (fs.existsSync(localePath)) {
        files.locale = {
          path: variantSlug
            ? `${contentRootName}/${folder}/${resolvedSlug}/${variantSlug}.${locale}.yml`
            : `${contentRootName}/${folder}/${resolvedSlug}/${locale}.yml`,
          content: fs.readFileSync(localePath, "utf-8"),
          locale,
          role: rawFileRole({ isTemplate: false, isCommon: false, variantSlug }),
        };
      }
      if (fs.existsSync(commonPath)) {
        files.common = {
          path: `${contentRootName}/${folder}/${resolvedSlug}/_common.yml`,
          content: fs.readFileSync(commonPath, "utf-8"),
          role: rawFileRole({ isTemplate: false, isCommon: true, variantSlug }),
        };
      }

      if (!files.locale && !files.common) {
        res.status(404).json({ exists: false });
        return;
      }

      const context = buildRawFileExplain({
        contentRootName,
        folder,
        contentType,
        slug: resolvedSlug,
        isTemplate: false,
        isSharedLayout,
        detached,
        requestedLocale: locale,
        variantSlug,
        localeFallback: false,
        displayedLocale: files.locale ? locale : null,
        hasLocaleFile: !!files.locale,
      });

      res.json({ exists: true, files, resolvedSlug, context });
    } catch (error) {
      log.error({ err: error }, "Error reading raw content file:");
      res.status(500).json({ error: "Failed to read content file" });
    }
  });

  app.put("/api/content/raw-file", async (req, res) => {
    try {
      req.body = decodeHtmlValues(req.body);
      const rawFilePath: string = req.body.filePath || "";

      // Reject writes to internal data files that could be used for privilege escalation
      const PROTECTED_RAW_PATTERNS = [
        /\.users-state\.json$/,
        /\.users-state\.ya?ml$/,
        /image-registry\.json$/,
      ];
      if (PROTECTED_RAW_PATTERNS.some((p) => p.test(rawFilePath))) {
        res.status(403).json({ error: "Writing to this path is not permitted via raw-file" });
        return;
      }

      // Derive contentType from filePath (e.g. 4geeks-com/courses/... → "courses").
      // Reject when content type cannot be determined — unscoped writes are not allowed.
      const contentRootPrefix = getContentRootName(res);
      const derivedContentType: string | undefined = (() => {
        const m = rawFilePath.match(new RegExp(`^${contentRootPrefix.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\/([^/]+)\\/`));
        return m ? m[1] : undefined;
      })();
      if (!derivedContentType) {
        res.status(400).json({ error: `Cannot determine content type from filePath; path must be under ${contentRootPrefix}/<contentType>/` });
        return;
      }

      const auth = await requireCapability(req, res, "content_edit_default", derivedContentType);
      if (!auth.authorized) return;

      const {
        filePath,
        content,
        author: requestAuthor,
      } = req.body as {
        filePath: string;
        content: string;
        author?: string;
      };
      // Prefer server-resolved author (from Breathecode identity) over client-provided value
      const authorName = auth.author || (requestAuthor && typeof requestAuthor === "string" ? requestAuthor : undefined);

      if (!filePath || typeof content !== "string") {
        res.status(400).json({ error: "filePath and content are required" });
        return;
      }

      const normalizedPath = path.normalize(filePath);
      if (
        !normalizedPath.startsWith(getContentRootName(res) + "/") ||
        normalizedPath.includes("..")
      ) {
        res.status(403).json({
          error: `Access denied: Only ${getContentRootName(res)} files allowed`,
        });
        return;
      }

      const fullPath = path.join(process.cwd(), normalizedPath);
      if (!fs.existsSync(fullPath)) {
        res.status(404).json({ error: "File not found" });
        return;
      }

      fs.writeFileSync(fullPath, content, "utf-8");
      markContentFileModified(normalizedPath, {
        author: authorName,
        req,
        contentRoot: getContentRoot(res),
      });
      clearRedirectCache();
      getCI(res).refresh({ syncSlow: true });

      // Derive content type from path (contentRoot/<folder>/...) for targeted invalidation
      const pathParts = normalizedPath.replace(/\\/g, "/").split("/");
      const folderSegment = pathParts[1]; // segment after contentRoot name
      const resolvedType = folderSegment ? getType(folderSegment) : undefined;

      // Targeted sitemap cache invalidation based on file path
      const rawDirSlug = pathParts[2];
      const rawFilename = pathParts[3];
      const rawLocale = rawFilename ? rawFilename.replace(/\.ya?ml$/, "") : "";
      if (resolvedType && rawDirSlug && getSupportedLocales().includes(rawLocale)) {
        refreshSitemapEntry(resolvedType, rawDirSlug, rawLocale);
      } else if (resolvedType && rawDirSlug && rawFilename === "_common.yml") {
        refreshSitemapEntriesForContentKey(resolvedType, rawDirSlug, getSupportedLocales());
      } else {
        clearSitemapCache();
      }

      invalidateContentCaches(resolvedType);

      res.json({ success: true });
    } catch (error) {
      log.error({ err: error }, "Error saving raw content file:");
      res.status(500).json({ error: "Failed to save content file" });
    }
  });

  // Section Bindings API
  app.get("/api/bindings", (_req, res) => {
    try {
      const groups = bindingManager.getAll();
      const siteId = getContentRootName(res);
      const enrichedGroups = groups.map((g) => {
        const lease = bindingManager.getActivePropagationLease(siteId, g.id, g.locale);
        return {
          ...g,
          lease: lease
            ? {
                status: "propagating" as const,
                holder: lease.holder,
                expiresAt: lease.expiresAt,
              }
            : undefined,
          members: g.members.map((m) => ({
          ...m,
          localeSlug: getCI(res).getLocaleSlug(
            m.slug,
            m.contentType,
            g.locale,
          ),
          sectionIndex: bindingManager.resolveSectionIndex(
            m.contentType,
            m.slug,
            m.sectionId,
            g.locale,
          ),
        })),
        };
      });
      res.json({ groups: enrichedGroups });
    } catch (error) {
      log.error({ err: error }, "Error fetching bindings:");
      res.status(500).json({ error: "Failed to fetch bindings" });
    }
  });

  app.get("/api/bindings/section", (req, res) => {
    try {
      const { contentType, slug, sectionIndex, locale } = req.query;
      if (!contentType || !slug || sectionIndex === undefined) {
        res
          .status(400)
          .json({ error: "Missing contentType, slug, or sectionIndex" });
        return;
      }
      const resolvedLocale = normalizeLocale((locale as string) || "en");
      const baseSlug = getCI(res).resolveBaseSlug(
        slug as string,
        contentType as string,
      );
      const group = bindingManager.findGroupForSectionByIndex(
        contentType as string,
        baseSlug,
        parseInt(sectionIndex as string, 10),
        resolvedLocale,
      );
      if (!group) {
        res.json({ group: null });
        return;
      }
      const enrichedGroup = {
        ...group,
        members: group.members.map((m) => ({
          ...m,
          localeSlug: getCI(res).getLocaleSlug(
            m.slug,
            m.contentType,
            group.locale,
          ),
          sectionIndex: bindingManager.resolveSectionIndex(
            m.contentType,
            m.slug,
            m.sectionId,
            group.locale,
          ),
        })),
      };
      res.json({ group: enrichedGroup });
    } catch (error) {
      log.error({ err: error }, "Error finding binding for section:");
      res.status(500).json({ error: "Failed to find binding" });
    }
  });

  app.get("/api/bindings/candidates", (req, res) => {
    try {
      const { component, locale } = req.query;
      if (!component || !locale) {
        res.status(400).json({ error: "Missing component or locale" });
        return;
      }

      const normalizedLocale = normalizeLocale(locale as string);
      const allEntries = getCI(res).listAll();
      const candidates: Array<{
        contentType: string;
        slug: string;
        localeSlug: string;
        sectionIndex: number;
        sectionId?: string;
        title?: string;
        alreadyBound?: string;
        alreadyBoundGroupName?: string;
      }> = [];

      for (const entry of allEntries) {
        const entryContentType = entry.contentType.replace(/s$/, "");
        if (!entry.locales.includes(normalizedLocale))
          continue;

        try {
          const localeForLoad = normalizedLocale;
          const { data: merged } = getCI(res).loadMergedContent(
            entryContentType,
            entry.slug,
            localeForLoad,
          );
          if (!merged) continue;
          const sections = merged.sections as Record<string, unknown>[];
          if (!Array.isArray(sections)) continue;

          for (let i = 0; i < sections.length; i++) {
            const section = sections[i];
            if (section && section.type === component) {
              const existingGroup = bindingManager.findGroupForSectionByIndex(
                entryContentType,
                entry.slug,
                i,
                normalizedLocale,
              );
              const sameLocaleGroup = existingGroup;
              candidates.push({
                contentType: entryContentType,
                slug: entry.slug,
                localeSlug: getCI(res).getLocaleSlug(
                  entry.slug,
                  entryContentType,
                  normalizedLocale,
                ),
                sectionIndex: i,
                sectionId: (section as Record<string, unknown>).section_id as
                  | string
                  | undefined,
                title:
                  ((merged.meta as Record<string, unknown>)?.title as string) ||
                  entry.title ||
                  entry.slug,
                alreadyBound: sameLocaleGroup?.id,
                alreadyBoundGroupName: sameLocaleGroup?.name,
              });
            }
          }
        } catch {
          // skip entries that fail to parse
        }
      }

      res.json({ candidates });
    } catch (error) {
      log.error({ err: error }, "Error finding binding candidates:");
      res.status(500).json({ error: "Failed to find candidates" });
    }
  });

  const requireEditAuth = (
    req: import("express").Request,
    res: import("express").Response,
  ): boolean => {
    const isDevelopment = process.env.NODE_ENV !== "production";
    if (isDevelopment) return true;
    const authHeader = req.headers.authorization;
    const debugToken = req.headers["x-debug-token"] as string | undefined;
    if (!authHeader?.startsWith("Token ") && !debugToken) {
      res.status(401).json({ error: "Authorization required" });
      return false;
    }
    return true;
  };

  app.post("/api/bindings", (req, res) => {
    try {
      if (!requireEditAuth(req, res)) return;
      const { component, locale, members, author: bindAuthor } = req.body;
      const bindAuthorName =
        bindAuthor && typeof bindAuthor === "string" ? bindAuthor : undefined;
      if (
        !component ||
        !locale ||
        !Array.isArray(members) ||
        members.length < 2
      ) {
        res.status(400).json({
          error: "Missing component, locale, or need at least 2 members",
        });
        return;
      }
      const normalizedLocale = normalizeLocale(locale);
      const resolvedMembers = members.map(
        (m: { contentType: string; slug: string; sectionIndex: number }) => {
          const memberBaseSlug = getCI(res).resolveBaseSlug(
            m.slug,
            m.contentType,
          );
          const sectionId = bindingManager.ensureSectionId(
            m.contentType,
            memberBaseSlug,
            m.sectionIndex,
            normalizedLocale,
            bindAuthorName,
          );
          return {
            contentType: m.contentType,
            slug: memberBaseSlug,
            sectionId,
          };
        },
      );
      const { name, sourceIndex } = req.body;
      const group = bindingManager.createGroup(
        component,
        normalizedLocale,
        resolvedMembers,
        {
          name,
          sourceIndex,
        },
        bindAuthorName,
      );
      const enrichedGroup = {
        ...group,
        members: group.members.map((m) => ({
          ...m,
          localeSlug: getCI(res).getLocaleSlug(
            m.slug,
            m.contentType,
            group.locale,
          ),
          sectionIndex: bindingManager.resolveSectionIndex(
            m.contentType,
            m.slug,
            m.sectionId,
            group.locale,
          ),
        })),
      };
      res.json({ group: enrichedGroup });
    } catch (error) {
      const msg =
        error instanceof Error ? error.message : "Failed to create binding";
      log.error({ err: error }, "Error creating binding:");
      res.status(400).json({ error: msg });
    }
  });

  app.patch("/api/bindings/:groupId", (req, res) => {
    try {
      if (!requireEditAuth(req, res)) return;
      const { groupId } = req.params;
      const { name, author: renameBindAuthor } = req.body;
      const renameBindAuthorName =
        renameBindAuthor && typeof renameBindAuthor === "string"
          ? renameBindAuthor
          : undefined;
      if (name === undefined) {
        res.status(400).json({ error: "Missing name field" });
        return;
      }
      const group = bindingManager.renameGroup(
        groupId,
        name,
        renameBindAuthorName,
      );
      res.json({ group });
    } catch (error) {
      const msg =
        error instanceof Error ? error.message : "Failed to rename binding";
      log.error({ err: error }, "Error renaming binding:");
      res.status(400).json({ error: msg });
    }
  });

  app.post("/api/bindings/:groupId/members", (req, res) => {
    try {
      if (!requireEditAuth(req, res)) return;
      const { groupId } = req.params;
      const {
        contentType,
        slug,
        sectionIndex,
        author: addMemberAuthor,
      } = req.body;
      const addMemberAuthorName =
        addMemberAuthor && typeof addMemberAuthor === "string"
          ? addMemberAuthor
          : undefined;
      if (!contentType || !slug || sectionIndex === undefined) {
        res
          .status(400)
          .json({ error: "Missing contentType, slug, or sectionIndex" });
        return;
      }
      const group = bindingManager.getGroupById(groupId);
      if (!group) {
        res.status(404).json({ error: "Binding group not found" });
        return;
      }
      const addBaseSlug = getCI(res).resolveBaseSlug(slug, contentType);
      const sectionId = bindingManager.ensureSectionId(
        contentType,
        addBaseSlug,
        parseInt(sectionIndex as string, 10),
        group.locale,
        addMemberAuthorName,
      );
      const updatedGroup = bindingManager.addMember(
        groupId,
        {
          contentType,
          slug: addBaseSlug,
          sectionId,
        },
        addMemberAuthorName,
      );
      const enrichedGroup = {
        ...updatedGroup,
        members: updatedGroup.members.map((m) => ({
          ...m,
          localeSlug: getCI(res).getLocaleSlug(
            m.slug,
            m.contentType,
            updatedGroup.locale,
          ),
          sectionIndex: bindingManager.resolveSectionIndex(
            m.contentType,
            m.slug,
            m.sectionId,
            updatedGroup.locale,
          ),
        })),
      };
      res.json({ group: enrichedGroup });
    } catch (error) {
      const msg =
        error instanceof Error ? error.message : "Failed to add member";
      log.error({ err: error }, "Error adding binding member:");
      res.status(400).json({ error: msg });
    }
  });

  app.delete("/api/bindings/:groupId/members", (req, res) => {
    try {
      if (!requireEditAuth(req, res)) return;
      const { groupId } = req.params;
      const {
        contentType,
        slug,
        sectionIndex,
        author: removeMemberAuthor,
      } = req.body;
      const removeMemberAuthorName =
        removeMemberAuthor && typeof removeMemberAuthor === "string"
          ? removeMemberAuthor
          : undefined;
      if (!contentType || !slug || sectionIndex === undefined) {
        res
          .status(400)
          .json({ error: "Missing contentType, slug, or sectionIndex" });
        return;
      }
      const group = bindingManager.getGroupById(groupId);
      if (!group) {
        res.status(404).json({ error: "Binding group not found" });
        return;
      }
      const removeBaseSlug = getCI(res).resolveBaseSlug(slug, contentType);
      const sectionId = bindingManager.getSectionIdAtIndex(
        contentType,
        removeBaseSlug,
        parseInt(sectionIndex as string, 10),
        group.locale,
      );
      if (!sectionId) {
        res
          .status(400)
          .json({
            error: `No section_id found at index ${sectionIndex} for ${contentType}/${removeBaseSlug}`,
          });
        return;
      }
      const result = bindingManager.removeMemberBySectionId(
        groupId,
        contentType,
        removeBaseSlug,
        sectionId,
        removeMemberAuthorName,
      );
      if (result) {
        const enrichedResult = {
          ...result,
          members: result.members.map((m) => ({
            ...m,
            localeSlug: getCI(res).getLocaleSlug(
              m.slug,
              m.contentType,
              result.locale,
            ),
            sectionIndex: bindingManager.resolveSectionIndex(
              m.contentType,
              m.slug,
              m.sectionId,
              result.locale,
            ),
          })),
        };
        res.json({ group: enrichedResult });
      } else {
        res.json({ group: null });
      }
    } catch (error) {
      const msg =
        error instanceof Error ? error.message : "Failed to remove member";
      log.error({ err: error }, "Error removing binding member:");
      res.status(400).json({ error: msg });
    }
  });

  app.delete("/api/bindings/:groupId", (req, res) => {
    try {
      if (!requireEditAuth(req, res)) return;
      const { groupId } = req.params;
      const { author: deleteGroupAuthor } = req.body || {};
      const deleteGroupAuthorName =
        deleteGroupAuthor && typeof deleteGroupAuthor === "string"
          ? deleteGroupAuthor
          : undefined;
      bindingManager.deleteGroup(groupId, deleteGroupAuthorName);
      res.json({ success: true });
    } catch (error) {
      log.error({ err: error }, "Error deleting binding:");
      res.status(500).json({ error: "Failed to delete binding" });
    }
  });

  app.post("/api/bindings/cleanup", (req, res) => {
    try {
      if (!requireEditAuth(req, res)) return;
      const dryRun = Boolean(req.body?.dryRun);
      const removed = bindingManager.cleanupStaleReferences(dryRun);
      res.json({ removed, dryRun });
    } catch (error) {
      log.error({ err: error }, "Error cleaning up bindings:");
      res.status(500).json({ error: "Failed to cleanup bindings" });
    }
  });

}
