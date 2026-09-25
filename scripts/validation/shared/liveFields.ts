/**
 * `editor.type: live_request` fields are fetched on page delivery, never stored in YAML or the
 * database cache — offline validation always sees them empty, so checks skip them by field type.
 */

import { getContentTypeConfig } from "../../../server/content-types";

export function isLiveRequestField(
  contentType: string | undefined,
  fieldPath: string,
  contentRoot?: string,
): boolean {
  if (!contentType || !fieldPath) return false;
  const editor = getContentTypeConfig(contentType, contentRoot)?.editor as
    | Record<string, { type?: unknown } | undefined>
    | undefined;
  if (!editor) return false;
  const root = fieldPath.split(".")[0]!;
  return editor[fieldPath]?.type === "live_request" || editor[root]?.type === "live_request";
}

const TEMPLATE_TOKEN = /\{\{\s*([^}|]+?)\s*(?:\|[^}]*)?\}\}/g;

/** True when every `{{ }}` left in `value` binds an entry field whose editor type is live_request. */
export function templatesOnlyReferenceLiveFields(
  value: unknown,
  contentType: string | undefined,
  contentRoot?: string,
): boolean {
  if (typeof value !== "string") return false;
  const tokens = [...value.matchAll(TEMPLATE_TOKEN)].map((m) => m[1]!.trim());
  if (tokens.length === 0) return false;
  return tokens.every((token) => {
    const match = token.match(/^(?:entry|single)\.(.+)$/);
    return match != null && isLiveRequestField(contentType, match[1]!, contentRoot);
  });
}
