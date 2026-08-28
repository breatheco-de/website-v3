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
import { child } from "../logger";
import { api } from "../rate-limit/api.js";
const log = child({ module: "routes/ai" });


export function registerAiRoutes(app: Express): void {
  // ============================================

  // Adapt content using AI with layered context
  app.post("/api/content/adapt-with-ai", async (req, res) => {
    try {
      const { getContentAdapter } = await import("../ai");

      const {
        contentType,
        contentSlug,
        targetComponent,
        targetVersion,
        targetVariant,
        sourceYaml,
        targetExampleYaml,
        targetStructure,
        userOverrides,
      } = req.body;

      // Validate required fields
      if (
        !contentType ||
        !contentSlug ||
        !targetComponent ||
        !targetVersion ||
        !sourceYaml
      ) {
        res.status(400).json({
          error: "Missing required fields",
          required: [
            "contentType",
            "contentSlug",
            "targetComponent",
            "targetVersion",
            "sourceYaml",
          ],
        });
        return;
      }

      // Validate content type
      if (!isValidType(contentType)) {
        res.status(400).json({
          error: "Invalid content type",
          validTypes: getAllFolders(),
        });
        return;
      }

      const adapter = getContentAdapter();
      // Use structured output for schema-enforced AI responses
      const result = await adapter.adaptStructured({
        contentType,
        contentSlug,
        targetComponent,
        targetVersion,
        targetVariant,
        sourceYaml,
        targetExampleYaml,
        targetStructure,
        userOverrides,
      });

      res.json(result);
    } catch (error) {
      log.error({ err: error }, "AI adaptation error:");
      res.status(500).json({
        error: "AI adaptation failed",
        message: error instanceof Error ? error.message : "Unknown error",
      });
    }
  });

  // Clear AI context cache
  app.post("/api/content/clear-ai-cache", (_req, res) => {
    try {
      const { getContentAdapter } = require("../ai");
      const adapter = getContentAdapter();
      adapter.clearCache();
      res.json({ success: true, message: "AI context cache cleared" });
    } catch (error) {
      res.status(500).json({
        error: "Failed to clear cache",
        message: error instanceof Error ? error.message : "Unknown error",
      });
    }
  });

  app.post("/api/ai/analyze-data-payload", async (req, res) => {
    try {
      const { analyzeDataPayload } = await import(
        "../ai/generateTableFromPayload"
      );

      const { sampleData, availableKeys } = req.body;

      if (
        !sampleData ||
        !Array.isArray(sampleData) ||
        sampleData.length === 0
      ) {
        res.status(400).json({ error: "sampleData must be a non-empty array" });
        return;
      }
      if (
        !availableKeys ||
        !Array.isArray(availableKeys) ||
        availableKeys.length === 0
      ) {
        res
          .status(400)
          .json({ error: "availableKeys must be a non-empty array" });
        return;
      }

      const locale = req.body.locale || getDefaultLocale();
      const analysis = await analyzeDataPayload({
        sampleData,
        availableKeys,
        locale,
      });
      res.json(analysis);
    } catch (error: any) {
      log.error("Error analyzing data payload:", error?.message || error);
      const message = error?.message || "Failed to analyze data";
      res.status(500).json({ error: message });
    }
  });

  app.post("/api/ai/generate-table-from-payload", async (req, res) => {
    try {
      const { generateTableFromPayload } = await import(
        "../ai/generateTableFromPayload"
      );

      const { sampleData, availableKeys, userPrompt } = req.body;

      if (
        !sampleData ||
        !Array.isArray(sampleData) ||
        sampleData.length === 0
      ) {
        res.status(400).json({ error: "sampleData must be a non-empty array" });
        return;
      }
      if (
        !availableKeys ||
        !Array.isArray(availableKeys) ||
        availableKeys.length === 0
      ) {
        res
          .status(400)
          .json({ error: "availableKeys must be a non-empty array" });
        return;
      }
      if (!userPrompt || typeof userPrompt !== "string") {
        res
          .status(400)
          .json({ error: "userPrompt must be a non-empty string" });
        return;
      }

      const locale = req.body.locale || getDefaultLocale();
      const config = await generateTableFromPayload({
        sampleData,
        availableKeys,
        userPrompt,
        locale,
      });
      res.json(config);
    } catch (error: any) {
      log.error("Error generating table config:", error?.message || error);
      const message =
        error?.message || "Failed to generate table configuration";
      res.status(500).json({ error: message });
    }
  });

  app.post("/api/ai/refine-table-config", async (req, res) => {
    try {
      const { refineTableConfig } = await import(
        "../ai/generateTableFromPayload"
      );

      const { currentConfig, sampleData, availableKeys, userFeedback, locale } =
        req.body;

      if (!currentConfig || !currentConfig.columns) {
        res
          .status(400)
          .json({ error: "currentConfig with columns is required" });
        return;
      }
      if (
        !sampleData ||
        !Array.isArray(sampleData) ||
        sampleData.length === 0
      ) {
        res.status(400).json({ error: "sampleData must be a non-empty array" });
        return;
      }
      if (!userFeedback || typeof userFeedback !== "string") {
        res
          .status(400)
          .json({ error: "userFeedback must be a non-empty string" });
        return;
      }

      const config = await refineTableConfig({
        currentConfig,
        sampleData,
        availableKeys: availableKeys || [],
        userFeedback,
        locale: locale || "en",
      });
      res.json(config);
    } catch (error: any) {
      log.error("Error refining table config:", error?.message || error);
      const message = error?.message || "Failed to refine table configuration";
      res.status(500).json({ error: message });
    }
  });

  app.post("/api/ai/generate-global-filter", async (req, res) => {
    try {
      const { generateGlobalFilter } = await import(
        "../ai/generateTableFromPayload"
      );

      const {
        sampleData,
        availableKeys,
        userPrompt,
        currentFilter,
        locale,
        sessionContext,
      } = req.body;

      if (
        !sampleData ||
        !Array.isArray(sampleData) ||
        sampleData.length === 0
      ) {
        res.status(400).json({ error: "sampleData must be a non-empty array" });
        return;
      }
      if (!userPrompt || typeof userPrompt !== "string") {
        res
          .status(400)
          .json({ error: "userPrompt must be a non-empty string" });
        return;
      }

      const result = await generateGlobalFilter({
        sampleData,
        availableKeys: availableKeys || [],
        userPrompt,
        currentFilter: currentFilter || undefined,
        locale: locale || "en",
        sessionContext: sessionContext || undefined,
      });
      res.json(result);
    } catch (error: any) {
      log.error("Error generating global filter:", error?.message || error);
      const message = error?.message || "Failed to generate global filter";
      res.status(500).json({ error: message });
    }
  });

  app.post("/api/ai/generate-json-schema", async (req, res) => {
    try {
      const { generateJsonSchema } = await import("../ai/generateJsonSchema");

      const { fieldName, userPrompt, currentSchema } = req.body;

      if (!fieldName || typeof fieldName !== "string" || !fieldName.trim()) {
        res.status(400).json({ error: "fieldName must be a non-empty string" });
        return;
      }
      if (!userPrompt || typeof userPrompt !== "string" || !userPrompt.trim()) {
        res.status(400).json({ error: "userPrompt must be a non-empty string" });
        return;
      }

      const result = await generateJsonSchema({
        fieldName: fieldName.trim(),
        userPrompt: userPrompt.trim(),
        currentSchema:
          typeof currentSchema === "string" && currentSchema.trim()
            ? currentSchema
            : undefined,
      });
      res.json(result);
    } catch (error: any) {
      log.error("Error generating JSON schema:", error?.message || error);
      const message = error?.message || "Failed to generate JSON schema";
      res.status(500).json({ error: message });
    }
  });

  api.post(app, "/api/ai/generate-role-description", { rate: "expensiveAi" }, async (req, res) => {
    try {
      const auth = await requireCapability(req, res, "users_manage");
      if (!auth.authorized) return;

      const { generateRoleDescription } = await import("../ai/generateRoleDescription");

      const { id, label, capabilities } = req.body;

      if (!label || typeof label !== "string" || !label.trim()) {
        res.status(400).json({ error: "label must be a non-empty string" });
        return;
      }
      if (!Array.isArray(capabilities) || capabilities.length === 0) {
        res.status(400).json({ error: "capabilities must be a non-empty array" });
        return;
      }

      const result = await generateRoleDescription({
        id: typeof id === "string" && id.trim() ? id.trim() : undefined,
        label: label.trim(),
        capabilities,
      });
      res.json(result);
    } catch (error: any) {
      log.error("Error generating role description:", error?.message || error);
      const message = error?.message || "Failed to generate role description";
      const status =
        message.includes("must be") ||
        message.includes("Unknown capability") ||
        message.includes("non-empty")
          ? 400
          : message.includes("Empty response from LLM") ||
              message.includes("LLM refused")
            ? 502
            : 500;
      const clientMessage =
        message.includes("Empty response from LLM")
          ? "The AI model returned no text. Reasoning models often need a chat model (e.g. gpt-4o-mini) in AI settings — try again or switch models."
          : message;
      res.status(status).json({ error: clientMessage });
    }
  });

  // ============================================
  // AI Chat Widget Routes (public)
  // ============================================

  interface ParsedLLMConfig {
    provider?: { api_key_env?: string; base_url_env?: string };
    model?: string | { default: string; chat?: string };
    temperature?: number;
    max_tokens?: number;
    question_tags?: string[];
    agent_tools?: Array<{ name: string; description: string; enabled: boolean }>;
    chat_bubble?: { enabled?: boolean; page_patterns?: string[]; content_types?: string[]; agent_name?: string; agent_icon?: string };
    prompt_role?: string;
    prompt_personality?: string;
    prompt_instructions?: string;
    prompt_fallback?: string;
    empty_conversation_grace_minutes?: number;
  }

  function getContentRoot(res: Response): string {
    return (res.locals.site as any)?.contentRoot ?? getDefaultContentRoot();
  }

  async function getConversationStore(res: Response) {
    const site = res.locals.site as import("../site-manager").SiteContext | undefined;
    if (site?.conversationStore) return site.conversationStore;
    const { conversationStore } = await import("../ai/ConversationStore");
    return conversationStore;
  }

  function loadLLMConfig(contentRoot: string): ParsedLLMConfig {
    const llmPath = path.join(contentRoot, "llm.yml");
    if (!fs.existsSync(llmPath)) return {};
    const raw = yaml.load(fs.readFileSync(llmPath, "utf-8"));
    if (!raw || typeof raw !== "object") return {};
    return raw as ParsedLLMConfig;
  }

  function loadFeatureTags(contentRoot: string): string[] {
    const settingsPath = path.join(contentRoot, "settings.yml");
    if (!fs.existsSync(settingsPath)) return [];
    const raw = yaml.load(fs.readFileSync(settingsPath, "utf-8"));
    if (!raw || typeof raw !== "object") return [];
    const settings = raw as Record<string, unknown>;
    return Array.isArray(settings.feature_tags) ? settings.feature_tags : [];
  }

  function deriveFeatureTags(
    contentType: string | null,
    pageUrl: string | null,
    allTags: string[]
  ): string[] {
    const tags: string[] = [];
    if (contentType && allTags.includes(contentType)) {
      tags.push(contentType);
    }
    if (pageUrl) {
      for (const tag of allTags) {
        if (!tags.includes(tag) && pageUrl.toLowerCase().includes(tag.toLowerCase())) {
          tags.push(tag);
        }
      }
      if (pageUrl.match(/pricing|cost|tuition|financ/i)) {
        if (allTags.includes("pricing") && !tags.includes("pricing")) tags.push("pricing");
        if (allTags.includes("financial-aid") && !tags.includes("financial-aid")) tags.push("financial-aid");
      }
      if (pageUrl.match(/enroll|apply|admission/i)) {
        if (allTags.includes("enrollment") && !tags.includes("enrollment")) tags.push("enrollment");
        if (allTags.includes("admissions") && !tags.includes("admissions")) tags.push("admissions");
      }
      if (pageUrl.match(/career|job|employ/i)) {
        if (allTags.includes("career-services") && !tags.includes("career-services")) tags.push("career-services");
      }
      if (pageUrl.match(/curriculum|syllabus|program/i)) {
        if (allTags.includes("curriculum") && !tags.includes("curriculum")) tags.push("curriculum");
      }
    }
    return tags;
  }

  app.get("/api/chat/config", (req, res) => {
    try {
      const cfg = loadLLMConfig(getContentRoot(res));
      const bubble = cfg.chat_bubble || {};
      res.json({
        enabled: bubble.enabled !== false,
        page_patterns: bubble.page_patterns || [],
        content_types: bubble.content_types || [],
        agent_name: bubble.agent_name || null,
        agent_icon: bubble.agent_icon || null,
      });
    } catch (err) {
      log.error({ err: err }, "[Chat Config] Error:");
      res.json({ enabled: false, page_patterns: [], content_types: [] });
    }
  });


  // ─── Brand Context & Chat API ──────────────────────────────────────────────
  app.get("/api/brand-context", (req, res) => {
    try {
      const filePath = path.join(getContentRoot(res), "brand-context.yml");
      if (!fs.existsSync(filePath)) {
        res.status(404).json({ error: "brand-context.yml not found" });
        return;
      }
      const raw = fs.readFileSync(filePath, "utf-8");
      const parsed = yaml.load(raw);
      res.json(parsed);
    } catch (err) {
      res.status(500).json({ error: "Failed to read brand-context.yml", message: String(err) });
    }
  });

  app.post("/api/chat/start", async (req, res) => {
    try {
      const conversationStore = await getConversationStore(res);
      const { page_url, content_type, content_slug, locale, user_id } = req.body || {};

      const allFeatureTags = loadFeatureTags(getContentRoot(res));
      const derivedTags = deriveFeatureTags(content_type || null, page_url || null, allFeatureTags);

      const conv = await conversationStore.createConversation({
        page_url: page_url || null,
        content_type: content_type || null,
        content_slug: content_slug || null,
        locale: locale || "en",
        feature_tags: derivedTags,
        user_id: user_id || null,
      });

      res.json({ conversation_id: conv.id });
    } catch (err) {
      log.error({ err: err }, "[Chat Start] Error:");
      res.status(500).json({ error: "Failed to start conversation" });
    }
  });

  app.post("/api/chat/message", async (req, res) => {
    try {
      const { getAgentService } = await import("../ai/AgentService");
      const conversationStore = await getConversationStore(res);

      const { conversation_id, message, content_type, content_slug, locale } = req.body || {};

      if (!conversation_id || !message) {
        return res.status(400).json({ error: "conversation_id and message are required" });
      }

      await conversationStore.addMessage({
        conversation_id,
        role: "user",
        content: message,
      });
      const { contentCompiler } = await import("../ai/ContentCompiler");
      const agent = getAgentService();
      const result = await agent.processMessage(
        conversation_id,
        message,
        content_type || null,
        content_slug || null,
        locale || "en",
        conversationStore
      );

      const assistantMsg = await conversationStore.addMessage({
        conversation_id,
        role: "assistant",
        content: result.content,
        question_tag: result.questionTag,
      });

      const compiled = contentCompiler.compile(content_type || null, content_slug || null, locale || "en");
      conversationStore.saveContextSnapshot(conversation_id, {
        pageContext: compiled.pageContext,
        globalSummary: compiled.globalSummary,
        contentType: content_type || null,
        contentSlug: content_slug || null,
        locale: locale || "en",
      }).catch(() => {});

      res.json({
        id: assistantMsg.id,
        content: result.content,
        question_tag: result.questionTag,
        trace: result.trace,
      });
    } catch (err) {
      log.error({ err: err }, "[Chat Message] Error:");
      res.status(500).json({ error: "Failed to process message" });
    }
  });

}
