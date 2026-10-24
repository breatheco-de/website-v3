/**
 * Page tracking context: the page funnel's products / personas as event values.
 *
 * - dataLayer / GA4 get short codes (`mode: "codes"`), comma-joined, each value cut at a
 *   whole code to 100 characters (`tracking_truncated: true` when anything was dropped).
 * - Lead ledger / CRM get full ids (`mode: "ids"`), never cut.
 * - Funnel `products: all` → "all"; content page without a funnel → "none".
 * - A missing key falls back to the full id.
 */

import { effectiveBindings, type FunnelBlock, type FunnelProductBinding } from "./funnel";
import type { RetiredShortKey, TrackingKeyIndex, TrackingKeyPersona, TrackingKeyProduct } from "./tracking-keys";

export const TRACKING_VALUE_MAX = 100;

/** dataLayer keys this module owns (cleared on every page change). */
export const PAGE_TRACKING_KEYS = [
  "product",
  "persona",
  "product_persona",
  "funnel_stage",
  "content_key",
  "tracking_truncated",
] as const;

export type PageTrackingContext = {
  product?: string;
  persona?: string;
  product_persona?: string;
  funnel_stage?: string;
  content_key?: string;
  tracking_truncated?: boolean;
};

export type TrackingMode = "codes" | "ids";

/** Example values for staff sample payloads (two products, two personas). Codes match the ids. */
export const SAMPLE_PAGE_TRACKING_CODES = {
  product: "aie,afx",
  persona: "cc,exp",
  product_persona: "aie:cc,afx:exp",
  funnel_stage: "consideration",
  content_key: "landing:apply",
} as const satisfies PageTrackingContext;

/** Same example as full ids, as the lead ledger / CRM receive it. */
export const SAMPLE_PAGE_TRACKING_IDS = {
  product: "ai-engineering,ai-flex",
  persona: "the-career-changer,the-explorer",
  product_persona: "ai-engineering:the-career-changer,ai-flex:the-explorer",
} as const;

export type TrackingKeyLookup = {
  productBySlug: Map<string, TrackingKeyProduct>;
  productByCode: Map<string, TrackingKeyProduct>;
  productById: Map<string, TrackingKeyProduct>;
  personaByCode: Map<string, { product: TrackingKeyProduct; persona: TrackingKeyPersona }>;
  retired: Map<string, RetiredShortKey & { product: string }>;
};

export function buildTrackingKeyLookup(index: TrackingKeyIndex | TrackingKeyLookup | null | undefined): TrackingKeyLookup {
  if (index && "productBySlug" in index) return index;
  const lookup: TrackingKeyLookup = {
    productBySlug: new Map(),
    productByCode: new Map(),
    productById: new Map(),
    personaByCode: new Map(),
    retired: new Map(),
  };
  for (const p of index?.products ?? []) {
    lookup.productBySlug.set(p.slug, p);
    lookup.productById.set(p.product_id, p);
    if (p.key) lookup.productByCode.set(p.key, p);
    for (const persona of p.personas) {
      if (persona.key) lookup.personaByCode.set(persona.key, { product: p, persona });
    }
    for (const r of p.retired) lookup.retired.set(`${r.type}:${r.key}`, { ...r, product: p.slug });
  }
  return lookup;
}

function productValue(lookup: TrackingKeyLookup, slug: string, mode: TrackingMode): string {
  if (mode === "ids") return slug;
  return lookup.productBySlug.get(slug)?.key || slug;
}

function personaValue(lookup: TrackingKeyLookup, productSlug: string, personaId: string, mode: TrackingMode): string {
  if (mode === "ids") return personaId;
  const persona = lookup.productBySlug.get(productSlug)?.personas.find((p) => p.id === personaId);
  return persona?.key || personaId;
}

/** Join whole values with "," up to `max` characters. */
export function joinCapped(values: string[], max = TRACKING_VALUE_MAX): { value: string; truncated: boolean } {
  let out = "";
  for (const v of values) {
    const next = out ? `${out},${v}` : v;
    if (next.length > max) return { value: out, truncated: true };
    out = next;
  }
  return { value: out, truncated: false };
}

const uniq = (values: string[]) => Array.from(new Set(values));

/** A product/persona reference that may not resolve (sent as written). */
type Ref = { product?: string; persona?: string; raw?: string };

function valuesFromRefs(
  pairs: Array<{ product: Ref; persona?: Ref }>,
  lookup: TrackingKeyLookup,
  mode: TrackingMode,
): { products: string[]; personas: string[]; pairs: string[] } {
  const prodVal = (r: Ref) => (r.product ? productValue(lookup, r.product, mode) : r.raw ?? "");
  const persVal = (r: Ref | undefined) =>
    !r ? "" : r.product && r.persona ? personaValue(lookup, r.product, r.persona, mode) : r.raw ?? r.persona ?? "";
  const products: string[] = [];
  const personas: string[] = [];
  const pairList: string[] = [];
  for (const { product, persona } of pairs) {
    const p = prodVal(product);
    const ps = persVal(persona);
    if (p) products.push(p);
    if (ps) personas.push(ps);
    pairList.push(`${p}:${ps}`);
  }
  return { products: uniq(products), personas: uniq(personas), pairs: uniq(pairList) };
}

function finish(
  base: PageTrackingContext,
  values: { products: string[]; personas: string[]; pairs: string[] },
  cap: boolean,
): PageTrackingContext {
  const out: PageTrackingContext = { ...base };
  let truncated = false;
  const set = (key: "product" | "persona" | "product_persona", list: string[]) => {
    if (list.length === 0) return;
    if (!cap) {
      out[key] = list.join(",");
      return;
    }
    const joined = joinCapped(list);
    if (joined.truncated) truncated = true;
    if (joined.value) out[key] = joined.value;
  };
  set("product", values.products);
  set("persona", values.personas);
  set("product_persona", values.pairs);
  if (truncated) out.tracking_truncated = true;
  return out;
}

export type PageRef = { contentType: string; contentSlug: string };

function baseContext(funnel: FunnelBlock | null | undefined, page: PageRef): PageTrackingContext {
  const stage = typeof funnel?.stage === "string" && funnel.stage.trim() ? funnel.stage.trim() : undefined;
  return {
    ...(stage ? { funnel_stage: stage } : {}),
    content_key: `${page.contentType}:${page.contentSlug}`,
  };
}

const ALL: PageTrackingContext = { product: "all", persona: "all", product_persona: "all" };
const NONE: PageTrackingContext = { product: "none", persona: "none", product_persona: "none" };

function bindingPairs(bindings: FunnelProductBinding[]): Array<{ product: Ref; persona?: Ref }> {
  return bindings.map((b) => ({
    product: { product: b.product },
    ...(b.persona ? { persona: { product: b.product, persona: b.persona } } : {}),
  }));
}

/** Event values for a content page from its funnel. */
export function buildFunnelTrackingContext(
  funnel: FunnelBlock | null | undefined,
  page: PageRef,
  index: TrackingKeyIndex | TrackingKeyLookup | null | undefined,
  opts: { mode?: TrackingMode } = {},
): PageTrackingContext {
  const mode = opts.mode ?? "codes";
  const base = baseContext(funnel, page);
  const bindings = effectiveBindings(funnel, page);
  if (bindings === undefined) return { ...base, ...NONE };
  if (bindings === "all") return { ...base, ...ALL };
  const lookup = buildTrackingKeyLookup(index);
  return finish(base, valuesFromRefs(bindingPairs(bindings), lookup, mode), mode === "codes");
}

const splitRefs = (raw: string | undefined): string[] =>
  (raw ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

/** Product slug for a reference that may be a slug, product_id or short code. */
export function resolveProductRef(lookup: TrackingKeyLookup, ref: string): string | null {
  if (lookup.productBySlug.has(ref)) return ref;
  const byId = lookup.productById.get(ref);
  if (byId) return byId.slug;
  const byCode = lookup.productByCode.get(ref.toLowerCase());
  return byCode ? byCode.slug : null;
}

/** Persona for a reference that may be an id (preferring `products`) or a short code. */
export function resolvePersonaRef(
  lookup: TrackingKeyLookup,
  ref: string,
  products: string[],
): { product: string; persona: string } | null {
  for (const slug of products) {
    if (lookup.productBySlug.get(slug)?.personas.some((p) => p.id === ref)) return { product: slug, persona: ref };
  }
  for (const p of Array.from(lookup.productBySlug.values())) {
    if (p.personas.some((x) => x.id === ref)) return { product: p.slug, persona: ref };
  }
  const byCode = lookup.personaByCode.get(ref.toLowerCase());
  return byCode ? { product: byCode.product.slug, persona: byCode.persona.id } : null;
}

export type TrackingOverride = { product?: string; persona?: string };

/**
 * Lead form context: page funnel unless the form overrides `product` and/or `persona`
 * (full id or short code, comma-separated). Product override without persona → only the
 * personas the funnel binds to those products ("none" when the page has no funnel).
 */
export function resolveFormTrackingContext(
  funnel: FunnelBlock | null | undefined,
  page: PageRef,
  index: TrackingKeyIndex | TrackingKeyLookup | null | undefined,
  override: TrackingOverride,
  opts: { mode?: TrackingMode } = {},
): PageTrackingContext {
  const mode = opts.mode ?? "codes";
  const productRefs = splitRefs(override.product);
  const personaRefs = splitRefs(override.persona);
  if (productRefs.length === 0 && personaRefs.length === 0) {
    return buildFunnelTrackingContext(funnel, page, index, opts);
  }
  const lookup = buildTrackingKeyLookup(index);
  const base = baseContext(funnel, page);
  const bindings = effectiveBindings(funnel, page);
  const cap = mode === "codes";

  if (productRefs.length > 0) {
    const products = productRefs.map((raw) => {
      const slug = resolveProductRef(lookup, raw);
      return slug ? { product: slug } : { raw };
    });
    const slugs = products.flatMap((p) => (p.product ? [p.product] : []));
    const pairs: Array<{ product: Ref; persona?: Ref }> = [];
    if (personaRefs.length > 0) {
      const personas = personaRefs.map((raw) => resolvePersonaRef(lookup, raw, slugs) ?? { raw });
      for (const prod of products) {
        const mine = personas.filter((ps) => "product" in ps && ps.product === prod.product);
        if (mine.length === 0) pairs.push({ product: prod });
        for (const ps of mine) pairs.push({ product: prod, persona: ps });
      }
      for (const ps of personas) {
        if ("raw" in ps || !slugs.includes(ps.product)) pairs.push({ product: {}, persona: ps });
      }
      return finish(base, valuesFromRefs(pairs, lookup, mode), cap);
    }
    if (bindings === undefined) {
      const values = valuesFromRefs(products.map((p) => ({ product: p })), lookup, mode);
      return finish(base, { ...values, personas: ["none"] }, cap);
    }
    for (const prod of products) {
      const bound =
        bindings === "all" || !prod.product
          ? []
          : bindings.filter((b) => b.product === prod.product && b.persona).map((b) => b.persona as string);
      if (bound.length === 0) pairs.push({ product: prod });
      for (const id of bound) pairs.push({ product: prod, persona: { product: prod.product, persona: id } });
    }
    return finish(base, valuesFromRefs(pairs, lookup, mode), cap);
  }

  // Persona override only: products stay the page's.
  const pageCtx = buildFunnelTrackingContext(funnel, page, lookup, opts);
  const pageSlugs = Array.isArray(bindings) ? uniq(bindings.map((b) => b.product)) : [];
  const personas = personaRefs.map((raw) => resolvePersonaRef(lookup, raw, pageSlugs) ?? { raw });
  const personaValues = uniq(
    personas.map((ps) => ("raw" in ps ? ps.raw : personaValue(lookup, ps.product, ps.persona, mode))),
  );
  const pairValues = uniq(
    personas.map((ps) =>
      "raw" in ps
        ? `:${ps.raw}`
        : `${productValue(lookup, ps.product, mode)}:${personaValue(lookup, ps.product, ps.persona, mode)}`,
    ),
  );
  const products = pageCtx.product ? pageCtx.product.split(",") : [];
  const { tracking_truncated: _t, product: _p, persona: _ps, product_persona: _pp, ...rest } = pageCtx;
  return finish(rest, { products, personas: personaValues, pairs: pairValues }, cap);
}

export type TrackingOverrideIssue = {
  code:
    | "FORM_UNKNOWN_TRACKING_PRODUCT"
    | "FORM_UNKNOWN_TRACKING_PERSONA"
    | "FORM_TRACKING_PERSONA_PRODUCT_MISMATCH"
    | "FORM_TRACKING_OVERRIDE_USES_CODE";
  message: string;
};

/** Problems with a lead form's hidden product / persona override (values are sent as written). */
export function checkTrackingOverride(
  override: TrackingOverride,
  index: TrackingKeyIndex | TrackingKeyLookup | null | undefined,
): TrackingOverrideIssue[] {
  const lookup = buildTrackingKeyLookup(index);
  const issues: TrackingOverrideIssue[] = [];
  const productSlugs: string[] = [];
  for (const ref of splitRefs(override.product)) {
    const slug = resolveProductRef(lookup, ref);
    if (!slug) {
      issues.push({
        code: "FORM_UNKNOWN_TRACKING_PRODUCT",
        message: `Hidden product "${ref}" is not a product on this site; it is sent to analytics and the CRM as written.`,
      });
      continue;
    }
    productSlugs.push(slug);
    if (slug !== ref && lookup.productByCode.get(ref.toLowerCase())?.slug === slug) {
      issues.push({
        code: "FORM_TRACKING_OVERRIDE_USES_CODE",
        message: `Hidden product "${ref}" is a tracking code; it works, but use the full id "${slug}" so the form reads the same as the funnel.`,
      });
    }
  }
  for (const ref of splitRefs(override.persona)) {
    const hit = resolvePersonaRef(lookup, ref, productSlugs);
    if (!hit) {
      issues.push({
        code: "FORM_UNKNOWN_TRACKING_PERSONA",
        message: `Hidden persona "${ref}" is not a persona on any product of this site; it is sent as written.`,
      });
      continue;
    }
    if (productSlugs.length > 0 && !productSlugs.includes(hit.product)) {
      issues.push({
        code: "FORM_TRACKING_PERSONA_PRODUCT_MISMATCH",
        message: `Hidden persona "${ref}" belongs to product "${hit.product}", not to the form's product ${productSlugs
          .map((s) => `"${s}"`)
          .join(", ")}.`,
      });
    }
    if (hit.persona !== ref) {
      issues.push({
        code: "FORM_TRACKING_OVERRIDE_USES_CODE",
        message: `Hidden persona "${ref}" is a tracking code; it works, but use the full id "${hit.persona}".`,
      });
    }
  }
  return issues;
}

export type TrackingLengthReport = {
  product: number;
  persona: number;
  product_persona: number;
  max: number;
  over: boolean;
};

/** Uncut lengths of the GA4 values for a funnel (drives the "too long" warnings). */
export function measureFunnelTrackingLength(
  funnel: FunnelBlock | null | undefined,
  page: PageRef,
  index: TrackingKeyIndex | TrackingKeyLookup | null | undefined,
): TrackingLengthReport {
  const bindings = effectiveBindings(funnel, page);
  const empty = { product: 0, persona: 0, product_persona: 0, max: TRACKING_VALUE_MAX, over: false };
  if (!Array.isArray(bindings)) return empty;
  const values = valuesFromRefs(bindingPairs(bindings), buildTrackingKeyLookup(index), "codes");
  const product = values.products.join(",").length;
  const persona = values.personas.join(",").length;
  const product_persona = values.pairs.join(",").length;
  return {
    product,
    persona,
    product_persona,
    max: TRACKING_VALUE_MAX,
    over: Math.max(product, persona, product_persona) > TRACKING_VALUE_MAX,
  };
}

export type DecodedTrackingCode = {
  code: string;
  status: "current" | "retired" | "full_id" | "sentinel" | "unknown";
  id?: string;
  name?: string;
  product?: string;
};

/** Translate a comma-joined GA4 value back to names (current and retired keys). */
export function decodeTrackingCodes(
  value: string,
  index: TrackingKeyIndex | TrackingKeyLookup | null | undefined,
  type: "product" | "persona",
): DecodedTrackingCode[] {
  const lookup = buildTrackingKeyLookup(index);
  return splitRefs(value).map((code): DecodedTrackingCode => {
    if (code === "all" || code === "none") return { code, status: "sentinel" };
    if (type === "product") {
      const p = lookup.productByCode.get(code);
      if (p) return { code, status: "current", id: p.slug, name: p.name, product: p.slug };
      const bySlug = lookup.productBySlug.get(code);
      if (bySlug) return { code, status: "full_id", id: bySlug.slug, name: bySlug.name, product: bySlug.slug };
    } else {
      const hit = lookup.personaByCode.get(code);
      if (hit) {
        return { code, status: "current", id: hit.persona.id, name: hit.persona.name, product: hit.product.slug };
      }
      for (const p of Array.from(lookup.productBySlug.values())) {
        const persona = p.personas.find((x) => x.id === code);
        if (persona) return { code, status: "full_id", id: persona.id, name: persona.name, product: p.slug };
      }
    }
    const retired = lookup.retired.get(`${type}:${code}`);
    if (retired) return { code, status: "retired", id: retired.id, name: retired.name, product: retired.product };
    return { code, status: "unknown" };
  });
}
