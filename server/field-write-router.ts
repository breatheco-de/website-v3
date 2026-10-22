/**
 * Route field updates to the correct YAML layer (_common / locale / seo:)
 * regardless of caller (proposal apply, MCP update_fields, etc.).
 *
 * Page-level vs locale is the fixed system rule in `@shared/field-scope`.
 * `mode: "draft_only"` keeps every change inside the draft file
 * (`{variant}.{locale}.yml`), including page-level fields, until promote.
 */

import * as fs from "fs";
import * as path from "path";
import { fieldScope, type FieldScopeOptions } from "@shared/field-scope";
import { deleteAtPath, getAtPath, setAtPath } from "@shared/object-path";
import type { ContentIndex } from "./content-index";
import { editCommonContent, editContent, getContentForEdit } from "./content-editor";
import {
  applyFunnelFieldUpdates,
  commonYmlPath,
  isFunnelFieldPath,
  prepareAndWriteFunnelMerge,
  readFunnelBlockFromFile,
  stripFunnelFromAllLocaleYamls,
  type FunnelBlock,
  type FunnelFieldUpdate,
} from "./funnel-fields";
import { assertFunnelAudienceGates } from "./product/funnel-audience-gates";
import { isKnownSeoFieldPath, SEO_YAML_KEY } from "./seo-field-defs";
import { LEGACY_SEO_PILLAR_KEY } from "./content-types";
import { urlParamsForContentType } from "./field-scope-config";
import { writeSeoFields } from "./seo-index";
import { markFileAsModified } from "./sync-state";
import {
  readVariantData,
  relFromCwd,
  variantFilePathFor,
  writeVariantData,
} from "./versioning/draft-meta";
import { variantHasTraffic } from "./versioning/variant-traffic";
import { validateLocaleUrlSlugFormat } from "./locale-url-slug";
import {
  checkDeprecatedWrites,
  deprecatedErrorInfo,
  deprecatedTemplateRefWarning,
} from "./deprecated-field-guard";

export type FieldWriteScope = "funnel" | "seo" | "common" | "locale";

export type FieldUpdateItem = {
  field_path: string;
  value?: unknown;
  reset?: boolean;
  /** `remove` deletes the field (draft_only: page-level fields are stored as `null`). */
  op?: "set" | "remove";
  /** Deprecated and ignored — routing is {@link fieldScope}. */
  meta_target?: "locale" | "common";
};

export type FieldWriteMode = "direct" | "draft_only";

export type FieldWriteWarning = {
  code: string;
  message: string;
};

export type ApplyFieldUpdatesResult =
  | {
      ok: true;
      warnings: FieldWriteWarning[];
      wrote: string[];
    }
  | {
      ok: false;
      error: string;
      code?: string;
      warnings: FieldWriteWarning[];
      wrote: string[];
      details?: unknown;
    };

function isSeoFieldPath(fieldPath: string): boolean {
  return (
    isKnownSeoFieldPath(fieldPath) ||
    fieldPath === `${SEO_YAML_KEY}.${LEGACY_SEO_PILLAR_KEY}` ||
    fieldPath === SEO_YAML_KEY ||
    fieldPath.startsWith(`${SEO_YAML_KEY}.`)
  );
}

export function isRemoveUpdate(u: FieldUpdateItem): boolean {
  return u.op === "remove" || u.reset === true;
}

export { urlParamsForContentType };

/** Classify a field path into its write target scope. */
export function classifyFieldPath(fieldPath: string, opts?: FieldScopeOptions): FieldWriteScope {
  if (isFunnelFieldPath(fieldPath)) return "funnel";
  if (isSeoFieldPath(fieldPath)) return "seo";
  return fieldScope(fieldPath, opts) === "common" ? "common" : "locale";
}

export function readFieldValueAtPath(opts: {
  contentType: string;
  slug: string;
  locale: string;
  variant?: string | null;
  field_path: string;
  contentRoot?: string;
  ci?: ContentIndex;
}): { value: unknown; error?: string } {
  const { field_path } = opts;
  if (isFunnelFieldPath(field_path)) {
    const filePath = commonYmlPath(opts.contentType, opts.slug, opts.contentRoot);
    const block = readFunnelBlockFromFile(filePath);
    if (field_path === "funnel") return { value: Object.keys(block).length ? block : undefined };
    return { value: getAtPath(block, field_path.slice("funnel.".length)) };
  }
  const loaded = getContentForEdit(
    opts.contentType,
    opts.slug,
    opts.locale,
    opts.variant?.trim() || undefined,
    undefined,
    opts.ci,
  );
  if (!loaded.content) {
    return { value: undefined, error: loaded.error || "Content not found" };
  }
  return { value: getAtPath(loaded.content, field_path) };
}

function seoPayloadFrom(
  seoUpdates: FieldUpdateItem[],
): { ok: true; payload: Record<string, unknown> } | { ok: false; error: string; code: string } {
  const payload: Record<string, unknown> = {};
  for (const u of seoUpdates) {
    if (u.field_path === SEO_YAML_KEY || u.field_path.startsWith(`${SEO_YAML_KEY}.`)) {
      if (
        !isKnownSeoFieldPath(u.field_path) &&
        u.field_path !== `${SEO_YAML_KEY}.${LEGACY_SEO_PILLAR_KEY}`
      ) {
        return {
          ok: false,
          error:
            "Unknown seo.* field. Known: seo.main_keyword, seo.kw_monthly_volume, seo.kw_difficulty, seo.pillar_path, seo.is_pillar. seo.* always writes the locale file (not _common.yml).",
          code: "unknown_seo_field",
        };
      }
    }
    const field =
      u.field_path === `${SEO_YAML_KEY}.${LEGACY_SEO_PILLAR_KEY}`
        ? "pillar_path"
        : u.field_path.startsWith(`${SEO_YAML_KEY}.`)
          ? u.field_path.slice(SEO_YAML_KEY.length + 1)
          : u.field_path;
    payload[field] = isRemoveUpdate(u) ? null : u.value;
  }
  return { ok: true, payload };
}

/**
 * Apply mixed field updates to the correct YAML layers.
 *
 * - `direct` (default): funnel and other page-level fields write live `_common.yml`
 *   (locale/variant do not scope them); locale fields write the locale or variant file.
 * - `draft_only`: everything stays in `{variant}.{locale}.yml`. Page-level removals are
 *   stored as `null` (deleted from `_common.yml` on promote); locale removals delete the key.
 *   Funnel merge + audience gates still run. Variants with traffic are rejected.
 */
export async function applyFieldUpdates(opts: {
  contentType: string;
  slug: string;
  locale: string;
  variant?: string | null;
  updates: FieldUpdateItem[];
  author: string;
  contentRoot?: string;
  contentRootName?: string;
  ci?: ContentIndex;
  skipSharedLayoutFanOut?: boolean;
  mode?: FieldWriteMode;
}): Promise<ApplyFieldUpdatesResult> {
  const warnings: FieldWriteWarning[] = [];
  const wrote: string[] = [];
  const { contentType, slug, locale, author, contentRoot, ci } = opts;
  const contentRootName =
    opts.contentRootName ||
    (contentRoot ? path.basename(path.isAbsolute(contentRoot) ? contentRoot : path.join(process.cwd(), contentRoot)) : undefined);
  const variant = opts.variant?.trim() || undefined;
  const updates = opts.updates ?? [];
  if (!updates.length) return { ok: true, warnings, wrote };

  if (updates.some((u) => u.meta_target !== undefined)) {
    warnings.push({
      code: "meta_target_ignored",
      message: "meta_target is ignored: page-level vs locale is a fixed system rule (fieldScope).",
    });
  }

  const scopeOpts: FieldScopeOptions = { urlParams: urlParamsForContentType(contentType, contentRoot) };
  const byScope = (scope: FieldWriteScope) =>
    updates.filter((u) => classifyFieldPath(u.field_path, scopeOpts) === scope);
  const funnelUpdates = byScope("funnel");
  const seoUpdates = byScope("seo");
  const commonUpdates = byScope("common");
  const localeUpdates = byScope("locale");

  if (opts.mode === "draft_only") {
    return applyDraftOnly({
      ...opts,
      variant,
      contentRootName,
      funnelUpdates,
      seoUpdates,
      commonUpdates,
      localeUpdates,
      warnings,
      wrote,
    });
  }

  // --- Funnel first (live common); validate gates before any write ---
  if (funnelUpdates.length > 0) {
    if (variant) {
      warnings.push({
        code: "funnel_live_despite_variant",
        message:
          "funnel.stage / funnel.products wrote live _common.yml (all languages). Draft/variant copy was not used for journey membership.",
      });
    }
    warnings.push({
      code: "funnel_locale_agnostic",
      message:
        "funnel.stage / funnel.products are page-level on _common.yml (all languages). locale and variant do not scope this write.",
    });

    const fieldUpdates: FunnelFieldUpdate[] = funnelUpdates.map((u) => ({
      field_path: u.field_path,
      value: u.value,
      reset: isRemoveUpdate(u),
    }));

    const current = readFunnelBlockFromFile(commonYmlPath(contentType, slug, contentRoot));
    const mergedPreview = applyFunnelFieldUpdates(current, fieldUpdates);
    if (!mergedPreview.ok) {
      return {
        ok: false,
        error: mergedPreview.error,
        code: mergedPreview.code,
        warnings,
        wrote,
        details: mergedPreview.details,
      };
    }
    const gates = assertFunnelAudienceGates(mergedPreview.coerced, {
      contentType,
      contentSlug: slug,
      contentRoot,
    });
    if (!gates.ok) {
      return {
        ok: false,
        error: gates.error,
        code: gates.code,
        warnings,
        wrote,
        details: gates.details,
      };
    }

    const patch: {
      touchStage?: boolean;
      stage?: unknown;
      touchProducts?: boolean;
      products?: unknown;
    } = {};
    for (const u of fieldUpdates) {
      if (u.field_path === "funnel") {
        if (u.reset) {
          patch.touchStage = true;
          patch.stage = null;
          patch.touchProducts = true;
          patch.products = null;
        } else if (u.value && typeof u.value === "object" && !Array.isArray(u.value)) {
          const b = u.value as Record<string, unknown>;
          if ("stage" in b) {
            patch.touchStage = true;
            patch.stage = b.stage;
          }
          if ("products" in b) {
            patch.touchProducts = true;
            patch.products = b.products;
          }
        }
        continue;
      }
      if (u.field_path === "funnel.stage") {
        patch.touchStage = true;
        patch.stage = u.reset ? null : u.value;
      } else if (u.field_path === "funnel.products") {
        patch.touchProducts = true;
        patch.products = u.reset ? null : u.value;
      }
    }

    const funnelWrite = prepareAndWriteFunnelMerge(
      contentType,
      slug,
      patch,
      contentRoot,
      assertFunnelAudienceGates,
    );
    if (!funnelWrite.ok) {
      return {
        ok: false,
        error: funnelWrite.error,
        code: funnelWrite.code,
        warnings,
        wrote,
        details: funnelWrite.details,
      };
    }
    if (funnelWrite.relativePath) {
      markFileAsModified(funnelWrite.relativePath, author, undefined, contentRoot);
      wrote.push(funnelWrite.relativePath);
    }
    for (const w of funnelWrite.warnings) {
      warnings.push({ code: w.code, message: w.message });
    }

    const stripped = stripFunnelFromAllLocaleYamls(contentType, slug, contentRoot, author);
    if (stripped.strippedRelativePaths.length > 0) {
      wrote.push(...stripped.strippedRelativePaths);
      warnings.push({
        code: "funnel_stripped_from_locale_yamls",
        message: `Removed orphan funnel: from locale YAML (${stripped.strippedRelativePaths.join(", ")}). Journey membership stays on _common.yml only.`,
      });
    }
  }

  // --- SEO (locale seo:) ---
  if (seoUpdates.length > 0) {
    const seo = seoPayloadFrom(seoUpdates);
    if (!seo.ok) return { ok: false, error: seo.error, code: seo.code, warnings, wrote };
    const seoResult = writeSeoFields({
      contentType,
      slug,
      locale,
      updates: seo.payload,
      author,
      contentRoot,
      variant,
      ci,
    });
    if (!seoResult.success) {
      return {
        ok: false,
        error:
          wrote.length > 0
            ? `Journey/common fields were written but seo update failed: ${seoResult.error}. Retry seo.* only.`
            : seoResult.error || "SEO write failed",
        code: seoResult.code,
        warnings,
        wrote,
      };
    }
    wrote.push("seo");
  }

  // --- Page-level fields (_common.yml) ---
  if (commonUpdates.length > 0) {
    if (variant) {
      warnings.push({
        code: "common_fields_ignore_variant",
        message: `${commonUpdates.map((u) => u.field_path).join(", ")} are page-level: written to live _common.yml (all languages). Use mode draft_only (proposals) to stage them in the draft.`,
      });
    }
    const ops = commonUpdates.map((u) => ({
      action: "update_field" as const,
      path: u.field_path,
      value: isRemoveUpdate(u) || u.value === null ? undefined : u.value,
    }));
    const commonResult = editCommonContent({
      contentType,
      slug,
      operations: ops,
      author,
      contentRootName,
      ci,
    });
    if (!commonResult.success) {
      return {
        ok: false,
        error:
          wrote.length > 0
            ? `Earlier fields were written but _common.yml failed: ${commonResult.error}. Retry page-level fields only.`
            : commonResult.error || "Common field write failed",
        code: commonResult.errorCode,
        warnings,
        wrote,
        ...(commonResult.deprecated ? { details: { deprecated: commonResult.deprecated } } : {}),
      };
    }
    wrote.push("_common.yml");
  }

  // --- Locale / variant body ---
  if (localeUpdates.length > 0) {
    const localeResult = await editContent({
      contentType,
      slug,
      locale,
      variant,
      operations: localeUpdates.map((u) => ({
        action: "update_field" as const,
        path: u.field_path,
        value: isRemoveUpdate(u) ? null : u.value,
      })),
      author,
      contentRoot,
      ci,
      skipSharedLayoutFanOut: opts.skipSharedLayoutFanOut,
    });
    if (!localeResult.success) {
      return {
        ok: false,
        error:
          wrote.length > 0
            ? `Journey/common fields were written but locale update failed: ${localeResult.error}. Retry locale/body fields only.`
            : localeResult.error || "Locale write failed",
        code: localeResult.errorCode,
        warnings,
        wrote,
        ...(localeResult.deprecated ? { details: { deprecated: localeResult.deprecated } } : {}),
      };
    }
    for (const ref of localeResult.deprecatedTemplateRefs ?? []) {
      warnings.push(deprecatedTemplateRefWarning(ref));
    }
    wrote.push(`locale:${locale}${variant ? `@${variant}` : ""}`);
  }

  if (!variant && contentRootName && wrote.length > 0) {
    const touchesCommon = updates.some((u) => fieldScope(u.field_path, scopeOpts) === "common");
    const ids = await openProposalsGoingStale(contentRootName, contentType, slug, locale, touchesCommon);
    if (ids.length) {
      warnings.push({
        code: "open_proposal_will_go_stale",
        message:
          `Open proposal(s) ${ids.join(", ")} have drafts made from the previous live version. ` +
          "On approve they rebuild on today's live, or go back to the author (context_stale) if the same fields changed.",
      });
    }
  }

  return { ok: true, warnings, wrote };
}

/** Open proposals with a draft of this page in `locale` (any locale when a page-level field changed). */
async function openProposalsGoingStale(
  site: string,
  contentType: string,
  slug: string,
  locale: string,
  anyLocale: boolean,
): Promise<string[]> {
  try {
    const { siteDbExists } = await import("./db");
    if (!siteDbExists(site)) return [];
    const { listOpenProposalsForEntry } = await import("./content-proposals/service");
    const hits = listOpenProposalsForEntry(site, contentType, slug).filter(
      (p) => p.variant && (anyLocale || p.locale === locale),
    );
    return Array.from(new Set(hits.map((p) => p.id)));
  } catch {
    return [];
  }
}

async function applyDraftOnly(ctx: {
  contentType: string;
  slug: string;
  locale: string;
  variant?: string;
  author: string;
  contentRoot?: string;
  contentRootName?: string;
  ci?: ContentIndex;
  skipSharedLayoutFanOut?: boolean;
  funnelUpdates: FieldUpdateItem[];
  seoUpdates: FieldUpdateItem[];
  commonUpdates: FieldUpdateItem[];
  localeUpdates: FieldUpdateItem[];
  warnings: FieldWriteWarning[];
  wrote: string[];
}): Promise<ApplyFieldUpdatesResult> {
  const { contentType, slug, locale, variant, author, contentRoot, ci, warnings, wrote } = ctx;
  if (!variant) {
    return {
      ok: false,
      error: "draft_only writes need a draft variant (e.g. draft).",
      code: "draft_variant_required",
      warnings,
      wrote,
    };
  }
  if (variantHasTraffic({ contentType, slug, locale, variant, contentRoot })) {
    return {
      ok: false,
      error: `Variant '${variant}' has traffic (experiment). Only drafts (0% traffic) accept staged changes.`,
      code: "variant_has_traffic",
      warnings,
      wrote,
    };
  }
  const draftPath = variantFilePathFor({ contentType, slug, variant, locale, contentRoot });
  if (!fs.existsSync(draftPath)) {
    return {
      ok: false,
      error: `Draft file not found: ${relFromCwd(draftPath)}`,
      code: "draft_missing",
      warnings,
      wrote,
    };
  }

  const deprecatedGate = checkDeprecatedWrites({
    contentType,
    slug,
    contentRoot,
    updates: [...ctx.commonUpdates, ...ctx.localeUpdates].map((u) => ({
      path: u.field_path,
      value: isRemoveUpdate(u) ? null : u.value,
    })),
  });
  if (!deprecatedGate.ok) {
    return {
      ok: false,
      error: deprecatedGate.error,
      code: deprecatedGate.code,
      warnings,
      wrote,
      details: { deprecated: deprecatedErrorInfo(deprecatedGate) },
    };
  }

  // Validate funnel before any write (merge onto what the draft would publish).
  let funnelBlock: FunnelBlock | null | undefined;
  if (ctx.funnelUpdates.length > 0) {
    const draftData = readVariantData(draftPath) ?? {};
    const current: FunnelBlock =
      "funnel" in draftData
        ? ((draftData.funnel ?? {}) as FunnelBlock)
        : readFunnelBlockFromFile(commonYmlPath(contentType, slug, contentRoot));
    const merged = applyFunnelFieldUpdates(
      current,
      ctx.funnelUpdates.map((u) => ({
        field_path: u.field_path,
        value: u.value,
        reset: isRemoveUpdate(u),
      })),
    );
    if (!merged.ok) {
      return { ok: false, error: merged.error, code: merged.code, warnings, wrote, details: merged.details };
    }
    const gates = assertFunnelAudienceGates(merged.coerced, { contentType, contentSlug: slug, contentRoot });
    if (!gates.ok) {
      return { ok: false, error: gates.error, code: gates.code, warnings, wrote, details: gates.details };
    }
    for (const w of [...merged.warnings, ...gates.warnings]) warnings.push({ code: w.code, message: w.message });
    const empty = !merged.coerced.stage && !merged.coerced.products;
    funnelBlock = empty ? null : merged.coerced;
  }

  let seoPayload: Record<string, unknown> | null = null;
  if (ctx.seoUpdates.length > 0) {
    const seo = seoPayloadFrom(ctx.seoUpdates);
    if (!seo.ok) return { ok: false, error: seo.error, code: seo.code, warnings, wrote };
    seoPayload = seo.payload;
  }

  // This language's own URL slug: the editor refuses `slug` (live renames go through
  // rename-slug); on a draft it is staged as-is and URL ownership is checked at publish.
  const slugSets = ctx.localeUpdates.filter((u) => u.field_path === "slug" && !isRemoveUpdate(u) && u.value !== null);
  for (const u of slugSets) {
    const formatErr = typeof u.value === "string" ? validateLocaleUrlSlugFormat(u.value.trim()) : "slug must be a string.";
    if (formatErr) {
      return { ok: false, error: `slug: ${formatErr}`, code: "invalid_locale_slug", warnings, wrote };
    }
  }

  // Locale body (sections, title, …) through the editor so its gates and merges run.
  const localeSets = ctx.localeUpdates.filter(
    (u) => !isRemoveUpdate(u) && u.value !== null && u.field_path !== "slug",
  );
  const localeRemovals = ctx.localeUpdates.filter((u) => isRemoveUpdate(u) || u.value === null);
  if (localeSets.length > 0) {
    const res = await editContent({
      contentType,
      slug,
      locale,
      variant,
      operations: localeSets.map((u) => ({ action: "update_field" as const, path: u.field_path, value: u.value })),
      author,
      contentRoot,
      ci,
      skipSharedLayoutFanOut: ctx.skipSharedLayoutFanOut,
    });
    if (!res.success) {
      return { ok: false, error: res.error || "Draft write failed", code: res.errorCode, warnings, wrote };
    }
    wrote.push(`locale:${locale}@${variant}`);
  }

  // Page-level fields, funnel, locale slug and locale removals: direct draft-file patch.
  if (
    funnelBlock !== undefined ||
    ctx.commonUpdates.length > 0 ||
    localeRemovals.length > 0 ||
    slugSets.length > 0
  ) {
    const data = readVariantData(draftPath) ?? {};
    if (funnelBlock !== undefined) data.funnel = funnelBlock;
    for (const u of slugSets) data.slug = String(u.value).trim();
    for (const u of ctx.commonUpdates) {
      setAtPath(data, u.field_path, isRemoveUpdate(u) ? null : u.value ?? null);
    }
    for (const u of localeRemovals) deleteAtPath(data, u.field_path);
    writeVariantData(draftPath, data, { author, contentRoot, relPath: relFromCwd(draftPath) });
    if (!wrote.includes(`locale:${locale}@${variant}`)) wrote.push(`locale:${locale}@${variant}`);
    const sharedPaths = [
      ...(funnelBlock !== undefined ? ["funnel"] : []),
      ...ctx.commonUpdates.map((u) => u.field_path),
    ];
    if (sharedPaths.length > 0) {
      warnings.push({
        code: "common_fields_all_languages",
        message: `${sharedPaths.join(", ")} ${sharedPaths.length === 1 ? "is" : "are"} page-level: staged in ${relFromCwd(draftPath)} and written to ${slug}/_common.yml (every language) on publish.`,
      });
    }
    const removed = [
      ...(funnelBlock === null ? ["funnel"] : []),
      ...ctx.commonUpdates.filter((u) => isRemoveUpdate(u) || u.value === null).map((u) => u.field_path),
    ];
    if (removed.length > 0) {
      warnings.push({
        code: "common_field_removal_staged",
        message: `${removed.join(", ")} will be deleted from ${slug}/_common.yml in every language on publish. The draft stores null until then.`,
      });
    }
  }

  if (seoPayload) {
    const seoResult = writeSeoFields({
      contentType,
      slug,
      locale,
      updates: seoPayload,
      author,
      contentRoot,
      variant,
      ci,
    });
    if (!seoResult.success) {
      return {
        ok: false,
        error:
          wrote.length > 0
            ? `Draft fields were written but seo update failed: ${seoResult.error}. Retry seo.* only.`
            : seoResult.error || "SEO write failed",
        code: seoResult.code,
        warnings,
        wrote,
      };
    }
    wrote.push("seo");
    warnings.push({
      code: "draft_seo_replaces_live",
      message: "The draft's seo: replaces the published seo: on publish.",
    });
  }

  return { ok: true, warnings, wrote };
}
