/**
 * Platform `seo.*` fields: nested locale YAML (source of truth), surgical writes,
 * save validation. Cluster reads go through seo-index.json.
 */

import yaml from "js-yaml";
import {
  KNOWN_SEO_FIELDS,
  LEGACY_MAIN_SEO_KEYWORD_KEY,
  LEGACY_SEO_PILLAR_KEY,
  SEO_RESEARCH_METRIC_FIELDS,
  SEO_RESEARCH_WRITE_FIELDS,
  SEO_YAML_KEY,
  isKnownSeoFieldPath,
  seoFieldFromPath,
  type KnownSeoField,
  type SeoResearchMetricField,
} from "./content-types";
import type { ContentIndex } from "./content-index";
import { contentIndex } from "./content-index";
import { createPublicUrlResolver, toPublicUrlPath } from "./redirects";

export {
  KNOWN_SEO_FIELDS,
  SEO_YAML_KEY,
  isKnownSeoFieldPath,
  seoFieldFromPath,
};
export type { KnownSeoField };

const MAX_REDIRECT_HOPS = 12;

export type SeoIndexWarning = {
  code: string;
  entry?: string;
  pillar_path?: string;
  message?: string;
};

export type SeoBlock = {
  main_keyword?: string | null;
  /** Monthly search volume estimate for main_keyword (not GSC clicks). */
  kw_monthly_volume?: number | null;
  /** Keyword difficulty 0–100 for main_keyword. */
  kw_difficulty?: number | null;
  pillar_path?: string | null;
  is_pillar?: boolean;
  intent?: string;
  focus_features?: string[];
  pillar?: string;
  [key: string]: unknown;
};

const RESEARCH_METRIC_SET = new Set<string>(SEO_RESEARCH_METRIC_FIELDS);
const RESEARCH_WRITE_SET = new Set<string>(SEO_RESEARCH_WRITE_FIELDS);

function isResearchMetricField(field: string): field is SeoResearchMetricField {
  return RESEARCH_METRIC_SET.has(field);
}

/** Parse a research metric; empty/null → null. Non-integer or NaN → invalid sentinel. */
export function parseSeoResearchMetric(
  value: unknown,
): { ok: true; value: number | null } | { ok: false } {
  if (value === null || value === undefined || value === "") {
    return { ok: true, value: null };
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value) || !Number.isInteger(value)) return { ok: false };
    return { ok: true, value };
  }
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) return { ok: true, value: null };
    if (!/^-?\d+$/.test(trimmed)) return { ok: false };
    const n = Number(trimmed);
    if (!Number.isInteger(n)) return { ok: false };
    return { ok: true, value: n };
  }
  return { ok: false };
}

export function coerceSeoResearchMetrics(seo: SeoBlock): SeoSaveError | null {
  for (const field of SEO_RESEARCH_METRIC_FIELDS) {
    if (!(field in seo) || seo[field] === undefined) continue;
    const parsed = parseSeoResearchMetric(seo[field]);
    if (!parsed.ok) {
      return {
        ok: false,
        error: `seo.${field} must be an integer or null.`,
        code: `seo_${field}_invalid`,
      };
    }
    seo[field] = parsed.value;
    if (parsed.value === null) continue;
    if (field === "kw_monthly_volume" && parsed.value < 0) {
      return {
        ok: false,
        error: "seo.kw_monthly_volume must be >= 0.",
        code: "seo_kw_monthly_volume_range",
      };
    }
    if (field === "kw_difficulty" && (parsed.value < 0 || parsed.value > 100)) {
      return {
        ok: false,
        error: "seo.kw_difficulty must be an integer from 0 to 100.",
        code: "seo_kw_difficulty_range",
      };
    }
  }
  return null;
}

/**
 * If a write touches any research key (main_keyword / metrics), omitted metrics
 * are forced to null so stale estimates cannot survive a partial save.
 */
export function applyResearchClearRule(
  next: SeoBlock,
  updates: Record<string, unknown>,
): SeoBlock {
  const touched = Object.keys(updates).some((rawKey) => {
    const field = isKnownSeoFieldPath(rawKey) ? seoFieldFromPath(rawKey) : (rawKey as KnownSeoField);
    return field != null && RESEARCH_WRITE_SET.has(field);
  });
  if (!touched) return next;
  const present = new Set<string>();
  for (const rawKey of Object.keys(updates)) {
    const field = isKnownSeoFieldPath(rawKey) ? seoFieldFromPath(rawKey) : (rawKey as KnownSeoField);
    if (field) present.add(field);
  }
  const out = { ...next };
  for (const metric of SEO_RESEARCH_METRIC_FIELDS) {
    if (!present.has(metric)) out[metric] = null;
  }
  return out;
}

export type SeoSaveError = {
  ok: false;
  error: string;
  code: string;
};

export type SeoSaveOk = {
  ok: true;
  coerced: SeoBlock;
  warnings: SeoIndexWarning[];
  pillarLive: boolean | null;
};

function yamlScalar(value: string): string {
  if (value === "") return '""';
  if (
    /[:#{}[\],&*!|>'"%@`]/.test(value) ||
    value !== value.trim() ||
    /[\n\r]/.test(value) ||
    /^(true|false|null|~|\d+)$/i.test(value)
  ) {
    return JSON.stringify(value);
  }
  return value;
}

/** Extent of a top-level YAML mapping key (including nested indented lines). */
export function findTopLevelKeySpan(
  content: string,
  key: string,
): { start: number; end: number } | null {
  const re = new RegExp(`^${key}:\\s*.*$`, "m");
  const m = content.match(re);
  if (!m || m.index === undefined) return null;
  const start = m.index;
  const afterHeader = start + m[0].length;
  let end = afterHeader;
  const rest = content.slice(afterHeader);
  if (rest.startsWith("\n")) {
    const lines = rest.split("\n");
    let consumed = 0;
    for (let i = 1; i < lines.length; i++) {
      const line = lines[i];
      if (line === "" || line.startsWith(" ") || line.startsWith("\t") || line.startsWith("#")) {
        consumed += 1 + line.length;
        continue;
      }
      break;
    }
    end = afterHeader + consumed;
  }
  return { start, end };
}

export function readSeoBlockFromYamlText(content: string): SeoBlock {
  const span = findTopLevelKeySpan(content, SEO_YAML_KEY);
  if (!span) return {};
  const chunk = content.slice(span.start, span.end);
  try {
    const parsed = yaml.load(chunk) as { seo?: SeoBlock } | null;
    const seo = parsed?.seo;
    if (!seo || typeof seo !== "object" || Array.isArray(seo)) return {};
    return { ...seo };
  } catch {
    return {};
  }
}

export function yamlHasSeoKey(content: string): boolean {
  return /^seo:\s*/m.test(content);
}

function dumpSeoBlock(seo: SeoBlock): string {
  const cleaned: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(seo)) {
    if (v === undefined) continue;
    cleaned[k] = v;
  }
  if (Object.keys(cleaned).length === 0) return "";
  return yaml
    .dump(
      { [SEO_YAML_KEY]: cleaned },
      { lineWidth: -1, noRefs: true, quotingType: '"', forceQuotes: false },
    )
    .trimEnd();
}

/** Replace or insert the top-level `seo:` block without dumping the rest of the file. */
export function surgicalReplaceSeoBlock(content: string, seo: SeoBlock): string {
  const dumped = dumpSeoBlock(seo);
  const span = findTopLevelKeySpan(content, SEO_YAML_KEY);
  if (!dumped) {
    if (!span) return content;
    const before = content.slice(0, span.start);
    const after = content.slice(span.end).replace(/^\n/, "");
    return (before + after).replace(/\n{3,}/g, "\n\n");
  }
  if (!span) {
    const trimmed = content.endsWith("\n") ? content : `${content}\n`;
    return `${trimmed}${dumped}\n`;
  }
  const before = content.slice(0, span.start);
  let after = content.slice(span.end);
  if (after.startsWith("\n")) after = after.slice(1);
  const mid = dumped.endsWith("\n") ? dumped : `${dumped}\n`;
  return `${before}${mid}${after}`;
}

export function surgicalRemoveTopLevelKey(content: string, key: string): string {
  const span = findTopLevelKeySpan(content, key);
  if (!span) return content;
  const before = content.slice(0, span.start);
  let after = content.slice(span.end);
  if (after.startsWith("\n")) after = after.slice(1);
  return (before + after).replace(/\n{3,}/g, "\n\n");
}

export function readTopLevelScalar(content: string, key: string): string | null {
  const re = new RegExp(`^${key}:\\s*(.*)$`, "m");
  const m = content.match(re);
  if (!m) return null;
  let raw = m[1].trim();
  if (raw === "" || raw === "|" || raw === ">" || raw === "|-" || raw === ">-") return "";
  if (
    (raw.startsWith('"') && raw.endsWith('"')) ||
    (raw.startsWith("'") && raw.endsWith("'"))
  ) {
    raw = raw.slice(1, -1);
  }
  if (raw === "null" || raw === "~") return "";
  return raw;
}

export function isPillarPathExplicitlyNull(seo: SeoBlock): boolean {
  return seo.pillar_path === null;
}

export function normalizeSeoBlock(raw: SeoBlock): SeoBlock {
  const out: SeoBlock = { ...raw };
  if (typeof out.main_keyword === "string") {
    out.main_keyword = out.main_keyword.trim() || null;
  }
  for (const field of SEO_RESEARCH_METRIC_FIELDS) {
    if (!(field in out) || out[field] === undefined) continue;
    const parsed = parseSeoResearchMetric(out[field]);
    out[field] = parsed.ok ? parsed.value : out[field];
  }
  if (out.pillar_path === null) {
    delete out[LEGACY_SEO_PILLAR_KEY];
    const isPillarRaw = out.is_pillar as unknown;
    if (isPillarRaw === true || isPillarRaw === "true") out.is_pillar = true;
    else if (isPillarRaw === false || isPillarRaw === "false") out.is_pillar = false;
    return out;
  }
  const pillarPath =
    (typeof out.pillar_path === "string" && out.pillar_path) ||
    (typeof out[LEGACY_SEO_PILLAR_KEY] === "string" && out[LEGACY_SEO_PILLAR_KEY]) ||
    "";
  if (pillarPath) out.pillar_path = toPublicUrlPath(String(pillarPath));
  else out.pillar_path = out.pillar_path === "" ? "" : out.pillar_path ?? null;
  delete out[LEGACY_SEO_PILLAR_KEY];
  const isPillarRaw = out.is_pillar as unknown;
  if (isPillarRaw === true || isPillarRaw === "true") out.is_pillar = true;
  else if (isPillarRaw === false || isPillarRaw === "false") out.is_pillar = false;
  return out;
}

function pathLocalePrefix(urlPath: string): string | null {
  const m = toPublicUrlPath(urlPath).match(/^\/([a-z]{2})(?:\/|$)/i);
  return m ? m[1].toLowerCase() : null;
}

export function canonicalizePillarPath(
  raw: string,
  locale: string,
  ci: ContentIndex,
): { path: string; live: boolean } {
  let current = toPublicUrlPath(raw);
  const resolver = createPublicUrlResolver(ci, { freshRedirects: true });
  const seen = new Set<string>();
  for (let i = 0; i < MAX_REDIRECT_HOPS; i++) {
    if (seen.has(current)) break;
    seen.add(current);
    const result = resolver.test(current, locale);
    if (result.match && result.resolvedTo) {
      if (/^https?:\/\//i.test(result.resolvedTo)) {
        return { path: current, live: false };
      }
      const next = toPublicUrlPath(result.resolvedTo);
      if (next === current) break;
      // Never rewrite pillar_path to a non-existent URL. Soft-match can invent
      // truncated paths (e.g. blog `/en/blog/:category/:slug` with :category
      // unresolved) that must not overwrite a live submitted path.
      if (result.destinationExists === false) {
        break;
      }
      current = next;
      continue;
    }
    break;
  }
  return { path: current, live: resolver.isLive(current, locale) };
}

export function entryCanonicalPath(
  contentType: string,
  slug: string,
  locale: string,
  ci: ContentIndex,
): string | null {
  const urls = ci.getAlternateUrls(slug, contentType);
  const url = urls[locale] || urls.en || Object.values(urls)[0];
  return url ? toPublicUrlPath(url) : null;
}

export function validateSeoSave(opts: {
  next: SeoBlock;
  locale: string;
  contentType: string;
  slug: string;
  ci?: ContentIndex;
  commonYaml?: string | null;
}): SeoSaveOk | SeoSaveError {
  const ci = opts.ci ?? contentIndex;
  if (opts.commonYaml && yamlHasSeoKey(opts.commonYaml)) {
    return {
      ok: false,
      error: "seo.* must live on the locale YAML file, not _common.yml. Remove seo: from _common.yml.",
      code: "seo_on_common",
    };
  }

  const coerced = normalizeSeoBlock(opts.next);
  const metricErr = coerceSeoResearchMetrics(coerced);
  if (metricErr) return metricErr;
  const warnings: SeoIndexWarning[] = [];
  let pillarLive: boolean | null = null;

  if (coerced.is_pillar === true) {
    const selfPath = entryCanonicalPath(opts.contentType, opts.slug, opts.locale, ci);
    if (!selfPath) {
      return {
        ok: false,
        error: "Cannot mark as pillar: this entry has no canonical public path.",
        code: "seo_no_canonical_path",
      };
    }
    if (coerced.pillar_path && coerced.pillar_path !== selfPath) {
      return {
        ok: false,
        error: `seo.is_pillar requires seo.pillar_path to be this page's URL (${selfPath}).`,
        code: "seo_hub_path_mismatch",
      };
    }
    coerced.pillar_path = selfPath;
  }

  const pillarPath = typeof coerced.pillar_path === "string" ? coerced.pillar_path.trim() : "";
  if (coerced.pillar_path === null) {
    coerced.pillar_path = null;
  } else if (pillarPath) {
    const prefix = pathLocalePrefix(pillarPath);
    if (prefix && prefix !== opts.locale.toLowerCase()) {
      return {
        ok: false,
        error: `seo.pillar_path locale prefix /${prefix}/ does not match this file's locale (${opts.locale}).`,
        code: "seo_locale_mismatch",
      };
    }
    const canon = canonicalizePillarPath(pillarPath, opts.locale, ci);
    coerced.pillar_path = canon.path;
    pillarLive = canon.live;
    if (!canon.live) {
      warnings.push({
        code: "pillar_not_live",
        entry: `${opts.contentType}/${opts.slug}/${opts.locale}`,
        pillar_path: canon.path,
      });
    }
  } else {
    coerced.pillar_path = pillarPath === "" ? "" : coerced.pillar_path ?? null;
  }

  return { ok: true, coerced, warnings, pillarLive };
}

export function mergeSeoUpdates(current: SeoBlock, updates: Record<string, unknown>): SeoBlock {
  const next = { ...current };
  for (const [rawKey, value] of Object.entries(updates)) {
    const field = isKnownSeoFieldPath(rawKey) ? seoFieldFromPath(rawKey) : (rawKey as KnownSeoField);
    if (!field || !(KNOWN_SEO_FIELDS as readonly string[]).includes(field)) continue;
    if (value === undefined) continue;
    if (field === "is_pillar") {
      next.is_pillar = value === true || value === "true";
      continue;
    }
    if (isResearchMetricField(field)) {
      if (value === null || value === "") {
        next[field] = null;
        continue;
      }
      const parsed = parseSeoResearchMetric(value);
      // Keep raw on parse failure so validateSeoSave can reject with a clear code.
      next[field] = parsed.ok ? parsed.value : value;
      continue;
    }
    if (value === null) {
      if (field === "pillar_path") next.pillar_path = null;
      else next[field] = null;
      continue;
    }
    if (value === "") {
      next[field] = field === "pillar_path" ? "" : null;
      continue;
    }
    next[field] = String(value);
  }
  return applyResearchClearRule(next, updates);
}

export function extractSeoUpdatesFromOps(
  operations: Array<{ action?: string; path?: string; value?: unknown }>,
): { seoUpdates: Record<string, unknown>; rest: typeof operations; commonSeo: boolean } {
  const seoUpdates: Record<string, unknown> = {};
  const rest: typeof operations = [];
  let commonSeo = false;
  for (const op of operations) {
    if (op.action !== "update_field" || typeof op.path !== "string") {
      rest.push(op);
      continue;
    }
    if (isKnownSeoFieldPath(op.path) || op.path === `${SEO_YAML_KEY}.${LEGACY_SEO_PILLAR_KEY}`) {
      const field =
        op.path === `${SEO_YAML_KEY}.${LEGACY_SEO_PILLAR_KEY}` ? "pillar_path" : seoFieldFromPath(op.path);
      if (field) seoUpdates[field] = op.value;
      continue;
    }
    if (op.path === SEO_YAML_KEY || op.path.startsWith(`${SEO_YAML_KEY}.`)) {
      commonSeo = true;
      continue;
    }
    rest.push(op);
  }
  return { seoUpdates, rest, commonSeo };
}

export function migrateMainKeywordInYamlText(content: string): { text: string; moved: boolean } {
  const existing = readSeoBlockFromYamlText(content);
  const top = readTopLevelScalar(content, LEGACY_MAIN_SEO_KEYWORD_KEY);
  let next = content;
  let moved = false;
  if (top != null && top.trim() && !existing.main_keyword) {
    existing.main_keyword = top.trim();
    moved = true;
  }
  if (typeof existing.pillar === "string" && existing.pillar && !existing.pillar_path) {
    existing.pillar_path = existing.pillar;
    moved = true;
  }
  if (existing.pillar !== undefined) {
    delete existing.pillar;
    moved = true;
  }
  if (moved) next = surgicalReplaceSeoBlock(next, existing);
  if (readTopLevelScalar(next, LEGACY_MAIN_SEO_KEYWORD_KEY) != null) {
    next = surgicalRemoveTopLevelKey(next, LEGACY_MAIN_SEO_KEYWORD_KEY);
    moved = true;
  }
  return { text: next, moved };
}

export { yamlScalar };
