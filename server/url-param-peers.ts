/**
 * URL-pattern param peer observation (locale-scoped writes, locale-only observe).
 */
import fs from "fs";
import path from "path";
import yaml from "js-yaml";
import {
  type ContentTypeConfig,
  getRawUrlParamValue,
  listExtraUrlPatternParams,
} from "./content-types";

function safeLoad(raw: string): Record<string, unknown> | null {
  try {
    const parsed = yaml.load(raw);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

/** Extra `:param` names from a content type config (excludes :slug / :locale). */
export function urlPatternParams(config: ContentTypeConfig): string[] {
  return listExtraUrlPatternParams(config.url_pattern);
}

export function isUrlPatternParam(config: ContentTypeConfig, param: string): boolean {
  return urlPatternParams(config).includes(param);
}

export function extractParamSlug(value: unknown): string | null {
  if (typeof value === "string" && value.trim()) return value.trim();
  if (value && typeof value === "object" && !Array.isArray(value)) {
    const slug = (value as Record<string, unknown>).slug;
    if (typeof slug === "string" && slug.trim()) return slug.trim();
  }
  return null;
}

export function localeYamlCandidatesForObserve(locale: string): string[] {
  return [`${locale}.yml`, `${locale}.yaml`, `draft.${locale}.yml`, `draft.${locale}.yaml`];
}

export function observeParamValues(
  contentPath: string,
  contentType: string,
  config: ContentTypeConfig,
  param: string,
  locale?: string,
): string[] {
  const dirName = config.directory || contentType;
  const dir = path.join(contentPath, dirName);
  if (!fs.existsSync(dir)) return [];
  const seen = new Set<string>();
  const mapping = config.field_mapping;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    if (entry.name.startsWith("_")) continue;
    const candidates = locale
      ? localeYamlCandidatesForObserve(locale).map((f) => path.join(dir, entry.name, f))
      : ["en", "es"].flatMap((loc) =>
          localeYamlCandidatesForObserve(loc).map((f) => path.join(dir, entry.name, f)),
        );
    for (const file of candidates) {
      if (!fs.existsSync(file)) continue;
      try {
        const data = safeLoad(fs.readFileSync(file, "utf-8"));
        if (!data) continue;
        const raw = getRawUrlParamValue(data, param, mapping);
        const slug = extractParamSlug(raw);
        if (slug) seen.add(slug);
      } catch {
        /* skip */
      }
    }
  }
  return [...seen].sort();
}

export function observeParamValuesByLocale(
  contentPath: string,
  contentType: string,
  config: ContentTypeConfig,
  param: string,
  locales: string[] = ["en", "es"],
): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const locale of locales) {
    out[locale] = observeParamValues(contentPath, contentType, config, param, locale);
  }
  return out;
}

export type UrlParamPeerGateFailure = {
  param: string;
  locale: string;
  proposed_value: string;
  observed_values: string[];
};

export function validateUrlParamPeerValues(
  contentPath: string,
  contentType: string,
  config: ContentTypeConfig,
  proposedByLocale: Record<string, Record<string, string>>,
  confirmNewValues?: boolean,
): UrlParamPeerGateFailure | null {
  if (confirmNewValues) return null;
  for (const [locale, params] of Object.entries(proposedByLocale)) {
    for (const [param, value] of Object.entries(params)) {
      const observed = observeParamValues(contentPath, contentType, config, param, locale);
      if (observed.length > 0 && !observed.includes(value)) {
        return { param, locale, proposed_value: value, observed_values: observed };
      }
    }
  }
  return null;
}

export function collectProposedUrlParamValuesByLocale(
  _common: Record<string, unknown>,
  locales: Record<string, Record<string, unknown>>,
  params: string[],
): Record<string, Record<string, string>> {
  const out: Record<string, Record<string, string>> = {};
  for (const [loc, locData] of Object.entries(locales)) {
    out[loc] = {};
    for (const param of params) {
      const v = extractParamSlug(locData[param]);
      if (v) out[loc][param] = v;
    }
  }
  return out;
}
