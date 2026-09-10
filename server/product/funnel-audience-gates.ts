/**
 * Funnel write gates for product audience + persona bindings.
 */

import {
  findPersonaById,
  isMinimalProductAudience,
} from "@shared/productAudience";
import type { FunnelBlock, FunnelProductBinding } from "@shared/funnel";
import { productManager } from "./product-manager";

export type FunnelAudienceGateResult =
  | { ok: true; warnings: { code: string; message: string }[] }
  | { ok: false; error: string; code: string; details?: unknown };

function resolveProductContentType(productSlug: string): string {
  const p =
    productManager.findProductByProgramId(productSlug) ||
    productManager.findProductByCmsEntry("program", productSlug, { includePaused: true });
  return p?.content_type ?? "program";
}

/**
 * Validate funnel.products bindings against product audience rules.
 * - `all` is always allowed (no persona).
 * - Binding a product without minimal audience → missing_product_audience.
 * - Binding a product with audience requires a valid persona, except program self-page may omit persona.
 */
export function assertFunnelAudienceGates(
  funnel: FunnelBlock,
  ctx: { contentType: string; contentSlug: string },
): FunnelAudienceGateResult {
  const warnings: { code: string; message: string }[] = [];
  const products = funnel.products;
  if (!products) return { ok: true, warnings };
  if (products === "all") return { ok: true, warnings };

  for (const binding of products as FunnelProductBinding[]) {
    const productSlug = binding.product;
    const productCt = resolveProductContentType(productSlug);
    const product = productManager.findProductByCmsEntry(productCt, productSlug, {
      includePaused: true,
    });

    if (!product) {
      warnings.push({
        code: "inactive_product",
        message: `Product "${productSlug}" is unknown or not purchasable.`,
      });
      continue;
    }

    const audience = product.audience;
    const minimal = isMinimalProductAudience(audience);
    const isProgramSelf =
      ctx.contentType === "program" &&
      ctx.contentSlug === productSlug &&
      product.content_type === "program";

    if (!minimal) {
      return {
        ok: false,
        code: "missing_product_audience",
        error: `Product "${productSlug}" needs a minimal audience (offer + persona) before it can join a funnel. Set audience on the product first.`,
        details: { product: productSlug },
      };
    }

    const personaId = binding.persona?.trim();
    if (!personaId) {
      if (isProgramSelf) continue;
      return {
        ok: false,
        code: "missing_funnel_persona",
        error: `Binding to "${productSlug}" requires a persona (product has an audience). Program catalog pages may omit persona for themselves only.`,
        details: { product: productSlug },
      };
    }

    if (!findPersonaById(audience, personaId)) {
      return {
        ok: false,
        code: "unknown_persona",
        error: `Persona "${personaId}" is not defined on product "${productSlug}".`,
        details: { product: productSlug, persona: personaId },
      };
    }
  }

  return { ok: true, warnings };
}
