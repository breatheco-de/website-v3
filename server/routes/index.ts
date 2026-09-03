import type { Express, Request, Response } from "express";
import { createServer, type Server } from "http";
import { storage } from "../storage";
import { child as loggerChild } from "../logger";
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

// =============================================================================
// ROUTE FILE MAP — where to add new API endpoints
// =============================================================================
// When adding a new route, put it in the file whose domain matches the prefix:
//
//   geo.ts          /api/geo, /api/ip
//   auth.ts         /api/auth, /api/debug-token
//   forms.ts        /api/leads, /api/form-options
//   settings.ts     /api/settings, /api/content-types, /api/menus, /api/faqs
//   content.ts      /api/content, /api/landings, /api/locations, /api/pages,
//                   /api/career-programs, /api/content-pages, /api/preview
//   databases.ts    /api/databases, /api/db
//   sections.ts     /api/sections, /api/content-pages (section-level edits)
//   seo.ts          /api/sitemap, /api/redirects, /api/schema, /api/seo
//   admin.ts        /api/admin, /api/users, /api/roles, /api/sync-log
//   components.ts   /api/component-registry
//   versioning.ts   /api/versioning
//   github.ts       /api/github, /api/debug/github
//   media.ts        /api/media, /api/image-registry, /api/image-optimizer
//   ai.ts           /api/ai, /api/chat, /api/brand-context
//   validation.ts   /api/validation, /api/diagnostics, /api/debug
//   ecommerce.ts    /api/ecommerce
//   webhooks.ts     /api/webhooks
//
// Each file exports a single registerXxxRoutes(app: Express): void function.
// Add your function call to the register block in registerRoutes() below.
// =============================================================================

import { registerGeoRoutes } from "./geo";
import { registerAuthRoutes } from "./auth";
import { registerFormsRoutes } from "./forms";
import { registerSettingsRoutes } from "./settings";
import { registerContentRoutes } from "./content";
import { registerDatabasesRoutes } from "./databases";
import { registerListingsRoutes } from "./listings";
import { registerSectionsRoutes } from "./sections";
import { registerSeoRoutes } from "./seo";
import { registerAdminRoutes } from "./admin";
import { registerSidequestDashboardRoutes } from "./sidequest-dashboard";
import { registerSidequestAdminRoutes } from "./sidequest-admin";
import { registerComponentsRoutes } from "./components";
import { registerVersioningRoutes } from "./versioning";
import { registerGithubRoutes } from "./github";
import { registerMediaRoutes } from "./media";
import { registerAiRoutes } from "./ai";
import { registerValidationRoutes } from "./validation";
import { registerProposalRoutes } from "./proposals";
import { registerEcommerceRoutes } from "./ecommerce";
import { registerFunnelRoutes } from "./funnel";
import { registerWebhooksRoutes } from "./webhooks";
import { registerOverlaysRoutes } from "./overlays";
import { setWorkerRunNow } from "./_worker-state";
import { getSiteInfo, getSiteContextMap, writeDevSiteFile, clearDevSiteFile } from "../site-manager";
import { getSiteConfigs, getDefaultContentFolder } from "../site-config";

const routesLogger = loggerChild({ module: "routes" });

export async function registerRoutes(app: Express): Promise<Server> {
  media.initFromEnv();

  // Architecture check — runs async after init; sets gcs.migrationRequired if old flat layout detected.
  const { gcs } = await import("../gcs");
  gcs.checkArchitecture().catch(() => { /* non-fatal */ });


  const { loadSyncLog, logSync, getInstanceId } = await import("../sync-log");
  const { loadSyncStateFromBucket } = await import("../sync-state");

  await loadSyncLog();
  const { getReplitCheckpoint, refreshGithubCommit } = await import(
    "../sync-log"
  );
  const restartMessage = `Server started (instance=${getInstanceId()}, checkpoint=${getReplitCheckpoint()}, env=${process.env.NODE_ENV || "development"}, pid=${process.pid})`;
  try {
    for (const ctx of Array.from(getSiteContextMap().values())) {
      ctx.syncLog.log("RESTART", restartMessage);
    }
  } catch {
    logSync("RESTART", restartMessage);
  }
  refreshGithubCommit();

  // Attach user ID from the X-User-Id header (sent by the client on
  // every request) to req so that all downstream routes can access it without
  // individually reading the cookie. Registered before any route handlers so
  // every route has access. The cookie-based path in cookie-utils.ts remains
  // as the authoritative fallback for versioning routes.
  app.use((req, _res, next) => {
    const headerValue = req.headers["x-user-id"];
    const raw = Array.isArray(headerValue) ? headerValue[0] : headerValue;
    if (raw && raw.trim()) {
      (req as Request & { userId?: string }).userId = raw.trim();
    }
    next();
  });

  app.get("/apply", (req, res) => {
    const lang = detectLanguageFromRequest(req);
    const target = lang === "es" ? "/es/aplica" : "/en/apply";
    const qs = Object.keys(req.query).length
      ? "?" +
        new URLSearchParams(req.query as Record<string, string>).toString()
      : "";
    res.redirect(302, target + qs);
  });

  // Apply redirect middleware for 301 redirects from YAML content
  app.use(redirectMiddleware);


  registerGeoRoutes(app);
  registerAuthRoutes(app);
  registerFormsRoutes(app);
  registerSettingsRoutes(app);
  registerContentRoutes(app);
  registerDatabasesRoutes(app);
  registerListingsRoutes(app);
  registerSectionsRoutes(app);
  registerSeoRoutes(app);
  registerAdminRoutes(app);
  registerSidequestDashboardRoutes(app);
  registerSidequestAdminRoutes(app);
  registerComponentsRoutes(app);
  registerVersioningRoutes(app);
  registerGithubRoutes(app);
  registerMediaRoutes(app);
  registerAiRoutes(app);
  registerValidationRoutes(app);
  registerProposalRoutes(app);
  registerEcommerceRoutes(app);
  registerFunnelRoutes(app);
  registerWebhooksRoutes(app);
  registerOverlaysRoutes(app);

  // Site info endpoint — returns which site/content-folder is active for this request
  app.get("/api/site/info", (req, res) => {
    const info = getSiteInfo(req, res);
    res.json(info);
  });

  // List all configured sites (dev use only, no auth required — read-only)
  app.get("/api/sites", (_req, res) => {
    const configs = getSiteConfigs();
    res.json(configs.map(({ domain, contentFolder, githubRepoUrl }) => ({ domain, contentFolder, githubRepoUrl })));
  });

  // -------------------------------------------------------------------------
  // DEV-ONLY: site switcher endpoints (non-production only)
  //
  // These write/delete the .local/dev-site-override file on disk.
  // siteResolutionMiddleware reads that file synchronously on every request
  // to determine which site context to use.
  //
  // ⚠️  DO NOT switch this to a cookie-based approach.
  //
  //   Cookies fail silently in the Replit workspace because the app runs in a
  //   cross-origin iframe (worf.replit.dev embedded inside replit.com).
  //   Chrome 115+ blocks third-party cookies in this context — both
  //   document.cookie writes on the client AND Set-Cookie response headers
  //   from the server are ignored. SameSite=Lax and SameSite=None; Secure
  //   were both tested and both fail. The file-based approach is the only
  //   mechanism that works reliably.
  //
  // The client (devSite.ts) mirrors the value in localStorage so that
  // injectDevSite() can also append ?__site= to TanStack Query API calls
  // as belt-and-suspenders — but the file is the authoritative truth.
  // -------------------------------------------------------------------------
  if (process.env.NODE_ENV !== "production") {
    app.get("/api/dev/set-site", (req, res) => {
      const domain = req.query.domain as string;
      if (!domain) { res.status(400).json({ error: "domain required" }); return; }
      writeDevSiteFile(domain);
      res.json({ ok: true, domain });
    });
    app.get("/api/dev/clear-site", (_req, res) => {
      clearDevSiteFile();
      res.json({ ok: true });
    });
  }

  const httpServer = createServer(app);

  // Start the background image queue worker
  import("../image-queue-worker").then(({ start, runNow }) => {
    setWorkerRunNow(runNow);
    start();
  }).catch((err) => {
    routesLogger.error({ err, worker: "ImageQueueWorker" }, "failed to start image queue worker");
  });

  return httpServer;
}

export async function startBackgroundSync(): Promise<void> {
  const { logSync } = await import("../sync-log");
  const { loadSyncStateFromBucket } = await import("../sync-state");

  // Per-site sync targets from SiteContext — sites without githubRepoUrl are skipped
  // so they cannot inadvertently pull from the global GITHUB_REPO_URL env var.
  type SyncTarget = { repoUrl?: string; contentRoot?: string; label: string };
  const syncTargets: SyncTarget[] = [];
  const seen = new Set<string>();
  for (const ctx of Array.from(getSiteContextMap().values())) {
    if (!ctx.config.githubRepoUrl) continue;
    const key = `${ctx.config.githubRepoUrl.replace(/\.git$/, "")}:${ctx.contentRootName}`;
    if (seen.has(key)) continue;
    seen.add(key);
    syncTargets.push({
      repoUrl: ctx.config.githubRepoUrl,
      contentRoot: ctx.contentRootName,
      label: ctx.config.domain,
    });
  }

  routesLogger.info(`reconciling sync state in background (non-blocking) for ${syncTargets.length} site(s)...`);
  // Load sync state from GCS for each unique site, isolated by contentRoot so that
  // multi-site setups don't mix state between repos.
  const siteContentRoots = Array.from(new Set(syncTargets.map(t => t.contentRoot)));
  Promise.allSettled(
    siteContentRoots.map(cr => loadSyncStateFromBucket(cr))
  ).then(async () => {
      const {
        reconcileSyncStateOnStartup,
        autoPullNonConflicting,
        ensureWebhook,
        bootstrapContentFromRemote,
        isGitHubConfigured,
        isBootstrapComplete,
      } = await import("../github");

      await Promise.all(syncTargets.map(async (target) => {
        const { withSyncLogContextAsync } = await import("../sync-log");
        return withSyncLogContextAsync(target.contentRoot, async () => {
        const opts = { repoUrl: target.repoUrl, contentRoot: target.contentRoot };
        const pfx = ` [${target.label}]`;
        const contentFolder = target.contentRoot ?? getDefaultContentFolder();

        // When .bootstrap-complete is absent (fresh VM / republish), align disk to
        // GitHub via hash-diff (GitHub wins). Shows BootstrapModal while running.
        const syncEnabled = process.env.GITHUB_SYNC_ENABLED === "true";
        if (syncEnabled && isGitHubConfigured(target.repoUrl) && !isBootstrapComplete(target.contentRoot)) {
          routesLogger.info(
            `Bootstrap${pfx}: .bootstrap-complete absent — hash-diff pull from remote...`,
          );
          try {
            const bootstrapResult = await bootstrapContentFromRemote({
              ...opts,
              force: false,
            });
            if (bootstrapResult.cancelled) {
              logSync(
                "AUTO-PULL",
                `Bootstrap${pfx}: cancelled (pulled=${bootstrapResult.pulled} skipped=${bootstrapResult.skipped}) — flag not written`,
              );
            } else if (bootstrapResult.pulled > 0 || bootstrapResult.skipped > 0) {
              logSync(
                "AUTO-PULL",
                `Bootstrap${pfx}: pulled=${bootstrapResult.pulled} skipped=${bootstrapResult.skipped}${bootstrapResult.commitSha ? ` — aligned to ${bootstrapResult.commitSha.slice(0, 7)}` : ""}`,
              );
              if (bootstrapResult.pulled > 0 && target.contentRoot) {
                const siteCtx = Array.from(getSiteContextMap().values()).find(
                  (ctx) => ctx.contentRootName === target.contentRoot
                );
                if (siteCtx?.contentIndex) {
                  (siteCtx.contentIndex as any).refresh?.();
                  routesLogger.info(`Bootstrap${pfx}: ContentIndex refresh after pulling ${bootstrapResult.pulled} file(s)`);
                }
              }
            }
            if (bootstrapResult.errors.length > 0) {
              logSync("ERROR", `Bootstrap${pfx}: ${bootstrapResult.errors.length} file(s) failed — ${bootstrapResult.errors.slice(0, 3).join("; ")}`);
            }
          } catch (e) {
            logSync("ERROR", `Bootstrap pull${pfx} failed: ${e instanceof Error ? e.message : String(e)}`);
          }
        }

        await reconcileSyncStateOnStartup(opts);
        const isAutoPullEnabled =
          process.env.GITHUB_SYNC_ENABLED === "true" &&
          process.env.GITHUB_AUTO_PULL_ENABLED === "true";
        if (isAutoPullEnabled) {
          const result = await autoPullNonConflicting(undefined, undefined, opts);
          if (result.pulled.length > 0) {
            logSync("AUTO-PULL", `Startup${pfx}: pulled ${result.pulled.length} incoming files: ${result.pulled.map((f) => f.replace(contentFolder + "/", "")).join(", ")}`);
          }
          if (result.conflicted.length > 0) {
            logSync("CONFLICT", `Startup${pfx}: ${result.conflicted.length} files have local conflicts, awaiting manual resolution`);
          }
          if (result.errors.length > 0) {
            logSync("ERROR", `Startup${pfx}: ${result.errors.length} file(s) failed to pull — retrying in 10s: ${result.errors.join("; ")}`);
            setTimeout(async () => {
              try {
                const retry = await autoPullNonConflicting(undefined, undefined, opts);
                if (retry.pulled.length > 0) {
                  logSync("AUTO-PULL", `Retry${pfx}: pulled ${retry.pulled.length} file(s): ${retry.pulled.map((f) => f.replace(contentFolder + "/", "")).join(", ")}`);
                }
                if (retry.errors.length > 0) {
                  logSync("ERROR", `Retry${pfx}: ${retry.errors.length} file(s) still failed: ${retry.errors.join("; ")}`);
                }
              } catch (e) {
                logSync("ERROR", `Retry${pfx} failed: ${e instanceof Error ? e.message : String(e)}`);
              }
            }, 10000);
          }
        } else {
          logSync("AUTO-PULL", `Skipped startup pull${pfx} — GITHUB_AUTO_PULL_ENABLED not set to 'true'`);
        }
        await ensureWebhook(opts);
        });
      }));
    })
    .catch((err) => {
      logSync(
        "ERROR",
        `Failed to load/reconcile on startup: ${err instanceof Error ? err.message : String(err)}`,
      );
      routesLogger.error({ err, worker: "SyncState" }, "failed to load/reconcile on startup");
    });
}
