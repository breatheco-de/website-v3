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
import { allowedToolNames } from "@shared/mcp-tool-catalog";


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
} from "./_helpers";
import { child } from "../logger";
import { getAuthSettings, isSignupConfigured } from "../settings";
import { getDefaultContentRoot } from "../site-config";
const log = child({ module: "routes/auth" });

function getAuthContentRoot(res: Response): string {
  return (res.locals.site as any)?.contentRoot ?? getDefaultContentRoot();
}

/** Resolve a configured path (relative to host) or absolute URL against the auth host. */
function resolveAuthUrl(pathOrUrl: string, host: string): string {
  if (/^https?:\/\//i.test(pathOrUrl)) return pathOrUrl;
  return `${host.replace(/\/$/, "")}${pathOrUrl.startsWith("/") ? "" : "/"}${pathOrUrl}`;
}

export function registerAuthRoutes(app: Express): void {
  app.get("/api/auth/check-capability", async (req, res) => {
    const { cap, contentType, username, role } = req.query as Record<string, string>;

    if (!cap) {
      res.status(400).json({ error: "cap query parameter is required" });
      return;
    }

    const isDevelopment = process.env.NODE_ENV !== "production";
    // Role-scoped checks always evaluate against the role (even in development).
    // Unscoped checks keep the legacy "allow all" behaviour in development.
    if (isDevelopment && !role) {
      res.json({ allowed: true });
      return;
    }

    const authHeader = req.headers.authorization || "";
    const bearerToken = authHeader.replace(/^Bearer\s+/i, "").trim();

    if (!bearerToken) {
      res.status(401).json({ error: "Authorization required" });
      return;
    }

    let resolvedUsername: string | null = username || null;

    // Support both MCP_SERVER_SECRET (new name) and MCP_API_KEY (legacy alias)
    const mcpApiKey = process.env.MCP_SERVER_SECRET || process.env.MCP_API_KEY;
    if (mcpApiKey && bearerToken === mcpApiKey) {
      // Trusted internal call from the MCP server — username must be supplied explicitly
      if (!resolvedUsername) {
        res.status(400).json({ error: "username query parameter required when authenticating with the API key" });
        return;
      }
    } else {
      // Treat bearer as a Breathecode token and validate it
      const profile = await userManager.validateToken(bearerToken);
      if (!profile.valid || !profile.username) {
        res.status(401).json({ error: "Invalid or expired token" });
        return;
      }
      resolvedUsername = profile.username;
    }

    if (role) {
      const roleDef = userStore.getRole(role);
      if (!roleDef) {
        res.status(404).json({ error: `Unknown role '${role}'`, allowed: false });
        return;
      }
      if (!userStore.userHasRole(resolvedUsername, role)) {
        res.status(403).json({
          error: `Forbidden: you are not assigned the role '${role}'`,
          allowed: false,
        });
        return;
      }
      const allowed = userStore.hasCapabilityInRole(
        resolvedUsername,
        role,
        cap as CapabilityName,
        contentType || undefined,
      );
      if (!allowed) {
        const scopeMsg = contentType ? ` for content type '${contentType}'` : "";
        res.status(403).json({
          error: `Forbidden: capability '${cap}' required${scopeMsg} within role '${role}'`,
          allowed: false,
        });
        return;
      }
      res.json({ allowed: true });
      return;
    }

    const allowed = userStore.hasCapability(resolvedUsername, cap as CapabilityName, contentType || undefined);
    if (!allowed) {
      const scopeMsg = contentType ? ` for content type '${contentType}'` : "";
      res.status(403).json({ error: `Forbidden: capability '${cap}' required${scopeMsg}`, allowed: false });
      return;
    }

    res.json({ allowed: true });
  });

  /** Role metadata for OAuth consent (no membership check). Internal secret auth. */
  app.get("/api/auth/mcp-role-info", async (req, res) => {
    const { role } = req.query as Record<string, string>;
    if (!role) {
      res.status(400).json({ error: "role query parameter is required" });
      return;
    }

    const authHeader = req.headers.authorization || "";
    const bearerToken = authHeader.replace(/^Bearer\s+/i, "").trim();
    const mcpApiKey = process.env.MCP_SERVER_SECRET || process.env.MCP_API_KEY;
    const isDevelopment = process.env.NODE_ENV !== "production";
    if (!isDevelopment) {
      if (!mcpApiKey || bearerToken !== mcpApiKey) {
        res.status(401).json({ error: "Authorization required" });
        return;
      }
    }

    const roleDef = userStore.getRole(role);
    if (!roleDef) {
      res.status(404).json({ error: `Unknown role '${role}'` });
      return;
    }

    res.json({
      roleId: role,
      label: roleDef.label,
      description: roleDef.description ?? "",
      capabilities: roleDef.capabilities,
      allowedTools: allowedToolNames(roleDef.capabilities ?? []),
    });
  });

  /** Role-scoped MCP session context: membership + caps. Internal secret auth. */
  app.get("/api/auth/mcp-role-context", async (req, res) => {
    const { username, role } = req.query as Record<string, string>;
    if (!role) {
      res.status(400).json({ error: "role query parameter is required" });
      return;
    }
    if (!username) {
      res.status(400).json({ error: "username query parameter is required" });
      return;
    }

    const authHeader = req.headers.authorization || "";
    const bearerToken = authHeader.replace(/^Bearer\s+/i, "").trim();
    const mcpApiKey = process.env.MCP_SERVER_SECRET || process.env.MCP_API_KEY;
    const isDevelopment = process.env.NODE_ENV !== "production";
    if (!isDevelopment) {
      if (!mcpApiKey || bearerToken !== mcpApiKey) {
        res.status(401).json({ error: "Authorization required" });
        return;
      }
    }

    const roleDef = userStore.getRole(role);
    if (!roleDef) {
      res.status(404).json({ error: `Unknown role '${role}'` });
      return;
    }
    if (!userStore.userHasRole(username, role)) {
      res.status(403).json({
        error: `You are not assigned the role '${role}'. Ask an administrator to assign it before using this connector.`,
      });
      return;
    }

    res.json({
      roleId: role,
      label: roleDef.label,
      description: roleDef.description ?? "",
      capabilities: roleDef.capabilities,
      allowedTools: allowedToolNames(roleDef.capabilities ?? []),
    });
  });

  app.post("/api/debug/validate-token", async (req, res) => {
    try {
      const { token } = req.body;

      if (!token) {
        res.status(400).json({ valid: false, error: "Token required" });
        return;
      }

      const profile = await userManager.validateToken(token);

      if (!profile.valid || !profile.username) {
        res.json({ valid: false, capabilities: [], userName: "", expiresAt: profile.expiresAt ?? null, error: profile.error });
        return;
      }

      // Auto-register user; grant webmaster if no one currently holds the role
      const noWebmasterExists = userStore.isFirstUser();
      const userRecord = userStore.upsertUser({
        username: profile.username,
        firstName: profile.firstName,
        lastName: profile.lastName,
        email: profile.email,
      });
      if (noWebmasterExists) {
        userStore.assignRoles(profile.username, ["webmaster"], profile.email);
        log.info(`[UserStore] Bootstrap: no webmaster existed — "${profile.username}" auto-assigned webmaster role`);
      }

      // Claim any pending pre-registration that matches this user's email
      if (profile.email) {
        const pendingRole = userStore.claimPendingUser(profile.email);
        if (pendingRole) {
          const currentRoles = userStore.getUserRoles(profile.username, profile.email);
          if (!currentRoles.includes(pendingRole)) {
            userStore.assignRoles(profile.username, [...currentRoles, pendingRole], profile.email);
          }
          log.info(`[UserStore] Claimed pending role "${pendingRole}" for user "${profile.username}" via email match`);
        }
      }

      const capabilities = userStore.getEffectiveCapabilities(profile.username, profile.email);
      const roles = userStore.getUserRoles(profile.username, profile.email);
      const userName = profile.username;
      const staffId = userStore.getOrCreateStaffUserId(profile.username, profile.email);

      res.json({
        valid: true,
        capabilities,
        roles,
        userName,
        username: profile.username,
        staffId,
        expiresAt: profile.expiresAt ?? null,
      });
    } catch (error) {
      log.error({ err: error }, "Token validation error:");
      res.json({ valid: false, capabilities: [] });
    }
  });

  // Staff directory for label assignee pickers (any authenticated editor).
  app.get("/api/staff", async (req, res) => {
    const auth = await requireStaffSession(req, res);
    if (!auth.authorized) return;
    res.json({ staff: userStore.getStaffDirectory() });
  });

  // Internal loopback: return identity + roles + capabilities for an authenticated MCP caller.
  // Accepts the same trusted-internal auth pattern as /api/auth/check-capability.
  app.get("/api/auth/user-info", async (req, res) => {
    const { username } = req.query as Record<string, string>;

    const isDevelopment = process.env.NODE_ENV !== "production";
    if (isDevelopment) {
      const devUser = username || "dev.user";
      const devRecord = userStore.getUser(devUser);
      res.json({
        username: devUser,
        firstName: devRecord?.firstName ?? "Dev",
        lastName: devRecord?.lastName ?? "User",
        email: devRecord?.email ?? "dev@localhost",
        roles: devRecord?.roles ?? ["webmaster"],
        capabilities: userStore.getEffectiveCapabilities(devUser),
      });
      return;
    }

    const authHeader = req.headers.authorization || "";
    const bearerToken = authHeader.replace(/^Bearer\s+/i, "").trim();

    if (!bearerToken) {
      res.status(401).json({ error: "Authorization required" });
      return;
    }

    let resolvedUsername: string | null = username || null;

    const mcpApiKey = process.env.MCP_SERVER_SECRET || process.env.MCP_API_KEY;
    if (mcpApiKey && bearerToken === mcpApiKey) {
      if (!resolvedUsername) {
        res.status(400).json({ error: "username query parameter required when authenticating with the API key" });
        return;
      }
    } else {
      const profile = await userManager.validateToken(bearerToken);
      if (!profile.valid || !profile.username) {
        res.status(401).json({ error: "Invalid or expired token" });
        return;
      }
      resolvedUsername = profile.username;
    }

    const record = userStore.getUser(resolvedUsername);
    if (!record) {
      res.status(404).json({ error: `User '${resolvedUsername}' not found` });
      return;
    }

    res.json({
      username: record.username,
      firstName: record.firstName ?? "",
      lastName: record.lastName ?? "",
      email: record.email ?? "",
      roles: record.roles,
      capabilities: userStore.getEffectiveCapabilities(resolvedUsername),
    });
  });

  // Consumer profile — used by signup-aware forms (is_signup) to skip known fields.
  // Reads the profile endpoint from site auth settings (settings.yml `auth`).
  // Unlike /api/auth/user-info, this never touches the staff user-store.
  app.get("/api/auth/profile", async (req, res) => {
    try {
      const authHeader = req.headers.authorization || "";
      const token = authHeader.replace(/^(Token|Bearer)\s+/i, "").trim();
      if (!token) {
        res.status(401).json({ valid: false, error: "Authorization required" });
        return;
      }

      const auth = getAuthSettings(getAuthContentRoot(res));
      const host = auth.host || process.env.VITE_BREATHECODE_HOST || BREATHECODE_HOST;
      const mePath = auth.profile?.path || "/v1/auth/user/me";
      const meMethod = auth.profile?.method || "GET";
      const academy = auth.academy?.trim();

      const meRes = await fetch(resolveAuthUrl(mePath, host), {
        method: meMethod,
        headers: {
          Authorization: `Token ${token}`,
          ...(academy ? { Academy: academy } : {}),
          ...((meMethod === "POST" || meMethod === "PUT")
            ? { "Content-Type": "application/json" }
            : {}),
        },
        ...((meMethod === "POST" || meMethod === "PUT") ? { body: "{}" } : {}),
      });
      if (!meRes.ok) {
        res.json({ valid: false });
        return;
      }
      const me = (await meRes.json()) as {
        id?: number;
        username?: string;
        email?: string;
        first_name?: string;
        last_name?: string;
        phone?: string;
      };
      res.json({
        valid: true,
        id: me.id,
        username: me.username,
        email: me.email ?? "",
        first_name: me.first_name ?? "",
        last_name: me.last_name ?? "",
        phone: me.phone ?? "",
      });
    } catch (error) {
      log.error({ err: error }, "Profile fetch error:");
      res.status(502).json({ valid: false, error: "Failed to fetch profile" });
    }
  });

  // Consumer login proxy — authenticates email/password against the login endpoint
  // from site auth settings (settings.yml `auth.login.path`) and returns the token.
  const consumerLoginHandler = async (req: import("express").Request, res: import("express").Response) => {
    try {
      const { email, password } = (req.body ?? {}) as {
        email?: string;
        password?: string;
      };
      if (!email || !password) {
        res.status(400).json({ error: "Email and password are required" });
        return;
      }

      const auth = getAuthSettings(getAuthContentRoot(res));
      const host = (auth.host || process.env.VITE_BREATHECODE_HOST || BREATHECODE_HOST || "").replace(/\/$/, "");
      if (!host || !/^https?:\/\//i.test(host)) {
        res.status(500).json({
          error: "Auth host is not configured. Set auth.host in settings or VITE_BREATHECODE_HOST.",
        });
        return;
      }

      const loginPath = auth.login?.path || "/v1/auth/login/";
      const loginMethod = auth.login?.method || "POST";
      const upstreamUrl = resolveAuthUrl(loginPath, host);

      const upstream = await fetch(upstreamUrl, {
        method: loginMethod,
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({ email, password }),
        redirect: "manual",
      });

      const contentType = upstream.headers.get("content-type") || "";
      const text = await upstream.text();

      // Follow one redirect only if it still looks like an API URL (avoid HTML login pages).
      if (
        [301, 302, 303, 307, 308].includes(upstream.status) &&
        upstream.headers.get("location")
      ) {
        res.status(502).json({
          error: "Login endpoint redirected instead of returning a token. Check auth.login.path.",
        });
        return;
      }

      let json: Record<string, unknown>;
      try {
        json = JSON.parse(text) as Record<string, unknown>;
      } catch {
        log.warn(
          { upstreamUrl, status: upstream.status, contentType, preview: text.slice(0, 120) },
          "Login upstream returned non-JSON",
        );
        res.status(502).json({
          error: "Login service returned an unexpected response. Check auth host and login path.",
        });
        return;
      }

      if (!upstream.ok) {
        const detail =
          (typeof json.detail === "string" && json.detail) ||
          (typeof json.error === "string" && json.error) ||
          (typeof json.non_field_errors === "object" &&
            Array.isArray(json.non_field_errors) &&
            String(json.non_field_errors[0])) ||
          "Invalid credentials";
        res.status(upstream.status === 400 || upstream.status === 401 ? 401 : upstream.status).json({ error: detail });
        return;
      }

      const token =
        (typeof json.token === "string" && json.token) ||
        (typeof json.key === "string" && json.key) ||
        (typeof (json as { access_token?: unknown }).access_token === "string" &&
          (json as { access_token: string }).access_token) ||
        "";
      if (!token) {
        res.status(502).json({ error: "Login succeeded but no token was returned" });
        return;
      }

      res.json({ token });
    } catch (error) {
      log.error({ err: error }, "Login proxy error:");
      res.status(502).json({ error: "Failed to reach login service" });
    }
  };

  app.post("/api/auth/login", consumerLoginHandler);
  // Alias in case an older process/proxy special-cases the /login path.
  app.post("/api/auth/password-login", consumerLoginHandler);

  // Consumer signup proxy — forwards the mapped payload to the endpoint configured
  // in site auth settings (settings.yml `auth.signup.path`, e.g. /v1/auth/subscribe/).
  app.post("/api/auth/signup", async (req, res) => {
    try {
      const contentRoot = getAuthContentRoot(res);
      if (!isSignupConfigured(contentRoot)) {
        res.status(400).json({ error: "Signup is not configured for this site" });
        return;
      }

      const auth = getAuthSettings(contentRoot);
      const host = auth.host || process.env.VITE_BREATHECODE_HOST || BREATHECODE_HOST;
      let signupUrl = resolveAuthUrl(auth.signup!.path!, host);
      const signupMethod = auth.signup?.method || "POST";
      const payload = (req.body ?? {}) as Record<string, unknown>;

      // Breathecode's get_user_language() uses Accept-Language raw and later
      // validates UserSetting.lang as 2 or 5 chars. Prefer X-Session-Locale
      // (already 'en'|'es' from the client session); fall back to body language.
      const acceptLanguage = (() => {
        const sessionLocale = req.get("x-session-locale")?.trim();
        if (sessionLocale === "en" || sessionLocale === "es") return sessionLocale;

        const raw = typeof payload.language === "string" ? payload.language.trim() : "";
        const short = raw.slice(0, 2).toLowerCase();
        return /^[a-z]{2}$/.test(short) ? short : "en";
      })();

      if (signupMethod === "GET") {
        const u = new URL(signupUrl);
        for (const [key, value] of Object.entries(payload)) {
          if (value === null || value === undefined) continue;
          if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
            u.searchParams.set(key, String(value));
          }
        }
        signupUrl = u.toString();
      }

      const upstream = await fetch(signupUrl, {
        method: signupMethod,
        headers:
          signupMethod === "GET"
            ? { "Accept-Language": acceptLanguage }
            : {
                "Content-Type": "application/json",
                "Accept-Language": acceptLanguage,
              },
        ...(signupMethod === "GET"
          ? {}
          : { body: JSON.stringify(payload) }),
      });

      const text = await upstream.text();
      let json: unknown;
      try {
        json = JSON.parse(text);
      } catch {
        json = { raw: text };
      }

      if (!upstream.ok) {
        log.warn(`[Signup] Upstream ${signupUrl} responded ${upstream.status}`);
        res.status(upstream.status).json({ error: "Signup failed", details: json });
        return;
      }

      res.json({ success: true, data: json });
    } catch (error) {
      log.error({ err: error }, "Signup proxy error:");
      res.status(502).json({ error: "Failed to reach signup service" });
    }
  });

  // Check token validity without full re-validation (for session refresh)
  app.post("/api/debug/check-session", async (req, res) => {
    try {
      const { token } = req.body;

      if (!token) {
        res.status(400).json({ valid: false, error: "Token required" });
        return;
      }

      // Get token info including expiration from Breathecode
      let tokenInfoResponse;
      try {
        tokenInfoResponse = await fetch(
          `${BREATHECODE_HOST}/v1/auth/token/${token}`,
          { method: "GET" },
        );
      } catch (networkError) {
        // Network error - don't invalidate session, return error status
        log.error({ err: networkError }, "Network error checking session:");
        res.json({
          valid: false,
          networkError: true,
          error: "Network error checking token",
        });
        return;
      }

      if (!tokenInfoResponse.ok) {
        // Token is invalid or expired (401/404 etc)
        res.json({ valid: false, expired: true });
        return;
      }

      const tokenInfo = (await tokenInfoResponse.json()) as {
        token?: string;
        token_type?: string;
        expires_at?: string;
        user_id?: number;
      };

      // Check if token is expired
      if (tokenInfo.expires_at) {
        const expiresAt = new Date(tokenInfo.expires_at);
        if (expiresAt <= new Date()) {
          res.json({
            valid: false,
            expired: true,
            expiresAt: tokenInfo.expires_at,
          });
          return;
        }
      }

      res.json({
        valid: true,
        expired: false,
        expiresAt: tokenInfo.expires_at || null,
      });
    } catch (error) {
      log.error({ err: error }, "Session check error:");
      // Unknown error - don't invalidate session
      res.json({
        valid: false,
        networkError: true,
        error: "Failed to check session",
      });
    }
  });
}
