/**
 * Leads by page funnel product / persona: the `funnel_product` / `funnel_persona` filters and
 * breakdowns over `lead_submissions.product`, `.persona` (comma-joined full ids, since migration 41)
 * and `.product_persona` (full-id pairs, since migration 42).
 *
 * Lists are read with the shared tracking decoders. A lead counts once per product / persona, so
 * shares can add up past 100%. Rows without pairs fall back to the persona list; a persona id
 * several products use gets no product (`:persona`, "product unknown") instead of a guess.
 */

import {
  buildTrackingKeyLookup,
  decodeTrackingCodes,
  decodeTrackingPairs,
  parseTrackingList,
  type TrackingKeyLookup,
} from "@shared/tracking-context";
import type { TrackingKeyIndex } from "@shared/tracking-keys";
import { LEADS_NONE, sharePct, type LeadsBreakdownRow, type LeadsFilters } from "@shared/leads-query";

export type FunnelIndex = TrackingKeyIndex | TrackingKeyLookup | null | undefined;

export type FunnelRow = { product: string | null; persona: string | null; product_persona: string | null; n: number };

const SENTINEL_PRODUCT_LABELS = { all: "All products (site-wide page)", none: "No product on page" } as const;
const SENTINEL_PERSONA_LABELS = { all: "All personas (site-wide page)", none: "No persona on page" } as const;
const NOT_RECORDED = "Not recorded yet";
const NO_PERSONA_KEY = "__no_persona__";

/** Whole-item match in a comma list column (instr, not LIKE: `_` in ids is a LIKE wildcard). */
const IN_LIST = (column: string) => `instr(',' || IFNULL(${column}, '') || ',', ',' || ? || ',') > 0`;
const EMPTY = (column: string) => `(${column} IS NULL OR TRIM(${column}) = '')`;

function isSentinel(v: string): v is "all" | "none" {
  return v === "all" || v === "none";
}

function splitPairKey(key: string): { product: string; persona: string } {
  const at = key.indexOf(":");
  return at < 0 ? { product: key, persona: "" } : { product: key.slice(0, at), persona: key.slice(at + 1) };
}

/** Product a persona id resolves to without pair context; undefined when unknown or shared by several products. */
function soleProductOf(lookup: TrackingKeyLookup, personaId: string): string | undefined {
  return decodeTrackingCodes(personaId, lookup, "persona")[0]?.product;
}

/** SQL conditions for the funnel filters (appended to the Leads WHERE). */
export function funnelFilterSql(
  filters: LeadsFilters,
  index: FunnelIndex,
  conds: string[],
  params: (string | number)[],
): void {
  const fp = filters.funnel_product;
  if (fp) {
    if (fp === LEADS_NONE) conds.push(EMPTY("product"));
    else {
      conds.push(IN_LIST("product"));
      params.push(fp);
    }
  }
  const fs = filters.funnel_persona;
  if (!fs) return;
  if (fs === LEADS_NONE) {
    conds.push(`${EMPTY("persona")} AND ${EMPTY("product")}`);
    return;
  }
  if (isSentinel(fs)) {
    conds.push(IN_LIST("persona"));
    params.push(fs);
    return;
  }
  const { product, persona } = splitPairKey(fs);
  const lookup = buildTrackingKeyLookup(index);
  // Rows before migration 42 have no pairs: they match only when the persona list resolves the
  // same way the breakdown does (sole product = this product, or no product for ":persona").
  const legacyMatches = persona ? (soleProductOf(lookup, persona) ?? "") === product : false;
  if (legacyMatches) {
    conds.push(`(${IN_LIST("product_persona")} OR (${EMPTY("product_persona")} AND ${IN_LIST("persona")}))`);
    params.push(fs, persona);
  } else {
    conds.push(IN_LIST("product_persona"));
    params.push(fs);
  }
}

type Group = { label: string; count: number; filter: LeadsFilters | null };

function bump(groups: Map<string, Group>, key: string, n: number, label: string, filter: LeadsFilters | null): void {
  const g = groups.get(key);
  if (g) g.count += n;
  else groups.set(key, { label, count: n, filter });
}

function toRows(groups: Map<string, Group>, whole: number): LeadsBreakdownRow[] {
  return Array.from(groups.entries()).map(([key, g]) => ({
    key,
    label: g.label,
    count: g.count,
    pct: sharePct(g.count, whole) ?? 0,
    filter: g.filter,
  }));
}

function productName(lookup: TrackingKeyLookup, code: string): string {
  return decodeTrackingCodes(code, lookup, "product")[0]?.name ?? code;
}

/** Persona breakdown row for one pair key (`product:persona` or `:persona`). */
function personaRowLabel(lookup: TrackingKeyLookup, key: string): string {
  const pair = decodeTrackingPairs(key, lookup)[0];
  const { product, persona } = splitPairKey(key);
  const personaLabel = pair?.persona?.name ?? persona;
  if (!product) return `${personaLabel} (product unknown)`;
  return `${personaLabel} · ${pair?.product?.name ?? product}`;
}

/** Persona pair keys for one stored row (pairs first, persona list for rows before migration 42). */
function personaKeys(lookup: TrackingKeyLookup, r: FunnelRow): { keys: string[]; sentinel: "all" | "none" | null } {
  const list = parseTrackingList(r.persona);
  if (r.product_persona) {
    const keys = parseTrackingList(r.product_persona).values.filter((pair) => splitPairKey(pair).persona !== "");
    return { keys: Array.from(new Set(keys)), sentinel: list.sentinel };
  }
  const keys = list.values.map((id) => `${soleProductOf(lookup, id) ?? ""}:${id}`);
  return { keys: Array.from(new Set(keys)), sentinel: list.sentinel };
}

/** Product and persona breakdowns (top rows + Other), shares of `whole` (leads in view). */
export function funnelBreakdowns(
  rows: FunnelRow[],
  whole: number,
  index: FunnelIndex,
  top: (rows: LeadsBreakdownRow[], whole: number) => LeadsBreakdownRow[],
): { products: LeadsBreakdownRow[]; personas: LeadsBreakdownRow[]; personaProductUnknown: number } {
  const lookup = buildTrackingKeyLookup(index);
  const products = new Map<string, Group>();
  const personas = new Map<string, Group>();
  let personaProductUnknown = 0;

  for (const r of rows) {
    const plist = parseTrackingList(r.product);
    if (!r.product || (plist.values.length === 0 && !plist.sentinel)) {
      bump(products, LEADS_NONE, r.n, NOT_RECORDED, { funnel_product: LEADS_NONE });
    } else {
      if (plist.sentinel) bump(products, plist.sentinel, r.n, SENTINEL_PRODUCT_LABELS[plist.sentinel], { funnel_product: plist.sentinel });
      for (const code of Array.from(new Set(plist.values))) {
        bump(products, code, r.n, productName(lookup, code), { funnel_product: code });
      }
    }

    const { keys, sentinel } = personaKeys(lookup, r);
    if (sentinel) bump(personas, sentinel, r.n, SENTINEL_PERSONA_LABELS[sentinel], { funnel_persona: sentinel });
    for (const key of keys) bump(personas, key, r.n, personaRowLabel(lookup, key), { funnel_persona: key });
    if (keys.some((key) => key.startsWith(":"))) personaProductUnknown += r.n;
    if (keys.length === 0 && !sentinel) {
      if (!r.product && !r.persona) bump(personas, LEADS_NONE, r.n, NOT_RECORDED, { funnel_persona: LEADS_NONE });
      else bump(personas, NO_PERSONA_KEY, r.n, "Product without persona", null);
    }
  }

  return {
    products: top(toRows(products, whole), whole),
    personas: top(toRows(personas, whole), whole),
    personaProductUnknown,
  };
}

/** Readable names for the active funnel filters (Leads page chips). */
export function funnelFilterLabels(
  filters: LeadsFilters,
  index: FunnelIndex,
): { funnel_product?: string; funnel_persona?: string } | undefined {
  const { funnel_product: fp, funnel_persona: fs } = filters;
  if (!fp && !fs) return undefined;
  const lookup = buildTrackingKeyLookup(index);
  const out: { funnel_product?: string; funnel_persona?: string } = {};
  if (fp) {
    out.funnel_product =
      fp === LEADS_NONE ? NOT_RECORDED : isSentinel(fp) ? SENTINEL_PRODUCT_LABELS[fp] : productName(lookup, fp);
  }
  if (fs) {
    out.funnel_persona =
      fs === LEADS_NONE ? NOT_RECORDED : isSentinel(fs) ? SENTINEL_PERSONA_LABELS[fs] : personaRowLabel(lookup, fs);
  }
  return out;
}
