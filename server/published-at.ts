/**
 * Reserved editorial `published_at` — stamped once on go-live, never recomputed on save.
 * Stored in entry `_common.yml` (static). Distinct from system `_updated_at`.
 */

import fs from "fs";
import path from "path";
import { dumpContentYaml, loadContentYamlObject } from "./content-yaml";
import { getFolder, RESERVED_PUBLISHED_AT_FIELD } from "./content-types";
import { getDefaultContentRoot } from "./site-config";
import { markFileAsModified } from "./sync-state";

export { RESERVED_PUBLISHED_AT_FIELD };

export function isPublishedAtEmpty(value: unknown): boolean {
  if (value === undefined || value === null) return true;
  if (typeof value === "string") return value.trim() === "";
  return false;
}

function commonYmlPath(contentType: string, slug: string, contentRoot?: string): string {
  const root = contentRoot ?? getDefaultContentRoot();
  return path.join(root, getFolder(contentType, contentRoot), slug, "_common.yml");
}

export function readPublishedAt(
  contentType: string,
  slug: string,
  contentRoot?: string,
): unknown {
  const commonPath = commonYmlPath(contentType, slug, contentRoot);
  if (!fs.existsSync(commonPath)) return undefined;
  try {
    const data = loadContentYamlObject(fs.readFileSync(commonPath, "utf-8")) ?? {};
    return data[RESERVED_PUBLISHED_AT_FIELD];
  } catch {
    return undefined;
  }
}

/** Write `published_at` on `_common.yml` (overwrites with a non-empty value). */
export function setPublishedAt(
  contentType: string,
  slug: string,
  value: string,
  author?: string,
  contentRoot?: string,
): { success: boolean; error?: string } {
  if (!slug || slug.includes("/") || contentType.includes("/")) {
    return { success: false, error: "Invalid path segment" };
  }
  if (isPublishedAtEmpty(value)) {
    return { success: false, error: "published_at cannot be empty" };
  }
  const commonPath = commonYmlPath(contentType, slug, contentRoot);
  try {
    fs.mkdirSync(path.dirname(commonPath), { recursive: true });
    let commonData: Record<string, unknown> = {};
    if (fs.existsSync(commonPath)) {
      commonData = loadContentYamlObject(fs.readFileSync(commonPath, "utf-8")) ?? {};
    }
    commonData[RESERVED_PUBLISHED_AT_FIELD] = value;
    if (commonData.updated_at === "" || commonData.updated_at === null) {
      delete commonData.updated_at;
    }
    fs.writeFileSync(
      commonPath,
      dumpContentYaml(commonData, { lineWidth: 120, noRefs: true, sortKeys: false }, commonPath),
      "utf-8",
    );
    markFileAsModified(commonPath, author, undefined, contentRoot);
    return { success: true };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : String(err) };
  }
}

/** Remove `published_at` from `_common.yml` (used when duplicating). */
export function clearPublishedAtFromCommon(
  contentType: string,
  slug: string,
  author?: string,
  contentRoot?: string,
): { success: boolean; error?: string } {
  const commonPath = commonYmlPath(contentType, slug, contentRoot);
  if (!fs.existsSync(commonPath)) return { success: true };
  try {
    const commonData =
      loadContentYamlObject(fs.readFileSync(commonPath, "utf-8")) ?? {};
    if (!(RESERVED_PUBLISHED_AT_FIELD in commonData)) return { success: true };
    delete commonData[RESERVED_PUBLISHED_AT_FIELD];
    if (commonData.updated_at === "" || commonData.updated_at === null) {
      delete commonData.updated_at;
    }
    fs.writeFileSync(
      commonPath,
      dumpContentYaml(commonData, { lineWidth: 120, noRefs: true, sortKeys: false }, commonPath),
      "utf-8",
    );
    markFileAsModified(commonPath, author, undefined, contentRoot);
    return { success: true };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : String(err) };
  }
}

/**
 * Stamp ISO `now` into `_common.yml` only when published_at is missing/empty.
 * Returns whether a write happened.
 */
export function ensurePublishedAtOnce(
  contentType: string,
  slug: string,
  opts?: { author?: string; contentRoot?: string; now?: string },
): { written: boolean; error?: string } {
  const current = readPublishedAt(contentType, slug, opts?.contentRoot);
  if (!isPublishedAtEmpty(current)) {
    return { written: false };
  }
  const iso = opts?.now ?? new Date().toISOString();
  const result = setPublishedAt(contentType, slug, iso, opts?.author, opts?.contentRoot);
  if (!result.success) return { written: false, error: result.error };
  return { written: true };
}
