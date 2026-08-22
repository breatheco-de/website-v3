/**
 * Bulk meta field updates across many entry slugs with coalesced post-write flush.
 */

import * as fs from "fs";
import * as path from "path";
import { editContent, editCommonContent } from "./content-editor";
import { flushAfterContentWrites, collectEntryHtmlPaths, type SitemapFlushEntry } from "./content-write-flush";
import type { ContentIndex } from "./content-index";
import { getContentTypeConfig, getDirectory, getAllConfigs } from "./content-types";
import { normalizeLocale } from "./settings";
import type { DatabaseManager } from "./database";

export const BULK_META_MAX_SLUGS = 50;

export const META_COMMON_KEYS = new Set(["robots", "priority", "change_frequency"]);
export const META_LOCALE_KEYS = new Set([
  "page_title",
  "description",
  "og_image",
  "og_type",
  "og_url",
  "og_locale",
  "canonical_url",
]);
export const ALL_KNOWN_META_KEYS = new Set([...META_COMMON_KEYS, ...META_LOCALE_KEYS]);

export type BulkMetaUpdateItem = {
  field_path: string;
  value: unknown;
  /** Required for unknown meta.* keys. */
  meta_target?: "locale" | "common";
};

export type BulkMetaSlugResult = {
  slug: string;
  contentType?: string;
  ok: boolean;
  error?: string;
  code?: string;
  missing_fields?: string[];
  wrote?: string[];
  action_required?: string;
};

export type BulkMetaRequest = {
  slugs: string[];
  locale?: string;
  updates: BulkMetaUpdateItem[];
  contentType?: string;
  variant?: string;
  confirm_live_edit?: boolean;
  author?: string;
  contentRoot?: string;
  contentRootName?: string;
  ci: ContentIndex;
  database?: DatabaseManager;
};

function normalizeMetaPath(fieldPath: string): string {
  if (fieldPath.startsWith("meta.")) return fieldPath;
  return `meta.${fieldPath}`;
}

function metaKeyFromPath(fieldPath: string): string {
  const p = normalizeMetaPath(fieldPath);
  return p.slice("meta.".length).split(".")[0];
}

export function validateBulkMetaUpdates(updates: BulkMetaUpdateItem[]): string | null {
  if (!updates.length) return "updates must be a non-empty array";
  const seen = new Set<string>();
  for (const u of updates) {
    if (!u.field_path || typeof u.field_path !== "string") {
      return "Each update requires a string field_path";
    }
    const raw = u.field_path;
    const isMetaPrefixed = raw.startsWith("meta.");
    const isBareKnown = ALL_KNOWN_META_KEYS.has(raw);
    if (!isMetaPrefixed && !isBareKnown) {
      return `Non-meta path rejected: ${raw}. Use update_fields for body/section paths.`;
    }
    const normalized = normalizeMetaPath(raw);
    if (seen.has(normalized)) {
      return `Duplicate field_path: ${normalized}`;
    }
    seen.add(normalized);

    const key = metaKeyFromPath(normalized);
    if (!ALL_KNOWN_META_KEYS.has(key) && !u.meta_target) {
      return `Unknown meta field '${key}' requires meta_target: "locale" | "common"`;
    }
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

function splitUpdates(updates: BulkMetaUpdateItem[]): {
  localeOps: Array<{ action: "update_field"; path: string; value: unknown }>;
  commonOps: Array<{ action: "update_field"; path: string; value: unknown }>;
  commonMetaTouched: boolean;
} {
  const localeOps: Array<{ action: "update_field"; path: string; value: unknown }> = [];
  const commonOps: Array<{ action: "update_field"; path: string; value: unknown }> = [];
  let commonMetaTouched = false;

  for (const u of updates) {
    const fieldPath = normalizeMetaPath(u.field_path);
    const key = metaKeyFromPath(fieldPath);
    const toCommon =
      META_COMMON_KEYS.has(key) ||
      (!ALL_KNOWN_META_KEYS.has(key) && u.meta_target === "common");
    if (toCommon) {
      commonMetaTouched = true;
      commonOps.push({ action: "update_field", path: fieldPath, value: u.value });
    } else {
      localeOps.push({ action: "update_field", path: fieldPath, value: u.value });
    }
  }
  return { localeOps, commonOps, commonMetaTouched };
}

/**
 * Apply the same meta updates to many slugs. Flushes caches/sitemap/CI once at end
 * if at least one slug succeeded. Does not enqueue entry preview captures.
 */
export async function bulkUpdateMeta(request: BulkMetaRequest): Promise<{
  success: boolean;
  results: BulkMetaSlugResult[];
  flushed: boolean;
  common_meta_touched: boolean;
  warnings: string[];
}> {
  const locale = normalizeLocale(request.locale || "en");
  const contentRoot = request.contentRoot || process.cwd();
  const warnings: string[] = [];
  const results: BulkMetaSlugResult[] = [];

  const { localeOps, commonOps, commonMetaTouched } = splitUpdates(request.updates);
  if (request.variant && commonMetaTouched) {
    warnings.push(
      "common_meta_ignores_variant: robots/priority/change_frequency (and common-targeted custom meta) write to _common.yml and ignore variant.",
    );
  }

  const contentTypes = new Set<string>();
  const sitemapEntries: SitemapFlushEntry[] = [];
  let successCount = 0;

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

    const wrote: string[] = [];
    let slugOk = true;
    let slugError: string | undefined;
    let slugCode: string | undefined;
    let missingFields: string[] | undefined;
    let localeWrote = false;

    if (localeOps.length > 0) {
      const localeResult = await editContent({
        contentType,
        slug,
        locale,
        operations: localeOps,
        variant: request.variant,
        author: request.author,
        contentRoot: request.contentRootName ?? request.contentRoot,
        database: request.database,
        ci: request.ci,
        skipSharedLayoutFanOut: true,
        skipPreviewCapture: true,
      });
      if (!localeResult.success) {
        slugOk = false;
        slugError = localeResult.error;
        slugCode = localeResult.errorCode;
        missingFields = localeResult.missingFields;
      } else {
        wrote.push("locale");
        localeWrote = true;
      }
    }

    if (slugOk && commonOps.length > 0) {
      const commonResult = editCommonContent({
        contentType,
        slug,
        operations: commonOps,
        author: request.author,
        ci: request.ci,
        contentRootName: request.contentRootName,
      });
      if (!commonResult.success) {
        slugOk = false;
        slugError =
          localeWrote
            ? `Locale meta written but _common.yml failed: ${commonResult.error}`
            : commonResult.error;
        slugCode = commonResult.errorCode;
        missingFields = commonResult.missingFields;
      } else {
        wrote.push("common");
      }
    }

    if (wrote.length > 0) {
      // Any successful file write contributes to end flush (including partial slug writes).
      contentTypes.add(contentType);
      sitemapEntries.push({ contentType, slug, locale });
      successCount += 1;
    }

    if (slugOk && wrote.length > 0) {
      results.push({ slug, contentType, ok: true, wrote });
    } else if (!slugOk) {
      results.push({
        slug,
        contentType,
        ok: false,
        error: slugError || "Unknown error",
        code: slugCode,
        missing_fields: missingFields,
        wrote: wrote.length ? wrote : undefined,
        action_required:
          slugCode === "live_required_fields" ? "fix_live_required_fields" : undefined,
      });
    } else {
      results.push({
        slug,
        contentType,
        ok: false,
        error: "No operations applied",
      });
    }
  }

  let flushed = false;
  if (successCount > 0) {
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
    const syncSlow = request.updates.some((u) => {
      const key = metaKeyFromPath(u.field_path);
      return key === "redirects" || u.field_path.includes("redirects");
    });
    flushAfterContentWrites({
      ci: request.ci,
      contentTypes,
      sitemapEntries,
      commonMetaTouched,
      siteId,
      htmlPaths,
      syncSlow,
    });
    flushed = true;
  }

  return {
    success: results.every((r) => r.ok),
    results,
    flushed,
    common_meta_touched: commonMetaTouched,
    warnings,
  };
}
