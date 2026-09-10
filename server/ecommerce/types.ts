/**
 * Thin re-exports — prefer `server/product/*`.
 * Kept so older imports keep working during the rename.
 */

export type {
  CmsProduct,
  EcommerceProduct,
  EcommerceSettings,
  EcommerceRenderContext,
  ResolvedProduct,
  FunnelStep,
  FunnelTrafficSource,
} from "../product/types";

export {
  productMap,
  ecommerceSettings,
  MARKETING_CONTENT_DIR,
  ECOMMERCE_SETTINGS_PATH,
  scanProductContent,
  scanEcommerceContent,
  startProductWatcher,
  startEcommerceWatcher,
} from "../product/product-index";

export {
  productManager,
  ecommerceManager,
  EcommerceManager,
  PURCHASABLE_FIELD,
  applyPurchasableToRecord,
} from "../product/product-manager";
