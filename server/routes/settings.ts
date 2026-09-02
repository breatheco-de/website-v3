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
import { getConversionNameUsages, bulkReplaceConversionName, partialReplaceConversionNameBySection, buildFormState, getFormStateSuggestions, getConversionNameCounts, getAllFormEntries } from "../form-state";
import { sectionMatchesId } from "../utils/sectionIdentity";
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
  getTrackingSettings,
  updateTrackingSettings,
  getRobotsSettings,
  updateRobotsSettings,
  updateSearchConsoleSettings,
  updateSearchConsoleBigQuerySettings,
  buildRobotsTxtContent,
  getAuthSettings,
  updateAuthSettings,
  isSignupConfigured,
  isSignupFieldMapReady,
  getEntryPreviewSettings,
  updateEntryPreviewSettings,
  DEFAULT_ENTRY_PREVIEW_SETTINGS,
  getConsentFallback,
  updateConsentFallback,
} from "../settings";
import { clearIpnRecentCalls, getIpnRecentCalls, IPN_RECENT_CALLS_LIMIT, resolveIpnSecret } from "../ipn-proxy";
import { getVM } from "../site-manager";
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
  buildSignupTestPayloadFromFieldMap,
  type AuthSignupFieldMapEntry,
} from "@shared/authSignupFieldMap";
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
  safeYamlLoad,
} from "./_helpers";
import { applyLogoStructureFromMaster } from "../menu-logo-structure";
import { child } from "../logger";
import { applyLogoStructureFromMaster } from "../menu-logo-structure";
const log = child({ module: "routes/settings" });

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

function persistTrackingSettings(
  input: Parameters<typeof updateTrackingSettings>[0],
  res: Response,
  author?: string | null,
): void {
  const contentRoot = getContentRoot(res);
  updateTrackingSettings(input, contentRoot);
  markFileAsModified("settings.yml", author ?? undefined, undefined, contentRoot);
}

export function registerSettingsRoutes(app: Express): void {
  app.get("/api/version", (_req, res) => {
    try {
      const versionPath = path.join(process.cwd(), "version.json");
      if (!fs.existsSync(versionPath)) {
        res.json({ version: "1.0.0" });
        return;
      }
      const content = fs.readFileSync(versionPath, "utf-8");
      const data = JSON.parse(content);
      const payload: { version: string; deployedAt?: string } = {
        version: data.version || "1.0.0",
      };
      if (typeof data.deployedAt === "string" && data.deployedAt) {
        payload.deployedAt = data.deployedAt;
      }
      res.json(payload);
    } catch {
      res.json({ version: "1.0.0" });
    }
  });

  app.get("/api/theme", (_req, res) => {
    try {
      const themePath = path.join(getContentRoot(res), "theme.json");
      if (!fs.existsSync(themePath)) {
        res.status(404).json({ error: "Theme configuration not found" });
        return;
      }
      const themeContent = fs.readFileSync(themePath, "utf-8");
      const theme = JSON.parse(themeContent);
      res.json(theme);
    } catch (error) {
      log.error({ err: error }, "Error loading theme:");
      res.status(500).json({ error: "Failed to load theme configuration" });
    }
  });

  app.put("/api/theme/colors", (req, res) => {
    try {
      const { light, dark } = req.body as { light?: Record<string, string>; dark?: Record<string, string> };
      const themePath = path.join(getContentRoot(res), "theme.json");
      if (!fs.existsSync(themePath)) {
        res.status(404).json({ error: "Theme configuration not found" });
        return;
      }
      const theme = JSON.parse(fs.readFileSync(themePath, "utf-8"));
      theme.colors = { light: light || {}, dark: dark || {} };
      fs.writeFileSync(themePath, JSON.stringify(theme, null, 2));
      markFileAsModified('theme.json', undefined, undefined, getContentRoot(res));
      res.json({ success: true });
    } catch (error) {
      log.error({ err: error }, "Error saving theme colors:");
      res.status(500).json({ error: "Failed to save theme colors" });
    }
  });

  app.put("/api/theme/preview-examples", (req, res) => {
    try {
      const examples = req.body as Array<{ component: string; version: string; example: string }>;
      const themePath = path.join(getContentRoot(res), "theme.json");
      if (!fs.existsSync(themePath)) {
        res.status(404).json({ error: "Theme configuration not found" });
        return;
      }
      const theme = JSON.parse(fs.readFileSync(themePath, "utf-8"));
      theme.preview_examples = Array.isArray(examples) ? examples : [];
      fs.writeFileSync(themePath, JSON.stringify(theme, null, 2));
      markFileAsModified('theme.json', undefined, undefined, getContentRoot(res));
      res.json({ success: true });
    } catch (error) {
      log.error({ err: error }, "Error saving preview examples:");
      res.status(500).json({ error: "Failed to save preview examples" });
    }
  });

  app.put("/api/theme/palettes", async (req, res) => {
    try {
      const auth = await requireCapability(req, res, "theme_edit");
      if (!auth.authorized) return;

      const paletteEntrySchema = z.object({
        id: z.string(),
        label: z.string(),
        cssVar: z.string().optional(),
        value: z.string().optional(),
        lightValue: z.string().optional(),
        darkValue: z.string().optional(),
      });
      const bodySchema = z.object({
        backgrounds: z.array(paletteEntrySchema),
        text: z.array(paletteEntrySchema),
        accents: z.array(paletteEntrySchema),
      });
      const parsed = bodySchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: "Invalid palette data", details: parsed.error.issues });
        return;
      }

      const themePath = path.join(getContentRoot(res), "theme.json");
      if (!fs.existsSync(themePath)) {
        res.status(404).json({ error: "Theme configuration not found" });
        return;
      }
      const theme = JSON.parse(fs.readFileSync(themePath, "utf-8"));

      const knownVars = new Set<string>([
        ...Object.keys((theme.colors?.light as Record<string, string>) || {}),
        ...Object.keys((theme.colors?.dark as Record<string, string>) || {}),
      ]);

      const unknownVarWarnings: string[] = [];
      const allEntries = [
        ...parsed.data.backgrounds,
        ...parsed.data.text,
        ...parsed.data.accents,
      ];
      for (const entry of allEntries) {
        if (entry.cssVar && !knownVars.has(entry.cssVar)) {
          unknownVarWarnings.push(`${entry.id}: unknown cssVar "${entry.cssVar}"`);
        }
      }

      theme.backgrounds = parsed.data.backgrounds;
      theme.text = parsed.data.text;
      theme.accents = parsed.data.accents;

      const themeDir = path.dirname(themePath);
      const tmpPath = path.join(themeDir, `.theme.${Date.now()}.tmp`);
      fs.writeFileSync(tmpPath, JSON.stringify(theme, null, 2));
      fs.renameSync(tmpPath, themePath);
      markFileAsModified('theme.json', undefined, undefined, getContentRoot(res));

      if (unknownVarWarnings.length > 0) {
        res.json({ ok: true, warnings: unknownVarWarnings });
      } else {
        res.json({ ok: true });
      }
    } catch (error) {
      log.error({ err: error }, "Error saving theme palettes:");
      res.status(500).json({ error: "Failed to save theme palettes" });
    }
  });

  app.get("/api/variables", (_req, res) => {
    res.json(getVM(res).getDefinitions());
  });

  // Must be registered before /api/variables/:name/* so "usage-summary" is not a :name.
  app.get("/api/variables/usage-summary", (_req, res) => {
    try {
      res.json({ counts: getCI(res).getVariableUsageSummary() });
    } catch (err: any) {
      res
        .status(500)
        .json({ error: err?.message || "Failed to get variable usage summary" });
    }
  });

  app.put("/api/variables/:name", (req, res) => {
    try {
      const { name } = req.params;
      const body = req.body;

      const def = getVM(res).getDefinition(name);
      if (def?.isReserved) {
        const hint = name.startsWith("brand.")
          ? "Use Settings → Brand."
          : "Use Settings → Legal.";
        return res.status(403).json({ error: `Variable "${name}" is reserved and cannot be modified here. ${hint}` });
      }

      const { action } = body as { action: string };
      if (!action) {
        return res.status(400).json({ error: "action is required" });
      }

      switch (action) {
        case "set_default": {
          const { value } = body as { value: string };
          if (value === undefined) {
            return res.status(400).json({ error: "value is required" });
          }
          getVM(res).updateDefault(name, value);
          break;
        }
        case "add_condition": {
          const { condition } = body as {
            condition: { query: Record<string, string>; value: string };
          };
          if (!condition || !condition.query || condition.value === undefined) {
            return res
              .status(400)
              .json({ error: "condition with query and value is required" });
          }
          getVM(res).addCondition(name, condition);
          break;
        }
        case "update_condition": {
          const { index, condition } = body as {
            index: number;
            condition: { query: Record<string, string>; value: string };
          };
          if (
            index === undefined ||
            !condition ||
            !condition.query ||
            condition.value === undefined
          ) {
            return res.status(400).json({
              error: "index and condition with query and value are required",
            });
          }
          getVM(res).updateCondition(name, index, condition);
          break;
        }
        case "delete_condition": {
          const { index } = body as { index: number };
          if (index === undefined) {
            return res.status(400).json({ error: "index is required" });
          }
          getVM(res).deleteCondition(name, index);
          break;
        }
        case "reorder_conditions": {
          const { fromIndex, toIndex } = body as {
            fromIndex: number;
            toIndex: number;
          };
          if (fromIndex === undefined || toIndex === undefined) {
            return res
              .status(400)
              .json({ error: "fromIndex and toIndex are required" });
          }
          getVM(res).reorderConditions(name, fromIndex, toIndex);
          break;
        }
        default:
          return res.status(400).json({ error: `Unknown action: ${action}` });
      }

      res.json({
        success: true,
        definitions: getVM(res).getDefinitions(),
      });
    } catch (err: any) {
      res
        .status(500)
        .json({ error: err?.message || "Failed to update variable" });
    }
  });

  app.delete("/api/variables/:name", (req, res) => {
    try {
      const { name } = req.params;
      const body = req.body || {};

      const defToDelete = getVM(res).getDefinition(name);
      if (defToDelete?.isReserved) {
        const hint = name.startsWith("brand.")
          ? "Manage it in Settings → Brand."
          : "Manage it in Settings → Legal.";
        return res.status(403).json({ error: `Variable "${name}" is reserved and cannot be deleted. ${hint}` });
      }

      if (body.action === "delete_definition") {
        const files = getCI(res).getVariableUsage(name);
        if (files.length > 0) {
          return res.status(409).json({
            error: `Variable "${name}" is still used in ${files.length} file(s). Remove references first.`,
            files,
            count: files.length,
          });
        }
        getVM(res).deleteDefinition(name);
        return res.json({
          success: true,
          definitions: getVM(res).getDefinitions(),
        });
      }

      if (body.level) {
        const { level, key } = body as { level: string; key?: string };
        const VALID_LEVELS = [
          "default",
          "by_locale",
          "by_region",
          "by_location",
        ];
        if (!level) {
          return res.status(400).json({ error: "level is required" });
        }
        if (!VALID_LEVELS.includes(level)) {
          return res.status(400).json({
            error: `Invalid level. Must be one of: ${VALID_LEVELS.join(", ")}`,
          });
        }
        if (level !== "default" && !key) {
          return res
            .status(400)
            .json({ error: "key is required for non-default levels" });
        }
        const result = getVM(res).deleteVariableEntry(name, level, key);
        if (!result) {
          return res.status(404).json({ error: "Variable not found" });
        }
        return res.json({
          success: true,
          definitions: getVM(res).getDefinitions(),
        });
      }

      const { action, index } = body as { action?: string; index?: number };
      if (action === "delete_condition" && index !== undefined) {
        getVM(res).deleteCondition(name, index);
        return res.json({
          success: true,
          definitions: getVM(res).getDefinitions(),
        });
      }

      return res
        .status(400)
        .json({ error: "level or action with index is required" });
    } catch (err: any) {
      res
        .status(500)
        .json({ error: err?.message || "Failed to delete variable entry" });
    }
  });

  app.get("/api/variables/:name/usage", (req, res) => {
    try {
      const { name } = req.params;
      const files = getCI(res).getVariableUsage(name);
      res.json({ variable: name, files });
    } catch (err: any) {
      res
        .status(500)
        .json({ error: err?.message || "Failed to get variable usage" });
    }
  });

  app.post("/api/variables/:name/rename", (req, res) => {
    try {
      const { name: oldName } = req.params;
      const { newName, author } = req.body as { newName: string; author?: string };
      const authorName = author && typeof author === "string" ? author : undefined;

      const defToRename = getVM(res).getDefinition(oldName);
      if (defToRename?.isReserved) {
        return res.status(403).json({ error: `Variable "${oldName}" is reserved and cannot be renamed.` });
      }

      if (!newName || typeof newName !== "string") {
        return res.status(400).json({ error: "newName is required" });
      }

      const sanitized = newName.trim().replace(/\s+/g, "_").toLowerCase();
      if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(sanitized)) {
        return res.status(400).json({
          error:
            "Invalid variable name. Use letters, numbers, and underscores only.",
        });
      }

      const affectedFiles = getCI(res).getVariableUsage(oldName);

      const pattern = new RegExp(
        `\\{\\{\\s*${oldName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(\\s*(?:\\|[^}]*)?)\\}\\}`,
        "g",
      );

      const updatedFiles: string[] = [];
      for (const relPath of affectedFiles) {
        const absPath = path.join(process.cwd(), relPath);
        if (!fs.existsSync(absPath)) continue;

        const content = fs.readFileSync(absPath, "utf-8");
        const newContent = content.replace(pattern, `{{ ${sanitized}$1}}`);
        if (newContent !== content) {
          fs.writeFileSync(absPath, newContent, "utf-8");
          markFileAsModified(relPath, authorName);
          updatedFiles.push(relPath);
        }
      }

      getVM(res).renameVariable(oldName, sanitized);

      getCI(res).refresh();
      invalidateContentCaches();

      res.json({
        success: true,
        oldName,
        newName: sanitized,
        updatedFiles,
        definitions: getVM(res).getDefinitions(),
      });
    } catch (err: any) {
      res
        .status(500)
        .json({ error: err?.message || "Failed to rename variable" });
    }
  });
  app.get("/api/settings/legal", (_req, res) => {
    try {
      res.json(getVM(res).getLegalSettings());
    } catch (err: any) {
      res.status(500).json({ error: err?.message || "Failed to load legal settings" });
    }
  });

  app.put("/api/settings/legal", (req, res) => {
    try {
      const schema = z.object({
        legal_terms_url: z.string().optional(),
        legal_privacy_url: z.string().optional(),
      });
      const parsed = schema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ error: "Invalid request body" });
      }
      const { legal_terms_url, legal_privacy_url } = parsed.data;
      if (legal_terms_url !== undefined) {
        getVM(res).updateLegalSetting("legal_terms_url", legal_terms_url);
      }
      if (legal_privacy_url !== undefined) {
        getVM(res).updateLegalSetting("legal_privacy_url", legal_privacy_url);
      }
      res.json({ success: true, ...getVM(res).getLegalSettings() });
    } catch (err: any) {
      res.status(500).json({ error: err?.message || "Failed to save legal settings" });
    }
  });

  app.get("/api/settings/consent", (_req, res) => {
    try {
      const contentRoot = getContentRoot(res);
      const defaultLocale = getDefaultLocale(contentRoot);
      res.json({
        fallback: getConsentFallback(contentRoot),
        messages: getVM(res).getConsentSettings(defaultLocale),
      });
    } catch (err: any) {
      res.status(500).json({ error: err?.message || "Failed to load consent settings" });
    }
  });

  app.put("/api/settings/consent/fallback", (req, res) => {
    try {
      const schema = z.object({
        fallback: z.union([z.string(), z.null()]),
      });
      const parsed = schema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ error: "Invalid request body", details: parsed.error.flatten() });
      }
      const contentRoot = getContentRoot(res);
      const fallback = updateConsentFallback(parsed.data.fallback, contentRoot);
      markFileAsModified("settings.yml", undefined, undefined, contentRoot);
      const defaultLocale = getDefaultLocale(contentRoot);
      res.json({
        success: true,
        fallback,
        messages: getVM(res).getConsentSettings(defaultLocale),
      });
    } catch (err: any) {
      res.status(400).json({ error: err?.message || "Failed to save consent fallback" });
    }
  });

  app.put("/api/settings/consent", (req, res) => {
    try {
      const schema = z.object({
        key: z.string().regex(/^consent_[a-z][a-z0-9_]*$/, "Invalid consent key"),
        locales: z.record(z.string(), z.string()),
      });
      const parsed = schema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ error: "Invalid request body", details: parsed.error.flatten() });
      }
      const contentRoot = getContentRoot(res);
      const defaultLocale = getDefaultLocale(contentRoot);
      getVM(res).updateConsentSetting(parsed.data.key, parsed.data.locales, defaultLocale);
      res.json({
        success: true,
        fallback: getConsentFallback(contentRoot),
        messages: getVM(res).getConsentSettings(defaultLocale),
      });
    } catch (err: any) {
      res.status(500).json({ error: err?.message || "Failed to save consent settings" });
    }
  });

  app.get("/api/settings/home-page", (req, res) => {
    res.json(getHomePage(getContentRoot(res)));
  });

  app.get("/api/settings/locales", (req, res) => {
    res.json({
      default_locale: getDefaultLocale(getContentRoot(res)),
      supported_locales: getLocaleEntries(getContentRoot(res)),
    });
  });

  app.put("/api/settings/locales", (req, res) => {
    try {
      const { default_locale, supported_locales } = req.body;
      updateLocaleSettings({ default_locale, supported_locales }, getContentRoot(res));
      res.json({
        success: true,
        default_locale: getDefaultLocale(getContentRoot(res)),
        supported_locales: getLocaleEntries(getContentRoot(res)),
      });
    } catch (err: any) {
      res.status(400).json({ error: err.message || String(err) });
    }
  });

  app.get("/api/settings/tracking", async (req, res) => {
    const auth = await requireCapability(req, res, "metrics_view");
    if (!auth.authorized) return;
    res.json({
      ...getTrackingSettings(getContentRoot(res)),
      has_env_webhook: !!process.env.DEFAULT_WEBHOOK_URL,
    });
  });

  app.get("/api/settings/auth", (req, res) => {
    const contentRoot = getContentRoot(res);
    const auth = getAuthSettings(contentRoot);
    const effectiveHost = (auth.host || process.env.VITE_BREATHECODE_HOST || "").replace(/\/$/, "");
    const loginPageUrl =
      auth.login?.url?.trim() ||
      (effectiveHost ? `${effectiveHost}/v1/auth/view/login` : "");
    res.json({
      ...auth,
      host: auth.host || effectiveHost || undefined,
      signup_configured: isSignupConfigured(contentRoot),
      signup_field_map_ready: isSignupFieldMapReady(auth.signup?.field_map),
      login_page_url: loginPageUrl || undefined,
    });
  });

  app.put("/api/settings/auth", (req, res) => {
    try {
      const methodSchema = z.enum(["GET", "POST", "PUT"]).optional();
      const endpointSchema = z.object({
        path: z.string().optional(),
        method: methodSchema,
      });
      const schema = z.object({
        host: z.string().optional(),
        academy: z.string().optional(),
        login: endpointSchema.extend({
          url: z.string().optional(),
          payload: z.record(z.unknown()).optional(),
        }).optional(),
        signup: endpointSchema.extend({
          payload: z.record(z.unknown()).optional(),
          field_map: z
            .array(
              z.object({
                key: z.string(),
                from: z.string(),
                required: z.boolean().optional(),
              }),
            )
            .optional(),
        }).optional(),
        profile: endpointSchema.optional(),
      }).nullable();
      const parsed = schema.safeParse(req.body?.auth === undefined ? req.body : req.body.auth);
      if (!parsed.success) {
        return res.status(400).json({ error: "Invalid request body" });
      }
      const updated = updateAuthSettings(parsed.data, getContentRoot(res));
      res.json({
        success: true,
        ...updated,
        signup_configured: isSignupConfigured(getContentRoot(res)),
        signup_field_map_ready: isSignupFieldMapReady(updated.signup?.field_map),
      });
    } catch (err: any) {
      res.status(400).json({ error: err.message || String(err) });
    }
  });

  /**
   * POST /api/settings/auth/test
   * Probe a site auth endpoint using saved settings, with optional unsaved overrides.
   * Body: { target: "login"|"signup"|"profile", host?, login?, signup?, profile?, token?, email?, password?, payload? }
   * Returns: { ok, status, url, method, body, error?, elapsed_ms }
   */
  app.post("/api/settings/auth/test", async (req, res) => {
    const started = Date.now();
    try {
      const target = req.body?.target as string | undefined;
      if (!target || !["login", "signup", "profile"].includes(target)) {
        return res.status(400).json({
          ok: false,
          error: 'target must be one of "login", "signup", "profile"',
        });
      }

      const saved = getAuthSettings(getContentRoot(res));
      const str = (v: unknown, fallback?: string) =>
        typeof v === "string" && v.trim() ? v.trim() : fallback;
      const parseMethod = (v: unknown, fallback: "GET" | "POST" | "PUT"): "GET" | "POST" | "PUT" => {
        if (typeof v === "string") {
          const m = v.trim().toUpperCase();
          if (m === "GET" || m === "POST" || m === "PUT") return m;
        }
        return fallback;
      };

      const host =
        str(req.body?.host) ||
        saved.host ||
        process.env.VITE_BREATHECODE_HOST ||
        BREATHECODE_HOST;

      const loginOverride = req.body?.login && typeof req.body.login === "object" ? req.body.login : {};
      const signupOverride = req.body?.signup && typeof req.body.signup === "object" ? req.body.signup : {};
      const profileOverride = req.body?.profile && typeof req.body.profile === "object" ? req.body.profile : {};

      const loginPath = str(loginOverride.path, saved.login?.path);
      const loginMethod = parseMethod(loginOverride.method ?? saved.login?.method, "POST");
      const signupPath = str(signupOverride.path, saved.signup?.path);
      const signupMethod = parseMethod(signupOverride.method ?? saved.signup?.method, "POST");
      const profilePath = str(profileOverride.path, saved.profile?.path) || "/v1/auth/user/me";
      const profileMethod = parseMethod(profileOverride.method ?? saved.profile?.method, "GET");

      const resolveUrl = (pathOrUrl: string) => {
        if (/^https?:\/\//i.test(pathOrUrl)) return pathOrUrl;
        return `${host.replace(/\/$/, "")}${pathOrUrl.startsWith("/") ? "" : "/"}${pathOrUrl}`;
      };

      const flattenScalarsToQuery = (baseUrl: string, payload: Record<string, unknown>) => {
        const u = new URL(baseUrl);
        for (const [key, value] of Object.entries(payload)) {
          if (value === null || value === undefined) continue;
          if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
            u.searchParams.set(key, String(value));
          }
        }
        return u.toString();
      };

      let url = "";
      let method: "GET" | "POST" | "PUT" = "GET";
      const headers: Record<string, string> = {};
      let body: string | undefined;

      if (target === "login") {
        if (!loginPath) {
          return res.status(400).json({ ok: false, error: "login.path is not set" });
        }
        url = resolveUrl(loginPath);
        method = loginMethod;

        let payload: Record<string, unknown> =
          req.body?.payload && typeof req.body.payload === "object" && !Array.isArray(req.body.payload)
            ? (req.body.payload as Record<string, unknown>)
            : loginOverride.payload && typeof loginOverride.payload === "object" && !Array.isArray(loginOverride.payload)
              ? (loginOverride.payload as Record<string, unknown>)
              : saved.login?.payload
                ? { ...saved.login.payload }
                : {};

        const email = typeof req.body?.email === "string" ? req.body.email.trim() : "";
        const password = typeof req.body?.password === "string" ? req.body.password : "";
        if (email) payload = { ...payload, email };
        if (password) payload = { ...payload, password };

        if (!payload.email || !payload.password) {
          return res.status(400).json({
            ok: false,
            error: "email and password are required to test login (set login.payload or pass email/password)",
          });
        }

        if (method === "GET") {
          url = flattenScalarsToQuery(url, payload);
        } else {
          headers["Content-Type"] = "application/json";
          body = JSON.stringify(payload);
        }
      } else if (target === "signup") {
        if (!signupPath) {
          return res.status(400).json({ ok: false, error: "signup.path is not set" });
        }
        url = resolveUrl(signupPath);
        method = signupMethod;
        const payload =
          req.body?.payload && typeof req.body.payload === "object" && !Array.isArray(req.body.payload)
            ? req.body.payload
            : signupOverride.payload && typeof signupOverride.payload === "object" && !Array.isArray(signupOverride.payload)
              ? signupOverride.payload
              : (() => {
                  const map = Array.isArray((signupOverride as { field_map?: unknown }).field_map)
                    ? ((signupOverride as { field_map: AuthSignupFieldMapEntry[] }).field_map)
                    : saved.signup?.field_map;
                  if (Array.isArray(map) && map.length > 0) {
                    return buildSignupTestPayloadFromFieldMap(map);
                  }
                  return {
                    first_name: "Test",
                    last_name: "User",
                    email: `auth-test-${Date.now()}@example.com`,
                    phone: "",
                    course: "",
                    country: "",
                    city: "",
                    plan: "4geeks-basic-subscription",
                    language: "en",
                    has_marketing_consent: false,
                    conversion_info: {
                      user_agent: "website-v3-auth-test",
                      landing_url: "/private/security/auth",
                      conversion_url: "/private/security/auth",
                    },
                  };
                })();
        if (method === "GET") {
          url = flattenScalarsToQuery(url, payload as Record<string, unknown>);
        } else {
          headers["Content-Type"] = "application/json";
          body = JSON.stringify(payload);
        }
      } else if (target === "profile") {
        const token = typeof req.body?.token === "string" ? req.body.token.trim() : "";
        if (!token) {
          return res.status(400).json({ ok: false, error: "token is required to test the profile endpoint" });
        }
        url = resolveUrl(profilePath);
        method = profileMethod;
        headers.Authorization = `Token ${token}`;
        const academy =
          str(req.body?.academy) ||
          saved.academy;
        if (academy) headers.Academy = academy;
        if (method === "POST" || method === "PUT") {
          headers["Content-Type"] = "application/json";
          body = "{}";
        }
      }

      try {
        const upstream = await fetch(url, { method, headers, body });
        const text = await upstream.text();
        let parsedBody: unknown = text;
        try {
          parsedBody = JSON.parse(text);
        } catch {
          // keep raw text
        }
        const elapsed_ms = Date.now() - started;
        const truncated =
          typeof parsedBody === "string" && parsedBody.length > 4000
            ? `${parsedBody.slice(0, 4000)}…`
            : parsedBody;

        res.json({
          ok: upstream.ok,
          status: upstream.status,
          url,
          method,
          body: truncated,
          elapsed_ms,
          ...(upstream.ok ? {} : { error: `Upstream returned HTTP ${upstream.status}` }),
        });
      } catch (err) {
        res.json({
          ok: false,
          status: 0,
          url,
          method,
          body: null,
          elapsed_ms: Date.now() - started,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    } catch (err: any) {
      res.status(500).json({
        ok: false,
        error: err?.message || String(err),
        elapsed_ms: Date.now() - started,
      });
    }
  });

  app.put("/api/settings/tracking", async (req, res) => {
    const auth = await requireMutatingStaff(req, res);
    if (!auth.authorized) return;
    try {
      const {
        conversion_events,
        webhook,
        leads_expected_conversion_names,
        leads_expected_tags,
        bigquery,
      } = req.body;
      if (
        conversion_events === undefined && webhook === undefined &&
        leads_expected_conversion_names === undefined && leads_expected_tags === undefined &&
        bigquery === undefined
      ) {
        return res.status(400).json({ error: "Request body must contain conversion_events, webhook, leads_expected_conversion_names, leads_expected_tags or bigquery" });
      }
      if (conversion_events !== undefined && !Array.isArray(conversion_events)) {
        return res.status(400).json({ error: "conversion_events must be an array" });
      }
      if (leads_expected_conversion_names !== undefined && !Array.isArray(leads_expected_conversion_names)) {
        return res.status(400).json({ error: "leads_expected_conversion_names must be an array of strings" });
      }
      if (leads_expected_tags !== undefined && !Array.isArray(leads_expected_tags)) {
        return res.status(400).json({ error: "leads_expected_tags must be an array of strings" });
      }
      if (bigquery !== undefined && (typeof bigquery !== "object" || bigquery === null || Array.isArray(bigquery))) {
        return res.status(400).json({ error: "bigquery must be an object" });
      }
      persistTrackingSettings({
        ...(conversion_events !== undefined ? { conversion_events } : {}),
        ...(webhook !== undefined ? { webhook } : {}),
        ...(leads_expected_conversion_names !== undefined ? { leads_expected_conversion_names } : {}),
        ...(leads_expected_tags !== undefined ? { leads_expected_tags } : {}),
        ...(bigquery !== undefined ? { bigquery } : {}),
      }, res, auth.author);
      res.json({ success: true, ...getTrackingSettings(getContentRoot(res)) });
    } catch (err: any) {
      res.status(400).json({ error: err.message || String(err) });
    }
  });

  app.get("/api/settings/tracking/bigquery", async (req, res) => {
    const auth = await requireCapability(req, res, "metrics_view");
    if (!auth.authorized) return;
    const { getBigQueryConfigStatus } = await import("../ecommerce/bigquery-client");
    res.json(getBigQueryConfigStatus(getContentRoot(res)));
  });

  app.put("/api/settings/tracking/bigquery", async (req, res) => {
    const auth = await requireMutatingStaff(req, res);
    if (!auth.authorized) return;
    try {
      const body = req.body?.bigquery ?? req.body;
      if (!body || typeof body !== "object" || Array.isArray(body)) {
        return res.status(400).json({ error: "Request body must be a bigquery object" });
      }
      persistTrackingSettings({ bigquery: body }, res, auth.author);
      const { getBigQueryConfigStatus } = await import("../ecommerce/bigquery-client");
      res.json({ success: true, ...getBigQueryConfigStatus(getContentRoot(res)) });
    } catch (err: any) {
      res.status(400).json({ error: err.message || String(err) });
    }
  });

  app.post("/api/settings/tracking/bigquery/test", async (req, res) => {
    const auth = await requireCapability(req, res, "metrics_view");
    if (!auth.authorized) return;
    try {
      const { testBigQueryConnection } = await import("../ecommerce/bigquery-client");
      const result = await testBigQueryConnection(getContentRoot(res));
      res.status(result.ok ? 200 : 400).json(result);
    } catch (err: any) {
      res.status(500).json({
        ok: false,
        error: err?.message || String(err),
        elapsed_ms: 0,
        warnings: [],
      });
    }
  });

  app.patch("/api/settings/tracking/conversion-events/:name", async (req, res) => {
    const auth = await requireMutatingStaff(req, res);
    if (!auth.authorized) return;
    try {
      const { name } = req.params;
      const { newName } = req.body as { newName?: string };
      if (!newName || typeof newName !== "string") {
        return res.status(400).json({ error: "newName is required" });
      }
      const trimmed = newName.trim();
      const snakeCasePattern = /^[a-z][a-z0-9_]*$/;
      if (!snakeCasePattern.test(trimmed)) {
        return res.status(400).json({ error: "Event name must be snake_case (lowercase letters, digits, underscores, starting with a letter)" });
      }
      const current = getTrackingSettings(getContentRoot(res));
      if (current.conversion_events.some((e) => e.name === trimmed)) {
        return res.status(409).json({ error: `An event named "${trimmed}" already exists` });
      }
      const updated = current.conversion_events.map((e) =>
        e.name === name ? { ...e, name: trimmed } : e
      );
      persistTrackingSettings({ conversion_events: updated }, res, auth.author);
      const filesChanged = bulkReplaceConversionName(name, trimmed);
      res.json({ success: true, filesChanged });
    } catch (err: any) {
      res.status(400).json({ error: err.message || String(err) });
    }
  });

  app.post("/api/settings/tracking/conversion-events/:name/merge", async (req, res) => {
    const auth = await requireMutatingStaff(req, res);
    if (!auth.authorized) return;
    try {
      const { name } = req.params;
      const { mergeInto } = req.body as { mergeInto?: string };
      if (!mergeInto || typeof mergeInto !== "string") {
        return res.status(400).json({ error: "mergeInto is required" });
      }
      const current = getTrackingSettings(getContentRoot(res));
      if (!current.conversion_events.some((e) => e.name === mergeInto)) {
        return res.status(404).json({ error: `Target event "${mergeInto}" does not exist` });
      }
      const filesChanged = bulkReplaceConversionName(name, mergeInto);
      const filtered = current.conversion_events.filter((e) => e.name !== name);
      persistTrackingSettings({ conversion_events: filtered }, res, auth.author);
      res.json({ success: true, filesChanged });
    } catch (err: any) {
      res.status(400).json({ error: err.message || String(err) });
    }
  });

  app.get("/api/form-state/suggestions", async (req, res) => {
    const auth = await requireCapability(req, res, "metrics_view");
    if (!auth.authorized) return;
    buildFormState();
    res.json(getFormStateSuggestions());
  });

  app.get("/api/form-state/all-forms", (_req, res) => {
    // Rebuild from disk so recent section edits are reflected immediately.
    buildFormState();
    const entries = getAllFormEntries();

    // Cache parsed sections per file to avoid re-reading the same YML.
    const fileSections = new Map<string, unknown[]>();
    const loadSections = (relFile: string): unknown[] => {
      if (fileSections.has(relFile)) return fileSections.get(relFile)!;
      let sections: unknown[] = [];
      try {
        const raw = fs.readFileSync(path.resolve(process.cwd(), relFile), "utf-8");
        const doc = safeYamlLoad(raw) as Record<string, unknown> | null;
        if (doc && Array.isArray(doc.sections)) sections = doc.sections;
      } catch {}
      fileSections.set(relFile, sections);
      return sections;
    };

    const sectionYml = (relFile: string, sectionId: string, sectionType: string): string | null => {
      const sections = loadSections(relFile);
      const match = sectionId
        ? sections.find(
            (s) => s && typeof s === "object" && !Array.isArray(s) && sectionMatchesId(s as Record<string, unknown>, sectionId),
          )
        // Fallback for sections without an id: first section of the same type.
        : sections.find(
            (s) => s && typeof s === "object" && !Array.isArray(s) && (s as Record<string, unknown>).type === sectionType,
          );
      if (!match) return null;
      try {
        return yaml.dump(match, { lineWidth: 100, noRefs: true });
      } catch {
        return null;
      }
    };

    const pages = new Map<string, {
      key: string;
      site: string;
      content_type: string;
      slug: string;
      locale: string;
      file: string;
      page_url: string | null;
      forms: Array<{
        section_id: string;
        section_type: string;
        variant?: string;
        conversion_name: string;
        tags: string[];
        automations?: string;
        yml: string | null;
      }>;
    }>();

    for (const e of entries) {
      // The same page can exist in several sites (multi-site) — keep them apart.
      const site = e.file.split("/")[0] || "";
      const key = `${site}::${e.content_type}::${e.slug}::${e.locale}`;
      let page = pages.get(key);
      if (!page) {
        page = {
          key,
          site,
          content_type: e.content_type,
          slug: e.slug,
          locale: e.locale,
          file: e.file,
          page_url: resolveContentTypeUrl(e.content_type, { slug: e.slug }, e.locale) ?? null,
          forms: [],
        };
        pages.set(key, page);
      }
      page.forms.push({
        section_id: e.section_id,
        section_type: e.section_type,
        ...(e.variant ? { variant: e.variant } : {}),
        conversion_name: e.conversion_name,
        tags: e.tags ?? [],
        ...(e.automations ? { automations: e.automations } : {}),
        yml: sectionYml(e.file, e.section_id, e.section_type),
      });
    }

    res.json({
      pages: Array.from(pages.values()).sort((a, b) => a.key.localeCompare(b.key)),
    });
  });

  app.get("/api/form-state/conversion-counts", async (req, res) => {
    const auth = await requireCapability(req, res, "metrics_view");
    if (!auth.authorized) return;
    buildFormState();
    res.json(getConversionNameCounts());
  });

  app.get("/api/settings/tracking/conversion-events/:name/usage", async (req, res) => {
    const auth = await requireCapability(req, res, "metrics_view");
    if (!auth.authorized) return;
    const { name } = req.params;
    // Always rebuild from disk before checking — ensures edits made via
    // the section editor (or any other path) are reflected immediately.
    buildFormState();
    const usages = getConversionNameUsages(name);
    res.json({
      name,
      usages: usages.map(({ file, content_type, slug, locale, section_id, section_type, tags, consent }) => ({
        file,
        content_type,
        slug,
        locale,
        section_id,
        section_type,
        tags: tags && tags.length > 0 ? tags : undefined,
        consent: consent && Object.keys(consent).length > 0 ? consent : undefined,
        page_url: resolveContentTypeUrl(content_type, { slug }, locale) ?? null,
      })),
    });
  });

  app.post("/api/settings/tracking/conversion-events/:name/reassign", async (req, res) => {
    const auth = await requireMutatingStaff(req, res);
    if (!auth.authorized) return;
    try {
      const { name } = req.params;
      const { newName, entries } = req.body as {
        newName?: string;
        entries?: Array<{ file?: unknown; section_id?: unknown }>;
      };
      if (!newName || typeof newName !== "string") {
        return res.status(400).json({ error: "newName is required" });
      }
      if (!Array.isArray(entries) || entries.length === 0) {
        return res.status(400).json({ error: "entries must be a non-empty array" });
      }
      const current = getTrackingSettings(getContentRoot(res));
      if (!current.conversion_events.some((e) => e.name === newName)) {
        return res.status(404).json({ error: `Target event "${newName}" does not exist` });
      }

      // Security: intersect the requested (file, section_id) pairs with the
      // server's own usage index for this event. The client cannot inject pairs
      // that the server does not already know about for this specific event.
      const usages = getConversionNameUsages(name);
      const knownPairs = new Set(usages.map((u) => `${u.file}::${u.section_id}`));

      const safeEntries = entries
        .filter(
          (e): e is { file: string; section_id: string } =>
            typeof e.file === "string" && typeof e.section_id === "string"
        )
        .filter((e) => knownPairs.has(`${e.file}::${e.section_id}`));

      if (safeEntries.length === 0) {
        return res.status(400).json({ error: "No valid usage entries found in the request" });
      }

      const filesChanged = partialReplaceConversionNameBySection(safeEntries, name, newName);
      res.json({
        success: true,
        filesChanged,
        entriesChanged: safeEntries.length,
        rejected: entries.length - safeEntries.length,
      });
    } catch (err: any) {
      res.status(400).json({ error: err.message || String(err) });
    }
  });

  app.delete("/api/settings/tracking/conversion-events/:name", async (req, res) => {
    const auth = await requireMutatingStaff(req, res);
    if (!auth.authorized) return;
    try {
      const { name } = req.params;
      const current = getTrackingSettings(getContentRoot(res));
      const filtered = current.conversion_events.filter((e) => e.name !== name);
      persistTrackingSettings({ conversion_events: filtered }, res, auth.author);
      res.json({ success: true });
    } catch (err: any) {
      res.status(400).json({ error: err.message || String(err) });
    }
  });

  app.patch("/api/settings/tracking/conversion-events/:name", async (req, res) => {
    const auth = await requireMutatingStaff(req, res);
    if (!auth.authorized) return;
    try {
      const { name } = req.params;
      const { newName } = req.body as { newName?: string };
      if (!newName || typeof newName !== "string") {
        return res.status(400).json({ error: "newName is required" });
      }
      const trimmed = newName.trim();
      if (!/^[a-z][a-z0-9_]*$/.test(trimmed)) {
        return res.status(400).json({ error: "Event name must be snake_case (lowercase letters, digits, underscores, starting with a letter)" });
      }
      const current = getTrackingSettings(getContentRoot(res));
      if (current.conversion_events.some((e) => e.name === trimmed)) {
        return res.status(409).json({ error: `An event named "${trimmed}" already exists` });
      }
      const updated = current.conversion_events.map((e) =>
        e.name === name ? { ...e, name: trimmed } : e
      );
      persistTrackingSettings({ conversion_events: updated }, res, auth.author);
      const filesChanged = bulkReplaceConversionName(name, trimmed);
      res.json({ success: true, filesChanged });
    } catch (err: any) {
      res.status(400).json({ error: err.message || String(err) });
    }
  });

  app.post("/api/settings/tracking/conversion-events/:name/merge", async (req, res) => {
    const auth = await requireMutatingStaff(req, res);
    if (!auth.authorized) return;
    try {
      const { name } = req.params;
      const { mergeInto } = req.body as { mergeInto?: string };
      if (!mergeInto || typeof mergeInto !== "string") {
        return res.status(400).json({ error: "mergeInto is required" });
      }
      const current = getTrackingSettings(getContentRoot(res));
      if (!current.conversion_events.some((e) => e.name === mergeInto)) {
        return res.status(404).json({ error: `Target event "${mergeInto}" does not exist` });
      }
      const filesChanged = bulkReplaceConversionName(name, mergeInto);
      const filtered = current.conversion_events.filter((e) => e.name !== name);
      persistTrackingSettings({ conversion_events: filtered }, res, auth.author);
      res.json({ success: true, filesChanged });
    } catch (err: any) {
      res.status(400).json({ error: err.message || String(err) });
    }
  });

  app.get("/api/settings/optimization", async (req, res) => {
    const auth = await requireCapability(req, res, "metrics_view");
    if (!auth.authorized) return;
    const contentRoot = getContentRoot(res);
    const opt = getOptimizationSettings(contentRoot);
    const secret = resolveIpnSecret();
    res.json({
      tagmanager: opt.tagmanager,
      ip_normalization: {
        enabled: opt.ip_normalization.enabled,
        destinations: opt.ip_normalization.destinations,
        secret_configured: secret.source !== "none",
        secret_source: secret.source,
      },
    });
  });

  app.put("/api/settings/optimization", async (req, res) => {
    const auth = await requireMutatingStaff(req, res);
    if (!auth.authorized) return;
    try {
      const { tagmanager, ip_normalization } = req.body || {};
      const hasTm = tagmanager && typeof tagmanager === "object";
      const hasIpn = ip_normalization && typeof ip_normalization === "object";
      if (!hasTm && !hasIpn) {
        return res.status(400).json({
          error: "Request body must contain a tagmanager and/or ip_normalization object",
        });
      }
      const contentRoot = getContentRoot(res);
      // Never accept secret from the client — IPN_SECRET is env-only.
      const ipnPatch =
        hasIpn
          ? {
              enabled: (ip_normalization as { enabled?: boolean }).enabled,
              destinations: (ip_normalization as { destinations?: unknown }).destinations as
                | { id: string; base_url: string }[]
                | undefined,
            }
          : undefined;
      updateOptimizationSettings(
        {
          ...(hasTm ? { tagmanager } : {}),
          ...(ipnPatch ? { ip_normalization: ipnPatch } : {}),
        },
        contentRoot,
      );
      markFileAsModified("settings.yml", undefined, undefined, contentRoot);
      const opt = getOptimizationSettings(contentRoot);
      const secret = resolveIpnSecret();
      res.json({
        success: true,
        tagmanager: opt.tagmanager,
        ip_normalization: {
          enabled: opt.ip_normalization.enabled,
          destinations: opt.ip_normalization.destinations,
          secret_configured: secret.source !== "none",
          secret_source: secret.source,
        },
      });
    } catch (err: any) {
      res.status(400).json({ error: err.message || String(err) });
    }
  });

  app.get("/api/settings/entry-preview", async (req, res) => {
    const auth = await requireCapability(req, res, "seo_settings");
    if (!auth.authorized) return;
    try {
      const contentRoot = getContentRoot(res);
      const {
        resolveCloudflareAccountId,
        resolveCloudflareApiToken,
        resolveEntryPreviewCaptureSecret,
        cloudflareBrowserConfigError,
        getPublicSiteUrl,
        isSiteUrlPubliclyReachable,
      } = await import("../cloudflare-browser");

      const account = resolveCloudflareAccountId();
      const token = resolveCloudflareApiToken();
      const capture = resolveEntryPreviewCaptureSecret();
      const siteUrl = getPublicSiteUrl();
      const rate = getEntryPreviewSettings(contentRoot);

      res.json({
        account_id: account.value,
        account_id_configured: account.source !== "none",
        account_id_source: account.source,
        api_token_configured: token.source !== "none",
        api_token_source: token.source,
        capture_secret_configured: capture.source !== "none",
        capture_secret_source: capture.source,
        site_url: siteUrl,
        site_url_ok: !!siteUrl,
        site_url_publicly_reachable: isSiteUrlPubliclyReachable(),
        config_error: cloudflareBrowserConfigError(),
        min_interval_ms: rate.min_interval_ms,
        max_concurrency: rate.max_concurrency,
        max_retries: rate.max_retries,
        defaults: { ...DEFAULT_ENTRY_PREVIEW_SETTINGS },
      });
    } catch (err: any) {
      res.status(500).json({ error: err?.message || "Failed to load entry-preview settings" });
    }
  });

  app.put("/api/settings/entry-preview", async (req, res) => {
    const auth = await requireCapability(req, res, "seo_settings");
    if (!auth.authorized) return;
    try {
      const schema = z.object({
        min_interval_ms: z.number().min(0).max(120_000).optional(),
        max_concurrency: z.number().int().min(1).max(8).optional(),
        max_retries: z.number().int().min(1).max(20).optional(),
      });
      const parsed = schema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ error: "Invalid request body", details: parsed.error.flatten() });
      }
      if (
        parsed.data.min_interval_ms === undefined &&
        parsed.data.max_concurrency === undefined &&
        parsed.data.max_retries === undefined
      ) {
        return res.status(400).json({ error: "Provide at least one of min_interval_ms, max_concurrency, max_retries" });
      }
      const contentRoot = getContentRoot(res);
      const rate = updateEntryPreviewSettings(parsed.data, contentRoot);
      markFileAsModified("settings.yml", undefined, undefined, contentRoot);
      res.json({
        success: true,
        min_interval_ms: rate.min_interval_ms,
        max_concurrency: rate.max_concurrency,
        max_retries: rate.max_retries,
        defaults: { ...DEFAULT_ENTRY_PREVIEW_SETTINGS },
      });
    } catch (err: any) {
      res.status(400).json({ error: err.message || String(err) });
    }
  });

  /**
   * Throwaway Browser Run probe: screenshot the public home page and return WebP bytes.
   * Does not write to disk, YAML, or the entry-preview queue.
   *
   * Query: ?target=home (default) | example
   * - home: SITE_URL home page (validates Browser Run can reach your public URL)
   * - example: https://example.com (validates API token / Browser Rendering only)
   */
  app.post("/api/settings/entry-preview/test-screenshot", async (req, res) => {
    const auth = await requireCapability(req, res, "seo_settings");
    if (!auth.authorized) return;
    try {
      const contentRoot = getContentRoot(res);
      const {
        captureScreenshotToWebp,
        cloudflareBrowserConfigError,
        getPublicSiteUrl,
      } = await import("../cloudflare-browser");

      const configError = cloudflareBrowserConfigError();
      if (configError) {
        return res.status(400).json({ error: configError });
      }

      const target = String(req.query.target || "home").toLowerCase();
      const timeoutMs = 25_000;
      let captureUrl: string;

      if (target === "example") {
        captureUrl = "https://example.com";
      } else {
        const siteUrl = getPublicSiteUrl()!;
        const locale = getDefaultLocale(contentRoot);
        const home = getHomePage(contentRoot);
        const patternUrl = resolveContentTypeUrl(
          home.type,
          { slug: home.slug },
          locale,
          contentRoot,
        );
        const capturePath = (patternUrl || `/${locale}/${home.slug}`).replace(/\/+/g, "/");
        captureUrl = `${siteUrl}${capturePath.startsWith("/") ? capturePath : `/${capturePath}`}`;

        // Fail fast if SITE_URL is down from this server (tunnel stopped, bad URL, etc.).
        try {
          const probe = await fetch(captureUrl, {
            method: "GET",
            redirect: "follow",
            signal: AbortSignal.timeout(12_000),
          });
          if (!probe.ok) {
            return res.status(502).json({
              error: `SITE_URL home probe returned HTTP ${probe.status} for ${captureUrl}. Is the tunnel/app running?`,
            });
          }
        } catch (probeErr: any) {
          return res.status(502).json({
            error: `SITE_URL home is not reachable from this server (${probeErr?.message || probeErr}). Check cloudflared / SITE_URL.`,
          });
        }
      }

      try {
        const { webp, browserMsUsed, pngBytes } = await captureScreenshotToWebp({
          url: captureUrl,
          waitForSelector: "body",
          waitUntil: "domcontentloaded",
          waitForTimeoutMs: target === "example" ? 500 : 1500,
          timeoutMs,
          width: 1200,
          height: 630,
          contentRoot,
        });

        res.setHeader("Content-Type", "image/webp");
        res.setHeader("Cache-Control", "no-store");
        res.setHeader("X-Screenshot-Url", captureUrl);
        if (browserMsUsed != null) {
          res.setHeader("X-Browser-Ms-Used", String(browserMsUsed));
        }
        res.setHeader("X-Screenshot-Png-Bytes", String(pngBytes));
        res.send(webp);
      } catch (shotErr: any) {
        const raw = String(shotErr?.message || shotErr);
        const isTimeout = /timeout/i.test(raw);
        const isTryCloudflare = /\.trycloudflare\.com/i.test(captureUrl);
        if (isTimeout) {
          return res.status(504).json({
            error: isTryCloudflare
              ? `Cloudflare Browser Run could not load ${captureUrl} within ${timeoutMs / 1000}s. Quick tunnels (*.trycloudflare.com) often cannot be reached from Browser Rendering even when they work in your browser. Use a named Cloudflare Tunnel on your own hostname, or point SITE_URL at staging/production.`
              : `Cloudflare Browser Run timed out loading ${captureUrl} (${timeoutMs / 1000}s). Confirm SITE_URL is publicly reachable from the internet (not only your LAN).`,
          });
        }
        throw shotErr;
      }
    } catch (err: any) {
      res.status(500).json({ error: err?.message || "Test screenshot failed" });
    }
  });

  app.put("/api/settings/search-console", async (req, res) => {
    const auth = await requireCapability(req, res, "seo_settings");
    if (!auth.authorized) return;
    try {
      const schema = z.object({
        site_url: z.string().min(1),
      });
      const parsed = schema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ error: "Invalid request body", details: parsed.error.flatten() });
      }
      const contentRoot = getContentRoot(res);
      const searchConsole = updateSearchConsoleSettings(parsed.data, contentRoot);
      markFileAsModified("settings.yml", undefined, undefined, contentRoot);
      res.json({ success: true, site_url: searchConsole.site_url });
    } catch (err: any) {
      res.status(400).json({ error: err.message || String(err) });
    }
  });

  app.get("/api/settings/search-console/bigquery", async (req, res) => {
    const auth = await requireCapability(req, res, "seo_settings");
    if (!auth.authorized) return;
    const { getGscBigQueryConfigStatus } = await import("../gsc-bigquery-client");
    res.json(getGscBigQueryConfigStatus(getContentRoot(res)));
  });

  app.put("/api/settings/search-console/bigquery", async (req, res) => {
    const auth = await requireCapability(req, res, "seo_settings");
    if (!auth.authorized) return;
    try {
      const body = req.body?.bigquery ?? req.body;
      if (!body || typeof body !== "object" || Array.isArray(body)) {
        return res.status(400).json({ error: "Request body must be a bigquery object" });
      }
      const contentRoot = getContentRoot(res);
      updateSearchConsoleBigQuerySettings(body, contentRoot);
      markFileAsModified("settings.yml", undefined, undefined, contentRoot);
      const { getGscBigQueryConfigStatus } = await import("../gsc-bigquery-client");
      res.json({ success: true, ...getGscBigQueryConfigStatus(contentRoot) });
    } catch (err: any) {
      res.status(400).json({ error: err.message || String(err) });
    }
  });

  app.post("/api/settings/search-console/bigquery/test", async (req, res) => {
    const auth = await requireCapability(req, res, "seo_settings");
    if (!auth.authorized) return;
    try {
      const { testGscBigQueryConnection } = await import("../gsc-bigquery-client");
      const result = await testGscBigQueryConnection(getContentRoot(res));
      res.status(result.ok ? 200 : 400).json(result);
    } catch (err: any) {
      res.status(500).json({
        ok: false,
        error: err?.message || String(err),
        elapsed_ms: 0,
        warnings: [],
      });
    }
  });

  app.get("/api/settings/robots", (req, res) => {
    try {
      const contentRoot = getContentRoot(res);
      const robots = getRobotsSettings(contentRoot);
      function getRobotsBaseUrl(): string {
        if (process.env.SITE_URL) return process.env.SITE_URL.replace(/\/$/, "");
        if (process.env.REPLIT_DEV_DOMAIN) return `https://${process.env.REPLIT_DEV_DOMAIN}`;
        return "http://localhost:5000";
      }
      res.json({
        ...robots,
        robots_txt_preview: buildRobotsTxtContent(robots, getRobotsBaseUrl()),
      });
    } catch (err: any) {
      res.status(500).json({ error: err?.message || "Failed to load robots settings" });
    }
  });

  app.put("/api/settings/robots", (req, res) => {
    try {
      const schema = z.object({
        block_indexing: z.boolean().optional(),
        include_sitemap: z.boolean().optional(),
        disallow_paths: z.array(z.string()).optional(),
        ai_bots: z.array(z.string()).optional(),
      });
      const parsed = schema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ error: "Invalid request body", details: parsed.error.flatten() });
      }
      const contentRoot = getContentRoot(res);
      const robots = updateRobotsSettings(parsed.data, contentRoot);
      markFileAsModified("settings.yml", undefined, undefined, contentRoot);
      clearSitemapCache();
      function getRobotsBaseUrl(): string {
        if (process.env.SITE_URL) return process.env.SITE_URL.replace(/\/$/, "");
        if (process.env.REPLIT_DEV_DOMAIN) return `https://${process.env.REPLIT_DEV_DOMAIN}`;
        return "http://localhost:5000";
      }
      res.json({
        success: true,
        ...robots,
        robots_txt_preview: buildRobotsTxtContent(robots, getRobotsBaseUrl()),
      });
    } catch (err: any) {
      res.status(400).json({ error: err.message || String(err) });
    }
  });

  app.get("/api/settings/optimization/ipn/recent", async (req, res) => {
    const auth = await requireCapability(req, res, "metrics_view");
    if (!auth.authorized) return;
    res.json({
      limit: IPN_RECENT_CALLS_LIMIT,
      calls: getIpnRecentCalls(),
    });
  });

  app.delete("/api/settings/optimization/ipn/recent", async (req, res) => {
    const auth = await requireMutatingStaff(req, res);
    if (!auth.authorized) return;
    clearIpnRecentCalls();
    res.json({ success: true, calls: [] });
  });

  app.post("/api/settings/optimization/test", async (req, res) => {
    const auth = await requireMutatingStaff(req, res);
    if (!auth.authorized) return;
    const { url: rawUrl } = req.body;
    if (!rawUrl || typeof rawUrl !== "string") {
      return res.status(400).json({ reachable: false, reason: "No URL provided." });
    }

    let parsed: URL;
    try {
      parsed = new URL(rawUrl.trim());
    } catch {
      return res.status(400).json({ reachable: false, reason: "Invalid URL — could not be parsed." });
    }

    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      return res.status(400).json({ reachable: false, reason: "URL must use http or https protocol." });
    }

    const testUrl = `${parsed.protocol}//${parsed.host}/healthy`;

    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 8000);
      let probeRes: Response;
      try {
        probeRes = await fetch(testUrl, {
          method: "GET",
          signal: controller.signal,
          headers: { "User-Agent": "sGTM-connection-test/1.0" },
          redirect: "follow",
        });
      } finally {
        clearTimeout(timer);
      }

      const status = probeRes.status;
      if (status >= 200 && status < 400) {
        return res.json({ reachable: true });
      } else if (status >= 400 && status < 500) {
        return res.json({ reachable: false, reason: `HTTP ${status} — server responded but returned a client error. Check that the URL is correct.` });
      } else {
        return res.json({ reachable: false, reason: `HTTP ${status} — server returned an unexpected response.` });
      }
    } catch (err: any) {
      if (err.name === "AbortError") {
        return res.json({ reachable: false, reason: "Connection timed out (8 s). Check the URL and network." });
      }
      const msg: string = err.message || String(err);
      if (msg.includes("ENOTFOUND") || msg.includes("EAI_AGAIN")) {
        return res.json({ reachable: false, reason: `DNS resolution failed — hostname "${parsed.hostname}" not found.` });
      }
      if (msg.includes("ECONNREFUSED")) {
        return res.json({ reachable: false, reason: `Connection refused at ${parsed.host}.` });
      }
      return res.json({ reachable: false, reason: msg });
    }
  });
  // Menus API - list all menu files (excludes translation files like .es.yml)
  app.get("/api/menus", (_req, res) => {
    const menusDir = path.join(getContentRoot(res), "menus");

    if (!fs.existsSync(menusDir)) {
      res.json({ menus: [] });
      return;
    }

    // Filter for .yml/.yaml files, excluding translation files (e.g., main-navbar.es.yml)
    const translationPattern = /\.[a-z]{2}\.(yml|yaml)$/;
    const files = fs
      .readdirSync(menusDir)
      .filter(
        (f) =>
          (f.endsWith(".yml") || f.endsWith(".yaml")) &&
          !translationPattern.test(f),
      );

    const menus = files.map((file) => {
      const name = file.replace(/\.(yml|yaml)$/, "");
      return { name, file };
    });

    res.json({ menus });
  });

  // Create a new menu file
  app.post("/api/menus", (req, res) => {
    const { name, type } = req.body || {};

    if (!name || typeof name !== "string") {
      res.status(400).json({ error: "name is required" });
      return;
    }

    // Validate slug: lowercase letters, numbers, hyphens only
    const slugPattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
    if (!slugPattern.test(name)) {
      res.status(400).json({ error: "name must be a valid slug (lowercase letters, numbers, and hyphens only)" });
      return;
    }

    const resolvedType = type || "navbar";
    if (resolvedType !== "navbar" && resolvedType !== "footer") {
      res.status(400).json({ error: "type must be 'navbar' or 'footer'" });
      return;
    }

    const menusDir = path.join(getContentRoot(res), "menus");

    if (!fs.existsSync(menusDir)) {
      fs.mkdirSync(menusDir, { recursive: true });
    }

    const fileName = `${name}.yml`;
    const filePath = path.join(menusDir, fileName);
    const filePathYaml = path.join(menusDir, `${name}.yaml`);

    if (fs.existsSync(filePath) || fs.existsSync(filePathYaml)) {
      res.status(409).json({ error: `A menu named '${name}' already exists` });
      return;
    }

    const scaffold =
      resolvedType === "navbar"
        ? `navbar:\n  items: []\n`
        : `footer:\n  columns: []\n`;

    fs.writeFileSync(filePath, scaffold, "utf8");
    markFileAsModified(filePath, undefined, undefined, getContentRoot(res));

    res.status(201).json({ name, file: fileName });
  });

  app.get("/api/menus/:name/usage", (req, res) => { // eslint-disable-line @typescript-eslint/no-unused-vars
    try {
      const { name } = req.params;
      const configs = getAllConfigs(getContentRoot(res));
      const defaultContentTypes: { name: string; position: "top" | "bottom" | "both" }[] = [];
      for (const [typeName, config] of Object.entries(configs)) {
        const top = config.layout?.menu?.top === name;
        const bottom = config.layout?.menu?.bottom === name;
        if (top && bottom) {
          defaultContentTypes.push({ name: typeName, position: "both" });
        } else if (top) {
          defaultContentTypes.push({ name: typeName, position: "top" });
        } else if (bottom) {
          defaultContentTypes.push({ name: typeName, position: "bottom" });
        }
      }

      const rawOverrides = getCI(res).getMenuUsageByMenuId(name);
      const overrides = rawOverrides.filter(o => {
        const matchesDefault = defaultContentTypes.some(
          d => d.name === o.contentType && (d.position === "both" || d.position === o.position)
        );
        if (matchesDefault && o.source === "_common.yml") return false;
        return true;
      });

      res.json({ defaultContentTypes, overrides });
    } catch (err) {
      res.status(500).json({ error: String(err) });
    }
  });

  app.delete("/api/menus/:name", (req, res) => {
    try {
      const { name } = req.params;

      // Validate name is a safe slug — same rule as POST /api/menus
      const slugPattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
      if (!slugPattern.test(name)) {
        res.status(400).json({ error: "Invalid menu name" });
        return;
      }

      const menusDir = path.join(getContentRoot(res), "menus");

      // Find main file (yml or yaml)
      const mainYml = path.join(menusDir, `${name}.yml`);
      const mainYaml = path.join(menusDir, `${name}.yaml`);
      const mainFile = fs.existsSync(mainYml) ? mainYml : fs.existsSync(mainYaml) ? mainYaml : null;

      if (!mainFile) {
        res.status(404).json({ error: `Menu "${name}" not found` });
        return;
      }

      type LayoutObj = Record<string, unknown> & { menu?: { top?: string | null; bottom?: string | null } };

      const cleanMenuRef = (parsed: Record<string, unknown>, position: "top" | "bottom" | "both"): boolean => {
        const layout = parsed.layout as LayoutObj | undefined;
        if (!layout?.menu) return false;
        let changed = false;
        if ((position === "top" || position === "both") && layout.menu.top === name) {
          delete layout.menu.top;
          changed = true;
        }
        if ((position === "bottom" || position === "both") && layout.menu.bottom === name) {
          delete layout.menu.bottom;
          changed = true;
        }
        if (changed) {
          if (Object.keys(layout.menu).length === 0) delete layout.menu;
          if (Object.keys(layout).length === 0) delete parsed.layout;
        }
        return changed;
      };

      const contentRoot = getContentRoot(res);

      // 1. Clean up layout references in content-types.yml
      const configs = getAllConfigs(contentRoot);
      for (const [typeName, config] of Object.entries(configs)) {
        const top = config.layout?.menu?.top === name;
        const bottom = config.layout?.menu?.bottom === name;
        if (!top && !bottom) continue;

        const currentMenu = config.layout?.menu || {};
        const newMenu: { top?: string | null; bottom?: string | null } = {
          top: top ? null : (currentMenu.top ?? null),
          bottom: bottom ? null : (currentMenu.bottom ?? null),
        };
        updateContentTypeConfig(typeName, { layout: { menu: newMenu } }, contentRoot);

        // Also clean any page-level overrides for this content type
        const position: "top" | "bottom" | "both" = top && bottom ? "both" : top ? "top" : "bottom";
        const slugs = getCI(res).listContentSlugs(typeName);
        for (const slug of slugs) {
          const commonPath = getCI(res).getCommonFilePath(typeName, slug);
          if (!fs.existsSync(commonPath)) continue;
          try {
            const raw = fs.readFileSync(commonPath, "utf-8");
            const parsed = yaml.load(raw) as Record<string, unknown> | null;
            if (!parsed) continue;
            if (cleanMenuRef(parsed, position)) {
              fs.writeFileSync(commonPath, yaml.dump(parsed, { lineWidth: 120, noRefs: true }), "utf-8");
              markFileAsModified(commonPath, undefined, undefined, contentRoot);
            }
          } catch {}
        }
      }

      // 2. Clean page-level overrides not covered by content-type defaults above
      const rawOverrides = getCI(res).getMenuUsageByMenuId(name);
      for (const override of rawOverrides) {
        const commonPath = getCI(res).getCommonFilePath(override.contentType, override.slug);
        if (!fs.existsSync(commonPath)) continue;
        try {
          const raw = fs.readFileSync(commonPath, "utf-8");
          const parsed = yaml.load(raw) as Record<string, unknown> | null;
          if (!parsed) continue;
          if (cleanMenuRef(parsed, override.position)) {
            fs.writeFileSync(commonPath, yaml.dump(parsed, { lineWidth: 120, noRefs: true }), "utf-8");
            markFileAsModified(commonPath, undefined, undefined, contentRoot);
          }
        } catch {}
      }

      // 3. Delete the main file and any translation variant files
      fs.unlinkSync(mainFile);
      markFileAsModified(mainFile, undefined, undefined, contentRoot);
      try {
        // Safe: name is already validated as a slug (no special regex chars)
        const translationPattern = new RegExp(`^${name}\\.[a-z]{2}(?:\\.[a-z]{2})?\\.(yml|yaml)$`);
        const dir = fs.readdirSync(menusDir);
        for (const f of dir) {
          if (translationPattern.test(f)) {
            const translationPath = path.join(menusDir, f);
            fs.unlinkSync(translationPath);
            markFileAsModified(translationPath, undefined, undefined, contentRoot);
          }
        }
      } catch {}

      getCI(res).refresh();
      res.json({ success: true });
    } catch (err) {
      res.status(500).json({ error: String(err) });
    }
  });

  app.put("/api/content-types/:type/layout", async (req, res) => {
    try {
      const { type } = req.params;
      const auth = await requireCapability(req, res, "content_types_manage");
      if (!auth.authorized) return;
      const contentRoot = getContentRoot(res);
      const config = getContentTypeConfig(type, contentRoot);
      if (!config) {
        res.status(404).json({ error: `Content type "${type}" not found` });
        return;
      }
      const body = req.body;
      if (!body?.menu || typeof body.menu !== "object") {
        res.status(400).json({ error: "Request body must include { menu: { top?: string|null, bottom?: string|null } }" });
        return;
      }

      for (const key of ["top", "bottom"] as const) {
        if (key in body.menu && body.menu[key] !== null && typeof body.menu[key] !== "string") {
          res.status(400).json({ error: `menu.${key} must be a string or null` });
          return;
        }
      }

      const currentLayout = config.layout?.menu || { top: null, bottom: null };
      const newMenu: { top?: string | null; bottom?: string | null } = {};
      if ("top" in body.menu) newMenu.top = body.menu.top;
      else newMenu.top = currentLayout.top;
      if ("bottom" in body.menu) newMenu.bottom = body.menu.bottom;
      else newMenu.bottom = currentLayout.bottom;

      updateContentTypeConfig(type, { layout: { menu: newMenu } }, contentRoot);

      const slugs = getCI(res).listContentSlugs(type);
      for (const slug of slugs) {
        const commonPath = getCI(res).getCommonFilePath(type, slug);
        if (!fs.existsSync(commonPath)) continue;
        try {
          const raw = fs.readFileSync(commonPath, "utf-8");
          const parsed = yaml.load(raw) as Record<string, unknown> | null;
          if (!parsed?.layout) continue;
          const layout = parsed.layout as { menu?: { top?: string | null; bottom?: string | null } };
          if (!layout.menu) continue;
          let changed = false;
          if ("top" in body.menu && layout.menu.top !== undefined) {
            delete layout.menu.top;
            changed = true;
          }
          if ("bottom" in body.menu && layout.menu.bottom !== undefined) {
            delete layout.menu.bottom;
            changed = true;
          }
          if (changed) {
            if (Object.keys(layout.menu).length === 0) {
              delete (parsed.layout as any).menu;
            }
            if (Object.keys(parsed.layout as any).length === 0) {
              delete parsed.layout;
            }
            fs.writeFileSync(commonPath, yaml.dump(parsed, { lineWidth: 120, noRefs: true }), "utf-8");
            markFileAsModified(commonPath, undefined, undefined, contentRoot);
          }
        } catch {}
      }

      getCI(res).refresh();
      invalidateContentCaches(type);
      res.json({ success: true });
    } catch (err) {
      res.status(500).json({ error: String(err) });
    }
  });

  app.get("/api/menus/:name", (req, res) => {
    const { name } = req.params;
    const locale = req.query.locale as string | undefined;
    const menusDir = path.join(getContentRoot(res), "menus");

    let filePath: string | null = null;

    if (locale && locale !== getDefaultLocale(getContentRoot(res))) {
      const localizedBase = `${name}.${locale}`;
      const localizedYml = path.join(menusDir, `${localizedBase}.yml`);
      const localizedYaml = path.join(menusDir, `${localizedBase}.yaml`);
      if (fs.existsSync(localizedYml)) filePath = localizedYml;
      else if (fs.existsSync(localizedYaml)) filePath = localizedYaml;
    }

    if (!filePath) {
      const baseYml = path.join(menusDir, `${name}.yml`);
      const baseYaml = path.join(menusDir, `${name}.yaml`);
      if (fs.existsSync(baseYml)) filePath = baseYml;
      else if (fs.existsSync(baseYaml)) filePath = baseYaml;
    }

    if (!filePath) {
      res.status(404).json({ error: "Menu not found" });
      return;
    }

    try {
      const content = fs.readFileSync(filePath, "utf-8");
      const data = safeYamlLoad(content);
      const raw = req.query.raw === "true";
      if (raw) {
        res.json({ name, locale: locale || "en", data });
        return;
      }

      const context = {
        locale: locale || "en",
        location: req.query.location as string | undefined,
        region: req.query.region as string | undefined,
      };
      const resolved = resolveAllTemplateVars(data, {
        contentRoot: getContentRoot(res),
        context,
        skipSiteVars: false,
      });
      res.json({ name, locale: locale || "en", data: resolved });
    } catch (error) {
      log.error({ err: error }, `Error loading menu ${name}:`);
      res.status(500).json({ error: "Failed to parse menu file" });
    }
  });

  // DEPRECATED: Old menu save endpoint - redirect to new separated endpoints
  // Use PUT /api/menus/:name/structure for structural changes (English only, propagates to translations)
  // Use PUT /api/menus/:name/translations?locale=xx for text-only changes
  app.post("/api/menus/:name", (req, res) => {
    res.status(410).json({
      error:
        "This endpoint is deprecated. Use the separated endpoints instead.",
      alternatives: {
        structure:
          "PUT /api/menus/:name/structure - For structural changes (English only, propagates to translations)",
        translations:
          "PUT /api/menus/:name/translations?locale=xx - For text-only changes",
      },
    });
  });

  // Helper function to sync menu structure from English (master) to translation
  function syncMenuStructure(
    master: any,
    translation: any,
    previousMaster?: any,
  ): any {
    if (master?.footer) {
      return syncFooterStructure(master, translation || {}, previousMaster);
    }

    if (!master?.navbar?.items || !translation?.navbar?.items) {
      return translation;
    }

    const masterItems = master.navbar.items;
    const translationItems = translation.navbar.items;
    const syncedItems: any[] = [];

    for (let i = 0; i < masterItems.length; i++) {
      const masterItem = masterItems[i];
      const existingTranslation = translationItems[i];

      if (existingTranslation) {
        const syncedItem = syncMenuItem(masterItem, existingTranslation);
        syncedItems.push(syncedItem);
      } else {
        const newItem = createTranslationPlaceholder(masterItem);
        syncedItems.push(newItem);
      }
    }

    return { navbar: { items: syncedItems } };
  }

  function syncFooterStructure(
    master: any,
    translation: any,
    previousMaster?: any,
  ): any {
    const mf = master.footer;
    const tf = translation.footer || {};
    const pf = previousMaster?.footer || {};
    const result: any = {};

    result.columns = (tf.columns || []).map((transCol: any) => ({
      title: transCol.title,
      items: (transCol.items || []).map((transItem: any) => ({
        label: transItem.label,
        href: transItem.href,
      })),
    }));

    if (mf.columns) {
      const prevColumns = pf.columns || [];
      const prevColTitleToIndex = new Map<string, number>();
      const prevItemsByIndex = new Map<number, Set<string>>();
      for (let i = 0; i < prevColumns.length; i++) {
        prevColTitleToIndex.set(prevColumns[i].title, i);
        prevItemsByIndex.set(
          i,
          new Set((prevColumns[i].items || []).map((it: any) => it.label)),
        );
      }

      for (const masterCol of mf.columns) {
        const prevIndex = prevColTitleToIndex.get(masterCol.title);
        const itemsPerColumn =
          typeof masterCol.items_per_column === "number" &&
          masterCol.items_per_column >= 1
            ? masterCol.items_per_column
            : undefined;

        if (prevIndex === undefined) {
          const newCol: any = {
            title: `[TRANSLATE] ${masterCol.title}`,
            items: (masterCol.items || []).map((item: any) => ({
              label: `[TRANSLATE] ${item.label}`,
              href: item.href,
            })),
          };
          if (itemsPerColumn !== undefined) {
            newCol.items_per_column = itemsPerColumn;
          }
          result.columns.push(newCol);
        } else {
          if (result.columns[prevIndex]) {
            if (itemsPerColumn !== undefined) {
              result.columns[prevIndex].items_per_column = itemsPerColumn;
            } else {
              delete result.columns[prevIndex].items_per_column;
            }
          }

          const prevItems = prevItemsByIndex.get(prevIndex) || new Set();
          const newItems = (masterCol.items || []).filter(
            (item: any) => !prevItems.has(item.label),
          );

          if (newItems.length > 0 && result.columns[prevIndex]) {
            for (const newItem of newItems) {
              result.columns[prevIndex].items.push({
                label: `[TRANSLATE] ${newItem.label}`,
                href: newItem.href,
              });
            }
          }
        }
      }
    }

    result.socials = (tf.socials || []).map((transSocial: any) => ({
      name: transSocial.name,
      icon: transSocial.icon,
      link: transSocial.link,
    }));

    if (mf.socials) {
      const prevSocialIcons = new Set(
        (pf.socials || []).map((s: any) => s.icon),
      );
      for (const masterSocial of mf.socials) {
        if (!prevSocialIcons.has(masterSocial.icon)) {
          result.socials.push({
            name: masterSocial.name,
            icon: masterSocial.icon,
            link: masterSocial.link,
          });
        }
      }
    }

    result.legal_links = (tf.legal_links || []).map((transLink: any) => ({
      label: transLink.label,
      href: transLink.href,
    }));

    if (mf.legal_links) {
      const prevLegalLabels = new Set(
        (pf.legal_links || []).map((l: any) => l.label),
      );
      for (const masterLink of mf.legal_links) {
        if (!prevLegalLabels.has(masterLink.label)) {
          result.legal_links.push({
            label: `[TRANSLATE] ${masterLink.label}`,
            href: masterLink.href,
          });
        }
      }
    }

    if (mf.subscribe_text !== undefined) {
      result.subscribe_text =
        tf.subscribe_text || `[TRANSLATE] ${mf.subscribe_text}`;
    }
    if (mf.copyright_text !== undefined) {
      result.copyright_text =
        tf.copyright_text || `[TRANSLATE] ${mf.copyright_text}`;
    }

    return { footer: result };
  }

  function syncMenuItem(master: any, translation: any): any {
    const result: any = {
      // TEXT field - from translation
      label: translation.label || `[TRANSLATE] ${master.label}`,
      // STRUCTURE fields - ALWAYS from master
      href: master.href,
      component: master.component,
    };

    if (master.variant !== undefined) {
      result.variant = master.variant;
    }

    applyLogoStructureFromMaster(master, result);

    if (master.dropdown) {
      result.dropdown = syncDropdown(
        master.dropdown,
        translation.dropdown || {},
      );
    }

    return result;
  }

  function syncDropdown(master: any, translation: any): any {
    const result: any = {
      type: master.type,
      title: translation.title || `[TRANSLATE] ${master.title}`,
      description:
        translation.description || `[TRANSLATE] ${master.description}`,
    };

    if (master.icon) result.icon = master.icon;

    // Sync items array (for cards and simple-list types)
    if (master.items) {
      result.items = master.items.map((masterItem: any, idx: number) => {
        const transItem = translation.items?.[idx] || {};
        return syncDropdownItem(masterItem, transItem);
      });
    }

    // Sync columns (for columns type)
    if (master.columns) {
      result.columns = master.columns.map((masterCol: any, idx: number) => {
        const transCol = translation.columns?.[idx] || {};
        return {
          title: transCol.title || `[TRANSLATE] ${masterCol.title}`,
          items: masterCol.items.map((masterItem: any, itemIdx: number) => {
            const transItem = transCol.items?.[itemIdx] || {};
            return {
              // TEXT field - from translation
              label: transItem.label || `[TRANSLATE] ${masterItem.label}`,
              // STRUCTURE field - ALWAYS from master
              href: masterItem.href,
            };
          }),
        };
      });
    }

    // Sync groups (for grouped-list type)
    if (master.groups) {
      result.groups = master.groups.map((masterGroup: any, idx: number) => {
        const transGroup = translation.groups?.[idx] || {};
        return {
          // TEXT field - from translation
          title: transGroup.title || `[TRANSLATE] ${masterGroup.title}`,
          items: masterGroup.items.map((masterItem: any, itemIdx: number) => {
            const transItem = transGroup.items?.[itemIdx] || {};
            return {
              // TEXT field - from translation
              label: transItem.label || `[TRANSLATE] ${masterItem.label}`,
              // STRUCTURE field - ALWAYS from master
              href: masterItem.href,
            };
          }),
        };
      });
    }

    // Sync footer
    if (master.footer) {
      result.footer = {
        // TEXT fields - from translation
        text: translation.footer?.text || `[TRANSLATE] ${master.footer.text}`,
        linkText:
          translation.footer?.linkText ||
          `[TRANSLATE] ${master.footer.linkText}`,
        // STRUCTURE field - ALWAYS from master
        href: master.footer.href,
      };
    }

    return result;
  }

  function syncDropdownItem(master: any, translation: any): any {
    const result: any = {};

    // TEXT fields - from translation if provided
    if (master.title !== undefined) {
      result.title = translation.title || `[TRANSLATE] ${master.title}`;
    }
    if (master.label !== undefined) {
      result.label = translation.label || `[TRANSLATE] ${master.label}`;
    }
    if (master.description !== undefined) {
      result.description =
        translation.description || `[TRANSLATE] ${master.description}`;
    }
    if (master.cta !== undefined) {
      result.cta = translation.cta || `[TRANSLATE] ${master.cta}`;
    }
    // STRUCTURE field - ALWAYS from master
    if (master.href !== undefined) {
      result.href = master.href;
    }
    if (master.icon !== undefined) {
      result.icon = master.icon;
    }

    return result;
  }

  function createTranslationPlaceholder(master: any): any {
    const result: any = {
      label: `[TRANSLATE] ${master.label}`,
      href: master.href,
      component: master.component,
    };

    applyLogoStructureFromMaster(master, result);

    if (master.dropdown) {
      result.dropdown = syncDropdown(master.dropdown, {});
    }

    return result;
  }

  // Structure endpoint - Only for English, propagates to all translation files
  // Used for: reordering items, adding/deleting items, changing icons, changing hrefs
  app.put("/api/menus/:name/structure", (req, res) => {
    const { name } = req.params;
    const { data, author } = req.body;
    const authorName = author && typeof author === "string" ? author : undefined;

    if (!data) {
      res.status(400).json({ error: "Missing data in request body" });
      return;
    }

    const menusDir = path.join(getContentRoot(res), "menus");

    // Structure changes can ONLY be made to English (master) file
    let filePath = path.join(menusDir, `${name}.yml`);
    if (!fs.existsSync(filePath)) {
      filePath = path.join(menusDir, `${name}.yaml`);
    }
    if (!fs.existsSync(filePath)) {
      filePath = path.join(menusDir, `${name}.yml`);
    }

    try {
      let previousData: any = null;
      if (fs.existsSync(filePath)) {
        try {
          const previousContent = fs.readFileSync(filePath, "utf-8");
          previousData = safeYamlLoad(previousContent) as any;
        } catch (e) {}
      }

      const yamlContent = safeYamlDump(data, {
        indent: 2,
        lineWidth: -1,
        noRefs: true,
        sortKeys: false,
      });
      const contentRoot = getContentRoot(res);
      fs.writeFileSync(filePath, yamlContent, "utf-8");
      markFileAsModified(filePath, authorName, undefined, contentRoot);

      const syncResults: Record<string, string> = {};
      const translationLocales = ["es", "fr", "de", "pt", "it"];

      for (const targetLocale of translationLocales) {
        const translationFileName = `${name}.${targetLocale}.yml`;
        const translationFilePath = path.join(menusDir, translationFileName);

        if (fs.existsSync(translationFilePath)) {
          try {
            const translationContent = fs.readFileSync(
              translationFilePath,
              "utf-8",
            );
            const translationData = safeYamlLoad(translationContent) as any;

            const syncedData = syncMenuStructure(
              data,
              translationData,
              previousData,
            );

            const syncedYaml = safeYamlDump(syncedData, {
              indent: 2,
              lineWidth: -1,
              noRefs: true,
              sortKeys: false,
            });
            fs.writeFileSync(translationFilePath, syncedYaml, "utf-8");
            markFileAsModified(translationFilePath, authorName, undefined, contentRoot);
            syncResults[targetLocale] = "synced";
          } catch (syncError) {
            log.error(
              `Error syncing structure to ${targetLocale}:`,
              syncError,
            );
            syncResults[targetLocale] = "error";
          }
        }
      }

      res.json({
        success: true,
        name,
        endpoint: "structure",
        syncResults,
        message: "Structure updated in English and synced to all translations",
      });
    } catch (error) {
      log.error({ err: error }, `Error saving menu structure ${name}:`);
      res.status(500).json({ error: "Failed to save menu structure" });
    }
  });

  // Translations endpoint - For any locale, only updates text fields
  // Used for: updating title, description, label, cta text
  // CANNOT modify structure (item count, order, icons, hrefs)
  app.put("/api/menus/:name/translations", (req, res) => {
    const { name } = req.params;
    const locale = req.query.locale as string;
    const { data, author } = req.body;
    const authorName = author && typeof author === "string" ? author : undefined;

    if (!data) {
      res.status(400).json({ error: "Missing data in request body" });
      return;
    }

    if (!locale) {
      res.status(400).json({ error: "Locale query parameter is required" });
      return;
    }

    const menusDir = path.join(getContentRoot(res), "menus");
    const isDefaultLocale = locale === getDefaultLocale(getContentRoot(res));

    // Build filename based on locale
    const fileBaseName = isDefaultLocale ? name : `${name}.${locale}`;

    let filePath = path.join(menusDir, `${fileBaseName}.yml`);
    if (!fs.existsSync(filePath)) {
      filePath = path.join(menusDir, `${fileBaseName}.yaml`);
    }
    if (!fs.existsSync(filePath)) {
      filePath = path.join(menusDir, `${fileBaseName}.yml`);
    }

    // Translations endpoint is for text and link changes in ANY locale (including English)
    // For structure changes (icon, add/delete), use the /structure endpoint instead
    const masterFilePath = path.join(menusDir, `${name}.yml`);
    if (!fs.existsSync(masterFilePath)) {
      res.status(400).json({
        error: "English master file not found. Cannot update translations.",
      });
      return;
    }

    let dataToSave = data;

    const isFooterMenu = data?.footer && !data?.navbar;

    if (isFooterMenu && !isDefaultLocale) {
      dataToSave = data;
    } else {
      try {
        const masterContent = fs.readFileSync(masterFilePath, "utf-8");
        const masterData = safeYamlLoad(masterContent) as any;

        dataToSave = mergeTextOnlyFromTranslation(masterData, data);
      } catch (e) {
        log.error({ err: e }, "Error syncing translation to master structure:");
        res
          .status(500)
          .json({ error: "Failed to sync translation with master structure" });
        return;
      }
    }

    try {
      const yamlContent = safeYamlDump(dataToSave, {
        indent: 2,
        lineWidth: -1,
        noRefs: true,
        sortKeys: false,
      });
      fs.writeFileSync(filePath, yamlContent, "utf-8");
      markFileAsModified(filePath, authorName, undefined, getContentRoot(res));

      res.json({
        success: true,
        name,
        locale,
        endpoint: "translations",
        message: isDefaultLocale
          ? "English text updated"
          : `${locale} translations updated`,
      });
    } catch (error) {
      log.error({ err: error }, `Error saving menu translations ${name}:`);
      res.status(500).json({ error: "Failed to save menu translations" });
    }
  });

  // STRICT text-only merge: Deep-clone master, overlay ONLY translatable fields from translation
  // Translatable fields: label, title, description, cta, text, linkText, href
  // ALL other fields preserved from master (including unknown/extra keys)
  const TEXT_FIELDS = new Set([
    "label",
    "title",
    "description",
    "cta",
    "text",
    "linkText",
    "href",
  ]);

  function mergeTextOnlyFromTranslation(master: any, translation: any): any {
    if (!master?.navbar?.items && !master?.footer) {
      throw new Error(
        "Master file is missing navbar.items or footer structure",
      );
    }

    // For footer files, use the footer-aware structure sync which preserves translations
    if (master?.footer && !master?.navbar) {
      return syncFooterStructure(master, translation || {});
    }

    // Deep clone master to preserve ALL structure
    const result = JSON.parse(JSON.stringify(master));

    // Overlay text fields from translation onto the cloned master (starting at root)
    if (translation) {
      overlayTextFieldsOnObject(result, translation);
    }

    // Marquee config is locale-specific — if the translation carries its own
    // navbar.marquee block, use it wholesale instead of the English master's.
    if (translation?.navbar?.marquee !== undefined) {
      if (!result.navbar) result.navbar = {};
      result.navbar.marquee = translation.navbar.marquee;
    }

    return result;
  }

  function overlayTextFieldsOnItems(
    masterItems: any[],
    translationItems: any[],
  ): void {
    for (
      let i = 0;
      i < masterItems.length && i < translationItems.length;
      i++
    ) {
      overlayTextFieldsOnObject(masterItems[i], translationItems[i]);
    }
  }

  function overlayTextFieldsOnObject(master: any, translation: any): void {
    if (
      !master ||
      !translation ||
      typeof master !== "object" ||
      typeof translation !== "object"
    ) {
      return;
    }

    // Overlay text fields from translation onto master
    for (const key of Object.keys(master)) {
      if (TEXT_FIELDS.has(key) && translation[key] !== undefined) {
        // This is a text field - take value from translation
        master[key] = translation[key];
      } else if (
        Array.isArray(master[key]) &&
        Array.isArray(translation[key])
      ) {
        // Recursively process arrays (items, columns, groups, etc.)
        for (
          let i = 0;
          i < master[key].length && i < translation[key].length;
          i++
        ) {
          overlayTextFieldsOnObject(master[key][i], translation[key][i]);
        }
      } else if (
        typeof master[key] === "object" &&
        master[key] !== null &&
        translation[key]
      ) {
        // Recursively process nested objects (dropdown, footer, etc.)
        overlayTextFieldsOnObject(master[key], translation[key]);
      }
      // All other fields (href, icon, component, type, etc.) stay from master
    }
  }

}
