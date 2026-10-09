/**
 * Which public HTML a content-type config change must rebuild.
 * The route uses the diff to emit the event. The rebuild job uses the rest.
 */

import type { ContentIndex } from "../../content-index";
import type { ContentTypeEntry } from "../../content-types";
import {
  getContentTypeConfig,
  getFieldMappingDefaults,
  getFullFieldMapping,
  resolveContentTypeUrl,
  resolveUrlPatternWithMapping,
} from "../../content-types";
import { loadItemsForType } from "../../entry-layer";
import { listStoredHtmlCacheKeys, parseHtmlCacheKey } from "../../html-page-cache";

const PUBLIC_KEYS = ["url_pattern", "layout", "single_template", "field_mapping", "database"] as const;

function stable(value: unknown): string {
  const sortValue = (input: unknown): unknown => {
    if (Array.isArray(input)) return input.map(sortValue);
    if (input && typeof input === "object") {
      const out: Record<string, unknown> = {};
      for (const key of Object.keys(input as object).sort()) {
        out[key] = sortValue((input as Record<string, unknown>)[key]);
      }
      return out;
    }
    return input;
  };
  return JSON.stringify(sortValue(value));
}

function publicFields(entry: Partial<ContentTypeEntry> | undefined): Record<string, unknown> {
  const pick: Record<string, unknown> = {};
  for (const key of PUBLIC_KEYS) pick[key] = entry?.[key] ?? null;
  return pick;
}

export function diffPublicContentTypes(
  before: Record<string, Partial<ContentTypeEntry> | undefined>,
  after: Record<string, Partial<ContentTypeEntry> | undefined>,
): { type: string; urlPatternChanged: boolean; previousUrlPattern?: Record<string, string> | null }[] {
  const names = new Set([...Object.keys(before), ...Object.keys(after)]);
  const changed: { type: string; urlPatternChanged: boolean; previousUrlPattern?: Record<string, string> | null }[] = [];
  for (const type of names) {
    const prev = publicFields(before[type]);
    const next = publicFields(after[type]);
    if (stable(prev) === stable(next)) continue;
    const urlPatternChanged = stable(prev.url_pattern ?? null) !== stable(next.url_pattern ?? null);
    changed.push({
      type,
      urlPatternChanged,
      ...(urlPatternChanged
        ? { previousUrlPattern: (before[type]?.url_pattern as Record<string, string> | undefined) ?? null }
        : {}),
    });
  }
  return changed;
}

export function planContentTypeHtmlUpdate(input: {
  urlPatternChanged: boolean;
  previousUrls: string[];
  nextUrls: string[];
  storedPaths: string[];
}): { drop: string[]; rebuild: string[] } {
  if (!input.urlPatternChanged) {
    return { drop: [], rebuild: [...new Set(input.storedPaths.filter(Boolean))] };
  }
  const next = new Set(input.nextUrls.filter(Boolean));
  const drop = [...new Set([...input.previousUrls, ...input.storedPaths])].filter((pathname) => pathname && !next.has(pathname));
  return { drop, rebuild: [...next] };
}

function addUrl(seen: Set<string>, url: string | null | undefined): void {
  if (!url || url === "/") return;
  const clean = url.split("?")[0]?.split("#")[0];
  if (!clean || clean.includes(":")) return;
  seen.add(clean);
}

function patternMap(
  raw: Record<string, string> | string | null | undefined,
): Record<string, string> | undefined {
  if (raw == null) return undefined;
  if (typeof raw === "string") return raw ? { default: raw } : undefined;
  return raw;
}

function fillPattern(pattern: string, locale: string, slug: string): string {
  return pattern.replaceAll(":locale", locale).replaceAll(":slug", slug).replace(/\/\/+/g, "/");
}

/**
 * Public addresses of a type from static entries and database items.
 * Pass a pattern to build the addresses from before a URL change. The worker
 * reads the YAML already saved, so the old pattern has to be supplied.
 */
export function publicUrlsForType(
  ci: ContentIndex,
  type: string,
  patternOverride?: Record<string, string> | string | null,
): string[] {
  const seen = new Set<string>();
  const override = arguments.length >= 3 ? patternMap(patternOverride) ?? {} : undefined;
  const config = ci.getContentTypeConfig(type) ?? getContentTypeConfig(type, ci.contentRoot);
  const patterns = override ?? config?.url_pattern ?? {};
  const patternLocales = Object.keys(patterns).filter((locale) => locale !== "default");
  const localesFor = (entryLocales: string[], itemLocale?: unknown): string[] => {
    if (typeof itemLocale === "string" && itemLocale) return [itemLocale];
    if (entryLocales.length > 0) return entryLocales;
    return patternLocales.length > 0 ? patternLocales : ["en"];
  };

  for (const entry of ci.findByType(type)) {
    if (entry.files.length === 0 && entry.slug === type) continue;
    for (const locale of localesFor(entry.locales)) {
      try {
        if (override) {
          const pattern = override[locale] || override.default || override.en;
          addUrl(seen, pattern ? fillPattern(pattern, locale, entry.slug) : null);
        } else {
          addUrl(seen, ci.buildUrl(type, locale, entry.slug));
        }
      } catch {
        /* pattern cannot be filled */
      }
    }
  }

  const items = loadItemsForType(ci, type);
  for (const item of items?.items ?? []) {
    const record = item as Record<string, unknown>;
    const slug = String(record.slug || "");
    if (!slug) continue;
    for (const locale of localesFor([], record.locale)) {
      try {
        if (override) {
          const pattern = override[locale] || override.default || override.en;
          addUrl(
            seen,
            pattern
              ? resolveUrlPatternWithMapping(
                  pattern,
                  record,
                  locale,
                  getFullFieldMapping(type, ci.contentRoot),
                  getFieldMappingDefaults(type, ci.contentRoot),
                )
              : null,
          );
        } else {
          addUrl(seen, resolveContentTypeUrl(type, record, locale, ci.contentRoot));
        }
      } catch {
        /* pattern cannot be filled */
      }
    }
  }
  return [...seen];
}

/** Stored HTML paths that currently resolve to this content type. */
export function storedPathsForContentType(
  ci: ContentIndex,
  siteId: string,
  type: string,
  extraPathnames: string[] = [],
): string[] {
  const wanted = ci.normalizeType(type);
  const out: string[] = [];
  const seen = new Set<string>();
  const consider = (pathname: string) => {
    if (!pathname || seen.has(pathname)) return;
    let resolved: { contentType: string } | null = null;
    try {
      resolved = ci.resolveUrl(pathname);
    } catch {
      resolved = null;
    }
    if (!resolved || ci.normalizeType(resolved.contentType) !== wanted) return;
    seen.add(pathname);
    out.push(pathname);
  };
  for (const key of listStoredHtmlCacheKeys(siteId)) {
    const parsed = parseHtmlCacheKey(key);
    if (parsed) consider(parsed.pathname);
  }
  for (const pathname of extraPathnames) consider(pathname);
  return out;
}
