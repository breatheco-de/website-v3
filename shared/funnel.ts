/**
 * Page-level funnel fields on `{slug}/_common.yml`.
 * Source of truth for journey stage + product membership (not section ecommerce_products).
 *
 * `funnel.products` is `"all"` or a list of `{ product, persona? }` bindings.
 * Legacy string slug lists coerce to `{ product }` only.
 */

export const FUNNEL_YAML_KEY = "funnel";

export const FUNNEL_STAGES = [
  "awareness",
  "consideration",
  "decision",
  "post-enrollment",
] as const;

export type FunnelStage = (typeof FUNNEL_STAGES)[number];

/** One page ↔ product (and optional persona) binding. */
export type FunnelProductBinding = {
  product: string;
  persona?: string;
};

export type FunnelProducts = FunnelProductBinding[] | "all";

export type FunnelBlock = {
  stage?: FunnelStage | string | null;
  products?: FunnelProducts | null;
};

/** Slug scope for tracking / Store (not persona-aware). */
export type ProductScope = string[] | "all";

export function isFunnelStage(value: unknown): value is FunnelStage {
  return typeof value === "string" && (FUNNEL_STAGES as readonly string[]).includes(value);
}

function trimStr(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}

/** Normalize one binding from string or object. */
export function normalizeFunnelBinding(raw: unknown): FunnelProductBinding | null {
  if (typeof raw === "string") {
    const product = raw.trim();
    return product ? { product } : null;
  }
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const o = raw as Record<string, unknown>;
  const product = trimStr(o.product) || trimStr(o.slug);
  if (!product) return null;
  const persona = trimStr(o.persona) || trimStr(o.persona_id) || undefined;
  return persona ? { product, persona } : { product };
}

/**
 * Normalize unknown YAML/JSON into FunnelProducts.
 * Legacy `string[]` becomes `{ product }[]`. Duplicate product+persona pairs are dropped.
 */
export function normalizeFunnelProducts(raw: unknown): FunnelProducts | undefined {
  if (raw === "all") return "all";
  if (!Array.isArray(raw)) return undefined;
  const out: FunnelProductBinding[] = [];
  const seen = new Set<string>();
  for (const item of raw) {
    const b = normalizeFunnelBinding(item);
    if (!b) continue;
    const key = `${b.product}\0${b.persona ?? ""}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(b);
  }
  return out.length > 0 ? out : undefined;
}

export function normalizeFunnelBlock(raw: unknown): FunnelBlock {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const o = raw as Record<string, unknown>;
  const stageRaw = o.stage;
  const stage =
    typeof stageRaw === "string" && stageRaw.trim()
      ? isFunnelStage(stageRaw.trim())
        ? stageRaw.trim()
        : stageRaw.trim()
      : undefined;
  const products = normalizeFunnelProducts(o.products);
  const out: FunnelBlock = {};
  if (stage) out.stage = stage;
  if (products !== undefined) out.products = products;
  return out;
}

/** Raw products from YAML before program self-union (always normalized bindings). */
export function readFunnelProducts(block: FunnelBlock | undefined | null): FunnelProducts | undefined {
  if (!block?.products) return undefined;
  return normalizeFunnelProducts(block.products as unknown);
}

/** Binding list for UI/MCP (program self-union adds `{ product: self }` if missing). */
export function effectiveBindings(
  funnel: FunnelBlock | undefined | null,
  ctx: { contentType?: string; contentSlug?: string },
): FunnelProductBinding[] | "all" | undefined {
  const raw = readFunnelProducts(funnel);
  if (ctx.contentType === "program" && typeof ctx.contentSlug === "string" && ctx.contentSlug) {
    if (raw === "all") return "all";
    const list: FunnelProductBinding[] = raw ? [...raw] : [];
    if (!list.some((b) => b.product === ctx.contentSlug)) {
      list.push({ product: ctx.contentSlug });
    }
    return list.length > 0 ? list : [{ product: ctx.contentSlug }];
  }
  return raw;
}

/**
 * Effective purchasable slug scope for tracking / Store (1B: program always includes self).
 */
export function effectiveProducts(
  funnel: FunnelBlock | undefined | null,
  ctx: { contentType?: string; contentSlug?: string },
): ProductScope | undefined {
  const bindings = effectiveBindings(funnel, ctx);
  if (!bindings) return undefined;
  if (bindings === "all") return "all";
  const slugs = [...new Set(bindings.map((b) => b.product).filter(Boolean))];
  return slugs.length > 0 ? slugs : undefined;
}

export function scopeIncludesProduct(scope: ProductScope, productSlug: string): boolean {
  if (scope === "all") return true;
  return scope.includes(productSlug);
}

export function funnelHasProductsWithoutStage(funnel: FunnelBlock | undefined | null): boolean {
  const products = readFunnelProducts(funnel);
  const hasProducts = products === "all" || (Array.isArray(products) && products.length > 0);
  const stage = funnel?.stage;
  const hasStage = typeof stage === "string" && stage.trim().length > 0;
  return hasProducts && !hasStage;
}

/** Enrollment card ids not covered by page effective products (5B). */
export function enrollmentIdsOutsideFunnel(
  cardIds: string[],
  funnel: FunnelBlock | undefined | null,
  ctx: { contentType?: string; contentSlug?: string },
): string[] {
  const effective = effectiveProducts(funnel, ctx);
  if (effective === "all") return [];
  if (!effective) return cardIds.filter(Boolean);
  return cardIds.filter((id) => id && !effective.includes(id));
}

/** Collect persona ids bound to a product slug across a funnel block. */
export function personasBoundToProduct(
  funnel: FunnelBlock | undefined | null,
  productSlug: string,
): string[] {
  const products = readFunnelProducts(funnel);
  if (!products || products === "all") return [];
  const ids: string[] = [];
  for (const b of products) {
    if (b.product === productSlug && b.persona) ids.push(b.persona);
  }
  return ids;
}
