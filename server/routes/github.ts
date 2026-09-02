import type { Express, Request, Response } from "express";
import { createServer, type Server } from "http";
import { getSiteContextMap, getDefaultSite } from "../site-manager";
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
  requireStaffSession,
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
  createPushAllRun,
  applyPushAllProgress,
  currentPushAllRun,
  resolveEventActor,
} from "./_helpers";
import { parseAutoSyncCommitAuthor } from "@shared/git-commit-attribution";
import { child } from "../logger";
import type { SiteContext } from "../site-manager";
import type { SyncLogCategory } from "../sync-log";

const log = child({ module: "routes/github" });

type WebhookDeliveryReason =
  | "missing_signature"
  | "no_webhook_configured"
  | "invalid_signature"
  | "ping"
  | "ignored_event"
  | "self_push"
  | "push"
  | "push_no_site_files";

type WebhookDeliveryMeta = {
  status: number;
  reason: WebhookDeliveryReason;
  host: string;
  forwardedHost?: string;
  event?: string;
  deliveryId?: string;
  webhookId?: number;
  registeredUrl?: string;
  sha?: string;
  pusher?: string;
  ref?: string;
  filesChanged?: number;
  added?: number;
  modified?: number;
  removed?: number;
  pathsSample?: string[];
  ignoredEvent?: string;
};

const PATHS_SAMPLE_LIMIT = 5;

function normalizeRepoUrl(url: string | undefined | null): string {
  return (url || "").replace(/\.git$/, "").toLowerCase();
}

function extractIncomingRepoUrl(body: unknown): string {
  const b = body as { repository?: { html_url?: string; clone_url?: string } } | null;
  return normalizeRepoUrl(b?.repository?.html_url || b?.repository?.clone_url || "");
}

function resolveMatchedSitesForRepo(repoUrl: string): SiteContext[] {
  const matched: SiteContext[] = [];
  if (repoUrl) {
    for (const ctx of Array.from(getSiteContextMap().values())) {
      const siteRepo = normalizeRepoUrl(ctx.config.githubRepoUrl);
      if (siteRepo && siteRepo === repoUrl) matched.push(ctx);
    }
  }
  if (matched.length === 0) matched.push(getDefaultSite());
  return matched;
}

function requestHostMeta(req: Request): { host: string; forwardedHost?: string } {
  const host = req.hostname || "";
  const xf = req.headers["x-forwarded-host"];
  const forwardedRaw = Array.isArray(xf) ? xf[0] : xf;
  const headerHost = typeof req.headers.host === "string" ? req.headers.host : undefined;
  const forwardedHost = (forwardedRaw || headerHost || "").split(",")[0]?.trim() || undefined;
  return forwardedHost && forwardedHost !== host
    ? { host, forwardedHost }
    : forwardedHost
      ? { host: host || forwardedHost, forwardedHost }
      : { host };
}

function headerString(req: Request, name: string): string | undefined {
  const v = req.headers[name];
  if (Array.isArray(v)) return v[0];
  return typeof v === "string" ? v : undefined;
}

function buildWebhookDeliveryMeta(
  req: Request,
  partial: Omit<WebhookDeliveryMeta, "host" | "forwardedHost" | "event" | "deliveryId"> &
    Partial<Pick<WebhookDeliveryMeta, "event" | "deliveryId">>,
): WebhookDeliveryMeta {
  const hosts = requestHostMeta(req);
  const event = partial.event ?? headerString(req, "x-github-event");
  const deliveryId = partial.deliveryId ?? headerString(req, "x-github-delivery");
  return {
    ...partial,
    ...hosts,
    ...(event ? { event } : {}),
    ...(deliveryId ? { deliveryId } : {}),
  };
}

function countPushPaths(commits: Array<{ added?: string[]; modified?: string[]; removed?: string[] }>): {
  changedFiles: Set<string>;
  added: number;
  modified: number;
  removed: number;
} {
  const changedFiles = new Set<string>();
  let added = 0;
  let modified = 0;
  let removed = 0;
  for (const commit of commits) {
    for (const f of commit.added || []) {
      changedFiles.add(f);
      added++;
    }
    for (const f of commit.modified || []) {
      changedFiles.add(f);
      modified++;
    }
    for (const f of commit.removed || []) {
      changedFiles.add(f);
      removed++;
    }
  }
  return { changedFiles, added, modified, removed };
}

function pathsSampleFrom(files: Iterable<string>, limit = PATHS_SAMPLE_LIMIT): string[] {
  return Array.from(files).slice(0, limit);
}

function fanOutWebhookLog(
  sites: SiteContext[],
  message: string,
  meta: WebhookDeliveryMeta,
  logSyncFn: (
    category: SyncLogCategory,
    message: string,
    person?: string,
    meta?: Record<string, unknown>,
    contentRoot?: string,
  ) => void,
  person?: string,
): void {
  const seen = new Set<string>();
  for (const ctx of sites) {
    const key = ctx.contentRootName || ctx.config.domain;
    if (seen.has(key)) continue;
    seen.add(key);
    if (ctx.syncLog) ctx.syncLog.log("WEBHOOK", message, person, meta);
    else logSyncFn("WEBHOOK", message, person, meta, ctx.contentRootName);
  }
}

export function registerGithubRoutes(app: Express): void {
  // GitHub sync status endpoint
  app.get("/api/github/sync-status", async (req, res) => {
    try {
      const site = res.locals.site as { contentRootName?: string; config?: { githubRepoUrl?: string } } | undefined;
      const { getGitHubSyncStatus } = await import("../github");
      const status = await getGitHubSyncStatus({
        repoUrl: site?.config?.githubRepoUrl,
        contentRoot: site?.contentRootName,
      });
      res.json(status);
    } catch (error) {
      log.error({ err: error }, "Error checking GitHub sync status:");
      res.status(500).json({ error: "Failed to check sync status" });
    }
  });

  // Per-user GitHub App connection status (staff session)
  app.get("/api/github/user-connection", async (req, res) => {
    try {
      const auth = await requireStaffSession(req, res);
      if (!auth.authorized) return;

      const {
        getUserConnectionStatus,
        getGitHubConnectSetupInfo,
        isGitHubConnectRequired,
      } = await import("../github-user-tokens");
      const status = await getUserConnectionStatus(auth.username);
      res.json({
        ...status,
        required: isGitHubConnectRequired(),
        setup: getGitHubConnectSetupInfo(),
        education: {
          summary:
            "In production, content commits use your connected GitHub identity on the content repo. The service GITHUB_TOKEN is only for pulls and system operations.",
          advanced: [
            "server/github-user-tokens.ts",
            "GET/DELETE /api/github/user-connection",
            "GET /api/github/oauth/start",
            "GCS blob mcp-auth/github-user-tokens.enc",
          ],
        },
      });
    } catch (error) {
      log.error({ err: error }, "Error reading GitHub user connection:");
      res.status(500).json({ error: "Failed to read GitHub connection" });
    }
  });

  app.delete("/api/github/user-connection", async (req, res) => {
    try {
      const auth = await requireStaffSession(req, res);
      if (!auth.authorized) return;
      if (!auth.username) {
        res.status(400).json({ error: "No username on session" });
        return;
      }
      const { deleteUserGitHubToken } = await import("../github-user-tokens");
      await deleteUserGitHubToken(auth.username);
      res.json({ success: true, connected: false });
    } catch (error) {
      log.error({ err: error }, "Error disconnecting GitHub:");
      res.status(500).json({ error: "Failed to disconnect GitHub" });
    }
  });

  app.get("/api/github/oauth/start", async (req, res) => {
    try {
      const auth = await requireStaffSession(req, res);
      if (!auth.authorized) return;

      const {
        isGitHubAppConfigured,
        createOAuthState,
        getOAuthAuthorizeUrl,
      } = await import("../github-user-tokens");

      if (!isGitHubAppConfigured()) {
        res.status(503).json({
          error:
            "GitHub App is not configured (GITHUB_APP_CLIENT_ID, GITHUB_APP_CLIENT_SECRET, GITHUB_APP_SLUG).",
          code: "github_app_env_missing",
        });
        return;
      }

      const username =
        auth.username ||
        (process.env.NODE_ENV !== "production" ? "dev" : null);
      if (!username) {
        res.status(401).json({ error: "Staff username required to Connect GitHub" });
        return;
      }

      const state = createOAuthState(username);
      const url = getOAuthAuthorizeUrl(state);

      // JSON when client asks for it (Bearer session from DebugBubble).
      const wantsJson =
        req.query.format === "json" ||
        (typeof req.headers.accept === "string" &&
          req.headers.accept.includes("application/json"));
      if (wantsJson) {
        res.json({ url });
        return;
      }
      res.redirect(url);
    } catch (error) {
      log.error({ err: error }, "Error starting GitHub OAuth:");
      res.status(500).json({ error: "Failed to start GitHub Connect" });
    }
  });

  app.get("/api/github/oauth/callback", async (req, res) => {
    const failRedirect = (
      msg: string,
      extra?: Record<string, string | undefined>,
    ) => {
      const q = new URLSearchParams({ github: "error", message: msg });
      if (extra) {
        for (const [key, value] of Object.entries(extra)) {
          if (value) q.set(key, value);
        }
      }
      res.redirect(`/private/repository-sync?${q.toString()}`);
    };

    try {
      const code = typeof req.query.code === "string" ? req.query.code : "";
      const state = typeof req.query.state === "string" ? req.query.state : "";
      const oauthError =
        typeof req.query.error === "string" ? req.query.error : "";

      if (oauthError) {
        failRedirect(oauthError);
        return;
      }
      if (!code || !state) {
        failRedirect("Missing OAuth code or state");
        return;
      }

      const {
        consumeOAuthState,
        exchangeOAuthCode,
        fetchGitHubUser,
        verifyContentRepoWriteAccess,
        setUserGitHubToken,
      } = await import("../github-user-tokens");

      const username = consumeOAuthState(state);
      if (!username) {
        failRedirect("Invalid or expired OAuth state. Try Connect again.");
        return;
      }

      const exchanged = await exchangeOAuthCode(code);
      const ghUser = await fetchGitHubUser(exchanged.access_token);
      const writeCheck = await verifyContentRepoWriteAccess(
        exchanged.access_token,
      );
      if (!writeCheck.ok) {
        failRedirect(
          writeCheck.error || "No write access to content repo",
          {
            code: writeCheck.code,
            repos: writeCheck.reposChecked.join(","),
          },
        );
        return;
      }

      const expiresIn =
        typeof exchanged.expires_in === "number"
          ? exchanged.expires_in
          : 8 * 60 * 60;

      await setUserGitHubToken(username, {
        accessToken: exchanged.access_token,
        refreshToken: exchanged.refresh_token,
        githubLogin: ghUser.login,
        githubName: ghUser.name,
        githubEmail: ghUser.email,
        expiresAt: Date.now() + expiresIn * 1000,
        connectedAt: new Date().toISOString(),
      });

      res.redirect("/private/repository-sync?github=connected");
    } catch (error) {
      log.error({ err: error }, "GitHub OAuth callback failed:");
      failRedirect(
        error instanceof Error ? error.message : "OAuth callback failed",
      );
    }
  });

  // GitHub webhook endpoint - receives push events for auto-pull
  app.post("/api/github/webhook", async (req, res) => {
    try {
      const { logSync } = await import("../sync-log");
      const { getWebhookInfo } = await import("../sync-state");
      const { verifyWebhookSignature } = await import("../github");

      const rawBody = (req as any).rawBody;
      let parsedBody: unknown = req.body;
      try {
        if (rawBody) parsedBody = JSON.parse(rawBody.toString("utf-8"));
      } catch {
        parsedBody = req.body;
      }
      const incomingRepo = extractIncomingRepoUrl(parsedBody);
      const matchedForLog = resolveMatchedSitesForRepo(incomingRepo);

      const signature = req.headers["x-hub-signature-256"] as string | undefined;
      if (!signature) {
        const meta = buildWebhookDeliveryMeta(req, { status: 401, reason: "missing_signature" });
        fanOutWebhookLog(
          matchedForLog,
          "Webhook rejected (401): request reached the app without GitHub's X-Hub-Signature-256 header. A proxy may have stripped it, or the hook was registered without a secret.",
          meta,
          logSync,
        );
        res.status(401).json({ error: "Missing signature" });
        return;
      }

      const payload = rawBody
        ? rawBody.toString("utf-8")
        : JSON.stringify(req.body);

      // Resolve the correct per-site webhook secret by matching the push repo URL
      // against registered site configs.  Falls back to the default (no contentRoot)
      // state for single-site deployments.
      let webhookInfo = (() => {
        if (incomingRepo) {
          for (const ctx of Array.from(getSiteContextMap().values())) {
            const siteRepo = normalizeRepoUrl(ctx.config.githubRepoUrl);
            if (siteRepo && siteRepo === incomingRepo) {
              const perSiteInfo = getWebhookInfo(ctx.contentRootName);
              if (perSiteInfo) return perSiteInfo;
            }
          }
        }
        return getWebhookInfo();
      })();

      if (!webhookInfo) {
        const meta = buildWebhookDeliveryMeta(req, {
          status: 500,
          reason: "no_webhook_configured",
        });
        fanOutWebhookLog(
          matchedForLog,
          "Webhook rejected (500): this process has no webhook secret in sync state. Register or Re-setup the webhook so deliveries can be verified.",
          meta,
          logSync,
        );
        res.status(500).json({ error: "No webhook configured" });
        return;
      }

      if (
        !verifyWebhookSignature(payload, signature, webhookInfo.webhookSecret)
      ) {
        const meta = buildWebhookDeliveryMeta(req, {
          status: 401,
          reason: "invalid_signature",
          webhookId: webhookInfo.webhookId,
          registeredUrl: webhookInfo.webhookUrl,
        });
        fanOutWebhookLog(
          matchedForLog,
          "Webhook rejected (401): signature mismatch — GitHub's hook secret does not match this app's sync-state secret. Often caused by multiple sites sharing one content repo (each re-registering the hook) or SITE_URL drift. Try Re-setup webhook and compare the hook URL to SITE_URL.",
          meta,
          logSync,
        );
        res.status(401).json({ error: "Invalid signature" });
        return;
      }

      const event = headerString(req, "x-github-event") || "";

      if (event === "ping") {
        const meta = buildWebhookDeliveryMeta(req, {
          status: 200,
          reason: "ping",
          webhookId: webhookInfo.webhookId,
          registeredUrl: webhookInfo.webhookUrl,
          event: "ping",
        });
        fanOutWebhookLog(
          matchedForLog,
          "Webhook ping received — GitHub can reach this app and the signature is valid.",
          meta,
          logSync,
        );
        res.json({ ok: true, message: "pong" });
        return;
      }

      if (event !== "push") {
        const meta = buildWebhookDeliveryMeta(req, {
          status: 200,
          reason: "ignored_event",
          webhookId: webhookInfo.webhookId,
          registeredUrl: webhookInfo.webhookUrl,
          event,
          ignoredEvent: event,
        });
        fanOutWebhookLog(
          matchedForLog,
          `Webhook ignored non-push event "${event}". Only push events trigger auto-pull.`,
          meta,
          logSync,
        );
        res.json({ ok: true, message: `Ignored event: ${event}` });
        return;
      }

      const pushPayload = (parsedBody && typeof parsedBody === "object" ? parsedBody : req.body) as {
        after?: string;
        ref?: string;
        pusher?: { name?: string };
        repository?: { html_url?: string; clone_url?: string };
        commits?: Array<{ added?: string[]; modified?: string[]; removed?: string[]; message?: string }>;
        head_commit?: { message?: string };
      };
      const commitSha = pushPayload.after;
      const pusher = pushPayload.pusher?.name || "unknown";

      const { getAutoCommitStatus } = await import("../auto-commit");
      const { lastCommitSha } = getAutoCommitStatus();

      const pushRepoUrl = incomingRepo || extractIncomingRepoUrl(pushPayload);
      const matchedSites = resolveMatchedSitesForRepo(pushRepoUrl);

      const logForSite = (
        ctx: SiteContext | null,
        cat: SyncLogCategory,
        msg: string,
        person?: string,
        meta?: Record<string, unknown>,
      ) => {
        if (ctx?.syncLog) ctx.syncLog.log(cat, msg, person, meta);
        else logSync(cat, msg, person, meta, ctx?.contentRootName);
      };

      const { changedFiles, added, modified, removed } = countPushPaths(pushPayload.commits || []);
      const basePushMeta = buildWebhookDeliveryMeta(req, {
        status: 200,
        reason: "push",
        webhookId: webhookInfo.webhookId,
        registeredUrl: webhookInfo.webhookUrl,
        event: "push",
        sha: commitSha ? commitSha.slice(0, 7) : undefined,
        pusher,
        ref: pushPayload.ref,
        filesChanged: changedFiles.size,
        added,
        modified,
        removed,
        pathsSample: pathsSampleFrom(changedFiles),
      });

      if (
        lastCommitSha &&
        commitSha &&
        (commitSha === lastCommitSha ||
          commitSha.startsWith(lastCommitSha) ||
          lastCommitSha.startsWith(commitSha))
      ) {
        const selfMeta: WebhookDeliveryMeta = { ...basePushMeta, reason: "self_push" };
        const msg = `Push ${commitSha.slice(0, 7)} by ${pusher}: skipping auto-pull — this commit was pushed by this instance (avoids echo).`;
        for (const ctx of matchedSites) {
          logForSite(ctx, "WEBHOOK", msg, pusher, selfMeta);
        }
        res.json({ ok: true, message: "Self-push, skipping auto-pull" });
        return;
      }

      const commits = pushPayload.commits || [];

      // Extract the real CMS author from commit messages — format: "[Auto-sync] Author Name updated file.yml"
      // (may be prefixed with [Author: agent-label] for MCP writes).
      // All commits share the same GitHub token so pusher.name is always the same technical user.
      const realAuthor = (() => {
        const messages = [
          pushPayload.head_commit?.message,
          ...commits.map((c) => c.message),
        ].filter(Boolean) as string[];
        for (const msg of messages) {
          const parsed = parseAutoSyncCommitAuthor(msg);
          if (parsed) return parsed;
        }
        return null;
      })();
      const person = realAuthor ?? pusher;

      const isAutoPullEnabled =
        process.env.GITHUB_SYNC_ENABLED === "true" &&
        process.env.GITHUB_AUTO_PULL_ENABLED === "true";

      const { autoPullNonConflicting } = await import("../github");
      let totalPulled = 0;
      let totalConflicted = 0;
      let totalErrors = 0;
      let sitesWithFiles = 0;

      for (const ctx of matchedSites) {
        const contentFolderPrefix = ctx.contentRootName;
        const siteFiles = Array.from(changedFiles).filter((f) =>
          f.startsWith(`${contentFolderPrefix}/`),
        );

        if (siteFiles.length === 0) {
          logForSite(
            ctx,
            "WEBHOOK",
            `Push ${commitSha?.slice(0, 7)} by ${person}: no ${contentFolderPrefix} files changed — nothing to pull for this site.`,
            person,
            {
              ...basePushMeta,
              reason: "push_no_site_files",
              filesChanged: 0,
              pathsSample: [],
            },
          );
          continue;
        }

        sitesWithFiles++;
        logForSite(
          ctx,
          "WEBHOOK",
          `Push ${commitSha?.slice(0, 7)} by ${person}: ${siteFiles.length} file(s) under ${contentFolderPrefix} changed.`,
          person,
          {
            ...basePushMeta,
            filesChanged: siteFiles.length,
            pathsSample: pathsSampleFrom(siteFiles),
          },
        );

        if (!isAutoPullEnabled) {
          logForSite(
            ctx,
            "AUTO-PULL",
            `Skipped webhook pull — GITHUB_AUTO_PULL_ENABLED not set to 'true'`,
          );
          continue;
        }

        const result = await autoPullNonConflicting(siteFiles, commitSha, {
          contentRoot: contentFolderPrefix,
          repoUrl: pushRepoUrl || undefined,
        });

        totalPulled += result.pulled.length;
        totalConflicted += result.conflicted.length;
        totalErrors += result.errors.length;

        if (result.pulled.length > 0) {
          logForSite(
            ctx,
            "AUTO-PULL",
            `Webhook: pulled ${result.pulled.length} files from ${commitSha?.slice(0, 7)}: ${result.pulled.map((f) => f.replace(`${contentFolderPrefix}/`, "")).join(", ")}`,
          );
        }
        if (result.conflicted.length > 0) {
          logForSite(
            ctx,
            "CONFLICT",
            `Webhook: ${result.conflicted.length} files have local edits: ${result.conflicted.map((f) => f.replace(`${contentFolderPrefix}/`, "")).join(", ")}`,
          );
        }
        if (result.errors.length > 0) {
          logForSite(ctx, "ERROR", `Webhook pull errors: ${result.errors.join("; ")}`);
        }
      }

      if (sitesWithFiles === 0) {
        res.json({ ok: true, message: "No site content-folder files changed" });
        return;
      }

      if (!isAutoPullEnabled) {
        res.json({ ok: true, message: "Auto-pull disabled" });
        return;
      }

      res.json({
        ok: true,
        pulled: totalPulled,
        conflicted: totalConflicted,
        errors: totalErrors,
        sites: sitesWithFiles,
      });
    } catch (error) {
      const { logSync: _logSyncErr } = await import("../sync-log");
      _logSyncErr(
        "ERROR",
        `Webhook handler error: ${error instanceof Error ? error.message : String(error)}`,
      );
      log.error({ err: error }, "[Webhook] Error handling webhook:");
      res.status(500).json({ error: "Internal server error" });
    }
  });

  // Get the full sync log text
  app.get("/api/github/sync-log", async (_req, res) => {
    try {
      const { getSyncLogForResponse } = await import("../sync-log");
      const sl = getSyncLogForResponse(res);
      await sl.load();
      const entries = sl.getEntries();
      res.json({ entries });
      return;
    } catch (error) {
      res.status(500).json({ error: "Error reading sync log" });
    }
  });

  app.get("/api/github/sync-log-text", async (_req, res) => {
    try {
      const { getSyncLogForResponse } = await import("../sync-log");
      const sl = getSyncLogForResponse(res);
      await sl.load();
      const text = sl.getText();
      res.type("text/plain").send(text);
    } catch (error) {
      res.status(500).send("Error reading sync log");
    }
  });

  app.delete("/api/github/sync-log", async (req, res) => {
    try {
      const { getSyncLogForResponse } = await import("../sync-log");
      const sl = getSyncLogForResponse(res);
      const mode = req.query.mode as string | undefined;
      if (mode === "2days") {
        await sl.clearOlderThan(Date.now() - 2 * 24 * 60 * 60 * 1000);
      } else {
        await sl.clear();
      }
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ error: "Error clearing sync log" });
    }
  });

  app.get("/api/git/file-history", (req, res) => {
    try {
      const exec = _execSync;
      const filePath = req.query.file as string;
      const limit = Math.min(parseInt(String(req.query.limit || "20"), 10) || 20, 50);
      if (!filePath || typeof filePath !== "string") {
        res.status(400).json({ error: "file query param required" });
        return;
      }
      if (/[;&|`$<>]/.test(filePath)) {
        res.status(400).json({ error: "Invalid file path" });
        return;
      }
      let raw: string;
      try {
        raw = exec(
          `git log --follow --pretty=format:"%H|%aI|%an|%s" -n ${limit} -- "${filePath}"`,
          { encoding: "utf-8", cwd: process.cwd() }
        ) as string;
      } catch {
        res.json({ entries: [] });
        return;
      }
      const entries = raw
        .split("\n")
        .filter(l => l.trim())
        .map(line => {
          const idx1 = line.indexOf("|");
          const idx2 = line.indexOf("|", idx1 + 1);
          const idx3 = line.indexOf("|", idx2 + 1);
          return {
            sha: line.slice(0, idx1),
            date: line.slice(idx1 + 1, idx2),
            author: line.slice(idx2 + 1, idx3),
            subject: line.slice(idx3 + 1),
          };
        });
      res.json({ entries });
    } catch (err) {
      res.status(500).json({ error: String(err) });
    }
  });

  app.get("/api/git/file-at", (req, res) => {
    try {
      const exec = _execSync;
      const filePath = req.query.file as string;
      const sha = req.query.sha as string;
      if (!filePath || !sha) {
        res.status(400).json({ error: "file and sha query params required" });
        return;
      }
      if (!/^[a-f0-9]{7,40}$/.test(sha)) {
        res.status(400).json({ error: "Invalid SHA format" });
        return;
      }
      if (/[;&|`$<>]/.test(filePath)) {
        res.status(400).json({ error: "Invalid file path" });
        return;
      }
      let content: string;
      try {
        content = exec(`git show "${sha}:${filePath}"`, {
          encoding: "utf-8",
          cwd: process.cwd(),
        }) as string;
      } catch {
        res.status(404).json({ error: "File not found at that revision" });
        return;
      }
      res.type("text/plain").send(content);
    } catch (err) {
      res.status(500).json({ error: String(err) });
    }
  });

  app.get("/api/git/folder-history", (req, res) => {
    try {
      const exec = _execSync;
      const folder = req.query.folder as string;
      const limit = Math.min(parseInt(String(req.query.limit || "30"), 10) || 30, 50);
      if (!folder || typeof folder !== "string") {
        res.status(400).json({ error: "folder query param required" });
        return;
      }
      if (/[;&|`$<>]/.test(folder)) {
        res.status(400).json({ error: "Invalid folder path" });
        return;
      }
      let raw: string;
      try {
        raw = exec(
          `git log --pretty=format:"%H|%aI|%an|%s" -n ${limit} -- "${folder}"`,
          { encoding: "utf-8", cwd: process.cwd() }
        ) as string;
      } catch {
        res.json({ entries: [], repoUrl: null });
        return;
      }
      const entries = raw
        .split("\n")
        .filter(l => l.trim())
        .map(line => {
          const idx1 = line.indexOf("|");
          const idx2 = line.indexOf("|", idx1 + 1);
          const idx3 = line.indexOf("|", idx2 + 1);
          return {
            sha: line.slice(0, idx1),
            date: line.slice(idx1 + 1, idx2),
            author: line.slice(idx2 + 1, idx3),
            subject: line.slice(idx3 + 1),
          };
        });
      const repoUrl = (process.env.GITHUB_REPO_URL || "").replace(/\.git$/, "") || null;
      res.json({ entries, repoUrl });
    } catch (err) {
      res.status(500).json({ error: String(err) });
    }
  });

  app.post("/api/git/restore-folder", async (req, res) => {
    try {
      const exec = _execSync;
      const { folder, sha } = req.body;
      if (!folder || !sha) {
        res.status(400).json({ error: "folder and sha are required" });
        return;
      }
      if (!/^[a-f0-9]{7,40}$/.test(sha)) {
        res.status(400).json({ error: "Invalid SHA format" });
        return;
      }
      if (/[;&|`$<>]/.test(folder)) {
        res.status(400).json({ error: "Invalid folder path" });
        return;
      }
      const fs = await import("fs");
      const path = await import("path");

      // List files that existed in the folder at the given SHA
      let lsOutput: string;
      try {
        lsOutput = exec(
          `git ls-tree -r --name-only "${sha}" -- "${folder}"`,
          { encoding: "utf-8", cwd: process.cwd() }
        ) as string;
      } catch {
        res.status(400).json({ error: "Could not list files at that commit" });
        return;
      }
      const filesAtSha = lsOutput.split("\n").filter(l => l.trim());
      if (filesAtSha.length === 0) {
        res.status(400).json({ error: "No files found in folder at that commit" });
        return;
      }

      // Collect current files in the folder
      const getAllFiles = (dir: string, base: string): string[] => {
        const items: string[] = [];
        if (!fs.default.existsSync(dir)) return items;
        for (const entry of fs.default.readdirSync(dir)) {
          const full = path.default.join(dir, entry);
          const rel = path.default.join(base, entry).replace(/\\/g, "/");
          if (fs.default.statSync(full).isDirectory()) {
            items.push(...getAllFiles(full, rel));
          } else {
            items.push(rel);
          }
        }
        return items;
      };
      const currentFiles = getAllFiles(
        path.default.join(process.cwd(), folder),
        folder
      );

      // Write each file from the historical SHA
      for (const filePath of filesAtSha) {
        const content = exec(
          `git show "${sha}:${filePath}"`,
          { encoding: "buffer", cwd: process.cwd() }
        ) as Buffer;
        const absPath = path.default.join(process.cwd(), filePath);
        fs.default.mkdirSync(path.default.dirname(absPath), { recursive: true });
        fs.default.writeFileSync(absPath, content);
      }

      // Remove files that exist locally but were not present at that SHA
      const filesAtShaSet = new Set(filesAtSha);
      for (const currentFile of currentFiles) {
        if (!filesAtShaSet.has(currentFile)) {
          try { fs.default.unlinkSync(path.default.join(process.cwd(), currentFile)); } catch {}
        }
      }

      // Commit the restore
      const { commitAndPush } = await import("../github");
      const result = await commitAndPush(
        `Restore: ${folder} to ${sha.slice(0, 7)}`,
        { force: false }
      );
      if (!result.success) {
        res.status(500).json({ error: result.error || "Commit failed" });
        return;
      }
      res.json({ success: true, commitHash: result.commitHash });
    } catch (err) {
      res.status(500).json({ error: String(err) });
    }
  });

  // Get structured sync info (webhook status, instance, recent log entries)
  app.get("/api/github/sync-info", async (_req, res) => {
    try {
      const {
        getSyncLogForResponse,
        getInstanceId,
        getReplitCheckpoint,
        getGithubCommit,
      } = await import("../sync-log");
      const { getWebhookInfo } = await import("../sync-state");
      const site = res.locals.site as { contentRootName?: string; config?: { githubRepoUrl?: string } } | undefined;
      const webhookInfo = getWebhookInfo(site?.contentRootName);
      const sl = getSyncLogForResponse(res);
      await sl.load();

      const repoUrl = (site?.config?.githubRepoUrl || process.env.GITHUB_REPO_URL || "").replace(/\.git$/, "");
      res.json({
        instanceId: getInstanceId(),
        replitCheckpoint: getReplitCheckpoint(),
        githubCommit: getGithubCommit(),
        repoUrl: repoUrl || null,
        env: process.env.NODE_ENV || "development",
        pid: process.pid,
        webhook: webhookInfo
          ? {
              active: true,
              id: webhookInfo.webhookId,
              url: webhookInfo.webhookUrl,
              createdAt: webhookInfo.createdAt,
            }
          : { active: false },
        recentLog: sl.getRecent(20).map((e) => `${e.ts} [${e.category}] ${e.message}`),
      });
    } catch (error) {
      res.status(500).json({ error: "Error reading sync info" });
    }
  });

  app.post("/api/github/webhook/setup", async (_req, res) => {
    try {
      const { ensureWebhook, getWebhookSetupSkipReason } = await import("../github");
      const skipReason = getWebhookSetupSkipReason();
      if (skipReason) {
        return res.json({
          success: false,
          skipped: true,
          message: `Skipped webhook setup: ${skipReason}`,
        });
      }
      const site = res.locals.site as
        | { contentRootName?: string; config?: { githubRepoUrl?: string } }
        | undefined;
      await ensureWebhook({
        repoUrl: site?.config?.githubRepoUrl,
        contentRoot: site?.contentRootName,
      });
      const { getWebhookInfo } = await import("../sync-state");
      const info = getWebhookInfo(site?.contentRootName);
      if (info) {
        res.json({
          success: true,
          message: `Webhook #${info.webhookId} is active at ${info.webhookUrl}`,
        });
      } else {
        res
          .status(500)
          .json({
            success: false,
            message:
              "Webhook setup ran but no webhook was registered. Check that your GitHub token has the admin:repo_hook scope.",
          });
      }
    } catch (error: any) {
      res
        .status(500)
        .json({
          success: false,
          message: error.message || "Webhook setup failed",
        });
    }
  });

  // Force-delete all hooks for this app URL, then register a fresh one (new HMAC secret).
  app.post("/api/github/webhook/reset", async (_req, res) => {
    try {
      const { forceResetWebhook, getWebhookSetupSkipReason } = await import("../github");
      const skipReason = getWebhookSetupSkipReason();
      if (skipReason) {
        return res.json({
          success: false,
          skipped: true,
          message: `Skipped webhook reset: ${skipReason}`,
          deletedIds: [],
        });
      }
      const site = res.locals.site as
        | { contentRootName?: string; config?: { githubRepoUrl?: string } }
        | undefined;
      const result = await forceResetWebhook({
        repoUrl: site?.config?.githubRepoUrl,
        contentRoot: site?.contentRootName,
      });
      res.status(result.success ? 200 : 500).json(result);
    } catch (error: any) {
      res.status(500).json({
        success: false,
        message: error.message || "Webhook reset failed",
        deletedIds: [],
      });
    }
  });

  app.delete("/api/github/webhook/duplicates", async (_req, res) => {
    try {
      const site = res.locals.site as
        | { contentRootName?: string; config?: { githubRepoUrl?: string } }
        | undefined;
      const { getWebhookInfo } = await import("../sync-state");
      const info = getWebhookInfo(site?.contentRootName);
      if (!info) {
        return res
          .status(400)
          .json({
            success: false,
            message: "No active webhook registered — nothing to clean up.",
          });
      }
      const { cleanupDuplicateWebhooks, getGitHubConfig } = await import(
        "../github"
      );
      const config = getGitHubConfig(site?.config?.githubRepoUrl);
      if (!config) {
        return res
          .status(400)
          .json({ success: false, message: "GitHub not configured." });
      }
      const deleted = await cleanupDuplicateWebhooks(
        config,
        info.webhookId,
        info.webhookUrl,
      );
      res.json({ success: true, deleted: deleted.length, ids: deleted });
    } catch (error: any) {
      res
        .status(500)
        .json({ success: false, message: error.message || "Cleanup failed" });
    }
  });

  // Get all sync changes (local and incoming) for the active site
  app.get("/api/github/pending-changes", async (req, res) => {
    try {
      const site = res.locals.site as {
        contentRootName?: string;
        config?: { githubRepoUrl?: string };
      } | undefined;
      const { getAllSyncChanges } = await import("../github");
      const changes = await getAllSyncChanges(site?.contentRootName, {
        repoUrl: site?.config?.githubRepoUrl,
      });
      res.json({ changes, count: changes.length });
    } catch (error) {
      log.error({ err: error }, "Error getting sync changes:");
      res.status(500).json({ error: "Failed to get sync changes" });
    }
  });

  // Zip local commit-queue files for backup (does not call GitHub).
  app.post("/api/github/pending-changes/zip", async (req, res) => {
    try {
      const auth = await requireStaffSession(req, res);
      if (!auth.authorized) return;

      const site = res.locals.site as { contentRootName?: string } | undefined;
      const contentRoot = site?.contentRootName;
      if (!contentRoot) {
        res.status(400).json({ error: "No active site content root" });
        return;
      }

      const files = Array.isArray(req.body?.files)
        ? req.body.files.filter((f: unknown): f is string => typeof f === "string" && f.trim().length > 0)
        : undefined;

      const { buildQueueBackupZip } = await import("../pending-changes-zip");
      const result = buildQueueBackupZip({ files, contentRoot });
      if (!result.ok) {
        res.status(result.status).json({ error: result.error });
        return;
      }

      const filename = result.filename.replace(/["\r\n]/g, "");
      res.setHeader("Content-Type", "application/zip");
      res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
      res.send(result.buffer);
    } catch (error) {
      log.error({ err: error }, "Error building queue backup zip:");
      res.status(500).json({ error: "Failed to build queue backup zip" });
    }
  });

  // Stream a zip of the whole site content folder (does not call GitHub).
  app.get("/api/github/site-archive", async (req, res) => {
    try {
      const auth = await requireStaffSession(req, res);
      if (!auth.authorized) return;

      const site = res.locals.site as { contentRootName?: string } | undefined;
      const contentRoot = site?.contentRootName;
      if (!contentRoot) {
        res.status(400).json({ error: "No active site content root" });
        return;
      }

      const { siteArchiveFilename, streamSiteArchiveZip } = await import("../site-archive");
      const filename = siteArchiveFilename(contentRoot).replace(/["\r\n]/g, "");
      res.setHeader("Content-Type", "application/zip");
      res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
      res.setHeader("Cache-Control", "no-store");
      req.socket.setTimeout(0);

      const result = await streamSiteArchiveZip({ contentRoot, out: res });
      log.info({ files: result.files, filename: result.filename }, "Streamed site archive zip");
      res.end();
    } catch (error) {
      log.error({ err: error }, "Error streaming site archive zip:");
      if (res.headersSent) {
        res.end();
        return;
      }
      res.status(500).json({ error: "Failed to stream site archive zip" });
    }
  });

  // Commit and push pending changes to GitHub
  app.post("/api/github/commit", async (req, res) => {
    try {
      const { message, force, author, files, queue } = req.body;
      if (
        !message ||
        typeof message !== "string" ||
        message.trim().length === 0
      ) {
        res.status(400).json({ error: "Commit message is required" });
        return;
      }

      const authorName =
        author && typeof author === "string" && author.trim()
          ? author.trim()
          : undefined;

      // Resolve acting username: MCP x-mcp-author / body author, or staff session
      let actingUsername = authorName || null;
      {
        const authHeader = req.headers.authorization || "";
        const bearer = authHeader.startsWith("Bearer ")
          ? authHeader.slice(7).trim()
          : "";
        const mcpSecret =
          process.env.MCP_SERVER_SECRET || process.env.MCP_API_KEY || "";
        if (bearer && mcpSecret && bearer === mcpSecret) {
          const mcpAuthor = req.headers["x-mcp-author"];
          if (typeof mcpAuthor === "string" && mcpAuthor.trim()) {
            actingUsername = mcpAuthor.trim();
          } else if (authorName) {
            actingUsername = authorName;
          }
        } else {
          const staff = await requireStaffSession(req, res);
          if (!staff.authorized) return;
          actingUsername = staff.username || authorName || null;
        }
      }

      const {
        resolveCommitGitHubToken,
        GitHubConnectError,
      } = await import("../github-user-tokens");

      let resolved;
      try {
        resolved = await resolveCommitGitHubToken({
          username: actingUsername,
          purpose: "user_commit",
        });
      } catch (err) {
        if (err instanceof GitHubConnectError) {
          const status =
            err.code === "github_connect_required" ? 403 : 401;
          res.status(status).json({
            success: false,
            error: err.message,
            code: err.code,
          });
          return;
        }
        throw err;
      }

      const commitAuthor =
        resolved.githubName || resolved.githubLogin
          ? {
              name: resolved.githubName || resolved.githubLogin!,
              email:
                resolved.githubEmail ||
                `${resolved.githubLogin}@users.noreply.github.com`,
            }
          : undefined;

      // Queue mode: markFileAsModified then auto-commit queue, or one tree commit
      // when auto-commit is off. Used by MCP so multi-file writes never parallel
      // Contents API PUTs (GitHub 409). DebugBubble per-file still uses commit-file.
      if (queue === true) {
        const { getSyncLogForResponse } = await import("../sync-log");
        const { queueOrCommitFiles } = await import("../github-commit-queue");
        const site = res.locals.site as {
          contentRootName?: string;
          config?: { githubRepoUrl?: string };
        } | undefined;
        const result = await queueOrCommitFiles({
          files: Array.isArray(files) ? files : undefined,
          message: message.trim(),
          author: authorName || actingUsername || undefined,
          force: !!force,
          contentRoot: site?.contentRootName,
          repoUrl: site?.config?.githubRepoUrl,
          token: resolved.token,
          commitAuthor,
          actor: resolveEventActor(req),
          logEdit: (shortPath, author) => {
            getSyncLogForResponse(res).log("EDIT", `MCP queued edit: ${shortPath}`, author);
          },
        });
        if (result.status === 202) {
          res.status(202).json({ queued: true, files: result.files, author: result.author });
          return;
        }
        if (result.status === 200) {
          res.json({ success: true, commitHash: result.commitHash });
          return;
        }
        if (result.status === 403) {
          res.status(403).json({
            success: false,
            error: result.error,
            code: result.errorCode,
          });
          return;
        }
        res.status(400).json({ success: false, error: result.error });
        return;
      }

      // Direct-commit mode (existing path — used by DebugBubble / manual CMS commits)
      let finalMessage = message.trim();
      if (authorName || actingUsername) {
        finalMessage = `[Author: ${authorName || actingUsername}] ${finalMessage}`;
      }

      const { commitAndPush } = await import("../github");
      const site = res.locals.site as any;
      const result = await commitAndPush(finalMessage, {
        force: !!force,
        files: Array.isArray(files) ? files : undefined,
        repoUrl: site?.config?.githubRepoUrl,
        contentRoot: site?.contentRootName,
        token: resolved.token,
        commitAuthor,
      });

      if (result.success) {
        res.json({ success: true, commitHash: result.commitHash });
      } else {
        res.status(400).json({ success: false, error: result.error });
      }
    } catch (error) {
      log.error({ err: error }, "Error committing to GitHub:");
      res.status(500).json({ error: "Failed to commit changes" });
    }
  });

  // Get conflict information (missed commits from remote)
  app.get("/api/github/conflict-info", async (req, res) => {
    try {
      const site = res.locals.site as { contentRootName?: string; config?: { githubRepoUrl?: string } } | undefined;
      const { getConflictInfo } = await import("../github");
      const conflictInfo = await getConflictInfo({
        repoUrl: site?.config?.githubRepoUrl,
        contentRoot: site?.contentRootName,
      });
      res.json(conflictInfo);
    } catch (error) {
      log.error({ err: error }, "Error getting conflict info:");
      res.status(500).json({ error: "Failed to get conflict info" });
    }
  });

  // Sync local state with remote (accept remote changes)
  app.post("/api/github/sync", async (req, res) => {
    try {
      const site = res.locals.site as {
        contentRootName?: string;
        config?: { githubRepoUrl?: string };
      } | undefined;
      const { syncWithRemote } = await import("../github");
      const result = await syncWithRemote({
        repoUrl: site?.config?.githubRepoUrl,
        contentRoot: site?.contentRootName,
      });

      if (result.success) {
        res.json({ success: true });
      } else {
        res.status(400).json({ success: false, error: result.error });
      }
    } catch (error) {
      log.error({ err: error }, "Error syncing with remote:");
      res.status(500).json({ error: "Failed to sync with remote" });
    }
  });

  // Check for pull conflicts (files changed both locally and remotely)
  app.get("/api/github/pull-conflicts", async (req, res) => {
    try {
      const site = res.locals.site as {
        contentRootName?: string;
        config?: { githubRepoUrl?: string };
      } | undefined;
      if (!site?.contentRootName) {
        res.status(400).json({
          error: "contentRoot is required — site could not be resolved for this request",
        });
        return;
      }
      const { checkPullConflicts } = await import("../github");
      const result = await checkPullConflicts({
        repoUrl: site.config?.githubRepoUrl,
        contentRoot: site.contentRootName,
      });
      res.json(result);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to check pull conflicts";
      if (message.includes("contentRoot is required")) {
        res.status(400).json({ error: message });
        return;
      }
      log.error({ err: error }, "Error checking pull conflicts:");
      res.status(500).json({ error: "Failed to check pull conflicts" });
    }
  });

  // Get status for a single file (local vs remote)
  app.get("/api/github/file-status", async (req, res) => {
    try {
      const filePath = req.query.file as string;
      if (!filePath) {
        res.status(400).json({ error: "Missing file parameter" });
        return;
      }
      const { getRemoteFileStatus } = await import("../github");
      const status = await getRemoteFileStatus(filePath);
      res.json(status);
    } catch (error) {
      log.error({ err: error }, "Error getting file status:");
      res.status(500).json({ error: "Failed to get file status" });
    }
  });

  // Commit a single file to remote
  app.post("/api/github/commit-file", async (req, res) => {
    try {
      const { filePath, message, author } = req.body;
      if (!filePath || !message) {
        res.status(400).json({ error: "Missing filePath or message" });
        return;
      }

      const staff = await requireStaffSession(req, res);
      if (!staff.authorized) return;

      const actingUsername =
        (author && typeof author === "string" && author.trim()) ||
        staff.username ||
        null;

      const {
        resolveCommitGitHubToken,
        GitHubConnectError,
      } = await import("../github-user-tokens");

      let resolved;
      try {
        resolved = await resolveCommitGitHubToken({
          username: actingUsername,
          purpose: "user_commit",
        });
      } catch (err) {
        if (err instanceof GitHubConnectError) {
          res
            .status(err.code === "github_connect_required" ? 403 : 401)
            .json({
              success: false,
              error: err.message,
              code: err.code,
            });
          return;
        }
        throw err;
      }

      const site = res.locals.site as {
        contentRootName?: string;
        config?: { githubRepoUrl?: string };
      } | undefined;
      const { commitSingleFile } = await import("../github");
      const result = await commitSingleFile({
        filePath,
        message,
        author: actingUsername || undefined,
        repoUrl: site?.config?.githubRepoUrl,
        contentRoot: site?.contentRootName,
        token: resolved.token,
        commitAuthor:
          resolved.githubName || resolved.githubLogin
            ? {
                name: resolved.githubName || resolved.githubLogin!,
                email:
                  resolved.githubEmail ||
                  `${resolved.githubLogin}@users.noreply.github.com`,
              }
            : undefined,
      });

      if (result.success) {
        res.json({ success: true, commitSha: result.commitSha });
      } else {
        res.status(400).json({ success: false, error: result.error });
      }
    } catch (error) {
      log.error({ err: error }, "Error committing file:");
      res.status(500).json({ error: "Failed to commit file" });
    }
  });

  // Pull a single file from remote
  app.post("/api/github/pull-file", async (req, res) => {
    try {
      const { filePath } = req.body;
      if (!filePath) {
        res.status(400).json({ error: "Missing filePath" });
        return;
      }
      const site = res.locals.site as {
        contentRootName?: string;
        config?: { githubRepoUrl?: string };
      } | undefined;
      const { pullSingleFile } = await import("../github");
      const result = await pullSingleFile(filePath, {
        repoUrl: site?.config?.githubRepoUrl,
        contentRoot: site?.contentRootName,
      });

      if (result.success) {
        res.json({ success: true });
      } else {
        res.status(400).json({ success: false, error: result.error });
      }
    } catch (error) {
      log.error({ err: error }, "Error pulling file:");
      res.status(500).json({ error: "Failed to pull file" });
    }
  });

  // Sync local state with remote (update lastSyncedCommit to current remote HEAD)
  app.post("/api/github/sync-with-remote", async (req, res) => {
    try {
      const site = res.locals.site as {
        contentRootName?: string;
        config?: { githubRepoUrl?: string };
      } | undefined;
      const { syncWithRemote } = await import("../github");
      const result = await syncWithRemote({
        repoUrl: site?.config?.githubRepoUrl,
        contentRoot: site?.contentRootName,
      });

      if (result.success) {
        res.json({ success: true });
      } else {
        res.status(400).json({ success: false, error: result.error });
      }
    } catch (error) {
      log.error({ err: error }, "Error syncing with remote:");
      res.status(500).json({ error: "Failed to sync with remote" });
    }
  });

  app.get("/api/github/auto-commit/status", async (_req, res) => {
    try {
      const { getAutoCommitStatus } = await import("../auto-commit");
      res.json(getAutoCommitStatus());
    } catch (error) {
      log.error({ err: error }, "Error getting auto-commit status:");
      res.status(500).json({ error: "Failed to get auto-commit status" });
    }
  });

  app.post("/api/github/auto-commit/flush", async (_req, res) => {
    try {
      const { flushPendingChanges } = await import("../auto-commit");
      const result = await flushPendingChanges();
      res.json(result);
    } catch (error) {
      log.error({ err: error }, "Error flushing auto-commit:");
      res.status(500).json({ error: "Failed to flush pending changes" });
    }
  });

  app.post("/api/github/auto-commit/config", async (req, res) => {
    try {
      const { commitIntervalSeconds } = req.body;
      if (
        typeof commitIntervalSeconds === "number" &&
        commitIntervalSeconds >= 1
      ) {
        const { updateSyncConfig } = await import("../sync-state");
        updateSyncConfig({ commitIntervalSeconds });
        res.json({ success: true, commitIntervalSeconds });
      } else {
        res
          .status(400)
          .json({ error: "commitIntervalSeconds must be a number >= 1" });
      }
    } catch (error) {
      log.error({ err: error }, "Error updating auto-commit config:");
      res.status(500).json({ error: "Failed to update auto-commit config" });
    }
  });

  app.get("/api/github/auto-commit/conflicts", async (_req, res) => {
    try {
      const { getConflictedFiles } = await import("../auto-commit");
      res.json({ conflicts: getConflictedFiles() });
    } catch (error) {
      log.error({ err: error }, "Error getting conflicts:");
      res.status(500).json({ error: "Failed to get conflicts" });
    }
  });

  app.post("/api/github/auto-commit/clear-conflict", async (req, res) => {
    try {
      const { filePath } = req.body;
      if (!filePath) {
        res.status(400).json({ error: "filePath is required" });
        return;
      }
      const { clearConflict } = await import("../auto-commit");
      const cleared = clearConflict(filePath);
      res.json({ success: cleared });
    } catch (error) {
      log.error({ err: error }, "Error clearing conflict:");
      res.status(500).json({ error: "Failed to clear conflict" });
    }
  });

  // Get live bootstrap progress state (no auth required — state is read-only)
  app.get("/api/github/bootstrap-status", async (_req, res) => {
    const site = res.locals.site as { contentRootName?: string; contentRoot?: string } | undefined;
    const contentRoot = site?.contentRootName ?? site?.contentRoot;
    const { getBootstrapState } = await import("../github");
    res.json(getBootstrapState(contentRoot));
  });

  // Trigger a content pull from the remote (hash-diff by default; only missing/changed files)
  app.post("/api/github/content/bootstrap", async (req, res) => {
    try {
      const site = res.locals.site as { contentRoot?: string; contentRootName?: string; config?: { githubRepoUrl?: string } } | undefined;
      const force = req.body?.force === true;
      const { bootstrapContentFromRemote } = await import("../github");
      const result = await bootstrapContentFromRemote({
        repoUrl: site?.config?.githubRepoUrl,
        contentRoot: site?.contentRootName ?? site?.contentRoot,
        force,
      });
      if (result.success) {
        res.json({ success: true, pulled: result.pulled, skipped: result.skipped, errors: result.errors, commitSha: result.commitSha });
      } else {
        res.status(500).json({ success: false, pulled: result.pulled, skipped: result.skipped, errors: result.errors, commitSha: result.commitSha });
      }
    } catch (error) {
      log.error({ err: error }, "Error running bootstrap pull:");
      res.status(500).json({ error: "Bootstrap pull failed" });
    }
  });

  // Push all local content files to the remote content repo (seed operation)
  // Returns immediately with { runId } — poll /api/github/push-all-status for progress.
  app.post("/api/github/content/push-all", async (_req, res) => {
    // If a push is already running, return the active run rather than starting another
    if (currentPushAllRun?.running) {
      return res.json({ runId: currentPushAllRun.runId, alreadyRunning: true });
    }

    const site = res.locals.site as any;
    const run = createPushAllRun(site?.config?.githubRepoUrl);

    // Fire-and-forget
    (async () => {
      try {
        const { pushAllContentToRemote } = await import("../github");
        await pushAllContentToRemote({
          contentRoot: site?.contentRoot,
          repoUrl: site?.config?.githubRepoUrl,
          onProgress: (event) => applyPushAllProgress(run, event),
        });
      } catch (error) {
        run.running = false;
        run.phase = "done";
        run.errors = [error instanceof Error ? error.message : "Push-all failed unexpectedly"];
        run.failed = 1;
        run.completedAt = Date.now();
        log.error({ err: error }, "Error running push-all:");
      }
    })();

    res.json({ runId: run.runId });
  });

  // Get the current (or most recent) push-all run state for polling
  app.get("/api/github/push-all-status", (_req, res) => {
    if (!currentPushAllRun) {
      return res.status(404).json({ error: "No push-all run has started yet" });
    }
    res.json(currentPushAllRun);
  });

  // Pull remote content files to local.
  // Body: { force?: boolean } — force=true re-downloads all; default is hash-diff (skip matching SHAs).
  // Returns immediately with { ok: true } — poll /api/github/pull-all-status for progress.
  // Config errors fail fast (400) so the UI does not enter a progress/polling loop.
  app.post("/api/github/content/pull-all", async (req, res) => {
    const site = res.locals.site as { contentRoot?: string; contentRootName?: string; config?: { githubRepoUrl?: string } } | undefined;
    const { getBootstrapState, getGitHubConfig } = await import("../github");
    const force = req.body?.force === true;
    const repoUrl = site?.config?.githubRepoUrl;
    const contentRoot = site?.contentRootName ?? site?.contentRoot;
    if (getBootstrapState(contentRoot).running) {
      return res.json({ ok: true, alreadyRunning: true });
    }

    const config = getGitHubConfig(repoUrl);
    if (!config) {
      const error =
        "GitHub not configured (missing GITHUB_TOKEN or repo URL). " +
        "Set GITHUB_REPO_URL or github_repo_url on the site in sites.yml.";
      log.error(
        { repoUrl: repoUrl || process.env.GITHUB_REPO_URL || null, hasToken: !!process.env.GITHUB_TOKEN },
        `Force pull-all rejected: ${error}`,
      );
      return res.status(400).json({ ok: false, error });
    }

    log.info(
      {
        repoUrl: repoUrl || process.env.GITHUB_REPO_URL || null,
        contentRoot: contentRoot || null,
        owner: config.owner,
        repo: config.repo,
        force,
      },
      force ? "Starting force pull-all from GitHub" : "Starting partial (hash-diff) pull from GitHub",
    );

    // Fire-and-forget
    (async () => {
      try {
        const { bootstrapContentFromRemote } = await import("../github");
        const result = await bootstrapContentFromRemote({ repoUrl, contentRoot, force });
        if (result.cancelled) {
          log.info(
            { pulled: result.pulled, skipped: result.skipped, commitSha: result.commitSha, force },
            "Pull-all cancelled by user",
          );
        } else if (!result.success) {
          log.error(
            { errors: result.errors, repoUrl: repoUrl || null, contentRoot: contentRoot || null, force },
            "Pull-all finished with errors",
          );
        } else {
          log.info(
            { pulled: result.pulled, skipped: result.skipped, commitSha: result.commitSha, force },
            "Pull-all completed successfully",
          );
        }
      } catch (error) {
        log.error({ err: error }, "Error running pull-all:");
      }
    })();

    res.json({ ok: true });
  });

  // Cooperative cancel of an in-progress pull-all / bootstrap for the current site.
  app.post("/api/github/content/pull-all/cancel", async (_req, res) => {
    const site = res.locals.site as { contentRootName?: string; contentRoot?: string } | undefined;
    const contentRoot = site?.contentRootName ?? site?.contentRoot;
    const { requestBootstrapCancel } = await import("../github");
    const result = requestBootstrapCancel(contentRoot);
    if (result.ok) {
      log.info({ contentRoot: contentRoot || null }, "Pull-all cancel requested");
    }
    res.json(result);
  });

  // Get the live pull-all (bootstrap) progress state for polling
  app.get("/api/github/pull-all-status", async (_req, res) => {
    const site = res.locals.site as { contentRootName?: string; contentRoot?: string } | undefined;
    const contentRoot = site?.contentRootName ?? site?.contentRoot;
    const { getBootstrapState } = await import("../github");
    const state = getBootstrapState(contentRoot);
    if (state.startedAt === null) {
      return res.status(404).json({ error: "No pull-all run has started yet" });
    }
    res.json(state);
  });

  // Get available variants for a content type and slug (reads versioning.yml)
}
