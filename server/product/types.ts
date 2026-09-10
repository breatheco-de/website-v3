/**
 * CMS product domain types (entry `_product.yml`).
 * Billing plans / POS SKUs are not part of this model.
 *
 * Google/dataLayer "ecommerce" event names stay separate.
 */

import type { ProductAudience } from "@shared/productAudience";

export interface FunnelStep {
  content_type: string;
  slug: string;
  role?: string;
}

/** Documented inbound demand by content type (not a URL step). One row per content_type. */
export interface FunnelTrafficSource {
  content_type: string;
  role: string;
}

export interface CmsProduct {
  product_id: string;
  name: string;
  content_type: string;
  content_slug: string;
  /** Pause switch for store/tracking. Default true. Not a lead-form filter. */
  actively_selling: boolean;
  description?: string;
  /**
   * Authored conversion path after the locked product entry (not including auto `all` pages),
   * plus optional type-level traffic_sources for top-of-funnel documentation.
   */
  funnel: { steps: FunnelStep[]; traffic_sources: FunnelTrafficSource[] };
  /** Offer + personas from entry `_product.yml` (audience only on entry). */
  audience?: ProductAudience | null;
}

/** @deprecated Use CmsProduct */
export type EcommerceProduct = CmsProduct;

export interface EcommerceSettings {
  currency: string;
  locale: string;
  tax_inclusive: boolean;
}

/** A product as returned from resolve APIs (no plan catalog). */
export type ResolvedProduct = CmsProduct;

/** Shape injected into the CMS render context under the `ecommerce` key. */
export interface EcommerceRenderContext {
  product: ResolvedProduct;
  settings: EcommerceSettings;
}
