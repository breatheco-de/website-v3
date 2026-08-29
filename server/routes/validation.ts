import type { Express, Response } from "express";
import { getDefaultContentRoot } from "../site-config";
import * as fs from "fs";
import * as path from "path";
import { ValidationService } from "../../scripts/validation/service";
import { getCanonicalUrl, matchContentFilesForUrl } from "../../scripts/validation/shared/canonicalUrls";
import {
  getValidationCacheService,
  claimToApiRow,
  completionToApiRow,
} from "../services/validationCacheService";
import {
  CACHE_FRESHNESS_MAX_AGE_SECONDS,
  summarizeCacheFreshness,
} from "../services/validationCacheMerge";
import { buildUrlCoveragePage } from "../services/validationCoverage";
import { applyValidationRunToCache } from "../services/validationCachePostProcess";
import {
  DIAGNOSTICS_SKIP_FOR_PER_PAGE,
  getDiagnosticsJob,
  getPartialIssuesForRunningJob,
  isDiagnosticsRunning,
  listCacheIssues,
  listDiagnosticsJobs,
  maybeReloadValidationCache,
  startDiagnosticsJob,
  type DiagnosticsJobRecord,
} from "../services/diagnosticsJobService";
import { entryKeyFromContentFile, buildEntryKey } from "../../scripts/validation/shared/entryKey";
import {
  isEntryLocalValidator,
  ENTRY_LOCAL_VALIDATOR_NAMES,
} from "../../scripts/validation/shared/runClass";
import type { ValidationScope } from "../../scripts/validation/shared/runClass";
import { validators as allPageValidators } from "../../scripts/validation/validators";
import { getVersioningManager } from "../versioning";
import { countDatabaseCacheErrors } from "../../scripts/validation/shared/databaseHealthChecks";
import {
  isNonLocalFilesystemSrc,
  buildRegistrySrcToIdMap,
  resolveRegistryReference,
} from "../../scripts/validation/shared/imageRegistrySrc";
import type { ProgressEvent } from "../../scripts/validation/fixers/types";
import { contentIndex } from "../content-index";
import { generateSsrSchemaHtml } from "../ssr-schema";
import {
  hasSchemaOrgContributors,
  isSchemaOrgSection,
} from "@shared/schema-org-sections";
import { mediaGallery, MediaGallery } from "../media-gallery";
import { getMergedImageRegistry } from "../image-registry-resolver";
import type { SiteContext } from "../site-manager";
import {

  safeYamlLoad,
  requireCapability,
  requireMutatingStaff,
  resolveIssueActor,
  isMcpLoopbackRequest,
  requireIssueReport,
  sanitizeIssueReport,
  createValidationFixRun,
  appendValidationRunLog,
  applyFixerProgress,
  resolveFixerPipeline,
  validationRuns,
  validationRunOrder,
  MAX_VALIDATION_RUNS,
  MAX_RUN_LOG_ENTRIES,
  ValidationFixRunState,
  ValidationFixRunLogEntry,
  FixerItemStatus,
  resolveAgentSessionId,
} from "./_helpers";
import {
  emitValidationIssueWorkflowEvent,
  resolveSiteForIssue,
} from "../validation-events";
import { child } from "../logger";
const log = child({ module: "routes/validation" });

/** Returns the per-site ContentIndex for this request, falling back to the global singleton in single-site mode. */
function getCI(res: Response): typeof contentIndex {
  return (res.locals.site as any)?.contentIndex ?? contentIndex;
}

function getContentRoot(res: Response): string {
  return (res.locals.site as any)?.contentRoot ?? getDefaultContentRoot();
}

function getMediaGallery(res: Response): MediaGallery {
  return (res.locals.site as any)?.mediaGallery ?? mediaGallery;
}

function getValidationCache(res: Response) {
  return (res.locals.site as any)?.validationCache ?? getValidationCacheService();
}

/** Locale YAML sections win over _common when both define sections. */
function loadSectionsNearContentFile(filePath: string): unknown[] {
  try {
    let sections: unknown[] = [];
    const commonPath = path.join(path.dirname(filePath), "_common.yml");
    if (fs.existsSync(commonPath)) {
      const commonData =
        (safeYamlLoad(fs.readFileSync(commonPath, "utf-8")) as Record<string, unknown>) || {};
      if (Array.isArray(commonData.sections)) sections = commonData.sections as unknown[];
    }
    if (fs.existsSync(filePath)) {
      const localeData =
        (safeYamlLoad(fs.readFileSync(filePath, "utf-8")) as Record<string, unknown>) || {};
      if (Array.isArray(localeData.sections)) sections = localeData.sections as unknown[];
    }
    return sections;
  } catch {
    return [];
  }
}

/**
 * Returns a valid ValidationContext for the current request's site.
 *
 * Handlers construct a fresh ValidationService per request, so caching on the
 * service instance never hits. Keep a short-lived per-contentRoot cache here
 * so DebugBubble diagnostics don't re-parse every YAML on every page view.
 */
const siteContextCache = new Map<
  string,
  { context: Awaited<ReturnType<ValidationService["buildContext"]>>; builtAt: number }
>();
const SITE_CONTEXT_TTL_MS = 60_000;

async function ensureSiteContext(service: ValidationService, res: Response) {
  const contentRoot = getContentRoot(res);
  const cached = siteContextCache.get(contentRoot);
  if (cached && Date.now() - cached.builtAt < SITE_CONTEXT_TTL_MS) {
    return cached.context;
  }
  service.clearContext();
  const context = await service.buildContext({ contentRoot, ci: getCI(res) });
  siteContextCache.set(contentRoot, { context, builtAt: Date.now() });
  return context;
}

export function registerValidationRoutes(app: Express): void {
  // ============================================
  // Validation API Endpoints
  // ============================================

  // List available validators
  app.get("/api/validation/validators", (_req, res) => {
    const service = new ValidationService();
    const validators = service.getAvailableValidators();
    res.json({
      validators,
      total: validators.length,
    });
  });

  // Run all or specific validators
  app.post("/api/validation/run", async (req, res) => {
    try {
      const { validators: validatorNames, includeArtifacts, scope } = req.body;

      const service = new ValidationService();
      const context = await service.buildContext({
        contentRoot: getContentRoot(res),
        ci: getCI(res),
        scope,
      });

      const result = await service.runValidators({
        validators: validatorNames,
        includeArtifacts: includeArtifacts ?? false,
      });

      // Post-process: flush cache before responding so any immediate re-fetch
      // sees the updated results (no race condition).
      try {
        await applyValidationRunToCache(getValidationCache(res), result, context);
      } catch (err) {
        log.warn({ err }, "ValidationCache post-process error (non-fatal)");
      }

      res.json(result);
    } catch (error) {
      log.error({ err: error }, "Validation error:");
      res.status(500).json({
        error: "Validation failed",
        message: error instanceof Error ? error.message : "Unknown error",
      });
    }
  });

  // Run entry-local validators for a single page — merge into unified store
  app.post("/api/validation/run-page", async (req, res) => {
    try {
      const { url, validators: validatorNames, variant: bodyVariant } = req.body;

      if (!url || typeof url !== "string") {
        return res.status(400).json({ error: "Missing or invalid 'url' field" });
      }

      let variant: string | null =
        typeof bodyVariant === "string" && bodyVariant.trim()
          ? bodyVariant.trim()
          : null;
      if (!variant) {
        try {
          const u = new URL(url, "http://local");
          variant =
            u.searchParams.get("variant") ||
            u.searchParams.get("force_variant") ||
            null;
        } catch {
          /* path-only url */
        }
      }

      const service = new ValidationService();
      await service.buildContext({ contentRoot: getContentRoot(res), ci: getCI(res) });

      const context = service.getContext();
      if (!context) {
        return res.status(500).json({ error: "Failed to build validation context" });
      }

      const allContentFiles = context.contentFiles;
      const parsed = getCI(res).parseContentUrl(url);
      const filteredFiles = matchContentFilesForUrl(
        allContentFiles,
        url,
        parsed,
        variant,
      );

      if (variant && filteredFiles.length === 0) {
        return res.json({
          skipped: true,
          reason: "unpublished_variant",
          message:
            "This variant isn’t published (0% traffic). Diagnostics run after you assign traffic.",
          validators: [],
          summary: { passed: 0, failed: 0, warnings: 0 },
        });
      }

      context.contentFiles = filteredFiles;

      let effectiveValidators = validatorNames as string[] | undefined;
      if (effectiveValidators) {
        effectiveValidators = effectiveValidators.filter(
          (n) =>
            isEntryLocalValidator(n) &&
            !DIAGNOSTICS_SKIP_FOR_PER_PAGE.has(n) &&
            n !== "lighthouse",
        );
      } else {
        effectiveValidators = [
          ...ENTRY_LOCAL_VALIDATOR_NAMES.filter((n) =>
            allPageValidators.some((v) => v.name === n),
          ),
        ];
      }

      let result;
      try {
        result = await service.runValidators({
          validators: effectiveValidators,
          includeArtifacts: false,
        });
      } finally {
        context.contentFiles = allContentFiles;
      }

      try {
        const cache = getValidationCache(res);
        const entryKeys = filteredFiles.map((f) => entryKeyFromContentFile(f));
        for (const file of filteredFiles) {
          if (!file.variant) {
            cache.registerUrl(getCanonicalUrl(file), entryKeyFromContentFile(file));
          }
        }
        cache.applyValidatorResults(result.validators, {
          contentFiles: allContentFiles,
          entryKeys,
          markSiteWide: false,
        });
        await cache.flush();
      } catch (err) {
        log.warn({ err }, "ValidationCache post-process error (non-fatal)");
      }

      res.json(result);
    } catch (error) {
      log.error({ err: error }, "Validation run-page error:");
      res.status(500).json({
        error: "Validation failed",
        message: error instanceof Error ? error.message : "Unknown error",
      });
    }
  });

  // Explicit JSON format alias — same as /run but with a format extension
  app.post("/api/validation/run.json", async (req, res) => {
    try {
      const { validators: validatorNames, includeArtifacts } = req.body;
      const service = new ValidationService();
      await service.buildContext({ contentRoot: getContentRoot(res), ci: getCI(res) });
      const result = await service.runValidators({
        validators: validatorNames,
        includeArtifacts: includeArtifacts ?? false,
      });
      res.json(result);
    } catch (error) {
      log.error({ err: error }, "Validation error:");
      res.status(500).json({
        error: "Validation failed",
        message: error instanceof Error ? error.message : "Unknown error",
      });
    }
  });

  // LLM prompt format — runs validators and returns a copy-pasteable prompt
  app.post("/api/validation/run.prompt", async (req, res) => {
    const auth = await requireMutatingStaff(req, res);
    if (!auth.authorized) return;
    try {
      const { validators: validatorNames, includeArtifacts } = req.body;
      const { formatAsLlmPrompt } = await import("../../scripts/validation/reporting/llm-prompt");
      const service = new ValidationService();
      await service.buildContext({ contentRoot: getContentRoot(res), ci: getCI(res) });
      const result = await service.runValidators({
        validators: validatorNames,
        includeArtifacts: includeArtifacts ?? false,
      });
      const prompt = formatAsLlmPrompt(result);
      const issueCount = result.validators.reduce(
        (n, v) => n + v.errors.length + v.warnings.length,
        0,
      );
      res.json({
        prompt,
        validatorNames: result.validators.map((v) => v.name),
        issueCount,
      });
    } catch (error) {
      log.error({ err: error }, "Validation prompt error:");
      res.status(500).json({
        error: "Validation prompt failed",
        message: error instanceof Error ? error.message : "Unknown error",
      });
    }
  });

  // Generate a focused LLM prompt scoped to a specific promptTemplate key
  // Used when multiple validators share the same fix.promptTemplate and a combined prompt is more useful
  app.post("/api/validation/fix-prompt", async (req, res) => {
    try {
      const { promptTemplate, validators: validatorNames } = req.body as {
        promptTemplate?: string;
        validators?: string[];
      };
      const { formatAsLlmPrompt } = await import("../../scripts/validation/reporting/llm-prompt");
      const service = new ValidationService();
      await service.buildContext({ contentRoot: getContentRoot(res), ci: getCI(res) });
      const result = await service.runValidators({
        validators: validatorNames,
        includeArtifacts: false,
      });
      if (promptTemplate) {
        for (const v of result.validators) {
          v.errors = v.errors.filter((i: any) => i.fix?.promptTemplate === promptTemplate);
          v.warnings = v.warnings.filter((i: any) => i.fix?.promptTemplate === promptTemplate);
        }
        result.validators = result.validators.filter(
          (v) => v.errors.length > 0 || v.warnings.length > 0
        );
      }
      const issueCount = result.validators.reduce(
        (n, v) => n + v.errors.length + v.warnings.length,
        0,
      );
      const prompt = formatAsLlmPrompt(result);
      res.json({
        prompt,
        promptTemplate: promptTemplate ?? null,
        validatorNames: result.validators.map((v) => v.name),
        issueCount,
      });
    } catch (error) {
      log.error({ err: error }, "Fix-prompt error:");
      res.status(500).json({
        error: "Fix prompt failed",
        message: error instanceof Error ? error.message : "Unknown error",
      });
    }
  });

  // Save a full JSON report to /tmp/validation-reports/
  app.post("/api/validation/save-report", async (req, res) => {
    const auth = await requireMutatingStaff(req, res);
    if (!auth.authorized) return;
    try {
      const { formatAsJson } = await import("../../scripts/validation/reporting/json");
      const fs = await import("fs");
      const path = await import("path");

      const service = new ValidationService();
      await service.buildContext({ contentRoot: getContentRoot(res), ci: getCI(res) });

      const result = await service.runValidators({ includeArtifacts: true });

      const timestamp = new Date().toISOString();
      const fileName = `report-${timestamp.replace(/[:.]/g, "-")}.json`;
      const dir = "/tmp/validation-reports";
      const filePath = path.join(dir, fileName);

      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(filePath, formatAsJson(result, { pretty: true, includeTimestamp: true }), "utf-8");

      res.json({ ok: true, path: filePath, timestamp, summary: result.summary });
    } catch (error) {
      log.error({ err: error }, "Save-report error:");
      res.status(500).json({
        error: "Failed to save report",
        message: error instanceof Error ? error.message : "Unknown error",
      });
    }
  });

  // Run a single validator
  app.post("/api/validation/run/:name", async (req, res) => {
    try {
      const { name } = req.params;
      const { includeArtifacts } = req.body;

      const contentRoot: string = (res.locals.site as any)?.contentRoot
        ?? getDefaultContentRoot();

      const service = new ValidationService();
      const context = await service.buildContext({ contentRoot, ci: getCI(res) });

      const result = await service.runValidators({
        validators: [name],
        includeArtifacts: includeArtifacts ?? false,
      });

      // Same cache write path as POST /api/validation/run — otherwise Redirects /
      // single-validator UI refreshes the badge but leaves stale diagnostics issues.
      try {
        await applyValidationRunToCache(getValidationCache(res), result, context);
      } catch (err) {
        log.warn({ err }, "ValidationCache post-process error (non-fatal)");
      }

      res.json(result.validators[0]);
    } catch (error) {
      log.error({ err: error }, "Validation error:");
      res.status(500).json({
        error: "Validation failed",
        message: error instanceof Error ? error.message : "Unknown error",
      });
    }
  });

  // Get validation context info (for debugging)
  app.get("/api/validation/context", async (_req, res) => {
    try {
      const service = new ValidationService();
      const context = await ensureSiteContext(service, res);

      if (!context) {
        res.status(500).json({ error: "Failed to build context" });
        return;
      }

      // contentFiles is a flat array - count by type
      const contentFiles = context.contentFiles;
      const typeCounts = {
        programs: contentFiles.filter((f) => f.type === "program").length,
        landings: contentFiles.filter((f) => f.type === "landing").length,
        locations: contentFiles.filter((f) => f.type === "location").length,
        pages: contentFiles.filter((f) => f.type === "page").length,
      };

      res.json({
        contentFiles: typeCounts,
        totalFiles: contentFiles.length,
        validUrls: context.validUrls.size,
        availableSchemas: context.availableSchemas.length,
        redirects: context.redirectMap.size,
      });
    } catch (error) {
      log.error({ err: error }, "Context build error:");
      res.status(500).json({ error: "Failed to get context" });
    }
  });

  // Clear validation-cache.json (issues + run meta) for the current site
  app.post("/api/validation/clear-cache", async (req, res) => {
    const auth = await requireMutatingStaff(req, res);
    if (!auth.authorized) return;
    try {
      const site = res.locals.site as SiteContext | undefined;
      const contentRoot = site?.contentRoot ?? getDefaultContentRoot();
      if (isDiagnosticsRunning(contentRoot)) {
        res.status(409).json({
          success: false,
          error: "diagnostics_busy",
          message:
            "A diagnostics job is running for this site. Wait for it to finish before clearing the cache.",
        });
        return;
      }
      const cache = getValidationCache(res);
      await cache.clearAll();
      res.json({ success: true, message: "Validation cache cleared" });
    } catch (error) {
      log.error({ err: error }, "clear-cache error:");
      res.status(500).json({ error: "Failed to clear validation cache" });
    }
  });

  /** Remove v4→v5 migration orphans (`validator: "legacy"`) without wiping the rest of the cache. */
  app.post("/api/validation/purge-legacy-issues", async (req, res) => {
    const auth = await requireMutatingStaff(req, res);
    if (!auth.authorized) return;
    try {
      const site = res.locals.site as SiteContext | undefined;
      const contentRoot = site?.contentRoot ?? getDefaultContentRoot();
      if (isDiagnosticsRunning(contentRoot)) {
        res.status(409).json({
          success: false,
          error: "diagnostics_busy",
          message:
            "A diagnostics job is running for this site. Wait for it to finish before removing legacy issues.",
        });
        return;
      }
      const cache = getValidationCache(res);
      const { removed } = await cache.purgeLegacyIssues();
      res.json({
        success: true,
        removed,
        message:
          removed === 0
            ? "No legacy validator issues found."
            : `Removed ${removed} legacy validator issue${removed === 1 ? "" : "s"}.`,
      });
    } catch (error) {
      log.error({ err: error }, "purge-legacy-issues error:");
      res.status(500).json({ error: "Failed to purge legacy validation issues" });
    }
  });

  /** Dev-only: overwrite local validation-cache.json with the production GCS copy (never uploads). */
  app.post("/api/validation/pull-from-gcs", async (req, res) => {
    if (process.env.NODE_ENV === "production") {
      res.status(403).json({
        success: false,
        error: "dev_only",
        message: "Pulling the production validation cache is only available in development.",
      });
      return;
    }

    const auth = await requireMutatingStaff(req, res);
    if (!auth.authorized) return;

    try {
      const site = res.locals.site as SiteContext | undefined;
      const contentRoot = site?.contentRoot ?? getDefaultContentRoot();
      if (isDiagnosticsRunning(contentRoot)) {
        res.status(409).json({
          success: false,
          error: "diagnostics_busy",
          message:
            "A diagnostics job is running for this site. Wait for it to finish before pulling production cache.",
        });
        return;
      }

      const cache = getValidationCache(res);
      const result = await cache.pullFromBucket();
      if (!result.success || !result.pulled) {
        res.status(result.reason?.includes("unavailable") ? 503 : 404).json({
          success: false,
          error: "gcs_pull_failed",
          message: result.reason ?? "Failed to pull production validation cache",
          gcsKey: result.gcsKey,
          issueCount: result.issueCount,
        });
        return;
      }

      res.json({
        success: true,
        pulled: true,
        gcsKey: result.gcsKey,
        issueCount: result.issueCount,
        message: `Loaded ${result.issueCount} issue(s) from ${result.gcsKey} into local validation-cache.json.`,
      });
    } catch (error) {
      log.error({ err: error }, "pull-from-gcs error:");
      res.status(500).json({ error: "Failed to pull production validation cache" });
    }
  });

  // Run a named fixer
  app.post("/api/validation/fix/:fixerName", async (req, res) => {
    const auth = await requireMutatingStaff(req, res);
    if (!auth.authorized) return;
    try {
      const { fixerName } = req.params;
      const { getFixer } = await import("../../scripts/validation/fixers/index");
      if (!getFixer(fixerName)) {
        res.status(404).json({ error: `Fixer "${fixerName}" not found` });
        return;
      }
      const pipeline = resolveFixerPipeline(
        fixerName,
        (name) => getFixer(name) as { runAfter?: string[] } | undefined,
      );
      const createdRuns = pipeline.map((name) => createValidationFixRun(fixerName, name));
      let finalResult = {
        ok: true,
        message: `Completed ${pipeline.length} fixer(s)`,
      };

      for (let i = 0; i < pipeline.length; i++) {
        const currentFixerName = pipeline[i];
        const run = createdRuns[i];
        const currentFixer = getFixer(currentFixerName);
        if (!currentFixer) {
          run.running = false;
          run.completedAt = Date.now();
          run.message = `Fixer "${currentFixerName}" not found`;
          finalResult = { ok: false, message: run.message };
          break;
        }

        run.running = true;
        try {
          const result = await currentFixer.run({
            ...(req.body || {}),
            onProgress: (event: ProgressEvent) => applyFixerProgress(run, event),
          });
          run.running = false;
          run.completedAt = Date.now();
          run.message = result.message;
          finalResult = { ok: result.ok, message: result.message };
          if (!result.ok) {
            break;
          }
        } catch (error) {
          run.running = false;
          run.completedAt = Date.now();
          run.failed += 1;
          run.message = error instanceof Error ? error.message : "Unknown fixer error";
          finalResult = { ok: false, message: run.message };
          break;
        }
      }

      res.json({
        ...finalResult,
        runIds: createdRuns.map((run) => run.runId),
        pipeline,
      });
    } catch (error) {
      log.error({ err: error }, "Fixer error:");
      res.status(500).json({
        error: "Fixer failed",
        message: error instanceof Error ? error.message : "Unknown error",
      });
    }
  });

  // List available fixers
  app.get("/api/validation/fixers", async (_req, res) => {
    try {
      const { listFixers } = await import("../../scripts/validation/fixers/index");
      res.json(listFixers());
    } catch (error) {
      res.status(500).json({ error: "Failed to list fixers" });
    }
  });

  app.get("/api/validation/runs", (_req, res) => {
    const runs = validationRunOrder
      .map((runId) => validationRuns.get(runId))
      .filter((run): run is ValidationFixRunState => Boolean(run))
      .sort((a, b) => b.startedAt - a.startedAt);
    res.json(runs);
  });

  app.post("/api/validation/runs/clear", (_req, res) => {
    const cleared = validationRunOrder.length;
    validationRuns.clear();
    validationRunOrder.length = 0;
    res.json({ ok: true, cleared });
  });

  app.get("/api/validation/cache-summary", (_req, res) => {
    const cache = getValidationCache(res);
    const summary: Record<string, { errorCount: number; warningCount: number }> = {};
    const add = (key: string, entry: { errors: unknown[]; warnings: unknown[] }) => {
      summary[key] = {
        errorCount: entry.errors.length,
        warningCount: entry.warnings.length,
      };
    };
    for (const [url, entry] of cache.getAll()) {
      add(url, entry);
    }
    for (const [entryKey, entry] of cache.getAllByEntryKey()) {
      add(entryKey, entry);
    }
    res.json(summary);
  });

  app.get("/api/validation/cache-freshness", async (req, res) => {
    const auth = await requireCapability(req, res, "metrics_view");
    if (!auth.authorized) return;
    const cache = getValidationCache(res);
    const counts = summarizeCacheFreshness(
      cache.getAll().values(),
      CACHE_FRESHNESS_MAX_AGE_SECONDS,
    );
    res.json({
      ...counts,
      last_site_wide_run_at: cache.getLastSiteWideRunAt(),
    });
  });

  app.get("/api/validation/cache-freshness-urls", async (req, res) => {
    const auth = await requireCapability(req, res, "metrics_view");
    if (!auth.authorized) return;
    const cache = getValidationCache(res);
    const urlRows = Array.from(cache.getAll().entries()).map(([url, entry]) => {
      const entryKey = cache.resolveEntryKeyFromUrl(url);
      return {
        url,
        lastFullRunAt: entry.lastFullRunAt ?? null,
        runMeta: entryKey ? cache.getRunMetaForEntry(entryKey) : undefined,
      };
    });
    const q = typeof req.query.q === "string" ? req.query.q : undefined;
    const filter = req.query.filter === "fresh" || req.query.filter === "not_fresh"
      ? req.query.filter
      : "all";
    const page = typeof req.query.page === "string" ? Number(req.query.page) : undefined;
    const pageSize = typeof req.query.pageSize === "string" ? Number(req.query.pageSize) : undefined;
    const result = buildUrlCoveragePage(urlRows, [...ENTRY_LOCAL_VALIDATOR_NAMES], {
      q,
      filter,
      page: Number.isFinite(page) ? page : undefined,
      pageSize: Number.isFinite(pageSize) ? pageSize : undefined,
    });
    res.json(result);
  });

  app.get("/api/validation/database-cache-summary", (_req, res) => {
    const cache = getValidationCache(res);
    const all = cache.getAllDatabases();
    const summary: Record<string, { errorCount: number; warningCount: number; error_summary?: string }> = {};
    for (const [dbName, entry] of all) {
      summary[dbName] = {
        errorCount: countDatabaseCacheErrors(entry.errors),
        warningCount: entry.warnings.length,
        error_summary: entry.errors[0]?.message,
      };
    }
    res.json(summary);
  });

  app.get("/api/validation/cache-issues", async (req, res) => {
    const auth = await requireCapability(req, res, "metrics_view");
    if (!auth.authorized) return;
    const severityRaw = typeof req.query.severity === "string" ? req.query.severity : undefined;
    const severity =
      severityRaw === "error" || severityRaw === "warning" ? severityRaw : undefined;
    const filters = {
      entryKey: typeof req.query.entryKey === "string" ? req.query.entryKey : undefined,
      url: typeof req.query.url === "string" ? req.query.url : undefined,
      scope: typeof req.query.scope === "string" ? (req.query.scope as ValidationScope) : undefined,
      redirect: typeof req.query.redirect === "string" ? req.query.redirect : undefined,
      media: typeof req.query.media === "string" ? req.query.media : undefined,
      database: typeof req.query.database === "string" ? req.query.database : undefined,
      file: typeof req.query.file === "string" ? req.query.file : undefined,
      validator: typeof req.query.validator === "string" ? req.query.validator : undefined,
      category: typeof req.query.category === "string" ? req.query.category : undefined,
      code: typeof req.query.code === "string" ? req.query.code : undefined,
      severity,
    };
    const { issues, facets } = listCacheIssues(getValidationCache(res), filters);
    res.json({ issues, facets });
  });

  app.post("/api/validation/cache-issues/update", async (req, res) => {
    const auth = await requireMutatingStaff(req, res);
    if (!auth.authorized) return;
    const issueId = typeof req.body?.issueId === "string" ? req.body.issueId.trim() : "";
    const action = req.body?.action as string | undefined;
    if (!issueId) {
      return res.status(400).json({ error: "Missing required field: issueId" });
    }
    if (
      action !== "claim" &&
      action !== "release" &&
      action !== "complete" &&
      action !== "uncomplete"
    ) {
      return res.status(400).json({
        error: "Missing or invalid action (claim | release | complete | uncomplete)",
      });
    }
    const cache = getValidationCache(res);
    const author = auth.author || auth.username || "staff";
    const actor =
      action === "claim" || action === "complete" || action === "release"
        ? resolveIssueActor(req, { model: req.body?.model })
        : undefined;

    let report: string | undefined;
    if (action === "release") {
      const existing = cache.getActiveClaim(issueId);
      if (existing) {
        const parsed = requireIssueReport(req.body?.report);
        if (!parsed.ok) {
          return res.status(400).json({ error: parsed.error, code: parsed.code });
        }
        report = parsed.report;
      }
    } else if (isMcpLoopbackRequest(req) && (action === "claim" || action === "complete")) {
      if (action === "complete") {
        const parsed = requireIssueReport(req.body?.report);
        if (!parsed.ok) {
          return res.status(400).json({ error: parsed.error, code: parsed.code });
        }
        report = parsed.report;
      } else {
        const existing = cache.getActiveClaim(issueId);
        const isRefresh = existing?.claimedBy === author;
        if (!isRefresh) {
          const parsed = requireIssueReport(req.body?.report);
          if (!parsed.ok) {
            return res.status(400).json({ error: parsed.error, code: parsed.code });
          }
          report = parsed.report;
        } else {
          report = sanitizeIssueReport(req.body?.report);
        }
      }
    }

    const agent_session_id = resolveAgentSessionId(req);
    const result = await cache.updateIssue(issueId, action, author, {
      staffForceRelease: true,
      actor,
      report,
      agent_session_id,
    });
    if (!result.ok) {
      return res.status(result.status ?? 400).json({
        error: result.error,
        code: result.code,
        claimedBy: result.claimedBy,
      });
    }
    if (action === "claim" || action === "complete") {
      const issue = cache.getIssueById(issueId);
      const site =
        (res.locals.site as { contentRootName?: string } | undefined)?.contentRootName ??
        cache.getSiteFolder();
      if (issue && resolveSiteForIssue(issue, site)) {
        emitValidationIssueWorkflowEvent({
          type: action === "claim" ? "validation_issue_claimed" : "validation_issue_completed",
          site: resolveSiteForIssue(issue, site)!,
          issue,
          author,
          actor,
          report,
          agent_session_id,
        });
      }
    }
    return res.json({
      success: true,
      issueId,
      action: result.action,
      completed: result.completed ?? null,
      claimed: result.claimed ?? null,
      attempt: "attempt" in result ? result.attempt ?? null : null,
    });
  });

  app.post("/api/validation/cache-issues/complete", async (req, res) => {
    const auth = await requireMutatingStaff(req, res);
    if (!auth.authorized) return;
    const issueId = typeof req.body?.issueId === "string" ? req.body.issueId.trim() : "";
    if (!issueId) {
      return res.status(400).json({ error: "Missing required field: issueId" });
    }
    const cache = getValidationCache(res);
    const completedBy = auth.author || auth.username || "staff";
    const actor = resolveIssueActor(req, { model: req.body?.model });
    let report: string | undefined;
    if (isMcpLoopbackRequest(req)) {
      const parsed = requireIssueReport(req.body?.report);
      if (!parsed.ok) {
        return res.status(400).json({ error: parsed.error, code: parsed.code });
      }
      report = parsed.report;
    }
    const result = await cache.updateIssue(issueId, "complete", completedBy, { actor, report });
    if (!result.ok) {
      return res.status(result.status ?? 404).json({ error: result.error });
    }
    const issue = cache.getIssueById(issueId);
    const site =
      (res.locals.site as { contentRootName?: string } | undefined)?.contentRootName ??
      cache.getSiteFolder();
    if (issue && resolveSiteForIssue(issue, site)) {
      emitValidationIssueWorkflowEvent({
        type: "validation_issue_completed",
        site: resolveSiteForIssue(issue, site)!,
        issue,
        author: completedBy,
        actor,
        report,
          agent_session_id: resolveAgentSessionId(req),
      });
    }
    return res.json({
      success: true,
      issueId,
      completed: result.completed,
    });
  });

  app.post("/api/validation/cache-issues/uncomplete", async (req, res) => {
    const auth = await requireMutatingStaff(req, res);
    if (!auth.authorized) return;
    const issueId = typeof req.body?.issueId === "string" ? req.body.issueId.trim() : "";
    if (!issueId) {
      return res.status(400).json({ error: "Missing required field: issueId" });
    }
    const cache = getValidationCache(res);
    const author = auth.author || auth.username || "staff";
    const result = await cache.updateIssue(issueId, "uncomplete", author);
    if (!result.ok) {
      return res.status(result.status ?? 404).json({ error: result.error });
    }
    return res.json({ success: true, issueId });
  });

  app.post("/api/validation/cache-issues/dismiss", async (req, res) => {
    const auth = await requireMutatingStaff(req, res);
    if (!auth.authorized) return;
    const { url, file, code } = req.body ?? {};
    if (!code || typeof code !== "string") {
      return res.status(400).json({ error: "Missing required field: code" });
    }
    const cache = getValidationCache(res);
    if (file && typeof file === "string") {
      const dismissed = await cache.dismissIssuesByFileAndCode(file, code);
      return res.json({ success: true, dismissed });
    }
    if (!url || typeof url !== "string") {
      return res.status(400).json({ error: "Missing required field: url or file" });
    }
    const dismissed = await cache.dismissIssuesByUrlAndCode(url, code);
    return res.json({ success: true, dismissed });
  });

  app.get("/api/validation/diagnostics-jobs", async (req, res) => {
    const auth = await requireCapability(req, res, "metrics_view");
    if (!auth.authorized) return;
    res.json({ jobs: listDiagnosticsJobs(getContentRoot(res)) });
  });

  app.get("/api/validation/diagnostics-jobs/:jobId", async (req, res) => {
    const auth = await requireCapability(req, res, "metrics_view");
    if (!auth.authorized) return;
    const contentRoot = getContentRoot(res);
    const result = getDiagnosticsJob(contentRoot, req.params.jobId);
    if (result.status === "not_found") {
      return res.status(404).json({
        status: "not_found",
        code: result.code ?? "diagnostics_job_lost",
        message: result.message,
        retry_after_seconds: 0,
      });
    }
    const job = result.job!;
    const running = result.status === "queued" || result.status === "running";
    let partialIssues: Record<string, unknown> | undefined;
    let partial = false;
    if (running) {
      try {
        partialIssues = await getPartialIssuesForRunningJob({
          contentRoot,
          ci: getCI(res),
          cache: getValidationCache(res),
          job,
        });
        partial = true;
      } catch (err) {
        log.warn({ err, jobId: job.jobId }, "Failed to load mid-run partial issues");
      }
    }
    return res.json({
      status: result.status,
      job_id: job.jobId,
      processed: job.processed,
      total: job.total,
      retry_after_seconds: result.retry_after_seconds ?? 0,
      scope: {
        urlCount: job.urlCount,
        staleUrlCount: job.staleUrlCount,
        slugs: job.slugs,
        validators: job.validators,
        partial: job.partial,
      },
      summary: job.summary,
      error: job.error,
      issuesBySlug: running ? (partialIssues ?? {}) : job.resultIssuesBySlug,
      partial: running ? partial : undefined,
      message: running
        ? "Job still running. issuesBySlug includes only URLs flushed since this job started (partial)."
        : result.message,
      validators: job.validatorResults,
      cache_updated: result.status === "completed",
      log: Array.isArray((job as DiagnosticsJobRecord).log)
        ? (job as DiagnosticsJobRecord).log
        : [],
    });
  });

  app.post("/api/validation/diagnostics-jobs", async (req, res) => {
    const auth = await requireMutatingStaff(req, res);
    if (!auth.authorized) return;
    try {
      const site = res.locals.site as { contentRootName?: string } | undefined;
      const contentRoot = getContentRoot(res);
      const result = await startDiagnosticsJob({
        contentRoot,
        contentRootName: site?.contentRootName ?? path.basename(contentRoot),
        ci: getCI(res),
        cache: getValidationCache(res),
        slugs: req.body?.slugs,
        urls: req.body?.urls,
        file: req.body?.file,
        freshness: req.body?.freshness,
        max_age_seconds: req.body?.max_age_seconds,
        validators: req.body?.validators,
        include_artifacts: req.body?.include_artifacts,
        categories: req.body?.categories,
        confirm: req.body?.confirm === true,
      });

      if (result.status === "busy") {
        return res.status(409).json(result);
      }
      return res.json(result);
    } catch (error) {
      log.error({ err: error }, "diagnostics-jobs start error:");
      res.status(400).json({
        error: "Failed to start diagnostics job",
        message: error instanceof Error ? error.message : "Unknown error",
      });
    }
  });

  // ============================================
  // Diagnostics API
  // ============================================

  app.get("/api/diagnostics/pages", async (req, res) => {
    const auth = await requireCapability(req, res, "metrics_view");
    if (!auth.authorized) return;
    try {
      const service = new ValidationService();
      const context = await ensureSiteContext(service, res);

      const pages = context.contentFiles.map((file) => {
        const url = getCanonicalUrl(file);
        return {
          url,
          title: file.title || file.slug,
          locale: file.locale,
          contentType: file.type,
          slug: file.slug,
          filePath: file.filePath,
          hasMeta: !!(file.meta?.page_title && file.meta?.description),
          hasSchema: hasSchemaOrgContributors(loadSectionsNearContentFile(file.filePath)),
        };
      });

      res.json({ pages, total: pages.length });
    } catch (error) {
      log.error({ err: error }, "Diagnostics pages error:");
      res.status(500).json({ error: "Failed to load pages" });
    }
  });

  app.get("/api/diagnostics/page", async (req, res) => {
    const auth = await requireCapability(req, res, "metrics_view");
    if (!auth.authorized) return;
    try {
      const url = req.query.url as string;
      if (!url) {
        res.status(400).json({ error: "Missing url query parameter" });
        return;
      }

      const variantParam =
        (typeof req.query.variant === "string" && req.query.variant) ||
        (typeof req.query.force_variant === "string" && req.query.force_variant) ||
        null;
      let variant = variantParam;
      if (!variant) {
        try {
          const u = new URL(url, "http://local");
          variant =
            u.searchParams.get("variant") ||
            u.searchParams.get("force_variant") ||
            null;
        } catch {
          /* path-only */
        }
      }

      const service = new ValidationService();
      const context = await ensureSiteContext(service, res);

      const parsed = getCI(res).parseContentUrl(url);
      const matchingFiles = matchContentFilesForUrl(
        context.contentFiles,
        url,
        parsed,
        variant,
      );
      const urlLocale =
        parsed?.locale ||
        (url.startsWith("/es/") ? "es" : url.startsWith("/en/") ? "en" : null);

      // Unpublished / missing published-variant row
      if (variant && matchingFiles.length === 0) {
        const contentType = parsed?.contentType ?? null;
        const slug = parsed?.slug ?? null;
        const locale = urlLocale || parsed?.locale || "en";
        let allocation = 0;
        let draftOnly = false;
        if (contentType && slug) {
          const versioningManager =
            (res.locals.site as any)?.versioningManager ?? getVersioningManager();
          const ver = versioningManager.getVersioningForContent(contentType, slug) || {};
          const locVariants = ver[locale]?.variants ?? [];
          const row = locVariants.find((v: { slug: string }) => v.slug === variant);
          allocation = row?.allocation ?? 0;
          const liveFiles = matchContentFilesForUrl(
            context.contentFiles,
            url,
            parsed,
            null,
          );
          draftOnly = liveFiles.every((f) => f.isDraft) && liveFiles.length > 0;
          if (!row && liveFiles.length === 0) {
            // still resolve draft-only from any matching slug files
            const any = context.contentFiles.filter(
              (f) => f.type === contentType && f.slug === slug,
            );
            draftOnly = any.length > 0 && any.every((f) => f.isDraft || f.variant);
          }
        }
        const entryKey =
          contentType && slug
            ? buildEntryKey(contentType, slug, locale, variant)
            : undefined;
        res.json({
          url,
          contentType: contentType || "unknown",
          slug: slug || "unknown",
          locale,
          variant,
          allocation,
          entryKey,
          filePath: "",
          title: slug || url,
          validationSkippedReason: "unpublished_variant",
          cached: null,
          dirty: false,
          schemaValidation: { valid: true, errors: [] },
          meta: {
            page_title: null,
            titleLength: 0,
            description: null,
            descriptionLength: 0,
            og_image: null,
            canonical_url: null,
            robots: null,
          },
          schema: {
            configured: false,
            includes: [],
            sources: [],
            renderedJsonLd: [],
            htmlPreview: "",
          },
          sections: { count: 0, types: [], hasFaq: false },
          images: {
            referencedIds: [],
            missingFromRegistry: [],
            missingFromDisk: [],
          },
          translations: { locale, availableLocales: [locale], counterpartUrl: null },
          redirects: { incomingRedirects: [] },
          emptyFields: [],
          issues: [],
          education: {
            summary: draftOnly
              ? "This variant isn’t published (0% traffic). Diagnostics run after you assign traffic. Redirects stay on the live locale file only. For unpublished entries, use Global Diagnostics or open preview without ?force_variant."
              : "This variant isn’t published (0% traffic). Diagnostics run after you assign traffic. Redirects stay on the live locale file only.",
          },
        });
        return;
      }

      const file =
        (urlLocale && matchingFiles.find((f: any) => f.locale === urlLocale)) ||
        matchingFiles.find((f: any) => f.locale !== "_common") ||
        matchingFiles[0] ||
        null;

      if (!file) {
        res.status(404).json({ error: `No content found for URL: ${url}` });
        return;
      }

      let allocationPct: number | undefined;
      if (file.variant) {
        const versioningManager =
          (res.locals.site as any)?.versioningManager ?? getVersioningManager();
        const ver =
          versioningManager.getVersioningForContent(file.type, file.slug) || {};
        const locVariants = ver[file.locale]?.variants ?? [];
        const row = locVariants.find(
          (v: { slug: string }) => v.slug === file.variant,
        );
        allocationPct = row?.allocation ?? undefined;
      }

      let rawData: Record<string, unknown> = {};
      try {
        const commonPath = path.join(
          path.dirname(file.filePath),
          "_common.yml",
        );
        if (fs.existsSync(commonPath)) {
          const commonData =
            (safeYamlLoad(fs.readFileSync(commonPath, "utf-8")) as Record<
              string,
              unknown
            >) || {};
          rawData = { ...commonData };
        }
        if (fs.existsSync(file.filePath)) {
          const localeData =
            (safeYamlLoad(fs.readFileSync(file.filePath, "utf-8")) as Record<
              string,
              unknown
            >) || {};
          rawData = { ...rawData, ...localeData };
        }
      } catch {}

      const schemaValidation: {
        valid: boolean;
        errors: Array<{
          path: string;
          code: string;
          message: string;
          expected?: string;
          received?: string;
        }>;
      } = { valid: true, errors: [] };
      try {
        const contentTypes = ["program", "landing", "location", "page"];
        if (contentTypes.includes(file.type)) {
          let inferredLocale = file.locale;
          if (!inferredLocale || inferredLocale === "_common") {
            inferredLocale =
              urlLocale || (url.startsWith("/es/") ? "es" : "en");
          }
          const folderSlug = path.basename(path.dirname(file.filePath));
          const result = getCI(res).loadContent({
            contentType: file.type,
            slug: folderSlug,
            localeOrVariant: file.variant
              ? `${file.variant}.${inferredLocale}`
              : inferredLocale,
          });
          if (!result.success) {
            schemaValidation.valid = false;
            schemaValidation.errors.push({
              path: "",
              code: "CONTENT_LOAD_FAILED",
              message: result.error,
            });
          } else {
            const data = result.data as Record<string, unknown>;
            const meta = data.meta as Record<string, unknown> | undefined;
            if (!meta?.page_title) {
              schemaValidation.errors.push({
                path: "meta.page_title",
                code: "MISSING_META",
                message: "Missing meta.page_title — a fallback will be used at render time",
              });
            }
            if (!meta?.description) {
              schemaValidation.errors.push({
                path: "meta.description",
                code: "MISSING_META",
                message: "Missing meta.description — an empty string fallback will be used",
              });
            }
          }
        }
      } catch (e) {
        schemaValidation.valid = false;
        schemaValidation.errors.push({
          path: "",
          code: "SCHEMA_CHECK_ERROR",
          message: String(e),
        });
      }

      const sections = (rawData.sections as any[]) || [];
      const sectionTypes = sections
        .filter((s: any) => s?.type)
        .map((s: any) => s.type);
      const hasFaq = sectionTypes.includes("faq");

      let schemaHtml = "";
      let parsedSchemas: any[] = [];
      try {
        // Prefer anonymous SSR HTML page cache (what was actually served) for
        // JSON-LD inspection; fall back to regenerating schema tags only.
        const site = res.locals.site as { contentRootName?: string } | undefined;
        const siteId =
          site?.contentRootName ?? path.basename(getContentRoot(res)) ?? "default";
        const {
          buildHtmlCacheKey,
          getCachedHtml,
        } = await import("../html-page-cache");
        const canonical = getCanonicalUrl(file);
        const fileMeta = (file.meta || {}) as Record<string, unknown>;
        const pathCandidates = new Set<string>([
          canonical,
          url.split("?")[0].split("#")[0],
        ]);
        if (Array.isArray(fileMeta.redirects)) {
          for (const r of fileMeta.redirects) {
            if (typeof r === "string") pathCandidates.add(r);
          }
        }
        if (file.slug === "home") {
          pathCandidates.add(`/${file.locale === "_common" ? "en" : file.locale}`);
          pathCandidates.add("/");
        }
        for (const pathname of pathCandidates) {
          if (typeof pathname !== "string" || !pathname.startsWith("/")) continue;
          const cached = getCachedHtml(buildHtmlCacheKey(siteId, pathname, "live"));
          if (cached?.html?.includes("application/ld+json")) {
            schemaHtml = cached.html;
            break;
          }
        }
        if (!schemaHtml) {
          schemaHtml = await generateSsrSchemaHtml(
            canonical,
            getCI(res),
            getContentRoot(res),
          );
        }
        const scriptRegex =
          /<script type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/g;
        let match: RegExpExecArray | null;
        while ((match = scriptRegex.exec(schemaHtml)) !== null) {
          try {
            parsedSchemas.push(JSON.parse(match[1]));
          } catch {}
        }
      } catch {}

      const imageIds = new Set<string>();
      function extractImageIds(obj: unknown): void {
        if (!obj || typeof obj !== "object") return;
        if (Array.isArray(obj)) {
          obj.forEach(extractImageIds);
          return;
        }
        const rec = obj as Record<string, unknown>;
        for (const [key, value] of Object.entries(rec)) {
          if (
            (key === "image_id" || key === "image") &&
            typeof value === "string"
          ) {
            imageIds.add(value);
          } else if (typeof value === "object" && value !== null) {
            extractImageIds(value);
          }
        }
      }
      extractImageIds(rawData);

      let registryImages: Record<string, any> = {};
      try {
        const site = res.locals.site as SiteContext | undefined;
        const reg = site
          ? getMergedImageRegistry(site)
          : getMediaGallery(res).getRegistry();
        if (reg) {
          registryImages = reg.images || {};
        }
      } catch {}

      const missingFromRegistry: string[] = [];
      const missingFromDisk: string[] = [];
      const srcToId = buildRegistrySrcToIdMap(registryImages);
      imageIds.forEach((ref) => {
        const resolved = resolveRegistryReference(ref, registryImages, srcToId);
        if (resolved === null) {
          missingFromRegistry.push(ref);
          return;
        }
        if (registryImages[resolved].src) {
          const src = String(registryImages[resolved].src);
          if (!isNonLocalFilesystemSrc(src)) {
            const srcPath = path.join(process.cwd(), src);
            if (!fs.existsSync(srcPath)) {
              missingFromDisk.push(resolved);
            }
          }
        }
      });

      const counterpartFile = context.contentFiles.find(
        (f: any) =>
          f.slug === file.slug &&
          f.type === file.type &&
          f.locale !== file.locale &&
          !f.variant,
      );
      const counterpartUrl = counterpartFile
        ? getCanonicalUrl(counterpartFile)
        : null;

      const incomingRedirects: string[] = [];
      if (!file.variant && context.redirectMap && context.redirectMap.size > 0) {
        context.redirectMap.forEach((entry: any, from: string) => {
          if (entry.to === url) {
            incomingRedirects.push(from);
          }
        });
      }

      const emptyFields: string[] = [];
      function findEmptyFields(obj: unknown, path: string = ""): void {
        if (!obj || typeof obj !== "object") return;
        if (Array.isArray(obj)) {
          obj.forEach((item, i) => findEmptyFields(item, `${path}[${i}]`));
          return;
        }
        const rec = obj as Record<string, unknown>;
        const criticalKeys = new Set([
          "title",
          "heading",
          "description",
          "subtitle",
          "tagline",
        ]);
        for (const [key, value] of Object.entries(rec)) {
          const fieldPath = path ? `${path}.${key}` : key;
          if (
            criticalKeys.has(key) &&
            typeof value === "string" &&
            value.trim() === ""
          ) {
            emptyFields.push(fieldPath);
          } else if (typeof value === "object" && value !== null) {
            findEmptyFields(value, fieldPath);
          }
        }
      }
      findEmptyFields(rawData);

      const meta = file.meta || {};
      const cache = getValidationCache(res);
      maybeReloadValidationCache(getContentRoot(res), cache);
      const entryKey = entryKeyFromContentFile(file);
      if (!file.variant) {
        cache.registerUrl(url, entryKey);
      }

      const storedIssues = cache.getIssuesByEntryKey(entryKey);
      const runMeta = cache.getRunMetaForEntry(entryKey);
      const issues = storedIssues.map((s) => {
        const completion = cache.getCompletion(s.id);
        const claim = cache.getActiveClaim(s.id);
        const attempts = cache.getAttempts(s.id);
        return {
          id: s.id,
          type: s.severity === "error" ? "error" : s.severity === "info" ? "info" : "warning",
          code: s.code,
          message: s.message,
          category: s.category,
          suggestion: s.suggestion,
          validator: s.validator,
          file: s.file,
          validationCacheBuiltAt: s.lastRunAt,
          completed: completion ? completionToApiRow(completion) : null,
          claimed: claim ? claimToApiRow(claim) : null,
          attempts: attempts.length > 0 ? attempts : undefined,
        };
      });

      const cachedEntry = file.variant
        ? cache.getByEntryKey(entryKey) ?? null
        : cache.getByUrl(url) ?? cache.getByEntryKey(entryKey) ?? null;

      res.json({
        url,
        contentType: file.type,
        slug: file.slug,
        locale: file.locale,
        variant: file.variant || null,
        allocation: allocationPct,
        entryKey,
        filePath: file.filePath,
        title: file.title,

        cached: cachedEntry,
        dirty: runMeta?.dirty === true,

        schemaValidation,

        meta: {
          page_title: meta.page_title || null,
          titleLength: meta.page_title ? meta.page_title.length : 0,
          description: meta.description || null,
          descriptionLength: meta.description ? meta.description.length : 0,
          og_image: meta.og_image || null,
          canonical_url: meta.canonical_url || null,
          robots: meta.robots || null,
        },

        schema: {
          configured: hasSchemaOrgContributors(sections) || parsedSchemas.length > 0,
          includes: sections
            .filter((s: any) => isSchemaOrgSection(s))
            .map((s: any) => {
              const st =
                typeof s.schema_type === "string"
                  ? s.schema_type
                  : typeof s.schemaType === "string"
                    ? s.schemaType
                    : "schema_org";
              return st;
            }),
          sources: Array.from(
            new Set(
              sections
                .filter((s: any) => s?.type && hasSchemaOrgContributors([s]))
                .map((s: any) => String(s.type)),
            ),
          ),
          renderedJsonLd: parsedSchemas,
          htmlPreview: schemaHtml,
        },

        sections: {
          count: sections.length,
          types: sectionTypes,
          hasFaq,
        },

        images: {
          referencedIds: Array.from(imageIds),
          missingFromRegistry,
          missingFromDisk,
        },

        translations: {
          locale: file.locale,
          availableLocales: [
            file.locale,
            ...(counterpartFile ? [counterpartFile.locale] : []),
          ],
          counterpartUrl,
        },

        redirects: {
          incomingRedirects,
        },

        emptyFields,

        issues,

        education: file.variant
          ? {
              summary: `This published variant (“${file.variant}”) has its own issue list. Check mark = you’ve fixed it; Claim = you’re working on it (30 minutes).`,
              details:
                "Redirect problems are tracked on the live locale page only, not here. Saving the page or clicking Validate can bring an issue back if it was marked fixed too early. Claims do not cancel when you re-validate.",
              advanced_paths: [
                "server/services/validationCacheService.ts",
                "client/src/components/DebugBubble/components/PageErrorsModal.tsx",
              ],
            }
          : {
              summary:
                "Everyone sees the same issue list for this page. Check mark = you’ve fixed it (drops out of the open count). Claim = you’re working on it (30 minutes).",
              details:
                "Any staff member can release a claim. Saving the page or clicking Validate may bring an issue back if it’s still there, but won’t cancel an active claim. Redirect problems update when redirects change, or when you run validation from Redirects / Global Health.",
              advanced_paths: [
                "server/services/validationCacheService.ts",
                "client/src/components/DebugBubble/components/PageErrorsModal.tsx",
                "server/routes/validation.ts",
              ],
            },
      });
    } catch (error) {
      log.error({ err: error }, "Diagnostics page error:");
      res.status(500).json({ error: "Failed to generate page diagnostics" });
    }
  });
}
