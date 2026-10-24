/**
 * Server-side page tracking context (`_tracking` on first-load page data + the dataLayer
 * push written before GTM loads). Empty until the site's tracking switch is on.
 */

import { normalizeFunnelBlock } from "@shared/funnel";
import { buildFunnelTrackingContext, type PageTrackingContext } from "@shared/tracking-context";
import { commonYmlPath, readFunnelBlockFromFile } from "./funnel-fields";
import { loadTrackingKeyIndex } from "./product/tracking-key-index";
import { isTrackingReady } from "./product/tracking-readiness";

export function buildServerPageTracking(opts: {
  contentRoot: string;
  contentType: string;
  slug: string;
  /** Page data; its `funnel` (merged _common.yml) is used when present. */
  data?: Record<string, unknown> | null;
}): PageTrackingContext | null {
  if (!isTrackingReady(opts.contentRoot)) return null;
  try {
    const raw =
      opts.data && opts.data.funnel && typeof opts.data.funnel === "object"
        ? opts.data.funnel
        : readFunnelBlockFromFile(commonYmlPath(opts.contentType, opts.slug, opts.contentRoot));
    return buildFunnelTrackingContext(
      normalizeFunnelBlock(raw),
      { contentType: opts.contentType, contentSlug: opts.slug },
      loadTrackingKeyIndex(opts.contentRoot),
    );
  } catch {
    return null;
  }
}
