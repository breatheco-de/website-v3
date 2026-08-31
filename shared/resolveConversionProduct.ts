/**
 * Resolve ecommerce product identity for lead conversion tracking.
 * Funnel scope wins; form field (ecommerce_product_field) supplies the user pick.
 */

import {
  effectiveProducts,
  type FunnelBlock,
  type ProductScope,
  scopeIncludesProduct,
} from "./funnel";

export const DEFAULT_ECOMMERCE_PRODUCT_FIELD = "program";

export type ConversionProductLookup = (
  programId: string,
) => { product_id: string; name?: string; active?: boolean; content_type?: string } | undefined;

export type ResolveConversionProductInput = {
  funnel?: FunnelBlock | null;
  contentType?: string;
  contentSlug?: string;
  /** Normalized submit value from ecommerce_product_field */
  fieldValue?: string | null;
  productLookup?: ConversionProductLookup | null;
};

export type ResolveConversionProductResult = {
  ok: boolean;
  /** Content slug used for funnel membership / program_id */
  program_id?: string;
  /** Ecommerce product_id for GA item_id */
  item_id?: string;
  reason?:
    | "resolved"
    | "no_purchasable"
    | "outside_funnel"
    | "empty_field"
    | "no_scope";
};

function normalizeId(raw: string | null | undefined): string {
  return typeof raw === "string" ? raw.trim() : "";
}

/**
 * Resolve analytics product ids for a conversion submit.
 * Does not change CRM `program` — callers dual-write item_id when ok.
 */
export function resolveConversionProduct(
  input: ResolveConversionProductInput,
): ResolveConversionProductResult {
  const fieldValue = normalizeId(input.fieldValue);
  const scope: ProductScope | undefined = effectiveProducts(input.funnel ?? undefined, {
    contentType: input.contentType,
    contentSlug: input.contentSlug,
  });

  let candidate = fieldValue;

  if (!candidate && scope && scope !== "all" && scope.length === 1) {
    candidate = scope[0];
  }

  if (!candidate && input.contentType === "program" && input.contentSlug) {
    candidate = input.contentSlug;
  }

  if (!candidate) {
    return { ok: false, reason: "empty_field" };
  }

  if (scope && scope !== "all" && !scopeIncludesProduct(scope, candidate)) {
    // Try lookup by product_id → content slug if field sent product_id
    const viaLookup = input.productLookup?.(candidate);
    if (viaLookup && scopeIncludesProduct(scope, candidate)) {
      // no-op; candidate already in scope check failed
    }
    // Also allow match when lookup maps another key — search scope members
    let matchedSlug: string | undefined;
    if (input.productLookup) {
      for (const slug of scope) {
        const p = input.productLookup(slug);
        if (p && (p.product_id === candidate || slug === candidate)) {
          matchedSlug = slug;
          break;
        }
      }
    }
    if (!matchedSlug) {
      return { ok: false, reason: "outside_funnel", program_id: candidate };
    }
    candidate = matchedSlug;
  }

  if (!scope && input.contentType !== "program") {
    // No funnel on non-program page: still allow purchasable map hit
  }

  const product = input.productLookup?.(candidate);
  if (!product || product.active === false) {
    return {
      ok: false,
      reason: product ? "no_purchasable" : "no_purchasable",
      program_id: candidate,
    };
  }

  return {
    ok: true,
    reason: "resolved",
    program_id: candidate,
    item_id: product.product_id,
  };
}
