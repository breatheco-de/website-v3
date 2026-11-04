/**
 * The data tree links are read from for one content file. Shared by the per-entry
 * link-index write (content-quality) and the site-wide rebuild (site-link-index) so
 * both produce the same outbound list for an entry.
 */

import * as fs from "fs";
import * as yaml from "js-yaml";
import type { ContentFile } from "./types";

/** Parsed locale YAML, or `{}` when the file is missing (database item with no overrides). */
export function readLocaleFile(filePath: string): Record<string, unknown> | null {
  try {
    if (!fs.existsSync(filePath)) return {};
    const loaded = yaml.load(fs.readFileSync(filePath, "utf-8")) as Record<string, unknown> | null;
    return loaded && typeof loaded === "object" ? loaded : null;
  } catch {
    return null;
  }
}

/**
 * Locale file merged over the entry bag, preferring the locale file's own `sections`
 * and `content` (entry-bag sections include shared-template structure with unresolved
 * `{{ entry.* }}` placeholders that are not this entry's links).
 */
export function entryLinkSource(
  file: Pick<ContentFile, "filePath" | "entryFields">,
  parsed?: Record<string, unknown> | null,
): Record<string, unknown> {
  const local = parsed === undefined ? readLocaleFile(file.filePath) : parsed;
  const source = { ...(local ?? {}), ...(file.entryFields || {}) } as Record<string, unknown>;
  if (local && Array.isArray(local.sections)) source.sections = local.sections;
  if (local && typeof local.content === "string") source.content = local.content;
  return source;
}
