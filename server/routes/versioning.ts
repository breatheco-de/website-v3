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
import { canonicalSectionId } from "../utils/sectionIdentity";
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
import { emitEntryLocalePromoted, emitEntryLocaleUnpublished } from "../content-events";
import { deepMerge } from "../utils/deepMerge";
import { assertLocaleUrlAvailable, localeUrlSlugsFromBody } from "../locale-url-slug";
import { regenerateSectionIds } from "../utils/regenerateSectionIds";
import { databaseManager } from "../database";
import {
  redirectMiddleware,
  getRedirects,
  clearRedirectCache,
  testRedirect,
} from "../redirects";
import { hasRedirectChanges } from "../redirect-items";
import { variantRedirectChanges } from "../versioning/draft-base";
import { parseRobotsOnPublish, ROBOTS_CHANGE_ON_PUBLISH_CODE } from "../versioning/robots-on-publish";
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
import { validateYamlIdentity } from "../validate-content-identity";
import { bindingManager } from "../bindings";
import {
  escapeTemplateVars,
  unescapeObjectVars,
} from "@shared/templateVars";
import { dumpContentYaml } from "../content-yaml";
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
  resolveStaticEntryUpdatedAt,
} from "../content-types";
import {
  isEntryDetached,
  isSharedLayoutType,
  attachedOverlayStructureError,
  resolveVersioningReadSlug,
  resolveWritableVersioningTarget,
  isTemplateVersioningSlug,
  resolvePreviewBaseSlug,
} from "../shared-layout-entry";
import {
  buildMirroredLocaleSingle,
  listSiblingSinglePaths,
} from "../shared-layout-sync";
import {
  hasAnyLiveLocale,
  hasLiveLocaleFile,
  listDraftLocales,
  countVariantFiles,
  findSourceDraftVariant,
  usesDraftFirstCreate,
  liveLocaleFileName,
  listUnregisteredVariantFiles,
} from "../draft-entry";
import {
  resolveTemplateLocalePath,
  liveTemplateBasename,
  variantTemplateBasename,
  isReservedTemplateVariantSlug,
} from "../shared-layout-paths";
import {
  isVariantRegisteredInVersioning,
  parseCleanupOrphanFlag,
  pruneVersioningAfterVariantRemove,
  variantTrafficBlock,
  variantTrafficErrorMessage,
} from "../versioning/delete-variant.js";
import { ensurePublishedAtOnce, readPublishedAt } from "../published-at";
import { isReservedExperimentSlug } from "../versioning/assignment";
import { abCheckPageLock, isAbTestingSetUp, isLatestCheckOk } from "../ab-testing/state";
import { getSplitHealth } from "../versioning/split-health";
import { api } from "../rate-limit/api.js";
import { normalizeFlexibleDate } from "@shared/normalizeFlexibleDate";
import { resolveFieldValue, applyTransformIfNeeded } from "../transform";
import { resolveSingleVars } from "../single-resolver";
import { getValidationCacheService } from "../services/validationCacheService";
import { validatePublishedVariantLayer } from "../services/validatePublishedVariant";
import {
  diagnosticsHttpStatus,
  getDiagnosticsJob,
  startDiagnosticsJob,
} from "../services/diagnosticsJobService";
import { buildEntryKey } from "../../scripts/validation/shared/entryKey";
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
} from "./_helpers";

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
function getValidationCache(res: Response) {
  return (
    (res.locals.site as any)?.validationCache ?? getValidationCacheService()
  );
}


/** MCP role connectors forward `x-mcp-role`; swarm roles never publish directly. */
function isSwarmCaller(req: Request): boolean {
  const header = req.headers["x-mcp-role"];
  const roleId = Array.isArray(header) ? header[0] : header;
  return Boolean(roleId && userStore.isAgenticSwarmRoleId(String(roleId)));
}

export type VariantProposalBadge = {
  id: string;
  env: string;
  /** False when the link comes from `_draft.proposal` and the proposal is not in this copy of the proposals DB. */
  local: boolean;
  title?: string;
  status?: string;
  proposer_username?: string;
  proposer_kind?: "agent" | "staff";
  /** Epoch ms of the proposal's last change. */
  updated_at?: number;
};

/** `{locale: {variant: badge}}` — `_draft.proposal` first, then the local proposals DB. */
async function proposalsByVariantFor(opts: {
  site: string;
  contentType: string;
  slug: string;
  versioning: Record<string, { variants?: Array<{ slug: string }> }>;
  variantPath: (variant: string, locale: string) => string;
}): Promise<Record<string, Record<string, VariantProposalBadge>>> {
  const out: Record<string, Record<string, VariantProposalBadge>> = {};
  const { readDraftMeta } = await import("../versioning/draft-meta");
  let local: import("../content-proposals").OpenProposalForEntry[] = [];
  let env = "production";
  try {
    const mod = await import("../content-proposals");
    local = mod.listOpenProposalsForEntry(opts.site, opts.contentType, opts.slug);
    env = mod.DRAFT_LINK_ENV;
  } catch {
    /* proposals DB unavailable — fall back to file links only */
  }
  const localById = new Map(local.map((p) => [p.id, p]));
  for (const [locale, block] of Object.entries(opts.versioning)) {
    for (const v of block?.variants ?? []) {
      const link = readDraftMeta(opts.variantPath(v.slug, locale))?.proposal;
      const fromDb = local.find((p) => p.locale === locale && p.variant === v.slug);
      const hit = link ? localById.get(link.id) ?? null : fromDb ?? null;
      if (!link && !hit) continue;
      (out[locale] ??= {})[v.slug] = {
        id: link?.id ?? hit!.id,
        env: link?.env ?? env,
        local: Boolean(hit),
        ...(hit
          ? {
              title: hit.title,
              status: hit.status,
              proposer_username: hit.proposer_username,
              proposer_kind: hit.proposer_kind,
              updated_at: hit.updated_at,
            }
          : {}),
      };
    }
  }
  return out;
}

/** Resolve writable versioning slug (entry drafts or template `single`). */
function resolveWritableVersioningSlug(
  contentType: string,
  contentSlug: string,
  contentRoot: string,
): { ok: true; slug: string; templateMode: boolean } | { ok: false; error: string; status: number } {
  return resolveWritableVersioningTarget(contentType, contentSlug, contentRoot);
}

export function registerVersioningRoutes(app: Express): void {
  // The hidden A/B check page is a locked system page: no variant or traffic writes.
  app.use("/api/versioning/:contentType/:contentSlug", (req, res, next) => {
    if (req.method === "GET") return next();
    const lock = abCheckPageLock(req.params.contentType, req.params.contentSlug, getContentRoot(res));
    if (lock) {
      res.status(403).json({ code: lock.code, error: lock.error });
      return;
    }
    next();
  });

  app.get("/api/debug/versioning", (req, res) => {
    const versioningManager = (res.locals.site as any)?.versioningManager ?? getVersioningManager();
    const stats = versioningManager.getStats();
    res.json({
      stats,
      totalVariants: Object.keys(stats).length,
    });
  });

  app.post("/api/debug/clear-versioning-cache", async (req, res) => {
    const auth = await requireCapability(req, res, "content_allocate_traffic");
    if (!auth.authorized) return;
    const versioningManager = (res.locals.site as any)?.versioningManager ?? getVersioningManager();
    versioningManager.clearCache();
    res.json({ success: true, message: "Versioning cache cleared" });
  });
  app.get("/api/variants/:contentType/:slug", (req, res) => {
    const { contentType, slug: requestSlug } = req.params;

    if (!isValidType(contentType)) {
      res
        .status(400)
        .json({ error: "Invalid content type", validTypes: getAllFolders() });
      return;
    }

    const slug = resolvePreviewBaseSlug(requestSlug, contentType, getCI(res));
    const versioningManager = (res.locals.site as any)?.versioningManager ?? getVersioningManager();
    const result = versioningManager.getAvailableVariants(contentType, slug);

    if (!result) {
      res.status(404).json({ error: "Content folder not found" });
      return;
    }

    res.json(result);
  });

  // Get versioning data for a specific content type and slug
  app.get("/api/versioning/:contentType/:contentSlug", async (req, res) => {
    const { contentType, contentSlug: requestSlug } = req.params;

    if (!isValidType(contentType)) {
      res.status(400).json({
        error: "Invalid content type",
        validTypes: getAllFolders(),
      });
      return;
    }

    const contentSlug = resolvePreviewBaseSlug(requestSlug, contentType, getCI(res));
    const root = getContentRoot(res);
    const shared = isSharedLayoutType(contentType, root);
    const entrySlug = isTemplateVersioningSlug(contentSlug) ? null : contentSlug;
    const detached = entrySlug ? isEntryDetached(contentType, entrySlug, root) : false;
    // Entry-level translation drafts (translate_entry) win over template remapping
    const resolvedSlug = resolveVersioningReadSlug(contentType, contentSlug, root);
    const availableLocales = getLocaleEntries().map((l: { code: string }) => l.code);

    const versioningManager = (res.locals.site as any)?.versioningManager ?? getVersioningManager();
    const versioning = versioningManager.getVersioningForContent(contentType, resolvedSlug);
    const filePath = versioningManager.getVersioningFilePath(contentType, resolvedSlug);
    const contentDir = versioningManager.getVersioningContentDir(contentType, resolvedSlug);
    const templateMode = isTemplateVersioningSlug(resolvedSlug);
    const liveByLocale: Record<string, boolean> = {};
    for (const loc of availableLocales) {
      liveByLocale[loc] = hasLiveLocaleFile(contentDir, loc, templateMode);
    }
    const hasLiveDefault = hasAnyLiveLocale(contentDir, templateMode, availableLocales);

    // Editorial title from ContentIndex (YAML `title`), not deslugified folder slug
    let title: string | null = null;
    let updatedAt: string | null = null;
    let publishedAt: string | null = null;
    if (entrySlug) {
      const indexed = getCI(res).findBySlug(entrySlug, { contentType });
      const indexedTitle = indexed[0]?.title?.trim();
      if (indexedTitle) title = indexedTitle;
      const localesForUpdatedAt =
        indexed[0]?.locales?.filter((l) => !l.startsWith("_") && !l.includes(".")) ??
        availableLocales;
      updatedAt = resolveStaticEntryUpdatedAt(
        contentType,
        entrySlug,
        localesForUpdatedAt.length > 0 ? localesForUpdatedAt : availableLocales,
        root,
      );
      publishedAt = normalizeFlexibleDate(readPublishedAt(contentType, entrySlug, root));
    }

    const attached = shared && !templateMode && !detached;
    const isDraft = !hasLiveDefault && !templateMode;
    const unregisteredVariants = listUnregisteredVariantFiles(
      contentDir,
      versioning,
      templateMode,
      availableLocales,
    );

    const abSite = { contentRoot: root, contentRootName: getContentRootName(res) };
    const ab_testing = {
      set_up: isAbTestingSetUp(abSite),
      latest_check_ok: isLatestCheckOk(abSite.contentRootName),
    };

    if (!versioning) {
      res.json({
        versioning: null,
        ab_testing,
        hasVersioningFile: false,
        filePath,
        availableLocales,
        detached,
        isSharedLayout: shared,
        isAttached: attached,
        versioningSlug: resolvedSlug,
        hasLiveDefault,
        liveByLocale,
        isDraft,
        title,
        updatedAt,
        publishedAt,
        unregisteredVariants,
        proposalsByVariant: {},
      });
      return;
    }

    res.json({
      versioning,
      ab_testing,
      split_health: getSplitHealth(
        {
          contentRoot: root,
          contentRootName: getContentRootName(res),
          versioningManager,
        },
        contentType,
        resolvedSlug,
      ),
      hasVersioningFile: true,
      filePath,
      availableLocales,
      detached,
      isSharedLayout: shared,
      isAttached: attached,
      versioningSlug: resolvedSlug,
      hasLiveDefault,
      liveByLocale,
      isDraft,
      title,
      updatedAt,
      publishedAt,
      unregisteredVariants,
      proposalsByVariant: templateMode
        ? {}
        : await proposalsByVariantFor({
            site: getContentRootName(res),
            contentType,
            slug: resolvedSlug,
            versioning,
            variantPath: (variant, locale) =>
              versioningManager.getVariantFilePath(contentType, resolvedSlug, variant, locale),
          }),
    });
  });

  // Update versioning allocations for a locale
  app.patch(
    "/api/versioning/:contentType/:contentSlug/:locale",
    async (req, res) => {
      const { contentType, contentSlug, locale } = req.params;

      if (!isValidType(contentType)) {
        res
          .status(400)
          .json({ error: "Invalid content type", validTypes: getAllFolders() });
        return;
      }

      const auth = await requireCapability(req, res, "content_allocate_traffic", contentType);
      if (!auth.authorized) return;

      const resolved = resolveWritableVersioningSlug(contentType, contentSlug, getContentRoot(res));
      if (!resolved.ok) {
        res.status(resolved.status).json({ error: resolved.error });
        return;
      }

      const parseResult = versioningUpdateSchema.safeParse(req.body);
      if (!parseResult.success) {
        res.status(400).json({
          error: "Invalid update data",
          details: parseResult.error.issues.map((i) => ({
            path: i.path.join("."),
            message: i.message,
          })),
        });
        return;
      }

      const versioningManager = (res.locals.site as any)?.versioningManager ?? getVersioningManager();
      try {
        const contentDir = versioningManager.getVersioningContentDir(contentType, resolved.slug);
        if (!hasAnyLiveLocale(contentDir, resolved.templateMode)) {
          res.status(400).json({
            error: "Cannot allocate traffic until a live locale exists. Publish a draft first.",
          });
          return;
        }

        const root = getContentRoot(res);
        const attachedEntry =
          !resolved.templateMode &&
          isSharedLayoutType(contentType, root) &&
          !isEntryDetached(contentType, resolved.slug, root);
        const trafficOnAttached = parseResult.data.variants.filter((v) => v.allocation > 0);
        if (attachedEntry && trafficOnAttached.length > 0) {
          res.status(400).json({
            code: "attached_variant_traffic",
            error:
              "Posts that use the shared template cannot run experiments on their own. " +
              "Variants here are drafts (0% traffic). Detach the entry first, or run the experiment on the shared template.",
            variants: trafficOnAttached.map((v) => v.slug),
          });
          return;
        }

        // Allocating traffic requires the locale variant file to exist
        for (const v of parseResult.data.variants) {
          if (v.allocation > 0) {
            const vp = versioningManager.getVariantFilePath(contentType, resolved.slug, v.slug, locale);
            if (!fs.existsSync(vp)) {
              res.status(400).json({
                error: `Cannot allocate traffic: missing variant file ${path.basename(vp)}`,
              });
              return;
            }
          }
        }

        // Old addresses cannot be split between visitors: a variant that changes them only goes live by publishing.
        if (!resolved.templateMode) {
          const blocked: Array<{ variant: string; added: string[]; removed: string[]; changed: string[] }> = [];
          for (const v of parseResult.data.variants) {
            if (v.allocation <= 0 || v.slug === "default") continue;
            const changes = variantRedirectChanges({
              contentType,
              slug: resolved.slug,
              locale,
              variant: v.slug,
              contentRoot: root,
            });
            if (hasRedirectChanges(changes)) {
              blocked.push({
                variant: v.slug,
                added: changes.added.map((i) => i.path),
                removed: changes.removed.map((i) => i.path),
                changed: changes.changed.map((i) => i.path),
              });
            }
          }
          if (blocked.length > 0) {
            res.status(400).json({
              code: "variant_has_redirect_changes",
              error:
                `${blocked.map((b) => `"${b.variant}"`).join(", ")} changes the page's old addresses. ` +
                "Redirects can't be split between visitors, so publish it instead of giving it traffic, or remove the redirect changes first. You can still lower traffic to 0%.",
              variants: blocked,
            });
            return;
          }
        }

        const existing = versioningManager.getVersioningForContent(contentType, resolved.slug) || {};
        const prevVariants = existing[locale]?.variants ?? [];
        const prevBySlug = new Map(prevVariants.map((v) => [v.slug, v.allocation]));
        const newVariants = parseResult.data.variants;
        const newSlugSet = new Set(newVariants.map((v) => v.slug));

        // Starting a test or raising a split needs A/B testing set up and a passing check.
        // Lowering (including to 0%) is always allowed.
        const raised = newVariants.filter((v) => v.allocation > (prevBySlug.get(v.slug) ?? 0));
        if (raised.length > 0) {
          const abSite = { contentRoot: root, contentRootName: getContentRootName(res) };
          if (!isAbTestingSetUp(abSite)) {
            res.status(400).json({
              code: "ab_testing_not_setup",
              error:
                "A/B testing has not been set up yet, so visitors only see the live page. " +
                "A Platform Steward sets it up once in Settings → Tracking → A/B testing; until then no version can get traffic. You can still lower or stop traffic.",
              setup_url: "/private/tracking/ab-testing#ab-setup",
            });
            return;
          }
          if (!isLatestCheckOk(abSite.contentRootName)) {
            res.status(400).json({
              code: "ab_check_failing",
              error:
                "The last A/B check failed. Running tests continue, but you can't start a test or raise traffic until a check passes. " +
                "You can still lower or stop traffic.",
              health_url: "/private/tracking/ab-testing#ab-health",
            });
            return;
          }
        }

        const newlyPublished = newVariants.filter((v) => {
          const prev = prevBySlug.get(v.slug) ?? 0;
          return prev === 0 && v.allocation > 0;
        });
        const unpublishedSlugs: string[] = [];
        for (const prev of prevVariants) {
          const next = newVariants.find((v) => v.slug === prev.slug);
          if (prev.allocation > 0 && (!next || next.allocation === 0)) {
            unpublishedSlugs.push(prev.slug);
          }
        }
        for (const prev of prevVariants) {
          if (prev.allocation > 0 && !newSlugSet.has(prev.slug) && !unpublishedSlugs.includes(prev.slug)) {
            unpublishedSlugs.push(prev.slug);
          }
        }

        if (newlyPublished.length > 0 && !parseResult.data.confirm_publish_variants) {
          res.status(400).json({
            error: "action_required",
            code: "confirm_publish_variants",
            message:
              "Assigning traffic publishes these variants and runs validation. Confirm to continue.",
            variants: newlyPublished.map((v) => v.slug),
          });
          return;
        }

        const ci = getCI(res);
        const cache = getValidationCache(res);
        const warningsByVariant: Record<string, unknown[]> = {};
        const issuesByVariant: Record<string, unknown[]> = {};
        const validationBySlug = new Map<
          string,
          Awaited<ReturnType<typeof validatePublishedVariantLayer>>
        >();

        if (newlyPublished.length > 0) {
          const site = res.locals.site as { contentRootName?: string } | undefined;
          const jobIds = [
            ...(parseResult.data.validation_job_id ? [parseResult.data.validation_job_id] : []),
            ...(parseResult.data.validation_job_ids ?? []),
          ];
          if (jobIds.length === 0) {
            const started = [];
            for (const v of newlyPublished) {
              const job = await startDiagnosticsJob({
                contentRoot: root,
                contentRootName: site?.contentRootName ?? path.basename(root),
                ci,
                cache,
                freshness: "hard",
                confirm: true,
                kind: "traffic",
                entry: {
                  contentType,
                  slug: resolved.slug,
                  locale,
                  variant: v.slug,
                },
                purpose: {
                  type: "traffic",
                  contentType,
                  slug: resolved.slug,
                  locale,
                  variant: v.slug,
                },
              });
              started.push(job);
            }
            const first = started[0]!;
            res.status(diagnosticsHttpStatus(first)).json({
              ...first,
              validation_job_ids: started
                .map((j) => ("job_id" in j ? j.job_id : undefined))
                .filter((id): id is string => !!id),
            });
            return;
          }

          const { readFileSync, existsSync } = fs;
          for (const v of newlyPublished) {
            const match = jobIds
              .map((id) => getDiagnosticsJob(root, id))
              .find(
                (j) =>
                  j.job?.purpose?.type === "traffic" &&
                  j.job.purpose.variant === v.slug &&
                  j.job.purpose.slug === resolved.slug &&
                  j.job.purpose.locale === locale,
              );
            if (!match || match.status !== "completed" || !match.job) {
              const pending = match?.job;
              res.status(200).json({
                status: match?.status ?? "not_found",
                job_id: pending?.jobId,
                retry_after_seconds: match?.retry_after_seconds ?? 2,
                message: "Still checking this version before anyone can see it.",
                validation_job_ids: jobIds,
              });
              return;
            }
            const resultsPath = path.join(
              root,
              ".cache",
              "diagnostics-jobs",
              `${match.job.jobId}-results.json`,
            );
            const results = existsSync(resultsPath)
              ? (JSON.parse(readFileSync(resultsPath, "utf-8")) as {
                  summary?: { errorCount?: number };
                  cacheApply?: import("../../scripts/validation/diagnosticsIpc").DeferredCacheApply;
                  validatorResults?: Array<{ errors?: unknown[]; warnings?: unknown[] }>;
                })
              : undefined;
            const errorCount =
              results?.summary?.errorCount ??
              (results?.validatorResults ?? []).reduce((n, row) => n + (row.errors?.length ?? 0), 0);
            if (errorCount > 0) {
              issuesByVariant[v.slug] = (results?.validatorResults ?? []).flatMap(
                (row) => row.errors ?? [],
              );
            } else if (results?.cacheApply) {
              const { applyDeferredDiagnosticsCache } = await import(
                "../services/applyDeferredDiagnostics"
              );
              await applyDeferredDiagnosticsCache(cache, { ...results.cacheApply, hold: false });
            }
            const warnings = (results?.validatorResults ?? []).flatMap((row) => row.warnings ?? []);
            if (warnings.length) warningsByVariant[v.slug] = warnings;
          }

          if (Object.keys(issuesByVariant).length > 0) {
            res.status(400).json({
              error: "Published variant validation failed",
              code: "variant_validation_failed",
              issuesByVariant,
              warningsByVariant:
                Object.keys(warningsByVariant).length > 0
                  ? warningsByVariant
                  : undefined,
            });
            return;
          }
        }

        const hadTraffic = prevVariants.some((v) => v.allocation > 0);
        const hasTraffic = newVariants.some((v) => v.allocation > 0);
        const prevStartedAt = existing[locale]?.started_at;
        const startedAt =
          !hadTraffic && hasTraffic ? new Date().toISOString().slice(0, 10) : prevStartedAt;
        const updated = {
          ...existing,
          [locale]: { variants: newVariants, ...(startedAt ? { started_at: startedAt } : {}) },
        };
        versioningManager.updateVersioning(contentType, resolved.slug, updated, {
          author: auth.author,
          contentRoot: root,
        });
        invalidateContentCaches(contentType, ci);

        for (const slug of unpublishedSlugs) {
          cache.clearEntryKey(buildEntryKey(contentType, resolved.slug, locale, slug));
        }

        for (const [slug, result] of validationBySlug) {
          if (!result.ok || !result.validators || !result.contentFile) continue;
          cache.applyValidatorResults(result.validators, {
            contentFiles: [result.contentFile],
            entryKeys: [result.entryKey],
            markSiteWide: false,
          });
        }

        if (newlyPublished.length > 0 || unpublishedSlugs.length > 0) {
          await cache.flush();
        }

        // Warm live + traffic-receiving variants on next anonymous render (invalidate is enough to force MISS).
        res.json({
          success: true,
          contentType,
          contentSlug: resolved.slug,
          locale,
          published: newlyPublished.map((v) => v.slug),
          unpublished: unpublishedSlugs,
          warningsByVariant:
            Object.keys(warningsByVariant).length > 0 ? warningsByVariant : undefined,
        });
      } catch (error) {
        res.status(400).json({
          error:
            error instanceof Error
              ? error.message
              : "Failed to update versioning",
        });
      }
    },
  );

  // Create a new content variant (copies locale file + registers in versioning.yml at 0% allocation)
  app.post("/api/versioning/:contentType/:contentSlug", async (req, res) => {
    const { contentType, contentSlug } = req.params;

    if (!isValidType(contentType)) {
      res.status(400).json({ error: "Invalid content type", validTypes: getAllFolders() });
      return;
    }

    const auth = await requireCapability(req, res, "content_create_variant", contentType);
    if (!auth.authorized) return;

    const resolved = resolveWritableVersioningSlug(contentType, contentSlug, getContentRoot(res));
    if (!resolved.ok) {
      res.status(resolved.status).json({ error: resolved.error });
      return;
    }

    const { variantSlug, locale, sourceVariant } = req.body as {
      variantSlug?: string;
      locale?: string;
      sourceVariant?: string;
    };

    if (!variantSlug || !locale) {
      res.status(400).json({ error: "variantSlug and locale are required" });
      return;
    }

    if (!/^[a-z0-9-]+$/.test(variantSlug)) {
      res.status(400).json({ error: "variantSlug must be lowercase letters, numbers, and hyphens only" });
      return;
    }
    if (isReservedTemplateVariantSlug(variantSlug)) {
      res.status(400).json({
        error: 'Variant slug "template" and "single" are reserved for the shared-layout shell',
      });
      return;
    }
    if (isReservedExperimentSlug(variantSlug)) {
      res.status(400).json({
        code: "reserved_variant",
        error: 'Variant slug "default" is reserved: it labels visitors who see the live page during a test',
      });
      return;
    }

    const versioningManager = (res.locals.site as any)?.versioningManager ?? getVersioningManager();
    const contentDir = versioningManager.getVersioningContentDir(contentType, resolved.slug);
    const root = getContentRoot(res);
    const folder = getFolder(contentType as ContentType);

    if (!fs.existsSync(contentDir)) {
      res.status(404).json({ error: "Content folder not found" });
      return;
    }

    const variantFilePath = versioningManager.getVariantFilePath(contentType, resolved.slug, variantSlug, locale);
    if (fs.existsSync(variantFilePath)) {
      res.status(409).json({
        error: resolved.templateMode
          ? `Variant ${variantTemplateBasename(variantSlug, locale)} already exists`
          : `Variant ${variantSlug}.${locale}.yml already exists`,
      });
      return;
    }

    const liveSourcePath = resolved.templateMode
      ? resolveTemplateLocalePath(contentDir, locale, { fallbackLocale: "" })
      : path.join(contentDir, `${locale}.yml`);

    let sourceFilePath = liveSourcePath;
    if (!fs.existsSync(sourceFilePath)) {
      // Draft mode: copy from an existing draft/variant for this locale
      const srcSlug = findSourceDraftVariant(
        contentDir,
        locale,
        sourceVariant,
        resolved.templateMode,
      );
      if (!srcSlug) {
        res.status(404).json({
          error: resolved.templateMode
            ? `Source file ${liveTemplateBasename(locale)} not found and no draft variants exist for ${locale}`
            : `Source file ${locale}.yml not found and no draft variants exist for ${locale}`,
        });
        return;
      }
      sourceFilePath = versioningManager.getVariantFilePath(
        contentType,
        resolved.slug,
        srcSlug,
        locale,
      );
    }

    try {
      const { stripDraftMetaFromRaw } = await import("../versioning/draft-meta");
      const { draftSeedFromLive, funnelCarriedWarning, recordDraftBase, scopeOptionsOf } = await import(
        "../versioning/draft-base"
      );
      // Never copy another file's `_draft` (base / proposal link / translation source).
      // From live, page-level keys stay in `_common.yml`; another draft's staged ones are kept.
      const sourceRaw = fs.readFileSync(sourceFilePath, "utf-8");
      const commonPath = path.join(contentDir, "_common.yml");
      const seeded =
        sourceFilePath === liveSourcePath
          ? draftSeedFromLive(sourceRaw, {
              ...scopeOptionsOf({ contentType, contentRoot: root }),
              ...(resolved.templateMode
                ? {}
                : { commonRaw: fs.existsSync(commonPath) ? fs.readFileSync(commonPath, "utf-8") : null }),
            })
          : { content: stripDraftMetaFromRaw(sourceRaw), carried: [] as string[] };
      const sourceContent = seeded.content;
      const seedWarnings = seeded.carried.includes("funnel") ? [funnelCarriedWarning(locale)] : [];
      const attachedEntry =
        !resolved.templateMode &&
        isSharedLayoutType(contentType, root) &&
        !isEntryDetached(contentType, resolved.slug, root);
      if (attachedEntry) {
        const structureErr = attachedOverlayStructureError(
          (getCI(res).safeYamlLoad(sourceContent) as Record<string, unknown>) || {},
        );
        if (structureErr) {
          res.status(400).json({
            code: "attached_draft_structure",
            error: `${structureErr} Drafts of posts that use the shared template may only change fields.`,
          });
          return;
        }
      }
      fs.writeFileSync(variantFilePath, sourceContent, "utf-8");
      const relPrimary = resolved.templateMode
        ? `${folder}/${variantTemplateBasename(variantSlug, locale)}`
        : `${folder}/${resolved.slug}/${variantSlug}.${locale}.yml`;
      markFileAsModified(relPrimary, auth.author || "api", undefined, root);
      recordDraftBase(
        { contentType, slug: resolved.slug, locale, variant: variantSlug, contentRoot: root },
        { author: auth.author || "api" },
      );

      // Template mode: fan out sibling-locale variant files with _label pending translation
      const createdSiblings: string[] = [];
      if (resolved.templateMode && fs.existsSync(liveSourcePath)) {
        const sourceData = (getCI(res).safeYamlLoad(sourceContent) as Record<string, unknown>) || {};
        const requesterId = auth.author || undefined;
        for (const sibling of listSiblingSinglePaths(contentDir, locale)) {
          const siblingVariantPath = path.join(
            contentDir,
            variantTemplateBasename(variantSlug, sibling.locale),
          );
          if (fs.existsSync(siblingVariantPath)) continue;
          const mirrored = buildMirroredLocaleSingle(sourceData, requesterId);
          // Preserve layout from sibling live single when present
          try {
            const siblingLive = getCI(res).safeYamlLoad(fs.readFileSync(sibling.filePath, "utf-8")) as Record<string, unknown> | null;
            if (siblingLive?.layout) mirrored.layout = siblingLive.layout;
          } catch { /* ignore */ }
          fs.writeFileSync(siblingVariantPath, dumpContentYaml(mirrored, { lineWidth: -1, noRefs: true, quotingType: '"', forceQuotes: false }, siblingVariantPath), "utf-8");
          markFileAsModified(`${folder}/${variantTemplateBasename(variantSlug, sibling.locale)}`, auth.author || "api", undefined, root);
          createdSiblings.push(sibling.locale);
        }
      }

      const existing = versioningManager.getVersioningForContent(contentType, resolved.slug) || {};
      const localeData = existing[locale]
        ? { ...existing[locale], variants: [...(existing[locale].variants || [])] }
        : { variants: [] as Array<{ slug: string; allocation: number }> };

      if (!localeData.variants.some((v) => v.slug === variantSlug)) {
        localeData.variants.push({ slug: variantSlug, allocation: 0 });
      }

      versioningManager.updateVersioning(
        contentType,
        resolved.slug,
        { ...existing, [locale]: localeData },
        { author: auth.author, contentRoot: root },
      );

      res.json({
        success: true,
        variantSlug,
        locale,
        templateMode: resolved.templateMode,
        siblingLocales: createdSiblings,
        filePath: `${getContentRootName(res)}/${relPrimary}`,
        seededFromDraft: !fs.existsSync(liveSourcePath),
        ...(seedWarnings.length ? { warnings: seedWarnings } : {}),
      });
    } catch (error) {
      res.status(500).json({ error: String(error) });
    }
  });

  // Register an existing variant file that versioning.yml does not list (at 0% traffic)
  api.post(app, "/api/versioning/:contentType/:contentSlug/register", { rate: "staffWrite" }, async (req, res) => {
    const { contentType, contentSlug } = req.params;

    if (!isValidType(contentType)) {
      res.status(400).json({ error: "Invalid content type", validTypes: getAllFolders() });
      return;
    }

    const auth = await requireCapability(req, res, "content_create_variant", contentType);
    if (!auth.authorized) return;

    const root = getContentRoot(res);
    const resolved = resolveWritableVersioningSlug(contentType, contentSlug, root);
    if (!resolved.ok) {
      res.status(resolved.status).json({ error: resolved.error });
      return;
    }

    const { variantSlug, locale } = (req.body ?? {}) as { variantSlug?: string; locale?: string };
    if (!variantSlug || !locale) {
      res.status(400).json({ error: "variantSlug and locale are required" });
      return;
    }
    if (
      !/^[a-z0-9-]+$/.test(variantSlug) ||
      isReservedTemplateVariantSlug(variantSlug) ||
      isReservedExperimentSlug(variantSlug)
    ) {
      res.status(400).json({ error: "Invalid variantSlug" });
      return;
    }
    if (!/^[a-z]{2}(-[A-Z]{2})?$/.test(locale)) {
      res.status(400).json({ error: "locale must be a valid language code (e.g. en, es, pt-BR)" });
      return;
    }

    const versioningManager = (res.locals.site as any)?.versioningManager ?? getVersioningManager();
    const contentDir = path.resolve(versioningManager.getVersioningContentDir(contentType, resolved.slug));
    const variantFilePath = path.resolve(
      versioningManager.getVariantFilePath(contentType, resolved.slug, variantSlug, locale),
    );
    if (!variantFilePath.startsWith(contentDir + path.sep)) {
      res.status(400).json({ error: "Invalid file path" });
      return;
    }
    if (!fs.existsSync(variantFilePath)) {
      res.status(404).json({ error: `Variant file ${path.basename(variantFilePath)} not found` });
      return;
    }

    const existing = versioningManager.getVersioningForContent(contentType, resolved.slug) || {};
    if (isVariantRegisteredInVersioning(existing, locale, variantSlug)) {
      res.status(409).json({
        code: "already_registered",
        error: `${variantSlug} is already listed for ${locale} in versioning.yml`,
      });
      return;
    }

    const localeVariants = [...(existing[locale]?.variants || []), { slug: variantSlug, allocation: 0 }];
    versioningManager.updateVersioning(
      contentType,
      resolved.slug,
      { ...existing, [locale]: { ...existing[locale], variants: localeVariants } },
      { author: auth.author || "api", contentRoot: root },
    );

    const versioning = versioningManager.getVersioningForContent(contentType, resolved.slug) || {};
    const availableLocales = getLocaleEntries().map((l: { code: string }) => l.code);
    res.json({
      success: true,
      variantSlug,
      locale,
      allocation: 0,
      versioning,
      unregisteredVariants: listUnregisteredVariantFiles(contentDir, versioning, resolved.templateMode, availableLocales),
      versioningFilePath: versioningManager.getVersioningFilePath(contentType, resolved.slug),
    });
  });

  // Publish all draft locales (all-or-nothing): promote variantSlug for every unpublished locale that has it
  app.post("/api/versioning/:contentType/:contentSlug/publish", async (req, res) => {
    const { contentType, contentSlug } = req.params;

    if (!isValidType(contentType)) {
      res.status(400).json({ error: "Invalid content type", validTypes: getAllFolders() });
      return;
    }

    const auth = await requireCapability(req, res, "content_promote_variant", contentType);
    if (!auth.authorized) return;

    const writeGate = await beginMcpContentWrite(req, {
      report: req.body?.report,
      why: req.body?.why,
      highlights: req.body?.highlights,
      mode:
        req.body?.why != null || req.body?.highlights != null
          ? "mutate_structural"
          : "legacy_report",
    });
    if (!writeGate.ok) {
      res.status(400).json({
        error: writeGate.error,
        code: writeGate.code,
        ...(writeGate.missing ? { missing: writeGate.missing } : {}),
      });
      return;
    }
    enterContentWriteContext(writeGate.ctx);

    const resolved = resolveWritableVersioningSlug(contentType, contentSlug, getContentRoot(res));
    if (!resolved.ok) {
      res.status(resolved.status).json({ error: resolved.error });
      return;
    }

    const { variantSlug } = req.body as { variantSlug?: string };
    if (!variantSlug || !/^[a-z0-9-]+$/.test(variantSlug)) {
      res.status(400).json({ error: "variantSlug is required (lowercase letters, numbers, hyphens)" });
      return;
    }

    const versioningManager = (res.locals.site as any)?.versioningManager ?? getVersioningManager();
    const contentDir = path.resolve(versioningManager.getVersioningContentDir(contentType, resolved.slug));
    const root = getContentRoot(res);
    const folder = getFolder(contentType as ContentType);

    if (!fs.existsSync(contentDir)) {
      res.status(404).json({ error: "Content folder not found" });
      return;
    }

    if (hasAnyLiveLocale(contentDir, resolved.templateMode)) {
      res.status(400).json({
        error:
          "Entry already has a live locale. Use per-locale promote to replace the live default.",
      });
      return;
    }

    const draftLocales = listDraftLocales(contentDir, resolved.templateMode);
    if (draftLocales.length === 0) {
      res.status(400).json({ error: "No draft locales found to publish" });
      return;
    }

    const missing: string[] = [];
    for (const loc of draftLocales) {
      const vp = versioningManager.getVariantFilePath(contentType, resolved.slug, variantSlug, loc);
      if (!fs.existsSync(vp)) missing.push(loc);
    }
    if (missing.length > 0) {
      res.status(400).json({
        error:
          `Draft variant "${variantSlug}" is missing for locale(s): ${missing.join(", ")}. ` +
          `Pick a variant present on all remaining draft locales, or delete incomplete locales first.`,
        missingLocales: missing,
      });
      return;
    }

    const { promoteVariantWithOptionalTeardown } = await import("../versioning/promote-with-teardown");
    const { findOpenProposalLinkForDraft } = await import("../content-proposals/service");
    const siteName = getContentRootName(res);
    const promoteLocale = (locale: string, dryRun: boolean) =>
      promoteVariantWithOptionalTeardown({
        contentType,
        slug: resolved.slug,
        locale,
        variantSlug,
        author: auth.author || "api",
        contentRoot: root,
        contentRootName: siteName,
        folder,
        templateMode: resolved.templateMode,
        versioningManager,
        ci: getCI(res),
        cache: getValidationCache(res),
        confirmOverwriteNewerLive: req.body?.confirm_overwrite_newer_live === true,
        confirmSourceChanged: req.body?.confirm_source_changed === true,
        callerIsSwarm: isSwarmCaller(req),
        callerIsMcp: typeof req.headers["x-mcp-author"] === "string",
        confirmTextLimits: req.body?.confirm_text_limits === true,
        confirmDisplayChange: req.body?.confirm_display_change === true,
        findOpenProposalForDraft: (ref) => findOpenProposalLinkForDraft(siteName, ref),
        dryRun,
        seoStandaloneReason:
          typeof req.body?.seo_standalone_reason === "string" ? req.body.seo_standalone_reason : null,
        localeUrlSlugs: localeUrlSlugsFromBody(req.body),
        robotsOnPublish: parseRobotsOnPublish(req.body?.robots_on_publish),
      });

    try {
      // All-or-nothing: every locale must pass every check before any file is written.
      // Robots changes are collected across locales so one choice can answer them all.
      const robotsChanges: Array<Record<string, unknown>> = [];
      for (const locale of draftLocales) {
        const check = await promoteLocale(locale, true);
        if (!check.ok && check.code === ROBOTS_CHANGE_ON_PUBLISH_CODE) {
          robotsChanges.push(check.details ?? { locale });
          continue;
        }
        if (!check.ok) {
          res.status(check.status ?? 400).json({
            error: `Cannot publish: ${check.error} (locale ${locale})`,
            code: check.code,
            locale,
            ...(check.details ? { details: check.details } : {}),
          });
          return;
        }
      }
      if (robotsChanges.length > 0) {
        const langs = robotsChanges.map((c) => String(c.locale)).join(", ");
        res.status(409).json({
          error: `Publishing changes whether search engines can see this page in ${langs}. Choose to keep the live values or use the draft's (one choice applies to every listed language).`,
          code: ROBOTS_CHANGE_ON_PUBLISH_CODE,
          details: { locales: robotsChanges },
        });
        return;
      }

      const publishedLocales: string[] = [];
      const warnings: Array<{ locale: string; code: string; message: string }> = [];
      for (const locale of draftLocales) {
        const result = await promoteLocale(locale, false);
        if (!result.ok) {
          res.status(result.status ?? 500).json({
            error: `Publish stopped at locale ${locale}: ${result.error}`,
            code: result.code,
            locale,
            published_locales: publishedLocales,
            ...(result.details ? { details: result.details } : {}),
          });
          return;
        }
        publishedLocales.push(locale);
        for (const w of result.warnings) warnings.push({ locale, code: w.code, message: w.message });
      }

      res.json({
        success: true,
        published: true,
        variantSlug,
        locales: publishedLocales,
        warnings,
      });
    } catch (error) {
      res.status(500).json({ error: String(error) });
    }
  });

  // Promote a variant: overwrite the default locale file, remove from versioning.yml, delete variant file
  app.post("/api/versioning/:contentType/:contentSlug/:locale/promote/:variantSlug", async (req, res) => {
    const { contentType, contentSlug, locale, variantSlug } = req.params;

    if (!isValidType(contentType)) {
      res.status(400).json({ error: "Invalid content type", validTypes: getAllFolders() });
      return;
    }

    const auth = await requireCapability(req, res, "content_promote_variant", contentType);
    if (!auth.authorized) return;

    const writeGate = await beginMcpContentWrite(req, {
      report: req.body?.report,
      why: req.body?.why,
      highlights: req.body?.highlights,
      mode:
        req.body?.why != null || req.body?.highlights != null
          ? "mutate_structural"
          : "legacy_report",
    });
    if (!writeGate.ok) {
      res.status(400).json({
        error: writeGate.error,
        code: writeGate.code,
        ...(writeGate.missing ? { missing: writeGate.missing } : {}),
      });
      return;
    }
    enterContentWriteContext(writeGate.ctx);

    const resolved = resolveWritableVersioningSlug(contentType, contentSlug, getContentRoot(res));
    if (!resolved.ok) {
      res.status(resolved.status).json({ error: resolved.error });
      return;
    }

    const versioningManager = (res.locals.site as any)?.versioningManager ?? getVersioningManager();
    const root = getContentRoot(res);
    const folder = getFolder(contentType as ContentType);
    const { promoteVariantWithOptionalTeardown } = await import("../versioning/promote-with-teardown");
    const { findOpenProposalLinkForDraft } = await import("../content-proposals/service");
    const siteName = getContentRootName(res);
    const result = await promoteVariantWithOptionalTeardown({
      contentType,
      slug: resolved.slug,
      locale,
      variantSlug,
      author: auth.author || "api",
      contentRoot: root,
      contentRootName: siteName,
      folder,
      templateMode: resolved.templateMode,
      versioningManager,
      ci: getCI(res),
      cache: getValidationCache(res),
      confirmEndExperiment: req.body?.confirm_end_experiment === true,
      // Versions UI: leave sibling experiments alone unless explicitly ending them
      endExperimentMode: req.body?.confirm_end_experiment === true,
      confirmOverwriteNewerLive: req.body?.confirm_overwrite_newer_live === true,
      confirmSourceChanged: req.body?.confirm_source_changed === true,
      callerIsSwarm: isSwarmCaller(req),
      callerIsMcp: typeof req.headers["x-mcp-author"] === "string",
      confirmTextLimits: req.body?.confirm_text_limits === true,
      confirmDisplayChange: req.body?.confirm_display_change === true,
      findOpenProposalForDraft: (ref) => findOpenProposalLinkForDraft(siteName, ref),
      dryRun: req.body?.dry_run === true,
      seoStandaloneReason:
        typeof req.body?.seo_standalone_reason === "string" ? req.body.seo_standalone_reason : null,
      localeUrlSlugs: localeUrlSlugsFromBody(req.body),
      robotsOnPublish: parseRobotsOnPublish(req.body?.robots_on_publish),
    });
    if (!result.ok) {
      res.status(result.status ?? 400).json({
        error: result.error,
        code: result.code,
        ...(result.traffic_siblings ? { traffic_siblings: result.traffic_siblings } : {}),
        ...(result.details ? { details: result.details } : {}),
      });
      return;
    }
    res.json({
      success: true,
      dry_run: result.dryRun === true,
      ignoredVariantSeo: result.ignoredVariantSeo,
      deletedSiblings: result.deletedSiblings,
      warnings: result.warnings,
      published_diff: result.publishedDiff,
      ...(result.rebuilt ? { rebuilt: result.rebuilt } : {}),
      versioning_deleted: result.versioningDeleted === true,
    });
  });

  // Convert live locale to draft (inverse of per-locale promote). Blocked on shared templates.
  app.post(
    "/api/versioning/:contentType/:contentSlug/:locale/convert-to-draft",
    async (req, res) => {
      const { contentType, contentSlug, locale } = req.params;

      if (!isValidType(contentType)) {
        res.status(400).json({ error: "Invalid content type", validTypes: getAllFolders() });
        return;
      }

      const auth = await requireCapability(req, res, "content_promote_variant", contentType);
      if (!auth.authorized) return;

      if (!/^[a-z]{2}(-[A-Z]{2})?$/.test(locale)) {
        res.status(400).json({ error: "locale must be a valid language code (e.g. en, es, pt-BR)" });
        return;
      }

      const resolved = resolveWritableVersioningSlug(contentType, contentSlug, getContentRoot(res));
      if (!resolved.ok) {
        res.status(resolved.status).json({ error: resolved.error });
        return;
      }

      if (resolved.templateMode) {
        res.status(400).json({
          error:
            "Convert to draft is blocked on the shared template. Detach this entry first, then convert this entry only.",
        });
        return;
      }

      const root = getContentRoot(res);
      const { convertLiveLocaleToDraft } = await import("../convert-live-locale-to-draft");
      const result = convertLiveLocaleToDraft({
        contentType,
        slug: resolved.slug,
        locale,
        contentRoot: root,
        author: auth.author || "api",
      });

      if (!result.ok) {
        res.status(result.status).json({ error: result.error });
        return;
      }

      {
        const { recordDraftBase } = await import("../versioning/draft-base");
        recordDraftBase(
          { contentType, slug: resolved.slug, locale, variant: result.variantSlug, contentRoot: root },
          { author: auth.author || "api" },
        );
      }

      getCI(res).invalidateCommonFields(contentType);
      clearSsrSchemaCache();
      invalidateContentCaches(contentType, getCI(res));
      getCI(res).refresh();
      refreshSitemapEntriesForContentKey(contentType, resolved.slug, [locale]);

      emitEntryLocaleUnpublished({
        site: getContentRootName(res),
        contentType,
        slug: resolved.slug,
        locale,
        author: auth.author || "api",
      });

      try {
        const { removeSeoIndexEntries, seoEntryId } = await import("../seo-index");
        removeSeoIndexEntries({
          contentRoot: root,
          entryIds: [seoEntryId(contentType, resolved.slug, locale)],
          author: auth.author || "api",
        });
        const { emitEntrySeoChanged } = await import("../content-events");
        emitEntrySeoChanged({
          site: getContentRootName(res),
          contentType,
          slug: resolved.slug,
          locale,
          path: result.liveRelPath,
          author: auth.author || "api",
          seoIndexSynced: true,
        });
      } catch {
        /* non-fatal */
      }

      res.json({
        success: true,
        variantSlug: result.variantSlug,
        locale,
        lastLiveLocale: result.lastLiveLocale,
        liveRelPath: result.liveRelPath,
        draftRelPath: result.draftRelPath,
        versioningRelPath: result.versioningRelPath,
      });
    },
  );

  // Unlink a draft from its proposal (staff only): removes `_draft.proposal`, draft content unchanged.
  app.post(
    "/api/versioning/:contentType/:contentSlug/:locale/:variantSlug/unlink-proposal",
    async (req, res) => {
      const { contentType, contentSlug, locale, variantSlug } = req.params;
      if (!isValidType(contentType)) {
        res.status(400).json({ error: "Invalid content type", validTypes: getAllFolders() });
        return;
      }
      const auth = await requireCapability(req, res, "content_promote_variant", contentType);
      if (!auth.authorized) return;
      if (isSwarmCaller(req)) {
        res.status(403).json({
          code: "staff_only",
          error: "Only staff can unlink a draft from its proposal.",
        });
        return;
      }
      const reason = typeof req.body?.reason === "string" ? req.body.reason.trim() : "";
      if (reason.length < 10) {
        res.status(400).json({ code: "reason_required", error: "Say why you are unlinking this draft (min 10 characters)." });
        return;
      }
      if (!/^[a-z0-9-]+$/.test(variantSlug) || !/^[a-z]{2}(-[A-Z]{2})?$/.test(locale)) {
        res.status(400).json({ error: "Invalid variant or locale" });
        return;
      }
      const resolved = resolveWritableVersioningSlug(contentType, contentSlug, getContentRoot(res));
      if (!resolved.ok) {
        res.status(resolved.status).json({ error: resolved.error });
        return;
      }
      const versioningManager = (res.locals.site as any)?.versioningManager ?? getVersioningManager();
      const variantFilePath = path.resolve(
        versioningManager.getVariantFilePath(contentType, resolved.slug, variantSlug, locale),
      );
      if (!fs.existsSync(variantFilePath)) {
        res.status(404).json({ error: "Draft file not found" });
        return;
      }
      const { readDraftMeta, writeDraftMeta } = await import("../versioning/draft-meta");
      const link = readDraftMeta(variantFilePath)?.proposal;
      if (!link) {
        res.json({ success: true, unlinked: false, message: "This draft is not linked to a proposal." });
        return;
      }
      writeDraftMeta(
        variantFilePath,
        { proposal: null },
        { author: auth.author || "api", contentRoot: getContentRoot(res) },
      );
      const { emitEvent } = await import("../events/event-store");
      const { singleAttribution } = await import("../events/types");
      emitEvent({
        site: getContentRootName(res),
        type: "draft_unlinked",
        resource: { contentType, slug: resolved.slug, locale },
        attribution: singleAttribution(auth.author || "api", { type: "ui" }),
        payload: { variant: variantSlug, proposal_id: link.id, env: link.env, reason },
      });
      res.json({ success: true, unlinked: true, proposal_id: link.id, env: link.env });
    },
  );

  // Delete a variant: remove its YML file and strip its entry from versioning.yml
  app.delete("/api/versioning/:contentType/:contentSlug/:locale/:variantSlug", async (req, res) => {
    const { contentType, contentSlug, locale, variantSlug } = req.params;

    if (!isValidType(contentType)) {
      res.status(400).json({ error: "Invalid content type", validTypes: getAllFolders() });
      return;
    }

    const auth = await requireCapability(req, res, "content_delete_variant", contentType);
    if (!auth.authorized) return;

    const resolved = resolveWritableVersioningSlug(contentType, contentSlug, getContentRoot(res));
    if (!resolved.ok) {
      res.status(resolved.status).json({ error: resolved.error });
      return;
    }

    if (!/^[a-z0-9-]+$/.test(variantSlug)) {
      res.status(400).json({ error: "variantSlug must be lowercase letters, numbers, and hyphens only" });
      return;
    }
    if (isReservedTemplateVariantSlug(variantSlug)) {
      res.status(400).json({
        error: 'Variant slug "template" and "single" are reserved for the shared-layout shell',
      });
      return;
    }

    if (!/^[a-z]{2}(-[A-Z]{2})?$/.test(locale)) {
      res.status(400).json({ error: "locale must be a valid language code (e.g. en, es, pt-BR)" });
      return;
    }

    const cleanupOrphan = parseCleanupOrphanFlag(
      req.query.cleanup_orphan,
      (req.body as { cleanup_orphan?: boolean } | undefined)?.cleanup_orphan,
    );

    const versioningManager = (res.locals.site as any)?.versioningManager ?? getVersioningManager();
    const contentDir = path.resolve(versioningManager.getVersioningContentDir(contentType, resolved.slug));
    const root = getContentRoot(res);
    const folder = getFolder(contentType as ContentType);

    if (!fs.existsSync(contentDir)) {
      res.status(404).json({ error: "Content folder not found" });
      return;
    }

    const variantFilePath = path.resolve(versioningManager.getVariantFilePath(contentType, resolved.slug, variantSlug, locale));

    if (!variantFilePath.startsWith(contentDir + path.sep)) {
      res.status(400).json({ error: "Invalid file path" });
      return;
    }

    const existingVersioning = versioningManager.getVersioningForContent(contentType, resolved.slug) || {};
    const traffic = variantTrafficBlock(existingVersioning, locale, variantSlug);
    if (traffic.blocked) {
      res.status(400).json({
        code: "VARIANT_HAS_TRAFFIC",
        error: variantTrafficErrorMessage(traffic.allocation),
        variantSlug,
        locale,
        allocation: traffic.allocation,
      });
      return;
    }

    const fileExists = fs.existsSync(variantFilePath);
    const registered = isVariantRegisteredInVersioning(existingVersioning, locale, variantSlug);

    if (fileExists) {
      const { readDraftMeta } = await import("../versioning/draft-meta");
      const { findOpenProposalLinkForDraft } = await import("../content-proposals/service");
      const linked = readDraftMeta(variantFilePath)?.proposal;
      const open = linked
        ? { id: linked.id, env: linked.env }
        : findOpenProposalLinkForDraft(getContentRootName(res), {
            contentType,
            slug: resolved.slug,
            locale,
            variant: variantSlug,
          });
      if (open) {
        res.status(409).json({
          code: "draft_in_proposal",
          error: `This draft is under review in proposal ${open.id}. Reject or withdraw the proposal before deleting the draft.`,
          details: { proposal_id: open.id, env: open.env },
        });
        return;
      }
    }

    if (!fileExists) {
      if (!cleanupOrphan) {
        res.status(404).json({
          error: resolved.templateMode
            ? `Variant file ${variantTemplateBasename(variantSlug, locale)} not found`
            : `Variant file ${variantSlug}.${locale}.yml not found`,
        });
        return;
      }
      if (!registered) {
        res.status(404).json({
          error: resolved.templateMode
            ? `Variant file ${variantTemplateBasename(variantSlug, locale)} not found and not registered in versioning.yml`
            : `Variant file ${variantSlug}.${locale}.yml not found and not registered in versioning.yml`,
        });
        return;
      }
    }

    try {
      const wasDraftEntry =
        !resolved.templateMode &&
        usesDraftFirstCreate(contentType, root) &&
        !hasAnyLiveLocale(contentDir, false);

      let orphanCleaned = false;
      if (fileExists) {
        fs.unlinkSync(variantFilePath);
        if (resolved.templateMode) {
          markFileAsModified(`${folder}/${variantTemplateBasename(variantSlug, locale)}`, auth.author || "api", undefined, root);
        } else {
          markFileAsModified(`${folder}/${resolved.slug}/${variantSlug}.${locale}.yml`, auth.author || "api", undefined, root);
        }
      } else {
        orphanCleaned = true;
      }

      const versioningRelPath = resolved.templateMode
        ? `${folder}/versioning.yml`
        : `${folder}/${resolved.slug}/versioning.yml`;

      let versioningEmptied = false;
      if (registered || fileExists) {
        const { data: pruned, isEmpty } = pruneVersioningAfterVariantRemove(
          existingVersioning,
          locale,
          variantSlug,
        );
        versioningEmptied = isEmpty;
        if (isEmpty) {
          versioningManager.deleteVersioningConfig(
            contentType,
            resolved.slug,
            auth.author || "api",
            root,
          );
        } else {
          versioningManager.updateVersioning(contentType, resolved.slug, pruned, {
            author: auth.author || "api",
            contentRoot: root,
          });
        }
      }

      // Deleting the last draft on an unpublished entry removes the whole entry
      if (wasDraftEntry && countVariantFiles(contentDir, false) === 0) {
        const del = await deleteContentEntry({
          type: contentType,
          slug: resolved.slug,
          author: auth.author || "api",
          contentRootName: getContentRootName(res),
        });
        if (!del.success) {
          res.status(del.statusCode).json({ error: del.error });
          return;
        }
        res.json({
          success: true,
          entryDeleted: true,
          orphanCleaned,
          message: "Last draft deleted; unpublished entry removed.",
        });
        return;
      }

      getCI(res).invalidateCommonFields(contentType);
      clearSsrSchemaCache();
      invalidateContentCaches(contentType, getCI(res));

      const cache = getValidationCache(res);
      cache.clearEntryKey(buildEntryKey(contentType, resolved.slug, locale, variantSlug));
      await cache.flush();

      const updated = versioningManager.getVersioningForContent(contentType, resolved.slug) || {};
      const availableLocales = resolved.templateMode
        ? getLocaleEntries().map((l: { code: string }) => l.code)
        : getCI(res).getAvailableLocalesOrVariants(contentType as ContentType, resolved.slug);

      let openProposals: Array<{ id: string; title: string; status: string }> = [];
      try {
        const { listOpenProposalsForVariant } = await import("../content-proposals");
        openProposals = listOpenProposalsForVariant(
          getContentRootName(res),
          contentType,
          resolved.slug,
          locale,
          variantSlug,
        );
      } catch {
        /* non-fatal */
      }
      const warnings =
        openProposals.length > 0
          ? openProposals.map((p) => ({
              code: "open_proposal_references_variant",
              message: `Open proposal "${p.title}" (${p.id}) still references this variant. Apply may fail with context_stale until the proposal is withdrawn or rejected.`,
              proposal_id: p.id,
              title: p.title,
            }))
          : [];

      res.json({
        success: true,
        hasVersioningFile: !versioningEmptied && Object.keys(updated).length > 0,
        versioning: updated,
        availableLocales,
        orphanCleaned,
        versioningFilePath: versioningRelPath,
        ...(warnings.length ? { warnings } : {}),
        ...(openProposals.length ? { open_proposals: openProposals } : {}),
      });
    } catch (error) {
      res.status(500).json({ error: String(error) });
    }
  });

}
