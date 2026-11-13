import { getContentTypeConfig } from "./content-types";
import type { FieldScopeOptions } from "@shared/field-scope";

/** URL pattern params of a content type (`:category`, …) — always locale-scoped. */
export function urlParamsForContentType(contentType: string, contentRoot?: string): string[] {
  const cfg = getContentTypeConfig(contentType, contentRoot) as
    | { url_pattern?: Record<string, string> | string }
    | undefined;
  const patterns =
    typeof cfg?.url_pattern === "string"
      ? [cfg.url_pattern]
      : Object.values(cfg?.url_pattern ?? {});
  const out = new Set<string>();
  for (const p of patterns) {
    for (const m of String(p).matchAll(/:([A-Za-z_][A-Za-z0-9_]*)/g)) out.add(m[1]!);
  }
  return [...out];
}

/** Page-level keys this content type adds to the system list (the form location page field). */
export function commonKeysForContentType(contentType: string, contentRoot?: string): string[] {
  const field = getContentTypeConfig(contentType, contentRoot)?.forms?.location?.entry_field;
  return field ? [field] : [];
}

export function fieldScopeOptionsForContentType(contentType: string, contentRoot?: string): FieldScopeOptions {
  return {
    urlParams: urlParamsForContentType(contentType, contentRoot),
    commonKeys: commonKeysForContentType(contentType, contentRoot),
  };
}
