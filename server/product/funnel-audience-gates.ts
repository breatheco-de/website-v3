/**
 * Funnel write gates for product audience + persona bindings + completeness.
 * When site funnel.enforcement is off (or type opted out), gates are skipped.
 */

import {
  findPersonaById,
  isMinimalProductAudience,
} from "@shared/productAudience";
import type { FunnelBlock, FunnelProductBinding } from "@shared/funnel";
import { normalizeFunnelProducts } from "@shared/funnel";
import { productManager } from "./product-manager";
import {
  isFunnelEnforcedForType,
  siteHasPurchasableProducts,
} from "../funnel-enforcement";

export type FunnelAudienceGateResult =
  | { ok: true; warnings: { code: string; message: string }[] }
  | { ok: false; error: string; code: string; details?: unknown };

function resolveProductContentType(productSlug: string): string {
  const p =
    productManager.findProductByProgramId(productSlug) ||
    productManager.findProductByCmsEntry("program", productSlug, { includePaused: true });
  return p?.content_type ?? "program";
}

export type FunnelPersonaChoice = {
  id: string;
  label: string;
  role: string;
  industry_or_context?: string;
};

/** Personas on the product a funnel binding names (in-memory product index). Null when unknown or no personas. */
export function productPersonasForFunnel(productSlug: string): FunnelPersonaChoice[] | null {
  const product = productManager.findProductByCmsEntry(
    resolveProductContentType(productSlug),
    productSlug,
    { includePaused: true },
  );
  const personas = product?.audience?.personas ?? [];
  if (personas.length === 0) return null;
  return personas.map((p) => ({
    id: p.id,
    label: p.label || p.role,
    role: p.role,
    ...(p.industry_or_context ? { industry_or_context: p.industry_or_context } : {}),
  }));
}

function hasFunnelStage(funnel: FunnelBlock): boolean {
  return typeof funnel.stage === "string" && funnel.stage.trim().length > 0;
}

function hasFunnelProducts(funnel: FunnelBlock): boolean {
  const products = normalizeFunnelProducts(funnel.products as unknown);
  return products === "all" || (Array.isArray(products) && products.length > 0);
}

/**
 * Validate funnel write under enforcement:
 * - Site off / type opted out → ok (relaxed gates).
 * - Else require stage; require products when site has purchasables; then audience/persona rules.
 * - `all` is always allowed (no persona).
 * - Binding a product without minimal audience → missing_product_audience.
 * - Binding a product with audience requires a valid persona, except program self-page may omit persona.
 */
export function assertFunnelAudienceGates(
  funnel: FunnelBlock,
  ctx: { contentType: string; contentSlug: string; contentRoot?: string },
): FunnelAudienceGateResult {
  const warnings: { code: string; message: string }[] = [];

  if (!isFunnelEnforcedForType(ctx.contentType, ctx.contentRoot)) {
    return { ok: true, warnings };
  }

  if (!hasFunnelStage(funnel)) {
    return {
      ok: false,
      code: "missing_funnel_stage",
      error:
        "funnel.stage is required while funnel enforcement is on for this content type. Set awareness, consideration, decision, or post-enrollment.",
      details: { contentType: ctx.contentType, slug: ctx.contentSlug },
    };
  }

  if (siteHasPurchasableProducts() && !hasFunnelProducts(funnel)) {
    return {
      ok: false,
      code: "missing_funnel_products",
      error:
        'funnel.products is required while funnel enforcement is on (site has purchasable products). Set "all" or product+persona bindings.',
      details: { contentType: ctx.contentType, slug: ctx.contentSlug },
    };
  }

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
