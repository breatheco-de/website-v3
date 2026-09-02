/**
 * Classify content file paths and YAML diffs into scoped event parts.
 */

import yaml from "js-yaml";
import { FUNNEL_YAML_KEY } from "@shared/funnel";
import { COMMON_OPERATIONAL_PATHS } from "@shared/validationScope";
import { didRedirectsChange } from "../redirects";
import { readSeoBlockFromYamlText, SEO_YAML_KEY } from "../seo-fields";

export const ENTRY_LOCALE_PARTS = [
  "sections",
  "meta",
  "redirects",
  "seo",
] as const;

export const ENTRY_COMMON_PARTS = [
  "funnel",
  "common_operational",
  "sections",
  "identity",
  "settings",
  "layout",
] as const;

export const REGISTRY_PARTS = ["schema", "field_editors", "examples"] as const;

export type EntryLocalePart = (typeof ENTRY_LOCALE_PARTS)[number];
export type EntryCommonPart = (typeof ENTRY_COMMON_PARTS)[number];
export type RegistryPart = (typeof REGISTRY_PARTS)[number];

export type EntryLocaleLayer = "live" | "variant";

export type ParsedEntryPath =
  | {
      scope: "entry_locale";
      contentType: string;
      slug: string;
      locale: string;
      layer: EntryLocaleLayer;
    }
  | { scope: "entry_common"; contentType: string; slug: string }
  | { scope: "site_redirects" }
  | { scope: "registry"; registryPart: RegistryPart }
  | { scope: "unknown" };

function normalizePath(filePath: string): string {
  return filePath.replace(/\\/g, "/");
}

export function parseContentFilePath(filePath: string): ParsedEntryPath {
  const norm = normalizePath(filePath);
  if (norm.endsWith("/custom-redirects.yml") || norm.endsWith("/custom-redirects.yaml")) {
    return { scope: "site_redirects" };
  }
  if (norm.includes("/component-registry/")) {
    if (/schema\.ya?ml$/i.test(norm)) return { scope: "registry", registryPart: "schema" };
    if (/field-editors\.ts$/i.test(norm)) return { scope: "registry", registryPart: "field_editors" };
    if (/examples\/[^/]+\.ya?ml$/i.test(norm)) return { scope: "registry", registryPart: "examples" };
    return { scope: "registry", registryPart: "schema" };
  }
  const m = norm.match(
    /\/(programs|landings|locations|pages|blog|workshops|events|courses)\/([^/]+)\/([^/]+)\.ya?ml$/i,
  );
  if (!m) return { scope: "unknown" };
  const folder = m[1]!.toLowerCase();
  const typeMap: Record<string, string> = {
    programs: "program",
    landings: "landing",
    locations: "location",
    pages: "page",
    blog: "blog",
    workshops: "workshop",
    events: "event",
    courses: "course",
  };
  const contentType = typeMap[folder] ?? folder.replace(/s$/, "");
  const slug = m[2]!;
  const base = m[3]!.replace(/\.ya?ml$/i, "");
  if (base === "_common") {
    return { scope: "entry_common", contentType, slug };
  }
  let locale = base;
  let layer: EntryLocaleLayer = "live";
  if (base.startsWith("template.") || base.startsWith("single.")) {
    const rest = base.startsWith("template.")
      ? base.slice("template.".length)
      : base.slice("single.".length);
    locale = rest.split(".")[0] || locale;
  } else if (/^[a-z]{2}$/i.test(base)) {
    locale = base;
  } else if (base.includes(".")) {
    const parts = base.split(".");
    locale = parts[parts.length - 1] || base;
    layer = "variant";
  }
  return { scope: "entry_locale", contentType, slug, locale, layer };
}

function parseYamlSafe(raw: string): Record<string, unknown> | null {
  if (!raw.trim()) return {};
  try {
    const parsed = yaml.load(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    return parsed as Record<string, unknown>;
  } catch {
    return null;
  }
}

function stableJson(v: unknown): string {
  try {
    return JSON.stringify(v);
  } catch {
    return "";
  }
}

function metaRedirectsChanged(prev: Record<string, unknown>, next: Record<string, unknown>): boolean {
  const prevMeta = prev.meta;
  const nextMeta = next.meta;
  if (!prevMeta && !nextMeta) return false;
  const p =
    prevMeta && typeof prevMeta === "object" && !Array.isArray(prevMeta)
      ? (prevMeta as Record<string, unknown>).redirects
      : undefined;
  const n =
    nextMeta && typeof nextMeta === "object" && !Array.isArray(nextMeta)
      ? (nextMeta as Record<string, unknown>).redirects
      : undefined;
  return stableJson(p) !== stableJson(n);
}

function metaNonRedirectChanged(prev: Record<string, unknown>, next: Record<string, unknown>): boolean {
  const prevMeta = prev.meta;
  const nextMeta = next.meta;
  if (!prevMeta && !nextMeta) return false;
  const p =
    prevMeta && typeof prevMeta === "object" && !Array.isArray(prevMeta)
      ? { ...(prevMeta as Record<string, unknown>) }
      : {};
  const n =
    nextMeta && typeof nextMeta === "object" && !Array.isArray(nextMeta)
      ? { ...(nextMeta as Record<string, unknown>) }
      : {};
  delete p.redirects;
  delete n.redirects;
  return stableJson(p) !== stableJson(n);
}

export function diffEntryLocaleParts(prevRaw: string, nextRaw: string): EntryLocalePart[] {
  const parts: EntryLocalePart[] = [];
  const prevSeo = readSeoBlockFromYamlText(prevRaw);
  const nextSeo = readSeoBlockFromYamlText(nextRaw);
  if (stableJson(prevSeo) !== stableJson(nextSeo)) parts.push("seo");

  const prev = parseYamlSafe(prevRaw);
  const next = parseYamlSafe(nextRaw);
  if (!prev || !next) {
    if (prevRaw !== nextRaw) parts.push("sections");
    return parts;
  }

  if (metaRedirectsChanged(prev, next)) parts.push("redirects");
  if (metaNonRedirectChanged(prev, next)) parts.push("meta");

  const prevSections = prev.sections;
  const nextSections = next.sections;
  if (stableJson(prevSections) !== stableJson(nextSections)) parts.push("sections");

  const classified = new Set(parts);
  const ignoreKeys = new Set([SEO_YAML_KEY, "meta", "sections"]);
  for (const key of Object.keys(next)) {
    if (ignoreKeys.has(key)) continue;
    if (stableJson(prev[key]) !== stableJson(next[key])) {
      if (!classified.has("sections")) parts.push("sections");
      break;
    }
  }
  return parts;
}

export function diffEntryCommonParts(prevRaw: string, nextRaw: string): EntryCommonPart[] {
  const parts: EntryCommonPart[] = [];
  const prev = parseYamlSafe(prevRaw);
  const next = parseYamlSafe(nextRaw);
  if (!prev || !next) {
    if (prevRaw !== nextRaw) parts.push("identity");
    return parts;
  }

  if (stableJson(prev[FUNNEL_YAML_KEY]) !== stableJson(next[FUNNEL_YAML_KEY])) parts.push("funnel");

  for (const key of COMMON_OPERATIONAL_PATHS) {
    if (stableJson(prev[key]) !== stableJson(next[key])) {
      parts.push("common_operational");
      break;
    }
  }

  if (stableJson(prev.sections) !== stableJson(next.sections)) parts.push("sections");

  const identityKeys = ["slug", "title", "bc_slug", "job_role"];
  for (const key of identityKeys) {
    if (stableJson(prev[key]) !== stableJson(next[key])) {
      parts.push("identity");
      break;
    }
  }

  if (stableJson(prev.settings) !== stableJson(next.settings)) parts.push("settings");
  if (stableJson(prev.layout) !== stableJson(next.layout)) parts.push("layout");

  if (parts.length === 0 && prevRaw !== nextRaw) parts.push("identity");
  return parts;
}

export function siteRedirectsChanged(prevRaw: string | undefined, nextRaw: string): boolean {
  return didRedirectsChange(prevRaw, nextRaw, { isCustomRedirectsFile: true });
}

export function entryRedirectsChangedWithoutLocaleSave(
  prevRaw: string | undefined,
  nextRaw: string,
): boolean {
  return didRedirectsChange(prevRaw, nextRaw, { isCustomRedirectsFile: false });
}
