/**
 * Shared promote + optional experiment teardown for versioning routes and proposal apply.
 * Teardown of traffic-bearing siblings bypasses variantTrafficBlock (confirm already required).
 *
 * Promote routes page-level fields staged in the draft (fieldScope "common") to
 * `_common.yml` — `null` deletes the key there — and writes only locale fields to the
 * live locale file. `_draft` metadata never reaches a published file.
 */
import fs from "fs";
import path from "path";
import type { ContentType } from "@shared/schema";
import { splitByFieldScope } from "@shared/field-scope";
import { deleteAtPath, isPlainObject, setAtPath } from "@shared/object-path";
import type { ContentIndex } from "../content-index";
import type { VersioningManager, VersioningFile } from "./VersioningManager";
import { pruneVersioningAfterVariantRemove } from "./delete-variant";
import {
  hashVariantFileContents,
  readDraftMetaFromRaw,
  safeDumpYaml,
  safeLoadYaml,
  stripDraftMetaFromRaw,
} from "./draft-meta";
import {
  checkDraftBase,
  checkTranslationSource,
  diffSnapshots,
  flattenFields,
  forgetDraftBase,
  rebuildDraftFromBase,
  sameValue,
  type BaseSnapshot,
  type DraftRef,
  type FieldChange,
} from "./draft-base";
import { markFileAsModified } from "../sync-state";
import { deepMerge } from "../utils/deepMerge";
import {
  liveTemplateBasename,
  variantTemplateBasename,
  isReservedTemplateVariantSlug,
} from "../shared-layout-paths";
import { attachedOverlayStructureError, isEntryDetached, isSharedLayoutType } from "../shared-layout-entry";
import { hasAnyLiveLocale, liveLocaleFileName } from "../draft-entry";
import { validateYamlIdentity } from "../validate-content-identity";
import {
  assertLocaleUrlAvailable,
  checkNewLocaleUrlSlug,
  ownLocaleSlug,
  validateLocaleUrlSlugFormat,
} from "../locale-url-slug";
import { getContentTypeConfig } from "../content-types";
import { assessSlugLocaleMatch, SLUG_LOCALE_MISMATCH_CODE } from "@shared/slug-locale-heuristic";
import { ensurePublishedAtOnce } from "../published-at";
import { clearSsrSchemaCache } from "../ssr-schema";
import { invalidateContentCaches } from "../routes/_helpers";
import { buildEntryKey } from "../../scripts/validation/shared/entryKey";
import { emitEntryLocalePromoted } from "../content-events";
import { refreshSitemapEntriesForContentKey } from "../sitemap";
import { findTopLevelKeySpan, surgicalRemoveTopLevelKey } from "../seo-fields";
import { normalizeFunnelBlock } from "@shared/funnel";
import { assertFunnelAudienceGates } from "../product/funnel-audience-gates";
import { stripFunnelFromAllLocaleYamls } from "../funnel-fields";
import { urlParamsForContentType } from "../field-scope-config";
import type { ValidationCacheService } from "../services/validationCacheService";
import { checkDeprecatedFileWrite, deprecatedErrorInfo } from "../deprecated-field-guard";
import { isSeoMonitoringEnabled } from "../seo-monitoring";
import { checkLocaleSeoTarget } from "../content-proposals/locale-seo-gate";
import { evaluatePageTextLimitsForSite } from "../text-limits";
import { loadSiteTheme } from "../theme-config";
import { evaluateRenderReviewGate } from "../design/review-freshness";
import { recordLayoutPublish, templateLayoutKey } from "../design/layout-approval";
import { deliveredFingerprint } from "../design/fingerprint";
import {
  evaluatePageThemeColors,
  summarizeThemeViolations,
  themeViolationDetails,
  THEME_COLORS_CODE,
} from "../design/theme-gate";
import {
  TEXT_LIMITS_EXCEEDED_CODE,
  summarizeTextLimitViolations,
} from "@shared/component-text-limits";
import {
  normalizeRobotsValue,
  parseRobotsOnPublish,
  robotsLabel,
  ROBOTS_CHANGE_ON_PUBLISH_CODE,
  type RobotsOnPublish,
} from "./robots-on-publish";

export { hashVariantFileContents };

export type TrafficSibling = {
  slug: string;
  locale: string;
  allocation: number;
};

export function listTrafficSiblings(opts: {
  versioning: VersioningFile | null | undefined;
  locale: string;
  excludeVariantSlug: string;
}): TrafficSibling[] {
  const variants = opts.versioning?.[opts.locale]?.variants ?? [];
  return variants
    .filter((v) => v.slug !== opts.excludeVariantSlug && (v.allocation ?? 0) > 0)
    .map((v) => ({
      slug: v.slug,
      locale: opts.locale,
      allocation: v.allocation ?? 0,
    }));
}

export type OpenProposalLink = { id: string; env?: string; title?: string };

export type PromoteWithTeardownArgs = {
  contentType: string;
  slug: string;
  locale: string;
  variantSlug: string;
  author: string;
  contentRoot: string;
  contentRootName: string;
  folder: string;
  templateMode: boolean;
  versioningManager: VersioningManager;
  ci: ContentIndex;
  cache: ValidationCacheService;
  /** When true (proposal apply), traffic siblings require confirm_end_experiment and are deleted. When false (Versions UI), siblings are left alone. */
  endExperimentMode?: boolean;
  /** When true in endExperimentMode, delete other variants on this locale with allocation > 0. */
  confirmEndExperiment?: boolean;
  /** Publish even if live changed after the draft was created (discards those live changes). */
  confirmOverwriteNewerLive?: boolean;
  /** Publish a translation whose source locale changed after translating. */
  confirmSourceChanged?: boolean;
  /** Internal: proposal apply — skips the proposal_required / draft_in_proposal guards. */
  viaProposalApply?: boolean;
  /** Caller holds an agentic swarm role: direct publish is not allowed. */
  callerIsSwarm?: boolean;
  /** Caller is an MCP agent: text-limit violations always block (no confirm). */
  callerIsMcp?: boolean;
  /** Staff confirmed publishing text over the component text_limits. */
  confirmTextLimits?: boolean;
  /** Publish even though this language will show a different page-level value (legacy copy in its locale file). */
  confirmDisplayChange?: boolean;
  /** Open proposal owning this draft (local DB); `_draft.proposal` is checked first. */
  findOpenProposalForDraft?: (ref: DraftRef) => OpenProposalLink | null;
  /** Run every check, write nothing. */
  dryRun?: boolean;
  /** New locale with `seo.pillar_path: null`: why it stays out of every cluster. */
  seoStandaloneReason?: string | null;
  /** Staff publish: this language's own URL slug chosen at publish time (`{ [locale]: slug }`). */
  localeUrlSlugs?: Record<string, string> | null;
  /** Answer to `robots_change_on_publish`: keep this language's live robots, or publish the draft's. */
  robotsOnPublish?: RobotsOnPublish | null;
};

export { ROBOTS_CHANGE_ON_PUBLISH_CODE, parseRobotsOnPublish, type RobotsOnPublish };

/** Effective `meta.robots` of a locale file layered on `_common.yml`. */
export function effectiveRobots(commonRaw: string | null, localeRaw: string | null): string {
  const merged = deepMerge(parseOrNull(commonRaw) ?? {}, parseOrNull(localeRaw) ?? {}) as Record<string, unknown>;
  return normalizeRobotsValue(valueAt(merged, "meta.robots"));
}

/** Put the live locale file's own `meta.robots` (or its absence) into the promoted YAML. */
export function keepLiveRobots(promotedRaw: string, liveRaw: string | null): string {
  const promoted = parseOrNull(promotedRaw) ?? {};
  const liveOwn = valueAt(parseOrNull(liveRaw) ?? {}, "meta.robots");
  const meta = isPlainObject(promoted.meta) ? { ...(promoted.meta as Record<string, unknown>) } : {};
  if (liveOwn == null) delete meta.robots;
  else meta.robots = liveOwn;
  if (Object.keys(meta).length === 0) {
    return findTopLevelKeySpan(promotedRaw, "meta") ? surgicalRemoveTopLevelKey(promotedRaw, "meta") : promotedRaw;
  }
  return surgicalSetTopLevelKey(promotedRaw, "meta", meta);
}

export type PromoteWarning = { code: string; message: string; fields?: string[]; details?: Record<string, unknown> };

export type PromoteSnapshot = { live: string | null; common: string | null };

export type PromoteWithTeardownResult =
  | {
      ok: true;
      ignoredVariantSeo: boolean;
      deletedSiblings: TrafficSibling[];
      warnings: PromoteWarning[];
      /** Draft was rebuilt on top of newer live before publishing. */
      rebuilt?: { kept_live_fields: string[]; author_fields: string[] };
      /** What changed on the published page (fields, before/after). */
      publishedDiff: FieldChange[];
      /** Raw files before the write (for revert). */
      preApplySnapshot: PromoteSnapshot;
      versioningDeleted: boolean;
      dryRun?: boolean;
    }
  | {
      ok: false;
      code: string;
      error: string;
      traffic_siblings?: TrafficSibling[];
      status?: number;
      details?: Record<string, unknown>;
    };

function surgicalSetTopLevelKey(raw: string, key: string, value: unknown): string {
  const block = safeDumpYaml({ [key]: value }).replace(/\s+$/, "");
  const span = findTopLevelKeySpan(raw, key);
  if (!span) {
    const base = raw.replace(/\s+$/, "");
    return `${base ? `${base}\n` : ""}${block}\n`;
  }
  const before = raw.slice(0, span.start);
  let after = raw.slice(span.end);
  if (after.startsWith("\n")) after = after.slice(1);
  return `${before}${block}\n${after}`;
}

/** Top-level keys + nested (`meta.robots`) page-level paths staged in the draft. */
function commonPathsOf(draftCommon: Record<string, unknown>): string[] {
  const out: string[] = [];
  for (const [key, value] of Object.entries(draftCommon)) {
    if (key === "meta" && isPlainObject(value)) {
      for (const sub of Object.keys(value)) out.push(`meta.${sub}`);
    } else {
      out.push(key);
    }
  }
  return out;
}

function valueAt(obj: Record<string, unknown>, p: string): unknown {
  return p.split(".").reduce<unknown>((cur, k) => (isPlainObject(cur) ? cur[k] : undefined), obj);
}

/** Top-level keys + `meta.*` of the locale part whose value is `null` (removal markers). */
function localeNullPaths(locale: Record<string, unknown>): string[] {
  const out: string[] = [];
  for (const [key, value] of Object.entries(locale)) {
    if (key === "meta" && isPlainObject(value)) {
      for (const [sub, v] of Object.entries(value)) if (v === null) out.push(`meta.${sub}`);
    } else if (value === null) {
      out.push(key);
    }
  }
  return out;
}

export const DISPLAY_VALUES_CHANGE_CODE = "display_values_change";

export type DisplayValueChange = { field_path: string; before: unknown; after: unknown };

/**
 * Page-level fields this language shows from a legacy copy in its own locale file.
 * Publish never writes page-level keys to the locale file, so afterwards the language
 * shows `_common.yml` (after this publish) instead — list the values that change.
 */
export function displayValueChanges(opts: {
  liveRaw: string | null;
  commonBeforeRaw: string | null;
  commonAfterRaw: string | null;
  urlParams?: string[];
}): DisplayValueChange[] {
  const live = parseOrNull(opts.liveRaw);
  if (!live) return [];
  const { common: legacy } = splitByFieldScope(live, { urlParams: opts.urlParams });
  const commonBefore = parseOrNull(opts.commonBeforeRaw) ?? {};
  const commonAfter = parseOrNull(opts.commonAfterRaw) ?? {};
  const out: DisplayValueChange[] = [];
  for (const [fieldPath, own] of flattenFields(legacy)) {
    if (own === null) continue;
    const shared = valueAt(commonBefore, fieldPath);
    const before = isPlainObject(own) && isPlainObject(shared) ? deepMerge(shared, own) : own;
    const after = valueAt(commonAfter, fieldPath);
    if (!sameValue(before, after)) out.push({ field_path: fieldPath, before, after });
  }
  return out;
}

/**
 * Apply the draft's page-level fields to `_common.yml` text and drop them from the
 * locale text. `null` in the draft deletes the key from `_common.yml`; the locale
 * file never receives page-level keys (nor their `null` markers).
 */
export function routeSharedFieldsOnPromote(opts: {
  draftRaw: string;
  commonRaw: string | null;
  urlParams?: string[];
}): { localeRaw: string; commonRaw: string | null; commonChanged: boolean; paths: string[]; draftCommon: Record<string, unknown> } {
  const parsed = safeLoadYaml(opts.draftRaw) ?? {};
  const { common: draftCommon, locale: draftLocale } = splitByFieldScope(parsed, { urlParams: opts.urlParams });
  const paths = commonPathsOf(draftCommon);
  const localeNulls = localeNullPaths(draftLocale);
  if (paths.length === 0 && localeNulls.length === 0) {
    return { localeRaw: opts.draftRaw, commonRaw: opts.commonRaw, commonChanged: false, paths, draftCommon };
  }

  const nested = paths.some((p) => p.includes(".")) || localeNulls.length > 0;
  let localeRaw: string;
  if (nested) {
    const localeObj = { ...parsed };
    for (const p of [...paths, ...localeNulls]) deleteAtPath(localeObj, p);
    if (isPlainObject(localeObj.meta) && Object.keys(localeObj.meta).length === 0) delete localeObj.meta;
    localeRaw = safeDumpYaml(localeObj);
  } else {
    localeRaw = paths.reduce((raw, key) => surgicalRemoveTopLevelKey(raw, key), opts.draftRaw);
  }
  if (paths.length === 0) {
    return { localeRaw, commonRaw: opts.commonRaw, commonChanged: false, paths, draftCommon };
  }

  let commonRaw = opts.commonRaw ?? "";
  if (nested) {
    const commonObj = safeLoadYaml(commonRaw) ?? {};
    for (const p of paths) {
      const v = valueAt(draftCommon, p);
      if (v === null) deleteAtPath(commonObj, p);
      else setAtPath(commonObj, p, v);
    }
    commonRaw = Object.keys(commonObj).length ? safeDumpYaml(commonObj) : "{}\n";
  } else {
    for (const key of paths) {
      const v = draftCommon[key];
      commonRaw = v === null ? surgicalRemoveTopLevelKey(commonRaw, key) : surgicalSetTopLevelKey(commonRaw, key, v);
    }
    if (!commonRaw.trim()) commonRaw = "{}\n";
  }
  return {
    localeRaw,
    commonRaw,
    commonChanged: commonRaw !== (opts.commonRaw ?? ""),
    paths,
    draftCommon,
  };
}

function parseOrNull(raw: string | null): Record<string, unknown> | null {
  return raw == null ? null : safeLoadYaml(raw);
}

export async function promoteVariantWithOptionalTeardown(
  args: PromoteWithTeardownArgs,
): Promise<PromoteWithTeardownResult> {
  const {
    contentType,
    slug,
    locale,
    variantSlug,
    author,
    contentRoot,
    contentRootName,
    folder,
    templateMode,
    versioningManager,
    ci,
    cache,
    endExperimentMode,
    confirmEndExperiment,
  } = args;
  const warnings: PromoteWarning[] = [];

  if (!/^[a-z0-9-]+$/.test(variantSlug)) {
    return { ok: false, code: "invalid_variant", error: "variantSlug must be lowercase letters, numbers, and hyphens only" };
  }
  if (isReservedTemplateVariantSlug(variantSlug)) {
    return {
      ok: false,
      code: "reserved_variant",
      error: 'Variant slug "template" and "single" are reserved for the shared-layout shell',
    };
  }
  if (!/^[a-z]{2}(-[A-Z]{2})?$/.test(locale)) {
    return { ok: false, code: "invalid_locale", error: "locale must be a valid language code (e.g. en, es, pt-BR)" };
  }

  const contentDir = path.resolve(versioningManager.getVersioningContentDir(contentType, slug));
  if (!fs.existsSync(contentDir)) {
    return { ok: false, code: "not_found", error: "Content folder not found", status: 404 };
  }

  const variantFilePath = path.resolve(
    versioningManager.getVariantFilePath(contentType, slug, variantSlug, locale),
  );
  const defaultFilePath = path.resolve(
    contentDir,
    templateMode ? liveLocaleFileName(locale, true) : `${locale}.yml`,
  );
  const commonFilePath = path.resolve(contentDir, "_common.yml");

  if (
    !variantFilePath.startsWith(contentDir + path.sep) ||
    !defaultFilePath.startsWith(contentDir + path.sep)
  ) {
    return { ok: false, code: "invalid_path", error: "Invalid file path" };
  }

  if (!fs.existsSync(variantFilePath)) {
    return {
      ok: false,
      code: "variant_missing",
      error: templateMode
        ? `Variant file ${variantTemplateBasename(variantSlug, locale)} not found`
        : `Variant file ${variantSlug}.${locale}.yml not found`,
      status: 404,
    };
  }

  if (!templateMode) {
    const deprecatedGate = checkDeprecatedFileWrite({
      contentType,
      slug,
      contentRoot,
      before: null,
      after: safeLoadYaml(fs.readFileSync(variantFilePath, "utf-8")),
    });
    if (!deprecatedGate.ok) {
      return {
        ok: false,
        code: deprecatedGate.code,
        error: `${deprecatedGate.error} Remove it from the draft (${variantSlug}.${locale}.yml) before publishing.`,
        details: { deprecated: deprecatedErrorInfo(deprecatedGate) },
      };
    }
  }

  const ref: DraftRef = { contentType, slug, locale, variant: variantSlug, contentRoot };

  // --- Who may publish this draft directly ---
  if (!args.viaProposalApply) {
    if (args.callerIsSwarm) {
      return {
        ok: false,
        code: "proposal_required",
        error:
          "Agents with a swarm role cannot publish directly. Create a proposal (proposals_create) — it publishes when someone with permission approves it.",
        status: 403,
      };
    }
    const link = readDraftMetaFromRaw(fs.readFileSync(variantFilePath, "utf-8"))?.proposal;
    const open = link ? { id: link.id, env: link.env } : args.findOpenProposalForDraft?.(ref) ?? null;
    if (open) {
      return {
        ok: false,
        code: "draft_in_proposal",
        error: `This draft is under review in proposal ${open.id}${open.env ? ` (${open.env})` : ""}. Approve the proposal to publish it.`,
        status: 409,
        details: { proposal_id: open.id, ...(open.env ? { env: open.env } : {}) },
      };
    }
  }

  const existing = versioningManager.getVersioningForContent(contentType, slug) || {};
  const trafficSiblings = listTrafficSiblings({
    versioning: existing,
    locale,
    excludeVariantSlug: variantSlug,
  });

  if (endExperimentMode && trafficSiblings.length > 0 && !confirmEndExperiment) {
    return {
      ok: false,
      code: "confirm_end_experiment",
      error:
        "Other variants still have traffic allocated. Pass confirm_end_experiment: true to promote and remove those traffic-bearing versions.",
      traffic_siblings: trafficSiblings,
    };
  }

  // --- Attached entries: the draft carries copy only (structure lives on the template) ---
  const attached =
    !templateMode && isSharedLayoutType(contentType, contentRoot) && !isEntryDetached(contentType, slug, contentRoot);
  if (attached) {
    const parsedForStructure = safeLoadYaml(fs.readFileSync(variantFilePath, "utf-8"));
    const structureErr = attachedOverlayStructureError(parsedForStructure);
    if (structureErr) {
      return {
        ok: false,
        code: "attached_draft_structure",
        error: `Cannot promote: ${structureErr}`,
        details: {
          property_path: Array.isArray(parsedForStructure?.sections) && parsedForStructure!.sections.length > 0 ? "sections" : "layout",
        },
      };
    }
  }

  // --- Live moved after the draft was created? ---
  let rebuilt: { kept_live_fields: string[]; author_fields: string[] } | undefined;
  let rebuiltContent: string | null = null;
  const baseCheck = checkDraftBase(ref);
  if (baseCheck.status === "stale") {
    const rebuild = rebuildDraftFromBase(ref, { preview: args.dryRun === true, author });
    if (rebuild.ok) {
      rebuilt = {
        kept_live_fields: rebuild.live_changes_since_base.map((c) => c.field_path),
        author_fields: rebuild.author_changes.map((c) => c.field_path),
      };
      if (args.dryRun) rebuiltContent = safeDumpYaml(rebuild.result);
      const keptRedirects = rebuild.redirects_kept_from_live.length;
      warnings.push({
        code: "draft_rebuilt",
        message:
          "Live changed after this draft was created; the draft was rebuilt on top of today's live and keeps both sets of changes." +
          (keptRedirects > 0
            ? ` Kept ${keptRedirects} old address${keptRedirects === 1 ? "" : "es"} added on live: ${rebuild.redirects_kept_from_live.join(", ")}.`
            : ""),
        fields: rebuilt.kept_live_fields,
      });
    } else if (!args.confirmOverwriteNewerLive) {
      return {
        ok: false,
        code: "draft_base_stale",
        error:
          rebuild.reason === "conflict"
            ? `This draft was created from an older version. Publishing it would undo recent live changes to: ${(rebuild.conflicting_fields ?? []).map((c) => c.field_path).join(", ")}.`
            : "This draft was created from an older version. Publishing it would undo recent live changes.",
        status: 409,
        details: {
          reason: rebuild.reason,
          changed_files: baseCheck.changed,
          ...(rebuild.conflicting_fields ? { conflicting_fields: rebuild.conflicting_fields } : {}),
          ...(rebuild.live_changes_since_base
            ? { live_changes_since_base: rebuild.live_changes_since_base.map((c) => c.field_path) }
            : {}),
        },
      };
    }
  } else if (baseCheck.status === "unknown" && !args.confirmOverwriteNewerLive) {
    return {
      ok: false,
      code: "draft_base_unknown",
      error: "We don't know which live version this draft came from; publishing it may undo recent changes.",
      status: 409,
      details: { reason: "no_based_on" },
    };
  }

  const source = checkTranslationSource(ref, { withFields: true });
  if (source.status === "changed" && !args.confirmSourceChanged) {
    return {
      ok: false,
      code: "translation_source_changed",
      error: `The ${source.source_locale} source changed after translating. Publishing now shows a translation of the previous version.`,
      status: 409,
      details: {
        source_locale: source.source_locale,
        ...(source.source_changed_fields ? { source_changed_fields: source.source_changed_fields } : {}),
      },
    };
  }

  const wasUnpublished = !templateMode && !hasAnyLiveLocale(contentDir, templateMode);
  const deletedSiblings: TrafficSibling[] = [];

  // --- New language on a monitored page: the draft must carry its own keyword + hub ---
  if (
    (args.viaProposalApply || args.callerIsMcp) &&
    !templateMode &&
    !wasUnpublished &&
    !fs.existsSync(defaultFilePath) &&
    isSeoMonitoringEnabled(contentType, contentRoot)
  ) {
    const draftParsed = safeLoadYaml(fs.readFileSync(variantFilePath, "utf-8"));
    const draftSeo = isPlainObject(draftParsed?.seo) ? (draftParsed!.seo as Record<string, unknown>) : null;
    const gate = checkLocaleSeoTarget({
      site: contentRootName,
      contentType,
      slug,
      locale,
      ci,
      draftSeo,
      standaloneReason: args.seoStandaloneReason,
    });
    if (!gate.ok) return { ok: false, code: gate.code, error: gate.error, details: gate.details };
  }

  const rawSlugOverride = args.localeUrlSlugs?.[locale];
  const slugOverride = typeof rawSlugOverride === "string" ? rawSlugOverride.trim() : "";
  if (slugOverride) {
    const formatErr = validateLocaleUrlSlugFormat(slugOverride);
    if (formatErr) {
      return {
        ok: false,
        code: "invalid_locale_slug",
        error: `Cannot promote: ${formatErr}`,
        details: { locale, property_path: "slug" },
      };
    }
  }

  // --- New language of a live page: it needs its own address word, not the folder name by default ---
  const isNewLanguage = !templateMode && !wasUnpublished && !fs.existsSync(defaultFilePath);
  if (isNewLanguage) {
    const draftOwn = safeLoadYaml(rebuiltContent ?? fs.readFileSync(variantFilePath, "utf-8")) ?? {};
    const gate = checkNewLocaleUrlSlug({
      draftOwnData: slugOverride ? { ...draftOwn, slug: slugOverride } : draftOwn,
      entryIdentity: slug,
      contentType,
      locale,
      urlPattern: getContentTypeConfig(contentType, contentRoot)?.url_pattern ?? null,
    });
    if (!gate.ok) return { ok: false, code: gate.code, error: gate.error, status: 409, details: gate.details };
  }

  try {
    let variantContent = stripDraftMetaFromRaw(rebuiltContent ?? fs.readFileSync(variantFilePath, "utf-8"));
    if (slugOverride) variantContent = surgicalSetTopLevelKey(variantContent, "slug", slugOverride);
    const identityErr = validateYamlIdentity(variantContent, {
      contentType,
      contentSlug: slug,
    });
    if (identityErr) {
      return {
        ok: false,
        code: "identity",
        error:
          `Cannot promote: ${identityErr}. ` +
          `Set conversion_name / CTA tracking / funnel.products on _common.yml (Funnel tab) before promoting.`,
      };
    }
    const parsedVariant = (ci.safeYamlLoad(variantContent) as Record<string, unknown>) || {};
    const commonForGate = ci.loadCommonData(contentType, slug) || {};
    const mergedForGate = deepMerge(commonForGate, parsedVariant) as Record<string, unknown>;
    const { evaluateLiveEntrySeoAndRequiredFields } = await import("../live-entry-seo-gate");
    const seoGate = evaluateLiveEntrySeoAndRequiredFields({
      contentType,
      slug,
      locale,
      pageData: mergedForGate,
      contentRoot,
      mode: "publish",
      intent: "publish",
      isDraftWrite: false,
    });
    if (seoGate) {
      if (seoGate.code === "schema_org_page_url_mismatch") {
        return {
          ok: false,
          code: seoGate.code,
          error: `Cannot promote: ${seoGate.message}`,
          details: { schema_org_page_url_mismatches: seoGate.schema_org_page_url_mismatches ?? [] },
        };
      }
      return { ok: false, code: "seo_gate", error: `Cannot promote: ${seoGate.message}` };
    }
    if (!templateMode) {
      const { runInternalLinkGate } = await import("../internal-link-gate");
      const linkGate = runInternalLinkGate({
        pageData: mergedForGate,
        locale,
        contentRoot,
        ci,
        pageIsDraft: true,
        intent: "publish",
      });
      if (linkGate.failure) {
        return {
          ok: false,
          code: linkGate.failure.code,
          error: `Cannot promote: ${linkGate.failure.message}`,
          details: { broken_internal_links: linkGate.failure.broken_internal_links },
        };
      }
      for (const w of linkGate.warnings) {
        warnings.push({ code: w.code, message: w.message, fields: w.links.map((l) => l.field_path) });
      }
    }
    {
      const { runConsentGate } = await import("../consent-gate");
      const consentGate = runConsentGate({ pageData: mergedForGate, contentRoot });
      if (consentGate.failure) {
        return {
          ok: false,
          code: consentGate.failure.code,
          error: `Cannot promote: ${consentGate.failure.message}`,
          details: { consent_forms: consentGate.failure.forms, warnings: consentGate.warnings },
        };
      }
      for (const w of consentGate.warnings) warnings.push({ code: w.code, message: w.message, fields: [] });
    }
    if (!templateMode) {
      const urlCheck = assertLocaleUrlAvailable({
        contentType,
        entryIdentity: slug,
        locale,
        mergedPageData: mergedForGate,
        ci,
      });
      if (!urlCheck.ok) {
        return {
          ok: false,
          code: urlCheck.code || "url_conflict",
          error: `Cannot promote: ${urlCheck.error}`,
          status: urlCheck.statusCode,
        };
      }
    }

    const liveContent = fs.existsSync(defaultFilePath) ? fs.readFileSync(defaultFilePath, "utf-8") : null;

    const chosenSlug = templateMode ? null : ownLocaleSlug(parsedVariant);
    const liveOwnSlug = liveContent ? ownLocaleSlug(safeLoadYaml(liveContent)) : null;
    if (chosenSlug && (isNewLanguage || chosenSlug !== liveOwnSlug)) {
      const match = assessSlugLocaleMatch(chosenSlug, locale);
      if (!match.ok) {
        const looksLike = match.inferredOpposite === "en" ? "English" : "Spanish";
        warnings.push({
          code: SLUG_LOCALE_MISMATCH_CODE,
          message: `The ${locale} address "${chosenSlug}" looks ${looksLike} (${match.markers.join(", ")}). Published anyway; rename it with a redirect if that was not intended.`,
          fields: ["slug"],
        });
      }
    }

    // Component text limits (schema.yml text_limits). Only text that differs
    // from live counts; agents cannot override, staff can confirm.
    const liveForGate = liveContent
      ? (deepMerge(commonForGate, (ci.safeYamlLoad(liveContent) as Record<string, unknown>) || {}) as Record<string, unknown>)
      : null;
    const textLimitViolations = evaluatePageTextLimitsForSite(mergedForGate, {
      before: liveForGate,
      contentRoot,
    });
    if (textLimitViolations.length > 0) {
      if (args.callerIsMcp || !args.confirmTextLimits) {
        return {
          ok: false,
          code: TEXT_LIMITS_EXCEEDED_CODE,
          error: `Cannot promote: text too long for this section — ${summarizeTextLimitViolations(textLimitViolations)}.${
            args.callerIsMcp ? " Shorten it on the draft and retry." : " Shorten it, or confirm to publish anyway."
          }`,
          details: { violations: textLimitViolations },
        };
      }
      warnings.push({
        code: "text_limits_confirmed",
        message: `Published with text over the component limits (confirmed): ${summarizeTextLimitViolations(textLimitViolations)}`,
        fields: textLimitViolations.flatMap((v) => v.fields.map((f) => `${v.section_path}.${f}`)),
      });
    }

    // Theme colors: agents cannot publish off-theme values the draft
    // introduced (vs live); staff publish with a warning.
    const theme = loadSiteTheme(contentRoot);
    const themeViolations = evaluatePageThemeColors(mergedForGate, { theme, before: liveForGate });
    if (themeViolations.length > 0) {
      if (args.callerIsMcp) {
        return {
          ok: false,
          code: THEME_COLORS_CODE,
          error: `Cannot promote: use theme IDs for colors — ${summarizeThemeViolations(themeViolations)}. Fix them on the draft and retry.`,
          details: themeViolationDetails(themeViolations, theme),
        };
      }
      warnings.push({
        code: "theme_colors_off_theme",
        message: `Published with colors outside the theme: ${summarizeThemeViolations(themeViolations)}`,
        fields: themeViolations.map((v) => v.property_path),
      });
    }

    // Agents need a render review matching this structure before a new or
    // restructured entry-owned page goes live (warn-only when reviews cannot run).
    const reviewGate = evaluateRenderReviewGate({
      callerIsMcp: args.callerIsMcp === true,
      templateMode,
      contentType,
      slug,
      locale,
      variantSlug,
      site: contentRootName,
      contentRoot,
      draftSections: mergedForGate.sections,
      liveSections: liveForGate ? liveForGate.sections ?? [] : null,
    });
    if (reviewGate.status === "required") {
      return {
        ok: false,
        code: "render_review_required",
        error:
          reviewGate.reason === "never_reviewed"
            ? "Cannot promote: this page layout has not been render-reviewed. Run review_page_render on the draft, fix findings, then retry."
            : "Cannot promote: the layout changed since the last render review (sections added, removed, reordered, or a variant/background switched). Re-run review_page_render, then retry.",
        details: {
          reason: reviewGate.reason,
          fingerprint: reviewGate.fingerprint,
          reviewed_fingerprint: reviewGate.review?.fingerprint ?? null,
          last_review_job_id: reviewGate.review?.job_id ?? null,
          review_args: { content_type: contentType, slug, locale, variant: variantSlug },
        },
      };
    }
    if (reviewGate.status === "unavailable") {
      warnings.push({
        code: "render_review_unavailable",
        message: `Published without a render review (review service unavailable: ${reviewGate.reason}).`,
      });
    }
    const commonBefore = !templateMode && fs.existsSync(commonFilePath) ? fs.readFileSync(commonFilePath, "utf-8") : null;
    const routed = templateMode
      ? { localeRaw: variantContent, commonRaw: commonBefore, commonChanged: false, paths: [] as string[], draftCommon: {} as Record<string, unknown> }
      : routeSharedFieldsOnPromote({
          draftRaw: variantContent,
          commonRaw: commonBefore,
          urlParams: urlParamsForContentType(contentType, contentRoot),
        });

    if ("funnel" in routed.draftCommon && routed.draftCommon.funnel !== null) {
      const gates = assertFunnelAudienceGates(normalizeFunnelBlock(routed.draftCommon.funnel as never), {
        contentType,
        contentSlug: slug,
        contentRoot,
      });
      if (!gates.ok) {
        return { ok: false, code: gates.code, error: `Cannot promote: ${gates.error}`, details: { funnel: gates.details } };
      }
    }

    const displayChanges = templateMode
      ? []
      : displayValueChanges({
          liveRaw: liveContent,
          commonBeforeRaw: commonBefore,
          commonAfterRaw: routed.commonChanged ? routed.commonRaw : commonBefore,
          urlParams: urlParamsForContentType(contentType, contentRoot),
        });
    if (displayChanges.length > 0) {
      const fields = displayChanges.map((c) => c.field_path);
      const message = `Publishing changes what ${locale} visitors see for: ${fields.join(", ")}. These now come from the page-wide settings shared by every language.`;
      if (!args.viaProposalApply && !args.confirmDisplayChange) {
        return {
          ok: false,
          code: DISPLAY_VALUES_CHANGE_CODE,
          error: `${message} Confirm to publish anyway.`,
          status: 409,
          details: {
            locale,
            fields: displayChanges,
            paths: { common: `${folder}/${slug}/_common.yml`, locale: `${folder}/${slug}/${locale}.yml` },
          },
        };
      }
      warnings.push({ code: DISPLAY_VALUES_CHANGE_CODE, message, fields });
    }

    const { yamlForPromotePreservingLiveSeo } = await import("../seo-write-layer");
    const promoted = yamlForPromotePreservingLiveSeo(routed.localeRaw, liveContent);
    let liveRedirectsChanged = false;
    if (!templateMode) {
      const { screenPublishedRedirects } = await import("../redirect-draft");
      const screened = screenPublishedRedirects({
        ci,
        contentType,
        folderSlug: slug,
        locale,
        liveRaw: liveContent,
        promotedRaw: promoted.content,
      });
      promoted.content = screened.content;
      liveRedirectsChanged = screened.changed;
      if (screened.skipped.length > 0) {
        warnings.push({
          code: "draft_redirects_skipped",
          message:
            `These old addresses were not added because they conflict: ${screened.skipped
              .map((s) => `${s.from} (${s.message})`)
              .join("; ")}. The page was published without them; live routing for those addresses is unchanged.`,
          fields: screened.skipped.map((s) => `meta.redirects[${s.from}]`),
          details: { skipped: screened.skipped },
        });
      }
    }
    // Robots decide whether search engines see this language: a publish that changes it is confirmed.
    if (liveContent != null) {
      const commonAfterRaw = routed.commonChanged ? routed.commonRaw : commonBefore;
      const liveRobots = effectiveRobots(commonBefore, liveContent);
      const draftRobots = effectiveRobots(commonAfterRaw, promoted.content);
      if (liveRobots !== draftRobots) {
        const localePath = templateMode
          ? `${folder}/${liveTemplateBasename(locale)}`
          : `${folder}/${slug}/${locale}.yml`;
        if (!args.robotsOnPublish) {
          return {
            ok: false,
            code: ROBOTS_CHANGE_ON_PUBLISH_CODE,
            error: `Publishing changes whether search engines can see this page in ${locale}: live is "${robotsLabel(liveRobots)}", the draft says "${robotsLabel(draftRobots)}". Choose to keep the live value or use the draft's.`,
            status: 409,
            details: {
              locale,
              live_robots: robotsLabel(liveRobots),
              draft_robots: robotsLabel(draftRobots),
              paths: { locale: localePath },
            },
          };
        }
        if (args.robotsOnPublish === "keep_live") {
          promoted.content = keepLiveRobots(promoted.content, liveContent);
        }
        const kept = args.robotsOnPublish === "keep_live";
        warnings.push({
          code: "robots_on_publish",
          message: kept
            ? `Kept the live robots value "${robotsLabel(liveRobots)}" for ${locale}; the draft's "${robotsLabel(draftRobots)}" was not published.`
            : `Published the draft's robots value "${robotsLabel(draftRobots)}" for ${locale} (was "${robotsLabel(liveRobots)}").`,
          fields: ["meta.robots"],
          details: {
            locale,
            choice: args.robotsOnPublish,
            live_robots: robotsLabel(liveRobots),
            draft_robots: robotsLabel(draftRobots),
          },
        });
      }
    }

    const publishedDiff = diffSnapshots(
      { live: parseOrNull(liveContent), common: parseOrNull(commonBefore) } as BaseSnapshot,
      {
        live: parseOrNull(promoted.content),
        common: routed.commonChanged ? parseOrNull(routed.commonRaw) : parseOrNull(commonBefore),
      } as BaseSnapshot,
    );
    const preApplySnapshot: PromoteSnapshot = { live: liveContent, common: commonBefore };
    if (routed.paths.length > 0) {
      warnings.push({
        code: "common_fields_all_languages",
        message: `${routed.paths.join(", ")} ${routed.paths.length === 1 ? "is a page-level field" : "are page-level fields"}: written to _common.yml and changed in every language.`,
        fields: routed.paths,
      });
    }

    if (args.dryRun) {
      return {
        ok: true,
        ignoredVariantSeo: promoted.ignoredVariantSeo,
        deletedSiblings: [],
        warnings,
        rebuilt,
        publishedDiff,
        preApplySnapshot,
        versioningDeleted: false,
        dryRun: true,
      };
    }

    if (endExperimentMode && trafficSiblings.length > 0 && confirmEndExperiment) {
      let versioningState: VersioningFile = { ...existing };
      for (const sib of trafficSiblings) {
        const sibPath = path.resolve(
          versioningManager.getVariantFilePath(contentType, slug, sib.slug, sib.locale),
        );
        if (fs.existsSync(sibPath) && sibPath.startsWith(contentDir + path.sep)) {
          fs.unlinkSync(sibPath);
          if (templateMode) {
            markFileAsModified(
              `${folder}/${variantTemplateBasename(sib.slug, sib.locale)}`,
              author,
              undefined,
              contentRoot,
            );
          } else {
            markFileAsModified(
              `${folder}/${slug}/${sib.slug}.${sib.locale}.yml`,
              author,
              undefined,
              contentRoot,
            );
          }
        }
        const pruned = pruneVersioningAfterVariantRemove(versioningState, sib.locale, sib.slug);
        versioningState = pruned.data;
        deletedSiblings.push(sib);
        cache.clearEntryKey(buildEntryKey(contentType, slug, sib.locale, sib.slug));
      }
      versioningManager.updateVersioning(contentType, slug, versioningState, { author, contentRoot });
    }

    // Write `_common.yml` first, then the live locale; undo both if anything fails.
    try {
      if (routed.commonChanged && routed.commonRaw != null) {
        fs.writeFileSync(commonFilePath, routed.commonRaw, "utf-8");
      }
      fs.writeFileSync(defaultFilePath, promoted.content, "utf-8");
    } catch (writeErr) {
      if (commonBefore == null) {
        if (routed.commonChanged && fs.existsSync(commonFilePath)) fs.unlinkSync(commonFilePath);
      } else {
        fs.writeFileSync(commonFilePath, commonBefore, "utf-8");
      }
      if (liveContent == null) {
        if (fs.existsSync(defaultFilePath)) fs.unlinkSync(defaultFilePath);
      } else {
        fs.writeFileSync(defaultFilePath, liveContent, "utf-8");
      }
      throw writeErr;
    }

    const afterTeardown =
      versioningManager.getVersioningForContent(contentType, slug) || {};
    const pruned = pruneVersioningAfterVariantRemove(afterTeardown, locale, variantSlug);
    let versioningDeleted = false;
    if (pruned.isEmpty) {
      versioningDeleted = versioningManager.deleteVersioningConfig(contentType, slug, author, contentRoot);
    } else if (afterTeardown[locale]) {
      versioningManager.updateVersioning(contentType, slug, pruned.data, { author, contentRoot });
    }

    fs.unlinkSync(variantFilePath);
    forgetDraftBase(ref);

    if ("funnel" in routed.draftCommon) {
      stripFunnelFromAllLocaleYamls(contentType, slug, contentRoot, author);
    }

    if (wasUnpublished) {
      ensurePublishedAtOnce(contentType, slug, {
        author,
        contentRoot,
      });
    }

    ci.invalidateCommonFields(contentType);
    clearSsrSchemaCache();
    invalidateContentCaches(contentType as ContentType, ci);

    cache.clearEntryKey(buildEntryKey(contentType, slug, locale, variantSlug));

    if (templateMode) {
      markFileAsModified(`${folder}/${liveTemplateBasename(locale)}`, author, undefined, contentRoot);
      markFileAsModified(
        `${folder}/${variantTemplateBasename(variantSlug, locale)}`,
        author,
        undefined,
        contentRoot,
      );
    } else {
      markFileAsModified(`${folder}/${slug}/${locale}.yml`, author, undefined, contentRoot);
      markFileAsModified(
        `${folder}/${slug}/${variantSlug}.${locale}.yml`,
        author,
        undefined,
        contentRoot,
      );
      if (routed.commonChanged) {
        markFileAsModified(`${folder}/${slug}/_common.yml`, author, undefined, contentRoot);
      }
      ci.refresh();
      refreshSitemapEntriesForContentKey(contentType, slug, [locale]);
      if (liveRedirectsChanged) {
        const { clearRedirectCache } = await import("../redirects");
        const { scheduleRedirectsValidation } = await import("../services/onSaveValidation");
        ci.refreshAfterRedirectWrite(defaultFilePath);
        clearRedirectCache();
        scheduleRedirectsValidation({ contentRoot, contentRootName, ci, cache, filePath: defaultFilePath, redirectsChanged: true });
      }
    }

    await cache.flush();

    emitEntryLocalePromoted({
      site: contentRootName,
      contentType,
      slug,
      locale,
      author,
    });

    try {
      const { syncSeoIndexEntryFromLiveDisk } = await import("../seo-index");
      syncSeoIndexEntryFromLiveDisk({
        contentType,
        slug,
        locale,
        contentRoot,
        author,
        ci,
      });
    } catch {
      /* non-fatal */
    }

    try {
      const sectionsLive = Array.isArray(mergedForGate.sections) && mergedForGate.sections.length > 0;
      if (sectionsLive) {
        recordLayoutPublish(
          path.basename(contentRootName),
          templateMode ? templateLayoutKey(contentType) : `${contentType}/${slug}`,
          deliveredFingerprint(mergedForGate.sections),
          author,
          args.callerIsMcp === true,
        );
      }
    } catch {
      /* non-fatal: implicit approval bookkeeping only */
    }

    return {
      ok: true,
      ignoredVariantSeo: promoted.ignoredVariantSeo,
      deletedSiblings,
      warnings,
      rebuilt,
      publishedDiff,
      preApplySnapshot,
      versioningDeleted,
    };
  } catch (error) {
    return { ok: false, code: "promote_failed", error: String(error), status: 500 };
  }
}