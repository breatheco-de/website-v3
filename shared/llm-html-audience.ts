/**
 * HTML copy for AI crawlers. Humans keep the live copy.
 * A filtered section gets a visible header. A shared section keeps one body
 * and expands a by_region token in place.
 */

export const AUDIENCE_LLM_VARIANT = "audience-llm";

/** Matches server/shared-layout-sync HIDDEN_LOCATION_SENTINEL. */
export const HIDDEN_LOCATION_SENTINEL = "__none__";

export const LLM_REGION_CITY_THRESHOLD = 5;

export const LLM_REGION_SLUGS = ["usa-canada", "europe", "latam"] as const;
export type LlmRegionSlug = (typeof LLM_REGION_SLUGS)[number];

const REGION_LABELS: Record<LlmRegionSlug, { en: string; es: string }> = {
  "usa-canada": { en: "US & Canada", es: "EE.UU. y Canadá" },
  europe: { en: "Europe", es: "Europa" },
  latam: { en: "Latin America", es: "Latinoamérica" },
};

export const LLM_GLOBAL_LABEL = "Global";

export type LlmVariableDef = {
  default?: string;
  by_locale?: Record<string, string>;
  by_region?: Record<string, string>;
  by_location?: Record<string, string>;
};

export type LlmLocationCatalog = {
  regionOf(slug: string): LlmRegionSlug | null;
  cityName(slug: string): string;
  regionLabel?(slug: string, locale: string): string;
};

export type LlmAudiencePart =
  | { kind: "region"; region: LlmRegionSlug; label: string }
  | { kind: "city"; slug: string; region: LlmRegionSlug | null; label: string };

export type SectionLlmAudience =
  | { kind: "plain" }
  | { kind: "hidden" }
  | { kind: "labeled"; text: string; dataRegion: string; parts: LlmAudiencePart[] };

const TOKEN_RE = /\{\{\s*([^|}]+?)\s*(?:\|\s*([\s\S]*?))?\s*\}\}/g;

export function llmRegionLabel(slug: string, locale: string): string {
  const entry = REGION_LABELS[slug as LlmRegionSlug];
  if (!entry) return slug;
  return locale === "es" ? entry.es : entry.en;
}

function asStringList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string" && item.trim().length > 0);
}

function isRegionSlug(slug: string): slug is LlmRegionSlug {
  return (LLM_REGION_SLUGS as readonly string[]).includes(slug);
}

/**
 * Header for a section that has a real show-on filter.
 * Five or more cities in one region collapse to that region.
 * Fewer cities keep their names. A missing region is not invented.
 */
export function describeSectionAudience(
  section: unknown,
  locale: string,
  catalog: LlmLocationCatalog,
): SectionLlmAudience {
  if (!section || typeof section !== "object") return { kind: "plain" };
  const record = section as Record<string, unknown>;
  const regions = asStringList(record.showOnRegions).filter(isRegionSlug);
  const locations = asStringList(record.showOnLocations);
  const realLocations = locations.filter((slug) => slug !== HIDDEN_LOCATION_SENTINEL);

  if (regions.length === 0 && locations.length > 0 && realLocations.length === 0) {
    return { kind: "hidden" };
  }
  if (regions.length === 0 && realLocations.length === 0) return { kind: "plain" };

  const parts: LlmAudiencePart[] = [];
  const regionSeen = new Set<LlmRegionSlug>();

  for (const region of regions) {
    if (regionSeen.has(region)) continue;
    regionSeen.add(region);
    parts.push({ kind: "region", region, label: regionName(region, locale, catalog) });
  }

  const byRegion = new Map<string, string[]>();
  for (const slug of realLocations) {
    const region = catalog.regionOf(slug);
    const key = region ?? `city:${slug}`;
    const list = byRegion.get(key) ?? [];
    list.push(slug);
    byRegion.set(key, list);
  }

  for (const [key, slugs] of byRegion) {
    const region = key.startsWith("city:") ? null : (key as LlmRegionSlug);
    if (region && regionSeen.has(region)) continue;
    if (region && slugs.length >= LLM_REGION_CITY_THRESHOLD) {
      regionSeen.add(region);
      parts.push({ kind: "region", region, label: regionName(region, locale, catalog) });
      continue;
    }
    for (const slug of slugs) {
      parts.push({
        kind: "city",
        slug,
        region,
        label: catalog.cityName(slug),
      });
    }
  }

  if (parts.length === 0) return { kind: "plain" };
  return {
    kind: "labeled",
    text: parts.map((part) => part.label).join(" · "),
    dataRegion: parts.map((part) => (part.kind === "region" ? part.region : part.slug)).join(","),
    parts,
  };
}

export function variableBaseline(def: LlmVariableDef, locale: string, inlineDefault = ""): string {
  if (locale && def.by_locale?.[locale]) return def.by_locale[locale];
  if (def.default !== undefined) return def.default;
  return inlineDefault;
}

export function regionDiffersFromBaseline(def: LlmVariableDef, locale: string): boolean {
  if (!def.by_region) return false;
  const base = variableBaseline(def, locale);
  return Object.values(def.by_region).some((value) => value !== base);
}

function regionName(slug: string, locale: string, catalog?: LlmLocationCatalog): string {
  return catalog?.regionLabel?.(slug, locale) ?? llmRegionLabel(slug, locale);
}

function labeledValue(value: string, suffix: string, label: string): string {
  return `${value}${suffix} (${label})`;
}

/**
 * Replacement for one token, or null when the token should stay for normal resolution.
 * Text glued to the token (no space), such as `/month`, is repeated on every value.
 */
export function formatLlmVariableToken(
  def: LlmVariableDef | undefined,
  locale: string,
  inlineDefault: string,
  suffix: string,
  parts: LlmAudiencePart[] | null,
  catalog?: LlmLocationCatalog,
): string | null {
  if (!def) return null;
  const base = variableBaseline(def, locale, inlineDefault);

  if (!parts) {
    if (!regionDiffersFromBaseline(def, locale)) return null;
    const chunks = [labeledValue(base, suffix, LLM_GLOBAL_LABEL)];
    for (const region of LLM_REGION_SLUGS) {
      const value = def.by_region?.[region];
      if (value === undefined || value === base) continue;
      chunks.push(labeledValue(value, suffix, regionName(region, locale, catalog)));
    }
    return chunks.join(" · ");
  }

  const chunks: string[] = [];
  const seen = new Set<string>();
  for (const part of parts) {
    let value = base;
    if (part.kind === "city") {
      value = def.by_location?.[part.slug] ?? (part.region ? def.by_region?.[part.region] : undefined) ?? base;
    } else {
      value = def.by_region?.[part.region] ?? base;
    }
    const shown = `${value}${suffix}`;
    if (seen.has(shown)) continue;
    seen.add(shown);
    chunks.push(labeledValue(value, suffix, part.label));
  }
  if (seen.size <= 1) {
    const only = [...seen][0];
    if (!only || only === `${base}${suffix}`) return null;
    return only;
  }
  return chunks.join(" · ");
}

export function expandLlmVariableString(
  text: string,
  definitions: Record<string, LlmVariableDef>,
  locale: string,
  parts: LlmAudiencePart[] | null,
  catalog?: LlmLocationCatalog,
): string {
  if (!text.includes("{{")) return text;
  const re = new RegExp(TOKEN_RE.source, TOKEN_RE.flags);
  let out = "";
  let last = 0;
  for (const match of text.matchAll(re)) {
    const index = match.index ?? 0;
    out += text.slice(last, index);
    const name = match[1].trim();
    const inlineDefault = (match[2] ?? "").trim();
    let end = index + match[0].length;
    let suffix = "";
    if (end < text.length && text[end] !== " " && text[end] !== "\n" && text[end] !== "\t") {
      const glued = /^[^\s]+/.exec(text.slice(end));
      if (glued) {
        suffix = glued[0];
        end += suffix.length;
      }
    }
    const replacement = formatLlmVariableToken(definitions[name], locale, inlineDefault, suffix, parts, catalog);
    out += replacement ?? text.slice(index, end);
    last = end;
  }
  out += text.slice(last);
  return out;
}

const SKIP_EXPAND_KEYS = new Set(["showOnLocations", "showOnRegions", "showOn"]);

export function expandLlmVariablesDeep(
  value: unknown,
  definitions: Record<string, LlmVariableDef>,
  locale: string,
  parts: LlmAudiencePart[] | null,
  catalog?: LlmLocationCatalog,
): unknown {
  if (typeof value === "string") return expandLlmVariableString(value, definitions, locale, parts, catalog);
  if (Array.isArray(value)) return value.map((item) => expandLlmVariablesDeep(item, definitions, locale, parts, catalog));
  if (!value || typeof value !== "object") return value;
  const next: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    next[key] = SKIP_EXPAND_KEYS.has(key) ? child : expandLlmVariablesDeep(child, definitions, locale, parts, catalog);
  }
  return next;
}

function stringHasDifferingRegionVariable(
  text: string,
  definitions: Record<string, LlmVariableDef>,
  locale: string,
): boolean {
  if (!text.includes("{{")) return false;
  const re = new RegExp(TOKEN_RE.source, TOKEN_RE.flags);
  for (const match of text.matchAll(re)) {
    const name = match[1].trim();
    const def = definitions[name];
    if (def && regionDiffersFromBaseline(def, locale)) return true;
  }
  return false;
}

function valueUsesRegionVariable(
  value: unknown,
  definitions: Record<string, LlmVariableDef>,
  locale: string,
): boolean {
  if (typeof value === "string") return stringHasDifferingRegionVariable(value, definitions, locale);
  if (Array.isArray(value)) return value.some((item) => valueUsesRegionVariable(item, definitions, locale));
  if (!value || typeof value !== "object") return false;
  return Object.entries(value as Record<string, unknown>).some(([key, child]) => {
    if (SKIP_EXPAND_KEYS.has(key)) return false;
    return valueUsesRegionVariable(child, definitions, locale);
  });
}

export function sectionsBranchForLlm(
  sections: unknown[],
  definitions: Record<string, LlmVariableDef>,
  locale: string,
  catalog: LlmLocationCatalog,
): boolean {
  for (const section of sections) {
    const audience = describeSectionAudience(section, locale, catalog);
    if (audience.kind === "labeled") return true;
    if (audience.kind === "hidden") continue;
    if (valueUsesRegionVariable(section, definitions, locale)) return true;
  }
  return false;
}

function collectSectionArrays(value: unknown, out: unknown[][]): void {
  if (!value || typeof value !== "object") return;
  if (Array.isArray(value)) {
    for (const item of value) collectSectionArrays(item, out);
    return;
  }
  const record = value as Record<string, unknown>;
  if (Array.isArray(record.sections)) out.push(record.sections);
  for (const child of Object.values(record)) collectSectionArrays(child, out);
}

/** True when the initial-data payload needs an audience-llm copy. */
export function initialDataBranchesForLlm(
  payload: unknown,
  locale: string,
  catalog: LlmLocationCatalog,
): boolean {
  if (!payload || typeof payload !== "object") return false;
  const record = payload as { queries?: Array<{ queryKey?: unknown; data?: unknown }> };
  const queries = Array.isArray(record.queries) ? record.queries : [];
  let definitions: Record<string, LlmVariableDef> = {};
  const sectionArrays: unknown[][] = [];
  for (const query of queries) {
    const key = Array.isArray(query.queryKey) ? query.queryKey[0] : undefined;
    if (key === "/api/variables" && query.data && typeof query.data === "object") {
      definitions = query.data as Record<string, LlmVariableDef>;
    }
    collectSectionArrays(query.data, sectionArrays);
  }
  return sectionArrays.some((sections) => sectionsBranchForLlm(sections, definitions, locale, catalog));
}
