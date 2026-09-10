/**
 * Ecommerce Resolver — CMS bridge.
 *
 * If the loaded entry resolves to an active purchasable product, product
 * identity + settings are injected under `ecommerce`. No plan catalog injection.
 */

import { productManager as ecommerceManager } from "../product/product-manager";
import type { EcommerceRenderContext } from "../product/types";
import { child } from "../logger";
const log = child({ module: "ecommerce/ecommerce-resolver" });

type RenderContext = Record<string, unknown>;

export function enrichWithEcommerceData(
  contentType: string,
  slug: string,
  renderContext: RenderContext,
): RenderContext {
  try {
    const product = ecommerceManager.findProductByCmsEntry(contentType, slug);
    if (!product) return renderContext;

    const settings = ecommerceManager.getSettings();
    const ecommerceData: EcommerceRenderContext = {
      product: { ...product },
      settings,
    };

    renderContext.ecommerce = ecommerceData;
  } catch (err) {
    log.error({ err }, `[EcommerceResolver] Error enriching ${contentType}/${slug}:`);
  }

  return renderContext;
}
