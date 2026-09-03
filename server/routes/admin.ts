import { randomUUID } from "crypto";
import type { Express, Request, Response } from "express";
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
import { resetSiteConfigs, getDefaultContentFolder, getDefaultContentRoot, getSiteConfigs } from "../site-config";
import { resetSiteContextMap, getSiteInfo, readDevSiteFile, writeDevSiteFile } from "../site-manager";
import {
  BOOT_ID,
  BOOT_TIME,
  getLastSoftReload,
  performSoftReload,
  triggerGracefulShutdown,
  isShutdownHandlerRegistered,
} from "../server-control";
import { deepMerge } from "../utils/deepMerge";
import { regenerateSectionIds } from "../utils/regenerateSectionIds";
import { databaseManager, DatabaseManager } from "../database";
import { collectSystemAlerts, recheckDatabaseHealth } from "../system-alerts";
import { listEvents, clearAllEvents, listAgentSessions, getAgentSessionDetail, emitEvent, getLatestWriteGeneration, getOldestUnpublishedAgeMs, getUnpublishedCount, getUnpublishedEvents, type EventType } from "../events/event-store";
import { singleAttribution } from "../events/types";
import { seedDemoPipelineEvents } from "../events/seed-demo";
import { listActiveLeases } from "../leases";
import { getLastAppliedSnapshot } from "../jobs/applier";
import { getEngineStatus } from "../jobs/queue";
import {
  deriveInFlight,
  derivePipelineOverallStatus,
  parseBindingLeaseResource,
} from "../pipeline-status";

function getDB(res: import("express").Response): DatabaseManager {
  return (res.locals.site as import("../site-manager").SiteContext)?.database ?? databaseManager;
}
import {
  redirectMiddleware,
  clearRedirectCache,
  testRedirect,
  inspectRedirect,
  getFreshRedirectEntries,
  isRegexPattern,
} from "../redirects";
import { insertCustomRedirect, moveCustomRedirect } from "../custom-redirects-yml";
import { scheduleRedirectsValidation } from "../services/onSaveValidation";
import { getValidationCacheService } from "../services/validationCacheService";
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
  updateOrganizationLogo,
  updateOrganizationName,
  getSchemaOrgEditorPayload,
  updateSchemaOrgEditorPayload,
  getSchemaOrgYaml,
  putSchemaOrgYaml,
} from "../schema-org";
import { getVariableManager } from "../variable-manager";
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
import { readInsightsFile, suggestNext as suggestNextComponent, getComponentUsageData, getInsightsStatus, requestInsightsRebuild, getUsageSummary } from "../component-insights";
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
  resolveEffectiveRobots,
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
import {
} from "@shared/gcsKeys";
import { aggregateImageQueuePending, collectGcsSyncInventory } from "../gcs-sync-inventory";
import { runGcsConnectionTest } from "../gcs-connection-test";
import { isImageQueueBusy } from "../image-queue-worker";
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
import { queryEntries } from "../query-entries";
import { loadDatabaseSinglePage, mergeSingleTemplate } from "../database-single-loader";
import { getBaseUrl } from "../hreflang";
import * as userManager from "../user-manager";
import * as userStore from "../user-store";
import type { CapabilityName } from "../user-store";
import { allowedToolNames } from "@shared/mcp-tool-catalog";


import {

  BREATHECODE_HOST,
  extractToken,
  requireCapability,
  requireStaffSession,
  requireMutatingStaff,
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
  isMcpLoopbackRequest,
  requireIssueReport,
  resolveAgentSessionId,
  resolveEventActor,
} from "./_helpers";
import { child } from "../logger";
import { sqlite } from "../db";
import { errorLogFingerprint } from "../utils/error-log-fingerprint";
import { resolveDatabaseBackedRedirectDestination } from "../debug-redirect-db-dest";
const log = child({ module: "routes/admin" });

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

function getValidationCache(res: Response) {
  return (res.locals.site as any)?.validationCache ?? getValidationCacheService();
}

function afterRedirectWrite(res: Response, filePath?: string): void {
  // Cheap redirect-index update — never call sync scan() here (blocks event loop → 502).
  getCI(res).refreshAfterRedirectWrite(filePath);
  clearRedirectCache();
  scheduleRedirectsValidation({
    contentRoot: getContentRoot(res),
    contentRootName: getContentRootName(res),
    ci: getCI(res),
    cache: getValidationCache(res),
    filePath,
    redirectsChanged: true,
  });
}

/** Append a redirect rule to custom-redirects.yml (used for custom dests and DB-backed pages). */
function appendCustomRedirect(opts: {
  contentRoot: string;
  contentRootName: string;
  from: string;
  to: string | Record<string, string>;
  statusCode: number;
  priority: "before" | "fallback";
  authorName?: string;
  beforeFrom?: string;
}): { ok: true; file: string } | { ok: false; status: number; error: string; code?: string } {
  return insertCustomRedirect(opts);
}

/** Return the per-site ConversationStore for the current request, falling back to the default singleton. */
async function getConversationStore(res: Response) {
  const site = (res.locals.site as import("../site-manager").SiteContext | undefined);
  if (site?.conversationStore) return site.conversationStore;
  const { conversationStore } = await import("../ai/ConversationStore");
  return conversationStore;
}

/** Load llm.yml from the per-site content root for this request. Falls back gracefully when not present. */
function loadSiteLLMConfig(res: Response): Record<string, unknown> {
  try {
    const llmPath = path.join(getContentRoot(res), "llm.yml");
    if (fs.existsSync(llmPath)) {
      const raw = yaml.load(fs.readFileSync(llmPath, "utf-8"));
      if (raw && typeof raw === "object") return raw as Record<string, unknown>;
    }
  } catch { /* ignore */ }
  return {};
}

export function registerAdminRoutes(app: Express): void {
  // GCS bucket status — migrationRequired flag + bucket name
  app.get("/api/admin/gcs-status", async (_req, res) => {
    const diagnostics = await gcs.checkArchitecture();
    res.json({
      migrationRequired: gcs.migrationRequired,
      bucketName: gcs.getBucketName() || null,
      available: gcs.available,
      diagnostics,
    });
  });

  app.get("/api/admin/gcs-sync-status", async (req, res) => {
    const detail = req.query.detail === "1" || req.query.detail === "true";
    const diagnostics = detail ? await gcs.checkArchitecture() : undefined;
    const syncStatus = gcs.buildSyncStatus({
      imageQueuePending: aggregateImageQueuePending(),
      imageQueueBusy: isImageQueueBusy(),
      checkError: diagnostics?.checkError,
    });

    if (!detail) {
      res.json(syncStatus);
      return;
    }

    res.json({
      ...syncStatus,
      diagnostics,
    });
  });

  app.get("/api/admin/gcs-sync-inventory", async (_req, res) => {
    const rows = await collectGcsSyncInventory();
    res.json({ rows });
  });

  app.post("/api/admin/gcs-recheck-migration", async (req, res) => {
    const auth = await requireMutatingStaff(req, res);
    if (!auth.authorized) return;

    const diagnostics = await gcs.checkArchitecture();
    res.json({
      migrationRequired: gcs.migrationRequired,
      bucketName: gcs.getBucketName() || null,
      available: gcs.available,
      diagnostics,
      message: gcs.migrationRequired
        ? "Migration still required — new per-site layout not detected in bucket."
        : "Migration check passed — GCS writes are allowed.",
    });
  });

  app.post("/api/admin/gcs-connection-test", async (req, res) => {
    const auth = await requireStaffSession(req, res);
    if (!auth.authorized) return;

    try {
      const result = await runGcsConnectionTest();
      res.json(result);
    } catch (error) {
      res.status(500).json({
        error: error instanceof Error ? error.message : "GCS connection test failed",
      });
    }
  });

  app.get("/api/admin/sites-yml", async (req, res) => {
    const auth = await requireStaffSession(req, res);
    if (!auth.authorized) return;

    try {
      const { readSitesYmlLocal } = await import("../sites-yml-store");
      const content = readSitesYmlLocal();
      res.json({
        exists: content !== null,
        content,
      });
    } catch (err) {
      log.error({ err }, "[SiteManager] Failed to read sites.yml:");
      res.status(500).json({
        exists: false,
        content: null,
        error: err instanceof Error ? err.message : "Failed to read sites.yml",
      });
    }
  });

  app.put("/api/admin/sites-yml", async (req, res) => {
    const auth = await requireCapability(req, res, "sites_manage");
    if (!auth.authorized) return;

    try {
      const { content } = req.body as { content?: string };
      if (typeof content !== "string") {
        return res.status(400).json({ error: "content is required" });
      }

      const { validateSitesYmlContent, resetSiteConfigs, getSiteConfigs } = await import("../site-config");
      const { saveSitesYml } = await import("../sites-yml-store");
      const { resetSiteContextMap } = await import("../site-manager");

      // Validate before writing so a bad edit cannot brick the local registry.
      validateSitesYmlContent(content);
      saveSitesYml(content);
      resetSiteConfigs();
      resetSiteContextMap();

      const { getSiteContextMap, getDefaultSite } = await import("../site-manager");
      const staleSite = res.locals.site;
      if (staleSite) {
        const freshCtx = getSiteContextMap().get(staleSite.config.domain) ?? getDefaultSite();
        res.locals.site = { ...freshCtx, isDevOverride: staleSite.isDevOverride ?? false };
      }

      const sites = getSiteConfigs().map(({ domain, contentFolder, githubRepoUrl }) => ({
        domain,
        contentFolder,
        githubRepoUrl,
      }));
      const siteInfo = getSiteInfo(req, res);

      res.json({
        success: true,
        sites,
        siteInfo,
        message: "sites.yml saved.",
      });
    } catch (err) {
      log.error({ err }, "[SiteManager] Failed to save sites.yml:");
      res.status(400).json({
        success: false,
        error: err instanceof Error ? err.message : "Failed to save sites.yml",
      });
    }
  });

  app.post("/api/admin/gcs-reupload-sites-yml", async (req, res) => {
    const auth = await requireStaffSession(req, res);
    if (!auth.authorized) return;

    try {
      const { reuploadSitesYmlToBucket } = await import("../sites-yml-store");
      const result = await reuploadSitesYmlToBucket();
      if (!result.success) {
        return res.status(400).json({
          ...result,
          message: result.reason ?? "Could not upload site registry.",
        });
      }
      res.json({
        ...result,
        message: `Uploaded site registry to ${result.gcsKey}.`,
      });
    } catch (err) {
      log.error({ err }, "[SiteManager] Failed to re-upload sites.yml to GCS:");
      res.status(500).json({
        success: false,
        uploaded: false,
        message: err instanceof Error ? err.message : "Failed to upload site registry.",
      });
    }
  });

  app.post("/api/admin/gcs-sync-artifact/upload", async (req, res) => {
    const auth = await requireStaffSession(req, res);
    if (!auth.authorized) return;

    try {
      const { kind, siteFolder } = req.body as { kind?: string; siteFolder?: string | null };
      const {
        isSyncArtifactKind,
        uploadSyncArtifact,
      } = await import("../gcs-sync-artifacts");
      if (!kind || !isSyncArtifactKind(kind)) {
        return res.status(400).json({
          success: false,
          message: "Invalid or missing artifact kind.",
        });
      }
      const result = await uploadSyncArtifact(kind, siteFolder ?? null);
      if (!result.success) {
        return res.status(400).json(result);
      }
      res.json(result);
    } catch (err) {
      log.error({ err }, "[CloudSync] Failed to upload sync artifact:");
      res.status(500).json({
        success: false,
        message: err instanceof Error ? err.message : "Failed to upload sync artifact.",
      });
    }
  });

  app.post("/api/admin/gcs-sync-artifact/download", async (req, res) => {
    const auth = await requireStaffSession(req, res);
    if (!auth.authorized) return;

    try {
      const { kind, siteFolder } = req.body as { kind?: string; siteFolder?: string | null };
      const {
        isSyncArtifactKind,
        downloadSyncArtifact,
      } = await import("../gcs-sync-artifacts");
      if (!kind || !isSyncArtifactKind(kind)) {
        return res.status(400).json({
          success: false,
          message: "Invalid or missing artifact kind.",
        });
      }
      const result = await downloadSyncArtifact(kind, siteFolder ?? null);
      if (!result.success) {
        return res.status(400).json(result);
      }
      res.json(result);
    } catch (err) {
      log.error({ err }, "[CloudSync] Failed to download sync artifact:");
      res.status(500).json({
        success: false,
        message: err instanceof Error ? err.message : "Failed to download sync artifact.",
      });
    }
  });

  app.get("/api/admin/gcs-sync-artifact/content", async (req, res) => {
    const auth = await requireStaffSession(req, res);
    if (!auth.authorized) return;

    try {
      const kind = typeof req.query.kind === "string" ? req.query.kind : "";
      const siteFolder =
        typeof req.query.siteFolder === "string" && req.query.siteFolder.length > 0
          ? req.query.siteFolder
          : null;
      const {
        isSyncArtifactKind,
        readSyncArtifactContent,
      } = await import("../gcs-sync-artifacts");
      if (!kind || !isSyncArtifactKind(kind)) {
        return res.status(400).json({
          success: false,
          exists: false,
          path: "",
          content: null,
          error: "Invalid or missing artifact kind.",
        });
      }
      const result = readSyncArtifactContent(kind, siteFolder);
      if (!result.success) {
        return res.status(400).json(result);
      }
      res.json(result);
    } catch (err) {
      log.error({ err }, "[CloudSync] Failed to read sync artifact content:");
      res.status(500).json({
        success: false,
        exists: false,
        path: "",
        content: null,
        error: err instanceof Error ? err.message : "Failed to read sync artifact.",
      });
    }
  });

  app.get("/api/admin/system-alerts", async (req, res) => {
    const auth = await requireCapability(req, res, "metrics_view");
    if (!auth.authorized) return;
    await gcs.checkArchitecture();
    res.json({ alerts: await collectSystemAlerts() });
  });

  app.get("/api/admin/events", async (req, res) => {
    const auth = await requireStaffSession(req, res);
    if (!auth.authorized) return;

    const site = (req.query.site as string) || res.locals.site?.contentRootName;
    if (!site) {
      res.status(400).json({ error: "Missing site" });
      return;
    }
    const type = req.query.type as EventType | undefined;
    const since = req.query.since ? Number(req.query.since) : undefined;
    const cause = req.query.cause as string | undefined;
    const before = req.query.before ? Number(req.query.before) : undefined;
    const triggeredBy = req.query.triggeredBy ? Number(req.query.triggeredBy) : undefined;
    const agentSessionId =
      typeof req.query.agentSessionId === "string" && req.query.agentSessionId.trim()
        ? req.query.agentSessionId.trim()
        : undefined;
    const unscopedOnly = req.query.unscoped === "1" || req.query.unscoped === "true";
    const limit = req.query.limit ? Number(req.query.limit) : 50;

    const events = listEvents({
      site,
      type,
      since,
      cause,
      before,
      triggeredBy,
      agentSessionId,
      unscopedOnly: !agentSessionId && unscopedOnly,
      limit,
    });
    res.json({
      events,
      unpublishedTotal: getUnpublishedCount(site),
      education:
        "This log is the diary of site changes and agent runs. Filter by agent session and by kind. Selecting a session shows a short summary built from those events.",
    });
  });

  app.get("/api/admin/agent-sessions", async (req, res) => {
    const auth = await requireStaffSession(req, res);
    if (!auth.authorized) return;
    const site = (req.query.site as string) || res.locals.site?.contentRootName;
    if (!site) {
      res.status(400).json({ error: "Missing site" });
      return;
    }
    const since = req.query.since ? Number(req.query.since) : undefined;
    const limit = req.query.limit ? Number(req.query.limit) : 20;
    const sessions = listAgentSessions(site, { since, limit });
    res.json({ sessions });
  });

  app.get("/api/admin/agent-sessions/:agentSessionId", async (req, res) => {
    const auth = await requireStaffSession(req, res);
    if (!auth.authorized) return;
    const site = (req.query.site as string) || res.locals.site?.contentRootName;
    if (!site) {
      res.status(400).json({ error: "Missing site" });
      return;
    }
    const agentSessionId = String(req.params.agentSessionId || "").trim();
    if (!agentSessionId) {
      res.status(400).json({ error: "Missing agentSessionId" });
      return;
    }
    const detail = getAgentSessionDetail(site, agentSessionId);
    if (!detail) {
      res.status(404).json({ error: "Session not found" });
      return;
    }
    res.json(detail);
  });

  /** MCP loopback: emit agent_session_started | note | summarized audit events. */
  app.post("/api/admin/agent-sessions/checkpoint", async (req, res) => {
    if (!isMcpLoopbackRequest(req)) {
      res.status(403).json({ error: "MCP loopback only" });
      return;
    }
    const site =
      (typeof req.body?.site === "string" && req.body.site) ||
      res.locals.site?.contentRootName;
    if (!site) {
      res.status(400).json({ error: "Missing site" });
      return;
    }
    const action = req.body?.action as string | undefined;
    if (action !== "start" && action !== "note" && action !== "summarize") {
      res.status(400).json({ error: "action must be start | note | summarize" });
      return;
    }
    const author =
      (typeof req.headers["x-mcp-author"] === "string" && req.headers["x-mcp-author"]) ||
      "mcp";
    const actor = resolveEventActor(req, { model: req.body?.model });

    if (action === "start") {
      const agent_session_id =
        (typeof req.body?.agent_session_id === "string" && req.body.agent_session_id.trim()) ||
        randomUUID();
      const label =
        typeof req.body?.label === "string" && req.body.label.trim()
          ? req.body.label.trim().slice(0, 200)
          : undefined;
      const event = emitEvent({
        site,
        type: "agent_session_started",
        agent_session_id,
        attribution: singleAttribution(author, actor),
        payload: { ...(label ? { label } : {}) },
      });
      return res.json({
        success: true,
        action: "start",
        agent_session_id,
        event_id: event.id,
      });
    }

    const agent_session_id =
      (typeof req.body?.agent_session_id === "string" && req.body.agent_session_id.trim()) ||
      resolveAgentSessionId(req);
    if (!agent_session_id) {
      return res.status(400).json({
        error: "agent_session_id required for note/summarize",
        code: "session_required",
      });
    }
    const existing = listEvents({ site, agentSessionId: agent_session_id, limit: 1 });
    if (existing.length === 0) {
      return res.status(404).json({
        error: "Unknown agent_session_id — call agent_session start first",
        code: "session_unknown",
        action_required: "start",
      });
    }
    const parsed = requireIssueReport(req.body?.report);
    if (!parsed.ok) {
      return res.status(400).json({ error: parsed.error, code: parsed.code });
    }
    const type = action === "note" ? "agent_session_note" : "agent_session_summarized";
    const event = emitEvent({
      site,
      type,
      agent_session_id,
      attribution: singleAttribution(author, actor),
      payload: { report: parsed.report },
    });
    return res.json({
      success: true,
      action,
      agent_session_id,
      event_id: event.id,
    });
  });

  app.delete("/api/admin/events", async (req, res) => {
    const auth = await requireStaffSession(req, res);
    if (!auth.authorized) return;

    const site = (req.query.site as string) || res.locals.site?.contentRootName;
    if (!site) {
      res.status(400).json({ error: "Missing site" });
      return;
    }

    const deleted = clearAllEvents(site);
    res.json({ success: true, deleted });
  });

  /** Dev-only: insert fake timeline events (published; does not wake outbox jobs). */
  app.post("/api/admin/events/seed-demo", async (req, res) => {
    if (process.env.NODE_ENV === "production") {
      res.status(403).json({
        error: "dev_only",
        message: "Demo event seeding is only available in development.",
      });
      return;
    }

    const auth = await requireStaffSession(req, res);
    if (!auth.authorized) return;

    const site =
      (typeof req.body?.site === "string" && req.body.site) ||
      (req.query.site as string) ||
      res.locals.site?.contentRootName;
    if (!site) {
      res.status(400).json({ error: "Missing site" });
      return;
    }

    const mode = req.body?.mode === "live" ? "live" : "batch";
    const liveTick =
      typeof req.body?.tick === "number" && Number.isFinite(req.body.tick)
        ? Math.max(0, Math.floor(req.body.tick))
        : 0;

    const result = seedDemoPipelineEvents(site, mode, liveTick);
    res.json({
      success: true,
      mode: result.mode,
      inserted: result.events.length,
      ids: result.events.map((e) => e.id),
      education:
        "Demo rows are marked published with cause demo-seed so the outbox dispatcher is not woken. Safe for timeline / list UI testing only.",
    });
  });

  /** Dev-only: replace local event log with production history (never uploads). */
  app.post("/api/admin/events/pull-production", async (req, res) => {
    if (process.env.NODE_ENV === "production") {
      res.status(403).json({
        error: "dev_only",
        message: "Pulling production event history is only available in development.",
      });
      return;
    }

    const auth = await requireStaffSession(req, res);
    if (!auth.authorized) return;

    const site =
      (typeof req.body?.site === "string" && req.body.site) ||
      (req.query.site as string) ||
      res.locals.site?.contentRootName;
    if (!site) {
      res.status(400).json({ error: "Missing site" });
      return;
    }

    const productionOrigin =
      typeof req.body?.productionOrigin === "string" ? req.body.productionOrigin : undefined;

    try {
      const { pullProductionEvents } = await import("../events/pull-production");
      const result = await pullProductionEvents(site, auth.token, productionOrigin);
      if (!result.success) {
        res.status(400).json({
          error: result.reason ?? "Failed to pull production event history",
          ...result,
        });
        return;
      }
      res.json({
        ...result,
        education:
          "Replaced the local event log with production rows (newest pages up to 5,000). All rows are marked published so Sidequest is not woken. Does not upload anything to production.",
      });
    } catch (err) {
      log.error({ err, site }, "Failed to pull production event history");
      res.status(500).json({ error: "Failed to pull production event history" });
    }
  });

  app.get("/api/admin/pipeline/status", async (req, res) => {
    const auth = await requireStaffSession(req, res);
    if (!auth.authorized) return;

    const site = (req.query.site as string) || res.locals.site?.contentRootName;
    if (!site) {
      res.status(400).json({ error: "Missing site" });
      return;
    }

    const engine = await getEngineStatus();
    const currentGeneration = getLatestWriteGeneration(site);
    const lastApplied = getLastAppliedSnapshot(site);
    const lastAppliedGeneration = lastApplied?.generation ?? 0;
    const behindBy = Math.max(0, currentGeneration - lastAppliedGeneration);
    const oldestAgeMs = getOldestUnpublishedAgeMs(site);
    const unpublishedCount = getUnpublishedCount(site);
    const pendingEvents = getUnpublishedEvents(site, 20);

    const recentEvents = listEvents({ site, limit: 200 });
    const inFlight = deriveInFlight(recentEvents, lastAppliedGeneration);

    const activeLeases = listActiveLeases(site).map((lease) => {
      const parsed = parseBindingLeaseResource(lease.resource);
      const groupId = parsed?.groupId;
      const locale = parsed?.locale ?? "en";
      const group = groupId ? bindingManager.getGroupById(groupId) : undefined;
      return {
        resource: lease.resource,
        groupId,
        locale,
        holder: lease.holder,
        expiresAt: lease.expiresAt,
        members: group?.members ?? [],
        groupName: group?.name,
      };
    });

    const recentFailures = listEvents({ site, type: "job_failed", limit: 10 });

    const status = derivePipelineOverallStatus({
      oldestUnpublishedAgeMs: oldestAgeMs,
      engineStatus: engine.status,
      behindBy,
    });

    res.json({
      engine,
      outbox: {
        unpublishedCount,
        oldestAgeMs,
        currentGeneration,
        pending: pendingEvents,
      },
      index: {
        lastAppliedGeneration,
        lastAppliedAt: lastApplied?.appliedAt ?? null,
        behindBy,
      },
      inFlight,
      leases: activeLeases,
      recentFailures,
      status,
    });
  });

  app.post("/api/admin/database-recheck", async (req, res) => {
    const auth = await requireMutatingStaff(req, res);
    if (!auth.authorized) return;

    const { database, site } = req.body as { database?: string; site?: string };
    if (!database) {
      res.status(400).json({ error: "Missing 'database' in request body" });
      return;
    }

    const result = await recheckDatabaseHealth(database, site);
    if (!result.found) {
      res.status(404).json(result);
      return;
    }
    res.json({ ...result, alerts: await collectSystemAlerts() });
  });

  // ─── Server controls (staff-only) ─────────────────────────────────────────
  // Richer status than /health, for the Settings → Server tab status card.
  app.get("/api/admin/server/status", async (req, res) => {
    const auth = await requireStaffSession(req, res);
    if (!auth.authorized) return;

    const lastReload = getLastSoftReload();
    const mem = process.memoryUsage();
    res.json({
      status: "ok",
      bootId: BOOT_ID,
      bootTime: BOOT_TIME,
      uptime: process.uptime(),
      env: process.env.NODE_ENV ?? "development",
      nodeVersion: process.version,
      pid: process.pid,
      lastSoftReloadAt: lastReload.at,
      lastSoftReloadId: lastReload.id,
      restartAvailable: isShutdownHandlerRegistered(),
      memory: {
        rssMb: Math.round(mem.rss / 1024 / 1024),
        heapUsedMb: Math.round(mem.heapUsed / 1024 / 1024),
        heapTotalMb: Math.round(mem.heapTotal / 1024 / 1024),
      },
    });
  });

  // Soft reload — re-hydrate derived in-memory state without killing the
  // process. Reports per-step results so a partial failure is visible.
  app.post("/api/admin/server/soft-reload", async (req, res) => {
    const auth = await requireStaffSession(req, res);
    if (!auth.authorized) return;

    try {
      const result = await performSoftReload();
      res.json(result);
    } catch (err) {
      // performSoftReload isolates step failures, but guard the outer call too.
      const message = err instanceof Error ? err.message : String(err);
      log.error({ err }, "[Admin] Soft reload failed unexpectedly");
      res.status(500).json({ success: false, error: message, steps: [] });
    }
  });

  // Hard restart — gracefully exit the process so the platform supervisor
  // relaunches it. The response is flushed first, then shutdown fires on a
  // short delay so the client receives the acknowledgement.
  app.post("/api/admin/server/hard-restart", async (req, res) => {
    const auth = await requireStaffSession(req, res);
    if (!auth.authorized) return;

    if (!isShutdownHandlerRegistered()) {
      res.status(503).json({ error: "Hard restart is unavailable (shutdown handler not registered)." });
      return;
    }

    res.json({ ok: true, bootId: BOOT_ID, message: "Restart initiated" });

    // Delay so the response fully flushes before we begin tearing down.
    setTimeout(() => {
      triggerGracefulShutdown("ADMIN_HARD_RESTART");
    }, 250);
  });
  // ──────────────────────────────────────────────────────────────────────────

  // Clear sitemap cache (requires token validation)
  app.post("/api/debug/clear-sitemap-cache", async (req, res) => {
    try {
      const auth = await requireCapability(req, res, "seo_settings");
      if (!auth.authorized) return;

      const result = clearSitemapCache();
      res.json(result);
    } catch (error) {
      log.error({ err: error }, "Error clearing sitemap cache:");
      res.status(500).json({ error: "Failed to clear cache" });
    }
  });

  // Clear page-level cache for a specific URL
  app.post("/api/debug/clear-page-cache", async (req, res) => {
    try {
      const authHeader = req.headers.authorization;
      const token = authHeader?.replace("Token ", "");
      const isDevelopment = process.env.NODE_ENV !== "production";

      if (!isDevelopment && !token) {
        res.status(401).json({ error: "Authorization required" });
        return;
      }

      if (!isDevelopment && token) {
        const response = await fetch(
          `${BREATHECODE_HOST}/v1/auth/user/me/capability/webmaster`,
          {
            method: "GET",
            headers: {
              Authorization: `Token ${token}`,
              Academy: "4",
            },
          },
        );
        if (response.status !== 200) {
          res.status(403).json({ error: "Invalid or unauthorized token" });
          return;
        }
      }

      const { url } = req.body as { url?: string };
      if (!url) {
        res.status(400).json({ error: "Missing 'url' in request body" });
        return;
      }

      let urlPath: string;
      try {
        urlPath = new URL(url).pathname;
      } catch {
        urlPath = url;
      }

      // Use content index URL parsing for reliable type+slug resolution
      let resolved = getCI(res).parseContentUrl(urlPath);

      // Fall back to home page for root/locale-only paths like /, /en, /es
      if (!resolved) {
        const LOCALE_ONLY = new Set(["/", "/en", "/es", "/en/", "/es/"]);
        const isLocaleOnly = LOCALE_ONLY.has(urlPath) || /^\/[a-z]{2}\/?$/.test(urlPath);
        if (isLocaleOnly) {
          const homePage = getHomePage();
          if (homePage?.type && homePage?.slug) {
            resolved = { contentType: homePage.type, slug: homePage.slug, locale: "en" };
          }
        }
      }

      if (resolved) {
        invalidateContentCaches(resolved.contentType);
        if (resolved.slug) {
          clearMarkdownCache(resolved.slug);
        }
      }

      res.json({ success: true, message: `Cache refreshed for ${urlPath}` });
    } catch (error) {
      log.error({ err: error }, "Error clearing page cache:");
      res.status(500).json({ error: "Failed to clear page cache" });
    }
  });

  // Get active redirects (for debug tools)
  app.get("/api/debug/redirects", async (req, res) => {
    const auth = await requireCapability(req, res, "read_redirects");
    if (!auth.authorized) return;
    const ci = getCI(res);
    const siteEntries = getFreshRedirectEntries(ci);
    const redirects = siteEntries.map((e) => ({
      from: e.from,
      to: e.to,
      type: e.type || "redirect",
      status: e.status || 301,
      source: e.source || ci.contentRoot,
      priority: e.priority,
    }));
    res.json({ count: redirects.length, redirects });
  });

  app.get("/api/debug/redirects/yml", async (req, res) => {
    const auth = await requireCapability(req, res, "read_redirects");
    if (!auth.authorized) return;
    try {
      const relativePath = `${getContentRootName(res)}/custom-redirects.yml`;
      const customFilePath = path.join(getContentRoot(res), "custom-redirects.yml");
      if (!fs.existsSync(customFilePath)) {
        res.json({ exists: false, path: relativePath, content: null });
        return;
      }
      const content = fs.readFileSync(customFilePath, "utf-8");
      res.json({ exists: true, path: relativePath, content });
    } catch (err) {
      log.error({ err }, "[Redirects] Failed to read custom-redirects.yml:");
      res.status(500).json({
        exists: false,
        path: `${getContentRootName(res)}/custom-redirects.yml`,
        content: null,
        error: err instanceof Error ? err.message : "Failed to read custom-redirects.yml",
      });
    }
  });

  app.put("/api/debug/redirects/yml", async (req, res) => {
    const auth = await requireCapability(req, res, "edit_redirects");
    if (!auth.authorized) return;
    try {
      const { content, author } = req.body as {
        content?: string;
        author?: string;
      };
      if (typeof content !== "string") {
        res.status(400).json({ error: "content is required" });
        return;
      }

      let parsed: unknown;
      try {
        parsed = safeYamlLoad(content);
      } catch (err) {
        res.status(400).json({
          error: `Invalid YAML: ${err instanceof Error ? err.message : String(err)}`,
        });
        return;
      }

      if (parsed == null || typeof parsed !== "object" || Array.isArray(parsed)) {
        res.status(400).json({ error: "custom-redirects.yml must be a YAML object with a redirects array" });
        return;
      }

      const root = parsed as Record<string, unknown>;
      if (!Array.isArray(root.redirects)) {
        res.status(400).json({ error: "custom-redirects.yml must have a redirects array" });
        return;
      }

      const seenFrom = new Set<string>();
      for (let i = 0; i < root.redirects.length; i++) {
        const entry = root.redirects[i];
        if (entry == null || typeof entry !== "object" || Array.isArray(entry)) {
          res.status(400).json({ error: `Redirect at index ${i} must be an object` });
          return;
        }
        const item = entry as Record<string, unknown>;
        if (typeof item.from !== "string" || !item.from.trim()) {
          res.status(400).json({ error: `Redirect at index ${i} requires a non-empty string "from"` });
          return;
        }
        if (typeof item.to !== "string" || !item.to.trim()) {
          res.status(400).json({ error: `Redirect at index ${i} requires a non-empty string "to"` });
          return;
        }
        if (item.status !== undefined && item.status !== 301 && item.status !== 302) {
          res.status(400).json({ error: `Redirect at index ${i}: status must be 301 or 302` });
          return;
        }
        if (
          item.priority !== undefined &&
          item.priority !== "before" &&
          item.priority !== "fallback"
        ) {
          res.status(400).json({
            error: `Redirect at index ${i}: priority must be "before" or "fallback"`,
          });
          return;
        }
        const normalizedFrom = item.from.toLowerCase();
        if (seenFrom.has(normalizedFrom)) {
          res.status(400).json({
            error: `Duplicate redirect "from" value: ${item.from}`,
          });
          return;
        }
        seenFrom.add(normalizedFrom);
      }

      const relativePath = `${getContentRootName(res)}/custom-redirects.yml`;
      const customFilePath = path.join(getContentRoot(res), "custom-redirects.yml");
      const authorName = author && typeof author === "string" ? author : undefined;

      fs.writeFileSync(customFilePath, content, "utf-8");
      markFileAsModified(customFilePath, authorName, undefined, getContentRoot(res));

      getCI(res).refreshAfterRedirectWrite(relativePath);
      clearRedirectCache();

      res.json({ success: true, path: relativePath });
    } catch (err) {
      log.error({ err }, "[Redirects] Failed to write custom-redirects.yml:");
      res.status(500).json({
        error: err instanceof Error ? err.message : "Failed to write custom-redirects.yml",
      });
    }
  });

  app.get("/api/locale-urls", (req, res) => {
    try {
      const url = req.query.url as string;
      if (!url) {
        res.status(400).json({ error: "Missing 'url' query parameter" });
        return;
      }

      const parsed = getCI(res).parseContentUrl(url);
      if (!parsed) {
        res
          .status(400)
          .json({ error: "Could not determine content type from URL" });
        return;
      }

      const urls = getCI(res).getAlternateUrls(parsed.slug, parsed.contentType);
      res.json({ urls, contentType: parsed.contentType, slug: parsed.slug });
    } catch (err) {
      log.error({ err: err }, "[API] Failed to resolve locale URLs:");
      res.status(500).json({ error: "Failed to resolve locale URLs" });
    }
  });

  app.get("/api/debug/redirects/locale-urls", async (req, res) => {
    const auth = await requireCapability(req, res, "read_redirects");
    if (!auth.authorized) return;
    try {
      const url = req.query.url as string;
      if (!url) {
        res.status(400).json({ error: "Missing 'url' query parameter" });
        return;
      }

      const parsed = getCI(res).parseContentUrl(url);
      if (!parsed) {
        res
          .status(400)
          .json({ error: "Could not determine content type from URL" });
        return;
      }

      const urls = getCI(res).getAlternateUrls(parsed.slug, parsed.contentType);
      res.json({ urls, contentType: parsed.contentType, slug: parsed.slug });
    } catch (err) {
      log.error({ err: err }, "[Debug] Failed to resolve locale URLs:");
      res.status(500).json({ error: "Failed to resolve locale URLs" });
    }
  });

  // Add a new redirect (for debug tools)
  app.post("/api/debug/redirects", async (req, res) => {
    const auth = await requireCapability(req, res, "edit_redirects");
    if (!auth.authorized) return;
    try {
      const {
        from,
        to,
        allLanguages,
        status: redirectStatus,
        isCustomDestination,
        priority: redirectPriority,
        author,
      } = req.body;
      const authorName = author && typeof author === "string" ? author : undefined;
      const statusCode =
        redirectStatus && [301, 302].includes(redirectStatus)
          ? redirectStatus
          : 301;
      const priority = redirectPriority === "fallback" ? "fallback" : "before";

      if (!from || !to) {
        res
          .status(400)
          .json({ error: "Both 'from' and 'to' fields are required" });
        return;
      }

      let normalizedFrom = (from as string).startsWith("/")
        ? (from as string)
        : `/${from}`;
      normalizedFrom = normalizedFrom.toLowerCase();
      if (normalizedFrom.length > 1 && normalizedFrom.endsWith("/")) {
        normalizedFrom = normalizedFrom.slice(0, -1);
      }

      const destUrl = to as string;

      const beforeFrom =
        typeof req.body.before_from === "string" && req.body.before_from.trim()
          ? (req.body.before_from as string).trim()
          : undefined;

      if (isCustomDestination) {
        const written = appendCustomRedirect({
          contentRoot: getContentRoot(res),
          contentRootName: getContentRootName(res),
          from: normalizedFrom,
          to: destUrl,
          statusCode,
          priority,
          authorName,
          beforeFrom,
        });
        if (!written.ok) {
          res.status(written.status).json({ error: written.error, code: written.code });
          return;
        }

        afterRedirectWrite(res, written.file);

        res.json({
          success: true,
          message: `Custom redirect added: ${normalizedFrom} -> ${destUrl}`,
          file: written.file,
        });
        return;
      }

      // Parse destination URL to find the content entry
      const parsed = getCI(res).parseContentUrl(destUrl);
      if (!parsed) {
        res.status(400).json({
          error: "Could not determine content type from destination URL",
        });
        return;
      }

      const { contentType, locale } = parsed;
      const resolvedSlug = getCI(res).resolveBaseSlug(
        parsed.slug,
        contentType,
      );
      const entries = getCI(res).findBySlug(resolvedSlug, { contentType });

      // DB-backed types (how-to, lesson, …) have no per-slug YAML folder for meta.redirects.
      // Fall back to custom-redirects.yml when the sitemap/URL exists but findBySlug is empty.
      // YAML override folders under the same type still take the meta.redirects path below.
      if (entries.length === 0 && getCI(res).isDatabaseBacked(contentType)) {
        const builtUrl = getCI(res).buildUrl(contentType, locale, parsed.slug);
        const alternateUrls = getCI(res).getAlternateUrls(
          parsed.slug,
          contentType,
        );
        const resolvedDest = resolveDatabaseBackedRedirectDestination({
          destUrl,
          allLanguages: !!allLanguages,
          builtUrl,
          alternateUrls,
          isKnownUrl: (url) => getCI(res).isKnownUrl(url),
        });

        if (!resolvedDest.ok) {
          res.status(404).json({
            error: `No content found for slug "${parsed.slug}" in ${contentType}`,
          });
          return;
        }

        const written = appendCustomRedirect({
          contentRoot: getContentRoot(res),
          contentRootName: getContentRootName(res),
          from: normalizedFrom,
          to: resolvedDest.to,
          statusCode,
          priority,
          authorName,
          beforeFrom,
        });
        if (!written.ok) {
          res.status(written.status).json({ error: written.error, code: written.code });
          return;
        }

        afterRedirectWrite(res, written.file);

        const toLabel =
          typeof resolvedDest.to === "string"
            ? resolvedDest.to
            : Object.values(resolvedDest.to).join(", ");
        res.json({
          success: true,
          message: `Redirect added: ${normalizedFrom} -> ${toLabel}`,
          file: written.file,
        });
        return;
      }

      if (entries.length === 0) {
        res.status(404).json({
          error: `No content found for slug "${parsed.slug}" in ${contentType}`,
        });
        return;
      }

      if (beforeFrom) {
        res.status(400).json({
          code: "before_from_page_yaml",
          error:
            "before_from is only valid for custom-redirects.yml. Page meta.redirects cannot be reordered with move/before_from.",
        });
        return;
      }

      const entry = entries[0];
      const basePath = path.join(process.cwd(), entry.directory);

      let targetFile: string;
      if (allLanguages) {
        targetFile = "_common.yml";
      } else {
        targetFile = `${locale}.yml`;
      }

      const filePath = path.join(basePath, targetFile);

      let yamlData: Record<string, unknown> = {};
      if (fs.existsSync(filePath)) {
        const raw = fs.readFileSync(filePath, "utf-8");
        yamlData = (safeYamlLoad(raw) as Record<string, unknown>) || {};
      }

      if (!yamlData.meta || typeof yamlData.meta !== "object") {
        yamlData.meta = {};
      }
      const meta = yamlData.meta as Record<string, unknown>;
      if (!Array.isArray(meta.redirects)) {
        meta.redirects = [];
      }
      const redirects = meta.redirects as unknown[];

      const existingPath = (r: unknown) => {
        if (typeof r === "string") return r.toLowerCase();
        if (typeof r === "object" && r !== null && "path" in r)
          return (r as { path: string }).path.toLowerCase();
        return "";
      };

      if (redirects.some((r) => existingPath(r) === normalizedFrom)) {
        res.status(409).json({
          error: `Redirect "${normalizedFrom}" already exists in ${targetFile}`,
        });
        return;
      }

      if (statusCode !== 301) {
        redirects.push({ path: normalizedFrom, status: statusCode });
      } else {
        redirects.push(normalizedFrom);
      }

      const yamlContent = safeYamlDump(yamlData, {
        lineWidth: -1,
        noRefs: true,
      });
      fs.writeFileSync(filePath, yamlContent, "utf-8");
      markFileAsModified(filePath, authorName, undefined, getContentRoot(res));

      const writtenFile = `${entry.directory}/${targetFile}`;
      afterRedirectWrite(res, writtenFile);

      res.json({
        success: true,
        message: `Redirect added: ${normalizedFrom} -> ${destUrl}`,
        file: writtenFile,
      });
    } catch (err) {
      log.error({ err: err }, "[Debug] Failed to add redirect:");
      res.status(500).json({ error: "Failed to add redirect" });
    }
  });

  // Delete a redirect (for debug tools)
  app.delete("/api/debug/redirects", async (req, res) => {
    const auth = await requireCapability(req, res, "edit_redirects");
    if (!auth.authorized) return;
    try {
      const { from, source, author } = req.body;
      const authorName = author && typeof author === "string" ? author : undefined;

      if (!from || !source) {
        res
          .status(400)
          .json({ error: "Both 'from' and 'source' fields are required" });
        return;
      }

      let normalizedFrom = (from as string).startsWith("/")
        ? (from as string)
        : `/${from}`;
      normalizedFrom = normalizedFrom.toLowerCase();
      if (normalizedFrom.length > 1 && normalizedFrom.endsWith("/")) {
        normalizedFrom = normalizedFrom.slice(0, -1);
      }

      // Accept cwd-relative site_* paths, display paths relative to content root,
      // or legacy roots (marketing-content/, 4geeks-com/, content/) remapped to
      // the active site folder — never nest marketing-content under site_*.
      const marketingDir = path.resolve(getContentRoot(res));
      const contentRootName = path.basename(marketingDir);
      const LEGACY_CONTENT_ROOTS = new Set([
        "marketing-content",
        "4geeks-com",
        "content",
      ]);
      let sourceFile = String(source).replace(/\\/g, "/");
      const firstSeg = sourceFile.split("/").filter(Boolean)[0] ?? "";
      if (
        firstSeg &&
        (LEGACY_CONTENT_ROOTS.has(firstSeg) ||
          (/^site_[^/]+$/.test(firstSeg) && firstSeg !== contentRootName))
      ) {
        const rest = sourceFile.split("/").filter(Boolean).slice(1).join("/");
        sourceFile = rest ? `${contentRootName}/${rest}` : contentRootName;
      }
      // Collapse site_*/marketing-content/... from a prior bad join
      {
        const parts = sourceFile.split("/").filter(Boolean);
        if (
          parts[0] === contentRootName &&
          parts[1] &&
          LEGACY_CONTENT_ROOTS.has(parts[1])
        ) {
          sourceFile = [contentRootName, ...parts.slice(2)].join("/");
        }
      }

      let resolvedSource = path.resolve(process.cwd(), sourceFile);
      if (
        !resolvedSource.startsWith(marketingDir + path.sep) &&
        resolvedSource !== marketingDir
      ) {
        // Only treat as site-relative when it does not already look like a
        // different top-level content root (handled above).
        const underRoot = path.resolve(marketingDir, sourceFile);
        if (
          underRoot.startsWith(marketingDir + path.sep) &&
          underRoot !== marketingDir
        ) {
          sourceFile = path
            .relative(process.cwd(), underRoot)
            .split(path.sep)
            .join("/");
          resolvedSource = underRoot;
        }
      }
      if (
        !resolvedSource.startsWith(marketingDir + path.sep) &&
        resolvedSource !== marketingDir
      ) {
        res.status(400).json({ error: "Invalid source file path" });
        return;
      }
      if (!sourceFile.endsWith(".yml") && !sourceFile.endsWith(".yaml")) {
        res.status(400).json({ error: "Invalid source file type" });
        return;
      }

      if (
        sourceFile === `${contentRootName}/custom-redirects.yml` ||
        sourceFile === "custom-redirects.yml"
      ) {
        const customFilePath = path.join(
          getContentRoot(res),
          "custom-redirects.yml",
        );

        if (!fs.existsSync(customFilePath)) {
          res.status(404).json({ error: "Custom redirects file not found" });
          return;
        }

        const raw = fs.readFileSync(customFilePath, "utf-8");
        const loaded = safeYamlLoad(raw) as {
          redirects?: Array<{ from: string; to: string; status?: number }>;
        } | null;

        if (!loaded || !Array.isArray(loaded.redirects)) {
          // Idempotent: no redirects list means the rule is already gone.
          afterRedirectWrite(res, sourceFile);
          res.json({
            success: true,
            alreadyAbsent: true,
            message: `Custom redirect "${normalizedFrom}" was already absent`,
          });
          return;
        }

        const originalLength = loaded.redirects.length;
        loaded.redirects = loaded.redirects.filter((r) => {
          let rFrom = r.from?.startsWith("/") ? r.from : `/${r.from}`;
          rFrom = rFrom.toLowerCase();
          if (rFrom.length > 1 && rFrom.endsWith("/"))
            rFrom = rFrom.slice(0, -1);
          return rFrom !== normalizedFrom;
        });

        if (loaded.redirects.length === originalLength) {
          afterRedirectWrite(res, sourceFile);
          res.json({
            success: true,
            alreadyAbsent: true,
            message: `Custom redirect "${normalizedFrom}" was already absent`,
          });
          return;
        }

        const yamlContent = safeYamlDump(loaded, {
          lineWidth: -1,
          noRefs: true,
        });
        fs.writeFileSync(customFilePath, yamlContent, "utf-8");
        markFileAsModified(customFilePath, authorName, undefined, getContentRoot(res));

        afterRedirectWrite(res, sourceFile);

        res.json({
          success: true,
          message: `Custom redirect "${normalizedFrom}" deleted`,
        });
        return;
      }

      const filePath = path.join(process.cwd(), sourceFile);

      if (!fs.existsSync(filePath)) {
        res
          .status(404)
          .json({ error: `Source file "${sourceFile}" not found` });
        return;
      }

      const raw = fs.readFileSync(filePath, "utf-8");
      const parsed = (safeYamlLoad(raw) as Record<string, unknown>) || {};

      const meta = parsed.meta as Record<string, unknown> | undefined;
      if (!meta || !Array.isArray(meta.redirects)) {
        // Idempotent: empty/missing redirects means the rule is already gone.
        afterRedirectWrite(res, sourceFile);
        res.json({
          success: true,
          alreadyAbsent: true,
          message: `Redirect "${normalizedFrom}" was already absent from "${sourceFile}"`,
        });
        return;
      }

      const redirects = meta.redirects as unknown[];
      const originalLength = redirects.length;

      const getRedirectPath = (r: unknown): string => {
        if (typeof r === "string") {
          let p = r.startsWith("/") ? r : `/${r}`;
          p = p.toLowerCase();
          if (p.length > 1 && p.endsWith("/")) p = p.slice(0, -1);
          return p;
        }
        if (typeof r === "object" && r !== null && "path" in r) {
          let p = (r as { path: string }).path;
          p = p.startsWith("/") ? p : `/${p}`;
          p = p.toLowerCase();
          if (p.length > 1 && p.endsWith("/")) p = p.slice(0, -1);
          return p;
        }
        return "";
      };

      meta.redirects = redirects.filter(
        (r) => getRedirectPath(r) !== normalizedFrom,
      );

      if ((meta.redirects as unknown[]).length === originalLength) {
        afterRedirectWrite(res, sourceFile);
        res.json({
          success: true,
          alreadyAbsent: true,
          message: `Redirect "${normalizedFrom}" was already absent from "${sourceFile}"`,
        });
        return;
      }

      const yamlContent = safeYamlDump(parsed, { lineWidth: -1, noRefs: true });
      fs.writeFileSync(filePath, yamlContent, "utf-8");
      markFileAsModified(filePath, authorName, undefined, getContentRoot(res));

      afterRedirectWrite(res, sourceFile);

      res.json({
        success: true,
        message: `Redirect "${normalizedFrom}" deleted from "${sourceFile}"`,
      });
    } catch (err) {
      log.error({ err: err }, "[Debug] Failed to delete redirect:");
      res.status(500).json({ error: "Failed to delete redirect" });
    }
  });

  app.patch("/api/debug/redirects/reorder", async (req, res) => {
    const auth = await requireCapability(req, res, "edit_redirects");
    if (!auth.authorized) return;
    try {
      const { redirects, author } = req.body;
      const authorName = author && typeof author === "string" ? author : undefined;

      if (!Array.isArray(redirects)) {
        res.status(400).json({
          error: "'redirects' must be an array of {from, to, status?} entries",
        });
        return;
      }

      for (const entry of redirects) {
        if (!entry || typeof entry !== "object" || !entry.from || !entry.to) {
          res
            .status(400)
            .json({ error: "Each redirect must have 'from' and 'to' fields" });
          return;
        }
      }

      const customFilePath = path.join(
        getContentRoot(res),
        "custom-redirects.yml",
      );

      const newEntries = redirects.map(
        (r: {
          from: string;
          to: string;
          status?: number;
          priority?: string;
        }) => {
          const entry: {
            from: string;
            to: string;
            status?: number;
            priority?: string;
          } = { from: r.from, to: r.to };
          if (r.status && r.status !== 301) entry.status = r.status;
          if (r.priority === "fallback") entry.priority = "fallback";
          return entry;
        },
      );

      const yamlContent = safeYamlDump(
        { redirects: newEntries },
        { lineWidth: -1, noRefs: true },
      );
      fs.writeFileSync(customFilePath, yamlContent, "utf-8");
      markFileAsModified(customFilePath, authorName, undefined, getContentRoot(res));

      getCI(res).refreshAfterRedirectWrite(
        `${getContentRootName(res)}/custom-redirects.yml`,
      );
      clearRedirectCache();

      res.json({
        success: true,
        message: `Custom redirects reordered (${newEntries.length} entries)`,
      });
    } catch (err) {
      log.error({ err: err }, "[Debug] Failed to reorder redirects:");
      res.status(500).json({ error: "Failed to reorder redirects" });
    }
  });

  app.patch("/api/debug/redirects/move", async (req, res) => {
    const auth = await requireCapability(req, res, "edit_redirects");
    if (!auth.authorized) return;
    try {
      const { from, before_from: beforeFrom, author } = req.body;
      const authorName = author && typeof author === "string" ? author : undefined;

      if (!from || typeof from !== "string" || !beforeFrom || typeof beforeFrom !== "string") {
        res.status(400).json({
          error: "Both 'from' and 'before_from' are required to move a custom redirect",
        });
        return;
      }

      const moved = moveCustomRedirect({
        contentRoot: getContentRoot(res),
        contentRootName: getContentRootName(res),
        from,
        beforeFrom,
        authorName,
      });
      if (!moved.ok) {
        res.status(moved.status).json({ error: moved.error, code: moved.code });
        return;
      }

      afterRedirectWrite(res, moved.file);

      res.json({
        success: true,
        message: `Moved "${from}" immediately above "${beforeFrom}"`,
        file: moved.file,
        index: moved.index,
      });
    } catch (err) {
      log.error({ err: err }, "[Debug] Failed to move redirect:");
      res.status(500).json({ error: "Failed to move redirect" });
    }
  });

  app.get("/api/debug/redirects/test", async (req, res) => {
    const auth = await requireCapability(req, res, "read_redirects");
    if (!auth.authorized) return;
    const url = req.query.url as string;
    if (!url) {
      res.status(400).json({ error: "Missing 'url' query parameter" });
      return;
    }
    const locale = (req.query.locale as string) || getDefaultLocale();
    const ci = getCI(res);
    const result = testRedirect(url, locale, ci);
    const { enrichRedirectDestinationExists, makeQuerySlugExists } = await import(
      "../runtime-issues-probe"
    );
    const enriched = await enrichRedirectDestinationExists(
      result,
      ci,
      makeQuerySlugExists({
        ci,
        db: getDB(res),
        contentRoot: getContentRoot(res),
      }),
    );
    const inspect = inspectRedirect(url, locale, ci, enriched);
    res.json({
      ...enriched,
      winner: inspect.winner,
      conflicts: inspect.conflicts,
      fixes: inspect.fixes,
      live_content: inspect.live_content,
    });
  });

  // Update a custom regex redirect's from/to (inline editor)
  app.patch("/api/debug/redirects", async (req, res) => {
    const auth = await requireCapability(req, res, "edit_redirects");
    if (!auth.authorized) return;
    try {
      const { from, newFrom, newTo, author } = req.body;
      const authorName = author && typeof author === "string" ? author : undefined;

      if (!from || typeof from !== "string") {
        res.status(400).json({ error: "'from' is required" });
        return;
      }

      const hasNewFrom = typeof newFrom === "string" && newFrom.trim().length > 0;
      const hasNewTo = typeof newTo === "string" && newTo.trim().length > 0;
      if (!hasNewFrom && !hasNewTo) {
        res.status(400).json({ error: "Provide 'newFrom' and/or 'newTo'" });
        return;
      }

      if (!isRegexPattern(from)) {
        res.status(400).json({
          error: "Inline edit is only supported for custom regex redirects",
        });
        return;
      }

      const customFilePath = path.join(
        getContentRoot(res),
        "custom-redirects.yml",
      );

      if (!fs.existsSync(customFilePath)) {
        res.status(404).json({ error: "custom-redirects.yml not found" });
        return;
      }

      const raw = fs.readFileSync(customFilePath, "utf-8");
      const parsed = yaml.load(raw) as { redirects?: any[] } | null;
      const entries = parsed?.redirects || [];

      const entry = entries.find((r: any) => r.from === from);
      if (!entry) {
        res
          .status(404)
          .json({ error: `Redirect "${from}" not found in custom-redirects.yml` });
        return;
      }

      if (hasNewFrom) {
        const trimmedFrom = (newFrom as string).trim();
        if (!isRegexPattern(trimmedFrom)) {
          res.status(400).json({
            error: "Updated 'from' must remain a regex pattern",
          });
          return;
        }
        try {
          new RegExp(`^${trimmedFrom}$`, "i");
        } catch {
          res.status(400).json({ error: "Updated 'from' is not a valid regular expression" });
          return;
        }
        if (
          trimmedFrom !== from &&
          entries.some((r: any) => r.from === trimmedFrom)
        ) {
          res.status(409).json({
            error: `Redirect "${trimmedFrom}" already exists in custom-redirects.yml`,
          });
          return;
        }
        entry.from = trimmedFrom;
      }

      if (hasNewTo) {
        entry.to = (newTo as string).trim();
      }

      const yamlContent = safeYamlDump(
        { redirects: entries },
        { lineWidth: -1, noRefs: true },
      );
      fs.writeFileSync(customFilePath, yamlContent, "utf-8");
      markFileAsModified(customFilePath, authorName, undefined, getContentRoot(res));

      // Keep live middleware + debug tester in sync with disk (cheap custom re-read)
      getCI(res).refreshAfterRedirectWrite(
        `${getContentRootName(res)}/custom-redirects.yml`,
      );
      clearRedirectCache();

      res.json({
        success: true,
        from: entry.from,
        to: entry.to,
        message: `Custom redirect updated: ${entry.from} -> ${entry.to}`,
        file: `${getContentRootName(res)}/custom-redirects.yml`,
      });
    } catch (err) {
      log.error({ err: err }, "[Debug] Failed to update redirect:");
      res.status(500).json({ error: "Failed to update redirect" });
    }
  });

  app.patch("/api/debug/redirects/priority", async (req, res) => {
    const auth = await requireCapability(req, res, "edit_redirects");
    if (!auth.authorized) return;
    try {
      const { from, priority, author } = req.body;
      const authorName = author && typeof author === "string" ? author : undefined;

      if (!from || typeof from !== "string") {
        res.status(400).json({ error: "'from' is required" });
        return;
      }

      if (priority !== "before" && priority !== "fallback") {
        res
          .status(400)
          .json({ error: "'priority' must be 'before' or 'fallback'" });
        return;
      }

      const customFilePath = path.join(
        getContentRoot(res),
        "custom-redirects.yml",
      );

      if (!fs.existsSync(customFilePath)) {
        res.status(404).json({ error: "custom-redirects.yml not found" });
        return;
      }

      const raw = fs.readFileSync(customFilePath, "utf-8");
      const parsed = yaml.load(raw) as { redirects?: any[] } | null;
      const entries = parsed?.redirects || [];

      const entry = entries.find((r: any) => r.from === from);
      if (!entry) {
        res
          .status(404)
          .json({ error: "Redirect not found in custom-redirects.yml" });
        return;
      }

      if (priority === "fallback") {
        entry.priority = "fallback";
      } else {
        delete entry.priority;
      }

      const yamlContent = safeYamlDump(
        { redirects: entries },
        { lineWidth: -1, noRefs: true },
      );
      fs.writeFileSync(customFilePath, yamlContent, "utf-8");
      markFileAsModified(customFilePath, authorName, undefined, getContentRoot(res));

      getCI(res).refreshAfterRedirectWrite(
        `${getContentRootName(res)}/custom-redirects.yml`,
      );
      clearRedirectCache();

      res.json({
        success: true,
        priority: priority === "fallback" ? "fallback" : "before",
      });
    } catch (err) {
      log.error({ err: err }, "[Debug] Failed to update redirect priority:");
      res.status(500).json({ error: "Failed to update redirect priority" });
    }
  });

  // Clear redirect cache (for debug tools) — cheap custom refresh + async slow rescan
  app.post("/api/debug/clear-redirect-cache", async (req, res) => {
    const auth = await requireCapability(req, res, "edit_redirects");
    if (!auth.authorized) return;
    try {
      const ci = getCI(res);
      ci.refreshCustomRedirects();
      ci.startSlowScanAsync(0);
    } catch (err) {
      log.warn({ err }, "[Debug] ContentIndex rescan failed during clear-redirect-cache");
    }
    clearRedirectCache();
    res.json({ success: true, message: "Redirect cache cleared and content index rescanned" });
  });

  app.get("/api/admin/brand-settings", async (req, res) => {
    const auth = await requireCapability(req, res, "seo_settings");
    if (!auth.authorized) return;
    try {
      const schemaPath = path.join(getContentRoot(res), "schema-org.yml");
      let sameAs: string[] = [];
      if (fs.existsSync(schemaPath)) {
        try {
          const raw = fs.readFileSync(schemaPath, "utf-8");
          const parsed = yaml.load(raw) as Record<string, unknown>;
          const org = parsed?.organization as Record<string, unknown> | undefined;
          if (Array.isArray(org?.same_as)) sameAs = org.same_as as string[];
        } catch {}
      }

      const knownDomains = ["twitter.com/", "x.com/", "linkedin.com/", "facebook.com/", "youtube.com/", "instagram.com/", "github.com/"];
      const unknownSameAs = sameAs.filter(
        (u) => typeof u === "string" && !knownDomains.some((d) => u.includes(d))
      );

      const cr = getContentRoot(res);
      const brand = getVariableManager(cr).getBrandSettings();
      const mg = (res.locals.site as { mediaGallery?: typeof mediaGallery } | undefined)?.mediaGallery ?? mediaGallery;
      // Only return real URLs — bare registry IDs when lookup fails are not usable srcs
      // and blocked live-preview fallback to the light logo.
      const resolveLogoSrc = (idOrUrl: string): string => {
        const raw = idOrUrl.trim();
        if (!raw) return "";
        if (raw.startsWith("http://") || raw.startsWith("https://") || raw.startsWith("/") || raw.startsWith("data:")) {
          return raw;
        }
        return mg.getImage(raw)?.src ?? "";
      };
      const logoSrc = brand.logo ? resolveLogoSrc(brand.logo) : "";
      const logoDarkSrc = brand.logo_dark ? resolveLogoSrc(brand.logo_dark) : "";

      res.json({
        title: brand.title,
        logo: brand.logo,
        logo_dark: brand.logo_dark,
        logo_src: logoSrc,
        logo_dark_src: logoDarkSrc,
        default_social_image: getWebsiteDefaultSocialImage(cr) ?? "",
        twitter_handle: getOrganizationTwitterHandle(cr) ?? "",
        linkedin: getOrganizationSameAsUrl("linkedin", cr) ?? "",
        facebook: getOrganizationSameAsUrl("facebook", cr) ?? "",
        youtube: getOrganizationSameAsUrl("youtube", cr) ?? "",
        instagram: getOrganizationSameAsUrl("instagram", cr) ?? "",
        github: getOrganizationSameAsUrl("github", cr) ?? "",
        unknown_same_as: unknownSameAs,
      });
    } catch (err: any) {
      res.status(500).json({ error: err.message || String(err) });
    }
  });

  app.put("/api/admin/brand-settings", async (req, res) => {
    const auth = await requireCapability(req, res, "seo_settings");
    if (!auth.authorized) return;
    try {
      const {
        default_social_image,
        twitter_handle,
        linkedin,
        facebook,
        youtube,
        instagram,
        github,
        title,
        logo,
        logo_dark,
      } = req.body;

      const cr = getContentRoot(res);
      const vm = getVariableManager(cr);
      const mg = (res.locals.site as { mediaGallery?: typeof mediaGallery } | undefined)?.mediaGallery ?? mediaGallery;

      if (title !== undefined) {
        if (typeof title !== "string") {
          res.status(400).json({ error: "title must be a string" });
          return;
        }
        const trimmedTitle = title.trim();
        vm.updateBrandSetting("title", trimmedTitle);
        if (trimmedTitle) updateOrganizationName(trimmedTitle);
      }

      if (logo !== undefined) {
        if (typeof logo !== "string") {
          res.status(400).json({ error: "logo must be a string" });
          return;
        }
        const trimmedLogo = logo.trim();
        vm.updateBrandSetting("logo", trimmedLogo);
        if (trimmedLogo) {
          const img = mg.getImage(trimmedLogo);
          const src = img?.src ?? (trimmedLogo.startsWith("http") || trimmedLogo.startsWith("/") ? trimmedLogo : "");
          if (src) updateOrganizationLogo(src);
        }
      }

      if (logo_dark !== undefined) {
        if (typeof logo_dark !== "string") {
          res.status(400).json({ error: "logo_dark must be a string" });
          return;
        }
        vm.updateBrandSetting("logo_dark", logo_dark.trim());
      }

      if (default_social_image !== undefined) {
        if (typeof default_social_image !== "string") {
          res.status(400).json({ error: "default_social_image must be a string" });
          return;
        }
        updateWebsiteDefaultSocialImage(default_social_image.trim());
      }

      if (twitter_handle !== undefined) {
        if (typeof twitter_handle !== "string") {
          res.status(400).json({ error: "twitter_handle must be a string" });
          return;
        }
        updateOrganizationTwitterHandle(twitter_handle.trim());
      }

      const SOCIAL_DOMAINS: Record<string, string> = {
        linkedin: "linkedin.com",
        facebook: "facebook.com",
        youtube: "youtube.com",
        instagram: "instagram.com",
        github: "github.com",
      };

      for (const [platform, value] of [
        ["linkedin", linkedin],
        ["facebook", facebook],
        ["youtube", youtube],
        ["instagram", instagram],
        ["github", github],
      ] as [string, unknown][]) {
        if (value !== undefined) {
          if (typeof value !== "string") {
            res.status(400).json({ error: `${platform} must be a string` });
            return;
          }
          const trimmed = value.trim();
          if (trimmed) {
            let parsed: URL;
            try {
              parsed = new URL(trimmed);
            } catch {
              res.status(400).json({ error: `${platform}: not a valid URL` });
              return;
            }
            if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
              res.status(400).json({ error: `${platform}: URL must start with https://` });
              return;
            }
            const expectedDomain = SOCIAL_DOMAINS[platform];
            if (expectedDomain && !parsed.hostname.endsWith(expectedDomain)) {
              res.status(400).json({ error: `${platform}: URL does not appear to belong to ${expectedDomain}` });
              return;
            }
          }
          updateOrganizationSameAsUrl(platform, trimmed);
        }
      }

      clearSsrSchemaCache();
      const brand = vm.getBrandSettings();
      const resolveLogoSrc = (idOrUrl: string): string => {
        const raw = idOrUrl.trim();
        if (!raw) return "";
        if (raw.startsWith("http://") || raw.startsWith("https://") || raw.startsWith("/") || raw.startsWith("data:")) {
          return raw;
        }
        return mg.getImage(raw)?.src ?? "";
      };
      const logoSrc = brand.logo ? resolveLogoSrc(brand.logo) : "";
      const logoDarkSrc = brand.logo_dark ? resolveLogoSrc(brand.logo_dark) : "";
      res.json({
        success: true,
        title: brand.title,
        logo: brand.logo,
        logo_dark: brand.logo_dark,
        logo_src: logoSrc,
        logo_dark_src: logoDarkSrc,
        default_social_image: getWebsiteDefaultSocialImage(cr) ?? "",
        twitter_handle: getOrganizationTwitterHandle(cr) ?? "",
        linkedin: getOrganizationSameAsUrl("linkedin", cr) ?? "",
        facebook: getOrganizationSameAsUrl("facebook", cr) ?? "",
        youtube: getOrganizationSameAsUrl("youtube", cr) ?? "",
        instagram: getOrganizationSameAsUrl("instagram", cr) ?? "",
        github: getOrganizationSameAsUrl("github", cr) ?? "",
      });
    } catch (err: any) {
      res.status(500).json({ error: err.message || String(err) });
    }
  });

  app.get("/api/admin/schema-org", async (req, res) => {
    const auth = await requireCapability(req, res, "seo_settings");
    if (!auth.authorized) return;
    try {
      const cr = getContentRoot(res);
      res.json(getSchemaOrgEditorPayload(cr));
    } catch (err: any) {
      res.status(500).json({ error: err.message || String(err) });
    }
  });

  app.put("/api/admin/schema-org", async (req, res) => {
    const auth = await requireCapability(req, res, "seo_settings");
    if (!auth.authorized) return;
    try {
      const cr = getContentRoot(res);
      const { organization, website } = req.body ?? {};
      const updated = updateSchemaOrgEditorPayload({ organization, website }, cr);
      markFileAsModified("schema-org.yml", undefined, undefined, cr);
      clearSsrSchemaCache();
      res.json({ success: true, ...updated });
    } catch (err: any) {
      res.status(400).json({ error: err.message || String(err) });
    }
  });

  app.get("/api/admin/schema-org/yml", async (req, res) => {
    const auth = await requireCapability(req, res, "seo_settings");
    if (!auth.authorized) return;
    try {
      const cr = getContentRoot(res);
      const file = getSchemaOrgYaml(cr);
      const relativePath = path.relative(process.cwd(), file.path) || file.path;
      res.json({
        exists: file.exists,
        path: relativePath,
        content: file.content,
      });
    } catch (err: any) {
      res.status(500).json({ error: err.message || String(err) });
    }
  });

  app.put("/api/admin/schema-org/yml", async (req, res) => {
    const auth = await requireCapability(req, res, "seo_settings");
    if (!auth.authorized) return;
    try {
      const cr = getContentRoot(res);
      const content = req.body?.content;
      if (typeof content !== "string") {
        res.status(400).json({ error: "content must be a string" });
        return;
      }
      const saved = putSchemaOrgYaml(content, cr);
      markFileAsModified("schema-org.yml", undefined, undefined, cr);
      clearSsrSchemaCache();
      const relativePath = path.relative(process.cwd(), saved.path) || saved.path;
      res.json({ success: true, path: relativePath, content: saved.content });
    } catch (err: any) {
      res.status(400).json({ error: err.message || String(err) });
    }
  });

  app.get("/api/admin/ai/tool-definitions", async (req, res) => {
    try {
      const auth = await requireAdminAuth(req, res);
      if (!auth.authorized) return;

      const { TOOL_DEFINITIONS } = await import("../ai/tools/index");
      const definitions = TOOL_DEFINITIONS.map(t => ({
        name: t.function.name,
        description: t.function.description,
        parameters: t.function.parameters,
      }));
      res.json({ tools: definitions });
    } catch (err) {
      log.error({ err: err }, "[AI Tool Definitions] Error:");
      res.status(500).json({ error: "Failed to load tool definitions" });
    }
  });

  app.get("/api/admin/ai/question-tags", async (req, res) => {
    try {
      const auth = await requireAdminAuth(req, res);
      if (!auth.authorized) return;

      const llmConfig = loadSiteLLMConfig(res);
      res.json({ question_tags: llmConfig.question_tags || [] });
    } catch (err) {
      log.error({ err: err }, "[AI Question Tags] Error:");
      res.status(500).json({ error: "Failed to load question tags" });
    }
  });

  // ============================================
  // Qdrant / semantic search status
  // ============================================

  app.get("/api/admin/qdrant/status", async (req, res) => {
    try {
      const auth = await requireAdminAuth(req, res);
      if (!auth.authorized) return;

      const { getStatus } = await import("../vector-search");
      const { getAllJobStates } = await import("../db-job-state");
      const status = await getStatus();
      const pointsByCollection = new Map(
        status.collections.map((c) => [c.name, c.points_count]),
      );
      const jobStates = getAllJobStates(getContentRoot(res));
      const dbm = getDB(res);

      const databases = dbm.list().map(({ name, config }) => {
        const vs = config.vector_search;
        const fields = Array.isArray(vs?.fields) ? vs.fields : [];
        const semanticEnabled = Boolean(vs?.enabled && fields.length > 0);
        const index = jobStates[name]?.index ?? { status: "idle" as const };
        return {
          name,
          label: config.name || name,
          semantic_enabled: semanticEnabled,
          fields,
          collection_points: pointsByCollection.has(name)
            ? (pointsByCollection.get(name) as number)
            : null,
          index,
        };
      });

      res.json({
        available: status.available,
        url: status.url,
        host: status.host,
        port: status.port,
        embedding_model: status.embedding_model,
        vector_size: status.vector_size,
        distance: status.distance,
        error: status.error,
        embedder_loaded: status.embedder_loaded,
        collections: status.collections,
        databases,
      });
    } catch (err) {
      log.error({ err }, "[Qdrant Status GET] Error:");
      res.status(500).json({ error: "Failed to load Qdrant status" });
    }
  });

  // ============================================
  // AI Admin Routes (users_manage capability required)
  // ============================================

  let openRouterModelsCache: {
    fetchedAt: number;
    models: Array<{
      id: string;
      name: string;
      context_length?: number;
      pricing?: { prompt?: string; completion?: string };
    }>;
  } | null = null;
  const OPENROUTER_MODELS_CACHE_MS = 10 * 60 * 1000;

  app.get("/api/admin/ai/settings", async (req, res) => {
    try {
      const auth = await requireAdminAuth(req, res);
      if (!auth.authorized) return;

      const llmConfig = loadSiteLLMConfig(res);
      const provider =
        typeof llmConfig.provider === "object" && llmConfig.provider !== null
          ? (llmConfig.provider as Record<string, string>)
          : {};
      const apiKeyEnv = provider.api_key_env || "OPENROUTER_API_KEY";
      const baseUrlEnv = provider.base_url_env || "OPENROUTER_BASE_URL";

      const { resolveLLMApiKey, resolveLLMBaseURL } = await import("../ai/LLMService");
      const modelObj =
        typeof llmConfig.model === "object" && llmConfig.model !== null
          ? (llmConfig.model as Record<string, string>)
          : null;
      const modelDefault = modelObj
        ? modelObj.default || ""
        : typeof llmConfig.model === "string"
          ? llmConfig.model
          : "";

      res.json({
        model_default: modelDefault,
        model_chat: modelObj?.chat || "",
        model_vision: modelObj?.vision || "",
        provider: {
          api_key_env: apiKeyEnv,
          base_url_env: baseUrlEnv,
          base_url: resolveLLMBaseURL(baseUrlEnv) || null,
          api_key_configured: Boolean(resolveLLMApiKey(apiKeyEnv)),
        },
      });
    } catch (err) {
      log.error({ err }, "[AI Settings GET] Error:");
      res.status(500).json({ error: "Failed to load AI settings" });
    }
  });

  app.patch("/api/admin/ai/settings", async (req, res) => {
    try {
      const auth = await requireAdminAuth(req, res);
      if (!auth.authorized) return;

      const {
        model_default: modelDefault,
        model_chat: modelChat,
        model_vision: modelVision,
      } = req.body || {};

      if (modelDefault !== undefined && (typeof modelDefault !== "string" || !modelDefault.trim())) {
        return res.status(400).json({ error: "model_default cannot be empty" });
      }
      if (modelChat !== undefined && typeof modelChat !== "string") {
        return res.status(400).json({ error: "model_chat must be a string" });
      }
      if (modelVision !== undefined && typeof modelVision !== "string") {
        return res.status(400).json({ error: "model_vision must be a string" });
      }
      if (modelDefault === undefined && modelChat === undefined && modelVision === undefined) {
        return res.status(400).json({ error: "At least one of model_default, model_chat, model_vision is required" });
      }

      const llmPath = path.join(getContentRoot(res), "llm.yml");
      const llmConfig = loadSiteLLMConfig(res);
      const mutableConfig: Record<string, unknown> = { ...llmConfig };
      const existing =
        typeof mutableConfig.model === "object" && mutableConfig.model !== null
          ? (mutableConfig.model as Record<string, string>)
          : { default: typeof mutableConfig.model === "string" ? mutableConfig.model : "" };
      const modelObj: Record<string, string> = { ...existing };
      if (typeof modelDefault === "string") modelObj.default = modelDefault.trim();
      if (typeof modelChat === "string") {
        const trimmed = modelChat.trim();
        if (trimmed) modelObj.chat = trimmed;
        else delete modelObj.chat;
      }
      if (typeof modelVision === "string") {
        const trimmed = modelVision.trim();
        if (trimmed) modelObj.vision = trimmed;
        else delete modelObj.vision;
      }
      mutableConfig.model = modelObj;

      fs.writeFileSync(llmPath, yaml.dump(mutableConfig, { lineWidth: -1 }), "utf-8");

      try {
        markFileAsModified(llmPath, undefined, undefined, getContentRoot(res));
      } catch (markErr) {
        log.warn({ err: markErr }, "[AI Settings PATCH] Could not mark llm.yml modified (non-fatal)");
      }

      try {
        const { reloadLLMConfig } = await import("../ai/LLMService");
        reloadLLMConfig();
      } catch (reloadErr) {
        log.warn({ err: reloadErr }, "[AI Settings PATCH] LLM reload failed (non-fatal)");
      }

      try {
        const { getAgentService } = await import("../ai/AgentService");
        getAgentService().reload();
      } catch (reloadErr) {
        log.warn({ err: reloadErr }, "[AI Settings PATCH] Agent reload failed (non-fatal)");
      }

      res.json({
        success: true,
        model_default: modelObj.default || "",
        model_chat: modelObj.chat || "",
        model_vision: modelObj.vision || "",
      });
    } catch (err) {
      log.error({ err }, "[AI Settings PATCH] Error:");
      res.status(500).json({ error: "Failed to update AI settings" });
    }
  });

  app.get("/api/admin/ai/openrouter/models", async (req, res) => {
    try {
      const auth = await requireAdminAuth(req, res);
      if (!auth.authorized) return;

      if (
        openRouterModelsCache &&
        Date.now() - openRouterModelsCache.fetchedAt < OPENROUTER_MODELS_CACHE_MS
      ) {
        return res.json({ models: openRouterModelsCache.models });
      }

      const llmConfig = loadSiteLLMConfig(res);
      const provider =
        typeof llmConfig.provider === "object" && llmConfig.provider !== null
          ? (llmConfig.provider as Record<string, string>)
          : {};
      const apiKeyEnv = provider.api_key_env || "OPENROUTER_API_KEY";
      const baseUrlEnv = provider.base_url_env || "OPENROUTER_BASE_URL";

      const { resolveLLMApiKey, resolveLLMBaseURL } = await import("../ai/LLMService");
      const apiKey = resolveLLMApiKey(apiKeyEnv);
      const baseURL = resolveLLMBaseURL(baseUrlEnv) || "https://openrouter.ai/api/v1";

      if (!apiKey) {
        return res.status(503).json({
          error: `API key not configured. Set ${apiKeyEnv} in environment.`,
          models: [],
        });
      }

      const modelsUrl = `${baseURL.replace(/\/$/, "")}/models`;
      const orRes = await fetch(modelsUrl, {
        headers: {
          Authorization: `Bearer ${apiKey}`,
          Accept: "application/json",
        },
      });

      if (!orRes.ok) {
        const body = await orRes.text().catch(() => "");
        log.error({ status: orRes.status, body: body.slice(0, 500) }, "[OpenRouter models] fetch failed");
        return res.status(502).json({ error: `OpenRouter models request failed (${orRes.status})`, models: [] });
      }

      const payload = (await orRes.json()) as {
        data?: Array<{
          id?: string;
          name?: string;
          context_length?: number;
          architecture?: { output_modalities?: string[] };
          pricing?: { prompt?: string; completion?: string };
        }>;
      };

      const models = (payload.data || [])
        .filter((m) => {
          if (!m.id) return false;
          const outputs = m.architecture?.output_modalities;
          if (!outputs || outputs.length === 0) return true;
          return outputs.includes("text");
        })
        .map((m) => ({
          id: m.id as string,
          name: m.name || (m.id as string),
          context_length: typeof m.context_length === "number" ? m.context_length : undefined,
          pricing:
            m.pricing && (m.pricing.prompt != null || m.pricing.completion != null)
              ? {
                  prompt: m.pricing.prompt,
                  completion: m.pricing.completion,
                }
              : undefined,
        }))
        .sort((a, b) => a.id.localeCompare(b.id));

      openRouterModelsCache = { fetchedAt: Date.now(), models };
      res.json({ models });
    } catch (err) {
      log.error({ err }, "[OpenRouter models] Error:");
      res.status(500).json({ error: "Failed to fetch OpenRouter models", models: [] });
    }
  });

  app.get("/api/admin/ai/llm-yml", async (req, res) => {
    try {
      const auth = await requireAdminAuth(req, res);
      if (!auth.authorized) return;

      const contentRoot = getContentRoot(res);
      const contentFolder = getContentRootName(res);
      const llmPath = path.join(contentRoot, "llm.yml");
      const relativePath = `${contentFolder}/llm.yml`;

      if (!fs.existsSync(llmPath)) {
        return res.json({ exists: false, path: relativePath, content: "", error: "llm.yml not found" });
      }

      res.json({
        exists: true,
        path: relativePath,
        content: fs.readFileSync(llmPath, "utf-8"),
      });
    } catch (err) {
      log.error({ err }, "[AI llm.yml GET] Error:");
      res.status(500).json({ error: "Failed to read llm.yml" });
    }
  });

  app.put("/api/admin/ai/llm-yml", async (req, res) => {
    try {
      const auth = await requireAdminAuth(req, res);
      if (!auth.authorized) return;

      const { content, author: requestAuthor } = req.body || {};
      if (typeof content !== "string") {
        return res.status(400).json({ error: "content is required" });
      }

      let parsed: unknown;
      try {
        parsed = safeYamlLoad(content);
      } catch (parseErr) {
        return res.status(400).json({
          error: parseErr instanceof Error ? parseErr.message : "Invalid YAML",
        });
      }
      if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
        return res.status(400).json({ error: "llm.yml must be a YAML object" });
      }

      const contentRoot = getContentRoot(res);
      const contentFolder = getContentRootName(res);
      const llmPath = path.join(contentRoot, "llm.yml");
      fs.writeFileSync(llmPath, content, "utf-8");

      const authorName =
        typeof requestAuthor === "string" && requestAuthor.trim() ? requestAuthor.trim() : undefined;
      try {
        markFileAsModified(llmPath, authorName, undefined, contentRoot);
      } catch (markErr) {
        log.warn({ err: markErr }, "[AI llm.yml PUT] Could not mark llm.yml modified (non-fatal)");
      }

      try {
        const { reloadLLMConfig } = await import("../ai/LLMService");
        reloadLLMConfig();
      } catch (reloadErr) {
        log.warn({ err: reloadErr }, "[AI llm.yml PUT] LLM reload failed (non-fatal)");
      }

      try {
        const { getAgentService } = await import("../ai/AgentService");
        getAgentService().reload();
      } catch (reloadErr) {
        log.warn({ err: reloadErr }, "[AI llm.yml PUT] Agent reload failed (non-fatal)");
      }

      res.json({ success: true, path: `${contentFolder}/llm.yml` });
    } catch (err) {
      log.error({ err }, "[AI llm.yml PUT] Error:");
      res.status(500).json({ error: err instanceof Error ? err.message : "Failed to save llm.yml" });
    }
  });

  app.get("/api/admin/ai/knowledge", async (req, res) => {
    try {
      const auth = await requireAdminAuth(req, res);
      if (!auth.authorized) return;

      const conversationStore = await getConversationStore(res);
      const knowledge = await conversationStore.getAllKnowledge();

      const llmConfig = loadSiteLLMConfig(res);

      const modelDefault = typeof llmConfig.model === "object" ? (llmConfig.model as Record<string, string>)?.default || "" : (llmConfig.model as string) || "";
      const modelChat = typeof llmConfig.model === "object" ? llmConfig.model?.chat || "" : "";

      res.json({
        system_prompt: knowledge.system_prompt || null,
        prompt_role: knowledge.prompt_role || llmConfig.prompt_role || "",
        prompt_personality: knowledge.prompt_personality || llmConfig.prompt_personality || "",
        prompt_instructions: knowledge.prompt_instructions || llmConfig.prompt_instructions || "",
        prompt_fallback: knowledge.prompt_fallback || llmConfig.prompt_fallback || "",
        custom_knowledge: knowledge.custom_knowledge || [],
        pinned_qa: knowledge.pinned_qa || [],
        agent_tools: llmConfig.agent_tools || [],
        chat_bubble: llmConfig.chat_bubble || {},
        question_tags: llmConfig.question_tags || [],
        empty_conversation_grace_minutes: llmConfig.empty_conversation_grace_minutes ?? 15,
        model_default: modelDefault,
        model_chat: modelChat,
      });
    } catch (err) {
      log.error({ err: err }, "[AI Knowledge GET] Error:");
      res.status(500).json({ error: "Failed to load knowledge" });
    }
  });

  app.post("/api/admin/ai/knowledge", async (req, res) => {
    try {
      const auth = await requireAdminAuth(req, res);
      if (!auth.authorized) return;

      const conversationStore = await getConversationStore(res);
      const { key, value, updated_by } = req.body || {};

      if (!key || value === undefined) {
        return res.status(400).json({ error: "key and value are required" });
      }

      await conversationStore.setKnowledge(key, value, updated_by);
      res.json({ success: true });
    } catch (err) {
      log.error({ err: err }, "[AI Knowledge POST] Error:");
      res.status(500).json({ error: "Failed to save knowledge" });
    }
  });

  app.patch("/api/admin/ai/knowledge", async (req, res) => {
    try {
      const auth = await requireAdminAuth(req, res);
      if (!auth.authorized) return;

      const conversationStore = await getConversationStore(res);
      const updates = req.body || {};
      const llmConfigKeys = new Set([
        "updated_by",
        "agent_tools",
        "chat_bubble",
        "empty_conversation_grace_minutes",
        "model_default",
        "model_chat",
      ]);

      for (const [key, value] of Object.entries(updates)) {
        if (llmConfigKeys.has(key)) continue;
        await conversationStore.setKnowledge(key, value, updates.updated_by);
      }

      if (updates.empty_conversation_grace_minutes !== undefined) {
        const raw = Number(updates.empty_conversation_grace_minutes);
        if (!Number.isFinite(raw) || !Number.isInteger(raw) || raw < 1) {
          return res.status(400).json({ error: "empty_conversation_grace_minutes must be a positive integer" });
        }
        updates.empty_conversation_grace_minutes = raw;
      }

      const hasLlmUpdates = updates.agent_tools || updates.chat_bubble || updates.empty_conversation_grace_minutes !== undefined || updates.model_default !== undefined || updates.model_chat !== undefined;
      if (hasLlmUpdates) {
        const llmPath = path.join(getContentRoot(res), "llm.yml");
        const llmConfig = loadSiteLLMConfig(res);
        const mutableConfig: Record<string, unknown> = { ...llmConfig };
        if (updates.agent_tools) mutableConfig.agent_tools = updates.agent_tools;
        if (updates.chat_bubble) {
          const existingBubble =
            typeof mutableConfig.chat_bubble === "object" && mutableConfig.chat_bubble !== null
              ? (mutableConfig.chat_bubble as Record<string, unknown>)
              : {};
          mutableConfig.chat_bubble = { ...existingBubble, ...(updates.chat_bubble as Record<string, unknown>) };
        }
        if (updates.empty_conversation_grace_minutes !== undefined) mutableConfig.empty_conversation_grace_minutes = updates.empty_conversation_grace_minutes;
        if (updates.model_default !== undefined || updates.model_chat !== undefined) {
          const existing = typeof mutableConfig.model === "object" && mutableConfig.model !== null
            ? mutableConfig.model as Record<string, string>
            : { default: typeof mutableConfig.model === "string" ? mutableConfig.model : "" };
          const modelObj: Record<string, string> = { ...existing };
          if (updates.model_default !== undefined) modelObj.default = updates.model_default;
          if (updates.model_chat !== undefined) modelObj.chat = updates.model_chat;
          if (!modelObj.chat) delete modelObj.chat;
          mutableConfig.model = modelObj;
        }
        fs.writeFileSync(llmPath, yaml.dump(mutableConfig, { lineWidth: -1 }), "utf-8");

        try {
          const { markFileAsModified } = await import("../sync-state");
          markFileAsModified(llmPath, undefined, undefined, getContentRoot(res));
        } catch (markErr) {
          log.warn({ err: markErr }, "[AI Knowledge PATCH] Could not mark llm.yml modified (non-fatal)");
        }

        try {
          const { getAgentService } = await import("../ai/AgentService");
          getAgentService().reload();
        } catch (reloadErr) {
          log.warn({ err: reloadErr }, "[AI Knowledge PATCH] Agent reload failed (non-fatal)");
        }
      }

      res.json({ success: true });
    } catch (err) {
      log.error({ err: err }, "[AI Knowledge PATCH] Error:");
      res.status(500).json({ error: "Failed to update knowledge" });
    }
  });

  app.get("/api/admin/ai/conversations", async (req, res) => {
    try {
      const auth = await requireAdminAuth(req, res);
      if (!auth.authorized) return;

      const conversationStore = await getConversationStore(res);
      const filters = {
        page: Number(req.query.page) || 1,
        limit: Number(req.query.limit) || 20,
        dateFrom: req.query.dateFrom as string | undefined,
        dateTo: req.query.dateTo as string | undefined,
        pageUrl: req.query.pageUrl as string | undefined,
        featureTag: req.query.featureTag as string | undefined,
        questionTag: req.query.questionTag as string | undefined,
        rating: req.query.rating as string | undefined,
      };

      const result = await conversationStore.listConversations(filters);
      res.json(result);
    } catch (err) {
      log.error({ err: err }, "[AI Conversations GET] Error:");
      res.status(500).json({ error: "Failed to load conversations" });
    }
  });

  app.patch("/api/admin/ai/conversations/:id/messages/:msgId", async (req, res) => {
    try {
      const auth = await requireAdminAuth(req, res);
      if (!auth.authorized) return;

      let raterName = "admin";
      if (auth.token) {
        try {
          const meResponse = await fetch(
            `${BREATHECODE_HOST}/v1/auth/user/me`,
            { method: "GET", headers: { Authorization: `Token ${auth.token}` } }
          );
          if (meResponse.ok) {
            const meData = await meResponse.json() as Record<string, string>;
            raterName = meData.first_name || meData.email || "admin";
          }
        } catch {}
      }

      const conversationStore = await getConversationStore(res);
      const { rating, override_content } = req.body || {};

      let msg = null;
      if (rating) {
        msg = await conversationStore.rateMessage(req.params.msgId, rating, raterName);
      }
      if (override_content !== undefined) {
        msg = await conversationStore.overrideMessage(req.params.msgId, override_content, raterName);
      }

      if (!msg) {
        return res.status(404).json({ error: "Message not found" });
      }

      res.json(msg);
    } catch (err) {
      log.error({ err: err }, "[AI Message PATCH] Error:");
      res.status(500).json({ error: "Failed to update message" });
    }
  });

  app.post("/api/admin/ai/conversations/cluster", async (req, res) => {
    try {
      const auth = await requireAdminAuth(req, res);
      if (!auth.authorized) return;

      const { getAgentService } = await import("../ai/AgentService");
      const conversationStore = await getConversationStore(res);

      const recentMessages = await conversationStore.getRecentUserMessages(200);

      const llmConfig = loadSiteLLMConfig(res);
      const tags = llmConfig.question_tags || [];

      const agent = getAgentService();
      const clusters = await agent.clusterQuestions(recentMessages, tags);

      res.json({ clusters, total_questions: recentMessages.length });
    } catch (err) {
      log.error({ err: err }, "[AI Cluster] Error:");
      res.status(500).json({ error: "Failed to cluster questions" });
    }
  });

  app.post("/api/admin/ai/knowledge/preview", async (req, res) => {
    try {
      const auth = await requireAdminAuth(req, res);
      if (!auth.authorized) return;

      const { getAgentService } = await import("../ai/AgentService");
      const { contentCompiler } = await import("../ai/ContentCompiler");

      const { question, url, content_type, content_slug, locale } = req.body || {};

      if (!question) {
        return res.status(400).json({ error: "question is required" });
      }

      let derivedContentType = content_type || null;
      let derivedContentSlug = content_slug || null;
      let derivedLocale = locale || "en";

      if (url && !content_type && !content_slug) {
        const programEnMatch = (url as string).match(/\/en\/career-programs\/([^/?#]+)/);
        const programEsMatch = (url as string).match(/\/es\/programas-de-carrera\/([^/?#]+)/);
        const locationEnMatch = (url as string).match(/\/en\/location\/([^/?#]+)/);
        const locationEsMatch = (url as string).match(/\/es\/ubicacion\/([^/?#]+)/);
        const localeMatch = (url as string).match(/\/(en|es)\//);

        if (programEnMatch) { derivedContentType = "program"; derivedContentSlug = programEnMatch[1]; derivedLocale = "en"; }
        else if (programEsMatch) { derivedContentType = "program"; derivedContentSlug = programEsMatch[1]; derivedLocale = "es"; }
        else if (locationEnMatch) { derivedContentType = "location"; derivedContentSlug = locationEnMatch[1]; derivedLocale = "en"; }
        else if (locationEsMatch) { derivedContentType = "location"; derivedContentSlug = locationEsMatch[1]; derivedLocale = "es"; }
        else if (localeMatch) { derivedLocale = localeMatch[1]; }
      }

      const compiled = contentCompiler.compile(derivedContentType, derivedContentSlug, derivedLocale);

      const agent = getAgentService();
      const response = await agent.processMessage(
        "preview-" + Date.now(),
        question,
        derivedContentType,
        derivedContentSlug,
        derivedLocale
      );

      res.json({
        context: compiled,
        response: response.content,
        question_tag: response.questionTag,
      });
    } catch (err) {
      log.error({ err: err }, "[AI Preview] Error:");
      res.status(500).json({ error: "Failed to generate preview" });
    }
  });

  // ============================================================
  // Component Co-occurrence & Ordering Insights
  // ============================================================
  app.post("/api/private/component-insights/rebuild", async (req, res) => {
    const auth = await requireMutatingStaff(req, res);
    if (!auth.authorized) return;
    try {
      const data = await requestInsightsRebuild();
      res.json(data);
    } catch (err) {
      log.error({ err: err }, "[ComponentInsights] Rebuild failed:");
      res.status(500).json({ error: "Rebuild failed", details: err instanceof Error ? err.message : String(err) });
    }
  });

  app.get("/api/private/component-insights/status", async (req, res) => {
    const auth = await requireCapability(req, res, "metrics_view");
    if (!auth.authorized) return;
    try {
      res.json(getInsightsStatus());
    } catch (err) {
      res.status(500).json({ error: "Failed to read insights status", details: err instanceof Error ? err.message : String(err) });
    }
  });

  app.get("/api/private/component-insights/summary/:type", async (req, res) => {
    const auth = await requireCapability(req, res, "metrics_view");
    if (!auth.authorized) return;
    try {
      const summary = getUsageSummary(req.params.type);
      res.json(summary);
    } catch (err) {
      res.status(500).json({ error: "Failed to get usage summary", details: err instanceof Error ? err.message : String(err) });
    }
  });

  app.get("/api/private/component-insights", async (req, res) => {
    const auth = await requireCapability(req, res, "metrics_view");
    if (!auth.authorized) return;
    try {
      // Status getter kicks a lazy rebuild when cache is missing/outdated.
      const st = getInsightsStatus();
      const data = readInsightsFile();
      if (!data) {
        return res.status(404).json({
          error: "Insights not yet generated or cache format is outdated. Rebuild started.",
          rebuilding: true,
          status: st,
        });
      }
      res.json(data);
    } catch (err) {
      res.status(500).json({ error: "Failed to read insights", details: err instanceof Error ? err.message : String(err) });
    }
  });

  app.get("/api/private/component-insights/suggest", async (req, res) => {
    const auth = await requireCapability(req, res, "metrics_view");
    if (!auth.authorized) return;
    try {
      const after = typeof req.query.after === "string" ? req.query.after : "";
      const intent = typeof req.query.intent === "string" && req.query.intent !== "__global__" ? req.query.intent : undefined;
      const rankBy = req.query.rankBy === "pmi" ? "pmi" : "frequency";

      if (!after) {
        // No preceding section — derive starting suggestions from topSequences
        const data = readInsightsFile();
        if (!data) return res.json([]);

        const FALLBACK_MIN = 3;
        const cluster =
          intent && data.byIntent[intent] && data.byIntent[intent].pageCount >= FALLBACK_MIN
            ? data.byIntent[intent]
            : data.global;

        const startCountMap = new Map<string, number>();
        for (const seq of cluster.topSequences) {
          if (seq.sequence.length > 0) {
            const first = seq.sequence[0];
            startCountMap.set(first, (startCountMap.get(first) ?? 0) + seq.count);
          }
        }

        const total = Array.from(startCountMap.values()).reduce((s, v) => s + v, 0) || 1;
        const results = Array.from(startCountMap.entries())
          .sort((a, b) => b[1] - a[1])
          .slice(0, 8)
          .map(([type, count]) => ({
            from: "__start__",
            to: type,
            count,
            frequency: Math.round((count / total) * 1000) / 1000,
            pmi: 0,
            distance: 1,
          }));

        return res.json(results);
      }

      const suggestions = suggestNextComponent(after, intent, rankBy);
      res.json(suggestions);
    } catch (err) {
      res.status(500).json({ error: "Failed to get suggestions", details: err instanceof Error ? err.message : String(err) });
    }
  });

  app.get("/api/private/component-insights/component/:type", async (req, res) => {
    const auth = await requireCapability(req, res, "metrics_view");
    if (!auth.authorized) return;
    try {
      const componentType = req.params.type;
      const intent = typeof req.query.intent === "string" && req.query.intent ? req.query.intent : undefined;
      const contentType = typeof req.query.contentType === "string" && req.query.contentType ? req.query.contentType : undefined;

      if (!intent && !contentType) {
        const data = readInsightsFile() ?? runComponentInsightsScan();
        const configs = getAllConfigs();
        const availableContentTypes = Object.entries(configs)
          .filter(([, cfg]) => !(cfg as Record<string, unknown>).database)
          .map(([ct]) => ct);
        return res.status(400).json({
          error: "Either 'intent' or 'contentType' query param is required for scoped results.",
          availableIntents: data.meta.intents,
          availableContentTypes,
        });
      }

      const result = getComponentUsageData(componentType, { intent, contentType });
      res.json(result);
    } catch (err) {
      log.error({ err: err }, "[ComponentInsights] Component usage failed:");
      res.status(500).json({ error: "Failed to get component usage", details: err instanceof Error ? err.message : String(err) });
    }
  });

  app.use(async (req, res, next) => {
    const url = req.originalUrl || req.url;
    if (
      url.startsWith("/api/") ||
      url.startsWith("/attached_assets/") ||
      (() => { try { const { getSiteContextMap } = require("../site-manager") as typeof import("../site-manager"); return [...getSiteContextMap().values()].some(s => url.startsWith(`/${s.contentRootName}/`)); } catch { return url.startsWith(`/${getDefaultContentFolder()}/`); } })() ||
      /\.\w+$/.test(url)
    ) {
      return next();
    }

    let schemaHtml = "";

    const cleanUrl = url.split("?")[0].split("#")[0];
    const resolved = getCI(res).resolveUrl(cleanUrl);
    const isDatabaseRoute = resolved && resolved.fromDatabase;
    const listingResolved = !isDatabaseRoute
      ? getCI(res).resolveListingUrl(cleanUrl)
      : null;
    const isListingRoute = !!listingResolved;

    let robotsDirective = "index, follow";

    // Detect blog post URLs even when content-index can't resolve them (e.g. object-type category field)
    const blogUrlMatch = !isDatabaseRoute
      ? cleanUrl.match(/^\/(en|es)\/blog\/[^/]+\/([^/?#]+)$/)
      : null;

    if (isDatabaseRoute && resolved) {
      try {
        const locale =
          resolved.patternLocale && resolved.patternLocale !== "default"
            ? resolved.patternLocale
            : getDefaultLocale();
        // Fetch only the single entry needed for JSON-LD — not the whole content type.
        const { items: posts } = await queryEntries(
          {
            from: { contentType: resolved.contentType },
            locale,
            filters: [{ field: "slug", value: resolved.slug }],
            limit: 5,
          },
          {
            db: getDB(res),
            contentIndex: getCI(res),
            contentRoot: getContentRoot(res),
          },
        );
        const localeKey = getLocaleKey(resolved.contentType) || "lang";
        const post =
          posts.find(
            (p) => p.slug === resolved.slug && (p as any)[localeKey] === locale,
          ) || posts.find((p) => p.slug === resolved.slug);
        if (post) {
          schemaHtml = await generateDatabaseSsrHtml(
            resolved.contentType,
            post,
            locale,
            getCI(res),
            getContentRoot(res),
          );
          if (typeof (post as any).robots === "string") {
            robotsDirective = (post as any).robots;
          }
        }
      } catch (err) {
        log.error("[SSR-DB] Error generating schema for", url, err);
      }
    } else if (isListingRoute && listingResolved) {
      schemaHtml = generateListingSsrHtml(
        listingResolved.contentType,
        listingResolved.locale,
        getContentRoot(res),
      );
    } else if (blogUrlMatch) {
      try {
        const locale = blogUrlMatch[1];
        const slug = blogUrlMatch[2];
        const { items: posts } = await queryEntries(
          {
            from: { contentType: "blog" },
            locale,
            filters: [{ field: "slug", value: slug }],
            limit: 5,
          },
          {
            db: getDB(res),
            contentIndex: getCI(res),
            contentRoot: getContentRoot(res),
          },
        );
        const localeKey = getLocaleKey("blog") || "lang";
        const post =
          posts.find((p) => p.slug === slug && (p as any)[localeKey] === locale) ||
          posts.find((p) => p.slug === slug);
        if (post) {
          schemaHtml = await generateDatabaseSsrHtml("blog", post, locale, getCI(res), getContentRoot(res));
          if (typeof (post as any).robots === "string") {
            robotsDirective = (post as any).robots;
          }
        }
      } catch (err) {
        log.error("[SSR-Blog] Error generating schema for", url, err);
      }
    } else {
      schemaHtml = await generateSsrSchemaHtml(url, getCI(res), getContentRoot(res));
      robotsDirective = resolvePageRobots(url, getCI(res), getContentRoot(res));
    }

    robotsDirective = resolveEffectiveRobots(robotsDirective, getContentRoot(res));
    res.setHeader("X-Robots-Tag", robotsDirective);

    const isBlogRoute = isDatabaseRoute || isListingRoute || !!blogUrlMatch;
    if (!schemaHtml && !isBlogRoute) {
      return next();
    }

    if (schemaHtml) {
      req.ssrSchemaHtml = schemaHtml;
    }

    if (isBlogRoute) {
      const originalEnd = res.end.bind(res);
      res.end = function (chunk?: any, ...args: any[]) {
        const contentType = res.getHeader("content-type");
        if (
          contentType &&
          typeof contentType === "string" &&
          contentType.includes("text/html") &&
          res.statusCode === 404
        ) {
          res.statusCode = 200;
        }
        return originalEnd(chunk, ...args);
      } as typeof res.end;
    }

    next();
  });


  // ─── Admin: Roles & Users API ─────────────────────────────────────────────
  async function requireAdminAuth(
    req: Request,
    res: Response
  ): Promise<{ authorized: boolean; token?: string }> {
    const result = await requireCapability(req, res, "users_manage");
    return { authorized: result.authorized, token: result.token ?? undefined };
  }

  // ─── Admin: Roles API ────────────────────────────────────────────────────────

  app.get("/api/admin/roles", async (req, res) => {
    const auth = await requireCapability(req, res, "users_manage");
    if (!auth.authorized) return;
    res.json({
      roles: userStore.getAllRoles(),
      builtInDescriptionOverrides: userStore.getBuiltInDescriptionOverrides(),
    });
  });

  app.patch("/api/admin/roles/:roleId/builtin-description", async (req, res) => {
    try {
      const auth = await requireCapability(req, res, "users_manage");
      if (!auth.authorized) return;
      const { roleId } = req.params;
      if (!userStore.isBuiltInRole(roleId)) {
        res.status(400).json({ error: `Role "${roleId}" is not a built-in role` });
        return;
      }

      const reset = req.body?.reset === true;
      if (reset) {
        const result = userStore.clearBuiltInRoleDescription(roleId);
        if (!result.ok) {
          res.status(400).json({ error: result.error });
          return;
        }
        const codeDef = userStore.getBuiltInRoleCodeDefinition(roleId);
        res.json({
          ok: true,
          description: codeDef?.description ?? "",
          builtInDescriptionOverrides: userStore.getBuiltInDescriptionOverrides(),
        });
        return;
      }

      const description = typeof req.body?.description === "string" ? req.body.description : "";
      const result = userStore.setBuiltInRoleDescription(roleId, description);
      if (!result.ok) {
        res.status(400).json({ error: result.error });
        return;
      }
      res.json({
        ok: true,
        description: description.trim(),
        builtInDescriptionOverrides: userStore.getBuiltInDescriptionOverrides(),
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to update built-in role description";
      log.error({ err, method: req.method, url: req.originalUrl }, "Failed to update built-in role description");
      res.status(500).json({ error: message });
    }
  });

  function validateRoleCapabilities(
    capabilities: unknown,
    res: Response,
  ): { ok: boolean; error?: string; valid?: import("../user-store").CapabilityGrant[] } {
    if (!Array.isArray(capabilities)) {
      return { ok: false, error: "capabilities must be an array" };
    }
    const knownContentTypes = getCI(res).getContentTypes();
    const valid: import("../user-store").CapabilityGrant[] = [];
    for (const cap of capabilities) {
      if (!cap || typeof cap.name !== "string") {
        return { ok: false, error: "Each capability must have a 'name' string field" };
      }
      if (!userStore.ALL_CAPABILITIES.includes(cap.name as import("../user-store").CapabilityName)) {
        return { ok: false, error: `Unknown capability: ${cap.name}` };
      }
      // Validate contentTypes if provided (must be "*", undefined, or an array of known content type IDs)
      const ct = cap.contentTypes;
      if (ct !== undefined && ct !== "*") {
        if (!Array.isArray(ct)) {
          return { ok: false, error: `contentTypes for '${cap.name}' must be "*" or an array of content type IDs` };
        }
        if (knownContentTypes.length > 0) {
          const unknownTypes = ct.filter((t: unknown) => typeof t === "string" && !knownContentTypes.includes(t));
          if (unknownTypes.length > 0) {
            return { ok: false, error: `Unknown content type(s) in '${cap.name}': ${unknownTypes.join(", ")}` };
          }
        }
      }
      valid.push({ name: cap.name as import("../user-store").CapabilityName, contentTypes: ct ?? undefined });
    }
    return { ok: true, valid };
  }

  app.post("/api/admin/roles", async (req, res) => {
    try {
      const auth = await requireCapability(req, res, "users_manage");
      if (!auth.authorized) return;
      const { id, label, description, capabilities } = req.body;
      if (!id || !label || !Array.isArray(capabilities)) {
        res.status(400).json({ error: "Missing required fields: id, label, capabilities" });
        return;
      }
      if (!/^[a-z][a-z0-9_-]*$/.test(id)) {
        res.status(400).json({ error: "Role id must be lowercase letters, numbers, hyphens, or underscores" });
        return;
      }
      if (userStore.getRole(id)) {
        res.status(400).json({ error: `Role id "${id}" is already taken` });
        return;
      }
      const desc = typeof description === "string" ? description.trim() : "";
      if (!desc) {
        res.status(400).json({
          error:
            "Description for AI agents is required. Agents use it to choose which MCP connector (/mcp/role/…) to use and what they should do.",
        });
        return;
      }
      const capCheck = validateRoleCapabilities(capabilities, res);
      if (!capCheck.ok) {
        res.status(400).json({ error: capCheck.error });
        return;
      }
      userStore.setRole(id, { label, description: desc, capabilities: capCheck.valid! });
      res.json({ ok: true });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to create role";
      log.error({ err, method: req.method, url: req.originalUrl }, "Failed to create role");
      res.status(500).json({ error: message });
    }
  });

  app.put("/api/admin/roles/:roleId", async (req, res) => {
    try {
      const auth = await requireCapability(req, res, "users_manage");
      if (!auth.authorized) return;
      const { roleId } = req.params;
      if (userStore.isBuiltInRole(roleId)) {
        res.status(400).json({
          error: `The built-in ${roleId} role is managed in code and cannot be updated from the admin UI.`,
        });
        return;
      }
      const { label, description, capabilities } = req.body;
      if (!label || !Array.isArray(capabilities)) {
        res.status(400).json({ error: "Missing required fields: label, capabilities" });
        return;
      }
      const desc = typeof description === "string" ? description.trim() : "";
      if (!desc) {
        res.status(400).json({
          error:
            "Description for AI agents is required. Agents use it to choose which MCP connector (/mcp/role/…) to use and what they should do.",
        });
        return;
      }
      const capCheck = validateRoleCapabilities(capabilities, res);
      if (!capCheck.ok) {
        res.status(400).json({ error: capCheck.error });
        return;
      }
      // create-or-update semantics: PUT creates if not exists, updates if exists
      userStore.setRole(roleId, { label, description: desc, capabilities: capCheck.valid! });
      res.json({ ok: true });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to update role";
      log.error({ err, method: req.method, url: req.originalUrl }, "Failed to update role");
      res.status(500).json({ error: message });
    }
  });

  app.delete("/api/admin/roles/:roleId", async (req, res) => {
    const auth = await requireCapability(req, res, "users_manage");
    if (!auth.authorized) return;
    const result = userStore.deleteRole(req.params.roleId);
    if (!result.ok) {
      res.status(400).json({ error: result.error });
      return;
    }
    res.json({ ok: true });
  });

  // ─── Admin: Users API ────────────────────────────────────────────────────────

  app.get("/api/admin/users", async (req, res) => {
    const auth = await requireCapability(req, res, "users_manage");
    if (!auth.authorized) return;
    res.json(userStore.getAllUsers());
  });

  app.put("/api/admin/users/:username/roles", async (req, res) => {
    const auth = await requireCapability(req, res, "users_manage");
    if (!auth.authorized) return;
    const { username } = req.params;
    const { roles } = req.body;
    if (!Array.isArray(roles)) {
      res.status(400).json({ error: "roles must be an array of role ids" });
      return;
    }
    const allRoles = userStore.getAllRoles();
    const invalid = roles.filter((r: string) => !allRoles[r]);
    if (invalid.length > 0) {
      res.status(400).json({ error: `Unknown role(s): ${invalid.join(", ")}` });
      return;
    }
    userStore.assignRoles(username, roles);
    res.json({ ok: true });
  });

  app.patch("/api/admin/users/:username", async (req, res) => {
    const auth = await requireCapability(req, res, "users_manage");
    if (!auth.authorized) return;
    const { username } = req.params;
    const { username: newUsername } = req.body;
    if (!newUsername || typeof newUsername !== "string" || !newUsername.trim()) {
      res.status(400).json({ error: "username is required" });
      return;
    }
    const trimmed = newUsername.trim();
    if (trimmed === username) {
      res.status(400).json({ error: "New username is the same as the current username" });
      return;
    }
    if (auth.username && auth.username === username) {
      res.status(403).json({ error: "You cannot rename your own account" });
      return;
    }
    const result = userStore.renameUser(username, trimmed);
    if (!result.ok) {
      res.status(409).json({ error: result.error });
      return;
    }
    res.json({ ok: true });
  });

  /** MCP-only read/write access overlay (does not change CMS roles). */
  app.put("/api/admin/users/:username/mcp-access", async (req, res) => {
    const auth = await requireCapability(req, res, "users_manage");
    if (!auth.authorized) return;
    const { username } = req.params;
    const { mcpReadEnabled, mcpWriteEnabled } = req.body ?? {};
    if (mcpReadEnabled !== undefined && typeof mcpReadEnabled !== "boolean") {
      res.status(400).json({ error: "mcpReadEnabled must be a boolean" });
      return;
    }
    if (mcpWriteEnabled !== undefined && typeof mcpWriteEnabled !== "boolean") {
      res.status(400).json({ error: "mcpWriteEnabled must be a boolean" });
      return;
    }
    if (mcpReadEnabled === undefined && mcpWriteEnabled === undefined) {
      res.status(400).json({ error: "Provide mcpReadEnabled and/or mcpWriteEnabled" });
      return;
    }
    const result = userStore.setMcpAccess(username, { mcpReadEnabled, mcpWriteEnabled });
    if (!result.ok) {
      res.status(404).json({ error: result.error });
      return;
    }
    res.json({ ok: true, ...result.access });
  });

  app.delete("/api/admin/users/:username", async (req, res) => {
    const auth = await requireCapability(req, res, "users_manage");
    if (!auth.authorized) return;
    const result = userStore.deleteUser(req.params.username);
    if (!result.ok) {
      res.status(404).json({ error: result.error });
      return;
    }
    res.json({ ok: true });
  });

  app.get("/api/admin/pending-users", async (req, res) => {
    const auth = await requireCapability(req, res, "users_manage");
    if (!auth.authorized) return;
    res.json(userStore.getPendingUsers());
  });

  app.post("/api/admin/pending-users", async (req, res) => {
    const auth = await requireCapability(req, res, "users_manage");
    if (!auth.authorized) return;
    const { email, role } = req.body;
    if (!email || !role) {
      res.status(400).json({ error: "email and role are required" });
      return;
    }
    const result = userStore.addPendingUser(email, role);
    if (!result.ok) {
      res.status(400).json({ error: result.error });
      return;
    }
    res.json({ ok: true });
  });

  app.delete("/api/admin/pending-users/:email", async (req, res) => {
    const auth = await requireCapability(req, res, "users_manage");
    if (!auth.authorized) return;
    const email = decodeURIComponent(req.params.email);
    const result = userStore.removePendingUser(email);
    if (!result.ok) {
      res.status(404).json({ error: result.error });
      return;
    }
    res.json({ ok: true });
  });

  app.post("/api/admin/pending-users/:email/assign", async (req, res) => {
    const auth = await requireCapability(req, res, "users_manage");
    if (!auth.authorized) return;
    const email = decodeURIComponent(req.params.email);
    const { username } = req.body;
    if (!username) {
      res.status(400).json({ error: "username is required" });
      return;
    }
    const result = userStore.assignPendingToUser(email, username);
    if (!result.ok) {
      res.status(400).json({ error: result.error });
      return;
    }
    res.json({ ok: true });
  });

  app.get("/api/mcp/tools", async (_req, res) => {
    // Always 200 so the admin UI can show readiness alerts even when MCP is down.
    const siteUrl = (process.env.SITE_URL || "").replace(/\/$/, "") || null;
    const mcpServerSecretConfigured = !!(
      process.env.MCP_SERVER_SECRET ||
      process.env.MCP_API_KEY
    );
    const replitDevDomain = process.env.REPLIT_DEV_DOMAIN || null;
    const readiness = {
      siteUrlConfigured: !!siteUrl,
      mcpServerSecretConfigured,
      mcpReachable: false,
      /** Fallback OAuth base when SITE_URL is unset (Replit only). */
      replitDevDomain,
    };

    /** Role → tools/list visibility (same map as production MCP catalog filter). */
    const roles = Object.entries(userStore.getAllRoles())
      .map(([id, role]) => ({
        id,
        label: role.label,
        description: role.description ?? "",
        allowedTools: allowedToolNames(role.capabilities ?? []),
      }))
      .sort((a, b) => a.label.localeCompare(b.label));

    try {
      const mcpPort = process.env.MCP_PORT || "3001";
      const response = await fetch(`http://localhost:${mcpPort}/tools`);
      if (!response.ok) {
        res.json({
          tools: [],
          roles,
          error: "MCP server unavailable",
          siteUrl,
          readiness: { ...readiness, mcpReachable: false },
        });
        return;
      }
      const data = await response.json();
      res.json({
        ...data,
        roles,
        siteUrl,
        readiness: { ...readiness, mcpReachable: true },
      });
    } catch {
      res.json({
        tools: [],
        roles,
        error: "MCP server unavailable",
        siteUrl,
        readiness: { ...readiness, mcpReachable: false },
      });
    }
  });

  // Error & Warning Log dashboard endpoint
  app.get("/api/admin/error-log", async (req, res) => {
    const auth = await requireCapability(req, res, "metrics_view");
    if (!auth.authorized) return;

    const levelParam = (req.query.level as string | undefined);
    const validLevel = levelParam === "error" || levelParam === "warn" ? levelParam : null;

    const cutoff = Date.now() - 48 * 60 * 60 * 1000;

    try {
      const levelFilter = validLevel ? " AND level = ?" : "";
      const args = validLevel ? [cutoff, validLevel] : [cutoff];

      const totals = sqlite.prepare(
        `SELECT
           SUM(CASE WHEN level = 'error' THEN 1 ELSE 0 END) AS totalErrors,
           SUM(CASE WHEN level = 'warn' THEN 1 ELSE 0 END) AS totalWarnings
         FROM error_log WHERE ts >= ?`
      ).get(cutoff) as { totalErrors: number; totalWarnings: number };

      const issueRows = sqlite.prepare(
        `SELECT level, module, message, err_name, ts
         FROM error_log
         WHERE ts >= ?${levelFilter}`
      ).all(...args) as Array<{
        level: string;
        module: string;
        message: string;
        err_name: string | null;
        ts: number;
      }>;

      type UniqueIssue = {
        module: string;
        level: "error" | "warn";
        message: string;
        err_name: string | null;
        count: number;
        lastTs: number;
      };

      const byFingerprint = new Map<string, UniqueIssue>();
      for (const row of issueRows) {
        const level: "error" | "warn" = row.level === "error" ? "error" : "warn";
        const fp = `${level}|${errorLogFingerprint(row.module, row.message)}`;
        const existing = byFingerprint.get(fp);
        if (existing) {
          existing.count += 1;
          if (row.ts > existing.lastTs) {
            existing.lastTs = row.ts;
            existing.message = row.message;
            existing.err_name = row.err_name;
          }
        } else {
          byFingerprint.set(fp, {
            module: row.module,
            level,
            message: row.message,
            err_name: row.err_name,
            count: 1,
            lastTs: row.ts,
          });
        }
      }

      const uniqueIssues = Array.from(byFingerprint.values())
        .sort((a, b) => {
          if (a.level !== b.level) return a.level === "error" ? -1 : 1;
          if (b.count !== a.count) return b.count - a.count;
          return b.lastTs - a.lastTs;
        })
        .slice(0, 50);

      const topIssueRow = sqlite.prepare(
        `SELECT err_name, COUNT(*) AS cnt
         FROM error_log
         WHERE ts >= ? AND err_name IS NOT NULL${levelFilter}
         GROUP BY err_name
         ORDER BY cnt DESC
         LIMIT 1`
      ).get(...args) as { err_name: string; cnt: number } | undefined;

      const recent = sqlite.prepare(
        `SELECT id, ts, level, module, message, err_name
         FROM error_log
         WHERE ts >= ?${levelFilter}
         ORDER BY ts DESC
         LIMIT 100`
      ).all(...args) as Array<{
        id: number;
        ts: number;
        level: string;
        module: string;
        message: string;
        err_name: string | null;
      }>;

      res.json({
        totalErrors: totals?.totalErrors ?? 0,
        totalWarnings: totals?.totalWarnings ?? 0,
        uniqueIssues,
        topIssue: topIssueRow?.err_name ?? null,
        recent,
      });
    } catch (err) {
      log.error({ err }, "Failed to query error_log:");
      res.status(500).json({ error: "Failed to query error log" });
    }
  });

  app.get("/api/admin/runtime-issues/referrers", async (req, res) => {
    const auth = await requireCapability(req, res, "metrics_view");
    if (!auth.authorized) return;

    try {
      const pathParam = String(req.query.path || "");
      if (!pathParam) {
        res.status(400).json({ error: "path query param is required" });
        return;
      }
      const { getReferrersForTargetPath, loadLinkIndex } = await import("../link-index");
      const site = (res.locals as { site?: { contentRoot?: string } }).site;
      const result = getReferrersForTargetPath(pathParam, site?.contentRoot, { limit: 50 });
      const linkIndex = loadLinkIndex(site?.contentRoot);
      res.json({
        path: pathParam,
        count: result.count,
        entryKeys: result.referrers.map((r) => r.entryKey),
        referrers: result.referrers,
        linkIndexUpdatedAt: linkIndex.updated_at ?? result.updatedAt,
      });
    } catch (err) {
      log.error({ err }, "Failed to list runtime issue referrers:");
      res.status(500).json({ error: "Failed to list referrers" });
    }
  });

  app.get("/api/admin/runtime-issues", async (req, res) => {
    const auth = await requireCapability(req, res, "metrics_view");
    if (!auth.authorized) return;

    try {
      const { listRuntimeIssues } = await import("../runtime-issues-store");
      const {
        loadLinkIndex,
        invertLinkIndex,
        normalizeReferrerTargetPath,
      } = await import("../link-index");
      const site = (res.locals as { site?: { contentRootName?: string; contentRoot?: string } }).site;
      const siteName = site?.contentRootName || "default";
      const data = listRuntimeIssues(siteName, {
        contentRoot: site?.contentRoot,
      });
      const linkIndex = loadLinkIndex(site?.contentRoot);
      const inverted = invertLinkIndex(linkIndex.outbound);
      const issues = data.issues.map((issue) => ({
        ...issue,
        cmsReferrerCount: (inverted.get(normalizeReferrerTargetPath(issue.path)) ?? []).length,
      }));
      res.json({
        ...data,
        issues,
        linkIndexUpdatedAt: linkIndex.updated_at ?? null,
      });
    } catch (err) {
      log.error({ err }, "Failed to list runtime issues:");
      res.status(500).json({ error: "Failed to list runtime issues" });
    }
  });

  app.post("/api/admin/runtime-issues/reset", async (req, res) => {
    const auth = await requireCapability(req, res, "metrics_view");
    if (!auth.authorized) return;

    try {
      const { resetAndUploadRuntimeIssues } = await import("../runtime-issues-store");
      const site = (res.locals as { site?: { contentRootName?: string; contentRoot?: string } }).site;
      const siteName = site?.contentRootName || "default";
      const result = await resetAndUploadRuntimeIssues(siteName, site?.contentRoot);
      res.json({
        success: result.success,
        uploaded: result.uploaded,
        gcsKey: result.gcsKey,
        reason: result.reason,
      });
    } catch (err) {
      log.error({ err }, "Failed to reset runtime issues:");
      res.status(500).json({ error: "Failed to reset runtime issues" });
    }
  });

  app.post("/api/admin/runtime-issues/pull-production", async (req, res) => {
    const auth = await requireCapability(req, res, "metrics_view");
    if (!auth.authorized) return;

    try {
      const { pullRuntimeIssuesFromGcs } = await import("../runtime-issues-store");
      const site = (res.locals as { site?: { contentRootName?: string; contentRoot?: string } }).site;
      const siteName = site?.contentRootName || "default";
      const result = await pullRuntimeIssuesFromGcs(siteName, site?.contentRoot);
      if (!result.success) {
        res.status(400).json({
          error: result.reason ?? "Failed to pull production runtime issues",
          success: false,
          pulled: false,
          gcsKey: result.gcsKey,
          issueCount: result.issueCount,
          reason: result.reason,
        });
        return;
      }
      res.json(result);
    } catch (err) {
      log.error({ err }, "Failed to pull production runtime issues:");
      res.status(500).json({ error: "Failed to pull production runtime issues" });
    }
  });

  app.post("/api/admin/runtime-issues/probe", async (req, res) => {
    const auth = await requireCapability(req, res, "metrics_view");
    if (!auth.authorized) return;

    const fingerprint = typeof req.body?.fingerprint === "string" ? req.body.fingerprint.trim() : "";
    if (!fingerprint) {
      res.status(400).json({ error: "fingerprint is required" });
      return;
    }

    try {
      const site = (res.locals as { site?: { contentRootName?: string; contentRoot?: string } }).site;
      const siteName = site?.contentRootName || "default";
      const { getRuntimeIssue, saveIssueProbe } = await import("../runtime-issues-store");
      const issue = getRuntimeIssue(siteName, fingerprint, site?.contentRoot);
      if (!issue) {
        res.status(404).json({ error: "Runtime issue not found" });
        return;
      }
      const ci = getCI(res);
      const {
        probeRuntimePath,
        makeQuerySlugExists,
        requestOrigin,
      } = await import("../runtime-issues-probe");
      const probe = await probeRuntimePath({
        path: issue.path,
        locale: issue.locale,
        origin: requestOrigin(req),
        ci,
        querySlugExists: makeQuerySlugExists({
          ci,
          db: getDB(res),
          contentRoot: getContentRoot(res),
        }),
      });
      const saved = saveIssueProbe(siteName, fingerprint, probe, site?.contentRoot);
      res.json({ issue: saved });
    } catch (err) {
      log.error({ err }, "Failed to probe runtime issue:");
      res.status(500).json({ error: "Failed to probe runtime issue" });
    }
  });

  app.post("/api/admin/runtime-issues/probe-bulk", async (req, res) => {
    const auth = await requireCapability(req, res, "metrics_view");
    if (!auth.authorized) return;

    const raw = req.body?.fingerprints;
    if (!Array.isArray(raw)) {
      res.status(400).json({ error: "fingerprints must be an array" });
      return;
    }
    const fingerprints = Array.from(
      new Set(raw.filter((f): f is string => typeof f === "string" && f.trim().length > 0).map((f) => f.trim())),
    );

    try {
      const site = (res.locals as { site?: { contentRootName?: string; contentRoot?: string } }).site;
      const siteName = site?.contentRootName || "default";
      const { getRuntimeIssue, saveIssueProbe } = await import("../runtime-issues-store");
      const {
        probeRuntimePath,
        makeQuerySlugExists,
        requestOrigin,
      } = await import("../runtime-issues-probe");
      const ci = getCI(res);
      const querySlugExists = makeQuerySlugExists({
        ci,
        db: getDB(res),
        contentRoot: getContentRoot(res),
      });
      const origin = requestOrigin(req);
      const concurrency = 3;
      const updated: typeof fingerprints = [];
      const failed: Array<{ fingerprint: string; error: string }> = [];
      let cursor = 0;

      async function worker() {
        while (cursor < fingerprints.length) {
          const index = cursor;
          cursor += 1;
          const fingerprint = fingerprints[index];
          const issue = getRuntimeIssue(siteName, fingerprint, site?.contentRoot);
          if (!issue) {
            failed.push({ fingerprint, error: "not found" });
            continue;
          }
          try {
            const probe = await probeRuntimePath({
              path: issue.path,
              locale: issue.locale,
              origin,
              ci,
              querySlugExists,
            });
            const saved = saveIssueProbe(siteName, fingerprint, probe, site?.contentRoot);
            if (saved) updated.push(fingerprint);
            else failed.push({ fingerprint, error: "save failed" });
          } catch (err) {
            failed.push({
              fingerprint,
              error: err instanceof Error ? err.message : "probe failed",
            });
          }
        }
      }

      await Promise.all(
        Array.from({ length: Math.min(concurrency, Math.max(fingerprints.length, 1)) }, () => worker()),
      );
      res.json({ updated, failed });
    } catch (err) {
      log.error({ err }, "Failed to bulk-probe runtime issues:");
      res.status(500).json({ error: "Failed to bulk-probe runtime issues" });
    }
  });

  app.post("/api/admin/runtime-issues/drop-scrapers", async (req, res) => {
    const auth = await requireCapability(req, res, "metrics_view");
    if (!auth.authorized) return;

    const enabled = req.body?.enabled;
    if (typeof enabled !== "boolean") {
      res.status(400).json({ error: "enabled must be a boolean" });
      return;
    }

    try {
      const { setDropScrapers } = await import("../runtime-issues-store");
      const site = (res.locals as { site?: { contentRootName?: string; contentRoot?: string } }).site;
      const siteName = site?.contentRootName || "default";
      const result = setDropScrapers(siteName, enabled, site?.contentRoot);
      res.json(result);
    } catch (err) {
      log.error({ err }, "Failed to update dropScrapers:");
      res.status(500).json({ error: "Failed to update hide scrapers" });
    }
  });

  app.post("/api/admin/runtime-issues/ignore", async (req, res) => {
    const auth = await requireCapability(req, res, "seo_settings");
    if (!auth.authorized) return;

    const raw = req.body?.rules;
    if (!Array.isArray(raw) || raw.length === 0) {
      res.status(400).json({ error: "rules must be a non-empty array" });
      return;
    }
    const { ignoreRuleInputSchema } = await import("@shared/runtime-issues-ignore");
    const rules = raw
      .map((row) => {
        const parsed = ignoreRuleInputSchema.safeParse(row);
        return parsed.success ? parsed.data : null;
      })
      .filter((row): row is NonNullable<typeof row> => Boolean(row));
    if (!rules.length) {
      res.status(400).json({ error: "rules must include at least one valid template" });
      return;
    }
    const seedRaw = req.body?.seedPaths;
    const seedPaths = Array.isArray(seedRaw)
      ? seedRaw.filter((p): p is string => typeof p === "string" && p.trim().length > 0)
      : undefined;
    const purgeRaw = req.body?.purgeFingerprints;
    const purgeFingerprints = Array.isArray(purgeRaw)
      ? Array.from(
          new Set(
            purgeRaw.filter((fp): fp is string => typeof fp === "string" && fp.trim().length > 0),
          ),
        )
      : undefined;

    try {
      const { addIgnoreRules } = await import("../runtime-issues-store");
      const site = (res.locals as { site?: { contentRootName?: string; contentRoot?: string } }).site;
      const siteName = site?.contentRootName || "default";
      const result = addIgnoreRules(siteName, rules, {
        contentRoot: site?.contentRoot,
        seedPaths,
        purgeFingerprints,
      });
      res.json(result);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to add ignore rules";
      if (message.startsWith("Invalid ignore") || message.startsWith("Ignore rule does not match")) {
        res.status(400).json({ error: message });
        return;
      }
      log.error({ err }, "Failed to add ignore rules:");
      res.status(500).json({ error: "Failed to add ignore rules" });
    }
  });

  app.post("/api/admin/runtime-issues/unignore", async (req, res) => {
    const auth = await requireCapability(req, res, "seo_settings");
    if (!auth.authorized) return;

    const raw = req.body?.ids;
    if (!Array.isArray(raw) || raw.length === 0) {
      res.status(400).json({ error: "ids must be a non-empty array" });
      return;
    }
    const ids = Array.from(
      new Set(raw.filter((id): id is string => typeof id === "string" && id.trim().length > 0).map((id) => id.trim())),
    );
    if (!ids.length) {
      res.status(400).json({ error: "ids must include at least one string" });
      return;
    }

    try {
      const { removeIgnoreRules } = await import("../runtime-issues-store");
      const site = (res.locals as { site?: { contentRootName?: string; contentRoot?: string } }).site;
      const siteName = site?.contentRootName || "default";
      const result = removeIgnoreRules(siteName, ids, site?.contentRoot);
      res.json(result);
    } catch (err) {
      log.error({ err }, "Failed to remove ignore rules:");
      res.status(500).json({ error: "Failed to remove ignore rules" });
    }
  });

  app.post("/api/admin/runtime-issues/purge", async (req, res) => {
    const auth = await requireCapability(req, res, "seo_settings");
    if (!auth.authorized) return;

    const mode = req.body?.mode;
    const fingerprintsRaw = req.body?.fingerprints;

    try {
      const site = (res.locals as { site?: { contentRootName?: string; contentRoot?: string } }).site;
      const siteName = site?.contentRootName || "default";
      const contentRoot = site?.contentRoot;

      if (mode === "matching_ignore_rules") {
        const { purgeIssuesMatchingIgnoreRules } = await import("../runtime-issues-store");
        const result = purgeIssuesMatchingIgnoreRules(siteName, contentRoot);
        res.json(result);
        return;
      }

      if (!Array.isArray(fingerprintsRaw) || fingerprintsRaw.length === 0) {
        res.status(400).json({
          error: 'Provide fingerprints (string[]) or mode: "matching_ignore_rules"',
        });
        return;
      }
      const fingerprints = Array.from(
        new Set(
          fingerprintsRaw.filter(
            (fp): fp is string => typeof fp === "string" && fp.trim().length > 0,
          ),
        ),
      );
      if (!fingerprints.length) {
        res.status(400).json({ error: "fingerprints must include at least one string" });
        return;
      }

      const { deleteRuntimeIssuesByFingerprints } = await import("../runtime-issues-store");
      const result = deleteRuntimeIssuesByFingerprints(siteName, fingerprints, contentRoot);
      res.json(result);
    } catch (err) {
      log.error({ err }, "Failed to purge runtime issues:");
      res.status(500).json({ error: "Failed to purge runtime issues" });
    }
  });

  // ============================================================
  // Site Manager — create new site scaffold
  // ============================================================
  app.post("/api/admin/sites/create", async (req, res) => {
    try {
      const auth = await requireCapability(req, res, "sites_manage");
      if (!auth.authorized) return;

      const { name, domain, githubRepoUrl, includeSampleContent, inheritComponentsFrom, fallbackContentFolder } =
        req.body as {
          name?: string;
          domain?: string;
          githubRepoUrl?: string;
          includeSampleContent?: boolean;
          /** Empty string = own registry (no inherit). Omit = default to first site folder. */
          inheritComponentsFrom?: string | null;
          fallbackContentFolder?: string | null;
        };

      if (!name || typeof name !== "string") {
        return res.status(400).json({ error: "Missing required field: name" });
      }
      if (!domain || typeof domain !== "string") {
        return res.status(400).json({ error: "Missing required field: domain" });
      }

      // Validate name: only lowercase alphanumeric + hyphens, no path traversal
      if (!/^[a-z0-9][a-z0-9-]*$/.test(name)) {
        return res.status(400).json({ error: "Folder name must be lowercase alphanumeric with hyphens only (e.g. my-site)" });
      }
      if (name.length > 64) {
        return res.status(400).json({ error: "Folder name too long (max 64 chars)" });
      }

      const folderName = `site_${name}`;
      const folderPath = path.join(process.cwd(), folderName);

      if (fs.existsSync(folderPath)) {
        return res.status(409).json({ error: `Folder "${folderName}" already exists` });
      }

      const { ensureSiteScaffold } = await import("../site-scaffold");
      const { getDefaultContentFolder } = await import("../site-config");
      const defaultFolder = getDefaultContentFolder();

      // Default inherit + image fallback to the default site; empty string clears inherit.
      const inheritFolder =
        inheritComponentsFrom === "" || inheritComponentsFrom === null
          ? undefined
          : (typeof inheritComponentsFrom === "string" && inheritComponentsFrom.trim()) ||
            defaultFolder;
      const fallbackFolder =
        fallbackContentFolder === "" || fallbackContentFolder === null
          ? undefined
          : (typeof fallbackContentFolder === "string" && fallbackContentFolder.trim()) ||
            inheritFolder ||
            defaultFolder;

      ensureSiteScaffold({
        contentFolder: folderName,
        displayName: name,
        includeSampleContent: includeSampleContent !== false,
      });

      // Append to sites.yml and persist to GCS (production)
      const { readSitesYmlLocal, saveSitesYml } = await import("../sites-yml-store");
      let sitesContent = readSitesYmlLocal() ?? "";
      if (sitesContent && !sitesContent.endsWith("\n")) sitesContent += "\n";
      let newEntry = `${domain}:\n  content_folder: ${folderName}\n`;
      if (githubRepoUrl) newEntry += `  github_repo_url: ${githubRepoUrl}\n`;
      if (inheritFolder) newEntry += `  inherit_components_from: ${inheritFolder}\n`;
      if (fallbackFolder) newEntry += `  fallback_content_folder: ${fallbackFolder}\n`;
      sitesContent += newEntry;
      saveSitesYml(sitesContent);
      resetSiteConfigs();
      resetSiteContextMap();

      log.info(`[SiteManager] Created new site scaffold: ${folderName} for domain ${domain}`);

      const githubSeed = githubRepoUrl?.trim()
        ? await (async () => {
            const { seedNewSiteToGitHub } = await import("../github");
            return seedNewSiteToGitHub({
              contentRoot: folderName,
              repoUrl: githubRepoUrl.trim(),
            });
          })()
        : {
            attempted: false,
            success: false,
            committed: [] as string[],
            skipped: [] as string[],
            errors: [] as string[],
            commitSha: null,
          };

      if (githubSeed.attempted) {
        if (githubSeed.success) {
          log.info(
            `[SiteManager] GitHub seed succeeded for ${folderName}: ${githubSeed.committed.length} file(s) committed (${githubSeed.commitSha?.slice(0, 7) ?? "?"})`,
          );
        } else {
          log.warn(
            { githubSeed },
            `[SiteManager] GitHub seed failed for ${folderName} — site created locally`,
          );
        }
      }

      res.json({ folderName, created: true, githubSeed });
    } catch (err) {
      log.error({ err }, "[SiteManager] Failed to create site:");
      res.status(500).json({ error: err instanceof Error ? err.message : "Failed to create site" });
    }
  });

  app.patch("/api/admin/sites/domain", async (req, res) => {
    try {
      const auth = await requireCapability(req, res, "sites_manage");
      if (!auth.authorized) return;

      const { currentDomain, newDomain } = req.body as {
        currentDomain?: string;
        newDomain?: string;
      };

      if (!currentDomain || typeof currentDomain !== "string") {
        return res.status(400).json({ error: "Missing required field: currentDomain" });
      }
      if (!newDomain || typeof newDomain !== "string") {
        return res.status(400).json({ error: "Missing required field: newDomain" });
      }

      const from = currentDomain.trim().toLowerCase();
      const to = newDomain.trim().toLowerCase();

      if (!from || !to) {
        return res.status(400).json({ error: "Domain cannot be empty" });
      }
      if (from === to) {
        return res.status(400).json({ error: "New domain must be different from the current domain" });
      }
      if (!/^[a-z0-9]([a-z0-9.-]*[a-z0-9])?$/.test(to) || to.length > 253) {
        return res.status(400).json({ error: "Invalid domain format" });
      }

      const { renameSiteDomain } = await import("../sites-yml-store");
      const { getSiteContextMap, getDefaultSite } = await import("../site-manager");
      const staleSite = res.locals.site;

      renameSiteDomain(from, to);
      resetSiteConfigs();
      resetSiteContextMap();

      if (process.env.NODE_ENV !== "production") {
        const devOverride = readDevSiteFile();
        if (devOverride === from || staleSite?.config.domain === from) {
          writeDevSiteFile(to);
        }
      }

      if (staleSite?.config.domain === from) {
        const freshCtx = getSiteContextMap().get(to) ?? getDefaultSite();
        res.locals.site = { ...freshCtx, isDevOverride: staleSite.isDevOverride ?? false };
      }

      const sites = getSiteConfigs().map(({ domain, contentFolder, githubRepoUrl }) => ({
        domain,
        contentFolder,
        githubRepoUrl,
      }));
      const siteInfo = getSiteInfo(req, res);

      log.info(`[SiteManager] Renamed site domain: ${from} → ${to}`);

      res.json({
        success: true,
        sites,
        siteInfo,
        previousDomain: from,
        message: `Domain updated from ${from} to ${to}.`,
      });
    } catch (err) {
      log.error({ err }, "[SiteManager] Failed to rename site domain:");
      res.status(500).json({
        success: false,
        error: err instanceof Error ? err.message : "Failed to rename site domain",
      });
    }
  });

  app.post("/api/admin/sites/refresh-config", async (req, res) => {
    try {
      const auth = await requireCapability(req, res, "sites_manage");
      if (!auth.authorized) return;

      const { refreshSitesYmlConfig } = await import("../sites-yml-store");
      const source = await refreshSitesYmlConfig();
      const sites = getSiteConfigs().map(({ domain, contentFolder, githubRepoUrl }) => ({
        domain,
        contentFolder,
        githubRepoUrl,
      }));

      // res.locals.site was resolved before the refresh reset the context map;
      // re-resolve it against the freshly built map so siteInfo is not stale.
      const { getSiteContextMap, getDefaultSite } = await import("../site-manager");
      const staleSite = res.locals.site;
      if (staleSite) {
        const freshCtx = getSiteContextMap().get(staleSite.config.domain) ?? getDefaultSite();
        res.locals.site = { ...freshCtx, isDevOverride: staleSite.isDevOverride ?? false };
      }
      const siteInfo = getSiteInfo(req, res);

      res.json({
        success: true,
        source,
        sites,
        siteInfo,
        message:
          source === "gcs"
            ? "Site registry refreshed from GCS."
            : "Site registry reloaded from local sites.yml.",
      });
    } catch (err) {
      log.error({ err }, "[SiteManager] Failed to refresh site registry:");
      res.status(500).json({
        success: false,
        error: err instanceof Error ? err.message : "Failed to refresh site registry.",
      });
    }
  });

}
