import fs from "fs";
import { getDefaultContentFolder, getDefaultContentRoot } from "./site-config";
import path from "path";
import yaml from "js-yaml";
import { escapeObjectVars, unescapeYamlDump } from "@shared/templateVars";
import { isLocaleOnlyUrlParam } from "@shared/urlParamRules";
import { getConsentKeyError } from "@shared/consentLegacyKeys";
import {
  wipeSectionOnDuplicate,
  wipeDocumentSectionsOnDuplicate,
  type ClearedField,
} from "@shared/wipeOnDuplicate";
import { generateSectionId } from "./utils/generateSectionId";
import { loadAllFieldEditors } from "./component-registry";
import { validateDocIdentity } from "./validate-content-identity";
import { collectTouchedSectionIndexes } from "@shared/validateSectionIdentity";
import { validateFaqListingSections } from "@shared/validateFaqListing";
import {
  evaluateLiveEntrySeoAndRequiredFields,
  type LiveSeoGateFailure,
} from "./live-entry-seo-gate";
import {
  getEntryContentDir,
  isTemplateVersioningSlug,
  listLiveLocales,
} from "./draft-entry";
import {
  clampSchemaOrgSectionsLeading,
  isSchemaOrgSection,
  schemaOrgInsertIndex,
  getSchemaOrgType,
} from "@shared/schema-org-sections";
import {
  getWebsiteTemplateProperties,
  getOrganizationTemplateProperties,
} from "./schema-org";

function getDefaultContentRootName(): string {
  try {
    const { getDefaultSite } = require("./site-manager") as typeof import("./site-manager");
    return getDefaultSite().contentRootName;
  } catch {
    return getDefaultContentFolder();
  }
}

function safeYamlDump(obj: unknown, opts?: yaml.DumpOptions): string {
  const { escaped, map } = escapeObjectVars(obj);
  const dumped = yaml.dump(escaped, opts);
  return unescapeYamlDump(dumped, map);
}
import type { EditOperation } from "@shared/schema";
import { normalizeLocale, getSupportedLocales, getDefaultLocale } from "./settings";
import { markFileAsModified } from "./sync-state";
import { contentIndex, ContentIndex } from "./content-index";
import { deepMerge } from "./utils/deepMerge";
import { mergeSingleTemplate, extractVariableFields, TEMPLATE_EXPR_RE } from "./database-single-loader";
import { getDatabaseName, getLookupKey, getFieldMapping, isValidType, getAllTypes, getFolder, getContentTypeConfig, listExtraUrlPatternParams, detectUrlParamValueShape, formatUrlParamFieldValue, getRawUrlParamValue, type UrlParamValueShape } from "./content-types";
import { databaseManager, DatabaseManager } from "./database";
import { regenerateSectionIds } from "./utils/regenerateSectionIds";
import { canonicalSectionId, sectionIdCandidates, sectionMatchesId } from "./utils/sectionIdentity";
import {
  invalidSectionIndexMessage,
  isInvalidSectionIndexError,
  keepSectionAfterTypelessScrub,
  sectionIndexFromUpdateFieldPath,
  sectionSlotExists,
} from "@shared/sectionLeftovers";
import {
  fanOutStructuralOpsToSiblings,
  cleanSectionIdFromEntryOverlays,
  isAllowlistedSectionFieldPath,
} from "./shared-layout-sync";
import { extractSeoUpdatesFromOps } from "./seo-fields";
import { writeSeoFields } from "./seo-index";

function applySeoUpdatesAfterWrite<T extends { success: boolean; error?: string }>(
  result: T,
  seoUpdates: Record<string, unknown>,
  opts: {
    contentType: string;
    slug: string;
    locale: string;
    author?: string;
    contentRoot?: string;
    variant?: string;
    ci?: ContentIndex;
  },
): T | { success: false; error: string } {
  if (!result.success || Object.keys(seoUpdates).length === 0) return result;
  const seoResult = writeSeoFields({
    contentType: opts.contentType,
    slug: opts.slug,
    locale: opts.locale,
    updates: seoUpdates,
    author: opts.author,
    contentRoot: opts.contentRoot,
    variant: opts.variant,
    ci: opts.ci,
  });
  if (!seoResult.success) return { success: false, error: seoResult.error };
  return result;
}

/**
 * Draft/variant section saves: only identity-check touched section indexes.
 * Live locale / full-list rewrites: omit onlyValidateIndexes (full document).
 * Publish/promote never passes this (always full via validateYamlIdentity).
 */
function identityValidateOptsForWrite(opts: {
  isDraftOrVariantWrite: boolean;
  operations: EditOperation[];
  skipIdentityIndexes?: Set<number>;
  contentType: string;
  contentSlug: string;
}): {
  contentType: string;
  contentSlug: string;
  skipIdentityIndexes?: Set<number>;
  onlyValidateIndexes?: Set<number>;
} {
  const base = {
    contentType: opts.contentType,
    contentSlug: opts.contentSlug,
    skipIdentityIndexes: opts.skipIdentityIndexes,
  };
  if (!opts.isDraftOrVariantWrite) return base;
  const touched = collectTouchedSectionIndexes(opts.operations);
  if (!touched || touched.size === 0) return base;
  return { ...base, onlyValidateIndexes: touched };
}import {
  isEntryDetached,
  isSharedLayoutType,
  isTemplateVersioningSlug,
  rejectAttachedStructuralEdit,
} from "./shared-layout-entry";
import {
  applyEditorialUpdatedAtToData,
  type EditorialOp,
} from "./editorial-updated-at";
import {
  DEFAULT_DRAFT_VARIANT,
  usesDraftFirstCreate,
  buildDraftVersioning,
  writeVersioningFile,
  rejectLiveWriteIfDraft,
} from "./draft-entry";

/** Create/duplicate: exactly one locale at a time (all content types). */
export const SINGLE_LOCALE_CREATE_ERROR =
  "Create exactly one locale at a time. Add translations later via translate_entry (draft.{locale}.yml) then promote or publish_draft.";

/** @deprecated Use SINGLE_LOCALE_CREATE_ERROR */
export const SHARED_LAYOUT_SINGLE_LOCALE_CREATE_ERROR = SINGLE_LOCALE_CREATE_ERROR;
import {
  RESERVED_PUBLISHED_AT_FIELD,
  clearPublishedAtFromCommon,
  ensurePublishedAtOnce,
  isPublishedAtEmpty,
} from "./published-at";
import { FIELD_OVERRIDES_KEY } from "./field-overrides";

function cloneYamlData(data: Record<string, unknown>): Record<string, unknown> {
  try {
    return structuredClone(data);
  } catch {
    return JSON.parse(JSON.stringify(data)) as Record<string, unknown>;
  }
}

function stampLocaleYamlBeforeWrite(opts: {
  data: Record<string, unknown>;
  previous: Record<string, unknown>;
  operations: EditOperation[];
  contentType: string;
  slug: string;
  locale?: string;
  filePath: string;
  contentRoot?: string;
  author?: string;
  ci?: ContentIndex;
}): void {
  applyEditorialUpdatedAtToData({
    data: opts.data,
    previous: opts.previous,
    operations: opts.operations as EditorialOp[],
    contentType: opts.contentType,
    slug: opts.slug,
    contentRoot: opts.contentRoot,
  });
}

/** After duplicate copy: never keep source published_at; stamp if the copy is immediately live. */
function applyPublishedAtAfterDuplicate(
  type: string,
  slug: string,
  draftFirst: boolean,
  author: string | undefined,
  contentRoot: string,
): void {
  clearPublishedAtFromCommon(type, slug, author, contentRoot);
  for (const loc of getSupportedLocales()) {
    const localePath = path.join(contentRoot, getFolder(type, contentRoot), slug, `${loc}.yml`);
    if (!fs.existsSync(localePath)) continue;
    try {
      const data = (yaml.load(fs.readFileSync(localePath, "utf-8")) as Record<string, unknown>) || {};
      const ovr = data[FIELD_OVERRIDES_KEY];
      if (ovr && typeof ovr === "object" && !Array.isArray(ovr) && RESERVED_PUBLISHED_AT_FIELD in (ovr as object)) {
        const nextOvr = { ...(ovr as Record<string, unknown>) };
        delete nextOvr[RESERVED_PUBLISHED_AT_FIELD];
        if (Object.keys(nextOvr).length === 0) delete data[FIELD_OVERRIDES_KEY];
        else data[FIELD_OVERRIDES_KEY] = nextOvr;
        fs.writeFileSync(localePath, yaml.dump(data, { lineWidth: 120, noRefs: true, sortKeys: false }), "utf-8");
        markFileAsModified(localePath, author, undefined, contentRoot);
      }
    } catch {
      /* ignore locale cleanup errors */
    }
  }
  if (!draftFirst) {
    ensurePublishedAtOnce(type, slug, { author, contentRoot });
  }
}
import { getOrCreateStaffUserId, getUser } from "./user-store";
import {
  refreshSitemapEntry,
  refreshSitemapEntriesForContentKey,
  invalidateSitemapEntry,
  invalidateSitemapEntriesByContentKey,
} from "./sitemap";
import { clearRedirectCache } from "./redirects";
import { clearSsrSchemaCache } from "./ssr-schema";
import { child } from "./logger";
const log = child({ module: "content-editor" });



interface ContentEditRequest {
  contentType: string;
  slug: string;
  locale: string;
  operations: EditOperation[];
  variant?: string;
  version?: number;
  author?: string;
  contentRoot?: string;
  database?: DatabaseManager;
  ci?: ContentIndex;
  /** When true, skip sibling-locale shared-layout fan-out (MCP agents sync via next_actions). */
  skipSharedLayoutFanOut?: boolean;
  /** Force write layer for shared-layout types: type_single → single.{locale}.yml; entry → per-entry overlay. */
  layoutTarget?: "entry" | "type_single";
  /**
   * When true, skip entry-preview capture enqueue after save.
   * Only set by the bulk-meta endpoint (default false elsewhere).
   */
  skipPreviewCapture?: boolean;
}

function getValueAtPath(obj: Record<string, unknown>, pathStr: string): unknown {
  const parts = pathStr.replace(/\[(\d+)\]/g, ".$1").split(".");
  let current: unknown = obj;
  
  for (const part of parts) {
    if (current === null || current === undefined) return undefined;
    if (typeof current !== "object") return undefined;
    current = (current as Record<string, unknown>)[part];
  }
  
  return current;
}

/** Persist path updates; identity fields keep YAML `null` (opt-out) instead of deleting the key. */
export function setValueAtPath(obj: Record<string, unknown>, pathStr: string, value: unknown): void {
  const parts = pathStr.replace(/\[(\d+)\]/g, ".$1").split(".");
  let current: Record<string, unknown> = obj;
  
  for (let i = 0; i < parts.length - 1; i++) {
    const part = parts[i];
    if (current[part] === undefined) {
      // Create intermediate object or array
      const nextPart = parts[i + 1];
      current[part] = /^\d+$/.test(nextPart) ? [] : {};
    }
    current = current[part] as Record<string, unknown>;
  }
  
  const lastPart = parts[parts.length - 1];
  // undefined deletes the key (e.g. `_label`). null is persisted for identity
  // opt-out: conversion_name / ecommerce_products / *.conversion_name / *.ecommerce_products
  const persistNull =
    value === null &&
    (lastPart === "conversion_name" ||
      lastPart === "ecommerce_products" ||
      pathStr.endsWith(".conversion_name") ||
      pathStr.endsWith(".ecommerce_products") ||
      pathStr === "conversion_name" ||
      pathStr === "ecommerce_products");
  if (value === undefined || (value === null && !persistNull)) {
    delete current[lastPart];
  } else {
    current[lastPart] = value;
  }
}

/** True if any string leaf in the object still contains `{{ ... }}`. */
function templateObjectHasExpressions(value: unknown): boolean {
  if (typeof value === "string") return TEMPLATE_EXPR_RE.test(value);
  if (Array.isArray(value)) return value.some(templateObjectHasExpressions);
  if (value !== null && typeof value === "object") {
    return Object.values(value as Record<string, unknown>).some(templateObjectHasExpressions);
  }
  return false;
}

/**
 * Listing `item_template` uses `{{ single.* }}` for each row. Delivery used to
 * bake page-level values into it; if a client still sends a wiped template,
 * keep the authored expressions from the existing section.
 */
function preserveListingItemTemplate(
  sectionToSave: Record<string, unknown>,
  existingSection: Record<string, unknown> | undefined,
): void {
  if (!existingSection) return;

  const existingRoot = existingSection.item_template;
  const incomingRoot = sectionToSave.item_template;
  if (
    templateObjectHasExpressions(existingRoot) &&
    incomingRoot !== undefined &&
    !templateObjectHasExpressions(incomingRoot)
  ) {
    sectionToSave.item_template = existingRoot;
  }

  const existingDyn = existingSection.dynamic_entries as Record<string, unknown> | undefined;
  const incomingDyn = sectionToSave.dynamic_entries as Record<string, unknown> | undefined;
  if (!existingDyn || !incomingDyn) return;

  const existingTpl = existingDyn.item_template;
  const incomingTpl = incomingDyn.item_template;
  if (
    templateObjectHasExpressions(existingTpl) &&
    incomingTpl !== undefined &&
    !templateObjectHasExpressions(incomingTpl)
  ) {
    incomingDyn.item_template = existingTpl;
  }
}

function applyOperation(
  content: Record<string, unknown>,
  operation: EditOperation,
  opts?: { contentRoot?: string; locale?: string },
): { clearedFields?: ClearedField[]; insertedSectionIndex?: number } {
  const result: { clearedFields?: ClearedField[]; insertedSectionIndex?: number } = {};
  switch (operation.action) {
    case "update_field": {
      const sectionIdx = sectionIndexFromUpdateFieldPath(operation.path);
      if (sectionIdx !== null && !sectionSlotExists(content, sectionIdx)) {
        throw new Error(invalidSectionIndexMessage(sectionIdx));
      }
      setValueAtPath(content, operation.path, operation.value);
      break;
    }
    
    case "reorder_sections": {
      const sections = content.sections as unknown[];
      if (!Array.isArray(sections)) throw new Error("sections is not an array");
      if (operation.from < 0 || operation.from >= sections.length) throw new Error("Invalid from index");
      if (operation.to < 0 || operation.to >= sections.length) throw new Error("Invalid to index");
      
      const [moved] = sections.splice(operation.from, 1);
      sections.splice(operation.to, 0, moved);
      content.sections = clampSchemaOrgSectionsLeading(sections);
      break;
    }
    
    case "add_item": {
      let arr = getValueAtPath(content, operation.path) as unknown[];
      if (!Array.isArray(arr)) {
        if (operation.path === "sections") {
          (content as Record<string, unknown>).sections = [];
          arr = (content as Record<string, unknown>).sections as unknown[];
        } else {
          throw new Error(`Path ${operation.path} is not an array`);
        }
      }
      
      let insertedIndex: number;
      let itemToInsert = operation.item;
      if (operation.path === "sections" && itemToInsert && typeof itemToInsert === "object") {
        const raw = itemToInsert as Record<string, unknown>;
        const sectionType = String(raw.type ?? "");
        const editors =
          loadAllFieldEditors(opts?.contentRoot)[sectionType] ?? {};
        const { section: wiped, cleared } = wipeSectionOnDuplicate(raw, editors);
        wiped.section_id = generateSectionId((wiped.type as string) || "section");
        if (!wiped.paddingY) {
          wiped.paddingY = { desktop: "sm" };
        }
        // Prefill WebSite / Organization properties from site schema-org.yml when missing.
        if (isSchemaOrgSection(wiped)) {
          const schemaType = getSchemaOrgType(wiped);
          const props = wiped.properties;
          const missingProps =
            props == null ||
            (typeof props === "object" &&
              !Array.isArray(props) &&
              Object.keys(props as Record<string, unknown>).length === 0);
          if (missingProps && (schemaType === "WebSite" || schemaType === "Organization")) {
            const locale = opts?.locale || "en";
            const contentRoot = opts?.contentRoot || getDefaultContentRoot();
            const template =
              schemaType === "WebSite"
                ? getWebsiteTemplateProperties(locale, contentRoot)
                : getOrganizationTemplateProperties(locale, contentRoot);
            if (template) {
              wiped.properties = { ...template };
            }
          }
        }
        itemToInsert = wiped;
        if (cleared.length > 0) {
          result.clearedFields = cleared.map((path) => ({
            sectionType,
            path,
            sectionIndex: operation.index !== undefined && operation.index >= 0
              ? operation.index
              : arr.length,
          }));
        }
      }
      if (operation.path === "sections" && isSchemaOrgSection(itemToInsert)) {
        const insertAt = schemaOrgInsertIndex(arr);
        arr.splice(insertAt, 0, itemToInsert);
        insertedIndex = insertAt;
        content.sections = clampSchemaOrgSectionsLeading(arr);
      } else if (operation.index !== undefined && operation.index >= 0 && operation.index <= arr.length) {
        arr.splice(operation.index, 0, itemToInsert);
        insertedIndex = operation.index;
      } else {
        arr.push(itemToInsert);
        insertedIndex = arr.length - 1;
      }
      if (operation.path === "sections" && !isSchemaOrgSection(itemToInsert)) {
        content.sections = clampSchemaOrgSectionsLeading(arr as unknown[]);
        insertedIndex = (content.sections as unknown[]).indexOf(itemToInsert);
        if (insertedIndex < 0) insertedIndex = arr.length - 1;
      }
      if (operation.path === "sections") {
        result.insertedSectionIndex = insertedIndex!;
        if (result.clearedFields) {
          result.clearedFields = result.clearedFields.map((c) => ({
            ...c,
            sectionIndex: insertedIndex!,
          }));
        }
      }
      break;
    }
    
    case "remove_item": {
      const arr = getValueAtPath(content, operation.path) as unknown[];
      if (!Array.isArray(arr)) throw new Error(`Path ${operation.path} is not an array`);
      if (operation.index < 0 || operation.index >= arr.length) throw new Error("Invalid index");
      
      arr.splice(operation.index, 1);
      break;
    }
    
    case "update_section": {
      const sections = content.sections as unknown[];
      if (!Array.isArray(sections)) throw new Error("sections is not an array");
      if (operation.index < 0 || operation.index >= sections.length) throw new Error("Invalid section index");
      
      const sectionToSave = operation.section as Record<string, unknown>;
      if (sectionToSave && typeof sectionToSave === "object" && sectionToSave.dynamic_entries) {
        delete sectionToSave.items;
        delete sectionToSave._dynamic_meta;
      }
      if (sectionToSave && typeof sectionToSave === "object") {
        delete sectionToSave._imageSizes;
      }
      const existingSection = sections[operation.index] as Record<string, unknown>;
      if (sectionToSave && typeof sectionToSave === "object") {
        preserveListingItemTemplate(sectionToSave, existingSection);
      }
      const existingId = existingSection?.section_id;
      // Preserve _insertAfterSectionId: this controls where per-entry sections appear
      // in the merged view. If the client doesn't echo it back, losing it causes the
      // section to fall to the end of the page on the next load.
      const existingInsertAfter = existingSection?._insertAfterSectionId;
      sections[operation.index] = sectionToSave;
      if (existingId && !sectionToSave.section_id) {
        (sections[operation.index] as Record<string, unknown>).section_id = existingId;
      }
      if (existingInsertAfter !== undefined && sectionToSave._insertAfterSectionId === undefined) {
        (sections[operation.index] as Record<string, unknown>)._insertAfterSectionId = existingInsertAfter;
      }
      break;
    }
    
    case "replace_all_sections": {
      if (!Array.isArray(operation.sections)) throw new Error("sections must be an array");
      content.sections = (operation.sections as Record<string, unknown>[]).map((sec) => {
        if (sec && typeof sec === "object" && sec.dynamic_entries) {
          const { items: _items, _dynamic_meta: _meta, ...authored } = sec;
          delete (authored as Record<string, unknown>)._imageSizes;
          if (!authored.section_id) authored.section_id = generateSectionId((authored.type as string) || "section");
          return authored;
        }
        if (sec && typeof sec === "object") delete sec._imageSizes;
        if (!sec.section_id) sec.section_id = generateSectionId((sec.type as string) || "section");
        return sec;
      });
      break;
    }
  }
  return result;
}

export async function editContent(request: ContentEditRequest): Promise<{
  success: boolean;
  error?: string;
  /** Structured live-gate code when SEO/required fields block the write. */
  errorCode?: string;
  missingFields?: string[];
  warning?: string;
  updatedSections?: unknown[];
  clearedFields?: ClearedField[];
}> {
  const { contentType, slug, locale: rawLocale, operations: requestOperations, variant, version, contentRoot } = request;
  // Use per-site ContentIndex when provided (avoids resolving files against default site)
  const ci = request.ci ?? contentIndex;
  
  // Normalize locale to prevent es-ES, en-US etc from causing file lookup failures
  const locale = normalizeLocale(rawLocale);
  
  // Validate that version is not provided without a variant
  const hasVariant = variant !== undefined && variant !== null && variant !== "";
  const hasValidVersion = version !== undefined && version !== null && Number.isFinite(version);
  if (hasValidVersion && !hasVariant) {
    return { success: false, error: "version cannot be provided without variant" };
  }

  const draftWriteGate = rejectLiveWriteIfDraft({
    contentType,
    slug,
    locale,
    variant: hasVariant ? variant : undefined,
    contentRoot,
  });
  if (!draftWriteGate.ok) {
    return { success: false, error: draftWriteGate.error };
  }

  const seoExtract = extractSeoUpdatesFromOps(
    requestOperations as Array<{ action?: string; path?: string; value?: unknown }>,
  );
  if (seoExtract.commonSeo) {
    return {
      success: false,
      error:
        "Unknown seo.* field. Known: seo.main_keyword, seo.pillar_path, seo.is_pillar. seo.* always writes the locale file (not _common.yml).",
    };
  }
  const seoUpdates = seoExtract.seoUpdates;
  const operations =
    Object.keys(seoUpdates).length > 0 ? (seoExtract.rest as typeof requestOperations) : requestOperations;
  if (Object.keys(seoUpdates).length > 0 && operations.length === 0) {
    const seoResult = writeSeoFields({
      contentType,
      slug,
      locale,
      updates: seoUpdates,
      author: request.author,
      contentRoot,
      variant: hasVariant ? variant : undefined,
      ci,
    });
    if (!seoResult.success) {
      return { success: false, error: seoResult.error };
    }
    return { success: true, updatedSections: [] };
  }

  for (const op of operations) {
    if (op.action === "update_field" && op.path === "slug") {
      return {
        success: false,
        error:
          "Locale URL slug cannot be changed via update_field. Use POST /api/content/rename-slug instead.",
      };
    }
  }
  
  try {
    // Attached shared-layout: reject entry structural overlays and layout/menu writes
    const attachedStructuralErr = rejectAttachedStructuralEdit(contentType, slug, contentRoot);
    if (attachedStructuralErr) {
      const hasSectionOps = operations.some((op) => {
        if (
          op.action === "add_section" ||
          op.action === "remove_section" ||
          op.action === "reorder_sections" ||
          op.action === "duplicate_section" ||
          op.action === "update_section" ||
          op.action === "replace_all_sections" ||
          op.action === "add_item" ||
          op.action === "remove_item"
        ) {
          return true;
        }
        if (op.action === "update_field") {
          const p = (op as { path?: string }).path || "";
          return p === "layout" || p.startsWith("layout.") || p.startsWith("sections");
        }
        return false;
      });
      if (request.layoutTarget === "entry" && hasSectionOps) {
        return { success: false, error: attachedStructuralErr };
      }
      if (hasSectionOps && request.layoutTarget !== "type_single") {
        // Per-entry file writes of sections/layout are forbidden when attached
        const onlyEntryLayer =
          request.layoutTarget === "entry" ||
          operations.every((op) => {
            if (op.action === "update_field") {
              const p = (op as { path?: string }).path || "";
              return p === "layout" || p.startsWith("layout.") || p.startsWith("sections");
            }
            return (
              op.action === "add_section" ||
              op.action === "remove_section" ||
              op.action === "reorder_sections" ||
              op.action === "duplicate_section" ||
              op.action === "update_section" ||
              op.action === "replace_all_sections"
            );
          });
        if (onlyEntryLayer && request.layoutTarget === "entry") {
          return { success: false, error: attachedStructuralErr };
        }
      }
      // Always reject layout field updates on attached entries (even without layoutTarget)
      const hasLayoutWrite = operations.some(
        (op) =>
          op.action === "update_field" &&
          (((op as { path?: string }).path || "") === "layout" ||
            ((op as { path?: string }).path || "").startsWith("layout.")),
      );
      if (hasLayoutWrite && request.layoutTarget !== "type_single") {
        return { success: false, error: attachedStructuralErr };
      }
    }

    // Forced type_single: load/write shared single.{locale}.yml or single.{variant}.{locale}.yml
    if (request.layoutTarget === "type_single") {
      const folder = getFolder(contentType);
      const rootPath = contentRoot
        ? (path.isAbsolute(contentRoot) ? contentRoot : path.join(process.cwd(), contentRoot))
        : path.join(process.cwd(), getDefaultContentRootName());
      const templateFilePath = hasVariant
        ? path.join(rootPath, folder, `single.${variant}.${locale}.yml`)
        : path.join(rootPath, folder, `single.${locale}.yml`);
      if (!fs.existsSync(templateFilePath)) {
        return {
          success: false,
          error: hasVariant
            ? `Template variant not found: ${folder}/single.${variant}.${locale}.yml`
            : `Shared template not found: ${folder}/single.${locale}.yml`,
        };
      }
      const rawTemplate = fs.readFileSync(templateFilePath, "utf-8");
      const templateLocaleData = (ci.safeYamlLoad(rawTemplate) as Record<string, unknown>) || {};
      return applySeoUpdatesAfterWrite(
        handleSharedTemplateEdit({
        contentType,
        slug,
        locale,
        operations,
        localeData: templateLocaleData,
        filePath: templateFilePath,
        author: request.author,
        contentRoot,
        database: request.database,
        ci,
        // Draft template variants must not fan out onto live sibling singles
        skipSharedLayoutFanOut: hasVariant || request.skipSharedLayoutFanOut,
        isDraftOrVariantWrite: hasVariant,
      }),
        seoUpdates,
        {
          contentType,
          slug,
          locale,
          author: request.author,
          contentRoot,
          variant: hasVariant ? variant : undefined,
          ci,
        },
      );
    }

    const { data: localeData, filePath, error: loadError, isSharedTemplate } = ci.loadLocaleData(contentType, slug, locale, variant, version);
    if (!localeData || loadError) {
      return { success: false, error: loadError || `Content file not found` };
    }

    // For DB-backed single pages the localeData points at the shared template.
    // We must NOT write variable-field changes back to that shared file — instead
    // we patch only the specific entry in the database file cache.
    // layoutTarget "entry" forces per-entry overlay writes even when load hit the template.
    if (isSharedTemplate && request.layoutTarget !== "entry") {
      // Top-level field ops (e.g. "meta", "schema") must NEVER touch the shared
      // template — they belong in the per-entry locale file for this slug.
      // Create it if it doesn't exist yet.
      const allTopLevelFields = operations.length > 0 && operations.every(
        op => op.action === "update_field" && !op.path.startsWith("sections.")
      );
      if (allTopLevelFields) {
        return applySeoUpdatesAfterWrite(
          writeTopLevelFieldsToPerEntryFile({ contentType, slug, locale, operations, author: request.author, contentRoot }),
          seoUpdates,
          {
            contentType,
            slug,
            locale,
            author: request.author,
            contentRoot,
            variant: hasVariant ? variant : undefined,
            ci,
          },
        );
      }
      return applySeoUpdatesAfterWrite(
        handleSharedTemplateEdit({
          contentType,
          slug,
          locale,
          operations,
          localeData,
          filePath,
          author: request.author,
          contentRoot,
          database: request.database,
          ci,
          skipSharedLayoutFanOut: request.skipSharedLayoutFanOut,
          isDraftOrVariantWrite: hasVariant,
        }),
        seoUpdates,
        {
          contentType,
          slug,
          locale,
          author: request.author,
          contentRoot,
          variant: hasVariant ? variant : undefined,
          ci,
        },
      );
    }

    // layoutTarget "entry" while load resolved to shared template: create/write per-entry file
    if (isSharedTemplate && request.layoutTarget === "entry") {
      const blocked = rejectAttachedStructuralEdit(contentType, slug, contentRoot);
      if (blocked) {
        const hasStructural = operations.some((op) => {
          if (op.action === "update_field") {
            const p = (op as { path?: string }).path || "";
            return !p || p.startsWith("sections") || p === "layout" || p.startsWith("layout.");
          }
          return op.action !== "update_field";
        });
        // Data-only top-level fields still allowed
        const allTopLevelDataFields = operations.length > 0 && operations.every(
          (op) =>
            op.action === "update_field" &&
            !((op as { path?: string }).path || "").startsWith("sections") &&
            ((op as { path?: string }).path || "") !== "layout" &&
            !((op as { path?: string }).path || "").startsWith("layout."),
        );
        if (!allTopLevelDataFields) {
          return { success: false, error: blocked };
        }
      }
      const allTopLevelFields = operations.length > 0 && operations.every(
        op => op.action === "update_field" && !op.path.startsWith("sections.")
      );
      if (allTopLevelFields) {
        return applySeoUpdatesAfterWrite(
          writeTopLevelFieldsToPerEntryFile({ contentType, slug, locale, operations, author: request.author, contentRoot }),
          seoUpdates,
          {
            contentType,
            slug,
            locale,
            author: request.author,
            contentRoot,
            variant: hasVariant ? variant : undefined,
            ci,
          },
        );
      }
      // Section ops on entry overlay — writeTopLevel style for sections via per-entry path
      return applySeoUpdatesAfterWrite(
        writeEntryOverlayOps({
          contentType,
          slug,
          locale,
          operations,
          author: request.author,
          contentRoot,
          ci,
        }),
        seoUpdates,
        {
          contentType,
          slug,
          locale,
          author: request.author,
          contentRoot,
          variant: hasVariant ? variant : undefined,
          ci,
        },
      );
    }

    // For attached shared-template entries that have their own per-entry file
    // (isSharedTemplate=false), the client sends indices relative to the fully
    // merged view (template + per-entry). This applies to DB-backed types AND
    // static types with single_template: true — both use mergeSingleTemplate.
    // Translate update_section / sections.N.* update_field indices from the merged
    // view to the per-entry local indices before applying, so we write to the
    // correct section. Template-owned sections (including layout keys like
    // maxWidth / paddingX from the X Spacing popover) must be forwarded to
    // single.{locale}.yml — otherwise Apply writes ignored stubs into the entry
    // file (attached merges use dataOnly and drop entry sections).
    // Detached entries own full structure (entry-only indices); never remap or
    // forward ops to single.{locale}.yml.
    const usesSharedTemplate =
      !isEntryDetached(contentType, slug, contentRoot) &&
      (ci.isDatabaseBacked(contentType) ||
        !!getContentTypeConfig(contentType, contentRoot)?.single_template);
    let resolvedOperations = operations;
    let forwardedTemplateOps = false;
    /** True when stub scrub removed overlay section leftovers (worth rewriting entry YAML). */
    let entryOverlayScrubDirty = false;
    const needsSharedSectionRemap =
      usesSharedTemplate &&
      operations.some(
        (op) =>
          op.action === "update_section" ||
          (op.action === "update_field" &&
            typeof (op as { path?: string }).path === "string" &&
            /^sections\.\d+\./.test((op as { path: string }).path)),
      );
    if (needsSharedSectionRemap) {
      const mergedTemplate = mergeSingleTemplate(contentType, locale, slug, undefined, contentRoot);
      const mergedSections = Array.isArray(mergedTemplate?.sections)
        ? (mergedTemplate!.sections as Record<string, unknown>[])
        : [];

      if (mergedSections.length > 0) {
        const localSections = Array.isArray(localeData.sections)
          ? (localeData.sections as Record<string, unknown>[])
          : [];

        const translated: EditOperation[] = [];
        const templateOps: EditOperation[] = [];
        for (const op of operations) {
          if (op.action === "update_section") {
            // Resolve the section identity from the merged view.
            const mergedSection = mergedSections[op.index] as Record<string, unknown> | undefined;
            const sectionCandidates = sectionIdCandidates(mergedSection);

            // Try to find it by identity in the per-entry local file (either field).
            const localIdx = sectionCandidates.length > 0
              ? localSections.findIndex(
                  s => sectionCandidates.some(c => sectionMatchesId(s as Record<string, unknown>, c))
                )
              : -1;

            if (localIdx === -1) {
              // Section lives in the shared template — collect it for a separate
              // write to single.{locale}.yml via handleSharedTemplateEdit.
              templateOps.push(op);
              continue;
            }

            translated.push({ ...op, index: localIdx });
            continue;
          }

          if (op.action === "update_field") {
            const fieldPathFull = (op as { path?: string }).path || "";
            const m = fieldPathFull.match(/^sections\.(\d+)\.(.+)$/);
            if (!m) {
              translated.push(op);
              continue;
            }
            const mergedIdx = parseInt(m[1], 10);
            const fieldPath = m[2];
            const mergedSection = mergedSections[mergedIdx] as Record<string, unknown> | undefined;
            const sectionCandidates = sectionIdCandidates(mergedSection);
            const localIdx = sectionCandidates.length > 0
              ? localSections.findIndex(
                  s => sectionCandidates.some(c => sectionMatchesId(s as Record<string, unknown>, c))
                )
              : -1;

            // Per-entry-only sections stay on the entry file. Everything else in the
            // attached merged view is template-owned — including layout keys from the
            // X Spacing popover — and must hit single.{locale}.yml.
            if (mergedSection?._perEntrySource) {
              translated.push({
                ...op,
                path: `sections.${localIdx >= 0 ? localIdx : mergedIdx}.${fieldPath}`,
              } as EditOperation);
              continue;
            }

            templateOps.push(op);
            continue;
          }

          translated.push(op);
        }
        resolvedOperations = translated;

        // Forward any template-owned ops to the shared template file.
        if (templateOps.length > 0) {
          // The per-entry file is at 4geeks-com/{type}/{slug}/{locale}.yml
          // Two levels up is 4geeks-com/{type}/ where single.{locale}.yml lives.
          const templateFilePath = path.join(
            path.dirname(path.dirname(filePath)),
            `single.${locale}.yml`,
          );
          if (fs.existsSync(templateFilePath)) {
            const rawTemplate = fs.readFileSync(templateFilePath, "utf-8");
            const templateLocaleData = (ci.safeYamlLoad(rawTemplate) as Record<string, unknown>) || {};
            const templateSections = Array.isArray(templateLocaleData.sections)
              ? (templateLocaleData.sections as Record<string, unknown>[])
              : [];

            // Remap merged-view indices to on-disk template indices by section id.
            const remappedTemplateOps: EditOperation[] = templateOps.map((op) => {
              if (op.action === "update_section") {
                const mergedSection = mergedSections[op.index] as Record<string, unknown> | undefined;
                const candidates = sectionIdCandidates(mergedSection);
                const tplIdx = candidates.length > 0
                  ? templateSections.findIndex((s) =>
                      candidates.some((c) => sectionMatchesId(s, c)),
                    )
                  : -1;
                return tplIdx >= 0 ? ({ ...op, index: tplIdx } as EditOperation) : op;
              }
              if (op.action === "update_field") {
                const fieldPathFull = (op as { path?: string }).path || "";
                const m = fieldPathFull.match(/^sections\.(\d+)\.(.+)$/);
                if (!m) return op;
                const mergedSection = mergedSections[parseInt(m[1], 10)] as
                  | Record<string, unknown>
                  | undefined;
                const candidates = sectionIdCandidates(mergedSection);
                const tplIdx = candidates.length > 0
                  ? templateSections.findIndex((s) =>
                      candidates.some((c) => sectionMatchesId(s, c)),
                    )
                  : -1;
                if (tplIdx < 0) return op;
                return {
                  ...op,
                  path: `sections.${tplIdx}.${m[2]}`,
                } as EditOperation;
              }
              return op;
            });

            const templateResult = handleSharedTemplateEdit({
              contentType,
              slug,
              locale,
              operations: remappedTemplateOps,
              localeData: templateLocaleData,
              filePath: templateFilePath,
              author: request.author,
              contentRoot,
              database: request.database,
              ci,
              skipSharedLayoutFanOut: request.skipSharedLayoutFanOut,
              isDraftOrVariantWrite: hasVariant,
            });
            if (!templateResult.success) {
              return { success: false, error: templateResult.error };
            }
            forwardedTemplateOps = true;

            // Drop identity-less stubs previously written into the entry overlay.
            if (Array.isArray(localeData.sections)) {
              const beforeScrub = localeData.sections as unknown[];
              const afterScrub = beforeScrub.filter((s) =>
                keepSectionAfterTypelessScrub(s, false),
              );
              if (afterScrub.length !== beforeScrub.length) {
                entryOverlayScrubDirty = true;
              }
              localeData.sections = afterScrub;
            }
          }
        }
      }
    }

    // Layout-only Apply (e.g. X Spacing maxWidth) on attached entries: all ops were
    // written to single.{locale}.yml. Persist stub scrub on the entry only when
    // leftovers were actually removed (avoid empty writes / false redirects events).
    if (forwardedTemplateOps && resolvedOperations.length === 0) {
      if (entryOverlayScrubDirty && Array.isArray(localeData.sections)) {
        const scrubbedYaml = safeYamlDump(localeData, {
          lineWidth: -1,
          noRefs: true,
          quotingType: '"',
          forceQuotes: false,
        });
        fs.writeFileSync(filePath, scrubbedYaml, "utf-8");
        markFileAsModified(filePath, request.author, undefined, contentRoot);
      }
      const mergedAfter = mergeSingleTemplate(contentType, locale, slug, undefined, contentRoot);
      return {
        success: true,
        updatedSections: Array.isArray(mergedAfter?.sections)
          ? (mergedAfter!.sections as unknown[])
          : [],
      };
    }

    // Handle reorder_sections for shared-template per-entry pages (DB-backed or
    // static single_template types). The client sends merged-view indices. We must
    // translate them appropriately:
    //   • Both template sections   → forward reorder to the shared template file; swap
    //                                _insertAfterSectionId anchors in the per-entry data.
    //   • Both per-entry sections  → translate merged indices to local per-entry indices
    //                                and apply the reorder directly to localeData.
    //   • Boundary (mixed)         → explicit error; moving across template/per-entry
    //                                boundary is not supported.
    if (usesSharedTemplate && resolvedOperations.some(op => op.action === "reorder_sections")) {
      const mergedView = mergeSingleTemplate(contentType, locale, slug, undefined, contentRoot);
      const mergedSections = Array.isArray(mergedView?.sections)
        ? (mergedView!.sections as Record<string, unknown>[])
        : [];

      // Helper: canonical section identity (section_id, legacy id fallback) as string|null
      const getSectionId = (s: Record<string, unknown>): string | null =>
        canonicalSectionId(s) ?? null;

      const opsToRemove = new Set<number>();

      for (let opIdx = 0; opIdx < resolvedOperations.length; opIdx++) {
        const op = resolvedOperations[opIdx];
        if (op.action !== "reorder_sections") continue;

        const fromIdx = (op as { from: number }).from;
        const toIdx = (op as { to: number }).to;
        const fromSection = mergedSections[fromIdx] as Record<string, unknown> | undefined;
        const toSection = mergedSections[toIdx] as Record<string, unknown> | undefined;

        if (!fromSection || !toSection) {
          throw new Error(`Invalid section indices for reorder: from=${fromIdx} to=${toIdx} (merged view has ${mergedSections.length} sections)`);
        }

        const fromIsPerEntry = !!fromSection._perEntrySource;
        const toIsPerEntry = !!toSection._perEntrySource;

        if (!fromIsPerEntry && !toIsPerEntry) {
          // Both are template sections: forward reorder to shared template file
          const templateFilePath = path.join(
            path.dirname(path.dirname(filePath)),
            `single.${locale}.yml`,
          );

          if (!fs.existsSync(templateFilePath)) {
            throw new Error(`Shared template file not found: ${templateFilePath}`);
          }

          const rawTemplate = fs.readFileSync(templateFilePath, "utf-8");
          const templateData = (contentIndex.safeYamlLoad(rawTemplate) as Record<string, unknown>) || {};
          const previousTemplateData = cloneYamlData(templateData);
          const templateSections = Array.isArray(templateData.sections)
            ? (templateData.sections as Record<string, unknown>[])
            : [];

          const fromId = getSectionId(fromSection);
          const toId = getSectionId(toSection);

          // Resolve template-file indices by section identity (avoids merged-vs-template
          // index divergence). Match either identity field on the template side.
          const tplFrom = fromId ? templateSections.findIndex(s => sectionMatchesId(s, fromId)) : -1;
          const tplTo = toId ? templateSections.findIndex(s => sectionMatchesId(s, toId)) : -1;

          if (tplFrom === -1 || tplTo === -1) {
            throw new Error(`Could not find template sections by ID (from="${fromId}", to="${toId}") — sections may lack identity fields`);
          }

          const [moved] = templateSections.splice(tplFrom, 1);
          templateSections.splice(tplTo, 0, moved);
          templateData.sections = templateSections;

          stampLocaleYamlBeforeWrite({
            data: templateData,
            previous: previousTemplateData,
            operations: [{ action: "reorder_sections", from: tplFrom, to: tplTo } as EditOperation],
            contentType,
            slug,
            locale,
            filePath: templateFilePath,
            contentRoot,
            author: request.author,
            ci: contentIndex,
          });
          const updatedYaml = safeYamlDump(templateData, {
            lineWidth: -1,
            noRefs: true,
            quotingType: '"',
            forceQuotes: false,
          });
          fs.writeFileSync(templateFilePath, updatedYaml, "utf-8");
          markFileAsModified(templateFilePath, request.author, undefined, contentRoot);

          // Swap _insertAfterSectionId anchors that pointed to either moved section,
          // so per-entry sections keep their intended visual position relative to
          // neighbours. Anchors may have been written against either identity field,
          // so match all candidates; rewrite to the canonical id.
          if (fromId && toId) {
            const fromCandidates = sectionIdCandidates(fromSection);
            const toCandidates = sectionIdCandidates(toSection);
            const localSections = Array.isArray(localeData.sections)
              ? (localeData.sections as Record<string, unknown>[])
              : [];
            for (const s of localSections) {
              const anchor = s._insertAfterSectionId;
              if (typeof anchor !== "string") continue;
              if (fromCandidates.includes(anchor)) s._insertAfterSectionId = toId;
              else if (toCandidates.includes(anchor)) s._insertAfterSectionId = fromId;
            }
          }

          // Remove the reorder op so it is NOT applied to the per-entry file array
          opsToRemove.add(opIdx);

        } else if (fromIsPerEntry && toIsPerEntry) {
          // Both are per-entry sections: find their local indices in the per-entry file
          const localSections = Array.isArray(localeData.sections)
            ? (localeData.sections as Record<string, unknown>[])
            : [];
          const fromId = getSectionId(fromSection);
          const toId = getSectionId(toSection);
          const localFrom = fromId ? localSections.findIndex(s => sectionMatchesId(s, fromId)) : -1;
          const localTo = toId ? localSections.findIndex(s => sectionMatchesId(s, toId)) : -1;

          if (localFrom === -1 || localTo === -1) {
            throw new Error(`Per-entry sections not found in local file (from="${fromId}", to="${toId}")`);
          }

          // Apply the reorder directly to localeData (written to per-entry file at end of editContent)
          const [moved] = localSections.splice(localFrom, 1);
          localSections.splice(localTo, 0, moved);

          // Remove from resolvedOperations to prevent double-apply via applyOperation
          opsToRemove.add(opIdx);

        } else {
          // Boundary move: one template section + one per-entry section.
          // We handle this by updating _insertAfterSectionId on the per-entry section
          // so it appears in the new visual position within this entry's merged view.
          // The shared template file is NOT modified — this only affects this entry.
          const localSections = Array.isArray(localeData.sections)
            ? (localeData.sections as Record<string, unknown>[])
            : [];

          let perEntrySectionId: string | null;
          let newAnchorId: string | null;

          if (fromIsPerEntry) {
            // Per-entry section moving past a template section
            perEntrySectionId = getSectionId(fromSection);
            if (fromIdx < toIdx) {
              // Moving DOWN: anchor becomes the template section it moved past
              newAnchorId = getSectionId(toSection);
            } else {
              // Moving UP: anchor becomes the section that will be just before the new slot
              newAnchorId = toIdx > 0 ? getSectionId(mergedSections[toIdx - 1]) : null;
            }
          } else {
            // Template section moving past a per-entry section.
            // Only the per-entry section's anchor changes (template file unchanged).
            perEntrySectionId = getSectionId(toSection);
            if (fromIdx < toIdx) {
              // Template moving DOWN past per-entry: per-entry shifts up to fromIdx
              newAnchorId = fromIdx > 0 ? getSectionId(mergedSections[fromIdx - 1]) : null;
            } else {
              // Template moving UP past per-entry: per-entry shifts down to fromIdx
              newAnchorId = getSectionId(fromSection);
            }
          }

          if (!perEntrySectionId) {
            throw new Error("Cannot resolve per-entry section ID for boundary reorder");
          }

          const localSection = localSections.find(s => sectionMatchesId(s, perEntrySectionId));
          if (!localSection) {
            throw new Error(`Per-entry section "${perEntrySectionId}" not found in local per-entry file`);
          }

          localSection._insertAfterSectionId = newAnchorId;
          opsToRemove.add(opIdx);
        }
      }

      if (opsToRemove.size > 0) {
        resolvedOperations = resolvedOperations.filter((_, i) => !opsToRemove.has(i));
      }
    }

    // Apply all operations to the locale data (this is what gets saved)
    const previousLocaleData = cloneYamlData(localeData);
    const clearedFields: ClearedField[] = [];
    const skipIdentityValidationIndexes = new Set<number>();
    for (const operation of resolvedOperations) {
      const opResult = applyOperation(localeData, operation, { contentRoot, locale });
      if (opResult.clearedFields?.length) {
        clearedFields.push(...opResult.clearedFields);
      }
      if (typeof opResult.insertedSectionIndex === "number") {
        // Newly duplicated sections may be invalid until staff re-sets conversion/ecommerce.
        // Allow the duplicate write itself; draft later saves scope to touched sections;
        // live saves + publish still validate the full document.
        skipIdentityValidationIndexes.add(opResult.insertedSectionIndex);
      }
    }

    // Strip null/non-object entries, then typeless leftovers on files that own
    // full structure. Attached overlays keep identity patches (`section_id` / `_remove`).
    if (Array.isArray(localeData.sections)) {
      const ownsFullStructure =
        path.basename(filePath).startsWith("single.") ||
        isEntryDetached(contentType, slug, contentRoot) ||
        !isSharedLayoutType(contentType, contentRoot);
      localeData.sections = (localeData.sections as unknown[]).filter((s) =>
        keepSectionAfterTypelessScrub(s, ownsFullStructure),
      );
    }

    // Validate conversion / CTA / product-scope identity before writing to disk.
    // Draft/variant: only touched sections (avoids circular trap after duplicate wipe).
    // Live locale: full document. Publish/promote always full (versioning routes).
    if (Array.isArray(localeData.sections)) {
      const identityErr = validateDocIdentity(
        localeData,
        identityValidateOptsForWrite({
          isDraftOrVariantWrite: hasVariant,
          operations: resolvedOperations,
          skipIdentityIndexes: skipIdentityValidationIndexes,
          contentType,
          contentSlug: slug,
        }),
      );
      if (identityErr) {
        return { success: false, error: identityErr };
      }
      const faqListingErr = validateFaqListingSections(localeData);
      if (faqListingErr) {
        return { success: false, error: faqListingErr };
      }
    }

    // Reject obsolete consent keys before writing to disk.
    const consentErr = getConsentKeyError(localeData);
    if (consentErr) {
      return { success: false, error: consentErr };
    }

    // Live locale writes: require resolved meta + editor.required fields.
    // Draft variant files and shared single.*.yml template edits skip this gate.
    const writingLiveLocale =
      !hasVariant &&
      !path.basename(filePath).startsWith("single.");
    if (writingLiveLocale) {
      const commonForGate = ci.loadCommonData(contentType, slug) || {};
      const mergedForGate = deepMerge(commonForGate, localeData) as Record<
        string,
        unknown
      >;
      const gateTouchedPaths = touchedPathsFromOperations(resolvedOperations);
      const gateIntent = liveSeoGateIntentFromOperations(resolvedOperations);
      const seoGateErr = evaluateLiveEntrySeoAndRequiredFields({
        contentType,
        slug,
        locale,
        pageData: mergedForGate,
        contentRoot,
        mode: gateIntent === "publish" ? "publish" : "live_update",
        intent: gateIntent,
        touchedPaths: gateTouchedPaths,
        isDraftWrite: false,
      });
      if (seoGateErr) {
        return {
          success: false,
          error: seoGateErr.message,
          errorCode: seoGateErr.code,
          missingFields: seoGateErr.missing_fields,
        };
      }
    }

    // Write locale data back to file (without _common.yml content)
    stampLocaleYamlBeforeWrite({
      data: localeData,
      previous: previousLocaleData,
      operations: resolvedOperations,
      contentType,
      slug,
      locale,
      filePath,
      contentRoot,
      author: request.author,
      ci,
    });
    const updatedYaml = safeYamlDump(localeData, {
      lineWidth: -1, // Don't wrap lines
      noRefs: true,
      quotingType: '"',
      forceQuotes: false,
    });
    
    fs.writeFileSync(filePath, updatedYaml, "utf-8");

    // Track who modified this file for sync purposes.
    // markFileAsModified fires fileModifiedListeners, which includes the
    // VersioningManager listener that invalidates the variant content cache.
    markFileAsModified(filePath, request.author, undefined, contentRoot);

    if (Object.keys(seoUpdates).length > 0) {
      const seoResult = writeSeoFields({
        contentType,
        slug,
        locale,
        updates: seoUpdates,
        author: request.author,
        contentRoot,
        variant: hasVariant ? variant : undefined,
        ci,
      });
      if (!seoResult.success) {
        return { success: false, error: seoResult.error };
      }
    }
    
    // Note: GitHub commits are now handled manually via /api/github/commit endpoint
    // Changes are saved locally and users commit when ready
    
    const commonData = ci.loadCommonData(contentType, slug);
    const mergedContent = commonData
      ? deepMerge(commonData, localeData)
      : localeData;
    const updatedSections = (mergedContent.sections as unknown[]) || [];

    // Live locale only: enqueue entry-preview capture when needed (Cloudflare queue).
    // Bulk-meta sets skipPreviewCapture to avoid N preview jobs for SEO-only writes.
    if (!hasVariant && !request.skipPreviewCapture) {
      void scheduleEntryPreviewCaptureAfterSave({
        contentType,
        slug,
        locale,
        contentRoot,
        entry: mergedContent as Record<string, unknown>,
      });
    }

    return {
      success: true,
      updatedSections,
      ...(clearedFields.length > 0 ? { clearedFields } : {}),
    };
  } catch (error) {
    log.error({ err: error }, "Content edit error:");
    return { success: false, error: error instanceof Error ? error.message : "Unknown error" };
  }
}

async function scheduleEntryPreviewCaptureAfterSave(opts: {
  contentType: string;
  slug: string;
  locale: string;
  contentRoot?: string;
  entry: Record<string, unknown>;
}): Promise<void> {
  try {
    const { getSiteContextMap } = await import("./site-manager");
    const { maybeEnqueueAfterEntrySave } = await import("./entry-preview-capture-queue");
    const root = opts.contentRoot
      ? path.isAbsolute(opts.contentRoot)
        ? opts.contentRoot
        : path.join(process.cwd(), opts.contentRoot)
      : null;
    let site = null as import("./site-manager").SiteContext | null;
    for (const ctx of getSiteContextMap().values()) {
      if (root && path.resolve(ctx.contentRoot) === path.resolve(root)) {
        site = ctx;
        break;
      }
      if (!root) {
        site = ctx;
        break;
      }
    }
    if (!site) return;
    await maybeEnqueueAfterEntrySave(site, {
      contentType: opts.contentType,
      slug: opts.slug,
      locale: opts.locale,
      entry: opts.entry,
    });
  } catch (err) {
    log.warn(
      { err: err instanceof Error ? err.message : String(err), ...opts },
      "[editContent] entry-preview enqueue after save failed",
    );
  }
}

/**
 * Returns true for operations that structurally change the sections array
 * on the shared template file (add, remove, reorder, or full section swap).
 */
function isStructuralOp(op: EditOperation): boolean {
  if (op.action === "add_item" && op.path === "sections") return true;
  if (op.action === "remove_item" && op.path === "sections") return true;
  if (op.action === "update_section" && (op as { structural?: boolean }).structural === true) return true;
  if (op.action === "reorder_sections") return true;
  return false;
}

/**
 * Keep only clearedTemplatePaths that are real on-disk bindings and actually
 * absent on the incoming section (ignore stale / invalid client entries).
 */
export function sanitizeClearedTemplatePaths(
  requested: string[] | undefined,
  newSection: Record<string, unknown>,
  originalTemplateSection: Record<string, unknown>,
): string[] {
  if (!requested?.length) return [];
  const varFields = extractVariableFields(originalTemplateSection);
  const allowed: string[] = [];
  for (const path of requested) {
    if (!path || !(path in varFields)) continue;
    if (getValueAtPath(newSection, path) !== undefined) continue;
    allowed.push(path);
  }
  return allowed;
}

/**
 * Keep only unboundTemplatePaths that were real bindings and are now static strings
 * (present, no `{{ … }}` in the value).
 */
export function sanitizeUnboundTemplatePaths(
  requested: string[] | undefined,
  newSection: Record<string, unknown>,
  originalTemplateSection: Record<string, unknown>,
): string[] {
  if (!requested?.length) return [];
  const varFields = extractVariableFields(originalTemplateSection);
  const allowed: string[] = [];
  for (const path of requested) {
    if (!path || !(path in varFields)) continue;
    const incoming = getValueAtPath(newSection, path);
    if (incoming === undefined) continue;
    if (typeof incoming !== "string") continue;
    if (TEMPLATE_EXPR_RE.test(incoming)) continue;
    allowed.push(path);
  }
  return allowed;
}

/**
 * Re-bind one field value to its template expression without dropping surrounding
 * literal text (e.g. `"{{ single.title }} test"` stays intact).
 *
 * - Already contains `{{ … }}` → keep the whole string.
 * - Optional `resolved` (delivery value): equality → expression; prefix → expression + suffix.
 * - Otherwise → expression (prevents baking resolved literals into the template).
 */
export function restoreTemplateFieldValue(
  incoming: unknown,
  templateExpr: string,
  resolved?: string,
): unknown {
  if (typeof incoming !== "string") return templateExpr;
  if (TEMPLATE_EXPR_RE.test(incoming)) return incoming;
  if (typeof resolved === "string" && resolved.length > 0) {
    if (incoming === resolved) return templateExpr;
    if (incoming.startsWith(resolved)) {
      return `${templateExpr}${incoming.slice(resolved.length)}`;
    }
  }
  return templateExpr;
}

/**
 * Restores `{{ single.* }}` / `{{ global.* }}` placeholder expressions from the
 * original template section into new section data, preserving any literal text
 * around expressions. Paths in skipPaths (staff-approved clears) stay absent.
 *
 * `resolvedByPath` (optional): delivery-resolved values per dot-path so
 * `"Title test"` can become `"{{ single.title }} test"` when Title was the bind.
 */
export function restoreTemplatePlaceholders(
  newSection: Record<string, unknown>,
  originalTemplateSection: Record<string, unknown>,
  skipPaths?: Iterable<string>,
  resolvedByPath?: Record<string, string>,
  unboundPaths?: Iterable<string>,
): Record<string, unknown> {
  const varFields = extractVariableFields(originalTemplateSection);
  if (Object.keys(varFields).length === 0) return newSection;

  const skip = skipPaths ? new Set(skipPaths) : null;
  const unbound = unboundPaths ? new Set(unboundPaths) : null;
  const result = JSON.parse(JSON.stringify(newSection)) as Record<string, unknown>;
  for (const [dotPath, templateExpr] of Object.entries(varFields)) {
    if (skip?.has(dotPath)) continue;
    if (unbound?.has(dotPath)) continue;
    const incoming = getValueAtPath(result, dotPath);
    if (incoming === undefined) {
      setValueAtPath(result, dotPath, templateExpr);
      continue;
    }
    setValueAtPath(
      result,
      dotPath,
      restoreTemplateFieldValue(incoming, templateExpr, resolvedByPath?.[dotPath]),
    );
  }
  return result;
}

/**
 * Writes structural section changes (add/remove/swap) directly to the shared
 * `single.{locale}.yml` template file, preserving all `{{ }}` placeholder
 * expressions. Uses safe YAML load/dump to avoid template variable corruption.
 * For shared-layout types, fans out allowlisted topology/layout to sibling singles.
 */
function writeStructuralChangesToTemplate(opts: {
  operations: EditOperation[];
  filePath: string;
  localeData: Record<string, unknown>;
  author?: string;
  contentRoot?: string;
  contentType?: string;
  contentSlug?: string;
  locale?: string;
  requesterId?: string;
  ci?: ContentIndex;
  skipSharedLayoutFanOut?: boolean;
  /** When true (draft/variant template), identity-check only touched sections. */
  isDraftOrVariantWrite?: boolean;
}): {
  success: boolean;
  error?: string;
  warning?: string;
  updatedSections?: unknown[];
  clearedFields?: ClearedField[];
} {
  const { operations, filePath, localeData, author, contentRoot, contentType, contentSlug, requesterId } = opts;
  const ci = opts.ci ?? contentIndex;

  try {
    const raw = fs.readFileSync(filePath, "utf-8");
    const templateData = (ci.safeYamlLoad(raw) as Record<string, unknown>) || {};
    const sectionsBefore = Array.isArray(templateData.sections)
      ? [...(templateData.sections as Record<string, unknown>[])]
      : [];
    const previousTemplateData = cloneYamlData(templateData);
    const clearedFields: ClearedField[] = [];

    // Annotate remove ops with sectionId for sibling fan-out
    const annotatedOps: EditOperation[] = operations.map((op) => {
      if (op.action === "remove_item" && op.path === "sections" && typeof op.index === "number") {
        const id = canonicalSectionId(sectionsBefore[op.index]);
        return id ? ({ ...op, sectionId: id } as EditOperation & { sectionId: string }) : op;
      }
      return op;
    });

    for (const op of annotatedOps) {
      // Always restore {{ single.* }} / {{ global.* }} from the on-disk template when
      // writing update_section — not only structural swaps. Code/Props saves omit
      // structural:true and previously could bake resolved HTML into single.*.yml.
      if (op.action === "update_section") {
        const templateSections = Array.isArray(templateData.sections)
          ? (templateData.sections as Record<string, unknown>[])
          : [];
        const originalTemplateSection = templateSections[op.index] as Record<string, unknown> | undefined;
        let newSectionData = op.section as Record<string, unknown>;
        if (originalTemplateSection) {
          const skipPaths = sanitizeClearedTemplatePaths(
            op.clearedTemplatePaths,
            newSectionData,
            originalTemplateSection,
          );
          const unboundPaths = sanitizeUnboundTemplatePaths(
            op.unboundTemplatePaths,
            newSectionData,
            originalTemplateSection,
          );
          newSectionData = restoreTemplatePlaceholders(
            newSectionData,
            originalTemplateSection,
            skipPaths,
            undefined,
            unboundPaths,
          );
        }
        const opResult = applyOperation(templateData, { ...op, section: newSectionData } as EditOperation, {
          contentRoot,
          locale: opts.locale,
        });
        if (opResult.clearedFields?.length) clearedFields.push(...opResult.clearedFields);
      } else {
        const opResult = applyOperation(templateData, op, { contentRoot, locale: opts.locale });
        if (opResult.clearedFields?.length) clearedFields.push(...opResult.clearedFields);
      }
    }

    // Strip null/non-object entries and typeless leftovers (template owns full structure)
    if (Array.isArray(templateData.sections)) {
      templateData.sections = (templateData.sections as unknown[]).filter((s) =>
        keepSectionAfterTypelessScrub(s, true),
      );
    }

    // Reject obsolete consent keys before writing to disk.
    const consentErrStructural = getConsentKeyError(templateData);
    if (consentErrStructural) {
      return { success: false, error: consentErrStructural };
    }

    const skipIdentityIndexes = new Set<number>();
    for (const op of annotatedOps) {
      if (op.action === "add_item" && op.path === "sections") {
        const idx =
          typeof op.index === "number" && op.index >= 0
            ? op.index
            : Array.isArray(templateData.sections)
              ? (templateData.sections as unknown[]).length - 1
              : -1;
        if (idx >= 0) skipIdentityIndexes.add(idx);
      }
    }
    if (contentType && Array.isArray(templateData.sections)) {
      const identityErr = validateDocIdentity(
        templateData,
        identityValidateOptsForWrite({
          isDraftOrVariantWrite: Boolean(opts.isDraftOrVariantWrite),
          operations: annotatedOps,
          skipIdentityIndexes,
          contentType,
          contentSlug: contentSlug || contentType,
        }),
      );
      if (identityErr) {
        return { success: false, error: identityErr };
      }
      const faqListingErr = validateFaqListingSections(templateData);
      if (faqListingErr) {
        return { success: false, error: faqListingErr };
      }
    }

    if (contentType && contentSlug) {
      stampLocaleYamlBeforeWrite({
        data: templateData,
        previous: previousTemplateData,
        operations: annotatedOps,
        contentType,
        slug: contentSlug,
        locale: opts.locale,
        filePath,
        contentRoot,
        author,
        ci,
      });
    }
    const updatedYaml = safeYamlDump(templateData, {
      lineWidth: -1,
      noRefs: true,
      quotingType: '"',
      forceQuotes: false,
    });
    fs.writeFileSync(filePath, updatedYaml, "utf-8");
    markFileAsModified(filePath, author, undefined, contentRoot);

    let warning: string | undefined;

    // Fan-out to sibling locale singles for shared-layout types
    const localeFromPath =
      opts.locale ||
      (() => {
        const m = /single\.([a-z]{2}(?:-[a-z]+)?)\.yml$/i.exec(path.basename(filePath));
        return m ? m[1] : null;
      })();
    const typeConfig = contentType ? getContentTypeConfig(contentType, contentRoot) : null;
    const isSharedLayout = !!(typeConfig?.database?.slug || typeConfig?.single_template);

    if (isSharedLayout && contentType && localeFromPath && !opts.skipSharedLayoutFanOut) {
      const templateDir = path.dirname(filePath);
      const sourceSections = Array.isArray(templateData.sections)
        ? (templateData.sections as Record<string, unknown>[])
        : [];
      const fan = fanOutStructuralOpsToSiblings({
        templateDir,
        sourceLocale: localeFromPath,
        sourceSections,
        operations: annotatedOps as unknown as Array<Record<string, unknown>>,
        safeYamlLoad: (r) => ci.safeYamlLoad(r),
        dumpYaml: (d) =>
          safeYamlDump(d, { lineWidth: -1, noRefs: true, quotingType: '"', forceQuotes: false }),
        requesterId,
        onSiblingWritten: (siblingPath) => {
          markFileAsModified(siblingPath, author, undefined, contentRoot);
        },
        cleanEntryOverlaysForSectionIds: (ids) => {
          cleanSectionIdFromEntryOverlays(
            templateDir,
            ids,
            (r) => ci.safeYamlLoad(r),
            (d) =>
              safeYamlDump(d, { lineWidth: -1, noRefs: true, quotingType: '"', forceQuotes: false }),
            (p) => markFileAsModified(p, author, undefined, contentRoot),
          );
        },
      });
      if (fan.failed.length > 0) {
        return {
          success: false,
          error: `Source locale updated but sibling fan-out failed for: ${fan.failed
            .map((f) => `${f.locale} (${f.error})`)
            .join("; ")}. Succeeded: ${fan.succeeded.join(", ") || "none"}`,
        };
      }
      if (fan.manualVariantWarning) {
        warning =
          "type/version/variant changes are not auto-replicated to sibling locales. Update each locale's single template manually.";
      }
    }

    // Apply to localeData in-memory for immediate client-side update
    for (const op of operations) {
      try { applyOperation(localeData, op); } catch {}
    }

    const updatedSections = (localeData.sections as unknown[]) || [];
    return {
      success: true,
      updatedSections,
      warning,
      ...(clearedFields.length > 0 ? { clearedFields } : {}),
    };
  } catch (err) {
    log.error({ err: err }, "[editContent] Structural template write error:");
    return { success: false, error: err instanceof Error ? err.message : "Unknown error" };
  }
}

/**
 * Writes top-level field ops (e.g. `meta`) to a DB-backed entry's per-entry locale
 * file (`{slug}/en.yml`), creating it and its parent directory if absent.
 * Called when `editContent` detects all ops are top-level update_field while the
 * loaded file is the shared template — those fields must never touch the template.
 */
function writeTopLevelFieldsToPerEntryFile(opts: {
  contentType: string;
  slug: string;
  locale: string;
  operations: EditOperation[];
  author?: string;
  contentRoot?: string;
}): { success: boolean; error?: string; errorCode?: string; missingFields?: string[] } {
  const { contentType, slug, locale, operations, author } = opts;
  const rawRoot = opts.contentRoot ?? getDefaultContentRootName();
  const rootPath = path.isAbsolute(rawRoot) ? rawRoot : path.join(process.cwd(), rawRoot);
  try {
    const perEntryDir = path.join(rootPath, getFolder(contentType), slug);
    const perEntryPath = path.join(perEntryDir, `${locale}.yml`);

    if (!fs.existsSync(perEntryDir)) {
      fs.mkdirSync(perEntryDir, { recursive: true });
    }

    let entryData: Record<string, unknown> = {};
    if (fs.existsSync(perEntryPath)) {
      const raw = fs.readFileSync(perEntryPath, "utf-8");
      entryData = (yaml.load(raw) as Record<string, unknown>) || {};
    }

    const previousEntryData = cloneYamlData(entryData);
    for (const op of operations) {
      if (op.value === null || op.value === undefined) {
        delete entryData[op.path as string];
      } else {
        setValueAtPath(entryData, op.path as string, op.value);
      }
    }

    // Reject obsolete consent keys before writing to disk.
    const consentErrEntry = getConsentKeyError(entryData);
    if (consentErrEntry) {
      return { success: false, error: consentErrEntry };
    }

    const ciGate = contentIndex;
    const commonForGate = ciGate.loadCommonData(contentType, slug) || {};
    const mergedForGate = deepMerge(commonForGate, entryData) as Record<string, unknown>;
    const gateTouchedPaths = touchedPathsFromOperations(operations);
    const seoGateErr = evaluateLiveEntrySeoAndRequiredFields({
      contentType,
      slug,
      locale,
      pageData: mergedForGate,
      contentRoot: opts.contentRoot,
      mode: "live_update",
      intent: "micro",
      touchedPaths: gateTouchedPaths,
      isDraftWrite: false,
    });
    if (seoGateErr) {
      return {
        success: false,
        error: seoGateErr.message,
        errorCode: seoGateErr.code,
        missingFields: seoGateErr.missing_fields,
      };
    }

    stampLocaleYamlBeforeWrite({
      data: entryData,
      previous: previousEntryData,
      operations,
      contentType,
      slug,
      locale,
      filePath: perEntryPath,
      contentRoot: opts.contentRoot,
      author,
    });
    const dumped = safeYamlDump(entryData, { lineWidth: -1, noRefs: true });
    fs.writeFileSync(perEntryPath, dumped, "utf-8");
    markFileAsModified(perEntryPath, author, undefined, opts.contentRoot);
    return { success: true };
  } catch (err) {
    log.error({ err: err }, "[writeTopLevelFieldsToPerEntryFile] Error:");
    return { success: false, error: err instanceof Error ? err.message : "Unknown error" };
  }
}

/**
 * Apply arbitrary edit ops to a per-entry locale overlay (create file if needed).
 * Used when layoutTarget is "entry" and load resolved to the shared template.
 */
function writeEntryOverlayOps(opts: {
  contentType: string;
  slug: string;
  locale: string;
  operations: EditOperation[];
  author?: string;
  contentRoot?: string;
  ci?: ContentIndex;
}): { success: boolean; error?: string; updatedSections?: unknown[] } {
  const { contentType, slug, locale, operations, author } = opts;
  const ci = opts.ci ?? contentIndex;
  const rawRoot = opts.contentRoot ?? getDefaultContentRootName();
  const rootPath = path.isAbsolute(rawRoot) ? rawRoot : path.join(process.cwd(), rawRoot);
  try {
    const perEntryDir = path.join(rootPath, getFolder(contentType), slug);
    const perEntryPath = path.join(perEntryDir, `${locale}.yml`);
    if (!fs.existsSync(perEntryDir)) {
      fs.mkdirSync(perEntryDir, { recursive: true });
    }
    let entryData: Record<string, unknown> = {};
    if (fs.existsSync(perEntryPath)) {
      const raw = fs.readFileSync(perEntryPath, "utf-8");
      entryData = (ci.safeYamlLoad(raw) as Record<string, unknown>) || {};
    }
    const previousEntryData = cloneYamlData(entryData);
    for (const op of operations) {
      applyOperation(entryData, op, { contentRoot: opts.contentRoot, locale });
    }
    if (Array.isArray(entryData.sections)) {
      entryData.sections = (entryData.sections as unknown[]).filter((s) =>
        keepSectionAfterTypelessScrub(s, false),
      );
    }
    const consentErr = getConsentKeyError(entryData);
    if (consentErr) return { success: false, error: consentErr };
    stampLocaleYamlBeforeWrite({
      data: entryData,
      previous: previousEntryData,
      operations,
      contentType,
      slug,
      locale,
      filePath: perEntryPath,
      contentRoot: opts.contentRoot,
      author,
      ci,
    });
    fs.writeFileSync(
      perEntryPath,
      safeYamlDump(entryData, { lineWidth: -1, noRefs: true, quotingType: '"', forceQuotes: false }),
      "utf-8",
    );
    markFileAsModified(perEntryPath, author, undefined, opts.contentRoot);
    return {
      success: true,
      updatedSections: Array.isArray(entryData.sections) ? (entryData.sections as unknown[]) : [],
    };
  } catch (err) {
    log.error({ err }, "[writeEntryOverlayOps] Error:");
    return { success: false, error: err instanceof Error ? err.message : "Unknown error" };
  }
}

/**
 * Handles section/field saves for DB-backed single-page templates (e.g. blog posts,
 * programs). Instead of writing to the shared `single.en.yml` template, we identify
 * which changed fields are template variable expressions (`{{ single.X | ... }}`),
 * extract the target DB field name `X`, and patch only that entry's row in the
 * database file cache. The shared template YAML is never touched unless a structural
 * operation (add/remove section, swap variant) is explicitly requested.
 */
function handleSharedTemplateEdit(opts: {
  contentType: string;
  slug: string;
  locale: string;
  operations: EditOperation[];
  localeData: Record<string, unknown>;
  filePath: string;
  author?: string;
  contentRoot?: string;
  database?: DatabaseManager;
  ci?: ContentIndex;
  requesterId?: string;
  skipSharedLayoutFanOut?: boolean;
  /** Draft/variant template writes scope identity to touched sections. */
  isDraftOrVariantWrite?: boolean;
}): {
  success: boolean;
  error?: string;
  warning?: string;
  updatedSections?: unknown[];
  clearedFields?: ClearedField[];
} {
  const { contentType, slug, locale, operations, localeData, filePath, author, contentRoot } = opts;
  const ci = opts.ci ?? contentIndex;
  const db = opts.database ?? databaseManager;

  // Resolve staff id for _label.requester when available
  let requesterId = opts.requesterId;
  if (!requesterId && author) {
    try {
      requesterId = getOrCreateStaffUserId(author) ?? undefined;
      if (!requesterId) {
        const u = getUser(author);
        if (u?.id) requesterId = u.id;
      }
    } catch { /* optional */ }
  }

  // update_section ops always write directly to the shared template YAML.
  // This function is only reached when the user explicitly chose "Update shared
  // template" (or when the per-entry translation layer routed a template-owned
  // section here). DB field patching applies only to update_field ops.
  const structuralOps = operations.filter(
    op => isStructuralOp(op) || op.action === "update_section",
  );
  if (structuralOps.length > 0) {
    // Only pure structural + structural update_section go through fan-out path;
    // non-structural update_section still writes template but fan-out only layout keys.
    return writeStructuralChangesToTemplate({
      operations: structuralOps,
      filePath,
      localeData,
      author,
      contentRoot,
      contentType,
      contentSlug: slug,
      locale,
      requesterId,
      ci,
      skipSharedLayoutFanOut: opts.skipSharedLayoutFanOut,
      isDraftOrVariantWrite: opts.isDraftOrVariantWrite,
    });
  }

  const dbName = getDatabaseName(contentType);
  const lookupKey = getLookupKey(contentType) || "slug";
  const fieldMapping = getFieldMapping(contentType);

  // Load the raw template to read the original `{{ }}` expressions
  const template = mergeSingleTemplate(contentType, locale, undefined, undefined, contentRoot);
  const templateSections = Array.isArray(template?.sections)
    ? (template!.sections as Record<string, unknown>[])
    : [];

  // Pre-compute variable fields for each template section (index → fieldPath → expr)
  const sectionVarFields: Record<number, Record<string, string>> = {};
  for (let i = 0; i < templateSections.length; i++) {
    const vf = extractVariableFields(templateSections[i]);
    if (Object.keys(vf).length > 0) sectionVarFields[i] = vf;
  }

  // Collect DB field updates from all operations
  const dbUpdates: Record<string, unknown> = {};

  for (const operation of operations) {
    if (operation.action === "update_section") {
      const varFields = sectionVarFields[operation.index] ?? {};
      const newSection = (operation.section ?? {}) as Record<string, unknown>;
      for (const [fieldPath, templateExpr] of Object.entries(varFields)) {
        const newValue = getValueAtPath(newSection, fieldPath);
        if (
          newValue !== undefined &&
          newValue !== templateExpr &&
          typeof newValue === "string" &&
          !TEMPLATE_EXPR_RE.test(newValue)
        ) {
          const templateKey = parseTemplateKey(templateExpr);
          if (templateKey) dbUpdates[templateKey] = newValue;
        }
      }
    } else if (operation.action === "update_field") {
      // Handle paths like "sections.2.image" or "sections.2.background.src"
      const m = operation.path.match(/^sections\.(\d+)\.(.+)$/);
      if (m) {
        const sectionIdx = parseInt(m[1], 10);
        const fieldPath = m[2];
        const varFields = sectionVarFields[sectionIdx] ?? {};
        const templateExpr = varFields[fieldPath];
        if (
          templateExpr !== undefined &&
          operation.value !== undefined &&
          operation.value !== templateExpr &&
          typeof operation.value === "string" &&
          !TEMPLATE_EXPR_RE.test(operation.value)
        ) {
          const templateKey = parseTemplateKey(templateExpr);
          if (templateKey) dbUpdates[templateKey] = operation.value;
        }
      }
    }
  }

  if (Object.keys(dbUpdates).length > 0 && dbName) {
    const patched = db.patchDbEntry(dbName, lookupKey, slug, dbUpdates, fieldMapping, author, contentRoot);
    if (!patched) {
      log.warn(`[editContent] patchDbEntry found no matching entry for ${dbName}/${slug}`);
    }
  }

  // Also write non-DB-variable field changes (e.g. paddingY, showOn, background) and
  // section-level saves (update_section) to the shared template YAML file, while
  // restoring any {{ single.* }} placeholder expressions that the client may have
  // stripped or replaced with resolved values.
  try {
    const raw = fs.readFileSync(filePath, "utf-8");
    const templateData = (ci.safeYamlLoad(raw) as Record<string, unknown>) || {};
    const previousTemplateData = cloneYamlData(templateData);

    let templateDirty = false;

    for (const operation of operations) {
      if (operation.action === "update_section") {
        // Write the whole section to the template, but restore placeholder expressions first.
        const templateSections2 = Array.isArray(templateData.sections)
          ? (templateData.sections as Record<string, unknown>[])
          : [];
        const originalTemplateSection = templateSections2[operation.index] as Record<string, unknown> | undefined;
        let newSectionData = (operation.section ?? {}) as Record<string, unknown>;
        if (originalTemplateSection) {
          const skipPaths = sanitizeClearedTemplatePaths(
            operation.clearedTemplatePaths,
            newSectionData,
            originalTemplateSection,
          );
          const unboundPaths = sanitizeUnboundTemplatePaths(
            operation.unboundTemplatePaths,
            newSectionData,
            originalTemplateSection,
          );
          newSectionData = restoreTemplatePlaceholders(
            newSectionData,
            originalTemplateSection,
            skipPaths,
            undefined,
            unboundPaths,
          );
        }
        applyOperation(templateData, { ...operation, section: newSectionData } as EditOperation);
        templateDirty = true;
      } else if (operation.action === "update_field") {
        // Only write to the template if this path is NOT a template-variable field
        // (template-variable fields are persisted to the DB instead).
        const m = operation.path.match(/^sections\.(\d+)\.(.+)$/);
        if (m) {
          const sectionIdx = parseInt(m[1], 10);
          const fieldPath = m[2];
          const varFields = sectionVarFields[sectionIdx] ?? {};
          if (!varFields[fieldPath]) {
            // Not a DB-mapped variable field → write directly to the template file.
            applyOperation(templateData, operation);
            templateDirty = true;
          }
        } else {
          // Top-level (non-section-field) path → write to template.
          applyOperation(templateData, operation);
          templateDirty = true;
        }
      }
    }

    if (templateDirty) {
      // Reject obsolete consent keys before writing to disk.
      const consentErrTemplate = getConsentKeyError(templateData);
      if (consentErrTemplate) {
        return { success: false, error: consentErrTemplate };
      }

      stampLocaleYamlBeforeWrite({
        data: templateData,
        previous: previousTemplateData,
        operations,
        contentType,
        slug,
        locale,
        filePath,
        contentRoot,
        author,
        ci,
      });
      const updatedYaml = safeYamlDump(templateData, {
        lineWidth: -1,
        noRefs: true,
        quotingType: '"',
        forceQuotes: false,
      });
      fs.writeFileSync(filePath, updatedYaml, "utf-8");
      markFileAsModified(filePath, author, undefined, contentRoot);

      // Fan out allowlisted layout field updates to sibling singles
      const typeConfig = getContentTypeConfig(contentType, contentRoot);
      const isSharedLayout = !!(typeConfig?.database?.slug || typeConfig?.single_template);
      const layoutOps = operations.filter((op) => {
        if (op.action !== "update_field") return false;
        const m = String(op.path).match(/^sections\.\d+\.(.+)$/);
        if (!m) return false;
        const { isAllowlistedSectionFieldPath: isLayoutPath } = {
          isAllowlistedSectionFieldPath,
        };
        return isLayoutPath(m[1]);
      });
      if (isSharedLayout && layoutOps.length > 0 && !opts.skipSharedLayoutFanOut) {
        const sourceSections = Array.isArray(templateData.sections)
          ? (templateData.sections as Record<string, unknown>[])
          : [];
        const fan = fanOutStructuralOpsToSiblings({
          templateDir: path.dirname(filePath),
          sourceLocale: locale,
          sourceSections,
          operations: layoutOps as unknown as Array<Record<string, unknown>>,
          safeYamlLoad: (r) => ci.safeYamlLoad(r),
          dumpYaml: (d) =>
            safeYamlDump(d, { lineWidth: -1, noRefs: true, quotingType: '"', forceQuotes: false }),
          requesterId,
          onSiblingWritten: (siblingPath) => {
            markFileAsModified(siblingPath, author, undefined, contentRoot);
          },
        });
        if (fan.failed.length > 0) {
          return {
            success: false,
            error: `Layout updated but sibling fan-out failed for: ${fan.failed
              .map((f) => `${f.locale} (${f.error})`)
              .join("; ")}`,
          };
        }
      }
    }
  } catch (err) {
    if (isInvalidSectionIndexError(err)) {
      return { success: false, error: err instanceof Error ? err.message : String(err) };
    }
    log.error("[editContent] Failed to write non-DB field changes to shared template:", err instanceof Error ? err.message : err);
  }

  // Apply operations to localeData in-memory so the returned sections reflect
  // what the client expects to see immediately (the resolved new values).
  for (const operation of operations) {
    try {
      applyOperation(localeData, operation);
    } catch (err) {
      log.warn("[editContent] Skipping invalid operation on shared template:", operation.action, err instanceof Error ? err.message : err);
    }
  }

  const updatedSections = (localeData.sections as unknown[]) || [];
  return { success: true, updatedSections };
}

/**
 * Parses the template variable name from an expression like `{{ single.thumbnail | default.jpg }}`.
 * Returns the field key after "single." (e.g. "thumbnail"), or null if not a `single.*` variable.
 */
function parseTemplateKey(expr: string): string | null {
  const inner = expr.replace(/^\{\{/, "").replace(/\}\}$/, "").trim();
  const varName = inner.split("|")[0].trim(); // "single.thumbnail"
  if (varName.startsWith("single.")) {
    return varName.slice("single.".length);
  }
  return null;
}

interface CommonEditRequest {
  contentType: string;
  slug: string;
  operations: Array<{ action: "update_field"; path: string; value: unknown }>;
  author?: string;
  ci?: ContentIndex;
  contentRootName?: string;
}

/** Dot paths from update_field operations (for micro validation scope). */
export function touchedPathsFromOperations(
  operations: Array<{ action: string; path?: string }>,
): string[] {
  const paths: string[] = [];
  for (const op of operations) {
    if (op.action === "update_field" && typeof op.path === "string" && op.path) {
      paths.push(op.path);
    }
  }
  return paths;
}

/**
 * Full section replace is treated like publish for the live SEO gate.
 * Structural micro ops (add_item, etc.) keep intent "micro" (empty paths → skip).
 */
export function liveSeoGateIntentFromOperations(
  operations: Array<{ action: string }>,
): "publish" | "micro" {
  return operations.some((op) => op.action === "replace_all_sections")
    ? "publish"
    : "micro";
}

/** Locales whose merged YAML (common + locale) must pass the live SEO gate after _common edits. */
export function getCommonEditGateLocales(
  contentType: string,
  slug: string,
  contentRootName?: string,
): string[] {
  const contentDir = getEntryContentDir(contentType, slug, contentRootName);
  const templateMode = isTemplateVersioningSlug(slug);
  const liveLocales = listLiveLocales(contentDir, templateMode);
  return liveLocales.length > 0 ? liveLocales : [getDefaultLocale()];
}

/** Run live SEO gate for _common.yml writes against each live locale file. */
export function evaluateCommonContentLiveGate(opts: {
  contentType: string;
  slug: string;
  commonData: Record<string, unknown>;
  ci: ContentIndex;
  contentRootName?: string;
  touchedPaths?: string[];
  /** Default micro (scoped). Pass publish for full locale checks. */
  intent?: "publish" | "micro";
}): LiveSeoGateFailure | null {
  const {
    contentType,
    slug,
    commonData,
    ci,
    contentRootName,
    touchedPaths = [],
    intent = "micro",
  } = opts;
  for (const gateLocale of getCommonEditGateLocales(contentType, slug, contentRootName)) {
    const localeLoaded = ci.loadLocaleData(contentType, slug, gateLocale);
    const localeDataForGate =
      (localeLoaded.data as Record<string, unknown> | null) || {};
    const mergedForGate = deepMerge(commonData, localeDataForGate) as Record<
      string,
      unknown
    >;
    const seoGateErr = evaluateLiveEntrySeoAndRequiredFields({
      contentType,
      slug,
      locale: gateLocale,
      pageData: mergedForGate,
      contentRoot: contentRootName,
      mode: intent === "publish" ? "publish" : "live_update",
      intent,
      touchedPaths,
    });
    if (seoGateErr) return seoGateErr;
  }
  return null;
}

export function editCommonContent(request: CommonEditRequest): {
  success: boolean;
  error?: string;
  errorCode?: string;
  missingFields?: string[];
} {
  const { contentType, slug, operations, author } = request;
  const ci = request.ci ?? contentIndex;
  const contentRootName = request.contentRootName;

  try {
    const commonPath = ci.getCommonFilePath(contentType, slug);
    if (!fs.existsSync(commonPath)) {
      fs.mkdirSync(path.dirname(commonPath), { recursive: true });
      fs.writeFileSync(commonPath, "{}\n", "utf-8");
    }

    const raw = fs.readFileSync(commonPath, "utf-8");
    const commonData = (yaml.load(raw) as Record<string, unknown>) || {};

    for (const op of operations) {
      if (op.action !== "update_field") {
        return { success: false, error: `Unsupported operation: ${op.action}` };
      }
      const p = op.path || "";
      if (p === "seo" || p.startsWith("seo.")) {
        return {
          success: false,
          error: "seo.* must live on the locale YAML file, not _common.yml.",
        };
      }
      if (op.path === RESERVED_PUBLISHED_AT_FIELD || op.path.startsWith(`${RESERVED_PUBLISHED_AT_FIELD}.`)) {
        if (op.value === undefined || isPublishedAtEmpty(op.value)) {
          return {
            success: false,
            error: "published_at cannot be cleared; set a non-empty datetime to backdate.",
          };
        }
      }
      if (op.value === undefined) {
        delete commonData[op.path];
      } else {
        setValueAtPath(commonData, op.path, op.value);
      }
    }

    const seoGateErr = evaluateCommonContentLiveGate({
      contentType,
      slug,
      commonData,
      ci,
      contentRootName,
      touchedPaths: touchedPathsFromOperations(operations),
    });
    if (seoGateErr) {
      return {
        success: false,
        error: seoGateErr.message,
        errorCode: seoGateErr.code,
        missingFields: seoGateErr.missing_fields,
      };
    }

    const updatedYaml = safeYamlDump(commonData, {
      lineWidth: -1,
      noRefs: true,
      quotingType: '"',
      forceQuotes: false,
    });

    fs.writeFileSync(commonPath, updatedYaml, "utf-8");
    markFileAsModified(commonPath, author, undefined, contentRootName);

    return { success: true };
  } catch (error) {
    log.error({ err: error }, "Common content edit error:");
    return { success: false, error: error instanceof Error ? error.message : "Unknown error" };
  }
}

export function getContentForEdit(
  contentType: string,
  slug: string,
  rawLocale: string,
  variant?: string,
  version?: number,
  ci?: ContentIndex
): { content: Record<string, unknown> | null; error?: string } {
  const locale = normalizeLocale(rawLocale);
  const index = ci ?? contentIndex;
  
  const hasVariant = variant !== undefined && variant !== null && variant !== "";
  const hasValidVersion = version !== undefined && version !== null && Number.isFinite(version);
  if (hasValidVersion && !hasVariant) {
    return { content: null, error: "version cannot be provided without variant" };
  }
  
  try {
    const { data: localeData, error: loadError } = index.loadLocaleData(contentType, slug, locale, variant, version);
    if (!localeData || loadError) {
      return { content: null, error: loadError || `Content file not found` };
    }

    const commonData = index.loadCommonData(contentType, slug);
    const content = commonData
      ? deepMerge(commonData, localeData)
      : localeData;

    return { content };
  } catch (error) {
    log.error({ err: error }, "Error reading content:");
    return { content: null, error: error instanceof Error ? error.message : "Unknown error" };
  }
}

// ─── Content lifecycle helpers ────────────────────────────────────────────────

function coerceToOriginalType(newValue: string, originalValue: unknown): unknown {
  if (typeof originalValue === "number") {
    const n = Number(newValue);
    return Number.isNaN(n) ? newValue : n;
  }
  if (typeof originalValue === "boolean") return newValue === "true";
  if (
    originalValue != null &&
    typeof originalValue === "object" &&
    !Array.isArray(originalValue) &&
    "slug" in (originalValue as object)
  ) {
    return { slug: newValue };
  }
  return newValue;
}

function coerceStringValue(value: string): unknown {
  if (/^-?\d+(\.\d+)?$/.test(value)) return Number(value);
  if (value === "true") return true;
  if (value === "false") return false;
  return value;
}

function formatValidationError(type: string, raw: string): string {
  try {
    const match = raw.match(/(\[[\s\S]*\])/);
    if (match) {
      const issues = JSON.parse(match[1]) as Array<{ path: string[]; message: string }>;
      return `Cannot save ${type}: ${issues.map(i => `"${i.path.join(".")}" ${i.message}`).join("; ")}`;
    }
  } catch {}
  return `Cannot save ${type}: ${raw}`;
}

function inferUrlParamShapes(
  type: string,
  params: string[],
  contentRootName?: string,
): Record<string, UrlParamValueShape> {
  const shapes: Record<string, UrlParamValueShape> = {};
  for (const param of params) shapes[param] = "string";
  if (params.length === 0) return shapes;

  const mapping = getFieldMapping(type, contentRootName);
  const votes: Record<string, { object_slug: number; string: number }> = {};
  for (const param of params) votes[param] = { object_slug: 0, string: 0 };

  const slugs = contentIndex.listContentSlugs(type as import("./content-index").ContentType);
  for (const slug of slugs.slice(0, 50)) {
    const locales = contentIndex.getAvailableLocalesOrVariants(
      type as import("./content-index").ContentType,
      slug,
    );
    const entryLocale = locales.find((l) => !l.startsWith("_") && !l.includes(".")) ?? locales[0];
    if (!entryLocale) continue;
    const { data } = contentIndex.loadMergedContent(type, slug, entryLocale);
    if (!data) continue;
    const record = data as Record<string, unknown>;
    for (const param of params) {
      const raw = getRawUrlParamValue(record, param, mapping);
      if (raw === undefined || raw === null) continue;
      votes[param][detectUrlParamValueShape(raw)] += 1;
    }
  }

  for (const param of params) {
    // Blog (and peers): `:category` is always a plain string URL slug — never `{ slug }`.
    if (param === "category") {
      shapes[param] = "string";
      continue;
    }
    shapes[param] =
      votes[param].object_slug > votes[param].string ? "object_slug" : "string";
  }
  return shapes;
}

function normalizeUrlParamInput(value: unknown): string | null {
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed || null;
}

function invalidateContentCaches(contentType?: string): void {
  if (contentType) contentIndex.invalidateCommonFields(contentType);
  clearSsrSchemaCache();
  void import("./html-page-cache").then(({ invalidateHtmlPageCache }) => {
    invalidateHtmlPageCache();
  }).catch(() => {});
}

type ContentLifecycleResult<T extends Record<string, unknown>> =
  | { success: true; data: T }
  | { success: false; statusCode: number; error: string };

// ─── renameContentSlug ────────────────────────────────────────────────────────

export interface RenameContentSlugInput {
  contentType: string;
  folderSlug: string;
  locale: string;
  newSlug: string;
  createRedirect?: boolean;
  /** When true (MCP), entries >= 24h old must pass createRedirect: true. */
  enforceRedirectPolicy?: boolean;
  author?: string;
  contentRootName?: string;
}

export async function renameContentSlug(
  input: RenameContentSlugInput,
): Promise<ContentLifecycleResult<{
  success: boolean; folderSlug: string; oldSlug: string; newSlug: string;
  oldUrl: string; newUrl: string; locale: string; redirectCreated: boolean; routed: boolean;
}>> {
  const { contentType, folderSlug, locale, newSlug, createRedirect = false, enforceRedirectPolicy = false, author } = input;
  const rootName = input.contentRootName ?? getDefaultContentRootName();

  if (!contentType || !folderSlug || !locale || !newSlug) {
    return { success: false, statusCode: 400, error: "Missing required fields: contentType, folderSlug, locale, newSlug" };
  }
  if (!isValidType(contentType)) {
    return { success: false, statusCode: 400, error: `Invalid type. Must be one of: ${getAllTypes().join(", ")}` };
  }
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(newSlug)) {
    return { success: false, statusCode: 400, error: "Invalid slug format. Use lowercase letters, numbers, and hyphens only." };
  }

  const {
    assertCreateRedirectIfRequired,
    assertLocaleUrlAvailable,
    entryAgeHours,
    readPublishedAtFromCommon,
  } = await import("./locale-url-slug.js");

  const contentFolder = getFolder(contentType);
  const resolvedFolderSlug = contentIndex.resolveBaseSlug(folderSlug, contentFolder);
  const folderPath = path.join(process.cwd(), rootName, contentFolder, resolvedFolderSlug);

  if (!fs.existsSync(folderPath)) {
    return { success: false, statusCode: 404, error: `Content folder not found: ${folderSlug} (resolved: ${resolvedFolderSlug})` };
  }

  const effectiveLocale =
    contentType === "landing"
      ? ((contentIndex.loadCommonData("landing", resolvedFolderSlug)?.locale as string) || locale)
      : locale;

  const localeFile = [`${effectiveLocale}.yml`, `${effectiveLocale}.yaml`].find(
    (f) => fs.existsSync(path.join(folderPath, f)),
  );
  if (!localeFile) {
    return { success: false, statusCode: 404, error: `Locale file not found: ${effectiveLocale}` };
  }

  const localeFilePath = path.join(folderPath, localeFile);
  const raw = fs.readFileSync(localeFilePath, "utf-8");
  const parsed = contentIndex.safeYamlLoad(raw) as Record<string, unknown> | null;
  if (!parsed) return { success: false, statusCode: 500, error: "Failed to parse locale file" };

  const currentSlug = (parsed.slug as string) || folderSlug;
  if (currentSlug === newSlug) {
    return { success: false, statusCode: 400, error: "New slug is the same as current slug" };
  }

  const commonData = contentIndex.loadCommonData(contentType, resolvedFolderSlug) || {};
  const redirectGate = assertCreateRedirectIfRequired({
    ageHours: entryAgeHours(readPublishedAtFromCommon(commonData)),
    createRedirect: !!createRedirect,
    isLiveSlugChange: true,
    enforceRedirectPolicy,
  });
  if (!redirectGate.ok) {
    return { success: false, statusCode: redirectGate.statusCode, error: redirectGate.error };
  }

  const mergedForUrl = { ...commonData, ...parsed, slug: newSlug };
  const urlCheck = assertLocaleUrlAvailable({
    contentType,
    entryIdentity: resolvedFolderSlug,
    locale: effectiveLocale,
    mergedPageData: mergedForUrl,
    ci: contentIndex,
  });
  if (!urlCheck.ok) {
    return { success: false, statusCode: urlCheck.statusCode, error: urlCheck.error };
  }

  const mergedOldForUrl = { ...commonData, ...parsed, slug: currentSlug };
  const oldUrlResult = assertLocaleUrlAvailable({
    contentType,
    entryIdentity: resolvedFolderSlug,
    locale: effectiveLocale,
    mergedPageData: mergedOldForUrl,
    ci: contentIndex,
  });
  const oldUrl = oldUrlResult.ok
    ? oldUrlResult.url
    : contentIndex.buildUrl(contentFolder, effectiveLocale, currentSlug);
  const newUrl = urlCheck.url;
  parsed.slug = newSlug;

  if (createRedirect) {
    const meta = (parsed.meta || {}) as Record<string, unknown>;
    const redirects = Array.isArray(meta.redirects) ? [...meta.redirects] : [];
    if (!redirects.includes(oldUrl)) redirects.push(oldUrl);
    meta.redirects = redirects;
    parsed.meta = meta;
  }

  const updated = safeYamlDump(parsed, { lineWidth: -1, noRefs: true });
  fs.writeFileSync(localeFilePath, updated, "utf-8");
  markFileAsModified(`${rootName}/${contentFolder}/${resolvedFolderSlug}/${localeFile}`, author);
  contentIndex.refresh({ syncSlow: !!createRedirect });
  const routed = contentIndex.resolveUrl(newUrl)?.slug === resolvedFolderSlug;
  refreshSitemapEntry(contentType, resolvedFolderSlug, effectiveLocale);
  clearRedirectCache();
  invalidateContentCaches(contentType);

  return {
    success: true,
    data: {
      success: true, folderSlug: resolvedFolderSlug, oldSlug: currentSlug,
      newSlug, oldUrl, newUrl, locale: effectiveLocale, redirectCreated: !!createRedirect, routed,
    },
  };
}

// ─── deleteContentEntry ───────────────────────────────────────────────────────

export interface DeleteContentEntryInput {
  type: string;
  slug: string;
  author?: string;
  localesToDelete?: string[];
  contentRootName?: string;
}

export async function deleteContentEntry(
  input: DeleteContentEntryInput,
): Promise<ContentLifecycleResult<{ success: boolean; message: string; deletedFiles?: string[]; folderRemoved?: boolean }>> {
  const { type, slug, author, localesToDelete = [] } = input;
  const rootName = input.contentRootName ?? getDefaultContentRootName();

  if (!type || !slug) {
    return { success: false, statusCode: 400, error: "Missing required fields: type, slug" };
  }
  if (!isValidType(type)) {
    return { success: false, statusCode: 400, error: `Invalid type. Must be one of: ${getAllTypes().join(", ")}` };
  }
  if (/[/\\]|\.\./.test(slug) || slug.startsWith(".")) {
    return { success: false, statusCode: 400, error: "Invalid slug format" };
  }

  try {
    const { isProtectedContentSlug } = await import("./relation-delete");
    if (isProtectedContentSlug(type, slug)) {
      return {
        success: false,
        statusCode: 403,
        error: `Entry "${slug}" is a protected system entry and cannot be deleted`,
      };
    }
  } catch {
    /* ignore */
  }

  const typeFolder = getFolder(type);
  const resolvedSlug = contentIndex.resolveBaseSlug(slug, typeFolder);
  const folderPath = path.join(process.cwd(), rootName, typeFolder, resolvedSlug);

  if (!fs.existsSync(folderPath)) {
    return { success: false, statusCode: 404, error: `Content "${slug}" of type "${type}" not found` };
  }

  const realPath = fs.realpathSync(path.resolve(folderPath));
  const allowedBase = fs.realpathSync(path.join(process.cwd(), rootName, typeFolder));
  if (!realPath.startsWith(allowedBase + path.sep)) {
    return { success: false, statusCode: 400, error: "Invalid path" };
  }

  if (localesToDelete.length > 0) {
    const deletedFiles: string[] = [];
    for (const locale of localesToDelete) {
      const localeFile = path.join(folderPath, `${locale}.yml`);
      if (fs.existsSync(localeFile)) {
        fs.unlinkSync(localeFile);
        deletedFiles.push(`${locale}.yml`);
        markFileAsModified(`${rootName}/${typeFolder}/${resolvedSlug}/${locale}.yml`, author);
      }
    }

    const remainingFiles = fs.readdirSync(folderPath).filter((f) => f.endsWith(".yml") && !f.startsWith("_"));

    if (remainingFiles.length === 0) {
      const allFiles = fs.existsSync(folderPath) ? fs.readdirSync(folderPath) : [];
      for (const file of allFiles) {
        markFileAsModified(`${rootName}/${typeFolder}/${resolvedSlug}/${file}`, author);
      }
      fs.rmSync(folderPath, { recursive: true, force: true });
      log.info(`[Content] Deleted ${type}/${slug} (all locales removed, folder cleaned up)`);
      try {
        const { removeSlugFromAllDependants } = await import("./utils/sectionAnchors");
        removeSlugFromAllDependants(type, resolvedSlug);
      } catch { /* non-fatal */ }
    } else {
      log.info(`[Content] Deleted ${deletedFiles.join(", ")} from ${type}/${slug} (${remainingFiles.length} locale(s) remaining)`);
    }

    if (remainingFiles.length === 0) {
      invalidateSitemapEntriesByContentKey(`${type}:${resolvedSlug}`);
    } else {
      for (const deletedFile of deletedFiles) {
        invalidateSitemapEntry(`${type}:${resolvedSlug}:${deletedFile.replace(/\.ya?ml$/, "")}`);
      }
    }
    contentIndex.refresh();
    invalidateContentCaches(type);

    return {
      success: true,
      data: {
        success: true,
        message: remainingFiles.length === 0
          ? `Successfully deleted ${type}/${slug}`
          : `Deleted ${deletedFiles.join(", ")} from ${type}/${slug}`,
        deletedFiles,
        folderRemoved: remainingFiles.length === 0,
      },
    };
  }

  // Full folder delete
  const allFiles = fs.readdirSync(folderPath);
  for (const file of allFiles) {
    markFileAsModified(`${rootName}/${typeFolder}/${resolvedSlug}/${file}`, author);
  }
  fs.rmSync(folderPath, { recursive: true, force: true });
  log.info(`[Content] Deleted ${type}/${slug}`);
  invalidateSitemapEntriesByContentKey(`${type}:${resolvedSlug}`);
  contentIndex.refresh();
  invalidateContentCaches(type);

  try {
    const { removeSlugFromAllDependants } = await import("./utils/sectionAnchors");
    removeSlugFromAllDependants(type, resolvedSlug);
  } catch { /* non-fatal */ }

  return { success: true, data: { success: true, message: `Successfully deleted ${type}/${slug}` } };
}

// ─── createContentEntry ───────────────────────────────────────────────────────

export interface CreateContentEntryInput {
  type: string;
  slugEn?: string | null;
  slugEs?: string | null;
  title: string;
  sourceUrl?: string;
  /** Prefer when duplicating a draft (not in ContentIndex / no public URL). */
  sourceSlug?: string;
  sourceType?: string;
  changeContentType?: boolean;
  skipLocales?: string[];
  uniqueFieldValues?: Record<string, string | boolean>;
  /** locale → param → value for URL pattern params (e.g. :category), which may differ per locale */
  urlParamValues?: Record<string, Record<string, string>>;
  localeTitles?: Record<string, string>;
  author?: string;
  contentRootName?: string;
}

export async function createContentEntry(
  input: CreateContentEntryInput,
): Promise<ContentLifecycleResult<Record<string, unknown>>> {
  const {
    type, title, sourceUrl, sourceSlug, sourceType,
    changeContentType = false,
    skipLocales = [], uniqueFieldValues = {}, urlParamValues = {}, localeTitles = {}, author,
  } = input;
  const rootName = input.contentRootName ?? getDefaultContentRootName();
  const contentRootAbs = path.join(process.cwd(), rootName);
  const isFreshCreate = !sourceUrl && !sourceSlug;

  if (!type || !title) {
    return { success: false, statusCode: 400, error: "Missing required fields: type, title" };
  }
  if (!isValidType(type, contentRootAbs)) {
    return {
      success: false,
      statusCode: 400,
      error: `Invalid type. Must be one of: ${getAllTypes(contentRootAbs).join(", ")}`,
    };
  }

  const typeConfigForParams = getContentTypeConfig(type, contentRootAbs);
  const urlParams = listExtraUrlPatternParams(typeConfigForParams?.url_pattern);
  const urlParamShapes = inferUrlParamShapes(type, urlParams, rootName);

  const draftFirst = usesDraftFirstCreate(type, contentRootAbs);
  const sharedLayout = isSharedLayoutType(type, contentRootAbs);

  const activeUrlLocales = getSupportedLocales().filter(l => !skipLocales.includes(l));
  if (activeUrlLocales.length !== 1) {
    return {
      success: false,
      statusCode: 400,
      error: SINGLE_LOCALE_CREATE_ERROR,
    };
  }

  const urlParamValueForLocale = (param: string, loc: string): string | null =>
    normalizeUrlParamInput(urlParamValues[loc]?.[param]) ??
    normalizeUrlParamInput(uniqueFieldValues[param]);

  // Params whose value is identical across active locales go to _common.yml;
  // params that differ per locale are written into each locale file instead.
  const uniformUrlParams: Record<string, string> = {};
  const perLocaleUrlParams: string[] = [];
  for (const param of urlParams) {
    if (isLocaleOnlyUrlParam(param)) {
      if (activeUrlLocales.some((l) => urlParamValueForLocale(param, l))) {
        perLocaleUrlParams.push(param);
      }
      continue;
    }
    const vals = activeUrlLocales.map(l => urlParamValueForLocale(param, l));
    if (vals.length > 0 && vals[0] && vals.every(v => v === vals[0])) {
      uniformUrlParams[param] = vals[0];
    } else if (vals.some(v => v)) {
      perLocaleUrlParams.push(param);
    }
  }

  if (isFreshCreate && urlParams.length > 0) {
    const missing: string[] = [];
    for (const param of urlParams) {
      for (const loc of activeUrlLocales) {
        if (!urlParamValueForLocale(param, loc)) missing.push(`${param} (${loc})`);
      }
    }
    if (missing.length > 0) {
      return {
        success: false,
        statusCode: 400,
        error: `Missing required URL fields: ${missing.join(", ")}`,
      };
    }
  }

  const slugRegex = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
  const skipEn = skipLocales.includes("en");
  const skipEs = skipLocales.includes("es");
  const enSlug = skipEn ? null : (input.slugEn || null);
  const esSlug = skipEs ? null : (input.slugEs || null);

  if (!enSlug && !esSlug) {
    return { success: false, statusCode: 400, error: "At least one locale slug must be provided" };
  }
  if (enSlug && !slugRegex.test(enSlug)) {
    return { success: false, statusCode: 400, error: "Invalid English slug format. Use lowercase letters, numbers, and hyphens only." };
  }
  if (esSlug && !slugRegex.test(esSlug)) {
    return { success: false, statusCode: 400, error: "Invalid Spanish slug format. Use lowercase letters, numbers, and hyphens only." };
  }

  const folderSlug = (enSlug || esSlug)!;
  const existingTypeSlugs = contentIndex.listContentSlugs(type);
  if (existingTypeSlugs.includes(folderSlug)) {
    return { success: false, statusCode: 409, error: `A ${type} with slug "${folderSlug}" already exists` };
  }

  const folderPath = path.join(process.cwd(), rootName, getFolder(type), folderSlug);
  if (fs.existsSync(folderPath)) {
    return { success: false, statusCode: 409, error: `A ${type} with slug "${folderSlug}" already exists` };
  }

  fs.mkdirSync(folderPath, { recursive: true });
  const draftVariant = DEFAULT_DRAFT_VARIANT;
  const relFolder = `${rootName}/${getFolder(type)}/${folderSlug}`;

  const writeDraftVersioning = (locales: string[]) => {
    const data = buildDraftVersioning(locales, draftVariant);
    writeVersioningFile(
      folderPath,
      data,
      `${relFolder}/versioning.yml`,
      author,
      contentRootAbs,
    );
  };

  const draftSuccessData = (extra: Record<string, unknown> = {}) => ({
    success: true,
    slugEn: enSlug,
    slugEs: esSlug,
    type,
    directory: relFolder,
    status: "draft" as const,
    draftVariant,
    previewPath: `/private/preview/${type}/${folderSlug}?variant=${draftVariant}&locale=${enSlug ? "en" : "es"}`,
    ...extra,
  });

  if (sourceUrl || sourceSlug) {
    try {
      let foundSourceFolder = "";
      let resolved: ReturnType<typeof contentIndex.resolveUrl> = null;
      let resolvedSourceType = sourceType || type;

      if (sourceSlug) {
        const srcType = sourceType || type;
        const srcFolder = getFolder(srcType);
        const candidate = path.join(process.cwd(), rootName, srcFolder, sourceSlug);
        if (fs.existsSync(candidate)) {
          foundSourceFolder = candidate;
          resolvedSourceType = srcType;
        }
      } else if (sourceUrl) {
        const sourceUrlObj = new URL(sourceUrl);
        const sourcePath = sourceUrlObj.pathname;
        // Draft sitemap rows use /private/preview/:type/:slug — not a public URL pattern.
        const previewMatch = sourcePath.match(/^\/private\/preview\/([^/]+)\/([^/]+)\/?$/);
        if (previewMatch) {
          const previewType = sourceType || previewMatch[1];
          const previewSlug = previewMatch[2];
          const srcFolder = getFolder(previewType);
          const candidate = path.join(process.cwd(), rootName, srcFolder, previewSlug);
          if (fs.existsSync(candidate)) {
            foundSourceFolder = candidate;
            resolvedSourceType = previewType;
          }
        } else {
          resolved = contentIndex.resolveUrl(sourcePath);
          foundSourceFolder = resolved ? path.join(process.cwd(), resolved.entry.directory) : "";
          if (resolved) resolvedSourceType = resolved.contentType;
        }
      }

      if (foundSourceFolder) {
        // Cross-type duplication
        if (changeContentType && resolvedSourceType !== type) {
          const result = contentIndex.duplicateWithTypeChange({
            sourceDir: foundSourceFolder,
            sourceType: resolvedSourceType,
            targetType: type,
            targetDir: folderPath,
            newSlugs: { en: enSlug || undefined, es: esSlug || undefined },
            title: title || folderSlug,
            skipLocales,
            localeTitles,
          });
          for (const file of result.copiedFiles) {
            markFileAsModified(`${rootName}/${getFolder(type)}/${folderSlug}/${file}`, author);
          }

          if (draftFirst) {
            // Convert live locale files → draft.{locale}.yml
            const draftLocales: string[] = [];
            for (const loc of getSupportedLocales().filter((l) => !skipLocales.includes(l))) {
              const livePath = path.join(folderPath, `${loc}.yml`);
              if (!fs.existsSync(livePath)) continue;
              const draftPath = path.join(folderPath, `${draftVariant}.${loc}.yml`);
              fs.renameSync(livePath, draftPath);
              markFileAsModified(`${relFolder}/${draftVariant}.${loc}.yml`, author);
              draftLocales.push(loc);
            }
            // Also rename any existing draft.* copied from a draft source
            for (const f of fs.readdirSync(folderPath)) {
              if (f === "versioning.yml") {
                fs.unlinkSync(path.join(folderPath, f));
                continue;
              }
              const stem = f.replace(/\.ya?ml$/, "");
              if (/^[a-z0-9-]+\.[a-z]{2}(?:-[a-z]{2})?$/.test(stem) && !stem.startsWith(`${draftVariant}.`)) {
                // Keep as additional drafts if from draft source with other variants — for cross-type, drop extras
                fs.unlinkSync(path.join(folderPath, f));
              }
            }
            // If source was already draft-only, files may already be draft.*
            if (draftLocales.length === 0) {
              for (const loc of getSupportedLocales().filter((l) => !skipLocales.includes(l))) {
                const dp = path.join(folderPath, `${draftVariant}.${loc}.yml`);
                if (fs.existsSync(dp)) draftLocales.push(loc);
              }
            }
            writeDraftVersioning(draftLocales);
            applyPublishedAtAfterDuplicate(type, folderSlug, true, author, contentRootAbs);
            contentIndex.refresh();
            invalidateContentCaches(type);
            return {
              success: true,
              data: draftSuccessData({
                duplicatedFrom: sourceUrl || `${resolvedSourceType}/${sourceSlug}`,
                typeChanged: true,
                conversion: {
                  from: resolvedSourceType,
                  to: type,
                  copiedFiles: result.copiedFiles,
                  strippedFields: result.strippedFields,
                  replacedVars: result.replacedVars,
                },
                ...(result.clearedFields.length > 0 ? { clearedFields: result.clearedFields } : {}),
              }),
            };
          }

          applyPublishedAtAfterDuplicate(type, folderSlug, false, author, contentRootAbs);
          refreshSitemapEntriesForContentKey(type, folderSlug, getSupportedLocales().filter(l => !skipLocales.includes(l)));
          contentIndex.refresh();
          invalidateContentCaches(type);

          const localesToValidate1 = getSupportedLocales().filter(
            l => !skipLocales.includes(l) && fs.existsSync(path.join(folderPath, `${l}.yml`))
          );
          for (const locale of localesToValidate1) {
            const { error: validationError } = contentIndex.loadMergedContent(type, folderSlug, locale);
            if (validationError) {
              fs.rmSync(folderPath, { recursive: true, force: true });
              contentIndex.refresh();
              return { success: false, statusCode: 400, error: formatValidationError(type, validationError) };
            }
          }
          return {
            success: true,
            data: {
              success: true, slugEn: enSlug, slugEs: esSlug, type,
              directory: `${rootName}/${getFolder(type)}/${folderSlug}`,
              duplicatedFrom: sourceUrl || `${resolvedSourceType}/${sourceSlug}`, typeChanged: true,
              conversion: { from: resolvedSourceType, to: type, copiedFiles: result.copiedFiles, strippedFields: result.strippedFields, replacedVars: result.replacedVars },
              ...(result.clearedFields.length > 0 ? { clearedFields: result.clearedFields } : {}),
            },
          };
        }

        // Same-type duplication
        const sourceFiles = fs.readdirSync(foundSourceFolder);
        const parsedDupFiles: Array<{ file: string; parsed: Record<string, unknown> }> = [];
        const sourceLocaleFiles = new Set(
          sourceFiles.filter(f => f.endsWith(".yml") || f.endsWith(".yaml")).map(f => f.replace(/\.ya?ml$/, ""))
        );
        // Prefer live locale stems; fall back to draft.<locale> for draft sources
        const liveLocaleStems = new Set(
          [...sourceLocaleFiles].filter((s) => /^[a-z]{2}(-[a-z]{2})?$/.test(s)),
        );
        const draftLocaleFromFiles = new Map<string, string>(); // locale -> filename stem like draft.en
        for (const stem of sourceLocaleFiles) {
          const m = stem.match(/^([a-z0-9-]+)\.([a-z]{2}(?:-[a-z]{2})?)$/);
          if (m) draftLocaleFromFiles.set(m[2], stem);
        }

        for (const file of sourceFiles) {
          const fileLocale = file.replace(/\.yml$/, "");
          if (fileLocale !== "_common" && skipLocales.includes(fileLocale)) continue;
          if (!file.endsWith(".yml") && !file.endsWith(".yaml")) continue;

          // Draft-first: only copy _common + live locale files OR primary draft files
          if (draftFirst) {
            if (file === "versioning.yml" || file === "versioning.yaml") continue;
            const stem = file.replace(/\.ya?ml$/, "");
            const isLiveLocale = /^[a-z]{2}(-[a-z]{2})?$/.test(stem);
            const isCommon = file === "_common.yml" || file === "_common.yaml";
            const isPrimaryDraft = stem.startsWith(`${draftVariant}.`) ||
              (liveLocaleStems.size === 0 && /^[a-z0-9-]+\.[a-z]{2}(?:-[a-z]{2})?$/.test(stem));
            // When source is published: copy live only. When source is draft: copy draft.* files (one set).
            if (!isCommon && !isLiveLocale && !(liveLocaleStems.size === 0 && isPrimaryDraft && stem.startsWith(`${draftVariant}.`))) {
              // If no "draft." but other variants exist on draft source, copy first variant only via synthesis below
              if (!(liveLocaleStems.size === 0 && draftLocaleFromFiles.size > 0 && [...draftLocaleFromFiles.values()].includes(stem) && stem.split(".")[0] === (draftLocaleFromFiles.get(stem.split(".")[1] || "") || "").split(".")[0])) {
                // Simpler: if no live locales, copy only files matching DEFAULT draft variant or the first variant slug consistently
                if (liveLocaleStems.size === 0) {
                  const firstVariant = [...draftLocaleFromFiles.values()][0]?.split(".")[0];
                  if (!stem.startsWith(`${firstVariant}.`)) continue;
                } else {
                  continue;
                }
              }
            }
            if (!isCommon && !isLiveLocale && liveLocaleStems.size > 0) continue;
          }

          const rawContent = fs.readFileSync(path.join(foundSourceFolder, file), "utf8");

          const isContentFile =
            file === "_common.yml" || file === "_common.yaml" ||
            /^[a-z]{2,5}\.ya?ml$/.test(file) ||
            /^.+\.[a-z]{2,5}\.ya?ml$/.test(file);

          if (!isContentFile) {
            if (draftFirst) continue;
            fs.writeFileSync(path.join(folderPath, file), rawContent);
            markFileAsModified(`${rootName}/${getFolder(type)}/${folderSlug}/${file}`, author);
            continue;
          }

          const parsed = contentIndex.safeYamlLoad(rawContent) as Record<string, unknown> | null;
          if (!parsed) {
            fs.writeFileSync(path.join(folderPath, file), rawContent);
            markFileAsModified(`${rootName}/${getFolder(type)}/${folderSlug}/${file}`, author);
            continue;
          }

          delete parsed.redirects;
          if (parsed.meta && typeof parsed.meta === "object") {
            delete (parsed.meta as Record<string, unknown>).redirects;
          }

          const stem = file.replace(/\.ya?ml$/, "");
          const localeFromDraft = stem.match(/^[a-z0-9-]+\.([a-z]{2}(?:-[a-z]{2})?)$/)?.[1];
          const effectiveLocale = localeFromDraft || (file === "es.yml" ? "es" : file === "en.yml" ? "en" : fileLocale);

          const outFile = draftFirst && (file === "en.yml" || file === "es.yml" || /^[a-z]{2}(-[a-z]{2})?\.ya?ml$/.test(file) || localeFromDraft)
            ? `${draftVariant}.${effectiveLocale}.yml`
            : file;

          if (effectiveLocale === "es") {
            parsed.slug = esSlug || folderSlug;
          } else {
            parsed.slug = enSlug || folderSlug;
          }

          if (file === "_common.yml") {
            parsed.title = title;
            delete parsed.funnel;
            for (const [fieldName, newValue] of Object.entries(uniqueFieldValues)) {
              if (fieldName === "slug" || fieldName === "title") continue;
              parsed[fieldName] = coerceToOriginalType(String(newValue), parsed[fieldName]);
            }
            for (const [param, value] of Object.entries(uniformUrlParams)) {
              const existing = parsed[param];
              parsed[param] = existing !== undefined
                ? coerceToOriginalType(value, existing)
                : formatUrlParamFieldValue(value, urlParamShapes[param] ?? "string");
            }
            // Duplicates never keep source go-live date
            delete parsed[RESERVED_PUBLISHED_AT_FIELD];
            if (!draftFirst) {
              parsed[RESERVED_PUBLISHED_AT_FIELD] = new Date().toISOString();
            }
          } else if (
            file === "en.yml" || file === "es.yml" ||
            (draftFirst && (/^[a-z]{2}(-[a-z]{2})?\.ya?ml$/.test(file) || localeFromDraft))
          ) {
            const locTitle = localeTitles[effectiveLocale] || title;
            parsed.title = locTitle;
            if (locTitle) {
              if (!parsed.meta || typeof parsed.meta !== "object") parsed.meta = {};
              (parsed.meta as Record<string, unknown>).page_title = locTitle;
            }
            for (const param of perLocaleUrlParams) {
              const v = urlParamValueForLocale(param, effectiveLocale);
              if (v) {
                const existing = parsed[param];
                parsed[param] = existing !== undefined
                  ? coerceToOriginalType(v, existing)
                  : formatUrlParamFieldValue(v, urlParamShapes[param] ?? "string");
              }
            }
            // Drop locale override of reserved go-live date (canonical is _common.yml)
            const ovr = parsed[FIELD_OVERRIDES_KEY];
            if (ovr && typeof ovr === "object" && !Array.isArray(ovr)) {
              const nextOvr = { ...(ovr as Record<string, unknown>) };
              delete nextOvr[RESERVED_PUBLISHED_AT_FIELD];
              if (Object.keys(nextOvr).length === 0) delete parsed[FIELD_OVERRIDES_KEY];
              else parsed[FIELD_OVERRIDES_KEY] = nextOvr;
            }
          }
          parsedDupFiles.push({ file: outFile, parsed });
        }

        // Synthesize missing locale files from the source (never for shared-layout —
        // those must stay single-locale at create/duplicate).
        if (!sharedLayout) {
          const supportedLocs = getSupportedLocales();
          const existingSourceLocale =
            supportedLocs.find(l => liveLocaleStems.has(l)) ||
            supportedLocs.find(l => draftLocaleFromFiles.has(l));
          if (existingSourceLocale) {
            for (const loc of supportedLocs) {
              if (skipLocales.includes(loc) || liveLocaleStems.has(loc) || (draftFirst && draftLocaleFromFiles.has(loc) && liveLocaleStems.size === 0)) {
                if (skipLocales.includes(loc)) continue;
                if (liveLocaleStems.has(loc)) continue;
                if (draftFirst && draftLocaleFromFiles.has(loc) && liveLocaleStems.size === 0) continue;
              }
              if (skipLocales.includes(loc)) continue;
              if (liveLocaleStems.has(loc)) continue;
              // Already have draft for this locale from copy
              if (parsedDupFiles.some((f) => f.file === `${draftVariant}.${loc}.yml` || f.file === `${loc}.yml`)) continue;

              const srcFile = liveLocaleStems.has(existingSourceLocale)
                ? `${existingSourceLocale}.yml`
                : `${draftLocaleFromFiles.get(existingSourceLocale)}.yml`;
              const srcRaw = fs.readFileSync(path.join(foundSourceFolder, srcFile), "utf8");
              const cloned = contentIndex.safeYamlLoad(srcRaw) as Record<string, unknown> | null;
              if (!cloned) continue;
              delete cloned.redirects;
              if (cloned.meta && typeof cloned.meta === "object") {
                delete (cloned.meta as Record<string, unknown>).redirects;
              }
              cloned.slug = loc === "es" ? (esSlug || folderSlug) : (enSlug || folderSlug);
              cloned.locale = loc;
              const clonedTitle = localeTitles[loc] || title;
              cloned.title = clonedTitle;
              if (clonedTitle) {
                if (!cloned.meta || typeof cloned.meta !== "object") cloned.meta = {};
                (cloned.meta as Record<string, unknown>).page_title = clonedTitle;
              }
              for (const param of perLocaleUrlParams) {
                const v = urlParamValueForLocale(param, loc);
                if (v) {
                  const existing = cloned[param];
                  cloned[param] = existing !== undefined
                    ? coerceToOriginalType(v, existing)
                    : formatUrlParamFieldValue(v, urlParamShapes[param] ?? "string");
                }
              }
              const synthFile = draftFirst ? `${draftVariant}.${loc}.yml` : `${loc}.yml`;
              parsedDupFiles.push({ file: synthFile, parsed: cloned });
            }
          }
        }

        const fieldEditorsByType = loadAllFieldEditors(rootName);
        const clearedFields: ClearedField[] = [];
        for (const { file, parsed } of parsedDupFiles) {
          clearedFields.push(
            ...wipeDocumentSectionsOnDuplicate(parsed, fieldEditorsByType, { file }),
          );
        }

        const { objs: regeneratedDup } = regenerateSectionIds(parsedDupFiles.map(f => f.parsed));
        const draftLocalesWritten: string[] = [];
        for (let i = 0; i < parsedDupFiles.length; i++) {
          const { file } = parsedDupFiles[i];
          const content = safeYamlDump(regeneratedDup[i], { lineWidth: 120, noRefs: true, sortKeys: false });
          fs.writeFileSync(path.join(folderPath, file), content);
          markFileAsModified(`${rootName}/${getFolder(type)}/${folderSlug}/${file}`, author);
          const dm = file.match(new RegExp(`^${draftVariant}\\.([a-z]{2}(?:-[a-z]{2})?)\\.ya?ml$`));
          if (dm) draftLocalesWritten.push(dm[1]);
        }

        if (draftFirst) {
          writeDraftVersioning(draftLocalesWritten.length > 0
            ? draftLocalesWritten
            : getSupportedLocales().filter((l) => !skipLocales.includes(l)));
          contentIndex.refresh();
          invalidateContentCaches(type);
          return {
            success: true,
            data: draftSuccessData({
              duplicatedFrom: sourceUrl || `${resolvedSourceType}/${sourceSlug}`,
              ...(clearedFields.length > 0 ? { clearedFields } : {}),
            }),
          };
        }

        refreshSitemapEntriesForContentKey(type, folderSlug, getSupportedLocales().filter(l => !skipLocales.includes(l)));
        contentIndex.refresh();
        invalidateContentCaches(type);

        const localesToValidate2 = getSupportedLocales().filter(
          l => !skipLocales.includes(l) && fs.existsSync(path.join(folderPath, `${l}.yml`))
        );
        for (const locale of localesToValidate2) {
          const { error: validationError } = contentIndex.loadMergedContent(type, folderSlug, locale);
          if (validationError) {
            fs.rmSync(folderPath, { recursive: true, force: true });
            contentIndex.refresh();
            return { success: false, statusCode: 400, error: formatValidationError(type, validationError) };
          }
        }

        return {
          success: true,
          data: {
            success: true, slugEn: enSlug, slugEs: esSlug, type,
            directory: `${rootName}/${getFolder(type)}/${folderSlug}`,
            duplicatedFrom: sourceUrl || `${resolvedSourceType}/${sourceSlug}`,
            ...(clearedFields.length > 0 ? { clearedFields } : {}),
          },
        };
      }
    } catch (dupError) {
      log.error({ err: dupError }, "Error duplicating content:");
      // Fall through to fresh create
    }
  }

  // Fresh create from field_mapping
  const typeConfig = typeConfigForParams;
  const fieldMappingRaw = typeConfig?.field_mapping ?? {};
  const fieldKeys = Object.keys(fieldMappingRaw).filter(k => !k.startsWith("_"));
  const activeLocale = getSupportedLocales().find(l => !skipLocales.includes(l)) ?? getDefaultLocale();

  const commonObj: Record<string, unknown> = {};
  for (const key of fieldKeys) {
    if (key === "slug") commonObj.slug = folderSlug;
    else if (key === "title") commonObj.title = title;
    else if (key === "locale") commonObj.locale = activeLocale;
    else if (key === RESERVED_PUBLISHED_AT_FIELD) {
      // Draft-first: omit until publish/promote. Live create: stamp now.
      if (!draftFirst) commonObj[key] = new Date().toISOString();
    } else if (urlParams.includes(key) && !isLocaleOnlyUrlParam(key)) {
      const uniform = uniformUrlParams[key];
      commonObj[key] = uniform
        ? formatUrlParamFieldValue(uniform, urlParamShapes[key] ?? "string")
        : "";
    } else if (uniqueFieldValues[key] !== undefined) {
      const ufv = uniqueFieldValues[key];
      commonObj[key] = typeof ufv === "boolean" ? ufv : coerceStringValue(ufv as string);
    } else {
      commonObj[key] = "";
    }
  }
  // Uniform URL pattern params must be present even if missing from field_mapping
  for (const [param, value] of Object.entries(uniformUrlParams)) {
    if (commonObj[param] !== undefined && commonObj[param] !== "") continue;
    commonObj[param] = formatUrlParamFieldValue(value, urlParamShapes[param] ?? "string");
  }
  const commonYml = yaml.dump(commonObj, { lineWidth: 120, noRefs: true, sortKeys: false });

  const makeLocaleObj = (slug: string, loc: string) => {
    const obj: Record<string, unknown> = { slug, sections: [] };
    const localeTitle = localeTitles[loc];
    const effectiveTitle = localeTitle || title;
    if (localeTitle) obj.title = localeTitle;
    if (effectiveTitle) obj.meta = { page_title: effectiveTitle };
    // Locale-specific URL params (e.g. category slug that differs per language)
    for (const param of perLocaleUrlParams) {
      const v = urlParamValueForLocale(param, loc);
      if (v) obj[param] = formatUrlParamFieldValue(v, urlParamShapes[param] ?? "string");
    }
    return obj;
  };
  const enYml = yaml.dump(makeLocaleObj(enSlug || folderSlug, "en"), { lineWidth: 120, noRefs: true, sortKeys: false });
  const esYml = yaml.dump(makeLocaleObj(esSlug || folderSlug, "es"), { lineWidth: 120, noRefs: true, sortKeys: false });

  const createdFiles: string[] = [];
  if (!fs.existsSync(path.join(folderPath, "_common.yml"))) {
    fs.writeFileSync(path.join(folderPath, "_common.yml"), commonYml);
    createdFiles.push("_common.yml");
    markFileAsModified(`${relFolder}/_common.yml`, author);
  }

  const freshDraftLocales: string[] = [];
  if (draftFirst) {
    if (!skipEn) {
      const f = `${draftVariant}.en.yml`;
      fs.writeFileSync(path.join(folderPath, f), enYml);
      createdFiles.push(f);
      markFileAsModified(`${relFolder}/${f}`, author);
      freshDraftLocales.push("en");
    }
    if (!skipEs) {
      const f = `${draftVariant}.es.yml`;
      fs.writeFileSync(path.join(folderPath, f), esYml);
      createdFiles.push(f);
      markFileAsModified(`${relFolder}/${f}`, author);
      freshDraftLocales.push("es");
    }
    writeDraftVersioning(freshDraftLocales);
    contentIndex.refresh();
    invalidateContentCaches(type);
    return {
      success: true,
      data: draftSuccessData({ files: createdFiles, skippedLocales: skipLocales.length > 0 ? skipLocales : undefined }),
    };
  }

  if (!skipEn && !fs.existsSync(path.join(folderPath, "en.yml"))) {
    fs.writeFileSync(path.join(folderPath, "en.yml"), enYml);
    createdFiles.push("en.yml");
    markFileAsModified(`${relFolder}/en.yml`, author);
  }
  if (!skipEs && !fs.existsSync(path.join(folderPath, "es.yml"))) {
    fs.writeFileSync(path.join(folderPath, "es.yml"), esYml);
    createdFiles.push("es.yml");
    markFileAsModified(`${relFolder}/es.yml`, author);
  }

  refreshSitemapEntriesForContentKey(type, folderSlug, getSupportedLocales().filter(l => !skipLocales.includes(l)));
  contentIndex.refresh();
  invalidateContentCaches(type);

  const localesToValidate3 = getSupportedLocales().filter(l => !skipLocales.includes(l));
  for (const locale of localesToValidate3) {
    const { error: validationError } = contentIndex.loadMergedContent(type, folderSlug, locale);
    if (validationError) {
      fs.rmSync(folderPath, { recursive: true, force: true });
      contentIndex.refresh();
      return { success: false, statusCode: 400, error: formatValidationError(type, validationError) };
    }
  }

  return {
    success: true,
    data: {
      success: true, slugEn: enSlug, slugEs: esSlug, type,
      directory: `${rootName}/${getFolder(type)}/${folderSlug}`,
      files: createdFiles,
      skippedLocales: skipLocales.length > 0 ? skipLocales : undefined,
    },
  };
}
