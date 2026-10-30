/**
 * Page tracking context: the page funnel's products / personas as event values.
 *
 * - dataLayer / GA4 get short codes (`mode: "codes"`), comma-joined, each value cut at a
 *   whole code to 100 characters (`tracking_truncated: true` when anything was dropped).
 *   The cut keeps the funnel's first codes; the kept codes are then sorted.
 * - Lead ledger / CRM get full ids (`mode: "ids"`), never cut, sorted.
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
  product: "afx,aie",
  persona: "cc,exp",
  product_persona: "afx:exp,aie:cc",
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

/** Join whole values with "," up to `max` characters, keeping them in the given order. */
export function joinCapped(
  values: string[],
  max = TRACKING_VALUE_MAX,
): { value: string; truncated: boolean; kept: string[] } {
  let out = "";
  const kept: string[] = [];
  for (const v of values) {
    const next = out ? `${out},${v}` : v;
    if (next.length > max) return { value: out, truncated: true, kept };
    out = next;
    kept.push(v);
  }
  return { value: out, truncated: false, kept };
}

/**
 * Sorted comma join (code-unit order, same in Node and browsers), so the same set of values
 * always gives the same string whatever the funnel's order.
 */
function joinSorted(values: string[]): string {
  return values.slice().sort().join(",");
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
      out[key] = joinSorted(list);
      return;
    }
    // Cut in page order first so a long list keeps the funnel's first values, then sort.
    const joined = joinCapped(list);
    if (joined.truncated) truncated = true;
    if (joined.kept.length > 0) out[key] = joinSorted(joined.kept);
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

/**
 * Lead-webhook id lists as JSON, then encodeURIComponent.
 * Type + slug are optional (program self-include only). `products: all` / missing funnel
 * resolve without them. Template `{{ funnel.products }}` does not use this.
 */
export function funnelProductsQueryValue(
  funnel: FunnelBlock | null | undefined,
  contentType?: string | null,
  contentSlug?: string | null,
): string {
  const ctx = buildFunnelTrackingContext(
    funnel,
    { contentType: contentType ?? "", contentSlug: contentSlug ?? "" },
    null,
    { mode: "ids" },
  );
  return encodeURIComponent(
    JSON.stringify({
      product: ctx.product ?? NONE.product,
      persona: ctx.persona ?? NONE.persona,
      product_persona: ctx.product_persona ?? NONE.product_persona,
    }),
  );
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

export type TrackingSentinel = "all" | "none";

const isSentinel = (v: string): v is TrackingSentinel => v === "all" || v === "none";

/**
 * Read a stored product / persona / product_persona value back into its items: split on
 * commas, trim, drop empties. `all` / `none` are returned as `sentinel`, never as items.
 */
export function parseTrackingList(value: string | null | undefined): {
  values: string[];
  sentinel: TrackingSentinel | null;
} {
  const values: string[] = [];
  let sentinel: TrackingSentinel | null = null;
  for (const item of splitRefs(value ?? undefined)) {
    if (!isSentinel(item)) values.push(item);
    else if (sentinel === null) sentinel = item;
  }
  return { values, sentinel };
}

function decodeProduct(lookup: TrackingKeyLookup, code: string): DecodedTrackingCode {
  if (isSentinel(code)) return { code, status: "sentinel" };
  const p = lookup.productByCode.get(code);
  if (p) return { code, status: "current", id: p.slug, name: p.name, product: p.slug };
  const bySlug = lookup.productBySlug.get(code);
  if (bySlug) return { code, status: "full_id", id: bySlug.slug, name: bySlug.name, product: bySlug.slug };
  const retired = lookup.retired.get(`product:${code}`);
  if (retired) return { code, status: "retired", id: retired.id, name: retired.name, product: retired.product };
  return { code, status: "unknown" };
}

/**
 * Persona codes are unique per site; full persona ids are not. With `productSlug` the id is
 * looked up in that product only; without it, an id several products use gets no `product`.
 */
function decodePersona(lookup: TrackingKeyLookup, code: string, productSlug?: string): DecodedTrackingCode {
  if (isSentinel(code)) return { code, status: "sentinel" };
  const hit = lookup.personaByCode.get(code);
  if (hit) return { code, status: "current", id: hit.persona.id, name: hit.persona.name, product: hit.product.slug };
  const owners = productSlug
    ? [lookup.productBySlug.get(productSlug)].filter((p): p is TrackingKeyProduct => !!p)
    : Array.from(lookup.productBySlug.values());
  const matches = owners.flatMap((p) => {
    const persona = p.personas.find((x) => x.id === code);
    return persona ? [{ product: p, persona }] : [];
  });
  if (matches.length > 0) {
    const { persona } = matches[0];
    return {
      code,
      status: "full_id",
      id: persona.id,
      name: persona.name,
      ...(matches.length === 1 ? { product: matches[0].product.slug } : {}),
    };
  }
  const retired = lookup.retired.get(`persona:${code}`);
  if (retired && (!productSlug || retired.product === productSlug)) {
    return { code, status: "retired", id: retired.id, name: retired.name, product: retired.product };
  }
  return { code, status: "unknown" };
}

/** Translate a comma-joined value (GA4 codes or ledger full ids) back to names (current and retired keys). */
export function decodeTrackingCodes(
  value: string,
  index: TrackingKeyIndex | TrackingKeyLookup | null | undefined,
  type: "product" | "persona",
): DecodedTrackingCode[] {
  const lookup = buildTrackingKeyLookup(index);
  return splitRefs(value).map((code) => (type === "product" ? decodeProduct(lookup, code) : decodePersona(lookup, code)));
}

export type DecodedTrackingPair = { product: DecodedTrackingCode | null; persona: DecodedTrackingCode | null };

/**
 * Translate a product_persona value (`aie:cc,afx:exp`, or full ids) back to pairs. The persona
 * is resolved within its pair's product. `aie:` = product without persona; `:raw` = persona
 * whose product is unknown; `all` / `none` come back as a sentinel product.
 */
export function decodeTrackingPairs(
  value: string,
  index: TrackingKeyIndex | TrackingKeyLookup | null | undefined,
): DecodedTrackingPair[] {
  const lookup = buildTrackingKeyLookup(index);
  return splitRefs(value).map((item): DecodedTrackingPair => {
    if (isSentinel(item)) return { product: { code: item, status: "sentinel" }, persona: null };
    const at = item.indexOf(":");
    const productCode = (at < 0 ? item : item.slice(0, at)).trim();
    const personaCode = (at < 0 ? "" : item.slice(at + 1)).trim();
    const product = productCode ? decodeProduct(lookup, productCode) : null;
    const persona = personaCode ? decodePersona(lookup, personaCode, product?.product) : null;
    return { product, persona };
  });
}
