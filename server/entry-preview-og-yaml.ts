/**
 * Persist generated entry-preview URL into locale YAML meta.og_image.
 * Cover (`_image` / `image`) is never treated as social — only `meta.og_image` gates soft writes.
 * Uses ?t= cache-bust for social crawlers.
 */

import type { ContentIndex } from "./content-index";
import { editContent } from "./content-editor";
import { isUsableOgImageUrl } from "@shared/ogImageUrl";
import { stripOgCacheBust } from "./entry-preview-capture-auth";
import { markFileAsModified } from "./sync-state";
import type { AutoCommitQueue } from "./auto-commit";
import { child } from "./logger";
import * as path from "path";
import { getFolder } from "./content-types";

const log = child({ module: "entry-preview-og-yaml" });

export type PersistOgYamlResult =
  | { wrote: true; ogImage: string; relativePath: string }
  | { wrote: false; reason: "editorial_image" | "edit_failed" | "unchanged"; detail?: string };

/** Read `meta.og_image` from an entry bag (listing or full YAML). */
export function getEntryMetaOgImage(entry: Record<string, unknown>): string {
  const meta =
    entry.meta && typeof entry.meta === "object" && !Array.isArray(entry.meta)
      ? (entry.meta as Record<string, unknown>)
      : {};
  return typeof meta.og_image === "string" ? meta.og_image.trim() : "";
}

/** True if url is the previous generated preview (same path, ignore ?t=). */
export function isPreviousGeneratedOgUrl(
  existing: string,
  previousGeneratedUrl: string | null | undefined,
): boolean {
  if (!existing || !previousGeneratedUrl) return false;
  return stripOgCacheBust(existing) === stripOgCacheBust(previousGeneratedUrl);
}

/**
 * Hand-picked social image: usable meta.og_image that is not the previous generated capture.
 * Cover / `_image` is ignored (cover ≠ social).
 */
export function isHandPickedOgImage(
  entry: Record<string, unknown>,
  previousGeneratedUrl: string | null | undefined,
): boolean {
  const ogImage = getEntryMetaOgImage(entry);
  if (!ogImage || /\{\{/.test(ogImage) || !isUsableOgImageUrl(ogImage)) return false;
  return !isPreviousGeneratedOgUrl(ogImage, previousGeneratedUrl);
}

export function shouldWriteGeneratedOgToYaml(opts: {
  entry: Record<string, unknown>;
  previousGeneratedUrl: string | null | undefined;
  /** When true, replace even hand-picked meta.og_image. */
  overwrite?: boolean;
}): { write: true } | { write: false; reason: "editorial_image" } {
  if (opts.overwrite) return { write: true };

  const ogImage = getEntryMetaOgImage(opts.entry);
  const prev = opts.previousGeneratedUrl || "";

  if (ogImage && isUsableOgImageUrl(ogImage) && !isPreviousGeneratedOgUrl(ogImage, prev)) {
    return { write: false, reason: "editorial_image" };
  }
  return { write: true };
}

export function buildOgImageYamlValue(publicUrl: string, capturedAt: string): string {
  const base = stripOgCacheBust(publicUrl);
  const t = capturedAt ? Date.parse(capturedAt) : NaN;
  const bust = Number.isFinite(t) ? t : Date.now();
  const sep = base.includes("?") ? "&" : "?";
  return `${base}${sep}t=${bust}`;
}

/**
 * After successful upsertWebp, write meta.og_image into live locale YAML when allowed.
 * Always uses skipPreviewCapture to avoid re-enqueue loops via editContent / pipeline.
 */
export async function persistGeneratedOgImageToEntryYaml(opts: {
  contentType: string;
  slug: string;
  locale: string;
  publicUrl: string;
  capturedAt: string;
  previousGeneratedUrl: string | null | undefined;
  contentRoot: string;
  contentRootName: string;
  ci: ContentIndex;
  autoCommitQueue: AutoCommitQueue;
  /** Pre-loaded entry (meta + image fields). */
  entry: Record<string, unknown>;
  author?: string;
  overwrite?: boolean;
}): Promise<PersistOgYamlResult> {
  const gate = shouldWriteGeneratedOgToYaml({
    entry: opts.entry,
    previousGeneratedUrl: opts.previousGeneratedUrl,
    overwrite: opts.overwrite,
  });
  if (!gate.write) {
    return { wrote: false, reason: "editorial_image" };
  }

  const ogImage = buildOgImageYamlValue(opts.publicUrl, opts.capturedAt);
  const existingOg = getEntryMetaOgImage(opts.entry);
  if (existingOg === ogImage) {
    return { wrote: false, reason: "unchanged" };
  }

  const result = await editContent({
    contentType: opts.contentType,
    slug: opts.slug,
    locale: opts.locale,
    contentRoot: opts.contentRoot,
    ci: opts.ci,
    skipPreviewCapture: true,
    operations: [{ action: "update_field", path: "meta.og_image", value: ogImage }],
  });

  if (!result.success) {
    log.warn(
      { err: result.error, contentType: opts.contentType, slug: opts.slug, locale: opts.locale },
      "[entry-preview-og-yaml] editContent failed",
    );
    return { wrote: false, reason: "edit_failed", detail: result.error };
  }

  const folder = getFolder(opts.contentType, opts.contentRoot);
  const relativePath = path.join(folder, opts.slug, `${opts.locale}.yml`).replace(/\\/g, "/");
  markFileAsModified(relativePath, opts.author, undefined, opts.contentRoot);
  opts.autoCommitQueue.queue(relativePath, opts.author);

  log.info(
    { relativePath, ogImage, contentType: opts.contentType, slug: opts.slug },
    "[entry-preview-og-yaml] wrote meta.og_image",
  );

  return { wrote: true, ogImage, relativePath };
}
