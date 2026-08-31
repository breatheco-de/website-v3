import type { Express, Request, Response } from "express";
import { getDefaultContentRoot } from "../site-config";
import { triggerWorkerRunNow } from "./_worker-state";
import { createServer, type Server } from "http";
import { storage } from "../storage";
import { geoGet, geoSet } from "../geo-cache";
import { getQueueStats, enqueueOptimization, getPendingOptimizations, getFailedEntries, retryFailedImages, resetOptimizeSession, getOptimizeSession, enqueueExternalImage, createQueueContext } from "../image-registry";


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
import { MEDIA_EXTENSIONS } from "@shared/media-doctype";
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
import { mediaGallery, MediaGallery } from "../media-gallery";
import { getMergedImageRegistry } from "../image-registry-resolver";
import { buildVisitorImageRegistrySubset } from "../image-registry-subset";
import { applyTagsToRegistry } from "../image-auto-tagger";
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
  resolveEventActor,
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
import { api } from "../rate-limit/api.js";
import { markRateLimitNoCharge, markRateLimitSuccess } from "../rate-limit/limiter.js";
import { child } from "../logger";
const log = child({ module: "routes/media" });

function getMediaGallery(res: Response): MediaGallery {
  return (res.locals.site as any)?.mediaGallery ?? mediaGallery;
}

export function registerMediaRoutes(app: Express): void {
  app.get("/api/image-registry/stats", (req, res) => {
    const tag = req.query.tag as string | undefined;
    const registry = getMediaGallery(res).getRegistry();
    if (!registry) {
      res.status(500).json({ error: "Failed to load image registry" });
      return;
    }
    let cached = 0;
    let failed = 0;
    for (const entry of Object.values(registry.images)) {
      if (!entry.source_url) continue;
      if (tag && !(entry.tags ?? []).includes(tag)) continue;
      if (entry.failed_at) {
        failed++;
      } else {
        cached++;
      }
    }
    res.json({ cached, failed });
  });

  app.get("/api/image-registry/failed", (req, res) => {
    const tag = req.query.tag as string | undefined;
    const queueCtx = createQueueContext(getMediaGallery(res));
    const entries = getFailedEntries(queueCtx, tag);
    res.json({ entries });
  });

  app.post("/api/image-registry/retry-failed", (req, res) => {
    const { tag } = req.body as { tag?: string };
    const queueCtx = createQueueContext(getMediaGallery(res));
    const count = retryFailedImages(queueCtx, tag);
    if (count > 0) getMediaGallery(res).persistRegistry();
    res.json({ retried: count });
  });

  app.post("/api/image-registry/enqueue-external", (req, res) => {
    const { url, tag } = req.body as { url?: string; tag?: string };
    if (!url || !/^https?:\/\//.test(url)) {
      res.status(400).json({ error: "A valid http/https url is required" });
      return;
    }
    const dbName = tag || "manual";
    const queueCtx = createQueueContext(getMediaGallery(res));
    const id = enqueueExternalImage(queueCtx, url, dbName);
    if (id) {
      getMediaGallery(res).persistRegistry();
    }
    res.json({ queued: !!id, id: id ?? null });
  });

  app.get("/api/image-registry", (_req, res) => {
    const site = res.locals.site as import("../site-manager").SiteContext | undefined;
    const registry = site
      ? getMergedImageRegistry(site)
      : getMediaGallery(res).getRegistry();
    if (!registry) {
      res.status(500).json({ error: "Failed to load image registry" });
      return;
    }
    // Full registry for editors / client refetch. Long cache + weak ETag so
    // revisits after SSR subset hydration are cheap when content is unchanged.
    const body = JSON.stringify(registry);
    const etag = `W/"imgreg-${body.length.toString(16)}-${Buffer.byteLength(body).toString(16)}"`;
    res.setHeader("ETag", etag);
    res.setHeader("Cache-Control", "public, max-age=300, stale-while-revalidate=3600");
    if (_req.headers["if-none-match"] === etag) {
      res.status(304).end();
      return;
    }
    res.type("json").send(body);
  });

  /**
   * Visitor-facing image registry subset for the given content entry.
   * Same rules as SSR __INITIAL_DATA__ subset — used in edit mode so
   * UniversalImage can flag ids that would render blank for visitors.
   */
  app.get("/api/image-registry/visitor-subset", (req, res) => {
    const contentType = typeof req.query.contentType === "string" ? req.query.contentType.trim() : "";
    const slug = typeof req.query.slug === "string" ? req.query.slug.trim() : "";
    const locale = typeof req.query.locale === "string" && req.query.locale.trim()
      ? req.query.locale.trim()
      : "en";
    const urlLocale =
      typeof req.query.urlLocale === "string" && req.query.urlLocale.trim()
        ? req.query.urlLocale.trim()
        : undefined;

    if (!contentType || !slug) {
      res.status(400).json({ error: "contentType and slug are required" });
      return;
    }

    const site = res.locals.site as import("../site-manager").SiteContext | undefined;
    const registry = site
      ? getMergedImageRegistry(site)
      : getMediaGallery(res).getRegistry();
    if (!registry) {
      res.status(500).json({ error: "Failed to load image registry" });
      return;
    }

    const contentRoot: string = site?.contentRoot ?? getDefaultContentRoot();
    const ci = (site as any)?.contentIndex ?? contentIndex;

    try {
      const subset = buildVisitorImageRegistrySubset({
        fullRegistry: registry as any,
        contentType,
        slug,
        locale,
        contentRoot,
        contentIndex: ci,
        urlLocale,
      });
      res.json(subset);
    } catch (err: any) {
      log.error({ err }, "visitor-subset failed");
      res.status(500).json({ error: err?.message || "Failed to build visitor subset" });
    }
  });

  app.get("/api/image-registry/family-usage", (req, res) => {
    const raw = req.query.ids;
    const ids: string[] = Array.isArray(raw)
      ? (raw as string[]).filter(Boolean)
      : typeof raw === "string" && raw
        ? [raw]
        : [];
    if (!ids.length) {
      res.json([]);
      return;
    }
    try {
      const results = getMediaGallery(res).getFamilyUsage(ids);
      const enriched = results.map(r => ({
        ...r,
        hasBinding: r.sectionId
          ? !!bindingManager.findGroupForSection(r.contentType, r.slug, r.sectionId, r.locale)
          : r.sectionIndex >= 0
            ? !!bindingManager.findGroupForSectionByIndex(r.contentType, r.slug, r.sectionIndex, r.locale)
            : false,
      }));
      res.json(enriched);
    } catch (err: any) {
      res.status(500).json({ error: err.message || "Failed to get family usage" });
    }
  });

  app.post("/api/image-registry/clear-ref-cache", (_req, res) => {
    getMediaGallery(res).clearImageRefCache();
    res.json({ ok: true });
  });

  app.post("/api/image-registry/bulk-replace-usage", (req, res) => {
    const { fileReplacements } = req.body as {
      fileReplacements?: Array<{ filePath: string; fromId: string; fromSrc: string; toId: string; toSrc: string }>;
    };
    if (!Array.isArray(fileReplacements) || fileReplacements.length === 0) {
      res.status(400).json({ error: "Missing or empty 'fileReplacements' array" });
      return;
    }
    try {
      const result = getMediaGallery(res).bulkReplaceUsage(fileReplacements);
      getMediaGallery(res).clearImageRefCache();
      res.json(result);
    } catch (err: any) {
      res.status(500).json({ error: err.message || "Bulk replace failed" });
    }
  });

  app.delete("/api/image-registry/:id", async (req, res) => {
    try {
      const result = await getMediaGallery(res).unregister(req.params.id);
      if (!result.success) {
        const status = result.usedIn ? 409 : 404;
        res.status(status).json({
          error: result.usedIn ? "Image is in use" : result.error,
          message: result.error,
          ...(result.usedIn ? { usedIn: result.usedIn } : {}),
        });
        return;
      }
      res.json({
        success: true,
        message: `Deleted "${req.params.id}" from registry`,
        ...(result.cleanupErrors ? { cleanupErrors: result.cleanupErrors } : {}),
      });
    } catch (error: any) {
      res.status(500).json({ error: error.message || "Delete failed" });
    }
  });

  /** Idempotent merge of tags onto a registry image (e.g. ensure og-image after gallery pick). */
  app.post("/api/image-registry/:id/tags", (req, res) => {
    try {
      const add = (req.body as { add?: unknown })?.add;
      if (!Array.isArray(add) || add.length === 0 || !add.every((t) => typeof t === "string" && t.trim())) {
        res.status(400).json({ error: "Body must include non-empty 'add' string array" });
        return;
      }
      const tags = add.map((t: string) => t.trim()).filter(Boolean);
      const result = applyTagsToRegistry(req.params.id, tags);
      res.json({
        success: true,
        id: req.params.id,
        applied: result.applied,
        tags: result.existing,
      });
    } catch (error: any) {
      const message = error?.message || "Failed to apply tags";
      const status = typeof message === "string" && message.includes("not found") ? 404 : 500;
      res.status(status).json({ error: message });
    }
  });

  app.post("/api/image-registry/bulk-delete", async (req, res) => {
    try {
      const { ids } = req.body as { ids?: string[] };
      if (!ids || !Array.isArray(ids) || ids.length === 0) {
        res.status(400).json({ error: "Missing or empty 'ids' array" });
        return;
      }
      const { results, deletedCount } = await getMediaGallery(res).bulkUnregister(ids);
      res.json({ results, deletedCount, totalRequested: ids.length });
    } catch (error: any) {
      res.status(500).json({ error: error.message || "Bulk delete failed" });
    }
  });

  app.get("/api/media/status", (_req, res) => {
    try {
      res.json(media.getStatus());
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  /**
   * Same-origin image proxy for OG / entry-preview screenshots.
   * modern-screenshot must re-fetch <img> src as data URLs; GCS often lacks CORS,
   * so the browser capture gets a blank logo. Allowlisted hosts only (SSRF guard).
   */
  app.get("/api/media/fetch-image", async (req, res) => {
    try {
      const raw = typeof req.query.url === "string" ? req.query.url.trim() : "";
      if (!raw) {
        res.status(400).json({ error: "url query param is required" });
        return;
      }
      let parsed: URL;
      try {
        parsed = new URL(raw);
      } catch {
        res.status(400).json({ error: "Invalid url" });
        return;
      }
      if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
        res.status(400).json({ error: "Only http/https urls are allowed" });
        return;
      }
      const host = parsed.hostname.toLowerCase();
      const allowed =
        host === "storage.googleapis.com" ||
        host.endsWith(".storage.googleapis.com") ||
        host === "breathecode.herokuapp.com" ||
        host.endsWith(".breathecode.herokuapp.com") ||
        host === "4geeksacademy.com" ||
        host.endsWith(".4geeksacademy.com") ||
        host === "localhost" ||
        host === "127.0.0.1";
      if (!allowed) {
        res.status(403).json({ error: `Host not allowlisted: ${host}` });
        return;
      }

      const upstream = await fetch(parsed.href, {
        redirect: "follow",
        headers: { Accept: "image/*,*/*;q=0.8" },
      });
      if (!upstream.ok) {
        res.status(upstream.status).json({ error: `Upstream fetch failed: ${upstream.status}` });
        return;
      }
      const contentType = upstream.headers.get("content-type") || "application/octet-stream";
      if (!contentType.startsWith("image/") && !contentType.includes("octet-stream")) {
        res.status(415).json({ error: `Unsupported content-type: ${contentType}` });
        return;
      }
      const buffer = Buffer.from(await upstream.arrayBuffer());
      if (buffer.length === 0) {
        res.status(502).json({ error: "Empty upstream image" });
        return;
      }
      if (buffer.length > 8 * 1024 * 1024) {
        res.status(413).json({ error: "Image too large" });
        return;
      }
      res.setHeader("Content-Type", contentType);
      res.setHeader("Cache-Control", "private, max-age=300");
      res.send(buffer);
    } catch (err: any) {
      log.error({ err }, "fetch-image proxy failed");
      res.status(500).json({ error: err.message || "fetch-image failed" });
    }
  });

  // Image Registry Scanner Endpoints (delegated to MediaGallery singleton)
  app.post("/api/image-registry/scan", async (_req, res) => {
    try {
      const result = await getMediaGallery(res).scan();
      res.json(result);
    } catch (error: any) {
      res.status(500).json({ error: error.message || "Scan failed" });
    }
  });

  app.post("/api/image-registry/apply", async (req, res) => {
    try {
      const action = req.query.action as string | undefined;
      const scanResult = await getMediaGallery(res).scan();
      const filtered = {
        ...scanResult,
        newImages: action === "update" ? [] : scanResult.newImages,
        updatedImages: action === "add" ? [] : scanResult.updatedImages,
      };
      if (
        filtered.newImages.length === 0 &&
        filtered.updatedImages.length === 0
      ) {
        res.json({ message: "Nothing to apply", added: 0, updated: 0 });
        return;
      }
      const applied = getMediaGallery(res).applyChanges(filtered);
      const yamlMsg =
        applied.yamlFilesUpdated.length > 0
          ? `. Updated paths in ${applied.yamlFilesUpdated.length} YAML file(s)`
          : "";
      res.json({
        message: `Applied ${applied.added} new, ${applied.updated} updated${yamlMsg}`,
        ...applied,
      });
    } catch (error: any) {
      res.status(500).json({ error: error.message || "Apply failed" });
    }
  });

  app.post("/api/image-registry/deduplicate", async (req, res) => {
    try {
      const scanResult = await getMediaGallery(res).scan();
      if (scanResult.duplicates.length === 0) {
        res.json({
          message: "No duplicates found",
          removedCount: 0,
          results: [],
        });
        return;
      }
      const result = getMediaGallery(res).removeDuplicates(scanResult.duplicates);
      const yamlMsg =
        result.yamlFilesUpdated.length > 0
          ? `. Updated references in ${result.yamlFilesUpdated.length} YAML file(s)`
          : "";
      res.json({
        message: `Removed ${result.removedCount} duplicate(s)${yamlMsg}`,
        ...result,
      });
    } catch (error: any) {
      res.status(500).json({ error: error.message || "Deduplication failed" });
    }
  });

  app.get("/api/image-registry/redundant", (_req, res) => {
    try {
      const images = getMediaGallery(res).findRedundantImages();
      res.json({ count: images.length, images });
    } catch (error: any) {
      res
        .status(500)
        .json({ error: error.message || "Failed to find redundant images" });
    }
  });

  app.post("/api/image-registry/redundant/resolve", async (req, res) => {
    try {
      const { action, ids } = req.body as { action?: string; ids?: string[] };
      if (action !== "delete-local" && action !== "delete-cloud") {
        res
          .status(400)
          .json({
            error: "Invalid action. Must be 'delete-local' or 'delete-cloud'",
          });
        return;
      }
      const result = await getMediaGallery(res).resolveRedundancy(action, ids);
      res.json(result);
    } catch (error: any) {
      res
        .status(500)
        .json({ error: error.message || "Failed to resolve redundancy" });
    }
  });

  app.post("/api/image-registry/migrate", async (req, res) => {
    try {
      const { from, to, dryRun, prefix } = req.body as {
        from?: string;
        to?: string;
        dryRun?: boolean;
        prefix?: string;
      };
      if (!from || !to) {
        res
          .status(400)
          .json({ error: "Missing 'from' and/or 'to' provider name" });
        return;
      }
      const results = await getMediaGallery(res).migrate(from, to, { dryRun, prefix });
      const migrated = results.filter((r) => r.status === "migrated").length;
      res.json({
        message: dryRun
          ? `Dry run: ${results.length} image(s) would be migrated from ${from} to ${to}`
          : `Migrated ${migrated} of ${results.length} image(s) from ${from} to ${to}`,
        results,
        totalProcessed: results.length,
        migratedCount: migrated,
      });
    } catch (error: any) {
      res.status(500).json({ error: error.message || "Migration failed" });
    }
  });

  app.post("/api/image-registry/scripts/remove-unused", async (req, res) => {
    try {
      const { dryRun } = req.body as { dryRun?: boolean };
      const { removeUnusedImages } = await import("../../scripts/admin/remove-unused-images");
      const result = await removeUnusedImages({ dryRun: dryRun ?? false });
      res.json(result);
    } catch (error: any) {
      res.status(500).json({ error: error.message || "Remove unused images failed" });
    }
  });

  app.post("/api/image-registry/scripts/remove-unused/stream", async (req, res) => {
    const BATCH_SIZE = 20;

    try {
      const registry = getMediaGallery(res).getRegistry();
      if (!registry) {
        res.status(500).json({ error: "Failed to load image registry" });
        return;
      }

      const { imageIds } = getMediaGallery(res).collectImageReferences();
      const srcToId = buildRegistrySrcToIdMap(registry.images);
      const resolvedReferencedIds = new Set<string>();
      imageIds.forEach((ref) => {
        const resolved = resolveRegistryReference(ref, registry.images, srcToId);
        if (resolved !== null) resolvedReferencedIds.add(resolved);
      });

      const allImageIds = Object.keys(registry.images);
      const unusedItems: Array<{ id: string; src: string }> = [];
      let externalSkipped = 0;
      for (const [id, entry] of Object.entries(registry.images)) {
        if (entry.source_url || entry.source_item) {
          externalSkipped++;
          continue;
        }
        if (entry.protected) {
          continue;
        }
        const srcsetUrls = Array.isArray(entry.srcset) ? entry.srcset.map((s) => s.url) : [];
        const usage = getMediaGallery(res).getUsage(id, entry.src, srcsetUrls);
        const isUsed = usage.length > 0 || resolvedReferencedIds.has(id);
        if (!isUsed) {
          unusedItems.push({ id, src: entry.src });
        }
      }

      const total = unusedItems.length;

      if (total === 0) {
        res.json({ done: true, processed: 0, total: 0, summary: { removed: 0, skipped: 0, failed: 0 } });
        return;
      }

      res.writeHead(200, {
        "Content-Type": "application/x-ndjson",
        "Transfer-Encoding": "chunked",
        "Cache-Control": "no-cache",
        "Connection": "keep-alive",
      });

      let processed = 0;
      let removed = 0;
      let skipped = 0;
      let failed = 0;
      let cleanupWarnings = 0;

      try {
        for (let i = 0; i < total; i += BATCH_SIZE) {
          const batchItems = unusedItems.slice(i, i + BATCH_SIZE);
          const batchResults: Array<{ id: string; src: string; status: string; reason?: string }> = [];

          for (const item of batchItems) {
            try {
              const result = await getMediaGallery(res).unregister(item.id);
              if (result.success) {
                if (result.cleanupErrors && result.cleanupErrors.length > 0) {
                  batchResults.push({
                    id: item.id,
                    src: item.src,
                    status: "removed-with-cleanup-errors",
                    reason: result.cleanupErrors.join("; "),
                  });
                  cleanupWarnings++;
                } else {
                  batchResults.push({ id: item.id, src: item.src, status: "removed" });
                }
                removed++;
              } else {
                batchResults.push({ id: item.id, src: item.src, status: "skipped", reason: result.error || "unknown" });
                skipped++;
              }
            } catch (err: any) {
              batchResults.push({ id: item.id, src: item.src, status: "error", reason: err.message || "unknown" });
              failed++;
            }
          }

          processed += batchItems.length;
          const event = { total, processed, batch: batchResults };
          res.write(JSON.stringify(event) + "\n");
        }

        const doneEvent = {
          done: true,
          processed,
          total,
          summary: {
            removed,
            skipped,
            failed,
            cleanupWarnings,
            externalSkipped,
          },
        };
        res.write(JSON.stringify(doneEvent) + "\n");
        res.end();
      } catch (fatalErr: any) {
        const fatalEvent = { fatalError: true, message: fatalErr.message || "Unknown error", processed, total };
        res.write(JSON.stringify(fatalEvent) + "\n");
        res.end();
      }
    } catch (error: any) {
      if (!res.headersSent) {
        res.status(500).json({ error: error.message || "Remove unused images failed" });
      }
    }
  });

  const mediaUpload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 100 * 1024 * 1024 },
    fileFilter: (_req, file, cb) => {
      const ext = path.extname(file.originalname).toLowerCase();
      if (MEDIA_EXTENSIONS.has(ext)) {
        cb(null, true);
      } else {
        cb(new Error(`Unsupported file type: ${ext}`));
      }
    },
  });

  app.post(
    "/api/image-registry/upload",
    mediaUpload.single("file"),
    async (req, res) => {
      try {
        const file = (req as any).file;
        if (!file) {
          res.status(400).json({ error: "No file provided" });
          return;
        }
        const alt = (req.body?.alt as string) || undefined;
        const tags = req.body?.tags ? JSON.parse(req.body.tags) : undefined;
        let origin: "upload" | "import" | "ai" | undefined;
        if (req.body?.origin === "upload" || req.body?.origin === "import" || req.body?.origin === "ai") {
          origin = req.body.origin;
        }
        let ai:
          | {
              generated: true;
              model?: string;
              prompt?: string;
              generated_at?: string;
              aspect_ratio?: string;
              requested_by?: import("../ai/ai-image-meta").AiRequestedBy;
            }
          | undefined;
        if (req.body?.ai) {
          try {
            const parsed = typeof req.body.ai === "string" ? JSON.parse(req.body.ai) : req.body.ai;
            if (parsed && parsed.generated === true) {
              ai = {
                generated: true,
                model: typeof parsed.model === "string" ? parsed.model : undefined,
                prompt: typeof parsed.prompt === "string" ? parsed.prompt : undefined,
                aspect_ratio:
                  typeof parsed.aspect_ratio === "string" ? parsed.aspect_ratio : undefined,
                generated_at:
                  typeof parsed.generated_at === "string"
                    ? parsed.generated_at
                    : new Date().toISOString(),
              };
              origin = origin ?? "ai";
            }
          } catch {
            /* ignore bad ai json */
          }
        }

        if (origin === "ai" || ai?.generated) {
          const actor = resolveEventActor(req);
          let username: string | null = null;
          if (actor.type === "ui") {
            const token = extractToken(req);
            if (token) {
              try {
                const profile = await userManager.validateToken(token);
                if (profile.valid && profile.username) username = profile.username;
              } catch {
                /* ignore */
              }
            }
          }
          const mcpAuthor = req.headers["x-mcp-author"];
          const authorStr =
            typeof mcpAuthor === "string" && mcpAuthor.trim() ? mcpAuthor.trim() : undefined;
          const requested_by =
            actor.type === "mcp"
              ? {
                  kind: "agent" as const,
                  id: authorStr || actor.client,
                  name: authorStr || actor.client || "mcp",
                }
              : actor.type === "system"
                ? {
                    kind: "system" as const,
                    id: actor.source,
                    name: actor.source,
                  }
                : {
                    kind: "user" as const,
                    ...(username
                      ? { id: username, name: username }
                      : { name: "staff" }),
                  };
          ai = {
            generated: true,
            ...(ai || {}),
            generated_at: ai?.generated_at || new Date().toISOString(),
            requested_by,
          };
          origin = origin ?? "ai";
        }

        const gallery = getMediaGallery(res);
        const result = await gallery.uploadAndRegister(
          file.originalname,
          file.buffer,
          file.mimetype,
          { alt, tags, origin, ai },
        );

        if (!result.duplicate && (origin === "ai" || ai?.generated)) {
          const site = res.locals.site as import("../site-manager").SiteContext | undefined;
          if (site) {
            const { enqueueAiImageGc, AI_IMAGE_GC_DELAY_MS } = await import(
              "../jobs/ai-image-gc-shared"
            );
            await enqueueAiImageGc({
              site: site.contentRootName,
              contentRoot: site.contentRoot,
              imageId: result.id,
              delayMs: AI_IMAGE_GC_DELAY_MS,
            });
          }
        }

        res.json(result);
      } catch (error: any) {
        res.status(500).json({ error: error.message || "Upload failed" });
      }
    },
  );

  api.post(app, "/api/media/generate-images", { rate: "expensiveAi" }, async (req, res) => {
    try {
      const prompt = typeof req.body?.prompt === "string" ? req.body.prompt.trim() : "";
      if (!prompt) {
        res.status(400).json({ error: "prompt is required" });
        return;
      }
      const aspect_ratio =
        typeof req.body?.aspect_ratio === "string" ? req.body.aspect_ratio : undefined;
      const nRaw = typeof req.body?.n === "number" ? req.body.n : 4;
      const n = Math.min(4, Math.max(1, Math.floor(nRaw)));

      const site = res.locals.site as import("../site-manager").SiteContext | undefined;
      const contentRoot = site?.contentRoot;

      const { resolveImageGenerationReady } = await import("../ai/image-generation-ready");
      const ready = resolveImageGenerationReady(contentRoot);
      if (!ready.ok) {
        res.status(503).json({
          error: ready.error,
          code: "image_generation_not_configured",
          hint: ready.hint,
          model: ready.model,
        });
        return;
      }

      let cancelled = false;
      req.on("close", () => {
        cancelled = true;
      });

      res.writeHead(200, {
        "Content-Type": "application/x-ndjson",
        "Transfer-Encoding": "chunked",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
      });

      const writeEvent = (event: Record<string, unknown>) => {
        if (cancelled || res.writableEnded) return;
        res.write(JSON.stringify(event) + "\n");
      };

      try {
        const { generateImagesStream } = await import(
          "../ai/LLMService"
        );
        const result = await generateImagesStream(
          {
            prompt,
            n,
            aspect_ratio,
            contentRoot,
            isCancelled: () => cancelled || Boolean(req.aborted),
          },
          (c) => {
            writeEvent({
              type: "candidate",
              index: c.index,
              b64: c.b64,
              mediaType: c.mediaType,
              model: c.model,
            });
          },
        );
        writeEvent({ type: "done", model: result.model, count: result.candidates.length });
        if (result.candidates.length > 0) {
          markRateLimitSuccess(res);
        } else {
          markRateLimitNoCharge(res);
        }
        res.end();
      } catch (err: any) {
        const { GenerateImagesCancelledError: Cancelled } = await import("../ai/LLMService");
        if (err instanceof Cancelled || cancelled) {
          markRateLimitNoCharge(res);
          if (!res.writableEnded) res.end();
          return;
        }
        const message = err?.message || "Image generation failed";
        markRateLimitNoCharge(res);
        writeEvent({ type: "error", error: message });
        res.end();
      }
    } catch (error: any) {
      if (!res.headersSent) {
        res.status(500).json({ error: error.message || "Image generation failed" });
      } else if (!res.writableEnded) {
        res.write(JSON.stringify({ type: "error", error: error.message || "Image generation failed" }) + "\n");
        res.end();
      }
    }
  });

  app.get("/api/image-registry/:id/ai-meta", async (req, res) => {
    try {
      const id = typeof req.params.id === "string" ? req.params.id : "";
      if (!id) {
        res.status(400).json({ error: "id is required" });
        return;
      }
      const gallery = getMediaGallery(res);
      const entry = gallery.getRegistry()?.images?.[id];
      if (!entry) {
        res.status(404).json({ error: "Image not found" });
        return;
      }
      if (entry.origin !== "ai" && !entry.ai?.generated) {
        res.status(404).json({ error: "Not an AI-generated image" });
        return;
      }
      const meta = await gallery.readAiMetaSidecar(id);
      if (!meta) {
        res.status(404).json({ error: "AI meta not found" });
        return;
      }
      res.json(meta);
    } catch (error: any) {
      res.status(500).json({ error: error.message || "Failed to load AI meta" });
    }
  });

  app.post("/api/media/impression", (req, res) => {
    try {
      const id = typeof req.body?.id === "string" ? req.body.id.trim() : "";
      if (!id) {
        res.status(400).json({ error: "id is required" });
        return;
      }
      const site = res.locals.site as import("../site-manager").SiteContext | undefined;
      const contentRootName = site?.contentRootName;
      if (!contentRootName) {
        res.status(204).end();
        return;
      }
      const gallery = getMediaGallery(res);
      const entry = gallery.getRegistry()?.images?.[id];
      const isAi = entry?.origin === "ai" || entry?.ai?.generated === true;
      const { recordImageImpression } = require("../media-impressions") as typeof import("../media-impressions");
      recordImageImpression(contentRootName, id, !!isAi);
      res.status(204).end();
    } catch {
      res.status(204).end();
    }
  });

  app.get("/api/media/generate-images/status", (_req, res) => {
    try {
      const site = res.locals.site as import("../site-manager").SiteContext | undefined;
      const { resolveImageGenerationReady } = require("../ai/image-generation-ready") as typeof import("../ai/image-generation-ready");
      const ready = resolveImageGenerationReady(site?.contentRoot);
      res.json({
        ready: ready.ok,
        model: ready.model,
        error: ready.ok ? undefined : ready.error,
        hint: ready.ok ? undefined : ready.hint,
      });
    } catch (err: any) {
      res.status(500).json({ ready: false, error: err?.message || "status failed" });
    }
  });

  app.post(
    "/api/image-registry/:id/replace",
    mediaUpload.single("file"),
    async (req, res) => {
      try {
        const file = (req as any).file;
        if (!file) {
          res.status(400).json({ error: "No file provided" });
          return;
        }
        const id = req.params.id;
        if (!id) {
          res.status(400).json({ error: "Missing image id" });
          return;
        }
        const result = await getMediaGallery(res).replaceAndRegister(
          id,
          file.originalname,
          file.buffer,
          file.mimetype,
        );
        if (!result.ok) {
          res.status(409).json({
            conflict: result.conflict,
            existingId: result.existingId,
            existingSrc: result.existingSrc,
            error: `This file is already registered as "${result.existingId}"`,
          });
          return;
        }
        res.json(result);
      } catch (error: any) {
        const message = error.message || "Replace failed";
        const isClientError =
          /not found|Unsupported file type|Cannot change media type|Could not determine|Failed to convert|Could not resolve storage key/i.test(
            message,
          );
        res.status(isClientError ? 400 : 500).json({ error: message });
      }
    },
  );

  // ============================================
  // Crop/Resize Endpoint
  // ============================================

  app.post("/api/media/crop-resize", async (req, res) => {
    if (process.env.DEBUG_CROP_RESIZE) {
      log.info("[CropResize] Handler reached — body keys:", Object.keys(req.body || {}));
    }
    try {
      const bodySchema = z.object({
        imageId: z.string().min(1),
        crop: z.object({
          x: z.number().min(0).max(1),
          y: z.number().min(0).max(1),
          width: z.number().min(0).max(1),
          height: z.number().min(0).max(1),
        }),
        targetWidth: z.number().int().positive().max(8000),
        targetHeight: z.number().int().positive().max(8000),
        quality: z.number().int().min(50).max(100).default(85),
      });

      const parsed = bodySchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: "Invalid request", details: parsed.error.flatten() });
        return;
      }

      const { imageId, crop, targetWidth, targetHeight, quality } = parsed.data;

      const registry = getMediaGallery(res).getRegistry();
      if (!registry) {
        res.status(500).json({ error: "Failed to load image registry" });
        return;
      }

      const entry = registry.images[imageId];
      if (!entry) {
        res.status(404).json({ error: `Image "${imageId}" not found in registry` });
        return;
      }

      const src = entry.src;
      const ext = (() => {
        try { return path.extname(new URL(src).pathname).toLowerCase(); }
        catch { return path.extname(src).toLowerCase(); }
      })();

      if (ext === ".svg") {
        res.status(422).json({ error: "SVG images cannot be raster-processed. Please select a different format." });
        return;
      }
      if (ext === ".gif") {
        res.status(422).json({ error: "Animated GIF images cannot be crop-processed. Please select a different format." });
        return;
      }

      const { downloadImage } = await import("../image-optimizer");
      const buffer = await downloadImage(src);
      if (!buffer) {
        res.status(422).json({ error: "Could not read source image. Make sure the file exists." });
        return;
      }

      const sharp = (await import("sharp")).default;
      const metadata = await sharp(buffer).metadata();
      const imgW = metadata.width || 0;
      const imgH = metadata.height || 0;

      if (!imgW || !imgH) {
        res.status(422).json({ error: "Could not determine image dimensions." });
        return;
      }

      const cropLeft = Math.round(crop.x * imgW);
      const cropTop = Math.round(crop.y * imgH);
      const cropWidth = Math.round(crop.width * imgW);
      const cropHeight = Math.round(crop.height * imgH);

      const safeLeft = Math.max(0, Math.min(cropLeft, imgW - 1));
      const safeTop = Math.max(0, Math.min(cropTop, imgH - 1));
      const safeWidth = Math.max(1, Math.min(cropWidth, imgW - safeLeft));
      const safeHeight = Math.max(1, Math.min(cropHeight, imgH - safeTop));

      const processedBuffer = await sharp(buffer)
        .extract({ left: safeLeft, top: safeTop, width: safeWidth, height: safeHeight })
        .resize({ width: targetWidth, height: targetHeight, fit: "fill" })
        .webp({ quality })
        .toBuffer();

      const rootId = entry.parentId ?? imageId;

      const parentTags = entry.tags || [];

      const registryPresets = registry.presets as Record<string, { quality?: number }>;
      const parentPresets = (entry.preset || []) as string[];
      const presetDefaultQuality = parentPresets.length > 0
        ? Math.max(...parentPresets.map((p) => registryPresets[p]?.quality ?? 85))
        : 85;
      const qualityToSave = quality !== presetDefaultQuality ? quality : undefined;
      const qualitySuffix = qualityToSave !== undefined ? `-q${quality}` : "";
      const baseId = `${rootId}-${targetWidth}x${targetHeight}${qualitySuffix}`;

      const existingEntry = registry.images[baseId];
      if (existingEntry) {
        return res.json({ id: baseId, src: existingEntry.src, width: targetWidth, height: targetHeight });
      }

      const uniqueId = baseId;
      const derivedFilename = `${uniqueId}.webp`;
      const siteGallery = getMediaGallery(res);
      const siteProvider = siteGallery.getDefaultStorageProvider();
      let newSrc: string;

      if (siteProvider.name === "local") {
        const contentRoot: string = (res.locals.site as any)?.contentRoot ?? getDefaultContentRoot();
        const contentRootName = path.basename(contentRoot);
        const imagesDir = path.join(contentRoot, "images");
        if (!fs.existsSync(imagesDir)) {
          fs.mkdirSync(imagesDir, { recursive: true });
        }
        const destPath = path.join(imagesDir, derivedFilename);
        fs.writeFileSync(destPath, processedBuffer);
        newSrc = `/${contentRootName}/images/${derivedFilename}`;
      } else {
        newSrc = await siteProvider.upload(derivedFilename, processedBuffer, "image/webp");
      }

      getMediaGallery(res).register(uniqueId, {
        src: newSrc,
        alt: entry.alt,
        tags: parentTags,
        width: targetWidth,
        height: targetHeight,
        format: "webp",
        parentId: rootId,
        quality_override: qualityToSave,
      });

      log.info(`[CropResize] Created "${uniqueId}" (${targetWidth}x${targetHeight}) from "${rootId}"`);

      (async () => {
        try {
          const { processImageFromSrc } = await import("../image-optimizer");
          const registry2 = getMediaGallery(res).getRegistry();
          if (!registry2) return;
          const newEntry = registry2.images[uniqueId];
          if (!newEntry) return;
          const tagDefs = registry2.tagDefinitions as Record<string, { presets?: string[] }> | undefined;
          const result = await processImageFromSrc(uniqueId, newEntry, registry2.presets as Record<string, import("../image-optimizer").Preset>, false, newEntry.quality_override, tagDefs);
          if (result) {
            newEntry.preset = result.preset;
            newEntry.widths_generated = result.widths_generated;
            newEntry.srcset = result.srcset;
            getMediaGallery(res).persistRegistry();
            log.info(`[CropResize] Optimization complete for "${uniqueId}"`);
          }
        } catch (err) {
          log.error({ err: err }, `[CropResize] Background optimization failed for "${uniqueId}":`);
        }
      })();

      res.json({ id: uniqueId, src: newSrc, width: targetWidth, height: targetHeight });
    } catch (error: any) {
      log.error({ err: error }, "[CropResize] Error:");
      res.status(500).json({ error: error.message || "Crop/resize failed" });
    }
  });

  app.post("/api/image-registry/optimize-batch", async (req, res) => {
    try {
      const { ids } = req.body as { ids?: string[] };
      const registry = getMediaGallery(res).getRegistry();
      if (!registry) {
        res.status(500).json({ error: "Failed to load image registry" });
        return;
      }

      const rasterExtensions = new Set([".png", ".jpg", ".jpeg", ".webp", ".avif"]);

      const getExt = (src: string): string => {
        try { return path.extname(new URL(src).pathname).toLowerCase(); }
        catch { return path.extname(src).toLowerCase(); }
      };

      let targetIds: string[];
      if (ids && Array.isArray(ids) && ids.length > 0) {
        targetIds = ids.filter(id => {
          const entry = registry.images[id];
          if (!entry) return false;
          return rasterExtensions.has(getExt(entry.src));
        });
      } else {
        targetIds = Object.entries(registry.images)
          .filter(([_id, entry]) => {
            if (!entry.src) return false;
            const ext = getExt(entry.src);
            if (!rasterExtensions.has(ext)) return false;
            const hasSrcset = Array.isArray(entry.srcset) && entry.srcset.length > 0;
            return !hasSrcset;
          })
          .map(([id]) => id);
      }

      if (targetIds.length === 0) {
        res.json({ queued: 0, message: "No images need optimization" });
        return;
      }

      for (const id of targetIds) {
        enqueueOptimization(createQueueContext(getMediaGallery(res)), id);
      }
      getMediaGallery(res).persistRegistry();

      resetOptimizeSession(targetIds.length);
      triggerWorkerRunNow();

      log.info(`[OptimizeBatch] Enqueued ${targetIds.length} image(s) for background optimization`);
      res.json({ queued: targetIds.length, message: `Queued ${targetIds.length} image(s) for background optimization` });
    } catch (error: any) {
      res.status(500).json({ error: error.message || "Batch optimize failed" });
    }
  });

  app.get("/api/image-registry/optimize-status", (req, res) => {
    const session = getOptimizeSession();
    const queueCtx = createQueueContext(getMediaGallery(res));
    const allState = queueCtx.queueState.getAll();

    const remainingEntries = getPendingOptimizations(queueCtx, 10000);
    const remaining = remainingEntries.length;

    const failedEntries: Array<{ id: string; error: string }> = [];
    for (const [id, entry] of Object.entries(allState)) {
      if (entry.failed_at) {
        failedEntries.push({ id, error: entry.error ?? "Unknown error" });
        if (failedEntries.length >= 20) break;
      }
    }

    const active = remaining > 0 || (session.initial > 0 && session.processed < session.initial);

    res.json({
      active,
      initial: session.initial,
      processed: session.processed,
      failed: failedEntries.length,
      remaining,
      failedEntries,
    });
  });

  app.post("/api/media/classify/:imageId", async (req, res) => {
    try {
      const { imageId } = req.params;
      const { context, persist } = req.body as {
        context?: { tagFilter?: string };
        persist?: boolean;
      };

      if (context && typeof context !== "object") {
        res.status(400).json({ error: "context must be an object" });
        return;
      }
      if (context?.tagFilter && typeof context.tagFilter !== "string") {
        res.status(400).json({ error: "context.tagFilter must be a string" });
        return;
      }
      if (context?.tagFilter && context.tagFilter.length > 100) {
        res.status(400).json({ error: "context.tagFilter is too long" });
        return;
      }

      const { classifyAndApply } = await import("../image-auto-tagger");
      const shouldPersist = persist !== false;
      const result = await classifyAndApply(imageId, context, shouldPersist);
      res.json(result);
    } catch (error: any) {
      const message = error instanceof Error ? error.message : String(error);
      if (message.includes("not found")) {
        res.status(404).json({ error: message });
      } else {
        log.error({ err: error }, "[Classify] Error:");
        res.status(500).json({ error: "Classification failed", message });
      }
    }
  });


}
