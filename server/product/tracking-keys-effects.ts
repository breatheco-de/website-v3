/**
 * After tracking keys change (save, rename, fixer, migration): drop the key cache,
 * clear cached HTML for the product page and every page whose funnel binds the product,
 * and re-check the site's tracking switch.
 */

import { invalidateHtmlPageCacheForSlug } from "../html-page-cache";
import { child } from "../logger";
import { listFunnelBindingsForProduct } from "./product-audience-io";
import { contentRootAbsolute, invalidateTrackingKeyIndex, siteIdForContentRoot } from "./tracking-key-index";
import { recheckTrackingReadiness } from "./tracking-readiness";

const log = child({ module: "product/tracking-keys-effects" });

export function onTrackingKeysChanged(
  contentRoot: string | undefined,
  products: { contentType: string; slug: string }[],
): void {
  const root = contentRootAbsolute(contentRoot);
  invalidateTrackingKeyIndex(root);
  const site = siteIdForContentRoot(root);
  try {
    const slugs = new Set<string>();
    for (const p of products) {
      slugs.add(p.slug);
      for (const page of listFunnelBindingsForProduct(p.slug, root)) slugs.add(page.slug);
    }
    for (const slug of slugs) invalidateHtmlPageCacheForSlug(site, slug);
  } catch (err) {
    log.warn({ err, site }, "[tracking] could not clear cached pages after a key change");
  }
  recheckTrackingReadiness(root);
}
