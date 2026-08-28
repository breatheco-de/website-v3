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
import { canonicalSectionId, sectionMatchesId } from "../utils/sectionIdentity";
import { databaseManager, type DatabaseManager } from "../database";
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
import { flushAfterContentWrites, collectEntryHtmlPaths, fileMentionsRedirects } from "../content-write-flush";
import {
  bulkUpdateMeta,
  validateBulkMetaUpdates,
  BULK_META_MAX_SLUGS,
} from "../bulk-update-meta";
import { bindingManager } from "../bindings";
import { bindingHolderId, checkBindingLeaseConflicts } from "../binding-lease-guard";
import { emitBindingPropagationStarted } from "../content-events";
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
import { loadMergedSinglePage, mergeSingleTemplate } from "../database-single-loader";
import { rejectAttachedStructuralEdit } from "../shared-layout-entry";
import {
  resolveTemplateLocalePath,
  isTypeLayoutTarget,
  isSharedTemplateBasename,
} from "../shared-layout-paths";
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
  beginMcpContentWrite,
  runWithContentWriteContextAsync,
  enterContentWriteContext,
  resolveAgentSessionId,
  resolveEventActor,
} from "./_helpers";
import { child } from "../logger";
const log = child({ module: "routes/sections" });

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

function getDB(res: Response): DatabaseManager {
  return (res.locals.site as import("../site-manager").SiteContext | undefined)?.database ?? databaseManager;
}

export function registerSectionsRoutes(app: Express): void {
  // ── Per-entry section operations ──

  /**
   * Remove a section from a specific DB entry.
   * If the section is per-entry (_perEntrySource), deletes it from the per-entry file.
   * If shared-template, writes { id, _remove: true } to the per-entry file.
   */
  app.post("/api/per-entry-section-remove", async (req, res) => {
    try {
      const auth = await requireCapability(req, res, "content_edit_default", req.body.contentType);
      if (!auth.authorized) return;
      const authorName = auth.author || undefined;

      const { contentType, slug, locale: rawLocale, sectionIndex, isPerEntry } = req.body as {
        contentType: string;
        slug: string;
        locale: string;
        sectionIndex: number;
        isPerEntry?: boolean;
      };

      if (!contentType || !slug || !rawLocale || sectionIndex === undefined) {
        res.status(400).json({ error: "Missing required fields" });
        return;
      }

      const attachedErr = rejectAttachedStructuralEdit(contentType, slug, getContentRoot(res));
      if (attachedErr) {
        res.status(400).json({ error: attachedErr });
        return;
      }

      const locale = normalizeLocale(rawLocale);
      const folder = getFolder(contentType);
      const templateDir = path.join(getContentRoot(res), folder);
      const entryDir = path.join(templateDir, slug);
      const entryFilePath = path.join(entryDir, `${locale}.yml`);

      // Load the current merged page to get the section (DB or static single_template)
      const mergedPage = await loadMergedSinglePage(contentType, slug, locale, getContentRoot(res), getDB(res));
      if (!mergedPage) {
        res.status(404).json({ error: "Entry not found" });
        return;
      }

      const sections = mergedPage.sections as Record<string, unknown>[];
      const targetSection = sections[sectionIndex];
      if (!targetSection) {
        res.status(400).json({ error: "Section index out of range" });
        return;
      }

      // Ensure entry directory exists
      if (!fs.existsSync(entryDir)) {
        fs.mkdirSync(entryDir, { recursive: true });
      }

      // Load existing per-entry file or start fresh
      let entryData: Record<string, unknown> = {};
      if (fs.existsSync(entryFilePath)) {
        const raw = fs.readFileSync(entryFilePath, "utf-8");
        const parsed = getCI(res).safeYamlLoad(raw);
        if (parsed && typeof parsed === "object") entryData = parsed as Record<string, unknown>;
      }

      const entrySections = Array.isArray(entryData.sections)
        ? (entryData.sections as Record<string, unknown>[])
        : [];

      if (isPerEntry) {
        // Remove the section from the per-entry file's sections array by canonical identity
        const sectionId = canonicalSectionId(targetSection) ?? null;
        if (sectionId) {
          // Find the per-entry section in the entry file to get its anchor before removing it
          const perEntryRecord = entrySections.find(
            (s) => sectionMatchesId(s, sectionId),
          );
          const anchorId = perEntryRecord?._insertAfterSectionId;

          entryData.sections = entrySections.filter(
            (s) => !sectionMatchesId(s, sectionId),
          );

          // Remove from dependants index if it was anchored to a template section
          if (typeof anchorId === "string") {
            const { removeDependant } = await import("../utils/sectionAnchors");
            removeDependant(contentType, anchorId, slug);
          }
        } else {
          res.status(400).json({ error: "Per-entry section has no id" });
          return;
        }
      } else {
        // Shared template section — ensure it has an identity, then write _remove: true
        let sectionId = canonicalSectionId(targetSection) ?? null;

        if (!sectionId) {
          // Auto-generate a section_id and patch the shared template.
          // We must resolve the correct TEMPLATE index (not the merged index) because
          // per-entry removals can shift section positions in the merged view.
          const { generateSectionId } = await import("../utils/generateSectionId");
          sectionId = generateSectionId((targetSection.type as string) || "section");

          const localePath = resolveTemplateLocalePath(templateDir, locale, { fallbackLocale: "" });
          const fallbackPath = resolveTemplateLocalePath(templateDir, "en", { fallbackLocale: "" });
          const templateFile = fs.existsSync(localePath) ? localePath : fallbackPath;

          if (fs.existsSync(templateFile)) {
            const rawTemplate = fs.readFileSync(templateFile, "utf-8");
            const templateData = (getCI(res).safeYamlLoad(rawTemplate) as Record<string, unknown>) || {};
            const templateSections = Array.isArray(templateData.sections)
              ? (templateData.sections as Record<string, unknown>[])
              : [];

            // Map merged index → template index by counting non-perEntry sections in the merged
            // view and then finding the corresponding visible-base-template position.
            const mergedSections = mergedPage.sections as Record<string, unknown>[];
            const removedOriginalIndices = new Set<number>(
              ((mergedPage.perEntryRemovedSections as Array<{ originalIndex: number }>) || [])
                .map((r) => r.originalIndex),
            );

            // Count how many base-template (non-perEntry) sections precede sectionIndex in merged
            let baseCountBefore = 0;
            for (let i = 0; i < sectionIndex; i++) {
              if (!mergedSections[i]?._perEntrySource) baseCountBefore++;
            }

            // Find the baseCountBefore-th non-removed section in the template file
            let tplIdx = -1;
            let visible = 0;
            for (let i = 0; i < templateSections.length; i++) {
              if (removedOriginalIndices.has(i)) continue;
              if (visible === baseCountBefore) { tplIdx = i; break; }
              visible++;
            }

            const patchIdx = tplIdx !== -1 ? tplIdx : sectionIndex; // fallback: direct index
            if (templateSections[patchIdx]) {
              templateSections[patchIdx] = { ...templateSections[patchIdx], section_id: sectionId };
              templateData.sections = templateSections;
              const { escapeObjectVars, unescapeYamlDump } = await import("@shared/templateVars");
              const { escaped, map } = escapeObjectVars(templateData);
              const dumped = yaml.dump(escaped, { lineWidth: -1, noRefs: true, quotingType: '"', forceQuotes: false });
              fs.writeFileSync(templateFile, unescapeYamlDump(dumped, map), "utf-8");
              markFileAsModified(templateFile, authorName);
            }
          }
        }

        // Write _remove: true into per-entry file
        const alreadyRemoved = entrySections.some(
          (s) => sectionMatchesId(s, sectionId) && s._remove === true,
        );
        if (!alreadyRemoved) {
          entryData.sections = [...entrySections, { section_id: sectionId, _remove: true }];
        }
      }

      const { escapeObjectVars, unescapeYamlDump } = await import("@shared/templateVars");
      const { escaped, map } = escapeObjectVars(entryData);
      const dumped = yaml.dump(escaped, { lineWidth: -1, noRefs: true, quotingType: '"', forceQuotes: false });
      fs.writeFileSync(entryFilePath, unescapeYamlDump(dumped, map), "utf-8");
      markFileAsModified(entryFilePath, authorName);

      res.json({ success: true });
    } catch (error) {
      log.error({ err: error }, "[per-entry-section-remove] Error:");
      res.status(500).json({ error: error instanceof Error ? error.message : "Unknown error" });
    }
  });

  /**
   * Restore a section that was removed for a specific entry.
   * Removes the { id, _remove: true } entry from the per-entry file.
   */
  app.post("/api/per-entry-section-restore", async (req, res) => {
    try {
      const auth = await requireCapability(req, res, "content_edit_default", req.body.contentType);
      if (!auth.authorized) return;
      const authorName = auth.author || undefined;

      const { contentType, slug, locale: rawLocale, sectionId } = req.body as {
        contentType: string;
        slug: string;
        locale: string;
        sectionId: string;
      };

      if (!contentType || !slug || !rawLocale || !sectionId) {
        res.status(400).json({ error: "Missing required fields" });
        return;
      }

      const attachedErr = rejectAttachedStructuralEdit(contentType, slug, getContentRoot(res));
      if (attachedErr) {
        res.status(400).json({ error: attachedErr });
        return;
      }

      const locale = normalizeLocale(rawLocale);
      const folder = getFolder(contentType);
      const templateDir = path.join(getContentRoot(res), folder);
      const entryDir = path.join(templateDir, slug);
      const entryFilePath = path.join(entryDir, `${locale}.yml`);

      if (!fs.existsSync(entryFilePath)) {
        // Nothing to restore — idempotent success
        res.json({ success: true });
        return;
      }

      const raw = fs.readFileSync(entryFilePath, "utf-8");
      const entryData = (getCI(res).safeYamlLoad(raw) as Record<string, unknown>) || {};
      const entrySections = Array.isArray(entryData.sections)
        ? (entryData.sections as Record<string, unknown>[])
        : [];

      // Remove the _remove: true entry for this sectionId (either identity field)
      entryData.sections = entrySections.filter(
        (s) => !(sectionMatchesId(s, sectionId) && s._remove === true),
      );

      const { escapeObjectVars, unescapeYamlDump } = await import("@shared/templateVars");
      const { escaped, map } = escapeObjectVars(entryData);
      const dumped = yaml.dump(escaped, { lineWidth: -1, noRefs: true, quotingType: '"', forceQuotes: false });
      fs.writeFileSync(entryFilePath, unescapeYamlDump(dumped, map), "utf-8");
      markFileAsModified(entryFilePath, authorName);

      res.json({ success: true });
    } catch (error) {
      log.error({ err: error }, "[per-entry-section-restore] Error:");
      res.status(500).json({ error: error instanceof Error ? error.message : "Unknown error" });
    }
  });

  /**
   * Reset a per-entry section patch (remove the per-entry content override for a shared-template section).
   * Removes the patch entry for this sectionId from the per-entry locale file WITHOUT adding _remove: true.
   * After reset, the section will render from the shared template again.
   */
  app.post("/api/per-entry-section-patch-reset", async (req, res) => {
    try {
      const auth = await requireCapability(req, res, "content_edit_default", req.body.contentType);
      if (!auth.authorized) return;
      const authorName = auth.author || undefined;

      const { contentType, slug, locale: rawLocale, sectionId } = req.body as {
        contentType: string;
        slug: string;
        locale: string;
        sectionId: string;
      };

      if (!contentType || !slug || !rawLocale || !sectionId) {
        res.status(400).json({ error: "Missing required fields" });
        return;
      }

      const attachedErr = rejectAttachedStructuralEdit(contentType, slug, getContentRoot(res));
      if (attachedErr) {
        res.status(400).json({ error: attachedErr });
        return;
      }

      const locale = normalizeLocale(rawLocale);
      const folder = getFolder(contentType);
      const templateDir = path.join(getContentRoot(res), folder);
      const entryDir = path.join(templateDir, slug);
      const entryFilePath = path.join(entryDir, `${locale}.yml`);

      if (!fs.existsSync(entryFilePath)) {
        // Nothing to reset — idempotent success
        res.json({ success: true });
        return;
      }

      const raw = fs.readFileSync(entryFilePath, "utf-8");
      const entryData = (getCI(res).safeYamlLoad(raw) as Record<string, unknown>) || {};
      const entrySections = Array.isArray(entryData.sections)
        ? (entryData.sections as Record<string, unknown>[])
        : [];

      // Remove any patch entry (non-_remove) with this sectionId — restores shared template content
      entryData.sections = entrySections.filter(
        (s) => !(sectionMatchesId(s, sectionId) && !s._remove),
      );

      const { escapeObjectVars, unescapeYamlDump } = await import("@shared/templateVars");
      const { escaped, map } = escapeObjectVars(entryData);
      const dumped = yaml.dump(escaped, { lineWidth: -1, noRefs: true, quotingType: '"', forceQuotes: false });
      fs.writeFileSync(entryFilePath, unescapeYamlDump(dumped, map), "utf-8");
      markFileAsModified(entryFilePath, authorName);

      res.json({ success: true });
    } catch (error) {
      log.error({ err: error }, "[per-entry-section-patch-reset] Error:");
      res.status(500).json({ error: error instanceof Error ? error.message : "Unknown error" });
    }
  });

  /**
   * Add a section to a specific DB entry only (per-entry override).
   * Creates the per-entry folder and locale file if absent.
   * Accepts `insertAfterSectionId` to position the section after a specific base section.
   * Sections with `_insertAfterSectionId` are placed right after the matching base section
   * by `applyPerEntryLayer` during rendering; without it they are appended.
   */
  app.post("/api/per-entry-section-add", async (req, res) => {
    try {
      const auth = await requireCapability(req, res, "content_edit_default", req.body.contentType);
      if (!auth.authorized) return;
      const authorName = auth.author || undefined;

      const { contentType, slug, locale: rawLocale, sectionData, insertIndex } = req.body as {
        contentType: string;
        slug: string;
        locale: string;
        insertIndex?: number;
        sectionData: Record<string, unknown>;
      };

      if (!contentType || !slug || !rawLocale || !sectionData) {
        res.status(400).json({ error: "Missing required fields" });
        return;
      }

      const attachedErr = rejectAttachedStructuralEdit(contentType, slug, getContentRoot(res));
      if (attachedErr) {
        res.status(400).json({ error: attachedErr });
        return;
      }

      const locale = normalizeLocale(rawLocale);
      const folder = getFolder(contentType);
      const templateDir = path.join(getContentRoot(res), folder);
      const entryDir = path.join(templateDir, slug);
      const entryFilePath = path.join(entryDir, `${locale}.yml`);

      // Ensure directory exists
      if (!fs.existsSync(entryDir)) {
        fs.mkdirSync(entryDir, { recursive: true });
      }

      // Load existing per-entry file or start fresh
      let entryData: Record<string, unknown> = {};
      if (fs.existsSync(entryFilePath)) {
        const raw = fs.readFileSync(entryFilePath, "utf-8");
        const parsed = getCI(res).safeYamlLoad(raw);
        if (parsed && typeof parsed === "object") entryData = parsed as Record<string, unknown>;
      }

      const { generateSectionId } = await import("../utils/generateSectionId");
      const newSection: Record<string, unknown> = {
        ...sectionData,
        section_id:
          canonicalSectionId(sectionData) ||
          generateSectionId((sectionData.type as string) || "section"),
      };
      // Never persist the legacy `id` field on new sections
      delete newSection.id;

      // Resolve _insertAfterSectionId from insertIndex using the current merged page.
      // insertIndex is the position in the merged list where the new section should appear.
      //   insertIndex === 0        → insert before all sections → _insertAfterSectionId: null
      //   insertIndex > 0         → look at the preceding section's identity as the anchor
      //   insertIndex === undefined → no positioning metadata → append at end (backward compat)
      if (insertIndex !== undefined) {
        if (insertIndex === 0) {
          // Insert before all sections
          newSection._insertAfterSectionId = null;
        } else {
          const mergedPage = await loadMergedSinglePage(contentType, slug, locale, getContentRoot(res), getDB(res));
          const mergedSections = Array.isArray(mergedPage?.sections)
            ? (mergedPage!.sections as Record<string, unknown>[])
            : [];
          // Walk backward from insertIndex - 1 to find the nearest section that has an
          // identity. This handles id-less sections gracefully: we anchor after the closest
          // preceding named section so the new section lands at (or near) the intended position.
          let insertAfterSectionId: string | null | undefined = undefined; // undefined = append
          let anchorIsTemplateSectionId = false;
          for (let i = insertIndex - 1; i >= 0; i--) {
            const candidate = mergedSections[i];
            const candidateId = canonicalSectionId(candidate) ?? null;
            if (candidateId) {
              insertAfterSectionId = candidateId;
              // Only template-sourced sections should be indexed in dependants;
              // per-entry sections have _perEntrySource: true
              anchorIsTemplateSectionId = !candidate._perEntrySource;
              break;
            }
          }
          // If no preceding section has an id we leave undefined (append-at-end fallback)
          // rather than null (insert-before-all) which would be visually wrong.
          newSection._insertAfterSectionId = insertAfterSectionId;
          newSection._anchorIsTemplateSection = anchorIsTemplateSectionId;
        }
      }

      // Capture indexing metadata before stripping the internal flag from the section
      const anchorId = newSection._insertAfterSectionId;
      const anchorIsTemplateSection = newSection._anchorIsTemplateSection as boolean | undefined;
      // Remove internal flag — it must not be persisted to YML
      delete newSection._anchorIsTemplateSection;

      const entrySections = Array.isArray(entryData.sections)
        ? (entryData.sections as Record<string, unknown>[])
        : [];
      entryData.sections = [...entrySections, newSection];

      const { escapeObjectVars, unescapeYamlDump } = await import("@shared/templateVars");
      const { escaped, map } = escapeObjectVars(entryData);
      const dumped = yaml.dump(escaped, { lineWidth: -1, noRefs: true, quotingType: '"', forceQuotes: false });
      fs.writeFileSync(entryFilePath, unescapeYamlDump(dumped, map), "utf-8");
      markFileAsModified(entryFilePath, authorName);

      // Update dependants index: only record anchors to template section IDs (not per-entry IDs)
      if (typeof anchorId === "string" && anchorIsTemplateSection) {
        const { addDependant } = await import("../utils/sectionAnchors");
        addDependant(contentType, anchorId, slug);
      }

      // Return updated merged section list so the client can update without a full page reload
      const updatedPage = await loadMergedSinglePage(contentType, slug, locale, getContentRoot(res), getDB(res));
      res.json({ success: true, sections: updatedPage?.sections ?? [] });
    } catch (error) {
      log.error({ err: error }, "[per-entry-section-add] Error:");
      res.status(500).json({ error: error instanceof Error ? error.message : "Unknown error" });
    }
  });

  /**
   * Delete a shared-template section by its ID, resolving the correct template index.
   * Used when "Delete from all entries" is chosen on a specific DB entry page — avoids
   * the merged-index vs. template-index divergence that occurs when per-entry removals
   * have filtered some sections out.
   */
  app.post("/api/per-entry-section-delete-from-template", async (req, res) => {
    try {
      const auth = await requireCapability(req, res, "content_edit_structure", req.body.contentType);
      if (!auth.authorized) return;
      const authorName = auth.author || undefined;

      const { contentType, slug, locale: rawLocale, sectionId, mergedIndex } = req.body as {
        contentType: string;
        slug: string;
        locale: string;
        sectionId?: string;
        mergedIndex?: number;
      };

      if (!contentType || !slug || !rawLocale || (!sectionId && mergedIndex === undefined)) {
        res.status(400).json({ error: "Missing required fields: contentType, slug, locale and either sectionId or mergedIndex" });
        return;
      }

      const locale = normalizeLocale(rawLocale);
      const folder = getFolder(contentType);
      const templateDir = path.join(getContentRoot(res), folder);

      // Load the shared template WITHOUT per-entry overlay to get the correct template indices
      const baseTemplate = mergeSingleTemplate(contentType, locale, undefined, undefined, getContentRoot(res));
      if (!baseTemplate) {
        res.status(404).json({ error: "Template not found" });
        return;
      }

      const baseSections = Array.isArray(baseTemplate.sections)
        ? (baseTemplate.sections as Record<string, unknown>[])
        : [];

      let templateIndex: number;

      if (sectionId) {
        // Preferred: identity-based lookup on the base template (no per-entry overlay)
        templateIndex = baseSections.findIndex(
          (s) => sectionMatchesId(s, sectionId),
        );
        if (templateIndex === -1) {
          res.status(404).json({ error: `Section with id '${sectionId}' not found in shared template` });
          return;
        }
      } else {
        // Fallback: resolve template index from merged view position.
        // The merged view (WITH per-entry overlay) may have fewer sections than the base template
        // because per-entry removals filter some out. Non-per-entry sections in the merged view
        // appear in the same ORDER as in the base template; counting them gives the base index.
        const mergedWithEntry = mergeSingleTemplate(contentType, locale, slug, undefined, getContentRoot(res));
        const mergedSections = Array.isArray(mergedWithEntry?.sections)
          ? (mergedWithEntry!.sections as Record<string, unknown>[])
          : [];
        // Count how many non-per-entry-source sections appear before mergedIndex in merged view
        let baseCount = 0;
        for (let i = 0; i < (mergedIndex as number); i++) {
          if (!mergedSections[i]?._perEntrySource) baseCount++;
        }
        // The section AT mergedIndex in the merged view is at baseCount in the base template
        templateIndex = baseCount;
        if (templateIndex >= baseSections.length) {
          res.status(404).json({ error: `Cannot resolve template index from mergedIndex ${mergedIndex}` });
          return;
        }
      }

      // Find and mutate the correct template YAML file
      const localePath = resolveTemplateLocalePath(templateDir, locale, { fallbackLocale: "" });
      const fallbackPath = resolveTemplateLocalePath(templateDir, "en", { fallbackLocale: "" });
      const templateFile = fs.existsSync(localePath) ? localePath : fallbackPath;

      if (!fs.existsSync(templateFile)) {
        res.status(404).json({ error: "Template file not found" });
        return;
      }

      const rawTemplate = fs.readFileSync(templateFile, "utf-8");
      const templateData = (getCI(res).safeYamlLoad(rawTemplate) as Record<string, unknown>) || {};
      const templateSections = Array.isArray(templateData.sections)
        ? [...(templateData.sections as Record<string, unknown>[])]
        : [];

      // Find the section in the template file by identity (file may differ from merged if _common overlays)
      const fileIndex = sectionId
        ? templateSections.findIndex((s) => sectionMatchesId(s, sectionId))
        : -1;

      const effectiveIndex = fileIndex !== -1 ? fileIndex : templateIndex;

      // Capture the deleted section's actual ID and its predecessor ID before splicing
      const deletedSection = templateSections[effectiveIndex];
      const actualDeletedId: string | null =
        sectionId || canonicalSectionId(deletedSection) || null;
      const predecessorSection = effectiveIndex > 0 ? templateSections[effectiveIndex - 1] : null;
      const predecessorId: string | null = canonicalSectionId(predecessorSection) ?? null;

      if (fileIndex !== -1) {
        templateSections.splice(fileIndex, 1);
      } else {
        // Fallback: use the resolved template index in case the file doesn't have ids yet
        templateSections.splice(templateIndex, 1);
      }

      templateData.sections = templateSections;
      const { escapeObjectVars, unescapeYamlDump } = await import("@shared/templateVars");
      const { escaped, map } = escapeObjectVars(templateData);
      const dumped = yaml.dump(escaped, { lineWidth: -1, noRefs: true, quotingType: '"', forceQuotes: false });
      fs.writeFileSync(templateFile, unescapeYamlDump(dumped, map), "utf-8");
      markFileAsModified(templateFile, authorName);

      // Record alias: deletedId → predecessorId (null means it was the first section)
      if (actualDeletedId) {
        const { recordSectionDeleted } = await import("../utils/sectionAnchors");
        recordSectionDeleted(contentType, actualDeletedId, predecessorId);

        // Fan out delete to sibling locale singles + clean entry overlays
        const typeConfig = getContentTypeConfig(contentType, getContentRoot(res));
        const isSharedLayout = !!(typeConfig?.database?.slug || typeConfig?.single_template);
        if (isSharedLayout) {
          const {
            fanOutStructuralOpsToSiblings,
            cleanSectionIdFromEntryOverlays,
          } = await import("../shared-layout-sync");
          const dumpYaml = (d: unknown) => {
            const { escaped: e2, map: m2 } = escapeObjectVars(d);
            return unescapeYamlDump(
              yaml.dump(e2, { lineWidth: -1, noRefs: true, quotingType: '"', forceQuotes: false }),
              m2,
            );
          };
          const fan = fanOutStructuralOpsToSiblings({
            templateDir,
            sourceLocale: locale,
            sourceSections: templateSections,
            operations: [
              { action: "remove_item", path: "sections", index: 0, sectionId: actualDeletedId },
            ],
            safeYamlLoad: (r) => getCI(res).safeYamlLoad(r),
            dumpYaml,
            onSiblingWritten: (p) => markFileAsModified(p, authorName),
            cleanEntryOverlaysForSectionIds: (ids) => {
              cleanSectionIdFromEntryOverlays(
                templateDir,
                ids,
                (r) => getCI(res).safeYamlLoad(r),
                dumpYaml,
                (p) => markFileAsModified(p, authorName),
              );
            },
          });
          if (fan.failed.length > 0) {
            res.status(500).json({
              error: `Deleted from ${locale} but sibling fan-out failed: ${fan.failed
                .map((f) => `${f.locale} (${f.error})`)
                .join("; ")}`,
            });
            return;
          }
        }
      }

      res.json({ success: true });
    } catch (error) {
      log.error({ err: error }, "[per-entry-section-delete-from-template] Error:");
      res.status(500).json({ error: error instanceof Error ? error.message : "Unknown error" });
    }
  });

  /**
   * Update a section for a specific DB entry only (per-entry override).
   * Writes the section data as a patch in `4geeks-com/{folder}/{slug}/{locale}.yml`.
   * If the section has no id, auto-generates one and patches the shared template first.
   * The loader's applyPerEntryLayer deep-merges the patch on render.
   */
  app.post("/api/per-entry-section-update", async (req, res) => {
    try {
      req.body = decodeHtmlValues(req.body);
      const auth = await requireCapability(req, res, "content_edit_default", req.body.contentType);
      if (!auth.authorized) return;
      const authorName = auth.author || undefined;

      const { contentType, slug, locale: rawLocale, sectionIndex, sectionData } = req.body as {
        contentType: string;
        slug: string;
        locale: string;
        sectionIndex: number;
        sectionData: Record<string, unknown>;
      };

      if (!contentType || !slug || !rawLocale || sectionIndex === undefined || !sectionData) {
        res.status(400).json({ error: "Missing required fields" });
        return;
      }

      const attachedErr = rejectAttachedStructuralEdit(contentType, slug, getContentRoot(res));
      if (attachedErr) {
        res.status(400).json({ error: attachedErr });
        return;
      }

      const locale = normalizeLocale(rawLocale);
      const folder = getFolder(contentType);
      const templateDir = path.join(getContentRoot(res), folder);
      const entryDir = path.join(templateDir, slug);
      const entryFilePath = path.join(entryDir, `${locale}.yml`);

      // Load the current merged page to get the section and its id (DB or static single_template)
      const mergedPage = await loadMergedSinglePage(contentType, slug, locale, getContentRoot(res), getDB(res));
      if (!mergedPage) {
        res.status(404).json({ error: "Entry not found" });
        return;
      }

      const sections = mergedPage.sections as Record<string, unknown>[];
      const targetSection = sections[sectionIndex];
      if (!targetSection) {
        res.status(400).json({ error: "Section index out of range" });
        return;
      }

      let sectionId = canonicalSectionId(targetSection) ?? null;

      if (!sectionId) {
        // Auto-generate a section_id and patch the shared template so applyPerEntryLayer can match it
        const { generateSectionId } = await import("../utils/generateSectionId");
        sectionId = generateSectionId((targetSection.type as string) || "section");

        const localePath = resolveTemplateLocalePath(templateDir, locale, { fallbackLocale: "" });
        const fallbackPath = resolveTemplateLocalePath(templateDir, "en", { fallbackLocale: "" });
        const templateFile = fs.existsSync(localePath) ? localePath : fallbackPath;

        if (fs.existsSync(templateFile)) {
          const rawTemplate = fs.readFileSync(templateFile, "utf-8");
          const templateData = (getCI(res).safeYamlLoad(rawTemplate) as Record<string, unknown>) || {};
          const templateSections = Array.isArray(templateData.sections)
            ? (templateData.sections as Record<string, unknown>[])
            : [];

          // Map merged index → template index
          const mergedSections = mergedPage.sections as Record<string, unknown>[];
          const removedOriginalIndices = new Set<number>(
            ((mergedPage.perEntryRemovedSections as Array<{ originalIndex: number }>) || [])
              .map((r) => r.originalIndex),
          );

          let baseCountBefore = 0;
          for (let i = 0; i < sectionIndex; i++) {
            if (!mergedSections[i]?._perEntrySource) baseCountBefore++;
          }

          let tplIdx = -1;
          let visible = 0;
          for (let i = 0; i < templateSections.length; i++) {
            if (removedOriginalIndices.has(i)) continue;
            if (visible === baseCountBefore) { tplIdx = i; break; }
            visible++;
          }

          const patchIdx = tplIdx !== -1 ? tplIdx : sectionIndex;
          if (templateSections[patchIdx]) {
            templateSections[patchIdx] = { ...templateSections[patchIdx], section_id: sectionId };
            templateData.sections = templateSections;
            const { escapeObjectVars, unescapeYamlDump } = await import("@shared/templateVars");
            const { escaped, map } = escapeObjectVars(templateData);
            const dumped = yaml.dump(escaped, { lineWidth: -1, noRefs: true, quotingType: '"', forceQuotes: false });
            fs.writeFileSync(templateFile, unescapeYamlDump(dumped, map), "utf-8");
            markFileAsModified(templateFile, authorName);
          }
        }
      }

      // Ensure entry directory exists
      if (!fs.existsSync(entryDir)) {
        fs.mkdirSync(entryDir, { recursive: true });
      }

      // Load existing per-entry file or start fresh
      let entryData: Record<string, unknown> = {};
      if (fs.existsSync(entryFilePath)) {
        const raw = fs.readFileSync(entryFilePath, "utf-8");
        const parsed = getCI(res).safeYamlLoad(raw);
        if (parsed && typeof parsed === "object") entryData = parsed as Record<string, unknown>;
      }

      const entrySections = Array.isArray(entryData.sections)
        ? (entryData.sections as Record<string, unknown>[])
        : [];

      // Remove any existing entry for this section id (patch or _remove) then add the new patch
      const filtered = entrySections.filter(
        (s) => !sectionMatchesId(s, sectionId),
      );
      const patchEntry: Record<string, unknown> = { ...sectionData, section_id: sectionId };
      delete patchEntry.id; // never persist the legacy identity field
      filtered.push(patchEntry);
      entryData.sections = filtered;

      const { escapeObjectVars, unescapeYamlDump } = await import("@shared/templateVars");
      const { escaped, map } = escapeObjectVars(entryData);
      const dumped = yaml.dump(escaped, { lineWidth: -1, noRefs: true, quotingType: '"', forceQuotes: false });
      fs.writeFileSync(entryFilePath, unescapeYamlDump(dumped, map), "utf-8");
      markFileAsModified(entryFilePath, authorName);

      res.json({ success: true });
    } catch (error) {
      log.error({ err: error }, "[per-entry-section-update] Error:");
      res.status(500).json({ error: error instanceof Error ? error.message : "Unknown error" });
    }
  });

  app.post("/api/content/edit-sections", async (req, res) => {
    try {
      req.body = decodeHtmlValues(req.body);
      // Support both formats:
      // 1. Original: { contentType, slug, locale, operations: [...] }
      // 2. Simplified: { contentType, slug, locale, operation, sectionIndex, sectionData, variant, version }
      const {
        contentType,
        slug,
        locale,
        operations,
        operation,
        sectionIndex,
        sectionData,
        variant,
        version,
        author: requestAuthor,
        layoutTarget,
      } = req.body;

      // Resolve effective variant before capability selection
      const effectiveVariant =
        variant && variant !== "default" ? variant : undefined;

      // Determine required capability from the operation(s) in the payload.
      // Structural ops (add/remove/reorder/duplicate) require content_edit_structure.
      // update_section targeting a named variant requires content_edit_variant.
      // update_section targeting default content requires content_edit_default.
      const STRUCTURAL_ACTIONS = new Set([
        "add_section", "remove_section", "reorder_sections", "duplicate_section",
      ]);
      let requiredCap: CapabilityName;
      if (Array.isArray(operations) && operations.length > 0) {
        const hasStructural = operations.some((op: { action: string }) => STRUCTURAL_ACTIONS.has(op.action));
        const hasUpdate = operations.some((op: { action: string }) => op.action === "update_section");
        if (hasStructural) {
          requiredCap = "content_edit_structure";
        } else if (hasUpdate && effectiveVariant) {
          requiredCap = "content_edit_variant";
        } else {
          requiredCap = "content_edit_default";
        }
      } else if (operation === "update_section") {
        requiredCap = effectiveVariant ? "content_edit_variant" : "content_edit_default";
      } else {
        // add/remove/reorder or other structural single-ops
        requiredCap = "content_edit_structure";
      }

      const auth = await requireCapability(req, res, requiredCap, contentType || undefined);
      if (!auth.authorized) return;

      // Use server-resolved author from identity; fall back to client-provided value
      const authorName = auth.author || (requestAuthor && typeof requestAuthor === "string" ? requestAuthor : undefined);

      const writeGate = beginMcpContentWrite(req, req.body?.report);
      if (!writeGate.ok) {
        res.status(400).json({ error: writeGate.error, code: writeGate.code });
        return;
      }

      if (!contentType || !slug || !locale) {
        res.status(400).json({
          error: "Missing required fields: contentType, slug, locale",
        });
        return;
      }

      // Build operations array if using simplified format (only for update_section)
      let finalOperations = operations;
      if (!operations && operation === "update_section") {
        if (
          sectionIndex === undefined ||
          sectionData === undefined ||
          sectionData === null
        ) {
          res.status(400).json({
            error: "update_section requires sectionIndex and sectionData",
          });
          return;
        }
        finalOperations = [
          {
            action: "update_section",
            index: sectionIndex,
            section: sectionData,
          },
        ];
      }

      if (
        !finalOperations ||
        !Array.isArray(finalOperations) ||
        finalOperations.length === 0
      ) {
        res.status(400).json({ error: "Missing operations" });
        return;
      }

      const effectiveVersion =
        effectiveVariant && version !== undefined ? version : undefined;

      const isMcpRequest = typeof req.headers["x-mcp-author"] === "string";
      const resolvedLayoutTarget =
        layoutTarget === "entry" || isTypeLayoutTarget(layoutTarget) ? layoutTarget : undefined;

      const touchedSectionIndexes = new Set<number>();
      for (const op of finalOperations as Array<{ action: string; index?: number; path?: string }>) {
        if (op.action === "update_section" && typeof op.index === "number") {
          touchedSectionIndexes.add(op.index);
        } else if (op.action === "update_field" && typeof op.path === "string") {
          const m = op.path.match(/^sections\.(\d+)(?:\.|$)/);
          if (m) touchedSectionIndexes.add(parseInt(m[1], 10));
        }
      }

      const siteId = getContentRootName(res);
      const normalizedLocaleForBinding = normalizeLocale(locale);
      const baseSlugForBinding = getCI(res).resolveBaseSlug(slug, contentType);
      const bindingHolder = bindingHolderId(authorName, contentType, baseSlugForBinding);
      if (touchedSectionIndexes.size > 0) {
        const leaseConflict = checkBindingLeaseConflicts(
          siteId,
          bindingHolder,
          contentType,
          baseSlugForBinding,
          normalizedLocaleForBinding,
          [...touchedSectionIndexes],
        );
        if (leaseConflict) {
          res.status(409).json(leaseConflict);
          return;
        }
      }

      const result = await runWithContentWriteContextAsync(writeGate.ctx, () =>
        editContent({
          contentType,
          slug,
          locale,
          operations: finalOperations,
          variant: effectiveVariant,
          version: effectiveVersion,
          author: authorName,
          contentRoot: getContentRoot(res),
          database: (res.locals.site as import("../site-manager").SiteContext)?.database,
          ci: getCI(res),
          skipSharedLayoutFanOut: isMcpRequest,
          layoutTarget: resolvedLayoutTarget,
        }),
      );

      if (result.success) {
        // Propagate to bound sections on live single-section updates (update_section
        // or update_field targeting sections.N.*). Skip variants and multi-section batches.
        let bindingWarnings: string[] = [];
        let boundUpdates: string[] = [];
        const updatedSections = result.updatedSections as Record<string, unknown>[] | undefined;

        if (!effectiveVariant && updatedSections) {
          const sectionIndexesToPropagate = new Set<number>();

          for (const op of finalOperations as Array<{ action: string; index?: number; path?: string; section?: Record<string, unknown> }>) {
            if (op.action === "update_section" && typeof op.index === "number") {
              const opSection = op.section;
              const secId = (opSection?.section_id as string | undefined) || (opSection?.id as string | undefined);
              const updatedSection = secId
                ? updatedSections.find(s => s.section_id === secId || s.id === secId)
                : updatedSections[op.index];
              const resolvedIdx = secId && updatedSection
                ? (updatedSections.indexOf(updatedSection) ?? op.index)
                : op.index;
              sectionIndexesToPropagate.add(resolvedIdx);
            } else if (op.action === "update_field" && typeof op.path === "string") {
              const m = op.path.match(/^sections\.(\d+)(?:\.|$)/);
              if (m) sectionIndexesToPropagate.add(parseInt(m[1], 10));
            }
          }

          // Only auto-propagate when exactly one section was touched (batch multi-section
          // is intentionally non-propagating for predictability — MCP warns separately).
          if (sectionIndexesToPropagate.size === 1) {
            const resolvedIdx = [...sectionIndexesToPropagate][0];
            const updatedSection = updatedSections[resolvedIdx];
            if (updatedSection) {
              const group = bindingManager.findGroupForSectionByIndex(
                contentType,
                baseSlugForBinding,
                resolvedIdx,
                normalizedLocaleForBinding,
              );
              if (group) {
                const acquired = bindingManager.acquirePropagationLease(
                  siteId,
                  group.id,
                  group.locale,
                  bindingHolder,
                );
                if (acquired.ok) {
                  emitBindingPropagationStarted({
                    site: siteId,
                    groupId: group.id,
                    locale: group.locale,
                    sourceContentType: contentType,
                    sourceSlug: baseSlugForBinding,
                    sectionIndex: resolvedIdx,
                    holder: bindingHolder,
                    token: acquired.lease.token,
                    author: authorName,
                    actor: resolveEventActor(req),
                    agent_session_id: resolveAgentSessionId(req),
                  });
                } else {
                  bindingWarnings = [
                    `Bound section propagation blocked: ${acquired.lease.holder} is syncing this group`,
                  ];
                }
              }

              try {
                const { getSyncLogForResponse } = await import("../sync-log");
                const sectionType = (updatedSection as Record<string, unknown>).type as string || `section-${resolvedIdx}`;
                const editMsg = `${sectionType} section updated on ${slug}/${locale} → bound pages syncing in background`;
                const editMeta: Record<string, unknown> = { contentType, slug, locale, sectionIndex: resolvedIdx, sectionType };
                getSyncLogForResponse(res).log("EDIT", editMsg, authorName, editMeta);
              } catch { /* non-fatal */ }
            }
          }
        }

        const ci = getCI(res);
        const htmlPaths = collectEntryHtmlPaths(ci, contentType, slug, normalizeLocale(locale));
        const normalizedLocale = normalizeLocale(locale);

        let syncSlow = false;
        let wroteSharedTemplate = isTypeLayoutTarget(resolvedLayoutTarget);
        try {
          const writtenPath = ci.getContentFilePath(
            contentType,
            slug,
            normalizedLocale,
            effectiveVariant,
            effectiveVersion,
          );
          if (fileMentionsRedirects(writtenPath)) syncSlow = true;
          if (isSharedTemplateBasename(path.basename(writtenPath))) {
            wroteSharedTemplate = true;
          }
        } catch { /* ignore */ }
        if (isTypeLayoutTarget(resolvedLayoutTarget)) {
          try {
            const folder = ci.getFolderName(contentType);
            const typeDir = path.join(getContentRoot(res), folder);
            const singlePath = resolveTemplateLocalePath(typeDir, normalizedLocale, {
              variant: effectiveVariant,
              fallbackLocale: "",
            });
            if (fileMentionsRedirects(singlePath)) syncSlow = true;
            wroteSharedTemplate = true;
          } catch { /* ignore */ }
        }

        flushAfterContentWrites({
          ci,
          contentTypes: [contentType],
          sitemapEntries: [{ contentType, slug, locale }],
          commonMetaTouched: false,
          siteId,
          htmlPaths,
          syncSlow,
        });

        // Return success with updated sections for immediate UI update
        const response: {
          success: boolean;
          updatedSections?: unknown;
          warning?: string;
          boundUpdates?: string[];
          clearedFields?: unknown;
          shared_template_html_cache?: string;
        } = {
          success: true,
          updatedSections: result.updatedSections,
        };
        if (boundUpdates.length > 0) {
          response.boundUpdates = boundUpdates;
        }
        if (wroteSharedTemplate) {
          response.shared_template_html_cache =
            "Shared-template save: this page (and bound pages) had path-scoped HTML cache bust. Other URLs that share template.*.yml may keep previous anonymous HTML until TTL (~5 min). Slow content-index scan is async/coalesced. See server/content-write-flush.ts, server/html-page-cache.ts, server/content-index.ts.";
        }
        if (result.warning) {
          response.warning = result.warning;
        }
        if (result.clearedFields?.length) {
          response.clearedFields = result.clearedFields;
        }
        if (bindingWarnings.length > 0) {
          response.warning =
            (response.warning ? response.warning + "\n" : "") +
            "Binding propagation warnings: " +
            bindingWarnings.join("; ");
        }
        res.json(response);
      } else {
        res.status(400).json({
          error: result.error,
          ...(result.errorCode ? { code: result.errorCode } : {}),
          ...(result.missingFields?.length
            ? { missing_fields: result.missingFields }
            : {}),
        });
      }
    } catch (error) {
      log.error({ err: error }, "Content edit error:");
      res.status(500).json({ error: "Internal server error" });
    }
  });

  app.post("/api/content/mark-modified", (req, res) => {
    try {
      const { path: filePath } = req.body as { path?: string };
      if (!filePath || typeof filePath !== "string") {
        res.status(400).json({ error: "path is required" });
        return;
      }
      markFileAsModified(filePath);
      res.json({ ok: true });
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : "Unknown error" });
    }
  });

  app.post("/api/content/refresh-cache", async (req, res) => {
    try {
      const { authorized } = await requireCapability(req, res, "content_edit_structure");
      if (!authorized) return;

      const { contentType } = req.body as { contentType?: string };
      const ci = getCI(res);
      ci.refresh({ syncSlow: true });
      clearSitemapCache();
      if (contentType && typeof contentType === "string") {
        invalidateContentCaches(contentType);
      }
      res.json({ ok: true, knownUrlCount: ci.getKnownUrlCount() });
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : "Unknown error" });
    }
  });

  app.post("/api/content/bulk-update-meta", async (req, res) => {
    try {
      req.body = decodeHtmlValues(req.body);

      const {
        slugs,
        locale,
        updates,
        contentType,
        variant,
        confirm_live_edit,
        author: requestAuthor,
      } = req.body;

      if (typeof contentType !== "string" || !contentType.trim()) {
        res.status(400).json({ error: "contentType is required" });
        return;
      }

      const auth = await requireCapability(req, res, "seo_edit", contentType.trim());
      if (!auth.authorized) return;

      if (!Array.isArray(slugs) || slugs.length === 0) {
        res.status(400).json({ error: "slugs must be a non-empty array" });
        return;
      }
      if (slugs.length > BULK_META_MAX_SLUGS) {
        res.status(400).json({
          error: `Too many slugs (${slugs.length}). Maximum is ${BULK_META_MAX_SLUGS}.`,
        });
        return;
      }
      const slugSet = new Set<string>();
      for (const s of slugs) {
        if (typeof s !== "string" || !s.trim()) {
          res.status(400).json({ error: "Each slug must be a non-empty string" });
          return;
        }
        if (slugSet.has(s)) {
          res.status(400).json({ error: `Duplicate slug in slugs[]: ${s}` });
          return;
        }
        slugSet.add(s);
      }
      if (!Array.isArray(updates) || updates.length === 0) {
        res.status(400).json({ error: "updates must be a non-empty array" });
        return;
      }
      const updatesErr = validateBulkMetaUpdates(updates);
      if (updatesErr) {
        res.status(400).json({ error: updatesErr });
        return;
      }

      const authorName =
        auth.author || (requestAuthor && typeof requestAuthor === "string" ? requestAuthor : undefined);

      const result = await bulkUpdateMeta({
        slugs,
        locale,
        updates,
        contentType: contentType.trim(),
        variant: typeof variant === "string" ? variant : undefined,
        confirm_live_edit: !!confirm_live_edit,
        author: authorName,
        contentRoot: getContentRoot(res),
        contentRootName: getContentRootName(res),
        ci: getCI(res),
        database: getDB(res),
      });

      try {
        const { getSyncLogForResponse } = await import("../sync-log");
        const okCount = result.results.filter((r) => r.ok).length;
        if (okCount > 0) {
          getSyncLogForResponse(res).log(
            "EDIT",
            `BULK_META: ${okCount}/${result.results.length} slug(s) updated (${locale || "en"})`,
            authorName,
            {
              slugs: result.results.filter((r) => r.ok).map((r) => r.slug),
              flushed: result.flushed,
              common_meta_touched: result.common_meta_touched,
            },
          );
        }
      } catch { /* non-fatal */ }

      const status = result.success ? 200 : result.results.some((r) => r.ok) ? 207 : 400;
      res.status(status).json({
        success: result.success,
        results: result.results,
        flushed: result.flushed,
        common_meta_touched: result.common_meta_touched,
        warnings: result.warnings,
        side_effects: {
          preview_capture: "skipped_for_meta_bulk",
          flush: result.flushed
            ? "coalesced_after_batch"
            : "skipped_no_successful_writes",
        },
      });
    } catch (error) {
      log.error({ err: error }, "Bulk meta update error:");
      res.status(500).json({ error: "Internal server error" });
    }
  });

  app.post("/api/content/edit-common", async (req, res) => {
    try {
      req.body = decodeHtmlValues(req.body);
      const auth = await requireCapability(req, res, "content_edit_text", req.body.contentType || undefined);
      if (!auth.authorized) return;

      const writeGate = beginMcpContentWrite(req, req.body?.report);
      if (!writeGate.ok) {
        res.status(400).json({ error: writeGate.error, code: writeGate.code });
        return;
      }
      enterContentWriteContext(writeGate.ctx);

      const { contentType, slug, operations, author: requestAuthor } = req.body;

      if (
        !contentType ||
        !slug ||
        !Array.isArray(operations) ||
        operations.length === 0
      ) {
        res
          .status(400)
          .json({
            error:
              "Missing required fields: contentType, slug, operations (array)",
          });
        return;
      }

      // Prefer server-resolved author (from Breathecode identity) over client-provided value
      const authorName = auth.author || (requestAuthor && typeof requestAuthor === "string" ? requestAuthor : undefined);

      const result = editCommonContent({
        contentType,
        slug,
        operations,
        author: authorName,
        ci: getCI(res),
        contentRootName: getContentRootName(res),
      });

      if (result.success) {
        const ci = getCI(res);
        flushAfterContentWrites({
          ci,
          contentTypes: [contentType],
          sitemapEntries: [{ contentType, slug, locale: getDefaultLocale() }],
          commonMetaTouched: true,
          siteId: getContentRootName(res),
          htmlPaths: collectEntryHtmlPaths(ci, contentType, slug),
          syncSlow: false,
        });
        res.json({ success: true });
      } else {
        res.status(400).json({
          error: result.error,
          ...(result.errorCode ? { code: result.errorCode } : {}),
          ...(result.missingFields?.length
            ? { missing_fields: result.missingFields }
            : {}),
        });
      }
    } catch (error) {
      log.error({ err: error }, "Common content edit error:");
      res.status(500).json({ error: "Internal server error" });
    }
  });

  app.post("/api/content/rename-slug", async (req, res) => {
    try {
      const auth = await requireCapability(req, res, "content_edit_structure", req.body.contentType || undefined);
      if (!auth.authorized) return;
      const { contentType, folderSlug, locale, newSlug, createRedirect, enforceRedirectPolicy, author: rawAuthor } = req.body;
      const author = auth.author || (rawAuthor && typeof rawAuthor === "string" ? rawAuthor : undefined);
      const result = await renameContentSlug({
        contentType,
        folderSlug,
        locale,
        newSlug,
        createRedirect: !!createRedirect,
        enforceRedirectPolicy: !!enforceRedirectPolicy,
        author,
        contentRootName: getContentRootName(res),
        ci: getCI(res),
      });
      if (!result.success) { res.status(result.statusCode).json({ error: result.error }); return; }
      res.json(result.data);
    } catch (error) {
      log.error({ err: error }, "[Content] Rename slug error:");
      res.status(500).json({ error: "Failed to rename slug" });
    }
  });

  // Check if a slug is available for a given content type
  app.get("/api/content/check-slug", (req, res) => {
    const { type, slug } = req.query;

    if (
      !type ||
      !slug ||
      typeof type !== "string" ||
      typeof slug !== "string"
    ) {
      res
        .status(400)
        .json({ error: "Missing required query params: type, slug" });
      return;
    }

    if (!isValidType(type)) {
      res.status(400).json({
        error: `Invalid type. Must be one of: ${getAllTypes().join(", ")}`,
      });
      return;
    }

    const folderPath = path.join(
      getContentRoot(res),
      getFolder(type),
      slug,
    );

    if (slug.startsWith("_")) {
      res.json({ available: false, slug, type, reason: "Reserved prefix" });
      return;
    }

    const folderExists = fs.existsSync(folderPath);

    if (folderExists) {
      const hasCommon = fs.existsSync(path.join(folderPath, "_common.yml"));
      const hasLocaleFile = getSupportedLocales().some(loc =>
        fs.existsSync(path.join(folderPath, `${loc}.yml`))
      );
      if (hasCommon && hasLocaleFile) {
        res.json({ available: false, slug, type, reason: "slug_taken" });
        return;
      }
    }

    const locale =
      typeof req.query.locale === "string" ? req.query.locale : undefined;
    const urlsToCheck: string[] = [];
    const ctKey = getFolder(type);
    if (type === "landing") {
      urlsToCheck.push(getCI(res).buildUrl(ctKey, "default", slug));
    } else if (locale) {
      urlsToCheck.push(getCI(res).buildUrl(ctKey, locale, slug));
    } else {
      for (const loc of getSupportedLocales()) {
        urlsToCheck.push(getCI(res).buildUrl(ctKey, loc, slug));
      }
    }

    const redirects = getCI(res).getRedirects();
    for (const url of urlsToCheck) {
      const conflict = redirects.find((r) => r.from === url);
      if (conflict) {
        const redirectTo =
          typeof conflict.to === "string"
            ? conflict.to
            : Object.values(conflict.to).join(", ");
        res.json({
          available: false,
          slug,
          type,
          reason: "redirect_conflict",
          conflictUrl: url,
          redirectTo,
        });
        return;
      }
    }

    res.json({ available: true, slug, type });
  });

  app.get("/api/content/check-origin", (req, res) => {
    const { path: originPath } = req.query;
    if (!originPath || typeof originPath !== "string") {
      res.status(400).json({ error: "Missing required query param: path" });
      return;
    }

    const normalized = originPath.startsWith("/")
      ? originPath
      : `/${originPath}`;

    const redirects = getCI(res).getRedirects();
    const existingRedirect = redirects.find((r) => r.from === normalized);
    if (existingRedirect) {
      const redirectTo =
        typeof existingRedirect.to === "string"
          ? existingRedirect.to
          : Object.values(existingRedirect.to).join(", ");
      res.json({
        taken: true,
        reason: "existing_redirect",
        details: `Already redirects to ${redirectTo}`,
      });
      return;
    }

    const entries = getCI(res).listAll();
    for (const entry of entries) {
      const ctKey = getDirectory(entry.contentType);
      for (const locale of entry.locales) {
        if (locale.startsWith("_") || locale.includes(".")) continue;
        const url = getCI(res).buildUrl(ctKey, locale, entry.slug);
        if (url === normalized) {
          res.json({
            taken: true,
            reason: "existing_page",
            details: `This is the "${entry.title || entry.slug}" ${entry.contentType} page (${locale})`,
          });
          return;
        }
      }
    }

    res.json({ taken: false });
  });

  // Create new content (location/page/program)
  app.post("/api/content/create", async (req, res) => {
    try {
      const auth = await requireCapability(req, res, "content_create_entry", req.body.type || undefined);
      if (!auth.authorized) return;
      const writeGate = beginMcpContentWrite(req, req.body?.report);
      if (!writeGate.ok) {
        res.status(400).json({ error: writeGate.error, code: writeGate.code });
        return;
      }
      const { type, slugEn, slugEs, title, sourceUrl, sourceSlug, sourceType, changeContentType, author: rawAuthor, skipLocales: rawSkipLocales, uniqueFieldValues: rawUniqueFieldValues, localeTitles: rawLocaleTitles } = req.body;
      const author = auth.author || (rawAuthor && typeof rawAuthor === "string" ? rawAuthor : undefined);
      const skipLocales: string[] = Array.isArray(rawSkipLocales) ? rawSkipLocales.filter((l: unknown) => typeof l === "string") : [];
      const uniqueFieldValues: Record<string, string | boolean> = rawUniqueFieldValues && typeof rawUniqueFieldValues === "object"
        ? Object.fromEntries(Object.entries(rawUniqueFieldValues).filter(([, v]) => typeof v === "string" || typeof v === "boolean")) : {};
      const rawUrlParamValues = req.body.urlParamValues;
      const urlParamValues: Record<string, Record<string, string>> =
        rawUrlParamValues && typeof rawUrlParamValues === "object"
          ? Object.fromEntries(
              Object.entries(rawUrlParamValues)
                .filter(([, v]) => v && typeof v === "object" && !Array.isArray(v))
                .map(([loc, v]) => [
                  loc,
                  Object.fromEntries(
                    Object.entries(v as Record<string, unknown>).filter(([, val]) => typeof val === "string"),
                  ) as Record<string, string>,
                ]),
            )
          : {};
      const localeTitles: Record<string, string> = rawLocaleTitles && typeof rawLocaleTitles === "object"
        ? Object.fromEntries(Object.entries(rawLocaleTitles).filter(([, v]) => typeof v === "string")) : {};
      const result = await runWithContentWriteContextAsync(writeGate.ctx, () =>
        createContentEntry({
          type, title, sourceUrl,
          sourceSlug: typeof sourceSlug === "string" ? sourceSlug : undefined,
          sourceType: typeof sourceType === "string" ? sourceType : undefined,
          changeContentType: !!changeContentType,
          slugEn: slugEn || req.body.slug, slugEs: slugEs || req.body.slug,
          skipLocales, uniqueFieldValues, urlParamValues, localeTitles, author,
          contentRootName: getContentRootName(res),
        }),
      );
      if (!result.success) { res.status(result.statusCode).json({ error: result.error }); return; }
      res.json(result.data);
    } catch (error) {
      log.error({ err: error }, "Content create error:");
      res.status(500).json({ error: "Internal server error" });
    }
  });

  app.get("/api/content/delete-preview", async (req, res) => {
    try {
      const auth = await requireCapability(req, res, "content_delete_entry", String(req.query.type || ""));
      if (!auth.authorized) return;
      const type = String(req.query.type || "");
      const slug = String(req.query.slug || "");
      const localesRaw = String(req.query.locales || "");
      const locales = localesRaw
        ? localesRaw.split(",").map((s) => s.trim()).filter(Boolean)
        : undefined;
      if (!type || !slug) {
        res.status(400).json({ error: "type and slug query params are required" });
        return;
      }
      const { getDeleteReferrersPreview } = await import("../link-delete-preview");
      const preview = getDeleteReferrersPreview({
        contentType: type,
        slug,
        locales,
        contentRoot: getContentRoot(res),
      });
      res.json({ success: true, ...preview });
    } catch (error) {
      log.error({ err: error }, "Content delete preview error:");
      res.status(500).json({ error: "Internal server error" });
    }
  });

  app.post("/api/content/delete", async (req, res) => {
    try {
      const auth = await requireCapability(req, res, "content_delete_entry", req.body.type || undefined);
      if (!auth.authorized) return;
      const { type, slug, confirmSlug, author: rawAuthor, localesToDelete: rawLocalesToDelete } = req.body;
      const author = auth.author || (typeof rawAuthor === "string" ? rawAuthor : undefined);
      const localesToDelete: string[] = Array.isArray(rawLocalesToDelete) ? rawLocalesToDelete.filter((l: unknown) => typeof l === "string") : [];
      if (!type || !slug || !confirmSlug) {
        res.status(400).json({ error: "Missing required fields: type, slug, confirmSlug" }); return;
      }
      if (slug !== confirmSlug) {
        res.status(400).json({ error: "Confirmation slug does not match. Deletion cancelled." }); return;
      }
      const result = await deleteContentEntry({ type, slug, author, localesToDelete, contentRootName: getContentRootName(res) });
      if (!result.success) { res.status(result.statusCode).json({ error: result.error }); return; }
      res.json(result.data);
    } catch (error) {
      log.error({ err: error }, "Content delete error:");
      res.status(500).json({ error: "Internal server error" });
    }
  });

  /**
   * Bulk delete with relation cascade preview (authors → blog.authors).
   * Body: { contentType, slugs, confirm?, reassignments?, author? }
   * Without confirm: returns preview. With confirm: best-effort results[].
   */
  app.post("/api/content/delete-entries", async (req, res) => {
    try {
      const contentType = String(req.body?.contentType || req.body?.type || "");
      const auth = await requireCapability(req, res, "content_delete_entry", contentType || undefined);
      if (!auth.authorized) return;
      const slugs = Array.isArray(req.body?.slugs)
        ? (req.body.slugs as unknown[]).map(String).filter(Boolean)
        : [];
      const confirm = req.body?.confirm === true;
      const writeGate = confirm
        ? beginMcpContentWrite(req, req.body?.report)
        : { ok: true as const, ctx: {} };
      if (!writeGate.ok) {
        res.status(400).json({ error: writeGate.error, code: writeGate.code });
        return;
      }
      if (confirm) enterContentWriteContext(writeGate.ctx);
      const author = auth.author || (typeof req.body?.author === "string" ? req.body.author : undefined);
      const reassignments =
        req.body?.reassignments && typeof req.body.reassignments === "object"
          ? (req.body.reassignments as Record<string, string[]>)
          : undefined;

      if (!contentType || slugs.length === 0) {
        res.status(400).json({ error: "contentType and slugs[] are required" });
        return;
      }

      const {
        previewAuthorDeleteCascade,
        applyAuthorDeleteCascade,
        DEFAULT_ORG_AUTHOR_SLUG,
      } = await import("../relation-delete");

      const preview =
        contentType === "authors"
          ? previewAuthorDeleteCascade(slugs, getContentRoot(res))
          : {
              blocked: [],
              dependents: [],
              needs_reassignment: [],
              default_author_slug: DEFAULT_ORG_AUTHOR_SLUG,
            };

      if (!confirm) {
        const { getDeleteReferrersPreview } = await import("../link-delete-preview");
        const linkPreviewBySlug: Record<
          string,
          Awaited<ReturnType<typeof getDeleteReferrersPreview>>
        > = {};
        for (const slug of slugs) {
          linkPreviewBySlug[slug] = getDeleteReferrersPreview({
            contentType,
            slug,
            contentRoot: getContentRoot(res),
            limit: 15,
          });
        }
        res.json({
          success: true,
          action_required: "confirm_delete",
          preview: {
            ...preview,
            link_preview_by_slug: linkPreviewBySlug,
          },
          message:
            preview.needs_reassignment.length > 0
              ? "Some posts would lose their last author — provide reassignments (defaults to org author) and confirm:true"
              : "Pass confirm:true to delete. Protected slugs are blocked.",
        });
        return;
      }

      if (preview.blocked.length && preview.blocked.length === slugs.length) {
        res.status(403).json({
          error: `All requested slugs are protected and cannot be deleted: ${preview.blocked.join(", ")}`,
          preview,
        });
        return;
      }

      const deletable = slugs.filter((s) => !preview.blocked.includes(s));

      if (contentType === "authors" && deletable.length > 0) {
        applyAuthorDeleteCascade(deletable, {
          contentRoot: getContentRoot(res),
          author,
          reassignments,
        });
      }

      const results: Array<{
        slug: string;
        ok: boolean;
        error?: string;
        skipped?: boolean;
      }> = [];
      for (const slug of slugs) {
        if (preview.blocked.includes(slug)) {
          results.push({
            slug,
            ok: false,
            skipped: true,
            error: "protected system entry",
          });
          continue;
        }
        const result = await deleteContentEntry({
          type: contentType,
          slug,
          author,
          contentRootName: getContentRootName(res),
        });
        if (!result.success) {
          results.push({ slug, ok: false, error: result.error });
        } else {
          results.push({ slug, ok: true });
        }
      }

      res.json({
        success: true,
        results,
        preview,
        blocked: preview.blocked,
      });
    } catch (error) {
      log.error({ err: error }, "Content delete-entries error:");
      res.status(500).json({ error: "Internal server error" });
    }
  });

  /**
   * GET /api/section-dependants?contentType=&sectionId=
   * Returns the list of entry slugs that have a per-entry section anchored to the given
   * template section ID. Used by the move-warning UI to show affected entries cheaply.
   */
  app.get("/api/section-dependants", async (req, res) => {
    try {
      const contentType = req.query.contentType as string | undefined;
      const sectionId = req.query.sectionId as string | undefined;

      if (!contentType || !sectionId) {
        res.status(400).json({ error: "Missing required query params: contentType, sectionId" });
        return;
      }

      const { readSectionAnchors } = await import("../utils/sectionAnchors");
      const anchors = readSectionAnchors(contentType);
      const dependants = anchors.dependants[sectionId] ?? [];
      res.json({ dependants });
    } catch (error) {
      log.error({ err: error }, "[section-dependants] Error:");
      res.status(500).json({ error: error instanceof Error ? error.message : "Unknown error" });
    }
  });

  app.get("/api/content/:contentType/:slug", (req, res) => {
    const { contentType, slug } = req.params;
    const locale = normalizeLocale(req.query.locale as string);

    if (!isValidType(contentType)) {
      res.status(400).json({ error: "Invalid content type" });
      return;
    }

    const result = getContentForEdit(
      contentType as string,
      slug,
      locale,
      undefined,
      undefined,
      getCI(res),
    );

    if (result.content) {
      res.json(result.content);
    } else {
      res.status(404).json({ error: result.error });
    }
  });

  // Image Registry API endpoints (delegated to MediaGallery singleton)
}
