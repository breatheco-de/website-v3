/**
 * Bulk safe entry-attribute updates (meta.* + funnel.*) across many slugs.
 * Never sections/body — prevents multi-entry layout blast radius.
 */

import * as path from "path";
import {
  ALL_KNOWN_META_KEYS,
  BULK_META_MAX_SLUGS,
  bulkUpdateMeta,
  type BulkMetaRequest,
  type BulkMetaSlugResult,
  type BulkMetaUpdateItem,
  validateBulkMetaUpdates,
} from "./bulk-update-meta";
import {
  applyFunnelFieldUpdates,
  isFunnelFieldPath,
  prepareAndWriteFunnelMerge,
  readFunnelBlockFromFile,
  type FunnelFieldUpdate,
  type FunnelMergePatch,
} from "./funnel-fields";
import { assertFunnelAudienceGates } from "./product/funnel-audience-gates";
import { markFileAsModified } from "./sync-state";
import { flushAfterContentWrites, collectEntryHtmlPaths, type SitemapFlushEntry } from "./content-write-flush";
import { normalizeLocale } from "./settings";
import type { ContentIndex } from "./content-index";
import type { DatabaseManager } from "./database";
import * as fs from "fs";
import { getContentTypeConfig, getDirectory, getAllConfigs } from "./content-types";

export { BULK_META_MAX_SLUGS as BULK_ENTRY_ATTR_MAX_SLUGS };

export type BulkEntryAttrUpdateItem = BulkMetaUpdateItem & {
  reset?: boolean;
};

export type BulkEntryAttrSlugResult = BulkMetaSlugResult & {
  funnel?: unknown;
};

export type BulkEntryAttrRequest = {
  slugs: string[];
  locale?: string;
  updates: BulkEntryAttrUpdateItem[];
  contentType?: string;
  variant?: string;
  confirm_live_edit?: boolean;
  author?: string;
  contentRoot?: string;
  contentRootName?: string;
  ci: ContentIndex;
  database?: DatabaseManager;
};

function isMetaPath(fieldPath: string): boolean {
  return (
    fieldPath.startsWith("meta.") ||
    ALL_KNOWN_META_KEYS.has(fieldPath)
  );
}

export function validateBulkEntryAttrUpdates(updates: BulkEntryAttrUpdateItem[]): string | null {
  if (!updates.length) return "updates must be a non-empty array";
  const seen = new Set<string>();
  const metaItems: BulkMetaUpdateItem[] = [];
  for (const u of updates) {
    if (!u.field_path || typeof u.field_path !== "string") {
      return "Each update requires a string field_path";
    }
    const p = u.field_path;
    if (p.startsWith("sections.") || (!isMetaPath(p) && !isFunnelFieldPath(p))) {
      return (
        `Disallowed bulk path '${p}'. Only meta.* and funnel.stage|funnel.products ` +
        "(safe entry attributes). Use update_fields for body/sections on one slug."
      );
    }
    if (seen.has(p)) return `Duplicate field_path: ${p}`;
    seen.add(p);
    if (isMetaPath(p)) {
      if (u.reset === true) {
        return `reset:true is not supported for meta.* in bulk; omit the key or use update_fields.`;
      }
      metaItems.push({ field_path: p, value: u.value, meta_target: u.meta_target });
    } else if (u.reset !== true && u.value === undefined) {
      return `value is required for '${p}' unless reset:true`;
    }
  }
  if (metaItems.length > 0) {
    const metaErr = validateBulkMetaUpdates(metaItems);
    if (metaErr) return metaErr;
  }
  return null;
}

function resolveSlugContentType(
  slug: string,
  hint: string | undefined,
  contentRoot: string,
): { contentType: string } | null {
  if (hint) {
    const config = getContentTypeConfig(hint, contentRoot);
    if (!config) return null;
    const dir = path.join(contentRoot, getDirectory(hint, config), slug);
    if (fs.existsSync(dir)) return { contentType: hint };
    return null;
  }
  for (const [ct, config] of Object.entries(getAllConfigs(contentRoot))) {
    const dir = path.join(contentRoot, getDirectory(ct, config), slug);
    if (fs.existsSync(dir)) return { contentType: ct };
  }
  return null;
}

function entryHasVersioning(contentRoot: string, contentType: string, slug: string): boolean {
  const config = getContentTypeConfig(contentType, contentRoot);
  if (!config) return false;
  const versioningPath = path.join(
    contentRoot,
    getDirectory(contentType, config),
    slug,
    "versioning.yml",
  );
  return fs.existsSync(versioningPath);
}

function funnelPatchFromUpdates(updates: FunnelFieldUpdate[]): FunnelMergePatch {
  const patch: FunnelMergePatch = {};
  for (const u of updates) {
    if (u.field_path === "funnel.stage") {
      patch.touchStage = true;
      patch.stage = u.reset ? null : u.value;
    } else if (u.field_path === "funnel.products") {
      patch.touchProducts = true;
      patch.products = u.reset ? null : u.value;
    } else if (u.field_path === "funnel") {
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
    }
  }
  return patch;
}

/**
 * Apply the same safe attribute updates to many slugs.
 * If funnel is in the batch and fails gates for a slug, that slug gets neither meta nor funnel writes.
 */
export async function bulkUpdateEntryAttributes(request: BulkEntryAttrRequest): Promise<{
  success: boolean;
  results: BulkEntryAttrSlugResult[];
  flushed: boolean;
  common_meta_touched: boolean;
  funnel_touched: boolean;
  warnings: string[];
}> {
  const locale = normalizeLocale(request.locale || "en");
  const contentRoot = request.contentRoot || process.cwd();
  const metaUpdates = request.updates.filter((u) => isMetaPath(u.field_path));
  const funnelUpdates = request.updates.filter((u) => isFunnelFieldPath(u.field_path));
  const funnelTouched = funnelUpdates.length > 0;
  const warnings: string[] = [];

  if (request.variant && funnelTouched) {
    warnings.push(
      "funnel_locale_agnostic: funnel.* writes _common.yml (all languages) and ignores locale/variant.",
    );
  }

  // Meta-only: reuse existing bulk meta path.
  if (!funnelTouched) {
    const metaReq: BulkMetaRequest = {
      ...request,
      updates: metaUpdates.map((u) => ({
        field_path: u.field_path,
        value: u.value,
        meta_target: u.meta_target,
      })),
    };
    const metaResult = await bulkUpdateMeta(metaReq);
    return {
      ...metaResult,
      funnel_touched: false,
    };
  }

  // Funnel present: per-slug prepare funnel first; on fail skip all writes for that slug.
  const results: BulkEntryAttrSlugResult[] = [];
  const contentTypes = new Set<string>();
  const sitemapEntries: SitemapFlushEntry[] = [];
  let successCount = 0;
  let commonMetaTouched = false;
  const funnelFieldUpdates: FunnelFieldUpdate[] = funnelUpdates.map((u) => ({
    field_path: u.field_path,
    value: u.value,
    reset: u.reset === true,
  }));
  const patchTemplate = funnelPatchFromUpdates(funnelFieldUpdates);

  const slugsNeedingMeta: string[] = [];
  const slugContentTypes = new Map<string, string>();

  for (const slug of request.slugs) {
    const resolved = resolveSlugContentType(slug, request.contentType, contentRoot);
    if (!resolved) {
      results.push({
        slug,
        ok: false,
        error: `Page not found for slug '${slug}'${request.contentType ? ` (contentType: ${request.contentType})` : ""}`,
        code: "not_found",
      });
      continue;
    }
    const { contentType } = resolved;
    slugContentTypes.set(slug, contentType);

    if (!request.variant && !request.confirm_live_edit && entryHasVersioning(contentRoot, contentType, slug)) {
      results.push({
        slug,
        contentType,
        ok: false,
        error:
          `Page '${slug}' has active variants. Pass confirm_live_edit: true to edit live, or set variant to edit a draft.`,
        code: "confirm_live_edit",
        action_required: "confirm_live_edit",
      });
      continue;
    }

    // Pre-validate funnel merge + gates (no write yet).
    const filePath = path.join(
      contentRoot,
      getDirectory(contentType, getContentTypeConfig(contentType, contentRoot)!),
      slug,
      "_common.yml",
    );
    const current = readFunnelBlockFromFile(filePath);
    const merged = applyFunnelFieldUpdates(current, funnelFieldUpdates);
    if (!merged.ok) {
      results.push({
        slug,
        contentType,
        ok: false,
        error: merged.error,
        code: merged.code,
      });
      continue;
    }
    const gates = assertFunnelAudienceGates(merged.coerced, {
      contentType,
      contentSlug: slug,
    });
    if (!gates.ok) {
      results.push({
        slug,
        contentType,
        ok: false,
        error: gates.error,
        code: gates.code,
        action_required: gates.code,
      });
      continue;
    }

    slugsNeedingMeta.push(slug);
  }

  // Write meta only for slugs that passed funnel gates (per-slug rollback).
  const metaBySlug = new Map<string, BulkMetaSlugResult>();
  if (metaUpdates.length > 0 && slugsNeedingMeta.length > 0) {
    const metaResult = await bulkUpdateMeta({
      ...request,
      slugs: slugsNeedingMeta,
      updates: metaUpdates.map((u) => ({
        field_path: u.field_path,
        value: u.value,
        meta_target: u.meta_target,
      })),
    });
    commonMetaTouched = metaResult.common_meta_touched;
    warnings.push(...metaResult.warnings);
    for (const r of metaResult.results) {
      metaBySlug.set(r.slug, r);
    }
  }

  for (const slug of request.slugs) {
    if (results.some((r) => r.slug === slug)) continue; // already failed pre-check
    const contentType = slugContentTypes.get(slug);
    if (!contentType) continue;

    const metaRow = metaBySlug.get(slug);
    if (metaUpdates.length > 0) {
      if (!metaRow) {
        results.push({
          slug,
          contentType,
          ok: false,
          error: "Meta write skipped (funnel pre-check failed or slug missing from meta batch)",
          code: "meta_skipped",
        });
        continue;
      }
      if (!metaRow.ok) {
        // Meta failed — do not write funnel (rollback for this slug).
        results.push({ ...metaRow });
        continue;
      }
    }

    const funnelWrite = prepareAndWriteFunnelMerge(
      contentType,
      slug,
      patchTemplate,
      contentRoot,
      assertFunnelAudienceGates,
    );
    if (!funnelWrite.ok) {
      results.push({
        slug,
        contentType,
        ok: false,
        error:
          metaRow?.ok
            ? `Meta was written but funnel failed: ${funnelWrite.error}. Retry funnel.* only.`
            : funnelWrite.error,
        code: funnelWrite.code,
        wrote: metaRow?.wrote,
        action_required: funnelWrite.code,
      });
      if (metaRow?.ok) {
        // Partial: meta already written — count toward flush
        contentTypes.add(contentType);
        sitemapEntries.push({ contentType, slug, locale });
        successCount += 1;
      }
      continue;
    }

    if (funnelWrite.relativePath) {
      markFileAsModified(funnelWrite.relativePath, request.author ?? "staff", undefined, request.contentRoot);
    }

    const wrote = [...(metaRow?.wrote ?? []), "funnel"];
    contentTypes.add(contentType);
    sitemapEntries.push({ contentType, slug, locale });
    successCount += 1;
    results.push({
      slug,
      contentType,
      ok: true,
      wrote,
      funnel: funnelWrite.coerced,
    });
  }

  // Preserve input order
  const ordered: BulkEntryAttrSlugResult[] = [];
  for (const slug of request.slugs) {
    const row = results.find((r) => r.slug === slug);
    if (row) ordered.push(row);
  }

  let flushed = false;
  // Meta-only path already flushed inside bulkUpdateMeta. When we called meta for a subset,
  // it flushed; funnel writes may need an extra flush for common.yml. Always flush if we
  // wrote funnel after a meta-only flush or funnel-only.
  if (successCount > 0 && (funnelTouched || !metaUpdates.length || metaUpdates.length > 0)) {
    // If meta batch already flushed, still flush for funnel common paths (cheap).
    const siteId =
      request.contentRootName ||
      (request.contentRoot
        ? path.isAbsolute(request.contentRoot)
          ? path.relative(process.cwd(), request.contentRoot)
          : request.contentRoot
        : request.ci.contentRootName);
    const htmlPaths: string[] = [];
    const seenPath = new Set<string>();
    for (const entry of sitemapEntries) {
      for (const p of collectEntryHtmlPaths(
        request.ci,
        entry.contentType,
        entry.slug,
        entry.locale,
      )) {
        if (seenPath.has(p)) continue;
        seenPath.add(p);
        htmlPaths.push(p);
      }
    }
    flushAfterContentWrites({
      ci: request.ci,
      contentTypes,
      sitemapEntries,
      commonMetaTouched: true, // funnel is on _common.yml
      siteId,
      htmlPaths,
      syncSlow: false,
    });
    flushed = true;
  }

  return {
    success: ordered.every((r) => r.ok),
    results: ordered,
    flushed,
    common_meta_touched: commonMetaTouched || funnelTouched,
    funnel_touched: funnelTouched,
    warnings,
  };
}
