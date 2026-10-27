/**
 * Multi-bag template resolution for public content delivery.
 * Order: {{ single.* }} → {{ meta.* }} → {{ seo.* }} → {{ param.* }} → {{ funnel.* }} → optional site vars (brand.* / global.* / reserved.*).
 *
 * Site vars default to skipped (`skipSiteVars: true`) so React `SectionRenderer`
 * can resolve them (and preserve `{{ }}` in edit mode). Pass `skipSiteVars: false`
 * for non-React consumers (menus API, schema.org, SEO tools, entry preview).
 */

import { resolveSingleVars } from "./single-resolver";
import {
  getVariableManager,
  type VariableContext,
} from "./variable-manager";
import { getDefaultContentRoot } from "./site-config";
import {
  finalizeSingleEntryForTemplates,
  getContentTypeConfig,
  getFieldMappingDefaults,
  getFullFieldMapping,
  extractUrlPatternParams,
} from "./content-types";
import { parsePipeFallback } from "@shared/json-field";
import { funnelProductsQueryValue } from "@shared/tracking-context";
import { normalizeFunnelBlock } from "@shared/funnel";

function getNestedValue(obj: Record<string, unknown>, dotPath: string): unknown {
  const parts = dotPath.split(".");
  let current: unknown = obj;
  for (const part of parts) {
    if (current === null || current === undefined) return undefined;
    if (typeof current !== "object") return undefined;
    current = (current as Record<string, unknown>)[part];
  }
  return current;
}

/**
 * Resolve {{ <prefix>.field }} tokens against a bag (same semantics as resolveSingleVars).
 */
export function resolveBagVars(
  data: unknown,
  prefix: string,
  bag: Record<string, unknown>,
): unknown {
  const escaped = prefix.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const pattern = new RegExp(
    `\\{\\{\\s*${escaped}\\.([a-zA-Z_][a-zA-Z0-9_.]*)\\s*(?:\\|\\s*([\\s\\S]*?))?\\s*\\}\\}`,
    "g",
  );
  const exactPattern = new RegExp(
    `^\\{\\{\\s*${escaped}\\.([a-zA-Z_][a-zA-Z0-9_.]*)\\s*(?:\\|\\s*([\\s\\S]*?))?\\s*\\}\\}$`,
  );

  function resolveString(str: string): unknown {
    const exactMatch = str.match(exactPattern);
    if (exactMatch) {
      const fieldPath = exactMatch[1];
      const hasFallback = exactMatch[2] !== undefined;
      const fallback = exactMatch[2]?.trim();
      const value = getNestedValue(bag, fieldPath);
      if (value !== undefined && value !== null) return value;
      if (hasFallback) return parsePipeFallback(fallback ?? "");
      return str;
    }

    if (!pattern.test(str)) return str;
    pattern.lastIndex = 0;

    return str.replace(pattern, (_match, fieldPath: string, fallback?: string) => {
      const value = getNestedValue(bag, fieldPath);
      if (value !== undefined && value !== null) {
        if (typeof value === "object") return JSON.stringify(value);
        return String(value);
      }
      if (fallback !== undefined) return fallback.trim();
      return _match;
    });
  }

  function walk(value: unknown): unknown {
    if (typeof value === "string") return resolveString(value);
    if (Array.isArray(value)) return value.map(walk);
    if (value !== null && typeof value === "object") {
      const result: Record<string, unknown> = {};
      for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
        // Preserve runtime metadata (_variableFields) and listing item_template
        // ({{ single.* }} there means each list row, not the page entry).
        if (key.startsWith("_") || key === "item_template") {
          result[key] = val;
          continue;
        }
        result[key] = walk(val);
      }
      return result;
    }
    return value;
  }

  return walk(data);
}

/** Query keys used by the content API itself — not exposed as {{ param.* }}. */
const INTERNAL_QUERY_KEYS = new Set([
  "force_variant",
  "raw",
  "cache",
]);

/**
 * Unified request param bag: querystring first, then URL path params (path wins on conflict).
 */
export function buildParamBag(
  pathParams?: Record<string, string | undefined> | null,
  query?: Record<string, unknown> | null,
  opts?: { excludeQueryKeys?: Iterable<string> },
): Record<string, unknown> {
  const bag: Record<string, unknown> = {};
  const exclude = new Set([
    ...INTERNAL_QUERY_KEYS,
    ...(opts?.excludeQueryKeys ? Array.from(opts.excludeQueryKeys) : []),
  ]);

  if (query) {
    for (const [key, raw] of Object.entries(query)) {
      if (exclude.has(key)) continue;
      if (raw === undefined) continue;
      bag[key] = Array.isArray(raw) ? raw[0] : raw;
    }
  }

  if (pathParams) {
    for (const [key, value] of Object.entries(pathParams)) {
      if (value !== undefined && value !== null && value !== "") {
        bag[key] = value;
      }
    }
  }

  return bag;
}

/**
 * Build {{ param.* }} for a content delivery request:
 * path params from url_pattern (+ slug/locale) win over querystring.
 */
export function buildContentDeliveryParamBag(opts: {
  contentType: string;
  slug: string;
  locale: string;
  record?: Record<string, unknown> | null;
  query?: Record<string, unknown> | null;
  contentRoot?: string;
}): Record<string, unknown> {
  const pathParams: Record<string, string> = {
    slug: opts.slug,
    locale: opts.locale,
  };

  const config = getContentTypeConfig(opts.contentType, opts.contentRoot);
  const pattern =
    config?.url_pattern?.[opts.locale] || config?.url_pattern?.["default"];
  if (pattern && opts.record) {
    const mapping = getFullFieldMapping(opts.contentType, opts.contentRoot);
    const defaults = getFieldMappingDefaults(opts.contentType, opts.contentRoot);
    const extracted = extractUrlPatternParams(pattern, opts.record, mapping, defaults);
    Object.assign(pathParams, extracted.params);
  }

  return buildParamBag(pathParams, opts.query);
}

export interface ResolveAllTemplateVarsOptions {
  singleEntry?: Record<string, unknown>;
  /** Raw page meta (may still contain {{ single.* }}). Prefer omitting when `data` is page-shaped and already includes meta. */
  meta?: Record<string, unknown>;
  /** Nested locale `seo:` block for {{ seo.* }} templates. */
  seo?: Record<string, unknown>;
  /** Unified URL path + querystring params (path wins). */
  param?: Record<string, unknown>;
  /** Merged page funnel; defaults to `data.funnel`. */
  funnel?: unknown;
  /** Route identity for program self-include. Omit when unknown. Slug comes from singleEntry. */
  contentType?: string;
  contentRoot?: string;
  context?: VariableContext;
  /**
   * When true (default), skip VariableManager site-var pass (brand/global/reserved)
   * so page React render / edit mode can resolve or preserve them.
   * Pass false for non-React consumers that need fully baked strings.
   */
  skipSiteVars?: boolean;
}

/**
 * Resolve template namespaces for public delivery.
 * Editors keep unresolved templates on write paths — call this only at delivery boundaries.
 * Site vars are skipped by default; see `skipSiteVars`.
 */
type NamespaceStep =
  | { kind: "single"; bag: Record<string, unknown> }
  | { kind: "bag"; prefix: "meta" | "seo" | "param" | "funnel"; bag: Record<string, unknown> };

function mentionsNamespace(str: string, step: NamespaceStep): boolean {
  if (step.kind === "single") {
    return (
      str.includes("{{ single") ||
      str.includes("{{single") ||
      str.includes("{{ entry") ||
      str.includes("{{entry")
    );
  }
  return str.includes(`{{ ${step.prefix}`) || str.includes(`{{${step.prefix}`);
}

function applyNamespace(value: string, step: NamespaceStep): unknown {
  if (step.kind === "single") return resolveSingleVars(value, step.bag);
  return resolveBagVars(value, step.prefix, step.bag);
}

/**
 * One tree walk. Namespaces run in order on each string. A replacement that
 * inserts a later placeholder is filled before the walk moves on. Bags are
 * prepared first so {{ meta.x }} can expand a value that was itself {{ single.* }}.
 */
function walkNamespaces(value: unknown, steps: NamespaceStep[], fromIndex: number): unknown {
  if (typeof value === "string") {
    if (!value.includes("{{")) return value;
    let current: unknown = value;
    for (let i = fromIndex; i < steps.length; i++) {
      if (typeof current !== "string") return walkNamespaces(current, steps, i);
      if (!current.includes("{{")) return current;
      const step = steps[i];
      if (!mentionsNamespace(current, step)) continue;
      const next = applyNamespace(current, step);
      if (next === current) continue;
      if (typeof next !== "string") return walkNamespaces(next, steps, i + 1);
      current = next;
    }
    return current;
  }

  if (Array.isArray(value)) {
    return value.map((item) => walkNamespaces(item, steps, fromIndex));
  }

  if (value !== null && typeof value === "object") {
    const result: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
      if (key.startsWith("_") || key === "item_template") {
        result[key] = val;
        continue;
      }
      result[key] = walkNamespaces(val, steps, fromIndex);
    }
    return result;
  }

  return value;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  if (value !== null && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return undefined;
}

export function resolveAllTemplateVars(
  data: unknown,
  opts: ResolveAllTemplateVarsOptions = {},
): unknown {
  const singleEntry = finalizeSingleEntryForTemplates(opts.singleEntry, {
    slug: typeof opts.singleEntry?.slug === "string" ? opts.singleEntry.slug : undefined,
    locale: opts.context?.locale,
  });
  const hasSingle = !!singleEntry && Object.keys(singleEntry).length > 0;
  const singleStep: NamespaceStep[] = hasSingle ? [{ kind: "single", bag: singleEntry }] : [];

  const page = asRecord(data);
  const metaSource = opts.meta ?? (page ? asRecord(page.meta) : undefined);
  const metaBag = metaSource
    ? asRecord(walkNamespaces(metaSource, singleStep, 0))
    : undefined;

  const steps: NamespaceStep[] = [...singleStep];
  if (metaBag && Object.keys(metaBag).length > 0) {
    steps.push({ kind: "bag", prefix: "meta", bag: metaBag });
  }

  let seoBag: Record<string, unknown> | undefined;
  if (opts.seo) {
    seoBag = opts.seo;
  } else if (page) {
    const seoSource = asRecord(page.seo);
    if (seoSource) seoBag = asRecord(walkNamespaces(seoSource, steps, 0));
  }
  if (seoBag && Object.keys(seoBag).length > 0) {
    steps.push({ kind: "bag", prefix: "seo", bag: seoBag });
  }

  if (opts.param && Object.keys(opts.param).length > 0) {
    steps.push({ kind: "bag", prefix: "param", bag: opts.param });
  }

  const funnelRaw = opts.funnel !== undefined ? opts.funnel : page?.funnel;
  const funnelSlug =
    typeof singleEntry?.slug === "string"
      ? singleEntry.slug
      : typeof singleEntry?._slug === "string"
        ? singleEntry._slug
        : undefined;
  steps.push({
    kind: "bag",
    prefix: "funnel",
    bag: {
      products: funnelProductsQueryValue(
        normalizeFunnelBlock(funnelRaw),
        typeof opts.contentType === "string" ? opts.contentType : undefined,
        funnelSlug,
      ),
    },
  });

  let result = steps.length > 0 ? walkNamespaces(data, steps, 0) : data;

  const skipSiteVars = opts.skipSiteVars ?? true;
  if (!skipSiteVars) {
    const root = opts.contentRoot ?? getDefaultContentRoot();
    const { data: siteResolved } = getVariableManager(root).resolveDeep(
      result,
      opts.context ?? {},
    );
    result = siteResolved;
  }

  return result;
}
