/**
 * Gate live entry writes: required SEO meta + editor.required fields.
 */

import { resolveSingleVars } from "./single-resolver";
import { buildSingleEntryFromContent } from "./build-single-entry";
import {
  finalizeSingleEntryForTemplates,
  getContentTypeConfig,
} from "./content-types";
import { resolveAllTemplateVars } from "./resolve-template-vars";
import {
  validateRequiredMeta,
  validateRequiredMetaKeys,
  formatMetaValidationErrors,
} from "@shared/validateRequiredMeta";
import {
  validateRequiredFields,
  validateRequiredFieldsForKeys,
  formatRequiredFieldErrors,
  listRequiredEditorFields,
  type ValidateRequiredFieldsMode,
} from "@shared/validateRequiredFields";
import {
  LIVE_REQUIRED_FIELDS_CODE,
  circularRequiredFieldsHint,
  type LiveRequiredFieldsCode,
} from "@shared/liveSeoGate";
import {
  resolveMicroValidationFlags,
  shouldSkipLiveGate,
  type ValidationIntent,
} from "@shared/validationScope";
import { isDraftEntry } from "./draft-entry";
import { isEntryDetached, isSharedLayoutType } from "./shared-layout-entry";
import { mergeSingleTemplate } from "./database-single-loader";
import { deepMerge } from "./utils/deepMerge";
import { isEmptyDetachedLocale } from "@shared/isEmptyLocaleContent";
import { getFolder } from "./content-types";
import { getDefaultContentRoot } from "./site-config";
import path from "path";
import fs from "fs";
import { contentIndex } from "./content-index";
import { formatSchemaOrgCompanionGateError } from "./schema-org-requirements";
import {
  validateFormFieldSources,
  formatFormFieldSourceErrors,
} from "@shared/validateFormFieldSources";
import { getTrackingSettings } from "./settings";

export type LiveSeoGateOptions = {
  contentType: string;
  slug: string;
  locale: string;
  /** Merged or locale+common data about to be persisted / published. */
  pageData: Record<string, unknown>;
  contentRoot?: string;
  mode?: ValidateRequiredFieldsMode;
  /** publish = full gate; micro = scoped by touchedPaths. Default micro. */
  intent?: ValidationIntent;
  /** Dot paths being written (meta.robots, locations, title, …). */
  touchedPaths?: string[];
  /**
   * When true, skip the gate (draft-only writes).
   * If omitted, uses isDraftEntry() when no live locales exist.
   */
  isDraftWrite?: boolean;
};

export type LiveSeoGateFailure = {
  message: string;
  code:
    | LiveRequiredFieldsCode
    | "empty_detached_locale"
    | "schema_org_companion";
  /** Field paths that must be set together (meta.* and/or editor.required keys). */
  missing_fields?: string[];
};

/**
 * Structured live SEO + required-field evaluation.
 * Prefer this when callers need missing_fields for agent guidance.
 */
export function evaluateLiveEntrySeoAndRequiredFields(
  opts: LiveSeoGateOptions,
): LiveSeoGateFailure | null {
  const {
    contentType,
    slug,
    locale,
    pageData,
    contentRoot,
    mode = "live_update",
    intent = "micro",
    touchedPaths = [],
  } = opts;

  if (opts.isDraftWrite === true) return null;
  if (
    opts.isDraftWrite !== false &&
    isDraftEntry(contentType, slug, contentRoot)
  ) {
    return null;
  }

  if (shouldSkipLiveGate(intent, touchedPaths)) {
    return null;
  }

  const config = getContentTypeConfig(contentType, contentRoot);
  const editor = config?.editor as
    | Record<string, { required?: boolean | "attached"; type?: string; schema?: Record<string, unknown> }>
    | undefined;
  const shared = isSharedLayoutType(contentType, contentRoot);
  const detached = isEntryDetached(contentType, slug, contentRoot);
  const requiredOpts = {
    isSharedLayout: shared,
    isDetached: detached,
  };
  const requiredEditorKeys = listRequiredEditorFields(editor, requiredOpts);
  const flags = resolveMicroValidationFlags({
    intent,
    touchedPaths,
    requiredEditorKeys,
  });

  // Attached shared-layout: meta often lives only on template.{locale}.yml as {{ entry.* }}.
  let pageForResolve = pageData;
  if (shared && !detached) {
    const template = mergeSingleTemplate(
      contentType,
      locale,
      slug,
      undefined,
      contentRoot,
    );
    if (template) {
      pageForResolve = deepMerge(template, pageData) as Record<string, unknown>;
    }
  }

  const singleEntry =
    finalizeSingleEntryForTemplates(
      buildSingleEntryFromContent(contentType, pageForResolve, {
        slug,
        locale,
        contentRoot,
      }) || {},
      { slug, locale },
    ) || {};

  const resolvedPage = resolveSingleVars(pageForResolve, singleEntry) as Record<
    string,
    unknown
  >;

  // Site globals in meta (e.g. hiring rate) must resolve before the leftover-{{ }} gate.
  const root = contentRoot ?? getDefaultContentRoot();
  let region: string | undefined;
  if (typeof pageForResolve.region === "string" && pageForResolve.region.trim()) {
    region = pageForResolve.region.trim();
  }
  const metaForGate = resolveAllTemplateVars(resolvedPage.meta ?? {}, {
    singleEntry,
    meta: (resolvedPage.meta as Record<string, unknown>) || undefined,
    contentRoot: root,
    context: { locale, region },
    skipSiteVars: false,
  });

  let conversionNames: string[] = [];
  let crmTags: string[] = [];
  try {
    const tracking = getTrackingSettings(contentRoot);
    conversionNames = (tracking.conversion_events || [])
      .map((e) => (typeof e === "string" ? e : (e as { name?: string })?.name))
      .filter((n): n is string => typeof n === "string" && n.trim().length > 0);
    crmTags = Array.isArray(tracking.leads_expected_tags)
      ? tracking.leads_expected_tags.filter((t): t is string => typeof t === "string")
      : [];
  } catch {
    /* settings may be unavailable in some test harnesses */
  }

  const fieldOpts = {
    ...requiredOpts,
    conversionNames,
    crmTags,
  };

  const metaResult =
    flags.runFull || flags.metaKeys === null
      ? validateRequiredMeta(metaForGate)
      : validateRequiredMetaKeys(metaForGate, flags.metaKeys);

  const fieldResult =
    flags.runFull || flags.bodyKeys === null
      ? validateRequiredFields(
          editor,
          { ...singleEntry, ...resolvedPage },
          mode,
          fieldOpts,
        )
      : validateRequiredFieldsForKeys(
          editor,
          { ...singleEntry, ...resolvedPage },
          flags.bodyKeys,
          mode,
          fieldOpts,
        );

  const missing_fields: string[] = [];
  if (!metaResult.ok) {
    for (const e of metaResult.errors) missing_fields.push(e.field);
  }
  if (!fieldResult.ok) {
    for (const e of fieldResult.errors) missing_fields.push(e.field);
  }

  if (missing_fields.length > 0) {
    const parts: string[] = [];
    const metaErr = formatMetaValidationErrors(metaResult);
    if (metaErr) parts.push(metaErr);
    const fieldErr = formatRequiredFieldErrors(fieldResult);
    if (fieldErr) parts.push(fieldErr);
    const hint = circularRequiredFieldsHint(missing_fields);
    if (hint) parts.push(hint);
    return {
      message: parts.join(" "),
      code: LIVE_REQUIRED_FIELDS_CODE,
      missing_fields,
    };
  }

  const emptyLocaleErr = flags.runEmptyDetached
    ? assertNotEmptyDetachedLocale({
        contentType,
        slug,
        locale,
        pageData: resolvedPage,
        contentRoot,
      })
    : null;
  if (emptyLocaleErr) {
    return { message: emptyLocaleErr, code: "empty_detached_locale" };
  }

  const companionErr = flags.runSchemaOrgCompanion
    ? formatSchemaOrgCompanionGateError({
        sections: resolvedPage.sections,
        contentType,
        slug,
        locale,
        contentRoot,
      })
    : null;
  if (companionErr) {
    return { message: companionErr, code: "schema_org_companion" };
  }

  const formSourceIssues = flags.runFormSources
    ? validateFormFieldSources({
        singleEntry: { ...singleEntry, ...resolvedPage },
        editor: editor as Record<string, { type?: string }> | undefined,
        sections: Array.isArray(resolvedPage.sections)
          ? resolvedPage.sections
          : [],
        mode: "publish",
      })
    : [];
  const formSourceErr = flags.runFormSources
    ? formatFormFieldSourceErrors(formSourceIssues)
    : null;
  if (formSourceErr) {
    return {
      message: formSourceErr,
      code: LIVE_REQUIRED_FIELDS_CODE,
      missing_fields: formSourceIssues
        .filter((i) => i.severity === "error" && i.relationField)
        .map((i) => i.relationField!),
    };
  }

  return null;
}

/**
 * Validate live SEO meta + required editor fields on merged page data.
 * Returns an error string suitable for API 400, or null if OK / skipped.
 */
export function assertLiveEntrySeoAndRequiredFields(
  opts: LiveSeoGateOptions,
): string | null {
  return evaluateLiveEntrySeoAndRequiredFields(opts)?.message ?? null;
}

/**
 * Block publishing / live writes of empty detached locales.
 */
export function assertNotEmptyDetachedLocale(opts: {
  contentType: string;
  slug: string;
  locale: string;
  pageData?: Record<string, unknown> | null;
  contentRoot?: string;
}): string | null {
  const contentRoot = opts.contentRoot ?? getDefaultContentRoot();
  if (!isEntryDetached(opts.contentType, opts.slug, contentRoot)) return null;

  let merged = opts.pageData;
  if (!merged) {
    try {
      merged =
        (contentIndex.loadMergedContent(opts.contentType, opts.slug, opts.locale)
          .data as Record<string, unknown> | null) ?? null;
    } catch {
      merged = null;
    }
  }

  if (!isEmptyDetachedLocale({ detached: true, merged })) return null;

  const folder = getFolder(opts.contentType, contentRoot);
  const filePath = path.join(folder, opts.slug, `${opts.locale}.yml`);
  const abs = path.join(contentRoot, filePath);
  const exists = fs.existsSync(abs);

  return (
    `EMPTY_LOCALE: detached locale "${opts.locale}" has no sections and no content` +
    (exists ? ` (${filePath}).` : ".") +
    " Translate the draft or remove the stub before publishing."
  );
}
