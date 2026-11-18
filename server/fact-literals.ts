/**
 * Exact-match site-fact literals in page copy (currency / phone / percent).
 * Shared by the admin report, fact-literals validator, and sync write warnings.
 */

import {
  isMoneyValue,
  variableValueToDisplayString,
  type VariableValue,
} from "@shared/variable-money";
import type { VariableDefinition } from "./variable-manager";

export type LiteralKind = "currency" | "phone" | "percent";
export type LiteralHitStatus = "token_recommended" | "wrong_for_audience" | "varies";

export type LiteralIndexEntry = { literal: string; kind: LiteralKind; names: Set<string> };

const CURRENCY_RE = /^(?:[$€£]\s?\d[\d.,]*|\d[\d.,]*\s?(?:USD|EUR|€|\$))(?:\s?\/\s?\w+)?$/i;
const PHONE_RE = /^\+?[\d\s().-]+$/;
const BARE_PERCENT_RE = /^\d{1,3}(?:\.\d+)?$/;
/** Until every variable has a unit, bare numbers count as percents only for rate-like names. */
const PERCENT_NAME_RE = /rate|percent|increase|discount|pct/i;
/** Layout/style keys hold CSS values ("10%"), not facts. */
export const NON_COPY_KEY_RE =
  /position|width|height|style|class|color|colour|size|opacity|offset|padding|margin|align|ratio_css/i;

export const SELLING_FUNNEL_STAGES = ["consideration", "decision"] as const;

export function isSellingFunnelStage(stage: unknown): boolean {
  return typeof stage === "string" && (SELLING_FUNNEL_STAGES as readonly string[]).includes(stage.trim());
}

export function literalKinds(
  value: string,
  unit?: string,
  name?: string,
): Array<{ literal: string; kind: LiteralKind }> {
  const v = value.trim();
  if (!v) return [];
  if (/%$/.test(v) && BARE_PERCENT_RE.test(v.slice(0, -1).trim())) return [{ literal: v, kind: "percent" }];
  if (CURRENCY_RE.test(v)) return [{ literal: v, kind: "currency" }];
  if (PHONE_RE.test(v) && v.replace(/\D/g, "").length >= 9) return [{ literal: v, kind: "phone" }];
  if (BARE_PERCENT_RE.test(v)) {
    const n = Number(v);
    const percentLike = unit ? unit === "percent" : Boolean(name && PERCENT_NAME_RE.test(name));
    if (percentLike && n > 0 && n <= 100) return [{ literal: `${v}%`, kind: "percent" }];
  }
  return [];
}

function valueAsDisplayStrings(raw: unknown): string[] {
  if (raw == null) return [];
  if (typeof raw === "string") return raw.trim() ? [raw] : [];
  if (isMoneyValue(raw)) {
    const display = variableValueToDisplayString(raw);
    return display.trim() ? [display] : [];
  }
  return [];
}

function allValues(def: VariableDefinition): string[] {
  const out = new Set<string>();
  for (const s of valueAsDisplayStrings(def.default as VariableValue | undefined)) out.add(s);
  for (const c of def.conditions ?? []) {
    for (const s of valueAsDisplayStrings(c.value)) out.add(s);
  }
  for (const m of [def.by_locale, def.by_region, def.by_location]) {
    for (const v of Object.values(m ?? {})) {
      for (const s of valueAsDisplayStrings(v)) out.add(s);
    }
  }
  return [...out];
}

export function buildLiteralIndex(defs: Record<string, VariableDefinition>): Map<string, LiteralIndexEntry> {
  const index = new Map<string, LiteralIndexEntry>();
  for (const [name, def] of Object.entries(defs)) {
    if (def.isReserved || def.deprecated) continue;
    if (def.category === "copy" || def.category === "link" || def.category === "system") continue;
    for (const value of allValues(def)) {
      for (const { literal, kind } of literalKinds(value, def.unit, name)) {
        const entry = index.get(literal) ?? { literal, kind, names: new Set<string>() };
        entry.names.add(name);
        index.set(literal, entry);
      }
    }
  }
  return index;
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Literals present in `text` as whole values (no digit glued on either side). Tokens are ignored. */
export function findLiterals(text: string, index: Map<string, LiteralIndexEntry>): LiteralIndexEntry[] {
  const stripped = text.replace(/\{\{[^}]*\}\}/g, " ");
  const hits: LiteralIndexEntry[] = [];
  for (const entry of index.values()) {
    if (!stripped.includes(entry.literal)) continue;
    const re = new RegExp(`(?<![\\d.,])${escapeRe(entry.literal)}(?![\\d])`);
    if (re.test(stripped)) hits.push(entry);
  }
  // Longest literal wins when one contains another ("+1 (786) 416-6640" vs "416-6640").
  return hits.filter((h) => !hits.some((o) => o !== h && o.literal.includes(h.literal)));
}

export function isNonCopyFieldPath(fieldPath: string): boolean {
  const leafKey = fieldPath.split(".").pop()?.replace(/\[\d+\]$/, "") ?? "";
  return NON_COPY_KEY_RE.test(leafKey);
}

/**
 * Prefer variables whose `products` overlap pageProducts; site-wide (empty products) next;
 * others last. Stable sort within each band.
 */
export function rankVariablesByProduct(
  names: string[],
  defs: Record<string, VariableDefinition>,
  pageProducts: string[] | null | undefined,
): string[] {
  const want = new Set((pageProducts ?? []).map((p) => p.trim()).filter(Boolean));
  const scored = names.map((name) => {
    const products = (defs[name]?.products ?? []).map((p) => p.trim()).filter(Boolean);
    let band = 1; // site-wide / empty
    if (products.length > 0) {
      band = want.size > 0 && products.some((p) => want.has(p)) ? 0 : 2;
    }
    return { name, band };
  });
  scored.sort((a, b) => a.band - b.band || a.name.localeCompare(b.name));
  return scored.map((s) => s.name);
}

/** Page product slugs from funnel.products bindings (not "all"). */
export function pageProductSlugsFromFunnel(funnel: unknown): string[] {
  if (!funnel || typeof funnel !== "object" || Array.isArray(funnel)) return [];
  const products = (funnel as { products?: unknown }).products;
  if (!Array.isArray(products)) return [];
  const out: string[] = [];
  for (const raw of products) {
    if (typeof raw === "string" && raw.trim()) out.push(raw.trim());
    else if (raw && typeof raw === "object" && typeof (raw as { product?: unknown }).product === "string") {
      const p = (raw as { product: string }).product.trim();
      if (p) out.push(p);
    }
  }
  return [...new Set(out)];
}

export function funnelStageFromData(data: Record<string, unknown> | null | undefined): string | null {
  const funnel = data?.funnel;
  if (!funnel || typeof funnel !== "object" || Array.isArray(funnel)) return null;
  const stage = (funnel as { stage?: unknown }).stage;
  return typeof stage === "string" && stage.trim() ? stage.trim() : null;
}

export type FactLiteralWarning = {
  message: string;
  field_path: string;
  literal: string;
  kind: LiteralKind;
  variables: string[];
  status: LiteralHitStatus;
};

export function warningMessageForHit(hit: {
  literal: string;
  variables: string[];
  status: LiteralHitStatus;
}): string {
  const token = hit.variables[0] ? `{{ ${hit.variables[0]} }}` : "a site variable";
  if (hit.status === "wrong_for_audience") {
    return `“${hit.literal}” looks like a site fact for another region — prefer ${token} so visitors see the right value.`;
  }
  if (hit.status === "varies") {
    return `“${hit.literal}” matches a region-varying site fact — prefer ${token} instead of a fixed number.`;
  }
  return `“${hit.literal}” matches a stored site fact — prefer ${token} so visitors see the right region.`;
}
