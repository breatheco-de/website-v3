import type { Express, Request, Response } from "express";
import type { PushProgressEvent } from '../github';
import { createServer, type Server } from "http";
import { storage } from "../storage";
import { geoGet, geoSet } from "../geo-cache";
import { getQueueStats, enqueueOptimization, getPendingOptimizations, getFailedEntries, retryFailedImages, resetOptimizeSession, getOptimizeSession, enqueueExternalImage } from "../image-registry";
import { getAllQueueState } from "../image-queue-state";
import { enrichWithEcommerceData } from "../ecommerce/ecommerce-resolver";


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
import { versioningContentSlug } from "../shared-layout-entry";
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
import { coerceProgramSlug } from "@shared/safe-href";
import { getBaseUrl } from "../hreflang";
import * as userManager from "../user-manager";
import * as userStore from "../user-store";
import type { CapabilityName } from "../user-store";
import { child } from "../logger";
const log = child({ module: "routes/_helpers" });



export const BREATHECODE_HOST =
  process.env.VITE_BREATHECODE_HOST || "https://breathecode.herokuapp.com";

/**
 * Extract a Breathecode token from the request.
 * Checks Authorization header ("Token <token>") and X-Debug-Token header.
 */
export function extractToken(req: Request): string | null {
  const authHeader = req.headers.authorization;
  const debugToken = req.headers["x-debug-token"] as string | undefined;
  if (authHeader?.startsWith("Token ")) return authHeader.slice(6);
  if (debugToken) return debugToken;
  return null;
}

/**
 * Verify that the requesting user has a specific capability.
 * In development mode, always grants access (returns authorized: true).
 * In production, validates the token via userManager and checks capability via userStore.
 *
 * Returns { authorized, token, username }.
 * If not authorized, writes the appropriate error response before returning.
 */
export async function requireCapability(
  req: Request,
  res: Response,
  capName: CapabilityName,
  contentType?: string
): Promise<{ authorized: boolean; token: string | null; username: string | null; author: string | null }> {
  // Resolve effective content type: prefer the explicit arg, then fall back to
  // common request locations so scoped routes that omit the arg are still enforced.
  const resolvedContentType: string | undefined =
    contentType ||
    (req.params as Record<string, string>).contentType ||
    (req.params as Record<string, string>).type ||
    req.body?.contentType ||
    req.body?.type ||
    undefined;

  const isDevelopment = process.env.NODE_ENV !== "production";
  const token = extractToken(req);

  if (isDevelopment) {
    // In dev mode, resolve username from token if present, but always allow
    if (token) {
      try {
        const profile = await userManager.validateToken(token);
        if (profile.valid && profile.username) {
          return { authorized: true, token, username: profile.username, author: profile.username };
        }
      } catch {
        // Ignore errors in dev
      }
    }
    return { authorized: true, token, username: null, author: null };
  }

  // Trusted-internal bypass: MCP server loopback calls send
  // "Authorization: Bearer <MCP_SERVER_SECRET>" (not the standard
  // "Token <...>" format that extractToken parses). Read it directly here,
  // mirroring the same pattern used in /api/auth/check-capability.
  const MCP_SERVER_SECRET = process.env.MCP_SERVER_SECRET || process.env.MCP_API_KEY || "";
  if (MCP_SERVER_SECRET) {
    const authHeader = req.headers.authorization || "";
    const bearerToken = authHeader.startsWith("Bearer ") ? authHeader.slice(7).trim() : "";
    if (bearerToken === MCP_SERVER_SECRET) {
      const mcpAuthorHeader = req.headers["x-mcp-author"];
      const author = typeof mcpAuthorHeader === "string" && mcpAuthorHeader ? mcpAuthorHeader : null;
      return { authorized: true, token: bearerToken, username: author, author };
    }
  }

  if (!token) {
    res.status(401).json({ error: "Authorization required" });
    return { authorized: false, token: null, username: null, author: null };
  }

  const profile = await userManager.validateToken(token);
  if (!profile.valid || !profile.username) {
    res.status(401).json({ error: "Your session has expired. Please log in again." });
    return { authorized: false, token, username: null, author: null };
  }

  if (!userStore.hasCapability(profile.username, capName, resolvedContentType)) {
    res.status(403).json({ error: `Insufficient permissions: ${capName} required` });
    return { authorized: false, token, username: profile.username, author: null };
  }

  // author = resolved Breathecode username (the single commit-author resolution path)
  const author = await userManager.resolveCommitAuthor(token);
  return { authorized: true, token, username: profile.username, author };
}

/**
 * Validates that the request carries a valid Breathecode staff token.
 * Does not require a specific capability — any authenticated staff session is enough.
 */
export async function requireStaffSession(
  req: Request,
  res: Response,
): Promise<{ authorized: boolean; token: string | null; username: string | null }> {
  const isDevelopment = process.env.NODE_ENV !== "production";
  const token = extractToken(req);

  if (isDevelopment) {
    if (token) {
      try {
        const profile = await userManager.validateToken(token);
        if (profile.valid && profile.username) {
          return { authorized: true, token, username: profile.username };
        }
      } catch {
        // Ignore errors in dev
      }
    }
    return { authorized: true, token, username: null };
  }

  if (!token) {
    res.status(401).json({ error: "Authorization required" });
    return { authorized: false, token: null, username: null };
  }

  const profile = await userManager.validateToken(token);
  if (!profile.valid || !profile.username) {
    res.status(401).json({ error: "Your session has expired. Please log in again." });
    return { authorized: false, token, username: null };
  }

  return { authorized: true, token, username: profile.username };
}

/**
 * Allow mutates on metrics surfaces (diagnostics jobs, insights rebuild, tracking
 * settings, etc.) for webmasters and any staff with at least one capability other
 * than metrics_view. Metrics-only viewers get 403.
 *
 * Dev mode always allows (same as requireCapability / requireStaffSession).
 */
export async function requireMutatingStaff(
  req: Request,
  res: Response,
): Promise<{ authorized: boolean; token: string | null; username: string | null; author: string | null }> {
  const isDevelopment = process.env.NODE_ENV !== "production";
  const token = extractToken(req);

  if (isDevelopment) {
    if (token) {
      try {
        const profile = await userManager.validateToken(token);
        if (profile.valid && profile.username) {
          return { authorized: true, token, username: profile.username, author: profile.username };
        }
      } catch {
        // Ignore errors in dev
      }
    }
    return { authorized: true, token, username: null, author: null };
  }

  const MCP_SERVER_SECRET = process.env.MCP_SERVER_SECRET || process.env.MCP_API_KEY || "";
  if (MCP_SERVER_SECRET) {
    const authHeader = req.headers.authorization || "";
    const bearerToken = authHeader.startsWith("Bearer ") ? authHeader.slice(7).trim() : "";
    if (bearerToken === MCP_SERVER_SECRET) {
      const mcpAuthorHeader = req.headers["x-mcp-author"];
      const author = typeof mcpAuthorHeader === "string" && mcpAuthorHeader ? mcpAuthorHeader : null;
      return { authorized: true, token: bearerToken, username: author, author };
    }
  }

  if (!token) {
    res.status(401).json({ error: "Authorization required" });
    return { authorized: false, token: null, username: null, author: null };
  }

  const profile = await userManager.validateToken(token);
  if (!profile.valid || !profile.username) {
    res.status(401).json({ error: "Your session has expired. Please log in again." });
    return { authorized: false, token, username: null, author: null };
  }

  if (!userStore.canMutateMetrics(profile.username)) {
    res.status(403).json({
      error: "Insufficient permissions: mutating metrics requires more than metrics_view",
    });
    return { authorized: false, token, username: profile.username, author: null };
  }

  const author = await userManager.resolveCommitAuthor(token);
  return { authorized: true, token, username: profile.username, author };
}

/** True when the request is a trusted MCP server loopback call. */
export function isMcpLoopbackRequest(req: Request): boolean {
  const secret = process.env.MCP_SERVER_SECRET || process.env.MCP_API_KEY || "";
  if (!secret) return false;
  const authHeader = req.headers.authorization || "";
  const bearerToken = authHeader.startsWith("Bearer ") ? authHeader.slice(7).trim() : "";
  return bearerToken === secret;
}

function sanitizeIssueActorModel(model: unknown): string | undefined {
  if (typeof model !== "string") return undefined;
  const trimmed = model.trim();
  if (!trimmed) return undefined;
  return trimmed.length > 64 ? trimmed.slice(0, 64) : trimmed;
}

export const ISSUE_REPORT_MIN_LENGTH = 20;
export const ISSUE_REPORT_MAX_LENGTH = 2000;

/** Trim and cap MCP issue claim/complete report text. */
export function sanitizeIssueReport(raw: unknown): string | undefined {
  if (typeof raw !== "string") return undefined;
  const trimmed = raw.trim().replace(/\s+/g, " ");
  if (!trimmed) return undefined;
  return trimmed.length > ISSUE_REPORT_MAX_LENGTH
    ? trimmed.slice(0, ISSUE_REPORT_MAX_LENGTH)
    : trimmed;
}

export function requireIssueReport(
  raw: unknown,
): { ok: true; report: string } | { ok: false; error: string; code: "report_required" | "report_too_short" } {
  const report = sanitizeIssueReport(raw);
  if (!report) {
    return {
      ok: false,
      error: "report required for MCP claim/complete (min 20 chars)",
      code: "report_required",
    };
  }
  if (report.length < ISSUE_REPORT_MIN_LENGTH) {
    return {
      ok: false,
      error: `report must be at least ${ISSUE_REPORT_MIN_LENGTH} characters`,
      code: "report_too_short",
    };
  }
  return { ok: true, report };
}

/**
 * Resolve actor provenance for validation issue claim/complete overlays.
 * MCP path: client from x-mcp-client (set by MCP server); model from body on MCP only.
 * Staff UI: type ui only — never trust client/model from browser POST.
 */
export function resolveIssueActor(
  req: Request,
  opts?: { model?: unknown },
): import("../../scripts/validation/shared/types").ValidationIssueActor {
  if (isMcpLoopbackRequest(req)) {
    const clientHeader = req.headers["x-mcp-client"];
    const client =
      typeof clientHeader === "string" && clientHeader.trim() ? clientHeader.trim() : undefined;
    const model = sanitizeIssueActorModel(opts?.model);
    return {
      type: "mcp",
      ...(client ? { client } : {}),
      ...(model ? { model } : {}),
    };
  }
  return { type: "ui" };
}

import type { EventActor } from "./events/types";
import { markFileAsModified } from "../sync-state";

/**
 * Resolve actor provenance for content writes and background events.
 * MCP path: client from x-mcp-client; model optional. Staff UI: type ui only (EC6).
 */
export function resolveEventActor(
  req: Request,
  opts?: { model?: unknown },
): EventActor {
  const issueActor = resolveIssueActor(req, opts);
  if (issueActor.type === "mcp") {
    return {
      type: "mcp",
      ...(issueActor.client ? { client: issueActor.client } : {}),
      ...(issueActor.model ? { model: issueActor.model } : {}),
    };
  }
  return { type: "ui" };
}

export function resolveSystemEventActor(source: string): EventActor {
  return { type: "system", source };
}

/** Mark a content file modified with optional request-derived actor provenance. */
export function markContentFileModified(
  filePath: string,
  opts: {
    author?: string;
    actor?: EventActor;
    req?: Request;
    contentRoot?: string;
    allowedExceptions?: Set<string>;
  },
): void {
  const actor = opts.actor ?? (opts.req ? resolveEventActor(opts.req) : undefined);
  markFileAsModified(
    filePath,
    opts.author,
    opts.allowedExceptions,
    opts.contentRoot,
    actor,
  );
}

export function safeYamlLoad(yamlStr: string): unknown {
  const { escaped, map } = escapeTemplateVars(yamlStr);
  const parsed = yaml.load(escaped);
  return unescapeObjectVars(parsed, map);
}

/**
 * Resolve the assigned variant *slug* for traffic (cookie sticky), without loading YAML.
 * Uses versioningContentSlug so attached shared-layout entries share template assignment.
 */
export function resolveAssignedVariantSlug(
  req: Request,
  res: Response,
  contentType: string,
  entrySlug: string,
  locale: string,
): string | null {
  if (extractToken(req)) return null;

  const root = (res.locals.site as { contentRoot?: string } | undefined)?.contentRoot;
  const versioningSlug = versioningContentSlug(contentType, entrySlug, root);

  const userId = readUserId(req, res);
  const versioningCookie = getVersioningCookie(req);
  const existingAssignments = versioningCookie?.assignments || [];
  const existing = existingAssignments.find(
    (a) => a.contentType === contentType && a.slug === versioningSlug && a.locale === locale,
  );

  const versioningManager = getVersioningManager();
  const assignedVariant = versioningManager.getAssignment(
    contentType,
    versioningSlug,
    locale,
    userId,
    existing?.variantSlug,
  );

  if (!assignedVariant) return null;

  const updatedAssignments = [
    ...existingAssignments.filter(
      (a) => !(a.contentType === contentType && a.slug === versioningSlug && a.locale === locale),
    ),
    { contentType, slug: versioningSlug, locale, variantSlug: assignedVariant, assignedAt: Date.now() },
  ];
  setVersioningCookie(res, userId, updatedAssignments);

  return assignedVariant;
}

/**
 * Attempt to assign a visitor to a variant using traffic allocation rules.
 * Returns the assigned variant content, or null if no variant applies.
 *
 * Authenticated requests (carrying an auth token) are exempt — editors always
 * see the default unless they explicitly use force_variant.
 *
 * For attached shared-layout, returns null (use resolveAssignedVariantSlug + merge).
 */
export function resolveVariantAssignment(
  req: Request,
  res: Response,
  contentType: string,
  slug: string,
  locale: string
): unknown | null {
  if (extractToken(req)) return null;

  const root = (res.locals.site as { contentRoot?: string } | undefined)?.contentRoot;
  const versioningSlug = versioningContentSlug(contentType, slug, root);

  // Attached shared-layout: assignment is template-level; callers should use
  // resolveAssignedVariantSlug and merge — do not return raw template as page body.
  if (versioningSlug !== slug) {
    return null;
  }

  const userId = readUserId(req, res);
  const versioningCookie = getVersioningCookie(req);
  const existingAssignments = versioningCookie?.assignments || [];
  const existing = existingAssignments.find(
    (a) => a.contentType === contentType && a.slug === versioningSlug && a.locale === locale
  );

  const versioningManager = getVersioningManager();
  const assignedVariant = versioningManager.getAssignment(
    contentType,
    versioningSlug,
    locale,
    userId,
    existing?.variantSlug,
  );

  if (!assignedVariant) return null;

  const variantContent = versioningManager.getVariantContent(contentType, versioningSlug, assignedVariant, locale);
  if (!variantContent) return null;

  const updatedAssignments = [
    ...existingAssignments.filter(
      (a) => !(a.contentType === contentType && a.slug === versioningSlug && a.locale === locale)
    ),
    { contentType, slug: versioningSlug, locale, variantSlug: assignedVariant, assignedAt: Date.now() },
  ];
  setVersioningCookie(res, userId, updatedAssignments);

  return variantContent;
}

export function safeYamlDump(obj: unknown, opts?: yaml.DumpOptions): string {
  const { escaped, map } = escapeObjectVars(obj);
  const dumped = yaml.dump(escaped, opts);
  return unescapeYamlDump(dumped, map);
}


export function invalidateContentCaches(contentType?: string, ci: typeof contentIndex = contentIndex): void {
  invalidateContentCachesWithoutHtml(contentType, ci);
  // Drop rendered HTML pages so anonymous visitors get fresh SSR after edits/sync.
  void import("../html-page-cache").then(({ invalidateHtmlPageCache }) => {
    invalidateHtmlPageCache();
  }).catch(() => {});
}

/** Common-fields + SSR schema only — no HTML page cache clear (path-scoped bust lives in flush). */
export function invalidateContentCachesWithoutHtml(
  contentType?: string,
  ci: typeof contentIndex = contentIndex,
): void {
  if (contentType) {
    ci.invalidateCommonFields(contentType);
  }
  clearSsrSchemaCache();
}

export type FixerItemStatus = "ok" | "skipped" | "failed";

export interface ValidationFixRunLogEntry {
  at: number;
  imageId: string;
  status: FixerItemStatus;
  message: string;
}

export interface ValidationFixRunState {
  runId: string;
  pipelineRoot: string;
  fixerName: string;
  running: boolean;
  total: number;
  processed: number;
  ok: number;
  skipped: number;
  failed: number;
  startedAt: number;
  completedAt?: number;
  message?: string;
  log: ValidationFixRunLogEntry[];
}

export const MAX_VALIDATION_RUNS = 10;
export const MAX_RUN_LOG_ENTRIES = 1000;
export const validationRuns = new Map<string, ValidationFixRunState>();
export const validationRunOrder: string[] = [];

export function createValidationFixRun(pipelineRoot: string, fixerName: string): ValidationFixRunState {
  const runId = `fix-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const run: ValidationFixRunState = {
    runId,
    pipelineRoot,
    fixerName,
    running: false,
    total: 0,
    processed: 0,
    ok: 0,
    skipped: 0,
    failed: 0,
    startedAt: Date.now(),
    log: [],
  };
  validationRuns.set(runId, run);
  validationRunOrder.unshift(runId);
  while (validationRunOrder.length > MAX_VALIDATION_RUNS) {
    const toRemove = validationRunOrder.pop();
    if (toRemove) {
      validationRuns.delete(toRemove);
    }
  }
  return run;
}

export function appendValidationRunLog(run: ValidationFixRunState, entry: ValidationFixRunLogEntry): void {
  run.log.push(entry);
  if (run.log.length > MAX_RUN_LOG_ENTRIES) {
    run.log.splice(0, run.log.length - MAX_RUN_LOG_ENTRIES);
  }
}

export function applyFixerProgress(run: ValidationFixRunState, event: ProgressEvent): void {
  if (event.type === "start") {
    run.total = event.total;
    run.processed = 0;
    run.ok = 0;
    run.skipped = 0;
    run.failed = 0;
    return;
  }

  run.processed += 1;
  if (event.status === "ok") run.ok += 1;
  if (event.status === "skipped") run.skipped += 1;
  if (event.status === "failed") run.failed += 1;
  appendValidationRunLog(run, {
    at: Date.now(),
    imageId: event.id,
    status: event.status,
    message: event.message,
  });
}

// ── Push-all run state ─────────────────────────────────────────────────────

export interface PushAllRunState {
  runId: string;
  running: boolean;
  phase: "diffing" | "uploading" | "committing" | "done";
  total: number;
  processed: number;
  created: number;
  updated: number;
  skipped: number;
  failed: number;
  errors: string[];
  commitSha?: string;
  repoUrl?: string;
  startedAt: number;
  completedAt?: number;
}

export let currentPushAllRun: PushAllRunState | null = null;

export function createPushAllRun(repoUrl?: string): PushAllRunState {
  const runId = `push-all-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const run: PushAllRunState = {
    runId,
    running: true,
    phase: "diffing",
    total: 0,
    processed: 0,
    created: 0,
    updated: 0,
    skipped: 0,
    failed: 0,
    errors: [],
    repoUrl,
    startedAt: Date.now(),
  };
  currentPushAllRun = run;
  return run;
}

export function applyPushAllProgress(run: PushAllRunState, event: PushProgressEvent): void {
  if (event.type === "diff") {
    run.total = event.toUpload;
    run.skipped = event.skipped;
    run.phase = event.toUpload > 0 ? "uploading" : "done";
    return;
  }
  if (event.type === "uploading") {
    run.processed = event.done;
    run.phase = event.done >= run.total ? "committing" : "uploading";
    return;
  }
  if (event.type === "done") {
    run.running = false;
    run.phase = "done";
    run.created = event.created.length;
    run.updated = event.updated.length;
    run.skipped = event.skipped.length;
    run.errors = event.errors;
    run.failed = event.errors.length;
    run.commitSha = event.commitSha;
    run.completedAt = Date.now();
    return;
  }
}

export function resolveFixerPipeline(
  rootFixerName: string,
  getFixerByName: (name: string) => { runAfter?: string[] } | undefined,
): string[] {
  const ordered: string[] = [];
  const visiting = new Set<string>();
  const visited = new Set<string>();

  const visit = (name: string): void => {
    if (visited.has(name)) return;
    if (visiting.has(name)) {
      throw new Error(`Circular fixer dependency detected at "${name}"`);
    }
    const fixer = getFixerByName(name);
    if (!fixer) {
      throw new Error(`Fixer "${name}" not found`);
    }
    visiting.add(name);
    for (const dep of fixer.runAfter ?? []) {
      visit(dep);
    }
    visiting.delete(name);
    visited.add(name);
    ordered.push(name);
  };

  visit(rootFixerName);
  return ordered;
}

// Schema for career-programs listing page (custom page type)
export const careerProgramsListingSchema = z.object({
  slug: z.string(),
  template: z.string(),
  title: z.string(),
  meta: z.object({
    page_title: z.string(),
    description: z.string(),
    redirects: z.array(z.string()).optional(),
    robots: z.string().optional(),
    priority: z.number().optional(),
    change_frequency: z.string().optional(),
  }),
  page_content: z.object({
    hero_title: z.string(),
    hero_subtitle: z.string(),
    search_placeholder: z.string(),
    difficulty_label: z.string(),
    difficulty_all: z.string(),
    difficulty_beginner: z.string(),
    difficulty_intermediate: z.string(),
    difficulty_advanced: z.string(),
    no_results: z.string(),
  }),
  courses: z.array(
    z.object({
      id: z.string(),
      title: z.string(),
      description: z.string(),
      duration: z.string(),
      difficulty: z.string(),
      lessons: z.number(),
      link: z.string().optional(),
    }),
  ),
});

export function loadCareerProgramsListing(locale: string, ci: typeof contentIndex = contentIndex) {
  const result = ci.loadContent({
    contentType: "page",
    slug: "career-programs",
    schema: careerProgramsListingSchema,
    localeOrVariant: locale,
  });

  if (!result.success) {
    log.warn(result.error);
    return null;
  }

  return result.data;
}

export function applyMetaFallback(data: Record<string, unknown>): void {
  if (!data.meta || typeof data.meta !== "object") {
    data.meta = {};
  }
  const meta = data.meta as Record<string, unknown>;
  if (!meta.page_title) {
    const fallbackTitle = data.title ?? data.name ?? data.slug;
    if (fallbackTitle) {
      meta.page_title = String(fallbackTitle);
    }
  }
  if (!meta.description) {
    meta.description = "";
  }
}

export function injectCanonicalIfMissing(
  data: Record<string, unknown>,
  contentType: string,
  locale: string,
): void {
  if (!data.meta || typeof data.meta !== "object") return;
  const meta = data.meta as Record<string, unknown>;
  if (meta.canonical_url) return;
  const urlPath = resolveContentTypeUrl(contentType, data, locale);
  if (!urlPath) return;
  meta.canonical_url = getBaseUrl() + urlPath;
}

export function loadCareerProgram(slug: string, locale: string, ci: typeof contentIndex = contentIndex): CareerProgram | null {
  const result = ci.loadContent<CareerProgram>({
    contentType: "program",
    slug,
    localeOrVariant: locale,
  });

  if (!result.success) {
    log.warn(result.error);
    return null;
  }

  applyMetaFallback(result.data as Record<string, unknown>);
  if (result.data.sections) {
    applyComponentSectionDefaults(result.data.sections as unknown[]);
    applyComponentImageSizes(result.data.sections as unknown[]);
  }
  enrichWithEcommerceData("program", slug, result.data as Record<string, unknown>);
  return result.data;
}

export function listCareerPrograms(
  locale: string,
  ci: typeof contentIndex = contentIndex,
): Array<{ slug: string; title: string; bc_slug: string }> {
  const slugs = ci.listContentSlugs("program");
  const programs: Array<{ slug: string; title: string; bc_slug: string }> = [];

  for (const slug of slugs) {
    const program = loadCareerProgram(slug, locale, ci);
    if (program) {
      const commonData = ci.loadCommonData("program", slug);
      const bcSlug = (commonData?.bc_slug as string) || slug;
      const resolvedSlug = coerceProgramSlug(program.slug, slug);
      if (!resolvedSlug) continue;
      programs.push({
        slug: resolvedSlug,
        title: program.title,
        bc_slug: bcSlug,
      });
    }
  }

  return programs;
}

export function loadLandingPage(slug: string, locale?: string, ci: typeof contentIndex = contentIndex): LandingPage | null {
  const effectiveLocale = locale || ((ci.loadCommonData("landing", slug)?.locale as string) || getDefaultLocale());
  const result = ci.loadContent<LandingPage>({
    contentType: "landing",
    slug,
    localeOrVariant: effectiveLocale,
  });

  if (!result.success) {
    log.warn(result.error);
    return null;
  }

  applyMetaFallback(result.data as Record<string, unknown>);
  if (result.data.sections) {
    applyComponentSectionDefaults(result.data.sections as unknown[]);
    applyComponentImageSizes(result.data.sections as unknown[]);
  }
  enrichWithEcommerceData("landing", slug, result.data as Record<string, unknown>);
  return result.data;
}

export function listLandingPages(ci: typeof contentIndex = contentIndex): Array<{
  slug: string;
  title: string;
  locale: string;
}> {
  const slugs = ci.listContentSlugs("landing");
  const landings: Array<{ slug: string; title: string; locale: string }> = [];

  for (const slug of slugs) {
    const commonData = ci.loadCommonData("landing", slug);
    const locale = (commonData?.locale as string) || getDefaultLocale();
    const landing = loadLandingPage(slug, locale, ci);
    if (landing) {
      const landingSlug = landing.slug || slug;
      const landingTitle = landing.title || "";
      if (landingTitle) {
        landings.push({ slug: landingSlug, title: landingTitle, locale });
      }
    }
  }

  return landings;
}

export function loadLocationPage(slug: string, locale: string, ci: typeof contentIndex = contentIndex): LocationPage | null {
  const result = ci.loadContent<LocationPage>({
    contentType: "location",
    slug,
    localeOrVariant: locale,
  });

  if (!result.success) {
    log.warn(result.error);
    return null;
  }

  applyMetaFallback(result.data as Record<string, unknown>);
  if (result.data.sections) {
    applyComponentSectionDefaults(result.data.sections as unknown[]);
    applyComponentImageSizes(result.data.sections as unknown[]);
  }
  enrichWithEcommerceData("location", slug, result.data as Record<string, unknown>);
  return result.data;
}

export function listLocationPages(locale: string, ci: typeof contentIndex = contentIndex): Array<{
  slug: string;
  name: string;
  city: string;
  country: string;
  region: string;
}> {
  const slugs = ci.listContentSlugs("location");
  const locations: Array<{
    slug: string;
    name: string;
    city: string;
    country: string;
    region: string;
  }> = [];

  for (const slug of slugs) {
    const location = loadLocationPage(slug, locale, ci);
    if (location && location.visibility === "listed") {
      locations.push({
        slug: location.slug,
        name: location.name,
        city: location.city,
        country: location.country,
        region: location.region,
      });
    }
  }

  return locations;
}

// Template Pages (4geeks-com/pages/)
export function loadTemplatePage(slug: string, locale: string, ci: typeof contentIndex = contentIndex): TemplatePage | null {
  const result = ci.loadContent<TemplatePage>({
    contentType: "page",
    slug,
    localeOrVariant: locale,
  });

  if (!result.success) {
    log.warn(result.error);
    return null;
  }

  applyMetaFallback(result.data as Record<string, unknown>);
  if (result.data.sections) {
    applyComponentSectionDefaults(result.data.sections as unknown[]);
    applyComponentImageSizes(result.data.sections as unknown[]);
  }
  enrichWithEcommerceData("page", slug, result.data as Record<string, unknown>);
  return result.data;
}

export { buildSingleEntryFromContent } from "../build-single-entry";

export function listTemplatePages(
  locale: string,
  ci: typeof contentIndex = contentIndex,
): Array<{ slug: string; title: string }> {
  const slugs = ci.listContentSlugs("page");
  const pages: Array<{ slug: string; title: string }> = [];

  for (const slug of slugs) {
    const page = loadTemplatePage(slug, locale, ci);
    if (page) {
      pages.push({
        slug: page.slug,
        title: page.title,
      });
    }
  }

  return pages;
}

export function detectLanguageFromRequest(req: Request): "en" | "es" {
  const acceptLang = req.headers["accept-language"] || "";
  const primary = acceptLang.split(",")[0]?.trim().toLowerCase() || "";
  if (primary.startsWith("es")) return "es";
  return "en";
}

