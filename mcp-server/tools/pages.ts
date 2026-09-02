import fs from "fs";
import path from "path";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import {
  getDirectory,
  loadContentTypes,
  isDbBacked,
  isSharedLayoutConfig,
  resolveContentType,
  scanPages,
  loadPage,
  loadVariantPage,
  safeLoad,
  safeDump,
  setValueAtPath,
  resolveSiteContext,
  listMcpSites,
} from "../lib/content.js";
import { assertSafeSegment, assertSafeLocale, assertWithinBase } from "../lib/sanitize.js";
import { notifyMcpContentWrite } from "../lib/content-write-notify.js";
import { checkCap, denyResponse, denyUnlessContentView, denyUnlessContentViewOrSeo } from "../lib/auth.js";
import {
  grantsCanMutateMetrics,
  hasCapAnyScope,
  visibleContentTypes,
  type CatalogGrant,
} from "../lib/tool-catalog.js";
import { mcpValidatorsFromCategories } from "../lib/diagnostics-categories.js";
import {
  buildDiagnosticsIssueQueue,
  cacheIssueRowsToQueueInput,
  diagnosticsIssuePageNextAction,
  diagnosticsIssueQueueFields,
  flattenIssuesBySlug,
  type DiagnosticsIssueQueueOptions,
  type DiagnosticsIssueQueueResult,
} from "../lib/diagnostics-issue-queue.js";
import { getTokenUsername, getTokenClientName } from "../lib/oauth.js";
import { buildLoopbackHeaders, missingSessionWarning } from "../lib/loopback.js";
import {
  AGENT_REPORT_ISSUE_COMPLETE_EXAMPLE,
  AGENT_REPORT_ISSUE_DESC,
  AGENT_REPORT_MUTATE_DESC,
  AGENT_REPORT_SESSION_DESC,
} from "../lib/agent-report.js";
import { buildEditorSystemHints } from "../../shared/editorSystemHints.js";
import { FILL_INTENT_GOAL_PRESET_OPTIONS } from "../../shared/fillIntent.js";
import {
  parseContentTypeStrategy,
} from "../../shared/contentTypeStrategy.js";
import { runContentTypeFieldPatch } from "../lib/content-type-field-mcp.js";
import type { ContentTypeEditorHint } from "../../server/content-types.js";
import { promoteWarnings, VARIANT_WARNINGS, actionRequired, diagnosticsAfterGoLiveNextAction, type McpTextResult, type McpWarning, type NextAction, type McpSideEffect } from "../lib/respond.js";
import {
  ok,
  fail,
  confirmLiveEditGate,
  resolveLayoutTargetGate,
  LAYOUT_TARGET_DESC,
  variantWarningsIfNeeded,
  wrotePayload,
  sharedStructuralEnvelope,
  mutateReportZodFields,
  requireMutateReport,
  type LayoutTarget,
} from "../lib/page-tool-helpers.js";
import {
  SEO_INCLUDE_IN_CLUSTERING,
  deriveIncludeInClustering,
  expandSeoClusterToggle,
  isSeoIncludeInClusteringPath,
} from "../lib/seo-cluster-toggle.js";
import { isSeoMonitoringEnabled } from "../../server/seo-monitoring.js";
import type { SeoBlock } from "../../server/seo-fields.js";
import {
  pathForLayoutTarget,
  versioningApiSlug,
  sharedTemplateBlastSideEffect,
  SHARED_TEMPLATE_HTML_CACHE_WARNING,
  ADD_SECTION_NO_BINDING_FANOUT,
  REMOVE_SECTION_NO_BINDING_FANOUT,
  REPLACE_NO_BINDING_FANOUT,
  REORDER_NO_BINDING_FANOUT,
  CREATE_ENTRY_SHARED_LAYOUT_WARNING,
} from "../lib/shared-layout.js";
import {
  hintsAfterAddArticle,
  hintsAfterReplaceSections,
  prepareArticleAddStamp,
} from "../lib/article-hints.js";
import {
  hintsAfterAddModal,
  hintsAfterReplaceModals,
} from "../lib/modal-hints.js";
import {
  SITE_PARAM_DESC,
  MULTI_SITE_TOOL_BLURB,
  siteFailResult,
  safeTopLevelFieldsForConfig,
  listExtraUrlPatternParams,
  observeParamValues,
  observeParamValuesByLocale,
  collectProposedUrlParamValues,
  collectProposedUrlParamValuesByLocale,
  validateUrlParamPeerValues,
  extractParamSlug,
  missingRequiredFields,
  getEditorConfig,
  editorRequiredModes,
  bodyModelForConfig,
  createViaForConfig,
  templateVarsNoteForBodyModel,
} from "../lib/entry-helpers.js";
import {
  resolveTranslateMode,
  splitTranslateContent,
  filterAllowedFields,
  buildTranslateLocaleData,
  draftMissingRequiredWarnings,
  listLiveLocaleFiles,
} from "../lib/translate-entry.js";
import { applyPurchasableToRecord, ecommerceManager, PURCHASABLE_FIELD } from "../../server/ecommerce/ecommerce-manager.js";
import { isKnownSeoFieldPath, SEO_YAML_KEY, resolveEntryUpdatedAtDetail } from "../../server/content-types.js";
import {
  applyEditorialUpdatedAtToData,
  operationsFromLocalePayload,
} from "../../server/editorial-updated-at.js";
import { getSeoIndexEntry, SEO_INDEX_FILENAME } from "../../server/seo-index.js";
import { buildSearchEnginesPagePayload } from "../../server/search-engines-page.js";
import {
  collectFormSourceHitsFromNode,
  collectFormSourceHitsFromUpdates,
  formSourceWriteGate,
} from "../lib/catalog-form-source-gate.js";

const MAIN_SERVER_PORT = process.env.PORT || "5000";
// Internal credential for loopback calls to capability-gated main-server endpoints.
// Must match the value used in server/routes/_helpers.ts trusted-internal bypass.
export const MCP_SERVER_SECRET = process.env.MCP_SERVER_SECRET || process.env.MCP_API_KEY || "";

const UPDATED_AT_STAMP_WARNING: McpWarning = {
  code: "updated_at_stamp",
  message:
    "title / meta.page_title / meta.description / section copy or images bump locale updated_at to now (overwrites a manual backdate). seo.*, meta.robots, redirects, og_image, priority, and change_frequency do not. Explicit updated_at-only saves do not bump. Variant save does not change live sitemap lastmod until promote.",
};

function resolvedUpdatedAtFields(
  contentType: string,
  slug: string,
  locale: string,
  contentRoot: string,
  record?: Record<string, unknown> | null,
): { updated_at: string | null; updated_at_source: "yaml" | "published_at" | null } {
  const { iso, source } = resolveEntryUpdatedAtDetail({
    contentType,
    slug,
    locale,
    record,
    contentRoot,
  });
  return { updated_at: iso, updated_at_source: source };
}

/** Page-level WebSite/Organization schema_org overrides — site schema-org.yml is unchanged. */
function schemaOrgPageOverrideWarnings(section: Record<string, unknown> | null | undefined): McpWarning[] {
  if (!section || String(section.type ?? "") !== "schema_org") return [];
  const t = String(section.schema_type ?? "");
  if (t === "WebSite") {
    return [
      {
        code: "schema_org_website_page_override",
        message:
          "Page-level schema_org WebSite section: properties were/are prefilled from site schema-org.yml but edits apply only to this page's JSON-LD. schema-org.yml is not modified.",
      },
    ];
  }
  if (t === "Organization") {
    return [
      {
        code: "schema_org_organization_page_override",
        message:
          "Page-level schema_org Organization section: properties were/are prefilled from site schema-org.yml but edits apply only to this page's JSON-LD. schema-org.yml is not modified.",
      },
    ];
  }
  return [];
}

function schemaOrgOverrideWarningsFromFieldUpdates(
  fields: Record<string, unknown>,
  existingSections?: Array<Record<string, unknown>>,
): McpWarning[] {
  const warnings: McpWarning[] = [];
  const seen = new Set<string>();
  for (const [pathKey, value] of Object.entries(fields)) {
    const m = /^sections\.(\d+)\.(schema_type|type)$/.exec(pathKey);
    if (m && pathKey.endsWith("schema_type")) {
      const t = String(value ?? "");
      if (t === "WebSite" || t === "Organization") {
        const code =
          t === "WebSite"
            ? "schema_org_website_page_override"
            : "schema_org_organization_page_override";
        if (!seen.has(code)) {
          seen.add(code);
          warnings.push(...schemaOrgPageOverrideWarnings({ type: "schema_org", schema_type: t }));
        }
      }
    }
    const secMatch = /^sections\.(\d+)(?:\.|$)/.exec(pathKey);
    if (secMatch && existingSections) {
      const idx = Number(secMatch[1]);
      const sec = existingSections[idx];
      for (const w of schemaOrgPageOverrideWarnings(sec)) {
        if (!seen.has(w.code)) {
          seen.add(w.code);
          warnings.push(w);
        }
      }
    }
  }
  return warnings;
}

/**
 * Build the Authorization + author headers for loopback calls to the main
 * server's capability-gated endpoints (e.g. /api/content/edit-sections).
 * Always sets x-mcp-author when MCP_SERVER_SECRET is set so the main server
 * skips shared-layout locale fan-out (agent owns sibling sync via next_actions).
 */
function internalHeaders(
  mcpToken?: string,
  opts?: { agentSessionId?: string; omitJsonContentType?: boolean },
): Record<string, string> {
  return buildLoopbackHeaders(mcpToken, opts);
}

/**
 * Checks for a remote conflict before writing fields to a file.
 * Reads the file, applies the field entries, computes intended content,
 * then checks for remote conflicts. Returns a conflict error or null if safe to proceed.
 */
async function getConflictError(
  filePath: string,
  relativePath: string,
  fieldEntries: Array<[string, unknown]>,
  intendedChangeLabel: Record<string, unknown>,
  domain?: string
): Promise<McpTextResult | null> {
  const currentData = (fs.existsSync(filePath) ? safeLoad(fs.readFileSync(filePath, "utf-8")) : null) || {};
  for (const [fp, val] of fieldEntries) {
    setValueAtPath(currentData, fp, val);
  }
  const intendedContent = safeDump(currentData);
  const conflictCheck = await checkRemoteConflict(relativePath, domain);
  if (conflictCheck.conflict) {
    return conflictError({
      relativePath,
      remoteContent: conflictCheck.remoteContent,
      intendedContent,
      intendedChange: intendedChangeLabel,
    });
  }
  return null;
}

/**
 * Call the main server's /api/content/edit-sections endpoint.
 * Returns { error } on failure or { data } on success (may include boundUpdates).
 */
async function callEditSectionsApi(
  params: {
    contentType: string;
    slug: string;
    locale: string;
    variant?: string;
    operations: Record<string, unknown>[];
    layoutTarget?: "entry" | "type_single" | "type_template";
    report?: string;
    agent_session_id?: string;
  },
  mcpToken?: string,
  domain?: string,
): Promise<{ error: McpTextResult } | { data: Record<string, unknown> }> {
  try {
    const url = `http://localhost:${MAIN_SERVER_PORT}/api/content/edit-sections${domain ? `?__site=${encodeURIComponent(domain)}` : ""}`;
    const res = await fetch(url, {
      method: "POST",
      headers: internalHeaders(mcpToken, { agentSessionId: params.agent_session_id }),
      body: JSON.stringify({
        contentType: params.contentType,
        slug: params.slug,
        locale: params.locale,
        operations: params.operations,
        ...(params.variant ? { variant: params.variant } : {}),
        ...(params.layoutTarget ? { layoutTarget: params.layoutTarget } : {}),
        ...(params.report ? { report: params.report } : {}),
      }),
    });
    const data = await res.json() as Record<string, unknown>;
    if (!res.ok) {
      const errMsg = (data.error as string) || `Server error: ${res.status}`;
      if (/Section index \d+ does not exist/.test(errMsg)) {
        return {
          error: fail(errMsg, {
            warnings: [
              {
                code: "section_index_no_create",
                message:
                  "Does not create sections[] slots or overlay patches. Reload indexes, or edit the template (template.{locale}.yml) with layout_target type_template. Overlay merge: server/section-merge.ts.",
              },
            ],
            next_actions: [
              {
                tool: "get_entry_fields",
                reason: "Reload current section indexes before retrying update_fields.",
                priority: "required",
                args_hint: {
                  slug: params.slug,
                  locale: params.locale,
                  contentType: params.contentType,
                },
              },
            ],
          }),
        };
      }
      // Product-scope / ecommerce validation — guide agents to exact property paths
      if (
        /ecommerce_products|programs\[\]\.id|ecommerce scope|purchasable product/i.test(errMsg)
      ) {
        const pathMatch = errMsg.match(/sections\[\d+\]\.data\.[^\s]+|programs\[\]\.id|ecommerce_products/);
        return {
          error: actionRequired(
            {
              success: false,
              action_required: "fix_ecommerce_product_scope",
              message: errMsg,
              property_path: pathMatch?.[0] ?? "ecommerce_products",
              details: {
                allowed:
                  'ecommerce_products: string[] | "all", or programs[].id, or inherit on program entry',
              },
            },
            [
              {
                tool: "explain_site",
                reason: "Read ecommerce product scope + funnel property paths",
                args_hint: { topic: "ecommerce" },
                priority: "required",
              },
              {
                tool: "get_component_schema",
                reason: "Confirm field-editor binds for this section type",
                priority: "recommended",
              },
              {
                tool: "update_fields",
                reason: "Set the cited property_path (e.g. sections[N].data.ecommerce_products or programs[].id)",
                priority: "required",
              },
            ],
          ),
        };
      }
      const { editApiErrorResult } = await import("../lib/live-required-fields.js");
      return {
        error: editApiErrorResult(errMsg, data, {
          slug: params.slug,
          locale: params.locale,
          contentType: params.contentType,
        }),
      };
    }
    return { data };
  } catch (e) {
    return { error: fail(`Failed to call edit-sections API: ${(e as Error).message}`) };
  }
}

function appendSharedTemplateHtmlCacheWarning(
  warnings: McpWarning[],
  data: Record<string, unknown>,
  layoutTarget?: "entry" | "type_single" | "type_template",
): void {
  if (
    typeof data.shared_template_html_cache === "string" ||
    (layoutTarget === "type_single" || layoutTarget === "type_template")
  ) {
    if (!warnings.some((w) => w.code === SHARED_TEMPLATE_HTML_CACHE_WARNING.code)) {
      warnings.push(SHARED_TEMPLATE_HTML_CACHE_WARNING);
    }
  }
}

/**
 * Call the main server's /api/content/edit-common endpoint.
 * Returns an error response on failure, or null on success.
 */
async function callEditCommonApi(
  params: {
    contentType: string;
    slug: string;
    operations: Record<string, unknown>[];
    report?: string;
    agent_session_id?: string;
  },
  mcpToken?: string,
  domain?: string
): Promise<McpTextResult | null> {
  try {
    const url = `http://localhost:${MAIN_SERVER_PORT}/api/content/edit-common${domain ? `?__site=${encodeURIComponent(domain)}` : ""}`;
    const res = await fetch(url, {
      method: "POST",
      headers: internalHeaders(mcpToken, { agentSessionId: params.agent_session_id }),
      body: JSON.stringify({
        contentType: params.contentType,
        slug: params.slug,
        operations: params.operations,
        ...(params.report ? { report: params.report } : {}),
      }),
    });
    const data = await res.json() as Record<string, unknown>;
    if (!res.ok) {
      const errMsg = (data.error as string) || `Server error: ${res.status}`;
      const { editApiErrorResult } = await import("../lib/live-required-fields.js");
      return editApiErrorResult(errMsg, data, {
        slug: params.slug,
        contentType: params.contentType,
      });
    }
    return null;
  } catch (e) {
    return fail(`Failed to call edit-common API: ${(e as Error).message}`);
  }
}

/**
 * Call the main server's /api/content/refresh-cache endpoint to flush
 * the in-memory content index after a direct FS write.
 * Side effect: also clears the sitemap cache. Does not refetch remote databases;
 * known URLs rebuild from the current SQLite snapshot only.
 */
async function callRefreshCacheApi(
  contentType?: string,
  domain?: string,
): Promise<{ ok: boolean; knownUrlCount?: number; error?: string }> {
  try {
    const url = `http://localhost:${MAIN_SERVER_PORT}/api/content/refresh-cache${domain ? `?__site=${encodeURIComponent(domain)}` : ""}`;
    const res = await fetch(url, {
      method: "POST",
      headers: internalHeaders(),
      body: JSON.stringify(contentType ? { contentType } : {}),
    });
    const data = await res.json() as { knownUrlCount?: number; error?: string };
    if (!res.ok) {
      return { ok: false, error: data.error || `HTTP ${res.status}` };
    }
    return { ok: true, knownUrlCount: data.knownUrlCount };
  } catch {
    return { ok: false, error: "refresh-cache request failed" };
  }
}

async function callRenameSlugApi(
  params: {
    contentType: string;
    folderSlug: string;
    locale: string;
    newSlug: string;
    createRedirect?: boolean;
    enforceRedirectPolicy?: boolean;
  },
  mcpToken?: string,
  domain?: string,
): Promise<{ ok: true; data: Record<string, unknown> } | { ok: false; error: McpTextResult }> {
  try {
    const url = `http://localhost:${MAIN_SERVER_PORT}/api/content/rename-slug${domain ? `?__site=${encodeURIComponent(domain)}` : ""}`;
    const res = await fetch(url, {
      method: "POST",
      headers: internalHeaders(mcpToken),
      body: JSON.stringify(params),
    });
    const data = await res.json() as Record<string, unknown>;
    if (!res.ok) {
      return { ok: false, error: fail((data.error as string) || `Server error: ${res.status}`) };
    }
    return { ok: true, data };
  } catch (e) {
    return { ok: false, error: fail(`Failed to call rename-slug API: ${(e as Error).message}`) };
  }
}

/** MCP GitHub: local YAML is already written; missing commitSha is not a write failure. */
const GITHUB_COMMIT_TOOL_BLURB =
  "GitHub: local YAML is written first; push is queued for auto-commit (or one batched commit if auto-commit is off). " +
  "Missing commitSha is not a write failure — do not retry this mutate.";

/**
 * Queue (or batch-commit) files via POST /api/github/commit { queue: true, files }.
 * One request per tool call — never parallel Contents API PUTs (GitHub 409).
 */
async function callCommitFilesApi(
  files: string[],
  message: string,
  mcpToken?: string,
  domain?: string
): Promise<{ commitSha?: string; queued?: boolean; warning?: string; connectRequired?: boolean }> {
  if (files.length === 0) return {};
  try {
    const url = `http://localhost:${MAIN_SERVER_PORT}/api/github/commit${domain ? `?__site=${encodeURIComponent(domain)}` : ""}`;
    const author = mcpToken ? getTokenUsername(mcpToken) : undefined;
    const res = await fetch(url, {
      method: "POST",
      headers: internalHeaders(mcpToken),
      body: JSON.stringify({
        queue: true,
        files,
        message,
        ...(author ? { author } : {}),
      }),
    });
    const data = (await res.json()) as Record<string, unknown>;
    if (res.status === 403 || data.code === "github_connect_required") {
      return {
        connectRequired: true,
        warning:
          (data.error as string) ||
          "GitHub Connect required for production commits. Staff must Connect GitHub in DebugBubble first.",
      };
    }
    if (res.status === 202 || data.queued) {
      return { queued: true };
    }
    if (res.ok && (data.success || data.commitHash)) {
      return { commitSha: (data.commitHash || data.commitSha) as string | undefined };
    }
    return { warning: `File written to disk but GitHub commit failed: ${(data.error as string) || `HTTP ${res.status}`}` };
  } catch (e) {
    return { warning: `File written to disk but GitHub commit failed: ${(e as Error).message}` };
  }
}

function githubCommitWarning(result: {
  queued?: boolean;
  warning?: string;
  connectRequired?: boolean;
}): McpWarning | undefined {
  if (result.connectRequired) {
    return {
      code: "github_connect_required",
      message:
        result.warning ||
        "Production commits need GitHub Connect by this BreatheCode user (DebugBubble → Connect). Connect does not replace env GITHUB_TOKEN used for pulls. Status: GET /api/github/user-connection.",
    };
  }
  if (result.queued) {
    return {
      code: "github_commit_queued",
      message:
        "Local YAML is written. GitHub push is queued for auto-commit (not on GitHub yet). " +
        "Missing commitSha is not a write failure — do not retry this mutate.",
    };
  }
  if (result.warning) {
    return { code: "github_commit_failed", message: result.warning };
  }
  return undefined;
}

/**
 * Check whether a file has a remote conflict before writing it.
 * Returns conflict info (including remote content) if a conflict is detected,
 * or null if it's safe to proceed.
 */
async function checkRemoteConflict(
  filePath: string,
  domain?: string
): Promise<{ conflict: true; remoteContent: string } | { conflict: false }> {
  try {
    const url = `http://localhost:${MAIN_SERVER_PORT}/api/github/file-status?file=${encodeURIComponent(filePath)}${domain ? `&__site=${encodeURIComponent(domain)}` : ""}`;
    const res = await fetch(url);
    if (!res.ok) return { conflict: false };
    const data = await res.json() as {
      hasConflict?: boolean;
      remoteContent?: string;
    };
    if (data.hasConflict && typeof data.remoteContent === "string") {
      return { conflict: true, remoteContent: data.remoteContent };
    }
    return { conflict: false };
  } catch {
    return { conflict: false };
  }
}

/** Build a structured conflict error including both remote and intended content. */
function conflictError(opts: {
  relativePath: string;
  remoteContent: string;
  intendedContent: string;
  intendedChange?: Record<string, unknown>;
}): McpTextResult {
  return {
    content: [{
      type: "text",
      text: JSON.stringify({
        error: "conflict",
        message:
          `Remote conflict detected on ${opts.relativePath}. ` +
          "The remote has been modified since the last pull. " +
          "Merge remoteContent with intendedContent and retry.",
        conflictedFile: opts.relativePath,
        remoteContent: opts.remoteContent,
        intendedContent: opts.intendedContent,
        ...(opts.intendedChange ? { intendedChange: opts.intendedChange } : {}),
      }, null, 2),
    }],
    isError: true,
  };
}

// ── Validation cache reader ──────────────────────────────────────────────────

const VALIDATION_CACHE_PATH = path.join(
  process.cwd(), "4geeks-com", "validation-cache.json"
);


interface ValidationIssueActorRef {
  type: "ui" | "mcp";
  client?: string;
  model?: string;
}

interface MappedValidationIssue {
  id?: string;
  code: string;
  message: string;
  severity: "error" | "warning";
  category: string;
  file?: string;
  suggestion?: string;
  completedBy?: string;
  completedAt?: string;
  completedActor?: ValidationIssueActorRef;
  completedReport?: string;
  claimedBy?: string;
  claimedAt?: string;
  expiresAt?: string;
  claimedActor?: ValidationIssueActorRef;
  claimReport?: string;
  prior_attempts?: Array<{
    by: string;
    claimedBy?: string;
    at: string;
    reason: "released" | "ttl_expired" | "complete_rejected_still_open";
    report?: string;
    claimedAt?: string;
    claimReport?: string;
    actor?: ValidationIssueActorRef;
  }>;
}

type CachedValidationIssuesSplit = {
  open: MappedValidationIssue[];
  claimed: MappedValidationIssue[];
  completed: MappedValidationIssue[];
  validation_pending: boolean;
};

/**
 * Read cached validation issues for a page URL from validation-cache.json.
 * Soft-completed → completed; active claims by others → claimed;
 * open work queue → open (includes own claims when viewerAuthor matches).
 */
function getCachedValidationIssues(
  url: string,
  categoryFilter?: string[],
  contentPath?: string,
  viewerAuthor?: string,
): CachedValidationIssuesSplit {
  const empty: CachedValidationIssuesSplit = {
    open: [],
    claimed: [],
    completed: [],
    validation_pending: false,
  };
  const cachePath = contentPath
    ? path.join(contentPath, "validation-cache.json")
    : VALIDATION_CACHE_PATH;
  try {
    if (!fs.existsSync(cachePath)) return empty;
    const raw = fs.readFileSync(cachePath, "utf-8");
    const cache = JSON.parse(raw) as {
      pages?: Record<string, {
        errors: Array<{ type?: string; code: string; message: string; category?: string; file?: string; suggestion?: string; validator?: string }>;
        warnings: Array<{ type?: string; code: string; message: string; category?: string; file?: string; suggestion?: string; validator?: string }>;
      }>;
      issues?: Record<string, {
        code: string;
        severity: string;
        message: string;
        category?: string;
        file?: string;
        suggestion?: string;
        validator?: string;
      }>;
      indexes?: { byUrl?: Record<string, string>; byEntry?: Record<string, string[]> };
      runMeta?: { byEntry?: Record<string, { dirty?: boolean }> };
      completions?: Record<string, { completedBy: string; completedAt: string; actor?: ValidationIssueActorRef; report?: string }>;
      claims?: Record<string, { claimedBy: string; claimedAt: string; expiresAt: string; actor?: ValidationIssueActorRef; report?: string }>;
      attempts?: Record<
        string,
        Array<{
          by: string;
          claimedBy?: string;
          at: string;
          reason: "released" | "ttl_expired" | "complete_rejected_still_open";
          report?: string;
          claimedAt?: string;
          claimReport?: string;
          actor?: ValidationIssueActorRef;
        }>
      >;
    };

    const completions = cache.completions ?? {};
    const claims = cache.claims ?? {};
    const attemptsMap = cache.attempts ?? {};
    const now = Date.now();
    let validation_pending = false;
    let all: MappedValidationIssue[] = [];
    if (cache.issues && cache.indexes) {
      const entryKey = cache.indexes.byUrl?.[url];
      validation_pending = Boolean(entryKey && cache.runMeta?.byEntry?.[entryKey]?.dirty);
      const ids = entryKey ? cache.indexes.byEntry?.[entryKey] ?? [] : [];
      for (const id of ids) {
        const issue = cache.issues[id];
        if (!issue || issue.severity === "info") continue;
        const completion = completions[id];
        const claim = claims[id];
        const claimActive =
          claim && new Date(claim.expiresAt).getTime() > now ? claim : undefined;
        const priorAttempts = attemptsMap[id];
        all.push({
          id,
          code: issue.code,
          message: issue.message,
          severity: issue.severity === "error" ? "error" : "warning",
          category: issue.category ?? "other",
          ...(issue.file ? { file: issue.file } : {}),
          ...(issue.suggestion ? { suggestion: issue.suggestion } : {}),
          ...(completion
            ? {
                completedBy: completion.completedBy,
                completedAt: completion.completedAt,
                ...(completion.actor ? { completedActor: completion.actor } : {}),
                ...(completion.report ? { completedReport: completion.report } : {}),
              }
            : {}),
          ...(claimActive
            ? {
                claimedBy: claimActive.claimedBy,
                claimedAt: claimActive.claimedAt,
                expiresAt: claimActive.expiresAt,
                ...(claimActive.actor ? { claimedActor: claimActive.actor } : {}),
                ...(claimActive.report ? { claimReport: claimActive.report } : {}),
              }
            : {}),
          ...(priorAttempts && priorAttempts.length > 0
            ? { prior_attempts: priorAttempts }
            : {}),
        });
      }
    } else {
      const entry = cache.pages?.[url];
      if (!entry) return empty;
      all = [
        ...(entry.errors ?? []).map(e => ({
          code: e.code,
          message: e.message,
          severity: "error" as const,
          category: e.category ?? "other",
          ...(e.file ? { file: e.file } : {}),
          ...(e.suggestion ? { suggestion: e.suggestion } : {}),
        })),
        ...(entry.warnings ?? []).map(w => ({
          code: w.code,
          message: w.message,
          severity: "warning" as const,
          category: w.category ?? "other",
          ...(w.file ? { file: w.file } : {}),
          ...(w.suggestion ? { suggestion: w.suggestion } : {}),
        })),
      ];
    }

    if (categoryFilter && categoryFilter.length > 0) {
      const catSet = new Set(categoryFilter);
      all = all.filter(i => catSet.has(i.category));
    }

    const open: MappedValidationIssue[] = [];
    const claimed: MappedValidationIssue[] = [];
    const completed: MappedValidationIssue[] = [];
    for (const issue of all) {
      if (issue.completedBy) {
        completed.push(issue);
        continue;
      }
      if (issue.claimedBy && issue.claimedBy !== viewerAuthor) {
        claimed.push(issue);
        continue;
      }
      open.push(issue);
    }
    return { open, claimed, completed, validation_pending };
  } catch {
    return empty;
  }
}

function mcpViewerAuthor(mcpToken?: string): string | undefined {
  if (!mcpToken) return undefined;
  return getTokenUsername(mcpToken) || undefined;
}

/** Author string for content_file_written events (username when known, else "mcp"). */
function mcpWriteAuthor(mcpToken?: string): string {
  return getTokenUsername(mcpToken ?? "") || "mcp";
}

const diagnosticsIssueListParams = {
  issues_limit: z
    .number()
    .optional()
    .describe(
      "Max issues to return in the issues work queue (default 50, max 50). Paginates the issue list only — not job history.",
    ),
  issues_offset: z
    .number()
    .optional()
    .describe(
      "Offset into the ranked issues list (default 0). Use issues_next_offset from a prior response to fetch the next page of issues.",
    ),
  severity: z
    .enum(["error", "warning"])
    .optional()
    .describe("Filter the issues work queue by severity."),
  category: z.string().optional().describe("Filter the issues work queue by a single category (e.g. seo)."),
  codes: z
    .array(z.string())
    .optional()
    .describe("Filter the issues work queue to these issue codes."),
};

type DiagnosticsIssueListArgs = {
  issues_limit?: number;
  issues_offset?: number;
  severity?: "error" | "warning";
  category?: string;
  codes?: string[];
};

async function fetchCacheIssueRowsForQueue(
  domain: string | undefined,
  filters: { severity?: string; category?: string; code?: string },
): Promise<{ rows: ReturnType<typeof cacheIssueRowsToQueueInput>; ok: boolean }> {
  const params = new URLSearchParams();
  if (domain) params.set("__site", domain);
  if (filters.severity) params.set("severity", filters.severity);
  if (filters.category) params.set("category", filters.category);
  if (filters.code) params.set("code", filters.code);
  const qs = params.toString() ? `?${params.toString()}` : "";
  try {
    const res = await fetch(
      `http://localhost:${MAIN_SERVER_PORT}/api/validation/cache-issues${qs}`,
      { headers: internalHeaders() },
    );
    if (!res.ok) return { rows: [], ok: false };
    const data = (await res.json()) as { issues?: unknown[] };
    if (!Array.isArray(data.issues)) return { rows: [], ok: false };
    return {
      rows: cacheIssueRowsToQueueInput(
        data.issues as Parameters<typeof cacheIssueRowsToQueueInput>[0],
      ),
      ok: true,
    };
  } catch {
    return { rows: [], ok: false };
  }
}

function urlsFromIssuesBySlug(issuesBySlug: unknown): string[] {
  if (!issuesBySlug || typeof issuesBySlug !== "object") return [];
  const urls: string[] = [];
  for (const list of Object.values(issuesBySlug as Record<string, unknown>)) {
    if (!Array.isArray(list)) continue;
    for (const issue of list) {
      const u = (issue as { url?: string })?.url;
      if (typeof u === "string" && u) urls.push(u);
    }
  }
  return urls;
}

async function resolveDiagnosticsIssueQueue(opts: {
  domain?: string;
  issueList: DiagnosticsIssueListArgs;
  slugs?: string[];
  categories?: string[];
  /** Prefer these URLs when mid-run partial (intersect with cache rows). */
  partialUrls?: string[];
  /** Fallback when cache-issues fetch fails. */
  issuesBySlugFallback?: unknown;
}): Promise<{
  queue: DiagnosticsIssueQueueResult;
  warnings: McpWarning[];
}> {
  const codeFilter =
    opts.issueList.codes && opts.issueList.codes.length === 1
      ? opts.issueList.codes[0]
      : undefined;
  const categoryFilter =
    opts.issueList.category ??
    (opts.categories?.length === 1 ? opts.categories[0] : undefined);
  const fetched = await fetchCacheIssueRowsForQueue(opts.domain, {
    severity: opts.issueList.severity,
    category: categoryFilter,
    code: codeFilter,
  });

  let rows = fetched.rows;
  const warnings: McpWarning[] = [];

  if (!fetched.ok) {
    rows = flattenIssuesBySlug(
      (opts.issuesBySlugFallback && typeof opts.issuesBySlugFallback === "object"
        ? opts.issuesBySlugFallback
        : {}) as Parameters<typeof flattenIssuesBySlug>[0],
    );
    warnings.push({
      code: "issues_missing_ids",
      message:
        "Could not load validation-cache issue ids (cache-issues). issues[] have no id — use get_entry_seo for claimable ids on a chosen slug.",
    });
  }

  const queueOpts: DiagnosticsIssueQueueOptions = {
    issues_limit: opts.issueList.issues_limit,
    issues_offset: opts.issueList.issues_offset,
    severity: opts.issueList.severity,
    category: opts.issueList.category,
    categories: opts.categories,
    codes: opts.issueList.codes,
    slugs: opts.slugs,
    urls: opts.partialUrls,
  };
  const queue = buildDiagnosticsIssueQueue(rows, queueOpts);
  return { queue, warnings };
}

export function registerPageTools(
  mcp: McpServer,
  _mcpAuthor?: string,
  mcpToken?: string,
  grants?: CatalogGrant[],
): void {
  // list_sites
  mcp.tool(
    "list_sites",
    "List configured site domains and content folders from sites.yml. " +
    "Call this first in multi-site setups, then pass site (domain) on every other tool. " +
    MULTI_SITE_TOOL_BLURB,
    {},
    async () => {
      try {
        const sites = listMcpSites();
        return {
          content: [{
            type: "text",
            text: JSON.stringify({
              count: sites.length,
              sites,
              hint: sites.length > 1
                ? "Pass site with one of these domains on subsequent tool calls."
                : "Only one site configured; site parameter is optional.",
            }, null, 2),
          }],
        };
      } catch (e) {
        return fail((e as Error).message);
      }
    }
  );


  // agent_session — start/note/summarize (pipeline audit events)
  mcp.tool(
    "agent_session",
    "Prefer bootstrap_agent once per MCP run before start (Claude.ai / Grok / any connector). " +
    "Start, note, or summarize an agent content session for staff monitoring on Background Pipeline. " +
    "start returns agent_session_id — pass it on mutating tools. " +
    "note/summarize require agent_session_id + report (min 80 chars). " +
    "summarize closes the run for the staff banner (last summarize wins). " +
    "Reports are staff-readable: for copy you set, list plain values (Title: …); no JSON/YAML dumps. " +
    "After writes, follow conversation conventions from bootstrap_agent (skill.content) for human-facing replies. " +
    "Does not write YAML. Prefer write/issue report for per-change notes; use summarize once at end.",
    {
      action: z.enum(["start", "note", "summarize"]).describe("start | note | summarize"),
      agent_session_id: z
        .string()
        .optional()
        .describe("Required for note/summarize. From start."),
      label: z.string().optional().describe("Optional short label on start (e.g. Fix blog SEO batch)"),
      report: z
        .string()
        .optional()
        .describe(AGENT_REPORT_SESSION_DESC),
      site: z.string().optional().describe(SITE_PARAM_DESC),
      model: z.string().optional().describe("Optional LLM model name for attribution"),
    },
    async ({ action, agent_session_id, label, report, site, model }) => {
      const siteResult = resolveSiteContext(site);
      if (!siteResult.ok) return siteFailResult(siteResult.error);
      const { domain } = siteResult;
      try {
        const url = `http://localhost:${MAIN_SERVER_PORT}/api/admin/agent-sessions/checkpoint${
          domain ? `?__site=${encodeURIComponent(domain)}` : ""
        }`;
        const res = await fetch(url, {
          method: "POST",
          headers: internalHeaders(mcpToken, {
            agentSessionId: agent_session_id,
          }),
          body: JSON.stringify({
            action,
            site: siteResult.contentFolder,
            ...(agent_session_id ? { agent_session_id } : {}),
            ...(label ? { label } : {}),
            ...(report ? { report } : {}),
            ...(model ? { model } : {}),
          }),
        });
        const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
        if (!res.ok) {
          const code = typeof data.code === "string" ? data.code : "agent_session_failed";
          if (code === "session_unknown" || data.action_required === "start") {
            return actionRequired(
              {
                success: false,
                action_required: "start",
                code: "session_unknown",
                message: String(data.error ?? "Unknown agent_session_id — call start first"),
              },
              [
                {
                  tool: "agent_session",
                  reason: "Start a session, then retry note/summarize with the returned agent_session_id.",
                  priority: "required",
                  args_hint: { action: "start" },
                },
              ],
            );
          }
          if (code === "report_required" || code === "report_too_short") {
            return actionRequired(
              {
                success: false,
                action_required: "report_required",
                code,
                message: String(data.error ?? "report required (min 80 characters)"),
              },
              [],
            );
          }
          return fail(String(data.error ?? `agent_session failed (${res.status})`), { code });
        }
        const sid = String(data.agent_session_id ?? agent_session_id ?? "");
        return ok(
          {
            action,
            agent_session_id: sid,
            event_id: data.event_id ?? null,
            message:
              action === "start"
                ? "Session started. Prefer bootstrap_agent once per MCP run before start if you have not already. Pass agent_session_id on mutating tools; call summarize when done. Follow bootstrap conventions (skill.content) for human-facing replies."
                : action === "summarize"
                  ? "Session summarized for staff banner."
                  : "Session note recorded.",
          },
          {
            warnings: [],
            side_effects: [
              {
                kind: "pipeline_event",
                summary: `Emitted agent_session_${action === "start" ? "started" : action === "note" ? "note" : "summarized"}`,
              },
            ],
            next_actions:
              action === "start"
                ? [
                    {
                      tool: "update_fields",
                      reason: "Pass agent_session_id + report on content mutates.",
                      priority: "recommended",
                      args_hint: { agent_session_id: sid },
                    },
                  ]
                : [],
          },
        );
      } catch (e) {
        return fail((e as Error).message);
      }
    },
  );


  // list_entries
  mcp.tool(
    "list_entries",
    "List YAML-driven content entries (any content type that is not database-backed). " +
    "Returns slug, contentType, locales, title, and urls. " +
    "IMPORTANT: Types with database.slug in content-types.yml are NOT listed here. " +
    "Static single_template types (e.g. blog) ARE listed — they are YAML, not DB. " +
    "Use get_content_type_info to see db_backed vs single_template. " +
    MULTI_SITE_TOOL_BLURB + " " +
    "Optional filters (AND): contentType, locale, slugs, search. Requires content_view.",
    {
      contentType: z.string().optional().describe("Restrict to one content type, e.g. 'program', 'blog', or 'landing'"),
      locale: z.string().optional().describe("Only return entries that have this locale available, e.g. 'en' or 'es'"),
      slugs: z.array(z.string()).optional().describe("Restrict to a specific list of slugs"),
      search: z.string().optional().describe("Case-insensitive substring match against slug and title"),
      site: z.string().optional().describe(SITE_PARAM_DESC),
    },
    async ({ contentType, locale, slugs, search, site }) => {
      const viewDenied = await denyUnlessContentView(mcpToken, contentType, grants);
      if (viewDenied) return viewDenied;
      const siteResult = resolveSiteContext(site);
      if (!siteResult.ok) return siteFailResult(siteResult.error, "list_entries", { contentType, locale, slugs, search });
      const { contentPath } = siteResult;
      let pages = scanPages(contentPath);
      const allowedTypes = grants ? visibleContentTypes(grants) : null;
      if (allowedTypes) {
        pages = pages.filter(p => allowedTypes.has(p.contentType));
      }
      if (contentType) {
        pages = pages.filter(p => p.contentType === contentType);
      }
      if (locale) {
        pages = pages.filter(p => p.locales.includes(locale));
      }
      if (slugs && slugs.length > 0) {
        const slugSet = new Set(slugs);
        pages = pages.filter(p => slugSet.has(p.slug));
      }
      if (search) {
        const q = search.toLowerCase();
        pages = pages.filter(p =>
          p.slug.toLowerCase().includes(q) ||
          (p.title ?? "").toLowerCase().includes(q)
        );
      }
      return { content: [{ type: "text", text: JSON.stringify(pages, null, 2) }] };
    }
  );

  mcp.tool(
    "refresh_content_index",
    "Rebuild in-memory URL routing and related caches from disk after content writes. " +
    "Use when a write succeeded on disk but a new URL is still not resolving. " +
    MULTI_SITE_TOOL_BLURB,
    {
      contentType: z.string().optional().describe("Optional content type hint for refresh scope."),
      site: z.string().optional().describe(SITE_PARAM_DESC),
    },
    async ({ contentType, site }) => {
      const siteResult = resolveSiteContext(site);
      if (!siteResult.ok) return siteFailResult(siteResult.error, "refresh_content_index", { contentType });
      const refresh = await callRefreshCacheApi(contentType, siteResult.domain);
      if (!refresh.ok) {
        return fail(`Failed to refresh content index: ${refresh.error || "unknown error"}`);
      }
      return ok({
        success: true,
        message: "Content index refreshed.",
        ...(refresh.knownUrlCount !== undefined ? { known_url_count: refresh.knownUrlCount } : {}),
      });
    },
  );

  // ── Shared resolution helper used by get_entry_content and get_entry_seo ──────

  type PagePayload = {
    contentType: string;
    slug: string;
    locale: string;
    locales: string[];
    urls?: Record<string, string>;
    data: Record<string, unknown>;
  };

  type PagePayloadError = { content: [{ type: "text"; text: string }]; isError: true };

  function resolvePagePayload(slug: string, locale: string, contentType: string | undefined, contentPath: string): PagePayload | PagePayloadError {
    try {
      assertSafeSegment(slug, "slug");
      assertSafeLocale(locale);
      if (contentType) assertSafeSegment(contentType, "contentType");
    } catch (e) {
      return { content: [{ type: "text", text: (e as Error).message }], isError: true };
    }
    const resolved = resolveContentType(slug, contentType, contentPath);
    if (!resolved) {
      return { content: [{ type: "text", text: `Page not found for slug '${slug}'${contentType ? ` (contentType: ${contentType})` : ""}` }], isError: true };
    }
    const result = loadPage(resolved.contentType, slug, locale, contentPath);
    if (!result) {
      return { content: [{ type: "text", text: `Locale '${locale}' not found for page '${slug}' (contentType: ${resolved.contentType})` }], isError: true };
    }

    const pageDir = path.join(contentPath, getDirectory(resolved.contentType, resolved.config), slug);
    const dirFiles = fs.existsSync(pageDir) ? fs.readdirSync(pageDir) : [];
    const locales = dirFiles
      .map((f: string) => f.replace(/\.(yml|yaml)$/, ""))
      .filter((n: string) => /^[a-z]{2}(-[a-z]{2})?$/.test(n));

    const urlPattern = resolved.config.url_pattern;
    let urls: Record<string, string> | undefined;
    if (urlPattern) {
      const localeSlugByLocale: Record<string, string> = {};
      for (const l of locales) {
        for (const ext of ["yml", "yaml"]) {
          const localeFile = path.join(pageDir, `${l}.${ext}`);
          if (!fs.existsSync(localeFile)) continue;
          try {
            const parsed = safeLoad(fs.readFileSync(localeFile, "utf-8"));
            const candidate = parsed?.slug;
            if (typeof candidate === "string" && candidate.trim()) {
              localeSlugByLocale[l] = candidate.trim();
            }
          } catch {
            // Keep folder slug fallback for malformed locale files.
          }
          break;
        }
      }
      const resolvedUrls: Record<string, string> = {};
      if (urlPattern["default"]) {
        for (const l of locales) {
          const localeSlug = localeSlugByLocale[l] || slug;
          resolvedUrls[l] = urlPattern["default"].replace(":slug", localeSlug);
        }
      } else {
        for (const l of locales) {
          if (!urlPattern[l]) continue;
          const localeSlug = localeSlugByLocale[l] || slug;
          resolvedUrls[l] = urlPattern[l].replace(":slug", localeSlug);
        }
      }
      if (Object.keys(resolvedUrls).length > 0) urls = resolvedUrls;
    }

    return { contentType: resolved.contentType, slug, locale, locales, ...(urls ? { urls } : {}), data: result.data as Record<string, unknown> };
  }

  // get_entry_content
  mcp.tool(
    "get_entry_content",
    "Get the merged content of a page (sections, title, and all other top-level YAML keys) without the meta/SEO block. " +
    "Also returns locales (all available locale codes for this page), urls (per-locale resolved paths), and " +
    "validation_issues (open cached validation issues — incomplete and unclaimed, or claimed by you; each with id, code, message, severity, category; may include prior_attempts from earlier releases/TTL). " +
    "claimed_issues (active claims by other authors). " +
    "completed_issues (soft-completed for audit; use update_issue). " +
    "validation_pending (true when an on-save revalidation is still debouncing after a recent write — open lists may lag). " +
    "validation_issues, claimed_issues, and completed_issues are always present (empty arrays if none). " +
    "Merges _common.yml with the locale file. contentType is optional — omit it and the server will auto-detect it from the slug. " +
    "Use get_entry_seo to fetch only the SEO/meta fields. Requires content_view. " +
    "Supply 'variant' to read a draft variant file ({variantSlug}.{locale}.yml) instead of the live locale file.",
    {
      slug: z.string().describe("Page slug (folder name), e.g. 'home' or 'full-stack-developer'"),
      locale: z.string().default("en").describe("Locale code, e.g. 'en' or 'es'"),
      contentType: z.string().optional().describe("Content type hint (e.g. 'page', 'program'). Omit to auto-detect from slug."),
      variant: z.string().optional().describe("Variant slug to read (e.g. 'draft-v2'). When provided, reads {variantSlug}.{locale}.yml instead of the live locale file."),
      site: z.string().optional().describe(SITE_PARAM_DESC),
    },
    async ({ slug, locale, contentType, variant, site }) => {
      const siteResult = resolveSiteContext(site);
      if (!siteResult.ok) return siteFailResult(siteResult.error);
      const { contentPath } = siteResult;
      try {
        assertSafeSegment(slug, "slug");
        assertSafeLocale(locale);
        if (contentType) assertSafeSegment(contentType, "contentType");
        if (variant) assertSafeSegment(variant, "variant");
      } catch (e) {
        return { content: [{ type: "text", text: (e as Error).message }], isError: true };
      }

      if (variant) {
        const resolved = resolveContentType(slug, contentType, contentPath);
        if (!resolved) {
          return { content: [{ type: "text", text: `Page not found for slug '${slug}'${contentType ? ` (contentType: ${contentType})` : ""}` }], isError: true };
        }
        const viewDenied = await denyUnlessContentView(mcpToken, resolved.contentType, grants);
        if (viewDenied) return viewDenied;
        const result = loadVariantPage(resolved.contentType, slug, locale, variant, contentPath);
        if (!result) {
          return { content: [{ type: "text", text: `Variant '${variant}' not found for page '${slug}' locale '${locale}' (file: ${variant}.${locale}.yml)` }], isError: true };
        }
        const { meta: _meta, ...dataWithoutMeta } = result.data;
        const merged = { ...dataWithoutMeta } as Record<string, unknown>;
        applyPurchasableToRecord(merged, resolved.contentType, slug);
        return { content: [{ type: "text", text: JSON.stringify({ contentType: resolved.contentType, slug, locale, variant, ...merged, validation_issues: [], claimed_issues: [], completed_issues: [], validation_pending: false }, null, 2) }] };
      }

      const payload = resolvePagePayload(slug, locale, contentType, contentPath);
      if ("isError" in payload) return payload;
      const viewDeniedLive = await denyUnlessContentView(mcpToken, payload.contentType, grants);
      if (viewDeniedLive) return viewDeniedLive;

      const { meta: _meta, ...dataWithoutMeta } = payload.data;
      const merged = { ...dataWithoutMeta } as Record<string, unknown>;
      applyPurchasableToRecord(merged, payload.contentType, payload.slug);
      const envelope = { contentType: payload.contentType, slug: payload.slug, locale: payload.locale, locales: payload.locales, ...(payload.urls ? { urls: payload.urls } : {}) };

      // Inject cached validation issues (open / claimed-by-others / completed)
      const pageUrl = payload.urls?.[locale];
      const split = pageUrl
        ? getCachedValidationIssues(
            pageUrl,
            undefined,
            contentPath,
            _mcpAuthor || mcpViewerAuthor(mcpToken),
          )
        : { open: [], claimed: [], completed: [], validation_pending: false };

      return { content: [{ type: "text", text: JSON.stringify({ ...envelope, ...merged, validation_issues: split.open, claimed_issues: split.claimed, completed_issues: split.completed, validation_pending: split.validation_pending }, null, 2) }] };
    }
  );

  // get_entry_seo
  mcp.tool(
    "get_entry_seo",
    "Get the SEO/meta block plus structured-data preview for a page, with the identifying envelope (contentType, slug, locale, locales, urls). " +
    "Returns meta, seo (locale seo.main_keyword / pillar_path / is_pillar), include_in_clustering (derived: false only when seo.pillar_path is explicit null), " +
    "index (live seo-index.json topic-cluster inventory row — NOT search-engine indexing; omitted for variants), " +
    "optional search_engines when include_search_engines:true (cached Google Search Console + Bing stub; read-only, does not refresh cache or call live APIs), " +
    "validation_issues (open cached SEO-category issues), " +
    "claimed_issues (SEO issues claimed by others), " +
    "completed_issues (soft-completed SEO issues), and a rich schema_org block: " +
    "resolved JSON-LD documents + sources (same pipeline as SSR section contributors + Organization dual-emit), " +
    "content-type requirements / hero companion gaps. " +
    "Use this to inspect what Google gets — not for editing schema_org YAML (use get_entry_content / section tools). " +
    "Hub inventory: list_seo_clusters / list_seo_cluster_entries / get_seo_cluster. " +
    "Toggle clustering via update_fields seo.include_in_clustering (MCP-only; requires type seo_monitoring.enabled). " +
    "Do not expect a derived JSON-LD dump on get_entry_content. Requires content_view or seo_edit. " +
    "Supply 'variant' to read a draft variant file ({variantSlug}.{locale}.yml) instead of the live locale file. " +
    "Variants skip search_engines (live URLs only); re-call without variant to read engine status.",
    {
      slug: z.string().describe("Page slug (folder name), e.g. 'home' or 'full-stack-developer'"),
      locale: z.string().default("en").describe("Locale code, e.g. 'en' or 'es'"),
      contentType: z.string().optional().describe("Content type hint (e.g. 'page', 'program'). Omit to auto-detect from slug."),
      variant: z.string().optional().describe("Variant slug to read (e.g. 'draft-v2'). When provided, reads {variantSlug}.{locale}.yml instead of the live locale file."),
      include_search_engines: z
        .boolean()
        .optional()
        .default(false)
        .describe(
          "If true (live reads only), attach search_engines.{google,bing} from cached inspection data. " +
            "index remains seo-index cluster inventory. Does not call Google/Bing APIs or refresh the cache. " +
            "Ignored for variants (warning search_engines_skipped_variant).",
        ),
      site: z.string().optional().describe(SITE_PARAM_DESC),
    },
    async ({ slug, locale, contentType, variant, include_search_engines, site }) => {
      const siteResult = resolveSiteContext(site);
      if (!siteResult.ok) return siteFailResult(siteResult.error);
      const { contentPath, contentFolder, domain } = siteResult;
      try {
        assertSafeSegment(slug, "slug");
        assertSafeLocale(locale);
        if (contentType) assertSafeSegment(contentType, "contentType");
        if (variant) assertSafeSegment(variant, "variant");
      } catch (e) {
        return { content: [{ type: "text", text: (e as Error).message }], isError: true };
      }

      async function buildSchemaOrgBlock(
        ct: string,
        pageSlug: string,
        pageLocale: string,
        data: Record<string, unknown>,
      ): Promise<Record<string, unknown>> {
        const { collectSectionSchemasDetailed } = await import("../../server/schema-components/index.js");
        const {
          getSchemaOrgRequirementGaps,
          validateHeroCourseCompanions,
          getContentTypeSchemaOrgRequirements,
        } = await import("../../server/schema-org-requirements.js");
        const { getBaseUrl } = await import("../../server/hreflang.js");
        const sections = Array.isArray(data.sections)
          ? (data.sections as Array<Record<string, unknown>>)
          : [];
        const meta = (data.meta && typeof data.meta === "object" ? data.meta : {}) as Record<string, unknown>;
        const detailed = collectSectionSchemasDetailed(sections, {
          locale: pageLocale,
          contentRoot: contentPath,
          baseUrl: getBaseUrl(),
          contentType: ct,
          pageUrl: undefined,
          title: typeof data.title === "string" ? data.title : typeof data.name === "string" ? data.name : undefined,
          description:
            typeof meta.description === "string"
              ? meta.description
              : typeof data.description === "string"
                ? data.description
                : undefined,
        });
        const ctGaps = getSchemaOrgRequirementGaps(sections, ct, contentPath, { slug: pageSlug });
        const heroGaps = validateHeroCourseCompanions(sections, {
          contentType: ct,
          slug: pageSlug,
          locale: pageLocale,
        });
        const requirements = getContentTypeSchemaOrgRequirements(ct, contentPath);
        return {
          documents: detailed.documents,
          preview: detailed.preview,
          sources: detailed.preview.map((p) => p.source),
          requirements,
          companion_gaps: [...ctGaps, ...heroGaps],
          requirements_ok: ctGaps.length === 0,
          hero_course_companion_ok: heroGaps.length === 0,
        };
      }

      if (variant) {
        const resolved = resolveContentType(slug, contentType, contentPath);
        if (!resolved) {
          return { content: [{ type: "text", text: `Page not found for slug '${slug}'${contentType ? ` (contentType: ${contentType})` : ""}` }], isError: true };
        }
        const seoDenied = await denyUnlessContentViewOrSeo(mcpToken, resolved.contentType, grants);
        if (seoDenied) return seoDenied;
        const result = loadVariantPage(resolved.contentType, slug, locale, variant, contentPath);
        if (!result) {
          return { content: [{ type: "text", text: `Variant '${variant}' not found for page '${slug}' locale '${locale}' (file: ${variant}.${locale}.yml)` }], isError: true };
        }
        const schema_org = await buildSchemaOrgBlock(
          resolved.contentType,
          slug,
          locale,
          result.data as Record<string, unknown>,
        );
        const warnings: Array<{ code: string; message: string }> = [
          {
            code: "variant_seo_not_indexed",
            message: "Variant seo: is not in seo-index.json until promote.",
          },
          {
            code: "variant_updated_at_not_live",
            message: "Variant updated_at does not change live sitemap lastmod until promote.",
          },
        ];
        if (include_search_engines) {
          warnings.push({
            code: "search_engines_skipped_variant",
            message:
              "Search engine status applies to live URLs only; re-call get_entry_seo without variant and include_search_engines:true.",
          });
        }
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(
                {
                  contentType: resolved.contentType,
                  slug,
                  locale,
                  variant,
                  meta: result.data.meta,
                  seo: result.data.seo || {},
                  include_in_clustering: deriveIncludeInClustering(result.data.seo),
                  index: null,
                  schema_org,
                  validation_issues: [],
                  claimed_issues: [],
                  completed_issues: [],
                  ...resolvedUpdatedAtFields(
                    resolved.contentType,
                    slug,
                    locale,
                    contentPath,
                    result.data as Record<string, unknown>,
                  ),
                  warnings,
                },
                null,
                2,
              ),
            },
          ],
        };
      }

      const payload = resolvePagePayload(slug, locale, contentType, contentPath);
      if ("isError" in payload) return payload;
      const seoDeniedLive = await denyUnlessContentViewOrSeo(mcpToken, payload.contentType, grants);
      if (seoDeniedLive) return seoDeniedLive;

      // Inject cached SEO-only validation issues for this page's URL
      const pageUrl = payload.urls?.[locale];
      const split = pageUrl
        ? getCachedValidationIssues(
            pageUrl,
            ["seo"],
            contentPath,
            _mcpAuthor || mcpViewerAuthor(mcpToken),
          )
        : { open: [], claimed: [], completed: [], validation_pending: false };

      const schema_org = await buildSchemaOrgBlock(
        payload.contentType,
        payload.slug,
        payload.locale,
        payload.data,
      );

      const seoPayload: Record<string, unknown> = {
        contentType: payload.contentType,
        slug: payload.slug,
        locale: payload.locale,
        locales: payload.locales,
        ...(payload.urls ? { urls: payload.urls } : {}),
        meta: payload.data.meta,
        seo: payload.data.seo || {},
        include_in_clustering: deriveIncludeInClustering(payload.data.seo),
        index: getSeoIndexEntry(payload.contentType, payload.slug, payload.locale, contentPath) || null,
        schema_org,
        validation_issues: split.open,
        claimed_issues: split.claimed,
        completed_issues: split.completed,
        validation_pending: split.validation_pending,
        ...resolvedUpdatedAtFields(
          payload.contentType,
          payload.slug,
          payload.locale,
          contentPath,
          payload.data,
        ),
      };

      if (include_search_engines) {
        const engines = buildSearchEnginesPagePayload({
          contentRoot: contentPath,
          contentFolder,
          domain,
          requestedUrl: pageUrl,
        });
        seoPayload.search_engines = engines.search_engines;
        seoPayload.warnings = engines.warnings;
      }

      return { content: [{ type: "text", text: JSON.stringify(seoPayload, null, 2) }] };
    }
  );

  // update_issue
  mcp.tool(
    "update_issue",
    "Claim, release, verify-complete, or reopen a validation issue by stable issue_id from get_entry_content / get_entry_seo. " +
    "Actions: claim (30m TTL, refresh if you already own it; fails if another author holds an active claim), " +
    "release (drop your claim or staff release — requires report min 80 when an active claim exists; idempotent no-op if already unclaimed), " +
    "complete (re-validates the entry — or seo-duplicates for DUPLICATE_* — then soft-completes only if the issue_id is gone; " +
    "also lists auto_completed_ids for sibling issues on that entry cleared by the same revalidation; refuses with complete_rejected_still_open + prior_attempts if still failing), " +
    "uncomplete (reopen). " +
    "MCP-only: claim requires report (why you are taking this issue + what you plan to change; min 80 chars; optional when refreshing your own claim). " +
    "complete requires report (what you changed and how; include plain new values for copy you set — not JSON/YAML; min 80 chars). " +
    "release requires report when releasing an active claim (what you tried + why stopping; stored as prior_attempts for the next agent). " +
    "Read prior_attempts on validation_issues before reclaiming. " +
    "Example claim: \"SEO title empty on blog/foo/en — will set meta.page_title from H1 and re-check.\" " +
    AGENT_REPORT_ISSUE_COMPLETE_EXAMPLE + " " +
    "Example release: \"Tried updating meta.page_title; validator still fails because sitemap entry missing — need redirects change.\" " +
    "Does NOT push YAML/GitHub. complete runs entry-local (or seo-duplicates) revalidation before overlay. " +
    "A later validator cache write that rewrites the same id clears complete but keeps an active claim and prior_attempts; may emit validation_issue_reopened in admin events. " +
    "Requires content_edit_text or seo_edit. Pass issue_id only (no update-by-code). Optional model (best-effort, self-reported).",
    {
      issue_id: z.string().describe("Stable issue id from validation_issues[].id"),
      action: z
        .enum(["claim", "release", "complete", "uncomplete"])
        .describe("claim | release | complete | uncomplete"),
      site: z.string().optional().describe(SITE_PARAM_DESC),
      model: z
        .string()
        .optional()
        .describe("Optional LLM model name (best-effort; stored in actor.model on claim/complete/release)"),
      report: z
        .string()
        .optional()
        .describe(AGENT_REPORT_ISSUE_DESC),
      agent_session_id: z
        .string()
        .optional()
        .describe("Optional. From agent_session start — groups claim/complete/release under the same run."),
    },
    async ({ issue_id, action, site, model, report, agent_session_id }) => {
      const canMutate =
        !mcpToken ||
        !grants ||
        hasCapAnyScope(grants, "content_edit_text") ||
        hasCapAnyScope(grants, "seo_edit");
      if (mcpToken && grants && !canMutate) {
        return denyResponse("content_edit_text|seo_edit");
      }
      const siteResult = resolveSiteContext(site);
      if (!siteResult.ok) return siteFailResult(siteResult.error);
      const { domain } = siteResult;

      const trimmedReport = typeof report === "string" ? report.trim() : "";
      if (action === "complete") {
        if (trimmedReport.length < 80) {
          return actionRequired(
            {
              success: false,
              action_required: "report_required",
              code: "report_required",
              message:
                "complete requires report: explain what you changed and how you fixed this issue (min 80 characters). Include plain new values for copy you set.",
            },
            [],
          );
        }
      } else if (action === "release") {
        if (trimmedReport.length > 0 && trimmedReport.length < 80) {
          return actionRequired(
            {
              success: false,
              action_required: "report_required",
              code: "report_too_short",
              message: "release report must be at least 80 characters when provided.",
            },
            [],
          );
        }
      } else if (action === "claim" && trimmedReport.length > 0 && trimmedReport.length < 80) {
        return actionRequired(
          {
            success: false,
            action_required: "report_required",
            code: "report_too_short",
            message: "claim report must be at least 80 characters when provided.",
          },
          [],
        );
      }

      const q = domain ? `?__site=${encodeURIComponent(domain)}` : "";
      try {
        const res = await fetch(
          `http://localhost:${MAIN_SERVER_PORT}/api/validation/cache-issues/update${q}`,
          {
            method: "POST",
            headers: internalHeaders(mcpToken, { agentSessionId: agent_session_id }),
            body: JSON.stringify({
              issueId: issue_id,
              action,
              ...(model ? { model } : {}),
              ...(trimmedReport ? { report: trimmedReport } : {}),
            }),
          },
        );
        const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
        if (!res.ok) {
          const code = typeof data.code === "string" ? data.code : "update_issue_failed";
          if (code === "report_required" || code === "report_too_short") {
            return actionRequired(
              {
                success: false,
                action_required: "report_required",
                code,
                message: String(
                  data.error ??
                    "report required for MCP claim/complete/release (min 80 characters when releasing an active claim)",
                ),
              },
              [],
            );
          }
          return fail(String(data.error ?? `update_issue failed (${res.status})`), {
            code,
            status: res.status,
            claimedBy: data.claimedBy,
          });
        }
        const warnings = [
          {
            code: "overlay_env_local",
            message:
              "Updates this environment's validation-cache claims/completions/attempts only — does not push YAML, sync GitHub, or update other environments.",
          },
          {
            code: "complete_revalidates",
            message:
              "complete re-runs entry-local validators (or seo-duplicates for DUPLICATE_TITLE/DESCRIPTION) before soft-complete. Refuses with complete_rejected_still_open if the issue still reproduces; records prior_attempts. Returns auto_completed_ids for siblings on the same entry cleared by that revalidation.",
          },
          {
            code: "claim_ttl_30m",
            message:
              "Claims expire after 30 minutes (records ttl_expired prior_attempt). Same author can re-claim to refresh.",
          },
          {
            code: "mcp_report_required",
            message:
              "MCP claim (first), complete, and release (active claim) require report (min 80 chars). Release stores prior_attempts for the next agent.",
          },
          {
            code: "actor_client_from_oauth",
            message:
              "actor.client comes from the MCP OAuth client registry (not overridable). actor.model is best-effort when you pass model.",
          },
          {
            code: "validation_issue_events",
            message:
              "claim/complete/release emit validation_issue_* admin events. TTL expiry also emits validation_issue_released.",
          },
        ];
        return ok(
          {
            issue_id,
            action,
            report: trimmedReport || null,
            completed: data.completed ?? null,
            claimed: data.claimed ?? null,
            attempt: data.attempt ?? null,
            auto_completed_ids: data.auto_completed_ids ?? [],
            message: `Issue ${action} applied.`,
          },
          {
            warnings,
            side_effects: [
              {
                kind: "validation_cache_overlay",
                summary: `update_issue ${action} for ${issue_id} in validation-cache.json`,
              },
            ],
            next_actions: [],
          },
        );
      } catch (e) {
        return fail(`Failed to update issue: ${(e as Error).message}`);
      }
    },
  );

  // regenerate_entry_previews
  mcp.tool(
    "regenerate_entry_previews",
    "Queue Cloudflare Browser Run captures for entry-preview / OG images. " +
    "Requires locales (non-empty). Optional slugs scopes to those entries. " +
    "mode: missing (needs capture), all (force dirty+regen), failed (retry failures). " +
    "On success writes WebP under images/entry-previews/ and updates live locale YAML meta.og_image " +
    "(with ?t= cache-bust) unless a distinct gallery/editorial image is set. Variants are never captured. " +
    "Does not commit/push content GitHub by itself (AutoCommitQueue when enabled). " +
    "Cloudflare creds: host env only (CLOUDFLARE_* / ENTRY_PREVIEW_CAPTURE_SECRET; staff SEO/GEO → OG Image is display/test only). " +
    "Does not edit Brand or schema-org.yml. " +
    "Requires content_edit_media.",
    {
      content_type: z.string().describe("Content type with preview: config, e.g. 'blog'"),
      locales: z.array(z.string()).min(1).describe("Required live locales to capture (e.g. ['en','es']). No implicit all/primary."),
      mode: z.enum(["missing", "all", "failed"]).default("missing"),
      slugs: z.array(z.string()).optional().describe("Optional entry slugs to regenerate; omit for all in those locales"),
      site: z.string().optional().describe(SITE_PARAM_DESC),
    },
    async ({ content_type, locales, mode, slugs, site }) => {
      if (mcpToken && !(await checkCap(mcpToken, "content_edit_media"))) {
        return denyResponse("content_edit_media");
      }
      const siteResult = resolveSiteContext(site);
      if (!siteResult.ok) return siteFailResult(siteResult.error);
      const { domain } = siteResult;
      try {
        assertSafeSegment(content_type, "content_type");
        for (const loc of locales) assertSafeLocale(loc);
        if (slugs) for (const s of slugs) assertSafeSegment(s, "slug");
      } catch (e) {
        return fail((e as Error).message);
      }

      const q = domain ? `?__site=${encodeURIComponent(domain)}` : "";
      try {
        const res = await fetch(
          `http://localhost:${MAIN_SERVER_PORT}/api/content-types/${encodeURIComponent(content_type)}/entry-previews/enqueue${q}`,
          {
            method: "POST",
            headers: { ...internalHeaders(mcpToken), "Content-Type": "application/json" },
            body: JSON.stringify({
              locales,
              mode: mode ?? "missing",
              slugs: slugs && slugs.length > 0 ? slugs : undefined,
            }),
          },
        );
        const data = (await res.json()) as Record<string, unknown>;
        if (!res.ok) {
          return fail(String(data.error ?? data.message ?? `enqueue failed (${res.status})`), {
            code: data.code,
            ...data,
          });
        }

        const omitted = Array.isArray(data.omittedLocales)
          ? (data.omittedLocales as string[])
          : [];
        const warnings: McpWarning[] = [];
        if (omitted.length > 0) {
          warnings.push({
            code: "locales_not_regenerated",
            message: `These entry locales exist but were not in locales[] and will not be regenerated: ${omitted.join(", ")}`,
          });
        }
        warnings.push({
          code: "editorial_og_not_overwritten",
          message:
            "Entries with a distinct gallery/editorial meta.og_image or _image keep that URL; YAML is not overwritten.",
        });
        warnings.push({
          code: "no_content_github_push",
          message:
            "YAML meta.og_image is markFileAsModified + AutoCommitQueue when GITHUB_SYNC_ENABLED and GITHUB_AUTO_COMMIT_ENABLED; WebPs are gitignored under images/entry-previews/.",
        });
        warnings.push({
          code: "variants_skipped",
          message: "Draft/variant YAML files are never captured or written.",
        });
        warnings.push({
          code: "creds_env_only",
          message:
            "Capture uses host env CLOUDFLARE_* / ENTRY_PREVIEW_CAPTURE_SECRET (else SESSION_SECRET). This tool does not write those credentials, settings.yml, Brand, or schema-org.yml.",
        });

        const enqueued = Array.isArray(data.enqueued) ? (data.enqueued as string[]) : [];
        return ok(
          {
            content_type,
            mode: mode ?? "missing",
            locales,
            slugs: slugs ?? null,
            enqueued_count: enqueued.length,
            enqueued,
            skipped: data.skipped ?? [],
            omitted_locales: omitted,
            queue: data.queue ?? null,
            message: `Queued ${enqueued.length} entry-preview capture job(s).`,
          },
          {
            warnings,
            side_effects: [
              {
                kind: "queue_entry_preview_capture",
                summary: `Cloudflare Browser Run jobs for ${content_type} (${enqueued.length} keys)`,
              },
              {
                kind: "write_entry_preview_webp",
                summary:
                  "On success: images/entry-previews/{type}/{slug}/{locale}/{width}.webp (+ .meta.json)",
              },
              {
                kind: "write_locale_meta_og_image",
                summary:
                  "On success (non-editorial): live {locale}.yml meta.og_image with ?t= cache-bust",
              },
            ],
            next_actions: [
              {
                tool: "run_entry_diagnostics",
                reason: "After jobs finish, hard-refresh SEO diagnostics to confirm MISSING_OG_IMAGE cleared",
                args_hint: {
                  freshness: "hard",
                  confirm: true,
                  ...(slugs && slugs.length ? { slugs } : {}),
                  categories: ["seo"],
                  ...(site ? { site } : {}),
                },
                priority: "recommended",
              },
            ],
          },
        );
      } catch (e) {
        return fail(`Failed to enqueue entry previews: ${(e as Error).message}`);
      }
    },
  );

  // run_entry_diagnostics (async — returns cached or queues a background job)
  mcp.tool(
    "run_entry_diagnostics",
    "Start or read page diagnostics against the unified validation-cache issue store. Does NOT wait for validators to finish. " +
    "Returns status 'cached' (issues work queue from validation-cache when fresh), 'needs_confirm' (full-site only — re-call with confirm:true), or 'queued'/'running' with job_id. " +
    "On cached: returns issues[] (default 50, errors first, diversified by code) with issues_offset/issues_limit pagination for the issue list only — not a full site dump. " +
    "MCP: categories (e.g. ['seo']) narrow which validators RUN when validators are omitted (staff Diagnostics scope chips are view-only and unchanged). " +
    "content_view/seo_edit may READ cached or needs_confirm responses; only a metrics-mutating staff cap may start a job. " +
    "Slug- or URL-scoped hard/max_age jobs that would start do NOT require confirm:true (escape hatch after edits). Full-site / unscoped jobs still need confirm:true. " +
    "Same-scope reuse of an in-flight job and pure 'cached' responses skip confirm. " +
    "When queued/running: wait retry_after_seconds then call get_diagnostics_job — do NOT re-call this tool to poll. " +
    "freshness 'max_age' (default) recomputes only URLs whose lastFullRunAt is older than max_age_seconds (default 86400); " +
    "'hard' forces a recompute. Optional slugs scopes the run to entry-local validators only (never cross-entry like redirects/seo-duplicates — avoids false all-clear). " +
    "side_effects: job runs in a forked worker process; replace-by-validator merge into validation-cache.json on disk " +
    "(parent reloads cache when the job completes; clears obsolete codes for ran validators in scope). " +
    "Concurrent start while another job holds the site returns busy (no queue). On-save entry-local writes are deferred while the lock is held. " +
    "non_effects: entry/slug runs do not refresh redirects/slug-conflicts/sitemap/seo-duplicates; fixing meta does not clear REDIRECT_CONFLICT or DUPLICATE_TITLE; " +
    "does not change staff Diagnostics HTTP payloads. Mid-run get_diagnostics_job may return a partial issues work queue. Authoritative after completed. " +
    "Empty issues without lastFullRunAt means cache_miss, not clean. After edits prefer freshness 'hard' + slugs (no confirm needed when scoped). " +
    "In-app / MCP content writes debounce entry-local validation for 1 minute; redirect-config changes queue redirects separately. " +
    "When get_entry_* returns validation_pending:true, cache may lag until that debounce settles.",
    {
      slugs: z.array(z.string()).optional().describe("Optional page slugs to scope. Omit for all YAML-backed pages."),
      categories: z
        .array(z.string())
        .optional()
        .describe(
          "MCP: narrows which validators run (e.g. ['seo']) and filters returned issues. Staff UI scope chips do not use this meaning.",
        ),
      freshness: z.enum(["hard", "max_age"]).optional().describe("max_age (default) uses lastFullRunAt; hard always recomputes."),
      max_age_seconds: z.number().optional().describe("TTL for max_age freshness (default 86400). Ignored when freshness is hard."),
      confirm: z.boolean().optional().describe("Required only for full-site / unscoped jobs after needs_confirm. Slug-scoped starts skip confirm. Requires metrics-mutating cap to start any job."),
      site: z.string().optional().describe(SITE_PARAM_DESC),
      ...diagnosticsIssueListParams,
    },
    async ({
      slugs,
      categories,
      freshness,
      max_age_seconds,
      confirm,
      site,
      issues_limit,
      issues_offset,
      severity,
      category,
      codes,
    }) => {
      const issueList: DiagnosticsIssueListArgs = {
        issues_limit,
        issues_offset,
        severity,
        category,
        codes,
      };
      const canReadDiag =
        !mcpToken ||
        !grants ||
        hasCapAnyScope(grants, "content_view") ||
        hasCapAnyScope(grants, "seo_edit") ||
        grantsCanMutateMetrics(grants);
      if (mcpToken && grants && !canReadDiag) {
        return denyResponse("content_view|seo_edit");
      }
      const canStartJob = !mcpToken || !grants || grantsCanMutateMetrics(grants);
      if (confirm === true && !canStartJob) {
        return fail(
          "confirm: true starts a diagnostics job and requires a metrics-mutating staff capability. " +
            "You may call without confirm to read cached issues or receive needs_confirm.",
          {
            code: "diagnostics_trigger_forbidden",
            action_required: "metrics_mutate_to_run_diagnostics",
          },
        );
      }
      const siteResult = resolveSiteContext(site);
      if (!siteResult.ok) return siteFailResult(siteResult.error);
      const { domain } = siteResult;
      const q = domain ? `?__site=${encodeURIComponent(domain)}` : "";
      const validators = mcpValidatorsFromCategories(categories);
      const requestBody = {
        slugs: slugs && slugs.length > 0 ? slugs : undefined,
        categories,
        ...(validators ? { validators } : {}),
        freshness: freshness ?? "max_age",
        max_age_seconds: max_age_seconds ?? 86400,
        ...(confirm === true ? { confirm: true } : {}),
      };
      const retryArgsHint = {
        ...(slugs && slugs.length ? { slugs } : {}),
        ...(categories ? { categories } : {}),
        freshness: freshness ?? "max_age",
        ...(max_age_seconds != null ? { max_age_seconds } : {}),
        confirm: true,
        ...(site ? { site } : {}),
        ...(issues_limit != null ? { issues_limit } : {}),
        ...(issues_offset != null ? { issues_offset } : {}),
        ...(severity ? { severity } : {}),
        ...(category ? { category } : {}),
        ...(codes?.length ? { codes } : {}),
      };
      try {
        const res = await fetch(
          `http://localhost:${MAIN_SERVER_PORT}/api/validation/diagnostics-jobs${q}`,
          {
            method: "POST",
            headers: internalHeaders(),
            body: JSON.stringify(requestBody),
          },
        );
        const data = await res.json() as Record<string, unknown>;

        if (res.status === 409 || data.status === "busy") {
          const jobId = String(data.job_id ?? "");
          const retry = Number(data.retry_after_seconds ?? 5);
          return ok(
            {
              status: "busy",
              code: "diagnostics_busy",
              job_id: jobId,
              retry_after_seconds: retry,
              message: String(data.message ?? "Another diagnostics job is running for this site."),
            },
            {
              warnings: [{
                code: "diagnostics_busy",
                message: "A different diagnostics job is already running. Poll that job_id or wait retry_after_seconds then retry.",
              }],
              next_actions: jobId
                ? [{
                    tool: "get_diagnostics_job",
                    reason: "Poll the in-flight job until completed",
                    args_hint: { job_id: jobId, ...(site ? { site } : {}) },
                    priority: "required",
                  }]
                : [],
            },
          );
        }

        if (!res.ok) {
          return fail(String(data.message ?? data.error ?? `diagnostics-jobs failed (${res.status})`), data);
        }

        if (data.status === "needs_confirm") {
          const confirmNext = canStartJob
            ? [{
                tool: "run_entry_diagnostics" as const,
                reason: "Retry with confirm: true after reviewing last full site-wide duration",
                args_hint: retryArgsHint,
                priority: "required" as const,
              }]
            : [{
                tool: "get_entry_seo" as const,
                reason: "Read cached SEO validation_issues without starting a job (metrics mutate required to confirm)",
                args_hint: {
                  ...(slugs?.[0] ? { slug: slugs[0] } : {}),
                  ...(site ? { site } : {}),
                },
                priority: "recommended" as const,
              }];
          return actionRequired(
            {
              success: false,
              action_required: "confirm_run_diagnostics",
              code: "confirm_run_diagnostics",
              message: canStartJob
                ? String(data.message ?? "Set confirm: true to start diagnostics.")
                : String(
                    data.message ??
                      "Diagnostics cache is stale or missing. A metrics-mutating role must re-call with confirm: true to start a job.",
                  ),
              scoped: data.scoped === true,
              last_site_wide_run_at: data.last_site_wide_run_at ?? null,
              last_site_wide_run_ago: data.last_site_wide_run_ago ?? "never",
              last_site_wide_duration_ms: data.last_site_wide_duration_ms ?? null,
              last_site_wide_duration_human: data.last_site_wide_duration_human ?? null,
              last_site_wide_url_count: data.last_site_wide_url_count ?? null,
              can_start_job: canStartJob,
              ...(canStartJob
                ? {}
                : {
                    warnings: [{
                      code: "diagnostics_trigger_forbidden",
                      message:
                        "You can read diagnostics cache but cannot start a job. Ask a metrics-capable user/agent to run with confirm: true.",
                    }],
                  }),
            },
            confirmNext,
          );
        }

        if (data.status === "cached") {
          const cacheMisses = Array.isArray(data.cacheMisses) ? data.cacheMisses as string[] : [];
          const { queue, warnings: queueWarnings } = await resolveDiagnosticsIssueQueue({
            domain,
            issueList,
            slugs: slugs && slugs.length ? slugs : undefined,
            categories,
            issuesBySlugFallback: data.issuesBySlug,
          });
          const pageNext = diagnosticsIssuePageNextAction({
            tool: "run_entry_diagnostics",
            args_hint: {
              ...(slugs && slugs.length ? { slugs } : {}),
              ...(categories ? { categories } : {}),
              freshness: freshness ?? "max_age",
              ...(max_age_seconds != null ? { max_age_seconds } : {}),
              ...(site ? { site } : {}),
              ...(issues_limit != null ? { issues_limit } : {}),
              ...(severity ? { severity } : {}),
              ...(category ? { category } : {}),
              ...(codes?.length ? { codes } : {}),
            },
            issues_next_offset: queue.issues_next_offset,
          });
          const next_actions: NextAction[] = pageNext ? [pageNext] : [];
          if (queueWarnings.some((w) => w.code === "issues_missing_ids") && queue.issues[0]?.slug) {
            next_actions.push({
              tool: "get_entry_seo",
              reason: "Load claimable validation_issues[].id for a chosen slug",
              args_hint: { slug: queue.issues[0].slug, ...(site ? { site } : {}) },
              priority: "recommended",
            });
          }
          if (queue.issues_truncated) {
            queueWarnings.push({
              code: "issues_truncated",
              message:
                "issues[] is a ranked page of the work queue (default 50). Use issues_offset/issues_next_offset to page the issue list; full set remains in validation-cache / staff Diagnostics.",
            });
          }
          return ok(
            {
              status: "cached",
              ...diagnosticsIssueQueueFields(queue),
              lastFullRunAtBySlug: data.lastFullRunAtBySlug ?? {},
              cache_misses: cacheMisses,
              message: cacheMisses.length
                ? "Returned cache work queue; some slugs have no lastFullRunAt (cache_miss — not necessarily clean)."
                : "Returned fresh-enough cached diagnostics work queue (lastFullRunAt within max_age).",
            },
            { warnings: queueWarnings, next_actions },
          );
        }

        const jobId = String(data.job_id ?? "");
        const retry = Number(data.retry_after_seconds ?? 5);
        const reused = data.reused === true;
        return ok(
          {
            status: data.status ?? "queued",
            job_id: jobId,
            retry_after_seconds: retry,
            scope: data.scope,
            message: "Diagnostics started in the background. Do not wait on this call for results.",
          },
          {
            warnings: [
              {
                code: "diagnostics_async",
                message: "This call did not return validation issues. Poll get_diagnostics_job after retry_after_seconds.",
              },
              ...(reused
                ? [{
                    code: "diagnostics_job_reused",
                    message: "Returned an existing in-flight job with the same scope (exact dedupe).",
                  }]
                : []),
            ],
            side_effects: [{
              kind: "diagnostics_job",
              summary: `Background job ${jobId} will write validation-cache.json when completed.`,
            }],
            next_actions: [{
              tool: "get_diagnostics_job",
              reason: "Poll until status is completed or failed",
              args_hint: {
                job_id: jobId,
                ...(site ? { site } : {}),
                ...(issues_limit != null ? { issues_limit } : {}),
                ...(severity ? { severity } : {}),
                ...(category ? { category } : {}),
                ...(codes?.length ? { codes } : {}),
              },
              priority: "required",
            }],
          },
        );
      } catch (e) {
        return fail(`Failed to start diagnostics: ${(e as Error).message}`);
      }
    }
  );

  mcp.tool(
    "get_diagnostics_job",
    "Poll an async diagnostics job started by run_entry_diagnostics. " +
    "If status is queued/running: wait retry_after_seconds then call this tool again with the same job_id. " +
    "While running, may return a partial issues work queue (only URLs flushed since job started). " +
    "Do not call run_entry_diagnostics to poll. Terminal: completed (issues[] work queue + cache_updated after worker finishes), failed, or not_found. " +
    "issues[] defaults to 50 (errors first, diversified by code); use issues_offset/issues_limit to page the issue list only. " +
    "Does not return a full site issuesBySlug dump — staff Diagnostics / validation-cache still have the full set. " +
    "Disk validation-cache is authoritative after completed. Requires a mutating staff cap (not metrics_view/content_view only).",
    {
      job_id: z.string().describe("Job id from run_entry_diagnostics"),
      site: z.string().optional().describe(SITE_PARAM_DESC),
      ...diagnosticsIssueListParams,
    },
    async ({ job_id, site, issues_limit, issues_offset, severity, category, codes }) => {
      const issueList: DiagnosticsIssueListArgs = {
        issues_limit,
        issues_offset,
        severity,
        category,
        codes,
      };
      if (mcpToken && grants && !grantsCanMutateMetrics(grants)) {
        return denyResponse("metrics_mutate");
      }
      const siteResult = resolveSiteContext(site);
      if (!siteResult.ok) return siteFailResult(siteResult.error);
      const { domain } = siteResult;
      const q = domain ? `?__site=${encodeURIComponent(domain)}` : "";
      const issueArgsHint = {
        job_id,
        ...(site ? { site } : {}),
        ...(issues_limit != null ? { issues_limit } : {}),
        ...(severity ? { severity } : {}),
        ...(category ? { category } : {}),
        ...(codes?.length ? { codes } : {}),
      };
      try {
        const res = await fetch(
          `http://localhost:${MAIN_SERVER_PORT}/api/validation/diagnostics-jobs/${encodeURIComponent(job_id)}${q}`,
          { headers: internalHeaders() },
        );
        const data = await res.json() as Record<string, unknown>;

        if (res.status === 404 || data.status === "not_found") {
          return ok(
            {
              status: "not_found",
              code: "diagnostics_job_lost",
              job_id,
              message: String(data.message ?? "Job lost or expired."),
            },
            {
              warnings: [{
                code: "diagnostics_job_lost",
                message: "Job expired, evicted, or lost on restart. Call run_entry_diagnostics again — do not keep polling this job_id.",
              }],
              next_actions: [{
                tool: "run_entry_diagnostics",
                reason: "Start a new diagnostics job",
                args_hint: { freshness: "hard", confirm: true, ...(site ? { site } : {}) },
                priority: "recommended",
              }],
            },
          );
        }

        if (!res.ok) {
          return fail(String(data.message ?? data.error ?? `get job failed (${res.status})`), data);
        }

        const status = String(data.status ?? "");
        const scope = data.scope as { slugs?: string[] } | undefined;
        const scopeSlugs = Array.isArray(scope?.slugs) && scope!.slugs!.length > 0
          ? scope!.slugs
          : undefined;

        if (status === "queued" || status === "running") {
          const retry = Number(data.retry_after_seconds ?? 5);
          const issuesBySlug = data.issuesBySlug ?? {};
          const hasPartial =
            data.partial === true ||
            (issuesBySlug && typeof issuesBySlug === "object" && Object.keys(issuesBySlug as object).length > 0);
          const partialUrls = hasPartial ? urlsFromIssuesBySlug(issuesBySlug) : [];
          const { queue, warnings: queueWarnings } = await resolveDiagnosticsIssueQueue({
            domain,
            issueList,
            slugs: scopeSlugs,
            partialUrls: partialUrls.length > 0 ? partialUrls : undefined,
            issuesBySlugFallback: issuesBySlug,
          });
          const next_actions: NextAction[] = [{
            tool: "get_diagnostics_job",
            reason: "Continue polling",
            args_hint: { ...issueArgsHint, ...(issues_offset != null ? { issues_offset } : {}) },
            priority: "required",
          }];
          const pageNext = diagnosticsIssuePageNextAction({
            tool: "get_diagnostics_job",
            args_hint: issueArgsHint,
            issues_next_offset: queue.issues_next_offset,
          });
          if (pageNext) next_actions.push(pageNext);
          return ok(
            {
              status,
              job_id,
              processed: data.processed,
              total: data.total,
              retry_after_seconds: retry,
              scope: data.scope,
              ...diagnosticsIssueQueueFields(queue),
              partial: data.partial === true,
              message: data.message,
            },
            {
              warnings: [
                {
                  code: "diagnostics_async",
                  message: "Job still running. Wait retry_after_seconds then call get_diagnostics_job again.",
                },
                ...(hasPartial
                  ? [{
                      code: "partial_results_job_still_running",
                      message:
                        "issues work queue only includes URLs flushed since this job started. Unvisited URLs are omitted until completed.",
                    }]
                  : []),
                ...queueWarnings,
              ],
              next_actions,
            },
          );
        }

        if (status === "failed") {
          return ok(
            {
              status: "failed",
              job_id,
              error: data.error,
              message: String(data.error ?? "Diagnostics job failed"),
            },
            {
              warnings: [{ code: "diagnostics_failed", message: String(data.error ?? "Job failed") }],
              next_actions: [{
                tool: "run_entry_diagnostics",
                reason: "Start a new diagnostics job after failure",
                args_hint: { freshness: "hard", confirm: true, ...(site ? { site } : {}) },
                priority: "optional",
              }],
            },
          );
        }

        const { queue, warnings: queueWarnings } = await resolveDiagnosticsIssueQueue({
          domain,
          issueList,
          slugs: scopeSlugs,
          issuesBySlugFallback: data.issuesBySlug,
        });
        const next_actions: NextAction[] = [];
        const pageNext = diagnosticsIssuePageNextAction({
          tool: "get_diagnostics_job",
          args_hint: issueArgsHint,
          issues_next_offset: queue.issues_next_offset,
        });
        if (pageNext) next_actions.push(pageNext);
        if (queueWarnings.some((w) => w.code === "issues_missing_ids") && queue.issues[0]?.slug) {
          next_actions.push({
            tool: "get_entry_seo",
            reason: "Load claimable validation_issues[].id for a chosen slug",
            args_hint: { slug: queue.issues[0].slug, ...(site ? { site } : {}) },
            priority: "recommended",
          });
        }
        if (queue.issues_truncated) {
          queueWarnings.push({
            code: "issues_truncated",
            message:
              "issues[] is a ranked page of the work queue (default 50). Use issues_offset/issues_next_offset to page the issue list; full set remains in validation-cache / staff Diagnostics.",
          });
        }
        return ok(
          {
            status: "completed",
            job_id,
            cache_updated: data.cache_updated === true,
            ...diagnosticsIssueQueueFields(queue),
            summary: data.summary,
            scope: data.scope,
          },
          { warnings: queueWarnings, next_actions },
        );
      } catch (e) {
        return fail(`Failed to get diagnostics job: ${(e as Error).message}`);
      }
    }
  );

  // ── Shared helpers for the new split tools ──────────────────────────────────

  // Safe top-level paths are resolved per content-type via safeTopLevelFieldsForConfig (editor.type).

  const META_COMMON_FIELDS = new Set(["robots", "priority", "change_frequency"]);
  const META_LOCALE_FIELDS = new Set([
    "page_title", "description", "og_image", "og_type",
    "og_url", "og_locale", "canonical_url",
  ]);
  const ALL_KNOWN_META_FIELDS = new Set([...META_COMMON_FIELDS, ...META_LOCALE_FIELDS]);

  const layoutTargetSchema = z
    .enum(["auto", "entry", "type_single", "type_template"])
    .optional()
    .default("auto")
    .describe(LAYOUT_TARGET_DESC);
  const confirmLayoutTargetSchema = z
    .boolean()
    .optional()
    .describe('Set true after choosing layout_target "entry" or "type_template" when confirm_layout_target was required.');

  function bindingPropagateSideEffects(boundUpdates: unknown): McpSideEffect[] | undefined {
    if (!Array.isArray(boundUpdates) || boundUpdates.length === 0) return undefined;
    return [{
      kind: "binding_propagate",
      summary: `Server propagated bound section updates to ${boundUpdates.length} sibling file(s): ${boundUpdates.join(", ")}`,
    }];
  }

  // update_fields — single entry; meta + body + at most one section index
  mcp.tool(
    "update_fields",
    "The only single-entry field write tool. Apply one or more field updates to one page/locale. " +
    "Each updates[] item is set-mode (value) or reset-mode (reset:true, no value/meta_target). " +
    "reset:true clears the override via the field-reset API (inherit lower layer). " +
    "updates length 1 = single-field edit. May mix meta.*, safe top-level body fields, and fields under ONE sections.N.* index. " +
    "Rejects two or more distinct section indexes (split into separate calls so bindings can propagate). " +
    "sections.N.* patches an existing slot only — missing index fails (reload, or edit template.{locale}.yml with layout_target type_template). Does not create overlay patches or grow sections[]. " +
    "field_path routing: sections.* and safe top-level → locale; seo.main_keyword|seo.pillar_path|seo.is_pillar → locale seo: (never _common.yml, no meta_target); " +
    "seo.include_in_clustering (MCP-only boolean, never YAML) expands to pillar_path/is_pillar — requires content-type seo_monitoring.enabled; " +
    "on=true needs non-empty seo.pillar_path or seo.is_pillar:true after merge; on=false → pillar_path:null + is_pillar:false; " +
    "raw seo.pillar_path:null still opts out (warns). meta.robots/priority/change_frequency → _common.yml; " +
    "other known meta.* → locale; unknown meta.* requires meta_target locale|common.\n\n" +
    "Live gate: live writes need meta.page_title + meta.description; editor.required cannot be cleared on live. Drafts exempt.\n" +
    "CIRCULAR TRAP: if both meta.description and body description are empty, set BOTH in this one updates[] call.\n\n" +
    "For identical meta across many slugs use update_meta_fields instead. Not for section topology (add/remove/reorder).\n" +
    "updated_at: title / meta.page_title / meta.description / section copy or images stamp now on the layer file; seo.* / robots / redirects / og_image do not; variants do not move live lastmod until promote.\n\n" +
    MULTI_SITE_TOOL_BLURB + "\n\n" +
    "IMPORTANT — versioning: ask before live edit when versioning.yml exists; pass confirm_live_edit: true or variant.",
    {
      slug: z.string().describe("Page slug"),
      locale: z.string().default("en").describe("Locale code, e.g. 'en' or 'es'"),
      updates: z.array(z.object({
        field_path: z.string().describe(
          "Dot path: sections.0.title, meta.description, seo.main_keyword, seo.include_in_clustering, title, …",
        ),
        value: z.unknown().optional().describe("New value (required unless reset:true)"),
        reset: z.boolean().optional().describe(
          "When true, clear this field (inherit lower layer). Do not send value or meta_target on this item.",
        ),
        meta_target: z.enum(["locale", "common"]).optional().describe(
          "Required for unknown meta.* keys. Known meta auto-routes.",
        ),
      })).min(1).describe("Field updates (min 1). At most one distinct sections.N index. Each item is set (value) or reset (reset:true)."),
      contentType: z.string().optional().describe("Content type hint. Omit to auto-detect."),
      variant: z.string().optional().describe("Variant slug to write locale fields to."),
      confirm_live_edit: z.boolean().optional().describe("Confirm live overwrite when versioning.yml exists and variant is omitted."),
      layout_target: layoutTargetSchema,
      confirm_layout_target: confirmLayoutTargetSchema,
      confirm_new_values: z.boolean().optional().describe(
        "Set true after principal approval when setting category (or other URL param) to a slug not yet used by peers of this locale.",
      ),
      create_redirect: z.boolean().optional().describe(
        "When renaming live slug (field_path slug): required if published_at is >= 24h ago. Adds old URL to meta.redirects.",
      ),
      report: z
        .string()
        .describe(AGENT_REPORT_MUTATE_DESC),
      agent_session_id: z
        .string()
        .optional()
        .describe("Optional. From agent_session start — groups this write for staff monitoring."),
      site: z.string().optional().describe(SITE_PARAM_DESC),
    },
    async ({ slug, locale, updates: inputUpdates, contentType, variant, confirm_live_edit, layout_target, confirm_layout_target, confirm_new_values, create_redirect, report, agent_session_id, site }) => {
      const siteResult = resolveSiteContext(site);
      if (!siteResult.ok) return siteFailResult(siteResult.error);
      const { contentPath, contentFolder, domain } = siteResult;
      const trimmedReport = typeof report === "string" ? report.trim() : "";
      if (trimmedReport.length < 80) {
        return actionRequired(
          {
            success: false,
            action_required: "report_required",
            code: trimmedReport ? "report_too_short" : "report_required",
            message:
              "report required (min 80 characters): explain what you are changing and why. " +
              "For copy you set, list plain values (Title: …); do not paste JSON/YAML.",
          },
          [],
        );
      }
      try {
        assertSafeSegment(slug, "slug");
        assertSafeLocale(locale);
        if (contentType) assertSafeSegment(contentType, "contentType");
        if (variant) assertSafeSegment(variant, "variant");
      } catch (e) {
        return fail((e as Error).message);
      }

      let updates = inputUpdates;
      const clusterToggleWarnings: McpWarning[] = [];

      const pathCounts = new Map<string, number>();
      for (const u of updates) {
        pathCounts.set(u.field_path, (pathCounts.get(u.field_path) || 0) + 1);
      }
      const dupPaths = [...pathCounts.entries()].filter(([, n]) => n > 1).map(([p]) => p);
      if (dupPaths.length > 0) {
        return fail(`Duplicate field_path(s) in updates[]: ${dupPaths.join(", ")}`);
      }

      const sectionIndexes = new Set<number>();
      for (const u of updates) {
        const m = u.field_path.match(/^sections\.(\d+)(?:\.|$)/);
        if (m) sectionIndexes.add(parseInt(m[1], 10));
      }
      if (sectionIndexes.size > 1) {
        const indexes = [...sectionIndexes].sort((a, b) => a - b);
        return actionRequired(
          {
            success: false,
            action_required: "split_section_updates",
            message:
              `updates[] touches multiple section indexes [${indexes.join(", ")}]. ` +
              `Call update_fields once per section so live binding propagate can run.`,
            section_indexes: indexes,
          },
          indexes.map((idx) => ({
            tool: "update_fields",
            priority: "required" as const,
            reason: `Apply fields for sections.${idx} only (plus any meta/body in that same call).`,
            args_hint: {
              slug,
              locale,
              contentType,
              confirm_live_edit: true,
              updates: updates.filter((u) => {
                const m = u.field_path.match(/^sections\.(\d+)(?:\.|$)/);
                return !m || parseInt(m[1], 10) === idx;
              }),
            },
          })),
        );
      }

      const resolved = resolveContentType(slug, contentType, contentPath, { allowSharedLayout: true });
      if (!resolved) {
        return fail(`Page not found for slug '${slug}'${contentType ? ` (contentType: ${contentType})` : ""}`);
      }

      const urlParams = listExtraUrlPatternParams(resolved.config.url_pattern);
      for (const param of urlParams) {
        const paramUpdate = updates.find((u) => u.field_path === param);
        if (!paramUpdate) continue;
        const paramValue = extractParamSlug(paramUpdate.value);
        if (!paramValue) continue;
        const peerGate = validateUrlParamPeerValues(
          contentPath,
          resolved.contentType,
          resolved.config,
          { [locale]: { [param]: paramValue } },
          confirm_new_values,
        );
        if (peerGate) {
          return actionRequired(
            {
              success: false,
              action_required: "confirm_new_url_param_value",
              code: "confirm_new_url_param_value",
              message:
                `New value '${paramValue}' for URL param '${param}' (${locale}) is not used by any ${locale} peer. ` +
                `Observed: [${peerGate.observed_values.slice(0, 40).join(", ")}]. ` +
                "Get principal approval, then retry with confirm_new_values: true or pick an observed slug.",
              ...peerGate,
              contentType: resolved.contentType,
              slug,
            },
            [
              {
                tool: "update_fields",
                reason: "Retry with confirm_new_values: true or an observed URL param value",
                args_hint: { slug, locale, contentType: resolved.contentType, updates: inputUpdates, confirm_new_values: true, site },
                priority: "required",
              },
              {
                tool: "get_content_type_info",
                reason: `Inspect observed_values_by_locale.${param}`,
                args_hint: { contentType: resolved.contentType, site },
                priority: "recommended",
              },
            ],
          );
        }
      }

      const safeTop = safeTopLevelFieldsForConfig(resolved.config);
      const isSeoPath = (p: string) =>
        isKnownSeoFieldPath(p) ||
        p === `${SEO_YAML_KEY}.pillar` ||
        isSeoIncludeInClusteringPath(p);
      for (const u of updates) {
        const p = u.field_path;
        if (p.startsWith("sections.") || p.startsWith("meta.") || isSeoPath(p) || safeTop.has(p)) continue;
        return fail(
          `Disallowed field_path '${p}'. Must start with 'sections.', 'meta.', 'seo.main_keyword|seo.pillar_path|seo.is_pillar|seo.include_in_clustering', or be one of: ${[...safeTop].join(", ")}.`,
        );
      }
      for (const u of updates) {
        if (isSeoPath(u.field_path) && u.meta_target) {
          return fail("seo.* always writes the locale file; do not pass meta_target.");
        }
        if (!u.field_path.startsWith("meta.") || u.reset === true) continue;
        const key = u.field_path.slice(5).split(".")[0];
        if (!ALL_KNOWN_META_FIELDS.has(key) && !u.meta_target) {
          return fail(`Unknown meta field '${key}' requires meta_target: "locale" | "common"`);
        }
      }

      for (const u of updates) {
        if (u.reset === true) {
          if (u.value !== undefined || u.meta_target !== undefined) {
            return fail(
              `Reset item for '${u.field_path}' must not include value or meta_target (reset:true clears the field).`,
            );
          }
        } else if (u.value === undefined) {
          return fail(`value is required for '${u.field_path}' unless reset:true`);
        }
      }

      const resetUpdates = updates.filter((u) => u.reset === true);
      const setUpdates = updates.filter((u) => u.reset !== true);

      const liveSlugUpdate = !variant
        ? setUpdates.find((u) => u.field_path === "slug" && typeof u.value === "string")
        : undefined;
      if (mcpToken) {
        const allForCap = updates; // both reset and set
        const needsSeo = allForCap.some((u) => u.field_path.startsWith("meta.") || isSeoPath(u.field_path));
        const needsContent = allForCap.some((u) => !u.field_path.startsWith("meta.") && !isSeoPath(u.field_path));
        if (needsSeo && !(await checkCap(mcpToken, "seo_edit", resolved.contentType))) {
          return denyResponse("seo_edit", resolved.contentType);
        }
        if (needsContent && !(await checkCap(mcpToken, "content_edit_text", resolved.contentType))) {
          return denyResponse("content_edit_text", resolved.contentType);
        }
        if (liveSlugUpdate && !(await checkCap(mcpToken, "content_edit_structure", resolved.contentType))) {
          return denyResponse("content_edit_structure", resolved.contentType);
        }
      }

      const liveGate = confirmLiveEditGate({
        tool: "update_fields",
        slug,
        contentType: resolved.contentType,
        locale,
        contentPath,
        variant,
        confirm_live_edit,
        extraArgsHint: { updates: inputUpdates, layout_target, confirm_layout_target },
      });
      if (liveGate) return liveGate;

      if (resetUpdates.length > 0) {
        const ct = resolved.contentType;
        const q = domain ? `?__site=${encodeURIComponent(domain)}` : "";
        const resetResults: Array<{
          field_path: string;
          noop: boolean;
          path?: string;
          storage?: string;
        }> = [];
        for (const u of resetUpdates) {
          try {
            const url = `http://localhost:${MAIN_SERVER_PORT}/api/content-types/${encodeURIComponent(ct)}/field-reset/${encodeURIComponent(slug)}${q}`;
            const res = await fetch(url, {
              method: "POST",
              headers: internalHeaders(mcpToken),
              body: JSON.stringify({ field: u.field_path, locale, variant: variant || undefined }),
            });
            const data = await res.json() as {
              error?: string;
              noop?: boolean;
              path?: string;
              storage?: string;
            };
            if (!res.ok) {
              return fail(data.error || `field-reset failed for '${u.field_path}': ${res.status}`);
            }
            resetResults.push({
              field_path: u.field_path,
              noop: !!data.noop,
              ...(data.path ? { path: data.path } : {}),
              ...(data.storage ? { storage: data.storage } : {}),
            });
          } catch (e) {
            return fail(`field-reset failed for '${u.field_path}': ${(e as Error).message}`);
          }
        }

        if (setUpdates.length === 0) {
          const hasSeo = resetUpdates.some(
            (u) => u.field_path.startsWith("meta.") || isSeoPath(u.field_path),
          );
          const hasContent = resetUpdates.some(
            (u) => !u.field_path.startsWith("meta.") && !isSeoPath(u.field_path),
          );
          const next_actions: NextAction[] = [];
          if (hasContent) {
            next_actions.push({
              tool: "get_entry_fields",
              reason: "Confirm provenance after reset",
              args_hint: {
                slug,
                contentType: ct,
                locale,
                ...(variant ? { variant } : {}),
                ...(site ? { site } : {}),
              },
              priority: "recommended",
            });
          }
          if (hasSeo) {
            next_actions.push({
              tool: "get_entry_seo",
              reason: "Confirm SEO/meta after reset",
              args_hint: {
                slug,
                contentType: ct,
                locale,
                ...(variant ? { variant } : {}),
                ...(site ? { site } : {}),
              },
              priority: "recommended",
            });
          }
          return ok(
            {
              message: `Reset ${resetResults.length} field(s) on ${ct}/${slug}`,
              resets: resetResults,
            },
            { warnings: [], next_actions },
          );
        }

        updates = setUpdates;
      }

      const touchesSections = updates.some((u) => u.field_path.startsWith("sections."));
      const layoutGate = resolveLayoutTargetGate({
        tool: "update_fields",
        contentType: resolved.contentType,
        config: resolved.config,
        slug,
        locale,
        layout_target: layout_target as LayoutTarget | undefined,
        confirm_layout_target,
        requireConfirmWhenAuto: touchesSections,
      });
      if ("gate" in layoutGate) return layoutGate.gate;
      const layoutTarget = layoutGate.target;

      const pathInfo = pathForLayoutTarget({
        contentPath,
        contentType: resolved.contentType,
        config: resolved.config,
        slug,
        locale,
        layoutTarget,
        variant,
      });
      try { assertWithinBase(pathInfo.filePath, contentPath); } catch (e) {
        return fail((e as Error).message);
      }

      const currentDoc = fs.existsSync(pathInfo.filePath)
        ? safeLoad(fs.readFileSync(pathInfo.filePath, "utf-8")) || {}
        : {};
      const currentSeo =
        currentDoc.seo && typeof currentDoc.seo === "object" && !Array.isArray(currentDoc.seo)
          ? (currentDoc.seo as SeoBlock)
          : {};

      const expanded = expandSeoClusterToggle({
        contentType: resolved.contentType,
        contentRoot: contentPath,
        updates: updates.map((u) => ({
          field_path: u.field_path,
          value: u.value as unknown,
          ...(u.meta_target ? { meta_target: u.meta_target } : {}),
        })),
        currentSeo,
        slug,
        locale,
        site,
        variant,
      });
      if (!expanded.ok) {
        if (expanded.kind === "action_required") {
          return actionRequired(
            {
              success: false,
              action_required: expanded.action_required,
              code: expanded.code,
              message: expanded.message,
              ...(expanded.details ?? {}),
            },
            expanded.next_actions,
          );
        }
        return fail(expanded.message, { code: expanded.code, ...(expanded.details ?? {}) });
      }
      updates = expanded.updates;
      clusterToggleWarnings.push(...expanded.warnings);

      if (updates.length === 0) {
        return ok(
          {
            message:
              `No disk write: ${SEO_INCLUDE_IN_CLUSTERING} on with existing cluster membership ` +
              `(${resolved.contentType}/${slug}). Virtual field is never persisted.`,
            include_in_clustering: true,
          },
          {
            warnings: [
              ...clusterToggleWarnings,
              {
                code: "seo_include_in_clustering_noop",
                message:
                  "seo.include_in_clustering is MCP-only (not written to YAML). Membership already satisfied; no seo.* change.",
              },
            ],
            next_actions: [
              {
                tool: "get_entry_seo",
                priority: "optional",
                reason: "Confirm include_in_clustering and locale seo:.",
                args_hint: {
                  slug,
                  locale,
                  contentType: resolved.contentType,
                  ...(variant ? { variant } : {}),
                  ...(site ? { site } : {}),
                },
              },
            ],
          },
        );
      }

      const catalogGate = formSourceWriteGate(
        collectFormSourceHitsFromUpdates(updates, currentDoc),
        {
          tool: "update_fields",
          site,
          contentType: resolved.contentType,
          slug,
          retryArgs: {
            slug,
            locale,
            contentType: resolved.contentType,
            updates: inputUpdates,
            confirm_live_edit,
            variant,
            layout_target,
            confirm_layout_target,
            site,
          },
        },
      );
      if (catalogGate) return catalogGate;

      const commonFilePath = path.join(contentPath, getDirectory(resolved.contentType, resolved.config), slug, "_common.yml");

      const localeEntries: Array<[string, unknown]> = [];
      const commonEntries: Array<[string, unknown]> = [];
      const slugRenameValue = !variant
        ? updates.find((u) => u.field_path === "slug" && typeof u.value === "string")?.value as string | undefined
        : undefined;
      for (const { field_path, value, meta_target } of updates) {
        if (field_path === "slug" && slugRenameValue !== undefined) {
          continue;
        }
        if (field_path.startsWith("meta.")) {
          const metaKey = field_path.slice(5).split(".")[0];
          const toCommon = META_COMMON_FIELDS.has(metaKey) ||
            (!ALL_KNOWN_META_FIELDS.has(metaKey) && meta_target === "common");
          if (toCommon) commonEntries.push([field_path, value]);
          else localeEntries.push([field_path, value]);
        } else {
          localeEntries.push([field_path, value]);
        }
      }

      const localeRelPath = `${contentFolder}/${pathInfo.relativeHint}`;
      const ctDir = getDirectory(resolved.contentType, resolved.config);
      const commonRelPath = `${contentFolder}/${ctDir}/${slug}/_common.yml`;

      if (localeEntries.length > 0 && !fs.existsSync(pathInfo.filePath)) {
        return fail(`File not found: ${pathInfo.relativeHint}`);
      }

      if (localeEntries.length > 0) {
        const conflictErr = await getConflictError(
          pathInfo.filePath,
          localeRelPath,
          localeEntries,
          { updates: localeEntries.map(([p, v]) => ({ field_path: p, value: v })) },
          domain,
        );
        if (conflictErr) return conflictErr;
      }
      if (commonEntries.length > 0) {
        const conflictErr = await getConflictError(
          commonFilePath,
          commonRelPath,
          commonEntries,
          { updates: commonEntries.map(([p, v]) => ({ field_path: p, value: v })) },
          domain,
        );
        if (conflictErr) return conflictErr;
      }

      const results: string[] = [];
      let boundUpdates: unknown;
      const warnings: McpWarning[] = [
        ...variantWarningsIfNeeded(variant),
        ...clusterToggleWarnings,
      ];
      {
        const sessWarn = missingSessionWarning(agent_session_id);
        if (sessWarn) warnings.push(sessWarn);
      }
      let renameResult: Record<string, unknown> | null = null;
      if (touchesSections) {
        warnings.push({
          code: "section_index_no_create",
          message:
            "sections.N.* patches an existing slot only (this file or template.{locale}.yml). Missing index fails — reload get_entry_fields or use layout_target type_template. Does not create overlay patches. Merge: server/section-merge.ts.",
        });
      }
      if (variant && commonEntries.length > 0) {
        warnings.push({
          code: "common_meta_ignores_variant",
          message:
            "Common meta (robots/priority/change_frequency or meta_target=common) writes _common.yml and ignores variant.",
        });
      }

      if (localeEntries.length > 0) {
        const ops = localeEntries.map(([p, v]) => ({ action: "update_field", path: p, value: v }));
        const apiResult = await callEditSectionsApi(
          {
            contentType: resolved.contentType,
            slug,
            locale,
            variant,
            layoutTarget,
            operations: ops,
            report: trimmedReport,
            agent_session_id,
          },
          mcpToken,
          domain,
        );
        if ("error" in apiResult) return apiResult.error;
        boundUpdates = apiResult.data.boundUpdates;
        appendSharedTemplateHtmlCacheWarning(warnings, apiResult.data, layoutTarget);
        results.push(`${localeEntries.length} field(s) → ${pathInfo.relativeHint}`);
      }

      if (commonEntries.length > 0) {
        const ops = commonEntries.map(([p, v]) => ({ action: "update_field", path: p, value: v }));
        const apiErr = await callEditCommonApi(
          {
            contentType: resolved.contentType,
            slug,
            operations: ops,
            report: trimmedReport,
            agent_session_id,
          },
          mcpToken,
          domain,
        );
        if (apiErr) {
          if (localeEntries.length > 0) {
            return actionRequired(
              {
                success: false,
                action_required: "retry_common_meta",
                message:
                  "Locale fields were written but _common.yml update failed. " +
                  "Re-call update_fields with only the common meta paths.",
                wrote: results,
                common_error: apiErr,
              },
              [{
                tool: "update_fields",
                priority: "required",
                reason: "Retry common-meta paths only.",
                args_hint: {
                  slug,
                  locale,
                  contentType: resolved.contentType,
                  confirm_live_edit: true,
                  updates: commonEntries.map(([field_path, value]) => ({ field_path, value })),
                },
              }],
            );
          }
          return apiErr;
        }
        results.push(`${commonEntries.length} field(s) → _common.yml`);
      }

      if (slugRenameValue !== undefined) {
        const renamed = await callRenameSlugApi(
          {
            contentType: resolved.contentType,
            folderSlug: slug,
            locale,
            newSlug: slugRenameValue,
            createRedirect: !!create_redirect,
            enforceRedirectPolicy: true,
          },
          mcpToken,
          domain,
        );
        if (!renamed.ok) {
          if (results.length > 0) {
            return actionRequired(
              {
                success: false,
                action_required: "retry_slug_rename",
                message:
                  "Some fields were written but live slug rename failed. " +
                  "Retry update_fields with only field_path 'slug'.",
                wrote: results,
                slug_error: renamed.error,
              },
              [{
                tool: "update_fields",
                priority: "required",
                reason: "Retry slug rename only on the live locale.",
                args_hint: {
                  slug,
                  locale,
                  contentType: resolved.contentType,
                  confirm_live_edit: true,
                  updates: [{ field_path: "slug", value: slugRenameValue }],
                },
              }],
            );
          }
          return renamed.error;
        }
        renameResult = renamed.data;
        results.push(`slug rename → ${String(renamed.data.newSlug || slugRenameValue)}`);
      }

      const side_effects: McpSideEffect[] = [...(bindingPropagateSideEffects(boundUpdates) || [])];
      const next_actions: NextAction[] = [];
      warnings.push(UPDATED_AT_STAMP_WARNING);
      if (localeEntries.length > 0) {
        side_effects.push({
          kind: "locale_yaml",
          summary: `Wrote ${pathInfo.relativeHint}; whitelist content changes stamp updated_at on that layer.`,
        });
      }
      const seoWrote = updates.some((u) => isSeoPath(u.field_path));
      if (seoWrote) {
        side_effects.push({
          kind: "locale_yaml",
          summary: `Wrote seo.* on ${pathInfo.relativeHint} (locale only; not _common.yml).`,
        });
        if (!variant) {
          side_effects.push({
            kind: "seo_index",
            summary: `Patched ${contentFolder}/${SEO_INDEX_FILENAME} after disk write (same author as YAML).`,
          });
        }
        warnings.push({
          code: "seo_non_effects",
          message:
            "Does not change meta.redirects, in-body links, sitemap priority, GCS sync/, or auto-commit internals. Duplicate is_pillar flags are not stripped.",
        });
        warnings.push({
          code: "seo_diagnostics_cache_may_lag",
          message:
            "seo-index / list_seo_cluster_* inventory updates immediately. validation_issues / diagnostics cache may lag until a metrics-capable agent runs run_entry_diagnostics with confirm:true.",
        });
        if (variant) {
          warnings.push({
            code: "variant_seo_not_indexed",
            message: "Variant seo: is not written to seo-index.json until promote.",
          });
        }
        next_actions.push({
          tool: "get_entry_seo",
          priority: "recommended",
          reason: "Confirm locale seo: plus the live index row.",
          args_hint: { slug, locale, contentType: resolved.contentType, ...(variant ? { variant } : {}) },
        });
        next_actions.push({
          tool: "list_seo_cluster_entries",
          priority: "optional",
          reason: "Re-check cluster bucket membership after this write",
          args_hint: { bucket: "clustered", q: slug, ...(site ? { site } : {}) },
        });
        next_actions.push({
          tool: "run_entry_diagnostics",
          priority: "optional",
          reason: "Refresh SEO diagnostics (categories seo) when you can confirm a job",
          args_hint: {
            slugs: [slug],
            categories: ["seo"],
            freshness: "hard",
            confirm: true,
            ...(site ? { site } : {}),
          },
        });
      }
      if (slugRenameValue !== undefined) {
        warnings.push({
          code: "slug_rename_non_effects",
          message:
            "Slug rename updates locale URL routing only. It does not rename the entry folder and does not create a 301 redirect.",
        });
        warnings.push({
          code: "slug_rename_redirect_hint",
          message: "Use update_redirect if you need the previous URL to 301 to the new URL.",
        });
        side_effects.push({
          kind: "locale_yaml",
          summary: `Renamed live slug in ${pathInfo.relativeHint}.`,
        });
      }

      if (renameResult && renameResult.routed === false) {
        return actionRequired(
          {
            success: false,
            action_required: "refresh_content_index",
            message:
              "Slug was written but the new URL is not routable yet. Refresh the content index and verify routing.",
            ...(renameResult.oldUrl ? { old_url: renameResult.oldUrl } : {}),
            ...(renameResult.newUrl ? { new_url: renameResult.newUrl } : {}),
            locale,
            routed: false,
          },
          [{
            tool: "refresh_content_index",
            priority: "required",
            reason: "Rebuild URL routing after slug rename.",
            args_hint: { contentType: resolved.contentType, ...(site ? { site } : {}) },
          }],
        );
      }

      return ok(
        {
          message: `Applied ${updates.length} update(s) to ${resolved.contentType}/${slug}: ${results.join("; ")}`,
          ...(renameResult?.oldUrl ? { old_url: renameResult.oldUrl } : {}),
          ...(renameResult?.newUrl ? { new_url: renameResult.newUrl } : {}),
          ...(renameResult?.locale ? { locale: renameResult.locale } : {}),
          ...(renameResult?.routed !== undefined ? { routed: renameResult.routed } : {}),
          ...(Array.isArray(boundUpdates) && boundUpdates.length > 0 ? { bound_updates: boundUpdates } : {}),
          ...wrotePayload({
            layer: pathInfo.layer,
            contentType: resolved.contentType,
            path: pathInfo.relativeHint,
            locale,
            slug,
          }),
        },
        { warnings, next_actions, side_effects: side_effects.length ? side_effects : undefined },
      );
    }
  );

  // update_meta_fields — multi-entry meta-only bulk (same updates across slugs)
  mcp.tool(
    "update_meta_fields",
    "Apply the SAME meta field updates to many entry slugs in one call (token saver). Meta paths only — no sections or body fields. " +
    "For one entry (or meta+body/section together) use update_fields instead.\n\n" +
    "Server coalesces cache/sitemap/CI/redirect flush once after the batch; skips entry-preview capture. " +
    "Per-slug live-gate failures continue the batch; fix circular traps with update_fields.\n\n" +
    "Max 50 unique slugs. Duplicate slugs rejected. contentType is required (all slugs must belong to that type).\n\n" +
    MULTI_SITE_TOOL_BLURB + "\n\n" +
    "IMPORTANT — versioning: pass confirm_live_edit: true when any slug has versioning.yml and you intend live edits.",
    {
      slugs: z.array(z.string()).min(1).max(50).describe("Entry slugs to update (unique, max 50)"),
      locale: z.string().default("en").describe("Shared locale for all slugs"),
      updates: z.array(z.object({
        field_path: z.string().describe("Meta path, e.g. meta.robots or meta.page_title"),
        value: z.unknown().describe("New value"),
        meta_target: z.enum(["locale", "common"]).optional().describe("Required for unknown meta keys"),
      })).min(1).describe("Meta updates applied identically to every slug"),
      contentType: z.string().describe("Content type for all slugs (required; cross-type batches are rejected)"),
      variant: z.string().optional().describe("Optional variant for locale-routed meta (common meta ignores variant)"),
      confirm_live_edit: z.boolean().optional().describe("Confirm live overwrite for versioned slugs"),
      site: z.string().optional().describe(SITE_PARAM_DESC),
    },
    async ({ slugs, locale, updates, contentType, variant, confirm_live_edit, site }) => {
      const siteResult = resolveSiteContext(site);
      if (!siteResult.ok) return siteFailResult(siteResult.error);
      const { domain } = siteResult;
      try {
        assertSafeLocale(locale);
        assertSafeSegment(contentType, "contentType");
        if (variant) assertSafeSegment(variant, "variant");
        for (const s of slugs) assertSafeSegment(s, "slug");
      } catch (e) {
        return fail((e as Error).message);
      }

      const seen = new Set<string>();
      for (const s of slugs) {
        if (seen.has(s)) return fail(`Duplicate slug in slugs[]: ${s}`);
        seen.add(s);
      }

      for (const u of updates) {
        const p = u.field_path.startsWith("meta.") ? u.field_path : `meta.${u.field_path}`;
        if (!p.startsWith("meta.")) {
          return fail(`Non-meta path '${u.field_path}'. Use update_fields for body/section paths.`);
        }
      }

      if (mcpToken && !(await checkCap(mcpToken, "seo_edit", contentType))) {
        return denyResponse("seo_edit", contentType);
      }

      try {
        const url = `http://localhost:${MAIN_SERVER_PORT}/api/content/bulk-update-meta${
          domain ? `?__site=${encodeURIComponent(domain)}` : ""
        }`;
        const res = await fetch(url, {
          method: "POST",
          headers: internalHeaders(mcpToken),
          body: JSON.stringify({
            slugs,
            locale,
            updates: updates.map((u) => ({
              field_path: u.field_path.startsWith("meta.") ? u.field_path : `meta.${u.field_path}`,
              value: u.value,
              ...(u.meta_target ? { meta_target: u.meta_target } : {}),
            })),
            contentType,
            ...(variant ? { variant } : {}),
            ...(confirm_live_edit ? { confirm_live_edit: true } : {}),
          }),
        });
        const data = await res.json() as Record<string, unknown>;
        if (!res.ok && res.status !== 207) {
          return fail((data.error as string) || `Server error: ${res.status}`);
        }

        const results = (data.results as Array<Record<string, unknown>>) || [];
        const warnings: McpWarning[] = [
          {
            code: "bulk_meta_coalesced_flush",
            message:
              data.flushed
                ? "Cache, sitemap, CI refresh, and redirect cache were flushed once after the batch (not per slug)."
                : "No successful writes — post-write flush was skipped.",
          },
          {
            code: "bulk_meta_no_preview_capture",
            message: "Entry preview capture was skipped for this meta-only bulk update.",
          },
          UPDATED_AT_STAMP_WARNING,
        ];
        for (const w of (data.warnings as string[]) || []) {
          if (w.includes("common_meta_ignores_variant")) {
            warnings.push({ code: "common_meta_ignores_variant", message: w });
          }
        }

        const next_actions: NextAction[] = [];
        for (const r of results) {
          if (r.ok) continue;
          if (r.action_required === "fix_live_required_fields" || r.code === "live_required_fields") {
            next_actions.push({
              tool: "update_fields",
              priority: "required",
              reason: `Slug '${r.slug}' hit live-required/circular trap — set meta + body fields together.`,
              args_hint: {
                slug: r.slug,
                locale,
                contentType: r.contentType,
                confirm_live_edit: true,
                updates: ((r.missing_fields as string[]) || ["meta.description", "description"]).map(
                  (field_path) => ({ field_path, value: `<non-empty value for ${field_path}>` }),
                ),
              },
            });
          } else if (r.action_required === "confirm_live_edit" || r.code === "confirm_live_edit") {
            next_actions.push({
              tool: "update_meta_fields",
              priority: "required",
              reason: `Re-call with confirm_live_edit: true for versioned slug '${r.slug}' (or pass variant).`,
              args_hint: { slugs: [r.slug], locale, updates, confirm_live_edit: true, contentType },
            });
          }
        }

        const okCount = results.filter((r) => r.ok).length;
        if (okCount === results.length) {
          return ok(
            {
              message: `Updated meta on ${okCount} slug(s)`,
              results,
              flushed: data.flushed,
              side_effects_detail: data.side_effects,
            },
            { warnings, next_actions: [] },
          );
        }
        return actionRequired(
          {
            success: false,
            action_required: "review_bulk_meta_results",
            message: `Bulk meta partial success: ${okCount}/${results.length} slug(s) updated`,
            results,
            flushed: data.flushed,
            side_effects_detail: data.side_effects,
            warnings,
          },
          next_actions,
        );
      } catch (e) {
        return fail(`Failed to call bulk-update-meta API: ${(e as Error).message}`);
      }
    }
  );

  // update_entry_field — DB override OR CT mapped fields (one level per call)
  mcp.tool(
    "update_entry_field",
    "Set or reset one mapping field at exactly one level. " +
    "Set-mode: pass value. Reset-mode: reset:true (no value) clears the override via field-reset (inherit lower layer). " +
    "Precedence: ct_override > db_override > original (DB types). " +
    "level=content_type → PUT .../field-overrides (URL name is historical): " +
    "static types write a top-level root key on the layer YAML file; DB-backed types write the field_overrides bag. " +
    "Optional variant targets {variant}.{locale}.yml (must exist; missing file fails — no live fallback). " +
    "All-draft entries without variant auto-resolve to draft.{locale}.yml when no live file exists. " +
    "level=database → db/{dbSlug}/overrides.json (listings + pages; all locales). " +
    "Never both levels in one call. Inspect with get_entry_fields first. Not for SEO meta.* / seo.* (use update_fields).",
    {
      slug: z.string().describe("Entry slug"),
      contentType: z.string().optional().describe("Content type hint. Omit to auto-detect."),
      field: z.string().describe("Mapping field name, e.g. 'title' or 'author_name'"),
      value: z.unknown().optional().describe("New value (required unless reset:true)"),
      reset: z.boolean().optional().describe(
        "When true, clear this field (inherit lower layer). Do not send value.",
      ),
      level: z.enum(["database", "content_type"]).describe(
        "database = overrides.json. content_type = mapped field on locale/variant YAML (static: root key; DB: field_overrides bag)."
      ),
      locale: z.string().default("en").describe("Locale for content_type level (ignored for database level)"),
      variant: z
        .string()
        .optional()
        .describe(
          "Optional variant slug (e.g. draft, lumi-version). Writes {variant}.{locale}.yml when set; file must exist.",
        ),
      site: z.string().optional().describe(SITE_PARAM_DESC),
    },
    async ({ slug, contentType, field, value, reset, level, locale, variant, site }) => {
      const siteResult = resolveSiteContext(site);
      if (!siteResult.ok) return siteFailResult(siteResult.error);
      const { domain } = siteResult;
      try {
        assertSafeSegment(slug, "slug");
        assertSafeLocale(locale);
        if (contentType) assertSafeSegment(contentType, "contentType");
        assertSafeSegment(field, "field");
        if (variant) assertSafeSegment(variant, "variant");
      } catch (e) {
        return fail((e as Error).message);
      }

      const resolved = resolveContentType(slug, contentType, siteResult.contentPath, { allowSharedLayout: true });
      if (!resolved) {
        return fail(`Page not found for slug '${slug}'${contentType ? ` (contentType: ${contentType})` : ""}`);
      }
      if (field === PURCHASABLE_FIELD) {
        return fail(
          "purchasable is a computed system field (from _ecommerce.yml). Do not write it. Edit the sidecar or use get_product_funnel / update_product_funnel.",
        );
      }
      if (isKnownSeoFieldPath(field) || field === `${SEO_YAML_KEY}.pillar`) {
        return fail(
          `SEO field '${field}' is not supported by update_entry_field. Use update_fields with value or reset:true.`,
        );
      }
      if (reset === true) {
        if (value !== undefined) {
          return fail("reset:true must not include value");
        }
      } else if (value === undefined) {
        return fail("value is required unless reset:true");
      }
      if (mcpToken && !(await checkCap(mcpToken, "content_edit_text", resolved.contentType))) {
        return denyResponse("content_edit_text", resolved.contentType);
      }

      const ct = resolved.contentType;
      const ctDir = getDirectory(ct, resolved.config);
      const dbSlug = resolved.config.database?.slug as string | undefined;
      const isStatic = !dbSlug;
      const q = domain ? `?__site=${encodeURIComponent(domain)}` : "";
      const getHint = {
        tool: "get_entry_fields",
        reason: "Re-check provenance after write",
        args_hint: { slug, contentType: ct, locale, ...(variant ? { variant } : {}) },
        priority: "recommended" as const,
      };

      try {
        if (reset === true) {
          const layerFile = variant ? `${variant}.${locale}.yml` : `${locale}.yml`;
          const dbPath = `db/${dbSlug || "<database>"}/overrides.json`;
          const ctPath = `${ctDir}/${slug}/${layerFile}`;
          const url = `http://localhost:${MAIN_SERVER_PORT}/api/content-types/${encodeURIComponent(ct)}/field-reset/${encodeURIComponent(slug)}${q}`;
          const res = await fetch(url, {
            method: "POST",
            headers: internalHeaders(mcpToken),
            body: JSON.stringify({ field, locale, variant: variant || undefined }),
          });
          const data = await res.json() as {
            error?: string;
            storage?: string;
            path?: string;
            noop?: boolean;
            message?: string;
          };
          if (!res.ok) return fail(data.error || `Server error: ${res.status}`);
          const writtenPath = data.path || ctPath;
          const storage = data.storage || (isStatic ? "root_key" : "field_overrides");
          if (isStatic) {
            return ok(
              {
                message: data.noop
                  ? `No-op reset for ${ct}/${slug}.${field} (key not on layer; may live only on _common.yml)`
                  : `Reset static ${ct}/${slug}.${field} on ${writtenPath}`,
                storage,
                path: writtenPath,
                noop: !!data.noop,
              },
              {
                warnings: [
                  {
                    code: data.noop ? "static_reset_noop" : "static_reset_layer_only",
                    message: data.noop
                      ? `Key absent on ${writtenPath}; reset does not rewrite _common.yml.`
                      : `Deleted root key on ${writtenPath} only. Does not touch _common.yml.`,
                  },
                ],
                side_effects: data.noop
                  ? [{ kind: "other", summary: `storage=${storage}; noop` }]
                  : [
                      { kind: "wrote_file", summary: `${writtenPath}#${field}` },
                      { kind: "other", summary: `storage=${storage}` },
                    ],
                next_actions: [getHint],
              },
            );
          }
          return ok(
            { message: `Reset ${ct}/${slug}.${field} → cleared ${dbPath} + ${writtenPath}#field_overrides` },
            {
              warnings: [
                {
                  code: "reset_clears_both_layers",
                  message: `Cleared DB override (${dbPath}) and CT field_overrides on ${writtenPath} for this field. Baseline restored.`,
                },
              ],
              side_effects: [
                { kind: "wrote_file", summary: dbPath },
                { kind: "wrote_file", summary: `${writtenPath}#field_overrides` },
                { kind: "cache", summary: "Database item cache / listings may refresh for this slug" },
                { kind: "other", summary: `storage=${storage}` },
              ],
              next_actions: [{
                ...getHint,
                reason: "Confirm provenance is original after reset",
              }],
            },
          );
        }

        if (level === "database") {
          const relPath = `db/${dbSlug || "<database>"}/overrides.json`;
          const url = `http://localhost:${MAIN_SERVER_PORT}/api/content-types/${encodeURIComponent(ct)}/db-overrides/${encodeURIComponent(slug)}${q}`;
          const res = await fetch(url, {
            method: "PUT",
            headers: internalHeaders(mcpToken),
            body: JSON.stringify({ fields: { [field]: value } }),
          });
          const data = await res.json() as { error?: string };
          if (!res.ok) return fail(data.error || `Server error: ${res.status}`);
          return ok(
            { message: `Database override set for ${ct}/${slug}.${field} → ${relPath}` },
            {
              warnings: [
                {
                  code: "db_override_affects_listings",
                  message: `Wrote ${relPath}. Affects listings, dropdowns, and pages; shared across locales. Does not write field_overrides YAML.`,
                },
              ],
              side_effects: [
                { kind: "wrote_file", summary: relPath },
                { kind: "cache", summary: "Database item cache / listings may refresh for this slug" },
              ],
              next_actions: [getHint],
            },
          );
        }

        const layerFile = variant ? `${variant}.${locale}.yml` : `${locale}.yml`;
        const relPathFallback = `${ctDir}/${slug}/${layerFile}`;
        const url = `http://localhost:${MAIN_SERVER_PORT}/api/content-types/${encodeURIComponent(ct)}/field-overrides/${encodeURIComponent(slug)}${q}`;
        const res = await fetch(url, {
          method: "PUT",
          headers: internalHeaders(mcpToken),
          body: JSON.stringify({
            locale,
            variant: variant || undefined,
            fields: { [field]: value },
          }),
        });
        const data = await res.json() as {
          error?: string;
          storage?: "root_key" | "field_overrides";
          path?: string;
          isVariantLayer?: boolean;
        };
        if (!res.ok) return fail(data.error || `Server error: ${res.status}`);
        const storage = data.storage || (isStatic ? "root_key" : "field_overrides");
        const writtenPath = data.path || relPathFallback;
        const isPublishedAt = field === "published_at";
        return ok(
          {
            message: isPublishedAt
              ? `published_at set for ${ct}/${slug} on _common.yml (static) or DB override`
              : storage === "root_key"
                ? `Static root key set for ${ct}/${slug}.${field} → ${writtenPath}`
                : `Content-type field_overrides set for ${ct}/${slug}.${field} → ${writtenPath}`,
            storage,
            path: writtenPath,
          },
          {
            warnings: isPublishedAt
              ? [
                  {
                    code: "published_at_common",
                    message:
                      "Static published_at writes _common.yml (listings sort from there). Locale published_at cleared. Cannot clear to empty. Paths: server/published-at.ts, writeMappedFields.",
                  },
                ]
              : [
                  {
                    code: storage === "root_key" ? "static_root_key" : "ct_override_page_only",
                    message:
                      storage === "root_key"
                        ? `Wrote root key on ${writtenPath} (API still named field-overrides; no field_overrides bag on static).`
                        : `Wrote field_overrides on ${writtenPath}. Page/YAML only; does not change database listings.`,
                  },
                  {
                    code: "ct_override_locale_only",
                    message: data.isVariantLayer
                      ? `Variant layer only (${writtenPath}); published ${locale}.yml unchanged until promote.`
                      : `Locale ${locale} only; sibling locales unchanged. Live file only (not _common.yml) except published_at.`,
                  },
                ],
            side_effects: [
              {
                kind: "wrote_file",
                summary: isPublishedAt
                  ? `${ctDir}/${slug}/_common.yml#published_at`
                  : `${writtenPath}#${storage === "root_key" ? field : `field_overrides.${field}`}`,
              },
              {
                kind: "other",
                summary: `storage=${storage}`,
              },
            ],
            next_actions: [getHint],
          },
        );
      } catch (e) {
        return fail((e as Error).message);
      }
    },
  );

  mcp.tool(
    "get_entry_fields",
    "List mapping fields with effective value and provenance " +
    "(original | db_override | ct_override | entry_default). " +
    "Static types: values come from root keys on the layer file (entry_default); leftover field_overrides bags are still applied until migrated. " +
    "DB types: ct_override = field_overrides bag; db_override = overrides.json. " +
    "Includes MCP-only seo.include_in_clustering (boolean; never YAML) when the type has seo fields — writable only if seo_monitoring.enabled. " +
    "Optional variant reads {variant}.{locale}.yml. Use before update_fields / update_entry_field (value or reset:true). Requires content_view.",
    {
      slug: z.string(),
      contentType: z.string().optional(),
      locale: z.string().default("en"),
      variant: z
        .string()
        .optional()
        .describe("Optional variant slug to inspect that layer file instead of live {locale}.yml"),
      site: z.string().optional().describe(SITE_PARAM_DESC),
    },
    async ({ slug, contentType, locale, variant, site }) => {
      const siteResult = resolveSiteContext(site);
      if (!siteResult.ok) return siteFailResult(siteResult.error);
      const { domain } = siteResult;
      try {
        if (variant) assertSafeSegment(variant, "variant");
      } catch (e) {
        return fail((e as Error).message);
      }
      const resolved = resolveContentType(slug, contentType, siteResult.contentPath, { allowSharedLayout: true });
      if (!resolved) {
        return fail(`Page not found for slug '${slug}'`);
      }
      const fieldsDenied = await denyUnlessContentView(mcpToken, resolved.contentType, grants);
      if (fieldsDenied) return fieldsDenied;
      const q = new URLSearchParams({ locale });
      if (domain) q.set("__site", domain);
      if (variant) q.set("variant", variant);
      try {
        const url = `http://localhost:${MAIN_SERVER_PORT}/api/content-types/${encodeURIComponent(resolved.contentType)}/field-provenance/${encodeURIComponent(slug)}?${q}`;
        const res = await fetch(url, { headers: internalHeaders(mcpToken) });
        const data = await res.json();
        if (!res.ok) return fail((data as { error?: string }).error || `Server error: ${res.status}`);

        // Enrich relation fields with MCP-only system_hints (never staff description).
        const payload = data as {
          fields?: Array<Record<string, unknown>>;
          [key: string]: unknown;
        };
        let fieldsOut = payload.fields;
        const typeMonitored = isSeoMonitoringEnabled(resolved.contentType, siteResult.contentPath);
        try {
          const configs = loadContentTypes(siteResult.contentPath);
          const cfg = configs[resolved.contentType];
          const ed = cfg ? getEditorConfig(cfg) : undefined;
          if (Array.isArray(fieldsOut)) {
            fieldsOut = fieldsOut.map((f) => {
              const name = typeof f.field === "string" ? f.field : typeof f.name === "string" ? f.name : null;
              if (!name) return f;
              if (typeof name === "string" && name.startsWith("seo.")) {
                return {
                  ...f,
                  system_hints: [
                    "Prefer seo.include_in_clustering (MCP-only boolean) to turn cluster monitoring on/off for this entry.",
                    "Off expands to seo.pillar_path: null + seo.is_pillar: false. On requires non-empty seo.pillar_path or seo.is_pillar: true after merge.",
                    "Locale YAML seo: for writes (writeSeoFields). Optional field_mapping seo_main_keyword|seo_pillar_path|seo_is_pillar = DB read baseline; YAML overlay wins. Reset removes YAML key only. Never dotted seo.* in field_mapping; never _common.yml; never writeMappedFields for seo.*.",
                    "Live write patches seo-index.json after disk with the same author. Variants are not indexed.",
                    "seo.is_pillar auto-fills this page's canonical path. Do not invent pillar_path. Empty pillar_path is a cluster gap; null is opt-out.",
                  ],
                };
              }
              if (name === PURCHASABLE_FIELD || f.source === "system") {
                return {
                  ...f,
                  writable: false,
                  system_hints: [
                    "Computed from _ecommerce.yml (slug is in the product index).",
                    "Do not write via update_fields / update_entry_field. Edit _ecommerce.yml or use get_product_funnel / update_product_funnel.",
                    "Lead-form catalogs filter with source.query purchasable=true — not actively_selling.",
                  ],
                };
              }
              const hint = ed?.[name];
              const system_hints = buildEditorSystemHints(name, hint as Parameters<typeof buildEditorSystemHints>[1]);
              const fill_intent =
                hint && typeof hint === "object" && "fill_intent" in hint
                  ? (hint as { fill_intent?: unknown }).fill_intent ?? null
                  : null;
              if (!system_hints && fill_intent == null) return f;
              return {
                ...f,
                ...(system_hints ? { system_hints } : {}),
                ...(fill_intent != null ? { fill_intent } : {}),
              };
            });

            const localeSeo = (() => {
              if (variant) {
                const v = loadVariantPage(
                  resolved.contentType,
                  slug,
                  locale,
                  variant,
                  siteResult.contentPath,
                );
                return v?.data?.seo;
              }
              const live = loadPage(resolved.contentType, slug, locale, siteResult.contentPath);
              return live?.data?.seo;
            })();
            const includeInClustering = deriveIncludeInClustering(localeSeo);

            const hasSeoRow = fieldsOut.some((f) => {
              const n = typeof f.field === "string" ? f.field : typeof f.name === "string" ? f.name : "";
              return n.startsWith("seo.");
            });
            if (hasSeoRow || typeMonitored) {
              fieldsOut = [
                {
                  field: SEO_INCLUDE_IN_CLUSTERING,
                  effective: includeInClustering,
                  writable: typeMonitored,
                  source: "system",
                  system_hints: [
                    "MCP-only virtual boolean (mirrors staff Include in SEO clustering). Never written to YAML.",
                    typeMonitored
                      ? "Writable via update_fields. false → pillar_path:null + is_pillar:false. true requires pillar_path or is_pillar after merge."
                      : "Not writable: content type seo_monitoring.enabled is off. Raw seo.* fields still allowed.",
                    "Does not change content-types.yml seo_monitoring; does not create a YAML key.",
                  ],
                },
                ...fieldsOut,
              ];
            }
          }
          const relation_fields = Object.entries(ed || {})
            .filter(([, h]) => h && (h as { type?: string }).type === "relation")
            .map(([field, hint]) => ({
              field,
              system_hints: buildEditorSystemHints(field, hint as Parameters<typeof buildEditorSystemHints>[1]) ?? [],
            }));
          return ok(
            {
              message: `Fields for ${resolved.contentType}/${slug} (${locale}${variant ? `, variant=${variant}` : ""})`,
              ...payload,
              fields: fieldsOut ?? payload.fields,
              relation_fields,
              ...resolvedUpdatedAtFields(
                resolved.contentType,
                slug,
                locale,
                siteResult.contentPath,
              ),
            },
            { warnings: [], next_actions: [] },
          );
        } catch {
          return ok(
            {
              message: `Fields for ${resolved.contentType}/${slug} (${locale}${variant ? `, variant=${variant}` : ""})`,
              ...(data as Record<string, unknown>),
              ...resolvedUpdatedAtFields(
                resolved.contentType,
                slug,
                locale,
                siteResult.contentPath,
              ),
            },
            { warnings: [], next_actions: [] },
          );
        }
      } catch (e) {
        return fail((e as Error).message);
      }
    },
  );

  // list_variants
  mcp.tool(
    "list_variants",
    "List extra versions (drafts/A-B variants) for a page: slug, traffic allocation, locale. " +
    "Live-only pages have no versioning.yml: hasVersioning is false, variants is [], live_locales lists published locales — that is not unpublished. " +
    "versioning.yml is created by create_variant, not by hand; extra versions start at 0% traffic. " +
    "Use before create_variant or editing an existing draft. Requires content_view.",
    {
      contentType: z.string().describe("Content type, e.g. 'program', 'page', 'landing'"),
      slug: z.string().describe("Page slug"),
      site: z.string().optional().describe(SITE_PARAM_DESC),
    },
    async ({ contentType, slug, site }) => {
      const viewDenied = await denyUnlessContentView(mcpToken, contentType, grants);
      if (viewDenied) return viewDenied;
      const siteResult = resolveSiteContext(site);
      if (!siteResult.ok) return siteFailResult(siteResult.error);
      const { domain, contentPath } = siteResult;
      try {
        assertSafeSegment(contentType, "contentType");
        assertSafeSegment(slug, "slug");
      } catch (e) {
        return fail((e as Error).message);
      }

      try {
        const versioningSlug = versioningApiSlug(contentType, slug, contentPath);
        const url = `http://localhost:${MAIN_SERVER_PORT}/api/versioning/${encodeURIComponent(contentType)}/${encodeURIComponent(versioningSlug)}${domain ? `?__site=${encodeURIComponent(domain)}` : ""}`;
        const res = await fetch(url, { headers: internalHeaders(mcpToken) });
        const data = await res.json() as Record<string, unknown>;
        if (!res.ok) {
          return fail((data.error as string) || `Server error: ${res.status}`);
        }
        const liveByLocale = (data.liveByLocale as Record<string, boolean> | undefined) ?? {};
        const live_locales = Object.entries(liveByLocale)
          .filter(([, isLive]) => isLive)
          .map(([loc]) => loc);
        const hasLiveDefault = data.hasLiveDefault === true;
        if (!data.hasVersioningFile || !data.versioning) {
          const unpublished = !hasLiveDefault;
          return ok(
            {
              message: unpublished
                ? "No extra versions and no live locale (unpublished)."
                : "Live-only: no extra versions. Visitors see live_locales.",
              contentType,
              slug,
              versioningSlug,
              hasVersioning: false,
              hasLiveDefault,
              live_locales,
              variants: [],
            },
            {
              warnings: unpublished
                ? [
                    {
                      code: "unpublished",
                      message: "No live locale and no versioning.yml. ContentIndex skips it (public 404 / no sitemap). create_variant seeds a draft; publish_draft to go live.",
                    },
                    {
                      code: "versioning_yml_on_create",
                      message: "versioning.yml is created by create_variant, not by hand.",
                    },
                  ]
                : [
                    {
                      code: "live_only",
                      message: "hasVersioning false means no extra versions, not unpublished. Live locales exist in live_locales.",
                    },
                    {
                      code: "versioning_yml_on_create",
                      message: "versioning.yml is created by create_variant, not by hand.",
                    },
                    {
                      code: "zero_traffic_on_create",
                      message: "Extra versions start at 0% traffic. Live YAML is unchanged until promote_variant.",
                    },
                  ],
              next_actions: [],
            },
          );
        }
        const versioning = data.versioning as Record<string, { variants?: Array<{ slug: string; allocation: number }> }>;
        const variants = Object.entries(versioning).flatMap(([locale, localeData]) =>
          (localeData.variants || []).map(v => ({ locale, slug: v.slug, allocation: v.allocation }))
        );
        return ok(
          {
            message: `Found ${variants.length} extra version(s).`,
            contentType,
            slug,
            hasVersioning: true,
            hasLiveDefault,
            live_locales,
            variants,
          },
          { warnings: [], next_actions: [] },
        );
      } catch (e) {
        return fail(`Failed to list variants: ${(e as Error).message}`);
      }
    }
  );

  // create_variant
  mcp.tool(
    "create_variant",
    "Create a new draft/variant for a page by copying the live locale file (or an existing draft when unpublished) " +
    "to {variantSlug}.{locale}.yml and registering it in versioning.yml at 0% traffic allocation. " +
    "Works on unpublished draft entries (copies from an existing draft). " +
    "Returns the new variant slug. Edit with variant: <variantSlug>. " +
    "For unpublished entries use publish_draft to go live (all locales); for live pages use promote_variant (one locale).",
    {
      contentType: z.string().describe("Content type, e.g. 'program', 'page', 'landing'"),
      slug: z.string().describe("Page slug"),
      variantSlug: z.string().describe("Slug for the new variant, e.g. 'draft-v2' or 'ab-test-headline'. Lowercase letters, numbers, and hyphens only."),
      locale: z.string().default("en").describe("Locale to copy, e.g. 'en' or 'es'"),
      sourceVariant: z.string().optional().describe("When page is unpublished, optional draft slug to copy from (defaults to 'draft' or first available)."),
      site: z.string().optional().describe(SITE_PARAM_DESC),
    },
    async ({ contentType, slug, variantSlug, locale, sourceVariant, site }) => {
      const siteResult = resolveSiteContext(site);
      if (!siteResult.ok) return siteFailResult(siteResult.error);
      const { domain, contentPath } = siteResult;
      try {
        assertSafeSegment(contentType, "contentType");
        assertSafeSegment(slug, "slug");
        assertSafeSegment(variantSlug, "variantSlug");
        assertSafeLocale(locale);
        if (sourceVariant) assertSafeSegment(sourceVariant, "sourceVariant");
      } catch (e) {
        return fail((e as Error).message);
      }

      if (mcpToken) {
        if (!await checkCap(mcpToken, "content_create_variant", contentType)) {
          return denyResponse("content_create_variant", contentType);
        }
      }

      try {
        const versioningSlug = versioningApiSlug(contentType, slug, contentPath);
        const url = `http://localhost:${MAIN_SERVER_PORT}/api/versioning/${encodeURIComponent(contentType)}/${encodeURIComponent(versioningSlug)}${domain ? `?__site=${encodeURIComponent(domain)}` : ""}`;
        const res = await fetch(url, {
          method: "POST",
          headers: internalHeaders(mcpToken),
          body: JSON.stringify({ variantSlug, locale, ...(sourceVariant ? { sourceVariant } : {}) }),
        });
        const data = await res.json() as Record<string, unknown>;
        if (!res.ok) {
          return fail((data.error as string) || `Server error: ${res.status}`);
        }
        return ok(
          {
            variantSlug: data.variantSlug,
            locale: data.locale,
            filePath: data.filePath,
            versioningSlug,
            templateMode: versioningSlug === "single" || versioningSlug === "template",
            seededFromDraft: data.seededFromDraft === true,
          },
          {
            warnings: [...VARIANT_WARNINGS],
            side_effects: [{
              kind: "variant_isolated",
              summary: versioningSlug === "single" || versioningSlug === "template"
                ? "Created template draft (shared by all attached entries); live template.*.yml unchanged"
                : data.seededFromDraft
                  ? "Created additional draft from existing draft; still unpublished"
                  : "Created draft only; live locale YAML unchanged",
            }],
            next_actions: [{
              tool: "update_fields",
              priority: "recommended",
              reason: "Edit the draft with variant set; live bindings/shared-layout will not run until publish/promote + live edits.",
              args_hint: {
                contentType,
                slug: versioningSlug === "single" || versioningSlug === "template" ? slug : slug,
                locale,
                variant: data.variantSlug ?? variantSlug,
                layout_target: versioningSlug === "single" || versioningSlug === "template" ? "type_template" : undefined,
              },
            }],
          },
        );
      } catch (e) {
        return fail(`Failed to create variant: ${(e as Error).message}`);
      }
    }
  );

  // publish_draft — all-or-nothing publish for unpublished entries
  mcp.tool(
    "publish_draft",
    "Publish an unpublished draft entry: promotes the given variantSlug to live {locale}.yml for EVERY remaining draft locale that has that file (all-or-nothing). " +
    "After this, the page is public and enters the sitemap. Other drafts become normal variants at 0%. " +
    "Fails if the entry already has a live locale (use promote_variant instead) or if some draft locales lack the variantSlug. " +
    "Also fails when resolved meta.page_title / meta.description are empty, when editor.required fields " +
    "(e.g. blog title + description) are empty, or when a detached locale would go live empty (EMPTY_LOCALE: no sections and no content). " +
    "Confirm with the user before calling — this makes the page live. " +
    "On success, next_actions requires run_entry_diagnostics (hard + slug) then poll get_diagnostics_job.",
    {
      contentType: z.string().describe("Content type, e.g. 'program', 'page', 'landing'"),
      slug: z.string().describe("Page slug"),
      variantSlug: z.string().default("draft").describe("Draft variant to publish, e.g. 'draft'"),
      report: z
        .string()
        .describe(AGENT_REPORT_MUTATE_DESC),
      agent_session_id: z
        .string()
        .optional()
        .describe("Optional. From agent_session start."),
      site: z.string().optional().describe(SITE_PARAM_DESC),
    },
    async ({ contentType, slug, variantSlug, report, agent_session_id, site }) => {
      const siteResult = resolveSiteContext(site);
      if (!siteResult.ok) return siteFailResult(siteResult.error);

      const trimmedReport = typeof report === "string" ? report.trim() : "";
      if (trimmedReport.length < 80) {
        return actionRequired(
          {
            success: false,
            action_required: "report_required",
            code: trimmedReport ? "report_too_short" : "report_required",
            message: "report required (min 80 characters).",
          },
          [],
        );
      }
      const { domain } = siteResult;
      try {
        assertSafeSegment(contentType, "contentType");
        assertSafeSegment(slug, "slug");
        assertSafeSegment(variantSlug, "variantSlug");
      } catch (e) {
        return fail((e as Error).message);
      }

      if (mcpToken) {
        if (!await checkCap(mcpToken, "content_promote_variant", contentType)) {
          return denyResponse("content_promote_variant", contentType);
        }
      }

      try {
        // Entry slug as-is (same as promote_variant) — do not remap attached entries to "single".
        const versioningSlug = slug;
        const url = `http://localhost:${MAIN_SERVER_PORT}/api/versioning/${encodeURIComponent(contentType)}/${encodeURIComponent(versioningSlug)}/publish${domain ? `?__site=${encodeURIComponent(domain)}` : ""}`;
        const res = await fetch(url, {
          method: "POST",
          headers: internalHeaders(mcpToken, { agentSessionId: agent_session_id }),
          body: JSON.stringify({ variantSlug, report: trimmedReport }),
        });
        const data = await res.json() as Record<string, unknown>;
        if (!res.ok) {
          const errMsg = (data.error as string) || `Server error: ${res.status}`;
          const isEmpty = /EMPTY_LOCALE/i.test(errMsg);
          return fail(errMsg, {
            code: isEmpty ? "EMPTY_LOCALE" : undefined,
            contentType,
            slug,
            variantSlug,
            next_actions: isEmpty
              ? [{
                  tool: "get_entry_content",
                  reason: "Edit the draft until it has sections or content, then retry publish_draft",
                  args_hint: { slug, contentType, variant: variantSlug },
                  priority: "required",
                }]
              : [],
          });
        }
        return ok(
          {
            published: true,
            variantSlug,
            locales: data.locales,
            contentType,
            slug,
          },
          {
            warnings: [
              ...(missingSessionWarning(agent_session_id)
                ? [missingSessionWarning(agent_session_id)!]
                : []),
              {
                code: "page_now_live",
                message: "Page is live for the listed locales and will appear in the sitemap. Confirm with the user before publishing in the future.",
              },
              {
                code: "published_at_stamp",
                message:
                  "If published_at was missing/empty, server stamped ISO now on _common.yml once (ensurePublishedAtOnce). Non-empty dates are not overwritten. Not tied to YAML status.",
              },
            ],
            side_effects: [{
              kind: "publish_all_locales",
              summary: `Promoted ${variantSlug} to live locale files; remaining drafts are variants at 0%; may stamp published_at on _common.yml`,
            }],
            next_actions: [diagnosticsAfterGoLiveNextAction(slug, site)],
          },
        );
      } catch (e) {
        return fail(`Failed to publish draft: ${(e as Error).message}`);
      }
    }
  );

  // promote_variant
  mcp.tool(
    "promote_variant",
    "Promote a variant to become the live version for ONE locale: overwrites the default locale file with the variant's content, " +
    "removes the variant from versioning.yml, and deletes the variant file. " +
    "For attached shared-layout entries, pass the entry slug (not \"single\") to promote entry drafts from translate_entry " +
    "({variantSlug}.{locale}.yml under the entry folder). Pass slug \"single\" only to promote a type-root template variant. " +
    "For unpublished draft entries (no live locales), use publish_draft instead (all-or-nothing across locales). " +
    "Fails when resolved meta.page_title / meta.description are empty, editor.required fields are empty, " +
    "or the promoted detached locale would be empty (EMPTY_LOCALE: no sections and no content). " +
    "This is a destructive operation — the previous live content will be replaced. Confirm with the user before calling. " +
    "On success, next_actions requires run_entry_diagnostics (hard + slug) then poll get_diagnostics_job.",
    {
      contentType: z.string().describe("Content type, e.g. 'program', 'page', 'landing'"),
      slug: z.string().describe("Page slug"),
      variantSlug: z.string().describe("Slug of the variant to promote, e.g. 'draft-v2'"),
      locale: z.string().default("en").describe("Locale of the variant to promote, e.g. 'en' or 'es'"),
      report: z
        .string()
        .describe(AGENT_REPORT_MUTATE_DESC),
      agent_session_id: z
        .string()
        .optional()
        .describe("Optional. From agent_session start."),
      site: z.string().optional().describe(SITE_PARAM_DESC),
    },
    async ({ contentType, slug, variantSlug, locale, report, agent_session_id, site }) => {
      const siteResult = resolveSiteContext(site);
      if (!siteResult.ok) return siteFailResult(siteResult.error);

      const trimmedReport = typeof report === "string" ? report.trim() : "";
      if (trimmedReport.length < 80) {
        return actionRequired(
          {
            success: false,
            action_required: "report_required",
            code: trimmedReport ? "report_too_short" : "report_required",
            message: "report required (min 80 characters).",
          },
          [],
        );
      }
      const { contentPath, domain } = siteResult;
      try {
        assertSafeSegment(contentType, "contentType");
        assertSafeSegment(slug, "slug");
        assertSafeSegment(variantSlug, "variantSlug");
        assertSafeLocale(locale);
      } catch (e) {
        return fail((e as Error).message);
      }

      if (mcpToken) {
        if (!await checkCap(mcpToken, "content_promote_variant", contentType)) {
          return denyResponse("content_promote_variant", contentType);
        }
      }

      const configs = loadContentTypes(contentPath);
      const config = configs[contentType];
      const sharedLayout = config ? isSharedLayoutConfig(config) : false;

      try {
        // Entry slug as-is: attached translate drafts live under the entry folder.
        // Use slug "single" only for type-root template variants.
        const versioningSlug = slug;
        const url = `http://localhost:${MAIN_SERVER_PORT}/api/versioning/${encodeURIComponent(contentType)}/${encodeURIComponent(versioningSlug)}/${encodeURIComponent(locale)}/promote/${encodeURIComponent(variantSlug)}${domain ? `?__site=${encodeURIComponent(domain)}` : ""}`;
        const res = await fetch(url, {
          method: "POST",
          headers: internalHeaders(mcpToken, { agentSessionId: agent_session_id }),
          body: JSON.stringify({ report: trimmedReport }),
        });
        const data = await res.json() as Record<string, unknown>;
        if (!res.ok) {
          const errMsg = (data.error as string) || `Server error: ${res.status}`;
          const isEmpty = /EMPTY_LOCALE/i.test(errMsg);
          return fail(errMsg, {
            code: isEmpty ? "EMPTY_LOCALE" : undefined,
            contentType,
            slug,
            locale,
            variantSlug,
            next_actions: isEmpty
              ? [{
                  tool: "get_entry_content",
                  reason: "Edit the draft until it has sections or content, then retry promote_variant",
                  args_hint: { slug, contentType, locale, variant: variantSlug },
                  priority: "required",
                }]
              : [],
          });
        }
        const next_actions: NextAction[] = sharedLayout
          ? [{
              tool: "get_entry_content",
              priority: "recommended",
              reason: "Shared-layout promote does not sync sibling singles — re-read live content and reconcile structure if needed.",
              args_hint: { contentType, slug, locale },
            }]
          : [];
        next_actions.push(diagnosticsAfterGoLiveNextAction(slug, site));
        {
          const promoteWarns = promoteWarnings(sharedLayout);
          const sessWarn = missingSessionWarning(agent_session_id);
          if (sessWarn) promoteWarns.unshift(sessWarn);
          return ok(
            { message: `Variant '${variantSlug}' promoted to live for ${contentType}/${slug} (${locale})` },
            { warnings: promoteWarns, next_actions },
          );
        }
      } catch (e) {
        return fail(`Failed to promote variant: ${(e as Error).message}`);
      }
    }
  );

  mcp.tool(
    "convert_to_draft",
    "Unpublish ONE live locale: rename {locale}.yml to draft.{locale}.yml and register it in versioning.yml at 0% traffic. " +
    "Inverse of promote_variant (not of publish_draft). Other live locales stay public. Extra variants are unchanged. published_at is not cleared. " +
    "Blocked on the shared template (slug \"single\" or attached shared-layout) — detach the entry first, then retry on the entry slug. " +
    "Confirm with the user before calling. Cap: content_promote_variant.",
    {
      contentType: z.string().describe("Content type, e.g. 'program', 'page', 'landing'"),
      slug: z.string().describe("Page slug (not \"single\")"),
      locale: z.string().default("en").describe("Live locale to convert, e.g. 'en' or 'es'"),
      site: z.string().optional().describe(SITE_PARAM_DESC),
    },
    async ({ contentType, slug, locale, site }) => {
      const siteResult = resolveSiteContext(site);
      if (!siteResult.ok) return siteFailResult(siteResult.error);
      const { contentPath, domain } = siteResult;
      try {
        assertSafeSegment(contentType, "contentType");
        assertSafeSegment(slug, "slug");
        assertSafeLocale(locale);
      } catch (e) {
        return fail((e as Error).message);
      }

      if (mcpToken) {
        if (!await checkCap(mcpToken, "content_promote_variant", contentType)) {
          return denyResponse("content_promote_variant", contentType);
        }
      }

      const configs = loadContentTypes(contentPath);
      const config = configs[contentType];
      const sharedLayout = config ? isSharedLayoutConfig(config) : false;
      const { isEntryDetached } = await import("../../server/shared-layout-entry.js");
      const detached = sharedLayout && slug !== "single" && slug !== "template"
        ? isEntryDetached(contentType, slug, contentPath)
        : false;
      const templateBlocked = (slug === "single" || slug === "template") || (sharedLayout && !detached);

      if (templateBlocked) {
        const next_actions: NextAction[] = (slug === "single" || slug === "template")
          ? []
          : [
              {
                tool: "set_entry_attachment",
                priority: "required",
                reason: "Detach this entry so it owns its own live locale files, then retry convert_to_draft on the entry slug.",
                args_hint: { contentType, slug, action: "detach", confirm: true, ...(site ? { site } : {}) },
              },
              {
                tool: "convert_to_draft",
                priority: "recommended",
                reason: "After detach, convert this entry's live locale (not the shared template).",
                args_hint: { contentType, slug, locale, ...(site ? { site } : {}) },
              },
            ];
        return fail(
          "Convert to draft is blocked on the shared template. Detach this entry first, then convert this entry only. Do not convert slug \"single\".",
          {
            code: "template_blocked",
            contentType,
            slug,
            locale,
            warnings: [{
              code: "template_blast_radius",
              message: "Converting template.{locale}.yml would unpublish that template locale for every attached entry. This tool does not convert the shared template.",
            }],
            next_actions,
          },
        );
      }

      try {
        const url = `http://localhost:${MAIN_SERVER_PORT}/api/versioning/${encodeURIComponent(contentType)}/${encodeURIComponent(slug)}/${encodeURIComponent(locale)}/convert-to-draft${domain ? `?__site=${encodeURIComponent(domain)}` : ""}`;
        const res = await fetch(url, { method: "POST", headers: internalHeaders(mcpToken) });
        const data = await res.json() as Record<string, unknown>;
        if (!res.ok) {
          return fail((data.error as string) || `Server error: ${res.status}`, {
            contentType,
            slug,
            locale,
            next_actions: [],
          });
        }

        const lastLiveLocale = data.lastLiveLocale === true;
        const liveRelPath = (data.liveRelPath as string) || `${contentType}/${slug}/${locale}.yml`;
        const draftRelPath = (data.draftRelPath as string) || `${contentType}/${slug}/draft.${locale}.yml`;
        const versioningRelPath = (data.versioningRelPath as string) || `${contentType}/${slug}/versioning.yml`;

        return ok(
          {
            message: lastLiveLocale
              ? `Converted live ${locale} to draft. Entry is unpublished (no live locales).`
              : `Converted live ${locale} to draft. Other live locales unchanged.`,
            contentType,
            slug,
            locale,
            variantSlug: data.variantSlug || "draft",
            lastLiveLocale,
            liveRelPath,
            draftRelPath,
            versioningRelPath,
          },
          {
            warnings: [
              {
                code: "locale_unpublished",
                message: `This locale 404s publicly and is not in the sitemap until publish_draft. Live file was renamed (${liveRelPath} → ${draftRelPath}), not deleted.`,
              },
              {
                code: "other_locales_unchanged",
                message: "Other live locales were not converted.",
              },
              {
                code: "extra_variants_unchanged",
                message: "Existing extra versions keep their files and allocations.",
              },
              {
                code: "published_at_kept",
                message: "published_at is not cleared.",
              },
            ],
            side_effects: [
              {
                kind: "live_renamed_to_draft",
                summary: `Renamed ${liveRelPath} → ${draftRelPath}; registered draft at 0% in ${versioningRelPath}`,
              },
            ],
            next_actions: lastLiveLocale
              ? [{
                  tool: "publish_draft",
                  priority: "optional",
                  reason: "Entry has no live locale. Publish draft.{locale}.yml when ready to go live again (confirm with the user).",
                  args_hint: { contentType, slug, variantSlug: data.variantSlug || "draft", ...(site ? { site } : {}) },
                }]
              : [{
                  tool: "list_variants",
                  priority: "optional",
                  reason: "Re-read live_locales and variants after converting this locale.",
                  args_hint: { contentType, slug, ...(site ? { site } : {}) },
                }],
          },
        );
      } catch (e) {
        return fail(`Failed to convert to draft: ${(e as Error).message}`);
      }
    },
  );

  // create_entry
  mcp.tool(
    "create_entry",
    "Create a brand-new YAML-driven content entry (any non-DB content type, including single_template types such as blog). " +
    "For normal (non-shared-layout) types this creates an unpublished DRAFT: " +
    "writes _common.yml + draft.{locale}.yml + versioning.yml (0% allocation). " +
    "Edit with variant: 'draft', then call publish_draft. Confirm with the principal before publishing.\n" +
    "All content types: exactly ONE locale per create (multi-locale create is rejected). Add translations via translate_entry.\n" +
    "Shared-layout / single_template types write that one locale live immediately. " +
    "Put body/fields on the locale (title, description, content, … per field_mapping); sections must be [] — shell comes from template.{locale}.yml. " +
    "Call explain_site topic shared-layout and/or get_content_type_info before creating shared-layout entries. " +
    MULTI_SITE_TOOL_BLURB + "\n\n" +
    "locales map: locale → { meta?, sections?, …field_mapping keys }. Exactly one locale key.\n" +
    "URL pattern params (from url_pattern, e.g. :category) must be on the locale object — never _common.yml. " +
    "Use observed_values_by_locale from get_content_type_info to pick a peer slug for that language.\n" +
    "New URL-param/select values not seen on same-locale peers require confirm_new_values: true after principal approval.\n\n" +
    "Possible errors: unknown/DB-backed contentType, slug exists, single_locale_create, missing editor.required fields, sections on shared-layout create, unconfirmed new param values.\n" +
    GITHUB_COMMIT_TOOL_BLURB,
    {
      contentType: z.string().describe("Content type from content-types.yml without database.slug, e.g. 'blog', 'program', 'page', 'landing'."),
      slug: z.string().describe("URL-safe slug for the new entry. Must not already exist for this content type."),
      common: z.record(z.unknown()).describe(
        "Fields written to _common.yml (locale-independent). Do NOT put URL pattern params here — use the locale object.",
      ),
      locales: z.record(z.record(z.unknown())).describe(
        "Map of locale → locale YAML fields. Include meta, optional sections, and field_mapping keys (title, description, content, …). " +
        "Exactly one locale key. Shared-layout: sections must be [] or omitted.",
      ),
      confirm_new_values: z.boolean().optional().describe(
        "Set true only after the principal (human or orchestrator/reviewer) approved inventing a new URL-param/select value not in observed peers.",
      ),
      report: z
        .string()
        .describe(AGENT_REPORT_MUTATE_DESC),
      agent_session_id: z
        .string()
        .optional()
        .describe("Optional. From agent_session start."),
      site: z.string().optional().describe(SITE_PARAM_DESC),
    },
    async ({ contentType, slug, common, locales, confirm_new_values, report, agent_session_id, site }) => {
      const siteResult = resolveSiteContext(site);
      if (!siteResult.ok) {
        return siteFailResult(siteResult.error, "create_entry", { contentType, slug, common, locales, confirm_new_values });
      }
      const trimmedReport = typeof report === "string" ? report.trim() : "";
      if (trimmedReport.length < 80) {
        return actionRequired(
          {
            success: false,
            action_required: "report_required",
            code: trimmedReport ? "report_too_short" : "report_required",
            message: "report required (min 80 characters).",
          },
          [],
        );
      }
      const { contentPath, contentFolder, domain } = siteResult;
      try {
        assertSafeSegment(slug, "slug");
        assertSafeSegment(contentType, "contentType");
      } catch (e) {
        return fail((e as Error).message);
      }
      if (slug === "single" || slug === "template") {
        return fail(
          'Slug "template" and "single" are reserved for the shared-layout shell and cannot be used as entry slugs.',
        );
      }

      const localeKeys = Object.keys(locales);
      if (localeKeys.length === 0) {
        return fail("'locales' must contain at least one locale.");
      }
      try {
        for (const loc of localeKeys) assertSafeLocale(loc);
      } catch (e) {
        return fail((e as Error).message);
      }

      const configs = loadContentTypes(contentPath);
      const config = configs[contentType];
      if (!config) {
        const known = Object.keys(configs).filter(k => !isDbBacked(configs[k])).join(", ");
        return fail(`Unknown contentType '${contentType}'. Known non-DB types: ${known}`);
      }
      if (isDbBacked(config)) {
        return fail(
          `Content type '${contentType}' is database-backed (database.slug set) and cannot be created via create_entry. ` +
          `Use get_content_type_info for create_via. Static single_template types without database.slug are allowed.`,
        );
      }

      if (mcpToken) {
        if (!await checkCap(mcpToken, "content_create_entry", contentType)) {
          return denyResponse("content_create_entry", contentType);
        }
      }

      const sharedLayoutCreate = isSharedLayoutConfig(config) || !!config.single_template;
      if (localeKeys.length !== 1) {
        return actionRequired(
          {
            success: false,
            action_required: "single_locale_create",
            code: "single_locale_create",
            message:
              "Create exactly one locale at a time. Add translations later via translate_entry (draft.{locale}.yml) then promote or publish_draft.",
            contentType,
            slug,
            locales_provided: localeKeys,
          },
          [
            {
              tool: "create_entry",
              reason: "Retry with exactly one key in locales (e.g. only en or only es)",
              args_hint: { contentType, slug, common, locales: { [localeKeys[0]]: locales[localeKeys[0]] }, site },
              priority: "required",
            },
          ],
        );
      }

      // Normalize locale payloads: sections default [], strip known keys for field merge
      const normalizedLocales: Record<string, {
        meta?: Record<string, unknown>;
        sections: Record<string, unknown>[];
        fields: Record<string, unknown>;
      }> = {};
      for (const [loc, raw] of Object.entries(locales)) {
        const { meta, sections, slug: _s, ...rest } = raw as Record<string, unknown>;
        const sectionArr = Array.isArray(sections) ? sections as Record<string, unknown>[] : [];
        if (sharedLayoutCreate && sectionArr.length > 0) {
          return actionRequired(
            {
              success: false,
              action_required: "shared_layout_sections_must_be_empty",
              code: "shared_layout_sections_must_be_empty",
              message:
                "Shared-layout create must use sections: [] (or omit sections). " +
                "The shell comes from template.{locale}.yml. Put body in locale fields (e.g. content). " +
                "Overlays after create use section tools with layout_target.",
              contentType,
              slug,
              locale: loc,
            },
            [
              {
                tool: "create_entry",
                reason: "Retry with sections: [] and field_mapping keys on the locale object",
                args_hint: {
                  contentType,
                  slug,
                  common,
                  site,
                  locales: {
                    [loc]: { ...rest, ...(meta ? { meta } : {}), sections: [] },
                  },
                },
                priority: "required",
              },
              {
                tool: "get_content_type_info",
                reason: "Inspect field_mapping / body_model for this content type",
                args_hint: { contentType, site },
                priority: "recommended",
              },
            ],
          );
        }
        const missing = missingRequiredFields(config, common as Record<string, unknown>, rest);
        if (sharedLayoutCreate && missing.length > 0) {
          return actionRequired(
            {
              success: false,
              action_required: "missing_required_fields",
              code: "missing_required_fields",
              message:
                `Missing editor.required fields for live shared-layout create: ${missing.join(", ")}. ` +
                "Supply them on the locale object (or common when appropriate).",
              missing,
              contentType,
              slug,
            },
            [
              {
                tool: "get_content_type_info",
                reason: "See editor.required and field_mapping",
                args_hint: { contentType, site },
                priority: "required",
              },
              {
                tool: "create_entry",
                reason: "Retry with required fields populated",
                args_hint: { contentType, slug, common, site, locales },
                priority: "required",
              },
            ],
          );
        }
        normalizedLocales[loc] = {
          meta: meta && typeof meta === "object" ? meta as Record<string, unknown> : undefined,
          sections: sharedLayoutCreate ? [] : sectionArr,
          fields: rest,
        };
      }

      // URL pattern params must live on locale YAML only
      const urlParams = listExtraUrlPatternParams(config.url_pattern);
      const commonRecord = { ...(common as Record<string, unknown>) };
      const urlParamsOnCommon: string[] = [];
      for (const param of urlParams) {
        if (extractParamSlug(commonRecord[param])) urlParamsOnCommon.push(param);
        delete commonRecord[param];
      }
      if (urlParamsOnCommon.length > 0) {
        const missingOnLocale = urlParamsOnCommon.filter((param) =>
          !Object.entries(normalizedLocales).some(([, v]) => extractParamSlug(v.fields[param])),
        );
        if (missingOnLocale.length > 0) {
          return actionRequired(
            {
              success: false,
              action_required: "locale_only_url_param_on_common",
              code: "locale_only_url_param_on_common",
              message:
                `URL pattern param(s) [${missingOnLocale.join(", ")}] must be on the locale object, not _common.yml. ` +
                "Put each param on locales.{locale} and retry.",
              params: missingOnLocale,
              contentType,
              slug,
            },
            [
              {
                tool: "get_content_type_info",
                reason: "Inspect observed_values_by_locale for this content type",
                args_hint: { contentType, site },
                priority: "required",
              },
              {
                tool: "create_entry",
                reason: "Retry with URL pattern params on the locale object (not common)",
                args_hint: { contentType, slug, common: commonRecord, locales, site },
                priority: "required",
              },
            ],
          );
        }
      }

      const proposedByLocale = collectProposedUrlParamValuesByLocale(
        commonRecord,
        Object.fromEntries(
          Object.entries(normalizedLocales).map(([k, v]) => [k, { ...v.fields, ...(v.meta || {}) }]),
        ),
        urlParams,
      );
      const peerGate = validateUrlParamPeerValues(
        contentPath,
        contentType,
        config,
        proposedByLocale,
        confirm_new_values,
      );
      if (peerGate) {
        const { param, locale, proposed_value, observed_values } = peerGate;
        return actionRequired(
          {
            success: false,
            action_required: "confirm_new_url_param_value",
            code: "confirm_new_url_param_value",
            message:
              `New value '${proposed_value}' for '${param}' (${locale}) is not used by any ${locale} peer. ` +
              `Observed for ${locale}: [${observed_values.slice(0, 40).join(", ")}${observed_values.length > 40 ? ", …" : ""}]. ` +
              "Do not invent values silently. Get explicit approval from the principal " +
              "(human in the chat or a reviewer/orchestrator agent), then re-call with confirm_new_values: true " +
              "or pick an observed value for that locale.",
            param,
            locale,
            proposed_value,
            observed_values,
            observed_values_by_locale: observeParamValuesByLocale(contentPath, contentType, config, param),
            contentType,
            slug,
          },
          [
            {
              tool: "create_entry",
              reason: "After principal approval, retry with confirm_new_values: true (or change to an observed value)",
              args_hint: {
                contentType,
                slug,
                common: commonRecord,
                locales,
                site,
                confirm_new_values: true,
              },
              priority: "required",
            },
            {
              tool: "get_content_type_info",
              reason: "Inspect observed_values_by_locale",
              args_hint: { contentType, site },
              priority: "recommended",
            },
          ],
        );
      }

      const ctDir = getDirectory(contentType, config);
      const pageDir = path.join(contentPath, ctDir, slug);
      try { assertWithinBase(pageDir, contentPath); } catch (e) {
        return fail((e as Error).message);
      }
      if (fs.existsSync(pageDir)) {
        return fail(`Entry '${slug}' already exists for contentType '${contentType}'.`);
      }

      const draftFirst = !sharedLayoutCreate;
      const draftVariant = "draft";

      fs.mkdirSync(pageDir, { recursive: true });

      const commonData: Record<string, unknown> = { slug, ...commonRecord };
      fs.writeFileSync(path.join(pageDir, "_common.yml"), safeDump(commonData), "utf-8");
      notifyMcpContentWrite(path.join(pageDir, "_common.yml"), mcpWriteAuthor(mcpToken), { agent_session_id, report: trimmedReport });

      const createdLocales: string[] = [];
      const createdFiles: string[] = ["_common.yml"];
      for (const [loc, localeContent] of Object.entries(normalizedLocales)) {
        const localeData: Record<string, unknown> = {
          slug,
          ...localeContent.fields,
          sections: localeContent.sections,
          ...(localeContent.meta && Object.keys(localeContent.meta).length > 0 ? { meta: localeContent.meta } : {}),
        };
        applyEditorialUpdatedAtToData({
          data: localeData,
          previous: {},
          operations: operationsFromLocalePayload(localeData),
          contentType,
          slug,
          contentRoot: contentPath,
        });
        const fileName = draftFirst ? `${draftVariant}.${loc}.yml` : `${loc}.yml`;
        fs.writeFileSync(path.join(pageDir, fileName), safeDump(localeData), "utf-8");
        notifyMcpContentWrite(path.join(pageDir, fileName), mcpWriteAuthor(mcpToken), { agent_session_id, report: trimmedReport });
        createdLocales.push(loc);
        createdFiles.push(fileName);
      }

      if (draftFirst) {
        const versioning: Record<string, { variants: Array<{ slug: string; allocation: number }> }> = {};
        for (const loc of createdLocales) {
          versioning[loc] = { variants: [{ slug: draftVariant, allocation: 0 }] };
        }
        fs.writeFileSync(path.join(pageDir, "versioning.yml"), safeDump(versioning), "utf-8");
        createdFiles.push("versioning.yml");
      }

      const relPaths = createdFiles.map((f) => `${contentFolder}/${ctDir}/${slug}/${f}`);
      const commitMsg = draftFirst
        ? `Create draft entry ${contentType}/${slug}`
        : `Create entry ${contentType}/${slug}`;
      const commitResult = await callCommitFilesApi(relPaths, commitMsg, mcpToken, domain);
      let refreshResult = await callRefreshCacheApi(contentType, domain);
      if (!refreshResult.ok) {
        refreshResult = await callRefreshCacheApi(contentType, domain);
      }

      const warnings: McpWarning[] = [];
      {
        const sessWarn = missingSessionWarning(agent_session_id);
        if (sessWarn) warnings.push(sessWarn);
      }
      const ghWarning = githubCommitWarning(commitResult);
      if (ghWarning) warnings.push(ghWarning);
      const side_effects: McpSideEffect[] = [];
      const next_actions: NextAction[] = [];
      const primaryLocale = createdLocales[0] ?? "en";
      const siteHint = site ? { site } : {};

      if (draftFirst) {
        warnings.push({
          code: "draft_unpublished",
          message: "Entry is an unpublished draft (no live locale files). Not in sitemap; public URL 404s until publish_draft.",
        });
        warnings.push({
          code: "published_at_omitted",
          message:
            "published_at omitted on draft create (missing OK). Stamped once on publish_draft / first promote — not recomputed; cannot clear to empty.",
        });
        side_effects.push({
          kind: "draft_created",
          summary: `Wrote ${draftVariant}.{locale}.yml + versioning.yml; live {locale}.yml not created`,
          paths: relPaths,
        });
        next_actions.push({
          tool: "update_fields",
          priority: "recommended",
          reason: "Edit draft fields with variant set before publishing.",
          args_hint: { contentType, slug, locale: primaryLocale, variant: draftVariant, ...siteHint },
        });
        next_actions.push({
          tool: "publish_draft",
          priority: "optional",
          reason: "When ready, publish all remaining draft locales at once (confirm with the principal first).",
          args_hint: { contentType, slug, variantSlug: draftVariant, ...siteHint },
        });
      } else if (sharedLayoutCreate) {
        warnings.push(CREATE_ENTRY_SHARED_LAYOUT_WARNING);
        warnings.push({
          code: "shared_layout_single_locale_create",
          message:
            `Created live ${primaryLocale}.yml only. Did not seed sibling locales. ` +
            "Add translations later with translate_entry using locale fields while attached (draft until promote). " +
            "Use set_entry_attachment only when this entry needs a custom shell (not for field translation).",
        });
        warnings.push({
          code: "published_at_stamped",
          message:
            "Live create stamps published_at=now on _common.yml (shared-layout). Distinct from _updated_at; not tied to YAML status.",
        });
        side_effects.push(sharedTemplateBlastSideEffect(contentType, primaryLocale));
        next_actions.push({
          tool: "get_entry_content",
          priority: "recommended",
          reason: "Re-read merged content (fields + template.{locale}.yml shell). Prefer update_fields for locale fields — not section shell edits.",
          args_hint: { contentType, slug, locale: primaryLocale, ...siteHint },
        });
        next_actions.push({
          tool: "run_entry_diagnostics",
          priority: "recommended",
          reason: "Hard-refresh diagnostics for the new live entry (async — then poll get_diagnostics_job)",
          args_hint: { slugs: [slug], freshness: "hard", confirm: true, ...siteHint },
        });
      } else {
        warnings.push({
          code: "published_at_stamped",
          message:
            "Live create stamps published_at=now on _common.yml when the type is not draft-first.",
        });
      }
      if (!refreshResult.ok) {
        warnings.push({
          code: "index_refresh_failed",
          message:
            `Entry files were written, but URL routing refresh failed: ${refreshResult.error || "unknown error"}. ` +
            "Run refresh_content_index before validating the public URL. " +
            "After the index is fresh, append ?cache=false for an anonymous SSR HTML cache bypass " +
            "(production ~5 min LRU only — does not refresh ContentIndex/DBs). See explain_site topic routing.",
        });
        next_actions.push({
          tool: "refresh_content_index",
          priority: "required",
          reason: "Rebuild content index after create_entry.",
          args_hint: { contentType, ...siteHint },
        });
      }

      const title =
        (normalizedLocales[primaryLocale]?.fields?.title as string | undefined) ||
        (typeof common.title === "string" ? common.title : undefined);

      return ok(
        {
          slug,
          contentType,
          directory: `${contentFolder}/${ctDir}/${slug}`,
          locales: createdLocales,
          status: draftFirst ? "draft" : "published",
          ...(draftFirst ? { draftVariant, previewPath: `/private/preview/${contentType}/${slug}?variant=${draftVariant}&locale=${primaryLocale}` } : {}),
          ...(title ? { title } : {}),
          ...(commitResult.queued ? { queued: true } : {}),
          ...(commitResult.commitSha
            ? { commitSha: commitResult.commitSha, commitShas: [commitResult.commitSha] }
            : {}),
          ...(refreshResult.knownUrlCount !== undefined ? { known_url_count: refreshResult.knownUrlCount } : {}),
        },
        { warnings, next_actions, ...(side_effects.length > 0 ? { side_effects } : {}) },
      );
    }
  );

  // add_section
  mcp.tool(
    "add_section",
    "Add a new section to a page. Inserts at the given index (or appends if omitted). Section must include a 'type' field matching a component type. contentType is optional — omit it and the server will auto-detect it from the slug.\n\n" +
    "IMPORTANT — article / split pages: 2+ article sections on a page ALWAYS continue one piece (no share choice). " +
    "Put the lead article first. show_toc on the first article only controls the shared TOC; later show_toc / meta are non-effects for chrome. " +
    "Reading time (on-page and OG) combines all article bodies and shows on the first only; mobile/top TOC only on the first; desktop side TOC may still appear on later parts. " +
    "toc_group is optional/legacy — not a decision knob. Response may include article_split_always_share / article_lead_* warnings. " +
    "See get_component_variant → article_split_toc_group or explain_site topic 'sections'.\n\n" +
    "IMPORTANT — modal sections: type: modal must have section_id so CTAs can open it with url: \"#that-id\". " +
    "Response may include modal_missing_section_id. See explain_site topic 'sections'.\n\n" +
    "IMPORTANT — versioning safety: If the page has active variants (a versioning.yml exists), " +
    "you MUST ask the user before calling this tool: " +
    "'Do you want to edit the live version directly, or create a new draft variant first?' " +
    "To edit the live version directly pass confirm_live_edit: true. " +
    "To edit a variant, call create_variant first and pass the returned slug as the 'variant' parameter here.",
    {
      slug: z.string().describe("Page slug"),
      locale: z.string().default("en").describe("Locale code"),
      section: z.record(z.unknown()).describe("Section object with at minimum a 'type' field"),
      index: z.number().int().optional().describe("Position to insert (0-based). Omit to append."),
      contentType: z.string().optional().describe("Content type hint (e.g. 'page', 'program'). Omit to auto-detect from slug."),
      variant: z.string().optional().describe("Variant slug to write to (e.g. 'draft-v2'). Writes to {variantSlug}.{locale}.yml instead of the live locale file."),
      confirm_live_edit: z.boolean().optional().describe("Set to true to confirm you want to overwrite the live locale file directly when a versioning.yml exists. Required when no 'variant' is supplied and the page has active variants."),
      layout_target: layoutTargetSchema,
      confirm_layout_target: confirmLayoutTargetSchema,
      ...mutateReportZodFields,
      site: z.string().optional().describe(SITE_PARAM_DESC),
    },
    async ({ contentType, slug, locale, section, index, variant, confirm_live_edit, layout_target, confirm_layout_target, report, agent_session_id, site }) => {
      const siteResult = resolveSiteContext(site);
      if (!siteResult.ok) return siteFailResult(siteResult.error);
      const reportCheck = requireMutateReport(report);
      if (!reportCheck.ok) return reportCheck.result;
      const { trimmedReport } = reportCheck;
      const { contentPath, domain } = siteResult;
      if (!MCP_SERVER_SECRET) {
        return fail("add_section is unavailable: MCP_SERVER_SECRET is not configured. Set MCP_SERVER_SECRET in your environment before using section-editing tools.");
      }
      try {
        assertSafeSegment(slug, "slug");
        assertSafeLocale(locale);
        if (contentType) assertSafeSegment(contentType, "contentType");
        if (variant) assertSafeSegment(variant, "variant");
      } catch (e) {
        return fail((e as Error).message);
      }
      const resolved = resolveContentType(slug, contentType, contentPath, { allowSharedLayout: true });
      if (!resolved) {
        return fail(`Page not found for slug '${slug}'${contentType ? ` (contentType: ${contentType})` : ""}`);
      }

      if (mcpToken) {
        if (!await checkCap(mcpToken, "content_edit_structure", resolved.contentType)) {
          return denyResponse("content_edit_structure", resolved.contentType);
        }
      }

      const liveGate = confirmLiveEditGate({
        tool: "add_section",
        slug,
        contentType: resolved.contentType,
        locale,
        contentPath,
        variant,
        confirm_live_edit,
        extraArgsHint: { section, index, layout_target, confirm_layout_target },
      });
      if (liveGate) return liveGate;

      const layoutGate = resolveLayoutTargetGate({
        tool: "add_section",
        contentType: resolved.contentType,
        config: resolved.config,
        slug,
        locale,
        layout_target: layout_target as LayoutTarget | undefined,
        confirm_layout_target,
        requireConfirmWhenAuto: true,
      });
      if ("gate" in layoutGate) return layoutGate.gate;
      const layoutTarget = layoutGate.target;

      const pathInfo = pathForLayoutTarget({
        contentPath,
        contentType: resolved.contentType,
        config: resolved.config,
        slug,
        locale,
        layoutTarget,
        variant,
      });

      // Snapshot sections before write (for article split hints / auto-stamp).
      let existingSections: Array<Record<string, unknown>> = [];
      if (fs.existsSync(pathInfo.filePath)) {
        const before = safeLoad(fs.readFileSync(pathInfo.filePath, "utf-8")) || {};
        if (Array.isArray(before.sections)) {
          existingSections = before.sections as Array<Record<string, unknown>>;
        }
      }

      let sectionToAdd = section as Record<string, unknown>;
      const stamp = prepareArticleAddStamp({
        existingSections,
        newSection: sectionToAdd,
        insertIndex: index,
      });
      const operations: Array<Record<string, unknown>> = [];
      if (stamp) {
        sectionToAdd = stamp.section;
        operations.push(...stamp.siblingOps);
      }
      const addOp: Record<string, unknown> = {
        action: "add_item",
        path: "sections",
        item: sectionToAdd,
      };
      if (index !== undefined) {
        addOp.index = index;
      }
      operations.push(addOp);

      const catalogGate = formSourceWriteGate(
        collectFormSourceHitsFromNode(sectionToAdd, "section"),
        {
          tool: "add_section",
          site,
          contentType: resolved.contentType,
          slug,
          retryArgs: {
            slug,
            locale,
            contentType: resolved.contentType,
            section: sectionToAdd,
            index,
            confirm_live_edit,
            variant,
            layout_target,
            confirm_layout_target,
            report: trimmedReport,
            agent_session_id,
            site,
          },
        },
      );
      if (catalogGate) return catalogGate;

      const apiResult = await callEditSectionsApi(
        {
          contentType: resolved.contentType,
          slug,
          locale,
          variant,
          layoutTarget,
          operations,
          report: trimmedReport,
          agent_session_id,
        },
        mcpToken,
        domain,
      );
      if ("error" in apiResult) return apiResult.error;

      const warnings: McpWarning[] = [
        ADD_SECTION_NO_BINDING_FANOUT,
        ...variantWarningsIfNeeded(variant),
        ...schemaOrgPageOverrideWarnings(sectionToAdd),
      ];
      {
        const sessWarn = missingSessionWarning(agent_session_id);
        if (sessWarn) warnings.push(sessWarn);
      }
      appendSharedTemplateHtmlCacheWarning(warnings, apiResult.data, layoutTarget);
      let side_effects: McpSideEffect[] | undefined;
      let next_actions: NextAction[] = [];
      if (pathInfo.layer === "type_template") {
        const env = sharedStructuralEnvelope({
          tool: "add_section",
          contentType: resolved.contentType,
          config: resolved.config,
          contentPath,
          sourceLocale: locale,
          relativePath: pathInfo.relativeHint,
          argsHintBase: { section: sectionToAdd, index, confirm_live_edit: true },
          reasonPrefix: "Shared layout section was added.",
        });
        side_effects = env.side_effects;
        next_actions = env.next_actions;
      }

      // Non-effect: page WebSite/Organization does not write schema-org.yml
      const overrideType = String(sectionToAdd.schema_type ?? "");
      if (
        String(sectionToAdd.type ?? "") === "schema_org" &&
        (overrideType === "WebSite" || overrideType === "Organization")
      ) {
        side_effects = [
          ...(side_effects ?? []),
          {
            kind: "schema_org_page_section",
            summary: `Wrote page-local schema_org ${overrideType} to ${pathInfo.relativeHint}; site schema-org.yml unchanged.`,
          },
        ];
      }

      if (stamp) {
        warnings.push({
          code: "article_split_auto_stamped",
          message:
            "Page already had article(s); stamped toc_group and ensured show_toc on the first article. " +
            "Articles always continue one piece — TOC/reading time chrome follows the lead article only.",
        });
        side_effects = [
          ...(side_effects ?? []),
          {
            kind: "article_split_auto_stamp",
            summary:
              `Auto-stamped toc_group on sibling articles and show_toc on the first article in ${pathInfo.relativeHint}.`,
          },
        ];
      }

      const articleHints = hintsAfterAddArticle({
        existingSections,
        newSection: sectionToAdd,
        insertIndex: index,
        slug,
        locale,
      });
      warnings.push(...articleHints.warnings);
      // Stamp already applied — drop redundant update_fields next_actions.
      next_actions = [
        ...next_actions,
        ...articleHints.next_actions.filter((a) => a.tool !== "update_fields"),
      ];

      const modalHints = hintsAfterAddModal({
        newSection: sectionToAdd,
        insertIndex: index,
        existingSectionCount: existingSections.length,
        slug,
        locale,
      });
      warnings.push(...modalHints.warnings);
      next_actions = [...next_actions, ...modalHints.next_actions];

      return ok(
        {
          message: `Section of type '${sectionToAdd.type as string}' added to ${pathInfo.relativeHint}`,
          ...wrotePayload({
            layer: pathInfo.layer,
            contentType: resolved.contentType,
            path: pathInfo.relativeHint,
            locale,
            slug,
          }),
        },
        { warnings, next_actions, side_effects },
      );
    }
  );

  // remove_section
  mcp.tool(
    "remove_section",
    "Remove a section from a page by its index. contentType is optional — omit it and the server will auto-detect it from the slug.\n\n" +
    "IMPORTANT — versioning safety: If the page has active variants (a versioning.yml exists), " +
    "you MUST ask the user before calling this tool: " +
    "'Do you want to edit the live version directly, or create a new draft variant first?' " +
    "To edit the live version directly pass confirm_live_edit: true. " +
    "To edit a variant, call create_variant first and pass the returned slug as the 'variant' parameter here.",
    {
      slug: z.string().describe("Page slug"),
      locale: z.string().default("en").describe("Locale code"),
      index: z.number().int().describe("0-based index of the section to remove"),
      contentType: z.string().optional().describe("Content type hint (e.g. 'page', 'program'). Omit to auto-detect from slug."),
      variant: z.string().optional().describe("Variant slug to write to (e.g. 'draft-v2'). Writes to {variantSlug}.{locale}.yml instead of the live locale file."),
      confirm_live_edit: z.boolean().optional().describe("Set to true to confirm you want to overwrite the live locale file directly when a versioning.yml exists. Required when no 'variant' is supplied and the page has active variants."),
      layout_target: layoutTargetSchema,
      confirm_layout_target: confirmLayoutTargetSchema,
      ...mutateReportZodFields,
      site: z.string().optional().describe(SITE_PARAM_DESC),
    },
    async ({ contentType, slug, locale, index, variant, confirm_live_edit, layout_target, confirm_layout_target, report, agent_session_id, site }) => {
      const siteResult = resolveSiteContext(site);
      if (!siteResult.ok) return siteFailResult(siteResult.error);
      const reportCheck = requireMutateReport(report);
      if (!reportCheck.ok) return reportCheck.result;
      const { trimmedReport } = reportCheck;
      const { contentPath, contentFolder, domain } = siteResult;
      try {
        assertSafeSegment(slug, "slug");
        assertSafeLocale(locale);
        if (contentType) assertSafeSegment(contentType, "contentType");
        if (variant) assertSafeSegment(variant, "variant");
      } catch (e) {
        return fail((e as Error).message);
      }
      const resolved = resolveContentType(slug, contentType, contentPath, { allowSharedLayout: true });
      if (!resolved) {
        return fail(`Page not found for slug '${slug}'${contentType ? ` (contentType: ${contentType})` : ""}`);
      }

      if (mcpToken) {
        if (!await checkCap(mcpToken, "content_edit_structure", resolved.contentType)) {
          return denyResponse("content_edit_structure", resolved.contentType);
        }
      }

      const liveGate = confirmLiveEditGate({
        tool: "remove_section",
        slug,
        contentType: resolved.contentType,
        locale,
        contentPath,
        variant,
        confirm_live_edit,
        extraArgsHint: { index, layout_target, confirm_layout_target },
      });
      if (liveGate) return liveGate;

      const layoutGate = resolveLayoutTargetGate({
        tool: "remove_section",
        contentType: resolved.contentType,
        config: resolved.config,
        slug,
        locale,
        layout_target: layout_target as LayoutTarget | undefined,
        confirm_layout_target,
        requireConfirmWhenAuto: true,
      });
      if ("gate" in layoutGate) return layoutGate.gate;
      const layoutTarget = layoutGate.target;

      const pathInfo = pathForLayoutTarget({
        contentPath,
        contentType: resolved.contentType,
        config: resolved.config,
        slug,
        locale,
        layoutTarget,
        variant,
      });
      try { assertWithinBase(pathInfo.filePath, contentPath); } catch (e) {
        return fail((e as Error).message);
      }
      if (!fs.existsSync(pathInfo.filePath)) {
        return fail(`Locale file not found: ${pathInfo.relativeHint}`);
      }

      const localeData = safeLoad(fs.readFileSync(pathInfo.filePath, "utf-8")) || {};
      if (!Array.isArray(localeData.sections)) {
        return fail("Page has no sections array.");
      }
      const sections = localeData.sections as unknown[];
      if (index < 0 || index >= sections.length) {
        return fail(`Index ${index} out of range (0–${sections.length - 1}).`);
      }
      const removed = sections.splice(index, 1)[0] as Record<string, unknown>;
      const intendedContent = safeDump(localeData);

      const relativePath = `${contentFolder}/${pathInfo.relativeHint}`;
      const conflictCheck = await checkRemoteConflict(relativePath, domain);
      if (conflictCheck.conflict) {
        return conflictError({
          relativePath,
          remoteContent: conflictCheck.remoteContent,
          intendedContent,
          intendedChange: { action: "remove_section", index, removedType: removed?.type ?? "unknown" },
        });
      }

      const apiResult = await callEditSectionsApi(
        {
          contentType: resolved.contentType,
          slug,
          locale,
          variant,
          layoutTarget,
          operations: [{ action: "remove_item", path: "sections", index }],
          report: trimmedReport,
          agent_session_id,
        },
        mcpToken,
        domain,
      );
      if ("error" in apiResult) return apiResult.error;

      const warnings: McpWarning[] = [REMOVE_SECTION_NO_BINDING_FANOUT, ...variantWarningsIfNeeded(variant)];
      {
        const sessWarn = missingSessionWarning(agent_session_id);
        if (sessWarn) warnings.push(sessWarn);
      }
      appendSharedTemplateHtmlCacheWarning(warnings, apiResult.data, layoutTarget);
      let side_effects: McpSideEffect[] | undefined;
      let next_actions: NextAction[] = [];
      if (pathInfo.layer === "type_template") {
        const env = sharedStructuralEnvelope({
          tool: "remove_section",
          contentType: resolved.contentType,
          config: resolved.config,
          contentPath,
          sourceLocale: locale,
          relativePath: pathInfo.relativeHint,
          argsHintBase: { index, confirm_live_edit: true },
          reasonPrefix: "Shared layout section was removed.",
        });
        side_effects = env.side_effects;
        next_actions = env.next_actions;
      } else {
        next_actions = [{
          tool: "get_section_bindings",
          priority: "recommended",
          reason: "Inspect whether the removed section was bound; siblings keep the section until you remove it there.",
          args_hint: { contentType: resolved.contentType, slug, sectionIndex: index, locale },
        }];
      }

      return ok(
        {
          message: `Removed section at index ${index} (type: ${removed?.type ?? "unknown"}) from ${pathInfo.relativeHint}`,
          ...wrotePayload({
            layer: pathInfo.layer,
            contentType: resolved.contentType,
            path: pathInfo.relativeHint,
            locale,
            slug,
          }),
        },
        { warnings, next_actions, side_effects },
      );
    }
  );

  // reorder_sections
  mcp.tool(
    "reorder_sections",
    "Reorder sections by supplying a new order as an array of current indices. E.g. [2, 0, 1] moves the third section to the front. contentType is optional — omit it and the server will auto-detect it from the slug.\n\n" +
    "IMPORTANT — versioning safety: If the page has active variants (a versioning.yml exists), " +
    "you MUST ask the user before calling this tool: " +
    "'Do you want to edit the live version directly, or create a new draft variant first?' " +
    "To edit the live version directly pass confirm_live_edit: true. " +
    "To edit a variant, call create_variant first and pass the returned slug as the 'variant' parameter here.",
    {
      slug: z.string().describe("Page slug"),
      locale: z.string().default("en").describe("Locale code"),
      order: z.array(z.number().int()).describe("Array of current section indices in desired order — must be a permutation with no repeats"),
      contentType: z.string().optional().describe("Content type hint (e.g. 'page', 'program'). Omit to auto-detect from slug."),
      variant: z.string().optional().describe("Variant slug to write to (e.g. 'draft-v2'). Writes to {variantSlug}.{locale}.yml instead of the live locale file."),
      confirm_live_edit: z.boolean().optional().describe("Set to true to confirm you want to overwrite the live locale file directly when a versioning.yml exists. Required when no 'variant' is supplied and the page has active variants."),
      layout_target: layoutTargetSchema,
      confirm_layout_target: confirmLayoutTargetSchema,
      ...mutateReportZodFields,
      site: z.string().optional().describe(SITE_PARAM_DESC),
    },
    async ({ contentType, slug, locale, order, variant, confirm_live_edit, layout_target, confirm_layout_target, report, agent_session_id, site }) => {
      const siteResult = resolveSiteContext(site);
      if (!siteResult.ok) return siteFailResult(siteResult.error);
      const reportCheck = requireMutateReport(report);
      if (!reportCheck.ok) return reportCheck.result;
      const { trimmedReport } = reportCheck;
      const { contentPath, contentFolder, domain } = siteResult;
      try {
        assertSafeSegment(slug, "slug");
        assertSafeLocale(locale);
        if (contentType) assertSafeSegment(contentType, "contentType");
        if (variant) assertSafeSegment(variant, "variant");
      } catch (e) {
        return fail((e as Error).message);
      }
      const resolved = resolveContentType(slug, contentType, contentPath, { allowSharedLayout: true });
      if (!resolved) {
        return fail(`Page not found for slug '${slug}'${contentType ? ` (contentType: ${contentType})` : ""}`);
      }

      if (mcpToken) {
        if (!await checkCap(mcpToken, "content_edit_structure", resolved.contentType)) {
          return denyResponse("content_edit_structure", resolved.contentType);
        }
      }

      const liveGate = confirmLiveEditGate({
        tool: "reorder_sections",
        slug,
        contentType: resolved.contentType,
        locale,
        contentPath,
        variant,
        confirm_live_edit,
        extraArgsHint: { order, layout_target, confirm_layout_target },
      });
      if (liveGate) return liveGate;

      const layoutGate = resolveLayoutTargetGate({
        tool: "reorder_sections",
        contentType: resolved.contentType,
        config: resolved.config,
        slug,
        locale,
        layout_target: layout_target as LayoutTarget | undefined,
        confirm_layout_target,
        requireConfirmWhenAuto: true,
      });
      if ("gate" in layoutGate) return layoutGate.gate;
      const layoutTarget = layoutGate.target;

      const pathInfo = pathForLayoutTarget({
        contentPath,
        contentType: resolved.contentType,
        config: resolved.config,
        slug,
        locale,
        layoutTarget,
        variant,
      });
      try { assertWithinBase(pathInfo.filePath, contentPath); } catch (e) {
        return fail((e as Error).message);
      }
      if (!fs.existsSync(pathInfo.filePath)) {
        return fail(`Locale file not found: ${pathInfo.relativeHint}`);
      }

      const localeData = safeLoad(fs.readFileSync(pathInfo.filePath, "utf-8")) || {};
      if (!Array.isArray(localeData.sections)) {
        return fail("Page has no sections array.");
      }
      const sections = localeData.sections as unknown[];
      const n = sections.length;
      const seen = new Set<number>();
      const isPermutation = order.length === n && order.every(i => {
        if (i < 0 || i >= n || seen.has(i)) return false;
        seen.add(i);
        return true;
      });
      if (!isPermutation) {
        return fail(`Order must be a permutation of [0..${n - 1}] with no repeats. Got: [${order.join(", ")}]`);
      }
      const reorderedSections = order.map(i => sections[i]);
      const intendedContent = safeDump({ ...localeData, sections: reorderedSections });

      const relativePath = `${contentFolder}/${pathInfo.relativeHint}`;
      const conflictCheck = await checkRemoteConflict(relativePath, domain);
      if (conflictCheck.conflict) {
        return conflictError({
          relativePath,
          remoteContent: conflictCheck.remoteContent,
          intendedContent,
          intendedChange: { action: "reorder_sections", order },
        });
      }

      const apiResult = await callEditSectionsApi(
        {
          contentType: resolved.contentType,
          slug,
          locale,
          variant,
          layoutTarget,
          operations: [{ action: "replace_all_sections", sections: reorderedSections }],
          report: trimmedReport,
          agent_session_id,
        },
        mcpToken,
        domain,
      );
      if ("error" in apiResult) return apiResult.error;

      const warnings: McpWarning[] = [REORDER_NO_BINDING_FANOUT, ...variantWarningsIfNeeded(variant)];
      {
        const sessWarn = missingSessionWarning(agent_session_id);
        if (sessWarn) warnings.push(sessWarn);
      }
      appendSharedTemplateHtmlCacheWarning(warnings, apiResult.data, layoutTarget);
      let side_effects: McpSideEffect[] | undefined;
      let next_actions: NextAction[] = [];
      if (pathInfo.layer === "type_template") {
        const env = sharedStructuralEnvelope({
          tool: "reorder_sections",
          contentType: resolved.contentType,
          config: resolved.config,
          contentPath,
          sourceLocale: locale,
          relativePath: pathInfo.relativeHint,
          argsHintBase: { order, confirm_live_edit: true },
          reasonPrefix: "Shared layout section order changed.",
        });
        side_effects = env.side_effects;
        next_actions = env.next_actions;
      }

      return ok(
        {
          message: `Sections reordered in ${pathInfo.relativeHint}`,
          ...wrotePayload({
            layer: pathInfo.layer,
            contentType: resolved.contentType,
            path: pathInfo.relativeHint,
            locale,
            slug,
          }),
        },
        { warnings, next_actions, side_effects },
      );
    }
  );

  // replace_entry_sections
  mcp.tool(
    "replace_entry_sections",
    "Atomically replace ALL sections in a page's locale file in one call — the high-throughput " +
    "alternative to calling update_fields N times. " +
    "Optionally also replaces the meta block in the same call. " +
    "The caller supplies the complete new sections array; the server replaces the existing array atomically. " +
    "Accepts the same variant and confirm_live_edit versioning guards as update_fields. " +
    "contentType is optional — omit it and the server will auto-detect from slug.\n\n" +
    "What the caller must supply: a complete sections array (every section, in order). " +
    "What the server handles: path-sanitisation, conflict detection, atomic write via edit-sections API, " +
    "cache refresh, and Git mark-modified.\n\n" +
    "Possible errors: page/locale not found, path traversal detected, remote conflict " +
    "(returns remoteContent + intendedContent for manual merge), permission denied.\n\n" +
    "IMPORTANT — modal sections: any type: modal without section_id yields modal_missing_section_id " +
    "(CTAs need url: \"#that-id\"). See explain_site topic 'sections'.\n\n" +
    "IMPORTANT — versioning safety: If the page has active variants (a versioning.yml exists), " +
    "you MUST ask the user before calling this tool: " +
    "'Do you want to edit the live version directly, or create a new draft variant first?' " +
    "To edit the live version directly pass confirm_live_edit: true. " +
    "To edit a variant, call create_variant first and pass the returned slug as the 'variant' parameter here.",
    {
      slug: z.string().describe("Page slug"),
      locale: z.string().default("en").describe("Locale code, e.g. 'en' or 'es'"),
      sections: z.array(z.record(z.unknown())).describe("Complete new sections array. Replaces the entire existing sections array atomically. Every section must include a 'type' field."),
      meta: z.record(z.unknown()).optional().describe("Optional meta fields to update at the same time. Each key is shallow-merged into the existing meta object (e.g. { page_title: '...', description: '...' })."),
      contentType: z.string().optional().describe("Content type hint (e.g. 'page', 'program'). Omit to auto-detect from slug."),
      variant: z.string().optional().describe("Variant slug to write to (e.g. 'draft-v2'). Writes to {variantSlug}.{locale}.yml instead of the live locale file."),
      confirm_live_edit: z.boolean().optional().describe("Set to true to confirm you want to overwrite the live locale file directly when a versioning.yml exists. Required when no 'variant' is supplied and the page has active variants."),
      layout_target: layoutTargetSchema,
      confirm_layout_target: confirmLayoutTargetSchema,
      ...mutateReportZodFields,
      site: z.string().optional().describe(SITE_PARAM_DESC),
    },
    async ({ slug, locale, sections, meta, contentType, variant, confirm_live_edit, layout_target, confirm_layout_target, report, agent_session_id, site }) => {
      const siteResult = resolveSiteContext(site);
      if (!siteResult.ok) return siteFailResult(siteResult.error);
      const reportCheck = requireMutateReport(report);
      if (!reportCheck.ok) return reportCheck.result;
      const { trimmedReport } = reportCheck;
      const { contentPath, contentFolder, domain } = siteResult;
      try {
        assertSafeSegment(slug, "slug");
        assertSafeLocale(locale);
        if (contentType) assertSafeSegment(contentType, "contentType");
        if (variant) assertSafeSegment(variant, "variant");
      } catch (e) {
        return fail((e as Error).message);
      }

      const resolved = resolveContentType(slug, contentType, contentPath, { allowSharedLayout: true });
      if (!resolved) {
        return fail(`Page not found for slug '${slug}'${contentType ? ` (contentType: ${contentType})` : ""}`);
      }

      if (mcpToken) {
        if (!await checkCap(mcpToken, "content_edit_structure", resolved.contentType)) {
          return denyResponse("content_edit_structure", resolved.contentType);
        }
      }

      const liveGate = confirmLiveEditGate({
        tool: "replace_entry_sections",
        slug,
        contentType: resolved.contentType,
        locale,
        contentPath,
        variant,
        confirm_live_edit,
        extraArgsHint: { sections, meta, layout_target, confirm_layout_target },
      });
      if (liveGate) return liveGate;

      const layoutGate = resolveLayoutTargetGate({
        tool: "replace_entry_sections",
        contentType: resolved.contentType,
        config: resolved.config,
        slug,
        locale,
        layout_target: layout_target as LayoutTarget | undefined,
        confirm_layout_target,
        requireConfirmWhenAuto: true,
      });
      if ("gate" in layoutGate) return layoutGate.gate;
      const layoutTarget = layoutGate.target;

      const pathInfo = pathForLayoutTarget({
        contentPath,
        contentType: resolved.contentType,
        config: resolved.config,
        slug,
        locale,
        layoutTarget,
        variant,
      });
      try { assertWithinBase(pathInfo.filePath, contentPath); } catch (e) {
        return fail((e as Error).message);
      }
      if (!fs.existsSync(pathInfo.filePath)) {
        return fail(`File not found: ${pathInfo.relativeHint}`);
      }

      const relativePath = `${contentFolder}/${pathInfo.relativeHint}`;

      const currentData = safeLoad(fs.readFileSync(pathInfo.filePath, "utf-8")) || {};
      currentData.sections = sections;
      if (meta) {
        const existingMeta = (typeof currentData.meta === "object" && currentData.meta !== null && !Array.isArray(currentData.meta))
          ? currentData.meta as Record<string, unknown>
          : {};
        currentData.meta = { ...existingMeta, ...meta };
      }
      const intendedContent = safeDump(currentData);
      const conflictCheck = await checkRemoteConflict(relativePath, domain);
      if (conflictCheck.conflict) {
        return conflictError({
          relativePath,
          remoteContent: conflictCheck.remoteContent,
          intendedContent,
          intendedChange: { action: "replace_entry_sections", sectionsCount: sections.length, ...(meta ? { meta } : {}) },
        });
      }

      const operations: Record<string, unknown>[] = [{ action: "replace_all_sections", sections }];
      if (meta) {
        for (const [k, v] of Object.entries(meta)) {
          operations.push({ action: "update_field", path: `meta.${k}`, value: v });
        }
      }

      const apiResult = await callEditSectionsApi(
        {
          contentType: resolved.contentType,
          slug,
          locale,
          variant,
          layoutTarget,
          operations,
          report: trimmedReport,
          agent_session_id,
        },
        mcpToken,
        domain,
      );
      if ("error" in apiResult) return apiResult.error;

      const warnings: McpWarning[] = [
        REPLACE_NO_BINDING_FANOUT,
        UPDATED_AT_STAMP_WARNING,
        ...variantWarningsIfNeeded(variant),
      ];
      {
        const sessWarn = missingSessionWarning(agent_session_id);
        if (sessWarn) warnings.push(sessWarn);
      }
      appendSharedTemplateHtmlCacheWarning(warnings, apiResult.data, layoutTarget);
      let side_effects: McpSideEffect[] | undefined;
      let next_actions: NextAction[] = [];
      if (pathInfo.layer === "type_template") {
        const env = sharedStructuralEnvelope({
          tool: "replace_entry_sections",
          contentType: resolved.contentType,
          config: resolved.config,
          contentPath,
          sourceLocale: locale,
          relativePath: pathInfo.relativeHint,
          argsHintBase: { sections, meta, confirm_live_edit: true },
          reasonPrefix: "Shared layout sections were fully replaced.",
        });
        side_effects = env.side_effects;
        next_actions = env.next_actions;
      } else {
        next_actions = [{
          tool: "get_section_bindings",
          priority: "optional",
          reason: "Full replace does not sync bindings — inspect groups if bound section_ids may be stale.",
          args_hint: { contentType: resolved.contentType, slug, sectionIndex: 0, locale },
        }];
      }

      const articleHints = hintsAfterReplaceSections({
        sections: sections as Array<Record<string, unknown>>,
        slug,
        locale,
      });
      warnings.push(...articleHints.warnings);
      next_actions = [...next_actions, ...articleHints.next_actions];

      const modalHints = hintsAfterReplaceModals({
        sections: sections as Array<Record<string, unknown>>,
        slug,
        locale,
      });
      warnings.push(...modalHints.warnings);
      next_actions = [...next_actions, ...modalHints.next_actions];

      const stampEffect: McpSideEffect = {
        kind: "locale_yaml",
        summary: `Wrote ${pathInfo.relativeHint}; section copy/images stamp updated_at (layout-only replace does not).`,
      };
      side_effects = [...(side_effects || []), stampEffect];

      const parts: string[] = [`sections (${sections.length} item${sections.length !== 1 ? "s" : ""})`];
      if (meta) parts.push(`meta (${Object.keys(meta).length} field${Object.keys(meta).length !== 1 ? "s" : ""})`);
      return ok(
        {
          message: `Replaced ${parts.join(" and ")} in ${pathInfo.relativeHint}`,
          ...wrotePayload({
            layer: pathInfo.layer,
            contentType: resolved.contentType,
            path: pathInfo.relativeHint,
            locale,
            slug,
          }),
        },
        { warnings, next_actions, side_effects },
      );
    }
  );

  // translate_entry
  mcp.tool(
    "translate_entry",
    "Write translated content for a target locale. Does NOT perform AI translation — supply the translated payload.\n\n" +
    "Modes (from entry state, not a detach flag):\n" +
    "- attached shared-layout: locale field_mapping keys + optional meta; sections omit or []. Shell stays on template.{locale}.yml.\n" +
    "- detached shared-layout or classic page: non-empty sections for new/full shell (fields optional); fields-only merges preserve existing sections.\n" +
    "New target locale: always writes draft.{locale}.yml (not public). Promote/publish validates URL uniqueness.\n" +
    "Optional url_slug sets this locale's public URL segment (defaults to entry identity). Do not pass content.slug or content.url — use url_slug.\n" +
    "Existing non-empty live: merges fields only; fails if url_slug would change the live URL (use update_fields slug + create_redirect for renames).\n" +
    "Custom shell ownership: set_entry_attachment (not this tool). Tiny field tweaks on existing locales: update_fields is fine.\n" +
    "Go live with promote_variant or publish_draft (confirm with the user first).\n" +
    GITHUB_COMMIT_TOOL_BLURB,
    {
      slug: z.string().describe("Page slug of the page to translate"),
      contentType: z.string().optional().describe("Content type hint (e.g. 'page', 'program', 'authors'). Omit to auto-detect from slug."),
      source_locale: z.string().describe("The locale code of the existing source file used for validation, e.g. 'en'"),
      target_locale: z.string().describe("The locale code to write the translated content to, e.g. 'es' or 'fr'"),
      content: z.record(z.unknown()).describe(
        "Translated payload. Attached: field keys (bio, title, content, …) + optional meta; sections [] or omit. " +
        "Detached/classic: sections[] for shell translate; or fields-only to merge into an existing locale (preserves sections). " +
        "Do not include slug or url — use top-level url_slug.",
      ),
      url_slug: z.string().optional().describe(
        "Optional public URL slug for the target locale (kebab-case). Omitted on merge keeps existing locale slug; omitted on new draft defaults to entry identity.",
      ),
      site: z.string().optional().describe(SITE_PARAM_DESC),
      confirm_new_values: z.boolean().optional().describe(
        "Set true after principal approval when category uses a slug not yet seen on target-locale peers.",
      ),
    },
    async ({ slug, contentType, source_locale, target_locale, content, url_slug, site, confirm_new_values }) => {
      const siteResult = resolveSiteContext(site);
      if (!siteResult.ok) return siteFailResult(siteResult.error);
      const { contentPath, contentFolder, domain } = siteResult;
      try {
        assertSafeSegment(slug, "slug");
        assertSafeLocale(source_locale);
        assertSafeLocale(target_locale);
        if (contentType) assertSafeSegment(contentType, "contentType");
      } catch (e) {
        return fail((e as Error).message);
      }

      if (source_locale === target_locale) {
        return fail(`source_locale and target_locale must be different (both are '${source_locale}').`);
      }

      const resolved = resolveContentType(slug, contentType, contentPath);
      if (!resolved) {
        return fail(`Page not found for slug '${slug}'${contentType ? ` (contentType: ${contentType})` : ""}`);
      }

      if (mcpToken) {
        if (!await checkCap(mcpToken, "content_edit_text", resolved.contentType)) {
          return denyResponse("content_edit_text", resolved.contentType);
        }
      }

      const { isEntryDetached, isSharedLayoutType } = await import("../../server/shared-layout-entry.js");
      const {
        convertEmptyLiveLocaleToDraft,
        ensureDraftVariantInVersioning,
      } = await import("../../server/convert-empty-locale-to-draft.js");
      const { isEmptyDetachedLocaleEntry } = await import("../../server/empty-locale.js");
      const { isEmptyLocaleContent } = await import("../../shared/isEmptyLocaleContent.js");
      const { assertLiveEntrySeoAndRequiredFields } = await import("../../server/live-entry-seo-gate.js");
      const { contentIndex } = await import("../../server/content-index.js");
      const {
        resolveLocaleUrlSlug,
        validateLocaleUrlSlugFormat,
      } = await import("../../server/locale-url-slug.js");

      const sharedLayout = isSharedLayoutType(resolved.contentType, contentPath);
      const detached = isEntryDetached(resolved.contentType, slug, contentPath);
      const mode = resolveTranslateMode({ sharedLayout, detached });

      const split = splitTranslateContent(content as Record<string, unknown>);
      if (split.reservedUrlKeys.length > 0) {
        return fail(
          `Do not pass ${split.reservedUrlKeys.join(" or ")} in content. Use top-level url_slug instead.`,
          { code: "use_url_slug_instead", keys: split.reservedUrlKeys },
        );
      }
      if (url_slug !== undefined) {
        const formatErr = validateLocaleUrlSlugFormat(url_slug.trim());
        if (formatErr) return fail(formatErr, { code: "invalid_url_slug" });
      }
      const { allowed: allowedFields, rejected } = filterAllowedFields(split.fields, resolved.config);

      if (mode === "attached_fields" && Array.isArray(split.sections) && split.sections.length > 0) {
        const siteHint = site ? { site } : {};
        return actionRequired(
          {
            success: false,
            action_required: "shared_layout_sections_must_be_empty",
            code: "shared_layout_sections_must_be_empty",
            message:
              "Attached shared-layout translate must use sections: [] (or omit sections). " +
              "Put translated body in locale fields. For a custom per-entry shell, call set_entry_attachment " +
              'with action: "detach" and confirm: true, then retry translate_entry with sections.',
            contentType: resolved.contentType,
            slug,
            mode,
          },
          [
            {
              tool: "translate_entry",
              reason: "Retry with field_mapping keys and sections: [] (or omit sections)",
              args_hint: {
                slug,
                contentType: resolved.contentType,
                source_locale,
                target_locale,
                content: { ...allowedFields, ...(split.meta ? { meta: split.meta } : {}), sections: [] },
                ...siteHint,
              },
              priority: "required",
            },
            {
              tool: "set_entry_attachment",
              reason: "Only if this entry needs a custom shell — then retry translate_entry with sections",
              args_hint: {
                contentType: resolved.contentType,
                slug,
                action: "detach",
                confirm: true,
                ...siteHint,
              },
              priority: "optional",
            },
          ],
        );
      }

      const ctDir = getDirectory(resolved.contentType, resolved.config);
      const dir = path.join(contentPath, ctDir, slug);

      const sourceFilePath = path.join(dir, `${source_locale}.yml`);
      try { assertWithinBase(sourceFilePath, contentPath); } catch (e) {
        return fail((e as Error).message);
      }
      if (!fs.existsSync(sourceFilePath)) {
        const draftSource = path.join(dir, `draft.${source_locale}.yml`);
        if (!fs.existsSync(draftSource)) {
          return fail(`Source locale '${source_locale}' not found for page '${slug}'`);
        }
      }

      const liveTargetPath = path.join(dir, `${target_locale}.yml`);
      const draftTargetPath = path.join(dir, `draft.${target_locale}.yml`);
      try { assertWithinBase(liveTargetPath, contentPath); } catch (e) {
        return fail((e as Error).message);
      }

      let writeAsDraft = false;
      let reason = "live_locale_refresh";
      let autoConverted = false;

      const liveExists = fs.existsSync(liveTargetPath);
      let liveNonEmpty = false;
      if (liveExists) {
        if (
          isEmptyDetachedLocaleEntry({
            contentType: resolved.contentType,
            slug,
            locale: target_locale,
            contentRoot: contentPath,
            ci: contentIndex,
          })
        ) {
          liveNonEmpty = false;
        } else {
          try {
            const mergedLive = contentIndex.loadMergedContent(resolved.contentType, slug, target_locale);
            liveNonEmpty = !isEmptyLocaleContent((mergedLive?.data ?? {}) as Record<string, unknown>);
          } catch {
            liveNonEmpty = true;
          }
        }
      }

      if (!liveNonEmpty) {
        if (liveExists) {
          const converted = convertEmptyLiveLocaleToDraft({
            contentType: resolved.contentType,
            slug,
            locale: target_locale,
            contentRoot: contentPath,
            ci: contentIndex,
            author: "mcp-translate_entry",
          });
          autoConverted = !!converted;
          reason = converted ? "empty_live_converted_to_draft" : "new_locale_starts_as_draft";
        } else {
          reason = "new_locale_starts_as_draft";
        }
        writeAsDraft = true;
      }

      const targetFileName = writeAsDraft ? `draft.${target_locale}.yml` : `${target_locale}.yml`;
      const targetFilePath = writeAsDraft ? draftTargetPath : liveTargetPath;
      const targetRelPath = `${contentFolder}/${ctDir}/${slug}/${targetFileName}`;

      const existing = fs.existsSync(targetFilePath)
        ? (safeLoad(fs.readFileSync(targetFilePath, "utf-8")) as Record<string, unknown> | null)
        : null;
      const mergeIntoExisting = !!existing;

      const existingLocaleSlug =
        existing && typeof existing.slug === "string" ? existing.slug : null;
      const liveLocaleSlug = liveNonEmpty && liveExists
        ? (() => {
            try {
              const raw = safeLoad(fs.readFileSync(liveTargetPath, "utf-8")) as Record<string, unknown> | null;
              return typeof raw?.slug === "string" ? raw.slug : null;
            } catch {
              return null;
            }
          })()
        : null;

      const localeUrlSlug = resolveLocaleUrlSlug({
        urlSlug: url_slug,
        existingSlug: mergeIntoExisting ? existingLocaleSlug : null,
        entryIdentity: slug,
      });

      if (liveNonEmpty && url_slug !== undefined) {
        const currentPublicSlug = resolveLocaleUrlSlug({
          existingSlug: liveLocaleSlug,
          entryIdentity: slug,
        });
        if (localeUrlSlug !== currentPublicSlug) {
          return fail(
            `Cannot change live locale URL slug via translate_entry (${currentPublicSlug} → ${localeUrlSlug}). ` +
            "Use update_fields with field_path slug and create_redirect when required.",
            {
              code: "live_slug_change_not_allowed",
              current_slug: currentPublicSlug,
              requested_slug: localeUrlSlug,
            },
          );
        }
      }

      const built = buildTranslateLocaleData({
        mode,
        localeUrlSlug,
        targetLocale: target_locale,
        meta: split.meta,
        sections: split.sections,
        allowedFields,
        existing,
        writeAsDraft,
        mergeIntoExisting,
      });
      if (!built.ok) {
        return fail(built.message, { code: built.code, mode, path: `${ctDir}/${slug}/${targetFileName}` });
      }
      const localeData = built.localeData;

      const urlParams = listExtraUrlPatternParams(resolved.config.url_pattern);
      for (const param of urlParams) {
        const paramValue = extractParamSlug(localeData[param]);
        if (paramValue) {
          const peerGate = validateUrlParamPeerValues(
            contentPath,
            resolved.contentType,
            resolved.config,
            { [target_locale]: { [param]: paramValue } },
            confirm_new_values,
          );
          if (peerGate) {
            return actionRequired(
              {
                success: false,
                action_required: "confirm_new_url_param_value",
                code: "confirm_new_url_param_value",
                message:
                  `URL param '${param}' value '${paramValue}' for ${target_locale} is not used by any ${target_locale} peer. ` +
                  "Pick an observed slug for the target locale or get principal approval.",
                ...peerGate,
                contentType: resolved.contentType,
                slug,
              },
              [
                {
                  tool: "translate_entry",
                  reason: "Retry with confirm_new_values: true or a peer URL param for the target locale",
                  args_hint: { slug, contentType: resolved.contentType, source_locale, target_locale, content, confirm_new_values: true, site },
                  priority: "required",
                },
                {
                  tool: "get_content_type_info",
                  reason: `Inspect observed_values_by_locale.${param}`,
                  args_hint: { contentType: resolved.contentType, site },
                  priority: "recommended",
                },
              ],
            );
          }
        } else if (!mergeIntoExisting) {
          return actionRequired(
            {
              success: false,
              action_required: "missing_url_param_on_translate",
              code: "missing_url_param_on_translate",
              message:
                `Translate to ${target_locale} requires URL param '${param}' on the locale payload. ` +
                "Pick one from observed_values_by_locale for the target locale.",
              param,
              contentType: resolved.contentType,
              slug,
              target_locale,
            },
            [
              {
                tool: "get_content_type_info",
                reason: `Inspect observed_values_by_locale.${param}`,
                args_hint: { contentType: resolved.contentType, site },
                priority: "required",
              },
              {
                tool: "translate_entry",
                reason: `Retry with ${param} on content for the target locale`,
                args_hint: { slug, contentType: resolved.contentType, source_locale, target_locale, content: { ...content, [param]: "…" }, site },
                priority: "required",
              },
            ],
          );
        }
      }

      applyEditorialUpdatedAtToData({
        data: localeData,
        previous: existing && typeof existing === "object" ? (existing as Record<string, unknown>) : {},
        operations: operationsFromLocalePayload(localeData),
        contentType: resolved.contentType,
        slug,
        contentRoot: contentPath,
      });
      const intendedContent = safeDump(localeData);

      const commonPath = path.join(dir, "_common.yml");
      const common = fs.existsSync(commonPath)
        ? ((safeLoad(fs.readFileSync(commonPath, "utf-8")) as Record<string, unknown> | null) ?? {})
        : {};

      const warnings: McpWarning[] = [];
      if (rejected.length > 0) {
        warnings.push({
          code: "translate_fields_rejected",
          message: `Ignored disallowed field keys (not in editor/field_mapping safe set): ${rejected.join(", ")}.`,
        });
      }
      if (url_slug !== undefined && writeAsDraft) {
        warnings.push({
          code: "url_slug_on_draft",
          message:
            `Draft locale slug set to "${localeUrlSlug}". URL uniqueness is validated at promote/publish, not on draft write.`,
        });
      }
      if (writeAsDraft) {
        const missing = draftMissingRequiredWarnings(resolved.config, common, localeData);
        if (missing.length > 0) {
          warnings.push({
            code: "draft_missing_required_fields",
            message:
              `Draft is missing editor.required fields (ok until promote): ${missing.join(", ")}. ` +
              "Values on _common.yml count toward required.",
          });
        }
      }

      if (!writeAsDraft) {
        const gateErr = assertLiveEntrySeoAndRequiredFields({
          contentType: resolved.contentType,
          slug,
          locale: target_locale,
          pageData: localeData,
          contentRoot: contentPath,
          mode: "publish",
          intent: "publish",
          isDraftWrite: false,
        });
        if (gateErr) {
          return fail(gateErr, { code: "EMPTY_LOCALE_OR_REQUIRED", path: `${ctDir}/${slug}/${targetFileName}` });
        }
      }

      if (fs.existsSync(targetFilePath)) {
        const conflictCheck = await checkRemoteConflict(targetRelPath, domain);
        if (conflictCheck.conflict) {
          return conflictError({
            relativePath: targetRelPath,
            remoteContent: conflictCheck.remoteContent,
            intendedContent,
            intendedChange: { action: "translate_entry", source_locale, target_locale, mode },
          });
        }
      }

      const isNew = !fs.existsSync(targetFilePath);
      fs.writeFileSync(targetFilePath, intendedContent, "utf-8");
      const writeEventId = notifyMcpContentWrite(targetFilePath, mcpWriteAuthor(mcpToken));

      if (writeAsDraft) {
        ensureDraftVariantInVersioning({
          contentType: resolved.contentType,
          slug,
          locale: target_locale,
          contentRoot: contentPath,
          author: "mcp-translate_entry",
          variantSlug: "draft",
        });
      }

      const commitMsg = writeAsDraft
        ? `Draft translate ${resolved.contentType}/${slug} to ${target_locale}`
        : `Translate ${resolved.contentType}/${slug} to ${target_locale}`;
      const [commitResult] = await Promise.all([
        callCommitFilesApi([targetRelPath], commitMsg, mcpToken, domain),
        callRefreshCacheApi(resolved.contentType, domain),
      ]);

      const ghWarning = githubCommitWarning(commitResult);
      if (ghWarning) warnings.push(ghWarning);
      if (mode === "attached_fields") {
        warnings.push({
          code: "attached_shell_unchanged",
          message:
            "Entry remains attached. Shell still comes from template.{locale}.yml; this write did not bake or detach.",
        });
      }
      if (writeAsDraft) {
        warnings.push({
          code: "translation_not_public",
          message: `${targetFileName} is not in listings/sitemap/hreflang until promote_variant or publish_draft. Did not create live ${target_locale}.yml as a public locale.`,
        });
        if (mode === "detached_sections") {
          warnings.push({
            code: "empty_locale_blocked_on_promote",
            message: "Promote/publish fails if the detached locale would still be empty (no sections and no content).",
          });
        }
      }
      if (autoConverted) {
        warnings.push({
          code: "empty_live_auto_converted",
          message: `Empty live ${target_locale}.yml was moved to draft.${target_locale}.yml before writing the translation.`,
        });
      }
      if (built.merge) {
        warnings.push({
          code: "locale_merged",
          message: `Merged into existing ${targetFileName}; unrelated keys and preserved sections were kept where applicable.`,
        });
      }

      const next_actions: NextAction[] = writeAsDraft
        ? [
            {
              tool: "get_entry_content",
              reason: "Inspect the draft translation",
              args_hint: {
                slug,
                contentType: resolved.contentType,
                locale: target_locale,
                variant: "draft",
                ...(site ? { site } : {}),
              },
              priority: "recommended",
            },
            {
              tool: "run_entry_diagnostics",
              reason: "Validate before going live (async — then poll get_diagnostics_job)",
              args_hint: { slugs: [slug], freshness: "hard", confirm: true, ...(site ? { site } : {}) },
              priority: "recommended",
            },
            {
              tool: "promote_variant",
              reason: "Make this locale live when ready (confirm with user). Use publish_draft if the entry has no live locales yet.",
              args_hint: {
                contentType: resolved.contentType,
                slug,
                locale: target_locale,
                variantSlug: "draft",
                ...(site ? { site } : {}),
              },
              priority: "optional",
            },
          ]
        : [];

      const sectionsArr = Array.isArray(localeData.sections) ? localeData.sections : [];
      return ok(
        {
          message: writeAsDraft
            ? `Draft translation ${isNew ? "created" : "updated"} at ${resolved.contentType}/${slug}/${targetFileName}`
            : `Translated content ${isNew ? "created" : "updated"} at ${resolved.contentType}/${slug}/${targetFileName}`,
          slug,
          locale_url_slug: localeUrlSlug,
          contentType: resolved.contentType,
          source_locale,
          target_locale,
          mode,
          created: isNew,
          live: !writeAsDraft,
          layer: writeAsDraft ? "draft_locale" : "entry_locale",
          reason,
          merge: built.merge,
          sectionsCount: sectionsArr.length,
          metaKeys: localeData.meta && typeof localeData.meta === "object"
            ? Object.keys(localeData.meta as object)
            : [],
          ...(commitResult.queued ? { queued: true } : {}),
          ...(commitResult.commitSha ? { commitSha: commitResult.commitSha } : {}),
          ...wrotePayload({
            layer: writeAsDraft ? "variant" : "entry_locale",
            contentType: resolved.contentType,
            path: `${ctDir}/${slug}/${targetFileName}`,
            locale: target_locale,
            slug,
          }),
        },
        {
          warnings,
          next_actions,
          side_effects: writeAsDraft
            ? [{
                kind: "wrote_draft_locale",
                summary: `Wrote ${targetFileName} + versioning 0%; did not publish live ${target_locale}.yml`,
              }]
            : [{
                kind: "merged_live_locale",
                summary: `Updated live ${targetFileName} (${built.merge ? "merge" : "write"})`,
              }],
        },
      );
    }
  );

  // set_entry_attachment — detach / reattach shared-layout shell ownership
  mcp.tool(
    "set_entry_attachment",
    "Change whether a shared-layout entry owns its page shell.\n\n" +
    'action "detach": bake template.{locale}.yml into every existing live {locale}.yml and set detached: true. ' +
    "Does not invent missing sibling locales. Not required for field translation (use translate_entry while attached) " +
    "or local section overlays (layout_target: entry).\n\n" +
    'action "reattach": strip entry sections/layout, clear detached, delete entry versioning/variants (lossy). ' +
    "Field data kept.\n\n" +
    "confirm omitted or false → preview only (action_required). confirm: true → execute. Cap: content_edit_structure.\n" +
    GITHUB_COMMIT_TOOL_BLURB,
    {
      contentType: z.string().describe("Shared-layout content type, e.g. 'blog' or 'authors'"),
      slug: z.string().describe("Entry slug"),
      action: z.enum(["detach", "reattach"]).describe('detach = bake shell onto entry; reattach = return to shared single template'),
      confirm: z.boolean().optional().describe("Must be true to execute; omit or false returns a confirm_* preview"),
      locale: z.string().optional().describe("Locale for reattach loss preview (default en)"),
      site: z.string().optional().describe(SITE_PARAM_DESC),
    },
    async ({ contentType, slug, action, confirm, locale, site }) => {
      const siteResult = resolveSiteContext(site);
      if (!siteResult.ok) {
        return siteFailResult(siteResult.error, "set_entry_attachment", {
          contentType, slug, action, confirm, locale,
        });
      }
      const { contentPath, contentFolder, domain } = siteResult;
      const previewLocale = locale || "en";
      try {
        assertSafeSegment(contentType, "contentType");
        assertSafeSegment(slug, "slug");
        assertSafeLocale(previewLocale);
      } catch (e) {
        return fail((e as Error).message);
      }

      if (mcpToken) {
        if (!await checkCap(mcpToken, "content_edit_structure", contentType)) {
          return denyResponse("content_edit_structure", contentType);
        }
      }

      const { isEntryDetached, isSharedLayoutType } = await import("../../server/shared-layout-entry.js");
      const {
        detachEntry,
        reattachEntry,
        getReattachSectionLossPreview,
        ReattachRequiredFieldsError,
      } = await import("../../server/shared-layout-detach.js");

      if (!isSharedLayoutType(contentType, contentPath)) {
        return fail(
          `Content type "${contentType}" is not a shared-layout type. set_entry_attachment only applies to single_template / DB shared-layout types.`,
          { code: "not_shared_layout", contentType, slug },
        );
      }

      const configs = loadContentTypes(contentPath);
      const config = configs[contentType];
      if (!config) return fail(`Unknown contentType '${contentType}'`);
      const ctDir = getDirectory(contentType, config);
      const entryDir = path.join(contentPath, ctDir, slug);
      const siteHint = site ? { site } : {};
      const author = mcpToken ? getTokenUsername(mcpToken) : "mcp-set_entry_attachment";

      if (action === "detach") {
        if (isEntryDetached(contentType, slug, contentPath)) {
          return fail(`Entry "${slug}" is already detached.`, {
            code: "already_detached",
            contentType,
            slug,
          });
        }
        const liveLocales = listLiveLocaleFiles(entryDir, (p) => fs.readdirSync(p));
        if (liveLocales.length === 0) {
          return fail(
            `Cannot detach "${slug}": no live locale files found. Create a locale file first, then detach.`,
            { code: "no_live_locales", contentType, slug },
          );
        }

        if (confirm !== true) {
          return actionRequired(
            {
              success: false,
              action_required: "confirm_detach",
              code: "confirm_detach",
              message:
                `Detach will bake template.{locale}.yml into these live locale files: ${liveLocales.join(", ")}. ` +
                "Sets detached: true on _common.yml. Does not invent missing locales. " +
                "Not needed for field translation (translate_entry while attached) or layout_target: entry overlays.",
              contentType,
              slug,
              locales_to_bake: liveLocales,
              warnings: [
                {
                  code: "detach_no_invent_locales",
                  message: "Only existing live {locale}.yml files are baked; missing siblings are not created.",
                },
                {
                  code: "detach_not_for_field_translate",
                  message: "Use translate_entry with locale fields while attached for translations; detach only for a custom shell.",
                },
              ],
            },
            [
              {
                tool: "set_entry_attachment",
                reason: "Re-call with confirm: true to execute detach",
                args_hint: { contentType, slug, action: "detach", confirm: true, ...siteHint },
                priority: "required",
              },
            ],
          );
        }

        try {
          const result = detachEntry({
            contentType,
            slug,
            contentRoot: contentPath,
            author,
            // 9C: always all live locales — do not pass a subset
          });
          const relPaths = result.filesWritten.map((abs) => {
            const normalized = abs.replace(/\\/g, "/");
            const idx = normalized.indexOf(`${contentFolder}/`);
            if (idx >= 0) return normalized.slice(idx);
            // fallback: contentFolder/ctDir/slug/file
            return `${contentFolder}/${path.relative(contentPath, abs).replace(/\\/g, "/")}`;
          });
          const commitMsg = `Detach ${contentType}/${slug} from shared layout`;
          const [commitResult] = await Promise.all([
            callCommitFilesApi(relPaths, commitMsg, mcpToken, domain),
            callRefreshCacheApi(contentType, domain),
          ]);
          const warnings: McpWarning[] = [
            {
              code: "detach_no_invent_locales",
              message: "Only existing live locales were baked; missing siblings were not created.",
            },
            {
              code: "detach_shell_owned",
              message:
                "Entry now owns its shell. Shared template.* changes no longer apply. " +
                "translate_entry uses detached_sections mode. Section overlays previously used layout_target: entry — prefer entry-owned section tools now.",
            },
          ];
          const ghWarning = githubCommitWarning(commitResult);
          if (ghWarning) warnings.push(ghWarning);
          return ok(
            {
              message: `Detached ${contentType}/${slug}`,
              contentType,
              slug,
              action: "detach",
              detached: true,
              locales: result.locales,
              paths: relPaths,
              ...(commitResult.queued ? { queued: true } : {}),
              ...(commitResult.commitSha
                ? { commitSha: commitResult.commitSha, commitShas: [commitResult.commitSha] }
                : {}),
            },
            {
              warnings,
              next_actions: [
                {
                  tool: "get_entry_content",
                  reason: "Inspect baked sections on a live locale",
                  args_hint: {
                    contentType,
                    slug,
                    locale: result.locales[0] || "en",
                    ...siteHint,
                  },
                  priority: "recommended",
                },
              ],
              side_effects: [
                {
                  kind: "detached_entry",
                  summary: `Set detached: true; baked locales: ${result.locales.join(", ")}`,
                },
              ],
            },
          );
        } catch (e) {
          return fail((e as Error).message, { code: "detach_failed", contentType, slug });
        }
      }

      // reattach
      if (!isEntryDetached(contentType, slug, contentPath)) {
        return fail(`Entry "${slug}" is not detached.`, {
          code: "not_detached",
          contentType,
          slug,
        });
      }

      const preview = getReattachSectionLossPreview({
        contentType,
        slug,
        locale: previewLocale,
        contentRoot: contentPath,
      });

      if (confirm !== true) {
        return actionRequired(
          {
            success: false,
            action_required: "confirm_reattach",
            code: "confirm_reattach",
            message:
              "Reattach strips entry sections/layout, clears detached, and deletes entry versioning.yml + variant files " +
              "(including draft.{locale}.yml). Field/mapping data on locale and _common is kept. Shell returns to template.{locale}.yml.",
            contentType,
            slug,
            locale: previewLocale,
            sectionsThatWillBeLost: preview.sectionsThatWillBeLost,
            variantsThatWillBeLost: preview.variantsThatWillBeLost,
            hasLayoutOverride: preview.hasLayoutOverride,
            warnings: [
              {
                code: "reattach_lossy_structure",
                message:
                  "Custom sections, layout overrides, and draft/variant files listed in the preview will be permanently removed.",
              },
            ],
          },
          [
            {
              tool: "set_entry_attachment",
              reason: "Re-call with confirm: true after reviewing loss preview",
              args_hint: {
                contentType,
                slug,
                action: "reattach",
                confirm: true,
                locale: previewLocale,
                ...siteHint,
              },
              priority: "required",
            },
          ],
        );
      }

      try {
        const result = reattachEntry({
          contentType,
          slug,
          contentRoot: contentPath,
          author,
          confirm: true,
        });
        const relPaths = result.filesModified.map((abs) => {
          const normalized = abs.replace(/\\/g, "/");
          const idx = normalized.indexOf(`${contentFolder}/`);
          if (idx >= 0) return normalized.slice(idx);
          return `${contentFolder}/${path.relative(contentPath, abs).replace(/\\/g, "/")}`;
        });
        const commitMsg = `Reattach ${contentType}/${slug} to shared layout`;
        const [commitResult] = await Promise.all([
          callCommitFilesApi(relPaths, commitMsg, mcpToken, domain),
          callRefreshCacheApi(contentType, domain),
        ]);
        const warnings: McpWarning[] = [
          {
            code: "reattach_shell_shared",
            message:
              "Entry is attached again. Shell comes from template.{locale}.yml. translate_entry uses attached_fields mode.",
          },
        ];
        if (result.hadTrafficVariants) {
          warnings.push({
            code: "reattach_had_traffic_variants",
            message: "Entry had traffic-allocated variants that were removed on reattach.",
          });
        }
        const ghWarning = githubCommitWarning(commitResult);
        if (ghWarning) warnings.push(ghWarning);
        return ok(
          {
            message: `Reattached ${contentType}/${slug}`,
            contentType,
            slug,
            action: "reattach",
            detached: false,
            hadTrafficVariants: result.hadTrafficVariants,
            paths: relPaths,
            ...(commitResult.queued ? { queued: true } : {}),
            ...(commitResult.commitSha
              ? { commitSha: commitResult.commitSha, commitShas: [commitResult.commitSha] }
              : {}),
          },
          {
            warnings,
            next_actions: [
              {
                tool: "get_entry_content",
                reason: "Confirm fields remain and shell comes from shared single",
                args_hint: { contentType, slug, locale: previewLocale, ...siteHint },
                priority: "recommended",
              },
            ],
            side_effects: [
              {
                kind: "reattached_entry",
                summary: "Cleared detached; stripped structure; removed entry versioning/variants",
              },
            ],
          },
        );
      } catch (e) {
        if (e instanceof ReattachRequiredFieldsError) {
          const missing = e.missing_fields;
          const locales = Object.keys(e.per_locale).filter(
            (loc) => (e.per_locale[loc] || []).length > 0,
          );
          return actionRequired(
            {
              success: false,
              action_required: "fix_reattach_required_fields",
              code: e.code,
              message: e.message,
              contentType,
              slug,
              missing_fields: missing,
              per_locale: e.per_locale,
              warnings: [
                {
                  code: "reattach_does_not_seed_fields",
                  message:
                    "Reattach does not invent call_to_action / faq_entries / content from detached sections. Set Fields on each live locale first.",
                },
              ],
            },
            [
              {
                tool: "update_fields",
                reason:
                  "Fill attached-required fields on each failing live locale (see missing_fields), then retry set_entry_attachment",
                args_hint: {
                  contentType,
                  slug,
                  locale: locales[0] || previewLocale,
                  confirm_live_edit: true,
                  updates: missing
                    .map((m) => {
                      const parts = m.split(".");
                      const locale = parts[0];
                      const fieldPath = parts.slice(1).join(".");
                      const topField = fieldPath.split(".")[0] || fieldPath;
                      return {
                        field_path: topField,
                        value: `<non-empty schema-valid value for ${fieldPath} on locale ${locale}>`,
                      };
                    })
                    .filter(
                      (u, i, arr) =>
                        arr.findIndex((x) => x.field_path === u.field_path) === i,
                    ),
                  ...siteHint,
                },
                priority: "required" as const,
              },
              {
                tool: "set_entry_attachment",
                reason: "Retry reattach after Fields are filled",
                args_hint: {
                  contentType,
                  slug,
                  action: "reattach",
                  confirm: true,
                  locale: previewLocale,
                  ...siteHint,
                },
                priority: "required" as const,
              },
            ],
          );
        }
        return fail((e as Error).message, { code: "reattach_failed", contentType, slug });
      }
    },
  );

  mcp.tool(
    "get_section_bindings",
    "Read-only: look up the section-binding group for a section by contentType, slug, and sectionIndex. " +
    "Returns { group: null } when the section is not bound, or the enriched binding group with members. " +
    "Use after structural edits or update_fields when you need membership context. " +
    "Does not mutate content — binding content sync happens on live update_fields (single-section). Requires content_view.",
    {
      contentType: z.string().describe("Content type, e.g. 'page' or 'program'"),
      slug: z.string().describe("Page slug"),
      sectionIndex: z.number().int().describe("0-based section index on the page"),
      locale: z.string().default("en").describe("Locale code, e.g. 'en' or 'es'"),
      site: z.string().optional().describe(SITE_PARAM_DESC),
    },
    async ({ contentType, slug, sectionIndex, locale, site }) => {
      const viewDenied = await denyUnlessContentView(mcpToken, contentType, grants);
      if (viewDenied) return viewDenied;
      const siteResult = resolveSiteContext(site);
      if (!siteResult.ok) return siteFailResult(siteResult.error);
      const { domain } = siteResult;
      try {
        assertSafeSegment(contentType, "contentType");
        assertSafeSegment(slug, "slug");
        assertSafeLocale(locale);
      } catch (e) {
        return fail((e as Error).message);
      }

      try {
        const params = new URLSearchParams({
          contentType,
          slug,
          sectionIndex: String(sectionIndex),
          locale,
        });
        if (domain) params.set("__site", domain);
        const url = `http://localhost:${MAIN_SERVER_PORT}/api/bindings/section?${params}`;
        const res = await fetch(url, { headers: internalHeaders(mcpToken) });
        const data = await res.json() as Record<string, unknown>;
        if (!res.ok) {
          return fail((data.error as string) || `Server error: ${res.status}`);
        }
        return ok(
          { contentType, slug, sectionIndex, locale, ...data },
          { warnings: [], next_actions: [] },
        );
      } catch (e) {
        return fail(`Failed to fetch section bindings: ${(e as Error).message}`);
      }
    }
  );

  // delete_entries — bulk YAML entry delete with relation cascade (authors → blog.authors)
  mcp.tool(
    "delete_entries",
    "Best-effort bulk delete of static content-type entries. Without confirm:true returns preview " +
    "(dependents, needs_reassignment, blocked protected slugs). For authors, removing the last " +
    "pointer from blog.authors requires reassignments (map blogSlug → authorSlug[]); defaults to " +
    "4geeks-academy. Deleted author URLs 404. Does not soft-redirect. " +
    MULTI_SITE_TOOL_BLURB,
    {
      contentType: z.string().describe("Content type key, e.g. authors"),
      slugs: z.array(z.string()).min(1).describe("Entry slugs to delete"),
      confirm: z.boolean().optional().describe("Must be true to perform delete"),
      reassignments: z
        .record(z.array(z.string()))
        .optional()
        .describe("When last author would be cleared: blogSlug → replacement author slug[]"),
      report: z
        .string()
        .describe(AGENT_REPORT_MUTATE_DESC),
      agent_session_id: z
        .string()
        .optional()
        .describe("Optional. From agent_session start."),
      site: z.string().optional().describe(SITE_PARAM_DESC),
    },
    async ({ contentType, slugs, confirm, reassignments, report, agent_session_id, site }) => {
      const trimmedReport = typeof report === "string" ? report.trim() : "";

      const siteResult = resolveSiteContext(site);
      if (!siteResult.ok) {
        return siteFailResult(siteResult.error, "delete_entries", { contentType, slugs });
      }
      const { domain } = siteResult;
      if (!mcpToken || !(await checkCap(mcpToken, "content_delete_entry", contentType))) {
        return denyResponse("content_delete_entry", contentType);
      }
      try {
        const url = `http://localhost:${MAIN_SERVER_PORT}/api/content/delete-entries${
          domain ? `?__site=${encodeURIComponent(domain)}` : ""
        }`;
        if (confirm === true) {
          const trimmedReport = typeof report === "string" ? report.trim() : "";
          if (trimmedReport.length < 80) {
            return actionRequired(
              {
                success: false,
                action_required: "report_required",
                code: trimmedReport ? "report_too_short" : "report_required",
                message: "report required (min 80 characters) when confirm:true.",
              },
              [],
            );
          }
        }
        const trimmedReport = typeof report === "string" ? report.trim() : "";
        const res = await fetch(url, {
          method: "POST",
          headers: internalHeaders(mcpToken, { agentSessionId: agent_session_id }),
          body: JSON.stringify({
            contentType,
            slugs,
            confirm: confirm === true,
            reassignments,
            ...(trimmedReport ? { report: trimmedReport } : {}),
          }),
        });
        const data = (await res.json()) as Record<string, unknown>;
        if (!res.ok) {
          return fail((data.error as string) || `delete_entries failed: ${res.status}`, {
            details: data,
          });
        }
        if (confirm !== true) {
          const previewObj = data.preview as Record<string, unknown> | undefined;
          const linkBySlug = previewObj?.link_preview_by_slug as
            | Record<
                string,
                {
                  referrers?: Array<{ entryKey: string }>;
                  suggestions?: string[];
                  indexUpdatedAt?: string | null;
                }
              >
            | undefined;
          const referrersFlat: Array<{ slug: string; entryKey: string }> = [];
          const suggestions: string[] = [];
          if (linkBySlug) {
            for (const [slug, lp] of Object.entries(linkBySlug)) {
              for (const ref of lp.referrers ?? []) {
                referrersFlat.push({ slug, entryKey: ref.entryKey });
              }
              for (const s of lp.suggestions ?? []) {
                if (!suggestions.includes(s)) suggestions.push(s);
              }
            }
          }
          return actionRequired(
            {
              success: false,
              action_required: "confirm_delete",
              message: (data.message as string) || "Pass confirm:true to delete",
              preview: data.preview,
              referrers: referrersFlat,
              suggestions,
              tool: "delete_entries",
              ...(referrersFlat.length > 0
                ? {
                    warnings: [
                      {
                        code: "delete_referrer_links",
                        message: `${referrersFlat.length} CMS entry link(s) may break after delete — update sources or add redirects.`,
                      },
                    ],
                  }
                : {}),
            },
            [
              {
                tool: "delete_entries",
                reason: "Re-call with confirm:true and reassignments if needed",
                args_hint: {
                  contentType,
                  slugs,
                  confirm: true,
                  reassignments: reassignments ?? undefined,
                  site,
                },
                priority: "required",
              },
              {
                tool: "explain_site",
                reason: "Relation + authors delete contract",
                args_hint: { topic: "relation-fields" },
                priority: "recommended",
              },
              ...(referrersFlat.length > 0
                ? [
                    {
                      tool: "run_entry_diagnostics" as const,
                      reason: "Refresh link index after fixing survivor hrefs",
                      args_hint: { scope: "site", validators: ["site-link-index"] },
                      priority: "recommended" as const,
                    },
                  ]
                : []),
            ],
          );
        }
        return ok(
          {
            success: true,
            results: data.results,
            blocked: data.blocked,
            preview: data.preview,
          },
          {
            warnings: [
              ...(missingSessionWarning(agent_session_id)
                ? [missingSessionWarning(agent_session_id)!]
                : []),
              {
                code: "best_effort_bulk",
                message: "Best-effort bulk: check results[] per slug.",
              },
              {
                code: "listing_vs_page",
                message:
                  "Listings keep author pointers as slug[]; page/SSR hydrate via resolve-relations.",
              },
              {
                code: "protected_default_author",
                message: "Protected default author (4geeks-academy) is never deleted.",
              },
              ...(contentType === "authors"
                ? [
                    {
                      code: "blog_authors_cascade",
                      message:
                        "blog.authors arrays updated on _common.yml; empty posts reassigned (default 4geeks-academy).",
                    },
                  ]
                : [
                    {
                      code: "no_author_cascade",
                      message: "No author cascade for this content type.",
                    },
                  ]),
            ],
            side_effects: [
              {
                kind: "delete_entry_folder",
                summary: `${contentType}/<slug>/ removed; URL 404s`,
              },
              ...(contentType === "authors"
                ? [
                    {
                      kind: "cascade_blog_authors",
                      summary: "blog/<slug>/_common.yml authors: slug[] updated / reassigned",
                    },
                  ]
                : []),
            ],
            next_actions: [],
          },
        );
      } catch (e) {
        return fail(`delete_entries failed: ${(e as Error).message}`);
      }
    },
  );

  // get_content_type_info
  mcp.tool(
    "get_content_type_info",
    "Describe a content type from content-types.yml: db_backed vs single_template, field_mapping, editor, " +
    "url_pattern, strategy, extra URL params, observed peer values for those params, create_via, body_model, " +
    "and schema_org_requirements with coverage { present, missing_slugs } when declared. " +
    "For editor.type json fields, read editor.<field>.schema (JSON Schema) before writing values via " +
    "update_fields — schema is required and returned again on validation failure. " +
    "Call this before create_entry when unsure how a type works. Requires content_view. " +
    "When coverage shows missing_slugs, call ensure_content_type_schema_org to attach seeded companions. " +
    "When strategy is missing while required fields exist, call update_content_type. " +
    MULTI_SITE_TOOL_BLURB,
    {
      contentType: z.string().describe("Content type key, e.g. 'blog', 'program', 'page', 'lesson'"),
      site: z.string().optional().describe(SITE_PARAM_DESC),
    },
    async ({ contentType, site }) => {
      const viewDenied = await denyUnlessContentView(mcpToken, contentType, grants);
      if (viewDenied) return viewDenied;
      const siteResult = resolveSiteContext(site);
      if (!siteResult.ok) return siteFailResult(siteResult.error, "get_content_type_info", { contentType });
      const { contentPath, domain } = siteResult;
      try {
        assertSafeSegment(contentType, "contentType");
      } catch (e) {
        return fail((e as Error).message);
      }
      const configs = loadContentTypes(contentPath);
      const config = configs[contentType];
      if (!config) {
        return fail(`Unknown contentType '${contentType}'. Known: ${Object.keys(configs).join(", ")}`);
      }
      const urlParams = listExtraUrlPatternParams(config.url_pattern);
      const observed: Record<string, string[]> = {};
      const observedByLocale: Record<string, Record<string, string[]>> = {};
      for (const param of urlParams) {
        observedByLocale[param] = observeParamValuesByLocale(contentPath, contentType, config, param);
        observed[param] = [...new Set(Object.values(observedByLocale[param]).flat())].sort();
      }
      const editor = getEditorConfig(config);
      const relation_fields = Object.entries(editor || {})
        .filter(([, hint]) => hint && (hint as { type?: string }).type === "relation")
        .map(([field, hint]) => {
          const h = hint as {
            source?: string;
            value?: string;
            label?: string;
            multiple?: boolean;
            required?: boolean | "attached";
            description?: string;
            type?: string;
          };
          const system_hints = buildEditorSystemHints(field, h as Parameters<typeof buildEditorSystemHints>[1]);
          return {
            field,
            source: h.source || null,
            value: h.value || "slug",
            label: h.label || "name",
            multiple: !!h.multiple,
            required: h.required === true || h.required === "attached" ? h.required : false,
            description: h.description || null,
            fill_intent: (hint as { fill_intent?: unknown }).fill_intent ?? null,
            system_hints: system_hints ?? [],
            storage_note:
              "Static types: relation values write to _common.yml. Pointers only (string|string[]); never Person JSON.",
            resolve_note:
              "Listings keep pointers; page/SSR hydrate via server/resolve-relations.ts",
          };
        });
      const createVia = createViaForConfig(config);
      const next_actions: NextAction[] = [];
      if (createVia === "create_entry") {
        next_actions.push({
          tool: "create_entry",
          reason: "Create a new entry of this type (pass site in multi-site)",
          args_hint: { contentType, site },
          priority: "optional",
        });
      }
      if (isSharedLayoutConfig(config)) {
        next_actions.push({
          tool: "explain_site",
          reason: "Read shared-layout playbook",
          args_hint: { topic: "shared-layout" },
          priority: "recommended",
        });
      }

      const requiredModes = editorRequiredModes(config);
      const hasRequiredField = Object.values(requiredModes).some(
        (m) => m === true || m === "attached",
      );
      const strategyRaw = (config as { strategy?: unknown }).strategy ?? null;
      const strategyParsed = parseContentTypeStrategy(strategyRaw);
      const strategy_valid = strategyParsed !== null;
      if (hasRequiredField && !strategy_valid) {
        next_actions.push({
          tool: "update_content_type",
          reason:
            "Type has required fields but strategy is missing/invalid — set strategy.purpose before editing required fields",
          args_hint: { contentType, site, strategy: { purpose: "…" } },
          priority: "required",
        });
      }

      next_actions.push({
        tool: "update_content_type",
        reason:
          "Add/update/remove one schema field via field_action (preview then confirm:true). Requires content_types_manage.",
        args_hint: { contentType, site, field_action: "add", field_key: "…" },
        priority: "optional",
      });

      const schema_org_requirements = Array.isArray(
        (config as { schema_org_requirements?: Array<{ schema_type: string }> }).schema_org_requirements,
      )
        ? (config as { schema_org_requirements: Array<{ schema_type: string }> }).schema_org_requirements
        : [];

      let schema_org_coverage: Array<Record<string, unknown>> = [];
      if (schema_org_requirements.length > 0) {
        try {
          const q = domain ? `?__site=${encodeURIComponent(domain)}` : "";
          const res = await fetch(
            `http://localhost:${MAIN_SERVER_PORT}/api/content-types/${encodeURIComponent(contentType)}/schema-org-coverage${q}`,
          );
          if (res.ok) {
            const data = (await res.json()) as { coverage?: Array<Record<string, unknown>> };
            schema_org_coverage = Array.isArray(data.coverage) ? data.coverage : [];
          }
        } catch {
          // Fall back to local helper when main server is down
          try {
            const { getSchemaOrgRequirementCoverage } = await import(
              "../../server/schema-org-requirements.js"
            );
            schema_org_coverage = schema_org_requirements.map((r) =>
              getSchemaOrgRequirementCoverage(contentType, r.schema_type, contentPath),
            );
          } catch {
            schema_org_coverage = [];
          }
        }
        const missing = schema_org_coverage.flatMap((c) =>
          Array.isArray(c.missing_slugs) ? (c.missing_slugs as string[]) : [],
        );
        if (missing.length > 0) {
          next_actions.push({
            tool: "ensure_content_type_schema_org",
            reason: "Attach seeded schema_org companions on missing entries",
            args_hint: {
              contentType,
              schema_type: schema_org_requirements[0]?.schema_type,
              site,
            },
            priority: "recommended",
          });
        }
      }

      return {
        content: [{
          type: "text",
          text: JSON.stringify({
            contentType,
            directory: getDirectory(contentType, config),
            db_backed: isDbBacked(config),
            single_template: !!config.single_template,
            shared_layout: isSharedLayoutConfig(config),
            url_pattern: config.url_pattern ?? null,
            url_params: urlParams,
            field_mapping: config.field_mapping ?? null,
            editor,
            editor_required_modes: editorRequiredModes(config),
            strategy: strategyParsed,
            strategy_valid,
            strategy_note:
              "Type-level purpose/constraints for staff/agents. Context only for field fill_intent — does not replace per-field briefs. " +
              "Any editor.required true|attached requires a valid strategy (non-empty purpose). " +
              "Clear rejected while required fields remain (code: missing_strategy). " +
              "Not insights_intent. Patch via update_content_type (strategy-only call, separate from field_action).",
            field_patch_note:
              "Schema fields: MCP update_content_type with field_action add|update|remove (one field per call). " +
              "Preview (omit confirm) then confirm:true after principal approval. " +
              "Static add defaults identity mapping; DB add requires field_mapping. " +
              "remove blocked while field is in indexes or unique_fields. " +
              "Does not backfill entry values — use update_fields after add.",
            fill_intent_goal_presets: FILL_INTENT_GOAL_PRESET_OPTIONS.map((o) => ({
              value: o.value,
              title: o.title,
              description: o.description,
            })),
            fill_intent_note:
              "Every editor.required true|attached field must have fill_intent { goal (open string), purpose, constraints? }. " +
              "Presets are suggestions only (use value as goal; title/description are staff/agent hints); custom goals allowed. " +
              "Read purpose before update_fields on required fields. Prefer fill_intent.purpose over editor.*.description " +
              "(Description is no longer edited in Field Settings and is cleared on Apply; legacy keys may remain until then). " +
              "Content type must also have strategy.purpose (see strategy / update_content_type).",
            relation_fields,
            protected_slugs: (config as { protected_slugs?: string[] }).protected_slugs ?? [],
            indexes: config.indexes ?? [],
            observed_values: observed,
            observed_values_by_locale: observedByLocale,
            observed_values_note:
              "For URL pattern params, use observed_values_by_locale — pick a slug from the target locale list, not the flat union.",
            create_via: createVia,
            create_via_note: createVia
              ? "Use create_entry (YAML). Shared-layout: one locale, sections []."
              : "Database-backed — create_entry cannot create rows; use DB/admin path.",
            body_model: bodyModelForConfig(config),
            template_vars_note: templateVarsNoteForBodyModel(bodyModelForConfig(config)),
            ecommerce: ecommerceManager.contentTypeHasEcommerce(contentType)
              ? {
                  enabled: true,
                  system_fields: [PURCHASABLE_FIELD],
                  description:
                    "This type has at least one product in the ecommerce index (sidecar _ecommerce.yml with purchasable: true). Catalog lead forms should set source.query to purchasable=true unless this is a non-purchasable program page (use source.related_field or query slug=<this>). Confirm subsets with the user. purchasable is computed — do not write it. actively_selling on _ecommerce.yml pauses the store; it is not the form filter. source.value_path and source.label_path are required; do not guess them.",
                }
              : {
                  enabled: false,
                  system_fields: [] as string[],
                },
            schema_org_requirements,
            coverage: schema_org_coverage[0]
              ? {
                  schema_type: schema_org_coverage[0].schema_type,
                  present: schema_org_coverage[0].present,
                  total: schema_org_coverage[0].total,
                  missing_slugs: schema_org_coverage[0].missing_slugs,
                }
              : schema_org_requirements.length === 0
                ? null
                : { present: 0, missing_slugs: [], total: 0 },
            coverage_by_schema_type: schema_org_coverage.map((c) => ({
              schema_type: c.schema_type,
              present: c.present,
              total: c.total,
              missing_slugs: c.missing_slugs,
            })),
            next_actions,
          }, null, 2),
        }],
      };
    }
  );

  const fillIntentSchema = z.object({
    goal: z.string(),
    purpose: z.string(),
    constraints: z.array(z.string()).optional(),
  });

  const editorHintSchema = z.object({
    type: z.string().optional(),
    options: z
      .array(z.union([z.string(), z.object({ value: z.string(), label: z.string() })]))
      .optional(),
    populate_options: z.boolean().optional(),
    allow_custom_values: z.boolean().optional(),
    split_comma_values: z.boolean().optional(),
    cache_images: z.boolean().optional(),
    description: z.string().optional(),
    required: z.union([z.boolean(), z.literal("attached")]).optional(),
    fill_intent: fillIntentSchema.optional(),
    schema: z.record(z.unknown()).optional(),
    source: z.string().optional(),
    value: z.string().optional(),
    label: z.string().optional(),
    multiple: z.boolean().optional(),
  });

  const fieldMappingEntrySchema = z.union([
    z.string(),
    z.object({
      source: z.string(),
      default: z.union([z.string(), z.null()]),
    }),
  ]);

  // update_content_type — strategy, one field, or shared-layout enable/disable
  mcp.tool(
    "update_content_type",
    "Patch content-types.yml for one content type via the main server config API.\n\n" +
    "Modes (one per call — do not combine):\n" +
    "• strategy — { purpose, constraints? } or null to clear.\n" +
    "• field_action add|update|remove — one schema field at a time (GET-merge-PUT; sibling fields preserved).\n" +
    "• single_template true|false — enable/disable shared layout. Enabling requires template_mode " +
    "keep_existing|from_entry; from_entry needs template_entry_source_slug (and template_entry_source_locale " +
    "when that entry folder has multiple live locales). Replacing a usable template.*.yml needs confirm:true " +
    "(omit confirm first for action_required preview). Writes canonical template.{locale}.yml.\n\n" +
    "Field patches: omit confirm or confirm:false → preview (action_required: confirm_field_change). " +
    "confirm:true → execute (fresh read before write). Preview-first recommended for human approval; confirm:true without preview is allowed.\n\n" +
    "Static types: add defaults identity mapping { source: field_key, default: null }. DB-backed: field_mapping required on add.\n" +
    "Relation editor requires source (content type or database slug); CT/DB name collisions rejected.\n" +
    "required true|attached needs fill_intent + valid type strategy (separate strategy call first).\n" +
    "remove blocked while field_key is in indexes or unique_fields — clear in Content Type manage first.\n" +
    "Does not edit entry YAML (except when from_entry bootstraps template.*.yml), run backfill, or schema_org ensure. " +
    "Requires content_types_manage. Call get_content_type_info first. " +
    MULTI_SITE_TOOL_BLURB,
    {
      contentType: z.string().describe("Content type key, e.g. 'blog', 'program', 'location'"),
      strategy: z
        .union([
          z.object({
            purpose: z.string().describe("Non-empty type-level purpose brief"),
            constraints: z.array(z.string()).optional().describe("Optional constraint strings"),
          }),
          z.null(),
        ])
        .optional()
        .describe(
          "Set strategy object, or null to clear. Omit to leave unchanged. Mutually exclusive with field_action / single_template.",
        ),
      field_action: z
        .enum(["add", "update", "remove"])
        .optional()
        .describe("Patch one field on field_mapping/editor. Mutually exclusive with strategy / single_template."),
      field_key: z
        .string()
        .optional()
        .describe("Schema field name, e.g. related_author. Required when field_action is set."),
      field_mapping: fieldMappingEntrySchema
        .optional()
        .describe("Mapping entry for this field only (add/update). DB-backed add requires this."),
      editor: editorHintSchema
        .optional()
        .describe("Editor hint for this field only (add/update). Partial merge on update."),
      single_template: z
        .boolean()
        .optional()
        .describe(
          "Enable (true) or disable (false) shared layout. Mutually exclusive with strategy / field_action.",
        ),
      template_mode: z
        .enum(["keep_existing", "from_entry"])
        .optional()
        .describe(
          "Required when single_template:true enables shared layout. keep_existing needs a usable template.*.yml; from_entry needs template_entry_source_slug.",
        ),
      template_entry_source_slug: z
        .string()
        .optional()
        .describe("Entry folder slug whose sections seed template.{locale}.yml when template_mode is from_entry."),
      template_entry_source_locale: z
        .string()
        .optional()
        .describe(
          "Required when the source entry has more than one live locale file. Omitted when only one locale exists.",
        ),
      shared_layout_base_locale: z
        .string()
        .optional()
        .describe("Locale used to align sibling template shells (default: source locale or en)."),
      confirm: z
        .boolean()
        .optional()
        .describe(
          "Field patches and template replace: false/omit → preview; true → execute. Strategy patches ignore confirm.",
        ),
      site: z.string().optional().describe(SITE_PARAM_DESC),
    },
    async ({
      contentType,
      strategy,
      field_action,
      field_key,
      field_mapping,
      editor,
      single_template,
      template_mode,
      template_entry_source_slug,
      template_entry_source_locale,
      shared_layout_base_locale,
      confirm,
      site,
    }) => {
      const siteResult = resolveSiteContext(site);
      if (!siteResult.ok) {
        return siteFailResult(siteResult.error, "update_content_type", { contentType });
      }
      const { domain, contentPath } = siteResult;
      try {
        assertSafeSegment(contentType, "contentType");
      } catch (e) {
        return fail((e as Error).message);
      }
      if (mcpToken && !(await checkCap(mcpToken, "content_types_manage"))) {
        return denyResponse("content_types_manage");
      }

      const hasStrategy = strategy !== undefined;
      const hasFieldPatch = field_action !== undefined;
      const hasSharedToggle = single_template !== undefined;
      const modeCount = [hasStrategy, hasFieldPatch, hasSharedToggle].filter(Boolean).length;

      if (modeCount > 1) {
        return fail(
          "Provide exactly one of: strategy, field_action, or single_template in one call.",
          { code: "ambiguous_patch" },
        );
      }
      if (modeCount === 0) {
        return fail(
          "No patch keys provided. Use strategy, field_action + field_key, or single_template.",
          { allowlisted: ["strategy", "field_action", "single_template"], code: "empty_patch" },
        );
      }

      if (hasFieldPatch) {
        if (!field_action) {
          return fail("field_action is required.", { code: "invalid_field_action" });
        }
        return runContentTypeFieldPatch({
          contentType,
          field_action,
          field_key: field_key ?? "",
          field_mapping: field_mapping as import("../lib/content-type-field-patch.js").FieldMappingEntry | undefined,
          editor: editor as ContentTypeEditorHint | undefined,
          confirm,
          site,
          domain,
          contentPath,
          mcpToken,
          mainServerPort: MAIN_SERVER_PORT,
          internalHeaders,
        });
      }

      const q = domain ? `?__site=${encodeURIComponent(domain)}` : "";
      const ymlPath = `${path.basename(contentPath)}/content-types.yml`;

      if (hasSharedToggle) {
        const body: Record<string, unknown> = { single_template: !!single_template };
        if (single_template === true) {
          if (template_mode) body.template_mode = template_mode;
          if (template_entry_source_slug) {
            body.template_entry_source_slug = template_entry_source_slug;
          }
          if (template_entry_source_locale) {
            body.template_entry_source_locale = template_entry_source_locale;
          }
          if (shared_layout_base_locale) {
            body.shared_layout_base_locale = shared_layout_base_locale;
          }
          if (confirm === true) body.confirm = true;
        }
        try {
          const res = await fetch(
            `http://localhost:${MAIN_SERVER_PORT}/api/content-types/${encodeURIComponent(contentType)}/config${q}`,
            {
              method: "PUT",
              headers: { ...internalHeaders(mcpToken), "Content-Type": "application/json" },
              body: JSON.stringify(body),
            },
          );
          const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
          if (!res.ok) {
            if (data.code === "confirm_template_replace" && data.preview) {
              return actionRequired(
                {
                  action_required: "confirm_template_replace",
                  message: String(
                    data.error ?? "Confirm replacing the existing usable shared template.",
                  ),
                  contentType,
                  preview: data.preview,
                },
                [
                  {
                    tool: "update_content_type",
                    reason: "Re-call with the same args and confirm: true after principal approval",
                    args_hint: {
                      contentType,
                      single_template: true,
                      template_mode: template_mode ?? "from_entry",
                      template_entry_source_slug,
                      template_entry_source_locale,
                      shared_layout_base_locale,
                      confirm: true,
                      site,
                    },
                    priority: "required",
                  },
                ],
              );
            }
            if (data.code === "template_entry_source_locale_required") {
              return actionRequired(
                {
                  action_required: "template_entry_source_locale_required",
                  message: String(data.error ?? "Pass template_entry_source_locale."),
                  contentType,
                  locales: data.locales,
                },
                [
                  {
                    tool: "update_content_type",
                    reason: "Re-call with template_entry_source_locale set to one of locales",
                    args_hint: {
                      contentType,
                      single_template: true,
                      template_mode: template_mode ?? "from_entry",
                      template_entry_source_slug,
                      template_entry_source_locale: Array.isArray(data.locales)
                        ? data.locales[0]
                        : undefined,
                      site,
                    },
                    priority: "required",
                  },
                ],
              );
            }
            return fail(String(data.error ?? data.message ?? `update failed (${res.status})`), {
              code: data.code,
              ...data,
            });
          }

          const enable = data.shared_layout_enable as
            | {
                template_mode?: string;
                written_paths?: string[];
                source_slug?: string;
                source_locale?: string;
              }
            | undefined;
          const written = Array.isArray(enable?.written_paths) ? enable!.written_paths! : [];
          const warnings: McpWarning[] = [
            {
              code: "attached_sections_ignored",
              message:
                "Attached entries ignore their YAML sections; structure comes from template.{locale}.yml.",
            },
            {
              code: "sibling_copy_may_need_edit",
              message:
                "Sibling locale shells may still need copy work after structural align (needs-edit labels).",
            },
            {
              code: "legacy_single_read_fallback",
              message:
                "Legacy single.*.yml on disk is read-only fallback; new writes use template.*.yml.",
            },
          ];
          if (data.bindingsDissolved) {
            warnings.push({
              code: "bindings_dissolved",
              message: "Section bindings for this content type were removed (incompatible with shared layout).",
            });
          }

          return ok(
            {
              message:
                single_template === false
                  ? `Disabled shared layout on content type '${contentType}'`
                  : `Enabled shared layout on content type '${contentType}' (${enable?.template_mode ?? template_mode ?? "unknown"})`,
              contentType,
              single_template: !!single_template,
              shared_layout_enable: enable ?? null,
              patched: ["single_template"],
            },
            {
              warnings,
              side_effects: [
                {
                  kind: "content_types_yml",
                  summary: `Updated single_template on ${ymlPath}`,
                  paths: [ymlPath],
                },
                ...(written.length
                  ? [
                      {
                        kind: "shared_template_bootstrap",
                        summary: "Wrote or aligned shared template shells",
                        paths: written,
                      } satisfies McpSideEffect,
                    ]
                  : []),
              ],
              next_actions: [
                {
                  tool: "get_content_type_info",
                  reason: "Confirm single_template / create_via after enable",
                  args_hint: { contentType, site },
                  priority: "recommended",
                },
              ],
            },
          );
        } catch (e) {
          return fail(`Failed to update content type: ${(e as Error).message}`);
        }
      }

      const body: Record<string, unknown> = {};
      if (strategy === null) {
        body.strategy = null;
      } else {
        const parsed = parseContentTypeStrategy(strategy);
        if (!parsed) {
          return fail(
            "strategy requires a non-empty purpose string (constraints optional).",
            { code: "missing_strategy" },
          );
        }
        body.strategy = parsed;
      }

      try {
        const res = await fetch(
          `http://localhost:${MAIN_SERVER_PORT}/api/content-types/${encodeURIComponent(contentType)}/config${q}`,
          {
            method: "PUT",
            headers: { ...internalHeaders(mcpToken), "Content-Type": "application/json" },
            body: JSON.stringify(body),
          },
        );
        const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
        if (!res.ok) {
          return fail(String(data.error ?? data.message ?? `update failed (${res.status})`), {
            code: data.code,
            ...data,
          });
        }

        const cleared = strategy === null;
        return ok(
          {
            message: cleared
              ? `Cleared strategy on content type '${contentType}'`
              : `Updated strategy on content type '${contentType}'`,
            contentType,
            strategy: cleared ? null : body.strategy,
            patched: ["strategy"],
          },
          {
            warnings: [
              {
                code: "type_config_only",
                message:
                  "Writes content-types.yml strategy only. Does not change entries, fill_intent, insights_intent, or SEO monitoring.",
              },
              {
                code: "no_entry_fanout",
                message: "Does not update entry YAML or field values.",
              },
              {
                code: "no_schema_org_ensure",
                message:
                  "Does not attach schema_org companions. Use ensure_content_type_schema_org for entry seeding.",
              },
            ],
            side_effects: [
              {
                kind: "content_types_yml",
                summary: cleared
                  ? `Cleared strategy on ${ymlPath}`
                  : `Updated strategy on ${ymlPath}`,
                paths: [ymlPath],
              },
            ],
            next_actions: [
              {
                tool: "get_content_type_info",
                reason: "Confirm strategy after write",
                args_hint: { contentType, site },
                priority: "recommended",
              },
            ],
          },
        );
      } catch (e) {
        return fail(`Failed to update content type: ${(e as Error).message}`);
      }
    },
  );

  // ensure_content_type_schema_org
  mcp.tool(
    "ensure_content_type_schema_org",
    "Ensure every entry of a content type has a leading schema_org section for the given schema_type " +
    "(e.g. location → LocalBusiness). Seeds missing entries from legacy catalog or miami-usa/madrid-spain templates. " +
    "Call get_content_type_info first to see coverage. Requires seo_settings. " +
    MULTI_SITE_TOOL_BLURB,
    {
      contentType: z.string().describe("Content type key, e.g. 'location'"),
      schema_type: z.string().describe("Required schema.org type, e.g. 'LocalBusiness'"),
      dry_run: z.boolean().optional().describe("When true, report what would be added without writing"),
      slugs: z.array(z.string()).optional().describe("Optional subset of entry slugs; omit for all missing"),
      site: z.string().optional().describe(SITE_PARAM_DESC),
    },
    async ({ contentType, schema_type, dry_run, slugs, site }) => {
      const siteResult = resolveSiteContext(site);
      if (!siteResult.ok) return siteFailResult(siteResult.error, "ensure_content_type_schema_org", {
        contentType,
        schema_type,
      });
      const { domain } = siteResult;
      try {
        assertSafeSegment(contentType, "contentType");
        if (slugs) for (const s of slugs) assertSafeSegment(s, "slug");
      } catch (e) {
        return fail((e as Error).message);
      }
      if (mcpToken && !(await checkCap(mcpToken, "seo_settings"))) {
        return denyResponse("seo_settings");
      }

      const q = domain ? `?__site=${encodeURIComponent(domain)}` : "";
      try {
        const res = await fetch(
          `http://localhost:${MAIN_SERVER_PORT}/api/content-types/${encodeURIComponent(contentType)}/schema-org-ensure${q}`,
          {
            method: "POST",
            headers: { ...internalHeaders(mcpToken), "Content-Type": "application/json" },
            body: JSON.stringify({
              schema_type,
              dry_run: !!dry_run,
              slugs: slugs && slugs.length > 0 ? slugs : undefined,
            }),
          },
        );
        const data = (await res.json()) as Record<string, unknown>;
        if (!res.ok) {
          return fail(String(data.error ?? data.message ?? `ensure failed (${res.status})`), data);
        }

        const results = Array.isArray(data.results) ? (data.results as Array<Record<string, unknown>>) : [];
        const writtenPaths = results.flatMap((r) =>
          Array.isArray(r.files) ? (r.files as string[]) : [],
        );
        const warnings: McpWarning[] = [
          {
            code: "no_binding_topology_fanout",
            message:
              "Ensured schema_org sections are written only to the listed entry locale YAML paths. No section-binding topology fan-out.",
          },
          {
            code: "no_schema_org_yml_write",
            message: "Site schema-org.yml is not modified by this tool.",
          },
        ];
        if (dry_run) {
          warnings.push({
            code: "dry_run",
            message: "dry_run was true — no files were written.",
          });
        }

        return ok(
          {
            message: `Ensured schema_org ${schema_type} on content type '${contentType}' (added=${data.added ?? 0}, already_present=${data.already_present ?? 0}, errors=${data.errors ?? 0})`,
            contentType,
            schema_type,
            added: data.added ?? 0,
            already_present: data.already_present ?? 0,
            errors: data.errors ?? 0,
            results,
          },
          {
            warnings,
            side_effects: writtenPaths.length
              ? [
                  {
                    kind: "schema_org_ensure",
                    summary: `Wrote leading schema_org ${schema_type} on ${writtenPaths.length} file(s): ${writtenPaths.slice(0, 8).join(", ")}${writtenPaths.length > 8 ? "…" : ""}`,
                  },
                ]
              : [],
            next_actions: [
              {
                tool: "get_content_type_info",
                reason: "Re-check schema_org_requirements coverage after ensure",
                args_hint: { contentType, site },
                priority: "recommended",
              },
            ],
          },
        );
      } catch (e) {
        return fail(`Failed to ensure schema_org: ${(e as Error).message}`);
      }
    }
  );

  // list_entry_seo
  mcp.tool(
    "list_entry_seo",
    "Return SEO-relevant fields (meta, title, schema, url) for content entries. " +
    "Works for YAML and DB-backed types via the main server seo-entries API. " +
    "Sections/body content are never returned. " +
    "IMPORTANT: Omitting slugs does NOT dump the full type — returns a minimal sample (default 5; limit 1–20). " +
    "Pass slugs for full meta on those entries. Prefer get_entry_seo for one slug; get_content_type_info for type contract. Requires content_view or seo_edit. " +
    MULTI_SITE_TOOL_BLURB,
    {
      contentType: z.string().optional().describe("Restrict to one content type, e.g. 'blog' or 'program'"),
      locale: z.string().optional().describe("Restrict to one locale, e.g. 'en' or 'es'"),
      slugs: z.array(z.string()).optional().describe("Specific slugs — required for full meta payloads"),
      limit: z.number().int().min(1).max(20).optional().describe("Sample size when slugs omitted (default 5, max 20). Does not unlock full meta."),
      site: z.string().optional().describe(SITE_PARAM_DESC),
    },
    async ({ contentType, locale, slugs, limit, site }) => {
      const seoDenied = await denyUnlessContentViewOrSeo(mcpToken, contentType, grants);
      if (seoDenied) return seoDenied;
      const siteResult = resolveSiteContext(site);
      if (!siteResult.ok) {
        return siteFailResult(siteResult.error, "list_entry_seo", { contentType, locale, slugs, limit });
      }
      const { contentPath, domain } = siteResult;
      try {
        const configs = loadContentTypes(contentPath);
        const results: Array<Record<string, unknown>> = [];

        const allowedTypes = grants ? visibleContentTypes(grants, { unionSeoEdit: true }) : null;
        let typesToQuery = contentType
          ? (configs[contentType] ? [contentType] : [])
          : Object.keys(configs);
        if (allowedTypes) {
          typesToQuery = typesToQuery.filter((ct) => allowedTypes.has(ct));
        }

        await Promise.all(typesToQuery.map(async (ct) => {
          try {
            const params = new URLSearchParams();
            if (locale) params.set("locale", locale);
            if (domain) params.set("__site", domain);
            const url = `http://localhost:${MAIN_SERVER_PORT}/api/content-types/${encodeURIComponent(ct)}/seo-entries?${params}`;
            const res = await fetch(url);
            if (!res.ok) {
              results.push({ contentType: ct, error: `seo-entries returned ${res.status}` });
              return;
            }
            const body = await res.json() as {
              source: string;
              cache_missing?: boolean;
              cache_age_hours: number | null;
              entries: Array<{
                slug: unknown; contentType: string; locale: string;
                url: string | null; title: unknown;
                meta: Record<string, unknown>; schema: unknown;
              }>;
            };
            if (body.cache_missing) {
              results.push({ contentType: ct, cache_missing: true });
              return;
            }
            for (const entry of body.entries) {
              if (slugs && !slugs.includes(String(entry.slug))) continue;
              results.push({
                ...entry,
                ...(body.source === "db" ? { cache_age_hours: body.cache_age_hours } : {}),
              });
            }
          } catch (err) {
            results.push({ contentType: ct, error: `Failed to reach seo-entries: ${err}` });
          }
        }));

        results.sort((a, b) => {
          const ct = String(a.contentType ?? "").localeCompare(String(b.contentType ?? ""));
          if (ct !== 0) return ct;
          const sl = String(a.slug ?? "").localeCompare(String(b.slug ?? ""));
          if (sl !== 0) return sl;
          return String(a.locale ?? "").localeCompare(String(b.locale ?? ""));
        });

        const wantsFull = Array.isArray(slugs) && slugs.length > 0;
        if (wantsFull) {
          return {
            content: [{
              type: "text",
              text: JSON.stringify({ truncated: false, count: results.length, entries: results }, null, 2),
            }],
          };
        }

        const sampleSize = limit ?? 5;
        const approx = results.length;
        const sample = results.slice(0, sampleSize).map((e) => ({
          slug: e.slug,
          contentType: e.contentType,
          locale: e.locale,
          title: e.title ?? null,
          url: e.url ?? null,
        }));
        const siteHint = site ? { site } : {};
        return {
          content: [{
            type: "text",
            text: JSON.stringify({
              truncated: true,
              approx_count: approx,
              returned: sample.length,
              fields: "minimal",
              message:
                "Unfiltered list_entry_seo returns a minimal sample only. Pass slugs for full meta; " +
                "use get_entry_seo for one entry; get_content_type_info for the type contract.",
              entries: sample,
              warnings: [{
                code: "list_seo_unfiltered_sample",
                message: `Full meta omitted. Did not return all ${approx} matching entries.`,
              }],
              next_actions: [
                {
                  tool: "get_content_type_info",
                  priority: "recommended",
                  reason: "Inspect field_mapping / shared-layout flags instead of dumping SEO",
                  args_hint: { contentType: contentType || "blog", ...siteHint },
                },
                {
                  tool: "list_entries",
                  priority: "recommended",
                  reason: "Find peers with search, then list_entry_seo with those slugs",
                  args_hint: { contentType, locale, search: "", ...siteHint },
                },
                {
                  tool: "get_entry_seo",
                  priority: "optional",
                  reason: "Full SEO for one known slug",
                  args_hint: { slug: sample[0]?.slug, locale: locale || "en", ...siteHint },
                },
              ],
            }, null, 2),
          }],
        };
      } catch (err) {
        return { content: [{ type: "text", text: String(err) }], isError: true };
      }
    }
  );
}
