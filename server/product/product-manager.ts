/**
 * Product Manager — singleton query API.
 */

import { productMap, ecommerceSettings } from "./product-index";
import type {
  CmsProduct,
  EcommerceSettings,
  ResolvedProduct,
  FunnelStep,
  FunnelTrafficSource,
} from "./types";
import {
  audienceStatus,
  isMinimalProductAudience,
  type AudienceStatus,
  type ProductAudience,
} from "@shared/productAudience";

class ProductManager {
  private static instance: ProductManager;

  static getInstance(): ProductManager {
    if (!ProductManager.instance) {
      ProductManager.instance = new ProductManager();
    }
    return ProductManager.instance;
  }

  private constructor() {}

  getProduct(productId: string): CmsProduct | undefined {
    return productMap.get(productId);
  }

  getAllProducts(): CmsProduct[] {
    return Array.from(productMap.values()).filter((p) => p.actively_selling);
  }

  /** All indexed purchasable products, optionally including paused. Deduped by product_id. */
  listAllProducts(opts?: { includePaused?: boolean }): CmsProduct[] {
    const includePaused = opts?.includePaused !== false;
    const seen = new Set<string>();
    const out: CmsProduct[] = [];
    for (const product of productMap.values()) {
      if (seen.has(product.product_id)) continue;
      seen.add(product.product_id);
      if (!includePaused && !product.actively_selling) continue;
      out.push(product);
    }
    return out;
  }

  /** True when this content type has at least one purchasable product in the index. */
  contentTypeHasProducts(contentType: string): boolean {
    for (const product of productMap.values()) {
      if (product.content_type === contentType) return true;
    }
    return false;
  }

  /** @deprecated Use contentTypeHasProducts */
  contentTypeHasEcommerce(contentType: string): boolean {
    return this.contentTypeHasProducts(contentType);
  }

  /** True when the entry is in the product map (purchasable: true), regardless of actively_selling. */
  isEntryPurchasable(contentType: string, slug: string): boolean {
    return !!this.findProductByCmsEntry(contentType, slug, { includePaused: true });
  }

  listPurchasableSlugs(contentType: string): string[] {
    const slugs: string[] = [];
    const seen = new Set<string>();
    for (const product of productMap.values()) {
      if (product.content_type !== contentType) continue;
      if (seen.has(product.content_slug)) continue;
      seen.add(product.content_slug);
      slugs.push(product.content_slug);
    }
    return slugs;
  }

  findProductByCmsEntry(
    contentType: string,
    slug: string,
    opts?: { includePaused?: boolean },
  ): CmsProduct | undefined {
    const includePaused = opts?.includePaused === true;
    const derivedKey = `${contentType}-${slug}`;
    const byKey = productMap.get(derivedKey);
    if (byKey && (includePaused || byKey.actively_selling)) return byKey;

    const slashKey = `${contentType}/${slug}`;
    const bySlash = productMap.get(slashKey);
    if (bySlash && (includePaused || bySlash.actively_selling)) return bySlash;

    for (const product of productMap.values()) {
      if (product.content_type !== contentType || product.content_slug !== slug) continue;
      if (!includePaused && !product.actively_selling) continue;
      return product;
    }
    return undefined;
  }

  /** Resolve program/content slug to an actively-selling product (by content_slug or product_id). */
  findProductByProgramId(programId: string): CmsProduct | undefined {
    for (const product of productMap.values()) {
      if (!product.actively_selling) continue;
      if (product.content_slug === programId || product.product_id === programId) {
        return product;
      }
    }
    return undefined;
  }

  getAudience(contentType: string, slug: string): ProductAudience | null {
    return this.findProductByCmsEntry(contentType, slug, { includePaused: true })?.audience ?? null;
  }

  getAudienceStatus(contentType: string, slug: string): AudienceStatus {
    const audience = this.getAudience(contentType, slug);
    return audienceStatus(audience);
  }

  hasMinimalAudience(contentType: string, slug: string): boolean {
    return isMinimalProductAudience(this.getAudience(contentType, slug));
  }

  getSettings(): EcommerceSettings {
    return { ...ecommerceSettings };
  }

  resolveProduct(productId: string): ResolvedProduct | null {
    const product = this.getProduct(productId);
    if (!product) return null;
    return {
      ...product,
      funnel: {
        steps: [...product.funnel.steps],
        traffic_sources: [...(product.funnel.traffic_sources ?? [])],
      },
      audience: product.audience ?? null,
    };
  }

  getFunnelSteps(productId: string): FunnelStep[] {
    return this.getProduct(productId)?.funnel.steps ?? [];
  }

  getFunnelTrafficSources(productId: string): FunnelTrafficSource[] {
    return this.getProduct(productId)?.funnel.traffic_sources ?? [];
  }
}

export const productManager = ProductManager.getInstance();

/** @deprecated Use productManager */
export const ecommerceManager = productManager;

/** Template / listing key. Computed; never authored in YAML. */
export const PURCHASABLE_FIELD = "purchasable";

export function applyPurchasableToRecord(
  record: Record<string, unknown>,
  contentType: string,
  slug?: string,
): void {
  if (!productManager.contentTypeHasProducts(contentType)) return;
  const s = (slug || String(record.slug ?? "")).trim();
  record[PURCHASABLE_FIELD] = s ? productManager.isEntryPurchasable(contentType, s) : false;
}

/** @deprecated Use ProductManager */
export const EcommerceManager = ProductManager;
