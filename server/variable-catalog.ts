import {
  FACT_CATEGORIES,
  FIGURE_CATEGORIES,
  effectiveVariableMetadata,
  missingVariableMetadata,
} from "@shared/variable-metadata";
import type { VariableCondition, VariableContext, VariableDefinition } from "./variable-manager";
import { audienceValuesFor, type PageAudience } from "./page-audience";

export type VariesBy = "region" | "location" | "locale";

export interface CatalogFilters {
  category?: string[];
  figures_only?: boolean;
  facts_only?: boolean;
  query?: string;
  include_deprecated?: boolean;
}

export interface CatalogRow {
  name: string;
  description: string | null;
  category: string | null;
  unit: string | null;
  source: string | null;
  products: string[];
  default: string | null;
  varies_by: VariesBy[];
  read_only: boolean;
  deprecated: boolean;
  missing_description: boolean;
}

export interface CatalogPayload {
  rows: CatalogRow[];
  total: number;
  counts_by_category: Record<string, number>;
  missing_description_count: number;
  deprecated_hidden: number;
}

export function variesBy(def: VariableDefinition): VariesBy[] {
  const out = new Set<VariesBy>();
  for (const c of def.conditions ?? []) {
    for (const key of Object.keys(c.query ?? {})) {
      if (key === "region" || key === "location" || key === "locale") out.add(key);
    }
  }
  if (def.by_region && Object.keys(def.by_region).length) out.add("region");
  if (def.by_location && Object.keys(def.by_location).length) out.add("location");
  if (def.by_locale && Object.keys(def.by_locale).length) out.add("locale");
  return (["region", "location", "locale"] as const).filter((k) => out.has(k));
}

/** Names agents should see: `global.*` (incl. reserved aliases) and `brand.*`; `reserved.*` duplicates are hidden. */
export function isCatalogName(name: string): boolean {
  return name.startsWith("global.") || name.startsWith("brand.");
}

function toRow(name: string, def: VariableDefinition): CatalogRow {
  const meta = effectiveVariableMetadata(name, def);
  const missing = missingVariableMetadata(name, def);
  return {
    name,
    description: meta.description ?? null,
    category: meta.category ?? null,
    unit: meta.unit ?? null,
    source: meta.source ?? null,
    products: meta.products ?? [],
    default: def.default ?? null,
    varies_by: variesBy(def),
    read_only: meta.system_managed,
    deprecated: meta.deprecated === true,
    missing_description: missing.description || missing.category,
  };
}

export function buildVariableCatalog(
  defs: Record<string, VariableDefinition>,
  filters: CatalogFilters = {},
): CatalogPayload {
  const q = filters.query?.trim().toLowerCase() ?? "";
  const cats = new Set<string>(filters.category ?? []);
  if (filters.figures_only) for (const c of FIGURE_CATEGORIES) cats.add(c);
  if (filters.facts_only) for (const c of FACT_CATEGORIES) cats.add(c);

  const all = Object.entries(defs)
    .filter(([name]) => isCatalogName(name))
    .map(([name, def]) => toRow(name, def))
    .sort((a, b) => a.name.localeCompare(b.name));

  const counts: Record<string, number> = {};
  let missingCount = 0;
  for (const row of all) {
    if (row.deprecated) continue;
    counts[row.category ?? "uncategorized"] = (counts[row.category ?? "uncategorized"] ?? 0) + 1;
    if (row.missing_description) missingCount++;
  }

  let deprecatedHidden = 0;
  const rows = all.filter((row) => {
    if (cats.size > 0 && !(row.category && cats.has(row.category))) return false;
    if (q && !row.name.toLowerCase().includes(q) && !(row.description ?? "").toLowerCase().includes(q)) {
      return false;
    }
    if (row.deprecated && !filters.include_deprecated) {
      deprecatedHidden++;
      return false;
    }
    return true;
  });

  return {
    rows,
    total: rows.length,
    counts_by_category: counts,
    missing_description_count: missingCount,
    deprecated_hidden: deprecatedHidden,
  };
}

function levenshtein(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  if (!m) return n;
  if (!n) return m;
  let prev = Array.from({ length: n + 1 }, (_, j) => j);
  for (let i = 1; i <= m; i++) {
    const cur = [i];
    for (let j = 1; j <= n; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    prev = cur;
  }
  return prev[n];
}

/** Close matches for an unknown name: substring hits first, then small edit distance. */
export function closeVariableNames(name: string, known: string[], limit = 3): string[] {
  const bare = (s: string) => s.replace(/^(global|brand|reserved)\./, "").toLowerCase();
  const target = bare(name);
  const scored = known
    .map((k) => {
      const b = bare(k);
      const sub = b.includes(target) || target.includes(b);
      return { k, score: sub ? 0 : levenshtein(target, b) };
    })
    .filter(({ score, k }) => score <= Math.max(2, Math.floor(bare(k).length / 3)))
    .sort((x, y) => x.score - y.score || x.k.localeCompare(y.k));
  return scored.slice(0, limit).map((s) => s.k);
}

/** Accept `x`, `global.x` or any full name. */
export function normalizeVariableName(raw: string, defs: Record<string, VariableDefinition>): string {
  const t = raw.trim().replace(/^\{\{\s*/, "").replace(/\s*(\|[^}]*)?\}\}$/, "").trim();
  if (defs[t]) return t;
  if (!t.includes(".") && defs[`global.${t}`]) return `global.${t}`;
  return t;
}

export interface SiteContextValues {
  regions: string[];
  locations: string[];
  locales: string[];
}

export interface DetailContext {
  region?: string;
  location?: string;
  locale?: string;
}

export function unknownContextValues(ctx: DetailContext, site: SiteContextValues): string[] {
  const bad: string[] = [];
  if (ctx.region && !site.regions.includes(ctx.region)) bad.push(`region:${ctx.region}`);
  if (ctx.location && !site.locations.includes(ctx.location)) bad.push(`location:${ctx.location}`);
  if (ctx.locale && !site.locales.includes(ctx.locale)) bad.push(`locale:${ctx.locale}`);
  return bad;
}

export interface DetailItem {
  name: string;
  description: string | null;
  category: string | null;
  unit: string | null;
  source: string | null;
  products: string[];
  read_only: boolean;
  deprecated: boolean;
  replaced_by: string | null;
  missing_description: boolean;
  default: string | null;
  conditions: VariableCondition[];
  by_region?: Record<string, string>;
  by_location?: Record<string, string>;
  by_locale?: Record<string, string>;
  varies_by: VariesBy[];
  token: string;
  usage_count: number;
  resolved?: { value: string; source: string } | null;
  audience_values?: { value: string; applies_to: string[] }[];
  literal_ok?: string | null;
}

export function pasteToken(name: string, def: VariableDefinition): string {
  const fallback = (def.default ?? "").replace(/[{}|]/g, "").trim();
  return fallback ? `{{ ${name} | ${fallback} }}` : `{{ ${name} }}`;
}

export function buildVariableDetail(opts: {
  defs: Record<string, VariableDefinition>;
  names: string[];
  usageCounts: Record<string, number>;
  resolve: (name: string, ctx: VariableContext) => { value: string; source: string } | null;
  context?: DetailContext;
  audience?: { audience: PageAudience; locale: string; locationRegions: Map<string, string> };
}): {
  variables: DetailItem[];
  unknown_names: { name: string; close_matches: string[] }[];
  deprecated: { name: string; replaced_by: string | null }[];
} {
  const { defs } = opts;
  const known = Object.keys(defs).filter(isCatalogName);
  const variables: DetailItem[] = [];
  const unknown: { name: string; close_matches: string[] }[] = [];
  const deprecated: { name: string; replaced_by: string | null }[] = [];
  const seen = new Set<string>();

  for (const raw of opts.names) {
    const name = normalizeVariableName(raw, defs);
    if (seen.has(name)) continue;
    seen.add(name);
    const def = defs[name];
    if (!def) {
      unknown.push({ name: raw, close_matches: closeVariableNames(name, known) });
      continue;
    }
    const row = toRow(name, def);
    const meta = effectiveVariableMetadata(name, def);
    const usage = opts.usageCounts[name] ?? 0;
    const item: DetailItem = {
      name,
      description: row.description,
      category: row.category,
      unit: row.unit,
      source: row.source,
      products: row.products,
      read_only: row.read_only,
      deprecated: row.deprecated,
      replaced_by: meta.replaced_by ?? null,
      missing_description: row.missing_description,
      default: def.default ?? null,
      conditions: def.conditions ?? [],
      ...(def.by_region ? { by_region: def.by_region } : {}),
      ...(def.by_location ? { by_location: def.by_location } : {}),
      ...(def.by_locale ? { by_locale: def.by_locale } : {}),
      varies_by: row.varies_by,
      token: pasteToken(name, def),
      usage_count: usage,
    };
    if (opts.context && (opts.context.region || opts.context.location || opts.context.locale)) {
      item.resolved = opts.resolve(name, opts.context);
    }
    if (opts.audience) {
      const av = audienceValuesFor(
        name,
        opts.resolve,
        opts.audience.audience,
        opts.audience.locale,
        opts.audience.locationRegions,
      );
      item.audience_values = av.values;
      item.literal_ok = av.literal_ok;
    }
    if (row.deprecated) deprecated.push({ name, replaced_by: item.replaced_by });
    variables.push(item);
  }

  return { variables, unknown_names: unknown, deprecated };
}
